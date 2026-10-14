// Room voice chat, relayed by the CUZZY RACING game server over the signed-in WebSocket. There are no peer-to-peer
// connections (no WebRTC, no STUN/ICE), so players never learn each other's IP addresses.
//
// Sending (only while your mic is ON):  mic -> AudioWorklet 'cz-mic' (16 kHz mono, voice-activity gate: silence is not
//   sent) -> 20 ms frames -> WebCodecs Opus (24 kbit/s) when AudioEncoder supports it AND every listener can decode
//   Opus, otherwise 8-bit mu-law (128 kbit/s) -> binary WebSocket frame [1][codec][seq16][payload].
// Server: forwards to players in the same room who are listening (open world: within ~130 m when proximity voice is
//   chosen), never back to the sender, never to/from blocked players or listeners who muted the sender; per-sender caps.
// Receiving: frame [1][codec][seq16][sender id x8][payload] -> mu-law or Opus decode -> per-player 'cz-play' worklet
//   (~80 ms jitter buffer) -> per-player gain (volume, mute, open-world proximity) -> voice bus -> speakers.
// The microphone is OFF by default; turning it on asks for permission the first time (see App.toggleMic).
const OPUS_ENC = { codec: 'opus', sampleRate: 16000, numberOfChannels: 1, bitrate: 24000, opus: { frameDuration: 20000, application: 'voip' } };
const OPUS_DEC = { codec: 'opus', sampleRate: 16000, numberOfChannels: 1 };

// ---- G.711 mu-law
export function muEncode(f) {
  const out = new Uint8Array(f.length);
  for (let i = 0; i < f.length; i++) {
    let x = Math.max(-1, Math.min(1, f[i])) * 32767 | 0; const sign = x < 0 ? 0x80 : 0; if (x < 0) x = -x;
    x = Math.min(x + 132, 32635); let exp = 7; for (let m = 0x4000; (x & m) === 0 && exp > 0; m >>= 1) exp--;
    out[i] = ~(sign | (exp << 4) | ((x >> (exp + 3)) & 0x0f)) & 0xff;
  }
  return out;
}
const MU_TAB = new Float32Array(256);
for (let i = 0; i < 256; i++) { const u = ~i & 0xff; const exp = (u >> 4) & 7; let s = (((u & 0x0f) << 3) + 132) << exp; s -= 132; MU_TAB[i] = (u & 0x80 ? -s : s) / 32768; }
export function muDecode(u) { const f = new Float32Array(u.length); for (let i = 0; i < u.length; i++) f[i] = MU_TAB[u[i]]; return f; }

