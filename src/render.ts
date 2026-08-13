import type { Cell } from './sample.ts';
import { poolCells, gridDims } from './sample.ts';
import type { Settings } from './settings.ts';
import type { ParsedSvg } from './parseSvg.ts';
import { transformColor, adjustColor, adjustActive, schemeQuantizes, bayer, overlayColor, rgbToHsl, hslToRgb, type RGB } from './color.ts';
import { motionStyle, motionEmitter, hash01, type MotionEmitter } from './motion.ts';

// Each cell occupies a CELL x CELL box in output user units. Arbitrary; the
// root viewBox scales the whole thing, so this is just internal resolution.
const CELL = 16;

/** Round to keep the output string small and stable for the self-check.
 *  Coords use 1 decimal (0.1 user-unit = 1/160 of a cell — invisible, smaller
 *  file); the aspect ratio keeps 2 decimals since CSS layout math reads it. */
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Scale factor for one cell's icon: global iconScale x optional brightness scale.
 *  iconScale > 1 makes icons larger than their cell, so they overlap neighbours
 *  (a denser, tiled look) — independent of column count. The <symbol> is
 *  overflow:visible, so oversized icons don't clip. */
function scaleFor(cell: Cell, settings: Settings): number {
  let tonal = 1;
  if (settings.sizeByBrightness) {
    // sort the range so min>max (independent sliders) doesn't invert the lerp.
    const lo = Math.min(settings.sizeRange[0], settings.sizeRange[1]);
    const hi = Math.max(settings.sizeRange[0], settings.sizeRange[1]);
    // Interpolate in AREA, not linear dimension: the eye reads a cell's ink
    // coverage (~scale²), so a linear ramp on `tonal` looks bimodal — most cells
    // stay thin, then jump big near the dark end. Lerp lo²..hi² and sqrt back so
    // perceived size moves evenly with brightness. Endpoints (lo, hi) unchanged.
    const t = 1 - cell.brightness; // dark cell -> 1 (big), light -> 0 (small)
    tonal = Math.sqrt(lo * lo + (hi * hi - lo * lo) * t);
  }
  const s = settings.iconScale * tonal;
  // floor at a tiny positive value so icons can shrink small but never vanish
  // entirely (sizeRange [0,0] otherwise -> a blank mosaic, looks like a bug).
  return Math.max(0.02, s);
}

/** Grid position -> u in [0,1] for the gradient-wash overlay. The direction and
 *  its normalisers (the radial centre, the diagonal span) are grid constants, so
 *  they're resolved ONCE here and the returned function is all a cell pays. The
 *  divisions stay inside it exactly as they were, so results are bit-identical. */
function overlayUFor(dir: string, cols: number, rows: number): (col: number, row: number) => number {
  switch (dir) {
    case 'h': {
      const last = cols - 1;
      return cols > 1 ? (col) => col / last : () => 0;
    }
    case 'v': {
      const last = rows - 1;
      return rows > 1 ? (_col, row) => row / last : () => 0;
    }
    case 'diag': {
      const span = Math.max(1, cols - 1 + rows - 1);
      return (col, row) => (col + row) / span;
    }
    case 'radial': {
      const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
      const maxD = Math.hypot(cx, cy) || 1;
      return (col, row) => Math.hypot(col - cx, row - cy) / maxD;
    }
    default: return () => 0;
  }
}

/** Per-cell rotation in degrees (0 = upright). 'brightness' turns the mosaic into
 *  an orientation field (tone -> tilt); 'jitter' scatters by a deterministic hash
 *  so render() stays pure; 'fixed' tilts every icon the same. */
function rotationFor(cell: Cell, index: number, settings: Settings): number {
  switch (settings.rotate) {
    case 'fixed':
      return settings.rotateDeg;
    case 'brightness':
      return settings.rotateDeg * cell.brightness;
    case 'jitter':
      return (hash01(index) * 2 - 1) * settings.rotateDeg; // ±rotateDeg
    case 'none':
    default:
      return 0;
  }
}

