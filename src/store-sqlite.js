// Lokal çalıştırma için SQLite store (Node >= 22.13, yerleşik node:sqlite).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function sqliteStore(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ads (
      id TEXT PRIMARY KEY, source TEXT, fingerprint TEXT, title TEXT, advertiser TEXT, city TEXT,
      url TEXT, deadline TEXT, matched_alert TEXT, notified_at TEXT, reminded_at TEXT,
      first_seen TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS ads_fp ON ads(fingerprint);
    CREATE TABLE IF NOT EXISTS runs (
      ts TEXT DEFAULT (datetime('now','localtime')), ok INTEGER, fetched INTEGER,
      new_count INTEGER, matched INTEGER, error TEXT
    );
    CREATE TABLE IF NOT EXISTS updates (id INTEGER PRIMARY KEY);
  `);
  try { db.exec('ALTER TABLE runs ADD COLUMN reason TEXT'); } catch { /* zaten var */ }

  const s = {
    has: db.prepare('SELECT 1 FROM ads WHERE id = ?'),
    fp: db.prepare('SELECT 1 FROM ads WHERE fingerprint = ? AND notified_at IS NOT NULL LIMIT 1'),
    ins: db.prepare(`INSERT OR REPLACE INTO ads (id, source, fingerprint, title, advertiser, city, url, deadline,
                     matched_alert, notified_at, reminded_at, first_seen) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
    count: db.prepare('SELECT COUNT(*) AS n FROM ads'),
    active: db.prepare('SELECT * FROM ads WHERE deadline IS NULL OR deadline >= ? ORDER BY first_seen DESC'),
    due: db.prepare('SELECT * FROM ads WHERE matched_alert IS NOT NULL AND deadline IS NOT NULL AND reminded_at IS NULL'),
    remind: db.prepare(`UPDATE ads SET reminded_at = datetime('now','localtime') WHERE id = ?`),
    run: db.prepare('INSERT INTO runs (ts, ok, fetched, new_count, matched, error, reason) VALUES (?,?,?,?,?,?,?)'),
    runs: db.prepare('SELECT * FROM runs ORDER BY rowid DESC LIMIT ?'),
    upd: db.prepare('INSERT OR IGNORE INTO updates (id) VALUES (?)'),
  };
  const plain = (r) => (r ? { ...r } : r);

  return {
    async hasAd(id) { return Boolean(s.has.get(id)); },
    async fpNotified(fp) { return Boolean(s.fp.get(fp)); },
    async saveAd(a) {
      s.ins.run(a.id, a.source, a.fingerprint, a.title, a.advertiser, a.city, a.url, a.deadline,
        a.matched_alert, a.notified_at, a.reminded_at, a.first_seen);
    },
    async countAds() { return s.count.get().n; },
    async activeAds(today) { return s.active.all(today).map(plain); },
    async dueReminders() { return s.due.all().map(plain); },
    async markReminded(id) { s.remind.run(id); },
    async addRun(r) { s.run.run(r.ts, r.ok, r.fetched, r.new_count, r.matched, r.error, r.reason ?? null); },
    async lastRuns(n) { return s.runs.all(n).map(plain); },
    async claimUpdate(id) { return s.upd.run(id).changes > 0; },
  };
}
