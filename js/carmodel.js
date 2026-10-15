// Procedural vehicle models. Every body is generated from code (no third-party meshes), so the designs are
// original, fictional interpretations of each vehicle category — see docs/ASSETS_AND_LICENCES.md.
// Body: a lofted shell of rounded (superellipse) cross-sections at stations packed densely towards the nose and tail,
// with real dimensions from cars.json (length, width, height, wheelbase), wheel-arch openings sized to the tyres,
// sill/shoulder creases, and a greenhouse whose faces are split into roof, pillars, seals and tinted glass.
// Static parts are merged per material to keep draw calls and triangle counts phone-friendly.
import * as THREE from 'three';
import { buildHero, initHero } from './hero.js';
import { buildPro } from './carpro.js';
import { fireFX } from './bttf_fx.js';
import { mergeGeometries } from './lib/addons/utils/BufferGeometryUtils.js';
import { buildRealCar, carPaint, carGlass, carRubber, contactShadow, attachCarFx, carWeather, wantTransmission } from './realcars.js';

// normalised side-profile archetypes. s = 0 front → 1 rear. heights are fractions of overall height.
// deck: [[s, h]...] top of lower body; cabin: A (screen base), A2 (screen top), C2 (roof end), C (rear glass base)
const ARCH = {
  hatch3: { deck: [[0, .47], [.06, .57], [.3, .65], [.97, .67], [1, .61]], A: .3, A2: .48, C2: .83, C: .97, roof: 1, round: .55, belt: .62, tumble: .76 },
  // Mk2-inspired visual conversion; retain the existing car ID, handling and wheelbase.
  gti8: { deck: [[0, .56], [.035, .59], [.30, .61], [.94, .63], [1, .61]], A: .30, A2: .44, C2: .84, C: .965, roof: .97, drop: .015, round: .18, belt: .6, tumble: .84 },
  hatch5: { deck: [[0, .47], [.06, .57], [.3, .65], [.97, .67], [1, .61]], A: .3, A2: .48, C2: .83, C: .97, roof: 1, round: .55, belt: .62, tumble: .76 },
  saloon: { deck: [[0, .46], [.06, .56], [.33, .62], [.84, .64], [.99, .62], [1, .56]], A: .33, A2: .52, C2: .73, C: .86, roof: 1, round: .5, belt: .61, tumble: .78 },
  estate: { deck: [[0, .46], [.06, .56], [.33, .62], [.98, .65], [1, .6]], A: .33, A2: .52, C2: .95, C: .99, roof: 1, round: .5, belt: .61, tumble: .8 },
  fastback: { deck: [[0, .42], [.06, .52], [.32, .6], [.9, .62], [.99, .6], [1, .54]], A: .31, A2: .5, C2: .64, C: .93, roof: 1, round: .6, belt: .59, tumble: .72 },
  suv: { deck: [[0, .54], [.05, .62], [.27, .67], [.97, .67], [1, .62]], A: .27, A2: .43, C2: .92, C: .985, roof: 1, round: .45, belt: .65, tumble: .84 },
  crossover: { deck: [[0, .52], [.05, .6], [.28, .65], [.97, .66], [1, .6]], A: .28, A2: .45, C2: .8, C: .96, roof: 1, round: .5, belt: .64, tumble: .78 },
  offroad: { deck: [[0, .6], [.03, .63], [.28, .65], [.99, .66], [1, .64]], A: .29, A2: .36, C2: .985, C: 1, roof: 1, round: .15, belt: .64, tumble: .93 },
  coupe: { deck: [[0, .42], [.06, .52], [.4, .6], [.88, .63], [.99, .61], [1, .55]], A: .4, A2: .6, C2: .71, C: .9, roof: 1, round: .6, belt: .59, tumble: .72 },
  gt: { deck: [[0, .4], [.07, .52], [.45, .62], [.86, .65], [.99, .63], [1, .57]], A: .45, A2: .63, C2: .72, C: .88, roof: 1, round: .65, belt: .61, tumble: .7 },
  muscle: { deck: [[0, .52], [.04, .58], [.44, .63], [.9, .65], [.99, .63], [1, .58]], A: .44, A2: .6, C2: .7, C: .92, roof: 1, round: .45, belt: .61, tumble: .74 },
  mid: { deck: [[0, .33], [.08, .42], [.3, .49], [.62, .63], [.88, .65], [.99, .63], [1, .55]], A: .3, A2: .5, C2: .6, C: .88, roof: 1, round: .7, belt: .59, tumble: .66 },
  rear: { deck: [[0, .38], [.08, .5], [.32, .56], [.9, .61], [.99, .59], [1, .53]], A: .32, A2: .49, C2: .6, C: .93, roof: 1, round: .7, belt: .59, tumble: .7 },
  roadster: { deck: [[0, .38], [.08, .52], [.4, .65], [.95, .72], [1, .66]], A: .4, A2: .62, C2: .7, C: .8, roof: 1, round: .6, belt: .66, tumble: .7 },
  hyper: { deck: [[0, .3], [.08, .4], [.28, .47], [.6, .61], [.9, .64], [.99, .61], [1, .53]], A: .28, A2: .48, C2: .58, C: .86, roof: 1, round: .75, belt: .57, tumble: .62 },
  boxy: { deck: [[0, .56], [.02, .6], [.3, .65], [.9, .67], [1, .63]], A: .3, A2: .47, C2: .8, C: .93, roof: 1, round: .22, belt: .64, tumble: .86 },
  classicmini: { deck: [[0, .54], [.03, .61], [.28, .65], [.97, .65], [1, .6]], A: .28, A2: .4, C2: .9, C: .97, roof: 1, round: .45, belt: .63, tumble: .88 },
};
// ground clearance of the sills (m)
const CLR = { hatch3: .14, hatch5: .145, saloon: .135, estate: .14, fastback: .13, suv: .21, crossover: .18, offroad: .24, coupe: .12, gt: .12, muscle: .13, mid: .1, rear: .11, roadster: .12, hyper: .09, boxy: .15, classicmini: .13 };

function lerpTable(t, s) {
  if (s <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (s <= t[i][0]) { const [s0, h0] = t[i - 1], [s1, h1] = t[i]; const u = (s - s0) / (s1 - s0); const k = u * u * (3 - 2 * u); return h0 + (h1 - h0) * (0.35 * u + 0.65 * k); }
  return t[t.length - 1][1];
}
const sm = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ---------- shared materials & textures --------------------------------------------------------
const TEX = {};
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function grilleTex(kind) {
  const k = 'g' + kind; if (TEX[k]) return TEX[k];
  return TEX[k] = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#050506'; g.fillRect(0, 0, w, h);
    g.strokeStyle = kind === 'chrome' ? '#9aa0a8' : '#2c2e33'; g.lineWidth = 3;
    if (kind === 'hex' || kind === 'chrome') { for (let y = 0; y < h + 16; y += 14) for (let x = (y / 14 % 2) * 9; x < w; x += 18) { g.beginPath(); for (let a = 0; a < 6; a++) g.lineTo(x + 7 * Math.cos(a * Math.PI / 3), y + 7 * Math.sin(a * Math.PI / 3)); g.closePath(); g.stroke(); } }
    else if (kind === 'bars') { for (let y = 8; y < h; y += 16) { const gr = g.createLinearGradient(0, y, 0, y + 6); gr.addColorStop(0, '#d8dce0'); gr.addColorStop(1, '#5a5e64'); g.fillStyle = gr; g.fillRect(0, y, w, 6); } }
    else if (kind === 'slats') { for (let y = 6; y < h; y += 13) { const gr = g.createLinearGradient(0, y, 0, y + 5); gr.addColorStop(0, '#e6e8ea'); gr.addColorStop(1, '#6b6f75'); g.fillStyle = gr; g.fillRect(0, y, w, 4); } }
    else { for (let y = 0; y < h; y += 9) for (let x = (y / 9 % 2) * 4.5; x < w; x += 9) { g.fillStyle = '#1d1e22'; g.beginPath(); g.moveTo(x + 4.5, y); g.lineTo(x + 9, y + 4.5); g.lineTo(x + 4.5, y + 9); g.lineTo(x, y + 4.5); g.fill(); } }
  });
}
function gtiTex() { // red 'GTI' badge lettering
  if (TEX.gti) return TEX.gti; return TEX.gti = canvasTex(256, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.font = 'italic bold 54px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 5; g.strokeStyle = '#e8e8e8'; g.strokeText('GTI', w / 2, h / 2 + 2); g.fillStyle = '#d0101c'; g.fillText('GTI', w / 2, h / 2 + 2); });
}
function plateTex(text, rear) {
  return canvasTex(256, 56, (g, w, h) => {
    g.fillStyle = rear ? '#f5c518' : '#f4f4f0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1f4fa8'; g.fillRect(0, 0, 22, h); g.fillStyle = '#fff'; g.font = 'bold 11px sans-serif'; g.fillText('UK', 3, 44);
    g.fillStyle = '#111'; g.font = 'bold 40px "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.fillText(text, w / 2 + 10, 43);
  });
}
function badgeTex(letter) {
  const k = 'b' + letter; if (TEX[k]) return TEX[k];
  return TEX[k] = canvasTex(64, 64, (g) => {
    const gr = g.createLinearGradient(0, 0, 64, 64); gr.addColorStop(0, '#f0f0f0'); gr.addColorStop(1, '#8a8e94');
    g.fillStyle = gr; g.beginPath(); g.arc(32, 32, 30, 0, 7); g.fill(); g.fillStyle = '#16171b'; g.beginPath(); g.arc(32, 32, 24, 0, 7); g.fill();
    g.fillStyle = '#e8e8e8'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(letter, 32, 34);
  });
}
// panel gaps / shut lines / door handles / stripes, multiplied over the paint. uv: u = s (0 nose → 1 tail),
// v = ring position (0 bottom centre, .5 top centre, 1 bottom centre again). V holds the v of key section points.
function panelTex(car, S) {
  const k = 'p' + car.id; if (TEX[k]) return TEX[k];
  const { A, V } = S; const doors3 = /hatch3|coupe|gt|muscle|mid|rear|roadster|hyper|classicmini/.test(car.body) || car.id === 'sierra' || car.id === 'escos';
  return TEX[k] = canvasTex(2048, 512, (g, w, h) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    const line = (u0, v0, u1, v1, a = 0.8, lw = 2.4) => { g.strokeStyle = `rgba(0,0,0,${a})`; g.lineWidth = lw; g.beginPath(); g.moveTo(u0 * w, v0 * h); g.lineTo(u1 * w, v1 * h); g.stroke(); };
    const both = (fn) => { fn(v => v); fn(v => 1 - v); };
    const aS = A.A - 0.005, dEnd = doors3 ? A.A + (A.C - A.A) * 0.6 : A.A + (A.C - A.A) * 0.47, d2 = A.A + (A.C - A.A) * 0.84;
    both(m => {
      // doors: front edge, rear edge (and rear door) from sill to belt, plus the sill line
      line(aS, m(V.sill), aS - 0.004, m(V.belt));
      line(dEnd, m(V.sill), dEnd + 0.006, m(V.belt));
      if (!doors3 && !S.conv) line(d2, m(V.sill), d2 + 0.012, m(V.belt));
      line(aS, m(V.sill), (doors3 || S.conv ? dEnd : d2), m(V.sill), 0.5, 1.6);
      // bonnet side seams and boot/tailgate seams along the shoulder
      line(0.035, m(V.deck0), aS - 0.01, m(V.deck0), 0.7, 2);
      if (!/mid|hyper/.test(car.body)) line(A.C + 0.012, m(V.deck0), 0.975, m(V.deck0), 0.6, 2);
      // door handle: short dark recess
      const hu = aS + (dEnd - aS) * 0.74, hv = m(V.belt - 0.035);
      g.fillStyle = 'rgba(0,0,0,.75)'; g.fillRect(hu * w, Math.min(hv, m(V.belt - 0.045)) * h, 0.018 * w, 0.007 * h);
      if (!doors3 && !S.conv) { const hu2 = dEnd + (d2 - dEnd) * 0.72; g.fillRect(hu2 * w, Math.min(hv, m(V.belt - 0.045)) * h, 0.016 * w, 0.007 * h); }
      // fuel filler flap
      if (car.asp !== 'EV' || true) { const fu = A.C - 0.03; g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 1.6; g.strokeRect(fu * w, m(V.belt - 0.03) * h - 7, 0.016 * w, 14); }
    });
    // bonnet rear edge (across the top) and boot lid edge
    line(aS - 0.012, V.deck0, aS - 0.012, 1 - V.deck0, 0.7, 2);
    if (!/mid|hyper/.test(car.body) && !/hatch|estate|suv|crossover|offroad|boxy|classicmini/.test(car.body)) line(A.C + 0.012, V.deck0, A.C + 0.012, 1 - V.deck0, 0.6, 2);
    if (/mid|hyper/.test(car.body)) { line(0.04, V.deck0, 0.04, 1 - V.deck0, 0.6, 2); line(A.C + 0.02, V.deck0, A.C + 0.02, 1 - V.deck0, 0.6, 2); }
    if (car.stripes) { g.fillStyle = 'rgba(255,255,255,.95)'; g.fillRect(0, 0.475 * h, w, 0.011 * h); g.fillRect(0, 0.514 * h, w, 0.011 * h); }
  }, true);
}

