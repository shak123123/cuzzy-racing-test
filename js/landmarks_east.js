// East-side landmarks (Bordesley / Small Heath / Highgate), hand-modelled on their OpenStreetMap footprints
// (data.east, © OpenStreetMap contributors, ODbL) from public reference photos:
//   St Andrew's stadium (Birmingham City FC) - four stands, blue/white cladding, roofs, floodlights, pitch
//   Asda Small Heath (859 Coventry Road) - superstore with green fascia, entrance portal, totem sign
//   Birmingham Central Mosque (180 Belgrave Middleway) - red brick, white plinth, white dome, tall minaret
//   Central Jamia Mosque Ghamkol Sharif (Golden Hillock Road) - red/buff brick, two dark domes, green-ringed minaret
//   Green Lane Masjid (20 Green Lane) - Victorian red brick + terracotta former library/baths with corner tower
// Facade textures are original images generated for this project (tools/textures_src, see tools/make_east_textures.py);
// JPEGs: 1k on Low, 2k on Medium, 4k on High/Ultra. Every landmark gets a solid footprint collider via world.addBuildingCollider.
import * as THREE from 'three';
import { mergeGeometries } from './lib/addons/utils/BufferGeometryUtils.js';

const dm = v => v / 10;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

export function buildEastLandmarks(W) {
  const E = W.d.east; if (!E) return null;
  const t0 = performance.now();
  const root = new THREE.Group(); root.name = 'landmarks_east';
  const info = { landmarks: [], colliders: 0, tris: 0, meshes: 0, blocked: [] };
  const env = W.q.env ?? 0; const res = env >= 2 ? '4k' : env >= 1 ? '2k' : '1k'; // Low 1k, Medium 2k, High/Ultra 4k
  const S = env >= 2 ? 2 : env >= 1 ? 1.5 : 1; // curve segment multiplier (domes, minarets, masts)
  const loader = new THREE.TextureLoader();
  const img = (name, rx = 1, ry = 1) => { const t = loader.load(new URL(`../img/east/${name}_${res}.jpg`, import.meta.url).href); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = W.q.aniso || 2; return t; };
  // landmark PBR sets (tools/make_landmark_textures.py, client/img/lm): albedo 512 Low / 1k Medium / 2k High / 4k Ultra,
  // normal map (Medium+) and roughness map; the GPU mip chain covers distance
  const pbr = (name, rx = 1, ry = 1, o = {}) => lmPBR(W, name, rx, ry, o);
  const poly = k => { const a = E[k]?.p; if (!a) return null; const p = []; for (let i = 0; i < a.length; i += 2) p.push([dm(a[i]), dm(a[i + 1])]); return p; };
  const std = o => new THREE.MeshStandardMaterial(o);
  const cast = W.q.shadows >= 1;
  // one merged mesh per material per landmark, so each landmark is a handful of compact, frustum-cullable draws
  const bucket = () => new Map();
  const put = (B, mat, g) => { if (!g) return; if (!B.has(mat)) B.set(mat, []); B.get(mat).push(clean(g)); };
  const flush = (B, name) => { const grp = new THREE.Group(); grp.name = name; for (const [mat, gs] of B) { const g = mergeGeometries(gs); if (!g) continue; g.computeBoundingSphere(); const m = new THREE.Mesh(g, mat); m.castShadow = cast; m.receiveShadow = true; grp.add(m); info.tris += g.attributes.position.count / 3; info.meshes++; } root.add(grp); info.landmarks.push(name); };
  const solid = (pts, h, name) => { if (W.blocksRoad && W.driveGrid && W.blocksRoad(pts)) info.blocked.push(name); W.addBuildingCollider(pts, { h, lm: name }); info.colliders++; };

  // ---------------------------------------------------------------- shared materials
  const M = {
    white: std({ color: 0xf1f1ec, roughness: 0.6 }),
    offwhite: std({ color: 0xe4e6e8, roughness: 0.45, metalness: 0.25, side: THREE.DoubleSide }),
    steel: std({ color: 0x9aa1a8, roughness: 0.45, metalness: 0.7 }),
    dark: std({ color: 0x2c3034, roughness: 0.7 }),
    gold: std({ color: 0xd4af37, roughness: 0.3, metalness: 0.9 }),
    concrete: std({ color: 0xa9a7a1, roughness: 0.95 }),
    brick: std({ color: 0xb4583e, roughness: 0.9, map: W.F?.[1]?.t }),
  };

  // ================================================================ St Andrew's
  { const pitch = poly('pitch'), stadium = poly('stadium');
    if (pitch && stadium) {
      const B = bucket(); const R = minRect(pitch);
      const clad = pbr('stadium_clad', 1, 1, { roughness: 1, metalness: 0.35 }); // original generated PBR: blue ribbed cladding, white band, girts, louvres
      const seats = std({ map: img('stadium_seats'), roughness: 0.6 });
      const blue = std({ color: 0x1746b8, roughness: 0.5, metalness: 0.2 });
      // pitch: mown stripes and markings drawn on a canvas, laid on the OSM pitch rectangle
      const pt = W.tex(1024, 640, (g, w, h) => { for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#3f8f3a' : '#48a043'; g.fillRect(i * w / 16, 0, w / 16 + 1, h); }
        g.strokeStyle = '#f4f4f0'; g.lineWidth = 5; const m = 30; g.strokeRect(m, m, w - 2 * m, h - 2 * m); g.beginPath(); g.moveTo(w / 2, m); g.lineTo(w / 2, h - m); g.stroke();
        g.beginPath(); g.arc(w / 2, h / 2, h * 0.14, 0, 7); g.stroke(); for (const s of [0, 1]) { const x = s ? w - m : m, d = s ? -1 : 1; g.strokeRect(Math.min(x, x + d * w * 0.16), h * 0.2, w * 0.16, h * 0.6); g.strokeRect(Math.min(x, x + d * w * 0.055), h * 0.37, w * 0.055, h * 0.26); } }, false);
      const pm = std({ map: pt, roughness: 0.95 });
      { const g = new THREE.PlaneGeometry(R.hx * 2 + 6, R.hy * 2 + 6); g.rotateX(-Math.PI / 2); g.rotateY(-Math.atan2(R.ax[1], R.ax[0])); g.translate(R.c[0], 0.06, R.c[1]); put(B, pm, g); }
      put(B, M.concrete, cap(stadium, () => 0.03, 10));
      const dPitch = v => distToPoly(v, pitch);
      const stands = [['stand_main', 17, 'Garrison Lane Stand'], ['stand_kop', 19, 'Kop'], ['stand_tilton', 19, 'Tilton Road'], ['stand_gilmerrick', 21, 'Gil Merrick']];
      const standPolys = [];
      for (const [k, H] of stands) { const P = poly(k); if (!P) continue; standPolys.push(P);
        const ds = P.map(dPitch); const d0 = Math.min(...ds), d1 = Math.max(...ds) || d0 + 1;
        const yAt = v => 1.2 + (H - 4.5) * Math.min(1, Math.max(0, (dPitch(v) - d0) / Math.max(4, d1 - d0)));
        // raked seating bowl (per-vertex height from distance to the pitch; rows run parallel to the pitch edge)
        put(B, seats, cap(P, yAt, 1, v => { const e = nearestEdgeDir(v, pitch); return [(v[0] * e[0] + v[1] * e[1]) / 12, dPitch(v) / 9.6]; }));
        // walls: full-height clad back/sides, low parapet on the pitch side
        const front = (a, b) => { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; return dPitch(m) < d0 + 4; };
        put(B, clad, walls(P, (a, b) => front(a, b) ? [0, 1.3] : [0, H + 2], 2 * (H + 2), H + 2));
        // roof over the stand + fascia and a front beam, a couple of props on the main stand (propped cantilever)
        // roof: rises from the pitch-side fascia to the back wall (drains to the rear, like the real cantilever roofs)
        const top = cap(P, v => H + 2.2 + 1.6 * Math.min(1, Math.max(0, (dPitch(v) - d0) / Math.max(4, d1 - d0))), 10); put(B, M.offwhite, top);
        put(B, M.steel, flipDown(cap(P, v => H + 2.0 + 1.6 * Math.min(1, Math.max(0, (dPitch(v) - d0) / Math.max(4, d1 - d0))), 10))); // roof soffit
        for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; if (!front(a, b)) continue; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 3) continue;
          put(B, blue, beam(a, b, H + 1.2, H + 2.4, 0.6));
          if (k === 'stand_main') for (let s = 0.25; s < 0.9; s += 0.25) { const x = a[0] + (b[0] - a[0]) * s, z = a[1] + (b[1] - a[1]) * s; const c = new THREE.CylinderGeometry(0.25, 0.25, H + 1.2, 6); c.translate(x, (H + 1.2) / 2, z); put(B, M.steel, c); } }
        // roof trusses along the stand
        const o = minRect(P); const st = env >= 2 ? 0.2 : 0.4; for (let s = -0.8; s <= 0.81; s += st) { const cx = o.c[0] + o.ax[0] * o.hx * s, cz = o.c[1] + o.ax[1] * o.hx * s; put(B, M.steel, orientedBox([cx, cz], o.ay, o.hy, 0.35, H + 2.2, H + 3.6)); }
        solid(P, H + 2.2, 'standrews');
      }
      // "ST ANDREW'S" lettering on the back of the Main Stand, facing Garrison Lane
      { const P = poly('stand_main'); if (P) { let best = null; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const d = L < 20 ? -1 : dPitch(m) + L * 0.5; if (!best || d > best.d) best = { a, b, d }; }
          const t = W.tex(1024, 128, (g, w, h) => { g.fillStyle = '#1746b8'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffffff'; g.font = 'bold 92px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText("ST ANDREW'S", w / 2, h / 2 + 4); }, false);
          put(B, std({ map: t, roughness: 0.5 }), sign(best.a, best.b, P, 0.4, 34, 4.25, 11.5)); } }
      // four floodlight pylons at the stadium corners, lamp banks tilted toward the pitch
      const lamp = std({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: 1.2 }); W.floodMat = lamp; // lit only at night (World.update)
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const dir = [R.ax[0] * sx * R.hx + R.ay[0] * sy * R.hy, R.ax[1] * sx * R.hx + R.ay[1] * sy * R.hy]; const L = Math.hypot(dir[0], dir[1]);
        let p = [R.c[0] + dir[0] * 1.22, R.c[1] + dir[1] * 1.22]; for (let s = 1.22; s < 1.7 && standPolys.some(Q => pip(p, Q)); s += 0.04) p = [R.c[0] + dir[0] * s, R.c[1] + dir[1] * s];
        const mast = new THREE.CylinderGeometry(0.45, 0.9, 44, Math.round(8 * S)); mast.translate(p[0], 22, p[1]); put(B, M.steel, mast);
        const yaw = Math.atan2(-dir[0] / L, -dir[1] / L);
        if (env >= 2) { for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) { const q = new THREE.BoxGeometry(1.1, 0.8, 0.5); q.translate(-2.8 + i * 1.4, -1.1 + j * 1.1, 0.1); q.rotateX(-0.35); q.rotateY(yaw); q.translate(p[0], 45, p[1]); put(B, lamp, q); } }
        else { const head = new THREE.BoxGeometry(7, 3.2, 0.5); head.rotateX(-0.35); head.rotateY(yaw); head.translate(p[0], 45, p[1]); put(B, lamp, head); }
        const frame = new THREE.BoxGeometry(7.4, 3.6, 0.3); frame.rotateX(-0.35); frame.rotateY(yaw); frame.translate(p[0] - dir[0] / L * 0.35, 45, p[1] - dir[1] / L * 0.35); put(B, M.dark, frame);
        if (!standPolys.some(Q => pip(p, Q))) { W.addCircleCollider(p, 1.1); info.colliders++; }
      }
      flush(B, 'standrews');
    } }

  // ================================================================ Asda Small Heath
  { const P = poly('asda'), park = poly('asda_park');
    if (P) { const B = bucket(); const H = 9.5; const c = centroid(P); const pc = park ? centroid(park) : [c[0], c[1] - 50];
      const green = std({ color: 0x5aa832, roughness: 0.45 });
      const cladT = W.tex(256, 256, (g, w, h) => { g.fillStyle = '#d6d9dc'; g.fillRect(0, 0, w, h); g.fillStyle = '#c3c7cb'; for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 2, h); g.fillStyle = 'rgba(255,255,255,.35)'; for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 1); });
      const cladM = std({ map: cladT, roughness: 0.6, metalness: 0.2 }); const wallM = pbr('asda_clad', 1, 1, { roughness: 1, metalness: 0.2 }); // original generated PBR: silver panels, green strip, brick plinth
      put(B, wallM, walls(P, () => [0, H], 14, H));
      put(B, M.white, walls(offsetPoly(P, 0.18), () => [H - 0.1, H + 0.7], 10, 1)); // parapet coping
      put(B, green, walls(offsetPoly(P, 0.25), () => [6.6, 8.6], 10, 2)); // green fascia band all round
      put(B, std({ color: 0x8b8f93, roughness: 0.9 }), cap(P, () => H, 10));
      // entrance portal on the elevation facing the car park, carrying the store-front texture
      let best = null; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = outward(P, a, b); const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const tp = [pc[0] - m[0], pc[1] - m[1]]; const s = (tp[0] * n[0] + tp[1] * n[1]) / (Math.hypot(tp[0], tp[1]) || 1) * Math.min(L, 60); if (!best || s > best.s) best = { a, b, n, L, s, m }; }
      { const { a, b, n, L, m } = best; const w = Math.min(34, L * 0.8), d = 3, h = 12; const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
        const q0 = [m[0] - ux * w / 2, m[1] - uz * w / 2], q1 = [m[0] + ux * w / 2, m[1] + uz * w / 2];
        const Q = [q0, q1, [q1[0] + n[0] * d, q1[1] + n[1] * d], [q0[0] + n[0] * d, q0[1] + n[1] * d]];
        put(B, cladM, walls(Q, () => [0, h], 6, 6)); put(B, M.offwhite, cap(Q, () => h, 10));
        put(B, std({ map: img('asda_front'), roughness: 0.35, metalness: 0.1 }), sign(Q[3], Q[2], Q, 0.08, w, h, 0));
        solid(Q, h, 'asda');
        // glazed entrance canopy: a thin white cantilever along the front with slim posts and a lit soffit strip
        { const cw = Math.min(L * 0.95, w + 24), cd = 4.5; const c0 = [m[0] - ux * cw / 2 + n[0] * d, m[1] - uz * cw / 2 + n[1] * d], c1 = [m[0] + ux * cw / 2 + n[0] * d, m[1] + uz * cw / 2 + n[1] * d];
          const C = [c0, c1, [c1[0] + n[0] * cd, c1[1] + n[1] * cd], [c0[0] + n[0] * cd, c0[1] + n[1] * cd]];
          if (!(W.onAnyDrive && C.some(q => W.onAnyDrive(q[0], q[1], 0, 0.2)))) { put(B, M.white, cap(C, () => 4.4, 10)); put(B, M.white, walls(C, () => [4.0, 4.4], 10, 1));
            const lit = std({ color: 0xffffff, emissive: 0xfff3dc, emissiveIntensity: 0 }); (W.nightMats ||= []).push([lit, 1.6]);
            const strip = [[c0[0] + n[0] * 1.5, c0[1] + n[1] * 1.5], [c1[0] + n[0] * 1.5, c1[1] + n[1] * 1.5], [c1[0] + n[0] * 2.1, c1[1] + n[1] * 2.1], [c0[0] + n[0] * 2.1, c0[1] + n[1] * 2.1]];
            put(B, lit, flipDown(cap(strip, () => 3.98, 10))); put(B, M.offwhite, flipDown(cap(C, () => 3.99, 10)));
            const np = Math.max(2, Math.round(cw / 9)); for (let i = 0; i <= np; i++) { const t = i / np; const x = c0[0] + (c1[0] - c0[0]) * t + n[0] * (cd - 0.4), z = c0[1] + (c1[1] - c0[1]) * t + n[1] * (cd - 0.4); if (W.onAnyDrive && W.onAnyDrive(x, z, 0, -0.6)) continue; const pg = new THREE.CylinderGeometry(0.12, 0.12, 4.0, 8); pg.translate(x, 2.0, z); put(B, M.steel, pg); W.addCircleCollider([x, z], 0.15, 8); info.colliders++; } } } }
      solid(P, H, 'asda');
      // totem sign by the car park entrance nearest Coventry Road
      let totem = null;
      { const cov = W.d.roads.filter(r => r.n === 'Coventry Road'); const src = park || P; let bp = null;
        for (const v of src) for (const r of cov) for (let i = 0; i + 3 < r.p.length; i += 2) { const d = segDist(v, [dm(r.p[i]), dm(r.p[i + 1])], [dm(r.p[i + 2]), dm(r.p[i + 3])]); if (!bp || d < bp.d) bp = { v, d }; }
        if (bp) { const cc = centroid(src); const dx = cc[0] - bp.v[0], dz = cc[1] - bp.v[1], l = Math.hypot(dx, dz) || 1; const p = [bp.v[0] + dx / l * 5, bp.v[1] + dz / l * 5];
          const t = W.tex(256, 512, (g, w, h) => { g.fillStyle = '#5aa832'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = 'bold 96px Arial, sans-serif'; g.textAlign = 'center'; g.fillText('asda', w / 2, 150); g.font = 'bold 34px Arial, sans-serif'; g.fillText('SMALL HEATH', w / 2, 230); g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(24, 300, w - 48, 4); g.font = '30px Arial, sans-serif'; g.fillText('Superstore', w / 2, 360); g.fillText('Petrol · Pharmacy', w / 2, 410); }, false);
          const face = new THREE.BoxGeometry(3, 6, 0.6); const yaw = Math.atan2(dx, dz); face.rotateY(yaw); face.translate(p[0], 5, p[1]); put(B, std({ map: t, roughness: 0.4 }), boxUV(face));
          const leg = new THREE.BoxGeometry(0.5, 2, 0.4); leg.rotateY(yaw); leg.translate(p[0], 1, p[1]); put(B, M.steel, leg); W.addCircleCollider(p, 1.6); info.colliders++; totem = p; } }
      if (park) drivePark(W, park, totem, root, info);
      if (park) { const o = minRect(park); for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) { const q = [o.c[0] + o.ax[0] * o.hx * 0.4 * i + o.ay[0] * o.hy * 0.55 * j, o.c[1] + o.ax[1] * o.hx * 0.4 * i + o.ay[1] * o.hy * 0.55 * j]; if (!pip(q, park) || pip(q, P)) continue;
          const pole = new THREE.CylinderGeometry(0.1, 0.14, 8, 6); pole.translate(q[0], 4, q[1]); put(B, M.steel, pole); const hd = new THREE.BoxGeometry(1.4, 0.25, 0.5); hd.translate(q[0], 8, q[1]); put(B, M.dark, hd); const lens = new THREE.BoxGeometry(1.2, 0.04, 0.4); lens.translate(q[0], 7.86, q[1]); put(B, W.lampHeadMat || (W.parkLampMat ||= std({ color: 0xffffff, emissive: 0xffc98a, emissiveIntensity: 0 })), lens); W.addCircleCollider(q, 0.25, 8); info.colliders++; (W.asdaLamps ||= []).push(q); } }
      flush(B, 'asda');
    } }

  // ================================================================ Birmingham Central Mosque
  { const P = poly('centralmosque');
    if (P) { const B = bucket(); const H = 10.5; const c = centroid(P);
      put(B, pbr('centralmosque_wall2'), walls(P, () => [0, H], 1.5 * H, H));
      put(B, std({ color: 0xcfcdc6, roughness: 0.9 }), cap(P, () => H, 10));
      put(B, M.white, walls(offsetPoly(P, 0.12), () => [H - 0.6, H + 0.3], 10, 1)); // white coping
      // minaret on the Belgrave Middleway elevation
      const e = nearestEdgeToRoad(W, P, /Belgrave Middleway/); const n = outward(P, e.a, e.b);
      const along = 0.3; const mp = [e.a[0] + (e.b[0] - e.a[0]) * along - n[0] * 1.2, e.a[1] + (e.b[1] - e.a[1]) * along - n[1] * 1.2];
      const yaw = Math.atan2(e.b[0] - e.a[0], e.b[1] - e.a[1]);
      const sq = (w, y0, y1, mat) => { const g = new THREE.BoxGeometry(w, y1 - y0, w); g.rotateY(yaw); g.translate(mp[0], (y0 + y1) / 2, mp[1]); put(B, mat, boxUV(g, w / 3, (y1 - y0) / 3)); };
      sq(4.2, 0, 3.2, M.white); sq(3.8, 3.2, 29, M.brick);
      const arches = std({ map: W.tex(512, 128, (g, w, h) => { g.fillStyle = '#f3f3ef'; g.fillRect(0, 0, w, h); g.fillStyle = '#6b3a2c'; for (let i = 0; i < 8; i++) { const x = i * 64 + 14; g.beginPath(); g.moveTo(x, h - 16); g.lineTo(x, 60); g.quadraticCurveTo(x + 18, 26, x + 36, 60); g.lineTo(x + 36, h - 16); g.fill(); } }, false), roughness: 0.6 });
      { const g = new THREE.BoxGeometry(5.2, 4, 5.2); g.rotateY(yaw); g.translate(mp[0], 31, mp[1]); put(B, arches, g); }
      sq(5.8, 33, 33.4, M.white);
      // minaret detail: ornament band, corbelled balcony (sherefe) with a railing at the top of the brick shaft, and a
      // second balcony under the lantern cap; pointed-arch entrance portal and ornament drum under the dome (below)
      const band = pbr('islamic_band', 2, 0.5);
      { const g = new THREE.CylinderGeometry(2.05, 2.05, 1.6, Math.round(16 * S), 1, true); g.translate(mp[0], 24.6, mp[1]); put(B, band, g); }
      balcony(B, put, mp, 28.9, 2.0, 3.3, M.white, S); balcony(B, put, mp, 38.2, 2.0, 3.0, M.white, S);
      for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const g = new THREE.BoxGeometry(0.45, 5.4, 0.45); const r = 1.5; const cy = Math.cos(yaw), sy = Math.sin(yaw); g.translate(mp[0] + (ox * cy + oz * sy) * r, 36.1, mp[1] + (-ox * sy + oz * cy) * r); put(B, M.white, g); }
      sq(3.8, 38.8, 39.4, M.white);
      put(B, M.white, onion(mp, 39.4, 2.1, 4.4, Math.round(20 * S))); put(B, M.gold, finial(mp, 43.8, 3.2));
      // main dome: white, slightly pointed, on a short drum; crescent finial
      { const dc = [c[0] * 0.8 + mp[0] * 0.2, c[1] * 0.8 + mp[1] * 0.2]; const R = Math.min(9.5, minRect(P).hy * 0.55);
        const drum = new THREE.CylinderGeometry(R, R, 2.2, Math.round(32 * S), 1, true); drum.translate(dc[0], H + 1.1, dc[1]); put(B, pbr('islamic_band', Math.round(R * 1.2), 0.35), drum);
        { const r = new THREE.CylinderGeometry(R * 1.03, R * 1.03, 0.35, Math.round(32 * S)); r.translate(dc[0], H + 2.3, dc[1]); put(B, M.white, r); }
        put(B, M.white, dome(dc, H + 2.2, R, R * 1.1, Math.round(32 * S))); put(B, M.gold, finial(dc, H + 2.2 + R * 1.1, 2.6)); }
      // green name board over the entrance
      { const t = W.tex(1024, 192, (g, w, h) => { g.fillStyle = '#1f7a3d'; g.fillRect(0, 0, w, h); g.strokeStyle = '#e8e8e0'; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16); g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.font = 'bold 64px Arial, sans-serif'; g.fillText('BIRMINGHAM CENTRAL MOSQUE', w / 2, 120); }, false);
        const a2 = [e.a[0] + (e.b[0] - e.a[0]) * 0.55, e.a[1] + (e.b[1] - e.a[1]) * 0.55], b2 = [e.a[0] + (e.b[0] - e.a[0]) * 0.95, e.a[1] + (e.b[1] - e.a[1]) * 0.95];
        put(B, std({ map: t, roughness: 0.5 }), sign(a2, b2, P, 0.25, Math.min(16, Math.hypot(b2[0] - a2[0], b2[1] - a2[1])), 3, 6.8)); }
      put(B, M.white, portal(e.a, e.b, P, 0.78, 6.5, 9.2, 1.1));
      solid(P, H, 'centralmosque');
      flush(B, 'centralmosque');
    } }

  // ================================================================ Ghamkol Sharif
  { const P = poly('ghamkol');
    if (P) { const B = bucket(); const H = 12; const c = centroid(P);
      const wallM = pbr('ghamkol_wall2');
      put(B, wallM, walls(P, () => [0, H], 1.5 * H, H));
      const tile = std({ color: 0x7c3526, roughness: 0.85 });
      const inner = P.map(q => [c[0] + (q[0] - c[0]) * 0.72, c[1] + (q[1] - c[1]) * 0.72]);
      put(B, tile, frustum(P, inner, H, H + 3.2)); put(B, std({ color: 0x6f6a64, roughness: 0.9 }), cap(inner, () => H + 3.2, 10));
      put(B, M.white, walls(offsetPoly(P, 0.12), () => [H - 0.3, H + 0.2], 10, 1));
      const e = nearestEdgeToRoad(W, P, /Poets Corner|Golden Hillock/); const n = outward(P, e.a, e.b);
      const mp = [e.a[0] + (e.b[0] - e.a[0]) * 0.35 - n[0] * 1.5, e.a[1] + (e.b[1] - e.a[1]) * 0.35 - n[1] * 1.5];
      const yaw = Math.atan2(e.b[0] - e.a[0], e.b[1] - e.a[1]);
      const buff = std({ color: 0xd8c39a, roughness: 0.9 }), grn = pbr('islamic_band', 1.5, 0.4, { roughness: 0.45 }), domeM = std({ color: 0x46514c, roughness: 0.45, metalness: 0.45 });
      const sq = (w, y0, y1, mat) => { const g = new THREE.BoxGeometry(w, y1 - y0, w); g.rotateY(yaw); g.translate(mp[0], (y0 + y1) / 2, mp[1]); put(B, mat, boxUV(g, w / 3, (y1 - y0) / 3)); };
      sq(5.2, 0, 10, buff); sq(5.6, 10, 10.6, M.dark); sq(4, 10.6, 20, M.brick); sq(5.6, 20, 21.6, grn); sq(5.8, 21.6, 22.2, M.dark); sq(3.6, 22.2, 30, M.brick); sq(5.2, 30, 31.4, grn); sq(5.4, 31.4, 32, M.dark);
      { const g = new THREE.CylinderGeometry(1.9, 1.9, 3.2, 8); g.translate(mp[0], 33.6, mp[1]); put(B, grn, g); const r = new THREE.CylinderGeometry(2.3, 2.3, 0.5, 8); r.translate(mp[0], 35.4, mp[1]); put(B, M.dark, r); }
      put(B, domeM, onion(mp, 35.6, 2.1, 3.6, Math.round(16 * S))); put(B, M.gold, finial(mp, 39.2, 2.4));
      balcony(B, put, mp, 21.6, 2.3, 3.4, M.white, S); balcony(B, put, mp, 31.4, 2.1, 3.1, M.white, S);
      put(B, std({ color: 0xe9dcc0, roughness: 0.7 }), portal(e.a, e.b, P, 0.7, 7, 10, 1.2));
      // main dome away from the minaret, smaller dome on the other side
      const o = minRect(P); const away = [c[0] - mp[0], c[1] - mp[1]]; const al = Math.hypot(away[0], away[1]) || 1;
      const R1 = Math.min(9, o.hy * 0.42), d1 = [c[0] + away[0] / al * o.hy * 0.15, c[1] + away[1] / al * o.hy * 0.15];
      { const drum = new THREE.CylinderGeometry(R1 * 0.92, R1 * 0.92, 3, Math.round(24 * S), 1, true); drum.translate(d1[0], H + 4.6, d1[1]); put(B, buff, drum); const band = new THREE.CylinderGeometry(R1 * 0.95, R1 * 0.95, 0.7, Math.round(24 * S)); band.translate(d1[0], H + 6.2, d1[1]); put(B, grn, band);
        put(B, domeM, dome(d1, H + 6.5, R1, R1 * 1.05, Math.round(28 * S))); put(B, M.gold, finial(d1, H + 6.5 + R1 * 1.05, 3)); }
      { const side = [-(e.b[1] - e.a[1]), e.b[0] - e.a[0]]; const sl = Math.hypot(side[0], side[1]) || 1; let d2 = [mp[0] + (e.a[0] - e.b[0]) * 0.18 - n[0] * 12, mp[1] + (e.a[1] - e.b[1]) * 0.18 - n[1] * 12]; if (!pip(d2, P)) d2 = [c[0] * 0.5 + mp[0] * 0.5, c[1] * 0.5 + mp[1] * 0.5]; void side; void sl;
        const R2 = R1 * 0.5; const drum = new THREE.CylinderGeometry(R2, R2, 2, Math.round(16 * S), 1, true); drum.translate(d2[0], H + 3.2, d2[1]); put(B, buff, drum);
        put(B, domeM, dome(d2, H + 4.2, R2, R2 * 1.05, Math.round(20 * S))); put(B, M.gold, finial(d2, H + 4.2 + R2 * 1.05, 1.8)); }
      solid(P, H, 'ghamkol');
      const P2 = poly('ghamkol_house'); if (P2) { put(B, wallM, walls(P2, () => [0, 8], 12, 8)); put(B, std({ color: 0x6f6a64, roughness: 0.9 }), cap(P2, () => 8, 10)); solid(P2, 8, 'ghamkol_house'); }
      flush(B, 'ghamkol');
    } }

  // ================================================================ Green Lane Masjid
  { const P = poly('greenlane');
    if (P) { const B = bucket(); const H = 14; const o = minRect(P);
      const wallM = std({ map: img('greenlane_wall'), roughness: 0.85 }); const terra = std({ color: 0xc0643c, roughness: 0.8 }), slate = std({ color: 0x4a4f57, roughness: 0.8 });
      put(B, wallM, walls(P, () => [0, H], H * 1.5, H)); put(B, terra, walls(offsetPoly(P, 0.15), () => [H - 0.8, H], 10, 1));
      put(B, slate, cap(P, () => H - 0.05, 10)); put(B, slate, gable(o.c, o.ax, o.hx * 0.96, o.hy * 0.96, H, 5));
      // corner clock tower at the Green Lane / Little Green Lane corner
      let bv = P[0], bd = 1e9; for (const v of P) { const d = roadDist(W, v, /^(Green Lane|Little Green Lane)$/); if (d < bd) { bd = d; bv = v; } }
      const c = centroid(P); const dx = c[0] - bv[0], dz = c[1] - bv[1], l = Math.hypot(dx, dz) || 1; const tp = [bv[0] + dx / l * 4, bv[1] + dz / l * 4];
      const yaw = Math.atan2(o.ax[0], o.ax[1]);
      { const g = new THREE.BoxGeometry(6, 26, 6); g.rotateY(yaw); g.translate(tp[0], 13, tp[1]); put(B, wallM, boxUV(g, 6 / 21, 26 / 14)); }
      { const g = new THREE.BoxGeometry(6.8, 1.2, 6.8); g.rotateY(yaw); g.translate(tp[0], 26.6, tp[1]); put(B, terra, g); }
      { const g = new THREE.ConeGeometry(4.6, 8, 4); g.rotateY(yaw + Math.PI / 4); g.translate(tp[0], 31.2, tp[1]); put(B, slate, g); put(B, M.gold, finial(tp, 35.2, 2)); }
      const clk = W.tex(128, 128, g => { g.fillStyle = '#f2efe6'; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill(); g.strokeStyle = '#111'; g.lineWidth = 6; g.beginPath(); g.moveTo(64, 64); g.lineTo(64, 22); g.moveTo(64, 64); g.lineTo(92, 74); g.stroke(); }, false);
      const cm = std({ map: clk, roughness: 0.5 });
      for (let i = 0; i < 4; i++) { const g = new THREE.CircleGeometry(2, 20); const a = yaw + i * Math.PI / 2; g.translate(0, 0, 3.05); g.rotateY(a); g.translate(tp[0], 22, tp[1]); put(B, cm, g); }
      solid(P, H, 'greenlane');
      flush(B, 'greenlane');
    } }

  W.group.add(root);
  info.tris = Math.round(info.tris); info.ms = Math.round(performance.now() - t0); W.eastInfo = info;
  return root;
}

