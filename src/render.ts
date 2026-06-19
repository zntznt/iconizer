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

/** Layered CMY stack for one cell: 2-3 multiply-blended <use> that subtract
 *  R/G/B channels so the stack reads as the actual cell color. */
function emitLayered(cell: Cell, settings: Settings, index: number, iconCount: number): string {
  const n = settings.layerCount;
  const iconId = iconFor(cell, iconCount);
  // ponytail: naive CMY — no black (K) channel, no per-channel screen angles.
  // Real CMYK extracts K so darks stay neutral (not muddy-brown) and rotates
  // each ink's screen to avoid moire. We stack SVGs, not print — add only if
  // darks look bad in practice.
  const strength = [1 - cell.r / 255, 1 - cell.g / 255, 1 - cell.b / 255];
  const base = scaleFor(cell, settings);
  let s = '';
  for (let i = 0; i < n; i++) {
    const scale = r2(base * (1 - i / n)); // even steps: 1, 1-1/n, 1-2/n ...
    const { x, y, size } = cellBox(cell, settings, scale);
    const off = settings.layerOffset;
    const ox = r2(x + INKS[i].dx * off);
    const oy = r2(y + INKS[i].dy * off);
    // color= (NOT fill=) — icons use fill="currentColor", which reads `color`.
    // Channel strength baked into the ink color (not opacity); multiply-blended
    // against the cell's white backing, 3 inks multiply to exactly (r,g,b).
    const ink = inkFill(INKS[i].chan, strength[i]);
    s += `<use href="#${iconId}" x="${ox}" y="${oy}" width="${size}" height="${size}" ` +
      `color="${ink}" style="mix-blend-mode:multiply"/>`;
  }
  const bx = r2(cell.col * CELL), by = r2(cell.row * CELL);
  // INNER group: isolated blend + white backing. STATIC — the multiply resolves
  // ONCE here (3 inks -> exact cell colour). Never animated; that's the fix for
  // the "goes black" bug: a transform promotes the element to its own layer and
  // the multiply re-blends against a transparent/black backdrop instead of this
  // white rect. So blending and motion must live on DIFFERENT elements.
  const blended =
    `<g style="isolation:isolate">` +
    `<rect x="${bx}" y="${by}" width="${CELL}" height="${CELL}" fill="#fff"/>` +
    `${s}</g>`;
  // OUTER group: motion only, no blend/isolation. The browser composites the
  // inner blended result to a buffer once, then cheaply transforms THAT buffer
  // per frame (no per-frame re-blend) — fixes the jank too. The .motion class
  // sets transform-box:fill-box + transform-origin:center, so this <g> pivots
  // around ITS OWN children's box = this icon's centre (canvas-irrelevant).
  const mo = motionAttrs(cell, index, settings);
  if (!mo) return blended;
  return `<g${mo}>${blended}</g>`;
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
  // export all match. Sits behind the icons.
  const bg = `<rect width="${w}" height="${h}" fill="${settings.background}"/>`;
  const uses = grid.map((c, i) => emitCell(c, settings, i, icons.length)).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" ` +
    `width="${outW}" height="${outH}">${style}${defs}${bg}${uses}</svg>`;
}

export { emitCell };