let ENV = null;
export function setCarEnv(env) { ENV = env; for (const m of PAINT_MATS) { m.envMap = env; m.needsUpdate = true; } }
const PAINT_MATS = new Set();
const M = {};
function mats() {
  if (M.glass) return M;
  // dark tinted glass with strong, glossy reflections (env map); slightly see-through so interiors read
  // fresnel glass (IOR 1.52); *T = physical transmission variants (high detail, showroom / ultra)
  M.glass = carGlass(false); M.tint = carGlass(true); M.glassT = M.glass; M.tintT = M.tint; // gti8: transmission glass showed white patches in showroom
  M.trim = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.5, metalness: 0.15 });
  M.gloss = new THREE.MeshPhysicalMaterial({ color: 0x060607, roughness: 0.15, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }); // piano black
  M.chrome = new THREE.MeshStandardMaterial({ color: 0xeef0f2, roughness: 0.06, metalness: 1 });
  M.rubber = carRubber(true); M.rubberLo = new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.9, metalness: 0 }); // lettered sidewalls + tread grooves (lathe uv)
  M.disc = new THREE.MeshStandardMaterial({ color: 0x7d8186, roughness: 0.42, metalness: 1 });
  M.under = new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 1 });
  M.liner = new THREE.MeshStandardMaterial({ color: 0x080809, roughness: 0.95, side: THREE.DoubleSide });
  M.seat = new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 0.75 });
  M.cream = new THREE.MeshStandardMaterial({ color: 0xcdbb9a, roughness: 0.65 });
  M.dash = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.6 });
  M.carbon = new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.3, metalness: 0.4 });
  M.housing = new THREE.MeshStandardMaterial({ color: 0x9aa1aa, roughness: 0.16, metalness: 1 }); // lamp reflector housings
  M.lens = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, transparent: true, opacity: 0.22, clearcoat: 1, envMapIntensity: 2, depthWrite: false });
  M.redLens = new THREE.MeshPhysicalMaterial({ color: 0x4a0406, roughness: 0.08, metalness: 0.1, clearcoat: 1, envMapIntensity: 1.5 });
  M.exhaust = new THREE.MeshStandardMaterial({ color: 0x9a9da2, roughness: 0.2, metalness: 1 });
  M.exhaustIn = new THREE.MeshBasicMaterial({ color: 0x050505 });
  return M;
}

// ---------- geometry helpers ----------------------------------------------------------------------
// loft with per-face material ids → one geometry with groups. rings: array of arrays of Vector3 (same length)
function loft(rings, closeRing, uvs, matOf) {
  const n = rings.length, m = rings[0].length;
  const pos = new Float32Array(n * m * 3), uv = new Float32Array(n * m * 2);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const p = rings[i][j], o = (i * m + j); pos[o * 3] = p.x; pos[o * 3 + 1] = p.y; pos[o * 3 + 2] = p.z;
    const t = uvs ? uvs(i, j) : [i / (n - 1), j / (m - 1)]; uv[o * 2] = t[0]; uv[o * 2 + 1] = t[1];
  }
  const mm = closeRing ? m : m - 1; const by = new Map();
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < mm; j++) {
    const a = i * m + j, b = i * m + (j + 1) % m, c = (i + 1) * m + j, d = (i + 1) * m + (j + 1) % m;
    const k = matOf ? matOf(i, j) : 0; if (k < 0) continue; if (!by.has(k)) by.set(k, []);
    by.get(k).push(a, b, c, b, d, c);
  }
  const idx = []; const g = new THREE.BufferGeometry();
  for (const k of [...by.keys()].sort((x, y) => x - y)) { g.addGroup(idx.length, by.get(k).length, k); idx.push(...by.get(k)); }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
function capFan(ring, flip) { // closes a ring with a centre fan
  const c = new THREE.Vector3(); ring.forEach(p => c.add(p)); c.multiplyScalar(1 / ring.length);
  const pos = [c.x, c.y, c.z]; ring.forEach(p => pos.push(p.x, p.y, p.z)); const idx = [];
  for (let j = 0; j < ring.length; j++) { const a = 1 + j, b = 1 + (j + 1) % ring.length; flip ? idx.push(0, a, b) : idx.push(0, b, a); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0.99), 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
function rrect(w, h, r, slant = 0) { // rounded rectangle Shape centred on 0 (slant shears the top edge sideways)
  const s = new THREE.Shape(); const x0 = -w / 2, y0 = -h / 2; r = Math.min(r, w / 2, h / 2);
  s.moveTo(x0 + r, y0); s.lineTo(x0 + w - r, y0); s.quadraticCurveTo(x0 + w, y0, x0 + w + slant * 0.5, y0 + r);
  s.lineTo(x0 + w + slant, y0 + h - r); s.quadraticCurveTo(x0 + w + slant, y0 + h, x0 + w + slant - r, y0 + h);
  s.lineTo(x0 + r + slant * 0.6, y0 + h); s.quadraticCurveTo(x0 + slant * 0.6, y0 + h, x0 + slant * 0.5, y0 + h - r);
  s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0); return s;
}
function slab(shape, depth, bevel = 0.006, curveSeg = 4) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: curveSeg });
  g.deleteAttribute('uv'); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g;
}
const norm = g => { const n = g.index ? g.toNonIndexed() : g; if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2)); for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); n.clearGroups(); return n; };
function mergeList(list) { return list.length ? mergeGeometries(list.map(norm)) : null; }

