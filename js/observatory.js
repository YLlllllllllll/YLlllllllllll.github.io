/* Interactive exhibits: Millennium atlas, matrix lab, and Dyson arena. */
(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* -----------------------------------------------------------------------
     Millennium atlas
     ----------------------------------------------------------------------- */
  const problems = {
    pnp: {
      index: "01",
      title: "P vs NP",
      question: "Can every problem whose solution is easy to verify also be solved efficiently?",
      body: "Fast checking versus fast finding — the boundary under cryptography and optimization.",
      field: "Computation",
      state: "Unresolved",
      status: "Open · $1M prize",
      ai: "SAT solvers and proof assistants can search; a machine-checkable separation is still a proof.",
      link: "https://www.claymath.org/millennium/p-vs-np/",
    },
    riemann: {
      index: "02",
      title: "Riemann Hypothesis",
      question: "Do all non-trivial zeros of the Riemann zeta function lie on the critical line Re(s) = 1/2?",
      body: "The zeros of zeta encode the primes. A proof would expose arithmetic's deepest structure.",
      field: "Number theory",
      state: "Unresolved",
      status: "Open · $1M prize",
      ai: "ML can scan zeros and propose patterns. It cannot prove an infinite asymptotic.",
      link: "https://www.claymath.org/millennium/riemann-hypothesis/",
    },
    yangmills: {
      index: "03",
      title: "Yang–Mills & Mass Gap",
      question: "Can a four-dimensional quantum Yang–Mills theory be constructed rigorously, and does it have a positive mass gap?",
      body: "The Standard Model needs a rigorous four-dimensional construction — and a reason mass has a gap.",
      field: "Mathematical physics",
      state: "Unresolved",
      status: "Open · $1M prize",
      ai: "Lattice QCD supplies strong numerical evidence. The prize demands a proof.",
      link: "https://www.claymath.org/millennium/yang-mills-the-maths-gap/",
    },
    navier: {
      index: "04",
      title: "Navier–Stokes",
      question: "Do smooth solutions to the three-dimensional incompressible Navier–Stokes equations always exist, or can finite-time singularities form?",
      body: "Smooth 3D fluid flow: does it always exist, or can it blow up in finite time?",
      field: "Fluid dynamics",
      state: "Unresolved",
      status: "Open · $1M prize",
      ai: "Neural PDEs guide intuition. Global regularity still needs analysis, not extrapolation.",
      link: "https://www.claymath.org/millennium/navier-stokes-equation/",
    },
    hodge: {
      index: "05",
      title: "Hodge Conjecture",
      question: "On a projective algebraic variety, is every rational cohomology class of type (p,p) a rational combination of algebraic cycles?",
      body: "When does a cohomology class that looks geometric actually come from subvarieties?",
      field: "Algebraic geometry",
      state: "Unresolved",
      status: "Open · $1M prize",
      ai: "Computational algebra can test examples. A general proof across all varieties is the hard part.",
      link: "https://www.claymath.org/millennium/hodge-conjecture/",
    },
    bsd: {
      index: "06",
      title: "Birch–Swinnerton-Dyer",
      question: "For an elliptic curve over the rationals, does the rank of its Mordell–Weil group equal the order of vanishing of its L-function at s = 1?",
      body: "Rational points on elliptic curves versus the vanishing order of their L-function.",
      field: "Arithmetic geometry",
      state: "Unresolved",
      status: "Open · $1M prize",
      ai: "Large-scale rank and L-value computation is central. ML prioritizes curves; it does not prove the identity.",
      link: "https://www.claymath.org/millennium/birch-and-swinnerton-dyer-conjecture/",
    },
    poincare: {
      index: "07",
      title: "Poincaré Conjecture",
      question: "Is every simply connected closed three-manifold homeomorphic to the three-sphere?",
      body: "Every simply connected closed three-manifold is the three-sphere. Perelman proved it; Clay verified in 2010.",
      field: "Topology",
      state: "Solved · 2002–03",
      status: "Solved · verified 2010",
      ai: "A formalization benchmark. Proof assistants verify the argument; the insight was human-led.",
      link: "https://www.claymath.org/millennium/poincare-conjecture/",
    },
  };

  const atlasTabs = Array.from(document.querySelectorAll(".atlas-tab"));
  const atlasPanel = document.getElementById("atlas-panel");
  const atlasFields = {
    index: document.getElementById("detail-index"),
    status: document.getElementById("detail-status"),
    title: document.getElementById("detail-title"),
    question: document.getElementById("detail-question"),
    body: document.getElementById("detail-body"),
    field: document.getElementById("detail-field"),
    state: document.getElementById("detail-state"),
    ai: document.getElementById("detail-ai"),
    link: document.getElementById("detail-link"),
  };

  const feedElements = {
    root: document.getElementById("atlas-live"),
    status: document.getElementById("feed-status"),
    updated: document.getElementById("feed-updated"),
    wire: document.getElementById("openai-wire"),
    refresh: document.getElementById("feed-refresh"),
    problemRoot: document.getElementById("problem-feed"),
    problemMeta: document.getElementById("problem-feed-meta"),
    problemList: document.getElementById("problem-feed-list"),
    problemEmpty: document.getElementById("problem-feed-empty"),
  };
  const feedState = {
    payload: null,
    loading: false,
    error: null,
    requestId: 0,
    loadedAt: 0,
  };
  const sourceNames = { openai: "OpenAI", clay: "Clay", arxiv: "arXiv" };
  const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  const syncDate = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  function feedDate(value) {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function currentAtlasProblem() {
    return atlasPanel?.dataset.problem || "pnp";
  }

  function createSourceBadge(source) {
    const badge = document.createElement("span");
    badge.className = `feed-source is-${source || "other"}`;
    badge.textContent = sourceNames[source] || source || "Source";
    return badge;
  }

  function setFeedBusy(busy) {
    feedElements.root?.setAttribute("aria-busy", String(busy));
    feedElements.problemRoot?.setAttribute("aria-busy", String(busy));
    if (feedElements.refresh) {
      feedElements.refresh.disabled = busy;
      feedElements.refresh.classList.toggle("is-loading", busy);
    }
  }

  function updateFeedStatus() {
    if (feedElements.status) {
      if (feedState.loading && !feedState.payload) {
        feedElements.status.textContent = "Syncing official research…";
      } else if (feedState.error && feedState.payload) {
        feedElements.status.textContent = "Cached snapshot · sync retrying";
      } else if (feedState.error) {
        feedElements.status.textContent = "Wire offline · static view";
      } else if (feedState.payload) {
        feedElements.status.textContent = "Live · auto-refresh every 6h";
      } else {
        feedElements.status.textContent = "Connecting to the research wire…";
      }
    }
    if (feedElements.updated) {
      const synced = feedDate(feedState.payload?.generated_at);
      if (synced) {
        feedElements.updated.dateTime = synced.toISOString();
        feedElements.updated.textContent = `Synced ${syncDate.format(synced)}`;
      } else {
        feedElements.updated.removeAttribute("datetime");
        feedElements.updated.textContent = feedState.error ? "Awaiting next successful sync" : "Waiting for first sync";
      }
    }
  }

  function renderOpenAIWire() {
    if (!feedElements.wire) return;
    feedElements.wire.replaceChildren();
    const items = Array.isArray(feedState.payload?.wire) ? feedState.payload.wire.slice(0, 3) : [];
    if (!items.length) {
      const placeholder = document.createElement("span");
      placeholder.className = "wire-placeholder";
      placeholder.textContent = feedState.loading
        ? "Loading official OpenAI research signals…"
        : feedState.error
          ? "OpenAI wire is temporarily unavailable. The static atlas remains online."
          : "No OpenAI mathematics signal in this snapshot.";
      feedElements.wire.append(placeholder);
      return;
    }

    for (const item of items) {
      const link = document.createElement("a");
      link.className = "wire-item";
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";

      const meta = document.createElement("span");
      meta.className = "wire-meta";
      meta.append(createSourceBadge(item.source));
      if (item.topic) {
        const topic = document.createElement("span");
        topic.className = "wire-topic";
        topic.textContent = item.topic;
        meta.append(topic);
      }

      const title = document.createElement("strong");
      title.textContent = item.title || "Untitled signal";

      const time = document.createElement("time");
      const parsed = feedDate(item.published);
      time.textContent = parsed ? shortDate.format(parsed) : "Undated";
      if (parsed) time.dateTime = parsed.toISOString();

      link.append(meta, title, time);
      feedElements.wire.append(link);
    }
  }

  function renderProblemFeed(key) {
    if (!feedElements.problemList || !feedElements.problemEmpty) return;
    feedElements.problemList.replaceChildren();
    const problem = feedState.payload?.problems?.[key];
    const items = Array.isArray(problem?.items) ? problem.items : [];
    feedElements.problemRoot?.classList.toggle("has-openai", Boolean(problem?.source_counts?.openai));

    if (!items.length) {
      feedElements.problemEmpty.hidden = false;
      feedElements.problemEmpty.textContent = feedState.loading
        ? "Connecting to the live research wire…"
        : feedState.error
          ? "Live feed unavailable right now. The Clay Institute brief below remains authoritative."
          : "No exact OpenAI or arXiv match has landed for this problem yet.";
      if (feedElements.problemMeta) {
        feedElements.problemMeta.textContent = feedState.loading
          ? "Syncing…"
          : feedState.error
            ? "Offline"
            : "No signal";
      }
      return;
    }

    for (const item of items) {
      const link = document.createElement("a");
      link.className = `feed-item is-${item.source || "other"}`;
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";

      const copy = document.createElement("span");
      copy.className = "feed-item-copy";
      const title = document.createElement("strong");
      title.textContent = item.title || "Untitled signal";
      copy.append(title);
      if (item.summary) {
        const summary = document.createElement("small");
        summary.textContent = item.summary;
        copy.append(summary);
      }

      const time = document.createElement("time");
      const parsed = feedDate(item.published);
      time.textContent = parsed ? shortDate.format(parsed) : "—";
      if (parsed) time.dateTime = parsed.toISOString();

      link.append(createSourceBadge(item.source), copy, time);
      feedElements.problemList.append(link);
    }

    feedElements.problemEmpty.hidden = true;
    if (feedElements.problemMeta) {
      const counts = problem.source_counts || {};
      const labels = [];
      if (counts.openai) labels.push(`OpenAI ${counts.openai}`);
      if (counts.clay) labels.push(`Clay ${counts.clay}`);
      if (counts.arxiv) labels.push(`arXiv ${counts.arxiv}`);
      if (!counts.openai) labels.push("no exact OpenAI match");
      feedElements.problemMeta.textContent = labels.join(" · ");
    }
  }

  async function loadMillenniumFeed() {
    if (feedState.loading) return;
    feedState.loading = true;
    feedState.requestId += 1;
    const requestId = feedState.requestId;
    setFeedBusy(true);
    updateFeedStatus();
    renderOpenAIWire();
    renderProblemFeed(currentAtlasProblem());

    const controller = "AbortController" in window ? new AbortController() : null;
    const timeout = controller ? window.setTimeout(() => controller.abort(), 9000) : 0;
    try {
      if (!("fetch" in window)) throw new Error("fetch unavailable");
      const response = await fetch(`data/millennium-feed.json?v=${Date.now()}`, {
        cache: "no-store",
        signal: controller?.signal,
      });
      if (!response.ok) throw new Error(`feed HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload || !payload.problems || !Array.isArray(payload.wire)) {
        throw new Error("feed schema mismatch");
      }
      if (requestId !== feedState.requestId) return;
      feedState.payload = payload;
      feedState.error = null;
      feedState.loadedAt = Date.now();
    } catch (error) {
      if (requestId !== feedState.requestId) return;
      feedState.error = error;
    } finally {
      if (timeout) window.clearTimeout(timeout);
      if (requestId === feedState.requestId) {
        feedState.loading = false;
        setFeedBusy(false);
        updateFeedStatus();
        renderOpenAIWire();
        renderProblemFeed(currentAtlasProblem());
      }
    }
  }

  function selectProblem(key, focusTab = false) {
    const problem = problems[key];
    const tab = atlasTabs.find((item) => item.dataset.problem === key);
    if (!problem || !tab || !atlasPanel) return;

    atlasTabs.forEach((item) => {
      const selected = item === tab;
      item.classList.toggle("is-active", selected);
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
    });

    atlasPanel.setAttribute("aria-labelledby", tab.id);
    atlasPanel.dataset.problem = key;
    atlasPanel.classList.toggle("is-solved", key === "poincare");
    atlasFields.index.textContent = `Problem ${problem.index} / 07`;
    atlasFields.status.textContent = problem.status;
    atlasFields.title.textContent = problem.title;
    atlasFields.question.textContent = problem.question;
    atlasFields.body.textContent = problem.body;
    atlasFields.field.textContent = problem.field;
    atlasFields.state.textContent = problem.state;
    atlasFields.ai.textContent = problem.ai;
    atlasFields.link.href = problem.link;
    renderProblemFeed(key);
    if (focusTab) tab.focus();
  }

  atlasTabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectProblem(tab.dataset.problem));
    tab.addEventListener("keydown", (event) => {
      let next = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % atlasTabs.length;
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + atlasTabs.length) % atlasTabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = atlasTabs.length - 1;
      if (next === null) return;
      event.preventDefault();
      selectProblem(atlasTabs[next].dataset.problem, true);
    });
  });

  feedElements.refresh?.addEventListener("click", () => loadMillenniumFeed());
  updateFeedStatus();
  renderOpenAIWire();
  renderProblemFeed(currentAtlasProblem());
  loadMillenniumFeed();
  window.setInterval(() => {
    if (!document.hidden) loadMillenniumFeed();
  }, 6 * 60 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - feedState.loadedAt > 6 * 60 * 60 * 1000) {
      loadMillenniumFeed();
    }
  });

  /* -----------------------------------------------------------------------
     Matrix lab
     ----------------------------------------------------------------------- */
  const matrixCanvas = document.getElementById("matrix-canvas");
  if (matrixCanvas) {
    const ctx = matrixCanvas.getContext("2d");
    const matrix = { a: 1.15, b: 0.45, c: 0.15, d: 0.9 };
    const inputs = {
      a: document.getElementById("in-a"),
      b: document.getElementById("in-b"),
      c: document.getElementById("in-c"),
      d: document.getElementById("in-d"),
    };
    const outputs = {
      a: document.getElementById("out-a"),
      b: document.getElementById("out-b"),
      c: document.getElementById("out-c"),
      d: document.getElementById("out-d"),
    };
    const readout = {
      matrix: ["m-a", "m-b", "m-c", "m-d"].map((id) => document.getElementById(id)),
      det: document.getElementById("m-det"),
      area: document.getElementById("m-area"),
      trace: document.getElementById("m-trace"),
      eigen: document.getElementById("m-eigen"),
      kind: document.getElementById("m-kind"),
      eigenA: document.getElementById("eigen-point-a"),
      eigenB: document.getElementById("eigen-point-b"),
    };
    const presetButtons = Array.from(document.querySelectorAll(".preset"));
    const presets = {
      identity: { a: 1, b: 0, c: 0, d: 1 },
      rotate: { a: 0.87, b: -0.5, c: 0.5, d: 0.87 },
      shear: { a: 1, b: 1, c: 0, d: 1 },
      stretch: { a: 1.6, b: 0, c: 0, d: 0.6 },
      reflect: { a: 1, b: 0, c: 0, d: -1 },
      singular: { a: 1, b: 1, c: 2, d: 2 },
    };

    let width = 0;
    let height = 0;
    let scale = 52;
    let inView = false;
    let raf = 0;
    let lastTime = 0;
    let dragKey = null;
    let pointer = { x: 0, y: 0 };
    let morphRaf = 0;
    let morphPreset = null;

    function setMatrix(next, activePreset = null) {
      Object.assign(matrix, next);
      for (const key of ["a", "b", "c", "d"]) {
        inputs[key].value = matrix[key].toFixed(2);
        outputs[key].textContent = matrix[key].toFixed(2);
      }
      if (activePreset !== undefined) {
        presetButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.preset === activePreset));
      }
      updateReadout();
      draw(performance.now());
    }

    function currentPreset() {
      for (const [name, value] of Object.entries(presets)) {
        if (["a", "b", "c", "d"].every((key) => Math.abs(matrix[key] - value[key]) < 0.012)) return name;
      }
      return null;
    }

    function placeEigenPoint(point, re, im) {
      if (!point) return;
      const clamp = (value) => Math.max(-2, Math.min(2, value));
      point.style.setProperty("--px", `${50 + (clamp(re) / 2) * 40}%`);
      point.style.setProperty("--py", `${50 - (clamp(im) / 2) * 40}%`);
    }

    function updateReadout() {
      const { a, b, c, d } = matrix;
      const det = a * d - b * c;
      const trace = a + d;
      const disc = trace * trace - 4 * det;
      const values = [a, b, c, d];
      readout.matrix.forEach((node, i) => { node.textContent = values[i].toFixed(2); });
      readout.det.textContent = det.toFixed(3);
      readout.trace.textContent = trace.toFixed(3);
      if (Math.abs(det) < 0.005) {
        readout.area.textContent = "area → 0 · collapsed";
      } else if (det < 0) {
        readout.area.textContent = `area ×${Math.abs(det).toFixed(3)} · orientation flipped`;
      } else {
        readout.area.textContent = `area ×${det.toFixed(3)}`;
      }

      if (disc >= -0.0001) {
        const root = Math.sqrt(Math.max(0, disc));
        const l1 = (trace + root) / 2;
        const l2 = (trace - root) / 2;
        readout.eigen.textContent = `${l1.toFixed(2)}, ${l2.toFixed(2)}`;
        readout.kind.textContent = root < 0.02 ? "real, repeated" : "real, distinct";
        placeEigenPoint(readout.eigenA, l1, 0);
        placeEigenPoint(readout.eigenB, l2, 0);
      } else {
        const real = trace / 2;
        const imag = Math.sqrt(-disc) / 2;
        readout.eigen.textContent = `${real.toFixed(2)} ± ${imag.toFixed(2)}i`;
        readout.kind.textContent = "complex conjugate pair";
        placeEigenPoint(readout.eigenA, real, imag);
        placeEigenPoint(readout.eigenB, real, -imag);
      }

      const activePreset = morphPreset || currentPreset();
      presetButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.preset === activePreset));
    }

    function animateToMatrix(next, activePreset = null) {
      if (morphRaf) cancelAnimationFrame(morphRaf);
      morphPreset = activePreset;
      const from = { ...matrix };
      const start = performance.now();
      const duration = reducedMotion ? 0 : 560;
      if (!duration) {
        morphPreset = null;
        setMatrix(next, activePreset);
        return;
      }
      function step(now) {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        for (const key of ["a", "b", "c", "d"]) {
          matrix[key] = from[key] + (next[key] - from[key]) * eased;
          inputs[key].value = matrix[key].toFixed(2);
          outputs[key].textContent = matrix[key].toFixed(2);
        }
        updateReadout();
        draw(now);
        if (progress < 1) {
          morphRaf = requestAnimationFrame(step);
        } else {
          morphRaf = 0;
          morphPreset = null;
          setMatrix(next, activePreset);
        }
      }
      morphRaf = requestAnimationFrame(step);
    }

    function resize() {
      const rect = matrixCanvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      matrixCanvas.width = Math.round(width * dpr);
      matrixCanvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      scale = Math.min(width, height) / 8.8;
      draw(performance.now());
    }

    function project(x, y) {
      return { x: width / 2 + x * scale, y: height / 2 - y * scale };
    }

    function unproject(x, y) {
      return { x: (x - width / 2) / scale, y: (height / 2 - y) / scale };
    }

    function image(x, y) {
      return { x: matrix.a * x + matrix.b * y, y: matrix.c * x + matrix.d * y };
    }

    function lineBetween(p1, p2) {
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    function drawArrow(tip, color, label) {
      const origin = project(0, 0);
      const head = project(tip.x, tip.y);
      const angle = Math.atan2(head.y - origin.y, head.x - origin.x);
      const headSize = Math.max(7, Math.min(14, Math.hypot(head.x - origin.x, head.y - origin.y) * 0.18));
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.75;
      ctx.shadowColor = color;
      ctx.shadowBlur = 9;
      lineBetween(origin, head);
      ctx.beginPath();
      ctx.moveTo(head.x, head.y);
      ctx.lineTo(head.x - Math.cos(angle - 0.42) * headSize, head.y - Math.sin(angle - 0.42) * headSize);
      ctx.lineTo(head.x - Math.cos(angle + 0.42) * headSize, head.y - Math.sin(angle + 0.42) * headSize);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = "500 10px 'IBM Plex Mono', monospace";
      ctx.fillText(label, head.x + Math.cos(angle) * 9 + 4, head.y + Math.sin(angle) * 9 + 4);
      ctx.restore();
      return head;
    }

    function drawGrid() {
      const extent = 4.5;
      ctx.save();
      ctx.lineWidth = 1;
      for (let n = -4; n <= 4; n += 0.5) {
        if (Math.abs(n) < 0.001) continue;
        const verticalA = project(n, -extent);
        const verticalB = project(n, extent);
        const horizontalA = project(-extent, n);
        const horizontalB = project(extent, n);
        ctx.strokeStyle = Math.abs(n - Math.round(n)) < 0.001 ? "rgba(242,236,221,0.105)" : "rgba(242,236,221,0.045)";
        lineBetween(verticalA, verticalB);
        lineBetween(horizontalA, horizontalB);
      }
      ctx.strokeStyle = "rgba(242,236,221,0.28)";
      lineBetween(project(-extent, 0), project(extent, 0));
      lineBetween(project(0, -extent), project(0, extent));
      ctx.restore();
    }

    function drawTransformedGrid() {
      const extent = 4.5;
      ctx.save();
      ctx.lineWidth = 1;
      for (let n = -4; n <= 4; n += 0.5) {
        const opacity = Math.abs(n - Math.round(n)) < 0.001 ? 0.19 : 0.075;
        ctx.strokeStyle = `rgba(242,198,109,${opacity})`;
        const v1 = image(n, -extent);
        const v2 = image(n, extent);
        const h1 = image(-extent, n);
        const h2 = image(extent, n);
        lineBetween(project(v1.x, v1.y), project(v2.x, v2.y));
        lineBetween(project(h1.x, h1.y), project(h2.x, h2.y));
      }
      ctx.restore();
    }

    function drawCircleImage(time) {
      ctx.save();
      ctx.setLineDash([4, 7]);
      ctx.strokeStyle = "rgba(242,236,221,0.26)";
      ctx.beginPath();
      for (let i = 0; i <= 96; i++) {
        const angle = (i / 96) * Math.PI * 2;
        const point = project(Math.cos(angle), Math.sin(angle));
        if (i === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      for (let i = 0; i <= 132; i++) {
        const angle = (i / 132) * Math.PI * 2;
        const transformed = image(Math.cos(angle), Math.sin(angle));
        const point = project(transformed.x, transformed.y);
        if (i === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(242,198,109,0.075)";
      ctx.fill();
      ctx.strokeStyle = "rgba(242,198,109,0.58)";
      ctx.lineWidth = 1.25;
      ctx.stroke();

      if (!reducedMotion) {
        const angle = (time * 0.00022) % (Math.PI * 2);
        const inputPoint = { x: Math.cos(angle), y: Math.sin(angle) };
        const outputPoint = image(inputPoint.x, inputPoint.y);
        const p0 = project(inputPoint.x, inputPoint.y);
        const p1 = project(outputPoint.x, outputPoint.y);
        ctx.setLineDash([2, 5]);
        ctx.strokeStyle = "rgba(242,236,221,0.18)";
        ctx.lineWidth = 1;
        lineBetween(p0, p1);
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(242,236,221,0.4)";
        ctx.beginPath();
        ctx.arc(p0.x, p0.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(242,198,109,0.95)";
        ctx.shadowColor = "rgba(242,198,109,0.8)";
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.restore();
    }

    function drawEigenLines() {
      const { a, b, c, d } = matrix;
      const trace = a + d;
      const det = a * d - b * c;
      const disc = trace * trace - 4 * det;
      if (disc < 0.001) return;
      const root = Math.sqrt(disc);
      const eigenvalues = [(trace + root) / 2, (trace - root) / 2];
      ctx.save();
      ctx.setLineDash([2, 8]);
      ctx.lineWidth = 1;
      eigenvalues.forEach((lambda, index) => {
        let vx;
        let vy;
        if (Math.abs(b) > 0.001) {
          vx = b;
          vy = lambda - a;
        } else if (Math.abs(c) > 0.001) {
          vx = lambda - d;
          vy = c;
        } else {
          vx = 1;
          vy = 0;
        }
        const length = Math.hypot(vx, vy) || 1;
        vx /= length;
        vy /= length;
        ctx.strokeStyle = index === 0 ? "rgba(255,223,155,0.17)" : "rgba(124,230,212,0.14)";
        lineBetween(project(-vx * 5, -vy * 5), project(vx * 5, vy * 5));
      });
      ctx.restore();
    }

    function draw(time) {
      if (!width || !height) return;
      ctx.clearRect(0, 0, width, height);
      const background = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * 0.65);
      background.addColorStop(0, "rgba(13,26,38,0.9)");
      background.addColorStop(1, "rgba(3,7,13,0.98)");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);

      drawGrid();
      drawTransformedGrid();
      drawEigenLines();
      drawCircleImage(time);
      drawArrow({ x: matrix.a, y: matrix.c }, "#7ce6d4", "e₁");
      drawArrow({ x: matrix.b, y: matrix.d }, "#ff826b", "e₂");

      if (!reducedMotion) {
        const angle = (time * 0.00022) % (Math.PI * 2);
        const v = image(Math.cos(angle), Math.sin(angle));
        const tip = project(v.x, v.y);
        ctx.save();
        ctx.fillStyle = "rgba(242,198,109,0.92)";
        ctx.shadowColor = "rgba(242,198,109,0.9)";
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, 3.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.fillStyle = "rgba(242,236,221,0.24)";
      ctx.font = "9px 'IBM Plex Mono', monospace";
      ctx.fillText("ORIGINAL GRID / UNIT CIRCLE", 14, 20);
      ctx.restore();
    }

    function matrixFrame(time) {
      draw(time);
      raf = inView && !document.hidden ? requestAnimationFrame(matrixFrame) : 0;
    }

    function ensureMatrixLoop() {
      if (reducedMotion || !inView || document.hidden || raf) return;
      raf = requestAnimationFrame(matrixFrame);
    }

    function handlePointerDown(event) {
      if (morphRaf) {
        cancelAnimationFrame(morphRaf);
        morphRaf = 0;
        morphPreset = null;
      }
      const rect = matrixCanvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const e1 = project(matrix.a, matrix.c);
      const e2 = project(matrix.b, matrix.d);
      const d1 = Math.hypot(x - e1.x, y - e1.y);
      const d2 = Math.hypot(x - e2.x, y - e2.y);
      if (Math.min(d1, d2) > 26) return;
      dragKey = d1 <= d2 ? "e1" : "e2";
      matrixCanvas.classList.add("is-dragging");
      matrixCanvas.setPointerCapture(event.pointerId);
      updateDragPoint(event);
      event.preventDefault();
    }

    function updateDragPoint(event) {
      if (!dragKey) return;
      const rect = matrixCanvas.getBoundingClientRect();
      pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const math = unproject(pointer.x, pointer.y);
      const x = Math.max(-2, Math.min(2, math.x));
      const y = Math.max(-2, Math.min(2, math.y));
      if (dragKey === "e1") {
        matrix.a = x;
        matrix.c = y;
      } else {
        matrix.b = x;
        matrix.d = y;
      }
      for (const key of ["a", "b", "c", "d"]) {
        inputs[key].value = matrix[key].toFixed(2);
        outputs[key].textContent = matrix[key].toFixed(2);
      }
      updateReadout();
      draw(performance.now());
    }

    function endDrag(event) {
      if (!dragKey) return;
      dragKey = null;
      matrixCanvas.classList.remove("is-dragging");
      if (matrixCanvas.hasPointerCapture(event.pointerId)) matrixCanvas.releasePointerCapture(event.pointerId);
    }

    for (const key of ["a", "b", "c", "d"]) {
      inputs[key].addEventListener("input", () => {
        if (morphRaf) {
          cancelAnimationFrame(morphRaf);
          morphRaf = 0;
          morphPreset = null;
        }
        matrix[key] = Number(inputs[key].value);
        outputs[key].textContent = matrix[key].toFixed(2);
        updateReadout();
        draw(performance.now());
      });
    }
    presetButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const name = button.dataset.preset;
        if (name === "random") {
          const sample = () => Number((Math.random() * 3.2 - 1.6).toFixed(2));
          animateToMatrix({ a: sample(), b: sample(), c: sample(), d: sample() }, "random");
          return;
        }
        const preset = presets[name];
        if (!preset) return;
        animateToMatrix(preset, name);
      });
    });

    matrixCanvas.addEventListener("pointerdown", handlePointerDown);
    matrixCanvas.addEventListener("pointermove", updateDragPoint);
    matrixCanvas.addEventListener("pointerup", endDrag);
    matrixCanvas.addEventListener("pointercancel", endDrag);

    new ResizeObserver(resize).observe(matrixCanvas);
    new IntersectionObserver((entries) => {
      inView = entries.some((entry) => entry.isIntersecting);
      if (inView) ensureMatrixLoop();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    }, { threshold: 0.05 }).observe(matrixCanvas);

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      } else {
        ensureMatrixLoop();
      }
    });

    resize();
    updateReadout();
  }

  /* -----------------------------------------------------------------------
     Dyson arena mini-game
     ----------------------------------------------------------------------- */
  const gameCanvas = document.getElementById("dyson-game");
  if (gameCanvas) {
    const gctx = gameCanvas.getContext("2d");
    const scoreEl = document.getElementById("game-score");
    const comboEl = document.getElementById("game-combo");
    const hullEl = document.getElementById("game-hull");
    const bestEl = document.getElementById("game-best");
    const overlay = document.getElementById("game-overlay");
    const overlayKicker = document.getElementById("game-overlay-kicker");
    const overlayTitle = document.getElementById("game-overlay-title");
    const overlayCopy = document.getElementById("game-overlay-copy");
    const startButton = document.getElementById("game-start");
    const resetButton = document.getElementById("game-reset");

    let gameWidth = 0;
    let gameHeight = 0;
    let center = { x: 0, y: 0 };
    let starRadius = 50;
    let orbitRadius = 150;
    let spawnRadius = 400;
    let collectorAngle = -Math.PI / 2;
    let running = false;
    let gameOver = false;
    let score = 0;
    let combo = 1;
    let hull = 3;
    let elapsed = 0;
    let spawnTimer = 0;
    let catchPulse = 0;
    let hurtPulse = 0;
    let pointerActive = false;
    let inView = false;
    let raf = 0;
    let lastTs = 0;
    const keys = { left: false, right: false };
    let best = 0;

    try { best = Number(localStorage.getItem("dyson-arena-best") || 0) || 0; } catch (_) { best = 0; }
    const backgroundStars = Array.from({ length: 80 }, (_, i) => ({
      x: ((i * 73.17) % 997) / 997,
      y: ((i * 41.73 + 19) % 991) / 991,
      r: 0.4 + ((i * 17) % 10) / 12,
      a: 0.08 + ((i * 23) % 30) / 100,
    }));

    function randomBetween(min, max) {
      return min + Math.random() * (max - min);
    }

    function angularDistance(a, b) {
      let diff = Math.abs(a - b) % (Math.PI * 2);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      return diff;
    }

    function formatScore(value) {
      return String(Math.max(0, value)).padStart(3, "0");
    }

    function comboMultiplier() {
      return 1 + Math.floor(combo / 5) * 0.5;
    }

    function updateGameHud() {
      scoreEl.textContent = formatScore(score);
      comboEl.textContent = `×${comboMultiplier().toFixed(1)}`;
      hullEl.textContent = `${"● ".repeat(hull)}${"○ ".repeat(3 - hull)}`.trim();
      hullEl.setAttribute("aria-label", `${hull} hull points remaining`);
      bestEl.textContent = formatScore(best);
    }

    function showOverlay(kicker, title, copy, buttonLabel) {
      overlayKicker.textContent = kicker;
      overlayTitle.textContent = title;
      overlayCopy.textContent = copy;
      startButton.innerHTML = `${buttonLabel} <span aria-hidden="true">↘</span>`;
      overlay.classList.remove("is-hidden");
    }

    function hideOverlay() {
      overlay.classList.add("is-hidden");
    }

    function resetGame() {
      running = false;
      gameOver = false;
      score = 0;
      combo = 1;
      hull = 3;
      elapsed = 0;
      spawnTimer = 0;
      catchPulse = 0;
      hurtPulse = 0;
      collectorAngle = -Math.PI / 2;
      updateGameHud();
      showOverlay(
        "ORBITAL ALIGNMENT / 01",
        "The star is exposed.",
        "Align the collector with each incoming shard as it crosses the ring. Build a combo, protect the core.",
        "Start run",
      );
      drawGame(performance.now());
    }

    function startGame() {
      running = true;
      gameOver = false;
      score = 0;
      combo = 1;
      hull = 3;
      elapsed = 0;
      spawnTimer = 0.45;
      catchPulse = 0;
      hurtPulse = 0;
      collectorAngle = -Math.PI / 2;
      gameCanvas.focus({ preventScroll: true });
      updateGameHud();
      hideOverlay();
      lastTs = 0;
      ensureGameLoop();
    }

    function endGame() {
      running = false;
      gameOver = true;
      if (score > best) {
        best = score;
        try { localStorage.setItem("dyson-arena-best", String(best)); } catch (_) { /* private mode */ }
      }
      updateGameHud();
      showOverlay(
        "RUN COMPLETE / CORE BREACHED",
        "The swarm held the line.",
        `Final score: ${score}. Best: ${best}. The next run starts faster.`,
        "Run it again",
      );
    }

    function spawnFragment() {
      const angle = Math.random() * Math.PI * 2;
      const speed = 148 + elapsed * 3.4 + randomBetween(-12, 22);
      fragments.push({
        angle,
        radius: spawnRadius,
        speed,
        size: randomBetween(5.5, 9.5),
        spin: randomBetween(-2, 2),
        checked: false,
        dead: false,
      });
    }

    const fragments = [];

    function missFragment(fragment) {
      fragment.dead = true;
      hull = Math.max(0, hull - 1);
      combo = 1;
      hurtPulse = 1;
      updateGameHud();
      if (hull <= 0) endGame();
    }

    function catchFragment(fragment) {
      fragment.dead = true;
      score += Math.round(10 * comboMultiplier());
      combo += 1;
      catchPulse = 1;
      updateGameHud();
    }

    function updateGame(dt, time) {
      if (!running) {
        if (!pointerActive) collectorAngle += dt * 0.16;
        catchPulse *= Math.pow(0.04, dt);
        hurtPulse *= Math.pow(0.02, dt);
        return;
      }

      elapsed += dt;
      const keyDir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      if (keyDir) collectorAngle += keyDir * 2.8 * dt;

      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnFragment();
        if (elapsed > 24 && Math.random() < 0.22) spawnFragment();
        spawnTimer = Math.max(0.46, 1.18 - elapsed * 0.018);
      }

      const tolerance = 0.205;
      for (const fragment of fragments) {
        fragment.radius -= fragment.speed * dt;
        fragment.angle += fragment.spin * dt * 0.012;
        if (!fragment.checked && fragment.radius <= orbitRadius) {
          fragment.checked = true;
          if (angularDistance(fragment.angle, collectorAngle) <= tolerance) catchFragment(fragment);
        }
        if (!fragment.dead && fragment.radius <= starRadius + fragment.size) missFragment(fragment);
      }

      for (let i = fragments.length - 1; i >= 0; i--) {
        if (fragments[i].dead || fragments[i].radius < -80) fragments.splice(i, 1);
      }

      catchPulse *= Math.pow(0.02, dt);
      hurtPulse *= Math.pow(0.015, dt);
    }

    function drawStar(time) {
      const pulse = 1 + Math.sin(time * 0.0022) * 0.025 + catchPulse * 0.13;
      const radius = starRadius * pulse;
      const halo = gctx.createRadialGradient(center.x, center.y, radius * 0.4, center.x, center.y, radius * 2.9);
      halo.addColorStop(0, "rgba(255,220,140,0.36)");
      halo.addColorStop(0.35, "rgba(242,198,109,0.14)");
      halo.addColorStop(1, "rgba(242,198,109,0)");
      gctx.fillStyle = halo;
      gctx.beginPath();
      gctx.arc(center.x, center.y, radius * 2.9, 0, Math.PI * 2);
      gctx.fill();

      const disk = gctx.createRadialGradient(center.x - radius * 0.24, center.y - radius * 0.27, radius * 0.08, center.x, center.y, radius);
      disk.addColorStop(0, "#fff8d7");
      disk.addColorStop(0.34, "#ffd987");
      disk.addColorStop(0.7, "#ef9d38");
      disk.addColorStop(1, "#a84b18");
      gctx.fillStyle = disk;
      gctx.beginPath();
      gctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      gctx.fill();

      gctx.save();
      gctx.globalCompositeOperation = "screen";
      gctx.strokeStyle = "rgba(255,216,126,0.18)";
      gctx.lineWidth = 1;
      for (let i = 0; i < 22; i++) {
        const angle = i * 2.399 + time * 0.00003;
        const inner = radius * 1.15;
        const outer = radius * (1.7 + ((i * 13) % 10) / 10);
        gctx.beginPath();
        gctx.moveTo(center.x + Math.cos(angle) * inner, center.y + Math.sin(angle) * inner);
        gctx.lineTo(center.x + Math.cos(angle) * outer, center.y + Math.sin(angle) * outer);
        gctx.stroke();
      }
      gctx.restore();
    }

    function drawRing(time) {
      gctx.save();
      gctx.setLineDash([2, 11]);
      gctx.lineDashOffset = -time * 0.012;
      gctx.strokeStyle = "rgba(124,230,212,0.26)";
      gctx.lineWidth = 1;
      gctx.beginPath();
      gctx.arc(center.x, center.y, orbitRadius, 0, Math.PI * 2);
      gctx.stroke();
      gctx.setLineDash([]);

      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const x = center.x + Math.cos(angle) * orbitRadius;
        const y = center.y + Math.sin(angle) * orbitRadius;
        const charged = i < Math.min(12, Math.floor(score / 35));
        gctx.fillStyle = charged ? "rgba(242,198,109,0.62)" : "rgba(124,230,212,0.16)";
        gctx.beginPath();
        gctx.arc(x, y, charged ? 2.3 : 1.5, 0, Math.PI * 2);
        gctx.fill();
      }
      gctx.restore();
    }

    function drawFragments() {
      for (const fragment of fragments) {
        const x = center.x + Math.cos(fragment.angle) * fragment.radius;
        const y = center.y + Math.sin(fragment.angle) * fragment.radius;
        const tx = center.x + Math.cos(fragment.angle) * (fragment.radius + 22);
        const ty = center.y + Math.sin(fragment.angle) * (fragment.radius + 22);
        gctx.save();
        gctx.strokeStyle = "rgba(255,130,107,0.25)";
        gctx.lineWidth = 1.4;
        gctx.beginPath();
        gctx.moveTo(tx, ty);
        gctx.lineTo(x, y);
        gctx.stroke();
        gctx.translate(x, y);
        gctx.rotate(fragment.angle);
        gctx.fillStyle = "#ff9a7b";
        gctx.shadowColor = "rgba(255,100,70,0.9)";
        gctx.shadowBlur = 13;
        gctx.beginPath();
        gctx.moveTo(fragment.size * 1.5, 0);
        gctx.lineTo(0, fragment.size * 0.55);
        gctx.lineTo(-fragment.size, 0);
        gctx.lineTo(0, -fragment.size * 0.55);
        gctx.closePath();
        gctx.fill();
        gctx.restore();
      }
    }

    function drawCollector(time) {
      const x = center.x + Math.cos(collectorAngle) * orbitRadius;
      const y = center.y + Math.sin(collectorAngle) * orbitRadius;
      const pulse = 1 + catchPulse * 0.35;
      const size = 12 * pulse;
      gctx.save();
      gctx.strokeStyle = "rgba(124,230,212,0.20)";
      gctx.lineWidth = 1;
      gctx.beginPath();
      gctx.moveTo(x, y);
      gctx.lineTo(center.x, center.y);
      gctx.stroke();

      gctx.translate(x, y);
      gctx.rotate(collectorAngle + Math.PI / 2);
      gctx.fillStyle = "rgba(124,230,212,0.16)";
      gctx.strokeStyle = "#7ce6d4";
      gctx.lineWidth = 1.5;
      gctx.shadowColor = "rgba(124,230,212,0.9)";
      gctx.shadowBlur = 16;
      gctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        const px = Math.cos(angle) * size;
        const py = Math.sin(angle) * size;
        if (i === 0) gctx.moveTo(px, py);
        else gctx.lineTo(px, py);
      }
      gctx.closePath();
      gctx.fill();
      gctx.stroke();
      gctx.shadowBlur = 0;
      gctx.fillStyle = "#effff9";
      gctx.beginPath();
      gctx.arc(0, 0, 2.3, 0, Math.PI * 2);
      gctx.fill();
      gctx.restore();

      if (catchPulse > 0.04) {
        gctx.save();
        gctx.strokeStyle = `rgba(242,198,109,${catchPulse * 0.7})`;
        gctx.lineWidth = 1.1;
        gctx.beginPath();
        gctx.arc(x, y, size + (1 - catchPulse) * 44, 0, Math.PI * 2);
        gctx.stroke();
        gctx.restore();
      }
    }

    function drawGame(time) {
      if (!gameWidth || !gameHeight) return;
      const bg = gctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, Math.max(gameWidth, gameHeight) * 0.68);
      bg.addColorStop(0, "rgba(13,24,33,0.96)");
      bg.addColorStop(0.6, "rgba(5,10,18,0.98)");
      bg.addColorStop(1, "#03060b");
      gctx.fillStyle = bg;
      gctx.fillRect(0, 0, gameWidth, gameHeight);

      for (const star of backgroundStars) {
        gctx.fillStyle = `rgba(242,236,221,${star.a})`;
        gctx.beginPath();
        gctx.arc(star.x * gameWidth, star.y * gameHeight, star.r, 0, Math.PI * 2);
        gctx.fill();
      }

      drawRing(time);
      drawStar(time);
      drawFragments();
      drawCollector(time);

      if (hurtPulse > 0.02) {
        gctx.save();
        gctx.fillStyle = `rgba(255,45,35,${hurtPulse * 0.16})`;
        gctx.fillRect(0, 0, gameWidth, gameHeight);
        gctx.restore();
      }
    }

    function gameFrame(time) {
      if (!lastTs) lastTs = time;
      const dt = Math.min(0.05, Math.max(0, (time - lastTs) / 1000));
      lastTs = time;
      updateGame(dt, time);
      drawGame(time);
      if (inView && !document.hidden) raf = requestAnimationFrame(gameFrame);
      else raf = 0;
    }

    function ensureGameLoop() {
      if (!inView || document.hidden || raf) return;
      lastTs = 0;
      raf = requestAnimationFrame(gameFrame);
    }

    function resizeGame() {
      const rect = gameCanvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      gameWidth = Math.max(1, rect.width);
      gameHeight = Math.max(1, rect.height);
      gameCanvas.width = Math.round(gameWidth * dpr);
      gameCanvas.height = Math.round(gameHeight * dpr);
      gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      center = { x: gameWidth / 2, y: gameHeight / 2 };
      const minSide = Math.min(gameWidth, gameHeight);
      starRadius = Math.max(30, minSide * 0.105);
      orbitRadius = Math.max(92, minSide * 0.325);
      spawnRadius = Math.hypot(gameWidth, gameHeight) * 0.53;
      drawGame(performance.now());
    }

    function pointerAngle(event) {
      const rect = gameCanvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      return Math.atan2(y - center.y, x - center.x);
    }

    gameCanvas.addEventListener("pointermove", (event) => {
      pointerActive = true;
      if (running) collectorAngle = pointerAngle(event);
    }, { passive: true });
    gameCanvas.addEventListener("pointerenter", () => { pointerActive = true; });
    gameCanvas.addEventListener("pointerleave", () => { pointerActive = false; });
    gameCanvas.addEventListener("pointerdown", (event) => {
      if (!running) return;
      pointerActive = true;
      collectorAngle = pointerAngle(event);
      gameCanvas.focus({ preventScroll: true });
    });

    gameCanvas.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
        keys.left = true;
        event.preventDefault();
      }
      if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") {
        keys.right = true;
        event.preventDefault();
      }
    });
    gameCanvas.addEventListener("keyup", (event) => {
      if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") keys.left = false;
      if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") keys.right = false;
    });
    gameCanvas.addEventListener("blur", () => {
      keys.left = false;
      keys.right = false;
    });

    startButton.addEventListener("click", startGame);
    resetButton.addEventListener("click", resetGame);
    overlay.setAttribute("aria-live", "polite");

    new ResizeObserver(resizeGame).observe(gameCanvas);
    new IntersectionObserver((entries) => {
      inView = entries.some((entry) => entry.isIntersecting);
      if (inView) ensureGameLoop();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    }, { threshold: 0.06 }).observe(gameCanvas);

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
      } else {
        ensureGameLoop();
      }
    });

    resizeGame();
    updateGameHud();
  }
})();