/** Per-cell opacity 0..1, ramped over brightness. Applied on the leaf <use>(s)
 *  (not a group) so it never isolates the layered blend modes — a faded ink just
 *  blends against the page more weakly, which is the look we want. */
function opacityFor(cell: Cell, settings: Settings): number {
  if (!settings.fadeByBrightness) return 1;
  const [lo, hi] = settings.fadeRange;
  return Math.max(0, Math.min(1, lo + (hi - lo) * cell.brightness));
}
const opAttr = (o: number) => (o < 1 ? ` opacity="${r2(o)}"` : '');

/** Opening tag of a cell's static-rotation group, or '' for no rotation. Pivots
 *  in place (fill-box) so it rotates around the icon's own centre, and sits INSIDE
 *  the motion wrapper so a spinning/bobbing cell still carries its static tilt. */
function rotateOpen(cell: Cell, index: number, plan: Plan): string {
  // 'fixed' is one angle for the whole grid: reuse the prefix built in the plan.
  if (plan.settings.rotate === 'fixed') return plan.rotatePrefix ?? '';
  const deg = rotationFor(cell, index, plan.settings);
  return deg ? pivotWrap(r1(deg)) : ''; // no rotation -> no group, output unchanged
}

/** Which icon a cell draws. 'brightness' (default): dark cell -> icon 0, light ->
 *  last, so ordering your SVGs dense->sparse reads like ASCII art ('@' .. '.').
 *  'hue': the cell's hue angle (0..1 round the wheel) picks the icon, so reds get
 *  one tile, greens another — the list order becomes "around the colour wheel".
 *  Near-grey cells (sat below SAT_FLOOR) have no meaningful hue, so they fall back
 *  to the brightness pick instead of collapsing every desaturated cell onto icon0. */
const SAT_FLOOR = 0.15;
function iconIndex(cell: Cell, count: number, metric: Settings['iconMetric']): number {
  if (count <= 1) return 0;
  let t = cell.brightness; // dark -> 0, light -> 1
  if (metric === 'hue') {
    const { h, s } = rgbToHsl({ r: cell.r, g: cell.g, b: cell.b });
    if (s >= SAT_FLOOR) t = h; // saturated enough to read a hue -> map round the wheel
  }
  // clamp so t==1 (light cell / hue at the wheel's top) doesn't overflow to index count.
  return Math.min(count - 1, Math.floor(t * count));
}

// Render target. 'export' uses <symbol>+<use> (define the icon once, tiny file —
// the slow per-<use> shadow-tree layout doesn't matter in a downloaded/rasterized
// file). 'live' INLINES the icon's shapes per cell behind a <g transform>: the
// browser lays out a flat tree instead of cloning a shadow subtree per cell, which
// is ~85x faster on screen for the common solid path. Same pixels either way.
export type RenderMode = 'export' | 'live';

/** Parse "minX minY w h" -> numbers (icon viewBox), defaulting sanely. */
function parseViewBox(vb: string): [number, number, number, number] {
  const p = vb.trim().split(/[\s,]+/).map(Number);
  return p.length === 4 && p.every((n) => Number.isFinite(n)) ? (p as [number, number, number, number]) : [0, 0, 24, 24];
}

/** An icon placer: given a cell box + paint attrs, emit ONE drawable for the icon.
 *  'export' -> <use href="#iconN" ...>; 'live' -> <g transform...>inlined shapes</g>.
 *  Built once per icon per render (closes over the parsed viewBox / inner markup). */
