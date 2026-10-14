// Street life: parked cars in the city's surface car parks (OSM amenity=parking areas, drawn with the car-park texture),
// plus pedestrians on the pavements (instanced low-poly figures, High and above).
// Parked cars never stand on anything drivable (roads, junction discs, race lanes, the meet pad) and never overlap a
// building, tree, lamp, rail or another car: they sit in bays laid out inside the car-park polygon, off the road.
// Each one gets a solid box collider through World.addBuildingCollider, so driving into a car park you bump into them.
// Cars reuse the game's own procedural car bodies (buildCar, lowest detail), baked into one merged mesh per material
// and drawn instanced per 160 m cell; paint colour is per instance. Cells are hidden beyond a preset distance.
import * as THREE from 'three';
import { mergeGeometries } from './lib/addons/utils/BufferGeometryUtils.js';
import { buildCar } from './carmodel.js';

const dm = v => v / 10;
const MOB = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
// distance LOD by vertex clustering: snap positions to a q-metre grid and drop the triangles that collapse. Works on
// non-indexed geometry, keeps every attribute (normals stay the originals, so the silhouette is simplified, not the shading)
export function clusterLOD(g, q) {
  if (g.index) g = g.toNonIndexed(); const P = g.attributes.position, n = P.count, keep = [];
  const sn = (i, k) => Math.round(P.array[i * 3 + k] / q);
  for (let t = 0; t < n; t += 3) { const a = [0, 1, 2].map(j => sn(t + j, 0) + ',' + sn(t + j, 1) + ',' + sn(t + j, 2)); if (a[0] !== a[1] && a[1] !== a[2] && a[0] !== a[2]) keep.push(t); }
  const out = new THREE.BufferGeometry();
  for (const nm of Object.keys(g.attributes)) { const A = g.attributes[nm], is = A.itemSize, arr = new A.array.constructor(keep.length * 3 * is); let o = 0;
    for (const t of keep) for (let j = 0; j < 3; j++) { const src = (t + j) * is; for (let k = 0; k < is; k++) arr[o++] = nm === 'position' ? Math.round(A.array[src + k] / q) * q : A.array[src + k]; }
    out.setAttribute(nm, new THREE.BufferAttribute(arr, is, A.normalized)); }
  out.computeBoundingSphere(); return out;
}
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const inPoly = (x, z, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
// real-world UK car colour mix (grey / black / white / silver / blue dominate, a few reds and greens)
const PAINTS = [0x2b2d31, 0x16171a, 0xe8e8e6, 0xa7abb0, 0x6d7278, 0x1f3354, 0x3a5f8f, 0x7a1418, 0xb3261e, 0x2e4a3a, 0x8c8f93, 0xd9d6cf, 0x0d0e10, 0x4b4f55];
const SENT = 0xff00ff;
// footway sample test: not on / within 0.6 m of any drivable piece (race lanes included), not inside a building
const pedFree = (W, x, z, h) => !W.onAnyDrive(x, z, h, -0.6) && !W.insideBuilding?.(x, z, h) && !W.driveAt(x, z, h, 1.5);
// Pedestrian figure (~1.75 m, 8 heads tall, facing +z). One merged geometry holds every outfit / hair part; per-vertex
// attributes: aSlot (0 top, 1 bottoms, 2 skin, 3 hair / headscarf, 4 shoes, 5 dark), aLimb (0 body, 1/2 L/R leg,
// 3/4 L/R arm), aKnee (1 = below knee / elbow: bends), aPart (-1 always, else bit index of an optional part; a
// per-instance bit mask shows it, hidden parts collapse to a point), aShade (vertex-colour shading: eye sockets, brows,
// nose, lips, cheeks, under-chin). The walk cycle (hip + knee, shoulder + elbow, torso counter-twist, hip sway, bob) runs
// in the vertex shader from the per-instance iWalk = (phase, rad/s, sway, stride).
// feat: modelled eyes / brows (every non-textured face); shak: the photo face decal (Shak, the game's creator, asked
// for his face on a share of the male walkers: img/people/ped_shak_face.jpg, built by img/people/make_face.py) with his
// textured short hair shell (hairT); soleW / soleD: white trainer sole or dark shoe sole.
const PB = { hairS: 0, hairL: 1, pony: 2, hijab: 3, cap: 4, trou: 5, bare: 6, skirt: 7, dress: 8, jacket: 9, hood: 10, slvL: 11, slvS: 12, bun: 13, feat: 14, shak: 15, hairT: 16, soleW: 17, soleD: 18 };
// aUv regions (the fragment shader picks by range): 0..1 planar face decal (head, nose, lips); 2..4 cloth (fold normal
// map, cylindrical round each part, scaled by its girth); 4..6 hair (strand normal map); >= 8 plain (skin, shoes, eyes)
const FACE_R = 0.13, HAIR_C = 0x1a1516, SHAK_SKIN = 0xb58066;
function hash3(x, y, z) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }
// smooth value noise for hair tufts (3-D, cheap)
function vnoise(x, y, z) { const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz; const sm = t => t * t * (3 - 2 * t); const u = sm(fx), v = sm(fy), w = sm(fz); let r = 0;
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) r += hash3(ix + a, iy + b, iz + c) * (a ? u : 1 - u) * (b ? v : 1 - v) * (c ? w : 1 - w); return r; }
function pedGeometry() {
  const parts = [];
  const add = (g, o) => { if (o.sx || o.sy || o.sz) g.scale(o.sx || 1, o.sy || 1, o.sz || 1); if (o.rx) g.rotateX(o.rx); if (o.rz) g.rotateZ(o.rz); g.translate(o.x || 0, o.y || 0, o.z || 0); if (o.fn) o.fn(g);
    g = g.index ? g.toNonIndexed() : g; g.deleteAttribute('uv'); const n = g.attributes.position.count;
    { const P = g.attributes.position, a = new Float32Array(n * 2), cx = o.x || 0, cz = o.z || 0, hairish = o.slot === 3 && o.part !== PB.hijab, cloth = o.slot <= 1 || (o.slot === 3 && !hairish);
      let r = 0; for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(P.getX(i) - cx, P.getZ(i) - cz)); const per = Math.min(1.9, Math.max(0.35, 2 * Math.PI * r * 2));
      for (let i = 0; i < n; i++) { const x = P.getX(i), y = P.getY(i), z = P.getZ(i), an = Math.atan2(x - cx, z - cz) / (2 * Math.PI) + 0.5;
        if (o.face) { a[i * 2] = Math.min(1, Math.max(0, (x + FACE_R) / (2 * FACE_R))); a[i * 2 + 1] = Math.min(0.995, Math.max(0, (y - HY + FACE_R) / (2 * FACE_R))); }
        else if (hairish) { a[i * 2] = 4 + an * 1.9; a[i * 2 + 1] = y * 7; }
        else if (cloth) { a[i * 2] = 2 + an * per; a[i * 2 + 1] = y * 1.6; }
        else { a[i * 2] = 9; a[i * 2 + 1] = 0; } }
      g.setAttribute('aUv', new THREE.BufferAttribute(a, 2)); }
    { const a = new Float32Array(n * 4); for (let i = 0; i < n; i++) a.set([o.slot, o.limb || 0, o.knee || 0, o.part ?? -1], i * 4); g.setAttribute('aPed', new THREE.BufferAttribute(a, 4)); } // slot, limb, knee, part
    if (!g.attributes.aShade) { const s = new Float32Array(n * 3).fill(1); if (o.shadeFn) { const P = g.attributes.position; for (let i = 0; i < n; i++) o.shadeFn(P.getX(i), P.getY(i), P.getZ(i), s, i * 3); } g.setAttribute('aShade', new THREE.BufferAttribute(s, 3)); }
    parts.push(g); };
  const cyl = (rt, rb, h, seg = 8, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
  const sph = (r, w = 8, h = 6, t0 = 0, tl = Math.PI) => new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, t0, tl);
  // ---- head: skull 0.22 m tall (1.53..1.75), narrower jaw, face on +z; features painted by vertex colour
  const HY = 1.64, HR = 0.105;
  { const g = sph(HR, 24, 16); const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) { let x = P.getX(i), y = P.getY(i), z = P.getZ(i); const ny = y / HR;
      const jaw = ny < 0 ? 1 - 0.2 * Math.min(1, -ny) ** 1.3 : 1; x *= 0.78 * jaw; z *= (z > 0 ? 0.95 : 1.02) * (ny < 0 ? 1 - 0.12 * -ny : 1); y *= 1.06;
      if (z > 0 && ny < -0.35) z += 0.012 * (1 - Math.abs(x) / 0.06); // chin
      P.setXYZ(i, x, y, z); }
    g.computeVertexNormals();
    add(g, { slot: 2, y: HY, face: 1, shadeFn: (x, y, z, s, k) => { y -= HY; let r = 1, gg = 1, b = 1; const fz = z > 0.035;
      if (fz) { for (const ex of [-0.033, 0.033]) { const d = Math.hypot((x - ex) / 0.017, (y - 0.01) / 0.009); if (d < 0.55) { r = gg = b = 0.08; } else if (d < 1) { r = 1.25; gg = 1.2; b = 1.15; } else if (d < 1.8) { const m = 0.7 + 0.3 * (d - 1) / 0.8; r *= m; gg *= m; b *= m; } // eye + socket
          const bd = Math.hypot((x - ex * 1.05) / 0.022, (y - 0.03) / 0.006); if (bd < 1) { r = gg = b = 0.28 + 0.2 * bd; } } // brow
        if (Math.abs(x) < 0.013 && y > -0.03 && y < 0.01) { const m = 0.8 + 0.2 * Math.abs(x) / 0.013; r *= m + 0.05; gg *= m; b *= m; } // nose side shade
        const ld = Math.hypot(x / 0.022, (y + 0.05) / 0.0075); if (ld < 1) { r *= 0.86; gg *= 0.58; b *= 0.6; } // lips
        for (const cx of [-0.045, 0.045]) { const cd = Math.hypot((x - cx) / 0.025, (y + 0.02) / 0.02); if (cd < 1) { const w = 1 - cd; gg *= 1 - 0.04 * w; b *= 1 - 0.05 * w; } } }
      if (y < -0.09) { const m = 0.93; r *= m; gg *= m; b *= m; }
      s[k] = r; s[k + 1] = gg; s[k + 2] = b; } }); }
  add(sph(0.011, 6, 5), { slot: 2, face: 1, y: HY - 0.014, z: HR * 0.88, sy: 1.5, sx: 0.95, sz: 1.1, shadeFn: (x, y, z, s, k) => { if (y < HY - 0.028) { s[k] = 0.8; s[k + 1] = 0.7; s[k + 2] = 0.68; } } }); // nose
  for (const sx of [-1, 1]) { add(sph(0.012, 8, 5), { slot: 6, part: PB.feat, x: sx * 0.033, y: HY + 0.01, z: 0.087, sx: 1.25, sy: 0.72, sz: 0.4 }); // eye white
    add(sph(0.0065, 6, 4), { slot: 5, part: PB.feat, x: sx * 0.032, y: HY + 0.01, z: 0.0915, sz: 0.4 }); // iris
    add(new THREE.BoxGeometry(0.03, 0.0055, 0.006), { slot: 5, part: PB.feat, x: sx * 0.034, y: HY + 0.03, z: 0.088, rz: -sx * 0.12 }); } // brow
  add(sph(0.016, 8, 4), { slot: 2, part: PB.feat, y: HY - 0.052, z: 0.083, sy: 0.32, sz: 0.4, shadeFn: (x, y, z, s, k) => { s[k] = 0.82; s[k + 1] = 0.5; s[k + 2] = 0.5; } }); // lips
  for (const sx of [-1, 1]) add(sph(0.018, 6, 4), { slot: 2, x: sx * 0.079, y: HY - 0.004, sz: 0.6, sx: 0.45 }); // ears
  // ---- hair / headwear (optional parts)
  // hairline: front vertices of a hair shell are lifted above the brows (y >= HY + 0.048), with a soft side-burn taper
  const hairline = (g, hl = 0.048) => { const P = g.attributes.position; for (let i = 0; i < P.count; i++) { const z = P.getZ(i), x = P.getX(i); const lim = HY + hl - 0.06 * Math.min(1, Math.abs(x) / 0.075) ** 3; if (z > 0.02 && P.getY(i) < lim) P.setY(i, lim - (lim - P.getY(i)) * 0.08); } g.computeVertexNormals(); };
  // tufts: short hair shells get a noisy outward offset (clumps) that grows toward the crown, so the silhouette isn't a bowl
  const tufts = (amp, fq, hl) => g => { const P = g.attributes.position; for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i) - HY, z = P.getZ(i), up = Math.max(0, Math.min(1, (y + 0.02) / 0.1));
    const k = 1 + amp * up * (vnoise(x * fq + 3, y * fq, z * fq) - 0.35) + (hl > 0.06 ? 0.05 * up * up * Math.max(0, z / 0.1 + 0.3) : 0); P.setXYZ(i, x * k, HY + y * (1 + (k - 1) * 1.4), z * k); } cover(g, hl); };
  // short-hair coverage: hairline at the front, cut just above the ears at the sides, down to the nape at the back
  // (vertices below the line fold up onto it, like hairline above)
  const cover = (g, hl) => { const P = g.attributes.position; for (let i = 0; i < P.count; i++) { const x = P.getX(i), z = P.getZ(i), a = Math.abs(Math.atan2(x, z)) / Math.PI; // 0 front, 1 back
      const lim = HY + (a < 0.3 ? hl - (hl - 0.02) * (a / 0.3) ** 2 : a < 0.55 ? 0.02 - 0.012 * (a - 0.3) / 0.25 : 0.008 - 0.085 * Math.min(1, (a - 0.55) / 0.3));
      const y = P.getY(i); if (y < lim) P.setY(i, lim - (lim - y) * 0.06); } g.computeVertexNormals(); };
  add(sph(HR * 1.07, 26, 14, 0, Math.PI * 0.8), { slot: 3, part: PB.hairS, y: HY + 0.012, sx: 0.83, sz: 1.02, fn: tufts(0.05, 40, 0.048) }); // short
  add(sph(HR * 1.03, 30, 16, 0, Math.PI * 0.8), { slot: 3, part: PB.hairT, face: 1, y: HY + 0.018, sx: 0.82, sz: 1.02, fn: tufts(0.09, 45, 0.08) }); // Shak: short dark textured, a little lift at the front
  add(sph(HR * 1.1, 18, 8, 0, Math.PI * 0.55), { slot: 3, part: PB.hairL, y: HY + 0.012, sx: 0.85, sz: 1.04, fn: hairline });
  add(cyl(0.1, 0.12, 0.3, 12, true), { slot: 3, part: PB.hairL, y: HY - 0.1, z: -0.035, sx: 0.85, sz: 0.62, fn: g => { const P = g.attributes.position; for (let i = 0; i < P.count; i++) if (P.getZ(i) > 0.0) P.setZ(i, -0.035 + (P.getZ(i) + 0.035) * 0.15); } }); // long fall behind the shoulders
  add(sph(0.036, 8, 6), { slot: 3, part: PB.bun, y: HY + 0.075, z: -0.07 });
  add(cyl(0.03, 0.016, 0.2, 6), { slot: 3, part: PB.pony, y: HY - 0.04, z: -0.12, rx: 0.35 });
  add(sph(0.03, 6, 4), { slot: 3, part: PB.pony, y: HY + 0.04, z: -0.1 });
  add(sph(HR * 1.16, 18, 12), { slot: 3, part: PB.hijab, y: HY - 0.005, sx: 0.84, sz: 1.02, fn: g => { const P = g.attributes.position; for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = P.getY(i) - HY, z = P.getZ(i); if (z > 0.05 && Math.abs(x) < 0.07 && y > -0.08 && y < 0.07) P.setZ(i, z - 0.06); } g.computeVertexNormals(); } }); // face opening
  add(cyl(0.085, 0.2, 0.2, 14), { slot: 3, part: PB.hijab, y: HY - 0.16, sz: 0.72 }); // drape over neck + shoulders
  add(sph(HR * 1.1, 16, 6, 0, Math.PI * 0.5), { slot: 0, part: PB.cap, y: HY + 0.02, sx: 0.84, fn: hairline });
  add(cyl(0.075, 0.075, 0.008, 12), { slot: 0, part: PB.cap, y: HY + 0.03, z: 0.1, sx: 1, sz: 0.8 }); // brim
  // ---- neck, torso, shoulders
  add(cyl(0.043, 0.05, 0.1, 8), { slot: 2, y: 1.505, shadeFn: (x, y, z, s, k) => { s[k] = s[k + 1] = s[k + 2] = 0.8; } });
  add(cyl(0.175, 0.15, 0.36, 12), { slot: 0, y: 1.27, sz: 0.62 }); // chest -> waist
  add(sph(0.175, 12, 6, 0, Math.PI / 2), { slot: 0, y: 1.449, sy: 0.4, sz: 0.62 }); // shoulder line
  for (const sx of [-1, 1]) add(sph(0.052, 8, 6), { slot: 0, limb: sx < 0 ? 3 : 4, x: sx * 0.198, y: 1.43, sy: 1.1 }); // deltoids
  add(cyl(0.15, 0.165, 0.16, 12), { slot: 1, y: 1.02, sz: 0.66 }); // waist -> hips (bottoms colour)
  add(cyl(0.186, 0.176, 0.44, 12), { slot: 0, part: PB.jacket, y: 1.2, sz: 0.68, fn: g => { const P = g.attributes.position; for (let i = 0; i < P.count; i++) if (P.getZ(i) > 0.1 && Math.abs(P.getX(i)) < 0.03) P.setZ(i, P.getZ(i) - 0.012); }, shadeFn: (x, y, z, s, k) => { if (z > 0.1 && Math.abs(x) < 0.03) s[k] = s[k + 1] = s[k + 2] = 0.55; } }); // jacket: longer, zip line
  add(sph(0.11, 10, 6), { slot: 0, part: PB.hood, y: 1.48, z: -0.1, sy: 0.55, sz: 0.6 }); // hood bunched at the back of the neck
  add(new THREE.BoxGeometry(0.2, 0.09, 0.02), { slot: 0, part: PB.hood, y: 1.13, z: 0.108, shadeFn: (x, y, z, s, k) => { s[k] = s[k + 1] = s[k + 2] = 0.8; } }); // hoodie pocket
  add(cyl(0.16, 0.25, 0.44, 14, true), { slot: 1, part: PB.skirt, y: 0.78, sz: 0.78 });
  add(cyl(0.16, 0.27, 0.58, 14, true), { slot: 0, part: PB.dress, y: 0.72, sz: 0.8 });
  add(cyl(0.162, 0.16, 0.18, 12), { slot: 0, part: PB.dress, y: 1.02, sz: 0.67 }); // dress covers the waist
  // ---- legs: hip pivot 0.92, knee 0.5 (thigh + shin + shoe); trousers or bare / tights
  for (const [sx, limb] of [[-1, 1], [1, 2]]) {
    add(cyl(0.083, 0.06, 0.44, 8), { slot: 1, limb, part: PB.trou, x: sx * 0.088, y: 0.72 }); add(cyl(0.06, 0.05, 0.44, 8), { slot: 1, limb, knee: 1, part: PB.trou, x: sx * 0.088, y: 0.29 });
    add(cyl(0.072, 0.052, 0.44, 8), { slot: 2, limb, part: PB.bare, x: sx * 0.088, y: 0.72 }); add(cyl(0.052, 0.036, 0.44, 8), { slot: 2, limb, knee: 1, part: PB.bare, x: sx * 0.088, y: 0.29, fn: g => { const P = g.attributes.position; for (let i = 0; i < P.count; i++) if (P.getZ(i) < 0 && P.getY(i) > 0.3) P.setZ(i, P.getZ(i) * 1.35); } }); // calf
    // shoe: rounded upper (toe drops and narrows, heel counter rounded) on a separate sole (white trainer or dark)
    add(new THREE.BoxGeometry(0.086, 0.07, 0.25, 2, 2, 6), { slot: 4, limb, knee: 1, x: sx * 0.088, y: 0.057, z: 0.04, fn: g => { const P = g.attributes.position; for (let i = 0; i < P.count; i++) { const lx = P.getX(i) - sx * 0.088, ly = P.getY(i) - 0.057, lz = P.getZ(i) - 0.04; const t = Math.max(0, lz / 0.125), hb = Math.max(0, -lz / 0.125);
      const top = ly > 0 ? 1 - 0.55 * t * t - 0.2 * hb * hb : 1; const w = 1 - 0.28 * t * t - 0.18 * hb * hb - (ly > 0 ? 0.2 * Math.abs(lx) / 0.043 * ly / 0.035 : 0);
      P.setXYZ(i, sx * 0.088 + lx * w, 0.057 + ly * top - (ly > 0 ? 0.004 : 0), 0.04 + lz * (1 - 0.06 * (ly > 0 ? ly / 0.035 : 0))); } g.computeVertexNormals(); } });
    for (const [part, slot] of [[PB.soleW, 6], [PB.soleD, 5]]) add(new THREE.BoxGeometry(0.094, 0.024, 0.262, 1, 1, 4), { slot, part, limb, knee: 1, x: sx * 0.088, y: 0.012, z: 0.041, fn: g => { const P = g.attributes.position; for (let i = 0; i < P.count; i++) { const lz = P.getZ(i) - 0.041, t = Math.max(0, lz / 0.131), hb = Math.max(0, -lz / 0.131); P.setX(i, sx * 0.088 + (P.getX(i) - sx * 0.088) * (1 - 0.3 * t * t - 0.2 * hb * hb)); if (t > 0.7 && P.getY(i) < 0.012) P.setY(i, 0.012 - (0.012 - P.getY(i)) * (1 - (t - 0.7) * 2)); } g.computeVertexNormals(); } });
  }
  // ---- arms: shoulder pivot 1.43, elbow 1.14, wrist 0.87; long or short sleeves, hands with a thumb
  for (const [sx, limb] of [[-1, 3], [1, 4]]) { const ax = sx * 0.205;
    add(cyl(0.05, 0.042, 0.3, 8), { slot: 0, limb, x: ax, y: 1.29 }); // upper arm (sleeve)
    add(cyl(0.041, 0.034, 0.27, 8), { slot: 0, limb, knee: 1, part: PB.slvL, x: ax, y: 1.005 });
    add(cyl(0.036, 0.029, 0.27, 8), { slot: 2, limb, knee: 1, part: PB.slvS, x: ax, y: 1.005 });
    add(sph(0.04, 8, 6), { slot: 2, limb, knee: 1, x: ax, y: 0.815, sx: 0.55, sy: 1.35, sz: 1.0 }); // hand (palm + fingers)
    add(sph(0.015, 5, 4), { slot: 2, limb, knee: 1, x: ax - sx * 0.012, y: 0.835, z: 0.028, sy: 1.8 }); // thumb
  }
  const g = mergeGeometries(parts); g.computeBoundingSphere(); g.boundingSphere.radius = 1.2; return g;
}
const PED_GLSL = `attribute vec4 aPed; attribute vec3 aShade; attribute vec2 aUv; varying vec2 vCzUv; varying vec3 vCzF;
#define aSlot aPed.x
#define aLimb aPed.y
#define aKnee aPed.z
#define aPart aPed.w
  attribute vec4 iWalk; attribute float iMask;
  attribute vec3 iC0; attribute vec3 iC1; attribute vec3 iC2; attribute vec3 iC3; uniform float uPedT; varying vec3 vPedCol;
  vec3 czRx( vec3 p, float a, float py, float pz ) { p.y -= py; p.z -= pz; float c = cos( a ), s = sin( a ); p = vec3( p.x, c * p.y - s * p.z, s * p.y + c * p.z ); p.y += py; p.z += pz; return p; }
  vec3 czRy( vec3 p, float a ) { float c = cos( a ), s = sin( a ); return vec3( c * p.x + s * p.z, p.y, -s * p.x + c * p.z ); }
  void czPose( inout vec3 p, inout vec3 n ) {
    if ( aPart > -0.5 && mod( floor( iMask / exp2( aPart ) + 0.001 ), 2.0 ) < 0.5 ) { p = vec3( 0.0, -2.0, 0.0 ); return; }
    float mv = step( 0.01, iWalk.y ); float ph = uPedT * iWalk.y + iWalk.x; float sw = sin( ph ) * mv, cw = cos( ph ) * mv; float st = iWalk.w;
    if ( aLimb > 0.5 && aLimb < 2.5 ) { float side = aLimb < 1.5 ? 1.0 : -1.0; float s1 = sw * side, c1 = cw * side;
      float thigh = -s1 * 0.42 * st; float knee = aKnee * ( 0.08 + mv * ( 0.62 * st * max( 0.0, c1 ) * max( 0.0, c1 + 0.25 ) + 0.1 * max( 0.0, -s1 ) ) );
      if ( aKnee > 0.5 ) { p = czRx( p, knee, 0.5, 0.0 ); n = czRx( n, knee, 0.0, 0.0 ); }
      p = czRx( p, thigh, 0.92, 0.0 ); n = czRx( n, thigh, 0.0, 0.0 ); }
    else if ( aLimb > 2.5 ) { float side = aLimb < 3.5 ? 1.0 : -1.0; float s1 = sw * side;
      float arm = s1 * 0.38 * st + 0.04; float elb = aKnee * -( 0.22 + 0.3 * mv * max( 0.0, -s1 ) );
      if ( aKnee > 0.5 ) { p = czRx( p, elb, 1.14, 0.0 ); n = czRx( n, elb, 0.0, 0.0 ); }
      p = czRx( p, arm, 1.43, 0.0 ); n = czRx( n, arm, 0.0, 0.0 );
      p.x += side * 0.012 * ( 1.43 - p.y ); } // arms hang slightly out from the hips
    float up = smoothstep( 0.95, 1.4, p.y ); float tw = sw * ( up * 0.1 - ( 1.0 - up ) * 0.06 );
    p = czRy( p, tw ); n = czRy( n, tw );
    float low = 1.0 - smoothstep( 0.9, 1.35, p.y ); p.x += cw * iWalk.z * 0.03 * ( 0.4 + 0.6 * low ); // hip sway (toward the stance leg)
    p.y += mv * ( abs( cos( ph ) ) * 0.028 - 0.014 ) * st; }`;
