// DB5 interior (cockpit view): black leather buckets, crackle-black dash with Smiths-style dials that work, wood-rim
// three-spoke wheel, centre console with the Q-branch gadget switches, chrome gear lever. Built around the driver's eye.
import * as THREE from 'three';
export class DB5Interior {
  constructor(obj, car) { let n = null; obj.traverse(o => { if (!n && o.userData.cockpit) n = o; }); this.ok = !!n; if (!n) return; const e = n.userData.cockpit, W = car.dims[1];
    const G = this.G = new THREE.Group(); n.add(G); this.e = e; this.W = W; const L = (c, r = 0.6, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
    const leather = L(0x15100e, 0.55), trim = L(0x0c0c0c, 0.8), chrome = L(0xdddddd, 0.15, 1), wood = L(0x5a2f14, 0.35), carpet = L(0x1a1513, 1);
    const box = (w, h, d, m, x, y, z, rx = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.x = rx; G.add(b); return b; };
    const dx = e.x, px = -e.x; // driver side / passenger side
    for (const x of [dx, px]) { box(0.48, 0.12, 0.5, leather, x, e.y - 0.78, e.z + 0.12); box(0.46, 0.62, 0.1, leather, x, e.y - 0.42, e.z + 0.42, -0.22); // seat squab + back
      for (let i = -2; i <= 2; i++) box(0.012, 0.58, 0.012, trim, x + i * 0.08, e.y - 0.42, e.z + 0.365, -0.22); } // pleat lines
    box(W - 0.12, 0.05, 1.6, carpet, 0, e.y - 0.86, e.z - 0.2); box(0.26, 0.2, 1.1, carpet, 0, e.y - 0.76, e.z - 0.25); // floor + transmission tunnel
    const dash = box(W - 0.08, 0.24, 0.34, trim, 0, e.y - 0.33, e.z - 0.66); // dash body
    box(W - 0.06, 0.03, 0.4, L(0x0a0a0a, 0.5), 0, e.y - 0.2, e.z - 0.7); // top roll
    // instrument face drawn on a canvas, laid on the driver-facing side of the dash
    const cv = this.cv = document.createElement('canvas'); cv.width = 1024; cv.height = 240; this.g = cv.getContext('2d'); this.tex = new THREE.CanvasTexture(cv); this.tex.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.1, 0.22), new THREE.MeshStandardMaterial({ map: this.tex, roughness: 0.5, emissive: 0xffffff, emissiveMap: this.tex, emissiveIntensity: 0.35 }));
    face.position.set(0, e.y - 0.33, e.z - 0.488); face.rotation.x = -0.12; G.add(face); this.fw = W - 0.1;
    // centre console with gadget switches
    box(0.24, 0.3, 0.3, trim, 0, e.y - 0.6, e.z - 0.5, 0.35); const sw = new THREE.MeshStandardMaterial({ color: 0xc81010, emissive: 0x500000, roughness: 0.4 });
    for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 12), i % 2 ? sw : chrome); b.rotation.x = Math.PI / 2 + 0.35; b.position.set(-0.07 + (i % 3) * 0.07, e.y - 0.52 - Math.floor(i / 3) * 0.06, e.z - 0.34 + Math.floor(i / 3) * 0.02); G.add(b); }
    const gl = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.26, 10), chrome); gl.position.set(0, e.y - 0.6, e.z - 0.12); gl.rotation.x = -0.25; G.add(gl);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.025, 14, 10), wood); knob.position.set(0, e.y - 0.47, e.z - 0.15); G.add(knob);
    // wood-rim three-spoke steering wheel
    const wh = this.wheel = new THREE.Group(); wh.position.set(dx, e.y - 0.27, e.z - 0.4); wh.rotation.x = -0.35; G.add(wh);
    wh.add(new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.014, 10, 40), wood)); for (const a of [0, 2.2, 4.08]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.012, 0.004), chrome); s.geometry.translate(0.085, 0, 0); s.rotation.z = a - Math.PI / 2; wh.add(s); }
    wh.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 16).rotateX(Math.PI / 2), trim));
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.3, 10), trim); col.position.set(dx, e.y - 0.33, e.z - 0.55); col.rotation.x = Math.PI / 2 - 0.35; G.add(col);
    this.t = 1; this.dxu = (dx + (W - 0.1) / 2) / (W - 0.1); }
  dial(g, x, y, r, f, label, big) { g.fillStyle = '#0b0b0b'; g.beginPath(); g.arc(x, y, r + 6, 0, 7); g.fill(); g.strokeStyle = '#cfcfcf'; g.lineWidth = 4; g.beginPath(); g.arc(x, y, r + 3, 0, 7); g.stroke();
    g.fillStyle = '#101010'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25; g.strokeStyle = '#eee'; g.lineWidth = 2;
    for (let i = 0; i <= (big ? 16 : 4); i++) { const a = a0 + (a1 - a0) * i / (big ? 16 : 4); g.beginPath(); g.moveTo(x + Math.cos(a) * r * 0.82, y + Math.sin(a) * r * 0.82); g.lineTo(x + Math.cos(a) * r * 0.95, y + Math.sin(a) * r * 0.95); g.stroke(); }
    g.fillStyle = '#ddd'; g.font = `${big ? 15 : 10}px Arial`; g.textAlign = 'center'; g.fillText(label, x, y + r * 0.5);
    const a = a0 + (a1 - a0) * Math.max(0, Math.min(1, f)); g.strokeStyle = '#ffffff'; g.lineWidth = big ? 4 : 2.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85); g.stroke();
    g.fillStyle = '#888'; g.beginPath(); g.arc(x, y, big ? 7 : 4, 0, 7); g.fill(); }
  step(dt, S, P, inCockpit, steer) { if (!this.ok) return; this.G.visible = inCockpit; if (!inCockpit) return; this.wheel.rotation.z = -(steer || 0) * 2.4; this.t += dt; if (this.t < 1 / 15) return; this.t = 0;
    const g = this.g, Wc = 1024, H = 240, mph = Math.abs(S.vx || 0) * 2.237, f = (S.rpm || 0) / 6000, cx = this.dxu * Wc;
    g.fillStyle = '#121212'; g.fillRect(0, 0, Wc, H); for (let i = 0; i < 700; i++) { g.fillStyle = Math.random() < 0.5 ? '#181818' : '#0d0d0d'; g.fillRect(Math.random() * Wc, Math.random() * H, 2, 2); } // crackle finish
    g.fillStyle = '#1c1c1c'; g.fillRect(cx - 230, 6, 460, H - 12);
    this.dial(g, cx - 105, H / 2, 92, mph / 160, 'MPH', true); this.dial(g, cx + 105, H / 2, 92, f, 'RPM x100', true);
    // centre minor gauges: fuel, oil pressure, water temp, ammeter, oil temp
    const mx = Wc / 2 + (cx > Wc / 2 ? -150 : 150); [[0.8, 'FUEL'], [0.35 + f * 0.4, 'OIL'], [0.55, 'WATER'], [0.5 + (S.rpm > 900 ? 0.15 : 0), 'AMPS'], [0.6, 'OIL °C']].forEach(([v, l], i) => this.dial(g, mx - 120 + i * 60, H / 2 + (i % 2 ? 30 : -30), 26, v, l));
    // radar tracker screen in the centre of the dash
    const rx = Wc / 2, ry = H / 2; g.fillStyle = '#031a08'; g.fillRect(rx - 40, ry - 34, 80, 68); g.strokeStyle = '#2f8'; g.lineWidth = 1; g.strokeRect(rx - 40, ry - 34, 80, 68);
    const ph = (performance.now() / 600) % 6.283; g.beginPath(); g.moveTo(rx, ry); g.lineTo(rx + Math.cos(ph) * 34, ry + Math.sin(ph) * 30); g.stroke(); g.fillStyle = '#5f8'; g.fillRect(rx + 12, ry - 8, 4, 4);
    this.tex.needsUpdate = true; }
  dispose() { this.G?.parent?.remove(this.G); }
}