// ---------- body ------------------------------------------------------------------------------------
function buildShape(car, detail) {
  const A = (car.id === 'gti8' && ARCH.gti8) || ARCH[car.body] || ARCH.saloon;
  const [Lm, Wm0, Hm, WB] = car.dims;
  const Wm = Math.min(Wm0, 2.0);
  const conv = !!car.conv;
  const R = car.body === 'classicmini' ? 0.265 : /suv|offroad/.test(car.body) ? 0.39 : car.classic ? 0.3 : car.body === 'crossover' ? 0.36 : /mid|hyper/.test(car.body) ? 0.34 : 0.33;
  const fo = (Lm - WB) * (car.id === 'gti8' ? 0.565 : /mid|hyper/.test(car.body) ? 0.46 : car.body === 'rear' ? 0.43 : car.body === 'gt' || car.body === 'muscle' ? 0.46 : car.body === 'classicmini' ? 0.5 : 0.53);
  const zF = -Lm / 2 + fo, zR = zF + WB; // wheel centres (z)
  const hw0 = Wm / 2 * 0.99;
  const clr = car.id === 'gti8' ? 0.13 : CLR[car.body] ?? 0.14; // GTI sits 15 mm lower than a plain Golf
  const ra = R * 1.075 + 0.012; // arch opening radius: small, even gap around the tyre
  const NS = detail > 1 ? 72 : detail > 0 ? 52 : 36; // stations
  const r = A.round;
  const cf = Math.min(0.1, 0.34 / Lm), cr = Math.min(0.09, 0.3 / Lm); // plan corner radii (fraction of length)
  const plan = s => { // half-width in plan (rounded corners, slight taper to the nose/tail)
    s = clamp(s, 0, 1); let f = 1;
    if (s < cf) { const t = clamp(1 - s / cf, 0, 1); const b = car.id === 'gti8' ? .90 : .6; f *= b + (1 - b) * Math.pow(1 - Math.pow(t, 2.2), 0.5); }
    if (s > 1 - cr) { const t = Math.min(1, (s - (1 - cr)) / cr); const b = car.id === 'gti8' ? .94 : .68; f *= b + (1 - b) * Math.pow(1 - Math.pow(t, 2.2), 0.5); }
    return hw0 * f * (0.955 + 0.045 * sm(0, 0.3, s)) * (0.97 + 0.03 * sm(1, 0.75, s));
  };
  const archY = z => { let y = -1; for (const zc of [zF, zR]) { const dz = z - zc; if (Math.abs(dz) < ra) y = Math.max(y, R + Math.sqrt(ra * ra - dz * dz)); } return y; };
  const bulgeAt = z => { let b = 0; for (const zc of [zF, zR]) b = Math.max(b, Math.exp(-(((z - zc) / (R * 1.5)) ** 2))); return b; };
  // station distribution: dense towards the ends where the curvature is
  const sOf = u => 0.55 * u + 0.45 * (0.5 - 0.5 * Math.cos(Math.PI * u));
  const nSE = 7; // superellipse points on the deck
  // nose / tail rake: the upper part of the end faces leans back, so bumpers are rounded in profile
  const rakeF = /mid|hyper|coupe|gt|fastback|rear|roadster/.test(car.body) ? 0.1 : /suv|offroad|boxy|classicmini/.test(car.body) ? 0.03 : 0.075;
  const rakeR = /boxy|offroad|classicmini/.test(car.body) ? 0.02 : 0.05;
  const sRF = Math.max(0.035, rakeF * 1.6 / Lm), sRR = Math.max(0.03, rakeR * 1.6 / Lm);
  const rakeZ = (s, y, bot, top) => { const h = clamp((y - bot) / Math.max(0.05, top - bot), 0, 1.2) ** 1.6;
    if (s < sRF) return rakeF * h * (1 - s / sRF); if (s > 1 - sRR) return -rakeR * h * (1 - (1 - s) / sRR); return 0; };
  const rings = [], info = [];
  const cO0 = A.A + 0.025, cO1 = A.A + (A.C - A.A) * 0.8; // convertible cockpit opening
  for (let i = 0; i < NS; i++) {
    const s = sOf(i / (NS - 1)); const z = -Lm / 2 + s * Lm;
    const top = lerpTable(A.deck, s) * Hm;
    let bot = clr + 0.05 * (1 - sm(0, 0.05, s)) + 0.09 * sm(0.94, 1, s); // bumper lips lift at the ends
    const aY = archY(z); if (aY > bot) bot = aY;
    let belt = Math.min(top - 0.06, Math.max(bot + 0.06, A.belt * Hm * (0.985 + 0.03 * s)));
    // wings rise over the tyres where the bonnet/engine cover is lower than the wheel tops (mid-engine, hyper cars)
    const beltN = belt; const wx = /mid|hyper|rear/.test(car.body) ? [1.25, 0.03] : [1.15, 0.0];
    { let f = 0; for (const zc of [zF, zR]) { const dz = Math.abs(z - zc); f = Math.max(f, (R + Math.sqrt(Math.max(0, (ra * wx[0]) ** 2 - dz * dz)) + wx[1]) * (dz < ra * wx[0] ? 1 : 0)); }
      if (f > belt) belt = f; }
    bot = Math.min(bot, belt - 0.05);
    const hw = plan(s) * (1 + 0.018 * bulgeAt(z));
    const crown = 0.018 + 0.03 * r;
    const n = 2.3 + 1.6 * (1 - r); // superellipse exponent: higher = squarer shoulders
    const sh = hw * (0.965 - 0.025 * r); // shoulder half-width
    const pts = [[0, bot], [hw * 0.84, bot], [hw * 0.935, bot + 0.012], [hw * 0.972, bot + 0.05],
      [hw * 0.99, bot + (belt - bot) * 0.36], [hw, bot + (belt - bot) * 0.64], [hw * 0.994, bot + (belt - bot) * 0.87],
      [hw * 0.982, belt - 0.012], [sh, belt]];
    const hTop = top + crown - belt;
    // valley between raised wings: keep the wing crown over the tyre, then drop to the bonnet / engine cover
    const vq = clamp((belt - (top + crown - 0.02)) / 0.06, 0, 1), xw = Math.max(0.35 * hw, hw - 0.4);
    for (let k = 1; k <= nSE; k++) { const th = k / nSE * Math.PI / 2; const c = Math.cos(th), si = Math.sin(th);
      let x = sh * Math.pow(c, 2 / n) * (k === nSE ? 0 : 1), y = belt + hTop * Math.pow(si, 2 / n);
      if (vq > 0) { const t = k / nSE; const xv = t < 0.43 ? sh + (xw - sh) * (t / 0.43) : xw * (1 - (t - 0.43) / 0.57); const yv = t < 0.43 ? belt + 0.025 * Math.sin(Math.PI * t / 0.43) : belt + (top + crown - belt) * sm(0.43, 0.8, t);
        x += (xv - x) * vq; y += (yv - y) * vq; if (k === nSE) x = 0; }
      pts.push([x, y]); }
    let open = 0;
    if (conv) { open = Math.min(sm(cO0 - 0.01, cO0 + 0.015, s), 1 - sm(cO1 - 0.015, cO1 + 0.01, s)); }
    if (open > 0) { // cockpit tub: from the rim down to the floor
      const rimK = 10, rimX = pts[rimK][0], rimY = pts[rimK][1]; const floorY = clr + 0.2;
      const tub = [[rimX * 0.97, rimY - 0.03], [rimX * 0.94, rimY - 0.14], [rimX * 0.9, floorY + 0.1], [rimX * 0.8, floorY]];
      for (let q = 0; q < tub.length; q++) { const k = rimK + 1 + q; pts[k] = [pts[k][0] + (tub[q][0] - pts[k][0]) * open, pts[k][1] + (tub[q][1] - pts[k][1]) * open]; }
      const last = pts.length - 1; pts[last] = [0, pts[last][1] + (floorY - pts[last][1]) * open];
    }
    const ring = [];
    const zOf = y => z + rakeZ(s, y, bot, top);
    for (const [x, y] of pts) ring.push(new THREE.Vector3(x, y, zOf(y)));
    for (let j = pts.length - 2; j >= 1; j--) ring.push(new THREE.Vector3(-pts[j][0], pts[j][1], zOf(pts[j][1])));
    rings.push(ring); info.push({ s, z, top, bot, belt, hw, sh, deck: top + crown, open, pts });
  }
  const H = rings[0].length, half = nSE + 8; // H ring points; index half = top centre
  // key v coordinates for the panel texture
  const vOf = j => j / H;
  const V = { sill: vOf(3), belt: vOf(8), deck0: vOf(11) };
  const matBody = (i, j) => { // 0 paint, 1 black trim (lower sills / arch undersides), 2 interior tub
    const jj = j <= half ? j : H - j; const o = (info[i].open + info[i + 1].open) / 2;
    if (o > 0.5 && jj >= 11) return 2;
    if (jj <= 1) return 1; // floor
    return 0;
  };
  const body = loft(rings, true, (i, j) => [info[i].s, vOf(j)], matBody);
  const capF = capFan(rings[0], false), capR = capFan(rings[NS - 1], true);

  // greenhouse ---------------------------------------------------------------------------------------
  const iA = info.findIndex(o => o.s >= A.A), iC = info.findIndex(o => o.s >= A.C) < 0 ? NS - 1 : info.findIndex(o => o.s >= A.C);
  const roofY = A.roof * Hm;
  const KS = 4, KR = 5; // side-band and roof-arc points per half
  let glass = null; let gh = null;
  const deckAt = (o, fx) => { // deck surface height at x = fx * shoulder width (from the section superellipse)
    const n = 2.3 + 1.6 * (1 - r); const c = clamp(fx, 0, 1); const th = Math.acos(Math.pow(c, n / 2)); return o.belt + (o.deck - o.belt) * Math.pow(Math.sin(th), 2 / n);
  };
  if (!conv) {
    const gr = [], ss = [];
    for (let i = iA; i <= iC; i++) {
      const o = info[i], s = o.s, z = o.z;
      const fx = 0.9; const d = deckAt(o, fx) - 0.012; const xb = o.sh * fx;
      let y;
      if (s < A.A2) y = d + (roofY - d) * Math.pow(sm(A.A, A.A2, s), 0.85);
      else if (s <= A.C2) y = roofY - (A.drop ?? 0.028) * Math.pow((s - (A.A2 + A.C2) / 2) / Math.max(0.01, (A.C2 - A.A2) / 2), 2) * (A.drop && s < (A.A2 + A.C2) / 2 ? 0.3 : 1); // A.drop: roof falls towards the tail (hatch)
      else y = roofY - (A.drop ?? 0.028) - (roofY - (A.drop ?? 0.028) - d) * Math.pow(sm(A.C2, A.C, s), 1.05);
      y = Math.max(y, d + 0.004);
      const tum = A.tumble * (1 - 0.08 * (1 - sm(A.A, A.A2, s)) - 0.08 * sm(A.C2, A.C, s));
      const xt = xb * tum; const camber = Math.min(0.04, (y - d) * 0.25); const ye = y - camber;
      const ring = [];
      for (let k = 0; k <= KS; k++) { const t = k / KS; ring.push(new THREE.Vector3(xb + (xt - xb) * Math.pow(t, 1.25) + 0.018 * Math.sin(Math.PI * t) * (y - d), d + (ye - d) * t, z)); }
      for (let k = 1; k <= KR; k++) { const ph = k / KR * Math.PI / 2; ring.push(new THREE.Vector3(xt * Math.cos(ph) * (k === KR ? 0 : 1), ye + camber * Math.sin(ph), z)); }
      for (let k = KS + KR - 1; k >= 0; k--) { const p = ring[k]; ring.push(new THREE.Vector3(-p.x, p.y, p.z)); }
      gr.push(ring); ss.push(s);
    }
    const nG = gr[0].length, mid = KS + KR;
    const sB = A.A + (A.C - A.A) * (/hatch3|coupe|gt|muscle|rear|roadster/.test(car.body) ? 0.66 : 0.5);
    // 0 roof/pillar paint, 1 glass, 2 black seals / B-pillar
    const matG = (i, j) => {
      const s = (ss[i] + ss[i + 1]) / 2; const jj = j < mid ? j : nG - 2 - j; const side = jj < KS; const h = side ? (jj + 0.5) / KS : 1;
      if (!side) { // roof band
        if (s > A.A2 + 0.005 && s < A.C2 - 0.005) return 0;
        return 1; // windscreen / rear screen
      }
      if (jj === 0) return 2; // waist seal
      if (s < A.A2 + 0.01) return 2; // A-pillar / mirror sail (gloss black, follows the station lines so edges stay clean)
      if (s > A.C2 + (A.C - A.C2) * (/hatch|estate|suv|crossover|offroad|boxy|classicmini/.test(car.body) ? 0.15 : 0.32)) return 0; // C-pillar sail panel
      if (jj === KS - 1 && h > 0.7) return 2; // top window seal
      if (Math.abs(s - sB) < 0.012) return 2; // B pillar (black)
      return 1;
    };
    gh = loft(gr, false, null, matG);
  } else {
    // convertible: raked, curved windscreen with a slim frame; the roof is stowed under the tonneau
    const gr = [];
    const i0 = info.findIndex(o => o.s >= A.A), i1 = info.findIndex(o => o.s >= A.A + 0.11);
    for (let i = i0; i <= i1; i++) {
      const o = info[i], s = o.s; const d = deckAt(o, 0.88) - 0.01; const t = sm(A.A, A.A + 0.11, s);
      const y = d + (Hm * 0.95 - d) * t; const xb = o.sh * 0.88, xt = xb * 0.9;
      const ring = []; for (let k = 0; k <= 6; k++) { const ph = k / 6 * Math.PI; const c = Math.cos(ph); ring.push(new THREE.Vector3((xb + (xt - xb) * t) * c, d + (y - d) + 0.05 * t * Math.sin(ph), o.z)); }
      gr.push(ring);
    }
    gh = loft(gr, false, null, () => 1);
    const topR = gr[gr.length - 1]; const pts = topR.map(p => p.clone().add(new THREE.Vector3(0, 0.012, 0.01)));
    const railC = new THREE.CatmullRomCurve3(pts); gh.userData.rail = new THREE.TubeGeometry(railC, 16, 0.018, 6, false);
    const pil = []; for (const k of [0, 6]) { const c = new THREE.CatmullRomCurve3(gr.map(rg => rg[k].clone().multiply(new THREE.Vector3(1.01, 1, 1)))); pil.push(new THREE.TubeGeometry(c, 8, 0.02, 6, false)); }
    gh.userData.pillars = pil;
  }
  return { rakeZ, body, capF, capR, gh, R, ra, zF, zR, fo, Lm, Wm, Hm, WB, info, rings, NS, A, plan, iA, iC, conv, clr, V, deckAt, half, H, cO0, cO1 };
}

const shapeCache = new Map(); let SHADOW_TEX = null;
function getShape(car, detail) { const k = car.id + ':' + detail; if (!shapeCache.has(k)) shapeCache.set(k, buildShape(car, detail)); return shapeCache.get(k); }

// ---------- wheels ------------------------------------------------------------------------------------
const wheelCache = new Map();
function wheelGeos(R, width, style, detail) {
  const k = [R, width, style, detail].join(); if (wheelCache.has(k)) return wheelCache.get(k);
  const seg = detail > 1 ? 44 : detail > 0 ? 32 : 20;
  const rimR = R * (style === 'classic5' ? 0.6 : 0.71);
  const tw = width / 2;
  // tyre: lathe around x axis — rounded shoulders, sidewall bulge, tread
  const prof = [[rimR * 0.98, -tw * 0.9], [rimR * 1.03, -tw * 0.97], [rimR + (R - rimR) * 0.45, -tw * 1.02], [R * 0.965, -tw * 0.96], [R * 0.992, -tw * 0.8], [R, -tw * 0.5], [R, tw * 0.5], [R * 0.992, tw * 0.8], [R * 0.965, tw * 0.96], [rimR + (R - rimR) * 0.45, tw * 1.02], [rimR * 1.03, tw * 0.97], [rimR * 0.98, tw * 0.9]];
  const tyre = new THREE.LatheGeometry(prof.map(([r, x]) => new THREE.Vector2(r, x)), seg); tyre.rotateZ(Math.PI / 2);
  const parts = [];
  const barrel = new THREE.CylinderGeometry(rimR * 0.97, rimR * 0.97, width * 0.92, seg, 1, true); barrel.rotateZ(Math.PI / 2); parts.push(barrel);
  // rim lip: outer flange ring with a little depth
  const lip = new THREE.LatheGeometry([[rimR * 0.9, 0], [rimR * 1.02, 0.004], [rimR * 1.04, -0.012], [rimR * 0.97, -0.03]].map(([r, x]) => new THREE.Vector2(r, x)), seg); lip.rotateZ(-Math.PI / 2); lip.translate(tw * 0.98, 0, 0); parts.push(lip);
  // spokes: extruded, tapered shapes set back into the barrel (concave face)
  const n = style === 'multi' ? 10 : style === 'classic5' ? 4 : style === 'black' ? 6 : style === 'y' ? 5 : 5;
  const hubR = rimR * 0.26;
  const spokeShape = (w0, w1) => { const s = new THREE.Shape(); s.moveTo(-w0 / 2, hubR * 0.8); s.lineTo(-w1 / 2, rimR * 0.93); s.lineTo(w1 / 2, rimR * 0.93); s.lineTo(w0 / 2, hubR * 0.8); s.closePath(); return s; };
  const addSpoke = (a, w0, w1, depth = 0.03) => { const g = slab(spokeShape(w0, w1), depth, 0.004, 1); g.rotateY(Math.PI / 2); g.rotateX(a); g.translate(tw * 0.42, 0, 0); // concave: rim edge sits deeper
    const p = g.attributes.position; for (let q = 0; q < p.count; q++) { const rr = Math.hypot(p.getY(q), p.getZ(q)); p.setX(q, p.getX(q) + (rr / rimR) * -0.035 + 0.03); } parts.push(g); };
  if (style === 'classic5') { // steel-style dish with round holes → a flat disc with a raised centre
    const dish = new THREE.CylinderGeometry(rimR * 0.95, rimR * 0.95, 0.02, seg); dish.rotateZ(Math.PI / 2); dish.translate(tw * 0.55, 0, 0); parts.push(dish);
    for (let i = 0; i < n; i++) addSpoke(i / n * Math.PI * 2, 0.07, 0.05, 0.02);
  } else for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    if (style === 'multi') { addSpoke(a - 0.06, 0.03, 0.022); addSpoke(a + 0.06, 0.03, 0.022); }
    else if (style === 'y') { addSpoke(a, 0.05, 0.03); addSpoke(a - 0.2, 0.028, 0.03, 0.022); addSpoke(a + 0.2, 0.028, 0.03, 0.022); }
    else if (style === 'black') addSpoke(a, 0.07, 0.06);
    else addSpoke(a, 0.085, 0.07);
  }
  const hub = new THREE.CylinderGeometry(hubR, hubR * 1.1, 0.05, 20); hub.rotateZ(Math.PI / 2); hub.translate(tw * 0.76, 0, 0); parts.push(hub);
  const rim = mergeGeometries(parts.map(norm));
  const capG = new THREE.CircleGeometry(hubR * 0.62, 20); capG.rotateY(Math.PI / 2); capG.translate(tw * 0.76 + 0.026, 0, 0);
  // brake disc (with hat) and caliper
  const disc = new THREE.CylinderGeometry(rimR * 0.82, rimR * 0.82, 0.028, 32); disc.rotateZ(Math.PI / 2); disc.translate(tw * 0.1, 0, 0);
  const cal = slab(rrect(rimR * 0.36, rimR * 0.62, 0.03), 0.07, 0.01); cal.rotateY(Math.PI / 2); cal.translate(tw * 0.1 - 0.035, rimR * 0.52, -rimR * 0.1);
  const out = { tyre, rim, disc, cal, cap: capG }; wheelCache.set(k, out); return out;
}

