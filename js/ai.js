// Solo-race AI opponents: 0-7 computer drivers on the same physics (shared/physics.js) and world collision as the player.
// Each follows a racing line built from the route centreline (Laplacian-smoothed inside the 14 m track, so it cuts
// apexes), with pure-pursuit steering on a speed-dependent lookahead, a per-car curvature speed profile with a braking
// back-pass, per-driver skill / aggression / lane, simple overtaking, mild rubber-banding, respawn when stuck or off the
// track, gates (checkpoints) like the player, and car-car contact (two circles per car). Solo sprints / circuits only:
// never created online, in open-world races, trials, tests or the tutorial.
import { deriveParams, newState, step } from '../shared/physics.js';
import { buildCar, setLights, poseCar } from './carmodel.js';

export const AI_CARS = ['r6a', 'db9v', 'box986', 'gti8', 'rrs23', 'r8', 'hurac', 'avent', 'f458'];
const NAMES = ['Kez "Digbeth" Malik', 'Jaz Okafor', 'Ricky Balti', 'Priya Sandhu', 'Danny Two-Tone', 'Leanne Brindley', 'Mo Hussain', 'Tasha Cole', 'Big Dev', 'Sian Moseley', 'Aaron Kaur', 'Callum Reece'];
const PAINTS = [0xd0121b, 0x1f5fd6, 0xf2f2f2, 0x111214, 0xffc21a, 0x19a35b, 0xff6a00, 0x7a2bd1, 0x8f9aa6, 0x0bb6c9, 0xe8457a, 0x2b3a55];
// grip used in corners (fraction of the tyre limit), braking decel (g), throttle cap, line spread
export const DIFF = {
  easy: { skill: [0.78, 0.86], brake: 0.62, thr: 0.86, react: [0.35, 0.7] },
  normal: { skill: [0.87, 0.94], brake: 0.74, thr: 1, react: [0.2, 0.45] },
  hard: { skill: [0.94, 1.0], brake: 0.84, thr: 1, react: [0.1, 0.28] },
};
export function aiWanted(o) { return !o.online && !o.worldRace && (o.mode === 'sprint' || o.mode === 'circuit') && !!o.route; }
// choose the field (car, paint, name, skill...) up front so the menu can preload the models and "Race again" repeats it
export function pickField(n, diff = 'normal', seed = Date.now()) {
  let r = (seed >>> 0) || 1; const rnd = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  const D = DIFF[diff] || DIFF.normal; const cars = [...AI_CARS].sort(() => rnd() - 0.5), names = [...NAMES].sort(() => rnd() - 0.5), paints = [...PAINTS].sort(() => rnd() - 0.5);
  const out = [];
  for (let i = 0; i < Math.max(0, Math.min(7, n | 0)); i++) out.push({ car: cars[i % cars.length], colour: paints[i % paints.length], name: names[i], skill: D.skill[0] + rnd() * (D.skill[1] - D.skill[0]), aggr: rnd(), lane: (rnd() - 0.5) * 2.2, react: D.react[0] + rnd() * (D.react[1] - D.react[0]) });
  return { diff, field: out };
}

