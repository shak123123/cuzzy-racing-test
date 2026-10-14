// Physical wheel/pedals via Gamepad API. Calibration is local to this PC, not the cloud profile.
const KEY = 'cuzzy.wheel.v1';
import { mountG29Setup } from './g29setup.js';
const fresh = () => ({ enabled: false, deadzone: 0.025, steer: null, throttle: null, brake: null, clutch: null, transmission: 'inherit', gears: {}, buttons: {} });
let cfg = fresh();
try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
if (!cfg.buttons || typeof cfg.buttons !== 'object') cfg.buttons = {};
if (!cfg.gears || typeof cfg.gears !== 'object') cfg.gears = {};
if (!['inherit', 'auto', 'paddles', 'hpattern'].includes(cfg.transmission)) cfg.transmission = 'inherit';
export const wheelConfig = () => cfg;
export function saveWheel() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); return true; } catch { return false; } }
export function pads() { try { return Array.from(navigator.getGamepads?.() || []).filter(p => p?.connected); } catch { return []; } }
export function isWheelDevice(p) {
  return cfg.enabled && (['steer', 'throttle', 'brake', 'clutch'].some(k => cfg[k]?.device === p.id) ||
    Object.values(cfg.gears || {}).some(m => m.device === p.id));
}
export function standardPad() {
  const calibrating = typeof document !== 'undefined' && document.querySelector('#pc-wheel')?.closest('.screen.show');
  return pads().find(p => p.mapping === 'standard' && !isWheelDevice(p) &&
    !(calibrating && ['steer', 'throttle', 'brake', 'clutch'].some(k => cfg[k]?.device === p.id)));
}
function raw(m, list) {
  const p = list.find(p => p.id === m?.device);
  const v = m?.kind === 'button' ? p?.buttons[m.index]?.value : p?.axes[m?.index];
  return Number.isFinite(v) ? v : null;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function normalizePedal(v, m, dz = 0.025) {
  if (!Number.isFinite(v) || !Number.isFinite(m?.rest) || !Number.isFinite(m?.full) || Math.abs(m.full - m.rest) < 0.1) return null;
  return clamp(((v - m.rest) / (m.full - m.rest) - dz) / (1 - dz), 0, 1);
}
export function normalizeSteer(v, m, dz = 0.025) {
  if (![v, m?.left, m?.center, m?.right].every(Number.isFinite) ||
    (m.left - m.center) * (m.right - m.center) >= 0 ||
    Math.min(Math.abs(m.left - m.center), Math.abs(m.right - m.center)) < 0.1) return null;
  const left = (v - m.center) * (m.left - m.center) >= 0;
  const n = Math.abs((v - m.center) / ((left ? m.left : m.right) - m.center));
  return (left ? 1 : -1) * clamp((n - dz) / (1 - dz), 0, 1) || 0;
}
export function readWheel(list = pads()) {
  if (!cfg.enabled) return null;
  const dz = clamp(Number(cfg.deadzone) || 0, 0, 0.2);
  const steer = normalizeSteer(raw(cfg.steer, list), cfg.steer, dz);
  const throttle = normalizePedal(raw(cfg.throttle, list), cfg.throttle, dz);
  const brake = normalizePedal(raw(cfg.brake, list), cfg.brake, dz);
  const clutch = cfg.clutch ? normalizePedal(raw(cfg.clutch, list), cfg.clutch, dz) : null;
  const hPattern = cfg.transmission === 'hpattern';
  const gears = Object.entries(cfg.gears || {});
  const active = gears.filter(([, m]) => list.find(p => p.id === m.device)?.buttons[m.index]?.pressed);
  const gearReady = !hPattern || (gears.length > 0 && active.length <= 1 &&
    new Set(gears.map(([, m]) => `${m.device}:${m.index}`)).size === gears.length &&
    gears.every(([, m]) => list.find(p => p.id === m.device)?.buttons[m.index] !== undefined));
  const buttons = {};
  for (const [k, index] of Object.entries(cfg.buttons || {})) {
    buttons[k] = !!list.find(p => p.id === cfg.steer?.device)?.buttons[index]?.pressed;
  }
  return { ready: steer !== null && throttle !== null && brake !== null &&
      (!cfg.clutch || clutch !== null) && (!hPattern || clutch !== null) && gearReady,
    steer: steer || 0, throttle: throttle || 0, brake: brake || 0, clutch: clutch || 0,
    manualClutch: !!cfg.clutch, hPattern, gear: active.length === 1 ? +active[0][0] : 0,
    transmission: cfg.transmission, buttons };
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function mountWheel(root) {
  root.innerHTML = `<h3>PC steering wheel &amp; pedals</h3>
    <p class="note">Connect your USB wheel and pedals, then press a wheel button. Use G29 auto-setup or choose each input below and capture its positions. Separate USB pedals and combined pedal axes are supported if the browser exposes them.</p>
    <div id="g29-setup"></div>
    <label><input id="wheel-enable" type="checkbox" ${cfg.enabled ? 'checked' : ''}> Enable physical wheel &amp; pedals</label>
    <button class="btn small" id="wheel-refresh">Refresh devices</button>
    <p class="note" id="wheel-status" role="status"></p>
    <div id="wheel-bindings"></div>
    <label>Input deadzone <input id="wheel-dz" type="range" min="0" max="0.15" step="0.005" value="${cfg.deadzone}"><span id="wheel-dz-value"></span></label>
    <h4>Wheel buttons (optional)</h4>
    <p class="note">Click Learn, then press the button or paddle you want to use. No button numbers to guess.</p>
    <button class="btn small" id="wheel-cancel-learn" hidden>Cancel listening</button>
    <p class="note" id="button-status" role="status"></p><div id="wheel-buttons"></div>
    <h4>Gear selector &amp; clutch</h4>
    <label>Transmission <select id="wheel-transmission" style="min-height:44px;background:#171b20;color:white">
      <option value="inherit">Use game automatic/manual setting</option><option value="auto">Automatic</option>
      <option value="paddles">Manual paddles</option><option value="hpattern">H-pattern + clutch</option></select></label>
    <p class="note">H-pattern needs a calibrated clutch and gear buttons. No selected gear = neutral. Press the clutch to engage a gear. Reverse is locked out above walking pace; over-rev downshifts are rejected. This is a simplified clutch model, without engine stalling or gearbox damage.</p>
    <div id="wheel-gears"></div><p class="note" id="gear-status" role="status"></p>
    <div class="perf-box"><b>G29 motor force feedback: not enabled</b><p class="note">Input mapping cannot supply steering torque. Check whether this browser exposes the G29's HID output interface before attempting a direct-browser implementation. This check sends no motor commands and does not enable force feedback.</p>
      <button class="btn small" id="wheel-hid-check">Check G29 feedback connection</button>
      <p class="note" id="wheel-hid-status" role="status">No companion app. Browser rumble is not steering force feedback.</p></div>
    <p class="note">Calibration saves on this browser. Keep pedals released when reconnecting. Use the normal Back button to return. If no devices appear, check the manufacturer's driver and browser support. Keyboard and touch remain available when wheel mode is disabled.</p>`;
  const q = s => root.querySelector(s);
  q('#wheel-hid-check').onclick = async () => {
    const status = q('#wheel-hid-status'), button = q('#wheel-hid-check');
    if (!navigator.hid?.requestDevice) { status.textContent = 'WebHID is unavailable here. Try desktop Chrome or Edge on Windows. No forces were sent.'; return; }
    button.disabled = true;
    try {
      const devices = await navigator.hid.requestDevice({ filters: [{ vendorId: 0x046d, productId: 0xc24f }] });
      if (!devices.length) { status.textContent = 'No G29 selected. Input calibration is unchanged.'; return; }
      const lines = [];
      for (const device of devices) {
        const openedHere = !device.opened;
        try {
          if (openedHere) await device.open();
          const reports = new Set();
          const walk = cs => { for (const c of cs || []) { for (const r of c.outputReports || []) reports.add(r.reportId); walk(c.children); } };
          walk(device.collections);
          lines.push(reports.size ? `G29 opened; output report IDs: ${[...reports].join(', ')}. Access alone does not verify motor compatibility. No force commands sent.` :
            'G29 opened but no output reports are exposed. Direct motor feedback is not available through this interface.');
        } finally { if (openedHere && device.opened) await device.close(); }
      }
      status.textContent = lines.join(' ');
    } catch (e) { status.textContent = `G29 feedback access unavailable (${e.name || 'error'}). Controls are unchanged; no forces were sent.`; }
    finally { button.disabled = false; }
  };
  const persist = () => { if (!saveWheel()) q('#wheel-status').textContent = 'Storage unavailable: calibration will last only for this visit.'; };
  q('#wheel-enable').onchange = e => { cfg.enabled = e.target.checked; persist(); };
  q('#wheel-dz').oninput = e => { cfg.deadzone = +e.target.value; persist(); };
  q('#wheel-transmission').value = cfg.transmission;
  q('#wheel-transmission').onchange = e => { cfg.transmission = e.target.value; persist(); };
  let learn = null;
  const message = text => { q('#button-status').textContent = q('#gear-status').textContent = text; };
  q('#wheel-cancel-learn').onclick = () => { learn = null; message('Listening cancelled. Previous mapping kept.'); draw(); };
  function draw() {
    q('#wheel-cancel-learn').hidden = !learn;
    const list = pads(); const choices = [];
    for (const p of list) {
      p.axes.forEach((v, i) => choices.push({ device: p.id, kind: 'axis', index: i, label: `${p.id} · Axis ${i}` }));
      p.buttons.forEach((v, i) => choices.push({ device: p.id, kind: 'button', index: i, label: `${p.id} · Button ${i}` }));
    }
    q('#wheel-bindings').innerHTML = ['steer', 'throttle', 'brake', 'clutch'].map(k => {
      const m = cfg[k];
      return `<div class="perf-box" style="margin:12px 0;min-width:0"><label style="display:block">${k === 'steer' ? 'Steering' : k === 'throttle' ? 'Accelerator' : k === 'brake' ? 'Brake' : 'Clutch (optional)'}
        <select aria-label="${k} input" data-map="${k}" style="display:block;width:100%;max-width:100%;min-height:44px;background:#171b20;color:white"><option value="">Choose input</option>${choices.map((c, i) => k === 'steer' && c.kind !== 'axis' ? '' : `<option value="${i}" ${m?.device === c.device && m?.kind === c.kind && m?.index === c.index ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0">${(k === 'steer' ? ['left', 'center', 'right'] : ['rest', 'full']).map(pos => `<button class="btn small" data-capture="${k}:${pos}">Capture ${pos}</button>`).join('')}</div>
        <output data-meter="${k}" style="font-size:14px;display:block;overflow-wrap:anywhere"></output></div>`;
    }).join('');
    for (const el of root.querySelectorAll('[data-map]')) el.onchange = () => {
      cfg[el.dataset.map] = el.value === '' ? null : { ...choices[+el.value] };
      if (el.dataset.map === 'steer') cfg.buttons = {};
      persist(); draw();
    };
    for (const el of root.querySelectorAll('[data-capture]')) el.onclick = () => {
      const [k, pos] = el.dataset.capture.split(':'); const m = cfg[k]; const v = raw(m, pads());
      if (m && v !== null) { m[pos] = v; persist(); }
      else q('#wheel-status').textContent = 'Select a connected input first.';
    };
    q('#wheel-buttons').innerHTML = [['shiftUp', 'Shift up'], ['shiftDown', 'Shift down'], ['handbrake', 'Handbrake'], ['camera', 'Camera'], ['reset', 'Reset car'], ['pause', 'Pause']].map(([k, label]) =>
      `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0">
      <span style="min-width:100px">${label}</span><button class="btn small" data-learn-action="${k}" aria-label="Learn ${label}">${learn?.action === k ? 'Listening…' : 'Learn'}</button>
      <button class="btn small" data-clear-action="${k}" aria-label="Clear ${label}">Clear</button>
      <span>${cfg.buttons[k] >= 0 ? 'Assigned from your input' : 'Not assigned'}</span></div>`).join('');
    for (const el of root.querySelectorAll('[data-clear-action]')) el.onclick = () => { delete cfg.buttons[el.dataset.clearAction]; learn = null; persist(); draw(); };
    for (const el of root.querySelectorAll('[data-learn-action]')) el.onclick = () => {
      learn = { action: el.dataset.learnAction, until: performance.now() + 15000, base: new Set() };
      for (const p of pads()) p.buttons.forEach((b, i) => { if (b.pressed) learn.base.add(`${p.id}:${i}`); });
      message('Press the matching wheel button or paddle. Listening for 15 seconds…'); draw();
    };
    q('#wheel-gears').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, -1].map(g => {
      const m = cfg.gears[g];
      return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0">
        <button class="btn small" data-learn-gear="${g}">${learn?.gear === String(g) ? 'Listening…' : 'Learn ' + (g < 0 ? 'Reverse' : 'Gear ' + g)}</button>
        <button class="btn small" data-clear-gear="${g}" aria-label="Clear gear ${g}">Clear</button>
        <span style="font-size:13px;overflow-wrap:anywhere">${m ? esc(m.device) + ' · button ' + m.index : 'Not assigned'}</span></div>`;
    }).join('');
    for (const el of root.querySelectorAll('[data-learn-gear]')) el.onclick = () => {
      learn = { gear: el.dataset.learnGear, until: performance.now() + 15000, base: new Set() };
      for (const p of pads()) p.buttons.forEach((b, i) => { if (b.pressed) learn.base.add(`${p.id}:${i}`); });
      message('Move the shifter to neutral, then select this gear. Listening for 15 seconds…'); draw();
    };
    for (const el of root.querySelectorAll('[data-clear-gear]')) el.onclick = () => { delete cfg.gears[el.dataset.clearGear]; learn = null; persist(); draw(); };
  }
  q('#wheel-refresh').onclick = draw; draw();
  mountG29Setup(q('#g29-setup'), cfg, pads, () => {
    persist(); q('#wheel-enable').checked = cfg.enabled; q('#wheel-transmission').value = cfg.transmission; draw();
  });
  const iv = setInterval(() => {
    if (!root.isConnected) { clearInterval(iv); return; }
    const list = pads(); const r = readWheel(list);
    if (learn) {
      const changed = [];
      for (const p of list) if (!learn.action || p.id === cfg.steer?.device) p.buttons.forEach((b, i) => {
        const key = `${p.id}:${i}`; if (!b.pressed) learn.base.delete(key);
        else if (!learn.base.has(key)) changed.push({ device: p.id, index: i });
      });
      if (changed.length === 1) {
        const m = changed[0];
        if (learn.action) {
          const conflict = Object.entries(cfg.buttons).some(([k, i]) => k !== learn.action && i === m.index) ||
            Object.values(cfg.gears).some(x => x.device === m.device && x.index === m.index);
          if (conflict) message('That input already has an assignment. Clear it first.');
          else { cfg.buttons[learn.action] = m.index; persist(); message('Wheel button learned from your input.'); }
          learn = null; draw();
        } else {
        const duplicate = Object.entries(cfg.gears).find(([g, x]) => g !== learn.gear && x.device === m.device && x.index === m.index);
        if (duplicate || (cfg.steer?.device === m.device && Object.values(cfg.buttons).includes(m.index))) message('That input already has an assignment. Clear it first.');
        else { cfg.gears[learn.gear] = m; persist(); message('Gear learned. Repeat for each position; neutral needs no button.'); }
        learn = null; draw();
        }
      } else if (performance.now() > learn.until) { learn = null; message('Timed out: no single input detected. Previous mapping kept.'); draw(); }
    }
    q('#wheel-dz-value').textContent = ` ${Math.round(cfg.deadzone * 100)}%`;
    q('#wheel-status').textContent = `${list.length} device(s) detected. ${cfg.enabled ? r.ready ? 'Calibrated: wheel control ready.' : 'Not ready: connect devices and capture all positions. Driving will brake safely.' : 'Wheel mode off.'}`;
    for (const k of ['steer', 'throttle', 'brake', 'clutch']) {
      const m = cfg[k], v = raw(m, list);
      const n = k === 'steer' ? normalizeSteer(v, m, cfg.deadzone) : normalizePedal(v, m, cfg.deadzone);
      const points = (k === 'steer' ? ['left', 'center', 'right'] : ['rest', 'full']).map(p => `${p}: ${Number.isFinite(m?.[p]) ? m[p].toFixed(2) : 'not set'}`).join(' / ');
      q(`[data-meter="${k}"]`).textContent = `Raw ${v === null ? 'disconnected' : v.toFixed(2)} · ${points} · Output ${n === null ? 'not calibrated' : Math.round(n * 100) + '%'}`;
    }
  }, 33);
}
