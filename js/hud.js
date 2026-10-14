// In-race HUD (speed, revs / EV power, gear, position, lap, checkpoints, minimap) and touch controls.
import * as THREE from 'three';
import { mph } from '../shared/physics.js';
import { fmt } from './game.js';

const $ = (s, r = document) => r.querySelector(s);
export class Hud {
  constructor(app) {
    this.app = app; this.el = $('#hud'); this.ctl = $('#touch');
    this.mm = $('#minimap'); this.mmx = this.mm.getContext('2d'); this.mm.addEventListener('pointerup', e => { const s = this.app.session; if (s?.foot && !s.isRace) { e.preventDefault(); s.foot.openMap(); } }); /* p51: tap the minimap for the full GPS map */
    this.tags = $('#tags');
    this.bindTouch();
  }
  // pre-render the street map for the minimap
  buildMap(data, routes) {
    const b = data.bounds.map(v => v / 10); this.mb = b; const S = 0.45; this.mS = S;
    const c = document.createElement('canvas'); c.width = Math.ceil((b[2] - b[0]) * S); c.height = Math.ceil((b[3] - b[1]) * S);
    const g = c.getContext('2d'); g.fillStyle = '#12161c'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#1e242d'; for (const bl of data.buildings) { const p = bl.p || bl.pts; if (!p) continue; g.beginPath(); for (let i = 0; i < p.length; i += 2) { const x = (p[i] / 10 - b[0]) * S, y = (p[i + 1] / 10 - b[1]) * S; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.fill(); }
    if (data.east) { const ord = k => k === 'asda_park' || k === 'stadium' ? 0 : k === 'pitch' ? 2 : 1; // east landmarks (St Andrew's, Asda + car park, mosques)
      for (const [k, o] of Object.entries(data.east).sort((u, v) => ord(u[0]) - ord(v[0]))) { const p = o?.p; if (!p) continue;
        g.fillStyle = k === 'asda_park' ? '#434b57' : k === 'pitch' ? '#23422a' : k === 'stadium' ? '#1f3a66' : '#2f3a4a'; g.beginPath(); for (let i = 0; i < p.length; i += 2) { const x = (p[i] / 10 - b[0]) * S, y = (p[i + 1] / 10 - b[1]) * S; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.closePath(); g.fill(); } }
    g.lineCap = g.lineJoin = 'round';
    const mmLines = data.graph?.e?.length ? data.graph.e.map(e => ({ r: data.roads[e[3]], p: e[4] })) : data.roads.map(r => ({ r, p: r.p })); // p51: draw the cleaned graph (no pruned stubs / islands)
    for (const { r, p } of mmLines) { g.strokeStyle = r.tun ? '#4a5563' : /motorway|trunk|primary/.test(r.k) ? '#8b96a6' : '#5a6474'; g.lineWidth = Math.max(1.2, (r.w || 7) * S * 0.9); g.beginPath(); for (let i = 0; i < p.length; i += 2) { const x = (p[i] / 10 - b[0]) * S, y = (p[i + 1] / 10 - b[1]) * S; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
    g.fillStyle = '#5a6474'; for (const [tx, tz, tr] of (data.turns || [])) { g.beginPath(); g.arc((tx / 10 - b[0]) * S, (tz / 10 - b[1]) * S, Math.max(1.5, tr * S), 0, 7); g.fill(); }
    this.mapImg = c; this.routeImgs = {};
    // labels: one anchor per ~300 m of each named road (midpoint of its longest segment), districts from lat/lon, big named parks
    const L = this.mapLabels = []; const byName = {};
    for (const r of data.roads) { if (!r.n || r.tun || r.cut) continue; const p = r.p; let best = 0, bi = -1, tot = 0;
      for (let i = 2; i < p.length; i += 2) { const d = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]) / 10; tot += d; if (d > best) { best = d; bi = i; } }
      if (tot < 45 || best < 22) continue; const x = (p[bi] + p[bi - 2]) / 20, z = (p[bi + 1] + p[bi - 1]) / 20, a = Math.atan2(p[bi + 1] - p[bi - 1], p[bi] - p[bi - 2]);
      const near = (byName[r.n] ||= []); if (near.some(q => Math.hypot(q[0] - x, q[1] - z) < 300)) continue; near.push([x, z]);
      L.push({ t: r.n, x, z, a, seg: best, major: /motorway|trunk|primary|secondary/.test(r.k) ? 1 : 0 }); }
    const [lat0, lon0] = data.origin, ll = (la, lo) => [(lo - lon0) * 111320 * Math.cos(lat0 * Math.PI / 180), -(la - lat0) * 110574];
    this.mapAreas = [['CITY CENTRE', 52.4797, -1.8990], ['JEWELLERY QUARTER', 52.4885, -1.9115], ['DIGBETH', 52.4752, -1.8835], ['SOUTHSIDE', 52.4738, -1.8985], ['EASTSIDE', 52.4815, -1.8850],
      ['BRINDLEYPLACE', 52.4777, -1.9135], ['LADYWOOD', 52.4805, -1.9265], ['FIVE WAYS', 52.4718, -1.9195], ['EDGBASTON', 52.4640, -1.9230], ['HOCKLEY', 52.4935, -1.9185], ['ASTON', 52.5010, -1.8860],
      ['HIGHGATE', 52.4655, -1.8885], ['BORDESLEY', 52.4718, -1.8700], ['SMALL HEATH', 52.4700, -1.8470], ['GUN QUARTER', 52.4880, -1.8950]].map(([t, la, lo]) => { const [x, z] = ll(la, lo); return { t, x, z }; })
      .filter(a => a.x > b[0] && a.x < b[2] && a.z > b[1] && a.z < b[3]);
    for (const a of data.areas || []) { if (!a.n || !/park|green/.test(a.k) || /parking|car park/i.test(a.n)) continue; const p = a.p; let cx = 0, cz = 0, ar = 0;
      for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length; const cr = p[i] * p[j + 1] - p[j] * p[i + 1]; ar += cr; cx += (p[i] + p[j]) * cr; cz += (p[i + 1] + p[j + 1]) * cr; }
      if (Math.abs(ar) / 200 < 6000) continue; this.mapAreas.push({ t: a.n, x: cx / (3 * ar) / 10, z: cz / (3 * ar) / 10, park: 1 }); }
    for (const rt of routes.routes) { const rc = document.createElement('canvas'); rc.width = c.width; rc.height = c.height; const rg = rc.getContext('2d'); rg.strokeStyle = '#19e6c1'; rg.lineWidth = 3; rg.lineJoin = 'round'; rg.beginPath(); rt.path.forEach((p, i) => { const x = (p[0] - b[0]) * S, y = (p[1] - b[1]) * S; i ? rg.lineTo(x, y) : rg.moveTo(x, y); }); if (rt.mode === 'circuit') rg.closePath(); rg.stroke(); this.routeImgs[rt.id] = rc; }
  }
  show(sess) {
    $('.h-speedo').style.visibility = '';
    this.sess = sess; this.el.hidden = false; this.el.classList.toggle('online', sess.online); this.el.classList.toggle('race', !!sess.isRace);
    this.ctl.hidden = !(this.app.touchUI()); this.el.classList.toggle('touch', this.app.touchUI()); this.layoutTouch();
    $('#h-mic').hidden = !sess.online; $('#h-shift').hidden = this.app.settings.controls.auto;
    $('#fps').hidden = !this.app.settings.graphics.showFps;
    $('#h-ev').hidden = !sess.P.ev; $('#h-rev').hidden = sess.P.ev;
    $('#h-pos').parentElement.hidden = !sess.isRace || !(sess.online || sess.ai); // solo races with AI opponents show P n/N too
    $('#h-lapbox').hidden = !sess.isRace; $('#h-timebox').hidden = !sess.isRace;
    this.revMax = sess.P.redline;
  }
  hide() { this.el.hidden = true; this.ctl.hidden = true; $('#countdown').hidden = true; this.tags.innerHTML = ''; }
  layoutTouch() {
    const c = this.app.settings.controls; const st = document.documentElement.style;
    st.setProperty('--btn', (74 * c.btnSize) + 'px'); st.setProperty('--bs', String(c.btnSize)); // the viewport caps scale too, so the size setting also works on short landscape phones st.setProperty('--btn-lift', (c.btnHeight * 60) + 'px');
    this.ctl.classList.toggle('swap', !!c.pedalsLeft); this.ctl.dataset.steer = c.steer;
  }
  bindTouch() {
    const T = () => this.sess?.touch || {};
    for (const b of this.ctl.querySelectorAll('[data-k]')) {
      const k = b.dataset.k;
      const on = e => { e.preventDefault(); b.classList.add('on'); const t = T(); if (k === 'up') this.sess && (this.sess.inp.shiftUp = 1); else if (k === 'down') this.sess && (this.sess.inp.shiftDown = 1); else if (k === 'cam') this.sess?.nextCam(); else if (k === 'fly') this.sess?.toggleHover?.(); else if (k === 'turbo') this.sess?.turboBoost?.(); else if (k === 'reset') this.sess?.resetCar(); else if (k === 'rev') t.rev = 1; else if (k === 'mic') { this.app.toggleMic?.(); } else if (k === 'pause') this.app.togglePause(); else t[k] = 1; };
      const off = e => { e.preventDefault(); b.classList.remove('on'); const t = T(); if (k === 'mic') { } else if (!['up', 'down', 'cam', 'fly', 'turbo', 'reset', 'rev', 'pause'].includes(k)) t[k] = 0; };
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
    }
    // virtual steering wheel
    const wh = $('#wheel'); let id = null, a0 = 0;
    const ang = e => { const r = wh.getBoundingClientRect(); return Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))); };
    wh.addEventListener('pointerdown', e => { id = e.pointerId; wh.setPointerCapture(id); a0 = ang(e) - (this.wheelA || 0); });
    wh.addEventListener('pointermove', e => { if (e.pointerId !== id) return; let a = ang(e) - a0; a = Math.max(-2.2, Math.min(2.2, a)); this.wheelA = a; wh.style.transform = `rotate(${a}rad)`; T().wheel = -a / 2.2; });
    const rel = e => { if (e.pointerId !== id) return; id = null; this.wheelA = 0; wh.style.transform = ''; T().wheel = 0; };
    wh.addEventListener('pointerup', rel); wh.addEventListener('pointercancel', rel);
  }
  countdown(left) {
    const el = $('#countdown'); if (left < 0 || left > 5) { el.hidden = left > 5 ? false : true; if (left > 5) el.textContent = 'GET READY'; return; }
    el.hidden = false; const n = Math.ceil(left); const txt = left > 3 ? 'GET READY' : n > 0 ? String(n) : 'GO';
    if (txt !== el.textContent) { el.textContent = txt; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); if (/^[123]$/.test(txt)) this.app.audio.beep(660, 0.18); }
    if (left <= 0.05) { el.textContent = 'GO'; this.app.audio.beep(1320, 0.4); setTimeout(() => el.hidden = true, 700); }
  }
  flash(t, dur = 1.2) { const el = $('#flash'); el.textContent = t; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); clearTimeout(this.ft); this.ft = setTimeout(() => el.classList.remove('show'), dur * 1000); }
  toast(t, dur = 3500) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; $('#toasts').appendChild(d); setTimeout(() => d.remove(), dur); }
  warn(t, secs) { const el = $('#warnbar'); el.hidden = false; el.textContent = t; clearTimeout(this.wt); this.wt = setTimeout(() => el.hidden = true, secs * 1000); }
  nameTag(name) {
    const d = document.createElement('div'); d.className = 'tag'; d.textContent = name; this.tags.appendChild(d); const v = new THREE.Vector3();
    return { el: d, remove: () => d.remove(), hide: () => d.style.display = 'none', at: (p, cam, suffix, maxD = 250) => { v.set(p.x, p.y + 2.2, p.z).project(cam); const dist = cam.position.distanceTo(p); if (v.z > 1 || dist > maxD) { d.style.display = 'none'; return; } d.style.display = ''; d.textContent = name + suffix; d.style.transform = `translate(${(v.x * 0.5 + 0.5) * innerWidth}px, ${(-v.y * 0.5 + 0.5) * innerHeight}px) translate(-50%,-100%)`; d.classList.toggle('talk', !!this.app.voice?.speaking.get(d.dataset.id)); } };
  }
  update(s, dt) {
    const S = s.S, P = s.P; this.acc = (this.acc || 0) + dt; if (this.acc < 1 / 20) return; this.acc = 0;
    const v = Math.abs(S.vx); const units = this.app.settings.game.units;
    $('#h-speed').textContent = Math.round(units === 'kmh' ? v * 3.6 : mph(v)); $('#h-unit').textContent = units === 'kmh' ? 'km/h' : 'mph';
    $('.h-speedo').style.visibility = s.foot?.active || (s.camMode === 'cockpit' && (s.cockpitInstruments || s.kdash || s.bint) && !P.ev) ? 'hidden' : '';
    $('#h-gear').textContent = s.inp.hPattern ? (S.gear < 0 ? 'R' : S.gear === 0 ? 'N' : S.gear) : S.reverse ? 'R' : Math.abs(S.vx) < 0.3 && s.inp.throttle < 0.05 && !P.ev ? 'N' : P.ev ? 'D' : S.gear;
    if (P.ev) { const kw = Math.max(-300, S.kwOut || 0); const f = Math.max(-1, Math.min(1, kw / P.motorKW)); $('#h-evbar').style.setProperty('--f', f); $('#h-kw').textContent = `${Math.round(kw)} kW`; $('#h-soc').textContent = this.app.settings.controls.evConsumption ? `${Math.round(S.soc * 100)}%` : ''; }
    else { const f = Math.min(1, S.rpm / P.redline); $('#h-revbar').style.setProperty('--f', f); $('#h-revbar').classList.toggle('red', f > 0.93); $('#h-rpm').textContent = `${Math.round(S.rpm / 100) * 100} rpm`; }
    if (s.isRace) {
      $('#h-time').textContent = fmt(s.state === 'finished' ? s.finalT : s.raceT);
      const per = s.route.cps.length; $('#h-lap').textContent = s.route.mode === 'circuit' ? `LAP ${Math.min(s.laps, Math.floor(s.cp / per) + 1)}/${s.laps}` : 'SPRINT';
      $('#h-cp').textContent = `CP ${Math.min(s.cp, s.cps.length)}/${s.cps.length}`;
      // arrow towards next checkpoint
      { // HUD chevron (top centre) pointing at the next checkpoint, with distance in metres
        const c = s.cps[s.cp], el = $('#h-guide'); el.hidden = !c || s.state === 'finished';
        if (c) { const cam = this.app.gfx.cam; const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
          const a = Math.atan2(c[0] - cam.position.x, -(c[1] - cam.position.z)) - Math.atan2(dir.x, -dir.z);
          $('#h-guide-chev').style.transform = `rotate(${a}rad)`; $('#h-guide-d').textContent = `${Math.round(Math.hypot(s.S.x - c[0], s.S.z - c[1]))} m`; }
      }
      if (s.online) this.position(s); else if (s.ai) { const [p, n] = s.ai.position(); $('#h-pos').textContent = `P${p}/${n}`; }
    } else $('#h-guide').hidden = true;
    { const G = this.app.gfx, S = G.stat; if (G.frames === 0 || !this._fpsTxt) { const g = this.app.settings.graphics; this._fpsTxt = `${Math.round(S.fps)} fps · ${S.ms.toFixed(1)} ms · 1% low ${Math.round(S.low1)}${g.resAuto ? ` · res ${Math.round(G.dynScale * 100)}%` : ''}${G.upPass?.enabled ? ' · sharp' : ''}${(g.fps || 60) > (S.hz || 60) + 5 ? ` · cap ${Math.round(S.hz)} Hz` : ''}`; $('#fps').textContent = this._fpsTxt; } } // measured from rAF deltas of drawn frames, refreshed once a second
    const st = this.app.net?.status; $('#netbar').hidden = !s.online || st === 'open'; if (st === 'reconnecting') $('#netbar').textContent = 'Connection lost — reconnecting… (your place is kept for 3 minutes)';
    $('#h-mic').classList.toggle('on', !!this.app.voice?.speaking.get('me'));
    { const off = !!this.app.settings.voice.micMuted || !this.app.voice?.track, b = $('#h-mic'); b.classList.toggle('muted', off); const t = off ? 'MIC OFF' : 'MIC ON'; if (b.textContent !== t) b.textContent = t; }
    this.minimap(s);
  }
  position(s) {
    const n = this.app.net; const me = { id: n.me, cp: s.cp, d: s.cps[s.cp] ? Math.hypot(s.S.x - s.cps[s.cp][0], s.S.z - s.cps[s.cp][1]) : 0, fin: s.state === 'finished' ? s.finalT : null };
    const list = [me];
    for (const [id, R] of s.remotes) { if (R.ghost) continue; const cp = s.remoteCp?.[id] ?? this.estimateCp(s, R); list.push({ id, cp: cp.cp, d: cp.d, fin: s.remoteFin?.[id] ?? null }); }
    list.sort((a, b) => (a.fin != null || b.fin != null) ? ((a.fin ?? 1e9) - (b.fin ?? 1e9)) : (b.cp - a.cp) || (a.d - b.d));
    $('#h-pos').textContent = `${list.findIndex(x => x.id === n.me) + 1}/${list.length}`;
  }
  estimateCp(s, R) { // remote progress estimate from nearest path point (display only; results come from the server)
    const p = R.obj.position; const path = s.route.path; let bi = 0, bd = 1e9; for (let i = 0; i < path.length; i += 2) { const d = (path[i][0] - p.x) ** 2 + (path[i][1] - p.z) ** 2; if (d < bd) { bd = d; bi = i; } }
    R.lapEst = R.lapEst || 0; if (R.lastIdx != null && R.lastIdx > path.length * 0.8 && bi < path.length * 0.2) R.lapEst++; R.lastIdx = bi;
    const f = (bi / path.length + R.lapEst) * s.route.cps.length; return { cp: Math.floor(f), d: (1 - (f % 1)) * 100 };
  }
  // road + district names in screen space (always upright, de-cluttered, nearest first)
  mapText(g, W, H, cx, cz, rot, sc, k) {
    const R = W / 2 - 14 * k, co = Math.cos(rot), si = Math.sin(rot), boxes = [];
    const at = (x, z) => { const dx = (x - cx) * sc, dy = (z - cz) * sc; return [W / 2 + dx * co - dy * si, H / 2 + dx * si + dy * co]; };
    const free = (x, y, w, h) => { for (const q of boxes) if (Math.abs(q[0] - x) < (q[2] + w) / 2 && Math.abs(q[1] - y) < (q[3] + h) / 2) return false; boxes.push([x, y, w, h]); return true; };
    g.save(); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    const areas = []; for (const a of this.mapAreas || []) { const [x, y] = at(a.x, a.z); const d = Math.hypot(x - W / 2, y - H / 2); if (d < R - 6 * k) areas.push([d, a, x, y]); }
    areas.sort((p, q) => p[0] - q[0]);
    for (const [, a, x, y] of areas.slice(0, 3)) { g.font = a.park ? `italic 600 ${9.5 * k}px system-ui,Arial` : `800 ${10.5 * k}px system-ui,Arial`; if ('letterSpacing' in g) g.letterSpacing = a.park ? '0px' : `${1.6 * k}px`;
      const w = g.measureText(a.t).width; if (!free(x, y, w + 6 * k, 14 * k)) continue; g.lineWidth = 3 * k; g.strokeStyle = 'rgba(6,8,12,.85)'; g.strokeText(a.t, x, y); g.fillStyle = a.park ? '#7fd49a' : 'rgba(255,214,102,.92)'; g.fillText(a.t, x, y); }
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    const roads = []; for (const l of this.mapLabels || []) { const [x, y] = at(l.x, l.z); const d = Math.hypot(x - W / 2, y - H / 2); if (d < R - 10 * k && d > 12 * k) roads.push([d - l.major * 30 * k, l, x, y]); }
    roads.sort((p, q) => p[0] - q[0]); let n = 0;
    for (const [, l, x, y] of roads) { if (n >= 7) break; g.font = `${l.major ? 700 : 600} ${(l.major ? 9.5 : 8.5) * k}px system-ui,Arial`; const w = g.measureText(l.t).width; if (w > l.seg * sc * 1.6) continue;
      let a = l.a + rot; a = Math.atan2(Math.sin(a), Math.cos(a)); if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI;
      const bw = Math.abs(Math.cos(a)) * w + Math.abs(Math.sin(a)) * 10 * k, bh = Math.abs(Math.sin(a)) * w + Math.abs(Math.cos(a)) * 10 * k; if (!free(x, y, bw, bh)) continue;
      g.save(); g.translate(x, y); g.rotate(a); g.lineWidth = 2.6 * k; g.strokeStyle = 'rgba(10,13,18,.9)'; g.strokeText(l.t, 0, 0); g.fillStyle = l.major ? '#ffffff' : '#d5dde6'; g.fillText(l.t, 0, 0); g.restore(); n++; }
    g.restore();
  }
  minimap(s) {
    const g = this.mmx, W = this.mm.width, H = this.mm.height, b = this.mb, S = this.mS; if (!this.mapImg) return;
    const Q = s.foot?.q && s.foot.active ? s.foot.q : s.S; /* on foot: centre on the walker */
    const px = (Q.x - b[0]) * S, py = (Q.z - b[1]) * S; const rot = this.app.settings.game.minimapRotate ? Q.yaw : 0;
    g.save(); g.clearRect(0, 0, W, H); g.beginPath(); g.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2); g.clip(); g.fillStyle = '#0c0f13'; g.fillRect(0, 0, W, H);
    const k = W / 180; g.translate(W / 2, H / 2); g.rotate(rot); const z = 1.4 * k * 0.8; g.scale(z, z); g.translate(-px, -py);
    g.drawImage(this.mapImg, 0, 0); if (s.route && this.routeImgs[s.route.id]) g.drawImage(this.routeImgs[s.route.id], 0, 0);
    const c = s.cps[s.cp]; if (c) { g.fillStyle = s.cp === s.cps.length - 1 ? '#ffd23f' : '#19e6c1'; g.beginPath(); g.arc((c[0] - b[0]) * S, (c[1] - b[1]) * S, 4, 0, 7); g.fill(); }
    if (s.ai) for (const A of s.ai.cars) { g.fillStyle = '#ffb02e'; g.beginPath(); g.arc((A.S.x - b[0]) * S, (A.S.z - b[1]) * S, 3.2, 0, 7); g.fill(); }
    for (const R of s.remotes.values()) { if (!R.obj.visible) continue; g.fillStyle = '#ff5a4a'; g.beginPath(); g.arc((R.obj.position.x - b[0]) * S, (R.obj.position.z - b[1]) * S, 3.5, 0, 7); g.fill(); }
    try { s.foot?.mm(g, b, S, z); } catch (e) { }
    g.restore();
    this.mapText(g, W, H, Q.x, Q.z, rot, S * z, k);
    { const vg = g.createRadialGradient(W / 2, H / 2, W * 0.36, W / 2, H / 2, W / 2); vg.addColorStop(0, 'rgba(8,10,14,0)'); vg.addColorStop(1, 'rgba(8,10,14,.75)'); g.fillStyle = vg; g.beginPath(); g.arc(W / 2, H / 2, W / 2, 0, 7); g.fill();
      g.strokeStyle = 'rgba(25,230,193,.55)'; g.lineWidth = 2 * k; g.beginPath(); g.arc(W / 2, H / 2, W / 2 - k, 0, 7); g.stroke(); }
    g.save(); g.translate(W / 2, H / 2); g.rotate(rot - Q.yaw); g.scale(k * 0.85, k * 0.85); g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 4; g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -8); g.lineTo(5.5, 6); g.lineTo(0, 3); g.lineTo(-5.5, 6); g.closePath(); g.fill(); g.restore();
    if (!rot) { g.fillStyle = 'rgba(255,255,255,.8)'; g.font = `700 ${11 * k}px system-ui,Arial`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', W / 2, 11 * k); }
    if (c && !this.app.settings.game.minimapRotate) { } // north-up mode: arrow only
  }
}
