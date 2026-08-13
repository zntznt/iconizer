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
  // Flat row-major index rather than a Map: `new Map(grid.map(...))` allocated a
  // two-element array per cell just to build the entries, and pooling re-runs on
  // every redraw while blockSize > 1. Same lookup semantics (a later duplicate
  // wins, a miss reads undefined), none of the boxing.
  const at = new Array<Cell | undefined>(rows * cols);
  for (const c of grid) at[c.row * cols + c.col] = c;
  const outCols = Math.ceil(cols / block);
  const outRows = Math.ceil(rows / block);
  const out: Cell[] = [];

  for (let br = 0; br < outRows; br++) {
    for (let bc = 0; bc < outCols; bc++) {
      let r = 0, g = 0, b = 0, n = 0;
      // average every source cell in this block (clamped at the grid edge).
      for (let dy = 0; dy < block; dy++) {
        for (let dx = 0; dx < block; dx++) {
          const c = at[(br * block + dy) * cols + (bc * block + dx)];
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
  const cells: Cell[] = new Array<Cell>(rows * cols); // exact size is known up front

  // Cell rectangle in pixel space, clamped to the edge. The column bounds depend
  // only on `col`, so they're floored ONCE here instead of re-floored for every
  // row: at 100 columns on a 1024px image that's 75,000 divisions saved.
  const xs0 = new Int32Array(cols), xs1 = new Int32Array(cols);
  for (let col = 0; col < cols; col++) {
    xs0[col] = Math.floor((col * width) / cols);
    xs1[col] = Math.min(width, Math.floor(((col + 1) * width) / cols));
  }

  let k = 0;
  for (let row = 0; row < rows; row++) {
    const y0 = Math.floor((row * height) / rows);
    const y1 = Math.min(height, Math.floor(((row + 1) * height) / rows));
    for (let col = 0; col < cols; col++) {
      const x0 = xs0[col], x1 = xs1[col];
      let r = 0, g = 0, b = 0;
      for (let y = y0; y < y1; y++) {
        // Walk the row segment with a running offset: the old form recomputed
        // (y * width + x) * 4 for every pixel.
        let i = (y * width + x0) * 4;
        for (let x = x0; x < x1; x++) {
          r += pixels[i];
          g += pixels[i + 1];
          b += pixels[i + 2];
          // alpha already flattened onto white in sample() before getImageData,
          // so RGB here is the composited color — averaging it directly is correct.
          i += 4;
        }
      }
      // pixel count is the rectangle's area (bounds are non-decreasing, so it is
      // never negative); 0 is the degenerate 1px-wide cell guard.
      const n = (x1 - x0) * (y1 - y0) || 1;
      r /= n; g /= n; b /= n;

      // ponytail: averaged in raw sRGB, not linear light. Gamma-correct
      // (decode -> average -> encode) if tonal accuracy ever matters.
      const brightness = (LUMA.r * r + LUMA.g * g + LUMA.b * b) / 255;
      cells[k++] = { col, row, r, g, b, brightness };
    }
  }
  return cells;
}

// Sampling resolution cap. averageCells is a box filter, so letting drawImage
// downscale first (native code) barely changes the per-cell averages but shrinks
// the getImageData buffer + JS loop by 10-100x on a big photo. 1024 leaves ~10px
// per cell even at 100 cols, plenty of samples for a stable average.
const MAX_SAMPLE_SIDE = 1024;

// One scratch canvas for every sample(). A fresh <canvas> + 2d context per call
// costs a real allocation (and a backing surface the browser has to set up), and
// this runs on every column-slider tick and ~7 times a second in mirror mode. The
// canvas is never attached to the document, so reusing it is invisible: the
// background fillRect below repaints the whole surface before each draw.
let scratch: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;

/** Draw the image to a canvas, read pixels once, average into a Cell[] grid.
 *  Canvas sources serve mirror mode (a webcam frame drawn each tick). */
export function sample(
  image: ImageBitmap | HTMLImageElement | HTMLCanvasElement,
  settings: Settings,
): Cell[] {
  const srcW = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
  const srcH = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
  const k = Math.min(1, MAX_SAMPLE_SIDE / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * k));
  const height = Math.max(1, Math.round(srcH * k));

  if (!scratch) {
    scratch = document.createElement('canvas');
    scratchCtx = scratch.getContext('2d', { willReadFrequently: true });
  }
  const canvas = scratch;
  const ctx = scratchCtx;
  if (!ctx) throw new Error('2d canvas context unavailable');
  // Assigning width/height also clears the surface, so only touch them on a
  // change (a mirror feed holds one size for its whole run).
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high'; // the downscale IS part of the averaging
  // Flatten transparency onto settings.background so transparent PNGs don't
  // average toward black. The composite color is an input to the color model
  // (it sets the CMY floor in Phase 4), not just cosmetic, see batch-02 append.
  // Two guards keep the REUSED surface identical to the fresh one this used to
  // allocate, which always started out transparent black with a black fillStyle:
  //   'copy' makes the fill REPLACE rather than composite, so a background colour
  //   carrying alpha cannot leave the previous sample showing through;
  //   the '#000000' pre-set is where an unparseable colour has to land, since
  //   assigning a bad value to fillStyle is ignored and would otherwise keep the
  //   PREVIOUS call's colour. Both are reachable only through a hand-written
  //   permalink hash (decodeSettings casts, it does not validate).
  ctx.globalCompositeOperation = 'copy';
  ctx.fillStyle = '#000000';
  ctx.fillStyle = settings.background;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over'; // drawImage composites as before
  ctx.drawImage(image, 0, 0, width, height);

  const { data } = ctx.getImageData(0, 0, width, height);
  return averageCells(data, width, height, settings.cols);
}
