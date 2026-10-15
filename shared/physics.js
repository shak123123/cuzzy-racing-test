// CUZZY RACING — vehicle dynamics (shared by the game client and the Node calibration tests).
// Planar two-axle model with load transfer, friction-circle tyres, drivetrain layout, gearbox,
// turbo lag, aero drag/downforce, assists (ABS/TC/ESC), EV motors with regen and one-pedal driving.
// No rendering dependencies.

export const G = 9.81, RHO = 1.225;

const BODY = { // CoG height (m), base CdA (m²), lift coeff*area (negative = downforce), tyre base mu, cornering stiffness factor
  hatch3: [0.52, 0.66, 0.00, 1.02, 11], hatch5: [0.54, 0.68, 0.00, 1.04, 11], saloon: [0.52, 0.62, -0.02, 1.02, 11],
  estate: [0.55, 0.66, 0.00, 1.00, 10.5], suv: [0.72, 0.98, 0.00, 0.98, 9], crossover: [0.64, 0.82, 0.00, 0.99, 10],
  offroad: [0.82, 1.35, 0.00, 0.90, 7.5], coupe: [0.48, 0.60, -0.05, 1.06, 12], gt: [0.49, 0.62, -0.03, 1.06, 11],
  muscle: [0.52, 0.72, -0.02, 1.01, 10.5], mid: [0.44, 0.62, -0.30, 1.12, 13], rear: [0.46, 0.60, -0.22, 1.12, 13],
  roadster: [0.44, 0.62, -0.05, 1.07, 13], hyper: [0.42, 0.62, -0.40, 1.18, 14], fastback: [0.48, 0.55, -0.05, 1.04, 11.5],
  boxy: [0.52, 0.78, 0.00, 0.94, 9.5], classicmini: [0.48, 0.62, 0.00, 0.90, 10],
};
const AWD_SPLIT = { default: 0.4, haldex: 0.3, rearbias: 0.35 };

// longitudinal Pacejka magic formula (normalised to peak = 1): B 12, C 1.55, E 0.1 → peak at slip ratio ~0.14,
// ~0.75 of peak fully locked / spinning
const MFB = 12, MFC = 1.55, MFE = 0.1;
const mfraw = k => { const x = MFB * k; return Math.sin(MFC * Math.atan(x - MFE * (x - Math.atan(x)))); };
const KPK = (() => { let best = 0, kb = 0.1; for (let k = 0.01; k < 0.5; k += 0.002) { const f = mfraw(k); if (f > best) { best = f; kb = k; } } return kb; })();
const MFPK = mfraw(KPK);
export const mfx = k => mfraw(k) / MFPK;
const MFX_LOCK = mfx(1);

export function mph(v) { return v * 2.23694; }
export function fromMph(m) { return m / 2.23694; }

