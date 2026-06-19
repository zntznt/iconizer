import assert from 'node:assert/strict';
import { transformColor, type RGB } from './color.ts';

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

console.log('color.test.ts: ok (grayscale, invert, posterize, palette, none)');
