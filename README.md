# Yucheng Lu

Personal site — AI deployment & model optimization.

**Live:** https://yllllllllllll.github.io/

## Preview

```bash
python3 -m http.server 8765
# http://127.0.0.1:8765
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
| Ctrl | Brake |

## Links

- [GitHub](https://github.com/YLlllllllllll)
- [LinkedIn](https://www.linkedin.com/in/yucheng-lu-columbia/)
