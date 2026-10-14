// CUZZY RACING — app shell: loading, intro, menus, lobby, pause, results and the main loop.
import * as THREE from 'three';
import { Gfx } from './gfx.js';
import { World } from './world.js';
import { AudioSys } from './audio.js';
import { Radio } from './radio.js';
import { Store, setAuthLost, sendFeedback } from './store.js';
import { Rumble } from './rumble.js';
import { AuthUI } from './ui_auth.js';
import { Net } from './net.js';
import { Voice } from './voice.js';
import { Session, fmt } from './game.js';
import { aiWanted, pickField } from './ai.js';
import { OpenWorld } from './openworld.js';
import { StreetLife } from './streetlife.js';
import { Hud } from './hud.js';
import { Showroom, CATS } from './showroom.js';
import { SettingsUI, howtoHTML } from './ui_settings.js';
import { UINav } from './uinav.js';
import './chipselect.js'; // <chip-select>: tap chips instead of native <select> (phones)
import { VR } from './vr.js';
import { defaults, merge, HAS_TOUCH, IS_MOBILE, PRESETS, applyPreset, normalizeGfx, loadLocalGfx, saveLocalGfx } from './settings.js';
import { buildCar, setLights, poseCar, disposeCar } from './carmodel.js';
import { preloadRealCars, realReady, ensureRealModel, registerCars, loadTypes } from './realcars.js';
import { deriveParams, newState } from '../shared/physics.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = n => Number(n).toLocaleString('en-GB');
const INTRO_SPOT = { x: 403.5, z: 145.6, yaw: 0.744 }; // Moor Street, by the Bullring & Selfridges
const MODES = [['free', 'Free Roam', 'Explore the city centre, no timer'], ['sprint', 'Street Sprint', 'Point-to-point'], ['circuit', 'Circuit Race', 'Laps of a closed circuit'], ['trial', 'Time Trial', 'Beat your best time, bigger rewards'], ['meet', 'Car Meet', 'Park up and show off at the city car park']];

// ---- full screen: Android/desktop use the Fullscreen API (+ landscape lock); iPhone Safari has none for pages, so a
// small tip explains Share > Add to Home Screen, which opens the game full screen (manifest display: fullscreen)
const _fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
const _standalone = () => !!navigator.standalone || matchMedia('(display-mode: standalone)').matches; // home-screen app (the Fullscreen API also matches display-mode: fullscreen, so that is not used here)
function goFull() {
  try {
    const el = document.documentElement, rq = el.requestFullscreen || el.webkitRequestFullscreen;
    if (rq && !_fsEl()) { const pr = rq.call(el, { navigationUI: 'hide' }); if (pr && pr.then) pr.then(() => { try { screen.orientation?.lock?.('landscape').catch(() => {}); } catch (e) {} }).catch(() => {}); }
    else if (!rq && !_standalone() && /iPhone|iPod/.test(navigator.userAgent) && !localStorage.getItem('cz_fs_tip')) {
      localStorage.setItem('cz_fs_tip', '1'); const t = document.createElement('div'); t.className = 'fs-tip';
      t.innerHTML = 'For full screen on iPhone: tap <b>Share</b> then <b>Add to Home Screen</b>, and open CUZZY RACING from your home screen. <button type="button">OK</button>';
      t.querySelector('button').onclick = () => t.remove(); document.body.appendChild(t); setTimeout(() => t.remove(), 12000);
    }
  } catch (e) {}
}
window.CUZZY_goFull = goFull;
// back to full screen on the next tap if the player left it (e.g. swiped the system bar) during a race or menu
document.addEventListener('pointerup', () => { if (!_fsEl() && window.__czWantFs) goFull(); }, { passive: true });
document.addEventListener('fullscreenchange', () => { if (_fsEl()) window.__czWantFs = true; });

