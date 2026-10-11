// Supabase 라이브러리는 /vendor/supabase.js(공식 배포본 2.45.4)를 index.html에서 먼저 불러옵니다.
const { createClient } = window.supabase;
import { SUPABASE_URL, SUPABASE_ANON_KEY, PHOTO_BUCKET, MAX_PHOTOS, VAPID_PUBLIC_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// ───────────────────────── 공통 상태 · 유틸 ─────────────────────────
const S = { unread: 0, session: null, me: null, people: new Map(), tags: { industry: [], type: [] }, refFilter: { ind: '', type: '' }, visitFilter: '' };
const CATS = ['경쟁사', '삼성금융', '기타'];
const view = document.getElementById('view');
const nav = document.getElementById('nav');
let cleanups = [];

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const photoUrl = (path) => path ? `${SUPABASE_URL}/storage/v1/object/public/${PHOTO_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}` : '';
const thumbOf = (path) => path ? path.replace(/\.jpg$/, '_t.jpg') : '';
const today = () => new Date().toLocaleDateString('sv-SE');
const safeHref = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : '#'; } catch { return '#'; } };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* noop */ } },
};

function fmtDate(iso) {
  const d = new Date(iso);
  const diff = (Date.now() - d) / 60000;
  if (diff < 1) return '방금';
  if (diff < 60) return `${Math.floor(diff)}분 전`;
  if (diff < 60 * 24) return `${Math.floor(diff / 60)}시간 전`;
  const y = d.getFullYear() === new Date().getFullYear() ? '' : `${String(d.getFullYear()).slice(2)}.`;
  return `${y}${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
const fmtDay = (s) => s ? s.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1.$2.$3') : '';

function person(id) { return S.people.get(id) || { name: '팀원', avatar_url: null }; }
// 한글 세 글자 이름은 가운데 글자(유나 → 유), 그 외는 첫 글자
const initialOf = (name = '') => { const n = name.trim() || '팀'; return /^[가-힣]{3}$/.test(n) ? n[1] : n[0]; };
function avatar(id, cls = 'av') {
  const p = person(id);
  const initial = esc(initialOf(p.name));
  return `<span class="${cls}">${p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="" referrerpolicy="no-referrer" data-fallback="${initial}">` : initial}</span>`;
}

let toastTimer;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2600);
}

function sheet(html, onClick) {
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  const close = () => bg.remove();
  bg.addEventListener('click', (e) => {
    if (e.target === bg) return close();
    const b = e.target.closest('button[data-act]');
    if (b) { close(); onClick?.(b.dataset.act); }
  });
  document.body.appendChild(bg);
  return close;
}

function openViewer(src) {
  const v = document.createElement('div');
  v.className = 'viewer';
  v.innerHTML = `<img src="${esc(src)}" alt=""><button aria-label="닫기">${ICON.close('#fff')}</button>`;
  v.addEventListener('click', () => v.remove());
  document.body.appendChild(v);
}

// 이미지가 깨지면 대체 표시
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG' || img.dataset.fallback == null) return;
  const span = document.createElement('span');
  span.textContent = img.dataset.fallback;
  img.replaceWith(span);
}, true);

const ICON = {
  back: () => '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
  close: (c = 'currentColor') => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  more: () => '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  plus: () => '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  pen: () => '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  heart: (on) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/></svg>`,
  bubble: () => '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4A8 8 0 1 1 20 12z"/></svg>',
  camera: () => '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h3l2-3h8l2 3h3v11H3z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  text: () => '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h9"/></svg>',
  up: () => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
  down: () => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
  trash: () => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  bell: () => '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/></svg>',
  bellOff: () => '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.6 4.3A6 6 0 0 1 18 9c0 3.3.8 5.3 1.5 6.4M6.3 6.3A6 6 0 0 0 6 9c0 6-2.5 7.5-2.5 7.5H16.5"/><path d="M10 20a2.2 2.2 0 0 0 4 0"/><path d="M3 3l18 18"/></svg>',
  google: () => '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.4-.2-2.1H12v4h6c-.3 1.4-1 2.5-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-7.9z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.5-2.7c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H2.1v2.8C3.9 20.5 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.7 14.1c-.2-.7-.4-1.4-.4-2.1s.1-1.4.4-2.1V7.1H2.1C1.4 8.6 1 10.2 1 12s.4 3.4 1.1 4.9l3.6-2.8z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1C17.5 2.2 15 1 12 1 7.7 1 3.9 3.5 2.1 7.1l3.6 2.8C6.6 7.4 9.1 5.4 12 5.4z"/></svg>',
};

function setView(html, { tab = null } = {}) {
  cleanups.forEach(fn => { try { fn(); } catch { /* noop */ } });
  cleanups = [];
  document.querySelectorAll('.sheet-bg, .viewer').forEach(n => n.remove());
  view.innerHTML = html;
  nav.hidden = !tab;
  $$('a[data-tab]', nav).forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  window.scrollTo(0, 0);
  if (document.getElementById('bellBadge')) refreshBell();
}

function header(title, extra = '') {
  return `<header class="hdr">
    <div class="hdr-top">
      <div><div class="eyebrow">브랜드전략팀 · <span class="serif">Brand Scrapbook</span></div><h1>${esc(title)}</h1></div>
      <div class="hdr-actions"><a class="bell" href="#/alerts" aria-label="알림">${ICON.bell()}<span class="bell-badge" id="bellBadge" ${S.unread ? '' : 'hidden'}>${S.unread > 99 ? '99+' : S.unread}</span></a>
      <a class="me-btn" href="#/me" aria-label="내 정보">${S.me?.avatar_url ? `<img src="${esc(S.me.avatar_url)}" alt="" referrerpolicy="no-referrer" data-fallback="${esc(initialOf(S.me.name))}">` : esc(initialOf(S.me?.name))}</a></div>
    </div>${extra}
  </header>`;
}

// 무한 스크롤
function pager({ list, sentinel, size = 20, load, render, empty }) {
  let page = 0, done = false, busy = false, total = 0;
  const more = async () => {
    if (busy || done) return;
    busy = true;
    sentinel.innerHTML = '<div class="loading">불러오는 중…</div>';
    const { data, error } = await load(page * size, page * size + size - 1);
    busy = false;
    if (error) { sentinel.innerHTML = `<div class="loading">불러오지 못했습니다. 화면을 다시 열어주세요.</div>`; console.error(error); return; }
    page++;
    total += data.length;
    list.insertAdjacentHTML('beforeend', data.map(render).join(''));
    if (data.length < size) done = true;
    sentinel.innerHTML = done && total === 0 ? empty : '';
  };
  const io = new IntersectionObserver((es) => { if (es.some(e => e.isIntersecting)) more(); }, { rootMargin: '600px' });
  io.observe(sentinel);
  cleanups.push(() => io.disconnect());
  more();
}

// ───────────────────────── 로그인 · 시작 ─────────────────────────
function splashHtml(bottom) {
  return `<section class="splash">
    <div class="brandline"><i></i>SAMSUNG SECURITIES · 브랜드전략팀</div>
    <div class="stage" aria-hidden="true">
      <div class="f-back"></div>
      <div class="card-link"><div class="urlbar"><b></b>reference.link</div><div class="mini-img"></div>
        <div class="ln" style="width:90%"></div><div class="ln" style="width:64%"></div>
        <span class="hash">#브랜딩</span><span class="hash">#오프라인</span></div>
      <div class="polaroid"><div class="pic"></div><span class="cap serif">booth visit · ${new Date().getMonth() + 1}.${new Date().getDate()}</span></div>
      <div class="tape" style="right:24%;top:-2px;transform:rotate(-12deg)"></div>
      <div class="tape" style="left:16%;top:12px;transform:rotate(18deg);width:48px"></div>
      <div class="f-front"><div class="band"></div><span class="label">SCRAPBOOK</span><span class="serif" style="font-size:15px;opacity:.85">Vol. 01</span></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:22px">
      <div class="wordmark"><span class="en serif">Brand Scrapbook</span><span class="ko">브랜드 스크랩북</span>
        <p>눈에 걸린 레퍼런스도, 발로 다녀온 현장도<br>한 권에 모아 팀과 나눕니다.</p></div>
      ${bottom}
    </div>
  </section>`;
}

function showLogin() {
  setView(splashHtml(`
    <button class="gbtn" id="login">${ICON.google()} Google 계정으로 시작하기</button>
    <p class="note" style="text-align:center">브랜드전략팀 등록 계정만 이용할 수 있으며,<br>한 번 로그인하면 다음부터 자동으로 연결됩니다.</p>`));
  $('#login').onclick = async (e) => {
    e.currentTarget.disabled = true;
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + '/', queryParams: { prompt: 'select_account' } },
    });
    if (error) { e.currentTarget.disabled = false; toast('로그인을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.'); }
  };
}

