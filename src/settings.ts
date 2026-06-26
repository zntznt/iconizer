import type { Scheme, Adjust, Overlay } from './color.ts';
import { NEUTRAL_ADJUST } from './color.ts';
import type { Motion, StaggerMode } from './motion.ts';

export type Settings = {
  cols: number; // grid columns; rows derived from image aspect ratio
  blockSize: number; // merge NxN sample cells into 1 averaged icon; 1 = off
  iconScale: number; // global icon size multiplier; >1 = icons overlap their cell
  sizeByBrightness: boolean; // scale each icon by cell brightness when true
  sizeRange: [number, number]; // min..max scale factor when sizeByBrightness
  // Per-cell rotation. 'fixed' = every icon at rotateDeg; 'brightness' = angle
  // tracks tone (an orientation field); 'jitter' = deterministic ±rotateDeg
  // scatter (sticker-bomb). Composes over size, layering, and motion.
  rotate: 'none' | 'fixed' | 'brightness' | 'jitter';
  rotateDeg: number; // degrees; role depends on rotate mode (see above)
  fadeByBrightness: boolean; // ramp each icon's opacity by cell brightness
  fadeRange: [number, number]; // opacity min..max mapped over brightness (0..1)
  background: string; // CSS color the source is composited onto; sets CMY floor
  layered: boolean; // false -> solid-tint path; true -> per-cell layered stack
  // The "3D glasses" split styles. Subtractive (multiply over white):
  //   cmy  — cyan/magenta/yellow inks   cmyk — + a black ink for deeper shadows
  //   ryb  — warmer artist primaries (red/yellow/blue)
  //   halftone — cmyk, each ink rotated to its print screen angle (rosette w/ offset)
  // Additive (screen over black):
  //   rgb       — red/green/blue subpixels    anaglyph — red+cyan 3D-glasses ghosts
  layerStyle: 'cmy' | 'cmyk' | 'ryb' | 'rgb' | 'anaglyph' | 'halftone';
  layerCount: 2 | 3; // cmy/ryb only: inks to stack (3 = full, 2 = drop the last)
  layerOffset: number; // px chromatic-aberration nudge; 0 = concentric
  // Layered only: draw each ink channel with a DIFFERENT uploaded icon (ink 0 ->
  // icon 0, ink 1 -> icon 1, ...) instead of N copies of the cell's one icon. Fewer
  // icons than inks -> the missing channels fall back to the cell's normal pick, so
  // a single icon renders exactly as before. Misregistration gains personality.
  perChannelIcons: boolean;
  adjust: Adjust; // pre-scheme tonal/colour tweak (brightness/contrast/sat/temp)
  colorJitter: number; // 0..1 per-cell hue/sat scatter (deterministic, from cell hash); 0 = off
  iconMetric: 'brightness' | 'hue'; // which cell channel picks the tile from the icon list
  scheme: Scheme; // remap each cell color upstream of solid/layered
  dither: boolean; // ordered (Bayer) dither under quantising schemes
  ditherStrength: number; // 0..1 dither spread
  overlay: Overlay; // post-scheme gradient wash across the grid
  motion: Motion; // CSS-keyframe animation baked into the SVG; 'none' = static
  motionSpeed: number; // animation period in seconds
  staggerMode: StaggerMode; // per-cell animation-delay pattern
  // "React to image": scale each cell's motion AMPLITUDE by its brightness, so bright
  // cells swing/bob/pulse harder and dark cells barely move — the animation traces the
  // picture. Applies to amplitude motions (wiggle/swing/pulse/bob); spin/shimmer ignore
  // it (a partial spin breaks the loop; shimmer is opacity, not a transform).
  motionReactive: boolean;
  // (layered motion always animates the cell as one unit — see render.ts; the old
  //  per-layer 'apart' mode broke the multiply blend and was removed.)
};

export const defaults: Settings = {
  cols: 32,
  blockSize: 1,
  iconScale: 1,
  sizeByBrightness: false,
  sizeRange: [0.3, 1],
  rotate: 'none',
  rotateDeg: 45,
  fadeByBrightness: false,
  fadeRange: [0.25, 1],
  background: '#0d120d', // off-CRT dark phosphor (not pure black) — reads as an idle tube
  layered: false,
  layerStyle: 'cmy',
  layerCount: 3,
  layerOffset: 0,
  perChannelIcons: false,
  adjust: { ...NEUTRAL_ADJUST },
  colorJitter: 0,
  iconMetric: 'brightness',
  scheme: { kind: 'none' },
  dither: false,
  ditherStrength: 0.5,
  overlay: { dir: 'none', preset: 'vaporwave', blend: 'mix', strength: 0.5 },
  motion: 'none',
  motionSpeed: 1.5,
  staggerMode: 'ripple',
  motionReactive: false,
};
