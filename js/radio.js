// CUZZY RACING in-game radio: three made-up stations + Off, all music generated live in code (WebAudio).
// No samples, no recordings, no vocals: every drum is synthesised into a tiny buffer at start-up, every instrument
// is oscillators + filters, and every song comes from a seeded pattern generator (sections, chords, bass lines,
// riffs, melodies), so each station plays an endless run of original tracks.
//   0121 GRIME FM  – 140 bpm grime: sliding square/saw bass, eskibeat square-wave stabs, skippy hats, snare on 3
//   B-TOWN R&B     – 70-90 bpm smooth R&B: Rhodes (FM) chords, sub bass, finger snaps, lush pads
//   DISCO 80 GOLD  – 118-124 bpm four-on-the-floor: octave bass, strings, claps, open hats, syndrum fills
// Low CPU: notes are scheduled ~0.4 s ahead from a 50 ms timer (never per frame), drums are one buffer source each,
// shared per-station effect chains, and a voice cap that drops pads/leads first when a phone is busy.
// Live controls: HUD/menu button #radio-btn, key M, gamepad Back/Select (button 8) or D-pad up (12).
import { standardPad } from './wheel.js';

// ------------------------------------------------------------------------------------------------- helpers
export function rngFrom(seed) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const IS_PHONE = typeof navigator !== 'undefined' && (/iPhone|iPad|Android|Mobile/i.test(navigator.userAgent || '') || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform || '')));
const QUAL = { maj7: [0, 4, 7, 11], maj9: [0, 4, 7, 11, 14], min7: [0, 3, 7, 10], min9: [0, 3, 7, 10, 14], min11: [0, 3, 7, 10, 14, 17], dom7: [0, 4, 7, 10], dom9: [0, 4, 7, 10, 14], dom13: [0, 4, 10, 14, 21], sus9: [0, 5, 7, 10, 14], maj: [0, 4, 7], min: [0, 3, 7], sus: [0, 5, 7], add9: [0, 4, 7, 14] };
// place chord tones close to a centre note (simple voice leading)
function voice(root, q, centre, max = 5) { const out = []; for (const iv of QUAL[q]) { let n = root + iv; while (n > centre + 9) n -= 12; while (n < centre - 4) n += 12; if (!out.includes(n)) out.push(n); } return out.sort((a, b) => a - b).slice(0, max); }

// ------------------------------------------------------------------------------------------------- drum synthesis (plain JS into AudioBuffers, once per context)
function biquad(type, f, q, sr) { // RBJ cookbook coefficients
  const w = 2 * Math.PI * f / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q); let b0, b1, b2, a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
  if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; } else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; } else { b0 = al; b1 = 0; b2 = -al; }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
function filt(x, c) { let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < x.length; i++) { const y = c[0] * x[i] + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y; } return x; }
function drumKit(ctx) {
  const sr = ctx.sampleRate, R = rngFrom(12345), N = () => R() * 2 - 1;
  const mk = (sec, fn) => { const n = Math.ceil(sec * sr), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0); fn(d, n); let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(d[i])); if (pk > 0) for (let i = 0; i < n; i++) d[i] /= pk; return b; };
  const kick = (f0, f1, pd, dec, click, drive) => (d, n) => { let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr; const f = f1 + (f0 - f1) * Math.exp(-t / pd); ph += 2 * Math.PI * f / sr; let v = Math.sin(ph) * Math.exp(-t / dec); if (t < 0.004) v += N() * click * (1 - t / 0.004); d[i] = Math.tanh(v * drive); } };
  const noise = (n) => { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = N(); return x; };
  const metal = (n, hp, dec) => { const fr = [263, 400, 421, 474, 587, 845].map(f => f * 1.9); const x = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / sr; let v = 0; for (const f of fr) v += (Math.sin(2 * Math.PI * f * t) > 0 ? 1 : -1); x[i] = v / 6 * 0.7 + N() * 0.5; } filt(x, biquad('hp', hp, 0.7, sr)); for (let i = 0; i < n; i++) x[i] *= Math.exp(-i / sr / dec); return x; };
  const K = {};
  K.kickGrime = mk(0.55, kick(190, 46, 0.035, 0.22, 0.6, 1.8));
  K.kickRnb = mk(0.7, kick(120, 42, 0.05, 0.3, 0.25, 1.2));
  K.kickDisco = mk(0.4, kick(160, 52, 0.028, 0.14, 0.9, 1.6));
  K.snare = mk(0.35, (d, n) => { const x = filt(noise(n), biquad('hp', 900, 0.7, sr)); for (let i = 0; i < n; i++) { const t = i / sr; d[i] = x[i] * Math.exp(-t / 0.09) * 0.8 + (Math.sin(2 * Math.PI * 190 * t) + 0.6 * Math.sin(2 * Math.PI * 330 * t)) * Math.exp(-t / 0.045) * 0.7; } });
  K.snareGrime = mk(0.3, (d, n) => { const x = filt(noise(n), biquad('bp', 2600, 0.8, sr)); for (let i = 0; i < n; i++) { const t = i / sr; d[i] = x[i] * Math.exp(-t / 0.07) + Math.sin(2 * Math.PI * (230 - 60 * t) * t) * Math.exp(-t / 0.03) * 0.8; } });
  K.clap = mk(0.4, (d, n) => { const x = filt(noise(n), biquad('bp', 1250, 1.1, sr)); for (let i = 0; i < n; i++) { const t = i / sr; let e = 0; for (const o of [0, 0.011, 0.022]) if (t >= o) e = Math.max(e, Math.exp(-(t - o) / 0.006)); if (t >= 0.031) e = Math.max(e, Math.exp(-(t - 0.031) / 0.1)); d[i] = x[i] * e; } });
  K.snap = mk(0.12, (d, n) => { const x = filt(noise(n), biquad('bp', 2900, 2.2, sr)); for (let i = 0; i < n; i++) { const t = i / sr; d[i] = x[i] * Math.exp(-t / 0.018) + Math.sin(2 * Math.PI * 1900 * t) * Math.exp(-t / 0.006) * 0.4; } });
  K.hatC = mk(0.08, (d, n) => d.set(metal(n, 7000, 0.022)));
  K.hatO = mk(0.45, (d, n) => d.set(metal(n, 6500, 0.16)));
  K.shaker = mk(0.1, (d, n) => { const x = filt(noise(n), biquad('bp', 6500, 1.2, sr)); for (let i = 0; i < n; i++) { const t = i / sr; d[i] = x[i] * (t < 0.012 ? t / 0.012 : Math.exp(-(t - 0.012) / 0.03)); } });
  K.rim = mk(0.06, (d, n) => { for (let i = 0; i < n; i++) { const t = i / sr; d[i] = (Math.sin(2 * Math.PI * 1700 * t) * 0.6 + Math.sin(2 * Math.PI * 820 * t)) * Math.exp(-t / 0.011); } });
  K.crash = mk(1.6, (d, n) => d.set(metal(n, 4200, 0.55)));
  K.syn = mk(0.5, (d, n) => { let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr; ph += 2 * Math.PI * (330 * Math.exp(-t / 0.18) + 70) / sr; d[i] = Math.sin(ph) * Math.exp(-t / 0.2); } });
  K.tom = mk(0.4, (d, n) => { let ph = 0; for (let i = 0; i < n; i++) { const t = i / sr; ph += 2 * Math.PI * (150 + 60 * Math.exp(-t / 0.05)) / sr; d[i] = Math.sin(ph) * Math.exp(-t / 0.16) + N() * 0.1 * Math.exp(-t / 0.01); } });
  K.noise = mk(2, (d, n) => { for (let i = 0; i < n; i++) d[i] = N(); });
  K.vinyl = mk(3, (d, n) => { for (let i = 0; i < n; i++) d[i] = (R() < 0.0009 ? N() * 0.9 : 0) + N() * 0.012; });
  return K;
}
const KITS = new WeakMap();
const kitFor = ctx => { let k = KITS.get(ctx); if (!k) { k = drumKit(ctx); KITS.set(ctx, k); } return k; };

