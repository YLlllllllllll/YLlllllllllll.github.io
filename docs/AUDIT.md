# Code audit — merge prep (2026-07-13)

## Inventory

| Repo | Files | Notes |
|------|-------|-------|
| `YLlllllllllll.github.io` | `index.html` (~12KB), `mario_favicon.webp`, `.gitmodules` → `PlayMario/HTML5_Client` | Real landing attempt |
| `cornhub.github.io` | `index.html` (~3KB) | Stub only: “欢迎来到我的个人网站” |

No CSS/JS modules, no build step, no tests, no README in either source.

---

## Critical issues (visitor-facing)

1. **Broken service links on GitHub Pages**
   - Cards point to `http://localhost:3000/`, `http://127.0.0.1:7860/`, `/finance`, `/ticket-script`
   - None of these exist for remote visitors; `/finance` and `/ticket-script` are not in the repo

2. **Empty git submodule**
   - `HTML5_Client` → `PlayMario/HTML5_Client` (Super Mario HTML5 remake)
   - Zip/clone without `--recurse-submodules` leaves an empty dir; hero CTA `Let's-a go!` → broken game link unless submodule is initialized or replaced with the upstream Pages URL (`http://playmario.github.io/HTML5_Client/`)

3. **Scroll UX contradiction**
   - `overflow: hidden` on `body`/`html` while a bounce “scroll” chevron is shown — page cannot scroll

4. **No personal brand**
   - Titles: “个人技术实验室” / “个人网站”; hero is Mario copy, not “Yucheng Lu”
   - GitHub profile: `blog: YuchengLu7`, `name`/`bio` empty — site should carry identity

---

## Medium issues

5. **Dead code / leftovers** — comments like “Removed nav”, “existing code”; unused prefetch for Cloudflare tunnels
6. **CDN deps without fallback** — particles.js (jsDelivr) + Font Awesome (cdnjs); offline/CDN block = blank/broken icons
7. **particles.js misuse** — config keys (`life`, `max`, custom cleanup `setInterval`) are mostly ignored by stock particles.js 2.0; click-spawn “cleanup” is a hack
8. **Accessibility** — `user-select: none` globally; cards use `onclick` on `<div>` (not keyboard-accessible); no skip link / focus styles
9. **SEO / social** — no `<meta name="description">`, no Open Graph, no `canonical`
10. **cornhub repo** — no unique content worth merging into the live page; keep only as archive

---

## Design debt (for rewrite)

Current UI is dark + particle canvas + glass cards + glow — fine as a 2024 lab splash, weak as a durable personal profile:

- Hero does not lead with the name **Yucheng Lu**
- First viewport is crowded (title + 4 cards + scroll cue)
- Cards used as navigation chrome (not interactive forms)
- Localhost “services” read as product dashboard, not a portfolio

Recommended direction for v2: single-composition hero (name + one line + CTAs), projects/links below the fold, no fake localhost tiles unless they have public URLs.

---

## Optimization backlog (suggested order)

| Priority | Item |
|----------|------|
| P0 | Ship one public-facing `index.html` under `YuchengLu-profile` with name, short bio, GitHub/contact links |
| P0 | Remove or relabel localhost cards; link Mario via upstream Pages or drop submodule |
| P1 | Split CSS/JS; drop particles or replace with lightweight CSS motion |
| P1 | Add meta/OG, favicon, responsive type scale |
| P2 | Optional: list public repos (ClimSim, VeOmni, …) as project links |
| P2 | Custom domain or decide: project Pages vs overwrite `username.github.io` |
| P3 | Archive/deprecate the two old repos after Pages cutover |

---

## Merge decision recorded here

- New repo name: **`YuchengLu-profile`**
- Old sources preserved under `archive/` (do not edit as source of truth)
- Live entrypoint: repo-root `index.html`
