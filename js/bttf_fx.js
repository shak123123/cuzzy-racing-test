// BTTF fire trails: GPU-animated flames, smoke and burning fuel lines with scorch marks.
// Everything is procedural shader noise (no flat gradient cards), so it reads as real fire on every graphics preset.
// Low / mobile presets use fewer particles, not a simpler look.
import * as THREE from 'three';

let NTEX = null;
function noiseTex() { if (NTEX) return NTEX; const N = 128, d = new Uint8Array(N * N * 4); const r = () => Math.random();
  const oct = [8, 16, 32, 64].map(g => { const a = new Float32Array(g * g); for (let i = 0; i < a.length; i++) a[i] = r(); return [g, a]; });
  const at = (g, a, x, y) => a[((y % g + g) % g) * g + ((x % g + g) % g)];
  for (let ch = 0; ch < 2; ch++) { const sh = ch * 37; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let v = 0, amp = 0.5, tot = 0;
    for (const [g, a] of oct) { const fx = x / N * g + sh, fy = y / N * g + sh, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      v += amp * ((at(g, a, ix, iy) * (1 - sx) + at(g, a, ix + 1, iy) * sx) * (1 - sy) + (at(g, a, ix, iy + 1) * (1 - sx) + at(g, a, ix + 1, iy + 1) * sx) * sy); tot += amp; amp *= 0.5; }
    d[(y * N + x) * 4 + ch] = Math.round(v / tot * 255); } }
  for (let i = 0; i < N * N; i++) { d[i * 4 + 2] = 0; d[i * 4 + 3] = 255; }
  NTEX = new THREE.DataTexture(d, N, N, THREE.RGBAFormat); NTEX.wrapS = NTEX.wrapT = THREE.RepeatWrapping; NTEX.magFilter = THREE.LinearFilter; NTEX.minFilter = THREE.LinearFilter; NTEX.needsUpdate = true; return NTEX; }
const NOISE = /* glsl */`
uniform sampler2D uNoise;
float fbm(vec2 p){ return texture2D(uNoise, p * 0.125).r; }
float vn(vec2 p){ return texture2D(uNoise, p * 0.31 + 0.5).g; }
// black-body style ramp: deep red -> orange -> yellow -> white-hot
vec3 fireRamp(float t){ t = clamp(t, 0.0, 1.0);
  vec3 c = mix(vec3(0.35, 0.02, 0.0), vec3(1.0, 0.28, 0.02), smoothstep(0.0, 0.35, t));
  c = mix(c, vec3(1.0, 0.62, 0.12), smoothstep(0.3, 0.65, t));
  return mix(c, vec3(1.0, 0.95, 0.75), smoothstep(0.65, 1.0, t)); }`;

const MOB = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

class Trail {
  constructor(fx, max) {
    this.fx = fx; this.max = max; this.pts = []; // {x,y,z, rx,rz (right vector), t (birth), d (distance along)}
    const mk = (w, mat, ro) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 2 * 3), 3));
      g.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(max * 2), 1)); g.setAttribute('aD', new THREE.BufferAttribute(new Float32Array(max * 2), 1));
      g.setAttribute('aS', new THREE.BufferAttribute(new Float32Array(max * 2), 1)); const idx = []; for (let i = 0; i < max - 1; i++) { const o = i * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); } g.setIndex(idx); g.setDrawRange(0, 0);
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = ro; m.userData.w = w; fx.root.add(m); return m; };
    this.scorch = mk(0.4, fx.scorchMat, 1); this.line = mk(0.3, fx.lineMat, 3);
  }
  add(x, y, z, rx, rz, t) { const L = this.pts[this.pts.length - 1]; if (L && Math.hypot(x - L.x, z - L.z) < 0.25) return false;
    const d = L ? L.d + Math.hypot(x - L.x, z - L.z) : 0; this.pts.push({ x, y, z, rx, rz, t, d }); if (this.pts.length > this.max) this.pts.shift(); this.dirty = true; return true; }
  rebuild() { if (!this.dirty) return; this.dirty = false; const n = this.pts.length;
    for (const m of [this.scorch, this.line]) { const g = m.geometry, P = g.attributes.position.array, T = g.attributes.aT.array, D = g.attributes.aD.array, S = g.attributes.aS.array, w = m.userData.w / 2, lift = m === this.line ? 0.11 : 0.09;
      for (let i = 0; i < n; i++) { const p = this.pts[i], o = i * 6; P[o] = p.x - p.rx * w; P[o + 1] = p.y + lift; P[o + 2] = p.z - p.rz * w; P[o + 3] = p.x + p.rx * w; P[o + 4] = p.y + lift; P[o + 5] = p.z + p.rz * w;
        T[i * 2] = T[i * 2 + 1] = p.t; D[i * 2] = D[i * 2 + 1] = p.d; S[i * 2] = 0; S[i * 2 + 1] = 1; }
      for (const k of ['position', 'aT', 'aD', 'aS']) g.attributes[k].needsUpdate = true; g.setDrawRange(0, Math.max(0, n - 1) * 6); }
  }
  prune(now) { while (this.pts.length && now - this.pts[0].t > 30) { this.pts.shift(); this.dirty = true; } }
}