// ------------------------------------------------------------------------------------------------- made-up titles
const pick = (r, a) => a[Math.floor(r() * a.length)];
const TITLES = {
  grime: { a: ['Cold', 'Ice', 'Frozen', 'Eskimo', 'Night Bus', 'Digbeth', 'Five Ways', 'Ringway', 'Concrete', 'Pressure', 'Gas Street', 'Bullring', 'Snowfall', 'Midlands', 'Kerbside', 'Underpass', 'Floodlight', 'Tarmac', 'Northfield', 'Blue Light'],
    b: ['Riddim', 'Warning', 'Dubplate', 'Pressure', 'Business', 'Levels', 'Anthem', 'Skeng Riddim', 'Frequency', 'Tempo', 'VIP', 'Pull Up', 'Energy', 'Mission', 'War Dub', 'Code'],
    who: ['MC Kerbside', 'Lil Tarmac', 'DJ Five Ways', 'Big Ringroad', 'Kid Queensway', 'Frostbyte B21', 'Shotta Nova', 'Eski Dave', 'Nine-Nine Nines', 'Tunnel Vision Crew', 'P-Diesel', 'MC Underpass'] },
  rnb: { a: ['Midnight', 'Velvet', 'Slow', 'Honey', 'Late Night', 'Rainy', 'Golden', 'Satin', 'Moonlit', 'Summer', 'Candle', 'Lavender', 'Soft', 'Neon'],
    b: ['on Broad Street', 'Rain', 'Lane', 'Love', 'Drive', 'Letters', 'Ride Home', 'Sunday', 'Glow', 'Promises', 'Motion', 'Skyline', 'Feelings', 'Mailbox Nights'],
    who: ['Jade Moseley', 'The Harborne Sisters', 'Kez Velvet', 'Amari Solihull', 'Rhodes Scholar', 'Luna Edgbaston', 'Marcus Lee Smooth', 'Silk Canal', 'Nia Kingsheath', 'The Late Lanes'] },
  disco: { a: ['Mirrorball', 'Boogie', 'Starlight', 'Roller', 'Glitter', 'Saturday', 'Neon', 'Silver', 'Hustle', 'Funky', 'Diamond', 'Groove', 'Electric', 'Moonboot'],
    b: ['Motorway', 'on the Queensway', 'Fever', 'Nights', 'Machine', 'Heat', 'Express', 'Party', 'Dancer', 'Lights', 'Paradise', 'Rink', 'Connection', 'Love Train'],
    who: ['Glitterbox Orchestra', 'The Digbeth Dancers', 'Silver Satin', 'Rollerdisco 5000', 'Queensway Soul Band', 'Mirrorball Mike', 'Starlight Express Co.', 'The Brum Boogie Band', 'Donna Deritend', 'Sparkle Motor'] },
};
function title(kind, r) { const T = TITLES[kind]; let t = pick(r, T.a) + ' ' + pick(r, T.b); if (kind === 'grime' && r() < 0.25) t += ' (VIP)'; if (kind === 'disco' && r() < 0.25) t += ' (12" Mix)'; return { title: t, artist: pick(r, T.who) }; }

// ------------------------------------------------------------------------------------------------- song form helpers
function form(r, parts) { const out = []; for (const [name, bars, m] of parts) out.push({ name, bars, m }); return out; }
// melody over a phrase of `bars` bars: [{st (16th step in phrase), len, n (midi)}]
function melody(r, bars, scale, root, lo, hi, dens, chordAt) {
  const ev = []; let deg = Math.floor(scale.length * 1.5 + r() * 3); const at = d => root + 12 * Math.floor(d / scale.length) + scale[((d % scale.length) + scale.length) % scale.length];
  const half = Math.max(1, bars / 2);
  for (let b = 0; b < half; b++) for (let s = 0; s < 16; s++) {
    const strong = s % 4 === 0; if (r() > (strong ? dens * 1.4 : s % 2 ? dens * 0.45 : dens * 0.8)) continue;
    deg += Math.round((r() - 0.5) * 4); let n = at(deg); while (n < lo) { deg += scale.length; n = at(deg); } while (n > hi) { deg -= scale.length; n = at(deg); }
    if (strong && chordAt) { const ch = chordAt(b); const best = ch.reduce((a, c) => { const cc = c + 12 * Math.round((n - c) / 12); return Math.abs(cc - n) < Math.abs(a - n) ? cc : a; }, n + 99); if (Math.abs(best - n) <= 2) n = best; }
    ev.push({ st: b * 16 + s, len: 1, n });
  }
  for (let i = 0; i < ev.length; i++) ev[i].len = Math.max(1, Math.min(6, (ev[i + 1]?.st ?? half * 16) - ev[i].st));
  // answer phrase: repeat with the last few notes changed
  const B = ev.map(e => ({ ...e, st: e.st + half * 16 })); const k = Math.floor(B.length * 0.6); for (let i = k; i < B.length; i++) { const d = pick(r, [-3, -2, 2, 3, 5, -5]); B[i].n = clamp(B[i].n + d, lo, hi); }
  return bars > 1 ? ev.concat(B) : ev;
}
const byStep = (list, len) => { const m = new Map(); for (const e of list) { const k = e.st % len; (m.get(k) || m.set(k, []).get(k)).push(e); } return m; };

// ================================================================================================= stations
export const STATIONS = [
  { id: 'grime', name: '0121 GRIME FM', freq: '101.21', gain: 0.36, gen: genGrime, step: stepGrime },
  { id: 'rnb', name: 'B-TOWN R&B', freq: '94.6', gain: 0.36, gen: genRnb, step: stepRnb },
  { id: 'disco', name: 'DISCO 80 GOLD', freq: '88.0', gain: 0.36, gen: genDisco, step: stepDisco },
];