function patchPed(mat, U, depth) {
  mat.customProgramCacheKey = () => depth ? 'czped3d' : 'czped3';
  mat.onBeforeCompile = sh => { sh.uniforms.uPedT = U; if (!depth) Object.assign(sh.uniforms, pedTex());
    sh.vertexShader = PED_GLSL + '\n' + (depth ? sh.vertexShader.replace('#include <begin_vertex>', 'vec3 czP = position; vec3 czN = vec3( 0.0, 1.0, 0.0 ); czPose( czP, czN ); vec3 transformed = czP;')
      : sh.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        vec3 czP = position; czPose( czP, objectNormal );
        vCzUv = aUv; vCzF = vec3( aSlot, position.z, mod( floor( iMask / exp2( 15.0 ) + 0.001 ), 2.0 ) );
        vPedCol = ( aSlot < 0.5 ? iC0 : aSlot < 1.5 ? iC1 : aSlot < 2.5 ? iC2 : aSlot < 3.5 ? iC3 : aSlot < 4.5 ? vec3( 0.035 ) : aSlot < 5.5 ? vec3( 0.03, 0.022, 0.016 ) : vec3( 0.82, 0.8, 0.76 ) ) * aShade;`)
        .replace('#include <begin_vertex>', 'vec3 transformed = czP;'));
    if (!depth) sh.fragmentShader = PED_FRAG + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 czC = vPedCol; float czR = vCzUv.x;
      if ( czR < 1.5 && vCzF.z > 0.5 ) { vec3 ft = texture2D( uPedFace, vCzUv ).rgb; bool hr = vCzF.x > 2.5; czC = mix( czC, hr ? min( ft * 0.85, czC * 5.0 + 0.035 ) : ft, hr ? smoothstep( 0.02, 0.075, vCzF.y ) : smoothstep( -0.06, -0.005, vCzF.y ) ); }
      diffuseColor.rgb *= czC;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = vCzF.x < 1.5 ? 0.86 : vCzF.x < 2.5 ? 0.55 : vCzF.x < 3.5 ? 0.66 : vCzF.x < 4.5 ? 0.38 : 0.3;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      if ( ( vCzUv.x > 1.9 && vCzUv.x < 6.0 ) || ( vCzUv.x < 1.5 && vCzF.x > 2.5 ) ) { bool czH = vCzUv.x > 3.95 || vCzUv.x < 1.5; vec2 tuv = vCzUv.x < 1.5 ? vCzUv * vec2( 0.8, 3.0 ) : vec2( vCzUv.x - ( czH ? 4.0 : 2.0 ), vCzUv.y );
        vec3 mn = ( czH ? texture2D( uPedHairN, tuv * vec2( 3.0, 1.0 ) ) : texture2D( uPedClothN, tuv * vec2( 1.5, 1.6 ) ) ).xyz * 2.0 - 1.0; mn.xy *= czH ? 0.55 : 0.5;
        normal = czPerturb( normal, - vViewPosition, tuv, mn ); }`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      if ( vCzF.x > 1.5 && vCzF.x < 2.5 ) { float czW = 1.0 - max( dot( normal, normalize( vViewPosition ) ), 0.0 ); reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3( 0.16, 0.05, 0.03 ) * ( 0.4 + czW ); }`); };
  return mat;
}
// fragment side: face decal, cloth / hair normal maps (screen-derivative tangent frame, no tangent attribute needed) and
// a cheap skin scatter term (warm, stronger at grazing angles) so skin doesn't read as painted plastic
const PED_FRAG = `varying vec3 vPedCol; varying vec2 vCzUv; varying vec3 vCzF; uniform sampler2D uPedFace; uniform sampler2D uPedClothN; uniform sampler2D uPedHairN;
  vec3 czPerturb( vec3 n, vec3 p, vec2 uv, vec3 m ) { vec3 q0 = dFdx( p ), q1 = dFdy( p ); vec2 s0 = dFdx( uv ), s1 = dFdy( uv ); vec3 q1p = cross( q1, n ), q0p = cross( n, q0 );
    vec3 T = q1p * s0.x + q0p * s1.x, B = q1p * s0.y + q0p * s1.y; float d = max( dot( T, T ), dot( B, B ) ); if ( d <= 0.0 ) return n; float k = inversesqrt( d ); return normalize( T * ( m.x * k ) + B * ( m.y * k ) + n * m.z ); }
`;
let _pedTex = null;
function pedTex() { if (_pedTex) return _pedTex; const L = new THREE.TextureLoader(), base = new URL('../img/people/', import.meta.url).href;
  const ld = (f, srgb) => { const t = L.load(base + f); t.wrapS = t.wrapT = srgb ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  return (_pedTex = { uPedFace: { value: ld('ped_shak_face.jpg', true) }, uPedClothN: { value: ld('ped_cloth_n.png') }, uPedHairN: { value: ld('ped_hair_n.png') } }); }
function pedMaterial(U) { return patchPed(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0 }), U, false); }
// outfits: [mask bits, weight]; hair / headwear drawn from the same table so looks mix
const OUTFITS = [
  [['jacket', 'trou', 'slvL'], 3], [['hood', 'trou', 'slvL'], 2.5], [['trou', 'slvS'], 2], [['dress', 'bare', 'slvS'], 1.4], [['skirt', 'bare', 'slvL'], 1.2],
  [['jacket', 'skirt', 'bare', 'slvL'], 1], [['dress', 'trou', 'slvL'], 0.5], [['trou', 'slvL'], 1.5]];
const HAIRS = [[['hairS'], 4], [['hairL'], 2], [['hairS', 'pony'], 1.4], [['hijab'], 0.9], [['hairS', 'cap'], 1.2], [['hairL', 'bun'], 0.7], [[], 0.4]];
const pickW = (T, r) => { let t = r() * T.reduce((a, b) => a + b[1], 0); for (const e of T) if ((t -= e[1]) <= 0) return e[0]; return T[0][0]; };
const maskOf = L => L.reduce((m, k) => m + (1 << PB[k]), 0);
// a walker's look: hair + outfit from the tables; about 45 % of the male-presenting looks (short hair / cap / none, no
// skirt or dress) become Shak: his face decal + textured dark hair shell + his skin tone; clothes, height and build stay
// random so they don't read as clones. Everyone else keeps the modelled eyes / brows / lips (feat). Shoes: trainers
// (white sole) or dark soles.
function pedLook(rnd, shakShare = 0.45) {
  let hair = pickW(HAIRS, rnd); const outfit = pickW(OUTFITS, rnd);
  const male = !outfit.includes('skirt') && !outfit.includes('dress') && (hair.length === 0 || (hair.length <= 2 && hair[0] === 'hairS' && !hair.includes('pony')));
  const shak = male && rnd() < shakShare; if (shak) hair = hair.includes('cap') && rnd() < 0.5 ? ['hairT', 'cap'] : ['hairT'];
  const sole = rnd() < 0.55 ? 'soleW' : 'soleD';
  return { hair, outfit, shak, male, mask: maskOf([...hair, ...outfit, shak ? 'shak' : 'feat', sole]) };
}

export class StreetLife {
  static PEDS = true; static PA = [['iWalk', 4], ['iMask', 1], ['iC0', 3], ['iC1', 3], ['iC2', 3], ['iC3', 3]];
  constructor(world, settings, cars) { this.W = world; this.s = settings; this.cars = cars || []; this.group = new THREE.Group(); this.group.name = 'streetlife'; this.cells = []; this.t = 0; this.parked = 0; this.peds = null; }
  build() {
    const env = this.s.graphics.envDetail; if (env < 1) return this.group; // Low: nothing extra (frame-time budget)
    try { this.buildParked(env); } catch (e) { console.warn('streetlife: parked cars failed', e); }
    try { if (StreetLife.PEDS) this.buildPeds(env); /* round 7: jointed low-poly figures, footway runs tested against every drivable piece */ } catch (e) { console.warn('streetlife: pedestrians failed', e); }
    return this.group;
  }
  // bake one procedural car body into [{geo, mat, paint}] merged per material, in car-local space
  bake(car) {
    const root = buildCar(car, { procedural: true, detail: 0, colour: SENT, plate: ' ' }); root.updateMatrixWorld(true);
    const by = new Map();
    root.traverse(o => { if (!o.isMesh || !o.visible || !o.geometry || Array.isArray(o.material)) return; const m = o.material; if (m.transparent && m.opacity < 0.05) return;
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
      const keep = new THREE.BufferGeometry(); keep.setAttribute('position', g.attributes.position); if (g.attributes.normal) keep.setAttribute('normal', g.attributes.normal); else { keep.computeVertexNormals(); }
      keep.setAttribute('uv', g.attributes.uv || new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      const a = by.get(m) || []; a.push(keep); by.set(m, a); });
    const out = [];
    for (const [m, gs] of by) { const geo = mergeGeometries(gs); if (!geo) continue; const mat = m.clone(); const paint = m.color && m.color.getHex() === SENT;
      if (paint) { mat.color.set(0xffffff); if ('clearcoat' in mat) mat.clearcoat = 0.6; } out.push({ geo, mat, paint }); }
    root.traverse(o => { if (o.isMesh) o.geometry?.dispose(); });
    return out;
  }
  buildParked(env) {
    const W = this.W, rnd = mulberry(77); const cap = [0, 700, 1600, 2600][env] || 700;
    // up to 4 body styles (different bodies read as different cars), chosen from the roster's everyday cars
    const pool = this.cars.filter(c => !/F1|kart|proto|LMP|hyper/i.test((c.cls || '') + (c.body || ''))); const seen = new Set(), vars = [];
    for (const c of pool.length ? pool : this.cars) { const k = c.body || c.id; if (seen.has(k)) continue; seen.add(k); try { const b = this.bake(c); if (b.length) vars.push(b); } catch (e) { } if (vars.length >= (env >= 3 ? 5 : 4)) break; }
    if (!vars.length) return;
    const spots = []; // [x, z, yaw, variant, colour]
    const clear = (x, z, yaw) => { const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      for (const [u, v] of [[0, 0], [2.6, 0], [-2.6, 0], [0, 1.2], [0, -1.2], [2.4, 1.1], [2.4, -1.1], [-2.4, 1.1], [-2.4, -1.1]]) { const px = x + fx * u - fz * v, pz = z + fz * u + fx * v;
        if (W.onAnyDrive(px, pz, 0, -1.2)) return false; if (W.insideBuilding?.(px, pz, 0)) return false; }
      return !W.solidHit(x, z, yaw, 2.6, 1.15, 0); };
    for (const a of W.d.areas) { if (a.k !== 'park' || spots.length >= cap) continue;
      const P = []; for (let i = 0; i < a.p.length; i += 2) P.push([dm(a.p[i]), dm(a.p[i + 1])]); if (P.length < 3) continue;
      // bay grid aligned with the car park's longest edge: two facing rows of 2.5 x 5 m bays + a 6 m aisle (16 m period)
      let best = 0, ax = [1, 0]; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length], l = Math.hypot(q[0] - p[0], q[1] - p[1]); if (l > best) { best = l; ax = [(q[0] - p[0]) / l, (q[1] - p[1]) / l]; } }
      const ay = [-ax[1], ax[0]]; let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
      for (const p of P) { const u = p[0] * ax[0] + p[1] * ax[1], v = p[0] * ay[0] + p[1] * ay[1]; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      if ((u1 - u0) * (v1 - v0) > 60000) continue; // huge polygons are usually mis-tagged multi-use areas
      const occ = 0.55 + rnd() * 0.35;
      for (let v = v0 + 3; v < v1 - 2.5; v += 16) for (const row of [0, 1]) { const vc = v + row * 5; const yawBase = Math.atan2(-(ay[0] * (row ? -1 : 1)), -(ay[1] * (row ? -1 : 1)));
        for (let u = u0 + 2; u < u1 - 1.25; u += 2.5) { if (spots.length >= cap) break; if (rnd() > occ) continue;
          const x = ax[0] * u + ay[0] * vc, z = ax[1] * u + ay[1] * vc; // bay centre (u along the row, v across)
          let okIn = true; for (const [du, dv] of [[-1.1, -2.3], [1.1, -2.3], [-1.1, 2.3], [1.1, 2.3]]) if (!inPoly(x + ax[0] * du + ay[0] * dv, z + ax[1] * du + ay[1] * dv, P)) { okIn = false; break; }
          if (!okIn) continue; const yaw = yawBase + (rnd() - 0.5) * 0.06, sx = x + ax[0] * (rnd() - 0.5) * 0.3, sz = z + ax[1] * (rnd() - 0.5) * 0.3;
          if (!clear(sx, sz, yaw)) continue;
          spots.push([sx, sz, yaw, rnd() * vars.length | 0, PAINTS[rnd() * PAINTS.length | 0]]);
          const fx = -Math.sin(yaw), fz = -Math.cos(yaw), hl = 2.25, hw = 0.92; // collider: the body footprint
          W.addBuildingCollider([[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([p, q]) => [sx + fx * hl * p - fz * hw * q, sz + fz * hl * p + fx * hw * q]), { h: 1.5, lm: 'parked' });
        } }
    }
    this.parked = spots.length; if (!spots.length) return;
    // instanced per 160 m cell and variant
    const C = 160, cells = new Map(); for (const s of spots) { const k = Math.floor(s[0] / C) * 100000 + Math.floor(s[1] / C); let c = cells.get(k); if (!c) cells.set(k, c = { x: 0, z: 0, n: 0, list: [] }); c.list.push(s); c.x += s[0]; c.z += s[1]; c.n++; }
    const d = new THREE.Object3D(), col = new THREE.Color(); const shadow = this.s.graphics.shadows >= 1 && env >= 2;
    // far LOD per body style: 2 draws (paint + everything else in vertex colours), vertex-clustered to ~1/5 of the triangles
    const lodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 });
    const lods = vars.map(parts => { const pg = [], rg = []; for (const part of parts) { const g = part.geo.clone(); if (part.paint) { pg.push(g); continue; }
        const c = part.mat.color || new THREE.Color(0x222222), n = g.attributes.position.count, ca = new Float32Array(n * 3); for (let i = 0; i < n; i++) { ca[i * 3] = c.r; ca[i * 3 + 1] = c.g; ca[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(ca, 3)); rg.push(g); }
      const strip = gs => gs.map(g => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k); return g; });
      const out = []; const pm = parts.find(x => x.paint)?.mat; if (pg.length && pm) out.push({ geo: clusterLOD(mergeGeometries(strip(pg)), 0.16), mat: pm, paint: true });
      if (rg.length) out.push({ geo: clusterLOD(mergeGeometries(strip(rg)), 0.16), mat: lodMat, paint: false }); return out; });
    this.lodTris = lods.map(L => L.reduce((a, x) => a + x.geo.attributes.position.count / 3, 0)); this.fullTris = vars.map(V => V.reduce((a, x) => a + (x.geo.index ? x.geo.index.count : x.geo.attributes.position.count) / 3, 0));
    for (const c of cells.values()) { const g = new THREE.Group(); g.position.set(0, 0, 0); const gl = new THREE.Group(); gl.visible = false;
      for (let vi = 0; vi < vars.length; vi++) { const L = c.list.filter(s => s[3] === vi); if (!L.length) continue;
        for (const part of lods[vi]) { const im = new THREE.InstancedMesh(part.geo, part.mat, L.length); im.castShadow = false; im.receiveShadow = true;
          L.forEach((s, i) => { d.position.set(s[0], 0, s[1]); d.rotation.set(0, s[2], 0); d.updateMatrix(); im.setMatrixAt(i, d.matrix); if (part.paint) im.setColorAt(i, col.set(s[4])); });
          im.computeBoundingSphere(); gl.add(im); } }
      this.group.add(gl);
      for (let vi = 0; vi < vars.length; vi++) { const L = c.list.filter(s => s[3] === vi); if (!L.length) continue;
        for (const part of vars[vi]) { const im = new THREE.InstancedMesh(part.geo, part.mat, L.length); im.castShadow = shadow; im.receiveShadow = true;
          L.forEach((s, i) => { d.position.set(s[0], 0, s[1]); d.rotation.set(0, s[2], 0); d.updateMatrix(); im.setMatrixAt(i, d.matrix); if (part.paint) im.setColorAt(i, col.set(s[4])); });
          im.computeBoundingSphere(); g.add(im); } }
      this.group.add(g); this.cells.push({ g, gl, x: c.x / c.n, z: c.z / c.n }); }
    this.viewD = (MOB ? [0, 220, 300, 380] : [0, 260, 420, 650])[env] || 260; this.nearD = MOB ? 100 : 150; // full body within nearD of the cell centre, LOD beyond, nothing past viewD
  }
  // pedestrians: instanced low-poly people walking along the paved footways (High / Ultra; a few on Medium). Pure
  // visuals (no colliders). Every walk path is a run of footway samples 1.5 m apart, each tested against the world's
  // drivable pieces (all carriageways, junction discs, corner fills and every race lane) with a 0.6 m margin, against
  // building footprints and against the track / crossing dressing cut-outs; a pedestrian only ever moves between two
  // tested samples, and each sample is re-tested at run time as it is reached (failing → the walker is moved elsewhere).
  buildPeds(env) {
    const W = this.W, rnd = mulberry(9); const n = env >= 3 ? 240 : env >= 2 ? 150 : 36; const paths = [];
    for (const E of W.edges) { if (E.hid || E.r.tun || /service|motorway|trunk_link|_link/.test(E.r.k)) continue; const P = E.P;
      if (Math.abs(P[0][2]) > 0.5 || Math.abs(P[P.length - 1][2]) > 0.5 || P[P.length - 1][3] < 24) continue; paths.push(E); }
    if (!paths.length) return;
    const G = new Map(), C = 100; for (const E of paths) { const q = E.P[E.P.length >> 1]; const k = Math.floor(q[0] / C) * 100000 + Math.floor(q[1] / C); let a = G.get(k); if (!a) G.set(k, a = []); a.push(E); }
    this.pedGrid = G; this.pedRuns = new Map();
    const U = this.pedU = { value: 0 }; const im = new THREE.InstancedMesh(pedGeometry(), pedMaterial(U), n);
    im.castShadow = this.s.graphics.shadows >= 1 && env >= 2; im.receiveShadow = false; im.frustumCulled = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (im.castShadow) im.customDepthMaterial = patchPed(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), U, true);
    const g = im.geometry, walk = new Float32Array(n * 4), mask = new Float32Array(n), cs = [0, 1, 2, 3].map(() => new Float32Array(n * 3)); const col = new THREE.Color();
    const TOPS = [0x1d2a44, 0x7a1f24, 0x2f2f33, 0xd9d4c8, 0x6b5a3a, 0x24483a, 0x8a8f96, 0x121212, 0x7a3355, 0xb38a4a, 0x3a6ea5, 0xe0b73a, 0xf2f2f2, 0x5b3f6e, 0xa04a1c, 0x4f6b3a, 0x9c2f45, 0x3d5d6e];
    const LEGS = [0x1f2a3d, 0x2a2e38, 0x161616, 0x3b3f46, 0x6e6250, 0x283a5a, 0x4a4036, 0x7b7f86, 0x20252e, 0x324a6e];
    const SKIN = [0xf1c9a5, 0xe0ac86, 0xc68a62, 0x9b6641, 0x6f4526, 0x4a2c18, 0xf6d7bd, 0xb8845e];
    const HAIR = [0x1a1410, 0x2e1f14, 0x4a3220, 0x6b4a2a, 0xa8834f, 0xc9b27a, 0x8c8c8c, 0x0d0d0d, 0x5a2a16];
    const SCARF = [0x1b2233, 0x5a2436, 0x2d4a45, 0xc9b9a0, 0x111111, 0x6a5a8a, 0x8a3a2a];
    this.pedList = [];
    for (let i = 0; i < n; i++) { const pick = A => A[rnd() * A.length | 0];
      const lk = pedLook(rnd), hair = lk.hair, outfit = lk.outfit; mask[i] = lk.mask; if (lk.shak) this.pedShak = (this.pedShak || 0) + 1;
      [pick(TOPS), pick(LEGS), lk.shak ? SHAK_SKIN : pick(SKIN), lk.shak ? HAIR_C : hair.includes('hijab') ? pick(SCARF) : pick(HAIR)].forEach((h, k) => { col.set(h); cs[k][i * 3] = col.r; cs[k][i * 3 + 1] = col.g; cs[k][i * 3 + 2] = col.b; });
      // gait: speed 0.9-1.7 m/s, stride 0.62-0.85 m per step (cadence follows), taller people slightly longer steps
      const stand = rnd() < 0.1, sc = 0.9 + rnd() * 0.18, sp = stand ? 0 : 0.9 + rnd() * 0.8, stride = (0.62 + rnd() * 0.2) * sc;
      walk[i * 4] = rnd() * 6.28; walk[i * 4 + 1] = sp ? Math.PI * sp / stride : 0; walk[i * 4 + 2] = outfit.includes('skirt') || outfit.includes('dress') ? 1 : 0.35 + rnd() * 0.4; walk[i * 4 + 3] = 0.75 + (sp - 0.9) * 0.45;
      this.pedList.push({ E: null, sp, ph: walk[i * 4], sc, wd: 0.94 + rnd() * 0.12 });
      im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(0, -80, 0)); }
    g.setAttribute('iWalk', new THREE.InstancedBufferAttribute(walk, 4)); g.setAttribute('iMask', new THREE.InstancedBufferAttribute(mask, 1)); ['iC0', 'iC1', 'iC2', 'iC3'].forEach((nm, k) => g.setAttribute(nm, new THREE.InstancedBufferAttribute(cs[k], 3)));
    // distance LOD: 'im' becomes the far mesh (vertex-clustered geometry, no shadow); a near mesh with the full figure draws
    // only the walkers within PED_NEAR, packed into its first slots (per-walker attributes copied into those slots)
    { const full = g, lg = clusterLOD(full, 0.07); for (const nm of ['iWalk', 'iMask', 'iC0', 'iC1', 'iC2', 'iC3']) lg.setAttribute(nm, full.attributes[nm]);
      const ng = new THREE.BufferGeometry(); for (const nm of Object.keys(full.attributes)) { const A = full.attributes[nm]; ng.setAttribute(nm, A.isInstancedBufferAttribute ? new THREE.InstancedBufferAttribute(A.array.slice(), A.itemSize) : A); }
      ng.boundingSphere = full.boundingSphere; const near = new THREE.InstancedMesh(ng, im.material, n); near.castShadow = im.castShadow; near.customDepthMaterial = im.customDepthMaterial; near.receiveShadow = false; near.frustumCulled = false; near.count = 0; near.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.geometry = lg; im.castShadow = false; this.pedNear = near; this.group.add(near); this.pedTris = { full: full.attributes.position.count / 3, lod: lg.attributes.position.count / 3 }; }
    this.peds = im; this.pedPaths = paths; this.group.add(im); this.pedRnd = rnd; this.pedN = { placed: 0, rejected: 0, hiddenRt: 0 };
  }
  // footway runs of one edge side / lane: [[a0, a1, samples[]], ...] (samples = [a, x, z, h] every 1.5 m, all tested)
  pedRunsOf(E, side, lane) {
    const key = E; let per = this.pedRuns.get(key); if (!per) this.pedRuns.set(key, per = {}); const k2 = side + ':' + lane; if (per[k2]) return per[k2];
    const W = this.W, P = E.P, L = P[P.length - 1][3], pw = /trunk|primary/.test(E.r.k) ? 3 : 2.4, off = side * (E.hw + 0.3 + pw * (lane ? 0.68 : 0.36));
    const out = []; let cur = null; const s0 = E.hw + 5, s1 = L - E.hw - 5; const dress = W.touchesDress?.(P);
    for (let a = s0; a <= s1; a += 1.5) { let j = 0; while (j < P.length - 2 && P[j + 1][3] < a) j++; const A = P[j], B = P[j + 1], l = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1, t = Math.max(0, Math.min(1, (a - A[3]) / ((B[3] - A[3]) || 1)));
      const nx = -(B[1] - A[1]) / l, nz = (B[0] - A[0]) / l; const x = A[0] + (B[0] - A[0]) * t + nx * off, z = A[1] + (B[1] - A[1]) * t + nz * off, h = A[2] + (B[2] - A[2]) * t;
      const ok = Math.abs(h) < 0.5 && pedFree(W, x, z, h) && !(dress && !W.dressFree(x, z));
      if (ok) { if (!cur) cur = []; cur.push([a, x, z, h]); } else { if (cur && cur.length >= 6) out.push(cur); if (!ok) this.pedN && this.pedN.rejected++; cur = null; } }
    if (cur && cur.length >= 6) out.push(cur);
    return (per[k2] = out);
  }
  // put a pedestrian on a tested footway run 25–150 m from (x,z)
  placePed(p, x, z) {
    const r = this.pedRnd, C = 100;
    for (let tries = 0; tries < 10; tries++) {
      const d = 25 + r() * 125, ang = r() * 6.2832, px = x + Math.cos(ang) * d, pz = z + Math.sin(ang) * d;
      const cell = this.pedGrid.get(Math.floor(px / C) * 100000 + Math.floor(pz / C)); if (!cell || !cell.length) continue;
      const E = cell[r() * cell.length | 0]; const runs = this.pedRunsOf(E, r() < 0.5 ? -1 : 1, r() < 0.5 ? 0 : 1); if (!runs.length) continue;
      const S = runs[r() * runs.length | 0]; if ((S.occ || 0) >= 1 + (S.length / 30 | 0)) continue; // spread out: ~1 walker per 45 m of footway
      if (p.S) p.S.occ--; S.occ = (S.occ || 0) + 1; p.S = S; p.E = E; p.i = r() * (S.length - 1) | 0; p.f = r(); p.dir = r() < 0.5 ? -1 : 1; p.chk = -1; this.pedN.placed++; return true;
    }
    return false;
  }
  update(dt, cam) {
    if (!cam) return; const x = cam.position.x, z = cam.position.z; this.t -= dt;
    if (this.t <= 0 && this.cells.length) { this.t = 0.4; const D2 = this.viewD * this.viewD; const N2 = this.nearD * this.nearD; for (const c of this.cells) { const d2 = (c.x - x) ** 2 + (c.z - z) ** 2; c.g.visible = d2 < N2; c.gl.visible = d2 >= N2 && d2 < D2; } }
    const im = this.peds; if (!im) return; const m = this._m || (this._m = new THREE.Matrix4()), q = this._q || (this._q = new THREE.Quaternion()), v = this._v || (this._v = new THREE.Vector3()), sc = this._s || (this._s = new THREE.Vector3(1, 1, 1)), up = this._up || (this._up = new THREE.Vector3(0, 1, 0));
    const now = performance.now() / 1000; this.pedU.value = now % 10000; const step = Math.min(dt, 0.1);
    const NR = this.pedNear, PN2 = (MOB ? 45 : 70) ** 2, PA = StreetLife.PA; let nn = 0; if (NR && !NR.slot) { NR.slot = new Int32Array(this.pedList.length).fill(-1); NR.count0 = this.pedList.length; }
    for (let i = 0; i < this.pedList.length; i++) { const p = this.pedList[i];
      if (!p.S || (p.x - x) ** 2 + (p.z - z) ** 2 > 175 * 175) { if (!this.placePed(p, x, z)) { m.makeTranslation(0, -80, 0); im.setMatrixAt(i, m); if (p.S) p.S.occ--; p.S = null; continue; } }
      const S = p.S; let A = S[p.i], B = S[p.i + 1]; const seg = (B[0] - A[0]) || 1.5;
      p.f += p.dir * p.sp * step / seg;
      if (p.f > 1 || p.f < 0) { const ni = p.i + (p.f > 1 ? 1 : -1); if (ni < 0 || ni > S.length - 2) { p.dir = -p.dir; p.f = Math.max(0, Math.min(1, p.f)); } else { p.i = ni; p.f -= Math.sign(p.f); p.chk = -1; } A = S[p.i]; B = S[p.i + 1]; }
      // run-time re-test of the sample the walker is heading to (every path step)
      if (p.chk !== p.i) { p.chk = p.i; const T = p.dir > 0 ? B : A; if (!pedFree(this.W, T[1], T[2], T[3])) { this.pedN.hiddenRt++; p.S.occ--; p.S = null; m.makeTranslation(0, -80, 0); im.setMatrixAt(i, m); continue; } }
      p.x = A[1] + (B[1] - A[1]) * p.f; p.z = A[2] + (B[2] - A[2]) * p.f; const h = A[3] + (B[3] - A[3]) * p.f;
      const dx = (B[1] - A[1]) * p.dir, dz = (B[2] - A[2]) * p.dir; const bob = 0;
      q.setFromAxisAngle(up, Math.atan2(dx, dz)); v.set(p.x, h + 0.12 + bob, p.z); sc.set(p.wd * p.sc, p.sc, p.sc); m.compose(v, q, sc);
      if (NR && (p.x - x) ** 2 + (p.z - z) ** 2 < PN2 && nn < NR.count0) { NR.setMatrixAt(nn, m); if (NR.slot[nn] !== i) { NR.slot[nn] = i; for (const [nm, is] of PA) { const d = NR.geometry.attributes[nm], sA = im.geometry.attributes[nm]; for (let k = 0; k < is; k++) d.array[nn * is + k] = sA.array[i * is + k]; d.needsUpdate = true; } } nn++; m.makeTranslation(0, -80, 0); }
      im.setMatrixAt(i, m); }
    im.instanceMatrix.needsUpdate = true; if (NR) { NR.count = nn; NR.instanceMatrix.needsUpdate = true; }
  }
}

export const PedKit = { pedGeometry, pedMaterial, patchPed, OUTFITS, HAIRS, maskOf, pedLook, PB, SHAK_SKIN, HAIR_C };
