# iconizer — Plan

## What it is

Upload a source image and an SVG. The app renders the image as a **mosaic**: a
grid is laid over the image, and each cell is replaced by a copy of the SVG,
tinted and scaled to match that cell. Settings tune how the SVG array behaves.

This is photomosaic rendering, not literal rasterization: sample the source on a
grid, map each sample to SVG transforms/fills.

## Decisions (locked)

| Choice  | Decision |
|---------|----------|
| Stack   | Vite + vanilla TS; gif.js is the one runtime dep (GIF export) |
| Hosting | GitHub Pages (static, client-side only) |
| Export  | Live SVG + download, **plus** PNG export (SVG rasterized via canvas) |
| Color   | Solid tint first, then layered quasi-RGB as a toggle |
| Repo    | Commit straight to `main`, no branches (pre-launch) |

## Differentiators (what's ours — protect these)

What sets iconizer apart from the mature adjacent tools (photomosaic / halftone-SVG
/ ASCII generators / channel-split glitch filters). Full analysis + sources:
`guidance/competitive-landscape.md`. Lead with these when scoping features:

1. **Channel-split layering as a *mosaic primitive* (the "quasi-RGB" CMY/RGB
   stack).** The most defensibly unique part — channel split exists everywhere as a
   whole-image filter, nowhere as the per-cell render unit. Don't dilute it.
2. **Tile = a user-uploaded *arbitrary* SVG**, recolored + brightness-ramped per
   cell (multi-icon dark→light). Not photo tiles, not fixed dots, not text glyphs.
3. **Motion baked into the export** — animated SVG stays alive on download; GIF
   bakes per-cell phase. Free, no watermark, 100% client-side.

Closest cousin = ASCII-art generators (glyph-per-cell, colored) — but text-only,
no layering, no motion. Our wedge is vector-icon tile + channel-split + animation.

## The core

One pure function, everything else is plumbing:

    render(grid: Cell[], icons: ParsedSvg[], settings: Settings,
           mode: RenderMode = 'export') -> string  // an <svg>

- `sample(image, settings) -> Cell[]` — canvas + getImageData, average each cell.
- `Cell = { col, row, r, g, b, brightness }`.
- Export output defines one `<symbol id="iconN">` per uploaded icon + one or more
  `<use>` per cell. The live on-screen render inlines the same shapes per cell
  instead (same pixels, much faster paint).

## File layout

    index.html            upload inputs, <svg> output host, settings panel
    src/main.ts           wire DOM <-> render(), debounce settings changes
    src/sample.ts         image -> Cell[] grid (the canvas part)
    src/render.ts         grid + svg + settings -> output SVG string (pure core)
    src/export.ts         SVG download; SVG -> PNG via canvas
    src/settings.ts       Settings type + defaults
    .github/workflows/deploy.yml   build + publish to Pages
    LICENSE (MIT), README, vite.config.ts (base: '/iconizer/')

## Phases

- **Phase 0 — scaffold.** Vite vanilla-ts, MIT LICENSE, `base: '/iconizer/'`.
- **Phase 1 — sampling.** image -> Cell[]. Self-check: solid-red image -> red cell.
- **Phase 2 — render, solid tint.** SVG -> `<symbol>`; one `<use fill=...>` per
  cell. Settings: grid density, size-by-brightness. First usable build.
- **Phase 3 — export.** SVG download (Blob + `<a download>`); PNG via canvas `toBlob`.
- **Phase 4 — layered quasi-RGB.** Toggle: 2-3 stacked `<use>` per cell at
  decreasing scale with channel-split fills. Settings: layer count, per-layer scale.
- **Phase 5 — color schemes/filters.** Map cell color through a palette or CSS
  filter (grayscale, posterize, duotone) before it hits `fill`.
- **Phase 6 — deploy.** Pages Action on push to `main`.
- **Phase 7 — motion (fun twist).** Optional CSS-keyframe animation baked into the
  output SVG (wiggle/swing/spin/pulse/bob/shimmer), staggered per cell so it
  ripples. Zero JS loop; motion survives export. See `guidance/batch-07.md`.

Batch 1 = Phase 0 + Phase 1. See `guidance/batch-01.md`.

Phases 0-5 and 7 (motion) shipped. **7b (per-layer 'apart' CMY motion) was built
then REMOVED** — animating individual CMY layers tore the multiply blend (black-out
+ jank). Layered motion now animates the whole cell as one unit via an outer
non-blended `<g>` wrapper (blend resolves once, statically; transform moves the
buffer). See the batch-07 append. Deploy (6) is live on GitHub Pages. New
fun-first twists welcome anytime.

**Harvested:** rotation / jitter / cutout / layouts / gradient-map+presets were
parked over a perf cliff (heavy combos -> 24k+ animated DOM nodes), then brought
back once the gate shipped (the heavy-combo warning modal + the motion perf
nudge). They are all on `main` now; spacing was dropped as redundant with
`iconScale`. See `guidance/parked.md` for what changed on the way in. The
`parked/per-cell-effects` branch is historical.

## Deliberately skipped (add when needed)

- **Backend / storage** — none. Add only for shareable links.
- **SVG sanitization** — deferred; fine for your own uploads. Add DOMPurify before
  letting strangers upload SVGs (XSS via `<script>`/`onload` in SVG). Mark the
  spot with a `ponytail:` comment when SVG parsing lands in Phase 2.
- **State management / component framework** — one settings object + re-render.
- **Web Worker** — skip until a large grid actually janks the UI. Sampling is the
  only heavy bit; revisit if it stutters past ~150x150.
