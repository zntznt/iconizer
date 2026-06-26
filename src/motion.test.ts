import assert from 'node:assert/strict';
import { render } from './render.ts';
import type { Cell } from './sample.ts';
import { defaults } from './settings.ts';

const svg = [{ innerSvg: '<rect width="24" height="24"/>', viewBox: '0 0 24 24' }];
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

// radial stagger: the wave rolls out from the centre, so the centre cells carry
// the SMALLEST delay and the corners the largest (distinct values across the grid).
{
  const { cellDelay } = await import('./motion.ts');
  const opts = { ...defaults, motionSpeed: 2, staggerMode: 'radial' as const };
  const at = (col: number, row: number) =>
    cellDelay({ col, row, r: 0, g: 0, b: 0, brightness: 0 }, 0, opts, 6, 6);
  assert.ok(at(2, 2) < at(0, 0), 'radial: centre delay < corner delay');
  assert.ok(at(2, 2) < at(5, 5), 'radial: centre delay < far corner delay');
  assert.equal(at(0, 0), at(5, 5), 'radial: symmetric corners share a delay');

  // sweep stagger: delay depends on COLUMN only — same column -> same delay,
  // a later column -> a larger delay; rows in a column are in phase.
  const sweep = { ...defaults, motionSpeed: 2, staggerMode: 'sweep' as const };
  const sw = (col: number, row: number) =>
    cellDelay({ col, row, r: 0, g: 0, b: 0, brightness: 0 }, 0, sweep, 6, 6);
  assert.equal(sw(3, 0), sw(3, 5), 'sweep: same column -> same delay (row-independent)');
  assert.ok(sw(0, 0) < sw(5, 0), 'sweep: later column -> larger delay');
}

// motion:none -> NO style/keyframes (byte-for-byte regression guard).
const still = render(grid, svg, { ...defaults, cols: 6, motion: 'none' });
assert.ok(!still.includes('@keyframes') && !still.includes('<style>'), 'motion:none -> no style');
assert.ok(!still.includes('class="motion"'), 'motion:none -> no motion class');

// random stagger is deterministic: same grid -> identical output twice.
const o = { ...defaults, cols: 6, motion: 'spin' as const, staggerMode: 'random' as const };
assert.equal(render(grid, svg, o), render(grid, svg, o), 'random stagger deterministic');

// --- layered + motion: the whole cell moves as one unit -------------------
// No per-cell isolation any more (every style blends against the shared page).
// Motion wraps the cell's blended <use> stack in ONE <g class="motion"> so the
// layers move together; the individual <use>s are never animated.
const lay = (over: Partial<typeof defaults>) =>
  render(grid, svg, { ...defaults, cols: 6, layered: true, layerStyle: 'cmy', layerCount: 3, ...over });

// layered + wiggle: a motion <g> wraps the <use> stack directly (no isolation grp).
const animated = lay({ motion: 'wiggle', staggerMode: 'none' });
assert.ok(/<g class="motion"><use/.test(animated),
  'layered motion -> motion <g> wraps the <use> stack directly');
assert.ok(!animated.includes('isolation:isolate'), 'no per-cell isolation group');
// no per-<use> animation (the layers stay static; the whole cell moves as one).
assert.ok(!/<use[^>]*class="motion"/.test(animated) && !/<use[^>]*animation/.test(animated),
  'CMY layers themselves are not animated');

// layered, no motion -> bare <use> stack, no wrapper (output unchanged).
const stillLayered = lay({ motion: 'none' });
assert.ok(!stillLayered.includes('class="motion"') && !stillLayered.includes('isolation:isolate'),
  'layered+none -> no motion wrapper, no isolation');

// solid + motion: the <use> is wrapped in a motion <g> (per-icon pivot via the
// .motion class's fill-box+center), not the motion attrs on the <use> directly.
const solid = render(grid, svg, { ...defaults, cols: 6, motion: 'wiggle', staggerMode: 'none' });
assert.ok(/<g class="motion"><use\b/.test(solid), 'solid motion -> <g> wraps the <use>');
assert.ok(!/<use[^>]*class="motion"/.test(solid), 'solid -> class on the <g>, not the <use>');

// --- "react to image": per-cell motion amplitude by brightness ---------------
// Two cells, one bright one dark, so a reactive amp must differ between them.
const ampGrid: Cell[] = [
  { col: 0, row: 0, r: 240, g: 240, b: 240, brightness: 0.95 }, // bright -> big amp
  { col: 1, row: 0, r: 20, g: 20, b: 20, brightness: 0.05 },     // dark -> small amp
];
const reactWiggle = render(ampGrid, svg, { ...defaults, cols: 2, motion: 'wiggle', staggerMode: 'none', motionReactive: true });
// amplitude keyframes fold var(--amp,1) into their magnitude.
assert.ok(reactWiggle.includes('var(--amp,1)'), 'amplitude keyframes carry var(--amp,1)');
// each cell carries an inline --amp, and the bright cell's is larger than the dark cell's.
const amps = [...reactWiggle.matchAll(/--amp:([\d.]+)/g)].map((m) => +m[1]);
assert.equal(amps.length, 2, 'reactive: one --amp per cell');
assert.ok(Math.max(...amps) > Math.min(...amps), 'bright cell amp > dark cell amp');
assert.ok(Math.min(...amps) > 0, 'dark cell still moves a little (amp floored > 0)');

// react OFF -> no per-cell --amp DECLARATION (the keyframe's var(--amp,1) fallback
// stays, giving full reach — byte-identical to the non-reactive path).
const offWiggle = render(ampGrid, svg, { ...defaults, cols: 2, motion: 'wiggle', staggerMode: 'none', motionReactive: false });
assert.ok(!/--amp:[\d.]/.test(offWiggle), 'react off -> no per-cell --amp declaration');
assert.equal(
  render(ampGrid, svg, { ...defaults, cols: 2, motion: 'wiggle', staggerMode: 'none' }), offWiggle,
  'react off is identical to default (regression guard)');

// spin + shimmer are NOT amplitude motions -> no per-cell --amp even with react on
// (and their keyframes never reference var(--amp,1) either).
for (const m of ['spin', 'shimmer'] as const) {
  const out = render(ampGrid, svg, { ...defaults, cols: 2, motion: m, staggerMode: 'none', motionReactive: true });
  assert.ok(!out.includes('--amp'), `${m} ignores react-to-image (no --amp at all)`);
}

console.log('motion.test.ts: ok (07 keyframes/pivot/stagger + layered/solid wrappers + reactive amp)');
