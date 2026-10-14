/**
 * daynight-weather.js — drop-in day/night cycle + dynamic weather for Three.js games.
 * ---------------------------------------------------------------------------
 * - 24h cycle in CYCLE real seconds (default 720 s = 12 min), moving sun/moon direction
 * - weather state machine: clear -> cloudy -> fog -> rain -> storm (smooth ~9 s blends,
 *   each state lasts 70-160 s), lightning flashes in storms
 * - road wetness that builds in rain and dries afterwards (use it for wet reflections/grip)
 * - "lights" factor that fades street lamps / windows / neon on at dusk and in heavy weather
 *
 * Usage (only dependency: THREE, passed in):
 *   import { Environment, applyToScene, SkyDome, RainField } from './daynight-weather.js';
 *   const env = new Environment(THREE, { tod: 0.7 });            // 0 = midnight, 0.5 = noon
 *   const sky = new SkyDome(THREE); scene.add(sky.mesh);           // optional procedural sky
 *   const rain = new RainField(THREE, 6000); scene.add(rain.mesh); // optional rain streaks
 *   per frame:
 *     const o = env.update(dt);
 *     applyToScene(o, { scene, renderer, sun: dirLight, hemi: hemiLight, envDay, envNight });
 *     sky.update(o, camera, time); rain.update(o, camera, time);
 *     // game specific: lampMaterial.emissiveIntensity = o.lights * 3; roadMaterial.roughness = 1 - 0.6 * o.wet; ...
 * Output fields (env.out): day, dusk, night, lights, wet, cloud, fog, rain, flash, weather, target,
 *   sunDir, lightDir (sun by day, moon by night), keyColor, keyI, hemiSky, hemiGround, hemiI,
 *   fogColor, fogDensity (FogExp2), exposure, envDay (bool), envI, neon (multiplier for neon signs).
 * env.setWeather('rain', instant?), env.setTime(0.5), env.clock() -> 'HH:MM', env.frozen = true.
 */
let THREE = null;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();

export const CYCLE = 720; // 12 real minutes per 24h
const WEATHER = {
  clear: { cloud: 0.12, fog: 0.0, rain: 0, light: 0 },
  cloudy: { cloud: 0.75, fog: 0.08, rain: 0, light: 0 },
  fog: { cloud: 0.55, fog: 1.0, rain: 0, light: 0 },
  rain: { cloud: 0.9, fog: 0.25, rain: 0.75, light: 0 },
  storm: { cloud: 1.0, fog: 0.35, rain: 1.0, light: 1 },
};
export const WEATHER_NAMES = Object.keys(WEATHER);
const NEXT = { clear: ['clear', 'cloudy', 'cloudy', 'fog'], cloudy: ['clear', 'rain', 'fog', 'cloudy'], fog: ['clear', 'cloudy'], rain: ['cloudy', 'storm', 'rain', 'clear'], storm: ['rain', 'cloudy'] };
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const C = (h) => new THREE.Color(h);
let _c, _c2;

