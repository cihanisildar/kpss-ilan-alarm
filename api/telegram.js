// Telegram webhook'u: /tara, /liste vb. komutlar buraya gelir.
import { getBot, webhookSecret } from '../src/cloud.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('KPSS ilan alarmı webhook');
  if (req.headers['x-telegram-bot-api-secret-token'] !== webhookSecret()) {
    return res.status(401).send('yetkisiz');
  }
  try {
    await getBot().handleUpdate(req.body);
  } catch (e) {
    console.error('Webhook hatası:', e);
  }
  res.status(200).send('ok'); // Telegram'a her durumda 200: aksi halde aynı mesajı tekrar tekrar yollar
}
