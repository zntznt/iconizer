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
  // Append before click: some WebViews (iOS Safari) ignore a detached anchor.
  // Defer the revoke a tick: revoking synchronously can kill the blob before
  // Safari finishes the download handoff.
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 0);
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

// The SVG's nominal size is small (cols*16 ≈ 512px), but it's VECTOR — it
// rasterizes crisp at any size. So exports target an absolute base resolution
// instead of the tiny native size, keeping aspect ratio. scale multiplies it.
const PNG_BASE = 1500; // sharp default for PNG/SVG (the longest side)
const GIF_BASE = 720; // capped so animated GIFs stay shareable in size
// iOS Safari blanks/nulls a canvas past ~4096px per side (and ~16.7M px total).
// Clamp the longest side here so a high scale (1500×4 = 6000) doesn't produce a
// blank export. Conservative enough to also cover the area cap for any ratio.
const MAX_SIDE = 4096;

/** Export pixel dimensions: scale the SVG to `base` on its longest side (× scale),
 *  preserving aspect ratio, then clamp to MAX_SIDE so mobile canvases don't blank. */
export function exportSize(svg: string, base: number, scale: number): { w: number; h: number } {
  const { w, h } = svgSize(svg);
  const k = Math.min(base * scale, MAX_SIDE) / Math.max(w, h);
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

/** A 2d context with high-quality image smoothing (the default is "low").
 *  `readback`=true sets willReadFrequently so repeated getImageData (the GIF
 *  frame loop) uses the CPU-backed canvas path instead of round-tripping the GPU. */
function hqContext(canvas: HTMLCanvasElement, readback = false): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', readback ? { willReadFrequently: true } : undefined);
  if (!ctx) throw new Error('2d canvas context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/** Decode one SVG string to an <img> (the expensive, parallelizable step). The
 *  caller owns the returned object URL until the image is drawn — revoke after. */
function decodeSvg(svg: string): { img: HTMLImageElement; url: string; done: Promise<void> } {
  const url = URL.createObjectURL(svgBlob(svg));
  const img = new Image();
  img.src = url;
  return { img, url, done: img.decode() };
}

/**
 * Rasterize the SVG to PNG via canvas and download it.
 * Invariant: output PNG size = svg size * scale.
 *
 * ponytail: PNG export verified manually (depends on real browser canvas).
 * Not unit-tested — jsdom has no canvas and a polyfill isn't worth a dep.
 */
export async function renderPngBlob(svg: string, scale = 1): Promise<Blob> {
  const { w, h } = exportSize(svg, PNG_BASE, scale); // sharp absolute resolution
  const url = URL.createObjectURL(svgBlob(svg));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = hqContext(canvas);
    // ponytail: never taints — our render() SVG is fully self-contained (inline
    // symbol/use, no external image/font/CSS refs). If a later phase lets SVGs
    // pull external fonts/images, toBlob() can throw SecurityError; inline them then.
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    return await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Rasterize the SVG to PNG and download it. */
export async function downloadPng(svg: string, scale = 1, filename = 'iconizer.png'): Promise<void> {
  downloadBlob(await renderPngBlob(svg, scale), filename);
}

/** Whether copy-image-to-clipboard is supported (ClipboardItem + clipboard.write).
 *  Safari/Firefox gating varies, so the UI feature-detects with this. */
export const canCopyImage = (): boolean =>
  typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;

/** Copy the rendered mosaic to the clipboard as a PNG — the clean image itself,
 *  none of the CRT chrome (scanlines/bezel are CSS on the wrapper, never in the
 *  SVG). Same rasterize as the PNG download, ending in clipboard.write. */
export async function copyPng(svg: string, scale = 1): Promise<void> {
  const blob = await renderPngBlob(svg, scale);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/** The CSS `.motion{...}` body that freezes the animation at phase p (0..1).
 *  `transform-box:fill-box; transform-origin:center` makes it pivot IN PLACE even
 *  in a static SVG image (verified). One rule covers ALL cells -> O(1) per frame,
 *  no per-element work. Math mirrors motion.ts's keyframes + ease-in-out. */
function motionRuleAt(motion: string, p: number, amp = 1): string {
  const pivot = 'transform-box:fill-box;transform-origin:center';
  const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
  const tri = ease(1 - Math.abs(1 - 2 * p)); // 0->1->0 eased (symmetric keyframes)
  // amp scales the amplitude motions (react-to-image); spin/shimmer ignore it,
  // mirroring motion.ts's var(--amp,1) folded into the same magnitudes.
  switch (motion) {
    case 'spin': return `transform:rotate(${(360 * p).toFixed(1)}deg);${pivot}`;
    case 'wiggle': return `transform:rotate(${(-6 + 12 * tri) * amp}deg);${pivot}`;
    case 'swing': return `transform:rotate(${(-12 + 24 * tri) * amp}deg);transform-box:fill-box;transform-origin:top center`;
    case 'pulse': return `transform:scale(${(1 + 0.2 * tri * amp).toFixed(3)});${pivot}`;
    case 'bob': return `transform:translateY(${(-30 * tri * amp).toFixed(1)}%);${pivot}`;
    case 'shimmer': return `opacity:${(1 - 0.6 * tri).toFixed(3)}`;
    // shake: a circular jitter (x = -8%..8%, y = -6%..6%) that loops seamlessly; reads
    // as the same nervous shake as motion.ts's 4-step keyframes, amplitude-scaled.
    case 'shake': {
      const a = 2 * Math.PI * p;
      return `transform:translate(${(-8 * Math.cos(a) * amp).toFixed(1)}%,${(6 * Math.sin(a) * amp).toFixed(1)}%) rotate(${(2 * Math.sin(a) * amp).toFixed(2)}deg);${pivot}`;
    }
    // flip/huecycle are LINEAR (continuous), so use p directly, not the eased tri.
    case 'flip': return `transform:perspective(220px) rotateY(${(360 * p).toFixed(1)}deg);${pivot}`;
    case 'huecycle': return `filter:hue-rotate(${(360 * p).toFixed(1)}deg)`; // O(1): one filter rule, all cells
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
  // GIF caps at a smaller base than PNG so animated files stay shareable.
  const { w: W, h: H } = exportSize(svg, GIF_BASE, scale);
  const delayMs = Math.max(20, Math.round((periodSec * 1000) / frames));

  // gif.js worker inlined via ?raw -> blob URL (works in dev and build; ?url+fetch
  // failed in dev and hung render forever).
  const [{ default: GIF }, { default: workerSrc }] = await Promise.all([
    import('gif.js'),
    import('gif.js/dist/gif.worker.js?raw'),
  ]);
  const workerBlobUrl = URL.createObjectURL(new Blob([workerSrc], { type: 'application/javascript' }));
  // The LZW encode is the dominant cost (~3s of a ~5s export) and gif.js shards
  // it one-frame-per-worker. Scale workers with cores (was a fixed 2), capped at
  // the frame count and leaving a core for the main thread. quality: lower=better.
  const workers = Math.max(2, Math.min(frames, (navigator.hardwareConcurrency || 4) - 1));
  const gif = new GIF({ workers, quality: 5, width: W, height: H, workerScript: workerBlobUrl, repeat: 0 });

  // Drop the live <style> (its animation/reduce-motion rules are inert in a static
  // image and would conflict). We bake a PER-CELL static transform instead — each
  // motion element carries its own `animation-delay` (the stagger), so it must be
  // frozen at ITS phase, not a global one, or the GIF loses the ripple/wave look.
  const styleStripped = svg.replace(/<style>.*?<\/style>/s, '');
  // matches a motion element's class attr + its optional inline style (which may hold
  // animation-delay, --amp, or both); we parse the delay + amp out of the captured text.
  const motionElRe = /class="motion"(?:\s+style="([^"]*)")?/g;
  const period = periodSec;

  // Split the markup ONCE. Only a cell's PHASE changes between frames; the text
  // between motion elements, and each cell's delay and amp, are the same for all
  // of them. Re-running the regex over the whole (multi-megabyte) string 20 times,
  // re-parsing every cell's style attribute each pass, froze the UI for hundreds
  // of milliseconds on a big grid before a single frame was drawn.
  const statics: string[] = []; // text before each motion element, then the tail
  const delays: number[] = [];
  const amps: number[] = [];
  let cut = 0, m: RegExpExecArray | null;
  while ((m = motionElRe.exec(styleStripped)) !== null) {
    statics.push(styleStripped.slice(cut, m.index));
    cut = m.index + m[0].length;
    const styleStr = m[1] as string | undefined;
    const delayM = styleStr ? /animation-delay:([\d.-]+)s/.exec(styleStr) : null;
    const ampM = styleStr ? /--amp:([\d.-]+)/.exec(styleStr) : null;
    delays.push(delayM ? parseFloat(delayM[1]) : 0);
    amps.push(ampM ? parseFloat(ampM[1]) : 1);
  }
  statics.push(styleStripped.slice(cut));

  const frameSvgAt = (i: number) => {
    const t = (period * i) / frames; // global time within one cycle
    // Cells that share a phase share a rule, and with stagger off EVERY cell does,
    // so remember the last one rather than re-deriving the same string per cell.
    let lastP = NaN, lastAmp = NaN, lastRule = '';
    let out = statics[0];
    for (let c = 0; c < delays.length; c++) {
      // CSS: effective phase = ((t - delay) / period) wrapped to [0,1).
      let p = ((t - delays[c]) / period) % 1;
      if (p < 0) p += 1;
      const amp = amps[c];
      if (p !== lastP || amp !== lastAmp) {
        lastP = p; lastAmp = amp;
        lastRule = motionRuleAt(motion, p, amp);
      }
      // bake this cell's transform inline; class removed so nothing re-animates.
      out += `style="${lastRule}"` + statics[c + 1];
    }
    return out;
  };

  try {
    // Draw each frame on ONE reused readback canvas (no 20 separate canvas
    // allocations; willReadFrequently makes the per-frame getImageData a CPU read,
    // not a GPU round-trip). Decode SERIALLY — decoding all frames at once makes
    // Image.decode() reject (EncodingError) under Chrome's concurrent-decode limit.
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = hqContext(canvas, /* readback */ true);
    for (let i = 0; i < frames; i++) {
      const { img, url, done } = decodeSvg(frameSvgAt(i));
      await done;
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(url);
      gif.addFrame(ctx.getImageData(0, 0, W, H), { delay: delayMs });
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
