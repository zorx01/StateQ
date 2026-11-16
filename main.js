// main.js — page motion (GSAP) and the cave point-cloud scene (three.js).
// Scene data: assets/data/ (cave.points.gz + cave.json, flight path .bin), from flight super_20261007_185820.

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isSmall = innerWidth < 760;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (v) => v * v * (3 - 2 * v);
const lerp = (a, b, t) => a + (b - a) * t;

document.getElementById('year').textContent = new Date().getFullYear();

/* ------------------------------------------------------------------ page UI */

const nav = document.querySelector('.nav');
const progressBar = document.getElementById('scroll-progress');
const story = document.getElementById('how');
const droneSection = document.getElementById('drone');
const steps = [...document.querySelectorAll('.step')];
const navLinks = [...document.querySelectorAll('.nav-links a')];
const shadeEl = document.querySelector('.scene-shade');

// Scroll state shared with the scene. storyP: 0..1 through the pinned story;
// enter: 0..1 as the story scrolls into view; after: 0..1 as it scrolls away.
const scroll = { storyP: 0, enter: 0, after: 0 };

function readScroll() {
  // All layout reads first, then writes, so the browser lays out once per scroll.
  const y = scrollY;
  const docH = document.documentElement.scrollHeight - innerHeight;
  const r = story.getBoundingClientRect();
  progressBar.style.transform = `scaleX(${docH > 0 ? y / docH : 0})`;
  nav.classList.toggle('scrolled', y > 40);

  scroll.enter = clamp01(1 - r.top / innerHeight);
  scroll.storyP = clamp01(-r.top / (r.height - innerHeight));
  scroll.after = clamp01((innerHeight - r.bottom) / (innerHeight * 0.8));
  shadeEl.style.setProperty('--shade', (0.74 * scroll.after).toFixed(3));

  const active = Math.min(steps.length - 1, Math.floor(scroll.storyP * steps.length));
  steps.forEach((s, i) => s.classList.toggle('is-active', i === active));
}
addEventListener('scroll', readScroll, { passive: true });
addEventListener('resize', readScroll);
readScroll();

// Highlight the nav link of the section in view.
const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach((e) => {
    if (!e.isIntersecting) return;
    navLinks.forEach((a) => a.setAttribute('aria-current', String(a.getAttribute('href') === '#' + e.target.id)));
  });
}, { rootMargin: '-45% 0px -50% 0px' });
['top', 'how', 'applications', 'about', 'team', 'contact'].forEach((id) => sectionObserver.observe(document.getElementById(id)));

/* ------------------------------------------------------------------ theme */

// Effective theme: the visitor's pick (data-theme) or else the system setting.
const systemLight = matchMedia('(prefers-color-scheme: light)');
const isLight = () => (document.documentElement.dataset.theme || (systemLight.matches ? 'light' : 'dark')) === 'light';
const themeButton = document.querySelector('.theme-toggle');
const themeListeners = [];

function applyTheme() {
  const light = isLight();
  themeButton.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
  themeListeners.forEach((fn) => fn(light));
}
themeButton.addEventListener('click', () => {
  const next = isLight() ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch { /* storage blocked: theme lasts this visit */ }
  applyTheme();
});
systemLight.addEventListener('change', applyTheme);
applyTheme();

/* ------------------------------------------------------------------ GSAP */

const { gsap, ScrollTrigger } = window;
if (gsap && ScrollTrigger && !reduceMotion) {
  window.motionReady = true;
  gsap.registerPlugin(ScrollTrigger);

  // Hero title: words rise out of a mask.
  const title = document.querySelector('[data-split]');
  title.setAttribute('aria-label', title.textContent.trim());
  title.innerHTML = title.textContent.trim().split(/\s+/)
    .map((w) => `<span class="word" aria-hidden="true"><span>${w}</span></span>`).join(' ');
  gsap.from('.hero-title .word > span', { yPercent: 115, duration: 1.1, ease: 'power4.out', stagger: 0.07, delay: 0.15 });
  gsap.fromTo('[data-fade]', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 1, ease: 'power3.out', stagger: 0.12, delay: 0.55 });

  ScrollTrigger.batch('[data-reveal]', {
    start: 'top 86%',
    once: true,
    onEnter: (els) => gsap.fromTo(els, { opacity: 0, y: 28 }, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.09 }),
  });

} else {
  document.documentElement.classList.remove('js');
}

