// CUZZY RACING audio: engine synthesis per engine layout, turbo, exhaust pops, tyres/wind/impacts, tunnel reverb,
// EV motor/inverter whine, menu sounds, generative music and the spoken intro. All sound is synthesised in code
// except the spoken intro (generated speech, see docs/ASSETS_AND_LICENCES.md).
import introB64 from '../data/intro_voice.js';
import { gearboxType } from '../shared/physics.js';

const CYL = { I3: 3, I4: 4, I5: 5, I6: 6, V6: 6, V8: 8, V10: 10, V12: 12, F6: 6 };
// character per layout: [harmonic weights], rumble (uneven firing), rasp
const CHAR = {
  I3: { h: [[0.5, .6], [1, 1], [1.5, .5], [2, .4], [3, .2]], rough: .25, rasp: .5 },
  I4: { h: [[1, 1], [2, .55], [3, .25], [4, .2], [0.5, .15]], rough: .08, rasp: .55 },
  I5: { h: [[0.5, .5], [1, 1], [1.5, .6], [2.5, .35], [2, .3]], rough: .3, rasp: .6 },
  I6: { h: [[1, 1], [2, .5], [3, .35], [1.5, .15], [4, .15]], rough: .02, rasp: .45 },
  V6: { h: [[0.5, .35], [1, 1], [1.5, .4], [2, .4], [3, .2]], rough: .15, rasp: .5 },
  V8: { h: [[0.25, .4], [0.5, .9], [1, 1], [1.5, .35], [2, .3]], rough: .45, rasp: .35 },
  V10: { h: [[0.5, .5], [1, 1], [2, .6], [1.5, .3], [3, .3]], rough: .12, rasp: .7 },
  V12: { h: [[0.5, .3], [1, 1], [2, .7], [3, .35], [1.5, .2]], rough: .03, rasp: .6 },
  F6: { h: [[0.5, .55], [1, 1], [1.5, .45], [2, .35], [3, .2]], rough: .2, rasp: .55 },
};

