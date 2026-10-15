// p55 VR+ (built around the CUZZY R6 Avant hero car, the blueprint for every car's VR fit):
//  full-body avatar (vr-avatar.js), wrist menu, teleport + snap/smooth turn, seated/standing + height, touch sat-nav,
//  H-pattern / sequential manual with clutch on the left trigger, look-to-the-side, gamepad fallback, weapon hook, Auto tier.
import * as THREE from 'three';
import { VRAvatar } from './vr-avatar.js';
const clamp = (v, a, b) => v < a ? a : v > b ? b : v; const _v = new THREE.Vector3(), _w = new THREE.Vector3();
export const PLUS_DEF = { stance: 'seated', height: 0, snapDeg: 30, loco: 'smooth', avatar: true, avatarHands: false, gearbox: 'seq', look: true };
// Auto tier: Quest 3 / Pro -> High @ 90 Hz, Quest 2 -> Quest @ 72-90, desktop PC VR -> Ultra; the governor then steps down (or back up)
export function autoTier(ses) { const ua = navigator.userAgent; if (/Quest 3|Quest Pro/i.test(ua)) return 'questHigh'; if (/OculusBrowser|Quest/i.test(ua)) return 'quest';
  const fr = ses?.supportedFrameRates; return fr && Math.max(...fr) >= 120 ? 'ultra' : 'ultra'; }
