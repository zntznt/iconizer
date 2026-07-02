# Parked work

Working code that's been set aside on a branch, with the reason and what it needs
before it can come back to `main`. Nothing here is broken — it's deferred.

## `parked/per-cell-effects` (commit f2d732c) — HARVESTED (2026-07-01)

The unblocker shipped (heavy-combo warning modal + motion perf nudge), and every
feature is now on `main`, though most arrived by re-implementation rather than
merge (the branch predates live mode, the color stage, and the layered rework):

- rotateByData / jitter -> the `rotate` modes (brightness / jitter / fixed)
- gradient-map + PRESETS -> the `gradient` scheme with its preset ramps
- cutout + layout (brick/hex) -> ported directly, with two perf guarantees the
  original lacked: cut cells are filtered BEFORE the color stage (they cost
  nothing and shrink the DOM), and layouts are placement math only (node count
  identical to the square grid; verified at 100x100 in render.test.ts).
- **spacing: intentionally NOT ported.** It multiplied icon size within the cell,
  which is exactly what `iconScale` (0.2-3) already does. Redundant knob.

Cutout + layered keeps the forced blend page (transparency would break the
multiply/screen resolve); transparent cutout is a solid-mode feature.

The branch is now historical; safe to delete.

## (template for future parked work)

**What it adds** (all built, tested, and verified working):
- **rotateByData** — static per-cell rotation by brightness (a frozen swirl)
- **jitter** — deterministic ± rotation wobble, hand-placed look (cellHash, pure)
- **cutout** — drop cells brighter than a cutoff; bg omitted -> transparent subject
- **spacing** + **layout** (grid/brick/hex) — gaps and offset/hex tiling
- **gradient-map** scheme (luma across N stops) + one-click **PRESETS**
  (sepia / neon / vaporwave)

Plus: Surprise me rolls these, permalink encodes them.

**Why it's parked: a PERF cliff, not a bug.** The features are cheap individually,
but they gave more ways to stack the already-heavy combo. Measured at the time:

- `render()` itself is fast — ~5ms even for the worst combo at 4096 cells. JS is
  NOT the bottleneck.
- The browser is. Heavy states emit a huge animated DOM:
  - cols 64, plain: ~4,000 nodes
  - cols 64, **layered + motion: ~24,500 nodes** (3 CMY layers x cell, each an
    isolated `mix-blend-mode` group, each CSS-animated)
  - cols 100, layered + motion: ~60,000 nodes
- The browser can't composite tens of thousands of animated, blend-isolated nodes
  at 60fps -> the whole app drags. `mix-blend-mode` + per-node CSS animation is
  the expensive pair; element count alone is fine.

This predates the per-cell batch (layered+motion was always the cost), but that
batch made it easier to wander into the slow zone, so we rolled back to keep the
shipped app smooth.

**What unblocks merging it back** (the fix we were mid-deciding):
1. A **perf gate** on the heavy combo. Options discussed:
   - warn + soft-cap: above ~50 cols, auto-pause motion (or show a "heavy" hint),
   - or clamp the effective grid when `layered && motion` so animated node count
     stays under a budget (~8k nodes).
2. Optionally investigate **cheaper layered motion** (one blend group per cell
   instead of per CMY layer, or pre-flatten the blend) — uncertain payoff, more
   work; the soft-cap is the smaller, safer fix.

Do (1) first, then merge `parked/per-cell-effects`. The features don't need
rework — only the gate around the expensive state.

**To resume:** `git checkout parked/per-cell-effects` (or branch off it).
