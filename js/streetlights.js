// p55 UK street lighting: reads the road graph edges (World.edges) and places lamp columns on the pavement — 6 m
// columns every ~30 m on residential / minor streets (staggered sides), 10 m columns every ~36 m on A-roads (both
// sides on dual / wide roads) — plus re-skins the world's existing lamp posts with the same model. Galvanised grey
// tapered column with a base door, an up-swept outreach bracket and a slim flat LED lantern whose lens glows warm at
// night. Night: lenses bloom, an additive light pool sits on the pavement under every head, and the spots are added to
// World.lampSpots so Gfx.updateNightLights gives the few nearest a real point light. Everything is instanced (a few
// draw calls total) and capped per quality / phone. Owns no road geometry: only reads edges.
import * as THREE from 'three';
import { mergeGeometries } from './lib/addons/utils/BufferGeometryUtils.js';
const MOB = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || /[?&]mob=1/.test(location.search);
const walkK = k => /footway|path|cycleway|pedestrian|steps|bridleway|track/.test(k), majorK = k => /motorway|trunk|primary|secondary/.test(k);
function at(P, a) { let i = 1; while (i < P.length - 1 && P[i][3] < a) i++; const A = P[i - 1], B = P[i], L = (B[3] - A[3]) || 1, t = Math.max(0, Math.min(1, (a - A[3]) / L)); const dx = B[0] - A[0], dz = B[1] - A[1], l = Math.hypot(dx, dz) || 1; return [A[0] + dx * t, A[1] + dz * t, A[2] + (B[2] - A[2]) * t, -dz / l, dx / l]; }
// column model, local frame: base at origin, bracket reaches toward -Z (over the road), height H
function column(H) { const parts = [];
  const shaft = new THREE.CylinderGeometry(0.06, 0.1, H, 10); shaft.translate(0, H / 2, 0); parts.push(shaft);
  const base = new THREE.CylinderGeometry(0.13, 0.15, 1.1, 10); base.translate(0, 0.55, 0); parts.push(base); // door section
  const door = new THREE.BoxGeometry(0.1, 0.32, 0.04); door.translate(0, 0.6, 0.14); parts.push(door);
  const cap = new THREE.SphereGeometry(0.075, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2); cap.translate(0, H, 0); parts.push(cap);
  const reach = H > 8 ? 1.5 : 1.0, curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, H - 0.35, 0), new THREE.Vector3(0, H + 0.05, -reach * 0.35), new THREE.Vector3(0, H + 0.15, -reach)); // up-swept outreach
  parts.push(new THREE.TubeGeometry(curve, 8, 0.04, 6, false));
  return { g: mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p).map(p => { for (const k of Object.keys(p.attributes)) if (!['position', 'normal', 'uv'].includes(k)) p.deleteAttribute(k); return p; })), reach }; }
function lantern(H, reach) { const body = new THREE.BoxGeometry(0.3, 0.09, 0.62, 1, 1, 1); const p = body.attributes.position; for (let i = 0; i < p.count; i++) { const z = p.getZ(i), y = p.getY(i); if (y > 0) p.setX(i, p.getX(i) * 0.8); if (z < 0) p.setX(i, p.getX(i) * 0.75); }
  body.computeVertexNormals(); body.translate(0, H + 0.12, -reach - 0.22); const lens = new THREE.PlaneGeometry(0.24, 0.52); lens.rotateX(Math.PI / 2); lens.translate(0, H + 0.07, -reach - 0.22); return { body, lens }; }
