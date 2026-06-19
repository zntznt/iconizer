import assert from 'node:assert/strict';
import { render, emitCell } from './render.ts';
import type { Cell } from './sample.ts';
import { defaults } from './settings.ts';

const grid: Cell[] = [
  { col: 0, row: 0, r: 255, g: 0, b: 0, brightness: 0.21 },
  { col: 1, row: 0, r: 0, g: 0, b: 255, brightness: 0.07 },
];
const svg = { innerSvg: '<rect width="24" height="24"/>', viewBox: '0 0 24 24' };

const out = render(grid, svg, { ...defaults, cols: 2, tintMode: 'fill' });

const useCount = (out.match(/<use\b/g) ?? []).length;
assert.equal(useCount, 2, `expected 2 <use, got ${useCount}`);
assert.ok(out.includes('<symbol id="icon"'), 'expected one <symbol id="icon"');
assert.ok(out.includes('fill="rgb(255,0,0)"'), 'expected a red fill');
assert.ok(out.includes('fill="rgb(0,0,255)"'), 'expected a blue fill');

// filter mode: no fills, one filter ref per cell, shared defs collapse dupes.
const fout = render(grid, svg, { ...defaults, cols: 2, tintMode: 'filter' });
assert.ok(!fout.includes('fill="rgb('), 'filter mode should not set rgb fills');
assert.equal((fout.match(/filter="url\(#/g) ?? []).length, 2, 'two filtered uses');

// background rect uses settings.background, behind the uses (batch-02 append).
const bgOut = render(grid, svg, { ...defaults, cols: 2, background: '#000000' });
assert.ok(bgOut.includes('<rect width="32" height="16" fill="#000000"/>'),
  'expected a full-size background rect in the chosen color');
assert.ok(bgOut.indexOf('<rect') < bgOut.indexOf('<use'), 'bg rect must precede uses');

// Layered CMY (batch-04). Multiply-blend mechanism: each ink subtracts one
// channel; baking strength into the ink color makes 3 inks multiply to (r,g,b).
const mid: Cell = { col: 0, row: 0, r: 180, g: 90, b: 40, brightness: 0.4 };

const layered = emitCell(mid, { ...defaults, layered: true, layerCount: 3, layerOffset: 0 });
assert.equal((layered.match(/<use\b/g) ?? []).length, 3, 'layered:3 -> 3 <use>');
assert.equal((layered.match(/mix-blend-mode:multiply/g) ?? []).length, 3,
  'all 3 layers multiply-blended');

// The 3 ink fills, multiplied together against white, must equal the cell color.
// Each fill dims exactly one channel to 255*(1-strength); product per channel
// = that single dimmed value. Cyan->r=180, magenta->g=90, yellow->b=40.
const fills = [...layered.matchAll(/color="rgb\((\d+),(\d+),(\d+)\)"/g)]
  .map((m) => [+m[1], +m[2], +m[3]]);
assert.equal(fills.length, 3, '3 rgb ink colors');
const product = [0, 1, 2].map((ch) =>
  Math.round(fills.reduce((acc, f) => (acc * f[ch]) / 255, 255)));
for (const [ch, want] of [[0, 180], [1, 90], [2, 40]] as const) {
  assert.ok(Math.abs(product[ch] - want) <= 1,
    `inks multiply to cell color on ch${ch}: want ${want}, got ${product[ch]}`);
}

// layered:false -> exactly 1 <use> (solid path unchanged).
const solid = emitCell(mid, { ...defaults, layered: false });
assert.equal((solid.match(/<use\b/g) ?? []).length, 1, 'layered:false -> 1 <use>');

// iconScale: a global multiplier > 1 makes the icon bigger than its cell, so it
// overlaps (negative pad). CELL is 16 internally; scale 2 -> 32px icon at -8,-8.
const big = emitCell({ ...mid, col: 0, row: 0 }, { ...defaults, layered: false, iconScale: 2 });
assert.ok(big.includes('width="32" height="32"'), 'iconScale 2 -> icon 2x cell');
assert.ok(big.includes('x="-8"'), 'oversized icon is centered (negative pad -> overlaps)');

// blockSize: merge NxN sample cells into one averaged icon. 4x4 grid, block 2 ->
// 2x2 = 4 icons (vs 16), each the average of its block.
const g16: Cell[] = [];
for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++)
  g16.push({ col: c, row: r, r: 120, g: 120, b: 120, brightness: 0.47 });
const svg2 = { innerSvg: '<rect width="24" height="24"/>', viewBox: '0 0 24 24' };
const r1 = render(g16, svg2, { ...defaults, cols: 4, blockSize: 1 });
const r2x = render(g16, svg2, { ...defaults, cols: 4, blockSize: 2 });
assert.equal((r1.match(/<use/g) ?? []).length, 16, 'block 1 -> one icon per cell');
assert.equal((r2x.match(/<use/g) ?? []).length, 4, 'block 2 -> 4 merged icons');
// Canvas footprint stays constant: rendered width/height is the same for both,
// only the viewBox (internal coord space) shrinks so icons scale up to fill.
const px = (s: string) => s.match(/width="(\d+)" height="(\d+)"/)!.slice(1, 3).join('x');
assert.equal(px(r1), px(r2x), 'block does NOT change canvas size — icons grow to fill');
assert.ok(/viewBox="0 0 64 64"/.test(r1) && /viewBox="0 0 32 32"/.test(r2x),
  'viewBox shrinks with block (64->32) while rendered px is constant');

// Scheme composes with BOTH modes (batch-05). render() transforms upstream, so
// a scheme must reach the layered path too — not just the solid branch.
const cell: Cell[] = [{ col: 0, row: 0, r: 200, g: 100, b: 50, brightness: 0.5 }];
const tinySvg = { innerSvg: '<rect width="24" height="24"/>', viewBox: '0 0 24 24' };

// invert(200,100,50) = (55,155,205). Layered inks must multiply to THAT, not the
// original — proving the scheme reached emitLayered, not just the solid path.
const inv = render(cell, tinySvg,
  { ...defaults, cols: 1, layered: true, layerCount: 3, scheme: { kind: 'invert' } });
const invFills = [...inv.matchAll(/color="rgb\((\d+),(\d+),(\d+)\)"/g)].map((m) => [+m[1], +m[2], +m[3]]);
const invProduct = [0, 1, 2].map((ch) =>
  Math.round(invFills.reduce((acc, f) => (acc * f[ch]) / 255, 255)));
assert.deepEqual(invProduct, [55, 155, 205], `layered+invert -> inverted color, got ${invProduct}`);

// Same scheme reaches the solid path's fill.
const invSolid = render(cell, tinySvg,
  { ...defaults, cols: 1, tintMode: 'fill', scheme: { kind: 'invert' } });
assert.ok(invSolid.includes('fill="rgb(55,155,205)"'), 'solid+invert -> inverted fill');

console.log('render.test.ts: ok (solid + filter + bg + layered CMY + scheme compose)');
