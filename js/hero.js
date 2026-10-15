// p53 hero car: CUZZY R6 Avant (original design, fast estate). Adds to the procedural estate body from carmodel.js:
// exterior aero / roof rails / wipers, a full VR-ready interior (flat-bottom wheel with horn + paddles, sequential lever,
// clickable / pressable button bank, live digital cluster, centre sat-nav screen showing the game's real map + GPS route,
// rear-view and wing mirrors rendered to small targets on High / Ultra), and the runtime that makes it all work.
// Desktop / phone: tap or click a control in the cockpit view. VR: press it with a fingertip or controller (vr.js).
import * as THREE from 'three';
import { resolvedPreset } from './settings.js';

const LBL = { trans: 'A / M', cabin: 'CABIN', selP: 'P', selR: 'R', selN: 'N', selD: 'D', selM: 'M', haz: '⚠', lights: 'LIGHT', wipe: 'WIPE', indL: '◀', indR: '▶', launch: 'LAUNCH', mode: 'MODE', radio: 'RADIO', zin: 'ZOOM+', zout: 'ZOOM−', fold: 'MIRROR', horn: 'HORN', up: '+', down: '−' };
const MODES = ['Comfort', 'Dynamic', 'Track'];
function labelTex(t, col = '#e8ecef', bg = '#16191d') { const c = document.createElement('canvas'); c.width = 128; c.height = 80; const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, 128, 80); g.strokeStyle = '#3b4148'; g.lineWidth = 6; g.strokeRect(3, 3, 122, 74);
  g.fillStyle = col; g.font = `700 ${t.length > 4 ? 26 : 44}px system-ui,Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 64, 42); const x = new THREE.CanvasTexture(c); x.colorSpace = THREE.SRGBColorSpace; return x; }
function canvasPlane(w, h, pw, ph) { const c = document.createElement('canvas'); c.width = w; c.height = h; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshBasicMaterial({ map: t, toneMapped: false })); return { c, g: c.getContext('2d'), t, m }; }

// called by carpro.buildPro for hero cars: OEM-style screens, controls and mirrors on the pro interior anchors
function screenMat(t) { return new THREE.MeshPhysicalMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: t, roughness: 0.22, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.18, envMapIntensity: 0.55 }); } // anti-glare glass over a lit panel
function oemPlane(w, h, pw, ph) { const c = document.createElement('canvas'); c.width = w; c.height = h; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), screenMat(t)); return { c, g: c.getContext('2d'), t, m }; }
function keyMat(lbl, col) { return new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.18, clearcoat: 1, emissive: 0xffffff, emissiveMap: labelTex(lbl, col, '#050506'), emissiveIntensity: 0.55 }); }
export function initHero(root, car) { const u = root.userData, I = u.pro.I, P = u.pro.P, eye = u.cockpit, interior = u.interior, bodyG = u.body, sw = I.sw;
  const H = u.hero = { btns: [], st: { lights: 0, wipe: 0, ind: 0, launch: 0, mode: 1, zoom: 1, fold: 0, launchT: 0, wipeA: 0, foldK: 0 }, t: 0 };
  function btn(m, nm) { m.userData.heroBtn = nm; H.btns.push(m); }
  btn(I.hub, 'horn');
  for (const [sx, nm] of [[1, 'up'], [-1, 'down']]) { const pd = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.085, 0.006), [I.alu, I.alu, I.alu, I.alu, keyMat(LBL[nm], '#fff'), I.alu]); pd.position.set(sx * 0.165, 0.055, -0.04); pd.rotation.z = -sx * 0.3; sw.add(pd); btn(pd, nm); }
  // virtual cockpit in the binnacle, MMI top screen on the centre stack, climate / drive keys below it
  const cl = H.dash = oemPlane(1024, 384, 0.3, 0.1125); cl.m.position.set(I.dx, 0.962, -0.34); interior.add(cl.m); cl.m.lookAt(eye);
  const nv = H.nav = oemPlane(1024, 600, 0.25, 0.1465); nv.m.position.set(0.0, 0.985, -0.262); interior.add(nv.m); nv.m.lookAt(eye);
  const bez = new THREE.Mesh(new THREE.BoxGeometry(0.268, 0.163, 0.01), I.black); bez.position.copy(nv.m.position).addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(nv.m.quaternion), -0.006); bez.quaternion.copy(nv.m.quaternion); interior.add(bez);
  const bank = new THREE.Group(); bank.position.set(0.0, 0.79, -0.215); interior.add(bank); bank.lookAt(eye);
  const rows = [['haz', 'lights', 'wipe', 'indL', 'indR', 'launch'], ['mode', 'radio', 'zout', 'zin', 'fold', 'cabin'], ['trans']];
  rows.forEach((r, ri) => r.forEach((nm, i) => { const b = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.02, 0.008), [I.black, I.black, I.black, I.black, keyMat(LBL[nm], nm === 'haz' ? '#ff3b30' : nm === 'launch' ? '#ffcc00' : '#e8ecef'), I.black]); b.position.set((i - (r.length - 1) / 2) * 0.04, -ri * 0.028, 0); bank.add(b); btn(b, nm); }));
  // sequential lever (vr.js grabs it; click the knob = up)
  const lv = new THREE.Group(); lv.position.set(0.04, 0.595, 0.12); interior.add(lv);
  const gait = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.042, 0.05, 16), I.leather); gait.position.y = 0.025; lv.add(gait);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.011, 0.16, 12), I.alu); stick.position.y = 0.08; lv.add(stick);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.027, 24, 16), I.leather); knob.scale.set(0.9, 1.25, 1.05); knob.position.y = 0.165; lv.add(knob); btn(knob, 'up'); H.lever = lv;
  const selG = new THREE.Group(); selG.position.set(-0.035, 0.598, 0.12); interior.add(selG); selG.rotation.x = -Math.PI / 2;
  ['selP', 'selR', 'selN', 'selD', 'selM'].forEach((nm, i) => { const b = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.022, 0.006), [I.black, I.black, I.black, I.black, keyMat(LBL[nm], '#e8ecef'), I.black]); b.position.set(0, 0.06 - i * 0.026, 0); selG.add(b); btn(b, nm); });
  H.cabin = new THREE.PointLight(0xfff1d8, 0, 2.6, 2); H.cabin.position.set(0, 1.36, 0.45); interior.add(H.cabin);
  H.cabinLamp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.01, 0.05), new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0xfff1d8, emissiveIntensity: 0 })); H.cabinLamp.position.set(0, 1.405, 0.42); interior.add(H.cabinLamp);
  H.keyMats = H.btns.flatMap(b => Array.isArray(b.material) ? b.material.filter(m => m.emissiveMap) : []);
  // wipers on the cowl
  H.wipers = []; for (const sx of [1, -1]) { const p = new THREE.Group(); p.position.set(sx * 0.32 + 0.12, P.roof[0][1] + 0.005, P.roof[0][0] - 0.03); const a = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.01, 0.012).translate(-0.29, 0, 0), I.black); p.add(a); p.rotation.x = -0.52; bodyG.add(p); H.wipers.push(p); }
  // mirrors: rear-view on the screen header + both door mirrors (render targets, High / Ultra only)
  H.mirrors = []; const rv = new THREE.Vector3(0.03, 1.335, P.roof[0][0] + 0.78);
  { const hs = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.075, 0.03), I.black); hs.position.copy(rv).add(new THREE.Vector3(0, 0, -0.018)); interior.add(hs); }
  for (const [nm, pos, w, h, rw] of [['rear', rv, 0.245, 0.064, 320], ...u.pro.mirrorFace.map(f => [f.nm, f.pos, f.w * 0.92, f.h * 0.86, 192])]) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x3a4048, toneMapped: false }); const q = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); q.position.copy(pos); bodyG.add(q); if (nm === 'rear') q.lookAt(eye); else q.rotation.y = 0; q.scale.x = -1;
    const cam = new THREE.PerspectiveCamera(nm === 'rear' ? 24 : 30, w / h, 0.4, 350); cam.position.copy(pos); cam.position.z += 0.05; cam.rotation.y = Math.PI + (nm === 'L' ? 0.22 : nm === 'R' ? -0.22 : 0); bodyG.add(cam);
    H.mirrors.push({ nm, q, cam, mat, rw, w, h, rt: null, grp: u.pro.mirrorFace.find(f => f.nm === nm)?.grp }); }
  H.mirN = 0; H.dashT = 0; H.navT = 0;
  // public interactables API for VR / other input layers (no vr.js coupling): { id, type, mesh, press?(s), grab info }
  u.controls = { version: 1,
    get interactables() { const L = H.btns.map(m => ({ id: m.userData.heroBtn, type: m.userData.heroBtn === 'up' || m.userData.heroBtn === 'down' ? 'paddle' : m.userData.heroBtn.startsWith('sel') ? 'selector' : 'button', mesh: m, press: (s) => press(s, m.userData.heroBtn) }));
      L.push({ id: 'wheel', type: 'wheel', mesh: sw, radius: I.R, axis: 'z' }); if (H.lever) L.push({ id: 'lever', type: 'lever', mesh: H.lever });
      for (const m of H.mirrors) L.push({ id: 'mirror_' + m.nm, type: 'mirror', mesh: m.q, fold: m.nm !== 'rear' ? (s) => press(s, 'fold') : null });
      L.push({ id: 'satnav', type: 'screen', mesh: H.nav.m, zoom: (s) => press(s, 'zoom') }, { id: 'cluster', type: 'screen', mesh: H.dash.m }); return L; },
    press: (s, id) => press(s, id) };
  return H; }
export function buildHero() { } // legacy hook (pre-pro procedural body) kept as a no-op
// ---------------------------------------------------------------- runtime
const _ray = new THREE.Raycaster(), _v = new THREE.Vector2(), _w = new THREE.Vector3();
let bound = false;
function bind() { if (bound) return; bound = true;
  addEventListener('pointerdown', e => { const A = globalThis.CUZZY, s = A?.session, H = s?.obj?.userData?.hero; if (!H || s.foot?.active || s.paused || e.target?.closest?.('button,input,select,a,label,.tc,.modal,#modal,#minimap')) return;
    const r = A.gfx.r.domElement.getBoundingClientRect(); _v.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); _ray.setFromCamera(_v, A.gfx.cam);
    const hit = _ray.intersectObjects(H.btns, false)[0]; if (hit && hit.distance < 2.5) { press(s, hit.object.userData.heroBtn); e.stopPropagation(); } }, true); }
export function press(s, nm) { const H = s.obj.userData.hero; if (!H) return false; const st = H.st, A = s.app; H.last = nm; H.lastT = H.t;
  const b = H.btns.find(b => b.userData.heroBtn === nm); if (b) b.userData.pressT = 0.15;
  switch (nm) {
    case 'haz': s.hazard = !s.hazard; break;
    case 'cabin': st.cabin = st.cabin ? 0 : 1; break;
    case 'trans': A.settings.controls.auto = !A.settings.controls.auto; s.hud?.flash?.(A.settings.controls.auto ? 'Gearbox: Automatic (D)' : 'Gearbox: Manual (M) — paddles / lever / E Q', 1.4); break;
    case 'selD': A.settings.controls.auto = true; st.park = 0; if (s.S.reverse) s.inp.reverseToggle = 1; break;
    case 'selM': A.settings.controls.auto = false; st.park = 0; if (s.S.reverse) s.inp.reverseToggle = 1; break;
    case 'selR': st.park = 0; if (!s.S.reverse) s.inp.reverseToggle = 1; break;
    case 'selP': st.park = st.park ? 0 : 1; break;
    case 'selN': st.neutral = st.neutral ? 0 : 1; break;
    case 'lights': st.lights = (st.lights + 1) % 4; s.hud?.flash?.('Headlights: ' + ['Auto', 'Dipped', 'Full beam', 'Off'][st.lights], 1); break;
    case 'wipe': st.wipe = (st.wipe + 1) % 3; break;
    case 'indL': st.ind = st.ind === -1 ? 0 : -1; break;
    case 'indR': st.ind = st.ind === 1 ? 0 : 1; break;
    case 'horn': horn(A); H.hornN = (H.hornN || 0) + 1; break;
    case 'launch': st.launch = st.launch ? 0 : 1; s.hud?.flash?.(st.launch ? 'Launch control armed: hold brake + full throttle, release brake' : 'Launch control off', 1.6); break;
    case 'mode': st.mode = (st.mode + 1) % 3; s.hud?.flash?.('Drive mode: ' + MODES[st.mode], 1.2); break;
    case 'radio': try { A.radio?.cycle(1); } catch (e) { } break;
    case 'zin': st.zoom = Math.min(4, st.zoom * 1.5); break;
    case 'zout': st.zoom = Math.max(0.35, st.zoom / 1.5); break;
    case 'fold': st.fold = st.fold ? 0 : 1; break;
    case 'up': s.inp.shiftUp = 1; break;
    case 'down': s.inp.shiftDown = 1; break;
  } H.dashT = 0; return true; }
function tick(A, on) { const c = A.audio?.ctx; if (!c) return; const t = c.currentTime, g = c.createGain(), o = c.createOscillator(); o.type = 'square'; o.frequency.value = on ? 1900 : 1500; g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.025); o.connect(g).connect(A.audio.bus?.fx || c.destination); o.start(t); o.stop(t + 0.03); }
function horn(A) { const c = A.audio?.ctx; if (!c) return; const t = c.currentTime, g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.02); g.gain.setTargetAtTime(0, t + 0.45, 0.04); g.connect(A.audio.bus?.fx || c.destination);
  for (const f of [415, 494]) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f; const lp = c.createBiquadFilter(); lp.frequency.value = 1800; o.connect(lp).connect(g); o.start(t); o.stop(t + 0.7); } }
// throttle map / launch control (from game.readInput)
export function heroInput(s, dt) { const H = s.obj?.userData?.hero; if (!H) return; const st = H.st, i = s.inp, S = s.S, P = s.P;
  if (P._lmu == null) { P._lmu = P.launchMu; P._lsd = P.lsd; }
  P.lsd = P._lsd + (st.mode === 2 ? 0.1 : 0); if (st.mode === 0) i.throttle *= 0.72;
  if (st.launch) { if (Math.abs(S.vx) < 0.6 && i.brake > 0.3 && i.throttle > 0.6) { st.hold = 1; i.throttle = Math.min(i.throttle, 0.62); } // holds ~4,500 rpm on the brake
    else if (st.hold && i.brake < 0.1) { st.hold = 0; st.launchT = 2.6; st.launch = 0; s.hud?.flash?.('LAUNCH', 0.8); } }
  if (st.park) { i.handbrake = 1; i.throttle = 0; } if (st.neutral) i.throttle = Math.min(i.throttle, 1) * 0, i.directGear = 0;
  st.launchT = Math.max(0, st.launchT - dt); P.launchMu = P._lmu * (st.launchT > 0 ? 1.12 : 1); }
// per frame (from the game's lights update)
export function heroUpdate(s, dt) { const o = s.obj, H = o?.userData?.hero; if (!H) return; bind(); H.t += dt; const st = H.st, A = s.app, L = o.userData.lights, blink = (s.t % 0.8) < 0.4;
  const night = !!A.gfx.night; H.beam = st.lights === 3 ? 0 : st.lights === 2 ? 2 : st.lights === 1 ? 1 : (night || s.wet ? 1 : 0);
  if (L) { L.head.emissiveIntensity = H.beam === 2 ? 5 : H.beam === 1 ? (night ? 3.2 : 1.4) : 0.15;
    const bL = blink && (s.hazard || st.ind === -1), bR = blink && (s.hazard || st.ind === 1); L.ind.emissiveIntensity = bL ? 3 : 0; if (L.indR) L.indR.emissiveIntensity = bR ? 3 : 0; H.indL = bL; H.indR = bR;
    if ((s.hazard || st.ind) && blink !== H.lastBlink) { tick(A, blink); H.ticks = (H.ticks || 0) + 1; } H.lastBlink = blink; }
  const sp = A.gfx.headSpot; if (sp) { if (H.beam === 0) sp.intensity = 0; else { sp.intensity = (A.gfx.headI || 40) * (H.beam === 2 ? 2.4 : 1); if (H.beam === 2) { const yaw = o.rotation.y; sp.target.position.set(o.position.x - Math.sin(yaw) * 70, o.position.y - 0.2, o.position.z - Math.cos(yaw) * 70); sp.target.updateMatrixWorld(); } } H.spotI = sp.intensity; }
  if (H.cabin) { H.cabin.intensity = st.cabin ? 0.8 : 0; H.cabinLamp.material.emissiveIntensity = st.cabin ? 2 : 0; }
  for (const m of H.keyMats || []) m.emissiveIntensity = night ? 1.1 : 0.45; for (const p of [H.dash, H.nav]) p.m.material.emissiveIntensity = night ? 0.75 : 1.05;
  st.wipeA += dt * (st.wipe === 2 ? 5.5 : st.wipe === 1 ? 2.6 : 0); const wa = st.wipe ? (1 - Math.cos(st.wipeA)) * 0.75 : Math.max(0, H.wipers[0].rotation.z - dt * 2);   for (const w of H.wipers) w.rotation.y = wa;
  for (const b of H.btns) { if (b.userData.pressT > 0) { b.userData.pressT -= dt; b.scale.setScalar(0.85); } else b.scale.setScalar(1); }
  st.foldK += ((st.fold ? 1 : 0) - st.foldK) * Math.min(1, dt * 4); for (const m of H.mirrors) if (m.nm !== 'rear' && m.grp) { m.grp.rotation.y = (m.nm === 'R' ? 1 : -1) * st.foldK * 1.1; m.q.visible = st.foldK < 0.3; }
  const cock = s.camMode === 'cockpit' || A.vr?.active; if (!cock || !mirrorsOn(A)) mirrors(H, s, A, false); if (!cock) return;
  if ((H.dashT -= dt) <= 0) { H.dashT = 1 / 15; drawDash(H, s); }
  if ((H.navT -= dt) <= 0) { H.navT = 1 / 6; drawNav(H, s); }
  mirrors(H, s, A); }
// mirrors on every tier: res + refresh scale with the preset (low = Battery, medium = Balanced)
const MQ = { low: [0.4, 4], medium: [0.6, 2], high: [1, 1], ultra: [1, 1] };
function mirrorTier(A) { const g = A.settings.graphics; return g.preset === 'adaptive' ? 'high' : (MQ[resolvedPreset(g)] ? resolvedPreset(g) : 'medium'); }
function mirrorsOn(A) { return A.settings.graphics.heroMirrors !== false; }
function mirrors(H, s, A, draw = true) { const on = mirrorsOn(A) && draw, tier = mirrorTier(A), [rs, every] = MQ[tier]; H.mirTier = tier;
  for (const m of H.mirrors) { if (m.rt && m.tier !== tier) { m.rt.dispose(); m.rt = null; }
    if (on && !m.rt) { const w = Math.max(64, Math.round(m.rw * rs)); m.rt = new THREE.WebGLRenderTarget(w, Math.round(w * m.h / m.w)); m.tier = tier; m.rt.texture.colorSpace = THREE.SRGBColorSpace; m.mat.map = m.rt.texture; m.mat.color.set(0xffffff); m.mat.needsUpdate = true; }
    if (!on && m.rt) { m.rt.dispose(); m.rt = null; m.mat.map = null; m.mat.color.set(0x3a4048); m.mat.needsUpdate = true; } }
  if (!on) return; H.mirSkip = (H.mirSkip || 0) + 1; if (H.mirSkip % every) return; const m = H.mirrors[H.mirN++ % H.mirrors.length]; if (m.nm !== 'rear' && H.st.foldK > 0.5) return; const G = A.gfx, r = G.r; const xr = r.xr.enabled, old = r.getRenderTarget(), sh = r.shadowMap.autoUpdate;
  r.xr.enabled = false; r.shadowMap.autoUpdate = false; r.setRenderTarget(m.rt); for (const q of H.mirrors) q.q.visible = false; r.render(G.scene, m.cam); for (const q of H.mirrors) q.q.visible = true; r.setRenderTarget(old); r.shadowMap.autoUpdate = sh; r.xr.enabled = xr; H.mirFrames = (H.mirFrames || 0) + 1; }
const FONT = '"Helvetica Neue","Segoe UI",Roboto,Arial,sans-serif';
function ringG(g, cx, cy, r, f, red, label, val, unit, ticks, tickLbl) { const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, A = a => a0 + (a1 - a0) * a;
  g.lineCap = 'butt'; g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 14; g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke();
  if (red < 1) { g.strokeStyle = 'rgba(220,30,40,.55)'; g.beginPath(); g.arc(cx, cy, r + 10, A(red), a1); g.lineWidth = 3; g.stroke(); }
  const gr = g.createLinearGradient(cx - r, cy, cx + r, cy); gr.addColorStop(0, '#9fb3c8'); gr.addColorStop(1, f > red ? '#ff3b30' : '#ffffff'); g.strokeStyle = gr; g.lineWidth = 14; g.beginPath(); g.arc(cx, cy, r, a0, A(Math.max(0.002, f))); g.stroke();
  g.fillStyle = 'rgba(230,236,242,.75)'; g.font = `300 20px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let k = 0; k <= ticks; k++) { const a = A(k / ticks), c = Math.cos(a), sn = Math.sin(a); g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx + c * (r - 22), cy + sn * (r - 22)); g.lineTo(cx + c * (r - 12), cy + sn * (r - 12)); g.stroke(); g.fillText(tickLbl(k), cx + c * (r - 42), cy + sn * (r - 42)); }
  g.fillStyle = '#fff'; g.font = `200 76px ${FONT}`; g.fillText(val, cx, cy + 6); g.fillStyle = 'rgba(200,210,220,.7)'; g.font = `400 18px ${FONT}`; g.fillText(unit, cx, cy + 56); if (label) g.fillText(label, cx, cy - 52); }
