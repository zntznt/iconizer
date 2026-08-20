import assert from 'node:assert/strict';
import { svgBlob, exportSize, gifExportSize } from './export.ts';

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

// The GIF path is capped harder than PNG, because it holds every frame at once.
const gif1 = gifExportSize(square, 1);
assert.equal(Math.max(gif1.w, gif1.h), 720, 'gif 1x is the plain base, cap not binding');
const gif2 = gifExportSize(square, 2);
assert.equal(Math.max(gif2.w, gif2.h), 1440, 'gif 2x reaches the cap exactly');
const gif4 = gifExportSize(square, 4); // 2880 -> capped
assert.equal(Math.max(gif4.w, gif4.h), 1440, 'gif 4x is capped to MAX_GIF_SIDE');
const gifWide = gifExportSize('<svg width="200" height="50"><rect/></svg>', 4);
assert.equal(gifWide.w, 1440, 'gif cap applies to the long side');
assert.equal(gifWide.h, 360, 'gif cap preserves the aspect ratio');
// and the cap is GIF-only: the PNG path still runs to its own MAX_SIDE clamp.
assert.equal(Math.max(...Object.values(exportSize(square, 1500, 4))), 4096, 'png path untouched by the gif cap');

console.log('export.test.ts: ok (blob round-trip + exportSize clamp + gif memory cap)');
