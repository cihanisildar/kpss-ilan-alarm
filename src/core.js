// Botun çekirdeği: tarama, eşleştirme, bildirim ve Telegram komutları.
// Depolamadan bağımsızdır: lokalde SQLite, Vercel'de Upstash Redis store'u ile çalışır.
import { searchPersonnelAds, getAdDetail } from './ilangov.js';
import { compileAlert, cityMatches, textMatches, excluded } from './match.js';
import { send as rawSend, formatAd, formatReminder, esc } from './notify.js';
import { CITIES } from './cities.js';
import { norm, htmlToText, extractDeadline } from './text.js';

export const COMMANDS = [
  { command: 'tara', description: 'Şimdi tara (yeni ilan varsa gönderir)' },
  { command: 'liste', description: 'Alarmına uyan güncel ilanlar' },
  { command: 'tumu', description: 'Taranan tüm güncel ilanlar' },
  { command: 'durum', description: 'Son tarama ve bot durumu' },
  { command: 'alarmlar', description: 'İzlenen iller ve anahtar kelimeler' },
  { command: 'yardim', description: 'Komut listesi' },
];

export const todayIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
const nowTr = () => new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Istanbul' }).slice(0, 19);
const fingerprint = (ad) => `${norm(ad.advertiser)}|${norm(ad.title)}`;

// Sınırlı eşzamanlılıkla map (ilan detaylarını paralel çekmek için)
async function pMap(items, fn, limit = 4) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

/**
 * store arayüzü (hepsi async):
 *   hasAd(id) -> bool, saveAd(row), fpNotified(fp) -> bool, countAds() -> n,
 *   activeAds(todayIso) -> row[], dueReminders() -> row[], markReminded(id),
 *   addRun(run), lastRuns(n) -> run[], claimUpdate(updateId) -> bool (ilk kez mi)
 */