// ======================= geometry helpers (local copies; world.js keeps its own private) =======================
// Asda car park: the OSM polygon becomes a visible asphalt surface and a drivable area (strips of drive pieces that
// stay inside the polygon), joined to Coventry Road by up to two entrance pieces with their own asphalt apron.
function drivePark(W, park, totem, root, info) {
  const mat = new THREE.MeshStandardMaterial({ map: W.T.asphalt, roughnessMap: W.T.asphaltRough, roughness: 1, color: 0xb4b4b4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  W.roadMats?.push(mat);
  const uvw = g => { const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / 8, p.getZ(i) / 8); return g; };
  { const sh = new THREE.Shape(park.map(([x, z]) => new THREE.Vector2(x, -z))); const g = new THREE.ShapeGeometry(sh); g.rotateX(-Math.PI / 2); g.translate(0, 0.02, 0);
    const m = new THREE.Mesh(uvw(g), mat); m.receiveShadow = true; m.name = 'asda_park'; root.add(m); }
  // scan-line strips: interval of the polygon common to z-hw, z, z+hw, shortened at the ends so the capsule stays inside
  const hw = 1.7, step = 2.6; const zs = park.map(p => p[1]); const z0 = Math.min(...zs), z1 = Math.max(...zs); let n = 0;
  const cuts = z => { const xs = []; for (let i = 0, j = park.length - 1; i < park.length; j = i++) { const [xi, zi] = park[i], [xj, zj] = park[j]; if ((zi > z) !== (zj > z)) xs.push(xi + (z - zi) / (zj - zi) * (xj - xi)); } xs.sort((a, b) => a - b); const r = []; for (let i = 0; i + 1 < xs.length; i += 2) r.push([xs[i], xs[i + 1]]); return r; };
  const inter = (A, B) => { const r = []; for (const a of A) for (const b of B) { const l = Math.max(a[0], b[0]), h = Math.min(a[1], b[1]); if (h > l) r.push([l, h]); } return r; };
  for (let z = z0 + 0.3; z < z1; z += step) {
    for (const [a, b] of inter(inter(cuts(z), cuts(Math.max(z - hw, z0 + 0.01))), cuts(Math.min(z + hw, z1 - 0.01)))) { const x1 = a + hw * 0.6, x2 = b - hw * 0.6; if (x2 > x1) { W.addDrive(x1, z, x2, z, hw, 0, 0); n++; } } }
  // entrances: the park-edge points nearest Coventry Road (>= 45 m apart, clear of the totem sign)
  const cov = W.d.roads.filter(r => r.n === 'Coventry Road' && !r.tun); const cands = [];
  for (let i = 0; i < park.length; i++) { const a = park[i], b = park[(i + 1) % park.length]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s = 3; s < L - 3; s += 2) { const p = [a[0] + (b[0] - a[0]) * s / L, a[1] + (b[1] - a[1]) * s / L]; let bp = null;
      for (const r of cov) for (let k = 0; k + 3 < r.p.length; k += 2) { const q = nearestOnSeg(p, [r.p[k] / 10, r.p[k + 1] / 10], [r.p[k + 2] / 10, r.p[k + 3] / 10]); if (!bp || q.d < bp.d) bp = q; }
      if (bp && bp.d < 30 && !(totem && Math.hypot(p[0] - totem[0], p[1] - totem[1]) < 9)) cands.push({ p, q: bp }); } }
  cands.sort((u, v) => u.q.d - v.q.d); const ent = [];
  for (const c of cands) { if (ent.length >= 2) break; if (ent.every(e => Math.hypot(e.p[0] - c.p[0], e.p[1] - c.p[1]) > 45)) ent.push(c); }
  for (const { p, q } of ent) { const dx = p[0] - q.x, dz = p[1] - q.z, l = Math.hypot(dx, dz) || 1; const ux = dx / l, uz = dz / l;
    const inP = [p[0] + ux * 4, p[1] + uz * 4]; const h = W.driveAt(q.x, q.z, 0, 3)?.h ?? 0; const ew = 5;
    W.addDrive(q.x, q.z, inP[0], inP[1], ew, h, 0); n++;
    const L = Math.hypot(inP[0] - q.x, inP[1] - q.z); const g = new THREE.PlaneGeometry(ew * 2, L); g.rotateX(-Math.PI / 2); g.rotateY(Math.atan2(ux, uz)); g.translate((q.x + inP[0]) / 2, 0.025 + Math.max(0, h) / 2, (q.z + inP[1]) / 2);
    const m = new THREE.Mesh(uvw(g), mat); m.receiveShadow = true; root.add(m); }
  W.asdaPark = { pieces: n, entrances: ent.map(e => [Math.round(e.q.x), Math.round(e.q.z), Math.round(e.q.d), Math.round(e.p[0]), Math.round(e.p[1])]) }; info.parkPieces = n;
}
function nearestOnSeg(p, a, b) { const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1; let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2; t = Math.max(0, Math.min(1, t)); const x = a[0] + dx * t, z = a[1] + dz * t; return { x, z, d: Math.hypot(p[0] - x, p[1] - z) }; }
function clean(g) { if (g.index) g = g.toNonIndexed(); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); if (!g.attributes.normal) g.computeVertexNormals(); return g; }
function centroid(p) { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; }
function pip(pt, poly) { let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > pt[1]) !== (zj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - zi) / (zj - zi) + xi) ins = !ins; } return ins; }
function segDist(p, a, b) { const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2)); return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t); }
function distToPoly(p, P) { if (pip(p, P)) return 0; let d = 1e9; for (let i = 0; i < P.length; i++) d = Math.min(d, segDist(p, P[i], P[(i + 1) % P.length])); return d; }
function nearestEdgeDir(p, P) { let best = 1e9, dir = [1, 0]; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; const d = segDist(p, a, b); if (d < best) { best = d; const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; dir = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; } } return dir; }
function outward(P, a, b) { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; let n = [(b[1] - a[1]) / l, -(b[0] - a[0]) / l]; const m = [(a[0] + b[0]) / 2 + n[0] * 0.2, (a[1] + b[1]) / 2 + n[1] * 0.2]; if (pip(m, P)) n = [-n[0], -n[1]]; return n; }
function offsetPoly(P, d) { return P.map((v, i) => { const a = P[(i + P.length - 1) % P.length], b = P[(i + 1) % P.length]; const n1 = outward(P, a, v), n2 = outward(P, v, b); const nx = n1[0] + n2[0], nz = n1[1] + n2[1], l = Math.hypot(nx, nz) || 1; const k = d / Math.max(0.5, (nx * n1[0] + nz * n1[1]) / l); return [v[0] + nx / l * k, v[1] + nz / l * k]; }); }
function roadDist(W, p, re) { let d = 1e9; for (const r of W.d.roads) { if (!re.test(r.n)) continue; for (let i = 0; i + 3 < r.p.length; i += 2) d = Math.min(d, segDist(p, [dm(r.p[i]), dm(r.p[i + 1])], [dm(r.p[i + 2]), dm(r.p[i + 3])])); } return d; }
function nearestEdgeToRoad(W, P, re) { let best = null; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 6) continue; const d = roadDist(W, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], re) - Math.min(L, 30) * 0.3; if (!best || d < best.d) best = { a, b, d }; } return best || { a: P[0], b: P[1] }; }
// triangle with a wanted facing: flips the winding when the geometric normal disagrees
function tri(pos, uv, A, B, C, ua, ub, uc, want) { const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2]; const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) { [B, C] = [C, B]; [ub, uc] = [uc, ub]; } pos.push(...A, ...B, ...C); uv.push(...ua, ...ub, ...uc); }
function geo(pos, uv) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); return g; }
// outward-facing walls; hf(a,b) -> [y0,y1] per edge; texture: tileW metres per repeat across, tileH metres per repeat up
function walls(P, hf, tileW, tileH) { const pos = [], uv = []; let u = 0;
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.05) continue; const [y0, y1] = hf(a, b); const n = outward(P, a, b); const u2 = u + L / tileW; const v0 = y0 / tileH, v1 = y1 / tileH;
    const A = [a[0], y0, a[1]], Bv = [b[0], y0, b[1]], C = [b[0], y1, b[1]], D = [a[0], y1, a[1]]; const w = [n[0], 0, n[1]];
    tri(pos, uv, A, Bv, C, [u, v0], [u2, v0], [u2, v1], w); tri(pos, uv, A, C, D, [u, v0], [u2, v1], [u, v1], w); u = u2; }
  return geo(pos, uv); }
