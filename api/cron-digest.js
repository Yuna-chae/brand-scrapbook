// 평일 오전 9시(한국 시간) Vercel이 자동 호출: 업무시간 외에 쌓인 알림을 사람별로 묶어서 보냅니다.
import { flush, pushConfigured } from './_lib/push.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });
  if (!pushConfigured()) return res.status(200).json({ skipped: 'push not configured' });
  try {
    const r = await flush({ digest: true });
    return res.status(200).json(r);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
