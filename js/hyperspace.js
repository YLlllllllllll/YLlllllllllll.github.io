/**
 * Hybrid space backdrop:
 * - Original click-to-boost hyperspace star streaks (WarpSpeed-style)
 * - Approachable planets/stars in world space
 *
 * LMB / Space = warp boost · RMB hold+drag = look (angle stays on release)
 * RMB click = lock body · Ctrl = reverse thrust (can go negative / flee)
 */
(() => {
  const canvas = document.getElementById("hyperspace");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: false });
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const STAR_COUNT = 1100;
  const DEPTH = 1000;
  const LY = 900;
  /** Solar radius — large enough that close approaches fill a human FOV */
  const R_SUN = LY * 0.032;
  const PICK_PAD = 34;
  const FOCAL_K = 1.05;
  const MAX_PITCH = 1.2;
  /** rad per pixel while RMB-dragging */
  const LOOK_SENS = 0.0042;
  /** movement above this → drag look; below → click lock */
  const CLICK_SLOP = 7;

  let W = 0;
  let H = 0;
  let dpr = 1;
  let cx = 0;
  let cy = 0;

  // classic warp speed (original feel)
  let speed = 0.55;
  let targetSpeed = 0.55;
  let boost = false;
  let brake = false;

  // world flight — true camera orientation (yaw around Y, pitch up/down)
  let camX = 0;
  let camY = 0;
  let camZ = 0;
  let yaw = 0;
  let pitch = 0;
  let time = 0;
  let raf = 0;
  let pointerX = 0;
  let pointerY = 0;
  /** @type {object|null} */
  let locked = null;

  // RMB look: hold+drag turns view; release freezes angle (stable aim)
  let rmbHeld = false;
  let lookDragged = false;
  let lookStartX = 0;
  let lookStartY = 0;
  let lookLastX = 0;
  let lookLastY = 0;

  let stars = [];
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

  function map(v, a1, a2, b1, b2) {
    return b1 + ((v - a1) * (b2 - b1)) / (a2 - a1);
  }

  function hash01(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function resetStar(star, randomZ) {
    star.x = (Math.random() - 0.5) * W * 1.5;
    star.y = (Math.random() - 0.5) * H * 1.5;
    star.z = randomZ ? Math.random() * DEPTH : DEPTH;
    star.pz = star.z;
    const tint = Math.random();
    if (tint > 0.82) {
      star.r = 240; star.g = 193; star.b = 75;
    } else if (tint > 0.65) {
      star.r = 170; star.g = 210; star.b = 255;
    } else {
      star.r = 244; star.g = 239; star.b = 228;
    }
  }

  function initStars() {
    stars = Array.from({ length: STAR_COUNT }, () => {
      const s = {};
      resetStar(s, true);
      return s;
    });
  }

  function dirFromAngles(th, ph) {
    return {
      x: Math.sin(th) * Math.cos(ph),
      y: Math.sin(ph),
      z: Math.cos(th) * Math.cos(ph),
    };
  }

  function placeSystem(opts) {
    const d = opts.distLy * LY;
    const dir = dirFromAngles(opts.th, opts.ph);
    const rSun = opts.rSun ?? 1;
    return {
      ...opts,
      x: dir.x * d,
      y: dir.y * d,
      z: dir.z * d + 40, // ahead of origin
      radius: R_SUN * rSun,
    };
  }

  function initSystems() {
    if (systems.length) return;
    const catalog = [
      // —— featured destinations (closer, distinctive) ——
      { id: "sol", label: "Sol · G2V 恒星", kind: "star", featured: true, th: 0.06, ph: -0.02, distLy: 2.4, rSun: 1.15, hue: [255, 214, 140] },
      { id: "redgiant", label: "Betel-X · 红巨星", kind: "star", featured: true, th: -0.42, ph: 0.12, distLy: 3.8, rSun: 28, hue: [255, 95, 55] },
      { id: "supergiant", label: "UY-Analog · 超巨星", kind: "star", featured: true, th: 0.72, ph: 0.08, distLy: 5.5, rSun: 42, hue: [255, 140, 110] },
      { id: "binary", label: "Sirius-pair · 双星", kind: "binary", featured: true, th: 0.28, ph: -0.1, distLy: 2.8,
        // near-equal masses so BOTH clearly orbit the barycenter (not a moon)
        rSun: 1.25, hue: [255, 235, 190], companionR: 1.05, companionHue: [140, 190, 255],
        orbitSpeed: 0.85 },
      { id: "bh-core", label: "Eventide · 黑洞", kind: "blackhole", featured: true, th: 0.95, ph: 0.04, distLy: 3.2, rSun: 5.2, hue: [255, 170, 70], spin: 0, mass: 48 },
      // DSP-like: tiny luminous core + huge jets / magnetic particle flow (not a fat ball)
      { id: "pulsar", label: "PSR-Δ · 中子星", kind: "neutron", featured: true, th: -0.78, ph: 0.16, distLy: 2.8, rSun: 0.045, spin: 0, spinRate: 0.22, hue: [210, 235, 255] },
      { id: "dyson", label: "Helios Cage · 戴森球文明", kind: "dyson", featured: true, th: -0.18, ph: -0.06, distLy: 2.4, rSun: 1.2, hue: [255, 220, 150], shell: 2.55 },
      { id: "mega", label: "Titan-α · 超大类地", kind: "planet", featured: true, biome: "mediterranean", th: 0.18, ph: 0.09, distLy: 1.15, rSun: 4.6 },
      { id: "gas-mega", label: "Leviathan · 巨型气态", kind: "planet", featured: true, biome: "gas_cream", th: -0.32, ph: -0.04, distLy: 1.45, rSun: 9.5, rings: true },
      { id: "med", label: "Mediterranean", kind: "planet", biome: "mediterranean", th: 0.5, ph: -0.15, distLy: 2.2, rSun: 0.55 },
      { id: "lava", label: "Lava World", kind: "planet", biome: "lava", th: 0.65, ph: 0.12, distLy: 2.5, rSun: 0.6 },
      { id: "ice", label: "Ice World", kind: "planet", biome: "ice", th: -0.7, ph: 0.18, distLy: 2.9, rSun: 0.5, rings: true, ringTint: [180, 210, 255] },
    ];

    systems = catalog.map((opts) => {
      const body = placeSystem(opts);
      if (body.kind === "binary") {
        // Two stars orbit a shared barycenter (not planet–moon). Mass ~ R³.
        const r1 = body.radius;
        const r2 = R_SUN * (opts.companionR || 0.9);
        body.mass1 = Math.pow(opts.rSun || 1, 3);
        body.mass2 = Math.pow(opts.companionR || 0.9, 3);
        // Prefer near-equal demo masses when ratio would look like a satellite
        if (body.mass1 / body.mass2 > 2.2) {
          const mean = (body.mass1 + body.mass2) * 0.5;
          body.mass1 = mean * 1.15;
          body.mass2 = mean * 0.85;
        }
        body.sep = (r1 + r2) * 4.2; // wide pair — motion easy to read
        body.incl = 0.55; // steeper plane so both tracks read in 2D
        body.orbitA = 0;
        body.orbitSpeed = opts.orbitSpeed || 0.5;
        body.primary = {
          x: body.x, y: body.y, z: body.z,
          radius: r1,
          hue: body.hue || [255, 230, 180],
          kind: "star",
          id: `${body.id}-a`,
        };
        body.comp = {
          x: body.x, y: body.y, z: body.z,
          radius: r2,
          hue: opts.companionHue || [180, 210, 255],
          kind: "star",
          id: `${body.id}-b`,
        };
        updateBinaryPositions(body);
      }
      return body;
    });

    // filler worlds
    const biomes = ["mediterranean", "arid", "ice", "lava", "ocean", "ashen", "pandora", "gas_blue"];
    for (let i = 0; i < 16; i++) {
      const biome = biomes[i % biomes.length];
      systems.push(placeSystem({
        id: `p-${i}`,
        label: `${biome} #${i + 1}`,
        kind: "planet",
        biome,
        th: rand(-1.2, 1.2),
        ph: rand(-0.4, 0.4),
        distLy: rand(6, 35),
        rSun: String(biome).startsWith("gas") ? rand(2, 4) : rand(0.4, 0.8),
      }));
    }
    for (let i = 0; i < 12; i++) {
      systems.push(placeSystem({
        id: `s-${i}`,
        label: `Field star #${i + 1}`,
        kind: "star",
        th: rand(-1.3, 1.3),
        ph: rand(-0.45, 0.45),
        distLy: rand(10, 50),
        rSun: rand(0.7, 2.5),
        hue: [255, 220, 160].map((c) => clamp(c + rand(-40, 20), 100, 255)),
      }));
    }

    // progressive idle bake — do not block first frames
    if (window.DSPTextures) window.DSPTextures.warm(systems);
  }

  function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  /** Camera basis: forward / right / up in world space. */
  function getBasis() {
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const forward = { x: sy * cp, y: sp, z: cy * cp };
    // right = normalize(forward × worldUp) with worldUp=(0,1,0) → (-forward.z, 0, forward.x) when level
    let rx = -forward.z;
    let rz = forward.x;
    let rLen = Math.hypot(rx, rz) || 1;
    rx /= rLen;
    rz /= rLen;
    const right = { x: rx, y: 0, z: rz };
    // up = right × forward
    const up = {
      x: right.y * forward.z - right.z * forward.y,
      y: right.z * forward.x - right.x * forward.z,
      z: right.x * forward.y - right.y * forward.x,
    };
    return { forward, right, up, focal: H * FOCAL_K };
  }

  function anglesTo(wx, wy, wz) {
    const dx = wx - camX;
    const dy = wy - camY;
    const dz = wz - camZ;
    const dist = Math.hypot(dx, dy, dz) || 1;
    return {
      yaw: Math.atan2(dx, dz),
      pitch: Math.asin(clamp(dy / dist, -0.99, 0.99)),
      dist,
      dx,
      dy,
      dz,
    };
  }

  /** Snap / ease camera to face a world point (puts it at view center). */
  function faceWorld(wx, wy, wz, t) {
    const a = anglesTo(wx, wy, wz);
    if (t >= 1) {
      yaw = a.yaw;
      pitch = a.pitch;
    } else {
      yaw = lerpAngle(yaw, a.yaw, t);
      pitch += (a.pitch - pitch) * t;
    }
    pitch = clamp(pitch, -MAX_PITCH, MAX_PITCH);
    return a;
  }

  /** Warp VFX live in view space — streaks always rush toward screen center (true forward). */
  function warpProject(x, y, z) {
    const k = DEPTH / Math.max(z, 0.001);
    return { x: x * k + cx, y: y * k + cy };
  }

  /** World body → screen via real camera orientation. */
  function projectWorld(wx, wy, wz) {
    const dx = wx - camX;
    const dy = wy - camY;
    const dz = wz - camZ;
    const dist = Math.hypot(dx, dy, dz);
    const { forward, right, up, focal } = getBasis();
    const vx = dx * right.x + dy * right.y + dz * right.z;
    const vy = dx * up.x + dy * up.y + dz * up.z;
    const vz = dx * forward.x + dy * forward.y + dz * forward.z;
    if (vz <= 0.5) return { x: 0, y: 0, visible: false, depth: vz, dist };
    return {
      x: cx + (vx / vz) * focal,
      y: cy - (vy / vz) * focal,
      visible: true,
      depth: vz,
      dist,
    };
  }

  function applyLookDelta(dx, dy) {
    yaw += dx * LOOK_SENS;
    pitch = clamp(pitch - dy * LOOK_SENS, -MAX_PITCH, MAX_PITCH);
  }

  function screenRadius(radius, dist) {
    // Sphere silhouette: angular radius α = arcsin(R/D), screen = f·tan(α) = f·R/√(D²−R²)
    // Plain R/D badly underestimates size when hugging the surface.
    if (!(dist > radius * 1.002)) {
      return Math.max(W, H) * 3.5; // on / inside surface → fill the view
    }
    const chord = Math.sqrt(dist * dist - radius * radius);
    const raw = (H * FOCAL_K) * (radius / Math.max(chord, radius * 0.02));
    return Math.min(raw, Math.max(W, H) * 4.5);
  }

  /** How close the camera may get. */
  function approachLimit(sys) {
    if (sys.kind === "binary") {
      const rMax = Math.max(sys.primary?.radius || sys.radius, sys.comp?.radius || 0);
      return (sys.sep || sys.radius * 2) * 0.5 + rMax * 1.05;
    }
    if (sys.kind === "blackhole") return sys.radius * 1.02; // almost on the horizon
    if (sys.kind === "neutron") return sys.radius * 1.35;
    if (sys.kind === "star" || sys.kind === "dyson") return sys.radius * 1.025;
    return sys.radius * 1.012; // planets — skim the cloud tops
  }

  /** Both components opposite the barycenter — Keplerian circular binary. */
  function updateBinaryPositions(sys) {
    const m1 = sys.mass1 || 1;
    const m2 = sys.mass2 || 1;
    const a = sys.sep || sys.radius * 3;
    const r1 = a * (m2 / (m1 + m2));
    const r2 = a * (m1 / (m1 + m2));
    const ca = Math.cos(sys.orbitA || 0);
    const sa = Math.sin(sys.orbitA || 0);
    const incl = sys.incl || 0.4;
    const ci = Math.cos(incl);
    const si = Math.sin(incl);
    if (sys.primary) {
      sys.primary.x = sys.x + ca * r1;
      sys.primary.y = sys.y + sa * r1 * ci;
      sys.primary.z = sys.z + sa * r1 * si;
    }
    if (sys.comp) {
      sys.comp.x = sys.x - ca * r2;
      sys.comp.y = sys.y - sa * r2 * ci;
      sys.comp.z = sys.z - sa * r2 * si;
    }
  }

  function drawStarComponent(star, prox) {
    const p = projectWorld(star.x, star.y, star.z);
    if (!p.visible) return;
    const size = screenRadius(star.radius, p.dist);
    if (size < 0.4) return;
    const hue = star.hue || [255, 220, 150];
    const [r, g, b] = hue;
    const tex = window.DSPTextures
      ? window.DSPTextures.get({ kind: "star", hue, id: star.id }, { lazy: true, priority: Math.floor(prox * 200 + size) })
      : null;

    const layers = 2 + Math.floor(prox * 2);
    for (let i = layers; i >= 1; i--) {
      const glowR = size * (1.2 + i * (0.5 + prox * 0.4));
      const alpha = (0.14 + prox * 0.25) / i;
      const glow = ctx.createRadialGradient(p.x, p.y, size * 0.8, p.x, p.y, glowR);
      glow.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
      glow.addColorStop(0.55, `rgba(${r},${g},${b},${alpha * 0.25})`);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
      ctx.fill();
    }
    if (tex) ctx.drawImage(tex, p.x - size, p.y - size, size * 2, size * 2);
    else {
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    if (size < 16 && prox < 0.2) {
      const spike = size * 5;
      ctx.strokeStyle = `rgba(${r},${g},${b},0.28)`;
      ctx.lineWidth = Math.max(0.7, size * 0.05);
      ctx.beginPath();
      ctx.moveTo(p.x - spike, p.y); ctx.lineTo(p.x + spike, p.y);
      ctx.moveTo(p.x, p.y - spike * 0.65); ctx.lineTo(p.x, p.y + spike * 0.65);
      ctx.stroke();
    }
  }

  function proximityDetail(size) {
    return clamp((size - 8) / Math.max(100, Math.min(W, H) * 0.28), 0, 1);
  }

  function systemScreen(sys) {
    const p = projectWorld(sys.x, sys.y, sys.z);
    if (!p.visible) return { p, size: 0, dist: p.dist || 0 };
    let rad = sys.radius;
    if (sys.kind === "binary") {
      rad = (sys.sep || sys.radius * 2) * 0.5
        + Math.max(sys.primary?.radius || 0, sys.comp?.radius || 0);
    }
    return { p, size: screenRadius(rad, p.dist), dist: p.dist };
  }

  function pickSystem(mx, my) {
    let best = null;
    let bestScore = Infinity;
    for (const sys of systems) {
      const { p, size } = systemScreen(sys);
      if (!p.visible) continue;
      const d = Math.hypot(p.x - mx, p.y - my);
      if (d <= Math.max(PICK_PAD, size * 1.45, 20) && d < bestScore) {
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
    cx = W * 0.5;
    cy = H * 0.5;
    pointerX = cx;
    pointerY = cy;
    if (!stars.length) initStars();
    if (!systems.length) initSystems();
  }

  function drawWarpStars() {
    // original motion-blur wash
    const reverse = speed < 0;
    ctx.fillStyle = `rgba(5, 8, 20, ${boost || reverse ? 0.26 : 0.4})`;
    ctx.fillRect(0, 0, W, H);

    const zStep = Math.abs(speed) * (boost || reverse ? 18 : 7.5);
    for (let i = 0; i < stars.length; i++) {
      const star = stars[i];
      star.pz = star.z;
      // reverse thrust: streaks rush outward from center
      star.z += reverse ? zStep : -zStep;

      if (star.z < 1 || star.z > DEPTH) {
        resetStar(star, false);
        if (reverse) star.z = 1 + Math.random() * 40;
        continue;
      }

      const p = warpProject(star.x, star.y, star.z);
      const pp = warpProject(star.x, star.y, star.pz);
      if (p.x < -50 || p.x > W + 50 || p.y < -50 || p.y > H + 50) {
        resetStar(star, false);
        continue;
      }

      const size = Math.max(0.4, map(star.z, 0, DEPTH, 3.2, 0.35));
      const alpha = map(star.z, 0, DEPTH, 1, 0.15);
      const color = `rgba(${star.r},${star.g},${star.b},${alpha})`;

      ctx.beginPath();
      ctx.moveTo(pp.x, pp.y);
      ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = "round";
      ctx.stroke();

      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(p.x, p.y, size * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function atmoColor(biome) {
    const map = {
      mediterranean: [120, 180, 255],
      arid: [220, 180, 120],
      ice: [180, 210, 255],
      lava: [255, 100, 40],
      ocean: [80, 150, 255],
      ashen: [160, 170, 180],
      pandora: [80, 255, 200],
      gas: [255, 200, 140],
      gas_blue: [140, 180, 255],
      gas_cream: [255, 220, 160],
    };
    return map[biome] || [140, 190, 255];
  }

  function isGasBiome(biome) {
    return biome === "gas" || String(biome || "").startsWith("gas_");
  }

  /** Saturn-style ring: pass "back" before sphere, "front" after. */
  function drawPlanetRing(sys, p, size, prox, pass) {
    if (!sys.rings && !(isGasBiome(sys.biome) && (sys.featured || (sys.rSun || 0) > 3))) return;
    const tint = sys.ringTint || (isGasBiome(sys.biome) ? [230, 210, 170] : [200, 210, 230]);
    const [rr, gg, bb] = tint;
    const tilt = sys.ringTilt ?? 0.38;
    const outer = size * (sys.ringScale || 1.85);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(tilt);
    ctx.scale(1, 0.3);
    // half-plane clip: back = top, front = bottom (appears behind / in front of globe)
    ctx.beginPath();
    if (pass === "back") ctx.rect(-outer * 3, -outer * 3, outer * 6, outer * 3);
    else ctx.rect(-outer * 3, 0, outer * 6, outer * 3);
    ctx.clip();

    const bands = [
      [1.18, 0.1, 0.22],
      [1.38, 0.14, 0.35],
      [1.58, 0.09, 0.18],
      [1.78, 0.06, 0.12],
    ];
    for (const [mul, w, a] of bands) {
      ctx.beginPath();
      ctx.arc(0, 0, size * mul, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${rr},${gg},${bb},${(a + prox * 0.25) * (pass === "front" ? 1 : 0.75)})`;
      ctx.lineWidth = Math.max(1.2, size * w);
      ctx.stroke();
    }
    // Cassini gap feel
    ctx.beginPath();
    ctx.arc(0, 0, size * 1.48, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(5,8,20,${0.35 + prox * 0.2})`;
    ctx.lineWidth = Math.max(1.5, size * 0.07);
    ctx.stroke();
    ctx.restore();
  }

  /** Scrolling cloud / band overlay clipped to disk (near approach only). */
  function drawNearSurfaceDetail(sys, p, size, prox) {
    if (sys.kind !== "planet" || prox < 0.28 || size < 16) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, size * 0.99, 0, Math.PI * 2);
    ctx.clip();

    if (isGasBiome(sys.biome)) {
      const [ar, ag, ab] = atmoColor(sys.biome);
      for (let i = 0; i < 7; i++) {
        const y = p.y - size + (i / 6) * size * 2 + Math.sin(time * 0.4 + i) * size * 0.02;
        const h = size * (0.06 + (i % 3) * 0.02);
        const drift = ((time * (8 + i) + i * 40) % (size * 2.4)) - size * 1.2;
        const g = ctx.createLinearGradient(p.x - size, y, p.x + size, y);
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(0.35, `rgba(${ar},${ag},${ab},${0.04 + prox * 0.08})`);
        g.addColorStop(0.5, `rgba(255,255,255,${0.05 + prox * 0.1})`);
        g.addColorStop(0.65, `rgba(${ar},${ag},${ab},${0.04 + prox * 0.08})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(p.x - size + drift * 0.15, y - h / 2, size * 2, h);
      }
    } else if (sys.biome === "lava") {
      for (let i = 0; i < 10; i++) {
        const a = hash01(i * 11 + 2) * Math.PI * 2 + time * 0.35;
        const rad = size * (0.2 + hash01(i * 5) * 0.7);
        const px = p.x + Math.cos(a) * rad * 0.85;
        const py = p.y + Math.sin(a) * rad * 0.75;
        const glow = ctx.createRadialGradient(px, py, 0, px, py, size * 0.12);
        const pulse = 0.5 + 0.5 * Math.sin(time * 3 + i);
        glow.addColorStop(0, `rgba(255,200,80,${(0.25 + prox * 0.35) * pulse})`);
        glow.addColorStop(1, "rgba(255,60,0,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(px, py, size * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // soft nephogram clouds drifting
      const [ar, ag, ab] = atmoColor(sys.biome);
      for (let i = 0; i < 5; i++) {
        const base = hash01(i * 17 + (sys.id || "").length);
        const cx0 = p.x + (base - 0.5) * size * 1.4 + Math.sin(time * 0.25 + i) * size * 0.08;
        const cy0 = p.y + (hash01(i * 9) - 0.5) * size * 1.1;
        const rw = size * (0.28 + hash01(i * 3) * 0.25);
        const rh = size * (0.1 + hash01(i * 4) * 0.08);
        const cloud = ctx.createRadialGradient(cx0, cy0, 0, cx0, cy0, rw);
        cloud.addColorStop(0, `rgba(255,255,255,${0.1 + prox * 0.22})`);
        cloud.addColorStop(0.5, `rgba(${ar},${ag},${ab},${0.06 + prox * 0.1})`);
        cloud.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = cloud;
        ctx.beginPath();
        ctx.ellipse(cx0, cy0, rw, rh, base * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      // night-side city lights (terrestrial / mega)
      if (prox > 0.45 && (sys.biome === "mediterranean" || sys.biome === "ocean" || sys.biome === "pandora" || sys.featured)) {
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < 18; i++) {
          const u = hash01(i * 13 + 1);
          const v = hash01(i * 7 + 3);
          // prefer right limb as "night"
          if (u < 0.42) continue;
          const px = p.x - size + u * size * 2;
          const py = p.y - size + v * size * 2;
          const dx = (px - p.x) / size;
          const dy = (py - p.y) / size;
          if (dx * dx + dy * dy > 0.92) continue;
          const twinkle = 0.55 + 0.45 * Math.sin(time * 5 + i * 1.7);
          ctx.fillStyle = `rgba(255, 220, 140, ${(0.15 + prox * 0.35) * twinkle})`;
          ctx.fillRect(px, py, Math.max(1, size * 0.015), Math.max(1, size * 0.015));
        }
        ctx.globalCompositeOperation = "source-over";
      }
    }
    ctx.restore();
  }

  /** Soft terminator + rim light — cheap sphere shading on top of bake. */
  function drawTerminator(p, size, prox) {
    if (size < 8) return;
    const g = ctx.createLinearGradient(p.x - size * 0.9, p.y - size * 0.3, p.x + size * 0.85, p.y + size * 0.2);
    g.addColorStop(0, `rgba(0,0,0,${0.22 + prox * 0.18})`);
    g.addColorStop(0.42, "rgba(0,0,0,0)");
    g.addColorStop(0.72, "rgba(255,255,255,0)");
    g.addColorStop(1, `rgba(255,255,255,${0.06 + prox * 0.08})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size * 0.995, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawRedGiantProminence(p, size, prox, hue) {
    const [r, g, b] = hue;
    for (let i = 0; i < 5; i++) {
      const a = time * 0.3 + i * 1.3;
      const len = size * (0.35 + 0.25 * Math.sin(time * 1.2 + i));
      const x0 = p.x + Math.cos(a) * size * 0.92;
      const y0 = p.y + Math.sin(a) * size * 0.92;
      const x1 = p.x + Math.cos(a) * (size + len);
      const y1 = p.y + Math.sin(a) * (size + len);
      const grd = ctx.createLinearGradient(x0, y0, x1, y1);
      grd.addColorStop(0, `rgba(${r},${g},${b},${0.35 + prox * 0.3})`);
      grd.addColorStop(1, "rgba(255,80,40,0)");
      ctx.strokeStyle = grd;
      ctx.lineWidth = Math.max(2, size * 0.04);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(
        p.x + Math.cos(a + 0.4) * (size + len * 0.5),
        p.y + Math.sin(a + 0.4) * (size + len * 0.5),
        x1, y1
      );
      ctx.stroke();
    }
  }

  /** Runtime: baked texture + cheap corona/atmosphere (DSP look, low CPU). */
  function drawBody(sys, p, size, prox) {
    // Binary: two stars around barycenter — no tether, no planet–moon hierarchy
    if (sys.kind === "binary") {
      // draw farther component first
      const d1 = sys.primary
        ? Math.hypot(sys.primary.x - camX, sys.primary.y - camY, sys.primary.z - camZ)
        : 0;
      const d2 = sys.comp
        ? Math.hypot(sys.comp.x - camX, sys.comp.y - camY, sys.comp.z - camZ)
        : 0;
      if (d1 >= d2) {
        if (sys.primary) drawStarComponent(sys.primary, prox);
        if (sys.comp) drawStarComponent(sys.comp, prox);
      } else {
        if (sys.comp) drawStarComponent(sys.comp, prox);
        if (sys.primary) drawStarComponent(sys.primary, prox);
      }
      if (sys.featured && size > 4 && size < H * 0.4) {
        ctx.font = "600 10px 'IBM Plex Sans', sans-serif";
        ctx.fillStyle = "rgba(240,193,75,0.75)";
        ctx.textAlign = "center";
        ctx.fillText("★ FEATURED", p.x, p.y - size - 8);
      }
      return;
    }

    const tex = window.DSPTextures
      ? window.DSPTextures.get(sys, { lazy: true, priority: Math.floor(prox * 200 + size) })
      : null;
    const hue = sys.hue || atmoColor(sys.biome) || [255, 220, 150];
    const [r, g, b] = hue;
    const isGiant = sys.kind === "star" && (sys.rSun || 0) >= 8;

    // star / neutron / dyson primary corona
    if (sys.kind === "star" || sys.kind === "neutron" || sys.kind === "dyson") {
      const layers = 2 + Math.floor(prox * 3) + (isGiant ? 2 : 0);
      const stretch = isGiant ? 1.55 : 1;
      for (let i = layers; i >= 1; i--) {
        const glowR = size * (1.25 + i * (0.55 + prox * 0.5) * stretch);
        const alpha = ((0.16 + prox * 0.28) / i) * (isGiant ? 0.85 : 1);
        const glow = ctx.createRadialGradient(p.x, p.y, size * 0.85, p.x, p.y, glowR);
        glow.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
        glow.addColorStop(0.55, `rgba(${r},${g},${b},${alpha * 0.25})`);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
        ctx.fill();
      }
      if (isGiant && prox > 0.2) drawRedGiantProminence(p, size, prox, hue);
    }

    // planet atmosphere halo
    if (sys.kind === "planet" && size > 6) {
      const [ar, ag, ab] = atmoColor(sys.biome);
      const atmoR = size * (1.08 + prox * 0.14 + ((sys.rSun || 1) > 3 ? 0.08 : 0));
      const atmo = ctx.createRadialGradient(p.x, p.y, size * 0.9, p.x, p.y, atmoR);
      atmo.addColorStop(0, "rgba(0,0,0,0)");
      atmo.addColorStop(0.65, `rgba(${ar},${ag},${ab},${0.04 + prox * 0.1})`);
      atmo.addColorStop(0.9, `rgba(${ar},${ag},${ab},${0.32 + prox * 0.42})`);
      atmo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = atmo;
      ctx.beginPath();
      ctx.arc(p.x, p.y, atmoR, 0, Math.PI * 2);
      ctx.fill();
    }

    // —— black hole: Doppler disk + flickering photon ring ——
    if (sys.kind === "blackhole") {
      sys.spin = (sys.spin || 0) + 0.008 + speed * 0.002;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(sys.spin * 0.15);
      ctx.scale(1, 0.32);
      // outer disk
      const disk = ctx.createRadialGradient(0, 0, size * 0.5, 0, 0, size * 3.0);
      disk.addColorStop(0, "rgba(255,210,120,0)");
      disk.addColorStop(0.28, `rgba(255,190,90,${0.5 + prox * 0.35})`);
      disk.addColorStop(0.45, `rgba(255,100,40,${0.4 + prox * 0.3})`);
      disk.addColorStop(0.7, "rgba(140,30,50,0.28)");
      disk.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = disk;
      ctx.beginPath();
      ctx.arc(0, 0, size * 3.0, 0, Math.PI * 2);
      ctx.fill();
      // Doppler bright crescent
      const dop = ctx.createRadialGradient(size * 1.1, 0, 0, size * 1.1, 0, size * 1.4);
      dop.addColorStop(0, `rgba(255,255,220,${0.45 + prox * 0.35})`);
      dop.addColorStop(1, "rgba(255,120,40,0)");
      ctx.fillStyle = dop;
      ctx.beginPath();
      ctx.arc(size * 1.1, 0, size * 1.4, 0, Math.PI * 2);
      ctx.fill();
      // spiral hotspots
      for (let i = 0; i < 4; i++) {
        const a = sys.spin * 2.2 + i * 1.6;
        const rad = size * (1.1 + (i % 2) * 0.45);
        const hx = Math.cos(a) * rad;
        const hy = Math.sin(a) * rad;
        const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, size * 0.35);
        hg.addColorStop(0, `rgba(255,240,180,${0.35 + prox * 0.25})`);
        hg.addColorStop(1, "rgba(255,80,20,0)");
        ctx.fillStyle = hg;
        ctx.beginPath();
        ctx.arc(hx, hy, size * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      const flicker = 0.7 + 0.3 * Math.sin(time * 11);
      ctx.strokeStyle = `rgba(255, 230, 180, ${(0.5 + prox * 0.4) * flicker})`;
      ctx.lineWidth = Math.max(1.4, size * 0.07);
      ctx.beginPath();
      ctx.arc(p.x, p.y, size * 1.08, 0, Math.PI * 2);
      ctx.stroke();
      // secondary faint ring
      ctx.strokeStyle = `rgba(255, 160, 80, ${0.2 + prox * 0.2})`;
      ctx.lineWidth = Math.max(1, size * 0.03);
      ctx.beginPath();
      ctx.arc(p.x, p.y, size * 1.22, 0, Math.PI * 2);
      ctx.stroke();
      const lens = ctx.createRadialGradient(p.x, p.y, size * 0.85, p.x, p.y, size * 2.1);
      lens.addColorStop(0, "rgba(0,0,0,0)");
      lens.addColorStop(0.5, `rgba(60,20,30,${0.14 + prox * 0.18})`);
      lens.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = lens;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size * 2.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // neutron — DSP-style: tiny core + bipolar jets + magnetic particle flow
    if (sys.kind === "neutron") {
      sys.spin = (sys.spin || 0) + (sys.spinRate || 0.06);
      // magnetic susceptibility particle flow (DSP 0.9.27 look)
      const flowR = Math.max(size * 18, 36);
      for (let i = 0; i < 28; i++) {
        const phase = time * 1.8 + i * 0.55 + sys.spin;
        const lobe = (i % 2 === 0) ? 1 : -1;
        const t = (hash01(i * 9 + 1) + time * 0.35) % 1;
        const a = lobe * (0.35 + t * 1.1) + Math.sin(phase) * 0.15;
        const rad = flowR * (0.15 + t * 0.85);
        const px = p.x + Math.cos(a + sys.spin) * rad * 0.35;
        const py = p.y + Math.sin(sys.spin) * rad * lobe * 0.15 + Math.cos(a) * rad * 0.55 * lobe;
        const alpha = (1 - t) * (0.35 + prox * 0.4);
        ctx.fillStyle = `rgba(160, 210, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(0.7, size * 0.35 * (1 - t * 0.6)), 0, Math.PI * 2);
        ctx.fill();
      }
      // field-line arcs
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(sys.spin * 0.4);
      for (let i = 0; i < 6; i++) {
        const s = (i / 6) * Math.PI * 2 + time * 0.5;
        ctx.strokeStyle = `rgba(140, 200, 255, ${0.12 + prox * 0.2})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(0, 0, flowR * 0.45, flowR * 0.12, s, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(sys.spin);
      const bh = Math.max(size * 55, 90);
      const beam = ctx.createLinearGradient(0, -bh, 0, bh);
      beam.addColorStop(0, "rgba(140,200,255,0)");
      beam.addColorStop(0.5, `rgba(255,255,255,${0.75 + prox * 0.25})`);
      beam.addColorStop(1, "rgba(140,200,255,0)");
      ctx.fillStyle = beam;
      ctx.fillRect(-Math.max(size * 0.55, 1.2), -bh, Math.max(size * 1.1, 2.2), bh * 2);
      ctx.fillStyle = `rgba(160,210,255,${0.14 + prox * 0.18})`;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-size * 2.2, -bh * 0.75);
      ctx.lineTo(size * 2.2, -bh * 0.75);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-size * 2.2, bh * 0.75);
      ctx.lineTo(size * 2.2, bh * 0.75);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      const pulse = Math.pow(0.5 + 0.5 * Math.sin(time * 22), 4);
      const flash = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, Math.max(size * 12, 40));
      flash.addColorStop(0, `rgba(230,245,255,${0.55 * pulse})`);
      flash.addColorStop(1, "rgba(120,180,255,0)");
      ctx.fillStyle = flash;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(size * 12, 40), 0, Math.PI * 2);
      ctx.fill();
    }

    // ring back (behind globe)
    if (sys.kind === "planet") drawPlanetRing(sys, p, size, prox, "back");

    // main sphere from prebaked texture
    if (tex) {
      ctx.drawImage(tex, p.x - size, p.y - size, size * 2, size * 2);
    } else {
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    if (sys.kind === "planet") {
      drawTerminator(p, size, prox);
      drawNearSurfaceDetail(sys, p, size, prox);
    }

    // Sol granulation shimmer when close
    if (sys.id === "sol" && prox > 0.35 && size > 20) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, size * 0.98, 0, Math.PI * 2);
      ctx.clip();
      for (let i = 0; i < 12; i++) {
        const a = hash01(i * 3) * Math.PI * 2 + time * 0.15;
        const rad = size * hash01(i * 8) * 0.85;
        const px = p.x + Math.cos(a) * rad;
        const py = p.y + Math.sin(a) * rad;
        ctx.fillStyle = `rgba(255,180,80,${0.04 + prox * 0.06})`;
        ctx.beginPath();
        ctx.arc(px, py, size * 0.08, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // proximity specular sheen on planets
    if (sys.kind === "planet" && prox > 0.3) {
      const spec = ctx.createRadialGradient(
        p.x - size * 0.28, p.y - size * 0.32, 0,
        p.x - size * 0.28, p.y - size * 0.32, size * 0.55
      );
      spec.addColorStop(0, `rgba(255,255,255,${0.08 + prox * 0.2})`);
      spec.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = spec;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    // ring front
    if (sys.kind === "planet") drawPlanetRing(sys, p, size, prox, "front");

    // —— Dyson: denser lattice + energy spokes + beacons ——
    if (sys.kind === "dyson") {
      const shellR = size * (sys.shell || 2.2);
      ctx.save();
      // energy spokes from star to shell
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + time * 0.08;
        const pulse = 0.4 + 0.6 * Math.sin(time * 2.5 + i);
        ctx.strokeStyle = `rgba(120, 220, 255, ${(0.08 + prox * 0.18) * pulse})`;
        ctx.lineWidth = Math.max(1, size * 0.02);
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(a) * size, p.y + Math.sin(a) * size);
        ctx.lineTo(p.x + Math.cos(a) * shellR, p.y + Math.sin(a) * shellR * 0.92);
        ctx.stroke();
      }
      ctx.strokeStyle = `rgba(255, 200, 120, ${0.42 + prox * 0.45})`;
      ctx.lineWidth = Math.max(1, size * 0.045);
      for (let i = -4; i <= 4; i++) {
        const k = i / 4.2;
        const ry = shellR * Math.sqrt(Math.max(0.04, 1 - k * k));
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + k * shellR * 0.12, ry, ry * 0.26, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, shellR, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI + time * 0.07;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, shellR * Math.abs(Math.cos(a)), shellR, a, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(100, 210, 255, ${0.2 + prox * 0.32})`;
        ctx.stroke();
      }
      if (prox > 0.15) {
        for (let i = 0; i < 36; i++) {
          const a = hash01(i * 7 + 3) * Math.PI * 2 + time * 0.12;
          const b = (hash01(i * 3) - 0.5) * 1.55;
          const px = p.x + Math.cos(a) * shellR * Math.cos(b);
          const py = p.y + Math.sin(a) * shellR * Math.cos(b) * 0.88;
          const pr = size * 0.085;
          const lit = 0.5 + 0.5 * Math.sin(time * 3 + i);
          ctx.fillStyle = `rgba(255, 230, 160, ${(0.06 + prox * 0.1) * lit})`;
          ctx.fillRect(px - pr, py - pr * 0.35, pr * 2, pr * 0.7);
        }
        for (let i = 0; i < 5; i++) {
          const a = time * 0.4 + i * 1.25;
          const bx = p.x + Math.cos(a) * shellR * 0.92;
          const by = p.y + Math.sin(a) * shellR * 0.75;
          const blink = 0.45 + 0.55 * Math.sin(time * 5 + i * 2);
          ctx.fillStyle = `rgba(80, 230, 255, ${0.4 * blink + prox * 0.25})`;
          ctx.beginPath();
          ctx.arc(bx, by, Math.max(2, size * 0.055), 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = `rgba(120, 240, 255, ${0.25 * blink})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(bx, by, size * 0.14, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // star diffraction when distant
    if (sys.kind === "star" && size < 18 && prox < 0.15) {
      const spike = size * 5;
      ctx.strokeStyle = `rgba(${r},${g},${b},0.3)`;
      ctx.lineWidth = Math.max(0.7, size * 0.05);
      ctx.beginPath();
      ctx.moveTo(p.x - spike, p.y); ctx.lineTo(p.x + spike, p.y);
      ctx.moveTo(p.x, p.y - spike * 0.65); ctx.lineTo(p.x, p.y + spike * 0.65);
      ctx.stroke();
    }

    // featured tag
    if (sys.featured && size > 4 && size < H * 0.4) {
      ctx.font = "600 10px 'IBM Plex Sans', sans-serif";
      ctx.fillStyle = "rgba(240,193,75,0.75)";
      ctx.textAlign = "center";
      ctx.fillText("★ FEATURED", p.x, p.y - size - 8);
    }
  }

  function drawLockReticle(x, y, size, label) {
    const r = Math.max(16, size * 1.12 + 8);
    const t = 7;
    ctx.strokeStyle = "rgba(240,193,75,0.95)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x - r, y - r + t); ctx.lineTo(x - r, y - r); ctx.lineTo(x - r + t, y - r);
    ctx.moveTo(x + r - t, y - r); ctx.lineTo(x + r, y - r); ctx.lineTo(x + r, y - r + t);
    ctx.moveTo(x + r, y + r - t); ctx.lineTo(x + r, y + r); ctx.lineTo(x + r - t, y + r);
    ctx.moveTo(x - r + t, y + r); ctx.lineTo(x - r, y + r); ctx.lineTo(x - r, y + r - t);
    ctx.stroke();
    ctx.font = "600 11px 'IBM Plex Sans', sans-serif";
    ctx.fillStyle = "rgba(240,193,75,0.95)";
    ctx.textAlign = "center";
    ctx.fillText(`LOCK · ${label}`, x, y - r - 10);
  }

  function formatDist(ly) {
    if (ly >= 0.1) return `${ly.toFixed(2)} ly`;
    const au = ly * 63241;
    if (au >= 1) return `${au.toFixed(1)} AU`;
    return `${(au * 149597870.7).toExponential(2)} km`;
  }

  function formatEta(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "—";
    if (sec > 3600) return `${(sec / 3600).toFixed(1)} h`;
    if (sec > 60) return `${(sec / 60).toFixed(1)} min`;
    return `${sec.toFixed(1)} s`;
  }

  function drawBodies() {
    const sorted = systems.slice().sort((a, b) => {
      const da = Math.hypot(a.x - camX, a.y - camY, a.z - camZ);
      const db = Math.hypot(b.x - camX, b.y - camY, b.z - camZ);
      return db - da;
    });

    for (const sys of sorted) {
      const { p, size, dist } = systemScreen(sys);
      if (!p.visible || size < 0.35) continue;
      // only cull when truly inside the body
      if (dist < sys.radius * 0.96) continue;

      const proxScreen = proximityDetail(size);
      const proxPhys = clamp(1 - (dist - sys.radius) / (sys.radius * 50), 0, 1);
      const prox = Math.max(proxScreen, proxPhys * 0.9);

      drawBody(sys, p, size, prox);

      // hide chrome when the body dominates the frame
      if (size > H * 0.55) continue;

      if (locked && locked.id === sys.id) drawLockReticle(p.x, p.y, size, sys.label);
      else if (size < H * 0.42) {
        ctx.font = "500 11px 'IBM Plex Sans', sans-serif";
        ctx.fillStyle = "rgba(220,230,245,0.5)";
        ctx.textAlign = "center";
        ctx.fillText(`${sys.label} · ${formatDist(dist / LY)}`, p.x, p.y + size + 14);
      }
    }
  }

  function collide() {
    for (const sys of systems) {
      if (sys.kind === "binary") {
        for (const star of [sys.primary, sys.comp]) {
          if (!star) continue;
          const dx = camX - star.x;
          const dy = camY - star.y;
          const dz = camZ - star.z;
          const dist = Math.hypot(dx, dy, dz);
          const minD = star.radius * 1.04;
          if (dist < minD && dist > 1e-6) {
            const n = minD / dist;
            camX = star.x + dx * n;
            camY = star.y + dy * n;
            camZ = star.z + dz * n;
            if (speed > 0.6) {
              targetSpeed = Math.min(targetSpeed, 0.35);
              speed = Math.min(speed, 0.35);
            }
          }
        }
        continue;
      }
      const dx = camX - sys.x;
      const dy = camY - sys.y;
      const dz = camZ - sys.z;
      const dist = Math.hypot(dx, dy, dz);
      const minD = approachLimit(sys);
      if (dist < minD && dist > 1e-6) {
        const n = minD / dist;
        camX = sys.x + dx * n;
        camY = sys.y + dy * n;
        camZ = sys.z + dz * n;
        if (speed > 0.6) {
          targetSpeed = Math.min(targetSpeed, 0.35);
          speed = Math.min(speed, 0.35);
        }
      }
    }
  }

  /** Black-hole gravity: near-field pull can exceed reverse thrust — hard to flee. */
  function applyGravity(dt) {
    for (const sys of systems) {
      if (sys.kind !== "blackhole") continue;
      const dx = sys.x - camX;
      const dy = sys.y - camY;
      const dz = sys.z - camZ;
      const dist = Math.hypot(dx, dy, dz) || 1;
      const rs = sys.radius;
      const influence = rs * 140;
      if (dist > influence) continue;
      const stopAt = approachLimit(sys);
      if (dist <= stopAt) continue;
      const mass = sys.mass || 40;
      const soft = dist * dist + rs * rs * 4;
      let pull = (mass * rs * rs * LY * 0.0045 * dt * 60) / soft;
      const near = clamp(1 - (dist - rs) / (rs * 28), 0, 1);
      pull *= 0.55 + near * near * 3.2;
      const maxPull = 5.2 * LY * 0.0045 * dt * 60;
      const go = Math.min(pull, maxPull);
      camX += (dx / dist) * go;
      camY += (dy / dist) * go;
      camZ += (dz / dist) * go;
      if (near > 0.55 && speed > 0) {
        speed *= 1 - near * 0.04;
      }
    }
  }

  function aimAtLocked(t) {
    if (!locked) return null;
    return faceWorld(locked.x, locked.y, locked.z, t);
  }

  function fly(dt) {
    const signedStep = speed * (LY * 0.0045) * dt * 60;
    const reverse = speed < -0.05;

    // Target lock aims the camera — but RMB look drag takes priority (stable free aim)
    if (locked && !rmbHeld) {
      const aim = aimAtLocked(boost || reverse ? 1 : 0.45);
      if (!aim) {
        // fall through
      } else {
        const dist = aim.dist || 1;
        const ux = aim.dx / dist;
        const uy = aim.dy / dist;
        const uz = aim.dz / dist;
        const stopAt = approachLimit(locked);

        if (boost && !brake) {
          // approach along LOS — allow hugging the limit for max angular size
          if (dist > stopAt) {
            const go = Math.min(Math.abs(signedStep) * 1.6, dist - stopAt);
            camX += ux * go;
            camY += uy * go;
            camZ += uz * go;
          }
        } else if (reverse || brake) {
          // Ctrl reverse: flee along -LOS (away from lock)
          const go = Math.abs(signedStep) * 1.45;
          camX -= ux * go;
          camY -= uy * go;
          camZ -= uz * go;
        } else if (speed > 0.08) {
          const creep = signedStep * 0.08;
          if (dist > stopAt) {
            camX += ux * Math.min(creep, dist - stopAt);
            camY += uy * Math.min(creep, dist - stopAt);
            camZ += uz * Math.min(creep, dist - stopAt);
          }
        }
      }
    } else {
      const { forward } = getBasis();
      let scale;
      if (boost && !brake) scale = 1.15;
      else if (reverse || brake) scale = 1.05;
      else scale = 0.12;
      const go = signedStep * scale;
      camX += forward.x * go;
      camY += forward.y * go;
      camZ += forward.z * go;
    }

    // binaries: both stars orbit the barycenter (opposite sides)
    for (const sys of systems) {
      if (sys.kind !== "binary" || !sys.primary || !sys.comp) continue;
      sys.orbitA = (sys.orbitA || 0) + dt * (sys.orbitSpeed || 0.5);
      updateBinaryPositions(sys);
    }

    applyGravity(dt);
    collide();
  }

  function updateHud() {
    if (hudVel) {
      if (brake || speed < -0.05) {
        hudVel.textContent = `${(speed * 0.08).toFixed(2)} c · REV`;
      } else if (boost) {
        const warp = speed / 0.55;
        hudVel.textContent = `${Math.min(2, 0.4 + warp * 0.35).toFixed(2)} c · WARP`;
      } else {
        hudVel.textContent = `${(speed * 0.08).toFixed(2)} c`;
      }
    }
    if (!locked) {
      if (hudLock) hudLock.textContent = "—";
      if (hudRange) hudRange.textContent = "—";
      if (hudEta) hudEta.textContent = "—";
      return;
    }
    const dist = Math.hypot(locked.x - camX, locked.y - camY, locked.z - camZ);
    const surface = Math.max(0, dist - approachLimit(locked));
    let closing;
    if (boost && !brake) {
      closing = Math.abs(speed) * LY * 0.0045 * 60 * 1.35;
    } else if (brake || speed < 0) {
      closing = -Math.abs(speed) * LY * 0.0045 * 60 * 1.45; // negative = opening
    } else {
      closing = speed * LY * 0.00055 * 60;
    }
    if (hudLock) hudLock.textContent = locked.label;
    if (hudRange) hudRange.textContent = formatDist(dist / LY);
    if (hudEta) {
      if (closing > 1e-6) hudEta.textContent = formatEta(surface / closing);
      else if (closing < -1e-6) hudEta.textContent = `flee ${formatEta(Math.abs(surface / closing))}`;
      else hudEta.textContent = "—";
    }
  }

  function frame(ts) {
    if (!frame._last) frame._last = ts;
    const dt = clamp((ts - frame._last) / 1000, 0, 0.05);
    frame._last = ts;
    time += dt;

    // speed model: Ctrl reverses through zero into negative thrust
    if (brake) targetSpeed = -2.4;
    else if (boost) targetSpeed = 2.8;
    else targetSpeed = 0.55;
    speed += (targetSpeed - speed) * (brake ? 0.14 : 0.08);

    // orientation + motion first so projection matches where we look/fly
    fly(dt);
    drawWarpStars();
    drawBodies();
    updateHud();

    // center cue (= lock aim point)
    ctx.fillStyle = `rgba(240,200,100,${0.25 + (boost ? 0.35 : 0) + (locked ? 0.35 : 0) + (brake ? 0.2 : 0)})`;
    ctx.beginPath();
    ctx.arc(cx, cy, locked ? 3 : 2, 0, Math.PI * 2);
    ctx.fill();

    const hover = pickSystem(pointerX, pointerY);
    if (hover && (!locked || locked.id !== hover.id)) {
      const { p, size } = systemScreen(hover);
      ctx.strokeStyle = "rgba(220,230,245,0.35)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(12, size * 1.15 + 6), 0, Math.PI * 2);
      ctx.stroke();
    }

    raf = requestAnimationFrame(frame);
  }

  window.addEventListener("resize", () => {
    const keep = { stars, systems, locked, camX, camY, camZ, yaw, pitch };
    resize();
    stars = keep.stars.length ? keep.stars : stars;
    systems = keep.systems.length ? keep.systems : systems;
    camX = keep.camX; camY = keep.camY; camZ = keep.camZ;
    yaw = keep.yaw; pitch = keep.pitch;
    locked = keep.locked
      ? systems.find((s) => s.id === keep.locked.id) || null
      : null;
  }, { passive: true });

  window.addEventListener("pointermove", (e) => {
    pointerX = e.clientX;
    pointerY = e.clientY;
    if (!rmbHeld) return;
    const dx = e.clientX - lookLastX;
    const dy = e.clientY - lookLastY;
    lookLastX = e.clientX;
    lookLastY = e.clientY;
    const total = Math.hypot(e.clientX - lookStartX, e.clientY - lookStartY);
    if (!lookDragged && total > CLICK_SLOP) {
      lookDragged = true;
      // break target-lock so drag can free-aim without fighting faceWorld
      if (locked) locked = null;
      document.body.style.cursor = "grabbing";
    }
    if (lookDragged || total > 0) {
      // only turn after we commit to a drag (keeps click crisp)
      if (lookDragged) applyLookDelta(dx, dy);
    }
  }, { passive: true });

  function setLock(body) {
    locked = body;
    if (locked) faceWorld(locked.x, locked.y, locked.z, 1);
  }

  window.addEventListener("pointerdown", (e) => {
    if (e.target.closest("a, button, .panel, .section, .hud")) return;
    if (e.button === 2) {
      rmbHeld = true;
      lookDragged = false;
      lookStartX = e.clientX;
      lookStartY = e.clientY;
      lookLastX = e.clientX;
      lookLastY = e.clientY;
      return;
    }
    if (e.button === 0) boost = true;
  });
  window.addEventListener("pointerup", (e) => {
    if (e.button === 0) boost = false;
    if (e.button === 2 && rmbHeld) {
      // short click = toggle body lock; drag = look only (angle already applied)
      if (!lookDragged) {
        const hit = pickSystem(e.clientX, e.clientY);
        if (hit && locked && locked.id === hit.id) setLock(null);
        else setLock(hit || null);
      }
      rmbHeld = false;
      lookDragged = false;
      document.body.style.cursor = "";
    }
  });
  window.addEventListener("pointercancel", () => {
    boost = false;
    rmbHeld = false;
    lookDragged = false;
    document.body.style.cursor = "";
  });
  window.addEventListener("contextmenu", (e) => {
    if (!e.target.closest("a, button, .panel, .section")) e.preventDefault();
  });

  window.addEventListener("keydown", (e) => {
    if (e.target.closest("input, textarea, a, button")) return;
    if (e.code === "Space") {
      e.preventDefault();
      boost = true;
    }
    if (e.code === "ControlLeft" || e.code === "ControlRight") {
      e.preventDefault();
      brake = true;
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") boost = false;
    if (e.code === "ControlLeft" || e.code === "ControlRight") brake = false;
  });
  window.addEventListener("blur", () => {
    boost = false;
    brake = false;
    rmbHeld = false;
    lookDragged = false;
    document.body.style.cursor = "";
  });

  resize();
  // stars/systems created inside resize — avoid double initSystems (was sync-baking twice)

  if (reduced) {
    ctx.fillStyle = "#050814";
    ctx.fillRect(0, 0, W, H);
    drawBodies();
    const hint = document.getElementById("warp-hint");
    if (hint) hint.hidden = true;
  } else {
    // paint immediately; textures fill in via idle bake
    requestAnimationFrame(frame);
  }

  document.addEventListener("visibilitychange", () => {
    if (reduced) return;
    if (document.hidden) cancelAnimationFrame(raf);
    else {
      frame._last = 0;
      requestAnimationFrame(frame);
    }
  });
})();