export function createBot({ store, config, log = console.log, dry = false, intervalLabel }) {
  const rawAlerts = config.alerts;
  const alerts = rawAlerts.map(compileAlert);
  const send = (html, opts = {}) => rawSend(html, { dry, ...opts });

  function cityIdsToQuery() {
    if (alerts.some((a) => !a.plates.length)) return []; // tüm Türkiye
    return [...new Set(alerts.flatMap((a) => a.plates))].map((p) => CITIES[p].id);
  }

  async function matchAd(ad) {
    const head = `${ad.title} ${ad.advertiser}`;
    let detailText = null;
    const detail = async () => {
      if (detailText === null) {
        const d = await getAdDetail(ad.id).catch(() => null);
        detailText = htmlToText(d?.content || '');
      }
      return detailText;
    };
    let hit = null;
    for (const alert of alerts) {
      if (!cityMatches(alert, ad)) continue;
      if (textMatches(alert, head)) { hit = alert; break; }
      if (alert.searchContent && !excluded(alert, head) && textMatches(alert, await detail())) { hit = alert; break; }
    }
    if (hit) await detail();
    return { hit, deadline: detailText ? extractDeadline(detailText) : null };
  }

  async function scan(reason = 'otomatik') {
    const firstRun = (await store.countAds()) === 0;
    const res = { ok: false, fetched: 0, newCount: 0, matched: [], error: null };
    try {
      const { ads } = await searchPersonnelAds({ days: config.lookbackDays ?? 3, cityIds: cityIdsToQuery() });
      res.fetched = ads.length;

      const fresh = [];
      for (const ad of ads) if (!(await store.hasAd(ad.id))) fresh.push(ad);
      res.newCount = fresh.length;

      const results = await pMap(fresh, matchAd);
      for (let k = 0; k < fresh.length; k++) {
        const ad = fresh[k];
        const { hit, deadline } = results[k];
        ad.deadline = deadline;
        const fp = fingerprint(ad);
        let notifiedAt = null;
        const expired = ad.deadline && ad.deadline < todayIso(); // son başvurusu geçmiş ilanı bildirme
        if (hit && !expired && !(await store.fpNotified(fp))) {
          notifiedAt = nowTr();
          res.matched.push({ ad, alert: hit });
          if (!firstRun) await send(formatAd(ad, hit.name));
        }
        await store.saveAd({
          id: ad.id, source: ad.source, fingerprint: fp, title: ad.title, advertiser: ad.advertiser,
          city: ad.city, url: ad.url, deadline: ad.deadline, matched_alert: hit ? hit.name : null,
          notified_at: notifiedAt, reminded_at: null, first_seen: nowTr(),
        });
      }

      if (firstRun) {
        await send(
          `✅ <b>KPSS ilan alarmı kuruldu</b>\nSon ${config.lookbackDays ?? 3} günde ${res.fetched} personel ilanı tarandı, ` +
          `${res.matched.length} tanesi alarmına uyuyor.` +
          (res.matched.length ? '\n\n' + res.matched.map(({ ad, alert }) => formatAd(ad, alert.name)).join('\n\n') : '') +
          `\n\nBundan sonra yalnızca yeni ilanlar bildirilecek. Komutlar için /yardim`,
        );
      }
      res.ok = true;
      log(`Tarama (${reason}) tamam: ${res.fetched} ilan, ${res.newCount} yeni, ${res.matched.length} eşleşme`);
      // Yeni gelen her ilanı konsolda göster (uymayanlar Telegram'a gitmez ama burada görünür)
      for (let k = 0; k < fresh.length; k++) {
        const ad = fresh[k];
        const hit = results[k].hit;
        log(`   ${hit ? '✅ UYDU   ' : '▫️ uymadı '} ${ad.title} — ${ad.advertiser} (${ad.city})`);
        log(`              ${ad.url}`);
      }
    } catch (e) {
      res.error = String(e?.message || e);
      log(`Tarama (${reason}) HATASI:`, res.error);
    }
    await store.addRun({ ts: nowTr(), ok: res.ok ? 1 : 0, fetched: res.fetched, new_count: res.newCount,
      matched: res.matched.length, error: res.error, reason });
    await healthCheck();
    await reminders();
    await store.flush?.();
    return res;
  }

  // Kaynak sessizce bozulursa haber ver: art arda N hata veya N kez beklenenden az ilan.
  async function healthCheck() {
    const n = config.health?.consecutiveRuns ?? 3;
    const minAds = config.health?.minExpectedAds ?? 1;
    const runs = (await store.lastRuns(n + 10)).filter((r) => !String(r.reason || '').includes('Telegram'));
    if (runs.length < n) return;
    const bad = (r) => !r.ok || r.fetched < minAds;
    const lastN = runs.slice(0, n);
    const prev = runs[n];
    if (lastN.every(bad) && (!prev || !bad(prev))) { // sadece "iyi -> kötü" geçişinde bir kez
      const err = lastN.find((r) => r.error)?.error;
      await send(
        `⚠️ <b>Veri gelmiyor</b>\nSon ${n} taramada ilan.gov.tr'den ` +
        (err ? `hata alındı: ${esc(err)}` : `beklenenden az ilan geldi (< ${minAds}).`) +
        `\nSite yapısı değişmiş ya da erişim engellenmiş olabilir.`,
      );
    }
  }

  async function reminders() {
    const before = config.reminderDaysBefore ?? 2;
    const today = new Date(todayIso());
    for (const row of await store.dueReminders()) {
      const days = Math.round((new Date(row.deadline) - today) / 86400_000);
      if (days < 0) { await store.markReminded(row.id); continue; }
      if (days <= before) {
        await send(formatReminder(row, days));
        await store.markReminded(row.id);
      }
    }
  }

  // ---------- Telegram komutları ----------
  const fmtRow = (r) => formatAd({ ...r, county: '' }, r.matched_alert);

  const handlers = {
    async tara(chat) {
      await send('🔍 Taranıyor...', { to: chat });
      const r = await scan('Telegram /tara');
      if (!r.ok) return `⚠️ Tarama başarısız: ${esc(r.error)}`;
      if (!r.matched.length) {
        return `✅ Tarama tamam, <b>yeni ilan yok</b>.\n${r.fetched} ilan kontrol edildi` +
          (r.newCount ? `, ${r.newCount} yeni ilan vardı ama alarmına uymadı.` : '.') +
          `\nGüncel listeyi görmek için /liste`;
      }
      return `🎯 <b>${r.matched.length} yeni ilan bulundu</b>, yukarıda gönderildi.`;
    },
    async liste() {
      const rows = (await store.activeAds(todayIso())).filter((r) => r.matched_alert);
      if (!rows.length) return '📭 Şu an alarmına uyan güncel ilan yok.';
      return `📋 <b>Alarmına uyan güncel ilanlar (${rows.length})</b>\n\n` + rows.map(fmtRow).join('\n\n');
    },
    async tumu() {
      const rows = await store.activeAds(todayIso());
      if (!rows.length) return 'Henüz taranmış ilan yok. /tara ile başlat.';
      return `🗂 <b>Taranan güncel ilanlar (${rows.length})</b>\n✅ = alarmına uyuyor\n\n` +
        rows.map((r) => `${r.matched_alert ? '✅' : '▫️'} <a href="${esc(r.url)}">${esc(r.title)}</a> (${esc(r.city)})`).join('\n\n');
    },
    async durum() {
      const [last] = await store.lastRuns(1);
      const lines = ['🤖 <b>Bot durumu</b>'];
      if (last) {
        lines.push(`Son tarama: ${last.ts} — ${last.ok ? '✅ başarılı' : '❌ hata'}${last.reason ? ` (${esc(last.reason)})` : ''}`);
        lines.push(`  ${last.fetched} ilan, ${last.new_count} yeni, ${last.matched} eşleşme`);
        if (last.error) lines.push(`  Hata: ${esc(last.error)}`);
      } else lines.push('Henüz tarama yapılmadı.');
      if (intervalLabel) lines.push(`Otomatik tarama: ${intervalLabel}`);
      lines.push(`Geriye dönük tarama: ${config.lookbackDays ?? 3} gün`);
      lines.push(`Kayıtlı ilan sayısı: ${await store.countAds()}`);
      return lines.join('\n');
    },
    async alarmlar() {
      return '🔔 <b>Alarmlar</b>\n\n' + rawAlerts.map((a, i) => {
        const c = alerts[i];
        const iller = c.plates.length ? c.plates.map((p) => CITIES[p].name).join(', ') : 'Tüm Türkiye';
        return [
          `<b>${esc(a.name)}</b>`,
          `📍 ${esc(iller)}`,
          `🔑 ${a.keywords?.length ? esc(a.keywords.join(', ')) : '(tüm personel ilanları)'}`,
          a.exclude?.length ? `🚫 ${esc(a.exclude.join(', '))}` : null,
        ].filter(Boolean).join('\n');
      }).join('\n\n') + '\n\nDeğiştirmek için config.json dosyasını düzenle.';
    },
    async yardim() {
      return '👋 <b>KPSS İlan Alarmı</b>\nYeni ilan çıkınca otomatik mesaj atarım; değişiklik yoksa rahatsız etmem.\n\n' +
        COMMANDS.map((c) => `/${c.command} — ${c.description}`).join('\n');
    },
  };

  /** Tek bir Telegram update'ini işler (polling ve webhook ortak kullanır). */
  async function handleUpdate(u) {
    const msg = u?.message;
    if (!msg?.text) return;
    if (u.update_id != null && !(await store.claimUpdate(u.update_id))) return; // tekrar gelen update
    const chat = String(msg.chat.id);
    const allowed = process.env.TELEGRAM_CHAT_ID;

    if (!allowed) {
      log(`>>> Chat ID'n: ${chat}  —  TELEGRAM_CHAT_ID=${chat} olarak ayarla.`);
      await send(`Chat ID'n: <code>${chat}</code>\nBunu <code>TELEGRAM_CHAT_ID</code> ortam değişkenine yaz.`, { to: chat });
      await store.flush?.();
      return;
    }
    if (chat !== String(allowed)) { log(`Yetkisiz sohbet yok sayıldı: ${chat}`); return; }

    const cmd = msg.text.trim().split(/\s+/)[0].replace(/^\//, '').replace(/@.*$/, '').toLowerCase();
    const key = { start: 'yardim', help: 'yardim', 'tümü': 'tumu', 'yardım': 'yardim' }[cmd] || cmd;
    const h = handlers[key];
    if (!h) { await send('Bu komutu bilmiyorum. /yardim yazarak komutları görebilirsin.', { to: chat }); return; }
    log(`Telegram komutu: /${key}`);
    try {
      const reply = await h(chat);
      if (reply) await send(reply, { to: chat });
    } catch (e) {
      await send(`⚠️ Hata: ${esc(e.message)}`, { to: chat });
    }
    await store.flush?.();
  }

  return { scan, handlers, handleUpdate, alerts };
}
