import assert from 'node:assert/strict';
import { defaults } from './settings.ts';
import { encodeSettings, decodeSettings, rollRandom } from './permalink.ts';

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

console.log('permalink.test.ts: ok (round-trip, compat, garbage, deterministic roll)');
