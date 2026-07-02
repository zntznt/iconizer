import type { Settings } from './settings.ts';
import { LUMA } from './color.ts';

export type Cell = {
  col: number;
  row: number;
  r: number; // 0-255 average
  g: number;
  b: number;
  brightness: number; // 0-1, perceptual luma
};

/** Rows that keep cells roughly square for a given image and column count. */
export function rowsFor(imgWidth: number, imgHeight: number, cols: number): number {
  const cellW = imgWidth / cols;
  return Math.max(1, Math.round(imgHeight / cellW));
}

/** Grid dimensions by scanning, not `Math.max(...grid.map(...))`: spreading a
 *  big grid (100 cols on a tall image can pass 65k cells) into a call blows the
 *  engine's argument limit with a RangeError. */
export function gridDims(grid: Cell[]): { cols: number; rows: number } {
  let cols = 0, rows = 0;
  for (const c of grid) {
    if (c.col >= cols) cols = c.col + 1;
    if (c.row >= rows) rows = c.row + 1;
  }
  return { cols, rows };
}

/**
 * Merge each block x block group of cells into ONE averaged cell (a downsample /
 * pooling step). block=1 is identity. block=2 turns a 32-wide grid into 16 icons,
 * each the average of its 2x2 source cells — so one icon represents a chunk of the
 * image, not a single sample, and fills that chunk's space when rendered.
 *
 * Pure Cell[] -> Cell[]. brightness is RE-derived from the averaged rgb (not
 * averaged itself) so it matches how a single cell computes it.
 */
export function poolCells(grid: Cell[], cols: number, block: number): Cell[] {
  if (block <= 1 || grid.length === 0) return grid;
  const { rows } = gridDims(grid);
  const at = new Map(grid.map((c) => [c.row * cols + c.col, c]));
  const outCols = Math.ceil(cols / block);
  const outRows = Math.ceil(rows / block);
  const out: Cell[] = [];

  for (let br = 0; br < outRows; br++) {
    for (let bc = 0; bc < outCols; bc++) {
      let r = 0, g = 0, b = 0, n = 0;
      // average every source cell in this block (clamped at the grid edge).
      for (let dy = 0; dy < block; dy++) {
        for (let dx = 0; dx < block; dx++) {
          const c = at.get((br * block + dy) * cols + (bc * block + dx));
          if (c) { r += c.r; g += c.g; b += c.b; n++; }
        }
      }
      if (n === 0) continue; // whole block off the edge
      r /= n; g /= n; b /= n;
      out.push({ col: bc, row: br, r, g, b, brightness: (LUMA.r * r + LUMA.g * g + LUMA.b * b) / 255 });
    }
  }
  return out;
}

/**
 * Pure core: average an RGBA pixel buffer into a Cell[] grid.
 * `pixels` is row-major RGBA (4 bytes/pixel), the shape getImageData returns.
 * Split out from sample() so it's testable without a canvas.
 */
export function averageCells(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  cols: number,
): Cell[] {
  const rows = rowsFor(width, height, cols);
  const cells: Cell[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Cell rectangle in pixel space. Clamp the last col/row to the edge.
      const x0 = Math.floor((col * width) / cols);
      const x1 = Math.min(width, Math.floor(((col + 1) * width) / cols));
      const y0 = Math.floor((row * height) / rows);
      const y1 = Math.min(height, Math.floor(((row + 1) * height) / rows));

      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          r += pixels[i];
          g += pixels[i + 1];
          b += pixels[i + 2];
          // alpha already flattened onto white in sample() before getImageData,
          // so RGB here is the composited color — averaging it directly is correct.
          n++;
        }
      }
      if (n === 0) n = 1; // degenerate 1px-wide cell guard
      r /= n; g /= n; b /= n;

      // ponytail: averaged in raw sRGB, not linear light. Gamma-correct
      // (decode -> average -> encode) if tonal accuracy ever matters.
      const brightness = (LUMA.r * r + LUMA.g * g + LUMA.b * b) / 255;
      cells.push({ col, row, r, g, b, brightness });
    }
  }
  return cells;
}

// Sampling resolution cap. averageCells is a box filter, so letting drawImage
// downscale first (native code) barely changes the per-cell averages but shrinks
// the getImageData buffer + JS loop by 10-100x on a big photo. 1024 leaves ~10px
// per cell even at 100 cols, plenty of samples for a stable average.
const MAX_SAMPLE_SIDE = 1024;

/** Draw the image to a canvas, read pixels once, average into a Cell[] grid. */
export function sample(
  image: ImageBitmap | HTMLImageElement,
  settings: Settings,
): Cell[] {
  const srcW = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
  const srcH = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
  const k = Math.min(1, MAX_SAMPLE_SIDE / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * k));
  const height = Math.max(1, Math.round(srcH * k));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2d canvas context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high'; // the downscale IS part of the averaging
  // Flatten transparency onto settings.background so transparent PNGs don't
  // average toward black. The composite color is an input to the color model
  // (it sets the CMY floor in Phase 4), not just cosmetic — see batch-02 append.
  ctx.fillStyle = settings.background;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  const { data } = ctx.getImageData(0, 0, width, height);
  return averageCells(data, width, height, settings.cols);
}
