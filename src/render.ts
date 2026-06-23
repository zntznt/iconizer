import type { Cell } from './sample.ts';
import { poolCells } from './sample.ts';
import type { Settings } from './settings.ts';
import type { ParsedSvg } from './parseSvg.ts';
import { transformColor, adjustColor, adjustActive, schemeQuantizes, bayer, overlayColor, type RGB } from './color.ts';
import { motionStyle, motionAttrs, hash01 } from './motion.ts';

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

/** Grid position -> u in [0,1] for the gradient-wash overlay, per direction. */
function overlayU(col: number, row: number, cols: number, rows: number, dir: string): number {
  switch (dir) {
    case 'h': return cols > 1 ? col / (cols - 1) : 0;
    case 'v': return rows > 1 ? row / (rows - 1) : 0;
    case 'diag': return (col + row) / Math.max(1, cols - 1 + rows - 1);
    case 'radial': {
      const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
      return Math.hypot(col - cx, row - cy) / (Math.hypot(cx, cy) || 1);
    }
    default: return 0;
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

/** Wrap a cell body in a static-rotation group, pivoting in place (fill-box) so
 *  it rotates around the icon's own centre. Sits INSIDE the motion wrapper so a
 *  spinning/bobbing cell still carries its static tilt (nested transforms). */
function rotateWrap(body: string, cell: Cell, index: number, settings: Settings): string {
  const deg = rotationFor(cell, index, settings);
  if (!deg) return body; // no rotation -> output unchanged
  return `<g style="transform:rotate(${r1(deg)}deg);transform-box:fill-box;` +
    `transform-origin:center">${body}</g>`;
}

/** Which icon a cell draws, by brightness: dark cell -> icon 0, light -> last.
 *  Order your SVGs dense->sparse (like ASCII art: '@' dark ... '.' light). */
function iconFor(cell: Cell, count: number): string {
  if (count <= 1) return 'icon0';
  // dark cell (low brightness) -> icon0; light -> last. clamp so brightness==1
  // doesn't overflow to index count.
  const i = Math.min(count - 1, Math.floor(cell.brightness * count));
  return `icon${i}`;
}

/** Centered placement box for a cell's icon at a given scale factor. */
function cellBox(cell: Cell, settings: Settings, scale = scaleFor(cell, settings)) {
  const size = r1(CELL * scale);
  const pad = r1((CELL - size) / 2); // center the shrunk icon in its box
  return { x: r1(cell.col * CELL + pad), y: r1(cell.row * CELL + pad), size };
}

// Which layer styles SUBTRACT ink (multiply over a WHITE page) vs ADD light
// (screen over a BLACK page). render() picks the page background from this.
// ponytail: no per-cell white/black rect + isolation any more — every style now
// blends against the shared page. It's a fun toy; overlapping/animating cells
// re-blend and that's fine (the user asked for it). Fewer nodes, simpler.
export const SUBTRACTIVE = new Set(['cmy', 'cmyk', 'ryb']);

// Per-style ink layers. Each entry: how to derive the layer's strength from the
// cell's r/g/b (0..1 each), and the offset direction for the aberration shimmer.
// SUBTRACTIVE inks are white-minus-one-channel (multiply); ADDITIVE carry the
// channel's true value (screen). Offsets fan out so layers separate under offset.
type Ink = { color: (r: number, g: number, b: number) => string; dx: number; dy: number };
const cmyInk = (chan: number): Ink => ({
  color: (...c) => { const rgb = [255, 255, 255]; rgb[chan] = Math.round(c[chan] * 255); return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`; },
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

/** Pick the ink list + blend mode for a style. layerCount trims CMY/RYB to 2. */
function inksFor(settings: Settings): { inks: Ink[]; blend: 'multiply' | 'screen' } {
  switch (settings.layerStyle) {
    case 'cmyk': return { inks: [cmyInk(0), cmyInk(1), cmyInk(2), kInk], blend: 'multiply' };
    case 'ryb': return { inks: rybInks.slice(0, settings.layerCount), blend: 'multiply' };
    case 'rgb': return { inks: rgbInks, blend: 'screen' };
    case 'anaglyph': return { inks: anaglyphInks, blend: 'screen' };
    case 'cmy':
    default: return { inks: [cmyInk(0), cmyInk(1), cmyInk(2)].slice(0, settings.layerCount), blend: 'multiply' };
  }
}

/** A layered cell body: N tinted copies of the icon, each blended against the
 *  shared page (white for multiply styles, black for screen). No per-cell rect
 *  or isolation — the page IS the blend backdrop. Subtractive styles shrink each
 *  successive layer (concentric inks); additive/anaglyph stay full size. */
function layeredBody(cell: Cell, settings: Settings, iconId: string): string {
  const { inks, blend } = inksFor(settings);
  const n = inks.length;
  const base = scaleFor(cell, settings);
  const shrink = blend === 'multiply'; // CMY/RYB inks nest; RGB/anaglyph overlap full-size
  const r = cell.r / 255, g = cell.g / 255, b = cell.b / 255;
  const off = settings.layerOffset;
  const op = opAttr(opacityFor(cell, settings)); // fades the whole stack uniformly
  let s = '';
  for (let i = 0; i < n; i++) {
    const scale = shrink ? r1(base * (1 - i / n)) : base; // even concentric steps
    const { x, y, size } = cellBox(cell, settings, scale);
    const ox = r1(x + inks[i].dx * off);
    const oy = r1(y + inks[i].dy * off);
    s += `<use href="#${iconId}" x="${ox}" y="${oy}" width="${size}" height="${size}" ` +
      `color="${inks[i].color(r, g, b)}"${op} style="mix-blend-mode:${blend}"/>`;
  }
  return s;
}

/** A layered cell: CMY multiply stack or RGB-additive stack, then the motion
 *  wrapper. The scheme already transformed cell.r/g/b upstream, so both styles
 *  pick up the scheme for free. */
function emitLayered(cell: Cell, settings: Settings, index: number, iconCount: number): string {
  const iconId = iconFor(cell, iconCount);
  const body = rotateWrap(layeredBody(cell, settings, iconId), cell, index, settings);
  // OUTER group: motion only. .motion (incl. will-change) GPU-promotes it so the
  // browser caches the cell's raster and moves/scales the bitmap per frame. No
  // motion -> bare body, output unchanged.
  const mo = motionAttrs(cell, index, settings);
  return mo ? `<g${mo}>${body}</g>` : body;
}

/** The <use>(s) for a single cell. One per cell, or a CMY stack if layered. */
function emitCell(cell: Cell, settings: Settings, index: number, iconCount: number): string {
  if (settings.layered) return emitLayered(cell, settings, index, iconCount);

  const { x, y, size } = cellBox(cell, settings);
  const iconId = iconFor(cell, iconCount);
  // Tint via color= (makeTintable forces icons to currentColor, so this recolors
  // any art). This is GPU-cheap and the SAME mechanism CMY uses — unlike the old
  // per-cell SVG filter, which re-rasterized every frame when animated and made
  // motion lag. fill= too, for belt-and-suspenders on currentColor inheritance.
  const fill = `rgb(${Math.round(cell.r)},${Math.round(cell.g)},${Math.round(cell.b)})`;
  const el = rotateWrap(
    `<use href="#${iconId}" x="${x}" y="${y}" width="${size}" height="${size}" ` +
    `fill="${fill}" color="${fill}"${opAttr(opacityFor(cell, settings))}/>`,
    cell, index, settings);
  // Motion on a <g> wrapper, not the <use>: fill-box on a <use>->symbol instance
  // resolves inconsistently (symbol geometry vs placed box). A <g>'s fill-box is
  // its children's rendered box = this icon in place, so it pivots around its OWN
  // centre regardless of canvas size. No motion -> bare element, output unchanged.
  const mo = motionAttrs(cell, index, settings);
  return mo ? `<g${mo}>${el}</g>` : el;
}

/**
 * Pure core: grid + parsed svg + settings -> one standalone <svg> string.
 * No DOM reads, no canvas — re-runs cheaply on every settings change.
 */
export function render(grid: Cell[], icons: ParsedSvg[], settings: Settings): string {
  if (grid.length === 0 || icons.length === 0) return '';
  // Pool N x N source cells into one averaged icon (blockSize). Must run before
  // we read cols/rows: it re-indexes the grid to a smaller one, so every
  // downstream use (canvas size, cell placement, filter dedup) stays consistent.
  const fullRows = Math.max(...grid.map((c) => c.row)) + 1; // before pooling
  grid = poolCells(grid, settings.cols, settings.blockSize);
  // Derive grid dims from the (possibly pooled) grid, not settings.cols.
  const cols = Math.max(...grid.map((c) => c.col)) + 1;
  const rows = Math.max(...grid.map((c) => c.row)) + 1;
  // Internal coordinate space = the pooled grid at CELL each. The icons render
  // here, naturally smaller when pooled (fewer, bigger cells).
  const w = cols * CELL;
  const h = rows * CELL;
  // Rendered (pixel) size = the UN-pooled canvas, so the footprint stays constant
  // as block grows: the viewBox content is scaled up to fill it. block only
  // changes how many icons cover the same area, not the canvas size.
  const outW = settings.cols * CELL;
  const outH = fullRows * CELL;

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
  if (doAdjust || doScheme || doDither || doOverlay) {
    const spread = settings.ditherStrength * 255;
    grid = grid.map((c) => {
      let rgb: RGB = { r: c.r, g: c.g, b: c.b };
      if (doAdjust) rgb = adjustColor(rgb, adjust);
      if (doDither) {
        const off = (bayer(c.col, c.row) - 0.5) * spread;
        rgb = { r: rgb.r + off, g: rgb.g + off, b: rgb.b + off };
      }
      if (doScheme) rgb = transformColor(rgb, settings.scheme);
      if (doOverlay) rgb = overlayColor(rgb, overlayU(c.col, c.row, cols, rows, overlay.dir), overlay);
      return { ...c, r: rgb.r, g: rgb.g, b: rgb.b };
    });
  }

  // One <symbol id="icon{i}"> per uploaded SVG; each cell picks one by brightness
  // (iconFor). Single icon -> just #icon0, identical to before.
  const symbols = icons
    .map((svg, i) => `<symbol id="icon${i}" viewBox="${svg.viewBox}" overflow="visible">${svg.innerSvg}</symbol>`)
    .join('');
  const defs = `<defs>${symbols}</defs>`;
  // Motion keyframes baked into the SVG (no JS loop) — so animation survives
  // export: the downloaded .svg stays alive. '' when motion:'none'.
  const style = motionStyle(settings);
  // Background = the blend backdrop for layered styles, else the sampled bg.
  // SUBTRACTIVE inks (cmy/cmyk/ryb) multiply -> need a WHITE page (multiply's
  // identity) so the inks resolve to the cell colour with no per-cell rect.
  // ADDITIVE (rgb/anaglyph) screen -> need a BLACK page (screen's identity).
  let bgFill = settings.background;
  if (settings.layered) bgFill = SUBTRACTIVE.has(settings.layerStyle) ? '#ffffff' : '#000000';
  const bg = `<rect width="${w}" height="${h}" fill="${bgFill}"/>`;
  const uses = grid.map((c, i) => emitCell(c, settings, i, icons.length)).join('');

  // aspect-ratio locks the element box to the image ratio; --ar (the numeric ratio)
  // lets the maximized CSS size it correctly with min() (CSS can't read a ratio at
  // runtime, so we pass it in). width/height attrs stay for the PNG export raster.
  const ar = r2(outW / outH);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" ` +
    `width="${outW}" height="${outH}" style="aspect-ratio:${outW}/${outH};--ar:${ar}">${style}${defs}${bg}${uses}</svg>`;
}

export { emitCell };
