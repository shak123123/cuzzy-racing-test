// "look" pass (photoreal push): runs once after the world is built. Visual only, no collision / geometry changes to roads.
//  * CC0 photo-scanned PBR sets (Poly Haven, see img/city/CREDITS_LOOK.md): albedo + normal from cityTex, plus a packed
//    ORM map (R = AO, G = roughness) added here to every material that uses one of those sets
//  * world-space macro variation (two octaves of value noise) on walls / ground: breaks visible tiling at distance
//  * shader grime "decals" on the ground: oil drips mid-lane, tyre-darkened wheel tracks, chewing gum + stains on
//    paving, damp edges (darker, glossier) near kerbs and building bases
//  * granite kerb texture, terrace facade dressing (gutters, downpipes, satellite dishes)
// Tiering: Low (env 0) only gets the new albedo; Medium adds ORM + macro; High+ adds grime and facade dressing.
import * as THREE from 'three';
import { mergeGeometries } from './lib/addons/utils/BufferGeometryUtils.js';

const TL = new THREE.TextureLoader(); const cache = {};
function tex(q, file, srgb) { if (cache[file]) return cache[file]; const t = TL.load(new URL(`../img/city/${file}`, import.meta.url).href); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = q.aniso || 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return (cache[file] = t); }
const SETS = ['brick_victorian', 'brick_red', 'brick_dark', 'brick_buff', 'render', 'roof', 'paving', 'concrete', 'road'];
const GROUND = { paving: 1, concrete: 1, road: 2, kerb: 3 };
function setOf(t, W) { if (!t) return null; if (W && (t === W.T.asphalt || t === W.T.asphaltN)) return 'road'; const n = t.userData?.set; return n && SETS.includes(n) ? n : null; }