class Particles {
  constructor(fx, max, mat) { this.max = max; this.n = 0; const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.age = new Float32Array(max); this.life = new Float32Array(max); this.size = new Float32Array(max); this.seed = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('aAge', new THREE.BufferAttribute(new Float32Array(max), 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1)); g.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1)); g.setDrawRange(0, 0);
    this.pts = new THREE.Points(g, mat); this.pts.frustumCulled = false; fx.root.add(this.pts); }
  spawn(x, y, z, vx, vy, vz, life, size) { if (this.n >= this.max) return; const i = this.n++, o = i * 3;
    this.pos[o] = x; this.pos[o + 1] = y; this.pos[o + 2] = z; this.vel[o] = vx; this.vel[o + 1] = vy; this.vel[o + 2] = vz; this.age[i] = 0; this.life[i] = life; this.size[i] = size; this.seed[i] = Math.random() * 100; }
  step(dt, buoy, drag, onDie) { const A = this.pts.geometry.attributes.aAge.array;
    for (let i = this.n - 1; i >= 0; i--) { this.age[i] += dt; const o = i * 3;
      if (this.age[i] >= this.life[i]) { onDie?.(this.pos[o], this.pos[o + 1], this.pos[o + 2]); const j = --this.n, q = j * 3; // swap-remove
        this.pos[o] = this.pos[q]; this.pos[o + 1] = this.pos[q + 1]; this.pos[o + 2] = this.pos[q + 2]; this.vel[o] = this.vel[q]; this.vel[o + 1] = this.vel[q + 1]; this.vel[o + 2] = this.vel[q + 2];
        this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.size[i] = this.size[j]; this.seed[i] = this.seed[j]; continue; }
      const k = Math.exp(-drag * dt); this.vel[o] *= k; this.vel[o + 2] *= k; this.vel[o + 1] = this.vel[o + 1] * k + buoy * dt;
      this.pos[o] += this.vel[o] * dt; this.pos[o + 1] += this.vel[o + 1] * dt; this.pos[o + 2] += this.vel[o + 2] * dt; }
    for (let i = 0; i < this.n; i++) A[i] = this.age[i] / this.life[i];
    const g = this.pts.geometry; for (const k of ['position', 'aAge', 'aSize', 'aSeed']) g.attributes[k].needsUpdate = true; g.setDrawRange(0, this.n); }
}

const pointVS = /* glsl */`uniform float uViewH; attribute float aAge, aSize, aSeed; varying float vAge, vSeed;
  void main(){ vAge = aAge; vSeed = aSeed; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize * projectionMatrix[1][1] * uViewH * 0.5 / max(0.3, -mv.z), 1.0, 900.0); }`;

