// Built-in demo assets: a procedural CRT test card + starter icons, so the very
// first render is ONE CLICK with zero uploads and zero bundled binary assets.
// The card is drawn to a canvas at runtime (always crisp, nothing to ship); the
// icons are tiny inline SVG strings that go through parseSvg() like any upload.

/** Starter icons, dark-to-light-agnostic single-path SVGs. Single path matters:
 *  it keeps render()'s live fast path (attrs spliced into the shape, no <g>). */
export const STARTERS: Record<string, string> = {
  heart: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 21C5.4 15 2 11.3 2 7.7 2 5 4.2 3 6.8 3 8.8 3 10.7 4.1 12 6c1.3-1.9 3.2-3 5.2-3C19.8 3 22 5 22 7.7c0 3.6-3.4 7.3-10 13.3z"/></svg>',
  star: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7-6.2-3.7-6.2 3.7 1.6-7L2 9.2l7.1-.6z"/></svg>',
  bolt: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>',
};

// SMPTE 75% bars: the classic "please stand by" columns. Saturated primaries +
// secondaries show off schemes and the CMY split; the ramp below gives the
// brightness-mapped knobs (size/fade/cutout) a full tonal range to bite into.
const BARS = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];

/** Draw the test card, returned as the same type an uploaded image decodes to. */
export function testCard(): Promise<ImageBitmap> {
  const W = 640, H = 480, barH = 320; // 4:3, obviously
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
  BARS.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round((i * W) / BARS.length), 0, Math.ceil(W / BARS.length), barH);
  });
  const ramp = ctx.createLinearGradient(0, 0, W, 0);
  ramp.addColorStop(0, '#000000');
  ramp.addColorStop(1, '#ffffff');
  ctx.fillStyle = ramp;
  ctx.fillRect(0, barH, W, H - barH);
  return createImageBitmap(canvas);
}