const NOISE = `
float lkH( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float lkN( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f ); return mix( mix( lkH( i ), lkH( i + vec2( 1, 0 ) ), f.x ), mix( lkH( i + vec2( 0, 1 ) ), lkH( i + vec2( 1, 1 ) ), f.x ), f.y ); }
float lkF( vec2 p ) { return lkN( p ) * 0.6 + lkN( p * 2.7 + 13.1 ) * 0.4; }`;
// kind: 0 wall, 1 paving, 2 road, 3 kerb
function inject(m, kind, grime) {
  if (m.userData.lookDone) return; m.userData.lookDone = true;
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (sh, r) => { prev?.call(m, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLkWP;').replace('#include <fog_vertex>', '#include <fog_vertex>\nvLkWP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLkWP; float lkWet;' + NOISE)
      .replace('#include <color_fragment>', `#include <color_fragment>
      { vec2 wp = ${kind === 0 ? 'vec2( vLkWP.x + vLkWP.z, vLkWP.y * 1.7 )' : 'vLkWP.xz'};
        float mac = lkF( wp * 0.07 ) * 0.7 + lkF( wp * 0.31 ) * 0.3; diffuseColor.rgb *= 0.84 + 0.3 * mac; // macro variation
        lkWet = 0.0;
        ${grime && kind === 2 ? `float oil = smoothstep( 0.62, 0.8, lkF( wp * vec2( 0.9, 0.25 ) ) ) * smoothstep( 0.5, 0.7, lkF( wp * 0.05 + 7.0 ) );
        float spot = smoothstep( 0.86, 0.95, lkN( wp * 1.9 ) ); diffuseColor.rgb *= 1.0 - 0.38 * clamp( oil + spot * 0.6, 0.0, 1.0 ); lkWet = oil * 0.6;` : ''}
        ${grime && kind === 1 ? `float gum = step( 0.985, lkH( floor( wp * 6.0 ) ) ) * smoothstep( 0.45, 0.2, length( fract( wp * 6.0 ) - 0.5 ) );
        float stn = smoothstep( 0.66, 0.82, lkF( wp * 0.35 + 3.0 ) ); diffuseColor.rgb *= ( 1.0 - 0.3 * stn ) * ( 1.0 - 0.55 * gum );
        lkWet = smoothstep( 0.58, 0.75, lkF( wp * 0.12 + 11.0 ) ) * 0.7;` : ''}
        ${grime && kind === 3 ? 'lkWet = 0.4 + 0.4 * lkF( wp * 0.5 );' : ''}
        ${grime && kind === 0 ? 'lkWet = ( 1.0 - smoothstep( 0.0, 0.5 + 0.4 * mac, vLkWP.y ) ) * 0.8; diffuseColor.rgb *= 1.0 - 0.3 * lkWet;' : ''}
        diffuseColor.rgb *= 1.0 - 0.22 * lkWet; }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, roughnessFactor * 0.45, lkWet );');
  };
  const k = `look${kind}${grime ? 'g' : ''}`; m.customProgramCacheKey = () => (prevKey ? prevKey() : '') + k; m.needsUpdate = true;
}

export function applyLook(world, q) {
  const env = q.env | 0, grime = env >= 2; let nMat = 0; const seen = new Set();
  const kerbM = tex(q, `kerb_${env >= 2 ? '1k' : '512'}.jpg`, true), kerbN = env >= 1 ? tex(q, `kerb_n_${env >= 2 ? '1k' : '512'}.jpg`) : null;
  world.group.traverse(o => { if (!o.isMesh) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
    if (!m || seen.has(m) || !m.isMeshStandardMaterial) continue; seen.add(m);
    if (world._kerbT && m.map === world._kerbT) { m.map = kerbM; m.normalMap = kerbN; m.color.set(0xe6e3dc); m.roughness = 0.85; if (env >= 1) inject(m, 3, grime); nMat++; continue; }
    if (m.userData.kind) { if (env >= 1) inject(m, 0, grime); nMat++; continue; } // facades: wall albedo / normal come from the shader's own wallMap
    const set = setOf(m.map, world) || setOf(m.normalMap, world); if (!set) continue;
    if (env >= 1 && set !== 'road') { const orm = tex(q, `${set}_orm_${env >= 2 ? '1k' : '512'}.jpg`); orm.repeat.copy(m.map?.repeat || orm.repeat); m.aoMap = orm; m.aoMapIntensity = 0.8; m.roughnessMap = orm; m.roughness = 1; }
    if (set === 'road' && env >= 1) { m.roughness = 1; m.color.set(0xb4b4b4); }
    if (env >= 1) inject(m, GROUND[set] || 0, grime); m.needsUpdate = true; nMat++; } });
  if (env >= 2) dressTerraces(world, q);
  return nMat;
}

// gutters (black uPVC half-round), downpipes on alternate party walls, the odd satellite dish: High+ only, 3 merged draws
function dressTerraces(world, q) {
  const T = world.terraces || []; if (!T.length || !world.nearestRoad) return; const gut = [], pipe = [], dish = []; const EAVE = 6.45;
  const rnd = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };
  for (const pts of T) { let best = null, bd = 14;
    for (let i = 0; i < pts.length; i++) { const A = pts[i], B = pts[(i + 1) % pts.length], L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L < 3.5) continue; const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2; const r = world.nearestRoad(mx, mz); if (r && r.d - r.hw < bd) { bd = r.d - r.hw; best = { A, B, L, r, mx, mz }; } }
    if (!best) continue; const { A, B, L, r, mx, mz } = best; let nx = -(B[1] - A[1]) / L, nz = (B[0] - A[0]) / L; if ((r.px - mx) * nx + (r.pz - mz) * nz < 0) { nx = -nx; nz = -nz; }
    const ux = (B[0] - A[0]) / L, uz = (B[1] - A[1]) / L, yaw = Math.atan2(ux, uz);
    const g = new THREE.CylinderGeometry(0.06, 0.06, L, 6, 1, true); g.rotateX(Math.PI / 2); g.rotateY(yaw); g.translate(mx + nx * 0.1, EAVE, mz + nz * 0.1); gut.push(g);
    const k = Math.max(1, Math.round(L / 4.6)), w = L / k;
    for (let j = 0; j <= k; j += 2) { const s = j * w, px = A[0] + ux * s + nx * 0.07, pz = A[1] + uz * s + nz * 0.07; const p = new THREE.CylinderGeometry(0.035, 0.035, EAVE, 6); p.translate(px, EAVE / 2, pz); pipe.push(p); }
    for (let j = 0; j < k; j++) { const s = (j + 0.5) * w, px = A[0] + ux * s, pz = A[1] + uz * s; if (rnd(px, pz) > 0.3) continue;
      const d = new THREE.SphereGeometry(0.3, 10, 4, 0, Math.PI * 2, 0, 0.9); d.scale(1, 1, 0.35); d.rotateX(-Math.PI / 2); d.rotateY(yaw + Math.PI / 2 + (rnd(pz, px) - 0.5) * 0.8); d.rotateZ(0); d.translate(px + nx * 0.35, 5.2 + rnd(px + 1, pz) * 0.6, pz + nz * 0.35); dish.push(d);
      const arm = new THREE.BoxGeometry(0.04, 0.04, 0.35); arm.rotateY(yaw + Math.PI / 2); arm.translate(px + nx * 0.18, 5.2, pz + nz * 0.18); dish.push(arm); } }
  const add = (L, mat) => { if (!L.length) return; const m = new THREE.Mesh(mergeGeometries(L.map(g => g.index ? g.toNonIndexed() : g).map(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k); return g; })), mat); m.castShadow = false; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix(); world.group.add(m); };
  const pv = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.45 });
  add(gut, pv); add(pipe, pv); add(dish, new THREE.MeshStandardMaterial({ color: 0xd8d8d4, roughness: 0.5 }));
  world.lookDressing = { gutters: gut.length, pipes: pipe.length, dishes: dish.length / 2 };
}
