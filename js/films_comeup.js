// p55 headline film: "BRUM: THE COME UP" - a gritty, stylised crime story in four acts, played out in the live
// world with the game's own people and cars (Shak, Saggy, Junior, the CUZZY R6). Original story, captions and
// score. Stylised gunplay (muzzle flashes, rivals running off), no gore.
import * as THREE from 'three';
import { buildPerson, animPerson } from './person.js';
import { SAGGY, JUNIOR, dress } from './places.js';
const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t), lerp = (a, b, t) => a + (b - a) * t;
function at(P, a) { a = Math.max(0, Math.min(P[P.length - 1][3], a)); let i = 1; while (i < P.length - 1 && P[i][3] < a) i++; const A = P[i - 1], B = P[i], L = (B[3] - A[3]) || 1, t = Math.max(0, Math.min(1, (a - A[3]) / L)); const dx = B[0] - A[0], dz = B[1] - A[1], l = Math.hypot(dx, dz) || 1; return { x: A[0] + dx * t, z: A[1] + dz * t, h: A[2] + (B[2] - A[2]) * t, tx: dx / l, tz: dz / l }; }
const add = () => new THREE.SpriteMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
function lightbar(car, H) { const bar = new THREE.Group(); bar.position.y = H + 0.05; car.add(bar); const mk = c => { const m = add(); m.color.setHex(c); const sp = new THREE.Sprite(m); sp.scale.setScalar(1.1); bar.add(sp); return sp; }; const r = mk(0xff2030), b = mk(0x2060ff); r.position.x = -0.35; b.position.x = 0.35; bar.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.3), new THREE.MeshStandardMaterial({ color: 0x111111 }))); return [r, b]; }
function tint(o, hex) { o.traverse(m => { if (!m.isMesh || !m.material) return; const one = M => { if (M && /paint|body|car/i.test(M.name || '') && M.color) { const c = M.clone(); c.color.setHex(hex); return c; } return M; }; m.material = Array.isArray(m.material) ? m.material.map(one) : one(m.material); }); }
export const COMEUP = ['comeup', 'BRUM: THE COME UP', 'From a Costcutter counter on Ryland Street to the top of the city · 3:10 · rated 15', 190];
export function setup(C, O) { const s = C.s, W = s.w, f = C.f, A = O.actors, g = O.grp, H = (x, z, y = 0) => W.groundAt?.(x, z, y)?.h ?? y;
  const per = (look, who) => { const p = buildPerson(look); if (who) dress(p, who); g.add(p); return p; };
  A.saggy = per(SAGGY, 'saggy'); A.junior = per(JUNIOR, 'junior');
  A.crew = [{ skin: 0xc68e6a, hair: 0x14100c, top: 0x1a1a1a, legs: 0x1a1a1a, shoe: 0xffffff, jacket: 0x3a3a3a }, { skin: 0xe6b89c, hair: 0x3a2a1a, top: 0x22252a, legs: 0x2a4a7a, shoe: 0x1a1a1a, jacket: 0x0e0e10 }, { skin: 0x6a4430, hair: 0x0d0b09, top: 0x7a1a1a, legs: 0x1a1a1a, shoe: 0xf3f3ef, jacket: null }].map(l => per(l));
  A.rivals = [0x0e0e10, 0x2a2a30, 0x1a1a22].map((c, i) => per({ skin: [0xdcae94, 0xb88a64, 0x5c3a26][i], hair: 0x14100c, top: c, legs: 0x101012, shoe: 0x101010, jacket: 0x101010 }));
  const src = s.obj, Hc = src.userData.dims?.H || 1.3; A.crewCars = [0x101014, 0xd8d8dc].map(c => { const k = src.clone(true); tint(k, c); g.add(k); return k; });
  A.cops = [0, 1].map(() => { const k = src.clone(true); tint(k, 0xf2f2f2); g.add(k); const L = lightbar(k, Hc); return { k, L }; });
  // helicopter: dark body, rotor, nav blink and a searchlight cone
  const hel = new THREE.Group(), dm = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.5 }); hel.add(new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 3, 4, 8).rotateX(Math.PI / 2), dm)); const tail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 4.5), dm); tail.position.z = 3.6; hel.add(tail);
  const rot = new THREE.Mesh(new THREE.BoxGeometry(10, 0.05, 0.3), dm); rot.position.y = 1.3; hel.add(rot); A.rotor = rot; const nb = new THREE.Sprite(add()); nb.material.color.setHex(0xff2020); nb.scale.setScalar(1.5); nb.position.set(0, -1.1, 0); hel.add(nb); A.nav = nb;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(7, 60, 24, 1, true).translate(0, -30, 0), new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false })); hel.add(cone); A.cone = cone;
  const spot = new THREE.SpotLight(0xe8f0ff, 400, 120, 0.22, 0.5, 1.2); hel.add(spot); spot.target = new THREE.Object3D(); g.add(spot.target); A.spot = spot; g.add(hel); A.heli = hel;
  // stylised muzzle flashes
  A.flash = [0, 1, 2, 3].map(() => { const m = add(); m.color.setHex(0xffc060); const sp = new THREE.Sprite(m); sp.scale.setScalar(0.7); sp.visible = false; g.add(sp); return sp; });
  const fl = new THREE.PointLight(0xffb050, 0, 14); g.add(fl); A.flashL = fl;
  // locations
  const L = O.L = {}; const rs = f.rylandSt?.door || C.venue('costcutter'); L.rs = { x: rs.x, z: rs.z, yaw: rs.yaw, y: rs.y ?? H(rs.x, rs.z) };
  for (const k of ['cueclub', 'potblack']) { const v = C.venue(k); L[k] = { x: v.x, z: v.z, yaw: v.yaw, y: v.y ?? H(v.x, v.z) }; }
  L.tw = f.zone?.c || { x: L.rs.x, z: L.rs.z }; L.tw.y = H(L.tw.x, L.tw.z);
  let best = null, bl = 0; for (const E of W.edges || []) if (/Broad Street/.test(E.r?.n || '') && !E.P.some(p => p[2] < -0.5)) { const l = E.P[E.P.length - 1][3]; if (l > bl) { bl = l; best = E.P; } } L.broad = best || C.street(0, 0, 300);
  L.sf = C.lm('selfridges') || { x: 0, z: 0 }; L.ro = C.lm('rotunda') || L.sf; L.sm = C.lm('stmartin') || L.sf;
  L.chase = C.street(L.ro.x, L.ro.z, 400) || L.broad;
  { const r = W.nearestRoad?.((L.ro.x + L.sf.x) / 2, (L.ro.z + L.sf.z) / 2); L.show = r ? { x: r.px + r.nx * (r.hw + 3), z: r.pz + r.nz * (r.hw + 3), dx: r.dx, dz: r.dz } : { x: L.ro.x + 30, z: L.ro.z, dx: 1, dz: 0 }; L.show.y = H(L.show.x, L.show.z); }
  // penthouse balcony: glass-railed terrace 62 m up, a block away from the Rotunda, looking over the centre
  { const d = { x: L.ro.x - L.sf.x, z: L.ro.z - L.sf.z }, n = Math.hypot(d.x, d.z) || 1; const px = L.ro.x + d.x / n * 90, pz = L.ro.z + d.z / n * 90, y = H(px, pz) + 62, b = new THREE.Group(); b.position.set(px, y, pz); b.rotation.y = Math.atan2(-d.x, -d.z);
    const fl2 = new THREE.Mesh(new THREE.BoxGeometry(9, 0.3, 5), new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.3, metalness: 0.4 })); fl2.position.y = -0.15; b.add(fl2); const gl = new THREE.Mesh(new THREE.BoxGeometry(9, 1.1, 0.05), new THREE.MeshStandardMaterial({ color: 0x9ab8c8, transparent: true, opacity: 0.25, roughness: 0.05 })); gl.position.set(0, 0.55, -2.5); b.add(gl);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(9, 0.06, 0.08), new THREE.MeshStandardMaterial({ color: 0xc8c8c8, metalness: 0.9, roughness: 0.2 })); rail.position.set(0, 1.12, -2.5); b.add(rail); const wall = new THREE.Mesh(new THREE.BoxGeometry(9, 3.4, 0.3), new THREE.MeshStandardMaterial({ color: 0x1a1a1e })); wall.position.set(0, 1.7, 2.5); b.add(wall);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.4), new THREE.MeshBasicMaterial({ color: 0xffc888 })); win.position.set(0, 1.5, 2.34); win.rotation.y = Math.PI; b.add(win); const tower = new THREE.Mesh(new THREE.BoxGeometry(12, 62, 10), new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.4, metalness: 0.5 })); tower.position.set(0, -31.3, 6.5); b.add(tower);
    g.add(b); L.pent = { x: px, y, z: pz, fx: d.x / n * -1, fz: d.z / n * -1, b }; }
  O.flashes = [];
  for (const k of ['shak', 'car']) A[k].visible = false; }
