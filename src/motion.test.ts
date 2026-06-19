import assert from 'node:assert/strict';
import { render } from './render.ts';
import type { Cell } from './sample.ts';
import { defaults } from './settings.ts';

const svg = { innerSvg: '<rect width="24" height="24"/>', viewBox: '0 0 24 24' };
// 6x6 grid so stagger has distinct cells.
const grid: Cell[] = [];
for (let row = 0; row < 6; row++)
  for (let col = 0; col < 6; col++)
    grid.push({ col, row, r: 120, g: 120, b: 120, brightness: 0.47 });

// spin: keyframes + pivot guard + reduce-motion block + motion class present.
const spin = render(grid, svg, { ...defaults, cols: 6, motion: 'spin', staggerMode: 'none' });
assert.ok(spin.includes('@keyframes'), 'spin emits @keyframes');
assert.ok(spin.includes('transform-box:fill-box'), 'pivot guard present');
assert.ok(spin.includes('prefers-reduced-motion'), 'reduce-motion guard present');
assert.ok(spin.includes('class="motion"'), 'cells carry the motion class');

// ripple stagger: distinct animation-delay across cells ((0,0) != (5,5)).
const ripple = render(grid, svg, { ...defaults, cols: 6, motion: 'spin', staggerMode: 'ripple' });
const delays = [...ripple.matchAll(/animation-delay:([\d.]+)s/g)].map((m) => +m[1]);
assert.ok(new Set(delays).size > 1, 'ripple -> multiple distinct delays');

// none stagger: no delay attrs at all (all in phase).
const noStag = render(grid, svg, { ...defaults, cols: 6, motion: 'spin', staggerMode: 'none' });
assert.ok(!noStag.includes('animation-delay'), 'staggerMode:none -> no delays');

// motion:none -> NO style/keyframes (byte-for-byte regression guard).
const still = render(grid, svg, { ...defaults, cols: 6, motion: 'none' });
assert.ok(!still.includes('@keyframes') && !still.includes('<style>'), 'motion:none -> no style');
assert.ok(!still.includes('class="motion"'), 'motion:none -> no motion class');

// random stagger is deterministic: same grid -> identical output twice.
const o = { ...defaults, cols: 6, motion: 'spin' as const, staggerMode: 'random' as const };
assert.equal(render(grid, svg, o), render(grid, svg, o), 'random stagger deterministic');

console.log('motion.test.ts: ok (keyframes, pivot, reduce-motion, stagger, none, deterministic)');