type Placer = (box: Box, attrs: string) => string;
function makePlacer(icon: ParsedSvg, id: string, mode: RenderMode): Placer {
  if (mode === 'export') {
    return ({ x, y, size }, attrs) =>
      `<use href="#${id}" x="${x}" y="${y}" width="${size}" height="${size}"${attrs}/>`;
  }
  // live: map the icon's viewBox into the cell box with one transform, then inline
  // the shapes. translate to the cell, scale viewBox->size, shift off the viewBox
  // origin.
  const [minX, minY, vbW, vbH] = parseViewBox(icon.viewBox);
  const inner = icon.innerSvg;
  const transform = (x: number, y: number, size: number): string => {
    const sx = r2(size / vbW), sy = r2(size / vbH);
    // origin shift folded into translate so it's one transform, fewer chars.
    const tx = r2(x - minX * sx), ty = r2(y - minY * sy);
    return sx === sy ? `translate(${tx} ${ty}) scale(${sx})` : `translate(${tx} ${ty}) scale(${sx} ${sy})`;
  };

  // FAST PATH: a one-element icon (e.g. a lone <path>). Splice the transform +
  // paint attrs straight INTO that element — no wrapping <g>, which would force a
  // per-cell coordinate system the layout engine processes separately (~16x cost).
  // Find the END of the opening tag NAME (after "<path", before its attrs), past
  // any leading whitespace/comments innerHTML may carry — splicing at the wrong
  // spot would corrupt the markup, so fall back to the <g> wrapper if unsure.
  const m = icon.singleShape ? /<[a-zA-Z][\w:-]*/.exec(inner) : null;
  if (m) {
    const sp = m.index + m[0].length; // just after "<path"
    const head = inner.slice(0, sp), tail = inner.slice(sp);
    return ({ x, y, size }, attrs) =>
      `${head} transform="${transform(x, y, size)}"${attrs}${tail}`;
  }
  // FALLBACK: multi-shape icon needs a shared group to carry the one transform.
  return ({ x, y, size }, attrs) => `<g transform="${transform(x, y, size)}"${attrs}>${inner}</g>`;
}

// Honeycomb row pitch: staggered rows sit sqrt(3)/2 of a cell apart, so circle-
// ish icons nest instead of leaving diagonal gaps (the hexagonal packing ratio).
const HEX_PITCH = Math.sqrt(3) / 2;
/** Vertical distance between row origins for the current layout. */
const rowPitch = (settings: Settings) => (settings.layout === 'hex' ? CELL * HEX_PITCH : CELL);

/** Centered placement box for a cell's icon at a given scale factor. brick/hex
 *  shift odd rows half a cell right; hex also tightens the row pitch. Placement
 *  math only: same node count as the square grid. Reads the row pitch and the
 *  odd-row shift off the plan, both settled once per render. */
type Box = { x: number; y: number; size: number };
function cellBox(cell: Cell, plan: Plan, scale: number): Box {
  const size = r1(CELL * scale);
  const pad = r1((CELL - size) / 2); // center the shrunk icon in its box
  const ox = plan.offsetRows && (cell.row & 1) ? CELL / 2 : 0;
  // Written into the plan's single scratch box. A placer reads x/y/size and is
  // done with it before the next cell (or the next ink) computes its own, so a
  // fresh object here was ~30,000 pieces of garbage per layered render, and GC
  // was the biggest single cost in a profile of the heaviest settings.
  const b = plan.box;
  b.x = r1(cell.col * CELL + pad + ox);
  b.y = r1(cell.row * plan.pitch + pad);
  b.size = size;
  return b;
}

// Which layer styles SUBTRACT ink (multiply over a WHITE page) vs ADD light
// (screen over a BLACK page). render() picks the page background from this.
// ponytail: no per-cell white/black rect + isolation any more — every style now
// blends against the shared page. It's a fun toy; overlapping/animating cells
// re-blend and that's fine (the user asked for it). Fewer nodes, simpler.
export const SUBTRACTIVE = new Set(['cmy', 'cmyk', 'ryb', 'halftone']);

