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

---

## APPENDED — background composite color (carry-over from Batch 1 review)

Batch 1's `sample()` flattens image transparency onto **white** before averaging
(commit b635034), with a `ponytail:` comment to "make it a setting." Promote that
to a real setting in THIS batch, because two downstream modes depend on it:

- **`tintMode:'filter'`** tints the SVG's own colors against the page — a fixed
  white assumption leaks into how filtered cells read.
- **Phase 4 CMY layered** derives ink as `c=1-r/255` etc. Cells composited toward
  white come out near `c=m=y≈0` -> all layers near-transparent -> near-invisible
  icons. The background color literally sets the floor of the CMY effect.

So this isn't cosmetic — the composite background is an input to the color model.

### Change

Add to `Settings` (additive — Batch 01 contract):

    background: string;   // CSS color the source is composited onto; default '#ffffff'

Thread it into `sample()`'s `ctx.fillStyle` (replace the hardcoded `'#fff'`), and
use the SAME color as the output `<svg>`'s background rect in `render()`, so what
the user samples against matches what they see and export. Update Batch 1's
`ponytail:` comment to point here (no longer deferred).

UI: a single color input next to the grid controls. Default white keeps current
behavior byte-for-byte.

### Self-check addition

- `sample()` of a fully-transparent image with `background:'#000000'` yields cells
  with `r=g=b≈0` (not 255). Confirms the setting actually drives the composite.

---

## APPENDED 2 — default tintMode decision (planner call, post-build)

Builder flagged it correctly: `fill` mode only tints `currentColor`/inherit SVGs,
but virtually every real icon pack (Font Awesome, Material, Lucide) ships
SOLID-color art with baked `fill="#000"`. So the brief's default (`tintMode:'fill'`)
silently no-ops on the most common input. The flood-through-alpha `filter` mode has
no such requirement — it recolors any art via shape alpha.

**Decision: default `tintMode` to `'filter'`.** It "just works" on real packs.
`fill` stays as an opt-in for `currentColor` art (genuinely sharper/lighter output
when the input supports it). Change `defaults.tintMode` in `settings.ts` to
`'filter'`.

**No auto-detect.** Rejected sniffing the SVG for `currentColor` to switch modes:
the heuristic is fragile (SVGs mix `currentColor` + hardcoded fills), it forces
`parseSvg` to inspect content, and two clearly-labeled modes already cover the
space. A one-line UI hint beats a detector — keep the modes honest and explicit.

UI: make sure the mode toggle's labels say which input each suits — e.g.
`filter (any SVG)` / `fill (currentColor icons — crisper)`. No new self-check;
this is a default value + label change.

## APPENDED (later): the filter tint path was built, then removed

The `tintMode` setting specified above shipped and then came out again. An SVG
filter per `<use>` re-rasterizes on every animation frame, which was the motion
lag, so the whole path went: the setting, its UI, `filterFor`, the quantiser and
the per-cell filter defs (5ddea23, "perf: drop SVG-filter tint mode; tint via
color="). There is one tint path now, `fill=`/`color=` per cell, and
`render.test.ts` asserts the output contains no `<filter>` anywhere.

The two icon classes this brief distinguishes both tint through it: `makeTintable`
rewrites hardcoded fills to `currentColor` at parse time, so there is no longer an
icon that silently refuses to tint, and no mode toggle or label to warn about.
Read the `"filter"` mode below as history. Reimplementing it would fail a
self-check and reintroduce a fixed performance bug.
