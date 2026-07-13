/**
 * Free-look deep space (unbounded).
 * WASD = look · Shift = cruise forward · LMB = lock body.
 */
(() => {
  const canvas = document.getElementById("hyperspace");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: false });
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const FIELD = 1600;
  const LOCAL_NEAR = 8;
  const LOCAL_FAR = 120;
  const TURN = 0.024;
  const LOCK_LERP = 0.06;
  const PICK_PAD = 28;
  const FOV = 1.05;
  // wrapping star cell — fly forever, stars recycle around you
  const CELL = 2400;
  const HALF = CELL * 0.5;
  const LY = 85; // world units per displayed light-year

  let W = 0;
  let H = 0;
  let dpr = 1;
  let yaw = 0.4;
  let pitch = 0; // unbounded — full tumble allowed
  let camX = 0;
  let camY = 0;
  let camZ = 0;
  let throttle = 0;
  let time = 0;
  let raf = 0;
  let pointerX = 0;
  let pointerY = 0;
  let focal = 400;
  /** @type {object|null} */
  let locked = null;
  /** @type {{fx:number,fy:number,fz:number,rx:number,ry:number,rz:number,ux:number,uy:number,uz:number}|null} */
  let basis = null;

  const keys = { w: false, a: false, s: false, d: false, shift: false };

  let field = [];
  let systems = [];
  let debris = [];
  let meteors = [];
  let meteorCD = 180;

  const hudVel = document.getElementById("hud-vel");
  const hudRange = document.getElementById("hud-range");
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
    d = ((d + HALF) % CELL + CELL) % CELL - HALF;
    return d;
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
    // up = right × forward
    const ux = ry * fz - rz * fy;
    const uy = rz * fx - rx * fz;
    const uz = rx * fy - ry * fx;
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

  /** Field stars: wrap into a cube around the camera (infinite void). */
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
    const nx = dx / len;
    const ny = dy / len;
    const nz = dz / len;
    return {
      yaw: Math.atan2(nx, nz),
      pitch: Math.asin(clamp(ny, -1, 1)),
    };
  }

  function initField() {
    field = [];
    for (let i = 0; i < FIELD; i++) {
      const tint = Math.random();
      let r, g, b;
      if (tint > 0.9) {
        r = 255; g = 210; b = 140;
      } else if (tint > 0.75) {
        r = 170; g = 200; b = 255;
      } else if (tint > 0.97) {
        r = 255; g = 160; b = 160;
      } else {
        r = 230; g = 235; b = 245;
      }
      field.push({
        x: rand(-HALF, HALF),
        y: rand(-HALF, HALF),
        z: rand(-HALF, HALF),
        mag: Math.pow(Math.random(), 2.2),
        r, g, b,
        flare: Math.random() > 0.985,
      });
    }
  }

  function placeSystem(opts) {
    const d = opts.distLy * LY;
    const dir = dirFromAngles(opts.th, opts.ph);
    return {
      ...opts,
      x: dir.x * d,
      y: dir.y * d,
      z: dir.z * d,
    };
  }

  function initSystems() {
    systems = [
      placeSystem({
        id: "sol-analogue", label: "G-type primary", kind: "star",
        th: 0.55, ph: -0.12, distLy: 4.2, radius: 1.0, hue: [255, 214, 140],
      }),
      placeSystem({
        id: "blue-giant", label: "B-type giant", kind: "star",
        th: 2.4, ph: 0.22, distLy: 18, radius: 3.2, hue: [180, 210, 255],
      }),
      placeSystem({
        id: "red-dwarf", label: "K-dwarf", kind: "star",
        th: 4.1, ph: -0.35, distLy: 9.5, radius: 0.55, hue: [255, 150, 110],
      }),
      placeSystem({
        id: "bh-1", label: "Stellar BH", kind: "blackhole",
        th: 1.2, ph: 0.08, distLy: 32, radius: 1.4, spin: 0,
      }),
      placeSystem({
        id: "psr", label: "Millisecond pulsar", kind: "neutron",
        th: 5.0, ph: 0.18, distLy: 24, radius: 0.4, spin: 0, spinRate: 0.045,
      }),
      placeSystem({
        id: "psr-2", label: "Radio pulsar", kind: "neutron",
        th: 3.3, ph: -0.28, distLy: 41, radius: 0.35, spin: 1.2, spinRate: -0.03,
      }),
    ];
  }

  function initDebris() {
    debris = [];
    for (let i = 0; i < 28; i++) {
      debris.push({
        kind: Math.random() > 0.82 ? "sat" : "rock",
        x: rand(-80, 80),
        y: rand(-50, 50),
        z: rand(LOCAL_NEAR, LOCAL_FAR),
        spin: rand(0, Math.PI * 2),
        spinRate: rand(-0.01, 0.01),
        size: rand(0.6, 1.8),
        seed: Math.random() * 100,
      });
    }
  }

  function angularSize(sys, depth) {
    const worldR = sys.radius * LY * 0.045;
    return clamp((worldR / Math.max(depth, 1)) * focal, 1.2, 90);
  }

  function systemScreen(sys) {
    const p = projectWorld(sys.x, sys.y, sys.z);
    const size = p.visible ? angularSize(sys, p.depth) : 0;
    return { p, size };
  }

  function pickSystem(mx, my) {
    let best = null;
    let bestScore = Infinity;
    for (const sys of systems) {
      const { p, size } = systemScreen(sys);
      if (!p.visible) continue;
      const d = Math.hypot(p.x - mx, p.y - my);
      const hitR = Math.max(PICK_PAD, size * 2.2);
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
    if (!debris.length) initDebris();
  }

  function drawNebula() {
    const a = ctx.createRadialGradient(W * 0.25, H * 0.2, 0, W * 0.25, H * 0.2, W * 0.7);
    a.addColorStop(0, "rgba(40, 70, 120, 0.14)");
    a.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, W, H);
    const b = ctx.createRadialGradient(W * 0.85, H * 0.75, 0, W * 0.85, H * 0.75, W * 0.55);
    b.addColorStop(0, "rgba(90, 40, 70, 0.09)");
    b.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = b;
    ctx.fillRect(0, 0, W, H);
  }

  function drawFieldStar(s, streak) {
    const p = projectFieldStar(s);
    if (!p.visible) return;
    if (p.x < -30 || p.x > W + 30 || p.y < -30 || p.y > H + 30) return;

    const bright = 0.25 + s.mag * 0.75;
    const core = 0.35 + s.mag * 1.5;
    const alpha = 0.18 + bright * 0.7;

    if (streak > 0.05) {
      const len = streak * (4 + s.mag * 22) * clamp(80 / p.depth, 0.3, 2.5);
      const dx = basis.fx * len * focal * 0.002;
      const dy = -basis.fy * len * focal * 0.002;
      ctx.strokeStyle = `rgba(${s.r},${s.g},${s.b},${alpha * 0.5})`;
      ctx.lineWidth = Math.max(0.5, core * 0.3);
      ctx.beginPath();
      ctx.moveTo(p.x - dx, p.y - dy);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    if (s.mag > 0.55) {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, core * 6);
      g.addColorStop(0, `rgba(${s.r},${s.g},${s.b},${0.2 * bright})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, core * 6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = `rgba(${s.r},${s.g},${s.b},${alpha})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, core, 0, Math.PI * 2);
    ctx.fill();

    if (s.flare || s.mag > 0.88) {
      const spike = core * (8 + s.mag * 14);
      ctx.strokeStyle = `rgba(${s.r},${s.g},${s.b},${0.22 * bright})`;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(p.x - spike, p.y);
      ctx.lineTo(p.x + spike, p.y);
      ctx.moveTo(p.x, p.y - spike * 0.7);
      ctx.lineTo(p.x, p.y + spike * 0.7);
      ctx.stroke();
    }
  }

  function drawLockReticle(x, y, size, label) {
    const r = Math.max(18, size * 1.85);
    const tick = 8;
    ctx.strokeStyle = "rgba(240, 193, 75, 0.9)";
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
    if (throttle > 0.75) return;
    ctx.font = "500 11px 'IBM Plex Sans', sans-serif";
    ctx.fillStyle = "rgba(220, 230, 245, 0.55)";
    ctx.textAlign = "center";
    ctx.fillText(`${title}  ·  ${dist}`, x, y);
  }

  function drawStarSystem(sys) {
    const { p, size } = systemScreen(sys);
    if (!p.visible) return;
    const [r, g, b] = sys.hue;

    const glowR = size * 3.8;
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
    glow.addColorStop(0, `rgba(${r},${g},${b},0.55)`);
    glow.addColorStop(0.2, `rgba(${r},${g},${b},0.22)`);
    glow.addColorStop(0.55, `rgba(${r},${g},${b},0.06)`);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
    ctx.fill();

    const core = ctx.createRadialGradient(p.x - size * 0.15, p.y - size * 0.15, 0, p.x, p.y, size);
    core.addColorStop(0, "#fff8e8");
    core.addColorStop(0.35, `rgb(${r},${g},${b})`);
    core.addColorStop(1, `rgba(${Math.floor(r * 0.5)},${Math.floor(g * 0.4)},${Math.floor(b * 0.2)},0.9)`);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fill();

    const spike = size * 5.5;
    ctx.strokeStyle = `rgba(${r},${g},${b},0.28)`;
    ctx.lineWidth = Math.max(0.8, size * 0.06);
    ctx.beginPath();
    ctx.moveTo(p.x - spike, p.y);
    ctx.lineTo(p.x + spike, p.y);
    ctx.moveTo(p.x, p.y - spike * 0.65);
    ctx.lineTo(p.x, p.y + spike * 0.65);
    ctx.stroke();

    if (locked && locked.id === sys.id) drawLockReticle(p.x, p.y, size, sys.label);
    else drawLabel(p.x, p.y + size * 2.2, sys.label, `${sys.distLy.toFixed(1)} ly`);
  }

  function drawBlackHole(sys) {
    const { p, size } = systemScreen(sys);
    if (!p.visible) return;
    sys.spin = (sys.spin || 0) + 0.004 * (0.4 + throttle);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(sys.spin);
    ctx.scale(1, 0.42);
    const disk = ctx.createRadialGradient(0, 0, size * 0.5, 0, 0, size * 2.6);
    disk.addColorStop(0, "rgba(255,210,120,0)");
    disk.addColorStop(0.4, "rgba(255,170,70,0.55)");
    disk.addColorStop(0.7, "rgba(200,70,40,0.28)");
    disk.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = disk;
    ctx.beginPath();
    ctx.arc(0, 0, size * 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,230,170,0.65)";
    ctx.lineWidth = Math.max(1, size * 0.1);
    ctx.beginPath();
    ctx.arc(0, 0, size * 1.05, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    const shadow = ctx.createRadialGradient(p.x, p.y, size * 0.2, p.x, p.y, size * 1.15);
    shadow.addColorStop(0, "#000");
    shadow.addColorStop(0.75, "#000");
    shadow.addColorStop(0.88, "rgba(255,190,120,0.4)");
    shadow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size * 1.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(p.x, p.y, size * 0.52, 0, Math.PI * 2);
    ctx.fill();

    if (locked && locked.id === sys.id) drawLockReticle(p.x, p.y, size, sys.label);
    else drawLabel(p.x, p.y + size * 2.4, sys.label, `${sys.distLy.toFixed(0)} ly`);
  }

  function drawNeutron(sys) {
    const { p, size } = systemScreen(sys);
    if (!p.visible) return;
    sys.spin = (sys.spin || 0) + (sys.spinRate || 0.04);

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(sys.spin);
    const beam = ctx.createLinearGradient(0, -size * 7, 0, size * 7);
    beam.addColorStop(0, "rgba(140,200,255,0)");
    beam.addColorStop(0.48, "rgba(170,220,255,0.35)");
    beam.addColorStop(0.5, "rgba(255,255,255,0.75)");
    beam.addColorStop(0.52, "rgba(170,220,255,0.35)");
    beam.addColorStop(1, "rgba(140,200,255,0)");
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(-size * 0.12, -size * 7);
    ctx.lineTo(size * 0.12, -size * 7);
    ctx.lineTo(size * 0.28, size * 7);
    ctx.lineTo(-size * 0.28, size * 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    const core = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 2.2);
    core.addColorStop(0, "rgba(255,255,255,1)");
    core.addColorStop(0.35, "rgba(160,210,255,0.85)");
    core.addColorStop(1, "rgba(60,100,200,0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size * 2.2, 0, Math.PI * 2);
    ctx.fill();

    if (locked && locked.id === sys.id) drawLockReticle(p.x, p.y, size, sys.label);
    else drawLabel(p.x, p.y + size * 3, sys.label, `${sys.distLy.toFixed(0)} ly`);
  }

  function projectLocal(x, y, z) {
    // local debris in camera-forward frame
    const f = 280 / z;
    return { x: W * 0.5 + x * f, y: H * 0.5 + y * f, s: f };
  }

  function drawRock(d, p) {
    const size = d.size * p.s * 0.35;
    if (size < 0.4) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(d.spin);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const jagged = 0.7 + 0.3 * Math.sin(d.seed + i * 1.9);
      const rr = size * jagged;
      const px = Math.cos(a) * rr;
      const py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(95, 88, 80, 0.9)";
    ctx.fill();
    ctx.strokeStyle = "rgba(40, 35, 30, 0.7)";
    ctx.stroke();
    ctx.restore();
  }

  function drawSat(d, p) {
    const size = d.size * p.s * 0.4;
    if (size < 0.5) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(d.spin);
    ctx.fillStyle = "rgba(55, 95, 150, 0.85)";
    ctx.fillRect(-size * 1.6, -size * 0.18, size * 1.0, size * 0.36);
    ctx.fillRect(size * 0.6, -size * 0.18, size * 1.0, size * 0.36);
    ctx.fillStyle = "rgba(210, 215, 220, 0.95)";
    ctx.fillRect(-size * 0.4, -size * 0.28, size * 0.8, size * 0.56);
    ctx.restore();
  }

  function updateLocal() {
    const vz = 0.015 + throttle * 0.12;
    for (const d of debris) {
      d.z -= vz;
      d.spin += d.spinRate;
      if (d.z < LOCAL_NEAR * 0.6) {
        d.z = rand(LOCAL_FAR * 0.7, LOCAL_FAR);
        d.x = rand(-80, 80);
        d.y = rand(-50, 50);
      }
    }
    const sorted = debris.slice().sort((a, b) => b.z - a.z);
    for (const d of sorted) {
      const p = projectLocal(d.x, d.y, d.z);
      if (p.x < -40 || p.x > W + 40 || p.y < -40 || p.y > H + 40) continue;
      if (d.kind === "sat") drawSat(d, p);
      else drawRock(d, p);
    }
  }

  function spawnMeteor() {
    const side = Math.random() > 0.5 ? 1 : -1;
    meteors.push({
      x: side * rand(40, 100),
      y: rand(-35, 35),
      z: rand(30, 90),
      vx: rand(-0.2, 0.2),
      vy: rand(-0.05, 0.05),
      vz: -(0.35 + throttle * 1.2),
      life: rand(90, 160),
      heat: rand(0.7, 1),
    });
  }

  function updateMeteors() {
    meteorCD -= 1 + throttle * 2;
    if (meteorCD <= 0) {
      if (Math.random() < 0.35 + throttle * 0.4) spawnMeteor();
      meteorCD = rand(140, 280) - throttle * 60;
    }
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.x += m.vx; m.y += m.vy; m.z += m.vz; m.life -= 1;
      if (m.life <= 0 || m.z < 4) {
        meteors.splice(i, 1);
        continue;
      }
      const p = projectLocal(m.x, m.y, m.z);
      const p2 = projectLocal(m.x - m.vx * 4, m.y - m.vy * 4, m.z - m.vz * 4);
      const w = clamp(2.5 * (280 / m.z), 0.6, 2.2);
      const trail = ctx.createLinearGradient(p2.x, p2.y, p.x, p.y);
      trail.addColorStop(0, "rgba(255,160,60,0)");
      trail.addColorStop(0.5, `rgba(255,170,80,${0.25 * m.heat})`);
      trail.addColorStop(1, `rgba(255,240,210,${0.85 * m.heat})`);
      ctx.strokeStyle = trail;
      ctx.lineWidth = w;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,245,220,${0.9 * m.heat})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, w * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function distLyFromCam(sys) {
    return Math.hypot(sys.x - camX, sys.y - camY, sys.z - camZ) / LY;
  }

  function updateHud() {
    if (hudVel) {
      hudVel.textContent = `${(0.02 + throttle * 2.4).toFixed(2)} ly/h`;
    }
    if (hudRange) {
      let ly;
      if (locked) ly = distLyFromCam(locked);
      else {
        ly = Infinity;
        for (const s of systems) {
          const { p } = systemScreen(s);
          if (p.visible) ly = Math.min(ly, distLyFromCam(s));
        }
        if (ly === Infinity) ly = systems[0] ? distLyFromCam(systems[0]) : 0;
      }
      hudRange.textContent = `${ly.toFixed(1)} ly`;
    }
    if (hudLock) hudLock.textContent = locked ? locked.label : "—";
  }

  function applyLook() {
    // W look up, S look down (screen-natural), A/D yaw — no pitch stop
    if (keys.a) yaw -= TURN;
    if (keys.d) yaw += TURN;
    if (keys.w) pitch += TURN; // look up
    if (keys.s) pitch -= TURN; // look down
    // keep numbers stable only — still fully continuous / unbounded
    yaw = wrapAngle(yaw);
    pitch = wrapAngle(pitch + Math.PI) - Math.PI;

    if (locked && !(keys.w || keys.a || keys.s || keys.d)) {
      const aim = lookAnglesTo(locked.x, locked.y, locked.z);
      yaw = wrapAngle(yaw + shortestAngle(yaw, aim.yaw) * LOCK_LERP);
      // pitch lerp without clamping to a cone
      let pd = aim.pitch - pitch;
      if (pd > Math.PI) pd -= Math.PI * 2;
      if (pd < -Math.PI) pd += Math.PI * 2;
      pitch += pd * LOCK_LERP;
    }
  }

  function frame() {
    time += 1;
    applyLook();
    updateBasis();

    throttle += ((keys.shift ? 1 : 0) - throttle) * 0.05;

    // cruise: translate through infinite space along look vector
    if (throttle > 0.02) {
      const speed = 0.35 + throttle * 6.5;
      camX += basis.fx * speed;
      camY += basis.fy * speed;
      camZ += basis.fz * speed;
    }

    ctx.fillStyle = "#060a14";
    ctx.fillRect(0, 0, W, H);
    drawNebula();

    const streak = throttle * throttle;
    for (const s of field) drawFieldStar(s, streak);

    const sorted = systems.slice().sort((a, b) => distLyFromCam(b) - distLyFromCam(a));
    for (const sys of sorted) {
      if (sys.kind === "star") drawStarSystem(sys);
      else if (sys.kind === "blackhole") drawBlackHole(sys);
      else if (sys.kind === "neutron") drawNeutron(sys);
    }

    updateLocal();
    updateMeteors();
    updateHud();

    // center cue
    ctx.fillStyle = `rgba(240, 200, 100, ${0.25 + throttle * 0.35})`;
    ctx.beginPath();
    ctx.arc(W * 0.5, H * 0.5, 2, 0, Math.PI * 2);
    ctx.fill();

    const hover = pickSystem(pointerX, pointerY);
    if (hover && (!locked || locked.id !== hover.id)) {
      const { p, size } = systemScreen(hover);
      ctx.strokeStyle = "rgba(220, 230, 245, 0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(14, size * 1.6), 0, Math.PI * 2);
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
    for (const s of field) drawFieldStar(s, 0);
    for (const sys of systems) {
      if (sys.kind === "star") drawStarSystem(sys);
      else if (sys.kind === "blackhole") drawBlackHole(sys);
      else if (sys.kind === "neutron") drawNeutron(sys);
    }
  }

  window.addEventListener("resize", () => {
    const keep = { field, systems, debris, locked, camX, camY, camZ, yaw, pitch };
    resize();
    field = keep.field;
    systems = keep.systems;
    debris = keep.debris;
    camX = keep.camX; camY = keep.camY; camZ = keep.camZ;
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
    keys.w = keys.a = keys.s = keys.d = keys.shift = false;
  });

  resize();
  initField();
  initSystems();
  initDebris();
  updateBasis();

  if (reduced) {
    drawStatic();
    const hint = document.getElementById("warp-hint");
    if (hint) hint.hidden = true;
  } else {
    frame();
  }

  document.addEventListener("visibilitychange", () => {
    if (reduced) return;
    if (document.hidden) cancelAnimationFrame(raf);
    else frame();
  });
})();
