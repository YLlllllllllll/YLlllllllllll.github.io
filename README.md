# Yucheng Lu

Personal site — AI deployment & model optimization.

## Preview

```bash
python3 -m http.server 8765
# http://127.0.0.1:8765
```

## Space backdrop

Hybrid canvas scene for GitHub Pages:

1. **Classic hyperspace** — hold click / Space for star-trail warp (original feel)
2. **DSP-style bodies** — planets / stars / BHs baked once into textures (`js/textures.js`), then `drawImage` each frame

### Why bake textures?

Per-frame procedural granulation is too heavy for a static GH Pages site. Baking sphere albedo+lighting into offscreen canvases at init (and on first use) cuts runtime cost to:

- warp star streaks
- `drawImage` for bodies
- a few atmosphere / corona gradients

Optional later: dump baked canvases to `assets/bodies/*.webp` and load as static files to skip CPU bake on visit.

### Controls

| Input | Action |
|-------|--------|
| Hold LMB / Space | Warp boost |
| Mouse move | Steer |
| RMB | Lock / unlock body |
| Ctrl | Brake |

## Links

- [LinkedIn](https://www.linkedin.com/in/yucheng-lu-431a04233/)
- [GitHub](https://github.com/YLlllllllllll)
