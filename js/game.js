// Driving session: physics integration with the Birmingham world, cameras, HUD, controls, checkpoints, pause
// behaviour (solo freezes, online keeps running), remote players and rewards.
import { padSteer, padPedal } from './rumble.js';
import * as THREE from 'three';
import { deriveParams, newState, step, mph, velocityWorld } from '../shared/physics.js';
import { hoverStep } from './hover.js';
import { buildCar, setLights, poseCar } from './carmodel.js';
import { AIField, aiWanted } from './ai.js';
import { readWheel, standardPad } from './wheel.js';
import { CockpitInstruments } from './cockpit.js';
import { KittDash, KittTVs } from './kittdash.js';
import { Gadgets } from './gadgets.js';
import { DB5Interior } from './db5int.js';
import { OnFoot } from './onfoot.js';
import { Environment } from './daynight-weather.js';
import { TIERS, resolvedPreset, applyPreset, IS_MOBILE as _MOB } from './settings.js';

const DT = 1 / 120;
// optional CPU profiler (tests / ?prof): CZPROF.on = true accumulates ms per subsystem
const PF = globalThis.CZPROF || (globalThis.CZPROF = { on: false, acc: {}, n: 0 });
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(); // per-frame temporaries (no allocation in the frame loop)
const pmk = (k, t0) => { const t = performance.now(); PF.acc[k] = (PF.acc[k] || 0) + t - t0; return t; };
const STEP = 0.6; // largest height step a wheel may take between physics steps (the map has small steps where road pieces overlap)
const TYRE_BOX = 0.9; // the tyres must stay on the road: bumpers / mirrors may overhang the kerb by a few cm (solids use the full body)
const POSE_PTS = [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1], [0, 1], [0, -1], [1, 0], [-1, 0]]; // centre, corners, side and end mid-points
const _UPL = new THREE.Vector3(0, 1, 0);
const CAMS = ['chase', 'cockpit', 'bonnet', 'orbit'];
const CK_CLONE = new WeakMap(), CK_ORIG = new WeakMap(); // cockpit-view glass material swaps
export const CAM_NAMES = { chase: 'Chase', cockpit: 'Cockpit', bonnet: 'Bonnet', orbit: 'Free 360°' };