// ---------------- parameter derivation ----------------------------------------------------------
export function deriveParams(car, up = {}, calib = {}) {
  const B = BODY[car.body] || BODY.saloon;
  const ev = car.asp === 'EV';
  const u = normUpgrades(up, ev);
  const L = car.dims[3], W = car.dims[1];
  const mass = car.kg * (1 - u.weight * 0.035) + 75; // + driver
  const wf = car.wf / 100;
  const P = {
    id: car.id, ev, classic: !!car.classic, drive: car.drive,
    m: mass, L, a: L * (1 - wf), b: L * wf, h: B[0] * (1 - u.susp * 0.03), track: W * 0.86,
    Izz: mass * (car.dims[0] ** 2 + W ** 2) / 12 * 0.95,
    rw: car.body === 'classicmini' ? 0.26 : car.body === 'suv' || car.body === 'offroad' ? 0.40 : car.classic ? 0.30 : 0.34,
    mu: B[3] + [0, 0.05, 0.1, 0.17][u.tyres] - (car.classic ? 0.06 : 0),
    Cs: B[4] * (1 + u.susp * 0.06), // cornering stiffness per unit load (1/rad)
    lt: 0.14 - u.susp * 0.025, // load-sensitivity (lateral transfer penalty)
    CdA: B[1] * (1 + u.aero * 0.03), ClA: B[2] - u.aero * 0.12, crr: 0.012,
    steerMax: (car.body === 'suv' || car.body === 'offroad' ? 0.55 : 0.6), steerRate: car.steerSlow ? 1.6 : car.classic ? 2.3 : (car.body === 'suv' || car.body === 'offroad') ? 4.2 : 5.5, // rad/s at the road wheels (first-game rack speeds)
    brakeMax: (car.classic ? 0.78 : 1.0) * (1 + u.brakes * 0.09), brakeBias: 0.64,
    split: car.drive === 'FWD' ? 1 : car.drive === 'RWD' ? 0 : (ev ? 0.45 : car.body === 'mid' || car.body === 'rear' ? 0.3 : 0.4),
    lsd: 0.75 + u.diff * 0.08 + (car.drive === 'AWD' ? 0.1 : 0),
    boxType: gearboxType(car),
    tyreClass: u.tyres,
    // roll-stiffness distribution (front share of lateral load transfer): front-heavy hatches/SUVs carry more at the
    // front (safe understeer), mid/rear-engined cars more at the rear axle's expense less → they can rotate / oversteer
    rsF: car.drive === 'FWD' ? 0.64 : car.body === 'suv' || car.body === 'offroad' ? 0.6 : car.body === 'mid' || car.body === 'rear' || car.body === 'hyper' ? 0.47 : car.body === 'roadster' ? 0.5 : 0.55,
    // per-axle tyre balance (static): FWD pushes, RWD sits closest to neutral
    kF: car.drive === 'FWD' ? 0.955 : car.drive === 'RWD' ? 0.975 : 0.965, kR: car.drive === 'FWD' ? 1.045 : car.drive === 'RWD' ? 1.025 : 1.035,
  };
  P.launchMu = calib.launchMu || 1;
  const tq = (calib.tq || 1) * (1 + u.engine * 0.07 + u.exhaust * 0.02 + u.turbo * (car.asp === 'NA' ? 0.03 : 0.06) + u.motor * 0.08);
  if (ev) {
    P.motorKW = (car.ev.kw) * tq;
    P.motorNm = car.nm * tq;
    P.maxRpm = 16000; P.redline = 16000; P.idle = 0;
    P.gears = car.gears === 2 ? [15.5, 8.0] : [0]; // filled below
    P.boostLag = 0; P.asp = 'EV';
    P.kwh = car.ev.kwh; P.regen = 1; P.cooling = u.cooling;
  } else {
    P.peakKW = car.bhp * 0.7457 * tq; P.peakNm = car.nm * tq; P.ebNm = car.nm * (calib.tq || 1) * 0.12; // engine braking from the STOCK engine (tunes add power, not stopping power)
    P.redline = car.redline; P.idle = car.classic ? 900 : 750;
    P.asp = car.asp; P.boostLag = Math.max(0.03, (car.lag || 0) * (1 - u.turbo * 0.18));
    P.rpmP = car.asp === 'NA' ? car.redline * 0.9 : car.redline * 0.85;
    P.rpmT0 = car.asp === 'NA' ? car.redline * 0.6 : car.asp === 'SC' ? car.redline * 0.3 : car.redline * (car.classic ? 0.4 : 0.3);
  }
  // top speed & drag solve
  // Drag is solved from the STOCK car (stock power, mass, top speed) so power/weight upgrades never change aerodynamic
  // drag — otherwise extra power would raise CdA and shorten braking distances. Power upgrades then raise the
  // drag-limited top speed naturally (and the limiter by 1.2%/stage); only the aero part changes drag.
  const vTop = fromMph(car.top) * (1 + (u.engine + u.turbo + u.motor) * 0.012);
  const v0 = fromMph(car.top), tq0 = calib.tq || 1, m0 = car.kg + 75;
  const pw0 = (ev ? car.ev.kw * tq0 : car.bhp * 0.7457 * tq0) * 1000 * (ev ? 0.9 : 0.86);
  const need = (pw0 / v0 - P.crr * m0 * G) / (0.5 * RHO * v0 * v0);
  const aeroK = 1 + u.aero * 0.03; const cd0 = B[1];
  if (need > cd0 * 0.92) { P.CdA = Math.min(2.8, need) * aeroK; P.limiter = 0; }
  else { P.CdA = Math.min(cd0, need * 0.85) * aeroK; P.limiter = vTop; }
  P.vTop = vTop;
  // gearing
  const n = ev ? car.gears : car.gears;
  if (ev) {
    const top = (P.maxRpm * Math.PI / 30) * P.rw / (vTop * 1.02);
    P.final = 1; P.gears = car.gears === 2 ? [top * 1.9, top] : [top];
  } else {
    const rpmTop = car.asp === 'NA' ? P.rpmP * 1.0 : P.rpmP * 1.02;
    const topRatio = (rpmTop * Math.PI / 30) * P.rw / (vTop * (P.limiter ? 1.08 : 1));
    const v1 = vTop * Math.min(0.4, Math.max(0.15, 1.9 / (n + 1.3))) ; // gearbox upgrade = quicker shifts only; shortening 1st could add a shift before 60 mph and slow the car. 1st gear tops out at ~20-35% of vmax (real-world spread)
    const firstRatio = (P.redline * Math.PI / 30) * P.rw / v1;
    const g = [];
    for (let i = 0; i < n; i++) { const t = n === 1 ? 1 : Math.pow(i / (n - 1), 0.85); g.push(firstRatio * Math.pow(topRatio / firstRatio, t)); }
    P.final = 1; P.gears = g;
    if (car.ratios?.length === n) { P.final = car.final || 1; P.gears = car.ratios.slice(); } // p53: real gearbox ratios (hero car)
  }
  P.gearCount = P.gears.length;
  // shift timing: torque-interruption time (s) and launch-clutch engagement time (s)
  const BT = { dct: [0.08, 0.45], amt: [0.12, 0.5], auto: [0.13, 0.9], manual: [car.classic ? 0.34 : 0.28, 0.75], ev: [0.1, 0] }[P.boxType];
  P.shiftT = (car.shift || (P.boxType === 'auto' && car.gears <= 6 ? 0.15 : BT[0])) * (1 - u.gearbox * 0.12);
  P.launchT = BT[1];
  if (!ev) { // full-throttle upshift rpm per gear: where the next gear gives more wheel torque, capped short of the limiter
    P.upRpm = [];
    for (let i = 0; i < P.gearCount - 1; i++) {
      const k = P.gears[i + 1] / P.gears[i]; let r = P.rpmP * 0.9;
      for (; r < P.redline * 0.97; r += 25) if (engineTorque(P, r * k, 1) * P.gears[i + 1] > engineTorque(P, r, 1) * P.gears[i]) break;
      P.upRpm.push(Math.min(r, P.redline * 0.97));
    }
  }
  P.up = u;
  return P;
}

