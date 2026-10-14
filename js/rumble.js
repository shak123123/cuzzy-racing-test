// Controller rumble / force feedback for Xbox and PlayStation (DualSense / DualShock) pads via the Gamepad API.
// 'dual-rumble' works for both in Chrome / Edge (and Safari for supported pads); Xbox trigger rumble ('trigger-rumble')
// is used when the browser supports it. Strength comes from Settings > Controls > Controller vibration (0 = off).
import { standardPad } from './wheel.js';

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

export class Rumble {
  constructor(settings) { this.s = settings; this.kS = 0; this.kW = 0; this.last = 0; this.prevGear = null; this.prevShake = 0; this.on = false; }
  get gain() { const g = this.s?.controls?.rumble; return g == null ? 0.8 : +g; }
  act() { const p = standardPad(); return p && p.vibrationActuator ? p.vibrationActuator : null; }
  fx(a, type) { try { return !a.effects || a.effects.includes(type); } catch (e) { return type === 'dual-rumble'; } }
  // one-shot kick (impacts, gear changes, landings, menu ticks)
  kick(strong, weak = strong) { this.kS = Math.max(this.kS, strong); this.kW = Math.max(this.kW, weak); }
  impact(s) { this.kick(clamp(0.35 + s * 0.65), clamp(0.5 + s * 0.5)); }
  tick() { const a = this.act(), g = this.gain; if (!a || !g) return; try { a.playEffect('dual-rumble', { duration: 35, strongMagnitude: 0, weakMagnitude: 0.25 * g }); } catch (e) { } }
  stop() { if (!this.on) return; this.on = false; this.kS = this.kW = 0; const a = this.act(); try { a?.reset?.(); } catch (e) { } }
  // called every frame while driving
  update(dt, sess) {
    const a = this.act(), g = this.gain;
    const t = performance.now();
    this.kS *= Math.pow(0.004, dt); this.kW *= Math.pow(0.004, dt);
    if (!a || !g || !sess || sess.paused || sess.foot?.active || document.hidden) { this.stop(); return; }
    const S = sess.S, P = sess.P || {}, inp = sess.inp || {};
    if (this.prevGear != null && S.gear !== this.prevGear && S.gear > 0) this.kick(0.3, 0.15);
    this.prevGear = S.gear;
    const sh = sess.shake || 0; if (sh > this.prevShake + 0.15) this.kick(clamp(sh), clamp(sh)); this.prevShake = sh;
    if (t - this.last < 70) return; this.last = t;
    const v = Math.abs(S.vx || 0), red = P.redline || P.maxRpm || 7000, rpm = clamp((S.rpm || 0) / red);
    const thr = inp.throttle || 0, brk = inp.brake || 0;
    const slip = clamp((S.slipR || 0) + (S.spinR || 0)), lock = clamp(S.lockF || 0);
    // continuous: engine hum (low), road texture with speed (high), wheelspin / sliding, front lock, rev limiter buzz
    let strong = rpm * rpm * 0.07 * (0.4 + 0.6 * thr) + slip * 0.25 * clamp(v / 8) + lock * 0.35 * clamp(v / 5);
    let weak = clamp(v / 45) * 0.1 + slip * 0.35 * clamp(v / 6) + (rpm > 0.96 && thr > 0.5 ? 0.25 : 0);
    if (inp.handbrake && v > 3) weak += 0.15;
    strong = clamp(Math.max(strong, this.kS) * g); weak = clamp(Math.max(weak, this.kW) * g);
    this.on = true;
    try { a.playEffect('dual-rumble', { duration: 110, strongMagnitude: strong, weakMagnitude: weak }); } catch (e) { }
    // Xbox impulse triggers: RT buzzes with wheelspin, LT with braking / lock-up
    if (this.fx(a, 'trigger-rumble') && a.effects) {
      const rt = clamp(slip * thr * 0.7 * g), lt = clamp((lock * 0.8 + (brk > 0.7 && v > 6 ? 0.15 : 0)) * g);
      try { a.playEffect('trigger-rumble', { duration: 110, leftTrigger: lt, rightTrigger: rt, strongMagnitude: strong, weakMagnitude: weak }); } catch (e) { }
    }
  }
}

// Controller steering: scaled deadzone, response curve, speed-sensitive lock and smoothing so small stick
// movements make small corrections (raw stick values made the car twitchy).
export function padSteer(ax, speed, c, prev, dt) {
  const dz = 0.1, m = Math.abs(ax);
  let a = m <= dz ? 0 : (m - dz) / (1 - dz);
  a = Math.pow(a, c.padCurve ?? 1.7) * Math.sign(ax);
  a *= (c.padSens ?? 0.8) * (0.45 + 0.55 / (1 + speed * speed / 300)); // ~100% lock parked, ~55% at 70 mph
  a = clamp(a, -1, 1);
  const r = Math.abs(a) < Math.abs(prev) ? 5 : 3.2; // centre faster than you turn in
  return prev + clamp(a - prev, -r * dt, r * dt);
}
export function padPedal(v) { const dz = 0.06; return v <= dz ? 0 : Math.pow((v - dz) / (1 - dz), 1.25); }
