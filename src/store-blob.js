// Vercel için Vercel Blob store'u: tüm durum tek bir özel (private) JSON dosyasında tutulur.
// BLOB_READ_WRITE_TOKEN, Blob store projeye bağlanınca Vercel tarafından otomatik eklenir.
//
// Ücretsiz plan kotasını korumak için dosya sadece bir şey DEĞİŞTİĞİNDE yazılır:
// yeni ilan, hatırlatma, Telegram komutu veya tarama durumunun değişmesi (başarılı -> hata gibi).
// Sorunsuz ve yeni ilansız taramalar hiçbir şey yazmaz, sadece 1 okuma yapar.
import * as blob from '@vercel/blob';

const PATH = 'kpss/state.json';
const KEEP_MS = 60 * 86400_000; // 60 günden eski ilanları unut

export function blobStore({ pathname = PATH, io = blob } = {}) {
  const { get, put } = io;
  let state = null;
  let dirty = false;

  async function load() {
    if (state) return state;
    try {
      const r = await get(pathname, { access: 'private', useCache: false });
      state = r && r.statusCode === 200 ? JSON.parse(await new Response(r.stream).text()) : null;
    } catch (e) {
      if (!/not.?found|404/i.test(String(e?.message || e))) throw e;
      state = null;
    }
    state ??= { ads: {}, runs: [], updates: [] };
    // eski ilanları temizle
    const cutoff = Date.now() - KEEP_MS;
    for (const [id, a] of Object.entries(state.ads)) {
      if ((a.seen_ms ?? 0) < cutoff) { delete state.ads[id]; dirty = true; }
    }
    return state;
  }

  const ads = async () => Object.values((await load()).ads);

  return {
    async hasAd(id) { return Boolean((await load()).ads[id]); },
    async fpNotified(fp) { return (await ads()).some((a) => a.fingerprint === fp && a.notified_at); },
    async saveAd(a) { (await load()).ads[a.id] = { ...a, seen_ms: Date.now() }; dirty = true; },
    async countAds() { return Object.keys((await load()).ads).length; },
    async activeAds(today) {
      return (await ads()).filter((a) => !a.deadline || a.deadline >= today).sort((x, y) => y.seen_ms - x.seen_ms);
    },
    async dueReminders() { return (await ads()).filter((a) => a.matched_alert && a.deadline && !a.reminded_at); },
    async markReminded(id) {
      const a = (await load()).ads[id];
      if (a) { a.reminded_at = new Date().toISOString(); dirty = true; }
    },
    async addRun(r) {
      const s = await load();
      const prev = s.runs[0];
      s.runs.unshift(r);
      s.runs = s.runs.slice(0, 20);
      s.lastRun = r; // bellekte en güncel; kalıcı olarak yazılması aşağıdaki koşula bağlı
      // Sadece anlamlı değişimde yaz: hata, durum değişimi, yeni ilan, ya da ilk kayıt
      if (!r.ok || !prev || prev.ok !== r.ok || r.new_count > 0 || r.reason?.includes('Telegram')) dirty = true;
    },
    async lastRuns(n) { return (await load()).runs.slice(0, n); },
    async claimUpdate(id) {
      const s = await load();
      if (s.updates.includes(id)) return false;
      s.updates = [id, ...s.updates].slice(0, 50);
      dirty = true;
      return true;
    },
    /** Değişiklik varsa durumu Blob'a yazar. Her istek sonunda çağrılır. */
    async flush() {
      if (!dirty || !state) return false;
      await put(pathname, JSON.stringify(state), {
        access: 'private', addRandomSuffix: false, allowOverwrite: true,
        contentType: 'application/json', cacheControlMaxAge: 60,
      });
      dirty = false;
      return true;
    },
  };
}
