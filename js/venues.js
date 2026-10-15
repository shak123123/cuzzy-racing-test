// Places you can walk into: a cinema (YouTube films / shows on the big screen), a club, a gun shop, two food shops
// (Broad Street area) and Birmingham's three big mosques (Central Mosque, Ghamkol Sharif, Green Lane). Each has a lit
// door, a neon sign and a GTA-style marker on the street, an icon on the minimap / full map, and its own interior,
// built on entry 400 m below the city (one at a time, disposed on leaving, to keep phone memory down).
import * as THREE from 'three';
import { buildPerson, animPerson } from './person.js';
import { mergeGeometries } from './lib/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from './lib/addons/environments/RoomEnvironment.js';
const $ = s => document.querySelector(s);
export const BASE_Y = -400;
const SPOTS = [ // [id, name, kind, lat, lon, colour]
  ['cinema', 'CUZZY CINEMA', 'cinema', 52.4766, -1.9128, '#ffcc33'],
  ['club', 'FLAMINGO CLUB', 'club', 52.4774, -1.9111, '#ff3fa4'],
  ['guns', 'AMMU-BRUM', 'guns', 52.4760, -1.9150, '#ff5a3a'],
  ['balti', 'BALTI HOUSE', 'food', 52.4770, -1.9139, '#ffa020'],
  ['chicken', 'CUZZY CHICKEN', 'food', 52.4779, -1.9097, '#ff3030'],
  ['library', 'LIBRARY OF BIRMINGHAM', 'library', 52.4797, -1.9086, '#e8c34a'],
  ['museum', 'MUSEUM & ART GALLERY', 'museum', 52.4801, -1.9036, '#c9a0ff'],
  ['bullring', 'BULLRING', 'shop', 52.4775, -1.8937, '#4ac8ff'],
  ['mailbox', 'THE MAILBOX', 'shop', 52.4760, -1.9035, '#ff6a3a'],
  ['gym', 'CUZZY GYM', 'gym', 52.4752, -1.8840, '#7aff6a'],
  ['barber', 'BRUM BARBERS', 'barber', 52.4785, -1.9000, '#ff4a6a']];
const MOSQUES = { centralmosque: 'BIRMINGHAM CENTRAL MOSQUE', ghamkol: 'GHAMKOL SHARIF MASJID', greenlane: 'GREEN LANE MASJID' };
export const ICON = { cinema: '🎬', club: '🍸', guns: '🔫', food: '🍴', mosque: '🕌', library: '📚', museum: '🖼', shop: '🛍', gym: '🏋', barber: '💈' };
export const SHOP = { // must match server SHOP prices
  guns: [['pistol', 'Pistol', 500], ['smg', 'SMG', 1500], ['shotgun', 'Shotgun', 1200], ['armour', 'Body armour', 400]],
  food: [['burger', 'Burger meal', 40], ['balti', 'Chicken balti + naan', 60], ['chicken', 'Wings + chips', 35]],
  club: [['drink', 'Drink at the bar', 20], ['vip', 'VIP booth', 300]],
  cinema: [['popcorn', 'Popcorn', 15]] };
export const FILMS = [ // free, embeddable films and the Knight Rider theme; any YouTube link can be pasted too
  ['Big Buck Bunny', 'aqz-KE-bpKQ'], ['Sintel', 'eRsGyueVLvQ'], ['Tears of Steel', 'R6MlUcmOul8'], ['Knight Rider theme', 'oNyXYPhnUIs']];
export function ytId(s) { s = String(s || '').trim(); const m = s.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/); return m ? m[1] : /^[\w-]{11}$/.test(s) ? s : null; }
const M = (c, r = 0.8, m = 0, e) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...(e != null ? { emissive: e, emissiveIntensity: 1 } : {}) });
function canvasTex(w, h, draw, rep) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); } t.anisotropy = 4; return t; }
function neon(text, col, w = 4, h = 0.9, sub) { const t = canvasTex(512, 116, (g, W, H) => { g.fillStyle = '#07070a'; g.fillRect(0, 0, W, H); g.strokeStyle = col; g.lineWidth = 4; g.strokeRect(6, 6, W - 12, H - 12);
    g.font = `800 ${sub ? 50 : 62}px system-ui,Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = col; g.shadowBlur = 18; g.fillStyle = '#fff'; g.fillText(text, W / 2, sub ? H * 0.4 : H / 2, W - 30);
    if (sub) { g.font = '600 26px system-ui,Arial'; g.shadowBlur = 6; g.fillStyle = col; g.fillText(sub, W / 2, H * 0.8, W - 30); } });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, toneMapped: false })); }

export class Venues {
  constructor(sess) {
    this.s = sess; this.w = sess.w; this.list = []; this.group = new THREE.Group(); sess.group.add(this.group); this.inside = null; this.t = 0;
    const data = sess.app.data, [lat0, lon0] = data.origin, ll = (la, lo) => [(lo - lon0) * 111320 * Math.cos(lat0 * Math.PI / 180), -(la - lat0) * 110574];
    for (const [id, name, kind, la, lo, col] of SPOTS) { const [x, z] = ll(la, lo); this.add({ id, name, kind, col }, x, z, null); }
    for (const [k, nm] of Object.entries(MOSQUES)) { const o = data.east?.[k]; if (!o?.p) continue; const p = []; for (let i = 0; i < o.p.length; i += 2) p.push([o.p[i] / 10, o.p[i + 1] / 10]);
      const cx = p.reduce((a, q) => a + q[0], 0) / p.length, cz = p.reduce((a, q) => a + q[1], 0) / p.length; this.add({ id: k, name: nm, kind: 'mosque', col: '#3fd38a' }, cx, cz, p); }
  }
  // the door sits on the pavement facing the nearest road (mosques: on the building wall nearest the road)
  // p54: a venue without its own footprint takes the nearest real building (brum.json footprint within 45 m of the spot)
  footprintNear(x, z) { let best = null, bd = 45; for (const b of this.s.app.data.buildings || []) { const q = b.p; let cx = 0, cz = 0; for (let i = 0; i < q.length; i += 2) { cx += q[i]; cz += q[i + 1]; } cx /= q.length / 2 * 10; cz /= q.length / 2 * 10;
      if (Math.abs(cx - x) > 80 || Math.abs(cz - z) > 80) continue; let d = 1e9; for (let i = 0; i < q.length; i += 2) d = Math.min(d, Math.hypot(q[i] / 10 - x, q[i + 1] / 10 - z)); d = Math.min(d, Math.hypot(cx - x, cz - z));
      if (d < bd) { bd = d; best = []; for (let i = 0; i < q.length; i += 2) best.push([q[i] / 10, q[i + 1] / 10]); } } return best; }
  add(v, x, z, poly) {
    if (!poly) poly = this.footprintNear(x, z); v.fixed = !!poly;
    let r = this.w.nearestRoad(x, z); for (let d = 25; !r && d <= 200; d += 25) for (const [ox, oz] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d], [d, -d], [-d, d]]) { const q = this.w.nearestRoad(x + ox, z + oz); if (q) { r = q; x = q.px + (x - q.px) * 0.15; z = q.pz + (z - q.pz) * 0.15; break; } } if (!r) return; /* nearest street, searching wider for set-back buildings */ let dx, dz, yaw;
    let best = null; if (poly) { let bd = 1e9; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 3) continue; for (const t of [0.2, 0.35, 0.5, 0.65, 0.8]) { const px = a[0] + (b[0] - a[0]) * t, pz = a[1] + (b[1] - a[1]) * t, rr = this.w.nearestRoad(px, pz); if (rr && rr.d < bd && rr.d > rr.hw + 2.2 && !(() => { const ox = rr.px - px, oz = rr.pz - pz, l = Math.hypot(ox, oz) || 1; return this.w.collide?.(px + ox / l * 1.5, pz + oz / l * 1.5, 0.32, rr.h ?? 0); })()) { bd = rr.d; best = [px, pz, rr]; } } }
      if (!best) { poly = null; } }
    if (poly) { const [px, pz, rr] = best; v.poly = poly; const ox = rr.px - px, oz = rr.pz - pz, l = Math.hypot(ox, oz) || 1; dx = px + ox / l * 0.62; dz = pz + oz / l * 0.62; /* p54: frame flush on the facade */ yaw = Math.atan2(-ox, -oz) + Math.PI; }
    else { const side = Math.sign((x - r.px) * r.nx + (z - r.pz) * r.nz) || 1, off = r.hw + 2.9; dx = r.px + r.nx * side * off; dz = r.pz + r.nz * side * off;
      const C = (ax, az) => this.w.collide?.(ax, az, 0.32, r.h ?? 0) || this.w.collide?.(ax - r.nx * side * 0.9, az - r.nz * side * 0.9, 0.32, r.h ?? 0);
      if (C(dx, dz)) for (const t of [6, -6, 12, -12, 20, -20, 30, -30, 45, -45]) { const q = this.w.nearestRoad(r.px + r.dx * t, r.pz + r.dz * t); if (!q) continue; const ex = q.px + q.nx * side * (q.hw + 2.6), ez = q.pz + q.nz * side * (q.hw + 2.6); if (!C(ex, ez)) { dx = ex; dz = ez; r = q; break; } } /* p54: slide along the street to a clear stretch of pavement */
      yaw = Math.atan2(-r.nx * side, -r.nz * side); /* p54: back of the pavement, door facing the road */ } // door faces the road; player enters walking away from it
    const h = this.w.groundAt(dx, dz, r.h ?? 0).h ?? 0; Object.assign(v, { x: dx, z: dz, y: h, yaw }); this.list.push(v);
    const G = new THREE.Group(); G.position.set(dx, h, dz); G.rotation.y = yaw; this.group.add(G); v.g = G; // local -Z = into the building
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.7, 0.3), M(0x15161a, 0.6)); frame.position.set(0, 1.35, -0.45); G.add(frame);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.4), M(0x111111, 0.4, 0.2, new THREE.Color(v.col).multiplyScalar(0.35))); door.position.set(0, 1.2, -0.29); G.add(door);
    const sign = neon(v.name, v.col, v.kind === 'mosque' ? 5 : 3.6, 0.82, v.kind === 'mosque' ? 'Visitors welcome · shoes off inside' : null); sign.position.set(0, 3.25, -0.28); G.add(sign);
    if (v.kind === 'mosque') { const cr = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.06, 8, 24, Math.PI * 1.45), new THREE.MeshBasicMaterial({ color: 0x3fd38a, toneMapped: false })); cr.position.set(0, 4.15, -0.3); cr.rotation.z = 2.2; G.add(cr); }
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.4, 28, 1, true), new THREE.MeshBasicMaterial({ color: v.col, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    ring.position.set(0, 0.7, 0.9); G.add(ring); v.ring = ring; // the walk-in marker in front of the door
  }
  near(p, r = 1.8) { let best = null, bd = r; for (const v of this.list) { const fx = v.x + Math.sin(v.yaw) * -0.9 * -1, d = Math.hypot(p.x - (v.x + Math.sin(v.yaw) * 0.9), p.z - (v.z + Math.cos(v.yaw) * 0.9)); if (d < bd) { bd = d; best = v; } } return best; }
  step(dt) { this.t += dt; for (const v of this.list) { v.ring.material.opacity = 0.22 + 0.14 * Math.sin(this.t * 3); v.ring.rotation.y += dt; } this.inside?.step?.(dt); }
  // ------------------------------------------------------------------ interiors
  enter(v) {
    const I = this.inside = { v, g: new THREE.Group(), npcs: [], step: null, spots: [] }; I.g.position.set(0, BASE_Y, 0); this.s.scene.add(I.g);
    MC = new Map(); const build = { cinema: cinemaRoom, club: clubRoom, guns: gunRoom, food: foodRoom, mosque: mosqueRoom, library: hallRoom, museum: hallRoom, shop: hallRoom, gym: hallRoom, barber: hallRoom }[v.kind]; const info = build(I, v, this);
    I.entry = info.entry; I.bounds = info.bounds; I.info = info; this.indoorLook(I, info); return I;
  }
  // interiors are lit only by their own fittings: a small room environment for reflections (glass, chrome, varnish)
  // instead of the sky, and the outdoor sun / sky fill switched off while inside (restored on leaving)
  indoorLook(I, info) {
    const G = this.s.g; let env = null;
    try { if (!this.env && G?.r) { const pm = new THREE.PMREMGenerator(G.r), re = new RoomEnvironment(); this.env = pm.fromScene(re, 0.04).texture; pm.dispose(); re.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); } env = this.env; } catch (e) { env = null; }
    const ei = info.envI ?? 0.5; I.g.traverse(o => { if (!o.isMesh) return; for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.isMeshStandardMaterial && !m.envMap && env) { m.envMap = env; m.envMapIntensity = m.userData.ei ?? ei; } });
    const sc = this.s.scene; if (G?.sun && sc) { const prev = sc.onBeforeRender, sun = G.sun, hemi = G.hemi;
      I.lit = { prev, sI: sun.intensity, hI: hemi?.intensity }; sc.onBeforeRender = function (...a) { prev?.apply(this, a); if (I.lit && I.lit.on) { I.lit.sI = sun.intensity || I.lit.sI; sun.intensity = 0; if (hemi) { I.lit.hI = hemi.intensity || I.lit.hI; hemi.intensity = 0; } } };
      I.lit.on = true; I.lit.restore = () => { I.lit.on = false; sc.onBeforeRender = prev || function () { }; sun.intensity = I.lit.sI; if (hemi) hemi.intensity = I.lit.hI; G.placeSun?.(); }; }
  }
  leave() { const I = this.inside; if (!I) return; this.inside = null; I.stopFx?.(); I.lit?.restore?.(); this.s.scene.remove(I.g);
    I.g.traverse(o => { if (o.isMesh || o.isPoints) { o.geometry?.dispose(); const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { if (!m) continue; for (const k of ['map', 'bumpMap', 'emissiveMap', 'roughnessMap', 'alphaMap']) if (m[k] && m[k] !== this.env) m[k].dispose(); m.dispose(); } } if (o.isInstancedMesh) o.dispose?.(); }); }
  dispose() { this.leave(); this.env?.dispose(); this.env = null; this.s.group.remove(this.group); }
}
// ------------------------------------------------------------------ interior toolkit
// Everything static in a room goes through a Kit: geometry is transformed and bucketed by material, then merged, so a
// whole room is a few dozen draw calls. Textures are drawn on canvases (≤1024 px) and reused as bump maps; UVs are in
// metres (texture.repeat = 1 / pattern size) so tiles, planks and carpet keep real proportions on every surface.
const SRGB = THREE.SRGBColorSpace, PI = Math.PI;
let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647); const rr = (a, b) => a + (b - a) * rnd();
const shade = (hex, l, s = 0) => '#' + new THREE.Color(hex).offsetHSL(0, s, l).getHexString();
// photo micro-detail (CC0 ambientCG scans, high-passed to grey): overlaid onto the drawn canvases so wood grain, stone,
// weave, plaster and carpet pile read as real surfaces (and feed the bump / normal maps)
const DET = {}; for (const k of ['wood', 'marble', 'fabric', 'plaster', 'carpet', 'leather']) { const i = new Image(); i.src = 'real/tex/d_' + k + '.jpg'; DET[k] = i; }
function detail(g, w, h, kind, a = 0.5, sc = 1) { const im = DET[kind]; if (!im || !im.complete || !im.naturalWidth) return; const p = g.createPattern(im, 'repeat'); if (!p) return; if (p.setTransform) p.setTransform(new DOMMatrix().scale(sc * w / 1024));
  g.save(); g.globalCompositeOperation = 'overlay'; g.globalAlpha = a; g.fillStyle = p; g.fillRect(0, 0, w, h); g.restore(); }
function cv(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); return c; }
function tx(c, size, srgb = true) { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = SRGB; t.wrapS = t.wrapT = THREE.RepeatWrapping; if (size) t.repeat.set(1 / size[0], 1 / size[1]); t.anisotropy = 4; return t; }
function grain(g, w, h, amt, mono = true) { const d = g.getImageData(0, 0, w, h), p = d.data; for (let i = 0; i < p.length; i += 4) { const n = (rnd() - 0.5) * amt; if (mono) { p[i] += n; p[i + 1] += n; p[i + 2] += n; } else { p[i] += n; p[i + 1] += (rnd() - 0.5) * amt; p[i + 2] += (rnd() - 0.5) * amt; } } g.putImageData(d, 0, 0); }
// material from a canvas: colour map doubles as the bump map (grout / plank seams / weave read as recessed)
function pbr(c, size, o = {}) { if (o.det) detail(c.getContext('2d'), c.width, c.height, o.det, o.da ?? 0.55, o.ds ?? 1); const t = tx(c, size); const m = new THREE.MeshStandardMaterial({ map: t, roughness: o.r ?? 0.7, metalness: o.m ?? 0, ...(o.bump !== 0 ? { bumpMap: t, bumpScale: o.bump ?? 1 } : {}), ...(o.color ? { color: o.color } : {}), ...(o.side ? { side: o.side } : {}) }); if (o.ei != null) m.userData.ei = o.ei; return m; }
// materials are memoised per room (same parameters → same material → merged into the same draw call)
let MC = new Map(); const memo = (k, f) => { let m = MC.get(k); if (!m) MC.set(k, m = f()); return m; };
const STD = (c, r = 0.7, m = 0, { ei, ...o } = {}) => memo('s' + c + '|' + r + '|' + m + '|' + ei + '|' + JSON.stringify(o), () => { const x = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...o }); if (ei != null) x.userData.ei = ei; return x; });
const GLOW = (c, o = {}) => memo('g' + c + JSON.stringify(o), () => new THREE.MeshBasicMaterial({ color: c, toneMapped: false, ...o }));
const GLASS = (o = {}) => STD(0xd8e6ec, 0.04, 0.1, { transparent: true, opacity: 0.16, depthWrite: false, ...o });
const VC = (r = 0.6, m = 0) => STD(0xffffff, r, m, { vertexColors: true });
// --- canvases
function woodCv(base, { w = 1024, h = 1024, planks = 4, dark = 0.12, seams = true, knots = 3 } = {}) { return cv(w, h, (g) => { const ph = h / planks;
  for (let i = 0; i < planks; i++) { const y0 = i * ph, cut = rnd() * w, col = shade(base, rr(-0.05, 0.05)); g.fillStyle = col; g.fillRect(0, y0, w, ph);
    for (let k = 0; k < ph * 0.7; k++) { const y = y0 + rnd() * ph, a = rr(0.03, 0.16), f = rr(0.004, 0.012), ph2 = rnd() * 9, amp = rr(0.5, 3); g.strokeStyle = rnd() < 0.7 ? `rgba(30,15,5,${a})` : `rgba(255,230,190,${a * 0.6})`; g.lineWidth = rr(0.6, 2.2); g.beginPath();
      for (let x = 0; x <= w; x += 16) g.lineTo(x, Math.min(y0 + ph - 1, Math.max(y0 + 1, y + Math.sin(x * f + ph2) * amp + Math.sin(x * f * 3.1) * amp * 0.3))); g.stroke(); }
    for (let k = 0; k < knots * rnd(); k++) { const kx = rnd() * w, ky = y0 + rr(0.25, 0.75) * ph; for (let r = 9; r > 1; r -= 2) { g.strokeStyle = `rgba(40,20,8,${0.25})`; g.beginPath(); g.ellipse(kx, ky, r * 2.2, r * 0.7, 0, 0, PI * 2); g.stroke(); } }
    if (seams) { g.fillStyle = 'rgba(10,5,2,0.75)'; g.fillRect(0, y0, w, 2); g.fillRect(cut, y0, 2, ph); } }
  detail(g, w, h, 'wood', 0.7, 1); grain(g, w, h, 6); g.fillStyle = `rgba(0,0,0,${dark})`; g.fillRect(0, 0, w, h); }); }
function tileCv(cols, { w = 1024, h = 1024, nx = 4, ny = 4, grout = '#9a958c', gw = 3, jit = 0.04, bevel = 0.18, offset = 0, speck = 12, pattern } = {}) { return cv(w, h, (g) => {
  g.fillStyle = grout; g.fillRect(0, 0, w, h); const tw = w / nx, th = h / ny;
  for (let j = 0; j < ny; j++) for (let i = -1; i < nx + 1; i++) { const x = i * tw + (j % 2 ? offset * tw : 0), y = j * th, c = cols[(i + j * 7 + 99) % cols.length]; g.fillStyle = shade(c, rr(-jit, jit)); g.fillRect(x + gw / 2, y + gw / 2, tw - gw, th - gw);
    if (pattern) { g.save(); g.translate(x + tw / 2, y + th / 2); pattern(g, tw - gw, th - gw, i, j); g.restore(); }
    const gr = g.createLinearGradient(x, y, x + tw, y + th); gr.addColorStop(0, `rgba(255,255,255,${bevel})`); gr.addColorStop(0.15, 'rgba(255,255,255,0)'); gr.addColorStop(0.85, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${bevel})`); g.fillStyle = gr; g.fillRect(x + gw / 2, y + gw / 2, tw - gw, th - gw); }
  detail(g, w, h, 'marble', 0.35, 1); grain(g, w, h, speck * 0.6); }); }
function fabricCv(base, { w = 512, h = 512, amt = 26, stripes = 0, weave = true } = {}) { return cv(w, h, (g) => { g.fillStyle = base; g.fillRect(0, 0, w, h);
  if (weave) for (let y = 0; y < h; y += 2) { g.fillStyle = `rgba(0,0,0,${y % 4 ? 0.06 : 0.0})`; g.fillRect(0, y, w, 1); } for (let x = 0; x < w; x += 2) { g.fillStyle = 'rgba(255,255,255,0.03)'; g.fillRect(x, 0, 1, h); }
  if (stripes) for (let x = 0; x < w; x += w / stripes) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, 0, 2, h); } detail(g, w, h, 'fabric', 0.65, 2); grain(g, w, h, amt * 0.6, false); }); }