function drawDash(H, s) { const { g, c, t } = H.dash, S = s.S, P = s.P, st = H.st, W = c.width, Hh = c.height;
  const bg = g.createRadialGradient(W / 2, Hh * 0.45, 40, W / 2, Hh / 2, W * 0.6); bg.addColorStop(0, '#121821'); bg.addColorStop(1, '#030405'); g.fillStyle = bg; g.fillRect(0, 0, W, Hh);
  const rf = Math.min(1, S.rpm / P.redline), shift = rf > 0.93, red = (P.redline - 1000) / P.redline;
  ringG(g, 190, 200, 150, rf, red, '', Math.round(S.rpm / 10) * 10 >= 1000 ? (S.rpm / 1000).toFixed(1) : (S.rpm / 1000).toFixed(1), 'x1000 rpm', 7, k => k);
  const mph = Math.round(Math.abs(S.vx) * 2.23694); ringG(g, W - 190, 200, 150, Math.min(1, mph / 220), 2, '', mph, 'mph', 11, k => k * 20);
  const gear = S.reverse || S.gear < 0 ? 'R' : S.gear === 0 ? 'N' : S.gear; g.fillStyle = shift && (s.t % 0.16 < 0.08) ? '#ff3b30' : '#fff'; g.font = `200 150px ${FONT}`; g.textAlign = 'center'; g.fillText(gear, W / 2, 175);
  if (shift) { for (let k = 0; k < 5; k++) { g.fillStyle = k < 3 ? '#ffd60a' : '#ff3b30'; g.beginPath(); g.arc(W / 2 - 80 + k * 40, 42, 9, 0, 7); g.fill(); } }
  g.fillStyle = 'rgba(200,210,220,.8)'; g.font = `500 20px ${FONT}`; g.fillText(MODES[st.mode].toUpperCase(), W / 2, 262);
  const bo = Math.max(0, S.boost || 0) * 1.8; g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(W / 2 - 110, 292, 220, 6); g.fillStyle = '#5ac8fa'; g.fillRect(W / 2 - 110, 292, 220 * Math.min(1, bo / 1.8), 6); g.fillStyle = 'rgba(220,228,236,.85)'; g.font = `300 22px ${FONT}`; g.fillText('BOOST  ' + bo.toFixed(1) + ' bar', W / 2, 326);
  if (st.launch || st.launchT > 0) { g.fillStyle = '#ffd60a'; g.font = `600 20px ${FONT}`; g.fillText(st.launchT > 0 ? 'LAUNCH' : 'LAUNCH CONTROL READY', W / 2, 360); }
  const bl = (s.t % 0.8) < 0.4; g.fillStyle = '#30d158'; g.font = `600 40px ${FONT}`; if (bl && (st.ind === -1 || s.hazard)) g.fillText('◀', 390, 52); if (bl && (st.ind === 1 || s.hazard)) g.fillText('▶', W - 390, 52);
  if (st.lights === 1 || (st.lights === 0 && A_night(s))) { g.fillStyle = '#30d158'; g.font = `600 22px ${FONT}`; g.fillText('◐ LIGHTS', W - 390, 350); }
  t.needsUpdate = true; H.dashDraws = (H.dashDraws || 0) + 1; }
