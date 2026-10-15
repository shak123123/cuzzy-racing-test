// Ad studio kit: procedural PBR texture sets (albedo + normal + roughness, generated on canvas), stateless GPU
// particles (fire, steam, embers, oil spits, haze) and small modelled props. Deterministic: everything is a function of t.
import * as THREE from 'three';
export const rng = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const C = (w, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
// value noise
function noise2(seed) { const r = rng(seed), P = new Float32Array(256 * 256); for (let i = 0; i < P.length; i++) P[i] = r();
  const v = (x, y) => P[((y & 255) << 8) | (x & 255)]; const s = t => t * t * (3 - 2 * t);
  return (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = s(x - xi), yf = s(y - yi); return (v(xi, yi) * (1 - xf) + v(xi + 1, yi) * xf) * (1 - yf) + (v(xi, yi + 1) * (1 - xf) + v(xi + 1, yi + 1) * xf) * yf; }; }
const fbm = (n, x, y, o = 4) => { let a = 0, f = 1, w = 0.5, s = 0; for (let i = 0; i < o; i++) { a += n(x * f, y * f) * w; s += w; f *= 2; w *= 0.5; } return a / s; };
function normalFrom(hc, strength = 2) { const w = hc.width, h = hc.height, src = hc.getContext('2d').getImageData(0, 0, w, h).data, [c, g] = C(w, h), out = g.createImageData(w, h), H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength, l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    out.data[i] = (-dx / l * 0.5 + 0.5) * 255; out.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; out.data[i + 3] = 255; } g.putImageData(out, 0, 0); return c; }
const cache = {};
// kinds: wood, brick, asphalt, plaster, tile, steel, foam, pave
export function pbr(kind, o = {}) { const key = kind + JSON.stringify(o); if (cache[key]) return cache[key]; const S = o.size || 512, r = rng(o.seed || 7), n = noise2(o.seed || 3);
  const [ac, a] = C(S), [hc, hg] = C(S), [rc, rg] = C(S); const px = (g, f) => { const im = g.createImageData(S, S); for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const v = f(x, y), i = (y * S + x) * 4; im.data[i] = v[0]; im.data[i + 1] = v[1]; im.data[i + 2] = v[2]; im.data[i + 3] = 255; } g.putImageData(im, 0, 0); };
  const base = new THREE.Color(o.color || { wood: 0x6b4226, brick: 0x8e4a34, asphalt: 0x2d2e31, plaster: 0xb5502e, tile: 0xe8e2d4, steel: 0xb8bcc0, foam: 0x2a2a30, pave: 0x8f8b85 }[kind]);
  const B = [base.r * 255, base.g * 255, base.b * 255]; let rough = 0.6, strength = 2;
  if (kind === 'wood') { const pw = S / 4; px(a, (x, y) => { const pl = Math.floor(x / pw), off = (pl * 97) % S, g = fbm(n, x / 6, (y + off) / 90, 3), k = 0.75 + g * 0.5 + (pl % 2) * 0.05, edge = (x % pw < 2) ? 0.45 : 1, seam = ((y + off) % S < 2) ? 0.5 : 1; return B.map(c => c * k * edge * seam); });
    px(hg, (x, y) => { const v = (x % pw < 2 || (y + ((Math.floor(x / pw) * 97) % S)) % S < 2) ? 40 : 160 + fbm(n, x / 6, y / 90) * 60; return [v, v, v]; }); rough = 0.62; }
  if (kind === 'brick') { const bw = S / 4, bh = S / 12; px(a, (x, y) => { const row = Math.floor(y / bh), xo = x + (row % 2) * bw / 2, col = Math.floor(xo / bw), mortar = (y % bh < 3 || xo % bw < 3); if (mortar) return [168, 160, 148].map(v => v * (0.9 + n(x / 3, y / 3) * 0.2));
      const k = 0.7 + ((col * 31 + row * 17) % 10) / 22 + fbm(n, x / 8, y / 8) * 0.2; return B.map(c => c * k); });
    px(hg, (x, y) => { const row = Math.floor(y / bh), xo = x + (row % 2) * bw / 2; const v = (y % bh < 3 || xo % bw < 3) ? 30 : 170 + n(x / 4, y / 4) * 60; return [v, v, v]; }); rough = 0.85; strength = 3; }
  if (kind === 'asphalt') { px(a, (x, y) => { const k = 0.8 + fbm(n, x / 2, y / 2, 3) * 0.35 + (r() < 0.02 ? 0.4 : 0); return B.map(c => c * k); }); px(hg, (x, y) => { const v = 90 + n(x / 1.5, y / 1.5) * 120; return [v, v, v]; }); rough = 0.8; strength = 1.5; }
  if (kind === 'plaster') { px(a, (x, y) => { const k = 0.9 + fbm(n, x / 20, y / 20) * 0.18; return B.map(c => c * k); }); px(hg, (x, y) => { const v = 120 + fbm(n, x / 3, y / 3) * 60; return [v, v, v]; }); rough = 0.9; strength = 0.8; }
  if (kind === 'tile' || kind === 'pave') { const t = kind === 'tile' ? S / 8 : S / 4; px(a, (x, y) => { const g = (x % t < 3 || y % t < 3); if (g) return kind === 'tile' ? [120, 120, 115] : [90, 88, 84]; const k = 0.92 + ((Math.floor(x / t) * 13 + Math.floor(y / t) * 7) % 5) / 40 + n(x / 10, y / 10) * 0.06; return B.map(c => c * k); });
    px(hg, (x, y) => { const v = (x % t < 3 || y % t < 3) ? 20 : 200; return [v, v, v]; }); rough = kind === 'tile' ? 0.15 : 0.75; strength = 3; }
  if (kind === 'steel') { px(a, (x, y) => { const k = 0.85 + n(x / 0.6, y / 40) * 0.2; return B.map(c => c * k); }); px(hg, (x, y) => { const v = 128 + n(x / 0.5, y / 60) * 40; return [v, v, v]; }); rough = 0.32; strength = 0.6; }
  if (kind === 'foam') { const t = S / 8; px(a, (x, y) => { const u = (x % t) / t - 0.5, v = (y % t) / t - 0.5, k = 0.6 + (0.5 - Math.max(Math.abs(u), Math.abs(v))) * 0.9; return B.map(c => c * k); }); px(hg, (x, y) => { const u = (x % t) / t - 0.5, v = (y % t) / t - 0.5, h = (0.5 - Math.max(Math.abs(u), Math.abs(v))) * 2 * 255; return [h, h, h]; }); rough = 1; strength = 4; }
  px(rg, (x, y) => { const v = Math.min(255, Math.max(0, rough * 255 * (0.85 + n(x / 12 + 50, y / 12) * 0.3))); return [v, v, v]; });
  const tex = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; if (o.rep) t.repeat.set(...o.rep); return t; };
  const m = new THREE.MeshStandardMaterial({ map: tex(ac, true), normalMap: tex(normalFrom(hc, strength)), roughnessMap: tex(rc), roughness: 1, metalness: kind === 'steel' ? 1 : 0, envMapIntensity: o.env ?? 1 });
  return (cache[key] = m); }
