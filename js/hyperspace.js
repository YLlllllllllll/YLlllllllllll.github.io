/**
 * Free-look deep space with coasting physics.
 * WASD look · Shift thrust (inertia) · LMB lock.
 * No fake "warp star streaks" — those aren't physical at sublight speed.
 */
(() => {
  const canvas = document.getElementById("hyperspace");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: false });
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const FIELD = 2400;
  const TURN = 0.024;
  const LOCK_LERP = 0.06;
  const PICK_PAD = 36;
  const FOV = 1.05;
  const CELL = 3200;
  const HALF = CELL * 0.5;

  // —— scale (gameplay-compressed, ratios kept) ——
  const LY = 1200;
  const R_SUN = LY * 0.012; // larger so close-ups become huge sooner
  const C = LY * 0.15;
  const THRUST = C * 1.4; // sublight spool
  const WARP_THRUST = C * 3.2; // curvature assist above ~0.9c
  const MAX_BETA = 2.0; // Shift can break to 2c

  let W = 0;
  let H = 0;
  let dpr = 1;
  let yaw = 0.4;
  let pitch = 0;
  let camX = 0;
  let camY = 0;
  let camZ = 0;
  let velX = 0;
  let velY = 0;
  let velZ = 0;
  let time = 0;
  let raf = 0;
  let pointerX = 0;
  let pointerY = 0;
  let focal = 400;
  let lastTs = 0;
  /** @type {object|null} */
  let locked = null;
  /** @type {{fx:number,fy:number,fz:number,rx:number,ry:number,rz:number,ux:number,uy:number,uz:number}|null} */
  let basis = null;

  const keys = { w: false, a: false, s: false, d: false, shift: false, ctrl: false };

  let field = [];
  let systems = [];

  const hudVel = document.getElementById("hud-vel");
  const hudRange = document.getElementById("hud-range");
  const hudEta = document.getElementById("hud-eta");
  const hudLock = document.getElementById("hud-lock");

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function wrapAngle(a) {
    const t = Math.PI * 2;
    return ((a % t) + t) % t;
  }

  function shortestAngle(from, to) {
    let d = wrapAngle(to) - wrapAngle(from);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function wrapDelta(d) {
    return ((d + HALF) % CELL + CELL) % CELL - HALF;
  }

  function updateBasis() {
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const fx = sy * cp;
    const fy = sp;
    const fz = cy * cp;
    const rx = cy;
    const ry = 0;
    const rz = -sy;
    // up = forward × right  (Y-up, so +pitch looks toward sky / up on screen)
    const ux = fy * rz - fz * ry;
    const uy = fz * rx - fx * rz;
    const uz = fx * ry - fy * rx;
    basis = { fx, fy, fz, rx, ry, rz, ux, uy, uz };
  }

  function projectWorld(x, y, z) {
    const dx = x - camX;
    const dy = y - camY;
    const dz = z - camZ;
    const b = basis;
    const cx = dx * b.rx + dy * b.ry + dz * b.rz;
    const cy = dx * b.ux + dy * b.uy + dz * b.uz;
    const cz = dx * b.fx + dy * b.fy + dz * b.fz;
    if (cz <= 0.5) {
      return { x: 0, y: 0, forward: cz, visible: false, depth: cz };
    }
    return {
      x: W * 0.5 + (cx / cz) * focal,
      y: H * 0.5 - (cy / cz) * focal,
      forward: cz,
      visible: true,
      depth: cz,
    };
  }

  function projectFieldStar(s) {
    const dx = wrapDelta(s.x - camX);
    const dy = wrapDelta(s.y - camY);
    const dz = wrapDelta(s.z - camZ);
    const b = basis;
    const cx = dx * b.rx + dy * b.ry + dz * b.rz;
    const cy = dx * b.ux + dy * b.uy + dz * b.uz;
    const cz = dx * b.fx + dy * b.fy + dz * b.fz;
    if (cz <= 0.5) {
      return { x: 0, y: 0, forward: cz, visible: false, depth: cz };
    }
    return {
      x: W * 0.5 + (cx / cz) * focal,
      y: H * 0.5 - (cy / cz) * focal,
      forward: cz,
      visible: true,
      depth: cz,
      // radial velocity along view (for Doppler), world-relative via wrapping approx
      radial: -(dx * velX + dy * velY + dz * velZ) / Math.max(1, Math.hypot(dx, dy, dz)),
    };
  }

  function dirFromAngles(th, ph) {
    return {
      x: Math.sin(th) * Math.cos(ph),
      y: Math.sin(ph),
      z: Math.cos(th) * Math.cos(ph),
    };
  }

  function lookAnglesTo(x, y, z) {
    const dx = x - camX;
    const dy = y - camY;
    const dz = z - camZ;
    const len = Math.hypot(dx, dy, dz) || 1;
    return {
      yaw: Math.atan2(dx / len, dz / len),
      pitch: Math.asin(clamp(dy / len, -1, 1)),
    };
  }

  function speed() {
    return Math.hypot(velX, velY, velZ);
  }

  function beta() {
    return speed() / C;
  }

  function initField() {
    field = [];
    for (let i = 0; i < FIELD; i++) {
      const tint = Math.random();
      let r, g, b;
      if (tint > 0.92) {
        r = 255; g = 210; b = 140;
      } else if (tint > 0.78) {
        r = 170; g = 200; b = 255;
      } else {
        r = 230; g = 235; b = 245;
      }
      field.push({
        x: rand(-HALF, HALF),
        y: rand(-HALF, HALF),
        z: rand(-HALF, HALF),
        mag: Math.pow(Math.random(), 2.2),
        r, g, b,
        flare: Math.random() > 0.988,
      });
    }
  }

  function placeSystem(opts) {
    const d = opts.distLy * LY;
    const dir = dirFromAngles(opts.th, opts.ph);
    const rSun = opts.rSun ?? 1;
    return {
      ...opts,
      x: dir.x * d,
      y: dir.y * d,
      z: dir.z * d,
      radius: R_SUN * rSun, // physical radius in world units
    };
  }

  function initSystems() {
    const catalog = [
      { id: "sol", label: "G2V Sol-analogue", kind: "star", th: 0.55, ph: -0.08, distLy: 3.8, rSun: 1.0, hue: [255, 214, 140] },
      { id: "rigel", label: "B8Ia Rigel-class", kind: "star", th: 2.15, ph: 0.18, distLy: 12, rSun: 14, hue: [170, 205, 255] },
      { id: "betel", label: "M2I Betelgeuse-class", kind: "star", th: 4.0, ph: 0.12, distLy: 8.5, rSun: 18, hue: [255, 130, 90] },
      { id: "vega", label: "A0V Vega-class", kind: "star", th: 1.1, ph: -0.22, distLy: 6.2, rSun: 2.2, hue: [210, 230, 255] },
      { id: "sirius", label: "A1V Sirius-class", kind: "star", th: 5.4, ph: 0.05, distLy: 5.1, rSun: 1.7, hue: [220, 235, 255] },
      { id: "proxima", label: "M5.5V red dwarf", kind: "star", th: 3.6, ph: -0.35, distLy: 4.2, rSun: 0.55, hue: [255, 120, 95] },
      { id: "bh-cyg", label: "Cyg X-1 analogue", kind: "blackhole", th: 1.35, ph: 0.1, distLy: 22, rSun: 3.2, hue: [255, 170, 70], spin: 0 },
      { id: "bh-sgr", label: "IMBH candidate", kind: "blackhole", th: 4.7, ph: -0.15, distLy: 48, rSun: 6.5, hue: [255, 150, 60], spin: 1 },
      { id: "psr-crab", label: "Crab-like pulsar", kind: "neutron", th: 5.1, ph: 0.2, distLy: 16, rSun: 0.14, spin: 0, spinRate: 0.07 },
      { id: "psr-ms", label: "Millisecond pulsar", kind: "neutron", th: 2.8, ph: -0.28, distLy: 28, rSun: 0.11, spin: 1.2, spinRate: -0.11 },
      { id: "wr", label: "Wolf–Rayet", kind: "star", th: 0.2, ph: 0.32, distLy: 19, rSun: 4.5, hue: [255, 200, 255] },
      { id: "wd", label: "DA white dwarf", kind: "star", th: 3.1, ph: 0.4, distLy: 11, rSun: 0.35, hue: [200, 220, 255] },
    ];

    systems = catalog.map(placeSystem);

    const spectral = [
      { tag: "O", hue: [150, 185, 255], r: [6, 16] },
      { tag: "B", hue: [175, 205, 255], r: [2.5, 9] },
      { tag: "A", hue: [210, 225, 255], r: [1.4, 2.8] },
      { tag: "F", hue: [240, 235, 220], r: [1.1, 1.6] },
      { tag: "G", hue: [255, 220, 150], r: [0.85, 1.2] },
      { tag: "K", hue: [255, 170, 110], r: [0.65, 0.95] },
      { tag: "M", hue: [255, 120, 90], r: [0.4, 0.75] },
    ];

    for (let i = 0; i < 64; i++) {
      const sp = spectral[i % spectral.length];
      const th = rand(0, Math.PI * 2);
      const ph = rand(-0.85, 0.85);
      const distLy = rand(4.5, 95);
      const rSun = rand(sp.r[0], sp.r[1]);
      systems.push(placeSystem({
        id: `star-${i}`,
        label: `${sp.tag}-type #${i + 1}`,
        kind: "star",
        th, ph, distLy, rSun,
        hue: sp.hue.map((c) => clamp(c + rand(-18, 18), 80, 255)),
      }));
    }

    for (let i = 0; i < 8; i++) {
      systems.push(placeSystem({
        id: `bh-${i}`,
        label: `Stellar BH #${i + 1}`,
        kind: "blackhole",
        th: rand(0, Math.PI * 2),
        ph: rand(-0.6, 0.6),
        distLy: rand(25, 110),
        rSun: rand(2.2, 7),
        hue: [255, 160 + rand(0, 40), 50 + rand(0, 40)],
        spin: rand(0, Math.PI),
      }));
    }

    for (let i = 0; i < 10; i++) {
      systems.push(placeSystem({
        id: `ns-${i}`,
        label: `Pulsar #${i + 1}`,
        kind: "neutron",
        th: rand(0, Math.PI * 2),
        ph: rand(-0.7, 0.7),
        distLy: rand(14, 90),
        rSun: rand(0.08, 0.16),
        spin: rand(0, Math.PI),
        spinRate: rand(0.03, 0.12) * (Math.random() > 0.5 ? 1 : -1),
      }));
    }
  }

  /** Screen radius from true geometry: R_px = f * R / sqrt(R² + d²)  (sphere silhouette). */
  function screenRadius(radius, depth) {
    return focal * radius / Math.sqrt(radius * radius + depth * depth);
  }

  function systemScreen(sys) {
    const p = projectWorld(sys.x, sys.y, sys.z);
    if (!p.visible) return { p, size: 0, dist: 0 };
    const dist = Math.hypot(sys.x - camX, sys.y - camY, sys.z - camZ);
    const size = screenRadius(sys.radius, dist);
    return { p, size, dist };
  }

  function pickSystem(mx, my) {
    let best = null;
    let bestScore = Infinity;
    for (const sys of systems) {
      const { p, size } = systemScreen(sys);
      if (!p.visible) continue;
      const d = Math.hypot(p.x - mx, p.y - my);
      // generous pick radius so distant catalog stars stay selectable
      const hitR = Math.max(PICK_PAD, size * 1.5, 22);
      if (d <= hitR && d < bestScore) {
        best = sys;
        bestScore = d;
      }
    }
    return best;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    focal = (H * 0.5) / Math.tan(FOV * 0.5);
    pointerX = W * 0.5;
    pointerY = H * 0.5;
    if (!field.length) initField();
    if (!systems.length) initSystems();
  }

  function drawNebula() {
    const washes = [
      [0.2, 0.15, 0.55, "rgba(40, 70, 130, 0.16)"],
      [0.8, 0.25, 0.45, "rgba(90, 40, 90, 0.1)"],
      [0.55, 0.75, 0.5, "rgba(30, 90, 100, 0.1)"],
      [0.15, 0.7, 0.4, "rgba(120, 60, 40, 0.07)"],
    ];
    for (const [ux, uy, scale, color] of washes) {
      const g = ctx.createRadialGradient(W * ux, H * uy, 0, W * ux, H * uy, W * scale);
      g.addColorStop(0, color);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /** Mild Doppler tint only at high β — not motion streaks. */
  function dopplerTint(r, g, b, radial) {
    const bta = beta();
    if (bta < 0.25) return [r, g, b];
    // approaching (radial>0 relative convention): blueshift; receding: redshift
    const k = clamp(bta * 0.55, 0, 0.5) * Math.sign(radial || 0);
    return [
      clamp(r + k * -80 + (k < 0 ? -k * 60 : 0), 40, 255),
      clamp(g, 40, 255),
      clamp(b + k * 90 + (k > 0 ? 0 : k * -40), 40, 255),
    ];
  }

  function drawFieldStar(s) {
    const p = projectFieldStar(s);
    if (!p.visible) return;
    if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) return;

    const [r, g, b] = dopplerTint(s.r, s.g, s.b, p.radial);
    const bright = 0.25 + s.mag * 0.75;
    const core = 0.35 + s.mag * 1.45;
    const alpha = 0.18 + bright * 0.7;

    if (s.mag > 0.55) {
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, core * 5);
      grad.addColorStop(0, `rgba(${r},${g},${b},${0.18 * bright})`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, core * 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, core, 0, Math.PI * 2);
    ctx.fill();

    if (s.flare || s.mag > 0.9) {
      const spike = core * (7 + s.mag * 12);
      ctx.strokeStyle = `rgba(${r},${g},${b},${0.2 * bright})`;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(p.x - spike, p.y);
      ctx.lineTo(p.x + spike, p.y);
      ctx.moveTo(p.x, p.y - spike * 0.65);
      ctx.lineTo(p.x, p.y + spike * 0.65);
      ctx.stroke();
    }
  }

  function drawLockReticle(x, y, size, label) {
    const r = Math.max(16, size * 1.15 + 8);
    const tick = 7;
    ctx.strokeStyle = "rgba(240, 193, 75, 0.95)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x - r, y - r + tick); ctx.lineTo(x - r, y - r); ctx.lineTo(x - r + tick, y - r);
    ctx.moveTo(x + r - tick, y - r); ctx.lineTo(x + r, y - r); ctx.lineTo(x + r, y - r + tick);
    ctx.moveTo(x + r, y + r - tick); ctx.lineTo(x + r, y + r); ctx.lineTo(x + r - tick, y + r);
    ctx.moveTo(x - r + tick, y + r); ctx.lineTo(x - r, y + r); ctx.lineTo(x - r, y + r - tick);
    ctx.stroke();
    ctx.font = "600 11px 'IBM Plex Sans', sans-serif";
    ctx.fillStyle = "rgba(240, 193, 75, 0.95)";
    ctx.textAlign = "center";
    ctx.fillText(`LOCK  ·  ${label}`, x, y - r - 10);
  }

  function drawLabel(x, y, title, dist) {
    ctx.font = "500 11px 'IBM Plex Sans', sans-serif";
    ctx.fillStyle = "rgba(220, 230, 245, 0.55)";
    ctx.textAlign = "center";
    ctx.fillText(`${title}  ·  ${dist}`, x, y);
  }

  function formatDist(ly) {
    if (ly >= 0.1) return `${ly.toFixed(2)} ly`;
    const au = ly * 63241;
    if (au >= 1) return `${au.toFixed(1)} AU`;
    return `${(au * 149597870.7).toExponential(2)} km`;
  }

  function formatEta(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "—";
    if (seconds > 86400 * 365) return `${(seconds / (86400 * 365)).toFixed(1)} yr`;
    if (seconds > 86400) return `${(seconds / 86400).toFixed(1)} d`;
    if (seconds > 3600) return `${(seconds / 3600).toFixed(1)} h`;
    if (seconds > 60) return `${(seconds / 60).toFixed(1)} min`;
    return `${seconds.toFixed(1)} s`;
  }

  function formatVel(spd) {
    const b = spd / C;
    if (b >= 1) return `${b.toFixed(2)} c · WARP`;
    if (b >= 0.01) return `${b.toFixed(3)} c`;
    const kms = (spd / LY) * 299792.458 * 0.15;
    if (kms >= 1) return `${kms.toFixed(0)} km/s`;
    return `${(kms * 1000).toFixed(0)} m/s`;
  }

  function hash01(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  /** Detail strength scales with on-screen size (closer → richer). */
  function proximityDetail(size) {
    // 0 at tiny point, ~1 when sphere dominates the view
    return clamp((size - 12) / Math.max(180, Math.min(W, H) * 0.45), 0, 1);
  }

  /** Spectacular solid sphere; near-field ramps corona, granulation, spots. */
  function drawSolidSphere(p, size, hue, opts = {}) {
    const [r, g, b] = hue;
    const seed = opts.seed || 1;
    const spin = opts.spin || 0;
    const prox = opts.prox != null ? opts.prox : proximityDetail(size);
    const litX = p.x - size * 0.3;
    const litY = p.y - size * 0.34;
    const boost = 0.45 + prox * 1.55; // color / glow strength

    // multi-layer corona — stronger & wider when close
    if (opts.corona !== false && size > 2) {
      const layers = 2 + Math.floor(prox * 4);
      const baseScale = (opts.coronaScale || 0.85) * (1 + prox * 0.85);
      for (let i = layers; i >= 1; i--) {
        const glowR = size * (1.08 + i * baseScale * 0.55);
        const alpha = ((0.14 + prox * 0.28) / i) * (opts.darkCore ? 0.5 : 1) * boost;
        const glow = ctx.createRadialGradient(p.x, p.y, size * (0.88 - prox * 0.05), p.x, p.y, glowR);
        glow.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
        glow.addColorStop(0.45, `rgba(${r},${g},${b},${alpha * 0.35})`);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // photosphere
    const body = ctx.createRadialGradient(litX, litY, size * 0.04, p.x, p.y, size);
    if (opts.darkCore) {
      body.addColorStop(0, "#050505");
      body.addColorStop(0.5, "#000");
      body.addColorStop(0.78, `rgba(${r},${g},${b},${0.35 + prox * 0.35})`);
      body.addColorStop(0.92, `rgba(${r},${g},${b},${0.55 + prox * 0.35})`);
      body.addColorStop(1, "rgba(0,0,0,1)");
    } else {
      const hot = opts.hotCore || `rgb(${Math.min(255, 250 + prox * 5)},${Math.min(255, 245 + prox * 5)},${Math.min(255, 230 + prox * 10)})`;
      body.addColorStop(0, hot);
      body.addColorStop(0.18, `rgb(${Math.min(255, r + 25 + prox * 20)},${Math.min(255, g + 18)},${Math.min(255, b + 12)})`);
      body.addColorStop(0.5, `rgb(${r},${g},${b})`);
      body.addColorStop(0.8, `rgb(${Math.floor(r * (0.45 - prox * 0.05))},${Math.floor(g * 0.38)},${Math.floor(b * 0.3)})`);
      body.addColorStop(1, `rgb(${Math.floor(r * 0.14)},${Math.floor(g * 0.1)},${Math.floor(b * 0.08)})`);
    }
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fill();

    // surface detail — density & contrast rise with proximity
    if (!opts.darkCore && prox > 0.08 && size > 22) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, size * 0.99, 0, Math.PI * 2);
      ctx.clip();

      const cells = Math.floor(24 + prox * prox * 320);
      for (let i = 0; i < cells; i++) {
        const u = hash01(seed * 17 + i * 3.1);
        const v = hash01(seed * 29 + i * 5.7);
        const ang = u * Math.PI * 2 + spin * 0.35;
        const rad = Math.sqrt(v) * size * 0.93;
        const px = p.x + Math.cos(ang) * rad;
        const py = p.y + Math.sin(ang) * rad * 0.95;
        const rr = size * (0.012 + hash01(i + seed) * (0.02 + prox * 0.04));
        const bright = (0.03 + hash01(i * 9 + seed) * 0.12) * (0.5 + prox);
        ctx.fillStyle = `rgba(255,248,230,${bright})`;
        ctx.beginPath();
        ctx.arc(px, py, rr, 0, Math.PI * 2);
        ctx.fill();
      }

      if (prox > 0.25) {
        const spots = Math.floor(4 + prox * 28);
        for (let i = 0; i < spots; i++) {
          const u = hash01(seed * 41 + i * 11.3);
          const v = hash01(seed * 7 + i * 2.9);
          if (v > 0.78 - prox * 0.15) continue;
          const ang = u * Math.PI * 2 + spin * 0.5;
          const rad = (0.2 + v * 0.6) * size;
          const px = p.x + Math.cos(ang) * rad;
          const py = p.y + Math.sin(ang) * rad * 0.88;
          const rr = size * (0.025 + hash01(i + 99) * 0.07) * (0.7 + prox);
          ctx.fillStyle = `rgba(35, 15, 8, ${0.2 + prox * 0.45})`;
          ctx.beginPath();
          ctx.arc(px, py, rr, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgba(15, 8, 4, ${0.35 + prox * 0.35})`;
          ctx.beginPath();
          ctx.arc(px, py, rr * 0.42, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (opts.bands && prox > 0.2) {
        for (let i = -4; i <= 4; i++) {
          const yy = p.y + i * size * 0.16;
          const band = ctx.createLinearGradient(p.x - size, yy, p.x + size, yy);
          band.addColorStop(0, "rgba(0,0,0,0)");
          band.addColorStop(0.5, `rgba(255,255,255,${(0.03 + prox * 0.06) * (i % 2 ? 1.2 : 0.7)})`);
          band.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = band;
          ctx.fillRect(p.x - size, yy - size * 0.045, size * 2, size * 0.09);
        }
      }

      const limb = ctx.createRadialGradient(p.x, p.y, size * (0.4 + prox * 0.15), p.x, p.y, size);
      limb.addColorStop(0, "rgba(0,0,0,0)");
      limb.addColorStop(1, `rgba(0,0,0,${0.28 + prox * 0.35})`);
      ctx.fillStyle = limb;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();

      // specular / hot limb crescent when very close
      if (prox > 0.45) {
        const spec = ctx.createRadialGradient(litX, litY, 0, litX, litY, size * 0.55);
        spec.addColorStop(0, `rgba(255,255,245,${0.12 + prox * 0.2})`);
        spec.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = spec;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (!opts.darkCore && size > 14) {
      ctx.strokeStyle = `rgba(${Math.min(255, r + 40)},${Math.min(255, g + 20)},${b},${0.35 + prox * 0.45})`;
      ctx.lineWidth = Math.max(1, size * (0.01 + prox * 0.012));
      ctx.beginPath();
      ctx.arc(p.x, p.y, size * 0.996, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (!opts.darkCore && prox > 0.55) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, size * (1.15 + prox * 0.35), 0, Math.PI * 2);
      ctx.arc(p.x, p.y, size * 0.985, 0, Math.PI * 2, true);
      ctx.clip();
      const promos = Math.floor(5 + prox * 10);
      for (let i = 0; i < promos; i++) {
        const a = hash01(seed + i * 13) * Math.PI * 2 + time * (0.1 + prox * 0.2);
        const x0 = p.x + Math.cos(a) * size;
        const y0 = p.y + Math.sin(a) * size;
        const reach = 1.05 + hash01(i) * 0.2 * prox;
        const x1 = p.x + Math.cos(a) * size * reach;
        const y1 = p.y + Math.sin(a) * size * reach;
        ctx.strokeStyle = `rgba(${r},${g},${Math.floor(b * 0.55)},${0.25 + prox * 0.4})`;
        ctx.lineWidth = size * (0.01 + prox * 0.012);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(
          p.x + Math.cos(a + 0.25) * size * (1.1 + prox * 0.15),
          p.y + Math.sin(a + 0.25) * size * (1.1 + prox * 0.15),
          x1, y1
        );
        ctx.stroke();
      }
      ctx.restore();
    }

    if (!opts.darkCore && size < 26 && prox < 0.2) {
      const spike = size * 5.5;
      ctx.strokeStyle = `rgba(${r},${g},${b},0.28)`;
      ctx.lineWidth = Math.max(0.7, size * 0.05);
      ctx.beginPath();
      ctx.moveTo(p.x - spike, p.y);
      ctx.lineTo(p.x + spike, p.y);
      ctx.moveTo(p.x, p.y - spike * 0.65);
      ctx.lineTo(p.x, p.y + spike * 0.65);
      ctx.stroke();
    }
  }

  function drawStarSystem(sys) {
    const { p, size, dist } = systemScreen(sys);
    if (!p.visible || size < 0.35) return;
    const giant = (sys.rSun || 1) > 4;
    const proxScreen = proximityDetail(size);
    const proxPhys = clamp(1 - (dist - sys.radius) / (sys.radius * 120), 0, 1);
    const prox = Math.max(proxScreen, proxPhys * 0.85);
    drawSolidSphere(p, size, sys.hue, {
      corona: true,
      coronaScale: 0.7 + (1 - prox) * 0.8,
      seed: sys.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0),
      spin: time * 0.08 + (sys.spin || 0),
      bands: giant,
      prox,
    });
    if (locked && locked.id === sys.id) drawLockReticle(p.x, p.y, size, sys.label);
    else if (size < H * 0.45) drawLabel(p.x, p.y + size + 14, sys.label, formatDist(dist / LY));
  }

  function drawBlackHole(sys) {
    const { p, size, dist } = systemScreen(sys);
    if (!p.visible || size < 0.35) return;
    sys.spin = (sys.spin || 0) + 0.004;

    if (size < W * 0.7) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(sys.spin);
      ctx.scale(1, 0.36);
      for (let i = 0; i < 3; i++) {
        const disk = ctx.createRadialGradient(0, 0, size * (0.55 + i * 0.15), 0, 0, size * (2.2 + i * 0.5));
        disk.addColorStop(0, "rgba(255,210,120,0)");
        disk.addColorStop(0.4, `rgba(255,${160 - i * 20},${60 + i * 10},${0.45 - i * 0.1})`);
        disk.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = disk;
        ctx.beginPath();
        ctx.arc(0, 0, size * (2.2 + i * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(255,230,180,0.7)";
      ctx.lineWidth = Math.max(1.2, size * 0.08);
      ctx.beginPath();
      ctx.arc(0, 0, size * 1.05, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const prox = proximityDetail(size);
    drawSolidSphere(p, size, sys.hue || [255, 180, 80], { darkCore: true, corona: true, coronaScale: 0.55 + prox * 0.4, prox });
    if (locked && locked.id === sys.id) drawLockReticle(p.x, p.y, size, sys.label);
    else if (size < H * 0.4) drawLabel(p.x, p.y + size + 14, sys.label, formatDist(dist / LY));
  }

  function drawNeutron(sys) {
    const { p, size, dist } = systemScreen(sys);
    if (!p.visible || size < 0.25) return;
    sys.spin = (sys.spin || 0) + (sys.spinRate || 0.04);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(sys.spin);
    const beam = ctx.createLinearGradient(0, -Math.max(size * 10, 40), 0, Math.max(size * 10, 40));
    beam.addColorStop(0, "rgba(140,200,255,0)");
    beam.addColorStop(0.45, "rgba(180,220,255,0.35)");
    beam.addColorStop(0.5, "rgba(255,255,255,0.85)");
    beam.addColorStop(0.55, "rgba(180,220,255,0.35)");
    beam.addColorStop(1, "rgba(140,200,255,0)");
    ctx.fillStyle = beam;
    const bh = Math.max(size * 10, 40);
    ctx.beginPath();
    ctx.moveTo(-Math.max(size * 0.12, 1), -bh);
    ctx.lineTo(Math.max(size * 0.12, 1), -bh);
    ctx.lineTo(Math.max(size * 0.28, 2), bh);
    ctx.lineTo(-Math.max(size * 0.28, 2), bh);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    const prox = proximityDetail(Math.max(size, 2.5));
    drawSolidSphere(p, Math.max(size, 2.5), [200, 220, 255], {
      hotCore: "#ffffff",
      corona: true,
      coronaScale: 0.9 + prox * 0.6,
      seed: 77,
      prox,
    });
    if (locked && locked.id === sys.id) drawLockReticle(p.x, p.y, size, sys.label);
    else if (size < H * 0.4) drawLabel(p.x, p.y + size + 14, sys.label, formatDist(dist / LY));
  }

  function collideBodies(dt) {
    // bounce / stop at photosphere — can't enter the solid
    for (const sys of systems) {
      const dx = camX - sys.x;
      const dy = camY - sys.y;
      const dz = camZ - sys.z;
      const dist = Math.hypot(dx, dy, dz);
      const minDist = sys.radius * 1.02;
      if (dist < minDist && dist > 1e-6) {
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;
        camX = sys.x + nx * minDist;
        camY = sys.y + ny * minDist;
        camZ = sys.z + nz * minDist;
        // remove inward velocity component
        const vn = velX * nx + velY * ny + velZ * nz;
        if (vn < 0) {
          velX -= vn * nx;
          velY -= vn * ny;
          velZ -= vn * nz;
        }
      }
    }
  }

  function integrate(dt) {
    updateBasis();

    // Shift: sublight thrust, then curvature ramp past c → cap 2c
    if (keys.shift && !keys.ctrl) {
      const b = beta();
      let accel = THRUST * (1 + b * 1.25);
      if (b > 0.85) {
        const warpFactor = 1 + (b - 0.85) * 4.5;
        accel = WARP_THRUST * warpFactor;
      }
      velX += basis.fx * accel * dt;
      velY += basis.fy * accel * dt;
      velZ += basis.fz * accel * dt;
    }

    // Ctrl: brake opposite velocity (stronger in warp)
    if (keys.ctrl) {
      const spd = speed();
      if (spd > 1e-6) {
        const b = spd / C;
        const brake = (THRUST * 1.6 + (b > 1 ? WARP_THRUST * 1.8 : 0)) * (1 + b);
        const ax = -(velX / spd) * brake;
        const ay = -(velY / spd) * brake;
        const az = -(velZ / spd) * brake;
        velX += ax * dt;
        velY += ay * dt;
        velZ += az * dt;
        // kill residual crawl
        if (speed() < C * 0.0008) {
          velX = velY = velZ = 0;
        }
      }
    }

    let spd = speed();
    const maxV = MAX_BETA * C;
    if (spd > maxV) {
      const s = maxV / spd;
      velX *= s; velY *= s; velZ *= s;
    }

    camX += velX * dt;
    camY += velY * dt;
    camZ += velZ * dt;
    collideBodies(dt);
  }

  function drawWarpField() {
    const b = beta();
    if (b < 1.02) return;
    const t = clamp((b - 1) / 1, 0, 1); // 0 at 1c → 1 at 2c
    const cx = W * 0.5;
    const cy = H * 0.5;

    // curvature bubble — compressed space ahead, expanded aft (schematic)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1 + t * 0.08, 1 - t * 0.12);
    ctx.translate(-cx, -cy);

    const r0 = Math.min(W, H) * (0.28 - t * 0.04);
    const r1 = Math.min(W, H) * (0.55 + t * 0.08);
    const ring = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
    ring.addColorStop(0, "rgba(0,0,0,0)");
    ring.addColorStop(0.55, `rgba(120, 180, 255, ${0.04 + t * 0.06})`);
    ring.addColorStop(0.78, `rgba(240, 200, 100, ${0.1 + t * 0.12})`);
    ring.addColorStop(0.9, `rgba(180, 140, 255, ${0.08 + t * 0.1})`);
    ring.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = ring;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = `rgba(240, 210, 140, ${0.25 + t * 0.35})`;
    ctx.lineWidth = 1.5 + t * 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r0 * 1.35, r0 * 0.95, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // FTL only: short Cheerenkov-like fringe on bright field stars (not sublight streaks)
    if (b > 1.15) {
      ctx.strokeStyle = `rgba(140, 200, 255, ${0.08 + t * 0.12})`;
      ctx.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + time * 0.4;
        const r = Math.min(W, H) * (0.2 + (i % 3) * 0.05);
        ctx.beginPath();
        ctx.arc(cx, cy, r, a, a + 0.35);
        ctx.stroke();
      }
    }
  }

  function closingSpeedTo(sys) {
    const dx = sys.x - camX;
    const dy = sys.y - camY;
    const dz = sys.z - camZ;
    const dist = Math.hypot(dx, dy, dz) || 1;
    // velocity toward target (positive = approaching)
    return (velX * dx + velY * dy + velZ * dz) / dist;
  }

  function updateHud() {
    const spd = speed();
    if (hudVel) hudVel.textContent = formatVel(spd);

    if (!locked) {
      if (hudLock) hudLock.textContent = "—";
      if (hudRange) hudRange.textContent = "—";
      if (hudEta) hudEta.textContent = "—";
      return;
    }

    const dist = Math.hypot(locked.x - camX, locked.y - camY, locked.z - camZ);
    const ly = dist / LY;
    const approach = closingSpeedTo(locked);
    const surface = Math.max(0, dist - locked.radius * 1.02);

    if (hudLock) hudLock.textContent = locked.label;
    if (hudRange) hudRange.textContent = formatDist(ly);
    if (hudEta) {
      if (approach > C * 1e-5) {
        hudEta.textContent = formatEta(surface / approach);
      } else {
        hudEta.textContent = approach < -C * 1e-5 ? "receding" : "—";
      }
    }
  }

  function applyLook() {
    if (keys.a) yaw -= TURN;
    if (keys.d) yaw += TURN;
    if (keys.w) pitch += TURN; // look up
    if (keys.s) pitch -= TURN; // look down
    yaw = wrapAngle(yaw);
    pitch = wrapAngle(pitch + Math.PI) - Math.PI;

    if (locked && !(keys.w || keys.a || keys.s || keys.d)) {
      const aim = lookAnglesTo(locked.x, locked.y, locked.z);
      yaw = wrapAngle(yaw + shortestAngle(yaw, aim.yaw) * LOCK_LERP);
      let pd = aim.pitch - pitch;
      if (pd > Math.PI) pd -= Math.PI * 2;
      if (pd < -Math.PI) pd += Math.PI * 2;
      pitch += pd * LOCK_LERP;
    }
  }

  function frame(ts) {
    if (!lastTs) lastTs = ts;
    const dt = clamp((ts - lastTs) / 1000, 0, 0.05);
    lastTs = ts;
    time += dt;

    applyLook();
    integrate(dt);
    updateBasis();

    ctx.fillStyle = "#060a14";
    ctx.fillRect(0, 0, W, H);
    drawNebula();

    for (const s of field) drawFieldStar(s);

    const sorted = systems.slice().sort((a, b) => {
      const da = Math.hypot(a.x - camX, a.y - camY, a.z - camZ);
      const db = Math.hypot(b.x - camX, b.y - camY, b.z - camZ);
      return db - da;
    });
    for (const sys of sorted) {
      if (sys.kind === "star") drawStarSystem(sys);
      else if (sys.kind === "blackhole") drawBlackHole(sys);
      else if (sys.kind === "neutron") drawNeutron(sys);
    }

    drawWarpField();
    updateHud();

    ctx.fillStyle = `rgba(240, 200, 100, ${0.25 + Math.min(0.55, beta() * 0.35)})`;
    ctx.beginPath();
    ctx.arc(W * 0.5, H * 0.5, 2, 0, Math.PI * 2);
    ctx.fill();

    const hover = pickSystem(pointerX, pointerY);
    if (hover && (!locked || locked.id !== hover.id)) {
      const { p, size } = systemScreen(hover);
      ctx.strokeStyle = "rgba(220, 230, 245, 0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(14, size * 1.15 + 6), 0, Math.PI * 2);
      ctx.stroke();
    }

    raf = requestAnimationFrame(frame);
  }

  function drawStatic() {
    updateBasis();
    ctx.fillStyle = "#060a14";
    ctx.fillRect(0, 0, W, H);
    drawNebula();
    initField();
    initSystems();
    for (const s of field) drawFieldStar(s);
    for (const sys of systems) {
      if (sys.kind === "star") drawStarSystem(sys);
      else if (sys.kind === "blackhole") drawBlackHole(sys);
      else if (sys.kind === "neutron") drawNeutron(sys);
    }
  }

  window.addEventListener("resize", () => {
    const keep = { field, systems, locked, camX, camY, camZ, velX, velY, velZ, yaw, pitch };
    resize();
    field = keep.field;
    systems = keep.systems;
    camX = keep.camX; camY = keep.camY; camZ = keep.camZ;
    velX = keep.velX; velY = keep.velY; velZ = keep.velZ;
    yaw = keep.yaw; pitch = keep.pitch;
    locked = keep.locked
      ? systems.find((s) => s.id === keep.locked.id) || null
      : null;
  }, { passive: true });

  window.addEventListener("pointermove", (e) => {
    pointerX = e.clientX;
    pointerY = e.clientY;
  }, { passive: true });

  window.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest("a, button, .panel, .section, .hud")) return;
    const hit = pickSystem(e.clientX, e.clientY);
    if (hit) locked = locked && locked.id === hit.id ? null : hit;
    else if (locked) locked = null;
  });

  function setKey(code, down) {
    switch (code) {
      case "KeyW":
      case "ArrowUp":
        keys.w = down; break;
      case "KeyA":
      case "ArrowLeft":
        keys.a = down; break;
      case "KeyS":
      case "ArrowDown":
        keys.s = down; break;
      case "KeyD":
      case "ArrowRight":
        keys.d = down; break;
      case "ShiftLeft":
      case "ShiftRight":
        keys.shift = down; break;
      case "ControlLeft":
      case "ControlRight":
        keys.ctrl = down; break;
      default:
        return false;
    }
    return true;
  }

  window.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, a, button")) return;
    if (setKey(e.code, true)) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => setKey(e.code, false));
  window.addEventListener("blur", () => {
    keys.w = keys.a = keys.s = keys.d = keys.shift = keys.ctrl = false;
  });

  resize();
  initField();
  initSystems();
  updateBasis();

  if (reduced) {
    drawStatic();
    const hint = document.getElementById("warp-hint");
    if (hint) hint.hidden = true;
  } else {
    requestAnimationFrame(frame);
  }

  document.addEventListener("visibilitychange", () => {
    if (reduced) return;
    if (document.hidden) cancelAnimationFrame(raf);
    else {
      lastTs = 0;
      requestAnimationFrame(frame);
    }
  });
})();