// upward-facing triangulated polygon with per-vertex height yf(v) and uv fn (default planar)
function cap(P, yf, tile, uvf) { let t; try { t = THREE.ShapeUtils.triangulateShape(P.map(p => new THREE.Vector2(p[0], p[1])), []); } catch (e) { return null; } if (!t.length) return null;
  const pos = [], uv = []; const U = uvf || (v => [v[0] / tile, v[1] / tile]);
  for (const [i, j, k] of t) { const a = P[i], b = P[j], c = P[k]; tri(pos, uv, [a[0], yf(a), a[1]], [b[0], yf(b), b[1]], [c[0], yf(c), c[1]], U(a), U(b), U(c), [0, 1, 0]); }
  return geo(pos, uv); }
function frustum(P, Q, y0, y1) { const pos = [], uv = [];
  for (let i = 0; i < P.length; i++) { const j = (i + 1) % P.length; const n = outward(P, P[i], P[j]); const w = [n[0], 0.6, n[1]]; const A = [P[i][0], y0, P[i][1]], Bv = [P[j][0], y0, P[j][1]], C = [Q[j][0], y1, Q[j][1]], D = [Q[i][0], y1, Q[i][1]];
    tri(pos, uv, A, Bv, C, [0, 0], [1, 0], [1, 1], w); tri(pos, uv, A, C, D, [0, 0], [1, 1], [0, 1], w); } return geo(pos, uv); }