function showNotMember(email) {
  setView(splashHtml(`
    <div class="card"><b>등록되지 않은 계정입니다</b>
      <p class="note">${esc(email)} 계정은 팀원 명단에 없습니다. 관리자에게 이 주소를 등록해달라고 요청한 뒤 다시 로그인해주세요.</p></div>
    <button class="gbtn" id="out">다른 계정으로 로그인</button>`));
  $('#out').onclick = async () => { await sb.auth.signOut(); showLogin(); };
}

let entered = false;
async function enter(session) {
  if (entered) return;
  entered = true;
  S.session = session;
  const { data: ok, error } = await sb.rpc('is_member');
  if (error || !ok) { entered = false; return showNotMember(session.user.email); }
  await Promise.all([loadPeople(), loadTags()]);
  if (!S.people.has(session.user.id)) {
    // DB 설정 전에 가입한 계정이면 프로필을 만들어 둡니다.
    const md = session.user.user_metadata || {};
    await sb.from('profiles').upsert({ id: session.user.id, email: session.user.email, name: md.full_name || md.name || session.user.email.split('@')[0], avatar_url: md.avatar_url || null });
    await loadPeople();
  }
  S.me = { id: session.user.id, email: session.user.email, ...person(session.user.id) };
  if (pushSupported() && Notification.permission === 'granted') currentSub().then(sub => sub && saveSub(sub)).catch(() => {});
  const shared = consumeShare();
  if (shared) location.hash = `#/refs/new?url=${encodeURIComponent(shared)}`;
  route();
}

async function loadPeople() {
  const { data } = await sb.from('people').select('id,name,avatar_url');
  S.people = new Map((data || []).map(p => [p.id, p]));
}
async function loadTags() {
  const { data } = await sb.from('tags').select('kind,name,sort,id').order('sort').order('id');
  S.tags.industry = (data || []).filter(t => t.kind === 'industry').map(t => t.name);
  S.tags.type = (data || []).filter(t => t.kind === 'type').map(t => t.name);
}

