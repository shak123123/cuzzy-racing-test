// BTTF Part II hover conversion (DeLorean only): thrusters instead of tyres. Throttle pushes, brake reverses thrust,
// steering yaws the car, sideways momentum bleeds off slowly so it drifts and floats rather than grips.
export function hoverStep(P, S, inp, dt, on) {
  const thr = inp.throttle || 0, brk = inp.brake || 0, st = inp.steer || 0;
  const sy = Math.sin(S.yaw), cy = Math.cos(S.yaw);
  let wx = -sy * S.vx - cy * S.vy, wz = -cy * S.vx + sy * S.vy; // world velocity
  const acc = on ? (thr * 11 - brk * 13) : -Math.sign(S.vx) * 6; S.hvA = acc;
  wx += -sy * acc * dt; wz += -cy * acc * dt;
  const drag = 1 - Math.min(0.5, (0.12 + (on ? 0 : 0.8)) * dt); wx *= drag; wz *= drag;
  const fwd = -sy * wx - cy * wz, rt = Math.min(1, 0.35 + Math.abs(fwd) / 8);
  S.r += (st * 1.5 * rt * (fwd < -0.5 ? -1 : 1) - S.r) * Math.min(1, dt * 3); S.yaw += S.r * dt;
  const sy2 = Math.sin(S.yaw), cy2 = Math.cos(S.yaw);
  S.vx = -sy2 * wx - cy2 * wz; S.vy = -cy2 * wx + sy2 * wz; S.vy *= 1 - Math.min(1, dt * 1.1); // slow side slip decay: floaty drift
  S.vx = Math.max(-12, Math.min(72, S.vx));
  const dx = (-sy2 * S.vx - cy2 * S.vy) * dt, dz = (-cy2 * S.vx + sy2 * S.vy) * dt; S.x += dx; S.z += dz; S.dist += Math.hypot(dx, dz);
  S.steer = st * 0.3; S.rpm = 2500 + Math.abs(S.vx) * 70; S.gear = 1; S.reverse = S.vx < -0.5; S.ax = acc; S.ay = S.vx * S.r; S.t += dt;
  S.slipF = S.slipR = S.spin = S.spinR = S.lockF = 0; S.kwOut = 0;
  return S;
}
