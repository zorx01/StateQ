# StateQ

Website for stateq.in: static, GitHub Pages, no build step.

- `index.html`, `style.css`, `main.js`: page, styles, motion (GSAP) and the 3D scenes (three.js).
- `assets/data/`: cave point cloud from a drone flight (gzip, delta-coded) and its flight path.
- `assets/models/`: drone (`drone.glb`) and the simulated cave (`cave_world.glb`), Draco-compressed.
- `assets/vendor/`: three.js, the Draco decoder and GSAP, served from this site (no third-party JS).
- `_tools/`: scripts that build the 3D assets (not published; see `_tools/README.md`).
- `404.html`, `favicon.ico`, `site.webmanifest`, `robots.txt`, `sitemap.xml`, `CNAME`.
- `netlify.toml`: stateq.in is served by Netlify from `main` (no build step).

Preview locally: `python3 -m http.server 8080`, then open http://localhost:8080.
After changing `style.css` or `main.js`, bump the `?v=` number on their links in `index.html` so browsers reload them.