// 안드로이드 '공유하기'로 들어온 링크
function captureShare() {
  const q = new URLSearchParams(location.search);
  const raw = [q.get('url'), q.get('text'), q.get('title')].filter(Boolean).join(' ');
  if (!raw) return;
  const u = raw.match(/https?:\/\/[^\s<>"']+/)?.[0];
  if (u) store.set('pendingShare', u);
  history.replaceState(null, '', location.pathname + location.hash);
}
function consumeShare() {
  const saved = store.get('pendingShare');
  if (saved) store.set('pendingShare', '');
  return saved || null;
}

// ───────────────────────── 라우터 ─────────────────────────
function route() {
  if (!S.session) return;
  const [path, qs] = (location.hash.slice(1) || '/refs').split('?');
  const q = new URLSearchParams(qs || '');
  const p = path.split('/').filter(Boolean);
  if (p[0] === 'refs' && p[1] === 'new') return refForm(null, q.get('url') || '');
  if (p[0] === 'refs' && p[2] === 'edit') return refForm(Number(p[1]));
  if (p[0] === 'refs' && p[1]) return refDetail(Number(p[1]));
  if (p[0] === 'visits' && p[1] === 'new') return visitForm(null);
  if (p[0] === 'visits' && p[2] === 'edit') return visitForm(Number(p[1]));
  if (p[0] === 'visits' && p[1]) return visitDetail(Number(p[1]));
  if (p[0] === 'visits') return visitFeed();
  if (p[0] === 'me') return mePage();
  if (p[0] === 'alerts') return alertsPage();
  return refFeed();
}
window.addEventListener('hashchange', route);

// ───────────────────────── 레퍼런스 ─────────────────────────
function refFeed() {
  const f = S.refFilter;
  const ind = ['', ...S.tags.industry].map(t => `<button class="chip${f.ind === t ? ' on' : ''}" data-ind="${esc(t)}">${t ? esc(t) : '전체'}</button>`).join('');
  const typ = ['', ...S.tags.type].map(t => `<button class="chip2${f.type === t ? ' on' : ''}" data-type="${esc(t)}">${t ? esc(t) : '전체'}</button>`).join('');
  setView(`${header('레퍼런스', `<div class="row" aria-label="업종">${ind}</div><div class="row" aria-label="성격">${typ}</div>`)}
    ${topBanner()}
    <div class="feed"><div id="list" style="display:flex;flex-direction:column;gap:12px"></div><div class="sentinel" id="sent"></div></div>
    <a class="fab" href="#/refs/new" aria-label="레퍼런스 등록">${ICON.plus()}</a>`, { tab: 'refs' });
  bindTopBanner();
  $$('[data-ind]').forEach(b => b.onclick = () => { S.refFilter.ind = b.dataset.ind; refFeed(); });
  $$('[data-type]').forEach(b => b.onclick = () => { S.refFilter.type = b.dataset.type; refFeed(); });

  pager({
    list: $('#list'), sentinel: $('#sent'),
    load: (a, b) => {
      let q = sb.from('refs').select('*').order('created_at', { ascending: false }).range(a, b);
      if (f.ind) q = q.contains('industry', [f.ind]);
      if (f.type) q = q.contains('types', [f.type]);
      return q;
    },
    render: refCard,
    empty: `<div class="empty"><b>${f.ind || f.type ? '이 태그의 레퍼런스가 아직 없습니다' : '첫 레퍼런스를 모아보세요'}</b>+ 버튼으로 카톡방에 공유하던 링크를 붙여넣거나<br>사진과 내용만 올려 모을 수 있습니다.</div>`,
  });
}

const MAX_REF_PHOTOS = 10;
const isYouTube = (u) => /(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test((() => { try { return new URL(u).hostname; } catch { return ''; } })());

function refCard(r) {
  const initial = esc((r.site_name || r.title || '·').trim()[0] || '·');
  const tags = [...(r.industry || []), ...(r.types || [])];
  const photos = r.photos || [];
  const mine = r.author_id === S.me.id;
  const thumb = photos[0] ? photoUrl(thumbOf(photos[0])) : r.image_url;
  // 링크만 있는 카드는 원문으로 바로, 사진·메모가 있는 카드는 상세로
  const external = r.url && !photos.length;
  const href = external ? safeHref(r.url) : `#/refs/${r.id}`;
  const badge = external ? '원문 ↗' : photos.length ? `사진 ${photos.length}장 ›` : '자세히 ›';
  return `<article class="ref">
    <a class="ref-link" href="${esc(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>
      <div class="thumb">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback="${initial}">` : initial}</div>
      <div class="ref-body">
        <div class="ref-title">${esc(r.title || r.url || '제목 없음')}</div>
        ${r.summary ? `<div class="ref-sum">${esc(r.summary)}</div>` : ''}
        ${tags.length ? `<div class="tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
        <div class="meta"><span>${esc(person(r.author_id).name)} · ${fmtDate(r.created_at)}${r.site_name ? ` · ${esc(r.site_name)}` : ''}</span><b>${badge}</b></div>
      </div>
    </a>
    ${mine ? `<a class="ref-more" href="#/refs/${r.id}/edit" aria-label="수정">${ICON.more()}</a>` : ''}
  </article>`;
}

async function refDetail(id) {
  setView(`<div class="bar"><a class="icon-btn" href="#/refs" aria-label="뒤로">${ICON.back()}</a></div><div class="loading">불러오는 중…</div>`);
  const { data: r, error } = await sb.from('refs').select('*').eq('id', id).single();
  if (error || !r) { toast('레퍼런스를 찾을 수 없습니다.'); location.hash = '#/refs'; return; }
  const photos = r.photos || [];
  const tags = [...(r.industry || []), ...(r.types || [])];
  const hero = photos[0] ? photoUrl(photos[0]) : r.image_url;
  const mine = r.author_id === S.me.id;
  setView(`<div class="bar"><a class="icon-btn" href="#/refs" aria-label="뒤로">${ICON.back()}</a>
      ${mine ? `<a class="icon-btn" href="#/refs/${id}/edit" aria-label="수정">${ICON.more()}</a>` : ''}</div>
    <article class="detail" style="padding-bottom:calc(110px + var(--safe-b))">
      ${hero ? `<button class="hero d-img" style="border-radius:0;display:block" data-full="${esc(hero)}"><img src="${esc(hero)}" alt="" referrerpolicy="no-referrer" data-fallback=""></button>` : ''}
      <div class="d-body">
        ${tags.length ? `<div class="tags">${tags.map(t => `<span class="tag d-tag" style="align-self:auto">${esc(t)}</span>`).join('')}</div>` : ''}
        <h1 style="font-size:21px;line-height:1.4">${esc(r.title || '제목 없음')}</h1>
        <div class="author">${avatar(r.author_id)}<div><div class="a-name">${esc(person(r.author_id).name)}</div>
          <div class="a-sub">${fmtDate(r.created_at)}${r.site_name ? ` · ${esc(r.site_name)}` : ''}</div></div></div>
        ${r.summary ? `<p class="d-text">${esc(r.summary)}</p>` : ''}
        ${photos.slice(1).map(p => `<button class="d-img" data-full="${esc(photoUrl(p))}"><img src="${esc(photoUrl(p))}" alt="" loading="lazy" data-fallback=""></button>`).join('')}
      </div>
    </article>
    ${r.url ? `<div class="bottom-cta"><a class="cta" style="text-decoration:none" href="${esc(safeHref(r.url))}" target="_blank" rel="noopener noreferrer">원문 보기 ↗</a></div>` : ''}`);
  $$('[data-full]').forEach(b => b.onclick = () => openViewer(b.dataset.full));
}

async function refForm(id, presetUrl = '') {
  const st = {
    url: presetUrl, title: '', summary: '', image: '', site: '', photos: [], industry: new Set(), types: new Set(),
    busy: false, uploading: 0, fresh: new Set(), original: [], auto: { title: '', summary: '' }, aiNote: '',
  };
  if (id) {
    const { data, error } = await sb.from('refs').select('*').eq('id', id).single();
    if (error || !data) { toast('레퍼런스를 찾을 수 없습니다.'); location.hash = '#/refs'; return; }
    if (data.author_id !== S.me.id) { toast('본인이 등록한 레퍼런스만 수정할 수 있습니다.'); location.hash = '#/refs'; return; }
    Object.assign(st, {
      url: data.url || '', title: data.title || '', summary: data.summary || '', image: data.image_url || '', site: data.site_name || '',
      photos: (data.photos || []).map(path => ({ path })), industry: new Set(data.industry), types: new Set(data.types),
    });
    st.original = [...(data.photos || [])];
  }
  const back = id ? `#/refs/${id}` : '#/refs';

  setView(`<div class="bar"><button class="icon-btn" id="back" aria-label="뒤로">${ICON.back()}</button><div class="bar-t">${id ? '레퍼런스 수정' : '레퍼런스 등록'}</div><div style="width:44px"></div></div>
    <div class="form">
      <div>
        <label class="lbl" for="url">링크 <span>· 선택</span></label>
        <div style="display:flex;gap:8px"><input class="inp" id="url" type="url" inputmode="url" placeholder="https:// 링크를 붙여넣으세요" value="${esc(st.url)}" style="flex:1;min-width:0">
        <button class="btn-dark" id="fetch">불러오기</button></div>
        <div id="dup" style="margin-top:8px" hidden></div>
        <p class="note" style="margin-top:8px">링크를 붙여넣으면 대표 이미지·제목·요약을 자동으로 채웁니다. 링크 없이 사진과 내용만 올려도 됩니다.</p>
      </div>
      <div id="pv"></div>
      <div>
        <div class="lbl">사진 <span>· 선택 · 최대 ${MAX_REF_PHOTOS}장 · 눌러서 대표 지정</span></div>
        <div class="grid4" id="phs"></div>
        <input id="rfiles" type="file" accept="image/*" multiple class="sr">
      </div>
      <div><label class="lbl" for="title">제목</label><input class="inp" id="title" maxlength="200" placeholder="무엇에 관한 레퍼런스인가요?" value="${esc(st.title)}"></div>
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <label for="sum" class="lbl" style="margin:0">요약·내용 <span>· 직접 수정 가능</span></label>
          <button class="link-btn" id="regen" hidden>AI로 다시 요약</button></div>
        <textarea class="ta" id="sum" rows="3" placeholder="좋았던 점, 참고할 포인트를 적어주세요.">${esc(st.summary)}</textarea>
        <div id="aiNote"></div>
      </div>
      <div id="tagbox"></div>
      ${id ? '<button class="danger-btn" id="del">이 레퍼런스 삭제</button>' : quietRow('rquiet')}
    </div>
    <div class="bottom-cta"><button class="cta" id="save">${id ? '수정 완료' : '저장하기'}</button></div>`);

  const sum = $('#sum');
  const growSum = () => { sum.style.height = 'auto'; sum.style.height = (sum.scrollHeight + 2) + 'px'; };
  sum.oninput = () => { st.summary = sum.value; growSum(); };
  $('#title').oninput = (e) => { st.title = e.target.value; };
  const syncSave = () => { $('#save').disabled = st.busy || st.uploading > 0; };

  const drawPreview = () => {
    $('#regen').hidden = !st.url || st.busy;
    $('#aiNote').innerHTML = st.aiNote ? `<p class="note" style="margin-top:6px">${esc(st.aiNote)}</p>` : '';
    if (st.busy) {
      $('#pv').innerHTML = `<div class="preview"><div class="preview-img skel" style="border-radius:0"></div><div class="preview-body"><div class="skel" style="height:18px;width:80%"></div><div class="skel" style="height:40px"></div>
        <p class="note">${isYouTube(st.url) ? '영상 내용을 보고 요약하는 중입니다. 30초 정도 걸릴 수 있어요…' : '링크를 읽고 요약하는 중입니다…'}</p></div></div>`;
      return;
    }
    if (!st.url && !st.image) { $('#pv').innerHTML = ''; return; }
    $('#pv').innerHTML = `<div class="preview">
      <div class="preview-img">${st.image ? `<img src="${esc(st.image)}" alt="" referrerpolicy="no-referrer" data-fallback="">` : '링크 대표 이미지 없음'}</div>
      <div class="preview-body" style="gap:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin:-4px 0">
          <span class="note">${esc(st.site)}${st.photos.length ? ' · 카드에는 올린 사진이 먼저 보입니다' : ''}</span><button class="link-btn" id="imgEdit">이미지 주소 변경</button></div>
        <input class="inp" id="imgUrl" placeholder="이미지 주소(https://…), 비우면 이미지 없음" value="${esc(st.image)}" hidden>
      </div></div>`;
    $('#imgEdit').onclick = () => { const i = $('#imgUrl'); i.hidden = !i.hidden; if (!i.hidden) i.focus(); };
    $('#imgUrl').onchange = (e) => { st.image = e.target.value.trim(); drawPreview(); };
  };

  const drawPhotos = () => {
    $('#phs').innerHTML = (st.photos.length < MAX_REF_PHOTOS ? `<label class="ph addph" for="rfiles">${ICON.camera()}추가</label>` : '') +
      st.photos.map((p, i) => `<div class="ph${i === 0 ? ' cover' : ''}${p.path ? '' : ' up'}">
        <button class="ph-img" data-pick="${i}" aria-label="${i === 0 ? '대표 사진' : '대표로 지정'}"><img src="${esc(p.local || photoUrl(thumbOf(p.path)))}" alt=""></button>
        ${i === 0 ? '<span class="c">대표</span>' : ''}
        ${p.error ? '<span class="c" style="background:var(--danger)">실패</span>' : ''}
        <button class="ph-rm" data-rm="${i}" aria-label="사진 삭제">${ICON.close('#fff')}</button></div>`).join('');
    $$('#phs [data-pick]').forEach(b => b.onclick = () => { const i = +b.dataset.pick; if (i) { st.photos.unshift(...st.photos.splice(i, 1)); drawPhotos(); } });
    $$('#phs [data-rm]').forEach(b => b.onclick = () => {
      const [p] = st.photos.splice(+b.dataset.rm, 1);
      if (p.path && st.fresh.has(p.path)) { removePhotos([p.path]); st.fresh.delete(p.path); }
      drawPhotos();
    });
    syncSave();
  };

  $('#rfiles').onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    const room = MAX_REF_PHOTOS - st.photos.length;
    if (room <= 0) return toast(`사진은 최대 ${MAX_REF_PHOTOS}장까지 올릴 수 있습니다.`);
    if (files.length > room) toast(`최대 ${MAX_REF_PHOTOS}장까지라 ${room}장만 추가했습니다.`);
    const picked = files.slice(0, room).map(f => ({ path: null, local: URL.createObjectURL(f), file: f }));
    st.photos.push(...picked);
    st.uploading += picked.length;
    drawPhotos();
    for (const p of picked) {
      try { p.path = await uploadPhoto(p.file); st.fresh.add(p.path); }
      catch (err) { console.error(err); p.error = true; }
      st.uploading--;
      if (!st.photos.includes(p) && p.path) { removePhotos([p.path]); st.fresh.delete(p.path); }
      drawPhotos();
    }
  };

  const drawTags = () => {
    const group = (kind, key, label) => `<div style="margin-bottom:18px"><div class="lbl">${label} <span>· 중복 선택</span></div><div class="wrap">
      ${S.tags[kind].map(t => `<button class="chip${st[key].has(t) ? ' sel' : ''}" data-k="${key}" data-t="${esc(t)}" aria-pressed="${st[key].has(t)}">${esc(t)}</button>`).join('')}
      <button class="chip add" data-new="${kind}">+ 태그 추가</button></div></div>`;
    $('#tagbox').innerHTML = group('industry', 'industry', '업종') + group('type', 'types', '성격');
    $$('#tagbox [data-t]').forEach(b => b.onclick = () => { const s = st[b.dataset.k]; s.has(b.dataset.t) ? s.delete(b.dataset.t) : s.add(b.dataset.t); drawTags(); });
    $$('#tagbox [data-new]').forEach(b => b.onclick = () => {
      const kind = b.dataset.new;
      const box = document.createElement('span');
      box.className = 'tag-new';
      box.innerHTML = `<input maxlength="20" placeholder="새 태그 이름" aria-label="새 태그 이름"><button class="chip sel">추가</button>`;
      b.replaceWith(box);
      const inp = box.querySelector('input');
      inp.focus();
      const add = async () => {
        const name = inp.value.trim().replace(/^#/, '');
        if (!name) return drawTags();
        if (!S.tags[kind].includes(name)) {
          const { error } = await sb.from('tags').insert({ kind, name, sort: 500 });
          if (error && error.code !== '23505') { toast('태그를 추가하지 못했습니다.'); return; }
          S.tags[kind].push(name);
        }
        st[kind === 'type' ? 'types' : 'industry'].add(name);
        drawTags();
        toast(`'${name}' 태그를 추가했습니다.`);
      };
      box.querySelector('button').onclick = add;
      inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } if (e.key === 'Escape') drawTags(); };
    });
  };

  const checkDup = async (url) => {
    const { data } = await sb.from('refs').select('id,author_id,created_at').eq('url', url).neq('id', id || 0).limit(1);
    const box = $('#dup');
    if (data?.length) { box.hidden = false; box.innerHTML = `<div class="warn">이미 ${esc(person(data[0].author_id).name)}님이 ${fmtDate(data[0].created_at)}에 등록한 링크입니다. 그래도 저장할 수 있습니다.</div>`; }
    else box.hidden = true;
  };

  const fetchPreview = async (onlySummary = false) => {
    const m = $('#url').value.trim().match(/https?:\/\/[^\s<>"']+/);
    if (!m) { toast('https://로 시작하는 링크를 넣어주세요.'); return; }
    const url = m[0];
    $('#url').value = url;
    st.url = url;
    st.busy = true; st.aiNote = '';
    drawPreview(); syncSave();
    if (!onlySummary) checkDup(url);
    try {
      const { data: { session } } = await sb.auth.getSession();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 75000);
      const r = await fetch('/api/preview', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ url, tags: { industry: S.tags.industry, types: S.tags.type } }),
      }).finally(() => clearTimeout(timer));
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || '링크를 불러오지 못했습니다.');
      // 사용자가 직접 고친 칸은 덮어쓰지 않습니다.
      const titleUntouched = !st.title.trim() || st.title === st.auto.title;
      const sumUntouched = onlySummary || !st.summary.trim() || st.summary === st.auto.summary;
      if (!onlySummary) {
        if (titleUntouched && j.title) { st.title = j.title; st.auto.title = j.title; $('#title').value = j.title; }
        if (j.image) st.image = j.image;
        st.site = j.siteName || st.site;
        (j.suggested?.industry || []).forEach(t => st.industry.add(t));
        (j.suggested?.types || []).forEach(t => st.types.add(t));
      }
      if (sumUntouched && j.summary) { st.summary = j.summary; st.auto.summary = j.summary; sum.value = j.summary; growSum(); }
      if (!j.ai) st.aiNote = `AI 요약을 만들지 못해 사이트 설명을 넣었습니다${j.aiError ? ` (${j.aiError})` : ''}. 직접 고쳐주세요.`;
      else if (!j.fetched && !j.summary) st.aiNote = '이 사이트는 내용을 읽을 수 없어요. 제목과 내용을 직접 입력해주세요.';
    } catch (e) {
      st.aiNote = e.name === 'AbortError' ? '응답이 너무 오래 걸려 중단했습니다. 다시 시도하거나 직접 입력해주세요.' : (e.message || '링크를 불러오지 못했습니다. 직접 입력해주세요.');
      try { st.site = st.site || new URL(url).hostname.replace(/^www\./, ''); } catch { /* noop */ }
    }
    st.busy = false;
    drawPreview(); drawTags(); syncSave();
  };

  $('#fetch').onclick = () => fetchPreview();
  $('#regen').onclick = () => fetchPreview(true);
  $('#url').addEventListener('paste', () => setTimeout(() => fetchPreview(), 0));
  $('#url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fetchPreview(); } });
  $('#url').addEventListener('change', (e) => { if (!e.target.value.trim()) { st.url = ''; st.image = ''; st.site = ''; $('#dup').hidden = true; drawPreview(); } });

  $('#back').onclick = () => {
    const dirty = st.fresh.size > 0 || (!id && (st.title.trim() || st.summary.trim() || st.url));
    if (dirty && !confirm('작성 중인 내용을 버리고 나갈까요?')) return;
    removePhotos([...st.fresh]);
    location.hash = back;
  };

  drawPreview(); drawPhotos(); drawTags(); growSum();
  if (presetUrl && !id) fetchPreview();
  cleanups.push(() => st.photos.forEach(p => p.local && URL.revokeObjectURL(p.local)));

  $('#save').onclick = async (e) => {
    if (st.uploading) return toast('사진을 올리는 중입니다. 잠시만 기다려주세요.');
    const url = ($('#url').value.trim().match(/https?:\/\/[^\s<>"']+/) || [''])[0];
    const paths = st.photos.filter(p => p.path).map(p => p.path);
    const title = st.title.trim();
    if (!url && !paths.length && !st.summary.trim()) return toast('링크, 사진, 내용 중 하나는 넣어주세요.');
    if (!title && !url) { toast('제목을 입력해주세요.'); $('#title').focus(); return; }
    e.currentTarget.disabled = true;
    const row = {
      url: url || null, title: title || url, summary: st.summary.trim() || null,
      image_url: url ? (st.image || null) : null, site_name: url ? (st.site || null) : null,
      photos: paths, industry: [...st.industry], types: [...st.types],
    };
    if (!id) row.quiet = !!$('#rquiet')?.checked;
    const res = id ? await sb.from('refs').update(row).eq('id', id).select('id').single() : await sb.from('refs').insert(row).select('id').single();
    if (res.error) {
      e.currentTarget.disabled = false; console.error(res.error);
      return toast(/photos|null value in column "url"/.test(res.error.message || '') ? 'DB 업데이트(SQL)가 아직 적용되지 않았습니다. 관리자에게 알려주세요.' : '저장하지 못했습니다. 다시 시도해주세요.');
    }
    removePhotos(st.original.filter(p => !paths.includes(p)));
    st.fresh.clear();
    if (!id) notifyTeam('ref', res.data.id);
    toast(id ? '수정했습니다.' : row.quiet ? '알림 없이 조용히 저장했습니다.' : '레퍼런스를 저장했습니다.');
    location.hash = '#/refs';
  };
  $('#del')?.addEventListener('click', async () => {
    if (!confirm('이 레퍼런스를 삭제할까요?')) return;
    const { error } = await sb.from('refs').delete().eq('id', id);
    if (error) return toast('삭제하지 못했습니다.');
    removePhotos(st.original);
    st.fresh.size && removePhotos([...st.fresh]);
    toast('삭제했습니다.');
    location.hash = '#/refs';
  });
}

// ───────────────────────── 답사기록 ─────────────────────────
function visitFeed() {
  const f = S.visitFilter;
  const tabs = ['', ...CATS].map(c => `<button class="chip${f === c ? ' on' : ''}" data-cat="${esc(c)}">${c || '전체'}</button>`).join('');
  setView(`${header('답사기록', `<div class="row">${tabs}</div>`)}
    ${topBanner()}
    <div class="feed"><div id="list" style="display:flex;flex-direction:column;gap:16px"></div><div class="sentinel" id="sent"></div></div>
    <a class="fab" href="#/visits/new" aria-label="답사기록 작성">${ICON.pen()}</a>`, { tab: 'visits' });
  bindTopBanner();
  $$('[data-cat]').forEach(b => b.onclick = () => { S.visitFilter = b.dataset.cat; visitFeed(); });
  pager({
    list: $('#list'), sentinel: $('#sent'), size: 12,
    load: (a, b) => {
      let q = sb.from('visit_feed').select('id,category,title,cover_path,created_at').order('created_at', { ascending: false }).range(a, b);
      if (f) q = q.eq('category', f);
      return q;
    },
    render: (v) => `<a class="post" href="#/visits/${v.id}">
      <div class="post-img">${v.cover_path ? `<img src="${esc(photoUrl(thumbOf(v.cover_path)))}" alt="" loading="lazy" data-fallback="">` : ''}<span class="badge">${esc(v.category)}</span></div>
      <div class="post-t">${esc(v.title)}</div></a>`,
    empty: `<div class="empty"><b>${f ? `${esc(f)} 답사기록이 아직 없습니다` : '첫 답사기록을 남겨보세요'}</b>다녀온 부스의 사진을 올리고<br>블로그처럼 후기를 적어 팀과 나눌 수 있습니다.</div>`,
  });
}

async function visitDetail(id) {
  setView(`<div class="bar"><a class="icon-btn" href="#/visits" aria-label="뒤로">${ICON.back()}</a></div><div class="loading">불러오는 중…</div>`);
  const [{ data: v, error }, { data: likes }, { data: comments }] = await Promise.all([
    sb.from('visits').select('*').eq('id', id).single(),
    sb.from('visit_likes').select('user_id').eq('visit_id', id),
    sb.from('visit_comments').select('id,body,author_id,created_at,parent_id').eq('visit_id', id).order('created_at'),
  ]);
  if (error || !v) { toast('답사기록을 찾을 수 없습니다.'); location.hash = '#/visits'; return; }
  const mine = v.author_id === S.me.id;
  const st = { likes: new Set((likes || []).map(l => l.user_id)), comments: comments || [], replyTo: null, quiet: false };

  const blocks = (v.blocks || []).map(b => b.t === 'img'
    ? (b.path === v.cover_path ? '' : `<button class="d-img" data-full="${esc(photoUrl(b.path))}"><img src="${esc(photoUrl(b.path))}" alt="" loading="lazy" data-fallback=""></button>`)
    : (b.v?.trim() ? `<p class="d-text">${esc(b.v.trim())}</p>` : '')).join('');

  setView(`<div class="bar"><a class="icon-btn" href="#/visits" aria-label="뒤로">${ICON.back()}</a>
      ${mine ? `<button class="icon-btn" id="menu" aria-label="더보기">${ICON.more()}</button>` : ''}</div>
    <article class="detail">
      ${v.cover_path ? `<button class="hero d-img" style="border-radius:0;display:block" data-full="${esc(photoUrl(v.cover_path))}"><img src="${esc(photoUrl(v.cover_path))}" alt="" data-fallback=""></button>` : ''}
      <div class="d-body">
        <span class="tag d-tag">${esc(v.category)}</span>
        <h1 style="font-size:21px;line-height:1.4">${esc(v.title)}</h1>
        <div class="author">${avatar(v.author_id)}<div><div class="a-name">${esc(person(v.author_id).name)}</div>
          <div class="a-sub">${[fmtDay(v.visited_on), v.place].filter(Boolean).map(esc).join(' · ') || fmtDate(v.created_at)}</div></div></div>
        ${blocks}
      </div>
      <section class="cmts" id="cmts" aria-label="댓글"></section>
    </article>
    <div class="d-foot"><div class="d-foot-in">
      <div class="likes"><button class="like" id="like"></button>
        <span class="like" style="cursor:default">${ICON.bubble()}<span id="ccount"></span></span>
        <span class="liked-by" id="likedBy"></span></div>
      <div class="replying" id="replying" hidden></div>
      <form class="cin" id="cform"><label for="cmt" class="sr">댓글</label>
        <button type="button" class="cquiet" id="cquiet" aria-pressed="false" aria-label="조용히 남기기" title="조용히 남기기 (알림 없이)">${ICON.bellOff()}</button>
        <input class="inp" id="cmt" placeholder="댓글을 남겨주세요" maxlength="1000" autocomplete="off" style="flex:1;min-width:0">
        <button class="btn-acc" id="csend">등록</button></form>
    </div></div>`);

  const drawLikes = () => {
    const on = st.likes.has(S.me.id);
    const b = $('#like');
    b.className = 'like' + (on ? ' on' : '');
    b.setAttribute('aria-pressed', on);
    b.setAttribute('aria-label', on ? '좋아요 취소' : '좋아요');
    b.innerHTML = `${ICON.heart(on)}${st.likes.size}`;
    const names = [...st.likes].map(u => person(u).name);
    $('#likedBy').textContent = names.length ? (names.length > 2 ? `${names.slice(0, 2).join(', ')} 외 ${names.length - 2}명` : names.join(', ')) + '님이 좋아합니다' : '';
  };
  const drawComments = () => {
    const byId = new Map(st.comments.map(c => [c.id, c]));
    const rootOf = (c) => { let x = c, guard = 0; while (x.parent_id && byId.has(x.parent_id) && guard++ < 30) x = byId.get(x.parent_id); return x; };
    const roots = st.comments.filter(c => !c.parent_id || !byId.has(c.parent_id));
    const one = (c, reply) => {
      const parent = c.parent_id && byId.get(c.parent_id);
      const to = reply && parent && parent.id !== rootOf(c).id ? `<span class="to">${esc(person(parent.author_id).name)}님에게</span>` : '';
      return `<div class="cmt${reply ? ' reply' : ''}" id="c${c.id}">${avatar(c.author_id)}<div class="cmt-main">
        <div class="a-name">${esc(person(c.author_id).name)}<small>${fmtDate(c.created_at)}</small></div>
        <p>${to}${esc(c.body)}</p>
        <div class="cmt-acts"><button class="del" data-reply="${c.id}">답글</button>${c.author_id === S.me.id ? `<button class="del" data-del="${c.id}">삭제</button>` : ''}</div></div></div>`;
    };
    $('#ccount').textContent = st.comments.length;
    $('#cmts').innerHTML = `<div style="font-size:13px;font-weight:600">댓글 ${st.comments.length}</div>` + (roots.length
      ? roots.map(r => one(r, false) + st.comments.filter(c => c !== r && c.parent_id && rootOf(c) === r).map(c => one(c, true)).join('')).join('')
      : '<p class="note">첫 댓글을 남겨보세요.</p>');
    $$('#cmts [data-reply]').forEach(b => b.onclick = () => {
      st.replyTo = byId.get(Number(b.dataset.reply));
      drawReplying();
      $('#cmt').focus();
    });
    $$('#cmts [data-del]').forEach(b => b.onclick = async () => {
      const cid = Number(b.dataset.del);
      const hasKids = st.comments.some(c => c.parent_id === cid);
      if (!confirm(hasKids ? '댓글을 삭제할까요? 달린 답글도 함께 삭제됩니다.' : '댓글을 삭제할까요?')) return;
      const { error } = await sb.from('visit_comments').delete().eq('id', cid);
      if (error) return toast('삭제하지 못했습니다.');
      const gone = new Set([cid]);
      let grew = true;
      while (grew) { grew = false; st.comments.forEach(c => { if (c.parent_id && gone.has(c.parent_id) && !gone.has(c.id)) { gone.add(c.id); grew = true; } }); }
      st.comments = st.comments.filter(c => !gone.has(c.id));
      if (st.replyTo && gone.has(st.replyTo.id)) { st.replyTo = null; drawReplying(); }
      drawComments();
    });
  };
  const drawReplying = () => {
    const box = $('#replying');
    box.hidden = !st.replyTo;
    box.innerHTML = st.replyTo ? `<span><b>${esc(person(st.replyTo.author_id).name)}</b>님에게 답글 남기는 중</span><button type="button" class="link-btn" id="replyX">취소</button>` : '';
    $('#replyX')?.addEventListener('click', () => { st.replyTo = null; drawReplying(); });
    drawCinPlaceholder();
  };
  const drawCinPlaceholder = () => {
    $('#cmt').placeholder = `${st.quiet ? '조용히 ' : ''}${st.replyTo ? '답글을' : '댓글을'} 남겨주세요`;
    const q = $('#cquiet');
    q.classList.toggle('on', st.quiet);
    q.setAttribute('aria-pressed', st.quiet);
  };
  $('#cquiet').onclick = () => { st.quiet = !st.quiet; drawCinPlaceholder(); toast(st.quiet ? '알림 없이 조용히 남깁니다.' : '알림과 함께 남깁니다.'); };
  drawLikes(); drawComments();

  $('#like').onclick = async () => {
    const on = st.likes.has(S.me.id);
    on ? st.likes.delete(S.me.id) : st.likes.add(S.me.id);
    drawLikes();
    const { error } = on
      ? await sb.from('visit_likes').delete().eq('visit_id', id).eq('user_id', S.me.id)
      : await sb.from('visit_likes').insert({ visit_id: id });
    if (error && error.code !== '23505') { on ? st.likes.add(S.me.id) : st.likes.delete(S.me.id); drawLikes(); toast('반영하지 못했습니다.'); }
  };
  $('#cform').onsubmit = async (e) => {
    e.preventDefault();
    const body = $('#cmt').value.trim();
    if (!body) return;
    $('#csend').disabled = true;
    const { data, error } = await sb.from('visit_comments')
      .insert({ visit_id: id, body, parent_id: st.replyTo?.id || null, quiet: st.quiet })
      .select('id,body,author_id,created_at,parent_id').single();
    $('#csend').disabled = false;
    if (error) return toast('댓글을 등록하지 못했습니다.');
    notifyTeam('comment', data.id);
    $('#cmt').value = '';
    st.comments.push(data);
    st.replyTo = null;
    drawReplying();
    drawComments();
    document.getElementById(`c${data.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  $$('[data-full]').forEach(b => b.onclick = () => openViewer(b.dataset.full));
  $('#menu')?.addEventListener('click', () => sheet(`<button data-act="edit">수정하기</button><button data-act="del" class="red">삭제하기</button>`, async (act) => {
    if (act === 'edit') location.hash = `#/visits/${id}/edit`;
    if (act === 'del') {
      if (!confirm('이 답사기록을 삭제할까요? 사진과 댓글도 함께 삭제됩니다.')) return;
      const { error } = await sb.from('visits').delete().eq('id', id);
      if (error) return toast('삭제하지 못했습니다.');
      removePhotos((v.blocks || []).filter(b => b.t === 'img').map(b => b.path));
      toast('삭제했습니다.');
      location.hash = '#/visits';
    }
  }));
}

function removePhotos(paths) {
  const all = paths.filter(Boolean).flatMap(p => [p, thumbOf(p)]);
  if (all.length) sb.storage.from(PHOTO_BUCKET).remove(all).catch(() => {});
}

// 사진 압축 (긴 변 기준)
async function compress(file, maxSide, quality) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    bmp = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = URL.createObjectURL(file); });
  }
  const w = bmp.width, h = bmp.height;
  const k = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error('압축 실패')), 'image/jpeg', quality));
}