const A_night = s => !!s.app?.gfx?.night;
function drawNav(H, s) { const { g, c, t } = H.nav, W = c.width, Hh = c.height, A = s.app, hud = s.hud || A.hud; g.fillStyle = '#0b0e12'; g.fillRect(0, 0, W, Hh);
  const img = hud?.mapImg, b = hud?.mb, S = hud?.mS; const Q = s.S; const cx = W / 2, cy = Hh * 0.68;
  if (img && b) { const z = 4.4 * H.st.zoom; g.save(); g.filter = 'grayscale(0.85) brightness(1.55) contrast(1.1)'; g.translate(cx, cy); g.rotate(Q.yaw); g.scale(z, z); g.translate(-(Q.x - b[0]) * S, -(Q.z - b[1]) * S); g.drawImage(img, 0, 0); g.filter = 'none'; if (s.route && hud.routeImgs?.[s.route.id]) g.drawImage(hud.routeImgs[s.route.id], 0, 0); g.restore();
    const cs = Math.cos(Q.yaw), sn = Math.sin(Q.yaw), k = S * z; const toScr = (x, zz) => { const dx = (x - Q.x) * k, dy = (zz - Q.z) * k; return [cx + dx * cs - dy * sn, cy + dx * sn + dy * cs]; };
    const nav = s.foot?.nav; H.navRoute = !!nav?.route; g.save(); g.scale(1, 1); try { nav?.drawScreen(g, toScr, Q); } catch (e) { } g.restore();
    const cp = s.cps?.[s.cp]; if (cp) { const [x, y] = toScr(cp[0], cp[1]); g.fillStyle = '#5ac8fa'; g.beginPath(); g.arc(x, y, 10, 0, 7); g.fill(); }
    const vg = g.createLinearGradient(0, 0, 0, Hh); vg.addColorStop(0, 'rgba(11,14,18,.85)'); vg.addColorStop(0.25, 'rgba(11,14,18,0)'); vg.addColorStop(0.8, 'rgba(11,14,18,0)'); vg.addColorStop(1, 'rgba(11,14,18,.9)'); g.fillStyle = vg; g.fillRect(0, 0, W, Hh);
    g.save(); g.translate(cx, cy); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 10; g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -22); g.lineTo(16, 16); g.lineTo(0, 8); g.lineTo(-16, 16); g.closePath(); g.fill(); g.restore(); }
  const d = new Date(); g.fillStyle = 'rgba(235,240,245,.92)'; g.font = `300 30px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(d.toTimeString().slice(0, 5), 28, 38); g.textAlign = 'right'; g.font = `400 22px ${FONT}`; g.fillStyle = 'rgba(200,210,220,.75)'; g.fillText('CUZZY  NAV', W - 28, 38);
  const R = s.foot?.nav?.route; g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = `300 34px ${FONT}`; g.fillText(R ? (R.label || 'Guidance active') : s.isRace ? 'Race route' : 'Tap the map to set a destination', 28, Hh - 46);
  if (R?.len) { g.textAlign = 'right'; g.fillText((R.len / 1609).toFixed(1) + ' mi', W - 28, Hh - 46); }
  g.textAlign = 'right'; g.font = `400 18px ${FONT}`; g.fillStyle = 'rgba(200,210,220,.6)'; g.fillText('×' + H.st.zoom.toFixed(1), W - 28, 74); t.needsUpdate = true; H.navDraws = (H.navDraws || 0) + 1; }
// VR: fingertip / controller press (vr.js), returns the pressed name for haptics
export function heroTouch(s, p, side) { const H = s.obj?.userData?.hero; if (!H || !p) return null; H.touch ||= {}; let best = null, bd = 0.035;
  for (const b of H.btns) { b.getWorldPosition(_w); const d = _w.distanceTo(p); if (d < bd) { bd = d; best = b; } }
  const nm = best?.userData.heroBtn || null; const was = H.touch[side]; H.touch[side] = nm; if (nm && nm !== was) { press(s, nm); return nm; } return null; }
globalThis.CUZZY_HERO = { press, heroTouch }; // tests / console