export class FireFX {
  constructor(world, lowSpec) {
    this.world = world; this.root = new THREE.Group(); this.root.name = 'bttfFire'; world.add(this.root); this.t = 0; this.low = lowSpec;
    const U = this.U = { uTime: { value: 0 }, uViewH: { value: 720 }, uNoise: { value: noiseTex() } };
    this.lineMat = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
      vertexShader: `attribute float aT, aD, aS; varying float vT, vD, vS; void main(){ vT = aT; vD = aD; vS = aS; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uTime; varying float vT, vD, vS; ${NOISE}
        void main(){ float age = uTime - vT, across = abs(vS - 0.5) * 2.0;
          float burn = smoothstep(0.0, 0.06, age) * (1.0 - smoothstep(2.6, 5.5, age));
          float ember = 1.0 - smoothstep(4.5, 11.0, age);
          float n = fbm(vec2(vD * 2.6, uTime * 2.4 + vS * 3.0)), n2 = vn(vec2(vD * 9.0, uTime * 6.0));
          float core = pow(1.0 - smoothstep(0.0, 1.0, across), 1.6);
          float heat = core * burn * (0.45 + 0.75 * n) * (0.85 + 0.3 * n2);
          float glow = pow(core, 3.0) * ember * smoothstep(0.55, 0.85, vn(vec2(vD * 14.0, floor(uTime * 3.0) * 0.3))) * 0.55;
          vec3 col = fireRamp(heat * 1.15) * heat * 1.6 + vec3(1.0, 0.25, 0.03) * glow;
          gl_FragColor = vec4(col, 1.0); }` });
    this.scorchMat = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide,
      vertexShader: `attribute float aT, aD, aS; varying float vT, vD, vS; void main(){ vT = aT; vD = aD; vS = aS; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uTime; varying float vT, vD, vS; ${NOISE}
        void main(){ float age = uTime - vT, across = abs(vS - 0.5) * 2.0; float n = fbm(vec2(vD * 4.0, vS * 6.0));
          float a = (1.0 - smoothstep(0.35 + 0.35 * n, 1.0, across)) * smoothstep(0.0, 0.8, age) * (1.0 - smoothstep(20.0, 30.0, age)) * 0.7;
          gl_FragColor = vec4(vec3(0.03, 0.025, 0.02), a); }` });
    this.fireMat = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, vertexShader: pointVS,
      fragmentShader: `uniform float uTime; varying float vAge, vSeed; ${NOISE}
        void main(){ vec2 c = gl_PointCoord * 2.0 - 1.0; c.y = -c.y; // +y up
          float t = uTime * 3.0 + vSeed; vec2 w = vec2(fbm(c * 1.7 + vec2(vSeed, -t)), fbm(c * 1.7 + vec2(-t, vSeed))) - 0.5;
          vec2 q = c + w * (0.55 + vAge * 0.6); q.x *= 1.35 + vAge * 0.5; q.y = q.y * 0.75 + 0.2;           // tongue shape, licking upward
          float r = length(q), body = 1.0 - smoothstep(0.15, 0.95, r);
          float tex = fbm(c * 3.2 + vec2(vSeed * 1.3, -uTime * 4.5));
          float inten = body * (0.55 + 0.7 * tex) * (1.0 - smoothstep(0.55, 1.0, vAge)) * smoothstep(0.0, 0.08, vAge);
          float temp = inten * (1.15 - vAge * 0.9);
          gl_FragColor = vec4(fireRamp(temp) * inten * 1.35, 1.0); }` });
    this.smokeMat = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, vertexShader: pointVS,
      fragmentShader: `uniform float uTime; varying float vAge, vSeed; ${NOISE}
        void main(){ vec2 c = gl_PointCoord * 2.0 - 1.0; float n = fbm(c * 2.0 + vec2(vSeed, uTime * 0.4 + vSeed));
          float r = length(c) + (n - 0.5) * 0.6, a = (1.0 - smoothstep(0.25, 1.0, r)) * smoothstep(0.0, 0.15, vAge) * (1.0 - smoothstep(0.45, 1.0, vAge)) * 0.32;
          vec3 col = mix(vec3(0.32, 0.2, 0.12), vec3(0.16, 0.155, 0.15), smoothstep(0.0, 0.35, vAge)) * (0.75 + 0.5 * n);
          gl_FragColor = vec4(col, a); }` });
    const nf = lowSpec ? 260 : 520, ns = lowSpec ? 110 : 220;
    this.smoke = new Particles(this, ns, this.smokeMat); this.fire = new Particles(this, nf, this.fireMat);
    this.smoke.pts.renderOrder = 4; this.fire.pts.renderOrder = 5;
    this.trails = [new Trail(this, 300), new Trail(this, 300)];
    this.light = new THREE.PointLight(0xff7a20, 0, 22, 1.6); world.add(this.light); this.light2 = new THREE.PointLight(0xff5a10, 0, 16, 1.8); world.add(this.light2);
    this.spawnAcc = 0; this.smokeAcc = 0;
  }
  addPoint(i, x, y, z, rx, rz) { this.trails[i].add(x, y, z, rx, rz, this.t); }
  step(dt) {
    this.t += dt; this.U.uTime.value = this.t; const c = document.getElementById('c'); if (c) this.U.uViewH.value = c.height || 720;
    const now = this.t, BURN = 3.2; let burning = 0, lx = 0, ly = 0, lz = 0, far = null;
    for (const T of this.trails) { T.prune(now); T.rebuild(); for (const p of T.pts) if (now - p.t < BURN) { burning++; lx += p.x; ly += p.y; lz += p.z; if (!far) far = p; } }
    // flames: emitted along every still-burning metre of trail, weaker as the fuel burns off
    const rate = (this.low ? 260 : 520) / 0.7; this.spawnAcc += burning ? rate * dt : 0; this.smokeAcc += burning ? (this.low ? 32 : 64) * dt : 0;
    const tmp = this._tmp || (this._tmp = { x: 0, y: 0, z: 0, rx: 0, rz: 0, t: 0 });
    const pick = (maxAge) => { const T = this.trails[Math.random() < 0.5 ? 0 : 1], L = T.pts; if (!L.length) return null; for (let k = 0; k < 4; k++) { const i = (Math.random() * L.length) | 0, p = L[i]; if (now - p.t >= maxAge) continue;
        const q = L[Math.min(L.length - 1, i + 1)], f = Math.random(); tmp.x = p.x + (q.x - p.x) * f; tmp.y = p.y + (q.y - p.y) * f; tmp.z = p.z + (q.z - p.z) * f; tmp.rx = p.rx; tmp.rz = p.rz; tmp.t = p.t + (q.t - p.t) * f; return tmp; } return null; };
    while (this.spawnAcc >= 1) { this.spawnAcc--; const p = pick(BURN); if (!p) break; const a = now - p.t, s = 1 - a / BURN; if (Math.random() > 0.25 + 0.75 * s) continue;
      const j = (Math.random() - 0.5) * 0.14; this.fire.spawn(p.x + p.rx * j + (Math.random() - 0.5) * 0.06, p.y + 0.12, p.z + p.rz * j + (Math.random() - 0.5) * 0.06,
        (Math.random() - 0.5) * 0.35, 0.9 + Math.random() * 1.1 * s, (Math.random() - 0.5) * 0.35, 0.45 + Math.random() * 0.45, 0.42 + Math.random() * 0.35 * (0.5 + s)); }
    while (this.smokeAcc >= 1) { this.smokeAcc--; const p = pick(BURN + 2); if (!p) break;
      this.smoke.spawn(p.x + (Math.random() - 0.5) * 0.2, p.y + 0.6 + Math.random() * 0.4, p.z + (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.4, 2.6 + Math.random() * 1.6, 0.9 + Math.random() * 0.8); }
    this.fire.step(dt, 1.6, 1.2); this.smoke.step(dt, 0.25, 0.6);
    // smoke puffs grow as they rise
    for (let i = 0; i < this.smoke.n; i++) this.smoke.size[i] += dt * 0.55;
    const k = Math.min(1, burning / 60), fl = 0.75 + 0.25 * Math.sin(now * 37) * Math.sin(now * 23 + 1) + Math.random() * 0.15;
    if (burning) { this.light.position.set(lx / burning, ly / burning + 0.7, lz / burning); if (far) this.light2.position.set(far.x, far.y + 0.5, far.z); }
    this.light.intensity = k * 16 * fl; this.light2.intensity = k * 9 * fl;
    this.root.visible = this.fire.n > 0 || this.smoke.n > 0 || this.trails.some(t => t.pts.length);
  }
}

const FX = new WeakMap();
export function fireFX(world, lowSpec = MOB) { let f = FX.get(world); if (!f) { f = new FireFX(world, lowSpec); FX.set(world, f); } return f; }
