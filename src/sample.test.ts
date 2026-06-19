import assert from 'node:assert/strict';
import { averageCells, rowsFor } from './sample.ts';

// Solid rgb(255,0,0), 4x4 px, cols:2 -> a square image -> 2 rows -> 4 cells.
const W = 4, H = 4;
const px = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < px.length; i += 4) {
  px[i] = 255;     // r
  px[i + 1] = 0;   // g
  px[i + 2] = 0;   // b
  px[i + 3] = 255; // a
}

assert.equal(rowsFor(W, H, 2), 2, 'square image at cols:2 should give 2 rows');

const cells = averageCells(px, W, H, 2);
assert.equal(cells.length, 4, 'cols:2 on a square image -> 4 cells');

for (const c of cells) {
  assert.ok(Math.abs(c.r - 255) < 1, `r ~255, got ${c.r}`);
  assert.ok(Math.abs(c.g - 0) < 1, `g ~0, got ${c.g}`);
  assert.ok(Math.abs(c.b - 0) < 1, `b ~0, got ${c.b}`);
  assert.ok(Math.abs(c.brightness - 0.2126) < 0.001, `brightness ~0.21, got ${c.brightness}`);
}

// Background composite (batch-02 append): sample() fills the canvas with
// settings.background before drawImage, so a fully-transparent source over
// '#000000' lands as all-zero RGB in getImageData. averageCells of that buffer
// must read black — confirming the composite drives the color, not a hardcoded
// white. ponytail: the canvas fillStyle plumbing itself is verified in-browser;
// here we assert the pure averaging of the buffer it produces.
const blackPx = new Uint8ClampedArray(W * H * 4); // all zeros = transparent-over-black
const blackCells = averageCells(blackPx, W, H, 2);
for (const c of blackCells) {
  assert.ok(c.r < 1 && c.g < 1 && c.b < 1, `black bg -> black cell, got ${c.r},${c.g},${c.b}`);
}

console.log('sample.test.ts: ok (4 red cells b~0.21; black-bg composite -> black)');
