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

/** The CSS `.motion{...}` body that freezes the animation at phase p (0..1).
 *  `transform-box:fill-box; transform-origin:center` makes it pivot IN PLACE even
 *  in a static SVG image (verified). One rule covers ALL cells -> O(1) per frame,
 *  no per-element work. Math mirrors motion.ts's keyframes + ease-in-out. */
function motionRuleAt(motion: string, p: number): string {
  const pivot = 'transform-box:fill-box;transform-origin:center';
  const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
  const tri = ease(1 - Math.abs(1 - 2 * p)); // 0->1->0 eased (symmetric keyframes)
  switch (motion) {
    case 'spin': return `transform:rotate(${(360 * p).toFixed(1)}deg);${pivot}`;
    case 'wiggle': return `transform:rotate(${(-6 + 12 * tri).toFixed(2)}deg);${pivot}`;
    case 'swing': return `transform:rotate(${(-12 + 24 * tri).toFixed(2)}deg);transform-box:fill-box;transform-origin:top center`;
    case 'pulse': return `transform:scale(${(1 + 0.2 * tri).toFixed(3)});${pivot}`;
    case 'bob': return `transform:translateY(${(-30 * tri).toFixed(1)}%);${pivot}`;
    case 'shimmer': return `opacity:${(1 - 0.6 * tri).toFixed(3)}`;
    default: return '';
  }
}

/**
 * Export the ANIMATED mosaic as a looping .gif.
 *
 * Fast path: for each frame, replace the live `.motion{animation:...}` rule in the
 * SVG's <style> with a STATIC `.motion{transform:<phase>}` rule and rasterize. A
 * single CSS rule freezes ALL cells at that phase — O(1) per frame, not O(cells).
 * (The earlier per-element approach forced a getComputedStyle reflow per cell per
 * frame -> hung at 1000+ cells.) transform-box:fill-box pivots in place even in a
 * static SVG image (verified). N frames over one cycle -> seamless loop.
 *
 * @param motion the active motion key; @param periodSec the cycle length.
 * ponytail: gif.js is the one runtime dep; hand-rolling GIF89a/LZW isn't worth it.
 */
export async function downloadGif(
  svg: string, motion: string, periodSec: number, scale = 1, frames = 20, filename = 'iconizer.gif',
): Promise<void> {
  const { w, h } = svgSize(svg);
  const W = Math.round(w * scale), H = Math.round(h * scale);
  const delayMs = Math.max(20, Math.round((periodSec * 1000) / frames));

  // gif.js worker inlined via ?raw -> blob URL (works in dev and build; ?url+fetch
  // failed in dev and hung render forever).
  const [{ default: GIF }, { default: workerSrc }] = await Promise.all([
    import('gif.js'),
    import('gif.js/dist/gif.worker.js?raw'),
  ]);
  const workerBlobUrl = URL.createObjectURL(new Blob([workerSrc], { type: 'application/javascript' }));
  const gif = new GIF({ workers: 2, quality: 10, width: W, height: H, workerScript: workerBlobUrl, repeat: 0 });

  // The live <style> sets `.motion{...animation:mo ...}`. We swap the whole
  // .motion rule for a static phase rule. Match the existing rule to replace it.
  const motionRuleRe = /\.motion\{[^}]*\}/;

  try {
    for (let i = 0; i < frames; i++) {
      const p = i / frames;
      const frameSvg = svg.replace(motionRuleRe, `.motion{${motionRuleAt(motion, p)}}`);
      const frame = await rasterize(frameSvg, W, H);
      gif.addFrame(frame, { delay: delayMs, copy: true });
    }
    const blob: Blob = await new Promise((resolve, reject) => {
      gif.on('finished', resolve);
      gif.on('abort', () => reject(new Error('gif encode aborted')));
      const timer = setTimeout(() => reject(new Error('gif encode timed out')), 30000);
      gif.on('finished', () => clearTimeout(timer));
      gif.render();
    });
    downloadBlob(blob, filename);
  } finally {
    URL.revokeObjectURL(workerBlobUrl);
  }
}
