import assert from 'node:assert/strict';
import { render, emitCell } from './render.ts';
import type { Cell } from './sample.ts';
import { defaults } from './settings.ts';

const grid: Cell[] = [
  { col: 0, row: 0, r: 255, g: 0, b: 0, brightness: 0.21 },
  { col: 1, row: 0, r: 0, g: 0, b: 255, brightness: 0.07 },
];
const svg = [{ innerSvg: '<rect width="24" height="24"/>', viewBox: '0 0 24 24', singleShape: true }];

const out = render(grid, svg, { ...defaults, cols: 2 });

const useCount = (out.match(/<use\b/g) ?? []).length;
assert.equal(useCount, 2, `expected 2 <use, got ${useCount}`);
assert.ok(out.includes('<symbol id="icon0"'), 'expected one <symbol id="icon0"');
assert.ok(out.includes('href="#icon0"'), 'single icon -> uses reference #icon0');
assert.ok(out.includes('fill="rgb(255,0,0)"'), 'expected a red fill');
assert.ok(out.includes('fill="rgb(0,0,255)"'), 'expected a blue fill');
// solid tinting via color=/fill=, never SVG filters (those re-rasterize per frame
// when animated and caused the motion lag — removed).
assert.ok(!out.includes('filter="url(#') && !out.includes('<filter'),
  'no per-cell SVG filters (color-based tinting only)');

// background rect uses settings.background, behind the uses (batch-02 append).
const bgOut = render(grid, svg, { ...defaults, cols: 2, background: '#000000' });
assert.ok(bgOut.includes('<rect width="32" height="16" fill="#000000"/>'),
  'expected a full-size background rect in the chosen color');
assert.ok(bgOut.indexOf('<rect') < bgOut.indexOf('<use'), 'bg rect must precede uses');

// --- LIVE mode: inlines shapes, no <use>/<symbol> (perf: no shadow-tree/cell) ---
const live = render(grid, svg, { ...defaults, cols: 2 }, 'live');
assert.ok(!live.includes('<use'), 'live: no <use> (inlined)');
assert.ok(!live.includes('<symbol') && !live.includes('<defs'), 'live: no <symbol>/<defs>');
// SINGLE-SHAPE icon (<rect>) -> the transform is SPLICED into the shape, NO <g>
// wrapper (the ~16x-faster fast path). The tag becomes <rect transform=... .../>.
assert.ok(/<rect transform="translate\([\d.]+ [\d.]+\) scale\(0\.67\)"/.test(live),
  'live single-shape: transform spliced into the <rect>, scale 16/24=0.67');
assert.ok(!live.includes('<g transform='), 'live single-shape: no per-cell <g> wrapper');
assert.equal((live.match(/<rect transform=/g) ?? []).length, 2, 'live: one drawable per cell');
assert.ok(live.includes('color="rgb(255,0,0)"') && live.includes('color="rgb(0,0,255)"'),
  'live: tint colour preserved on the shape');

// MULTI-SHAPE icon -> falls back to the <g transform> wrapper (one group/cell).
const multi = [{ innerSvg: '<rect width="24" height="24"/><circle r="6"/>', viewBox: '0 0 24 24', singleShape: false }];
const liveMulti = render(grid, multi, { ...defaults, cols: 2 }, 'live');
assert.ok(/<g transform="translate\([\d.]+ [\d.]+\) scale\(0\.67\)"[^>]*>/.test(liveMulti),
  'live multi-shape: wraps the icon in a translate+scale <g>');
assert.equal((liveMulti.match(/<g transform=/g) ?? []).length, 2, 'live multi: one group per cell');

// single-shape with LEADING whitespace/comment (innerHTML can carry these): the
// splice must target the real <path tag, not the leading text — else corrupt SVG.
const ws = [{ innerSvg: '\n  <!-- icon -->\n  <path d="M0 0" fill="currentColor"/>', viewBox: '0 0 24 24', singleShape: true }];
const liveWs = render(grid, ws, { ...defaults, cols: 2 }, 'live');
assert.ok(/<path transform="[^"]+" fill="rgb\(255,0,0\)"/.test(liveWs),
  'live: splice targets the <path even past leading whitespace/comment');
assert.ok(liveWs.includes('<!-- icon -->'), 'live: leading comment preserved, not clobbered');

