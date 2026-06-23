# Competitive landscape — what's out there, and what sets iconizer apart

Research pass (2026-06), builder agent. Question asked: *does anything already
do what this app does?* Short answer: **every individual piece exists and is
mature; the specific combination does not.** No tool found maps an image onto a
grid of a **user-uploaded SVG**, recolored per cell, with **CMY/RGB channel-split
layering** and **CSS motion baked into the export**. That stack appears novel.

This is a positioning note, not a roadmap. It records what's already solved (so we
don't reinvent it) and which parts are genuinely ours (so we lean on them).

## The four adjacent categories (each mature, none overlapping us fully)

| Category | What they do | What they DON'T do (our gap) | Examples |
|---|---|---|---|
| **Photomosaics** | Rebuild an image from thousands of *photo* tiles, optimized for color match | Tile is a photo library, never your own vector icon; no channel-split; not vector out | TurboMosaic, Picture Mosaics, EasyMoza, photomosaic.work |
| **Halftone-SVG** | Image → grid of dots/lines/rings as scalable SVG | Fixed primitive shapes (dot/line/ring), not an arbitrary uploaded SVG; no layered color model; SVG export often paywalled | svg-halftone (vestera), VectoSolve, Halftone Maker, HalftonePro ($15 for SVG) |
| **ASCII-art generators** | Image → grid of *glyphs*, colored per cell, custom char ramps, export PNG/SVG/HTML | **The closest cousin conceptually** — but limited to text characters/fonts, not vector icons; no channel-split layering; no motion | generator-ascii.art, Inventive HQ, Jasper Bernaers, asciiart.club, Figma ASCII plugin |
| **RGB/CMYK channel-split** | Split a whole image into channels, offset them → glitch/chromatic-aberration look | Applied as a *filter over a flat image*, never as the per-cell building block of a mosaic | imageonlinetools RGB split, CLIP STUDIO, glitch makers |

The closest *single thing* found: **SouthbankSoftware/photo-mosaic** (GitHub) serves
SVG tiles per average color — but it's a server-rendered photomosaic, not
upload-your-own-icon + tint + channel-split + animate + export, client-side.

## What is genuinely distinctive (ranked by defensibility)

1. **Channel-split layering as a *mosaic primitive* — the strongest claim.**
   Channel split (CMY multiply / RGB-additive screen) exists everywhere as a
   *whole-image glitch filter*. Nobody uses it as the per-cell render mode of a
   mosaic. The "quasi-RGB" stack — 2-3 copies of the icon, each subtracting or
   adding one channel, multiply/screen-blended to resolve to the true cell color
   — is, as far as this search found, **unique to iconizer**. This is the part to
   lean on if differentiation ever matters.

2. **The tile is a user-uploaded *arbitrary* SVG, recolored per cell.** Mosaic
   tools use photo tiles; halftone tools use fixed dots; ASCII tools use text
   glyphs; SVG recolorers do one icon, not a mosaic. The combination —
   *your* icon as the repeated, per-cell-tinted unit, with multi-icon
   brightness ramping (dark→light, ASCII-style but vector) — isn't offered
   elsewhere together. Per-cell *orientation* mapping (rotation by brightness =
   an orientation field) leans on this same edge: only meaningful because the
   tile is an arbitrary directional vector — halftone dots are radially
   symmetric, ASCII glyphs can't rotate. (Claim by reasoning, not a fresh
   search — verify before leaning on it in copy.)

3. **Motion that survives export.** Most halftone-SVG tools paywall SVG export
   (HalftonePro: $15). iconizer's CSS-keyframe animation is baked *into* the SVG
   string, so the downloaded `.svg` stays alive, and the GIF export bakes per-cell
   phase. Animated mosaic export, free, is uncommon.

4. **100% client-side, zero runtime deps, free, no watermark.** Individually
   common (ezgif, browser ASCII tools all do client-side), but combined with the
   above and with nothing to upload, it's a clean privacy/cost story.

## Honest caveats (don't oversell)

- **Search, not audit.** A niche CodePen, Glitch project, itch.io toy, or paid
  plugin could do the exact combo and not surface. "Not found" ≠ "doesn't exist."
- **Novel combination ≠ market.** The Win98/Geocities redesign signals this is
  **fun-first / toy-art** (see `design-iconizer98.md`), where delight beats
  uniqueness. Distinctiveness is a nice-to-have here, not the thesis.
- **The cousins are good.** ASCII generators in particular are polished and free;
  if a user just wants "image → colored grid of shapes," they have options. Our
  wedge is specifically the *vector-icon tile* + *channel-split look* + *animation*,
  not "mosaic" in general.

## One-line positioning

> Not a photomosaic and not a halftone tool — it's the only thing that turns *your*
> SVG into the pixel of a channel-split, animated, exportable mosaic. The
> quasi-RGB per-cell layering is the part nobody else does.

## Sources

Photomosaics: turbomosaic.com · picturemosaics.com · easymoza.com · photomosaic.work ·
github.com/SouthbankSoftware/photo-mosaic
Halftone-SVG: halftone.vestera.as · vectosolve.com/halftone-generator · halftonemaker.com ·
halftonepro.com
ASCII: generator-ascii.art · inventivehq.com ASCII tool · jasperbernaers.com/ASCII-generator ·
asciiart.club · Figma ASCII Art Generator plugin
Channel-split: imageonlinetools.com/rgb-split-effect · CLIP STUDIO Chroma Channel Split
SVG→GIF: ezgif.com/svg-to-gif · svgator.com
