// 알림함에 쌓인 알림 중 아직 보내지 않은 것을 푸시로 보냅니다.
// Supabase는 서비스 키로 직접 읽고 씁니다 (서버에서만 사용).
import webpush from 'web-push';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'https://brand-scrapbook.vercel.app';

export function pushConfigured() {
  return !!(SUPABASE_URL && SERVICE_KEY && VAPID_PUBLIC && VAPID_PRIVATE);
}

// 업무시간: 평일 09:00~19:00 (한국 시간)
export function isBusinessHours(date = new Date()) {
  const kst = new Date(date.getTime() + 9 * 3600e3);
  const day = kst.getUTCDay(), hour = kst.getUTCHours();
  return day >= 1 && day <= 5 && hour >= 9 && hour < 19;
}

export async function rest(path, { method = 'GET', body, prefer } = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      // 새 형식 비밀 키(sb_secret_…)는 apikey 헤더만, 예전 service_role 키(JWT)는 둘 다
      ...(SERVICE_KEY.startsWith('sb_') ? {} : { Authorization: `Bearer ${SERVICE_KEY}` }),
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`supabase ${method} ${path.split('?')[0]} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

const inList = (ids) => `(${ids.map(encodeURIComponent).join(',')})`;
const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export function describe(n, actorName) {
  const who = actorName || '팀원';
  switch (n.kind) {
    case 'new_ref':   return { title: `새 레퍼런스 · ${who}`, body: cut(n.text, 80), url: `/#/refs/${n.ref_id}` };
    case 'new_visit': return { title: `새 답사기록 · ${who}`, body: cut(n.text, 80), url: `/#/visits/${n.visit_id}` };
    case 'comment':   return { title: `${who}님이 내 답사기록에 댓글을 남겼어요`, body: cut(n.text, 80), url: `/#/visits/${n.visit_id}` };
    case 'reply':     return { title: `${who}님이 내 댓글에 답글을 남겼어요`, body: cut(n.text, 80), url: `/#/visits/${n.visit_id}` };
    default:          return { title: '브랜드 스크랩북', body: cut(n.text, 80), url: '/#/alerts' };
  }
}

/**
 * 보내지 않은 알림을 찾아 푸시합니다.
 * @param {object} o
 * @param {string} [o.match]  추가 PostgREST 조건 (예: 'kind=eq.new_ref&ref_id=eq.3')
 * @param {boolean} [o.digest] 한 사람에게 여러 건이면 한 번에 묶어 보냄
 * @param {function} [send]   테스트용 발송 함수
 */
export async function flush({ match = '', digest = false } = {}, send = defaultSend) {
  const since = new Date(Date.now() - 4 * 86400e3).toISOString();
  const pending = await rest(`notifications?select=*&pushed_at=is.null&created_at=gte.${encodeURIComponent(since)}${match ? '&' + match : ''}&order=created_at.asc&limit=500`);
  if (!pending?.length) return { notifications: 0, sent: 0 };

  const userIds = [...new Set(pending.map(n => n.user_id))];
  const actorIds = [...new Set(pending.map(n => n.actor_id).filter(Boolean))];
  const [prefs, subs, people] = await Promise.all([
    rest(`notify_prefs?select=*&user_id=in.${inList(userIds)}`),
    rest(`push_subscriptions?select=*&user_id=in.${inList(userIds)}`),
    actorIds.length ? rest(`profiles?select=id,name,email&id=in.${inList(actorIds)}`) : [],
  ]);
  const members = actorIds.length ? await rest(`members?select=email,display_name`) : [];
  const nameOf = (id) => {
    const p = (people || []).find(x => x.id === id);
    if (!p) return '팀원';
    const m = (members || []).find(x => x.email?.toLowerCase() === p.email?.toLowerCase());
    return m?.display_name || p.name || '팀원';
  };
  const prefOf = (uid) => ({ new_posts: true, reactions: true, ...(prefs || []).find(p => p.user_id === uid) });

  let sent = 0;
  const dead = [];
  for (const uid of userIds) {
    const mine = pending.filter(n => n.user_id === uid);
    const pref = prefOf(uid);
    const wanted = mine.filter(n => !n.quiet && ((n.kind === 'new_ref' || n.kind === 'new_visit') ? pref.new_posts : pref.reactions));
    const devices = (subs || []).filter(s => s.user_id === uid);
    if (!wanted.length || !devices.length) continue;

    const payloads = [];
    if (digest && wanted.length > 1) {
      const first = describe(wanted[0], nameOf(wanted[0].actor_id));
      payloads.push({
        title: `브랜드 스크랩북 · 새 소식 ${wanted.length}개`,
        body: `${first.title.replace(/ · .*/, '')}: ${first.body}${wanted.length > 1 ? ` 외 ${wanted.length - 1}건` : ''}`,
        url: '/#/alerts', tag: 'digest',
      });
    } else {
      for (const n of wanted) payloads.push({ ...describe(n, nameOf(n.actor_id)), tag: `n${n.id}` });
    }
    for (const dev of devices) {
      for (const p of payloads) {
        try {
          await send(dev, p);
          sent++;
        } catch (e) {
          if (e?.statusCode === 404 || e?.statusCode === 410) { dead.push(dev.endpoint); break; }
          console.warn('push failed', e?.statusCode, e?.body || e?.message);
        }
      }
    }
  }

  // 보냈든(조용히·설정 꺼짐·기기 없음 포함) 처리 완료로 표시해 중복 발송을 막습니다.
  const ids = pending.map(n => n.id);
  for (let i = 0; i < ids.length; i += 200) {
    await rest(`notifications?id=in.${inList(ids.slice(i, i + 200))}`, { method: 'PATCH', body: { pushed_at: new Date().toISOString() }, prefer: 'return=minimal' });
  }
  for (const ep of [...new Set(dead)]) {
    await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(ep)}`, { method: 'DELETE', prefer: 'return=minimal' }).catch(() => {});
  }
  return { notifications: pending.length, sent };
}

function defaultSend(dev, payload) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  return webpush.sendNotification(
    { endpoint: dev.endpoint, keys: { p256dh: dev.p256dh, auth: dev.auth } },
    JSON.stringify(payload),
    { TTL: 60 * 60 * 24, urgency: 'normal' },
  );
}