// ---------------------------------------------------------------- racing line (cached per route)
const LINES = new WeakMap();
function lineFor(route) {
  let L = LINES.get(route); if (L) return L;
  const circ = route.mode === 'circuit'; let P = route.path.map(p => [p[0], p[1]]);
  if (circ && P.length > 2 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 0.5) P.pop();
  const n = P.length, at = i => circ ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
  const nx = new Float32Array(n), nz = new Float32Array(n), s = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) { const a = P[at(i - 1)], b = P[at(i + 1)]; let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; nx[i] = -dz; nz[i] = dx; } // left-hand normal of travel? (sign irrelevant, consistent)
  for (let i = 1; i <= n; i++) { const a = P[i - 1], b = P[at(i)]; s[i] = s[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]); }
  const len = circ ? s[n] : s[n - 1];
  // smoothed racing line: offset along the normal, within +-4.6 m of the centre (14 m road, ~2 m car)
  const off = new Float32Array(n), MAXO = 4.6;
  for (let it = 0; it < 90; it++) for (let i = 0; i < n; i++) {
    if (!circ && (i < 3 || i > n - 4)) continue; let ax = 0, az = 0, c = 0;
    for (let k = -3; k <= 3; k++) { if (!k) continue; const j = at(i + k); ax += P[j][0] + nx[j] * off[j]; az += P[j][1] + nz[j] * off[j]; c++; }
    ax /= c; az /= c; const px = P[i][0] + nx[i] * off[i], pz = P[i][1] + nz[i] * off[i];
    off[i] = Math.max(-MAXO, Math.min(MAXO, off[i] + ((ax - px) * nx[i] + (az - pz) * nz[i]) * 0.6));
  }
  // curvature of the line (heading change over ~+-3 points), spread to neighbours (max) so braking starts before the apex
  const k0 = new Float32Array(n), kap = new Float32Array(n), lx = i => P[at(i)][0] + nx[at(i)] * off[at(i)], lz = i => P[at(i)][1] + nz[at(i)] * off[at(i)];
  for (let i = 0; i < n; i++) { const a1 = Math.atan2(lx(i) - lx(i - 3), lz(i) - lz(i - 3)), a2 = Math.atan2(lx(i + 3) - lx(i), lz(i + 3) - lz(i)); let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; const ds = Math.max(4, Math.hypot(lx(i + 3) - lx(i - 3), lz(i + 3) - lz(i - 3))); k0[i] = Math.abs(d) / (ds / 2); }
  for (let i = 0; i < n; i++) { let m = 0; for (let k = -2; k <= 2; k++) m = Math.max(m, k0[at(i + k)]); kap[i] = m; }
  L = { P, n, nx, nz, s, len, off, kap, circ, at };
  LINES.set(route, L); return L;
}
// speed profile for one car: corner limit sqrt(a_lat / k), then a braking back-pass (two sweeps round a circuit)
function profile(L, P, skill, brakeG, wet) {
  const n = L.n, v = new Float32Array(n), mu = P.mu * (wet ? 0.72 : 1), alat = 9.81 * mu * 0.93 * skill * skill, ab = 9.81 * brakeG * (wet ? 0.75 : 1) * (0.9 + 0.1 * skill);
  for (let i = 0; i < n; i++) v[i] = Math.min(95, Math.sqrt(alat / Math.max(1e-4, L.kap[i])));
  for (let sw = 0; sw < (L.circ ? 2 : 1); sw++) for (let i = n - 2 + (L.circ ? 1 : 0); i >= 0; i--) { const j = L.at(i + 1), ds = Math.max(0.5, L.s[i + 1] - L.s[i]); v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * ab * ds)); }
  return v;
}