class App {
  constructor() {
    this.settings = defaults(); this.store = new Store(); this.stack = []; this.screen = 'boot'; this.session = null; this.paused = false;
    this.gfx = new Gfx($('#c'), this.settings); try { this.vr = new VR(this); } catch (e) { console.warn('vr', e); } this.audio = new AudioSys(this.settings); this.hud = new Hud(this);
    this.net = new Net(); this.voice = new Voice(this.net, this.settings, this.audio); this.setui = new SettingsUI(this); this.auth = new AuthUI(this);
    setAuthLost(() => this.authLost()); this.net.on('autherr', () => this.authLost());
    this.solo = { mode: 'circuit', route: 'inner_ring', laps: 2, time: 'day', weather: 'dry' };
    this.bindGlobal(); this.ow = new OpenWorld(this); this.uiAct = 0; this.nav = new UINav(this); this.rumble = new Rumble(null); Object.defineProperty(this.rumble, 's', { get: () => this.settings }); // keyboard / gamepad menu navigation
    this.radio = new Radio(this); // in-game radio (client/js/radio.js): replaces the old menu music, keeps playing into races
  }
  // ================================================================ boot with real loading progress
  async boot() {
    const parts = [['Car data', 'shared/cars.json', 60e3], ['Physics calibration', 'shared/calib.json', 5e3], ['Birmingham map', 'data/brum.json', 1.4e6], ['Race routes', 'data/routes.json', 3e5]];
    const total = parts.reduce((a, p) => a + p[2], 0) * 1.0; let done = 0; const got = {};
    const prog = (label, f) => { $('#loadstep').textContent = label; $('#loadbar').style.width = (f * 100).toFixed(1) + '%'; $('#loadpct').textContent = Math.round(f * 100) + '%'; };
    try {
      for (const [label, url, est] of parts) {
        const r = await fetch(url, { cache: 'no-cache' }); if (!r.ok) throw new Error(`${label} failed to load (${r.status})`);
        const len = +r.headers.get('content-length') || est; const rd = r.body.getReader(); const chunks = []; let n = 0;
        for (; ;) { const { done: d, value } = await rd.read(); if (d) break; chunks.push(value); n += value.length; prog(`Loading ${label.toLowerCase()}…`, 0.55 * (done + Math.min(n, len) / len * est) / total); }
        done += est; const buf = new Uint8Array(n); let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
        got[url] = JSON.parse(new TextDecoder().decode(buf));
      }
      this.cars = got['shared/cars.json']; this.calib = got['shared/calib.json']; this.data = got['data/brum.json']; this.routes = got['data/routes.json'];
      this.carsById = Object.fromEntries(this.cars.map(c => [c.id, c]));
      for (const [old, nu] of Object.entries({ rrsd300: 'rrs23' })) if (!this.carsById[old] && this.carsById[nu]) Object.defineProperty(this.carsById, old, { value: this.carsById[nu], enumerable: false }); // removed car (D300) -> its replacement, for old lobby/world messages
      registerCars(this.cars); loadTypes(); const realCars = preloadRealCars(['db9v']); // first-game 3D models load in the background while the city is built
      prog('Checking your account…', 0.57);
      await this.signIn();
      $('#boot').classList.add('show'); for (const s of document.querySelectorAll('.screen')) if (s.id !== 'boot') s.classList.remove('show'); this.screen = 'boot';
      prog('Loading your garage…', 0.58);
      await this.loadProfile();
      await this.buildWorld((s, f) => prog(`Building Birmingham: ${s}…`, 0.6 + f * 0.35));
      prog('Loading 3D car models…', 0.955); await Promise.race([Promise.all([realCars, ensureRealModel(this.store.profile.selected)]), new Promise(r => setTimeout(r, 25000))]); // only the intro car and the selected car load now; others load lazily when shown/driven // a stalled download must not block the game: those cars use their procedural bodies until the models arrive
      prog('Preparing cars…', 0.96); this.hud.buildMap(this.data, this.routes); this.showroom = new Showroom(this);
      this.setupIntroScene(); if (this.gfx.r.compileAsync) await Promise.race([this.gfx.r.compileAsync(this.gfx.scene, this.gfx.cam).catch(() => {}), new Promise(r => setTimeout(r, 15000))]); this.gfx.render(0); // shaders compile in parallel before the first frame (High froze on the first draw)
      prog('Ready', 1); $('#tapstart').hidden = false; $('.load').style.opacity = 0.35;
      this.loop();
    } catch (e) {
      console.error(e); const el = $('#booterr'); el.hidden = false; el.innerHTML = `${esc(e.message)}<br><button class="btn small" onclick="location.reload()">Try again</button>`;
    }
  }
  // sign-in gate on boot: a stored session token is checked with the server; otherwise the Sign in screen is shown
  async signIn() {
    let reason = '';
    if (this.store.signedIn) {
      for (let i = 0; ; i++) {
        try { await this.store.load(); return; }
        catch (e) { if (e.auth) { reason = 'Your session has ended — please sign in again.'; break; } if (i >= 2) throw new Error(e.message + ' Your garage and settings are stored on the server, so the game needs it to start.'); await new Promise(r => setTimeout(r, 1200)); }
      }
    }
    await this.auth.show(reason);
  }
  // the server refused our session (signed out elsewhere, expired or revoked): back to the Sign in screen
  authLost() {
    if (this.authLostShown || this.screen === 'auth' || this.screen === 'boot') return; this.authLostShown = true;
    try { this.endSession(); this.net.leave(); this.voice.stop(); } catch (e) { }
    this.modal('Signed out', 'Your session has ended (you signed out or it expired). Please sign in again.', [{ t: 'Sign in', cls: 'primary', f: () => location.reload() }]);
  }
  async signOut() {
    this.confirm('Sign out', `Sign out of <b>${esc(this.store.user?.name || '')}</b> on this device? Your progress stays saved on your account.`, 'Sign out', async () => {
      try { if (this.ow.active) this.ow.exit(); this.endSession(); this.net.leave(); this.voice.stop(); } catch (e) { }
      await this.busy('Signing out…', this.store.signOut()).catch(() => { }); location.reload();
    });
  }
  async loadProfile() {
    for (let i = 0; ; i++) {
      try { if (!this.store.profile) await this.store.load(); break; }
      catch (e) { if (i >= 2) throw new Error(e.message + ' Your garage and settings are stored on the server, so the game needs it to start.'); await new Promise(r => setTimeout(r, 1200)); }
    }
    merge(this.settings, this.store.profile.settings);
    { const lg = loadLocalGfx(); if (lg) merge(this.settings.graphics, lg); normalizeGfx(this.settings.graphics, lg || this.store.profile.settings?.graphics); } // this device's graphics win
    this.settings.voice.micMuted = true; // the microphone is always OFF when the game starts; the player switches it on
    const qg = new URLSearchParams(location.search).get('gfx'); if (qg && qg in PRESETS) applyPreset(this.settings.graphics, qg); // testing override
    this.store.on((p, st) => this.saveIndicator(st));
    this.gfx.apply();
  }
  async buildWorld(onProg) {
    if (this.world) { this.gfx.scene.remove(this.world.group); this.world.group.traverse(o => { o.geometry?.dispose(); }); }
    const g = this.settings.graphics; this.worldEnv = g.envDetail;
    this.world = new World(this.data, this.routes, { env: g.envDetail, shadows: g.shadows, aniso: IS_MOBILE ? 8 : 12 }, onProg);
    const grp = await this.world.build(); grp.traverse(o => { if (o.isMesh) o.receiveShadow = g.shadows > 0; }); this.gfx.scene.add(grp);
    { const sl = new StreetLife(this.world, this.settings, this.cars); grp.add(sl.build()); this.streetlife = sl; this.gfx.probeHide = sl.group; this.gfx.updaters = [(dt, c) => sl.update(dt, c)]; } // parked cars + pedestrians
  }
  // ================================================================ intro
  setupIntroScene() {
    const car = this.carsById.db9v; const h = this.world.groundAt(INTRO_SPOT.x, INTRO_SPOT.z, 0).h || 0;
    this.heroCar = buildCar(car, { detail: 2, colour: 0x0b0c10, plate: 'CUZZY' }); this.heroCar.position.set(INTRO_SPOT.x, h, INTRO_SPOT.z); this.heroCar.rotation.y = INTRO_SPOT.yaw;
    this.heroCar.traverse(o => { if (o.isMesh) o.castShadow = true; }); this.gfx.scene.add(this.heroCar); setLights(this.heroCar, { head: 1 }, false);
    this.menuT = 0; this.view = 'intro';
  }
  heroFor(id) { // menu background shows the player's chosen car
    const car = this.carsById[id]; const cu0 = this.store.profile.custom[id] || {}; const key = id + JSON.stringify(cu0) + realReady(id);
    if (this.heroKey === key && this.heroCar) return; this.heroId = id; this.heroKey = key; // rebuilt when the car OR its paint/wheels/tint change
    const cu = this.store.profile.custom[id] || {}; const pos = this.heroCar.position.clone(); const rot = this.heroCar.rotation.y;
    disposeCar(this.heroCar); this.heroCar = buildCar(car, { detail: 2, colour: cu.colour ?? car.colour, wheel: cu.wheel, tint: cu.tint, caliper: cu.caliper, finish: cu.finish, plate: 'CUZZY' });
    this.heroCar.position.copy(pos); this.heroCar.rotation.y = rot; this.heroCar.traverse(o => { if (o.isMesh) o.castShadow = true; }); this.gfx.scene.add(this.heroCar); setLights(this.heroCar, { head: 1 }, false);
  }
  async start() {
    goFull(); // the tap is a user gesture: go full screen and lock landscape where the browser allows it
    this.audio.unlock(); this.audio.click();
    try { await screen.orientation?.lock?.('landscape'); } catch (e) { }
    $('#boot').classList.remove('show');
    if (this.introPlayed) return this.go('menu', true);
    this.introPlayed = true; this.view = 'intro'; this.introT = 0; $('#introtitle').hidden = false;
    this.gfx.setTOD('sunset', false); this.world.update(0, false, false);
    const car = this.carsById.db9v; car._up = {};
    setTimeout(() => this.audio.engineStart(car, 2.8), 600);
    setTimeout(() => $('#introtitle').classList.add('on'), 2200);
    if (this.settings.sound.introOn && this.settings.sound.intro > 0) setTimeout(() => this.audio.playIntro(), 2600);
    this.introTimer = setTimeout(() => this.endIntro(), 7600);
    $('#skipintro').onclick = () => this.endIntro();
  }
  endIntro() {
    if (this.view !== 'intro') return; clearTimeout(this.introTimer); $('#introtitle').classList.remove('on'); setTimeout(() => $('#introtitle').hidden = true, 600);
    this.go('menu', true); if (!this.store.profile.tutorial) setTimeout(() => this.confirm('Welcome to CUZZY RACING', 'New here? The short tutorial covers driving, cameras and checkpoints. You can replay it any time from How to Play.', 'Play tutorial', () => this.startTutorial(), 'Not now', () => this.store.act('tutorial').catch(() => { })), 700);
  }
  // ================================================================ navigation
  go(name, root = false) {
    if (name === 'solo') return this.openSolo(); if (name === 'online') return this.quickMatch(); if (name === 'create') return this.createRoom(); if (name === 'join') return this.openJoin(); if (name === 'world') return this.ow.open();
    if (root) this.stack = []; else if (this.screen !== name && this.screen !== 'boot') this.stack.push(this.screen);
    this.show(name);
  }
  show(name) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('show', s.id === name);
    this.screen = name; const S = this.showroom; if (S) S.active = name === 'showroom' || name === 'upgrade';
    if (name === 'menu') { this.view = 'menu'; this.refreshWallet(); this.heroFor(this.store.profile.selected); this.gfx.setTOD('sunset', false); if (this.settings.sound.music > 0) this.audio.startMusic(); }
    if (S?.active) { this.view = 'showroom'; S.enter(name); this.refreshWallet(); }
    if (name === 'settings') this.setui.open();
    if (name === 'solo' && this.routes) this.renderSolo(); // e.g. back from 'Change car': show the newly chosen car
    if (name === 'lobby' && this.net.room) { if (this.net.room.state === 'lobby') this.net.send({ t: 'me', me: this.me() }); this.renderLobby(this.net.room); } // car/paint/upgrades changed in the showroom while in the room: tell the server (it re-reads the saved profile)
    if (name === 'howto') { $('#howto-body').innerHTML = howtoHTML(this.touchUI()); }
    if (!S?.active && name !== 'menu' && !this.session && name !== 'lobby' && this.view === 'showroom') this.view = 'menu';
    if (name === 'lobby' || name === 'settings' || name === 'howto' || name === 'join' || name === 'solo' || name === 'credits') if (this.view === 'showroom') this.view = 'menu';
    this.nav?.screenShown(name);
  }
  back() {
    this.audio.click('back');
    if (this.screen === 'lobby') return this.leaveRoom();
    if (this.screen === 'settings' && this.paused) { this.show('none'); $('#pause').hidden = false; return; }
    if (this.screen === 'upgrade' && this.showroom?.dirty() && !this.discardOK) return this.confirm('Discard changes?', 'You have upgrades or paint you have not confirmed. Leave the garage and discard them?', 'Discard', () => { this.showroom.discard(); this.discardOK = true; this.audio.click('back'); try { this.back(); } finally { this.discardOK = false; } }, 'Keep editing');
    if (this.screen === 'showroom' && this.returnTo) { const r = this.returnTo; this.returnTo = null; return this.go(r, false); }
    const prev = this.stack.pop() || 'menu'; this.show(prev);
  }
  bindGlobal() {
    $('#tapstart').onclick = () => this.start();
    $('#mi-fullscreen').onclick = () => { this.audio?.click?.(); this.fullscreenHelp(); };
    for (const b of document.querySelectorAll('[data-go]')) b.onclick = () => { this.audio.click(); this.go(b.dataset.go); };
    for (const b of document.querySelectorAll('.back')) if (b.id !== 'lobby-leave') b.onclick = () => this.back();
    { let fk = 'bug'; for (const c of document.querySelectorAll('#fb-kind .chip')) c.onclick = () => { fk = c.dataset.k; this.audio.click(); for (const d of document.querySelectorAll('#fb-kind .chip')) d.classList.toggle('on', d === c); };
      $('#fb-send').onclick = async () => { const m = $('#fb-msg').value.trim(), note = $('#fb-note'), btn = $('#fb-send'); if (m.length < 2) { note.textContent = 'Please write a message first.'; return; }
        btn.disabled = true; note.textContent = 'Sending…';
        const G = this.gfx; let ctx = {}; try { ctx = { screen: innerWidth + 'x' + innerHeight, gfx: this.settings?.graphics?.preset, fps: G?.measured ? Math.round(G.measured()) : null, gpu: G?.gpu, car: this.store.profile?.selected, ver: document.querySelector('script[src*="main.js"]')?.src.split('v=')[1] || null, ua: navigator.userAgent.slice(0, 200) }; } catch (e) { }
        try { await sendFeedback(fk, m, ctx); $('#fb-msg').value = ''; note.textContent = 'Thanks, your message has been sent to the developer.'; }
        catch (e) { note.textContent = e.message || 'Could not send. Check your connection and try again.'; }
        btn.disabled = false; }; }
    $('#lobby-leave').onclick = () => this.leaveRoom();
    $('#howto-tut').onclick = () => this.startTutorial();
    $('#h-pause').onclick = () => this.togglePause();
    $('#p-resume').onclick = () => this.togglePause(false);
    $('#p-restart').onclick = () => { const o = this.session.o; this.endSession(); this.launch(o); };
    $('#p-settings').onclick = () => { $('#pause').hidden = true; this.stack = []; this.show('settings'); };
    $('#p-players').onclick = () => this.playersPanel($('#p-extra'));
    $('#p-leave').onclick = () => { if (this.session?.o.worldRace) { this.net.send({ t: 'wr_quit' }); this.togglePause(false); return; } if (this.session?.online) this.confirm(this.ow.active ? 'Leave open world' : 'Leave room', this.ow.active ? 'Leave this open world and go back to the main menu?' : 'Leave this online room? The race carries on without you.', 'Leave', () => { this.endSession(); this.leaveRoom(true); }); else { const t = this.session?.o.mode === 'test'; this.endSession(); if (t) { const f = this.testFrom === 'upgrade' ? 'upgrade' : 'showroom'; this.stack = f === 'upgrade' ? ['menu', 'showroom'] : ['menu']; this.show(f); } else this.openSolo(true); } };
    $('#p-menu').onclick = () => this.confirm('Return to Main Menu', this.session?.online ? 'This leaves the online room. Continue?' : 'Your current run will be lost. Continue?', 'Return to menu', () => { const on = this.session?.online; this.endSession(); if (on) this.leaveRoom(true); this.go('menu', true); });
    addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (!$('#modal').hidden) { const c = $('#m-btns .btn.ghost') || ($('#m-btns').children.length === 1 && $('#m-btns .btn')); if (c) c.click(); return; } if (this.screen === 'auth') { $('#auth-back').click(); return; } if (!this.session && this.screen !== 'menu' && this.screen !== 'boot') this.back(); });
    addEventListener('resize', () => this.orient()); this.orient();
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.session && !this.session.online && !this.paused) this.togglePause(true); });
    // join form
    $('#join-go').onclick = () => this.joinRoom($('#join-code').value);
    $('#join-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('#join-go').click(); });
    // network events
    this.net.on('room', m => this.renderLobby(m));
    this.net.on('lobbywarn', m => { this.toast(`Room closes in ${m.left}s unless someone is active — press Keep room open`); this.audio.beep(520, 0.3, 'menu'); });
    this.net.on('start', m => this.startOnline(m));
    this.net.on('results', m => this.onlineResults(m));
    this.net.on('ended', () => { if (this.session?.online) { this.endSession(); this.show('lobby'); this.toast('The host ended the session'); } });
    this.net.on('expired', m => { this.endSession(); this.voice.stop(); this.modal('Room closed', esc(m.reason) + '. You can create a new room or join another one.', [{ t: 'OK' }]); this.go('menu', true); });
    this.net.on('removed', m => { if (Date.now() - (this.net.leftAt || 0) < 8000) return; /* our own Leave: already back on the menu, no "Removed" pop-up */ this.endSession(); this.voice.stop(); this.modal('Removed from room', esc(m.reason) + '.', [{ t: 'OK' }]); this.go('menu', true); });
    this.net.on('lost', () => { this.endSession(); this.voice.stop(); this.modal('Connection lost', 'We could not reconnect to the room within 3 minutes.', [{ t: 'OK' }]); this.go('menu', true); });
    this.net.on('left', m => { if (this.ow.active) return; if (m.newHost === this.net.me) this.toast('You are now the host'); else if (m.newHost) this.toast('Host left — host transferred'); });
    this.net.on('host', m => { if (this.ow.active) return; if (m.id === this.net.me) this.toast('You are now the host'); });
    this.net.on('err', m => { if (m.expired && this.screen === 'lobby') { this.modal('Room unavailable', esc(m.msg), [{ t: 'OK' }]); this.go('menu', true); } else if (this.screen === 'lobby' || this.session) { if (m.notready) this.confirm('Not everyone is ready', esc(m.msg) + '. Start anyway?', 'Start anyway', () => this.net.send({ t: 'start', force: true })); else this.toast(m.msg); } });
    this.net.on('info', m => this.toast(m.msg));
    this.net.on('status', st => { if (st === 'open' && this.net.code && this.reconnecting) { this.reconnecting = false; } if (st === 'reconnecting') { this.reconnecting = true; if (this.screen === 'lobby') this.toast('Connection lost — reconnecting…'); } });
    this.voice.onChange = () => { if (this.screen === 'lobby' && this.net.room) this.renderLobby(this.net.room); if (!$('#p-extra').hidden && $('#p-extra').innerHTML) this.playersPanel($('#p-extra')); };
  }
  touchUI() { return HAS_TOUCH && this.settings.controls.steer !== 'keyboard'; }
  orient() { $('#rotate').hidden = !(IS_MOBILE && innerHeight > innerWidth); }
  // ================================================================ helpers
  saveSettings() { saveLocalGfx(this.settings.graphics); this.store.saveSettings(this.settings); }
  applyGraphics() { this.gfx.apply(); if (this.session) this.gfx.setTOD(this.session.o.time || 'day', this.session.o.weather === 'rain'); }
  saveIndicator(st) {
    for (const el of [$('#savestate'), $('#set-save')]) {
      el.classList.toggle('failed', st === 'failed');
      el.innerHTML = st === 'saving' ? 'Saving…' : st === 'failed' ? `Save failed — ${esc(this.store.lastError || 'server unreachable')} <button class="btn small" id="retry-${el.id}">Retry</button>` : 'All progress saved';
      const b = el.querySelector('button'); if (b) b.onclick = () => this.store.saveSettings(this.settings);
    }
  }
  refreshWallet() {
    const p = this.store.profile; for (const e of document.querySelectorAll('.credits, #mf-credits')) e.textContent = num(p.credits);
    const c = this.carsById[p.selected]; $('#mf-car').innerHTML = `<span class="mf-user">${esc(this.store.user?.name || '')}</span> · Driving: <b>${esc(c.name)}</b> <span class="cls cls-${c.cls}">${c.cls}</span>`;
    if (this.screen === 'menu') this.heroFor(p.selected);
  }
  toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:90px;z-index:60'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 3200); }
  modal(title, html, btns = [{ t: 'OK' }]) {
    $('#m-title').textContent = title; $('#m-body').innerHTML = html; const bb = $('#m-btns'); bb.innerHTML = '';
    for (const b of btns) { const e = document.createElement('button'); e.className = 'btn ' + (b.cls || ''); e.textContent = b.t; e.onclick = async () => { if (b.keep) { await b.f?.(); return; } $('#modal').hidden = true; try { await b.f?.(); } catch (x) { } }; bb.appendChild(e); }
    $('#modal').hidden = false;
  }
  fullscreenHelp() {
    const el = document.documentElement, can = !!(el.requestFullscreen || el.webkitRequestFullscreen), ios = /iPhone|iPod|iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (_standalone()) { this.modal('Full Screen', '<p>You are already playing full screen from your home screen.</p>'); return; }
    const iphone = '<p><b>iPhone and iPad (Safari)</b></p><ol class="fs-steps"><li>Tap the <b>Share</b> button (the square with an arrow) at the bottom or top of Safari.</li><li>Scroll down and tap <b>Add to Home Screen</b>, then tap <b>Add</b>.</li><li>Close Safari and open <b>CUZZY RACING</b> from your home screen — it runs full screen with no address bar.</li></ol><p class="fs-note">Safari does not let websites hide the address bar, so this is the only way on iPhone. Sign in once in the home-screen app.</p>';
    const other = '<p><b>Android and computers</b></p><p>' + (_fsEl() ? 'You are playing full screen now. The game goes full screen each time you tap to start.' : 'Tap <b>Go full screen</b> below. If you leave full screen, the next tap brings it back.') + '</p>';
    const btns = [{ t: 'Close', cls: 'ghost' }]; if (can && !_fsEl()) btns.push({ t: 'Go full screen', cls: 'primary', f: () => goFull() }); else if (_fsEl()) btns.push({ t: 'Exit full screen', cls: 'primary', f: () => { window.__czWantFs = false; (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); } });
    this.modal('Full Screen', ios ? iphone : other + '<p class="fs-note"><b>On iPhone:</b> in Safari tap Share › Add to Home Screen › Add, then open CUZZY RACING from your home screen.</p>', btns);
  }
  confirm(title, msg, yes, f, no = 'Cancel', fno) { this.modal(title, msg, [{ t: no, cls: 'ghost', f: fno }, { t: yes, cls: 'primary', f }]); }
  prompt(title, msg, def, f) { this.modal(title, `<p>${esc(msg)}</p><input id="m-in" maxlength="20" style="width:100%" value="${esc(def)}">`, [{ t: 'Cancel', cls: 'ghost' }, { t: 'Save', cls: 'primary', f: () => f($('#m-in').value.trim() || def) }]); }
  async busy(label, p) {
    $('#busy-t').textContent = label; const t = setTimeout(() => $('#busy').hidden = false, 150);
    try { return await p; } catch (e) { this.modal('Something went wrong', esc(e.message), [{ t: 'OK' }]); throw e; } finally { clearTimeout(t); $('#busy').hidden = true; }
  }
  // ================================================================ solo
  openSolo(root) {
    if (root) this.stack = ['menu']; else if (this.screen !== 'solo') this.stack.push(this.screen);
    this.show('solo'); this.renderSolo();
  }
  renderSolo() {
    const s = this.solo; const R = this.routes.routes;
    const chips = (id, list, key, f) => { $(id).innerHTML = list.map(([v, t]) => `<button class="chip ${s[key] === v ? 'on' : ''}" data-v="${v}">${t}</button>`).join(''); for (const b of $(id).querySelectorAll('.chip')) b.onclick = () => { s[key] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v; f?.(); this.audio.click(); this.renderSolo(); }; };
    chips('#solo-mode', MODES.map(m => [m[0], m[1]]), 'mode', () => { const ok = R.filter(r => this.routeOk(r)); if (ok.length && !ok.find(r => r.id === s.route)) s.route = ok[0].id; const r = R.find(r => r.id === s.route); s.laps = r?.laps || 1; });
    const needRoute = ['sprint', 'circuit', 'trial'].includes(s.mode);
    $('#solo-route-wrap').hidden = !needRoute;
    $('#solo-route').innerHTML = R.filter(r => this.routeOk(r)).map(r => { const rec = this.store.profile.records[`${r.id}:${r.mode === 'circuit' ? s.laps : 1}:${s.mode === 'trial' ? 'trial' : 'race'}`]; return `<button class="card ${s.route === r.id ? 'on' : ''}" data-r="${r.id}"><b>${esc(r.name)}</b><small>${esc(r.desc)}</small><div class="meta">${r.mode === 'circuit' ? 'Circuit' : 'Sprint'} · ${(r.length / 1000).toFixed(1)} km${r.mode === 'circuit' ? ' per lap' : ''} · ${r.cps.length} checkpoints${rec ? ` · Best ${fmt(rec.time)}` : ''}</div></button>`; }).join('');
    for (const b of document.querySelectorAll('#solo-route .card')) b.onclick = () => { s.route = b.dataset.r; this.audio.click(); this.renderSolo(); };
    const r = R.find(x => x.id === s.route);
    $('#solo-laps-wrap').hidden = !(needRoute && r?.mode === 'circuit');
    chips('#solo-laps', [[1, '1'], [2, '2'], [3, '3'], [5, '5']], 'laps');
    chips('#solo-time', [['day', 'Day'], ['sunset', 'Sunset'], ['night', 'Night']], 'time');
    chips('#solo-weather', [['dry', 'Dry'], ['rain', 'Rain']], 'weather');
    { // AI opponents (solo sprints / circuits): count 0-7 and difficulty, saved in settings.game
      let w = document.getElementById('solo-ai-wrap'); const G = this.settings.game;
      if (!w) { w = document.createElement('div'); w.id = 'solo-ai-wrap'; w.className = 'row2'; w.innerHTML = '<div><h3>Opponents</h3><div class="chips" id="solo-ai-n"></div></div><div><h3>Difficulty</h3><div class="chips" id="solo-ai-d"></div></div>'; $('#solo-laps-wrap').parentElement.after(w); }
      w.hidden = !['sprint', 'circuit'].includes(s.mode);
      const ch = (id, list, key) => { $(id).innerHTML = list.map(([v, t]) => `<button class="chip ${G[key] === v ? 'on' : ''}" data-v="${v}">${t}</button>`).join(''); for (const b of $(id).querySelectorAll('.chip')) b.onclick = () => { G[key] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v; this.audio.click(); this.saveSettings(); this.renderSolo(); }; };
      ch('#solo-ai-n', [0, 1, 2, 3, 4, 5, 6, 7].map(n => [n, n ? String(n) : 'None']), 'aiOpp');
      ch('#solo-ai-d', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']], 'aiDiff');
    }
    $('#solo-note').textContent = MODES.find(m => m[0] === s.mode)[2] + (needRoute ? (s.mode !== 'trial' && this.settings.game.aiOpp > 0 ? `. Race ${this.settings.game.aiOpp} AI driver${this.settings.game.aiOpp > 1 ? 's' : ''} and the clock for gold, silver or bronze. Roads are closed to traffic.` : '. Race against the clock for gold, silver or bronze. Roads are closed to traffic.') : '. Earn credits for distance driven (capped per minute).');
    const car = this.carsById[this.store.profile.selected]; $('#solo-car').innerHTML = `Car: <b>${esc(car.name)}</b> <span class="cls cls-${car.cls}">${car.cls}</span>`;
    $('#solo-go').onclick = () => { this.audio.click(); this.launch({ mode: s.mode, route: needRoute ? s.route : null, laps: s.laps, time: s.time, weather: s.weather }); };
  }
  routeOk(r) { const m = this.solo.mode; return m === 'trial' || (m === 'sprint' && r.mode === 'sprint') || (m === 'circuit' && r.mode === 'circuit'); }
  async launch(o) {
    const p = this.store.profile; const car = o.carObj || this.carsById[p.selected];
    if (this.settings.graphics.envDetail !== this.worldEnv) await this.busy('Rebuilding the city…', this.buildWorld());
    if (!realReady(car.id)) await this.busy('Loading 3D car model…', Promise.race([ensureRealModel(car.id), new Promise(r => setTimeout(r, 25000))])); // lazy per-type model, same 25 s fallback
    if (aiWanted(o) && !o.ai) { const G = this.settings.game; o = { ...o, ai: pickField(G.aiOpp ?? 5, G.aiDiff || 'normal') }; } // solo AI field (Race again / Restart keep it)
    if (o.ai?.field?.length) { const ids = [...new Set(o.ai.field.map(f => f.car))].filter(id => !realReady(id)); if (ids.length) await this.busy('Loading opponents…', Promise.race([Promise.all(ids.map(id => ensureRealModel(id))), new Promise(r => setTimeout(r, 25000))])); }
    this.audio.stopMusic(); this.heroCar.visible = false; $('#pause').hidden = true; this.paused = false;
    for (const s of document.querySelectorAll('.screen')) s.classList.remove('show'); this.screen = 'game'; this.showroom.active = false;
    this._racing = true; try { this.session = new Session(this, { ...o, car, ups: o.ups ?? (o.stock ? {} : p.ups[car.id] || {}), custom: o.custom ?? p.custom[car.id] ?? {} }); } finally { this._racing = false; }
    this.view = 'game'; if (o.mode === 'tutorial') this.tutorial = new Tutorial(this);
  }
  endSession() {
    if (!this.session) return; this.session.dispose(); this.session = null; this.tutorial?.end(); this.tutorial = null; this.paused = false; $('#pause').hidden = true; $('#p-extra').innerHTML = '';
    this.heroCar.visible = true; this.view = 'menu'; this.gfx.cam.fov = 62;
  }
  testDrive(car, ups, look) {
    this.testFrom = this.screen; this.launch({ mode: 'test', carObj: car, ups: ups || this.store.profile.ups[car.id] || {}, custom: { ...(this.store.profile.custom[car.id] || {}), ...(look || {}) }, time: 'day', weather: 'dry' });
    this.toast(`Test drive: ${car.name} — pause to end`);
  }
  startTutorial() { this.launch({ mode: 'tutorial', route: 'inner_ring', laps: 1, time: 'day', weather: 'dry' }); }
  togglePause(v) {
    if (!this.session || this.session.state === 'finished' && !this.session.online) return;
    this.paused = v ?? !this.paused; this.session.paused = this.paused;
    $('#pause').hidden = !this.paused; $('#p-extra').innerHTML = '';
    const on = this.session.online; $('#pause-online').hidden = !on; $('#p-players').hidden = !on; $('#p-restart').hidden = on || this.session.o.mode === 'test';
    $('#p-leave').textContent = this.session.o.worldRace ? 'Quit race (back to open world)' : this.session.o.mode === 'world' ? 'Leave open world' : on ? 'Leave room' : this.session.o.mode === 'test' ? 'End test drive' : 'Leave race'; $('.pause-card h2').textContent = on ? 'Menu' : 'Paused';
    if (this.audio.ctx) this.paused && !on ? this.audio.ctx.suspend() : this.audio.ctx.resume();
  }
  showResults(sess, r) {
    this.endSession(); this.stack = ['menu'];
    const sold = sess.o; const rec = r?.record; const car = sess.car;
    $('#res-title').textContent = sold.mode === 'trial' ? 'Time Trial' : 'Race Complete';
    $('#res-body').innerHTML = r?.error ? `<p class="err">${esc(r.error)}</p><p class="note">Your time was ${fmt(sess.finalT)} but no reward was saved.</p>` : `
      <div class="medal ${r.medal || ''}">${r.medal ? r.medal + ' medal' : 'Finished'}</div>
      <p style="font-size:34px;font-family:var(--disp);margin:0">${fmt(sess.finalT)}${sess.penalty ? ` <small style="font-size:16px;color:#94a0ad">incl. ${sess.penalty}s reset penalty</small>` : ''}</p>
      <p class="note">${esc(sess.route.name)} · ${esc(car.name)} · Par ${fmt(r.par)} (gold under ${fmt(r.par * 0.85)})</p>
      ${sess.standings ? `<p style="font-size:20px;font-weight:700;margin:4px 0">Position ${sess.place}/${sess.standings.length}</p><table class="res-table" id="res-standings" style="margin:0 auto 8px;border-collapse:collapse;font-size:14px;text-align:left">${sess.standings.map((x, i) => `<tr style="${x.me ? 'color:var(--acc);font-weight:700' : ''}"><td style="padding:2px 10px">P${i + 1}</td><td style="padding:2px 10px">${esc(x.name)}</td><td style="padding:2px 10px;color:#94a0ad">${esc(x.car)}</td><td style="padding:2px 10px;text-align:right">${fmt(x.time)}${x.est ? ' (est.)' : ''}</td></tr>`).join('')}</table>` : ''}
      ${rec ? '<p style="color:var(--acc);font-weight:700">New personal record! +500 cr</p>' : ''}
      <p style="font-size:22px">+${num(r.reward)} credits <span class="note">· balance ${num(this.store.profile.credits)}</span></p>`;
    $('#res-foot').innerHTML = `<button class="btn ghost" id="r-menu">Main menu</button><button class="btn" id="r-garage">Garage</button><button class="btn primary" id="r-again">Race again</button>`;
    $('#r-menu').onclick = () => this.go('menu', true); $('#r-garage').onclick = () => this.go('showroom', true); $('#r-again').onclick = () => this.launch(sold);
    this.show('results'); this.view = 'menu';
  }
  // ================================================================ online
  async ensureNet() {
    if (this.net.ws && this.net.ws.readyState === 1) return;
    await this.busy('Connecting to the multiplayer server…', this.net.connect());
  }
  me() { const p = this.store.profile; const c = p.custom[p.selected] || {}; return { name: this.store.user?.name || p.name, car: p.selected, colour: c.colour ?? this.carsById[p.selected].colour }; }
  async askName() { return true; } // the driver name is the account username
  async quickMatch() { if (!(await this.askName())) return; try { await this.ensureNet(); } catch (e) { return; } this.stack = ['menu']; this.net.send({ t: 'quick', me: this.me() }); this.awaitJoin(); }
  async createRoom() { if (!(await this.askName())) return; try { await this.ensureNet(); } catch (e) { return; } this.stack = ['menu']; this.net.send({ t: 'create', private: true, me: this.me() }); this.awaitJoin(); }
  openJoin() { this.stack.push(this.screen); this.show('join'); $('#join-as').textContent = this.store.user?.name || ''; $('#join-err').hidden = true; setTimeout(() => $('#join-code').focus(), 50); }
  async joinRoom(code) {
    code = (code || '').toUpperCase().replace(/[^A-Z]/g, ''); if (code.length !== 5) { $('#join-err').hidden = false; $('#join-err').textContent = 'Invite codes are 5 letters.'; return; }
    try { await this.ensureNet(); } catch (e) { $('#join-err').hidden = false; $('#join-err').textContent = e.message; return; }
    const off = this.net.on('err', m => { off(); $('#join-err').hidden = false; $('#join-err').textContent = m.msg; });
    this.net.send({ t: 'join', code, me: this.me() }); this.awaitJoin(off);
  }
  awaitJoin(offErr) {
    $('#busy').hidden = false; $('#busy-t').textContent = 'Joining room…';
    const off = this.net.on('joined', m => { off(); offErr?.(); $('#busy').hidden = true; this.stack = ['menu']; this.net.wantOpen = true; if (m.kind === 'world') this.ow.enter(m); else this.show('lobby'); if (this.settings.voice.enabled) this.voice.start(); });
    setTimeout(() => { $('#busy').hidden = true; }, 6000);
    const off2 = this.net.on('err', () => { off2(); $('#busy').hidden = true; });
  }
  leaveRoom(silent) {
    const go = () => { if (this.ow.active) this.ow.exit(); this.net.leave(); this.voice.stop(); this.go('menu', true); };
    if (silent) return go(); this.confirm('Leave room', 'Leave this room?', 'Leave', go);
  }
  renderLobby(m) {
    if (this.session && m.state === 'lobby' && this.session.online && this.session.state !== 'finished') { /* session ended by server */ }
    if (this.screen !== 'lobby') return;
    const me = this.net.me; const host = m.host === me; const S = m.settings; const R = this.routes.routes;
    $('#lobby-title').textContent = m.private ? 'Private room' : 'Public room'; $('#lobby-code').textContent = m.code; $('#lobby-codebox').hidden = false;
    $('#lobby-copy').onclick = async () => { const t = `Join my CUZZY RACING room — invite code ${m.code}`; try { if (navigator.share && IS_MOBILE) await navigator.share({ text: t }); else { await navigator.clipboard.writeText(t); this.toast('Invite copied'); } } catch (e) { this.toast('Invite code: ' + m.code); } };
    $('#lobby-count').textContent = `${m.players.length}/8`;
    $('#lobby-players').innerHTML = m.players.map(p => { const car = this.carsById[p.car]; const isMe = p.id === me; const muted = this.settings.voice.muted[p.id];
      return `<li class="${p.away ? 'away' : ''}"><span class="spk ${this.voice.speaking.get(isMe ? 'me' : p.id) ? 'on' : ''}" title="Speaking"></span><div class="nm">${esc(p.name)}${isMe ? ' (you)' : ''} ${p.host ? '<span class="tag-host">HOST</span>' : ''}<small>${esc(car?.name || p.car)} · class ${car?.cls}${p.away ? ' · reconnecting…' : ''}</small></div>
      ${!isMe ? `<button class="btn small ghost" data-mute="${p.id}">${muted ? 'Unmute' : 'Mute'}</button>` : ''}${host && !isMe ? `<button class="btn small ghost" data-kick="${p.id}">Remove</button>` : ''}
      <span class="rdy ${p.ready || p.host ? 'y' : ''}">${p.host ? 'HOST' : p.ready ? 'READY' : 'NOT READY'}</span></li>`; }).join('');
    for (const b of document.querySelectorAll('[data-mute]')) b.onclick = () => { const id = b.dataset.mute; this.voice.mute(id, !this.settings.voice.muted[id]); this.saveSettings(); this.renderLobby(this.net.room); };
    for (const b of document.querySelectorAll('[data-kick]')) b.onclick = () => this.confirm('Remove player', 'Remove this player from the room?', 'Remove', () => this.net.send({ t: 'kick', id: b.dataset.kick }));
    // voice bar
    const vs = this.settings.voice; $('#lobby-voice').innerHTML = this.voiceBar(); this.bindVoiceBar($('#lobby-voice'), () => this.renderLobby(this.net.room));
    // settings
    const modeOpts = [['circuit', 'Circuit Race'], ['sprint', 'Street Sprint'], ['free', 'Free Roam'], ['meet', 'Car Meet']];
    const racing = S.mode === 'circuit' || S.mode === 'sprint'; const rts = R.filter(r => r.mode === S.mode);
    const dis = host ? '' : 'disabled';
    $('#lobby-hostnote').textContent = host ? '(you are the host)' : '(set by the host)';
    $('#lobby-settings').innerHTML = `<div class="chips">${modeOpts.map(([k, t]) => `<button class="chip ${S.mode === k ? 'on' : ''}" data-s="mode" data-v="${k}" ${dis}>${t}</button>`).join('')}</div>
      ${racing ? `<div class="cards" style="margin-top:8px">${rts.map(r => `<button class="card ${S.route === r.id ? 'on' : ''}" data-s="route" data-v="${r.id}" ${dis}><b>${esc(r.name)}</b><div class="meta">${(r.length / 1000).toFixed(1)} km · ${r.cps.length} CPs</div></button>`).join('')}</div>` : ''}
      <div class="row2">${S.mode === 'circuit' ? `<div><h3>Laps</h3><div class="chips">${[1, 2, 3, 5].map(n => `<button class="chip ${S.laps === n ? 'on' : ''}" data-s="laps" data-v="${n}" ${dis}>${n}</button>`).join('')}</div></div>` : ''}
      <div><h3>Class limit</h3><div class="chips">${['any', 'C', 'B', 'A', 'S1', 'S2'].map(c => `<button class="chip ${S.cls === c ? 'on' : ''}" data-s="cls" data-v="${c}" ${dis}>${c === 'any' ? 'Any' : c}</button>`).join('')}</div></div>
      <div><h3>Upgrades</h3><div class="chips"><button class="chip ${!S.stock ? 'on' : ''}" data-s="stock" data-v="0" ${dis}>Allowed</button><button class="chip ${S.stock ? 'on' : ''}" data-s="stock" data-v="1" ${dis}>Stock only</button></div></div>
      <div><h3>Time</h3><div class="chips">${[['day', 'Day'], ['sunset', 'Sunset'], ['night', 'Night']].map(([k, t]) => `<button class="chip ${S.time === k ? 'on' : ''}" data-s="time" data-v="${k}" ${dis}>${t}</button>`).join('')}</div></div>
      <div><h3>Weather</h3><div class="chips">${[['dry', 'Dry'], ['rain', 'Rain']].map(([k, t]) => `<button class="chip ${S.weather === k ? 'on' : ''}" data-s="weather" data-v="${k}" ${dis}>${t}</button>`).join('')}</div></div></div>`;
    for (const b of document.querySelectorAll('#lobby-settings [data-s]')) b.onclick = () => { const k = b.dataset.s; let v = b.dataset.v; if (k === 'laps') v = +v; if (k === 'stock') v = v === '1'; const s = { [k]: v }; if (k === 'mode' && (v === 'circuit' || v === 'sprint')) s.route = R.find(r => r.mode === v).id; this.net.send({ t: 'settings', s }); this.audio.click(); };
    // car picker
    const p = this.store.profile; const mine = m.players.find(x => x.id === me);
    const order = ['D', 'C', 'B', 'A', 'S1', 'S2', 'X']; const okc = c => S.cls === 'any' || order.indexOf(c.cls) <= order.indexOf(S.cls);
    $('#lobby-car').innerHTML = `<chip-select id="lc-sel" aria-label="Your car">${this.cars.filter(c => p.owned[c.id]).map(c => `<option value="${c.id}" ${mine?.car === c.id ? 'selected' : ''} ${okc(c) ? '' : 'disabled'}>${esc(c.name)} (${c.cls})${okc(c) ? '' : ' — over class limit'}</option>`).join('')}</chip-select><button class="btn small ghost" id="lc-shop">Showroom</button>`;
    $('#lc-sel').onchange = async e => { try { await this.store.act('select', { car: e.target.value }); } catch (x) { } this.net.send({ t: 'me', me: this.me() }); };
    $('#lc-shop').onclick = () => { this.returnTo = 'lobby'; this.stack = []; this.show('showroom'); };
    // ready / start / timeout
    const rb = $('#lobby-ready'); rb.hidden = host; rb.textContent = mine?.ready ? 'Not ready' : 'Ready'; rb.classList.toggle('on', !!mine?.ready); rb.onclick = () => this.net.send({ t: 'ready', v: !mine?.ready });
    const sb = $('#lobby-start'); sb.hidden = !host; sb.textContent = m.state === 'lobby' ? (racing ? 'Start race' : 'Start session') : 'In progress…'; sb.disabled = m.state !== 'lobby'; sb.onclick = () => { this.net.send({ t: 'start' }); };
    $('#lobby-keep').onclick = () => { this.net.send({ t: 'keep' }); this.toast('Room kept open for another 3 minutes'); };
    if (m.state !== 'lobby' && !this.session) { $('#lobby-timeout').textContent = 'Session in progress — you will join on the next start.'; }
    this.lobbyDeadline = m.deadline ? m.deadline - (m.now - this.net.now()) * 0 : null; this.lobbyTick();
  }
  lobbyTick() {
    clearTimeout(this.ltT); if (this.screen !== 'lobby' || !this.net.room) return;
    const d = this.net.room.deadline; if (!d) { $('#lobby-timeout').textContent = ''; return; }
    const left = Math.max(0, Math.round(d - this.net.now())); const el = $('#lobby-timeout');
    el.classList.toggle('warn', left <= 30); el.textContent = left <= 30 ? `Room closes in ${left}s without activity — press Keep room open` : `Room stays open while active · closes after 3 min idle (${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')})`;
    this.ltT = setTimeout(() => this.lobbyTick(), 1000);
  }
  // ---- voice: shared controls (lobby, open world panel, pause menu, HUD MIC button)
  voiceBar() {
    const v = this.voice, vs = this.settings.voice;
    if (!vs.enabled || !v.enabled) return `<span>${!vs.enabled ? 'Voice chat is off' : esc(v.error || 'Not in voice chat')}</span> <button class="btn small primary" id="v-on">Join voice chat</button>`;
    const n = (this.net.room?.players || []).filter(p => p.id !== this.net.me && p.vl && !p.away).length;
    return `<button class="btn small ${vs.micMuted ? '' : 'on'}" id="v-mic" aria-pressed="${!vs.micMuted}">${vs.micMuted ? 'Mic OFF — tap to talk' : 'Mic ON'}</button>
      ${v.micErr ? `<span class="note">${esc(v.error || '')}</span>` : ''}<button class="btn small ghost" id="v-players">Voice &amp; players…</button><span>${n} other${n === 1 ? '' : 's'} in voice · via game server</span>`;
  }
  bindVoiceBar(root, redraw) {
    const q = id => $(id, root), v = this.voice, vs = this.settings.voice;
    q('#v-on') && (q('#v-on').onclick = async () => { vs.enabled = true; this.saveSettings(); this.audio.unlock(); await v.start(); redraw(); });
    q('#v-mic') && (q('#v-mic').onclick = async () => { await this.toggleMic(); redraw(); });
    q('#v-players') && (q('#v-players').onclick = () => { this.modal('Players & voice', '<div id="pp"></div>', [{ t: 'Done' }]); this.playersPanel($('#pp')); });
  }
  // open mic ON/OFF. The first time it is switched on we explain what happens and then the browser asks for permission.
  async toggleMic() {
    const v = this.voice, vs = this.settings.voice;
    if (!vs.micMuted) { vs.micMuted = true; await v.applyMic(); this.saveSettings(); this.toast('Mic OFF'); return false; }
    if (!vs.micAsked) {
      const ok = await new Promise(res => this.modal('Turn your microphone on?', `<p>Voice chat is an <b>open mic</b>: while your mic is ON, other drivers in your room (or near you in the open world) hear you whenever you speak. Silence is not sent.</p><p>Your voice goes <b>through the CUZZY RACING server</b> — never directly to other players, so they can't see your IP address. Nothing is recorded.</p><p>Your browser will now ask for microphone permission. You can switch the mic OFF at any time with the <b>MIC</b> button.</p>`, [{ t: 'Not now', cls: 'ghost', f: () => res(false) }, { t: 'Allow microphone', cls: 'primary', f: () => res(true) }]));
      if (!ok) return false; vs.micAsked = true; this.saveSettings();
    }
    this.audio.unlock(); if (!vs.enabled) { vs.enabled = true; }
    if (!v.enabled && this.net.room) await v.start();
    const on = await v.micOn();
    if (!on) { vs.micMuted = true; this.micHelp(v.micErr); v.onChange(); return false; }
    vs.micMuted = false; await v.applyMic(); this.saveSettings(); this.toast('Mic ON — others hear you when you speak');
    if (!this.net.room) { v.micOff(); } // outside a room the mic is only switched on when you join one
    return true;
  }
  micHelp(err) {
    const denied = err === 'NotAllowedError' || err === 'SecurityError';
    const body = denied ? `<p>The browser blocked the microphone, so your mic stays <b>OFF</b>. You can still hear other players.</p><p><b>To allow it:</b></p><ul>
        <li><b>iPhone / iPad (Safari):</b> tap <b>aA</b> in the address bar › Website Settings › Microphone › Allow — or Settings › Safari › Microphone.</li>
        <li><b>Android (Chrome):</b> tap the icon left of the address › Permissions › Microphone › Allow.</li>
        <li><b>Desktop:</b> click the icon left of the address bar › Microphone › Allow, then reload if asked.</li></ul><p>Then tap <b>MIC</b> again.</p>`
      : err === 'NotFoundError' ? '<p>No microphone was found on this device. Plug one in (or pick another in Settings › Voice chat) and tap MIC again. You can still hear other players.</p>'
      : `<p>The microphone could not be started (${esc(err || 'unknown error')}). Your mic stays OFF; you can still hear other players.</p>`;
    this.modal(denied ? 'Microphone blocked' : 'Microphone unavailable', body, [{ t: 'OK' }]);
  }
  playersPanel(el) {
    const m = this.net.room; if (!m) return; const vs = this.settings.voice;
    el.innerHTML = `<h3 style="margin:14px 0 6px">Players</h3><ul class="plist">${m.players.filter(p => p.id !== this.net.me).map(p => `<li><span class="spk ${this.voice.speaking.get(p.id) ? 'on' : ''}"></span><div class="nm">${esc(p.name)}<small>${this.voice.status(p)}</small></div>
      <input type="range" min="0" max="1" step="0.05" value="${vs.playerVol[p.id] ?? 1}" data-vol="${p.id}" aria-label="Volume">
      <button class="btn small ghost" data-m="${p.id}">${vs.muted[p.id] ? 'Unmute' : 'Mute'}</button><button class="btn small ghost" data-b="${p.id}">Block</button><button class="btn small ghost" data-r="${p.id}">Report</button></li>`).join('') || '<li>No other players</li>'}</ul>
      <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn small" id="pp-all">${vs.muteAll ? 'Unmute all' : 'Mute all'}</button><button class="btn small" id="pp-mic">${vs.micMuted ? 'Mic OFF — turn on' : 'Mic ON — turn off'}</button></div>`;
    for (const r of el.querySelectorAll('[data-vol]')) r.oninput = () => { vs.playerVol[r.dataset.vol] = +r.value; this.voice.applyVol(r.dataset.vol); this.saveSettings(); };
    for (const b of el.querySelectorAll('[data-m]')) b.onclick = () => { this.voice.mute(b.dataset.m, !vs.muted[b.dataset.m]); this.saveSettings(); this.playersPanel(el); };
    for (const b of el.querySelectorAll('[data-b]')) b.onclick = () => { this.voice.block(b.dataset.b); this.toast('Player blocked — you will not hear each other'); this.playersPanel(el); };
    for (const b of el.querySelectorAll('[data-r]')) b.onclick = () => this.prompt('Report player', 'What happened? (sent to the server log for moderation)', 'Abusive voice chat', r => this.net.send({ t: 'report', id: b.dataset.r, reason: r }));
    el.querySelector('#pp-all').onclick = () => { vs.muteAll = !vs.muteAll; this.voice.applyAll(); this.saveSettings(); this.playersPanel(el); };
    el.querySelector('#pp-mic').onclick = async () => { await this.toggleMic(); this.playersPanel(el); };
  }
  startOnline(m) {
    const S = m.settings; const slot = m.slots[this.net.me] ?? 0; const p = this.store.profile; const mine = this.net.room?.players.find(x => x.id === this.net.me);
    const car = this.carsById[mine?.car || p.selected];
    this.endSession();
    const t0 = m.t0 + (this.net.now() - m.now) * 0; // server time base
    this.launch({ mode: S.mode, route: ['circuit', 'sprint'].includes(S.mode) ? S.route : null, laps: S.laps, time: S.time, weather: S.weather, online: true, net: this.net, slot, t0: m.t0, late: m.late, stock: S.stock, carObj: car, ups: S.stock ? {} : p.ups[car.id] || {} });
  }
  onlineResults(m) {
    const me = this.net.me; if (this.session?.online) this.endSession();
    $('#res-title').textContent = 'Race results';
    $('#res-body').innerHTML = `<table class="res-table"><tr><th>Pos</th><th>Driver</th><th>Car</th><th>Time</th><th>Credits</th></tr>${m.results.map(r => `<tr class="${r.id === me ? 'me' : ''}"><td>${r.pos ?? 'DNF'}</td><td>${esc(r.name)}</td><td>${esc(this.carsById[r.car]?.name || r.car)}</td><td>${fmt(r.time)}</td><td>+${num(r.reward)}</td></tr>`).join('')}</table><p class="note">Times and positions are validated by the server. Credits have been added to each player's garage.</p>`;
    $('#res-foot').innerHTML = `<button class="btn ghost" id="r-leave">Leave room</button><button class="btn primary" id="r-lobby">Back to lobby</button>`;
    $('#r-leave').onclick = () => this.leaveRoom(true); $('#r-lobby').onclick = () => { this.show('lobby'); this.renderLobby(this.net.room); };
    this.store.load().then(() => this.refreshWallet()).catch(() => { });
    this.show('results'); this.view = 'menu';
  }
  // ================================================================ main loop
  loop() {
    // frame limiter by rAF skipping: a frame is drawn when at least one target interval (less half a display refresh, so
    // 30 on a 60 Hz screen is every 2nd vsync, 60 on 120 Hz every 2nd) has passed. The display refresh rate is measured
    // from the rAF rate itself (gfx.rafTick); a target at or above it draws every vsync.
    let last = performance.now(), simT = last;
    const frame = t => {
      requestAnimationFrame(frame);
      if (this.vr?.active && !this.vr.sim) return; // the XR session drives the loop (setAnimationLoop)
      const G = this.gfx; G.rafTick(t);
      const tgt = this.settings.graphics.fps || 60, hz = G.displayHz || 60; const dt = (t - last) / 1000;
      if (tgt < hz - 5 && dt * 1000 < 1000 / tgt - 500 / hz) return; last = t;
      // frame pacing: rAF timestamps jitter by ~0.1-2 ms around the vsync grid, and that jitter went straight into the
      // simulation step (uneven motion at a steady 60/120 fps). Snap the frame time to a whole number of display refreshes
      // when it is within 25% of one, and keep a clock that re-syncs if it drifts more than 2 refreshes from real time.
      const vs = 1000 / (G.stat.hz || hz); let ms = dt * 1000; const k = Math.round(ms / vs);
      if (k >= 1 && Math.abs(ms - k * vs) < vs * 0.25) ms = k * vs; simT += ms; if (Math.abs(t - simT) > 2 * vs) { ms += t - simT; simT = t; }
      const d = Math.min(0.1, Math.max(0, ms / 1000)); const w0 = performance.now();
      try { this.tick(d); } catch (e) { console.error(e); }
      G.frameDone(t, performance.now() - w0);
    };
    requestAnimationFrame(frame);
  }
  tick(dt) {
    const G = this.gfx;
    if (this.session) { G.cam.clearViewOffset(); this.session.update(dt); G.render(dt, this.session.obj.position, this.session.obj); return; }
    if (this.view === 'showroom') { this.showroom.update(dt); G.r.render(this.showroom.scene, this.showroom.cam); return; }
    // intro / menu camera around the hero car
    this.menuT += dt; const c = this.heroCar.position; const cam = G.cam;
    if (this.view === 'intro') {
      this.introT = (this.introT || 0) + dt; const k = Math.min(1, this.introT / 7);
      const a = INTRO_SPOT.yaw + 2.6 - k * 1.9; const r = 7.5 - k * 2.6; cam.position.set(c.x + Math.sin(a) * r, c.y + 0.6 + (1 - k) * 2.2, c.z + Math.cos(a) * r); cam.lookAt(c.x, c.y + 0.6, c.z);
      if (this.introT > 1.2 && this.introT < 4) this.heroCar.userData.body.rotation.x = Math.sin(this.introT * 40) * 0.002;
    } else {
      const a = INTRO_SPOT.yaw + 0.9 + Math.sin(this.menuT * 0.07) * 0.7; const wide = innerWidth > 760; cam.position.set(c.x + Math.sin(a) * 6.6, c.y + 1.25, c.z + Math.cos(a) * 6.6); cam.lookAt(c.x, c.y + 0.7, c.z);
      if (wide) { cam.setViewOffset(innerWidth, innerHeight, -innerWidth * 0.16, 0, innerWidth, innerHeight); } else cam.clearViewOffset();
    }
    cam.updateProjectionMatrix(); G.follow(c); this.world.update(this.menuT, G.night, false);
    G.render(dt, c, this.heroCar); if (this.view !== 'menu') cam.clearViewOffset();
  }
}

