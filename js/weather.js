// p55 weather effects on top of daynight-weather.js + Gfx (which already has the sky, fog, rain streaks in heavy rain
// and screen-space wet-road reflections): Settings > World (Auto / manual weather, Auto / preset / slider time, rain
// effects quality), drizzle streaks, ground splashes, puddles round the camera that mirror lamps / signs / cars (glossy
// patches picked up by the env map and Gfx's wet-road SSR), tyre spray, rain on the windscreen in the cockpit view
// with the wipers clearing it (hero car's WIPE button, else automatic), thunder after lightning, and a wet factor
// (session.wetK) that NPCs use for umbrellas / hoods. Everything is pooled around the camera; counts follow the tier.
import * as THREE from 'three';
const MOB = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const TOD = { dawn: 0.27, day: 0.55, dusk: 0.76, night: 0.95 };
export class WeatherFX {
  constructor(sess) { this.s = sess; this.g = new THREE.Group(); this.g.name = 'weather-fx'; sess.scene.add(this.g); this.k = { streak: 0, splash: 0, puddle: 0 }; this.t = 0; this.build(); }
  tier() { const w = this.s.app.settings.world || {}, p = this.s.app.settings.graphics?.preset; let q = w.rainFx && w.rainFx !== 'auto' ? w.rainFx : ({ low: 'low', medium: 'medium', high: 'high', ultra: 'high' }[p] || (MOB ? 'medium' : 'high')); if (MOB && q === 'high' && w.rainFx === 'auto') q = 'medium'; return q; }
  build() { const q = this.tier(), N = { low: [600, 40, 12], medium: [1500, 90, 26], high: [3000, 160, 44] }[q] || [1500, 90, 26]; this.q = q; this.g.clear();
    // streaks (drizzle / light rain; Gfx draws its own in heavy rain)
    const sp = new Float32Array(N[0] * 6); for (let i = 0; i < N[0]; i++) { const x = (Math.random() - 0.5) * 60, y = Math.random() * 30, z = (Math.random() - 0.5) * 60; sp.set([x, y, z, x + 0.05, y - 0.6, z], i * 6); }
    this.streak = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(sp, 3)), new THREE.LineBasicMaterial({ color: 0xb8c4d0, transparent: true, opacity: 0, depthWrite: false })); this.streak.frustumCulled = false; this.g.add(this.streak); this.sp0 = sp.slice();
    // splashes: tiny expanding rings on the ground near the camera
    this.spl = new THREE.InstancedMesh(new THREE.RingGeometry(0.03, 0.06, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xdfe8f0, transparent: true, opacity: 0, depthWrite: false }), N[1]); this.spl.frustumCulled = false; this.g.add(this.spl); this.splD = Array.from({ length: N[1] }, () => ({ x: 0, z: 0, t: Math.random() }));
    // puddles: glossy dark patches on the carriageway near the camera
    const pt = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); for (let i = 0; i < 6; i++) { const gr = x.createRadialGradient(64 + (Math.random() - 0.5) * 40, 64 + (Math.random() - 0.5) * 30, 0, 64, 64, 40 + Math.random() * 20); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.7, 'rgba(255,255,255,.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); } return new THREE.CanvasTexture(c); })();
    this.pud = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.03, metalness: 0.85, alphaMap: pt, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -9, polygonOffsetUnits: -18, envMapIntensity: 1.6 }), N[2]); this.pud.frustumCulled = false; this.g.add(this.pud); this.pudD = []; this.pudT = 0;
    // tyre spray (player car)
    const st = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(220,226,232,.7)'); gr.addColorStop(1, 'rgba(220,226,232,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
    this.spray = Array.from({ length: q === 'low' ? 10 : 24 }, () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: st, transparent: true, depthWrite: false, opacity: 0 })); this.g.add(s); return { s, t: 9, vx: 0, vz: 0 }; }); }
  // Settings > World -> the Environment
  settings(E) { const w = this.s.app.settings.world || {}; const key = w.weather + '|' + w.time + '|' + w.hour; if (key === this.key) return; this.key = key;
    E.weatherLock = !!w.weather && w.weather !== 'auto'; if (E.weatherLock) { E.setWeather(w.weather, false); E.wTimer = 1e9; } else E.wTimer = Math.min(E.wTimer, 120);
    E.timeLock = !!w.time && w.time !== 'auto'; if (E.timeLock) E.setTime(w.time === 'manual' ? (+w.hour || 0) / 24 : TOD[w.time] ?? 0.55); }
  step(dt, E) { if (!E) return; this.settings(E); if (this.tier() !== this.q) this.build(); this.t += dt; const o = E.out, cam = this.s.g.cam, W = this.s.w, cp = cam.position, rain = o.rain || 0, wet = Math.max(o.wet || 0, this.s.wet || 0);
    this.s.wetK = Math.max(rain, wet * 0.5);
    // drizzle streaks follow the camera (heavier rain: Gfx's own rain takes over, so these fade)
    const sk = rain > 0.02 ? Math.min(1, rain / 0.3) * (rain > 0.45 ? 0.5 : 1) : 0; this.streak.material.opacity = sk * 0.45; this.streak.visible = sk > 0.01;
    if (this.streak.visible) { this.streak.position.set(cp.x, cp.y - 12, cp.z); const a = this.streak.geometry.attributes.position, A = a.array, fall = dt * (rain > 0.4 ? 22 : 9); for (let i = 0; i < A.length; i += 6) { A[i + 1] -= fall; A[i + 4] -= fall; if (A[i + 4] < 0) { A[i + 1] += 30; A[i + 4] += 30; } } a.needsUpdate = true; }
    // splashes
    const m = this._m || (this._m = new THREE.Matrix4()); const gy = this.s.foot?.active ? this.s.foot.p.y : this.s.S?.y ?? 0;
    this.spl.material.opacity = Math.min(0.7, rain * 1.2); this.spl.visible = rain > 0.05;
    if (this.spl.visible) this.splD.forEach((d, i) => { d.t += dt * (1.5 + rain * 3); if (d.t > 1) { d.t = 0; d.x = cp.x + (Math.random() - 0.5) * 24; d.z = cp.z + (Math.random() - 0.5) * 24; d.y = W.groundAt?.(d.x, d.z, gy)?.h ?? gy; } const s = 0.4 + d.t * 3; m.makeScale(s, 1, s).setPosition(d.x, (d.y ?? gy) + 0.04, d.z); this.spl.setMatrixAt(i, m); }); this.spl.instanceMatrix.needsUpdate = true;
    // puddles: re-seeded on the nearest roads every couple of seconds, fading in with wetness
    this.pud.material.opacity = Math.min(0.92, wet * 1.1); this.pud.visible = wet > 0.08; this.pudT -= dt;
    if (this.pud.visible && this.pudT <= 0) { this.pudT = 2; let n = 0; for (let i = 0; i < this.pud.count; i++) { const ax = cp.x + (Math.random() - 0.5) * 70, az = cp.z + (Math.random() - 0.5) * 70, r = W.nearestRoad?.(ax, az); if (!r || r.d > 30) { m.makeScale(0, 0, 0); this.pud.setMatrixAt(i, m); continue; } const off = (Math.random() - 0.5) * r.hw * 1.6, x = r.px + r.nx * off, z = r.pz + r.nz * off, y = (r.h ?? W.groundAt?.(x, z, gy)?.h ?? gy) + 0.05, s = 1.2 + Math.random() * 3; m.makeRotationY(Math.random() * 6).scale(new THREE.Vector3(s, 1, s * (0.5 + Math.random() * 0.5))).setPosition(x, y, z); this.pud.setMatrixAt(i, m); n++; } this.pud.instanceMatrix.needsUpdate = true; }
    // tyre spray from the player's car
    const S = this.s.S, car = this.s.obj, v = Math.abs(S?.vx || 0), spray = wet > 0.25 && v > 6 && !this.s.foot?.active;
    for (const P of this.spray) { P.t += dt; if (spray && P.t > 0.5 && Math.random() < dt * 30) { const yaw = S.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw), sd = Math.random() < 0.5 ? -1 : 1, rx = Math.cos(yaw), rz = -Math.sin(yaw); P.t = 0; P.s.position.set(car.position.x - fx * 1.6 + rx * sd * 0.8, car.position.y + 0.3, car.position.z - fz * 1.6 + rz * sd * 0.8); P.vx = -fx * v * 0.25; P.vz = -fz * v * 0.25; }
      const k = P.t / 0.5; P.s.material.opacity = k < 1 ? 0.5 * (1 - k) * Math.min(1, wet) : 0; P.s.scale.setScalar(0.5 + k * 2.5); P.s.position.x += P.vx * dt; P.s.position.z += P.vz * dt; P.s.position.y += dt * 0.6; }
    // thunder ~1-3 s after a lightning flash
    if (E.bolt) { E.bolt = false; setTimeout(() => this.thunder(), 1000 + Math.random() * 2000); }
    this.windscreen(dt, rain); }
  thunder() { try { const A = this.s.a?.ctx || this.ac || (this.ac = new (window.AudioContext || window.webkitAudioContext)()), n = A.sampleRate * 3, b = A.createBuffer(1, n, A.sampleRate), d = b.getChannelData(0); let l = 0; for (let i = 0; i < n; i++) { l = l * 0.985 + (Math.random() * 2 - 1) * 0.015; d[i] = l * 9 * Math.exp(-i / (A.sampleRate * 1.1)) * (1 + Math.sin(i / 2000) * 0.4); }
      const s = A.createBufferSource(), f = A.createBiquadFilter(), g = A.createGain(); f.type = 'lowpass'; f.frequency.value = 180; g.gain.value = 0.9; s.buffer = b; s.connect(f).connect(g).connect(A.destination); s.start(); } catch (e) { } }
  // rain on the windscreen (cockpit view): drops collect, the wipers sweep them away
  windscreen(dt, rain) { const inCar = this.s.camMode === 'cockpit' && !this.s.foot?.active && rain > 0.03; if (!inCar) { if (this.ws) this.ws.style.display = 'none'; return; }
    if (!this.ws) { const c = this.ws = document.createElement('canvas'); c.id = 'cz-windscreen'; c.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:62%;pointer-events:none;z-index:2'; document.body.appendChild(c); this.drops = []; this.wipeA = 0; }
    const c = this.ws; c.style.display = ''; const w = c.width = Math.min(960, innerWidth), h = c.height = Math.round(w * 0.62 * innerHeight / innerWidth); const g = c.getContext('2d');
    const hero = this.s.obj?.userData?.hero?.st, mode = hero ? hero.wipe : rain > 0.6 ? 2 : rain > 0.15 ? 1 : 0; const sp = mode === 2 ? 5.5 : mode === 1 ? 2.6 : 0; if (!hero) this.wipeA += dt * sp; const ang = hero ? hero.wipeA || 0 : this.wipeA, arm = mode ? (1 - Math.cos(ang)) * 0.5 : 0; // 0..1 sweep
    const add = rain * dt * 140 * (MOB ? 0.6 : 1); for (let i = 0; i < add; i++) if (this.drops.length < 700) this.drops.push({ x: Math.random(), y: Math.random(), r: 1 + Math.random() * 2.6, v: 0 });
    const sweep = arm * Math.PI; // blades pivot at the bottom, sweeping across
    this.drops = this.drops.filter(d => { if (d.r > 2.8) { d.v += dt * 0.05; d.y += d.v * dt * 20; } const dx = d.x - 0.32, dy = 1 - d.y, a = Math.atan2(dy, dx); if (mode && Math.abs(a - (Math.PI - sweep)) < 0.12 && Math.hypot(dx, dy) < 0.9) return false; return d.y < 1; });
    for (const d of this.drops) { g.fillStyle = 'rgba(200,215,230,.35)'; g.beginPath(); g.ellipse(d.x * w, d.y * h, d.r, d.r * 1.2, 0, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,.4)'; g.fillRect(d.x * w - d.r * 0.3, d.y * h - d.r * 0.5, 1, 1); }
    if (mode && !hero) { g.strokeStyle = 'rgba(10,10,12,.85)'; g.lineWidth = 6; for (const px of [0.32, 0.78]) { const a = Math.PI - sweep; g.beginPath(); g.moveTo(px * w, h); g.lineTo(px * w + Math.cos(a) * w * 0.42, h - Math.sin(a) * h * 0.9); g.stroke(); } } }
  dispose() { this.g.removeFromParent(); this.ws?.remove(); }
}
