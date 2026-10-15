// p54 on-foot weapons: inventory from shop purchases (profile.inv), weapon wheel (keys 1-4 / mouse wheel while aiming /
// hold Tab; phone: weapon button, tap = holster / draw, press + swipe = wheel; gamepad: D-pad right cycles, LB aims,
// RT fires, X reloads), game-style procedurally modelled guns gripped in Shak's right hand (Bip01_R_Hand), draw /
// holster from the right hip, aim pose (arms up via bone aiming), over-the-shoulder aim camera + crosshair, muzzle flash,
// recoil, sound, tracers, impacts / decals, ammo + reload, arcade hit reactions on street walkers (they duck and run)
// and a simple wanted-stars level (session.wanted) for police to read. Unarmed by default: no gun is visible unless
// one is equipped. VR hook: vrHand(side, pos, quat, grip, trigger) — see bottom.
import * as THREE from 'three';
export const WEAPONS = {
  pistol: { n: 'Pistol', icon: '🔫', mag: 12, rof: 0.22, dmg: 1, spread: 0.006, kick: 0.09, reload: 1.3, pellets: 1, range: 70, auto: false },
  smg: { n: 'SMG', icon: '🔫', mag: 30, rof: 0.085, dmg: 1, spread: 0.02, kick: 0.05, reload: 1.7, pellets: 1, range: 60, auto: true },
  shotgun: { n: 'Shotgun', icon: '🔫', mag: 6, rof: 0.8, dmg: 1, spread: 0.07, kick: 0.22, reload: 2.2, pellets: 7, range: 30, auto: false },
};
const ORDER = [null, 'pistol', 'smg', 'shotgun'], AK = 'cuzzy.ammo';
const STD = (c, r = 0.5, m = 0.6) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
// gun models: origin at the grip (where the palm closes), barrel along +Z, up +Y; userData.muzzle = local muzzle point
export function buildGun(kind) {
  const g = new THREE.Group(), steel = STD(0x26282c, 0.35, 0.85), poly = STD(0x141518, 0.75, 0.1), wood = STD(0x5a3418, 0.6, 0), brass = STD(0xb08a3a, 0.4, 0.9);
  const B = (w, h, d, m, x, y, z, rx = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.rotation.x = rx; o.castShadow = true; g.add(o); return o; };
  const C = (r, l, m, x, y, z) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 12), m); o.rotation.x = Math.PI / 2; o.position.set(x, y, z); g.add(o); return o; };
  if (kind === 'pistol') { B(0.03, 0.035, 0.19, steel, 0, 0.07, 0.05); B(0.028, 0.03, 0.17, poly, 0, 0.042, 0.045); B(0.028, 0.11, 0.045, poly, 0, -0.01, -0.012, -0.25); // slide, frame, grip
    B(0.006, 0.012, 0.035, poly, 0, 0.012, 0.035); B(0.004, 0.008, 0.008, steel, 0, 0.092, 0.135); B(0.012, 0.008, 0.006, steel, 0, 0.092, -0.035); C(0.007, 0.01, steel, 0, 0.07, 0.146); g.userData.muzzle = new THREE.Vector3(0, 0.07, 0.155); }
  else if (kind === 'smg') { B(0.04, 0.06, 0.3, poly, 0, 0.055, 0.08); B(0.03, 0.1, 0.045, poly, 0, -0.02, -0.005, -0.2); B(0.026, 0.14, 0.04, steel, 0, -0.03, 0.09, 0.12); // receiver, grip, mag
    C(0.011, 0.12, steel, 0, 0.065, 0.28); B(0.02, 0.025, 0.2, steel, 0, 0.05, -0.15); B(0.012, 0.02, 0.05, steel, 0, 0.095, 0.04); g.userData.muzzle = new THREE.Vector3(0, 0.065, 0.345); g.userData.fore = new THREE.Vector3(0, 0.02, 0.2); }
  else { B(0.045, 0.065, 0.24, steel, 0, 0.05, 0.06); B(0.035, 0.1, 0.05, wood, 0, -0.015, -0.01, -0.25); B(0.04, 0.07, 0.26, wood, 0, 0.03, -0.17, 0.12); // receiver, grip, stock
    C(0.013, 0.5, steel, 0, 0.07, 0.42); C(0.011, 0.4, steel, 0, 0.042, 0.36); C(0.02, 0.15, wood, 0, 0.045, 0.32); B(0.012, 0.012, 0.01, brass, 0, 0.088, 0.66); g.userData.muzzle = new THREE.Vector3(0, 0.07, 0.68); g.userData.fore = new THREE.Vector3(0, 0.03, 0.32); }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; }); return g;
}
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);
// rotate `bone` (in world terms) so the direction to `child` points at `target`, blended by k
function aimBone(bone, child, target, k) { if (!bone || !child || k <= 0) return; bone.updateWorldMatrix(true, true); // works in the parent's frame, so mirrored (negative-scale) Biped arms aim correctly too
  const inv = _m.copy(bone.parent.matrixWorld).invert(), bp = bone.getWorldPosition(_v).applyMatrix4(inv), cur = child.getWorldPosition(_v2).applyMatrix4(inv).sub(bp).normalize(), want = _v3.copy(target).applyMatrix4(inv).sub(bp).normalize();
  _q.setFromUnitVectors(cur, want); _q2.copy(_q).multiply(bone.quaternion); bone.quaternion.slerp(_q2, Math.min(1, k)); bone.updateWorldMatrix(false, true); }

