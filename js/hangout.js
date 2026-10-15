// p55 Talbot Way hangout (Small Heath, by the big Asda car park): a busy, slightly rowdy ambient spot. Groups of young
// people loitering and dancing, a car playing music with its doors open, another revving and doing donuts with tyre
// smoke, kids pulling wheelies on BMXs, litter about, and shouted banter. Everyone is friendly when you walk up and
// talk (Brummie greetings / banter) — nobody attacks the player. Built only when you come within ~450 m and torn down
// when you leave, procedural people (no skinned models), animation only near the player: cheap enough for phones.
import * as THREE from 'three';
import { buildPerson, animPerson } from './person.js';
import { say } from './places.js';
const MOB = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const SHOUT = ['Oi oi! Ow am ya?!', 'Turn it up, bab!', 'Gerrin there, our kid!', 'Yam havin\' a laugh!', 'Tara-a-bit!', 'Bostin\' motor that, mate!', 'Ar, ar, go on then!', 'Ey up, look who it is!', 'Who\'s got the chips?', 'Do another one!'];
const GREET = ['Alright bab! Ow am ya? Don\'t mind us, we\'m just chillin\'.', 'Ey up boss! Nice garms. Yow from round ere?', 'Safe, mate. Ignore Kyle, he thinks he\'s Lewis Hamilton.', 'Alright our kid! Asda\'s open \'til ten if yow want a meal deal.', 'Tara-a-bit, boss. Stay lively.', 'Yam the one with the Costcutter, ay ya? Respect.'];
const COLS = [0xd22a2a, 0x2a6ad2, 0xf2c21a, 0x2ab25a, 0xffffff, 0x1a1a1a, 0x8a2ad2, 0xf07a1a, 0x5a6a7a];
const SKIN = [0xe0b9a0, 0xc68e6a, 0xa0694a, 0x8d5a3b, 0x5c3a26, 0x4a2e1e];
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, pick = a => a[(rnd() * a.length) | 0];
function hatch(col) { const g = new THREE.Group(), paint = new THREE.MeshStandardMaterial({ color: col, roughness: 0.35, metalness: 0.5 }), glass = new THREE.MeshStandardMaterial({ color: 0x101820, roughness: 0.1, metalness: 0.6 }), tyre = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
  const b = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.7, 3.9), paint); b.position.y = 0.65; g.add(b); const c = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 2.1), glass); c.position.set(0, 1.25, 0.25); g.add(c);
  for (const [x, z] of [[-0.82, 1.25], [0.82, 1.25], [-0.82, -1.25], [0.82, -1.25]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 14), tyre); w.rotation.z = Math.PI / 2; w.position.set(x, 0.32, z); g.add(w); }
  for (const s of [-1, 1]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.04), new THREE.MeshBasicMaterial({ color: 0xfff4e0, toneMapped: false })); l.position.set(s * 0.6, 0.75, -1.96); g.add(l); const t = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.04), new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false })); t.position.set(s * 0.6, 0.8, 1.96); g.add(t); }
  return g; }
function bmx() { const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color: pick([0xff3030, 0x30a0ff, 0x111111, 0xf2c21a]), metalness: 0.6, roughness: 0.3 }), t = new THREE.MeshStandardMaterial({ color: 0x111111 });
  for (const z of [-0.5, 0.5]) { const w = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.035, 6, 16), t); w.rotation.y = Math.PI / 2; w.position.set(0, 0.25, z); g.add(w); }
  const f = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.9), m); f.position.set(0, 0.5, 0); g.add(f); const h = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.03), m); h.position.set(0, 0.85, -0.45); g.add(h); return g; }
