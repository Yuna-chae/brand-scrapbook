// POST /api/preview  { url, tags: { industry: [...], types: [...] } }
// 로그인한 팀원만 호출 가능. 링크를 읽어 제목·대표 이미지·AI 요약 2줄·추천 태그를 돌려줍니다.
//  - 유튜브: 영상 정보(oEmbed) + Gemini가 영상 자체를 보고 요약
//  - 일반 페이지: 직접 읽어서 요약, 읽기 어려운 페이지는 Gemini가 링크를 직접 열어 요약
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { decodeHtml, extractMeta, extractText, normalizeUrl, fallbackSummary, youtubeId } from './_lib/extract.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const MODELS = [...new Set([process.env.GEMINI_MODEL, 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'].filter(Boolean))];
let DEADLINE = 0; // 요청당 AI에 쓸 수 있는 마감 시각 (Vercel 60초 제한 안쪽)

const MAX_BYTES = 1_500_000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const GENERIC_TITLE = /^(-\s*)?(youtube|instagram|naver|네이버 블로그|facebook)$/i;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 지원합니다.' });

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !(await isMember(token))) {
    return res.status(401).json({ error: '팀원 로그인이 필요합니다. 앱을 새로고침한 뒤 다시 시도해주세요.' });
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
  const tagLists = {
    industry: (body.tags?.industry || []).filter(s => typeof s === 'string').slice(0, 40),
    types: (body.tags?.types || []).filter(s => typeof s === 'string').slice(0, 40),
  };

  const yt = youtubeId(originalUrl);
  let meta = { title: '', description: '', image: '', siteName: target.hostname.replace(/^www\.|^m\./, '') };
  let text = '';
  let fetched = false;

  if (yt) {
    meta = { ...meta, ...(await youtubeMeta(yt)) };
    fetched = !!meta.title;
  } else {
    try {
      const page = await fetchPage(normalizeUrl(originalUrl));
      meta = { ...meta, ...stripEmpty(extractMeta(page.html, page.url)) };
      text = extractText(page.html);
      fetched = true;
    } catch (e) {
      console.warn('fetch failed', originalUrl, e?.message);
    }
  }
  if (GENERIC_TITLE.test(meta.title.trim())) meta.title = '';

  // 시도 순서: 앞의 방법이 실패하면 다음 방법
  const attempts = [];
  if (yt) {
    attempts.push(() => summarizeVideo(yt, meta, tagLists));
    if (meta.title) attempts.push(() => summarizeText(originalUrl, meta, '', tagLists));
  } else {
    const thin = !fetched || (text.length < 300 && (meta.description || '').length < 80);
    if (thin) attempts.push(() => summarizeByUrl(originalUrl, meta, tagLists));
    if (fetched && (meta.title || text)) attempts.push(() => summarizeText(originalUrl, meta, text, tagLists));
  }

  let ai = null;
  let aiError = '';
  DEADLINE = Date.now() + 50000;
  if (!GEMINI_API_KEY) {
    aiError = 'Vercel에 GEMINI_API_KEY가 설정되지 않음';
  } else {
    const errs = [];
    for (const run of attempts) {
      try { ai = await run(); break; }
      catch (e) { errs.push(friendly(e)); console.warn('gemini failed', e?.message); }
    }
    aiError = [...new Set(errs)].join(' / ');
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    url: originalUrl,
    title: meta.title || ai?.title || '',
    image: meta.image,
    siteName: meta.siteName,
    summary: ai?.summary || fallbackSummary(meta, text),
    suggested: ai?.suggested || { industry: [], types: [] },
    ai: !!ai,
    aiError: ai ? '' : aiError,
    fetched: fetched || !!ai,
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

// ───────── 유튜브 ─────────
async function youtubeMeta(id) {
  const watch = `https://www.youtube.com/watch?v=${id}`;
  const base = { image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, siteName: 'YouTube' };
  try {
    const r = await fetchWithTimeout(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`, {}, 8000);
    if (!r.ok) throw new Error(`oembed ${r.status}`);
    const j = await r.json();
    return { ...base, title: j.title || '', description: j.author_name ? `채널: ${j.author_name}` : '' };
  } catch (e) {
    console.warn('oembed failed', e?.message);
    return base;
  }
}

// ───────── 일반 페이지 읽기 ─────────
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

async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

async function fetchPage(url) {
  let current = new URL(url);
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicHost(current);
    const r = await fetchWithTimeout(current, {
      redirect: 'manual',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.6' },
    }, 9000);
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

// ───────── Gemini ─────────
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    line1: { type: 'STRING' },
    line2: { type: 'STRING' },
    industry: { type: 'ARRAY', items: { type: 'STRING' } },
    types: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['title', 'line1', 'line2', 'industry', 'types'],
};

function instructions(tagLists, sourceNote) {
  return [
    '당신은 삼성증권 브랜드전략팀의 레퍼런스 아카이브 편집자입니다.',
    `${sourceNote} 팀원이 나중에 빠르게 다시 찾아볼 수 있도록 한국어 요약 2줄을 작성하세요.`,
    '- line1: 무엇에 관한 것인지 (브랜드·출연자·주체 + 핵심 내용). 45자 이내.',
    '- line2: 브랜드·마케팅 관점에서 참고할 포인트 (협업 방식, 메시지, 형식 등). 45자 이내.',
    '- 과장, 이모지, 따옴표, 번호 없이 담백하게 "~함/~임" 또는 명사형으로 끝맺기.',
    '- 확인되는 사실만 쓰고 추측하지 마세요.',
    '- title: 원래 제목이 있으면 그대로, 없으면 내용을 대표하는 짧은 제목.',
    '아래 태그 목록에서 해당하는 것만 고르세요(없으면 빈 배열, 목록에 없는 태그는 금지).',
    `industry 후보: ${JSON.stringify(tagLists.industry)}`,
    `types 후보: ${JSON.stringify(tagLists.types)}`,
  ].join('\n');
}

async function summarizeVideo(id, meta, tagLists) {
  const prompt = instructions(tagLists, '첨부된 유튜브 영상을 실제로 보고(음성·자막·화면 포함),') +
    `\n\n참고 정보\n제목: ${meta.title || '(알 수 없음)'}\n${meta.description || ''}`;
  const data = await gemini({
    contents: [{ role: 'user', parts: [{ fileData: { fileUri: `https://www.youtube.com/watch?v=${id}` } }, { text: prompt }] }],
    generationConfig: { temperature: 0.3, mediaResolution: 'MEDIA_RESOLUTION_LOW', responseMimeType: 'application/json', responseSchema: SCHEMA },
  }, 38000);
  return toResult(data, tagLists);
}

async function summarizeByUrl(url, meta, tagLists) {
  const prompt = instructions(tagLists, `다음 링크(${url})의 페이지를 직접 열어 읽고, 그 내용을 바탕으로`) +
    '\n\n결과는 설명 없이 JSON 한 개로만 답하세요: {"title":"","line1":"","line2":"","industry":[],"types":[]}' +
    (meta.title ? `\n참고 제목: ${meta.title}` : '');
  const data = await gemini({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ urlContext: {} }],
    generationConfig: { temperature: 0.3 },
  }, 30000);
  return toResult(data, tagLists);
}