// Layered CMY (batch-04). Multiply-blend mechanism: each ink subtracts one
// channel; baking strength into the ink color makes 3 inks multiply to (r,g,b).
const mid: Cell = { col: 0, row: 0, r: 180, g: 90, b: 40, brightness: 0.4 };

const layered = emitCell(mid, { ...defaults, layered: true, layerStyle: 'cmy', layerCount: 3, layerOffset: 0 });
assert.equal((layered.match(/<use\b/g) ?? []).length, 3, 'layered:3 -> 3 <use>');
assert.equal((layered.match(/mix-blend-mode:multiply/g) ?? []).length, 3,
  'all 3 layers multiply-blended');
// CMY now blends against the WHITE page (no per-cell rect / isolation group).
assert.ok(!layered.includes('isolation:isolate'), 'CMY: no per-cell isolation (multiply on white page)');
assert.ok(!layered.includes('<rect'), 'CMY: no per-cell white backing rect');

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

// sizeByBrightness degenerate guards: range [0,0] must not zero icons out (blank
// mosaic looks like a bug), and min>max must not invert the lerp.
const zero = emitCell(mid, { ...defaults, layered: false, sizeByBrightness: true, sizeRange: [0, 0] });
const zeroW = +(zero.match(/width="([\d.]+)"/)?.[1] ?? '0');
assert.ok(zeroW > 0, `sizeRange [0,0] floors above zero (icons tiny, not gone), got ${zeroW}`);
const inverted = emitCell(mid, { ...defaults, layered: false, sizeByBrightness: true, sizeRange: [0.8, 0.1] });
assert.ok((inverted.match(/width="([\d.]+)"/)?.[1] ?? '') !== '', 'min>max renders a valid (sorted) size');

// size-by-brightness is area-linear (sqrt of lerp(lo², hi²)), not linear in the
// scale factor — so a midtone icon covers more than the naive linear midpoint
// would (that's the fix for "too thin until it jumps big"). CELL=16, range [0.2,1].
const half: Cell = { col: 0, row: 0, r: 119, g: 119, b: 119, brightness: 0.5 };
const areaLin = emitCell(half, { ...defaults, layered: false, sizeByBrightness: true, sizeRange: [0.2, 1] });
const halfW = +(areaLin.match(/width="([\d.]+)"/)?.[1] ?? '0');
const expected = 16 * Math.sqrt(0.2 * 0.2 + (1 - 0.2 * 0.2) * 0.5); // ≈ 16*0.721 = 11.54
assert.ok(Math.abs(halfW - expected) < 0.2, `area-linear midtone width ~${expected.toFixed(2)}, got ${halfW}`);
assert.ok(halfW > 16 * (0.2 + (1 - 0.2) * 0.5), 'area-linear midtone is larger than the old linear ramp');

// rotation: 'fixed' tilts every cell by rotateDeg via an in-place rotate group.
const rotFixed = emitCell(mid, { ...defaults, rotate: 'fixed', rotateDeg: 30 });
assert.ok(rotFixed.includes('transform:rotate(30deg)'), 'fixed rotation applies rotateDeg');
assert.ok(rotFixed.includes('transform-box:fill-box') && rotFixed.includes('transform-origin:center'),
  'rotation pivots in place (fill-box + center)');
// 'brightness' scales the angle by tone: mid (0.4) * 50 = 20deg.
const rotBri = emitCell({ ...mid, brightness: 0.4 }, { ...defaults, rotate: 'brightness', rotateDeg: 50 });
assert.ok(rotBri.includes('transform:rotate(20deg)'), 'brightness rotation = brightness * rotateDeg');
// 'none' (default) emits no rotation wrapper — output unchanged.
assert.ok(!emitCell(mid, defaults).includes('transform:rotate'), 'no rotation by default');

// opacity: fadeByBrightness ramps the leaf <use> opacity over brightness.
// range [0,1], brightness 0.4 -> opacity 0.4.
const faded = emitCell({ ...mid, brightness: 0.4 }, { ...defaults, fadeByBrightness: true, fadeRange: [0, 1] });
assert.ok(faded.includes('opacity="0.4"'), 'fade maps brightness onto leaf opacity');
assert.ok(!emitCell(mid, defaults).includes('opacity='), 'no opacity attr by default (fully opaque)');

