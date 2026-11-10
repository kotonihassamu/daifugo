import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  interpretations, canPlay, suitLockFormed, effectsOf, legalPlays, noNextNumber, direction,
} from '../js/rules.js';
import { sortCards } from '../js/cards.js';

const one = (codes) => interpretations(codes)[0];
const entry = (codes, i = 0) => {
  const c = interpretations(codes)[i];
  return { by: 'x', cards: codes, type: c.type, size: c.size, low: c.low, jr: c.jr ?? null };
};
const fx0 = { revolution: false, elevenBack: false, suitLock: null, numberLock: false };

test('単体・ペア・階段の解釈', () => {
  assert.equal(one(['S3']).type, 'single');
  assert.equal(one(['S3', 'H3']).type, 'group');
  assert.equal(one(['S3', 'H3', 'D3', 'C3']).size, 4);
  assert.deepEqual(interpretations(['S3', 'H4']), []);
  const seq = one(['S5', 'H6', 'D7']);
  assert.equal(seq.type, 'seq');
  assert.equal(seq.low, 5);
  // K-A-2 は可、A-2-3 は不可
  assert.equal(one(['SK', 'HA', 'D2']).type, 'seq');
  assert.deepEqual(interpretations(['SA', 'H2', 'D3']), []);
  // 5枚のグループは不可
  assert.deepEqual(interpretations(['S3', 'H3', 'D3', 'C3', 'JK1']).filter((x) => x.type === 'group'), []);
});

test('ジョーカー入りの解釈は複数ありうる', () => {
  const xs = interpretations(['S5', 'H6', 'JK1']);
  assert.deepEqual(xs.map((x) => x.low).sort(), [4, 5]);
  const mid = interpretations(['S9', 'JK1', 'HJ']);
  assert.equal(mid.length, 1);
  assert.equal(mid[0].jr, 10);
  const pair = interpretations(['S9', 'JK1']);
  assert.equal(pair[0].type, 'group');
  assert.equal(pair[0].low, 9);
});

test('強さと革命・11バック', () => {
  assert.ok(canPlay(one(['S4']), entry(['H3']), fx0));
  assert.ok(!canPlay(one(['S3']), entry(['H4']), fx0));
  const rev = { ...fx0, revolution: true };
  assert.ok(canPlay(one(['S3']), entry(['H4']), rev));
  assert.equal(direction({ revolution: true, elevenBack: true }), 1);
  // 単体ジョーカーは革命中でも最強
  assert.ok(canPlay(one(['JK1']), entry(['H3']), rev));
  // 枚数・形が違うと出せない
  assert.ok(!canPlay(one(['S5', 'H5']), entry(['H4']), fx0));
  assert.ok(!canPlay(one(['S5', 'H6', 'H7']), entry(['H4', 'S4', 'D4']), fx0));
});

test('スペ3返し', () => {
  const jk = entry(['JK1']);
  assert.ok(canPlay(one(['S3']), jk, fx0));
  assert.ok(!canPlay(one(['H3']), jk, fx0));
  assert.ok(!canPlay(one(['S2']), jk, fx0));
  // マーク縛り中でも返せる
  assert.ok(canPlay(one(['S3']), jk, { ...fx0, suitLock: ['H'] }));
});

test('階段は一番小さい数字で比べる', () => {
  const t = entry(['S5', 'S6', 'S7']);
  assert.ok(canPlay(one(['H6', 'H7', 'H8']), t, fx0));
  assert.ok(!canPlay(one(['H5', 'H6', 'H7']), t, fx0));
  assert.ok(canPlay(one(['H4', 'H5', 'H6']), t, { ...fx0, revolution: true }));
});

