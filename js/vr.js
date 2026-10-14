// p52 WebXR VR (Meta Quest first): seated sim-racing cockpit as the main mode.
//  - head tracking in the driver's seat (B = recentre), car-locked or level horizon
//  - two-handed steering wheel: grab the rim with grip, real rotation range (360 / 540 / 900 deg), self-centring when let go,
//    force feel through controller haptics (self-aligning torque, tyre slip, kerbs / impacts, gear shifts)
//  - right trigger = throttle, left trigger = brake (analogue), A / X = shift up / down (or grab the gear lever and push / pull),
//    right stick click = handbrake, grab the door handle and pull to get out
//  - gloved hand meshes with finger poses (grip / trigger / wrapped round the rim), hand-tracking support (fist = grab)
//  - on foot: smooth stick locomotion relative to the head, snap or smooth turning, optional comfort vignette
//  - in-world dash panel (speed, gear, revs, sat-nav) and a laser-pointer VR menu (Y)
//  - performance first: no post chain in XR, fixed foveation, MSAA on the XR layer, Quest / Quest High / Ultra tiers,
//    an adaptive governor that trades foveation, shadows and draw distance to hold the headset refresh rate,
//    rear-view + side mirrors as small render targets on Ultra only
// Desktop preview without a headset: ?vrsim=1 (mono view from the seat, hands posed on the wheel) for screenshots / tests.
import * as THREE from 'three';
const UA = navigator.userAgent, QUEST3 = /Quest 3/i.test(UA), QUEST = /OculusBrowser|Quest/i.test(UA);
const TIERS = {
  quest: { label: 'Quest', fb: 1.0, fov: 1, hz: 72, g: { shadows: 0, reflections: 1, envDetail: 1, carDetail: 2, drawDist: 700, effects: 0, weatherFx: true }, mirrors: false },
  questHigh: { label: 'Quest High', fb: 1.15, fov: 0.7, hz: 90, g: { shadows: 1, reflections: 1, envDetail: 2, carDetail: 2, drawDist: 1100, effects: 0, weatherFx: true }, mirrors: false },
  ultra: { label: 'Ultra (PC VR)', fb: 1.4, fov: 0.3, hz: 90, g: { shadows: 2, reflections: 2, envDetail: 3, carDetail: 2, drawDist: 1600, effects: 0, weatherFx: true }, mirrors: true },
};
const DEF = { tier: QUEST3 ? 'questHigh' : QUEST ? 'quest' : 'ultra', range: 540, turn: 'snap', vignette: false, horizon: 'car', haptics: 1, mirrors: true, assist: false };
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// ---------------------------------------------------------------- gloved hand (palm + 5 jointed fingers)
function makeHand(side) {
  const g = new THREE.Group(); const s = side === 'left' ? -1 : 1;
  const leather = new THREE.MeshStandardMaterial({ color: 0x1a1a1d, roughness: 0.62, metalness: 0.05 }), trim = new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.5 }), knuckle = new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.45 });
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.026, 0.092), leather); palm.position.set(0, 0, -0.01); g.add(palm);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.06, 14), trim); cuff.rotation.x = Math.PI / 2; cuff.position.z = 0.065; cuff.scale.set(1.05, 1, 0.7); g.add(cuff);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.008, 0.05), knuckle); back.position.set(0, 0.016, -0.02); g.add(back);
  const fingers = [];
  const seg = (len, r) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 3, 8), leather); m.rotation.x = Math.PI / 2; m.position.z = -len / 2; return m; };
  const spec = [[-0.03, 0.040, 0.0085], [-0.010, 0.046, 0.0088], [0.010, 0.044, 0.0086], [0.029, 0.036, 0.0078]];
  for (const [x, L, r] of spec) { const root = new THREE.Group(); root.position.set(x * s, 0, -0.056); g.add(root); const ch = []; let par = root;
    for (let k = 0; k < 3; k++) { const j = new THREE.Group(); if (k) j.position.z = -L * (k === 1 ? 0.5 : 0.36); par.add(j); j.add(seg(L * (k === 0 ? 0.5 : k === 1 ? 0.36 : 0.28), r * (1 - k * 0.08))); ch.push(j); par = j; }
    fingers.push(ch); }
  const th = new THREE.Group(); th.position.set(-0.044 * s, -0.004, -0.012); th.rotation.set(0, 0.75 * s, 0); g.add(th); const tch = []; let tp = th;
  for (let k = 0; k < 2; k++) { const j = new THREE.Group(); if (k) j.position.z = -0.024; tp.add(j); j.add(seg(0.024, 0.0095)); tch.push(j); tp = j; }
  g.userData = { fingers, thumb: tch, side };
  g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
  return g;
}
// curls 0..1 per finger [index, middle, ring, little], thumb 0..1
function poseHand(h, curls, thumb) { const F = h.userData.fingers; for (let i = 0; i < 4; i++) { const c = curls[i]; F[i][0].rotation.x = -c * 1.25; F[i][1].rotation.x = -c * 1.45; F[i][2].rotation.x = -c * 1.1; }
  const T = h.userData.thumb, s = h.userData.side === 'left' ? -1 : 1; T[0].rotation.set(-thumb * 0.5, 0, thumb * 0.6 * s); T[1].rotation.x = -thumb * 0.9; }