/* ------------------------------------------------------------------ scene */

const DATA = './assets/data/';
let THREE;

async function loadBin(name) {
  const res = await fetch(DATA + name);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return res.arrayBuffer();
}

// Gzipped binaries are decompressed here, so any static host works (no Content-Encoding needed).
async function loadGzip(name) {
  const res = await fetch(DATA + name);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  return new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

// Recorder frame is z-up (x, y, z) in cm; three.js is y-up, in metres.
function toWorld(src) {
  const out = new Float32Array(src.length);
  for (let j = 0; j < src.length; j += 3) {
    out[j] = src[j] / 100;
    out[j + 1] = src[j + 2] / 100;
    out[j + 2] = -src[j + 1] / 100;
  }
  return out;
}

const pointVert = /* glsl */`
  uniform float uSize, uPixel, uReveal, uGhost, uTime, uScan;
  uniform vec3 uDrone;
  attribute float aT;
  attribute float aRand;
  varying float vAlpha;
  varying float vGlow;
  varying float vHeight;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float seen = step(aT, uReveal);
    float fresh = seen * (1.0 - smoothstep(0.0, 0.012, uReveal - aT));
    // LiDAR pulse: a shell expanding from the drone every 1.6 s, out to 14 m.
    float d = distance(position, uDrone);
    float shell = fract(uTime / 1.6) * 14.0;
    float pulse = uScan * (1.0 - smoothstep(0.0, 0.9, abs(d - shell))) * (1.0 - shell / 14.0);
    vGlow = max(fresh, pulse);
    vAlpha = mix(uGhost, 1.0, seen);
    vHeight = position.y;
    gl_PointSize = uSize * uPixel * (0.55 + 0.9 * aRand) * (1.0 + vGlow * 1.4) / -mv.z;
  }`;

const pointFrag = /* glsl */`
  uniform vec3 uLow, uHigh, uAccent;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vGlow;
  varying float vHeight;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = dot(c, c);
    if (r > 0.25) discard;
    float h = smoothstep(-7.0, 6.0, vHeight);
    vec3 col = mix(uLow, uHigh, h);
    col = mix(col, uAccent * 1.6, vGlow);
    float a = (1.0 - r * 4.0) * vAlpha * uOpacity * (0.55 + vGlow);
    gl_FragColor = vec4(col, a);
  }`;

const markerVert = /* glsl */`
  uniform float uPixel, uSize;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixel / -mv.z;
  }`;

const markerFrag = /* glsl */`
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    float core = 1.0 - smoothstep(0.0, 0.22, r);
    float halo = (1.0 - smoothstep(0.2, 1.0, r)) * 0.35;
    float a = (core + halo) * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.7), a);
  }`;

const modeEls = {
  world: document.querySelector('[data-mode="world"]'),
  lidar: document.querySelector('[data-mode="lidar"]'),
};

// Load a Draco-compressed .glb. The decoder runs in one worker that is shut down once the model is in,
// so no threads stay alive after loading.
async function loadGLB(url) {
  const [{ GLTFLoader }, { DRACOLoader }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/loaders/DRACOLoader.js'),
  ]);
  const draco = new DRACOLoader().setDecoderPath('./assets/vendor/three/examples/jsm/libs/draco/gltf/').setWorkerLimit(1);
  try {
    return await new GLTFLoader().setDRACOLoader(draco).loadAsync(url);
  } finally {
    draco.dispose();
  }
}