function plasterCv(base, { w = 512, h = 512, amt = 9 } = {}) { return cv(w, h, (g) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${rr(0.006, 0.018)})`; g.beginPath(); g.arc(rnd() * w, rnd() * h, rr(4, 26), 0, PI * 2); g.fill(); } detail(g, w, h, 'plaster', 0.55, 1); grain(g, w, h, amt * 0.6); }); }
function brushedCv(base = '#b8bcc0', { w = 256, h = 256 } = {}) { return cv(w, h, (g) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${rr(0.02, 0.09)})`; g.fillRect(rnd() * w - 40, rnd() * h, rr(30, 160), 1); } }); }
// pointed (two-centred) arch outline into a Path / Shape, springing at s, apex at a
function arch(p, w, s, a, cx = 0, y0 = 0, close = true) { const l = cx - w / 2, r = cx + w / 2; p.moveTo(l, y0); p.lineTo(l, s); p.bezierCurveTo(l, s + (a - s) * 0.55, cx - w * 0.16, a - (a - s) * 0.12, cx, a); p.bezierCurveTo(cx + w * 0.16, a - (a - s) * 0.12, r, s + (a - s) * 0.55, r, s); p.lineTo(r, y0); if (close) p.lineTo(l, y0); return p; }
function archCv(g, w, s, a, cx, y0) { g.beginPath(); arch(g, w, s, a, cx, y0); g.closePath(); }
function rrect(p, w, h, r, cx = 0, cy = 0) { const x = cx - w / 2, y = cy - h / 2; r = Math.min(r, w / 2, h / 2); p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.quadraticCurveTo(x + w, y, x + w, y + r); p.lineTo(x + w, y + h - r); p.quadraticCurveTo(x + w, y + h, x + w - r, y + h); p.lineTo(x + r, y + h); p.quadraticCurveTo(x, y + h, x, y + h - r); p.lineTo(x, y + r); p.quadraticCurveTo(x, y, x + r, y); return p; }
// 8-point-star (khatam) girih tile into a canvas cell: the base of the mosque's geometric patterns
function star8(g, cx, cy, R, fill, stroke, lw = 2) { g.beginPath(); for (let k = 0; k < 16; k++) { const a = k * PI / 8 - PI / 8, r = k % 2 ? R * 0.62 : R; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } g.closePath(); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); } }
// --- geometry (all with metre-scale UVs)
function BX(w, h, d) { const b = new THREE.BoxGeometry(w, h, d), uv = b.attributes.uv; const S = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * S[f][0], uv.getY(i) * S[f][1]); } return b; }
function PL(w, h) { const p = new THREE.PlaneGeometry(w, h), uv = p.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h); return p; }
function RB(w, h, d, r = 0.03, seg = 1) { const b = Math.max(0.002, Math.min(r, d * 0.45, w * 0.3, h * 0.3)), s = rrect(new THREE.Shape(), w - 2 * b, h - 2 * b, b * 0.9);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: seg, curveSegments: 2 }); g.translate(0, 0, -(d - 2 * b) / 2); return g; }
const CY = (rt, rb, h, n = 12, open = false, t0 = 0, tl = PI * 2) => new THREE.CylinderGeometry(rt, rb, h, n, 1, open, t0, tl);
const SP = (r, a = 10, b = 7) => new THREE.SphereGeometry(r, a, b);
const LA = (pts, n = 12) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), n);
const EX = (shape, depth, bev = 0, o = {}) => { const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: 1, curveSegments: o.cs ?? 6 }); g.translate(0, 0, -depth / 2); return g; };
function cellUV(geo, i, cols, rows) { const uv = geo.attributes.uv, cx = i % cols, cy = Math.floor(i / cols); for (let k = 0; k < uv.count; k++) uv.setXY(k, (cx + uv.getX(k)) / cols, 1 - (cy + 1 - uv.getY(k)) / rows); return geo; }
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
class Kit {
  constructor(parent) { this.g = parent; this.b = new Map(); this.base = new THREE.Matrix4(); }
  // add(geometry, material, x, y, z, yaw, pitch, roll, sx, sy, sz[, vertexColour])
  add(geo, mat, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1, col) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone(); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)).premultiply(this.base); g.applyMatrix4(_m);
    if (mat.vertexColors) { _c.set(col ?? 0xffffff); const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); }
    let l = this.b.get(mat); if (!l) this.b.set(mat, l = []); l.push(g); return g; }
  // run fn with a local frame (position + yaw [+ pitch]) so props can be modelled in their own coordinates
  at(x, y, z, ry, fn, rx = 0) { const old = this.base.clone(); _e.set(rx, ry, 0, 'YXZ'); this.base.multiply(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(_e), new THREE.Vector3(1, 1, 1))); fn(); this.base.copy(old); }
  done(order) { const out = []; for (const [mat, l] of this.b) { const geo = mergeGeometries(l, false); l.forEach(x => x.dispose()); if (!geo) continue; const m = new THREE.Mesh(geo, mat); m.matrixAutoUpdate = false; if (order != null || mat.transparent) m.renderOrder = order ?? 2; this.g.add(m); out.push(m); } this.b.clear(); return out; }
}
// ------------------------------------------------------------------ room helpers
// shell: floor, ceiling, four walls (optionally a dado band), skirting boards with a door gap on the +Z wall, soft fill
function room(I, w, d, h, floor, wall, ceil, o = {}) { const g = I.g, K = o.K || new Kit(g);
  K.add(PL(w, d), floor, 0, 0, 0, 0, -PI / 2); if (ceil !== false) K.add(PL(w, d), ceil || STD(0x1a1a1a), 0, h, 0, 0, PI / 2);
  for (const [px, pz, ry, len] of [[0, -d / 2, 0, w], [0, d / 2, PI, w], [-w / 2, 0, PI / 2, d], [w / 2, 0, -PI / 2, d]]) { K.add(PL(len, h), wall, px, h / 2, pz, ry);
    if (o.dado) { const dh = o.dadoH || 1.1; K.add(PL(len, dh), o.dado, px + Math.sin(ry) * 0.012, dh / 2, pz + Math.cos(ry) * 0.012, ry); if (o.rail) K.add(BX(len, 0.05, 0.035), o.rail, px + Math.sin(ry) * 0.02, dh + 0.02, pz + Math.cos(ry) * 0.02, ry); } }
  if (o.skirt !== false) { const sk = o.skirt || STD(0x222222, 0.5), sh = o.skirtH || 0.12, gap = o.gap ?? 1.7;
    K.add(BX(w, sh, 0.025), sk, 0, sh / 2, -d / 2 + 0.013); K.add(BX(d, sh, 0.025), sk, -w / 2 + 0.013, sh / 2, 0, PI / 2); K.add(BX(d, sh, 0.025), sk, w / 2 - 0.013, sh / 2, 0, PI / 2);
    const half = (w - gap) / 2; K.add(BX(half, sh, 0.025), sk, -w / 2 + half / 2, sh / 2, d / 2 - 0.013); K.add(BX(half, sh, 0.025), sk, w / 2 - half / 2, sh / 2, d / 2 - 0.013); }
  if (o.cornice) for (const [px, pz, ry, len] of [[0, -d / 2, 0, w], [0, d / 2, PI, w], [-w / 2, 0, PI / 2, d], [w / 2, 0, -PI / 2, d]]) K.add(BX(len, 0.09, 0.06), o.cornice, px + Math.sin(ry) * 0.03, h - 0.045, pz + Math.cos(ry) * 0.03, ry);
  // contact shadows (fake ambient occlusion) where the floor meets the walls and the walls meet the ceiling
  if (o.ao !== false) { const A = aoMat(); for (const [px, pz, ry, len] of [[0, -d / 2, 0, w], [0, d / 2, PI, w], [-w / 2, 0, PI / 2, d], [w / 2, 0, -PI / 2, d]]) { const sx = Math.sin(ry), sz = Math.cos(ry);
    K.add(PL(len, 0.7), A, px + sx * 0.35, 0.006, pz + sz * 0.35, ry, -PI / 2, PI); K.add(PL(len, 0.55), A, px + sx * 0.006, 0.275, pz + sz * 0.006, ry); if (ceil !== false) K.add(PL(len, 0.6), A, px + sx * 0.006, h - 0.3, pz + sz * 0.006, ry, 0, PI); } }
  const hemi = new THREE.HemisphereLight(o.sky ?? 0xffffff, o.gnd ?? 0x404040, o.hemi ?? 0.5); hemi.position.y = h; g.add(hemi);
  if (!o.K) K.done(); return { bounds: [w / 2 - 0.4, d / 2 - 0.4], entry: { x: 0, z: d / 2 - 1.2, yaw: 0 }, K }; }
function aoMat() { return memo('ao', () => { const c = cv(8, 128, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0.62)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const t = new THREE.CanvasTexture(c); return new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }); }); }
const box = (g, w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); g.add(m); return m; };
const lamp = (g, col, i, x, y, z, dist = 14, decay = 1.6) => { const l = new THREE.PointLight(col, i, dist, decay); l.position.set(x, y, z); g.add(l); return l; };
function npc(I, look, x, z, yaw, mode = 'idle', y = 0) { const p = buildPerson(look); p.position.set(x, y, z); p.rotation.y = yaw; I.g.add(p); I.npcs.push([p, mode]); return p; }
const stepNpcs = (I, dt) => { for (const [p, m] of I.npcs) animPerson(p, dt, 0, m === 'dance' ? 'dance' : m === 'sit' ? 'sit' : 'walk'); };
// lit sign / poster / menu canvases drawn into one atlas so a room's graphics cost one draw call
function atlas(cols, rows, cw, ch, cells, glow) { const c = cv(cols * cw, rows * ch, (g) => cells.forEach((f, i) => { g.save(); g.translate((i % cols) * cw, Math.floor(i / cols) * ch); g.beginPath(); g.rect(0, 0, cw, ch); g.clip(); f(g, cw, ch); g.restore(); }));
  const t = new THREE.CanvasTexture(c); t.colorSpace = SRGB; t.anisotropy = 4; return glow ? new THREE.MeshBasicMaterial({ map: t, toneMapped: false }) : new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }); }
const aPL = (w, h, i, cols, rows) => cellUV(new THREE.PlaneGeometry(w, h), i, cols, rows);
// exit door: architrave, door leaf with vision panel and push bar, lit EXIT box above. (x, z) on a wall; faces into the room
function exitDoor(I, z, col = '#19e6c1', x = 0, ry = PI) { const g = I.g, K = new Kit(g), nx = Math.sin(ry), nz = Math.cos(ry);
  K.at(x, 0, z, ry, () => { const fr = STD(0x2a2c30, 0.45, 0.6), leaf = STD(0x3b3f45, 0.55, 0.3), gl = GLOW(0x1d2a33);
    K.add(BX(0.1, 2.35, 0.08), fr, -0.82, 1.175, 0.03); K.add(BX(0.1, 2.35, 0.08), fr, 0.82, 1.175, 0.03); K.add(BX(1.74, 0.1, 0.08), fr, 0, 2.38, 0.03);
    K.add(RB(1.52, 2.28, 0.05, 0.01), leaf, 0, 1.15, 0.025); K.add(PL(0.32, 0.9), gl, 0.42, 1.55, 0.055); K.add(CY(0.018, 0.018, 1.2, 8), STD(0xc8ccd0, 0.25, 1), 0, 1.05, 0.1, 0, 0, PI / 2);
    K.add(BX(0.04, 0.06, 0.06), STD(0xc8ccd0, 0.25, 1), -0.55, 1.05, 0.075); K.add(BX(0.04, 0.06, 0.06), STD(0xc8ccd0, 0.25, 1), 0.55, 1.05, 0.075); });
  K.done(); const s = neon('EXIT', col, 0.9, 0.27); s.position.set(x + nx * 0.03, 2.62, z + nz * 0.03); s.rotation.y = ry; g.add(s);
  I.spots.push({ act: 'leave', x: x + nx * 1, z: z + nz * 1, r: 1.4, label: 'LEAVE' }); }
// common props
function chair(K, x, z, ry, wood, pad, { h = 0.46, back = 0.5 } = {}) { K.at(x, 0, z, ry, () => { for (const [a, b] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) K.add(CY(0.017, 0.014, h - 0.03, 6), wood, a, (h - 0.03) / 2, b);
  K.add(RB(0.44, 0.44, 0.05, 0.02), pad, 0, h - 0.005, 0, 0, -PI / 2); K.add(CY(0.017, 0.017, back + 0.03, 6), wood, -0.19, h + back / 2, 0.205); K.add(CY(0.017, 0.017, back + 0.03, 6), wood, 0.19, h + back / 2, 0.205); K.add(RB(0.42, 0.2, 0.03, 0.012), wood, 0, h + back - 0.1, 0.21, 0, -0.06); K.add(BX(0.36, 0.04, 0.02), wood, 0, h + 0.18, 0.205); }); }
function pendant(K, x, y, z, drop, shadeMat, bulb, cord, style = 'dome') { K.add(CY(0.006, 0.006, drop, 4), cord, x, y - drop / 2, z); K.add(CY(0.05, 0.05, 0.03, 10), cord, x, y - 0.015, z);
  if (style === 'dome') { K.add(LA([[0.02, 0.0], [0.07, -0.01], [0.17, -0.1], [0.22, -0.2], [0.215, -0.205], [0.165, -0.105], [0.065, -0.015], [0.02, -0.005]], 16), shadeMat, x, y - drop + 0.02, z); K.add(SP(0.06, 10, 8), bulb, x, y - drop - 0.12, z); }
  else if (style === 'lantern') { K.add(CY(0.12, 0.16, 0.34, 8, true), shadeMat, x, y - drop - 0.17, z); K.add(CY(0.03, 0.12, 0.08, 8), shadeMat, x, y - drop + 0.04, z); K.add(CY(0.1, 0.1, 0.24, 8), bulb, x, y - drop - 0.17, z); K.add(SP(0.03, 6, 4), shadeMat, x, y - drop - 0.37, z); } }
function plant(K, x, z, pot, leaf, s = 1) { K.add(CY(0.17 * s, 0.13 * s, 0.38 * s, 12), pot, x, 0.19 * s, z); K.add(CY(0.16 * s, 0.16 * s, 0.02, 12), STD(0x2a1d14, 1), x, 0.37 * s, z);
  for (let i = 0; i < 9; i++) { const a = i * 2.4, r = rr(0.05, 0.22) * s, hh = rr(0.55, 1.15) * s; K.add(SP(rr(0.14, 0.22) * s, 7, 5), leaf, x + Math.cos(a) * r, 0.38 * s + hh, z + Math.sin(a) * r, a, 0, 0, 1, 0.75, 1.2); }
  K.add(CY(0.012, 0.016, 0.9 * s, 5), STD(0x4a3a22, 0.9), x, 0.8 * s, z); }