// Per-style ink layers. Each entry: how to derive the layer's strength from the
// cell's r/g/b (0..1 each), and the offset direction for the aberration shimmer.
// SUBTRACTIVE inks are white-minus-one-channel (multiply); ADDITIVE carry the
// channel's true value (screen). Offsets fan out so layers separate under offset.
// `angle` (optional, degrees) is the classic print screen-angle for the halftone
// layerStyle: each ink rotates to its own angle so the channels interfere into a
// newsprint rosette under offset. Undefined = upright (every non-halftone style).
type Ink = { color: (r: number, g: number, b: number) => string; dx: number; dy: number; angle?: number };
// One ink per channel, written out per channel rather than indexed through a
// scratch [255,255,255] array: the array form allocated TWO arrays per ink per
// cell (the rest-args array and the rgb triple), which a layered 100-column grid
// pays ~40,000 times a render. Same strings out.
const cmyInk = (chan: number): Ink => ({
  color: chan === 0
    ? (r) => `rgb(${Math.round(r * 255)},255,255)`
    : chan === 1
      ? (_r, g) => `rgb(255,${Math.round(g * 255)},255)`
      : (_r, _g, b) => `rgb(255,255,${Math.round(b * 255)})`,
  dx: [-1, 1, -1][chan], dy: [-1, 1, 1][chan],
});
// K ink: gray = max(r,g,b); multiplying by it darkens every channel equally in
// the shadows, which CMY alone can't reach (3 weak inks never hit true black).
const kInk: Ink = {
  color: (r, g, b) => { const v = Math.round(Math.max(r, g, b) * 255); return `rgb(${v},${v},${v})`; },
  dx: 1, dy: -1,
};
// RYB: artist primaries. Red removes nothing extra, but we fake the warmer wheel
// by mapping subtractive inks to red/yellow/blue tints (multiply). Approximate —
// it's a vibe, not a color-managed conversion.
const rybInks: Ink[] = [
  { color: (r) => `rgb(255,${Math.round(r * 255)},${Math.round(r * 255)})`, dx: -1, dy: -1 }, // red ink
  { color: (_r, _g, b) => `rgb(255,255,${Math.round(b * 255)})`, dx: 1, dy: 1 },               // yellow ink (removes blue)
  { color: (_r, g) => `rgb(${Math.round(g * 255)},${Math.round(g * 255)},255)`, dx: -1, dy: 1 }, // blue ink (removes green)
];
const rgbInks: Ink[] = [
  { color: (r) => `rgb(${Math.round(r * 255)},0,0)`, dx: -1, dy: -1 },
  { color: (_r, g) => `rgb(0,${Math.round(g * 255)},0)`, dx: 1, dy: 1 },
  { color: (_r, _g, b) => `rgb(0,0,${Math.round(b * 255)})`, dx: -1, dy: 1 },
];
// Anaglyph: the literal 3D-glasses look — a red ghost and a cyan ghost of the
// SAME icon, screen-blended, fanned apart by offset. Carries luminance so the
// shape stays readable; colour comes from the red/cyan split, not the cell.
const anaglyphInks: Ink[] = [
  { color: (r, g, b) => { const v = Math.round((0.3 * r + 0.59 * g + 0.11 * b) * 255); return `rgb(${v},0,0)`; }, dx: -1, dy: 0 },
  { color: (r, g, b) => { const v = Math.round((0.3 * r + 0.59 * g + 0.11 * b) * 255); return `rgb(0,${v},${v})`; }, dx: 1, dy: 0 },
];
// Halftone: the four CMYK inks, each rotated to its canonical print screen angle
// (C 15° / M 75° / Y 0° / K 45°), in CMYK order. With layerOffset > 0 the rotated
// channels fan apart into a rosette. Multiply-blended over white, like cmyk.
const HALFTONE_ANGLES = [15, 75, 0, 45];
const halftoneInks: Ink[] = [cmyInk(0), cmyInk(1), cmyInk(2), kInk]
  .map((ink, i) => ({ ...ink, angle: HALFTONE_ANGLES[i] }));