export class Session {
  // opts: {mode:'free'|'sprint'|'circuit'|'trial'|'meet'|'test'|'tutorial', route, laps, online, car, ups, custom, time, weather, net, slot, raceNo, t0}
  constructor(app, opts) {
    this.app = app; this.o = opts; this.g = app.gfx; this.w = app.world; this.s = app.settings; this.a = app.audio;
    this.scene = this.g.scene; this.online = !!opts.online; this.paused = false; this.over = false;
    this.inp = { throttle: 0, brake: 0, steer: 0, handbrake: 0, shiftUp: 0, shiftDown: 0, reverseToggle: 0, wantReverse: 1, wantForward: 1 };
    this.keys = new Set(); this.touch = {}; this.camMode = this.s.controls.camera || 'chase'; this.orbit = { yaw: 0, pitch: 0.2, dist: 6.2 };
    this.remotes = new Map(); this.t = 0; this.raceT = 0; this.splits = []; this.cp = 0; this.lap = 1; this.flames = [];
    this.lastSent = 0; this.lastAct = 0; this.driveKm = 0; this.hud = app.hud; this.group = new THREE.Group(); this.scene.add(this.group);
    this.route = opts.route ? app.routes.routes.find(r => r.id === opts.route) : null;
    this.isRace = ['sprint', 'circuit', 'trial'].includes(opts.mode) && this.route;
    this.w.setRaceKit?.(this.isRace ? this.route.id : null); // barriers + lane lines for this race only
    this.laps = this.route?.mode === 'circuit' ? (opts.laps || this.route.laps) : 1;
    this.cps = this.isRace ? Array.from({ length: this.laps }, () => this.route.cps).flat() : [];
    this.setCar(opts.car, opts.ups, opts.custom);
    const aiOn = this.isRace && aiWanted(opts) && opts.ai?.field?.length; // solo sprint / circuit opponents (never online)
    if (aiOn && opts.slot == null) this.o = opts = { ...opts, slot: Math.min(this.route.grid.length - 1, opts.ai.field.length) }; // player starts behind the AI
    this.spawn(opts.at);
    this.g.setTOD(opts.time || 'day', opts.weather === 'rain');
    this.a.setRain(opts.weather === 'rain'); this.wet = opts.weather === 'rain' ? 1 : 0;
    // p51: continuous 12-minute day/night + weather cycle in free roam / open world / meets (races keep the chosen setup)
    this.envCycle = null; if (!this.isRace && this.s.graphics.dayCycle !== false) try { this.envCycle = new Environment(THREE, { tod: { day: 0.55, sunset: 0.745, night: 0.95 }[opts.time || 'day'] ?? 0.55, weather: opts.weather === 'rain' ? 'rain' : 'clear' }); this.envW = this.envCycle.weather; } catch (e) { console.warn('env cycle', e); }
    this.w.update(0, this.g.night, this.wet);
    this.buildGates(); this.bindInput();
    if (aiOn) this.ai = new AIField(this, opts.ai);
    this.state = this.isRace ? 'countdown' : 'drive';
    this.countStart = this.online ? null : performance.now() / 1000 + 0.6;
    if (this.online) { this.bindNet(); }
    this.hud.show(this);
    if (!this.isRace) try { this.foot = new OnFoot(this); } catch (e) { console.warn('on foot', e); } /* get out and walk: free roam, open world, meets */
  }
  setCar(car, ups = {}, custom = {}) {
    if (this.obj) { this.group.remove(this.obj); this.eng?.stop(); }
    this.car = car; this.ups = ups; this.custom = custom;
    this.P = deriveParams(car, ups, this.app.calib[car.id] || {});
    this.obj = buildCar(car, { detail: this.s.graphics.carDetail, colour: custom.colour ?? car.colour, wheel: custom.wheel, tint: custom.tint, caliper: custom.caliper, finish: custom.finish, plate: 'CUZZY' });
    this.obj.traverse(o => { if (o.isMesh) o.castShadow = this.s.graphics.shadows > 0; });
    this.group.add(this.obj);
    car._up = ups; this.eng = this.a.ready ? this.a.createEngine(car, 'me') : null; if (this.eng) this.eng.stop = this.eng.stop;
    this.conv = !!car.conv; // convertibles (incl. the featured DB9 Volante) are always driven roof-down
  }
  spawn(at) {
    let x, z, yaw, h = 0;
    { const m = this.app.routes.meet; if (at && m && Math.hypot(at.x - m.x, at.z - m.z) < 80) at = null; } // the car-meet pad is boxed in: spawn on the open road instead
    if (at) ({ x, z, yaw, h } = at);
    else if (this.route) { const g = this.route.grid[(this.o.slot || 0) % this.route.grid.length]; [x, z, yaw] = g; h = this.w.groundAt(x, z, 0).h ?? 0; }
    else { const m = this.app.routes.meet; const sl = this.o.slot || 0; x = m.x + (sl % 4) * 5 - 7; z = m.z + Math.floor(sl / 4) * 8; yaw = 0; h = this.w.groundAt(x, z, 0).h ?? 0; { const g = this.app.routes.routes[0].grid[sl % 8]; [x, z, yaw] = g; h = this.w.groundAt(x, z, 0).h ?? 0; } }
    this.S = newState(x, z, yaw); this.S.y = h; this.S.vyv = 0; this.S.gear = 1;
    this.lastGood = { x, z, yaw, h };
  }
  visLiftAt(x, z, y) { // visible road surface minus drive surface under (x,z): race-track tarmac is drawn at y=0.06
    if (y > 0.06 || y < -0.3) return 0; const t = this.w.onTrack(x, z); return t && t.d < 7.5 ? 0.06 - y : 0;
  }
  // ------------------------------------------------------------------ checkpoints
  buildGates() {
    this.gateMat = new THREE.MeshBasicMaterial({ color: 0x19e6c1, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false, fog: false });
    this.finishMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, fog: false });
    this.gate = new THREE.Group(); this.group.add(this.gate);
    const post = new THREE.CylinderGeometry(0.25, 0.25, 5, 8); post.translate(0, 2.5, 0);
    this.gatePosts = [new THREE.Mesh(post, this.gateMat), new THREE.Mesh(post, this.gateMat)];
    this.gateBar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.5, 0.2), this.gateMat); this.gateBar.position.y = 5;
    this.gate.add(...this.gatePosts, this.gateBar);
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 12), new THREE.MeshBasicMaterial({ color: 0x19e6c1, fog: false, depthTest: false, transparent: true, opacity: 0.9 }));
    this.arrow.geometry.rotateX(-Math.PI / 2); this.arrow.renderOrder = 10; this.group.add(this.arrow);
    this.placeGate();
  }
  placeGate() {
    const c = this.cps[this.cp]; this.gate.visible = !!c && this.isRace; this.arrow.visible = false; // guide is the HUD chevron now
    if (!c) return; const [x, z, h, hd, wdt] = c; const w = Math.max(8, wdt);
    this.gate.position.set(x, h, z); this.gate.rotation.y = hd;
    this.gatePosts[0].position.x = -w / 2; this.gatePosts[1].position.x = w / 2; this.gateBar.scale.x = w;
    const fin = this.cp === this.cps.length - 1; for (const m of [...this.gatePosts, this.gateBar]) m.material = fin ? this.finishMat : this.gateMat;
  }
  checkGate() {
    const c = this.cps[this.cp]; if (!c) return;
    const dx = this.S.x - c[0], dz = this.S.z - c[1]; const fx = -Math.sin(c[3]), fz = -Math.cos(c[3]);
    const along = dx * fx + dz * fz, lat = Math.abs(dx * -fz + dz * fx);
    if (Math.abs(this.S.y - c[2]) < 4 && lat < Math.max(8, c[4]) / 2 + 5 && along > -1 && along < 12) {
      if (this.prevAlong != null && this.prevAlong <= 0 || Math.hypot(dx, dz) < 6) this.passGate();
    }
    this.prevAlong = along;
  }
  passGate() {
    const i = this.cp; this.splits.push(+this.raceT.toFixed(3)); this.cp++; this.prevAlong = null;
    this.lastGood = { x: this.S.x, z: this.S.z, yaw: this.S.yaw, h: this.S.y };
    const per = this.route.cps.length; if (this.route.mode === 'circuit' && this.cp % per === 0 && this.cp < this.cps.length) { this.lap++; this.hud.flash(`LAP ${this.lap}/${this.laps}`); this.a.beep(1200, 0.25); } else this.a.beep(990, 0.08);
    if (this.online) this.o.net.send({ t: 'cp', i });
    if (this.cp >= this.cps.length) this.finish(); else this.placeGate();
  }
  async finish() {
    this.state = 'finished'; this.gate.visible = this.arrow.visible = false; this.a.beep(660, 0.4); setTimeout(() => this.a.beep(990, 0.6), 200);
    this.hud.flash('FINISH'); this.finalT = this.raceT;
    if (this.ai) { this.standings = this.ai.standings(this.app.store?.user?.name || this.app.store?.profile?.name || 'You'); this.place = this.standings.findIndex(r => r.me) + 1; }
    if (!this.online && this.o.mode !== 'test') {
      try {
        const r = await this.app.store.act('solo_result', { route: this.route.id, car: this.car.id, laps: this.laps, time: this.finalT, splits: this.splits, mode: this.o.mode === 'trial' ? 'trial' : 'race' });
        this.result = r;
      } catch (e) { this.result = { error: e.message }; }
      setTimeout(() => this.app.showResults(this, this.result), 1600);
    }
  }
  // ------------------------------------------------------------------ input
  bindInput() {
    this.onKey = e => {
      if (e.target?.closest?.('input,textarea,select')) return; // typing in chat / forms never drives the car
      const k = e.key.toLowerCase(); if (e.repeat) return;
      if (e.type === 'keydown') {
        this.keys.add(k);
        if (k === 'escape' || k === 'p') { this.app.togglePause(); e.preventDefault(); }
        if (k === 'c') this.nextCam(); if (k === 'r') this.resetCar();
        if (k === 'e') this.inp.shiftUp = 1; if (k === 'q') this.inp.shiftDown = 1;
        if (k === 'h') this.honk();
      } else { this.keys.delete(k); }
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    };
    addEventListener('keydown', this.onKey); addEventListener('keyup', this.onKey);
    this.onWheelBlur = () => { this.wheelArmed = false; this.keys.clear(); this.wheelPrev = {}; };
    addEventListener('blur', this.onWheelBlur);
    this.onOrient = e => { this.tilt = e.gamma; this.tiltBeta = e.beta; };
    if (this.s.controls.steer === 'tilt') addEventListener('deviceorientation', this.onOrient);
    // orbit camera drag
    const cv = this.g.canvas; let drag = null;
    this.look = { yaw: 0, pitch: 0, held: false, rel: 0 }; /* 360 look-around (chase cam and on foot): drag the screen, it swings back behind after you let go */
    const ptr = this.ptr = new Map(); let pinch = null; const pd = () => { const [a, b] = [...ptr.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
    this.onPD = e => { ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); const ft = !!this.foot?.active; /* on foot the camera mode the car was in doesn't matter */ if (ptr.size === 2 && (ft || (this.camMode !== 'orbit' && this.camMode !== 'cockpit' && this.camMode !== 'bonnet'))) { this.look.drag = null; this.look.held = true; pinch = { d0: pd(), z0: this.look.zoom || 1 }; return; } if (ft || this.camMode !== 'orbit') { this.look.drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; this.look.held = true; return; } drag = { x: e.clientX, y: e.clientY }; this.orbit.held = true; };
    this.onPM = e => { const Lk = this.look; if (ptr.has(e.pointerId)) ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pinch && ptr.size >= 2) { Lk.zoom = Math.max(0.45, Math.min(2.6, pinch.z0 * pinch.d0 / pd())); return; } if (Lk?.drag && e.pointerId === Lk.drag.id) { Lk.yaw -= (e.clientX - Lk.drag.x) * 0.009; Lk.pitch = Math.max(-0.35, Math.min(0.9, Lk.pitch + (e.clientY - Lk.drag.y) * 0.005)); Lk.drag.x = e.clientX; Lk.drag.y = e.clientY; return; } if (!drag) return; this.orbit.yaw -= (e.clientX - drag.x) * 0.008; this.orbit.pitch = Math.max(-0.1, Math.min(1.3, this.orbit.pitch + (e.clientY - drag.y) * 0.006)); drag = { x: e.clientX, y: e.clientY }; };
    this.onPU = e => { if (e) ptr.delete(e.pointerId); if (e && e.type === 'pointercancel' && this.look?.drag?.id === e.pointerId) { /* finger lifted off by the browser */ } if (ptr.size < 2 && pinch) { pinch = null; this.look.held = false; this.look.rel = performance.now(); } if (this.look?.drag && (!e || e.pointerId === this.look.drag.id)) { this.look.drag = null; this.look.held = false; this.look.rel = performance.now(); } drag = null; this.orbit.held = false; this.orbit.rel = performance.now(); };
    this.onWheel = e => { if (this.camMode === 'chase' || this.foot?.active) { const L = this.look; L.zoom = Math.max(0.45, Math.min(2.6, (L.zoom || 1) * (e.deltaY > 0 ? 1.1 : 0.9))); } if (this.camMode === 'orbit') this.orbit.dist = Math.max(3, Math.min(14, this.orbit.dist * (e.deltaY > 0 ? 1.1 : 0.9))); };
    cv.addEventListener('pointerdown', this.onPD); addEventListener('pointermove', this.onPM); addEventListener('pointerup', this.onPU); addEventListener('pointercancel', this.onPU); cv.addEventListener('wheel', this.onWheel, { passive: true });
  }
  unbind() { this.gadgets?.dispose(); this.bint?.dispose(); this.ktv?.dispose();  removeEventListener('blur', this.onWheelBlur); removeEventListener('keydown', this.onKey); removeEventListener('keyup', this.onKey); removeEventListener('deviceorientation', this.onOrient); this.g.canvas.removeEventListener('pointerdown', this.onPD); removeEventListener('pointermove', this.onPM); removeEventListener('pointerup', this.onPU); removeEventListener('pointercancel', this.onPU); this.g.canvas.removeEventListener('wheel', this.onWheel); }
  readInput(dt) {
    const K = this.keys, T = this.touch, c = this.s.controls;
    this.inp.manualClutch = false; this.inp.hPattern = false; this.inp.clutch = 0; this.wheelTransmission = 'inherit';
    let thr = (K.has('arrowup') || K.has('w') ? 1 : 0), brk = (K.has('arrowdown') || K.has('s') ? 1 : 0);
    let st = (K.has('arrowleft') || K.has('a') ? 1 : 0) - (K.has('arrowright') || K.has('d') ? 1 : 0);
    let hb = K.has(' ') ? 1 : 0;
    if (T.gas) thr = 1; if (T.brake) brk = 1; if (T.hb) hb = 1;
    if (c.steer === 'buttons' || c.steer === 'keyboard') { const tst = (T.left ? 1 : 0) - (T.right ? 1 : 0); if (tst) st = tst; }
    if (c.steer === 'wheel' && T.wheel != null) st = T.wheel;
    if (c.steer === 'tilt' && this.tilt != null) { const landscape = Math.abs(window.orientation || screen.orientation?.angle || 0) === 90; const a = landscape ? (this.tiltBeta || 0) * (screen.orientation?.angle === 270 || window.orientation === -90 ? -1 : 1) : this.tilt; st = Math.max(-1, Math.min(1, -a / (28 / c.tiltSens))); }
    // gamepad (standard mapping)
    const wheel = readWheel();
    const gp = wheel ? null : standardPad();
    if (gp) {
      const ax = gp.axes[0] || 0; this.gpSt = padSteer(-ax, Math.abs(this.S.vx), c, this.gpSt || 0, dt); if (Math.abs(ax) > 0.1 || Math.abs(this.gpSt) > 0.002) st = this.gpSt;
      const rt = padPedal(gp.buttons[7]?.value || 0), lt = padPedal(gp.buttons[6]?.value || 0); if (rt > 0) thr = rt; if (lt > 0) brk = lt;
      { const rx = gp.axes[2] || 0, ry = gp.axes[3] || 0, L = this.look; /* right stick: look around (chase / on foot), springs back when released */
        if (L && (Math.abs(rx) > 0.18 || Math.abs(ry) > 0.18)) { L.yaw -= rx * 2.4 * dt; L.pitch = Math.max(-0.5, Math.min(0.35, (L.pitch || 0) + ry * 1.2 * dt)); L.held = true; L.rel = performance.now(); this._padLook = 1; }
        else if (this._padLook) { L.held = false; L.rel = performance.now() - 2000; this._padLook = 0; } }
      if (gp.buttons[0]?.pressed) hb = 1;
      const b = gp.buttons.map(x => x.pressed); const pb = this.gpPrev || [];
      if (b[5] && !pb[5]) this.inp.shiftUp = 1; if (b[4] && !pb[4]) this.inp.shiftDown = 1; if (b[3] && !pb[3]) this.nextCam(); if (b[9] && !pb[9]) this.app.togglePause(); if (b[2] && !pb[2]) this.resetCar();
      if (b[1] && !pb[1] && this.foot && !this.foot.active && this.foot.allowed()) this.foot.exitCar(); /* B / Circle: get out (A / Cross gets back in) */
      this.gpPrev = b;
    }
    if (wheel) {
      this.inp.manualClutch = wheel.manualClutch; this.inp.clutch = wheel.clutch;
      this.inp.hPattern = wheel.hPattern; this.inp.directGear = wheel.gear; this.wheelTransmission = wheel.transmission;
      if (!wheel.ready || document.hidden) {
        this.inp.throttle = 0; this.inp.brake = 1; this.inp.steer = 0; this.inp.handbrake = 0;
        this.inp.reverseToggle = 0; this.inp.shiftUp = 0; this.inp.shiftDown = 0; this.revHold = 0;
        this.inp.clutch = 1; this.inp.directGear = 0;
        this.wheelPrev = {}; this.wheelArmed = false;
        if (!this.wheelWarn) this.hud.flash('WHEEL NOT READY - check Settings > Controls', 3);
        this.wheelWarn = true; return;
      }
      // After connection / focus return, release pedals before arming. No surprise acceleration.
      if (!this.wheelArmed && (wheel.throttle > 0.05 || wheel.brake > 0.05)) {
        this.inp.throttle = 0; this.inp.brake = 1; this.inp.steer = 0; this.inp.reverseToggle = 0;
        this.inp.clutch = 1; this.inp.directGear = 0;
        if (!this.wheelWarn) this.hud.flash('Release pedals to enable wheel', 3);
        this.wheelWarn = true; return;
      }
      this.wheelArmed = true; this.wheelWarn = false;
      st = wheel.steer; thr = wheel.throttle; brk = wheel.brake;
      const b = wheel.buttons, pb = this.wheelPrev || {};
      hb = b.handbrake ? 1 : hb;
      if (b.shiftUp && !pb.shiftUp) this.inp.shiftUp = 1;
      if (b.shiftDown && !pb.shiftDown) this.inp.shiftDown = 1;
      if (b.camera && !pb.camera) this.nextCam();
      if (b.reset && !pb.reset) this.resetCar();
      if (b.pause && !pb.pause) this.app.togglePause();
      this.wheelPrev = b;
    }
    // steering sensitivity with smoothing for digital inputs
    if (!gp) st = Math.max(-1, Math.min(1, st * c.sens)); // controllers use their own sensitivity (padSteer)
    const digital = !(wheel || gp || c.steer === 'wheel' || c.steer === 'tilt');
    // speed-sensitive ramp for touch / key steering: quick at parking speed, progressively calmer at speed (the physics
    // also narrows the lock with speed), so taps don't upset the car at 70 mph but tight turns stay responsive
    if (digital) { const vs = Math.abs(this.S.vx), kv = 1 / (1 + vs * vs / 900); const r = st === 0 ? 3.5 + 2.5 * kv : 1.7 + 2.3 * kv; this.stSm = (this.stSm || 0) + Math.max(-r * dt, Math.min(r * dt, st - (this.stSm || 0))); st = this.stSm; }
    // reverse: hold brake at a standstill to engage, press accelerate at a standstill to go forward again
    const S = this.S; this.inp.wantReverse = 0; this.inp.wantForward = 0;
    if (!this.inp.hPattern && this.state !== 'countdown' && this.state !== 'finished') {
      if (!S.reverse && brk > 0.3 && thr < 0.05 && Math.abs(S.vx) < 0.4) { this.revHold = (this.revHold || 0) + dt; if (this.revHold > 0.35) { this.inp.reverseToggle = 1; this.revHold = 0; } } else this.revHold = 0;
      if (S.reverse && thr > 0.05 && S.vx > -0.6) { this.inp.reverseToggle = 1; }
      if (T.rev) { T.rev = 0; if (Math.abs(S.vx) < 1.5) this.inp.reverseToggle = 1; }
    }
    if (!this.inp.hPattern && S.reverse && !this.inp.reverseToggle) { const t2 = thr; thr = brk; brk = t2; }
    this.smartThr = c.smartThrottle !== false && !(wheel || gp);
    if (this.smartThr && !S.reverse) { const rise = S.gear <= 1 ? 1.6 : S.gear === 2 ? 2.4 : 4; this.thrSm = thr > (this.thrSm || 0) ? Math.min(thr, (this.thrSm || 0) + rise * dt) : thr; thr = this.thrSm; } // on/off pedal squeezed in over ~0.3-0.6 s
    if (this.o.mode === 'test' && this.testLimit && Math.abs(S.vx) > this.testLimit) thr = 0;
    this.inp.throttle = thr; this.inp.brake = brk; this.inp.steer = st; this.inp.handbrake = hb;
    if (this.app.vr?.active) this.app.vr.input(this, dt); // p52 VR wheel + pedals
    if (thr || brk || Math.abs(st) > 0.05 || hb) this.lastAct = performance.now();
  }
  canTurbo() { return this.car?.id === 'kitt'; }
  kittSay(i, force) { const v = this.car?.id === 'kitt' ? 'kitt/k' : this.car?.id === 'dmc12' ? 'doc/d' : null; if (!v) return; try { if (!force && this._kv && !this._kv.ended && !this._kv.paused) return; if (force && this._kv) this._kv.pause(); const a = new Audio(`real/${v}${i}.mp3`); a.volume = 0.95; a.play().catch(() => {}); this._kv = a; } catch (e) {} }
  turboBoost() { if (!this.canTurbo() || (this.turboCd || 0) > 0) return; this.turboT = 2.9; this.jumpT = 0; this._tbAir = 0; this.turboCd = 10; const b = document.getElementById('h-turbo'); if (b) b.classList.add('on');
    if (this._kv) try { this._kv.pause(); } catch (e) {} this.kittSay(7); setTimeout(() => this.kittSay(8), 2400); this.hud.flash('TURBO BOOST', 1.2); }
  toggleSPM() { if (!this.canTurbo()) return; this.spm = !this.spm; document.getElementById('h-spm')?.classList.toggle('on', this.spm); if (this.spm) this.kittSay(8, true); this.hud.flash(this.spm ? 'SUPER PURSUIT MODE' : 'NORMAL CRUISE', 1.2); }
  canHover() { return this.car?.id === 'dmc12'; }
  toggleHover() { if (!this.canHover()) return; this.hover = !this.hover; if (this.hover) this.kittSay(7, true); this.hud.flash(this.hover ? 'HOVER MODE' : 'WHEELS DOWN', 0.9); const b = document.getElementById('h-fly'); if (b) b.textContent = this.hover ? 'LAND' : 'FLY'; }
  // p51 Auto graphics: after 5 s of warm-up, measure 6 s of real frames; step the tier up while it holds ~60 fps (30 on
  // phones) with headroom, step down if it can't; then stop (saved per device). Dynamic resolution trims the rest.
  autoTune(dt) { const g = this.s.graphics; if (g.preset !== 'auto' || g.autoDone || this.paused || !(dt > 0)) return; const A = this._at || (this._at = { t: 0, n: 0, s: 0 }); A.t += dt; if (A.t < 5) return; A.n++; A.s += dt; if (A.s < 6) return;
    const fps = A.n / A.s, tgt = _MOB ? 30 : 60, i = TIERS.indexOf(resolvedPreset(g)); A.t = A.n = A.s = 0; let ni = i;
    if (fps >= tgt * 1.2 && i < TIERS.length - 1 && !A.down) ni = i + 1; else if (fps < tgt * 0.85 && i > 0) { ni = i - 1; A.down = 1; }
    console.log('autoTune', TIERS[i], fps.toFixed(1), '->', TIERS[ni]); if (ni === i) { g.autoDone = 1; this.app.saveSettings?.(); return; }
    g.autoTier = TIERS[ni]; applyPreset(g, 'auto'); this.app.applyGraphics?.(); this.app.saveSettings?.(); this.hud.flash('Graphics: ' + { low: 'Battery', medium: 'Balanced', high: 'High', ultra: 'Ultra' }[TIERS[ni]], 1.2); }
  // p51: keep a chase / orbit camera at least 0.45 m above the road surface under it (no clipping under ramps / kerbs)
  camGround(cam) { try { const n = this.w.nearestRoad(cam.position.x, cam.position.z); if (n && n.d < n.hw + 6 && Math.abs(n.h - this.S.y) < 3) cam.position.y = Math.max(cam.position.y, n.h + 0.45); } catch (e) { } }
  nextCam() { this.camMode = CAMS[(CAMS.indexOf(this.camMode) + 1) % CAMS.length]; this.s.controls.camera = this.camMode; this.hud.flash(CAM_NAMES[this.camMode], 0.8); this.app.saveSettings?.(); }
  resetCar() {
    this.prevXZ = null;
    if (this.state === 'finished') return; const g = this.lastGood;
    const n = this.w.nearestRoad(this.S.x, this.S.z, false, this.S.y) || this.w.nearestRoad(this.S.x, this.S.z); // same level: never into the tunnel below
    let at = g;
    if (!this.isRace && n) { at = { x: n.px, z: n.pz, yaw: Math.atan2(-n.dx, -n.dz) + ((-Math.sin(this.S.yaw) * n.dx - Math.cos(this.S.yaw) * n.dz) < 0 ? Math.PI : 0), h: n.h }; }
    this.S = Object.assign(newState(at.x, at.z, at.yaw), { y: at.h, vyv: 0 });
    if (this.isRace) { this.penalty = (this.penalty || 0) + 3; this.raceT += 3; this.hud.flash('RESET +3s', 1); } else this.hud.flash('RESET', 0.6);
  }
  // open world "meet up": put the car on the road next to a player (behind, beside or ahead of them), never inside anything
  teleportNear(t) {
    const W = this.w, fx = -Math.sin(t.yaw || 0), fz = -Math.cos(t.yaw || 0), y = t.y ?? 0;
    const offs = t.meet ? [[0, 0], [10, 0], [-10, 0], [0, 10]] : [[-9, 0], [-9, 3.5], [-9, -3.5], [0, 4], [0, -4], [9, 0], [-16, 0], [16, 0]];
    let best = null;
    for (const [a, b] of offs) {
      const cx = t.x + fx * a - fz * b, cz = t.z + fz * a + fx * b; let p = null;
      if (!this.poseBad(cx, cz, t.yaw || 0, y)) p = { x: cx, z: cz, yaw: t.yaw || 0, h: this._hs[0] };
      else { const n = W.nearestRoad(cx, cz, false, y) || W.nearestRoad(cx, cz); if (!n) continue; const ry = Math.atan2(-n.dx, -n.dz); const yaw = (-Math.sin(ry) * fx - Math.cos(ry) * fz) >= 0 ? ry : ry + Math.PI; if (!this.poseBad(n.px, n.pz, yaw, n.h)) p = { x: n.px, z: n.pz, yaw, h: this._hs[0] }; }
      if (p && (t.meet || Math.hypot(p.x - t.x, p.z - t.z) > 4.5)) { best = p; break; }
    }
    if (!best) { const n = W.nearestRoad(t.x - fx * 9, t.z - fz * 9, false, y) || W.nearestRoad(t.x, t.z); if (!n) return false; best = { x: n.px, z: n.pz, yaw: Math.atan2(-n.dx, -n.dz), h: n.h }; }
    this.S = Object.assign(newState(best.x, best.z, best.yaw), { y: best.h, vyv: 0, gear: 1 }); this.okPose = null; this.prevXZ = null; this.camPos = null; this.camYaw = null; this.lastGood = best;
    return true;
  }
  honk() { this.a.beep(415, 0.35, 'fx'); setTimeout(() => this.a.beep(330, 0.3, 'fx'), 20); }
  // ------------------------------------------------------------------ online
  bindNet() {
    const n = this.o.net; this.off = [];
    this.off.push(n.on('cpbad', m => { this.hud.flash('CHECKPOINT REJECTED', 1.5); this.hud.toast(m.msg); }));
    this.off.push(n.on('fin', m => { const p = n.room?.players.find(q => q.id === m.id); this.hud.toast(`${p?.name || 'Player'} finished — ${fmt(m.time)}`); if (m.id === n.me) this.finalT = m.time; }));
    this.off.push(n.on('idlewarn', m => this.hud.warn(m.world ? `Still there? Drive, chat or tap the screen within ${m.left}s to stay in the open world` : `You're inactive — drive within ${m.left}s or you'll be removed from the session`, m.left)));
    this.t0 = this.o.t0;
    if (this.o.late) { this.spectating = true; this.state = 'drive'; this.isRace = false; this.gate.visible = this.arrow.visible = false; this.hud.toast('Race in progress — free-driving until the next race starts'); }
  }
  syncRemotes() {
    const n = this.o.net; if (!n.room) return;
    const ids = new Set();
    for (const p of n.room.players) {
      if (p.id === n.me) continue; ids.add(p.id);
      let R = this.remotes.get(p.id);
      const car = this.app.carsById[p.car];
      const look = JSON.stringify([p.custom?.wheel, p.custom?.tint, p.custom?.caliper, p.custom?.finish, p.ups]);
      if (!R || R.carId !== p.car || R.colour !== p.colour || R.look !== look) {
        if (R) { this.group.remove(R.obj); R.eng?.stop(); R.tag.remove(); }
        const obj = buildCar(car, { detail: Math.min(1, this.s.graphics.carDetail), colour: p.colour, wheel: p.custom?.wheel, tint: p.custom?.tint, caliper: p.custom?.caliper, finish: p.custom?.finish, plate: p.name.slice(0, 7) });
        this.group.add(obj); const tag = this.hud.nameTag(p.name); tag.el.dataset.id = p.id;
        R = { obj, carId: p.car, colour: p.colour, look, S: newState(), P: deriveParams(car, this.o.stock ? {} : p.ups, this.app.calib[car.id] || {}), tag, name: p.name };
        car._up = p.ups; if (this.a.ready) R.eng = this.a.createEngine(car, p.id);
        this.remotes.set(p.id, R);
      }
      R.name = p.name; R.away = p.away; R.ghost = !!this.o.worldRace && !(this.o.parts || []).includes(p.id); // open-world race: drivers not in it are ghosts
    }
    for (const [id, R] of this.remotes) if (!ids.has(id)) { this.group.remove(R.obj); R.eng?.stop(); R.tag.remove(); this.remotes.delete(id); }
  }
  // ------------------------------------------------------------------ main loop
  update(dtReal) {
    const dt = Math.min(0.1, dtReal); let pt = PF.on ? performance.now() : 0; // up to 0.1 s per frame is simulated in fixed 1/120 s steps, so game speed does not depend on the render rate (was 0.05: below 20 fps the game ran in slow motion)
    if (this.online) this.syncRemotes();
    const frozen = this.paused && !this.online;
    if (!frozen) {
      this.readInput(dt); this.foot?.carInput(this.inp); this.app.rumble?.update(dt, this);
      if (this.paused && this.online) { this.inp.throttle = 0; this.inp.brake = 0.6; this.inp.steer = 0; this.inp.handbrake = 0; } // unattended car: controlled braking
      // race start
      if (this.state === 'countdown') {
        if (!this.online && (this._cdF = (this._cdF || 0) + 1) <= 3) this.countStart = performance.now() / 1000 + 0.6; // solo: the 3-2-1 starts once the first frames are drawn (shader warm-up can take seconds)
        const now = this.online ? this.o.net.now() : performance.now() / 1000; const t0 = this.online ? this.t0 : this.countStart + 3;
        const left = t0 - now; this.hud.countdown(left);
        this.inp.throttle *= 1; const hold = left > 0; if (hold) { this.inp.brake = 1; }
        if (!hold) { this.state = 'race'; this.raceT = this.online ? Math.max(0, now - this.t0) : 0; this.hud.countdown(-1); }
      } else if (this.state === 'race') this.raceT = this.online ? Math.max(0, this.o.net.now() - this.t0) + (this.penalty || 0) : this.raceT + dt; // online clock follows the server
      // physics substeps
      let acc = dt + (this.acc || 0); const opts = { auto: this.s.controls.auto, abs: this.s.controls.abs, tc: this.s.controls.tc, esc: this.s.controls.esc, steerAssist: this.s.controls.steerAssist, wet: this.wet * (1 + (this.P.tyreClass === 3 ? 0.3 : 0)), onePedal: this.s.controls.onePedal, regenLevel: this.s.controls.regen, evConsumption: this.s.controls.evConsumption, smartThr: this.smartThr };
      if (this.wheelTransmission !== 'inherit') opts.auto = this.wheelTransmission === 'auto';
      const IP = this._ip || (this._ip = { x: 0, y: 0, z: 0, yaw: 0, p: 0, a: 1, ok: false });
      while (acc >= DT) {
        IP.x = this.S.x; IP.y = this.S.y; IP.z = this.S.z; IP.yaw = this.S.yaw; IP.p = this.S.pitchG || 0; IP.ok = true; // pose before the last step (render interpolation)
        if (this.hover || (this.S.hoverH || 0) > 0.3) hoverStep(this.P, this.S, this.inp, DT, this.hover); else step(this.P, this.S, this.inp, opts, DT); if ((this.turboT || 0) > 0) { this.turboT -= DT; if (!this.S.reverse) this.S.vx = Math.min(this.S.vx + 9 * DT, this.spm ? 110 : 85); }
        if (this.spm && !this.hover) { const S = this.S, i = this.inp; // Super Pursuit Mode: big extra thrust to ~245 mph, rails-like grip, air brakes
          if (i.throttle > 0 && !S.reverse && S.vx >= 0) S.vx = Math.min(S.vx + 13 * i.throttle * DT * Math.max(0, 1 - (S.vx / 118) ** 2), 115); S.vy *= 1 - Math.min(1, 14 * DT); // glued down: almost no slide, ~250 mph
          // TV-style SPM handling: the car goes exactly where it's pointed at any speed — yaw rate follows the stick, capped at ~5 g of cornering
          this._spSt = (this._spSt || 0) + ((i.steer || 0) - (this._spSt || 0)) * Math.min(1, 7 * DT); const vv = Math.max(1, Math.abs(S.vx));
          const rd = this._spSt * Math.min(vv * Math.tan(0.5) / 2.6, 50 / vv) * Math.sign(S.vx || 1); S.r += (rd - S.r) * Math.min(1, 10 * DT); S.vy *= 1 - Math.min(1, 25 * DT);
          if (i.brake > 0.3 && S.vx > 5) S.vx = Math.max(0, S.vx - 9 * i.brake * DT); } this.inp.shiftUp = this.inp.shiftDown = this.inp.reverseToggle = 0;
        if (this.ai) this.ai.step(DT); // AI step + car-car contact (pushes land before the player's legality check)
        this.collide(DT); acc -= DT;
      }
      this.acc = acc; this.t += dt; if (pt) pt = pmk('physics', pt);
      if (this.S.gearRejected && this.S.gearRejected !== this._gearMessage) this.hud.flash(this.S.gearRejected, 1.5);
      this._gearMessage = this.S.gearRejected || '';
      if (this.isRace && this.state === 'race') this.checkGate();
      if ((!this.isRace || this.state !== 'race') && this.okPose) { const k = this.okPose; this.lastGood = { x: k.x, z: k.z, yaw: k.yaw, h: k.y }; } // last legal pose
      this.driveKm += Math.hypot(this.S.vx, this.S.vy) * dt / 1000;
    }
    // visuals. Render interpolation: physics runs in fixed 1/120 s steps, frames land between steps, so the drawn pose is
    // the blend of the last two physics poses at the leftover fraction (acc / DT). Without it a 60 / 90 / 120 fps frame
    // shows the car 0-1 step (0-8 ms) out of phase every frame -> visible micro-judder. Physics state is restored below.
    const IPs = this._ip; let ipR = null;
    if (IPs && IPs.ok && !frozen && this.s.graphics.interp !== false) { const a = Math.max(0, Math.min(1, (this.acc || 0) / DT)), S = this.S;
      if (Math.abs(S.x - IPs.x) + Math.abs(S.z - IPs.z) < 3 && a < 0.999) { ipR = this._ipR || (this._ipR = {}); ipR.x = S.x; ipR.y = S.y; ipR.z = S.z; ipR.yaw = S.yaw; ipR.p = S.pitchG;
        let dy = S.yaw - IPs.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI; const b = 1 - a; // lerp from the current pose back toward the previous one
        S.x -= (S.x - IPs.x) * b; S.y -= (S.y - IPs.y) * b; S.z -= (S.z - IPs.z) * b; S.yaw -= dy * b; if (S.pitchG != null) S.pitchG -= (S.pitchG - IPs.p) * b; } }
    if (this.foot && !frozen) this.foot.step(dt);
    try { this.visuals(dt, frozen, pt); } finally { if (ipR) { const S = this.S; S.x = ipR.x; S.y = ipR.y; S.z = ipR.z; S.yaw = ipR.yaw; S.pitchG = ipR.p; } }
  }
  visuals(dt, frozen, pt) {
    const o = this.obj; o.position.set(this.S.x, this.S.y, this.S.z); o.rotation.set(this.S.pitchG || 0, this.S.yaw, 0, 'YXZ');
    { const S = this.S, tgt = this.hover ? 2.4 : 0; S.hoverH = (S.hoverH || 0) + (tgt - (S.hoverH || 0)) * Math.min(1, dt * 1.6); // hover: float above the road with a slow bob and lean into turns
      if (S.hoverH > 0.01) { o.position.y += S.hoverH + Math.sin(this.t * 2.1) * 0.07 * Math.min(1, S.hoverH); o.rotation.set((S.pitchG || 0) - (S.hvA || 0) * 0.012, S.yaw, -(S.r || 0) * 0.35 * Math.min(1, S.hoverH / 2), 'YXZ'); } }
    if (!this._btnFix) { this._btnFix = 1; const aux = document.querySelector('.tc.aux'), cam = aux?.querySelector('[data-k="cam"]'); // car-specific buttons (also covers older cached pages)
      const G = () => this.gadgets, B = [['h-fly', 'FLY', () => this.toggleHover()], ['h-turbo', 'TURBO', () => this.turboBoost()], ['h-spm', 'SPM', () => this.toggleSPM()],
        ['h-guns', 'GUNS', () => G()?.fire()], ['h-smoke', 'SMOKE', () => document.getElementById('h-smoke')?.classList.toggle('on', !!G()?.smoke())], ['h-oil', 'OIL', () => document.getElementById('h-oil')?.classList.toggle('on', !!G()?.oil())], ['h-shield', 'SHIELD', () => { G()?.toggleShield(); document.getElementById('h-shield')?.classList.toggle('on', !!G()?.shield); }]];
      for (const [id, t, fn] of B) { let b = document.getElementById(id); if (!b && aux) { b = document.createElement('button'); b.id = id; b.className = 'tb small util'; b.textContent = t; b.hidden = true; aux.insertBefore(b, cam); }
        if (b && !b.dataset.k) b.onpointerdown = e => { e.preventDefault(); fn(); }; }
      const id = this.car?.id; for (const [bid, cars] of [['h-fly', ['dmc12']], ['h-turbo', ['kitt']], ['h-spm', ['kitt']], ['h-guns', ['bond']], ['h-smoke', ['bond']], ['h-oil', ['bond']], ['h-shield', ['bond']]]) { const b = document.getElementById(bid); if (b) b.hidden = !cars.includes(id); }
      if (id === 'kitt') { this.kdash = new KittDash(); this.kdash.attach(this.obj); this.ktv = new KittTVs(this.obj, this.car); }
      if (id === 'bond') { this.gadgets = new Gadgets(this); this.bint = new DB5Interior(this.obj, this.car); } }
    if (this.kdash && this.camMode === 'cockpit') this.kdash.draw(this.S, this.P, dt, !!(this._kv && !this._kv.paused && !this._kv.ended), this.app.store?.settings?.units, this.inp);
    this.gadgets?.step(dt); this.bint?.step(dt, this.S, this.P, this.camMode === 'cockpit', this.inp.steer);
    if (this.canHover()) { const T = this.obj.userData._tm; if (T && !T.armed && !this._docSaid) { this._docSaid = 1; this.kittSay(0, true); } if (T?.armed) this._docSaid = 0;
      this.kittNext = (this.kittNext ?? 8) - dt; if (this.kittNext <= 0 && !this.paused) { this.kittNext = 35 + Math.random() * 35; this.kittSay(1 + Math.floor(Math.random() * 6)); } }
    if (this.canTurbo()) { const S = this.S; if (this.jumpT != null) { this.jumpT += dt; const t = this.jumpT, C = 0.32, F = 1.7, Lg = 0.6, Hp = 3.2; let y = 0, pitch = 0; // turbo boost like the show: squat and ignite, ballistic leap, heavy suspension landing
        if (t < C) { const k = t / C; y = -0.09 * Math.sin(k * Math.PI / 2); pitch = 0.05 * k; } // rear squats as the boosters light
        else if (t < C + F) { const k = (t - C) / F; y = 4 * Hp * k * (1 - k); pitch = 0.16 * (1 - 2 * k) - 0.02; if (!this._tbAir) { this._tbAir = 1; this.shake = Math.max(this.shake || 0, 0.25); } } // parabola; nose follows the flight path
        else if (t < C + F + Lg) { const k = (t - C - F) / Lg; y = -0.16 * Math.exp(-5 * k) * Math.cos(k * 14); pitch = -0.06 * Math.exp(-6 * k) * Math.cos(k * 14); if (this._tbAir === 1) { this._tbAir = 2; this.shake = Math.max(this.shake || 0, 0.9); this.a?.impact?.(0.8); navigator.vibrate?.(60); } } // touchdown: compress, rebound, settle
        else { this.jumpT = null; this._tbAir = 0; }
        S.liftJ = y; S.tbPitch = pitch; } else { S.liftJ = 0; S.tbPitch = 0; }
      if (S.liftJ || S.tbPitch) { o.position.y += S.liftJ; o.rotation.x += S.tbPitch; }
      this.spmT = Math.max(0, (this.spmT || 0) - dt); this.turboCd = Math.max(0, (this.turboCd || 0) - dt); S.spmK = (S.spmK || 0) + ((this.spm ? 1 : 0) - (S.spmK || 0)) * Math.min(1, dt * 2.2); S.airbrake = (S.airbrake || 0) + ((this.spm && this.inp.brake > 0.3 && S.vx > 5 ? 1 : 0) - (S.airbrake || 0)) * Math.min(1, dt * 8); S.boostK = (S.boostK || 0) + (((this.turboT || 0) > 0 ? 1 : 0) - (S.boostK || 0)) * Math.min(1, dt * 6);
      if (!this.turboCd) document.getElementById('h-turbo')?.classList.remove('on');
      this.kittNext = (this.kittNext ?? 6) - dt; if (this.kittNext <= 0 && !this.paused) { this.kittNext = 35 + Math.random() * 35; { const pool = [0, 1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13]; this.kittSay(pool[Math.floor(Math.random() * pool.length)]); } } }
    { // visual ride height only (physics untouched): race-track tarmac is drawn 0.06 m above its drive surface (h=0),
      // so lift the body there to keep the tyres on the visible road instead of sunk into it
      const L = this.visLiftAt(this.S.x, this.S.z, this.S.y); this.S.visLift = this.S.visLift == null ? L : this.S.visLift + (L - this.S.visLift) * Math.min(1, dt * 12); }
    poseCar(o, this.S, this.P, dt);
    try { this.autoTune(dt); } catch (e) { }
    if (this.envCycle && !this.paused) { const E = this.envCycle, eo = E.update(dt); this.g.setClock(eo, E.tod * 24); const rn = eo.rain > 0.35; if (rn !== this._envRain) { this._envRain = rn; this.a.setRain(rn); } this.wet = Math.max(eo.wet, rn ? 0.6 : 0); if (eo.target !== this.envW) { this.envW = eo.target; this.hud.flash('Weather: ' + eo.target, 1.4); } }
    const night = this.g.night, tun = this.w.inTunnel(this.S.x, this.S.z, this.S.y);
    const blink = (this.t % 0.8) < 0.4;
    setLights(o, { head: night || tun > 0.5 || this.wet ? 1 : 0, brake: this.inp.brake > 0.1 && !this.S.reverse, rev: this.S.reverse, blink: blink && (this.hazard || (this.paused && this.online)) }, night || tun > 0.5);
    this.g.updateNightLights?.(o, this.w, dt, night || tun > 0.5 || this.wet); // headlight spot + nearest street lamps (medium/high)
    this.updateCam(dt); if (pt) pt = pmk('carVisual+cam', pt);
    // remote cars
    if (this.online) for (const [id, R] of this.remotes) {
      const s = this.o.net.sample(id); R.obj.visible = !!s && !R.away; if (!s) { R.tag.hide(); continue; }
      R.S.x = s.x; R.S.z = s.z; R.S.y = s.y; R.S.yaw = s.yaw; R.S.steer = s.st || 0; R.S.vx = s.vx || 0; R.S.rpm = s.rpm || 0; R.S.gear = s.g; R.S.throttle = s.th;
      R.S.wheelRot += (s.vx || 0) / R.P.rw * dt; R.S.ax = 0; R.S.ay = 0;
      this.foot?.remote(R, s.ft, dt); R.obj.position.set(s.x, s.y, s.z); R.obj.rotation.set(0, s.yaw, 0); R.S.visLift = this.visLiftAt(s.x, s.z, s.y); poseCar(R.obj, R.S, R.P, dt);
      setLights(R.obj, { head: s.lt & 1, brake: s.lt & 2, rev: s.lt & 4, blink: (s.lt & 8) && blink }, night || tun > 0.5);
      const dd = this.o.mode === 'world' || this.o.worldRace ? Math.hypot(s.x - this.S.x, s.z - this.S.z) : 0;
      R.tag.at(R.obj.position, this.g.cam, (s.menu ? ' (menu)' : '') + (dd > 40 ? ` · ${Math.round(dd)} m` : ''), this.o.mode === 'world' ? 800 : 250);
      if (R.eng) { const dx = s.x - this.S.x, dz = s.z - this.S.z; const d = Math.hypot(dx, dz); const cam = this.g.cam; const right = _v1.set(1, 0, 0).applyQuaternion(cam.quaternion); R.eng.update({ rpm: s.rpm, throttle: s.th, overrun: s.ov, boost: s.bo, kwOut: s.kw, gear: s.g, slipF: s.ts, slipR: s.ts }, dt, { dist: d, pan: (dx * right.x + dz * right.z) / Math.max(10, d), speed: Math.abs(s.vx || 0), crackle: 0.6 }); }
    }
    if (this.ai) this.ai.visuals(dt, blink, night || tun > 0.5);
    // local audio
    if (this.eng) {
      const inCar = this.camMode === 'cockpit' || this.camMode === 'bonnet';
      const es = Object.assign(this._engS || (this._engS = {}), this.S); es.throttle = frozen ? 0 : this.inp.throttle; this.eng.update(es, dt, { local: true, speed: Math.abs(this.S.vx), inCar, conv: this.conv, tunnel: tun, wet: this.wet, crackle: this.s.sound.crackle * (this.custom.crackle ?? 1), onFlame: () => this.flame() });
    }
    this.updateFlames(dt); if (pt) pt = pmk('audio+remotes', pt);
    this.g.follow(o.position);
    this.w.update(this.t, night, this.wet); if (pt) pt = pmk('world.update', pt);
    // net send 15 Hz
    if (this.online && performance.now() - this.lastSent > 66) {
      this.lastSent = performance.now(); const [vwx, vwz] = velocityWorld(this.S);
      const lt = (this.g.night || tun > 0.5 ? 1 : 0) | (this.inp.brake > 0.1 ? 2 : 0) | (this.S.reverse ? 4 : 0) | (this.paused ? 8 : 0);
      this.o.net.send({ t: 'st', act: performance.now() - Math.max(this.lastAct, this.o.mode === 'world' ? this.app.uiAct || 0 : 0) < 1500 && (!this.paused || this.o.mode === 'world'), menu: this.paused, s: { x: +this.S.x.toFixed(2), y: +this.S.y.toFixed(2), z: +this.S.z.toFixed(2), yaw: +this.S.yaw.toFixed(3), vx: +this.S.vx.toFixed(2), vwx: +vwx.toFixed(2), vwz: +vwz.toFixed(2), st: +this.S.steer.toFixed(3), rpm: Math.round(this.S.rpm), g: this.S.gear, th: +this.inp.throttle.toFixed(2), ov: +this.S.overrun.toFixed(2), bo: +(this.S.boost || 0).toFixed(2), kw: Math.round(this.S.kwOut || 0), ts: +Math.min(1, this.S.slipR + this.S.spinR).toFixed(2), lt, ft: this.foot?.net() || 0 } });
    }
    // free-roam credits
    if (!this.isRace && !['test', 'tutorial'].includes(this.o.mode) && this.driveKm > 0.5) { const km = this.driveKm; this.driveKm = 0; this.app.store.act('free_drive', { km }).then(r => { if (r.earned) this.hud.toast(`+${r.earned} credits for driving`); }).catch(() => { }); }
    this.hud.update(this, dt);
    this.app.tutorial?.update(this, dt); if (pt) pmk('hud', pt);
  }
  // ground following, walls, buildings and car-to-car contact.
  // One rule (like BeamNG): the car's whole footprint must stand on a visible road surface at its own level, and no solid
  // (building, wall, parapet, rail, barrier, post, tree...) may overlap it. Every physics step the new pose is checked;
  // if it breaks the rule the car slides along the obstacle or stays at its last legal pose, with the velocity into the
  // obstacle removed. Because the last legal pose is always legal, the car can never end up through, inside or on top
  // of anything, whatever the speed or input.
  // ref = the car's level (number) or the surface heights under each check point in the last legal pose (array): then
  // each point may only move onto surface within STEP of where it was, so a car can climb/descend a ramp but never
  // step off a street onto a lower road (or up onto a higher one) where the two meet without a slope
  poseBad(x, z, yaw, ref) {
    const W = this.w, d = this.obj.userData.dims, hl = d.L / 2, hw = d.W / 2, rl = hl * TYRE_BOX, rw = hw * TYRE_BOX, fx = -Math.sin(yaw), fz = -Math.cos(yaw), arr = Array.isArray(ref), hs = [];
    for (let i = 0; i < POSE_PTS.length; i++) { const [a, b] = POSE_PTS[i]; const px = x + fx * rl * a - fz * rw * b, pz = z + fz * rl * a + fx * rw * b;
      const g = i === 0 ? W.driveAt(px, pz, arr ? ref[0] : ref, arr ? STEP : 1.0, fx, fz) // centre: follows the road it is heading along
        : W.driveAt(px, pz, arr ? ref[i] : hs[0], arr ? STEP : 1.0, undefined, undefined, hs[0]); // other points: continuous, on the centre's road where it is under them
      if (!g || i && Math.abs(g.h - hs[0]) > 1.0) return { road: true, px, pz }; hs.push(g.h); if (i === 0) this._seg = g.s; } // and the whole car on one level
    const s = W.solidHit(x, z, yaw, hl, hw, hs[0]); if (s) return { solid: true, nx: s.nx, nz: s.nz, px: s.px, pz: s.pz, src: s.src };
    this._hs = hs; return null;
  }
  collide(dt) {
    const S = this.S, W = this.w;
    if (this.o.mode === 'showroom') { const g = W.driveAt(S.x, S.z, S.y ?? 0); S.y = g ? g.h : (S.y ?? 0); return; }
    // other players (solid, local response only): pushed first so the legality check below also covers it
    for (const R of this.remotes.values()) {
      if (!R.obj.visible || R.ghost) continue; const dx = S.x - R.obj.position.x, dz = S.z - R.obj.position.z; const d = Math.hypot(dx, dz); const min = 2.1;
      if (d < min && d > 0.01 && Math.abs(S.y - R.obj.position.y) < 2) { const k = (min - d) / d; S.x += dx * k * 0.5; S.z += dz * k * 0.5; this.wallHit(-dx / d, -dz / d, 0.6); }
    }
    let ok = this.okPose;
    if (!this.prevXZ || (ok && Math.hypot(S.x - ok.x, S.z - ok.z) > 10)) ok = this.okPose = null; // teleport / respawn / net correction
    let bad = this.poseBad(S.x, S.z, S.yaw, ok ? ok.hs : S.y), hs = this._hs;
    if (bad && ok) {
      const mx = S.x - ok.x, mz = S.z - ok.z, ml = Math.hypot(mx, mz);
      let nx, nz; // direction from the car towards the obstacle
      if (bad.solid) { nx = bad.nx; nz = bad.nz; }
      else { const e = W.offRoad(bad.px, bad.pz, S.y); if (e && !e.revert) { nx = e.ux; nz = e.uz; } else { nx = bad.px - S.x; nz = bad.pz - S.z; } }
      const nl = Math.hypot(nx, nz); if (nl > 1e-6) { nx /= nl; nz /= nl; } else if (ml > 1e-6) { nx = mx / ml; nz = mz / ml; } else { nx = -Math.sin(S.yaw); nz = -Math.cos(S.yaw); }
      this.wallHit(nx, nz, bad.solid ? 0.25 : 0.1); if (bad.solid) { this.solidHits = (this.solidHits || 0) + 1; this.lastSolid = bad.src; } else this.offHits = (this.offHits || 0) + 1;
      const dn = mx * nx + mz * nz, tx = mx - nx * Math.max(0, dn), tz = mz - nz * Math.max(0, dn); // slide along the edge
      // a kerb/wall hit off-centre also turns the car away from it (like the real contact force): yaw toward the side
      // that moves the contact point away from the obstacle
      let sg = 0; { const rx = bad.px - S.x, rz = bad.pz - S.z; sg = (rz * nx - rx * nz) < 0 ? 1 : -1; } // d(contact)/d(yaw) = (rz, -rx)
      const yaws = sg ? [S.yaw, S.yaw + sg * 0.012, S.yaw + sg * 0.03, ok.yaw] : [S.yaw, ok.yaw];
      const cands = []; for (const [px, pz] of [[ok.x + tx, ok.z + tz], [ok.x, ok.z]]) for (const y of yaws) cands.push([px, pz, y]);
      if (sg) cands.splice(1, 0, [S.x, S.z, S.yaw + sg * 0.012]); // pushed round by the kerb as it drives on
      const last = cands[cands.length - 1]; let c = cands.find(c => c !== last && !this.poseBad(c[0], c[1], c[2], ok.hs)); hs = c ? this._hs : ok.hs; c = c || last;
      if (c[2] !== S.yaw) S.r = 0; // could not rotate into the obstacle
      if (c === last) { S.vx *= 0.5; S.vy *= 0.5; } // pinned: no legal move at all, so the car really stops (no phantom speed)
      S.x = c[0]; S.z = c[1]; S.yaw = c[2]; bad = null; // every candidate kept is legal (the last one is the previous legal pose)
    } else if (bad) { bad = this.recoverPose(); hs = this._hs; }
    // vertical: sit on the road surface under the car (small drops fall with gravity)
    const g = W.driveAt(S.x, S.z, bad ? S.y : hs[0], bad ? 3 : 0.01, -Math.sin(S.yaw), -Math.cos(S.yaw));
    const h = g ? g.h : S.y;
    if (S.y > h + 0.05) { S.vyv = (S.vyv || 0) - 9.81 * dt; S.y = Math.max(h, S.y + S.vyv * dt); } else { S.y += (h - S.y) * Math.min(1, dt * 25); S.vyv = 0; }
    const sg = g?.s, sl = sg ? Math.max(1, Math.hypot(sg.x2 - sg.x1, sg.z2 - sg.z1)) : 1;
    const slope = sg ? (sg.h2 - sg.h1) / sl : 0;
    const fx = -Math.sin(S.yaw), fz = -Math.cos(S.yaw); const dirDot = sg ? (fx * (sg.x2 - sg.x1) + fz * (sg.z2 - sg.z1)) / sl : 0;
    S.pitchG = (S.pitchG || 0) + (Math.atan(slope * dirDot) - (S.pitchG || 0)) * Math.min(1, dt * 8);
    S.vx -= 9.81 * Math.sin(S.pitchG || 0) * dt; // gravity along gradients
    if (!bad) this.okPose = { x: S.x, z: S.z, yaw: S.yaw, y: S.y, hs };
    this.prevXZ = [S.x, S.z];
  }
  // no legal pose to fall back on (spawn, reset, network correction, test teleport): move the car onto the road
  recoverPose() {
    const S = this.S, W = this.w;
    for (let it = 0; it < 12; it++) {
      const bad = this.poseBad(S.x, S.z, S.yaw, S.y); if (!bad) return null;
      if (bad.solid) { S.x -= bad.nx * 0.25; S.z -= bad.nz * 0.25; continue; }
      const c = W.driveAt(S.x, S.z, S.y);
      if (c && it < 8) { const e = W.offRoad(bad.px, bad.pz, S.y); if (e && !e.revert) { S.x -= e.ux * (e.pen + 0.05); S.z -= e.uz * (e.pen + 0.05); continue; } }
      // centre off the road (or corners can't be pushed in): put the car on the nearest road centreline, aligned with it
      const n = W.nearestRoad(S.x, S.z, false, S.y) || W.nearestRoad(S.x, S.z); if (!n) return bad;
      S.x = n.px; S.z = n.pz; S.y = n.h; const yaw = Math.atan2(-n.dx, -n.dz); const fwd = -Math.sin(S.yaw) * -n.dx - Math.cos(S.yaw) * -n.dz;
      S.yaw = fwd >= 0 ? yaw : yaw + Math.PI; S.vy = 0; S.r = 0; if (it >= 10) { S.vx = 0; }
    }
    return this.poseBad(S.x, S.z, S.yaw, S.y);
  }
  // (ux,uz) = direction from car towards obstacle in world space → remove velocity into it, bounce a little
  wallHit(ux, uz, bounce = 0.25) {
    const S = this.S; const sy = Math.sin(S.yaw), cy = Math.cos(S.yaw);
    let wx = -sy * S.vx - cy * S.vy, wz = -cy * S.vx + sy * S.vy;
    const vn = wx * ux + wz * uz; if (vn <= 0) return;
    wx -= ux * vn * (1 + bounce); wz -= uz * vn * (1 + bounce); const scrub = 1 - Math.min(0.1, vn * 0.01); wx *= scrub; wz *= scrub; // grinding along a kerb costs little; a hard hit costs more
    S.vx = -sy * wx - cy * wz; S.vy = -cy * wx + sy * wz; if (vn > 1.5) S.r *= 0.5; // only real impacts kill the yaw rate, so you can always steer away from a kerb
    if (vn > 2 && performance.now() - (this.lastImpact || 0) > 250) { this.lastImpact = performance.now(); this.a.impact(Math.min(1, vn / 20)); this.app.rumble?.impact(Math.min(1, vn / 20)); if (this.s.graphics.shake) this.shake = Math.min(1, vn / 15); if (navigator.vibrate) try { navigator.vibrate(Math.min(80, vn * 4)); } catch (e) { } }
  }
  flame() {
    if (!this.flameMat) { this.flameMat = new THREE.SpriteMaterial({ color: 0xffa040, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, map: flameTex() }); }
    for (const e of this.obj.userData.exhausts || []) { const sp = new THREE.Sprite(this.flameMat.clone()); sp.position.copy(e).add(new THREE.Vector3(0, 0, 0.25)); sp.scale.setScalar(0.45); this.obj.add(sp); this.flames.push({ sp, t: 0 }); }
  }
  updateFlames(dt) { for (let i = this.flames.length - 1; i >= 0; i--) { const f = this.flames[i]; f.t += dt; f.sp.material.opacity = Math.max(0, 1 - f.t / 0.12); f.sp.scale.setScalar(0.45 + f.t * 3); if (f.t > 0.12) { this.obj.remove(f.sp); f.sp.material.dispose(); this.flames.splice(i, 1); } } }
  lookStep(dt, moving = true) { const L = this.look || (this.look = { yaw: 0, pitch: 0 }); L.zoom ??= 1; if (!L.held && moving && performance.now() - (L.rel || 0) > 2500) { /* 360 look stays put while stopped; swings back behind once you move */ while (L.yaw > Math.PI) L.yaw -= 2 * Math.PI; while (L.yaw < -Math.PI) L.yaw += 2 * Math.PI; const k = 1 - Math.exp(-3.2 * dt); L.yaw -= L.yaw * k; L.pitch -= L.pitch * k; } return L; }
  updateCam(dt) {
    const cam = this.g.cam, o = this.obj, S = this.S, u = o.userData;
    const fx = -Math.sin(S.yaw), fz = -Math.cos(S.yaw);
    const spd = Math.abs(S.vx);
    { // p51 camera FOV: from a horizontal target (so portrait phones aren't zoomed in), wider with speed, snaps on a view switch
      const hf = (this.camMode === 'cockpit' ? 86 : this.camMode === 'bonnet' ? 84 : this.camMode === 'orbit' ? 74 : 76) + Math.min(this.camMode === 'cockpit' ? 5 : 12, spd * (this.camMode === 'cockpit' ? 0.08 : 0.2));
      const vf = Math.max(this.camMode === 'cockpit' ? 50 : 44, Math.min(this.camMode === 'cockpit' ? 82 : 78, 2 * Math.atan(Math.tan(hf * Math.PI / 360) / cam.aspect) * 180 / Math.PI));
      const sw = this._camPrev !== this.camMode; this._camPrev = this.camMode; if (sw) { this.camPos = null; this._pull = 1; }
      cam.fov = sw ? vf : cam.fov + (vf - cam.fov) * Math.min(1, dt * 3); cam.updateProjectionMatrix(); }
    u.interior && (u.interior.visible = this.camMode === 'cockpit' || this.s.graphics.carDetail > 1);
    if (u.driverMesh) u.driverMesh.visible = this.camMode !== 'cockpit' && !this.foot?.active; // no old stand-in driver left sitting in the car once Shak has stepped out
    { // from the driver's seat the tinted glass is near-clear (outside it stays dark and glossy): per-car clones, swapped in/out
      const ck = this.camMode === 'cockpit'; if (u._ckGlass !== ck) { u._ckGlass = ck; o.traverse(m => { if (!m.isMesh || !m.material) return; const arr = Array.isArray(m.material);
        const ms = arr ? m.material : [m.material]; const out = ms.map(mt => { if (ck) { if (!mt.transparent || mt.opacity < 0.5 || CK_ORIG.has(mt)) return mt; let c = CK_CLONE.get(mt); if (!c) { c = mt.clone(); c.opacity = 0.14; c.envMapIntensity = 0.25; CK_ORIG.set(c, mt); CK_CLONE.set(mt, c); } return c; } return CK_ORIG.get(mt) || mt; });
        m.material = arr ? out : out[0]; }); } } // first-game DB9 driver model: hidden from his own eyes
    { // first-game photo cockpits (Range Rover, Boxster): full-screen dashboard image, windows cut out so the road shows through
      const ck = this.camMode === 'cockpit' && (u.real === 'rrs' || u.real === 'box'); let el = document.getElementById('ckov');
      if (ck && !el) { el = document.createElement('canvas'); el.id = 'ckov'; el.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:1'; document.getElementById('c').after(el); }
      if (el) { el.style.display = ck ? 'block' : 'none';
        if (ck) { // photo drawn in 3 bands: roof header + mirror at the top, stretched pillars, dash cropped to the bottom ~28%
          if (!el._im || el.dataset.k !== u.real) { el._im = new Image(); el._im.src = `./real/tex/cockpit_${u.real}.webp`; el.dataset.k = u.real; el._drawn = ''; }
          const im = el._im, dpr = Math.min(2, devicePixelRatio || 1), Wc = Math.round(innerWidth * dpr), Hc = Math.round(innerHeight * dpr), key = Wc + 'x' + Hc + u.real;
          if (im.complete && im.naturalWidth && el._drawn !== key) { el.width = Wc; el.height = Hc; const g = el.getContext('2d'), iw = im.naturalWidth, ih = im.naturalHeight, s = Wc / iw;
            const a = ih * 0.19, b = ih * 0.26, dash = ih * 0.342; // source rows: header/mirror end, band C start, dash top line
            const cY = Hc * 0.65 - (dash - b) * s, hA = a * s;
            g.clearRect(0, 0, Wc, Hc); g.drawImage(im, 0, 0, iw, a, 0, 0, Wc, hA);
            if (cY > hA) g.drawImage(im, 0, a, iw, b - a, 0, hA, Wc, cY - hA);
            g.drawImage(im, 0, b, iw, Math.min(ih - b, (Hc - cY) / s), 0, cY, Wc, Math.min(Hc - cY, (ih - b) * s)); el._drawn = key; } } }
      u.body.visible = !ck; }
    if (this.camMode === 'chase') {
      const L = u.dims.L; const back = L * 0.55 + 2.4 + Math.min(1.8, spd * 0.035), up = 1.05 + u.dims.H * 0.38 + Math.min(0.3, spd * 0.005); // tight chase; p51: pulls back a little with speed
      const fresh = !this.camPos;
      const yawC = this.camYaw = lerpAngle(fresh ? S.yaw : (this.camYaw ?? S.yaw), S.yaw, 1 - Math.exp(-4 * dt));
      const Sy = S.y + (S.hoverH || 0) + (S.liftJ || 0); this.camHeight = fresh ? Sy : (this.camHeight ?? Sy) + (Sy - (this.camHeight ?? Sy)) * (1 - Math.exp(-8 * dt)); // follows the hover car up
      const Lk = this.lookStep(dt, spd > 3), yv = yawC + Lk.yaw, Z = Lk.zoom; /* look-around offset, pinch zoom */
      const tx = S.x + Math.sin(yv) * back * Z * (1 - Lk.pitch * 0.25), tz = S.z + Math.cos(yv) * back * Z * (1 - Lk.pitch * 0.25);
      let ty = this.camHeight + up * Math.pow(Z, 0.7) + Lk.pitch * 3.2;
      if (S.y < -1) ty = Math.min(ty, S.y + 3.2); // stay under tunnel roofs
      if (!this.camPos) this.camPos = new THREE.Vector3(tx, ty, tz);
      this.camPos.lerp(_v1.set(tx, ty, tz), 1 - Math.exp(-10 * dt));
      { // keep the chase camera out of buildings: pull it in front of any wall between the car and the camera
        const w = this.w.wallCross(S.x, S.z, this.camPos.x, this.camPos.z, S.y);
        // p51: the pull-in is eased (fast in, slow back out) so the view doesn't pop when a wall flicks in and out of the line
        const want = w && this.camPos.y < 30 ? Math.max(0.15, w.t - 0.12) : 1; this._pull = want < (this._pull ?? 1) ? want : (this._pull ?? 1) + (want - (this._pull ?? 1)) * (1 - Math.exp(-3 * dt));
        const t = this._pull; this._camOut = (this._camOut || new THREE.Vector3()).set(S.x + (this.camPos.x - S.x) * t, this.camPos.y, S.z + (this.camPos.z - S.z) * t);
      }
      cam.position.copy(this._camOut); this.camGround(cam); { const la = (6 + Math.min(5, spd * 0.12)) * (1 - Math.min(1, Math.abs(Lk.yaw))); cam.lookAt(S.x - Math.sin(yv) * la, this.camHeight + 0.45, S.z - Math.cos(yv) * la); } /* p51: looks further ahead at speed */ cam.clearViewOffset();
    } else if (this.camMode === 'cockpit' || this.camMode === 'bonnet') {
      const p = _v2.copy(this.camMode === 'cockpit' ? u.cockpit : u.bonnetCam); if (this.camMode === 'cockpit' && this.car?.id === 'kitt') { p.z -= 0.05; } // KITT: sit a little closer to his dash
      if (this.camMode === 'cockpit' && !this.cockpitInstruments && this.car?.id !== 'kitt' && this.car?.id !== 'bond')
        this.cockpitInstruments = new CockpitInstruments(u.body, p, !!u.steeringWheel || u.real === 'db9', u.real === 'rrs' || u.real === 'box'); if (this.cockpitInstruments) this.cockpitInstruments.top = this.car?.top;
      o.updateMatrixWorld(); u.body.updateMatrixWorld();
      const wp = p.applyMatrix4(u.body.matrixWorld); cam.position.copy(wp);
      const kc = this.camMode === 'cockpit' && this.car?.id === 'kitt'; const ahead = _v3.set(0, kc ? -0.12 : this.camMode === 'cockpit' ? (u.real === 'rrs' || u.real === 'box' ? -0.07 : -0.10) : -0.015, -1).applyQuaternion(o.quaternion); // KITT looks slightly down and across so the cluster and dash TV are in view
      { const Lk = this.lookStep(dt, spd > 3); ahead.applyAxisAngle(_UPL, Math.max(-2.6, Math.min(2.6, Lk.yaw))); ahead.y -= Lk.pitch * 0.5; } /* drag to look round inside the car */
      cam.lookAt(wp.x + ahead.x * 10, wp.y + ahead.y * 10, wp.z + ahead.z * 10);
      this.camPos = null;
    } else {
      const O = this.orbit;
      if (!O.held && performance.now() - (O.rel || 0) > 600) { // 360 view springs back to dead centre behind the car once you let go
        const k = Math.min(1, dt * 2.5); O.yaw = Math.atan2(Math.sin(O.yaw), Math.cos(O.yaw)) * (1 - k); O.pitch += (0.2 - O.pitch) * k; O.dist += (6.2 - O.dist) * k * 0.5; }
      const yaw = S.yaw + O.yaw; const d = O.dist;
      cam.position.set(S.x + Math.sin(yaw) * Math.cos(O.pitch) * d, S.y + (S.hoverH || 0) + 0.8 + Math.sin(O.pitch) * d, S.z + Math.cos(yaw) * Math.cos(O.pitch) * d);
      if (S.y < -1) cam.position.y = Math.min(cam.position.y, S.y + 3.5);
      { const w = this.w.wallCross(S.x, S.z, cam.position.x, cam.position.z, S.y); if (w && cam.position.y < 30) { const t = Math.max(0.15, w.t - 0.12); cam.position.x = S.x + (cam.position.x - S.x) * t; cam.position.z = S.z + (cam.position.z - S.z) * t; } this.camGround(cam); } // p51: 360 view never inside a wall / under the road
      cam.lookAt(S.x, S.y + (S.hoverH || 0) + 0.8, S.z); this.camPos = null;
    }
    this.cockpitInstruments?.update(S, dt, this.camMode === 'cockpit', this.P.redline,
      this.inp.hPattern ? (S.gear < 0 ? 'R' : S.gear === 0 ? 'N' : S.gear) :
        S.reverse ? 'R' : Math.abs(S.vx) < 0.3 && this.inp.throttle < 0.05 && !this.P.ev ? 'N' : this.P.ev ? 'D' : S.gear);
    if (this.camMode === 'chase') { this.shake *= Math.pow(0.02, dt); } // stable chase: no random impact or speed jitter
    else if (this.shake > 0.01) { cam.position.x += (Math.random() - 0.5) * this.shake * 0.3; cam.position.y += (Math.random() - 0.5) * this.shake * 0.2; this.shake *= Math.pow(0.02, dt); }
    else if (this.s.graphics.shake && spd > 40 && this.camMode !== 'orbit') { cam.position.y += (Math.random() - 0.5) * 0.012 * (spd - 40) / 20; }
    this.foot?.cam(dt);
    this.ktv?.step(dt, this.g, this.camMode === 'cockpit' && !this.foot?.active, !!this.S.reverse); // after every camera move (incl. shake), so the clip player stays locked to the TV
    if (this.app.vr?.active) this.app.vr.update(dt, this); // p52 VR seat / hands / wheel / dash
    if (this.shotCam) { const c = this.shotCam; cam.position.set(c[0], c[1], c[2]); cam.lookAt(c[3], c[4], c[5]); cam.clearViewOffset(); } // test screenshots only (tests/x_lm_shots.mjs)
  }
  dispose() { this.app.rumble?.stop();
    this.foot?.dispose(); this.foot = null;
    this.cockpitInstruments?.dispose();
    { const el = document.getElementById('ckov'); if (el) el.style.display = 'none'; }
    this.w.setRaceKit?.(null);
    this.ai?.dispose(); this.ai = null;
    this.unbind(); this.eng?.stop(); for (const R of this.remotes.values()) { R.eng?.stop(); R.tag.remove(); } this.remotes.clear();
    this.off?.forEach(f => f()); this.scene.remove(this.group); this.a.setRain(false); this.hud.hide();
  }
}

export function fmt(t) { if (t == null) return '—'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`; }
function lerpAngle(a, b, k) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * k; }
let _ft; function flameTex() { if (_ft) return _ft; const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, 'rgba(255,255,220,1)'); gr.addColorStop(0.3, 'rgba(255,170,60,0.9)'); gr.addColorStop(1, 'rgba(255,60,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); _ft = new THREE.CanvasTexture(c); return _ft; }
