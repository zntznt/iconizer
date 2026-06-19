import type { Cell } from './sample.ts';
import type { Settings } from './settings.ts';
import type { ParsedSvg } from './parseSvg.ts';
import { transformColor } from './color.ts';
import { motionStyle, motionAttrs } from './motion.ts';

// Each cell occupies a CELL x CELL box in output user units. Arbitrary; the
// root viewBox scales the whole thing, so this is just internal resolution.
const CELL = 16;

/** Round to keep the output string small and stable for the self-check. */
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Scale factor for one cell's icon when sizeByBrightness is on. */
function scaleFor(cell: Cell, settings: Settings): number {
  if (!settings.sizeByBrightness) return 1;
  const [min, max] = settings.sizeRange;
  // darker cell -> larger icon (reads as ink density on a light ground)
  return min + (max - min) * (1 - cell.brightness);
}

/** Quantize a 0-255 channel to a coarse step so cells share filter defs. */
const QUANT = 32;
const q = (v: number) => Math.min(255, Math.round(v / QUANT) * QUANT);

/** A stable id + a flood-through-alpha filter for one quantized color. */
function filterFor(r: number, g: number, b: number) {
  const id = `t${q(r)}-${q(g)}-${q(b)}`;
  // Flood the target color and keep it only where the icon is opaque
  // (SourceAlpha). This recolors ANY art — solid black, white, multicolor —
  // because it ignores the source's own RGB and uses only its shape. The old
  // luminance-matrix approach left solid-dark icons black (lum~0 -> color~0).
  const color = `rgb(${q(r)},${q(g)},${q(b)})`;
  const def = `<filter id="${id}" color-interpolation-filters="sRGB">` +
    `<feFlood flood-color="${color}"/>` +
    `<feComposite in2="SourceAlpha" operator="in"/></filter>`;
  return { id, def };
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
function emitLayered(cell: Cell, settings: Settings, index: number): string {
  const n = settings.layerCount;
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
    s += `<use href="#icon" x="${ox}" y="${oy}" width="${size}" height="${size}" ` +
      `color="${ink}" style="mix-blend-mode:multiply"/>`;
  }
  // Own isolated blend group + white backing so multiply sees only this cell,
  // not its neighbours (which would cascade the whole canvas to black).
  // Motion class goes on this <g> so the CMY stack moves as ONE unit, colors
  // stay registered (batch-07 "together"). ponytail: batch-07b's per-layer
  // "apart" motion would instead hang the class off the child <use>s below.
  const bx = r2(cell.col * CELL), by = r2(cell.row * CELL);
  return `<g style="isolation:isolate"${motionAttrs(cell, index, settings)}>` +
    `<rect x="${bx}" y="${by}" width="${CELL}" height="${CELL}" fill="#fff"/>` +
    `${s}</g>`;
}

/** The <use>(s) for a single cell. One per cell, or a CMY stack if layered. */
function emitCell(cell: Cell, settings: Settings, index: number): string {
  if (settings.layered) return emitLayered(cell, settings, index);

  const { x, y, size } = cellBox(cell, settings);
  const mo = motionAttrs(cell, index, settings); // class+delay on the single <use>
  const base = `<use href="#icon" x="${x}" y="${y}" width="${size}" height="${size}"${mo}`;

  if (settings.tintMode === 'filter') {
    const { id } = filterFor(cell.r, cell.g, cell.b);
    return `${base} filter="url(#${id})"/>`;
  }
  // fill mode: needs the source SVG to use fill="currentColor"/inherit.
  const fill = `rgb(${Math.round(cell.r)},${Math.round(cell.g)},${Math.round(cell.b)})`;
  return `${base} fill="${fill}" color="${fill}"/>`;
}

/**
 * Pure core: grid + parsed svg + settings -> one standalone <svg> string.
 * No DOM reads, no canvas — re-runs cheaply on every settings change.
 */
export function render(grid: Cell[], svg: ParsedSvg, settings: Settings): string {
  if (grid.length === 0) return '';
  const cols = settings.cols;
  const rows = Math.max(...grid.map((c) => c.row)) + 1;
  const w = cols * CELL;
  const h = rows * CELL;

  // Single upstream colour remap: everything downstream (filter defs, solid
  // fill, CMY split) consumes the transformed colour, so schemes compose with
  // both modes for free. 'none' is identity -> prior output unchanged.
  if (settings.scheme.kind !== 'none') {
    grid = grid.map((c) => ({ ...c, ...transformColor(c, settings.scheme) }));
  }

  const symbol = `<symbol id="icon" viewBox="${svg.viewBox}" overflow="visible">${svg.innerSvg}</symbol>`;

  // Collect distinct filter defs (solid filter mode only) so we emit each once.
  const filters = new Map<string, string>();
  if (!settings.layered && settings.tintMode === 'filter') {
    for (const c of grid) {
      const { id, def } = filterFor(c.r, c.g, c.b);
      if (!filters.has(id)) filters.set(id, def);
    }
  }
  // ponytail: filter mode quantizes color to QUANT-step buckets so cells share
  // a handful of <filter> defs. Drop QUANT (finer buckets) if banding shows.

  const defs = `<defs>${symbol}${[...filters.values()].join('')}</defs>`;
  // Motion keyframes baked into the SVG (no JS loop) — so animation survives
  // export: the downloaded .svg stays alive. '' when motion:'none'.
  const style = motionStyle(settings);
  // Same background the source was sampled against, so sample <-> display <->
  // export all match. Sits behind the icons.
  const bg = `<rect width="${w}" height="${h}" fill="${settings.background}"/>`;
  const uses = grid.map((c, i) => emitCell(c, settings, i)).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" ` +
    `width="${w}" height="${h}">${style}${defs}${bg}${uses}</svg>`;
}

export { emitCell };
