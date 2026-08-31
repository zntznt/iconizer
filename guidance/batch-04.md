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

---

## APPENDED — what actually shipped (planner-blessed contract change)

The brief's spec above (pure CMY fills `#00FFFF...` + `opacity` = channel strength)
**renders greyscale** and is superseded. Alpha-stacking opaque-ish CMY layers
composites toward grey/black, not toward the cell color — it cannot do subtractive
mixing. Confirmed by pixel measurement during the build (`[10,10,10]` per cell).

**Blessed mechanism (c529f7f):**

- Each cell emits 2-3 stacked `<use>` with `style="mix-blend-mode:multiply"` —
  multiply IS the subtractive operation, so overlapping inks darken toward the
  cell color like real CMY.
- Channel strength is **baked into the ink color, not opacity**. Ink for channel
  `chan` at strength `s` = white with that one channel dimmed to `255*(1-s)`.
  Three such inks multiplied against white = exactly `(r,g,b)`. opacity stays 1.
- The icon tint is set via **`color=` not `fill=`** — icons use
  `fill="currentColor"`, which reads the `color` property. (This was the bug that
  caused four wrong-layer debugging detours: `fill=` left every layer black.)
- Each cell is wrapped in `<g style="isolation:isolate">` with its **own white
  `<rect>` backing**, so multiply sees only that cell's white backdrop. Without
  isolation, multiply blends against neighbouring cells and cascades the whole
  canvas to black.

**Self-check changed accordingly:** it no longer asserts literal `#00FFFF` fills /
opacity values. It now asserts the stronger invariant — the 3 emitted ink colors,
multiplied per-channel against white, equal the cell color (±1). That tests the
actual goal, not the markup.

**Known divergence — `background` in layered mode.** The per-cell multiply backing
is hardcoded `#fff`, NOT `settings.background`. This is required: multiply against
a non-white backdrop skews every cell's hue. So in layered mode `background` only
sets the outer page backdrop, not what shows behind the icons. The batch-02 append
called `background` "the CMY floor" — that framing held for the opacity spec; under
multiply the white per-cell backing is the floor instead. Documented in
manual-tests R7. If a tinted layered background is ever wanted, it needs a
different mechanism (e.g. compositing the cell color in JS), not this path.

## APPENDED (later): per-cell isolation is gone, and the CMY gaps are filled

Three things in the brief above have since moved.

**No per-cell isolation group, and no per-cell white backing rect.** Layered mode
blends every ink against ONE page-wide rect instead, which render() forces white
for the subtractive styles (cmy/cmyk/ryb/halftone) and black for the additive ones
(rgb/anaglyph). The warning above, that without per-cell isolation the canvas
cascades to black, describes the old alpha-stacked mechanism and no longer
applies. It is also what makes a layered grid affordable: a 100-column CMY mosaic
would otherwise carry 7,500 extra groups and rects.

**`background` in layered mode.** With the per-cell backing gone, the divergence
note above needs restating. In layered mode `background` does not set the page
backdrop either, because render() overrides it for the whole canvas. What it still
does, and this is a real input to the ink math, is set the colour that transparent
source pixels are flattened onto in `sample()`.

**The CMY simplification is no longer deferred.** Both named upgrades shipped:
`layerStyle:'cmyk'` adds a K ink (gray = max(r,g,b)) for the shadows CMY cannot
reach, and `layerStyle:'halftone'` rotates all four inks to the canonical print
screen angles (15/75/0/45).