async function uploadPhoto(file) {
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  const path = `${S.me.id}/${id}.jpg`;
  const [full, thumb] = await Promise.all([compress(file, 1800, 0.82), compress(file, 720, 0.78)]);
  const bucket = sb.storage.from(PHOTO_BUCKET);
  const opts = { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false };
  const [a, b] = await Promise.all([bucket.upload(path, full, opts), bucket.upload(thumbOf(path), thumb, opts)]);
  if (a.error || b.error) throw a.error || b.error;
  return path;
}

async function visitForm(id) {
  let key = 0;
  const st = { category: '경쟁사', title: '', place: '', visited_on: today(), cover: null, blocks: [{ k: key++, t: 'text', v: '' }], focus: 0, uploading: 0, fresh: new Set(), original: [] };
  if (id) {
    const { data, error } = await sb.from('visits').select('*').eq('id', id).single();
    if (error || !data) { toast('답사기록을 찾을 수 없습니다.'); location.hash = '#/visits'; return; }
    if (data.author_id !== S.me.id) { toast('본인 글만 수정할 수 있습니다.'); location.hash = `#/visits/${id}`; return; }
    Object.assign(st, { category: data.category, title: data.title, place: data.place || '', visited_on: data.visited_on || '', cover: data.cover_path });
    st.blocks = (data.blocks || []).map(b => ({ ...b, k: key++ }));
    if (!st.blocks.length) st.blocks.push({ k: key++, t: 'text', v: '' });
    st.original = st.blocks.filter(b => b.t === 'img').map(b => b.path);
  }
  const back = id ? `#/visits/${id}` : '#/visits';

  setView(`<div class="bar"><button class="icon-btn" id="cancel" aria-label="닫기">${ICON.close()}</button>
      <div class="bar-t">${id ? '답사기록 수정' : '답사기록 작성'}</div><button class="bar-btn" id="save">${id ? '완료' : '등록'}</button></div>
    <div class="form write">
      <div><div class="lbl">구분</div><div class="wrap" id="cats"></div></div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <label for="vt" class="sr">제목</label><input id="vt" class="title-big" maxlength="120" placeholder="제목을 입력하세요" value="${esc(st.title)}">
        <div class="two">
          <div><label for="vp" class="sr">장소</label><input id="vp" class="inp" placeholder="장소 (예: 코엑스 B홀)" value="${esc(st.place)}"></div>
          <div><label for="vd" class="sr">답사일</label><input id="vd" class="inp" type="date" value="${esc(st.visited_on)}"></div>
        </div>
      </div>
      <div>
        <div class="lbl" style="display:flex;justify-content:space-between"><span style="color:inherit;font-weight:600">본문</span><span>사진의 ‘대표’를 눌러 피드 대표사진 지정</span></div>
        <div class="blocks" id="blocks"></div>
      </div>
      ${id ? '' : quietRow('vquiet')}
    </div>
    <div class="toolbar"><div class="toolbar-in">
      <label class="tool" for="files">${ICON.camera()}사진 추가</label>
      <input id="files" type="file" accept="image/*" multiple class="sr">
      <button class="tool" id="addText">${ICON.text()}글 추가</button>
      <span class="count" id="count"></span>
    </div></div>`);

  const drawCats = () => {
    $('#cats').innerHTML = CATS.map(c => `<button class="chip${st.category === c ? ' sel' : ''}" data-c="${c}" aria-pressed="${st.category === c}">${c}</button>`).join('');
    $$('#cats [data-c]').forEach(b => b.onclick = () => { st.category = b.dataset.c; drawCats(); });
  };
  const imgs = () => st.blocks.filter(b => b.t === 'img');
  const grow = (ta) => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };

  const drawBlocks = () => {
    // 다시 그려도 쓰던 위치를 유지
    const act = document.activeElement;
    const keep = act?.classList?.contains('blk-text') ? { id: act.id, s: act.selectionStart, e: act.selectionEnd } : null;
    const firstImg = imgs().find(b => b.path)?.path || null;
    if (!st.cover || !imgs().some(b => b.path === st.cover)) st.cover = firstImg;
    $('#blocks').innerHTML = st.blocks.map((b, i) => b.t === 'text'
      ? `<div class="blk-row"><label class="sr" for="t${b.k}">글</label><textarea class="blk-text" id="t${b.k}" data-i="${i}" placeholder="${i === 0 ? '부스 구성, 고객 동선, 굿즈·이벤트, 우리가 참고할 점을 자유롭게 기록하세요.' : '이어서 쓰기'}">${esc(b.v)}</textarea>
          ${st.blocks.length > 1 ? `<button class="x" data-rm="${i}" aria-label="글 블록 삭제">${ICON.trash()}</button>` : ''}</div>`
      : `<div class="blk-img${b.path ? '' : ' up'}">
          <img src="${esc(b.local || photoUrl(thumbOf(b.path)))}" alt="">
          ${b.path ? `<button class="blk-cover${st.cover === b.path ? ' on' : ''}" data-cover="${i}">${st.cover === b.path ? '대표사진' : '대표로 지정'}</button>` : ''}
          <div class="blk-tools">
            ${i > 0 ? `<button data-up="${i}" aria-label="위로">${ICON.up()}</button>` : ''}
            ${i < st.blocks.length - 1 ? `<button data-down="${i}" aria-label="아래로">${ICON.down()}</button>` : ''}
            <button data-rm="${i}" aria-label="사진 삭제">${ICON.close('#fff')}</button>
          </div>
          ${b.error ? '<span class="blk-state">업로드 실패 · 삭제 후 다시 추가해주세요</span>' : (b.path ? '' : '<span class="blk-state">올리는 중…</span>')}
        </div>`).join('');
    $$('#blocks .blk-text').forEach(ta => {
      grow(ta);
      ta.oninput = () => { st.blocks[+ta.dataset.i].v = ta.value; grow(ta); };
      ta.onfocus = () => { st.focus = +ta.dataset.i; };
    });
    $$('#blocks [data-rm]').forEach(b => b.onclick = () => {
      const i = +b.dataset.rm, blk = st.blocks[i];
      if (blk.t === 'text' && blk.v.trim() && !confirm('이 글을 삭제할까요?')) return;
      if (blk.t === 'img' && blk.path && st.fresh.has(blk.path)) { removePhotos([blk.path]); st.fresh.delete(blk.path); }
      st.blocks.splice(i, 1);
      if (!st.blocks.length) st.blocks.push({ k: key++, t: 'text', v: '' });
      mergeTexts(); drawBlocks();
    });
    $$('#blocks [data-up]').forEach(b => b.onclick = () => { const i = +b.dataset.up; [st.blocks[i - 1], st.blocks[i]] = [st.blocks[i], st.blocks[i - 1]]; drawBlocks(); });
    $$('#blocks [data-down]').forEach(b => b.onclick = () => { const i = +b.dataset.down; [st.blocks[i + 1], st.blocks[i]] = [st.blocks[i], st.blocks[i + 1]]; drawBlocks(); });
    $$('#blocks [data-cover]').forEach(b => b.onclick = () => { st.cover = st.blocks[+b.dataset.cover].path; drawBlocks(); });
    const n = imgs().length;
    $('#count').innerHTML = `사진 <b>${n}</b> / ${MAX_PHOTOS}`;
    $('#save').disabled = st.uploading > 0;
    if (keep) { const el = document.getElementById(keep.id); if (el) { el.focus({ preventScroll: true }); el.setSelectionRange(keep.s, keep.e); } }
  };
  // 연속된 빈 글 블록 정리
  const mergeTexts = () => {
    st.blocks = st.blocks.filter((b, i, a) => !(b.t === 'text' && !b.v.trim() && a[i - 1]?.t === 'text'));
  };

  $('#vt').oninput = (e) => { st.title = e.target.value; };
  $('#vp').oninput = (e) => { st.place = e.target.value; };
  $('#vd').oninput = (e) => { st.visited_on = e.target.value; };
  $('#addText').onclick = () => {
    st.blocks.push({ k: key++, t: 'text', v: '' });
    drawBlocks();
    const tas = $$('#blocks .blk-text');
    tas[tas.length - 1]?.focus();
  };
  $('#files').onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    const room = MAX_PHOTOS - imgs().length;
    if (room <= 0) return toast(`사진은 최대 ${MAX_PHOTOS}장까지 올릴 수 있습니다.`);
    if (files.length > room) toast(`최대 ${MAX_PHOTOS}장까지라 ${room}장만 추가했습니다.`);
    const picked = files.slice(0, room).map(f => ({ k: key++, t: 'img', path: null, local: URL.createObjectURL(f), file: f }));
    // 마지막으로 쓰던 글 블록 뒤에 넣고, 이어서 쓸 글 블록을 붙입니다.
    let at = Math.min(st.focus, st.blocks.length - 1) + 1;
    const cur = st.blocks[at - 1];
    if (cur?.t === 'text' && !cur.v.trim() && st.blocks.length === 1) at = 0;
    st.blocks.splice(at, 0, ...picked);
    if (st.blocks[at + picked.length]?.t !== 'text') st.blocks.splice(at + picked.length, 0, { k: key++, t: 'text', v: '' });
    st.focus = at + picked.length;
    mergeTexts();
    st.uploading += picked.length;
    drawBlocks();
    for (const blk of picked) {
      try {
        blk.path = await uploadPhoto(blk.file);
        st.fresh.add(blk.path);
      } catch (err) {
        console.error(err);
        blk.error = true;
      }
      st.uploading--;
      if (!st.blocks.includes(blk) && blk.path) { removePhotos([blk.path]); st.fresh.delete(blk.path); }
      drawBlocks();
    }
  };

  $('#cancel').onclick = () => {
    const dirty = st.fresh.size > 0 || (!id && (st.title.trim() || st.blocks.some(b => b.t === 'text' && b.v.trim())));
    if (dirty && !confirm('작성 중인 내용을 버리고 나갈까요?')) return;
    removePhotos([...st.fresh]);
    location.hash = back;
  };

  $('#save').onclick = async (e) => {
    if (st.uploading) return toast('사진을 올리는 중입니다. 잠시만 기다려주세요.');
    if (!st.title.trim()) { toast('제목을 입력해주세요.'); $('#vt').focus(); return; }
    const blocks = st.blocks
      .filter(b => (b.t === 'img' && b.path) || (b.t === 'text' && b.v.trim()))
      .map(b => b.t === 'img' ? { t: 'img', path: b.path } : { t: 'text', v: b.v.trim() });
    const paths = blocks.filter(b => b.t === 'img').map(b => b.path);
    const row = { category: st.category, title: st.title.trim(), place: st.place.trim() || null, visited_on: st.visited_on || null, blocks, cover_path: paths.includes(st.cover) ? st.cover : (paths[0] || null) };
    if (!id) row.quiet = !!$('#vquiet')?.checked;
    e.currentTarget.disabled = true;
    const res = id ? await sb.from('visits').update(row).eq('id', id).select('id').single() : await sb.from('visits').insert(row).select('id').single();
    if (res.error) { e.currentTarget.disabled = false; console.error(res.error); return toast('저장하지 못했습니다. 다시 시도해주세요.'); }
    removePhotos(st.original.filter(p => !paths.includes(p)));
    st.fresh.clear();
    if (!id) notifyTeam('visit', res.data.id);
    toast(id ? '수정했습니다.' : row.quiet ? '알림 없이 조용히 등록했습니다.' : '답사기록을 등록했습니다.');
    location.hash = `#/visits/${res.data.id}`;
  };

  drawCats(); drawBlocks();
  cleanups.push(() => { st.blocks.forEach(b => b.local && URL.revokeObjectURL(b.local)); });
}

