# iconizer

Upload an image + an SVG, render the image as a mosaic where each grid cell is a
tinted/scaled copy of the SVG. Settings tune how the SVG "array" behaves (size,
color schemes, layered multi-color "quasi-RGB" per cell).

## Core model

The whole app is one pure function plus a settings object:

    render(grid, svg, settings) -> output SVG string

- `sample.ts` turns the source image into a `Cell[]` grid (canvas + getImageData).
- `render.ts` is the pure core: grid + svg + settings -> one `<svg>` string.
- Everything else (upload, sliders, export) is plumbing around that.

Keep `render()` pure, with no DOM reads inside, so it re-runs cheaply on every
settings change and stays the one thing worth a unit test.

## Stack & constraints

- Vite + vanilla TS. **No runtime dependencies**: canvas, SVG, and the File API
  are all native. Don't add an image-processing or SVG library; a few lines beat
  a dep here. Dev-only deps are fine.
- 100% client-side. No backend, no storage. Uploaded images never leave the
  browser, which is why it's safe and free to host.
- Deploys to **GitHub Pages**, so `vite.config.ts` must keep `base: '/iconizer/'`.

## Conventions

- Output SVG uses `<symbol id="icon">` + N `<use>` elements: define the shape
  once, reference it per cell. This is what keeps a 100x100 grid a small file.
  Layered "quasi-RGB" = stacking 2-3 `<use>` of the same symbol per cell.
- Non-trivial logic (the sampling loop, the render loop) leaves ONE runnable
  `assert`-based self-check. No test framework unless it earns its place.
- Mark deliberate shortcuts with a `ponytail:` comment naming the ceiling and the
  upgrade path (e.g. SVG sanitization is deferred; see guidance/PLAN.md).
- **No em dashes (or en dashes), ever**, in anything you write here: code,
  comments, docs, UI copy, and commit messages. Rephrase the sentence so it reads
  naturally without a dash. Do not just swap in a hyphen or other symbol; if a
  sentence only works with a dash, rewrite it so it doesn't.

## Working here

- Solo project, pre-launch. Commit straight to `main`, no branches.
- Plan and per-batch briefs live in `guidance/`. Read the relevant brief before
  starting a phase; read `guidance/PLAN.md` for the whole arc.
- **Before any research/positioning/feature-scoping work, read
  `guidance/competitive-landscape.md`.** It records what already exists vs. what's
  ours. Protect the differentiators (esp. channel-split layering as a mosaic
  primitive); update that doc when new research lands.
- `npm test` covers the pure cores only. Anything needing a real browser (canvas,
  download, visual correctness) has a re-runnable checklist in
  `guidance/manual-tests.md`. Run the relevant phase's checks after touching
  sampling/render/tint/export. Tests passing is necessary, not sufficient.
- `npm run lint` (type-aware ESLint) must stay clean. tsconfig includes the test
  files, so `tsc` checks them too (tsx alone strips types without checking).
