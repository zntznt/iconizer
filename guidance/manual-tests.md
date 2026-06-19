# Manual / Browser Tests

The automated `npm test` suite covers the pure cores (`averageCells`,
`transformColor`, `render`/`emitCell`, `svgBlob`). It CANNOT cover anything that
needs a real browser: canvas rasterization, file download, and "does it actually
look right" visual checks. Those live here as a re-runnable checklist.

Run these after any change that touches sampling, rendering, tinting, or export —
the unit tests passing is necessary but not sufficient. Check the box in your head,
not in the file (keep this doc clean for the next run).

How to run: `npm run dev`, open the local URL, use a real image + a real SVG.
Keep a solid-color icon (e.g. a Font Awesome `*-solid.svg`) AND a `currentColor`
icon on hand — they exercise different tint paths.

## Why these exist (don't delete the ones that caught real bugs)

Each check below either caught a real bug or guards the brief's central risk.
Annotated so nobody prunes them as "obvious":

- **B2** caught the solid-dark-icon silent failure (filter mode left black icons
  black). This is the "is it even generating?" class of bug — looks broken, no error.
- **B3-PNG** guards the brief's central export risk: canvas tainting -> toBlob
  SecurityError. Self-contained SVG never taints, but a future external-font/image
  feature would break it silently.

---

## Phase 1 — Sampling (`sample.ts`)

- **S1** Upload an image. Console logs `sampled N cells` where N = cols × rows for
  the image's aspect ratio. No errors.
- **S2 (transparency)** Upload a PNG with transparency. Cells over transparent
  areas read as the `background` color (default white), NOT black. This is the
  b635034 fix — transparent art must not bias dark.

## Phase 2 — Render + tint (`render.ts`)

- **R1** Upload image + SVG. Mosaic renders. Blank before BOTH are present is by
  design — confirm it's blank-by-design, not blank-by-bug (no console errors).
- **R2 (filter mode, the default)** Use a SOLID-color icon (e.g. Font Awesome
  `*-solid.svg`, baked `fill="#000"`). Mosaic is full-color, NOT all-black.
  ← This is B2: the regression that reads as "not generating."
- **R3 (fill mode)** Switch to fill mode with a `currentColor` icon. Tints
  correctly (crisper/lighter than filter). With a solid-color icon, fill mode does
  NOT tint — that's by design; the label must warn ("currentColor icons").
- **R4 (filter quantization)** At a fine grid (e.g. 50+ cols), filter mode still
  renders quickly and the DOM has a SMALL number of `<filter>` defs (tens, not
  thousands). Inspect `<defs>` to confirm sharing.
- **R5 (cols slider)** Dragging cols re-renders live, smoothly (debounced).
- **R6 (sizeByBrightness)** Toggle on: icon sizes visibly vary by cell tone.
- **R7 (background)** Change the background color input: the mosaic's backdrop AND
  the sampling composite both follow it (sample <-> display match).
  NOTE: in LAYERED mode this applies only to the outer page backdrop — each cell's
  multiply backing is hardcoded white by necessity (multiply needs a white backdrop
  to resolve to the cell color; a tinted backing would skew every cell's hue). So
  `background` does not show through behind the icons in layered mode. By design —
  see batch-04 append. Test R7's "behind the icons" part in SOLID mode only.

## Phase 3 — Export (`export.ts`)

- **E1 (SVG download)** Click Download SVG. File downloads, opens correctly in a
  browser/editor, looks like the on-screen mosaic. Zero console errors.
- **E2 (PNG size invariant)** Download PNG at 1x/2x/4x. Output dimensions =
  on-screen SVG size × scale (e.g. 512px SVG at 2x -> 1024px PNG). ← guards the
  brief's stated invariant.
- **E3 (PNG no-taint)** PNG download succeeds and yields a valid `image/png`
  (toBlob did not throw SecurityError). ← B3-PNG, the central export risk. If this
  ever fails, an external resource crept into the SVG — check for external
  fonts/images, not the export code.
- **E4 (buttons gated)** Both export buttons are disabled until a render exists;
  export never triggers a re-render (uses the cached `lastSvg`).

## Phase 4 — Layered quasi-RGB (`render.ts`) — checks for when it lands

- **L1** Toggle layered on: look switches from flat tint to the CMY stack. Off ==
  byte-for-byte the Phase 2 solid-tint look (no regression).
- **L2 (the muddiness check)** A mid-tone photo renders as recognizable color, NOT
  muddy gray/brown. If muddy, opacity-per-channel is wrong — layers must use
  opacity ∝ ink strength, not fills alone. This is the brief's central mechanism.
- **L3 (near-white)** A near-white region -> all CMY layers near-transparent ->
  light cells, not dense overlap.
- **L4 (offset slider)** Offset > 0 produces the chromatic-aberration shimmer;
  offset == 0 is clean concentric.
- **L5 (layerCount)** 2 vs 3 inks visibly differ.

## Phase 5 — Color schemes — checks for when it lands

- **C1** Each scheme (grayscale/invert/posterize/duotone/palette) visibly changes
  the mosaic, in BOTH tint and layered modes (schemes sit upstream of both).
- **C2** Scheme `none` == prior look unchanged.

## Phase 6 — Deploy — checks for when it lands

- **D1 (the blank-page killer)** After deploy, `https://zntznt.github.io/iconizer/`
  loads the app — NOT a blank page. Blank + asset 404s in console == `base`
  mismatch. This is the #1 Pages failure.
- **D2** Full upload -> render -> export flow works on the live URL, not just local.
