import type { Cell } from './sample.ts';
import type { Settings } from './settings.ts';
import type { ParsedSvg } from './parseSvg.ts';

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

/** A stable id + the channel-tinting feColorMatrix for one quantized color. */
function filterFor(r: number, g: number, b: number) {
  const id = `t${q(r)}-${q(g)}-${q(b)}`;
  // Map source luminance onto the target color: out = lum * (target/255).
  // Drops the source's own hue (acceptable — filter mode is "approximate").
  const fr = q(r) / 255, fg = q(g) / 255, fb = q(b) / 255;
  const lr = 0.2126, lg = 0.7152, lb = 0.0722;
  const m = [
    fr * lr, fr * lg, fr * lb, 0, 0,
    fg * lr, fg * lg, fg * lb, 0, 0,
    fb * lr, fb * lg, fb * lb, 0, 0,
    0, 0, 0, 1, 0,
  ].map(r2).join(' ');
  const def = `<filter id="${id}" color-interpolation-filters="sRGB">` +
    `<feColorMatrix type="matrix" values="${m}"/></filter>`;
  return { id, def };
}

/** The <use>(s) for a single cell. One per cell in this phase. */
function emitCell(cell: Cell, settings: Settings): string {
  const scale = scaleFor(cell, settings);
  const size = r2(CELL * scale);
  const pad = r2((CELL - size) / 2); // center the shrunk icon in its box
  const x = r2(cell.col * CELL + pad);
  const y = r2(cell.row * CELL + pad);
  const base = `<use href="#icon" x="${x}" y="${y}" width="${size}" height="${size}"`;

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

  const symbol = `<symbol id="icon" viewBox="${svg.viewBox}" overflow="visible">${svg.innerSvg}</symbol>`;

  // Collect distinct filter defs (filter mode only) so we emit each once.
  const filters = new Map<string, string>();
  if (settings.tintMode === 'filter') {
    for (const c of grid) {
      const { id, def } = filterFor(c.r, c.g, c.b);
      if (!filters.has(id)) filters.set(id, def);
    }
  }
  // ponytail: filter mode quantizes color to QUANT-step buckets so cells share
  // a handful of <filter> defs. Drop QUANT (finer buckets) if banding shows.

  const defs = `<defs>${symbol}${[...filters.values()].join('')}</defs>`;
  const uses = grid.map((c) => emitCell(c, settings)).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" ` +
    `width="${w}" height="${h}">${defs}${uses}</svg>`;
}

export { emitCell };
