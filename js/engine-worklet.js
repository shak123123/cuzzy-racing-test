// CUZZY RACING engine synthesiser (AudioWorklet). Procedural - nothing here is a recording of a real car.
// Model, per sample:
//  - crank phase; every cylinder fires a combustion pressure pulse at its real crank angle (firing order and bank),
//    pulse width shrinks with rpm, strength follows load (throttle), with cycle-to-cycle variation (lumpier off-throttle);
//  - EXHAUST layer: per-bank header waveguides (delay line with a lossy, inverting open-end reflection), collector,
//    muffler (2-pole low-pass that opens with load/rpm/exhaust upgrade), tail-pipe resonance; turbines damp the pulses;
//  - INTAKE layer: induction pulses through an airbox (Helmholtz) and runner resonance plus throttle flow noise;
//  - MECHANICAL layer: valvetrain tick; diesel combustion knock ("clatter") for diesels;
//  - rev limiter (fuel-cut stutter), gear-change ignition cut, overrun pops/crackle and DCT upshift "brap"
//    (rate scales with the crackle setting; 0 = none), turbo spool whistle + compressor hiss and blow-off valve;
//  - doppler (pitch factor from the main thread for other cars) and an 'active' flag so far-away cars cost ~nothing.
// CPU: one node per car, ~200 flops/sample for 12 cylinders; remote cars run the 'lite' path (no intake/mech detail).

const LAYOUTS = {
  // [crank angle (deg, 0..720), bank]
  I3: [[0, 0], [240, 0], [480, 0]],
  I4: [[0, 0], [180, 0], [360, 0], [540, 0]], // 1-3-4-2, one 4-into-1 manifold
  I5: [[0, 0], [144, 0], [288, 0], [432, 0], [576, 0]],
  I6: [[0, 0], [120, 0], [240, 0], [360, 0], [480, 0], [600, 0]], // 1-5-3-6-2-4
  V6: [[0, 0], [120, 1], [240, 0], [360, 1], [480, 0], [600, 1]],
  // cross-plane V8, order 1-8-4-3-6-5-7-2 (bank A = 1-4, bank B = 5-8): uneven per-bank spacing gives the burble
  V8: [[0, 0], [90, 1], [180, 0], [270, 0], [360, 1], [450, 1], [540, 1], [630, 0]],
  V8F: [[0, 0], [90, 1], [180, 0], [270, 1], [360, 0], [450, 1], [540, 0], [630, 1]], // flat-plane: banks alternate
  V10: [[0, 0], [72, 1], [144, 0], [216, 1], [288, 0], [360, 1], [432, 0], [504, 1], [576, 0], [648, 1]], // even-fire 90 deg V10, each bank = I5
  V12: [[0, 0], [60, 1], [120, 0], [180, 1], [240, 0], [300, 1], [360, 0], [420, 1], [480, 0], [540, 1], [600, 0], [660, 1]], // each bank = I6
  F6: [[0, 0], [120, 1], [240, 0], [360, 1], [480, 0], [600, 1]], // boxer 1-6-2-4-3-5, banks alternate
  F4: [[0, 0], [180, 1], [360, 0], [540, 1]],
};

class Pipe { // waveguide: y = x + r * lowpass(delay(y))
  constructor(len) { this.buf = new Float32Array(4096); this.n = Math.max(8, Math.min(4000, len | 0)); this.i = 0; this.lp = 0; }
  tick(x, refl, damp) {
    const j = (this.i - this.n + 4096) & 4095; const d = this.buf[j];
    this.lp += (d - this.lp) * damp; const y = x + refl * this.lp;
    this.buf[this.i] = y; this.i = (this.i + 1) & 4095; return y;
  }
}
class SVF { // TPT state-variable filter; coefficients set per block
  constructor() { this.a1 = 0; this.a2 = 0; this.a3 = 0; this.s1 = 0; this.s2 = 0; this.bp = 0; this.lp = 0; }
  set(f, q) { const g = Math.tan(Math.PI * Math.min(f, sampleRate * 0.45) / sampleRate), k = 1 / q; this.a1 = 1 / (1 + g * (g + k)); this.a2 = g * this.a1; this.a3 = g * this.a2; }
  tick(x) { const v3 = x - this.s2, v1 = this.a1 * this.s1 + this.a2 * v3, v2 = this.s2 + this.a2 * this.s1 + this.a3 * v3; this.s1 = 2 * v1 - this.s1; this.s2 = 2 * v2 - this.s2; this.bp = v1; this.lp = v2; return v1; }
}