/** Pick the ink list + blend mode for a style. layerCount trims CMY/RYB to 2. */
function inksFor(settings: Settings): { inks: Ink[]; blend: 'multiply' | 'screen' } {
  switch (settings.layerStyle) {
    case 'cmyk': return { inks: [cmyInk(0), cmyInk(1), cmyInk(2), kInk], blend: 'multiply' };
    case 'halftone': return { inks: halftoneInks, blend: 'multiply' };
    case 'ryb': return { inks: rybInks.slice(0, settings.layerCount), blend: 'multiply' };
    case 'rgb': return { inks: rgbInks, blend: 'screen' };
    case 'anaglyph': return { inks: anaglyphInks, blend: 'screen' };
    case 'cmy':
    default: return { inks: [cmyInk(0), cmyInk(1), cmyInk(2)].slice(0, settings.layerCount), blend: 'multiply' };
  }
}

/**
 * Everything render() can settle ONCE for a whole grid instead of re-deriving it
 * per cell. A 100-column mosaic emits ~10,000 cells (x4 inks when layered), so a
 * switch on `settings.layerStyle` or a `rowPitch()` call inside the emit loop is
 * work done ten thousand times to reach the same answer. Pure bookkeeping: every
 * field is a plain function of `settings` + the grid shape, and the emitted markup
 * is byte-for-byte what the per-cell derivation produced.
 */
type Plan = {
  settings: Settings;
  pitch: number; // vertical distance between row origins (hex packs tighter)
  offsetRows: boolean; // brick/hex shift odd rows half a cell right
  inks: Ink[]; // layered only: the ink stack for this layerStyle
  blend: 'multiply' | 'screen';
  shrink: boolean; // subtractive inks nest concentrically; additive stay full size
  perChannel: boolean; // one icon per ink (needs enough icons to be meaningful)
  rotates: boolean; // any static per-cell rotation at all
  // A 'fixed' tilt is the same angle for every cell, and the halftone screen
  // angles are four constants, so both group wrappers are built once here rather
  // than re-interpolated per cell (per INK, for halftone). null = no wrapper.
  rotatePrefix: string | null;
  inkPrefix: (string | null)[];
  motion: MotionEmitter | null; // per-cell motion attrs, or null when static
  box: Box; // scratch placement box, refilled per cell (see cellBox)
};

/** The in-place pivot every rotation wrapper uses: transform-box:fill-box makes
 *  the element turn around its OWN centre instead of the SVG origin. */
const pivotWrap = (deg: number) =>
  `<g style="transform:rotate(${deg}deg);transform-box:fill-box;transform-origin:center">`;

function makePlan(settings: Settings, cols: number, rows: number, iconCount: number): Plan {
  const { inks, blend } = inksFor(settings);
  // Gate on the RAW angle, not the rounded one: a sub-0.05 degree tilt still
  // emits its (rotate(0deg)) wrapper, which is what the per-cell path did.
  const fixedDeg = settings.rotate === 'fixed' ? settings.rotateDeg : 0;
  return {
    settings,
    pitch: rowPitch(settings),
    offsetRows: settings.layout !== 'grid',
    inks,
    blend,
    shrink: blend === 'multiply',
    perChannel: settings.perChannelIcons && iconCount > 1,
    rotates: settings.rotate !== 'none',
    rotatePrefix: fixedDeg ? pivotWrap(r1(fixedDeg)) : null,
    inkPrefix: inks.map((ink) => (ink.angle ? pivotWrap(ink.angle) : null)),
    motion: motionEmitter(settings, cols, rows),
    box: { x: 0, y: 0, size: 0 },
  };
}

/** A layered cell body: N tinted copies of the icon, each blended against the
 *  shared page (white for multiply styles, black for screen). No per-cell rect
 *  or isolation — the page IS the blend backdrop. Subtractive styles shrink each
 *  successive layer (concentric inks); additive/anaglyph stay full size. */
