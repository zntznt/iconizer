// Iconizer — Space Jam '96 backdrop (p5.js INSTANCE MODE, behind all UI).
// Loaded in index.html as plain (non-module) scripts, after the p5 CDN tag.
// Self-mounts a fixed full-viewport <canvas>, z-index:-3, pointer-events:none.
// ponytail: faithful spacejam.com/1996 — flat black void, square star dots,
//   flat-fill orbiting planets dimmed in the center, loud spinning GIF-like
//   sprites exiled to the L/R gutters beside the centered webring.
//
// INTERACTION (canvas is pointer-events:none, so we read window pointer/touch
// events and do all math in draw()). Four DISTINCT behaviours, each scaled by a
// center-mask so the background never competes with the UI in the middle column:
//   1) PARALLAX LEAN  — pointer move biases the 3 star layers by depth (a global
//      affine offset per layer; no per-star math).
//   2) GRAVITY WELL   — near-layer stars within R of the cursor bow toward it and
//      brighten (localized squared-falloff, gated by a coarse cursor cell; no sqrt).
//   3) CONSTELLATION  — pointer IDLE near a star draws faint cyan webring lines to
//      its nearest neighbors, revealed on the 8fps twinkle clock (graph drawing,
//      triggered by ABSENCE of motion; geometry computed once per idle).
//   4) SHOCKWAVE      — click / tap fires a one-shot expanding magenta annulus that
//      briefly shoves stars it sweeps over (discrete, self-terminating, max 2 live).
// All four are disabled under prefers-reduced-motion and while paused.
(function () {
  const RING_W = 720;        // centered content width (matches CSS .ringbox max-width)
  const MIN_GUTTER = 150;    // a gutter narrower than this => no gutter sprites
  const mq = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false, addEventListener() {}, addListener() {} };

  const sketch = (p) => {
    let far = [], mid = [], near = [];   // 3 parallax star layers
    let planets = [];                    // centered backdrop orbiters (drawn dark)
    let leftSprites = [], rightSprites = []; // loud gutter "GIF" sprites
    let t = 0;                           // logical seconds; advances only when live
    let reduce = mq.matches;
    let exporting = false;               // paused while a raster export runs
    const FPS = 30;                      // 30 reads as motion, halves the GPU vs 60

    // ---- pointer state (filled by window listeners, consumed in draw) ----
    // px/py: smoothed pointer in CSS px. active: pointer seen recently.
    // lastMove: t at last real move (idle = now - lastMove). off[] holds the
    // per-layer parallax offset. waves[] holds live click/tap shockwaves.
    // con: the cached constellation (anchor + segment list) for the idle draw.
    const ptr = { px: -1, py: -1, has: false, active: false, lastMove: -10 };
    const off = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]; // far, mid, near
    let waves = [];
    let con = null;          // { segs:[{ax,ay,bx,by}], born:t } or null
    let conKey = -1;         // anchor star ref guard so we only rebuild on change

    const R_WELL = 160;      // gravity-well radius
    const IDLE_S = 0.9;      // seconds of stillness before a constellation forms
    const NEAR_STAR = 70;    // pointer must rest within this of a star
    const WAVE_SPD = 520;    // shockwave expansion px/s
    const WAVE_MAX = 2;      // cap simultaneous waves (debounced spam)

    const C = {
      star: [255, 255, 255], starDim: [156, 156, 200],
      saturn: [232, 196, 96], saturnRing: [120, 200, 220],
      purple: [150, 70, 210], teal: [40, 200, 190],
      ball: [210, 110, 40], ballLine: [40, 20, 10],
      moon: [255, 0, 255], moonShadow: [0, 0, 128], lime: [57, 255, 20],
      con: [0, 255, 255],   // constellation lines (dimmest neon)
      wave: [255, 0, 255],  // shockwave annulus (hot magenta)
    };
    const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
    const gutterW = () => (window.innerWidth - RING_W) / 2;
    const gutterOn = () => gutterW() >= MIN_GUTTER;

    // center-mask: 0 in the middle content column, ->1 out at the edges/gutters.
    // Keeps every interaction quiet behind the CRT + Win98 windows. Uses a
    // smoothstep on |x - centerX| measured in half-content-widths.
    function edgeMask(x) {
      const half = RING_W / 2;
      const d = Math.abs(x - window.innerWidth / 2);
      const u = Math.min(1, Math.max(0, (d - half) / half)); // 0 inside ring, 1 a ring-width past it
      return u * u * (3 - 2 * u); // smoothstep
    }

    function makeLayer(n, sz, dim) {
      const a = [];
      for (let i = 0; i < n; i++)
        a.push({ x: Math.random() * p.width, y: Math.random() * p.height,
                 s: sz, tw: Math.random() * Math.PI * 2, dim });
      return a;
    }
    function seedStars() {           // fixed budget, scaled by area, capped
      const k = Math.min(1.6, Math.max(0.5, (p.width * p.height) / 1300000));
      far = makeLayer(Math.round(70 * k), 1, true);
      mid = makeLayer(Math.round(45 * k), 1, false);
      near = makeLayer(Math.round(22 * k), 2, false);
      con = null; conKey = -1;       // stars moved => any cached constellation is stale
    }
    function makePlanets() {
      return [
        { kind: 'saturn', cx: 0.50, cy: 0.30, orbit: 70,  rad: 26, spd: 0.05,  ph: 0,   a: 0.5  },
        { kind: 'purple', cx: 0.42, cy: 0.62, orbit: 90,  rad: 20, spd: -0.07, ph: 1.5, a: 0.45 },
        { kind: 'ball',   cx: 0.58, cy: 0.50, orbit: 110, rad: 18, spd: 0.04,  ph: 3.0, a: 0.4  },
      ];
    }
    function makeGutter(side) {
      const kinds = ['saturn', 'ball', 'moon', 'teal'];  // moon = dithered + satellites
      const slots = [0.18, 0.40, 0.62, 0.84];
      const off = side === 'L' ? 0 : 2;
      return slots.map((vy, i) => ({
        kind: kinds[(i + off) % kinds.length],
        vy, rad: 28 + (i % 2) * 10,
        spin: (i % 2 ? 1 : -1) * (0.5 + Math.random() * 0.4),
        bobAmp: 8 + Math.random() * 8, bobSpd: 0.6 + Math.random() * 0.5,
        ph: Math.random() * Math.PI * 2, ringTilt: 0.3 + Math.random() * 0.5,
      }));
    }
    function rebuildGutters() {
      if (gutterOn()) { leftSprites = makeGutter('L'); rightSprites = makeGutter('R'); }
      else { leftSprites = []; rightSprites = []; }
    }

    // ---- pointer wiring: listen on window since the canvas can't be hit ----
    function onMove(cx, cy) {
      if (reduce) return;
      ptr.px = cx; ptr.py = cy; ptr.has = true; ptr.active = true;
      ptr.lastMove = t;
      con = null; conKey = -1;       // any movement dissolves the constellation
    }
    function onTap(cx, cy) {
      if (reduce) return;
      onMove(cx, cy);                // a tap also positions the pointer
      if (edgeMask(cx) < 0.04) return;        // suppress taps over the content column
      if (waves.length >= WAVE_MAX) waves.shift(); // debounce: drop the oldest
      waves.push({ x: cx, y: cy, born: t });
    }
    function wirePointer() {
      // pointer events cover mouse + touch + pen in one path on modern browsers.
      window.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY), { passive: true });
      window.addEventListener('pointerdown', (e) => onTap(e.clientX, e.clientY), { passive: true });
      // pointerleave on the document => the cursor left the window; stop reacting.
      document.addEventListener('pointerleave', () => { ptr.active = false; }, { passive: true });
      // touchstart fallback for any browser that doesn't map touch -> pointer.
      window.addEventListener('touchstart', (e) => {
        const tch = e.touches && e.touches[0]; if (tch) onTap(tch.clientX, tch.clientY);
      }, { passive: true });
    }

    p.setup = function () {
      const c = p.createCanvas(window.innerWidth, window.innerHeight);
      c.id('sj-bg');
      const el = c.elt;
      el.style.position = 'fixed'; el.style.inset = '0';
      el.style.zIndex = '-3'; el.style.pointerEvents = 'none'; el.style.display = 'block';
      p.pixelDensity(dpr());
      p.angleMode(p.RADIANS); p.ellipseMode(p.CENTER);
      seedStars(); planets = makePlanets(); rebuildGutters();
      wirePointer();
      p.frameRate(reduce ? 1 : FPS);
      if (reduce) { p.redraw(); p.noLoop(); }
      const onMq = (e) => {            // live reduced-motion toggle
        reduce = e.matches;
        if (reduce) { waves = []; con = null; p.frameRate(1); p.redraw(); p.noLoop(); }
        else if (!document.hidden && !exporting) { p.frameRate(FPS); p.loop(); }
      };
      mq.addEventListener ? mq.addEventListener('change', onMq) : mq.addListener(onMq);
      // Single resume gate: run only when motion's allowed AND nothing's blocking
      // (tab hidden, or a raster export hogging the main thread).
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
      seedStars(); rebuildGutters();
      if (reduce) p.redraw();
    };

    function wrap(s) {
      if (s.x < 0) s.x += p.width; else if (s.x > p.width) s.x -= p.width;
      if (s.y < 0) s.y += p.height; else if (s.y > p.height) s.y -= p.height;
    }

    // (1) PARALLAX LEAN — ease each layer's offset toward a depth-scaled bias away
    // from the pointer. One lerp per layer per frame (not per star). Masked so the
    // lean fades to nothing while the cursor is over the center content.
    function updateParallax() {
      const k = [0.004, 0.011, 0.024]; // far, mid, near (~1/depth)
      const live = ptr.has && ptr.active && (t - ptr.lastMove) < 1.2;
      const m = live ? edgeMask(ptr.px) : 0;
      const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      for (let i = 0; i < 3; i++) {
        const tx = live ? (cx - ptr.px) * k[i] * m : 0;
        const ty = live ? (cy - ptr.py) * k[i] * m : 0;
        off[i].x += (tx - off[i].x) * 0.06;
        off[i].y += (ty - off[i].y) * 0.06;
      }
    }

    function drawStars() {
      p.noStroke();
      const step = Math.floor(t * 8) * 0.7; // ~8fps quantized twinkle = GIF jank
      const m = reduce ? 0 : 1;
      const wellOn = !reduce && ptr.has && ptr.active && (t - ptr.lastMove) < 1.2;
      const wm = wellOn ? edgeMask(ptr.px) : 0;   // gravity-well strength by mask
      // layer index 2 == near; only the near layer gets the gravity well.
      const layer = (arr, vx, vy, li) => {
        const ox = off[li].x, oy = off[li].y;
        for (const s of arr) {
          s.x -= vx * m; s.y += vy * m; if (m) wrap(s);
          let dx = ox, dy = oy, aBoost = 0;
          // (2) GRAVITY WELL: near layer + cursor in-field only. Squared falloff,
          // no sqrt; the radius check itself is the spatial gate (cheap branch).
          if (li === 2 && wm > 0) {
            const gx = ptr.px - s.x, gy = ptr.py - s.y, d2 = gx * gx + gy * gy;
            if (d2 < R_WELL * R_WELL) {
              const fall = 1 - d2 / (R_WELL * R_WELL);
              dx += gx * fall * 0.18 * wm; dy += gy * fall * 0.18 * wm;
              aBoost = 60 * fall * wm;
            }
          }
          // (4) SHOCKWAVE shove: if a live wave's ring is sweeping this star, push
          // it radially outward by a thin band falloff. Few waves, cheap per star.
          for (const w of waves) {
            const r = (t - w.born) * WAVE_SPD;
            const ex = s.x - w.x, ey = s.y - w.y;
            const ed = Math.sqrt(ex * ex + ey * ey) || 1;
            const band = 1 - Math.min(1, Math.abs(ed - r) / 46);
            if (band > 0) { const f = band * 10; dx += (ex / ed) * f; dy += (ey / ed) * f; aBoost += 50 * band; }
          }
          const col = s.dim ? C.starDim : C.star;
          const a = (reduce ? 230 : 150 + 105 * Math.sin(step + s.tw)) + aBoost;
          p.fill(col[0], col[1], col[2], Math.min(255, a));
          p.rect(s.x + dx, s.y + dy, s.s, s.s);   // SQUARE dots = web-1.0 dither
        }
      };
      layer(far, 0.06, 0.06, 0); layer(mid, 0.14, 0.14, 1); layer(near, 0.28, 0.28, 2);
    }

    // (3) CONSTELLATION — when the pointer rests, find the nearest star (once) and
    // its 2-3 nearest neighbors (once), then reveal the segments on the 8fps clock.
    // Pure graph drawing; nothing here moves a star.
    function buildConstellation() {
      if (con) return;
      let anchor = null, best = NEAR_STAR * NEAR_STAR, ai = -1;
      const pool = mid.concat(near);
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i], dx = ptr.px - s.x, dy = ptr.py - s.y, d2 = dx * dx + dy * dy;
        if (d2 < best) { best = d2; anchor = s; ai = i; }
      }
      if (!anchor) { con = null; return; }
      // 2-3 nearest neighbors of the anchor (one O(N) scan over the same pool)
      const cand = [];
      for (let i = 0; i < pool.length; i++) {
        if (i === ai) continue;
        const s = pool[i], dx = anchor.x - s.x, dy = anchor.y - s.y, d2 = dx * dx + dy * dy;
        if (d2 < 220 * 220) cand.push({ s, d2 });
      }
      cand.sort((a, b) => a.d2 - b.d2);
      const segs = cand.slice(0, 3).map(c => ({ ax: anchor.x, ay: anchor.y, bx: c.s.x, by: c.s.y }));
      con = segs.length ? { segs, born: t, ax: anchor.x, ay: anchor.y } : null;
      conKey = ai;
    }
    function drawConstellation() {
      if (reduce || !ptr.has) return;
      const idle = ptr.active && (t - ptr.lastMove) >= IDLE_S;
      if (!idle) return;
      if (edgeMask(ptr.px) < 0.04) return;     // not over the content column
      buildConstellation();
      if (!con) return;
      // reveal one segment per ~8fps tick, like a webring diagram assembling
      const reveal = Math.min(con.segs.length, Math.floor((t - con.born) * 8));
      p.strokeWeight(1); p.noFill();
      for (let i = 0; i < reveal; i++) {
        const g = con.segs[i];
        p.stroke(C.con[0], C.con[1], C.con[2], 40 * edgeMask(g.ax));
        p.line(g.ax, g.ay, g.bx, g.by);
      }
      // anchor blinks lime for one twinkle frame when the figure completes
      if (reveal >= con.segs.length && (Math.floor(t * 8) & 1)) {
        p.noStroke(); p.fill(C.lime[0], C.lime[1], C.lime[2], 120 * edgeMask(con.ax));
        p.rect(con.ax - 1, con.ay - 1, 3, 3);
      }
    }

    // (4) SHOCKWAVE annulus — a thin expanding magenta ring per click/tap, faded
    // as it grows, retired when off-screen. Stars are shoved inside drawStars().
    function drawWaves() {
      if (reduce || !waves.length) return;
      p.noFill();
      const maxR = Math.hypot(window.innerWidth, window.innerHeight);
      waves = waves.filter(w => (t - w.born) * WAVE_SPD < maxR);
      for (const w of waves) {
        const r = (t - w.born) * WAVE_SPD;
        const life = 1 - Math.min(1, r / maxR);
        p.stroke(C.wave[0], C.wave[1], C.wave[2], 90 * life * edgeMask(w.x));
        p.strokeWeight(2);
        p.ellipse(w.x, w.y, r * 2, r * 2);
      }
    }

    function drawSaturn(r) {
      p.noStroke(); p.fill(C.saturn[0], C.saturn[1], C.saturn[2]); p.circle(0, 0, r * 2);
      p.fill(0, 0, 0, 60); p.arc(0, 0, r * 2, r * 2, 0.3, Math.PI - 0.3, p.PIE);
      p.noFill(); p.stroke(C.saturnRing[0], C.saturnRing[1], C.saturnRing[2]);
      p.strokeWeight(Math.max(2, r * 0.16)); p.ellipse(0, 0, r * 3.2, r * 3.2 * 0.45);
    }
    function drawBall(r) {
      p.noStroke(); p.fill(C.ball[0], C.ball[1], C.ball[2]); p.circle(0, 0, r * 2);
      p.stroke(C.ballLine[0], C.ballLine[1], C.ballLine[2]);
      p.strokeWeight(Math.max(1.5, r * 0.1)); p.noFill();
      p.line(-r, 0, r, 0); p.line(0, -r, 0, r);
      p.arc(-r * 0.6, 0, r * 1.6, r * 2, -Math.PI / 2.2, Math.PI / 2.2);
      p.arc(r * 0.6, 0, r * 1.6, r * 2, Math.PI - Math.PI / 2.2, Math.PI + Math.PI / 2.2);
    }
    function drawOrb(r, col) {
      p.noStroke(); p.fill(col[0], col[1], col[2]); p.circle(0, 0, r * 2);
      p.fill(0, 0, 0, 70); p.arc(0, 0, r * 2, r * 2, -Math.PI / 2.5, Math.PI / 2.5, p.PIE);
    }
    function drawMoon(r) {            // dithered moon + lime satellite ring
      p.noStroke(); p.fill(C.moon[0], C.moon[1], C.moon[2]); p.circle(0, 0, r * 2);
      p.fill(C.moonShadow[0], C.moonShadow[1], C.moonShadow[2], 220); p.circle(r * 0.42, 0, r * 1.7);
      p.fill(C.moonShadow[0], C.moonShadow[1], C.moonShadow[2], 180);
      for (let yy = -r; yy < r; yy += 4)
        for (let xx = -r; xx < r; xx += 4) {
          if (((xx + yy) & 7) !== 0) continue;
          if (xx * xx + yy * yy > r * r) continue;
          if (xx < -r * 0.2) p.rect(xx, yy, 2, 2);
        }
      p.fill(C.lime[0], C.lime[1], C.lime[2]);
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5; // ring already spinning via parent rotate()
        p.circle(Math.cos(a) * r * 1.7, Math.sin(a) * r * 1.7, 4);
      }
    }
    function drawKind(kind, r) {
      if (kind === 'saturn') drawSaturn(r);
      else if (kind === 'ball') drawBall(r);
      else if (kind === 'moon') drawMoon(r);
      else if (kind === 'purple') drawOrb(r, C.purple);
      else drawOrb(r, C.teal);
    }

    function drawBackdropPlanets() {
      for (const pl of planets) {
        const cx = pl.cx * p.width, cy = pl.cy * p.height;
        const ang = reduce ? pl.ph : t * pl.spd + pl.ph;
        const x = cx + Math.cos(ang) * pl.orbit;
        const y = cy + Math.sin(ang) * pl.orbit * 0.5;
        p.push(); p.translate(x, y); p.rotate(reduce ? 0 : t * 0.2);
        p.drawingContext.globalAlpha = pl.a;   // keep center low-contrast for UI
        drawKind(pl.kind, pl.rad);
        p.drawingContext.globalAlpha = 1; p.pop();
      }
    }
    function drawColumn(list, centerX) {
      for (const s of list) {
        const bob = reduce ? 0 : Math.sin(t * s.bobSpd + s.ph) * s.bobAmp;
        const spin = reduce ? s.ph : t * s.spin + s.ph;
        p.push(); p.translate(centerX, s.vy * p.height + bob); p.rotate(spin);
        drawKind(s.kind, s.rad); p.pop();
      }
    }

    p.draw = function () {
      if (document.hidden) return;                 // pause when tab hidden
      if (!reduce) t += p.deltaTime / 1000;        // no resume jump
      if (!reduce) updateParallax();               // ease the lean before stars draw
      p.background(0);                             // flat Space Jam void
      drawStars();
      drawConstellation();
      drawWaves();
      drawBackdropPlanets();
      if (gutterOn()) {
        const gw = gutterW();
        drawColumn(leftSprites, gw * 0.5);
        drawColumn(rightSprites, window.innerWidth - gw * 0.5);
      }
    };
  };

  function boot() {
    if (typeof p5 === 'undefined') return;   // CDN failed to load: stay on flat-black body, no crash
    new p5(sketch);                          // visibility/export pausing lives in the sketch closure
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
