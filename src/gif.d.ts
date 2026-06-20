// Minimal types for gif.js (no official types) + Vite's ?url import suffix.
declare module 'gif.js' {
  interface GifOpts {
    workers?: number; quality?: number; width?: number; height?: number;
    workerScript?: string; repeat?: number;
  }
  interface FrameOpts { delay?: number; copy?: boolean }
  export default class GIF {
    constructor(opts?: GifOpts);
    addFrame(image: ImageData | CanvasImageSource, opts?: FrameOpts): void;
    on(event: 'finished', cb: (blob: Blob) => void): void;
    on(event: 'abort' | 'progress', cb: (arg?: unknown) => void): void;
    render(): void;
  }
}
declare module '*?url' {
  const url: string;
  export default url;
}
declare module '*?raw' {
  const src: string;
  export default src;
}