export function gearboxType(car) {
  if (car.asp === 'EV') return 'ev';
  if (/DCT|DSG|PDK|S tronic|LDF|MCT/.test(car.box)) return 'dct'; // twin-clutch (and AMG wet-clutch MCT)
  if (/single-clutch|ISR|SMG|sequential/.test(car.box)) return 'amt';
  if (/manual/.test(car.box)) return 'manual';
  return 'auto'; // torque-converter automatic
}

export function normUpgrades(up = {}, ev) {
  const g = k => Math.max(0, Math.min(3, up[k] | 0));
  return { engine: ev ? 0 : g('engine'), turbo: ev ? 0 : g('turbo'), exhaust: ev ? 0 : g('exhaust'), motor: ev ? g('motor') : 0,
    cooling: ev ? g('cooling') : 0, tyres: g('tyres'), brakes: g('brakes'), susp: g('susp'), weight: g('weight'),
    gearbox: g('gearbox'), diff: g('diff'), aero: g('aero') };
}

// engine torque at crank (Nm), before boost scaling
export function engineTorque(P, rpm, boost) {
  if (P.ev) {
    const w = Math.max(1, rpm * Math.PI / 30);
    return Math.min(P.motorNm / (P.gears[0] || 1) * (P.gears[0] || 1), P.motorKW * 1000 / w);
  }
  const Tp = P.peakNm, Pw = P.peakKW * 1000;
  const r = Math.max(P.idle, Math.min(rpm, P.redline));
  const rT1 = Pw / Tp * 30 / Math.PI; // rpm where constant-power line meets peak torque
  let T;
  if (r < P.rpmT0) T = Tp * (0.55 + 0.45 * (r - P.idle) / Math.max(1, P.rpmT0 - P.idle));
  else if (r < rT1) T = Tp;
  else if (r < P.rpmP) T = Pw / (r * Math.PI / 30);
  else T = Pw / (P.rpmP * Math.PI / 30) * (1 - 0.6 * (r - P.rpmP) / Math.max(1, P.redline - P.rpmP) * 0.5);
  T = Math.min(T, Tp);
  if (P.asp === 'T' || P.asp === 'TT') { const na = P.classic ? 0.55 : 0.62; T *= na + (1 - na) * boost; }
  else if (P.asp === 'SC') T *= 0.85 + 0.15 * boost;
  return T;
}

// ---------------- state ------------------------------------------------------------------------
export function newState(x = 0, z = 0, yaw = 0) {
  return { x, z, yaw, vx: 0, vy: 0, r: 0, rpm: 800, gear: 1, shift: 0, boost: 0, steer: 0, ax: 0, ay: 0,
    spin: 0, slipF: 0, slipR: 0, spinR: 0, lockF: 0, soc: 1, heat: 0, clutch: 1, wheelRot: 0, overrun: 0, lastShift: 0,
    kwOut: 0, t: 0, reverse: false, dist: 0 };
}