async function loadWorld(THREE, world) {
  const gltf = await loadGLB('./assets/models/cave_world.glb?v=2');
  // Untextured cave tiles get a triplanar rock texture so they read as rock, not flat polygons.
  const rock = await new THREE.TextureLoader().loadAsync('./assets/models/rock.jpg');
  rock.wrapS = rock.wrapT = THREE.RepeatWrapping;
  rock.colorSpace = THREE.SRGBColorSpace;
  world.uniforms.uRock = { value: rock };
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    const triplanar = !m.map;
    m.side = THREE.FrontSide; // back faces culled: the camera sees into the cave through its roof
    m.transparent = false;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, world.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldNormal;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWorldNormal = normalize(mat3(modelMatrix) * objectNormal);');
      if (triplanar) {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vWorldNormal;\nuniform sampler2D uRock;')
          .replace('#include <map_fragment>', `
            vec3 bw = pow(abs(normalize(vWorldNormal)), vec3(4.0)); bw /= dot(bw, vec3(1.0));
            vec3 rk = texture2D(uRock, vWorldPos.yz * 0.22).rgb * bw.x + texture2D(uRock, vWorldPos.xz * 0.22).rgb * bw.y
                    + texture2D(uRock, vWorldPos.xy * 0.22).rgb * bw.z;
            diffuseColor.rgb = rk * mix(vec3(0.62, 0.55, 0.47), diffuseColor.rgb * 2.2, 0.35);`);
      }
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWorldPos;
          uniform float uDissolve;
          uniform vec3 uDrone, uEdge;
          uniform float uClipY;
          float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
          float vnoise(vec3 x) {
            vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
                       mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
          }`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          // Cutaway: drop everything above the flight height so we look into the cave, not at its roof.
          if (vWorldPos.y > uClipY) discard;
          // Dissolve outward from the drone, with a lit edge where the surface turns into points.
          float n = vnoise(vWorldPos * 0.9) * 0.6 + distance(vWorldPos, uDrone) / 45.0;
          float cut = uDissolve * 1.7 - 0.1;
          if (n < cut) discard;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uEdge * 2.0, 1.0 - smoothstep(0.0, 0.06, n - cut));`);
    };
  });
  return gltf.scene;
}

