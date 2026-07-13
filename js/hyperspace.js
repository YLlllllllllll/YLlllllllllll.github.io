/**
 * DSP-inspired deep-space backdrop.
 * Scale model: distant stars / systems barely move (ly-scale);
 * only local debris drifts. Mouse = look; boost = cruise, not "zoom past suns".
 */
(() => {
  const canvas = document.getElementById("hyperspace");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: false });
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // —— scale constants (feel, not physics) ——
  // Distant field stars: fixed on a sky sphere (parallax only from look)
  const FIELD = 1400;
  // Cruise: how fast the sky drifts under boost (very small)
  const CRUISE_YAW = 0.00035; // rad / frame at cruise
  const WARP_YAW = 0.0022;
  // Local debris depth in "AU-ish" units; stars are in "ly"
  const LOCAL_NEAR = 8;
  const LOCAL_FAR = 120;

  let W = 0;
  let H = 0;
  let dpr = 1;
  let lookX = 0; // -1..1 from pointer
  let lookY = 0;
  let smoothLookX = 0;
  let smoothLookY = 0;
  let heading = 0.35; // galactic cruise heading (rad)
  let pitch = -0.08;
  let boost = false;
  let throttle = 0; // 0..1 smoothed
  let time = 0;
  let raf = 0;

  /** @type {{th:number,ph:number,mag:number,r:number,g:number,b:number,flare:boolean}[]} */
  let field = [];
  /** @type {object[]} */
  let systems = [];
  /** @type {object[]} */
  let debris = [];
  /** @type {object[]} */
  let meteors = [];
  let meteorCD = 180;

  const hudVel = document.getElementById("hud-vel");
  const hudRange = document.getElementById("hud-range");

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  // Spherical → screen (camera look + cruise heading)
  function projectSky(theta, phi, parallax = 1) {
    const th = theta + heading * 0.15 + smoothLookX * 0.55 * parallax;
    const ph = phi + pitch * 0.4 + smoothLookY * 0.4 * parallax;
    // equal-area-ish wrap into view frustum
    const x = ((th % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const nx = (x / (Math.PI * 2) - 0.5) * 2; // -1..1 wraps
    // remap wrapped sky to screen with soft cylinder projection
    let u = Math.sin(th) * Math.cos(ph);
    let v = Math.sin(ph);
    let depth = Math.cos(th) * Math.cos(ph); // forward hemisphere > 0
    return {
      x: W * 0.5 + u * W * 0.62,
      y: H * 0.5 + v * H * 0.72,
      forward: depth,
      visible: depth > -0.15,
    };
  }

  function initField() {
    field = [];
    for (let i = 0; i < FIELD; i++) {
      const tint = Math.random();
      let r, g, b;
      if (tint > 0.9) {
        r = 255; g = 210; b = 140; // warm
      } else if (tint > 0.75) {
        r = 170; g = 200; b = 255; // cool
      } else if (tint > 0.97) {
        r = 255; g = 160; b = 160;
      } else {
        r = 230; g = 235; b = 245;
      }
      field.push({
        th: rand(0, Math.PI * 2),
        ph: rand(-1.1, 1.1),
        mag: Math.pow(Math.random(), 2.2), // more faint than bright
        r, g, b,
        flare: Math.random() > 0.985,
      });
    }
  }

  function initSystems() {
    // Named landmarks — distances in light-years (display + angular size)
    systems = [
      {
        id: "sol-analogue",
        label: "G-type primary",
        kind: "star",
        th: 0.55, ph: -0.12,
        distLy: 4.2,
        radius: 1.0,
        hue: [255, 214, 140],
      },
      {
        id: "blue-giant",
        label: "B-type giant",
        kind: "star",
        th: 2.4, ph: 0.22,
        distLy: 18,
        radius: 3.2,
        hue: [180, 210, 255],
      },
      {
        id: "red-dwarf",
        label: "K-dwarf",
        kind: "star",
        th: 4.1, ph: -0.35,
        distLy: 9.5,
        radius: 0.55,
        hue: [255, 150, 110],
      },
      {
        id: "bh-1",
        label: "Stellar BH",
        kind: "blackhole",
        th: 1.2, ph: 0.08,
        distLy: 32,
        radius: 1.4,
        spin: 0,
      },
      {
        id: "psr",
        label: "Millisecond pulsar",
        kind: "neutron",
        th: 5.0, ph: 0.18,
        distLy: 24,
        radius: 0.4,
        spin: 0,
        spinRate: 0.045,
      },
      {
        id: "psr-2",
        label: "Radio pulsar",
        kind: "neutron",
        th: 3.3, ph: -0.28,
        distLy: 41,
        radius: 0.35,
        spin: 1.2,
        spinRate: -0.03,
      },
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

  function angularSize(distLy, radius) {
    // DSP-like compressed scale: closer systems read as small disks, far as points
    // size px ≈ k * radius / dist
    return clamp((radius / distLy) * 92, 1.2, 78);
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
    if (!field.length) initField();
    if (!systems.length) initSystems();
    if (!debris.length) initDebris();
  }

  function drawNebula() {
    // soft DSP-like color washes — fixed to look direction slightly
    const gx = W * 0.5 + smoothLookX * 40;
    const gy = H * 0.5 + smoothLookY * 30;
    const a = ctx.createRadialGradient(gx * 0.4, gy * 0.3, 0, gx * 0.4, gy * 0.3, W * 0.7);
    a.addColorStop(0, "rgba(40, 70, 120, 0.16)");
    a.addColorStop(0.5, "rgba(20, 40, 80, 0.06)");
    a.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, W, H);

    const b = ctx.createRadialGradient(W * 0.85, H * 0.7, 0, W * 0.85, H * 0.7, W * 0.55);
    b.addColorStop(0, "rgba(90, 40, 70, 0.1)");
    b.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = b;
    ctx.fillRect(0, 0, W, H);
  }

  function drawFieldStar(s, streak) {
    const p = projectSky(s.th, s.ph, 0.15);
    if (!p.visible) return;
    if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) return;

    const bright = 0.25 + s.mag * 0.75;
    const core = 0.4 + s.mag * 1.6;
    const alpha = 0.2 + bright * 0.7;

    if (streak > 0.05) {
      // warp streaks only for field stars, along travel (+X sky motion)
      const len = streak * (6 + s.mag * 28);
      const ang = heading + Math.PI * 0.5; // perpendicular hint of motion
      const dx = Math.cos(heading) * len;
      const dy = Math.sin(heading) * len * 0.35;
      ctx.strokeStyle = `rgba(${s.r},${s.g},${s.b},${alpha * 0.55})`;
      ctx.lineWidth = Math.max(0.6, core * 0.35);
      ctx.beginPath();
      ctx.moveTo(p.x - dx, p.y - dy);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    // soft halo
    if (s.mag > 0.55) {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, core * 6);
      g.addColorStop(0, `rgba(${s.r},${s.g},${s.b},${0.22 * bright})`);
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

    // diffraction spikes (DSP sun / bright star feel)
    if (s.flare || s.mag > 0.88) {
      const spike = core * (8 + s.mag * 14);
      ctx.strokeStyle = `rgba(${s.r},${s.g},${s.b},${0.25 * bright})`;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(p.x - spike, p.y);
      ctx.lineTo(p.x + spike, p.y);
      ctx.moveTo(p.x, p.y - spike * 0.7);
      ctx.lineTo(p.x, p.y + spike * 0.7);
      ctx.stroke();
    }
  }

  function drawStarSystem(sys) {
    const p = projectSky(sys.th, sys.ph, 0.55);
    if (!p.visible || p.forward < 0.05) return;

    const size = angularSize(sys.distLy, sys.radius) * (0.75 + p.forward * 0.35);
    const [r, g, b] = sys.hue;

    // corona
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

    // photosphere
    const core = ctx.createRadialGradient(p.x - size * 0.15, p.y - size * 0.15, 0, p.x, p.y, size);
    core.addColorStop(0, "#fff8e8");
    core.addColorStop(0.35, `rgb(${r},${g},${b})`);
    core.addColorStop(1, `rgba(${Math.floor(r * 0.5)},${Math.floor(g * 0.4)},${Math.floor(b * 0.2)},0.9)`);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
    ctx.fill();

    // long diffraction cross
    const spike = size * 5.5;
    ctx.strokeStyle = `rgba(${r},${g},${b},0.28)`;
    ctx.lineWidth = Math.max(0.8, size * 0.06);
    ctx.beginPath();
    ctx.moveTo(p.x - spike, p.y);
    ctx.lineTo(p.x + spike, p.y);
    ctx.moveTo(p.x, p.y - spike * 0.65);
    ctx.lineTo(p.x, p.y + spike * 0.65);
    ctx.stroke();

    drawLabel(p.x, p.y + size * 2.2, sys.label, `${sys.distLy.toFixed(1)} ly`);
  }

  function drawBlackHole(sys) {
    const p = projectSky(sys.th, sys.ph, 0.55);
    if (!p.visible || p.forward < 0.05) return;
    const size = angularSize(sys.distLy, sys.radius) * (0.75 + p.forward * 0.35);
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

    // shadow
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

    drawLabel(p.x, p.y + size * 2.4, sys.label, `${sys.distLy.toFixed(0)} ly`);
  }

  function drawNeutron(sys) {
    const p = projectSky(sys.th, sys.ph, 0.55);
    if (!p.visible || p.forward < 0.05) return;
    const size = angularSize(sys.distLy, sys.radius) * (0.9 + p.forward * 0.3);
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

    drawLabel(p.x, p.y + size * 3, sys.label, `${sys.distLy.toFixed(0)} ly`);
  }

  function drawLabel(x, y, title, dist) {
    if (throttle > 0.75) return; // hide labels at full warp for clarity
    ctx.font = "500 11px 'IBM Plex Sans', sans-serif";
    ctx.fillStyle = "rgba(220, 230, 245, 0.55)";
    ctx.textAlign = "center";
    ctx.fillText(`${title}  ·  ${dist}`, x, y);
  }

  function projectLocal(x, y, z) {
    // local camera: +Z forward into depth
    const f = 280 / z;
    return {
      x: W * 0.5 + (x + smoothLookX * 8) * f,
      y: H * 0.5 + (y + smoothLookY * 6) * f,
      s: f,
    };
  }

  function drawRock(d, p) {
    const size = d.size * p.s * 0.35;
    if (size < 0.4) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(d.spin);
    ctx.beginPath();
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const jagged = 0.7 + 0.3 * Math.sin(d.seed + i * 1.9);
      const rr = size * jagged;
      const px = Math.cos(a) * rr;
      const py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    // lit from "sun" upper-left
    ctx.fillStyle = "rgba(95, 88, 80, 0.9)";
    ctx.fill();
    ctx.strokeStyle = "rgba(40, 35, 30, 0.7)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "rgba(150, 140, 125, 0.35)";
    ctx.beginPath();
    ctx.arc(-size * 0.2, -size * 0.2, size * 0.35, 0, Math.PI * 2);
    ctx.fill();
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
    ctx.strokeStyle = "rgba(240, 200, 110, 0.8)";
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.28);
    ctx.lineTo(0, -size * 0.95);
    ctx.stroke();
    ctx.restore();
  }

  function updateLocal() {
    // debris drifts slowly opposite to cruise — you're moving through local space
    const vz = 0.015 + throttle * 0.12; // AU per frame — still gentle
    const vx = Math.sin(heading) * vz * 0.15;

    for (const d of debris) {
      d.z -= vz;
      d.x -= vx;
      d.spin += d.spinRate;
      if (d.z < LOCAL_NEAR * 0.6) {
        d.z = rand(LOCAL_FAR * 0.7, LOCAL_FAR);
        d.x = rand(-80, 80);
        d.y = rand(-50, 50);
      }
    }

    // sort far → near
    const sorted = debris.slice().sort((a, b) => b.z - a.z);
    for (const d of sorted) {
      const p = projectLocal(d.x, d.y, d.z);
      if (p.x < -40 || p.x > W + 40 || p.y < -40 || p.y > H + 40) continue;
      if (d.kind === "sat") drawSat(d, p);
      else drawRock(d, p);
    }
  }

  function spawnMeteor() {
    // parallel to velocity — same direction sense
    const z = rand(30, 90);
    const side = Math.random() > 0.5 ? 1 : -1;
    meteors.push({
      x: side * rand(40, 100),
      y: rand(-35, 35),
      z,
      // velocity mostly toward camera / along cruise
      vx: -Math.sin(heading) * rand(0.4, 0.9),
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
      m.x += m.vx;
      m.y += m.vy;
      m.z += m.vz;
      m.life -= 1;
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

      // small ablating head — not a big rock cartoon
      ctx.fillStyle = `rgba(255,245,220,${0.9 * m.heat})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, w * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawDirectionCue() {
    // subtle travel corridor / vanishing point — DSP nav feel
    const vx = W * 0.5 + Math.sin(heading) * 18;
    const vy = H * 0.5 - 8 + pitch * 40;
    ctx.strokeStyle = `rgba(180, 210, 255, ${0.08 + throttle * 0.12})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(W * 0.5 - 120, H * 0.5 + 90);
    ctx.lineTo(vx, vy);
    ctx.lineTo(W * 0.5 + 120, H * 0.5 + 90);
    ctx.stroke();

    ctx.fillStyle = `rgba(240, 200, 100, ${0.35 + throttle * 0.4})`;
    ctx.beginPath();
    ctx.arc(vx, vy, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  function nearestSystemLy() {
    let best = Infinity;
    for (const s of systems) {
      const p = projectSky(s.th, s.ph, 0.55);
      if (p.visible && p.forward > 0.2) best = Math.min(best, s.distLy);
    }
    return best === Infinity ? systems[0].distLy : best;
  }

  function updateHud() {
    if (hudVel) {
      const lyh = (0.02 + throttle * 2.4).toFixed(2);
      hudVel.textContent = `${lyh} ly/h`;
    }
    if (hudRange) {
      hudRange.textContent = `${nearestSystemLy().toFixed(1)} ly`;
    }
  }

  function frame() {
    time += 1;
    throttle += ((boost ? 1 : 0) - throttle) * 0.05;
    smoothLookX += (lookX - smoothLookX) * 0.06;
    smoothLookY += (lookY - smoothLookY) * 0.06;

    // cruise rotates the sky very slowly — ly-scale travel
    heading += (CRUISE_YAW + throttle * (WARP_YAW - CRUISE_YAW));
    pitch += smoothLookY * 0.00015;

    // clear to deep space (less motion blur wash — DSP is sharp)
    ctx.fillStyle = "#060a14";
    ctx.fillRect(0, 0, W, H);
    drawNebula();

    const streak = throttle * throttle;

    for (const s of field) drawFieldStar(s, streak);

    // systems far → near by dist
    const sorted = systems.slice().sort((a, b) => b.distLy - a.distLy);
    for (const sys of sorted) {
      if (sys.kind === "star") drawStarSystem(sys);
      else if (sys.kind === "blackhole") drawBlackHole(sys);
      else if (sys.kind === "neutron") drawNeutron(sys);
    }

    updateLocal();
    updateMeteors();
    drawDirectionCue();
    updateHud();

    raf = requestAnimationFrame(frame);
  }

  function drawStatic() {
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
    const keep = { field, systems, debris };
    resize();
    field = keep.field;
    systems = keep.systems;
    debris = keep.debris;
  }, { passive: true });

  window.addEventListener("pointermove", (e) => {
    lookX = (e.clientX / W) * 2 - 1;
    lookY = (e.clientY / H) * 2 - 1;
  }, { passive: true });

  window.addEventListener("pointerdown", (e) => {
    if (e.target.closest("a, button, .panel, .section, .hud")) return;
    boost = true;
  });
  window.addEventListener("pointerup", () => { boost = false; });
  window.addEventListener("pointercancel", () => { boost = false; });
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !e.repeat) {
      e.preventDefault();
      boost = true;
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") boost = false;
  });

  resize();
  initField();
  initSystems();
  initDebris();

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
