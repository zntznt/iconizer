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

// --- batch-07b: per-layer 'apart' motion ---------------------------------
const lay = (over: Partial<typeof defaults>) =>
  render(grid, svg, { ...defaults, cols: 6, layered: true, layerCount: 3, ...over });

// apart + wiggle (small-displacement, allowed): the 3 <use> in a cell have 3
// DISTINCT animation-delay values (per-layer phase offset present).
const apart = lay({ motion: 'wiggle', layerMotion: 'apart', staggerMode: 'none' });
// first cell = first <g>...</g>; pull its 3 use delays
const firstG = apart.slice(apart.indexOf('<g'), apart.indexOf('</g>'));
const layerDelays = [...firstG.matchAll(/animation-delay:([\d.]+)s/g)].map((m) => m[1]);
assert.equal(layerDelays.length, 3, 'apart -> 3 per-layer delays');
assert.equal(new Set(layerDelays).size, 3, 'apart -> 3 DISTINCT delays');
// merged into ONE style (multiply + animation together), no second style attr
assert.ok(firstG.includes('mix-blend-mode:multiply;') && firstG.includes('animation:mo'),
  'apart merges blend + animation in one style');
assert.ok(!/<use[^>]*style="[^"]*"[^>]*style=/.test(firstG), 'no double style attr');

// together: class on the <g>, NOT on the <use>s (batch-07 structure).
const together = lay({ motion: 'wiggle', layerMotion: 'together' });
assert.ok(together.includes('<g style="isolation:isolate" class="motion"'), 'together -> class on <g>');
assert.ok(!/<use[^>]*class="motion"/.test(together), 'together -> no class on <use>');

// spin/pulse TEAR: apart falls back to together (class on <g>, not per-use anim).
const spinApart = lay({ motion: 'spin', layerMotion: 'apart' });
assert.ok(spinApart.includes('<g style="isolation:isolate" class="motion"'),
  'spin+apart -> fell back to together (<g> carries motion)');
assert.ok(!/<use[^>]*animation:mo/.test(spinApart), 'spin+apart -> no per-layer animation');

// layerMotion inert when not layered, or motion none.
const notLayered = render(grid, svg, { ...defaults, cols: 6, layered: false, motion: 'wiggle', layerMotion: 'apart' });
assert.ok(!notLayered.includes('isolation:isolate'), 'not layered -> no CMY groups, apart inert');
const noMotion = lay({ motion: 'none', layerMotion: 'apart' });
assert.ok(!noMotion.includes('animation'), 'motion:none -> apart inert, no animation');

console.log('motion.test.ts: ok (07 keyframes/pivot/stagger + 07b apart/gate/inert)');
