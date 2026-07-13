/**
 * Hyperspace starfield background.
 * Technique: classic perspective warp / starfield (HTML5 canvas),
 * in the spirit of open demos such as WarpSpeed.js (LGPL) and
 * Kevin Roast's JS1K warp field — reimplemented from scratch here.
 */
(() => {
  const canvas = document.getElementById("hyperspace");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: false });
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const STAR_COUNT = 900;
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
  let raf = 0;

  function map(value, a1, a2, b1, b2) {
    return b1 + ((value - a1) * (b2 - b1)) / (a2 - a1);
  }

  function resetStar(star, randomZ) {
    star.x = (Math.random() - 0.5) * width * 1.4;
    star.y = (Math.random() - 0.5) * height * 1.4;
    star.z = randomZ ? Math.random() * DEPTH : DEPTH;
    star.pz = star.z;
    // warm white → amber / ice tint
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
  }

  function project(x, y, z) {
    const k = DEPTH / z;
    return {
      x: x * k + cx + (targetX - cx) * 0.35,
      y: y * k + cy + (targetY - cy) * 0.35,
    };
  }

  function drawFrame() {
    // motion blur trail — darker wash instead of full clear
    const wash = boost ? 0.28 : 0.42;
    ctx.fillStyle = `rgba(5, 8, 20, ${wash})`;
    ctx.fillRect(0, 0, width, height);

    speed += (targetSpeed - speed) * 0.08;

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

      if (
        p.x < -40 || p.x > width + 40 ||
        p.y < -40 || p.y > height + 40
      ) {
        resetStar(star, false);
        continue;
      }

      const size = Math.max(0.4, map(star.z, 0, DEPTH, 3.2, 0.35));
      const alpha = map(star.z, 0, DEPTH, 1, 0.15);
      const color = `rgba(${star.r},${star.g},${star.b},${alpha})`;

      // streak
      ctx.beginPath();
      ctx.moveTo(pp.x, pp.y);
      ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = "round";
      ctx.stroke();

      // head
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(p.x, p.y, size * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawStatic() {
    ctx.fillStyle = "#050814";
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < 180; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const a = 0.25 + Math.random() * 0.55;
      ctx.fillStyle = `rgba(244,239,228,${a})`;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
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
    // don't steal clicks from links / buttons
    if (e.target.closest("a, button, .section")) return;
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

  // pause when tab hidden
  document.addEventListener("visibilitychange", () => {
    if (reduced) return;
    if (document.hidden) {
      cancelAnimationFrame(raf);
    } else {
      loop();
    }
  });
})();
