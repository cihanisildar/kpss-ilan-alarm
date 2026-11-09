// Telegram bildirimleri. Token/chat ID yoksa sadece konsola yazar.
const token = () => process.env.TELEGRAM_BOT_TOKEN;
// TELEGRAM_CHAT_ID virgülle ayrılmış birden fazla sohbet olabilir (ör. özel sohbet + grup).
// Bildirimler hepsine gider, komutlar hepsinden kabul edilir.
export const chatIds = () =>
  String(process.env.TELEGRAM_CHAT_ID || '').split(',').map((s) => s.trim()).filter(Boolean);

export const telegramEnabled = () => Boolean(token() && chatIds().length);
export const hasToken = () => Boolean(token());

export const esc = (s = '') =>
  String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

export async function tg(method, params = {}, { timeoutMs = 20_000 } = {}) {
  const res = await fetch(`${process.env.TELEGRAM_API || 'https://api.telegram.org'}/bot${token()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || res.status}`);
  return data.result;
}

// Telegram mesaj sınırı 4096 karakter: satır bazında parçala.
function chunks(text, max = 3800) {
  const out = [];
  let cur = '';
  for (const block of text.split('\n\n')) {
    const piece = (cur ? '\n\n' : '') + block;
    if ((cur + piece).length > max && cur) { out.push(cur); cur = block; }
    else cur += piece;
  }
  if (cur) out.push(cur);
  return out;
}

/** Konsola yazar; Telegram ayarlıysa (ve dry değilse) mesaj da atar. */
/** Konsola yazar; Telegram ayarlıysa (ve dry değilse) mesaj da atar. `to` yoksa tüm sohbetlere gönderir. */
export async function send(html, { dry = false, to } = {}) {
  console.log('\n🔔 ' + html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') + '\n');
  const targets = to ? [to] : chatIds();
  if (dry || !token() || !targets.length) return;
  for (const chat of targets) {
    for (const part of chunks(html)) {
      try {
        await tg('sendMessage', { chat_id: chat, text: part, parse_mode: 'HTML', disable_web_page_preview: true });
      } catch (e) {
        console.error(`Telegram gönderim hatası (${chat}):`, e.message);
      }
    }
  }
}

const trDate = (iso) => (iso ? iso.split('-').reverse().join('.') : null);

export function formatAd(ad, alertName) {
  const lines = [
    `🆕 <b>${esc(ad.title)}</b>`,
    `🏛 ${esc(ad.advertiser)}`,
    `📍 ${esc([ad.city, ad.county].filter(Boolean).join(' / '))}`,
    `⏳ Son başvuru: ${trDate(ad.deadline) || 'ilan metninde bulunamadı'}`,
  ];
  if (alertName) lines.push(`🔎 Alarm: ${esc(alertName)}`);
  lines.push(`🔗 <a href="${esc(ad.url)}">İlanı aç</a>`);
  return lines.join('\n');
}

export function formatReminder(row, daysLeft) {
  return [
    `⏰ <b>Son başvuruya ${daysLeft === 0 ? 'BUGÜN son gün' : daysLeft + ' gün kaldı'}</b>`,
    `${esc(row.title)}`,
    `🏛 ${esc(row.advertiser)} (${esc(row.city)})`,
    `🔗 <a href="${esc(row.url)}">İlanı aç</a>`,
  ].join('\n');
}
