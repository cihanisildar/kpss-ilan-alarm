// ilan.gov.tr belgesiz JSON uçları (ihale-mcp projesinden çıkarıldı).
// ats=5 -> PERSONEL ilanları, aci -> ilan.gov.tr şehir ID'si, ppdmin -> yayın tarihi alt sınırı (GG.AA.YYYY)
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestJson } from './https.js';

// İndirilen ara sertifikanın önbelleği. Vercel'de sadece /tmp yazılabilir.
const CACHE_DIR = process.env.CACHE_DIR
  || (process.env.VERCEL ? '/tmp' : null)
  || (process.env.DB_PATH ? dirname(process.env.DB_PATH) : resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data'));

const BASE = 'https://www.ilan.gov.tr';
const HEADERS = {
  accept: 'text/plain',
  'accept-language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'content-type': 'application/json-patch+json',
  origin: BASE,
  referer: `${BASE}/ilan/tum-ilanlar`,
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'x-request-origin': 'IGT-UI',
  'x-requested-with': 'XMLHttpRequest',
};

// Test için: ILAN_FIXTURE=dosya.json verilirse ağ yerine dosyadan okur.
const FIXTURE = process.env.ILAN_FIXTURE ? JSON.parse(readFileSync(process.env.ILAN_FIXTURE, 'utf8')) : null;

async function http(url, init, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await requestJson(url, { ...init, headers: HEADERS, cacheDir: CACHE_DIR });
    } catch (e) {
      lastErr = e.code ? new Error(`${e.code}: ${e.message}`) : e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

function ddmmyyyy(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(date.getDate())}.${p(date.getMonth() + 1)}.${date.getFullYear()}`;
}

function mapAd(ad) {
  const filters = Object.fromEntries((ad.adTypeFilters || []).map((f) => [f.key, f.value]));
  return {
    source: 'ilan.gov.tr',
    id: String(ad.id),
    adNo: ad.adNo,
    title: ad.title || '',
    advertiser: ad.advertiserName || '',
    city: ad.addressCityName || '',
    county: ad.addressCountyName || '',
    publishDate: ad.publishStartDate || null,
    url: `${BASE}${ad.urlStr || ''}`,
    filters,
  };
}

/**
 * Son `days` günde yayımlanmış personel ilanlarını getirir.
 * cityIds verilirse her şehir için ayrı sorgu atar, yoksa tüm Türkiye.
 */
export async function searchPersonnelAds({ days = 3, cityIds = [], pageSize = 20, maxPages = 15 } = {}) {
  if (FIXTURE) return { ads: FIXTURE.search.result.ads.map(mapAd), total: FIXTURE.search.result.numFound };

  const since = ddmmyyyy(new Date(Date.now() - days * 86400_000));
  const targets = cityIds.length ? cityIds : [null];
  const all = new Map();
  let total = 0;

  for (const cityId of targets) {
    for (let page = 0; page < maxPages; page++) {
      const keys = { ats: [5], ppdmin: [since] };
      if (cityId) keys.aci = [cityId];
      if (page > 0) keys.currentPage = [page + 1];
      const body = { keys, skipCount: page * pageSize, maxResultCount: pageSize };
      const data = await http(`${BASE}/api/api/services/app/Ad/AdsByFilter`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const result = data?.result || {};
      const ads = result.ads || [];
      if (page === 0) total += result.numFound || 0;
      for (const ad of ads) all.set(String(ad.id), mapAd(ad));
      if (ads.length < pageSize) break;
      await new Promise((r) => setTimeout(r, 700)); // nazik ol
    }
  }
  return { ads: [...all.values()], total };
}

export async function getAdDetail(id) {
  if (FIXTURE) return FIXTURE.details?.[id] || null;
  const data = await http(`${BASE}/api/api/services/app/AdDetail/GetAdDetail?id=${encodeURIComponent(id)}`, {
    method: 'GET',
  });
  if (!data?.success) return null;
  return data.result || null;
}