// ------------------------------------------------------------------- shot list
const VO = t => 'vo:' + t;
function poseCar(o, P, d, side, H) { const p = at(P, d), x = p.x - p.tz * side, z = p.z + p.tx * side; o.position.set(x, H(x, z, p.h), z); o.rotation.set(0, Math.atan2(-p.tx, -p.tz), 0); o.visible = true; return { x, z, y: o.position.y, tx: p.tx, tz: p.tz }; }
function place(p, x, z, yaw, H) { p.position.set(x, H(x, z), z); p.rotation.y = yaw; p.visible = true; }
const face = (a, b) => Math.atan2(b.position.x - a.position.x, b.position.z - a.position.z);
// [duration, env [weather, tod], fn(C, O, lt, k)]
const SHOTS = [
  [7, ['clear', 0.8], (C, O, lt, k) => { const r = O.L.rs; C.look(O, r.x + Math.sin(r.yaw) * 40, r.y + 45 - k * 35, r.z + Math.cos(r.yaw) * 40, r.x, r.y + 3, r.z, 50); O.txt = lt > 1 ? 'title:BRUM: THE COME UP|a CUZZY PICTURES film' : ''; }],
  [11, ['clear', 0.8], (C, O, lt, k, H) => { const r = O.L.rs, sx = r.x + Math.sin(r.yaw) * (9 - k * 7), sz = r.z + Math.cos(r.yaw) * (9 - k * 7); place(O.actors.shak, sx, sz, r.yaw + Math.PI, H); O.walk = 1.2; const sd = { x: Math.cos(r.yaw), z: -Math.sin(r.yaw) };
    C.look(O, sx + Math.sin(r.yaw) * (5 - k) + sd.x * 2, r.y + 1.4, sz + Math.cos(r.yaw) * (5 - k) + sd.z * 2, r.x, r.y + 2.4, r.z, 42); O.txt = lt < 1 ? 'card:I.  RYLAND STREET' : VO('Every empire starts somewhere, bab. Mine started behind a Costcutter counter on Ryland Street.'); }],
  [11, ['clear', 0.82], (C, O, lt, k, H) => { const r = O.L.rs, A = O.actors, fx = Math.sin(r.yaw), fz = Math.cos(r.yaw), sx = Math.cos(r.yaw), sz = -Math.sin(r.yaw); O.walk = 0;
    place(A.saggy, r.x + fx * 1.6 - sx * 1.2, r.z + fz * 1.6 - sz * 1.2, r.yaw, H); place(A.junior, r.x + fx * 1.6 + sx * 1.3, r.z + fz * 1.6 + sz * 1.3, r.yaw, H); place(A.shak, r.x + fx * 2.6, r.z + fz * 2.6, r.yaw + Math.PI, H);
    C.look(O, r.x + fx * 7.5 + sx * (1.5 - k * 3), r.y + 0.5, r.z + fz * 7.5 + sz * (1.5 - k * 3), r.x + fx * 2, r.y + 1.6, r.z + fz * 2, 38); O.txt = lt < 6 ? VO('Saggy ran the tills. Junior ran the door. I ran me mouth.') : 'sub:JUNIOR: Boss, yow\'ve got that look again.'; }],
  [9, ['clear', 0.84], (C, O, lt, k) => { const S = O.actors.shak, r = O.L.rs, fx = Math.sin(r.yaw), fz = Math.cos(r.yaw); C.look(O, S.position.x + fx * (2.4 - k * 0.6) + 0.4, S.position.y + 1.65, S.position.z + fz * (2.4 - k * 0.6), S.position.x, S.position.y + 1.6, S.position.z, 30); O.txt = lt < 4.5 ? 'sub:SHAK: I day want much, our kid.' : 'sub:SHAK: Just everythin\'.'; }],
  [12, ['clear', 0.92], (C, O, lt, k, H) => { const v = O.L.cueclub, A = O.actors, fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), sx = Math.cos(v.yaw), sz = -Math.sin(v.yaw), d = 10 - k * 7;
    place(A.shak, v.x + fx * d, v.z + fz * d, v.yaw + Math.PI, H); place(A.saggy, v.x + fx * (d + 1.2) - sx * 1.1, v.z + fz * (d + 1.2) - sz * 1.1, v.yaw + Math.PI, H); place(A.junior, v.x + fx * (d + 1.2) + sx * 1.2, v.z + fz * (d + 1.2) + sz * 1.2, v.yaw + Math.PI, H); O.walk = 1.2; O.walkers = [A.saggy, A.junior];
    C.look(O, v.x + fx * 3.5 + sx * 2.5, v.y + 0.4, v.z + fz * 3.5 + sz * 2.5, A.shak.position.x, v.y + 1.8, A.shak.position.z, 44); O.txt = lt < 1 ? 'card:II.  THE RISE' : VO('Tuesdays at the cue club. Deals done between the reds an\' the blacks.'); }],
  [11, ['clear', 0.94], (C, O, lt, k, H) => { const v = O.L.potblack, A = O.actors, fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), sx = Math.cos(v.yaw), sz = -Math.sin(v.yaw); O.walk = 0; O.walkers = null;
    place(A.shak, v.x + fx * 3 - sx * 0.8, v.z + fz * 3 - sz * 0.8, 0, H); place(A.rivals[0], v.x + fx * 3 + sx * 0.8, v.z + fz * 3 + sz * 0.8, 0, H); A.shak.rotation.y = face(A.shak, A.rivals[0]); A.rivals[0].rotation.y = face(A.rivals[0], A.shak);
    const ar = A.shak.userData.person.aR, ar2 = A.rivals[0].userData.person.aR, sh = lt > 5 && lt < 8 ? -1.1 : 0; if (ar) ar.rotation.x = sh; if (ar2) ar2.rotation.x = sh;
    C.look(O, v.x + fx * 6 + sx * (2 - k * 4), v.y + 1.3, v.z + fz * 6 + sz * (2 - k * 4), v.x + fx * 3, v.y + 1.4, v.z + fz * 3, 34); O.txt = lt < 5 ? VO('Pot Black. Man from Digbeth wanted in. I said fine. Ten per cent, an\' a sandwich.') : 'sub:SHAK: Pleasure doin\' business, bab.'; }],
  [11, ['cloudy', 0.96], (C, O, lt, k, H) => { const A = O.actors; for (const p of [A.rivals[0]]) { const ar = p.userData.person.aR; if (ar) ar.rotation.x = 0; p.visible = false; } const ar = A.shak.userData.person.aR; if (ar) ar.rotation.x = 0;
    const c = O.L.tw; place(A.shak, c.x + 4, c.z + 4, -2.3, H); const a = lt * 0.12; C.look(O, c.x + Math.cos(a) * 26, c.y + 3 + k * 2, c.z + Math.sin(a) * 26, c.x, c.y + 1.2, c.z, 44); O.txt = VO('Talbot Way. Small Heath. The lads round there had me back from day one.'); }],
  [12, ['cloudy', 0.97], (C, O, lt, k, H) => { const A = O.actors, c = O.L.tw, car = A.car; place(car, c.x - 8, c.z - 6, 0.6, H); car.position.y += 0; const a = 2.4 + lt * 0.2, R = 6.2 - k; place(A.shak, c.x - 8 + 2, c.z - 6 + 1.5, -1, H);
    C.look(O, car.position.x + Math.cos(a) * R, car.position.y + 0.5, car.position.z + Math.sin(a) * R, car.position.x, car.position.y + 0.7, car.position.z, 38); O.txt = lt < 6 ? VO('Then come the motor. The CUZZY R6. Six hundred horses, all paid in cash.') : 'sub:SHAK: Get in, lads. We\'m goin\' up town.'; }],
  [16, ['rain', 0.99], (C, O, lt, k, H) => { const A = O.actors, P = O.L.broad, L = P[P.length - 1][3], d0 = Math.min(40, L * 0.1), d = d0 + lt * 13; A.shak.visible = false; const p = poseCar(A.car, P, d, 1.8, H); A.crewCars.forEach((c, i) => poseCar(c, P, d - 11 - i * 10, i ? 1.8 : -1.8, H));
    if (lt < 8) C.look(O, p.x - p.tz * 4.5 + p.tx * 4, p.y + 0.55, p.z + p.tx * 4.5 + p.tz * 4, p.x, p.y + 0.8, p.z, 40); else C.look(O, p.x + p.tx * 15, p.y + 1, p.z + p.tz * 15, p.x - p.tx * 6, p.y + 0.8, p.z - p.tz * 6, 34);
    O.txt = lt < 1 ? 'card:BROAD STREET · 2:14 AM' : VO('Broad Street in the rain. Neon on the wet. Felt like the whole city was watchin\'.'); }],
  [12, ['rain', 0.0], (C, O, lt, k, H) => { const A = O.actors, P = O.L.chase, d = 20 + lt * 22; for (const c of A.crewCars) c.visible = false; const p = poseCar(A.car, P, d, 1.8, H); A.cops.forEach((c, i) => poseCar(c.k, P, d - 14 - i * 9, i ? -1.6 : 1.6, H)); O.stars = lt > 2 ? 3 : 2; O.sirens = true;
    C.look(O, p.x - p.tx * 30 + 2, p.y + 1.2, p.z - p.tz * 30, p.x, p.y + 0.8, p.z, 36); O.txt = lt < 1 ? 'card:III.  THE HEAT' : VO('Course, somebody always is.'); }],
  [12, ['storm', 0.01], (C, O, lt, k, H) => { const A = O.actors, P = O.L.chase, d = 20 + (12 + lt) * 22, p = poseCar(A.car, P, d, 1.8, H); A.cops.forEach((c, i) => poseCar(c.k, P, d - 12 - i * 8, i ? -1.6 : 1.6, H)); O.stars = 4; O.heli = true;
    A.heli.position.set(p.x - p.tx * 10, p.y + 42, p.z - p.tz * 10); A.heli.rotation.y = Math.atan2(-p.tx, -p.tz); A.cone.lookAt?.(p.x, p.y, p.z); A.spot.target.position.set(p.x, p.y, p.z); const dx = p.x - A.heli.position.x, dz = p.z - A.heli.position.z, dy = p.y - A.heli.position.y; A.cone.rotation.set(0, 0, 0); A.cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(dx, dy, dz).normalize()).premultiply(A.heli.quaternion.clone().invert());
    C.look(O, p.x - p.tx * 40 + p.tz * 25, p.y + 55, p.z - p.tz * 40 - p.tx * 25, p.x, p.y, p.z, 40); O.txt = VO('Helicopter, dogs, the lot. Four stars by Five Ways.'); }],
  [11, ['storm', 0.02], (C, O, lt, k, H) => { const A = O.actors, P = O.L.chase, d = 20 + (24 + lt) * 22, p = poseCar(A.car, P, d, 1.8, H); A.cops.forEach((c, i) => poseCar(c.k, P, d - 10 - i * 8, i ? -1.6 : 1.6, H)); O.stars = 5; O.heli = true; A.heli.position.set(p.x - p.tx * 14, p.y + 38, p.z - p.tz * 14); A.spot.target.position.set(p.x, p.y, p.z);
    const cp = at(P, 20 + 30 * 22 + 6); C.look(O, cp.x - cp.tz * 3.5, H(cp.x, cp.z, cp.h) + 0.4, cp.z + cp.tx * 3.5, p.x, p.y + 0.7, p.z, 34); O.txt = VO('Five stars. Proper famous now, ay it.'); }],
  [8, ['rain', 0.03], (C, O, lt, k, H) => { const A = O.actors, P = O.L.chase, d = 20 + (35 + lt) * 22, p = poseCar(A.car, P, d, 1.8, H); A.cops.forEach((c, i) => poseCar(c.k, P, d - 10 - i * 8 - k * k * 160, i ? -1.6 : 1.6, H)); O.heli = false; A.heli.visible = false; O.stars = Math.max(0, 5 - Math.floor(lt / 1.4));
    C.look(O, p.x + p.tx * 12 + 3, p.y + 2.5, p.z + p.tz * 12, p.x, p.y + 0.6, p.z, 40); O.txt = lt > 3 ? VO('Lost \'em in the tunnels under Queensway. Every copper in Brum knows me name now.') : ''; }],
  [16, ['clear', 0.05], (C, O, lt, k, H) => { const A = O.actors, S = O.L.show, sx = -S.dz, sz = S.dx; O.stars = 0; O.sirens = false; for (const c of A.cops) c.k.visible = false; A.car.visible = false;
    place(A.shak, S.x, S.z, 0, H); place(A.saggy, S.x - S.dx * 1.4 - sx * 0.8, S.z - S.dz * 1.4 - sz * 0.8, 0, H); place(A.junior, S.x + S.dx * 1.4 - sx * 0.8, S.z + S.dz * 1.4 - sz * 0.8, 0, H);
    A.rivals.forEach((r, i) => { r.visible = true; const run = lt > 11 ? (lt - 11) * 4 : 0; place(r, S.x + sx * (9 + run) + S.dx * (i - 1) * 1.6, S.z + sz * (9 + run) + S.dz * (i - 1) * 1.6, 0, H); r.rotation.y = run ? Math.atan2(sx, sz) : Math.atan2(-sx, -sz); if (run) animPerson(r, 1 / 24, 4.5, 'walk'); });
    for (const p of [A.shak, A.saggy, A.junior]) p.rotation.y = Math.atan2(sx, sz); const aim = lt > 6 && lt < 12 ? -1.45 : 0; for (const p of [A.shak, A.junior, A.rivals[1]]) { const ar = p.userData.person.aR; if (ar) ar.rotation.x = aim; }
    O.flashes = lt > 8 && lt < 11 ? [[A.shak, Math.atan2(sx, sz)], [A.junior, Math.atan2(sx, sz)], [A.rivals[1], Math.atan2(-sx, -sz)]] : [];
    const a = lt < 6 ? 0 : (lt - 6) * 0.08; C.look(O, S.x - sx * 6 + S.dx * (5 - a * 10), S.y + 1.2, S.z - sz * 6 + S.dz * (5 - a * 10), S.x + sx * 6, S.y + 1.6, S.z + sz * 6, lt < 6 ? 44 : 36);
    O.txt = lt < 1 ? 'card:IV.  THE CITY' : lt < 6 ? VO('By the Rotunda, gone three. They come for what\'s mine.') : lt < 8.5 ? 'sub:SHAK: Yow sure about this, bab?' : lt > 11.5 ? VO('They legged it. Nobody got hurt. Nobody got what they come for, neither.') : ''; }],
  [9, ['clear', 0.07], (C, O, lt, k, H) => { const A = O.actors; O.flashes = []; for (const p of [A.shak, A.junior, A.rivals[1]]) { const ar = p.userData.person.aR; if (ar) ar.rotation.x = 0; } for (const r of A.rivals) r.visible = false; const S = O.L.show, sf = O.L.sf, ro = O.L.ro, sm = O.L.sm, c = { x: (sf.x + ro.x + sm.x) / 3, z: (sf.z + ro.z + sm.z) / 3 };
    C.look(O, S.x + (S.x - c.x) * 0.4, S.y + 6 + k * 20, S.z + (S.z - c.z) * 0.4, c.x, S.y + 12, c.z, 52); O.txt = VO('Selfridges, the Rotunda, St Martin\'s. Bostin\'. All of it.'); }],
  [22, ['clear', 0.1], (C, O, lt, k, H) => { const A = O.actors, P = O.L.pent; for (const p of [A.saggy, A.junior]) p.visible = false; const S = A.shak, sx = P.fz, sz = -P.fx; S.position.set(P.x + P.fx * 1.8, P.y, P.z + P.fz * 1.8); S.rotation.y = Math.atan2(P.fx, P.fz); S.visible = true;
    const back = 2 + ease(k) * 16; C.look(O, P.x - P.fx * back + sx * 1.2, P.y + 1.6 + ease(k) * 6, P.z - P.fz * back + sz * 1.2, P.x + P.fx * 60, P.y - 20, P.z + P.fz * 60, 44);
    O.txt = lt < 8 ? VO('From Ryland Street to up \'ere. Look at it, bab. Every light down there.') : lt < 14 ? VO('This city don\'t belong to nobody. Tonight it answers to me.') : 'title:BRUM: THE COME UP|starring SHAK · SAGGY · JUNIOR'; }]];