// ---------------------------------------------------------------- canvas panels (dash HUD, menu)
function panel(w, h, pw, ph) { const c = document.createElement('canvas'); c.width = w; c.height = h; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false, depthTest: true })); m.renderOrder = 10; return { c, g: c.getContext('2d'), t, m }; }

export class VR {
  constructor(app) {
    this.app = app; this.active = false; this.sim = new URLSearchParams(location.search).get('vrsim') === '1';
    try { this.opt = { ...DEF, ...(JSON.parse(localStorage.getItem('cuzzy.vr') || '{}')) }; } catch (e) { this.opt = { ...DEF }; }
    this.supported = false; this.wheelA = 0; this.grab = {}; this.hands = {}; this.src = {}; this.prevBtn = {}; this.menuOn = false;
    if (navigator.xr?.isSessionSupported) navigator.xr.isSessionSupported('immersive-vr').then(ok => { this.supported = ok || this.sim; this.button(); }).catch(() => { });
    if (this.sim) this.supported = true; this.button();
  }
  save() { try { localStorage.setItem('cuzzy.vr', JSON.stringify(this.opt)); } catch (e) { } }
  // DOM entry button (menu + in game)
  button() { let b = document.getElementById('vr-btn'); if (!this.supported) { if (b) b.hidden = true; return; }
    if (!b) { b = document.createElement('button'); b.id = 'vr-btn'; b.textContent = 'ENTER VR'; b.style.cssText = 'position:fixed;left:50%;bottom:calc(14px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:45;height:46px;padding:0 20px;border-radius:14px;border:2px solid #19e6c1;background:rgba(0,0,0,.55);color:#fff;font:800 15px system-ui;letter-spacing:.06em';
      b.onclick = () => this.active ? this.exit() : this.enter(); document.body.appendChild(b); }
    b.hidden = false; }
  // ---------------------------------------------------------------- session
  async enter() {
    const A = this.app, G = A.gfx, r = G.r; if (this.active) return;
    if (!A.session) { const car = A.carsById?.[A.store?.profile?.selected] || A.cars[0]; A.launch({ mode: 'free', carObj: car, ups: A.store?.profile?.ups?.[car.id] || {}, custom: A.store?.profile?.custom?.[car.id] || {}, time: 'day', weather: 'dry' }); }
    const T = TIERS[this.opt.tier] || TIERS.quest; const g = A.settings.graphics; this.gSaved = { ...g }; Object.assign(g, T.g); this.ctlSaved = { steerAssist: A.settings.controls.steerAssist, smartThrottle: A.settings.controls.smartThrottle };
    if (!this.opt.assist) { A.settings.controls.steerAssist = 0; A.settings.controls.smartThrottle = false; } // sim feel: the wheel is the steering
    try { A.applyGraphics?.(); } catch (e) { }
    if (!this.sim) {
      let ses; try { ses = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'hand-tracking', 'layers'] }); } catch (e) { A.hud?.flash?.('VR not available: ' + e.message, 2); Object.assign(g, this.gSaved); return; }
      r.xr.enabled = true; r.xr.setReferenceSpaceType('local'); r.xr.setFramebufferScaleFactor(T.fb);
      // MSAA on the XR layer: three reads the GL context attributes when the session starts (the page canvas has AA off)
      const gl = r.getContext(), ga = gl.getContextAttributes.bind(gl); gl.getContextAttributes = () => ({ ...ga(), antialias: true });
      try { await r.xr.setSession(ses); } finally { gl.getContextAttributes = ga; }
      r.xr.setFoveation(T.fov); try { if (ses.supportedFrameRates?.includes?.(T.hz) || ses.updateTargetFrameRate) await ses.updateTargetFrameRate?.(T.hz); } catch (e) { }
      this.ses = ses; ses.addEventListener('end', () => this.cleanup());
      for (let i = 0; i < 2; i++) { const c = r.xr.getController(i), gr = r.xr.getControllerGrip(i), hd = r.xr.getHand(i);
        c.addEventListener('connected', e => { const s = e.data.handedness || (i ? 'right' : 'left'); this.src[s] = { input: e.data, ray: c, grip: gr, hand: hd }; this.addRay(c); });
        c.addEventListener('disconnected', e => { for (const k in this.src) if (this.src[k].ray === c) delete this.src[k]; }); }
    }
    this.build(); this.active = true; document.getElementById('vr-btn') && (document.getElementById('vr-btn').textContent = 'EXIT VR');
    const loop = t => { const dt = Math.min(0.1, Math.max(0, (t - (this.lt ?? t)) / 1000)); this.lt = t; try { A.tick(dt); } catch (e) { console.error(e); } this.govern(dt); A.gfx.frameDone?.(t, 0); };
    if (!this.sim) r.setAnimationLoop(loop);
    A.hud?.flash?.('VR: grip the wheel · triggers = pedals · B recentre · Y menu', 3); this.recentre(true);
  }
  exit() { if (this.ses) this.ses.end().catch(() => this.cleanup()); else this.cleanup(); }
  cleanup() { const A = this.app, G = A.gfx; if (!this.active) return; this.active = false; G.r.setAnimationLoop(null); G.r.xr.enabled = false;
    if (this.rig) { G.scene.remove(this.rig); } if (this.camParent !== undefined) { (this.camParent || G.scene).add?.(G.cam); if (!this.camParent) G.scene.remove(G.cam); } G.cam.position.set(0, 2, 5);
    if (this.gSaved) Object.assign(A.settings.graphics, this.gSaved); if (this.ctlSaved) Object.assign(A.settings.controls, this.ctlSaved); try { A.applyGraphics?.(); G.resize(); } catch (e) { }
    for (const m of this.mirrors || []) m.rt.dispose(); this.mirrors = null; this.ses = null; const b = document.getElementById('vr-btn'); if (b) b.textContent = 'ENTER VR'; }
  // ---------------------------------------------------------------- scene objects
  build() { const G = this.app.gfx; if (this.rig) G.scene.remove(this.rig);
    this.rig = new THREE.Group(); this.rig.name = 'vrRig'; this.seat = new THREE.Group(); this.rig.add(this.seat); G.scene.add(this.rig);
    this.camParent = G.cam.parent; this.seat.add(G.cam); G.cam.position.set(0, 0, 0); G.cam.quaternion.identity();
    for (const s of ['left', 'right']) { const h = makeHand(s); h.visible = false; this.seat.add(h); this.hands[s] = h; }
    for (const s in this.src) { this.seat.add(this.src[s].ray); this.seat.add(this.src[s].grip); this.seat.add(this.src[s].hand); }
    if (!this.sim) for (let i = 0; i < 2; i++) { const r = G.r.xr; this.seat.add(r.getController(i)); this.seat.add(r.getControllerGrip(i)); this.seat.add(r.getHand(i)); }
    this.dash = panel(768, 288, 0.34, 0.1275); this.rig.add(this.dash.m);
    this.menu = panel(1024, 768, 0.8, 0.6); this.menu.m.visible = false; this.menu.m.material.depthTest = false; this.menu.m.renderOrder = 20; this.seat.add(this.menu.m);
    // comfort vignette + fade (camera-locked)
    const vg = new THREE.Mesh(new THREE.RingGeometry(0.16, 1.2, 48), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0, depthTest: false, toneMapped: false })); vg.position.z = -0.25; vg.renderOrder = 20; G.cam.add(vg); this.vig = vg;
    const fd = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 8), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, toneMapped: false })); fd.renderOrder = 21; G.cam.add(fd); this.fade = fd; this.fadeT = 0;
    this.carKey = null; this.drawMenu(); }
  addRay(c) { if (c.userData.ray) return; const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0x19e6c1, transparent: true, opacity: 0.8 })); l.scale.z = 2; l.visible = false; c.add(l); c.userData.ray = l; }
  // per car: wheel frame, gear lever, door handle, mirrors (car-body local)
  fitCar(sess) { const u = sess.obj.userData; const key = sess.car?.id + ':' + sess.obj.uuid; if (this.carKey === key) return; this.carKey = key; const body = u.body || sess.obj;
    for (const o of this.carObjs || []) o.parent?.remove(o); this.carObjs = [];
    const eye = (u.cockpit || new THREE.Vector3(0.38, 1.05, 0.2)).clone(); this.eye = eye;
    // wheel centre / axis in body space: the model's own wheel if it has one, else a VR wheel
    body.updateMatrixWorld(true); const inv = _m.copy(body.matrixWorld).invert();
    let wc = null; if (u.steeringWheel) { wc = new THREE.Box3().setFromObject(u.steeringWheel).getCenter(new THREE.Vector3()).applyMatrix4(inv); if (!(Math.abs(wc.x - eye.x) < 0.3 && wc.z < eye.z && eye.z - wc.z < 0.9)) wc = null; }
    this.ownWheel = !!wc; if (!wc) wc = new THREE.Vector3(eye.x, eye.y - 0.32, eye.z - 0.44);
    this.wc = wc; this.wAxis = new THREE.Vector3(0, Math.sin(0.38), Math.cos(0.38)).normalize(); this.wR = this.ownWheel ? 0.18 : 0.185; // axis towards the driver, tilted ~22 deg
    if (!this.ownWheel) { const w = new THREE.Group(); const mat = new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.55 }), al = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.9, roughness: 0.3 });
      w.add(new THREE.Mesh(new THREE.TorusGeometry(this.wR, 0.016, 10, 48), mat)); for (const a of [0, 2.1, -2.1]) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.02, this.wR, 0.012), al); sp.position.set(Math.sin(a) * this.wR / 2, -Math.cos(a) * this.wR / 2, 0); sp.rotation.z = a; w.add(sp); }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.03, 18), mat); hub.rotation.x = Math.PI / 2; w.add(hub); const mk = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.02), new THREE.MeshBasicMaterial({ color: 0xffd23f })); mk.position.y = this.wR; w.add(mk);
      const piv = new THREE.Group(); piv.position.copy(wc); piv.lookAt(_v.copy(wc).add(this.wAxis)); piv.add(w); body.add(piv); this.vrWheel = w; this.carObjs.push(piv); } else this.vrWheel = null;
    // gear lever (centre console) and door handle
    const lv = new THREE.Group(); lv.position.set(eye.x * 0.3, eye.y - 0.55, eye.z - 0.22); const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.011, 0.16, 8), new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.4 })); stick.position.y = 0.08; lv.add(stick);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.024, 14, 10), new THREE.MeshStandardMaterial({ color: 0xd8d8dc, metalness: 0.8, roughness: 0.25 })); knob.position.y = 0.165; lv.add(knob); body.add(lv); this.lever = lv; this.carObjs.push(lv);
    this.door = new THREE.Vector3(eye.x + Math.sign(eye.x || 1) * 0.42, eye.y - 0.28, eye.z - 0.12);
    // dash panel just above the instrument binnacle
    this.dashPos = new THREE.Vector3(wc.x, wc.y + 0.2, wc.z - 0.14);
    if (this.opt.mirrors && TIERS[this.opt.tier]?.mirrors) this.makeMirrors(body, eye, u); }
  makeMirrors(body, eye, u) { const W = (u.dims?.W || 1.9) / 2; this.mirrors = [];
    for (const [nm, pos, w, h, rw] of [['rear', [0, eye.y + 0.14, eye.z - 0.5], 0.26, 0.07, 384], ['L', [-W - 0.06, eye.y - 0.1, eye.z - 0.42], 0.16, 0.1, 192], ['R', [W + 0.06, eye.y - 0.1, eye.z - 0.42], 0.16, 0.1, 192]]) {
      const rt = new THREE.WebGLRenderTarget(rw, Math.round(rw * h / w), { samples: 0 }); rt.texture.colorSpace = THREE.SRGBColorSpace;
      const q = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: rt.texture, toneMapped: false })); q.position.set(...pos); q.scale.x = -1; // mirror image
      body.add(q); this.carObjs.push(q); const cam = new THREE.PerspectiveCamera(nm === 'rear' ? 28 : 34, w / h, 0.3, 400); cam.position.set(...pos); cam.rotation.y = Math.PI + (nm === 'L' ? -0.18 : nm === 'R' ? 0.18 : 0); body.add(cam); this.carObjs.push(cam);
      this.mirrors.push({ rt, q, cam }); } this.mirN = 0; }
  // ---------------------------------------------------------------- per frame (called at the end of the game's camera update)
  update(dt, sess) { const G = this.app.gfx, cam = G.cam, S = sess.S, u = sess.obj.userData; if (!this.rig) return;
    cam.position.set(0, 0, 0); cam.quaternion.identity(); if (this.sim) cam.fov = 90, cam.updateProjectionMatrix();
    const foot = sess.foot?.active; this.fitCar(sess);
    if (sess.camMode !== 'cockpit') sess.camMode = 'cockpit';
    if (u.body) u.body.visible = true; const ck = document.getElementById('ckov'); if (ck) ck.style.display = 'none';
    if (u.driverMesh) u.driverMesh.visible = false;
    const body = u.body || sess.obj; body.updateMatrixWorld(true);
    if (foot) { const f = sess.foot, p = f.p; this.rig.position.set(p.x, p.y + 1.62, p.z); this.rig.quaternion.setFromAxisAngle(_v.set(0, 1, 0), this.footYaw ?? (this.footYaw = f.yaw)); if (f.char) f.char.visible = false; }
    else { const eyeW = _v.copy(this.eye).applyMatrix4(body.matrixWorld); this.rig.position.copy(eyeW);
      body.getWorldQuaternion(_q); if (this.opt.horizon === 'level') { const e = new THREE.Euler().setFromQuaternion(_q, 'YXZ'); _q.setFromEuler(e.set(0, e.y, 0, 'YXZ')); } this.rig.quaternion.copy(_q); }
    // dash panel in body space -> world (only while driving)
    this.dash.m.visible = !foot; if (!foot) { this.dash.m.position.copy(this.dashPos).sub(this.eye); this.dash.m.quaternion.identity(); this.dash.m.rotation.x = -0.25; }
    this.inputs(dt, sess, foot); this.handsFrame(dt, sess, foot); this.mirrorFrame();
    if ((this.dashT = (this.dashT || 0) + dt) > 0.066) { this.dashT = 0; this.drawDash(sess); }
    if (this.fadeT > 0) { this.fadeT -= dt; } this.fade.material.opacity = clamp(this.fadeT / 0.25, 0, 1);
    this.vig.material.opacity += ((this.opt.vignette ? this.vigWant || 0 : 0) * 0.85 - this.vig.material.opacity) * Math.min(1, dt * 6); }
  // controller / hand state, world (seat) positions
  pad(s) { return this.src[s]?.input?.gamepad || null; }
  btn(s, i) { const g = this.pad(s); return g?.buttons?.[i]?.pressed || false; }
  val(s, i) { const g = this.pad(s); return g?.buttons?.[i]?.value || 0; }
  edge(s, i) { const k = s + i, now = this.btn(s, i), was = this.prevBtn[k]; this.prevBtn[k] = now; return now && !was; }
  handPos(s, out) { const S = this.src[s]; if (this.sim) return out.copy(this.simHand(s)); if (!S) return null; const hd = S.input?.hand;
    if (hd && S.hand?.joints?.['middle-finger-metacarpal']) { S.hand.joints['middle-finger-metacarpal'].getWorldPosition(out); return out; } S.grip.getWorldPosition(out); return out; }
  handGrab(s) { if (this.sim) return 1; const S = this.src[s]; if (!S) return 0; if (S.input?.hand) return this.fist(s) > 0.65 ? 1 : 0; return this.val(s, 1); }
  fist(s) { const J = this.src[s]?.hand?.joints; if (!J?.wrist) return 0; const w = J.wrist.getWorldPosition(_v2); let c = 0, n = 0; for (const f of ['index', 'middle', 'ring', 'pinky']) { const t = J[f + '-finger-tip']; if (t) { c += clamp(1 - (t.getWorldPosition(new THREE.Vector3()).distanceTo(w) - 0.07) / 0.09, 0, 1); n++; } } return n ? c / n : 0; }
  inputs(dt, sess, foot) {
    if (this.sim) return; const R = 'right', L = 'left';
    if (this.edge(L, 5)) { this.menuOn = !this.menuOn; this.menu.m.visible = this.menuOn; if (this.menuOn) { this.menu.m.position.set(0, -0.1, -0.85); this.drawMenu(); } }
    if (this.edge(R, 5)) this.recentre();
    for (const s of [L, R]) { const ray = this.src[s]?.ray?.userData?.ray; if (ray) ray.visible = this.menuOn; }
    if (this.menuOn) { this.menuPointer(); return; }
    if (foot) { const f = sess.foot, g = this.pad(L), gr = this.pad(R); const ax = g?.axes || [], ar = gr?.axes || [];
      const head = this.headYaw(); f.cy = head; f.joy.x = Math.abs(ax[2] || 0) > 0.12 ? ax[2] : 0; f.joy.y = Math.abs(ax[3] || 0) > 0.12 ? ax[3] : 0; f.run = this.btn(L, 3);
      const tx = ar[2] || 0; if (this.opt.turn === 'snap') { if (Math.abs(tx) > 0.7 && !this.snapHeld) { this.snapHeld = true; this.footYaw = (this.footYaw || 0) - Math.sign(tx) * Math.PI / 6; this.fadeT = Math.max(this.fadeT, 0.12); } if (Math.abs(tx) < 0.3) this.snapHeld = false; }
      else if (Math.abs(tx) > 0.15) this.footYaw = (this.footYaw || 0) - tx * dt * 2.2;
      this.vigWant = Math.hypot(f.joy.x, f.joy.y) > 0.2 || (this.opt.turn !== 'snap' && Math.abs(tx) > 0.15) ? 1 : 0;
      if (this.edge(R, 4)) { const was = f.active; f.action(); if (was && !f.active) { this.fadeT = 0.5; this.pulse(R, 0.5, 40); } }
      return; }
    this.vigWant = 0; this.footYaw = undefined;
    if (this.edge(R, 4)) { sess.inp.shiftUp = 1; this.pulse(R, 0.7, 25); } if (this.edge(L, 4)) { sess.inp.shiftDown = 1; this.pulse(L, 0.7, 25); }
  }
  headYaw() { const c = this.app.gfx.r.xr.isPresenting ? this.app.gfx.r.xr.getCamera() : this.app.gfx.cam; c.getWorldDirection(_v); return Math.atan2(-_v.x, -_v.z) ; }
  // called from Game.readInput after its own mapping: VR pedals / wheel take over
  input(sess, dt) { if (!this.active || sess.foot?.active) return; const i = sess.inp, R = 'right', L = 'left';
    if (this.menuOn) { i.throttle = 0; i.brake = 0.3; return; }
    const thr = this.sim ? i.throttle : this.val(R, 0), brk = this.sim ? i.brake : this.val(L, 0);
    if (!this.sim) { i.throttle = thr; i.brake = brk; if (sess.S.reverse && !i.hPattern) { i.throttle = brk; i.brake = thr; } i.handbrake = this.btn(R, 3) ? 1 : 0; }
    const half = this.opt.range * Math.PI / 360; const anyGrab = this.grab.left || this.grab.right;
    if (this.sim) { } else if (anyGrab) i.steer = clamp(this.wheelA / half, -1, 1);
    else { const ax = this.pad(L)?.axes?.[2] || 0; if (Math.abs(ax) > 0.08) { i.steer = -ax; this.wheelA = -ax * half; } else i.steer = clamp(this.wheelA / half, -1, 1); }
    if (this.sim) this.wheelA += (i.steer * half - this.wheelA) * Math.min(1, dt * 8); // keyboard drives the preview wheel
  }
  // wheel geometry in world space
  wheelFrame(sess) { const body = sess.obj.userData.body || sess.obj; const C = _v.copy(this.wc).applyMatrix4(body.matrixWorld).clone(); body.getWorldQuaternion(_q); const ax = this.wAxis.clone().applyQuaternion(_q);
    const up = new THREE.Vector3(0, Math.cos(0.38), -Math.sin(0.38)).applyQuaternion(_q), right = new THREE.Vector3().crossVectors(up, ax).normalize(); return { C, ax, up, right }; }
  angOn(F, p) { const d = _v2.copy(p).sub(F.C); return Math.atan2(d.dot(F.right), d.dot(F.up)); } // 0 = top of the rim, + = clockwise from the driver's view
  handsFrame(dt, sess, foot) { const F = foot ? null : this.wheelFrame(sess); const S = sess.S; let torque = 0; const half = this.opt.range * Math.PI / 360;
    for (const s of ['left', 'right']) { const h = this.hands[s], src = this.src[s]; const hasHand = !!src?.input?.hand; h.visible = this.sim || (!!src && (!foot || !hasHand));
      if (!h.visible) continue; const p = this.handPos(s, new THREE.Vector3()); if (!p) { h.visible = false; continue; }
      const grabV = this.handGrab(s), G = this.grab[s];
      if (!foot && F) { const d = _v2.copy(p).sub(F.C), along = d.dot(F.ax), rad = Math.hypot(d.dot(F.right), d.dot(F.up));
        if (!G && grabV > 0.6 && Math.abs(along) < 0.09 && Math.abs(rad - this.wR) < 0.09) { this.grab[s] = { a0: this.angOn(F, p), w0: this.wheelA, last: this.angOn(F, p), acc: 0 }; this.pulse(s, 0.35, 18); }
        else if (G && grabV < 0.35) { this.grab[s] = null; this.pulse(s, 0.15, 10); }
        // gear lever: grab near the knob and push forward / pull back
        const lvW = this.lever.localToWorld(new THREE.Vector3(0, 0.165, 0)); if (!G && s === 'right' && grabV > 0.6 && p.distanceTo(lvW) < 0.08 && !this.lvGrab) { this.lvGrab = { z0: this.toBody(sess, p).z }; this.pulse(s, 0.3, 15); }
        if (this.lvGrab && s === 'right') { if (grabV < 0.35) { this.lvGrab = null; this.lever.rotation.x = 0; } else { const dz = this.toBody(sess, p).z - this.lvGrab.z0; this.lever.rotation.x = clamp(dz * 5, -0.35, 0.35);
          if (dz < -0.06) { sess.inp.shiftUp = 1; this.lvGrab.z0 -= 0.12; this.pulse(s, 0.9, 30); } if (dz > 0.06) { sess.inp.shiftDown = 1; this.lvGrab.z0 += 0.12; this.pulse(s, 0.9, 30); } } }
        // door handle: grab and pull towards you / outwards -> get out
        const dW = _v2.copy(this.door).applyMatrix4((sess.obj.userData.body || sess.obj).matrixWorld); if (!G && grabV > 0.6 && p.distanceTo(dW) < 0.12 && Math.abs(S.vx) < 2) { this.doorT = (this.doorT || 0) + dt; if (this.doorT > 0.35) { this.doorT = 0; this.pulse(s, 1, 60); this.fadeT = 0.6; sess.foot?.exitCar(); } } }
      const Gn = this.grab[s];
      if (Gn && F) { let a = this.angOn(F, p), da = a - Gn.last; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; Gn.acc += da; Gn.last = a; }
      // hand mesh: on the rim while gripping, else at the controller / tracked hand
      if (Gn && F) { const ang = Gn.a0 + (this.wheelA - Gn.w0); const rp = F.C.clone().addScaledVector(F.up, Math.cos(ang) * this.wR).addScaledVector(F.right, Math.sin(ang) * this.wR); this.seat.worldToLocal(rp); h.position.copy(rp);
        const radial = F.up.clone().multiplyScalar(Math.cos(ang)).addScaledVector(F.right, Math.sin(ang)); const look = new THREE.Matrix4().lookAt(new THREE.Vector3(), F.ax.clone().negate(), radial); const wq = new THREE.Quaternion().setFromRotationMatrix(look);
        this.seat.getWorldQuaternion(_q); h.quaternion.copy(_q.invert().multiply(wq)); h.rotateZ(s === 'left' ? -1.2 : 1.2); poseHand(h, [0.82, 0.86, 0.88, 0.9], 0.75); }
      else { const sp = this.seat.worldToLocal(p.clone()); h.position.copy(sp); const ob = this.sim ? null : (src?.grip || null); if (ob) { ob.getWorldQuaternion(_q); const sq = this.seat.getWorldQuaternion(new THREE.Quaternion()).invert(); h.quaternion.copy(sq.multiply(_q)); h.rotateX(-0.5); }
        const gr = this.sim ? 0 : hasHand ? this.fist(s) : this.val(s, 1), tr = this.sim ? 0 : hasHand ? gr : this.val(s, 0); poseHand(h, [tr * 0.9, gr, gr, gr], Math.max(gr, this.btn(s, 3) || this.btn(s, 4) || this.btn(s, 5) ? 0.6 : 0) * 0.8); } }
    if (foot || !F) return;
    // wheel angle: average of the grabbing hands' travel round the rim; self-centring when released
    const gs = ['left', 'right'].filter(s => this.grab[s]);
    if (gs.length) { let sum = 0; for (const s of gs) sum += this.grab[s].acc; const tgt = this.grab[gs[0]].w0 + sum / gs.length; this.wheelA = clamp(tgt, -half, half); if (Math.abs(tgt) > half) for (const s of gs) this.pulse(s, 0.6, 12); /* end stop */ }
    else if (!this.sim) { const k = 2.5 + Math.min(6, Math.abs(S.vx) * 0.25); this.wheelA -= this.wheelA * Math.min(1, k * dt); }
    // visual wheel
    const tw = this.ownWheel ? sess.obj.userData.steeringWheel : this.vrWheel; if (tw) { if (this.ownWheel && sess.obj.userData.swAxis) tw.quaternion.setFromAxisAngle(sess.obj.userData.swAxis, -this.wheelA); else if (this.ownWheel) tw.rotation.z = this.wheelA; else tw.rotation.z = -this.wheelA; }
    // force feel: self-aligning torque grows with speed and lock, tyre slip and impacts add texture
    const v = Math.abs(S.vx), slip = clamp(Math.abs(S.vy || 0) / Math.max(4, v), 0, 1), sat = clamp(v / 30, 0, 1) * clamp(Math.abs(this.wheelA) / half * 2.5, 0, 1);
    torque = sat * 0.35 + slip * 0.55 + clamp((sess.shake || 0) * 2, 0, 1) + (v > 3 && sess.w?.offRoad?.(S.x, S.z, S.y) ? 0.3 : 0);
    this.hapT = (this.hapT || 0) + dt; if (this.hapT > 0.05 && torque > 0.04) { this.hapT = 0; for (const s of gs) this.pulse(s, torque, 50); } }
  toBody(sess, p) { const body = sess.obj.userData.body || sess.obj; return body.worldToLocal(p.clone()); }
  pulse(s, k, ms) { if (!this.opt.haptics) return; const a = this.pad(s)?.hapticActuators?.[0] || this.src[s]?.input?.gamepad?.vibrationActuator; try { a?.pulse ? a.pulse(clamp(k * this.opt.haptics, 0, 1), ms) : a?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: k }); } catch (e) { } }
  // desktop preview hands: on the rim at ten-to-two
  simHand(s) { const sess = this.app.session; const F = this.wheelFrame(sess); const a = (s === 'left' ? -1.05 : 1.05) + this.wheelA; return F.C.clone().addScaledVector(F.up, Math.cos(a) * this.wR).addScaledVector(F.right, Math.sin(a) * this.wR); }
  recentre(first) { if (this.sim || !this.app.gfx.r.xr.isPresenting) { this.seat?.position.set(0, 0, 0); return; } const xc = this.app.gfx.r.xr.getCamera(); const run = () => { this.seat.updateMatrixWorld(true);
      const local = this.seat.worldToLocal(xc.getWorldPosition(new THREE.Vector3())).add(this.seat.position.clone().negate()); // head relative to the seat origin, minus current offset
      const hl = xc.getWorldDirection(new THREE.Vector3()); this.rig.worldToLocal(hl.add(this.rig.getWorldPosition(new THREE.Vector3()))); const yaw = Math.atan2(-hl.x, -hl.z);
      this.seat.rotation.y = -yaw; this.seat.updateMatrix(); const off = local.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw); this.seat.position.copy(off.negate()); this.app.hud?.flash?.('Seat recentred', 0.8); };
    if (first) setTimeout(run, 600); else run(); }
  // ---------------------------------------------------------------- mirrors (Ultra): one mirror per frame, half-rate each
  mirrorFrame() { if (!this.mirrors?.length) return; const G = this.app.gfx, r = G.r; const m = this.mirrors[this.mirN++ % this.mirrors.length]; const xr = r.xr.enabled, rtOld = r.getRenderTarget();
    r.xr.enabled = false; r.setRenderTarget(m.rt); const sh = r.shadowMap.autoUpdate; r.shadowMap.autoUpdate = false; m.q.visible = false; r.render(G.scene, m.cam); m.q.visible = true; r.shadowMap.autoUpdate = sh; r.setRenderTarget(rtOld); r.xr.enabled = xr; }
  // ---------------------------------------------------------------- adaptive governor: hold the headset refresh rate
  govern(dt) { const T = TIERS[this.opt.tier] || TIERS.quest, tgt = 1 / T.hz; this.gw = (this.gw || 0) * 0.95 + dt * 0.05; this.gT = (this.gT || 0) + dt; if (this.gT < 2) return; this.gT = 0;
    const g = this.app.settings.graphics, r = this.app.gfx.r; if (this.gw > tgt * 1.12) { this.lvl = (this.lvl || 0) + 1;
      if (this.lvl === 1) r.xr.setFoveation(1); else if (this.lvl === 2 && g.shadows) { g.shadows = 0; this.app.applyGraphics?.(); } else if (this.lvl === 3 && g.drawDist > 600) { g.drawDist = Math.max(500, g.drawDist - 300); this.app.applyGraphics?.(); } else if (this.lvl === 4 && this.mirrors) { this.mirrors.forEach(m => m.q.visible = false); this.mirrors = []; }
      console.log('vr governor', this.lvl, (1 / this.gw).toFixed(0) + ' fps'); } }
  // ---------------------------------------------------------------- panels
  drawDash(sess) { const { g, c, t } = this.dash, S = sess.S, P = sess.P || {}; const mph = Math.abs(S.vx) * 2.237, units = this.app.settings.game?.units === 'kmh' ? 'km/h' : 'mph', sp = units === 'mph' ? mph : Math.abs(S.vx) * 3.6;
    g.clearRect(0, 0, c.width, c.height); g.fillStyle = 'rgba(8,10,14,.78)'; g.beginPath(); g.roundRect(4, 4, c.width - 8, c.height - 8, 26); g.fill(); g.strokeStyle = 'rgba(25,230,193,.6)'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#fff'; g.font = '800 120px system-ui'; g.textAlign = 'right'; g.fillText(Math.round(sp), 300, 150); g.font = '700 30px system-ui'; g.fillStyle = '#9fb'; g.fillText(units, 300, 190);
    const gear = S.reverse ? 'R' : Math.abs(S.vx) < 0.3 && (sess.inp?.throttle || 0) < 0.05 ? 'N' : S.gear; g.textAlign = 'center'; g.fillStyle = '#19e6c1'; g.font = '900 110px system-ui'; g.fillText(gear, 400, 150);
    const red = P.redline || 7000, rpm = S.rpm || 0, k = clamp(rpm / red, 0, 1.05); g.fillStyle = '#222'; g.fillRect(40, 220, 688, 26); g.fillStyle = k > 0.92 ? '#ff3b3b' : k > 0.8 ? '#ffd23f' : '#19e6c1'; g.fillRect(40, 220, 688 * Math.min(1, k), 26);
    const nv = sess.foot?.nav; const el = nv?.el; if (el && nv.route) { g.textAlign = 'left'; g.fillStyle = '#ffc531'; g.font = '800 46px system-ui'; g.fillText((el.ar.textContent || '') + ' ' + (el.d.textContent || ''), 470, 100); g.fillStyle = '#fff'; g.font = '600 30px system-ui'; g.fillText((el.t.textContent || '').slice(0, 22), 470, 150); }
    else if (sess.envCycle) { g.textAlign = 'left'; g.fillStyle = '#cfd8e3'; g.font = '700 40px system-ui'; g.fillText(sess.envCycle.clock(), 470, 100); g.font = '600 30px system-ui'; g.fillText(sess.envCycle.weather, 470, 145); }
    t.needsUpdate = true; }
  menuItems() { const o = this.opt; return [
    ['Resume', () => { this.menuOn = false; this.menu.m.visible = false; }],
    ['Recentre seat', () => this.recentre()],
    ['Wheel rotation: ' + o.range + '°', () => { o.range = o.range === 360 ? 540 : o.range === 540 ? 900 : 360; }],
    ['Horizon: ' + (o.horizon === 'car' ? 'locked to car' : 'level'), () => { o.horizon = o.horizon === 'car' ? 'level' : 'car'; }],
    ['Turning on foot: ' + (o.turn === 'snap' ? 'snap 30°' : 'smooth'), () => { o.turn = o.turn === 'snap' ? 'smooth' : 'snap'; }],
    ['Comfort vignette: ' + (o.vignette ? 'on' : 'off'), () => { o.vignette = !o.vignette; }],
    ['Haptics: ' + (o.haptics ? Math.round(o.haptics * 100) + '%' : 'off'), () => { o.haptics = o.haptics >= 1 ? 0 : o.haptics ? 1 : 0.5; }],
    ['Driving aids: ' + (o.assist ? 'on' : 'off (sim)'), () => { o.assist = !o.assist; this.app.settings.controls.steerAssist = o.assist ? this.ctlSaved?.steerAssist ?? 0.6 : 0; this.app.settings.controls.smartThrottle = o.assist; }],
    ['Graphics: ' + TIERS[o.tier].label + ' (next VR start)', () => { o.tier = o.tier === 'quest' ? 'questHigh' : o.tier === 'questHigh' ? 'ultra' : 'quest'; }],
    ['Mirrors (Ultra): ' + (o.mirrors ? 'on' : 'off'), () => { o.mirrors = !o.mirrors; this.carKey = null; }],
    ['Exit VR', () => this.exit()]]; }
  drawMenu() { if (!this.menu) return; const { g, c, t } = this.menu; const it = this.menuItems(); g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(10,12,16,.92)'; g.beginPath(); g.roundRect(0, 0, c.width, c.height, 36); g.fill(); g.fillStyle = '#19e6c1'; g.font = '900 52px system-ui'; g.textAlign = 'left'; g.fillText('CUZZY RACING · VR', 48, 76);
    this.menuRects = []; it.forEach(([label], i) => { const x = 48 + (i % 2) * 476, y = 112 + Math.floor(i / 2) * 106, w = 452, h = 88; this.menuRects.push([x, y, w, h]);
      g.fillStyle = this.menuHover === i ? '#19e6c1' : 'rgba(255,255,255,.08)'; g.beginPath(); g.roundRect(x, y, w, h, 18); g.fill(); g.fillStyle = this.menuHover === i ? '#000' : '#fff'; g.font = '700 30px system-ui'; g.fillText(label, x + 22, y + 56); });
    t.needsUpdate = true; }
  menuPointer() { const rc = new THREE.Raycaster(); let hov = -1, who = null;
    for (const s of ['right', 'left']) { const ray = this.src[s]?.ray; if (!ray) continue; ray.updateMatrixWorld(); rc.ray.origin.setFromMatrixPosition(ray.matrixWorld); rc.ray.direction.set(0, 0, -1).transformDirection(ray.matrixWorld);
      const h = rc.intersectObject(this.menu.m)[0]; if (!h?.uv) continue; const x = h.uv.x * 1024, y = (1 - h.uv.y) * 768; const i = (this.menuRects || []).findIndex(([a, b, w, hh]) => x >= a && x <= a + w && y >= b && y <= b + hh); if (i >= 0) { hov = i; who = s; break; } }
    if (hov !== this.menuHover) { this.menuHover = hov; this.drawMenu(); if (hov >= 0) this.pulse(who, 0.15, 8); }
    for (const s of ['right', 'left']) if (this.edge(s, 0) && hov >= 0 && s === who) { this.menuItems()[hov][1](); this.save(); this.pulse(s, 0.5, 20); this.drawMenu(); } }
  // test / preview hook
  async preview() { this.sim = true; await this.enter(); }
}