// input: {throttle 0..1, brake 0..1, steer -1..1 (left +), handbrake 0/1, shiftUp, shiftDown, reverse}
// opts: {auto:true, abs, tc, esc, steerAssist 0..1, wet 0..1, onePedal, regenLevel 0..3, evConsumption}
export function step(P, S, inp, opts, dt) {
  const hPattern = inp.hPattern === true;
  const auto = !hPattern && opts.auto !== false;
  const pedalClutch = inp.manualClutch === true && !P.ev;
  const clutchPedal = pedalClutch ? Math.max(0, Math.min(1, Number(inp.clutch) || 0)) : 0;
  const wet = opts.wet || 0;
  const v = Math.hypot(S.vx, S.vy);
  // steering: rate-limited, speed-sensitive lock (assist)
  const assist = opts.steerAssist ?? 0.6;
  // first-game steering rack: speed-sensitive lock max/(1 + v²/650) (SUVs 520), assist tightens it slightly at speed
  const lock = P.steerMax / (1 + S.vx * S.vx / ((P.h > 0.6 ? 520 : 650) * (1.25 - 0.45 * assist)));
  const target = inp.steer * lock;
  const rate = P.steerRate * dt;
  S.steer += Math.max(-rate, Math.min(rate, target - S.steer));
  const d = S.steer;

  // gear / reverse logic
  let thr = Math.max(0, Math.min(1, inp.throttle || 0)), brk = Math.max(0, Math.min(1, inp.brake || 0)); // NaN-safe pedals
  if (S.reverse) { // in reverse: throttle drives backwards, brake stops
    if (inp.throttle > 0.05 && S.vx > 0.5) { brk = thr; thr = 0; }
  }
  if (auto) {
    if (!S.reverse && brk > 0.3 && S.vx < 0.4 && thr < 0.05 && inp.wantReverse) S.reverse = true;
    if (S.reverse && thr > 0.05 && inp.wantForward) S.reverse = false;
  }
  if (hPattern) {
    // A held H-gate is a requested gear, not repeated shift-up/down events.
    const requested = inp.directGear;
    S.gearRejected = '';
    if (Number.isInteger(requested) && requested >= -1 && requested <= P.gearCount && requested !== S.gear) {
      const reversing = requested < 0 || S.gear < 0 || (requested > 0 && S.vx < -1.5);
      const predictedRPM = requested > 0 ? Math.abs(S.vx) / P.rw * P.gears[requested - 1] * P.final * 30 / Math.PI : 0;
      if (requested !== 0 && reversing && Math.abs(S.vx) > 1.5) S.gearRejected = 'Stop before changing direction';
      else if (requested !== 0 && clutchPedal < 0.75 && !P.ev) S.gearRejected = 'Press clutch to select gear';
      else if (requested > 0 && predictedRPM > P.redline * 1.03) S.gearRejected = 'Downshift would over-rev';
      else {
        S.gear = requested; S.reverse = requested < 0; S.shift = P.shiftT;
        S.lastShift = 0; S.shiftN = (S.shiftN || 0) + 1;
      }
    } else if (!Number.isInteger(requested) || requested < -1 || requested > P.gearCount) S.gearRejected = 'Gear unavailable in this car';
  } else {
    if (inp.reverseToggle && Math.abs(S.vx) < 1.5) S.reverse = !S.reverse;
    if (S.reverse) S.gear = -1;
    else if (S.gear < 1) S.gear = 1;
    S.gearRejected = '';
  }
  const neutral = hPattern && S.gear === 0;
  // Fully depressed pedal disconnects drive; progressive bite without a full stall/damage model.
  const engagement = neutral ? 0 : pedalClutch ? Math.max(0, 1 - clutchPedal / 0.8) : 1;

  // engine speed from wheels
  const n = P.gearCount;
  const gi = Math.max(0, Math.min(n - 1, (S.gear < 0 ? 0 : S.gear - 1)));
  const ratio = neutral ? 0 : (S.gear < 0 ? P.gears[0] * 1.1 : P.gears[gi]) * P.final;
  const drivenV = Math.abs(S.vx) * (1 + Math.min(0.6, S.spinR));
  const rpmOf = g => drivenV / P.rw * P.gears[g] * P.final * 30 / Math.PI;
  let wheelRpm = drivenV / P.rw * ratio * 30 / Math.PI;
  if (P.ev) S.rpm = wheelRpm;
  else {
    // launch clutch / torque converter: slips in first & reverse, engaging progressively. Engine revs dip as it
    // bites and are fully coupled once road speed reaches ~half the launch revs or after P.launchT on throttle.
    const launchRpm = P.idle + thr * (P.asp === 'NA' ? 0.55 : 0.42) * P.redline;
    let target = Math.max(P.idle, wheelRpm);
    if (gi === 0 || S.gear < 0) {
      if (thr > 0.05 && Math.abs(S.vx) < 12) S.launch = (S.launch || 0) + dt; else if (thr <= 0.05) S.launch = 0;
      const byT = 1 - Math.max(0, (S.launch || 0) - P.launchT * 0.5) / (P.launchT * 0.5);
      const bySpeed = 1 - wheelRpm / (launchRpm * 0.55);
      const eng = Math.max(0, Math.min(1, Math.min(byT, bySpeed)));
      const stall = P.idle * 1.15 + thr * 300; // never bogs below this while the clutch is still slipping
      target = Math.max(target, wheelRpm + (launchRpm - wheelRpm) * eng, wheelRpm < stall ? stall : 0);
      if (Math.abs(S.vx) < 0.5 && thr > 0.05) target = launchRpm;
    }
    if (pedalClutch || neutral) target = target * engagement + (P.idle + thr * (P.redline - P.idle) * 0.98) * (1 - engagement);
    // during a shift the revs fall (upshift) or are blipped (downshift) to the new gear's speed within the shift time
    const kR = S.shift > 0 ? 3.2 / Math.max(0.05, P.shiftT) : 30;
    S.rpm += (target - S.rpm) * Math.min(1, dt * kR);
    S.clutch = target > wheelRpm * 1.03 + 30 ? Math.max(0, 1 - (target - wheelRpm) / Math.max(1, target)) : 1;
    if (pedalClutch || neutral) S.clutch = engagement;
  }
  // automatic / manual shifting
  S.lastShift += dt;
  if (S.shift > 0) S.shift -= dt;
  const doShift = (to) => { const upS = to > S.gear; S.gear = to; S.shift = upS ? P.shiftT : P.shiftT * 0.85; S.lastShift = 0; if (upS) S.overrun = Math.max(S.overrun, 0.25); else S.blip = 0.2; S.shiftN = (S.shiftN || 0) + 1; };
  if (!hPattern && !S.reverse && S.shift <= 0 && n > 1) {
    if (auto && P.ev) {
      if (gi + 1 < n && S.rpm > 0.92 * P.redline && S.lastShift > 0.4) doShift(S.gear + 1);
      else if (gi > 0 && wheelRpm * P.gears[gi - 1] / P.gears[gi] < 0.55 * P.redline && S.lastShift > 0.5) doShift(S.gear - 1);
    } else if (auto) {
      // shift schedule: light throttle upshifts early (~2.3-3k rpm), full throttle at the optimal (peak-power) point.
      // Downshift lines sit well below the matching upshift line in the lower gear (hysteresis → no hunting).
      if (!Number.isFinite(S.thrF)) S.thrF = 0; // a NaN here (e.g. an undefined pedal on the first frame) used to freeze the car in 1st forever
      S.thrF = !Number.isFinite(thr) ? S.thrF : thr > S.thrF ? thr : S.thrF + (thr - S.thrF) * Math.min(1, dt * 1.5); // pedal for the schedule: instant on press, slow release (no upshift on a brief lift)
      const light = Math.max(P.idle * 3, P.redline * 0.36);
      const upAt = g => { const full = P.upRpm[g]; const x = Math.max(0, Math.min(1, (S.thrF - 0.2) / 0.65)); return light + (full - light) * x; };
      const downAt = Math.max(P.idle * 1.7, P.redline * (brk > 0.2 ? 0.34 : 0.2));
      const kick = thr > 0.85 && S.kickArm; // pedal floored from part throttle
      if (kick && gi > 0) { // kick-down: go straight to the lowest gear that stays below ~88% of its upshift point
        let g = gi; while (g > 0 && rpmOf(g - 1) < P.upRpm[g - 1] * 0.82) g--;
        if (g < gi) doShift(g + 1);
      } else if (gi + 1 < n && S.rpm > upAt(gi) && wheelRpm >= S.rpm * 0.9 && S.lastShift > (thr > 0.85 ? P.shiftT + 0.05 : 0.8)
        && rpmOf(gi + 1) > downAt * 1.35) doShift(S.gear + 1);
      else if (gi > 0 && S.lastShift > 0.6 && (wheelRpm < downAt || (thr > 0.85 && rpmOf(gi - 1) < P.upRpm[gi - 1] * 0.8 && wheelRpm < P.upRpm[gi] * 0.55))
        && rpmOf(gi - 1) < upAt(gi - 1) * 0.85) doShift(S.gear - 1);
      if (thr > 0.85) S.kickArm = false; else if (thr < 0.6) S.kickArm = true;
    } else {
      if (inp.shiftUp && gi + 1 < n) doShift(S.gear + 1);
      if (inp.shiftDown && gi > 0) doShift(S.gear - 1);
    }
  }
  // turbo boost
  if (!P.ev) {
    const spool = P.asp === 'NA' ? 1 : Math.max(0, Math.min(1, (S.rpm - P.idle * 1.4) / (P.redline * (P.classic ? 0.45 : 0.28))));
    const bt = thr * spool;
    const k = bt > S.boost ? dt / Math.max(0.03, P.boostLag) : dt / 0.15;
    S.boost += (bt - S.boost) * Math.min(1, k);
  }

  // drive torque → force at contact patch
  let Fdrive = 0, regen = 0;
  const onePedal = P.ev && opts.onePedal;
  if (S.shift <= 0 || P.ev) {
    let T;
    if (P.ev) {
      const derate = 1 - Math.max(0, S.heat - 0.8) * (1.5 - P.cooling * 0.35);
      const kwLim = P.motorKW * 1000 * Math.max(0.55, derate) * (opts.evConsumption && S.soc < 0.1 ? 0.5 : 1);
      const overSpeed = S.rpm > P.maxRpm ? 0 : 1;
      Fdrive = thr * overSpeed * Math.min(P.motorNm * 9 / P.rw, kwLim / Math.max(1.5, Math.abs(S.vx)));
    } else {
      const limiter = (S.rpm >= P.redline * 0.995) ? 0 : 1;
      T = engineTorque(P, S.rpm, S.boost) * thr * limiter;
      Fdrive = T * ratio * 0.88 / P.rw;
    }
    if (P.limiter && S.vx > P.limiter) Fdrive *= Math.max(0, 1 - (S.vx - P.limiter) * 2);
  }
  // ESC engine intervention (decided last step): cut drive torque BEFORE the tyres use it up, so the rear keeps lateral grip
  Fdrive *= engagement;
  if (opts.esc !== false && S.escCut > 0 && Fdrive > 0) Fdrive *= 1 - 0.8 * S.escCut;
  if (S.reverse) Fdrive = -Math.min(Fdrive, P.m * 3.5);
  // EV regen when lifting / braking
  if (P.ev && S.vx > 1 && !S.reverse) {
    const lvl = opts.regenLevel ?? 1;
    const liftRegen = onePedal ? (1 - thr) * 0.28 : (1 - Math.min(1, thr * 8)) * [0, 0.05, 0.1, 0.16][lvl];
    regen = P.m * G * liftRegen * Math.min(1, S.vx / 3);
  }
  // engine braking / overrun
  let engBrake = 0;
  if (!P.ev && thr < 0.05 && S.vx > 2 && !S.reverse) { engBrake = (P.ebNm ?? P.peakNm * 0.12) * ratio / P.rw * Math.min(1, S.rpm / P.redline * 1.8); S.overrun = Math.min(1, S.overrun + dt * 1.5); }
  else S.overrun = Math.max(0, S.overrun - dt * 2);
  engBrake *= engagement;

  // normal loads with longitudinal transfer and downforce
  const down = -0.5 * RHO * P.ClA * S.vx * S.vx;
  const Wt = P.m * G;
  let Fzf = Wt * P.b / P.L - P.m * S.ax * P.h / P.L + down * 0.45;
  let Fzr = Wt * P.a / P.L + P.m * S.ax * P.h / P.L + down * 0.55;
  Fzf = Math.max(Wt * 0.1, Fzf); Fzr = Math.max(Wt * 0.1, Fzr);
  const muBase = P.mu * (1 - wet * 0.3);
  // per-axle lateral load transfer (split by roll-stiffness distribution) with degressive per-wheel tyre load
  // sensitivity mu_i = mu(1 - ls(Fz_i/Fz0 - 1)): the axle carrying more of the transfer loses more grip. Summed over
  // both wheels the axle loses ls*q^2 of its capacity, q = transfer / half the axle load (inner wheel lifts at q = 1)
  const dFlat = P.m * Math.abs(S.ay) * P.h / P.track, ls = P.lt * 1.35;
  const axleCap = (Fz, share) => { const q = Math.min(1, dFlat * share / (Fz * 0.5)); return 1 - ls * q * q; };
  const muF = muBase * axleCap(Fzf, P.rsF), muR = muBase * axleCap(Fzr, 1 - P.rsF);
  S.loadF = Fzf; S.loadR = Fzr; S.latQ = dFlat / (Wt * 0.5); // exposed for the visual body roll / pitch
  const capF = muF * Fzf, capR = muR * Fzr;

  // longitudinal forces per axle
  const split = P.split;
  let FxF = Fdrive * split, FxR = Fdrive * (1 - split);
  const launch = P.launchMu;
  const open = 1 - (1 - P.lsd) * Math.min(1, Math.abs(S.ay) / 6); // open/limited-slip diff: inside wheel unloads in corners
  const dcapF = capF * launch * (split > 0.9 ? open : 1), dcapR = capR * launch * (split < 0.1 ? open : 1);
  S.spinR = 0; let spinF = 0, spinRr = 0;
  const tcOn = opts.tc !== false;
  // longitudinal slip: demand beyond the tyre's peak drives the slip ratio past its peak (~0.14) along the Pacejka
  // curve; traction control holds it just past the peak, otherwise force falls toward the sliding value (~0.75 x peak)
  const lim = (F, c) => { if (Math.abs(F) <= c) return [F, 0]; const over = Math.abs(F) / c - 1; const kap = Math.min(1, KPK * (1 + (tcOn ? Math.min(0.25, over) : over * 5)));
    S.kappa = kap; return [Math.sign(F) * c * mfx(kap), tcOn ? Math.min(0.08, over) : Math.min(1, over)]; };
  if (P.drive === 'AWD') { // centre coupling shifts torque to the axle with grip
    // …judged on the grip each axle has left after cornering (friction circle, last step's lateral force), so a
    // loaded-up rear axle mid-corner sends torque forward instead of being pushed into a spin
    const rF = Math.sqrt(Math.max(0, dcapF * dcapF - (S.fyf || 0) ** 2)) + dcapF * 0.05, rR = Math.sqrt(Math.max(0, dcapR * dcapR - (S.fyr || 0) ** 2)) + dcapR * 0.05;
    const tot = rF + rR; if (Math.abs(Fdrive) > 0 && Math.abs(Fdrive) < dcapF + dcapR) { FxF = Fdrive * rF / tot; FxR = Fdrive * rR / tot; }
  }
  if (opts.smartThr && Fdrive > 0) { // touch "smart throttle": never ask more of a tyre than the grip cornering leaves it
    const rF = Math.sqrt(Math.max(0, dcapF * dcapF - (S.fyf || 0) ** 2)) * 0.96, rR = Math.sqrt(Math.max(0, dcapR * dcapR - (S.fyr || 0) ** 2)) * 0.96;
    FxF = Math.min(FxF, Math.max(rF, dcapF * 0.2)); FxR = Math.min(FxR, Math.max(rR, dcapR * 0.2)); }
  [FxF, spinF] = lim(FxF, dcapF); [FxR, spinRr] = lim(FxR, dcapR);
  S.spinR = Math.max(spinF, spinRr);
  // braking (pedal + handbrake + regen + engine braking) opposing motion
  const sgn = S.vx >= 0 ? 1 : -1;
  const Fbrake = brk * P.brakeMax * P.m * G * 1.05;
  let BF = Fbrake * P.brakeBias + regen * split + engBrake * split;
  let BR = Fbrake * (1 - P.brakeBias) + regen * (1 - split) + engBrake * (1 - split);
  const hb = inp.handbrake ? 1 : 0;
  if (hb) BR += P.m * G * 0.9;
  let lockF = 0, lockR = hb ? 1 : 0;
  const absOn = opts.abs !== false;
  const avF = Math.sqrt(Math.max(0, capF * capF - FxF * FxF)), avR = Math.sqrt(Math.max(0, capR * capR - FxR * FxR));
  if (BF > avF) { if (absOn) BF = avF * 0.97; else { BF = avF * MFX_LOCK; lockF = 1; } } // ABS cycles around peak slip; locked = sliding friction
  if (BR > avR) { if (absOn && !hb) BR = avR * 0.97; else { BR = avR * MFX_LOCK; lockR = 1; } }
  if (Math.abs(S.vx) < 0.3 && thr < 0.05) { BF = BR = 0; }
  FxF -= BF * sgn; FxR -= BR * sgn;
  S.lockF = lockF;

  // slip angles & lateral forces
  const vxe = Math.max(Math.abs(S.vx), 2.5) * (S.vx >= 0 ? 1 : -1);
  const af = Math.atan2(S.vy + P.a * S.r, Math.abs(vxe)) - d * Math.sign(vxe);
  const ar = Math.atan2(S.vy - P.b * S.r, Math.abs(vxe));
  // first-game tyre: Pacejka magic formula (B 9.5, C 1.35, E -0.4) with load sensitivity, combined slip via the
  // friction ellipse, front/rear grip balance 0.93/1.04 (front lets go first: mild, safe understeer) and tyre
  // relaxation (forces build over ~0.45 m of travel instead of instantly)
  const tyre = (alpha, Fz, mu, Fx, spin, locked, k) => {
    const D = Math.sqrt(Math.max(0, (mu * k * Math.pow(Fz / 4450, -0.08) * Fz) ** 2 - Fx * Fx)) * (locked ? 0.3 : 1) * (1 - Math.min(0.75, spin * 0.9));
    const x = 9.5 * (P.Cs / 11) * alpha;
    return -D * Math.sin(1.35 * Math.atan(x + 0.4 * (x - Math.atan(x))));
  };
  const tF = tyre(af, Fzf, muF, FxF, spinF, lockF, P.kF ?? 0.965), tR = tyre(ar, Fzr, muR * (hb ? 0.45 : 1), FxR, spinRr, lockR, P.kR ?? 1.035);
  const relax = Math.min(1, dt * Math.max(Math.abs(S.vx), 3) / 0.45);
  S.fyf = (S.fyf || 0) + (tF - (S.fyf || 0)) * relax; S.fyr = (S.fyr || 0) + (tR - (S.fyr || 0)) * relax;
  let FyF = S.fyf, FyR = S.fyr;
  if (S.vx < 0) { FyF = -FyF * 0 + FyF; }
  S.slipF = Math.abs(af); S.slipR = Math.abs(ar);

  // ESC: limit yaw rate relative to steady-state target, and limit body slip
  if (opts.esc !== false && Math.abs(S.vx) > 4) {
    const rT = S.vx * d / (P.L * (1 + S.vx * S.vx / 900));
    const rMax = muBase * G / Math.abs(S.vx) * 0.88; // the yaw rate the tyres can actually sustain (load sensitivity keeps real grip below mu)
    const beta = Math.atan2(S.vy, Math.abs(S.vx));
    const e = S.r - Math.max(-rMax, Math.min(rMax, rT));
    // first-game DSC: past the body-slip / yaw-error threshold it trims drive torque and applies a corrective yaw moment
    const act = Math.abs(beta) > (P.h > 0.6 ? 0.05 : 0.07) || Math.abs(e) > 0.1;
    const over = act && Math.abs(beta) > (P.h > 0.6 ? 0.05 : 0.07) && Math.sign(e) === Math.sign(S.r); // oversteer / slide
    S.escCut = over ? Math.min(1, (S.escCut || 0) + dt * 12) : Math.max(0, (S.escCut || 0) - dt * 3);
    S.escMoment = act ? -e * P.Izz * (over ? 10 : 6) : 0; S.dsc = act ? 1 : 0; if (act && FxR * sgn > 0) FxR *= 0.35;
  } else { S.escMoment = 0; S.escCut = 0; }

  // aero + rolling
  const Fd = -0.5 * RHO * P.CdA * S.vx * Math.abs(S.vx) - P.crr * P.m * G * Math.tanh(S.vx * 2);
  const cd = Math.cos(d), sd = Math.sin(d);
  const Fx = FxF * cd - FyF * sd + FxR + Fd;
  const Fy = FyF * cd + FxF * sd + FyR;
  const Mz = P.a * (FyF * cd + FxF * sd) - P.b * FyR + (S.escMoment || 0);
  const axB = Fx / P.m, ayB = Fy / P.m;
  S.vx += (axB + S.vy * S.r) * dt;
  S.vy += (ayB - S.vx * S.r) * dt;
  S.r += Mz / P.Izz * dt;
  // low-speed damping so cars come to rest
  // low speed: blend to kinematic steering so the car turns cleanly when parking and never wobbles (first game)
  if (Math.abs(S.vx) < 3) { const k = 1 - Math.abs(S.vx) / 3; S.vy *= 1 - k * Math.min(1, dt * 10); S.r += ((S.vx / P.L * Math.tan(d)) - S.r) * k * Math.min(1, dt * 12); }
  if (Math.abs(S.vx) < 0.15 && thr < 0.05 && !S.reverse) { S.vx *= 0.5; }
  S.ax += (axB - S.ax) * Math.min(1, dt * 8); S.ay += (ayB - S.ay) * Math.min(1, dt * 8);
  // integrate pose (x east, z south, yaw 0 → facing -z/north)
  S.yaw += S.r * dt;
  const sy = Math.sin(S.yaw), cy = Math.cos(S.yaw);
  const dx = (-sy * S.vx - cy * S.vy) * dt, dz = (-cy * S.vx + sy * S.vy) * dt;
  S.x += dx; S.z += dz; S.dist += Math.hypot(dx, dz);
  S.wheelRot += S.vx / P.rw * dt;
  S.t += dt;
  // EV energy
  if (P.ev) {
    const pOut = Fdrive * S.vx; S.kwOut = pOut / 1000 - regen * S.vx / 1000;
    S.heat = Math.max(0, S.heat + (Math.max(0, pOut) / (P.motorKW * 1000) - 0.35) * dt * 0.04);
    if (opts.evConsumption) S.soc = Math.max(0, Math.min(1, S.soc - (S.kwOut / 0.9) * dt / 3600 / P.kwh));
  } else S.kwOut = Fdrive * S.vx / 1000;
  return S;
}

