/**
 * Hybrid space backdrop:
 * - Original click-to-boost hyperspace star streaks (WarpSpeed-style)
 * - Current close-approach solid planets/stars in world space
 *
 * Hold LMB / Space = warp boost · mouse steers · RMB = lock · Ctrl = brake
 */
(() => {
  const canvas = document.getElementById("hyperspace");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: false });
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const STAR_COUNT = 1100;
  const DEPTH = 1000;
  const LY = 900;
  const R_SUN = LY * 0.014;
  const PICK_PAD = 34;

  let W = 0;
  let H = 0;
  let dpr = 1;
  let cx = 0;
  let cy = 0;
  let targetX = 0;
  let targetY = 0;
  let smoothTX = 0;
  let smoothTY = 0;

  // classic warp speed (original feel)
  let speed = 0.55;
  let targetSpeed = 0.55;
  let boost = false;
  let brake = false;

  // world flight — approach planets while warp VFX runs
  let camX = 0;
  let camY = 0;
  let camZ = 0;
  let time = 0;
  let raf = 0;
  let pointerX = 0;
  let pointerY = 0;
  /** @type {object|null} */
  let locked = null;

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
    const catalog = [
      // nearby showcase — DSP-like planets first so approach is rewarding
      { id: "med", label: "Mediterranean", kind: "planet", biome: "mediterranean", th: 0.12, ph: -0.04, distLy: 1.6, rSun: 0.55 },
      { id: "arid", label: "Arid Desert", kind: "planet", biome: "arid", th: -0.25, ph: 0.08, distLy: 2.1, rSun: 0.5 },
      { id: "ice", label: "Scarlet Ice", kind: "planet", biome: "ice", th: 0.4, ph: 0.15, distLy: 2.4, rSun: 0.48 },
      { id: "lava", label: "Lava Planet", kind: "planet", biome: "lava", th: -0.5, ph: -0.1, distLy: 2.8, rSun: 0.52 },
      { id: "ocean", label: "Oceanic", kind: "planet", biome: "ocean", th: 0.55, ph: -0.18, distLy: 3.0, rSun: 0.5 },
      { id: "ashen", label: "Ashen Gelisol", kind: "planet", biome: "ashen", th: -0.15, ph: 0.22, distLy: 3.3, rSun: 0.47 },
      { id: "pandora", label: "Pandora-class", kind: "planet", biome: "pandora", th: 0.7, ph: 0.05, distLy: 3.6, rSun: 0.53 },
      { id: "gas1", label: "Gas Giant", kind: "planet", biome: "gas_cream", th: -0.8, ph: 0.02, distLy: 4.2, rSun: 2.8 },
      { id: "gas2", label: "Ice Giant", kind: "planet", biome: "gas_blue", th: 0.95, ph: -0.12, distLy: 5.0, rSun: 2.2 },
      // stars
      { id: "sol", label: "G2V Sol-analogue", kind: "star", th: 0.05, ph: -0.02, distLy: 6.5, rSun: 1.0, hue: [255, 214, 140] },
      { id: "rigel", label: "B8Ia Rigel-class", kind: "star", th: 0.9, ph: 0.12, distLy: 11, rSun: 12, hue: [170, 205, 255] },
      { id: "betel", label: "M2I Betelgeuse-class", kind: "star", th: -0.7, ph: 0.08, distLy: 9, rSun: 16, hue: [255, 130, 90] },
      { id: "vega", label: "A0V Vega-class", kind: "star", th: 0.45, ph: -0.18, distLy: 7.5, rSun: 2.1, hue: [210, 230, 255] },
      { id: "bh1", label: "Stellar BH", kind: "blackhole", th: 1.2, ph: 0.06, distLy: 14, rSun: 3.0, hue: [255, 170, 70], spin: 0 },
      { id: "psr1", label: "Pulsar", kind: "neutron", th: -1.0, ph: 0.15, distLy: 12, rSun: 0.14, spin: 0, spinRate: 0.08 },
    ];
    systems = catalog.map(placeSystem);

    const biomes = ["mediterranean", "arid", "ice", "lava", "ocean", "ashen", "pandora", "gas", "gas_blue", "gas_cream"];
    for (let i = 0; i < 24; i++) {
      const biome = biomes[i % biomes.length];
      systems.push(placeSystem({
        id: `p-${i}`,
        label: `${biome.replace("_", " ")} #${i + 1}`,
        kind: "planet",
        biome,
        th: rand(-1.3, 1.3),
        ph: rand(-0.45, 0.45),
        distLy: rand(4, 40),
        rSun: String(biome).startsWith("gas") ? rand(1.8, 3.2) : rand(0.4, 0.7),
      }));
    }

    const spectral = [
      { tag: "O", hue: [150, 185, 255], r: [5, 12] },
      { tag: "B", hue: [175, 205, 255], r: [2.2, 7] },
      { tag: "A", hue: [210, 225, 255], r: [1.3, 2.4] },
      { tag: "G", hue: [255, 220, 150], r: [0.85, 1.15] },
      { tag: "K", hue: [255, 170, 110], r: [0.6, 0.95] },
      { tag: "M", hue: [255, 120, 90], r: [0.4, 0.7] },
    ];
    for (let i = 0; i < 28; i++) {
      const sp = spectral[i % spectral.length];
      systems.push(placeSystem({
        id: `s-${i}`,
        label: `${sp.tag}-type #${i + 1}`,
        kind: "star",
        th: rand(-1.4, 1.4),
        ph: rand(-0.5, 0.5),
        distLy: rand(8, 60),
        rSun: rand(sp.r[0], sp.r[1]),
        hue: sp.hue.map((c) => clamp(c + rand(-12, 12), 90, 255)),
      }));
    }
    for (let i = 0; i < 4; i++) {
      systems.push(placeSystem({
        id: `bh-${i}`, label: `BH #${i + 1}`, kind: "blackhole",
        th: rand(-1.4, 1.4), ph: rand(-0.35, 0.35), distLy: rand(18, 70),
        rSun: rand(2.2, 5.5), hue: [255, 160, 60], spin: rand(0, 3),
      }));
    }
    for (let i = 0; i < 5; i++) {
      systems.push(placeSystem({
        id: `ns-${i}`, label: `Pulsar #${i + 1}`, kind: "neutron",
        th: rand(-1.4, 1.4), ph: rand(-0.4, 0.4), distLy: rand(12, 55),
        rSun: rand(0.09, 0.15), spin: rand(0, 3),
        spinRate: rand(0.04, 0.12) * (Math.random() > 0.5 ? 1 : -1),
      }));
    }

    if (window.DSPTextures) {
      // bake offline-style atlas into memory once
      window.DSPTextures.warm(systems);
    }
  }

  function warpProject(x, y, z) {
    const k = DEPTH / Math.max(z, 0.001);
    return {
      x: x * k + cx + (smoothTX - cx) * 0.35,
      y: y * k + cy + (smoothTY - cy) * 0.35,
    };
  }

  /** World body → screen (camera looks +Z, mouse offsets view). */
  function projectWorld(wx, wy, wz) {
    const dx = wx - camX;
    const dy = wy - camY;
    const dz = wz - camZ;
    if (dz <= 2) return { x: 0, y: 0, visible: false, depth: dz, dist: Math.hypot(dx, dy, dz) };
    const lookX = (smoothTX - cx) / Math.max(W, 1);
    const lookY = (smoothTY - cy) / Math.max(H, 1);
    const sx = cx + (dx / dz) * (H * 0.72) - lookX * 90;
    const sy = cy + (dy / dz) * (H * 0.72) - lookY * 70;
    const dist = Math.hypot(dx, dy, dz);
    return { x: sx, y: sy, visible: true, depth: dz, dist };
  }

  function screenRadius(radius, dist) {
    return (H * 0.55) * radius / Math.sqrt(radius * radius + dist * dist);
  }

  function proximityDetail(size) {
    return clamp((size - 10) / Math.max(160, Math.min(W, H) * 0.42), 0, 1);
  }

  function systemScreen(sys) {
    const p = projectWorld(sys.x, sys.y, sys.z);
    if (!p.visible) return { p, size: 0, dist: p.dist || 0 };
    return { p, size: screenRadius(sys.radius, p.dist), dist: p.dist };
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
    targetX = cx;
    targetY = cy;
    smoothTX = cx;
    smoothTY = cy;
    pointerX = cx;
    pointerY = cy;
    if (!stars.length) initStars();
    if (!systems.length) initSystems();
  }

  function drawWarpStars() {
    // original motion-blur wash
    ctx.fillStyle = `rgba(5, 8, 20, ${boost ? 0.26 : 0.4})`;
    ctx.fillRect(0, 0, W, H);

    for (let i = 0; i < stars.length; i++) {
      const star = stars[i];
      star.pz = star.z;
      star.z -= speed * (boost ? 18 : 7.5);

      if (star.z < 1) {
        resetStar(star, false);
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

      // classic hyperspace streak
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

  /** Runtime: baked texture + cheap corona/atmosphere (DSP look, low CPU). */
  function drawBody(sys, p, size, prox) {
    const tex = window.DSPTextures ? window.DSPTextures.get(sys) : null;
    const hue = sys.hue || atmoColor(sys.biome) || [255, 220, 150];
    const [r, g, b] = hue;

    // star / neutron corona — gradients only
    if (sys.kind === "star" || sys.kind === "neutron") {
      const layers = 2 + Math.floor(prox * 3);
      for (let i = layers; i >= 1; i--) {
        const glowR = size * (1.25 + i * (0.55 + prox * 0.5));
        const alpha = (0.16 + prox * 0.28) / i;
        const glow = ctx.createRadialGradient(p.x, p.y, size * 0.85, p.x, p.y, glowR);
        glow.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
        glow.addColorStop(0.55, `rgba(${r},${g},${b},${alpha * 0.25})`);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // planet atmosphere halo (DSP nephogram / ionosphere feel)
    if (sys.kind === "planet" && size > 6) {
      const [ar, ag, ab] = atmoColor(sys.biome);
      const atmoR = size * (1.08 + prox * 0.12);
      const atmo = ctx.createRadialGradient(p.x, p.y, size * 0.92, p.x, p.y, atmoR);
      atmo.addColorStop(0, "rgba(0,0,0,0)");
      atmo.addColorStop(0.7, `rgba(${ar},${ag},${ab},${0.05 + prox * 0.12})`);
      atmo.addColorStop(0.92, `rgba(${ar},${ag},${ab},${0.35 + prox * 0.4})`);
      atmo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = atmo;
      ctx.beginPath();
      ctx.arc(p.x, p.y, atmoR, 0, Math.PI * 2);
      ctx.fill();
    }

    // blackhole accretion disk (procedural, cheap)
    if (sys.kind === "blackhole") {
      sys.spin = (sys.spin || 0) + 0.004 + speed * 0.001;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(sys.spin);
      ctx.scale(1, 0.34);
      const disk = ctx.createRadialGradient(0, 0, size * 0.55, 0, 0, size * 2.5);
      disk.addColorStop(0, "rgba(255,210,120,0)");
      disk.addColorStop(0.4, `rgba(255,160,60,${0.35 + prox * 0.35})`);
      disk.addColorStop(0.75, "rgba(180,50,30,0.25)");
      disk.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = disk;
      ctx.beginPath();
      ctx.arc(0, 0, size * 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // neutron jets
    if (sys.kind === "neutron") {
      sys.spin = (sys.spin || 0) + (sys.spinRate || 0.06);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(sys.spin);
      const bh = Math.max(size * 9, 40);
      const beam = ctx.createLinearGradient(0, -bh, 0, bh);
      beam.addColorStop(0, "rgba(140,200,255,0)");
      beam.addColorStop(0.5, `rgba(255,255,255,${0.55 + prox * 0.3})`);
      beam.addColorStop(1, "rgba(140,200,255,0)");
      ctx.fillStyle = beam;
      ctx.fillRect(-Math.max(size * 0.12, 1), -bh, Math.max(size * 0.24, 2), bh * 2);
      ctx.restore();
    }

    // main sphere from prebaked texture
    if (tex) {
      ctx.drawImage(tex, p.x - size, p.y - size, size * 2, size * 2);
    } else {
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    // proximity specular sheen on planets
    if (sys.kind === "planet" && prox > 0.35) {
      const spec = ctx.createRadialGradient(
        p.x - size * 0.28, p.y - size * 0.32, 0,
        p.x - size * 0.28, p.y - size * 0.32, size * 0.55
      );
      spec.addColorStop(0, `rgba(255,255,255,${0.08 + prox * 0.18})`);
      spec.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = spec;
      ctx.beginPath();
      ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
      ctx.fill();
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
      if (p.depth < sys.radius * 0.5) continue;

      const proxScreen = proximityDetail(size);
      const proxPhys = clamp(1 - (dist - sys.radius) / (sys.radius * 90), 0, 1);
      const prox = Math.max(proxScreen, proxPhys * 0.85);

      drawBody(sys, p, size, prox);

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
      const dx = camX - sys.x;
      const dy = camY - sys.y;
      const dz = camZ - sys.z;
      const dist = Math.hypot(dx, dy, dz);
      const minD = sys.radius * 1.03;
      if (dist < minD && dist > 1e-6) {
        const n = minD / dist;
        camX = sys.x + dx * n;
        camY = sys.y + dy * n;
        camZ = sys.z + dz * n;
        // dump forward speed on contact
        targetSpeed = Math.min(targetSpeed, 0.45);
        speed = Math.min(speed, 0.45);
      }
    }
  }

  function fly(dt) {
    // mouse steer gently drifts lateral camera
    const steerX = (smoothTX - cx) / Math.max(W, 1);
    const steerY = (smoothTY - cy) / Math.max(H, 1);
    camX += steerX * speed * 2.2 * dt * 60;
    camY += steerY * speed * 2.2 * dt * 60;

    // forward flight — boost rushes you toward worlds
    const forward = (boost ? 1.0 : 0.12) * speed * (LY * 0.0045) * dt * 60;
    camZ += forward;

    // pull toward locked target while boosting
    if (locked && boost) {
      const dx = locked.x - camX;
      const dy = locked.y - camY;
      const dz = locked.z - camZ;
      const dist = Math.hypot(dx, dy, dz) || 1;
      const pull = speed * 0.35 * dt * 60;
      camX += (dx / dist) * pull;
      camY += (dy / dist) * pull;
      camZ += (dz / dist) * pull;
    }

    collide();
  }

  function updateHud() {
    const warp = boost ? speed / 0.55 : speed / 2.5;
    if (hudVel) {
      hudVel.textContent = boost
        ? `${Math.min(2, 0.4 + warp * 0.35).toFixed(2)} c · WARP`
        : `${(speed * 0.08).toFixed(2)} c`;
    }
    if (!locked) {
      if (hudLock) hudLock.textContent = "—";
      if (hudRange) hudRange.textContent = "—";
      if (hudEta) hudEta.textContent = "—";
      return;
    }
    const dist = Math.hypot(locked.x - camX, locked.y - camY, locked.z - camZ);
    const surface = Math.max(0, dist - locked.radius * 1.03);
    const closing = boost ? speed * LY * 0.0045 * 60 : speed * LY * 0.00055 * 60;
    if (hudLock) hudLock.textContent = locked.label;
    if (hudRange) hudRange.textContent = formatDist(dist / LY);
    if (hudEta) hudEta.textContent = closing > 1e-6 ? formatEta(surface / closing) : "—";
  }

  function frame(ts) {
    if (!frame._last) frame._last = ts;
    const dt = clamp((ts - frame._last) / 1000, 0, 0.05);
    frame._last = ts;
    time += dt;

    smoothTX += (targetX - smoothTX) * 0.12;
    smoothTY += (targetY - smoothTY) * 0.12;

    // original click-boost speed model
    if (brake) targetSpeed = 0.2;
    else if (boost) targetSpeed = 2.8;
    else targetSpeed = 0.55;
    speed += (targetSpeed - speed) * (brake ? 0.12 : 0.08);

    drawWarpStars();
    fly(dt);
    drawBodies();
    updateHud();

    // center cue
    ctx.fillStyle = `rgba(240,200,100,${0.25 + (boost ? 0.35 : 0)})`;
    ctx.beginPath();
    ctx.arc(cx, cy, 2, 0, Math.PI * 2);
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
    const keep = { stars, systems, locked, camX, camY, camZ };
    resize();
    stars = keep.stars.length ? keep.stars : stars;
    systems = keep.systems.length ? keep.systems : systems;
    camX = keep.camX; camY = keep.camY; camZ = keep.camZ;
    locked = keep.locked
      ? systems.find((s) => s.id === keep.locked.id) || null
      : null;
  }, { passive: true });

  window.addEventListener("pointermove", (e) => {
    pointerX = e.clientX;
    pointerY = e.clientY;
    targetX = e.clientX;
    targetY = e.clientY;
  }, { passive: true });

  window.addEventListener("pointerdown", (e) => {
    if (e.target.closest("a, button, .panel, .section, .hud")) return;
    if (e.button === 2) {
      // right-click lock
      const hit = pickSystem(e.clientX, e.clientY);
      locked = hit ? (locked && locked.id === hit.id ? null : hit) : null;
      return;
    }
    if (e.button === 0) boost = true; // original: hold click to warp
  });
  window.addEventListener("pointerup", (e) => {
    if (e.button === 0) boost = false;
  });
  window.addEventListener("pointercancel", () => { boost = false; });
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
  });

  resize();
  initStars();
  initSystems();

  if (reduced) {
    ctx.fillStyle = "#050814";
    ctx.fillRect(0, 0, W, H);
    drawBodies();
    const hint = document.getElementById("warp-hint");
    if (hint) hint.hidden = true;
  } else {
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