// ---------- 0121 GRIME FM -------------------------------------------------------------------------
function genGrime(r) {
  const T = { bpm: 138 + Math.floor(r() * 5), swing: 0, root: 28 + Math.floor(r() * 7) };
  const scale = r() < 0.55 ? [0, 1, 3, 5, 7, 8, 10] : [0, 2, 3, 5, 7, 8, 10]; T.scale = scale;
  T.bassWave = r() < 0.5 ? 'square' : 'sawtooth'; T.stabWave = r() < 0.7 ? 'square' : 'triangle'; T.bassCut = 380 + r() * 500;
  // 2-bar bass riff with slides
  const degs = [0, 0, 0, 3, 5, 7, -2, 12, 1, 8];
  const hits = [0]; for (const s of [3, 6, 7, 10, 11, 14, 16, 19, 22, 24, 26, 27, 30]) if (r() < 0.32) hits.push(s);
  T.bass = hits.map((st, i) => { const d = pick(r, degs); return { st, n: T.root + (i === 0 || !scale.includes(((d % 12) + 12) % 12) ? 0 : d), slide: i > 0 && r() < 0.4, drop: r() < 0.18 }; });
  for (let i = 0; i < T.bass.length; i++) T.bass[i].len = ((T.bass[i + 1]?.st ?? 32) - T.bass[i].st);
  T.bassB = T.bass.map(e => e.st >= 16 && r() < 0.5 ? { ...e, n: T.root + pick(r, [3, 5, 7, -2, 10]) } : e);
  // eskibeat stab riff (2 bars) + variant
  const stab = []; const sc = scale.map(x => x + T.root + 36); for (let s = 0; s < 32; s++) if ((s % 4 === 0 && r() < 0.45) || (s % 4 === 3 && r() < 0.3) || r() < 0.08) stab.push({ st: s, n: pick(r, sc) + (r() < 0.2 ? 12 : 0), two: r() < 0.3, zap: r() < 0.2 });
  if (!stab.length) stab.push({ st: 0, n: sc[0], two: true });
  T.stab = stab; T.stabB = stab.map(e => ({ ...e, n: e.n + (r() < 0.4 ? pick(r, [-2, 2, 3, -5]) : 0) }));
  T.lead = byStep(melody(r, 4, scale, T.root + 48, T.root + 45, T.root + 64, 0.32), 64); T.leadWave = pick(r, ['square', 'triangle', 'sawtooth']);
  // drums
  T.kick = pick(r, [[0, 10], [0, 7, 10], [0, 11], [0, 3, 10], [0, 6, 11], [0, 10, 13]]); T.kick2 = r() < 0.5 ? T.kick : pick(r, [[0, 10, 14], [0, 3, 6, 10], [0, 7]]);
  T.hatRoll = Array.from({ length: 16 }, (_, s) => r() < 0.14 ? (r() < 0.5 ? 3 : 2) : 0); T.hatExtra = Array.from({ length: 16 }, (_, s) => s % 2 === 1 && r() < 0.3);
  T.perc = Array.from({ length: 32 }, (_, s) => r() < 0.07);
  const v = r() < 0.5 ? 16 : 8;
  T.sec = form(r, [['intro', 8, { stab: 1, hat: 1, filt: 1 }], ['verse', 16, { kick: 1, snare: 1, hat: 1, bass: 1, stab: 0.5, perc: 1 }], ['hook', 16, { kick: 1, snare: 1, clap: 1, hat: 1, bass: 1, stab: 1, lead: 1, perc: 1 }],
    ['verse', v, { kick: 1, snare: 1, hat: 1, bass: 1, stab: 0.5, perc: 1, alt: 1 }], ['hook', 16, { kick: 1, snare: 1, clap: 1, hat: 1, bass: 1, stab: 1, lead: 1, perc: 1 }], ['break', 8, { bass: 1, stab: 1, filt: 1 }],
    ['hook', 16, { kick: 1, snare: 1, clap: 1, hat: 1, bass: 1, stab: 1, lead: 1, perc: 1, alt: 1 }], ['outro', 8, { stab: 1, hat: 1, kick: 0.5 }]]);
  return T;
}
function stepGrime(P, T, c) {
  const { s, t, m, bis, last, sd } = c; const s32 = (bis % 2) * 16 + s; const r = P.r;
  if (m.kick && (m.kick === 1 || bis % 2 === 0) && ((bis % 2 ? T.kick2 : T.kick).includes(s))) P.drum('kickGrime', t, 1);
  if (m.snare && s === 8) P.drum('snareGrime', t, 0.9);
  if (m.clap && s === 8) P.drum('clap', t + 0.004, 0.5, 'perc');
  if (m.snare && last && s >= 12 && r() < 0.7) P.drum('snareGrime', t, 0.35 + (s - 12) * 0.12);
  if (m.hat) { if (s % 2 === 0) P.drum('hatC', t, s % 4 === 0 ? 0.55 : 0.4, 'hat'); else if (T.hatExtra[s]) P.drum('hatC', t, 0.25, 'hat');
    const n = T.hatRoll[s]; if (n && !m.filt) for (let i = 1; i < n + 1; i++) P.drum('hatC', t + i * sd * 2 / (n + 1), 0.22 + 0.06 * i, 'hat'); if (s === 14 && bis % 4 === 3) P.drum('hatO', t, 0.3, 'hat'); }
  if (m.perc && T.perc[s32]) P.drum('rim', t, 0.35, 'perc');
  if (bis === 0 && s === 0 && (c.sec.name === 'hook')) P.drum('crash', t, 0.4, 'hat');
  if (c.nextName === 'hook' && last && s === 0) P.riser(t, sd * 16, 'grime');
  if (m.bass) for (const e of (m.alt ? T.bassB : T.bass)) if (e.st === s32) {
    const dur = e.len * sd * 0.92; const prev = P.lastBass ?? e.n; P.lastBass = e.n;
    P.syn({ t, dur, n: e.n, wave: T.bassWave, vol: 0.34, a: 0.004, r: 0.05, cut: T.bassCut * (m.filt ? 0.6 : 1), env: 900, dec: 0.18, q: 3, from: e.slide ? prev : null, glide: 0.09, dropTo: e.drop ? e.n - 12 : null, ch: 'bass', pri: 0, sub: true });
  }
  if (m.stab && (m.stab === 1 || bis % 4 < 2)) for (const e of (m.alt || bis % 8 >= 4 ? T.stabB : T.stab)) if (e.st === s32) {
    P.syn({ t, dur: sd * 1.3, n: e.n, wave: T.stabWave, vol: 0.12, a: 0.002, r: 0.06, cut: m.filt ? 1400 : 3800, env: 2500, dec: 0.08, q: 2, ch: 'stab', pri: 1, dropTo: e.zap ? e.n - 1 : null });
    if (e.two) P.syn({ t, dur: sd * 1.3, n: e.n - 5, wave: T.stabWave, vol: 0.07, a: 0.002, r: 0.06, cut: 3000, dec: 0.08, ch: 'stab', pri: 2 });
  }
  if (m.lead) { const ev = T.lead.get((bis % 4) * 16 + s); if (ev) for (const e of ev) P.syn({ t, dur: e.len * sd * 0.8, n: e.n, wave: T.leadWave, vol: 0.07, a: 0.01, r: 0.12, cut: 2600, dec: 0.3, ch: 'lead', pri: 2, vib: 5 }); }
}

