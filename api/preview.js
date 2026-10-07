// POST /api/preview  { url, tags: { industry: [...], types: [...] } }
// 로그인한 팀원만 호출 가능. 링크를 읽어 제목·대표 이미지·AI 요약 2줄·추천 태그를 돌려줍니다.
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { decodeHtml, extractMeta, extractText, normalizeUrl, fallbackSummary } from './_lib/extract.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const MAX_BYTES = 1_500_000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 지원합니다.' });

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !(await isMember(token))) {
    return res.status(401).json({ error: '팀원 로그인이 필요합니다.' });
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : (req.body || {});
  let target;
  try {
    target = new URL(String(body.url || '').trim());
    if (!/^https?:$/.test(target.protocol)) throw new Error();
  } catch {
    return res.status(400).json({ error: '올바른 링크가 아닙니다. https://로 시작하는 주소를 넣어주세요.' });
  }

  const originalUrl = target.href;
  let meta = { title: '', description: '', image: '', siteName: target.hostname.replace(/^www\./, '') };
  let text = '';
  let fetched = false;
  try {
    const page = await fetchPage(normalizeUrl(originalUrl));
    meta = { ...meta, ...stripEmpty(extractMeta(page.html, page.url)) };
    text = extractText(page.html);
    fetched = true;
  } catch (e) {
    console.warn('fetch failed', originalUrl, e?.message);
  }

  const tagLists = {
    industry: (body.tags?.industry || []).filter(s => typeof s === 'string').slice(0, 40),
    types: (body.tags?.types || []).filter(s => typeof s === 'string').slice(0, 40),
  };

  let summary = '';
  let suggested = { industry: [], types: [] };
  let ai = false;
  if (GEMINI_API_KEY && (fetched || meta.title)) {
    try {
      const r = await summarize({ url: originalUrl, meta, text, tagLists });
      summary = r.summary;
      suggested = r.suggested;
      ai = true;
    } catch (e) {
      console.warn('gemini failed', e?.message);
    }
  }
  if (!summary) summary = fallbackSummary(meta, text);

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    url: originalUrl,
    title: meta.title,
    image: meta.image,
    siteName: meta.siteName,
    summary,
    suggested,
    ai,
    fetched,
  });
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }
function stripEmpty(o) { return Object.fromEntries(Object.entries(o).filter(([, v]) => v)); }

async function isMember(token) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_member`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    return r.ok && (await r.json()) === true;
  } catch {
    return false;
  }
}

// 내부망 주소로의 요청을 막습니다.
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function assertPublicHost(u) {
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('blocked host');
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new Error('blocked address');
}

async function fetchPage(url) {
  let current = new URL(url);
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicHost(current);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    let r;
    try {
      r = await fetch(current, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.6' },
      });
    } finally {
      clearTimeout(timer);
    }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      current = new URL(r.headers.get('location'), current);
      if (!/^https?:$/.test(current.protocol)) throw new Error('bad redirect');
      continue;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const type = r.headers.get('content-type') || '';
    if (!/html|xml/i.test(type)) throw new Error('not html');
    const bytes = await readLimited(r.body, MAX_BYTES);
    return { url: current.href, html: decodeHtml(bytes, type) };
  }
  throw new Error('too many redirects');
}

async function readLimited(stream, limit) {
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  try { await reader.cancel(); } catch { /* noop */ }
  const out = new Uint8Array(Math.min(size, limit));
  let off = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, out.length - off);
    out.set(c.subarray(0, take), off);
    off += take;
    if (off >= out.length) break;
  }
  return out;
}

async function summarize({ url, meta, text, tagLists }) {
  const prompt = [
    '당신은 삼성증권 브랜드전략팀의 레퍼런스 아카이브 편집자입니다.',
    '아래 웹페이지를 팀원이 나중에 빠르게 다시 찾아볼 수 있도록 한국어 요약 2줄을 작성하세요.',
    '- 1줄: 무엇에 관한 것인지 (브랜드/주체 + 핵심 내용). 40자 이내.',
    '- 2줄: 브랜드·마케팅 관점에서 참고할 포인트. 40자 이내.',
    '- 과장, 이모지, 따옴표, 번호 없이 담백한 서술체(~함/~임 또는 명사형)로 작성.',
    '- 페이지 내용이 부족하면 확인 가능한 사실만 쓰고 추측하지 마세요.',
    `또한 아래 태그 목록에서 해당하는 것만 골라주세요(없으면 빈 배열). 목록에 없는 태그는 만들지 마세요.`,
    `업종 태그: ${JSON.stringify(tagLists.industry)}`,
    `성격 태그: ${JSON.stringify(tagLists.types)}`,
    '',
    `URL: ${url}`,
    `사이트: ${meta.siteName || ''}`,
    `제목: ${meta.title || ''}`,
    `설명: ${meta.description || ''}`,
    `본문 일부:\n${(text || '').slice(0, 4000)}`,
  ].join('\n');

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            line1: { type: 'STRING' },
            line2: { type: 'STRING' },
            industry: { type: 'ARRAY', items: { type: 'STRING' } },
            types: { type: 'ARRAY', items: { type: 'STRING' } },
          },
          required: ['line1', 'line2', 'industry', 'types'],
        },
      },
    }),
  });
  if (!r.ok) throw new Error(`Gemini HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  const raw = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  const j = JSON.parse(raw);
  const clean = s => String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 80);
  const l1 = clean(j.line1), l2 = clean(j.line2);
  if (!l1) throw new Error('empty summary');
  return {
    summary: l2 ? `${l1}\n${l2}` : l1,
    suggested: {
      industry: (j.industry || []).filter(t => tagLists.industry.includes(t)),
      types: (j.types || []).filter(t => tagLists.types.includes(t)),
    },
  };
}