// progress tracker along the centreline (used for AI and the player: rubber-banding, positions, result estimates)
export class Tracker {
  constructor(L, x, z) { this.L = L; this.i = nearest(L, x, z, 0, L.n); this.lap = L.circ && this.i > L.n / 2 ? -1 : 0; }
  update(x, z) { const L = this.L, p = this.i; let i = nearestWin(L, x, z, p - 6, p + 16); if (L.circ) { if (p > L.n * 0.8 && i < L.n * 0.2) this.lap++; else if (p < L.n * 0.2 && i > L.n * 0.8) this.lap--; } this.i = i; return this; }
  get dist() { return this.lap * this.L.len + this.L.s[this.i]; }
}
function nearest(L, x, z, a, b) { let bi = 0, bd = 1e18; for (let i = a; i < b; i++) { const q = L.P[i], d = (q[0] - x) ** 2 + (q[1] - z) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; }
function nearestWin(L, x, z, a, b) { let bi = L.at(a), bd = 1e18; for (let k = a; k <= b; k++) { const i = L.at(k), q = L.P[i], d = (q[0] - x) ** 2 + (q[1] - z) ** 2; if (d < bd) { bd = d; bi = i; } } if (bd > 900) return nearest(L, x, z, 0, L.n); return bi; }

const DT = 1 / 120;
export class AIField {
  // sess: the solo Session. spec: {diff, field:[...]} from pickField. Grid slots: AI 0..n-1 fill from pole; the player is behind them.
  constructor(sess, spec) {
    this.sess = sess; this.spec = spec; this.L = lineFor(sess.route); this.cars = []; this.D = DIFF[spec.diff] || DIFF.normal;
    const g = sess.s.graphics, wet = !!sess.wet, proto = Object.getPrototypeOf(sess);
    spec.field.forEach((f, k) => {
      const car = sess.app.carsById[f.car] || sess.app.carsById.db9v;
      const P = deriveParams(car, {}, sess.app.calib[car.id] || {});
      const obj = buildCar(car, { detail: Math.min(1, g.carDetail), colour: f.colour, plate: 'CUZ ' + (k + 1) });
      obj.traverse(o => { if (o.isMesh) o.castShadow = g.shadows > 0; }); sess.group.add(obj);
      const [x, z, yaw] = sess.route.grid[k % sess.route.grid.length]; const h = sess.w.groundAt(x, z, 0).h ?? 0;
      const S = Object.assign(newState(x, z, yaw), { y: h, vyv: 0, gear: 1 });
      // the world-collision body: a stripped Session sharing its poseBad / collide / recoverPose / wallHit (same rules as the player)
      const B = Object.assign(Object.create(proto), { w: sess.w, obj, S, o: { mode: 'ai' }, remotes: new Map(), a: { impact() { } }, s: { graphics: { shake: false } }, lastImpact: Infinity, okPose: null, prevXZ: null });
      const A = { k, id: 'ai' + k, name: f.name, car, carId: car.id, P, obj, S, B, f, inp: { throttle: 0, brake: 1, steer: 0, handbrake: 0, shiftUp: 0, shiftDown: 0, reverseToggle: 0, wantReverse: 0, wantForward: 1 },
        vp: profile(this.L, P, f.skill, this.D.brake * (0.95 + 0.1 * f.aggr), wet), tr: new Tracker(this.L, x, z), cp: 0, prevAlong: null, fin: null, lane: f.lane, laneT: f.lane, stuckT: 0, offT: 0, maxStuck: 0, respawns: 0, lowT: 0, maxLow: 0, rb: 0, go: 0 };
      A.tag = sess.hud.nameTag(f.name); A.tag.el.classList.add('ai');
      if (sess.a.ready) { car._up = {}; A.eng = sess.a.createEngine(car, A.id); }
      this.cars.push(A);
    });
    this.me = new Tracker(this.L, sess.S.x, sess.S.z);
    this.opts = { auto: true, abs: true, tc: true, esc: true, steerAssist: 0.6, wet: sess.wet, onePedal: false, regenLevel: 1, evConsumption: false };
  }
  // ---------------------------------------------------------------- per physics step
  step(dt = DT) {
    const s = this.sess, racing = s.state === 'race' || s.state === 'finished', L = this.L;
    this.me.update(s.S.x, s.S.z);
    for (const A of this.cars) {
      const S = A.S;
      if (!racing) { A.inp.throttle = 0; A.inp.brake = 1; A.inp.steer = 0; }
      else { A.go += dt; if (A.go < A.f.react) { A.inp.brake = 1; A.inp.throttle = 0; } else this.drive(A, dt); }
      step(A.P, S, A.inp, this.opts, dt); A.inp.shiftUp = A.inp.shiftDown = A.inp.reverseToggle = 0;
    }
    this.contacts();
    for (const A of this.cars) {
      A.B.collide(dt); A.tr.update(A.S.x, A.S.z);
      if (A.fin != null && !L.circ) { A.ghost = true; if (Math.abs(A.S.vx) < 1) A.gone = true; } // past the sprint finish: no contact, then leaves the road once stopped
      if (racing && A.go > A.f.react + 0.5) this.watch(A, dt);
      if (s.state === 'race' || s.state === 'finished') this.gate(A);
    }
  }
  drive(A, dt) {
    const L = this.L, S = A.S, i = A.tr.i, v = Math.max(0, S.vx), s = this.sess;
    // rubber band (mild): +-5 % target speed when 350 m+ behind / ahead of the player (never after the player finishes)
    const gap = this.noRubber || s.state === 'finished' ? 0 : this.me.dist - A.tr.dist; A.rb += ((Math.max(-1, Math.min(1, gap / 350)) * 0.05) - A.rb) * Math.min(1, dt * 0.5);
    // traffic: nearest car ahead on our line -> move over to pass (aggressive drivers commit closer), or follow it
    const fx = -Math.sin(S.yaw), fz = -Math.cos(S.yaw); let block = null, bd = 1e9;
    const nI = L.nx[i], nZ = L.nz[i], myLat = (S.x - L.P[i][0]) * nI + (S.z - L.P[i][1]) * nZ;
    for (const o of this.others(A)) { const dx = o.S.x - S.x, dz = o.S.z - S.z, al = dx * fx + dz * fz; if (al < 1 || al > 22 + A.f.aggr * 6) continue; const lat = (o.S.x - L.P[i][0]) * nI + (o.S.z - L.P[i][1]) * nZ; if (Math.abs(lat - myLat) > 2.4) continue; if (al < bd) { bd = al; block = { o, lat, v: o.S.vx }; } }
    const lineOff = L.off[i];
    if (block && block.v < v + 2) { const side = block.lat > myLat ? -1 : 1; A.laneT = Math.max(-5.2 - lineOff, Math.min(5.2 - lineOff, block.lat - lineOff + side * 3.1)); A.passT = 1.5; }
    else if ((A.passT = (A.passT || 0) - dt) < 0) A.laneT = A.f.lane * 0.5;
    A.lane += Math.max(-1.6 * dt, Math.min(1.6 * dt, A.laneT - A.lane));
    // pure-pursuit steering on the racing line at a speed-dependent lookahead
    const Ld = 7 + v * 0.5; let j = i; for (let c = 0, sd = 0; c < 300 && sd < Ld; c++) { if (!L.circ && j + 1 >= L.n) break; sd += L.s[j + 1] - L.s[j]; j = L.at(j + 1); }
    let lat = L.off[j] + A.lane; lat = Math.max(-5.4, Math.min(5.4, lat));
    let tx = L.P[j][0] + L.nx[j] * lat, tz = L.P[j][1] + L.nz[j] * lat;
    if (!L.circ && j >= L.n - 1) { tx += (L.P[L.n - 1][0] - L.P[L.n - 2][0]) * 6; tz += (L.P[L.n - 1][1] - L.P[L.n - 2][1]) * 6; } // past the sprint finish: carry on straight
    const dx = tx - S.x, dz = tz - S.z, lx = -Math.cos(S.yaw), lz = Math.sin(S.yaw);
    const alpha = Math.atan2(dx * lx + dz * lz, dx * fx + dz * fz), D = Math.max(3, Math.hypot(dx, dz));
    const lock = A.P.steerMax / (1 + S.vx * S.vx / ((A.P.h > 0.6 ? 520 : 650) * (1.25 - 0.45 * 0.6)));
    const delta = Math.atan(2 * A.P.L * Math.sin(alpha) / D);
    A.inp.steer = Math.max(-1, Math.min(1, delta / lock - (S.r || 0) * 0.04));
    // speed: profile a little ahead (brake points already in it), rubber band, following, cool-down after the flag
    let vt = 1e9; for (let k = 0; k < 4; k++) vt = Math.min(vt, A.vp[L.at(i + k)]);
    vt *= 1 + A.rb; if (Math.abs(alpha) > 0.6) vt = Math.min(vt, 12); // well off line (after contact / respawn): slow and rejoin
    if (block && bd < 12 && block.v < v && A.passT > 1.2) vt = Math.min(vt, block.v + 1 + A.f.aggr * 2);
    if (A.fin != null) vt = Math.min(vt, L.circ ? 18 : Math.max(0, v - 6 * dt * 20)); // cool-down lap / roll to a stop past the sprint finish
    const e = vt - v;
    if (e > 0.4) { A.inp.throttle = Math.min(this.D.thr, 0.35 + e * 0.35); A.inp.brake = 0; }
    else if (e < -0.8) { A.inp.throttle = 0; A.inp.brake = Math.min(1, 0.15 - e * 0.12); }
    else { A.inp.throttle = 0.25; A.inp.brake = 0; }
    if (S.reverse) A.inp.reverseToggle = 1; // never reverse (a stuck car respawns)
    A.inp.handbrake = 0;
  }
  others(A) { const s = this.sess, list = []; for (const B of this.cars) if (B !== A && !B.ghost) list.push(B); if (!this.ghostPlayer) list.push({ S: s.S }); return list; }
  // stuck / off-track watch: respawn on the line behind after 2.5 s nearly stopped or 1.5 s off the track
  watch(A, dt) {
    const S = A.S, L = this.L, i = A.tr.i, v = Math.abs(S.vx), q = L.P[i];
    const lat = Math.hypot(S.x - q[0], S.z - q[1]);
    const done = A.fin != null && (!L.circ || v < 1); // parked after the flag
    if (v < 1.5 && !done) A.stuckT += dt; else A.stuckT = Math.max(0, A.stuckT - dt * 2);
    if (v < 1 && !done) { A.lowT += dt; A.maxLow = Math.max(A.maxLow, A.lowT); } else A.lowT = 0;
    if (lat > 10.5 && (L.circ || i > 2) && !this.sess.w.onTrack(S.x, S.z, 2)) A.offT += dt; else A.offT = 0; // off the race track (the grid sits behind a sprint's first path point)
    if (!done && (A.stuckT > 2.5 || A.offT > 1.5 || Math.abs(S.y - (A.lastY ?? S.y)) > 6)) { (this.log || (this.log = [])).length < 60 && this.log.push([A.carId, A.stuckT > 2.5 ? 'stuck' : A.offT > 1.5 ? 'off' : 'y', i, +S.x.toFixed(0), +S.z.toFixed(0), +lat.toFixed(1)]); this.respawn(A); }
    A.lastY = S.y;
  }
  respawn(A) {
    const L = this.L, s = this.sess; A.respawns++;
    for (let back = 3; back < 40; back += 3) {
      const i = L.circ ? L.at(A.tr.i - back) : Math.max(0, A.tr.i - back), j = L.at(i + 1);
      for (const lat of [0, 3, -3]) {
        const x = L.P[i][0] + L.nx[i] * lat, z = L.P[i][1] + L.nz[i] * lat;
        if (this.others(A).some(o => Math.hypot(o.S.x - x, o.S.z - z) < 7)) continue;
        const yaw = Math.atan2(-(L.P[j][0] - L.P[i][0]), -(L.P[j][1] - L.P[i][1])), h = s.w.groundAt(x, z, 0).h ?? 0;
        if (A.B.poseBad(x, z, yaw, h)) continue;
        A.S = A.B.S = Object.assign(newState(x, z, yaw), { y: h, vyv: 0, gear: 1, vx: 6 }); A.B.okPose = null; A.B.prevXZ = null;
        A.stuckT = A.offT = A.lowT = 0; A.tr.i = i; A.prevAlong = null; A.lane = A.laneT = 0; return;
      }
    }
    A.stuckT = 1.5; A.offT = 0.5; // nowhere free this step: try again in a second
  }
  gate(A) {
    const s = this.sess, c = s.cps[A.cp]; if (!c || A.fin != null) return;
    const dx = A.S.x - c[0], dz = A.S.z - c[1], fx = -Math.sin(c[3]), fz = -Math.cos(c[3]);
    const along = dx * fx + dz * fz, lat = Math.abs(dx * -fz + dz * fx);
    if (Math.abs(A.S.y - c[2]) < 4 && lat < Math.max(8, c[4]) / 2 + 5 && along > -1 && along < 12) {
      if (A.prevAlong != null && A.prevAlong <= 0 || Math.hypot(dx, dz) < 6) { A.cp++; A.prevAlong = null; if (A.cp >= s.cps.length) A.fin = +s.raceT.toFixed(3); return; }
    }
    A.prevAlong = along;
  }
  // car-car contact: each car = two circles (front / rear axle line); push apart by mass, velocity into the other removed
  contacts() {
    const s = this.sess, bodies = this.cars.filter(A => !A.ghost).map(A => ({ S: A.S, P: A.P, hit: (ux, uz, b) => A.B.wallHit(ux, uz, b), d: A.obj.userData.dims }));
    if (!this.ghostPlayer && s.state !== 'finished') bodies.push({ S: s.S, P: s.P, hit: (ux, uz, b) => s.wallHit(ux, uz, b), d: s.obj.userData.dims, me: true });
    for (let a = 0; a < bodies.length; a++) for (let b = a + 1; b < bodies.length; b++) {
      const A = bodies[a], B = bodies[b]; if (Math.abs(A.S.x - B.S.x) > 7 || Math.abs(A.S.z - B.S.z) > 7 || Math.abs((A.S.y || 0) - (B.S.y || 0)) > 2) continue;
      let best = null;
      const ra = (A.d?.W || 1.9) / 2, rb = (B.d?.W || 1.9) / 2, ea = Math.max(0.3, (A.d?.L || 4.4) / 2 - ra), eb = Math.max(0.3, (B.d?.L || 4.4) / 2 - rb);
      for (const ka of [-1, 1]) for (const kb of [-1, 1]) {
        const ax = A.S.x - Math.sin(A.S.yaw) * ea * ka, az = A.S.z - Math.cos(A.S.yaw) * ea * ka, bx = B.S.x - Math.sin(B.S.yaw) * eb * kb, bz = B.S.z - Math.cos(B.S.yaw) * eb * kb;
        const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz), pen = ra + rb - d; if (pen > 0 && (!best || pen > best.pen)) best = { pen, ux: d > 1e-4 ? dx / d : 1, uz: d > 1e-4 ? dz / d : 0 };
      }
      if (!best) continue;
      const wa = B.P.m / (A.P.m + B.P.m), wb = 1 - wa; // heavier car moves less
      A.S.x -= best.ux * best.pen * wa; A.S.z -= best.uz * best.pen * wa; B.S.x += best.ux * best.pen * wb; B.S.z += best.uz * best.pen * wb;
      A.hit(best.ux, best.uz, 0.15); B.hit(-best.ux, -best.uz, 0.15);
      if (A.me || B.me) this.playerHits = (this.playerHits || 0) + 1; else this.aiHits = (this.aiHits || 0) + 1;
    }
  }
  // ---------------------------------------------------------------- per frame visuals
  visuals(dt, blink, night) {
    const s = this.sess, cam = s.g.cam;
    for (const A of this.cars) {
      const S = A.S; A.obj.position.set(S.x, S.y, S.z); A.obj.rotation.set(S.pitchG || 0, S.yaw, 0, 'YXZ'); S.visLift = s.visLiftAt(S.x, S.z, S.y); poseCar(A.obj, S, A.P, dt);
      setLights(A.obj, { head: night || s.wet ? 1 : 0, brake: A.inp.brake > 0.1 && s.state !== 'countdown', rev: false, blink: false }, night);
      A.obj.visible = !A.gone; if (A.gone) { A.tag.hide(); continue; }
      A.tag.at(A.obj.position, cam, '', 160);
      if (A.eng) { const dx = S.x - s.S.x, dz = S.z - s.S.z, d = Math.hypot(dx, dz); const rx = Math.cos(cam.rotation.y), rz = -Math.sin(cam.rotation.y);
        A.eng.update({ rpm: S.rpm, throttle: A.inp.throttle, overrun: S.overrun, boost: S.boost, kwOut: S.kwOut, gear: S.gear, slipF: S.slipF, slipR: S.slipR }, dt, { dist: d, pan: (dx * rx + dz * rz) / Math.max(10, d), speed: Math.abs(S.vx), crackle: 0.4 }); }
    }
  }
  // ---------------------------------------------------------------- standings
  // live order: finished by time, then gates passed, then distance to the next gate
  order() {
    const s = this.sess, cd = (cp, S) => s.cps[cp] ? Math.hypot(S.x - s.cps[cp][0], S.z - s.cps[cp][1]) : 0;
    const list = [{ id: 'me', me: true, cp: s.cp, d: cd(s.cp, s.S), fin: s.state === 'finished' ? s.finalT : null, dist: this.me.dist }];
    for (const A of this.cars) list.push({ id: A.id, A, cp: A.cp, d: cd(A.cp, A.S), fin: A.fin, dist: A.tr.dist });
    list.sort((a, b) => (a.fin != null || b.fin != null) ? ((a.fin ?? 1e9) - (b.fin ?? 1e9)) : (b.cp - a.cp) || (a.d - b.d));
    return list;
  }
  position() { const o = this.order(); return [o.findIndex(x => x.me) + 1, o.length]; }
  // final table when the player finishes: unfinished AI get an estimate from their average pace so far
  standings(meName) {
    const s = this.sess, total = this.L.circ ? s.laps * this.L.len : this.L.len, T = s.finalT ?? s.raceT, rows = [];
    rows.push({ name: meName, car: s.car.name, time: T, me: true });
    for (const A of this.cars) {
      if (A.fin != null) rows.push({ name: A.name, car: A.car.name, time: A.fin });
      else { if (!A.vMean) { let tt = 0; for (let i = 0; i < this.L.n - 1; i++) tt += (this.L.s[i + 1] - this.L.s[i]) / Math.max(3, A.vp[i]); A.vMean = this.L.s[this.L.n - 1] / Math.max(1, tt); }
        const done = Math.max(1, A.tr.dist), pace = Math.max(done / Math.max(1, s.raceT), 0.75 * A.vMean); // own pace so far, floored at 75 % of its line speed
        rows.push({ name: A.name, car: A.car.name, time: s.raceT + Math.max(0, total - done) / Math.max(5, pace), est: true }); }
    }
    rows.sort((a, b) => a.time - b.time); return rows;
  }
  dispose() { for (const A of this.cars) { A.eng?.stop(); A.tag.remove(); } this.cars = []; }
}