export const TOTAL = SHOTS.reduce((a, s) => a + s[0], 0);
export function step(C, O, t, dt) { const s = C.s, W = s.w, H = (x, z, y = 0) => W.groundAt?.(x, z, y)?.h ?? y; let i = 0, t0 = 0; while (i < SHOTS.length - 1 && t >= t0 + SHOTS[i][0]) { t0 += SHOTS[i][0]; i++; } const [d, env, fn] = SHOTS[i], lt = t - t0;
  if (O.shot !== i) { O.shot = i; O.walk = 0; O.walkers = null; O.heli = false; const E = s.envCycle; if (E) { E.weatherLock = E.timeLock = true; E.setWeather(env[0], true); } if (O.L.tw && f(C).zone) { f(C).zone.hold = i >= 6 && i <= 7; } }
  const E = s.envCycle; if (E) E.setTime(env[1]); fn(C, O, lt, lt / d, H); const A = O.actors;
  for (const p of O.walkers || []) animPerson(p, dt, O.walk, 'walk'); for (const p of [A.saggy, A.junior, ...A.crew, ...A.rivals]) if (p.visible && !(O.walkers || []).includes(p)) animPerson(p, dt, 0);
  A.heli.visible = !!O.heli; A.rotor.rotation.y += dt * 30; A.nav.visible = (t * 2 % 1) < 0.5; A.spot.intensity = O.heli ? 400 : 0;
  const ph = (t * 6) % 2 < 1; for (const c of A.cops) { c.L[0].material.opacity = ph ? 1 : 0.1; c.L[1].material.opacity = ph ? 0.1 : 1; }
  A.flash.forEach((F, j) => { const q = O.flashes[j]; F.visible = !!q && Math.sin(t * 60 + j * 2) > 0.2; if (q) { const [p, a] = q; F.position.set(p.position.x + Math.sin(a) * 0.75 + Math.cos(a) * -0.2, p.position.y + 1.35, p.position.z + Math.cos(a) * 0.75 - Math.sin(a) * -0.2); } });
  A.flashL.intensity = A.flash.some(F => F.visible) ? 60 : 0; if (O.flashes[0]) A.flashL.position.copy(A.flash[0].position); }
const f = C => C.f;
export function stop(C, O) { const s = C.s, E = s.envCycle; if (E) { E.weatherLock = E.timeLock = false; } if (s.wfx) s.wfx.key = null; if (C.f.zone) C.f.zone.hold = false; }
