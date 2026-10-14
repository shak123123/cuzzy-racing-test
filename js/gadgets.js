// Bond Special gadgets: front machine guns (tracers, muzzle flash, they knock AI cars off line), rear smoke screen,
// oil slick (AI cars that cross it spin), and a rear bulletproof shield.
import * as THREE from 'three';
let AC = null; const ac = () => (AC ||= new (window.AudioContext || window.webkitAudioContext)());
function bang() { try { const a = ac(), n = a.sampleRate * 0.07, b = a.createBuffer(1, n, a.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
  const s = a.createBufferSource(), gn = a.createGain(), lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400; gn.gain.value = 0.5; s.buffer = b; s.connect(lp).connect(gn).connect(a.destination); s.start(); } catch (e) {} }
const radTex = (inner, outer) => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, inner); r.addColorStop(1, outer); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); };
export class Gadgets {
  constructor(sess) { this.s = sess; this.fx = []; this.slicks = []; this.gunT = 0; this.smokeT = 0; this.oilT = 0; this.shield = false; this.shK = 0; this.cd = 0; this.sm = 0; }
  init() { const o = this.s.obj; if (this.bb || !o?.parent) return !!this.bb; this.world = o.parent; o.updateMatrixWorld(true);
    const [L, Wd, Ht] = this.s.car.dims; this.bb = new THREE.Box3(new THREE.Vector3(-Wd / 2, 0, -L / 2), new THREE.Vector3(Wd / 2, Ht, L / 2)); const b = this.bb, metal = new THREE.MeshStandardMaterial({ color: 0x222226, metalness: 0.9, roughness: 0.3 });
    this.guns = [-1, 1].map(sx => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.3, 10), metal); m.rotation.x = Math.PI / 2; m.position.set(sx * (b.max.x - 0.32), b.min.y + 0.42, b.min.z + 0.12); m.userData.z0 = m.position.z; o.add(m); return m; });
    this.flashMat = new THREE.SpriteMaterial({ map: radTex('rgba(255,250,200,1)', 'rgba(255,140,0,0)'), blending: THREE.AdditiveBlending, depthWrite: false });
    this.flashes = this.guns.map(gn => { const f = new THREE.Sprite(this.flashMat); f.scale.setScalar(0.35); f.visible = false; o.add(f); f.position.set(gn.position.x, gn.position.y, b.min.z - 0.2); return f; });
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.smokeMat = new THREE.SpriteMaterial({ map: radTex('rgba(200,200,200,0.85)', 'rgba(170,170,170,0)'), depthWrite: false });
    { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 4, 64, 64, 62); // oil: black pool with a rainbow sheen ring so it reads on dark tarmac
      r.addColorStop(0, 'rgba(8,8,10,1)'); r.addColorStop(0.55, 'rgba(20,10,40,1)'); r.addColorStop(0.7, 'rgba(40,120,90,0.95)'); r.addColorStop(0.8, 'rgba(160,60,160,0.9)'); r.addColorStop(0.9, 'rgba(200,160,40,0.7)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; this.oilMat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }); }
    const sh = this.sh = new THREE.Mesh(new THREE.BoxGeometry((b.max.x - b.min.x) * 0.62, 0.36, 0.02), new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.95, roughness: 0.25 }));
    sh.position.set(0, b.max.y - 0.55, b.max.z - 1.15); sh.userData.y0 = sh.position.y; sh.rotation.x = 0.35; sh.visible = false; o.add(sh); return true; }
  wp(x, y, z) { return this.s.obj.localToWorld(new THREE.Vector3(x, y, z)); }
  fire() { this.gunT = 1.8; } smoke() { this.smokeOn = !this.smokeOn; return this.smokeOn; } oil() { this.oilOn = !this.oilOn; return this.oilOn; } toggleShield() { this.shield = !this.shield; return this.shield; }
  step(dt) { if (!this.init()) return; const o = this.s.obj, b = this.bb, W = this.world, S = this.s.S, ai = this.s.ai?.cars || [];
    // guns pop out of the front, fire in bursts
    const gk = this.gunT > 0 ? 1 : 0; for (const g of this.guns) g.position.z += ((g.userData.z0 - 0.18 * gk) - g.position.z) * Math.min(1, dt * 10);
    if (this.gunT > 0) { this.gunT -= dt; this.cd -= dt; this.flashes.forEach(f => { f.visible = Math.random() < 0.6; f.scale.setScalar(0.25 + Math.random() * 0.25); });
      if (this.cd <= 0) { this.cd = 0.07; bang(); const fw = new THREE.Vector3(0, 0, -1).applyQuaternion(o.getWorldQuaternion(new THREE.Quaternion()));
        for (const g of this.guns) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 2.2), this.tracerMat); m.position.copy(this.wp(g.position.x, g.position.y, b.min.z - 1.2)); m.quaternion.copy(o.getWorldQuaternion(new THREE.Quaternion())); m.userData = { v: fw.clone().multiplyScalar(260 + Math.abs(S.vx)), life: 0.35 }; W.add(m); this.fx.push(m); }
        for (const A of ai) { const p = A.S; if (!p) continue; const dx = p.x - S.x, dz = p.z - S.z, d = dx * fw.x + dz * fw.z, lat = Math.abs(dx * fw.z - dz * fw.x); if (d > 2 && d < 70 && lat < 2.4) { p.vx *= 0.9; p.yaw += (Math.random() - 0.5) * 0.08; } } } }
    else this.flashes.forEach(f => (f.visible = false));
    // smoke screen
    if (this.smokeOn) { this.sm -= dt; if (this.sm <= 0) { this.sm = 0.04; for (const sx of [-0.4, 0.4]) { const sp = new THREE.Sprite(this.smokeMat.clone()); sp.position.copy(this.wp(sx, b.min.y + 0.35, b.max.z + 0.3)); sp.scale.setScalar(0.8); sp.userData = { life: 4, max: 4, smoke: 1, dr: (Math.random() - 0.5) * 0.8 }; W.add(sp); this.fx.push(sp); } } }
    // oil slick
    if (this.oilOn) { this.om = (this.om || 0) - dt; if (this.om <= 0 && this.slicks.length < 60) { this.om = 0.12; const m = new THREE.Mesh(new THREE.CircleGeometry(0.9 + Math.random() * 0.6, 20), this.oilMat); m.rotation.x = -Math.PI / 2; const p = this.wp(0, 0, b.max.z + 0.6); const wv = this.s.obj.userData.wheels?.[2]?.pivot.getWorldPosition(new THREE.Vector3()); m.position.set(p.x, (wv ? wv.y - 0.33 : (o.position.y || 0)) + 0.03, p.z); m.rotation.z = Math.random() * 6; W.add(m); this.slicks.push({ m, t: 30 }); } }
    for (let i = this.slicks.length - 1; i >= 0; i--) { const s = this.slicks[i]; s.t -= dt; for (const A of ai) { const p = A.S; if (p && Math.hypot(p.x - s.m.position.x, p.z - s.m.position.z) < 1.4) { p.yaw += (Math.random() < 0.5 ? -1 : 1) * 1.6 * dt * 3; p.vx *= 0.985; } }
      if (s.t <= 0) { W.remove(s.m); s.m.geometry.dispose(); this.slicks.splice(i, 1); } }
    // bulletproof shield rises behind the rear window
    this.shK += ((this.shield ? 1 : 0) - this.shK) * Math.min(1, dt * 5); this.sh.visible = this.shK > 0.02; this.sh.position.y = this.sh.userData.y0 + 0.42 * this.shK;
    for (let i = this.fx.length - 1; i >= 0; i--) { const m = this.fx[i], u = m.userData; u.life -= dt;
      if (u.v) m.position.addScaledVector(u.v, dt); else if (u.smoke) { const k = u.life / u.max; m.scale.setScalar(0.8 + (1 - k) * 5); m.position.y += dt * 0.5; m.position.x += u.dr * dt; m.material.opacity = 0.85 * k; }
      if (u.life <= 0) { W.remove(m); if (u.smoke) m.material.dispose(); else m.geometry.dispose(); this.fx.splice(i, 1); } } }
  dispose() { for (const m of this.fx) this.world?.remove(m); for (const s of this.slicks) this.world?.remove(s.m); this.fx = []; this.slicks = []; }
}
