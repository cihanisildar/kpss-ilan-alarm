// Lokal mod: Telegram komutlarını long polling ile dinler (webhook/sunucu gerekmez).
// Vercel'de bunun yerine api/telegram.js webhook'u kullanılır.
import { tg } from './notify.js';
import { COMMANDS } from './core.js';

export async function startPolling(handleUpdate, log = console.log) {
  // Webhook kuruluysa bot bulutta (Vercel) çalışıyordur: lokal dinleme bulutu bozmasın diye kapanır.
  try {
    const info = await tg('getWebhookInfo');
    if (info?.url) {
      log(`Webhook kurulu (${info.url}): bot bulutta çalışıyor, lokal komut dinleme kapalı.`);
      return;
    }
  } catch { /* yok say */ }
  try { await tg('setMyCommands', { commands: COMMANDS }); } catch (e) { log('Komut menüsü ayarlanamadı:', e.message); }

  let offset = 0;
  try { // bot kapalıyken birikmiş eski komutları çalıştırma
    const old = await tg('getUpdates', { timeout: 0 });
    if (old.length) offset = old[old.length - 1].update_id + 1;
  } catch { /* yok say */ }

  log('Telegram komutları dinleniyor (/tara, /liste, /tumu, /durum, /alarmlar).');
  for (;;) {
    let updates = [];
    try {
      updates = await tg('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] }, { timeoutMs: 65_000 });
    } catch (e) {
      log('Telegram bağlantı hatası, 5 sn sonra tekrar:', e.message);
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    for (const u of updates) {
      offset = u.update_id + 1;
      await handleUpdate(u).catch((e) => log('Komut hatası:', e.message));
    }
  }
}
