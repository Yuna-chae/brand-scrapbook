// POST /api/notify  { type: 'ref' | 'visit' | 'comment', id }
// 글·댓글을 올린 직후 앱이 호출합니다. 업무시간이면 바로 푸시, 아니면 다음 평일 오전 9시에 모아서 보냅니다.
import { flush, isBusinessHours, pushConfigured } from './_lib/push.js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 지원합니다.' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || !(await isMember(token))) return res.status(401).json({ error: '팀원 로그인이 필요합니다.' });
  if (!pushConfigured()) return res.status(200).json({ skipped: '알림 설정(Vercel 환경 변수)이 아직 없습니다.' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const id = Number(body.id);
  const match = { ref: `kind=eq.new_ref&ref_id=eq.${id}`, visit: `kind=eq.new_visit&visit_id=eq.${id}`, comment: `comment_id=eq.${id}` }[body.type];
  if (!match || !Number.isInteger(id)) return res.status(400).json({ error: '알 수 없는 요청입니다.' });

  if (!isBusinessHours()) return res.status(200).json({ deferred: true });
  try {
    const r = await flush({ match });
    return res.status(200).json(r);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: '알림을 보내지 못했습니다.' });
  }
}

async function isMember(token) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_member`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    return r.ok && (await r.json()) === true;
  } catch { return false; }
}
