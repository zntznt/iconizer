# Iconizer

> ★ Netscape Now! · best viewed at 800×600 ★

Upload a picture and an SVG icon. Iconizer renders the picture as a **photomosaic**
where every grid cell is a tinted, scaled copy of your icon. Tune the grid, the
colours, and the motion; export the result as a crisp SVG, a PNG, or an animated GIF.

The whole thing runs in a Y2K / Windows-98 fake desktop, with draggable `.exe`
windows, a Start menu, a scrolling webring, and an animated moiré backdrop drawn
live with p5.js.

**Live:** https://zntznt.com/iconizer

## What it does

Feed it two files:

1. **a picture** (PNG/JPG/…), the thing you want to see in the mosaic
2. **an SVG icon**, the shape every cell is made of (drop more than one to mix)

…and it samples the picture into a grid, then stamps a coloured copy of your icon
into each cell. Brighter cells, bigger icons; the icon's colour follows the cell's
colour. The output is real, exportable artwork, not a screenshot.

Everything is **100% client-side**. Your image never leaves the browser; there's no
backend and nothing is stored. That's why it's safe and free to host.

## How it works

The app is one pure function plus a settings object:

```
sample(image)            -> Cell[]          // canvas getImageData -> a colour grid
render(grid, icons, opts) -> "<svg>…</svg>"  // the pure core: grid + icons -> one SVG
```

- **`src/sample.ts`** turns the source image into a `Cell[]` grid (canvas pixels).
- **`src/render.ts`** is the pure core: grid + icons + settings → one `<svg>` string.
  No DOM reads inside, so it re-runs cheaply on every slider change and is the one
  thing worth a unit test.
- Everything else (upload, sliders, windows, export) is plumbing around that.

The output SVG defines the icon **once** as a `<symbol>` and references it per cell
with `<use>`, which is what keeps a 100×100 grid a small file. Layered
"quasi-RGB" mode stacks 2 to 3 `<use>` of the same symbol per cell to fake colour.

### The knobs (`Settings`)

| Setting            | What it does                                                        |
| ------------------ | ------------------------------------------------------------------- |
| `cols`             | grid columns; rows derive from the image aspect ratio               |
| `blockSize`        | merge N×N sample cells into one averaged icon (`1` = off)           |
| `iconScale`        | global icon size multiplier (`>1` = icons overlap their cell)       |
| `sizeByBrightness` | scale each icon by its cell's brightness                            |
| `background`       | colour the source is composited onto; sets the CMY floor            |
| `layered`          | solid-tint path vs. per-cell layered stack                          |
| `layerStyle`       | `cmy` (multiply-subtract) or `rgb` (channel-proportion solids)      |
| `layerOffset`      | px chromatic-aberration nudge (`0` = concentric)                    |
| `scheme`           | recolour each cell upstream (duotone, etc.)                         |
| `motion`           | a CSS-keyframe animation baked into the SVG (`none` = static)       |

Settings live in the URL. **Copy Share Link** in the Start menu hands someone the
exact look (the settings, not the image).

## Run it

```bash
npm install
npm run dev      # vite dev server
npm run build    # tsc + vite build  ->  dist/
npm run preview  # serve the built dist/
npm test         # the pure cores (sample, render, export, colour, motion, permalink)
```

`npm test` covers the pure cores only. Anything needing a real browser (canvas,
download, visual correctness) has a re-runnable checklist in
`guidance/manual-tests.md`. Run the relevant phase's checks after touching
sampling, render, tint, or export. **Tests passing is necessary, not sufficient.**

## Stack & constraints

- **Vite + vanilla TypeScript.** No UI framework.
- **No runtime dependencies.** Canvas, SVG, and the File API are all native; a few
  lines beat a dependency. Dev-only deps are fine (the GIF encoder, plus p5 from CDN
  for the backdrop).
- **Deploys to GitHub Pages**, so `vite.config.ts` must keep `base: '/iconizer/'`.
  Pushing to `main` builds and publishes via `.github/workflows/deploy.yml`.

## Layout

```
src/
  sample.ts     image -> Cell[] grid
  render.ts     the pure core: grid + icons + settings -> SVG
  settings.ts   the Settings type + defaults
  color.ts      schemes / tinting
  motion.ts     baked CSS animation presets
  parseSvg.ts   pull the icon shape out of an uploaded SVG
  permalink.ts  settings <-> URL
  export.ts     SVG / PNG / GIF download
  main.ts       all the desktop plumbing (windows, dropwell, taskbar)
index.html      the desktop: markup + all CSS
public/
  spacejam.js   the p5.js moiré-ripples backdrop
  favicon.svg   the Win9x flag
guidance/       the plan + per-phase briefs + manual-test checklist
```

## License

A fun lil mosaic toy. Do whatever. ♡
