// Multiplayer connection: WebSocket to the CUZZY RACING server, automatic reconnection with a resume token,
// server clock sync and snapshot interpolation for remote cars. The first message on every connection is the
// signed-in player's session token ({t:'auth'}); the server refuses the socket without a valid one. Binary frames
// carry server-relayed voice (see voice.js).
import { wsURL, session } from './store.js';

export class Net {
  constructor() {
    this.ws = null; this.h = new Map(); this.room = null; this.me = null; this.token = null; this.code = null;
    this.offset = 0; this.rtt = 0; this.status = 'off'; this.snaps = new Map(); this.retry = 0; this.wantOpen = false;
  }
  on(t, f) { if (!this.h.has(t)) this.h.set(t, new Set()); this.h.get(t).add(f); return () => this.h.get(t).delete(f); }
  fire(t, m) { for (const f of this.h.get(t) || []) { try { f(m); } catch (e) { console.error(e); } } for (const f of this.h.get('*') || []) f(m); }
  now() { return performance.now() / 1000 + this.offset; }
  connect() {
    return new Promise((res, rej) => {
      this.wantOpen = true; this.status = 'connecting'; this.fire('status', this.status);
      let ws; try { ws = new WebSocket(wsURL()); } catch (e) { rej(e); return; }
      ws.binaryType = 'arraybuffer'; this.ws = ws; let opened = false;
      const to = setTimeout(() => { if (!opened) { ws.close(); rej(new Error('Timed out connecting to the multiplayer server')); } }, 10000);
      ws.onopen = () => { const tok = session.token; if (!tok) { clearTimeout(to); ws.close(); const e = new Error('Please sign in again'); e.auth = true; this.fire('autherr', {}); rej(e); return; } ws.send(JSON.stringify({ t: 'auth', token: tok })); };
      ws.onmessage = e => {
        if (e.data instanceof ArrayBuffer) { this.fire('vbin', e.data); return; }
        let m; try { m = JSON.parse(e.data); } catch (x) { return; }
        if (!opened) {
          if (m.t === 'authok') { opened = true; clearTimeout(to); this.user = m.user; this.status = 'open'; this.retry = 0; this.fire('status', this.status); this.ping(); clearInterval(this.pingT); this.pingT = setInterval(() => this.ping(), 3000); res(); }
          else if (m.t === 'autherr') { clearTimeout(to); this.wantOpen = false; const er = new Error(m.msg || 'Please sign in again'); er.auth = true; this.fire('autherr', m); rej(er); }
          return;
        }
        this.handle(m);
      };
      ws.onerror = () => { if (!opened) { clearTimeout(to); rej(new Error('Could not connect to the multiplayer server')); } };
      ws.onclose = () => { clearInterval(this.pingT); if (this.ws !== ws) return; this.ws = null; if (!opened) return; this.status = 'closed'; this.fire('status', this.status); if (this.wantOpen && this.code && this.token) this.reconnect(); };
    });
  }
  async reconnect() {
    this.status = 'reconnecting'; this.fire('status', this.status); const started = Date.now();
    while (this.wantOpen && Date.now() - started < 180000) {
      await new Promise(r => setTimeout(r, Math.min(5000, 700 * 2 ** this.retry++)));
      if (!this.wantOpen) return;
      try { await this.connect(); this.send({ t: 'resume', code: this.code, id: this.me, token: this.token }); return; } catch (e) { if (e.auth) return; }
    }
    if (this.wantOpen) { this.status = 'lost'; this.fire('status', this.status); this.fire('lost', {}); }
  }
  ping() { this.send({ t: 'ping', c: performance.now() }); }
  send(m) { if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(m)); return true; } return false; }
  sendBin(buf) { const w = this.ws; if (w && w.readyState === 1 && w.bufferedAmount < 64000) { w.send(buf); return true; } return false; } // voice: dropped (not queued) when the link is congested
  handle(m) {
    switch (m.t) {
      case 'pong': { const rtt = (performance.now() - m.c) / 1000; this.rtt = this.rtt ? this.rtt * 0.8 + rtt * 0.2 : rtt; const off = m.now + rtt / 2 - performance.now() / 1000; this.offset = this.offsetSet ? this.offset * 0.9 + off * 0.1 : off; this.offsetSet = true; break; }
      case 'joined': this.me = m.id; this.token = m.token; this.code = m.code; break;
      case 'room': this.room = m; break;
      case 'snap': for (const p of m.p) { if (p.id === this.me) continue; let b = this.snaps.get(p.id); if (!b) { b = []; this.snaps.set(p.id, b); } b.push({ t: m.now, s: p }); if (b.length > 30) b.shift(); } break;
      case 'left': this.snaps.delete(m.id); break;
      case 'err': if (m.expired) { this.code = null; this.token = null; } break;
      case 'expired': case 'removed': this.wantOpen = false; this.code = null; this.token = null; break;
    }
    this.fire(m.t, m);
  }
  // interpolated state for a remote player ~120 ms in the past (extrapolates briefly if packets are late)
  sample(id, delay = 0.12) {
    const b = this.snaps.get(id); if (!b || !b.length) return null;
    const t = this.now() - delay;
    let i = b.length - 1; while (i > 0 && b[i - 1].t > t) i--;
    const B = b[i], A = b[i - 1];
    if (!A || t >= B.t) { const dt = Math.min(0.3, Math.max(0, t - B.t)); const s = { ...B.s }; s.x += (s.vwx || 0) * dt; s.z += (s.vwz || 0) * dt; s.stale = t - B.t > 1.5; return s; }
    const k = Math.max(0, Math.min(1, (t - A.t) / Math.max(1e-3, B.t - A.t)));
    const s = { ...B.s }; for (const f of ['x', 'y', 'z', 'rpm', 'st', 'vx']) if (A.s[f] != null) s[f] = A.s[f] + (B.s[f] - A.s[f]) * k;
    let dy = B.s.yaw - A.s.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI; s.yaw = A.s.yaw + dy * k;
    return s;
  }
  leave() { this.leftAt = Date.now(); this.send({ t: 'leave' }); this.wantOpen = false; this.code = null; this.token = null; this.room = null; this.snaps.clear(); setTimeout(() => { try { this.ws?.close(); } catch (e) { } this.ws = null; }, 100); this.status = 'off'; }
}