// ───────────────────────── 내 정보 · 설치 안내 ─────────────────────────
function mePage() {
  const members = [...S.people.values()];
  setView(`<div class="bar"><a class="icon-btn" href="#/refs" aria-label="뒤로">${ICON.back()}</a><div class="bar-t">내 정보</div><div style="width:44px"></div></div>
    <div class="me">
      <div class="card"><div class="me-row">${avatar(S.me.id)}<div><div style="font-size:17px;font-weight:700">${esc(S.me.name)}</div><div class="note">${esc(S.me.email)}</div></div></div></div>
      <div class="card"><div class="lbl" style="margin:0">함께 쓰는 팀원 ${members.length}명</div>
        <div class="members">${members.map(p => `<span class="tag" style="font-size:12px">${esc(p.name)}</span>`).join('')}</div></div>
      <div class="card"><div class="lbl" style="margin:0">알림</div><div id="notifBody"><p class="note">불러오는 중…</p></div></div>
      <div class="card" style="padding:4px 16px">
        <button class="list-btn" id="how">홈 화면에 앱으로 추가하는 방법 <span class="note">›</span></button>
        <button class="list-btn" id="logout" style="color:var(--danger)">로그아웃</button>
      </div>
      <p class="note" style="text-align:center"><span class="serif" style="font-size:15px">Brand Scrapbook</span> · 브랜드전략팀</p>
    </div>`);
  $('#how').onclick = showInstallHelp;
  drawNotifSettings();
  $('#logout').onclick = async () => { if (!confirm('로그아웃할까요?')) return; await disablePush().catch(() => {}); await sb.auth.signOut(); entered = false; S.session = null; showLogin(); };
}

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });

