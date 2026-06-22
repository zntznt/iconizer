// Iconizer — Space Jam '96 backdrop (p5.js INSTANCE MODE, behind all UI).
// Loaded in index.html as plain (non-module) scripts, after the p5 CDN tag.
// Self-mounts a fixed full-viewport <canvas>, z-index:-3, pointer-events:none.
// ponytail: faithful spacejam.com/1996 — flat black void, square star dots,
//   flat-fill orbiting planets dimmed in the center, loud spinning GIF-like
//   sprites exiled to the L/R gutters beside the centered webring.
(function () {
  const RING_W = 720;        // centered webring width (matches CSS .ringbox max-width)
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

    const C = {
      star: [255, 255, 255], starDim: [150, 156, 200],
      saturn: [232, 196, 96], saturnRing: [120, 200, 220],
      purple: [150, 70, 210], teal: [40, 200, 190],
      ball: [210, 110, 40], ballLine: [40, 20, 10],
      moon: [255, 0, 255], moonShadow: [0, 0, 128], lime: [57, 255, 20],
    };
    const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
    const gutterW = () => (window.innerWidth - RING_W) / 2;
    const gutterOn = () => gutterW() >= MIN_GUTTER;

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

    p.setup = function () {
      const c = p.createCanvas(window.innerWidth, window.innerHeight);
      c.id('sj-bg');
      const el = c.elt;
      el.style.position = 'fixed'; el.style.inset = '0';
      el.style.zIndex = '-3'; el.style.pointerEvents = 'none'; el.style.display = 'block';
      p.pixelDensity(dpr());
      p.angleMode(p.RADIANS); p.ellipseMode(p.CENTER);
      seedStars(); planets = makePlanets(); rebuildGutters();
      p.frameRate(reduce ? 1 : FPS);
      if (reduce) { p.redraw(); p.noLoop(); }
      const onMq = (e) => {            // live reduced-motion toggle
        reduce = e.matches;
        if (reduce) { p.frameRate(1); p.redraw(); p.noLoop(); }
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
    function drawStars() {
      p.noStroke();
      const step = Math.floor(t * 8) * 0.7; // ~8fps quantized twinkle = GIF jank
      const m = reduce ? 0 : 1;
      const layer = (arr, vx, vy) => {
        for (const s of arr) {
          s.x -= vx * m; s.y += vy * m; if (m) wrap(s);
          const col = s.dim ? C.starDim : C.star;
          const a = reduce ? 230 : 150 + 105 * Math.sin(step + s.tw);
          p.fill(col[0], col[1], col[2], a);
          p.rect(s.x, s.y, s.s, s.s);   // SQUARE dots = web-1.0 dither
        }
      };
      layer(far, 0.06, 0.06); layer(mid, 0.14, 0.14); layer(near, 0.28, 0.28);
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
      p.background(0);                             // flat Space Jam void
      drawStars();
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
