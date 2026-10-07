// Supabase 라이브러리는 /vendor/supabase.js(공식 배포본 2.45.4)를 index.html에서 먼저 불러옵니다.
const { createClient } = window.supabase;
import { SUPABASE_URL, SUPABASE_ANON_KEY, PHOTO_BUCKET, MAX_PHOTOS } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// ───────────────────────── 공통 상태 · 유틸 ─────────────────────────
const S = { session: null, me: null, people: new Map(), tags: { industry: [], type: [] }, refFilter: { ind: '', type: '' }, visitFilter: '' };
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
}

function header(title, extra = '') {
  return `<header class="hdr">
    <div class="hdr-top">
      <div><div class="eyebrow">브랜드전략팀 · <span class="serif">Brand Scrapbook</span></div><h1>${esc(title)}</h1></div>
      <a class="me-btn" href="#/me" aria-label="내 정보">${S.me?.avatar_url ? `<img src="${esc(S.me.avatar_url)}" alt="" referrerpolicy="no-referrer" data-fallback="${esc(initialOf(S.me.name))}">` : esc(initialOf(S.me?.name))}</a>
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
  if (p[0] === 'visits' && p[1] === 'new') return visitForm(null);
  if (p[0] === 'visits' && p[2] === 'edit') return visitForm(Number(p[1]));
  if (p[0] === 'visits' && p[1]) return visitDetail(Number(p[1]));
  if (p[0] === 'visits') return visitFeed();
  if (p[0] === 'me') return mePage();
  return refFeed();
}
window.addEventListener('hashchange', route);

// ───────────────────────── 레퍼런스 ─────────────────────────
function refFeed() {
  const f = S.refFilter;
  const ind = ['', ...S.tags.industry].map(t => `<button class="chip${f.ind === t ? ' on' : ''}" data-ind="${esc(t)}">${t ? esc(t) : '전체'}</button>`).join('');
  const typ = ['', ...S.tags.type].map(t => `<button class="chip2${f.type === t ? ' on' : ''}" data-type="${esc(t)}">${t ? esc(t) : '전체'}</button>`).join('');
  setView(`${header('레퍼런스', `<div class="row" aria-label="업종">${ind}</div><div class="row" aria-label="성격">${typ}</div>`)}
    ${installBanner()}
    <div class="feed"><div id="list" style="display:flex;flex-direction:column;gap:12px"></div><div class="sentinel" id="sent"></div></div>
    <a class="fab" href="#/refs/new" aria-label="레퍼런스 등록">${ICON.plus()}</a>`, { tab: 'refs' });
  bindInstall();
  $$('[data-ind]').forEach(b => b.onclick = () => { S.refFilter.ind = b.dataset.ind; refFeed(); });
  $$('[data-type]').forEach(b => b.onclick = () => { S.refFilter.type = b.dataset.type; refFeed(); });

  pager({
    list: $('#list'), sentinel: $('#sent'),
    load: (a, b) => {
      let q = sb.from('refs').select('id,url,title,summary,image_url,site_name,industry,types,author_id,created_at').order('created_at', { ascending: false }).range(a, b);
      if (f.ind) q = q.contains('industry', [f.ind]);
      if (f.type) q = q.contains('types', [f.type]);
      return q;
    },
    render: refCard,
    empty: `<div class="empty"><b>${f.ind || f.type ? '이 태그의 레퍼런스가 아직 없습니다' : '첫 레퍼런스를 모아보세요'}</b>카톡방에 공유하던 링크를 + 버튼으로 붙여넣으면<br>대표 이미지와 요약 2줄이 자동으로 정리됩니다.</div>`,
  });
}

function refCard(r) {
  const initial = esc((r.site_name || r.title || '·').trim()[0] || '·');
  const tags = [...(r.industry || []), ...(r.types || [])];
  const mine = r.author_id === S.me.id;
  return `<article class="ref">
    <a class="ref-link" href="${esc(safeHref(r.url))}" target="_blank" rel="noopener noreferrer">
      <div class="thumb">${r.image_url ? `<img src="${esc(r.image_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback="${initial}">` : initial}</div>
      <div class="ref-body">
        <div class="ref-title">${esc(r.title || r.url)}</div>
        ${r.summary ? `<div class="ref-sum">${esc(r.summary)}</div>` : ''}
        ${tags.length ? `<div class="tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
        <div class="meta"><span>${esc(person(r.author_id).name)} · ${fmtDate(r.created_at)}${r.site_name ? ` · ${esc(r.site_name)}` : ''}</span><b>원문 ↗</b></div>
      </div>
    </a>
    ${mine ? `<a class="ref-more" href="#/refs/${r.id}/edit" aria-label="수정">${ICON.more()}</a>` : ''}
  </article>`;
}

async function refForm(id, presetUrl = '') {
  const st = { url: presetUrl, title: '', summary: '', image: '', site: '', industry: new Set(), types: new Set(), loaded: false, busy: false };
  if (id) {
    const { data, error } = await sb.from('refs').select('*').eq('id', id).single();
    if (error || !data) { toast('레퍼런스를 찾을 수 없습니다.'); location.hash = '#/refs'; return; }
    if (data.author_id !== S.me.id) { toast('본인이 등록한 레퍼런스만 수정할 수 있습니다.'); location.hash = '#/refs'; return; }
    Object.assign(st, { url: data.url, title: data.title || '', summary: data.summary || '', image: data.image_url || '', site: data.site_name || '', industry: new Set(data.industry), types: new Set(data.types), loaded: true });
  }

  setView(`<div class="bar"><a class="icon-btn" href="#/refs" aria-label="뒤로">${ICON.back()}</a><div class="bar-t">${id ? '레퍼런스 수정' : '레퍼런스 등록'}</div><div style="width:44px"></div></div>
    <div class="form">
      <div>
        <label class="lbl" for="url">링크</label>
        <div style="display:flex;gap:8px"><input class="inp" id="url" type="url" inputmode="url" placeholder="https:// 링크를 붙여넣으세요" value="${esc(st.url)}" style="flex:1;min-width:0" ${id ? 'readonly' : ''}>
        ${id ? '' : '<button class="btn-dark" id="fetch">불러오기</button>'}</div>
        <div id="dup" style="margin-top:8px" hidden></div>
      </div>
      <div id="pv"></div>
      <div id="tagbox"></div>
      ${id ? '<button class="danger-btn" id="del">이 레퍼런스 삭제</button>' : ''}
    </div>
    <div class="bottom-cta"><button class="cta" id="save" ${st.loaded ? '' : 'disabled'}>${id ? '수정 완료' : '저장하기'}</button></div>`);

  const drawPreview = () => {
    if (!st.loaded) {
      $('#pv').innerHTML = st.busy
        ? `<div class="preview"><div class="preview-img skel" style="border-radius:0"></div><div class="preview-body"><div class="skel" style="height:18px;width:80%"></div><div class="skel" style="height:44px"></div><p class="note">링크를 읽고 요약하는 중입니다…</p></div></div>`
        : `<p class="note">카톡방에서 복사한 링크를 붙여넣으면 대표 이미지·제목·요약 2줄을 자동으로 채웁니다. 인스타그램처럼 외부 접근을 막는 사이트는 직접 입력할 수 있습니다.</p>`;
      return;
    }
    $('#pv').innerHTML = `<div class="preview">
      <div class="preview-img">${st.image ? `<img src="${esc(st.image)}" alt="" referrerpolicy="no-referrer" data-fallback="">` : '대표 이미지 없음'}</div>
      <div class="preview-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:-6px">
          <span class="note">${esc(st.site)}</span><button class="link-btn" id="imgEdit">이미지 주소 변경</button></div>
        <input class="inp" id="imgUrl" placeholder="이미지 주소(https://…)" value="${esc(st.image)}" hidden>
        <div><label class="sr" for="title">제목</label><input class="title-inp" id="title" placeholder="제목" value="${esc(st.title)}"></div>
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <label for="sum" style="font-size:12px;font-weight:600">요약 2줄 · 직접 수정 가능</label>
            <button class="link-btn" id="regen">다시 생성</button></div>
          <textarea class="ta" id="sum" rows="3" placeholder="요약 첫째 줄&#10;요약 둘째 줄">${esc(st.summary)}</textarea>
        </div>
      </div></div>`;
    $('#title').oninput = (e) => { st.title = e.target.value; };
    const sum = $('#sum');
    const growSum = () => { sum.style.height = 'auto'; sum.style.height = (sum.scrollHeight + 2) + 'px'; };
    sum.oninput = (e) => { st.summary = e.target.value; growSum(); };
    growSum();
    $('#imgEdit').onclick = () => { const i = $('#imgUrl'); i.hidden = !i.hidden; if (!i.hidden) i.focus(); };
    $('#imgUrl').onchange = (e) => { st.image = e.target.value.trim(); drawPreview(); };
    $('#regen').onclick = () => fetchPreview(true);
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
    if (id) return;
    const { data } = await sb.from('refs').select('id,author_id,created_at').eq('url', url).limit(1);
    const box = $('#dup');
    if (data?.length) { box.hidden = false; box.innerHTML = `<div class="warn">이미 ${esc(person(data[0].author_id).name)}님이 ${fmtDate(data[0].created_at)}에 등록한 링크입니다. 그래도 저장할 수 있습니다.</div>`; }
    else box.hidden = true;
  };

  const fetchPreview = async (onlySummary = false) => {
    let url = $('#url').value.trim();
    const m = url.match(/https?:\/\/[^\s<>"']+/);
    if (!m) { toast('https://로 시작하는 링크를 넣어주세요.'); return; }
    url = m[0];
    $('#url').value = url;
    st.url = url;
    if (onlySummary) { $('#regen').textContent = '생성 중…'; $('#regen').disabled = true; }
    else { st.busy = true; st.loaded = false; drawPreview(); $('#save').disabled = true; checkDup(url); }
    try {
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ url, tags: { industry: S.tags.industry, types: S.tags.type } }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '불러오기 실패');
      if (onlySummary) {
        st.summary = j.summary || st.summary;
      } else {
        Object.assign(st, { title: j.title || '', summary: j.summary || '', image: j.image || '', site: j.siteName || '' });
        (j.suggested?.industry || []).forEach(t => st.industry.add(t));
        (j.suggested?.types || []).forEach(t => st.types.add(t));
        if (!j.fetched) toast('이 사이트는 내용을 읽을 수 없어요. 제목과 요약을 직접 입력해주세요.');
      }
    } catch (e) {
      toast(e.message || '링크를 읽지 못했습니다. 직접 입력해주세요.');
      if (!onlySummary) { try { st.site = new URL(url).hostname.replace(/^www\./, ''); } catch { /* noop */ } }
    }
    st.busy = false; st.loaded = true;
    drawPreview(); drawTags();
    $('#save').disabled = false;
  };

  if (!id) {
    $('#fetch').onclick = () => fetchPreview();
    $('#url').addEventListener('paste', () => setTimeout(() => fetchPreview(), 0));
    $('#url').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fetchPreview(); } });
  }
  drawPreview(); drawTags();
  if (presetUrl && !id) fetchPreview();

  $('#save').onclick = async (e) => {
    if (!st.url) return;
    e.currentTarget.disabled = true;
    const row = {
      url: st.url, title: st.title.trim() || st.url, summary: st.summary.trim().split('\n').slice(0, 2).join('\n'),
      image_url: st.image || null, site_name: st.site || null, industry: [...st.industry], types: [...st.types],
    };
    const { error } = id ? await sb.from('refs').update(row).eq('id', id) : await sb.from('refs').insert(row);
    if (error) { e.currentTarget.disabled = false; toast('저장하지 못했습니다. 다시 시도해주세요.'); console.error(error); return; }
    toast(id ? '수정했습니다.' : '레퍼런스를 저장했습니다.');
    location.hash = '#/refs';
  };
  $('#del')?.addEventListener('click', async () => {
    if (!confirm('이 레퍼런스를 삭제할까요?')) return;
    const { error } = await sb.from('refs').delete().eq('id', id);
    if (error) return toast('삭제하지 못했습니다.');
    toast('삭제했습니다.');
    location.hash = '#/refs';
  });
}

