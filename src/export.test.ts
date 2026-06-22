import assert from 'node:assert/strict';
import { svgBlob, exportSize } from './export.ts';

const svg = '<svg width="48" height="32"><rect/></svg>';
const blob = svgBlob(svg);

assert.equal(blob.type, 'image/svg+xml', `type, got ${blob.type}`);

const text = await blob.text();
assert.equal(text, svg, 'blob text must round-trip the input svg string');

// exportSize: longest side scales to base*scale, ratio preserved, clamped <=4096.
const square = '<svg width="100" height="100"><rect/></svg>';
const a = exportSize(square, 1500, 1);
assert.equal(Math.max(a.w, a.h), 1500, 'longest side hits base at scale 1');
const b = exportSize(square, 1500, 4); // 6000 -> clamped
assert.equal(Math.max(b.w, b.h), 4096, 'longest side clamped to MAX_SIDE (no blank canvas)');
const wide = exportSize('<svg width="200" height="50"><rect/></svg>', 1500, 4); // 6000 -> 4096
assert.equal(wide.w, 4096, 'wide image: long side clamped');
assert.equal(wide.h, 1024, 'wide image: aspect ratio preserved after clamp');

console.log('export.test.ts: ok (blob round-trip + exportSize clamp)');