// gradient overlay maps grid position across the wash: with the 2-col `grid`, a
// horizontal 'fire' overlay at full mix puts col0 at u=0 (black) and col1 at u=1
// (white) — verifies overlayU + overlayColor flow through render().
const ovOut = render(grid, svg, { ...defaults, cols: 2,
  overlay: { dir: 'h', preset: 'fire', blend: 'mix', strength: 1 } });
assert.ok(ovOut.includes('fill="rgb(0,0,0)"') && ovOut.includes('fill="rgb(255,255,255)"'),
  'horizontal overlay washes cols from the first to the last gradient stop');

// blockSize: merge NxN sample cells into one averaged icon. 4x4 grid, block 2 ->
// 2x2 = 4 icons (vs 16), each the average of its block.
const g16: Cell[] = [];
for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++)
  g16.push({ col: c, row: r, r: 120, g: 120, b: 120, brightness: 0.47 });
const svg2 = [{ innerSvg: '<rect width="24" height="24"/>', viewBox: '0 0 24 24', singleShape: true }];
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
const tinySvg = [{ innerSvg: '<rect width="24" height="24"/>', viewBox: '0 0 24 24', singleShape: true }];

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
  { ...defaults, cols: 1, scheme: { kind: 'invert' } });
assert.ok(invSolid.includes('fill="rgb(55,155,205)"'), 'solid+invert -> inverted fill');

// Multi-icon: N symbols, each cell picks by brightness (dark -> icon0, light -> last).
const twoIcons = [
  { innerSvg: '<circle r="12"/>', viewBox: '0 0 24 24', singleShape: true },
  { innerSvg: '<rect width="24" height="24"/>', viewBox: '0 0 24 24', singleShape: true },
];
const dark: Cell[] = [{ col: 0, row: 0, r: 10, g: 10, b: 10, brightness: 0.04 }];
const light: Cell[] = [{ col: 0, row: 0, r: 240, g: 240, b: 240, brightness: 0.94 }];
const mOut = render(dark, twoIcons, { ...defaults, cols: 1 });
assert.ok(mOut.includes('<symbol id="icon0"') && mOut.includes('<symbol id="icon1"'),
  '2 icons -> 2 symbols');
assert.ok(render(dark, twoIcons, { ...defaults, cols: 1 }).includes('href="#icon0"'),
  'dark cell -> icon0 (densest, first)');
assert.ok(render(light, twoIcons, { ...defaults, cols: 1 }).includes('href="#icon1"'),
  'light cell -> icon1 (last)');

// iconMetric 'hue': pick by hue angle, not brightness. A red cell (hue 0) and a
// cyan cell (hue 0.5) at the SAME brightness must pick DIFFERENT icons — proof the
// hue channel, not luma, drives the choice. (Same brightness -> identical in
// 'brightness' mode, so any difference here is the hue map doing its job.)
const hueRed: Cell[] = [{ col: 0, row: 0, r: 200, g: 40, b: 40, brightness: 0.4 }];
const hueCyan: Cell[] = [{ col: 0, row: 0, r: 40, g: 200, b: 200, brightness: 0.4 }];
const hueOpts = { ...defaults, cols: 1, iconMetric: 'hue' as const };
assert.ok(render(hueRed, twoIcons, hueOpts).includes('href="#icon0"'), 'hue: red (hue~0) -> icon0');
assert.ok(render(hueCyan, twoIcons, hueOpts).includes('href="#icon1"'), 'hue: cyan (hue~0.5) -> icon1');
// Saturation floor: a near-grey cell has no usable hue, so it must FALL BACK to
// the brightness pick (a dark grey -> icon0), not collapse arbitrarily.
const grey: Cell[] = [{ col: 0, row: 0, r: 30, g: 32, b: 31, brightness: 0.12 }];
assert.ok(render(grey, twoIcons, hueOpts).includes('href="#icon0"'),
  'hue: near-grey cell falls back to brightness (dark -> icon0)');

// colorJitter: a non-zero jitter must CHANGE the output of a flat patch (otherwise
// it is a dead knob), and jitter 0 must be byte-identical to no jitter (regression
// guard, since it sits in the always-on color stage).
const flat: Cell[] = [
  { col: 0, row: 0, r: 80, g: 120, b: 200, brightness: 0.45 },
  { col: 1, row: 0, r: 80, g: 120, b: 200, brightness: 0.45 },
];
const noJit = render(flat, svg, { ...defaults, cols: 2 });
assert.equal(render(flat, svg, { ...defaults, cols: 2, colorJitter: 0 }), noJit,
  'colorJitter 0 -> identical to no jitter (regression guard)');
