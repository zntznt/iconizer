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

// --- icon ramp packs ---------------------------------------------------------
// Ordered dark->light icon sets that make the multi-icon brightness ramp (a core
// differentiator: dark cell -> first icon, light -> last) discoverable without
// hunting down 5 SVGs yourself. Every glyph is ONE <path> (subpaths are fine),
// preserving the live renderer's spliced fast path.

const wrap = (d: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${d}"/></svg>`;

// Moon terminator trick: left semicircle (r 10), then an inner half-ellipse back
// up. rx sets the bulge; sweep picks the side (0 = east = gibbous, 1 = west =
// crescent bite). Ink coverage: 1.0 / .75 / .5 / .25 / .1.
const MOON: [string, string][] = [
  ['full moon', 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20z'],
  ['gibbous', 'M12 2a10 10 0 0 0 0 20a5 10 0 0 0 0-20z'],
  ['half moon', 'M12 2a10 10 0 0 0 0 20z'],
  ['crescent', 'M12 2a10 10 0 0 0 0 20a5 10 0 0 1 0-20z'],
  ['sliver', 'M12 2a10 10 0 0 0 0 20a8 10 0 0 1 0-20z'],
];

// Signal bars, tallest set first (most ink = darkest cells).
const BAR = ['M2 16h3.5v6H2z', 'M7.5 12h3.5v10H7.5z', 'M13 7h3.5v15H13z', 'M18.5 2h3.5v20h-3.5z'];
const SIGNAL: [string, string][] = [4, 3, 2, 1].map((n) =>
  [`signal ${n}/4`, BAR.slice(0, n).join('')] as [string, string]);

// ASCII-art shade blocks (█ ▓ ▒ ░ ·) as 6x6 hatches of 4px squares.
const hatch = (keep: (x: number, y: number) => boolean): string => {
  let d = '';
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++)
    if (keep(x, y)) d += `M${x * 4} ${y * 4}h4v4h-4z`;
  return d;
};
const SHADES: [string, string][] = [
  ['solid', 'M0 0h24v24H0z'],
  ['shade 75%', hatch((x, y) => (x + y) % 4 !== 0)],
  ['shade 50%', hatch((x, y) => (x + y) % 2 === 0)],
  ['shade 25%', hatch((x, y) => (x + y) % 4 === 0)],
  ['dot', 'M8 8h8v8H8z'],
];

/** name -> ordered [iconName, svgString][] ramps. Replaces the icon list. */
export const RAMPS: Record<string, [string, string][]> = {
  moon: MOON.map(([n, d]) => [n, wrap(d)]),
  signal: SIGNAL.map(([n, d]) => [n, wrap(d)]),
  shades: SHADES.map(([n, d]) => [n, wrap(d)]),
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
