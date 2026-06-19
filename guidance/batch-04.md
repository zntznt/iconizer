# Batch 04 — Layered Quasi-RGB (Phase 4)

Goal: a `layered` toggle. Instead of one tinted `<use>` per cell, stack 2-3
copies of the same `<symbol>` per cell with a **CMY-ish subtractive** color split,
approximating the cell color the way halftone printing does. This is the app's
signature look.

Depends on Batch 02's `render()` + `<symbol>`/`<use>` structure. Read PLAN.md first.

## The color split — CMY-ish subtractive

Per cell, from its average `r,g,b` (0-255), derive three ink amounts (0-1):

    c = 1 - r/255
    m = 1 - g/255
    y = 1 - b/255

Emit (by default) 3 stacked `<use>` of the same `#icon`, biggest first:

    big   <use> fill=#00FFFF (cyan)     opacity = c
    mid   <use> fill=#FF00FF (magenta)  opacity = m
    small <use> fill=#FFFF00 (yellow)   opacity = y

> **Why opacity, not just fill.** SVG layers composite with normal alpha, NOT
> subtractive ink. Cyan-over-magenta at full opacity does not "subtract" to the
> cell color — it just shows the top layer. Driving each layer's **opacity by its
> channel strength** is what makes the stack read as the blended color. A cell low
> in all inks (near white) -> all three layers near-transparent -> light cell. A
> dark cell -> all three strong -> dense overlap. This is the mechanism; get it
> right or the output goes muddy.

> **KNOWN SIMPLIFICATION (ponytail).** This is naive CMY, no black (K) channel and
> no per-channel screen angles. Real CMYK extracts K so darks stay neutral instead
> of muddy-brown, and rotates each ink's screen to avoid moire. We're stacking
> SVGs, not printing, so naive CMY is the right call. Mark the color-split site
> with a `ponytail:` comment naming the K-channel + screen-angle upgrade path.
> Add it only if darks look bad in practice.

Layer count is a setting (2 or 3; 3 = full CMY, 2 = e.g. drop yellow for a
duotone-ish feel). Sizes step down evenly (e.g. 1.0, 0.66, 0.33 * cell), or expose
a per-layer scale later — start with even steps.

## Stack geometry — concentric default + offset setting

- Default: all layers concentric (shared cell center), just shrinking. Clean.
- `offset` setting (px, default 0): nudge each layer in a different direction so
  the stack gets a chromatic-aberration / 3D-glasses shimmer. e.g. cyan up-left,
  magenta down-right, yellow down-left, magnitude = `offset`. At 0 it's pure
  concentric. One slider, big visual payoff.

## Settings added this phase (additive — Batch 01 contract)

    layered: boolean;            // false -> Batch 02 solid-tint path unchanged
    layerCount: 2 | 3;           // inks to stack (CMY, or CM)
    layerOffset: number;         // px aberration; 0 = concentric

When `layered` is false, render() must behave exactly as Batch 02 (don't regress
solid-tint mode). Layered is an alternate per-cell emit, selected by the flag.

## Render changes

- Factor the per-cell emit into a function: `emitCell(cell, settings) -> string`
  (the `<use>`s for one cell). Solid-tint path and layered path are two branches
  of it. Keeps `render()` readable and the self-check targetable.
- Still pure. Still `<symbol>` defined once; layered just emits more `<use>`.
- Watch output size: 3 `<use>` per cell at a 100x100 grid = 30k `<use>`. Still
  fine (they're tiny references), but if export feels heavy, that's the cause —
  note it, don't pre-optimize.

## Self-check (required)

Assert on `emitCell` (pure, string out):

- A mid-tone cell `rgb(180,90,40)` with `layered:true, layerCount:3, layerOffset:0`
  emits exactly 3 `<use`, with cyan/magenta/yellow fills, and opacities matching
  `c=1-180/255≈0.29`, `m=1-90/255≈0.65`, `y=1-40/255≈0.84` (within tolerance).
- Same cell with `layered:false` emits exactly 1 `<use>` (solid path unchanged).

## Done when

- Layered toggle visibly switches between solid-tint and CMY-stack looks.
- layerCount 2 vs 3 differs; offset slider produces the aberration shimmer.
- Solid-tint mode is byte-for-byte unchanged when `layered:false`.
- emitCell self-check passes.
- Committed to `main`.

## Out of scope

Color schemes/palettes (Phase 5), deploy (Phase 6), true CMYK/K-channel (deferred,
see simplification note).
