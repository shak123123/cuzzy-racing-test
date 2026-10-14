// AudioWorklet processors for server-relayed voice chat (see voice.js).
//  cz-mic:  microphone -> 16 kHz mono (box-filter decimation) -> voice-activity gate -> 20 ms frames (320 samples)
//           posted to the main thread only while the gate is open (silence is never sent).
//  cz-play: one per remote player: jitter buffer (starts playing once ~80 ms is queued, trims back when more than
//           ~250 ms builds up) and linear-interpolation resampling from the frame's rate to the context rate.
const FRAME = 320; // 20 ms at 16 kHz

class CzMic extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000; this.acc = 0; this.sum = 0; this.n = 0;
    this.frame = new Float32Array(FRAME); this.fi = 0; this.prev = null;
    this.on = false; this.open = false; this.hang = 0; this.noise = 0.004; this.minLvl = 0.012; this.hangFrames = 15; // 300 ms hangover
    this.port.onmessage = e => { const d = e.data || {}; if ('on' in d) { this.on = !!d.on; if (!this.on && this.open) { this.open = false; this.port.postMessage({ speaking: false }); } } if (d.minLvl) this.minLvl = d.minLvl; };
  }
  frameDone() {
    const f = this.frame; let s = 0; for (let i = 0; i < FRAME; i++) s += f[i] * f[i];
    const rms = Math.sqrt(s / FRAME);
    // adaptive noise floor: follows quiet frames down quickly, rises slowly
    this.noise = rms < this.noise ? this.noise * 0.9 + rms * 0.1 : Math.min(0.05, this.noise * 1.003);
    const thr = Math.max(this.minLvl, this.noise * 3);
    const loud = this.on && rms > thr;
    if (loud) this.hang = this.hangFrames; else if (this.hang > 0) this.hang--;
    const nowOpen = this.on && (loud || this.hang > 0);
    if (nowOpen && !this.open) { this.open = true; this.port.postMessage({ speaking: true }); if (this.prev) this.port.postMessage({ f: this.prev, lvl: 0 }, [this.prev.buffer]); } // one frame of pre-roll
    if (!nowOpen && this.open) { this.open = false; this.port.postMessage({ speaking: false }); }
    const copy = f.slice(0);
    if (this.open) this.port.postMessage({ f: copy, lvl: rms }, [copy.buffer]); else this.prev = copy;
    if (this.open) this.prev = null;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]; if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.sum += ch[i]; this.n++; this.acc += 1;
      if (this.acc >= this.ratio) { this.acc -= this.ratio; this.frame[this.fi++] = this.sum / this.n; this.sum = 0; this.n = 0; if (this.fi === FRAME) { this.frameDone(); this.fi = 0; } }
    }
    return true;
  }
}

class CzPlay extends AudioWorkletProcessor {
  constructor() {
    super();
    this.q = []; this.buf = 0; this.playing = false; this.pos = 0; this.target = 0.08; this.max = 0.25; this.under = 0;
    this.port.onmessage = e => {
      const d = e.data; if (!d || !d.f) return; const fr = { d: d.f, step: (d.sr || 16000) / sampleRate, dur: d.f.length / (d.sr || 16000) };
      this.q.push(fr); this.buf += fr.dur;
      if (this.buf > this.max) { while (this.q.length > 1 && this.buf > this.target) { this.buf -= this.q.shift().dur; } this.pos = 0; } // too much latency built up: skip ahead
    };
  }
  process(_, outputs) {
    const out = outputs[0][0]; if (!out) return true;
    if (!this.playing) { if (this.buf >= this.target) this.playing = true; else { out.fill(0); return true; } }
    for (let i = 0; i < out.length; i++) {
      const f = this.q[0]; if (!f) { this.playing = false; out.fill(0, i); this.buf = 0; break; }
      const k = this.pos | 0, fr = this.pos - k, a = f.d[k], b = k + 1 < f.d.length ? f.d[k + 1] : (this.q[1] ? this.q[1].d[0] : a);
      out[i] = a + (b - a) * fr; this.pos += f.step;
      if (this.pos >= f.d.length) { this.pos -= f.d.length; this.q.shift(); this.buf -= f.dur; }
    }
    return true;
  }
}

registerProcessor('cz-mic', CzMic);
registerProcessor('cz-play', CzPlay);
