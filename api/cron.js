// Düzenli tarama: cron-job.org bu adresi 15-20 dakikada bir çağırır.
//   GET https://<proje>.vercel.app/api/cron?key=<CRON_SECRET>
// Yeni ve alarmına uyan ilan varsa Telegram'a mesaj atar, yoksa sessiz kalır.
import { getBot, authorized } from '../src/cloud.js';

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'yetkisiz' });
  const r = await getBot().scan('otomatik');
  res.status(r.ok ? 200 : 500).json({
    ok: r.ok, fetched: r.fetched, new: r.newCount, matched: r.matched.length, error: r.error,
  });
}
