/** Build the Blob for an SVG string. Factored out so it's testable headlessly. */
export function svgBlob(svg: string): Blob {
  return new Blob([svg], { type: 'image/svg+xml' });
}

/** Trigger a browser download of a Blob via a temporary <a download>. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Download the rendered mosaic as a standalone .svg file. */
export function downloadSvg(svg: string, filename = 'iconizer.svg'): void {
  downloadBlob(svgBlob(svg), filename);
}

/** Pull "0 0 W H" or width/height off the root <svg> tag. Plain regex — the
 *  string is our own render() output, not arbitrary SVG. */
function svgSize(svg: string): { w: number; h: number } {
  const w = svg.match(/<svg[^>]*\bwidth="([\d.]+)"/)?.[1];
  const h = svg.match(/<svg[^>]*\bheight="([\d.]+)"/)?.[1];
  return { w: Number(w) || 0, h: Number(h) || 0 };
}

/**
 * Rasterize the SVG to PNG via canvas and download it.
 * Invariant: output PNG size = svg size * scale.
 *
 * ponytail: PNG export verified manually (depends on real browser canvas).
 * Not unit-tested — jsdom has no canvas and a polyfill isn't worth a dep.
 */
export async function downloadPng(svg: string, scale = 1, filename = 'iconizer.png'): Promise<void> {
  const { w, h } = svgSize(svg);
  const url = URL.createObjectURL(svgBlob(svg));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d canvas context unavailable');
    // ponytail: never taints — our render() SVG is fully self-contained (inline
    // symbol/use, no external image/font/CSS refs). If a later phase lets SVGs
    // pull external fonts/images, toBlob() can throw SecurityError; inline them then.
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob: Blob = await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'),
    );
    downloadBlob(blob, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Rasterize one SVG string to an ImageData at the given pixel size. */
async function rasterize(svg: string, w: number, h: number): Promise<ImageData> {
  const url = URL.createObjectURL(svgBlob(svg));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Export the ANIMATED mosaic as a looping .gif. The CSS animation lives only in
 * the browser, so a GIF is how a moving mosaic gets shared.
 *
 * Mechanism — capture from the LIVE animated DOM. An SVG loaded as an <img> (what
 * drawImage needs) renders STATICALLY: CSS animations don't run, animation-delay
 * does nothing, and even a baked `transform` attr pivots around the SVG origin not
 * the element. So instead we mount the real mosaic in a hidden live <div> (where
 * the CSS animation actually runs with correct fill-box pivots), pause its
 * animations via the Web Animations API, and for each frame:
 *   1. seek every .motion animation's currentTime to phase p,
 *   2. read each element's COMPUTED transform (a matrix() with the pivot resolved),
 *   3. bake those matrices into a serialized copy and rasterize it.
 * N frames across one cycle -> seamless loop. gif.js encodes in a Worker.
 *
 * @param periodSec the animation period (settings.motionSpeed) — one full cycle.
 * ponytail: gif.js is the one runtime dep; hand-rolling GIF89a/LZW isn't worth it.
 */
export async function downloadGif(
  svg: string, periodSec: number, scale = 1, frames = 20, filename = 'iconizer.gif',
): Promise<void> {
  const { w, h } = svgSize(svg);
  const W = Math.round(w * scale), H = Math.round(h * scale);
  const delayMs = Math.max(20, Math.round((periodSec * 1000) / frames));

  const [{ default: GIF }, workerUrl] = await Promise.all([
    import('gif.js'),
    import('gif.js/dist/gif.worker.js?url').then((m) => m.default),
  ]);
  const gif = new GIF({ workers: 2, quality: 10, width: W, height: H, workerScript: workerUrl, repeat: 0 });

  // Mount the live mosaic offscreen so its CSS animation actually runs.
  const stage = document.createElement('div');
  stage.style.cssText = 'position:fixed;left:-99999px;top:0;pointer-events:none';
  stage.innerHTML = svg;
  document.body.appendChild(stage);
  const liveSvg = stage.querySelector('svg')!;
  const motionEls = Array.from(liveSvg.querySelectorAll<SVGElement>('.motion'));
  const periodMs = periodSec * 1000;

  try {
    for (let i = 0; i < frames; i++) {
      const tMs = (periodMs * i) / frames; // phase across one cycle
      // seek each element's animation, then read its resolved computed transform.
      for (const el of motionEls) {
        for (const a of el.getAnimations()) { a.pause(); a.currentTime = tMs; }
      }
      // bake the computed transform (incl. fill-box pivot) onto a clone, serialize.
      const clone = liveSvg.cloneNode(true) as SVGElement;
      const cloneEls = Array.from(clone.querySelectorAll<SVGElement>('.motion'));
      motionEls.forEach((el, j) => {
        const t = getComputedStyle(el).transform;
        const o = getComputedStyle(el).opacity;
        const c = cloneEls[j];
        if (t && t !== 'none') c.setAttribute('transform', cssMatrixToSvg(t));
        if (o && o !== '1') c.setAttribute('opacity', o);
        c.removeAttribute('class'); // drop the .motion class so the <style> can't re-animate
      });
      // strip the <style> from the clone (no live animation in the raster anyway).
      clone.querySelector('style')?.remove();
      const frame = await rasterize(new XMLSerializer().serializeToString(clone), W, H);
      gif.addFrame(frame, { delay: delayMs, copy: true });
    }
  } finally {
    stage.remove();
  }

  const blob: Blob = await new Promise((resolve) => {
    gif.on('finished', resolve);
    gif.render();
  });
  downloadBlob(blob, filename);
}

/** "matrix(a, b, c, d, e, f)" (computed CSS) -> SVG transform "matrix(a b c d e f)". */
function cssMatrixToSvg(css: string): string {
  const nums = css.match(/matrix\(([^)]+)\)/)?.[1];
  if (!nums) return '';
  return `matrix(${nums.split(',').map((n) => n.trim()).join(' ')})`;
}
