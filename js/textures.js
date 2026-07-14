/**
 * DSP-inspired body textures — baked once, reused every frame.
 * Runtime cost ≈ drawImage + a couple of gradients (GH Pages friendly).
 */
window.DSPTextures = (() => {
  const SIZE = 256;
  const cache = new Map();

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function hash(x, y, z) {
    const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return n - Math.floor(n);
  }

  function smoothNoise(x, y, z) {
    const x0 = Math.floor(x); const y0 = Math.floor(y); const z0 = Math.floor(z);
    const fx = x - x0; const fy = y - y0; const fz = z - z0;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const w = fz * fz * (3 - 2 * fz);
    const n000 = hash(x0, y0, z0);
    const n100 = hash(x0 + 1, y0, z0);
    const n010 = hash(x0, y0 + 1, z0);
    const n110 = hash(x0 + 1, y0 + 1, z0);
    const n001 = hash(x0, y0, z0 + 1);
    const n101 = hash(x0 + 1, y0, z0 + 1);
    const n011 = hash(x0, y0 + 1, z0 + 1);
    const n111 = hash(x0 + 1, y0 + 1, z0 + 1);
    const x00 = n000 * (1 - u) + n100 * u;
    const x10 = n010 * (1 - u) + n110 * u;
    const x01 = n001 * (1 - u) + n101 * u;
    const x11 = n011 * (1 - u) + n111 * u;
    const y0v = x00 * (1 - v) + x10 * v;
    const y1v = x01 * (1 - v) + x11 * v;
    return y0v * (1 - w) + y1v * w;
  }

  function fbm(x, y, z, oct = 5) {
    let a = 0;
    let amp = 0.5;
    let f = 1;
    for (let i = 0; i < oct; i++) {
      a += amp * smoothNoise(x * f, y * f, z * f);
      f *= 2;
      amp *= 0.5;
    }
    return a;
  }

  function makeCanvas() {
    const c = document.createElement("canvas");
    c.width = SIZE;
    c.height = SIZE;
    return c;
  }

  /** Orthographic sphere bake: each pixel is a surface point with lighting. */
  function bakeSphere(sampleFn, opts = {}) {
    const c = makeCanvas();
    const g = c.getContext("2d");
    const img = g.createImageData(SIZE, SIZE);
    const data = img.data;
    const light = opts.light || { x: -0.45, y: -0.55, z: 0.7 };
    const llen = Math.hypot(light.x, light.y, light.z) || 1;
    const lx = light.x / llen; const ly = light.y / llen; const lz = light.z / llen;
    const ambient = opts.ambient ?? 0.22;
    const rim = opts.rim ?? 0.35;

    for (let py = 0; py < SIZE; py++) {
      for (let px = 0; px < SIZE; px++) {
        const nx = (px / (SIZE - 1)) * 2 - 1;
        const ny = (py / (SIZE - 1)) * 2 - 1;
        const r2 = nx * nx + ny * ny;
        const i = (py * SIZE + px) * 4;
        if (r2 > 1) {
          data[i + 3] = 0;
          continue;
        }
        const nz = Math.sqrt(Math.max(0, 1 - r2));
        // surface albedo
        const col = sampleFn(nx, ny, nz);
        // Lambert + rim (DSP-like soft limb)
        let ndotl = Math.max(0, nx * lx + ny * ly + nz * lz);
        const fresnel = Math.pow(1 - nz, 2) * rim;
        let shade = ambient + (1 - ambient) * ndotl + fresnel * 0.25;
        if (opts.emit) shade = Math.max(shade, opts.emit);
        data[i] = clamp(col[0] * shade, 0, 255);
        data[i + 1] = clamp(col[1] * shade, 0, 255);
        data[i + 2] = clamp(col[2] * shade, 0, 255);
        data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);

    // soft anti-aliased edge
    g.globalCompositeOperation = "destination-in";
    const edge = g.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.48, SIZE / 2, SIZE / 2, SIZE * 0.5);
    edge.addColorStop(0, "#fff");
    edge.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = edge;
    g.fillRect(0, 0, SIZE, SIZE);
    g.globalCompositeOperation = "source-over";
    return c;
  }

  function biomeColor(biome, n, h, lat) {
    // DSP-inspired palette packs
    switch (biome) {
      case "mediterranean": {
        if (h > 0.62) return [210, 215, 200]; // rock peak
        if (h > 0.48) return [70, 130, 75]; // forest
        if (h > 0.4) return [120, 150, 70]; // grass
        if (n < 0.42) return [35, 90, 160]; // ocean
        return [194, 178, 128]; // shore / arid
      }
      case "arid": {
        if (n < 0.38) return [40, 80, 120];
        if (h > 0.65) return [160, 140, 110];
        return [194, 150, 90];
      }
      case "ice": {
        if (Math.abs(lat) > 0.72 || h > 0.58) return [230, 240, 255];
        if (n < 0.45) return [60, 110, 170];
        return [180, 200, 210];
      }
      case "lava": {
        if (h > 0.7) return [40, 30, 30];
        if (h > 0.55) return [90, 40, 20];
        if (n > 0.62) return [255, 120, 40];
        return [180, 50, 20];
      }
      case "ocean": {
        if (n < 0.72) return [25, 80, 150];
        if (h > 0.55) return [60, 120, 70];
        return [200, 190, 140];
      }
      case "ashen": {
        if (n < 0.4) return [50, 70, 90];
        if (h > 0.6) return [90, 95, 100];
        return [120, 115, 105];
      }
      case "pandora": {
        if (n < 0.4) return [20, 60, 120];
        if (h > 0.55) return [40, 160, 120];
        return [80, 200, 160];
      }
      case "gas": {
        const band = Math.sin(lat * 14 + n * 3) * 0.5 + 0.5;
        const warm = [210, 160, 100];
        const cool = [180, 140, 160];
        return [
          warm[0] * band + cool[0] * (1 - band),
          warm[1] * band + cool[1] * (1 - band),
          warm[2] * band + cool[2] * (1 - band),
        ];
      }
      case "gas_blue": {
        const band = Math.sin(lat * 16 + n * 4) * 0.5 + 0.5;
        const a = [120, 150, 200];
        const b = [70, 90, 140];
        return [
          a[0] * band + b[0] * (1 - band),
          a[1] * band + b[1] * (1 - band),
          a[2] * band + b[2] * (1 - band),
        ];
      }
      case "gas_cream": {
        const band = Math.sin(lat * 12 + n * 5) * 0.5 + 0.5;
        const a = [230, 210, 170];
        const b = [190, 150, 110];
        return [
          a[0] * band + b[0] * (1 - band),
          a[1] * band + b[1] * (1 - band),
          a[2] * band + b[2] * (1 - band),
        ];
      }
      default: {
        if (n < 0.45) return [30, 90, 150];
        if (h > 0.55) return [70, 130, 70];
        return [160, 140, 100];
      }
    }
  }

  function bakePlanet(biome, seed) {
    const key = `planet:${biome}:${seed}:v2`;
    if (cache.has(key)) return cache.get(key);
    const s = seed * 0.01;
    const tex = bakeSphere((nx, ny, nz) => {
      const lat = ny;
      const n = fbm(nx * 2.2 + s, ny * 2.2, nz * 2.2 + s, 4);
      const h = fbm(nx * 3.5 + 20 + s, ny * 3.5, nz * 3.5 + 9, 3);
      let col = biomeColor(biome, n, h, lat);

      // Smaller, ragged polar ice (not a clean white band)
      if (biome === "mediterranean" || biome === "ocean" || biome === "pandora") {
        const absLat = Math.abs(lat);
        const edge = fbm(nx * 7 + s * 3, ny * 1.2 + 40, nz * 7, 3);
        const crack = fbm(nx * 14 + 9, ny * 14, nz * 14 + s, 2);
        // Cap only very near poles; noise eats the margin into fjords / broken ice
        const capLine = 0.90 + (edge - 0.5) * 0.10; // ~0.85–0.95
        if (absLat > capLine) {
          const t = clamp((absLat - capLine) / Math.max(1e-4, 1 - capLine), 0, 1);
          // dirty / blue-shadow ice, not flat #fff
          let ice = [
            200 + edge * 35 + crack * 10,
            215 + edge * 25,
            230 + (1 - edge) * 20,
          ];
          if (crack > 0.58) {
            ice = [ice[0] * 0.78, ice[1] * 0.84, ice[2] * 0.92]; // crevasse
          } else if (edge < 0.38) {
            ice = [ice[0] * 0.9, ice[1] * 0.92, ice[2] * 0.95]; // dusty
          }
          // soft blend at margin so the rim is irregular, not a hard circle
          const blend = Math.pow(t, 0.85) * (0.4 + edge * 0.55);
          col = [
            col[0] * (1 - blend) + ice[0] * blend,
            col[1] * (1 - blend) + ice[1] * blend,
            col[2] * (1 - blend) + ice[2] * blend,
          ];
        } else if (absLat > capLine - 0.06 && h > 0.52) {
          // sparse highland frost patches south of the main cap
          const frost = (edge - 0.55) * 2;
          if (frost > 0) {
            const k = clamp(frost, 0, 0.45);
            col = [
              col[0] * (1 - k) + 220 * k,
              col[1] * (1 - k) + 230 * k,
              col[2] * (1 - k) + 240 * k,
            ];
          }
        }
      }

      // subtle cloud veil baked in
      const clouds = fbm(nx * 4 + s * 2, ny * 2, nz * 4, 3);
      if (clouds > 0.62 && biome !== "lava" && !String(biome).startsWith("gas")) {
        const k = (clouds - 0.62) / 0.38;
        col = [
          col[0] * (1 - k * 0.55) + 245 * k * 0.55,
          col[1] * (1 - k * 0.55) + 248 * k * 0.55,
          col[2] * (1 - k * 0.55) + 255 * k * 0.55,
        ];
      }
      return col;
    }, { ambient: 0.2, rim: 0.45 });
    cache.set(key, tex);
    return tex;
  }

  function bakeStar(hue, seed) {
    const key = `star:${hue.join(",")}:${seed}`;
    if (cache.has(key)) return cache.get(key);
    const [hr, hg, hb] = hue;
    const s = seed * 0.02;
    const tex = bakeSphere((nx, ny, nz) => {
      const gran = fbm(nx * 8 + s, ny * 8, nz * 8, 4);
      const spot = fbm(nx * 3 + 40, ny * 3, nz * 3 + s, 3);
      let r = hr; let g = hg; let b = hb;
      // granulation
      const gAmt = (gran - 0.45) * 40;
      r = clamp(r + gAmt, 0, 255);
      g = clamp(g + gAmt * 0.85, 0, 255);
      b = clamp(b + gAmt * 0.6, 0, 255);
      // sunspots
      if (spot < 0.32) {
        const k = (0.32 - spot) / 0.32;
        r *= 1 - k * 0.55;
        g *= 1 - k * 0.6;
        b *= 1 - k * 0.5;
      }
      // hotter center bias
      const core = Math.max(0, nz);
      r = clamp(r + core * 35, 0, 255);
      g = clamp(g + core * 28, 0, 255);
      b = clamp(b + core * 18, 0, 255);
      return [r, g, b];
    }, { ambient: 0.55, rim: 0.15, emit: 0.75, light: { x: -0.2, y: -0.3, z: 1 } });
    cache.set(key, tex);
    return tex;
  }

  function bakeBlackHole(seed) {
    const key = `bh:${seed}`;
    if (cache.has(key)) return cache.get(key);
    const tex = bakeSphere((nx, ny, nz) => {
      const rim = Math.pow(1 - nz, 1.4);
      const glow = rim * 255;
      return [glow * 0.95, glow * 0.55, glow * 0.2];
    }, { ambient: 0.05, rim: 0.9, emit: 0.05, light: { x: 0, y: 0, z: 1 } });
    // punch event horizon
    const g = tex.getContext("2d");
    g.globalCompositeOperation = "destination-out";
    g.beginPath();
    g.arc(SIZE / 2, SIZE / 2, SIZE * 0.28, 0, Math.PI * 2);
    g.fill();
    g.globalCompositeOperation = "source-over";
    // fill black core
    g.fillStyle = "#000";
    g.beginPath();
    g.arc(SIZE / 2, SIZE / 2, SIZE * 0.28, 0, Math.PI * 2);
    g.fill();
    cache.set(key, tex);
    return tex;
  }

  function bakeNeutron(seed) {
    const key = `ns:${seed}`;
    if (cache.has(key)) return cache.get(key);
    return bakeStar([200, 220, 255], seed + 99);
  }

  function get(sys, opts = {}) {
    const seed = (sys.id || "x").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    let key;
    if (sys.kind === "planet") key = `planet:${sys.biome || "mediterranean"}:${seed}:v2`;
    else if (sys.kind === "blackhole") key = `bh:${seed}`;
    else if (sys.kind === "neutron") key = `ns:${seed}`;
    else key = `star:${(sys.hue || [255, 220, 150]).join(",")}:${seed}`;

    if (cache.has(key)) return cache.get(key);

    if (opts.lazy) {
      enqueueWarm(sys, opts.priority || 0);
      return null;
    }

    if (sys.kind === "planet") return bakePlanet(sys.biome || "mediterranean", seed);
    if (sys.kind === "blackhole") return bakeBlackHole(seed);
    if (sys.kind === "neutron") return bakeNeutron(seed);
    return bakeStar(sys.hue || [255, 220, 150], seed);
  }

  /** @type {{ sys: object, priority: number }[]} */
  const warmQueue = [];
  const warmQueued = new Set();
  let warmScheduled = false;

  function enqueueWarm(sys, priority) {
    const id = sys.id || `${sys.kind}:${(sys.hue || []).join(",")}:${sys.biome || ""}`;
    if (warmQueued.has(id)) {
      const item = warmQueue.find((q) => {
        const qid = q.sys.id || `${q.sys.kind}:${(q.sys.hue || []).join(",")}:${q.sys.biome || ""}`;
        return qid === id;
      });
      if (item && priority > item.priority) item.priority = priority;
      return;
    }
    warmQueued.add(id);
    warmQueue.push({ sys, priority: priority || 0 });
    scheduleWarm();
  }

  function scheduleWarm() {
    if (warmScheduled || !warmQueue.length) return;
    warmScheduled = true;
    const ric = window.requestIdleCallback
      || ((cb) => requestAnimationFrame(() => cb({ timeRemaining: () => 5, didTimeout: true })));
    ric((deadline) => {
      warmScheduled = false;
      // featured / high-priority first
      warmQueue.sort((a, b) => b.priority - a.priority);
      const t0 = performance.now();
      const budget = Math.min(
        8,
        typeof deadline.timeRemaining === "function" ? Math.max(3, deadline.timeRemaining()) : 5
      );
      while (warmQueue.length && performance.now() - t0 < budget) {
        const { sys } = warmQueue.shift();
        get(sys); // sync bake one body inside idle budget
      }
      if (warmQueue.length) scheduleWarm();
    }, { timeout: 120 });
  }

  /** Enqueue systems for idle baking — never blocks first paint. */
  function warm(systems) {
    for (let i = 0; i < systems.length; i++) {
      const sys = systems[i];
      enqueueWarm(sys, sys.featured ? 100 - i : Math.max(0, 40 - i));
    }
  }

  return { get, warm, SIZE, bakePlanet, bakeStar };
})();