// flat panel on the outside of edge a-b of polygon P, `off` metres proud, width w centred, from y0 upwards (h tall)
function sign(a, b, P, off, w, h, y0) { const n = outward(P, a, b); const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L; const m = [(a[0] + b[0]) / 2 + n[0] * off, (a[1] + b[1]) / 2 + n[1] * off]; w = Math.min(w, L);
  // text reads left-to-right when viewed from outside: left end is where (u x n) points up
  let s = 1; if (ux * n[1] - uz * n[0] < 0) s = -1; const p0 = [m[0] - s * ux * w / 2, m[1] - s * uz * w / 2], p1 = [m[0] + s * ux * w / 2, m[1] + s * uz * w / 2];
  const pos = [], uv = []; const want = [n[0], 0, n[1]]; const A = [p0[0], y0, p0[1]], Bv = [p1[0], y0, p1[1]], C = [p1[0], y0 + h, p1[1]], D = [p0[0], y0 + h, p0[1]];
  tri(pos, uv, A, Bv, C, [0, 0], [1, 0], [1, 1], want); tri(pos, uv, A, C, D, [0, 0], [1, 1], [0, 1], want); return geo(pos, uv); }
// a cap turned to face downward (soffits under roofs / canopies)
function flipDown(g) { if (!g) return null; const pa = g.attributes.position.array, uv = g.attributes.uv?.array; for (let i = 0; i < pa.length; i += 9) for (let k = 0; k < 3; k++) { const t = pa[i + 3 + k]; pa[i + 3 + k] = pa[i + 6 + k]; pa[i + 6 + k] = t; }
  if (uv) for (let i = 0; i < uv.length; i += 6) for (let k = 0; k < 2; k++) { const t = uv[i + 2 + k]; uv[i + 2 + k] = uv[i + 4 + k]; uv[i + 4 + k] = t; } g.attributes.position.needsUpdate = true; g.deleteAttribute('normal'); g.computeVertexNormals(); return g; }
