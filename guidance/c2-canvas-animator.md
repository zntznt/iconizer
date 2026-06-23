# C2 — Canvas Motion Engine (SHELVED)

**Status:** shelved on branch `shelf/c2-canvas-animator`. Architecture is correct
and every component benchmarks fast in isolation, but the integrated frame rate
is stuck at **~7–14 fps** with **no measurable cause**. `main` ships the cheaper
cap/warn approach (A) instead. This doc is the handoff so someone can resume.

---

## Why C2 exists

The mosaic "animation engine" is CSS keyframes baked into the SVG: every animated
cell is a `<g class="motion">` with `animation: mo Ns infinite` + a per-cell
`animation-delay` (the stagger). The browser's **compositor** runs it — great in
principle, but it transforms thousands of SVG nodes per frame and degrades hard:

| cols | animated cells | fps (CSS) |
|------|----------------|-----------|
| 24   | 432            | ~30 |
| 40   | 1,200          | ~24 |
| 60   | 2,700          | ~15 |
| 80   | 4,800          | ~11 |
| 100  | 7,500          | **~7 (slideshow)** |

Confirmed it is NOT `will-change` layer explosion (stripping it didn't help) and
NOT the p5 backdrop competing (pausing it didn't help). It's the raw cost of the
compositor transforming thousands of SVG nodes every frame. No one-line fix.

C2's goal: reproduce the EXACT look on a `<canvas>` sprite engine, butter-smooth
at any column count.

---

## The architecture (this is correct — keep it)

Solid mosaics only. Layered/CMY/anaglyph stay on the CSS path (their per-cell
blend stacks don't reduce to a single tinted sprite; they're the rare/heavy case,
already gated by the heavy-combo warning).

1. **Bake each uploaded icon ONCE** as a white-alpha sprite (`SPRITE=64px`,
   `currentColor`/`fill` forced to `#fff`, transparent bg). One bake per icon, not
   per cell.
2. **Per-cell tint cache**: `Map<quantizedColor, tintedSprite>` per icon. Tint =
   draw white sprite → `globalCompositeOperation='source-in'` → `fillRect(color)`.
   Color quantized to 5 bits/channel (`& 0xf8`) so the cache stays small even on
   photos (measured ~4,500 buckets at 100 cols worst case). Cache warms once.
3. **Per frame, per cell**: compute phase `p = ((t-delay)/period) % 1`, derive the
   motion transform (mirrors `export.ts` `motionRuleAt` exactly — same `ease`
   curve, same pivots, same stagger), then **one `setTransform` + one
   `drawImage(tintedSprite)`**. The cell's static rotation/scale/fade/color all
   reproduce `render.ts`'s per-cell math (pool → scale-by-brightness → icon-pick →
   rotation → fade → adjust/dither/scheme/overlay).
4. **Canvas overlays the SVG**: `position:absolute; inset:0` over `#out`. The SVG
   stays as the layout anchor + static fallback, `visibility:hidden` during
   animation, and its `<style>` block removed to stop the (now redundant) CSS
   animation.
5. **Hooks preserved**: `ResizeObserver` re-bakes on box change (maximize/zoom/
   window resize); `pauseAnimator()` wired to the existing `iconizer:export`
   busy event; `prefers-reduced-motion` → no-op (SVG static).

Fidelity notes that ARE handled: the swing pivot is top-center (translate up by
half the cell, rotate, draw down); bob is `translateY(-30% of cell height)`;
shimmer is opacity-only; spin is linear (no ease); all others use the eased
triangle wave. Transform-origin = the cell's bbox center = `transform-box:fill-box;
transform-origin:center` in CSS.

---

## Benchmarks — every PIECE is fast (measured in-browser, 100 cols / 7,500 cells)

| what | time |
|------|------|
| 7,500 plain `drawImage` (no transform) | **2.6 ms/frame** |
| 7,500 `save/translate/rotate/restore + drawImage` | 3.9 ms/frame |
| 7,500 `setTransform + drawImage` | **3.0 ms/frame** |
| + per-cell tint cache (4,504 buckets) | **7.2 ms/frame** |
| in-app, measured `drawImage` self-time | **~1.3 ms/frame** (20 ms over 1 s ÷ ~14 fps) |

**Every isolated test says this should run at 100+ fps.**

---

## The unresolved problem

Integrated, it runs at **~7–14 fps**. `frame()` executes only ~7×/sec, each doing
~10 ms of *measurable* work — meaning **~990 ms/sec is unaccounted for**: the
browser simply isn't calling `requestAnimationFrame` more than ~7–14×/sec, and
nothing measurable explains why.

### Ruled out (each tested live, frame time did NOT improve):
- **The blits** — `drawImage` totals ~20 ms/sec (1.3 ms/frame). Not it.
- **The tint cache** — 0 canvases created/sec during animation → cache hits every
  frame, not thrashing/rebuilding. Not it.
- **The p5 backdrop** — `document.getElementById('sj-bg').remove()` → no change
  (still ~150 ms). Not it. (Backdrop was also nearly idle: ~320 strokes/sec.)
- **The hidden SVG** — detached it from the DOM entirely → 150 → ~133 ms (marginal).
  Not the main cost.
- **Canvas size / GPU upload** — halved the backing resolution → no change. Also
  the canvas was only ~952×714 (CRT box), not full-viewport. Not it.
- **Stacked rAF loops** — counted full-canvas bg fills: only ~7/sec → exactly one
  `frame()` per rAF tick, not multiple overlapping loops. Not it.

### Performance trace (1x CPU, ~2 s of animation):
- **No JS bottleneck.** No top-level function flagged.
- `ForcedReflow` insight present but **0.9 ms total**, "no top-level functions",
  estimated savings none. (Same harmless p5-internals reflow seen elsewhere.)
- So the cost is **not** in our JS, not forced layout, not the blits.

### The contradiction
`frame()` runs 7×/sec × ~10 ms work = ~70 ms accounted, but a second is 1000 ms.
The other ~930 ms is the browser *not scheduling rAF*. With a clean main-thread
trace and cheap GPU, the only things left that fit:
1. **The automation/preview Chrome is throttling rAF** in a way a real user's
   browser would not (STRONGEST suspicion — never confirmed because all testing
   was via the chrome-devtools MCP automation harness).
2. A compositor/raster stall not surfaced by the JS-level trace (e.g. the overlay
   canvas + the p5 canvas + the hidden 7,500-node SVG all forcing layer work) —
   but removing each of those individually didn't move the number, which argues
   against this.

---

## What to try next (in priority order)

1. **Reproduce in a REAL, non-automated Chrome.** All measurements here ran inside
   the chrome-devtools MCP automation browser, which may itself throttle rAF.
   Open the preview in a normal Chrome window, hard-load 100 cols + spin, and read
   the FPS meter (DevTools → Rendering → "Frame Rendering Stats"). If it's smooth
   there, **the engine is done** — the ~7 fps was a harness artifact and we just
   need to confirm + ship. This is the single highest-value next step.
2. **Instrument true per-frame wall-clock.** Add `performance.mark('frameStart')`
   at the top of `frame()` and `performance.measure` at the end, log the rolling
   average. Also log `now - lastNow` (the rAF delta). This tells you whether the
   time is INSIDE frame() or in the gap BETWEEN rAF calls (the latter = browser
   throttling, points to #1).
3. **If genuinely the canvas:** try `OffscreenCanvas` + a Worker, or a WebGL/
   `regl` instanced-sprite renderer (one draw call for all 7,500 cells — the GPU
   ideal). Heavier, but the instancing path is the textbook answer for N sprites.
4. **Check the overlay compositing**: the animation canvas sits over the CRT bezel
   + the p5 backdrop (z-index -3) + the hidden SVG. Try giving the canvas its own
   stacking context / `will-change:transform`, or temporarily render it OUTSIDE
   `#out` (full-screen, behind nothing) to isolate whether overlap compositing is
   the stall.

---

## Files on this branch
- `src/animator.ts` — the engine (bake → tint-cache → per-frame sprite blit).
- `src/main.ts` — `redraw()` calls `startAnimator(out, svg, cells, parsed, bg, settings)`
  when `motion !== 'none' && !layered`; `setExportBusy` also calls `pauseAnimator`.

## How main shipped instead (option A)
Cap/warn at high column counts — see the commit that follows the shelf on `main`.
C2 remains the "real" fix if/when the rAF mystery resolves (likely #1 above).
