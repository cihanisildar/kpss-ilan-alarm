// Vercel fonksiyonlarının ortak kurulumu.
import { readFileSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createBot } from './core.js';
import { redisStore } from './store-redis.js';
import { blobStore } from './store-blob.js';

let config;
try { config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8')); }
catch { config = JSON.parse(readFileSync(`${process.cwd()}/config.json`, 'utf8')); }

// Vercel Blob bağlıysa onu, yoksa Upstash Redis'i kullan
export const makeStore = () => (process.env.BLOB_READ_WRITE_TOKEN ? blobStore() : redisStore());

export function getBot() {
  return createBot({
    store: makeStore(),
    config,
    log: (...a) => console.log(...a),
    intervalLabel: process.env.SCAN_INTERVAL_LABEL || 'cron-job.org ile düzenli',
  });
}

// Telegram webhook'u için gizli anahtar: CRON_SECRET'tan türetilir (Telegram sadece [A-Za-z0-9_-] kabul eder)
export const webhookSecret = () =>
  createHash('sha256').update(`tg:${process.env.CRON_SECRET || ''}`).digest('hex');

function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** ?key=CRON_SECRET veya "Authorization: Bearer CRON_SECRET" */
export function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return safeEq(req.query?.key || '', secret) || safeEq(bearer, secret);
}
