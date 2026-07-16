import assert from 'node:assert/strict';
import { defaults } from './settings.ts';
import { encodeSettings, decodeSettings, rollRandom, rollWithLocks, LOCK_GROUPS } from './permalink.ts';

// btoa/atob exist in Node 26 globals — same as the browser.

// Round-trip: encode then decode returns an equivalent settings object.
const tweaked = { ...defaults, cols: 50, layered: true, motion: 'wiggle' as const };
const round = decodeSettings('#' + encodeSettings(tweaked));
assert.deepEqual(round, tweaked, 'encode->decode round-trips');

// Forward/backward compatible: a hash missing a field still loads, field defaults.
const partial = '#' + btoa(JSON.stringify({ cols: 99 }));
const loaded = decodeSettings(partial);
assert.equal(loaded?.cols, 99, 'present field loads');
assert.equal(loaded?.motion, defaults.motion, 'missing field falls back to default');

// Garbage / empty hash -> null (caller uses defaults).
assert.equal(decodeSettings('#not-base64-@@@'), null, 'garbage hash -> null');
assert.equal(decodeSettings(''), null, 'empty hash -> null');

// rollRandom is deterministic given an injected rnd source, and stays in-range.
const seq = [0.1, 0.9, 0.5, 0.2, 0.8, 0.3, 0.6, 0.4, 0.7, 0.15, 0.85, 0.25, 0.55, 0.95];
let i = 0;
const rnd = () => seq[i++ % seq.length];
i = 0; const a = rollRandom(rnd);
i = 0; const b = rollRandom(rnd);
assert.deepEqual(a, b, 'same rnd sequence -> same settings (deterministic)');
assert.ok(a.cols >= 12 && a.cols <= 75, `cols in range, got ${a.cols}`);
assert.ok(a.iconScale >= 0.6 && a.iconScale <= 2.4, `iconScale in range, got ${a.iconScale}`);
// a rolled settings must itself round-trip (no un-encodable values).
assert.deepEqual(decodeSettings('#' + encodeSettings(a)), a, 'rolled settings round-trips');

// rollRandom must NEVER produce the heavy combo (layered + motion together).
// Sweep many rnd sequences to exercise the flavor branch.
for (let s = 0; s < 200; s++) {
  let k = s;
  const r = rollRandom(() => { k = (k * 1103515245 + 12345) & 0x7fffffff; return (k % 1000) / 1000; });
  assert.ok(!(r.layered && r.motion !== 'none'),
    `roll #${s} must not enable layered + motion together (got layered=${r.layered}, motion=${r.motion})`);
}

// Every curated preset must be a COMPLETE Settings (all keys present, so a preset
// can't silently drop a field to undefined) and must round-trip through the hash.
{
  const { PRESETS } = await import('./presets.ts');
  const keys = Object.keys(defaults).sort();
  for (const p of PRESETS) {
    assert.ok(p.name && p.caption, `preset has name + caption: ${p.name}`);
    assert.deepEqual(Object.keys(p.settings).sort(), keys, `preset "${p.name}" has all Settings keys`);
    assert.deepEqual(decodeSettings('#' + encodeSettings(p.settings)), p.settings,
      `preset "${p.name}" round-trips through the permalink`);
  }
}

// --- rollWithLocks: held reels stay, unlocked reroll, never a heavy combo -----
{
  // a recognizable "current" look, and a roll that differs in every group.
  const current = { ...defaults, cols: 10, layered: true, layerStyle: 'rgb' as const,
    scheme: { kind: 'invert' as const }, motion: 'spin' as const };
  const roll = { ...defaults, cols: 99, layered: false, layerStyle: 'cmy' as const,
    scheme: { kind: 'sepia' as const }, motion: 'bob' as const, motionSpeed: 3 };

  // lock SCHEME only: scheme is kept from current, everything else takes the roll.
  const a = rollWithLocks(current, roll, new Set(['scheme']));
  assert.deepEqual(a.scheme, current.scheme, 'locked scheme is kept');
  assert.equal(a.cols, roll.cols, 'unlocked grid takes the roll');
  assert.equal(a.motion, roll.motion, 'unlocked motion takes the roll');

  // nothing locked: every group takes the roll (a plain reroll).
  const b = rollWithLocks(current, roll, new Set());
  for (const keys of Object.values(LOCK_GROUPS)) for (const k of keys)
    assert.deepEqual((b as Record<string, unknown>)[k], (roll as Record<string, unknown>)[k],
      `unlocked key ${k} takes the roll`);

  // HEAVY-COMBO GUARD, branch 1 — layer locked ON, motion rerolls ON: drop motion
  // (the unlocked side), so the result is never layered + motion.
  const lockLayerOn = rollWithLocks(
    { ...defaults, layered: true }, { ...defaults, motion: 'wiggle' as const }, new Set(['layer']));
  assert.ok(lockLayerOn.layered && lockLayerOn.motion === 'none',
    'layer locked on + motion rerolled -> motion dropped (no heavy combo)');

  // branch 2 — motion locked ON, layer rerolls ON: drop layered instead.
  const lockMotionOn = rollWithLocks(
    { ...defaults, motion: 'wiggle' as const }, { ...defaults, layered: true }, new Set(['motion']));
  assert.ok(lockMotionOn.motion !== 'none' && !lockMotionOn.layered,
    'motion locked on + layer rerolled -> layered dropped (no heavy combo)');

  // exhaustively: across many rolls and every lock subset, the result is NEVER heavy.
  const groups = Object.keys(LOCK_GROUPS);
  for (let mask = 0; mask < (1 << groups.length); mask++) {
    const set = new Set(groups.filter((_, i) => mask & (1 << i)));
    let k = mask + 1;
    const r = rollRandom(() => { k = (k * 1103515245 + 12345) & 0x7fffffff; return (k % 1000) / 1000; });
    // start from a heavy current to stress the guard hardest.
    const merged = rollWithLocks({ ...defaults, layered: true, motion: 'spin' }, r, set);
    assert.ok(!(merged.layered && merged.motion !== 'none'),
      `lock set {${[...set]}} must never yield heavy combo`);
  }
}

console.log('permalink.test.ts: ok (round-trip, compat, garbage, roll never heavy-combo, presets, locks)');
