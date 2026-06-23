export type RGB = { r: number; g: number; b: number };

/** Perceptual luma weights (Rec. 709). Shared so sample() and grayscale/duotone
 *  don't each re-magic-number them. */
export const LUMA = { r: 0.2126, g: 0.7152, b: 0.0722 } as const;

/** Perceptual luma 0-1 for an rgb (0-255). */
export const luma = ({ r, g, b }: RGB): number =>
  (LUMA.r * r + LUMA.g * g + LUMA.b * b) / 255;

export type Scheme =
  | { kind: 'none' }
  | { kind: 'grayscale' }
  | { kind: 'invert' }
  | { kind: 'sepia' }
  | { kind: 'threshold'; cutoff: number } // 1-bit: luma >= cutoff -> white, else black
  | { kind: 'hue'; deg: number } // rotate hue by deg (luma-preserving)
  | { kind: 'posterize'; levels: number }
  | { kind: 'duotone'; dark: RGB; light: RGB }
  | { kind: 'tritone'; dark: RGB; mid: RGB; light: RGB } // 3-stop gradient map
  | { kind: 'gradient'; stops: RGB[] } // N-stop gradient map keyed by luma
  | { kind: 'solarize'; cutoff: number } // invert only channels above cutoff
  | { kind: 'channelswap'; order: string } // permute channels, e.g. 'gbr'
  | { kind: 'palette'; colors: RGB[] };

/** Always-on tonal/colour adjustment applied BEFORE the scheme. Neutral values
 *  are identity, so it only costs anything when a user actually moves a knob. */
export type Adjust = {
  brightness: number; // multiplier, 1 = neutral
  contrast: number; // multiplier around mid-grey, 1 = neutral
  saturation: number; // 0 = grey, 1 = neutral, >1 = vivid
  temperature: number; // -1 cool .. 0 neutral .. +1 warm
};
export const NEUTRAL_ADJUST: Adjust = { brightness: 1, contrast: 1, saturation: 1, temperature: 0 };
export const adjustActive = (a: Adjust): boolean =>
  a.brightness !== 1 || a.contrast !== 1 || a.saturation !== 1 || a.temperature !== 0;

/** A gradient wash blended across the whole grid (position -> u in [0,1]). Post
 *  stage, after the scheme — the "literal gradient" overlay, distinct from the
 *  tone-keyed gradient map. */
export type Overlay = {
  dir: 'none' | 'h' | 'v' | 'diag' | 'radial';
  preset: string; // key into GRADIENTS
  blend: 'mix' | 'multiply' | 'screen';
  strength: number; // 0..1
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

const hex = (h: string): RGB => ({
  r: parseInt(h.slice(1, 3), 16),
  g: parseInt(h.slice(3, 5), 16),
  b: parseInt(h.slice(5, 7), 16),
});

/** Built-in retro palettes for the `palette` scheme. The nearest-color snap in
 *  transformColor maps each cell to the closest swatch, so an arbitrary photo
 *  collapses onto these classic machine palettes. On-brand with the Win98/CRT
 *  toy aesthetic; the user can still hand-pick a 'custom' set in the UI. */
export const PALETTES: Record<string, RGB[]> = {
  // Game Boy DMG 4-shade green
  gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'].map(hex),
  // CGA mode 4, palette 1 (high intensity) — the cyan/magenta DOS classic
  cga: ['#000000', '#55ffff', '#ff55ff', '#ffffff'].map(hex),
  // EGA 16-color
  ega: ['#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500',
    '#aaaaaa', '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff',
    '#ffff55', '#ffffff'].map(hex),
  // Commodore 64 16-color
  c64: ['#000000', '#ffffff', '#880000', '#aaffee', '#cc44cc', '#00cc55', '#0000aa',
    '#eeee77', '#dd8855', '#664400', '#ff7777', '#333333', '#777777', '#aaff66',
    '#0088ff', '#bbbbbb'].map(hex),
  // PICO-8 16-color
  pico8: ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c7c8',
    '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c',
    '#ff77a8', '#ffccaa'].map(hex),
};

/** Built-in multi-stop gradients for the `gradient` scheme. Each cell's luma
 *  indexes a smooth ramp across the stops (a "gradient map") — the smooth,
 *  curated cousin of duotone/tritone. Tuned for the vaporwave/CRT toy vibe. */
