import type { Settings } from './settings.ts';

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
          // ponytail: alpha ignored — premultiply if transparent sources matter.
          n++;
        }
      }
      if (n === 0) n = 1; // degenerate 1px-wide cell guard
      r /= n; g /= n; b /= n;

      // ponytail: averaged in raw sRGB, not linear light. Gamma-correct
      // (decode -> average -> encode) if tonal accuracy ever matters.
      const brightness = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      cells.push({ col, row, r, g, b, brightness });
    }
  }
  return cells;
}

/** Draw the image to a canvas, read pixels once, average into a Cell[] grid. */
export function sample(
  image: ImageBitmap | HTMLImageElement,
  settings: Settings,
): Cell[] {
  const width = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
  const height = image instanceof HTMLImageElement ? image.naturalHeight : image.height;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2d canvas context unavailable');
  ctx.drawImage(image, 0, 0, width, height);

  const { data } = ctx.getImageData(0, 0, width, height);
  return averageCells(data, width, height, settings.cols);
}
