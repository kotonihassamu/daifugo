import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SFX, dealPace } from '../js/ui/sfx.js';
import { CHOSEN } from '../js/ui/sound.js';

test('ゲームで使う効果音はすべて候補にある', () => {
  for (const [kind, v] of Object.entries(CHOSEN)) {
    if (v === null) continue;
    assert.ok(SFX[kind]?.items?.[v], `${kind}:${v}`);
  }
});

test('配る音は枚数が多いほど長く、極端にはならない', () => {
  const n = (cards) => dealPace(cards, 0.11, 6).n;
  assert.ok(n(27) > n(13) && n(13) > n(7));
  assert.equal(n(1), 3);
  assert.ok(n(54) <= 14);
  // 枚数がわからないときは元のパターンのまま
  assert.deepEqual(dealPace(undefined, 0.13, 6), { n: 6, gap: 0.13 });
});
