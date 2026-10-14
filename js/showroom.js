// Showroom (browse + choose) and Garage (performance upgrades + visual customisation) screens.
// 3D turntable framed inside the visible stage area, filters, specs, compare, engine sound preview, test drive,
// Performance/Visual tabs with categories, before/after stat bars from the game's physics, one bill with Confirm/Cancel.
import * as THREE from 'three';
import { buildCar, setLights, disposeCar } from './carmodel.js';
import { hasRealModel, realReady, ensureRealModel, modelKey, REAL_RIM_LABELS, SPECIAL_PAINTS, paintCost } from './realcars.js';
import { deriveParams, UPGRADE_PARTS, PACKAGES, partCost, partsFor } from '../shared/physics.js';
import { run060, topSpeed, brake60, skidpad, perfIndex, klass } from '../shared/perftest.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const CATS = { hot: 'Hot Hatches', saloon: 'Saloons & Estates', suv: 'SUVs', sports: 'Sports Cars & Supercars', classic: 'Classic & Cult Performance', ev: 'Electric Performance' };
const PAINTS = [0x0b0c10, 0xf2f2f2, 0x9aa0a6, 0x3a3f45, 0xb3121b, 0x1f4fa8, 0x0f5132, 0xffc20e, 0xff6a00, 0x6b2fa0, 0x6fd3ff, 0x7a1f2b, ...Object.keys(SPECIAL_PAINTS).map(Number)];
const PAINT_NAMES = { 0x0b0c10: 'Midnight black', 0xf2f2f2: 'Polar white', 0x9aa0a6: 'Silver', 0x3a3f45: 'Gunmetal', 0xb3121b: 'Brum red', 0x1f4fa8: 'Villa blue', 0x0f5132: 'Racing green', 0xffc20e: 'Gold rush', 0xff6a00: 'Digbeth orange', 0x6b2fa0: 'Purple haze', 0x6fd3ff: 'Ice blue', 0x7a1f2b: 'Claret' };
for (const [k, v] of Object.entries(SPECIAL_PAINTS)) PAINT_NAMES[k] = v.name;
const FXC = c => SPECIAL_PAINTS[c] ? ' refl' : ''; // reflective chip style
const WHEELS = ['five', 'multi', 'y', 'black', 'classic5'];
const WHEEL_LABELS = { five: 'Five-spoke', multi: 'Multi-spoke', y: 'Y-spoke', black: 'Black five-spoke', classic5: 'Classic five-spoke' };
const CALIPERS = [[null, 'Stock'], [0xc8102e, 'Red'], [0xffc20e, 'Yellow'], [0x1f4fa8, 'Blue'], [0x19e6c1, 'Teal'], [0x111214, 'Black'], [0xb9bdc2, 'Silver']];
const COST = { colour: 500, wheel: 400, tint: 200, caliper: 150, finish: 0, crackle: 0 }; // mirrors server.py 'custom'
const VIS_NAME = { colour: 'Paint', wheel: 'Wheels', tint: 'Window tint', caliper: 'Brake calipers', finish: 'Paint finish', crackle: 'Exhaust crackle' };
const hex = c => '#' + (c >>> 0).toString(16).padStart(6, '0');
const num = n => Number(n).toLocaleString('en-GB');
// Performance categories in the order a tuner thinks about them. `fx` = the stats a part really changes (honest tags).
const PERF = [
  ['engine', 'Engine', ['pow', 'acc', 'top']], ['turbo', 'Turbo', ['pow', 'acc', 'top']], ['exhaust', 'Exhaust', ['pow', 'acc', 'top']],
  ['motor', 'Motor', ['pow', 'acc', 'top']], ['cooling', 'Cooling', []], ['gearbox', 'Gearbox', ['acc']], ['diff', 'Diff', ['acc']],
  ['tyres', 'Tyres', ['grip', 'brk', 'acc']], ['brakes', 'Brakes', ['brk']], ['susp', 'Suspension', ['grip']], ['weight', 'Weight', ['acc', 'brk', 'grip']], ['aero', 'Aero', ['grip']],
];
const STAT = { pow: 'Power', acc: '0–60', top: 'Top speed', brk: 'Braking', grip: 'Grip' };
const VIS = [['colour', 'Paint'], ['finish', 'Finish'], ['wheel', 'Wheels'], ['tint', 'Tint'], ['caliper', 'Calipers'], ['crackle', 'Crackle']];

