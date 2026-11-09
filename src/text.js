// Türkçe metin normalizasyonu: büyük/küçük harf ve aksan farklarını yok sayar.
const MAP = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

export function norm(s = '') {
  return String(s)
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // birleşik noktalar (i̇ vb.)
    .replace(/[çğıöşüâîû]/g, (c) => MAP[c])
    .replace(/\s+/g, ' ')
    .trim();
}

export function htmlToText(html = '') {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

// "Son başvuru tarihi ... 15.11.2026" kalıbından tarihi yakalamaya çalışır.
export function extractDeadline(text = '') {
  const t = norm(text);
  const re = /son basvuru[^0-9]{0,80}?(\d{1,2})[./-](\d{1,2})[./-](\d{4})/;
  const m = t.match(re);
  if (!m) return null;
  const [, d, mo, y] = m;
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}