function framePic(K, x, y, z, ry, w, h, frame, picGeo, picMat) { K.at(x, y, z, ry, () => { K.add(BX(w + 0.08, 0.04, 0.03), frame, 0, h / 2 + 0.02, 0.015); K.add(BX(w + 0.08, 0.04, 0.03), frame, 0, -h / 2 - 0.02, 0.015); K.add(BX(0.04, h, 0.03), frame, -w / 2 - 0.02, 0, 0.015); K.add(BX(0.04, h, 0.03), frame, w / 2 + 0.02, 0, 0.015); K.add(picGeo, picMat, 0, 0, 0.008); }); }
// ceiling: suspended 600 mm tiles in a white T-bar grid
const ceilTiles = (base = '#e8e6e0') => pbr(cv(256, 256, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(0,0,0,${rr(0.03, 0.12)})`; g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); } grain(g, w, h, 8); g.fillStyle = '#f6f6f4'; g.fillRect(0, 0, w, 7); g.fillRect(0, 0, 7, h); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 7, w, 2); g.fillRect(7, 0, 2, h); }), [0.6, 0.6], { r: 0.9, bump: 0.6 });
// fluorescent batten / troffer: white housing, opal diffuser or bare tubes, end caps
function troffer(K, x, y, z, len, wid, mats, ry = 0, tubes = 0) { K.at(x, y, z, ry, () => { K.add(RB(wid, 0.07, len, 0.012), mats.housing, 0, -0.035, 0, 0, 0, 0);
  if (tubes) { for (let i = 0; i < tubes; i++) { const ox = (i - (tubes - 1) / 2) * (wid / tubes) * 0.8; K.add(CY(0.014, 0.014, len - 0.08, 8), mats.tube, ox, -0.085, 0, 0, PI / 2); K.add(BX(0.035, 0.03, 0.03), mats.housing, ox, -0.085, len / 2 - 0.03); K.add(BX(0.035, 0.03, 0.03), mats.housing, ox, -0.085, -len / 2 + 0.03); } }
  else K.add(PL(wid - 0.04, len - 0.04), mats.tube, 0, -0.072, 0, 0, PI / 2); }); }

// ------------------------------------------------------------------ gun shop
// side-profile silhouettes (metres, muzzle to +X), extruded with a small bevel
const shp = pts => { const s = new THREE.Shape(); pts.forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y)); s.closePath(); return s; };
const GUNS = {
  ar: () => EX(shp([[-0.47, -0.07], [-0.47, 0.045], [-0.44, 0.05], [-0.3, 0.03], [-0.21, 0.03], [-0.2, 0.052], [0.07, 0.052], [0.08, 0.04], [0.34, 0.04], [0.34, 0.012], [0.53, 0.012], [0.53, -0.004], [0.34, -0.004], [0.34, -0.02], [0.0, -0.024], [-0.004, -0.03], [0.03, -0.155], [-0.025, -0.168], [-0.065, -0.032], [-0.1, -0.032], [-0.104, -0.048], [-0.13, -0.048], [-0.152, -0.13], [-0.19, -0.124], [-0.176, -0.022], [-0.21, -0.016], [-0.3, -0.01]]), 0.032, 0.004),
  stock: () => EX(shp([[-0.56, -0.095], [-0.56, 0.04], [-0.52, 0.045], [-0.3, 0.02], [-0.2, 0.004], [-0.12, 0.016], [0.34, 0.012], [0.34, -0.014], [0.0, -0.03], [-0.11, -0.032], [-0.16, -0.07], [-0.2, -0.066], [-0.22, -0.034], [-0.36, -0.045]]), 0.036, 0.005),
  pistol: () => EX(shp([[-0.095, 0.05], [0.1, 0.05], [0.1, 0.018], [-0.015, 0.015], [-0.018, -0.008], [-0.045, -0.012], [-0.05, 0.006], [-0.062, 0.008], [-0.078, -0.092], [-0.108, -0.092], [-0.093, 0.02]]), 0.026, 0.003),
  pump: () => EX(shp([[-0.5, -0.085], [-0.5, 0.036], [-0.18, 0.02], [-0.14, 0.004], [-0.14, -0.03], [-0.2, -0.052]]), 0.036, 0.005) };
function gun(K, kind, x, y, z, ry, rx, mats, sc = 1) { K.at(x, y, z, ry, () => { if (sc !== 1) K.base.scale(new THREE.Vector3(sc, sc, sc)); const { metal, poly, wood, glass } = mats;
  if (kind === 'ar') { K.add(GUNS.ar(), poly); K.add(CY(0.007, 0.007, 0.2, 8), metal, 0.62, 0.004, 0, 0, 0, PI / 2); K.add(BX(0.24, 0.012, 0.03), metal, -0.06, 0.058, 0); }
  else if (kind === 'hunt') { K.add(GUNS.stock(), wood); K.add(CY(0.009, 0.011, 0.66, 8), metal, 0.3, 0.024, 0, 0, 0, PI / 2); K.add(BX(0.24, 0.04, 0.03), metal, -0.02, 0.022, 0); K.add(CY(0.019, 0.019, 0.24, 10), metal, 0.03, 0.08, 0, 0, 0, PI / 2); K.add(CY(0.026, 0.019, 0.06, 10), metal, 0.17, 0.08, 0, 0, 0, PI / 2); K.add(CY(0.024, 0.019, 0.05, 10), metal, -0.11, 0.08, 0, 0, 0, PI / 2); K.add(BX(0.02, 0.03, 0.02), metal, -0.04, 0.054, 0); K.add(BX(0.02, 0.03, 0.02), metal, 0.1, 0.054, 0); }
  else if (kind === 'pump') { K.add(GUNS.pump(), wood); K.add(BX(0.22, 0.06, 0.034), metal, -0.04, 0.0, 0); K.add(CY(0.011, 0.011, 0.56, 8), metal, 0.34, 0.02, 0, 0, 0, PI / 2); K.add(CY(0.009, 0.009, 0.42, 8), metal, 0.28, -0.006, 0, 0, 0, PI / 2); K.add(CY(0.02, 0.02, 0.15, 10), wood, 0.24, -0.006, 0, 0, 0, PI / 2); }
  else { K.add(GUNS.pistol(), poly); K.add(BX(0.19, 0.005, 0.022), metal, 0.003, 0.051, 0); } }, rx); }
function gunRoom(I, v) { const g = I.g, W = 12, D = 9, H = 3.4; seed = 11;
  const K = new Kit(g), floor = pbr(tileCv(['#8e9092', '#888a8c', '#939597'], { nx: 2, ny: 2, grout: '#55585a', gw: 4, bevel: 0.08, speck: 10 }), [1.2, 1.2], { r: 0.32, bump: 0.5, ei: 0.35 });
  const wall = pbr(plasterCv('#a59f95'), [2, 2], { r: 0.9, bump: 0.25 }), dado = pbr(plasterCv('#34373b', { amt: 6 }), [2, 2], { r: 0.75, bump: 0.2 });
  const info = room(I, W, D, H, floor, wall, ceilTiles(), { K, dado, dadoH: 1.0, rail: STD(0x8a8f94, 0.35, 0.9), skirt: STD(0x1c1d1f, 0.5), skirtH: 0.1, sky: 0xe6edf5, gnd: 0x4a4640, hemi: 0.55 });
  const metal = STD(0x232427, 0.36, 0.8), poly = STD(0x18191b, 0.55, 0.1), wood = pbr(woodCv('#6a3b1f', { w: 256, h: 128, planks: 1, seams: false, knots: 0 }), [0.6, 0.1], { r: 0.42, bump: 0.3 }), gm = { metal, poly, wood };
  const steel = STD(0x9aa0a6, 0.4, 0.85), brass = STD(0xb08d3a, 0.35, 0.9);
  // back wall: slatwall panel with three rows of long guns on hooks
  const slat = pbr(cv(256, 256, (c, w, h) => { const base = '#8f8b84'; for (let y = 0; y < h; y += 32) { c.fillStyle = shade(base, rr(-0.03, 0.03)); c.fillRect(0, y, w, 32); c.fillStyle = 'rgba(0,0,0,0.85)'; c.fillRect(0, y + 26, w, 6); c.fillStyle = 'rgba(255,220,180,0.12)'; c.fillRect(0, y, w, 2); for (let k = 0; k < 14; k++) { c.fillStyle = `rgba(20,10,4,${rr(0.04, 0.12)})`; c.fillRect(0, y + rnd() * 24, w, 1); } } grain(c, w, h, 10); }), [1, 1.2], { r: 0.55, bump: 1.5 });
  K.add(PL(10.6, 1.95), slat, 0, 1.92, -D / 2 + 0.02); K.add(BX(10.7, 0.05, 0.04), STD(0x2a1a10, 0.5), 0, 2.92, -D / 2 + 0.03); K.add(BX(10.7, 0.05, 0.04), STD(0x2a1a10, 0.5), 0, 0.93, -D / 2 + 0.03);
  for (const [row, kind, n] of [[0, 'pump', 6], [1, 'hunt', 6], [2, 'ar', 7]]) for (let i = 0; i < n; i++) { const x = (i - (n - 1) / 2) * 1.42, y = 1.3 + row * 0.52; gun(K, kind, x, y, -D / 2 + 0.07, 0, 0, gm, 1.2);
    for (const hx of [-0.22, 0.2]) { K.add(CY(0.006, 0.006, 0.09, 6), steel, x + hx, y - 0.05, -D / 2 + 0.065, 0, PI / 2); K.add(BX(0.03, 0.03, 0.01), steel, x + hx, y - 0.05, -D / 2 + 0.025); } }
  // glass display counter: plinth, laminate carcass, brushed aluminium frame, glass case with pistols on velvet, LED strip
  const cz = -1.6, lam = STD(0x2b2d31, 0.5, 0.2), glass = GLASS(), felt = pbr(fabricCv('#2a0f12', { amt: 18 }), [0.3, 0.3], { r: 0.95, bump: 0.6 }), alu = pbr(brushedCv('#aeb3b8'), [0.5, 0.5], { r: 0.32, m: 0.9, bump: 0.1 });
  K.add(BX(6.9, 0.1, 0.6), STD(0x0e0e0f, 0.6), 0, 0.05, cz + 0.02); K.add(RB(7, 0.46, 0.7, 0.012), lam, 0, 0.33, cz); K.add(BX(7.02, 0.012, 0.04), alu, 0, 0.53, cz + 0.34);
  for (const zz of [0.34, -0.34]) for (const yy of [0.57, 1.0]) K.add(BX(7.02, 0.024, 0.024), alu, 0, yy, cz + zz);
  for (const xx of [-3.5, -1.75, 0, 1.75, 3.5]) for (const zz of [0.34, -0.34]) K.add(BX(0.024, 0.43, 0.024), alu, xx, 0.785, cz + zz);
  K.add(PL(7, 0.43), glass, 0, 0.785, cz + 0.345); K.add(PL(7, 0.43), glass, 0, 0.785, cz - 0.345, PI); K.add(PL(0.69, 0.43), glass, -3.505, 0.785, cz, -PI / 2); K.add(PL(0.69, 0.43), glass, 3.505, 0.785, cz, PI / 2); K.add(PL(7, 0.69), glass, 0, 1.012, cz, 0, -PI / 2);
  K.add(BX(6.96, 0.02, 0.66), felt, 0, 0.59, cz); K.add(BX(6.9, 0.012, 0.022), GLOW(0xfff3dc), 0, 0.985, cz + 0.3); K.add(BX(6.9, 0.012, 0.022), GLOW(0xfff3dc), 0, 0.985, cz - 0.3);
  const tag = STD(0xf2efe6, 0.8); for (let i = 0; i < 12; i++) { const x = -3.15 + i * 0.57; gun(K, 'pistol', x, 0.615, cz + (i % 2 ? 0.08 : -0.05), rr(-0.3, 0.3), -PI / 2, gm); K.add(BX(0.07, 0.003, 0.04), tag, x + 0.06, 0.602, cz + 0.24); }
  gun(K, 'ar', -2.2, 0.62, cz - 0.05, 0.05, -PI / 2, gm); // a carbine laid in the case
  // till, card reader and a stool behind the counter
  K.add(RB(0.36, 0.1, 0.3, 0.02), STD(0x1d1e20, 0.4), 2.7, 1.07, cz - 0.05); K.add(RB(0.3, 0.22, 0.02, 0.008), STD(0x111214, 0.3), 2.7, 1.26, cz - 0.1, 0, -0.35); K.add(PL(0.26, 0.17), GLOW(0x3a78a8), 2.7, 1.262, cz - 0.088, 0, -0.35);
  K.add(RB(0.08, 0.15, 0.03, 0.01), STD(0x222222, 0.4), 2.25, 1.09, cz + 0.1, 0, -1.2); K.add(CY(0.17, 0.17, 0.05, 14), STD(0x161616, 0.6), -1.6, 0.72, cz - 0.75); K.add(CY(0.02, 0.02, 0.7, 6), steel, -1.6, 0.36, cz - 0.75); K.add(CY(0.22, 0.22, 0.02, 14), steel, -1.6, 0.01, cz - 0.75);
  // left wall: steel shelving of ammunition (cartons in brand colours) and green ammo cans
  const ammoMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, map: (() => { const t = tx(cv(128, 128, (c, w, h) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(0, h * 0.62, w, h * 0.14); c.fillStyle = '#f4f4f4'; c.fillRect(0, h * 0.2, w, h * 0.3); c.fillStyle = '#222'; c.font = 'bold 30px Arial'; c.textAlign = 'center'; c.fillText(['9MM', '.223', '12GA'][(rnd() * 3) | 0], w / 2, h * 0.44); })); t.repeat.set(1, 1); return t; })() });
  const cols = [0x9a3a2e, 0x3f5a3a, 0xb08a3a, 0x34486a, 0x2a2a2a, 0x8a5a32];
  for (const zc of [-2.6, -0.6]) { const x0 = -W / 2 + 0.26; K.at(x0, 0, zc, 0, () => { for (const yy of [0.1, 0.5, 0.9, 1.3, 1.7]) K.add(BX(0.45, 0.025, 1.8), steel, 0, yy, 0); for (const zz of [-0.88, 0.88]) for (const xx of [-0.21, 0.21]) K.add(BX(0.03, 1.9, 0.03), steel, xx, 0.95, zz);
    for (const yy of [0.5, 0.9, 1.3, 1.7]) { let z = -0.82; while (z < 0.8) { const bw = rr(0.1, 0.16), st = 1 + ((rnd() * 3) | 0), col = cols[(rnd() * cols.length) | 0]; for (let s = 0; s < st; s++) K.add(BX(0.18, 0.075, bw), ammoMat, rr(-0.05, 0.05), yy + 0.05 + s * 0.077, z + bw / 2, rr(-0.06, 0.06), 0, 0, 1, 1, 1, col); z += bw + 0.02; } }
    for (let k = 0; k < 4; k++) { const z = -0.62 + k * 0.42; K.add(RB(0.3, 0.19, 0.36, 0.015), STD(0x4a5536, 0.6, 0.4), 0, 0.22, z); K.add(BX(0.02, 0.03, 0.12), metal, 0, 0.33, z); } }); }
  // right wall: pegboard of handguns, paper targets and shop posters (one atlas)
  const peg = pbr(cv(128, 128, (c, w, h) => { c.fillStyle = '#c9b48f'; c.fillRect(0, 0, w, h); grain(c, w, h, 12); c.fillStyle = '#2a2016'; for (let x = 8; x < w; x += 16) for (let y = 8; y < h; y += 16) { c.beginPath(); c.arc(x, y, 2.4, 0, PI * 2); c.fill(); } }), [0.4, 0.4], { r: 0.85, bump: 1.2 });
  K.add(PL(3, 1.2), peg, W / 2 - 0.02, 1.75, -2.3, -PI / 2); K.add(BX(0.03, 1.26, 3.06), STD(0x2a1a10, 0.5), W / 2 - 0.02, 1.75, -2.3);
  for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) gun(K, 'pistol', W / 2 - 0.05, 1.38 + r * 0.36, -3.5 + i * 0.48, -PI / 2, 0, gm);
  const posters = atlas(4, 2, 256, 352, [
    (c, w, h) => { c.fillStyle = '#f1efe8'; c.fillRect(0, 0, w, h); c.fillStyle = '#1b1b1b'; c.beginPath(); c.arc(w / 2, 90, 46, 0, PI * 2); c.fill(); c.beginPath(); c.moveTo(40, h - 20); c.quadraticCurveTo(40, 150, w / 2, 140); c.quadraticCurveTo(w - 40, 150, w - 40, h - 20); c.fill(); c.strokeStyle = '#f1efe8'; c.lineWidth = 3; for (const r of [30, 60, 90]) { c.beginPath(); c.ellipse(w / 2, 220, r * 0.8, r, 0, 0, PI * 2); c.stroke(); } c.fillStyle = '#d33'; for (let k = 0; k < 6; k++) { c.beginPath(); c.arc(w / 2 + rr(-30, 30), rr(150, 260), 4, 0, PI * 2); c.fill(); } },
    (c, w, h) => { c.fillStyle = '#f1efe8'; c.fillRect(0, 0, w, h); for (let r = 10; r > 0; r--) { c.fillStyle = r % 2 ? '#111' : '#f1efe8'; if (r <= 3) c.fillStyle = r % 2 ? '#e33' : '#ffd'; c.beginPath(); c.arc(w / 2, h / 2, r * 12, 0, PI * 2); c.fill(); } c.fillStyle = '#111'; c.font = 'bold 22px Arial'; c.textAlign = 'center'; c.fillText('25 M', w / 2, h - 18); },
    (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#5a0d0a'); gr.addColorStop(1, '#1a0606'); c.fillStyle = gr; c.fillRect(0, 0, w, h); c.fillStyle = '#ff5a3a'; c.font = '900 46px Arial'; c.textAlign = 'center'; c.fillText('AMMU', w / 2, 90); c.fillText('BRUM', w / 2, 140); c.fillStyle = '#fff'; c.font = '600 18px Arial'; c.fillText('LICENSED FIREARMS', w / 2, 200); c.fillText('DEALER · EST. 1998', w / 2, 226); c.strokeStyle = '#ff5a3a'; c.lineWidth = 4; c.strokeRect(14, 14, w - 28, h - 28); },
    (c, w, h) => { c.fillStyle = '#ffd21f'; c.fillRect(0, 0, w, h); c.fillStyle = '#111'; for (let k = -h; k < w; k += 36) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + 18, 0); c.lineTo(k + 18 + 40, 40); c.lineTo(k + 40, 40); c.fill(); } c.font = '900 40px Arial'; c.textAlign = 'center'; c.fillText('NO', w / 2, 130); c.fillText('LICENCE', w / 2, 178); c.fillText('NO SALE', w / 2, 226); c.font = '600 17px Arial'; c.fillText('Firearms Act 1968', w / 2, 300); },
    (c, w, h) => { c.fillStyle = '#1b4f9c'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.beginPath(); c.arc(w / 2, 120, 70, 0, PI * 2); c.fill(); c.fillStyle = '#1b4f9c'; c.fillRect(w / 2 - 50, 100, 100, 26); c.font = '800 24px Arial'; c.fillStyle = '#fff'; c.textAlign = 'center'; c.fillText('EYE & EAR', w / 2, 250); c.fillText('PROTECTION', w / 2, 280); c.fillText('MUST BE WORN', w / 2, 310); },
    (c, w, h) => { c.fillStyle = '#f3f3f0'; c.fillRect(0, 0, w, h); c.fillStyle = '#1d1d1d'; c.fillRect(70, 110, 100, 50); c.beginPath(); c.arc(70, 135, 22, 0, PI * 2); c.fill(); c.fillRect(160, 160, 14, 50); c.font = '800 26px Arial'; c.textAlign = 'center'; c.fillText('CCTV', w / 2, 260); c.font = '600 16px Arial'; c.fillText('IN OPERATION 24 HRS', w / 2, 290); },
    (c, w, h) => { c.fillStyle = '#20231f'; c.fillRect(0, 0, w, h); c.fillStyle = '#c9b06a'; c.font = '800 28px Arial'; c.textAlign = 'center'; c.fillText('TODAY', w / 2, 60); c.font = '600 20px Arial'; c.fillStyle = '#fff'; SHOP.guns.forEach(([, n, p], i) => { c.fillText(n, w / 2, 120 + i * 56); c.fillStyle = '#ffcc33'; c.fillText(p + ' cr', w / 2, 144 + i * 56); c.fillStyle = '#fff'; }); },
    (c, w, h) => { c.fillStyle = '#3d4a2e'; c.fillRect(0, 0, w, h); c.fillStyle = '#1e2616'; c.beginPath(); c.moveTo(60, 260); c.lineTo(70, 190); c.quadraticCurveTo(110, 170, 170, 180); c.lineTo(195, 140); c.lineTo(205, 150); c.lineTo(190, 190); c.lineTo(185, 260); c.lineTo(175, 260); c.lineTo(170, 210); c.lineTo(90, 210); c.lineTo(80, 260); c.fill(); c.strokeStyle = '#1e2616'; c.lineWidth = 4; c.beginPath(); c.moveTo(196, 140); c.lineTo(180, 100); c.moveTo(196, 140); c.lineTo(220, 104); c.stroke(); c.fillStyle = '#e8e0c8'; c.font = '800 24px Arial'; c.textAlign = 'center'; c.fillText('SHOOTING', w / 2, 60); c.fillText('SEASON', w / 2, 88); }]);
  const pz = [[-0.25, 0, 1.75, 0.55, 0.76], [0.75, 1, 1.75, 0.55, 0.76], [1.75, 4, 1.8, 0.5, 0.68], [2.75, 5, 1.8, 0.5, 0.68]];
  for (const [z, i, y, w, h] of pz) K.add(aPL(w, h, i, 4, 2), posters, W / 2 - 0.015, y, z, -PI / 2);
  K.add(aPL(0.62, 0.86, 2, 4, 2), posters, -2.2, 1.95, D / 2 - 0.015, PI); K.add(aPL(0.6, 0.82, 3, 4, 2), posters, 2.2, 1.95, D / 2 - 0.015, PI); K.add(aPL(0.6, 0.82, 7, 4, 2), posters, -W / 2 + 0.015, 2.4, 1.2, PI / 2); K.add(aPL(0.5, 0.7, 6, 4, 2), posters, -W / 2 + 0.015, 2.35, 2.6, PI / 2);
  // ceiling: twin-tube fluorescent battens, CCTV dome; entrance mat
  const tubes = { housing: STD(0xf2f2f0, 0.45, 0.1), tube: GLOW(0xf2f7ff) };
  for (const x of [-2.6, 2.6]) for (const z of [-3, -0.6, 1.9]) troffer(K, x, H, z, 1.5, 0.22, tubes, 0, 2);
  troffer(K, 0, H, -2.6, 1.5, 0.22, tubes, PI / 2, 2);
  K.add(SP(0.09, 12, 6), STD(0x111111, 0.1, 0.2), -4.8, H - 0.02, -3.6, 0, 0, 0, 1, 0.7, 1); K.add(CY(0.1, 0.1, 0.03, 12), STD(0xeeeeee, 0.5), -4.8, H - 0.015, -3.6);
  K.add(RB(1.8, 1.0, 0.015, 0.006), pbr(fabricCv('#3a3a3a', { amt: 30 }), [0.3, 0.3], { r: 1 }), 0, 0.008, D / 2 - 0.9, 0, -PI / 2);
  K.done();
  const sign = neon('AMMU-BRUM', '#ff5a3a', 3.2, 0.52); sign.position.set(0, 3.12, -D / 2 + 0.05); g.add(sign);
  npc(I, 3, 0, -2.5, PI); lamp(g, 0xeef4ff, 14, 0, 3.1, -2.2, 13); lamp(g, 0xeef4ff, 9, -2.6, 3.1, 1.6, 10); lamp(g, 0xeef4ff, 9, 2.6, 3.1, 1.6, 10);
  I.spots.push({ act: 'shop', shop: 'guns', x: 0, z: -0.7, r: 1.8, label: 'BUY' }); exitDoor(I, D / 2); I.step = dt => stepNpcs(I, dt); info.envI = 0.55; return info; }

// ------------------------------------------------------------------ food: balti restaurant / fried-chicken takeaway
function foodRoom(I, v) { return v.id === 'chicken' ? chickenRoom(I, v) : baltiRoom(I, v); }
// fitted booth: seat + upholstered back on the side away from the table (occupant faces +Z for f = 1, -Z for f = -1)
function booth(K, x, z, f, len, frame, pad) { K.at(x, 0, z, f > 0 ? PI : 0, () => { K.add(BX(len, 0.4, 0.5), frame, 0, 0.2, 0.05); K.add(RB(len - 0.04, 0.1, 0.5, 0.04), pad, 0, 0.45, 0.04, 0, -PI / 2);
  K.add(BX(len, 1.15, 0.08), frame, 0, 0.575, 0.34); K.add(RB(len - 0.06, 0.55, 0.12, 0.05), pad, 0, 0.82, 0.25, 0, -0.1); K.add(BX(len + 0.02, 0.05, 0.12), frame, 0, 1.17, 0.32); }); }
function baltiRoom(I, v) { const g = I.g, W = 10, D = 8, H = 3.2; seed = 23;
  const K = new Kit(g);
  const floor = pbr(tileCv(['#9a4a2b', '#a4532f', '#93452a'], { nx: 4, ny: 4, grout: '#5b3a28', gw: 4, bevel: 0.12, pattern: (c, w, h, i, j) => { star8(c, 0, 0, w * 0.3, '#e2c99a', '#5b3a28', 2); star8(c, 0, 0, w * 0.14, '#1f4f45', null); for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { c.fillStyle = '#e2c99a'; c.beginPath(); c.arc(sx * w / 2, sy * h / 2, w * 0.12, 0, PI * 2); c.fill(); } } }), [1.2, 1.2], { r: 0.55, bump: 0.6, ei: 0.3 });
  const wall = pbr(plasterCv('#8a2a20', { amt: 8 }), [2, 2], { r: 0.85, bump: 0.3 });
  const panelCv = cv(256, 256, (c, w, h) => { c.drawImage(woodCv('#4a2614', { w: 256, h: 256, planks: 2, seams: false }), 0, 0); c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 6; c.strokeRect(22, 22, w - 44, h - 44); c.strokeStyle = 'rgba(255,210,160,0.18)'; c.lineWidth = 3; c.strokeRect(30, 30, w - 60, h - 60); });
  const dado = pbr(panelCv, [0.75, 1.0], { r: 0.45, bump: 1.2 });
  const darkWood = pbr(woodCv('#3e1f10', { w: 256, h: 256, planks: 2 }), [0.6, 0.6], { r: 0.4, bump: 0.5 }), gold = STD(0xc9973a, 0.32, 0.9), copper = STD(0xb4643a, 0.3, 0.95);
  const info = room(I, W, D, H, floor, wall, pbr(plasterCv('#e6d6b6'), [2, 2], { r: 0.9, bump: 0.2 }), { K, dado, dadoH: 1.0, rail: gold, skirt: STD(0x2a140a, 0.5), cornice: darkWood, sky: 0xffe2bc, gnd: 0x3a2014, hemi: 0.45 });
  for (let x = -4.4; x <= 4.4; x += 1.1) K.add(BX(0.14, 0.16, D), darkWood, x, H - 0.08, 0); // ceiling beams
  // counter: panelled hardwood, brass top and trim, brass bell; balti dishes on the back shelf, menu board above
  const cz = -2.2; K.add(BX(6.4, 0.08, 0.7), STD(0x1a0d06, 0.6), 0, 0.04, cz + 0.03); K.add(BX(6.5, 0.98, 0.78), dado, 0, 0.53, cz); K.add(RB(6.66, 0.05, 0.9, 0.018), gold, 0, 1.045, cz); K.add(BX(6.52, 0.04, 0.02), gold, 0, 0.18, cz + 0.4);
  K.add(LA([[0, 0], [0.05, 0], [0.05, 0.02], [0.012, 0.025], [0.04, 0.05], [0.045, 0.09], [0.0, 0.11]], 12), gold, -2.6, 1.07, cz + 0.15);
  K.add(BX(1.1, 0.4, 0.4), GLASS({ opacity: 0.22 }), 1.6, 1.27, cz); K.add(BX(1.12, 0.02, 0.42), gold, 1.6, 1.48, cz);
  const sweets = VC(0.5); for (let i = 0; i < 14; i++) K.add(SP(0.035, 8, 6), sweets, 1.15 + (i % 7) * 0.15, 1.1, cz - 0.1 + Math.floor(i / 7) * 0.18, 0, 0, 0, 1, 0.7, 1, [0xf0c040, 0xf5f0e0, 0xe07a2a, 0x7fbf6a][i % 4]);
  K.add(BX(5.6, 0.04, 0.32), darkWood, 0, 1.5, -D / 2 + 0.17); for (const x of [-2.7, 2.7]) K.add(BX(0.04, 0.2, 0.3), gold, x, 1.4, -D / 2 + 0.16);
  const bowl = LA([[0, 0], [0.09, 0.0], [0.13, 0.03], [0.15, 0.07], [0.145, 0.072], [0.125, 0.035], [0.085, 0.008], [0, 0.008]], 16);
  for (let i = 0; i < 9; i++) { const x = -2.4 + i * 0.6; K.add(bowl, copper, x, 1.52, -D / 2 + 0.18); K.add(new THREE.TorusGeometry(0.03, 0.007, 4, 10), copper, x - 0.16, 1.58, -D / 2 + 0.18, 0, 0, PI / 2); K.add(new THREE.TorusGeometry(0.03, 0.007, 4, 10), copper, x + 0.16, 1.58, -D / 2 + 0.18, 0, 0, PI / 2); }
  const kitchen = GLOW(0x9a4a1a); K.add(PL(1.0, 1.0), kitchen, -4.3, 1.55, -D / 2 + 0.01); K.add(BX(1.12, 0.06, 0.12), darkWood, -4.3, 2.08, -D / 2 + 0.06); K.add(BX(1.12, 0.06, 0.35), gold, -4.3, 1.03, -D / 2 + 0.17); K.add(BX(0.06, 1.1, 0.12), darkWood, -4.84, 1.55, -D / 2 + 0.06); K.add(BX(0.06, 1.1, 0.12), darkWood, -3.76, 1.55, -D / 2 + 0.06);
  const items = SHOP.food; const board = new THREE.MeshStandardMaterial({ roughness: 0.7, emissive: 0xffffff, emissiveIntensity: 0.22, map: tx(cv(1024, 280, (c, w, h) => { c.fillStyle = '#16100b'; c.fillRect(0, 0, w, h); grain(c, w, h, 14); c.strokeStyle = '#c9973a'; c.lineWidth = 6; c.strokeRect(14, 14, w - 28, h - 28);
    c.font = '700 64px Georgia,serif'; c.fillStyle = '#e8b24a'; c.textAlign = 'center'; c.fillText(v.name, w / 2, 82); c.font = 'italic 24px Georgia,serif'; c.fillStyle = '#d8c7a4'; c.fillText('Authentic Kashmiri balti · cooked in the bowl · since 1977', w / 2, 118);
    c.font = '600 32px Georgia,serif'; c.textAlign = 'left'; const L = [...items.map(([, n, p]) => [n, p + ' cr']), ['Lamb karahi', '70 cr'], ['Peshwari naan', '8 cr'], ['Mango lassi', '6 cr']];
    L.forEach(([n, p], i) => { const x = i < 3 ? 70 : 560, y = 172 + (i % 3) * 38; c.fillStyle = '#f1e6cf'; c.fillText(n, x, y); c.textAlign = 'right'; c.fillStyle = '#e8b24a'; c.fillText(p, x + 400, y); c.textAlign = 'left'; c.fillStyle = 'rgba(232,178,74,.35)'; c.fillRect(x, y + 8, 400, 1); }); }), null) });
  board.map.wrapS = board.map.wrapT = THREE.ClampToEdgeWrapping; board.emissiveMap = board.map;
  K.add(new THREE.PlaneGeometry(5.0, 1.37), board, 0, 2.38, -D / 2 + 0.04); K.add(BX(5.16, 0.08, 0.06), darkWood, 0, 3.1, -D / 2 + 0.04); K.add(BX(5.16, 0.08, 0.06), darkWood, 0, 1.66, -D / 2 + 0.04);
  // painted jharokha arches on the side walls (brass frames around Mughal-style panels)
  const art = atlas(3, 1, 256, 384, [0, 1, 2].map(k => (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, ['#1f4f45', '#5a1a3a', '#24406a'][k]); gr.addColorStop(1, '#120a06'); c.fillStyle = gr; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#d9a84a'; c.lineWidth = 3; for (let i = 0; i < 6; i++) { c.beginPath(); arch(c, w - 40 - i * 26, h * 0.42, 40 + i * 20, w / 2, h - 10, false); c.stroke(); }
    if (k === 1) { c.fillStyle = '#e8d8b8'; c.beginPath(); c.arc(w / 2, h * 0.55, 46, PI, 0); c.fill(); c.fillRect(w / 2 - 46, h * 0.55, 92, 70); c.fillRect(w / 2 - 80, h * 0.62, 18, 90); c.fillRect(w / 2 + 62, h * 0.62, 18, 90); c.fillRect(w / 2 - 100, h * 0.79, 200, 12); }
    else for (let i = 0; i < 18; i++) { const a = i / 18 * PI * 2; c.fillStyle = i % 2 ? '#d9a84a' : '#c04a3a'; c.beginPath(); c.ellipse(w / 2 + Math.cos(a) * 54, h * 0.58 + Math.sin(a) * 54, 18, 7, a, 0, PI * 2); c.fill(); } c.fillStyle = '#d9a84a'; c.beginPath(); c.arc(w / 2, h * 0.58, 16, 0, PI * 2); c.fill(); }));
  const aw = 0.9, ah = 1.45, frameS = arch(new THREE.Shape(), aw + 0.14, 0.98, ah + 0.11, 0, -0.07); frameS.holes.push(arch(new THREE.Path(), aw, 0.95, ah, 0, 0)); const frameG = EX(frameS, 0.05, 0.008);
  const inS = arch(new THREE.Shape(), aw, 0.95, ah, 0, 0), inG = new THREE.ShapeGeometry(inS, 8); { const p = inG.attributes.position, uv = inG.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / aw + 0.5, p.getY(i) / ah); }
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) { const z = -0.9 + k * 1.75; K.at(s * (W / 2 - 0.02), 1.42, z, -s * PI / 2, () => { K.add(frameG, gold, 0, 0, 0.03); K.add(cellUV(inG.clone(), (k + (s > 0 ? 1 : 0)) % 3, 3, 1), art, 0, 0, 0.012); }); }
  // dining: booths against both side walls, two-tops in the middle, brass lantern pendants
  const pad = pbr(fabricCv('#7a1420', { amt: 20 }), [0.25, 0.25], { r: 0.75, bump: 0.5 }), cloth = pbr(fabricCv('#efe6d4', { amt: 10 }), [0.2, 0.2], { r: 0.9, bump: 0.3 });
  const table = (x, z, w, d, round) => { if (round) { K.add(CY(w / 2, w / 2, 0.035, 20), darkWood, x, 0.75, z); K.add(CY(w / 2 + 0.06, w / 2 + 0.03, 0.2, 20, true), cloth, x, 0.66, z); } else { K.add(RB(w, 0.04, d, 0.012), darkWood, x, 0.75, z, 0, -PI / 2); K.add(BX(w * 0.95, 0.002, 0.3), cloth, x, 0.772, z); }
    K.add(CY(0.04, 0.05, 0.72, 8), STD(0x1a0d06, 0.4, 0.3), x, 0.37, z); K.add(CY(0.24, 0.26, 0.03, 14), STD(0x1a0d06, 0.4, 0.3), x, 0.015, z);
    K.add(bowl, copper, x + 0.12, 0.775, z); K.add(CY(0.12, 0.12, 0.012, 16), STD(0xf4f1ea, 0.25), x - 0.2, 0.775, z + 0.05); K.add(CY(0.03, 0.025, 0.12, 10), GLASS({ opacity: 0.35 }), x - 0.05, 0.83, z - 0.15); };
  for (const s of [-1, 1]) { const x = s * 4.38; for (const tz of [-0.3, 2.0]) { table(x, tz, 1.05, 0.75); booth(K, x, tz - 0.66, 1, 1.15, darkWood, pad); booth(K, x, tz + 0.66, -1, 1.15, darkWood, pad); pendant(K, x, H, tz, 1.2, gold, GLOW(0xffb860), STD(0x111111, 0.6, 0.5), 'lantern'); } }
  for (const s of [-1, 1]) { table(s * 1.7, 1.2, 0.8, 0.8, true); chair(K, s * 1.7, 0.6, PI, darkWood, pad); chair(K, s * 1.7, 1.8, 0, darkWood, pad); pendant(K, s * 1.7, H, 1.2, 1.15, gold, GLOW(0xffb860), STD(0x111111, 0.6, 0.5), 'lantern'); }
  for (const x of [-1.6, 1.6]) pendant(K, x, H, cz, 1.0, gold, GLOW(0xffc070), STD(0x111111, 0.6, 0.5), 'lantern');
  plant(K, -4.55, 3.55, STD(0x8a4a2a, 0.7), STD(0x2f5a2a, 0.8)); plant(K, 4.55, 3.55, STD(0x8a4a2a, 0.7), STD(0x2f5a2a, 0.8));
  K.add(RB(1.6, 0.9, 0.012, 0.005), pbr(fabricCv('#5a1a16', { amt: 30 }), [0.3, 0.3], { r: 1 }), 0, 0.007, D / 2 - 0.8, 0, -PI / 2);
  K.done();
  npc(I, 1, 0, -3, PI); npc(I, 4, -4.38, 0.36, 0, 'sit'); npc(I, 2, 4.38, 1.32, PI, 'sit'); npc(I, 6, 1.7, 1.8, 0, 'sit');
  lamp(g, 0xffb46a, 7, -3.4, 2.2, 0.9, 9); lamp(g, 0xffb46a, 7, 3.4, 2.2, 0.9, 9); lamp(g, 0xffc890, 9, 0, 2.6, -2.0, 9);
  I.spots.push({ act: 'shop', shop: 'food', x: 0, z: -1.3, r: 1.8, label: 'ORDER' }); exitDoor(I, D / 2); I.step = dt => stepNpcs(I, dt); info.envI = 0.35; return info; }
function chickenRoom(I, v) { const g = I.g, W = 10, D = 8, H = 3.2; seed = 37;
  const K = new Kit(g);
  const floor = pbr(tileCv(['#8a2a20', '#93301f', '#842a22'], { nx: 4, ny: 4, grout: '#3a2a26', gw: 5, bevel: 0.1, speck: 16 }), [1.2, 1.2], { r: 0.5, bump: 0.7, ei: 0.3 });
  const subway = pbr(tileCv(['#f4f3ef', '#f1f0ec', '#f6f5f2'], { nx: 4, ny: 8, grout: '#c9c6bf', gw: 3, bevel: 0.22, offset: 0.5, speck: 5, jit: 0.01 }), [0.6, 0.6], { r: 0.18, bump: 0.7, ei: 0.6 });
  const red = STD(0xc81d1d, 0.35), steel = pbr(brushedCv('#b7bcc1'), [0.6, 0.6], { r: 0.3, m: 0.9, bump: 0.08, ei: 0.8 }), black = STD(0x161616, 0.5);
  const info = room(I, W, D, H, floor, subway, ceilTiles('#f2f2f0'), { K, skirt: STD(0x2a2a2a, 0.5), skirtH: 0.1, sky: 0xffffff, gnd: 0x5a3a30, hemi: 0.6 });
  for (const [px, pz, ry, len] of [[0, -D / 2, 0, W], [-W / 2, 0, PI / 2, D], [W / 2, 0, -PI / 2, D], [0, D / 2, PI, W]]) K.add(BX(len, 0.15, 0.012), red, px + Math.sin(ry) * 0.006, 1.3, pz + Math.cos(ry) * 0.006, ry);
  // stainless counter with red kick panel, heated display under a glass sneeze guard
  const cz = -2.2; K.add(BX(6.5, 0.12, 0.78), red, 0, 0.06, cz + 0.02); K.add(RB(6.5, 0.9, 0.8, 0.01), steel, 0, 0.57, cz); K.add(RB(6.62, 0.04, 0.88, 0.01), steel, 0, 1.04, cz);
  for (let x = -3; x <= 3; x += 1.0) K.add(BX(0.012, 0.86, 0.01), STD(0x6a6e72, 0.4, 0.8), x, 0.56, cz + 0.405);
  K.add(BX(2.6, 0.18, 0.55), steel, -1.4, 1.15, cz - 0.05); K.add(PL(2.56, 0.5), GLOW(0x5a3010), -1.4, 1.242, cz - 0.05, 0, -PI / 2); K.add(PL(2.6, 0.5), GLASS({ opacity: 0.2 }), -1.4, 1.5, cz + 0.12, 0, -0.5); K.add(BX(2.6, 0.012, 0.012), GLOW(0xffd9a0), -1.4, 1.68, cz - 0.08);
  for (const x of [-2.7, -0.1]) K.add(CY(0.01, 0.01, 0.5, 6), steel, x, 1.45, cz + 0.05, 0, 0.5);
  const fried = STD(0xa8561c, 0.55), fries = STD(0xf2c24a, 0.6);
  for (let i = 0; i < 26; i++) { const x = -2.55 + (i % 13) * 0.19, z = cz - 0.2 + Math.floor(i / 13) * 0.24; K.add(SP(0.055, 7, 5), fried, x + rr(-0.03, 0.03), 1.27, z, rnd() * 6, 0, rr(-0.5, 0.5), 1.25, 0.75, 0.9); }
  for (let i = 0; i < 26; i++) K.add(BX(0.012, 0.012, 0.11), fries, -0.65 + rr(-0.2, 0.2), 1.27 + rr(0, 0.04), cz - 0.05 + rr(-0.15, 0.15), rnd() * 3, rr(-0.3, 0.3));
  K.add(RB(0.32, 0.12, 0.26, 0.02), black, 2.3, 1.12, cz - 0.05); K.add(RB(0.28, 0.2, 0.02, 0.008), black, 2.3, 1.3, cz - 0.1, 0, -0.35); K.add(PL(0.24, 0.15), GLOW(0x2a8a5a), 2.3, 1.302, cz - 0.088, 0, -0.35);
  K.add(RB(0.12, 0.2, 0.12, 0.02), STD(0xe8e8e8, 0.3), 1.6, 1.16, cz + 0.2); K.add(BX(0.1, 0.06, 0.005), STD(0xf6f6f6, 0.9), 1.6, 1.2, cz + 0.262);
  // kitchen line: twin-basket fryers, extraction canopy, prep bench with drinks dispenser
  K.at(-2.2, 0, -D / 2 + 0.45, 0, () => { K.add(RB(2.2, 0.92, 0.8, 0.01), steel, 0, 0.46, 0); for (const x of [-0.55, 0.55]) { K.add(PL(0.82, 0.5), STD(0x5a3a0a, 0.15, 0.2, { ei: 1 }), x, 0.925, 0.02, 0, -PI / 2); for (const bx of [-0.2, 0.2]) { K.add(BX(0.34, 0.16, 0.42), STD(0x9aa0a6, 0.5, 0.9, { wireframe: false }), x + bx, 0.95, 0.0); K.add(CY(0.012, 0.012, 0.4, 6), black, x + bx, 1.07, 0.38, 0, 1.0); } }
    K.add(BX(2.2, 0.35, 0.06), steel, 0, 1.12, -0.37); });
  K.at(2.4, 0, -D / 2 + 0.38, 0, () => { K.add(RB(2.6, 0.9, 0.7, 0.01), steel, 0, 0.45, 0); K.add(RB(0.6, 0.6, 0.45, 0.03), black, 0.6, 1.2, 0); K.add(PL(0.5, 0.3), GLOW(0xd02020), 0.6, 1.32, 0.226); for (let i = 0; i < 3; i++) K.add(CY(0.015, 0.015, 0.06, 6), steel, 0.45 + i * 0.15, 0.95, 0.24);
    for (let i = 0; i < 6; i++) K.add(CY(0.04, 0.035, 0.12, 10), STD(0xf0f0ea, 0.6), -0.9 + i * 0.1, 0.96, -0.1); });
  // backlit menu lightboxes above the counter
  const items = SHOP.food; const food = (c, x, y, s, kind) => { if (kind === 0) { for (let k = 0; k < 4; k++) { const a = -0.6 + k * 0.4; c.save(); c.translate(x + Math.cos(a) * 30 * s, y + k * 6 * s); c.rotate(a + 0.6); const gr = c.createRadialGradient(-6 * s, -6 * s, 2, 0, 0, 34 * s); gr.addColorStop(0, '#f1b45a'); gr.addColorStop(0.6, '#b4601c'); gr.addColorStop(1, '#6a3008'); c.fillStyle = gr; c.beginPath(); c.ellipse(0, 0, 36 * s, 22 * s, 0, 0, PI * 2); c.fill(); c.fillStyle = '#f2e6d0'; c.fillRect(30 * s, -5 * s, 20 * s, 10 * s); c.restore(); } }
      else if (kind === 1) { c.fillStyle = '#d4202a'; c.beginPath(); c.moveTo(x - 34 * s, y - 10 * s); c.lineTo(x + 34 * s, y - 10 * s); c.lineTo(x + 26 * s, y + 46 * s); c.lineTo(x - 26 * s, y + 46 * s); c.fill(); c.fillStyle = '#f5c84a'; for (let k = 0; k < 16; k++) c.fillRect(x - 30 * s + k * 4 * s, y - 40 * s - (k % 3) * 6 * s, 5 * s, 40 * s); c.fillStyle = '#d4202a'; c.fillRect(x - 34 * s, y - 12 * s, 68 * s, 16 * s); }
      else { c.fillStyle = '#d98a2a'; c.beginPath(); c.ellipse(x, y - 12 * s, 46 * s, 26 * s, 0, PI, 0); c.fill(); c.fillStyle = '#6a8a2a'; c.fillRect(x - 48 * s, y - 12 * s, 96 * s, 8 * s); c.fillStyle = '#7a3a1a'; c.fillRect(x - 46 * s, y - 4 * s, 92 * s, 14 * s); c.fillStyle = '#f3c040'; c.fillRect(x - 48 * s, y - 6 * s, 96 * s, 4 * s); c.fillStyle = '#d98a2a'; c.fillRect(x - 46 * s, y + 10 * s, 92 * s, 14 * s); } };
  const menu = atlas(3, 1, 340, 200, [0, 1, 2].map(k => (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#ffe9c8'); c.fillStyle = gr; c.fillRect(0, 0, w, h); c.fillStyle = '#d4202a'; c.fillRect(0, 0, w, 40); c.fillStyle = '#fff'; c.font = '900 26px Arial'; c.textAlign = 'center'; c.fillText(['CHICKEN', 'MEALS', 'BURGERS'][k], w / 2, 29);
    const it = [[items[2], ['6 hot wings', '18 cr'], ['2 pc + chips', '25 cr']], [['Family bucket', '90 cr'], ['Popcorn chicken', '15 cr'], ['Rice box', '22 cr']], [items[0], ['Zinger stack', '45 cr'], ['Fillet wrap', '30 cr']]][k];
    food(c, 82, 120, 1.05, k === 1 ? 1 : k === 2 ? 2 : 0); c.textAlign = 'left'; it.forEach((r, i) => { const [n, p] = Array.isArray(r) && r.length === 3 ? [r[1], r[2] + ' cr'] : r; c.fillStyle = '#222'; c.font = '700 19px Arial'; c.fillText(n, 160, 78 + i * 42); c.fillStyle = '#d4202a'; c.font = '900 20px Arial'; c.fillText(p, 160, 98 + i * 42); }); }), true);
  for (let k = 0; k < 3; k++) { const x = -1.85 + k * 1.85; K.add(aPL(1.72, 1.0, k, 3, 1), menu, x, 2.45, -D / 2 + 0.09); K.add(BX(1.8, 1.08, 0.08), black, x, 2.45, -D / 2 + 0.04); }
  // drinks fridge (glass door, lit shelves of cans and bottles) on the left wall, tall bin, wall-bar with stools on the right
  const drinks = new THREE.MeshBasicMaterial({ toneMapped: false, map: tx(cv(256, 512, (c, w, h) => { c.fillStyle = '#e8f2f8'; c.fillRect(0, 0, w, h); for (let r = 0; r < 5; r++) { const y0 = 20 + r * 98; c.fillStyle = '#9aa4aa'; c.fillRect(0, y0 + 86, w, 6); for (let i = 0; i < 7; i++) { const x = 8 + i * 35, col = ['#d4202a', '#1f5fbf', '#f2c230', '#2a9a4a', '#111', '#e86a1a'][(i + r * 3) % 6], tall = r % 2; c.fillStyle = col; if (tall) { c.fillRect(x + 6, y0 + 18, 22, 68); c.fillRect(x + 12, y0 + 4, 10, 16); } else { c.fillRect(x + 2, y0 + 40, 30, 46); c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(x + 6, y0 + 42, 5, 42); } c.fillStyle = 'rgba(255,255,255,.7)'; c.fillRect(x + 4, y0 + 58, 26, 8); } } }), null) });
  drinks.map.wrapS = drinks.map.wrapT = THREE.ClampToEdgeWrapping;
  K.at(-W / 2 + 0.36, 0, -0.9, PI / 2, () => { K.add(RB(0.78, 2.0, 0.66, 0.02), STD(0x1a1a1a, 0.4, 0.3), 0, 1.0, 0); K.add(new THREE.PlaneGeometry(0.64, 1.6), drinks, 0, 1.05, 0.31); K.add(PL(0.66, 1.62), GLASS({ opacity: 0.14 }), 0, 1.05, 0.335); K.add(BX(0.02, 1.4, 0.04), STD(0xc8ccd0, 0.3, 1), 0.28, 1.05, 0.36); K.add(PL(0.7, 0.24), GLOW(0xd4202a), 0, 1.9, 0.336); });
  K.at(W / 2 - 0.25, 0, 0.6, -PI / 2, () => { K.add(RB(4.2, 0.05, 0.4, 0.015), steel, 0, 1.05, 0.1, 0, -PI / 2); for (let i = 0; i < 4; i++) { const x = -1.5 + i * 1.0; K.add(CY(0.17, 0.17, 0.06, 16), red, x, 0.74, 0.6); K.add(CY(0.025, 0.025, 0.72, 8), steel, x, 0.36, 0.6); K.add(CY(0.18, 0.2, 0.02, 16), steel, x, 0.01, 0.6); K.add(new THREE.TorusGeometry(0.13, 0.008, 4, 16), steel, x, 0.25, 0.6, 0, PI / 2); } });
  const tbl = (x, z) => { K.add(RB(1.1, 0.03, 0.75, 0.01), STD(0xe8e4dc, 0.35), x, 0.75, z, 0, -PI / 2); K.add(BX(1.12, 0.02, 0.77), black, x, 0.735, z); K.add(CY(0.04, 0.04, 0.72, 8), steel, x, 0.36, z); K.add(CY(0.25, 0.27, 0.03, 14), steel, x, 0.015, z);
    chair(K, x - 0.68, z, -PI / 2, steel, red, { back: 0.42 }); chair(K, x + 0.68, z, PI / 2, steel, red, { back: 0.42 }); K.add(CY(0.025, 0.022, 0.16, 8), red, x + 0.1, 0.85, z); K.add(CY(0.025, 0.022, 0.16, 8), STD(0xe8c020, 0.4), x + 0.18, 0.85, z); K.add(RB(0.12, 0.1, 0.08, 0.01), STD(0xdddddd, 0.3, 0.6), x - 0.1, 0.82, z); };
  tbl(-2.9, 0.6); tbl(-2.9, 2.5); tbl(0.4, 1.4);
  K.add(RB(0.45, 1.0, 0.45, 0.04), red, -W / 2 + 0.35, 0.5, 2.8); K.add(BX(0.3, 0.02, 0.12), black, -W / 2 + 0.35, 0.85, 3.03);
  // ceiling: 600 mm LED panels
  for (const x of [-2.4, 0, 2.4]) for (const z of [-2.2, 0.4, 2.6]) { K.add(BX(0.62, 0.03, 0.62), STD(0xf4f4f4, 0.5), x, H - 0.015, z); K.add(PL(0.56, 0.56), GLOW(0xf8fbff), x, H - 0.031, z, 0, PI / 2); }
  K.add(RB(1.6, 0.9, 0.012, 0.005), pbr(fabricCv('#2a2a2a', { amt: 30 }), [0.3, 0.3], { r: 1 }), 0, 0.007, D / 2 - 0.8, 0, -PI / 2);
  K.done();
  const sign = neon(v.name, '#ff3030', 2.6, 0.5); sign.position.set(-W / 2 + 0.03, 2.55, -0.9); sign.rotation.y = PI / 2; g.add(sign);
  npc(I, 1, -1.4, -3.0, PI); npc(I, 5, 1.2, -3.05, PI); npc(I, 4, -3.58, 0.6, -PI / 2, 'sit'); npc(I, 2, W / 2 - 0.85, 1.1, -PI / 2, 'sit', 0.28);
  lamp(g, 0xfff7ee, 10, 0, 2.9, -1.8, 10); lamp(g, 0xfff7ee, 8, -2.4, 2.9, 1.8, 9); lamp(g, 0xfff7ee, 8, 2.4, 2.9, 1.8, 9);
  I.spots.push({ act: 'shop', shop: 'food', x: 0, z: -1.3, r: 1.8, label: 'ORDER' }); exitDoor(I, D / 2); I.step = dt => stepNpcs(I, dt); info.envI = 0.6; return info; }

// ------------------------------------------------------------------ club
function clubRoom(I, v, V) { const g = I.g, W = 18, D = 16, H = 5; seed = 53;
  const K = new Kit(g);
  const floor = pbr(plasterCv('#17171b', { amt: 7 }), [3, 3], { r: 0.22, m: 0.3, bump: 0.15, ei: 0.8 }), wall = pbr(fabricCv('#1c0f20', { amt: 14, stripes: 2 }), [1.2, 1.2], { r: 0.9, bump: 0.6 });
  const info = room(I, W, D, H, floor, wall, STD(0x070708, 0.9), { K, skirt: GLOW(0x5a1a6a), skirtH: 0.04, sky: 0x6a3a8a, gnd: 0x100810, hemi: 0.35 });
  const blk = STD(0x0c0c0e, 0.35, 0.3), steel = STD(0x8a8f96, 0.35, 0.9), chrome = STD(0xdfe3e8, 0.12, 1), leather = pbr(fabricCv('#3a0a24', { amt: 16 }), [0.3, 0.3], { r: 0.45, bump: 0.6 }), velvet = pbr(fabricCv('#4a1250', { amt: 22 }), [0.25, 0.25], { r: 0.8, bump: 0.7 });
  // neon tubes up the walls and along the ceiling line
  const nP = GLOW(0xff3fa4), nB = GLOW(0x3fa4ff), nV = GLOW(0x9f3fff);
  for (let i = 0; i < 6; i++) { const z = -6 + i * 2.6; K.add(CY(0.02, 0.02, 3.6, 6), i % 2 ? nB : nP, -W / 2 + 0.05, 2.2, z); }
  for (const z of [-5.5, -2.5]) K.add(CY(0.02, 0.02, 3.6, 6), nB, W / 2 - 0.05, 3.3, z);
  for (const [px, pz, ry, len] of [[0, -D / 2, 0, W], [-W / 2, 0, PI / 2, D], [W / 2, 0, -PI / 2, D]]) K.add(CY(0.018, 0.018, len, 6), nV, px + Math.sin(ry) * 0.05, H - 0.25, pz + Math.cos(ry) * 0.05, ry, 0, PI / 2);
  // lighting truss with moving heads; mirror ball
  for (const tz of [-4.5, 1.5]) { for (const [dy, dz] of [[0, -0.15], [0, 0.15], [-0.3, -0.15], [-0.3, 0.15]]) K.add(CY(0.025, 0.025, 12, 6), steel, 0, 4.55 + dy, tz + dz, 0, 0, PI / 2);
    for (let x = -5.9; x < 6; x += 0.5) { K.add(CY(0.01, 0.01, 0.42, 4), steel, x, 4.4, tz - 0.15, 0, 0, 0.62); K.add(CY(0.01, 0.01, 0.42, 4), steel, x, 4.4, tz + 0.15, 0, 0, -0.62); }
    for (const x of [-4.5, -1.5, 1.5, 4.5]) { K.add(BX(0.24, 0.18, 0.2), blk, x, 4.12, tz); K.add(BX(0.03, 0.26, 0.26), blk, x - 0.14, 4.0, tz); K.add(BX(0.03, 0.26, 0.26), blk, x + 0.14, 4.0, tz); K.add(CY(0.1, 0.13, 0.26, 12), blk, x, 3.88, tz); K.add(CY(0.09, 0.09, 0.01, 12), GLOW(0xffffff), x, 3.75, tz); } }
  K.add(CY(0.008, 0.008, 0.9, 4), steel, 0, H - 0.45, -1.5);
  // LED dance floor (a canvas redrawn ~20 fps) with an aluminium edge
  const fc = document.createElement('canvas'); fc.width = fc.height = 192; const fg = fc.getContext('2d'), ft = new THREE.CanvasTexture(fc); ft.colorSpace = SRGB;
  const dance = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({ map: ft, toneMapped: false })); dance.rotation.x = -PI / 2; dance.position.set(0, 0.052, -1.5); g.add(dance);
  K.add(BX(6.1, 0.05, 6.1), blk, 0, 0.025, -1.5); for (const s of [-1, 1]) { K.add(BX(6.2, 0.06, 0.05), steel, 0, 0.03, -1.5 + s * 3.07); K.add(BX(0.05, 0.06, 6.2), steel, s * 3.07, 0.03, -1.5); }
  const drawFloor = t => { fg.fillStyle = '#050506'; fg.fillRect(0, 0, 192, 192); for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) { const k = i * 6 + j, p = Math.sin(t * 3 + k * 1.7) * 0.5 + 0.5, wave = Math.sin(t * 2.2 - Math.hypot(i - 2.5, j - 2.5) * 1.3) * 0.5 + 0.5, h = ((k * 0.13 + t * 0.08) % 1) * 360, l = 6 + (p * 0.5 + wave * 0.5) * 36;
    const gr = fg.createRadialGradient(i * 32 + 16, j * 32 + 16, 2, i * 32 + 16, j * 32 + 16, 20); gr.addColorStop(0, `hsl(${h},100%,${Math.min(85, l + 18)}%)`); gr.addColorStop(1, `hsl(${h},100%,${l * 0.55}%)`); fg.fillStyle = gr; fg.fillRect(i * 32 + 1.5, j * 32 + 1.5, 29, 29); } ft.needsUpdate = true; };
  // DJ booth: gloss shell with LED front, two turntables, mixer and laptop; line-array speakers either side
  const bz = -D / 2 + 1.5, ledFront = new THREE.MeshBasicMaterial({ toneMapped: false, map: tx(cv(512, 128, (c, w, h) => { const gr = c.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#ff3fa4'); gr.addColorStop(0.5, '#6a2aff'); gr.addColorStop(1, '#19e6c1'); c.fillStyle = '#050505'; c.fillRect(0, 0, w, h); c.fillStyle = gr; for (let x = 0; x < w; x += 8) for (let y = 0; y < h; y += 8) if (rnd() < 0.55 + 0.4 * Math.sin(x * 0.03)) c.fillRect(x + 1, y + 1, 6, 6); }), null) });
  K.add(BX(4.2, 0.25, 2.2), blk, 0, 0.125, bz - 0.4); K.add(RB(3.6, 1.1, 0.9, 0.06), STD(0x101014, 0.18, 0.4), 0, 0.8, bz); K.add(PL(3.4, 0.7), ledFront, 0, 0.8, bz + 0.452); K.add(RB(3.7, 0.05, 0.95, 0.02), STD(0x050505, 0.2, 0.2), 0, 1.36, bz);
  for (const x of [-0.85, 0.85]) { K.add(RB(0.5, 0.08, 0.4, 0.015), STD(0x2a2b2e, 0.3, 0.7), x, 1.42, bz); K.add(CY(0.155, 0.155, 0.012, 24), STD(0x090909, 0.25), x, 1.468, bz); K.add(CY(0.045, 0.045, 0.014, 12), GLOW(0xff3fa4), x, 1.47, bz); K.add(CY(0.008, 0.008, 0.18, 4), chrome, x + 0.19, 1.48, bz - 0.04, 0, PI / 2, 0.3); }
  K.add(RB(0.36, 0.09, 0.4, 0.012), STD(0x18191b, 0.4, 0.5), 0, 1.42, bz); for (let i = 0; i < 12; i++) K.add(CY(0.012, 0.012, 0.03, 6), i % 4 ? STD(0xdddddd, 0.4) : GLOW(0x19e6c1), -0.12 + (i % 4) * 0.08, 1.48, bz - 0.12 + Math.floor(i / 4) * 0.1);
  K.add(RB(0.34, 0.02, 0.24, 0.006), STD(0x9a9ea4, 0.3, 0.8), 0, 1.62, bz - 0.25, 0, -0.25); K.add(RB(0.34, 0.22, 0.012, 0.006), STD(0x9a9ea4, 0.3, 0.8), 0, 1.72, bz - 0.38, 0, 0.35); K.add(PL(0.3, 0.19), GLOW(0x2a3a6a), 0, 1.72, bz - 0.37, PI, -0.35);
  const spk = STD(0x0b0b0c, 0.85), cone = STD(0x1c1c1e, 0.6, 0.2);
  for (const s of [-1, 1]) { const x = s * 3.1; K.add(RB(1.0, 0.8, 0.9, 0.03), spk, x, 0.4, bz); K.add(CY(0.32, 0.26, 0.06, 20), cone, x, 0.4, bz + 0.45, 0, PI / 2); K.add(SP(0.07, 8, 6), cone, x, 0.4, bz + 0.48);
    for (let k = 0; k < 2; k++) { const y = 1.25 + k * 0.62; K.add(RB(0.66, 0.58, 0.55, 0.03), spk, x, y, bz); K.add(CY(0.18, 0.14, 0.04, 16), cone, x, y - 0.08, bz + 0.28, 0, PI / 2); K.add(CY(0.06, 0.04, 0.03, 10), cone, x, y + 0.18, bz + 0.28, 0, PI / 2); } }
  // FLAMINGO neon: script letters plus a flamingo outline, glowing on the back wall
  const flam = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.6), new THREE.MeshBasicMaterial({ transparent: true, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending, map: tx(cv(1024, 256, (c, w, h) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); c.lineCap = c.lineJoin = 'round';
    const stroke = (col, f) => { for (const [bl, lw, a] of [[30, 14, 0.5], [12, 7, 0.9], [0, 3, 1]]) { c.shadowColor = col; c.shadowBlur = bl; c.strokeStyle = lw === 3 ? '#fff' : col; c.globalAlpha = a; c.lineWidth = lw; f(); } c.globalAlpha = 1; };
    stroke('#ff3fa4', () => { c.font = 'italic 800 130px Georgia,serif'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.strokeText('Flamingo', 250, 130); });
    stroke('#ff7ac0', () => { c.beginPath(); c.moveTo(150, 230); c.lineTo(150, 160); c.moveTo(150, 165); c.bezierCurveTo(70, 160, 60, 110, 110, 100); c.bezierCurveTo(160, 92, 190, 120, 150, 140); c.moveTo(110, 100); c.bezierCurveTo(130, 60, 150, 50, 150, 40); c.bezierCurveTo(150, 20, 120, 20, 118, 40); c.lineTo(100, 52); c.stroke(); }); }), null) }));
  flam.position.set(0, 3.55, -D / 2 + 0.06); g.add(flam); const sub = neon('CLUB · BROAD ST', '#3fa4ff', 2.6, 0.4); sub.position.set(0.8, 2.55, -D / 2 + 0.05); g.add(sub);
  // bar: quilted front with an underglow, granite top, brass foot rail; lit back bar of bottles on glass shelves
  const bx = W / 2 - 1.9, bz0 = -3, bz1 = 5, bl = bz1 - bz0, bzc = (bz0 + bz1) / 2;
  const quilt = pbr(cv(256, 256, (c, w, h) => { c.fillStyle = '#2a0618'; c.fillRect(0, 0, w, h); for (let i = -1; i < 5; i++) for (let j = -1; j < 5; j++) { const x = i * 64 + (j % 2 ? 32 : 0), y = j * 64; const gr = c.createRadialGradient(x + 32, y + 32, 4, x + 32, y + 32, 40); gr.addColorStop(0, '#5a1236'); gr.addColorStop(1, '#14020c'); c.fillStyle = gr; c.beginPath(); c.moveTo(x + 32, y); c.lineTo(x + 64, y + 32); c.lineTo(x + 32, y + 64); c.lineTo(x, y + 32); c.fill(); } grain(c, w, h, 10); }), [0.35, 0.35], { r: 0.5, bump: 2 });
  K.add(BX(0.62, 1.04, bl), quilt, bx, 0.56, bzc); K.add(RB(0.9, 0.06, bl + 0.1, 0.02), STD(0x0a0a0c, 0.12, 0.2, { ei: 1 }), bx - 0.1, 1.1, bzc); K.add(BX(0.02, 0.03, bl), GLOW(0xff3fa4), bx - 0.33, 0.06, bzc); K.add(BX(0.02, 0.02, bl), GLOW(0xff3fa4), bx - 0.545, 1.06, bzc);
  K.add(CY(0.025, 0.025, bl, 8), STD(0xc9a24a, 0.25, 1), bx - 0.5, 0.22, bzc, 0, PI / 2); for (let z = bz0 + 0.5; z < bz1; z += 1.5) K.add(CY(0.012, 0.012, 0.2, 6), STD(0xc9a24a, 0.25, 1), bx - 0.42, 0.15, z, 0, 0, 0.8);
  const back = new THREE.MeshBasicMaterial({ toneMapped: false, map: tx(cv(64, 256, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#5a1a8a'); gr.addColorStop(0.5, '#ff6ab4'); gr.addColorStop(1, '#ffb050'); c.fillStyle = gr; c.fillRect(0, 0, w, h); }), null) });
  K.at(W / 2 - 0.02, 0, bzc, -PI / 2, () => { K.add(RB(bl, 0.95, 0.55, 0.02), STD(0x121214, 0.35, 0.3), 0, 0.475, 0.28); for (let i = 0; i < 6; i++) { const x = -bl / 2 + 0.7 + i * 1.3; K.add(PL(1.1, 0.65), GLOW(0x16303a), x, 0.5, 0.56); }
    K.add(new THREE.PlaneGeometry(bl - 0.4, 1.5), back, 0, 1.95, 0.01); K.add(BX(bl - 0.3, 0.06, 0.06), blk, 0, 2.73, 0.03); const glassS = GLASS({ opacity: 0.3 });
    const bottle = LA([[0, 0], [0.04, 0], [0.042, 0.01], [0.042, 0.19], [0.03, 0.23], [0.013, 0.26], [0.013, 0.31], [0.016, 0.32], [0, 0.32]], 10), sq = LA([[0, 0], [0.05, 0], [0.05, 0.14], [0.02, 0.18], [0.013, 0.24], [0, 0.24]], 6);
    const bm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.88 }); bm.userData.ei = 1.2;
    for (const y of [1.3, 1.78, 2.26]) { K.add(BX(bl - 0.5, 0.02, 0.28), glassS, 0, y, 0.15); for (let x = -bl / 2 + 0.4; x < bl / 2 - 0.4; x += rr(0.11, 0.17)) K.add(rnd() < 0.7 ? bottle : sq, bm, x, y + 0.012, 0.15, 0, 0, 0, 1, rr(0.85, 1.15), 1, [0x2a8f5a, 0x8f2a2a, 0xd9a520, 0x2a4d8f, 0xe8e2d0, 0x6a3a1a, 0x101010][(rnd() * 7) | 0]); }
    K.add(PL(bl - 0.4, 0.5), STD(0xaab0b8, 0.05, 1, { ei: 1.4 }), 0, 3.05, 0.012); });
  for (let z = bz0 + 0.5; z <= bz1 - 0.4; z += 1.0) { const x = bx - 0.85; K.add(CY(0.19, 0.17, 0.08, 18), leather, x, 0.78, z); K.add(CY(0.028, 0.028, 0.74, 8), chrome, x, 0.38, z); K.add(CY(0.2, 0.22, 0.02, 18), chrome, x, 0.01, z); K.add(new THREE.TorusGeometry(0.15, 0.01, 4, 18), chrome, x, 0.3, z, 0, PI / 2); }
  // dancing podium (performers fully clothed) and velvet booths with low tables and tea lights
  const px = -W / 2 + 3.2, pzc = -3; K.add(RB(5, 0.5, 2.6, 0.04), STD(0x141418, 0.25, 0.4), px, 0.25, pzc); K.add(BX(5.02, 0.02, 0.02), nP, px, 0.5, pzc + 1.3); K.add(BX(0.02, 0.02, 2.62), nP, px + 2.5, 0.5, pzc);
  const sofa = (x, z, ry, len) => K.at(x, 0, z, ry, () => { K.add(RB(len, 0.42, 0.75, 0.04), velvet, 0, 0.21, 0); K.add(RB(len - 0.1, 0.14, 0.62, 0.06), velvet, 0, 0.48, -0.03); K.add(RB(len, 0.62, 0.22, 0.08), velvet, 0, 0.72, 0.3, 0, 0.12); for (let k = 0; k < Math.round(len / 0.7); k++) K.add(SP(0.05, 6, 4), blk, -len / 2 + 0.35 + k * 0.7, 0.8, 0.2);
    for (const s of [-1, 1]) K.add(RB(0.2, 0.62, 0.75, 0.07), velvet, s * (len / 2 - 0.1), 0.31, 0); });
  sofa(-W / 2 + 0.45, 3.4, -PI / 2, 3.2); sofa(-W / 2 + 2.2, D / 2 - 0.45, PI, 2.6); sofa(-3.3, D / 2 - 0.45, PI, 2.4);
  for (const [tx2, tz2] of [[-7.4, 3.4], [-6.1, 6.4], [-3.3, 6.6]]) { K.add(CY(0.4, 0.4, 0.04, 20), STD(0x0a0a0a, 0.1, 0.4, { ei: 1 }), tx2, 0.45, tz2); K.add(CY(0.06, 0.1, 0.43, 10), chrome, tx2, 0.215, tz2); K.add(CY(0.03, 0.03, 0.05, 8), GLOW(0xffb050), tx2, 0.495, tz2); K.add(CY(0.035, 0.03, 0.12, 8), GLASS({ opacity: 0.35 }), tx2 + 0.15, 0.53, tz2 + 0.1); }
  K.add(RB(1.6, 0.9, 0.012, 0.005), pbr(fabricCv('#18080e', { amt: 30 }), [0.3, 0.3], { r: 1 }), 0, 0.007, D / 2 - 0.8, 0, -PI / 2);
  K.done();
  const mball = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 14), new THREE.MeshStandardMaterial({ roughness: 0.12, metalness: 1, map: tx(cv(256, 128, (c, w, h) => { for (let x = 0; x < w; x += 8) for (let y = 0; y < h; y += 8) { c.fillStyle = `hsl(0,0%,${rr(35, 95)}%)`; c.fillRect(x, y, 7, 7); } }), null) })); mball.material.userData.ei = 1.6; mball.position.set(0, H - 1.0, -1.5); g.add(mball);
  // haze beams from the moving heads (additive cones), each paired with a real spotlight
  const beamTex = tx(cv(4, 128, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = '#000'; c.fillRect(0, 0, w, h); c.fillStyle = gr; c.fillRect(0, 0, w, h); }), null, false);
  const beamGeo = new THREE.CylinderGeometry(0.06, 1.1, 1, 16, 1, true); beamGeo.translate(0, -0.5, 0);
  const cols = [0xff3fa4, 0x3fa4ff, 0x9f3fff, 0x19e6c1], heads = [[-4.5, -4.5], [4.5, -4.5], [-1.5, 1.5], [1.5, 1.5]];
  const beams = heads.map(([x, z], i) => { const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: cols[i], map: beamTex, transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false })); m.position.set(x, 3.76, z); m.renderOrder = 3; g.add(m); return m; });
  const spots = [0, 1, 2].map(i => { const s = new THREE.SpotLight(cols[i], 70, 18, 0.32, 0.5, 1.3); s.position.set(heads[i][0], 3.7, heads[i][1]); g.add(s, s.target); return s; });
  lamp(g, 0xff4fb0, 7, W / 2 - 2.2, 2.6, 1, 9);
  const dj = npc(I, 1, 0, bz - 0.8, PI, 'dance'); dj.position.y = 0.25; npc(I, 7, bx + 0.75, 0.6, PI / 2);
  for (let i = 0; i < 2; i++) npc(I, 5 - i, px - 1 + i * 2, pzc, PI * 0.15, 'dance').position.y = 0.5;
  for (let i = 0; i < 6; i++) npc(I, i + 2, -1.8 + (i % 3) * 1.8 + rr(-0.3, 0.3), -2.6 + Math.floor(i / 3) * 2.2 + rr(-0.3, 0.3), rnd() * 6, 'dance').position.y = 0.05;
  I.spots.push({ act: 'shop', shop: 'club', x: W / 2 - 2.3, z: 1, r: 2, label: 'BAR' }); exitDoor(I, D / 2, '#ff3fa4');
  const _d = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0); let acc = 1;
  I.step = dt => { stepNpcs(I, dt); const t = performance.now() / 1000; acc += dt; if (acc > 0.05) { acc = 0; drawFloor(t); } mball.rotation.y += dt * 0.6;
    beams.forEach((b, i) => { const tx3 = Math.sin(t * 0.9 + i * 2) * 4.5, tz3 = -1.5 + Math.cos(t * 0.7 + i * 1.3) * 3.5; _d.set(tx3 - b.position.x, -b.position.y, tz3 - b.position.z); const L = _d.length(); _d.normalize(); b.quaternion.setFromUnitVectors(up, _d.negate()); b.scale.set(1, L, 1); b.material.opacity = 0.22 + 0.12 * Math.sin(t * 4 + i);
      if (spots[i]) spots[i].target.position.set(tx3, 0, tz3); }); };
  info.envI = 0.6; return info; }

// ------------------------------------------------------------------ cinema
function cinemaRoom(I, v, V) { const g = I.g, W = 20, D = 26, H = 9; seed = 71;
  const K = new Kit(g);
  const carpet = pbr(cv(256, 256, (c, w, h) => { c.fillStyle = '#1a1030'; c.fillRect(0, 0, w, h); for (let i = 0; i < 16; i++) { c.fillStyle = ['#7a2a4a', '#2a4a7a', '#8a6a20'][i % 3]; c.save(); c.translate(rnd() * w, rnd() * h); c.rotate(rnd() * 3); c.fillRect(-6, -1.5, 12, 3); c.restore(); } grain(c, w, h, 30, false); }), [1.2, 1.2], { r: 0.95, bump: 0.8, det: 'carpet', da: 0.55, ds: 2 });
  const panels = pbr(cv(512, 512, (c, w, h) => { c.fillStyle = '#0a0a0e'; c.fillRect(0, 0, w, h); for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { c.fillStyle = shade('#262a3a', rr(-0.02, 0.02)); c.fillRect(i * 256 + 6, j * 256 + 6, 244, 244); }
    grain(c, w, h, 16); for (let y = 0; y < h; y += 3) { c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(0, y, w, 1); } }), [2.4, 3], { r: 0.95, bump: 1.6 });
  const info = room(I, W, D, H, carpet, panels, pbr(fabricCv('#08080a', { amt: 10 }), [1, 1], { r: 1 }), { K, skirt: STD(0x101014, 0.6), skirtH: 0.15, sky: 0x403040, gnd: 0x100808, hemi: 0.3 });
  // screen with masking, velvet curtains (folded) and a valance; low stage apron
  const pre = tx(cv(1024, 578, (c, w, h) => { const gr = c.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w * 0.6); gr.addColorStop(0, '#5a4a38'); gr.addColorStop(1, '#1a1612'); c.fillStyle = gr; c.fillRect(0, 0, w, h); c.textAlign = 'center'; c.fillStyle = '#ffcc33'; c.font = '800 92px system-ui,Arial'; c.fillText('CUZZY CINEMA', w / 2, h / 2 - 10); c.fillStyle = '#d8ccb8'; c.font = '500 34px system-ui,Arial'; c.fillText('Please switch off your phones · enjoy the film', w / 2, h / 2 + 60); }), null);
  pre.wrapS = pre.wrapT = THREE.ClampToEdgeWrapping;
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(14, 7.9), new THREE.MeshBasicMaterial({ color: 0xffffff, map: pre, toneMapped: false })); scr.position.set(0, 4.6, -D / 2 + 0.05); g.add(scr); I.screen = scr;
  K.add(BX(15.2, 9, 0.02), STD(0x020202, 0.95), 0, 4.5, -D / 2 + 0.012);
  const vel = pbr(cv(64, 256, (c, w, h) => { c.fillStyle = '#6a0a12'; c.fillRect(0, 0, w, h); grain(c, w, h, 18); }), [1, 2], { r: 0.75, bump: 0.3 });
  const fold = (w, h, n, amp) => { const p = new THREE.PlaneGeometry(w, h, n, 1), a = p.attributes.position; for (let i = 0; i < a.count; i++) a.setZ(i, Math.sin(a.getX(i) / w * n * PI) * amp + amp); p.computeVertexNormals(); const uv = p.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h); return p; };
  for (const s of [-1, 1]) K.add(fold(2.7, 8.6, 24, 0.09), vel, s * 8.6, 4.3, -D / 2 + 0.12); K.add(fold(20, 0.9, 80, 0.06), vel, 0, H - 0.45, -D / 2 + 0.25);
  K.add(BX(17, 0.6, 1.6), carpet, 0, 0.3, -D / 2 + 0.8); K.add(BX(17, 0.04, 0.04), GLOW(0x5a3a1a), 0, 0.58, -D / 2 + 1.6);
  // stadium tiers: 9 rows (rise 0.43, depth 1.25) with two-step aisles at each side, LED step nosings
  const zr = i => 5.6 + (i - 6) * 1.25, yr = i => 0.43 * i, riser = STD(0x0c0a10, 0.9), nose = STD(0x2a2a30, 0.5, 0.4), stepL = GLOW(0xffb040);
  for (let i = 1; i < 9; i++) { const z0 = zr(i) - 0.625, z1 = i === 8 ? D / 2 : zr(i) + 0.625, y = yr(i), zc = (z0 + z1) / 2, dz = z1 - z0;
    K.add(BX(15.7, y, dz), carpet, 0, y / 2, zc); K.add(BX(15.7, 0.03, 0.05), nose, 0, y - 0.015, z0 + 0.025);
    for (const s of [-1, 1]) { const ax = s * (7.85 + 1.075); K.add(BX(2.15, y - 0.215, 0.625), carpet, ax, (y - 0.215) / 2, z0 + 0.3125); K.add(BX(2.15, y, dz - 0.625), carpet, ax, y / 2, z0 + 0.625 + (dz - 0.625) / 2);
      for (const [sy, sz] of [[y - 0.215, z0], [y, z0 + 0.625]]) { K.add(BX(2.15, 0.03, 0.05), nose, ax, sy - 0.015, sz + 0.025); K.add(BX(0.06, 0.02, 0.02), stepL, s * 8.0, sy - 0.04, sz - 0.002); K.add(BX(0.06, 0.02, 0.02), stepL, s * 9.85, sy - 0.04, sz - 0.002); } } }
  for (const s of [-1, 1]) K.add(CY(0.025, 0.025, 11.7, 8), STD(0x9a9ea4, 0.3, 0.9), s * 7.85, 2.62, 3.1, 0, Math.atan2(11.2, 3.44));
  // seats: modelled once (cushion, raked back, armrest with cup holder) and instanced across the rows
  const SK = new Kit(new THREE.Group()), uph = pbr(fabricCv('#8a0f1c', { amt: 22 }), [0.2, 0.2], { r: 0.8, bump: 0.8 }), shell = STD(0x141416, 0.45, 0.2);
  SK.add(RB(0.52, 0.14, 0.5, 0.05), uph, 0, 0.41, -0.02); SK.add(RB(0.54, 0.74, 0.12, 0.05), uph, 0, 0.84, 0.27, 0, 0.17); SK.add(RB(0.44, 0.34, 0.06, 0.03), uph, 0, 0.66, 0.2, 0, 0.17);
  SK.add(RB(0.56, 0.78, 0.04, 0.02), shell, 0, 0.82, 0.35, 0, 0.17); SK.add(BX(0.4, 0.3, 0.4), shell, 0, 0.17, 0.02); SK.add(RB(0.08, 0.05, 0.58, 0.022), shell, -0.31, 0.66, 0.04); SK.add(BX(0.05, 0.62, 0.42), shell, -0.31, 0.33, 0.08); SK.add(CY(0.042, 0.036, 0.07, 10, true), shell, -0.31, 0.665, -0.2);
  const [mU, mS] = SK.done(), seats = []; for (let i = 0; i < 9; i++) for (let k = -12; k <= 12; k++) seats.push([k * 0.62, yr(i), zr(i) - 0.05]);
  for (const ms of [mU, mS]) { const im = new THREE.InstancedMesh(ms.geometry, ms.material, seats.length); seats.forEach(([x, y, z], n) => im.setMatrixAt(n, _m.makeTranslation(x, y, z))); im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); g.add(im); }
  for (let i = 0; i < 9; i++) { K.add(RB(0.08, 0.05, 0.58, 0.022), shell, 12 * 0.62 + 0.31, yr(i) + 0.66, zr(i) - 0.01); K.add(BX(0.05, 0.62, 0.42), shell, 12 * 0.62 + 0.31, yr(i) + 0.33, zr(i) + 0.03); }
  // wall sconces (up-lights with a soft wash), projection-booth window and the projector beam
  const wash = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, map: tx(cv(64, 128, (c, w, h) => { const gr = c.createRadialGradient(w / 2, h, 2, w / 2, h, h); gr.addColorStop(0, 'rgba(255,170,90,0.9)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = '#000'; c.fillRect(0, 0, w, h); c.fillStyle = gr; c.fillRect(0, 0, w, h); }), null, false) });
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) { const z = -9 + i * 4; K.add(CY(0.16, 0.1, 0.22, 12, false, 0, PI), STD(0x2a2420, 0.4, 0.6), s * (W / 2 - 0.01), 3.6, z, s > 0 ? PI : 0); K.add(BX(0.02, 0.02, 0.24), GLOW(0xffc080), s * (W / 2 - 0.12), 3.72, z); K.add(PL(1.0, 2.0), wash, s * (W / 2 - 0.03), 4.6, z, -s * PI / 2); }
  K.add(PL(1.4, 0.7), GLOW(0x8aa0c0), 0, 6.6, D / 2 - 0.02, PI); K.add(BX(1.6, 0.9, 0.08), STD(0x050505, 0.6), 0, 6.6, D / 2 - 0.01);
  const bg = new THREE.BufferGeometry(), A = [0, 6.6, D / 2 - 0.1], Cn = [[-7, 0.65], [7, 0.65], [7, 8.55], [-7, 8.55]].map(([x, y]) => [x, y, -D / 2 + 0.2]), P = [], Cc = [];
  for (let k = 0; k < 4; k++) { const a = Cn[k], b = Cn[(k + 1) % 4]; P.push(...A, ...a, ...b); Cc.push(1, 1, 1, 0.12, 0.12, 0.12, 0.12, 0.12, 0.12); }
  bg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); bg.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
  const beamM = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.05, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }), beam = new THREE.Mesh(bg, beamM); beam.renderOrder = 3; g.add(beam);
  // dust motes drifting through the beam
  const dp = []; for (let i = 0; i < 160; i++) { const t = rnd(); dp.push(rr(-6, 6) * t, 6.6 + (rr(0.6, 8.6) - 6.6) * t, D / 2 - 0.1 - t * (D - 0.3)); } const dust = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(dp, 3)), new THREE.PointsMaterial({ color: 0x8a8a9a, size: 0.025, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending })); g.add(dust);
  // ceiling downlights (dim house lights)
  for (let x = -7.5; x <= 7.5; x += 3) for (let z = -9; z <= 11; z += 4) K.add(CY(0.07, 0.07, 0.02, 10), GLOW(0xffd8a0), x, H - 0.01, z);
  // snack counter with popcorn machine near the front
  K.at(-W / 2 + 1.6, 0, -9.6, PI / 2, () => { K.add(RB(1.8, 1.0, 0.7, 0.02), STD(0x9a1420, 0.4), 0, 0.5, 0); K.add(RB(1.9, 0.04, 0.8, 0.01), STD(0x1a1a1a, 0.3, 0.3), 0, 1.02, 0); K.add(PL(1.7, 0.2), GLOW(0xffcc33), 0, 0.8, 0.355);
    K.add(BX(0.6, 0.62, 0.48), GLASS({ opacity: 0.25 }), -0.4, 1.35, -0.05); K.add(BX(0.56, 0.24, 0.44), STD(0xf2d27a, 0.9), -0.4, 1.16, -0.05); K.add(RB(0.66, 0.12, 0.54, 0.03), STD(0xc81d1d, 0.4), -0.4, 1.72, -0.05); K.add(BX(0.56, 0.02, 0.44), GLOW(0xffe0a0), -0.4, 1.65, -0.05);
    for (let i = 0; i < 5; i++) K.add(CY(0.06, 0.045, 0.16, 10), STD(0xe8e2d2, 0.7), 0.25 + i * 0.13, 1.12, 0.1); });
  K.done();
  // house lights: warm wash on the walls, dimmed while a film plays
  const L1 = lamp(g, 0xffb070, 10, -6, 5, 0, 18), L2 = lamp(g, 0xffb070, 10, 6, 5, 0, 18), L3 = lamp(g, 0xffd8b0, 6, 0, 7, 9, 16);
  const row = (i, k, look) => npc(I, look, k * 0.62, zr(i) - 0.05, 0, 'sit', yr(i));
  I.spots.push({ act: 'watch', x: 0, z: -3.4, r: 2.4, label: 'WATCH', sit: { x: 0, y: 6 * 0.32 + 1.15, z: -4 + 6 * 1.6 } });
  row(2, -8, 3); row(4, 5, 5); row(5, -3, 6); row(7, 9, 2);
  I.spots.push({ act: 'shop', shop: 'cinema', x: -W / 2 + 2.6, z: -9.6, r: 1.8, label: 'POPCORN' });
  exitDoor(I, -9.6, '#ffcc33', W / 2, -PI / 2);
  // the film plays through YouTube's own player, fitted to the screen's four corners every frame
  const fr = document.createElement('div'); fr.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:360px;transform-origin:0 0;pointer-events:none;z-index:1;background:#000;display:none'; document.body.appendChild(fr); I.fr = fr;
  I.play = id => { fr.innerHTML = id ? `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0&modestbranding=1&loop=1&playlist=${id}" allow="autoplay; encrypted-media" style="width:640px;height:360px;border:0"></iframe>` : ''; fr.dataset.on = id ? '1' : ''; };
  I.stopFx = () => fr.remove();
  const C = [[-7, 3.95], [7, 3.95], [7, -3.95], [-7, -3.95]].map(([x, y]) => new THREE.Vector3(x, y, 0)), v3 = new THREE.Vector3(); let dim = 0;
  I.step = dt => { stepNpcs(I, dt); const on = !!fr.dataset.on; dim += ((on ? 1 : 0) - dim) * Math.min(1, dt * 1.5); L1.intensity = L2.intensity = 10 * (1 - dim * 0.85); L3.intensity = 6 * (1 - dim * 0.9); beamM.opacity = 0.05 + dim * 0.1; dust.material.opacity = 0.25 + dim * 0.5;
    const sess = V.s, cam = sess.g.cam; if (!on) { fr.style.display = 'none'; return; } scr.updateWorldMatrix(true, false); cam.updateMatrixWorld();
    const R = sess.g.r.domElement.getBoundingClientRect(), P = []; for (const c of C) { v3.copy(c); scr.localToWorld(v3); v3.project(cam); if (v3.z > 1) { fr.style.display = 'none'; return; } P.push([R.left + (v3.x + 1) / 2 * R.width, R.top + (1 - v3.y) / 2 * R.height]); }
    fr.style.display = ''; fr.style.transform = homography(P, 640, 360); };
  info.entry = { x: W / 2 - 1.6, z: -7.4, yaw: 0 }; info.envI = 0.3; return info; }
export function homography(P, w, h) { const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = P, dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3, den = dx1 * dy2 - dx2 * dy1;
  const g = den ? (dx3 * dy2 - dx2 * dy3) / den : 0, hh = den ? (dx1 * dy3 - dx3 * dy1) / den : 0, A = x1 - x0 + g * x1, B = x3 - x0 + hh * x3, D = y1 - y0 + g * y1, E = y3 - y0 + hh * y3;
  return `matrix3d(${A / w},${D / w},0,${g / w},${B / h},${E / h},0,${hh / h},0,0,1,0,${x0},${y0},0,1)`; }

// ------------------------------------------------------------------ mosque
// normal map from a canvas' luminance (Sobel), for carpet pile, plaster, tile glaze and carved wood
function nmap(src, k = 2) { const w = src.width, h = src.height, s = src.getContext('2d').getImageData(0, 0, w, h).data, c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'), o = g.createImageData(w, h), L = (x, y) => s[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const dx = (L(x + 1, y) - L(x - 1, y)) * k, dy = (L(x, y + 1) - L(x, y - 1)) * k, l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4; o.data[i] = (-dx / l * 0.5 + 0.5) * 255; o.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; o.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; o.data[i + 3] = 255; }
  g.putImageData(o, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; }
function pbrN(c, size, o = {}) { if (o.det) detail(c.getContext('2d'), c.width, c.height, o.det, o.da ?? 0.55, o.ds ?? 1); const t = tx(c, size), n = nmap(o.hc || c, o.k ?? 2); n.repeat.copy(t.repeat); const m = new THREE.MeshStandardMaterial({ map: t, normalMap: n, normalScale: new THREE.Vector2(o.ns ?? 1, o.ns ?? 1), roughness: o.r ?? 0.7, metalness: o.m ?? 0, ...(o.side ? { side: o.side } : {}) }); if (o.ei != null) m.userData.ei = o.ei; return m; }
function archPts(w, a, n = 10, y0 = 0) { const L = new THREE.CubicBezierCurve(new THREE.Vector2(-w / 2, y0), new THREE.Vector2(-w / 2, y0 + a * 0.55), new THREE.Vector2(-w * 0.16, y0 + a * 0.88), new THREE.Vector2(0, y0 + a)), R = new THREE.CubicBezierCurve(new THREE.Vector2(0, y0 + a), new THREE.Vector2(w * 0.16, y0 + a * 0.88), new THREE.Vector2(w / 2, y0 + a * 0.55), new THREE.Vector2(w / 2, y0)); return [...L.getPoints(n), ...R.getPoints(n).slice(1)]; }
const ring = (outer, inner) => { const s = new THREE.Shape(outer); for (const p of [...inner].reverse()) s.lineTo(p.x, p.y); s.closePath(); return s; };
function girih(c, w, h, cell, cols, line, lw) { // repeating 8-point star and cross tiling with interlace lines
  for (let y = -cell; y < h + cell; y += cell) for (let x = -cell; x < w + cell; x += cell) { star8(c, x + cell / 2, y + cell / 2, cell * 0.42, cols[0], line, lw); star8(c, x + cell / 2, y + cell / 2, cell * 0.2, cols[1], line, lw * 0.7);
    c.save(); c.translate(x, y); c.rotate(PI / 4); c.fillStyle = cols[2]; c.fillRect(-cell * 0.12, -cell * 0.12, cell * 0.24, cell * 0.24); c.strokeStyle = line; c.lineWidth = lw * 0.7; c.strokeRect(-cell * 0.12, -cell * 0.12, cell * 0.24, cell * 0.24); c.restore(); } }
function mosqueRoom(I, v) { const g = I.g, W = 22, D = 26, H = 8; seed = 97;
  const K = new Kit(g), gold = STD(0xc8a050, 0.3, 0.9, { ei: 1.3, side: THREE.DoubleSide }), goldDk = STD(0x8a6a2a, 0.38, 0.9, { side: THREE.DoubleSide });
  // marble: large slabs with soft veins, polished
  const marbleCv = cv(512, 512, (c, w, h) => { c.fillStyle = '#ece6da'; c.fillRect(0, 0, w, h); for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { c.fillStyle = shade('#ebe4d6', rr(-0.02, 0.02)); c.fillRect(i * 256, j * 256, 256, 256); }
    c.filter = 'blur(1.2px)'; for (let k = 0; k < 26; k++) { c.strokeStyle = `rgba(${rr(120, 160)},${rr(110, 140)},${rr(100, 125)},${rr(0.08, 0.3)})`; c.lineWidth = rr(0.6, 2.6); c.beginPath(); let x = rnd() * w, y = rnd() * h; c.moveTo(x, y); for (let s = 0; s < 8; s++) { x += rr(-60, 80); y += rr(-30, 50); c.lineTo(x, y); } c.stroke(); } c.filter = 'none';
    grain(c, w, h, 6); c.fillStyle = 'rgba(90,80,70,0.55)'; c.fillRect(0, 0, w, 2); c.fillRect(0, 0, 2, h); c.fillRect(0, 255, w, 2); c.fillRect(255, 0, 2, h); });
  const marble = pbr(marbleCv, [1.6, 1.6], { r: 0.16, bump: 0.15, ei: 0.9 });
  // prayer carpet: saff rows of prayer places (arch toward the qibla), fine borders, wool pile
  const carpCv = cv(1024, 200, (c, w, h) => { c.fillStyle = '#4e0c13'; c.fillRect(0, 0, w, h); const pw = w / 8;
    for (let i = 0; i < 8; i++) { const x = i * pw; c.fillStyle = '#5c1018'; c.fillRect(x + 6, 10, pw - 12, h - 20); c.strokeStyle = '#a8864a'; c.lineWidth = 1.5; c.strokeRect(x + 9, 13, pw - 18, h - 26); for (let k = 0; k < 20; k++) { c.fillStyle = k % 2 ? 'rgba(168,134,74,.5)' : 'rgba(30,70,60,.6)'; c.fillRect(x + 10 + k * (pw - 20) / 20, 15, 2, 2); c.fillRect(x + 10 + k * (pw - 20) / 20, h - 17, 2, 2); }
      c.fillStyle = '#173b2e'; archCv(c, pw - 34, 70, 22, x + pw / 2, h - 22); c.fill(); c.strokeStyle = '#a8864a'; c.lineWidth = 2; c.stroke(); c.fillStyle = '#641420'; archCv(c, pw - 50, 82, 34, x + pw / 2, h - 30); c.fill(); c.strokeStyle = '#b8955a'; c.lineWidth = 1; c.stroke(); for (let k = 0; k < 40; k++) { c.fillStyle = ['rgba(184,149,90,.55)', 'rgba(40,90,110,.5)', 'rgba(120,30,40,.8)'][k % 3]; c.beginPath(); c.arc(x + 30 + rnd() * (pw - 60), 60 + rnd() * (h - 100), rr(1, 2.4), 0, PI * 2); c.fill(); }
      star8(c, x + pw / 2, 112, 14, '#9a7a40', '#173b2e', 1.5); star8(c, x + pw / 2, 112, 6, '#173b2e', null); for (let k = 0; k < 7; k++) { c.fillStyle = k % 2 ? '#b8955a' : '#2a5a6a'; c.beginPath(); c.arc(x + 26 + k * ((pw - 52) / 6), h - 38, 2.5, 0, PI * 2); c.fill(); } }
    c.fillStyle = '#a8864a'; c.fillRect(0, 0, w, 4); c.fillRect(0, h - 4, w, 4); c.fillStyle = '#173b2e'; c.fillRect(0, 4, w, 4); c.fillRect(0, h - 8, w, 4);
    const d = c.getImageData(0, 0, w, h), p = d.data; for (let i = 0; i < p.length; i += 4) { const n = (rnd() - 0.5) * 40, row = ((i / 4) % w) % 2 ? 6 : -6; p[i] += n + row; p[i + 1] += n * 0.8 + row; p[i + 2] += n * 0.8 + row; } c.putImageData(d, 0, 0); });
  const carpet = pbrN(carpCv, [6.4, 1.25], { r: 0.96, k: 3, ns: 0.6, det: 'carpet', da: 0.5, ds: 3 }); carpet.userData.ei = 0.2;
  const plasterC = plasterCv('#e6dac4', { w: 512, h: 512, amt: 7 }), plaster = pbrN(plasterC, [3, 3], { r: 0.88, k: 4, ns: 0.4 });
  // zellige dado: glazed cut-tile star pattern, each piece slightly different
  const zelC = cv(512, 512, (c, w, h) => { c.fillStyle = '#f2ece0'; c.fillRect(0, 0, w, h); c.fillStyle = '#e8dfcc'; c.fillRect(0, 0, w, h); girih(c, w, h, 128, ['#17507a', '#c9a24a', '#24684a'], '#f3eee2', 5);
    const d = c.getImageData(0, 0, w, h), p = d.data; for (let i = 0; i < p.length; i += 4) { const n = (rnd() - 0.5) * 10; p[i] += n; p[i + 1] += n; p[i + 2] += n; } c.putImageData(d, 0, 0); });
  const zellige = pbrN(zelC, [1.2, 1.2], { r: 0.2, k: 1.5, ns: 0.5, ei: 1 });
  const friezeC = cv(1024, 64, (c, w, h) => { c.fillStyle = '#123a5a'; c.fillRect(0, 0, w, h); c.strokeStyle = '#d9b45a'; c.lineWidth = 3; for (let x = 0; x < w; x += 64) { star8(c, x + 32, 32, 24, '#1f5f8a', '#d9b45a', 2); c.beginPath(); c.moveTo(x, 4); c.lineTo(x + 64, 4); c.moveTo(x, 60); c.lineTo(x + 64, 60); c.stroke(); } });
  const frieze = pbrN(friezeC, [4, 0.25], { r: 0.3, k: 1.2, ns: 0.5 });
  const info = room(I, W, D, H, marble, plaster, false, { K, dado: zellige, dadoH: 1.35, rail: gold, skirt: STD(0x6a5a48, 0.3), skirtH: 0.12, sky: 0xffeedd, gnd: 0x4a2018, hemi: 0.28 });
  for (const [px, pz, ry, len] of [[0, -D / 2, 0, W], [0, D / 2, PI, W], [-W / 2, 0, PI / 2, D], [W / 2, 0, -PI / 2, D]]) { K.add(PL(len, 0.28), frieze, px + Math.sin(ry) * 0.02, 1.55, pz + Math.cos(ry) * 0.02, ry); K.add(BX(len, 0.04, 0.03), gold, px + Math.sin(ry) * 0.025, 1.7, pz + Math.cos(ry) * 0.025, ry); K.add(PL(len, 0.4), frieze, px + Math.sin(ry) * 0.02, H - 0.45, pz + Math.cos(ry) * 0.02, ry); K.add(BX(len, 0.14, 0.12), plaster, px + Math.sin(ry) * 0.06, H - 0.18, pz + Math.cos(ry) * 0.06, ry); }
  // carpet (slightly raised, with a bound edge) over the marble, marble margin at the entrance for shoes
  const cz0 = -D / 2 + 0.6, cz1 = 8.6, cw = W - 1.2; K.add(PL(cw, cz1 - cz0), carpet, 0, 0.02, (cz0 + cz1) / 2, 0, -PI / 2); K.add(BX(cw, 0.02, 0.06), STD(0x3a0a10, 0.9), 0, 0.012, cz1); K.add(BX(cw, 0.02, 0.06), STD(0x3a0a10, 0.9), 0, 0.012, cz0);
  // ceiling: coffered timber-and-plaster ceiling around a central dome on a drum of small arched windows
  const dz = -1, dr = 5.2, ceil = new THREE.Shape(); ceil.moveTo(-W / 2, -D / 2); ceil.lineTo(W / 2, -D / 2); ceil.lineTo(W / 2, D / 2); ceil.lineTo(-W / 2, D / 2); ceil.closePath(); const hole = new THREE.Path(); hole.absarc(0, dz, dr, 0, PI * 2, true); ceil.holes.push(hole);
  const cofC = cv(256, 256, (c, w, h) => { c.fillStyle = '#e9dfca'; c.fillRect(0, 0, w, h); c.fillStyle = '#5a3a22'; c.fillRect(0, 0, w, 22); c.fillRect(0, 0, 22, h); c.fillStyle = '#d8c8a8'; c.fillRect(30, 30, w - 52, h - 52); star8(c, w / 2 + 11, h / 2 + 11, 60, '#1f5f8a', '#c8a050', 3); star8(c, w / 2 + 11, h / 2 + 11, 26, '#c8a050', null); grain(c, w, h, 8); });
  K.add(new THREE.ShapeGeometry(ceil, 48), pbrN(cofC, [2, 2], { r: 0.8, k: 3, ns: 0.8, side: THREE.DoubleSide }), 0, H, 0, 0, PI / 2);
  const drumC = cv(1024, 128, (c, w, h) => { c.fillStyle = '#efe7d6'; c.fillRect(0, 0, w, h); for (let i = 0; i < 16; i++) { const x = i * 64 + 32; c.fillStyle = '#fff3d0'; archCv(c, 30, 70, 104, x, 112); c.fill(); c.strokeStyle = '#c8a050'; c.lineWidth = 4; c.stroke(); c.strokeStyle = 'rgba(120,90,50,.6)'; c.lineWidth = 1.5; for (let k = 0; k < 6; k++) { c.beginPath(); c.moveTo(x - 15, 50 + k * 10); c.lineTo(x + 15, 50 + k * 10); c.stroke(); } } c.fillStyle = '#123a5a'; c.fillRect(0, 0, w, 10); c.fillRect(0, h - 10, w, 10); });
  const drumT = tx(drumC, null); drumT.repeat.set(2, 1); K.add(CY(dr, dr, 1.4, 48, true), new THREE.MeshStandardMaterial({ map: drumT, emissiveMap: drumT, emissive: 0xffe8b0, emissiveIntensity: 0.55, roughness: 0.8, side: THREE.BackSide }), 0, H + 0.7, dz);
  const domeC = cv(1024, 512, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#f3ead8'); gr.addColorStop(1, '#e6d8bc'); c.fillStyle = gr; c.fillRect(0, 0, w, h); const n = 16, gw = w / n;
    for (let i = 0; i < n; i++) { const x = i * gw; c.fillStyle = i % 2 ? '#1c4d72' : '#efe4cc'; c.beginPath(); c.moveTo(x + gw / 2, 0); c.lineTo(x + gw - 6, h * 0.62); c.lineTo(x + gw / 2, h * 0.9); c.lineTo(x + 6, h * 0.62); c.closePath(); c.fill(); c.strokeStyle = '#c8a050'; c.lineWidth = 3; c.stroke(); star8(c, x + gw / 2, h * 0.62, gw * 0.22, i % 2 ? '#c8a050' : '#1c4d72', '#c8a050', 1.5); }
    c.fillStyle = '#c8a050'; for (let i = 0; i < n; i++) c.fillRect(i * gw - 2, 0, 4, h); c.fillRect(0, h - 26, w, 6); star8(c, w / 2, 20, 30, '#c8a050', null); });
  K.add(new THREE.SphereGeometry(dr, 48, 16, 0, PI * 2, 0, PI / 2), pbrN(domeC, null, { r: 0.6, k: 1, ns: 0.5, side: THREE.BackSide }), 0, H + 1.4, dz);
  // qibla wall: a tiled field around the mihrab
  const qibC = cv(512, 512, (c, w, h) => { c.fillStyle = '#f4efe3'; c.fillRect(0, 0, w, h); girih(c, w, h, 128, ['#e9e1cf', '#1f5f8a', '#c8a050'], '#2a6a8a', 3); grain(c, w, h, 6); });
  K.add(PL(9, 6.2), pbrN(qibC, [1.2, 1.2], { r: 0.3, k: 1.2, ns: 0.5, ei: 0.8 }), 0, 4.45, -D / 2 + 0.015); K.add(BX(9.2, 0.12, 0.1), gold, 0, 7.6, -D / 2 + 0.05); for (const s of [-1, 1]) K.add(BX(0.12, 6.4, 0.1), gold, s * 4.55, 4.45, -D / 2 + 0.05);
  // mihrab: projecting pishtaq frame, layered gold mouldings, half-round niche with a muqarnas hood, flanking colonnettes
  const mz = -D / 2, fw = 3.8, fh = 6.0, ow = 2.1, spring = 3.0, apex = 1.6;
  const outer = [new THREE.Vector2(-fw / 2, 0), ...archPts(ow, apex, 14).map(p => new THREE.Vector2(p.x, p.y + spring))]; // build frame as polygon: frame outline minus the arched opening
  const fS = new THREE.Shape(); fS.moveTo(-fw / 2, 0); fS.lineTo(-ow / 2, 0); for (const p of archPts(ow, apex, 14)) fS.lineTo(p.x, p.y + spring); fS.lineTo(ow / 2, 0); fS.lineTo(fw / 2, 0); fS.lineTo(fw / 2, fh); fS.lineTo(-fw / 2, fh); fS.closePath();
  const mihMarble = pbr(marbleCv, [1.2, 1.2], { r: 0.2, bump: 0.1, ei: 0.9 }); K.add(EX(fS, 1.0, 0.02), mihMarble, 0, 0, mz + 0.5);
  const rg = (w1, w2, d, a1, a2, s0, z, mat) => { const o = archPts(w1, a1, 14).map(p => new THREE.Vector2(p.x, p.y + s0)), i = archPts(w2, a2, 14).map(p => new THREE.Vector2(p.x, p.y + s0)); const sh = new THREE.Shape([new THREE.Vector2(-w1 / 2, 0), ...o, new THREE.Vector2(w1 / 2, 0), new THREE.Vector2(w2 / 2, 0), ...[...i].reverse(), new THREE.Vector2(-w2 / 2, 0)]); K.add(EX(sh, d, 0.015), mat, 0, 0, z); };
  rg(ow + 0.34, ow + 0.06, 0.08, apex + 0.24, apex + 0.04, spring, mz + 1.02, gold); rg(ow + 0.62, ow + 0.42, 0.05, apex + 0.42, apex + 0.3, spring, mz + 1.01, goldDk);
  K.add(BX(fw + 0.2, 0.16, 0.12), gold, 0, fh + 0.08, mz + 0.96); K.add(BX(fw - 0.5, 0.9, 0.02), pbrN(qibC, [0.6, 0.6], { r: 0.25, k: 1.2 }), 0, fh - 0.7, mz + 1.012); K.add(BX(fw - 0.4, 0.05, 0.05), gold, 0, fh - 0.22, mz + 1.03); K.add(BX(fw - 0.4, 0.05, 0.05), gold, 0, fh - 1.18, mz + 1.03);
  const zp = pbrN(zelC, [0.3, 0.3], { r: 0.2, k: 1.2 }); for (const s of [-1, 1]) { const x = s * (fw / 2 - 0.28); K.add(PL(0.36, 4.2), zp, x, 2.25, mz + 1.012); K.add(BX(0.05, 4.3, 0.04), gold, x - 0.2, 2.25, mz + 1.02); K.add(BX(0.05, 4.3, 0.04), gold, x + 0.2, 2.25, mz + 1.02); }
  const nicheC = cv(512, 512, (c, w, h) => { c.fillStyle = '#e9e0cc'; c.fillRect(0, 0, w, h); girih(c, w, h, 96, ['#f2ead8', '#1f5f8a', '#c8a050'], '#c8a050', 2.5); c.fillStyle = 'rgba(0,0,0,0.08)'; c.fillRect(0, 0, w, h); });
  const nicheM = pbrN(nicheC, null, { r: 0.35, k: 1.2, ns: 0.6, side: THREE.DoubleSide, ei: 0.9 }); nicheM.map.repeat.set(3, 2); nicheM.normalMap.repeat.set(3, 2);
  const nr = ow / 2 - 0.06; K.add(CY(nr, nr, spring, 24, true, PI / 2, PI), nicheM, 0, spring / 2, mz + 1.0); K.add(new THREE.CircleGeometry(nr, 24, 0, PI), marble, 0, 0.012, mz + 1.0, 0, -PI / 2);
  K.add(new THREE.SphereGeometry(nr, 24, 10, PI, PI, 0, PI / 2), nicheM, 0, spring, mz + 1.0, 0, 0, 0, 1, apex / nr * 0.95, 1);
  // muqarnas: tiers of small pointed cells stepping inward up the hood, alternating gold and stone
  const cell = (cw, chh) => { const sh = new THREE.Shape([new THREE.Vector2(-cw / 2, 0), ...archPts(cw, chh, 4).map(p => new THREE.Vector2(p.x, p.y)), new THREE.Vector2(cw / 2, 0)]); return EX(sh, 0.05, 0.006, { cs: 4 }); };
  const stoneM = STD(0xefe6d2, 0.4);
  for (let t = 0; t < 4; t++) { const r = nr * (1 - t * 0.2), y = spring + t * 0.3, n = 9 - t * 2, cg = cell(PI * r / n * 0.9, 0.22); for (let k = 0; k < n; k++) { const a = PI + (k + 0.5) / n * PI, x = Math.cos(a) * r * 0.97, z = mz + 1.0 + Math.sin(a) * r * 0.97; K.add(cg, (k + t) % 2 ? gold : stoneM, x, y, z, -a - PI / 2); } }
  for (const s of [-1, 1]) { const x = s * (ow / 2 + 0.05); K.add(CY(0.075, 0.075, spring - 0.4, 14), mihMarble, x, (spring - 0.4) / 2 + 0.2, mz + 1.06); K.add(CY(0.12, 0.1, 0.2, 14), gold, x, 0.1, mz + 1.06); K.add(LA([[0.075, 0], [0.13, 0.12], [0.14, 0.2], [0, 0.2]], 14), gold, x, spring - 0.2, mz + 1.06); }
  // hanging glass mosque lamp before the mihrab
  K.add(CY(0.004, 0.004, 2.6, 4), goldDk, 0, H - 1.3 - 0.4, mz + 1.6); K.add(LA([[0.06, 0], [0.16, 0.12], [0.12, 0.28], [0.18, 0.42], [0.04, 0.46]], 16), GLASS({ opacity: 0.35, color: 0xd8f0e0 }), 0, 3.95, mz + 1.6); K.add(SP(0.07, 10, 8), GLOW(0xffe2a8), 0, 4.1, mz + 1.6);
  // minbar (right of the mihrab): carved walnut, eight steps rising toward the qibla wall, lattice side panels, gate and canopy
  const walnutC = woodCv('#4a2a16', { w: 256, h: 256, planks: 3, seams: false }), walnut = pbrN(walnutC, [0.5, 0.5], { r: 0.38, k: 2.5, ns: 0.6 });
  const latC = cv(512, 512, (c, w, h) => { c.drawImage(walnutC, 0, 0, w, h); girih(c, w, h, 85, ['rgba(20,10,4,0.92)', '#5a3418', 'rgba(20,10,4,0.92)'], '#7a4a24', 5); }), lattice = pbrN(latC, [0.6, 0.6], { r: 0.42, k: 4, ns: 1 });
  K.at(3.15, 0, mz, -PI / 2, () => { const pw = 0.48, sideS = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(3.65, 0), new THREE.Vector2(3.65, 0.42), new THREE.Vector2(0.95, 2.7), new THREE.Vector2(0, 2.7)]); const sideG = EX(sideS, 0.06, 0.01);
    for (const s of [-1, 1]) { K.add(sideG, lattice, 0, 0, s * pw); K.add(BX(3.0, 0.06, 0.09), walnut, 2.3, 1.55, s * pw, 0, 0, -0.7); K.add(BX(3.66, 0.1, 0.1), walnut, 1.83, 0.05, s * pw); }
    K.add(BX(0.95, 2.25, 0.9), walnut, 0.475, 1.125, 0); for (let k = 0; k < 8; k++) { const hgt = 0.25 * (k + 1), u0 = 0.95 + (7 - k) * 0.33; K.add(BX(0.33, hgt, 0.9), walnut, u0 + 0.165, hgt / 2, 0); K.add(BX(0.34, 0.012, 0.7), STD(0x1f4a36, 0.95), u0 + 0.165, hgt + 0.006, 0); }
    for (const s of [-1, 1]) { K.add(BX(0.14, 2.9, 0.14), walnut, 3.6, 1.45, s * pw); K.add(SP(0.08, 10, 6), gold, 3.6, 2.98, s * pw); for (const u of [0.08, 0.86]) { K.add(BX(0.1, 1.9, 0.1), walnut, u, 3.2, s * 0.42); } }
    const gS = new THREE.Shape([new THREE.Vector2(-pw, 0), new THREE.Vector2(-pw, 0.55), ...archPts(pw * 2, 0.55, 8).map(p => new THREE.Vector2(p.x, p.y + 0.55)).slice(1, -1), new THREE.Vector2(pw, 0.55), new THREE.Vector2(pw, 0)]); K.add(EX(gS, 0.08, 0.01), lattice, 3.6, 2.1, 0, PI / 2);
    K.add(BX(1.1, 0.12, 1.06), walnut, 0.47, 4.2, 0); K.add(new THREE.SphereGeometry(0.5, 16, 8, 0, PI * 2, 0, PI / 2), gold, 0.47, 4.26, 0, 0, 0, 0, 1, 1.25, 1); K.add(SP(0.07, 8, 6), gold, 0.47, 4.95, 0); K.add(CY(0.015, 0.015, 0.3, 6), gold, 0.47, 5.1, 0); });
  // arcades: marble columns with bases and gilded capitals carrying pointed arches; spandrel walls with gold intrados
  const vous = STD(0xa8502e, 0.55), ax = W / 2 - 3.6, colZ = [-10, -6, -2, 2, 6], colM = pbr(marbleCv, [0.8, 0.8], { r: 0.18, bump: 0.1, ei: 0.9 }), cH = 4.2;
  for (const s of [-1, 1]) { for (const z of colZ) { K.add(BX(0.72, 0.28, 0.72), colM, s * ax, 0.14, z); K.add(CY(0.3, 0.34, 0.12, 20), colM, s * ax, 0.34, z); K.add(CY(0.26, 0.28, cH - 0.8, 20), colM, s * ax, 0.4 + (cH - 0.8) / 2, z);
      K.add(LA([[0.26, 0], [0.3, 0.06], [0.33, 0.2], [0.42, 0.34], [0, 0.34]], 20), gold, s * ax, cH - 0.4, z); K.add(BX(0.92, 0.12, 0.92), gold, s * ax, cH, z); }
    for (let i = 0; i < colZ.length - 1; i++) { const zc = (colZ[i] + colZ[i + 1]) / 2, bw = 4, iw = 3.3, ia = 1.75, top = 2.6;
      const sp = new THREE.Shape([new THREE.Vector2(-bw / 2, 0), new THREE.Vector2(-iw / 2, 0), ...archPts(iw, ia, 12).slice(1, -1), new THREE.Vector2(iw / 2, 0), new THREE.Vector2(bw / 2, 0), new THREE.Vector2(bw / 2, top), new THREE.Vector2(-bw / 2, top)]);
      K.at(s * ax, cH + 0.06, zc, -PI / 2, () => { K.add(EX(sp, 0.6, 0.0), plaster, 0, 0, 0); const inn = archPts(iw + 0.1, ia + 0.06, 9); for (let k = 0; k < inn.length - 1; k++) { const p0 = inn[k], p1 = inn[k + 1], dx = p1.x - p0.x, dy = p1.y - p0.y, L = Math.hypot(dx, dy); K.add(BX(L + 0.02, 0.16, 0.64), k % 2 ? STD(0xefe5cf, 0.5) : vous, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2, 0, 0, 0, Math.atan2(dy, dx)); } K.add(BX(bw, 0.14, 0.7), gold, 0, top + 0.07, 0); }); } }
  // lattice windows: tall pointed openings with mashrabiya screens glowing with daylight, sun shafts slanting in
  const mash = cv(256, 512, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#fffaf0'); gr.addColorStop(1, '#ffe7b8'); c.fillStyle = gr; c.fillRect(0, 0, w, h); girih(c, w, h, 64, ['rgba(0,0,0,0)', 'rgba(255,240,210,1)', 'rgba(0,0,0,0)'], '#5a3a1e', 6); c.strokeStyle = '#5a3a1e'; c.lineWidth = 10; c.strokeRect(0, 0, w, h); });
  const winM = new THREE.MeshBasicMaterial({ map: tx(mash, null), toneMapped: false, color: 0xfff0d8 }); winM.map.wrapS = winM.map.wrapT = THREE.ClampToEdgeWrapping;
  const ww = 1.4, wsill = 2.2, wsp = 4.4, wa = 0.95, wS = new THREE.Shape([new THREE.Vector2(-ww / 2, 0), ...archPts(ww, wa, 8).map(p => new THREE.Vector2(p.x, p.y + wsp - wsill)), new THREE.Vector2(ww / 2, 0)]), wG = new THREE.ShapeGeometry(wS, 8);
  { const p = wG.attributes.position, uv = wG.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / ww + 0.5, p.getY(i) / (wsp - wsill + wa)); }
  const wO = archPts(ww + 0.24, wa + 0.14, 8).map(p => new THREE.Vector2(p.x, p.y + wsp - wsill)), wI = archPts(ww, wa, 8).map(p => new THREE.Vector2(p.x, p.y + wsp - wsill)); const wF = new THREE.Shape([new THREE.Vector2(-ww / 2 - 0.12, -0.1), ...wO, new THREE.Vector2(ww / 2 + 0.12, -0.1), new THREE.Vector2(ww / 2, -0.1 + 0.1), ...[...wI].reverse(), new THREE.Vector2(-ww / 2, 0)]);
  const shaftM = new THREE.MeshBasicMaterial({ map: tx(cv(64, 256, (c, w, h) => { const d = c.createImageData(w, h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const u = (x / (w - 1) - 0.5) * 2, vv = y / (h - 1), a = Math.exp(-u * u * 3.5) * Math.pow(1 - vv, 1.6) * Math.min(1, vv * 12 + 0.2) * (0.85 + 0.15 * Math.sin(x * 0.7)), i = (y * w + x) * 4; d.data[i] = 255 * a; d.data[i + 1] = 232 * a; d.data[i + 2] = 190 * a; d.data[i + 3] = 255; } c.putImageData(d, 0, 0); }), null, false), transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
  const shK = new Kit(g); const ang = 0.75;
  for (const s of [-1, 1]) for (const z of [-8, -4, 0, 4]) { K.at(s * (W / 2 - 0.02), wsill, z, -s * PI / 2, () => { K.add(wG, winM, 0, 0, 0.005); K.add(EX(wF, 0.12, 0.01), gold, 0, 0, 0.04); K.add(BX(ww + 0.4, 0.08, 0.3), colM, 0, -0.06, 0.12); });
    const len = 7.5, sx = s * (W / 2 - 0.1) - s * Math.sin(ang) * len / 2, sy = wsill + 1.4 - Math.cos(ang) * len / 2; for (const yy of [0, PI / 2]) { const pg = new THREE.PlaneGeometry(1.5, len); pg.rotateY(yy); shK.add(pg, shaftM, sx, sy, z + 0.6, 0, 0, -s * ang); } }
  for (const s of [-1, 1]) { const rw = cv(256, 256, (c, w, h) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h); c.save(); c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 4, 0, PI * 2); c.clip(); c.fillStyle = '#fff3d6'; c.fillRect(0, 0, w, h); girih(c, w, h, 64, ['#3a7ab0', '#e8b84a', '#2f8a5a'], '#4a2a14', 5); c.restore(); c.strokeStyle = '#c8a050'; c.lineWidth = 8; c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 4, 0, PI * 2); c.stroke(); });
    K.add(new THREE.CircleGeometry(0.9, 32), new THREE.MeshBasicMaterial({ map: tx(rw, null), toneMapped: false, color: 0xd8d0c0 }), s * 6.6, 6.2, -D / 2 + 0.02); }
  // chandelier: three tiers of brass rings with candle bulbs and glass drops, hung from the dome
  const cy = 5.4, chain = H + 1.4 + dr - cy; K.add(CY(0.012, 0.012, chain, 4), goldDk, 0, cy + chain / 2, dz); const bulb = GLOW(0xffe6b0), cup = STD(0xd4b060, 0.25, 1), drop = STD(0xffffff, 0.02, 0.3, { transparent: true, opacity: 0.6, ei: 2 });
  K.add(LA([[0, -0.6], [0.12, -0.5], [0.3, -0.2], [0.34, 0.0], [0.22, 0.25], [0.08, 0.4], [0.04, 0.8], [0, 0.85]], 18), gold, 0, cy, dz);
  for (const [r, y, n] of [[2.6, cy - 0.3, 32], [1.9, cy + 0.15, 24], [1.2, cy + 0.6, 16]]) { K.add(new THREE.TorusGeometry(r, 0.035, 6, 64), gold, 0, y, dz, 0, PI / 2); K.add(new THREE.TorusGeometry(r - 0.08, 0.015, 4, 64), goldDk, 0, y - 0.06, dz, 0, PI / 2);
    for (let k = 0; k < 6; k++) { const a = k / 6 * PI * 2; K.add(CY(0.012, 0.012, r, 4), gold, Math.cos(a) * r / 2, y - 0.2 + 0.1, dz + Math.sin(a) * r / 2, -a, 0, PI / 2 + 0.12); K.add(CY(0.006, 0.006, 1.4, 3), goldDk, Math.cos(a) * r * 0.55, y + 0.65, dz + Math.sin(a) * r * 0.55, -a, 0, 0.5 * (r / 2.6)); }
    for (let k = 0; k < n; k++) { const a = k / n * PI * 2, x = Math.cos(a) * r, z = dz + Math.sin(a) * r; K.add(CY(0.04, 0.03, 0.05, 8), cup, x, y + 0.05, z); K.add(CY(0.012, 0.012, 0.09, 6), STD(0xf6f0e0, 0.6), x, y + 0.12, z); K.add(SP(0.03, 8, 6), bulb, x, y + 0.19, z, 0, 0, 0, 1, 1.6, 1); K.add(new THREE.OctahedronGeometry(0.03), drop, x * 0.98, y - 0.12, z === dz ? z : dz + Math.sin(a) * r * 0.98, 0, 0, 0, 1, 1.8, 1); } }
  // entrance: walnut shoe cubbies with shoes, a bench; wudu area behind a lattice screen with brass taps
  const shoeM = VC(0.6); K.at(-4.2, 0, D / 2 - 0.22, PI, () => { for (let r = 0; r < 5; r++) K.add(BX(4.0, 0.03, 0.4), walnut, 0, 0.05 + r * 0.32, 0); for (let i = 0; i <= 8; i++) K.add(BX(0.03, 1.3, 0.4), walnut, -2 + i * 0.5, 0.67, 0); K.add(BX(4.06, 1.36, 0.02), walnut, 0, 0.68, 0.2);
    for (let r = 0; r < 4; r++) for (let i = 0; i < 8; i++) if (rnd() < 0.55) { const col = [0x111111, 0x5a3a22, 0xf2f2ee, 0x2a3a5a, 0x7a2a2a][(rnd() * 5) | 0]; for (const o of [-0.07, 0.07]) K.add(RB(0.1, 0.08, 0.27, 0.035), shoeM, -1.75 + i * 0.5 + o, 0.105 + r * 0.32, 0, 0, 0, 0, 1, 1, 1, col); } });
  K.add(RB(2.4, 0.08, 0.45, 0.02), walnut, -7.4, 0.45, D / 2 - 0.6); for (const x of [-8.4, -6.4]) K.add(BX(0.08, 0.42, 0.4), walnut, x, 0.21, D / 2 - 0.6);
  const wuduTile = pbrN(zelC, [0.4, 0.4], { r: 0.15, k: 1.2, ei: 1 });
  K.at(W / 2 - 0.02, 0, 10.5, -PI / 2, () => { K.add(PL(4.4, 1.9), wuduTile, 0, 0.95, 0.012); K.add(BX(4.4, 0.12, 0.45), colM, 0, 0.72, 0.24); K.add(BX(4.4, 0.06, 0.12), STD(0x2a2a2a, 0.5), 0, 0.03, 0.9);
    for (let i = 0; i < 5; i++) { const x = -1.8 + i * 0.9; K.add(CY(0.02, 0.02, 0.12, 8), gold, x, 1.15, 0.07, 0, PI / 2); K.add(CY(0.016, 0.016, 0.14, 8), gold, x, 1.1, 0.13); K.add(CY(0.035, 0.035, 0.03, 10), gold, x, 1.23, 0.07); K.add(BX(0.36, 0.3, 0.32), colM, x, 0.15, 0.95); } });
  K.at(W / 2 - 2.2, 0, 8.0, 0, () => { K.add(PL(4.2, 2.2), lattice, 0, 1.25, 0); K.add(PL(4.2, 2.2), lattice, 0, 1.25, -0.01, PI); K.add(BX(4.3, 0.1, 0.1), walnut, 0, 2.4, 0); K.add(BX(4.3, 0.15, 0.1), walnut, 0, 0.075, 0); }); K.add(BX(0.1, 2.45, 0.1), walnut, W / 2 - 4.35, 1.22, 8.0);
  const wsign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), new THREE.MeshStandardMaterial({ roughness: 0.4, map: tx(cv(256, 64, (c, w, h) => { c.fillStyle = '#123a5a'; c.fillRect(0, 0, w, h); c.strokeStyle = '#c8a050'; c.lineWidth = 3; c.strokeRect(3, 3, w - 6, h - 6); c.fillStyle = '#f2e8d0'; c.font = '600 26px Georgia,serif'; c.textAlign = 'center'; c.fillText('WUDU · ABLUTIONS', w / 2, 42); }), null) })); wsign.position.set(W / 2 - 2.2, 2.65, 8.03); g.add(wsign);
  // a low bookcase and folding wooden stands by the qibla wall
  K.at(-6.2, 0, mz + 0.25, 0, () => { K.add(BX(2.4, 1.1, 0.36), walnut, 0, 0.55, 0); for (const y of [0.3, 0.7]) for (let x = -1.1; x < 1.1; x += 0.06) K.add(BX(0.05, rr(0.22, 0.3), 0.24), shoeM, x, y + 0.13, 0.04, 0, 0, 0, 1, 1, 1, [0x1f4a36, 0x6a1a1a, 0x123a5a, 0x3a2a1a][(rnd() * 4) | 0]); });
  for (const x of [-3, 3]) for (const zz of [-6.8]) { K.at(x * 1.6, 0, zz + 0.6, 0, () => { K.add(BX(0.36, 0.02, 0.3), walnut, 0, 0.2, 0, 0, 0.5); K.add(BX(0.36, 0.02, 0.3), walnut, 0, 0.2, 0, 0, -0.5); }); }
  K.done(); shK.done(4);
  // light: chandelier (warm), cool daylight from each side, a soft spot on the mihrab
  lamp(g, 0xffcf8a, 34, 0, cy - 0.4, dz, 24, 1.5); lamp(g, 0xcfe0ff, 9, -8.5, 4.4, 0, 14, 1.5); lamp(g, 0xcfe0ff, 9, 8.5, 4.4, 0, 14, 1.5);
  const ms = new THREE.SpotLight(0xffe2b8, 60, 16, 0.42, 0.6, 1.4); ms.position.set(0, 7.2, -6); ms.target.position.set(0, 2.4, mz + 0.8); g.add(ms, ms.target);
  for (let i = 0; i < 5; i++) npc(I, i + 2, -4 + i * 2, -7.3, 0, 'sit'); // worshippers sitting in the front row facing the qibla
  exitDoor(I, D / 2, '#3fd38a');
  // the call to prayer once on entering, then the quiet of the hall
  const au = new Audio('real/mosque/adhan.mp3'); au.volume = 0.65; au.play().catch(() => { }); I.stopFx = () => { au.pause(); au.src = ''; };
  I.step = dt => stepNpcs(I, dt); info.noWeapons = true; info.msg = 'Shoes off — please be respectful inside the mosque.'; info.envI = 0.4; return info; }

