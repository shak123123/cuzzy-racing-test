// Real 3D car models carried over from the first game (Mirza Racing / Mirza Racing Online):
//   db9v          — Aston Martin DB9 Volante OBJ with its own texture set (roof down, cream interior, driver)
//   rrs23/rrsd300 — Range Rover Sport GLB (previous-generation SVR body; not an exact 2023 body)
//   box986        — Porsche Boxster 986 GLB
// Assembly (material mapping, wheel pivots, scale to real length) is ported from the first game's assembleDB9 /
// assembleGLB. Output matches carmodel.js buildCar(): root.userData.{wheels, body, lights, paint, dims, blob}.
// Forward is -Z here (first game used +Z), so every model is turned 180°.
import * as THREE from 'three';
import { OBJLoader } from './lib/addons/loaders/OBJLoader.js';
import { GLTFLoader } from './lib/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from './lib/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from './lib/addons/utils/BufferGeometryUtils.js';

const BASE = './real/car/';
// bespoke first-game models for their own cars; every other car borrows a model by body type (see keyFor)
const MODEL_OF = { db9v: 'db9', rrs23: 'rrs', rrsd300: 'rrs', box986: 'box' };
const PROCEDURAL = new Set(['gti8', 'r6a']); // no realistic free Golf model: gti8 keeps its detailed procedural Mk8 body (carmodel.js)
const NATIVE = new Set(['db9', 'rrs', 'box']);
// nearest body types (used when the per-type model for a car's own body type is missing)
const NEAR = { hatch3: ['hatch5', 'classicmini', 'boxy'], hatch5: ['hatch3', 'estate', 'crossover', 'boxy'], classicmini: ['hatch3', 'boxy', 'hatch5'],
  boxy: ['hatch3', 'hatch5', 'saloon'], saloon: ['fastback', 'estate', 'coupe', 'hatch5'], fastback: ['saloon', 'coupe', 'estate'], estate: ['saloon', 'hatch5', 'fastback'],
  coupe: ['gt', 'fastback', 'muscle', 'saloon'], gt: ['coupe', 'fastback', 'muscle'], muscle: ['coupe', 'gt', 'fastback'], mid: ['hyper', 'rear', 'roadster', 'coupe'],
  hyper: ['mid', 'rear', 'coupe'], rear: ['coupe', 'mid', 'gt'], roadster: ['coupe', 'mid', 'gt'], suv: ['crossover', 'offroad'], crossover: ['suv', 'hatch5'], offroad: ['suv', 'crossover'] };
// ultimate fallback: one of the three first-game bodies, stretched to the car's real size
const FALLBACK = { gt: 'db9', coupe: 'db9', muscle: 'db9', saloon: 'db9', fastback: 'db9', mid: 'box', hyper: 'box', rear: 'box', roadster: 'box',
  hatch3: 'rrs', hatch5: 'rrs', classicmini: 'rrs', boxy: 'rrs', estate: 'rrs', suv: 'rrs', crossover: 'rrs', offroad: 'rrs' };
const PROTO = {}; const LOADS = {}; let BLOB_TEX = null;
let TYPES = null, typesAt = -1e9, typesReq = null, typesTried = false; // manifest client/real/car/types.json: { type: {file, forward, wheels, paint, eye...} }
const TL = new THREE.TextureLoader();
const texCache = {};
const carT = n => { if (texCache[n]) return texCache[n]; const t = TL.load(BASE + n); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return (texCache[n] = t); };
let CARS = {}; export function registerCars(list) { for (const c of list) CARS[c.id] = c; } // lets id-only lookups (realReady) know body types

// user: only mid-to-high quality models — the stylised low-poly CC0 per-type models are not used
const USE_TYPES = new Set(['mid']);
function normTypes(j) { const o = {}; const list = Array.isArray(j) ? j : Array.isArray(j?.types) ? j.types : Object.entries(j || {}).map(([k, v]) => ({ type: k, ...(typeof v === 'object' ? v : { file: v }) }));
  for (const e of list) { if (e && e.car && e.ok !== false) { o['car_' + e.car] = { ...e, file: (e.file || `car_${e.car}.glb`) + (e.v ? '?v=' + e.v : '') }; continue; } // a car's own model (user-supplied)
    if (e && e.type && e.ok !== false && USE_TYPES.has(e.type)) o[e.type] = { ...e, file: e.file || `type_${e.type}.glb` }; } return o; }
// fetch the manifest (re-polled every 20 s until it exists, then every 2 min so newly downloaded types show up)
export function loadTypes() {
  const now = performance.now(); if (typesReq) return typesReq;
  if (now - typesAt < (TYPES && Object.keys(TYPES).length ? 120000 : 20000)) return Promise.resolve(TYPES); typesAt = now;
  return (typesReq = fetch(BASE + 'types.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => { if (j) TYPES = normTypes(j); }).catch(() => {}).then(() => { typesReq = null; typesTried = true; return TYPES; }));
}
// true while the manifest has not answered yet for a car that takes a per-type model: its key would otherwise resolve to the
// FALLBACK body (e.g. the Boxster for r8/hurac/avent/f458) and, once that fallback happened to be loaded, the car kept it.
function typesPending(car) { return !!car && !typesTried && !PROCEDURAL.has(car.id) && !MODEL_OF[car.id]; }
function keyFor(car) {
  if (!car || PROCEDURAL.has(car.id)) return null; if (MODEL_OF[car.id]) return MODEL_OF[car.id];
  const T = TYPES || {}; if (T['car_' + car.id]) return 'type_car_' + car.id; for (const t of [car.body, ...(NEAR[car.body] || [])]) if (T[t]) return 'type_' + t;
  return FALLBACK[car.body] || 'db9';
}
// bounding box of the VISIBLE meshes only (Box3.setFromObject also counts hidden ones, e.g. a model's hidden plate or
// shadow planes, which pushed the concept car's tyres 0.13 m above the road and squashed its body height)
function visBox(root) { root.updateMatrixWorld(true); const b = new THREE.Box3();
  root.traverse(o => { if (!o.isMesh) return; for (let p = o; p; p = p.parent) if (!p.visible) return; const m = o.material; if (m && !Array.isArray(m) && m.visible === false) return;
    const pa = o.geometry.attributes.position; if (!pa) return; const st = Math.max(1, Math.floor(pa.count / 40000)); // per vertex: a rotated node's transformed
    for (let i = 0; i < pa.count; i += st) b.expandByPoint(_v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld)); }); return b; } // box overestimates (tyres by 0.13 m)
const _v = new THREE.Vector3(), _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3();
const carOf = x => (typeof x === 'string' ? CARS[x] : x);
export function modelKey(x) { return keyFor(carOf(x)); }
export function hasRealModel(x) { return !!keyFor(carOf(x) || { id: x, body: 'gt' }); }
// strip maker badges (small separate chrome / trim parts at the very front or rear, near the centre line)
function debadge(root) {
  root.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(root), sz = bb.getSize(new THREE.Vector3()), c0 = bb.getCenter(new THREE.Vector3());
  const L = sz.z >= sz.x ? 'z' : 'x', W = L === 'z' ? 'x' : 'z', v = new THREE.Vector3(); let removed = 0;
  root.traverse(m => { if (!m.isMesh || !m.geometry.index) return; const mn = (Array.isArray(m.material) ? m.material[0] : m.material)?.name || '';
    if (!/Details_MAT|Details_EXT|Base_014/.test(mn)) return; const g = m.geometry, P = g.attributes.position, I = g.index.array, n = P.count;
    const key = new Map(), id = new Int32Array(n); for (let i = 0; i < n; i++) { const k = Math.round(P.getX(i) * 1e4) + ',' + Math.round(P.getY(i) * 1e4) + ',' + Math.round(P.getZ(i) * 1e4); let q = key.get(k); if (q == null) key.set(k, q = key.size); id[i] = q; }
    const par = new Int32Array(key.size).map((_, i) => i), fd = x => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
    for (let t = 0; t < I.length; t += 3) { const a = fd(id[I[t]]), b = fd(id[I[t + 1]]), c = fd(id[I[t + 2]]); par[b] = a; par[fd(c)] = a; }
    const box = new Map(); for (let i = 0; i < n; i++) { const r = fd(id[i]); v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld); let B = box.get(r); if (!B) box.set(r, B = new THREE.Box3()); B.expandByPoint(v); }
    const drop = new Set(); for (const [r, B] of box) { const s = B.getSize(new THREE.Vector3()), c = B.getCenter(new THREE.Vector3()); const ends = Math.min(Math.abs(B.max[L] - bb.max[L]), Math.abs(B.min[L] - bb.min[L]));
      if (Math.max(s.x, s.y, s.z) < 0.34 && Math.abs(c[W] - c0[W]) < sz[W] * 0.3 && ends < 0.3 && c.y - bb.min.y > sz.y * 0.32) drop.add(r); }
    if (!drop.size) return; const ni = []; for (let t = 0; t < I.length; t += 3) if (!drop.has(fd(id[I[t]]))) ni.push(I[t], I[t + 1], I[t + 2]); removed += (I.length - ni.length) / 3; g.setIndex(ni); });
  console.log('debadge removed tris', removed);
}
function loadKey(k) {
  if (PROTO[k]) return Promise.resolve(true); if (LOADS[k]) return LOADS[k];
  const gl = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const file = k === 'db9' ? 'db9.obj' : NATIVE.has(k) ? k + '.glb' : TYPES?.[k.slice(5)]?.file;
  if (!file) return Promise.resolve(false);
  return (LOADS[k] = new Promise(res => {
    // never leaves a caller waiting: parse / decode errors, a model with no meshes, or a stalled download (60 s) resolve false
    let done = false; const fail = e => { if (done) return; done = true; clearTimeout(to); if (e) console.warn('car model', k, 'failed:', e?.message || e); delete LOADS[k]; res(false); };
    const ok = o => { if (done) return; if (TYPES?.[k.slice(5)]?.debadge) try { debadge(o); } catch (e) { console.warn('debadge', e.message); } let n = 0; o.traverse(m => { if (m.isMesh && m.geometry?.attributes?.position) n++; }); if (!n) return fail('no meshes'); done = true; clearTimeout(to); PROTO[k] = o; res(true); };
    const to = setTimeout(() => fail('timeout'), 60000);
    try {
      if (k === 'db9') new OBJLoader().load(BASE + file, o => { try { o.traverse(m => { if (m.isMesh && m.material && !Array.isArray(m.material) && !m.material.name) m.material.name = m.name; }); ok(o); } catch (e) { fail(e); } }, undefined, fail);
      else gl.load(BASE + file, g => { try { ok(g.scene); } catch (e) { fail(e); } }, undefined, fail);
    } catch (e) { fail(e); }
  }));
}
// lazily load the model a car needs (manifest first); resolves true when buildRealCar can use a real model for it.
// If a per-type model fails, the car falls back to its first-game body (FALLBACK) instead.
export async function ensureRealModel(x) {
  const car = carOf(x); if (!car) return false; if (!MODEL_OF[car.id]) await loadTypes();
  const k = keyFor(car); if (!k) return false; if (await loadKey(k)) return true;
  if (k.startsWith('type_') && TYPES) { delete TYPES[k.slice(5)]; return loadKey(keyFor(car)); }
  return false;
}
// Wheel choices for the real models: the rims keep their own shape and take a finish instead (the procedural 'wheel'
// styles are other rim shapes). Keys are the same saved custom.wheel values; five/unset = the model's own rims.
const RIM = { multi: [0xd9dce0, 0.95, 0.2], y: [0x3a3d43, 0.8, 0.32], black: [0x0b0c0d, 0.55, 0.24], classic5: [0xb8912f, 0.95, 0.24] };
export const REAL_RIM_LABELS = { five: 'Stock rims', multi: 'Bright silver rims', y: 'Graphite rims', black: 'Gloss black rims', classic5: 'Gold rims' };
function rimMat(style) { const r = RIM[style]; return r ? new THREE.MeshPhysicalMaterial({ color: r[0], metalness: r[1], roughness: r[2], clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.4 }) : null; }
export function realReady(x) { const c = carOf(x) || { id: x, body: 'gt' }; if (typesPending(c)) return false; const k = keyFor(c); return !!(k && PROTO[k]); }
// startup: the manifest plus the models of the given cars only (others load when a car of that type is shown or driven)
export function preloadRealCars(ids = ['db9v']) { return Promise.all(ids.map(id => ensureRealModel(id))); }

