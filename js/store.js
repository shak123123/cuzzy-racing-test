// Server-backed save data and player accounts. Every request carries the signed-in player's session token as
// `Authorization: Bearer <token>`; the server derives the player from that token (no client-chosen ids). The token is
// kept in localStorage (the hosting proxy strips ordinary cookies), so the player stays signed in until Sign out.
const DEPLOYED = !'__PORT_8000__'.startsWith('__');
export const API = DEPLOYED ? '__PORT_8000__' : (location.port === '8000' ? '' : `${location.protocol}//${location.hostname}:8000`);
const TK = 'cuzzy.session';
// p51 offline / guest mode: the static GitHub Pages test build (or ?offline=1) has no game server, so the profile API is
// emulated in localStorage (no accounts, no online rooms / voice). The Perplexity-hosted build is unaffected.
export const OFFLINE = /github\.io$/.test(location.hostname) || new URLSearchParams(location.search).get('offline') === '1';
const OK = 'cuzzy.offline.profile';
let CARS_L = null; const carsList = async () => CARS_L || (CARS_L = await fetch('./shared/cars.json').then(r => r.json()).catch(() => []));
async function offlineReq(path, body) {
  const user = { id: 0, name: 'Guest' }; const load = async () => { let p = null; try { p = JSON.parse(localStorage.getItem(OK) || 'null'); } catch (e) { }
    const cars = await carsList(); if (!p) p = { v: 1, name: 'Guest', credits: 15000, owned: {}, selected: 'db9v', ups: {}, custom: { db9v: { colour: cars.find(c => c.id === 'db9v')?.colour, roofDown: true } }, setups: {}, settings: null, records: {}, stats: { races: 0, wins: 0, distance: 0, earned: 0 }, tutorial: false, inv: {} };
    for (const c of cars) p.owned[c.id] = p.owned[c.id] || {}; return p; };
  const save = p => { try { localStorage.setItem(OK, JSON.stringify(p)); } catch (e) { } };
  if (/^\/api\/auth\/(login|register)/.test(path)) { session.set('guest'); return { ok: true, token: 'guest', user, profile: await load() }; }
  if (path === '/api/profile' && !body) return { ok: true, profile: await load(), user };
  if (path === '/api/profile') { const p = await load(), a = body.action, car = body.car; const out = { ok: true, profile: p };
    if (a === 'settings') p.settings = body.settings; else if (a === 'tutorial') p.tutorial = true; else if (a === 'tutorial_reward') { if (!p.tutorialPaid) { p.tutorialPaid = true; p.credits += 2000; } }
    else if (a === 'select') { if (p.owned[car]) p.selected = car; } else if (a === 'upgrade') { const cur = p.ups[car] || {}; for (const [k, v] of Object.entries(body.parts || {})) cur[k] = Math.max(0, Math.min(3, v | 0)); p.ups[car] = cur; out.charged = 0; out.refunded = 0; }
    else if (a === 'custom') { p.custom[car] = { ...(p.custom[car] || {}), ...(body.custom || {}) }; } else if (a === 'setup_save') { (p.setups[car] = p.setups[car] || {})[String(body.name || 'Setup').slice(0, 20)] = { ...(p.ups[car] || {}) }; }
    else if (a === 'setup_delete') { delete (p.setups[car] || {})[body.name]; } else if (a === 'free_drive') { const e = Math.round(Math.min(3, +body.km || 0) * 120); p.credits += e; p.stats.distance += +body.km || 0; out.earned = e; }
    else if (a === 'shop') { p.inv = p.inv || {}; p.inv[body.item] = 1; } else if (a === 'solo_result') { p.stats.races++; Object.assign(out, { reward: 0, medal: null, record: false, par: 0 }); }
    save(p); return out; }
  return { ok: true };
}

export const session = {
  get token() { if (OFFLINE) return 'guest'; try { return localStorage.getItem(TK) || null; } catch (e) { return null; } },
  set(t) { try { t ? localStorage.setItem(TK, t) : localStorage.removeItem(TK); } catch (e) { } },
};

