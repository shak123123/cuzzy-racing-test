// p53 "pro" car pipeline: a reusable, data-driven generator for high-quality procedural cars.
// A car opts in with  "pro": { ...spec }  in shared/cars.json; any field left out takes the defaults below (a modern
// fast estate). The pipeline builds:
//   - a smooth lofted body from side-profile / plan / tumblehome keys (monotone cubic splines, ~160 x 120 grid), wheel
//     arches cut cleanly round the tyres with blistered flares, real glass zones (windscreen, side, quarter, rear) and
//     black pillars, an inner trim shell so the body is never see-through from inside, and shut lines on the doors
//   - detail kit placed by ray-casting onto the body: matrix-LED headlights with DRL signature + indicators, grille mesh,
//     intakes, splitter, side skirts, diffuser, oval tips, full-width rear light bar (tail / brake / indicator / reverse),
//     roof rails + spoiler, mirrors, door handles, plates and original badges
//   - wheels (lettered tyres, big carbon-ceramic discs, calipers) on the game's pivot / spin contract
//   - a PBR interior (stitched leather, Alcantara, carbon twill, brushed aluminium, piano black, soft-touch grain, AO
//     tint) with sculpted dash, binnacle, vents with slats, console, seats, door cards, wheel, pedals, rear bench
// Everything returned follows buildCar()'s userData contract, so physics / AI / net / VR / showroom need no changes.
import * as THREE from 'three';
import { mergeGeometries } from './lib/addons/utils/BufferGeometryUtils.js';
import { carPaint, carGlass, contactShadow, attachCarFx } from './realcars.js';

export const PRO_DEFAULT = {
  L: 4.995, W: 1.99, H: 1.45, WB: 2.928, fo: 1.0, R: 0.366, tyreW: 0.285, track: 1.668, drvX: 0.38,
  sill: [[-2.5, 0.27], [-2.38, 0.19], [-2.0, 0.15], [2.05, 0.16], [2.36, 0.2], [2.5, 0.25]],
  belt: [[-2.5, 0.58], [-2.4, 0.665], [-2.05, 0.75], [-1.2, 0.83], [-0.62, 0.925], [0.6, 0.965], [1.9, 0.99], [2.38, 0.98], [2.5, 0.9]],
  roof: [[-0.62, 0.925], [-0.3, 1.13], [0.0, 1.32], [0.3, 1.425], [0.9, 1.455], [1.6, 1.43], [1.98, 1.385], [2.2, 1.24], [2.4, 1.0]],
  ws: [-0.6, 0.27], rw: [2.02, 2.36], side: [0.02, 2.0], bp: [0.6, 0.7], cp: [1.48, 1.56], noseLean: 0.26, tailLean: 0.14,
  nf: 2.2, nr: 4.2, zc0: -1.42, zc1: 1.7, flareF: 0.045, flareR: 0.058, tumble: 0.115, roofW: 0.66,
  wheelStyle: 'y', rim: 0x8a9098, caliper: 0xc8102e, badge: 'CUZZY', model: 'R6', plate: 'CU26 ZZY',
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function mono(keys) { const n = keys.length, x = keys.map(k => k[0]), y = keys.map(k => k[1]); const d = [], m = [];
  for (let i = 0; i < n - 1; i++) d.push((y[i + 1] - y[i]) / (x[i + 1] - x[i])); m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) { if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; } const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b; if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; } }
  return z => { if (z <= x[0]) return y[0]; if (z >= x[n - 1]) return y[n - 1]; let i = 0; while (z > x[i + 1]) i++; const h = x[i + 1] - x[i], t = (z - x[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * y[i + 1] + (t3 - t2) * h * m[i + 1]; }; }
const gauss = (z, c, w) => Math.exp(-(((z - c) / w) ** 2));

// ------------------------------------------------------------------ procedural PBR textures (cached)
const TX = {};
function cv(w, h, f) { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); return c; }
function tex(c, srgb, rep = 1) { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 4; return t; }
function heightToNormal(hc, k = 2) { const w = hc.width, h = hc.height, src = hc.getContext('2d').getImageData(0, 0, w, h).data; return cv(w, h, (g) => { const o = g.createImageData(w, h);
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const dx = (H(x + 1, y) - H(x - 1, y)) * k, dy = (H(x, y + 1) - H(x, y - 1)) * k; const l = Math.hypot(dx, dy, 1); const i = (y * w + x) * 4;
    o.data[i] = (-dx / l * 0.5 + 0.5) * 255; o.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; o.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; o.data[i + 3] = 255; } g.putImageData(o, 0, 0); }); }
function noiseC(w, cells, amp = 1, seed = 1) { let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647); return cv(w, w, (g) => { g.fillStyle = '#808080'; g.fillRect(0, 0, w, w);
  for (let i = 0; i < cells; i++) { const x = rnd() * w, y = rnd() * w, r = (0.5 + rnd()) * w / Math.sqrt(cells) * 0.9; const v = Math.round(128 + (rnd() - 0.5) * 120 * amp); g.fillStyle = `rgba(${v},${v},${v},0.5)`; g.beginPath(); g.ellipse(x, y, r, r * (0.6 + rnd() * 0.6), rnd() * 3, 0, 7); g.fill(); } }); }
export function proTex() { if (TX.leatherN) return TX;
  TX.leatherN = tex(heightToNormal(noiseC(256, 2600, 1, 7), 2.4), false, 6);
  TX.alcN = tex(heightToNormal(noiseC(256, 9000, 0.6, 3), 1.2), false, 10);
  TX.grainN = tex(heightToNormal(noiseC(256, 5000, 0.8, 11), 1.6), false, 8);
  TX.roughVar = tex(cv(256, 256, (g, w) => { g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, w, w); for (let i = 0; i < 400; i++) { const v = 120 + Math.random() * 90 | 0; g.fillStyle = `rgba(${v},${v},${v},.25)`; g.beginPath(); g.arc(Math.random() * w, Math.random() * w, 4 + Math.random() * 30, 0, 7); g.fill(); } }), false, 2);
  TX.quiltN = tex(heightToNormal(cv(256, 256, (g, w) => { g.fillStyle = '#c0c0c0'; g.fillRect(0, 0, w, w); g.strokeStyle = '#303030'; g.lineWidth = 7; for (let k = -w; k < 2 * w; k += 64) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + w, w); g.stroke(); g.beginPath(); g.moveTo(k, w); g.lineTo(k + w, 0); g.stroke(); } const n = noiseC(256, 2000, 0.5, 5); g.globalAlpha = 0.35; g.drawImage(n, 0, 0); }), 3), false, 3);
  TX.quiltC = tex(cv(256, 256, (g, w) => { g.fillStyle = '#1a1a1b'; g.fillRect(0, 0, w, w); g.strokeStyle = '#b01020'; g.lineWidth = 1.6; g.setLineDash([5, 4]); for (let k = -w; k < 2 * w; k += 64) for (const o of [-6, 6]) { g.beginPath(); g.moveTo(k + o, 0); g.lineTo(k + o + w, w); g.stroke(); g.beginPath(); g.moveTo(k + o, w); g.lineTo(k + o + w, 0); g.stroke(); } }), true, 3);
  TX.carbon = tex(cv(128, 128, (g, w) => { for (let y = 0; y < w; y += 8) for (let x = 0; x < w; x += 8) { const tw = ((x / 8 + y / 8) >> 1) & 1; const gr = g.createLinearGradient(x, y, tw ? x + 8 : x, tw ? y : y + 8); gr.addColorStop(0, '#0d0e10'); gr.addColorStop(0.5, '#3a3d42'); gr.addColorStop(1, '#0d0e10'); g.fillStyle = gr; g.fillRect(x, y, 8, 8); } }), true, 6);
  TX.brushed = tex(cv(256, 256, (g, w) => { g.fillStyle = '#9c9c9c'; g.fillRect(0, 0, w, w); for (let i = 0; i < 900; i++) { const v = 100 + Math.random() * 120 | 0; g.strokeStyle = `rgba(${v},${v},${v},.35)`; g.beginPath(); const y = Math.random() * w; g.moveTo(0, y); g.lineTo(w, y + (Math.random() - 0.5) * 2); g.stroke(); } }), false, 2);
  TX.honey = tex(cv(256, 256, (g, w) => { g.fillStyle = '#020203'; g.fillRect(0, 0, w, w); const r = 16, hh = r * Math.sqrt(3); g.lineWidth = 5; for (let y = -hh; y < w + hh; y += hh) for (let x = -r * 3, c = 0; x < w + r * 3; x += r * 1.5, c++) { const cy = y + (c & 1) * hh / 2; const gr = g.createLinearGradient(x, cy - hh / 2, x, cy + hh / 2); gr.addColorStop(0, '#5a5f66'); gr.addColorStop(1, '#16181b'); g.strokeStyle = gr; g.beginPath(); for (let k = 0; k < 7; k++) { const a = k * Math.PI / 3; g.lineTo(x + Math.cos(a) * r * 0.86, cy + Math.sin(a) * r * 0.86); } g.stroke(); } }), true, 3);
  TX.disc = tex(cv(256, 256, (g, w) => { const c = w / 2; const gr = g.createRadialGradient(c, c, 0, c, c, c); gr.addColorStop(0, '#555a60'); gr.addColorStop(0.55, '#3b3f44'); gr.addColorStop(1, '#2b2e32'); g.fillStyle = gr; g.fillRect(0, 0, w, w);
    for (let i = 0; i < 1500; i++) { const v = 40 + Math.random() * 50 | 0; g.fillStyle = `rgba(${v},${v + 3},${v + 6},.5)`; g.fillRect(Math.random() * w, Math.random() * w, 2, 2); }
    g.fillStyle = '#0c0d0e'; for (let k = 0; k < 3; k++) for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2 + k * 0.09, rr = c * (0.62 + k * 0.1); g.beginPath(); g.arc(c + Math.cos(a) * rr, c + Math.sin(a) * rr, 3.2, 0, 7); g.fill(); } }), true, 1);
  return TX; }