const jit = render(flat, svg, { ...defaults, cols: 2, colorJitter: 0.8 });
assert.notEqual(jit, noJit, 'colorJitter > 0 must change a flat patch');

// RGB additive layered style: 3 full-size icons carrying each channel's TRUE
// value, screen-blended over black so overlaps add back to the original colour.
// circle icon (not the rect fixture) so counting <rect> only catches backgrounds.
const circleSvg = [{ innerSvg: '<circle r="11"/>', viewBox: '0 0 24 24', singleShape: true }];
const rgbOut = render(cell, circleSvg, { ...defaults, cols: 1, layered: true, layerStyle: 'rgb', background: '#ffffff' });
assert.equal((rgbOut.match(/mix-blend-mode:screen/g) ?? []).length, 3, 'RGB style screen-blends 3 layers');
// the global background is FORCED black (screen identity), overriding the white
// setting — and there are NO per-cell rects (the old ones swept under animation).
assert.equal((rgbOut.match(/<rect/g) ?? []).length, 1, 'RGB: exactly one (global) background rect');
assert.ok(rgbOut.includes('fill="#000000"'), 'RGB forces a black global background');
assert.ok(!rgbOut.includes('isolation:isolate'), 'RGB needs no per-cell isolation (screen on global black)');
// cell (200,100,50) -> channel layers carry true values, NOT pure 255.
const rgbFills = [...rgbOut.matchAll(/color="(rgb\([^)]+\))"/g)].map((m) => m[1]);
assert.deepEqual(rgbFills, ['rgb(200,0,0)', 'rgb(0,100,0)', 'rgb(0,0,50)'],
  'RGB channels carry true values so screen adds back to the original colour');
// all three are full-size (overlap = whole icon = original colour at offset 0).
const rgbSizes = [...rgbOut.matchAll(/<use[^>]*width="([\d.]+)"/g)].map((m) => +m[1]);
assert.ok(rgbSizes.length === 3 && rgbSizes.every((w) => w === rgbSizes[0]),
  `RGB layers are all full size, got ${rgbSizes}`);

// scheme reaches RGB style: grayscale -> r=g=b -> all three channel values equal.
const grayRgb = render(cell, tinySvg,
  { ...defaults, cols: 1, layered: true, layerStyle: 'rgb', scheme: { kind: 'grayscale' } });
const grayVals = [...grayRgb.matchAll(/color="rgb\((\d+),(\d+),(\d+)\)"/g)].map((m) => +m[1] + +m[2] + +m[3]);
assert.ok(grayVals.length === 3 && grayVals.every((v) => v === grayVals[0]),
  `grayscale -> equal channel values (scheme reached layered), got ${grayVals}`);

// RGB + motion: lean version — NO per-cell isolation/rect (redundant given the
// forced global black bg). The motion wrapper's will-change GPU-caches the raster.
// Tradeoff: cells overlapping under heavy motion can flicker at seams.
const rgbAnim = render(cell, circleSvg,
  { ...defaults, cols: 1, layered: true, layerStyle: 'rgb', motion: 'pulse' });
assert.ok(!rgbAnim.includes('isolation:isolate'), 'RGB+motion: no per-cell isolation (lean)');
assert.ok(!/<rect[^>]*fill="#000"\/>/.test(rgbAnim), 'RGB+motion: no per-cell black rect');
assert.ok(rgbAnim.includes('will-change:transform'),
  'motion style includes will-change (GPU-cache the raster, fixes scale/pulse jank)');
assert.ok(/<g class="motion"><use/.test(rgbAnim), 'motion wraps the screen <use>s directly');

// --- new layered styles (cmyk / ryb / anaglyph) + page-background forcing -----

// SUBTRACTIVE styles (cmy/cmyk/ryb) force a WHITE page (multiply identity);
// ADDITIVE (rgb/anaglyph) force BLACK. background setting is overridden either way.
for (const [style, pageBg] of [['cmy', '#ffffff'], ['cmyk', '#ffffff'], ['ryb', '#ffffff'],
                               ['halftone', '#ffffff'],
                               ['rgb', '#000000'], ['anaglyph', '#000000']] as const) {
  const o = render(cell, circleSvg, { ...defaults, cols: 1, layered: true, layerStyle: style, background: '#abcdef' });
  assert.ok(o.includes(`fill="${pageBg}"`), `${style} forces page bg ${pageBg}, not the #abcdef setting`);
  assert.ok(!o.includes('isolation:isolate'), `${style}: no per-cell isolation`);
  // circle icon, so the ONLY <rect> is the single global background.
  assert.equal((o.match(/<rect/g) ?? []).length, 1, `${style}: exactly one (global bg) rect, no per-cell rects`);
}

