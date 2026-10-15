// Settings schema, defaults, graphics presets and device detection.
export const IS_IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform)); // Safari on iOS kills a tab far sooner than Android Chrome when GPU memory runs high
export const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
export const HAS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

// shadows: 0 off, 1 low (soft PCF, tight frustum round the car, map re-rendered every 2nd frame), 2 high (High/Ultra:
// contact-hardening PCSS). reflections: 0 off, 1 static env map, 2 live cube probe (one face per frame). effects (post):
// 0 off, 1 low (half-res bloom + grade, no GTAO / atmosphere pass), 2 high (everything). resAuto: dynamic resolution
// 50-100% of the internal resolution (DPR capped at dprCap) driven by the measured frame time.
export const PRESETS = {
  low: { fps: 30, res: 0.6, resAuto: false, dprCap: 2, shadows: 0, reflections: 1, carDetail: 0, envDetail: 0, aa: 'off', bloom: false, effects: 0, weatherFx: false, drawDist: 700 },
  medium: { fps: 60, res: 0.8, resAuto: false, dprCap: 2, shadows: 1, reflections: 1, carDetail: 1, envDetail: 1, aa: 'off', bloom: true, effects: 1, weatherFx: true, drawDist: 1100 },
  high: { fps: 60, res: 1.0, resAuto: false, dprCap: 2, shadows: 2, reflections: 1, carDetail: 2, envDetail: 2, aa: 'smaa', bloom: true, effects: 2, weatherFx: true, drawDist: 1600 },
  ultra: { fps: 120, res: 1.0, resAuto: false, dprCap: 2, shadows: 2, reflections: 2, carDetail: 2, envDetail: 3, aa: 'smaa', bloom: true, effects: 2, weatherFx: true, drawDist: 2400 },
  // Ultra Adaptive: High/Ultra cars, materials and nearby scenery, but a frame-time budget: dynamic resolution, soft PCF
  // shadows in a tight frustum, static reflections, half-res bloom + grade (no GTAO / light shafts), 2 lamp lights
  adaptive: { fps: 120, res: 1.0, resAuto: true, dprCap: 2, shadows: 1, reflections: 2, carDetail: 2, envDetail: 2, aa: 'smaa', bloom: true, effects: 1, weatherFx: true, drawDist: 1600 },
};
// reflections 2 is now the PMREM-filtered car probe (128-256 cube, one face per frame) on Medium and up
PRESETS.medium.reflections = 2; PRESETS.high.reflections = 2;
// Phones / tablets (High / Ultra): the scene + post chain run at 1.5 x device-independent pixels (75 % of a DPR-2 canvas)
// and the Sharp (Catmull-Rom + RCAS) pass draws the full canvas; no SMAA (the upscaler's filter + tiny phone pixels).
// GTAO off, 1024 shadow map every 3rd frame round the car, 2 lamp lights, no transmission glass in a race (gfx.js).
if (IS_MOBILE) for (const k of ['high', 'ultra']) Object.assign(PRESETS[k], { res: 0.75, upscale: 'sharp', aa: 'off', drawDist: k === 'ultra' ? 1800 : 1300 });

// iPhone / iPad: lighter render targets so Safari doesn't reload the page ("A problem repeatedly occurred"):
// canvas capped at 1.5x, static reflections (no live cube probe) and Low/Medium-sized post on every preset
if (IS_IOS) for (const k of Object.keys(PRESETS)) Object.assign(PRESETS[k], { dprCap: 1.5, reflections: Math.min(1, PRESETS[k].reflections), effects: Math.min(1, PRESETS[k].effects), drawDist: Math.min(1300, PRESETS[k].drawDist) });

export function defaults() {
  return {
    v: 1,
    sound: { master: 0.8, engine: 0.9, exhaust: 0.9, tyres: 0.7, music: 0.5, voice: 1, menu: 0.6, intro: 1, introOn: true, crackle: 1 },
    voice: { enabled: true, mode: 'open', range: 'room', micId: '', micMuted: true, micAsked: false, codec: 'auto', playerVol: {}, muted: {} }, // micMuted: mic OFF by default (and at every launch)
    world: { weather: 'auto', time: 'auto', hour: 12, rainFx: 'auto' }, // p55 Settings > World
    graphics: { preset: 'auto', ...PRESETS[IS_MOBILE ? 'medium' : 'high'], resAuto: true, motionBlur: false, shake: true, showFps: false, dayCycle: true },
    controls: { steer: HAS_TOUCH ? 'buttons' : 'keyboard', padSens: 0.8, padCurve: 1.7, rumble: 0.8, auto: true, sens: 1, steerAssist: 0.6, abs: true, tc: true, esc: true, smartThrottle: true,
      btnSize: 1, btnHeight: 0, pedalsLeft: false, regen: 1, onePedal: false, evConsumption: false, camera: 'chase', tiltSens: 1 },
    game: { units: 'mph', minimapRotate: true, name: '', aiOpp: 5, aiDiff: 'normal' }, // solo race opponents 0-7, easy/normal/hard
  };
}

// deep-merge saved values over defaults so new settings appear with defaults
export function merge(base, saved) {
  if (!saved || typeof saved !== 'object') return base;
  for (const k of Object.keys(base)) {
    if (saved[k] === undefined) continue;
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && Object.keys(base[k]).length) base[k] = merge(base[k], saved[k]);
    else base[k] = saved[k];
  }
  for (const k of ['playerVol', 'muted']) if (saved?.[k] && base[k]) base[k] = saved[k];
  return base;
}

// p51 Auto (best for this device): starts at Balanced (phones) / High (desktop), then game.js autoTune() benchmarks a few
// seconds of real driving and steps the tier up / down until it holds ~60 fps (30 on phones); dynamic resolution stays on.
export const TIERS = ['low', 'medium', 'high', 'ultra'];
export const TIER_NAMES = { auto: 'Auto (best for this device)', low: 'Battery', medium: 'Balanced', high: 'High', ultra: 'Ultra', adaptive: 'Ultra Adaptive', custom: 'Custom' };
export function resolvedPreset(g) { return g.preset === 'auto' ? (TIERS.includes(g.autoTier) ? g.autoTier : (IS_MOBILE ? 'medium' : 'high')) : g.preset; }
export function applyPreset(g, name) { g.preset = name; Object.assign(g, PRESETS[resolvedPreset(g)]); if (name === 'auto') { g.resAuto = true; if (g.fps > 60) g.fps = 60; } }
// after loading saved settings: a named preset always gets its current values (so new fields / retuned presets apply);
// an older Custom setup without the new fields gets them from its old toggles
export function normalizeGfx(g, saved) {
  if (g.preset !== 'custom' && PRESETS[resolvedPreset(g)]) { applyPreset(g, g.preset); return g; }
  if (saved && saved.effects === undefined) g.effects = g.bloom ? 2 : 0;
  if (![30, 60, 120].includes(g.fps)) g.fps = 60; g.res = Math.max(0.5, Math.min(1, +g.res || 1)); return g;
}
// graphics are per device: kept in localStorage as well as the server profile, and the local copy wins on this device
const LK = 'cuzzy.gfx';
export function loadLocalGfx() { try { const j = JSON.parse(localStorage.getItem(LK) || 'null'); return j && typeof j === 'object' ? j : null; } catch (e) { return null; } }
export function saveLocalGfx(g) { try { localStorage.setItem(LK, JSON.stringify(g)); } catch (e) { } }