// ---- hyper-real material kit (shared with carmodel.js) ------------------------------------------------------------
// Car paint = MeshPhysicalMaterial base coat + clearcoat (IOR 1.5). A small shader patch adds, in car-root space (so it
// is stable on the body and independent of the model's UVs / scale): metallic flake (per-mm-cell normal jitter on the base
// coat only, faded out when a flake is under a pixel so it never shimmers), faint roughness mottling, metallic flop
// (the colour darkens towards grazing angles, which also reads as edge / panel-curvature darkening), road grime on the
// lower body, and in rain: wetter clearcoat with rain beads on the clearcoat normal. Uniforms are per car.
const GLSL_HASH = `
vec3 cz_h33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float cz_vn(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = cz_h33(i).x, b = cz_h33(i + vec3(1,0,0)).x, c = cz_h33(i + vec3(0,1,0)).x, d = cz_h33(i + vec3(1,1,0)).x;
  float e = cz_h33(i + vec3(0,0,1)).x, g = cz_h33(i + vec3(1,0,1)).x, h = cz_h33(i + vec3(0,1,1)).x, k = cz_h33(i + vec3(1,1,1)).x;
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z); }
`;
export function carFxUniforms(opts = {}) {
  return { uRootInv: { value: new THREE.Matrix4() }, uFlake: { value: opts.flake ?? 0.3 }, uFlop: { value: opts.flop ?? 0.6 }, uDirt: { value: 0.12 }, uWet: { value: 0 } };
}
const _inv = new THREE.Matrix4();
// shader patch for car paint (detail: 0 = flop only, 1 = + flake/grime, 2 = + rain beads)
export function patchPaint(mat, U, detail = 2) {
  mat.userData.fx = U;
  mat.customProgramCacheKey = () => 'czpaint' + detail;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform mat4 uRootInv; varying vec3 vCarP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCarP = (uRootInv * modelMatrix * vec4(transformed, 1.0)).xyz;');
    let f = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uFlake, uFlop, uDirt, uWet; uniform mat3 normalMatrix; varying vec3 vCarP;' + GLSL_HASH);
    f = f.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      float czG = 0.0;
      ${detail >= 1 ? `{ float lo = 1.0 - smoothstep(0.1, 0.55, vCarP.y); float n = cz_vn(vCarP * vec3(9.0, 22.0, 9.0)) * 0.6 + cz_vn(vCarP * 41.0) * 0.4;
        czG = clamp(lo * uDirt * (0.55 + 0.9 * n), 0.0, 0.85); }
      roughnessFactor *= 0.9 + 0.2 * cz_vn(vCarP * 7.0);` : ''}
      roughnessFactor = mix(roughnessFactor, 0.85, czG * (1.0 - 0.6 * uWet));
      roughnessFactor *= 1.0 - 0.35 * uWet;`);
    f = f.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      ${detail >= 1 ? `{ vec3 fp = vCarP * 650.0; vec3 j = cz_h33(floor(fp)) - 0.5; float fw = length(fwidth(fp));
        normal = normalize(normal + (normalMatrix * j) * uFlake * (1.0 - smoothstep(0.5, 2.0, fw)) * (1.0 - czG)); }` : ''}
      { float nv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0); diffuseColor.rgb *= mix(uFlop, 1.0, pow(nv, 0.55)); }
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.11, 0.09) * (1.0 - 0.45 * uWet), czG);`);
    f = f.replace('#include <clearcoat_normal_fragment_maps>', `#include <clearcoat_normal_fragment_maps>
      ${detail >= 2 ? `if (uWet > 0.01) { vec3 dp = vCarP * 55.0; vec3 c = floor(dp); vec3 r = cz_h33(c); vec3 q = fract(dp) - 0.25 - 0.5 * r; float d = length(q);
        float rad = 0.12 + 0.2 * r.z; float fw = length(fwidth(dp)); float m = (1.0 - smoothstep(rad * 0.8, rad, d)) * step(0.35, r.x) * uWet * (1.0 - smoothstep(0.2, 0.7, fw));
        clearcoatNormal = normalize(clearcoatNormal + (normalMatrix * q) * (m * 2.2 / rad)); }` : ''}`);
    // horizon / ground occlusion of the reflections: reflected rays that point below the horizon see the road and the car's
    // own underside (not sky), and the lower body is shadowed by the car and ground; the clearcoat keeps a little more
    f = f.replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
      #if defined( RE_IndirectSpecular )
      { vec3 czR = inverseTransformDirection( reflect( -geometryViewDir, geometryNormal ), viewMatrix );
        float czHo = mix( 0.35, 1.0, smoothstep( -0.3, 0.1, czR.y ) ) * mix( 0.6, 1.0, smoothstep( 0.12, 0.75, vCarP.y ) );
        radiance *= czHo; clearcoatRadiance *= mix( czHo, 1.0, 0.3 ); }
      #endif`);
    f = f.replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\n material.clearcoat *= 1.0 - czG * 0.8; material.clearcoatRoughness = mix(material.clearcoatRoughness, 0.0, uWet);\n#endif');
    sh.fragmentShader = f;
  };
  return mat;
}
// hook the per-car uniforms to the car root (matrix refreshed at most once per frame per car, just before drawing)
export function attachCarFx(root, mats) {
  const Us = [...new Set(mats.filter(m => m && m.userData.fx).map(m => m.userData.fx))]; if (!Us.length) return;
  root.userData.fx = Us; let last = -1;
  const upd = r => { const f = r?.info?.render?.frame ?? -2; if (f === last && f !== -2) return; last = f; root.updateWorldMatrix(true, false); _inv.copy(root.matrixWorld).invert(); for (const U of Us) U.uRootInv.value.copy(_inv); };
  root.traverse(o => { if (!o.isMesh) return; const ms = Array.isArray(o.material) ? o.material : [o.material]; if (ms.some(m => m && m.userData.fx)) o.onBeforeRender = upd; });
}
// reflective special paints: stored as ordinary 24-bit colour ids (saved / charged / sent to the lobby like any other
// colour); the id picks a full material recipe (base tint, metalness, roughness, clearcoat, env strength, flake / flop)
export const SPECIAL_PAINTS = { // all five are free (0 cr, server.py 'custom' too); mirror-gloss clearcoat so the world reflects in the body
  // Liquid Chrome / Mirror Gold stay true mirrors; the others are real paint: a blurry metallic-flake base (roughness ~0.3-0.4)
  // under a sharp clearcoat whose Fresnel (F0 0.04) makes it faint face-on and mirror-like only at grazing angles
  0xd5d9de: { name: 'Liquid Chrome', color: 0xf2f4f7, metalness: 1, roughness: 0.02, clearcoat: 1, clearcoatRoughness: 0.015, env: 1.8, flake: 0, flop: 0.2 },
  0xd8a73c: { name: 'Mirror Gold', color: 0xffc860, metalness: 1, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.015, env: 1.7, flake: 0, flop: 0.25 },
  0x9c0616: { name: 'Candy Red', color: 0xa0000c, metalness: 0.6, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.02, env: 1.3, flake: 0.28, flop: 0.9 },
  0xf5f2eb: { name: 'Pearl White', color: 0xf6f3ec, metalness: 0.25, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.022, env: 1.2, flake: 0.22, flop: 0.35, iridescence: 0.45 },
  0x141517: { name: 'Satin Black', color: 0x131416, metalness: 0.5, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.025, env: 1.25, flake: 0.06, flop: 0.5 },
};
// price of a paint change (mirrors server.py): the reflective special paints are free, other colours 500 cr
export function paintCost(colour) { return SPECIAL_PAINTS[colour] ? 0 : 500; }
// factory default = high-gloss reflective metallic (fine flake, low base roughness, mirror clearcoat, strong env reflection)
export const FACTORY_GLOSS = { metalness: 0.35, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.035, env: 1.25, flake: 0.08, flop: 0.35 }; // clearer reflections without extra cube renders; special chrome/gold unchanged
export function carPaint(colour, metallic, detail = 2, extra = {}) {
  const sp = SPECIAL_PAINTS[colour];
  if (sp) { const m = new THREE.MeshPhysicalMaterial({ ior: 1.5, ...extra, color: sp.color, metalness: sp.metalness, roughness: sp.roughness, clearcoat: sp.clearcoat, clearcoatRoughness: sp.clearcoatRoughness, envMapIntensity: sp.env, ...(sp.iridescence ? { iridescence: sp.iridescence, iridescenceIOR: 1.35, iridescenceThicknessRange: [260, 420] } : {}) });
    m.userData.special = colour; return patchPaint(m, carFxUniforms({ flake: sp.flake, flop: sp.flop }), detail); }
  const F = FACTORY_GLOSS; const { envMapIntensity: _e, ...ex } = extra; // callers' env strength is replaced by the gloss recipe
  const m = new THREE.MeshPhysicalMaterial({ color: colour, metalness: metallic ? F.metalness : 0.0, roughness: metallic ? F.roughness : 0.42, ior: 1.5, clearcoat: 1, clearcoatRoughness: F.clearcoatRoughness, envMapIntensity: metallic ? F.env : 1.0, ...ex });
  return patchPaint(m, carFxUniforms({ flake: metallic ? F.flake : 0.0, flop: metallic ? F.flop : 0.8 }), detail);
}
// glass: fresnel-driven alpha (see-through face-on, mirror-like at grazing angles like real glazing), IOR 1.52.
// trans = true: physical transmission (refracts the scene behind; costs an extra opaque pass) — high detail, showroom / ultra
export function carGlass(tinted, trans = false) {
  if (trans) return new THREE.MeshPhysicalMaterial({ color: tinted ? 0x3a4046 : 0x9aa4ac, metalness: 0, roughness: 0.015, ior: 1.52, transmission: 1, thickness: 0.004, attenuationColor: new THREE.Color(tinted ? 0x10161a : 0x5a6e72), attenuationDistance: tinted ? 0.004 : 0.02, specularIntensity: 1, envMapIntensity: 1.6, side: THREE.FrontSide, name: 'glass_tx' });
  const m = new THREE.MeshPhysicalMaterial({ color: tinted ? 0x05070a : 0x0c1216, metalness: 0, roughness: 0.02, ior: 1.52, transparent: true, opacity: tinted ? 0.82 : 0.5, envMapIntensity: 1.7, specularIntensity: 1, depthWrite: false, side: THREE.DoubleSide, name: 'glass' });
  m.customProgramCacheKey = () => 'czglass';
  m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
    { float nv = abs(dot(normalize(vNormal), normalize(vViewPosition))); float F = 0.04 + 0.96 * pow(1.0 - nv, 5.0); gl_FragColor.a = mix(gl_FragColor.a, 1.0, clamp(F * 1.4, 0.0, 1.0)); }`); };
  return m;
}
// tyre rubber: grain normal (tiled noise); when the geometry's UVs are known (procedural tyres) the sidewall lettering +
// tread grooves map (rubberN(true)) is used instead
let _rubN = {};
export function rubberN(lettered = false) {
  const k = lettered ? 'L' : 'G'; if (_rubN[k]) return _rubN[k];
  const W = lettered ? 1024 : 128, H = lettered ? 128 : 128; const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#808080'; g.fillRect(0, 0, W, H); let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < W * H / 6; i++) { const v = 118 + rnd() * 20 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(rnd() * W, rnd() * H, 1.5, 1.5); }
  if (lettered) { // lathe uv: x = around the tyre, y = across the profile (0/1 = rim edges, 0.5 = tread centre)
    g.fillStyle = '#5a5a5a'; for (const y of [0.43, 0.5, 0.57]) g.fillRect(0, y * H - 2, W, 4); // circumferential grooves
    for (let x = 0; x < W; x += 12) { g.fillRect(x, 0.39 * H, 3, 0.07 * H); g.fillRect(x + 6, 0.54 * H, 3, 0.07 * H); } // sipes
    g.fillStyle = '#9a9a9a'; g.font = 'bold 13px Arial'; g.textBaseline = 'middle';
    for (const [y, fl] of [[0.2, 1], [0.8, -1]]) for (let x = 0; x < W; x += 256) { g.save(); g.translate(x + 20, y * H); g.scale(1, fl); g.fillText('CUZZY  SPORT 245/40 ZR18', 0, 0); g.restore(); }
    g.fillStyle = '#909090'; for (const y of [0.1, 0.9]) g.fillRect(0, y * H - 1, W, 2); // rim-protector ribs
  }
  // height (grey) → tangent-space normal map
  const src = g.getImageData(0, 0, W, H).data, out = g.createImageData(W, H); const hgt = (x, y) => src[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const dx = (hgt(x + 1, y) - hgt(x - 1, y)) * 2.2, dy = (hgt(x, y + 1) - hgt(x, y - 1)) * 2.2, l = Math.hypot(dx, dy, 1), i = (y * W + x) * 4;
    out.data[i] = (-dx / l * 0.5 + 0.5) * 255; out.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; out.data[i + 3] = 255; }
  g.putImageData(out, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (!lettered) t.repeat.set(6, 6); t.anisotropy = 4; return (_rubN[k] = t);
}
export function carRubber(lettered = false) { return new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.9, metalness: 0, normalMap: rubberN(lettered), normalScale: new THREE.Vector2(0.6, 0.6), name: 'rubber' }); }
// contact shadow / ambient occlusion under the car: soft body footprint + darker tyre contact patches
const AO_CACHE = {};
export function contactShadow(W, L, wheels, R = 0.33) {
  const pw = W + 0.7, pl = L + 0.8; const key = [W, L, ...wheels.flat()].map(v => v.toFixed(2)).join();
  let tex = AO_CACHE[key];
  if (!tex) { const cw = 128, ch = Math.round(128 * pl / pw / 8) * 8, c = document.createElement('canvas'); c.width = cw; c.height = ch; const g = c.getContext('2d');
    const X = x => (x / pw + 0.5) * cw, Z = z => (z / pl + 0.5) * ch;
    const rr = (x, y, w, h, r) => { r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); g.fill(); };
    // soft footprint without canvas filters (not on older iOS): stacked, shrinking rounded rects
    for (let i = 0; i < 12; i++) { const k = 1.1 - i * 0.045, w = W * k / pw * cw, h = L * k * 0.97 / pl * ch; g.fillStyle = 'rgba(0,0,0,0.075)'; rr(cw / 2 - w / 2, ch / 2 - h / 2, w, h, Math.min(w, h) * 0.3); }
    for (const [x, z] of wheels) { g.save(); g.translate(X(x), Z(z)); g.scale(0.2 / pw * cw, R * 0.9 / pl * ch); const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, 7); g.fill(); g.restore(); }
    tex = AO_CACHE[key] = new THREE.CanvasTexture(c); }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, pl), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -10, polygonOffsetUnits: -20, toneMapped: false, color: 0xffffff }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.03; m.renderOrder = 1; return m;
}
// per-frame weather on a car: wet sheen / beads, grime, glossier wet tyres (called from setLights)
export function carWeather(root, wet) {
  const u = root.userData; const w = wet ? 1 : 0; if (u.wetNow === w) return; u.wetNow = w;
  for (const U of u.fx || []) { U.uWet.value = w; U.uDirt.value = wet ? 0.5 : 0.12; }
  for (const m of u.rubberMats || []) { m.roughness = wet ? 0.55 : 0.9; m.color.setHex(wet ? 0x0b0b0c : 0x121214); }
}

let _leatherN = null;
function leatherN() {
  if (_leatherN) return _leatherN; const S = 256, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  const h = new Float32Array(S * S); let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 700; k++) { const x = rnd() * S, y = rnd() * S, r = 2 + rnd() * 4, a = 0.4 + rnd() * 0.6;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const d = Math.hypot(dx, dy) / r; if (d > 1) continue; const X = (((x + dx) | 0) % S + S) % S, Y = (((y + dy) | 0) % S + S) % S; h[Y * S + X] += a * (1 - d * d); } }
  const im = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i = y * S + x, hx = h[y * S + (x + 1) % S] - h[y * S + (x - 1 + S) % S], hy = h[((y + 1) % S) * S + x] - h[((y - 1 + S) % S) * S + x];
    const nx = -hx * 0.9, ny = -hy * 0.9, l = Math.hypot(nx, ny, 1); im.data[i * 4] = (nx / l * 0.5 + 0.5) * 255; im.data[i * 4 + 1] = (ny / l * 0.5 + 0.5) * 255; im.data[i * 4 + 2] = (1 / l * 0.5 + 0.5) * 255; im.data[i * 4 + 3] = 255; }
  g.putImageData(im, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(14, 14); return (_leatherN = t);
}
const plateCache = {};
function plateTex(bg, txt = 'CUZZY') {
  const key = bg + txt; if (plateCache[key]) return plateCache[key];
  if (bg === 'classic') { const c = document.createElement('canvas'); c.width = 520; c.height = 111; const g = c.getContext('2d'); // pre-1973 UK: black plate, silver pressed characters
    g.fillStyle = '#0b0b0b'; g.fillRect(0, 0, 520, 111); g.strokeStyle = '#9a9a9a'; g.lineWidth = 4; g.strokeRect(5, 5, 510, 101); g.fillStyle = '#e2e2e2'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 78px "Arial Narrow",Arial,sans-serif'; g.save(); g.translate(260, 58); g.scale(Math.min(1, 470 / g.measureText(txt).width), 1.05); g.fillText(txt, 0, 0); g.restore();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return (plateCache[key] = t); }
  const c = document.createElement('canvas'); c.width = 520; c.height = 111; const g = c.getContext('2d');
  if (!g.roundRect) g.roundRect = function (x, y, w, h, r) { this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r); this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath(); }; // iOS < 16
  g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, 520, 111, 9); g.fill(); g.strokeStyle = '#111'; g.lineWidth = 3; g.beginPath(); g.roundRect(4, 4, 512, 103, 7); g.stroke();
  g.fillStyle = '#003399'; g.fillRect(7, 7, 46, 97); g.fillStyle = '#fff'; g.font = 'bold 22px Arial'; g.textAlign = 'center'; g.fillText('UK', 30, 88);
  g.fillStyle = '#111'; g.textBaseline = 'middle'; g.font = 'bold 80px "Arial Narrow",Arial,sans-serif'; g.save(); g.translate(288, 59); g.scale(0.95, 1.12); const fw = Math.min(1, 390 / g.measureText(txt).width); g.scale(fw, 1); g.fillText(txt, 0, 0); g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return (plateCache[key] = t);
}
// retro-reflective acrylic plate: glossy clearcoat over the printed face
function plateMesh(bg, txt, w = 0.52) { return new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.2135), new THREE.MeshPhysicalMaterial({ map: plateTex(bg, txt), roughness: 0.45, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 0.9 })); }
// physical transmission glass only at high car detail with the high/ultra look: showroom / menu, or in-race on ultra
export function wantTransmission(detail) { const A = globalThis.CUZZY, G = A?.settings?.graphics; return detail >= 2 && !!G && G.carDetail >= 2 && !A.session && !A._racing; } // showroom only: in a race transmission costs a second opaque scene pass

function buildMaterials(body, opts) {
  const metallic = opts.finish !== 'solid', detail = opts.detail ?? 2;
  const paint = carPaint(body, metallic, detail);
  const glass = carGlass(!!opts.tint, wantTransmission(detail));
  const chrome = new THREE.MeshStandardMaterial({ color: 0xeef0f2, metalness: 1, roughness: 0.07, envMapIntensity: 1.6 });
  const satin = new THREE.MeshStandardMaterial({ color: 0x2a2d31, metalness: 0.75, roughness: 0.35 });
  const matte = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.85, metalness: 0.1 });
  const rubber = detail > 0 ? carRubber(false) : new THREE.MeshStandardMaterial({ color: 0x121214, roughness: 0.9, metalness: 0 });
  const disc = new THREE.MeshStandardMaterial({ map: carT('brakdisc.png'), color: 0x8e9297, metalness: 1, roughness: 0.42 });
  const caliper = new THREE.MeshPhysicalMaterial({ color: opts.caliper ?? 0x1d1f22, metalness: 0, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.08 });
  const interior = new THREE.MeshPhysicalMaterial({ map: carT('interior_cream_hd.jpg'), roughness: 0.9, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.2, sheen: 0.4, sheenColor: new THREE.Color(0xfff1d6), envMapIntensity: 0.8, side: THREE.DoubleSide, normalMap: leatherN(), normalScale: new THREE.Vector2(0.55, 0.55) });
  const driver = new THREE.MeshStandardMaterial({ map: carT('driver.png'), roughness: 0.8, transparent: true, alphaTest: 0.5 });
  const misc = new THREE.MeshStandardMaterial({ map: carT('db9_misc.png'), roughness: 0.4, metalness: 0.5, transparent: true, alphaTest: 0.35 });
  const badge = new THREE.MeshStandardMaterial({ map: carT('db9_badging.png'), metalness: 1, roughness: 0.18, envMapIntensity: 2, transparent: true, alphaTest: 0.4 });
  const head = new THREE.MeshPhysicalMaterial({ map: carT('db9_headlight.png'), emissive: 0xf2f6ff, emissiveIntensity: 1.2, roughness: 0.12, metalness: 0.5 });
  const hglass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.02, transparent: true, opacity: 0.28, envMapIntensity: 2 });
  const tail = new THREE.MeshStandardMaterial({ map: carT('db9_brakelight.png'), color: 0xff3020, emissive: 0xff1508, emissiveIntensity: 1.4, roughness: 0.25, transparent: true, alphaTest: 0.3 });
  const doorline = new THREE.MeshStandardMaterial({ map: carT('doorline.png'), color: 0x101114, roughness: 0.6, transparent: true, alphaTest: 0.45 });
  const wheelLeather = new THREE.MeshPhysicalMaterial({ map: carT('db9_interior.png'), normalMap: leatherN(), roughness: 0.55, sheen: 0.3, clearcoat: 0.15 });
  // DB9 tyre inner back plate is a square quad masked to a disc by tireback.png: without the mask the square corners
  // stuck out past the tyre and swept through the arch / below the road as the wheel turned
  const tireBack = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.85, metalness: 0.1, alphaMap: carT('tireback.png'), alphaTest: 0.5, side: THREE.DoubleSide });
  const hidden = new THREE.MeshBasicMaterial({ visible: false }); // the model's own licence-plate faces (replaced by CUZZY plates)
  const M = { paint, glass, chrome, satin, matte, rubber, disc, caliper, interior, driver, misc, badge, head, hglass, tail, doorline, hidden };
  const map = {
    Body_paint: paint, Body_paint0: paint, Body_paint1: paint, Body_paint2: paint, Body_paint3: paint, Hood: paint, Base: paint, Mirror: chrome,
    glass, glass_rear: glass, Chrome: chrome, Chrome0: chrome, Chrome1: chrome, Chrome2: chrome, Badging_Chrome: badge,
    Black: matte, Bottom: matte, Material__607: matte, Material__613: chrome, Brake_Disc: disc, Brake_Disc0: disc, Brake_Pads: caliper, Brake_Pads0: caliper,
    Tire_Tread: rubber, Tire_Sidewall: rubber, Tire_Back: tireBack, Interior: interior, SteerWheel: wheelLeather, Driver: driver,
    Misc: misc, Misc0: misc, Misc1: misc, Misc2: misc, Misc3: misc, Misc4: misc, Misc5: misc,
    Material__602: head, HeadLights: head, HL_glass: hglass, Material__605: tail, DoorLine: doorline, License: hidden, License0: hidden };
  return { M, map };
}
function flipWinding(g) {
  const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
  for (let i = 0; i < p.count; i += 3) for (const a of [p, n, u]) { if (!a) continue; const s = a.itemSize; for (let k = 0; k < s; k++) { const t = a.array[(i + 1) * s + k]; a.array[(i + 1) * s + k] = a.array[(i + 2) * s + k]; a.array[(i + 2) * s + k] = t; } }
  p.needsUpdate = true;
}

// DB9: Z-up OBJ, front at -Y. Returns a Y-up group with +Z forward and wheel groups {FL,FR,RL,RR}
function assembleDB9(src, M, map, rim) {
  const wheelNames = ['TireFL', 'TireFR', 'TireRL', 'TireRR'];
  const wheels = { FL: new THREE.Group(), FR: new THREE.Group(), RL: new THREE.Group(), RR: new THREE.Group() };
  const chassis = new THREE.Group();
  src.traverse(o => {
    if (!o.isMesh) return; const m = o.clone(); const mn = (!Array.isArray(o.material) && o.material && o.material.name) || '';
    // multi-material OBJ groups (Body, Base, mirrors, lamps, brakes, wheels) carry one material per face group: map each
    // one, otherwise the whole body shell / wheels fell back to a flat satin grey and ignored the paint colour
    m.material = Array.isArray(o.material) ? o.material.map(x => map[x.name] || M.satin) : (map[mn] || M.satin); m.castShadow = true; m.receiveShadow = false;
    const nm = o.name || (o.parent && o.parent.name) || '';
    let bucket = chassis; const w = wheelNames.find(k => nm.includes(k)); if (w) bucket = wheels[w.slice(4)];
    if (w && rim) m.material = Array.isArray(m.material) ? m.material.map(x => x === M.chrome ? rim : x) : m.material === M.chrome ? rim : m.material;
    if (mn === 'Interior' || mn === 'Driver' || mn === 'SteerWheel') { m.geometry = m.geometry.clone(); m.geometry.scale(-1, 1, 1); flipWinding(m.geometry); }
    if (mn === 'License' || mn === 'License0') m.visible = false;
    bucket.add(m);
  });
  const root = new THREE.Group(); root.add(chassis); for (const k in wheels) root.add(wheels[k]);
  root.rotation.x = -Math.PI / 2;
  return { node: root, wheelNodes: wheels, chassis };
}
const GEO = {
  rrs: { paint: ['Color_B04'], glass: ['Material.002'], chrome: ['chrome', 'Chrome.002'], hglass: ['white_glass', 'Material.005'], rubber: ['Material.001'], tail: ['M_0020_Red'], caliper: ['calipers', 'BreaksRedPaint.001'],
    rim: ['Material.007', 'dark_rim'], disc: ['BreakDiscs.001'], pf: [0, 0.64, 2.46, -0.03], pr: [0, 1.0, -2.46, 0.05] },
  box: { paint: ['base_mat', 'fuel_door'], glass: ['glass'], chrome: ['_3', 'Material__12'], hglass: ['ftontlights'], rubber: ['tire', 'wheel'], tail: ['baclight_right', 'baclight_left'],
    rim: ['metal'], interior: ['interior'], pf: [0, 0.30, 2.17, -0.1], pr: [0, 0.52, -2.14, 0.08] } };
function assembleGLB(key, M, custRim) {
  const src = PROTO[key], G = GEO[key];
  const rim = (key === 'box' ? new THREE.MeshStandardMaterial({ color: 0xc6c9cd, metalness: 1, roughness: 0.24, envMapIntensity: 1.4 }) : new THREE.MeshPhysicalMaterial({ color: 0x0b0c0d, metalness: 0.55, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.1 }));
  let tail = new THREE.MeshStandardMaterial({ color: 0xd01a12, emissive: 0xff1508, emissiveIntensity: 1.4, roughness: 0.25 });
  if (key === 'box') { const t = carT('box_tail.jpg'); t.flipY = false; const e = carT('box_tail_e.jpg'); e.flipY = false; tail = new THREE.MeshPhysicalMaterial({ map: t, emissiveMap: e, color: 0xffffff, emissive: 0xff1508, emissiveIntensity: 1.4, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.02 }); }
  const inter = new THREE.MeshStandardMaterial({ color: key === 'box' ? 0x3a3b3e : 0x151515, roughness: 0.7 });
  const head = new THREE.MeshPhysicalMaterial({ color: 0xffffff, emissive: 0xf2f6ff, emissiveIntensity: 0.4, metalness: 0, roughness: 0.02, ior: 1.49, transparent: true, opacity: 0.55, envMapIntensity: 2 });
  const pick = n => { for (const [k, mat] of [['paint', M.paint], ['glass', M.glass], ['chrome', M.chrome], ['hglass', head], ['rubber', M.rubber], ['tail', tail], ['caliper', M.caliper], ['rim', rim], ['disc', M.disc], ['interior', inter]]) if (G[k] && G[k].includes(n)) return mat; return null; };
  const car = src.clone(true); const wg = {};
  car.traverse(o => {
    if (o.name && o.name.startsWith('W_')) wg[o.name.slice(2)] = o;
    if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = false;
    const conv = m => { const p = pick(m.name); if (p) return p; const c = m.color ? m.color.getHex() : 0x222222; return new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.2, transparent: m.transparent, opacity: m.opacity }); };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
  });
  if (custRim) for (const n of Object.values(wg)) n.traverse(o => { if (!o.isMesh) return; const sw = x => (x === rim || x === M.chrome ? custRim : x); o.material = Array.isArray(o.material) ? o.material.map(sw) : sw(o.material); }); // only the wheels (the Boxster's roll hoops share the rim metal)
  M.tail = tail; M.head = head; M.rim = custRim || rim; M.rimStock = rim;
  return { node: car, wheelNodes: wg, plates: { pf: G.pf, pr: G.pr } };
}

// ---- generic pipeline helpers -------------------------------------------------------------------------------------
// GLBs are quantized (int16 etc.): de-quantize to Float32 before baking transforms into the geometry
function toFloat(g) {
  for (const k of Object.keys(g.attributes)) { const a = g.attributes[k]; if (a.array instanceof Float32Array && !a.isInterleavedBufferAttribute && !a.normalized) continue;
    const f = new Float32Array(a.count * a.itemSize); for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = c === 0 ? a.getX(i) : c === 1 ? a.getY(i) : c === 2 ? a.getZ(i) : a.getW(i);
    g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize)); }
  return g;
}
// a mesh's geometry in root space (de-quantized copy)
function toRoot(o, inv) { const g = toFloat(o.geometry.clone()); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)); return g; }
// non-indexed sub-geometry holding the given triangles (indices into a non-indexed geometry)
function subGeo(g, tris) {
  const out = new THREE.BufferGeometry();
  for (const k of Object.keys(g.attributes)) { const a = g.attributes[k], s = a.itemSize, f = new Float32Array(tris.length * 3 * s);
    tris.forEach((t, j) => { for (let v = 0; v < 3; v++) for (let c = 0; c < s; c++) f[(j * 3 + v) * s + c] = a.array[(t * 3 + v) * s + c]; }); out.setAttribute(k, new THREE.BufferAttribute(f, s)); }
  return out;
}
// bake a wheel's parts ({g in root space, m}) into a pivot (at the wheel centre, steers about Y) + spin group (rolls about X).
// round: when the body was stretched non-uniformly, the wheel is rescaled so it stays circular (no wobble when it spins)
// axle direction of a wheel = the direction of least spread of its vertices (tyre + rim form a disc)
function axleOf(parts, c) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; let n = 0; const v = new THREE.Vector3();
  for (const { g } of parts) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).sub(c); const a = [v.x, v.y, v.z]; for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) C[r][k] += a[r] * a[k]; n++; } }
  if (!n) return null; const tr = C[0][0] + C[1][1] + C[2][2]; const B = C.map((row, r) => row.map((x, k) => (r === k ? tr : 0) - x)); // largest eigenvector of B = smallest of C
  let x = new THREE.Vector3(1, 0, 0); for (let it = 0; it < 60; it++) { const y = new THREE.Vector3(B[0][0] * x.x + B[0][1] * x.y + B[0][2] * x.z, B[1][0] * x.x + B[1][1] * x.y + B[1][2] * x.z, B[2][0] * x.x + B[2][1] * x.y + B[2][2] * x.z); const l = y.length(); if (l < 1e-12) return null; x = y.multiplyScalar(1 / l); }
  return x.x < 0 ? x.negate() : x;
}
// axle + hub of a wheel from its tyre. Only the tyre's own faces are used (materials named tyre/tire/rubber/tread/
// sidewall; per material group for multi-material meshes; alpha-masked parts such as the DB9's square back plate are
// skipped): a tyre is a torus, so its least-spread direction is the true axle and its centroid the true hub. The whole
// wheel's spread (rims, discs, bolts are denser on the outer face) pulled the old estimate 1-4 deg off: visible wobble.
// Without named tyre faces: the outer band (> 88% of the largest radius) of the whole wheel, refined from the old estimate.
const TYRE_RX = /tyre|tire|rubber|tread|sidewall/i;
function wheelPoints(parts, want) {
  const P = []; const v = new THREE.Vector3();
  for (const { g, m } of parts) { const pos = g.attributes.position, idx = g.index; const mats = Array.isArray(m) ? m : [m];
    const ok = mm => mm && !(mm.alphaMap || mm.alphaTest > 0 || mm.visible === false) && want(mm);
    if (Array.isArray(m) && g.groups.length) { const seen = new Uint8Array(pos.count); for (const gr of g.groups) { if (!ok(mats[gr.materialIndex ?? 0])) continue; const end = Math.min(gr.start + gr.count, idx ? idx.count : pos.count);
        for (let k = gr.start; k < end; k++) { const i = idx ? idx.getX(k) : k; if (seen[i]) continue; seen[i] = 1; P.push(v.fromBufferAttribute(pos, i).clone()); } } }
    else if (ok(mats[0])) for (let i = 0; i < pos.count; i++) P.push(v.fromBufferAttribute(pos, i).clone()); }
  return P;
}
function leastAxis(P, mu, start) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const q of P) { const d = [q.x - mu.x, q.y - mu.y, q.z - mu.z]; for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) C[r][k] += d[r] * d[k]; }
  const tr = C[0][0] + C[1][1] + C[2][2]; const B = C.map((row, r) => row.map((x, k) => (r === k ? tr : 0) - x)); let x = start.clone();
  for (let k = 0; k < 100; k++) { const y = new THREE.Vector3(B[0][0] * x.x + B[0][1] * x.y + B[0][2] * x.z, B[1][0] * x.x + B[1][1] * x.y + B[1][2] * x.z, B[2][0] * x.x + B[2][1] * x.y + B[2][2] * x.z); const l = y.length(); if (l < 1e-12) return null; x = y.multiplyScalar(1 / l); }
  return x.x < 0 ? x.negate() : x;
}
function treadAxle(parts, c0) {
  let P = wheelPoints(parts, mm => TYRE_RX.test(mm.name || ''));
  if (P.length >= 24) { const mu = P.reduce((a, q) => a.add(q), new THREE.Vector3()).multiplyScalar(1 / P.length); const ax = leastAxis(P, mu, new THREE.Vector3(1, 0, 0)); return ax && ax.x > 0.6 ? { ax, c: mu } : null; }
  P = wheelPoints(parts, () => true); if (P.length < 24) return null;
  let ax = axleOf(parts, c0) || new THREE.Vector3(1, 0, 0), c = c0.clone();
  for (let it = 0; it < 3; it++) {
    const rad = q => { const d = q.clone().sub(c); return d.sub(ax.clone().multiplyScalar(d.dot(ax))).length(); };
    let Rm = 0; for (const q of P) Rm = Math.max(Rm, rad(q)); const band = P.filter(q => rad(q) > 0.88 * Rm); if (band.length < 12) return null;
    const mu = band.reduce((a, q) => a.add(q), new THREE.Vector3()).multiplyScalar(1 / band.length); const x = leastAxis(band, mu, ax); if (!x || x.x < 0.6) return null; ax = x;
    const d = mu.clone().sub(c); c = c.clone().add(d.sub(ax.clone().multiplyScalar(d.dot(ax))));
  }
  return { ax, c };
}
// unS: the non-uniform scale that stretched the borrowed body to the car's real size. The wheel is first un-stretched (so it
// is the model's own round wheel again), turned straight, then scaled uniformly to the stretched wheel's size.
function bakeParts(parts, round, extra = [], unS = null) {
  const bb = new THREE.Box3(); const box = () => { bb.makeEmpty(); for (const { g } of parts) { g.computeBoundingBox(); bb.union(g.boundingBox); } };
  const about = (c, m) => { const M = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(m).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z)); for (const { g } of [...parts, ...extra]) g.applyMatrix4(M); };
  box(); let c = bb.getCenter(new THREE.Vector3()); let size = bb.getSize(new THREE.Vector3()); const dT = (size.y + size.z) / 2, wT = size.x;
  if (unS) { about(c, new THREE.Matrix4().makeScale(1 / unS.x, 1 / unS.y, 1 / unS.z)); box(); c = bb.getCenter(new THREE.Vector3()); size = bb.getSize(new THREE.Vector3()); }
  { // some models have their wheels modelled already turned (the concept car's wheels: up to ~20 deg of toe) or cambered:
    // turn the wheel back so its axle is the X axis. Otherwise it points off-line at zero steer and wobbles as it spins about X.
    // The axle and hub come from the tyre's outer band (see treadAxle), not the whole wheel's vertex spread: rims, discs,
    // bolts and masked back plates are denser on one face and pulled the old estimate 1-4 deg off (visible wobble).
    for (let it = 0; it < 3; it++) { const T = treadAxle(parts, c); if (!T) break; const ax = T.ax; const ang = Math.acos(Math.min(1, ax.x));
      if (ang > 0.005 && ang < 0.8) about(c, new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(ax, new THREE.Vector3(1, 0, 0)))); else break;
      box(); c = bb.getCenter(new THREE.Vector3()); }
    box(); c = bb.getCenter(new THREE.Vector3()); size = bb.getSize(new THREE.Vector3()); // hub = centre of the straightened wheel's box
  }
  if (unS) { const k = dT / Math.max(1e-6, (size.y + size.z) / 2); about(c, new THREE.Matrix4().makeScale(unS.x, k, k)); box(); c = bb.getCenter(new THREE.Vector3()); size = bb.getSize(new THREE.Vector3()); round = false; }
  const pivot = new THREE.Group(); pivot.position.copy(c); const spin = new THREE.Group(); pivot.add(spin);
  const d = (size.y + size.z) / 2;
  for (const { g, m } of parts) { g.translate(-c.x, -c.y, -c.z); if (round && size.y > 0 && size.z > 0) g.scale(1, d / size.y, d / size.z); g.computeBoundingSphere(); const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; spin.add(mesh); }
  return { pivot, spin, R: (round || unS ? d : Math.max(size.y, size.z)) / 2, W: size.x };
}
function bakeWheel(node, root, round, unS) {
  root.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const parts = [], cal = []; node.traverse(o => { if (!o.isMesh || !o.visible) return; const nm = o.name + ' ' + (o.parent?.name || ''), mn = o.material?.name || ''; const isCal = /calip|brake.?pad|details_brake/i.test(nm + ' ' + mn) || /^brake$/i.test(mn); (isCal ? cal : parts).push({ g: toRoot(o, inv), m: o.material }); });
  node.parent?.remove(node); if (!parts.length) return null; const w = bakeParts(parts, round, cal, unS);
  for (const { g } of cal) { g.translate(-w.pivot.position.x, -w.pivot.position.y, -w.pivot.position.z); const m = new THREE.Mesh(g, CAL_SLOT); m.userData.caliper = true; w.pivot.add(m); } w.hasCal = cal.length > 0; return w;
}
const CAL_SLOT = new THREE.MeshStandardMaterial(); // placeholder, swapped for the car's caliper material
const quad = (x, z, C) => (z < C.z ? 'F' : 'R') + (x < C.x ? 'L' : 'R');
// Auto-detect wheels in a model without named wheel nodes: the four low mesh clusters near the corners. Meshes that
// hold several wheels (e.g. all four tyres in one mesh) are split by triangle. Returns {FL:[{g,m}],..} or null.
function detectWheels(meshes, root, B) {
  root.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const S = B.getSize(new THREE.Vector3()), C = B.getCenter(new THREE.Vector3());
  const lowY = B.min.y + 0.55 * S.y; const corner = (x, z) => Math.abs(x - C.x) > 0.18 * S.x && Math.abs(z - C.z) > 0.2 * S.z;
  const cands = { FL: [], FR: [], RL: [], RR: [] }; const split = [];
  for (const o of meshes) {
    const bb = new THREE.Box3().setFromObject(o); const sz = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
    if (bb.max.y > lowY) continue;
    if (sz.z < 0.36 * S.z && sz.x < 0.4 * S.x && corner(c.x, c.z)) { cands[quad(c.x, c.z, C)].push({ o, bb }); continue; }
    if (sz.y < 0.6 * S.y) split.push(o); // spans several corners: maybe several wheels in one mesh
  }
  const pieces = { FL: [], FR: [], RL: [], RR: [] }; const cut = new Map();
  for (const o of split) {
    let g = toRoot(o, inv); if (g.index) g = g.toNonIndexed(); const p = g.attributes.position, n = p.count / 3;
    const mats = Array.isArray(o.material) ? o.material : null; const grpOf = t => { if (!mats) return 0; for (const gr of g.groups) if (t * 3 >= gr.start && t * 3 < gr.start + gr.count) return gr.materialIndex; return 0; };
    const bins = {}; let inCorner = 0;
    for (let t = 0; t < n; t++) { const x = (p.getX(t * 3) + p.getX(t * 3 + 1) + p.getX(t * 3 + 2)) / 3, z = (p.getZ(t * 3) + p.getZ(t * 3 + 1) + p.getZ(t * 3 + 2)) / 3;
      if (!corner(x, z)) continue; inCorner++; const k = quad(x, z, C) + ':' + grpOf(t); (bins[k] = bins[k] || []).push(t); }
    if (inCorner < 0.9 * n) continue;
    for (const [k, tris] of Object.entries(bins)) { const [q, mi] = k.split(':'); const sg = subGeo(g, tris); sg.computeBoundingBox(); pieces[q].push({ g: sg, m: mats ? mats[+mi] : o.material, bb: sg.boundingBox.clone() }); }
    cut.set(o, true);
  }
  const out = {};
  for (const q of Object.keys(cands)) {
    const all = [...cands[q].map(x => ({ ...x })), ...pieces[q]];
    // the core is the biggest roughly round part of plausible wheel size; its box gathers the rest (rim, disc, bolts)
    let core = null, best = 0;
    for (const x of all) { const s = x.bb.getSize(new THREE.Vector3()); const r = s.y / Math.max(1e-6, s.z); if (r < 0.7 || r > 1.43 || s.y < 0.4 || s.y > 1.2) continue; const v = s.x * s.y * s.z; if (v > best) { best = v; core = x; } }
    if (!core) return null;
    const box = core.bb.clone().expandByScalar(0.06); const parts = [];
    for (const x of all) { const cx = x.bb.getCenter(new THREE.Vector3()); if (!box.containsPoint(cx) || x.bb.max.y > box.max.y + 0.04) continue; parts.push(x); }
    out[q] = parts;
  }
  const used = new Set(); for (const q in out) for (const x of out[q]) if (x.o) used.add(x.o);
  for (const q in out) out[q] = out[q].map(x => (x.o ? { g: toRoot(x.o, inv), m: x.o.material } : { g: x.g, m: x.m }));
  for (const o of [...used, ...cut.keys()]) o.parent?.remove(o);
  return out;
}
// wheels baked into the body mesh: remove the triangles inside each wheel's cylinder (they get separate wheels)
function carveWheels(meshes, root, W) {
  root.updateMatrixWorld(true); const v = new THREE.Vector3();
  for (const o of meshes) {
    let g = toFloat(o.geometry.clone()); if (g.index) g = g.toNonIndexed(); const p = g.attributes.position, n = p.count / 3, keep = [];
    const inside = i => { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); for (const w of W) { if (Math.sign(v.x) !== Math.sign(w.x) || Math.abs(v.x) < Math.abs(w.x) - w.tw * 0.6) continue; if ((v.y - w.y) ** 2 + (v.z - w.z) ** 2 < (w.R * 1.03) ** 2) return true; } return false; };
    for (let t = 0; t < n; t++) if (!(inside(t * 3) && inside(t * 3 + 1) && inside(t * 3 + 2))) keep.push(t);
    if (keep.length < n) { const ng = subGeo(g, keep); ng.groups = []; if (Array.isArray(o.material)) o.material = o.material[0]; o.geometry = ng; }
  }
}
// simple separate wheel (tyre + 5-spoke rim + disc) for models whose wheels could not be separated
function simpleWheel(R, tw, rim, M, side) {
  const spin = new THREE.Group(); const rr = R * 0.68;
  const tyre = new THREE.CylinderGeometry(R, R, tw, 40, 1, true); tyre.rotateZ(Math.PI / 2); spin.add(new THREE.Mesh(tyre, M.rubber));
  for (const s of [-1, 1]) { const wall = new THREE.RingGeometry(rr, R, 40); wall.rotateY(s * Math.PI / 2); wall.translate(s * tw / 2, 0, 0); spin.add(new THREE.Mesh(wall, M.rubber)); }
  const barrel = new THREE.CylinderGeometry(rr, rr, tw * 0.9, 32, 1, true); barrel.rotateZ(Math.PI / 2); spin.add(new THREE.Mesh(barrel, rim));
  const face = side * tw * 0.36;
  const hub = new THREE.CylinderGeometry(rr * 0.24, rr * 0.28, 0.05, 20); hub.rotateZ(Math.PI / 2); hub.translate(face, 0, 0); spin.add(new THREE.Mesh(hub, rim));
  for (let k = 0; k < 5; k++) { const sp = new THREE.BoxGeometry(0.035, rr * 0.9, 0.06); sp.translate(face, rr * 0.5, 0); sp.rotateX(k * Math.PI * 2 / 5); spin.add(new THREE.Mesh(sp, rim)); }
  const disc = new THREE.CylinderGeometry(rr * 0.85, rr * 0.85, 0.025, 32); disc.rotateZ(Math.PI / 2); disc.translate(side * tw * 0.05, 0, 0); spin.add(new THREE.Mesh(disc, M.disc));
  spin.traverse(o => { if (o.isMesh) { o.castShadow = true; o.material.side = THREE.DoubleSide; } });
  return spin;
}
function addCaliper(w, M) { // brake caliper (does not spin) so caliper colours work on every model
  const r = w.R * 0.6; const g = new THREE.BoxGeometry(0.05, r * 0.55, r * 0.35); g.translate(-w.side * 0.02, r * 0.62, r * 0.35); const c = new THREE.Mesh(g, M.caliper); w.pivot.add(c);
}
const RX = { glass: /glass|window|windshield|windscreen|vidrio|scheibe/i, tyre: /tire|tyre|rubber|tread|reifen|sidewall/i,
  tail: /tail|brake.?l|rear.?l|stop|back.?l|taillight|rearlamp|light.?r(ed)?\b|red.?light/i, head: /head|front.?l|headl|hlight|lamp|light|beam/i,
  paint: /paint|carpaint|car_?body|bodywork|\bbody|exterior|shell|lack|colou?r/i,
  notPaint: /chrome|metal|rim|wheel|interior|seat|dash|black|plastic|grill|trim|carbon|mirror|plate|licen|badge|logo|emblem|light|lamp|glass|tire|tyre|rubber|brake|disc|caliper|window|under|bottom|floor|engine|exhaust|leather|fabric/i };
const lum = m => m && m.color ? 0.2126 * m.color.r + 0.7152 * m.color.g + 0.0722 * m.color.b : 0.5;
const matsOf = o => (Array.isArray(o.material) ? o.material : [o.material]);
function triArea(o) { const g = o.geometry, p = g.attributes.position; if (!p) return 0; const n = g.index ? g.index.count / 3 : p.count / 3, step = Math.max(1, Math.floor(n / 4000));
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(); let s = 0; const I = i => (g.index ? g.index.getX(i) : i);
  for (let t = 0; t < n; t += step) { a.fromBufferAttribute(p, I(t * 3)).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(p, I(t * 3 + 1)).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(p, I(t * 3 + 2)).applyMatrix4(o.matrixWorld); s += b.sub(a).cross(c.sub(a)).length() / 2; }
  return s * step; }
// per-type model materials: paint → the car's paint (body only), glass → our glass (tint), lamps → head/tail emissive
function mapTypeMaterials(meshes, M, E) {
  const area = new Map(); for (const o of meshes) { const A = triArea(o) / matsOf(o).length; for (const m of matsOf(o)) area.set(m, (area.get(m) || 0) + A); }
  const nm = m => (m && m.name) || '';
  const isGlass = m => RX.glass.test(nm(m)) || (m.transparent && m.opacity < 0.9 && !RX.head.test(nm(m)) && !RX.tail.test(nm(m))) || (m.transmission > 0.3);
  const pn = E?.paint || E?.paint_material; const paintNames = pn ? new Set([].concat(pn).flatMap(x => String(x).split(' / ')).map(x => x.trim())) : null;
  let paint = [...area.keys()].filter(m => paintNames ? paintNames.has(nm(m)) : (RX.paint.test(nm(m)) && !RX.notPaint.test(nm(m)) && !isGlass(m)));
  if (!paint.length) { // largest opaque, not-excluded material (not near-black trim, not a textured atlas)
    const c = [...area.entries()].filter(([m]) => !isGlass(m) && !RX.notPaint.test(nm(m)) && !m.map && lum(m) > 0.04 && !(m.transparent && m.opacity < 0.99)).sort((a, b) => b[1] - a[1]);
    if (c.length) paint = [c[0][0]];
  }
  const P = new Set(paint); let head = null, tail = null; const H = [], T = [];
  const conv = m => {
    if (!m) return m; if (P.has(m)) return M.paint; if (E?.tail && [].concat(E.tail).includes(nm(m))) return M.tail || (M.tail = new THREE.MeshStandardMaterial({ color: 0xc01010, emissive: 0xff1508, emissiveIntensity: 0.3, roughness: 0.3, name: 'tail' })); const n = nm(m).replace(/details?/ig, ''); // 'Details' must not read as 'tail'
    const red = (m.color && m.color.r > 0.45 && m.color.g < 0.3 && m.color.b < 0.3) || /red.?glas/i.test(n);
    if (/orange.?glas|amber/i.test(n)) return m;
    if (isGlass(m) && !red && !RX.head.test(n) && !RX.tail.test(n)) return M.glass;
    if (RX.tail.test(n) || (RX.head.test(n) && red) || /red.?glas/i.test(n)) { if (!tail) { tail = m.clone(); if (tail.emissive) { tail.emissive.setHex(0xff1508); if (!red) tail.color?.setHex(0xd01a12); } } T.push(1); return tail; }
    if (RX.head.test(n) && !RX.tyre.test(n)) { if (!head) { head = m.clone(); if (head.emissive) head.emissive.setHex(0xfff4dd); } H.push(1); return head; }
    return m;
  };
  for (const o of meshes) { o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material); o.castShadow = true; o.receiveShadow = false; }
  return { head: head && head.emissive ? head : null, tail: tail && tail.emissive ? tail : null, paintFound: P.size > 0 };
}
// ---- per-car identity for the shared mid-engine body (type_mid.glb: r8 / hurac / avent / f458) -----------------------
// Proportions (extra fit scale on top of the cars.json dims, so wheels stay in their arches), default rim finish and a
// procedural rim face, and add-on parts that conform to the body by ray casts: wings, side blade / intakes, scoops,
// splitters, stripes and LED light signatures (front DRL strips always lit; rear strips use the tail material so they
// brighten with the brakes).
const MID = {
  // face: intake polygons on the front face in (u = x / half width, v = y / height), sym = mirrored to both sides;
  // exhaust: 'twinOval' (R8), 'twinHigh' (Huracan), 'centreQuad' (Aventador), 'triple' (458); diffuser fin count
  r8: { fit: [1.0, 1.045, 0.985], rim: [0x8d9196, 0.95, 0.34], spokes: 'twin5', blade: true, exhaust: 'twinOval', plateV: 0.4, fins: 4, back: [{ c: [[-0.5, 0.2], [0.5, 0.2], [0.46, 0.4], [-0.46, 0.4]] }],
    face: [{ c: [[-0.36, 0.1], [0.36, 0.1], [0.44, 0.23], [0.3, 0.37], [-0.3, 0.37], [-0.44, 0.23]] }, { sym: [[0.62, 0.12], [0.9, 0.12], [0.86, 0.26], [0.66, 0.24]] }],
    drl: [[[0.5, 0.44], [0.72, 0.43], [0.9, 0.5]]], tail: [[[0.3, 0.63], [0.9, 0.63]]], lip: 0.04 },
  hurac: { fit: [0.99, 0.955, 1.0], rim: [0x0b0c0d, 0.6, 0.12], spokes: 'y5', intake: [0.52, 0.26, 0.2], vents: true, splitter: 0.05, exhaust: 'twinHigh', plateV: 0.4, fins: 6, back: [{ c: [[-0.8, 0.2], [0.8, 0.2], [0.72, 0.48], [0.3, 0.5], [-0.3, 0.5], [-0.72, 0.48]] }], duck: [0.035, 0.55],
    face: [{ sym: [[0.36, 0.1], [0.86, 0.1], [0.94, 0.22], [0.82, 0.33], [0.48, 0.29]] }, { c: [[-0.26, 0.08], [0.26, 0.08], [0.2, 0.15], [-0.2, 0.15]] }],
    drl: [[[0.48, 0.5], [0.7, 0.45], [0.9, 0.53]], [[0.7, 0.45], [0.8, 0.37]]], tail: [[[0.42, 0.6], [0.66, 0.63], [0.9, 0.57]], [[0.66, 0.63], [0.64, 0.53]]] },
  avent: { fit: [1.035, 0.93, 1.03], rim: [0x8f7440, 0.95, 0.26], spokes: 'multi10', intake: [0.62, 0.34, 0.32], wing: { h: 0.035, chord: 0.3, span: 0.62, flush: true }, plateV: 0.3, scoops: true, splitter: 0.07, exhaust: 'centreQuad', fins: 8, back: [{ c: [[-0.86, 0.18], [0.86, 0.18], [0.9, 0.5], [0.5, 0.56], [-0.5, 0.56], [-0.9, 0.5]] }],
    face: [{ sym: [[0.42, 0.08], [0.93, 0.08], [0.97, 0.36], [0.74, 0.3], [0.6, 0.2]] }, { c: [[-0.34, 0.07], [0.34, 0.07], [0.3, 0.13], [-0.3, 0.13]] }],
    drl: [[[0.44, 0.42], [0.68, 0.5], [0.92, 0.45]], [[0.68, 0.5], [0.8, 0.41]], [[0.68, 0.5], [0.6, 0.56]]], tail: [[[0.38, 0.6], [0.6, 0.55], [0.88, 0.62]], [[0.6, 0.55], [0.58, 0.46]], [[0.6, 0.55], [0.72, 0.5]]] },
  f458: { fit: [0.985, 1.0, 1.015], rim: [0xd6d9dd, 0.95, 0.2], spokes: 'star5', intake: [0.34, 0.14, 0.62], stripes: true, exhaust: 'triple', plateV: 0.52, fins: 5, back: [{ c: [[-0.36, 0.2], [0.36, 0.2], [0.3, 0.47], [-0.3, 0.47]] }, { sym: [[0.5, 0.25], [0.84, 0.25], [0.8, 0.36], [0.52, 0.36]] }], duck: [0.06, 0.7],
    face: [{ c: Array.from({ length: 20 }, (_, i) => [0.56 * Math.cos(i / 20 * Math.PI * 2), 0.19 + 0.075 * Math.sin(i / 20 * Math.PI * 2)]) }, { sym: [[0.72, 0.13], [0.88, 0.15], [0.84, 0.22], [0.72, 0.2]] }],
    drl: [[[0.6, 0.4], [0.76, 0.5], [0.93, 0.49]]], rings: [[0.55, 0.61], [0.78, 0.61]] },
};
export function midFit(id) { return MID[id]?.fit || null; }
export function midRim(id) { const s = MID[id]; return s ? new THREE.MeshPhysicalMaterial({ color: s.rim[0], metalness: s.rim[1], roughness: s.rim[2], clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.4 }) : null; }
// 2x2 twill carbon weave: albedo (tows with a light sheen band along their length) + matching normal map (each tow is a
// rounded bump running along its own direction), under a gloss clearcoat, so it reads as carbon rather than black plastic
let CARBON = null;
export function carbonMat() {
  if (CARBON) return CARBON; const N = 128, T = 8; // 16 tows per tile, 8 px each
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c; };
  const ca = mk(), cn = mk(), ga = ca.getContext('2d'), gn = cn.getContext('2d'); const A = ga.createImageData(N, N), B = gn.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const tx = Math.floor(x / T), ty = Math.floor(y / T), horiz = ((tx + ty) >> 1) % 2 === 0; // 2x2 twill: over two, under two, stepping each row
    const u = ((horiz ? y : x) % T + 0.5) / T - 0.5; // across the tow (-0.5..0.5)
    const along = ((horiz ? x : y) % (T * 2) + 0.5) / (T * 2); const h = Math.cos(u * Math.PI), end = Math.sin(along * Math.PI);
    const shade = 0.55 + 0.45 * h * (0.6 + 0.4 * end), fib = 0.93 + 0.07 * Math.sin(((horiz ? y : x) * 2.7) + (horiz ? x : y) * 0.15);
    const v = Math.round(Math.min(255, (horiz ? 44 : 30) * shade * fib + 6)); const i = (y * N + x) * 4;
    A.data[i] = v; A.data[i + 1] = v + 1; A.data[i + 2] = v + 4; A.data[i + 3] = 255;
    const sl = -Math.sin(u * Math.PI) * 0.55, se = Math.cos(along * Math.PI) * 0.25; const nx = horiz ? se : sl, ny = horiz ? sl : se, nz = Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny));
    B.data[i] = Math.round((nx * 0.5 + 0.5) * 255); B.data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255); B.data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255); B.data[i + 3] = 255; }
  ga.putImageData(A, 0, 0); gn.putImageData(B, 0, 0);
  const tex = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(14, 14); t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  return (CARBON = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: tex(ca, true), normalMap: tex(cn, false), normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.34, metalness: 0.35,
    clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.5, side: THREE.DoubleSide, name: 'carbon' }));
}
// axis-aligned ray casts against the body, accelerated by a per-axis 2D triangle grid (three.js Raycaster tests every
// triangle of every mesh whose bounding sphere the ray crosses: ~140k triangles per ray on type_mid, several seconds per car)
function axisCaster(meshes, root) {
  root.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(); const T = [], O = []; const m4 = new THREE.Matrix4(), v = new THREE.Vector3();
  for (const o of meshes) { m4.multiplyMatrices(inv, o.matrixWorld); const p = o.geometry.attributes.position, ix = o.geometry.index; const n = ix ? ix.count : p.count;
    for (let i = 0; i < n; i += 3) { for (let k = 0; k < 3; k++) { v.fromBufferAttribute(p, ix ? ix.getX(i + k) : i + k).applyMatrix4(m4); T.push(v.x, v.y, v.z); } O.push(o); } }
  const nt = O.length, C = 0.04, grids = [null, null, null];
  const grid = ax => { if (grids[ax]) return grids[ax]; const a = (ax + 1) % 3, b = (ax + 2) % 3, G = new Map();
    for (let t = 0; t < nt; t++) { let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9; for (let k = 0; k < 3; k++) { const va = T[t * 9 + k * 3 + a], vb = T[t * 9 + k * 3 + b]; a0 = Math.min(a0, va); a1 = Math.max(a1, va); b0 = Math.min(b0, vb); b1 = Math.max(b1, vb); }
      for (let i = Math.floor(a0 / C); i <= Math.floor(a1 / C); i++) for (let j = Math.floor(b0 / C); j <= Math.floor(b1 / C); j++) { const key = i * 100003 + j; let l = G.get(key); if (!l) G.set(key, l = []); l.push(t); } }
    return (grids[ax] = { a, b, G }); };
  return (o, d, far = 12) => { const ax = Math.abs(d.x) > 0.5 ? 0 : Math.abs(d.y) > 0.5 ? 1 : 2; const { a, b, G } = grid(ax); const P = [o.x, o.y, o.z], D = [d.x, d.y, d.z];
    const l = G.get(Math.floor(P[a] / C) * 100003 + Math.floor(P[b] / C)); if (!l) return [];
    const hits = []; for (const t of l) { const q = t * 9; // Moller-Trumbore
      const e1x = T[q + 3] - T[q], e1y = T[q + 4] - T[q + 1], e1z = T[q + 5] - T[q + 2], e2x = T[q + 6] - T[q], e2y = T[q + 7] - T[q + 1], e2z = T[q + 8] - T[q + 2];
      const px = D[1] * e2z - D[2] * e2y, py = D[2] * e2x - D[0] * e2z, pz = D[0] * e2y - D[1] * e2x, det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-12) continue;
      const id = 1 / det, sx = P[0] - T[q], sy = P[1] - T[q + 1], sz = P[2] - T[q + 2], u = (sx * px + sy * py + sz * pz) * id; if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, w = (D[0] * qx + D[1] * qy + D[2] * qz) * id; if (w < 0 || u + w > 1) continue;
      const dist = (e2x * qx + e2y * qy + e2z * qz) * id; if (dist > 0 && dist < far) hits.push({ distance: dist, object: O[t], point: new THREE.Vector3(P[0] + D[0] * dist, P[1] + D[1] * dist, P[2] + D[2] * dist) }); }
    return hits.sort((x, y) => x.distance - y.distance); };
}
function styleMid(car, root, bodyG, M, wheels, bb, meshes, colour, opts) {
  const S = MID[car.id]; if (!S) return; const sz = bb.getSize(new THREE.Vector3()), cx = (bb.min.x + bb.max.x) / 2, hw = sz.x / 2;
  const rc = new THREE.Raycaster(), AX = axisCaster(meshes, root); const cast = (o, d) => { const h = AX(o, d, 12); for (const x of h) { if (RX.glass.test(x.object.material?.name || '') || x.object.material?.transparent) return { glass: true, ...x }; return x; } return null; };
  const lum = new THREE.Color(colour); const L = lum.r * 0.2126 + lum.g * 0.7152 + lum.b * 0.0722;
  const carbon = carbonMat();
  const black = new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide });
  const drl = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe8f0ff, emissiveIntensity: 2.4, roughness: 0.2, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
  const add = (g, m) => { const o = new THREE.Mesh(g, m); o.castShadow = true; o.userData.midPart = true; bodyG.add(o); return o; };
  // conformal patch: grid of rays (origins O[i][j], direction d); vertices sit `off` back along the ray from the hit
  const patch = (O, d, off, m, skipGlass = true, maxD = 0) => { const n = O.length, k = O[0].length, P = O.map(r => r.map(o => { if (!o) return null; const h = cast(o, d); return h && !(skipGlass && h.glass) && !(maxD && h.distance > maxD) ? h.point.clone().addScaledVector(d, -off) : null; }));
    const pos = []; for (let i = 0; i < n - 1; i++) for (let j = 0; j < k - 1; j++) { const a = P[i][j], b = P[i + 1][j], c = P[i + 1][j + 1], e = P[i][j + 1]; if (!a || !b || !c || !e) continue; if (a.distanceTo(c) > 0.6) continue;
      const fl = _t1.subVectors(b, a).cross(_t2.subVectors(c, a)).dot(d) > 0; // winding: face back along the ray (outwards) so single-sided materials show on both sides
      if (fl) pos.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z, a.x, a.y, a.z, e.x, e.y, e.z, c.x, c.y, c.z); else pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, e.x, e.y, e.z); }
    if (!pos.length) return null; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    const uv = []; for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] + pos[i + 2], pos[i + 1]); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); return add(g, m); };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const topY = (x, z) => { const h = cast(V(x, bb.max.y + 1, z), V(0, -1, 0)); return h ? h.point.y : null; };
  const lin = (a, b, n) => Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));
  // light signatures: polylines in (u = |x| / half width, v = height fraction), cast along the car's length
  const strips = (lines, front, mat, w) => { const d = V(0, 0, front ? 1 : -1), z0 = front ? bb.min.z - 1 : bb.max.z + 1;
    for (const sx of [-1, 1]) for (const ln of lines) for (let s = 0; s < ln.length - 1; s++) { const [u0, v0] = ln[s], [u1, v1] = ln[s + 1]; const n = 6, rows = [];
      const dx = (u1 - u0) * hw, dy = (v1 - v0) * sz.y, l = Math.hypot(dx, dy) || 1, px = -dy / l * w / 2, py = dx / l * w / 2;
      for (const t of [-1, 1]) rows.push(lin(0, 1, n).map(f => V(cx + sx * ((u0 + (u1 - u0) * f) * hw + t * px), bb.min.y + (v0 + (v1 - v0) * f) * sz.y + t * py, z0)));
      patch(rows, d, 0.006, mat, false); } };
  const band = (ln, h) => [...ln.map(([u, v]) => [u, v + h]), ...ln.slice().reverse().map(([u, v]) => [u, v - h])];
  const lensF = new THREE.MeshPhysicalMaterial({ color: 0x0c0e11, metalness: 0.7, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
  const lensR = new THREE.MeshPhysicalMaterial({ color: 0x2a0205, emissive: 0x500006, emissiveIntensity: 0.6, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
  if (S.drl) strips(S.drl, true, drl, 0.022);
  if (S.tail && M.tail) strips(S.tail, false, M.tail, 0.034);
  if (S.rings && M.tail) for (const sx of [-1, 1]) for (const [u, v] of S.rings) { const r0 = 0.05, r1 = 0.075, n = 16, rows = [[], []];
    for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; for (const [k, r] of [[0, r0], [1, r1]]) rows[k].push(V(cx + sx * u * hw + Math.cos(a) * r, bb.min.y + v * sz.y + Math.sin(a) * r, bb.max.z + 1)); }
    patch(rows, V(0, 0, -1), 0.006, M.tail, false); }
  const zF = Math.min(...wheels.map(w => w.pivot.position.z)), zR = Math.max(...wheels.map(w => w.pivot.position.z)), R = wheels[0]?.R || 0.35;
  // R8 side blade: contrasting panel behind the doors, sill to shoulder
  if (S.blade) { const bm = new THREE.MeshPhysicalMaterial({ color: L > 0.3 ? 0x3a3e44 : 0xb8bcc2, metalness: 0.95, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.8, side: THREE.DoubleSide }); // R8 side blade: gloss titanium / silver against the paint
    for (const sx of [-1, 1]) { const rows = lin(bb.min.y + 0.2, bb.min.y + sz.y * 0.62, 8).map((y, i) => { const f = i / 7; const za = zR - R * (2.35 - f * 0.25), zb = zR - R * (1.25 + f * 0.1); return lin(za, zb, 6).map(z => V(sx * 3, y, z)); }); patch(rows, V(-sx, 0, 0), 0.008, bm); } }
  // side air intakes ahead of the rear wheels: [depth along z (m), height fraction, low edge fraction]
  if (S.intake) { const [len, hf, y0] = S.intake;
    for (const sx of [-1, 1]) { const rows = lin(bb.min.y + y0 * sz.y, bb.min.y + (y0 + hf) * sz.y, 6).map((y, i) => { const f = i / 5; const zb = zR - R * 1.15, za = zb - len * (0.55 + 0.45 * f); return lin(za, zb, 6).map(z => V(sx * 3, y, z)); }); patch(rows, V(-sx, 0, 0), 0.006, black); } }
  // rear wing on struts (avent: tall with end plates; f458: slim, low)
  if (S.wing) { const W = S.wing, zc = bb.max.z - 0.32, yd = topY(cx, zc) ?? bb.min.y + sz.y * 0.75, span = sz.x * W.span, y = yd + W.h;
    const wg = new THREE.BoxGeometry(span, W.flush ? 0.022 : 0.03, W.chord, W.flush ? 8 : 1, 1, 1); wg.rotateX(W.flush ? -0.05 : -0.12); if (W.flush) { const q = wg.attributes.position; for (let i = 0; i < q.count; i++) q.setY(i, q.getY(i) - 0.05 * (2 * q.getX(i) / span) ** 2); wg.computeVertexNormals(); } wg.translate(cx, y, zc); add(wg, carbon);
    const gy = new THREE.BoxGeometry(span, 0.03, 0.012); gy.translate(cx, y + 0.025, zc + W.chord / 2); add(gy, carbon);
    if (!W.flush) for (const sx of [-1, 1]) { const xs = cx + sx * span * 0.3, yb = topY(xs, zc) ?? yd; const st = new THREE.BoxGeometry(0.025, y - yb + 0.02, 0.1); st.translate(xs, (y + yb) / 2, zc + 0.02); add(st, carbon);
      if (W.plates) { const pg = new THREE.BoxGeometry(0.012, 0.13, W.chord + 0.06); pg.translate(cx + sx * span / 2, y + 0.02, zc); add(pg, carbon); } } }
  // Aventador roof scoops (NACA-style duct pair on the rear roof) and a front splitter
  if (S.scoops) for (const sx of [-1, 1]) { const x = cx + sx * sz.x * 0.16, z = (zF + zR) / 2 + sz.z * 0.1, y = topY(x, z); if (y == null) continue;
    const g = new THREE.BoxGeometry(0.16, 0.07, 0.42); const p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getZ(i) < 0) { p.setY(i, p.getY(i) * 0.2 - 0.03); p.setX(i, p.getX(i) * 0.6); } g.computeVertexNormals(); g.translate(x, y + 0.02, z); add(g, black); }
  // front splitter: a carbon blade that follows the nose outline in plan. The old splitter was a full-width rectangle; under
  // the rounded / pointed nose its corners stuck out up to ~0.4 m ahead of the body (the 'plank on the road ahead').
  // Here each station across the car finds the bumper face by a ray along the car, and the blade runs from just ahead of
  // that face (S.splitter) back under the car; stations with no bumper face nearby end the blade.
  if (S.splitter && opts.splitter !== false) { const y = bb.min.y + 0.07, t = 0.016, NX = 17, xs = lin(-hw * 0.8, hw * 0.8, NX), F = [];
    for (const x of xs) { let zf = null; for (const dy of [0.04, 0.08, 0.12]) { const h = cast(V(cx + x, y + dy, bb.min.z - 1), V(0, 0, 1)); if (h && !h.glass && h.point.z < bb.min.z + 0.6) zf = zf == null ? h.point.z : Math.min(zf, h.point.z); } F.push(zf); }
    const ok = F.filter(v => v != null).length; if (ok >= 5) { const pos = [], quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      for (let k = 0; k < NX - 1; k++) { if (F[k] == null || F[k + 1] == null) continue; const xa = cx + xs[k], xb = cx + xs[k + 1], fa = F[k] - S.splitter * 0.45, fb = F[k + 1] - S.splitter * 0.45, ba = F[k] + 0.22, bbk = F[k + 1] + 0.22;
        quad([xa, y + t, fa], [xa, y + t, ba], [xb, y + t, bbk], [xb, y + t, fb]); quad([xa, y, fa], [xb, y, fb], [xb, y, bbk], [xa, y, ba]); quad([xa, y, fa], [xa, y + t, fa], [xb, y + t, fb], [xb, y, fb]); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
      const uv = []; for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] * 2, pos[i + 2] * 2); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); add(g, carbon).userData.splitter = true; } }
  if (S.lip) { const z = bb.max.z - 0.06, y = topY(cx, z - 0.05); if (y != null) { const g = new THREE.BoxGeometry(sz.x * 0.6, 0.02, 0.07); g.rotateX(0.35); g.translate(cx, y + 0.015, z); add(g, carbon); } }
  // Huracán bonnet vents: two dark slatted patches on the front deck
  if (S.vents) for (const sx of [-1, 1]) { const rows = lin(bb.min.z + sz.z * 0.1, bb.min.z + sz.z * 0.2, 5).map(z => lin(cx + sx * sz.x * 0.1, cx + sx * sz.x * 0.26, 5).map(x => V(x, bb.max.y + 1, z))); patch(rows, V(0, -1, 0), 0.006, black); }
  // 458 twin stripes over bonnet, roof and engine cover (off the glass), white or black against the paint
  if (S.stripes && opts.stripes !== false) { const sm = new THREE.MeshPhysicalMaterial({ color: L > 0.45 ? 0x111214 : 0xf2f2ee, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
    for (const sx of [-1, 1]) { const rows = lin(bb.min.z + 0.05, bb.max.z - 0.05, 48).map(z => lin(cx + sx * 0.07, cx + sx * 0.2, 3).map(x => V(x, bb.max.y + 1, z))); patch(rows, V(0, -1, 0), 0.004, sm); } }
  // ---- per-car face, tail, exhaust, diffuser, spoiler -------------------------------------------------------------
  const inPoly = (P, u, v) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > v) !== (yj > v) && u < (xj - xi) * (v - yi) / (yj - yi) + xi) c = !c; } return c; };
  // filled polygon on the front (front = true) or rear face, projected along the car; ray hits deeper than 1.7 m from the box end are dropped
  const facePoly = (P, front, mat, off = 0.004, n = 18) => { const us = P.map(p => p[0]), vs = P.map(p => p[1]); const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
    const d = V(0, 0, front ? 1 : -1), z0 = front ? bb.min.z - 1 : bb.max.z + 1; const nu = n, nv = Math.max(4, Math.round(n * (v1 - v0) * sz.y / Math.max(0.05, (u1 - u0) * hw)));
    const du = (u1 - u0) / (nu - 1) * 0.5, dv = (v1 - v0) / (nv - 1) * 0.5; // keep a point if it or a half-cell neighbour is inside, so the outline is filled
    const snap = (u, v) => { let best = null, bd = 1e9; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [ax, ay] = P[j], [bx, by] = P[i]; const ex = bx - ax, ey = by - ay; const t = Math.max(0, Math.min(1, ((u - ax) * ex + (v - ay) * ey) / (ex * ex + ey * ey || 1)));
      const qx = ax + ex * t, qy = ay + ey * t, dd = (qx - u) ** 2 + (qy - v) ** 2; if (dd < bd) { bd = dd; best = [qx, qy]; } } return best; }; // outline points land on the polygon edge (no stair steps)
    const rows = lin(v0 - dv, v1 + dv, nv + 1).map(v => lin(u0 - du, u1 + du, nu + 1).map(u => { const inside = inPoly(P, u, v); if (!inside && ![[2 * du, 0], [-2 * du, 0], [0, 2 * dv], [0, -2 * dv], [2 * du, 2 * dv], [-2 * du, 2 * dv], [2 * du, -2 * dv], [-2 * du, -2 * dv]].some(([a, b]) => inPoly(P, u + a, v + b))) return null;
      const [uu, vv] = inside ? [u, v] : snap(u, v); return V(cx + uu * hw, bb.min.y + vv * sz.y, z0); }));
    return patch(rows, d, off, mat, false, 1.7); };
  const grille = new THREE.MeshPhysicalMaterial({ color: 0x0a0b0c, roughness: 0.38, metalness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.2, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 });
  for (const sx of [-1, 1]) { if (S.drl) facePoly(band(S.drl[0], 0.055).map(([u, v]) => [sx * u, v]), true, lensF, 0.002, 14);
    if (S.tail) facePoly(band(S.tail[0], 0.05).map(([u, v]) => [sx * u, v]), false, lensR, 0.002, 14); }
  if (S.back) for (const f of S.back) { if (f.c) facePoly(f.c, false, grille); if (f.sym) for (const sx of [-1, 1]) facePoly(f.sym.map(([u, v]) => [sx * u, v]), false, grille); }
  if (S.face) for (const f of S.face) { if (f.c) facePoly(f.c, true, grille); if (f.sym) for (const sx of [-1, 1]) facePoly(f.sym.map(([u, v]) => [sx * u, v]), true, grille); }
  // rear: diffuser panel with vertical fins across the lower bumper, then the exhaust layout
  const rearZ = (x, y) => { const h = cast(V(x, y, bb.max.z + 1), V(0, 0, -1)); return h && h.distance < 1.8 ? h.point.z : null; };
  if (S.fins) { const dw = 0.56, dv0 = 0.05, dv1 = 0.2; facePoly([[-dw, dv0], [dw, dv0], [dw * 0.92, dv1], [-dw * 0.92, dv1]], false, grille, 0.004, 22);
    for (let k = 0; k < S.fins; k++) { const u = -dw * 0.85 + (k / (S.fins - 1)) * dw * 1.7, x = cx + u * hw, yb = bb.min.y + dv0 * sz.y + 0.01, z = rearZ(x, yb + 0.04); if (z == null) continue;
      const g = new THREE.BoxGeometry(0.012, (dv1 - dv0) * sz.y * 0.9, 0.34); const p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) > 0 && p.getZ(i) < 0) p.setZ(i, p.getZ(i) * 0.3); // fin tapers into the body
      g.computeVertexNormals(); g.translate(x, yb + (dv1 - dv0) * sz.y * 0.45, z - 0.12); add(g, carbon); } }
  if (S.exhaust) { const chrome = new THREE.MeshPhysicalMaterial({ color: 0xd8dade, metalness: 1, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.6, side: THREE.DoubleSide });
    const soot = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9, side: THREE.DoubleSide });
    const tip = (u, v, r, sxs = 1, shape = 20) => { const x = cx + u * hw, y = bb.min.y + v * sz.y; const z = rearZ(x, y); if (z == null) return;
      const t = new THREE.CylinderGeometry(r, r * 0.94, 0.16, shape, 1, true); t.rotateX(Math.PI / 2); if (shape === 6) t.rotateZ(Math.PI / 6); t.scale(sxs, 1, 1); t.translate(x, y, z + 0.02); add(t, chrome);
      const c = new THREE.CircleGeometry(r * 0.9, shape); if (shape === 6) c.rotateZ(Math.PI / 6); c.scale(sxs, 1, 1); c.translate(x, y, z + 0.035); add(c, soot); };
    const E = S.exhaust;
    if (E === 'twinOval') for (const sx of [-1, 1]) tip(sx * 0.66, 0.17, 0.062, 1.7);
    else if (E === 'twinHigh') { for (const sx of [-1, 1]) tip(sx * 0.44, 0.42, 0.07, 1, 6); } // either side of the plate, as on the EVO
    else if (E === 'centreQuad') { facePoly([[-0.2, 0.37], [0.2, 0.37], [0.24, 0.44], [0.2, 0.53], [-0.2, 0.53], [-0.24, 0.44]], false, grille); for (const [u, v] of [[-0.11, 0.42], [0.11, 0.42], [0, 0.48]]) tip(u, v, 0.046, 1, 6); } // Aventador S: hex trio above the plate
    else if (E === 'triple') { for (const [u, v] of [[-0.1, 0.22], [0.1, 0.22], [0, 0.3]]) tip(u, v, 0.05); } } // 458: triangle of pipes below the plate
  // integrated spoiler (ducktail) in body colour: raised trailing lip along the tail, [height m, span fraction]
  if (S.duck) { const [dh, dsp] = S.duck, z = bb.max.z - 0.05, y = topY(cx, z - 0.08); if (y != null) { const g = new THREE.BoxGeometry(sz.x * dsp, 0.022, 0.12, 12, 1, 1); const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const f = 1 - (2 * p.getX(i) / (sz.x * dsp)) ** 2; if (p.getZ(i) > 0) p.setY(i, p.getY(i) + dh * (0.4 + 0.6 * f)); } g.computeVertexNormals(); g.translate(cx, y - 0.005, z - 0.04); add(g, M.paint); } }
  // rim face: a procedural spoke pattern just inside the outer face of each wheel (spins with it)
  const rimM = M.rim || midRim(car.id);
  for (const w of wheels) { const b = visBox(w.spin); if (b.isEmpty()) continue; const side = w.side, xo = (side > 0 ? b.max.x : b.min.x) - w.pivot.position.x, xf = xo - side * 0.045, rr = w.R * 0.64;
    const G = []; const spoke = (ang, wd, len = rr * 0.92, off = 0) => { const g = new THREE.BoxGeometry(0.03, len, wd); g.translate(xf, rr * 0.12 + len / 2, off); g.rotateX(ang); G.push(g); };
    const n = { twin5: 5, y5: 5, multi10: 10, star5: 5 }[S.spokes] || 5;
    for (let k = 0; k < n; k++) { const a = k * Math.PI * 2 / n;
      if (S.spokes === 'twin5') { spoke(a, 0.03, rr * 0.9, -0.035); spoke(a, 0.03, rr * 0.9, 0.035); }
      else if (S.spokes === 'y5') { spoke(a, 0.045, rr * 0.5); spoke(a + 0.2, 0.03, rr * 0.55, 0); spoke(a - 0.2, 0.03, rr * 0.55, 0); }
      else if (S.spokes === 'multi10') spoke(a, 0.026);
      else { const g = new THREE.CylinderGeometry(0.02, 0.06, rr * 0.9, 4); g.rotateY(Math.PI / 4); g.scale(0.6, 1, 1); g.translate(xf, rr * 0.12 + rr * 0.45, 0); g.rotateX(a); G.push(g); } }
    const hub = new THREE.CylinderGeometry(rr * 0.2, rr * 0.22, 0.04, 16); hub.rotateZ(Math.PI / 2); hub.translate(xf + side * 0.005, 0, 0); G.push(hub);
    const ringG = new THREE.TorusGeometry(rr * 1.02, 0.012, 4, 36); ringG.rotateY(Math.PI / 2); ringG.translate(xf, 0, 0); G.push(ringG);
    const gg = mergeGeometries(G.map(g => { const x = g.index ? g.toNonIndexed() : g; x.deleteAttribute('uv'); return x; })); if (!gg) continue; const m = new THREE.Mesh(gg, rimM); m.castShadow = true; m.userData.midRim = true; w.spin.add(m); }
  root.userData.midStyle = car.id;
}
// ---- per-car body warps of the shared mid-engine body --------------------------------------------------------------
// type_mid.glb is one body for four cars; each car bends it (in car-root space, after the fit to its real size) into its
// own proportions. Wheel arches are left in place: length changes only act on the overhangs beyond the arches, height and
// width changes are banded by height so the arch openings keep their shape. Normals follow the warp (inverse-transpose
// Jacobian by finite differences), so smoothing is kept. Warped geometries are cached per car.
const WARP_CACHE = {};
const smx = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const gau = (x, w) => Math.exp(-((x / w) ** 2));
function midWarpFn(id, K) {
  const { hw, H, z0, z1, zF, zR, R } = K;
  const fF = z => smx(zF - R * 1.1, z0, z), fR = z => smx(zR + R * 1.1, z1, z); // 0 at the arch edge → 1 at the nose / tail
  const cab = z => smx(zF + R * 0.7, zF + R * 2.1, z) * smx(zR - R * 0.1, zR - R * 1.5, z); // between the axles (cabin)
  return p => { const { x, y, z } = p, h = y / H, s = Math.min(1, Math.abs(x) / hw), sg = Math.sign(x) || 1, f = fF(z), r = fR(z), c = cab(z);
    let X = x, Y = y, Z = z;
    if (id === 'avent') { // wedge: long low nose, raised tail deck, sharp shoulder crease, tucked cabin, longer overall
      Y -= 0.14 * f ** 1.2 * smx(0.1, 0.55, h); Y += 0.05 * smx(zF, z1, z) * smx(0.3, 0.7, h) * (1 - 0.8 * c); Y -= 0.05 * smx(0.78, 0.98, h) * c * s; // flatter, angular roof edges
      X += sg * hw * (0.055 * gau(h - 0.6, 0.05) - 0.11 * smx(0.64, 0.95, h) * c); Z += -0.16 * f + 0.12 * r;
    } else if (id === 'hurac') { // compact: shorter overhangs, pointed plan-form nose, lower cabin
      Z += 0.1 * f - 0.11 * r; X *= 1 - 0.26 * f ** 1.6 * smx(0.12, 0.5, h); Y -= 0.06 * f ** 1.4 * smx(0.2, 0.6, h); Y -= 0.05 * smx(0.7, 0.95, h) * c; X *= 1 - 0.1 * r ** 1.5 * smx(0.3, 0.7, h); // dart-shaped plan, chopped cabin, tapered tail
    } else if (id === 'r8') { // taller, rounder cabin (wider greenhouse), blunter upright nose
      Y += 0.11 * smx(0.58, 0.9, h) * c * (1 - 0.45 * s * s); X += sg * hw * 0.06 * smx(0.6, 0.85, h) * c; Y += 0.055 * f * smx(0.3, 0.7, h); Z += 0.05 * f; X -= sg * hw * 0.03 * gau(z - (zF + zR) / 2 - R * 0.6, R * 0.8) * smx(0.25, 0.5, h) * (1 - smx(0.55, 0.7, h)); // tall bubble cabin, upright nose, sculpted side-blade recess
    } else if (id === 'f458') { // curvy: fender peaks over both axles, high rear haunches (wider too), rounded nose
      const band = smx(0.45, 0.62, h) * (1 - smx(0.86, 1, h)) * smx(0.4, 0.8, s);
      Y += (0.075 * gau(z - zF, R * 0.95) + 0.11 * gau(z - zR, R * 1.1)) * band;
      X += sg * hw * 0.06 * gau(z - zR, R * 1.3) * smx(0.3, 0.55, h) * (1 - smx(0.82, 0.96, h));
      X *= 1 - 0.16 * f ** 2 * s; Y -= 0.05 * f ** 2 * smx(0.3, 0.7, h); Z += 0.04 * f;
    }
    p.set(X, Y, Z); return p; };
}
function warpMid(car, root, bodyG, wheels) {
  const zs = wheels.map(w => w.pivot.position.z); if (zs.length !== 4) return 0;
  const t0 = performance.now();
  root.updateMatrixWorld(true); const meshes = []; bodyG.traverse(o => { if (o.isMesh && o.visible) meshes.push(o); }); const bb = visBox(bodyG);
  const K = { hw: (bb.max.x - bb.min.x) / 2, H: bb.max.y, z0: bb.min.z, z1: bb.max.z, zF: Math.min(...zs), zR: Math.max(...zs), R: wheels[0].R || 0.35 };
  const fn = midWarpFn(car.id, K); const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(); const bInv = new THREE.Matrix4().copy(bodyG.matrixWorld).invert().multiply(root.matrixWorld);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3(), J = new THREE.Matrix3(), e = 1e-3; let nv = 0;
  meshes.forEach((o, i) => { const ck = car.id + '|' + o.geometry.uuid + '|' + i; let g = WARP_CACHE[ck];
    if (!g) { g = toRoot(o, inv); const P = g.attributes.position, N = g.attributes.normal;
      for (let k = 0; k < P.count; k++) { a.fromBufferAttribute(P, k); const w0 = fn(a.clone());
        if (N) { const c0 = fn(a.clone().setX(a.x + e)).sub(w0), c1 = fn(a.clone().setY(a.y + e)).sub(w0), c2 = fn(a.clone().setZ(a.z + e)).sub(w0);
          J.set(c0.x, c1.x, c2.x, c0.y, c1.y, c2.y, c0.z, c1.z, c2.z).invert().transpose(); n.fromBufferAttribute(N, k).applyMatrix3(J).normalize(); if (Number.isFinite(n.x + n.y + n.z)) N.setXYZ(k, n.x, n.y, n.z); }
        P.setXYZ(k, w0.x, w0.y, w0.z); }
      g.computeBoundingBox(); g.computeBoundingSphere(); WARP_CACHE[ck] = g; }
    nv += g.attributes.position.count;
    o.geometry = g; o.parent.remove(o); o.position.set(0, 0, 0); o.quaternion.identity(); o.scale.set(1, 1, 1); o.applyMatrix4(bInv); bodyG.add(o); });
  root.userData.warp = { car: car.id, meshes: meshes.length, verts: nv, ms: Math.round(performance.now() - t0) }; return nv;
}
const TYPE_R = { classicmini: 0.27, hatch3: 0.31, hatch5: 0.32, boxy: 0.3, suv: 0.4, crossover: 0.36, offroad: 0.42, estate: 0.33, hyper: 0.36, mid: 0.35 };

export function buildRealCar(car, opts = {}) {
  if (typesPending(car)) { ensureRealModel(car); return null; } // manifest not in yet: procedural body now, never the wrong fallback model
  const key = keyFor(car); if (!key) return null;
  if (!PROTO[key]) { ensureRealModel(car); return null; } // lazy: start the download; this build uses the procedural body
  const native = MODEL_OF[car.id] === key, typed = key.startsWith('type_'), E = typed ? TYPES[key.slice(5)] || {} : null;
  const colour = opts.colour ?? car.colour;
  const { M, map } = buildMaterials(colour, opts);
  if (car.id === 'rrs23' && M.paint.userData.fx) M.paint.userData.fx.uFlake.value = 0;
  // The older OBJ shell has no thickness: its inner faces must not disappear in cockpit/low views.
  if (key === 'db9') M.paint.side = THREE.DoubleSide;
  const rim = rimMat(opts.wheel) || (key === 'type_mid' ? midRim(car.id) : null); if (rim) M.rim = rim; // mid-engine cars: each has its own stock rim finish
  let A;
  if (key === 'db9') A = assembleDB9(PROTO.db9, M, map, rim);
  else if (!typed) A = assembleGLB(key, M, rim);
  else { const node = PROTO[key].clone(true); const wg = {}; const WN = E.wheels && typeof E.wheels === 'object' ? E.wheels : null;
    node.traverse(o => { if (!o.name) return; if (WN) { for (const k in WN) if (WN[k] === o.name) wg[k] = o; } else if (/^W_(FL|FR|RL|RR)$/.test(o.name)) wg[o.name.slice(2)] = o; });
    A = { node, wheelNodes: wg, plates: null }; }
  // p51 DB9 panels: the OBJ shell has single-sided, flipped and 'transparent at opacity 1' faces, so panels vanished or showed the
  // interior through them from some angles. Opaque materials become truly opaque (depth-written) and double-sided; glass/lamps stay.
  if (key === 'db9' && A?.node) A.node.traverse(m => { if (!m.isMesh || !m.material) return; const ms = Array.isArray(m.material) ? m.material : [m.material];
    for (const mt of ms) { if (/glass|lens|light|lamp/i.test((mt.name || '') + (m.name || '')) || mt === M.glass || mt === M.hglass || (mt.opacity ?? 1) < 0.99 || mt.transmission > 0.2) continue; if (mt.transparent) { mt.transparent = false; mt.depthWrite = true; mt.needsUpdate = true; } if (mt.side !== THREE.DoubleSide) { mt.side = THREE.DoubleSide; mt.needsUpdate = true; } } });
  // orientation (models to -Z forward), then scale non-uniformly to the car's real size (borrowed bodies only)
  const shell = new THREE.Group(); shell.add(A.node);
  if (key === 'db9') { const s0 = new THREE.Box3().setFromObject(shell).getSize(new THREE.Vector3()); shell.scale.setScalar(4.72 / s0.z); }
  const turn = new THREE.Group(); turn.add(shell);
  if (!typed) turn.rotation.y = Math.PI; // first game: +Z forward → here -Z forward
  else { const f = String(E.forward || '+z').toLowerCase().replace(/^([xyz])([+-])$/, '$2$1'); turn.rotation.y = { '+z': Math.PI, z: Math.PI, '-z': 0, '+x': Math.PI / 2, x: Math.PI / 2, '-x': -Math.PI / 2 }[f] ?? Math.PI;
    if (E.scale) shell.scale.multiplyScalar(E.scale); }
  const fit = new THREE.Group(); fit.add(turn);
  const root = new THREE.Group(); root.name = car.id; const bodyG = new THREE.Group(); root.add(bodyG); bodyG.add(fit);
  const own = key.startsWith('type_car_'); // a car's own model is already at its real size: no stretch
  const stretch = !native && !own && car.dims;
  if (stretch) {
    root.updateMatrixWorld(true); const bb = visBox(root); const sz = bb.getSize(new THREE.Vector3());
    // body width measured below the mirrors (lower 60% of the height); cars.json width excludes mirrors
    let wx = 0; const v = new THREE.Vector3(), lim = bb.min.y + sz.y * 0.6;
    root.traverse(o => { if (!o.isMesh || !o.visible) return; const p = o.geometry.attributes.position; const st = Math.max(1, Math.floor(p.count / 3000));
      for (let i = 0; i < p.count; i += st) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); if (v.y < lim) wx = Math.max(wx, Math.abs(v.x - (bb.min.x + bb.max.x) / 2)); } });
    const [L, W, H] = car.dims; fit.scale.set(W / Math.max(0.5, 2 * wx || sz.x), H / sz.y, L / sz.z);
    const mf = key === 'type_mid' && midFit(car.id); if (mf) fit.scale.multiply(new THREE.Vector3(...mf)); // per-car proportions on the shared body (wheels are baked after this, so they follow)
  }
  { root.updateMatrixWorld(true); const bb = visBox(root); fit.position.y -= bb.min.y; fit.position.z -= (bb.min.z + bb.max.z) / 2; fit.position.x -= (bb.min.x + bb.max.x) / 2; }
  root.updateMatrixWorld(true);
  const B0 = visBox(root), S0 = B0.getSize(new THREE.Vector3());
  // wheels: named nodes → bake; per-type models without names → auto-detect; failing that (baked) → carve + separate wheels
  const wheels = []; let R = 0.34, zF = -1.4, zR = 1.4; const zs = [];
  const pushW = (w, k) => { if (!w) return; root.add(w.pivot); R = w.R; zs.push(w.pivot.position.z); wheels.push({ pivot: w.pivot, spin: w.spin, front: k[0] === 'F', side: w.pivot.position.x < 0 ? -1 : 1, baseY: w.pivot.position.y, W: w.W, R: w.R, hasCal: w.hasCal }); w.pivot.traverse(o => { if (o.userData.caliper) o.material = M.caliper; }); };
  let wheelMode = 'named';
  if (Object.keys(A.wheelNodes).length === 4) for (const k of ['FL', 'FR', 'RL', 'RR']) pushW(bakeWheel(A.wheelNodes[k], root, stretch, stretch ? fit.scale.clone() : null), k);
  else if (typed) {
    const meshes = []; bodyG.traverse(o => { if (o.isMesh && o.visible) meshes.push(o); });
    const D = E.wheels === 'baked' ? null : detectWheels(meshes, root, B0);
    if (D) { wheelMode = 'auto'; for (const k of ['FL', 'FR', 'RL', 'RR']) pushW(bakeParts(D[k], true), k); }
    else { // baked wheels: hide them and fit separate wheels at the real wheelbase
      wheelMode = 'baked'; const r = E.wheelR || TYPE_R[car.body] || 0.33, tw = r * 0.68, wb = car.dims?.[3] || S0.z * 0.6, xh = S0.x / 2 - tw / 2 - 0.03;
      const P = []; for (const [k, z] of [['FL', -wb / 2], ['FR', -wb / 2], ['RL', wb / 2], ['RR', wb / 2]]) P.push({ k, x: (k[1] === 'L' ? -1 : 1) * xh, y: r, z: z + (E.wheelZ || 0), R: r, tw });
      carveWheels(meshes, root, P);
      for (const p of P) { const pivot = new THREE.Group(); pivot.position.set(p.x, p.y, p.z); const side = p.x < 0 ? -1 : 1; const spin = simpleWheel(p.R, p.tw, M.rim || (M.rim = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 0.92, roughness: 0.28 })), M, side); pivot.add(spin); pushW({ pivot, spin, R: p.R, W: p.tw }, p.k); }
    }
  }
  if (zs.length === 4) { zF = Math.min(...zs); zR = Math.max(...zs); }
  // tyres on the road: the lowest point of every tyre exactly at y = 0 (the car's origin is the road surface). The whole
  // car moves by the mean offset (keeps the body-to-arch gap), then each wheel is trimmed so none sinks or floats.
  if (wheels.length) { root.updateMatrixWorld(true); const low = wheels.map(w => { const b = visBox(w.spin); return b.isEmpty() ? w.pivot.position.y - w.R : b.min.y; });
    const mean = low.reduce((a, b) => a + b, 0) / low.length; if (Math.abs(mean) > 0.003) { fit.position.y -= mean; for (const w of wheels) w.pivot.position.y -= mean; }
    wheels.forEach((w, i) => { w.pivot.position.y -= low[i] - mean; w.baseY = w.pivot.position.y; }); }
  if (key === 'rrs' && wheels.length === 4) { const rn = GEO.rrs.rim; const own = M.rimStock; stealRims(bodyG, root, wheels, m => !!m && (m === M.rimStock || rn.includes(m.name)), rim || own); }
  // per-type model materials and rim finish on its own wheels
  let typeLights = null;
  if (typed) {
    const meshes = []; bodyG.traverse(o => { if (o.isMesh) meshes.push(o); }); typeLights = mapTypeMaterials(meshes, M, E);
    if (wheelMode !== 'baked') { if (!M.rim) M.rim = null;
      for (const w of wheels) w.spin.traverse(o => { if (!o.isMesh) return; const sw = x => { if (x && RX.tyre.test(x.name || '') && !x.map) return M.rubber; if (!x || RX.tyre.test(x.name || '') || (lum(x) < 0.08 && (x.metalness ?? 0) < 0.5)) return x; if (RX.glass.test(x.name || '')) return M.glass;
        if (!M.rim) M.rim = x; return rim || x; }; o.material = Array.isArray(o.material) ? o.material.map(sw) : sw(o.material); o.castShadow = true; }); }
  }
  // calipers: the Range Rover and DB9 carry their own; every other model gets one per wheel so caliper colours work
  if (key !== 'rrs' && key !== 'db9') for (const w of wheels) if (!w.hasCal) addCaliper(w, M);
  if (key === 'type_mid' && MID[car.id] && opts.warp !== false) try { warpMid(car, root, bodyG, wheels); } catch (e) { console.warn('mid warp failed', car.id, e); }
  root.updateMatrixWorld(true);
  const bbF = visBox(root); const sz = bbF.getSize(new THREE.Vector3());
  const bodyMeshes = []; bodyG.traverse(o => { if (o.isMesh && o.visible) bodyMeshes.push(o); });
  const rc = new THREE.Raycaster(); const hit = (o, d) => { rc.set(o, d); rc.far = 20; return rc.intersectObjects(bodyMeshes, false)[0] || null; };
  // plates (UK: white front, yellow rear)
  const pl = (E?.plateText || opts.plate || 'CUZZY').slice(0, 8).toUpperCase(), cl = E?.plateClassic;
  { const pf = plateMesh(cl ? 'classic' : '#f4f4f0', pl), pr = plateMesh(cl ? 'classic' : '#f5c800', pl);
    if (typed) { pf.geometry.rotateY(Math.PI);
      const hf = hit(new THREE.Vector3(0, bbF.min.y + sz.y * 0.3, bbF.min.z - 2), new THREE.Vector3(0, 0, 1)); pf.position.set(0, bbF.min.y + sz.y * 0.3, (hf ? hf.point.z : bbF.min.z) - 0.012);
      const pv = E?.plateV ?? MID[car?.id]?.plateV ?? 0.4; const hr = hit(new THREE.Vector3(0, bbF.min.y + sz.y * pv, bbF.max.z + 2), new THREE.Vector3(0, 0, -1)); pr.position.set(0, bbF.min.y + sz.y * pv, (hr ? hr.point.z : bbF.max.z) + 0.012);
      if (E?.plateV && hr?.face) { const nz = hr.face.normal.clone().transformDirection(hr.object.matrixWorld); const tilt = Math.atan2(-nz.y, Math.max(0.2, nz.z)); if (Math.abs(tilt) < 0.6) pr.rotation.x = -tilt; pr.position.z += 0.01; } // follow a sloped boot lid
      if (E?.plates !== false) { bodyG.add(pr); if (E?.plateFront !== false) bodyG.add(pf); }
    if (E?.timeMachine) bodyG.userData.timeMachine = true;
    if (E?.turbo) { // Super Pursuit Mode: bevelled body-colour panels slide out of the shell, rear wing rises, vents glow, boosters fire
      let paint = null; bodyG.traverse(o => { if (!paint && o.isMesh && (o.material?.name === E.paint || /paint/i.test(o.material?.name || ''))) paint = o.material; });
      const blk = paint ? paint.clone() : new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.22, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.04 });
      const vent = new THREE.MeshBasicMaterial({ color: 0xff3a10, toneMapped: false }), trim = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, metalness: 0.8, roughness: 0.35 });
      const parts = [], fx = [], y0 = bbF.min.y, Lz = bbF.max.z - bbF.min.z, W = sz.x / 2, f = bbF.min.z, r = bbF.max.z;
      const wedge = (pts, depth, mat) => { const sh = new THREE.Shape(); pts.forEach(([u, v], i) => i ? sh.lineTo(u, v) : sh.moveTo(u, v)); const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.018, bevelSegments: 5, curveSegments: 8 }); g.translate(0, 0, -depth / 2); return new THREE.Mesh(g, mat); };
      const add = (m, x, yy, z, out, ry = 0) => { m.position.set(x, yy, z); m.rotation.y = ry; m.userData.rest = m.position.clone(); m.userData.out = out; m.visible = false; bodyG.add(m); parts.push(m); return m; };
      for (const sx of [-1, 1]) {
        // side skirt/flare running the length of the doors, sliding outwards from the sill
        const sk = wedge([[0, 0], [Lz * 0.5, 0], [Lz * 0.47, 0.1], [0.04, 0.09]], 0.06, blk); add(sk, sx * (W - 0.06), y0 + 0.17, f + Lz * 0.2, new THREE.Vector3(-sx * 0.1, 0, 0), -Math.PI / 2);
        for (let i = 0; i < 3; i++) { const v = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.22), vent); v.position.set(sx * 0.05, 0.05 + i * 0.035, -0.1); sk.add(v); v.rotation.y = Math.PI / 2; v.position.set(Lz * 0.5, 0.05 + i * 0.035, sx * 0.05); }
        // rear quarter flare with louvres, wider and taller than the stock arch
        const fl = wedge([[0, 0], [0.5, 0], [0.42, 0.16], [0.08, 0.13]], 0.06, blk); add(fl, sx * (W - 0.07), y0 + 0.36, r - Lz * 0.12, new THREE.Vector3(-sx * 0.13, 0, 0), sx > 0 ? -Math.PI / 2 : -Math.PI / 2);
        // front canards
        
        // rear wing struts
        const st = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.1, 0.06), trim); add(st, sx * W * 0.6, y0 + sz.y * 0.6, r - 0.22, new THREE.Vector3(0, -0.09, 0));
        // booster nozzles and flames at the rear valance
        
        const fm = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.9, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        fm.rotation.x = -Math.PI / 2; fm.position.set(sx * 0.26, y0 + 0.24, r + 0.45); fm.visible = false; bodyG.add(fm); fx.push(fm);
        const core = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.5, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        core.rotation.x = -Math.PI / 2; core.position.set(sx * 0.26, y0 + 0.24, r + 0.25); core.visible = false; bodyG.add(core); fx.push(core); }
      // bonnet: the centre section over the turbine rises into a raised scoop
      const hood = wedge([[0, 0], [Lz * 0.3, 0], [Lz * 0.3, 0.035], [0.05, 0.06]], sz.x * 0.36, blk); add(hood, 0, y0 + sz.y * 0.6, f + Lz * 0.12, new THREE.Vector3(0, -0.06, 0), -Math.PI / 2);
      for (const sx of [-1, 1]) { // side airfoils that swing out of the rear quarters (the DeLorean-like profile)
        const fo = wedge([[0, 0], [0.62, 0], [0.55, 0.035], [0.06, 0.05]], 0.2, blk); fo.rotation.z = sx * 0.08; add(fo, sx * (W + 0.06), y0 + sz.y * 0.47, r - Lz * 0.42, new THREE.Vector3(-sx * 0.2, 0, 0), -Math.PI / 2); }
      // extended front air dam with intake slots
      const dam = wedge([[0, 0], [0.18, 0], [0.18, 0.04], [0.02, 0.08]], sz.x * 0.86, blk); add(dam, 0, y0 + 0.07, f + 0.06, new THREE.Vector3(0, 0, 0.16), Math.PI / 2);
      // raised rear wing with end plates
      const wing = wedge([[0, 0], [0.24, 0], [0.21, 0.03], [0.02, 0.04]], sz.x * 0.8, blk); add(wing, 0, y0 + sz.y * 0.66, r - 0.08, new THREE.Vector3(0, -0.1, 0), -Math.PI / 2);
      for (const sx of [-1, 1]) { const ep = wedge([[0, 0], [0.26, 0], [0.23, 0.08], [0.03, 0.06]], 0.01, blk); add(ep, sx * sz.x * 0.4, y0 + sz.y * 0.64, r - 0.08, new THREE.Vector3(0, -0.1, 0), -Math.PI / 2); }
      for (const sx of [-1, 1]) { const g = new THREE.BoxGeometry(sz.x * 0.3, 0.012, 0.22); g.translate(0, 0, -0.11); const ab = new THREE.Mesh(g, blk); add(ab, sx * sz.x * 0.2, y0 + sz.y * 0.56, r - 0.25, new THREE.Vector3(0, -0.02, 0)); ab.userData.air = 1; } // air brakes on the boot lid
      bodyG.userData.spm = parts; bodyG.userData.boostFx = fx; }
    if (E?.scanner) { const C = E.scanner, n = C.n || 8, mats = [], g = new THREE.Group(); g.name = 'scanner'; let y = bbF.min.y + sz.y * C.v; // KITT-style sweeping red scanner
      { const ys = []; let src = null; for (let f = 0.15; f < 0.9; f += 0.005) { const yy = bbF.min.y + sz.y * f, h = hit(new THREE.Vector3(0, yy, bbF.min.z - 2), new THREE.Vector3(0, 0, 1)); if (h && (h.object.material === M.tail || /red/i.test(h.object.userData.srcMat || ''))) { ys.push(yy); src = h.object; } }
        if (ys.length) { y = (ys[0] + ys[ys.length - 1]) / 2; C.h = Math.max(0.025, Math.min(0.06, ys[ys.length - 1] - ys[0])); if (src) src.material = new THREE.MeshStandardMaterial({ color: 0x120202, roughness: 0.35 }); } } // sit on the model's own scanner slot
      const zAt = x => { const h = hit(new THREE.Vector3(x, y, bbF.min.z - 2), new THREE.Vector3(0, 0, 1)); return h ? h.point.z : null; };
      const slot = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.4 });
      for (let i = 0; i < n; i++) mats.push({ emissiveIntensity: 0 });
      const z0 = (zAt(0) ?? bbF.min.z) - 0.012, H = (C.h || 0.035) * 1.4; // one glowing bar drawn each frame: a hot red core that sweeps with a fading trail, behind smoked glass
      const cv = document.createElement('canvas'); cv.width = 256; cv.height = 16; const cx = cv.getContext('2d'), tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(C.w, H), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })); bar.position.set(0, y, z0); bar.rotation.y = Math.PI; g.add(bar);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(C.w * 1.08, H * 1.5), new THREE.MeshStandardMaterial({ color: 0x030303, roughness: 0.3 })); back.position.set(0, y, z0 + 0.004); back.rotation.y = Math.PI; g.add(back);
      mats.draw = () => { cx.fillStyle = '#100000'; cx.fillRect(0, 0, 256, 16); const w = 256 / n;
        for (let i = 0; i < n; i++) { const k = Math.min(1, mats[i].emissiveIntensity / 7); if (k < 0.02) continue; const xc = (i + 0.5) * w, gr = cx.createRadialGradient(xc, 8, 0, xc, 8, w * 1.1);
          gr.addColorStop(0, `rgba(255,${Math.round(40 + 150 * k * k)},${Math.round(60 * k * k)},${k})`); gr.addColorStop(0.45, `rgba(255,0,0,${0.85 * k})`); gr.addColorStop(1, 'rgba(255,0,0,0)'); cx.fillStyle = gr; cx.fillRect(xc - w * 1.1, 0, w * 2.2, 16); }
        cx.fillStyle = 'rgba(0,0,0,0.35)'; for (let i = 1; i < n; i++) cx.fillRect(i * w - 1, 0, 2, 16); tex.needsUpdate = true; };
      g.userData.scanner = mats; bodyG.add(g); }
    }
    else if (key !== 'db9') { const P = A.plates; pr.geometry.rotateY(Math.PI); pf.position.set(P.pf[0], P.pf[1], P.pf[2]); pf.rotation.x = P.pf[3]; pr.position.set(P.pr[0], P.pr[1], P.pr[2]); pr.rotation.x = P.pr[3]; A.node.add(pf, pr); }
    else { pf.geometry.rotateX(Math.PI / 2); pr.geometry.rotateX(Math.PI / 2); pr.geometry.rotateZ(Math.PI); pf.position.set(0, -2.375, 0.30); pr.position.set(0, 2.305, 0.705); A.chassis.add(pf, pr); } }
  const sideHit = (sx, y, z, x0) => { const h = hit(new THREE.Vector3(sx * 3, y, z), new THREE.Vector3(-sx, 0, 0)); return h ? new THREE.Vector3(h.point.x + sx * 0.01, y, z) : new THREE.Vector3(sx * (x0 + 0.14), y, z); };
  const fw = wheels.filter(w => w.front); const xF = fw.length ? Math.max(...fw.map(w => Math.abs(w.pivot.position.x))) : sz.x * 0.4; const yF = fw.length ? fw[0].pivot.position.y : R;
  // lights for setLights(): head / tail are the model's own lamp materials (small lenses are added where a model has none)
  const rev = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0 });
  const ind = new THREE.MeshStandardMaterial({ color: 0xffa020, emissive: 0xff8a00, emissiveIntensity: 0 });
  if (typed) {
    M.head = typeLights.head; M.tail = typeLights.tail;
    if (own) for (const L of [M.head, M.tail]) if (L && L.map && L.emissive && !L.emissiveMap) { L.emissiveMap = L.map; L.emissive.setHex(0xffffff); L.needsUpdate = true; } // own models: lamps glow in their own texture colours (no white slab)
    const lens = (mat, y, zEnd, dir, w, h) => { for (const sx of [-1, 1]) { const x = sx * sz.x * 0.36; const hh = hit(new THREE.Vector3(x, y, zEnd - dir * 2), new THREE.Vector3(0, 0, dir)); const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), mat); m.position.set(x, y, (hh ? hh.point.z : zEnd) - dir * 0.008); bodyG.add(m); } };
    if (!M.head && own) M.head = new THREE.MeshStandardMaterial({ emissive: 0xfff4dd });
    if (!M.head) { M.head = new THREE.MeshPhysicalMaterial({ color: 0xffffff, emissive: 0xfff4dd, emissiveIntensity: 0.4, roughness: 0.1 }); lens(M.head, bbF.min.y + sz.y * 0.5, bbF.min.z, 1, 0.26, 0.07); }
    if (!M.tail && own) M.tail = new THREE.MeshStandardMaterial({ emissive: 0xff1508 }); // own models keep their own lamp clusters (no added lens)
    if (!M.tail) { M.tail = new THREE.MeshStandardMaterial({ color: 0xd01a12, emissive: 0xff1508, emissiveIntensity: 1.4, roughness: 0.25 }); lens(M.tail, bbF.min.y + sz.y * 0.58, bbF.max.z, -1, 0.26, 0.07); }
  }
  if (key === 'type_mid') try { const t0 = performance.now(); styleMid(car, root, bodyG, M, wheels, bbF, bodyMeshes, colour, opts); root.userData.styleMs = Math.round(performance.now() - t0); } catch (e) { console.warn('mid styling failed', car.id, e); }
  if (!own) for (const sx of [-1, 1]) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.01), rev); r.position.set(sx * 0.35, bbF.min.y + sz.y * 0.36, bbF.max.z + 0.005); bodyG.add(r);
    const i = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.08), ind); i.position.copy(sideHit(sx, yF + R * 1.05, zF + R * 1.45, xF)); bodyG.add(i); } // side repeater on the wing just behind the front arch
  root.userData.wheels = wheels; root.userData.body = bodyG; root.userData.lights = { head: M.head, tail: M.tail, rev, ind }; root.userData.paint = M.paint;
  root.userData.dims = { L: sz.z, W: sz.x, H: sz.y, R, zF, zR };
  root.userData.real = native ? key : 'gen_' + key; root.userData.realKey = key; root.userData.wheelMode = wheelMode; // photo cockpits only for their own cars
  // driver's eye (right-hand drive) and bonnet camera, in body space
  root.updateMatrixWorld(true);
  const genericEye = () => { // right-hand seat, just under the roof (or at a sensible height for open cars)
    const ex = sz.x * 0.2 * (E?.lhd ? -1 : 1), ez = (zF + zR) / 2 + ((/mid|hyper/.test(car.body)) ? -0.02 : 0.06) * sz.z;
    const h = hit(new THREE.Vector3(ex, bbF.max.y + 1, ez), new THREE.Vector3(0, -1, 0));
    let y = bbF.min.y + sz.y * 0.8; if (h && h.point.y > bbF.min.y + sz.y * 0.72) y = Math.min(y, h.point.y - 0.14);
    return new THREE.Vector3(ex, Math.max(bbF.min.y + 0.75, y), ez); };
  if (key === 'db9') { let drv = null; bodyG.traverse(o => { if (o.isMesh && o.material === M.driver) drv = o; });
    let eye = new THREE.Vector3(0.38, 1.1, 0.25);
    if (drv) { const g = drv.geometry, pa = g.attributes.position, v = new THREE.Vector3(); let top = -1e9; const pts = [];
      for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i).applyMatrix4(drv.matrixWorld); pts.push(v.clone()); if (v.y > top) top = v.y; }
      const head = pts.filter(q => q.y > top - 0.14); const c = head.reduce((a, q) => a.add(q), new THREE.Vector3()).multiplyScalar(1 / head.length);
      eye = new THREE.Vector3(c.x, top - 0.02, c.z - 0.02); }
    root.userData.cockpit = eye; root.userData.driverMesh = drv; }
  else if (!typed) { const EYE = { rrs: [-0.40, 1.46, -0.12], box: [-0.37, 1.04, -0.30] }; const e = new THREE.Vector3(...EYE[key]); shell.updateMatrix(); turn.updateMatrix(); fit.updateMatrix(); e.applyMatrix4(shell.matrix).applyMatrix4(turn.matrix).applyMatrix4(fit.matrix); root.userData.cockpit = e; }
  else root.userData.cockpit = E.eye ? new THREE.Vector3(...E.eye) : genericEye();
  { const e = root.userData.cockpit; root.userData.bonnetCam = new THREE.Vector3(0, e.y - 0.02, e.z - 1.0); } // both refined by fitInCarCams (carmodel.js)
  // contact shadow
  const blob = contactShadow(sz.x, sz.z, wheels.map(w => [w.pivot.position.x, w.pivot.position.z]), R); blob.position.x = (bbF.min.x + bbF.max.x) / 2; blob.position.z = (bbF.min.z + bbF.max.z) / 2; root.add(blob); root.userData.blob = blob; void BLOB_TEX;
  root.userData.rubberMats = [M.rubber]; attachCarFx(root, [M.paint]);
  root.userData.rimMat = M.rim || null; root.userData.calMat = M.caliper; root.userData.glassMesh = M.glass;
  return root;
}
// Range Rover: its main dark rims are part of the body mesh — move the triangles near each wheel centre into that
// wheel's spin group so they turn with the wheel and take the rim finish
function stealRims(bodyG, root, wheels, isRim, rimM) {
  root.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(); const ms = []; bodyG.traverse(o => { if (o.isMesh && matsOf(o).some(isRim)) ms.push(o); });
  let moved = 0;
  for (const o of ms) {
    let g = toRoot(o, inv); if (g.index) g = g.toNonIndexed(); const p = g.attributes.position, n = p.count / 3, keep = [], bins = wheels.map(() => []);
    const mats = Array.isArray(o.material) ? o.material : null; const mOf = t => { if (!mats) return o.material; for (const gr of g.groups) if (t * 3 >= gr.start && t * 3 < gr.start + gr.count) return mats[gr.materialIndex]; return mats[0]; };
    for (let t = 0; t < n; t++) { let k = -1; if (isRim(mOf(t))) { const x = (p.getX(t * 3) + p.getX(t * 3 + 1) + p.getX(t * 3 + 2)) / 3, y = (p.getY(t * 3) + p.getY(t * 3 + 1) + p.getY(t * 3 + 2)) / 3, z = (p.getZ(t * 3) + p.getZ(t * 3 + 1) + p.getZ(t * 3 + 2)) / 3;
      k = wheels.findIndex(w => { const c = w.pivot.position; return Math.sign(x) === Math.sign(c.x) && (y - c.y) ** 2 + (z - c.z) ** 2 < (w.R * 1.02) ** 2 && Math.abs(x - c.x) < 0.3; }); }
      if (k >= 0) bins[k].push(t); else keep.push(t); }
    if (keep.length === n) continue; moved += n - keep.length;
    bins.forEach((tris, k) => { if (!tris.length) return; const sg = subGeo(g, tris); const c = wheels[k].pivot.position; sg.translate(-c.x, -c.y, -c.z); const m = new THREE.Mesh(sg, rimM); m.castShadow = true; wheels[k].spin.add(m); });
    // the rest of the mesh stays on the body (now in root space, so it is re-parented to the body group)
    const rest = subGeo(g, keep); rest.groups = []; let st = 0; if (mats) { const byM = new Map(); keep.forEach((t, j) => { const m = mOf(t); (byM.get(m) || byM.set(m, []).get(m)).push(j); });
      const order = [...byM.keys()]; const tri = order.flatMap(m => byM.get(m)); const r2 = subGeo(rest, tri); order.forEach((m, i) => { r2.addGroup(st * 3, byM.get(m).length * 3, i); st += byM.get(m).length; }); const nm = new THREE.Mesh(r2, order); nm.castShadow = true; bodyG.add(nm); }
    else { const nm = new THREE.Mesh(rest, o.material); nm.castShadow = true; bodyG.add(nm); }
    bodyG.updateMatrixWorld(true); const bi = new THREE.Matrix4().copy(bodyG.matrixWorld).invert().multiply(root.matrixWorld); bodyG.children[bodyG.children.length - 1].applyMatrix4(bi);
    o.parent?.remove(o);
  }
  return moved;
}