// ---------- B-TOWN R&B ---------------------------------------------------------------------------
const RNB_PROGS = [[[0, 'maj9'], [9, 'min9'], [2, 'min9'], [7, 'dom13']], [[5, 'maj9'], [4, 'min7'], [2, 'min9'], [0, 'maj9']], [[2, 'min9'], [7, 'dom9'], [0, 'maj9'], [0, 'add9']],
  [[0, 'min9'], [5, 'min9'], [8, 'maj9'], [7, 'dom9']], [[0, 'min11'], [10, 'dom9'], [8, 'maj9'], [7, 'min7']], [[5, 'maj9'], [7, 'dom13'], [4, 'min7'], [9, 'min9']], [[0, 'maj9'], [5, 'maj9'], [0, 'maj9'], [7, 'sus9']]];
function genRnb(r) {
  const T = { bpm: 70 + Math.floor(r() * 21), swing: 0.1 + r() * 0.12, key: 50 + Math.floor(r() * 8) };
  const prog = pick(r, RNB_PROGS); T.prog = prog.map(([o, q]) => ({ root: T.key + o, q, v: voice(T.key + o, q, T.key + 7, 5) }));
  T.prog2 = r() < 0.5 ? T.prog : pick(r, RNB_PROGS).map(([o, q]) => ({ root: T.key + o, q, v: voice(T.key + o, q, T.key + 7, 5) }));
  T.rh = pick(r, [[0, 6, 10], [0, 3, 8, 11], [0, 10], [0, 7, 12], [0, 6, 8, 14]]); T.rhV = T.rh.map((s, i) => i === 0 ? 0.9 : 0.5 + r() * 0.3);
  T.kick = pick(r, [[0, 10], [0, 3, 10], [0, 7, 11], [0, 9, 10], [0, 6, 10]]); T.kick2 = pick(r, [T.kick, [0, 3, 7, 10], [0, 10, 14]]);
  T.hat16 = r() < 0.5; T.rollAt = Array.from({ length: 16 }, () => r() < 0.1);
  T.bassPass = r() < 0.6; T.bassRh = pick(r, [[0], [0, 10], [0, 6, 10], [0, 3, 11]]);
  const pent = r() < 0.5 ? [0, 2, 4, 7, 9] : [0, 3, 5, 7, 10];
  T.lead = byStep(melody(r, 4, pent, T.key + 12, T.key + 7, T.key + 24, 0.22, b => T.prog[b % 4].v), 64);
  T.fill = byStep(melody(r, 2, pent, T.key + 12, T.key + 10, T.key + 26, 0.3), 32);
  T.sec = form(r, [['intro', 4, { keys: 1, vinyl: 1 }], ['verse', 8, { keys: 1, kick: 1, snap: 1, hat: 1, bass: 1 }], ['hook', 8, { keys: 1, kick: 1, snap: 1, clap: 1, hat: 1, bass: 1, pad: 1, lead: 1, shaker: 1 }],
    ['verse', 8, { keys: 1, kick: 1, snap: 1, hat: 1, bass: 1, fill: 1 }], ['hook', 8, { keys: 1, kick: 1, snap: 1, clap: 1, hat: 1, bass: 1, pad: 1, lead: 1, shaker: 1 }],
    ['bridge', 4, { keys: 1, pad: 1, bass: 1, alt: 1, fill: 1 }], ['hook', 8, { keys: 1, kick: 1, snap: 1, clap: 1, hat: 1, bass: 1, pad: 1, lead: 1, shaker: 1 }], ['outro', 4, { keys: 1, pad: 1, vinyl: 1 }]]);
  return T;
}
function stepRnb(P, T, c) {
  const { s, t, m, bis, last, sd, bar } = c; const r = P.r; const ch = (m.alt ? T.prog2 : T.prog)[bis % 4]; const nx = (m.alt ? T.prog2 : T.prog)[(bis + 1) % 4];
  if (m.vinyl && s === 0 && bis % 2 === 0) P.drum('vinyl', t, 0.5, 'perc');
  if (m.kick && (bis % 2 ? T.kick2 : T.kick).includes(s)) P.drum('kickRnb', t, s === 0 ? 1 : 0.8);
  if (m.snap && (s === 4 || s === 12)) P.drum('snap', t, 0.8, 'perc');
  if (m.clap && s === 12) P.drum('clap', t + 0.01, 0.35, 'perc');
  if (m.snap && last && s === 15) P.drum('snap', t, 0.4, 'perc');
  if (m.hat) { if ((T.hat16 || s % 2 === 0)) P.drum('hatC', t, (s % 4 === 0 ? 0.35 : 0.2) * (0.8 + r() * 0.3), 'hat');
    if (T.rollAt[s] && bis % 2 === 1) for (let i = 1; i < 3; i++) P.drum('hatC', t + i * sd / 3, 0.15, 'hat'); }
  if (m.shaker && s % 2 === 1) P.drum('shaker', t, 0.25, 'hat');
  if (m.keys) { const i = T.rh.indexOf(s); if (i >= 0) { const nextS = T.rh[i + 1] ?? 16; const dur = (nextS - s) * sd + 0.05; for (const n of ch.v) P.rhodes(t + r() * 0.012, dur, n, T.rhV[i] * 0.16); } }
  if (m.fill && !m.lead) { const ev = T.fill.get((bis % 2) * 16 + s); if (ev && bis % 4 >= 2) for (const e of ev) P.rhodes(t, e.len * sd, e.n, 0.09); }
  if (m.pad && s === 0) for (const n of ch.v.slice(-4)) P.syn({ t, dur: sd * 16, n: n + 12, wave: 'sawtooth', vol: 0.03, a: 0.7, r: 0.8, cut: 1500, dec: 1, q: 0.5, ch: 'pad', pri: 2 });
  if (m.bass) { if (T.bassRh.includes(s)) P.syn({ t, dur: (s === 0 ? 10 : 4) * sd, n: ch.root - 24, wave: 'sine', vol: 0.5, a: 0.01, r: 0.15, ch: 'bass', pri: 0, sub: true, from: s === 0 ? P.lastBass : null, glide: 0.06 });
    if (T.bassPass && s === 14 && bis % 2 === 1) P.syn({ t, dur: 2 * sd, n: nx.root - 24 + pick(r, [-1, 2, -2]), wave: 'sine', vol: 0.4, a: 0.01, r: 0.1, ch: 'bass', pri: 0, sub: true });
    if (s === 0) P.lastBass = ch.root - 24; }
  if (m.lead) { const ev = T.lead.get((bis % 4) * 16 + s); if (ev) for (const e of ev) P.syn({ t, dur: e.len * sd * 0.95, n: e.n, wave: 'triangle', vol: 0.09, a: 0.03, r: 0.25, cut: 2400, dec: 0.5, ch: 'lead', pri: 2, vib: 6, from: P.lastLead, glide: 0.05 }), P.lastLead = e.n; }
  if (last && s === 8 && c.nextName !== 'outro') P.riser(t, sd * 8, 'soft');
}

// ---------- DISCO 80 GOLD ------------------------------------------------------------------------
const DISCO_PROGS = [[[0, 'min7'], [5, 'min7'], [10, 'dom7'], [3, 'maj7']], [[0, 'min7'], [0, 'min7'], [5, 'min7'], [7, 'min7']], [[0, 'min9'], [10, 'maj'], [8, 'maj7'], [7, 'dom7']],
  [[0, 'maj7'], [9, 'min7'], [2, 'min7'], [7, 'dom7']], [[0, 'maj'], [5, 'maj'], [2, 'min7'], [7, 'sus']], [[0, 'min7'], [3, 'maj7'], [5, 'min7'], [10, 'dom9']]];