export function wsURL() {
  if (DEPLOYED) { const base = new URL('__PORT_8000__/ws', location.href); base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'; return base.href; }
  const host = location.port === '8000' ? location.host : `${location.hostname}:8000`;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${host}/ws`; // the session token is sent as the first message, never in the URL
}

let onAuthLost = () => { };
export function setAuthLost(f) { onAuthLost = f; }

async function req(path, body, tries = 3, { auth = true } = {}) {
  if (OFFLINE) return offlineReq(path, body);
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const h = {}; if (body) h['Content-Type'] = 'application/json';
      const tok = session.token; if (auth && tok) h.Authorization = 'Bearer ' + tok;
      const r = await fetch(`${API}${path}`, body ? { method: 'POST', headers: h, body: JSON.stringify(body) } : { headers: h });
      const j = await r.json().catch(() => ({ ok: false, error: `Server error ${r.status}` }));
      if (!r.ok || j.ok === false) {
        const e = new Error(j.error || `Server error ${r.status}`); e.server = true; e.status = r.status; e.code = j.code; e.retry = j.retry;
        if (r.status === 401 && j.auth) { e.auth = true; if (auth) onAuthLost(e); }
        throw e;
      }
      return j;
    } catch (e) { lastErr = e; if (e.server) throw e; await new Promise(r => setTimeout(r, 500 * (i + 1))); }
  }
  const e = new Error('Could not reach the CUZZY RACING server. Check your connection and try again.'); e.offline = true; e.cause = lastErr; throw e;
}

export class Store {
  constructor() { this.profile = null; this.user = null; this.listeners = new Set(); this.pending = null; this.status = 'idle';
    // play-time heartbeat for the owner stats (once a minute while the game is visible and signed in)
    const beat = () => { if (!session.token || document.visibilityState !== 'visible') return; let b = {};
      try { const A = window.CUZZY, S = A?.session, G = A?.gfx; b = { mode: !S ? (A?.screen === 'boot' ? 'loading' : 'menu') : S.foot?.active ? 'foot' : S.isRace ? (S.online ? 'online race' : 'race') : (S.o?.mode === 'world' ? 'open world' : 'drive'), gfx: A?.settings?.graphics?.preset, fps: G?.measured ? Math.round(G.measured()) || null : null }; } catch (e) { }
      req('/api/beat', b, 1).catch(() => { }); };
    setTimeout(beat, 5000); setInterval(beat, 60000); }
  get signedIn() { return !!session.token; }
  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
  emit() { for (const f of this.listeners) f(this.profile, this.status); }
  async load() { const j = await req('/api/profile'); this.profile = j.profile; this.user = j.user; this.status = 'saved'; this.emit(); return j.profile; }
  // ---- accounts
  async signIn(username, password) { return this._auth('/api/auth/login', username, password); }
  async register(username, password) { return this._auth('/api/auth/register', username, password); }
  async _auth(path, username, password) {
    const j = await req(path, { username, password }, 1, { auth: false });
    session.set(j.token); this.user = j.user; this.profile = j.profile; this.status = 'saved'; this.emit(); return j;
  }
  async signOut() { try { await req('/api/auth/logout', {}, 1, { auth: true }); } catch (e) { } session.set(null); this.user = null; }
  // every mutating action goes through the server, which validates prices/ownership and returns the new profile
  async act(action, data = {}) {
    this.status = 'saving'; this.emit();
    try { const j = await req('/api/profile', { action, ...data }); if (j.profile) this.profile = j.profile; this.status = 'saved'; this.lastError = null; this.emit(); return j; }
    catch (e) { this.status = e.offline ? 'failed' : 'saved'; this.lastError = e.message; this.emit(); throw e; }
  }
  // settings are saved debounced; failures are shown and retried
  saveSettings(s) {
    clearTimeout(this.pending); this.status = 'saving'; this.emit();
    this.pending = setTimeout(async () => { try { await this.act('settings', { settings: s }); } catch (e) { this.status = 'failed'; this.lastError = e.message; this.emit(); } }, 600);
  }
  async health() { return req('/api/health', null, 1, { auth: false }); }
}

export async function sendFeedback(kind, msg, ctx) { return req('/api/feedback', { kind, msg, ctx }, 2); }