// soft round sprite
export function softTex(kind = 'soft') { const [c, g] = C(128); if (kind === 'flame') { const gr = g.createRadialGradient(64, 70, 2, 64, 64, 62); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
  else { const n = noise2(11); const im = g.createImageData(128, 128); for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) { const d = Math.hypot(x - 64, y - 64) / 64, f = Math.max(0, 1 - d) ** 1.6 * (kind === 'smoke' ? 0.55 + fbm(n, x / 14, y / 14) * 0.9 : 1), i = (y * 128 + x) * 4; im.data[i] = im.data[i + 1] = im.data[i + 2] = 255; im.data[i + 3] = Math.min(255, f * 255); } g.putImageData(im, 0, 0); }
  const t = new THREE.CanvasTexture(c); return t; }
// stateless particle field: spawn(i, k (0..1 of life), seedRand, out) fills out.{x,y,z,s,a,r,g,b}; life per particle
export class Particles extends THREE.Points {
  constructor(n, { tex, additive = false, life = 1, spawn, H = 1080, fov = 35 }) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('aS', new THREE.Float32BufferAttribute(new Float32Array(n), 1)); g.setAttribute('aA', new THREE.Float32BufferAttribute(new Float32Array(n), 1)); g.setAttribute('aC', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    const m = new THREE.ShaderMaterial({ uniforms: { uT: { value: tex }, uScale: { value: H / (2 * Math.tan(fov * Math.PI / 360)) } }, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: 'attribute float aS; attribute float aA; attribute vec3 aC; varying float vA; varying vec3 vC; uniform float uScale; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aS * uScale / max(0.05,-mv.z); vA = aA; vC = aC; }',
      fragmentShader: 'uniform sampler2D uT; varying float vA; varying vec3 vC; void main(){ vec4 t = texture2D(uT, gl_PointCoord); gl_FragColor = vec4(vC * t.rgb, t.a * vA); }' });
    super(g, m); this.n = n; this.life = life; this.spawn = spawn; this.frustumCulled = false; this.seeds = Array.from({ length: n }, (_, i) => rng(i * 7919 + 13)()); this.renderOrder = 5; }
  at(t, on = 1) { const P = this.geometry.attributes.position.array, S = this.geometry.attributes.aS.array, A = this.geometry.attributes.aA.array, Cc = this.geometry.attributes.aC.array, o = {};
    for (let i = 0; i < this.n; i++) { const L = this.life * (0.7 + this.seeds[i] * 0.6), ph = t / L + this.seeds[i], cyc = Math.floor(ph), k = ph - cyc; Object.assign(o, { x: 0, y: 0, z: 0, s: 0, a: 0, r: 1, g: 1, b: 1 });
      this.spawn(i, k, rng(i * 131 + cyc * 977), o, t); P[i * 3] = o.x; P[i * 3 + 1] = o.y; P[i * 3 + 2] = o.z; S[i] = o.s; A[i] = o.a * on; Cc[i * 3] = o.r; Cc[i * 3 + 1] = o.g; Cc[i * 3 + 2] = o.b; }
    for (const k of ['position', 'aS', 'aA', 'aC']) this.geometry.attributes[k].needsUpdate = true; }
}
// fire colour ramp over life k
export function fireCol(k, o) { const t = Math.min(1, k * 1.6); o.r = 1.0 * (1 - t * 0.2) * 3; o.g = (0.85 - t * 0.6) * 2.4; o.b = Math.max(0, 0.5 - t) * 1.6; }
// displaced lumpy geometry (food)
export function lumpy(geo, amp, seed) { const n = noise2(seed), p = geo.attributes.position, v = new THREE.Vector3(); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const d = 1 + (fbm(n, v.x * 9 + 20, v.y * 9 + v.z * 7 + 20, 3) - 0.5) * amp; v.multiplyScalar(d); p.setXYZ(i, v.x, v.y, v.z); } geo.computeVertexNormals(); return geo; }
export function canvasTex(w, h, draw) { const [c, g] = C(w, h); draw(g, w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; }
export { noise2, fbm };
