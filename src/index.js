#!/usr/bin/env node
// Lokal çalıştırma (bilgisayarında):
//   node src/index.js            -> sürekli çalışır + Telegram komutlarını dinler
//   node src/index.js --once     -> tek tarama
//   node src/index.js --dry      -> Telegram'a göndermez, sadece konsola yazar
//   node src/index.js --test-telegram -> deneme mesajı yollar
// Bulutta (Vercel) çalıştırma için api/ klasörüne bak.
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(resolve(ROOT, '.env'))) process.loadEnvFile(resolve(ROOT, '.env'));

const { createBot, todayIso } = await import('./core.js');
const { sqliteStore } = await import('./store-sqlite.js');
const { startPolling } = await import('./telegram.js');
const { send, telegramEnabled, hasToken } = await import('./notify.js');

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry');
const config = JSON.parse(readFileSync(process.env.CONFIG || resolve(ROOT, 'config.json'), 'utf8'));
const INTERVAL_MIN = config.intervalMinutes ?? 20;
const log = (...a) => console.log(new Date().toLocaleString('tr-TR'), ...a);

const store = sqliteStore(process.env.DB_PATH || resolve(ROOT, 'data', 'ilanlar.db'));
const bot = createBot({ store, config, log, dry: DRY, intervalLabel: `her ${INTERVAL_MIN} dakikada bir` });

// Aynı anda iki tarama olmasın (otomatik tarama + /tara çakışırsa)
let running = null;
const scan = (reason) => (running ??= bot.scan(reason).finally(() => { running = null; }));
bot.handlers.tara = ((orig) => async (chat) => { await running; return orig(chat); })(bot.handlers.tara);

async function printList() {
  const rows = await store.activeAds(todayIso());
  const hits = rows.filter((r) => r.matched_alert);
  const others = rows.filter((r) => !r.matched_alert);
  const line = '─'.repeat(70);
  const tr = (d) => (d ? d.split('-').reverse().join('.') : 'ilan metninde bulunamadı');
  console.log(`\n${line}\n✅ ALARMINA UYAN İLANLAR (${hits.length})\n${line}`);
  if (!hits.length) console.log('  Şimdilik yok. Yeni ilan çıkınca burada ve Telegram\'da görünecek.');
  for (const r of hits) {
    console.log(`\n  📌 ${r.title}\n     Kurum : ${r.advertiser}\n     İl    : ${r.city}`);
    console.log(`     Son başvuru: ${tr(r.deadline)}\n     Link  : ${r.url}`);
  }
  console.log(`\n${line}\nℹ️  TARANAN DİĞER İLANLAR (${others.length}), alarmına uymadı\n${line}`);
  for (const r of others) console.log(`\n  • ${r.title}  (${r.city})\n    ${r.url}`);
  console.log(`\n${line}\n`);
}

if (args.has('--test-telegram')) {
  if (!telegramEnabled()) { console.error('TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_ID .env dosyasında tanımlı değil.'); process.exit(1); }
  await send('👋 KPSS ilan alarmı: Telegram bağlantısı çalışıyor. Komutlar için /yardim');
  process.exit(0);
}

log(`Alarmlar: ${bot.alerts.map((a) => `${a.name} [${a.plates.length || 'tüm'} il]`).join(', ')}`);
if (!hasToken()) log('Uyarı: TELEGRAM_BOT_TOKEN yok, bildirimler sadece konsola yazılacak.');
else if (!telegramEnabled()) log('TELEGRAM_CHAT_ID yok: Telegram\'da bota /start yaz, chat ID\'n burada görünecek.');

await scan('açılış');
await printList();

if (args.has('--once')) process.exit(0);
setInterval(() => scan('otomatik'), INTERVAL_MIN * 60_000);
log(`Her ${INTERVAL_MIN} dakikada bir taranacak. Durdurmak için Ctrl+C.`);
if (hasToken() && !DRY) startPolling(bot.handleUpdate, log);
