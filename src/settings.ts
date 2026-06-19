import type { Scheme } from './color.ts';

export type Settings = {
  cols: number; // grid columns; rows derived from image aspect ratio
  tintMode: 'fill' | 'filter';
  sizeByBrightness: boolean; // scale each icon by cell brightness when true
  sizeRange: [number, number]; // min..max scale factor when sizeByBrightness
  background: string; // CSS color the source is composited onto; sets CMY floor
  layered: boolean; // false -> solid-tint path; true -> CMY-stack per cell
  layerCount: 2 | 3; // inks to stack (3 = CMY, 2 = CM)
  layerOffset: number; // px chromatic-aberration nudge; 0 = concentric
  scheme: Scheme; // remap each cell color upstream of solid/layered
};

export const defaults: Settings = {
  cols: 32,
  tintMode: 'filter', // works on any SVG; 'fill' is opt-in for currentColor art
  sizeByBrightness: false,
  sizeRange: [0.3, 1],
  background: '#ffffff',
  layered: false,
  layerCount: 3,
  layerOffset: 0,
  scheme: { kind: 'none' },
};
