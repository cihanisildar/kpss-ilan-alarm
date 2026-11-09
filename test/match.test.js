import { test } from 'node:test';
import assert from 'node:assert/strict';
import { norm, extractDeadline } from '../src/text.js';
import { compileAlert, textMatches, cityMatches } from '../src/match.js';
import { REGIONS } from '../src/regions.js';

test('türkçe normalizasyon', () => {
  assert.equal(norm('BİLGİSAYAR MÜHENDİSİ'), 'bilgisayar muhendisi');
  assert.equal(norm('IŞIK'), 'isik');
});

test('bölgeler 81 ili tam bir kez kapsar', () => {
  const all = Object.values(REGIONS).flat();
  assert.equal(all.length, 81);
  assert.equal(new Set(all).size, 81);
});

test('eşleştirme', () => {
  const a = compileAlert({ name: 'x', regions: ['Marmara'], keywords: ['bilgisayar muhendis'], exclude: ['ogretim uyesi'] });
  assert.ok(cityMatches(a, { city: 'KOCAELİ' }));
  assert.ok(!cityMatches(a, { city: 'ANKARA' }));
  assert.ok(textMatches(a, 'Bilgisayar Mühendisi alımı'));
  assert.ok(!textMatches(a, 'Öğretim Üyesi (Bilgisayar Mühendisliği)'));
});

test('son başvuru tarihi', () => {
  assert.equal(extractDeadline('Son Başvuru Tarihi: 6.11.2026'), '2026-11-06');
  assert.equal(extractDeadline('yok'), null);
});