export const GRADIENTS: Record<string, RGB[]> = {
  vaporwave: ['#1a0033', '#ff2a6d', '#d300c5', '#05d9e8', '#d1f7ff'].map(hex),
  sunset: ['#0d1b2a', '#7b2d26', '#e85d04', '#ffba08', '#fff3b0'].map(hex),
  fire: ['#000000', '#5f0000', '#d00000', '#ff8800', '#ffe808', '#ffffff'].map(hex),
  ice: ['#03045e', '#0077b6', '#00b4d8', '#90e0ef', '#caf0f8'].map(hex),
  rainbow: ['#ff0000', '#ff8800', '#ffee00', '#00cc44', '#0088ff', '#8800ff'].map(hex),
};

/** Map t in [0,1] across an N-stop ramp (evenly spaced), lerping the bracketing
 *  pair. Shared shape with duotone (2 stops) / tritone (3) generalised to N. */
function gradientAt(stops: RGB[], t: number): RGB {
  if (stops.length === 1) return stops[0];
  const p = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(p));
  const frac = p - i;
  const a = stops[i], b = stops[i + 1];
  return {
    r: clamp255(lerp(a.r, b.r, frac)),
    g: clamp255(lerp(a.g, b.g, frac)),
    b: clamp255(lerp(a.b, b.b, frac)),
  };
}

/** Pre-scheme tonal/colour tweak. Order: brightness -> contrast -> temperature
 *  -> saturation, each a cheap closed form. Pure: rgb in, rgb out. */
export function adjustColor(rgb: RGB, a: Adjust): RGB {
  let { r, g, b } = rgb;
  r *= a.brightness; g *= a.brightness; b *= a.brightness;
  r = (r - 128) * a.contrast + 128;
  g = (g - 128) * a.contrast + 128;
  b = (b - 128) * a.contrast + 128;
  if (a.temperature) { const k = a.temperature * 40; r += k; b -= k; } // warm = +red/-blue
  if (a.saturation !== 1) {
    const y = LUMA.r * r + LUMA.g * g + LUMA.b * b; // grey point (0..255)
    r = y + (r - y) * a.saturation;
    g = y + (g - y) * a.saturation;
    b = y + (b - y) * a.saturation;
  }
  return { r: clamp255(r), g: clamp255(g), b: clamp255(b) };
}

/** Ordered-dither threshold in (0,1) for a cell, from a 4x4 Bayer matrix. render()
 *  adds (this - 0.5) * spread to the cell before a quantising scheme, breaking
 *  flat bands into the classic retro cross-hatch. */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const bayer = (col: number, row: number): number =>
  (BAYER4[(row & 3) * 4 + (col & 3)] + 0.5) / 16;

/** Whether a scheme quantises (snaps tone to discrete steps) — the only schemes
 *  ordered dithering does anything visible for. */
export const schemeQuantizes = (s: Scheme): boolean =>
  s.kind === 'threshold' || s.kind === 'posterize' || s.kind === 'palette';

/** Blend a gradient-wash colour (at grid position u) over a base colour. */
export function overlayColor(base: RGB, u: number, overlay: Overlay): RGB {
  const stops = GRADIENTS[overlay.preset] ?? [];
  if (stops.length === 0 || overlay.strength <= 0) return base;
  const g = gradientAt(stops, u);
  const ch = (bv: number, gv: number): number => {
    let blended: number;
    switch (overlay.blend) {
      case 'multiply': blended = (bv * gv) / 255; break;
      case 'screen': blended = 255 - ((255 - bv) * (255 - gv)) / 255; break;
      default: blended = gv; // 'mix' = straight crossfade
    }
    return clamp255(lerp(bv, blended, overlay.strength));
  };
  return { r: ch(base.r, g.r), g: ch(base.g, g.g), b: ch(base.b, g.b) };
}

/** Remap one cell color through a scheme. Pure: rgb in, rgb out. Called at a
 *  single upstream point in render() so it composes with solid AND layered. */
