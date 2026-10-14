// Open-world road edges (round 4): every drivable street gets a clear, solid edge so it is obvious what is road.
//  - main roads (motorway / trunk / primary / secondary / links, and the named ring roads - Queensways, Middleways,
//    Ringways, Circuses): a continuous galvanised armco crash barrier (W-beam at 0.45-0.75 m on posts every 2 m)
//    at the back of the kerb on both sides (nearside only on a one-way carriageway: the offside is the central reservation)
//  - minor streets (tertiary / unclassified / residential / living streets): a black pedestrian guard-railing with
//    bollards at the back of the kerb
// Both are broken wherever anything else is drivable next to them (junction discs, every connecting street and service
// road / car-park entrance, the Asda car park, the meet pad, race tracks and their corridors) and at signalised crossings,
// so every connecting road can still be turned into. They are never on a race track (tracks are drivable, so the rails
// stop short of them; the race armco of the per-race kit is the only barrier there).
// Every rail is solid (a collider segment in World.bGrid: cars bounce off it) at every graphics level. Drawing is one
// merged, alpha-tested ribbon per kind (2 triangles per road piece; the posts / balusters are in the texture), so the cost
// is a handful of draw calls. Low: plain beam / top rail only (no post texture).
import * as THREE from 'three';
import { mergeGeometries } from './lib/addons/utils/BufferGeometryUtils.js';

export const MAIN_RE = /motorway|trunk|primary|secondary/;
export const RING_RE = /Queensway|Middleway|Ringway|Circus/i;
export const RAIL_OFF = 0.6; // round 6: 0.6 m out from the ribbon edge (was 0.25) // lateral offset of the rail from the carriageway edge (m): on the kerb line, just inside the
// drivable edge (carriageway + 0.35 m kerb face), so the rail - not the invisible edge - is what a car touches and bounces off

