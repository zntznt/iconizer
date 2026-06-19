export type Settings = {
  cols: number; // grid columns; rows derived from image aspect ratio
  tintMode: 'fill' | 'filter';
  sizeByBrightness: boolean; // scale each icon by cell brightness when true
  sizeRange: [number, number]; // min..max scale factor when sizeByBrightness
  // (more fields land in later phases)
};

export const defaults: Settings = {
  cols: 32,
  tintMode: 'fill',
  sizeByBrightness: false,
  sizeRange: [0.3, 1],
};