// ================================================================ tutorial
class Tutorial {
  constructor(app) {
    this.app = app; this.i = 0; this.t = 0; const touch = app.touchUI();
    this.steps = [
      { txt: touch ? 'Hold GAS to accelerate. Get up to 30 mph.' : 'Hold W or ↑ to accelerate. Get up to 30 mph.', ok: s => Math.abs(s.S.vx) * 2.237 > 30 },
      { txt: touch ? 'Steer with the ◀ ▶ buttons (or the wheel/tilt you chose). Turn left and right.' : 'Steer with A/D or ←/→. Turn left and right.', ok: s => { if (s.inp.steer > 0.5) this.l = 1; if (s.inp.steer < -0.5) this.r = 1; return this.l && this.r; } },
      { txt: touch ? 'Hold BRAKE to stop completely.' : 'Hold S or ↓ to brake to a stop.', ok: s => Math.abs(s.S.vx) < 0.5 },
      { txt: 'Keep holding brake while stopped to reverse. Reverse a few metres.', ok: s => s.S.reverse && s.S.vx < -1.5 },
      { txt: touch ? 'Tap CAM to change camera — try cockpit view.' : 'Press C to change camera — try cockpit view.', ok: s => s.camMode !== this.cam0 },
      { txt: 'Race gates glow teal. Follow the arrow and drive through the next 3 gates. Tap ↺ (or R) if you get stuck.', ok: s => s.cp >= 3, gates: true },
      { txt: 'Tutorial complete. +2,000 credits. Pause and return to the menu when you are ready.', ok: () => false, done: true },
    ];
    $('#tut').hidden = false; $('#tut-skip').textContent = 'Skip tutorial'; $('#tut-skip').onclick = () => this.finish(true); this.show();
    app.session.gate.visible = app.session.arrow.visible = false; app.session.cps = app.session.route.cps.slice(0, 3); app.session.state = 'drive'; app.session.isRace = false; this.cam0 = app.session.camMode;
  }
  show() { $('#tut-text').textContent = this.steps[this.i].txt; }
  update(s, dt) {
    const st = this.steps[this.i]; if (!st || st.done) return;
    if (st.gates && !s.isRace) { s.isRace = true; s.state = 'race'; s.cp = 0; s.placeGate(); s.finish = () => { s.state = 'drive'; s.isRace = false; s.gate.visible = s.arrow.visible = false; this.next(); }; }
    if (st.ok(s)) this.next();
  }
  next() { this.i++; this.app.audio.beep(990, 0.12, 'menu'); this.show(); if (this.steps[this.i].done) this.finish(false); }
  async finish(skipped) {
    if (this.fin) return; this.fin = true;
    try { if (!this.app.store.profile.tutorial && !skipped) { await this.app.store.act('tutorial'); await this.app.store.act('tutorial_reward'); } else await this.app.store.act('tutorial'); } catch (e) { }
    if (skipped) { $('#tut').hidden = true; } else { $('#tut-text').textContent = this.steps[this.steps.length - 1].txt; $('#tut-skip').textContent = 'Close'; $('#tut-skip').onclick = () => $('#tut').hidden = true; }
  }
  end() { $('#tut').hidden = true; }
}

const app = new App(); window.CUZZY = app;
app.boot();
