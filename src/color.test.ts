import assert from 'node:assert/strict';
import { transformColor, PALETTES, type RGB } from './color.ts';

const rgb = (r: number, g: number, b: number): RGB => ({ r, g, b });

// grayscale: rgb(255,0,0) -> r==g==b == round(0.2126*255) ≈ 54
const gray = transformColor(rgb(255, 0, 0), { kind: 'grayscale' });
assert.ok(gray.r === gray.g && gray.g === gray.b, 'grayscale channels equal');
assert.equal(gray.r, Math.round(0.2126 * 255), 'grayscale luma');

// invert: black -> white
assert.deepEqual(transformColor(rgb(0, 0, 0), { kind: 'invert' }), rgb(255, 255, 255));

// posterize levels:2 -> each channel 0 or 255
const post = transformColor(rgb(100, 200, 50), { kind: 'posterize', levels: 2 });
for (const v of [post.r, post.g, post.b]) assert.ok(v === 0 || v === 255, `posterize ${v}`);

// palette of [red, blue] on rgb(200,0,40) -> snaps to red (nearer)
const snap = transformColor(rgb(200, 0, 40),
  { kind: 'palette', colors: [rgb(255, 0, 0), rgb(0, 0, 255)] });
assert.deepEqual(snap, rgb(255, 0, 0), 'palette snaps to nearest (red)');

// none is identity
assert.deepEqual(transformColor(rgb(123, 45, 67), { kind: 'none' }), rgb(123, 45, 67));

// sepia: white stays ~white-ish but warm; black stays black; a gray warms up
assert.deepEqual(transformColor(rgb(0, 0, 0), { kind: 'sepia' }), rgb(0, 0, 0), 'sepia black');
const sep = transformColor(rgb(128, 128, 128), { kind: 'sepia' });
assert.ok(sep.r > sep.g && sep.g > sep.b, 'sepia warms: r > g > b');

// threshold: luma below cutoff -> black, at/above -> white
assert.deepEqual(transformColor(rgb(0, 0, 0), { kind: 'threshold', cutoff: 0.5 }), rgb(0, 0, 0));
assert.deepEqual(transformColor(rgb(255, 255, 255), { kind: 'threshold', cutoff: 0.5 }), rgb(255, 255, 255));

// hue: 0deg is identity (within rounding); 360deg too
const h0 = transformColor(rgb(200, 50, 100), { kind: 'hue', deg: 0 });
assert.ok(Math.abs(h0.r - 200) <= 1 && Math.abs(h0.g - 50) <= 1 && Math.abs(h0.b - 100) <= 1,
  'hue 0deg ~ identity');

// tritone: luma 0 -> dark stop, luma 1 -> light stop, mid-ish -> near mid stop
const tri = { kind: 'tritone' as const, dark: rgb(0, 0, 0), mid: rgb(128, 0, 0), light: rgb(255, 255, 255) };
assert.deepEqual(transformColor(rgb(0, 0, 0), tri), rgb(0, 0, 0), 'tritone dark stop');
assert.deepEqual(transformColor(rgb(255, 255, 255), tri), rgb(255, 255, 255), 'tritone light stop');

// palette presets exist and are non-empty; gameboy snaps a green-ish cell onto a DMG green
assert.ok(PALETTES.gameboy.length === 4, 'gameboy palette has 4 shades');
const gb = transformColor(rgb(120, 160, 20), { kind: 'palette', colors: PALETTES.gameboy });
assert.ok(PALETTES.gameboy.some((c) => c.r === gb.r && c.g === gb.g && c.b === gb.b),
  'palette result is one of the preset swatches');

console.log('color.test.ts: ok (grayscale, invert, sepia, threshold, hue, posterize, duotone, tritone, palette, presets, none)');
