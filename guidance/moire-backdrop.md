# Moiré Ripples backdrop — how it works & how to tune it

The animated background behind the whole app. One file: **`public/spacejam.js`**
(p5.js instance mode, loaded as a plain non-module script after the p5 CDN tag in
`index.html`). It self-mounts a fixed full-viewport `<canvas#sj-bg>` at `z-index:-3`,
`pointer-events:none`, behind every other element.

> The filename is `spacejam.js` for history (it began as a Space Jam '96 starfield).
> The current design is **moiré ripples**, not a starfield. Don't rename the file —
> `index.html` and the build reference `public/spacejam.js`.

## What it is

Two sets of **concentric rings** centered at two different points, drawn over each
other with **additive blending**. Like two stones dropped in a pond: where the ring
sets overlap, the rings interfere into big sweeping **curved moiré fringe arcs**.
The two centers slowly orbit, so the fringes crawl. That's the whole idea — it reads
unmistakably as *interference*, never as a grid.

It also does two product-specific things:

1. **Colour follows the user's render.** A `MutationObserver` on `#out` (the rendered
   mosaic SVG) samples the mosaic's dominant hue; ring-set A paints in that hue's
   **complement**, ring-set B in the hue itself. So the background is always colour-
   harmonious with whatever the user just made. Grayscale renders → default cyan/magenta.
2. **It reacts to hover/touch** by deforming the *actual rings* (not a separate overlay).

## Why it's built this way (read before changing the geometry)

This was the **fourth** attempt; the first three were rejected for reasons worth not
repeating:

- **v1 — planets + gutter sprites + starfield.** Rejected: the planets distracted and
  were disliked as objects; everything was pushed into two symmetric L/R gutters with a
  dead, masked-empty center; the hover effects were *separate overlays* (a ripple ring,
  constellation lines) painted on top of an otherwise static background.
- **v2 — straight sinusoidal "weave".** Two families of wavy horizontal/vertical lines.
  Rejected: read as "a weird wavy grid", not moiré, and was tuned so dim the colour and
  the interference were both invisible.
- **v3 — straight near-perpendicular gratings.** Rejected: perpendicular gratings give
  *graph paper*, not moiré. Moiré fringes are dramatic only when the two gratings are
  **near-aligned** (same orientation, small angle/pitch difference). Perpendicular = grid.
- **v4 — overlapping concentric rings (current).** Two ring sets at offset centers is the
  most unambiguous moiré: the "two ripple ponds" look. This is what shipped.

**Hard constraints any redesign must keep** (these are *why*, not just *what*):

- **Canvas is `pointer-events:none`** so it never eats a click meant for the UI. All
  interaction therefore comes from **window-level** `pointermove`/`pointerdown`/`touchstart`
  listeners reading `clientX/clientY`; there is no canvas hit-testing. Keep this.
