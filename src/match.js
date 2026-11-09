import { CITIES } from './cities.js';
import { REGIONS } from './regions.js';
import { norm } from './text.js';

// Alarm tanımını çözümler: plaka + bölge -> şehir listesi; anahtar kelimeleri normalize eder.
export function compileAlert(a) {
  const plates = new Set(a.cities || []);
  for (const r of a.regions || []) {
    const list = REGIONS[norm(r).replace(/ bolgesi$/, '')];
    if (!list) throw new Error(`Bilinmeyen bölge: "${r}". Geçerli: ${Object.keys(REGIONS).join(', ')}`);
    list.forEach((p) => plates.add(p));
  }
  for (const p of plates) if (!CITIES[p]) throw new Error(`Geçersiz plaka: ${p} (alarm: ${a.name})`);
  return {
    name: a.name,
    plates: [...plates],
    cityNames: new Set([...plates].map((p) => norm(CITIES[p].name))),
    // "bilgisayar muhendis" -> ["bilgisayar","muhendis"]: kelimelerin hepsi geçmeli (VE),
    // listedeki ifadelerden biri yeterli (VEYA).
    keywords: (a.keywords || []).map((k) => norm(k).split(' ').filter(Boolean)),
    exclude: (a.exclude || []).map((k) => norm(k)),
    searchContent: a.searchContent !== false,
  };
}

export function cityMatches(alert, ad) {
  if (!alert.plates.length) return true; // tüm Türkiye
  return alert.cityNames.has(norm(ad.city));
}

export function textMatches(alert, text) {
  const t = norm(text);
  if (alert.exclude.some((x) => t.includes(x))) return false;
  if (!alert.keywords.length) return true; // anahtar kelime yoksa şehirdeki tüm personel ilanları
  return alert.keywords.some((words) => words.every((w) => t.includes(w)));
}

export function excluded(alert, text) {
  const t = norm(text);
  return alert.exclude.some((x) => t.includes(x));
}