async function initScene() {
  // Loaded lazily so the page UI never waits on (or breaks with) the 3D library.
  THREE = await import('three');
  const ACCENT = new THREE.Color('#5fb4e0');
  const canvas = document.getElementById('scene');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  } catch {
    return; // No WebGL: the page still works on its plain background.
  }
  const dpr = Math.min(devicePixelRatio, 1.75);
  renderer.setPixelRatio(dpr);

  const [meta, deltas, pathBuf, pathTBuf] = await Promise.all([
    loadBin('cave.json').then((b) => JSON.parse(new TextDecoder().decode(b))),
    loadGzip('cave.points.gz'),
    loadBin('cave_path.bin'), loadBin('cave_path_t.bin'),
  ]);

  // Points arrive as int16 xyz deltas (voxel units, z-up), grouped into buckets by the time the drone
  // first saw them. Rebuild positions and give each point its discovery time (every 2nd on small screens).
  const d = new Int16Array(deltas);
  const bucketTotal = meta.buckets.reduce((a, b) => a + b, 0);
  if (d.length !== meta.points * 3 || bucketTotal !== meta.points) {
    throw new Error(`cave data size mismatch: ${d.length / 3} points in file, ${meta.points} in cave.json`);
  }
  const stride = isSmall ? 2 : 1;
  const n = Math.floor(meta.points / stride);
  const pos = new Float32Array(n * 3);
  const aT = new Float32Array(n);
  const aRand = new Float32Array(n);
  const vox = meta.voxel_m;
  const B = meta.buckets.length;
  let x = 0, y = 0, z = 0, i = 0, k = 0, bucketStart = 0;
  for (let j = 0; j < meta.points; j++) {
    x += d[j * 3]; y += d[j * 3 + 1]; z += d[j * 3 + 2];
    while (j >= bucketStart + meta.buckets[k]) bucketStart += meta.buckets[k++];
    if (j % stride || i >= n) continue;
    pos[i * 3] = x * vox; pos[i * 3 + 1] = z * vox; pos[i * 3 + 2] = -y * vox;
    aT[i] = (k + (j - bucketStart) / meta.buckets[k]) / B;
    aRand[i] = Math.random();
    i++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aT', new THREE.BufferAttribute(aT, 1));
  geo.setAttribute('aRand', new THREE.BufferAttribute(aRand, 1));

  const uniforms = {
    uSize: { value: isSmall ? 9 : 7 },
    uPixel: { value: dpr },
    uReveal: { value: 1 },
    uGhost: { value: 1 },
    uTime: { value: 0 },
    uScan: { value: 0 },
    uOpacity: { value: 0.9 },
    uDrone: { value: new THREE.Vector3() },
    uLow: { value: new THREE.Color('#2b3f5c') },
    uHigh: { value: new THREE.Color('#9fb6cf') },
    uAccent: { value: ACCENT },
  };
  const cloud = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms, vertexShader: pointVert, fragmentShader: pointFrag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));

  // Flight path, with cumulative arc length for even motion along it.
  const path = toWorld(new Int16Array(pathBuf));
  const pathT = Array.from(new Uint16Array(pathTBuf), (v) => v / 65535);
  const pn = path.length / 3;
  const pv = (i) => new THREE.Vector3(path[i * 3], path[i * 3 + 1], path[i * 3 + 2]);
  const arc = [0];
  for (let i = 1; i < pn; i++) arc.push(arc[i - 1] + pv(i).distanceTo(pv(i - 1)));
  const totalArc = arc[pn - 1];
  const start = pv(0);

  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(path, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const line = new THREE.Line(lineGeo, lineMat);

  const markerUniforms = { uPixel: { value: dpr }, uSize: { value: 420 }, uColor: { value: ACCENT }, uOpacity: { value: 0 } };
  const markerGeo = new THREE.BufferGeometry();
  markerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const marker = new THREE.Points(markerGeo, new THREE.ShaderMaterial({
    uniforms: markerUniforms, vertexShader: markerVert, fragmentShader: markerFrag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));

  // A drone icon riding the path, so it is clear what is flying. Built 2.7 units across the props, then scaled
  // to the real drone: 14 in (0.356 m) prop tip to prop tip.
  const flyerMat = new THREE.MeshBasicMaterial({ color: 0xff7a2f, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const discMat = flyerMat.clone();
  const flyer = new THREE.Group();
  const rotors = [];
  flyer.add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.8), flyerMat)); // body, nose along +z
  for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 1.2), flyerMat);
    arm.position.set(x * 0.42, 0, z * 0.42);
    arm.rotation.y = Math.atan2(x, z);
    const rotor = new THREE.Group();
    rotor.position.set(x * 0.85, 0.08, z * 0.85);
    rotor.add(new THREE.Mesh(new THREE.CircleGeometry(0.5, 32).rotateX(-Math.PI / 2), discMat));
    rotor.add(new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.02, 0.08), flyerMat)); // blade
    rotors.push(rotor);
    flyer.add(arm, rotor);
  }
  flyer.scale.setScalar(0.356 / 2.7);
  flyer.visible = false;
  const droneLabel = document.querySelector('.drone-label');
  const labelP = new THREE.Vector3();

  // Dark: light points glowing additively. Light: dark ink points, normal blending.
  const palettes = {
    dark: { clear: '#080a0e', low: '#2b3f5c', high: '#9fb6cf', accent: '#5fb4e0', drone: '#ff7a2f', blending: THREE.AdditiveBlending },
    light: { clear: '#f3f5f8', low: '#7d93ad', high: '#1d2c3f', accent: '#1a6a96', drone: '#e0520f', blending: THREE.NormalBlending },
  };
  const materials = [cloud.material, lineMat, marker.material, flyerMat, discMat];
  function setPalette(light) {
    const p = palettes[light ? 'light' : 'dark'];
    renderer.setClearColor(p.clear, 1);
    uniforms.uLow.value.set(p.low);
    uniforms.uHigh.value.set(p.high);
    ACCENT.set(p.accent);
    lineMat.color.set(p.accent);
    flyerMat.color.set(p.drone); discMat.color.set(p.drone);
    materials.forEach((m) => { m.blending = p.blending; m.needsUpdate = true; });
  }
  themeListeners.push(setPalette);
  setPalette(isLight());

  const scene = new THREE.Scene();
  scene.add(cloud, line, marker, flyer);

  // Simulated world (Gazebo cave, aligned to the cloud). Shown at the start of the story, then it
  // dissolves into the LiDAR points as the drone flies in. Loaded in the background; optional.
  const world = { group: null, uniforms: { uDissolve: { value: 1 }, uDrone: uniforms.uDrone, uEdge: { value: ACCENT }, uClipY: { value: 1e3 } } };
  scene.add(new THREE.HemisphereLight(0xe6edf5, 0x5a5048, 2.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(20, 40, 10);
  scene.add(sun);
  loadWorld(THREE, world).then((g) => { world.group = g; scene.add(g); })
    .catch((err) => console.warn('[StateQ] simulated world unavailable:', err));
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);

  // Position at arc fraction s, written into `out` (no allocation per frame); returns the
  // interpolated discovery time and the path index.
  const hit = { t: 0, index: 1 };
  function sampleAt(s, out) {
    const target = s * totalArc;
    let i = 1;
    while (i < pn - 1 && arc[i] < target) i++;
    const f = clamp01((target - arc[i - 1]) / (arc[i] - arc[i - 1] || 1));
    const a = (i - 1) * 3, b = i * 3;
    out.set(lerp(path[a], path[b], f), lerp(path[a + 1], path[b + 1], f), lerp(path[a + 2], path[b + 2], f));
    hit.t = lerp(pathT[i - 1], pathT[i], f); hit.index = i;
    return hit;
  }
  const startDir = (() => { const d = new THREE.Vector3(); sampleAt(Math.min(1, 8 / totalArc), d); d.sub(start).setY(0); return d.lengthSq() ? d.normalize() : new THREE.Vector3(1, 0, 0); })();

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < h ? 68 : 50;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  addEventListener('pointermove', (e) => {
    pointer.x = e.clientX / innerWidth - 0.5;
    pointer.y = e.clientY / innerHeight - 0.5;
  }, { passive: true });

  const camPos = new THREE.Vector3(60, 34, 40);
  const hereP = new THREE.Vector3(), dir = new THREE.Vector3(), behindP = new THREE.Vector3();
  const chasePos = new THREE.Vector3(), chaseLook = new THREE.Vector3(), worldPos = new THREE.Vector3(), worldLook = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const tmpPos = new THREE.Vector3();
  const tmpLook = new THREE.Vector3();
  let visible = true;
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; });

  const clock = new THREE.Clock();
  let elapsed = 0;
  const perf = { t: 0, n: 0, dpr };
  let viewShift = 0;

  function frame() {
    requestAnimationFrame(frame);
    if (!visible) return;
    const dt = Math.min(clock.getDelta(), 0.05);
    // Adaptive quality: if frames run slow, drop the pixel ratio (once per step, never back up).
    perf.t += dt; perf.n++;
    if (perf.n === 90) {
      if (perf.t / perf.n > 1 / 45 && perf.dpr > 1) {
        perf.dpr = Math.max(1, perf.dpr - 0.5);
        renderer.setPixelRatio(perf.dpr);
        uniforms.uPixel.value = markerUniforms.uPixel.value = perf.dpr;
        resize();
      }
      perf.t = 0; perf.n = 0;
    }
    elapsed += reduceMotion ? 0 : dt;
    uniforms.uTime.value = elapsed;

    pointer.sx = lerp(pointer.sx, pointer.x, 0.04);
    pointer.sy = lerp(pointer.sy, pointer.y, 0.04);

    const enter = smooth(scroll.enter);
    const after = smooth(scroll.after);
    const sp = scroll.storyP;
    // Fly over the first 80 % of the story, then pull out over the last 20 %.
    const fly = smooth(clamp01(sp / 0.8));
    const pullOut = smooth(clamp01((sp - 0.8) / 0.2));
    const chase = enter * (1 - pullOut) * (1 - after);

    sampleAt(Math.min(1, fly + 0.04), dir);
    sampleAt(Math.max(0, fly - 0.04), behindP);
    dir.sub(behindP).setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0);
    dir.normalize();
    const here = sampleAt(fly, hereP);

    // Overview: slow orbit around the whole cave, nudged by the pointer.
    const orbitA = elapsed * 0.03 + 0.8 + pointer.sx * 0.5;
    const overview = tmpPos.set(Math.cos(orbitA) * 46, 26 - pointer.sy * 8, Math.sin(orbitA) * 46);
    const overviewLook = tmpLook.set(-4, -2, 0);

    // Chase: high behind the drone, so the walls it is scanning stay in frame.
    chasePos.copy(hereP).addScaledVector(dir, -16);
    chasePos.x += pointer.sx * 4; chasePos.y += 15 - pointer.sy * 3;
    chaseLook.copy(hereP).addScaledVector(dir, 2);

    let targetPos = overview.lerp(chasePos, chase);
    let targetLook = overviewLook.lerp(chaseLook, chase);
    const wv = smooth(clamp01(enter * (1 - clamp01((sp - 0.04) / 0.22)) * (1 - after)));
    if (wv > 0) {
      worldLook.copy(start).addScaledVector(startDir, 9);
      worldPos.copy(worldLook).addScaledVector(startDir, -24);
      worldPos.x += pointer.sx * 4; worldPos.y += 26 - pointer.sy * 3;
      targetPos = targetPos.lerp(worldPos, wv);
      targetLook = targetLook.lerp(worldLook, wv);
    }
    const k = reduceMotion ? 1 : 0.08;
    camPos.lerp(targetPos, k);
    camLook.lerp(targetLook, k);
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    viewShift = lerp(viewShift, innerWidth > 900 ? -0.2 * (1 - chase) * (1 - after) : 0, k);
    camera.setViewOffset(innerWidth, innerHeight, viewShift * innerWidth, 0, innerWidth, innerHeight);

    // In the story the map lights up as the drone discovers it; elsewhere it is complete.
    const inStory = enter * (1 - after);
    // World -> points: solid while the story opens, dissolving as the drone leaves the yard.
    const worldAmt = enter * (1 - smooth(clamp01((sp - 0.03) / 0.27))) * (1 - after);
    world.uniforms.uDissolve.value = 1 - worldAmt;
    world.uniforms.uClipY.value = start.y + 2.2;
    if (world.group) world.group.visible = worldAmt > 0.002;
    modeEls.world && (modeEls.world.style.opacity = worldAmt > 0.5 ? 1 : 0);
    modeEls.lidar && (modeEls.lidar.style.opacity = inStory > 0.5 && worldAmt <= 0.5 ? 1 : 0);
    uniforms.uReveal.value = lerp(1, here.t, inStory * (1 - pullOut));
    uniforms.uGhost.value = lerp(1, 0.16, inStory * (1 - pullOut));
    uniforms.uScan.value = reduceMotion ? 0 : chase;
    uniforms.uDrone.value.copy(hereP);
    uniforms.uOpacity.value = lerp(isSmall ? 0.6 : 0.9, 0.55, after) * (1 - 0.92 * worldAmt);

    lineGeo.setDrawRange(0, Math.max(2, here.index + 1));
    lineMat.opacity = 0.9 * inStory;
    markerGeo.attributes.position.array.set([hereP.x, hereP.y, hereP.z]);
    markerGeo.attributes.position.needsUpdate = true;
    markerUniforms.uOpacity.value = inStory;
    flyer.visible = inStory > 0.01;
    flyer.position.copy(hereP);
    flyer.lookAt(tmpLook.copy(hereP).add(dir));
    flyerMat.opacity = inStory;
    discMat.opacity = 0.22 * inStory;
    // Label pinned just above the drone on screen (setViewOffset is part of the projection, so this matches).
    camera.updateMatrixWorld(); // project() reads the matrix render() would otherwise update a frame late
    labelP.copy(hereP).project(camera);
    const showLabel = flyer.visible && labelP.z < 1;
    droneLabel.style.opacity = showLabel ? inStory : 0;
    if (showLabel) droneLabel.style.transform = `translate(${((labelP.x + 1) / 2) * innerWidth}px, ${((1 - labelP.y) / 2) * innerHeight}px) translate(-50%, calc(-100% - 6px))`;
    if (!reduceMotion) rotors.forEach((r, j) => { r.rotation.y += dt * (j % 2 ? -40 : 40); });

    const dr = droneSection.getBoundingClientRect();
    if (!(dr.top <= 0 && dr.bottom >= innerHeight)) renderer.render(scene, camera);
  }
  frame();
  canvas.classList.add('ready');
}

