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
  | { kind: 'palette'; colors: RGB[] };

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
