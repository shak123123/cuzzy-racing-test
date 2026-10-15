// p55 CUZZY PICTURES: short films made from the game itself, shown in the cinema. Each film is a scripted sequence in
// the live city: Shak (the real character model), clones of your car (and a police car with a light bar), Birmingham
// landmarks, camera paths (orbits, dollies, tracking, low and aerial shots), letterbox, title cards, a wanted-stars
// chase, subtitles and a little synth score. Rendered to a texture on the cinema screen, or full screen (the game
// camera follows the film camera). Works on phone and PC (render target is smaller on phones).
import * as THREE from 'three';
import * as CU from './films_comeup.js';
import { buildPerson, animPerson } from './person.js';
const MOB = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const walkK = k => /footway|path|cycleway|pedestrian|steps|bridleway|track|service/.test(k);
const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t), lerp = (a, b, t) => a + (b - a) * t;
function at(P, a) { a = Math.max(0, Math.min(P[P.length - 1][3], a)); let i = 1; while (i < P.length - 1 && P[i][3] < a) i++; const A = P[i - 1], B = P[i], L = (B[3] - A[3]) || 1, t = Math.max(0, Math.min(1, (a - A[3]) / L)); const dx = B[0] - A[0], dz = B[1] - A[1], l = Math.hypot(dx, dz) || 1; return { x: A[0] + dx * t, z: A[1] + dz * t, h: A[2] + (B[2] - A[2]) * t, tx: dx / l, tz: dz / l }; }
export const FILMS_IG = [
  CU.COMEUP,
  ['night', 'Brum After Dark', 'Shak takes his car for a spin past the Library of Birmingham · 0:30', 30],
  ['chase', 'Hot Pursuit', 'Three stars, one car, Broad Street to the edge of town · 0:32', 32],
  ['bullring', 'The Bullring Run', 'A meet at the Bullring goes to plan. Mostly. · 0:26', 26]];