initScene().catch((err) => console.warn('[StateQ] scene unavailable:', err));

/* ------------------------------------------------------------------ drone model */

// Loaded only when the section approaches the viewport (the model is ~1 MB).
async function initDrone(canvas) {
  const T = await import('three');
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = T.NeutralToneMapping; // keeps material colours true; ACES shifts and washes them
  renderer.toneMappingExposure = 1.0;
  const scene = new T.Scene();
  // Soft studio light from the environment, plus a key and a rim light for shape.
  scene.environment = new T.PMREMGenerator(renderer).fromScene(studio(T), 0.02).texture;
  scene.environmentIntensity = 0.9;
  const key = new T.DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 4, 3);
  const rim = new T.DirectionalLight(0x9fd0ff, 1.4);
  rim.position.set(-3, 2, -4);
  scene.add(key, rim, new T.HemisphereLight(0xdfe8f2, 0x20242a, 0.6));
  const camera = new T.PerspectiveCamera(28, 1, 0.01, 50);

  const gltf = await loadGLB('./assets/models/drone.glb?v=8'); // Draco-compressed, ~1 MB
  const model = gltf.scene; // metres
  model.rotation.x = Math.PI; // CAD up is +z: turn the y-up export right side up
  // Normals are baked into the file (creased at 30 deg), so nothing heavy runs here.
  model.traverse((o) => { if (o.isMesh) o.material.side = T.DoubleSide; });
  carbonFibre(T, model, renderer.capabilities.getMaxAnisotropy());
  const box = new T.Box3().setFromObject(model);
  const size = box.getSize(new T.Vector3()).length();
  model.position.sub(box.getCenter(new T.Vector3()));
  const pivot = new T.Group();
  pivot.add(model);
  scene.add(pivot);

  // Soft contact shadow under the drone.
  const shadowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'), grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.35)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    return new T.CanvasTexture(c);
  })();
  const shadow = new T.Mesh(new T.PlaneGeometry(size * 0.8, size * 0.8), new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -box.getSize(new T.Vector3()).y / 2 - size * 0.06;
  scene.add(shadow);

  function resize() {
    const r = canvas.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.position.set(0, size * 0.4, size * 1.42);
    camera.lookAt(0, -size * 0.04, 0);
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  // Free rotation: drag horizontally to yaw, vertically to pitch; the drone rolls as it turns, like a
  // trackball. Shift+drag horizontally rolls directly. Double-click returns it to level.
  const home = new T.Quaternion().setFromEuler(new T.Euler(0, 0.6, 0, 'YXZ'));
  pivot.quaternion.copy(home);
  const spin = new T.Vector3();            // angular velocity (rad/frame), world axes
  const tmpQ = new T.Quaternion();
  const up = new T.Vector3(0, 1, 0), right = new T.Vector3(1, 0, 0), fwd = new T.Vector3(0, 0, 1);
  let dragging = false, lastX = 0, lastY = 0, downX = 0, downY = 0, onScreen = true, homing = false, idle = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true; homing = false; lastX = downX = e.clientX; lastY = downY = e.clientY; canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = (e.clientX - lastX) * 0.006, dy = (e.clientY - lastY) * 0.006;
    lastX = e.clientX; lastY = e.clientY;
    spin.set(dy, e.shiftKey ? 0 : dx, e.shiftKey ? -dx : 0); // pitch about screen-x, yaw about up, roll about view axis
    applySpin();
  });
  let lastTap = 0;
  const endDrag = (e) => {
    dragging = false; idle = 0;
    // Double-tap to level on touch screens (dblclick isn't reliable there).
    // Only a real tap counts: drags, flicks and page scrolls (pointercancel) don't.
    if (e.type === 'pointerup' && e.pointerType === 'touch' && Math.hypot(e.clientX - downX, e.clientY - downY) < 10) {
      const now = performance.now();
      if (now - lastTap < 320) { homing = true; spin.set(0, 0, 0); }
      lastTap = now;
    }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('dblclick', () => { homing = true; spin.set(0, 0, 0); });
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; }).observe(canvas);

  function applySpin() {
    if (spin.y) pivot.quaternion.premultiply(tmpQ.setFromAxisAngle(up, spin.y));
    if (spin.x) pivot.quaternion.premultiply(tmpQ.setFromAxisAngle(right, spin.x));
    if (spin.z) pivot.quaternion.premultiply(tmpQ.setFromAxisAngle(fwd, spin.z));
    pivot.quaternion.normalize();
  }

  // Live attitude readout (body angles: roll about the nose, pitch about the wing line, yaw about up).
  const att = { roll: document.querySelector('[data-att="roll"]'), pitch: document.querySelector('[data-att="pitch"]'), yaw: document.querySelector('[data-att="yaw"]') };
  const eul = new T.Euler();
  const lastAtt = {};
  const deg = (r) => { const d = Math.round(T.MathUtils.radToDeg(r)); return (d > 0 ? '+' : d < 0 ? '−' : '') + Math.abs(d) + '°'; };

  canvas.classList.add('ready');
  (function frame() {
    requestAnimationFrame(frame);
    if (!onScreen || document.hidden) return;
    if (homing) {
      pivot.quaternion.slerp(home, 0.12);
      if (pivot.quaternion.angleTo(home) < 0.002) { pivot.quaternion.copy(home); homing = false; }
    } else if (!dragging) {
      spin.multiplyScalar(0.9); // inertia after release
      if (!reduceMotion && ++idle > 90) spin.y += (0.0035 - spin.y) * 0.05; // ease back into a slow spin
      applySpin();
    }
    eul.setFromQuaternion(pivot.quaternion, 'YXZ');
    const vals = { roll: deg(eul.z), pitch: deg(eul.x), yaw: deg(((eul.y % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) };
    for (const k in vals) if (att[k] && vals[k] !== lastAtt[k]) { att[k].textContent = vals[k]; lastAtt[k] = vals[k]; }
    renderer.render(scene, camera);
  })();
}

// 2x2 twill carbon weave, drawn on a canvas (no image to download). Each tow gets a light band
// across its middle, so the weave catches the light like the real resin-coated cloth.
function weaveTexture(T) {
  const N = 8, S = 32, c = document.createElement('canvas');
  c.width = c.height = N * S;
  const g = c.getContext('2d');
  g.fillStyle = '#0b0c0e';
  g.fillRect(0, 0, N * S, N * S);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const across = (i + j) % 4 < 2; // twill: the over/under pattern steps one tow per row
    const x = i * S, y = j * S;
    const grad = across ? g.createLinearGradient(x, y, x, y + S) : g.createLinearGradient(x, y, x + S, y);
    grad.addColorStop(0, '#0f1012'); grad.addColorStop(0.5, '#2e3136'); grad.addColorStop(1, '#0f1012');
    g.fillStyle = grad;
    g.fillRect(x + 1, y + 1, S - 2, S - 2);
  }
  const tex = new T.CanvasTexture(c);
  tex.wrapS = tex.wrapT = T.RepeatWrapping;
  tex.colorSpace = T.SRGBColorSpace;
  return tex;
}

