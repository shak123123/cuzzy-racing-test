import * as THREE from 'three';

// One player-only instrument texture, refreshed at 10 Hz, not on every render.
export class CockpitInstruments {
  constructor(body, eye, hasWheel, photo) {
    const photoCar = photo; this.photo = true; // screen overlay for every car: a 3D panel could sit behind the real dashboard
    photo = true;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512; this.canvas.height = 256;
    this.ctx = this.canvas.getContext('2d');
    this.group = new THREE.Group();
    this.group.position.copy(eye);
    body.add(this.group);
    this.canvas.style.cssText = 'position:fixed;left:50%;bottom:4%;transform:translateX(-50%);width:min(34vw,330px);height:auto;pointer-events:none;z-index:2;border-radius:10px;opacity:.92';
    document.body.append(this.canvas);
    if (!photoCar && !hasWheel) {
      {
        this.wheel = new THREE.Group();
        this.wheel.position.set(0, -0.36, -0.38);
        this.wheel.rotation.x = -0.25;
        this.group.add(this.wheel);
        const leather = new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.8 });
        this.wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.165, 0.019, 8, 40), leather));
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.035, 20), leather);
        hub.rotation.x = Math.PI / 2; this.wheel.add(hub);
        for (const a of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
          const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.13, 0.016), leather);
          spoke.position.set(Math.sin(a) * 0.085, Math.cos(a) * 0.085, 0);
          spoke.rotation.z = -a; this.wheel.add(spoke);
        }
      }
    }
    this.elapsed = 1;
  }
  update(S, dt, visible, redline = 8000, gearLabel) {
    this.group.visible = visible;
    if (this.photo) this.canvas.style.display = visible ? 'block' : 'none';
    if (!visible) return;
    if (this.wheel) this.wheel.rotation.z = -(S.steer || 0) * 2.4;
    this.elapsed += dt;
    const rpm = Math.max(0, S.rpm || 0), mph = Math.abs(S.vx || 0) * 2.236936;
    // needles follow the real values with a short lag (like a damped gauge), redrawn at ~30 Hz
    const k = 1 - Math.exp(-dt * 14); this.nR = (this.nR ?? rpm) + (rpm - (this.nR ?? rpm)) * k; this.nS = (this.nS ?? mph) + (mph - (this.nS ?? mph)) * k;
    if (this.elapsed < 0.033) return;
    this.elapsed = 0;
    const gear = String(gearLabel ?? (S.reverse || S.gear < 0 ? 'R' : S.gear === 0 ? 'N' : S.gear));
    const speed = Math.round(mph); this.last = { speed, rpm: Math.round(rpm), gear };
    const c = this.canvas; if (c.height !== 256) { c.height = 256; }
    const g = this.ctx, W = 512, H = 256; g.clearRect(0, 0, W, H);
    const top = Math.max(100, Math.ceil(((this.top || 160) * 1.08) / 20) * 20), rmax = Math.ceil((redline + 1000) / 1000) * 1000;
    const A0 = Math.PI * 0.75, SW = Math.PI * 1.5;
    const dial = (cx, cy, r, max, step, minor, val, red, label, fmt) => {
      g.save(); g.translate(cx, cy);
      const bg = g.createRadialGradient(0, -r * 0.3, r * 0.1, 0, 0, r); bg.addColorStop(0, '#1b2128'); bg.addColorStop(1, '#07090c');
      g.fillStyle = bg; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
      g.lineWidth = 4; g.strokeStyle = '#3a444e'; g.stroke();
      if (red != null) { g.strokeStyle = '#e8402a'; g.lineWidth = 7; g.beginPath(); g.arc(0, 0, r - 9, A0 + SW * red / max, A0 + SW); g.stroke(); }
      for (let v = 0; v <= max + 1e-6; v += minor) { const a = A0 + SW * v / max, maj = Math.abs(v / step - Math.round(v / step)) < 1e-6;
        g.strokeStyle = red != null && v >= red ? '#ff7a66' : '#cfd8de'; g.lineWidth = maj ? 3 : 1.5; const r1 = r - (maj ? 20 : 14);
        g.beginPath(); g.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); g.lineTo(Math.cos(a) * (r - 6), Math.sin(a) * (r - 6)); g.stroke();
        if (maj) { g.fillStyle = '#e9eef1'; g.font = '600 14px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(fmt(v), Math.cos(a) * (r - 32), Math.sin(a) * (r - 32)); } }
      g.fillStyle = '#8f9ca6'; g.font = '13px Arial'; g.textAlign = 'center'; g.fillText(label, 0, r * 0.42);
      const a = A0 + SW * Math.min(1.02, Math.max(0, val / max)); g.rotate(a);
      g.strokeStyle = '#ff4b2b'; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.moveTo(-14, 0); g.lineTo(r - 16, 0); g.stroke();
      g.fillStyle = '#2a3138'; g.beginPath(); g.arc(0, 0, 10, 0, Math.PI * 2); g.fill(); g.restore(); };
    dial(110, 128, 106, rmax, 1000, 500, this.nR, redline, 'RPM x1000', v => String(v / 1000));
    const st = top > 200 ? 40 : 20; dial(402, 128, 106, top, st, st / 2, this.nS, null, 'MPH', v => String(v));
    // centre pod: digital speed + gear (gear lamp flashes red at the limiter)
    g.fillStyle = 'rgba(6,8,10,.92)'; g.strokeStyle = '#3a444e'; g.lineWidth = 2; g.beginPath(); g.roundRect ? g.roundRect(220, 150, 72, 96, 12) : g.rect(220, 150, 72, 96); g.fill(); g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillStyle = rpm >= redline * 0.97 && (performance.now() % 240) < 120 ? '#ff5a3c' : '#f2f5f6'; g.font = '700 46px Arial'; g.fillText(gear, 256, 200);
    g.fillStyle = '#e5edf0'; g.font = '600 24px Arial'; g.fillText(String(speed), 256, 234);
    if (this.texture) this.texture.needsUpdate = true;
  }
  dispose() {
    this.group.removeFromParent();
    const materials = new Set();
    this.group.traverse(o => { o.geometry?.dispose(); if (o.material) materials.add(o.material); });
    for (const m of materials) m.dispose();
    this.texture?.dispose();
    this.canvas.remove();
  }
}
