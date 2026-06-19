export type Settings = {
  cols: number; // grid columns; rows derived from image aspect ratio
  // (more fields land in later phases — see guidance/batch-02.md)
};

export const defaults: Settings = { cols: 32 };