function beam(a, b, y0, y1, t) { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const g = new THREE.BoxGeometry(L, y1 - y0, t); g.rotateY(-Math.atan2(b[1] - a[1], b[0] - a[0])); g.translate((a[0] + b[0]) / 2, (y0 + y1) / 2, (a[1] + b[1]) / 2); return g; }
function orientedBox(c, ax, hx, hy, y0, y1) { const g = new THREE.BoxGeometry(hx * 2, y1 - y0, hy * 2); g.rotateY(-Math.atan2(ax[1], ax[0])); g.translate(c[0], (y0 + y1) / 2, c[1]); return g; }
function boxUV(g, su = 1, sv = 1) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); return g; }
function dome(c, y, r, h, seg) { const pts = []; for (let i = 0; i <= 12; i++) { const a = i / 12 * Math.PI / 2; const k = Math.sin(a); pts.push(new THREE.Vector2(Math.max(0.001, r * Math.cos(a) * (1 - 0.12 * k * k)), h * k)); } const g = new THREE.LatheGeometry(pts, seg); g.translate(c[0], y, c[1]); return g; }
function onion(c, y, r, h, seg) { const pts = []; for (let i = 0; i <= 14; i++) { const t = i / 14; const rr = r * (0.75 + 0.45 * Math.sin(Math.min(1, t * 1.6) * Math.PI)) * (1 - t) ** 0.8 + 0.02; pts.push(new THREE.Vector2(rr, h * t)); } const g = new THREE.LatheGeometry(pts, seg); g.translate(c[0], y, c[1]); return g; }
function finial(c, y, h) { const s = new THREE.CylinderGeometry(0.08, 0.14, h, 6); s.translate(c[0], y + h / 2, c[1]); const b = new THREE.SphereGeometry(0.32, 8, 6); b.translate(c[0], y + h * 0.55, c[1]); const cr = new THREE.TorusGeometry(0.42, 0.08, 6, 14, Math.PI * 1.3); cr.rotateZ(-Math.PI * 0.15 + Math.PI / 2); cr.translate(c[0], y + h + 0.2, c[1]); return mergeGeometries([s, b, cr].map(clean)); }
function gable(c, ax, hx, hy, y0, rise) { const s = new THREE.Shape(); s.moveTo(-hy, 0); s.lineTo(hy, 0); s.lineTo(0, rise); s.lineTo(-hy, 0); const g = new THREE.ExtrudeGeometry(s, { depth: hx * 2, bevelEnabled: false }); g.translate(0, 0, -hx); g.rotateY(Math.PI / 2); g.rotateY(-Math.atan2(ax[1], ax[0])); g.translate(c[0], y0, c[1]); return g; }
function minRect(pts) { let best = null;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 0.5) continue; const ax = [(b[0] - a[0]) / l, (b[1] - a[1]) / l], ay = [-ax[1], ax[0]];
    let mnu = 1e9, mxu = -1e9, mnv = 1e9, mxv = -1e9; for (const p of pts) { const u = p[0] * ax[0] + p[1] * ax[1], v = p[0] * ay[0] + p[1] * ay[1]; mnu = Math.min(mnu, u); mxu = Math.max(mxu, u); mnv = Math.min(mnv, v); mxv = Math.max(mxv, v); }
    const area = (mxu - mnu) * (mxv - mnv); if (!best || area < best.area) { const cu = (mnu + mxu) / 2, cv = (mnv + mxv) / 2; best = { area, ax, ay, hx: (mxu - mnu) / 2, hy: (mxv - mnv) / 2, c: [ax[0] * cu + ay[0] * cv, ax[1] * cu + ay[1] * cv] }; } }
  if (best.hy > best.hx) { const t = best.hx; best.hx = best.hy; best.hy = t; best.ax = best.ay; best.ay = [-best.ax[1], best.ax[0]]; }
  return best; }

