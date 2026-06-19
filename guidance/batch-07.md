# Batch 07 — Motion (make the mosaic alive)

Goal: optional animation on the rendered mosaic — wiggle, swing, spin, pulse, bob,
shimmer — so the image looks alive. Delivered as CSS `@keyframes` baked into the
output SVG, staggered per cell so it ripples instead of vibrating as a rigid sheet.

Depends on Batch 02 (render) and Batch 04 (layered). Read PLAN.md + batch-04 append.

## Mechanism — CSS keyframes in the SVG (no JS loop)

`render()` already returns an `<svg>` string. Motion is ONE extra `<style>` block
prepended into the output, plus a `class` + inline `animation-delay` on each
animated `<use>`. No requestAnimationFrame, no per-frame JS, no redraw — the
browser composites it on the GPU. Thousands of `<use>` animate at 60fps for free.

**Bonus that falls out for free: motion survives export.** The `<style>` is inside
the SVG, so the downloaded `.svg` is still animated when opened in a browser. Don't
break this — keep motion in the SVG string, not in app-side JS.

> **CRITICAL — the in-place pivot.** SVG transforms default to pivoting around the
> user-space origin (0,0), NOT the element. A naive `rotate`/`scale` will fling
> every icon across the canvas. Each animated `<use>` MUST get:
>
>     transform-box: fill-box;        /* pivot around the element's own box */
>     transform-origin: center;       /* or top center for swing */
>
> Put these in the `.motion` base class. Without them the whole feature looks
> broken. This is THE gotcha — verify spin/wiggle pivot in place first thing.

## Motions to ship (each ~5 lines of @keyframes)

| key       | feel                    | keyframe core            | transform-origin |
|-----------|-------------------------|--------------------------|------------------|
| `none`    | static (default)        | —                        | —                |
| `wiggle`  | jitter rotate ±few deg  | `rotate(-Adeg)`<->`rotate(Adeg)` | center   |
| `swing`   | pendulum sway           | `rotate` ±A              | top center       |
| `spin`    | full rotation in place  | `rotate(0)`->`rotate(360deg)` | center      |
| `pulse`   | scale breathing         | `scale(1)`<->`scale(1.2)`| center           |
| `bob`     | vertical float          | `translateY(0)`<->`translateY(-h)` | center |
| `shimmer` | opacity flicker         | `opacity 1`<->`0.4`      | n/a              |

Only emit the `<style>` for the SELECTED motion (and `none` emits nothing —
byte-for-byte unchanged from no-motion). Don't dump all keyframes every render.

## Stagger — the alive-vs-rigid knob (a setting)

If every icon shares one phase, it reads as a vibrating sheet. Offset each `<use>`'s
`animation-delay` by a per-cell value. `staggerMode` setting:

- `none`   — delay 0; all in phase (fine for shimmer/spin, rigid for wiggle).
- `ripple` — `delay = (col + row) * k` — a diagonal wave rolls across the mosaic.
- `brightness` — `delay = cell.brightness * k` — motion tracks image content;
  light/dark regions move out of phase.
- `random` — `delay = pseudoRandom(index) * period` — chaotic shimmer, no wave.
  No `Math.random` in render (must stay pure/deterministic): derive from the cell
  index, e.g. a cheap hash `((i * 2654435761) % 1000) / 1000`.

`k` scales with the animation period so the wave reads regardless of speed.
Computed in the existing per-cell loop; it's one inline `style="animation-delay:Xs"`.

## Settings added (additive — Batch 01 contract)

    motion: 'none' | 'wiggle' | 'swing' | 'spin' | 'pulse' | 'bob' | 'shimmer';
    motionSpeed: number;       // animation period in seconds (e.g. 0.5..4)
    staggerMode: 'none' | 'ripple' | 'brightness' | 'random';

Default `motion:'none'` -> output identical to pre-batch-07. This is the
no-regression guard.

## Layered CMY interaction — animate together (for now)

Ship unified motion: the WHOLE cell moves as one. In layered mode the per-cell
group is `<g style="isolation:isolate">...</g>` (batch-04) — put the `class` +
`animation-delay` on THAT `<g>`, so the CMY stack moves as a unit and colors stay
aligned. In solid mode, the class goes on the single `<use>`.

> **Per-layer CMY motion is a STRETCH, explicitly deferred.** Animating each CMY
> layer with a slight phase offset (living chromatic aberration) is on-theme but
> trickier — interacts with the isolation group and multiply blend. Ship `together`
> first; only attempt `apart` if the basics feel good. `ponytail:` comment the
> seam (the `<g>` is where per-layer animation would later hang off children).

## Accessibility (don't skip — it's one block)

Wrap the keyframes so motion respects the OS "reduce motion" setting:

    @media (prefers-reduced-motion: reduce) { .motion { animation: none !important; } }

Always emit this guard when any motion is active. Users with vestibular disorders
get a static image; everyone else gets the fun. Non-negotiable, and it's 3 lines.

## Self-check (required)

Pure string assertions on `render()` output:

- `motion:'spin'` output contains `@keyframes` and `transform-box:fill-box`
  (the pivot guard) and a `prefers-reduced-motion` block.
- Each animated cell carries the motion class.
- `staggerMode:'ripple'` -> distinct `animation-delay` values across cells
  (cell (0,0) differs from (5,5)); `staggerMode:'none'` -> no delay / all equal.
- `motion:'none'` -> output contains NO `<style>`/`@keyframes` (regression guard,
  byte-for-byte the pre-batch output).
- `random` stagger is deterministic: same grid -> same delays across two renders
  (no Math.random leaked into the pure core).

## Manual tests (add to guidance/manual-tests.md as Phase 7 / M-block)

- **M1** Each motion visibly animates in the live preview, pivoting IN PLACE (not
  flying off) — the transform-box check.
- **M2** Stagger ripple shows a wave rolling across the mosaic, not a uniform buzz.
- **M3** Export an animated SVG, open the downloaded file in a fresh browser tab —
  it's still animated. (The free export-survives property.)
- **M4** Layered + motion: the CMY stack moves as one unit, colors stay registered.
- **M5** OS reduce-motion on -> mosaic is static. (System Settings > Accessibility.)
- **M6** Perf: at a fine grid (50+ cols, thousands of `<use>`) animation stays
  smooth (~60fps). If it janks, note it — `will-change: transform` on the class is
  the first lever; capping animated cell count is the fallback. ponytail the ceiling.

## Done when

- Each motion animates in place; stagger modes visibly differ.
- Animated SVG export stays alive when reopened.
- Layered motion moves the stack as a unit.
- reduce-motion makes it static.
- `motion:'none'` regresses nothing.
- Self-checks pass. Committed to `main`.

## Out of scope

Per-layer CMY phase offset (stretch, deferred above), mouse/pointer-reactive motion
(JS-only, dies on export — different feature), physics simulation, deploy (Phase 6).