export class Weapons {
  constructor(foot) { this.f = foot; this.s = foot.s; this.cur = null; this.last = 'pistol'; this.aim = false; this.aimK = 0; this.drawT = 0; this.reloadT = 0; this.cool = 0; this.kick = 0; this.decals = []; this.fxl = [];
    try { this.ammo = JSON.parse(localStorage.getItem(AK) || '{}'); } catch (e) { this.ammo = {}; }
    this.wanted = this.s.wanted = this.s.wanted || { level: 0, t: 0, add: n => this.addWanted(n) }; this.ui(); this.keys(); }
  owned() { const I = this.f.inv; return ORDER.filter(k => !k || I[k]); }
  am(k) { const W = WEAPONS[k]; return this.ammo[k] || (this.ammo[k] = { mag: W.mag, res: W.mag * 5 }); }
  saveAmmo() { try { localStorage.setItem(AK, JSON.stringify(this.ammo)); } catch (e) { } }
  restock(k) { if (WEAPONS[k]) { const W = WEAPONS[k]; this.ammo[k] = { mag: W.mag, res: W.mag * 5 }; this.saveAmmo(); } }
  blocked() { return !!this.f.venues.inside || !this.f.active || !!this.f.sit; }
  // ------------------------------------------------------------ select / holster
  equip(k) { if (k && (!this.f.inv[k] || !WEAPONS[k])) return false; if (k && this.blocked()) { this.s.hud?.flash?.('Weapons stay holstered in here', 1.2); return false; }
    if (k === this.cur) return true; this.prev = this.cur; this.cur = k; if (k) this.last = k; this.drawT = 0.45; this.reloadT = 0; this.aim = k ? this.aim : false; this.s.a?.sfx?.('door'); this.click(k ? 900 : 500);
    if (this.gun) { this.gun.removeFromParent(); this.gun = null; } if (k) { this.gun = buildGun(k); this.gun.visible = false; this.s.scene.add(this.gun); }
    this.paint(); this.f.show(); return true; }
  holster() { this.equip(null); }
  cycle(d) { const o = this.owned(); let i = o.indexOf(this.cur); i = (i + d + o.length) % o.length; this.equip(o[i]); }
  // ------------------------------------------------------------ UI: HUD chip, crosshair, wheel, phone buttons, stars
  ui() { const U = this.f.U, mk = (css, html, p = U) => { const e = document.createElement('div'); e.style.cssText = css; e.innerHTML = html; p.appendChild(e); return e; };
    this.chip = mk('position:absolute;right:calc(190px + env(safe-area-inset-right));top:calc(70px + env(safe-area-inset-top));color:#fff;font:800 15px system-ui;text-shadow:0 1px 3px #000;text-align:right;pointer-events:none', '');
    this.stars = mk('position:absolute;right:calc(190px + env(safe-area-inset-right));top:calc(40px + env(safe-area-inset-top));font:900 22px system-ui;letter-spacing:2px;color:#fff;text-shadow:0 0 4px #000;pointer-events:none', '');
    this.xh = mk('position:absolute;left:50%;top:44%;width:34px;height:34px;transform:translate(-50%,-50%);pointer-events:none;display:none', '<svg viewBox="0 0 34 34" width="34" height="34"><g stroke="#fff" stroke-width="2.4" stroke-linecap="round" style="filter:drop-shadow(0 0 1.5px #000)"><line x1="17" y1="3" x2="17" y2="11"/><line x1="17" y1="23" x2="17" y2="31"/><line x1="3" y1="17" x2="11" y2="17"/><line x1="23" y1="17" x2="31" y2="17"/></g><circle cx="17" cy="17" r="1.8" fill="#ff4a3a"/></svg>');
    this.wh = mk('position:absolute;left:50%;top:50%;width:300px;height:300px;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle,rgba(0,0,0,.25) 0 26%,rgba(8,10,14,.82) 27% 100%);border:2px solid rgba(255,255,255,.35);display:none;pointer-events:none;z-index:3', '');
    // phone: weapon button (tap = draw / holster, press + swipe = wheel), AIM toggle, RELOAD
    const BT = 'pointer-events:auto;background:transparent;border:2px solid rgba(255,255,255,.85);color:#fff;font:800 13px system-ui;border-radius:14px;height:50px;min-width:66px;text-shadow:0 1px 3px #000;touch-action:none;display:flex;align-items:center;justify-content:center;padding:0 10px';
    const col = mk('position:absolute;right:calc(130px + env(safe-area-inset-right));bottom:24px;display:flex;flex-direction:column;gap:10px;align-items:flex-end', '');
    this.bW = mk(BT + ';min-width:78px;height:60px', '✋', col); this.bW.id = 'w-btn'; this.bAim = mk(BT, 'AIM', col); this.bAim.id = 'w-aim'; this.bRel = mk(BT, 'RELOAD', col); this.bRel.id = 'w-rel';
    let st = null; this.bW.onpointerdown = e => { e.preventDefault(); st = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; this.bW.setPointerCapture?.(e.pointerId); };
    this.bW.onpointermove = e => { if (!st || e.pointerId !== st.id) return; const dx = e.clientX - st.x, dy = e.clientY - st.y; if (Math.hypot(dx, dy) > 18) { this.openWheel(); this.wheelPick(dx, dy); } };
    this.bW.onpointerup = this.bW.onpointercancel = e => { if (!st) return; st = null; if (this.wheelOn) this.closeWheel(true); else this.equip(this.cur ? null : (this.f.inv[this.last] ? this.last : this.owned()[1] || null)); };
    this.bAim.onpointerdown = e => { e.preventDefault(); if (!this.cur) this.equip(this.f.inv[this.last] ? this.last : this.owned()[1]); this.aim = !!this.cur && !this.aim; this.paint(); };
    this.bRel.onpointerdown = e => { e.preventDefault(); this.reload(); };
    this.paint(); }
  paint() { const o = this.owned(), has = o.length > 1, on = this.f.active, t = this.s.app?.touchUI?.();
    this.bW.style.display = on && has && t ? '' : 'none'; this.bAim.style.display = this.bRel.style.display = on && this.cur && t ? '' : 'none'; this.bAim.style.background = this.aim ? 'rgba(255,90,58,.4)' : 'transparent';
    this.bW.innerHTML = this.cur ? `<span style="font-size:22px">🔫</span>&nbsp;${WEAPONS[this.cur].n.toUpperCase()}` : '✋ UNARMED';
    if (this.cur) { const A = this.am(this.cur); this.chip.innerHTML = `${WEAPONS[this.cur].n}<br><span style="font:900 22px system-ui">${A.mag}</span><span style="opacity:.7"> / ${A.res}</span>${this.reloadT > 0 ? '<br><small>RELOADING…</small>' : ''}`; } else this.chip.innerHTML = has && !t ? '<small style="opacity:.75">1-4 / Tab: weapons</small>' : '';
    const L = this.wanted.level; this.stars.innerHTML = L ? '<span style="color:#ffd23f">' + '★'.repeat(L) + '</span><span style="opacity:.35">' + '★'.repeat(5 - L) + '</span>' : '';
    this.xh.style.display = on && this.cur && this.aim ? '' : 'none'; }
  openWheel() { if (this.wheelOn) return; this.wheelOn = true; this.pick = this.cur; const o = ORDER, w = this.wh; w.innerHTML = ''; w.style.display = '';
    o.forEach((k, i) => { const a = -Math.PI / 2 + i * Math.PI * 2 / o.length, x = 150 + Math.cos(a) * 100, y = 150 + Math.sin(a) * 100, own = !k || this.f.inv[k];
      const d = document.createElement('div'); d.dataset.k = k || ''; d.style.cssText = `position:absolute;left:${x - 46}px;top:${y - 34}px;width:92px;height:68px;border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font:800 13px system-ui;opacity:${own ? 1 : 0.3};border:2px solid transparent`;
      d.innerHTML = `<span style="font-size:24px">${k ? '🔫' : '✋'}</span>${k ? WEAPONS[k].n : 'Unarmed'}${k && own ? `<small style="opacity:.7">${this.am(k).mag}/${this.am(k).res}</small>` : !own ? '<small>not owned</small>' : ''}`; w.appendChild(d); });
    this.hl(); }
  wheelPick(dx, dy) { const n = ORDER.length; let a = Math.atan2(dy, dx) + Math.PI / 2; a = (a + Math.PI * 4) % (Math.PI * 2); const i = Math.round(a / (Math.PI * 2 / n)) % n, k = ORDER[i]; if (!k || this.f.inv[k]) this.pick = k; this.hl(); }
  hl() { for (const d of this.wh.children) { const on = (d.dataset.k || null) === this.pick; d.style.borderColor = on ? '#19e6c1' : 'transparent'; d.style.background = on ? 'rgba(25,230,193,.18)' : 'transparent'; } }
  closeWheel(apply) { if (!this.wheelOn) return; this.wheelOn = false; this.wh.style.display = 'none'; if (apply) this.equip(this.pick); }
  keys() {
    this.onKey = e => { if (!this.f.active || e.target?.closest?.('input,textarea,select')) return; const k = e.key.toLowerCase(), dn = e.type === 'keydown';
      if (k === 'tab') { e.preventDefault(); if (dn && !e.repeat) { this.openWheel(); this.wx = this.wy = 0; } else if (!dn) this.closeWheel(true); return; }
      if (!dn || e.repeat) return; if (k >= '1' && k <= '4') this.equip(ORDER[+k - 1]); else if (k === 'r') this.reload(); else if (k === 'q' || k === 'g') { if (k === 'g') this.equip(this.cur ? null : this.last); else { this.aim = !!this.cur && !this.aim; this.paint(); } } else if (k === ' ' && this.cur && this.aim) { e.preventDefault(); this.trigger(true); } };
    this.onMove = e => { if (this.wheelOn && !this.bWdrag) { this.wx = (this.wx || 0) + e.movementX; this.wy = (this.wy || 0) + e.movementY; if (Math.hypot(this.wx, this.wy) > 12) this.wheelPick(this.wx, this.wy); } };
    this.onDown = e => { if (!this.f.active || e.pointerType === 'touch' || e.target !== this.s.g?.canvas) return; if (e.button === 2) { if (!this.cur) return; this.aim = true; this.paint(); } else if (e.button === 0 && this.cur && this.aim) { this.held = true; this.trigger(true); } };
    this.onUp = e => { if (e.button === 2 && e.pointerType !== 'touch' && this.aim && !this.s.app?.touchUI?.()) { this.aim = false; this.paint(); } if (e.button === 0) this.held = false; };
    this.onWheel = e => { if (this.f.active && (this.aim || this.wheelOn) && this.owned().length > 1) { if (this.wheelOn) { const o = ORDER.filter(k => !k || this.f.inv[k]); let i = o.indexOf(this.pick); this.pick = o[(i + (e.deltaY > 0 ? 1 : -1) + o.length) % o.length]; this.hl(); } else this.cycle(e.deltaY > 0 ? 1 : -1); } };
    this.onCtx = e => { if (this.f.active && e.target === this.s.g?.canvas) e.preventDefault(); };
    addEventListener('keydown', this.onKey); addEventListener('keyup', this.onKey); addEventListener('pointermove', this.onMove); addEventListener('pointerdown', this.onDown); addEventListener('pointerup', this.onUp); addEventListener('wheel', this.onWheel, { passive: true }); addEventListener('contextmenu', this.onCtx); }
  // ------------------------------------------------------------ shooting
  reload() { const k = this.cur; if (!k || this.reloadT > 0) return; const A = this.am(k), W = WEAPONS[k]; if (A.mag >= W.mag || A.res <= 0) { if (A.res <= 0) this.s.hud?.flash?.('No spare ammo — buy more at AMMU-BRUM', 1.4); return; } this.reloadT = W.reload; this.click(300); this.paint(); }
  trigger(manual) { const k = this.cur; if (!k || this.blocked() || this.drawT > 0.05 || this.reloadT > 0 || this.cool > 0) return false; if (!this.aim) { this.aim = true; this.aimHold = 1.2; this.paint(); }
    const A = this.am(k), W = WEAPONS[k]; if (A.mag <= 0) { this.click(1600); this.cool = 0.25; if (A.res > 0) this.reload(); return false; }
    A.mag--; this.cool = W.rof; this.kick = Math.min(1, this.kick + W.kick * 4); this.f.bang(k); this.shots = (this.shots || 0) + 1; this.flashT = 0.06;
    const o = this.muzzle(), cam = this.s.g.cam, dir = this.aimDir(new THREE.Vector3()); let hitPed = false;
    for (let i = 0; i < W.pellets; i++) { const d = dir.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2 * W.spread, (Math.random() - 0.5) * 2 * W.spread, (Math.random() - 0.5) * 2 * W.spread)).normalize(); const h = this.cast(cam.position, d, W.range);
      this.tracer(o, h.p); if (h.ped) { hitPed = true; this.hitPed(h.ped, d); } else this.impact(h.p, h.n); }
    this.crime(hitPed ? 2 : 1); this.paint(); if (A.mag === 0 && A.res > 0) setTimeout(() => this.reload(), 250); this.saveAmmo(); return true; }
  aimDir(out) { const cam = this.s.g.cam; return cam.getWorldDirection(out); }
  // ray from the camera: street walkers (sphere test), walls (wallCross), then the ground
  cast(o, d, R) { const L = this.s.app?.streetlife, peds = L?.pedList || []; let best = R, ped = null, n = null;
    for (const p of peds) { if (!p.S) continue; const px = p.x - o.x, pz = p.z - o.z, t = px * d.x + pz * d.z; if (t < 1 || t > best) continue; const qx = o.x + d.x * t - p.x, qz = o.z + d.z * t - p.z, y = o.y + d.y * t - (this.f.p.y + 0.9);
      if (qx * qx + qz * qz < 0.16 && Math.abs(y) < 1) { best = t; ped = p; } }
    if (!ped) { const W = this.s.w, ex = o.x + d.x * best, ez = o.z + d.z * best; const w = !this.f.venues.inside && W?.wallCross?.(o.x, o.z, ex, ez, this.f.p.y); if (w && w.t > 0.01) { best *= w.t; n = new THREE.Vector3(-d.x, 0, -d.z).normalize(); }
      if (d.y < -0.002) { const gy = this.f.p.y + 0.02, tg = (gy - o.y) / d.y; if (tg > 0 && tg < best) { best = tg; n = UP.clone(); } } }
    return { p: o.clone().addScaledVector(d, best), n, ped }; }
  hitPed(p, d) { // arcade reaction: the walker flinches, turns and runs away fast; no gore
    p.scared = 6; p.sp0 = p.sp0 || p.sp; p.sp = p.sp0 * 3.2; p.dir = -p.dir; this.spark(new THREE.Vector3(p.x, this.f.p.y + 1.1, p.z), 0xffffff, 0.25); this.hits = (this.hits || 0) + 1; this.s.hud?.flash?.('Hit!', 0.4); }
  crime(n) { const now = performance.now(); if (now - (this.crimeT || 0) > 5000 || n > 1) { this.addWanted(n > 1 ? 1 : this.wanted.level ? 0 : 1); this.crimeT = now; } this.wanted.t = 0; }
  addWanted(n) { const W = this.wanted; W.level = Math.max(0, Math.min(5, W.level + n)); W.t = 0; if (n > 0) this.s.hud?.flash?.('WANTED ' + '★'.repeat(W.level), 1); this.paint(); }
  muzzle() { if (!this.gun) return this.f.p.clone().add(new THREE.Vector3(0, 1.4, 0)); this.gun.updateMatrixWorld(true); return this.gun.userData.muzzle.clone().applyMatrix4(this.gun.matrixWorld); }
  tracer(a, b) { const len = a.distanceTo(b); if (len < 0.1) return; const m = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, len), new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.95, toneMapped: false, depthWrite: false })); m.position.copy(a).add(b).multiplyScalar(0.5); m.lookAt(b); this.s.scene.add(m); this.fxl.push({ o: m, t: 0, life: 0.07 }); }
  impact(p, n) { if (!n) return; this.spark(p, 0xffc470, 0.18);
    const d = new THREE.Mesh(new THREE.CircleGeometry(0.045, 10), new THREE.MeshBasicMaterial({ color: 0x15130f, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 })); d.position.copy(p).addScaledVector(n, 0.012); d.lookAt(_v.copy(d.position).add(n)); this.s.scene.add(d); this.decals.push(d);
    if (this.decals.length > 40) { const o = this.decals.shift(); o.removeFromParent(); o.geometry.dispose(); o.material.dispose(); } }
  spark(p, c, s) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); sp.position.copy(p); sp.scale.setScalar(s); this.s.scene.add(sp); this.fxl.push({ o: sp, t: 0, life: 0.12, grow: s * 6 }); }
  click(f) { try { const A = this.f.ac || (this.f.ac = new (window.AudioContext || window.webkitAudioContext)()), o = A.createOscillator(), g = A.createGain(); o.type = 'square'; o.frequency.value = f; g.gain.setValueAtTime(0.08, A.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, A.currentTime + 0.05); o.connect(g).connect(A.destination); o.start(); o.stop(A.currentTime + 0.06); } catch (e) { } }
  flashMesh() { if (this.fl) return this.fl; const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(0.3, 'rgba(255,200,90,.9)'); gr.addColorStop(1, 'rgba(255,120,20,0)'); x.fillStyle = gr; x.beginPath(); for (let i = 0; i < 16; i++) { const a = i / 16 * 6.283, r = i % 2 ? 12 : 32; x.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); } x.fill();
    this.fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); this.fl.visible = false; this.s.scene.add(this.fl); return this.fl; }
  // ------------------------------------------------------------ per frame (after the character's animation)
  step(dt) { const f = this.f, ch = f.char; if (!f.active) { if (this.gun) this.gun.visible = false; if (this.fl) this.fl.visible = false; this.xh.style.display = 'none'; return; }
    if (this.cur && f.venues.inside) this.holster();
    const W = this.wanted; W.t += dt; if (W.level && W.t > 30) { W.level--; W.t = 18; this.paint(); }
    this.cool = Math.max(0, this.cool - dt); this.kick = Math.max(0, this.kick - dt * 6);
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) { const A = this.am(this.cur), Wp = WEAPONS[this.cur], n = Math.min(Wp.mag - A.mag, A.res); A.mag += n; A.res -= n; this.saveAmmo(); this.click(700); } this.paint(); }
    if (this.aimHold > 0) { this.aimHold -= dt; if (this.aimHold <= 0 && this.aim && !this.held) { this.aim = false; this.paint(); } }
    if (this.held && this.cur && WEAPONS[this.cur].auto) this.trigger(); { const gp = navigator.getGamepads?.()?.find(g => g && g.mapping === 'standard'); if (gp) { const b = gp.buttons.map(x => x.pressed), pb = this.gpb || [];
        if (b[15] && !pb[15]) this.cycle(1); if (b[14] && !pb[14]) this.cycle(-1); if (b[2] && !pb[2]) this.reload(); if (this.cur) { if (b[4] !== pb[4]) { this.aim = b[4]; this.paint(); } if (b[7] && (!pb[7] || WEAPONS[this.cur].auto)) this.trigger(); } this.gpb = b; } }
    for (let i = this.fxl.length - 1; i >= 0; i--) { const e = this.fxl[i]; e.t += dt; const k = e.t / e.life; e.o.material.opacity = Math.max(0, 1 - k); if (e.grow) e.o.scale.setScalar(e.o.scale.x + e.grow * dt); if (k >= 1) { e.o.removeFromParent(); e.o.geometry?.dispose(); e.o.material.dispose(); this.fxl.splice(i, 1); } }
    for (const p of this.s.app?.streetlife?.pedList || []) if (p.scared > 0) { p.scared -= dt; if (p.scared <= 0) p.sp = p.sp0; }
    const draw = this.drawT > 0 ? (this.drawT -= dt, 1 - Math.max(0, this.drawT) / 0.45) : 1; // 0 -> 1 through the draw / holster move
    const aiming = !!this.cur && this.aim && draw > 0.6 && this.reloadT <= 0; this.aimK += ((aiming ? 1 : 0) - this.aimK) * Math.min(1, 14 * dt);
    if (aiming || this.aimK > 0.5) { const d = f.cy - f.yaw; f.yaw += Math.atan2(Math.sin(d), Math.cos(d)) * Math.min(1, 16 * dt); ch.rotation.y = f.yaw; } // face where the camera aims
    if (!ch) return; ch.updateMatrixWorld(true); const R = ch.userData.rig || (ch.userData.rig = this.rig(ch)); const P = ch.userData.person;
    const fwd = new THREE.Vector3(-Math.sin(f.yaw), 0, -Math.cos(f.yaw)), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const tgt = this.s.g.cam.position.clone().addScaledVector(this.aimDir(new THREE.Vector3()), 40);
    if (R) { const hip = ch.localToWorld(new THREE.Vector3(0, 0.95, 0)).addScaledVector(right, 0.28).addScaledVector(fwd, 0.05);
      if (this.cur && draw < 1) { const k = Math.sin(draw * Math.PI); aimBone(R.ru, R.rf, hip, k * 0.8); aimBone(R.rf, R.rh, hip, k * 0.8); } // reach down to the hip holster and back
      if (this.reloadT > 0) { const c = ch.localToWorld(new THREE.Vector3(0, 1.15, 0)).addScaledVector(fwd, 0.35); aimBone(R.ru, R.rf, c, 0.8); aimBone(R.rf, R.rh, c, 0.8); aimBone(R.lu, R.lf, c, 0.7); aimBone(R.lf, R.lh, c.clone().addScaledVector(right, -0.05).add(new THREE.Vector3(0, -0.12, 0)), 0.8); }
      else if (this.aimK > 0.01) { this.square(R, right, this.aimK); const k = this.aimK, kick = this.kick * 0.35; const t2 = tgt.clone().add(new THREE.Vector3(0, kick * 4, 0)); aimBone(R.ru, R.rf, t2, k); aimBone(R.rf, R.rh, t2, k);
        if (R.lu) { const sup = R.rh.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, this.cur === 'pistol' ? 0.02 : 0.22).addScaledVector(right, this.cur === 'pistol' ? -0.04 : 0); aimBone(R.lu, R.lf, sup, k * 0.9); aimBone(R.lf, R.lh, sup, k * 0.9); } }
      else if (this.cur) { const low = ch.localToWorld(new THREE.Vector3(0, 0.75, 0)).addScaledVector(right, 0.32).addScaledVector(fwd, 0.55); aimBone(R.rf, R.rh, low, 0.45); } } // relaxed carry: forearm a little forward
    // gun in the right hand: grip at the hand bone (palm offset), barrel along the aim / carry direction
    const G = this.gun; if (!G) return; const show = !!this.cur && draw > 0.5; G.visible = show; if (!show) return;
    const hand = R ? R.rh.getWorldPosition(new THREE.Vector3()) : P.aR.localToWorld(new THREE.Vector3(0, -0.6, 0)); const handFwd = R ? R.rh.localToWorld(new THREE.Vector3(1, 0, 0)).sub(R.rh.getWorldPosition(_v3)).normalize() : fwd;
    G.position.copy(hand).addScaledVector(handFwd, 0.05).add(_v2.set(0, -0.01, 0));
    let dir; if (this.aimK > 0.3 && this.reloadT <= 0) dir = tgt.clone().sub(G.position).normalize(); else dir = fwd.clone().multiplyScalar(0.55).add(new THREE.Vector3(0, -0.8, 0)).normalize();
    dir.y += this.kick * 0.4; dir.normalize(); G.lookAt(_v2.copy(G.position).add(dir)); G.position.addScaledVector(dir, -this.kick * 0.06);
    const fl = this.flashMesh(); if (this.flashT > 0) { this.flashT -= dt; fl.visible = true; fl.position.copy(this.muzzle()).addScaledVector(dir, 0.06); fl.scale.setScalar(this.cur === 'shotgun' ? 0.5 : 0.32); fl.material.rotation = Math.random() * 6; } else fl.visible = false; }
  // square the shoulders to the aim (the scan's idle stands bladed ~50 degrees): twist the spine about world up
  square(R, right, k) { const sp = R.sp; if (!sp || !R.lu) return; sp.updateWorldMatrix(true, true); const a = R.lu.getWorldPosition(new THREE.Vector3()).sub(R.ru.getWorldPosition(new THREE.Vector3())); // right -> left shoulder
    const want = right.clone().negate(), d = Math.atan2(a.x, a.z) - Math.atan2(want.x, want.z), ang = Math.atan2(Math.sin(d), Math.cos(d)) * -1;
    const wq = sp.getWorldQuaternion(new THREE.Quaternion()), nq = new THREE.Quaternion().setFromAxisAngle(UP, ang * k).multiply(wq), pq = sp.parent.getWorldQuaternion(new THREE.Quaternion()).invert(); sp.quaternion.copy(pq.multiply(nq)); sp.updateWorldMatrix(false, true); }
  rig(ch) { const n = s => ch.getObjectByName('Bip01_' + s); const rh = n('R_Hand'); if (!rh) return null; return { sp: n('Spine2') || n('Spine1'), ru: n('R_UpperArm'), rf: n('R_Forearm'), rh, lu: n('L_UpperArm'), lf: n('L_Forearm'), lh: n('L_Hand') }; }
  // over-the-shoulder aim camera (called from OnFoot.cam); returns true when it placed the camera
  cam(dt, cam, Lk) { this.camK = (this.camK || 0) + (((this.aimK > 0.2) ? 1 : 0) - (this.camK || 0)) * Math.min(1, 8 * dt); if (this.camK < 0.02) return false; const f = this.f, p = f.p, k = this.camK, yv = f.cy + Lk.yaw, pitch = Math.max(-0.6, Math.min(0.6, -Lk.pitch * 0.9));
    const back = new THREE.Vector3(Math.sin(yv), 0, Math.cos(yv)), right = new THREE.Vector3(-back.z, 0, back.x).multiplyScalar(-1);
    const want = new THREE.Vector3(p.x, p.y + 1.62, p.z).addScaledVector(back, 1.55).addScaledVector(right, 0.55), look = new THREE.Vector3(p.x, p.y + 1.55, p.z).addScaledVector(back, -12).addScaledVector(right, 0.55); look.y += Math.tan(pitch) * 12 + this.kick * 0.15;
    cam.position.lerp(want, k); const L0 = new THREE.Vector3(p.x, p.y + 1.45, p.z).lerp(look, k); cam.lookAt(L0); const fov = 60 - 10 * k; if (Math.abs(cam.fov - fov) > 0.1) { cam.fov = fov; cam.updateProjectionMatrix(); } return true; }
  // VR hook (vr.js does not call this yet): per controller each frame on foot, world pose + grip / trigger state.
  // Squeeze grip with the hand near the right hip to draw; release grip to holster; trigger fires along the controller.
  vrHand(side, pos, quat, grip, trig) { if (side !== 'right' || !this.f.active) return; const hip = this.f.p.clone().add(new THREE.Vector3(0, 0.95, 0));
    if (grip && !this.cur && pos.distanceTo(hip) < 0.35) this.equip(this.f.inv[this.last] ? this.last : this.owned()[1]); if (!grip && this.cur) this.holster();
    if (this.cur && this.gun) { this.vrPose = { pos, quat }; if (trig && !this.vrTrig) this.trigger(); } this.vrTrig = trig; }
  dispose() { removeEventListener('keydown', this.onKey); removeEventListener('keyup', this.onKey); removeEventListener('pointermove', this.onMove); removeEventListener('pointerdown', this.onDown); removeEventListener('pointerup', this.onUp); removeEventListener('wheel', this.onWheel); removeEventListener('contextmenu', this.onCtx);
    this.gun?.removeFromParent(); this.fl?.removeFromParent(); for (const d of this.decals) d.removeFromParent(); for (const e of this.fxl) e.o.removeFromParent(); }
}