export class StreetLights {
  constructor(world, quality = 2) { this.w = world; const env = world.q?.env ?? quality; this.max = MOB ? 2400 : [1800, 4500, 7000, 9000][env] || 4500; this.built = false; }
  places() { const W = this.w, out = [], seen = new Set(), st = this.stats = { edges: 0, cand: 0, onRoad: 0, dup: 0, kinds: {} };
    const ok = (x, z, y) => { st.cand++; if (W.onAnyDrive?.(x, z, y ?? 0, 0.3)) { st.onRoad++; return false; } const k = Math.round(x / 6) + ',' + Math.round(z / 6); if (seen.has(k)) { st.dup++; return false; } seen.add(k); return true; };
    for (const { r, P, hw, hid } of W.edges || []) { if (hid || r.tun || walkK(r.k) || r.k === 'service' || P.some(p => p[2] < -0.5)) continue; const L = P[P.length - 1][3]; if (L < 14) continue;
      st.edges++; st.kinds[r.k] = (st.kinds[r.k] || 0) + 1; const maj = majorK(r.k); // A-roads: World's lamps every 32 m (re-skinned below) + extra columns between them
      const step = maj ? 32 : 24, two = hw > 5.5; for (let a = maj ? 26 : 9; a < L - 7; a += step) { const s = at(P, a); for (const side of two ? [-1, 1] : [((a / step) | 0) % 2 ? 1 : -1]) { const off = hw + 1.4, x = s[0] + s[3] * side * off, z = s[1] + s[4] * side * off;
          if (ok(x, z, s[2])) out.push([x, z, Math.atan2(s[3] * side, s[4] * side), maj ? 9 : 6, s[2]]); } } }
    for (const l of W.lampPositions || []) if (ok(l[0], l[1]) || true) out.push([l[0], l[1], l[2], 9, 0, 1]);
    // arms always reach out over the carriageway: aim each column at its nearest road centreline (the arm runs along local -z)
    for (const l of out) { const r = W.nearestRoad?.(l[0], l[1], false, l[4] || null); if (r && r.d > 0.3) l[2] = Math.atan2(l[0] - r.px, l[1] - r.pz); }
    return out.slice(0, this.max); }
  build(scene) { if (this.built) return; this.built = true; const W = this.w; const L = this.list = this.places();
    // hide World's box-shaped posts / heads (re-skinned here at the same spots; their colliders stay)
    W.group.traverse(o => { if (o.isInstancedMesh && (o.material === W.lampHeadMat || (o.material?.metalness === 0.7 && o.material?.color?.getHex?.() === 0x5b6066))) o.visible = false; });
    const metal = new THREE.MeshStandardMaterial({ color: 0x8e9396, metalness: 0.55, roughness: 0.55 }), dark = new THREE.MeshStandardMaterial({ color: 0x3a3d40, metalness: 0.4, roughness: 0.5 });
    this.lensMat = new THREE.MeshStandardMaterial({ color: 0xf4efe4, emissive: 0xffd7a0, emissiveIntensity: 0, roughness: 0.3 });
    const glowT = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
    this.poolMat = new THREE.MeshBasicMaterial({ map: glowT, color: new THREE.Color(0xffc27a).multiplyScalar(0.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -16, toneMapped: false });
    this.haloMat = new THREE.SpriteMaterial({ map: glowT, color: 0xffd9a8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const G = this.g = new THREE.Group(); G.name = 'streetlights'; const d = new THREE.Object3D(), spots = [];
    for (const H of [6, 9]) { const sub = L.filter(l => l[3] === H); if (!sub.length) continue; const { g: col, reach } = column(H), { body, lens } = lantern(H, reach);
      const pool = new THREE.PlaneGeometry(H > 8 ? 16 : 11, H > 8 ? 16 : 11); pool.rotateX(-Math.PI / 2); pool.translate(0, 0.06, -reach - 0.22);
      const mk = (geo, mat) => { const m = new THREE.InstancedMesh(geo, mat, sub.length); sub.forEach((l, i) => { d.position.set(l[0], l[4] || 0, l[1]); d.rotation.set(0, l[2], 0); d.updateMatrix(); m.setMatrixAt(i, d.matrix); }); m.computeBoundingSphere(); G.add(m); return m; };
      const c = mk(col, metal); c.castShadow = !MOB; mk(body, dark); mk(lens, this.lensMat); const pm = mk(pool, this.poolMat); pm.renderOrder = 3; pm.visible = false; (this.pools ||= []).push(pm);
      for (const l of sub) { const r = reach + 0.22; spots.push([l[0] - Math.sin(l[2]) * r, l[1] - Math.cos(l[2]) * r, (l[4] || 0) + H]); if (!l[5]) W.addCircleCollider?.([l[0], l[1]], 0.12, 6); } }
    this.spots = spots; scene.add(G); this.fill = new THREE.HemisphereLight(0x8aa0d8, 0x3a2a1a, 0); G.add(this.fill); // night fill so streets read (one constant light, no shader churn)
    // nearest lamps also feed Gfx's few real point lights (World.lampSpots is read every 0.3 s)
    if (Array.isArray(W.lampSpots)) { const have = new Set(W.lampSpots.map(s => Math.round(s[0]) + ',' + Math.round(s[1]))); for (const s of spots) if (!have.has(Math.round(s[0]) + ',' + Math.round(s[1]))) W.lampSpots.push([s[0], s[1]]); }
    this.halos = []; for (let i = 0; i < (MOB ? 6 : 14); i++) { const h = new THREE.Sprite(this.haloMat); h.scale.setScalar(1.6); h.visible = false; G.add(h); this.halos.push(h); }
    this.T = 0; }
  // night: 0..1 (env.out.lights or the session's night flag); cam: for the halo sprites on the nearest heads
  update(night, cam, dt = 0.016) { if (!this.built) return; const n = typeof night === 'number' ? night : night ? 1 : 0; this.lensMat.emissiveIntensity = n * 9; this.fill.intensity = n * 0.55; for (const p of this.pools) p.visible = n > 0.05; this.poolMat.opacity = n; this.haloMat.opacity = n * 0.8;
    this.T -= dt; if (this.T > 0 || !cam) return; this.T = 0.25; const x = cam.position.x, z = cam.position.z, best = [];
    if (n > 0.05) for (const s of this.spots) { const d = (s[0] - x) ** 2 + (s[1] - z) ** 2; if (d < 6400) best.push([d, s]); } best.sort((a, b) => a[0] - b[0]);
    this.halos.forEach((h, i) => { const b = best[i]; h.visible = !!b; if (b) h.position.set(b[1][0], b[1][2] - 0.02, b[1][1]); }); }
  dispose() { this.g?.removeFromParent(); }
}
