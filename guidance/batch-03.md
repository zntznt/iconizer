# Batch 03 — Export (Phase 3)

Goal: download the rendered mosaic as an `.svg` file, and as a `.png` rasterized
in-browser. No new rendering — this operates on the output string from `render()`.

Depends on Batch 02's `render()` output. Read `guidance/PLAN.md` first.

## `src/export.ts`

Two functions, both take the output SVG string from `render()`:

    downloadSvg(svg: string, filename = 'iconizer.svg'): void
    downloadPng(svg: string, scale = 1, filename = 'iconizer.png'): Promise<void>

### SVG download — trivial

- `new Blob([svg], { type: 'image/svg+xml' })` -> `URL.createObjectURL` ->
  a temporary `<a download>` -> `.click()` -> `URL.revokeObjectURL`.
- The output of `render()` is already a complete standalone `<svg>`, so no
  wrapping needed. ~8 lines.

### PNG download — the one with a sharp edge

Rasterize the SVG via canvas:

1. Make a Blob URL of the SVG (as above) — or a `data:image/svg+xml;base64,...`
   URL; Blob URL is fine and avoids base64 bloat.
2. Load it into `const img = new Image(); img.src = url; await img.decode()`.
3. Read the intended pixel size from the SVG's root `width`/`height`
   (render() sets these). Multiply by `scale` for hi-res export.
4. Draw to a canvas of that size, `ctx.drawImage(img, 0, 0, w*scale, h*scale)`.
5. `canvas.toBlob(blob => download(blob), 'image/png')` -> same `<a download>` dance.
6. Revoke the Blob URL.

> **CANVAS TAINTING — why this works, and what breaks it.** Drawing an `<img>`
> onto a canvas taints it if the image's source is cross-origin OR the SVG
> references external resources (remote `<image href>`, external CSS, web fonts via
> `@import`/external `<link>`). A tainted canvas throws SecurityError on
> `toBlob()`/`toDataURL()`. Our SVG is fully self-contained (inline `<symbol>` +
> `<use>`, cell colors as attributes, no external refs), so it never taints —
> PNG export is safe. **If a later phase lets the user's SVG pull external fonts
> or images, PNG export can break.** Leave a `ponytail:` comment at the drawImage
> site naming this. Don't pre-solve it (inlining fonts) until it's a real input.

### Optional polish (skip unless quick)

- `scale` control in the UI (1x / 2x / 4x) for retina-quality PNG. One `<select>`.
- Filename from a text input. YAGNI for now — hardcode defaults, add when asked.

## Wiring (main.ts)

- Two buttons: "Download SVG", "Download PNG". Disabled until a render exists.
- They call the export fns with the current output SVG string. Keep the latest
  output string in module state alongside the render so export doesn't re-render.

## Self-check (required)

PNG export is async + canvas — hard to assert headlessly without a DOM. Keep the
check small and honest:

- **SVG path** is pure-ish: assert `downloadSvg` builds a Blob of type
  `image/svg+xml` whose text round-trips the input string. (Stub
  `URL.createObjectURL` / the `<a>` click, or factor the Blob-building into a
  testable `svgBlob(svg)` helper and assert on that.)
- **PNG path**: don't fake a canvas. Add a `ponytail:` comment that this path is
  verified manually (it depends on real browser canvas), and note the one
  invariant — output size = svg size * scale. If trivial to run under jsdom/canvas
  later, do it then; not worth the dep now.

## Done when

- "Download SVG" yields a file that opens correctly in a browser/editor.
- "Download PNG" yields a raster PNG at the expected dimensions (and at 2x/4x if
  the scale control shipped).
- The `svgBlob` self-check passes.
- Committed to `main`.

## Out of scope for this batch

Layered quasi-RGB (Phase 4), color schemes (Phase 5), deploy (Phase 6),
font-inlining / external-resource support (deferred, see tainting note above).

## APPENDED (later): the export size invariant changed, and is now tested

"output size = svg size * scale" is not the policy any more, and it is no longer
the untestable one either. `exportSize` scales the longest side to an ABSOLUTE
base times the scale, then clamps: `PNG_BASE` is 1500, the clamp is `MAX_SIDE`
4096, so PNG at 1x/2x/4x is 1500 / 3000 / 4096. GIF takes a tighter
`MAX_GIF_SIDE` of 1440 through `gifExportSize`, because it holds every frame as
raw RGBA until the encode finishes and 2880px never completed.

`export.test.ts` asserts all of it headlessly: base at 1x, the clamp at 4x,
aspect ratio preserved, and the GIF cap.