// CMYK = 4 multiply layers (CMY + a K/black ink). The K ink is a gray (r=g=b).
const cmyk = emitCell(mid, { ...defaults, layered: true, layerStyle: 'cmyk', layerOffset: 0 });
assert.equal((cmyk.match(/<use\b/g) ?? []).length, 4, 'CMYK -> 4 layers');
assert.equal((cmyk.match(/mix-blend-mode:multiply/g) ?? []).length, 4, 'CMYK all multiply');
const cmykFills = [...cmyk.matchAll(/color="rgb\((\d+),(\d+),(\d+)\)"/g)].map((m) => [+m[1], +m[2], +m[3]]);
const kFill = cmykFills[3];
assert.ok(kFill[0] === kFill[1] && kFill[1] === kFill[2], `K ink is gray (r=g=b), got ${kFill}`);

// HALFTONE: 4 CMYK multiply layers, each rotated to its print screen angle and
// pivoting IN PLACE (fill-box), so offset fans them into a rosette.
const halftoneOut = emitCell(mid, { ...defaults, layered: true, layerStyle: 'halftone', layerOffset: 2 });
assert.equal((halftoneOut.match(/mix-blend-mode:multiply/g) ?? []).length, 4, 'halftone: 4 multiply layers');
for (const a of [15, 75, 0, 45].filter(Boolean)) // 0deg emits no rotate, skip it
  assert.ok(halftoneOut.includes(`rotate(${a}deg)`), `halftone carries the ${a}deg screen angle`);