// ---------- assembly --------------------------------------------------------------------------------
// In-car view fit, per car, by ray tests against the car's own opaque meshes (body + interior, not glass/wheels):
// cockpit: raise the eye (keeping head room) and move it forward until the dash/bonnet top sits >= DASH deg below the
//   eye line, so with the -2 deg in-car pitch the dash fills <= ~28% of the screen and the road shows through the screen
// bonnet: move forward/up until the bonnet top is >= BON deg down (a thin strip), or down until some bonnet shows
// the photo cockpits (rrs/box overlays) keep their calibrated eye
const DASH = 19, BON = 23, UPMAX = 0.18, FWDMAX = 0.45;
// photo-real interiors: gather the model's own steering-wheel meshes into a pivot that turns about the column axis
function rigRealSteer(root) {
  const u = root.userData; if (u.steeringWheel || u.real === 'rrs' || u.real === 'box') return;
  const wheelObjs = new Set(); for (const w of u.wheels || []) w.pivot.traverse(o => wheelObjs.add(o));
  const rim = [], base = []; root.traverse(o => { if (!o.isMesh || wheelObjs.has(o)) return; const n = o.name + '|' + (o.material?.name || '');
    if (/steeringwheel|steer_wheel|steeringemblem|lenkrad/i.test(n)) rim.push(o); else if (/steering(base|column)/i.test(n)) base.push(o); });
  if (!rim.length) return; root.updateMatrixWorld(true);
  const bb = new THREE.Box3(); rim.forEach(o => bb.expandByObject(o)); const c = bb.getCenter(new THREE.Vector3());
  const parent = rim[0].parent; const pivot = new THREE.Group(); pivot.name = 'steerPivot'; parent.add(pivot); pivot.position.copy(parent.worldToLocal(c.clone())); pivot.updateMatrixWorld(true);
  let axisW; if (base.length) { const bc = new THREE.Box3(); base.forEach(o => bc.expandByObject(o)); axisW = c.clone().sub(bc.getCenter(new THREE.Vector3())).normalize(); }
  else axisW = new THREE.Vector3(0, 0.35, 1).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())).normalize();
  rim.forEach(o => pivot.attach(o)); // keeps each mesh's world pose
  const qi = pivot.getWorldQuaternion(new THREE.Quaternion()).invert(); u.swAxis = axisW.applyQuaternion(qi).normalize(); u.steeringWheel = pivot;
}
export function fitInCarCams(root) {
  const u = root.userData; if (!u.cockpit || u.real === 'rrs' || u.real === 'box') return;
  root.updateMatrixWorld(true); const wheelObjs = new Set(); for (const w of u.wheels || []) w.pivot.traverse(o => wheelObjs.add(o));
  const solid = []; root.traverse(o => { if (!o.isMesh || wheelObjs.has(o) || o === u.driverMesh) return; const mt = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!mt || (!Array.isArray(o.material) && (mt.transparent || mt.transmission > 0.2)) || /glass|window|screen/i.test(o.name || '')) return; solid.push(o); });
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), W = p => p.clone().applyMatrix4(root.matrixWorld);
  const rc = new THREE.Raycaster(), d = new THREE.Vector3(); const q = root.quaternion.clone();
  const see = m => !m || m.transparent || m.transmission > 0.2 || /glass|window|screen/i.test(m.name || ''); // see-through faces don't block the view
  const hits = (p, dir, far) => { rc.set(W(p), dir.clone().applyQuaternion(q)); rc.far = far; return rc.intersectObjects(solid, false).filter(h => !see(Array.isArray(h.object.material) ? h.object.material[h.face?.materialIndex ?? 0] : h.object.material)); };
  const topDeg = (p, far, yaws = [0]) => { for (let a = 0; a <= 40; a++) { const r = a * Math.PI / 180; for (const y of yaws) { d.set(-Math.sin(y) * Math.cos(r), -Math.sin(r), -Math.cos(y) * Math.cos(r)); if (hits(p, d, far).length) return a; } } return 40; };
  const YAWS = [-0.35, 0, 0.35]; // dash seen straight ahead and ~20 deg either side
  const UP = new THREE.Vector3(0, 1, 0), DN = new THREE.Vector3(0, -1, 0);
  const e = u.cockpit.clone(); const z0 = e.z;
  { let sw = u.steeringWheel, c = null; if (sw) c = new THREE.Box3().setFromObject(sw).getCenter(new THREE.Vector3()).applyMatrix4(inv);
    else root.traverse(o => { if (o.isMesh && !wheelObjs.has(o) && /steeringwheel|steer_wheel|lenkrad/i.test(o.name + '|' + (o.material?.name || ''))) { const q = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).applyMatrix4(inv); if (!c || q.z > c.z) c = q; } });
    if (c && !u.steeringWheel) { e.z = Math.min(e.z, c.z + 0.55); e.y = Math.max(e.y, c.y + 0.3); }
    if (c) { e.x = c.x; u.ckFrom = 'wheel'; if (Math.abs(c.x) < 0.1 && !u.steeringWheel) { e.z = Math.min(e.z, c.z + 0.4); e.y += 0.03; u.ckFrom = 'centre'; } } // p51: centre-seat interiors (shared mid-engine model): sit up to the wheel so the door cards stay beside you, not in view
    else if (/^gen/.test(u.real || '')) { e.x = -Math.abs(e.x); u.ckFrom = 'lhd'; } } // generic photo-real interiors are left-hand drive
  if (false) { const wp = new THREE.Vector3(); u.steeringWheel.getWorldPosition(wp); wp.applyMatrix4(inv); if (Math.abs(wp.x) > 0.15 && Math.sign(wp.x) !== Math.sign(e.x)) e.x = wp.x; } // sit behind the car's own wheel
  for (let k = 0; k < 8 && hits(e, UP, 0.07).length; k++) e.y -= 0.02; // head clear of the roof lining
  // Never solve dash visibility by lifting the eye through the roof or over the windscreen.
  e.y = Math.min(e.y, u.dims.H - 0.13);
  u.cockpit = e; u.dashDeg = topDeg(e, 1.6, YAWS); u.fitN = solid.length;
  const b = u.bonnetCam.clone(); const zb = b.z;
  for (let n = 0; n < 14 && topDeg(b, 3) < BON; n++) { b.z -= 0.05; const h = hits(b, DN, 3)[0]; if (!h || h.distance > 1.2) { b.z += 0.05; b.y += 0.02; } }
  for (let n = 0; n < 10 && topDeg(b, 3) >= 40; n++) { const h = hits(b, DN, 3)[0]; if (!h || h.distance < 0.12) break; b.y -= 0.03; } // no bonnet in view at all: come down to it
  u.bonnetCam = b; u.bonnetDeg = topDeg(b, 3); void inv; void zb;
}
export function buildCar(car, opts = {}) {
  if (car.pro) { mats(); const root = buildPro(car, opts, { M, wheelGeos, ENV }); PAINT_MATS.add(root.userData.paint); if (car.hero) try { initHero(root, car); } catch (e) { console.warn('hero init', e); } return root; } // p53 pro pipeline (carpro.js)
  if (!opts.procedural) { // first-game 3D models; any failure (e.g. a browser missing a canvas API) falls back to the procedural body
    let real = null; try { real = buildRealCar(car, opts); } catch (e) { console.warn('3D model for', car.id, 'failed, using procedural body:', e); }
    if (real) { if (ENV) real.userData.paint.envMap = ENV; PAINT_MATS.add(real.userData.paint); fitInCarCams(real); rigRealSteer(real); return real; } }
  mats();
  const detail = opts.detail ?? 2; const colour = opts.colour ?? car.colour; const wheelStyle = opts.wheel || car.wheel || 'five';
  const S = getShape(car, detail);
  const { Lm, Wm, Hm, R, zF, zR, A, info, NS } = S;
  const root = new THREE.Group(); root.name = car.id;
  const bodyG = new THREE.Group(); root.add(bodyG); // body (rolls/pitches on suspension)
  const metallic = opts.finish !== 'solid';
  const paint = carPaint(colour, metallic, detail, { envMap: ENV, envMapIntensity: 1.2, map: panelTex(car, S) }); // base + flake + clearcoat; panel gaps / shut lines in the map
  PAINT_MATS.add(paint);
  const intMat = car.id === 'db9v' ? M.cream : M.seat;
  const add = (geo, mat, parent = bodyG, cast = true) => { if (!geo) return null; const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = false; parent.add(m); return m; };
  add(S.body, [paint, M.trim, intMat]);
  const tx = wantTransmission(detail); const glassMat = opts.tint ? (tx ? M.tintT : M.tint) : (tx ? M.glassT : M.glass);
  const roofMat = car.roofc ? new THREE.MeshPhysicalMaterial({ color: car.roofc, roughness: 0.32, clearcoat: 1, metalness: 0.2, envMap: ENV }) : paint;
  if (car.roofc) PAINT_MATS.add(roofMat);
  const ghm = add(S.gh, [roofMat, glassMat, M.gloss]); if (ghm) ghm.renderOrder = 2;
  // part lists merged per material at the end
  const P = { paint: [S.capF, S.capR], trim: [], gloss: [], chrome: [], liner: [], under: [], housing: [], lens: [], red: [], head: [], tail: [], ind: [], rev: [], exhaust: [], exIn: [], plateF: [], plateR: [], grille: [], interior: [], dash: [] };
  const put = (list, g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz)); const gg = g.clone(); gg.applyMatrix4(m); P[list].push(gg); return gg; };
  if (S.conv && S.gh.userData.rail) { P.gloss.push(S.gh.userData.rail); P.gloss.push(...S.gh.userData.pillars); }

  // --- helpers to sit parts on the nose / tail surfaces
  const zN = -Lm / 2, zT = Lm / 2;
  const endS = (front, x) => { // station s on the front/rear plan corner where the half-width equals x → {z, ang}
    let lo = front ? 0 : 0.8, hi = front ? 0.2 : 1;
    for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; const w = S.plan(m); if (front ? w < x : w > x) lo = m; else hi = m; }
    const s = (lo + hi) / 2; const ds = 0.002; const dw = (S.plan(s + ds) - S.plan(s - ds)) / (2 * ds * Lm);
    const w0 = S.plan(front ? 0 : 1);
    if (x <= w0) return { z: front ? zN : zT, ang: 0, s: front ? 0 : 1 };
    return { z: -Lm / 2 + s * Lm, ang: Math.atan(front ? 1 / Math.max(1e-3, dw) : 1 / Math.max(1e-3, -dw)), s };
  };
  const face = (front, x, y, out = 0.004) => { // position + yaw of a part mounted on the end surface at lateral x (≥0)
    const e = endS(front, Math.abs(x)); const a = e.ang; // angle between surface normal and the car axis
    const sgn = Math.sign(x) || 1;
    const nz = front ? -Math.cos(a) : Math.cos(a), nx = sgn * Math.sin(a);
    const rk = front ? S.rakeZ(0, y, info[0].bot, info[0].top) : S.rakeZ(1, y, info[NS - 1].bot, info[NS - 1].top);
    return { x: x + nx * out, y, z: e.z + nz * out + rk, yaw: front ? Math.PI - sgn * a : sgn * a, a };
  };
  const nose = info[0], tail = info[NS - 1];
  const rkF = y => S.rakeZ(0, y, nose.bot, nose.top), rkR = y => S.rakeZ(1, y, tail.bot, tail.top); // end-face rake at height y
  const noseTop = nose.top, tailTop = tail.top;

  // --- underbody, arch liners, sills
  { const g = new THREE.BoxGeometry(Wm * 0.86, 0.05, Lm * 0.84); g.translate(0, S.clr + 0.03, 0); P.under.push(g); }
  const width = /mid|hyper|rear|muscle/.test(car.body) ? 0.29 : car.classic ? 0.17 : /suv|offroad/.test(car.body) ? 0.29 : 0.235;
  const hwAt = zc => info.filter(o => Math.abs(o.z - zc) < S.ra * 0.8).reduce((m, o) => Math.min(m, o.hw), 9); // narrowest body half-width over the arch
  const trackHalf = zc => Math.min(Wm / 2, hwAt(zc)) - width / 2 - 0.018;
  for (const zc of [zF, zR]) {
    const lw = width + 0.08;
    for (const sx of [-1, 1]) { const g = new THREE.CylinderGeometry(S.ra - 0.004, S.ra - 0.004, lw, 20, 1, true, 0, Math.PI); g.rotateZ(Math.PI / 2); g.translate(sx * (hwAt(zc) - lw / 2 - 0.006), R, zc); P.liner.push(g); }
    // arch lip: thin rolled edge following the opening
    for (const sx of [-1, 1]) { const pts = []; for (let k = 0; k <= 18; k++) { const a = Math.PI * (0.02 + 0.96 * k / 18); const z = zc - Math.cos(a) * S.ra, y = R + Math.sin(a) * S.ra; const ii = info.reduce((b, o, q) => Math.abs(o.z - z) < Math.abs(info[b].z - z) ? q : b, 0); pts.push(new THREE.Vector3(sx * (info[ii].hw * 0.992), y, z)); }
      P[car.id === 'gti8' || /suv|offroad|crossover/.test(car.body) ? 'trim' : 'paint'].push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, car.id === 'gti8' ? .022 : /suv|offroad|crossover/.test(car.body) ? 0.03 : 0.012, 5, false)); }
  }

  // --- lights
  const L = {};
  const headMat = new THREE.MeshStandardMaterial({ color: 0xf4f6ff, emissive: 0xeef3ff, emissiveIntensity: 0.25, roughness: 0.1, metalness: 0.3 }); // LED white
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x6a0003, emissive: 0xff1208, emissiveIntensity: 0.35, roughness: 0.25 });
  const indMat = new THREE.MeshStandardMaterial({ color: 0x6a3a00, emissive: 0xff8a00, emissiveIntensity: 0, roughness: 0.3 });
  const revMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.2 });
  L.head = headMat; L.tail = tailMat; L.ind = indMat; L.rev = revMat;
  const round = /classicmini|offroad/.test(car.body) || /gti8|gti2|rs2000|must|gt500|mini64|minics|escos|esrst/.test(car.id);
  const slim = /mid|hyper|fastback|coupe|gt|rear/.test(car.body);
  const hlW = round ? 0.2 : slim ? 0.42 : 0.4, hlH = round ? 0.2 : slim ? 0.1 : 0.14;
  const hlY = noseTop - hlH / 2 - (round ? 0.07 : 0.035);
  const hlX = Math.min(S.plan(0) * 1.02, (Wm / 2) * 0.72);
  for (const sx of [-1, 1]) {
    const f = face(true, sx * hlX, hlY, 0.0);
    const place = (list, g, dx = 0, dy = 0, dz = 0) => put(list, g, f.x + dx * Math.cos(f.yaw) * sx * 0, f.y + dy, f.z + dz, round ? 0 : -0.45, f.yaw, 0);
    if (round) {
      const bez = new THREE.TorusGeometry(hlW / 2, 0.018, 6, 20); place('chrome', bez);
      const lensG = new THREE.SphereGeometry(hlW / 2 * 0.95, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2); lensG.rotateX(Math.PI / 2); lensG.scale(1, 1, 0.35); place('head', lensG);
    } else {
      const sh = rrect(hlW, hlH, hlH * 0.45, sx * -0.05 * 0); const hous = slab(sh, 0.05, 0.008); hous.translate(0, 0, -0.05); place('housing', hous);
      const lensG = slab(rrect(hlW + 0.012, hlH + 0.012, hlH * 0.45), 0.012, 0.004); lensG.translate(0, 0, 0.002); place('lens', lensG);
      // projector lenses + DRL signature
      for (const px of [-0.25, 0.12]) { const pj = new THREE.CylinderGeometry(hlH * 0.2, hlH * 0.24, 0.03, 14); pj.rotateX(Math.PI / 2); pj.translate(px * hlW * sx * -1, -hlH * 0.05, 0); place('head', pj); }
      const drl = slab(rrect(hlW * 0.9, 0.022, 0.01), 0.01, 0); drl.translate(0, hlH * 0.34, 0.004); place('head', drl);
      const ind = slab(rrect(hlW * 0.22, 0.03, 0.01), 0.008, 0); ind.translate(sx * -hlW * 0.36 * -1, -hlH * 0.3, 0.004); place('ind', ind);
    }
  }
  // tail-light clusters wrapping the rear corners
  const tlY = tailTop - (slim ? 0.07 : 0.1), tlH = car.id === 'gti8' ? .18 : round ? 0.14 : slim ? 0.07 : 0.11, tlW = car.id === 'gti8' ? .32 : round ? 0.16 : 0.38;
  const bar = car.body === 'fastback' || car.body === 'hyper' || /rsgt|tgt|emeya|i5n|ev6gt|911ts/.test(car.id);
  for (const sx of [-1, 1]) {
    const x = Math.min(S.plan(1) * (round ? 0.8 : 1.02), Wm / 2 * 0.76);
    const f = face(false, sx * x, tlY, 0);
    const place = (list, g, dx = 0, dy = 0) => { g.translate(dx, dy, 0); return put(list, g, f.x, f.y, f.z, 0.05, f.yaw, 0); };
    place('housing', slab(rrect(tlW, tlH, tlH * 0.3), 0.03, 0.006), 0, 0);
    place('tail', slab(rrect(tlW * 0.94, tlH * 0.3, tlH * 0.14), 0.036, 0.003), 0, tlH * 0.22);
    place('red', slab(rrect(tlW * 0.94, tlH * 0.5, tlH * 0.14), 0.034, 0.003), 0, -tlH * 0.18);
    place('rev', slab(rrect(tlW * 0.24, tlH * 0.26, 0.01), 0.038, 0), -sx * tlW * 0.28, -tlH * 0.22);
    place('ind', slab(rrect(tlW * 0.22, tlH * 0.26, 0.01), 0.038, 0), sx * tlW * 0.3, -tlH * 0.22);
    // side repeater / marker on the front wing
    const zs = zF + S.ra + 0.12; const o = info.reduce((b, q) => Math.abs(q.z - zs) < Math.abs(b.z - zs) ? q : b, info[0]);
    const rep = slab(rrect(0.07, 0.025, 0.012), 0.006, 0); put('ind', rep, sx * (o.hw * 0.995), o.belt - 0.08, zs, 0, sx * Math.PI / 2, 0);
  }
  if (bar) { const w = S.plan(1) * 1.6, y = tlY + tlH * 0.22; put('tail', slab(rrect(w, 0.022, 0.01), 0.02, 0), 0, y, zT + rkR(y) + 0.004); }
  // centre high-level brake light
  if (!S.conv) { const i = S.iC; const o = info[Math.max(0, i - 1)]; put('tail', slab(rrect(0.34, 0.022, 0.01), 0.01, 0), 0, Hm - 0.03 - (A.C - A.C2 > 0.12 ? 0.03 : 0), -Lm / 2 + A.C2 * Lm + 0.1, -0.3, 0, 0); }
  else put('tail', slab(rrect(0.3, 0.02, 0.01), 0.01, 0), 0, tailTop + 0.012, zT - 0.12, -Math.PI / 2 + 0.2, 0, 0);

  // --- grille, intakes, splitter, badge, plates
  const ev = car.asp === 'EV';
  const gk = ev ? 'none' : car.id === 'gti8' ? 'mesh' : car.classic ? 'bars' : /hurac|avent|urus|f458|f488|f8t|r8/.test(car.id) ? 'hex' : car.id === 'db9v' ? 'slats' : /rs3|rs6|rsq8|rs8x|vz5|leonvz/.test(car.id) ? 'hex' : 'mesh';
  const faceH = noseTop - (S.clr + 0.05);
  const gMat = new THREE.MeshStandardMaterial({ map: grilleTex(gk === 'none' ? 'mesh' : gk), roughness: 0.45, metalness: 0.5 });
  const kidney = /m2|m3c|m4c|m5c|x5m|i4m50/.test(car.id);
  const plateY = S.clr + 0.05 + faceH * 0.3;
  if (gk !== 'none') {
    const gw = car.id === 'db9v' ? Wm * 0.36 : kidney ? Wm * 0.2 : /mid|hyper/.test(car.body) ? Wm * 0.5 : Wm * (car.classic ? 0.5 : 0.44);
    const ghh = /mid|hyper/.test(car.body) ? faceH * 0.3 : kidney ? faceH * 0.42 : /suv|offroad/.test(car.body) ? faceH * 0.45 : faceH * 0.34;
    const gy = /mid|hyper/.test(car.body) ? S.clr + 0.05 + faceH * 0.3 : noseTop - ghh / 2 - 0.05;
    for (const gx of kidney ? [-gw * 0.56, gw * 0.56] : [0]) {
      const shp = car.id === 'db9v' ? rrect(gw, ghh, ghh * 0.48) : rrect(gw, ghh, kidney ? ghh * 0.3 : 0.05);
      const g = new THREE.ShapeGeometry(shp, 6); const uv = g.attributes.uv; const p = g.attributes.position; for (let q = 0; q < p.count; q++) uv.setXY(q, p.getX(q) / gw + 0.5, p.getY(q) / ghh + 0.5);
      put('grille', g, gx, gy, zN + rkF(gy) - 0.006, 0, Math.PI, 0);
      const fr = slab(rrect(gw + 0.03, ghh + 0.03, (car.id === 'db9v' ? ghh * 0.48 : 0.05) + 0.015), 0.012, 0.006); put(car.classic || kidney || car.id === 'db9v' ? 'chrome' : 'gloss', fr, gx, gy, zN + rkF(gy) + 0.004, 0, Math.PI, 0);
    }
    if (!kidney) { /* frame drawn above; the frame is a solid slab behind the grille mesh */ }
  } else { // EV: smooth nose with a slim black sensor panel
    put('gloss', slab(rrect(Wm * 0.36, faceH * 0.12, 0.03), 0.008, 0.004), 0, noseTop - faceH * 0.3, zN + rkF(noseTop - faceH * 0.3) - 0.002, 0, Math.PI, 0);
  }
  if (car.id === 'gti8') { // Classic GTI red grille edge, black bumpers; no modern LED light bar.
    put('trim', slab(rrect(Wm * .86, .28, .018), .022, .003), 0, hlY, zN + rkF(hlY) + .014, 0, Math.PI, 0);
    for (let i = -2; i <= 2; i++) put('gloss', new THREE.BoxGeometry(Wm * .48, .012, .014), 0, hlY + i * .037, zN + rkF(hlY) - .02);
    const y = noseTop - 0.045, w = Wm * 0.8; put('red', slab(rrect(w, 0.012, 0.004), 0.006, 0), 0, y - 0.03, zN + rkF(y - 0.03) - 0.012, 0, Math.PI, 0);
    for (const rear of [false, true]) {
      const by = S.clr + .30;
      put('trim', slab(rrect(Wm * .91, .14, .025), .065, .006), 0, by,
        rear ? zT + rkR(by) + .025 : zN + rkF(by) - .025, 0, rear ? 0 : Math.PI, 0);
    }
    const gm = new THREE.MeshStandardMaterial({ map: gtiTex(), transparent: true, alphaTest: 0.3, metalness: 0.6, roughness: 0.3 }); const gp = new THREE.PlaneGeometry(0.14, 0.035);
    const f = new THREE.Mesh(gp, gm); const fy = noseTop - faceH * 0.3; f.position.set(-Wm * 0.15, fy, zN + rkF(fy) - 0.016); f.rotation.y = Math.PI; bodyG.add(f);
    const r = new THREE.Mesh(gp, gm); const ry = tlY - 0.06; r.position.set(Wm * 0.2, ry, zT + rkR(ry) + 0.014); bodyG.add(r);
  }
  // lower intake + splitter
  const gti = car.id === 'gti8'; // Mk8 GTI: wide honeycomb lower intake across the bumper
  const liW = Wm * (/mid|hyper/.test(car.body) ? 0.3 : gti ? 0.46 : 0.52), liH = faceH * (/mid|hyper/.test(car.body) ? 0.22 : gti ? 0.13 : 0.16);
  { const g = new THREE.ShapeGeometry(rrect(liW, liH, liH * 0.3), 4); const uv = g.attributes.uv; const p = g.attributes.position; for (let q = 0; q < p.count; q++) uv.setXY(q, p.getX(q) / liW + 0.5, p.getY(q) / liH * 0.5 + 0.5); put('grille', g, 0, S.clr + 0.05 + liH * 0.6, zN + rkF(S.clr + 0.05 + liH * 0.6) - 0.006, 0, Math.PI, 0); }
  if (/mid|hyper/.test(car.body)) for (const sx of [-1, 1]) { const g = new THREE.ShapeGeometry(rrect(Wm * 0.18, faceH * 0.34, 0.03), 4); put('grille', g, sx * Wm * 0.3, S.clr + 0.05 + faceH * 0.3, zN + 0.02, 0, Math.PI + sx * 0.3, 0); }
  { const g = new THREE.BoxGeometry(Wm * 0.84, 0.022, 0.1, 8, 1, 1); const p = g.attributes.position; // splitter: its front edge follows the rounded nose in plan (a straight full-width blade stuck out at the corners)
    for (let q = 0; q < p.count; q++) { const ax = Math.abs(p.getX(q)) / (Wm * 0.42); p.setZ(q, p.getZ(q) + 0.34 * ax ** 2.2 * (p.getZ(q) < 0 ? 1 : 0.6)); p.setX(q, p.getX(q) * (1 - 0.12 * ax ** 2)); } g.computeVertexNormals(); put(/mid|hyper/.test(car.body) || car.spoiler === 'wing' ? 'gloss' : 'trim', g, 0, S.clr + 0.055, zN + 0.06); }
  // plates
  const plate = (opts.plate || 'CUZZY').slice(0, 8).toUpperCase();
  const pfM = new THREE.MeshPhysicalMaterial({ map: plateTex(plate, false), roughness: 0.45, clearcoat: 1, clearcoatRoughness: 0.04 }), prM = new THREE.MeshPhysicalMaterial({ map: plateTex(plate, true), roughness: 0.45, clearcoat: 1, clearcoatRoughness: 0.04 }); // glossy acrylic plates
  const plateG = new THREE.PlaneGeometry(0.52, 0.113);
  const pfY = gk !== 'none' && !/mid|hyper/.test(car.body) ? S.clr + 0.05 + liH * 1.4 + 0.07 : plateY;
  { const y = Math.min(pfY, noseTop - 0.12); const m = new THREE.Mesh(plateG, pfM); m.position.set(0, y, zN + rkF(y) - 0.012); m.rotation.y = Math.PI; bodyG.add(m); const bk = new THREE.BoxGeometry(0.54, 0.125, 0.01); put('trim', bk, 0, y, zN + rkF(y) - 0.006); }
  const rearFaceH = tailTop - (S.clr + 0.14);
  const prY = S.clr + 0.14 + rearFaceH * (/hatch|estate|suv|crossover|boxy|classicmini/.test(car.body) ? 0.52 : 0.4);
  { const y = Math.min(prY, tlY - 0.14); const m = new THREE.Mesh(plateG, prM); m.position.set(0, y, zT + rkR(y) + 0.012); bodyG.add(m); const rec = new THREE.BoxGeometry(0.56, 0.14, 0.012); put('trim', rec, 0, y, zT + rkR(y) + 0.004); }
  // badges
  const bdM = new THREE.MeshStandardMaterial({ map: badgeTex(car.brand[0]), metalness: 0.8, roughness: 0.2 });
  { const bd = new THREE.Mesh(new THREE.CircleGeometry(0.042, 20), bdM); { const by = gk !== 'none' && !kidney && car.id !== 'db9v' ? noseTop - faceH * 0.2 : noseTop - 0.015; bd.position.set(0, by, zN + rkF(by) - 0.016); } bd.rotation.y = Math.PI; if (car.id === 'db9v' || kidney || gk === 'none') { bd.position.z = zN + 0.12; bd.position.y = noseTop + 0.01; bd.rotation.x = -Math.PI / 2 + 0.35; bd.rotation.y = 0; } bodyG.add(bd);
    const bd2 = new THREE.Mesh(bd.geometry, bdM); { const by = Math.min(tailTop - 0.05, tlY + 0.02); bd2.position.set(0, by, zT + rkR(by) + 0.012); } bodyG.add(bd2); }
  // rear diffuser + exhaust tips
  { const g = slab(rrect(Wm * 0.74, 0.085, 0.03), 0.03, 0.008); put('trim', g, 0, S.clr + 0.135, zT - 0.02); }
  root.userData.exhausts = [];
  if (!ev) {
    const n = /V8|V10|V12|I6|V6|F6|I5/.test(car.engine) ? 4 : car.classic ? 1 : 2;
    const centre = /rs2|ctr|gry|minis|jcw|leonvz|f458|f488|911ts/.test(car.id);
    const xs = n === 4 ? (centre ? [-0.16, -0.06, 0.06, 0.16] : [-0.68, -0.56, 0.56, 0.68]) : n === 2 ? (centre ? [-0.09, 0.09] : [-0.6, 0.6]) : [0.55];
    const tipR = car.classic ? 0.028 : n === 4 ? 0.042 : 0.048;
    for (const f of xs) {
      const x = centre ? f : f * Wm / 2; const y = S.clr + 0.15;
      if (car.side_exhaust) { for (const sx of [-1, 1]) { const g = new THREE.CylinderGeometry(tipR, tipR, 0.1, 14, 1, true); g.rotateZ(Math.PI / 2); put('exhaust', g, sx * (Wm / 2 + 0.02), S.clr + 0.12, zR - S.ra - 0.12 - Math.abs(f) * 0.1); } continue; }
      const g = new THREE.CylinderGeometry(tipR, tipR * 1.05, 0.14, 16, 1, true); g.rotateX(Math.PI / 2); put('exhaust', g, x, y, zT - 0.035);
      const lipG = new THREE.TorusGeometry(tipR, 0.006, 5, 16); put('exhaust', lipG, x, y, zT + 0.035);
      const inner = new THREE.CircleGeometry(tipR * 0.9, 14); put('exIn', inner, x, y, zT + 0.0);
      root.userData.exhausts.push(new THREE.Vector3(x, y, zT + 0.04));
    }
  }
  // spoilers
  if (car.spoiler) {
    const sy = tailTop, sz = zT - 0.25;
    if (car.spoiler === 'whale' || car.spoiler === 'tray') {
      const w = slab(rrect(Wm * 0.82, car.spoiler === 'tray' ? 0.34 : 0.28, 0.06), 0.04, 0.01); w.rotateX(-Math.PI / 2); w.translate(0, sy + (car.spoiler === 'whale' ? 0.28 : 0.16), sz); P.paint.push(w);
      for (const sx of [-1, 1]) { const st = new THREE.BoxGeometry(0.05, car.spoiler === 'whale' ? 0.3 : 0.18, 0.2); st.translate(sx * Wm * 0.36, sy + (car.spoiler === 'whale' ? 0.15 : 0.09), sz); P.paint.push(st); }
    } else if (car.spoiler === 'wing') {
      const w = slab(rrect(Wm * 0.84, 0.24, 0.05), 0.025, 0.008); w.rotateX(-Math.PI / 2 - 0.08); w.translate(0, sy + 0.24, sz + 0.1); P[car.id === 'ctr' ? 'gloss' : 'trim'].push(w);
      for (const sx of [-1, 1]) { const st = new THREE.BoxGeometry(0.025, 0.24, 0.14); st.translate(sx * Wm * 0.3, sy + 0.12, sz + 0.1); P.gloss.push(st); }
    } else { const w = slab(rrect(Wm * 0.7, 0.1, 0.03), 0.02, 0.006); w.rotateX(-Math.PI / 2 + 0.2); w.translate(0, sy + 0.02, zT - 0.08); P.gloss.push(w); }
  }
  if (!S.conv && /hatch/.test(car.body) && !car.classic && S.gh) { // roof spoiler over the tailgate
    const sC2 = A.C2; const oz = -Lm / 2 + sC2 * Lm; const w = S.plan(sC2) * 1.42;
    const lip = slab(rrect(w, 0.16, 0.05), 0.02, 0.008); lip.rotateX(-Math.PI / 2 + 0.1); lip.translate(0, Hm - 0.05, oz); P[car.id === 'gti8' ? 'gloss' : 'paint'].push(lip); // Golf GTI: gloss-black roof spoiler
  }
  // door mirrors: rounded housing on a stalk, glass facing back
  { const sM = S.A.A + 0.035; const o = info.reduce((b, q) => Math.abs(q.s - sM) < Math.abs(b.s - sM) ? q : b, info[0]);
    for (const sx of [-1, 1]) {
      const x = sx * (o.hw + 0.1), y = o.belt + 0.07, z = o.z + 0.06;
      const hous = new THREE.SphereGeometry(0.1, 14, 8); hous.scale(1, 0.55, 0.62); P.paint.push(hous.translate(x, y, z));
      const face = new THREE.CircleGeometry(0.085, 14); face.scale(1, 0.5, 1); P.chrome.push(face.translate(x, y, z + 0.055));
      const st = new THREE.BoxGeometry(0.12, 0.035, 0.07); st.translate(sx * (o.hw + 0.02), o.belt + 0.035, z + 0.02); P.gloss.push(st);
    }
  }

  // --- interior (visible through the glass / open top)
  const interior = new THREE.Group(); bodyG.add(interior);
  const cabinZ = -Lm / 2 + (A.A + 0.08) * Lm; const floorY = S.clr + (/mid|hyper|roadster|rear|coupe|gt/.test(car.body) ? 0.1 : 0.16);
  const ss = clamp((Hm * (S.conv ? 0.96 : 0.93) - floorY) / 1.02, 0.55, 1); // seat scale so headrests stay under the roof
  const oA = info[S.iA]; const cab = oA.belt;
  const drvX = Wm * 0.22; // right-hand drive (UK)
  const I = { seat: [], dash: [], chrome: [] };
  const seat = (x, z, s = 1) => {
    const base = slab(rrect(0.5 * s, 0.5 * s, 0.1), 0.13, 0.03); base.rotateX(-Math.PI / 2); base.translate(x, floorY + 0.12, z + 0.25 * s); I.seat.push(base);
    const back = slab(rrect(0.48 * s, 0.62 * s, 0.14, 0), 0.1, 0.03); back.rotateX(0.2); back.translate(x, floorY + 0.5 * s, z + 0.52 * s); I.seat.push(back);
    const head = slab(rrect(0.26 * s, 0.16 * s, 0.06), 0.08, 0.02); head.rotateX(0.2); head.translate(x, floorY + 0.9 * s, z + 0.6 * s); I.seat.push(head);
  };
  for (const sx of [1, -1]) seat(sx * drvX, cabinZ + 0.38, ss);
  if (!/mid|hyper|roadster/.test(car.body)) { if (S.conv) for (const sx of [1, -1]) seat(sx * drvX * 0.85, cabinZ + 1.2, ss * 0.7); else { const rb = slab(rrect(Wm * 0.74, 0.42, 0.1), 0.45, 0.04); rb.translate(0, floorY + 0.25, cabinZ + 1.3); I.seat.push(rb); } }
  { const dsh = slab(rrect(Wm * 0.84, 0.24, 0.08), 0.42, 0.03); dsh.translate(0, cab - 0.06, cabinZ - 0.26); I.dash.push(dsh);
    const cons = slab(rrect(0.22, 0.22, 0.05), 0.8, 0.02); cons.translate(0, floorY + 0.06, cabinZ + 0.05); I.dash.push(cons);
  }
  const iSeat = mergeList(I.seat), iDash = mergeList(I.dash);
  if (iSeat) interior.add(new THREE.Mesh(iSeat, car.id === 'db9v' ? M.cream : M.seat)); if (iDash) interior.add(new THREE.Mesh(iDash, M.dash));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.14), new THREE.MeshBasicMaterial({ color: car.asp === 'EV' ? 0x2f6fb0 : 0x203040 })); screen.position.set(0, cab + 0.08, cabinZ - 0.02); screen.rotation.x = -0.3; screen.rotation.y = Math.PI; interior.add(screen);
  const sw = new THREE.Group(); sw.position.set(drvX, cab + 0.0, cabinZ + 0.2); sw.rotation.x = -0.35; interior.add(sw);
  const rimW = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.022, 8, 24), M.dash); sw.add(rimW);
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.02), M.dash); sw.add(spoke);
  const hubM = new THREE.Mesh(new THREE.CircleGeometry(0.05, 14), M.carbon); hubM.position.z = -0.01; hubM.rotation.y = Math.PI; sw.add(hubM);
  root.userData.steeringWheel = sw;
  root.userData.cockpit = new THREE.Vector3(drvX, floorY + 0.8, cabinZ + 0.62); // driver's eye
  root.userData.bonnetCam = new THREE.Vector3(0, info[Math.round(NS * 0.25)].deck + 0.25, -Lm / 2 + A.A * Lm * 0.6);
  root.userData.interior = interior; interior.visible = detail > 0;
  root.userData.dims = { L: Lm, W: Wm, H: Hm, R, zF, zR };
  root.updateMatrixWorld(true); fitInCarCams(root);

  // --- merge static parts per material
  const MAT = { paint, trim: M.trim, gloss: M.gloss, chrome: M.chrome, liner: M.liner, under: M.under, housing: M.housing, lens: M.lens, red: M.redLens, head: headMat, tail: tailMat, ind: indMat, rev: revMat, exhaust: M.exhaust, exIn: M.exhaustIn, grille: gMat };
  for (const [k, list] of Object.entries(P)) { if (!MAT[k] || !list.length) continue; const g = mergeList(list); const m = add(g, MAT[k], bodyG, !/lens|liner|exIn|grille/.test(k)); if (k === 'lens') m.renderOrder = 3; }

  // wheels
  const WG = wheelGeos(R, width, wheelStyle, detail);
  const rimMat = new THREE.MeshPhysicalMaterial({ color: wheelStyle === 'black' ? 0x0d0e0f : opts.wheelColour ?? (car.classic ? 0xc4c8cc : 0xc9ccd0), metalness: wheelStyle === 'black' ? 0.3 : 1, roughness: wheelStyle === 'black' ? 0.3 : 0.2, clearcoat: 1, clearcoatRoughness: 0.05, envMap: ENV }); // lacquered alloy
  const calMat = new THREE.MeshPhysicalMaterial({ color: opts.caliper ?? car.caliper ?? (car.pi > 800 ? 0xd4a017 : car.pi > 700 ? 0xc8102e : 0x333333), roughness: 0.38, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08 });
  const capMat = new THREE.MeshStandardMaterial({ map: badgeTex(car.brand[0]), metalness: 0.7, roughness: 0.3 });
  const wheels = [];
  for (const [zc, front] of [[zF, true], [zR, false]]) for (const sx of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(sx * trackHalf(zc), R, zc); root.add(pivot);
    const spin = new THREE.Group(); pivot.add(spin);
    const flip = sx < 0 ? -1 : 1;
    const t = new THREE.Mesh(WG.tyre, detail > 0 ? M.rubber : M.rubberLo); t.castShadow = true; spin.add(t);
    const rm = new THREE.Mesh(WG.rim, rimMat); rm.scale.x = flip; spin.add(rm);
    const cp = new THREE.Mesh(WG.cap, capMat); cp.scale.x = flip; spin.add(cp);
    const d = new THREE.Mesh(WG.disc, M.disc); d.scale.x = flip; spin.add(d);
    const c = new THREE.Mesh(WG.cal, calMat); c.scale.x = flip; pivot.add(c); // caliper does not spin
    wheels.push({ pivot, spin, front, side: sx, baseY: R });
  }
  root.userData.wheels = wheels; root.userData.body = bodyG; root.userData.lights = L; root.userData.paint = paint;
  root.userData.dims = { L: Lm, W: Wm, H: Hm, R, zF, zR };
  // soft contact shadow (ambient occlusion under the car) — grounds the car even when shadow maps are off
  const blob = contactShadow(Wm, Lm, wheels.map(w => [w.pivot.position.x, w.pivot.position.z]), R); root.add(blob); root.userData.blob = blob; void SHADOW_TEX; // body AO + tyre contact patches
  root.userData.rubberMats = [M.rubber, M.rubberLo]; attachCarFx(root, [paint, roofMat]);
  root.userData.rimMat = rimMat; root.userData.calMat = calMat; root.userData.glassMesh = glassMat;
  return root;
}

