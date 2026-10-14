// Settings screen (sound, voice, graphics, controls, game/profile) and How to Play.
import { defaults, applyPreset, PRESETS, IS_MOBILE, TIER_NAMES, resolvedPreset } from './settings.js';
import { mountWheel } from './wheel.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class SettingsUI {
  constructor(app) { this.app = app; this.tab = 'sound'; }
  get s() { return this.app.settings; }
  open() {
    const tabs = [['sound', 'Sound'], ['voice', 'Voice chat'], ['graphics', 'Graphics'], ['controls', 'Controls'], ['game', 'Game & profile']];
    $('#set-tabs').innerHTML = tabs.map(([k, t]) => `<button class="tab ${k === this.tab ? 'on' : ''}" data-t="${k}">${t}</button>`).join('');
    for (const b of document.querySelectorAll('#set-tabs .tab')) b.onclick = () => { this.tab = b.dataset.t; this.app.audio.click(); this.open(); };
    $('#set-defaults').onclick = () => this.app.confirm('Restore defaults', `Reset all ${this.tab === 'game' ? 'game' : this.tab} settings to their defaults?`, 'Restore', () => { const d = defaults(); this.s[this.tab] = d[this.tab]; this.changed(this.tab); this.open(); });
    this[this.tab]();
  }
  changed(group) {
    const a = this.app;
    if (group === 'sound' || group === 'voice') { a.audio.applyVolumes(); a.voice?.applyAll(); }
    if (group === 'graphics') a.applyGraphics();
    if (group === 'controls' && a.session) a.hud.show(a.session);
    a.saveSettings();
  }
  row(label, help, control) { return `<div class="srow"><label>${label}${help ? `<small>${help}</small>` : ''}</label>${control}</div>`; }
  slider(g, k, label, help, min = 0, max = 1, stepv = 0.05, fmt = v => Math.round(v * 100) + '%') { return this.row(label, help, `<input type="range" min="${min}" max="${max}" step="${stepv}" value="${this.s[g][k]}" data-g="${g}" data-k="${k}" data-num="1"><span class="val" data-v="${g}.${k}">${fmt(this.s[g][k])}</span>`); }
  toggle(g, k, label, help, def = false) { return this.row(label, help, `<input type="checkbox" class="tgl" ${(this.s[g][k] ?? def) ? 'checked' : ''} data-g="${g}" data-k="${k}" data-bool="1">`); }
  // option pickers are tap chips, not native <select>s (native dropdowns were unreliable on phones)
  select(g, k, label, help, opts, cur = this.s[g][k]) { return this.row(label, help, `<div class="chips" role="radiogroup">${opts.map(([v, t]) => `<button type="button" class="btn small chip${String(cur) === String(v) ? ' on' : ''}" role="radio" aria-checked="${String(cur) === String(v)}" data-cg="${g}" data-ck="${k}" data-cv="${v}">${t}</button>`).join('')}</div>`); }
  bind(after) {
    for (const b of document.querySelectorAll('#set-body [data-cg]')) b.onclick = () => {
      const g = b.dataset.cg, k = b.dataset.ck; let v = b.dataset.cv; if (/^-?\d+(\.\d+)?$/.test(v)) v = +v; if (v === 'true' || v === 'false') v = v === 'true';
      this.s[g][k] = v; for (const o of document.querySelectorAll(`#set-body [data-cg="${g}"][data-ck="${k}"]`)) { const on = o === b; o.classList.toggle('on', on); o.setAttribute('aria-checked', on); }
      if (g === 'graphics' && !['preset', 'showFps', 'upscale', 'interp', 'dayCycle'].includes(k)) { this.s.graphics.preset = 'custom'; for (const o of document.querySelectorAll('#set-body [data-ck=preset]')) o.classList.toggle('on', o.dataset.cv === 'custom'); }
      after?.(g, k, v); this.changed(g);
    };
    for (const el of document.querySelectorAll('#set-body [data-g]')) {
      const g = el.dataset.g, k = el.dataset.k;
      el.oninput = el.onchange = () => {
        let v = el.dataset.bool ? el.checked : el.dataset.num ? +el.value : el.value;
        if (el.tagName === 'SELECT' && /^-?\d+(\.\d+)?$/.test(el.value)) v = +el.value;
        this.s[g][k] = v; const lab = document.querySelector(`[data-v="${g}.${k}"]`); if (lab) lab.textContent = el.dataset.fmt === 'x' ? v.toFixed(2) + '×' : Math.round(v * 100) + '%';
        if (g === 'graphics' && !['preset', 'showFps', 'upscale', 'interp', 'dayCycle'].includes(k)) { this.s.graphics.preset = 'custom'; for (const o of document.querySelectorAll('#set-body [data-ck=preset]')) { const on = o.dataset.cv === 'custom'; o.classList.toggle('on', on); o.setAttribute('aria-checked', on); } }
        after?.(g, k, v); this.changed(g);
      };
    }
  }
  sound() {
    const L = [['master', 'Master volume'], ['engine', 'Engine'], ['exhaust', 'Exhaust pops & crackle'], ['tyres', 'Tyres, impacts & environment'], ['music', 'Music & radio'], ['voice', 'Voice chat'], ['menu', 'Menu sounds'], ['intro', 'Spoken intro']];
    $('#set-body').innerHTML = `<div class="set-grid">${L.map(([k, t]) => this.slider('sound', k, t)).join('')}
      ${this.toggle('sound', 'introOn', 'Play the spoken intro at launch', 'Plays once each time the game starts')}
      ${this.slider('sound', 'crackle', 'Overrun crackle amount', 'How often exhausts pop and bang when you lift off', 0, 2, 0.1)}</div>
      <p class="note">Engine, exhaust, turbo, tyre and music sounds are synthesised live by the game (not recordings of the real cars). The spoken intro is AI-generated speech.</p>
      <button class="btn small" id="snd-test">Test engine sound</button>`;
    this.bind((g, k) => { if (k === 'music') { this.s.sound.music > 0 ? this.app.audio.startMusic() : 0; } });
    $('#snd-test').onclick = () => { const car = this.app.carsById[this.app.store.profile.selected]; car._up = this.app.store.profile.ups[car.id] || {}; this.app.audio.engineStart(car); };
  }
  async voice() {
    const v = this.app.voice; const mics = v ? await v.listMics() : [];
    $('#set-body').innerHTML = `<div class="set-grid">
      ${this.toggle('voice', 'enabled', 'Voice chat', 'Hear and talk to players in your online room or open world')}
      ${this.row('Microphone (open mic)', 'OFF every time the game starts. While ON, others hear you whenever you speak — silence is not sent.', `<button class="btn small ${this.s.voice.micMuted ? '' : 'on'}" id="mic-toggle" aria-pressed="${!this.s.voice.micMuted}">${this.s.voice.micMuted ? 'Mic OFF' : 'Mic ON'}</button>`)}
      
      ${this.select('voice', 'range', 'Open world voice range', 'Room-wide: hear everyone in the world. Proximity: voices fade with distance and the server only relays voices within ~130 m.', [['room', 'Room-wide'], ['prox', 'Proximity']])}
      ${this.row('Microphone', mics.length && !mics[0].label ? 'Device names appear after you allow microphone access' : '', `<chip-select id="mic-sel" aria-label="Microphone"><option value="">Default microphone</option>${mics.map((m, i) => `<option value="${esc(m.deviceId)}" ${m.deviceId === this.s.voice.micId ? 'selected' : ''}>${esc(m.label || 'Microphone ' + (i + 1))}</option>`).join('')}</chip-select>`)}
      ${this.slider('sound', 'voice', 'Incoming voice volume')}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn small" id="mic-test">Allow &amp; test microphone (hear yourself)</button></div>
      <p class="note" id="mic-res"></p>
      <p class="note">Per-player mute, volume, block and report are in the room player list and the in-race pause menu. Echo cancellation, noise suppression and auto gain are always requested from the browser.</p>
      <p class="note"><b>How voice travels:</b> your voice is sent to the CUZZY RACING game server over your signed-in connection and the server passes it on only to players in your room (open world: in range, or everyone if you chose room-wide). There are no direct player-to-player connections, so other players never see your IP address. Muted and blocked players' voices are not delivered to you. Voice is not recorded. It is compressed (Opus where the browser supports it, otherwise 8-bit mu-law) and is not end-to-end encrypted — the server can technically see it.</p>`;
    this.bind();
    $('#mic-toggle').onclick = async () => { await this.app.toggleMic(); this.open(); };
    $('#mic-sel').onchange = e => { v?.setMic(e.target.value); this.changed('voice'); };
    $('#mic-test').onclick = async () => { this.app.audio.unlock(); const ok = await v.preview(4); $('#mic-res').textContent = ok ? 'Speak now — you should hear yourself for 4 seconds.' : 'Microphone unavailable or permission denied.'; if (ok) setTimeout(() => this.open(), 4200); };
  }
  graphics() {
    const g = this.s.graphics; const G = this.app.gfx; const hz = G.displayHz || 60;
    const fpsOpts = [[30, '30 fps'], [60, '60 fps'], [120, hz >= 100 ? '120 fps' : `120 fps (capped: display ${Math.round(G.stat.hz || 60)} Hz)`]]; // always offered; the limiter never draws faster than the display
    const autoNote = g.preset === 'auto' ? `Running: ${TIER_NAMES[resolvedPreset(g)]}${g.autoDone ? ' (benchmarked on this device)' : ' — benchmarking while you drive'} · resolution adapts to hold ${IS_MOBILE ? 30 : 60} fps` : 'Battery: longest battery life · Balanced: smooth on most phones · High / Ultra: full effects for strong GPUs';
    $('#set-body').innerHTML = `<div class="set-grid">
      ${this.select('graphics', 'preset', 'Graphics quality', autoNote, [['auto', TIER_NAMES.auto], ['low', 'Battery'], ['medium', 'Balanced'], ['high', 'High'], ['ultra', 'Ultra']].concat(['adaptive', 'custom'].includes(g.preset) ? [[g.preset, TIER_NAMES[g.preset]]] : []))}
      ${this.toggle('graphics', 'dayCycle', 'Day / night + weather cycle', '12-minute day, changing weather (free roam, open world, meets)')}
      ${this.toggle('graphics', 'showFps', 'Show FPS counter', 'Real frames drawn per second, frame time and 1% low, from the browser frame clock')}
      </div>${g.preset === 'auto' ? '<button type="button" class="btn small ghost" id="gfx-rebench" style="margin-top:8px">Re-run auto benchmark</button>' : ''}
      <details id="gfx-adv" style="margin-top:12px"${this._advOpen ? ' open' : ''}><summary style="cursor:pointer;font-weight:700;padding:10px 0;min-height:44px">Advanced (individual settings)</summary>
      <div class="perf-box" style="margin-bottom:12px;${g.preset === 'adaptive' ? 'border-color:#19e6c1' : ''}"><b>Ultra Adaptive</b> — detailed cars and scenery with a frame-time budget. ${g.preset === 'adaptive' ? '<b style="color:#19e6c1">(active)</b>' : '<button type="button" class="btn small primary" id="gfx-adaptive" style="margin-top:8px">Use Ultra Adaptive</button>'}</div>
      <div class="set-grid">
      ${this.select('graphics', 'fps', 'FPS target', `Frame limiter. Display refresh measured: ${Math.round(G.stat.hz || 60)} Hz${hz >= 100 ? '' : ' — this display cannot show 120 fps, so 120 runs at ' + Math.round(G.stat.hz || 60) + ' fps (turn on the phone\'s 120 Hz / adaptive refresh mode and battery saver off)'}`, fpsOpts)}
      ${this.select('graphics', 'upscale', 'Upscaling', 'How the lower internal resolution is scaled to the screen. Off: always native resolution. Bilinear: plain stretch. Sharp: edge-aware Catmull-Rom upscale + contrast-adaptive sharpening (FSR 1-style), needs Effects or SMAA.', [['off', 'Off'], ['bilinear', 'Bilinear'], ['sharp', 'Sharp (FSR-style)']], G.upMode())}
      ${this.toggle('graphics', 'interp', 'Smooth motion', 'Draws the car and camera between physics steps (render interpolation) and snaps frame times to the display refresh, so motion stays even at 60/90/120 fps', true)}
      ${this.toggle('graphics', 'resAuto', 'Auto resolution (dynamic)', 'Lowers / raises the internal resolution (50–100%) from the measured frame time. Menus and HUD stay sharp.')}
      ${this.row('Render resolution', g.resAuto ? 'Used when Auto resolution is off' : 'Lower = faster, softer image. Menus and HUD stay sharp.', `<input type="range" min="0.5" max="1" step="0.05" value="${g.res}" data-g="graphics" data-k="res" data-num="1"><span class="val" data-v="graphics.res">${Math.round(g.res * 100)}%</span>`)}
      ${this.select('graphics', 'shadows', 'Shadows', 'Low: soft shadows near the car, updated every 2nd frame. High: contact-hardening soft shadows (High/Ultra detail).', [[0, 'Off'], [1, 'Low'], [2, 'High']])}
      ${this.select('graphics', 'reflections', 'Reflections', 'Environment-map reflections. Not ray tracing — browsers have no ray-tracing API. Dynamic = live cube-map probe (one face per frame).', [[0, 'Off'], [1, 'Static'], [2, 'Dynamic']])}
      ${this.select('graphics', 'effects', 'Effects (post-processing)', 'Low: half-res bloom + colour grade. High: adds ambient occlusion, light shafts, haze glow, wet-road reflections (High/Ultra detail).', [[0, 'Off'], [1, 'Low'], [2, 'High']])}
      ${this.select('graphics', 'carDetail', 'Vehicle detail', 'Interiors on other cars, wheel geometry', [[0, 'Low'], [1, 'Medium'], [2, 'High']])}
      ${this.select('graphics', 'envDetail', 'Environment detail', 'Trees, lamps, road details, rooftop plant — applies on the next drive', [[0, 'Low'], [1, 'Medium'], [2, 'High'], [3, 'Ultra']])}
      ${this.select('graphics', 'drawDist', 'Draw distance', '', [[700, 'Short'], [1100, 'Medium'], [1600, 'Far'], [2400, 'Very far']])}
      ${this.select('graphics', 'aa', 'Anti-aliasing', '', [['off', 'Off'], ['smaa', 'SMAA']])}
      ${this.toggle('graphics', 'bloom', 'Bloom (light glow)', 'Needs Effects Low or High')}
      ${this.toggle('graphics', 'weatherFx', 'Rain effects')}
      ${this.toggle('graphics', 'motionBlur', 'Motion blur')}
      ${this.toggle('graphics', 'shake', 'Camera shake')}
      </div></details>
      <div class="perf-box" style="margin-top:14px"><b>Measured on this device:</b> <span id="fps-meas"></span><br>
      GPU: ${esc(G.gpu)} · WebGL ${G.webgl2 ? '2' : '1'} · <span id="fps-res"></span></div>`;
    const live = () => { const m = document.getElementById('fps-meas'); if (!m) { clearInterval(this._fpsIv); this._fpsIv = 0; return; } const S = G.stat;
      m.textContent = S.fps ? `${S.fps.toFixed(0)} fps · ${S.ms.toFixed(1)} ms per frame · 1% low ${S.low1.toFixed(0)} fps (last 1 s; 1% low over ~10 s) · 10 s average ${G.measured().toFixed(0)} fps` : 'not measured yet — drive for a few seconds';
      const r = document.getElementById('fps-res'); if (r) r.textContent = `Target: ${this.s.graphics.fps} fps on a ${Math.round(S.hz || 60)} Hz display · Internal resolution ${Math.round(innerWidth * (G.ipr || G.r.getPixelRatio()))}×${Math.round(innerHeight * (G.ipr || G.r.getPixelRatio()))}${this.s.graphics.resAuto ? ` (auto ${Math.round(G.dynScale * 100)}%)` : ''} · upscaling ${G.upMode()}${G.upPass?.enabled ? ' (active)' : ''}`; };
    live(); clearInterval(this._fpsIv); this._fpsIv = setInterval(live, 1000);
    const adv = document.getElementById('gfx-adv'); if (adv) adv.ontoggle = () => { this._advOpen = adv.open; };
    const rb = document.getElementById('gfx-rebench'); if (rb) rb.onclick = () => { delete this.s.graphics.autoTier; delete this.s.graphics.autoDone; applyPreset(this.s.graphics, 'auto'); this.changed('graphics'); this.open(); };
    const ad = document.getElementById('gfx-adaptive'); if (ad) ad.onclick = () => { applyPreset(this.s.graphics, 'adaptive'); this.changed('graphics'); this.open(); };
    this.bind((gr, k, v) => { if (k === 'preset') { applyPreset(this.s.graphics, v === 'custom' ? 'high' : v); if (v === 'custom') this.s.graphics.preset = 'custom'; this.open(); } if (k === 'resAuto') this.open(); });
  }
  controls() {
    $('#set-body').innerHTML = `<div class="set-grid">
      ${this.select('controls', 'steer', 'Steering', 'Touch buttons, virtual wheel or tilting the phone. Keyboard and controllers always work.', [['buttons', 'Touch buttons'], ['wheel', 'Virtual wheel'], ['tilt', 'Tilt (gyro)'], ['keyboard', 'Keyboard / controller only']])}
      ${this.slider('controls', 'sens', 'Steering sensitivity', '', 0.5, 1.5, 0.05)}
      ${this.slider('controls', 'tiltSens', 'Tilt sensitivity', '', 0.5, 2, 0.1)}
      ${this.slider('controls', 'padSens', 'Controller steering sensitivity', 'Xbox / PlayStation: lower = gentler steering', 0.3, 1.2, 0.05)}
      ${this.slider('controls', 'padCurve', 'Controller steering precision', 'Higher = finer control near the centre of the stick', 1, 3, 0.1)}
      ${this.slider('controls', 'rumble', 'Controller vibration', 'Rumble for engine, road, crashes, wheelspin and gear changes (0 = off)', 0, 1, 0.05)}
      ${this.slider('controls', 'steerAssist', 'Steering assist', 'Reduces lock at speed to stop spins', 0, 1, 0.05)}
      ${this.toggle('controls', 'auto', 'Automatic gears', 'Off: shift with + / − (E / Q, bumpers)')}
      ${this.toggle('controls', 'abs', 'ABS', 'Prevents wheel lock under braking')}
      ${this.toggle('controls', 'tc', 'Traction control')}
      ${this.toggle('controls', 'smartThrottle', 'Smart throttle', 'Touch / keys: feeds power in and stops wheelspin and power slides')}
      ${this.toggle('controls', 'esc', 'Stability control')}
      ${this.slider('controls', 'btnSize', 'Touch button size', '', 0.7, 1.5, 0.05)}
      ${this.slider('controls', 'btnHeight', 'Touch button height', 'Raise the buttons off the bottom edge', 0, 1, 0.05)}
      ${this.toggle('controls', 'pedalsLeft', 'Pedals on the left', 'Swap steering and pedal sides')}
      ${this.select('controls', 'regen', 'EV regenerative braking', 'How strongly EVs slow when you lift off', [[0, 'Off'], [1, 'Low'], [2, 'Medium'], [3, 'High']])}
      ${this.toggle('controls', 'onePedal', 'EV one-pedal driving', 'Lift off to slow strongly')}
      ${this.toggle('controls', 'evConsumption', 'EV battery consumption', 'Battery drains as you drive; power drops below 10%')}
      ${this.select('controls', 'camera', 'Default camera', '', [['chase', 'Chase'], ['cockpit', 'Cockpit'], ['bonnet', 'Bonnet'], ['orbit', 'Free 360°']])}
      </div>
      <p class="note">Xbox / PlayStation controllers: left stick steer, right stick look around, RT / R2 accelerate, LT / L2 brake, A / Cross handbrake, LB RB / L1 R1 shift, Y / Triangle camera, X / Square reset, B / Circle get out, Start / Options pause. On foot: left stick walk (push fully to run), A / Cross enter car or use, D-pad down map. Menus: D-pad or stick to move, A / Cross select, B / Circle back.</p>
      <button class="btn small" id="tilt-perm" ${this.s.controls.steer === 'tilt' ? '' : 'hidden'}>Allow motion sensors (iPhone)</button><section id="pc-wheel"></section>`;
    mountWheel($('#pc-wheel'));
    this.bind((g, k) => { if (k === 'steer') this.open(); });
    const tp = $('#tilt-perm'); if (tp) tp.onclick = async () => { try { const r = await DeviceOrientationEvent.requestPermission?.(); this.app.toast(r === 'granted' || r === undefined ? 'Motion sensors enabled' : 'Motion permission denied'); } catch (e) { this.app.toast('Motion sensors are not available'); } };
  }
  game() {
    const p = this.app.store.profile;
    $('#set-body').innerHTML = `<div class="set-grid">
      ${this.select('game', 'units', 'Speed units', '', [['mph', 'mph'], ['kmh', 'km/h']])}
      ${this.toggle('game', 'minimapRotate', 'Rotate minimap with car')}
      </div>
      <h3>Account</h3>
      <div class="perf-box acct">Signed in as <b id="acct-name">${esc(this.app.store.user?.name || p.name || '')}</b><span class="note" style="flex:1">Your username is your driver name in races and chat.</span><button class="btn small danger" id="acct-out">Sign out</button></div>
      <p class="note">No password recovery: accounts have no email, so keep your password safe. Signing out removes the saved sign-in from this device and ends that session on the server.</p>
      <h3>Your progress</h3>
      <div class="perf-box">Credits ${p.credits.toLocaleString('en-GB')} · Cars ${Object.keys(p.owned).length} · Races ${p.stats.races} · Wins ${p.stats.wins} · Distance ${p.stats.distance.toFixed(1)} km<br>Saved to your account on the CUZZY RACING server — sign in on any device to carry on. <span id="save-st"></span></div>
      <h3>Records</h3><div class="perf-box">${Object.entries(p.records).map(([k, r]) => `${esc(k.replace(/:/g, ' · '))}: <b>${r.time.toFixed(2)} s</b> (${esc(this.app.carsById[r.car]?.name || r.car)})`).join('<br>') || 'No records yet.'}</div>`;
    this.bind();
    $('#acct-out').onclick = () => this.app.signOut();
  }
}

