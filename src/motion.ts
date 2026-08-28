import type { Cell } from './sample.ts';
import type { Settings } from './settings.ts';

export type Motion = 'none' | 'wiggle' | 'swing' | 'spin' | 'pulse' | 'bob' | 'shimmer'
  | 'shake' | 'flip' | 'huecycle';
export type StaggerMode = 'none' | 'ripple' | 'radial' | 'sweep' | 'brightness' | 'random';

const r2 = (n: number) => Math.round(n * 100) / 100;

// Motions whose magnitude `--amp` scales for "react to image". spin is excluded (a
// partial rotation wouldn't return to 0 -> a broken loop) and shimmer is opacity,
// not a transform. The keyframes for these multiply their reach by var(--amp,1), so
// an element with no --amp (react off, or spin/shimmer) animates at FULL reach,
// byte-identical to before.
// shake's jitter magnitude scales with amp; flip/spin are full 360° rotations whose
// amp-scaling would break the seamless loop (like spin), and huecycle is colour.
export const AMPLITUDE_MOTIONS = new Set<Motion>(['wiggle', 'swing', 'pulse', 'bob', 'shake']);

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
  // shake: a fast nervous jitter (translate + a touch of rotate), amplitude-scaled.
  shake: { frames: '0%,100%{transform:translate(calc(-8%*var(--amp,1)),0)}25%{transform:translate(0,calc(6%*var(--amp,1))) rotate(calc(2deg*var(--amp,1)))}50%{transform:translate(calc(8%*var(--amp,1)),0)}75%{transform:translate(0,calc(-6%*var(--amp,1))) rotate(calc(-2deg*var(--amp,1)))}', origin: 'center' },
  // flip: a 3D card-flip about the vertical axis. perspective lives in the transform
  // so it reads as 3D without restructuring the .motion class. Full 360 -> seamless.
  flip: { frames: '0%{transform:perspective(220px) rotateY(0)}100%{transform:perspective(220px) rotateY(360deg)}', origin: 'center' },
  // huecycle: every icon cycles the colour wheel. A FILTER animation (not a transform)
  // — see motionStyle for its separate keyframes + the filter-only base rule.
  huecycle: { frames: '0%{filter:hue-rotate(0)}100%{filter:hue-rotate(360deg)}', origin: 'center' },
};

/** The <style> block for the selected motion, or '' for none (no regression). */
export function motionStyle(settings: Settings): string {
  if (settings.motion === 'none') return '';
  const { frames, origin } = KEYFRAMES[settings.motion];
  const period = r2(settings.motionSpeed);
  // Continuous full-cycle motions (spin/flip/huecycle) want LINEAR timing so the
  // loop doesn't stutter at the 0/100% seam; the back-and-forth ones want ease.
  const linear = settings.motion === 'spin' || settings.motion === 'flip' || settings.motion === 'huecycle';
  const timing = linear ? 'linear' : 'ease-in-out';
  // huecycle animates `filter`, not a transform: no pivot, promote filter instead.
  const base = settings.motion === 'huecycle'
    ? `.motion{will-change:filter;animation:mo ${period}s ${timing} infinite}`
    // will-change:transform GPU-promotes each animated element so the browser caches
    // its raster and moves/scales the cached bitmap instead of re-rasterizing every
    // frame. transform-box:fill-box makes each icon pivot around its OWN box.
    // Do NOT be tempted to drop this at high cell counts on the theory that ten
    // thousand promoted layers must cost more than they save. Measured on a
    // 4x-throttled CPU (a stand-in for a weak machine), removing it made the
    // 100-column animated grid 35 to 45 percent SLOWER across three runs, against
    // a control whose noise floor was ~2 percent. It pays for itself well past the
    // point where the guess says otherwise.
    : `.motion{transform-box:fill-box;transform-origin:${origin};will-change:transform;` +
      `animation:mo ${period}s ${timing} infinite}`;
  return (
    `<style>` +
    `@keyframes mo{${frames}}` +
    base +
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

/** Emits one cell's motion attributes. Built once per render by motionEmitter. */
export type MotionEmitter = (cell: Cell, index: number) => string;

/**
 * Build the per-cell motion attribute writer ONCE for a whole grid, or null when
 * motion is off (callers then emit the bare body, output unchanged).
 *
 * Everything that depends only on the settings and the grid shape resolves here:
 * the stagger mode, the radial normaliser, whether "react to image" applies. The
 * old per-cell path re-derived all of that (plus an array + filter + join for two
 * declarations) for every cell, which a 100-column mosaic pays ~10,000 times.
 * Emits byte-identical markup to the per-cell version it replaces.
 */
export function motionEmitter(settings: Settings, cols: number, rows: number): MotionEmitter | null {
  if (settings.motion === 'none') return null;
  const period = settings.motionSpeed;
  const mode = settings.staggerMode;
  // "react to image" only means anything for the amplitude motions; resolve the
  // Set lookup once rather than per cell.
  const reactive = settings.motionReactive && AMPLITUDE_MOTIONS.has(settings.motion);
  // radial's centre + max corner distance, and ripple's per-step scale, are grid
  // constants. Divisions stay inside the closure exactly as they were, so the
  // floating-point result is bit-for-bit what the per-cell version produced.
  const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
  const maxD = Math.hypot(cx, cy) || 1;
  const rippleK = period * 0.04;
  const wide = cols > 1;
  const lastCol = cols - 1;

  return (cell: Cell, index: number): string => {
    let delay: number;
    switch (mode) {
      case 'ripple': delay = r2((cell.col + cell.row) * rippleK); break;
      case 'radial': delay = r2((Math.hypot(cell.col - cx, cell.row - cy) / maxD) * period); break;
      case 'sweep': delay = r2((wide ? cell.col / lastCol : 0) * period); break;
      case 'brightness': delay = r2(cell.brightness * period); break;
      case 'random': delay = r2(hash01(index) * period); break;
      case 'none':
      default: delay = 0;
    }
    // Two optional declarations, concatenated directly: the array-of-strings +
    // filter + join this replaces allocated three objects per cell.
    let decls = delay ? `animation-delay:${delay}s` : '';
    if (reactive) {
      const amp = r2(0.15 + 0.85 * cell.brightness);
      decls = decls ? `${decls};--amp:${amp}` : `--amp:${amp}`;
    }
    return decls ? ` class="motion" style="${decls}"` : ' class="motion"';
  };
}