assert.ok(halftoneOut.includes('transform-box:fill-box'), 'halftone rotation pivots in place (fill-box)');
// the Y ink is angle 0 -> NO rotate wrapper for it (only 3 rotate groups appear).
assert.equal((halftoneOut.match(/transform:rotate\(/g) ?? []).length, 3, 'halftone: 3 angled inks wrapped (Y at 0deg is not)');
// upright styles never emit a screen-angle rotate.
assert.ok(!emitCell(mid, { ...defaults, layered: true, layerStyle: 'cmyk' }).includes('transform:rotate('),
  'cmyk (non-halftone) stays upright, no screen-angle rotate');
// K = max(r,g,b) as gray; cell (180,90,40) -> 180.
assert.equal(kFill[0], 180, `K gray = max channel (180), got ${kFill[0]}`);

// anaglyph = 2 screen ghosts, a red one (g=b=0) and a cyan one (r=0), full size.
const ana = emitCell(mid, { ...defaults, layered: true, layerStyle: 'anaglyph', layerOffset: 2 });
assert.equal((ana.match(/<use\b/g) ?? []).length, 2, 'anaglyph -> 2 ghosts');
assert.equal((ana.match(/mix-blend-mode:screen/g) ?? []).length, 2, 'anaglyph screen-blends');
const anaFills = [...ana.matchAll(/color="rgb\((\d+),(\d+),(\d+)\)"/g)].map((m) => [+m[1], +m[2], +m[3]]);
assert.ok(anaFills[0][1] === 0 && anaFills[0][2] === 0, `anaglyph layer 0 = red ghost, got ${anaFills[0]}`);
assert.ok(anaFills[1][0] === 0, `anaglyph layer 1 = cyan ghost (r=0), got ${anaFills[1]}`);

// ryb honors layerCount (2 drops the last ink), like cmy.
const ryb2 = emitCell(mid, { ...defaults, layered: true, layerStyle: 'ryb', layerCount: 2 });
assert.equal((ryb2.match(/<use\b/g) ?? []).length, 2, 'ryb layerCount:2 -> 2 layers');

// --- cutout + layout (un-parked per-cell effects) ----------------------------

// cutout drops cells brighter than the cutoff AND omits the background rect so
// the holes are transparent (the die-cut sticker). Canvas keeps its footprint.
const cutGrid: Cell[] = [
  { col: 0, row: 0, r: 10, g: 10, b: 10, brightness: 0.04 },   // dark -> kept
  { col: 1, row: 0, r: 240, g: 240, b: 240, brightness: 0.94 }, // bright -> dropped
];
const cut = render(cutGrid, svg, { ...defaults, cols: 2, cutout: 0.5 });
assert.equal((cut.match(/<use\b/g) ?? []).length, 1, 'cutout drops the bright cell');
assert.ok(!cut.includes('<rect width="32"'), 'cutout omits the bg rect (transparent holes)');
assert.ok(/viewBox="0 0 32 16"/.test(cut), 'cutout keeps the full canvas footprint');
// everything cut -> still a valid (empty) svg, no crash.
assert.ok(render(cutGrid, svg, { ...defaults, cols: 2, cutout: 0.01 }).includes('<svg'),
  'all cells cut -> valid svg');
// cutout + layered keeps the forced page: the inks multiply/screen against it.
const cutLayered = render(cutGrid, circleSvg, { ...defaults, cols: 2, cutout: 0.5, layered: true });
assert.ok(cutLayered.includes('fill="#ffffff"'), 'cutout+layered keeps the white page (blend math)');

// brick layout: odd rows shift half a cell (+8) right; canvas widens to cover the
// overhang. Same <use> count as square grid: layout is placement math, not nodes.
const rows2: Cell[] = [
  { col: 0, row: 0, r: 0, g: 0, b: 0, brightness: 0 },
  { col: 0, row: 1, r: 0, g: 0, b: 0, brightness: 0 },
];
const brick = render(rows2, svg, { ...defaults, cols: 1, layout: 'brick' });
assert.ok(brick.includes('x="0"') && brick.includes('x="8"'), 'brick: odd row shifted +8 (CELL/2)');
assert.ok(/viewBox="0 0 24 32"/.test(brick), 'brick: canvas widens CELL/2 for the overhang');
assert.equal((brick.match(/<use\b/g) ?? []).length, 2, 'brick: no extra nodes');

// hex layout: odd rows shift AND the row pitch compresses to sqrt(3)/2 * CELL,
// so staggered rows nest like a honeycomb. 16 * 0.866 = 13.856 -> 13.9.
const hex = render(rows2, svg, { ...defaults, cols: 1, layout: 'hex' });
assert.ok(hex.includes('y="13.9"'), 'hex: second row at ~0.866 * CELL');
// default square grid unchanged (prior output stable): full pitch, no shift.
const plainGrid = render(rows2, svg, { ...defaults, cols: 1 });
assert.ok(plainGrid.includes('y="16"') && !plainGrid.includes('x="8"'), 'grid layout unchanged');

// PER-CHANNEL ICONS: with 2+ icons + layered, each ink draws a DIFFERENT icon
// (ink0 -> #icon0, ink1 -> #icon1, ink2 falls back since only 2 icons exist).
const oneCell: Cell[] = [{ col: 0, row: 0, r: 120, g: 90, b: 60, brightness: 0.4 }];
const pcOpts = { ...defaults, cols: 1, layered: true, layerStyle: 'cmy' as const, perChannelIcons: true };
const pc = render(oneCell, twoIcons, pcOpts); // export mode -> href="#iconN"
assert.ok(pc.includes('href="#icon0"') && pc.includes('href="#icon1"'),
  'per-channel: distinct inks reference distinct icons');
// 3 cmy inks, 2 icons -> icon0, icon1, then fall back (icon by the cell's pick) for ink2.
assert.equal((pc.match(/href="#icon0"/g) ?? []).length + (pc.match(/href="#icon1"/g) ?? []).length, 3,
  'per-channel: every ink draws some icon (no dropped layer)');
// OFF (or 1 icon) is byte-identical to normal layered: every ink uses the cell's icon.
const pcOff = render(oneCell, twoIcons, { ...pcOpts, perChannelIcons: false });
const oneIconPC = render(oneCell, [twoIcons[0]], pcOpts); // 1 icon + perChannel ON
const oneIconPlain = render(oneCell, [twoIcons[0]], { ...pcOpts, perChannelIcons: false });
assert.equal(oneIconPC, oneIconPlain, 'per-channel with 1 icon = identical to off (no regression)');
assert.notEqual(pc, pcOff, 'per-channel ON with 2 icons changes the output');

console.log('render.test.ts: ok (solid + layered styles + bg forcing + scheme + multi-icon + per-channel + cutout/layout)');