function installBanner() {
  if (isStandalone() || store.get('installHidden') === '1') return '';
  return `<div class="install" id="inst"><span>홈 화면에 추가하면 <b>앱처럼</b> 바로 열 수 있어요.</span>
    <button class="go" id="instGo">방법 보기</button><button class="x" id="instX" aria-label="닫기">${ICON.close()}</button></div>`;
}
function bindInstall() {
  $('#instGo')?.addEventListener('click', async () => {
    if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice.catch(() => {}); deferredPrompt = null; return; }
    showInstallHelp();
  });
  $('#instX')?.addEventListener('click', () => { store.set('installHidden', '1'); $('#inst')?.remove(); });
}
function showInstallHelp() {
  const inApp = /KAKAOTALK|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent);
  sheet(isIOS()
    ? `<h3>아이폰에서 추가하기</h3><p>${inApp ? '지금은 카카오톡 안에서 열려 있어요. 오른쪽 아래 <b>⋯ → 다른 브라우저로 열기</b>로 사파리에서 연 뒤 진행해주세요.<br><br>' : ''}1. 사파리 아래쪽 <b>공유 버튼(□↑)</b>을 누릅니다.<br>2. <b>홈 화면에 추가</b>를 누릅니다.<br>3. 홈 화면의 스크랩북 아이콘으로 열면 앱처럼 쓸 수 있습니다.</p><button data-act="ok">확인</button>`
    : `<h3>안드로이드에서 추가하기</h3><p>${inApp ? '지금은 카카오톡 안에서 열려 있어요. 오른쪽 위 <b>⋮ → 다른 브라우저로 열기</b>로 크롬에서 연 뒤 진행해주세요.<br><br>' : ''}1. 크롬 오른쪽 위 <b>⋮ 메뉴</b>를 누릅니다.<br>2. <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 누릅니다.<br>3. 설치 후에는 카톡에서 링크를 <b>공유 → 스크랩북</b>으로 바로 보낼 수 있습니다.</p><button data-act="ok">확인</button>`);
}

