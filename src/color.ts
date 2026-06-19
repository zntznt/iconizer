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
  | { kind: 'posterize'; levels: number }
  | { kind: 'duotone'; dark: RGB; light: RGB }
  | { kind: 'palette'; colors: RGB[] };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

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
