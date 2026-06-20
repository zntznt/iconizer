import type { Cell } from './sample.ts';
import type { Settings } from './settings.ts';

export type Motion = 'none' | 'wiggle' | 'swing' | 'spin' | 'pulse' | 'bob' | 'shimmer';
export type StaggerMode = 'none' | 'ripple' | 'brightness' | 'random';

const r2 = (n: number) => Math.round(n * 100) / 100;

// Each motion: its @keyframes body + the transform-origin the pivot needs.
// transform-box:fill-box (in the base class) makes the origin the element's
// own box, so icons pivot IN PLACE instead of flinging around the SVG origin.
const KEYFRAMES: Record<Exclude<Motion, 'none'>, { frames: string; origin: string }> = {
  wiggle: { frames: '0%,100%{transform:rotate(-6deg)}50%{transform:rotate(6deg)}', origin: 'center' },
  swing: { frames: '0%,100%{transform:rotate(-12deg)}50%{transform:rotate(12deg)}', origin: 'top center' },
  spin: { frames: '0%{transform:rotate(0)}100%{transform:rotate(360deg)}', origin: 'center' },
  pulse: { frames: '0%,100%{transform:scale(1)}50%{transform:scale(1.2)}', origin: 'center' },
  bob: { frames: '0%,100%{transform:translateY(0)}50%{transform:translateY(-30%)}', origin: 'center' },
  shimmer: { frames: '0%,100%{opacity:1}50%{opacity:0.4}', origin: 'center' },
};

/** The <style> block for the selected motion, or '' for none (no regression). */
export function motionStyle(settings: Settings): string {
  if (settings.motion === 'none') return '';
  const { frames, origin } = KEYFRAMES[settings.motion];
  const period = r2(settings.motionSpeed);
  return (
    `<style>` +
    `@keyframes mo{${frames}}` +
    // will-change:transform GPU-promotes each animated element so the browser
    // caches its raster and moves/scales the cached bitmap, instead of
    // re-rasterizing every frame. This is what makes scale-based motion (pulse)
    // smooth; without it the browser re-rasterizes each icon crisply per frame.
    `.motion{transform-box:fill-box;transform-origin:${origin};will-change:transform;` +
    `animation:mo ${period}s ease-in-out infinite}` +
    // accessibility: respect the OS reduce-motion setting (non-negotiable).
    `@media (prefers-reduced-motion: reduce){.motion{animation:none!important}}` +
    `</style>`
  );
}

/** Cheap deterministic hash -> [0,1). No Math.random (render() must stay pure). */
const hash01 = (i: number) => ((i * 2654435761) % 1000) / 1000;

/** Per-cell animation-delay (seconds) for the stagger mode. */
export function cellDelay(cell: Cell, index: number, settings: Settings): number {
  const period = settings.motionSpeed;
  switch (settings.staggerMode) {
    case 'ripple':
      // k scales with period so the diagonal wave reads at any speed.
      return r2((cell.col + cell.row) * (period * 0.04));
    case 'brightness':
      return r2(cell.brightness * period);
    case 'random':
      return r2(hash01(index) * period);
    case 'none':
    default:
      return 0;
  }
}

/** class + (optional) animation-delay attrs for an animated element. */
export function motionAttrs(cell: Cell, index: number, settings: Settings): string {
  if (settings.motion === 'none') return '';
  const delay = cellDelay(cell, index, settings);
  const d = delay ? ` style="animation-delay:${delay}s"` : '';
  return ` class="motion"${d}`;
}
