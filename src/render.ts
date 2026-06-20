import type { Cell } from './sample.ts';
import { poolCells } from './sample.ts';
import type { Settings } from './settings.ts';
import type { ParsedSvg } from './parseSvg.ts';
import { transformColor } from './color.ts';
import { motionStyle, motionAttrs } from './motion.ts';

// Each cell occupies a CELL x CELL box in output user units. Arbitrary; the
// root viewBox scales the whole thing, so this is just internal resolution.
const CELL = 16;

/** Round to keep the output string small and stable for the self-check. */
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Scale factor for one cell's icon: global iconScale x optional brightness scale.
 *  iconScale > 1 makes icons larger than their cell, so they overlap neighbours
 *  (a denser, tiled look) — independent of column count. The <symbol> is
 *  overflow:visible, so oversized icons don't clip. */
function scaleFor(cell: Cell, settings: Settings): number {
  const tonal = settings.sizeByBrightness
    ? settings.sizeRange[0] +
      (settings.sizeRange[1] - settings.sizeRange[0]) * (1 - cell.brightness)
    : 1;
  return settings.iconScale * tonal;
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
  const size = r2(CELL * scale);
  const pad = r2((CELL - size) / 2); // center the shrunk icon in its box
  return { x: r2(cell.col * CELL + pad), y: r2(cell.row * CELL + pad), size };
}

// CMY layer geometry, biggest first. Each layer subtracts ONE channel via
// multiply blend; offset directions give the chromatic-aberration shimmer.
// chan = which RGB channel this ink removes (cyan->R, magenta->G, yellow->B).
const INKS = [
  { chan: 0, dx: -1, dy: -1 }, // cyan    removes red,   up-left
  { chan: 1, dx: 1, dy: 1 }, //   magenta removes green, down-right
  { chan: 2, dx: -1, dy: 1 }, //  yellow  removes blue,  down-left
] as const;

/** Ink fill for one channel at strength s∈[0,1]: white except the removed
 *  channel dimmed to (1-s). Multiplied against white -> that channel = 1-s. */
function inkFill(chan: number, s: number): string {
  const v = Math.round(255 * (1 - s));
  const rgb = [255, 255, 255];
  rgb[chan] = v;
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

/** CMY layered body: 2-3 multiply-blended <use> subtracting R/G/B channels, in
 *  an isolated group over white so they multiply to the exact cell colour. */
function cmyBody(cell: Cell, settings: Settings, iconId: string): string {
  const n = settings.layerCount;
  // ponytail: naive CMY — no black (K) channel, no per-channel screen angles.
  const strength = [1 - cell.r / 255, 1 - cell.g / 255, 1 - cell.b / 255];
  const base = scaleFor(cell, settings);
  let s = '';
  for (let i = 0; i < n; i++) {
    const scale = r2(base * (1 - i / n)); // even steps: 1, 1-1/n, 1-2/n ...
    const { x, y, size } = cellBox(cell, settings, scale);
    const off = settings.layerOffset;
    const ox = r2(x + INKS[i].dx * off);
    const oy = r2(y + INKS[i].dy * off);
    const ink = inkFill(INKS[i].chan, strength[i]);
    s += `<use href="#${iconId}" x="${ox}" y="${oy}" width="${size}" height="${size}" ` +
      `color="${ink}" style="mix-blend-mode:multiply"/>`;
  }
  const bx = r2(cell.col * CELL), by = r2(cell.row * CELL);
  // INNER group: isolated blend + white backing. STATIC — multiply resolves once
  // to the exact colour. Animating it would re-blend against black (the old bug).
  return `<g style="isolation:isolate">` +
    `<rect x="${bx}" y="${by}" width="${CELL}" height="${CELL}" fill="#fff"/>${s}</g>`;
}

/** RGB additive layered body: 3 full-size icons carrying each channel's TRUE
 *  value (r,0,0 / 0,g,0 / 0,0,b), screen-blended so where the shapes overlap the
 *  channels ADD back to the exact cell colour — like RGB subpixels combining.
 *  screen is the additive mirror of CMY's multiply.
 *
 *  No per-cell backing or isolation: the global black background (forced in
 *  render() for this style) is screen's identity backdrop, so the 3 layers add to
 *  (r,g,b) without any extra nodes — fewest nodes, cheapest to composite.
 *  Tradeoff: where motion (pulse/offset) pushes a cell over its neighbours, the
 *  moving cell screens over their pixels and the seam can flicker. Keep offset
 *  modest if that shows; re-add a per-cell isolation group if it ever matters. */
function rgbBody(cell: Cell, settings: Settings, iconId: string): string {
  const CHANS = [
    { fill: `rgb(${Math.round(cell.r)},0,0)`, dx: -1, dy: -1 },
    { fill: `rgb(0,${Math.round(cell.g)},0)`, dx: 1, dy: 1 },
    { fill: `rgb(0,0,${Math.round(cell.b)})`, dx: -1, dy: 1 },
  ];
  const { x, y, size } = cellBox(cell, settings);
  const off = settings.layerOffset;
  let s = '';
  for (const ch of CHANS) {
    const ox = r2(x + ch.dx * off);
    const oy = r2(y + ch.dy * off);
    s += `<use href="#${iconId}" x="${ox}" y="${oy}" width="${size}" height="${size}" ` +
      `color="${ch.fill}" style="mix-blend-mode:screen"/>`;
  }
  return s;
}

/** A layered cell: CMY multiply stack or RGB-additive stack, then the motion
 *  wrapper. The scheme already transformed cell.r/g/b upstream, so both styles
 *  pick up the scheme for free. */
function emitLayered(cell: Cell, settings: Settings, index: number, iconCount: number): string {
  const iconId = iconFor(cell, iconCount);
  const body = settings.layerStyle === 'rgb'
    ? rgbBody(cell, settings, iconId)
    : cmyBody(cell, settings, iconId);
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
  const el = `<use href="#${iconId}" x="${x}" y="${y}" width="${size}" height="${size}" fill="${fill}" color="${fill}"/>`;
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

  // Single upstream colour remap: everything downstream (filter defs, solid
  // fill, CMY split) consumes the transformed colour, so schemes compose with
  // both modes for free. 'none' is identity -> prior output unchanged.
  if (settings.scheme.kind !== 'none') {
    grid = grid.map((c) => ({ ...c, ...transformColor(c, settings.scheme) }));
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
  // Same background the source was sampled against, so sample <-> display <->
  // export all match. Sits behind the icons. RGB-additive style FORCES black: it
  // screen-blends, and screen's identity backdrop is black — anything else washes
  // the colours out, and a non-black page is where the old per-cell rects showed.
  const bgFill = settings.layered && settings.layerStyle === 'rgb' ? '#000000' : settings.background;
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
