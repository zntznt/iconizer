# Batch 05 — Color Schemes / Palettes (Phase 5)

Goal: remap each cell's average color through a chosen scheme (grayscale,
posterize, duotone, palette snap, invert...) before it drives any fill. Works for
BOTH solid-tint and layered CMY modes for free, because it sits upstream of them.

Depends on Batch 02 (solid tint) and ideally Batch 04 (layered). Read PLAN.md.

## The one design rule

Add a single pure function and call it in exactly ONE place:

    transformColor(rgb: RGB, scheme: Scheme): RGB     // RGB = {r,g,b} 0-255

Call it in `render()` (or `emitCell`) on the cell's average color, BEFORE the
solid-tint fill OR the CMY split runs. Both modes then consume the transformed
color with zero extra work. Do not duplicate scheme logic into either branch —
that's the whole point of putting it upstream.

Keep it pure: rgb in, rgb out, no DOM. It stays trivially testable.

## Schemes to ship (start small)

`Scheme` is a discriminated type; start with these and stop:

    type Scheme =
      | { kind: 'none' }
      | { kind: 'grayscale' }
      | { kind: 'invert' }
      | { kind: 'posterize'; levels: number }        // e.g. 2-8 steps per channel
      | { kind: 'duotone'; dark: RGB; light: RGB }   // map luma onto a 2-color ramp
      | { kind: 'palette'; colors: RGB[] }           // snap to nearest palette color

Notes per scheme:
- `grayscale`: use perceptual luma (reuse the same 0.2126/0.7152/0.0722 weights as
  `sample()`'s brightness — keep them in one shared const, don't re-magic-number).
- `posterize`: round each channel to `levels` bands. `Math.round(v/255*(levels-1))/(levels-1)*255`.
- `duotone`: compute luma 0-1, lerp between `dark` and `light`. Classic Spotify look.
- `palette`: nearest color by squared Euclidean distance in RGB. `ponytail:` comment
  the ceiling — RGB distance is perceptually off; Lab/OKLab if it ever matters,
  not now.

Skip gradients, custom curves, LUT upload — YAGNI until asked.

## Settings added this phase (additive — Batch 01 contract)

    scheme: Scheme;        // default { kind: 'none' }

`none` must pass the color through unchanged so existing modes are unaffected.

## UI (main.ts)

- A scheme `<select>` (none / grayscale / invert / posterize / duotone / palette).
- Reveal the scheme's params only when relevant: posterize -> levels slider;
  duotone -> two color pickers; palette -> a small list of color inputs (start
  with 2-5 swatches, an add/remove is fine but optional).
- Re-render on change, debounced like every other setting.

## Self-check (required)

`transformColor` is pure — assert directly, no DOM:

- `grayscale` on `rgb(255,0,0)` -> r==g==b and == round(0.2126*255) (~54).
- `invert` on `rgb(0,0,0)` -> `rgb(255,255,255)`.
- `posterize` levels:2 on `rgb(100,200,50)` -> each channel is 0 or 255.
- `palette` of `[red, blue]` on `rgb(200,0,40)` -> snaps to red (nearer).
- `none` returns the input unchanged (identity).

## Done when

- Each scheme visibly changes the mosaic, in both solid-tint and layered modes.
- `none` leaves prior behavior byte-for-byte unchanged.
- transformColor self-checks pass.
- Committed to `main`.

## Out of scope

Deploy (Phase 6). Perceptual color spaces, gradient maps, LUT upload (deferred —
see palette note).
