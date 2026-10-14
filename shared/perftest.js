// Performance measurements by simulation (used by calibration tests and the upgrade screen's estimates).
import { newState, step, fromMph, mph } from './physics.js';
const DT = 1 / 120;
const OPTS = { auto: true, abs: true, tc: true, esc: true, steerAssist: 0.3 };

export function run060(P) {
  const S = newState(); let t = 0;
  while (t < 30) { step(P, S, { throttle: 1, brake: 0, steer: 0 }, OPTS, DT); t += DT; if (S.vx >= fromMph(60)) return t; }
  return 99;
}
export function topSpeed(P) {
  const S = newState(); let t = 0, best = 0;
  while (t < 150) { step(P, S, { throttle: 1, brake: 0, steer: 0 }, OPTS, DT); t += DT; best = Math.max(best, S.vx); }
  return mph(best);
}
export function brake60(P) {
  const S = newState(); S.vx = fromMph(60); S.gear = Math.max(1, P.gearCount - 2); let d = 0;
  for (let i = 0; i < 2000 && S.vx > 0.2; i++) { const x = S.x, z = S.z; step(P, S, { throttle: 0, brake: 1, steer: 0 }, OPTS, DT); d += Math.hypot(S.x - x, S.z - z); }
  return d; // metres
}
export function skidpad(P) { // max steady lateral g on a 60 m radius circle (speed sweep)
  let best = 0;
  for (let v = 10; v < 45; v += 0.5) {
    const S = newState(); S.vx = v; S.gear = 3;
    let ok = true, ay = 0;
    for (let i = 0; i < 1200; i++) {
      const want = v / 60; const e = want - S.r; const steer = Math.max(-1, Math.min(1, (P.L / 60) / 0.3 + e * 3));
      step(P, S, { throttle: Math.max(0, Math.min(1, (v - S.vx) * 0.5 + 0.25)), brake: 0, steer }, { ...OPTS, esc: false }, DT);
      if (i > 800) ay = Math.abs(S.vx * S.r);
      if (Math.abs(S.vy) > 4 || S.vx < v * 0.85) { ok = false; break; }
    }
    if (ok) best = Math.max(best, ay / 9.81); else break;
  }
  return best;
}


// performance index and class — same formula as tools/build_cars.py, fed with measured values for upgraded cars
export function perfIndex(car, m) {
  const acc = Math.max(0, Math.min(10, 10 - (m.s060 - 2) * 1.05));
  const spd = Math.max(0, Math.min(10, (m.top - 90) / 17));
  const r = car.rating;
  const han = Math.max(1, Math.min(10, r.han + (m.latG0 ? (m.latG - m.latG0) * 12 : 0)));
  const brk = Math.max(1, Math.min(10, r.brk + (m.brk0 ? (m.brk0 - m.brake) / 2.2 : 0)));
  return { pi: Math.min(999, Math.round(100 + 90 * (acc * 0.36 + spd * 0.18 + han * 0.3 + brk * 0.16))), acc, spd, han, brk };
}
export function klass(pi) { for (const [lim, k] of [[500, 'D'], [600, 'C'], [700, 'B'], [800, 'A'], [900, 'S1'], [960, 'S2']]) if (pi < lim) return k; return 'X'; }
export const CLASSES = ['D', 'C', 'B', 'A', 'S1', 'S2', 'X'];
