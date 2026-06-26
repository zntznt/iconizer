import type { Cell } from './sample.ts';
import type { Settings } from './settings.ts';

export type Motion = 'none' | 'wiggle' | 'swing' | 'spin' | 'pulse' | 'bob' | 'shimmer';
export type StaggerMode = 'none' | 'ripple' | 'radial' | 'sweep' | 'brightness' | 'random';

const r2 = (n: number) => Math.round(n * 100) / 100;

// Motions whose magnitude `--amp` scales for "react to image". spin is excluded (a
// partial rotation wouldn't return to 0 -> a broken loop) and shimmer is opacity,
// not a transform. The keyframes for these multiply their reach by var(--amp,1), so
// an element with no --amp (react off, or spin/shimmer) animates at FULL reach,
// byte-identical to before.
export const AMPLITUDE_MOTIONS = new Set<Motion>(['wiggle', 'swing', 'pulse', 'bob']);

// Each motion: its @keyframes body + the transform-origin the pivot needs.
// transform-box:fill-box (in the base class) makes the origin the element's
// own box, so icons pivot IN PLACE instead of flinging around the SVG origin.
// Amplitude motions fold var(--amp,1) into their transform magnitude.
const KEYFRAMES: Record<Exclude<Motion, 'none'>, { frames: string; origin: string }> = {
  wiggle: { frames: '0%,100%{transform:rotate(calc(-6deg*var(--amp,1)))}50%{transform:rotate(calc(6deg*var(--amp,1)))}', origin: 'center' },
  swing: { frames: '0%,100%{transform:rotate(calc(-12deg*var(--amp,1)))}50%{transform:rotate(calc(12deg*var(--amp,1)))}', origin: 'top center' },
  spin: { frames: '0%{transform:rotate(0)}100%{transform:rotate(360deg)}', origin: 'center' },
  pulse: { frames: '0%,100%{transform:scale(1)}50%{transform:scale(calc(1 + 0.2*var(--amp,1)))}', origin: 'center' },
  bob: { frames: '0%,100%{transform:translateY(0)}50%{transform:translateY(calc(-30%*var(--amp,1)))}', origin: 'center' },
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

/** Cheap deterministic hash -> [0,1). No Math.random (render() must stay pure).
 *  Shared with render() so jitter rotation scatters from the same seed source. */
export const hash01 = (i: number) => ((i * 2654435761) % 1000) / 1000;

/** Per-cell animation-delay (seconds) for the stagger mode. cols/rows describe the
 *  grid so the field modes (radial/sweep) can place their centre/ramp; they default
 *  to 1 so callers that don't care (and the self-checks) still work — at 1x1 every
 *  mode collapses to 0 delay anyway. */
export function cellDelay(cell: Cell, index: number, settings: Settings, cols = 1, rows = 1): number {
  const period = settings.motionSpeed;
  switch (settings.staggerMode) {
    case 'ripple':
      // k scales with period so the diagonal wave reads at any speed.
      return r2((cell.col + cell.row) * (period * 0.04));
    case 'radial': {
      // a ripple rolling OUT from the image centre, like a stone in a pond. u in
      // 0..1 = distance to centre over the max corner distance; * period reads at
      // any speed (mirrors ripple's "normalize then scale by period" shape).
      const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
      const maxD = Math.hypot(cx, cy) || 1;
      return r2((Math.hypot(cell.col - cx, cell.row - cy) / maxD) * period);
    }
    case 'sweep': {
      // a wipe marching column by column, like an old CRT refresh. u = col ramp.
      const u = cols > 1 ? cell.col / (cols - 1) : 0;
      return r2(u * period);
    }
    case 'brightness':
      return r2(cell.brightness * period);
    case 'random':
      return r2(hash01(index) * period);
    case 'none':
    default:
      return 0;
  }
}

/** Per-cell motion amplitude 0..1 when "react to image" is on for an amplitude
 *  motion: a lerp of brightness floored at 0.15 so dark cells still move a little
 *  (0 would freeze them, reading as broken). Off / spin / shimmer -> null (no --amp,
 *  so the keyframe's var(--amp,1) fallback gives full reach, unchanged output). */
function ampFor(cell: Cell, settings: Settings): number | null {
  if (!settings.motionReactive || !AMPLITUDE_MOTIONS.has(settings.motion)) return null;
  return r2(0.15 + 0.85 * cell.brightness);
}

/** class + (optional) inline style (animation-delay + --amp) for an animated element. */
export function motionAttrs(cell: Cell, index: number, settings: Settings, cols = 1, rows = 1): string {
  if (settings.motion === 'none') return '';
  const delay = cellDelay(cell, index, settings, cols, rows);
  const amp = ampFor(cell, settings);
  const decls = [
    delay ? `animation-delay:${delay}s` : '',
    amp !== null ? `--amp:${amp}` : '',
  ].filter(Boolean).join(';');
  const style = decls ? ` style="${decls}"` : '';
  return ` class="motion"${style}`;
}