export class Showroom {
  constructor(app) {
    this.app = app; this.scene = new THREE.Scene(); this.cam = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
    this.scene.background = new THREE.Color(0x0d0e10); this.scene.fog = new THREE.Fog(0x0d0e10, 18, 40);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.35, metalness: 0.2 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.scene.add(floor);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.7, 0.08, 64), new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.3, metalness: 0.5 })); disc.position.y = 0.04; disc.receiveShadow = true; this.scene.add(disc); this.disc = disc;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.66, 0.025, 8, 128), new THREE.MeshBasicMaterial({ color: 0xf5c542 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.085; this.scene.add(ring);
    this.scene.add(new THREE.HemisphereLight(0xe6e2da, 0x201e1c, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(-5, 9, 6); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 }); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffd98a, 1.2); rim.position.set(6, 4, -7); this.scene.add(rim);
    for (const x of [-5, 0, 5]) { const strip = new THREE.Mesh(new THREE.BoxGeometry(3, 0.05, 0.3), new THREE.MeshBasicMaterial({ color: 0xffffff })); strip.position.set(x, 7, 0); this.scene.add(strip); }
    this.yaw = 0.6; this.pitch = 0.18; this.zoom = 1; this.auto = true; this.sel = null; this.preview = {}; this.interior = false;
    this.f = { cat: '', make: '', drive: '', price: '', own: '' }; this.gtab = 'perf'; this.gcat = 'kits';
    this.bindOrbit();
  }
  get cars() { return this.app.cars; }
  owned(id) { return !!this.app.store.profile.owned[id]; }
  enter(mode = 'showroom') {
    this.mode = mode; this.app.gfx.cam.aspect = innerWidth / innerHeight;
    this.scene.environment = this.app.gfx.roomEnv;
    if (mode === 'showroom') { this.buildFilters(); this.list(); this.select(this.sel || this.app.store.profile.selected); }
    else { const id = this.app.store.profile.selected; if (this.wantFor !== id) { this.want = null; this.preview = {}; } this.renderUpgrade(id); }
  }
  bindOrbit() {
    const cv = this.app.gfx.canvas; let pts = new Map(), last = null, pinch = null;
    cv.addEventListener('pointerdown', e => { if (!this.active) return; pts.set(e.pointerId, e); last = e; this.auto = false; });
    addEventListener('pointermove', e => {
      if (!this.active || !pts.has(e.pointerId)) return; pts.set(e.pointerId, e);
      if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); if (pinch) this.zoom = Math.max(this.interior ? 0.02 : 0.7, Math.min(2, this.zoom * pinch / d)); pinch = d; return; }
      if (last) { this.yaw -= (e.clientX - last.clientX) * 0.008; this.pitch = Math.max(-0.05, Math.min(1.2, this.pitch + (e.clientY - last.clientY) * 0.005)); } last = e;
    });
    const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) last = null; };
    addEventListener('pointerup', up); addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => { if (this.active) this.zoom = Math.max(0.7, Math.min(2, this.zoom * (e.deltaY > 0 ? 1.08 : 0.92))); }, { passive: true });
  }
  show(car, opts = {}) {
    if (this.obj) disposeCar(this.obj); // free the previous car (browsing used to leak ~20 geometries per car shown)
    const prof = this.app.store.profile; const cu = prof.custom[car.id] || {}; const v = k => (k in opts ? opts[k] : cu[k]);
    this.obj = buildCar(car, { detail: 2, colour: v('colour') ?? car.colour, wheel: v('wheel'), tint: v('tint'), caliper: v('caliper'), finish: v('finish'), plate: 'CUZZY' });
    this.obj.userData.realReady = realReady(car.id); this.obj.userData.realKey = this.obj.userData.realReady ? modelKey(car) : null;
    // lazy: swap in the car's own model once it has loaded (also when a stand-in body was shown before the manifest arrived)
    if (!this.obj.userData.realReady || this.obj.userData.realKey !== modelKey(car)) ensureRealModel(car.id).then(ok => { if (!ok || this.showCar !== car) return; const swap = () => { if (this.showCar === car && (!this.obj?.userData.realReady || this.obj.userData.realKey !== modelKey(car))) { this.show(car, this.mode === 'upgrade' ? this.preview : opts); if (this.active && this.mode === 'showroom') this.swatches(car); } };
      // compile the real model's shaders off the main thread first (KHR_parallel_shader_compile): on High a first draw of
      // the 140k-triangle mid-engine body with PCSS shadows + transmission glass used to block the page for 15-20 s
      let tmp = null; try { tmp = buildCar(car, { detail: 2, colour: v('colour') ?? car.colour, wheel: v('wheel'), tint: v('tint'), caliper: v('caliper'), finish: v('finish'), plate: 'CUZZY' }); } catch (e) { }
      const r = this.app.gfx.r; if (!tmp || !r.compileAsync) return swap();
      Promise.race([r.compileAsync(tmp, this.cam, this.scene), new Promise(res => setTimeout(res, 20000))]).catch(() => {}).then(() => { swap(); setTimeout(() => { try { disposeCar(tmp); } catch (e) { } }, 3000); }); }); // tmp freed after the swap, so its compiled programs stay in use // lazy: swap in the real model once it has loaded
    this.obj.traverse(o => { if (o.isMesh) o.castShadow = true; }); this.scene.add(this.obj); this.showCar = car; this.showKey = car.id + JSON.stringify(opts);
    setLights(this.obj, { head: 1 }, false);
  }
  // the car is framed inside the visible stage box (between the side panels), whatever the screen shape
  stageRect() {
    const el = this.mode === 'upgrade' ? $('#upgrade .gx-stage') : $('#showroom .sr-stage'); const r = el?.getBoundingClientRect();
    return r && r.width > 40 && r.height > 40 ? r : { left: 0, top: 0, width: innerWidth, height: innerHeight };
  }
  update(dt) {
    if (this.auto && !this.interior) this.yaw += dt * 0.18;
    const c = this.cam, W = innerWidth, H = innerHeight; c.aspect = W / H;
    const r = this.stageRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    c.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H); c.updateProjectionMatrix();
    if (this.interior && this.obj) { const u = this.obj.userData; const p = u.cockpit.clone(); c.position.copy(p); c.lookAt(p.x - Math.sin(this.yaw) * 5, p.y - 0.2 + this.pitch, p.z - Math.cos(this.yaw) * 5); c.fov = 70; }
    else {
      c.fov = 38; const L = (this.showCar?.dims?.[0] || 4.6) * 1.14, Hc = 2.05, t = Math.tan(19 * Math.PI / 180) * 2; // fit the car's length across the stage width and ~2.2 m of height
      const fitW = L / (t * (r.width / H)), fitH = Hc / (t * (r.height / H)); const dist = Math.max(5.4, fitW, fitH) * this.zoom;
      c.position.set(Math.sin(this.yaw) * Math.cos(this.pitch) * dist, 0.6 + Math.sin(this.pitch) * dist, Math.cos(this.yaw) * Math.cos(this.pitch) * dist); c.lookAt(0, 0.55, 0);
    }
    if (this.obj && !this.interior) this.obj.rotation.y = 0;
  }
  // ------------------------------------------------------------------ list / filters
  buildFilters() {
    const opt = (id, label, vals) => { const s = $(id); const cur = s.value; s.innerHTML = `<option value="">${label}</option>` + vals.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join(''); s.value = cur; s.onchange = () => { this.f[id.slice(3)] = s.value; this.list(); }; };
    opt('#f-cat', 'All categories', Object.entries(CATS));
    opt('#f-make', 'All makes', [...new Set(this.cars.map(c => c.brand))].sort().map(b => [b, b]));
    opt('#f-drive', 'Any drivetrain', [['FWD', 'Front-wheel drive'], ['RWD', 'Rear-wheel drive'], ['AWD', 'All-wheel drive']]);
    const ft = $('#sr-filt'); if (ft) ft.onclick = () => { const on = !$('#showroom .filters').classList.toggle('open'); ft.setAttribute('aria-expanded', String(!on)); this.app.audio.click(); };
  }
  filtered() {
    const f = this.f;
    return this.cars.filter(c => (!f.cat || c.cat === f.cat) && (!f.make || c.brand === f.make) && (!f.drive || c.drive === f.drive) &&
      (!f.price || (() => { const [a, b] = f.price.split('-').map(Number); return c.price >= a && c.price < b; })()) && (!f.own || (f.own === 'own') === this.owned(c.id)))
      .sort((a, b) => Object.keys(CATS).indexOf(a.cat) - Object.keys(CATS).indexOf(b.cat) || a.pi - b.pi);
  }
  list() {
    const L = this.filtered(); $('#sr-count').textContent = `${L.length} of ${this.cars.length} cars`;
    let cat = null; const ul = $('#sr-cars'); ul.innerHTML = '';
    if (!ul._wh) { ul._wh = 1; ul.addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { ul.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false }); } // mouse wheel scrolls the strip sideways
    for (const c of L) {
      if (c.cat !== cat) { cat = c.cat; const h = document.createElement('li'); h.className = 'sr-cat'; h.textContent = CATS[cat]; ul.appendChild(h); }
      const li = document.createElement('li'); const b = document.createElement('button'); b.className = 'sr-car'; b.dataset.id = c.id; li.appendChild(b);
      b.classList.toggle('on', c.id === this.sel); b.setAttribute('aria-pressed', String(c.id === this.sel));
      b.innerHTML = `<span class="sr-car-t"><b>${esc(c.name)}</b><small>${c.year} · ${c.asp === 'EV' ? c.ev.kw + ' kW' : c.bhp + ' bhp'}${this.app.store.profile.selected === c.id ? ' · <span class="own">DRIVING</span>' : ''}</small></span><span class="cls cls-${c.cls}">${c.cls}</span>`;
      b.onclick = () => { this.app.audio.click(); this.select(c.id); }; ul.appendChild(li);
    }
    if (!L.length) ul.innerHTML = '<li class="sr-empty">No cars match these filters. <button class="btn small ghost" id="sr-clear">Clear filters</button></li>';
    const cl = $('#sr-clear'); if (cl) cl.onclick = () => { this.f = { cat: '', make: '', drive: '', price: '', own: '' }; for (const s of ['#f-cat', '#f-make', '#f-drive']) $(s).value = ''; this.list(); };
  }
  select(id) {
    const car = this.app.carsById[id]; if (!car) return; this.sel = id; this.preview = {}; this.interior = false; $('#sr-interior').classList.remove('on'); $('#sr-interior').setAttribute('aria-pressed', 'false');
    for (const b of document.querySelectorAll('#sr-cars .sr-car')) { b.classList.toggle('on', b.dataset.id === id); b.setAttribute('aria-pressed', String(b.dataset.id === id)); }
    this.show(car); this.detail(car); this.swatches(car);
    const on = document.querySelector('#sr-cars .sr-car.on'); if (on) requestAnimationFrame(() => on.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }));
  }
  swatches(car) {
    const w = $('#sr-swatches'); w.innerHTML = '';
    const cur = this.preview.colour ?? this.app.store.profile.custom[car.id]?.colour ?? car.colour;
    for (const col of [car.colour, ...PAINTS.filter(p => p !== car.colour)]) { const b = document.createElement('button'); b.className = 'sw' + FXC(col); b.classList.toggle('on', col === cur); b.style.setProperty('--c', hex(col)); b.title = b.ariaLabel = 'Preview ' + (PAINT_NAMES[col] || 'factory colour'); b.dataset.c = col; b.onclick = () => { this.preview.colour = col; this.show(car, this.preview); for (const x of w.querySelectorAll('.sw')) x.classList.toggle('on', x === b); this.detail(car); }; w.appendChild(b); }
    const real = hasRealModel(car.id) && realReady(car.id); const L = real ? REAL_RIM_LABELS : WHEEL_LABELS; // real 3D models keep their rim shape and take a finish
    const wb = document.createElement('chip-select'); wb.id = 'sr-wheel'; wb.setAttribute('aria-label', 'Preview wheels'); w.appendChild(wb); wb.innerHTML = WHEELS.map(x => `<option value="${x}">${L[x]}</option>`).join(''); wb.value = this.preview.wheel || this.app.store.profile.custom[car.id]?.wheel || (real ? 'five' : car.wheel || 'five'); wb.onchange = () => { this.preview.wheel = wb.value; this.show(car, this.preview); this.detail(car); };
  }
  detail(car) {
    const p = this.app.store.profile; const own = this.owned(car.id); const ev = car.asp === 'EV'; const r = car.rating; const ch = this.changes(car, this.preview);
    const spec = [
      ['Power', ev ? `${car.ev.kw} kW <small class="inl">(${car.bhp} bhp)</small>` : `${car.bhp} bhp`], ['Torque', `${num(car.nm)} Nm`], ['0–60 mph', `${car.s060} s`], ['Top speed', `${car.top} mph`],
      ['Weight', `${num(car.kg)} kg`], ['Drivetrain', car.drive], ['Gearbox', esc(car.box)], ['Engine', ev ? `${car.ev.motors || 2} motor${(car.ev.motors || 2) > 1 ? 's' : ''}` : esc(car.engine + ' ' + (car.asp === 'NA' ? 'NA' : car.asp === 'SC' ? 'supercharged' : car.asp === 'TT' ? 'twin-turbo' : 'turbo'))],
      ...(ev ? [['Battery', `${car.ev.kwh} kWh`], ['Range', `${car.ev.range} miles`]] : []), ['Class', `<span class="cls cls-${car.cls}">${car.cls}</span> PI ${car.pi}`]];
    const sel = p.selected === car.id;
    $('#sr-detail').innerHTML = `
      <div class="sr-badges"><span class="badge">${CATS[car.cat]}</span>${car.verified ? '<span class="badge v">Researched stock figures</span>' : '<span class="badge w">Estimated figures</span>'}${car.fictional ? '<span class="badge w">Fictional car</span>' : ''}</div>
      <h3>${esc(car.name)}</h3><div class="ref">In-game design inspired by: ${esc(car.ref)}${car.note ? ' — ' + esc(car.note) : ''}</div>
      <div class="rat">${[['Acceleration', r.acc], ['Top speed', r.spd], ['Handling', r.han], ['Braking', r.brk]].map(([k, v]) => `<div><span>${k}</span><i style="--v:${v}"></i><b>${v}</b></div>`).join('')}</div>
      <div class="spec">${spec.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('')}</div>
      ${ev ? `<p class="note">EV: instant torque, regenerative braking (adjustable in Settings › Controls), optional one-pedal driving and battery use. No exhaust or exhaust upgrades.</p>` : ''}
      <p class="note">Stock figures come from manufacturer/press sources listed in the credits. Sources: ${esc(car.src || 'manufacturer data')}.</p>
      <div class="sr-actions">
        ${own ? `<button class="btn primary gold" id="sr-choose" ${sel ? 'aria-pressed="true"' : ''}>${sel ? 'Driving this ✓' : 'Choose this car'}</button>` : ''}
        ${own && ch.keys.length ? `<button class="btn" id="sr-paint">Buy this look · ${ch.cost ? num(ch.cost) + ' cr' : 'free'}</button><button class="btn ghost" id="sr-undo">Reset preview</button>` : ''}
        <button class="btn" id="sr-test">Test drive</button>
        ${own ? `<button class="btn ghost" id="sr-up">Upgrade &amp; customise ›</button>` : ''}
      </div>`;
    const b = (id, f) => { const e = $(id); if (e) e.onclick = f; };
    b('#sr-choose', async () => { await this.app.busy('Saving…', this.app.store.act('select', { car: car.id })); this.app.refreshWallet(); this.detail(car); this.list(); this.app.toast(`${car.name} — locked in`); });
    const toGarage = tab => { const pv = { ...this.preview }; const go = () => { this.want = null; this.wantFor = car.id; this.preview = pv; this.gtab = tab; this.gcat = tab === 'vis' ? (Object.keys(pv)[0] || 'colour') : 'kits'; this.app.go('upgrade'); };
      this.app.store.profile.selected !== car.id ? this.app.busy('Saving…', this.app.store.act('select', { car: car.id })).then(go) : go(); };
    b('#sr-paint', () => toGarage('vis'));
    b('#sr-undo', () => { this.preview = {}; this.show(car); this.detail(car); this.swatches(car); });
    b('#sr-test', () => this.app.testDrive(car));
    b('#sr-up', () => toGarage('perf'));
    $('#sr-interior').onclick = () => { this.interior = !this.interior; $('#sr-interior').classList.toggle('on', this.interior); $('#sr-interior').setAttribute('aria-pressed', String(this.interior)); if (this.interior) { this.yaw = 0; this.pitch = 0; } };
    $('#sr-sound').onclick = () => { this.app.audio.unlock(); car._up = p.ups[car.id] || {}; this.app.audio.engineStart(car, 2.6); };
    $('#sr-compare').onclick = () => this.compare(car);
  }
  // preview keys that differ from what is fitted, and their price (same rules as the server)
  changes(car, pv = this.preview) {
    const cu = this.app.store.profile.custom[car.id] || {}; const keys = []; let cost = 0;
    for (const k of Object.keys(pv)) { const v = pv[k]; const cur = cu[k];
      const same = k === 'wheel' ? (v || this.defWheel(car)) === (cur || this.defWheel(car)) : k === 'tint' ? !!v === !!cur : k === 'colour' ? v === (cur ?? car.colour) : k === 'finish' ? (v || 'metallic') === (cur || 'metallic') : k === 'crackle' ? v === (cur ?? 1) : k === 'caliper' ? (v ?? null) === (cur ?? null) : v === cur;
      if (!same) { keys.push(k); cost += k === 'colour' ? paintCost(v) : COST[k] || 0; } }
    return { keys, cost };
  }
  defWheel(car) { return hasRealModel(car.id) && realReady(car.id) ? 'five' : car.wheel || 'five'; }
  compare(car) {
    const opts = this.cars.filter(c => c.id !== car.id).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    const body = `<chip-select id="cmp-sel" aria-label="Compare with" style="margin-bottom:10px;justify-content:flex-start">${opts}</chip-select><div id="cmp-t"></div>`;
    this.app.modal('Compare', body, [{ t: 'Close' }]);
    const sel = $('#cmp-sel'); sel.value = this.app.store.profile.selected !== car.id ? this.app.store.profile.selected : this.cars.find(c => c.id !== car.id).id;
    const draw = () => { const b = this.app.carsById[sel.value]; const rows = [['Power (bhp)', car.bhp, b.bhp, 1], ['Torque (Nm)', car.nm, b.nm, 1], ['0–60 mph (s)', car.s060, b.s060, -1], ['Top speed (mph)', car.top, b.top, 1], ['Weight (kg)', car.kg, b.kg, -1], ['Handling', car.rating.han, b.rating.han, 1], ['Braking', car.rating.brk, b.rating.brk, 1], ['PI', car.pi, b.pi, 1]];
      $('#cmp-t').innerHTML = `<table class="cmp"><tr><th></th><th>${esc(car.name)}</th><th>${esc(b.name)}</th></tr>${rows.map(([k, x, y, d]) => `<tr><td>${k}</td><td class="${d && (x - y) * d > 0 ? 'better' : ''}">${num(x)}</td><td class="${d && (y - x) * d > 0 ? 'better' : ''}">${num(y)}</td></tr>`).join('')}<tr><td>Drivetrain</td><td>${car.drive}</td><td>${b.drive}</td></tr></table>`; };
    sel.onchange = draw; draw();
  }
  // ------------------------------------------------------------------ garage: upgrades + customise
  measure(car, ups) { const key = car.id + JSON.stringify(Object.entries(ups || {}).filter(e => e[1]).sort()); this.mcache = this.mcache || new Map(); if (this.mcache.has(key)) return this.mcache.get(key); const r = this._measure(car, ups); this.mcache.set(key, r); return r; }
  _measure(car, ups) { const P = deriveParams(car, ups, this.app.calib[car.id] || {}); return { s060: run060(P), top: topSpeed(P), brake: brake60(P), latG: skidpad(P), pow: this.power(car, ups) }; }
  power(car, u = {}) { // same torque multiplier as deriveParams (without the per-car calibration, which is 1 for the stock figure)
    const ev = car.asp === 'EV'; const m = 1 + (ev ? 0 : (u.engine || 0) * 0.07 + (u.exhaust || 0) * 0.02 + (u.turbo || 0) * (car.asp === 'NA' ? 0.03 : 0.06)) + (ev ? (u.motor || 0) * 0.08 : 0);
    return (ev ? car.ev.kw * 1.341 : car.bhp) * m;
  }
  dirty() { const car = this.upCar; if (!car || !this.want) return false; const cur = this.app.store.profile.ups[car.id] || {}; return partsFor(car).some(k => (cur[k] || 0) !== (this.want[k] || 0)) || this.changes(car).keys.length > 0; }
  discard() { this.want = null; this.preview = {}; }
  bill(car) {
    const cur = this.app.store.profile.ups[car.id] || {}; const lines = []; let c = 0, r = 0;
    for (const k of partsFor(car)) { const a = cur[k] || 0, b = this.want[k] || 0; if (b === a) continue; const P = UPGRADE_PARTS[k];
      if (b > a) { const x = partCost(car, k, b) - partCost(car, k, a); c += x; lines.push([`${P.name}: ${a ? 'S' + a : 'Stock'} → S${b}`, x]); }
      else { const x = Math.floor((partCost(car, k, a) - partCost(car, k, b)) / 2); r += x; lines.push([`${P.name}: S${a} → ${b ? 'S' + b : 'Stock'} (50% refund)`, -x]); } }
    const ch = this.changes(car); for (const k of ch.keys) lines.push([`${VIS_NAME[k]}: ${this.visLabel(car, k, this.preview[k])}`, k === 'colour' ? paintCost(this.preview[k]) : COST[k] || 0]);
    return { lines, parts: c - r, vis: ch.cost, visKeys: ch.keys, total: c - r + ch.cost, partsChanged: lines.length > ch.keys.length };
  }
  visLabel(car, k, v) {
    if (k === 'colour') return PAINT_NAMES[v] || (v === car.colour ? 'Factory colour' : hex(v));
    if (k === 'wheel') { const real = hasRealModel(car.id) && realReady(car.id); return (real ? REAL_RIM_LABELS : WHEEL_LABELS)[v] || v; }
    if (k === 'tint') return v ? 'Tinted' : 'Clear'; if (k === 'caliper') return (CALIPERS.find(c => c[0] === (v ?? null)) || [0, 'Custom'])[1];
    if (k === 'finish') return v === 'solid' ? 'Solid' : 'Metallic'; if (k === 'crackle') return ['Off', 'Normal', 'Loud'][v] ?? v; return String(v);
  }
  renderUpgrade(id) {
    const prof = this.app.store.profile; const car = this.app.carsById[id]; this.upCar = car;
    const cur = { ...(prof.ups[id] || {}) }; if (!this.want || this.wantFor !== id) { this.want = { ...cur }; if (this.wantFor !== id) this.preview = {}; } this.wantFor = id;
    const pvKey = car.id + JSON.stringify(this.preview); if (this.showKey !== pvKey || this.showCar !== car) this.show(car, this.preview);
    if (!this.stock || this.stockFor !== id) { this.stock = this.measure(car, {}); this.stockFor = id; }
    const parts = partsFor(car); const ev = car.asp === 'EV'; const cu = prof.custom[id] || {}; const vv = k => (k in this.preview ? this.preview[k] : cu[k]);
    const ownedCars = this.cars.filter(c => prof.owned[c.id]);
    const m = this.measure(car, this.want), mc = this.measure(car, cur), st = this.stock;
    const anyCur = Object.keys(cur).some(k => cur[k]), anyNew = Object.keys(this.want).some(k => this.want[k]);
    const piNow = anyCur ? perfIndex(car, { ...mc, latG0: st.latG, brk0: st.brake }).pi : car.pi, piNew = anyNew ? perfIndex(car, { ...m, latG0: st.latG, brk0: st.brake }).pi : car.pi;
    const clsNow = anyCur ? klass(piNow) : car.cls, clsNew = anyNew ? klass(piNew) : car.cls;
    const B = this.bill(car); const dirty = B.lines.length > 0; const afford = B.total <= prof.credits;
    if (this.gtab === 'vis' && !VIS.some(v => v[0] === this.gcat)) this.gcat = 'colour';
    if (this.gtab === 'perf' && this.gcat !== 'kits' && !parts.includes(this.gcat)) this.gcat = 'kits';
    // header car picker + credits
    $('#up-carslot').innerHTML = `<chip-select id="up-car" aria-label="Car">${ownedCars.map(c => `<option value="${c.id}" ${c.id === id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</chip-select>`;
    // stat rows: [key, label, before, after, unit, dp, lowerIsBetter, scale(v)->0..1]
    const cl = (x) => Math.max(0.03, Math.min(1, x));
    const rows = [['pow', 'Power', mc.pow, m.pow, ev ? 'bhp·e' : 'bhp', 0, false, v => cl(v / 800)], ['acc', '0–60', mc.s060, m.s060, 's', 2, true, v => cl((9 - v) / 7)], ['top', 'Top speed', mc.top, m.top, 'mph', 0, false, v => cl((v - 60) / 170)],
      ['brk', 'Braking', mc.brake, m.brake, 'm', 1, true, v => cl((52 - v) / 28)], ['grip', 'Grip', mc.latG, m.latG, 'g', 2, false, v => cl((v - 0.6) / 0.9)]];
    const statHTML = rows.map(([k, lab, a, b, u, dp, lo, sc]) => { const d = b - a; const eps = Math.pow(10, -dp) / 2; const same = Math.abs(d) < eps; const good = !same && (lo ? d < 0 : d > 0);
      return `<div class="st ${same ? '' : good ? 'good' : 'bad'}" data-stat="${k}"><span class="st-l">${lab}</span><span class="st-bar" role="img" aria-label="${lab}: ${a.toFixed(dp)} to ${b.toFixed(dp)} ${u}"><i class="st-a" style="--w:${sc(a)}"></i><i class="st-b" style="--w:${sc(b)}"></i></span><span class="st-v">${a.toFixed(dp)}${same ? '' : `<em>${good ? '▲' : '▼'} ${b.toFixed(dp)}</em>`}<small>${u === 'bhp·e' ? 'bhp' : u}</small></span></div>`; }).join('');
    // categories
    const pip = (a, b) => `<span class="pips" aria-hidden="true">${[1, 2, 3].map(l => `<i class="${l <= b ? 'on' : ''} ${l <= a && l > b ? 'rm' : ''}"></i>`).join('')}</span>`;
    const perfCats = [['kits', 'Kits', null], ...PERF.filter(p => parts.includes(p[0]))];
    const catHTML = this.gtab === 'perf'
      ? perfCats.map(([k, n]) => { const a = cur[k] || 0, b = this.want[k] || 0; return `<button class="gc ${this.gcat === k ? 'on' : ''} ${k !== 'kits' && a !== b ? 'pend' : ''}" data-cat="${k}" role="tab" aria-selected="${this.gcat === k}"><b>${n}</b>${k === 'kits' ? '<small>Packages</small>' : pip(a, b)}</button>`; }).join('')
      : VIS.filter(([k]) => k !== 'crackle' || !ev).map(([k, n]) => { const pend = this.changes(car).keys.includes(k); const val = vv(k); const sw = k === 'colour' ? `<i class="gc-sw" style="--c:${hex(val ?? car.colour)}"></i>` : k === 'caliper' ? `<i class="gc-sw" style="--c:${val == null ? '#555' : hex(val)}"></i>` : '';
        return `<button class="gc ${this.gcat === k ? 'on' : ''} ${pend ? 'pend' : ''}" data-cat="${k}" role="tab" aria-selected="${this.gcat === k}"><b>${n}</b><small>${sw}${esc(this.visLabel(car, k, k === 'colour' ? (val ?? car.colour) : k === 'wheel' ? (val || this.defWheel(car)) : k === 'crackle' ? (val ?? 1) : val))}</small></button>`; }).join('');
    // detail pane
    let det = '';
    const g = this.gcat;
    if (this.gtab === 'perf' && g === 'kits') {
      det = `<h4>Quick kits</h4><p class="note">One tap sets every part to the kit's stage. Nothing is charged until you Confirm.</p>
        <div class="kits">${[['street', 'Street', 'Road-legal refresh'], ['sport', 'Sport', 'Weekend warrior'], ['track', 'Track', 'Full send']].map(([k, n, s]) => { let c = 0; for (const pk of parts) { const lv = Math.max(PACKAGES[k][pk] || 0, 0); if (lv > (cur[pk] || 0)) c += partCost(car, pk, lv) - partCost(car, pk, cur[pk] || 0); } return `<button class="kit" data-pkg="${k}"><b>${n}</b><small>${s}</small><span class="price">${c ? '+' + num(c) + ' cr' : 'Fitted'}</span></button>`; }).join('')}</div>
        <div class="kit-row"><button class="btn ghost" id="up-stock">Restore stock</button><button class="btn ghost" id="up-save">Save setup</button>${Object.keys(prof.setups[id] || {}).length ? `<span class="kit-lab">Load setup:</span><chip-select id="up-load" nodefault aria-label="Load saved setup">${Object.keys(prof.setups[id] || {}).map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</chip-select>` : ''}</div>
        <p class="note">${ev ? 'Electric cars have no exhaust, turbo or engine-tune parts; motor and cooling parts replace them. ' : ''}Removing a fitted part refunds 50% of what it cost. Upgraded figures are simulated by the game's physics, not real-world data. Stock (researched): ${car.s060} s 0–60, ${car.top} mph.</p>`;
    } else if (this.gtab === 'perf') {
      const P = UPGRADE_PARTS[g]; const a = cur[g] || 0, b = this.want[g] || 0; const fx = (PERF.find(p => p[0] === g) || [0, 0, []])[2];
      det = `<h4>${esc(P.name)}</h4>
        <div class="lv" role="radiogroup" aria-label="${esc(P.name)} stage">${[0, 1, 2, 3].map(l => { const pc = partCost(car, g, l) - partCost(car, g, a); return `<button role="radio" aria-checked="${l === b}" data-p="${g}" data-l="${l}" class="${l === b ? 'on' : ''} ${l === a ? 'cur' : ''}"><b>${l ? 'Stage ' + l : 'Stock'}</b><small>${l === a ? 'Fitted' : pc > 0 ? '+' + num(pc) + ' cr' : 'Refund ' + num(Math.floor(-pc / 2))}</small></button>`; }).join('')}</div>
        <p class="pro">+ ${esc(P.benefit)}</p><p class="con">− ${esc(P.trade)}</p>
        <div class="fx"><span>Changes:</span>${fx.length ? fx.map(f => `<i class="yes">${STAT[f]}</i>`).join('') : '<i>Sustained power only</i>'}${Object.keys(STAT).filter(f => !fx.includes(f)).map(f => `<i class="no">${STAT[f]}</i>`).join('')}</div>
        ${['engine', 'turbo', 'exhaust', 'motor'].includes(g) ? '<p class="note">Power does not improve braking or cornering grip — fit tyres, brakes and suspension for that.</p>' : g === 'aero' ? '<p class="note">Downforce adds high-speed grip; the extra drag trims top speed slightly.</p>' : ''}`;
    } else {
      const real = hasRealModel(car.id) && realReady(car.id); const chip = (k, val, label, on) => `<button class="chip ${on ? 'on' : ''}" aria-pressed="${on}" data-ck="${k}" data-cv='${JSON.stringify(val)}'>${label}</button>`;
      const priceNote = { colour: '500 cr · reflective paints free', wheel: '400 cr', tint: '200 cr', caliper: '150 cr', finish: 'Free', crackle: 'Free' }[g];
      const body = g === 'colour' ? `<div class="swgrid">${[car.colour, ...PAINTS.filter(p => p !== car.colour)].map(c => `<button class="sw big${FXC(c)} ${(vv('colour') ?? car.colour) === c ? 'on' : ''}" aria-pressed="${(vv('colour') ?? car.colour) === c}" data-ck="colour" data-cv="${c}" style="--c:${hex(c)}" title="${PAINT_NAMES[c] || 'Factory colour'}" aria-label="${PAINT_NAMES[c] || 'Factory colour'}"></button>`).join('')}</div>`
        : g === 'finish' ? `<div class="chips">${chip('finish', 'metallic', 'Metallic', (vv('finish') || 'metallic') === 'metallic')}${chip('finish', 'solid', 'Solid', vv('finish') === 'solid')}</div>`
        : g === 'wheel' ? `<div class="chips">${WHEELS.map(w => chip('wheel', w, (real ? REAL_RIM_LABELS : WHEEL_LABELS)[w], (vv('wheel') || this.defWheel(car)) === w)).join('')}</div>${real ? '<p class="note">This model keeps its own rim shape; the option changes the rim finish.</p>' : ''}`
        : g === 'tint' ? `<div class="chips">${chip('tint', false, 'Clear', !vv('tint'))}${chip('tint', true, 'Tinted', !!vv('tint'))}</div>`
        : g === 'caliper' ? `<div class="swgrid">${CALIPERS.map(([c, n]) => `<button class="sw big ${(vv('caliper') ?? null) === c ? 'on' : ''}" aria-pressed="${(vv('caliper') ?? null) === c}" data-ck="caliper" data-cv='${JSON.stringify(c)}' style="--c:${c == null ? '#3a3a3a' : hex(c)}" title="${n}" aria-label="${n}">${c == null ? '<span>Stock</span>' : ''}</button>`).join('')}</div>`
        : `<div class="chips">${[[0, 'Off'], [1, 'Normal'], [2, 'Loud']].map(([x, n]) => chip('crackle', x, n, (vv('crackle') ?? 1) === x)).join('')}</div><button class="btn ghost small" id="up-listen">Hear it</button>`;
      det = `<h4>${VIS_NAME[g]} <span class="ptag">${priceNote}</span></h4>${body}<p class="note">Previewed live on the car. Visual parts never change performance. Paid on Confirm.</p>`;
    }
    $('#up-body').innerHTML = `<div class="gx">
      <div class="gx-stage"><div class="gx-tools"><button class="btn ghost small" id="up-test">Test drive</button><button class="btn ghost small" id="up-spin" aria-pressed="${this.auto}">${this.auto ? 'Stop spin' : 'Spin'}</button><span class="hint">Drag to rotate</span></div></div>
      <section class="gx-stats" aria-label="Performance, fitted versus with changes"><div class="gx-stats-h"><b>Performance</b><span class="cls cls-${clsNow}">${clsNow}</span><span class="pi">${piNow}</span>${piNew !== piNow || clsNew !== clsNow ? `<span class="arrow">→</span><span class="cls cls-${clsNew}">${clsNew}</span><span class="pi">${piNew}</span>` : ''}</div>${statHTML}</section>
      <section class="gx-panel">
        <div class="gx-tabs" role="tablist" aria-label="Garage sections"><button role="tab" class="gt ${this.gtab === 'perf' ? 'on' : ''}" aria-selected="${this.gtab === 'perf'}" data-tab="perf">Performance</button><button role="tab" class="gt ${this.gtab === 'vis' ? 'on' : ''}" aria-selected="${this.gtab === 'vis'}" data-tab="vis">Visual</button></div>
        <div class="gx-main"><nav class="gx-cats" role="tablist" aria-label="Categories">${catHTML}</nav><div class="gx-detail">${det}</div></div>
        <footer class="gx-foot"><div class="gx-bill"><small>${dirty ? (B.total < 0 ? 'Refund' : 'Total') : 'No changes'}</small><b class="${!afford ? 'short' : ''}">${dirty ? num(Math.abs(B.total)) + ' cr' : '—'}</b><small>${dirty ? (afford ? `After: ${num(prof.credits - B.total)} cr` : `Need ${num(B.total - prof.credits)} more`) : `You have ${num(prof.credits)} cr`}</small></div>
          <button class="btn ghost" id="up-reset" ${dirty ? '' : 'disabled'}>Cancel</button><button class="btn primary gold" id="up-fit" ${dirty && afford ? '' : 'disabled'}>Confirm</button></footer>
      </section></div>`;
    // keep the category list / detail scroll position between re-renders
    const cats = $('#up-body .gx-cats'), dt = $('#up-body .gx-detail'); if (this.scr) { cats.scrollTop = this.scr[0]; cats.scrollLeft = this.scr[1]; dt.scrollTop = this.scr[2]; }
    const rerender = (keepScroll = true) => { const c = $('#up-body .gx-cats'), d = $('#up-body .gx-detail'); this.scr = keepScroll && c ? [c.scrollTop, c.scrollLeft, d.scrollTop] : [0, 0, 0]; const f = document.activeElement?.closest?.('#up-body [data-cat],#up-body [data-l],#up-body [data-ck],#up-body [data-tab],#up-body [data-pkg]'); const fk = f && ['cat', 'l', 'p', 'ck', 'cv', 'tab', 'pkg'].map(k => f.dataset[k]).join('|'); this.renderUpgrade(id); if (fk) { const n = [...document.querySelectorAll('#up-body [data-cat],#up-body [data-l],#up-body [data-ck],#up-body [data-tab],#up-body [data-pkg]')].find(e => ['cat', 'l', 'p', 'ck', 'cv', 'tab', 'pkg'].map(k => e.dataset[k]).join('|') === fk); n?.focus({ preventScroll: true }); } };
    const A = this.app;
    $('#up-car').onchange = e => { const to = e.target.value; const sw = () => { this.want = null; this.preview = {}; this.scr = null; A.store.act('select', { car: to }).then(() => { this.renderUpgrade(to); A.refreshWallet(); }); };
      if (this.dirty()) { e.target.value = id; A.confirm('Discard changes?', 'You have unconfirmed changes on this car. Switch car and discard them?', 'Discard & switch', sw); } else sw(); };
    for (const b of document.querySelectorAll('#up-body [data-tab]')) b.onclick = () => { if (this.gtab === b.dataset.tab) return; this.gtab = b.dataset.tab; this.gcat = this.gtab === 'perf' ? 'kits' : 'colour'; A.audio.click(); this.scr = null; rerender(false); };
    for (const b of document.querySelectorAll('#up-body [data-cat]')) b.onclick = () => { this.gcat = b.dataset.cat; A.audio.click(); rerender(); const d = $('#up-body .gx-detail'); if (d) d.scrollTop = 0; };
    for (const b of document.querySelectorAll('#up-body .lv button')) b.onclick = () => { this.want[b.dataset.p] = +b.dataset.l; A.audio.click(); rerender(); };
    for (const b of document.querySelectorAll('#up-body [data-pkg]')) b.onclick = () => { const P = PACKAGES[b.dataset.pkg]; this.want = {}; for (const pk of parts) this.want[pk] = Math.max(P[pk] || 0, 0); A.audio.click(); rerender(); A.toast(`${b.dataset.pkg[0].toUpperCase() + b.dataset.pkg.slice(1)} kit previewed — Confirm to fit`); };
    for (const b of document.querySelectorAll('#up-body [data-ck]')) b.onclick = () => { this.preview[b.dataset.ck] = JSON.parse(b.dataset.cv); A.audio.click(); if (b.dataset.ck !== 'crackle') this.show(car, this.preview); rerender(); };
    const on = (sel, f) => { const e = $(sel); if (e) e.onclick = f; };
    on('#up-stock', () => { this.want = {}; A.audio.click(); rerender(); });
    on('#up-reset', () => { this.want = { ...cur }; this.preview = {}; this.show(car, {}); A.audio.click('back'); rerender(); A.toast('Changes cancelled'); });
    on('#up-spin', () => { this.auto = !this.auto; rerender(); });
    on('#up-listen', () => { A.audio.unlock(); car._up = this.want; A.audio.engineStart(car, 2.6); });
    on('#up-fit', () => {
      const list = B.lines.map(([t, c]) => `<tr><td>${esc(t)}</td><td class="${c < 0 ? 'ref' : ''}">${c < 0 ? '−' + num(-c) : c ? num(c) : 'Free'}</td></tr>`).join('');
      A.modal('Confirm purchase', `<table class="bill">${list}<tr class="tot"><td>${B.total < 0 ? 'Refund' : 'Total'}</td><td>${num(Math.abs(B.total))} cr</td></tr></table><p class="note">Balance ${num(prof.credits)} → ${num(prof.credits - B.total)} cr</p>`,
        [{ t: 'Cancel', cls: 'ghost' }, { t: B.total > 0 ? `Pay ${num(B.total)} cr` : 'Confirm', cls: 'primary gold', f: async () => {
          let charged = 0, refunded = 0;
          if (B.partsChanged) { const w = {}; for (const pk of parts) w[pk] = this.want[pk] || 0; const r = await A.busy('Fitting parts…', A.store.act('upgrade', { car: id, parts: w })); charged += r.charged || 0; refunded += r.refunded || 0; }
          if (B.visKeys.length) { const c = {}; for (const k of B.visKeys) c[k] = this.preview[k]; await A.busy('Spraying…', A.store.act('custom', { car: id, custom: c })); charged += B.vis; }
          A.audio.click('buy'); A.toast(charged - refunded > 0 ? `Sorted — ${num(charged - refunded)} cr spent` : refunded ? `Done — refunded ${num(refunded)} cr` : 'Done'); this.want = null; this.preview = {}; A.refreshWallet(); this.renderUpgrade(id);
        } }]);
    });
    on('#up-test', () => this.app.testDrive(car, this.want, this.preview));
    on('#up-save', () => this.app.prompt('Save setup', 'Name this setup (saves the currently fitted parts)', 'Setup ' + (Object.keys(prof.setups[id] || {}).length + 1), async n => { await this.app.store.act('setup_save', { car: id, name: n }); rerender(); this.app.toast('Setup saved'); }));
    const ld = $('#up-load'); if (ld) ld.onchange = e => { const s = prof.setups[id]?.[e.target.value]; if (s) { this.want = { ...s }; rerender(); A.toast('Setup loaded — Confirm to fit'); } };
  }
}
