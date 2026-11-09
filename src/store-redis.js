// Vercel için Upstash Redis store'u (REST API, ek paket yok).
// Ortam değişkenleri: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
// (Vercel Marketplace'ten eklenince KV_REST_API_URL + KV_REST_API_TOKEN adıyla gelir, ikisi de desteklenir.)
//
// Veri modeli:
//   kpss:ad:<id>     -> ilan JSON (60 gün sonra kendiliğinden silinir)
//   kpss:ads         -> sorted set, skor = ilk görülme zamanı (ms)
//   kpss:fp:<hash>   -> "bu kurum+başlık daha önce bildirildi" işareti
//   kpss:runs        -> son 50 taramanın listesi
//   kpss:upd:<id>    -> işlenen Telegram update'leri (tekrarı önlemek için, 1 gün)
const TTL = 60 * 86400;
const P = 'kpss:';

export function redisStore({
  url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
} = {}) {
  if (!url || !token) throw new Error('UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN tanımlı değil');

  async function call(path, body) {
    const res = await fetch(`${url.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(`Redis: ${data.error || res.status}`);
    return data;
  }
  const cmd = async (...args) => (await call('', args)).result;
  const pipe = async (cmds) => (cmds.length ? (await call('/pipeline', cmds)).map((r) => {
    if (r.error) throw new Error(`Redis: ${r.error}`);
    return r.result;
  }) : []);

  const parse = (s) => (s ? JSON.parse(s) : null);
  async function allAds() {
    await cmd('ZREMRANGEBYSCORE', `${P}ads`, '-inf', String(Date.now() - TTL * 1000)); // eskileri temizle
    const ids = await cmd('ZREVRANGE', `${P}ads`, '0', '-1');
    if (!ids.length) return [];
    const raw = await cmd('MGET', ...ids.map((id) => `${P}ad:${id}`));
    return raw.map(parse).filter(Boolean);
  }

  return {
    async hasAd(id) { return (await cmd('EXISTS', `${P}ad:${id}`)) === 1; },
    async fpNotified(fp) { return (await cmd('EXISTS', `${P}fp:${fp}`)) === 1; },
    async saveAd(a) {
      const cmds = [
        ['SET', `${P}ad:${a.id}`, JSON.stringify(a), 'EX', String(TTL)],
        ['ZADD', `${P}ads`, String(Date.now()), a.id],
      ];
      if (a.notified_at) cmds.push(['SET', `${P}fp:${a.fingerprint}`, '1', 'EX', String(TTL)]);
      await pipe(cmds);
    },
    async countAds() { return Number(await cmd('ZCARD', `${P}ads`)); },
    async activeAds(today) {
      return (await allAds()).filter((a) => !a.deadline || a.deadline >= today);
    },
    async dueReminders() {
      return (await allAds()).filter((a) => a.matched_alert && a.deadline && !a.reminded_at);
    },
    async markReminded(id) {
      const a = parse(await cmd('GET', `${P}ad:${id}`));
      if (!a) return;
      a.reminded_at = new Date().toISOString();
      await cmd('SET', `${P}ad:${id}`, JSON.stringify(a), 'KEEPTTL');
    },
    async addRun(r) {
      await pipe([['LPUSH', `${P}runs`, JSON.stringify(r)], ['LTRIM', `${P}runs`, '0', '49']]);
    },
    async lastRuns(n) { return (await cmd('LRANGE', `${P}runs`, '0', String(n - 1))).map(parse); },
    async claimUpdate(id) { return (await cmd('SET', `${P}upd:${id}`, '1', 'NX', 'EX', '86400')) === 'OK'; },
  };
}