export class AudioSys {
  constructor(settings) {
    this.s = settings; this.ctx = null; this.ready = false; this.engines = new Map();
  }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    this.setup(new AC({ latencyHint: 'interactive' }));
    this.wkReady = false; this.ctx.audioWorklet?.addModule(new URL('./engine-worklet.js', import.meta.url)).then(() => { this.wkReady = true; }).catch(e => console.warn('engine worklet unavailable, using fallback synth', e));
  }
  // offline use (tests/snd_render.mjs renders rev sweeps through the exact in-game chain): pass an OfflineAudioContext
  async attach(ctx) { this.setup(ctx); try { await ctx.audioWorklet.addModule(new URL('./engine-worklet.js', import.meta.url)); this.wkReady = true; } catch (e) { this.wkReady = false; } }
  setup(ctx) {
    this.ctx = ctx; const c = ctx;
    this.master = c.createGain(); this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -12; this.comp.ratio.value = 3;
    this.master.connect(this.comp); this.comp.connect(c.destination);
    this.bus = {}; for (const k of ['engine', 'exhaust', 'fx', 'music', 'voice', 'menu', 'intro']) { const g = c.createGain(); g.connect(this.master); this.bus[k] = g; }
    // tunnel / covered-passage reverb: generated concrete-tube impulse (discrete early reflections + damped tail)
    this.reverb = c.createConvolver(); this.reverb.buffer = this.tunnelIR(1.8); this.revSend = c.createGain(); this.revSend.gain.value = 0;
    const revHp = c.createBiquadFilter(); revHp.type = 'highpass'; revHp.frequency.value = 90; this.revSend.connect(revHp); revHp.connect(this.reverb); this.reverb.connect(this.master);
    this.noise = this.noiseBuffer(2);
    this.applyVolumes(); this.ready = true;
  }
  tunnelIR(sec) { // walls ~4-7 m away: flutter echoes every ~12-20 ms, highs absorbed faster than lows
    const c = this.ctx, sr = c.sampleRate, n = Math.floor(sr * sec), b = c.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); let lp = 0;
      for (let i = 0; i < n; i++) { const x = i / n; const k = 0.08 + 0.85 * Math.pow(1 - x, 2.5); lp += ((Math.random() * 2 - 1) - lp) * k; d[i] = lp * Math.pow(1 - x, 2.4) * (i < sr * 0.008 ? 0 : 0.5); }
      for (let r = 1; r <= 14; r++) { const at = Math.floor(sr * (0.011 + ch * 0.003) * r * (1 + (Math.random() - 0.5) * 0.15)); if (at < n) d[at] += (r % 2 ? 0.7 : -0.6) * Math.pow(0.8, r); } }
    return b; }
  applyVolumes() {
    if (!this.ctx) return; const s = this.s.sound; const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.master, t, 0.03);
    this.bus.engine.gain.setTargetAtTime(s.engine, t, 0.03); this.bus.exhaust.gain.setTargetAtTime(s.exhaust, t, 0.03); this.bus.fx.gain.setTargetAtTime(s.tyres, t, 0.03);
    this.bus.music.gain.setTargetAtTime(s.music * 0.5, t, 0.03); this.bus.voice.gain.setTargetAtTime(s.voice, t, 0.03); this.bus.menu.gain.setTargetAtTime(s.menu, t, 0.03); this.bus.intro.gain.setTargetAtTime(s.intro, t, 0.03);
  }
  impulse(sec, decay) { const c = this.ctx, n = c.sampleRate * sec, b = c.createBuffer(2, n, c.sampleRate); for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay) * (i < c.sampleRate * 0.02 ? 0.3 : 1); } return b; }
  noiseBuffer(sec) { const c = this.ctx, n = c.sampleRate * sec, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; return b; }
  noiseSrc() { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.start(this.ctx.currentTime + Math.random() * 0.1); return s; }
  // ---- UI -----------------------------------------------------------------------------------------
  click(kind = 'tap') {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime; const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(kind === 'back' ? 420 : kind === 'buy' ? 880 : 660, t); o.frequency.exponentialRampToValueAtTime(kind === 'back' ? 260 : 990, t + 0.06);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g); g.connect(this.bus.menu); o.start(t); o.stop(t + 0.15);
    if (kind === 'buy') setTimeout(() => this.click('tap'), 90);
  }
  // ---- intro voice ---------------------------------------------------------------------------------
  async playIntro() {
    if (!this.ctx) return 0;
    if (!this.introBuf) { const bin = atob(introB64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); try { this.introBuf = await this.ctx.decodeAudioData(u.buffer); } catch (e) { return 0; } }
    const s = this.ctx.createBufferSource(); s.buffer = this.introBuf; s.connect(this.bus.intro); s.start(this.ctx.currentTime + 0.05); return this.introBuf.duration;
  }
  // ---- engine start + crackle (intro / showroom) -----------------------------------------------------
  engineStart(car, dur = 2.4) {
    if (!this.ctx) return; const e = this.createEngine(car, 'preview'); const t0 = performance.now();
    const S = { rpm: 0, throttle: 0, load: 0, overrun: 0 };
    const tick = () => { const t = (performance.now() - t0) / 1000; if (t > dur + 0.8) { e.stop(); return; }
      if (car.asp === 'EV') { S.rpm = t < 0.6 ? t * 9000 : t < 1.2 ? 5400 - (t - 0.6) * 6000 : 1800; S.throttle = t < 0.6 ? 1 : 0; }
      else { const idle = 850; S.rpm = t < 0.35 ? 250 + t * 1200 : t < 0.8 ? idle + (t - 0.35) * 7000 : t < 1.3 ? Math.max(idle, 4000 - (t - 0.8) * 6000) : t < 1.7 ? idle + (t - 1.3) * 9000 : Math.max(idle, 4400 - (t - 1.7) * 7000);
        S.throttle = (t > 0.35 && t < 0.8) || (t > 1.3 && t < 1.7) ? 1 : 0.05; S.overrun = (t > 0.8 && t < 1.25) || (t > 1.7 && t < 2.3) ? 1 : 0; }
      e.update(S, 1 / 60, { speed: 0, local: true }); requestAnimationFrame(tick); };
    tick();
  }
  // ---- engine voice ------------------------------------------------------------------------------------
  // Per-car voicing for the physically-modelled worklet (engine-worklet.js). Values are tuning, not measurements:
  // pipe = header+collector length (m), bright = pulse sharpness/muffler openness, rough = cycle variation/lope,
  // intake = induction level, airbox/runner = intake resonances (Hz), turbo = 0/1/2 (single/twin), bov = blow-off level,
  // pops = crackle tendency, gain = worklet drive (saturation), level = output trim in dB (from tests/snd_analyse.py WOT RMS).
  static VOICE = {
    db9v: { pipe: 1.75, bright: 0.55, rough: 0.03, intake: 0.55, airbox: 150, runner: 560, pops: 0.6, gain: 1.05, level: 0 },
    rrs23: { pipe: 2.1, bright: 0.38, rough: 0.5, intake: 0.35, airbox: 120, runner: 480, turbo: 2, bov: 0.25, pops: 0.9, gain: 1.0, level: -1.5 },
    rrsd300: { pipe: 2.2, bright: 0.18, rough: 0.12, intake: 0.3, airbox: 110, runner: 420, turbo: 1, bov: 0.18, diesel: 1, pops: 0, gain: 1.25, level: -2 },
    box986: { pipe: 1.3, bright: 0.6, rough: 0.16, intake: 0.9, airbox: 190, runner: 700, pops: 0.5, gain: 1.05, level: 0 },
    r8: { pipe: 1.45, bright: 0.72, rough: 0.1, intake: 0.75, airbox: 180, runner: 760, pops: 0.8, gain: 0.95, level: 2.9 },
    hurac: { pipe: 1.35, bright: 0.8, rough: 0.1, intake: 0.65, airbox: 185, runner: 800, pops: 1.2, exhaust: 0.5, gain: 0.95, level: 3.2 },
    avent: { pipe: 1.3, bright: 0.78, rough: 0.04, intake: 0.7, airbox: 170, runner: 820, pops: 1.1, gain: 0.95, level: 0.5 },
    f458: { pipe: 1.1, bright: 0.92, rough: 0.05, intake: 0.8, airbox: 210, runner: 900, pops: 0.8, gain: 0.9, level: 2.7 },
    r6a: { pipe: 2.0, bright: 0.5, rough: 0.42, intake: 0.5, airbox: 125, runner: 520, turbo: 2, bov: 0.45, pops: 1.25, exhaust: 0.4, gain: 1.05, level: -1 }, // p53 4.0 twin-turbo cross-plane V8 burble
    gti8: { pipe: 1.6, bright: 0.45, rough: 0.07, intake: 0.45, airbox: 150, runner: 600, turbo: 1, bov: 0.55, pops: 1.0, gain: 1.15, level: -3.2 },
  };
  voiceFor(car) {
    const v = AudioSys.VOICE[car.id]; if (v) return v; const ch = CHAR[car.engine] || CHAR.I4; const t = car.asp === 'T' ? 1 : car.asp === 'TT' ? 2 : 0;
    return { pipe: 1.6, bright: ch.rasp * (car.asp === 'NA' ? 1.1 : 0.8), rough: ch.rough, intake: car.asp === 'NA' ? 0.6 : 0.4, turbo: t, bov: 0.4, diesel: /diesel/i.test(car.note || '') ? 1 : 0, pops: 0.8, gain: 1 };
  }
  createEngine(car, id, positional = false) {
    const c = this.ctx; const ev = car.asp === 'EV'; const up = car._up || {}; const local = id === 'me' || id === 'preview';
    const out = c.createGain(); out.gain.value = 0; const pan = c.createStereoPanner();
    // other cars: air absorption low-pass grows with distance
    let air = null; if (!local) { air = c.createBiquadFilter(); air.type = 'lowpass'; air.frequency.value = 16000; out.connect(air); air.connect(pan); } else out.connect(pan);
    pan.connect(this.bus.engine); out.connect(this.revSend);
    const E = { car, out, pan, air, oscs: [], t: 0, popT: 0, lastGear: 0, box: gearboxType(car), cutT: 0, lastD: null, dop: 1, gust: 0, jointT: 0 };
    if (!ev) {
      const ch = CHAR[car.engine] || CHAR.I4; const cyl = CYL[car.engine] || 4;
      E.fire = cyl / 2; // firing events per crank revolution
      if (this.wkReady) { // physically-modelled pulse/waveguide engine (engine-worklet.js)
        const flat = /^(f458|f488|f8t)$/.test(car.id); const layout = car.engine === 'V8' && flat ? 'V8F' : car.engine;
        const litres = parseFloat((car.note || '').match(/(\d\.\d)\s?(?:L|V|litre|twin|six|flat)/i)?.[1]) || { I3: 1.2, I4: 2, I5: 2.5, I6: 3, V6: 3, V8: 4.5, V10: 5.2, V12: 6.5, F6: 3 }[car.engine] || 2;
        const V = this.voiceFor(car);
        const wk = new AudioWorkletNode(c, 'cuzzy-engine', { numberOfInputs: 0, outputChannelCount: [2], processorOptions: { layout, rough: V.rough + (car.asp === 'NA' ? 0.03 : 0), bright: V.bright, exhaust: (up.exhaust || 0) + (V.exhaust || 0), disp: litres, redline: car.redline || 7000, idle: V.diesel ? 750 : 800,
          pipe: V.pipe, turbo: V.turbo || 0, bov: (V.bov ?? 0.4) * (1 + (up.turbo || 0) * 0.3), diesel: !!V.diesel, intake: V.intake, airbox: V.airbox, runner: V.runner, pops: V.pops ?? 1, gain: V.gain ?? 1, dct: E.box === 'dct' || E.box === 'amt', lite: !local } });
        const body = c.createBiquadFilter(); body.type = 'lowshelf'; body.frequency.value = 160; body.gain.value = 3 + litres * 0.8;
        const pres = c.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 1400; pres.Q.value = 0.7; pres.gain.value = 2;
        const g = c.createGain(); g.gain.value = 1.4 * Math.pow(10, (V.level || 0) / 20); wk.connect(body); body.connect(pres); pres.connect(g); g.connect(out); E.wk = wk; E.pres = pres;
        E.P = {}; for (const k of ['rpm', 'load', 'overrun', 'cut', 'boost', 'crackle', 'view', 'dop', 'active']) E.P[k] = wk.parameters.get(k);
        wk.port.onmessage = ev2 => { if (E.onFlame && Math.random() < 0.35) E.onFlame(); }; // big pops can light a flame
      } else {
      const shaper = c.createWaveShaper(); const k = 2 + ch.rasp * 6 + (up.exhaust || 0) * 1.5; const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * k) / Math.tanh(k); } shaper.curve = curve;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2; const body = c.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 120; body.gain.value = 6; body.Q.value = 0.8;
      const pre = c.createGain(); pre.gain.value = 0.35;
      for (const [m, a] of ch.h) { const o = c.createOscillator(); o.type = m < 1 ? 'sine' : 'sawtooth'; const g = c.createGain(); g.gain.value = a * 0.25; o.connect(g); g.connect(pre); o.start(); E.oscs.push({ o, m, g, a }); }
      const am = c.createGain(); am.gain.value = 1; const lfo = c.createOscillator(); lfo.type = 'sine'; const lfoG = c.createGain(); lfoG.gain.value = ch.rough * 0.6; lfo.connect(lfoG); lfoG.connect(am.gain); lfo.start(); E.lfo = lfo;
      pre.connect(am); am.connect(shaper); shaper.connect(body); body.connect(lp); lp.connect(out); E.lp = lp; E.pre = pre;
      const n = this.noiseSrc(); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9; const ng = c.createGain(); ng.gain.value = 0; n.connect(bp); bp.connect(ng); ng.connect(out); E.intake = { n, bp, ng };
      if (car.asp === 'T' || car.asp === 'TT') { const o = c.createOscillator(); o.type = 'sine'; const g = c.createGain(); g.gain.value = 0; const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2000; o.connect(hp); hp.connect(g); g.connect(out); o.start(); E.turbo = { o, g }; }
      }
      if (car.asp === 'SC') { const o = c.createOscillator(); o.type = 'sawtooth'; const g = c.createGain(); g.gain.value = 0; const bp2 = c.createBiquadFilter(); bp2.type = 'bandpass'; bp2.frequency.value = 3000; bp2.Q.value = 4; o.connect(bp2); bp2.connect(g); g.connect(out); o.start(); E.sc = { o, g }; }
      E.exOut = c.createGain(); E.exOut.gain.value = 1; E.exOut.connect(this.bus.exhaust); E.exOut.connect(this.revSend);
    } else {
      // EV: motor whine (two gear-mesh tones) + inverter switching
      for (const [m, a, type] of [[1, 0.5, 'sine'], [2.02, 0.25, 'triangle'], [3.1, 0.12, 'sine']]) { const o = c.createOscillator(); o.type = type; const g = c.createGain(); g.gain.value = a * 0.2; o.connect(g); g.connect(out); o.start(); E.oscs.push({ o, m, g, a }); }
      const inv = c.createOscillator(); inv.type = 'square'; const ig = c.createGain(); ig.gain.value = 0; const ibp = c.createBiquadFilter(); ibp.type = 'bandpass'; ibp.Q.value = 12; inv.connect(ibp); ibp.connect(ig); ig.connect(out); inv.start(); E.inv = { o: inv, g: ig, bp: ibp };
      if (car.ev?.eshift) E.synthetic = true;
    }
    // ---- tyres, wind, road (one shared noise source per car; other cars get tyres only)
    const fxOut = c.createGain(); fxOut.connect(this.bus.fx); fxOut.connect(this.revSend); E.fxOut = fxOut;
    const fxIn = air ? (() => { const g = c.createGain(); g.connect(air); return g; })() : fxOut; // remote tyres go through the distance filter + pan
    const tn = this.noiseSrc();
    // tyre squeal: two narrow resonances (tread block stick-slip) + a broad scrub band; jittered each frame
    const sq1 = c.createBiquadFilter(); sq1.type = 'bandpass'; sq1.Q.value = 9; sq1.frequency.value = 900;
    const sq2 = c.createBiquadFilter(); sq2.type = 'bandpass'; sq2.Q.value = 7; sq2.frequency.value = 1450;
    const scrub = c.createBiquadFilter(); scrub.type = 'bandpass'; scrub.Q.value = 1.2; scrub.frequency.value = 600;
    const tg = c.createGain(); tg.gain.value = 0; const tg2 = c.createGain(); tg2.gain.value = 0; const sg = c.createGain(); sg.gain.value = 0;
    tn.connect(sq1); sq1.connect(tg); tn.connect(sq2); sq2.connect(tg2); tn.connect(scrub); scrub.connect(sg);
    const tsh = c.createWaveShaper(); { const cv = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 127.5 - 1; cv[i] = Math.tanh(x * 3); } tsh.curve = cv; }
    tg.connect(tsh); tg2.connect(tsh); tsh.connect(fxIn); sg.connect(fxIn);
    E.tyre = { n: tn, a: sq1, b: sq2, g: tg, g2: tg2, s: sg, sb: scrub };
    if (local) {
      // road: tyre/road roar low-passed with speed; wind: turbulence noise, cutoff and level rise with speed
      const road = c.createBiquadFilter(); road.type = 'lowpass'; road.frequency.value = 250; road.Q.value = 0.7; const rg = c.createGain(); rg.gain.value = 0; tn.connect(road); road.connect(rg); rg.connect(fxOut);
      const rough = c.createBiquadFilter(); rough.type = 'bandpass'; rough.frequency.value = 180; rough.Q.value = 1.5; const rgg = c.createGain(); rgg.gain.value = 0; tn.connect(rough); rough.connect(rgg);
      const am = c.createGain(); am.gain.value = 0; const amo = c.createOscillator(); amo.type = 'square'; amo.frequency.value = 40; const amg = c.createGain(); amg.gain.value = 0; amo.connect(amg); amg.connect(am.gain); amo.start(); rgg.connect(am); am.connect(fxOut); // cobble/sett patter
      const wind = c.createBiquadFilter(); wind.type = 'lowpass'; wind.frequency.value = 400; wind.Q.value = 0.9; const wbp = c.createBiquadFilter(); wbp.type = 'highpass'; wbp.frequency.value = 120;
      const wg = c.createGain(); wg.gain.value = 0; tn.connect(wbp); wbp.connect(wind); wind.connect(wg); wg.connect(fxOut);
      E.road = { f: road, g: rg, rf: rough, rg: rgg, am, amo, amg }; E.wind = { f: wind, g: wg };
    }
    const self = this;
    E.update = (S, dt, env = {}) => {
      const t = c.currentTime; const k = 0.03; E.onFlame = env.onFlame;
      const dist = env.dist || 0;
      const vol = env.local ? 1 : Math.max(0, 1 - dist / 160) ** 2;
      if (env.pan != null) pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, env.pan)) * 0.75, t, 0.05); // never fully hard-panned
      // doppler for other cars: radial speed from the change in distance (+ = moving away)
      if (!local && dt > 0) { if (E.lastD != null) { const vr = Math.max(-80, Math.min(80, (dist - E.lastD) / dt)); const d = 343 / (343 + vr); E.dop += (d - E.dop) * Math.min(1, dt * 6); } E.lastD = dist; if (air) air.frequency.setTargetAtTime(Math.max(1500, 16000 - dist * 90), t, 0.1); }
      const spd = env.speed || 0;
      if (!ev) {
        const rpm = Math.max(300, S.rpm); const f0 = rpm / 60 * E.fire; const load = S.throttle;
        // gear change: brief ignition cut (DCT/AMT 60 ms at full load, manual/auto longer & softer)
        if (S.gear !== E.lastGear) { if (E.lastGear > 0 && S.gear > E.lastGear && load > 0.5) { E.cutT = E.box === 'dct' ? 0.06 : E.box === 'amt' ? 0.12 : E.box === 'manual' ? 0.22 : 0.09; if (!E.wk) self.shiftSound(E, vol, rpm, E.box); else if (E.box === 'manual' || E.box === 'auto' || E.box === 'tc') self.shiftSound(E, vol * 0.6, rpm, 'manual'); } E.lastGear = S.gear; }
        const cut = E.cutT > 0 ? 1 : 0; E.cutT -= dt;
        const crackle = Math.max(0, env.crackle ?? 1) * (0.5 + (up.exhaust || 0) * 0.35);
        if (E.wk) {
          const P = E.P; const act = vol > 0.002 ? 1 : 0;
          P.active.setValueAtTime(act, t); P.rpm.setValueAtTime(rpm, t); P.load.setValueAtTime(cut ? 0 : load, t); P.overrun.setValueAtTime(S.overrun > 0.3 ? 1 : 0, t); P.cut.setValueAtTime(cut, t);
          P.boost.setValueAtTime(Math.max(0, S.boost || 0), t); P.crackle.setValueAtTime(crackle, t); P.view.setValueAtTime(env.inCar ? 1 : 0, t); P.dop.setValueAtTime(local ? 1 : E.dop, t);
          E.pres.gain.setTargetAtTime(env.inCar ? -4 : 2, t, 0.1);
        } else {
          for (const o of E.oscs) { o.o.frequency.setTargetAtTime(f0 * o.m * E.dop, t, 0.012); }
          if (E.lfo) E.lfo.frequency.setTargetAtTime(rpm / 120, t, 0.02);
          E.lp.frequency.setTargetAtTime(400 + rpm * 0.55 + load * 1800 + (up.exhaust || 0) * 400, t, k);
          E.pre.gain.setTargetAtTime((0.18 + load * 0.35) * (cut ? 0.3 : 1), t, k);
          E.intake.bp.frequency.setTargetAtTime(300 + rpm * 0.4, t, k); E.intake.ng.gain.setTargetAtTime(load * 0.08 * (rpm / 7000), t, k);
          if (E.turbo) { E.turbo.o.frequency.setTargetAtTime(2500 + (S.boost || 0) * 5500, t, 0.05); E.turbo.g.gain.setTargetAtTime(vol * (S.boost || 0) * 0.04 * (1 + (up.turbo || 0) * 0.4), t, 0.05);
            if (S.throttle < 0.1 && (S.boost || 0) > 0.6 && !E.bov && env.local) { E.bov = true; self.blowOff(E, vol); } if (S.throttle > 0.5) E.bov = false; }
          E.popT -= dt;
          const cr = crackle * (car.asp === 'NA' ? 0.6 : 1) * 0.8;
          if (S.overrun > 0.3 && rpm > 2500 && E.popT <= 0 && cr > 0) { if (Math.random() < 0.35 * cr) { self.pop(E, vol, rpm); if (env.onFlame && Math.random() < 0.18 * cr) env.onFlame(); } E.popT = 0.05 + Math.random() * 0.22; }
        }
        out.gain.setTargetAtTime(vol * (E.wk ? 0.58 + load * 0.22 : 0.42 + load * 0.38) * (env.inCar ? 0.85 : 1), t, k);
        if (E.sc) { E.sc.o.frequency.setTargetAtTime(rpm * 0.9, t, 0.02); E.sc.g.gain.setTargetAtTime(vol * load * 0.05, t, 0.03); }
      } else {
        const w = Math.abs(S.rpm) / 60; for (const o of E.oscs) o.o.frequency.setTargetAtTime((80 + w * 6 * o.m) * E.dop, t, 0.02);
        E.inv.o.frequency.setTargetAtTime(700 + Math.min(1, Math.abs(S.kwOut || 0) / 300) * 900, t, 0.05); E.inv.bp.frequency.setTargetAtTime(1500 + w * 2, t, 0.05);
        E.inv.g.gain.setTargetAtTime(vol * (Math.min(1, Math.abs(S.kwOut || 0) / 200) * 0.05 + (spd < 8 ? 0.01 : 0)), t, 0.05);
        out.gain.setTargetAtTime(vol * (0.25 + Math.min(1, Math.abs(S.kwOut || 0) / 250) * 0.6), t, k);
      }
      // tyres: squeal needs real slip at speed; lock-ups and wheelspin scrub; wet road = hiss instead of squeal
      const lat = Math.max(0, (S.slipF || 0) + (S.slipR || 0) - 0.12) * (spd > 3 ? 1 : 0), spin = (S.spinR || 0) * 0.8 + (S.lockF ? 0.5 : 0);
      const sl = Math.min(1, lat + spin); const jit = 1 + (Math.random() - 0.5) * 0.25; const wet = env.wet ? 1 : 0; const dp = local ? 1 : E.dop;
      const sqA = vol * Math.min(0.32, sl * 0.7) * (wet ? 0.25 : 1) * jit;
      E.tyre.g.gain.setTargetAtTime(sqA, t, 0.04); E.tyre.g2.gain.setTargetAtTime(sqA * (0.35 + sl * 0.5), t, 0.04);
      E.tyre.a.frequency.setTargetAtTime((720 + sl * 380 + spd * 2.5) * dp * (1 + (Math.random() - 0.5) * 0.04), t, 0.03); E.tyre.b.frequency.setTargetAtTime((1250 + sl * 500 + spd * 3) * dp, t, 0.03);
      E.tyre.s.gain.setTargetAtTime(vol * Math.min(0.3, sl * 0.35 + (wet ? sl * 0.4 : 0)), t, 0.05); E.tyre.sb.frequency.setTargetAtTime(wet ? 2400 : 500 + spd * 5, t, 0.05);
      if (E.road) { // road surface: asphalt (default), concrete (expansion-joint thumps), cobbles/setts (patter), gravel (bright crunch)
        const surf = env.surface || 'asphalt'; const sv = Math.min(1, spd / 35);
        const sK = { asphalt: 1, concrete: 1.2, cobble: 1.5, setts: 1.5, gravel: 1.4, brick: 1.3 }[surf] || 1;
        E.road.g.gain.setTargetAtTime(Math.min(0.3, spd / 80) * sK * (wet ? 1.8 : 1) * (1 + (env.tunnel || 0) * 0.6), t, 0.1);
        E.road.f.frequency.setTargetAtTime(160 + sv * 380 + (wet ? 900 : 0) + (surf === 'gravel' ? 1200 : 0), t, 0.1);
        const pat = /cobble|setts|brick/.test(surf) ? 1 : surf === 'gravel' ? 0.6 : 0;
        E.road.rg.gain.setTargetAtTime(pat * Math.min(0.35, spd / 40), t, 0.08); E.road.amg.gain.setTargetAtTime(pat * 0.5, t, 0.08); E.road.am.gain.setTargetAtTime(pat * 0.5, t, 0.08);
        E.road.amo.frequency.setTargetAtTime(Math.max(5, spd / 0.11), t, 0.05);
        if (surf === 'concrete' && spd > 4) { E.jointT -= dt; if (E.jointT <= 0) { self.thump(E, Math.min(0.35, spd / 60)); E.jointT = 6 / spd; } }
        // wind: grows ~v^2, gusty; much louder with the roof down, muffled in the cockpit
        E.gust += (Math.random() - 0.5) * dt * 3; E.gust *= 0.97;
        const wv = Math.min(0.55, (spd / 65) ** 2) * (1 + E.gust * 0.4) * (env.conv ? 1.7 : 1) * (env.inCar && !env.conv ? 0.45 : 1);
        E.wind.g.gain.setTargetAtTime(Math.max(0, wv), t, 0.12); E.wind.f.frequency.setTargetAtTime(300 + spd * 30 * (env.inCar && !env.conv ? 0.5 : 1), t, 0.12);
      }
      if (env.local) self.setSpace(env.tunnel || 0);
    };
    E.stop = () => { const t = c.currentTime; out.gain.setTargetAtTime(0, t, 0.05); E.fxOut.gain.setTargetAtTime(0, t, 0.05); E.tyre.g.gain.setTargetAtTime(0, t, 0.05); E.tyre.g2.gain.setTargetAtTime(0, t, 0.05); E.tyre.s.gain.setTargetAtTime(0, t, 0.05);
      setTimeout(() => { try { E.oscs.forEach(o => o.o.stop()); E.lfo?.stop(); E.intake?.n.stop(); E.turbo?.o.stop(); E.sc?.o.stop(); E.inv?.o.stop(); E.tyre.n.stop(); E.road?.amo.stop(); } catch (e) { } try { E.wk?.port.postMessage('stop'); E.wk?.disconnect(); } catch (e) { } out.disconnect(); E.fxOut.disconnect(); air?.disconnect(); }, 300); };
    return E;
  }
  // tunnels / covered passages: wet reverb send + slight low-mid build-up (enclosed space)
  setSpace(tun) { const t = this.ctx.currentTime; if (Math.abs(tun - (this._tun ?? -1)) < 0.01) return; this._tun = tun; this.revSend.gain.setTargetAtTime(tun * 0.4, t, 0.25); this.revDry?.gain.setTargetAtTime(tun * 4, t, 0.25); }
  thump(E, a) { const c = this.ctx, t = c.currentTime; const o = c.createOscillator(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.08); const g = c.createGain(); g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1); o.connect(g); g.connect(E.fxOut); o.start(t); o.stop(t + 0.12);
    setTimeout(() => { if (!E.fxOut) return; const t2 = c.currentTime; const o2 = c.createOscillator(); o2.frequency.value = 60; const g2 = c.createGain(); g2.gain.setValueAtTime(a * 0.8, t2); g2.gain.exponentialRampToValueAtTime(0.0001, t2 + 0.08); o2.connect(g2); g2.connect(E.fxOut); o2.start(t2); o2.stop(t2 + 0.1); }, 110); }
  // gear-change sound: twin-clutch / single-clutch boxes get the sharp ignition-cut "brap" at full load,
  // manuals and torque-converter autos just a soft driveline clunk (the rev drop itself comes from the physics rpm)
  shiftSound(E, vol, rpm, box) {
    const c = this.ctx, t = c.currentTime;
    if ((box === 'dct' || box === 'amt') && rpm > 3500) { this.pop(E, vol * 0.9, rpm); if (Math.random() < 0.5) setTimeout(() => this.pop(E, vol * 0.5, rpm), 25); return; }
    const s = c.createBufferSource(); s.buffer = this.noise; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(1e-4, vol * (box === 'manual' ? 0.25 : 0.12)), t + 0.005); // vol is 0 for far-off cars (AI / remotes) g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    s.connect(lp); lp.connect(g); g.connect(E.fxOut || this.bus.fx); s.start(t, Math.random()); s.stop(t + 0.1);
  }
  pop(E, vol, rpm) {
    const c = this.ctx, t = c.currentTime; const s = c.createBufferSource(); s.buffer = this.noise; const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 180 + Math.random() * 500; bp.Q.value = 0.7;
    const g = c.createGain(); const amp = vol * (0.5 + Math.random() * 0.6); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(amp, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06 + Math.random() * 0.08);
    s.connect(bp); bp.connect(g); g.connect(E.exOut); s.start(t, Math.random()); s.stop(t + 0.2);
  }
  blowOff(E, vol) { const c = this.ctx, t = c.currentTime; const s = c.createBufferSource(); s.buffer = this.noise; const hp = c.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.setValueAtTime(3000, t); hp.frequency.exponentialRampToValueAtTime(900, t + 0.4); const g = c.createGain(); g.gain.setValueAtTime(vol * 0.15, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45); s.connect(hp); hp.connect(g); g.connect(E.exOut); s.start(t); s.stop(t + 0.5); }
  impact(strength) { if (!this.ctx) return; const c = this.ctx, t = c.currentTime; const s = c.createBufferSource(); s.buffer = this.noise; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500 + strength * 1500; const g = c.createGain(); g.gain.setValueAtTime(Math.min(1, strength), t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35); s.connect(lp); lp.connect(g); g.connect(this.bus.fx); g.connect(this.revSend); s.start(t); s.stop(t + 0.4);
    const o = c.createOscillator(); o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.2); const og = c.createGain(); og.gain.setValueAtTime(Math.min(0.8, strength), t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.25); o.connect(og); og.connect(this.bus.fx); o.start(t); o.stop(t + 0.3); }
  beep(f = 880, d = 0.15, bus = 'fx') { if (!this.ctx) return; const c = this.ctx, t = c.currentTime; const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g); g.connect(this.bus[bus]); o.start(t); o.stop(t + d + 0.02); }
  // rain ambience
  setRain(on) { if (!this.ctx) return; if (!this.rain) { const n = this.noiseSrc(); const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500; const g = this.ctx.createGain(); g.gain.value = 0; n.connect(hp); hp.connect(g); g.connect(this.bus.fx); this.rain = g; } this.rain.gain.setTargetAtTime(on ? 0.08 : 0, this.ctx.currentTime, 0.5); }
  // ---- generative music (menu / cruise) --------------------------------------------------------------
  startMusic() {
    if (!this.ctx || this.musicOn) return; this.musicOn = true; const c = this.ctx; const bus = this.bus.music;
    const bpm = 96, beat = 60 / bpm; let next = c.currentTime + 0.1, step = 0;
    const chords = [[45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59], [40, 47, 52, 55]];
    const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
    const sched = () => {
      if (!this.musicOn) return;
      while (next < c.currentTime + 0.3) {
        const bar = Math.floor(step / 16) % 4, s16 = step % 16, ch = chords[bar];
        if (s16 % 4 === 0) { const o = c.createOscillator(), g = c.createGain(); o.frequency.setValueAtTime(110, next); o.frequency.exponentialRampToValueAtTime(40, next + 0.12); g.gain.setValueAtTime(0.5, next); g.gain.exponentialRampToValueAtTime(0.0001, next + 0.25); o.connect(g); g.connect(bus); o.start(next); o.stop(next + 0.3); }
        if (s16 === 4 || s16 === 12) { const s = c.createBufferSource(); s.buffer = this.noise; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; const g = c.createGain(); g.gain.setValueAtTime(0.18, next); g.gain.exponentialRampToValueAtTime(0.0001, next + 0.12); s.connect(f); f.connect(g); g.connect(bus); s.start(next, Math.random()); s.stop(next + 0.15); }
        if (s16 % 2 === 1) { const s = c.createBufferSource(); s.buffer = this.noise; const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000; const g = c.createGain(); g.gain.setValueAtTime(0.05, next); g.gain.exponentialRampToValueAtTime(0.0001, next + 0.04); s.connect(f); f.connect(g); g.connect(bus); s.start(next, Math.random()); s.stop(next + 0.05); }
        if (s16 % 2 === 0) { const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.value = mtof(ch[0] - 12 + (s16 % 8 === 6 ? 12 : 0)); f.type = 'lowpass'; f.frequency.value = 500; g.gain.setValueAtTime(0.12, next); g.gain.exponentialRampToValueAtTime(0.0001, next + beat * 0.45); o.connect(f); f.connect(g); g.connect(bus); o.start(next); o.stop(next + beat * 0.5); }
        if (s16 === 0) for (const m of ch.slice(1)) { const o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.value = mtof(m + 12); g.gain.setValueAtTime(0.0001, next); g.gain.linearRampToValueAtTime(0.03, next + 0.4); g.gain.linearRampToValueAtTime(0.0001, next + beat * 15); o.connect(g); g.connect(bus); o.start(next); o.stop(next + beat * 16); }
        next += beat / 4; step++;
      }
      this.musicTimer = setTimeout(sched, 100);
    };
    sched();
  }
  stopMusic() { this.musicOn = false; clearTimeout(this.musicTimer); }
}
