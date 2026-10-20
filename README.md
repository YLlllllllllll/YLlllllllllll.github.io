# Yucheng Lu

Personal site — AI deployment & model optimization.

**Live:** https://yllllllllllll.github.io/

## Preview

```bash
python3 -m http.server 8765
# http://127.0.0.1:8765
```

## Millennium research feed

The atlas fetches `data/millennium-feed.json` at page load and every six hours.
A scheduled GitHub Action refreshes that snapshot from:

- **OpenAI News** — official mathematics / scientific research posts only
- **Clay Institute News** — official prize updates
- **arXiv** — the two newest papers for each Millennium problem

Per-problem cards only attach an OpenAI or Clay item when the headline or summary
contains an exact problem phrase. Generic mathematics news stays in the global
OpenAI wire rather than being repeated across all seven problems.

Refresh locally:

```bash
python3 scripts/refresh_millennium_feed.py
# Offline arXiv fallback for local UI work:
FEED_SKIP_ARXIV=1 python3 scripts/refresh_millennium_feed.py
```

## Space backdrop

Hybrid canvas scene for GitHub Pages:

1. **Classic hyperspace** — hold click / Space for star-trail warp
2. **DSP-style bodies** — planets / stars / BHs baked once (`js/textures.js`), then `drawImage` + near-field overlays

### Why bake textures?

Per-frame procedural granulation is too heavy for a static GH Pages site. Baking sphere albedo+lighting into offscreen canvases at init cuts runtime cost to warp streaks + `drawImage` + a few overlays.

### Controls

| Input | Action |
|-------|--------|
| Hold LMB / Space | Warp boost (with lock: fly toward target) |
| RMB hold + drag | Look around (angle freezes on release) |
| RMB click | Lock / unlock body under cursor |
| Ctrl | Reverse thrust (speed goes negative; flee) |

## Links

- [GitHub](https://github.com/YLlllllllllll)
- [LinkedIn](https://www.linkedin.com/in/yucheng-lu-columbia/)