class EngineProc extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const k = (name, def, min, max) => ({ name, defaultValue: def, minValue: min, maxValue: max, automationRate: 'k-rate' });
    return [k('rpm', 900, 0, 20000), k('load', 0, 0, 1), k('overrun', 0, 0, 1), k('cut', 0, 0, 1), k('boost', 0, 0, 1.5),
      k('crackle', 1, 0, 3), k('view', 0, 0, 1), k('dop', 1, 0.5, 2), k('active', 1, 0, 1)];
  }
  constructor(opt) {
    super(); const o = opt.processorOptions || {}; const sr = sampleRate;
    this.cyl = LAYOUTS[o.layout] || LAYOUTS.I4; this.nc = this.cyl.length; this.banks = Math.max(...this.cyl.map(c => c[1])) + 1;
    this.rough = o.rough ?? 0.1; this.bright = o.bright ?? 0.5; this.exh = o.exhaust || 0; this.disp = o.disp || 3; this.redline = o.redline || 7000; this.idle = o.idle || 800;
    this.turbo = o.turbo || 0; this.diesel = !!o.diesel; this.intakeG = o.intake ?? 0.5; this.bovG = o.bov ?? 0.5; this.gain = o.gain ?? 1; this.lite = !!o.lite; this.dct = !!o.dct;
    this.airbox = o.airbox || 160; this.runner = o.runner || 620; this.popBase = o.pops ?? 1;
    const L = o.pipe || 1.8; // header + collector length, metres
    this.pipes = [new Pipe(sr * 2 * L / 343), new Pipe(sr * 2 * (L * (this.banks > 1 ? 1.13 : 1)) / 343)];
    this.tail = [new Pipe(sr * 2 * 0.55 / 343), new Pipe(sr * 2 * 0.61 / 343)];
    this.phase = Math.random() * 720; this.e1 = new Float32Array(this.nc); this.e2 = new Float32Array(this.nc); this.amp = new Float32Array(this.nc);
    this.muf = [0, 0]; this.muf2 = [0, 0]; this.cab = [0, 0]; this.dc = [0, 0]; this.dcx = [0, 0];
    this.air = new SVF(); this.run = new SVF(); this.knock = new SVF(); this.knock2 = new SVF(); this.hiss = new SVF(); this.bovF = new SVF(); this.tick1 = new SVF();
    this.knock.set(2700, 3); this.knock2.set(4300, 4); this.tick1.set(5200, 5); this.air.set(this.airbox, 2.5); this.run.set(this.runner, 2);
    this.seed = 12345 + (Math.random() * 1e6 | 0);
    this.rpmS = o.idle || 900; this.loadS = 0; this.ovS = 0; this.cutS = 0; this.tb = 0; this.lastLoad = 0; this.ovT = 0; this.alive = true;
    this.lim = 0; this.limT = 0; this.limCut = false; this.clk = 0; this.popE = 0; this.popA = 0; this.popB = 0; this.popWait = -1; this.popN = 0; this.popMsgT = 0;
    this.bov = 0; this.bovF0 = 3000; this.twPh = 0; this.cutPrev = 0; this.hp = 0; this.hpx = 0;
    this.port.onmessage = e => { if (e.data === 'stop') this.alive = false; };
  }
  rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 2147483648 - 1; }
  firePop(amp, bank, delay) { this.popWait = delay | 0; this.popA = amp; this.popB = bank; }
  process(inputs, outputs, P) {
    if (!this.alive) return false;
    const out = outputs[0]; const L = out[0], R = out[1] || out[0]; const N = L.length, sr = sampleRate;
    if (P.active[0] < 0.5) { L.fill(0); R.fill(0); return true; }
    const rpmT = P.rpm[0], loadT = P.load[0], ovT = P.overrun[0], cutT = P.cut[0], boostT = P.boost[0], crackle = P.crackle[0] * this.popBase, view = P.view[0], dop = P.dop[0];
    const nc = this.nc, exh = this.exh, bright = this.bright, dsl = this.diesel, tur = this.turbo, lite = this.lite, red = this.redline;
    // ---- per block (128 samples): rev limiter state, filter coefficients, pulse shapes
    const bt = N / sr;
    if (this.rpmS > red * 0.985 && this.loadS > 0.4) { // fuel-cut limiter: cut until rpm falls ~2%, then refire -> ~12-18 Hz stutter
      this.limT -= bt; if (this.limT <= 0) { this.limCut = !this.limCut; this.limT = this.limCut ? 0.03 + this.rnd() * 0.008 : 0.038 + this.rnd() * 0.01; }
    } else { this.limCut = false; this.limT = 0; }
    this.lim += ((this.limCut ? 1 : 0) - this.lim) * 0.5;
    if (cutT > 0.5 && this.cutPrev <= 0.5 && this.loadS > 0.45 && crackle > 0) { // ignition cut on a full-load upshift: DCT "brap" / crack
      this.firePop((this.dct ? 1.2 : 0.7) * Math.min(1.5, 0.6 + crackle * 0.5), this.rnd() > 0 ? 1 : 0, sr * 0.004); this.popN = this.dct ? 1 + (this.rnd() > 0.2 ? 1 : 0) : 0;
    }
    this.cutPrev = cutT;
    // blow-off valve: sharp lift with boost built up
    if (tur && this.lastLoad > 0.55 && loadT < 0.15 && this.tb > 0.45 && this.bov < 0.05) { this.bov = 1; this.bovF0 = 3200 + this.rnd() * 400; }
    this.lastLoad += (loadT - this.lastLoad) * 0.25;
    const rn0 = Math.min(1.2, this.rpmS / red);
    const tdec = (dsl ? 0.0009 : 0.0006) + (dsl ? 0.0042 : 0.0034) * Math.min(1.5, 900 / Math.max(500, this.rpmS)) * (1 - 0.25 * this.loadS);
    const d1 = Math.exp(-1 / (sr * tdec)), d2 = Math.exp(-1 / (sr * tdec * (dsl ? 0.12 : 0.28)));
    const fc = (110 + rn0 * 650 + this.loadS * 480 + exh * 380 + bright * 320) * (tur ? 0.78 : 1) * (1 - view * 0.35) * (dsl ? 0.75 : 1);
    const km = 1 - Math.exp(-2 * Math.PI * fc / sr);
    const kc = 1 - Math.exp(-2 * Math.PI * (view > 0.5 ? 900 + this.loadS * 500 : 12000) / sr); // cabin insulation low-pass
    if (!lite) { this.run.set(this.runner * (0.85 + 0.3 * rn0), 2 + this.loadS); this.hiss.set(3000 + this.tb * 2500, 2.5); }
    if (this.bov > 0.001) this.bovF.set(900 + (this.bovF0 - 900) * this.bov, 2.2);
    const twF = (1800 + Math.min(1.2, this.tb) * 6800) * dop, twInc = 2 * Math.PI * twF / sr;
    const refl = -0.52 + exh * 0.04 - (tur ? 0.1 : 0), damp = 0.18 + bright * 0.18 - (tur ? 0.06 : 0);
    const var0 = 0.05 + this.rough * 0.25;
    const intG = this.intakeG * (0.6 + view * 1.1), exG = 1 - view * 0.35;
    for (let s = 0; s < N; s++) {
      this.rpmS += (rpmT - this.rpmS) * 0.0025; this.loadS += (loadT - this.loadS) * 0.004; this.ovS += (ovT - this.ovS) * 0.003; this.cutS += (cutT - this.cutS) * 0.02;
      this.tb += ((tur ? boostT : 0) - this.tb) * (boostT > this.tb ? 0.00012 : 0.0004);
      const load = this.loadS, rpm = Math.max(200, this.rpmS * (1 - 0.018 * this.lim)), rn = rpm / red;
      const prev = this.phase; this.phase += rpm * dop / 60 * 360 / sr; const wrap = this.phase >= 720; if (wrap) this.phase -= 720;
      const burn = (1 - Math.max(this.cutS, this.lim)); // 0 = ignition/fuel cut
      let fired = false;
      for (let c = 0; c < nc; c++) {
        const a = this.cyl[c][0];
        const crossed = wrap ? (a > prev || a <= this.phase) : (a > prev && a <= this.phase);
        if (!crossed) continue;
        fired = true;
        // combustion strength: load, plus pumping pulse when closed (engine braking); lumpy with variation
        const v = 1 + this.rnd() * (var0 + (1 - load) * 0.12 + this.ovS * 0.1);
        const miss = load < 0.1 && this.rnd() > 0.93 - this.rough * 0.2 ? 0.35 : 1; // lean misfire on a closed throttle (V8 lope)
        this.amp[c] = ((0.18 + 0.82 * load) * burn * miss * (1 - this.ovS * 0.35) + 0.16) * v * (0.5 + 0.7 * Math.min(1.1, rn)); this.e1[c] = 1; this.e2[c] = 1;
        if (dsl) this.clk = Math.max(this.clk, (0.55 + 0.45 * (1 - load)) * (1.2 - rn * 0.6) * burn);
        // overrun crackle: rate ~ crackle * 7/s, strongest in the first ~1.5 s after lifting (hot exhaust)
        if (crackle > 0 && this.popWait < 0 && this.popE < 0.2 && rpm > 2300) {
          const fireRate = rpm / 60 * nc / 2; const ovHeat = this.ovS * Math.max(0.25, 1 - this.ovT / 2.5);
          const rate = crackle * (ovHeat * 7 * (tur ? 1.2 : 0.8) + this.lim * 5) * (0.5 + exh * 0.35);
          if (this.rnd() * 0.5 + 0.5 < rate / fireRate) this.firePop(0.5 + (this.rnd() * 0.5 + 0.5) * 0.9 * Math.min(1.6, 0.6 + crackle * 0.4), this.cyl[c][1], sr * (0.002 + (this.rnd() * 0.5 + 0.5) * 0.02));
        }
      }
      if (this.ovS > 0.5) this.ovT += 1 / sr; else this.ovT = 0;
      // pulses -> banks
      let b0 = 0, b1 = 0, ip = 0;
      for (let c = 0; c < nc; c++) {
        const e1 = this.e1[c]; if (e1 < 2e-4) continue; const e2 = this.e2[c];
        const p = (e1 - e2) * this.amp[c]; ip += p; if (this.cyl[c][1] === 0) b0 += p; else b1 += p; this.e1[c] = e1 * d1; this.e2[c] = e2 * d2;
      }
      // pops: unburnt fuel igniting in the hot exhaust: short broadband blast in the pipe + a post-muffler crack
      if (this.popWait >= 0) { if (this.popWait-- === 0) { this.popE = 1; if (this.popMsgT <= 0 && this.popA > 0.9) { this.port.postMessage(this.popA); this.popMsgT = sr * 0.12; } } }
      if (this.popMsgT > 0) this.popMsgT--;
      let crack = 0;
      if (this.popE > 1e-3) { const nz = this.rnd(); const pe = this.popE * this.popA; const x = pe * (0.9 + nz * 1.4); if (this.popB) b1 += x; else b0 += x; crack = pe * this.popE * nz * 0.55; this.popE *= 0.9982 - (this.rnd() > 0.97 ? 0.02 : 0);
        if (this.popE < 0.05 && this.popN > 0) { this.popN--; this.firePop(this.popA * 0.7, 1 - this.popB, sr * 0.018); } }
      // exhaust layer
      const y0 = this.pipes[0].tick(b0, refl, damp), y1 = this.banks > 1 ? this.pipes[1].tick(b1, refl, damp) : y0;
      this.muf[0] += (y0 - this.muf[0]) * km; this.muf2[0] += (this.muf[0] - this.muf2[0]) * km;
      this.muf[1] += (y1 - this.muf[1]) * km; this.muf2[1] += (this.muf[1] - this.muf2[1]) * km;
      const leak = 0.03 + exh * 0.04 + (tur ? 0 : 0.015);
      let o0 = this.tail[0].tick(this.muf2[0] + (y0 - this.muf2[0]) * leak + crack, -0.3, 0.5);
      let o1 = this.banks > 1 ? this.tail[1].tick(this.muf2[1] + (y1 - this.muf2[1]) * leak + crack, -0.3, 0.5) : o0;
      this.cab[0] += (o0 - this.cab[0]) * kc; this.cab[1] += (o1 - this.cab[1]) * kc; o0 = this.cab[0] * exG; o1 = this.cab[1] * exG;
      // intake layer, mechanical, diesel knock, turbo
      let mid = 0;
      if (!lite) {
        const flow = this.rnd() * rn * (0.15 + load) * 0.35;
        const ex = ip * (0.25 + load * 0.9) + flow;
        mid += (this.air.tick(ex) * 0.7 + this.run.tick(ex) * 0.35 * rn) * intG * (tur ? 0.55 : 1);
        if (fired) this.hp = 1; this.hp *= 0.9; mid += this.tick1.tick(this.hp * this.rnd()) * 0.02 * (0.3 + rn);
      }
      if (dsl && this.clk > 1e-3) { const nz = this.rnd() * this.clk; mid += (this.knock.tick(nz) * 0.04 + this.knock2.tick(nz) * 0.02) * (0.7 + view * 0.5); this.clk *= 0.996; }
      if (tur) {
        this.twPh += twInc; if (this.twPh > 6.2832) this.twPh -= 6.2832;
        const spool = Math.min(1.2, this.tb); const tw = Math.sin(this.twPh) * spool * spool * (0.25 + 0.75 * load) * 0.035 * (0.6 + view * 0.8);
        mid += tw; if (!lite) mid += this.hiss.tick(this.rnd()) * spool * spool * load * 0.014;
      }
      if (this.bov > 0.001) { mid += this.bovF.tick(this.rnd()) * this.bov * this.bov * this.bovG * 0.5; this.bov *= 0.99985; }
      // DC block + soft limit; banks mostly centred (70/30) so a V engine is not hard-panned
      const m0 = (o0 * 0.7 + o1 * 0.3) + mid, m1 = (o1 * 0.7 + o0 * 0.3) + mid;
      const g = (1.6 + this.disp * 0.15) * this.gain;
      let y = m0 - this.dcx[0] + 0.995 * this.dc[0]; this.dcx[0] = m0; this.dc[0] = y; L[s] = Math.tanh(y * g) * 0.7;
      y = m1 - this.dcx[1] + 0.995 * this.dc[1]; this.dcx[1] = m1; this.dc[1] = y; R[s] = Math.tanh(y * g) * 0.7;
    }
    return true;
  }
}
registerProcessor('cuzzy-engine', EngineProc);
