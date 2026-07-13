/**
 * Hyperspace + celestial bodies background.
 * Warp technique inspired by classic open canvas starfields
 * (WarpSpeed.js / JS1K warp demos); bodies drawn procedurally.
 */
(() => {
  const canvas = document.getElementById("hyperspace");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: false });
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const STAR_COUNT = 720;
  const DEPTH = 1000;

  let width = 0;
  let height = 0;
  let cx = 0;
  let cy = 0;
  let targetX = 0;
  let targetY = 0;
  let speed = 0.55;
  let targetSpeed = 0.55;
  let boost = false;
  let stars = [];
  let bodies = [];
  let meteors = [];
  let raf = 0;
  let time = 0;
  let meteorCooldown = 90;

  function map(value, a1, a2, b1, b2) {
    return b1 + ((value - a1) * (b2 - b1)) / (a2 - a1);
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function resetStar(star, randomZ) {
    star.x = (Math.random() - 0.5) * width * 1.4;
    star.y = (Math.random() - 0.5) * height * 1.4;
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
      const star = {};
      resetStar(star, true);
      return star;
    });
  }

  function placeBody(type, opts = {}) {
    return {
      type,
      x: opts.x ?? (Math.random() - 0.5) * width * 2.2,
      y: opts.y ?? (Math.random() - 0.5) * height * 2.2,
      z: opts.z ?? rand(220, DEPTH * 0.95),
      pz: 0,
      scale: opts.scale ?? 1,
      spin: Math.random() * Math.PI * 2,
      spinSpeed: opts.spinSpeed ?? rand(-0.02, 0.02),
      orbitR: opts.orbitR ?? 0,
      orbitA: Math.random() * Math.PI * 2,
      orbitSpeed: opts.orbitSpeed ?? 0,
      seed: Math.random() * 1000,
      ...opts,
    };
  }

  function initBodies() {
    bodies = [
      placeBody("blackhole", {
        x: width * 0.28, y: -height * 0.08, z: 520, scale: 1.15, spinSpeed: 0.018,
      }),
      placeBody("star", {
        x: -width * 0.35, y: height * 0.12, z: 640, scale: 1.35,
        hue: [255, 196, 90],
      }),
      placeBody("star", {
        x: width * 0.42, y: height * 0.32, z: 780, scale: 0.7,
        hue: [255, 140, 110],
      }),
      placeBody("star", {
        x: -width * 0.15, y: -height * 0.35, z: 860, scale: 0.55,
        hue: [180, 210, 255],
      }),
      placeBody("neutron", {
        x: width * 0.1, y: height * 0.22, z: 480, scale: 0.85, spinSpeed: 0.08,
      }),
      placeBody("neutron", {
        x: -width * 0.4, y: -height * 0.2, z: 700, scale: 0.55, spinSpeed: -0.11,
      }),
      placeBody("satellite", {
        x: width * 0.2, y: -height * 0.25, z: 420, scale: 0.9,
        orbitR: 55, orbitSpeed: 0.012,
      }),
      placeBody("satellite", {
        x: -width * 0.22, y: height * 0.18, z: 560, scale: 0.7,
        orbitR: 40, orbitSpeed: -0.016,
      }),
      placeBody("asteroid", { scale: 1.1, spinSpeed: 0.03 }),
      placeBody("asteroid", { scale: 0.75, spinSpeed: -0.04 }),
      placeBody("asteroid", { scale: 0.95, spinSpeed: 0.025 }),
      placeBody("asteroid", { scale: 0.55, spinSpeed: -0.05 }),
      placeBody("asteroid", { scale: 1.3, spinSpeed: 0.02 }),
    ];
    for (const b of bodies) b.pz = b.z;
  }

  function spawnMeteor() {
    const fromLeft = Math.random() > 0.5;
    meteors.push({
      x: fromLeft ? -width * 0.6 : width * 0.6,
      y: rand(-height * 0.4, height * 0.4),
      z: rand(180, 420),
      pz: 0,
      vx: fromLeft ? rand(4, 9) : rand(-9, -4),
      vy: rand(-1.5, 1.5),
      vz: rand(-2, -0.5),
      life: rand(70, 130),
      size: rand(1.2, 2.4),
    });
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = width * 0.5;
    cy = height * 0.5;
    targetX = cx;
    targetY = cy;
    initStars();
    initBodies();
    meteors = [];
  }

  function project(x, y, z) {
    const k = DEPTH / Math.max(z, 1);
    return {
      x: x * k + cx + (targetX - cx) * 0.35,
      y: y * k + cy + (targetY - cy) * 0.35,
      k,
    };
  }

  function advanceDepth(obj, factor) {
    obj.pz = obj.z;
    obj.z -= speed * factor * (boost ? 1.6 : 1);
    if (obj.z < 40) {
      obj.z = DEPTH * rand(0.75, 1);
      obj.x = (Math.random() - 0.5) * width * 2.2;
      obj.y = (Math.random() - 0.5) * height * 2.2;
      obj.pz = obj.z;
    }
  }

  function drawStarBody(b, p, size) {
    const [r, g, bl] = b.hue || [255, 200, 100];
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 3.2);
    glow.addColorStop(0, `rgba(${r},${g},${bl},0.95)`);
    glow.addColorStop(0.25, `rgba(${r},${g},${bl},0.45)`);
    glow.addColorStop(1, `rgba(${r},${g},${bl},0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size * 3.2, 0, Math.PI * 2);
    ctx.fill();

    // corona rays
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(b.spin);
    ctx.strokeStyle = `rgba(${r},${g},${bl},0.35)`;
    ctx.lineWidth = Math.max(1, size * 0.08);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const len = size * (1.6 + 0.35 * Math.sin(time * 0.04 + b.seed + i));
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * size * 0.7, Math.sin(a) * size * 0.7);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = `rgb(${Math.min(255, r + 30)},${Math.min(255, g + 30)},${Math.min(255, bl + 20)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBlackHole(b, p, size) {
    // accretion disk
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(b.spin);
    ctx.scale(1, 0.38);
    const disk = ctx.createRadialGradient(0, 0, size * 0.55, 0, 0, size * 2.4);
    disk.addColorStop(0, "rgba(255, 200, 90, 0)");
    disk.addColorStop(0.35, "rgba(255, 140, 40, 0.75)");
    disk.addColorStop(0.65, "rgba(220, 60, 30, 0.45)");
    disk.addColorStop(1, "rgba(80, 20, 40, 0)");
    ctx.fillStyle = disk;
    ctx.beginPath();
    ctx.arc(0, 0, size * 2.4, 0, Math.PI * 2);
    ctx.fill();

    // hot inner ring
    ctx.strokeStyle = "rgba(255, 230, 160, 0.85)";
    ctx.lineWidth = Math.max(1.5, size * 0.12);
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.95, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // photon ring + event horizon
    const rim = ctx.createRadialGradient(p.x, p.y, size * 0.35, p.x, p.y, size * 1.1);
    rim.addColorStop(0, "rgba(0,0,0,1)");
    rim.addColorStop(0.7, "rgba(0,0,0,1)");
    rim.addColorStop(0.85, "rgba(255, 190, 120, 0.55)");
    rim.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size * 1.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(p.x, p.y, size * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawNeutron(b, p, size) {
    // pulsar beams
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(b.spin);
    const beam = ctx.createLinearGradient(0, -size * 5, 0, size * 5);
    beam.addColorStop(0, "rgba(140, 200, 255, 0)");
    beam.addColorStop(0.45, "rgba(160, 220, 255, 0.55)");
    beam.addColorStop(0.5, "rgba(255, 255, 255, 0.9)");
    beam.addColorStop(0.55, "rgba(160, 220, 255, 0.55)");
    beam.addColorStop(1, "rgba(140, 200, 255, 0)");
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(-size * 0.18, -size * 5);
    ctx.lineTo(size * 0.18, -size * 5);
    ctx.lineTo(size * 0.35, size * 5);
    ctx.lineTo(-size * 0.35, size * 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    const core = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 1.8);
    core.addColorStop(0, "rgba(255,255,255,1)");
    core.addColorStop(0.35, "rgba(160,210,255,0.9)");
    core.addColorStop(1, "rgba(80,120,255,0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size * 1.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#e8f4ff";
    ctx.beginPath();
    ctx.arc(p.x, p.y, size * 0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSatellite(b, p, size) {
    const ox = Math.cos(b.orbitA) * b.orbitR * (p.k / 40);
    const oy = Math.sin(b.orbitA) * b.orbitR * 0.45 * (p.k / 40);
    const x = p.x + ox;
    const y = p.y + oy;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(b.spin + b.orbitA);

    // solar panels
    ctx.fillStyle = "rgba(60, 110, 180, 0.85)";
    ctx.fillRect(-size * 1.8, -size * 0.22, size * 1.1, size * 0.44);
    ctx.fillRect(size * 0.7, -size * 0.22, size * 1.1, size * 0.44);
    ctx.strokeStyle = "rgba(200, 220, 255, 0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(-size * 1.8, -size * 0.22, size * 1.1, size * 0.44);
    ctx.strokeRect(size * 0.7, -size * 0.22, size * 1.1, size * 0.44);

    // body
    ctx.fillStyle = "rgba(220, 225, 230, 0.95)";
    ctx.fillRect(-size * 0.45, -size * 0.35, size * 0.9, size * 0.7);

    // antenna
    ctx.strokeStyle = "rgba(240, 200, 100, 0.9)";
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.35);
    ctx.lineTo(0, -size * 1.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -size * 1.15, size * 0.18, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  function drawAsteroid(b, p, size) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(b.spin);
    const n = 7;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const jagged = 0.65 + 0.35 * Math.sin(b.seed + i * 1.7);
      const r = size * jagged;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(120, 105, 90, 0.92)";
    ctx.fill();
    ctx.strokeStyle = "rgba(70, 55, 45, 0.8)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // craters
    ctx.fillStyle = "rgba(60, 50, 42, 0.55)";
    ctx.beginPath();
    ctx.arc(-size * 0.2, size * 0.1, size * 0.18, 0, Math.PI * 2);
    ctx.arc(size * 0.25, -size * 0.15, size * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawMeteor(m) {
    const p = project(m.x, m.y, m.z);
    const pp = project(m.x - m.vx * 2, m.y - m.vy * 2, m.z - m.vz * 2);
    const size = m.size * (p.k / 35);

    const trail = ctx.createLinearGradient(pp.x, pp.y, p.x, p.y);
    trail.addColorStop(0, "rgba(255, 180, 80, 0)");
    trail.addColorStop(0.6, "rgba(255, 160, 60, 0.45)");
    trail.addColorStop(1, "rgba(255, 240, 200, 0.95)");
    ctx.strokeStyle = trail;
    ctx.lineWidth = Math.max(1, size * 0.7);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(pp.x, pp.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 230, 180, 0.95)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1.2, size * 0.45), 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBodies() {
    // painter's algorithm: far → near
    const sortable = bodies
      .map((b) => ({ b, z: b.z }))
      .sort((a, c) => c.z - a.z);

    for (const { b } of sortable) {
      b.spin += b.spinSpeed * (boost ? 1.8 : 1);
      if (b.orbitSpeed) b.orbitA += b.orbitSpeed;

      const depthFactor =
        b.type === "asteroid" ? 10 :
        b.type === "satellite" ? 7 :
        b.type === "neutron" ? 5.5 :
        b.type === "star" ? 4.5 : 3.5;

      advanceDepth(b, depthFactor);

      const p = project(b.x, b.y, b.z);
      if (p.x < -200 || p.x > width + 200 || p.y < -200 || p.y > height + 200) {
        continue;
      }

      const size = Math.max(4, map(b.z, 40, DEPTH, 58, 8) * b.scale);

      if (b.type === "star") drawStarBody(b, p, size);
      else if (b.type === "blackhole") drawBlackHole(b, p, size);
      else if (b.type === "neutron") drawNeutron(b, p, size);
      else if (b.type === "satellite") drawSatellite(b, p, size);
      else if (b.type === "asteroid") drawAsteroid(b, p, size);
    }
  }

  function drawFieldStars() {
    for (let i = 0; i < stars.length; i++) {
      const star = stars[i];
      star.pz = star.z;
      star.z -= speed * (boost ? 18 : 8);

      if (star.z < 1) {
        resetStar(star, false);
        continue;
      }

      const p = project(star.x, star.y, star.z);
      const pp = project(star.x, star.y, star.pz);

      if (p.x < -40 || p.x > width + 40 || p.y < -40 || p.y > height + 40) {
        resetStar(star, false);
        continue;
      }

      const size = Math.max(0.4, map(star.z, 0, DEPTH, 3.0, 0.35));
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

  function updateMeteors() {
    meteorCooldown -= boost ? 3 : 1;
    if (meteorCooldown <= 0) {
      spawnMeteor();
      meteorCooldown = boost ? rand(25, 55) : rand(70, 140);
    }

    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.pz = m.z;
      m.x += m.vx * (boost ? 1.6 : 1);
      m.y += m.vy;
      m.z += m.vz;
      m.life -= 1;
      if (m.life <= 0 || m.z < 20) {
        meteors.splice(i, 1);
        continue;
      }
      drawMeteor(m);
    }
  }

  function drawFrame() {
    time += 1;
    const wash = boost ? 0.3 : 0.45;
    ctx.fillStyle = `rgba(5, 8, 20, ${wash})`;
    ctx.fillRect(0, 0, width, height);

    speed += (targetSpeed - speed) * 0.08;

    drawFieldStars();
    drawBodies();
    updateMeteors();
  }

  function drawStatic() {
    ctx.fillStyle = "#050814";
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 160; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      ctx.fillStyle = `rgba(244,239,228,${0.25 + Math.random() * 0.5})`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
    // static celestial silhouettes
    initBodies();
    speed = 0;
    targetSpeed = 0;
    drawBodies();
  }

  function loop() {
    drawFrame();
    raf = requestAnimationFrame(loop);
  }

  function setBoost(on) {
    boost = on;
    targetSpeed = on ? 2.8 : 0.55;
  }

  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("pointermove", (e) => {
    targetX = e.clientX;
    targetY = e.clientY;
  }, { passive: true });

  window.addEventListener("pointerdown", (e) => {
    if (e.target.closest("a, button, .panel, .section")) return;
    setBoost(true);
  });
  window.addEventListener("pointerup", () => setBoost(false));
  window.addEventListener("pointercancel", () => setBoost(false));

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !e.repeat) {
      e.preventDefault();
      setBoost(true);
    }
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") setBoost(false);
  });

  resize();

  if (reduced) {
    drawStatic();
    const hint = document.getElementById("warp-hint");
    if (hint) hint.hidden = true;
  } else {
    loop();
  }

  document.addEventListener("visibilitychange", () => {
    if (reduced) return;
    if (document.hidden) cancelAnimationFrame(raf);
    else loop();
  });
})();
