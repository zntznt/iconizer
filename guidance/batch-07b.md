# Batch 07b — STRETCH: Per-layer CMY motion (living chromatic aberration)

Optional follow-on to batch-07. Only attempt after unified motion (07) ships and
feels good. This makes the three CMY layers in a cell animate on slightly offset
phases, so cyan/magenta/yellow separate and rejoin — a breathing chromatic
aberration that's exactly on-theme for the "quasi-RGB" concept.

Depends on batch-04 (layered CMY) + batch-07 (motion). Read both, especially the
batch-04 append (multiply mechanism).

## The core idea

In `together` mode (07), the animation class sits on the per-cell
`<g style="isolation:isolate">`. For `apart` mode, move the animation DOWN onto
each child `<use>` instead, with a per-layer phase offset:

    layer 0 (cyan)    animation-delay: base + 0
    layer 1 (magenta) animation-delay: base + d
    layer 2 (yellow)  animation-delay: base + 2d

`d` is a small fraction of the period. The `<g>` stays still; its children drift.

## The constraint that defines this feature (read before coding)

> **Motion and color are coupled — you cannot tune one without the other.** The
> CMY layers only multiply to the true cell color WHERE THEY OVERLAP (batch-04).
> Phase-offsetting them shrinks the overlap, so:
> - the central overlap (true color) gets smaller,
> - the fringes bloom into single-ink cyan / magenta / yellow.
>
> That IS the aberration look — but it means **large amplitude visibly
> desaturates the image into RGB fringes.** Keep per-layer displacement SMALL
> (sub-pixel to ~1px at the cell's scale). This is a garnish on top of a correct
> image, not a free transform. The amplitude knob has a low ceiling by nature;
> document it, don't let users crank it into mush expecting it to stay colorful.

So: `apart` is `swing`/`bob`/`wiggle` with a tiny amplitude and a per-layer phase.
`spin`/`pulse` at full strength will tear the color apart — either disable `apart`
for those, or auto-clamp amplitude. Recommend: `apart` only enables for the
small-displacement motions (wiggle/swing/bob); fall back to `together` for the rest.

## Settings (additive)

    layerMotion: 'together' | 'apart';   // default 'together' (07's behavior)
    // reuse motion / motionSpeed / staggerMode from batch-07; no new period knob.

`layerMotion` only has effect when `layered:true` AND `motion !== 'none'`. In every
other combination it's inert -> output identical to batch-07.

## Implementation seam

batch-07 already marks the `<g>` as where this hangs off. For `apart`:
- DON'T put the class on the `<g>`. Put it on each `<use>`, computing
  `animation-delay = cellDelay + layerIndex * d`.
- **WATCH:** the layered `<use>`s already carry `style="mix-blend-mode:multiply"`
  (render.ts ~line 87). Don't emit a SECOND `style=` — merge the
  `animation-delay` into the existing one (`style="mix-blend-mode:multiply;
  animation-delay:Xs"`). Two `style` attrs = the second is ignored, motion
  silently dead. This is the easy footgun here.
- The `transform-origin`/`transform-box` for the pivot must also live in that same
  merged style (or a shared class) — same merge rule.
- Keep `transform-box: fill-box; transform-origin: center` per `<use>` (each layer
  pivots in its own box — they're different sizes, so shared origin would skew).
- The isolation group and multiply blend are UNCHANGED — this only moves where the
  animation attributes attach. No change to color math.
- ponytail: clamp per-layer amplitude; the coupling above is the ceiling.

## Self-check

- `layered:true, motion:'wiggle', layerMotion:'apart'` -> the 3 `<use>` in a cell
  have 3 DISTINCT `animation-delay` values (phase-offset present).
- `layerMotion:'together'` -> the `<g>` carries the class, children do NOT (07's
  exact structure, unchanged).
- `apart` with a tearing motion (spin/pulse) -> falls back to together OR amplitude
  is clamped (whichever you chose); assert the chosen guard fired.
- `layered:false` OR `motion:'none'` -> `layerMotion` has zero effect on output.

## Manual tests (Phase 7b)

- **MB1** apart + wiggle: cyan/magenta/yellow visibly separate and rejoin — a
  shimmering color fringe. Recognizable image, garnished, NOT desaturated to mush.
- **MB2** Crank amplitude/speed: confirm the documented failure mode (fringes bloom,
  color washes out) so the ceiling is real and known — then confirm the clamp/
  fallback keeps the default usable.
- **MB3** apart + spin/pulse: the guard fires (fallback or clamp), image stays
  colorful.
- **MB4** Export an apart-animated SVG, reopen: the per-layer shimmer survives.

## Done when

- apart mode shows per-layer chromatic shimmer at default amplitude.
- The tear-into-fringes failure mode is gated (clamp or fallback) for big motions.
- together mode and all non-layered/non-motion combos are byte-for-byte 07.
- Self-checks pass. Committed to `main`.

## Why this is a stretch, not core

It's a garnish with a low quality ceiling (the color coupling), and it only applies
to one mode-combination (layered + small motion). High delight-per-pixel when it
lands, zero loss if it never does. Pure fun-first territory — do it because it's
cool, skip it the moment it fights back.
