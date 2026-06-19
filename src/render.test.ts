import assert from 'node:assert/strict';
import { render } from './render.ts';
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

console.log('render.test.ts: ok (2 uses, symbol, fills, filter mode, bg rect)');