export class Cinema {
  constructor(foot) { this.f = foot; this.s = foot.s; this.on = null; }
  list() { return FILMS_IG.map(([k, n, sub]) => [k, n, sub]); }
  title(k) { return FILMS_IG.find(f => f[0] === k)?.[1] || k; }
  // pick a long drivable street near a world point (cars drive along it)
  street(x, z, minL = 140) { let best = null, bs = -1e9; for (const E of this.s.w.edges || []) { const { r, P, hid } = E; if (hid || r.tun || walkK(r.k) || P.some(p => p[2] < -0.5)) continue; const L = P[P.length - 1][3]; if (L < minL) continue; const d = Math.hypot(P[0][0] - x, P[0][1] - z); const sc = Math.min(L, 400) - d * 0.8; if (sc > bs) { bs = sc; best = P; } } return best; }
  venue(id) { return this.f.venues.list.find(v => v.id === id) || this.f.venues.list[0] || { x: 0, z: 0, y: 0, yaw: 0, name: 'Birmingham' }; }
  start(I, k, full) { this.stop(); const s = this.s, F = FILMS_IG.find(f => f[0] === k); if (!F) return;
    const w = MOB ? 640 : 1024, h = Math.round(w * 9 / 16); const rt = new THREE.WebGLRenderTarget(w, h, { samples: MOB ? 0 : 2 }); rt.texture.colorSpace = THREE.SRGBColorSpace;
    const cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.3, 2500), grp = new THREE.Group(); grp.name = 'film-set'; s.scene.add(grp);
    const ov = document.createElement('canvas'); ov.width = 1024; ov.height = 576; const ovT = new THREE.CanvasTexture(ov); ovT.colorSpace = THREE.SRGBColorSpace;
    const O = this.on = { k, F, t: 0, rt, cam, grp, I, full: !!full, ov, ovT, actors: {}, txt: '' };
    // the cinema screen shows the render target, with the overlay (letterbox / titles) on a plane just in front
    if (I?.screen) { O.map0 = I.screen.material.map; I.screen.material.map = rt.texture; I.screen.material.toneMapped = true; I.screen.material.needsUpdate = true;
      const op = new THREE.Mesh(I.screen.geometry, new THREE.MeshBasicMaterial({ map: ovT, transparent: true, toneMapped: false, depthWrite: false })); op.position.copy(I.screen.position); op.position.z += 0.02; op.renderOrder = 5; I.screen.parent.add(op); O.ovPlane = op; }
    // cast: Shak and car clones
    const shak = buildPerson('shak'); grp.add(shak); O.actors.shak = shak;
    const src = s.obj; const car = src.clone(true); grp.add(car); O.actors.car = car;
    if (k === 'chase') { const cop = src.clone(true); grp.add(cop); const bar = new THREE.Group(); bar.position.y = (src.userData.dims?.H || 1.3) + 0.05; cop.add(bar); const mk = c => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); sp.scale.setScalar(0.9); bar.add(sp); return sp; };
      const red = mk(0xff2030), blue = mk(0x2060ff); red.position.x = -0.35; blue.position.x = 0.35; const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.3), new THREE.MeshStandardMaterial({ color: 0x111111 })); bar.add(base); O.actors.cop = cop; O.lights = [red, blue]; }
    // locations
    const V = { night: 'library', chase: 'club', bullring: 'bullring', comeup: 'costcutter' }[k], v = this.venue(V); O.v = v; O.P = this.street(v.x, v.z) || this.street(0, 0, 60); O.grade = { night: 'contrast(1.1) saturate(1.2) hue-rotate(-8deg)', chase: 'contrast(1.15) saturate(1.3)', bullring: 'contrast(1.12) saturate(1.28) sepia(.14) brightness(1.04)' }[k];
    if (k === 'bullring') this.bullSetup(O); if (k === 'comeup') { CU.setup(this, O); O.grade = 1; }
    this.full(O.full); this.music(k); this.f.s.hud?.flash?.('', 0.01); }
  // fullscreen toggles: the game camera follows the film camera, with letterbox / titles as a DOM overlay
  full(on) { const O = this.on; if (!O) return; O.full = on; if (on && !O.dom) { const d = O.dom = document.createElement('div'); d.id = 'cz-film'; d.style.cssText = 'position:fixed;inset:0;z-index:20;pointer-events:none'; O.ov.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'; d.appendChild(O.ov);
      const x = document.createElement('button'); x.textContent = '✕'; x.setAttribute('aria-label', 'Exit film'); x.style.cssText = 'position:absolute;right:calc(14px + env(safe-area-inset-right));top:calc(12px + env(safe-area-inset-top));width:40px;height:40px;border-radius:50%;background:rgba(0,0,0,.4);border:1.5px solid rgba(255,255,255,.7);color:#fff;font:700 18px system-ui;pointer-events:auto;transition:opacity .6s'; x.onclick = () => this.full(false); d.appendChild(x); O.xb = x;
      const wake = () => { x.style.opacity = '1'; clearTimeout(O.xt); O.xt = setTimeout(() => { if (O.xb) x.style.opacity = '0.12'; }, 2500); }; O.wake = wake; addEventListener('pointerdown', wake); addEventListener('pointermove', wake); wake();
      document.body.appendChild(d); }
    // whole HUD off while a film is full screen: hide every page layer except the 3D canvas and the film overlay
    if (on) { O.hid = []; for (const e of document.body.children) if (e !== O.dom && e.tagName !== 'SCRIPT' && !e.contains(this.s.g?.renderer?.domElement || document.querySelector('canvas')) && getComputedStyle(e).display !== 'none' && e.style.visibility !== 'hidden') { O.hid.push(e); e.style.visibility = 'hidden'; } for (const e of document.querySelectorAll('body > * canvas')) e.parentElement !== document.body && 0;
      }
    else { for (const e of O.hid || []) e.style.visibility = ''; O.hid = null; removeEventListener('pointerdown', O.wake || (() => { })); removeEventListener('pointermove', O.wake || (() => { })); O.xb = null; }
    if (!on && O.dom) { O.dom.remove(); O.dom = null; } }
  camFull(cam) { const O = this.on; if (!O || !O.full) return false; cam.position.copy(O.cam.position); cam.quaternion.copy(O.cam.quaternion); if (cam.fov !== O.cam.fov) { cam.fov = O.cam.fov; cam.updateProjectionMatrix(); } return true; }
  stop() { const O = this.on; if (!O) return; this.on = null; if (O.k === 'comeup') CU.stop(this, O); O.grp.removeFromParent(); O.rt.dispose(); O.ovT.dispose(); O.dom?.remove(); O.ovPlane?.removeFromParent(); if (O.full) this.full(false);
    if (O.I?.screen && O.map0) { O.I.screen.material.map = O.map0; O.I.screen.material.toneMapped = false; O.I.screen.material.needsUpdate = true; } if (O.I?.lit) O.I.lit.on = true; this.mus?.stop(); this.mus = null; }
  // ---------------------------------------------------------------- per frame
  step(dt) { const O = this.on; if (!O) return; O.t = O.fixT != null ? O.fixT : O.t + dt; if (O.t > O.F[3] + 1.5 && O.fixT == null) { this.f.s.hud?.flash?.('THE END — ' + O.F[1], 2); const I = O.I, k = O.k, full = O.full; this.stop(); return; }
    if (O.k === 'comeup') CU.step(this, O, O.t, dt); else this[O.k](O, O.t, dt); const { shak } = O.actors; if (shak.visible) animPerson(shak, dt, O.walk || 0);
    if (O.lights) { const ph = (O.t * 6) % 2 < 1; O.lights[0].material.opacity = ph ? 1 : 0.1; O.lights[1].material.opacity = ph ? 0.1 : 1; }
    this.overlay(O); this.render(O); }
  pose(o, d, side = 0) { const W = this.s.w, P = this.on.P; const p = at(P, d); const x = p.x + -p.tz * side, z = p.z + p.tx * side, y = W.groundAt?.(x, z, p.h)?.h ?? p.h; o.position.set(x, y, z); o.rotation.set(0, Math.atan2(-p.tx, -p.tz), 0); return p; }
  look(O, px, py, pz, tx, ty, tz, fov = 40) { O.cam.position.set(px, py, pz); O.cam.lookAt(tx, ty, tz); if (O.cam.fov !== fov) { O.cam.fov = fov; O.cam.updateProjectionMatrix(); } }
  // film 1: night drive
  night(O, t) { const v = O.v, { shak, car } = O.actors, P = O.P, L = P[P.length - 1][3]; O.stars = 0;
    const c0 = at(P, 6); car.visible = true;
    if (t < 5) { const a = t * 0.12 + 0.6; this.look(O, v.x + Math.cos(a) * 70, (v.y || 0) + 45 - t * 3, v.z + Math.sin(a) * 70, v.x, (v.y || 0) + 10, v.z, 42); this.pose(car, 6, 0); shak.visible = false; O.txt = t < 4.6 ? 'title:CUZZY PICTURES presents|BRUM AFTER DARK' : ''; }
    else if (t < 11) { const k = (t - 5) / 6; this.pose(car, 6, 0); shak.visible = true; const p = at(P, 6), sx = p.x + -p.tz * 3.2 + p.tx * (2 - k * 3.2), sz = p.z + p.tx * 3.2 + p.tz * (2 - k * 3.2); shak.position.set(sx, this.s.w.groundAt?.(sx, sz, p.h)?.h ?? p.h, sz); shak.rotation.y = Math.atan2(p.tx, p.tz) ; O.walk = k < 0.85 ? 1.4 : 0;
      this.look(O, sx + p.tx * 4 - p.tz * 2.5, shak.position.y + 1.5 - k * 0.3, sz + p.tz * 4 + p.tx * 2.5, sx, shak.position.y + 1.3, sz, 38 - k * 8); O.txt = t < 8 ? 'sub:SHAK: Right then. Let\'s see what the city\'s got tonight.' : ''; }
    else { shak.visible = false; const d = 6 + (t - 11) ** 1.4 * 3.2, p = this.pose(car, Math.min(L - 5, d), 0), cx = car.position.x, cz = car.position.z, cy = car.position.y;
      if (t < 18) this.look(O, cx - p.tz * 6 + p.tx * 2, cy + 1.0, cz + p.tx * 6 + p.tz * 2, cx, cy + 0.6, cz, 45);
      else if (t < 24) this.look(O, cx + p.tx * 9, cy + 0.35, cz + p.tz * 9, cx, cy + 0.7, cz, 34);
      else { const k = (t - 24) / 6; this.look(O, cx - p.tx * (10 + k * 40), cy + 3 + k * 50, cz - p.tz * (10 + k * 40), cx, cy, cz, 50); }
      O.txt = t > 26.5 ? 'title:THE END|CUZZY PICTURES · Birmingham' : t > 13 && t < 17 ? 'sub:(engine roars past the Library of Birmingham)' : ''; } }
  // film 2: police chase with rising wanted stars
  chase(O, t) { const { shak, car, cop } = O.actors, P = O.P, L = P[P.length - 1][3]; shak.visible = false; const sp = 16 + Math.min(10, t), d = Math.min(L - 30, 4 + t * sp) % Math.max(30, L - 30);
    const p = this.pose(car, d, Math.sin(t * 1.3) * 0.8); this.pose(cop, Math.max(0, d - 13 - Math.sin(t) * 3), Math.cos(t * 1.1) * 0.8); const cx = car.position.x, cy = car.position.y, cz = car.position.z;
    O.stars = t < 6 ? 1 : t < 14 ? 2 : t < 26 ? 3 : t < 29 ? 2 : 0;
    if (t < 4) { this.look(O, cop.position.x - p.tx * 7, cy + 2.2, cop.position.z - p.tz * 7, cx, cy + 0.6, cz, 48); O.txt = 'title:HOT PURSUIT|' ; }
    else if (t < 10) this.look(O, cx - p.tz * 7, cy + 0.8, cz + p.tx * 7, (cx + cop.position.x) / 2, cy + 0.6, (cz + cop.position.z) / 2, 50);
    else if (t < 17) { const a = t * 0.4; this.look(O, cx + Math.cos(a) * 35, cy + 40, cz + Math.sin(a) * 35, cx, cy, cz, 38); O.txt = 'sub:RADIO: All units, silver coupe heading out of Broad Street…'; }
    else if (t < 23) this.look(O, cx + p.tx * 8 + p.tz * 1.2, cy + 0.4, cz + p.tz * 8 - p.tx * 1.2, cx, cy + 0.7, cz, 32);
    else if (t < 28) this.look(O, cop.position.x - p.tx * 4, cy + 1.2, cop.position.z - p.tz * 4, cx, cy + 0.8, cz, 40);
    else { this.look(O, cx - p.tx * 20, cy + 14 + (t - 28) * 6, cz - p.tz * 20, cx, cy, cz, 45); cop.visible = (t < 29); O.txt = 'title:ESCAPED|wanted level cleared'; } if (t >= 4 && t < 10) O.txt = ''; if (t >= 17 && t < 28) O.txt = ''; }
  // film 3: Bullring meet
  // The Bullring Run: Selfridges blob, the Rotunda and St Martin's spire framed in every shot, Shak in frame, warm grade
  lm(k) { const W = this.s.w, p = W.buildingPolys?.find(q => q.b.lm === k); if (p) { let x = 0, z = 0; for (const q of p.pts) { x += q[0]; z += q[1]; } return { x: x / p.pts.length, z: z / p.pts.length }; } const L = this.s.app.data.landmarks?.[k]; return L ? { x: L[0] / 10, z: L[1] / 10 } : null; }
  bullSetup(O) { const W = this.s.w, sf = this.lm('selfridges'), ro = this.lm('rotunda'), sm = this.lm('stmartin'); if (!sf) return; const H = (x, z) => W.groundAt?.(x, z, 0)?.h ?? 0;
    // a walk spot on the pavement: on the Selfridges -> St Martin's side, ~45 m out from the blob
    const v = O.v, spot = { x: v.x + Math.sin(v.yaw) * 6, z: v.z + Math.cos(v.yaw) * 6 }, r = W.nearestRoad?.(spot.x, spot.z);
    O.B = { sf, ro: ro || sf, sm: sm || sf, spot, y: H(spot.x, spot.z), H, road: r }; }
  // camera with a clear line to its subject: try the wanted bearing, then swing round / up until nothing blocks it
  clear(O, id, tx, ty, tz, az, el, d) { const C = O.clr || (O.clr = {}); if (C[id]) return C[id]; const rc = this._rc || (this._rc = new THREE.Raycaster()), W = this.s.w, T = new THREE.Vector3(tx, ty, tz), objs = [W.group]; let best = null;
    S: for (const dEl of [0, 0.15, 0.35, 0.6]) for (const dA of [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6, 2.2, -2.2, 3.1]) { const a = az + dA, e = el + dEl, p = new THREE.Vector3(tx + Math.sin(a) * Math.cos(e) * d, ty + Math.sin(e) * d, tz + Math.cos(a) * Math.cos(e) * d), dir = T.clone().sub(p), L = dir.length(); rc.set(p, dir.normalize()); rc.camera = O.cam; rc.far = L - 1; const hit = rc.intersectObjects(objs, true).find(h => h.object.visible && !h.object.isSprite && !h.object.isPoints && h.object.material?.transparent !== true); if (!hit) { best = { a, e }; break S; } }
    return (C[id] = best || { a: az, e: el + 0.6 }); }
  orbit(O, id, tx, ty, tz, az, el, d, fov, swing = 0, lx = tx, ly = ty, lz = tz) { const c = this.clear(O, id, tx, ty, tz, az, el, d), a = c.a + swing; this.look(O, tx + Math.sin(a) * Math.cos(c.e) * d, ty + Math.sin(c.e) * d, tz + Math.cos(a) * Math.cos(c.e) * d, lx, ly, lz, fov); }
  bullring(O, t) { const { shak, car } = O.actors, B = O.B; O.stars = 0; if (!B) return this.bullOld(O, t);
    const { sf, ro, sm, spot, H } = B, y0 = B.y, put = (o, x, z, yaw) => { o.position.set(x, H(x, z), z); o.rotation.y = yaw; }, dir = (a, b) => { const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; return { x: dx / l, z: dz / l }; };
    const toSf = dir(spot, sf), side = { x: -toSf.z, z: toSf.x };
    const brg = (from, to) => Math.atan2(from.x - to.x, from.z - to.z); // bearing from 'to' back towards 'from'
    if (t < 6) { // 1: low wide on the Selfridges blob, slow push, Shak walking towards it in the foreground
      car.visible = false; shak.visible = true; const k = t / 6, sx = spot.x - toSf.x * (3 - k * 3), sz = spot.z - toSf.z * (3 - k * 3); put(shak, sx, sz, Math.atan2(toSf.x, toSf.z)); O.walk = 1.4;
      this.orbit(O, 1, sx, y0 + 1.2, sz, brg(spot, sf) + 0.25, 0.05, 8 - k * 2, 54, 0, sf.x, y0 + 12, sf.z); O.txt = t < 4.5 ? 'title:THE BULLRING RUN|' : ''; }
    else if (t < 11) { // 2: Shak walks to camera, the blob's discs behind him
      const k = (t - 6) / 5, sx = spot.x - toSf.x * k * 3, sz = spot.z - toSf.z * k * 3; put(shak, sx, sz, Math.atan2(-toSf.x, -toSf.z)); O.walk = 1.4;
      this.orbit(O, 2, sx, y0 + 1.5, sz, brg(spot, sf) + 0.12, 0.02, 4.5, 40, 0, sx + toSf.x * 30, y0 + 7, sz + toSf.z * 30); O.txt = t > 7 ? 'sub:SHAK: Saggy said half seven. It\'s twenty to.' : ''; }
    else if (t < 17) { // 3: the car rolls up beside Shak, low tracking shot, the Rotunda towering behind
      car.visible = true; O.walk = 0; const rd = B.road, tx = rd ? rd.dx : side.x, tz = rd ? rd.dz : side.z, k = ease((t - 11) / 6), ox = rd ? rd.px : spot.x + side.x * 4, oz = rd ? rd.pz : spot.z + side.z * 4, cx = ox - tx * (28 - k * 28), cz = oz - tz * (28 - k * 28); put(car, cx, cz, Math.atan2(tx, tz));
      const sx = spot.x - toSf.x * 3, sz = spot.z - toSf.z * 3; put(shak, sx, sz, Math.atan2(cx - sx, cz - sz));
      this.orbit(O, 3, cx, y0 + 0.6, cz, brg(car.position, ro) + 0.4, 0.04, 7, 46, 0, (cx + ro.x) / 2, y0 + 10, (cz + ro.z) / 2); O.txt = t > 14 ? 'sub:JUNIOR: Alright boss! Yow’m lookin’ sharp.' : ''; }
    else if (t < 22) { // 4: St Martin's spire framed over Shak and the car, slow arc
      const mx = (car.position.x + shak.position.x) / 2, mz = (car.position.z + shak.position.z) / 2;
      this.orbit(O, 4, mx, y0 + 1.2, mz, brg({ x: mx, z: mz }, sm), 0.08, 10, 44, (t - 17) * 0.06, (mx + sm.x) / 2, y0 + 9, (mz + sm.z) / 2); O.txt = ''; }
    else { // 5: crane up and back revealing blob, Rotunda and spire together
      const k = ease((t - 22) / 4), c = { x: (sf.x + ro.x + sm.x) / 3, z: (sf.z + ro.z + sm.z) / 3 };
      this.orbit(O, 5, spot.x, y0 + 1, spot.z, brg(spot, c), 0.3 + k * 0.5, 14 + k * 60, 50, 0, c.x, y0 + 12, c.z); O.txt = t > 23 ? 'title:THE END|starring SHAK · with Saggy & Junior' : ''; } }
  bullOld(O, t) { const v = O.v, { shak, car } = O.actors, P = O.P; O.stars = 0; const vy = v.y || 0;
    if (t < 7) { shak.visible = true; const k = t / 7, sx = v.x + Math.sin(v.yaw) * (1 + k * 5), sz = v.z + Math.cos(v.yaw) * (1 + k * 5); shak.position.set(sx, this.s.w.groundAt?.(sx, sz, vy)?.h ?? vy, sz); shak.rotation.y = v.yaw + Math.PI; O.walk = 1.5;
      const a = v.yaw + 0.9 - k * 1.4; this.look(O, sx + Math.sin(a) * 6, vy + 1.6, sz + Math.cos(a) * 6, sx, vy + 1.3, sz, 40); O.txt = t < 4 ? 'title:THE BULLRING RUN|' : 'sub:SHAK: Saggy said half seven. It\'s twenty to.'; this.pose(car, 2, 0); car.visible = false; }
    else if (t < 15) { car.visible = true; O.walk = 0; const k = ease((t - 7) / 6), L = P[P.length - 1][3], d = lerp(Math.min(L - 5, 120), 8, k); const p = this.pose(car, d, 0); const cx = car.position.x, cy = car.position.y, cz = car.position.z;
      shak.position.set(at(P, 8).x - at(P, 8).tz * 3, cy, at(P, 8).z + at(P, 8).tx * 3); shak.rotation.y = Math.atan2(-p.tz, p.tx); this.look(O, shak.position.x - p.tz * 2.5, cy + 1.7, shak.position.z + p.tx * 2.5, cx, cy + 0.8, cz, 42); O.txt = t > 12 ? 'sub:JUNIOR: Alright boss! Yow’m lookin’ sharp.' : ''; }
    else if (t < 21) { const a = (t - 15) * 0.35, cx = car.position.x, cy = car.position.y, cz = car.position.z; this.look(O, cx + Math.cos(a) * 7, cy + 1.4, cz + Math.sin(a) * 7, cx, cy + 0.6, cz, 36); O.txt = ''; }
    else { const k = (t - 21) / 5; this.look(O, v.x + 20 + k * 30, vy + 8 + k * 35, v.z + 20, v.x, vy + 5, v.z, 48); O.txt = t > 22 ? 'title:THE END|starring SHAK · with Saggy & Junior' : ''; } }
  // ---------------------------------------------------------------- overlay (letterbox, titles, subtitles, stars)
  overlay(O) { const key = O.txt + '|' + O.stars + '|' + (O.full ? 1 : 0) + (O.k === 'comeup' ? '|' + (O.gf = ((O.gf || 0) + 1) % 4) : ''); if (key === O.key) return; O.key = key; const c = O.ov.getContext('2d'), w = O.ov.width, h = O.ov.height; c.clearRect(0, 0, w, h);
    if (O.k === 'bullring' || O.k === 'night') { const g = c.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.62); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.5)'); c.fillStyle = g; c.fillRect(0, 0, w, h); if (O.k === 'bullring') { c.globalCompositeOperation = 'soft-light'; c.fillStyle = 'rgba(255,140,50,.35)'; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(0,90,120,.18)'; c.fillRect(0, 0, w, h * 0.35); c.globalCompositeOperation = 'source-over'; } }
    if (O.k === 'comeup') { c.globalCompositeOperation = 'soft-light'; let g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(0,110,130,.45)'); g.addColorStop(0.55, 'rgba(0,80,100,.2)'); g.addColorStop(1, 'rgba(255,130,40,.4)'); c.fillStyle = g; c.fillRect(0, 0, w, h); c.globalCompositeOperation = 'source-over';
      g = c.createRadialGradient(w / 2, h / 2, h * 0.28, w / 2, h / 2, w * 0.6); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.6)'); c.fillStyle = g; c.fillRect(0, 0, w, h);
      const G = this._grain || (this._grain = [0, 1, 2, 3].map(() => { const n = document.createElement('canvas'); n.width = n.height = 192; const x = n.getContext('2d'), d = x.createImageData(192, 192); for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 22; } x.putImageData(d, 0, 0); return n; }));
      c.fillStyle = c.createPattern(G[O.gf], 'repeat'); c.fillRect(0, 0, w, h); }
    c.fillStyle = '#000'; const bar = h * 0.11; c.fillRect(0, 0, w, bar); c.fillRect(0, h - bar, w, bar);
    const [kind, txt] = O.txt ? [O.txt.split(':')[0], O.txt.slice(O.txt.indexOf(':') + 1)] : ['', ''];
    if (kind === 'title') { const [a, b] = txt.split('|'); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(0, h * 0.36, w, h * 0.3); c.textAlign = 'center'; c.fillStyle = '#ffcc33'; c.font = 'bold 64px Georgia,serif'; c.fillText(a, w / 2, h * 0.5); if (b) { c.fillStyle = '#fff'; c.font = '28px Georgia,serif'; c.fillText(b, w / 2, h * 0.6); } }
    if (kind === 'vo') { c.textAlign = 'left'; c.font = 'italic 500 26px Georgia,serif'; c.fillStyle = '#f2e6c8'; c.shadowColor = '#000'; c.shadowBlur = 8; const words = txt.split(' '), lines = [''], mw = w * 0.62; for (const wd of words) { if (c.measureText(lines[lines.length - 1] + ' ' + wd).width > mw) lines.push(wd); else lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + wd).trim(); } lines.forEach((l, i) => c.fillText(l, w * 0.07, h - bar - 22 - (lines.length - 1 - i) * 32)); c.shadowBlur = 0; }
    if (kind === 'card') { c.textAlign = 'left'; c.fillStyle = '#e8d9b0'; c.font = '700 22px Georgia,serif'; c.letterSpacing = '6px'; c.fillText(txt, w * 0.07, bar + 44); c.letterSpacing = '0px'; }
    if (kind === 'sub') { c.textAlign = 'center'; c.font = '600 30px system-ui'; c.fillStyle = '#fff'; c.shadowColor = '#000'; c.shadowBlur = 6; c.fillText(txt, w / 2, h - bar - 24, w - 60); c.shadowBlur = 0; }
    if (O.stars) { c.textAlign = 'right'; c.font = '900 46px system-ui'; c.fillStyle = '#ffd23f'; c.fillText('★'.repeat(O.stars) + '☆'.repeat(5 - O.stars), w - 30, bar + 56); }
    O.ovT.needsUpdate = true; }
  render(O) { const s = this.s, r = s.g?.r; if (!r) return; O.cam.updateMatrixWorld(); const I = O.I, G = s.g, lit = I?.lit;
    if (O.full) { if (lit) lit.on = false; return; } // the main render draws the film shot itself
    if (lit) { lit.on = false; if (G.sun) G.sun.intensity = lit.sI; if (G.hemi && lit.hI != null) G.hemi.intensity = lit.hI; }
    const prev = r.getRenderTarget(); r.setRenderTarget(O.rt); r.clear(); try { r.render(s.scene, O.cam); } catch (e) { } r.setRenderTarget(prev);
    if (lit) { lit.on = true; if (G.sun) G.sun.intensity = 0; if (G.hemi) G.hemi.intensity = 0; } }
  // ---------------------------------------------------------------- score: a small synth loop per film
  // original synth scores, rendered offline so the cinema and the recorded MP4 get the same audio
  async score(k, dur) { const SR = 44100, A = new OfflineAudioContext(2, Math.ceil(SR * dur), SR), out = A.createGain(); out.gain.value = 0.5; const comp = A.createDynamicsCompressor(); out.connect(comp).connect(A.destination); const hz = m => 440 * Math.pow(2, (m - 69) / 12);
    const note = (t, m, len, type, g, f = 0, det = 0) => { const o = A.createOscillator(), e = A.createGain(); o.type = type; o.frequency.value = hz(m); o.detune.value = det; e.gain.setValueAtTime(0.0001, t); e.gain.linearRampToValueAtTime(g, t + Math.min(0.02 + f, len * 0.4)); e.gain.exponentialRampToValueAtTime(0.0001, t + len); let n = o; if (f) { const lp = A.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; o.connect(lp); n = lp; } n.connect(e).connect(out); o.start(t); o.stop(t + len + 0.05); };
    const noise = (() => { const b = A.createBuffer(1, SR, SR), d = b.getChannelData(0); for (let i = 0; i < SR; i++) d[i] = Math.random() * 2 - 1; return b; })(); const hat = (t, g) => { const s = A.createBufferSource(), hp = A.createBiquadFilter(), e = A.createGain(); s.buffer = noise; hp.type = 'highpass'; hp.frequency.value = 7000; e.gain.setValueAtTime(g, t); e.gain.exponentialRampToValueAtTime(0.0001, t + 0.05); s.connect(hp).connect(e).connect(out); s.start(t, Math.random() * 0.5, 0.08); };
    const kick = (t, g) => { const o = A.createOscillator(), e = A.createGain(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15); e.gain.setValueAtTime(g, t); e.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); o.connect(e).connect(out); o.start(t); o.stop(t + 0.35); };
    if (k === 'comeup') { const bpm = 72, b = 60 / bpm, CH = [[50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52]]; // Dm Bb Gm A
      for (let bar = 0, t = 0; t < dur; bar++, t += b * 4) { const ch = CH[(bar >> 1) % 4], heat = t > 100 && t < 143, climax = t >= 143 && t < 168, end = t >= 168, lvl = t < 38 ? 0.6 : 1;
        for (const m of ch) { note(t, m, b * 4.2, 'sawtooth', 0.05 * lvl, 0.8, -8); note(t, m, b * 4.2, 'sawtooth', 0.05 * lvl, 0.8, 8); } if (end) note(t, ch[0] + 24, b * 4, 'sine', 0.05, 1.2);
        for (let q = 0; q < 4; q++) { const tq = t + q * b; note(tq, ch[0] - 24, b * (heat ? 0.45 : 0.9), heat ? 'square' : 'triangle', heat ? 0.12 : 0.2, heat ? 0.01 : 0); if (heat) note(tq + b / 2, ch[0] - 24, b * 0.45, 'square', 0.1, 0.01);
          if (t > 38 && !end) { kick(tq, q % 2 ? 0.25 : 0.45); if (q % 2) hat(tq, 0.12); } if (heat || climax) { hat(tq + b / 2, 0.08); hat(tq + b / 4, 0.05); hat(tq + 3 * b / 4, 0.05); }
          if (bar % 2 === 1 && !heat) note(tq + b / 2, ch[(q + 1) % 3] + 12, b * 1.4, 'triangle', 0.09); } } }
    else { const key = { night: [45, 48, 52, 55], chase: [40, 43, 47, 50], bullring: [43, 47, 50, 55] }[k] || [45, 48, 52, 55], bpm = k === 'chase' ? 132 : 96, step = 60 / bpm / 2;
      for (let n = 0, t = 0.05; t < dur; n++, t += step) { if (n % 2 === 0) note(t, key[0] - 12 + (n % 16 >= 8 ? 5 : 0), step * 1.8, 'sawtooth', 0.4); note(t, key[n % 4] + 12, step * 0.9, 'triangle', 0.22); if (k === 'chase' && n % 4 === 2) note(t, 30, 0.08, 'square', 0.5); } }
    const fade = A.createGain(); return await A.startRendering(); }
  async scoreWav(k) { const F = FILMS_IG.find(f => f[0] === k), B = await this.score(k, F[3] + 1.5), n = B.length, ch = [B.getChannelData(0), B.getChannelData(1)], buf = new DataView(new ArrayBuffer(44 + n * 4)); const W = (o, s) => [...s].forEach((c, i) => buf.setUint8(o + i, c.charCodeAt(0)));
    W(0, 'RIFF'); buf.setUint32(4, 36 + n * 4, true); W(8, 'WAVEfmt '); buf.setUint32(16, 16, true); buf.setUint16(20, 1, true); buf.setUint16(22, 2, true); buf.setUint32(24, B.sampleRate, true); buf.setUint32(28, B.sampleRate * 4, true); buf.setUint16(32, 4, true); buf.setUint16(34, 16, true); W(36, 'data'); buf.setUint32(40, n * 4, true);
    for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < 2; c++, o += 2) buf.setInt16(o, Math.max(-1, Math.min(1, ch[c][i])) * 32767, true); let s = ''; const u = new Uint8Array(buf.buffer); for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s); }
  music(k) { if (window.CZ_REC) return; let alive = true; this.mus = { stop: () => { alive = false; try { this._src?.stop(); } catch (e) { } } }; const O = this.on, F = O.F;
    (this._sc ||= {})[k] ||= this.score(k, F[3] + 1.5); this._sc[k].then(B => { if (!alive || this.on !== O) return; const A = this.f.ac || (this.f.ac = new (window.AudioContext || window.webkitAudioContext)()); A.resume?.(); const s = A.createBufferSource(), g = A.createGain(); g.gain.value = 0.5; s.buffer = B; s.connect(g).connect(A.destination); s.start(0, Math.min(O.t, B.duration - 0.1)); this._src = s; }).catch(() => { }); }
}