function layeredBodyOnto(s: string, cell: Cell, plan: Plan, place: Placer, placers: Placer[]): string {
  // Per-channel icons: ink i draws icon i (a different uploaded shape per channel),
  // falling back to the cell's normal placer when there aren't enough icons, so 1
  // icon is byte-identical to before. Off -> every ink uses the cell's one placer.
  const { settings, inks, blend, shrink, perChannel, inkPrefix } = plan;
  const n = inks.length;
  const base = scaleFor(cell, settings);
  const r = cell.r / 255, g = cell.g / 255, b = cell.b / 255;
  const off = settings.layerOffset;
  const op = opAttr(opacityFor(cell, settings)); // fades the whole stack uniformly
  for (let i = 0; i < n; i++) {
    const inkPlace = perChannel ? (placers[i] ?? place) : place;
    const scale = shrink ? r1(base * (1 - i / n)) : base; // even concentric steps
    const box = cellBox(cell, plan, scale);
    box.x = r1(box.x + inks[i].dx * off);
    box.y = r1(box.y + inks[i].dy * off);
    // Halftone: rotate this ink to its screen angle, pivoting in place (fill-box) so
    // it turns around the icon's own centre instead of flinging across the canvas.
    // The angle is per-ink, not per-cell, so the wrapper came ready-made.
    const pre = inkPrefix[i];
    if (pre) s += pre;
    s += inkPlace(box, ` color="${inks[i].color(r, g, b)}"${op} style="mix-blend-mode:${blend}"`);
    if (pre) s += '</g>';
  }
  return s;
}

/**
 * One cell's drawable(s) appended to the output so far: a single tinted icon, or
 * a layered ink stack. `place` is the per-icon placer (export <use> or live
 * inlined shapes).
 *
 * The group wrappers are appended in place rather than concatenated around a
 * finished body string. A layered cell's body runs past a thousand characters,
 * and `<g...>${body}</g>` copied every one of them again per nesting level, twice
 * over for a rotated AND animated cell. Appending open/close tags keeps the whole
 * render one linear write; garbage collection was the single largest cost in a
 * profile of the heaviest settings.
 */
function emitCellOnto(s: string, cell: Cell, plan: Plan, index: number, place: Placer, placers: Placer[]): string {
  const { settings } = plan;
  // OUTERMOST group: motion only. .motion (incl. will-change) GPU-promotes it so
  // the browser caches the cell's raster and moves/scales the bitmap per frame. It
  // wraps a <g>, not the leaf: fill-box on a <use>->symbol instance resolves
  // inconsistently, while a <g>'s fill-box is its children's rendered box, so it
  // pivots around its OWN centre. No motion -> no wrapper, output unchanged.
  const mo = plan.motion ? plan.motion(cell, index) : '';
  if (mo) s += `<g${mo}>`;
  const rot = plan.rotates ? rotateOpen(cell, index, plan) : '';
  if (rot) s += rot;

  if (settings.layered) {
    // The scheme already transformed cell.r/g/b upstream, so the ink stack picks
    // up the scheme for free.
    s = layeredBodyOnto(s, cell, plan, place, placers);
  } else {
    const box = cellBox(cell, plan, scaleFor(cell, settings));
    // Tint via color= (makeTintable forces icons to currentColor, so this recolors
    // any art). GPU-cheap, the SAME mechanism CMY uses. fill= too, belt-and-
    // suspenders on currentColor inheritance.
    const fill = `rgb(${Math.round(cell.r)},${Math.round(cell.g)},${Math.round(cell.b)})`;
    s += place(box, ` fill="${fill}" color="${fill}"${opAttr(opacityFor(cell, settings))}`);
  }

  if (rot) s += '</g>';
  if (mo) s += '</g>';
  return s;
}

/**
 * Pure core: grid + parsed svg + settings -> one standalone <svg> string.
 * No DOM reads, no canvas — re-runs cheaply on every settings change.
 *
 * `mode` ('export' default): 'export' emits <symbol>+<use> (tiny downloadable
 * file); 'live' inlines the icon shapes per cell (~85x faster on-screen layout,
 * same pixels). Default 'export' keeps the export string + self-checks stable.
 */