// free a car that is no longer shown (showroom browsing, menu hero, session car, remote players). Geometry that is
// shared through caches is only released from the GPU (three.js re-uploads it if it is drawn again); textures are kept.
export function disposeCar(obj) {
  if (!obj) return; obj.parent?.remove(obj);
  obj.traverse(o => { if (!o.isMesh) return; o.geometry?.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m) PAINT_MATS.delete(m); });
}
// triangle count of a built car (for perf budgets / tests)
export function carTriangles(obj) { let n = 0; obj.traverse(o => { if (o.isMesh) { const g = o.geometry; n += (g.index ? g.index.count : g.attributes.position.count) / 3; } }); return Math.round(n); }

// light states: {head:0..1, brake:0/1, rev:0/1, left:0/1, right:0/1, blink:bool}
export function setLights(obj, st, night) {
  const L = obj.userData.lights; if (!L) return;
  L.head.emissiveIntensity = st.head ? (night ? 3.2 : 1.2) : 0.15;
  L.tail.emissiveIntensity = (st.brake ? 5 : 0) + (st.head ? 0.9 : 0.25); // LED brake lamps: bright pop (bloom on high)
  const A = globalThis.CUZZY; carWeather(obj, !!(A && A.session && A.gfx && A.gfx.rainOn)); // wet sheen / rain beads / grime
  L.rev.emissiveIntensity = st.rev ? 2.5 : 0;
  L.ind.emissiveIntensity = st.blink ? 3 : 0;
}