test('マーク縛りの成立', () => {
  assert.equal(suitLockFormed(entry(['H2', 'S2']), one(['H4', 'C4'])), null);
  assert.deepEqual(suitLockFormed(entry(['H2', 'S2']), one(['H4', 'S4'])), ['H', 'S']);
  // ジョーカーはどのマークにもなれる
  assert.deepEqual(suitLockFormed(entry(['H2', 'S2']), one(['H4', 'JK1'])), ['H', 'S']);
  assert.deepEqual(suitLockFormed(entry(['H2', 'JK1']), one(['H4', 'D4'])), ['D', 'H']);
  assert.equal(suitLockFormed(entry(['JK1']), one(['S3'])), null);
  const lock = { ...fx0, suitLock: ['H', 'S'] };
  assert.ok(canPlay(one(['H6', 'S6']), entry(['H4', 'S4']), lock));
  assert.ok(!canPlay(one(['H6', 'D6']), entry(['H4', 'S4']), lock));
  assert.ok(canPlay(one(['H6', 'JK1']), entry(['H4', 'S4']), lock));
});

test('数字縛り', () => {
  const nl = { ...fx0, numberLock: true };
  assert.ok(canPlay(one(['S7']), entry(['H6']), nl));
  assert.ok(!canPlay(one(['S8']), entry(['H6']), nl));
  const seqT = entry(['S6', 'S7', 'S8']);
  assert.ok(canPlay(one(['H7', 'H8', 'H9']), seqT, nl));
  assert.ok(!canPlay(one(['H8', 'H9', 'HT']), seqT, nl));
  // 革命中は1つ小さい数字
  assert.ok(canPlay(one(['S5']), entry(['H6']), { ...nl, revolution: true }));
  // 次がない
  assert.ok(noNextNumber(entry(['S2']), nl));
  assert.ok(noNextNumber(entry(['SK', 'SA', 'S2']), nl));
  assert.ok(!noNextNumber(entry(['SQ', 'SK', 'SA']), nl));
  assert.ok(noNextNumber(entry(['S3']), { ...nl, revolution: true }));
});

test('効果の検出', () => {
  const a = effectsOf(one(['S9', 'ST', 'SJ', 'SQ']));
  assert.equal(a.revolution, true);
  assert.equal(a.jack, false); // 階段の中の11では発動しない
  assert.equal(a.tens, 1);
  assert.equal(a.queens, 1);
  const b = effectsOf(one(['SJ', 'HJ']));
  assert.equal(b.jack, true);
  const c = effectsOf(interpretations(['S9', 'JK1', 'HJ'])[0]);
  assert.equal(c.tens, 1); // ジョーカーを10として使う
  const d = effectsOf(one(['S6', 'S7', 'S8']));
  assert.equal(d.eight, true);
  assert.equal(d.sevens, 1);
  assert.equal(effectsOf(one(['JK1'])).eight, false);
  assert.equal(effectsOf(one(['S5', 'H5', 'D5', 'C5'])).revolution, true);
});

test('出せる手の列挙', () => {
  const hand = ['S3', 'H5', 'D5', 'S6', 'S7', 'JK1', 'C9'];
  const single = legalPlays(hand, entry(['H8']), fx0);
  assert.deepEqual([...single.cards].sort(), ['C9', 'JK1']);
  const pair = legalPlays(hand, entry(['H4', 'S4']), fx0);
  assert.ok(pair.cards.has('H5') && pair.cards.has('JK1') && pair.cards.has('C9'));
  const seq = legalPlays(hand, entry(['H3', 'H4', 'H5']), fx0);
  assert.ok(seq.any);
  assert.ok(seq.cards.has('S6') && seq.cards.has('S7'));
  const none = legalPlays(['S3', 'S4'], entry(['H8']), fx0);
  assert.equal(none.any, false);
  // マーク縛り中の階段
  const locked = legalPlays(['H6', 'H7', 'H8', 'S9'], entry(['H3', 'H4', 'H5']), { ...fx0, suitLock: ['H', 'H', 'H'] });
  assert.ok(locked.any);
  assert.ok(!locked.cards.has('S9'));
});

test('並び替え', () => {
  assert.deepEqual(sortCards(['S2', 'JK1', 'D3', 'S3', 'HA']), ['D3', 'S3', 'HA', 'S2', 'JK1']);
  assert.deepEqual(sortCards(['S2', 'D3', 'HA'], 'strength', true), ['D3', 'HA', 'S2'].reverse());
});
