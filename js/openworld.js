// Online Open World: a free-roam room (public instances of up to 8 drivers, or private with an invite code) where
// everyone drives their own car around the whole map, sees name tags, talks on voice (room-wide or proximity), uses a
// filtered, rate-limited text chat with quick phrases, can "meet up" (teleport next to a player) and can start an
// impromptu race (one driver picks a route, others accept) that returns everyone to the open world afterwards.
// All rules (instances, filter, rate limit, blocks, cooldowns, race validation, idle) are enforced by the server.
import { API } from './store.js';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = n => Number(n).toLocaleString('en-GB');
const fmtT = t => { if (t == null) return '—'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`; };

export class OpenWorld {
  constructor(app) {
    this.app = app; this.net = app.net; this.active = false; this.info = null; this.log = []; this.panel = null; this.quick = [];
    this.lastAct = 0; this.bind();
  }
  get room() { return this.net.room; }
  get sess() { return this.app.session; }
  // ------------------------------------------------------------------ menu screen
  open() {
    const a = this.app; if (a.screen !== 'world') a.stack.push(a.screen); a.show('world');
    $('#ow-as').textContent = a.store.user?.name || ''; $('#ow-err').hidden = true; this.counts();
  }
  async counts() {
    try { const r = await (await fetch(`${API}/api/worlds`)).json(); const w = r.worlds || []; const n = w.reduce((s, x) => s + x.players, 0);
      $('#ow-online').textContent = n ? `${n} driver${n === 1 ? '' : 's'} in ${w.filter(x => x.players).length || 1} public world${w.length > 1 ? 's' : ''} right now` : 'Nobody in the public world yet — be the first'; }
    catch (e) { $('#ow-online').textContent = ''; }
  }
  err(t) { $('#ow-err').hidden = false; $('#ow-err').textContent = t; }
  async join(kind) {
    const a = this.app;
    try { await a.ensureNet(); } catch (e) { this.err(e.message); return; }
    let off = null;
    if (kind === 'code') {
      const code = ($('#ow-code').value || '').toUpperCase().replace(/[^A-Z]/g, ''); if (code.length !== 5) return this.err('Invite codes are 5 letters.');
      off = this.net.on('err', m => { off(); this.err(m.msg); }); this.net.send({ t: 'join', code, me: a.me() });
    } else { off = this.net.on('err', m => { off(); this.err(m.msg); }); this.net.send({ t: 'world', private: kind === 'private', me: a.me() }); }
    a.awaitJoin(off);
  }
  // ------------------------------------------------------------------ entering / leaving the world
  async enter(j) {
    this.active = true; this.info = j; this.quick = j.quick || []; this.log = []; this.app.stack = ['menu'];
    await this.launch(null, j.near);
    const where = j.private ? `Private open world · code ${j.code}` : `Public open world #${j.instance}`;
    this.sysMsg(`${where}. Everyone spawns at the ${j.meet?.name || "car meet"}.`);
    if (j.near) this.sysMsg(`You spawned next to ${j.near.name}.`);
    this.renderInvite(j.wr);
    clearInterval(this.proxT); this.proxT = setInterval(() => this.prox(), 250);
  }
  async launch(at, near) {
    const a = this.app; const p = a.store.profile; const car = a.carsById[p.selected];
    a.endSession(); a.show('none');
    await a.launch({ mode: 'world', online: true, net: this.net, slot: this.info.slot || 0, t0: 0, time: 'day', weather: 'dry', carObj: car, ups: p.ups[car.id] || {}, custom: p.custom[car.id] || {}, at });
    if (near && this.sess) this.sess.teleportNear(near);
    this.showHud();
  }
  showHud() { const on = this.active && !!this.sess; $('#ow-log').hidden = !on; $('#ow-bar').hidden = !(on && this.sess.o.mode === 'world'); this.renderLog(); this.renderInvite(this.room?.wr); }
  exit() {
    this.active = false; this.close(); clearInterval(this.proxT); this.app.voice.prox.clear(); this.app.voice.applyAll();
    $('#ow-log').hidden = true; $('#ow-bar').hidden = true; $('#ow-inv').hidden = true; this.info = null;
  }
  // ------------------------------------------------------------------ net events
  bind() {
    const n = this.net;
    n.on('chat', m => this.onChat(m));
    n.on('chaterr', m => this.app.hud.toast(m.msg));
    n.on('meetup', m => { if (!m.ok) { this.app.hud.toast(m.msg); return; } this.close(); this.sess?.teleportNear(m); this.app.hud.flash(`MET UP WITH ${m.name}`, 1.2); });
    n.on('wr', m => this.onRace(m));
    n.on('wr_results', m => this.onResults(m));
    n.on('wr_quit_ok', () => { if (this.sess?.o.worldRace) this.backToWorld(); });
    n.on('room', m => { if (!this.active) return; if (this.panel === 'meet' || this.panel === 'voice' || this.panel === 'race') this.render(); });
    for (const t of ['removed', 'expired', 'lost']) n.on(t, () => this.active && this.exit());
    n.on('info', m => { if (this.active && /joined the open world|met up/.test(m.msg)) this.sysMsg(m.msg); });
    // menu buttons
    $('#ow-public').onclick = () => this.join('public'); $('#ow-private').onclick = () => this.join('private'); $('#ow-join').onclick = () => this.join('code');
    $('#ow-code').addEventListener('keydown', e => { if (e.key === 'Enter') this.join('code'); });
    // HUD bar and panel
    for (const b of document.querySelectorAll('#ow-bar [data-ow]')) b.onclick = () => { this.app.audio.click(); this.openPanel(b.dataset.ow); };
    $('#ow-back').onclick = () => { this.app.audio.click('back'); this.close(); };
    // anything you do in menus counts as activity in the open world (server idle rule), throttled
    const act = () => { if (this.active && performance.now() - this.lastAct > 15000) { this.lastAct = performance.now(); this.app.uiAct = performance.now(); n.send({ t: 'act' }); } };
    addEventListener('pointerdown', act, true); addEventListener('keydown', act, true);
  }
  // ------------------------------------------------------------------ text chat
  onChat(m) {
    const vs = this.app.settings.voice; if (vs.muted[m.id] || this.app.voice.blocked.has(m.id)) return; // muted players' chat is hidden too
    this.log.push({ id: m.id, name: m.name, text: m.text, ts: performance.now(), me: m.id === this.net.me }); if (this.log.length > 40) this.log.shift();
    this.renderLog(); if (this.panel === 'chat') this.renderChatList();
    if (m.id !== this.net.me) this.app.audio.beep(880, 0.05, 'menu');
  }
  sysMsg(t) { this.log.push({ sys: true, text: t, ts: performance.now() }); if (this.log.length > 40) this.log.shift(); this.renderLog(); }
  renderLog() {
    const el = $('#ow-log'); if (!el) return; const t = performance.now();
    el.innerHTML = this.log.filter(x => t - x.ts < 15000).slice(-5).map(x => x.sys ? `<div class="sys">${esc(x.text)}</div>` : `<div><b>${esc(x.name)}</b> ${esc(x.text)}</div>`).join('');
    clearTimeout(this.logT); if (el.innerHTML) this.logT = setTimeout(() => this.renderLog(), 3000);
  }
  send(text, q) {
    if (q != null) this.net.send({ t: 'chat', q }); else { text = (text || '').trim(); if (!text) return; this.net.send({ t: 'chat', text }); }
    this.app.uiAct = performance.now();
  }
  // ------------------------------------------------------------------ panels (each has a Back button)
  openPanel(kind) {
    this.panel = kind; $('#ow-panel').hidden = false; if (this.sess) this.sess.paused = true; // car brakes itself while a panel is open
    this.render();
  }
  close() { this.panel = null; $('#ow-panel').hidden = true; if (this.sess && !this.app.paused) this.sess.paused = false; }
  render() {
    const k = this.panel; if (!k) return; const body = $('#ow-body');
    $('#ow-title').textContent = { chat: 'Chat', meet: 'Meet up', race: 'Start a race', voice: 'Voice, players & car' }[k];
    if (k === 'chat') {
      if (!$('#ow-chatlist', body)) {
        body.innerHTML = `<div id="ow-chatlist" class="ow-chatlist"></div>
          <div class="ow-send"><input id="ow-text" maxlength="120" placeholder="Type a message…" autocomplete="off" enterkeyhint="send"><button class="btn small primary" id="ow-sendbtn">Send</button></div>
          <div class="chips ow-quick">${this.quick.map((q, i) => `<button class="chip" data-q="${i}">${esc(q)}</button>`).join('')}</div>
          <p class="note">Messages are filtered for bad language and limited to 5 every 10 seconds. Muted or blocked players' messages are hidden — manage them under Voice.</p>`;
        const go = () => { this.send($('#ow-text').value); $('#ow-text').value = ''; };
        $('#ow-sendbtn').onclick = go; $('#ow-text').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') go(); if (e.key === 'Escape') this.close(); });
        for (const b of body.querySelectorAll('[data-q]')) b.onclick = () => this.send(null, +b.dataset.q);
      }
      this.renderChatList(); return;
    }
    if (k === 'meet') {
      const others = (this.room?.players || []).filter(p => p.id !== this.net.me);
      body.innerHTML = `<ul class="plist">${others.map(p => { const s = this.net.sample(p.id); const d = s && this.sess ? Math.round(Math.hypot(s.x - this.sess.S.x, s.z - this.sess.S.z)) : null; const car = this.app.carsById[p.car];
        const why = p.away ? 'reconnecting' : p.racing ? 'racing' : !s ? 'not driving yet' : this.app.voice.blocked.has(p.id) ? 'blocked' : '';
        return `<li><div class="nm">${esc(p.name)}<small>${esc(car?.name || p.car)}${d != null ? ` · ${num(d)} m away` : ''}${why ? ' · ' + why : ''}</small></div><button class="btn small primary" data-meet="${p.id}" ${why ? 'disabled' : ''}>Meet up</button></li>`; }).join('') || '<li>No other drivers in this world yet. Share your invite code or wait for someone to join.</li>'}</ul>
        <p class="note">Meet up puts your car on the road right next to that driver. Everyone starts at the ${esc(this.info?.meet?.name || 'car meet')}.</p>
        <button class="btn small" id="ow-tomeet">Drive me back to the car meet</button>`;
      for (const b of body.querySelectorAll('[data-meet]')) b.onclick = () => this.net.send({ t: 'meetup', id: b.dataset.meet });
      $('#ow-tomeet').onclick = () => { const m = this.app.routes.meet; this.sess?.teleportNear({ x: m.x, z: m.z, y: this.app.world.groundAt(m.x, m.z, 0).h || 0, yaw: 0, meet: true }); this.close(); };
      return;
    }
    if (k === 'race') return this.renderRace(body);
    if (k === 'voice') return this.renderVoice(body);
  }
  renderChatList() { const el = $('#ow-chatlist'); if (!el) return; el.innerHTML = this.log.map(x => x.sys ? `<div class="sys">${esc(x.text)}</div>` : `<div class="${x.me ? 'me' : ''}"><b>${esc(x.name)}</b> ${esc(x.text)}</div>`).join('') || '<div class="sys">No messages yet — say hello.</div>'; el.scrollTop = 1e6; }
  renderRace(body) {
    const w = this.room?.wr; const me = this.net.me; const R = this.app.routes.routes;
    if (w) {
      const names = id => this.room.players.find(p => p.id === id)?.name || '?'; const r = R.find(x => x.id === w.route);
      body.innerHTML = `<p><b>${esc(w.hostName)}</b> ${w.state === 'race' ? 'is running' : 'invited everyone to'} <b>${esc(r?.name)}</b>${r?.mode === 'circuit' ? ` · ${w.laps} lap${w.laps > 1 ? 's' : ''}` : ''}.</p>
        <p class="note">Accepted: ${w.acc.map(names).map(esc).join(', ') || '—'}${w.dec.length ? ` · Declined: ${w.dec.map(names).map(esc).join(', ')}` : ''}</p>
        <div class="m-btns">${w.state !== 'invite' ? '<span class="note">A race is in progress. You can start another one when it finishes.</span>' : w.host === me ? `<button class="btn ghost" id="wr-cancel">Cancel race</button><button class="btn primary" id="wr-go">Start now</button>` : `<button class="btn ghost" id="wr-no">Decline</button><button class="btn primary" id="wr-yes">${w.acc.includes(me) ? 'Accepted ✓' : 'Accept'}</button>`}</div>`;
      this.bindRaceBtns(body); return;
    }
    const s = this.raceSel = this.raceSel || { route: 'jq_sprint', laps: 1 }; const rt = R.find(x => x.id === s.route);
    body.innerHTML = `<div class="cards ow-routes">${R.map(r => `<button class="card ${s.route === r.id ? 'on' : ''}" data-r="${r.id}"><b>${esc(r.name)}</b><div class="meta">${r.mode === 'circuit' ? 'Circuit' : 'Sprint'} · ${(r.length / 1000).toFixed(1)} km</div></button>`).join('')}</div>
      ${rt?.mode === 'circuit' ? `<h3>Laps</h3><div class="chips">${[1, 2, 3].map(n => `<button class="chip ${s.laps === n ? 'on' : ''}" data-l="${n}">${n}</button>`).join('')}</div>` : ''}
      <p class="note">Everyone in this world gets your invite. The race starts when you press Start (or after 30 s) with the drivers who accepted; the rest keep free-roaming. You all come back to the open world at the finish.</p>
      <div class="m-btns"><button class="btn primary" id="wr-send">Send race invite</button></div>`;
    for (const b of body.querySelectorAll('[data-r]')) b.onclick = () => { s.route = b.dataset.r; this.render(); };
    for (const b of body.querySelectorAll('[data-l]')) b.onclick = () => { s.laps = +b.dataset.l; this.render(); };
    $('#wr-send').onclick = () => { this.net.send({ t: 'wr_propose', route: s.route, laps: s.laps }); };
  }
  bindRaceBtns(root) {
    const q = id => $(id, root);
    q('#wr-go') && (q('#wr-go').onclick = () => this.net.send({ t: 'wr_go' }));
    q('#wr-cancel') && (q('#wr-cancel').onclick = () => this.net.send({ t: 'wr_cancel' }));
    q('#wr-yes') && (q('#wr-yes').onclick = () => this.net.send({ t: 'wr_accept', v: true }));
    q('#wr-no') && (q('#wr-no').onclick = () => this.net.send({ t: 'wr_accept', v: false }));
  }
  renderVoice(body) {
    const a = this.app, v = a.voice, vs = a.settings.voice, p = a.store.profile, i = this.info || {};
    body.innerHTML = `${i.private ? `<p>Invite code <b class="ow-code">${esc(i.code)}</b> <button class="btn small ghost" id="ow-copy">Copy invite</button></p>` : `<p class="note">Public open world #${i.instance} · ${this.room?.players.length || 1}/8 drivers</p>`}
      <div class="voicebar" id="ow-vbar">${a.voiceBar()}
        <chip-select id="ow-range" aria-label="Voice range"><option value="room" ${vs.range !== 'prox' ? 'selected' : ''}>Hear everyone in the world</option><option value="prox" ${vs.range === 'prox' ? 'selected' : ''}>Proximity: only drivers within ~130 m</option></chip-select></div>
      <h3>Your car</h3><div class="carpick"><chip-select id="ow-car" aria-label="Your car">${a.cars.filter(c => p.owned[c.id]).map(c => `<option value="${c.id}" ${p.selected === c.id ? 'selected' : ''}>${esc(c.name)} (${c.cls})</option>`).join('')}</chip-select></div>
      <p class="note">Others see your chosen car with your paint and upgrades. Paint and parts are changed in the Showroom / Upgrade menus.</p>
      <div id="ow-pp"></div>
      <div class="m-btns"><button class="btn danger" id="ow-leave">Leave open world</button></div>`;
    const q = id => $(id, body);
    a.bindVoiceBar(q('#ow-vbar'), () => this.render());
    q('#ow-range').onchange = e => { vs.range = e.target.value; a.saveSettings(); v.announce(); this.prox(); };
    q('#ow-copy') && (q('#ow-copy').onclick = async () => { const t = `Join my CUZZY RACING open world — invite code ${i.code}`; try { await navigator.clipboard.writeText(t); a.hud.toast('Invite copied'); } catch (e) { a.hud.toast('Invite code: ' + i.code); } });
    q('#ow-car').onchange = e => this.changeCar(e.target.value);
    q('#ow-leave').onclick = () => a.confirm('Leave open world', 'Leave this open world and go back to the main menu?', 'Leave', () => { a.endSession(); a.leaveRoom(true); });
    a.playersPanel(q('#ow-pp'));
  }
  async changeCar(id) {
    const a = this.app; const car = a.carsById[id];
    try { await a.store.act('select', { car: id }); } catch (e) { a.hud.toast(e.message); return; }
    this.net.send({ t: 'me', me: a.me() });
    const p = a.store.profile; this.sess?.setCar(car, p.ups[id] || {}, p.custom[id] || {}); a.hud.show(this.sess); this.showHud();
  }
  // proximity voice: full volume within 20 m, fading to silent at 120 m
  prox() {
    const v = this.app.voice; const s = this.sess; if (!s || !this.active) return;
    const on = this.app.settings.voice.range === 'prox';
    for (const id of (this.room?.players || []).map(p => p.id).filter(id => id !== this.net.me)) {
      const R = s.remotes.get(id); let f = 1;
      if (on) { if (!R || !R.obj.visible) f = 0; else { const d = Math.hypot(R.obj.position.x - s.S.x, R.obj.position.z - s.S.z); f = Math.max(0, Math.min(1, 1 - (d - 20) / 100)); } }
      if (Math.abs((v.prox.get(id) ?? 1) - f) > 0.02) { v.prox.set(id, f); v.applyVol(id); }
    }
  }
  // ------------------------------------------------------------------ impromptu races
  renderInvite(w) {
    const el = $('#ow-inv'); if (!el) return; const me = this.net.me;
    if (!this.active || !w || !this.sess || this.sess.o.worldRace || w.state !== 'invite') { el.hidden = true; clearInterval(this.invT); return; }
    const r = this.app.routes.routes.find(x => x.id === w.route); const host = w.host === me;
    const upd = () => { const left = Math.max(0, Math.round(w.deadline - (w.now + (performance.now() - this.invAt) / 1000))); const s = $('#ow-invleft'); if (s) s.textContent = `${left}s`; };
    this.invAt = performance.now();
    el.innerHTML = `<div><b>${host ? 'Your race invite' : esc(w.hostName) + ' wants to race'}</b>: ${esc(r?.name)}${r?.mode === 'circuit' ? ` · ${w.laps} lap${w.laps > 1 ? 's' : ''}` : ''} · ${w.acc.length} in · <span id="ow-invleft"></span></div>
      <div class="m-btns">${host ? `<button class="btn small ghost" id="wr-cancel">Cancel</button><button class="btn small primary" id="wr-go">Start now</button>` : `<button class="btn small ghost" id="wr-no">${w.dec.includes(me) ? 'Declined' : 'Decline'}</button><button class="btn small primary" id="wr-yes">${w.acc.includes(me) ? 'Accepted ✓' : 'Accept'}</button>`}</div>`;
    el.hidden = false; this.bindRaceBtns(el); upd(); clearInterval(this.invT); this.invT = setInterval(upd, 1000);
  }
  onRace(m) {
    if (!this.active) return;
    if (m.ev === 'invite' && m.wr.host !== this.net.me) { this.sysMsg(`${m.wr.hostName} sent a race invite`); this.app.audio.beep(740, 0.2, 'menu'); }
    if (m.ev === 'cancel') { this.sysMsg(m.reason || 'Race cancelled'); if (this.panel === 'race') this.render(); }
    if (m.ev === 'start') {
      const mine = m.wr.parts.includes(this.net.me);
      if (!mine) this.sysMsg(`${m.wr.hostName}'s race has started — ${m.wr.parts.length} drivers`);
      else this.startRace(m);
    }
    this.renderInvite(m.wr); if (this.panel === 'race') this.render();
  }
  async startRace(m) {
    const a = this.app; const S = m.settings; const p = a.store.profile; const car = a.carsById[p.selected];
    this.close(); this.raceParts = m.wr.parts; a.endSession();
    await a.launch({ mode: S.mode, route: S.route, laps: S.laps, time: 'day', weather: 'dry', online: true, net: this.net, slot: m.slots[this.net.me] ?? 0, t0: m.wr.t0, worldRace: true, parts: m.wr.parts, carObj: car, ups: p.ups[car.id] || {}, custom: p.custom[car.id] || {} });
    this.showHud();
  }
  async backToWorld() {
    if (this.returning || !this.sess?.o.worldRace) return; this.returning = true;
    const s = this.sess; const at = { x: s.S.x, z: s.S.z, yaw: s.S.yaw, h: s.S.y };
    try { await this.launch(at); } finally { this.returning = false; }
  }
  async onResults(m) {
    if (!this.active) return; const me = this.net.me; const inRace = !!this.sess?.o.worldRace;
    const win = m.results.find(r => r.pos === 1);
    if (!m.parts.includes(me)) { this.sysMsg(win ? `${win.name} won the race (${fmtT(win.time)})` : 'The race ended'); return; }
    if (inRace) await this.backToWorld();
    const a = this.app;
    a.modal('Race results', `<table class="res-table"><tr><th>Pos</th><th>Driver</th><th>Time</th><th>Credits</th></tr>${m.results.map(r => `<tr class="${r.id === me ? 'me' : ''}"><td>${r.pos ?? 'DNF'}</td><td>${esc(r.name)}</td><td>${fmtT(r.time)}</td><td>+${num(r.reward)}</td></tr>`).join('')}</table><p class="note">Checked by the server. You're back in the open world where you finished.</p>`, [{ t: 'Back to open world', cls: 'primary' }]);
    a.store.load().then(() => a.refreshWallet()).catch(() => { });
  }
}