- **Non-distracting ≠ invisible.** It must be clearly *visible* as a pattern but never
  *compete* with the foreground. The levers that achieve that: low overall luminance, a
  **center-dim** that quiets the pattern behind the content column, and brightness that
  **rises only under the cursor**. (v2's mistake was conflating "non-distracting" with
  "nearly black" — don't.)
- **Cheap.** No per-pixel full-canvas loops, no blur/shadow filters. Everything is a
  bounded set of ring polylines at a capped 30fps. Heat is computed **per ring** (a cheap
  pre-pass), not per vertex, so the stroke colour is known before the ring is drawn.
- **Two hues only.** The whole palette is `palP` (primary) + `palC` (complement). Adding
  more colours brings back the "soup" that got v1 rejected.
- **Pause/*freeze* contracts:** `prefers-reduced-motion` freezes to a still frame;
  `document.hidden` and the `iconizer:export` busy event pause the loop (so a raster
  export isn't starved). These are wired through one `sync()` gate in `setup()` — reuse it.

## How the pieces map to the code

All in `public/spacejam.js`:

- **`rgbToHsl` / `hslToRgb` / `dominantHue(svgText)`** — the palette sampler. `dominantHue`
  regexes every `fill="rgb(r,g,b)"` out of the `#out` SVG, bins hues into a 12-bucket
  saturation-weighted histogram, returns the dominant bucket center — or `null` if the
  render is mostly gray (`<12%` colored pixels, or each pixel's saturation `<0.18`). Pure
  functions; covered by **`test/spacejam.selftest.mjs`** (run via `npm test`).
- **`wirePalette()`** — `MutationObserver` on `#out` (`childList`+`subtree`). On any render
  change it re-samples and sets `tgtP`/`tgtC`; `easePalette()` glides `palP`/`palC` toward
  them (~0.5s) every frame so recolours aren't abrupt. Runs on render change only, never per frame.
- **`buildFamilies()`** — derives `ringPitch` (from `TUNE.density` ÷ area-scale) and
  `ringCount` (enough rings to span the diagonal). `famA`/`famB` are just ring-index lists.
  Called on setup, resize, and when `TUNE.density` changes.
- **`drawRipple(rings, cx, cy, base, accentToward, lensOn, px, py)`** — draws one ring set:
  for each ring, a cheap **heat pre-pass** (how lit by cursor lens + traveling pulses), then
  set stroke colour (base hue, lerped toward `accentToward` by heat; alpha `90 + 120*heat`,
  times `centerDim`), then the ring polyline with a radial **lens** nudge near the cursor.
- **`p.draw()`** — sets `globalCompositeOperation='lighter'` (additive — this is what makes
  the overlap bloom into fringes), computes the two orbiting centers from `orbit`/`sep`, and
  calls `drawRipple` twice (A=complement, B=primary). Restores the composite op after.
- **`centerDim(x,y)`** — smoothstep ellipse over the content column; returns `0.22` at the
  very center → `1.0` at the edges. This is the "quiet behind the UI" lever.
- **`updateTilt()`** — turns drag velocity into an eased `tilt` that nudges the center
  separation (interaction #3).

## The four interactions (all deform the real rings)

| # | Name | Trigger | What it does | Where |
|---|------|---------|--------------|-------|
| 1 | Lens warp | `pointermove` | rings near the cursor nudge radially (soft refraction) | `drawRipple` lens block |
| 2 | Frequency pulse | `pointerdown`/tap | a traveling ring brightens the rings it sweeps | `pulses[]` + heat pre-pass |
| 3 | Flow tilt | fast drag | nudges center separation, reshaping the fringe | `updateTilt` → `tilt` → `sep` |
| 4 | Heat bloom | hover presence | rings under cursor brighten + shift toward partner hue | heat → stroke colour/alpha |

`R` = lens/heat radius (150px). `LENS` = push strength (0.07 — deliberately gentle; an
earlier 0.22 made an ugly "bulge", which the user rejected). `PULSE_SPD`/`PULSE_MAX`
govern the click ripple.

## Tuning

### The fast way — live sliders
Open the app with **`?tune`** in the URL (e.g. `http://localhost:5181/iconizer/?tune`).
A dev-only panel (top-right) exposes the three main knobs and logs the current values to
the console as you drag. The panel **only mounts when `?tune` is present** — it never
ships to production. When you've found values you like, copy them into the `TUNE` defaults.

### The knobs

`TUNE` object (top of the sketch) — the three the user tunes:

- **`density`** (default `24`, px) — base ring spacing before area-scaling. **Lower = denser,
  finer rings** → tighter, busier interference. Higher = bigger, sparser arcs. Changing it
  re-runs `buildFamilies()`.
- **`motion`** (default `1.0`) — multiplier on the orbit + breathing speed. `0` = frozen
  centers (still pattern). Higher = fringes crawl faster.
- **`sep`** (default `0.26`, fraction of viewport width) — base separation of the two ring
  centers. **Lower = centers closer** → tighter, more concentric fringe. Higher = wider apart
  → broad sweeping arcs. (There's also a `±0.06` breathing wobble on top, in `p.draw`.)

Other dials, by where they live:

- **Brightness / contrast:** the stroke alpha `(90 + 120*heat) * dim` in `drawRipple`. Raise
  the `90` for a bolder resting pattern; raise the `120` for a stronger cursor bloom. Keep it
  visible-but-calm — the user confirmed the current level is right.
- **Calmness behind the UI:** `centerDim`'s `0.22` floor (lower = quieter center) and the
  ellipse size `rx = (RING_W+80)/2`, `ry = height*0.42`.
- **Default colours (no render yet / grayscale):** `PAL_DEFAULT.hue = 186` (cyan; its
  complement is magenta-ish). Saturation/lightness of the generated pair: the `0.85`/`0.55`
  args in `setPaletteFromHue`.
- **Palette responsiveness:** the `0.06` lerp in `easePalette` (higher = snappier recolour).
- **Hue sensitivity / grayscale cutoff:** the `s < 0.18` per-pixel and `< 0.12` overall
  thresholds in `dominantHue`. Raise them to make more renders fall back to the default duo.

## Gotchas

- **Dev-server 404 is normal.** `index.html` loads `./spacejam.js` (document-relative). Under
  `vite dev` it resolves correctly; in production on GitHub Pages it also resolves correctly.
  (An earlier absolute `/iconizer/spacejam.js` got doubled to `/iconizer/iconizer/…` in dev —
  fixed. Don't change it back to an absolute path.)
- **`public/` ships verbatim.** Anything you put in `public/` (e.g. a stray `.mjs`) is copied
  into `dist/`. The self-test lives in `test/`, *not* `public/`, for this reason.
- **`render()` writes `#out` via `innerHTML`.** That's what the observer watches. If the render
  path ever switches to a canvas/`<img>`, the sampler needs to read pixels instead.
- **Verifying visually is unreliable.** The pattern is subtle and additive; a screenshot diff
  or whole-canvas colour average can miss real changes (this bit us repeatedly). Prefer
  reading sketch state directly (a temporary `window.__sjDebug` hook) or the `?tune` panel.
