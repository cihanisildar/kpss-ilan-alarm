// Geçici teşhis ucu: ilan.gov.tr'ye farklı filtrelerle sorgu atıp sonuç sayılarını döndürür.
//   /api/debug?key=<CRON_SECRET>
import { authorized } from '../src/cloud.js';
import { requestJson } from '../src/https.js';

const BASE = 'https://www.ilan.gov.tr';
const HEADERS = {
  accept: 'text/plain', 'accept-language': 'tr-TR,tr;q=0.9', 'content-type': 'application/json-patch+json',
  origin: BASE, referer: `${BASE}/ilan/tum-ilanlar`, 'x-request-origin': 'IGT-UI', 'x-requested-with': 'XMLHttpRequest',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
};
const ddmmyyyy = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;

async function q(label, keys, max = 50) {
  try {
    const d = await requestJson(`${BASE}/api/api/services/app/Ad/AdsByFilter`, {
      method: 'POST', headers: HEADERS, cacheDir: '/tmp',
      body: JSON.stringify({ keys, skipCount: 0, maxResultCount: max }),
    });
    const r = d?.result || {};
    return {
      label, keys, numFound: r.numFound, returned: (r.ads || []).length,
      categories: (r.categories || []).map((c) => `${c.name}:${c.count}`).slice(0, 15),
      cities: (r.cityCounts || []).slice(0, 8).map((c) => `${c.key}:${c.count}`),
      sample: (r.ads || []).slice(0, 25).map((a) => `${a.publishStartDate?.slice(0, 10)} | ${a.addressCityName} | ${a.title} | ${a.advertiserName}`),
    };
  } catch (e) { return { label, keys, error: String(e.message || e) }; }
}

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'yetkisiz' });
  const since3 = ddmmyyyy(new Date(Date.now() - 3 * 86400_000));
  const since14 = ddmmyyyy(new Date(Date.now() - 14 * 86400_000));
  const out = await Promise.all([
    q('A: bot sorgusu (ats=5, İstanbul aci=49, son 3 gün)', { ats: [5], aci: [49], ppdmin: [since3] }),
    q('B: ats=5, İstanbul, tarih yok', { ats: [5], aci: [49] }),
    q('C: ats=5, tüm Türkiye, son 3 gün', { ats: [5], ppdmin: [since3] }),
    q('D: ats=5, tüm Türkiye, son 14 gün', { ats: [5], ppdmin: [since14] }),
    q('E: filtre yok, İstanbul, son 3 gün', { aci: [49], ppdmin: [since3] }),
    q('F: "tekniker" metin araması, tüm türler', { q: ['tekniker'] }),
  ]);
  res.status(200).json(out);
}
