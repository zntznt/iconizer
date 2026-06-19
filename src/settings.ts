import type { Scheme } from './color.ts';
import type { Motion, StaggerMode } from './motion.ts';

export type Settings = {
  cols: number; // grid columns; rows derived from image aspect ratio
  blockSize: number; // merge NxN sample cells into 1 averaged icon; 1 = off
  iconScale: number; // global icon size multiplier; >1 = icons overlap their cell
  sizeByBrightness: boolean; // scale each icon by cell brightness when true
  sizeRange: [number, number]; // min..max scale factor when sizeByBrightness
  background: string; // CSS color the source is composited onto; sets CMY floor
  layered: boolean; // false -> solid-tint path; true -> CMY-stack per cell
  layerCount: 2 | 3; // inks to stack (3 = CMY, 2 = CM)
  layerOffset: number; // px chromatic-aberration nudge; 0 = concentric
  scheme: Scheme; // remap each cell color upstream of solid/layered
  rotateByData: boolean; // static per-cell rotation: brightness -> angle (a swirl)
  jitter: number; // ± degrees of deterministic hand-drawn rotation wobble; 0 = off
  cutout: number; // drop cells brighter than this (0-1); 0 = keep all. transparent bg
  spacing: number; // icon size within its cell (0-1); <1 = gaps. cell pitch unchanged
  layout: 'grid' | 'brick' | 'hex'; // tiling: square, offset-rows, or hex stagger
  motion: Motion; // CSS-keyframe animation baked into the SVG; 'none' = static
  motionSpeed: number; // animation period in seconds
  staggerMode: StaggerMode; // per-cell animation-delay pattern
  // (layered motion always animates the cell as one unit — see render.ts; the old
  //  per-layer 'apart' mode broke the multiply blend and was removed.)
};

export const defaults: Settings = {
  cols: 32,
  blockSize: 1,
  iconScale: 1,
  sizeByBrightness: false,
  sizeRange: [0.3, 1],
  background: '#ffffff',
  layered: false,
  layerCount: 3,
  layerOffset: 0,
  scheme: { kind: 'none' },
  rotateByData: false,
  jitter: 0,
  cutout: 0,
  spacing: 1,
  layout: 'grid',
  motion: 'none',
  motionSpeed: 1.5,
  staggerMode: 'ripple',
};