// ───────────────────────── 알림 ─────────────────────────
// 업무시간: 평일 09:00~19:00 (한국 시간). 그 밖에 올린 글의 알림은 다음 평일 오전 9시에 모아서 갑니다.
function isBusinessHours(date = new Date()) {
  const kst = new Date(date.getTime() + 9 * 3600e3);
  const day = kst.getUTCDay(), hour = kst.getUTCHours();
  return day >= 1 && day <= 5 && hour >= 9 && hour < 19;
}

function quietRow(id) {
  return `<div class="quiet-box">
    <label class="set-row" for="${id}"><span><b>조용히 올리기</b><small>팀원에게 푸시 알림 없이 올립니다. 알림함에는 표시돼요.</small></span>
      <input type="checkbox" id="${id}" class="switch"></label>
    ${isBusinessHours() ? '' : '<p class="note" style="margin-top:8px">지금은 업무시간 외라, 알림은 다음 평일 오전 9시에 모아서 전달됩니다.</p>'}
  </div>`;
}

// 글·댓글을 올린 뒤 서버에 알림 발송을 요청 (실패해도 등록에는 영향 없음)
async function notifyTeam(type, id) {
  try {
    const { data: { session } } = await sb.auth.getSession();
    await fetch('/api/notify', {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ type, id }),
    });
  } catch { /* noop */ }
}