async function summarizeText(url, meta, text, tagLists) {
  const prompt = instructions(tagLists, '아래 웹페이지 정보를 바탕으로') + [
    '', `URL: ${url}`, `사이트: ${meta.siteName || ''}`, `제목: ${meta.title || ''}`, `설명: ${meta.description || ''}`,
    `본문 일부:\n${(text || '').slice(0, 4000)}`,
  ].join('\n');
  const data = await gemini({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, responseMimeType: 'application/json', responseSchema: SCHEMA },
  }, 15000);
  return toResult(data, tagLists);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 모델이 붐비거나(503·429) 없으면(404) 잠깐 기다렸다 다시, 그래도 안 되면 다음 모델로 넘어갑니다.
async function gemini(body, timeoutMs) {
  let last;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const left = DEADLINE - Date.now();
      if (left < 4000) throw last || Object.assign(new Error('timeout'), { kind: 'timeout' });
      let r;
      try {
        r = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
          body: JSON.stringify(body),
        }, Math.min(timeoutMs, left - 1000));
      } catch (e) {
        const timeout = e?.name === 'AbortError';
        throw Object.assign(new Error(timeout ? 'timeout' : String(e?.message)), { kind: timeout ? 'timeout' : 'network' });
      }
      if (r.ok) return r.json();
      const msg = (await r.text()).slice(0, 400);
      last = Object.assign(new Error(`Gemini ${model} HTTP ${r.status}: ${msg}`), { status: r.status, msg, model });
      console.warn(last.message);
      if (r.status === 400 && /API key/i.test(msg)) throw last;
      if (r.status === 401 || r.status === 403) throw last;
      if ((r.status === 503 || r.status === 500 || r.status === 429) && attempt === 0) { await sleep(1500); continue; }
      break; // 다음 모델로
    }
  }
  throw last;
}

function toResult(data, tagLists) {
  const cand = data?.candidates?.[0];
  const raw = cand?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!raw) throw new Error(`empty response (${cand?.finishReason || data?.promptFeedback?.blockReason || 'unknown'})`);
  const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  const clean = s => String(s || '').replace(/[\r\n]+/g, ' ').replace(/^["'“”]+|["'“”]+$/g, '').trim().slice(0, 90);
  const l1 = clean(j.line1), l2 = clean(j.line2);
  if (!l1) throw new Error('empty summary');
  return {
    title: clean(j.title).slice(0, 120),
    summary: l2 ? `${l1}\n${l2}` : l1,
    suggested: {
      industry: (j.industry || []).filter(t => tagLists.industry.includes(t)),
      types: (j.types || []).filter(t => tagLists.types.includes(t)),
    },
  };
}

function friendly(e) {
  const s = e?.status, m = `${e?.msg || e?.message || ''}`;
  let detail = '';
  try { detail = JSON.parse(e?.msg || '').error?.message || ''; } catch { /* noop */ }
  const tail = s ? ` · ${s}${detail ? ' ' + detail.slice(0, 70) : ''}` : '';
  if (e?.kind === 'timeout') return 'AI 응답 시간 초과';
  if (s === 400 && /API key/i.test(m)) return 'GEMINI_API_KEY 값이 올바르지 않음';
  if (s === 401 || s === 403) return `GEMINI_API_KEY 권한 오류${tail}`;
  if (s === 429) return `AI 사용량 한도 초과${tail}`;
  if (s >= 500) return `AI 서버 오류${tail}`;
  return `AI 요약 실패${tail || ' · ' + m.slice(0, 60)}`;
}
