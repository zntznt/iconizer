# Batch 02 — Render + Solid Tint (Phase 2)

Goal: upload an SVG, render the sampled grid as one output `<svg>` where each cell
is a tinted copy of the uploaded SVG. First usable build — you see the mosaic.

Depends on Batch 01's `Cell` / `Settings` contract. Read `guidance/PLAN.md` first.

## SVG ingestion — wrap whole SVG in `<symbol>`

The uploaded SVG may be anything valid: multiple paths, groups, gradients. Do NOT
assume a single `<path>`.

1. Parse the uploaded text with `DOMParser` (`image/svg+xml`).
2. Read the root `<svg>`'s `viewBox` (fall back to `width`/`height` if absent;
   `ponytail:` comment if you skip the no-dimensions edge case).
3. Build `<symbol id="icon" viewBox="...">` + the root svg's **inner** content
   (children), copied as-is. Define it once in the output `<defs>`.
4. Each cell becomes one `<use href="#icon" x y width height>` plus tinting (below).

> **SECURITY — deferred on purpose.** An uploaded SVG can carry `<script>` or
> `on*` handlers (XSS). For now inputs are the user's own, so we don't sanitize.
> Add DOMPurify (`USE_PROFILES: {svg: true}`) before any multi-user / shared-link
> feature. Leave a `ponytail:` comment at the parse site naming this ceiling.

## Tinting — a user-facing CHOICE, not a fallback

A `tintMode` setting, picked by the user per render. No automatic fallback between
them — each mode has honest, different input requirements; surface that in the UI.

- `"fill"` — set `fill` (and optionally `color`) on each `<use>` to the cell's
  rgb. **Requires the source SVG to use `fill="currentColor"`/inherit**, not
  hardcoded fills. UI hint: "best for single-color / currentColor icons."
- `"filter"` — leave the SVG's own colors, tint each `<use>` via a CSS/SVG filter
  driven by the cell color (e.g. a per-cell `feColorMatrix` or
  `filter: ...` chain). Works on ANY SVG including hardcoded/multicolor, tint is
  approximate. UI hint: "works on any SVG, approximate color."

Implementation note: filter mode likely needs one `<filter>` per distinct cell
color (or a small palette) in `<defs>` to keep the file sane — don't emit a unique
filter per cell blindly. `ponytail:` comment the chosen ceiling (e.g. "quantize to
N filters; per-cell filters if quality demands it").

## Settings added this phase

Extend `Settings` (additive — see Batch 01 contract):

    cols: number;            // (from batch 01)
    tintMode: 'fill' | 'filter';
    sizeByBrightness: boolean;   // if true, scale each <use> by cell brightness
    sizeRange: [number, number]; // min..max scale factor when sizeByBrightness, e.g. [0.3, 1]

`sizeByBrightness`: darker (or brighter — pick one, document it) cells -> smaller
icon, so the mosaic reads tonally even in a single color. When off, every `<use>`
fills its cell.

## The pure core

    render(grid: Cell[], svg: ParsedSvg, settings: Settings): string

- Pure: no DOM reads, no canvas. Takes data in, returns an `<svg>` string out.
- Output structure: one root `<svg>` with `<defs>` (the `<symbol>`, any filters)
  then N `<use>`. Set the root `viewBox`/`width`/`height` from grid dims * cell size.
- `ParsedSvg` = whatever the DOMParser step produces: `{ innerSvg: string, viewBox: string }`.
  Parsing/sanitization is plumbing and lives OUTSIDE `render()` (in main.ts or a
  small `parseSvg.ts`), so `render()` stays pure and testable.

## Wiring (main.ts)

- Second `<input type="file" accept=".svg,image/svg+xml">` for the icon.
- On any change (image, svg, or a setting): re-run `sample()` if needed, then
  `render()`, then set the output container's innerHTML to the result. Debounce
  setting changes (~50ms) so dragging a slider doesn't thrash.
- A minimal settings panel: cols slider, tintMode toggle, sizeByBrightness toggle
  + range. Raw HTML inputs are fine — no component framework.

## Self-check (required)

One runnable assert on the pure core:

- A 2-cell grid `[{col:0,row:0,r:255,g:0,b:0,...}, {col:1,row:0,r:0,g:0,b:255,...}]`
  with a trivial svg and `tintMode:'fill'` produces an output string containing
  exactly two `<use` occurrences, one with a red fill and one with blue, and one
  `<symbol id="icon"`. Assert on substring/count — don't parse the DOM in the test.

## Done when

- Upload image + SVG -> a tinted mosaic renders on screen.
- Both tint modes selectable and visibly different.
- `sizeByBrightness` visibly changes icon sizes.
- The render self-check passes.
- Committed to `main` (suggest: render core, then wiring/UI as 2 commits).

## Out of scope for this batch

PNG/SVG export (Phase 3), layered quasi-RGB (Phase 4), color schemes/palettes
(Phase 5), deploy (Phase 6).
