# Batch 01 — Scaffold + Sampling (Phase 0 + 1)

Goal: a Vite app that boots, plus a working `sample()` that turns an uploaded
image into a grid of averaged-color cells. No rendering of the SVG yet — this
batch ends when sampling is correct and proven.

## Phase 0 — Scaffold

1. `npm create vite@latest . -- --template vanilla-ts` in the repo root.
2. Add MIT `LICENSE` (holder: zntznt, year 2026).
3. `vite.config.ts`: set `base: '/iconizer/'` (required for GitHub Pages).
4. Strip the Vite demo counter/boilerplate out of `index.html` / `main.ts`.
5. Confirm `npm run dev` serves a blank page with no console errors.
6. Commit: `chore: scaffold Vite vanilla-ts app`.

## Phase 1 — Sampling

Create `src/settings.ts`:

    export type Settings = {
      cols: number;          // grid columns; rows derived from image aspect
      // (more fields land in later phases)
    };
    export const defaults: Settings = { cols: 32 };

Create `src/sample.ts`:

    export type Cell = {
      col: number; row: number;
      r: number; g: number; b: number;   // 0-255 average for the cell
      brightness: number;                 // 0-1, perceptual luma
    };

    export function sample(image: ImageBitmap | HTMLImageElement,
                           settings: Settings): Cell[]

Implementation:

- Draw the image to an offscreen `<canvas>` / `OffscreenCanvas`.
- Derive `rows` from `cols` and the image aspect ratio (keep cells ~square).
- `getImageData` once for the whole image; for each cell, average the pixels in
  its rectangle. Average in linear-ish RGB is fine — don't over-engineer color
  space here. `ponytail:` comment if you skip gamma.
- `brightness = (0.2126*r + 0.7152*g + 0.0722*b) / 255` (perceptual luma).

Wire a minimal `index.html` + `main.ts`: a single `<input type="file" accept="image/*">`
that loads the image, runs `sample()`, and logs the Cell[] length + first cell to
the console. That's enough to see it working — no visual output yet.

## Self-check (required)

Leave one runnable assert. Smallest thing that fails if sampling breaks:

- A solid `rgb(255,0,0)` source (drawn programmatically to a canvas) sampled at
  `cols: 2` returns 4 cells, each with `r≈255, g≈0, b≈0` and `brightness≈0.21`.

Put it in `src/sample.ts` behind an `if (import.meta.env.DEV)` self-check or a
tiny `src/sample.test.ts` runnable with `node --test` via tsx — whichever is less
setup. Don't add a test framework.

## Done when

- `npm run dev` boots clean.
- Selecting an image logs a sensible Cell[] (length = cols*rows, plausible colors).
- The solid-red assert passes.
- Committed to `main` in 2 commits (scaffold, then sampling).

## Out of scope for this batch

SVG upload, `<symbol>`/`<use>` rendering, export, settings panel UI, deploy.
Those are Phase 2+.