// vertical ribbon at lateral offset o along path P (P = [x, z, h, s] points), from y0 to y1; u = s / uRep, v 0..1
function ribbonV(P, o, y0, y1, uRep) {
  const pos = [], uv = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p1 = P[i], p2 = P[i + 1], dx = p2[0] - p1[0], dz = p2[1] - p1[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
    const ax = p1[0] + nx * o, az = p1[1] + nz * o, bx = p2[0] + nx * o, bz = p2[1] + nz * o, u1 = p1[3] / uRep, u2 = p2[3] / uRep;
    pos.push(ax, p1[2] + y0, az, bx, p2[2] + y0, bz, bx, p2[2] + y1, bz, ax, p1[2] + y0, az, bx, p2[2] + y1, bz, ax, p1[2] + y1, az);
    uv.push(u1, 0, u2, 0, u2, 1, u1, 0, u2, 1, u1, 1);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); return g;
}
// flat cap strip (top of the beam) at offset o, width w, height y
function capH(P, o, w, y) {
  const pos = [], uv = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p1 = P[i], p2 = P[i + 1], dx = p2[0] - p1[0], dz = p2[1] - p1[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
    const q = (p, k) => [p[0] + nx * (o + k), p[2] + y, p[1] + nz * (o + k)]; const A = q(p1, -w / 2), B = q(p1, w / 2), C = q(p2, -w / 2), D = q(p2, w / 2);
    pos.push(...A, ...C, ...B, ...B, ...C, ...D); uv.push(0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); return g;
}

export function buildRoadEdges(W, { slicePath, pointAt }) {
  const low = W.q.env < 1;
  const stats = W.roadEdgeStats = { armcoM: 0, railM: 0, armcoRuns: 0, railRuns: 0, edges: 0, gapsCross: 0 };
  // signalised crossings: 5 m gap either side
  const sig = []; for (const s of (W.d.signals || [])) sig.push([s[0] / 10, s[1] / 10]);
  const sigG = new Map(); for (const s of sig) { const k = Math.floor(s[0] / 25) * 100000 + Math.floor(s[1] / 25); let a = sigG.get(k); if (!a) sigG.set(k, a = []); a.push(s); }
  const nearSig = (x, z) => { const gx = Math.floor(x / 25), gz = Math.floor(z / 25); for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) for (const s of (sigG.get((gx + ox) * 100000 + gz + oz) || [])) if ((s[0] - x) ** 2 + (s[1] - z) ** 2 < 36) return true; return false; };
  const runs = { armco: [], rail: [] }; W.roadEdgeRuns = [];
  // is (x,z) within 0.6 m of a drive piece other than this street's own carriageway (or its straight continuation)?
  const kk = (x, z) => x.toFixed(2) + ',' + z.toFixed(2);
  const otherDrive = (x, z, y, fx, fz, oA, own) => { const gx = Math.floor(x / 25), gz = Math.floor(z / 25);
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) for (const s of (W.driveGrid?.get((gx + ox) * 100000 + gz + oz) || [])) {
      const dx = s.x2 - s.x1, dz = s.z2 - s.z1, L2 = dx * dx + dz * dz || 1; let t = ((x - s.x1) * dx + (z - s.z1) * dz) / L2; t = Math.max(0, Math.min(1, t));
      if (Math.abs(s.h1 + (s.h2 - s.h1) * t - y) > 1.5) continue; const d = Math.hypot(x - s.x1 - dx * t, z - s.z1 - dz * t); if (d >= s.hw + 0.6) continue;
      if (s.corr || s.track === true) return true; // race track / corridor: never a rail there
      if (own.has(kk(s.x1, s.z1)) && own.has(kk(s.x2, s.z2))) continue;
      const l = Math.sqrt(L2); if (l > 0.3 && Math.abs((dx * fx + dz * fz) / l) > 0.96) { const dl = Math.abs((x - s.x1) * -dz / l + (z - s.z1) * dx / l); if (Math.abs(dl - oA) < 0.35 && Math.abs(s.hw - (oA - RAIL_OFF + W.constructor.PAVEMENT)) < 0.5) continue; } // same street continuing
      return true; }
    return false; };
  // junction mouths: no rail within (junction disc radius + 5 m) of a 3+-way node, so the corner radius of every turn is open
  const jR = new Map(); for (const { e, r, P, hw } of W.edges) for (const [id, q] of [[e[0], P[0]], [e[1], P[P.length - 1]]]) { if ((W.deg.get(id) || 0) < 3) continue; const j = jR.get(id) || { x: q[0], z: q[1], r: 0 }; j.r = Math.max(j.r, hw + 2.2 + 7.5); jR.set(id, j); } // round 6: set back further from junction mouths
  // 2-way nodes where the street turns > 28 deg (two OSM ways meeting at a corner): open there too, like a bend
  { const legs = new Map(); for (const { e, P, hw } of W.edges) for (const [id, a, b] of [[e[0], P[0], P[1]], [e[1], P[P.length - 1], P[P.length - 2]]]) { if (W.deg.get(id) !== 2 || !b) continue; let l = legs.get(id); if (!l) legs.set(id, l = []); const dx = b[0] - a[0], dz = b[1] - a[1], n = Math.hypot(dx, dz) || 1; l.push({ x: a[0], z: a[1], dx: dx / n, dz: dz / n, hw }); }
    for (const [id, l] of legs) if (l.length === 2 && -(l[0].dx * l[1].dx + l[0].dz * l[1].dz) < Math.cos(28 * Math.PI / 180)) jR.set(id, { x: l[0].x, z: l[0].z, r: Math.max(l[0].hw, l[1].hw) + 4 }); }
  for (const d of (W.turnDiscs || [])) jR.set('turn' + d.x.toFixed(1) + ',' + d.z.toFixed(1), { x: d.x, z: d.z, r: d.r + 4 }); // p51 turning circles
  for (const d of (W.stubDiscs || [])) jR.set('stub' + d.x.toFixed(1) + ',' + d.z.toFixed(1), { x: d.x, z: d.z, r: d.r + 6 });
  // opposite carriageway of a dual carriageway within 25 m on the offside of a one-way piece (then that side is the central
  // reservation and has no rail); single one-way streets get a rail on both sides
  const oppNear = (x, z, fx, fz, nx, nz) => { const gx = Math.floor(x / 25), gz = Math.floor(z / 25);
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) for (const g of (W.segGrid.get((gx + ox) * 100000 + gz + oz) || [])) { if (!g.ow || g.tun) continue;
      const dx = g.x2 - g.x1, dz = g.z2 - g.z1, l = Math.hypot(dx, dz) || 1; if ((dx * fx + dz * fz) / l > -0.7) continue; let t = ((x - g.x1) * dx + (z - g.z1) * dz) / (l * l); t = Math.max(0, Math.min(1, t));
      const px = g.x1 + dx * t - x, pz = g.z1 + dz * t - z; if (Math.hypot(px, pz) < 25 && px * nx + pz * nz > 0) return true; }
    return false; };
  const railKeys = new Set(); const rk = (x, z) => Math.round(x * 2) + ',' + Math.round(z * 2); // de-duplication of coincident rails
  for (const { e, r, P, hw, hid } of W.edges) {
    if (hid || r.tun || r.k === 'service' || /footway|path|pedestrian|cycleway/.test(r.k)) continue;
    if (((W.deg.get(e[0]) || 0) === 1 || (W.deg.get(e[1]) || 0) === 1) && P[P.length - 1][3] < 80) continue; // p51: no rails boxing in short dead-end stubs
    if (P.some(p => Math.abs(p[2]) > 0.5)) continue; // street level only (colliders have no height)
    const kind = MAIN_RE.test(r.k) || RING_RE.test(r.n || '') ? 'armco' : 'rail';
    const L = P[P.length - 1][3]; if (L < 3) continue; stats.edges++;
    // sharp bends inside one street (OSM corner vertices turning > 28 deg): both rails open up around the corner (kerb only),
    // so a car taking the corner naturally (cutting / running wide) never meets a rail end sticking into its line
    const sharp = []; for (let i = 1; i < P.length - 1; i++) { const ax = P[i][0] - P[i - 1][0], az = P[i][1] - P[i - 1][1], bx = P[i + 1][0] - P[i][0], bz = P[i + 1][1] - P[i][1];
      const c = (ax * bx + az * bz) / ((Math.hypot(ax, az) * Math.hypot(bx, bz)) || 1); if (c < Math.cos(28 * Math.PI / 180)) sharp.push(P[i][3]); }
    // round 6: narrow streets open the inside of bends turning > 40 deg over 20 m (several short OSM segments)
    const bendIn = []; if (r.w < 8) for (let a = 10; a < L - 10; a += 2) { const p1 = pointAt(P, a - 10), p2 = pointAt(P, a + 10); const h1 = Math.atan2(-p1[3], p1[4]), h2 = Math.atan2(-p2[3], p2[4]); // heading from normal
      let dh = h2 - h1; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI; if (Math.abs(dh) > 40 * Math.PI / 180) bendIn.push([a, Math.sign(p1[3] * p2[4] - p1[4] * p2[3]) || 1]); }
    const gapR = hw + 4; const ends = [e[0], e[1]].map(id => jR.get(id)).filter(Boolean);
    const own = new Set(); for (const q of P) own.add(q[0].toFixed(2) + ',' + q[1].toFixed(2)); // this street's own drive pieces
    for (const sd of [-1, 1]) {
      const o = sd * (hw + RAIL_OFF);
      let run = null;
      const flush = b => {
        if (run != null) { const a0 = run > 0 ? run + 2 : run, b0 = b < L ? b - 2 : b; // ends kept back from what they stop at
          if (b0 - a0 > 1.5) { const sub = slicePath(P, a0, b0); let dupN = 0, nS = 0; for (let a = a0; a <= b0; a += 1) { const q = pointAt(P, Math.min(a, L - 0.01)); nS++; if (railKeys.has(rk(q[0] + q[3] * o, q[1] + q[4] * o))) dupN++; }
          if (sub.length > 1 && dupN / (nS || 1) > 0.5) stats.dupDropped = (stats.dupDropped || 0) + 1;
          else if (sub.length > 1) { for (let a = a0; a <= b0; a += 1) { const q = pointAt(P, Math.min(a, L - 0.01)); railKeys.add(rk(q[0] + q[3] * o, q[1] + q[4] * o)); } runs[kind].push([sub, o]); W.roadEdgeRuns.push({ kind, sub, o, ri: e[3] });
            stats[kind === 'armco' ? 'armcoM' : 'railM'] += b0 - a0; stats[kind === 'armco' ? 'armcoRuns' : 'railRuns']++;
            for (let i = 0; i < sub.length - 1; i++) { const p1 = sub[i], p2 = sub[i + 1], dx = p2[0] - p1[0], dz = p2[1] - p1[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
              W.addBuildingCollider([[p1[0] + nx * o, p1[1] + nz * o], [p2[0] + nx * o, p2[1] + nz * o]], { h: kind === 'armco' ? 0.75 : 1.0, lm: kind }); } } } }
        run = null; };
      for (let a = 0; a < L; a += 1) {
        const q = pointAt(P, Math.min(a + 0.5, L - 0.01)); const x = q[0] + q[3] * o, z = q[1] + q[4] * o;
        // anything else drivable within 0.6 m of the rail line (junction disc, connecting street, car park, track), or a crossing
        // inside of a sharp bend: the offset line would cut across this street's own carriageway further along - gap there
        let dOwn = 1e9; for (let i = 0; i < P.length - 1; i++) { const dx = P[i + 1][0] - P[i][0], dz = P[i + 1][1] - P[i][1], L2 = dx * dx + dz * dz || 1; let t = ((x - P[i][0]) * dx + (z - P[i][1]) * dz) / L2; t = Math.max(0, Math.min(1, t)); dOwn = Math.min(dOwn, Math.hypot(x - P[i][0] - dx * t, z - P[i][1] - dz * t)); }
        const blocked = ends.some(j => Math.hypot(x - j.x, z - j.z) < j.r) || sharp.some(v => Math.abs(a + 0.5 - v) < gapR) || dOwn < Math.abs(o) - 0.15 || otherDrive(x, z, q[2], -q[4], q[3], Math.abs(o), own) || nearSig(x, z)
          || bendIn.some(([v, side]) => side === sd && Math.abs(a + 0.5 - v) < 6) || (r.ow && sd > 0 && oppNear(q[0], q[1], q[4], -q[3], q[3] * sd, q[4] * sd));
        if (blocked) flush(a); else if (run == null) run = a;
      }
      flush(L);
    }
  }
  // ---- drawing: geometry bucketed in 120 m cells (one merged mesh per cell and kind); only cells within DRAW m of the
  // camera are drawn (the rails are thin: beyond that they are a few pixels, but the whole city's worth would cost
  // a lot of vertices). A zero-size marker mesh does the per-frame distance test in onBeforeRender.
  const tex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = W.q.aniso || 4; return t; };
  const full = W.q.env >= 2, CELL = 120, DRAW = [200, 320, 450, 650][W.q.env] || 320;
  const beamT = tex(128, 32, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#9aa1a6'); gr.addColorStop(0.18, '#e2e6e8'); gr.addColorStop(0.36, '#8b9297'); gr.addColorStop(0.5, '#5d6368'); gr.addColorStop(0.64, '#8b9297'); gr.addColorStop(0.82, '#dfe3e6'); gr.addColorStop(1, '#8f969b');
    g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = '#4a4f53'; for (const x of [4, 124]) { g.fillRect(x - 2, 12, 4, 3); g.fillRect(x - 2, 18, 4, 3); } }); // W-beam ridges + bolts every 2 m
  const pT = tex(128, 16, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#6f767b'; g.fillRect(0, 0, 7, h); g.fillRect(w - 7, 0, 7, h); }); // Sigma posts every 2 m
  const railT = tex(256, 64, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#1c2023'; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 14, w, 5); // UK guard-railing: rails, balusters, posts with a white band
    for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 2, h - 9); g.fillRect(0, 0, 6, h); g.fillRect(w - 6, 0, 6, h); g.fillStyle = '#e8e4d8'; g.fillRect(0, 7, 6, 5); g.fillRect(w - 6, 7, 6, 5); });
  const M = {
    beam: new THREE.MeshStandardMaterial({ map: beamT, metalness: 0.55, roughness: 0.42, side: THREE.DoubleSide, envMapIntensity: 1.2 }),
    cap: new THREE.MeshStandardMaterial({ color: 0xb8bec2, metalness: 0.5, roughness: 0.5 }),
    post: new THREE.MeshStandardMaterial({ map: pT, alphaTest: 0.5, metalness: 0.5, roughness: 0.55, side: THREE.DoubleSide }),
    rail: full ? new THREE.MeshStandardMaterial({ map: railT, alphaTest: 0.5, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({ color: 0x23282b, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide }) };
  const cells = new Map(); const bucket = (sub, k, g) => { const c = sub[Math.floor(sub.length / 2)]; const key = Math.floor(c[0] / CELL) * 100000 + Math.floor(c[1] / CELL); let b = cells.get(key); if (!b) cells.set(key, b = { x: (Math.floor(c[0] / CELL) + 0.5) * CELL, z: (Math.floor(c[1] / CELL) + 0.5) * CELL, g: {} }); (b.g[k] = b.g[k] || []).push(g); };
  for (const [sub, o] of runs.armco) { bucket(sub, 'beam', ribbonV(sub, o, 0.45, 0.75, 2)); if (!low) bucket(sub, 'cap', capH(sub, o, 0.08, 0.75)); if (full) bucket(sub, 'post', ribbonV(sub, o + Math.sign(o) * 0.12, 0.0, 0.62, 2)); } // posts (alpha-tested) on High+
  // guard-railing: Low / Medium opaque top (+ mid on Medium) rails, cheap to fill; High+: the full alpha-tested railing
  for (const [sub, o] of runs.rail) { if (full) bucket(sub, 'rail', ribbonV(sub, o, 0.0, 1.0, 2)); else { bucket(sub, 'rail', ribbonV(sub, o, 0.92, 1.0, 2)); if (!low) bucket(sub, 'rail', ribbonV(sub, o, 0.45, 0.5, 2)); } }
  const grp = new THREE.Group(); grp.name = 'roadEdges'; const list = [];
  for (const b of cells.values()) { const cg = new THREE.Group(); cg.userData.c = [b.x, b.z]; for (const k in b.g) { const m = new THREE.Mesh(mergeGeometries(b.g[k]), M[k]); m.receiveShadow = !low; cg.add(m); } grp.add(cg); list.push(cg); }
  const mk = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()); mk.frustumCulled = false; mk.geometry.setDrawRange(0, 0);
  mk.onBeforeRender = (r, sc, cam) => { const e = cam.matrixWorld.elements, p = { x: e[12], z: e[14] }; if (Math.abs(p.x - (mk._x ?? 1e9)) + Math.abs(p.z - (mk._z ?? 1e9)) < 8) return; mk._x = p.x; mk._z = p.z; const R = DRAW + CELL * 0.71; for (const cg of list) cg.visible = Math.hypot(cg.userData.c[0] - p.x, cg.userData.c[1] - p.z) < R; };
  grp.add(mk); W.group.add(grp); W.roadEdgeMats = Object.values(M); W.roadEdgeCells = list.length;
  return stats;
}