export function render(grid: Cell[], icons: ParsedSvg[], settings: Settings, mode: RenderMode = 'export'): string {
  if (grid.length === 0 || icons.length === 0) return '';
  // Pool N x N source cells into one averaged icon (blockSize). Must run before
  // we read cols/rows: it re-indexes the grid to a smaller one, so every
  // downstream use (canvas size, cell placement, filter dedup) stays consistent.
  const fullRows = gridDims(grid).rows; // before pooling
  grid = poolCells(grid, settings.cols, settings.blockSize);
  // Derive grid dims from the (possibly pooled) grid, not settings.cols.
  const { cols, rows } = gridDims(grid);
  // Cutout: drop bright cells EARLY, after dims (the canvas keeps its full
  // footprint; the holes are the point) but before the color stage and emit, so
  // a dropped cell costs nothing and the output DOM only shrinks.
  // brightness is the ORIGINAL sampled tone, upstream of any scheme.
  if (settings.cutout > 0) grid = grid.filter((c) => c.brightness <= settings.cutout);
  // Internal coordinate space = the pooled grid at CELL each. The icons render
  // here, naturally smaller when pooled (fewer, bigger cells). brick/hex odd
  // rows overhang half a cell on the right; hex packs rows tighter vertically.
  const shift = settings.layout !== 'grid' && rows > 1 ? CELL / 2 : 0;
  const pitch = rowPitch(settings);
  const w = cols * CELL + shift;
  const h = r1(CELL + (rows - 1) * pitch);
  // Rendered (pixel) size = the UN-pooled canvas, so the footprint stays constant
  // as block grows: the viewBox content is scaled up to fill it. block only
  // changes how many icons cover the same area, not the canvas size.
  const outW = settings.cols * CELL + shift;
  const outH = r1(CELL + (fullRows - 1) * pitch);

  // Single upstream colour stage: adjust -> (dither) -> scheme -> (overlay).
  // Everything downstream (filter defs, solid fill, CMY split) consumes the
  // result, so the whole stage composes with both modes for free. All-neutral
  // -> identity -> prior output unchanged. cell.brightness (size/rotation/icon
  // pick) keeps the ORIGINAL sampled tone, matching prior behaviour.
  const { adjust, overlay } = settings;
  const doAdjust = adjustActive(adjust);
  const doScheme = settings.scheme.kind !== 'none';
  const doDither = settings.dither && schemeQuantizes(settings.scheme);
  const doOverlay = overlay.dir !== 'none' && overlay.strength > 0;
  const doJitter = settings.colorJitter > 0;
  if (doAdjust || doScheme || doDither || doOverlay || doJitter) {
    const spread = settings.ditherStrength * 255;
    const k = settings.colorJitter;
    // The overlay's direction resolves to one closure for the whole grid rather
    // than a switch (plus a radial normaliser) re-run per cell.
    const uAt = doOverlay ? overlayUFor(overlay.dir, cols, rows) : null;
    // Written into a pre-sized array with explicit literals: `grid.map` with a
    // `{ ...c }` spread per cell allocated an extra intermediate object for every
    // cell, and the spread hides the shape from the engine.
    const next: Cell[] = new Array<Cell>(grid.length);
    for (let i = 0; i < grid.length; i++) {
      const c = grid[i];
      let rgb: RGB = { r: c.r, g: c.g, b: c.b };
      if (doAdjust) rgb = adjustColor(rgb, adjust);
      if (doDither) {
        // rgb is ours (freshly built above, or returned by adjustColor), so nudge
        // it in place instead of allocating a replacement triple.
        const off = (bayer(c.col, c.row) - 0.5) * spread;
        rgb.r += off; rgb.g += off; rgb.b += off;
      }
      // Colour jitter BEFORE the scheme: a deterministic hue+sat nudge per cell
      // (two decorrelated hashes off the index) so a flat region shimmers into a
      // sticker-bomb. Pre-scheme means palette/threshold still snap jittered cells
      // on-palette for free. Amount scales the spread; sat shifts both ways.
      if (doJitter) {
        const hsl = rgbToHsl(rgb);
        hsl.h += (hash01(i) - 0.5) * 0.5 * k;            // up to ±90° of hue at k=1
        hsl.s = Math.max(0, Math.min(1, hsl.s + (hash01(i * 7 + 1) - 0.5) * k));
        rgb = hslToRgb(hsl);
      }
      if (doScheme) rgb = transformColor(rgb, settings.scheme);
      if (uAt) rgb = overlayColor(rgb, uAt(c.col, c.row), overlay);
      next[i] = { col: c.col, row: c.row, r: rgb.r, g: rgb.g, b: rgb.b, brightness: c.brightness };
    }
    grid = next;
  }

  // A placer per icon: export mode references a shared <symbol> via <use>; live
  // mode inlines the icon's shapes (no shadow-tree-per-cell -> ~85x faster paint).
  const placers = icons.map((svg, i) => makePlacer(svg, `icon${i}`, mode));
  // <defs> only in export mode — live mode has no <symbol> to reference.
  const defs = mode === 'export'
    ? `<defs>${icons.map((svg, i) =>
        `<symbol id="icon${i}" viewBox="${svg.viewBox}" overflow="visible">${svg.innerSvg}</symbol>`).join('')}</defs>`
    : '';
  // Motion keyframes baked into the SVG (no JS loop) — so animation survives
  // export: the downloaded .svg stays alive. '' when motion:'none'.
  const style = motionStyle(settings);
  // Background = the blend backdrop for layered styles, else the sampled bg.
  // SUBTRACTIVE inks (cmy/cmyk/ryb) multiply -> need a WHITE page (multiply's
  // identity) so the inks resolve to the cell colour with no per-cell rect.
  // ADDITIVE (rgb/anaglyph) screen -> need a BLACK page (screen's identity).
  let bgFill = settings.background;
  if (settings.layered) bgFill = SUBTRACTIVE.has(settings.layerStyle) ? '#ffffff' : '#000000';
  // Cutout omits the rect so dropped cells are genuinely transparent (the die-cut
  // sticker). EXCEPT in layered mode: the inks multiply/screen against the page,
  // so removing it would break the blend math; there cutout only drops cells.
  const bg = settings.cutout > 0 && !settings.layered
    ? '' : `<rect width="${w}" height="${h}" fill="${bgFill}"/>`;
  // One plan for the whole grid (ink stack, row pitch, motion emitter, ...), then
  // an indexed loop: `grid.map(...).join('')` built an N-string array purely to
  // throw it away, and every cell re-derived what the plan now holds.
  const plan = makePlan(settings, cols, rows, icons.length);
  const iconCount = icons.length;
  const metric = settings.iconMetric;
  let uses = '';
  for (let i = 0; i < grid.length; i++) {
    const c = grid[i];
    uses = emitCellOnto(uses, c, plan, i, placers[iconIndex(c, iconCount, metric)], placers);
  }

  // aspect-ratio locks the element box to the image ratio; --ar (the numeric ratio)
  // lets the maximized CSS size it correctly with min() (CSS can't read a ratio at
  // runtime, so we pass it in). width/height attrs stay for the PNG export raster.
  const ar = r2(outW / outH);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" ` +
    `width="${outW}" height="${outH}" style="aspect-ratio:${outW}/${outH};--ar:${ar}">${style}${defs}${bg}${uses}</svg>`;
}

/** Test/back-compat shim: one cell in EXPORT mode (the <use>/<symbol> form the
 *  self-checks assert). Builds a single export placer for #icon0. */
function emitCell(cell: Cell, settings: Settings, index = 0, _iconCount = 1): string {
  const p = makePlacer({ innerSvg: '', viewBox: '0 0 24 24', singleShape: false }, 'icon0', 'export');
  return emitCellOnto('', cell, makePlan(settings, 1, 1, 1), index, p, [p]);
}
export { emitCell };