export class Hangout {
  constructor(foot) { this.f = foot; this.s = foot.s; const E = this.s.app.data.east?.asda_park || this.s.app.data.east?.asda; this.c = null;
    if (E?.p) { let x = 0, z = 0; const n = E.p.length / 2; for (let i = 0; i < E.p.length; i += 2) { x += E.p[i] / 10; z += E.p[i + 1] / 10; } this.c = { x: x / n, z: z / n }; }
    else { const [lat0, lon0] = this.s.app.data.origin; this.c = { x: (-1.8456 - lon0) * 111320 * Math.cos(lat0 * Math.PI / 180), z: -(52.4638 - lat0) * 110574 }; } // Talbot Way (OSM way 141435673)
    this.g = null; this.t = 0; this.bub = []; }
  build() { const W = this.s.w, c = this.c, g = this.g = new THREE.Group(); g.name = 'talbot-hangout'; this.s.scene.add(g); seed = 7; const y0 = W.groundAt?.(c.x, c.z, 0)?.h ?? 0; this.y0 = y0;
    const H = (x, z) => W.groundAt?.(x, z, y0)?.h ?? y0;
    this.groups = []; const NG = MOB ? 4 : 6; for (let i = 0; i < NG; i++) { const a = i / NG * Math.PI * 2 + 0.4, R = 14 + rnd() * 10, gx = c.x + Math.cos(a) * R, gz = c.z + Math.sin(a) * R, n = 3 + ((rnd() * 3) | 0), ppl = [];
      for (let k = 0; k < n; k++) { const look = { skin: pick(SKIN), hair: 0x0d0b09, top: pick(COLS), legs: pick([0x1a1a1a, 0x23324a, 0x5a5a60, 0x2a2a3a]), shoe: pick([0xffffff, 0x111111, 0xd22a2a]), jacket: rnd() < 0.5 ? pick(COLS) : null };
        const p = buildPerson(look), ang = k / n * Math.PI * 2, px = gx + Math.cos(ang) * 1.1, pz = gz + Math.sin(ang) * 1.1; p.position.set(px, H(px, pz), pz); p.rotation.y = Math.atan2(px - gx, pz - gz); const sc = 0.92 + rnd() * 0.16; p.scale.set(sc * (0.95 + rnd() * 0.15), sc, sc);
        if (rnd() < 0.45) { const P = p.userData.person, cap = new THREE.Mesh(new THREE.SphereGeometry(0.122, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: pick(COLS), roughness: 0.7 })); cap.position.y = 0.035; P.head.add(cap); } // caps / hoods
        p.userData.mode = rnd() < 0.3 ? 'dance' : 'walk'; p.userData.ph = rnd() * 9; g.add(p); ppl.push(p); }
      this.groups.push({ x: gx, z: gz, ppl, t: 2 + rnd() * 6 }); }
    // cars: one parked with doors open playing music, one doing donuts
    this.music = hatch(0x111214); this.music.position.set(c.x - 8, H(c.x - 8, c.z + 6), c.z + 6); this.music.rotation.y = 0.7; g.add(this.music);
    this.donut = hatch(pick([0xd22a2a, 0xf2f2f2, 0x2a6ad2])); g.add(this.donut);
    const st = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(230,230,230,.8)'); gr.addColorStop(1, 'rgba(230,230,230,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(cv); })();
    this.smoke = []; for (let i = 0; i < (MOB ? 14 : 30); i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: st, transparent: true, depthWrite: false, opacity: 0 })); g.add(sp); this.smoke.push({ sp, t: 9 }); }
    // BMX riders doing wheelies
    this.bikes = []; for (let i = 0; i < 2; i++) { const b = bmx(), rider = buildPerson({ skin: pick(SKIN), hair: 0x0d0b09, top: pick(COLS), legs: 0x1a1a1a, shoe: 0xffffff, jacket: null }); rider.position.set(0, -0.1, 0.05); rider.scale.setScalar(0.92); b.add(rider); g.add(b); this.bikes.push({ b, rider, ph: i * 2.3, ax: 0.6 + i * 1.3 }); }
    // litter: cans, wrappers, bags (one instanced draw)
    const n = MOB ? 40 : 90, im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.04, 0.18), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), n), m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    for (let i = 0; i < n; i++) { const x = c.x + (rnd() - 0.5) * 50, z = c.z + (rnd() - 0.5) * 50; q.setFromEuler(new THREE.Euler(0, rnd() * 6, 0)); m.compose(new THREE.Vector3(x, H(x, z) + 0.03, z), q, new THREE.Vector3(0.6 + rnd(), 1, 0.6 + rnd())); im.setMatrixAt(i, m); im.setColorAt(i, col.setHex(pick([0xd22a2a, 0xf2f2f2, 0x2a6ad2, 0xc8c8c8, 0xf2c21a]))); } g.add(im);
    this.tags = []; }
  near(p) { if (!this.g) return null; let best = null, bd = 3.2; for (const G of this.groups) { const d = Math.hypot(p.x - G.x, p.z - G.z); if (d < bd) { bd = d; best = G; } } return best; }
  talk(G) { say('Local', pick(GREET)); for (const p of G.ppl) p.rotation.y = Math.atan2(this.f.p.x - p.position.x, this.f.p.z - p.position.z); G.face = 4; }
  step(dt) { const q = this.f.q, c = this.c; if (!c) return; const d = this.hold ? 0 : Math.hypot(q.x - c.x, q.z - c.z);
    if (!this.g && d < 450) this.build(); if (this.g && d > 600) return this.dispose(); if (!this.g) return; this.t += dt; const T = this.t, near = d < 140;
    if (near) for (const G of this.groups) { for (const p of G.ppl) animPerson(p, dt, 0, p.userData.mode === 'dance' ? 'dance' : 'walk');
      G.t -= dt; if (G.t < 0 && d < 60) { G.t = 5 + rnd() * 8; this.shout(G, pick(SHOUT)); } if (G.face > 0) G.face -= dt; }
    // donuts: circle with the nose pointing in, drifting; tyre smoke from the rear
    const R = 7, a = T * 1.6, dx = c.x + 10 + Math.cos(a) * R, dz = c.z - 8 + Math.sin(a) * R; const y = this.y0; this.donut.position.set(dx, this.g.children.length ? (this.s.w.groundAt?.(dx, dz, y)?.h ?? y) : y, dz); this.donut.rotation.y = -a - 0.6;
    for (const S of this.smoke) { S.t += dt; if (S.t > 1.6 && rnd() < dt * 20) { S.t = 0; S.sp.position.set(dx - Math.cos(a) * 1.2, this.donut.position.y + 0.3, dz - Math.sin(a) * 1.2); } const k = S.t / 1.6; S.sp.material.opacity = k < 1 ? 0.55 * (1 - k) : 0; S.sp.scale.setScalar(0.8 + k * 4); S.sp.position.y += dt * 0.5; }
    for (const B of this.bikes) { const s = Math.sin(T * 0.5 + B.ph), x = c.x - 14 + s * 12, z = c.z - 14 + B.ax * 3; B.b.position.set(x, this.y0, z); B.b.rotation.set(-0.35 - Math.sin(T * 2 + B.ph) * 0.1, Math.cos(T * 0.5 + B.ph) > 0 ? -Math.PI / 2 : Math.PI / 2, 0, 'YXZ'); if (near) animPerson(B.rider, dt, 0, 'sit'); }
    this.audio(d, dt); this.tagStep(); }
  shout(G, text) { const e = document.createElement('div'); e.textContent = text; e.style.cssText = 'position:fixed;left:0;top:0;transform:translate(-50%,-100%);background:rgba(255,255,255,.92);color:#111;font:700 13px system-ui;padding:4px 8px;border-radius:10px;pointer-events:none;z-index:5;white-space:nowrap'; document.body.appendChild(e); this.tags.push({ e, G, t: 2.6 }); }
  tagStep() { const cam = this.s.g.cam, v = new THREE.Vector3(), R = this.s.g.r.domElement.getBoundingClientRect(); for (let i = this.tags.length - 1; i >= 0; i--) { const T = this.tags[i]; T.t -= 1 / 60; if (T.t < 0) { T.e.remove(); this.tags.splice(i, 1); continue; } v.set(T.G.x, this.y0 + 2.3, T.G.z).project(cam); if (v.z > 1) { T.e.style.display = 'none'; continue; } T.e.style.display = ''; T.e.style.left = (R.left + (v.x + 1) / 2 * R.width) + 'px'; T.e.style.top = (R.top + (1 - v.y) / 2 * R.height) + 'px'; } }
  // car stereo (bass loop) + revs, volume by distance
  audio(d, dt) { if (this.f.venues.inside) d = 999; try { const A = this.f.ac || (this.f.ac = new (window.AudioContext || window.webkitAudioContext)()); if (!this.au) { const out = A.createGain(); out.gain.value = 0; out.connect(A.destination); this.au = { out, n: 0, t: 0 }; }
      const g = Math.max(0, 1 - d / 70) * 0.18; this.au.out.gain.setTargetAtTime(g, A.currentTime, 0.2); if (g <= 0.001) return; this.au.t -= dt; if (this.au.t > 0) return; this.au.t = 0.25; const t = A.currentTime + 0.02, n = this.au.n++;
      const o = A.createOscillator(), e = A.createGain(); o.type = 'sine'; o.frequency.value = [41, 41, 49, 37][(n >> 2) % 4]; e.gain.setValueAtTime(n % 2 ? 0.4 : 0.9, t); e.gain.exponentialRampToValueAtTime(0.001, t + 0.22); o.connect(e).connect(this.au.out); o.start(t); o.stop(t + 0.24);
      if (n % 12 === 0) { const r = A.createOscillator(), re = A.createGain(); r.type = 'sawtooth'; r.frequency.setValueAtTime(60, t); r.frequency.exponentialRampToValueAtTime(190, t + 0.5); r.frequency.exponentialRampToValueAtTime(70, t + 1.0); re.gain.setValueAtTime(0.25, t); re.gain.exponentialRampToValueAtTime(0.001, t + 1.05); r.connect(re).connect(this.au.out); r.start(t); r.stop(t + 1.1); } } catch (e) { } }
  dispose() { if (!this.g) return; this.g.traverse(o => { if (o.isMesh || o.isSprite) { o.geometry?.dispose?.(); o.material?.dispose?.(); } }); this.g.removeFromParent(); this.g = null; for (const T of this.tags) T.e.remove(); this.tags = []; try { this.au?.out.disconnect(); } catch (e) { } this.au = null; }
}