export function velocityWorld(S) {
  const sy = Math.sin(S.yaw), cy = Math.cos(S.yaw);
  return [-sy * S.vx - cy * S.vy, -cy * S.vx + sy * S.vy];
}

// ---------------- upgrade catalogue ------------------------------------------------------------
export const UPGRADE_PARTS = {
  engine: { name: 'Engine & ECU tune', ice: 1, base: [0, 1500, 3500, 7000], benefit: '+7% torque per stage', trade: 'None on handling; more wheelspin in low gears' },
  turbo: { name: 'Turbo / supercharger', ice: 1, base: [0, 2000, 4500, 9000], benefit: 'More boost (NA cars: intake & cams); less turbo lag', trade: 'Traction harder to manage' },
  exhaust: { name: 'Exhaust system', ice: 1, base: [0, 800, 1800, 3500], benefit: '+2% torque per stage, louder, more crackle', trade: 'Louder cabin' },
  motor: { name: 'Motor & inverter', evOnly: 1, base: [0, 2000, 4500, 9000], benefit: '+8% motor output per stage', trade: 'Heats battery faster' },
  cooling: { name: 'Battery & motor cooling', evOnly: 1, base: [0, 1200, 2500, 5000], benefit: 'Holds full power for longer', trade: 'None' },
  tyres: { name: 'Tyres', base: [0, 1000, 2500, 5000], benefit: 'Street → Sport → Semi-slick → Track: more grip in corners and braking', trade: 'Track tyres lose more grip in the wet' },
  brakes: { name: 'Brakes', base: [0, 900, 2200, 4500], benefit: 'Stronger, more consistent braking', trade: 'Grip still limits stopping distance' },
  susp: { name: 'Suspension', base: [0, 1200, 2800, 5500], benefit: 'Less body roll, sharper turn-in', trade: 'Harsher over bumps' },
  weight: { name: 'Weight reduction', base: [0, 1500, 3500, 7500], benefit: '-3.5% mass per stage: accelerates, turns and stops better', trade: 'Fewer comforts' },
  gearbox: { name: 'Gearbox', base: [0, 1200, 2600, 5000], benefit: 'Faster gear changes: -12% shift time per stage', trade: 'None' },
  diff: { name: 'Differential', base: [0, 1000, 2200, 4200], benefit: 'Puts power down out of corners', trade: 'Can push wide on the throttle' },
  aero: { name: 'Aerodynamics', base: [0, 1200, 2600, 5200], benefit: 'Downforce for high-speed grip', trade: 'Extra drag lowers top speed slightly' },
};
export const PACKAGES = { street: { tyres: 1, brakes: 1, susp: 1, engine: 1, exhaust: 1, motor: 1, cooling: 1 },
  sport: { tyres: 2, brakes: 2, susp: 2, engine: 2, exhaust: 2, turbo: 1, gearbox: 1, diff: 1, weight: 1, motor: 2, cooling: 2 },
  track: { tyres: 3, brakes: 3, susp: 3, engine: 3, exhaust: 2, turbo: 2, gearbox: 2, diff: 2, weight: 2, aero: 2, motor: 3, cooling: 3 } };
export function priceFactor(car) { return Math.max(0.6, Math.min(3, 0.6 + car.price / 60000)); }
export function partCost(car, part, level) { const p = UPGRADE_PARTS[part]; if (!p) return 0; let c = 0; for (let i = 1; i <= level; i++) c += p.base[i]; return Math.round(c * priceFactor(car) / 50) * 50; }
export function partsFor(car) { const ev = car.asp === 'EV'; return Object.keys(UPGRADE_PARTS).filter(k => ev ? !UPGRADE_PARTS[k].ice : !UPGRADE_PARTS[k].evOnly); }