// per-frame visual pose: steering, wheel spin, suspension (pitch/roll from acceleration)
export function poseCar(obj, S, P, dt) {
  const u = obj.userData; if (!u.wheels) return;
  if (u._tm === undefined) { u._tm = null; obj.traverse(o => { if (o.userData.timeMachine) u._tm = { armed: true, burn: 0, flash: 0, q: [] }; }); }
  if (u._tm) { const now = performance.now(), d = Math.min(0.1, (now - (u._tm.t0 || now)) / 1000); u._tm.t0 = now; timeMachine(obj, u, S, d); }
  if (u._spm === undefined) { u._spm = null; obj.traverse(o => { if (o.userData.spm) u._spm = o.userData.spm; }); }
  if (u._spm) { const k = S.spmK || 0, e = k * k * (3 - 2 * k); for (const m of u._spm) { m.visible = k > 0.02; m.position.copy(m.userData.rest).addScaledVector(m.userData.out, 1 - e); if (m.userData.air) m.rotation.x = -1.1 * (S.airbrake || 0); }
    const b = S.boostK || 0; obj.traverse(o => { if (o.userData.boostFx) for (const f of o.userData.boostFx) { f.visible = b > 0.02; f.material.opacity = b * (0.6 + Math.random() * 0.4); f.scale.set(1, 0.7 + Math.random() * 0.5 * b, 1); } }); }
  if (u._scan === undefined) { u._scan = null; obj.traverse(o => { if (o.userData.scanner) u._scan = o.userData.scanner; }); }
  if (u._scan) { const L = u._scan, n = L.length, now = performance.now() / 1000, sd = Math.min(0.1, now - (u._scanT || now)); u._scanT = now; // KITT scanner: ~1.4 s sweep, eased at the ends,
    const ph = (now / 0.7) % 2, e = ph < 1 ? ph : 2 - ph, pos = (0.5 - 0.5 * Math.cos(Math.PI * e)) * (n - 1); // incandescent lamps that glow up fast and fade slowly
    for (let i = 0; i < n; i++) { const d = Math.abs(i - pos), on = Math.max(0, 1 - d) * 7; L[i].emissiveIntensity = Math.max(on, (L[i].emissiveIntensity || 0) * Math.exp(-sd * 7)); }
    L.draw && L.draw(); }
  const hk = Math.min(1, (S.hoverH || 0) / 1.2); // hover: wheels swing flat under the car (BTTF II)
  for (const w of u.wheels) {
    if (w.front) w.pivot.rotation.y = S.steer * (1 - hk);
    w.spin.rotation.x = -S.wheelRot;
    w.pivot.rotation.z = hk ? (w.pivot.position.x > 0 ? 1 : -1) * Math.PI / 2 * hk : 0;
    if (hk && !w.glow) { w.glow = new THREE.Mesh(new THREE.CircleGeometry(0.3, 20), new THREE.MeshBasicMaterial({ color: 0x9fe0ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); w.glow.rotation.x = Math.PI / 2; w.pivot.parent.add(w.glow); }
    if (w.glow) { w.glow.visible = hk > 0.05; w.glow.position.set(w.pivot.position.x, w.pivot.position.y - 0.12, w.pivot.position.z); w.glow.material.opacity = 0.75 * hk * (0.8 + 0.2 * Math.sin(performance.now() / 60)); }
  }
  if (u.swAxis) u.steeringWheel.quaternion.setFromAxisAngle(u.swAxis, S.steer * 7); else if (u.steeringWheel) u.steeringWheel.rotation.z = -S.steer * 7;
  const soft = P ? (P.classic ? 1.4 : P.h > 0.6 ? 1.5 : 1) * (1 - (P.up?.susp || 0) * 0.2) : 1;
  // body on springs (visual only): pitch / roll follow the physics load transfer through a damped spring (~1.5 Hz body
  // mode, damping ratio 0.55 → a small, quick overshoot like real dampers), ~2 deg/g pitch and ~3.5 deg/g roll
  // (SUVs / classics softer, suspension upgrades stiffer); nose dives under braking, squats under power
  const tp = Math.max(-0.045, Math.min(0.045, -S.ax * 0.0036 * soft));
  const tr = Math.max(-0.075, Math.min(0.075, S.ay * 0.0062 * soft));
  const w = 9.5 * (P && P.up ? 1 + (P.up.susp || 0) * 0.12 : 1), z = 0.55;
  let h = Math.min(0.1, dt || 0); const n = Math.max(1, Math.ceil(h / (1 / 60))); h /= n;
  for (let i = 0; i < n; i++) { // semi-implicit spring-damper integration, stable at any frame rate
    u.pv = (u.pv || 0) + (w * w * (tp - (u.pitch || 0)) - 2 * z * w * (u.pv || 0)) * h; u.pitch = (u.pitch || 0) + u.pv * h;
    u.rv = (u.rv || 0) + (w * w * (tr - (u.roll || 0)) - 2 * z * w * (u.rv || 0)) * h; u.roll = (u.roll || 0) + u.rv * h;
  }
  if (!Number.isFinite(u.pitch) || !Number.isFinite(u.roll)) { u.pitch = u.roll = u.pv = u.rv = 0; }
  u.body.rotation.x = -u.pitch; u.body.rotation.z = u.roll;
  u.body.position.y = -Math.abs(u.pitch) * 0.12 - Math.abs(u.roll) * 0.05; // body settles slightly as it dives / rolls
  obj.position.y += 0.095 /* tyres sat several cm into the road surface */; if (S.visLift) obj.position.y += S.visLift; // visual only: tyres onto the visible road where it is drawn above the drive surface
}

// BTTF time machine. 80-88 mph: blue electrical arcs crackle over the body, building with speed. 88 mph: white-blue
// implosion flash (and screen flash), the car vanishes for ~1.3 s while twin fire trails race on from the rear tyres and
// burn on the road (flickering flame tongues, then smoke), and it reappears with a second flash.
let fireMat = null, flameMat = null, smokeMat = null;
function grad(w, h, stops, vertical) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'), gr = vertical ? g.createLinearGradient(0, h, 0, 0) : g.createLinearGradient(0, 0, w, 0);
  for (const [o, col] of stops) gr.addColorStop(o, col); g.fillStyle = gr; g.fillRect(0, 0, w, h); if (vertical) { g.globalCompositeOperation = 'destination-in'; const r = g.createLinearGradient(0, 0, w, 0); r.addColorStop(0, 'rgba(0,0,0,0)'); r.addColorStop(0.5, 'rgba(0,0,0,1)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); }
  return new THREE.CanvasTexture(c); }
const addMat = (map, extra = {}) => new THREE.MeshBasicMaterial({ map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, ...extra });
function fireMaterial() { return fireMat ||= addMat(grad(16, 4, [[0, 'rgba(255,40,0,0)'], [0.3, 'rgba(255,120,10,1)'], [0.5, 'rgba(255,245,190,1)'], [0.7, 'rgba(255,120,10,1)'], [1, 'rgba(255,40,0,0)']])); }
function flameMaterial() { return flameMat ||= addMat(grad(16, 64, [[0, 'rgba(255,230,150,1)'], [0.35, 'rgba(255,110,10,0.9)'], [1, 'rgba(120,10,0,0)']], true)); }
function smokeMaterial() { return smokeMat ||= new THREE.MeshBasicMaterial({ map: grad(16, 64, [[0, 'rgba(60,60,60,0.5)'], [1, 'rgba(60,60,60,0)']], true), transparent: true, depthWrite: false, side: THREE.DoubleSide }); }
function screenFlash(k) { let d = document.getElementById('tmflash'); if (!d) { d = document.createElement('div'); d.id = 'tmflash'; d.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:50;background:radial-gradient(circle,#fff 0%,#bfe6ff 45%,rgba(120,190,255,0.0) 100%);opacity:0'; document.body.appendChild(d); } d.style.opacity = String(Math.max(0, Math.min(1, k))); }
function timeMachine(obj, u, S, dt) {
  const T = u._tm, mph = Math.abs(S.vx || 0) * 2.237, world = obj.parent; if (!world) return;
  const bb = T.bb || (T.bb = (() => { const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert(), B = new THREE.Box3(), b = new THREE.Box3(), sz = new THREE.Vector3(); // body panels only: skip light beams, shadows and other big helper meshes
    obj.traverse(o => { if (!o.isMesh || o.material?.transparent) return; b.setFromObject(o).applyMatrix4(inv); b.getSize(sz); if (sz.x < 2.6 && sz.z < 5.5 && sz.y < 2) B.union(b); }); return B.isEmpty() ? new THREE.Box3().setFromObject(obj).applyMatrix4(inv) : B; })());
  // arcs: jagged lines between random points on the body, more and brighter as the speed nears 88
  const charge = T.gone > 0 ? 0 : Math.max(0, Math.min(1, (mph - 78) / 10));
  // arcs: thick glowing bolts (two crossed ribbons each, white-hot core fading to blue) crawling over the skin, re-forked every frame
  if (!T.arcs) { T.arcs = []; const c = document.createElement('canvas'); c.width = 4; c.height = 64; const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, 'rgba(40,90,255,0)'); gr.addColorStop(0.3, 'rgba(90,160,255,0.35)'); gr.addColorStop(0.45, 'rgba(210,235,255,0.95)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(210,235,255,0.95)'); gr.addColorStop(0.7, 'rgba(90,160,255,0.35)'); gr.addColorStop(1, 'rgba(40,90,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 4, 64);
    const tex = new THREE.CanvasTexture(c), N = 17, idx = []; for (let s = 0; s < 2; s++) for (let j = 0; j < N - 1; j++) { const o = s * N * 2 + j * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
    const uv = new Float32Array(N * 4 * 2); for (let s = 0; s < 2; s++) for (let j = 0; j < N; j++) { const o = (s * N * 2 + j * 2) * 2; uv.set([j / (N - 1), 0, j / (N - 1), 1], o); }
    for (let i = 0; i < 9; i++) { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 4 * 3), 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(idx);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, color: 0xd8ecff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })); m.frustumCulled = false; m.visible = false; m.userData.pts = Array.from({ length: N }, () => new THREE.Vector3()); obj.add(m); T.arcs.push(m); } }
  const P = (near) => { const v = near ? near.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 1.2)) : new THREE.Vector3(bb.min.x + Math.random() * (bb.max.x - bb.min.x), bb.min.y + 0.25 + Math.random() * (bb.max.y - bb.min.y - 0.25), bb.min.z + Math.random() * (bb.max.z - bb.min.z));
    const f = Math.floor(Math.random() * 3); if (!near) { if (f === 0) v.x = Math.random() < 0.5 ? bb.min.x - 0.02 : bb.max.x + 0.02; else if (f === 1) v.y = bb.max.y + 0.02; else v.z = Math.random() < 0.5 ? bb.min.z - 0.02 : bb.max.z + 0.02; } // on the skin, not inside the car
    return v.clamp(bb.min, bb.max); };
  const _d = T._d || (T._d = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]);
  T.arcT = (T.arcT || 0) + dt; const refresh = T.arcT > 0.045; if (refresh) T.arcT = 0; // real discharges flicker ~20x a second and linger a frame or two, not a new random shape every frame
  T.arcs.forEach((m, i) => { if (!refresh) { if (m.visible) { m.material.opacity *= Math.pow(0.02, dt); if (charge <= 0) m.visible = false; } return; }
    const on = charge > 0 && Math.random() < 0.35 + charge * 0.6 && i < 2 + charge * 7; m.visible = on; if (!on) return; const pts = m.userData.pts, N = pts.length;
    const par = i >= 4 && T.arcs[i - 4].visible ? T.arcs[i - 4].userData.pts[3 + (i % 5)] : null, a = par ? par.clone() : P(), b = P(par ? a : null), len = a.distanceTo(b); // later bolts fork off earlier ones
    pts[0].copy(a); pts[N - 1].copy(b); // midpoint displacement: big kinks first, then finer and finer jags, like real lightning
    for (let st = N - 1; st > 1; st >>= 1) { const h = st >> 1, amp = len * 0.22 * (st / (N - 1)); for (let j = h; j < N - 1; j += st) pts[j].lerpVectors(pts[j - h], pts[j + h], 0.5).add(_d[0].set(Math.random() - 0.5, (Math.random() - 0.5) * 0.6, Math.random() - 0.5).multiplyScalar(amp)); }
    const pos = m.geometry.attributes.position, w = (par ? 0.035 : 0.06) * (0.7 + charge * 0.6);
    for (let j = 0; j < N; j++) { _d[0].subVectors(pts[Math.min(N - 1, j + 1)], pts[Math.max(0, j - 1)]).normalize(); _d[1].crossVectors(_d[0], _d[3]); if (_d[1].lengthSq() < 1e-4) _d[1].set(1, 0, 0); _d[1].normalize(); _d[2].crossVectors(_d[0], _d[1]).normalize();
      const p = pts[j], taper = 0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, 0.15 + j / (N - 1)));
      for (let s = 0; s < 2; s++) { const sd = s ? _d[2] : _d[1], o = s * N * 2 + j * 2; pos.setXYZ(o, p.x + sd.x * w * taper, p.y + sd.y * w * taper, p.z + sd.z * w * taper); pos.setXYZ(o + 1, p.x - sd.x * w * taper, p.y - sd.y * w * taper, p.z - sd.z * w * taper); } }
    pos.needsUpdate = true; m.material.opacity = 0.7 + Math.random() * 0.3; });
  if (!T.light) { T.light = new THREE.PointLight(0x9fd8ff, 0, 40); world.add(T.light);
    T.glow = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xdff3ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); T.glow.visible = false; world.add(T.glow); }
  if (!T.front) { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.12, 'rgba(200,235,255,0.9)'); r.addColorStop(0.4, 'rgba(80,150,255,0.35)'); r.addColorStop(1, 'rgba(0,40,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    
    T.front = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 })); T.front.position.set(0, (bb.min.y + bb.max.y) / 2, bb.min.z - 0.25); obj.add(T.front);
    { const c2 = document.createElement('canvas'); c2.width = 256; c2.height = 32; const g2 = c2.getContext('2d'); const gx = g2.createLinearGradient(0, 0, 256, 0); gx.addColorStop(0, 'rgba(120,180,255,0)'); gx.addColorStop(0.5, 'rgba(255,255,255,1)'); gx.addColorStop(1, 'rgba(120,180,255,0)');
      const gy = g2.createLinearGradient(0, 0, 0, 32); gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(0.5, 'rgba(0,0,0,1)'); gy.addColorStop(1, 'rgba(0,0,0,0)'); g2.fillStyle = gx; g2.fillRect(0, 0, 256, 32); g2.globalCompositeOperation = 'destination-in'; g2.fillStyle = gy; g2.fillRect(0, 0, 256, 32);
      T.streak = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, opacity: 0, toneMapped: false })); T.streak.position.copy(T.front.position); T.streak.renderOrder = 9; obj.add(T.streak); } // lens streak across the flash
    T.ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), new THREE.MeshBasicMaterial({ color: 0xbfe4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); T.ring.rotation.x = -Math.PI / 2; T.ring.visible = false; world.add(T.ring); }
  const fl = charge * (0.5 + Math.random() * 0.5); T.front.material.opacity = Math.min(1, fl * 1.2); T.front.scale.setScalar(0.4 + charge * 1.4 + Math.random() * 0.25); // the white-blue glow building ahead of the bonnet
  obj.getWorldPosition(T.light.position); T.light.position.y += 0.8; T.light.intensity = charge * (4 + Math.random() * 10);
  if (T.armed && mph >= 88) { T.armed = false; T.burn = 1.6; T.flash = 0.7; T.gone = 1.5; T.pre = 0.16; obj.getWorldPosition(T.ring.position); T.ring.position.y = (obj.position.y || 0) - (S.hoverH || 0) + 0.05; T.ringT = 0.9; }
  if (T.pre > 0) { T.pre -= dt; const k = Math.max(0, T.pre / 0.16); obj.scale.set(1 - (1 - k) * 0.5, 1 - (1 - k) * 0.3, 1 + (1 - k) * 1.4); if (T.pre <= 0) obj.scale.set(1, 1, 1); } // implosion: the car stretches into the light as it goes
  if (T.ringT > 0) { T.ringT -= dt; const k = 1 - T.ringT / 0.9; T.ring.visible = false; T.ring.scale.setScalar(0.5 + k * 9); T.ring.material.opacity = 0.8 * (1 - k); }
  if (!T.armed && mph < 70 && T.burn <= 0 && !(T.gone > 0)) T.armed = true;
  if (T.flash > 0) { T.flash -= dt; const k0 = Math.max(0, T.flash / 0.7), k = k0 * (0.35 + 0.65 * Math.abs(Math.cos(k0 * Math.PI * 3))); /* three staccato flashes, as in the film */ T.light.intensity = 120 * k; T.glow.position.copy(T.light.position); T.glow.visible = false; T.front.material.opacity = Math.min(1, k * 1.3); T.front.scale.setScalar(2.2 + (1 - k0) * 5); if (T.streak) { T.streak.material.opacity = Math.min(1, k * 1.4); T.streak.scale.set(6 + (1 - k0) * 22, 0.35 + k * 0.5, 1); } /* soft light burst, no hard-edged ball */ screenFlash(k * 0.55); }
  else { if (T.glow?.visible) { T.glow.visible = false; screenFlash(0); } if (T.streak && T.streak.material.opacity) T.streak.material.opacity = 0; }
  if (T.gone > 0) { T.gone -= dt; const hide = T.gone > 0; obj.traverse(o => { if (o.isMesh && o !== T.glow) o.visible = o.userData._tmv ?? (o.userData._tmv = o.visible), o.visible = hide ? false : o.userData._tmv; });
    if (!hide) { T.flash = 0.45; T.frost = 3.5; obj.scale.set(1, 1, 1); obj.traverse(o => { if (o.isMesh) delete o.userData._tmv; }); } }
  if (T.frost > 0) { T.frost -= dt; const k = Math.max(0, T.frost / 3.5); const seen = new Set(); obj.traverse(o => { const M = o.isMesh && o.material; if (!M?.emissive || seen.has(M)) return; seen.add(M); const ud = M.userData; if (!ud._tmE) ud._tmE = M.emissive.clone(); M.emissive.copy(ud._tmE).lerp(T.ice ||= new THREE.Color(0x8fb2c8), k * 0.28); if (k <= 0.001) { M.emissive.copy(ud._tmE); delete ud._tmE; } }); // back from the time jump: frosted over, steaming
    if (Math.random() < 0.6 * k) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), smokeMaterial().clone()); m.material.color.set(0xe8f4ff); const p = new THREE.Vector3((Math.random() - 0.5) * (bb.max.x - bb.min.x), bb.max.y - 0.1, bb.min.z + Math.random() * (bb.max.z - bb.min.z)); obj.localToWorld(p); m.position.copy(p); m.userData.life = m.userData.max = 1.6; m.userData.flame = 1; m.userData.smoke = 1; m.lookAt(p.x, p.y + 1, p.z + 1); world.add(m); T.q.push(m); } }
  // fire trails: GPU flames, smoke, burning fuel lines and scorch marks (bttf_fx.js)
  if (T.burn > 0 || T.fx) { const fx = T.fx || (T.fx = fireFX(world));
    if (T.burn > 0) { T.burn -= dt; const q = obj.getWorldQuaternion(T._q || (T._q = new THREE.Quaternion())), r = (T._r || (T._r = new THREE.Vector3())).set(1, 0, 0).applyQuaternion(q); let wi = 0;
      for (const w of u.wheels) { if (w.front) continue; const p = (T._p || (T._p = new THREE.Vector3())); w.pivot.getWorldPosition(p); const ry = (obj.position.y || 0) + 0.095 + (S.visLift || 0) - (S.hoverH || 0) - 0.03; /* the visible road surface (same offsets as the car pose below) */ /* the visible road surface under the car */ fx.addPoint(wi++ & 1, p.x, ry, p.z, r.x, r.z); } }
    fx.step(dt); }
}
