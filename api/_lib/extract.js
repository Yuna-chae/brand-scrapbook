// HTML에서 대표 이미지·제목·설명·본문 텍스트를 뽑아내는 순수 함수 모음

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };

export function decodeEntities(s = '') {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function attrs(tag) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '');
  return out;
}

export function sniffCharset(contentType = '', headBytes) {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const ascii = Buffer.from(headBytes.slice(0, 4096)).toString('latin1');
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(ascii)?.[1];
  return (fromMeta || 'utf-8').toLowerCase();
}

export function decodeHtml(bytes, contentType) {
  let cs = sniffCharset(contentType, bytes);
  if (cs === 'ks_c_5601-1987' || cs === 'cp949') cs = 'euc-kr';
  try { return new TextDecoder(cs).decode(bytes); }
  catch { return new TextDecoder('utf-8').decode(bytes); }
}

export function extractMeta(html, pageUrl) {
  const meta = {};
  const metaRe = /<meta\b[^>]*>/gi;
  let m;
  while ((m = metaRe.exec(html))) {
    const a = attrs(m[0]);
    const key = (a.property || a.name || a.itemprop || '').toLowerCase();
    if (key && a.content && !(key in meta)) meta[key] = a.content.trim();
  }
  const titleTag = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '').replace(/\s+/g, ' ').trim();

  let image = meta['og:image'] || meta['og:image:url'] || meta['og:image:secure_url'] || meta['twitter:image'] || meta['twitter:image:src'] || meta['image'] || '';
  if (!image) {
    const linkImg = /<link\b[^>]*rel=["']image_src["'][^>]*>/i.exec(html);
    if (linkImg) image = attrs(linkImg[0]).href || '';
  }
  try { if (image) image = new URL(image, pageUrl).href; } catch { image = ''; }
  if (image.startsWith('http://')) image = 'https://' + image.slice(7);

  let siteName = meta['og:site_name'] || meta['application-name'] || '';
  if (!siteName) { try { siteName = new URL(pageUrl).hostname.replace(/^www\.|^m\./, ''); } catch { /* noop */ } }

  return {
    title: (meta['og:title'] || meta['twitter:title'] || titleTag || '').slice(0, 200),
    description: (meta['og:description'] || meta['twitter:description'] || meta['description'] || '').slice(0, 600),
    image,
    siteName: siteName.slice(0, 60),
  };
}

export function extractText(html, max = 5000) {
  let body = html
    .replace(/<(script|style|noscript|svg|iframe|template|header|footer|nav|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const article = /<article\b[\s\S]*?<\/article>/i.exec(body)?.[0];
  if (article && article.length > 800) body = article;
  const text = decodeEntities(body.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  return text.slice(0, max);
}

// 네이버 블로그는 본문이 iframe 안에 있어 모바일 주소로 바꿔 읽습니다.
export function normalizeUrl(raw) {
  const u = new URL(raw);
  if (u.hostname === 'blog.naver.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    const blogId = u.searchParams.get('blogId') || parts[0];
    const logNo = u.searchParams.get('logNo') || parts[1];
    if (blogId && logNo && /^\d+$/.test(logNo)) return `https://m.blog.naver.com/${blogId}/${logNo}`;
  }
  if (u.hostname === 'cafe.naver.com') u.hostname = 'm.cafe.naver.com';
  return u.href;
}

export function fallbackSummary(meta, text) {
  const src = (meta.description || text || '').replace(/\s+/g, ' ').trim();
  if (!src) return '';
  const sentences = src.split(/(?<=[.!?。]|다\.)\s+/).filter(Boolean);
  const l1 = (sentences[0] || src).slice(0, 60);
  const l2 = (sentences[1] || '').slice(0, 60);
  return l2 ? `${l1}\n${l2}` : l1;
}
