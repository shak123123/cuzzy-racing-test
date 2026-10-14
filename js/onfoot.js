import { standardPad } from './wheel.js';
// GTA-style on-foot play for free roam / open world / car meets: get out of the car (it parks where you leave it),
// walk or run as Shak, walk into the cinema, club, gun shop, food shops and mosques, buy things with credits, watch
// YouTube films on the cinema screen, and set waypoints on a full city map that also shows every online player.
import { Nav } from './nav.js';
import * as THREE from 'three';
import { buildPerson, animPerson } from './person.js';
import { Venues, BASE_Y, ICON, SHOP, FILMS, ytId } from './venues.js';
const $ = s => document.querySelector(s);
const el = (tag, css, html, parent = document.body) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (html != null) e.innerHTML = html; parent.appendChild(e); return e; };
const BTN = 'pointer-events:auto;background:transparent;border:2px solid rgba(255,255,255,.85);color:#fff;font:800 14px system-ui,Arial;border-radius:14px;padding:0 14px;min-width:74px;height:54px;text-shadow:0 1px 3px #000;touch-action:none;';

export class OnFoot {
  constructor(sess) {
    this.s = sess; this.active = false; this.p = new THREE.Vector3(); this.yaw = 0; this.v = 0; this.cy = 0; this.q = { x: 0, z: 0, yaw: 0 };
    this.joy = { x: 0, y: 0, id: null }; this.boostT = 0; this.venues = new Venues(sess); this.nav = new Nav(sess); this.wp = null; this.ui();
  }
  get inv() { return this.s.app.store?.profile?.inv || {}; }
  ui() {
    const U = this.U = el('div', 'position:fixed;inset:0;pointer-events:none;z-index:6;display:none', '');
    const base = this.jb = el('div', 'position:absolute;left:calc(26px + env(safe-area-inset-left));bottom:26px;width:150px;height:150px;border-radius:50%;border:2px solid rgba(255,255,255,.7);pointer-events:auto;touch-action:none', '', U);
    this.jk = el('div', 'position:absolute;left:47px;top:47px;width:56px;height:56px;border-radius:50%;border:2px solid #fff;background:transparent', '', base);
    const right = el('div', 'position:absolute;right:calc(22px + env(safe-area-inset-right));bottom:24px;display:flex;flex-direction:column;gap:10px;align-items:flex-end', '', U);
    this.bAct = el('button', BTN + 'min-width:120px;height:64px', 'GET IN', right); this.bFire = el('button', BTN, 'FIRE', right); this.bRun = el('button', BTN, 'RUN', right);
    this.bAct.onpointerdown = e => { e.preventDefault(); this.action(); }; this.bFire.onpointerdown = e => { e.preventDefault(); this.fire(); };
    this.bRun.onpointerdown = e => { e.preventDefault(); this.run = !this.run; this.bRun.style.background = this.run ? 'rgba(25,230,193,.35)' : 'transparent'; };
    const jmove = e => { const r = base.getBoundingClientRect(); let x = (e.clientX - r.left - 75) / 60, y = (e.clientY - r.top - 75) / 60; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; } this.joy.x = x; this.joy.y = y; this.jk.style.transform = `translate(${x * 48}px,${y * 48}px)`; };
    base.onpointerdown = e => { e.preventDefault(); this.joy.id = e.pointerId; base.setPointerCapture?.(e.pointerId); jmove(e); };
    base.onpointermove = e => { if (e.pointerId === this.joy.id) jmove(e); };
    base.onpointerup = base.onpointercancel = e => { if (e.pointerId !== this.joy.id) return; this.joy.id = null; this.joy.x = this.joy.y = 0; this.jk.style.transform = ''; };
    // in-car buttons: GET OUT, and MAP for both
    const aux = $('.tc.aux'); this.bOut = $('#h-out') || el('button', '', 'GET OUT', aux || document.body); this.bOut.id = 'h-out'; this.bOut.className = 'tb small util'; this.bOut.hidden = true;
    this.bOut.onpointerdown = e => { e.preventDefault(); this.exitCar(); };
    this.bMap = el('button', BTN + 'position:fixed;top:calc(8px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);height:40px;min-width:64px;z-index:7;background:transparent', 'MAP'); this.bMap.onpointerdown = e => { e.preventDefault(); this.openMap(); };
    this.hint = el('div', 'position:fixed;left:50%;top:22%;transform:translateX(-50%);color:#fff;font:700 15px system-ui;text-shadow:0 1px 4px #000;pointer-events:none;z-index:6;text-align:center;display:none', '');
    this.fade = el('div', 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .35s;z-index:8', '');
    this.onKey = e => { if (e.target?.closest?.('input,textarea,select') || e.repeat) return; const k = e.key.toLowerCase();
      if (k === 'f' && e.type === 'keydown') { if (this.active) this.action(); else this.exitCar(); } if ((k === 'm' || k === 'n') && e.type === 'keydown') this.openMap(); if (k === 'shift') this.shift = e.type === 'keydown'; };
    addEventListener('keydown', this.onKey); addEventListener('keyup', this.onKey);
  }
  allowed() { const s = this.s; return !s.isRace && !s.o.worldRace && s.state !== 'countdown' && !s.hover; }
  // ---------------------------------------------------------------- car <-> foot
  exitCar() { const s = this.s, S = s.S; if (this.active || !this.allowed()) return; if (Math.abs(S.vx) > 3) { s.hud.flash('Stop the car first', 1.2); return; }
    if (!this.char) { this.char = buildPerson('shak'); s.scene.add(this.char); }
    const side = s.car?.lhd ? -1 : 1, rx = Math.cos(S.yaw), rz = -Math.sin(S.yaw), off = (s.obj.userData.dims?.W || 1.9) / 2 + 0.55; // UK cars: driver's door on the right
    this.p.set(S.x + rx * off * side, S.y, S.z + rz * off * side); this.yaw = S.yaw; this.cy = S.yaw; this.v = 0; this.char.visible = true; this.active = true;
    this.savedCam = s.camMode; if (s.camMode !== 'chase') s.camMode = 'chase'; /* any car view (inside, bonnet, orbit) -> on-foot chase cam, so drag-to-look works */ this.show(); s.a?.sfx?.('door');
  }
  enterCar() { const s = this.s; this.active = false; this.char.visible = false; if (this.savedCam) s.camMode = this.savedCam; this.show(); }
  show() { const on = this.active; this.U.style.display = on ? '' : 'none'; const t = $('#touch'); if (t) t.style.visibility = on ? 'hidden' : ''; const sp = $('.h-speedo'); if (sp) sp.style.visibility = on ? 'hidden' : '';
    this.bFire.style.display = on && this.weapon() && !this.venues.inside?.info?.noWeapons ? '' : 'none'; if (!on) this.hint.style.display = 'none'; }
  weapon() { const I = this.inv; return ['smg', 'shotgun', 'pistol'].find(k => I[k]) || null; }
  // ---------------------------------------------------------------- per frame
  carInput(inp) { if (!this.active) return; inp.throttle = 0; inp.brake = 1; inp.handbrake = 1; inp.steer = 0; }
  step(dt) {
    const s = this.s; this.venues.step(dt); this.bOut.hidden = this.active || !this.allowed() || !!s.paused;
    if (this.wp && Math.hypot(this.q.x - this.wp.x, this.q.z - this.wp.z) < 14) { s.hud.flash('Arrived: ' + this.wp.name, 1.6); this.setWp(null); }
    try { this.nav.step(dt, this.q); } catch (e) { }
    if (!this.active) { this.q.x = s.S.x; this.q.z = s.S.z; this.q.yaw = s.S.yaw; return; }
    if (this.boostT > 0) this.boostT -= dt;
    const K = s.keys; let ix = this.joy.x, iy = this.joy.y; if (K.has('w') || K.has('arrowup')) iy = -1; if (K.has('s') || K.has('arrowdown')) iy = 1; if (K.has('a') || K.has('arrowleft')) ix = -1; if (K.has('d') || K.has('arrowright')) ix = 1;
    { const gp = standardPad(); if (gp && this.active) { const gx = gp.axes[0] || 0, gy = gp.axes[1] || 0; if (Math.hypot(gx, gy) > 0.15) { ix = gx; iy = gy; } /* controller: left stick walks (push fully to run) */
        const b = gp.buttons.map(x => x.pressed), pb = this.gpPrev || []; if (!s.paused) { if (b[0] && !pb[0]) this.action(); if (b[13] && !pb[13]) this.openMap(); } this.gpPrev = b; } }
    const mag = Math.min(1, Math.hypot(ix, iy)), sitting = !!this.sit; let want = 0;
    if (mag > 0.12 && !sitting && !s.paused) { const a = this.cy + Math.atan2(-ix, -iy); // stick direction relative to the camera
      let d = a - this.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; this.yaw += d * Math.min(1, 12 * dt);
      want = (this.run || this.shift || mag > 0.92 ? 5.6 : 1.7 * Math.max(0.5, mag / 0.92)) * (this.boostT > 0 ? 1.25 : 1); }
    this.v += (want - this.v) * Math.min(1, 9 * dt);
    if (this.v > 0.02) { const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), I = this.venues.inside; let nx = this.p.x + fx * this.v * dt, nz = this.p.z + fz * this.v * dt;
      if (I) { const [bx, bz] = I.bounds; nx = Math.max(-bx, Math.min(bx, nx)); nz = Math.max(-bz, Math.min(bz, nz)); this.p.set(nx, BASE_Y, nz); }
      else { const W = s.w, h = W.groundAt(nx, nz, this.p.y).h ?? this.p.y, c = W.collide(nx, nz, 0.32, h); if (c) { nx += c.px; nz += c.pz; }
        const cd = Math.hypot(nx - s.S.x, nz - s.S.z); if (cd < 1.2) { nx = s.S.x + (nx - s.S.x) / cd * 1.2; nz = s.S.z + (nz - s.S.z) / cd * 1.2; } // the parked car is solid
        this.p.set(nx, this.p.y + (h - this.p.y) * Math.min(1, 10 * dt), nz); } }
    const I = this.venues.inside; if (!I && !this.v) { const h = s.w.groundAt(this.p.x, this.p.z, this.p.y).h; if (h != null) this.p.y += (h - this.p.y) * Math.min(1, 10 * dt); }
    const ch = this.char; ch.visible = !this.sit; /* seated: first-person view of the screen */ if (this.sit) { ch.position.set(this.sit.x, BASE_Y + this.sit.y - 0.48, this.sit.z); ch.rotation.y = 0; animPerson(ch, dt, 0, 'sit'); }
    else { ch.position.copy(this.p); ch.rotation.y = this.yaw; animPerson(ch, dt, this.v); }
    if (I) { this.q.x = I.v.x; this.q.z = I.v.z; } else { this.q.x = this.p.x; this.q.z = this.p.z; } this.q.yaw = this.yaw;
    // context action
    let label = '', H = ''; this.ctx = null;
    if (I) { for (const sp of I.spots) if (Math.hypot(this.p.x - sp.x, this.p.z - sp.z) < sp.r) { this.ctx = sp; label = this.sit && sp.act === 'watch' ? 'STAND UP' : sp.label; } if (this.sit) { this.ctx = I.spots.find(x => x.act === 'watch'); label = 'STAND UP'; } }
    else { const v = this.venues.near(this.p); if (v) { this.ctx = { act: 'enter', v }; label = 'ENTER'; H = `${ICON[v.kind]} ${v.name}`; }
      else if (Math.hypot(this.p.x - s.S.x, this.p.z - s.S.z) < 3.2) { this.ctx = { act: 'car' }; label = 'GET IN'; } }
    this.bAct.textContent = label || '—'; this.bAct.style.opacity = label ? 1 : 0.35; this.hint.style.display = H ? '' : 'none'; if (H) this.hint.textContent = H + (s.app.touchUI() ? '' : '  ·  press F');
    this.fx?.(dt);
  }
  cam(dt) { if (!this.active) return; const cam = this.s.g.cam;
    if (this.sit) { const p = this.char.position; cam.position.set(p.x, p.y + 1.2, p.z); cam.lookAt(p.x, BASE_Y + 4.6, p.z - 20); cam.fov = 55; cam.updateProjectionMatrix(); return; }
    const L0 = this.s.look; if (L0 && L0.yaw) { this.cy += L0.yaw; L0.yaw = 0; L0.rel = performance.now(); } /* 360 on foot: dragging turns the camera for good, and the stick walks where the camera faces */
    let d = this.yaw - this.cy; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; if (this.v > 0.3 && !(L0 && L0.held) && performance.now() - (L0?.rel || 0) > 1500) this.cy += d * Math.min(1, 0.9 * dt);
    const Lk = this.s.lookStep(dt, this.v > 0.3), Z = Lk.zoom || 1, yv = this.cy + Lk.yaw, inside = !!this.venues.inside, dist = (inside ? 2.6 : 3.4) * Z * (1 - Lk.pitch * 0.2), hgt = 1.45 + ((inside ? 1.75 : 2.0) - 1.45) * Math.min(1.6, Z) + Lk.pitch * 2.2 * Math.min(1.4, Z), p = this.p; /* drag: 360 look; pinch / wheel: zoom */ /* drag to look all round; swings back behind */
    let cx = p.x + Math.sin(yv) * dist, cz = p.z + Math.cos(yv) * dist; if (inside) { const [bx, bz] = this.venues.inside.bounds; cx = Math.max(-bx, Math.min(bx, cx)); cz = Math.max(-bz, Math.min(bz, cz)); } /* camera stays inside the room */
    if (!inside) { const w = this.s.w.wallCross(p.x, p.z, cx, cz, p.y); const want = w ? Math.max(0.2, w.t - 0.1) : 1; this._pull = want < (this._pull ?? 1) ? want : (this._pull ?? 1) + (want - (this._pull ?? 1)) * Math.min(1, 3 * dt); cx = p.x + (cx - p.x) * this._pull; cz = p.z + (cz - p.z) * this._pull; } /* p51: on-foot camera never inside a wall */
    cam.position.set(cx, p.y + hgt, cz); cam.lookAt(p.x, p.y + 1.45, p.z); if (Math.abs(cam.fov - 60) > 0.1) { cam.fov = 60; cam.updateProjectionMatrix(); } }
  // ---------------------------------------------------------------- actions
  action() { const c = this.ctx; if (!c) return; const s = this.s;
    if (c.act === 'car') this.enterCar();
    else if (c.act === 'enter') this.goIn(c.v);
    else if (c.act === 'leave') this.goOut();
    else if (c.act === 'shop') this.shop(c.shop);
    else if (c.act === 'watch') { if (this.sit) { this.sit = null; this.venues.inside.play?.(null); } else this.films(c); } }
  async blink(fn) { this.fade.style.opacity = 1; await new Promise(r => setTimeout(r, 360)); fn(); this.fade.style.opacity = 0; }
  goIn(v) { this.blink(() => { const I = this.venues.enter(v); this.p.set(I.entry.x, BASE_Y, I.entry.z - 2.2); /* a couple of steps in, so the camera has room behind */ this.yaw = this.cy = 0; this.v = 0;
      this.s.hud.flash(I.info?.msg || v.name, 2.2); this.show(); }); }
  goOut() { this.blink(() => { const v = this.venues.inside?.v; this.sit = null; this.venues.leave();
      if (v) { this.p.set(v.x + Math.sin(v.yaw) * 1.6, v.y, v.z + Math.cos(v.yaw) * 1.6); this.yaw = this.cy = v.yaw + Math.PI; } this.show(); }); }
  menu(title, rows) { this.closeMenu(); const m = this.M = el('div', 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(420px,92vw);max-height:80vh;overflow:auto;background:rgba(10,12,16,.94);border:1px solid rgba(255,255,255,.18);border-radius:16px;padding:16px;color:#fff;font:15px system-ui;z-index:9', `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><b style="font-size:18px">${title}</b><button data-x style="${BTN}height:36px;min-width:44px">✕</button></div>`);
    m.querySelector('[data-x]').onclick = () => this.closeMenu(); for (const r of rows) m.appendChild(r); return m; }
  closeMenu() { this.M?.remove(); this.M = null; }
  row(text, btn, fn) { const r = document.createElement('div'); r.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-top:1px solid rgba(255,255,255,.08)'; r.innerHTML = `<span>${text}</span>`;
    const b = document.createElement('button'); b.style.cssText = BTN + 'height:38px'; b.textContent = btn; b.onclick = () => fn(b); r.appendChild(b); return r; }
  shop(kind) { const st = this.s.app.store, cr = () => (st?.profile?.credits ?? 0).toLocaleString();
    const head = document.createElement('div'); head.style.cssText = 'opacity:.8;margin-bottom:4px'; head.textContent = `You have ${cr()} credits`;
    const rows = SHOP[kind].map(([id, n, price]) => this.row(`${n}${this.inv[id] && kind === 'guns' ? ' <small style="color:#19e6c1">owned</small>' : ''}`, `${price} cr`, async b => {
      b.disabled = true; try { const j = await st.act('shop', { item: id }); head.textContent = `Bought ${n}. You have ${cr()} credits`; this.s.a?.sfx?.('buy');
        if (kind === 'food' || kind === 'club' || kind === 'cinema') { this.boostT = 120; this.s.hud.flash(kind === 'food' ? 'Fed — you run faster for 2 minutes' : 'Enjoy', 1.6); } this.show(); }
      catch (e) { head.textContent = e.message || 'Could not buy that'; } b.disabled = false; }));
    if (kind === 'guns') rows.push(Object.assign(document.createElement('small'), { textContent: 'Weapons fire in open world streets (not inside venues or mosques). Other players are not harmed yet.', style: 'opacity:.6' }));
    this.menu({ guns: 'AMMU-BRUM', food: 'Order food', club: 'Bar', cinema: 'Snacks' }[kind], [head, ...rows]); }
  films(spot) { const I = this.venues.inside, go = id => { this.closeMenu(); this.sit = spot.sit; I.play(id); this.s.hud.flash('Enjoy the film — tap STAND UP to leave your seat', 2); };
    const rows = FILMS.map(([n, id]) => this.row(n, 'WATCH', () => go(id)));
    const f = document.createElement('div'); f.style.cssText = 'display:flex;gap:8px;margin-top:10px'; f.innerHTML = `<input placeholder="Paste a YouTube link" style="flex:1;min-width:0;background:#111;border:1px solid #444;color:#fff;border-radius:10px;padding:10px">`;
    const b = document.createElement('button'); b.style.cssText = BTN + 'height:40px'; b.textContent = 'PLAY'; b.onclick = () => { const id = ytId(f.firstChild.value); if (id) go(id); else f.firstChild.style.borderColor = '#ff5a4a'; }; f.appendChild(b);
    this.menu('Now showing', [...rows, f]); }
  fire() { const s = this.s, w = this.weapon(); if (!w || this.venues.inside?.info?.noWeapons || this.venues.inside) return; const now = performance.now(); if (now - (this.lastShot || 0) < (w === 'smg' ? 90 : w === 'shotgun' ? 700 : 260)) return; this.lastShot = now;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), o = new THREE.Vector3(this.p.x + fx * 0.6, this.p.y + 1.35, this.p.z + fz * 0.6), e = o.clone().add(new THREE.Vector3(fx * 60, 0, fz * 60));
    const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints([o, e]), new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 1, toneMapped: false })), fl = new THREE.PointLight(0xffc060, 8, 6); fl.position.copy(o);
    s.scene.add(ln, fl); let t = 0; const prev = this.fx; this.fx = dt => { prev?.(dt); t += dt; ln.material.opacity = Math.max(0, 1 - t * 10); fl.intensity = Math.max(0, 8 - t * 120); if (t > 0.12 && ln.parent) { s.scene.remove(ln, fl); ln.geometry.dispose(); ln.material.dispose(); } };
    setTimeout(() => { this.fx = null; }, 400); this.bang(w); }
  bang(w) { try { const A = this.ac || (this.ac = new (window.AudioContext || window.webkitAudioContext)()), n = A.sampleRate * 0.25, b = A.createBuffer(1, n, A.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (A.sampleRate * (w === 'shotgun' ? 0.07 : 0.03))); const src = A.createBufferSource(), f = A.createBiquadFilter(), g = A.createGain(); f.type = 'lowpass'; f.frequency.value = 2500; g.gain.value = 0.5; src.buffer = b; src.connect(f).connect(g).connect(A.destination); src.start(); } catch (e) { } }
  // ---------------------------------------------------------------- waypoint + maps
  setWp(v) { const s = this.s; this.wp = v; if (this.beam) { s.scene.remove(this.beam); this.beam.geometry.dispose(); this.beam.material.dispose(); this.beam = null; }
    if (v) { this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 160, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false })); this.beam.position.set(v.x, (v.y || 0) + 80, v.z); s.scene.add(this.beam); s.hud.flash('Waypoint: ' + v.name, 1.5); } this.nav.start(v, this.q); }
  mm(g, b, S, z) { // minimap layer (inside the minimap's world transform)
    for (const v of this.venues.list) { const x = (v.x - b[0]) * S, y = (v.z - b[1]) * S; g.fillStyle = v.col; g.beginPath(); g.arc(x, y, 4.2 / z * 2.2, 0, 7); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 1 / z * 2; g.stroke(); }
    if (this.wp) { const x = (this.wp.x - b[0]) * S, y = (this.wp.z - b[1]) * S; if (this.nav.route) this.nav.draw(g, b, S, z, this.q); else { g.strokeStyle = '#ffd23f'; g.lineWidth = 3 / z * 2; g.setLineDash([6 / z, 5 / z]); g.beginPath(); g.moveTo((this.q.x - b[0]) * S, (this.q.z - b[1]) * S); g.lineTo(x, y); g.stroke(); g.setLineDash([]); } g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(x, y, 6 / z * 2, 0, 7); g.fill(); }
    for (const R of this.s.remotes.values()) if (R.foot?.visible) { g.fillStyle = '#ff9a8a'; g.beginPath(); g.arc((R.foot.position.x - b[0]) * S, (R.foot.position.z - b[1]) * S, 3 / z * 2, 0, 7); g.fill(); } }
  openMap() { if (this.mapEl) return this.closeMap(); const h = this.s.hud, img = h.mapImg; if (!img) return; const b = h.mb, S = h.mS;
    const W = el('div', 'position:fixed;inset:0;background:#0c0f13;z-index:60;touch-action:none', ''); W.id = 'cz-map-open'; this.mapEl = W; const cv = el('canvas', 'position:absolute;inset:0;width:100%;height:100%', null, W);
    const bar = el('div', 'position:absolute;top:calc(10px + env(safe-area-inset-top));left:12px;right:12px;display:flex;gap:8px;justify-content:space-between;pointer-events:none;color:#fff;font:700 14px system-ui', '<b style="padding:10px;text-shadow:0 1px 3px #000">CITY MAP · tap anywhere to set GPS · drag / pinch to move</b>', W);
    const btns = el('div', 'display:flex;gap:8px;pointer-events:auto', '', bar); for (const [t, fn] of [['−', () => { view.z /= 1.5; draw(); }], ['+', () => { view.z *= 1.5; draw(); }], ['CLEAR', () => { this.setWp(null); draw(); }], ['CLOSE', () => this.closeMap()]]) { const k = el('button', BTN + 'height:40px;min-width:48px;font-size:18px;background:rgba(0,0,0,.4)', t, btns); k.onclick = fn; }
    const legend = el('div', 'position:absolute;left:12px;bottom:calc(12px + env(safe-area-inset-bottom));color:#fff;font:600 13px system-ui;background:rgba(0,0,0,.55);padding:8px 10px;border-radius:10px;line-height:1.6', Object.entries(ICON).map(([k, i]) => `${i} ${k === 'guns' ? 'gun shop' : k}`).join(' &nbsp; ') + ' &nbsp; <span style="color:#fff">▲ you</span> &nbsp; <span style="color:#ff5a4a">● players</span>', W);
    const dpr = Math.min(2, devicePixelRatio || 1), view = this.view || (this.view = { z: 1.6 }); view.cx = (this.q.x - b[0]) * S; view.cy = (this.q.z - b[1]) * S;
    const g = cv.getContext('2d'), toScr = (wx, wz) => [(((wx - b[0]) * S - view.cx) * view.z + cv.width / 2 / dpr), (((wz - b[1]) * S - view.cy) * view.z + cv.height / 2 / dpr)];
    const draw = () => { cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#0c0f13'; g.fillRect(0, 0, innerWidth, innerHeight);
      g.save(); g.translate(innerWidth / 2, innerHeight / 2); g.scale(view.z, view.z); g.translate(-view.cx, -view.cy); g.drawImage(img, 0, 0); g.restore();
      g.font = '700 12px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const v of this.venues.list) { const [x, y] = toScr(v.x, v.z); g.fillStyle = v.col; g.beginPath(); g.arc(x, y, 13, 0, 7); g.fill(); g.font = '14px system-ui'; g.fillText(ICON[v.kind], x, y + 1); g.font = '700 11px system-ui'; g.fillStyle = '#fff'; g.shadowColor = '#000'; g.shadowBlur = 4; g.fillText(v.name, x, y + 24); g.shadowBlur = 0; }
      for (const R of this.s.remotes.values()) { const o = R.foot?.visible ? R.foot.position : R.obj.position; const [x, y] = toScr(o.x, o.z); g.fillStyle = '#ff5a4a'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = '700 11px system-ui'; g.fillText(R.name || '', x, y - 13); }
      try { this.nav.drawScreen(g, toScr, this.q); } catch (e) { }
      if (this.wp) { const [x, y] = toScr(this.wp.x, this.wp.z); g.strokeStyle = '#ffd23f'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 18, 0, 7); g.stroke(); }
      const [mx, my] = toScr(this.q.x, this.q.z); g.save(); g.translate(mx, my); g.rotate(-this.q.yaw); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 8); g.lineTo(0, 4); g.lineTo(-8, 8); g.closePath(); g.fill(); g.stroke(); g.restore(); };
    this.mapDraw = draw; draw(); const P = new Map(); let moved = 0, pinch = null;
    const toWorld = (sx, sy) => [((sx - innerWidth / 2) / view.z + view.cx) / S + b[0], ((sy - innerHeight / 2) / view.z + view.cy) / S + b[1]];
    cv.onpointerdown = e => { P.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (P.size === 1) moved = 0; if (P.size === 2) { const [p1, p2] = [...P.values()]; pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), z: view.z }; moved = 99; } cv.setPointerCapture?.(e.pointerId); };
    cv.onpointermove = e => { const o = P.get(e.pointerId); if (!o) return; if (P.size === 2 && pinch) { o.x = e.clientX; o.y = e.clientY; const [p1, p2] = [...P.values()]; view.z = Math.max(0.25, Math.min(12, pinch.z * Math.hypot(p1.x - p2.x, p1.y - p2.y) / (pinch.d || 1))); draw(); return; }
      const dx = e.clientX - o.x, dy = e.clientY - o.y; moved += Math.abs(dx) + Math.abs(dy); view.cx -= dx / view.z; view.cy -= dy / view.z; o.x = e.clientX; o.y = e.clientY; draw(); };
    cv.onpointerup = cv.onpointercancel = e => { P.delete(e.pointerId); if (P.size < 2) pinch = null; if (P.size || moved > 8 || e.type === 'pointercancel') return;
      let best = null, bd = 30; for (const v of this.venues.list) { const [x, y] = toScr(v.x, v.z), d = Math.hypot(x - e.clientX, y - e.clientY); if (d < bd) { bd = d; best = v; } }
      if (!best) { const [wx, wz] = toWorld(e.clientX, e.clientY); const n = this.s.w?.nearestRoad?.(wx, wz); if (n && n.d < 120) best = { x: n.px, z: n.pz, y: Math.max(0, n.h), name: n.seg?.nm || 'Pin' }; } // p51: tap any street
      if (best) { this.setWp(best); draw(); } };
    cv.onwheel = e => { view.z = Math.max(0.25, Math.min(12, view.z * (e.deltaY > 0 ? 0.88 : 1.14))); draw(); }; this.mapT = setInterval(draw, 1000); }
  closeMap() { clearInterval(this.mapT); this.mapEl?.remove(); this.mapEl = null; }
  // ---------------------------------------------------------------- online
  net() { return this.active && !this.venues.inside ? [+this.p.x.toFixed(2), +this.p.y.toFixed(2), +this.p.z.toFixed(2), +this.yaw.toFixed(3), +this.v.toFixed(2)] : null; }
  remote(R, ft, dt) { if (!ft) { if (R.foot) R.foot.visible = false; return; } if (!R.foot) { R.foot = buildPerson(Math.abs([...(R.name || 'x')].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % 6); this.s.scene.add(R.foot); }
    const f = R.foot; f.visible = true; const k = Math.min(1, 10 * dt); f.position.x += (ft[0] - f.position.x) * k; f.position.y += (ft[1] - f.position.y) * k; f.position.z += (ft[2] - f.position.z) * k;
    let d = ft[3] - f.rotation.y; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; f.rotation.y += d * k; animPerson(f, dt, ft[4] || 0); if (Math.hypot(ft[0] - f.position.x, ft[2] - f.position.z) > 8) f.position.set(ft[0], ft[1], ft[2]); }
  dispose() { this.nav?.dispose(); removeEventListener('keydown', this.onKey); removeEventListener('keyup', this.onKey); this.closeMap(); this.closeMenu(); this.venues.dispose(); this.setWp(null);
    if (this.char) this.s.scene.remove(this.char); for (const R of this.s.remotes.values()) if (R.foot) this.s.scene.remove(R.foot);
    for (const e of [this.U, this.bMap, this.hint, this.fade]) e.remove(); this.bOut.hidden = true; const t = $('#touch'); if (t) t.style.visibility = ''; const sp = $('.h-speedo'); if (sp) sp.style.visibility = ''; }
}