export class Environment {
  constructor(three, opts = {}) {
    THREE = three; _c = new THREE.Color(); _c2 = new THREE.Color();
    const tod = params.get('tod');
    this.tod = tod != null ? +tod : (opts.tod ?? 0.70); // 0 = midnight, 0.5 = noon; start late afternoon
    this.frozen = params.get('freeze') === '1';
    const w = params.get('weather') || opts.weather;
    this.weather = WEATHER[w] ? w : 'clear'; this.target = this.weather;
    this.cur = { ...WEATHER[this.weather] };
    this.wTimer = 70 + Math.random() * 80; this.wet = this.cur.rain > 0 ? 1 : 0;
    this.flash = 0; this.nextBolt = 6;
    this.sunDir = new THREE.Vector3(); this.lightDir = new THREE.Vector3();
    this.out = {};
    this.compute(0);
  }
  setWeather(name, instant = false) { if (!WEATHER[name]) return; this.target = name; this.wTimer = 90 + Math.random() * 90; if (instant) { this.weather = name; this.cur = { ...WEATHER[name] }; this.wet = this.cur.rain > 0 ? 1 : this.wet * 0.3; } }
  setTime(t) { this.tod = ((t % 1) + 1) % 1; }
  clock() { const m = Math.floor(this.tod * 1440); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
  update(dt) {
    if (!this.frozen) {
      this.tod = (this.tod + dt / CYCLE) % 1;
      this.wTimer -= dt;
      if (this.wTimer <= 0) { const opts = NEXT[this.target]; this.target = opts[Math.floor(Math.random() * opts.length)]; this.wTimer = 70 + Math.random() * 90; }
    }
    const T = WEATHER[this.target]; const k = 1 - Math.exp(-dt / 9);
    for (const key in T) this.cur[key] = lerp(this.cur[key], T[key], k);
    if (Math.abs(this.cur.cloud - T.cloud) < 0.02) this.weather = this.target;
    // wetness builds quickly in rain, dries slowly (faster in sunshine)
    if (this.cur.rain > 0.1) this.wet = Math.min(1, this.wet + dt * 0.06 * this.cur.rain);
    else this.wet = Math.max(0, this.wet - dt * (0.006 + 0.012 * this.out.day));
    // lightning
    this.flash *= Math.exp(-dt * 7);
    if (this.cur.light > 0.6) { this.nextBolt -= dt; if (this.nextBolt <= 0) { this.flash = 1.0; this.bolt = true; this.nextBolt = 5 + Math.random() * 12; } }
    this.compute(dt);
    return this.out;
  }
  compute() {
    const a = (this.tod - 0.25) * Math.PI * 2; // sunrise at 06:00
    this.sunDir.set(Math.cos(a) * 0.82, Math.sin(a), 0.35 + Math.cos(a) * 0.2).normalize();
    const sy = this.sunDir.y, w = this.cur;
    const day = smooth(-0.1, 0.18, sy), dusk = Math.exp(-Math.pow((sy - 0.02) / 0.14, 2));
    const night = 1 - day;
    const sunUp = sy > -0.04;
    this.lightDir.copy(sunUp ? this.sunDir : this.sunDir).multiplyScalar(sunUp ? 1 : -1);
    if (this.lightDir.y < 0.25) { this.lightDir.y = 0.25; this.lightDir.normalize(); }
    const lightsOn = smooth(0.22, -0.02, sy);
    const o = this.out;
    o.day = day; o.dusk = dusk; o.night = night; o.lights = clamp(lightsOn + w.cloud * 0.25 * (w.rain + w.fog * 0.6), 0, 1);
    o.sunDir = this.sunDir; o.lightDir = this.lightDir; o.cloud = w.cloud; o.fog = w.fog; o.rain = w.rain; o.wet = this.wet; o.flash = this.flash; o.weather = this.weather; o.target = this.target;
    // key light
    const sunK = smooth(-0.04, 0.25, sy);
    const warm = smooth(0.35, 0.02, sy);
    o.keyColor = _c.copy(C(0xfff4e6)).lerp(C(0xff9a50), warm).lerp(C(0x9fb4ff), 1 - sunK).clone();
    o.keyI = sunUp ? lerp(0.35, 3.4, sunK) * (1 - 0.72 * w.cloud) * (1 - 0.4 * w.fog) : 0.55 * (1 - 0.7 * w.cloud);
    o.shadowK = sunUp ? (1 - w.cloud * 0.85) : 0.6 * (1 - w.cloud);
    // ambient
    o.hemiSky = _c2.copy(C(0x3a4a80)).lerp(C(0xa8c4ff), day).lerp(C(0xc0c4cc), w.cloud * day * 0.7).clone();
    o.hemiGround = C(0x201418).lerp(C(0x5a5048), day);
    o.hemiI = lerp(0.55, 1.15, day) * (1 - 0.15 * w.cloud);
    // fog
    const fogNight = C(0x0c0b1a), fogDay = C(0x9fb0c8).lerp(C(0xb7bcc4), w.cloud);
    o.fogColor = fogNight.lerp(fogDay, day).lerp(C(0xc9784a), dusk * 0.45 * (1 - w.fog));
    if (w.fog > 0.3) o.fogColor.lerp(night > 0.5 ? C(0x1c1d26) : C(0xa8adb5), w.fog * 0.6);
    o.fogDensity = lerp(0.0034, 0.0016, day) + w.fog * 0.016 + w.rain * 0.0035;
    o.exposure = lerp(1.05, 0.82, day) * (1 + w.cloud * 0.15 * day);
    o.envDay = day > 0.4; o.envI = lerp(1.0, 0.9, day) * (1 - 0.3 * w.cloud * day);
    o.neon = lerp(1, 0.45, day * (1 - w.cloud * 0.3));
    return o;
  }
}

/** Apply the generic parts of the environment to standard three.js objects. Any argument may be omitted. */
export function applyToScene(o, { scene, renderer, sun, hemi, envDay, envNight, followTarget, shadowDistance = 160 } = {}) {
  if (sun) { sun.color.copy(o.keyColor); sun.intensity = o.keyI + o.flash * 2;
    if (followTarget) { sun.position.set(followTarget.x + o.lightDir.x * shadowDistance, Math.max(30, o.lightDir.y * shadowDistance), followTarget.z + o.lightDir.z * shadowDistance); sun.target.position.set(followTarget.x, 0, followTarget.z); sun.target.updateMatrixWorld(); } }
  if (hemi) { hemi.color.copy(o.hemiSky); hemi.groundColor.copy(o.hemiGround); hemi.intensity = o.hemiI + o.flash * 1.5; }
  if (scene) {
    if (scene.fog && scene.fog.isFogExp2) { scene.fog.color.copy(o.fogColor); scene.fog.density = o.fogDensity; }
    const env = o.envDay ? envDay : envNight; if (env && scene.environment !== env) scene.environment = env;
    if ('environmentIntensity' in scene) scene.environmentIntensity = o.envI;
  }
  if (renderer) renderer.toneMappingExposure = o.exposure;
}

const SKY_FS = `varying vec3 vDir; uniform float uTime, uDay, uCloud, uFog, uDusk, uFlash; uniform vec3 uSun, uFogCol;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
  float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
  void main(){
    vec3 d = normalize(vDir); float y = clamp(d.y, -0.2, 1.0);
    vec3 night = mix(vec3(0.32,0.13,0.12), vec3(0.05,0.035,0.09), smoothstep(0.0,0.18,y)); night = mix(night, vec3(0.012,0.014,0.035), smoothstep(0.15,0.7,y));
    vec3 day = mix(vec3(0.62,0.74,0.92), vec3(0.10,0.28,0.72), pow(smoothstep(-0.02,0.9,y),0.6)) * 1.6;
    vec3 col = mix(night, day, uDay);
    float sd = max(dot(d, normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0);
    vec3 duskC = mix(vec3(1.0,0.36,0.12), vec3(0.85,0.3,0.55), smoothstep(0.0,0.35,y));
    col = mix(col, duskC * (1.2 + sd), uDusk * (0.25 + 0.75 * pow(sd, 3.0)) * (1.0 - smoothstep(0.0, 0.6, y)));
    float cs = dot(d, uSun); col += vec3(1.0,0.85,0.6) * (pow(max(cs,0.0),1400.0)*60.0 + pow(max(cs,0.0),12.0)*0.5*(1.0-uCloud)) * smoothstep(-0.1,0.05,uSun.y);
    float cm = dot(d, -uSun); col += vec3(0.75,0.82,1.0) * (smoothstep(0.9993,0.9996,cm)*6.0 + pow(max(cm,0.0),60.0)*0.12) * smoothstep(0.05,-0.1,uSun.y) * (1.0-uCloud*0.8);
    vec2 sp = d.xz / (d.y + 0.3) * 120.0; col += vec3(0.9) * step(0.997, hash(floor(sp))) * smoothstep(0.1,0.5,y) * (1.0-uDay) * (1.0-uCloud) * 0.8;
    float c = fbm(d.xz / max(0.08, d.y + 0.12) * 1.3 + vec2(uTime*0.012, uTime*0.004)); float cover = mix(0.62, 0.22, uCloud);
    float cloud = smoothstep(cover, cover + 0.35, c) * smoothstep(-0.02, 0.25, y);
    vec3 cc = mix(vec3(0.16,0.08,0.10), mix(vec3(1.05,1.05,1.1), vec3(0.42,0.45,0.5), uCloud) * 1.4, uDay); cc = mix(cc, duskC*0.9, uDusk*0.5);
    col = mix(col, cc, cloud * (0.6 + 0.35 * uCloud));
    col = mix(col, uFogCol, clamp(uFog * (1.0 - smoothstep(-0.05, 0.5 - uFog*0.3, y)) + uCloud*0.25*uDay, 0.0, 1.0));
    col += vec3(0.7,0.75,1.0) * uFlash;
    gl_FragColor = vec4(col, 1.0);
  }`;
/** Procedural sky sphere (sun, moon, stars, clouds, dusk glow, fog blend). */
export class SkyDome {
  constructor(three, radius = 1000) {
    const T = three;
    this.mat = new T.ShaderMaterial({ side: T.BackSide, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 }, uDay: { value: 0 }, uCloud: { value: 0 }, uFog: { value: 0 }, uDusk: { value: 0 }, uFlash: { value: 0 }, uSun: { value: new T.Vector3(0, 1, 0) }, uFogCol: { value: new T.Color() } },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`, fragmentShader: SKY_FS });
    this.mesh = new T.Mesh(new T.SphereGeometry(radius, 32, 16), this.mat); this.mesh.renderOrder = -10; this.mesh.frustumCulled = false;
  }
  update(o, camera, time) { const u = this.mat.uniforms; u.uTime.value = time; u.uDay.value = o.day; u.uDusk.value = o.dusk; u.uCloud.value = o.cloud; u.uFog.value = o.fog; u.uFlash.value = o.flash * 0.6; u.uSun.value.copy(o.sunDir); u.uFogCol.value.copy(o.fogColor); if (camera) this.mesh.position.copy(camera.position); }
}
/** GPU rain streaks that wrap around the camera; opacity follows o.rain. */
export class RainField {
  constructor(three, count = 5000) {
    const T = three; const pos = new Float32Array(count * 6), end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) { const x = Math.random() * 70, y = Math.random() * 34, z = Math.random() * 70; pos.set([x, y, z, x, y, z], i * 6); end[i * 2 + 1] = 1; }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('aEnd', new T.BufferAttribute(end, 1));
    this.mat = new T.ShaderMaterial({ transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uCam: { value: new T.Vector3() }, uOpacity: { value: 0 } },
      vertexShader: `attribute float aEnd; uniform float uTime; uniform vec3 uCam; varying float vA;
        void main(){ float y = mod(position.y - uTime * 26.0, 34.0) - 10.0; float x = mod(position.x - uCam.x, 70.0) - 35.0; float z = mod(position.z - uCam.z, 70.0) - 35.0;
          vec3 p = vec3(uCam.x + x, uCam.y + y, uCam.z + z) + vec3(0.6, 26.0, 0.3) * 0.045 * aEnd;
          vA = (1.0 - aEnd * 0.7) * smoothstep(35.0, 6.0, length(vec2(x, z))); if (p.y < 0.0) vA = 0.0;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
      fragmentShader: `uniform float uOpacity; varying float vA; void main(){ gl_FragColor = vec4(vec3(0.65,0.75,0.95) * 1.4, vA * uOpacity); }` });
    this.mesh = new T.LineSegments(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
  }
  update(o, camera, time) { this.mat.uniforms.uTime.value = time; this.mat.uniforms.uCam.value.copy(camera.position); this.mat.uniforms.uOpacity.value = 0.32 * o.rain; this.mesh.visible = o.rain > 0.03; }
}