function textTex(t, o = {}) { const w = o.w || 512, h = o.h || 128; const c = cv(w, h, g => { if (o.bg) { g.fillStyle = o.bg; g.fillRect(0, 0, w, h); } g.font = `${o.weight || 800} ${o.size || 84}px ${o.font || 'system-ui,Arial'}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (o.chrome) { const gr = g.createLinearGradient(0, h * 0.2, 0, h * 0.8); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#8d939b'); gr.addColorStop(0.55, '#e9edf2'); gr.addColorStop(1, '#6d737b'); g.fillStyle = gr; } else g.fillStyle = o.col || '#fff';
  if (o.track) g.letterSpacing = o.track; g.fillText(t, w / 2, h / 2 + 4); }); return tex(c, true); }
function plateTex(txt, rear) { return tex(cv(520, 112, (g, w, h) => { g.fillStyle = rear ? '#f5c518' : '#f2f2ee'; g.fillRect(0, 0, w, h); g.fillStyle = '#1d4fb8'; g.fillRect(0, 0, 44, h); g.fillStyle = '#ffd200'; g.font = '700 22px Arial'; g.textAlign = 'center'; g.fillText('UK', 22, h - 16);
  g.fillStyle = '#111'; g.font = '700 82px "Charles Wright", Arial Narrow, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, w / 2 + 20, h / 2 + 4); }), true); }

// ------------------------------------------------------------------ body
function makeSpec(car) { const P = { ...PRO_DEFAULT, ...(car.pro || {}) }; P.zF = -P.L / 2 + P.fo; P.zR = P.zF + P.WB; P.Ra = P.R + 0.05;
  P.ys = mono(P.sill); P.yb = mono(P.belt); const yrK = mono(P.roof); P.yr = z => (z < P.roof[0][0] || z > P.roof[P.roof.length - 1][0]) ? -1 : yrK(z);
  const Wh = P.W / 2 - 0.052, se = (u, n) => Math.pow(Math.max(0, 1 - Math.pow(clamp(u, 0, 1), n)), 1 / n);
  P.wp = z => { let r = 1; if (z < P.zc0) r = se((P.zc0 - z) / (P.zc0 + P.L / 2), P.nf); else if (z > P.zc1) r = se((z - P.zc1) / (P.L / 2 - P.zc1), P.nr); return Wh * r; };
  P.flare = z => P.flareF * gauss(z, P.zF, 0.62) + P.flareR * gauss(z, P.zR, 0.7) - 0.008 * gauss(z, 0.3, 0.55);
  return P; }
// control polygon for one side (x >= 0) at z; returns [x, y] pairs + per-segment tags
function section(P, z) { const ys = P.ys(z), yb = P.yb(z), wp = P.wp(z), fl = P.flare(z) * clamp(wp / 0.5, 0, 1), w = wp + fl; let yr = P.yr(z); const gh = clamp((yr - yb) / 0.16, 0, 1); if (yr < yb) yr = yb;
  const hgt = Math.max(0.01, yb - ys);
  const lo = [[0, ys], [w * 0.9 - 0.06, ys], [w - 0.035, ys + 0.045], [w - 0.01, ys + Math.min(0.12, hgt * 0.3)], [w, ys + hgt * 0.5], [w + 0.008, ys + hgt * 0.8], [w - 0.05, yb]]; // p5 = tornado shoulder crease
  const wg = Math.max(0.02, w - 0.07 - P.tumble * 0.3), wr = Math.max(0.02, Math.min(w * P.roofW, w - P.tumble)), hh = yr - yb;
  const ghP = [[wg, yb + 0.012], [wg - (wg - wr) * 0.45, yb + hh * 0.55], [wr + 0.012, yb + hh * 0.93], [wr * 0.55, yr - 0.006], [0, yr]];
  const dome = 0.02 * gauss(z, -1.45, 0.55); const hoodP = [[w - 0.12, yb + 0.012], [w * 0.72, yb + 0.03], [w * 0.5, yb + 0.042 + dome], [w * 0.25, yb + 0.05 + dome * 0.7], [0, yb + 0.052]]; // bonnet power domes
  const up = ghP.map((p, i) => [p[0] * gh + hoodP[i][0] * (1 - gh), p[1] * gh + hoodP[i][1] * (1 - gh)]);
  return { pts: lo.concat(up), gh, yb, ys, yr, w }; }
// segments: 0 under,1 under edge,2 skirt,3-4 lower body,5 shoulder,6 belt->window,7-8 side glass,9-10 roof/crown
function crPoint(a, b, c, d, t) { const t2 = t * t, t3 = t2 * t; return [0, 1].map(k => 0.5 * ((2 * b[k]) + (-a[k] + c[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t2 + (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t3)); }
function ring(P, z, sub) { const s = section(P, z), c = s.pts, n = c.length; const out = [], seg = [];
  for (let i = 0; i < n - 1; i++) { const a = c[Math.max(0, i - 1)], b = c[i], cc = c[i + 1], d = c[Math.min(n - 1, i + 2)]; const k = (i === 0 || i === 1 || i === 2) ? 2 : sub;
    for (let j = 0; j < k; j++) { out.push(crPoint(a, b, cc, d, j / k)); seg.push(i); } } out.push(c[n - 1]); seg.push(n - 2); return { pts: out, seg, s }; }
function archCut(P, x, y, z, w) { if (x < w - 0.34 || y > P.R + P.Ra) return [y, z]; for (const zc of [P.zF, P.zR]) { const dz = z - zc, dy = y - P.R, d = Math.hypot(dz, dy); if (d < P.Ra) { if (dy >= 0) { const k = P.Ra / Math.max(1e-4, d); return [P.R + dy * k, zc + dz * k]; } return [y, zc + (dz >= 0 ? 1 : -1) * Math.sqrt(P.Ra * P.Ra - dy * dy)]; } } return [y, z]; }
function leanZ(P, y, z) { const t = (z + P.L / 2) / P.L; if (t < 0.09) z += (1 - t / 0.09) ** 2 * P.noseLean * clamp((y - 0.3) / 0.42, 0, 1); if (t > 0.94) z -= ((t - 0.94) / 0.06) ** 2 * P.tailLean * (clamp((y - 0.62) / 0.4, 0, 1) + clamp((0.36 - y) / 0.2, 0, 1) * 0.5); return z; }
// details cut into the shell: returns a material key for a point on the nose / tail faces, else null
function endZone(P, x, y, z) { if (!P.zoneTris) return null; const ax = Math.abs(x), side = x >= 0 ? 'indR' : 'indL';
  if (z < -P.L / 2 + 0.42) { if (y < 0.215) return 'black';
    const yl = 0.62 + (ax - 0.45) * 0.1; if (ax > 0.45 && ax < 0.94 && y > yl && y < yl + 0.044) return y > yl + 0.032 ? 'drl' : 'head'; if (ax > 0.55 && ax < 0.92 && y > yl - 0.013 && y <= yl) return side;
    const hw = y > 0.45 ? 0.5 + (0.6 - y) / 0.15 * 0.06 : 0.56 - (0.45 - y) / 0.2 * 0.1; if (y > 0.25 && y < 0.6 && ax < hw) return (ax > hw - 0.016 || y > 0.585 || y < 0.266) ? 'black' : 'honey';
    const it = 0.44 - (ax - 0.62) * 0.3; if (ax > 0.62 && ax < 0.9 && y > 0.22 && y < it) return (ax < 0.635 || y > it - 0.014 || ax > 0.885) ? 'black' : 'honey'; return null; }
  if (z > P.L / 2 - 0.42) { if (y < 0.37 && ax < 0.8) { if (((ax - 0.6) / 0.105) ** 2 + ((y - 0.3) / 0.068) ** 2 < 1) return 'exIn'; return 'black'; }
    if (y > 0.968 && y < 0.992 && ax < 0.9) return 'tail'; if (ax > 0.55 && ax < 0.92 && y > 0.9 && y <= 0.968) return 'tail'; if (ax > 0.47 && ax <= 0.55 && y > 0.9 && y < 0.94) return 'rev'; if (ax > 0.6 && ax < 0.9 && y > 0.884 && y <= 0.9) return side; }
  return null; }
export function proBody(P, detail) {
  const N = detail > 1 ? 170 : detail > 0 ? 110 : 60, sub = detail > 1 ? 6 : detail > 0 ? 4 : 2;
  const zs = []; for (let i = 0; i < N; i++) { const u = i / (N - 1); zs.push(-P.L / 2 + P.L * (0.5 - 0.5 * Math.cos(Math.PI * u)) * 0.6 + P.L * u * 0.4); }
  const rings = zs.map(z => ring(P, z, sub)); const side = rings[0].pts.length; const RN = side * 2 - 2; // full loop: right side, then mirrored left (centre points shared)
  const pos = [], uv = [], segOf = [];
  for (let i = 0; i < N; i++) { const r = rings[i], z0 = zs[i]; const loop = []; for (let j = 0; j < side; j++) loop.push([r.pts[j][0], r.pts[j][1], r.seg[j]]); for (let j = side - 2; j >= 1; j--) loop.push([-r.pts[j][0], r.pts[j][1], r.seg[j]]);
    for (const [x, y0, sg] of loop) { let [y, z] = archCut(P, Math.abs(x), y0, z0, r.s.w); z = leanZ(P, y, z); const ez = sg >= 2 ? endZone(P, x, y, z) : null; if (ez === 'honey') z += 0.014; else if (ez === 'exIn') z -= 0.035; else if (ez === 'head' || ez === 'drl') z += 0.004 * Math.sign(-z); pos.push(x, y, z); if (Math.abs(z) > P.L / 2 - 0.45) uv.push(x * 2.5, y * 2.5); else uv.push((z + P.L / 2) / P.L, y / 1.5); segOf.push(sg); } }
  const G = { paint: [], glass: [], black: [], under: [], honey: [], head: [], drl: [], tail: [], rev: [], indL: [], indR: [], exIn: [] };
  const zone = (sg, z, gh) => { if (sg <= 1) return 'under'; if (sg === 2) return 'black'; if (gh < 0.5 || sg < 6) return 'paint'; if (sg === 6) return 'black';
    if (sg === 7 || sg === 8) { if (z < P.side[0]) return 'black'; if (z > P.side[1]) return 'paint'; if ((z > P.bp[0] && z < P.bp[1]) || (z > P.cp[0] && z < P.cp[1])) return 'black'; return 'glass'; }
    if (z > P.ws[0] && z < P.ws[1]) return 'glass'; if (z > P.rw[0] && z < P.rw[1]) return 'glass'; return 'paint'; };
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < RN; j++) { const a = i * RN + j, b = i * RN + (j + 1) % RN, c = (i + 1) * RN + j, d = (i + 1) * RN + (j + 1) % RN;
    const sg = Math.min(segOf[a], segOf[b]); const zm = (zs[i] + zs[i + 1]) / 2; const gh = (rings[i].s.gh + rings[i + 1].s.gh) / 2; let k = zone(sg, zm, gh);
    if (k === 'paint' || k === 'black') { const cx = (pos[a * 3] + pos[d * 3]) / 2, cy = (pos[a * 3 + 1] + pos[d * 3 + 1]) / 2, cz = (pos[a * 3 + 2] + pos[d * 3 + 2]) / 2; const ez = endZone(P, cx, cy, cz); if (ez) k = ez; } G[k].push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const idx = [], groups = []; for (const [mi, k] of ['paint', 'glass', 'black', 'under', 'honey', 'head', 'drl', 'tail', 'rev', 'indL', 'indR', 'exIn'].entries()) { groups.push([idx.length, G[k].length, mi]); idx.push(...G[k]); }
  g.setIndex(idx); for (const [s, c, m] of groups) g.addGroup(s, c, m); g.computeVertexNormals();
  // caps: close nose and tail (they collapse to a vertical line, so a fan is enough)
  return { geo: g, zs, rings, RN, N }; }
// surface sample: right-side point of segment sg at fraction f, at z (no arch cut)
function sAt(P, z, sg, f = 0) { const c = section(P, z).pts; const a = c[sg], b = c[Math.min(c.length - 1, sg + 1)]; return new THREE.Vector3(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, z); }


// ------------------------------------------------------------------ conformal decals: crisp outlines draped on the shell
function subdivide(g, maxL) { let p = Array.from(g.toNonIndexed().attributes.position.array); for (let it = 0; it < 8; it++) { const o = []; let ch = 0;
  for (let i = 0; i < p.length; i += 9) { const A = [p[i], p[i + 1]], B = [p[i + 3], p[i + 4]], C = [p[i + 6], p[i + 7]]; const e = [Math.hypot(A[0] - B[0], A[1] - B[1]), Math.hypot(B[0] - C[0], B[1] - C[1]), Math.hypot(C[0] - A[0], C[1] - A[1])]; const m = Math.max(...e);
    if (m <= maxL) { o.push(A[0], A[1], 0, B[0], B[1], 0, C[0], C[1], 0); continue; } ch = 1; const [a, b, c] = e[0] === m ? [A, B, C] : e[1] === m ? [B, C, A] : [C, A, B]; const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    o.push(a[0], a[1], 0, mid[0], mid[1], 0, c[0], c[1], 0, mid[0], mid[1], 0, b[0], b[1], 0, c[0], c[1], 0); } p = o; if (!ch) break; }
  const ng = new THREE.BufferGeometry(); ng.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); return ng; }
// height field of an end face (front: dir=+1 rays toward +z from the nose; rear: dir=-1) from the end triangles only
function endField(P, geo, end) { const pos = geo.attributes.position, idx = geo.index.array, keep = [];
  for (let i = 0; i < idx.length; i += 3) { const zc = (pos.getZ(idx[i]) + pos.getZ(idx[i + 1]) + pos.getZ(idx[i + 2])) / 3; if (end < 0 ? zc < -P.L / 2 + 0.75 : zc > P.L / 2 - 0.75) for (let k = 0; k < 3; k++) keep.push(pos.getX(idx[i + k]), pos.getY(idx[i + k]), pos.getZ(idx[i + k])); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3)); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); m.updateMatrixWorld(true);
  const x0 = -1.1, y0 = 0.08, st = 0.02, nx = 111, ny = 54, F = new Float32Array(nx * ny).fill(NaN), ray = new THREE.Raycaster(), o = new THREE.Vector3(), d = new THREE.Vector3(0, 0, end < 0 ? 1 : -1);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { o.set(x0 + i * st, y0 + j * st, end < 0 ? -4 : 4); ray.set(o, d); const h = ray.intersectObject(m, false)[0]; if (h) F[j * nx + i] = h.point.z; }
  return (x, y) => { const fx = clamp((x - x0) / st, 0, nx - 1.001), fy = clamp((y - y0) / st, 0, ny - 1.001), i = fx | 0, j = fy | 0, u = fx - i, v = fy - j; const a = F[j * nx + i], b = F[j * nx + i + 1], c = F[(j + 1) * nx + i], e = F[(j + 1) * nx + i + 1];
    const vals = [[a, (1 - u) * (1 - v)], [b, u * (1 - v)], [c, (1 - u) * v], [e, u * v]].filter(q => !isNaN(q[0])); if (!vals.length) return NaN; const W = vals.reduce((s, q) => s + q[1], 0) || 1; return vals.reduce((s, q) => s + q[0] * q[1], 0) / W; }; }
function decal(field, end, outline, holes, off, uvk = 2.5, maxL = 0.018) { const sh = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y))); for (const h of holes || []) sh.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const g = subdivide(new THREE.ShapeGeometry(sh, 24), maxL), p = g.attributes.position, uv = [];
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); let z = field(x, y); if (isNaN(z)) z = field(x * 0.97, y); p.setZ(i, isNaN(z) ? (end < 0 ? -2.4 : 2.4) : z + (end < 0 ? -off : off)); uv.push(x * uvk, y * uvk); }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); if (end < 0) { const ix = g.attributes.position.array; for (let i = 0; i < ix.length; i += 9) for (let k = 0; k < 3; k++) { const t = ix[i + 3 + k]; ix[i + 3 + k] = ix[i + 6 + k]; ix[i + 6 + k] = t; } const u2 = g.attributes.uv.array; for (let i = 0; i < u2.length; i += 6) for (let k = 0; k < 2; k++) { const t = u2[i + 2 + k]; u2[i + 2 + k] = u2[i + 4 + k]; u2[i + 4 + k] = t; } }
  g.computeVertexNormals(); return g; }
const ellipse = (cx, cy, rx, ry, n = 40, rev) => { const o = []; for (let i = 0; i < n; i++) { const a = (rev ? -1 : 1) * i / n * Math.PI * 2; o.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); } return o; };
const mirX = pts => pts.map(([x, y]) => [-x, y]).reverse();
// ------------------------------------------------------------------ wheels: 10-spoke concave rims, lathed tyre with tread grooves + sidewall lettering
function letterTex(txt) { const c = cv(1024, 1024, (g, w) => { g.translate(w / 2, w / 2); g.fillStyle = '#d8d8d8'; g.font = '700 46px Arial Black, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; const r = w / 2 * 0.865, n = txt.length;
  for (let i = 0; i < n; i++) { g.save(); g.rotate(i / n * Math.PI * 2); g.translate(0, -r); g.fillText(txt[i], 0, 0); g.restore(); } }); const t = tex(c, true); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t; }
export function proWheel(P, detail) { const R = P.R, tw = P.tyreW / 2, rimR = R * 0.71, segs = detail > 1 ? 72 : detail > 0 ? 48 : 28; const out = {};
  const tp = [[rimR - 0.004, -tw * 0.9], [R - 0.07, -tw * 1.0], [R - 0.03, -tw * 0.985], [R - 0.008, -tw * 0.9]]; const gz = [-0.55, -0.18, 0.18, 0.55];
  for (let k = 0; k <= 16; k++) { const a = -tw * 0.86 + k / 16 * tw * 1.72; const gr = gz.some(q => Math.abs(a / tw - q) < 0.035) ? 0.009 : 0; tp.push([R - gr, a]); }
  tp.push([R - 0.008, tw * 0.9], [R - 0.03, tw * 0.985], [R - 0.07, tw * 1.0], [rimR - 0.004, tw * 0.9]);
  const tyre = new THREE.LatheGeometry(tp.map(([r, a]) => new THREE.Vector2(r, a)), segs); tyre.rotateZ(-Math.PI / 2); out.tyre = tyre;
  const bits = []; const barrel = new THREE.LatheGeometry([[rimR - 0.012, -tw * 0.86], [rimR - 0.008, tw * 0.7], [rimR + 0.004, tw * 0.84], [rimR + 0.012, tw * 0.9], [rimR + 0.004, tw * 0.95], [rimR - 0.02, tw * 0.92]].map(([r, a]) => new THREE.Vector2(r, a)), segs); barrel.rotateZ(-Math.PI / 2); bits.push(barrel);
  const r0 = 0.055, r1 = rimR - 0.012;
  for (let i = 0; i < 10; i++) { const sp = new THREE.BoxGeometry(0.024, r1 - r0, 0.032, 1, 10, 1); sp.translate(0, (r0 + r1) / 2, 0); const q = sp.attributes.position;
    for (let k = 0; k < q.count; k++) { const t = clamp((q.getY(k) - r0) / (r1 - r0), 0, 1); q.setZ(k, q.getZ(k) * (1.25 - 0.6 * t) + (i & 1 ? 1 : -1) * 0.006 * t); q.setX(k, q.getX(k) * (1 - 0.3 * t) + tw * 0.38 + 0.05 * Math.sqrt(t) - 0.045 * (1 - t) * 0); }
    sp.rotateX(i / 10 * Math.PI * 2); bits.push(sp); }
  const hub = new THREE.CylinderGeometry(0.075, 0.08, 0.04, 32); hub.rotateZ(Math.PI / 2); hub.translate(tw * 0.36, 0, 0); bits.push(hub);
  for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2, n = new THREE.CylinderGeometry(0.009, 0.009, 0.02, 6); n.rotateZ(Math.PI / 2); n.translate(tw * 0.36 + 0.025, Math.cos(a) * 0.05, Math.sin(a) * 0.05); bits.push(n); }
  out.rim = mergeGeometries(bits.map(b => { const g = b.index ? b.toNonIndexed() : b; for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; })); out.rim.computeVertexNormals();
  const cap = new THREE.CircleGeometry(0.034, 32); cap.rotateY(Math.PI / 2); cap.translate(tw * 0.36 + 0.022, 0, 0); out.cap = cap;
  const lt = new THREE.RingGeometry(R - 0.075, R - 0.022, segs); lt.rotateY(Math.PI / 2); lt.translate(tw * 1.0 + 0.004, 0, 0); out.letter = lt;
  const ltL = lt.clone(); ltL.rotateY(Math.PI); out.letterL = ltL;
  out.letterMat = new THREE.MeshStandardMaterial({ map: (TX.letter ||= letterTex(' CUZZY SPORT CONTACT  285/30 ZR22 101Y  ·  CUZZY SPORT CONTACT  285/30 ZR22 101Y  · ')), transparent: true, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
  out.rimR = rimR; return out; }

// ------------------------------------------------------------------ build
export function buildPro(car, opts, H) {
  const P = makeSpec(car), M = H.M, T = proTex(); const detail = opts.detail ?? 2;
  const root = new THREE.Group(); root.name = car.id; const bodyG = new THREE.Group(); root.add(bodyG);
  const paint = carPaint(opts.colour ?? car.colour, opts.finish !== 'solid', detail, { envMap: H.ENV, envMapIntensity: 1.25 });
  const glass = carGlass(true); glass.side = THREE.DoubleSide; glass.opacity = 0.62;
  const black = new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.12, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04 }); // piano black trim / pillars
  const satin = new THREE.MeshStandardMaterial({ color: 0x101113, roughness: 0.55, metalness: 0.2 });
  const carbonM = new THREE.MeshPhysicalMaterial({ map: T.carbon, roughness: 0.32, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.06 });
  const alu = new THREE.MeshStandardMaterial({ color: 0xc9cdd2, metalness: 1, roughness: 0.32, roughnessMap: T.brushed });
  const chrome = M.chrome;
  const B = proBody(P, detail);
  const ZM = { honey: new THREE.MeshPhysicalMaterial({ map: T.honey, roughness: 0.25, metalness: 0.3, clearcoat: 1 }), matrix: null };
  const body = new THREE.Mesh(B.geo, [paint, glass, black, M.under, ZM.honey, black, black, black, black, black, black, M.exhaustIn]); body.castShadow = true; body.renderOrder = 0; bodyG.add(body); body.name = 'body';
  // inner shell: the same surface seen from inside reads as headliner / pillar trim / door tops, never see-through
  const inner = new THREE.Mesh(B.geo, [new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.95, normalMap: T.alcN, side: THREE.BackSide }), new THREE.MeshBasicMaterial({ visible: false }), new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.7, side: THREE.BackSide }), new THREE.MeshStandardMaterial({ color: 0x0a0a0b, side: THREE.BackSide })]); bodyG.add(inner);
  const ray = new THREE.Raycaster(); body.updateMatrixWorld(true);
  const hit = (o, d) => { ray.set(o, d); const h = ray.intersectObject(body, false)[0]; return h ? { p: h.point, n: h.face.normal.clone() } : null; };
  const front = (x, y) => hit(new THREE.Vector3(x, y, -4), new THREE.Vector3(0, 0, 1)), rear = (x, y) => hit(new THREE.Vector3(x, y, 4), new THREE.Vector3(0, 0, -1)), sideH = (y, z) => hit(new THREE.Vector3(3, y, z), new THREE.Vector3(-1, 0, 0));
  const parts = { black: [], satin: [], carbon: [], alu: [], chrome: [], liner: [], paint: [] };
  const put = (geo, k, p, n, extra) => { geo = geo.clone(); if (n) { const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n.clone().normalize()); geo.applyQuaternion(q); } if (extra) geo.applyMatrix4(extra); geo.translate(p.x, p.y, p.z); parts[k].push(geo.index ? geo.toNonIndexed() : geo); return geo; };
  const flatN = (n, keepY = 0.0) => { const v = n.clone(); v.y *= keepY; return v.normalize(); };
  const L = {}; L.head = new THREE.MeshStandardMaterial({ color: 0xf4f6ff, emissive: 0xeef3ff, emissiveIntensity: 0.25, roughness: 0.1, metalness: 0.3 }); L.tail = new THREE.MeshStandardMaterial({ color: 0x5a0003, emissive: 0xff1208, emissiveIntensity: 0.35, roughness: 0.25 });
  L.ind = new THREE.MeshStandardMaterial({ color: 0x5a3000, emissive: 0xff8a00, emissiveIntensity: 0, roughness: 0.3 }); L.rev = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.2 }); L.indR = L.ind.clone(); const IND = sx => sx > 0 ? L.indR : L.ind; // per-side indicators (hero runtime drives each side)
  const lightMeshes = []; const DRL = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf2f6ff, emissiveIntensity: 3.2, toneMapped: false }); const addM = (geo, mat, parent = bodyG, ro) => { const m = new THREE.Mesh(geo, mat); if (ro != null) m.renderOrder = ro; parent.add(m); return m; };
  { const mx = tex(cv(64, 16, (g) => { g.fillStyle = '#222'; g.fillRect(0, 0, 64, 16); g.fillStyle = '#fff'; for (let k = 0; k < 8; k++) g.fillRect(k * 8 + 1, 3, 6, 10); }), true, 1); L.head.emissiveMap = mx; L.head.map = mx; L.head.needsUpdate = true; mx.repeat.set(1.2, 4); }
  body.material = [paint, glass, black, M.under, ZM.honey, L.head, DRL, L.tail, L.rev, L.ind, L.indR, M.exhaustIn]; // lamps are body faces (flush)
  // shut lines: subtle continuous gaps (thin dark tubes following the surface), not dotted
  { const seam = []; const mk = (z, s0, s1) => { const pts = []; for (let sg = s0; sg <= s1; sg++) for (let f = 0; f < 1; f += 0.25) { const p = sAt(P, z, sg, f); const [y, zz] = archCut(P, p.x, p.y, p.z, P.wp(z) + P.flare(z)); if (Math.abs(zz - z) > 0.002) continue; pts.push(new THREE.Vector3(p.x + 0.0008, y, z)); } return pts; };
    for (const z of [P.side[0] - 0.02, (P.bp[0] + P.bp[1]) / 2, P.cp[0] - 0.02]) { const pts = mk(z, 2, 6); if (pts.length < 3) continue; for (const sx of [1, -1]) seam.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(sx * p.x, p.y, p.z))), 24, 0.0014, 4).toNonIndexed()); }
    if (seam.length) addM(mergeGeometries(seam), new THREE.MeshBasicMaterial({ color: 0x0a0a0a })); }
  // ---- front / rear details are cut INTO the one body shell (proBody zones): grille, air curtains, lamps, lip,
  // light bar, diffuser, exhaust cut-outs. Only the badges, plates and chrome tip rings sit on the surface.
  const onSurf = (h, w, hgt, mat, out = 0.004) => { if (!h) return null; h.n.x = 0; if (h.n.lengthSq() < 1e-6) h.n.set(0, 0, h.p.z < 0 ? -1 : 1); h.n.normalize(); if (Math.sign(h.n.z) !== Math.sign(h.p.z)) h.n.z *= -1; const g = new THREE.PlaneGeometry(w, hgt); const m = new THREE.Mesh(g, mat); m.position.copy(h.p).addScaledVector(h.n, out); m.rotation.set(h.n.z < 0 ? Math.atan2(h.n.y, -h.n.z) : -Math.atan2(h.n.y, h.n.z), h.n.z < 0 ? Math.PI : 0, 0, 'YXZ'); m.renderOrder = 2; bodyG.add(m); return m; };
  const gzz = front(0, 0.45)?.p.z ?? -P.L / 2;
  { const FF = endField(P, B.geo, -1), RF = endField(P, B.geo, 1); const gloss = black.clone(); gloss.polygonOffset = true; gloss.polygonOffsetFactor = -1; gloss.polygonOffsetUnits = -2;
    const hon = new THREE.MeshPhysicalMaterial({ map: T.honey, roughness: 0.25, metalness: 0.35, clearcoat: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }); hon.map = T.honey.clone(); hon.map.repeat.set(1, 1); hon.map.needsUpdate = true;
    const lay = (f, end, out, holes, mat, off, uvk) => { const m = new THREE.Mesh(decal(f, end, out, holes, off, uvk), mat); m.renderOrder = 1; bodyG.add(m); return m; };
    // singleframe grille (wide, low hexagon), gloss frame + honeycomb
    const gR = [[0.5, 0.6], [0.56, 0.45], [0.46, 0.235]], gO = [...gR, ...mirX(gR)]; const gI = gO.map(([x, y]) => [x * 0.955, 0.42 + (y - 0.42) * 0.93]);
    lay(FF, -1, gO, [gI.slice().reverse()], gloss, 0.003); lay(FF, -1, gI, null, hon, 0.002, 1.2);
    lay(FF, -1, [[0.84, 0.215], [-0.84, 0.215].map((v, i) => i ? v : v), [-0.84, 0.2], [0.84, 0.2]].map(p => p), null, gloss, 0.003); // lip
    for (const sx of [1, -1]) { const X = pts => sx > 0 ? pts : mirX(pts);
      const iO = [[0.63, 0.43], [0.66, 0.225], [0.9, 0.225], [0.91, 0.37]], iI = [[0.648, 0.413], [0.672, 0.24], [0.888, 0.24], [0.895, 0.36]];
      lay(FF, -1, X(iO), [X(iI).reverse()], gloss, 0.003); lay(FF, -1, X(iI), null, hon, 0.002, 1.2);
      const lO = [[0.53, 0.582], [0.9, 0.617], [0.945, 0.648], [0.57, 0.633]]; lay(FF, -1, X(lO), null, gloss, 0.003);
      lay(FF, -1, X([[0.56, 0.59], [0.9, 0.623], [0.925, 0.637], [0.58, 0.612]]), null, L.head, 0.0045, 6);
      lay(FF, -1, X([[0.575, 0.617], [0.92, 0.638], [0.93, 0.644], [0.58, 0.625]]), null, DRL, 0.005);
      lay(FF, -1, X([[0.6, 0.574], [0.9, 0.607], [0.9, 0.613], [0.6, 0.58]]), null, IND(sx), 0.0045);
      // rear clusters, reverse lamp, indicator strip
      lay(RF, 1, X([[0.5, 0.9], [0.845, 0.906], [0.84, 0.962], [0.5, 0.962]]), null, gloss, 0.003);
      lay(RF, 1, X([[0.57, 0.918], [0.825, 0.922], [0.822, 0.952], [0.57, 0.952]]), null, L.tail, 0.0045);
      lay(RF, 1, X([[0.515, 0.915], [0.555, 0.915], [0.555, 0.945], [0.515, 0.945]]), null, L.rev, 0.0045);
      lay(RF, 1, X([[0.57, 0.906], [0.825, 0.91], [0.825, 0.914], [0.57, 0.91]]), null, IND(sx), 0.0045); }
    // full-width light bar as a real lamp unit: gloss bezel, housing lip walls, chrome-red reflector, segmented LED
    // strip, then a smoked clear-coated glass cover standing proud (reflects the studio env, LEDs glow + bloom through it)
    { const X0 = 0.845, yA = 0.958, yB = 1.0, gA = 0.964, gB = 0.994, D = 0.011;
      lay(RF, 1, [[X0, yA], [X0, yB], [-X0, yB], [-X0, yA]], null, gloss, 0.002);
      const refl = new THREE.MeshPhysicalMaterial({ color: 0x3a0004, metalness: 0.9, roughness: 0.25, emissive: 0x200000, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3 });
      lay(RF, 1, [[X0 - 0.01, gA], [X0 - 0.01, gB], [-X0 + 0.01, gB], [-X0 + 0.01, gA]], null, refl, 0.003);
      const segs = []; for (let k = 0; k < 64; k++) { const x0 = -0.815 + k * (1.63 / 64), x1 = x0 + 1.63 / 64 - 0.006; segs.push(decal(RF, 1, [[x1, 0.975], [x1, 0.983], [x0, 0.983], [x0, 0.975]], null, 0.0055, 2.5, 0.01)); }
      const led = new THREE.Mesh(mergeGeometries(segs), L.tail); led.renderOrder = 2; bodyG.add(led); L.tail.toneMapped = false; L.barLed = led;
      // housing walls (top, bottom, ends) from the bezel out to the glass
      const wp = [], n = 90; const wall = (pts) => { for (let i = 0; i < pts.length - 1; i++) { const [a, b] = [pts[i], pts[i + 1]]; const za = RF(a[0], a[1]), zb = RF(b[0], b[1]); if (isNaN(za) || isNaN(zb)) continue;
        wp.push(a[0], a[1], za + 0.002, b[0], b[1], zb + 0.002, b[0], b[1], zb + D, a[0], a[1], za + 0.002, b[0], b[1], zb + D, a[0], a[1], za + D); } };
      const edge = (y) => Array.from({ length: n + 1 }, (_, i) => [-X0 + 0.01 + i / n * (2 * X0 - 0.02), y]); wall(edge(gA - 0.002)); wall(edge(gB + 0.002).reverse()); wall([[X0 - 0.01, gA - 0.002], [X0 - 0.01, gB + 0.002]]); wall([[-X0 + 0.01, gB + 0.002], [-X0 + 0.01, gA - 0.002]]);
      const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); wg.computeVertexNormals(); const wm = black.clone(); wm.side = THREE.DoubleSide; bodyG.add(new THREE.Mesh(wg, wm));
      const smoked = new THREE.MeshPhysicalMaterial({ color: 0x2a0508, metalness: 0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.38, envMap: H.ENV, envMapIntensity: 1.6, specularIntensity: 1, depthWrite: false });
      const gl = lay(RF, 1, [[X0 - 0.01, gA - 0.002], [X0 - 0.01, gB + 0.002], [-X0 + 0.01, gB + 0.002], [-X0 + 0.01, gA - 0.002]], null, smoked, D, 2.5); gl.renderOrder = 4; L.barGlass = gl; }
    // diffuser with oval exhaust cut-outs
    const ex = [0.6, -0.6].map(cx => ellipse(cx, 0.31, 0.112, 0.062, 40, true)); lay(RF, 1, [[0.8, 0.245], [0.8, 0.38], [-0.8, 0.38], [-0.8, 0.245]], ex, gloss, 0.003);
    for (const cx of [0.6, -0.6]) lay(RF, 1, ellipse(cx, 0.31, 0.112, 0.062), null, M.exhaustIn, -0.03); }
  onSurf(front(0, 0.565), 0.24, 0.06, new THREE.MeshStandardMaterial({ map: textTex(P.badge, { chrome: 1, size: 92, track: '6px' }), transparent: true, metalness: 0.9, roughness: 0.15 }), 0.012);
  onSurf(front(-0.42, 0.53), 0.07, 0.033, new THREE.MeshBasicMaterial({ map: textTex(P.model, { col: '#e3192b', size: 100, w: 256 }), transparent: true }), 0.012);
  onSurf(front(0, 0.31), 0.52, 0.111, new THREE.MeshStandardMaterial({ map: plateTex(P.plate, false), roughness: 0.3 }), 0.014);
  // ---- sides: mirrors, flush door handles (the skirt is the body's black sill band)
  for (const sx of [1, -1]) {
    for (const zh of [P.side[0] + 0.55, P.bp[1] + 0.52]) { const yh = P.yb(zh) - 0.075, hp = sideH(yh, zh); if (!hp) continue; const hg = new THREE.CapsuleGeometry(0.011, 0.12, 4, 8); hg.rotateX(Math.PI / 2); hg.scale(0.7, 1, 1); hg.translate(sx * (hp.p.x + 0.001), yh, zh); parts.paint.push(hg.toNonIndexed()); }
  }
  const mirrorFace = [];
  { const zm = P.side[0] + 0.07, yb = P.yb(zm); for (const sx of [1, -1]) { const x = sx * (P.wp(zm) + P.flare(zm) + 0.08), y = yb + 0.085, z = zm; const g = new THREE.Group(); g.position.set(x, y, z); bodyG.add(g);
      const hs = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 12), alu); hs.scale.set(1.25, 0.62, 0.72); hs.position.z = -0.01; g.add(hs);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), black); cap.scale.set(1.24, 0.63, 0.73); cap.rotation.x = Math.PI / 2; cap.position.z = 0.012; g.add(cap);
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.06), black); st.position.set(-sx * 0.09, -0.04, 0.01); g.add(st);
      const ind = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.008, 0.01), IND(sx)); ind.position.set(sx * 0.03, -0.035, -0.06); g.add(ind);
      mirrorFace.push({ nm: sx > 0 ? 'R' : 'L', pos: new THREE.Vector3(x, y, z + 0.058), w: 0.19, h: 0.095, grp: g }); } }
  // ---- roof rails + aerofoil roof spoiler flowing off the roof line, rear badges / plate on the tailgate
  { const z0 = 0.35, z1 = P.roof[P.roof.length - 3][0] - 0.05; const pts = []; for (let z = z0; z <= z1 + 1e-6; z += (z1 - z0) / 16) { const s = section(P, z).pts; const p = s[9]; pts.push(new THREE.Vector3(p[0], P.yr(z) + 0.026, z)); }
    for (const sx of [1, -1]) { const c = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(sx * Math.max(0.5, p.x + 0.13), p.y, p.z))); parts.black.push(new THREE.TubeGeometry(c, 40, 0.01, 8).toNonIndexed()); }
    const zs = P.rw[0] - 0.05, yS = P.yr(zs); const af = new THREE.Shape(); af.moveTo(0, 0); af.bezierCurveTo(0.08, 0.03, 0.2, 0.025, 0.3, -0.035); af.bezierCurveTo(0.2, -0.005, 0.08, -0.01, 0, 0);
    const wsp = P.wp(zs) * 2 * P.roofW * 1.22; const sp = new THREE.ExtrudeGeometry(af, { depth: wsp, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.02, bevelSegments: 4, curveSegments: 16 }); sp.rotateY(-Math.PI / 2); sp.translate(wsp / 2, yS - 0.004, zs); parts.black.push(sp.toNonIndexed()); }
  const tz = rear(0, 0.98);
  { const tzz = tz ? tz.p.z : P.L / 2;
    onSurf(rear(0, 0.93), 0.36, 0.06, new THREE.MeshStandardMaterial({ map: textTex(P.badge, { chrome: 1, size: 92, track: '14px' }), transparent: true, metalness: 0.9, roughness: 0.15 }), 0.006);
    onSurf(rear(0.6, 0.84), 0.1, 0.045, new THREE.MeshStandardMaterial({ map: textTex(P.model, { chrome: 1, size: 100, w: 256 }), transparent: true, metalness: 0.9, roughness: 0.15 }), 0.006);
    onSurf(rear(0, 0.66), 0.52, 0.111, new THREE.MeshStandardMaterial({ map: plateTex(P.plate, true), roughness: 0.3 }), 0.008); void tzz; }
  root.userData.exhausts = [];
  for (const sx of [1, -1]) { const h = rear(sx * 0.6, 0.37); const z = h ? h.p.z : P.L / 2; const ring = new THREE.TorusGeometry(0.1, 0.008, 10, 48); ring.scale(1.12, 0.62, 1); ring.translate(sx * 0.6, 0.31, z - 0.002); parts.chrome.push(ring.toNonIndexed()); root.userData.exhausts.push(new THREE.Vector3(sx * 0.6, 0.3, z + 0.05)); }
  // wheel-arch liners
  for (const zc of [P.zF, P.zR]) for (const sx of [1, -1]) { const g = new THREE.CylinderGeometry(P.Ra - 0.008, P.Ra - 0.008, 0.36, 28, 1, true, -Math.PI / 2 - 0.2, Math.PI + 0.4); g.rotateZ(Math.PI / 2); g.translate(sx * (P.wp(zc) + P.flare(zc) - 0.2), P.R, zc); addM(g, M.liner); }
  for (const [k, list] of Object.entries(parts)) if (list.length && k !== 'liner') { const mt = { black, satin, carbon: carbonM, alu, chrome, paint }[k]; const m = addM(mergeGeometries(list), mt); m.castShadow = true; }
  // ---- wheels: lettered tyre (285/30 R22-ish), graphite rims, carbon-ceramic discs, painted 10-piston calipers
  const WG = proWheel(P, detail); const rimMat = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, color: opts.wheelColour ?? P.rim, metalness: 0.85, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08, envMap: H.ENV });
  const calMat = new THREE.MeshPhysicalMaterial({ color: opts.caliper ?? car.caliper ?? P.caliper, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.06 });
  const discMat = new THREE.MeshStandardMaterial({ map: T.disc, color: 0x3c3c3c, roughness: 0.55, metalness: 0.5 }); const capMat = new THREE.MeshStandardMaterial({ map: textTex('C', { chrome: 1, size: 110, w: 128, bg: '#16181b' }), metalness: 0.7, roughness: 0.3 });
  const rimR = P.R * 0.71, tw = P.tyreW / 2; const disc = new THREE.CylinderGeometry(rimR * 0.86, rimR * 0.86, 0.036, 48); disc.rotateZ(Math.PI / 2); disc.translate(-tw * 0.1, 0, 0);
  { const uvA = disc.attributes.uv, pA = disc.attributes.position; for (let i = 0; i < uvA.count; i++) uvA.setXY(i, 0.5 + pA.getZ(i) / (rimR * 1.6), 0.5 + pA.getY(i) / (rimR * 1.6)); }
  const calS = new THREE.Shape(); calS.absarc(0, 0, rimR * 0.94, 0.55, 1.65, false); calS.absarc(0, 0, rimR * 0.62, 1.65, 0.55, true); const cal = new THREE.ExtrudeGeometry(calS, { depth: 0.085, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2, curveSegments: 16 }); cal.translate(0, 0, -0.0425); cal.rotateY(Math.PI / 2); cal.translate(-tw * 0.1 + 0.02, 0, 0);
  const wheels = [];
  for (const [zc, frontW] of [[P.zF, true], [P.zR, false]]) for (const sx of [-1, 1]) { const pivot = new THREE.Group(); pivot.position.set(sx * P.track / 2, P.R, zc); root.add(pivot); const spin = new THREE.Group(); pivot.add(spin); const flip = sx < 0 ? -1 : 1;
    const t = new THREE.Mesh(WG.tyre, detail > 0 ? M.rubber : M.rubberLo); t.castShadow = true; spin.add(t); const rm = new THREE.Mesh(WG.rim, rimMat); rm.scale.x = flip; spin.add(rm); const cp = new THREE.Mesh(WG.cap, capMat); cp.scale.x = flip; spin.add(cp); if (detail > 0) spin.add(new THREE.Mesh(flip > 0 ? WG.letter : WG.letterL, WG.letterMat));
    const d = new THREE.Mesh(disc, discMat); d.scale.x = flip; spin.add(d); const c = new THREE.Mesh(cal, calMat); c.scale.x = flip; c.rotation.x = frontW ? 0 : Math.PI; pivot.add(c); wheels.push({ pivot, spin, front: frontW, side: sx, baseY: P.R }); }
  // ---- interior
  const interior = new THREE.Group(); bodyG.add(interior);
  const I = buildInterior(P, interior, T, { black, carbonM, alu, M });
  // ---- userData contract
  const u = root.userData; u.wheels = wheels; u.body = bodyG; u.lights = L; u.paint = paint; u.interior = interior; u.steeringWheel = I.sw; u.cockpit = I.eye.clone(); u.ckFrom = 'pro';
  u.bonnetCam = new THREE.Vector3(0, P.yb(-1.0) + 0.3, -0.9); u.dims = { L: P.L, W: P.W, H: P.H, R: P.R, zF: P.zF, zR: P.zR }; u.rimMat = rimMat; u.calMat = calMat; u.glassMesh = glass; u.rubberMats = [M.rubber, M.rubberLo]; u.pro = { P, I, mirrorFace, gzz };
  const blob = contactShadow(P.W, P.L, wheels.map(w => [w.pivot.position.x, w.pivot.position.z]), P.R); root.add(blob); u.blob = blob; attachCarFx(root, [paint]);
  u.dashDeg = 8; return root; }

// ------------------------------------------------------------------ interior
function buildInterior(P, grp, T, K) { const { black, carbonM, alu, M } = K; const dx = P.drvX;
  const leather = new THREE.MeshPhysicalMaterial({ color: 0x141414, roughness: 0.52, normalMap: T.leatherN, normalScale: new THREE.Vector2(0.5, 0.5), roughnessMap: T.roughVar, sheen: 0.3, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x333333) });
  const soft = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.78, normalMap: T.grainN, normalScale: new THREE.Vector2(0.35, 0.35), roughnessMap: T.roughVar });
  const alc = new THREE.MeshStandardMaterial({ color: 0x232325, roughness: 1, normalMap: T.alcN, normalScale: new THREE.Vector2(0.6, 0.6) });
  const quilt = new THREE.MeshPhysicalMaterial({ map: T.quiltC, normalMap: T.quiltN, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.55, sheen: 0.3, sheenColor: new THREE.Color(0x303030) });
  const carpet = new THREE.MeshStandardMaterial({ color: 0x0e0e0f, roughness: 1, normalMap: T.alcN });
  const add = (g, m, p = grp) => { const o = new THREE.Mesh(g, m); p.add(o); o.castShadow = false; o.receiveShadow = true; return o; };
  const ao = (g, y0, y1, k = 0.45) => { const p = g.attributes.position, c = []; for (let i = 0; i < p.count; i++) { const t = clamp((p.getY(i) - y0) / (y1 - y0), 0, 1); const v = 1 - k * (1 - t); c.push(v, v, v); } g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); return g; }; // baked height AO
  const aoMat = m => { const c = m.clone(); c.vertexColors = true; return c; };
  const leatherAO = aoMat(leather), softAO = aoMat(soft);
  const eye = new THREE.Vector3(dx, 1.13, 0.4);
  const wsZ = P.roof[0][0], wsY = P.roof[0][1];
  // floor tub + transmission tunnel
  add(new THREE.BoxGeometry(1.7, 0.04, 2.4).translate(0, 0.24, 0.55), carpet);
  // dash: sculpted side profile (z, y) extruded across the cabin, stitched leather top, soft-touch lower, carbon inlay
  { const s = new THREE.Shape(); const pts = [[wsZ - 0.02, wsY - 0.02], [-0.47, 1.005], [-0.33, 1.0], [-0.27, 0.975], [-0.255, 0.93], [-0.27, 0.86], [-0.21, 0.74], [-0.24, 0.6], [-0.4, 0.5], [-0.62, 0.48]]; s.moveTo(pts[0][0], pts[0][1]); s.splineThru(pts.slice(1, 5).map(p => new THREE.Vector2(...p))); for (const p of pts.slice(5)) s.lineTo(...p); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 1.62, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.03, bevelSegments: 3, curveSegments: 18 }); g.rotateY(Math.PI / 2); g.translate(-0.81, 0, 0); add(ao(g, 0.5, 1.0), [leatherAO, softAO]);
    const inl = new THREE.BoxGeometry(1.5, 0.035, 0.012); inl.translate(0, 0.905, -0.245); add(inl, carbonM);
    const trimL = new THREE.BoxGeometry(1.5, 0.004, 0.006); trimL.translate(0, 0.926, -0.242); add(trimL, alu); }
  // binnacle hood over the cluster
  { const h = new THREE.CylinderGeometry(0.2, 0.2, 0.36, 24, 1, true, -1.15, 2.3); h.rotateZ(Math.PI / 2); h.scale(1, 0.38, 0.6); h.translate(dx, 0.975, -0.38); add(h, leather).material.side = THREE.DoubleSide; }
  // air vents: frame + horizontal slats + a centre vane
  const vent = (x, y, z, w, h, ry = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; grp.add(g); const fr = new THREE.Mesh(new THREE.BoxGeometry(w + 0.014, h + 0.014, 0.02), black); fr.position.z = -0.012; g.add(fr); const hole = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x020202 })); hole.position.z = 0.0; g.add(hole);
    for (let k = 0; k < 5; k++) { const sl = new THREE.Mesh(new THREE.BoxGeometry(w, 0.003, 0.016), alu); sl.position.set(0, -h / 2 + (k + 0.5) * h / 5, 0.004); sl.rotation.x = -0.25; g.add(sl); } const vn = new THREE.Mesh(new THREE.BoxGeometry(0.004, h, 0.018), alu); vn.position.z = 0.008; g.add(vn); };
  vent(dx + 0.36, 0.93, -0.255, 0.12, 0.05, -0.15); vent(-dx - 0.36, 0.93, -0.255, 0.12, 0.05, 0.15); vent(0.11, 0.875, -0.245, 0.15, 0.04); vent(-0.11, 0.875, -0.245, 0.15, 0.04);
  // centre console with piano-black top, gear surround, armrest
  { const s = new THREE.Shape([[-0.13, 0], [0.13, 0], [0.12, 0.3], [-0.12, 0.3]].map(([x, y]) => new THREE.Vector2(x, y))); const g = new THREE.ExtrudeGeometry(s, { depth: 0.95, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2 }); g.translate(0, 0.27, -0.25); add(ao(g, 0.27, 0.6), softAO);
    const top = new THREE.BoxGeometry(0.22, 0.012, 0.5); top.translate(0, 0.585, 0.02); add(top, black); const ring = new THREE.TorusGeometry(0.045, 0.006, 8, 32); ring.rotateX(Math.PI / 2); ring.translate(0.04, 0.593, 0.12); add(ring, alu);
    const side = new THREE.BoxGeometry(0.005, 0.18, 0.7); for (const sx of [1, -1]) add(side.clone().translate(sx * 0.146, 0.45, 0.15), carbonM);
    const arm = new THREE.BoxGeometry(0.22, 0.06, 0.34); arm.translate(0, 0.62, 0.6); add(arm, leather);
    const stack = new THREE.BoxGeometry(0.26, 0.3, 0.06); stack.rotateX(-0.45); stack.translate(0, 0.73, -0.24); add(stack, black); }
  // seats: sculpted buckets (cushion, back, bolsters, headrest) with quilted centres
  const seat = (x) => { const g = new THREE.Group(); g.position.set(x, 0.3, 0.62); grp.add(g); const rb = (w, h, d, m, px, py, pz, rx = 0) => { const o = new THREE.Mesh(new THREE.CapsuleGeometry(Math.min(w, d) / 2, Math.max(0.001, h - Math.min(w, d)), 6, 12), m); o.scale.set(w / Math.min(w, d), 1, d / Math.min(w, d)); o.position.set(px, py, pz); o.rotation.x = rx; g.add(o); return o; };
    const cush = rb(0.36, 0.12, 0.46, quilt, 0, 0.12, -0.02, Math.PI / 2); cush.rotation.set(Math.PI / 2, 0, 0); cush.scale.set(1, 1, 0.3);
    for (const sx of [1, -1]) { rb(0.09, 0.5, 0.12, leather, sx * 0.2, 0.15, -0.02, Math.PI / 2 - 0.1).scale.set(1, 1, 1); rb(0.09, 0.62, 0.12, leather, sx * 0.21, 0.55, 0.26, -0.22); }
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.66, 0.1, 1, 1, 1), quilt); back.position.set(0, 0.52, 0.29); back.rotation.x = -0.22; g.add(back); const bb = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.7, 0.06), leather); bb.position.set(0, 0.52, 0.34); bb.rotation.x = -0.22; g.add(bb);
    const hr = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.12, 6, 12), leather); hr.rotation.z = Math.PI / 2; hr.scale.set(1, 1, 0.8); hr.position.set(0, 0.93, 0.39); g.add(hr); };
  seat(dx); seat(-dx);
  { const rbn = new THREE.BoxGeometry(1.4, 0.16, 0.5); rbn.translate(0, 0.42, 1.5); add(rbn, quilt); const rbb = new THREE.BoxGeometry(1.4, 0.55, 0.12); rbb.rotateX(-0.2); rbb.translate(0, 0.74, 1.78); add(rbb, quilt); }
  // door cards: leather insert, alu pull handle, speaker grille, armrest
  for (const sx of [1, -1]) { const x = sx * (P.wp(0.3) + P.flare(0.3) - 0.11); const dc = new THREE.BoxGeometry(0.03, 0.5, 1.9); dc.translate(x, 0.68, 0.55); add(ao(dc, 0.43, 0.93), softAO);
    const ins = new THREE.BoxGeometry(0.01, 0.16, 0.6); ins.translate(x - sx * 0.018, 0.78, 0.2); add(ins, alc); const ar = new THREE.BoxGeometry(0.07, 0.04, 0.5); ar.translate(x - sx * 0.04, 0.66, 0.25); add(ar, leather);
    const hd = new THREE.BoxGeometry(0.02, 0.025, 0.12); hd.translate(x - sx * 0.025, 0.86, -0.12); add(hd, alu); const spk = new THREE.CircleGeometry(0.06, 24); spk.rotateY(-sx * Math.PI / 2); spk.translate(x - sx * 0.017, 0.52, -0.05); add(spk, alu); }
  // pedals (drilled alu)
  for (const [x, w] of [[dx - 0.12, 0.05], [dx + 0.02, 0.09], [dx + 0.15, 0.04]]) { const p = new THREE.BoxGeometry(w, 0.08, 0.012); p.rotateX(-0.6); p.translate(x, 0.36, -0.56); add(p, alu); }
  // steering wheel: flat-bottomed leather / Alcantara rim, three alu-trimmed spokes, airbag hub with badge, column + shroud
  const sw = new THREE.Group(); sw.position.set(dx, 0.8, -0.07); sw.rotation.x = -0.38; grp.add(sw); const R = 0.185;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.021, 14, 64, Math.PI * 1.64), leather); rim.rotation.z = -Math.PI * 0.32; sw.add(rim);
  const top = new THREE.Mesh(new THREE.TorusGeometry(R, 0.0215, 14, 16, 0.5), alc); top.rotation.z = Math.PI / 2 - 0.25; sw.add(top); const mark = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.045, 0.046), new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.6 })); mark.position.y = R; sw.add(mark);
  const flat = new THREE.Mesh(new THREE.CapsuleGeometry(0.021, R * 0.98, 6, 14), leather); flat.rotation.z = Math.PI / 2; flat.position.y = -R * 0.85; sw.add(flat);
  for (const a of [Math.PI / 2, -Math.PI / 2, Math.PI]) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.05, R * 0.8, 0.018), black); sp.position.set(Math.sin(a) * R * 0.55, Math.cos(a) * R * 0.55, 0.004); sp.rotation.z = -a; sw.add(sp); const tr = new THREE.Mesh(new THREE.BoxGeometry(0.004, R * 0.62, 0.02), alu); tr.position.copy(sp.position); tr.rotation.z = -a; tr.position.z = 0.012; sw.add(tr); }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.072, 0.05, 32), leather); hub.rotation.x = Math.PI / 2; hub.position.z = 0.012; sw.add(hub);
  const emb = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.02), new THREE.MeshStandardMaterial({ map: textTex('CUZZY', { chrome: 1, size: 92, track: '6px' }), transparent: true, metalness: 0.9, roughness: 0.2 })); emb.position.z = 0.038; sw.add(emb);
  const col = new THREE.CylinderGeometry(0.04, 0.05, 0.36, 16); col.rotateX(Math.PI / 2 - 0.38); col.translate(dx, 0.86, -0.26); add(col, soft);
  return { eye, sw, hub, R, dx, wsZ, wsY, leather, alc, alu, black, soft }; }