// Library, museum, shops, gym, barber: one realistic hall builder with per-kind fit-out
function hallRoom(I, v) { const g = I.g, k = v.kind; seed = 131 + k.length;
  const S = { library: [20, 16, 6], museum: [18, 14, 5.5], shop: [18, 14, 4.2], gym: [14, 12, 4], barber: [9, 7, 3.2] }[k], [W, D, H] = S, K = new Kit(g);
  const wood = pbr(woodCv('#6b4a2c', { w: 256, h: 256, planks: 3 }), [1, 1], { r: 0.5, bump: 0.4 }), dark = STD(0x222428, 0.5, 0.3), chrome = STD(0xcfd3d8, 0.2, 0.95);
  const floor = k === 'gym' ? pbr(fabricCv('#232323', { amt: 30 }), [1, 1], { r: 0.95, bump: 0.6 }) : k === 'barber' ? pbr(tileCv(['#111', '#eee'], { nx: 8, ny: 8, grout: '#777', gw: 1 }), [2, 2], { r: 0.3 }) : k === 'library' ? pbr(woodCv('#8a6a44', { planks: 6 }), [2, 2], { r: 0.45, bump: 0.3 }) : pbr(tileCv(['#d8d4cc', '#cfcac0', '#e0dcd4'], { nx: 3, ny: 3, grout: '#aaa59c', gw: 2 }), [1.6, 1.6], { r: 0.25 });
  const wall = pbr(plasterCv(k === 'museum' ? '#7a2630' : k === 'gym' ? '#3a3d42' : '#e9e4da'), [2, 2], { r: 0.9, bump: 0.2 });
  const info = room(I, W, D, H, floor, wall, pbr(plasterCv('#f2f0ea'), [2, 2], { r: 0.9 }), { K, skirt: k === 'museum' ? STD(0x1a1a1a, 0.4) : wood, cornice: k === 'museum' ? STD(0xc9a24a, 0.35, 0.8) : null, hemi: 0.55 });
  const books = VC(0.7), rowsOf = (x, z, ry, len) => K.at(x, 0, z, ry, () => { K.add(BX(len, 2.4, 0.4), wood, 0, 1.2, 0); for (let r = 0; r < 6; r++) { K.add(BX(len, 0.03, 0.42), wood, 0, 0.12 + r * 0.42, 0.01); for (let b = 0; b < len / 0.06; b++) { const h = 0.24 + rnd() * 0.1; K.add(BX(0.045, h, 0.26), books, -len / 2 + 0.04 + b * 0.06, 0.135 + r * 0.42 + h / 2, -0.04, 0, 0, 0, 1, 1, 1, [0x7a1d1d, 0x1d3a7a, 0x2a5a2a, 0xc9a24a, 0x3a2a1a, 0xe0d8c8][(b * 7 + r * 3) % 6]); } } });
  if (k === 'library') { for (const z of [-5.5, -2.5, 0.5]) { rowsOf(-5.5, z, 0, 6); rowsOf(5.5, z, 0, 6); } for (let i = 0; i < 4; i++) { const z = -5 + i * 2.5; K.add(RB(2.4, 0.05, 1.1, 0.02), wood, 0, 0.76, z, 0, -PI / 2); K.add(BX(0.08, 0.74, 0.8), wood, -1, 0.37, z); K.add(BX(0.08, 0.74, 0.8), wood, 1, 0.37, z); for (const x of [-0.6, 0.6]) { K.add(CY(0.12, 0.1, 0.03, 12), STD(0x1d5a2a, 0.3, 0.4), x, 1.15, z); K.add(CY(0.008, 0.008, 0.38, 4), chrome, x, 0.96, z); } }
    for (let i = 0; i < 10; i++) K.add(new THREE.TorusGeometry(1.2, 0.04, 6, 32), STD(0xc9a24a, 0.35, 0.85), 0, H - 0.3, -8 + i * 1.6, 0, PI / 2); /* the gold filigree rings of the Library of Birmingham */ }
  if (k === 'museum') { const art = atlas(4, 2, 256, 192, Array.from({ length: 8 }, (_, i) => (c, w, h) => { const gr = c.createLinearGradient(0, 0, w, h); gr.addColorStop(0, ['#3a5a7a', '#7a5a2a', '#2a4a2a', '#5a2a3a'][i % 4]); gr.addColorStop(1, '#1a140c'); c.fillStyle = gr; c.fillRect(0, 0, w, h); for (let j = 0; j < 40; j++) { c.fillStyle = `hsla(${(i * 47 + j * 13) % 360},45%,${30 + rnd() * 40}%,.5)`; c.beginPath(); c.ellipse(rnd() * w, rnd() * h, 6 + rnd() * 30, 4 + rnd() * 18, rnd() * 3, 0, 7); c.fill(); } }));
    let n = 0; for (const s2 of [-1, 1]) for (let i = 0; i < 4; i++) framePic(K, s2 * (W / 2 - 0.05), 2.1, -5 + i * 3.2, -s2 * PI / 2, 1.6, 1.2, STD(0xb8902a, 0.35, 0.8), aPL(1.6, 1.2, n++ % 8, 4, 2), art);
    for (const z of [-3, 2]) { K.add(BX(1, 1, 1), STD(0xf4f2ee, 0.6), 0, 0.5, z); K.add(LA([[0, 0], [0.25, 0], [0.3, 0.4], [0.18, 0.7], [0.22, 0.9], [0, 1.0]], 16), STD(0xd8d0c0, 0.35, 0.1), 0, 1, z); } K.add(BX(2.4, 0.45, 0.6), wood, 0, 0.22, -0.5); }
  if (k === 'shop') { const cloth = VC(0.85); for (let r = 0; r < 3; r++) for (const s2 of [-1, 1]) { const x = s2 * (2.5 + r * 2.2); K.add(CY(0.015, 0.015, 1.6, 6), chrome, x, 1.45, 0, 0, PI / 2); for (const zz of [-0.75, 0.75]) K.add(CY(0.012, 0.012, 1.45, 6), chrome, x, 0.72, zz); for (let i = 0; i < 12; i++) K.add(BX(0.42, 0.75, 0.06), cloth, x, 1.05, -0.65 + i * 0.12, PI / 2, 0, 0, 1, 1, 1, [0x1d2a3a, 0xe0d8c8, 0x7a1d2a, 0x2a2a2a, 0xc9a24a][(i + r) % 5]); }
    K.add(RB(3, 1, 0.8, 0.03), STD(0xf4f2ee, 0.3), 0, 0.5, -D / 2 + 2); K.add(BX(3.05, 0.04, 0.85), STD(0x222222, 0.2, 0.3), 0, 1.02, -D / 2 + 2); for (const s2 of [-1, 1]) K.add(BX(4, 2.6, 0.1), GLASS(), s2 * 5, 1.5, -D / 2 + 0.3); for (let x = -7; x <= 7; x += 2.3) K.add(BX(0.8, 0.02, 0.8), GLOW(0xffffff), x, H - 0.01, 0); }
  if (k === 'gym') { for (let i = 0; i < 4; i++) { const x = -5 + i * 1.6; K.add(RB(0.8, 0.25, 1.8, 0.04), dark, x, 0.25, -4); K.add(BX(0.7, 0.02, 1.4), STD(0x111111, 0.9), x, 0.38, -4); K.add(BX(0.06, 1.2, 0.06), dark, x - 0.33, 0.9, -4.8); K.add(BX(0.06, 1.2, 0.06), dark, x + 0.33, 0.9, -4.8); K.add(RB(0.7, 0.25, 0.1, 0.02), dark, x, 1.45, -4.8); }
    for (let i = 0; i < 3; i++) { const x = 1.5 + i * 2; for (const s2 of [-1, 1]) K.add(BX(0.08, 2, 0.08), STD(0xb02020, 0.4, 0.5), x + s2 * 0.6, 1, -1); K.add(CY(0.02, 0.02, 1.6, 8), chrome, x, 1.5, -1, 0, 0, PI / 2); for (const s2 of [-1, 1]) K.add(CY(0.22, 0.22, 0.06, 18), dark, x + s2 * 0.6, 1.5, -1, 0, 0, PI / 2); K.add(RB(0.35, 0.12, 1.2, 0.03), STD(0x111111, 0.6), x, 0.45, -0.3); }
    for (let i = 0; i < 10; i++) for (const s2 of [-1, 1]) K.add(CY(0.06, 0.06, 0.07, 10), dark, -6 + i * 0.25 + s2 * 0.12, 0.5, 4, 0, 0, PI / 2); K.add(BX(3, 0.04, 0.4), chrome, -4.9, 0.45, 4); K.add(PL(W - 1, 1.8), STD(0xeeeeff, 0.02, 0.9), 0, 1.5, D / 2 - 0.02, PI); /* mirror wall */ }
  if (k === 'barber') { for (let i = 0; i < 3; i++) { const x = -2.5 + i * 2.5; K.add(PL(1.4, 1.1), STD(0xeeeeff, 0.02, 0.95), x, 1.7, -D / 2 + 0.02); K.add(CY(0.25, 0.3, 0.1, 16), chrome, x, 0.05, -2.3); K.add(CY(0.05, 0.05, 0.45, 8), chrome, x, 0.3, -2.3); K.add(RB(0.6, 0.12, 0.6, 0.05), STD(0x7a1d1d, 0.45), x, 0.6, -2.3); K.add(RB(0.6, 0.7, 0.12, 0.05), STD(0x7a1d1d, 0.45), x, 1.0, -2.0); K.add(BX(1.6, 0.06, 0.3), wood, x, 0.9, -D / 2 + 0.17); }
    for (let i = 0; i < 4; i++) chair(K, -3 + i * 0.7, 2.7, PI, wood, STD(0x111111, 0.5)); K.add(CY(0.08, 0.08, 0.8, 16), STD(0xffffff, 0.3), W / 2 - 0.3, 1.8, D / 2 - 1); }
  K.done(); for (let i = 0; i < (k === 'barber' ? 3 : 4); i++) npc(I, i + 1, k === 'barber' ? -2.5 + i * 2.5 : -4 + i * 2.6, k === 'barber' ? -2.75 : -1 + (i % 2) * 2, k === 'barber' ? 0 : i, k === 'barber' ? 'idle' : 'walk');
  const L = k === 'museum' ? 0xfff0d8 : k === 'gym' ? 0xe8f0ff : 0xfff4e0; lamp(g, L, 14, -W / 4, H - 0.5, 0, W); lamp(g, L, 14, W / 4, H - 0.5, 0, W); lamp(g, L, 8, 0, H - 0.5, -D / 3, W);
  if (k === 'barber' || k === 'shop') I.spots.push({ act: 'shop', shop: 'food', x: 0, z: -D / 2 + 3, r: 1.8, label: k === 'barber' ? 'TRIM' : 'BUY' });
  exitDoor(I, D / 2, v.col); I.step = dt => stepNpcs(I, dt); info.envI = 0.4; info.msg = v.name; return info; }