const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const b64ToBytes = (s) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};
async function saveSub(sub) {
  const j = sub.toJSON();
  return sb.from('push_subscriptions').upsert(
    { user_id: S.me.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, ua: navigator.userAgent.slice(0, 200) },
    { onConflict: 'endpoint' },
  );
}
async function currentSub() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? '알림이 차단되어 있어요. 휴대폰 설정에서 이 앱의 알림을 허용해주세요.' : '알림 허용이 필요합니다.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) }));
  const { error } = await saveSub(sub);
  if (error) throw new Error('알림 등록을 저장하지 못했습니다.');
}
async function disablePush() {
  const sub = await currentSub();
  if (!sub) return;
  await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe().catch(() => {});
}
function pushBlockedReason() {
  if (!pushSupported()) {
    return isIOS() && !isStandalone()
      ? '아이폰은 홈 화면에 추가한 스크랩북 앱에서 알림을 켤 수 있어요.'
      : '이 브라우저에서는 푸시 알림을 받을 수 없어요. 홈 화면에 추가한 앱이나 크롬에서 열어주세요.';
  }
  if (Notification.permission === 'denied') return '알림이 차단되어 있어요. 휴대폰 설정 > 알림에서 스크랩북을 허용해주세요.';
  return '';
}

async function refreshBell() {
  try {
    const { count } = await sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
    S.unread = count || 0;
  } catch { /* noop */ }
  const el = document.getElementById('bellBadge');
  if (el) { el.hidden = !S.unread; el.textContent = S.unread > 99 ? '99+' : String(S.unread); }
  try {
    if (S.unread && navigator.setAppBadge) navigator.setAppBadge(S.unread);
    else if (navigator.clearAppBadge) navigator.clearAppBadge();
  } catch { /* noop */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.session) refreshBell(); });

function alertText(n) {
  const who = `<b>${esc(person(n.actor_id).name)}</b>님이`;
  switch (n.kind) {
    case 'new_ref': return { html: `${who} 새 레퍼런스를 올렸어요`, url: `#/refs/${n.ref_id}` };
    case 'new_visit': return { html: `${who} 새 답사기록을 올렸어요`, url: `#/visits/${n.visit_id}` };
    case 'comment': return { html: `${who} 내 답사기록에 댓글을 남겼어요`, url: `#/visits/${n.visit_id}` };
    case 'reply': return { html: `${who} 내 댓글에 답글을 남겼어요`, url: `#/visits/${n.visit_id}` };
    default: return { html: '새 소식이 있어요', url: '#/refs' };
  }
}

async function alertsPage() {
  setView(`<div class="bar"><a class="icon-btn" href="#/refs" aria-label="뒤로">${ICON.back()}</a><div class="bar-t">알림</div>
      <button class="link-btn" id="readAll" style="margin-right:8px">모두 읽음</button></div>
    <div class="alerts" id="alerts"><div class="loading">불러오는 중…</div></div>`);
  const draw = async () => {
    const { data, error } = await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(60);
    if (error) { $('#alerts').innerHTML = '<div class="loading">알림을 불러오지 못했습니다.</div>'; return; }
    $('#readAll').hidden = !(data || []).some(n => !n.read_at);
    $('#alerts').innerHTML = (data || []).length
      ? data.map(n => {
        const t = alertText(n);
        return `<a class="alert${n.read_at ? '' : ' unread'}" href="${t.url}" data-id="${n.id}">
          ${avatar(n.actor_id)}
          <div class="alert-main"><p>${t.html}</p>${n.text ? `<span class="alert-snip">${esc(n.text)}</span>` : ''}
            <small>${fmtDate(n.created_at)}${n.quiet ? ' · 조용히 올림' : ''}</small></div>
          ${n.read_at ? '' : '<span class="dot" aria-label="읽지 않음"></span>'}</a>`;
      }).join('') + '<p class="note" style="text-align:center;padding:20px 0">최근 60개까지 보여드려요 · <a href="#/me">알림 설정</a></p>'
      : `<div class="empty"><b>아직 알림이 없어요</b>팀원이 새 글을 올리거나 내 글에 댓글이 달리면<br>여기에 모아서 보여드려요.<a class="link-btn" href="#/me">알림 설정 보기</a></div>`;
    $$('#alerts [data-id]').forEach(a => a.addEventListener('click', () => {
      sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', Number(a.dataset.id)).is('read_at', null).then(() => refreshBell());
    }));
  };
  $('#readAll').onclick = async () => {
    await sb.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
    await draw();
    refreshBell();
  };
  await draw();
}

async function drawNotifSettings() {
  const box = document.getElementById('notifBody');
  if (!box) return;
  const blocked = pushBlockedReason();
  let subscribed = false;
  try { subscribed = !blocked && Notification.permission === 'granted' && !!(await currentSub()); } catch { /* noop */ }
  const { data } = await sb.from('notify_prefs').select('*').eq('user_id', S.me.id).limit(1);
  const pref = { new_posts: true, reactions: true, ...(data?.[0] || {}) };
  box.innerHTML = `
    <label class="set-row" for="pushSw"><span><b>이 기기로 푸시 알림 받기</b><small>${blocked ? esc(blocked) : '잠금화면에 알림이 떠요. 기기마다 따로 켭니다.'}</small></span>
      <input type="checkbox" id="pushSw" class="switch" ${subscribed ? 'checked' : ''} ${blocked ? 'disabled' : ''}></label>
    <label class="set-row" for="pfNew"><span><b>새 레퍼런스·답사기록</b><small>팀원이 새 글을 올렸을 때</small></span>
      <input type="checkbox" id="pfNew" class="switch" ${pref.new_posts ? 'checked' : ''}></label>
    <label class="set-row" for="pfReact"><span><b>내 글 댓글 · 내 댓글 답글</b><small>내 답사기록에 댓글, 내 댓글에 답글이 달렸을 때</small></span>
      <input type="checkbox" id="pfReact" class="switch" ${pref.reactions ? 'checked' : ''}></label>
    <p class="note" style="margin-top:10px">업무시간(평일 9~19시) 외에 올라온 글은 다음 평일 오전 9시에 모아서 알려드려요. 조용히 올린 글은 알림함에만 표시됩니다.</p>`;
  $('#pushSw').onchange = async (e) => {
    const on = e.target.checked;
    e.target.disabled = true;
    try {
      if (on) { await enablePush(); toast('이 기기에서 알림을 받습니다.'); }
      else { await disablePush(); toast('이 기기의 알림을 껐습니다.'); }
    } catch (err) {
      e.target.checked = !on;
      toast(err.message || '알림 설정을 바꾸지 못했습니다.');
    }
    e.target.disabled = false;
  };
  const savePref = async () => {
    const row = { user_id: S.me.id, new_posts: $('#pfNew').checked, reactions: $('#pfReact').checked, updated_at: new Date().toISOString() };
    const { error } = await sb.from('notify_prefs').upsert(row, { onConflict: 'user_id' });
    toast(error ? '설정을 저장하지 못했습니다.' : '알림 설정을 저장했습니다.');
  };
  $('#pfNew').onchange = savePref;
  $('#pfReact').onchange = savePref;
}

function topBanner() {
  if (!isStandalone()) return installBanner();
  if (pushSupported() && Notification.permission === 'default' && store.get('pushAskHidden') !== '1') {
    return `<div class="install" id="pushAsk"><span>새 글과 내 글 댓글을 <b>알림</b>으로 받아보세요.</span>
      <button class="go" id="pushGo">알림 켜기</button><button class="x" id="pushX" aria-label="닫기">${ICON.close()}</button></div>`;
  }
  return '';
}
function bindTopBanner() {
  bindInstall();
  $('#pushGo')?.addEventListener('click', async () => {
    try { await enablePush(); toast('알림을 켰습니다. 내 정보에서 언제든 바꿀 수 있어요.'); $('#pushAsk')?.remove(); }
    catch (err) { toast(err.message || '알림을 켜지 못했습니다.'); }
  });
  $('#pushX')?.addEventListener('click', () => { store.set('pushAskHidden', '1'); $('#pushAsk')?.remove(); });
}

// ───────────────────────── 시작 ─────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  // 알림을 눌렀을 때 이미 열린 앱이면 그 화면으로 이동
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'open' && e.data.url) { const u = new URL(e.data.url); location.hash = u.hash || '#/alerts'; }
  });
}

(async () => {
  // 공유로 들어온 링크는 로그인 후에 이어서 처리
  captureShare();
  const { data: { session } } = await sb.auth.getSession();
  if (session) await enter(session); else showLogin();
  sb.auth.onAuthStateChange((event, s) => {
    if (event === 'SIGNED_IN' && s && !entered) enter(s);
    if (event === 'TOKEN_REFRESHED' && s) S.session = s;
    if (event === 'SIGNED_OUT') { entered = false; S.session = null; showLogin(); }
  });
})();