export function howtoHTML(touch) {
  return `<div class="howto" style="max-width:820px">
  <h4>Your account</h4><p>You sign in with a username and password; your username is your driver name in races and chat. You stay signed in on this device until you choose <b>Settings › Game &amp; profile › Sign out</b>. There is no password recovery (accounts have no email), so keep your password safe.</p>
  <h4>Full screen</h4><p><b>iPhone / iPad:</b> in Safari tap <b>Share</b> › <b>Add to Home Screen</b> › <b>Add</b>, then open CUZZY RACING from your home screen — it runs full screen with no address bar. <b>Android / computers:</b> the game goes full screen when you tap to start, or use <b>Full Screen</b> on the main menu.</p>
  <h4>Getting started</h4><p>Pick <b>Play Solo</b> for free roam, sprints, circuits and time trials around Birmingham city centre. Earn credits from races and from free driving, choose any car in the <b>Showroom</b> (all cars are free) and spend credits on parts and customisation in the <b>Garage</b>.</p>
  <h4>Driving</h4><ul>
  <li>${touch ? '<b>GAS</b> / <b>BRAKE</b> pedals on the right, steering on the left (buttons, wheel or tilt — change in Settings › Controls).' : 'Keyboard: <kbd>W</kbd>/<kbd>↑</kbd> accelerate, <kbd>S</kbd>/<kbd>↓</kbd> brake &amp; reverse, <kbd>A</kbd><kbd>D</kbd>/<kbd>←</kbd><kbd>→</kbd> steer, <kbd>Space</kbd> handbrake.'}</li>
  <li>Hold brake at a standstill to reverse; press accelerate to go forward again. <b>R</b> button or <kbd>R</kbd> resets the car (+3 s in races).</li>
  <li>Cameras: chase, cockpit, bonnet and free 360° (drag to look). ${touch ? 'CAM button' : '<kbd>C</kbd>'}.</li>
  <li>Manual gears: turn off Automatic in Settings, then use + / − ${touch ? '' : '(<kbd>E</kbd>/<kbd>Q</kbd>)'}.</li>
  <li>Controllers: left stick, RT/LT, A handbrake, bumpers shift, Y camera, Start pause.</li></ul>
  <h4>Races</h4><p>Drive through each glowing gate in order — the arrow and minimap show the next one. The yellow gate is the finish. Roads are closed to traffic; buildings are solid.</p>
  <h4>Online</h4><p>Play Online finds a public room. Private rooms use a 5-letter invite code. The host chooses the route and starts when everyone is Ready. Voice chat is an open mic: your mic starts <b>OFF</b>; tap <b>MIC</b> to switch it ON or OFF (also in the lobby and Settings › Voice chat) — the first time, your browser asks for permission. Voice is relayed by the game server, never sent directly between players, so nobody sees your IP address. Mute or block anyone from the player list. Pausing online does not stop the race — your car brakes to a stop while the menu is open.</p>
  <p><b>Room timeouts:</b> a waiting room closes after 3 minutes with no activity (joining, choosing a car, changing settings, readying or pressing Keep room open). A warning appears 30 seconds before. Rooms never close while you're driving. Players who stop driving for 3 minutes in a session are warned, then removed. If you disconnect, your place is kept for 3 minutes.</p>
  <h4>Cars &amp; upgrades</h4><p>Stats marked "Researched" come from manufacturer and press figures. Upgraded numbers are estimates simulated by the game. More power does not improve braking or grip — tyres, brakes and suspension do. Classic cars are lighter on grip and assists; EVs have instant torque and regenerative braking but no exhaust.</p>
  </div>`;
}