export class Voice {
  constructor(net, settings, audio) {
    this.net = net; this.s = settings; this.audio = audio; this.peers = new Map(); this.stream = null; this.track = null;
    this.speaking = new Map(); this.onChange = () => { }; this.enabled = false; this.error = null; this.micErr = null; this.blocked = new Set(); this.prox = new Map();
    this.seq = 0; this.encTs = 0; this.stats = { sent: 0, sentOpus: 0, recv: 0, recvOpus: 0, recvFrom: {} };
    this.opusDecOK = false; this.opusEncOK = false; this.caps = this.checkCaps();
    net.on('vbin', b => this.onFrame(b));
    net.on('room', m => this.sync(m));
    net.on('left', m => this.drop(m.id));
    net.on('away', m => this.drop(m.id));
    net.on('joined', () => { if (this.enabled) this.announce(); });
    setInterval(() => { const t = performance.now(); let ch = false; for (const [id, P] of this.peers) if (this.speaking.get(id) && t - P.last > 320) { this.speaking.set(id, false); ch = true; } if (ch) this.onChange(); }, 150);
  }
  get mode() { return 'open'; }
  async checkCaps() {
    try { if (window.AudioDecoder) this.opusDecOK = !!(await AudioDecoder.isConfigSupported(OPUS_DEC)).supported; } catch (e) { }
    try { if (window.AudioEncoder) { this.encCfg = OPUS_ENC; this.opusEncOK = !!(await AudioEncoder.isConfigSupported(OPUS_ENC)).supported; if (!this.opusEncOK) { const { opus, ...plain } = OPUS_ENC; this.encCfg = plain; this.opusEncOK = !!(await AudioEncoder.isConfigSupported(plain)).supported; } } } catch (e) { this.opusEncOK = false; }
  }
  get wantOpus() { return this.s.voice.codec !== 'mulaw'; } // settings.voice.codec = 'auto' | 'mulaw' (testing / low-CPU fallback)
  async ensureCtx() {
    this.audio.unlock(); const c = this.audio.ctx; if (!c || !c.audioWorklet) throw new Error('Voice needs Web Audio with AudioWorklet, which this browser does not support');
    if (!this.wk) this.wk = c.audioWorklet.addModule(new URL('./voice-worklet.js', import.meta.url));
    await this.wk; if (c.state === 'suspended') c.resume().catch(() => { });
    return c;
  }
  // join voice (listen). Needs no microphone permission.
  async start() {
    if (this.enabled) return true;
    if (!this.s.voice.enabled) return false;
    try { await this.ensureCtx(); } catch (e) { this.error = e.message; this.onChange(); return false; }
    await this.caps; this.enabled = true; this.error = null; this.announce();
    if (!this.s.voice.micMuted) await this.micOn();
    this.onChange(); return true;
  }
  announce() {
    const v = this.s.voice;
    this.net.send({ t: 'voice', listen: this.enabled && !v.muteAll, range: v.range === 'prox' ? 'prox' : 'room', opus: this.opusDecOK && this.wantOpus, mutes: Object.keys(v.muted).filter(k => v.muted[k]) });
  }
  stop() {
    this.micOff(); for (const id of [...this.peers.keys()]) this.drop(id); this.enabled = false;
    this.net.send({ t: 'voice', listen: false }); this.speaking.clear(); this.onChange();
  }
  // ---------------------------------------------------------------- microphone (open mic ON/OFF)
  async micOn() {
    if (this.track) return true; this.cancelMic = false;
    if (!navigator.mediaDevices?.getUserMedia) { this.micErr = 'unsupported'; this.error = 'This browser does not support microphone access'; this.onChange(); return false; }
    let c; try { c = await this.ensureCtx(); } catch (e) { this.micErr = 'unsupported'; this.error = e.message; this.onChange(); return false; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: this.s.voice.micId ? { exact: this.s.voice.micId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); }
    catch (e) { this.micErr = e.name || 'Error'; this.error = e.name === 'NotAllowedError' || e.name === 'SecurityError' ? 'Microphone permission was denied — you can still hear others.' : e.name === 'NotFoundError' ? 'No microphone found on this device' : 'Microphone unavailable (' + e.name + ')'; this.onChange(); return false; }
    if (this.cancelMic) { stream.getTracks().forEach(t => t.stop()); return false; }
    this.stream = stream; this.track = stream.getAudioTracks()[0] || null; this.micErr = null; this.error = null;
    this.src = c.createMediaStreamSource(stream);
    this.micNode = new AudioWorkletNode(c, 'cz-mic', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    this.sink = c.createGain(); this.sink.gain.value = 0; this.src.connect(this.micNode); this.micNode.connect(this.sink); this.sink.connect(c.destination); // keeps the worklet pulled; outputs silence
    this.micNode.port.onmessage = e => this.onMic(e.data); this.micNode.port.postMessage({ on: true });
    if (this.track) this.track.onended = () => { this.micOff(); this.s.voice.micMuted = true; this.error = 'The microphone was disconnected'; this.onChange(); };
    this.startEncoder(); this.onChange(); return true;
  }
  micOff() {
    this.cancelMic = true;
    try { this.micNode?.port.postMessage({ on: false }); this.src?.disconnect(); this.micNode?.disconnect(); this.sink?.disconnect(); } catch (e) { }
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; this.track = null; this.src = this.micNode = this.sink = null;
    try { if (this.enc && this.enc.state !== 'closed') this.enc.close(); } catch (e) { } this.enc = null;
    if (this.speaking.get('me')) { this.speaking.set('me', false); }
  }
  // called after settings.voice.micMuted changed (App.toggleMic handles the first-time permission prompt)
  async applyMic() { if (this.s.voice.micMuted || !this.enabled) this.micOff(); else await this.micOn(); this.onChange(); }
  setPTT() { } // push-to-talk was removed: open mic ON/OFF only
  async setMic(id) { this.s.voice.micId = id; if (!this.track) return; this.micOff(); await this.micOn(); }
  async listMics() { try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); } catch (e) { return []; } }
  startEncoder() {
    this.enc = null; if (!this.opusEncOK || !window.AudioEncoder) return;
    try {
      this.enc = new AudioEncoder({ output: ch => { const u = new Uint8Array(ch.byteLength); ch.copyTo(u); if (this.packet(1, u)) this.stats.sentOpus++; }, error: e => { console.warn('opus encoder', e); this.opusEncOK = false; this.enc = null; } });
      this.enc.configure(this.encCfg || OPUS_ENC);
    } catch (e) { console.warn('opus encoder unavailable', e); this.enc = null; this.opusEncOK = false; }
  }
  onMic(d) {
    if ('speaking' in d) { const on = d.speaking && !!this.track; if (on !== !!this.speaking.get('me')) { this.speaking.set('me', on); this.onChange(); } if (!d.speaking && this.enc?.state === 'configured') this.enc.flush().catch(() => { }); }
    if (!d.f || !this.track || this.s.voice.micMuted) return;
    const room = this.net.room; if (!room) return;
    const others = room.players.filter(p => p.id !== this.net.me && !p.away && p.vl);
    if (!others.length) return; // nobody is listening: send nothing
    const opus = this.enc && this.enc.state === 'configured' && this.wantOpus && others.every(p => p.vo);
    if (opus) {
      try { this.enc.encode(new AudioData({ format: 'f32', sampleRate: 16000, numberOfFrames: d.f.length, numberOfChannels: 1, timestamp: this.encTs, data: d.f })); this.encTs += 20000; return; }
      catch (e) { console.warn('opus encode', e); }
    }
    this.packet(0, muEncode(d.f));
  }
  packet(codec, payload) {
    const b = new Uint8Array(4 + payload.length); b[0] = 1; b[1] = codec; b[2] = this.seq >> 8; b[3] = this.seq & 255; this.seq = (this.seq + 1) & 0xffff; b.set(payload, 4);
    const ok = this.net.sendBin(b.buffer); if (ok) this.stats.sent++; return ok;
  }
  // ---------------------------------------------------------------- receiving
  onFrame(buf) {
    const u = new Uint8Array(buf); if (u.length < 13 || u[0] !== 1) return;
    const codec = u[1]; let id = ''; for (let i = 4; i < 12; i++) id += String.fromCharCode(u[i]); id = id.replace(/_+$/, '');
    const v = this.s.voice;
    if (!this.enabled || this.blocked.has(id) || v.muted[id] || v.muteAll || id === this.net.me) return; // the server already filters these; belt and braces
    const P = this.peer(id); if (!P) return;
    P.last = performance.now(); this.stats.recv++; this.stats.recvFrom[id] = (this.stats.recvFrom[id] || 0) + 1;
    if (!this.speaking.get(id)) { this.speaking.set(id, true); this.onChange(); }
    const payload = u.slice(12);
    if (codec === 0) { const f = muDecode(payload); P.node.port.postMessage({ f, sr: 16000 }, [f.buffer]); return; }
    if (codec === 1 && window.AudioDecoder) {
      this.stats.recvOpus++;
      if (!P.dec) {
        try {
          P.dec = new AudioDecoder({ output: ad => { try { const n = ad.numberOfFrames; const f = new Float32Array(n); try { ad.copyTo(f, { planeIndex: 0, format: 'f32-planar' }); } catch (e) { ad.copyTo(f, { planeIndex: 0 }); } P.node.port.postMessage({ f, sr: ad.sampleRate }, [f.buffer]); } finally { ad.close(); } }, error: e => { console.warn('opus decoder', e); P.dec = null; } });
          P.dec.configure(OPUS_DEC); P.ts = 0;
        } catch (e) { P.dec = null; return; }
      }
      try { P.dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: P.ts, data: payload })); P.ts += 20000; } catch (e) { }
    }
  }
  peer(id) {
    let P = this.peers.get(id); if (P) return P;
    const c = this.audio.ctx; if (!c || !this.audio.bus) return null;
    try {
      const node = new AudioWorkletNode(c, 'cz-play', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      const gain = c.createGain(); node.connect(gain); gain.connect(this.audio.bus.voice);
      P = { id, node, gain, dec: null, last: 0, state: 'connected' }; this.peers.set(id, P); this.applyVol(id); return P;
    } catch (e) { console.warn('voice playback', e); return null; }
  }
  sync(room) { if (!room) return; const ids = new Set(room.players.filter(p => !p.away).map(p => p.id)); for (const id of [...this.peers.keys()]) if (!ids.has(id)) this.drop(id); }
  drop(id) {
    const P = this.peers.get(id); if (!P) return;
    try { P.node.disconnect(); P.gain.disconnect(); if (P.dec && P.dec.state !== 'closed') P.dec.close(); } catch (e) { }
    this.peers.delete(id); this.speaking.delete(id); this.onChange();
  }
  // per-player gain = player volume × open-world proximity (voice volume and master are applied on the voice bus)
  volOf(id) { const v = this.s.voice; if (v.muted[id] || v.muteAll || this.blocked.has(id)) return 0; return Math.max(0, Math.min(1, (v.playerVol[id] ?? 1) * (v.range === 'prox' ? (this.prox.get(id) ?? 1) : 1))); }
  applyVol(id) { const P = this.peers.get(id); if (!P) return; const g = this.volOf(id); P.gain.gain.setTargetAtTime(g, this.audio.ctx.currentTime, 0.05); P.vol = g; }
  applyAll() { for (const id of this.peers.keys()) this.applyVol(id); if (this.enabled) this.announce(); }
  mute(id, v) { this.s.voice.muted[id] = v; this.applyVol(id); this.net.send({ t: 'vmute', id, v: !!v }); if (v) this.speaking.set(id, false); this.onChange(); }
  block(id) { this.blocked.add(id); this.net.send({ t: 'block', id }); this.drop(id); this.onChange(); }
  // status line for a player in the lists
  status(p) { if (this.blocked.has(p.id)) return 'blocked'; if (this.s.voice.muted[p.id]) return 'muted'; if (this.speaking.get(p.id)) return 'speaking'; return p.vl ? 'in voice' : 'not in voice'; }
  // microphone preview: loops mic to speakers briefly
  async preview(sec = 4) {
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: this.s.voice.micId ? { exact: this.s.voice.micId } : undefined, echoCancellation: true } }); this.s.voice.micAsked = true; const src = this.audio.ctx.createMediaStreamSource(s); const d = this.audio.ctx.createDelay(); d.delayTime.value = 0.25; src.connect(d); d.connect(this.audio.bus.voice); setTimeout(() => { src.disconnect(); d.disconnect(); s.getTracks().forEach(t => t.stop()); }, sec * 1000); return true; }
    catch (e) { return false; }
  }
}