function genDisco(r) {
  const T = { bpm: 118 + Math.floor(r() * 7), swing: r() < 0.3 ? 0.05 : 0, key: 45 + Math.floor(r() * 7) };
  const minor = r() < 0.65; const pr = pick(r, DISCO_PROGS.filter((p, i) => minor ? i < 3 || i === 5 : i >= 3)); T.per = r() < 0.5 ? 1 : 2; // bars per chord
  T.prog = pr.map(([o, q]) => ({ root: T.key + o, q, v: voice(T.key + o, q, T.key + 12, 4) })); T.bassRoot = T.key - 24;
  T.bassWave = r() < 0.5 ? 'sawtooth' : 'square'; T.oct = pick(r, [[0, 12, 0, 12, 0, 12, 0, 12], [0, 12, 0, 12, 0, 12, 7, 12], [0, 12, 0, 12, 10, 12, 7, 12]]);
  T.pick16 = Array.from({ length: 16 }, (_, s) => s % 2 === 1 && r() < 0.25);
  T.gtr = pick(r, [[2, 6, 10, 14], [2, 3, 6, 10, 11, 14], [1, 2, 5, 6, 9, 10, 13, 14], [4, 12, 14]]);
  T.stab = pick(r, [[14], [6, 14], [3, 10], [0, 7]]); T.stabBar = r() < 0.5 ? 1 : 3;
  const scale = minor ? [0, 2, 3, 5, 7, 9, 10] : [0, 2, 4, 5, 7, 9, 11];
  T.lead = byStep(melody(r, 4, scale, T.key + 12, T.key + 12, T.key + 31, 0.35, b => T.prog[Math.floor(b / T.per) % 4].v), 64); T.leadWave = pick(r, ['square', 'sawtooth']);
  T.run = scale.map(x => T.key + 12 + x).concat(scale.map(x => T.key + 24 + x));
  T.sec = form(r, [['intro', 8, { kick: 1, hat: 1, bass: 1, filt: 1 }], ['verse', 16, { kick: 1, clap: 1, hat: 1, ohat: 1, bass: 1, gtr: 1, str: 1 }], ['hook', 16, { kick: 1, clap: 1, hat: 1, ohat: 1, bass: 1, gtr: 1, str: 1, stab: 1, lead: 1, tamb: 1 }],
    ['verse', 8, { kick: 1, clap: 1, hat: 1, ohat: 1, bass: 1, gtr: 1, str: 1 }], ['hook', 16, { kick: 1, clap: 1, hat: 1, ohat: 1, bass: 1, gtr: 1, str: 1, stab: 1, lead: 1, tamb: 1 }], ['break', 8, { clap: 1, bass: 1, str: 1, gtr: 1 }],
    ['hook', 16, { kick: 1, clap: 1, hat: 1, ohat: 1, bass: 1, gtr: 1, str: 1, stab: 1, lead: 1, tamb: 1 }], ['outro', 8, { kick: 1, hat: 1, ohat: 1, bass: 1, str: 1 }]]);
  return T;
}
function stepDisco(P, T, c) {
  const { s, t, m, bis, last, sd } = c; const r = P.r; const ci = Math.floor(bis / T.per) % 4; const ch = T.prog[ci];
  if (m.kick && s % 4 === 0) P.drum('kickDisco', t, 1);
  if (m.clap && (s === 4 || s === 12)) { P.drum('clap', t, 0.7, 'perc'); P.drum('snare', t, 0.35); }
  if (m.hat && s % 2 === 1 && !m.ohat) P.drum('hatC', t, 0.3, 'hat');
  if (m.hat && s % 2 === 0) P.drum('hatC', t, 0.18, 'hat');
  if (m.ohat && s % 4 === 2) P.drum('hatO', t, 0.32, 'hat');
  if (m.tamb && s % 2 === 1) P.drum('shaker', t, 0.3, 'hat');
  if (bis === 0 && s === 0 && c.sec.name !== 'intro') P.drum('crash', t, 0.45, 'hat');
  if (last && s >= 12 && c.nextName !== 'outro') { if (r() < 0.8) P.drum('syn', t, 0.55, 'perc', 1 + (15 - s) * 0.12); }
  if (m.bass) { const k = s >> 1; if (s % 2 === 0) P.syn({ t, dur: sd * 1.5, n: T.bassRoot + (ch.root - T.key) + T.oct[k], wave: T.bassWave, vol: 0.3, a: 0.003, r: 0.04, cut: m.filt ? 500 : 700, env: 1400, dec: 0.09, q: 4, ch: 'bass', pri: 0, sub: true });
    else if (T.pick16[s] && !m.filt) P.syn({ t, dur: sd * 0.7, n: T.bassRoot + (ch.root - T.key) + 12, wave: T.bassWave, vol: 0.2, a: 0.003, r: 0.03, cut: 900, env: 900, dec: 0.06, q: 3, ch: 'bass', pri: 1 }); }
  if (m.gtr && T.gtr.includes(s)) { const n = ch.v[(s >> 1) % ch.v.length] + 12; P.syn({ t, dur: 0.035, n, wave: 'square', vol: 0.05, a: 0.001, r: 0.02, cut: 2600, dec: 0.02, q: 6, ch: 'gtr', pri: 1 }); }
  if (m.str && s === 0 && bis % T.per === 0) for (const n of ch.v) P.syn({ t, dur: sd * 16 * T.per - 0.05, n: n + 12, wave: 'sawtooth', vol: 0.035, a: 0.25, r: 0.35, cut: 3200, dec: 1, q: 0.5, ch: 'str', pri: 1 });
  if (m.str && last && c.nextName === 'hook' && s >= 8) { const n = T.run[(s - 8) * 2 % T.run.length]; P.syn({ t, dur: sd * 0.9, n: n + 12, wave: 'sawtooth', vol: 0.05, a: 0.01, r: 0.06, cut: 4000, dec: 0.2, ch: 'str', pri: 1 }); }
  if (m.stab && bis % 4 === T.stabBar && T.stab.includes(s)) for (const n of ch.v.slice(0, 3)) P.syn({ t, dur: sd * 1.6, n: n + 12, wave: 'sawtooth', vol: 0.06, a: 0.005, r: 0.08, cut: 1800, env: 3000, dec: 0.1, q: 1, ch: 'stab', pri: 1 });
  if (m.lead) { const ev = T.lead.get((bis % 4) * 16 + s); if (ev) for (const e of ev) P.syn({ t, dur: e.len * sd * 0.85, n: e.n, wave: T.leadWave, vol: 0.055, a: 0.01, r: 0.1, cut: 3000, env: 1500, dec: 0.2, q: 2, ch: 'lead', pri: 2, vib: 5.5 }); }
  if (c.nextName === 'hook' && last && s === 0) P.riser(t, sd * 16, 'disco');
}

