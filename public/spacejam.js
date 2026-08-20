// Iconizer — MOIRÉ RIPPLES backdrop (p5.js INSTANCE MODE, behind all UI).
// Loaded in index.html as plain (non-module) scripts, after the p5 CDN tag.
// Self-mounts a fixed full-viewport <canvas>, z-index:-3, pointer-events:none.
//
// >>> Full design rationale + tuning guide: guidance/moire-backdrop.md <<<
//
// THE FIELD: two sets of concentric rings centered at two slowly-orbiting points
// (like two stones dropped in a pond). Drawn with ADDITIVE blending, their overlap
// interferes into big sweeping curved MOIRÉ fringe arcs — real interference, not a
// faked texture, and unmistakably NOT a grid. One cohesive full-bleed surface: the
// rings cover the whole viewport, dimmed (not masked) behind the center content, so
// there is no dead hole and no symmetry (the centers orbit, so the fringe crawls).
//
// COLOR follows the user's work: main.ts dispatches the fresh mosaic markup after
// each redraw (iconizer:render) and we sample its dominant hue on an idle tick;
// set A paints in that hue's COMPLEMENT, set B in the hue itself — two disciplined
// colors that bloom toward white only where they overlap. Grayscale renders (no
// meaningful hue) fall back to the default cyan/magenta.
//
// INTERACTION (canvas is pointer-events:none — we read window pointer/touch and do
// all math in draw()). Four behaviours, each acting on the SAME rings — NOT overlays:
//   1) LENS WARP   — rings near the cursor nudge radially (a soft refraction).
//   2) FREQUENCY PULSE — a click/tap fires a traveling ring that brightens the
//      rings it sweeps (heat), rippling a bright band outward.
//   3) FLOW TILT   — a fast drag nudges the centers' separation, reshaping the
//      fringe; eases back at rest.
//   4) HEAT BLOOM  — rings under the cursor brighten + shift toward their partner
//      hue, so the brightest thing on screen is where you point. Idle = a calm
//      breathing pattern that never competes with the UI.
// All four freeze under prefers-reduced-motion and pause on hidden/export.
// A dev-only slider panel mounts when the URL has ?tune (never in production).
(function () {
  const RING_W = 720;        // centered content width (matches CSS .ringbox max-width)
  const mq = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false, addEventListener() {}, addListener() {} };

  // ---- palette sampler: dominant hue of #out's mosaic -> [primary, complement].
  // Pure + DOM-read only on render change (MutationObserver), never per frame.
  // Returns null when the render is (near-)grayscale so the field keeps its
  // default neon duo rather than complementing a meaningless hue.
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0; const l = (mx + mn) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (d !== 0) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    let r, g, b;
    if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x]; else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  // Dominant hue via a coarse 12-bucket histogram weighted by saturation*count.
  // Skips near-gray pixels. Returns hue in [0,360) or null if too little color.
  function dominantHue(svgText) {
    const buckets = new Array(12).fill(0);
    let colored = 0, total = 0;
    // first fill="rgb(...)" is usually the bg rect; we keep all, the histogram
    // washes out a single bg sample against hundreds of cells.
    const re = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/g;
    let m;
    while ((m = re.exec(svgText))) {
      total++;
      const [h, s] = rgbToHsl(+m[1], +m[2], +m[3]);
      if (s < 0.18) continue;             // near-gray -> no usable hue
      colored++;
      buckets[Math.floor(h / 30) % 12] += s; // weight by saturation
    }
    if (!total || colored / total < 0.12) return null; // mostly grayscale render
    let bi = 0, bv = -1;
    for (let i = 0; i < 12; i++) if (buckets[i] > bv) { bv = buckets[i]; bi = i; }
    return bi * 30 + 15;                   // bucket center
  }

  const sketch = (p) => {
    let famA = [], famB = [];            // ring-index lists for the two ripple centers
    let t = 0;                           // logical seconds; advances only when live
    let reduce = mq.matches;
    let exporting = false;               // paused while a raster export runs
    const FPS = 30;

    // ---- pointer state (window listeners fill it; draw() consumes it) ----
    const ptr = { px: -1, py: -1, has: false, active: false, lastMove: -10, vx: 0, vy: 0, lpx: -1, lpy: -1 };
    let pulses = [];                     // {cx,cy,born} traveling brightness rings (click)
    let tilt = 0;                        // eased separation nudge from drag velocity
    const R = 150;                       // lens / heat radius
    // Slack on the off-screen ring cull in drawRipple: covers the 1px stroke's
    // inner half, the polyline's chord sag at the 160-segment cap, and the largest
    // inward lens nudge a ring can take (bounded by R * LENS * 0.6).
    const CULL_PAD = 12;
    const LENS = 0.07;                   // lens push strength — a soft nudge, not a bulge
    const PULSE_SPD = 520, PULSE_MAX = 3;

    // ---- palette: [primary rgb, complement rgb], eased toward targets ----
    const PAL_DEFAULT = { hue: 186 };    // cyan-ish default; complement ~ magenta
    let palP = [22, 214, 230], palC = [230, 22, 128];        // current (lerped)
    let tgtP = [22, 214, 230], tgtC = [230, 22, 128];        // targets from #out
    function setPaletteFromHue(hue) {
      const h = hue == null ? PAL_DEFAULT.hue : hue;
      tgtP = hslToRgb(h, 0.85, 0.55);
      tgtC = hslToRgb((h + 180) % 360, 0.85, 0.6);
    }
    function easePalette() {             // ~0.5s glide so recolors aren't abrupt
      for (let i = 0; i < 3; i++) {
        palP[i] += (tgtP[i] - palP[i]) * 0.06;
        palC[i] += (tgtC[i] - palC[i]) * 0.06;
      }
    }

    const BG = [6, 8, 10];
    const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

    // center-dim: lines pass THROUGH the content column but at ~0.4x alpha there,
    // ramping to 1 at the edges. Smooth ellipse, evaluated per-line (not vertex).
    function centerDim(x, y) {
      const cx = p.width / 2, cy = p.height / 2;
      const rx = (RING_W + 80) / 2, ry = p.height * 0.42;
      const u = Math.min(1, Math.hypot((x - cx) / rx, (y - cy) / ry)); // 0 center -> 1 at ellipse edge
      const s = u * u * (3 - 2 * u);      // smoothstep
      return 0.22 + 0.78 * s;             // ~0.22x behind the UI (calm), full at edges
    }

    // TRUE MOIRÉ via OVERLAPPING RIPPLES: two sets of concentric rings centered at
    // two different points (like two stones dropped in a pond). Where the ring sets
    // overlap, their interference makes big sweeping CURVED fringe bands — the most
    // unmistakable, iconic moiré, never readable as a grid. The two centers slowly
    // orbit so the fringes crawl. Each "ring" is one radius value; drawn as a circle
    // polyline, deformed locally near the cursor. Ring spacing = the grating pitch.
    let ringPitch = 26;                  // px between adjacent rings (finer = denser moiré)
    let ringCount = 40;
    // ---- live-tunable knobs (defaults; a ?tune panel can override at runtime) ----
    const TUNE = {
      density: 24,    // base ring pitch in px before area-scale (lower = denser)
      motion: 1.0,    // multiplier on orbit + breath speed
      sep: 0.26,      // base separation of the two ripple centers (fraction of width)
    };
    function buildFamilies() {
      const area = p.width * p.height;
      const k = Math.min(1.4, Math.max(0.9, area / 1500000));
      ringPitch = Math.max(14, Math.round(TUNE.density / k));
      // diagonal-many rings is the safe UPPER bound (it covers any center
      // position); drawRipple culls that down per frame to the rings the current
      // centers can actually put on screen.
      const diag = Math.hypot(p.width, p.height);
      ringCount = Math.ceil(diag / ringPitch) + 2;
      // famA / famB are just the ring index lists for each center.
      famA = []; famB = [];
      for (let i = 1; i <= ringCount; i++) { famA.push({ idx: i }); famB.push({ idx: i }); }
    }

    // ---- pointer wiring (window-level; canvas can't be hit) ----
    function onMove(cx, cy) {
      if (reduce) { ptr.px = cx; ptr.py = cy; ptr.has = true; if (!p.isLooping()) p.redraw(); return; }
      if (ptr.lpx >= 0) { ptr.vx = cx - ptr.lpx; ptr.vy = cy - ptr.lpy; }
      ptr.lpx = cx; ptr.lpy = cy;
      ptr.px = cx; ptr.py = cy; ptr.has = true; ptr.active = true; ptr.lastMove = t;
    }
    function onTap(cx, cy) {
      if (reduce) return;
      onMove(cx, cy);
      if (pulses.length >= PULSE_MAX) pulses.shift();
      pulses.push({ cx, cy, born: t });
    }
    function wirePointer() {
      window.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY), { passive: true });
      window.addEventListener('pointerdown', (e) => onTap(e.clientX, e.clientY), { passive: true });
      document.addEventListener('pointerleave', () => { ptr.active = false; }, { passive: true });
      window.addEventListener('touchstart', (e) => {
        const tc = e.touches && e.touches[0]; if (tc) onTap(tc.clientX, tc.clientY);
      }, { passive: true });
    }

    // ---- palette wiring: main.ts hands us the render string after each redraw.
    // (A MutationObserver reading #out's innerHTML back forced the browser to
    // re-serialize 10k+ freshly laid-out nodes; the string already exists in
    // main.ts.) The scan itself waits for an idle tick so it never lands in the
    // same frame as the mosaic's layout; only the newest markup is scanned.
    function wirePalette() {
      setPaletteFromHue(null);
      const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 60));
      let pending = '', queued = false;
      document.addEventListener('iconizer:render', (e) => {
        pending = (e.detail && e.detail.svg) || '';
        if (queued) return;
        queued = true;
        idle(() => {
          queued = false;
          setPaletteFromHue(dominantHue(pending));
          if (reduce) p.redraw();
        });
      });
    }

    // DEV-ONLY: a tiny slider panel (only when the URL has ?tune) to dial the three
    // knobs live. Never mounts in production. Logs the chosen values to the console.
    function mountTunePanel() {
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;right:8px;top:40px;z-index:9999;background:#000c;color:#0ff;font:11px monospace;padding:8px;border:1px solid #0ff;pointer-events:auto;width:190px';
      const mk = (label, key, min, max, step) => {
        const row = document.createElement('div'); row.style.marginBottom = '6px';
        const out = document.createElement('span');
        const inp = document.createElement('input');
        inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = TUNE[key];
        inp.style.width = '100%';
        out.textContent = `${label}: ${TUNE[key]}`;
        inp.oninput = () => {
          TUNE[key] = parseFloat(inp.value); out.textContent = `${label}: ${TUNE[key]}`;
          if (key === 'density') buildFamilies();         // density changes ring set
          console.log('[tune]', JSON.stringify(TUNE));
        };
        row.appendChild(out); row.appendChild(inp); return row;
      };
      box.appendChild(mk('density (px, lower=denser)', 'density', 12, 48, 1));
      box.appendChild(mk('motion (speed)', 'motion', 0, 3, 0.1));
      box.appendChild(mk('separation (arc width)', 'sep', 0.1, 0.6, 0.01));
      const note = document.createElement('div'); note.style.color = '#888';
      note.textContent = 'values logged to console';
      box.appendChild(note);
      document.body.appendChild(box);
    }

    p.setup = function () {
      const c = p.createCanvas(window.innerWidth, window.innerHeight);
      c.id('sj-bg');
      const el = c.elt;
      el.style.position = 'fixed'; el.style.inset = '0';
      el.style.zIndex = '-3'; el.style.pointerEvents = 'none'; el.style.display = 'block';
      p.pixelDensity(dpr());
      buildFamilies();
      wirePointer(); wirePalette();
      if (location.search.includes('tune')) mountTunePanel();  // dev-only sliders
      p.frameRate(reduce ? 1 : FPS);
      if (reduce) { p.redraw(); p.noLoop(); }
      const onMq = (e) => {
        reduce = e.matches;
        if (reduce) { pulses = []; tilt = 0; p.frameRate(1); p.redraw(); p.noLoop(); }
        else if (!document.hidden && !exporting) { p.frameRate(FPS); p.loop(); }
      };
      if (mq.addEventListener) mq.addEventListener('change', onMq);
      else mq.addListener(onMq); // pre-2019 Safari fallback
      const sync = () => {
        if (reduce || document.hidden || exporting) p.noLoop();
        else { p.frameRate(FPS); p.loop(); }
      };
      document.addEventListener('iconizer:export', (e) => {
        exporting = !!(e.detail && e.detail.busy); sync();
      });
      document.addEventListener('visibilitychange', sync);
    };

    p.windowResized = function () {
      p.resizeCanvas(window.innerWidth, window.innerHeight);
      p.pixelDensity(dpr());
      buildFamilies();
      if (reduce) p.redraw();
    };

    // velocity-driven angle nudge, eased; decays to 0 at rest. Drag tilts the
    // gratings, which shifts the moiré beat orientation.
    function updateTilt() {
      const live = ptr.has && ptr.active && (t - ptr.lastMove) < 0.4;
      const speed = live ? Math.hypot(ptr.vx, ptr.vy) : 0;
      const target = speed > 4 ? Math.max(-0.18, Math.min(0.18, Math.atan2(ptr.vy, ptr.vx) * Math.min(1, speed / 50) * 0.18)) : 0;
      tilt += (target - tilt) * 0.07;
      ptr.vx *= 0.85; ptr.vy *= 0.85;
    }

    // One ripple set: concentric rings centered at (cx,cy). Each ring is a circle
    // polyline; segment count scales with radius so big rings stay smooth but small
    // ones stay cheap. Rings near the cursor get a gentle radial lens nudge + a heat
    // brightness boost; the traveling pulse brightens rings it sweeps. Color is the
    // family hue, accented toward its partner under heat; additive blend means where
    // THIS ripple set overlaps the OTHER, brightness adds -> the moiré fringe arcs.
    function drawRipple(rings, cx, cy, base, accentToward, lensOn, px, py) {
      // OFF-SCREEN CULL. buildFamilies sizes the ring set off the full viewport
      // DIAGONAL so that any center position stays covered, but both centers only
      // ever orbit near the middle, so the outer ~40% of every family is a circle
      // that fully ENCLOSES the viewport: its stroke lands entirely off-canvas and
      // paints nothing, yet each one still runs the full 160-segment vertex loop,
      // 30 times a second, behind every slider drag and every mirror frame. The
      // real ceiling is THIS center's distance to the farthest viewport corner
      // (max distance to a rectangle is always at a corner). Recomputed per frame
      // so it tracks the orbiting centers and the drag tilt on its own.
      // The old guard here compared against ringCount * ringPitch, which rad0 can
      // never exceed, so it never skipped anything.
      const maxR = Math.max(
        Math.hypot(cx, cy),
        Math.hypot(p.width - cx, cy),
        Math.hypot(cx, p.height - cy),
        Math.hypot(p.width - cx, p.height - cy),
      ) + CULL_PAD;
      const dim = centerDim(cx, cy);     // ripple-center based dim (whole set shares)
      const curDist = lensOn ? Math.hypot(px - cx, py - cy) : 0; // cursor->center, same for every ring
      for (const rg of rings) {
        const rad0 = rg.idx * ringPitch;
        if (rad0 > maxR) continue;
        // ring is "near cursor" only if the cursor's distance-to-center is within
        // ringPitch of this ring's radius (a thin annulus test) — cheap reject.
        const lensRing = lensOn && Math.abs(curDist - rad0) < R;

        // HEAT pre-pass (cheap, ring-level): how strongly is this ring lit by the
        // cursor or a pulse? Lens heat = falloff of the closest approach (the point
        // on the ring nearest the cursor). Pulse heat = does a pulse annulus cross
        // this ring's radius near the cursor side. Computed WITHOUT the vertex loop
        // so we can set the stroke color BEFORE drawing the ring.
        let heat = 0;
        if (lensRing) {
          // nearest point on the ring to the cursor is along the center->cursor dir
          const gap = Math.abs(curDist - rad0);   // radial gap from cursor to ring
          if (gap < R) { const f = 1 - (gap * gap) / (R * R); if (f > heat) heat = f; }
        }
        for (const w of pulses) {
          const prad = (t - w.born) * PULSE_SPD;
          const dCenter = Math.hypot(cx - w.cx, cy - w.cy);
          // the ring spans [dCenter-rad0, dCenter+rad0] from the pulse origin; if the
          // pulse radius lands in that band, some of the ring is lit.
          const near = Math.min(Math.abs(prad - Math.abs(dCenter - rad0)), Math.abs(prad - (dCenter + rad0)));
          const env = 1 - Math.min(1, near / 70);
          if (env > 0) { const e = env * env * 0.8; if (e > heat) heat = e; }
        }

        const r = base[0] + (accentToward[0] - base[0]) * heat * 0.6;
        const g = base[1] + (accentToward[1] - base[1]) * heat * 0.6;
        const b = base[2] + (accentToward[2] - base[2]) * heat * 0.6;
        p.stroke(r, g, b, (90 + 120 * heat) * dim);

        // segment count: ~ every 14px around the circumference, clamped.
        const nSeg = Math.max(24, Math.min(160, Math.round((2 * Math.PI * rad0) / 14)));
        p.beginShape();
        for (let s = 0; s <= nSeg; s++) {
          const a = (s / nSeg) * Math.PI * 2;
          const ca = Math.cos(a), sa = Math.sin(a);
          let x = cx + ca * rad0;
          let y = cy + sa * rad0;
          if (lensRing && heat > 0) {
            // radial lens nudge near the cursor (a clean refraction, no bulge)
            const dx = x - px, dy = y - py, d2 = dx * dx + dy * dy;
            if (d2 < R * R) {
              const f = 1 - d2 / (R * R);
              x += ca * (curDist - rad0) * f * LENS * 0.6;
              y += sa * (curDist - rad0) * f * LENS * 0.6;
            }
          }
          p.vertex(x, y);
        }
        p.endShape();
      }
    }

    p.draw = function () {
      if (document.hidden) return;
      if (!reduce) { t += p.deltaTime / 1000; updateTilt(); }
      easePalette();
      p.background(BG[0], BG[1], BG[2]);
      p.noFill(); p.strokeWeight(1);
      // ADDITIVE blend: where the two ripple sets overlap, light adds -> the moiré
      // fringe ARCS emerge. This is what makes overlapping rings read as interference.
      const dc = p.drawingContext;
      const prevComp = dc.globalCompositeOperation;
      dc.globalCompositeOperation = 'lighter';

      const W = p.width, H = p.height;
      pulses = pulses.filter((w) => (t - w.born) * PULSE_SPD < Math.hypot(W, H) + 80);
      const lensOn = !reduce && ptr.has && ptr.active && (t - ptr.lastMove) < 1.2;
      const px = ptr.px, py = ptr.py;

      // The two ripple CENTERS slowly orbit in opposite directions around the middle.
      // Their changing separation is what sweeps the moiré fringes across the screen —
      // the closer/farther the two "stones", the wider/tighter the interference arcs.
      // tilt (drag velocity) nudges the separation so a fast drag reshapes the fringe.
      const orbit = reduce ? 0 : t * 0.07 * TUNE.motion;
      const sep = (TUNE.sep + 0.06 * Math.sin(t * 0.13 * TUNE.motion)) * W + tilt * 240; // breathing gap
      const cxA = W / 2 + Math.cos(orbit) * sep * 0.5;
      const cyA = H / 2 + Math.sin(orbit) * sep * 0.28;
      const cxB = W / 2 - Math.cos(orbit) * sep * 0.5;
      const cyB = H / 2 - Math.sin(orbit) * sep * 0.28;

      // Set A in the complement color, B in the primary — exactly two hues; the
      // overlap arcs bloom toward white-ish. Heat accents each toward its partner.
      drawRipple(famA, cxA, cyA, palC, palP, lensOn, px, py);
      drawRipple(famB, cxB, cyB, palP, palC, lensOn, px, py);

      dc.globalCompositeOperation = prevComp;
    };
  };

  function boot() {
    if (typeof p5 === 'undefined') return;   // CDN failed: stay on flat-black body
    new p5(sketch);
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