// minaret balcony (sherefe): corbelled frustum under a round slab with a pierced railing and top rail
function balcony(B, put, c, y, r0, r1, mat, S = 1) { const seg = Math.round(20 * S);
  const cb = new THREE.CylinderGeometry(r1 * 0.97, r0, 1.3, seg); cb.translate(c[0], y - 0.65, c[1]); put(B, mat, cb);
  const sl = new THREE.CylinderGeometry(r1, r1, 0.25, seg); sl.translate(c[0], y + 0.12, c[1]); put(B, mat, sl);
  for (let i = 0; i < seg; i++) { const a = i / seg * Math.PI * 2; const p = new THREE.BoxGeometry(0.12, 0.95, 0.12); p.translate(c[0] + Math.cos(a) * (r1 - 0.1), y + 0.72, c[1] + Math.sin(a) * (r1 - 0.1)); put(B, mat, p); }
  const tr = new THREE.TorusGeometry(r1 - 0.1, 0.07, 5, seg); tr.rotateX(Math.PI / 2); tr.translate(c[0], y + 1.2, c[1]); put(B, mat, tr); }
// pointed (two-centred) arch portal frame proud of edge a-b of polygon P at fraction t: w wide, h tall, d deep
function portal(a, b, P, t, w, h, d) { const n = outward(P, a, b); const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; let ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L; if (-uz * n[0] + ux * n[1] < 0) { ux = -ux; uz = -uz; } // right-handed basis (no mirrored winding)
  const s = new THREE.Shape(); const hw = w / 2, ri = hw - 0.8, sp = h - hw * 0.9; s.moveTo(-hw, 0); s.lineTo(hw, 0); s.lineTo(hw, sp); s.quadraticCurveTo(hw, h * 0.98, 0, h + 0.4); s.quadraticCurveTo(-hw, h * 0.98, -hw, sp); s.lineTo(-hw, 0);
  const hole = new THREE.Path(); const hs = sp - 0.3; hole.moveTo(-ri, 0); hole.lineTo(-ri, hs); hole.quadraticCurveTo(-ri, h * 0.9, 0, h - 0.6); hole.quadraticCurveTo(ri, h * 0.9, ri, hs); hole.lineTo(ri, 0); hole.lineTo(-ri, 0); s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 10 }); g.translate(0, 0, -0.2);
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(ux, 0, uz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(n[0], 0, n[1])); g.applyMatrix4(m);
  const px = a[0] + (b[0] - a[0]) * t, pz = a[1] + (b[1] - a[1]) * t; g.translate(px, 0, pz); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3, uv.getY(i) / 3); return g; }
// landmark PBR material from client/img/lm (see tools/make_landmark_textures.py); shared with world.js landmarks
const _lmCache = new Map();
export function lmPBR(W, name, rx = 1, ry = 1, o = {}) { const env = W.q.env ?? 0; const res = env >= 3 ? '4k' : env >= 2 ? '2k' : env >= 1 ? '1k' : '512';
  const ld = (n, srgb) => { const k = n + rx + ',' + ry; if (_lmCache.has(k)) return _lmCache.get(k); const t = new THREE.TextureLoader().load(new URL(`../img/lm/${n}.jpg`, import.meta.url).href); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = W.q.aniso || 2; _lmCache.set(k, t); return t; };
  return new THREE.MeshStandardMaterial({ map: ld(`${name}_${res}`, true), normalMap: env >= 1 ? ld(`${name}_n_${env >= 2 ? '2k' : '1k'}`, false) : null, normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: env >= 1 ? ld(`${name}_r_1k`, false) : null, roughness: 1, metalness: 0, ...o }); }