// ───────────────────────── 답사기록 ─────────────────────────
function visitFeed() {
  const f = S.visitFilter;
  const tabs = ['', ...CATS].map(c => `<button class="chip${f === c ? ' on' : ''}" data-cat="${esc(c)}">${c || '전체'}</button>`).join('');
  setView(`${header('답사기록', `<div class="row">${tabs}</div>`)}
    ${installBanner()}
    <div class="feed"><div id="list" style="display:flex;flex-direction:column;gap:16px"></div><div class="sentinel" id="sent"></div></div>
    <a class="fab" href="#/visits/new" aria-label="답사기록 작성">${ICON.pen()}</a>`, { tab: 'visits' });
  bindInstall();
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
    sb.from('visit_comments').select('id,body,author_id,created_at').eq('visit_id', id).order('created_at'),
  ]);
  if (error || !v) { toast('답사기록을 찾을 수 없습니다.'); location.hash = '#/visits'; return; }
  const mine = v.author_id === S.me.id;
  const st = { likes: new Set((likes || []).map(l => l.user_id)), comments: comments || [] };

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
      <form class="cin" id="cform"><label for="cmt" class="sr">댓글</label>
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
    $('#ccount').textContent = st.comments.length;
    $('#cmts').innerHTML = `<div style="font-size:13px;font-weight:600">댓글 ${st.comments.length}</div>` + (st.comments.length
      ? st.comments.map(c => `<div class="cmt">${avatar(c.author_id)}<div class="cmt-main">
          <div class="a-name">${esc(person(c.author_id).name)}<small>${fmtDate(c.created_at)}</small>
          ${c.author_id === S.me.id ? `<button class="del" data-del="${c.id}">삭제</button>` : ''}</div>
          <p>${esc(c.body)}</p></div></div>`).join('')
      : '<p class="note">첫 댓글을 남겨보세요.</p>');
    $$('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('댓글을 삭제할까요?')) return;
      const cid = Number(b.dataset.del);
      const { error } = await sb.from('visit_comments').delete().eq('id', cid);
      if (error) return toast('삭제하지 못했습니다.');
      st.comments = st.comments.filter(c => c.id !== cid);
      drawComments();
    });
  };
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
    const { data, error } = await sb.from('visit_comments').insert({ visit_id: id, body }).select('id,body,author_id,created_at').single();
    $('#csend').disabled = false;
    if (error) return toast('댓글을 등록하지 못했습니다.');
    $('#cmt').value = '';
    st.comments.push(data);
    drawComments();
    $('#cmts').lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    e.currentTarget.disabled = true;
    const res = id ? await sb.from('visits').update(row).eq('id', id).select('id').single() : await sb.from('visits').insert(row).select('id').single();
    if (res.error) { e.currentTarget.disabled = false; console.error(res.error); return toast('저장하지 못했습니다. 다시 시도해주세요.'); }
    removePhotos(st.original.filter(p => !paths.includes(p)));
    st.fresh.clear();
    toast(id ? '수정했습니다.' : '답사기록을 등록했습니다.');
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
      <div class="card" style="padding:4px 16px">
        <button class="list-btn" id="how">홈 화면에 앱으로 추가하는 방법 <span class="note">›</span></button>
        <button class="list-btn" id="logout" style="color:var(--danger)">로그아웃</button>
      </div>
      <p class="note" style="text-align:center"><span class="serif" style="font-size:15px">Brand Scrapbook</span> · 브랜드전략팀</p>
    </div>`);
  $('#how').onclick = showInstallHelp;
  $('#logout').onclick = async () => { if (!confirm('로그아웃할까요?')) return; await sb.auth.signOut(); entered = false; S.session = null; showLogin(); };
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

// ───────────────────────── 시작 ─────────────────────────
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

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
