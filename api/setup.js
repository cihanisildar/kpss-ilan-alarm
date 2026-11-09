// Kurulumdan sonra BİR KEZ tarayıcıda aç:
//   https://<proje>.vercel.app/api/setup?key=<CRON_SECRET>
// Telegram webhook'unu bu projeye bağlar ve komut menüsünü ayarlar.
import { authorized, webhookSecret } from '../src/cloud.js';
import { tg, send, telegramEnabled } from '../src/notify.js';
import { COMMANDS } from '../src/core.js';
import { makeStore } from '../src/cloud.js';

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'yetkisiz: ?key=CRON_SECRET ekle' });
  const out = { steps: [] };
  try {
    const missing = ['TELEGRAM_BOT_TOKEN', 'CRON_SECRET'].filter((k) => !process.env[k]);
    if (missing.length) throw new Error(`Eksik ortam değişkeni: ${missing.join(', ')}`);

    const store = makeStore(); // depolama bağlantısını da test eder
    await store.countAds();
    out.steps.push(`✅ Depolama çalışıyor (${process.env.BLOB_READ_WRITE_TOKEN ? 'Vercel Blob' : 'Upstash Redis'})`);

    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const url = `https://${host}/api/telegram`;
    await tg('setWebhook', { url, secret_token: webhookSecret(), allowed_updates: ['message'], drop_pending_updates: true });
    out.steps.push(`✅ Telegram webhook ayarlandı: ${url}`);

    await tg('setMyCommands', { commands: COMMANDS });
    out.steps.push('✅ Komut menüsü ayarlandı');

    if (telegramEnabled()) {
      await send('☁️ KPSS ilan alarmı artık bulutta çalışıyor. Denemek için /tara yaz.');
      out.steps.push('✅ Telegram\'a deneme mesajı gönderildi');
    } else {
      out.steps.push('ℹ️ TELEGRAM_CHAT_ID yok: Telegram\'da bota /start yaz, chat ID\'ni sana söyleyecek. Vercel\'e ekleyip yeniden deploy et.');
    }
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.error = e.message;
  }
  res.status(out.ok ? 200 : 500).json(out);
}
