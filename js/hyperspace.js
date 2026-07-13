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

  const FIELD = 1600;
  const TURN = 0.024;
  const LOCK_LERP = 0.06;
  const PICK_PAD = 28;
  const FOV = 1.05;
  const CELL = 3200;
  const HALF = CELL * 0.5;

  // —— scale (gameplay-compressed, ratios kept) ——
  // 1 ly in world units; solar radius so a star fills view when you get "close"
  const LY = 1200;
  const R_SUN = LY * 0.0045; // ~compressed solar radius
  const C = LY * 0.15; // c in world-units / second (game light speed)
  const THRUST = C * 0.35; // acceleration (wu/s²) while holding Shift
  const MAX_BETA = 0.92; // soft relativistic cap

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

  const keys = { w: false, a: false, s: false, d: false, shift: false };

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
    systems = [
      placeSystem({
        id: "sol-analogue", label: "G2V primary", kind: "star",
        th: 0.55, ph: -0.12, distLy: 4.2, rSun: 1.0, hue: [255, 214, 140],
      }),
      placeSystem({
        id: "blue-giant", label: "B-type giant", kind: "star",
        th: 2.4, ph: 0.22, distLy: 18, rSun: 8.0, hue: [180, 210, 255],
      }),
      placeSystem({
        id: "red-dwarf", label: "K-dwarf", kind: "star",
        th: 4.1, ph: -0.35, distLy: 9.5, rSun: 0.7, hue: [255, 150, 110],
      }),
      placeSystem({
        id: "bh-1", label: "Stellar BH", kind: "blackhole",
        th: 1.2, ph: 0.08, distLy: 32, rSun: 2.5, hue: [255, 180, 80], spin: 0,
      }),
      placeSystem({
        id: "psr", label: "Millisecond pulsar", kind: "neutron",
        th: 5.0, ph: 0.18, distLy: 24, rSun: 0.12, spin: 0, spinRate: 0.05,
      }),
      placeSystem({
        id: "psr-2", label: "Radio pulsar", kind: "neutron",
        th: 3.3, ph: -0.28, distLy: 41, rSun: 0.1, spin: 1.2, spinRate: -0.035,
      }),
    ];
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
      const hitR = Math.max(PICK_PAD, size * 1.35);
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
    const a = ctx.createRadialGradient(W * 0.25, H * 0.2, 0, W * 0.25, H * 0.2, W * 0.7);
    a.addColorStop(0, "rgba(40, 70, 120, 0.12)");
    a.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, W, H);
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
    if (b >= 0.01) return `${b.toFixed(3)} c`;
    // map game units → illustrative km/s
    const kms = (spd / LY) * 299792.458 * 0.15; // tied to compressed c
    if (kms >= 1) return `${kms.toFixed(0)} km/s`;
    return `${(kms * 1000).toFixed(0)} m/s`;
  }

  /** Solid limb-darkened sphere (close approach). */
  function drawSolidSphere(p, size, hue, opts = {}) {
    const [r, g, b] = hue;
    const litX = p.x - size * 0.28;
    const litY = p.y - size * 0.32;

    if (opts.corona && size < W * 0.45) {
      const glowR = size * (opts.coronaScale || 2.4);
      const glow = ctx.createRadialGradient(p.x, p.y, size * 0.9, p.x, p.y, glowR);
      glow.addColorStop(0, `rgba(${r},${g},${b},0.35)`);
      glow.addColorStop(0.45, `rgba(${r},${g},${b},0.08)`);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
      ctx.fill();
    }

    // photosphere / solid body with limb darkening
    const body = ctx.createRadialGradient(litX, litY, size * 0.05, p.x, p.y, size);
    if (opts.darkCore) {
      body.addColorStop(0, "#0a0a0a");
      body.addColorStop(0.55, "#000");
      body.addColorStop(0.82, `rgba(${r},${g},${b},0.55)`);
      body.addColorStop(1, "rgba(0,0,0,0.9)");
    } else {
      body.addColorStop(0, opts.hotCore || "#fff8e8");
      body.addColorStop(0.35, `rgb(${r},${g},${b})`);
      body.addColorStop(0.78, `rgb(${Math.floor(r * 0.55)},${Math.floor(g * 0.45)},${Math.floor(b * 0.35)})`);
      body.addColorStop(1, `rgb(${Math.floor(r * 0.2)},${Math.floor(g * 0.15)},${Math.floor(b * 0.12)})`);
    }
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fill();

    // diffraction only when still small on screen
    if (!opts.darkCore && size < 28) {
      const spike = size * 5;
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
    if (!p.visible || size < 0.4) return;
    const close = size > 22;
    drawSolidSphere(p, size, sys.hue, {
      corona: !close || size < W * 0.35,
      coronaScale: close ? 1.6 : 3.2,
    });
    if (locked && locked.id === sys.id) drawLockReticle(p.x, p.y, size, sys.label);
    else if (size < H * 0.35) {
      drawLabel(p.x, p.y + size + 14, sys.label, formatDist(dist / LY));
    }
  }

  function drawBlackHole(sys) {
    const { p, size, dist } = systemScreen(sys);
    if (!p.visible || size < 0.4) return;
    sys.spin = (sys.spin || 0) + 0.003;

    // accretion disk (edge-on-ish ellipse) — outside horizon
    if (size < W * 0.6) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(sys.spin);
      ctx.scale(1, 0.38);
      const disk = ctx.createRadialGradient(0, 0, size * 0.7, 0, 0, size * 2.8);
      disk.addColorStop(0, "rgba(255,210,120,0)");
      disk.addColorStop(0.4, "rgba(255,160,60,0.5)");
      disk.addColorStop(0.75, "rgba(180,50,30,0.25)");
      disk.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = disk;
      ctx.beginPath();
      ctx.arc(0, 0, size * 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawSolidSphere(p, size, sys.hue || [255, 180, 80], { darkCore: true });

    if (locked && locked.id === sys.id) drawLockReticle(p.x, p.y, size, sys.label);
    else if (size < H * 0.35) {
      drawLabel(p.x, p.y + size + 14, sys.label, formatDist(dist / LY));
    }
  }

  function drawNeutron(sys) {
    const { p, size, dist } = systemScreen(sys);
    if (!p.visible || size < 0.3) return;
    sys.spin = (sys.spin || 0) + (sys.spinRate || 0.04);

    if (size < 80) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(sys.spin);
      const beam = ctx.createLinearGradient(0, -size * 8, 0, size * 8);
      beam.addColorStop(0, "rgba(140,200,255,0)");
      beam.addColorStop(0.5, "rgba(220,240,255,0.55)");
      beam.addColorStop(1, "rgba(140,200,255,0)");
      ctx.fillStyle = beam;
      ctx.fillRect(-size * 0.15, -size * 8, size * 0.3, size * 16);
      ctx.restore();
    }

    drawSolidSphere(p, Math.max(size, 2), [200, 220, 255], {
      hotCore: "#ffffff",
      corona: true,
      coronaScale: 2.8,
    });

    if (locked && locked.id === sys.id) drawLockReticle(p.x, p.y, size, sys.label);
    else if (size < H * 0.35) {
      drawLabel(p.x, p.y + size + 14, sys.label, formatDist(dist / LY));
    }
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

    // thrust along look — vacuum coast otherwise (no drag)
    if (keys.shift) {
      velX += basis.fx * THRUST * dt;
      velY += basis.fy * THRUST * dt;
      velZ += basis.fz * THRUST * dt;
    }

    // soft relativistic speed cap
    let spd = speed();
    const maxV = MAX_BETA * C;
    if (spd > maxV) {
      const s = maxV / spd;
      velX *= s; velY *= s; velZ *= s;
      spd = maxV;
    }

    camX += velX * dt;
    camY += velY * dt;
    camZ += velZ * dt;
    collideBodies(dt);
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
    if (keys.w) pitch += TURN;
    if (keys.s) pitch -= TURN;
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

    updateHud();

    ctx.fillStyle = `rgba(240, 200, 100, ${0.25 + Math.min(0.4, beta())})`;
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
    Object.assign(window, {});
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