function canvasPanel(w, h, pw, ph) { const c = document.createElement('canvas'); c.width = w; c.height = h; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false, depthTest: false })); m.renderOrder = 22; return { c, g: c.getContext('2d'), t, m, pw, ph }; }
export const Plus = {
  plusBuild() { const G = this.app.gfx; for (const k in PLUS_DEF) if (this.opt[k] == null) this.opt[k] = PLUS_DEF[k];
    // avatar (scene-level so mirrors / reflections / shadows all see it)
    if (!this.avatar) this.avatar = new VRAvatar(this); this.avatar.on = !!this.opt.avatar; G.scene.add(this.avatar.g);
    // wrist menu on the left hand: shows when the inside of the wrist faces the eyes
    this.wrist = canvasPanel(512, 384, 0.14, 0.105); this.wrist.m.visible = false; this.seat.add(this.wrist.m); this.wristBtns = [];
    // teleport arc + target ring
    const N = 32; this.arcPts = new Float32Array(N * 3); const ag = new THREE.BufferGeometry(); ag.setAttribute('position', new THREE.BufferAttribute(this.arcPts, 3));
    this.arc = new THREE.Line(ag, new THREE.LineBasicMaterial({ color: 0x19e6c1, transparent: true, opacity: 0.9, depthTest: false })); this.arc.frustumCulled = false; this.arc.visible = false; this.arc.renderOrder = 21; G.scene.add(this.arc);
    this.tpRing = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x19e6c1, transparent: true, opacity: 0.85, depthTest: false })); this.tpRing.visible = false; this.tpRing.renderOrder = 21; G.scene.add(this.tpRing);
    this.drawWrist();
    // 2D HUD (minimap, MAP, radio pill, nav pill, touch buttons) is hidden in VR: the car's own cluster, sat-nav and the wrist / floating menus replace it
    if (!document.getElementById('vr-css')) { const st = document.createElement('style'); st.id = 'vr-css'; st.textContent = 'body.vr-on > *:not(canvas):not(#vr-btn):not(script):not(style){visibility:hidden!important}'; document.head.appendChild(st); } },
  plusCleanup() { document.body.classList.remove('vr-on'); const sc = this.app.gfx.scene; for (const o of [this.avatar?.g, this.arc, this.tpRing]) if (o) sc.remove(o); },
  plusMenu() { const o = this.opt; return [
    ['Stance: ' + (o.stance === 'seated' ? 'seated' : 'standing (room scale)'), () => { o.stance = o.stance === 'seated' ? 'standing' : 'seated'; this.recentre(); }],
    ['Height offset: ' + (o.height >= 0 ? '+' : '') + Math.round(o.height * 100) + ' cm', () => { o.height = o.height >= 0.2 ? -0.2 : +(o.height + 0.05).toFixed(2); }],
    ['On-foot move: ' + (o.loco === 'teleport' ? 'teleport' : 'smooth'), () => { o.loco = o.loco === 'teleport' ? 'smooth' : 'teleport'; }],
    ['Snap angle: ' + o.snapDeg + '°', () => { o.snapDeg = o.snapDeg === 30 ? 45 : o.snapDeg === 45 ? 15 : 30; }],
    ['Gearbox (manual): ' + (o.gearbox === 'h' ? 'H-pattern + clutch' : 'sequential'), () => { o.gearbox = o.gearbox === 'h' ? 'seq' : 'h'; this.app.settings.controls.clutch = o.gearbox === 'h'; }],
    ['Full-body avatar: ' + (o.avatar ? 'on' : 'off'), () => { o.avatar = !o.avatar; if (this.avatar) this.avatar.on = o.avatar; }]]; },
  // ---------------------------------------------------------------- per frame (end of VR.update)
  plusUpdate(dt, sess, foot) { const u = sess.obj.userData; this.rig.position.y += this.opt.height || 0;
    const T = (n, f) => { try { f(); } catch (e) { if (!this['err' + n]) { this['err' + n] = 1; console.error('vr+ ' + n, e.message); } } };
    T('wrist', () => this.wristFrame(dt, sess, foot)); if (!foot) { T('nav', () => this.navTouch(sess)); T('h', () => this.hShift(sess)); } else T('tp', () => this.teleportFrame(dt, sess));
    document.body.classList.toggle('vr-on', true);
    if (foot) { const w = sess.foot?.wpn; if (w?.vrHand) for (const s of ['left', 'right']) { const S = this.src[s]; if (!S) continue; const p = this.handPos(s, new THREE.Vector3()); if (!p) continue; const q = S.grip.getWorldQuaternion(new THREE.Quaternion()); try { w.vrHand(s, p, q, this.val(s, 1), this.val(s, 0)); } catch (e) { } } }
    // look-to-the-side (no-headset / gamepad): right stick X turns the head view while driving
    if (!foot && this.opt.look) { const gp = this.fallbackPad(); const lx = gp && !this.src.right ? gp.axes[2] || 0 : 0; this.lookYaw = (this.lookYaw || 0) + ((Math.abs(lx) > 0.2 ? -lx * 1.4 : this.lookTarget || 0) - (this.lookYaw || 0)) * Math.min(1, dt * 6);
      if (!this.app.gfx.r.xr.isPresenting) this.app.gfx.cam.rotation.set(0, this.lookYaw, 0); }
    T('avatar', () => this.avatarFrame(dt, sess, foot)); },
  fallbackPad() { for (const g of navigator.getGamepads?.() || []) if (g && g.mapping === 'standard') return g; return null; },
  avatarFrame(dt, sess, foot) { const A = this.avatar; if (!A) return; const G = this.app.gfx, xr = G.r.xr; const cam = xr.isPresenting ? xr.getCamera() : G.cam;
    const head = cam.getWorldPosition(new THREE.Vector3()); const hands = {}; for (const s of ['left', 'right']) if (this.hands[s]?.visible) hands[s] = this.hands[s].getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0, 0.06).applyQuaternion(this.hands[s].getWorldQuaternion(new THREE.Quaternion())));
    let seatQ = null, yaw = this.headYaw(); if (!foot) seatQ = (sess.obj.userData.body || sess.obj).getWorldQuaternion(new THREE.Quaternion());
    else { const d = yaw - (this.bodyYaw ?? yaw); const wrap = Math.atan2(Math.sin(d), Math.cos(d)); if (Math.abs(wrap) > 0.6 || (sess.foot?.v || 0) > 0.3) this.bodyYaw = (this.bodyYaw ?? yaw) + wrap * Math.min(1, dt * 4); else this.bodyYaw ??= yaw; yaw = this.bodyYaw; }
    const dirs = {}, curls = {}; for (const s in hands) { const h = this.hands[s]; dirs[s] = new THREE.Vector3(0, 0, -1).applyQuaternion(h.getWorldQuaternion(new THREE.Quaternion()));
      const F = h.userData.fingers; curls[s] = (h.userData.curl || [0, 0, 0, 0]).concat([h.userData.th || 0]); }
    // the model's real hands replace the VR glove once the avatar has loaded (gloves stay as the fallback)
    for (const s of ['left', 'right']) { const h = this.hands[s]; if (!h) continue; const R = h.userData.real, ok = !!R?.ok; h.traverse(o => { if (o.isMesh && o.userData.glove) o.visible = !ok; }); if (ok && this.src[s]?.input?.hand) R.track(this.src[s].hand); }
    A.update(dt, { head, yaw, hands, mode: foot ? 'foot' : 'seat', seatQ, speed: Math.abs(sess.foot?.v || 0), dirs, curls }); },
  // ---------------------------------------------------------------- wrist menu
  wristItems() { const s = this.app.session; return [['MENU', () => { this.menuOn = true; this.menu.m.visible = true; this.menu.m.position.set(0, -0.1, -0.85); this.drawMenu(); }], ['RECENTRE', () => this.recentre()],
    ['LIGHTS', () => s && globalThis.CUZZY_HERO?.press(s, 'lights')], [s?.foot?.active ? 'MAP' : 'GET OUT', () => s?.foot?.active ? s.foot.openMap?.() : s?.foot?.exitCar?.()]]; },
  drawWrist() { const { g, c, t } = this.wrist, it = this.wristItems(); g.clearRect(0, 0, c.width, c.height); g.fillStyle = 'rgba(8,10,14,.9)'; g.beginPath(); g.roundRect(0, 0, c.width, c.height, 30); g.fill();
    const d = new Date(); g.fillStyle = '#19e6c1'; g.font = '800 44px system-ui'; g.textAlign = 'left'; g.fillText(String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'), 24, 56);
    this.wristBtns = it.map(([l], i) => { const x = 20 + (i % 2) * 246, y = 84 + Math.floor(i / 2) * 146, w = 226, h = 128; g.fillStyle = this.wristHover === i ? '#19e6c1' : 'rgba(255,255,255,.1)'; g.beginPath(); g.roundRect(x, y, w, h, 20); g.fill();
      g.fillStyle = this.wristHover === i ? '#000' : '#fff'; g.font = '800 34px system-ui'; g.textAlign = 'center'; g.fillText(l, x + w / 2, y + 76); return [x, y, w, h]; }); t.needsUpdate = true; },
  wristFrame(dt, sess, foot) { const W = this.wrist, h = this.hands.left; if (!W || !h) return; const show = this.sim ? !!this.wristForce : h.visible && !this.grab.left && this.palmUp();
    W.m.visible = show; if (!show) return; W.m.position.copy(h.position).add(new THREE.Vector3(0, 0.07, 0.02)); W.m.lookAt(this.seat.worldToLocal(this.app.gfx.cam.getWorldPosition(new THREE.Vector3())).add(this.seat.position)); W.m.quaternion.copy(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(this.app.gfx.cam.position, W.m.position, new THREE.Vector3(0, 1, 0))));
    // poke with the right fingertip
    const p = this.handPos('right', new THREE.Vector3()); if (!p) return; const loc = W.m.worldToLocal(p.clone()); let hov = -1;
    if (Math.abs(loc.z) < 0.03) { const x = (loc.x / W.pw + 0.5) * 512, y = (0.5 - loc.y / W.ph) * 384; hov = this.wristBtns.findIndex(([a, b, w, hh]) => x >= a && x <= a + w && y >= b && y <= b + hh); }
    if (hov !== this.wristHover) { if (hov >= 0) { this.wristItems()[hov][1](); this.pulse('right', 0.6, 25); } this.wristHover = hov; this.drawWrist(); } },
  palmUp() { const S = this.src.left; if (!S) return false; const q = S.grip.getWorldQuaternion(new THREE.Quaternion()); const n = new THREE.Vector3(1, 0, 0).applyQuaternion(q); // palm normal of the left grip faces +X
    const toEye = this.app.gfx.r.xr.getCamera().getWorldPosition(new THREE.Vector3()).sub(S.grip.getWorldPosition(new THREE.Vector3())).normalize(); return n.dot(toEye) > 0.55; },
  // ---------------------------------------------------------------- sat-nav: tap the map to drop a destination
  navUV(sess, u, v) { const H = sess.obj.userData.hero, hud = sess.hud || this.app.hud, b = hud?.mb, S = hud?.mS; if (!H?.nav || !b) return null; const W = H.nav.c.width, Hh = H.nav.c.height, Q = sess.S;
    const px = u * W, py = (1 - v) * Hh, cx = W / 2, cy = Hh * 0.68, k = S * 4.4 * H.st.zoom, cs = Math.cos(Q.yaw), sn = Math.sin(Q.yaw); const X = px - cx, Y = py - cy; // invert hero drawNav's toScr
    const dx = X * cs + Y * sn, dy = -X * sn + Y * cs; return { x: Q.x + dx / k, z: Q.z + dy / k }; },
  navSet(sess, u, v) { const p = this.navUV(sess, u, v); if (!p) return false; const f = sess.foot; f?.setWp?.({ x: p.x, z: p.z, name: 'Dropped pin' }); try { f?.nav?.start(f.wp, sess.S); } catch (e) { } return true; },
  navTouch(sess) { const H = sess.obj.userData.hero; if (!H?.nav || this.sim) return; const m = H.nav.m;
    for (const s of ['right', 'left']) { if (this.grab[s]) continue; const p = this.handPos(s, new THREE.Vector3()); if (!p) continue; const loc = m.worldToLocal(p.clone()); const pw = m.geometry.parameters.width, ph = m.geometry.parameters.height;
      const inside = Math.abs(loc.z) < 0.02 && Math.abs(loc.x) < pw / 2 && Math.abs(loc.y) < ph / 2; const k = 'nav' + s;
      if (inside && !this[k]) { this[k] = true; const u = loc.x / pw + 0.5, v = loc.y / ph + 0.5; if (u > 0.08 && u < 0.92 && v > 0.22) { this.navSet(sess, u, v); this.pulse(s, 0.5, 30); } } else if (!inside) this[k] = false; } },
  // ---------------------------------------------------------------- H-pattern: lever position -> gear (clutch = left trigger, brake moves to right stick back)
  hShift(sess) { if (this.opt.gearbox !== 'h' || this.app.settings.controls.auto || !this.lvGrab) return; const p = this.handPos('right', new THREE.Vector3()); if (!p) return;
    const b = this.toBody(sess, p), x = b.x - (this.lvGrab.x0 ??= b.x), z = b.z - this.lvGrab.z0; const col = x < -0.03 ? 0 : x > 0.03 ? 2 : 1, row = z < -0.035 ? 0 : z > 0.035 ? 1 : -1;
    const gear = row < 0 ? 0 : col * 2 + row + 1; const cl = this.val('left', 0); if (gear !== this.hGear && (cl > 0.6 || gear === 0)) { this.hGear = gear; sess.inp.directGear = gear; sess.inp.hPattern = true; if (gear) this.pulse('right', 0.8, 28); } },
  // ---------------------------------------------------------------- teleport: push the right stick forward, aim the arc, release
  teleportFrame(dt, sess) { const f = sess.foot; if (this.opt.loco !== 'teleport' || !f || this.sim) { this.arc.visible = this.tpRing.visible = false; return; }
    f.joy.x = f.joy.y = 0; const ry = this.pad('right')?.axes?.[3] || 0, ray = this.src.right?.ray; if (!ray) return;
    if (ry < -0.6) { const o = ray.getWorldPosition(new THREE.Vector3()), d = new THREE.Vector3(0, 0, -1).transformDirection(ray.matrixWorld).multiplyScalar(9); let hit = null; const P = this.arcPts, g = -9.8, gy = f.p.y;
      for (let i = 0; i < 32; i++) { const t = i * 0.05, x = o.x + d.x * t, y = o.y + d.y * t + 0.5 * g * t * t, z = o.z + d.z * t; P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z; if (!hit && y <= gy) hit = new THREE.Vector3(x, gy, z); if (hit) { P[i * 3] = hit.x; P[i * 3 + 1] = hit.y; P[i * 3 + 2] = hit.z; } }
      this.arc.geometry.attributes.position.needsUpdate = true; this.arc.visible = true; this.tpHit = hit && hit.distanceTo(f.p) < 12 ? hit : null; this.tpRing.visible = !!this.tpHit; if (this.tpHit) this.tpRing.position.copy(this.tpHit).y += 0.03; }
    else if (this.arc.visible) { this.arc.visible = this.tpRing.visible = false; if (this.tpHit) { this.teleportTo(sess, this.tpHit); this.tpHit = null; } } },
  teleportTo(sess, p) { const f = sess.foot; f.p.x = p.x; f.p.z = p.z; this.fadeT = 0.3; this.pulse('right', 0.4, 20); },
};
export function installPlus(VR) { Object.assign(VR.prototype, Plus); }