export function transformColor(rgb: RGB, scheme: Scheme): RGB {
  switch (scheme.kind) {
    case 'none':
      return rgb;
    case 'grayscale': {
      const v = clamp255(luma(rgb) * 255);
      return { r: v, g: v, b: v };
    }
    case 'invert':
      return { r: 255 - rgb.r, g: 255 - rgb.g, b: 255 - rgb.b };
    case 'sepia':
      return {
        r: clamp255(0.393 * rgb.r + 0.769 * rgb.g + 0.189 * rgb.b),
        g: clamp255(0.349 * rgb.r + 0.686 * rgb.g + 0.168 * rgb.b),
        b: clamp255(0.272 * rgb.r + 0.534 * rgb.g + 0.131 * rgb.b),
      };
    case 'threshold': {
      const v = luma(rgb) >= scheme.cutoff ? 255 : 0;
      return { r: v, g: v, b: v };
    }
    case 'hue': {
      // Luma-preserving hue rotation matrix (same coefficients as SVG
      // feColorMatrix type="hueRotate"). deg -> radians.
      const a = (scheme.deg * Math.PI) / 180;
      const c = Math.cos(a);
      const s = Math.sin(a);
      return {
        r: clamp255(
          (0.213 + c * 0.787 - s * 0.213) * rgb.r +
          (0.715 - c * 0.715 - s * 0.715) * rgb.g +
          (0.072 - c * 0.072 + s * 0.928) * rgb.b),
        g: clamp255(
          (0.213 - c * 0.213 + s * 0.143) * rgb.r +
          (0.715 + c * 0.285 + s * 0.140) * rgb.g +
          (0.072 - c * 0.072 - s * 0.283) * rgb.b),
        b: clamp255(
          (0.213 - c * 0.213 - s * 0.787) * rgb.r +
          (0.715 - c * 0.715 + s * 0.715) * rgb.g +
          (0.072 + c * 0.928 + s * 0.072) * rgb.b),
      };
    }
    case 'posterize': {
      const n = Math.max(2, scheme.levels) - 1;
      const band = (v: number) => clamp255((Math.round((v / 255) * n) / n) * 255);
      return { r: band(rgb.r), g: band(rgb.g), b: band(rgb.b) };
    }
    case 'duotone': {
      const t = luma(rgb);
      return {
        r: clamp255(lerp(scheme.dark.r, scheme.light.r, t)),
        g: clamp255(lerp(scheme.dark.g, scheme.light.g, t)),
        b: clamp255(lerp(scheme.dark.b, scheme.light.b, t)),
      };
    }
    case 'tritone': {
      // 3-stop gradient map: dark -> mid over the lower half of luma, mid ->
      // light over the upper half. duotone with a third anchor for richer ramps.
      const t = luma(rgb);
      const seg = (a: RGB, b: RGB, u: number): RGB => ({
        r: clamp255(lerp(a.r, b.r, u)),
        g: clamp255(lerp(a.g, b.g, u)),
        b: clamp255(lerp(a.b, b.b, u)),
      });
      return t < 0.5
        ? seg(scheme.dark, scheme.mid, t * 2)
        : seg(scheme.mid, scheme.light, (t - 0.5) * 2);
    }
    case 'gradient': {
      if (scheme.stops.length === 0) return rgb;
      return gradientAt(scheme.stops, luma(rgb));
    }
    case 'solarize': {
      // invert only the channels brighter than cutoff — the darkroom/psychedelic
      // tone reversal in the highlights.
      const c = scheme.cutoff * 255;
      const f = (v: number) => (v > c ? 255 - v : v);
      return { r: f(rgb.r), g: f(rgb.g), b: f(rgb.b) };
    }
    case 'channelswap': {
      // order is a permutation of 'rgb' naming which source channel feeds each
      // output channel — instant alien palettes for ~free.
      const o = scheme.order;
      const pick = (ch: string) => (ch === 'r' ? rgb.r : ch === 'g' ? rgb.g : rgb.b);
      return { r: pick(o[0]), g: pick(o[1]), b: pick(o[2]) };
    }
    case 'palette': {
      // ponytail: nearest by squared RGB distance — perceptually off. Lab/OKLab
      // if it ever matters; not now.
      if (scheme.colors.length === 0) return rgb;
      let best = scheme.colors[0];
      let bestD = Infinity;
      for (const c of scheme.colors) {
        const d = (c.r - rgb.r) ** 2 + (c.g - rgb.g) ** 2 + (c.b - rgb.b) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      return best;
    }
  }
}