// The CAD meshes have no UVs: project the weave along each vertex's main normal axis (box mapping).
// Fine for flat plates and arms, which is where the carbon is.
function carbonFibre(T, model, anisotropy) {
  const CARBON = new Set(['Carbon_Fiber_-_Plain', 'Opaque(63,63,63)']);
  const TILE = 0.02; // metres per weave repeat (8 tows), a little coarser than real so it reads on screen
  const map = weaveTexture(T);
  map.anisotropy = anisotropy;
  model.traverse((o) => {
    if (!o.isMesh || !CARBON.has(o.material.name)) return;
    const pos = o.geometry.attributes.position, nrm = o.geometry.attributes.normal;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i)), az = Math.abs(nrm.getZ(i));
      const [u, v] = ay >= ax && ay >= az ? [pos.getX(i), pos.getZ(i)] : ax >= az ? [pos.getZ(i), pos.getY(i)] : [pos.getX(i), pos.getY(i)];
      uv[i * 2] = u / TILE; uv[i * 2 + 1] = v / TILE;
    }
    o.geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
    o.material = o.material.clone();
    Object.assign(o.material, { map, bumpMap: map, bumpScale: 1.2, roughness: 0.38 });
    o.material.color.set(0xffffff);
    o.material.needsUpdate = true;
  });
}

// Photo-studio lighting for reflections: a dark room with a big overhead softbox and two strip lights.
// Emissive values above 1 are kept by PMREM, so metal and clear-coat pick up crisp, bright highlights.
function studio(T) {
  const room = new T.Scene();
  room.add(new T.Mesh(new T.BoxGeometry(12, 8, 12), new T.MeshBasicMaterial({ color: 0x141619, side: T.BackSide })));
  const panel = (w, h, power, x, y, z) => {
    const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color().setScalar(power), side: T.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    room.add(m);
  };
  panel(5, 5, 6, 0, 3.9, 0);     // overhead softbox
  panel(1, 5, 9, -5.9, 1, 2);    // left strip
  panel(1, 5, 5, 5.9, 1, -3);    // right strip
  panel(6, 1.2, 1.5, 0, 0.5, 5.9); // soft front fill
  return room;
}

const droneCanvas = document.getElementById('drone-canvas');
const droneObserver = new IntersectionObserver(([e]) => {
  if (!e.isIntersecting) return;
  droneObserver.disconnect();
  initDrone(droneCanvas).catch((err) => console.warn('[StateQ] drone model unavailable:', err));
}, { rootMargin: '600px 0px' });
droneObserver.observe(droneCanvas);