// ================================================================================================= station player
// Plays one station into `dest`. Works on a live AudioContext (scheduleUntil called from a timer) or an
// OfflineAudioContext (scheduleUntil(duration) once, then startRendering).
export class StationPlayer {
  constructor(ctx, dest, st, seed, t0 = ctx.currentTime + 0.05, opts = {}) {
    this.ctx = ctx; this.st = st; this.seed = seed >>> 0; this.K = kitFor(ctx); this.cap = opts.cap || (IS_PHONE ? 26 : 44); this.live = []; this.skipped = 0; this.peak = 0; this.onTrack = opts.onTrack;
    const c = ctx; this.out = c.createGain(); this.out.gain.value = st.gain; this.out.connect(dest);
    // shared effects: tempo delay + short room reverb
    // cheap stereo room: 4 damped feedback combs (a ConvolverNode cost ~2x more CPU in profiling)
    this.revIn = c.createGain(); this.revIn.gain.value = 0.22; this.revIn.channelCount = 1; this.revIn.channelCountMode = 'explicit'; this.rev = c.createChannelMerger(2); this.rev.connect(this.out);
    [0.0473, 0.0529, 0.0601, 0.0677].forEach((d, k) => { const dl = c.createDelay(0.2); dl.delayTime.value = d; const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; const fb = c.createGain(); fb.gain.value = 0.74;
      this.revIn.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(this.rev, 0, k & 1); });
    this.dly = c.createDelay(1.5); this.fb = c.createGain(); this.fb.gain.value = 0.32; const dlp = c.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2800;
    this.dlyIn = c.createGain(); this.dlyIn.connect(this.dly); this.dly.connect(dlp); dlp.connect(this.fb); this.fb.connect(this.dly); dlp.connect(this.out);
    const chan = (name, gain, pan, rev, dly) => { const g = c.createGain(); g.gain.value = gain; let n = g; if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); n = p; } n.connect(this.out); if (rev) { const s = c.createGain(); s.gain.value = rev; n.connect(s); s.connect(this.revIn); } if (dly) { const s = c.createGain(); s.gain.value = dly; n.connect(s); s.connect(this.dlyIn); } return g; };
    this.ch = { kick: chan('kick', 0.9, 0, 0, 0), drum: chan('drum', 0.7, 0, 0.12, 0), perc: chan('perc', 0.6, -0.15, 0.25, 0), hat: chan('hat', 0.45, 0.25, 0.08, 0), bass: chan('bass', 0.9, 0, 0, 0),
      stab: chan('stab', 0.8, -0.2, 0.2, 0.35), lead: chan('lead', 0.8, 0.18, 0.3, 0.3), keys: chan('keys', 0.8, -0.1, 0.35, 0.08), pad: chan('pad', 0.8, 0, 0.5, 0), str: chan('str', 0.8, 0.1, 0.4, 0), gtr: chan('gtr', 0.6, 0.35, 0.1, 0.1), fx: chan('fx', 0.5, 0, 0.4, 0) };
    // chorus on pads/strings, tremolo on the Rhodes: one LFO each for the whole station
    const lfo = c.createOscillator(); lfo.frequency.value = 0.35; const lg = c.createGain(); lg.gain.value = 0.0035; lfo.connect(lg); const cd = c.createDelay(0.05); cd.delayTime.value = 0.012; lg.connect(cd.delayTime); const cg = c.createGain(); cg.gain.value = 0.7;
    for (const k of ['pad', 'str']) this.ch[k].connect(cd); cd.connect(cg); cg.connect(this.out); cg.connect(this.revIn);
    const trem = c.createOscillator(); trem.frequency.value = 4.2; const tg = c.createGain(); tg.gain.value = 0.18; trem.connect(tg); tg.connect(this.ch.keys.gain);
    lfo.start(t0); trem.start(t0); this.lfos = [lfo, trem];
    this.trackN = 0; this.newTrack(t0);
  }
  newTrack(t) {
    const r = rngFrom(this.seed * 7919 + this.trackN * 104729 + 17); this.r = r; const T = this.st.gen(r); T.info = title(this.st.id, r); T.n = this.trackN;
    this.T = T; this.sd = 60 / T.bpm / 4; this.bar = 0; this.s = 0; this.tBar = t; this.lastBass = null; this.lastLead = null;
    const map = []; T.sec.forEach((sec, i) => { for (let b = 0; b < sec.bars; b++) map.push({ sec, bis: b, last: b === sec.bars - 1, nextName: T.sec[i + 1]?.name || 'end' }); }); this.map = map;
    this.startT = t; this.dur = map.length * 16 * this.sd; this.onTrack?.(T.info, this);
  }
  get nextT() { return this.tBar + this.s * this.sd; }
  resync(t) { if (this.nextT < t) { const lag = t - this.nextT; const steps = Math.ceil(lag / this.sd); for (let i = 0; i < steps; i++) this.adv(); } }
  adv() { if (++this.s >= 16) { this.s = 0; this.bar++; this.tBar += 16 * this.sd; if (this.bar >= this.map.length) { this.trackN++; this.seed = (this.seed + 1) >>> 0; this.newTrack(this.tBar + this.sd * 8); } } }
  scheduleUntil(tEnd) {
    let guard = 0;
    while (this.nextT < tEnd && guard++ < 4000) {
      const M = this.map[this.bar]; const s = this.s; const t = this.nextT + (s % 2 ? this.T.swing * this.sd * 2 : 0);
      if (t >= this.ctx.currentTime - 0.01) this.st.step(this, this.T, { s, t, m: M.sec.m, sec: M.sec, bis: M.bis, last: M.last, nextName: M.nextName, sd: this.sd, bar: this.bar });
      this.adv();
    }
  }
  // voice accounting: drop low-priority notes when many are sounding (phones)
  admit(t, end, pri) { const L = this.live; let n = 0; for (let i = L.length - 1; i >= 0; i--) { if (L[i] < t) { L[i] = L[L.length - 1]; L.pop(); } else n++; } const lim = pri === 0 ? this.cap : pri === 1 ? this.cap * 0.85 : this.cap * 0.65; if (n >= lim) { this.skipped++; return false; } L.push(end); if (n + 1 > this.peak) this.peak = n + 1; return true; }
  drum(name, t, vel = 1, chn, rate = 1) {
    const b = this.K[name]; if (!b || !this.admit(t, t + Math.min(0.4, b.duration), 0)) return; const c = this.ctx, src = c.createBufferSource(); src.buffer = b; if (rate !== 1) src.playbackRate.value = rate;
    const g = c.createGain(); g.gain.value = vel; src.connect(g); g.connect(this.ch[chn || (name.startsWith('kick') ? 'kick' : 'drum')]); src.start(t); if (name === 'vinyl') src.stop(t + 2.9);
  }
  syn(o) {
    const c = this.ctx, t = o.t, end = t + o.dur + (o.r || 0.05) * 3; if (!this.admit(t, end, o.pri ?? 1)) return;
    const f = mtof(o.n); const osc = c.createOscillator(); osc.type = o.wave || 'sawtooth';
    if (o.from != null && o.from !== o.n) { osc.frequency.setValueAtTime(mtof(o.from), t); osc.frequency.exponentialRampToValueAtTime(f, t + (o.glide || 0.08)); } else osc.frequency.setValueAtTime(f, t);
    if (o.dropTo != null) { osc.frequency.setValueAtTime(f, t + o.dur * 0.55); osc.frequency.exponentialRampToValueAtTime(mtof(o.dropTo), t + o.dur); }
    let head = osc;
    if (o.vib) { const l = c.createOscillator(); l.frequency.value = o.vib; const lg = c.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(12, t + Math.min(0.4, o.dur)); l.connect(lg); lg.connect(osc.detune); l.start(t); l.stop(end); }
    const g = c.createGain(); const v = o.vol ?? 0.1;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + (o.a || 0.005)); if (o.dec && o.dec < 1) g.gain.setTargetAtTime(v * 0.6, t + (o.a || 0.005), o.dec); g.gain.setTargetAtTime(0, t + o.dur, (o.r || 0.05) / 3);
    if (o.cut) { const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = o.q || 1; const cut = clamp(o.cut, 60, 16000); if (o.env) { lp.frequency.setValueAtTime(clamp(cut + o.env, 60, 16000), t); lp.frequency.setTargetAtTime(cut, t, o.dec || 0.1); } else lp.frequency.setValueAtTime(cut, t); head.connect(lp); head = lp; }
    head.connect(g); g.connect(this.ch[o.ch || 'lead']); osc.start(t); osc.stop(end);
    // phones cannot reproduce sub bass: a quiet octave-up sine keeps the bass line audible on small speakers
    if (o.sub && o.wave === 'sine') { const h = c.createOscillator(); h.type = 'triangle'; h.frequency.setValueAtTime(f * 2, t); if (o.from != null && o.from !== o.n) { h.frequency.setValueAtTime(mtof(o.from) * 2, t); h.frequency.exponentialRampToValueAtTime(f * 2, t + (o.glide || 0.08)); } const hg = c.createGain(); hg.gain.value = 0.22; h.connect(hg); hg.connect(g); h.start(t); h.stop(end); }
    osc.onended = () => { try { g.disconnect(); } catch (e) { } };
  }
  rhodes(t, dur, n, vel) { // 2-operator FM electric piano
    const c = this.ctx, end = t + dur + 0.4; if (!this.admit(t, end, 1)) return; const f = mtof(n);
    const car = c.createOscillator(); car.frequency.value = f; const mod = c.createOscillator(); mod.frequency.value = f; const mg = c.createGain();
    mg.gain.setValueAtTime(f * 1.6 * (0.6 + vel * 3), t); mg.gain.setTargetAtTime(f * 0.25, t, 0.25); mod.connect(mg); mg.connect(car.frequency);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + 0.004); g.gain.setTargetAtTime(vel * 0.45, t + 0.004, 0.6); g.gain.setTargetAtTime(0, t + dur, 0.12);
    car.connect(g); g.connect(this.ch.keys); car.start(t); mod.start(t); car.stop(end); mod.stop(end); car.onended = () => { try { g.disconnect(); mg.disconnect(); } catch (e) { } };
  }
  riser(t, dur, kind) { // filtered-noise sweep into the next section
    const c = this.ctx; if (!this.admit(t, t + dur, 2)) return; const src = c.createBufferSource(); src.buffer = this.K.noise; src.loop = true; const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = kind === 'grime' ? 6 : 2;
    bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(kind === 'soft' ? 3000 : 7000, t + dur); const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(kind === 'soft' ? 0.06 : 0.14, t + dur); g.gain.setTargetAtTime(0, t + dur, 0.03);
    src.connect(bp); bp.connect(g); g.connect(this.ch.fx); src.start(t); src.stop(t + dur + 0.2);
  }
  stop(t = this.ctx.currentTime, fade = 0.25) { this.out.gain.cancelScheduledValues(t); this.out.gain.setValueAtTime(this.out.gain.value, t); this.out.gain.linearRampToValueAtTime(0, t + fade); this.dead = true; setTimeout(() => { try { this.lfos.forEach(l => l.stop()); this.out.disconnect(); this.fb.disconnect(); this.revIn.disconnect(); } catch (e) { } }, (fade + 2) * 1000); }
}

