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
  | { kind: 'palette'; colors: RGB[] }
  | { kind: 'gradient'; stops: RGB[] }; // map luma 0..1 across N color stops

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
    case 'gradient': {
      // map luma onto the stop ramp; duotone is the 2-stop case, presets are this.
      const stops = scheme.stops;
      if (stops.length === 0) return rgb;
      if (stops.length === 1) return stops[0];
      const t = luma(rgb) * (stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(t));
      const f = t - i; // position within segment [i, i+1]
      return {
        r: clamp255(lerp(stops[i].r, stops[i + 1].r, f)),
        g: clamp255(lerp(stops[i].g, stops[i + 1].g, f)),
        b: clamp255(lerp(stops[i].b, stops[i + 1].b, f)),
      };
    }
  }
}

/** One-click look presets: gradient-map ramps. Drop straight into settings.scheme. */
export const PRESETS: Record<string, Scheme> = {
  sepia: { kind: 'gradient', stops: [{ r: 40, g: 26, b: 13 }, { r: 112, g: 80, b: 50 }, { r: 230, g: 200, b: 160 }] },
  neon: { kind: 'gradient', stops: [{ r: 10, g: 0, b: 30 }, { r: 200, g: 0, b: 160 }, { r: 0, g: 255, b: 230 }] },
  vaporwave: { kind: 'gradient', stops: [{ r: 30, g: 10, b: 60 }, { r: 255, g: 100, b: 180 }, { r: 120, g: 230, b: 255 }] },
};
