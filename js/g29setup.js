// Learn the actual browser mapping rather than assuming DirectInput axis numbers.
export const isG29 = p => /g29|046d.*c24f|c24f.*046d/i.test(p?.id || '');
export function strongestInput(p, base, used = [], axesOnly = false) {
  let best = null;
  for (const kind of axesOnly ? ['axis'] : ['axis', 'button']) {
    const values = kind === 'axis' ? p.axes : p.buttons.map(b => b.value);
    const original = kind === 'axis' ? base.axes : base.buttons;
    values.forEach((value, index) => {
      if (!Number.isFinite(value) || !Number.isFinite(original[index]) || used.includes(`${kind}:${index}`)) return;
      const delta = Math.abs(value - original[index]);
      if (delta > 0.25 && (!best || delta > best.delta)) best = { kind, index, value, rest: original[index], delta };
    });
  }
  return best;
}
export function mountG29Setup(root, cfg, pads, saved) {
  root.innerHTML = `<div class="perf-box"><b>Logitech G29 auto-setup</b>
    <p class="note" id="g29-status">Press a wheel button to make the G29 visible. Press and release each pedal once, then centre the wheel, release all pedals and leave the shifter in neutral before starting.</p>
    <button class="btn small primary" id="g29-start">Auto-configure G29</button>
    <button class="btn small" id="g29-next" hidden>Capture &amp; next</button>
    <button class="btn small" id="g29-cancel" hidden>Cancel setup</button></div>`;
  const q = s => root.querySelector(s);
  let state = null;
  const steps = ['Turn fully LEFT and hold.', 'Turn fully RIGHT and hold.', 'Centre the wheel and hold.',
    'Centre wheel. Press ONLY the accelerator fully and hold.', 'Release accelerator. Press ONLY the brake fully and hold.',
    'Release brake. Press ONLY the clutch fully and hold.'];
  const snapshot = p => ({ axes: Array.from(p.axes), buttons: p.buttons.map(b => b.value) });
  const stop = msg => { state = null; q('#g29-next').hidden = q('#g29-cancel').hidden = true; q('#g29-start').hidden = false; q('#g29-status').textContent = msg; };
  q('#g29-start').onclick = () => {
    const list = pads().filter(isG29);
    if (list.length !== 1) { q('#g29-status').textContent = list.length ? 'More than one G29 detected: disconnect duplicates or use manual calibration.' : 'No G29 detected. Connect it, press a button and retry; manual mapping remains available.'; return; }
    const p = list[0];
    state = { id: p.id, base: snapshot(p), step: 0, draft: {}, used: [] };
    q('#g29-start').hidden = true; q('#g29-next').hidden = q('#g29-cancel').hidden = false;
    q('#g29-status').textContent = steps[0];
  };
  q('#g29-cancel').onclick = () => stop('Setup cancelled. Previous mappings are unchanged.');
  q('#g29-next').onclick = () => {
    if (!state) return;
    const p = pads().find(p => p.id === state.id);
    if (!p) { stop('G29 disconnected. Previous mappings are unchanged.'); return; }
    const s = state; const d = s.draft;
    if (s.step === 0) {
      const m = strongestInput(p, s.base, [], true);
      if (!m) { q('#g29-status').textContent = 'Turn fully left first; no clear steering movement detected.'; return; }
      d.steer = { device: p.id, kind: 'axis', index: m.index, center: m.rest, left: m.value };
      s.used.push(`axis:${m.index}`);
    } else if (s.step === 1) {
      const value = p.axes[d.steer.index];
      if ((value - d.steer.center) * (d.steer.left - d.steer.center) >= 0 || Math.abs(value - d.steer.center) < .25) {
        q('#g29-status').textContent = 'Turn fully right, opposite the captured left position.'; return;
      }
      d.steer.right = value;
    } else if (s.step === 2) {
      const v = p.axes[d.steer.index];
      if (v <= Math.min(d.steer.left, d.steer.right) + .1 || v >= Math.max(d.steer.left, d.steer.right) - .1) {
        q('#g29-status').textContent = 'Return the wheel to its centre before capturing.'; return;
      }
      d.steer.center = v;
    } else {
      const m = strongestInput(p, s.base, s.used);
      if (!m) { q('#g29-status').textContent = 'No distinct pedal input detected. Press only the requested pedal; use manual mapping for combined axes.'; return; }
      const key = ['throttle', 'brake', 'clutch'][s.step - 3];
      d[key] = { device: p.id, kind: m.kind, index: m.index, rest: m.rest, full: m.value };
      s.used.push(`${m.kind}:${m.index}`);
    }
    if (++s.step === steps.length) {
      Object.assign(cfg, d, { enabled: true, transmission: 'paddles', buttons: {}, gears: {} });
      saved(); stop('G29 steering and all 3 pedals configured. Release pedals. Map paddles below; use Learn Gear for the shifter, then choose H-pattern + clutch.');
    } else q('#g29-status').textContent = steps[s.step];
  };
}