// ================================================================================================= live radio
const LS = 'cuzzy.radio.v1';
export class Radio {
  constructor(app) {
    this.app = app; this.a = app.audio; this.started = false; this.player = null;
    let S = {}; try { S = JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { }
    this.station = Number.isInteger(S.st) && S.st >= -1 && S.st < STATIONS.length ? S.st : 0; // -1 = off
    this.seeds = Array.isArray(S.seeds) && S.seeds.length === STATIONS.length ? S.seeds : STATIONS.map(() => (Math.random() * 1e9) >>> 0);
    this.look = IS_PHONE ? 0.5 : 0.35;
    // the radio replaces the old generative menu music; it keeps playing from menus into races
    const A = this.a; A.startMusic = () => this.begin(); A.stopMusic = () => { }; A.radio = this;
    this.ui(); this.bindInput();
    this.timer = setInterval(() => this.tick(), 50);
  }
  save() { try { localStorage.setItem(LS, JSON.stringify({ st: this.station, seeds: this.seeds })); } catch (e) { } }
  graph() {
    const A = this.a; if (!A.ctx || this.duck) return !!A.ctx; const c = A.ctx;
    this.duck = c.createGain(); this.duck.connect(A.bus.music); this.duckV = 1;
    return true;
  }
  begin() { this.started = true; if (!this.graph()) return; if (this.station >= 0 && !this.player) this.play(this.station, false); this.updBtn(); }
  play(i, withStatic = true) {
    const c = this.a.ctx; if (!c) return; this.graph(); const t = c.currentTime;
    if (this.player) { this.seeds[this.playing] = (this.player.seed + 1) >>> 0; this.player.stop(t, 0.12); this.player = null; }
    if (withStatic) this.tuning(t, i < 0 ? 0.25 : 0.55);
    this.playing = i; if (i < 0) { this.save(); this.updBtn(); this.toast('RADIO OFF', ''); return; }
    const st = STATIONS[i]; const t0 = t + (withStatic ? 0.45 : 0.08);
    this.player = new StationPlayer(c, this.duck, st, this.seeds[i], t0, { onTrack: (info, p) => { this.seeds[i] = p.seed; this.save(); if (p.trackN > 0 && p === this.player) setTimeout(() => this.toast(st.name, `${info.artist} — ${info.title}`), Math.max(0, (p.startT - c.currentTime) * 1000)); } });
    this.player.out.gain.setValueAtTime(0, t0); this.player.out.gain.linearRampToValueAtTime(st.gain, t0 + 0.3);
    this.save(); this.updBtn(); const info = this.player.T.info; this.toast(`${st.freq}  ${st.name}`, `${info.artist} — ${info.title}`);
  }
  tuning(t, dur) { // dial static + heterodyne whistle between stations
    const c = this.a.ctx, K = kitFor(c); const src = c.createBufferSource(); src.buffer = K.noise; const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(1200, t); bp.frequency.linearRampToValueAtTime(3400, t + dur * 0.5); bp.frequency.linearRampToValueAtTime(1600, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 0.03); g.gain.setValueAtTime(0.22, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(2400 + Math.random() * 1500, t); o.frequency.exponentialRampToValueAtTime(300 + Math.random() * 500, t + dur); const og = c.createGain(); og.gain.setValueAtTime(0.04, t); og.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(bp); bp.connect(g); g.connect(this.duck); o.connect(og); og.connect(this.duck); src.start(t, Math.random()); src.stop(t + dur + 0.05); o.start(t); o.stop(t + dur + 0.05);
  }
  cycle(dir = 1) {
    this.a.unlock?.(); this.started = true; if (!this.graph()) return;
    const n = STATIONS.length + 1; const cur = this.station + 1; this.station = ((cur + dir) % n + n) % n - 1; // Off → 0 → 1 → 2 → Off
    this.play(this.station, true);
  }
  set(i) { if (i === this.station && (i < 0 || this.player)) return; this.a.unlock?.(); this.started = true; if (!this.graph()) return; this.station = i; this.play(i, true); }
  tick() {
    const A = this.a, c = A.ctx; this.pollPad(); this.updVis();
    if (!c || !this.duck || c.state !== 'running') return;
    const app = this.app; const sess = app.session;
    const talking = [...(app.voice?.speaking?.values?.() || [])].some(Boolean);
    const target = app.view === 'intro' ? 0 : sess?.state === 'countdown' ? 0.3 : talking ? 0.4 : 1;
    if (target !== this.duckV) { this.duckV = target; this.duck.gain.setTargetAtTime(target, c.currentTime, target < 1 ? 0.08 : 0.5); }
    const P = this.player; if (!P || !this.started) return;
    if ((this.app.settings?.sound?.music ?? 1) <= 0) { P.resync(c.currentTime); return; } // music volume at zero: schedule nothing
    P.resync(c.currentTime + 0.02); P.scheduleUntil(c.currentTime + this.look);
  }
  pollPad() {
    const gp = standardPad(); if (!gp) return;
    const b = !!(gp.buttons[8]?.pressed || gp.buttons[12]?.pressed); if (b && !this.gpPrev) this.cycle(1); this.gpPrev = b;
  }
  bindInput() {
    addEventListener('keydown', e => { if (e.repeat || e.target?.closest?.('input,textarea,select,[contenteditable]')) return; if (e.key === 'm' || e.key === 'M') { this.cycle(e.shiftKey ? -1 : 1); } });
    // iOS / Safari: a suspended or interrupted context only resumes inside a user gesture
    const kick = () => { const c = this.a.ctx; if (!c || c.state === 'running' || c.state === 'closed') return; if (this.app.paused && !this.app.session?.online) return; c.resume().catch(() => { }); };
    for (const ev of ['pointerdown', 'touchend', 'keydown']) addEventListener(ev, kick, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
  }
  // ---------- UI: button (#radio-btn, created if the menu has not reserved one) and now-playing toast
  ui() {
    if (typeof document === 'undefined') return;
    const css = document.createElement('style'); css.id = 'radio-style';
    css.textContent = `#radio-btn.radio-own{position:fixed;z-index:40;top:calc(10px + env(safe-area-inset-top,0px));right:calc(12px + env(safe-area-inset-right,0px));height:34px;min-width:34px;padding:0 10px;border-radius:17px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.5);color:#eef1f4;font:700 12px/1 'Saira Condensed',system-ui,sans-serif;letter-spacing:.06em;display:flex;align-items:center;gap:6px;cursor:pointer;pointer-events:auto;opacity:.85}
#radio-btn.radio-own:hover{opacity:1}#radio-btn .rdot{width:8px;height:8px;border-radius:50%;background:#555}#radio-btn.on .rdot{background:#19e6c1;box-shadow:0 0 6px #19e6c1}
body.radio-ingame #radio-btn.radio-own{top:calc(172px + env(safe-area-inset-top,0px))}@media (max-height:520px){body.radio-ingame #radio-btn.radio-own{top:calc(130px + env(safe-area-inset-top,0px))}}
#radio-toast{position:fixed;z-index:61;left:50%;top:calc(12px + env(safe-area-inset-top,0px));transform:translate(-50%,-8px);background:rgba(8,10,14,.82);border:1px solid rgba(255,255,255,.14);border-left:3px solid #19e6c1;border-radius:8px;padding:6px 14px;color:#eef1f4;pointer-events:none;opacity:0;transition:opacity .25s,transform .25s;text-align:center;max-width:80vw}
#radio-toast.show{opacity:1;transform:translate(-50%,0)}#radio-toast b{display:block;font:700 15px/1.2 'Saira Condensed',system-ui,sans-serif;letter-spacing:.08em}#radio-toast small{display:block;font-size:12px;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`;
    document.head.appendChild(css);
    const mk = () => { let b = document.getElementById('radio-btn'); if (!b) { b = document.createElement('button'); b.id = 'radio-btn'; b.className = 'radio-own'; b.type = 'button'; b.innerHTML = '<span class="rdot"></span><span class="rlbl">RADIO</span>'; document.body.appendChild(b); this.own = true; } return b; };
    const go = () => { this.btn = mk(); this.btn.addEventListener('click', e => { e.stopPropagation(); this.cycle(1); this.btn.blur(); }); this.btn.addEventListener('pointerdown', e => e.stopPropagation()); this.updBtn(); this.updVis(); };
    document.readyState === 'loading' ? addEventListener('DOMContentLoaded', go) : go();
    this.tst = document.createElement('div'); this.tst.id = 'radio-toast'; this.tst.setAttribute('aria-live', 'polite'); (document.body ? document.body.appendChild(this.tst) : addEventListener('DOMContentLoaded', () => document.body.appendChild(this.tst)));
  }
  updBtn() {
    const b = this.btn; if (!b) return; const st = STATIONS[this.station]; const label = st ? st.name : 'RADIO OFF';
    b.classList.toggle('on', !!st); b.dataset.station = st ? st.id : 'off'; b.title = `Radio: ${label} (M / gamepad Select to change)`; b.setAttribute('aria-label', `Radio: ${label}. Tap to change station`);
    const l = b.querySelector('.rlbl'); if (l) l.textContent = st ? st.name : 'RADIO OFF'; else if (!b.textContent.trim()) b.textContent = label;
  }
  updVis() {
    const b = this.btn; if (!b || !this.own) return; const app = this.app;
    const hide = app.screen === 'boot' || app.view === 'intro' || !!document.querySelector('#boot.show'); if (b.hidden !== hide) b.hidden = hide;
    const inGame = !!app.session && !document.getElementById('hud')?.hidden; document.body.classList.toggle('radio-ingame', inGame);
  }
  toast(a, b) { const d = this.tst; if (!d) return; d.innerHTML = `<b></b><small></small>`; d.firstChild.textContent = a; d.lastChild.textContent = b || ''; d.lastChild.hidden = !b; d.classList.add('show'); clearTimeout(this.tT); this.tT = setTimeout(() => d.classList.remove('show'), 3200); }
  get nowPlaying() { const p = this.player; return p ? { station: p.st.name, ...p.T.info, bpm: p.T.bpm, section: p.map[p.bar]?.sec.name, track: p.trackN } : null; }
}
