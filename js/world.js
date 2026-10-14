// Birmingham city builder: turns OpenStreetMap-derived data (data/brum.json, ODbL) into 3D roads, tunnels,
// buildings, landmarks, street furniture and collision/height queries.
import * as THREE from 'three';
import { mergeGeometries } from './lib/addons/utils/BufferGeometryUtils.js';
import { buildEastLandmarks, lmPBR } from './landmarks_east.js';
import { buildRoadEdges } from './roadedge.js';
import { cityTex, facadeMaterials, FACADES, tagWalls, hipRoof, slateMaterial, shopfrontMaterial, awningMaterial, awningGeo, buildClutter, roofMaterial, parapetMaterial, roofPlant, treeParts, skylineMaterial, skylineBox, planarUV, roadDetail, markWear, paveDetail, kerbDetail } from './citylook.js';

const dm = v => v / 10;
export class World {
  static PAVEMENT = 0.75; // drivable to just past the kerb (round 6: the edge rail stands 0.6 m out, so the rail is what a car touches)
  static TRACK_W = 14; static ARMCO = 14 / 2 + 6.6; // first-game track: 14 m road, armco 6.6 m beyond the edge
  constructor(data, routes, quality, onProgress) {
    this.d = data; this.routes = routes; this.q = quality; this.prog = onProgress || (() => {});
    this.group = new THREE.Group(); this.group.name = 'brum';
    this.nodeH = routes.nodeH;
    // sunken roads that dead-end underground (tunnels cut off at the map edge) would trap the car: drop them, back to
    // the point where they are at street level again, so every tunnel / underpass leads somewhere
    // no tunnels (round 4): service tunnels (car-park ramps, the station drop-off under Grand Central) are dropped;
    // every other tunnel / underpass is a surface street (routes.json 'surf' below, 'drop' here; tools/build_routes.py)
    { const drop = new Set(routes.drop || []); this.droppedTunnels = drop.size; if (drop.size) data.graph.e = data.graph.e.filter(e => !drop.has(e[3])); for (const i of drop) if (data.roads[i]) { data.roads[i].tun = 0; data.roads[i].drop = 1; } }
    { let E = data.graph.e, changed = true; this.prunedDeadEnds = 0;
      while (changed) { changed = false; const deg = new Map(); for (const e of E) { deg.set(e[0], (deg.get(e[0]) || 0) + 1); deg.set(e[1], (deg.get(e[1]) || 0) + 1); }
        const keep = E.filter(e => { const r = data.roads[e[3]]; const dead = [e[0], e[1]].some(n => deg.get(n) === 1 && (this.nodeH[n] ?? 0) < -0.5);
          const sunk = r.tun || Math.min(this.nodeH[e[0]] ?? 0, this.nodeH[e[1]] ?? 0) < -0.5; return !(dead && sunk); });
        if (keep.length < E.length) { this.prunedDeadEnds += E.length - keep.length; E = keep; changed = true; } }
      data.graph.e = E; }
    // the A38 Queensway / inner ring (and any tunnel a race runs through) is a plain street-level dual carriageway:
    // routes.json['surf'] lists the former tunnel / underpass ways (see tools/build_routes.py)
    { const surf = new Set(routes.surf || []); this.surfCount = surf.size; for (const i of surf) if (data.roads[i]) { data.roads[i].tun = 0; data.roads[i].surf = 1; } }
    this.initTracks(data);
    this.bounds = { minx: data.bounds[0] / 10, minz: data.bounds[1] / 10, maxx: data.bounds[2] / 10, maxz: data.bounds[3] / 10 };
    this.segGrid = new Map(); this.bGrid = new Map(); this.tunnelSegs = [];
    this.signalMats = null; this.tunnelZones = [];
  }
  // --------------------------------------------------------------------------------------------
  async build() {
    const steps = [['textures', () => this.makeTextures()], ['ground', () => this.buildGround()], ['roads', () => { this.buildRoads(); this.addRouteCorridors(); }],
      ['markings', () => this.buildMarkings()], ['tunnels', () => this.buildTunnels()], ['road edges', () => buildRoadEdges(this, { slicePath, pointAt })], ['buildings', () => this.buildBuildings()],
      ['landmarks', () => this.buildLandmarks()], ['furniture', () => this.buildFurniture()], ['skyline', () => this.buildSkyline()]];
    for (let i = 0; i < steps.length; i++) {
      this.prog(steps[i][0], i / steps.length);
      await new Promise(r => setTimeout(r, 0));
      steps[i][1]();
    }
    this.prog('optimising', 0.97); await new Promise(r => setTimeout(r, 0));
    chunkWorld(this.group, 450);
    this.prog('done', 1);
    return this.group;
  }
  // ---------------- procedural textures (all generated in code) ---------------------------------
  tex(w, h, draw, rep = true, srgb = true) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = this.q.aniso || 4; return t;
  }
  makeTextures() {
    const rnd = mulberry(7);
    const noise = (g, w, h, base, amp, n = 9000, size = 2) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < n; i++) { const v = (rnd() - 0.5) * amp; g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v)})`; g.fillRect(rnd() * w, rnd() * h, size * rnd() + 0.5, size * rnd() + 0.5); } };
    this.T = {};
    this.T.asphalt = this.tex(512, 512, (g, w, h) => {
      noise(g, w, h, '#3a3b3d', 0.22, 26000, 2);
      for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(20,20,22,${0.15 + rnd() * 0.2})`; const x = rnd() * w, y = rnd() * h; g.fillRect(x, y, 40 + rnd() * 120, 30 + rnd() * 90); } // tarmac repairs
      g.strokeStyle = 'rgba(15,15,15,.35)'; g.lineWidth = 1.2; for (let i = 0; i < 10; i++) { g.beginPath(); let x = rnd() * w, y = rnd() * h; g.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (rnd() - 0.5) * 40; y += rnd() * 30; g.lineTo(x, y); } g.stroke(); }
    });
    this.T.asphaltRough = this.tex(256, 256, (g, w, h) => { noise(g, w, h, '#d8d8d8', 0.35, 9000, 2); for (let i = 0; i < 18; i++) { g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 10 + rnd() * 30, 5 + rnd() * 16, rnd() * 3, 0, 7); g.fill(); } }, true, false); // puddle patches for wet look
    this.T.paving = this.tex(512, 512, (g, w, h) => {
      g.fillStyle = '#8d8a84'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) { const v = 125 + rnd() * 30; g.fillStyle = `rgb(${v},${v - 2},${v - 6})`; g.fillRect(x + 1, y + 1, 30, 30); }
      noise(g, w, h, 'rgba(0,0,0,0)', 0.12, 5000, 1.5);
    });
    this.T.grass = this.tex(256, 256, (g, w, h) => { noise(g, w, h, '#4a6b32', 0.3, 12000, 2); });
    this.T.paving = cityTex(this.q, 'paving'); this.T.pavingN = this.q.env >= 1 ? cityTex(this.q, 'paving', { normal: true }) : null; // 600 mm slabs, tile = 2.4 x 1.8 m
    // first-game photographic surfaces: asphalt (albedo / normal / roughness) and grass replace the procedural ones
    { const L = new THREE.TextureLoader(); const ld = (f, srgb) => { const t = L.load('./real/tex/' + f); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = this.q.aniso || 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
      this.T.asphalt = ld('road_d.jpg', true); this.T.asphaltRough = ld('road_r.jpg'); this.T.asphaltN = ld('road_n.jpg'); this.T.grass = ld('grass_d.jpg', true); }
    this.T.water = this.tex(256, 256, (g, w, h) => { noise(g, w, h, '#2a3a3c', 0.15, 3000, 3); });
    this.T.carpark = this.tex(512, 512, (g, w, h) => { noise(g, w, h, '#3d3e40', 0.2, 18000, 2); g.strokeStyle = '#e8e8e2'; g.lineWidth = 4; for (let x = 0; x <= w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 180); g.moveTo(x, h - 180); g.lineTo(x, h); g.stroke(); } });
    this.T.concrete = this.tex(256, 256, (g, w, h) => { noise(g, w, h, '#9a968f', 0.2, 8000, 2); g.strokeStyle = 'rgba(0,0,0,.2)'; for (let y = 0; y < h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); } });
    this.T.tunnelTile = this.tex(256, 256, (g, w, h) => { g.fillStyle = '#c9c6bb'; g.fillRect(0, 0, w, h); g.strokeStyle = '#8f8c83'; g.lineWidth = 2; for (let y = 0; y <= h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); } for (let x = 0; x <= w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } g.fillStyle = 'rgba(40,40,40,.35)'; g.fillRect(0, h - 40, w, 40); });
    // facades: 3 storeys per tile (10.5 m high, 12 m wide)
    const FR = this.q.env >= 2 ? 1024 : 512;
    const fac = (base, win, frame, style) => this.tex(FR, FR * 0.875, (g, w0, h0) => {
      g.scale(w0 / 1024, h0 / 896); const w = 1024, h = 896;
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      if (style === 'brick' || style === 'victorian' && base[1] < 'b') { // stretcher bond with mortar and colour variation
        g.fillStyle = 'rgba(220,210,195,0.35)'; g.fillRect(0, 0, w, h); g.fillStyle = base;
        for (let y = 0; y < h; y += 10) for (let x = ((y / 10) % 2) * 11 - 11; x < w; x += 22) { const v = rnd() * 36 - 18; g.fillStyle = base; g.fillRect(x, y, 20.5, 8.5); g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 200 : 0},${v > 0 ? 170 : 0},${Math.abs(v) / 260})`; g.fillRect(x, y, 20.5, 8.5); }
      } else noise(g, w, h, 'rgba(0,0,0,0)', 0.08, 9000, 2);
      const floors = 3, cols = style === 'glass' ? 8 : style === 'modern' ? 6 : 4, cw = w / cols, fh = h / floors;
      if (style === 'glass') { // curtain wall: sky reflection gradient, spandrels, mullions
        for (let f = 0; f < floors; f++) {
          const gr = g.createLinearGradient(0, f * fh, 0, (f + 1) * fh); gr.addColorStop(0, '#8fb0c8'); gr.addColorStop(0.45, win); gr.addColorStop(1, '#101a22'); g.fillStyle = gr; g.fillRect(0, f * fh + 10, w, fh * 0.78);
          g.fillStyle = 'rgba(20,30,38,0.9)'; g.fillRect(0, f * fh + fh * 0.8 + 10, w, fh * 0.2 - 10);
          for (let c = 0; c < cols; c++) { if (rnd() < 0.3) { g.fillStyle = `rgba(255,236,190,${0.08 + rnd() * 0.15})`; g.fillRect(c * cw + 6, f * fh + 14, cw - 12, fh * 0.7); } }
        }
        g.fillStyle = frame; for (let c = 0; c <= cols; c++) g.fillRect(c * cw - 3, 0, 6, h); for (let f = 0; f <= floors; f++) g.fillRect(0, f * fh + 8, w, 5);
        return;
      }
      for (let f = 0; f < floors; f++) {
        if (style !== 'modern') { g.fillStyle = 'rgba(235,225,205,0.55)'; g.fillRect(0, f * fh + fh - 14, w, 9); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, f * fh + fh - 5, w, 4); } // string course
        for (let c = 0; c < cols; c++) {
          const ww = cw * (style === 'modern' ? 0.72 : 0.46), wh = fh * (style === 'modern' ? 0.6 : 0.58), x = c * cw + (cw - ww) / 2, y = f * fh + fh * 0.16;
          if (style === 'victorian') { g.fillStyle = frame; g.beginPath(); g.moveTo(x - 10, y); g.quadraticCurveTo(x + ww / 2, y - 26, x + ww + 10, y); g.lineTo(x + ww + 10, y + 8); g.lineTo(x - 10, y + 8); g.fill(); } // arched head
          g.fillStyle = frame; g.fillRect(x - 6, y - 6, ww + 12, wh + 12);
          const lit = rnd() < 0.22; const gr = g.createLinearGradient(0, y, 0, y + wh);
          if (lit) { gr.addColorStop(0, '#f2dfae'); gr.addColorStop(1, '#b89660'); } else { gr.addColorStop(0, '#7f96a8'); gr.addColorStop(0.35, win); gr.addColorStop(1, '#0a0e12'); }
          g.fillStyle = gr; g.fillRect(x, y, ww, wh);
          if (rnd() < 0.35) { g.fillStyle = `rgba(${200 + rnd() * 50},${190 + rnd() * 50},${170 + rnd() * 50},0.55)`; g.fillRect(x, y, ww, wh * (0.2 + rnd() * 0.5)); } // blinds
          g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x, y, ww, 5); g.fillRect(x, y, 4, wh); // reveal shadow
          g.fillStyle = frame; g.fillRect(x + ww / 2 - 2, y, 4, wh); if (style !== 'modern') g.fillRect(x, y + wh * 0.42, ww, 4);
          g.fillStyle = 'rgba(240,232,215,0.85)'; g.fillRect(x - 10, y + wh + 6, ww + 20, 9); // sill
          const st = g.createLinearGradient(0, y + wh + 15, 0, y + wh + 70); st.addColorStop(0, 'rgba(0,0,0,0.16)'); st.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = st; g.fillRect(x - 6, y + wh + 15, ww + 12, 55); // weathering streak
        }
      }
      const ao = g.createLinearGradient(0, h - 60, 0, h); ao.addColorStop(0, 'rgba(0,0,0,0)'); ao.addColorStop(1, 'rgba(0,0,0,0.12)'); g.fillStyle = ao; g.fillRect(0, h - 60, w, 60);
    });
    // landmark buildings (and landmarks_east.js) still use these two drawn facades; ordinary buildings use citylook.js
    this.F = [null, { t: fac('#6e3a2c', '#18202a', '#d9d2c4', 'brick'), k: 'brick2' }, { t: fac('#c9bfa8', '#1c242e', '#b3a78e', 'victorian'), k: 'stone' }];
  }
  // ---------------- ground ----------------------------------------------------------------------
  buildGround() {
    const [x0, z0, x1, z1] = this.d.bounds.map(dm);
    const pad = 600, W = x1 - x0 + pad * 2, H = z1 - z0 + pad * 2;
    const g = new THREE.PlaneGeometry(W, H); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, -0.02, (z0 + z1) / 2);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * W / 8, uv.getY(i) * H / 8);
    { const t = this.T.paving.clone(); t.repeat.set(8 / 2.4, 8 / 1.8); t.needsUpdate = true; this.groundMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, color: 0xc4c0b8 }); }
    // cut-outs where roads drop into cuttings / tunnel portals (mask texture filled in buildTunnels)
    this.maskU = { value: null }; this.maskB = { value: new THREE.Vector4(x0 - pad, z0 - pad, W, H) };
    this.groundMat.onBeforeCompile = (sh) => {
      sh.uniforms.cutMask = this.maskU; sh.uniforms.cutB = this.maskB;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWXZ;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWXZ = (modelMatrix * vec4(transformed,1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vWXZ; uniform sampler2D cutMask; uniform vec4 cutB;').replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (texture2D(cutMask, (vWXZ - cutB.xy) / cutB.zw).r > 0.5) discard;');
    };
    const m = new THREE.Mesh(g, this.groundMat); m.receiveShadow = true; this.group.add(m);
    // areas: parks / car parks / water
    const mats = { green: new THREE.MeshStandardMaterial({ map: this.T.grass, color: 0x8fb070, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      park: new THREE.MeshStandardMaterial({ map: this.T.carpark, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      water: new THREE.MeshStandardMaterial({ map: this.T.water, roughness: 0.05, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
      rail: new THREE.MeshStandardMaterial({ color: 0x5b5146, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }) };
    const geos = { green: [], park: [], water: [], rail: [] };
    for (const a of this.d.areas) {
      const pts = []; for (let i = 0; i < a.p.length; i += 2) pts.push(new THREE.Vector2(dm(a.p[i]), dm(a.p[i + 1])));
      const geo = flatPoly(pts, a.k === 'water' ? -0.3 : 0.0, a.k === 'park' ? 16 : 8); if (geo) geos[a.k].push(geo);
    }
    for (const k in geos) if (geos[k].length) { const mm = new THREE.Mesh(mergeGeometries(geos[k]), mats[k]); mm.receiveShadow = true; this.group.add(mm); }
    this.waterMat = mats.water;
  }
  // ---------------- roads -------------------------------------------------------------------------
  edgePoints(e) {
    const [a, b, L, ri, pts] = e; const r = this.d.roads[ri];
    const P = []; for (let i = 0; i < pts.length; i += 2) P.push([dm(pts[i]), dm(pts[i + 1])]);
    const ha = this.nodeH[a] ?? 0, hb = this.nodeH[b] ?? 0; // nodes without a computed height (e.g. a newer map than routes.json) are at street level
    const cum = [0]; for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const tot = cum[cum.length - 1] || 1;
    return P.map((p, i) => { let h = ha + (hb - ha) * cum[i] / tot; if (r.tun) h = Math.min(h, -7.5 + (ha + 7.5) * Math.max(0, 1 - cum[i] / 60) + (hb + 7.5) * Math.max(0, 1 - (tot - cum[i]) / 60)); return [p[0], p[1], h, cum[i]]; });
  }
  underTrack(P) {
    if (!this._tg) { this._tg = new Map(); for (const r of this.routes.routes) for (const q of r.path) { const k = Math.floor(q[0] / 20) * 100000 + Math.floor(q[1] / 20); let a = this._tg.get(k); if (!a) this._tg.set(k, a = []); a.push(q); } }
    const R = (World.TRACK_W || 14) / 2 + 3; let inn = 0;
    for (const p of P) { let hit = false; const gx = Math.floor(p[0] / 20), gz = Math.floor(p[1] / 20);
      for (let ox = -1; ox <= 1 && !hit; ox++) for (let oz = -1; oz <= 1 && !hit; oz++) for (const q of (this._tg.get((gx + ox) * 100000 + gz + oz) || [])) if ((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < R * R) { hit = true; break; }
      if (hit) inn++; }
    return P.length > 1 && inn / P.length >= 0.6;
  }
  buildRoads() {
    const byClass = { major: [], minor: [], service: [] };
    const cls = k => /motorway|trunk|primary/.test(k) ? 'major' : k === 'service' ? 'service' : 'minor';
    this.edges = [];
    const deg = new Map(); for (const e of this.d.graph.e) { deg.set(e[0], (deg.get(e[0]) || 0) + 1); deg.set(e[1], (deg.get(e[1]) || 0) + 1); }
    this.deg = deg;
    // round 6: service / link ribbons (and duplicated ways) running inside another road's carriageway are dropped
    // (they doubled the rails and z-fought); the wider road is the drivable surface there
    const pre = this.d.graph.e.map(e => { const r = this.d.roads[e[3]]; return { e, r, P: this.edgePoints(e), hw: r.w / 2 }; });
    const drop = this.containedEdges(pre); this.roadFill = { dropped: drop.size };
    for (const [ei, { e, r, P, hw }] of pre.entries()) {
      if (drop.has(ei)) continue;
      const hid = this.underTrack(P); // street running along a race track: the track is the one visible road there
      this.edges.push({ e, r, P, hw, hid });
      const lift = r.k === 'service' ? 0.0 : cls(r.k) === 'major' ? 0.03 : 0.015;
      if (!hid) byClass[cls(r.k)].push(ribbon(P, hw, lift, 8));
      // collision / height segments
      for (let i = 0; i < P.length - 1; i++) {
        const s = { x1: P[i][0], z1: P[i][1], h1: P[i][2] + lift, x2: P[i + 1][0], z2: P[i + 1][1], h2: P[i + 1][2] + lift, hw: hw + 0.4, tun: r.tun, ow: r.ow, k: r.k, surf: r.surf, hid, nm: r.n, ei: this.edges.length - 1 };
        this.addSeg(s);
        if (P[i][2] < -0.6 || P[i + 1][2] < -0.6) this.tunnelSegs.push(s);
      }
    }
    const mk = (off) => roadDetail(new THREE.MeshStandardMaterial({ map: this.T.asphalt, roughnessMap: this.T.asphaltRough, normalMap: this.q.env >= 1 ? this.T.asphaltN : null, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 1, metalness: 0.0, color: 0xa9a9a9, polygonOffset: true, polygonOffsetFactor: off, polygonOffsetUnits: off * 2 }), this.q); // High+: patches, cracks, skid marks, manholes (citylook.js)
    this.roadMats = [];
    for (const [k, off] of [['service', -2], ['minor', -3], ['major', -4]]) {
      if (!byClass[k].length) continue; const mat = mk(off); this.roadMats.push(mat);
      const m = new THREE.Mesh(mergeGeometries(byClass[k]), mat); m.receiveShadow = true; this.group.add(m);
    }
    // kerbs (skip near junctions); every GFX level (a clear road edge on Low too)
    {
      const kerbs = [];
      for (const { e, r, P, hw, hid } of this.edges) { if (hid) continue;
        if (r.tun || r.k === 'service' || P[0][2] < -0.5) continue;
        const L = P[P.length - 1][3]; const s0 = (deg.get(e[0]) > 2 ? 12 : 0), s1 = L - (deg.get(e[1]) > 2 ? 12 : 0);
        if (s1 - s0 < 6) continue;
        const sub = slicePath(P, s0, s1);
        for (const side of [-1, 1]) for (const [a, b] of this.freeRuns(P, s0, s1, side * (hw + 0.15))) kerbs.push(strip(slicePath(P, a, b), side * (hw + 0.15), 0.3, 0.12));
      }
      if (kerbs.length) { const m = new THREE.Mesh(mergeGeometries(kerbs.map(g => planarUV(g, 1.2))), kerbDetail(new THREE.MeshStandardMaterial({ map: cityTex(this.q, 'concrete'), color: 0xd4d0c8, roughness: 0.8 }), this.q)); m.receiveShadow = true; this.group.add(m); }
    }
    // pavements: raised paving slabs behind the kerb on every surface street (not motorways / service roads)
    const pave = [];
    for (const { e, r, P, hw, hid } of this.edges) { if (hid) continue;
      if (r.tun || /service|motorway/.test(r.k) || P[0][2] < -0.5 || P[P.length - 1][2] < -0.5 || Math.abs(P[0][2]) > 0.5 && Math.abs(P[P.length - 1][2]) > 0.5) continue;
      const L = P[P.length - 1][3]; const s0 = (deg.get(e[0]) > 2 ? hw + 4 : 0), s1 = L - (deg.get(e[1]) > 2 ? hw + 4 : 0); if (s1 - s0 < 4) continue;
      const sub = slicePath(P, s0, s1); const pw = /trunk|primary/.test(r.k) ? 3 : 2.4;
      for (const side of [-1, 1]) for (const [a, b] of this.freeRuns(P, s0, s1, side * (hw + 0.3 + pw / 2))) pave.push(strip(slicePath(P, a, b), side * (hw + 0.3 + pw / 2), pw, 0.11));
    }
    if (pave.length) { const t = this.T.paving.clone(); t.repeat.set(1 / 2.4, 1 / 1.8); t.needsUpdate = true; let tn = null; if (this.T.pavingN) { tn = this.T.pavingN.clone(); tn.repeat.copy(t.repeat); tn.needsUpdate = true; }
      const m = new THREE.Mesh(mergeGeometries(pave.map(g => planarUV(g, 1))), paveDetail(new THREE.MeshStandardMaterial({ map: t, normalMap: tn, color: 0xe6e2da, roughness: 0.85 }), this.q)); m.receiveShadow = true; this.group.add(m); this.paveCount = pave.length; }
    // junction fills: a disc of asphalt at every 3+-way junction so carriageways join cleanly
    const nodes = new Map();
    for (const { e, r, P, hw } of this.edges) { if (r.tun) continue; for (const [id, p] of [[e[0], P[0]], [e[1], P[P.length - 1]]]) { if (deg.get(id) < 3 || p[2] < -0.5) continue; const n = nodes.get(id) || { x: p[0], z: p[1], h: p[2], r: 0, maj: false }; n.r = Math.max(n.r, hw + 3.2); /* p51: wider junction discs */ n.maj = n.maj || cls(r.k) === 'major'; nodes.set(id, n); } }
    for (const c of this.cross || []) nodes.set('x' + c.x.toFixed(1) + ',' + c.z.toFixed(1), { x: c.x, z: c.z, h: 0, r: c.r, maj: true }); // at-grade crossings of the surfaced ring road
    const discs = []; // junction discs reach ~2 m past the widest carriageway: the rounded kerb corners of a real junction
    for (const n of nodes.values()) { this.addDrive(n.x, n.z, n.x + 0.01, n.z, n.r + 0.35, n.h, n.h); // the visible junction disc is drivable, nothing more
      const g = new THREE.CircleGeometry(n.r, 20); g.rotateX(-Math.PI / 2); g.translate(n.x, n.h + 0.035, n.z); const uv = g.attributes.uv; const pa = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, pa.getX(i) / 8, pa.getZ(i) / 8); discs.push(g.toNonIndexed()); }
    // p51 turning circles at the dead ends left after tools/clean_network.py (brum.json 'turns'): a drivable asphalt bowl, no rails
    this.turnDiscs = []; for (const [tx, tz, tr] of (this.d.turns || [])) { const x = dm(tx), z = dm(tz); const sn = this.nearestRoad?.(x, z); const h = sn && Math.abs(sn.h) < 0.6 ? sn.h : 0; this.addDrive(x, z, x + 0.01, z, tr + 0.35, h, h);
      const g = new THREE.CircleGeometry(tr, 20); g.rotateX(-Math.PI / 2); g.translate(x, h + 0.034, z); const uv = g.attributes.uv; const pa = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, pa.getX(i) / 8, pa.getZ(i) / 8); discs.push(g.toNonIndexed()); this.turnDiscs.push({ x, z, r: tr }); }
    this.buildRoadFill(nodes, discs);
    if (discs.length) { const mat = mk(-5); this.roadMats.push(mat); const m = new THREE.Mesh(mergeGeometries(discs), mat); m.receiveShadow = true; this.group.add(m); }
  }
  // edges whose centreline stays inside a wider (or equal, earlier) road's carriageway: service / *_link ways and duplicates
  containedEdges(pre) {
    const G = new Map(), C = 25; const drop = new Set();
    pre.forEach((E, i) => { const P = E.P; for (let k = 0; k < P.length - 1; k++) { const sg = { i, x1: P[k][0], z1: P[k][1], x2: P[k + 1][0], z2: P[k + 1][1], h: (P[k][2] + P[k + 1][2]) / 2 };
      for (let x = Math.floor((Math.min(sg.x1, sg.x2) - 12) / C); x <= Math.floor((Math.max(sg.x1, sg.x2) + 12) / C); x++) for (let z = Math.floor((Math.min(sg.z1, sg.z2) - 12) / C); z <= Math.floor((Math.max(sg.z1, sg.z2) + 12) / C); z++) { const key = x * 100000 + z; let a = G.get(key); if (!a) G.set(key, a = []); a.push(sg); } } });
    const walkK = k => /footway|path|cycleway|pedestrian|steps|bridleway/.test(k);
    pre.forEach((E, i) => { if (E.r.tun || walkK(E.r.k)) return; const svc = E.r.k === 'service' || /_link/.test(E.r.k); const L = E.P[E.P.length - 1][3]; if (L < 2) return;
      let n = 0, inAny = 0; const inn = new Map();
      for (let a = 0.5; a < L; a += 2) { const q = pointAt(E.P, a); n++; const hit = new Set();
        for (const sg of (G.get(Math.floor(q[0] / C) * 100000 + Math.floor(q[1] / C)) || [])) { if (sg.i === i || hit.has(sg.i) || drop.has(sg.i)) continue; const O = pre[sg.i]; if (O.r.tun || walkK(O.r.k) || Math.abs(sg.h - q[2]) > 0.8) continue;
          const same = O.hw === E.hw && O.r.k === E.r.k; if (O.hw < E.hw || (!svc && !same) || (same && svc === false && sg.i > i) || (same && svc && O.r.k === 'service' && sg.i > i)) continue;
          if (!svc && !(same && sg.i < i)) continue;
          const dx = sg.x2 - sg.x1, dz = sg.z2 - sg.z1, L2 = dx * dx + dz * dz || 1; let t = ((q[0] - sg.x1) * dx + (q[1] - sg.z1) * dz) / L2; t = Math.max(0, Math.min(1, t));
          if (Math.hypot(q[0] - sg.x1 - dx * t, q[1] - sg.z1 - dz * t) + E.hw * 0.5 < O.hw) { hit.add(sg.i); inn.set(sg.i, (inn.get(sg.i) || 0) + 1); } } if (hit.size) inAny++; }
      if (svc && n && inAny / n >= 0.85) drop.add(i); else for (const c of inn.values()) if (n && c / n >= (svc ? 0.8 : 0.95)) { drop.add(i); break; } });
    return drop;
  }
  // round 6 drivable corner fill: (1) a filled wedge (triangle) between every pair of adjacent legs meeting at < 120 deg
  // (a turn > 60 deg) at junctions, street-to-street joints and sharp polyline corners, so a car can turn through them
  // (this also widens service-road / car-park entrance mouths); shrunk or skipped where it would reach a building;
  // (2) a disc at sharp 2-way joints and corners (no notch on the outside); (3) short stubs (< 8 m) between two junctions
  // become one junction (a disc over both); (4) road ends that stop < 3 m short of another road are joined to it.
  buildRoadFill(nodes, discs) {
    const st = this.roadFill; st.wedges = 0; st.wedgeSkip = 0; st.corner = 0; st.stubs = 0; st.joins = 0;
    const walkK = k => /footway|path|cycleway|pedestrian|steps|bridleway/.test(k);
    // raw building footprints (street-level) for clearance tests
    const BG = new Map(), C = 25; for (const b of this.d.buildings) { if ((b.mh || 0) > 3) continue; const pts = []; for (let i = 0; i < b.p.length; i += 2) pts.push([dm(b.p[i]), dm(b.p[i + 1])]); const bb = bbox(pts); const o = { pts, bb };
      for (let x = Math.floor(bb[0] / C); x <= Math.floor(bb[2] / C); x++) for (let z = Math.floor(bb[1] / C); z <= Math.floor(bb[3] / C); z++) { const k = x * 100000 + z; let a = BG.get(k); if (!a) BG.set(k, a = []); a.push(o); } }
    const inBld = (x, z) => { for (const o of (BG.get(Math.floor(x / C) * 100000 + Math.floor(z / C)) || [])) if (x >= o.bb[0] && x <= o.bb[2] && z >= o.bb[1] && z <= o.bb[3] && pointInPoly([x, z], o.pts)) return true; return false; };
    const triClear = (N, A, B) => { for (let u = 0; u <= 1.001; u += 0.125) for (let v = 0; u + v <= 1.001; v += 0.125) { const x = N[0] + (A[0] - N[0]) * u + (B[0] - N[0]) * v, z = N[1] + (A[1] - N[1]) * u + (B[1] - N[1]) * v; if (inBld(x, z)) return false; } return true; };
    const discClear = (x, z, r) => { if (inBld(x, z)) return false; for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; if (inBld(x + Math.cos(a) * r, z + Math.sin(a) * r)) return false; } return true; };
    const geoms = []; const lift = 0.03;
    const addTri = (N, A, B, h, hwc) => { const g = new THREE.BufferGeometry(); const pos = [N[0], h + lift, N[1], A[0], h + lift, A[1], B[0], h + lift, B[1]];
      // wind upwards (+y normal)
      const cr = (A[0] - N[0]) * (B[1] - N[1]) - (A[1] - N[1]) * (B[0] - N[0]); if (cr > 0) { pos.splice(3, 6, B[0], h + lift, B[1], A[0], h + lift, A[1]); }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute([pos[0] / 8, pos[2] / 8, pos[3] / 8, pos[5] / 8, pos[6] / 8, pos[8] / 8], 2)); g.computeVertexNormals(); geoms.push(g);
      // drivable: capsules from the node towards the chord, ending on the chord (never past it)
      for (let t = 0; t <= 1.001; t += 0.125) { const cx = A[0] + (B[0] - A[0]) * t, cz = A[1] + (B[1] - A[1]) * t, dl = Math.hypot(cx - N[0], cz - N[1]); if (dl < 0.5) continue; const k = Math.max(0, 1 - hwc / dl);
        this.addDrive(N[0], N[1], N[0] + (cx - N[0]) * k, N[1] + (cz - N[1]) * k, Math.min(hwc, dl), h, h); } };
    const addDisc = (x, z, r, h) => { this.addDrive(x, z, x + 0.01, z, r + 0.35, h, h); const g = new THREE.CircleGeometry(r, 16); g.rotateX(-Math.PI / 2); g.translate(x, h + lift, z); const uv = g.attributes.uv, pa = g.attributes.position; for (let i = 0; i < uv.count; i++) uv.setXY(i, pa.getX(i) / 8, pa.getZ(i) / 8); geoms.push(g.toNonIndexed()); };
    // legs at every node (and at sharp interior polyline vertices)
    const legs = new Map(); const along = (P, a) => pointAt(P, Math.min(a, P[P.length - 1][3] - 0.01));
    const revP = P => { const L = P[P.length - 1][3]; return P.slice().reverse().map(q => [q[0], q[1], q[2], L - q[3]]); };
    const addLeg = (key, N, P, hw) => { let l = legs.get(key); if (!l) legs.set(key, l = { N, a: [] }); const q = along(P, Math.min(2, P[P.length - 1][3] * 0.5)); l.a.push({ P, hw, ang: Math.atan2(q[1] - N[1], q[0] - N[0]), L: P[P.length - 1][3] }); };
    for (const E of this.edges) { const { e, r, P, hw, hid } = E; if (hid || r.tun || walkK(r.k) || P.some(p => Math.abs(p[2]) > 0.5)) continue; const L = P[P.length - 1][3]; if (L < 0.5) continue;
      addLeg('n' + e[0], [P[0][0], P[0][1], P[0][2]], P, hw); addLeg('n' + e[1], [P[P.length - 1][0], P[P.length - 1][1], P[P.length - 1][2]], revP(P), hw);
      for (let i = 1; i < P.length - 1; i++) { const ax = P[i][0] - P[i - 1][0], az = P[i][1] - P[i - 1][1], bx = P[i + 1][0] - P[i][0], bz = P[i + 1][1] - P[i][1];
        const c = (ax * bx + az * bz) / ((Math.hypot(ax, az) * Math.hypot(bx, bz)) || 1); if (c > Math.cos(60 * Math.PI / 180)) continue;
        const s0 = P[i][3], k = 'v' + i + ':' + e[2] + ':' + e[0] + ':' + e[1]; const N = [P[i][0], P[i][1], P[i][2]];
        addLeg(k, N, revP(slicePath(P, 0, s0)), hw); addLeg(k, N, slicePath(P, s0, L).map(q => [q[0], q[1], q[2], q[3] - s0]), hw); } }
    for (const [key, { N, a }] of legs) { if (a.length < 2) continue; a.sort((p, q) => p.ang - q.ang);
      if (a.length === 2) { let t = Math.abs(a[1].ang - a[0].ang); if (t > Math.PI) t = 2 * Math.PI - t; if (t < Math.PI * 2 / 3) { const r = Math.max(a[0].hw, a[1].hw); if (!nodes.has(+key.slice(1)) && discClear(N[0], N[1], r)) { addDisc(N[0], N[1], r, N[2]); st.corner++; } } }
      for (let i = 0; i < a.length; i++) { const A = a[i], B = a[(i + 1) % a.length]; let th = B.ang - A.ang; if (i === a.length - 1) th += 2 * Math.PI; if (th < 0.14 || th > Math.PI * 2 / 3) continue;
        let d = Math.min(A.hw + B.hw + 3, 14, 0.85 * A.L, 0.85 * B.L); let ok = false;
        for (const f of [1, 0.8, 0.6]) { const pa = along(A.P, d * f), pb = along(B.P, d * f); if (triClear(N, pa, pb)) { addTri(N, pa, pb, N[2], Math.min(A.hw, B.hw)); ok = true; break; } }
        if (ok) st.wedges++; else st.wedgeSkip++; } }
    // short stubs between two junctions: one disc over the pair
    for (const { e, r, P, hw, hid } of this.edges) { if (hid || r.tun || walkK(r.k)) continue; const L = P[P.length - 1][3]; if (L >= 8 || (this.deg.get(e[0]) || 0) < 2 || (this.deg.get(e[1]) || 0) < 2 || Math.abs(P[0][2]) > 0.5) continue;
      const m = pointAt(P, L / 2); let rr = L / 2 + hw + 2.2; if (!discClear(m[0], m[1], rr)) rr = L / 2 + hw; if (!discClear(m[0], m[1], rr)) continue; addDisc(m[0], m[1], rr, m[2]); st.stubs++;
      (this.stubDiscs || (this.stubDiscs = [])).push({ x: m[0], z: m[1], r: rr }); }
    // road ends that stop < 3 m short of another road: joined with a short piece of carriageway
    const eIdx = new Map(); this.edges.forEach((E, i) => eIdx.set(E, i));
    for (const [i, E] of this.edges.entries()) { const { e, r, P, hw, hid } = E; if (hid || r.tun || walkK(r.k)) continue;
      for (const end of [0, 1]) { if (this.deg.get(e[end]) !== 1) continue; const Q = end === 0 ? P : revP(P); const x = Q[0][0], z = Q[0][1], h = Q[0][2]; if (Math.abs(h) > 0.5 || Q[Q.length - 1][3] < 3) continue;
        let best = 1e9, bp = null; for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) for (const g of (this.segGrid.get((Math.floor(x / 25) + ox) * 100000 + Math.floor(z / 25) + oz) || [])) { if (g.ei === i || g.hid || g.tun || Math.abs((g.h1 + g.h2) / 2 - h) > 0.6) continue;
          const dx = g.x2 - g.x1, dz = g.z2 - g.z1, L2 = dx * dx + dz * dz || 1; let t = ((x - g.x1) * dx + (z - g.z1) * dz) / L2; t = Math.max(0, Math.min(1, t)); const px = g.x1 + dx * t, pz = g.z1 + dz * t, dd = Math.hypot(x - px, z - pz) - (g.hw - 0.4);
          if (dd < best) { best = dd; bp = [px, pz, g.h1 + (g.h2 - g.h1) * t]; } }
        if (!(best > 0.3 && best < 3)) continue; let clear = true; for (let t = 0; t <= 1; t += 0.1) if (inBld(x + (bp[0] - x) * t, z + (bp[1] - z) * t)) { clear = false; break; } if (!clear) continue;
        this.addDrive(x, z, bp[0], bp[1], hw + World.PAVEMENT, h, bp[2]); const L = Math.hypot(bp[0] - x, bp[1] - z); const g = ribbon([[x, z, h, 0], [bp[0], bp[1], bp[2], L]], hw, lift - 0.035, 8); geoms.push(g.index ? g.toNonIndexed() : g); st.joins++; } }
    for (const g of geoms) { if (!g.attributes.normal) g.computeVertexNormals(); discs.push(g); }
  }
  addSeg(s) {
    const C = 25; const minx = Math.floor((Math.min(s.x1, s.x2) - s.hw) / C), maxx = Math.floor((Math.max(s.x1, s.x2) + s.hw) / C);
    const minz = Math.floor((Math.min(s.z1, s.z2) - s.hw) / C), maxz = Math.floor((Math.max(s.z1, s.z2) + s.hw) / C);
    for (let x = minx; x <= maxx; x++) for (let z = minz; z <= maxz; z++) { const k = x * 100000 + z; let a = this.segGrid.get(k); if (!a) this.segGrid.set(k, a = []); a.push(s); }
    this.addDrive(s.x1, s.z1, s.x2, s.z2, s.hw - 0.4 + World.PAVEMENT, s.h1, s.h2, false, s.surf ? 'surf' : false); // carriageway + kerb face only
  }
  // ---- drivable area: road carriageways (+ a strip of pavement) and the closed race-route corridors.
  // Everything else (buildings, squares, parks, canals, rail) is off-limits: the car is stopped at the edge.
  // a carriageway (other than path P) at a height where cars would hit a parapet
  shallowRoadAt(x, z, P) {
    for (const s of (this.segGrid.get(Math.floor(x / 25) * 100000 + Math.floor(z / 25)) || [])) {
      const dx = s.x2 - s.x1, dz = s.z2 - s.z1, L2 = dx * dx + dz * dz || 1; let t = ((x - s.x1) * dx + (z - s.z1) * dz) / L2; t = Math.max(0, Math.min(1, t));
      if (s.h1 + (s.h2 - s.h1) * t < -1.2) continue; if (Math.hypot(x - s.x1 - dx * t, z - s.z1 - dz * t) < s.hw + 0.3) return true;
    }
    return false;
  }
  // move building vertices that poke into a carriageway back behind the kerb line (OSM footprints are often a metre or two out)
  clearOfRoads(pts0) {
    // round 6: footprint edges running into a carriageway between their corners are subdivided (every ~1.5 m) first, so
    // the whole wall (not only its corners) is moved back behind the kerb line
    const near = (x, z) => { for (const s of (this.segGrid.get(Math.floor(x / 25) * 100000 + Math.floor(z / 25)) || [])) { if (Math.max(s.h1, s.h2) < -1.2 || s.hid) continue; const dx = s.x2 - s.x1, dz = s.z2 - s.z1, L2 = dx * dx + dz * dz || 1; let t = ((x - s.x1) * dx + (z - s.z1) * dz) / L2; t = Math.max(0, Math.min(1, t)); if (Math.hypot(x - s.x1 - dx * t, z - s.z1 - dz * t) < s.hw + 0.4) return true; } return false; };
    const pts = []; for (let i = 0; i < pts0.length; i++) { const a = pts0[i], b = pts0[(i + 1) % pts0.length]; pts.push(a); const L = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.floor(L / 1.5); if (n < 2) continue;
      let hit = false; for (let k = 1; k < n && !hit; k++) hit = near(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n); if (hit) for (let k = 1; k < n; k++) pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
    return pts.map(([x, z]) => { let px = x, pz = z;
      for (let it = 0; it < 3; it++) { let moved = false;
        for (const s of (this.segGrid.get(Math.floor(px / 25) * 100000 + Math.floor(pz / 25)) || [])) {
          if (Math.max(s.h1, s.h2) < -1.2 || s.hid) continue; const dx = s.x2 - s.x1, dz = s.z2 - s.z1, L2 = dx * dx + dz * dz || 1; let t = ((px - s.x1) * dx + (pz - s.z1) * dz) / L2; t = Math.max(0, Math.min(1, t));
          const qx = s.x1 + dx * t, qz = s.z1 + dz * t, d = Math.hypot(px - qx, pz - qz), need = s.hw + 0.4;
          if (d < need && d > 0.01) { px = qx + (px - qx) / d * need; pz = qz + (pz - qz) / d * need; moved = true; }
        } if (!moved) break; }
      return [px, pz]; });
  }
  // ---- race tracks (first-game style): each route is a smooth centripetal Catmull-Rom curve (tools/build_routes.py),
  // W = 14 m asphalt, white edge lines, dashed centre line, red/white kerbs, sandy run-off, armco at +-(W/2 + 6.6)
  initTracks(data) {
    const W = World.TRACK_W, AR = World.ARMCO; this.tracks = []; this.tGrid = new Map();
    for (const r of this.routes.routes) {
      const P = r.path; if (!P || P.length < 2) continue; let d = 0;
      const Q = P.map((p, i) => { if (i) d += Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1]); return [p[0], p[1], 0, d]; });
      const t = { r, Q, closed: r.mode === 'circuit', n: Q.length, k: this.tracks.length }; this.tracks.push(t);
      for (let i = 0; i + 1 < Q.length; i++) { const a = Q[i], b = Q[i + 1], sg = { t, i, x1: a[0], z1: a[1], x2: b[0], z2: b[1] };
        for (let gx = Math.floor((Math.min(a[0], b[0]) - AR - 2) / 25); gx <= Math.floor((Math.max(a[0], b[0]) + AR + 2) / 25); gx++) for (let gz = Math.floor((Math.min(a[1], b[1]) - AR - 2) / 25); gz <= Math.floor((Math.max(a[1], b[1]) + AR + 2) / 25); gz++) {
          const k = gx * 100000 + gz; let arr = this.tGrid.get(k); if (!arr) this.tGrid.set(k, arr = []); arr.push(sg); } }
    }
    // at-grade crossings of the surfaced ring road with the streets that used to pass over / under it: junction discs
    this.cross = []; const surfE = [], other = [];
    for (const e of data.graph.e) { const r = data.roads[e[3]]; if (r.tun) continue; const pts = e[4]; const L = []; for (let i = 0; i + 3 < pts.length; i += 2) L.push([pts[i] / 10, pts[i + 1] / 10, pts[i + 2] / 10, pts[i + 3] / 10]); (r.surf ? surfE : other).push({ e, r, L }); }
    if (surfE.length) { const g = new Map(); for (const o of other) for (const s of o.L) { const k = Math.floor((s[0] + s[2]) / 50) * 100000 + Math.floor((s[1] + s[3]) / 50); let a = g.get(k); if (!a) g.set(k, a = []); a.push([o, s]); }
      for (const A of surfE) for (const s of A.L) { const cx = Math.floor((s[0] + s[2]) / 50), cz = Math.floor((s[1] + s[3]) / 50);
        for (let ox = -2; ox <= 2; ox++) for (let oz = -2; oz <= 2; oz++) for (const [B, q] of (g.get((cx + ox) * 100000 + cz + oz) || [])) {
          if (B.e[0] === A.e[0] || B.e[0] === A.e[1] || B.e[1] === A.e[0] || B.e[1] === A.e[1] || B.r.k === 'service' && B.r.w < 5) continue;
          if (!segX(s[0], s[1], s[2], s[3], q[0], q[1], q[2], q[3])) continue;
          const d1 = (s[2] - s[0]) * (q[3] - q[1]) - (s[3] - s[1]) * (q[2] - q[0]); if (Math.abs(d1) < 1e-9) continue;
          const t = ((q[0] - s[0]) * (q[3] - q[1]) - (q[1] - s[1]) * (q[2] - q[0])) / d1; const x = s[0] + (s[2] - s[0]) * t, z = s[1] + (s[3] - s[1]) * t;
          if (!this.cross.some(c => Math.hypot(c.x - x, c.z - z) < 3)) this.cross.push({ x, z, r: Math.max(A.r.w, B.r.w) / 2 + 2.5 }); } } }
  }
  // nearest track piece to (x,z) within the armco (+pad): {t, i, d}
  onTrack(x, z, pad = 0) {
    let best = null, bd = World.ARMCO + pad;
    for (const s of (this.tGrid?.get(Math.floor(x / 25) * 100000 + Math.floor(z / 25)) || [])) {
      const dx = s.x2 - s.x1, dz = s.z2 - s.z1, L2 = dx * dx + dz * dz || 1; let t = ((x - s.x1) * dx + (z - s.z1) * dz) / L2; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - s.x1 - dx * t, z - s.z1 - dz * t); if (d < bd) { bd = d; best = { t: s.t, i: s.i, d }; } }
    return best;
  }
  nearCross(x, z, pad = 0) { for (const c of this.cross || []) if (Math.abs(c.x - x) < c.r + pad && Math.abs(c.z - z) < c.r + pad && Math.hypot(c.x - x, c.z - z) < c.r + pad) return c; return null; }
  // city dressing (kerbs, pavements, lines, medians) is left out on the race tracks and at the ring-road crossings
  dressFree(x, z) { return !this.onTrack(x, z, 0.8) && !this.nearCross(x, z, 0.5); }
  touchesDress(P) { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const p of P) { x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[1]); x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[1]); }
    for (const c of this.cross || []) if (c.x > x0 - 30 && c.x < x1 + 30 && c.z > z0 - 30 && c.z < z1 + 30) return true;
    for (let gx = Math.floor((x0 - 20) / 25); gx <= Math.floor((x1 + 20) / 25); gx++) for (let gz = Math.floor((z0 - 20) / 25); gz <= Math.floor((z1 + 20) / 25); gz++) if (this.tGrid?.has(gx * 100000 + gz)) return true;
    return false; }
  freeRuns(P, s0, s1, off) { if (!this.touchesDress(P)) return s1 - s0 > 1.5 ? [[s0, s1]] : []; const out = []; let a0 = null;
    for (let a = s0; a <= s1 + 1e-6; a += 1) { const q = pointAt(P, Math.min(a, s1 - 0.01)); const ok = this.dressFree(q[0] + q[3] * off, q[1] + q[4] * off);
      if (ok && a0 == null) a0 = a; if (!ok && a0 != null) { if (a - a0 > 1.5) out.push([a0, a - 0.5]); a0 = null; } }
    if (a0 != null && s1 - a0 > 1.5) out.push([a0, s1]); return out; }
  // progress index of the active race's track nearest (x,z): only the armco of this part of the track is solid, so where
  // the track passes near itself the other part's barrier never blocks
  trackIdx(x, z) {
    const t = this.activeTrack; if (!t) return -1; if (this._tiX === x && this._tiZ === z) return this._ti;
    const Q = t.Q, n = t.n; let bi = -1, bd = 1e18; const near = (i0, span) => { for (let k = -span; k <= span; k++) { let i = i0 + k; if (t.closed) i = ((i % n) + n) % n; else if (i < 0 || i >= n) continue; const d = (Q[i][0] - x) ** 2 + (Q[i][1] - z) ** 2; if (d < bd) { bd = d; bi = i; } } };
    if (this._ti >= 0 && this._tiT === t) near(this._ti, 40); if (bd > (World.ARMCO + 6) ** 2) { bd = 1e18; for (let i = 0; i < n; i++) { const d = (Q[i][0] - x) ** 2 + (Q[i][1] - z) ** 2; if (d < bd) { bd = d; bi = i; } } }
    this._ti = bi; this._tiT = t; this._tiX = x; this._tiZ = z; return bi;
  }
  _tiFar(s, x, z) { const t = this.activeTrack; if (!t) return false; const ti = this.trackIdx(x, z); if (ti < 0) return false; let d = Math.abs(s.ti - ti); if (t.closed) d = Math.min(d, t.n - d); return d > 45; }
  // Street-circuit kit per route (like a real closed-road race / BeamNG track): continuous concrete barriers along both
  // lane edges, closing every side road, with gaps only where the route itself passes; white lane-edge lines.
  // Built once, shown + made solid only while that race is running (free roam keeps the open city).
  buildRaceKits() {
    // race-only kit per track: continuous metallic armco along both sides (two-sided, solid, progress-indexed) and the
    // start gantry.  Where the track passes near another part of itself the armco that would stand on it is left out.
    this.raceKits = {}; const AR = World.ARMCO, W = World.TRACK_W;
    const armMat = new THREE.MeshStandardMaterial({ color: 0xd4d8dd, metalness: 0.85, roughness: 0.32, envMapIntensity: 1, side: THREE.DoubleSide });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x8d9398, metalness: 0.6, roughness: 0.5 });
    const gm = new THREE.MeshStandardMaterial({ color: 0x23262b, metalness: 0.6, roughness: 0.45 });
    const bT = this.tex(1024, 128, (g, w, h) => { g.fillStyle = '#0b0d10'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffcc33'; g.font = 'italic 900 84px system-ui,sans-serif'; g.textAlign = 'center'; g.fillText('CUZZY RACING', w / 2, 96); }, false);
    for (const t of this.tracks) {
      const { r, Q, n } = t; const segs = [], arm = [], posts = [];
      for (const sd of [-1, 1]) {
        let run = [];
        const flush = () => { if (run.length > 1) { arm.push(wall(run.map(p => [p[0], p[1], 0, p[3]]), 0, 0, () => 0.35, () => 1.15));
          for (let k = 0; k < run.length - 1; k++) segs.push([run[k][0], run[k][1], run[k + 1][0], run[k + 1][1], run[k].i]);
          for (let k = 0; k < run.length; k += 1) posts.push([run[k][0], run[k][1]]); } run = []; };
        const loopN = t.closed ? n : n; // closed paths repeat their first point at the end
        for (let i = 0; i < loopN; i++) {
          const q = offsetPt(Q, i, sd * AR); q.i = i;
          const o = this.onTrackOther(q[0], q[1], t, i);
          if (o) flush(); else run.push(q);
        }
        flush();
      }
      const grp = new THREE.Group(); grp.visible = false;
      if (arm.length) { const m = new THREE.Mesh(mergeGeometries(arm), armMat); m.castShadow = true; grp.add(m); }
      if (posts.length && this.q.env >= 1) { const pg = new THREE.BoxGeometry(0.12, 0.8, 0.12); pg.translate(0, 0.4, 0); const im = new THREE.InstancedMesh(pg, postMat, posts.length); const M = new THREE.Matrix4();
        posts.forEach((p, k) => { M.makeTranslation(p[0], 0, p[1]); im.setMatrixAt(k, M); }); grp.add(im); }
      // start gantry (first game): two posts, a beam and the CUZZY RACING banner over the start line
      { const s0 = Q[0], s1 = Q[Math.min(n - 1, 2)]; const yaw = Math.atan2(s1[0] - s0[0], s1[1] - s0[1]); const G = new THREE.Group();
        [-1, 1].forEach(sd => { const pb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 9, 0.6), gm); pb.position.set(sd * (AR + 0.8), 4.5, 0); pb.castShadow = true; G.add(pb); });
        const beam = new THREE.Mesh(new THREE.BoxGeometry(AR * 2 + 2.2, 1.7, 0.9), gm); beam.position.y = 8.4; beam.castShadow = true; G.add(beam);
        const ban = new THREE.Mesh(new THREE.PlaneGeometry(W + 6.8, 1.6), new THREE.MeshStandardMaterial({ map: bT, roughness: 0.5, side: THREE.DoubleSide })); ban.position.set(0, 8.4, 0.48); G.add(ban);
        const ban2 = ban.clone(); ban2.position.z = -0.48; ban2.rotation.y = Math.PI; G.add(ban2);
        G.position.set(s0[0], 0, s0[1]); G.rotation.y = yaw; grp.add(G); }
      this.group.add(grp);
      const grid = new Map(); for (const [x1, z1, x2, z2, ti] of segs) { const sg = { x1, z1, x2, z2, h: 1.2, mh: 0, src: 'armco', ti }; for (let gx = Math.floor(Math.min(x1, x2) / 25); gx <= Math.floor(Math.max(x1, x2) / 25); gx++) for (let gz = Math.floor(Math.min(z1, z2) / 25); gz <= Math.floor(Math.max(z1, z2) / 25); gz++) { const k = gx * 100000 + gz; let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(sg); } }
      this.raceKits[r.id] = { grp, grid, n: segs.length, track: t };
    }
  }
  // is (x,z) on another part of track t (far along it from index i) or on another track's surface? (armco left out there)
  onTrackOther(x, z, t, i) {
    for (const s of (this.tGrid.get(Math.floor(x / 25) * 100000 + Math.floor(z / 25)) || [])) {
      if (s.t !== t) continue; let d = Math.abs(s.i - i); if (t.closed) d = Math.min(d, t.n - d); if (d < 12) continue;
      const dx = s.x2 - s.x1, dz = s.z2 - s.z1, L2 = dx * dx + dz * dz || 1; let u = ((x - s.x1) * dx + (z - s.z1) * dz) / L2; u = Math.max(0, Math.min(1, u));
      if (Math.hypot(x - s.x1 - dx * u, z - s.z1 - dz * u) < World.ARMCO - 0.3) return true; }
    return false;
  }
  setRaceKit(id) { if (this.freeTrack) { const ft = id && this.fullTrack[id]; this.freeTrack.visible = !ft; for (const [k, g] of Object.entries(this.fullTrack)) g.visible = k === id; } this.raceGrid = null; this.activeTrack = null; this._ti = -1; this.activeRoute = id || null; for (const [k, v] of Object.entries(this.raceKits || {})) { v.grp.visible = k === id; if (k === id) { this.raceGrid = v.grid; this.activeTrack = v.track; } } }
  // is (x,z) over the open (roofless) part of a sunken road?
  cutBelow(x, z) {
    for (const s of (this.segGrid.get(Math.floor(x / 25) * 100000 + Math.floor(z / 25)) || [])) {
      if (s.tun || Math.min(s.h1, s.h2) > -1) continue; const dx = s.x2 - s.x1, dz = s.z2 - s.z1, L2 = dx * dx + dz * dz || 1; let t = ((x - s.x1) * dx + (z - s.z1) * dz) / L2; t = Math.max(0, Math.min(1, t));
      if (s.h1 + (s.h2 - s.h1) * t < -1 && Math.hypot(x - s.x1 - dx * t, z - s.z1 - dz * t) < s.hw + 1.2) return true;
    }
    return false;
  }
  addDrive(x1, z1, x2, z2, hw, h1 = 0, h2 = 0, corr = false, track = false) {
    const C = 25; this.driveGrid = this.driveGrid || new Map(); const d = { x1, z1, x2, z2, hw, h1, h2, corr, track };
    const minx = Math.floor((Math.min(x1, x2) - hw) / C), maxx = Math.floor((Math.max(x1, x2) + hw) / C), minz = Math.floor((Math.min(z1, z2) - hw) / C), maxz = Math.floor((Math.max(z1, z2) + hw) / C);
    for (let x = minx; x <= maxx; x++) for (let z = minz; z <= maxz; z++) { const k = x * 100000 + z; let a = this.driveGrid.get(k); if (!a) this.driveGrid.set(k, a = []); a.push(d); }
  }
  addRouteCorridors() {
    // first-game track surface on every race route, permanent (free roam can drive it and it joins the streets):
    // asphalt W = 14 m, tyre-wear bands, solid white edge lines, dashed centre line, red/white kerbs, sandy run-off.
    // Drivable out to just inside the armco line; flat at street level.
    const W = World.TRACK_W, AR = World.ARMCO;
    const po = (f) => ({ polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f * 2 });
    const roadMat = new THREE.MeshStandardMaterial({ map: this.T.asphalt, normalMap: this.q.env >= 1 ? this.T.asphaltN : null, roughnessMap: this.T.asphaltRough, normalScale: new THREE.Vector2(1, 1), color: 0x8f8f8f, roughness: 0.9, metalness: 0.02, envMapIntensity: 0.35, ...po(-10) });
    const wearMat = new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false, ...po(-11) });
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xf0efe8, roughness: 0.65, ...po(-12) });
    const dashT = this.tex(8, 128, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#ece8dc'; g.fillRect(0, 0, w, 64); });
    const dashMat = new THREE.MeshStandardMaterial({ map: dashT, transparent: true, alphaTest: 0.5, roughness: 0.65, ...po(-12) });
    const kerbT = this.tex(64, 64, g => { g.fillStyle = '#c81f1f'; g.fillRect(0, 0, 64, 32); g.fillStyle = '#ececec'; g.fillRect(0, 32, 64, 32); });
    const kerbMat = new THREE.MeshStandardMaterial({ map: kerbT, roughness: 0.55, envMapIntensity: 0.4, ...po(-10) });
    const sandMat = new THREE.MeshStandardMaterial({ color: 0xa89574, roughness: 1, ...po(-9) });
    const G = { road: [], wear: [], line: [], dash: [], kerb: [], sand: [] };
    const freeKerbMat = new THREE.MeshStandardMaterial({ map: cityTex(this.q, 'concrete'), color: 0xd4d0c8, roughness: 0.8, ...po(-8) }); // free-roam: plain concrete kerb
    const freePaveT = this.T.paving.clone(); freePaveT.repeat.set(1, 1); freePaveT.needsUpdate = true;
    const freePaveMat = new THREE.MeshStandardMaterial({ map: freePaveT, color: 0xe6e2da, roughness: 0.85, ...po(-7) }); // and paved footway
    // flat strip between lateral offsets o0..o1 at height y; u runs 0..uR across, v = distance / vRep (first game's mapping)
    const band = (Q, o0, o1, y, vRep, uR = 1) => { const pos = [], uv = [], idx = [];
      for (let i = 0; i < Q.length; i++) { const a = offsetPt(Q, i, o0), b = offsetPt(Q, i, o1); pos.push(a[0], y, a[1], b[0], y, b[1]); uv.push(0, Q[i][3] / vRep, uR, Q[i][3] / vRep); if (i + 1 < Q.length) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      if (g.attributes.normal.getY(0) < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
      return g.toNonIndexed(); };
    // routes share streets: each stretch of tarmac is drawn once (a later track skips points already covered by an
    // earlier one), so there is one clear road with one set of kerbs, never two overlapping
    this.freeTrack = new THREE.Group(); this.fullTrack = {};
    const drawn = new Map(), DC = 20, near = (x, z) => { const gx = Math.floor(x / DC), gz = Math.floor(z / DC); for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) for (const q of (drawn.get((gx + ox) * 100000 + gz + oz) || [])) if ((q[0] - x) ** 2 + (q[1] - z) ** 2 < 3.5 ** 2) return true; return false; };
    for (const t of this.tracks) {
      const Q = t.Q; const dup = Q.map(q => near(q[0], q[1]));
      const runs = []; let a = -1; for (let i = 0; i <= Q.length; i++) { const free = i < Q.length && !dup[i]; if (free && a < 0) a = Math.max(0, i - 1); if (!free && a >= 0) { runs.push(Q.slice(a, Math.min(Q.length, i + 1))); a = -1; } }
      for (const q of Q) { const k = Math.floor(q[0] / DC) * 100000 + Math.floor(q[1] / DC); let arr = drawn.get(k); if (!arr) drawn.set(k, arr = []); arr.push(q); }
      // full copy of this track, shown only while racing it (free roam uses the de-duplicated set)
      { const F = { road: [band(Q, -W / 2, W / 2, 0.061, 28, 2)], wear: [band(Q, -4.3, -2.5, 0.063, 1), band(Q, 2.5, 4.3, 0.063, 1)], line: [band(Q, W / 2 - 0.75, W / 2 - 0.42, 0.065, 1), band(Q, -W / 2 + 0.42, -W / 2 + 0.75, 0.065, 1)], dash: [band(Q, -0.14, 0.14, 0.065, 9)], kerb: [band(Q, W / 2, W / 2 + 1.6, 0.076, 4), band(Q, -W / 2 - 1.6, -W / 2, 0.076, 4)], sand: [band(Q, W / 2 + 1.6, W / 2 + 6, 0.056, 10), band(Q, -W / 2 - 6, -W / 2 - 1.6, 0.056, 10)] };
        (this._fullT || (this._fullT = [])).push({ id: t.r.id, F }); }
      // free roam / open world: the track reads as a normal city street - asphalt, white lines, a grey concrete kerb and a
      // paved footway. No red/white race kerbs, sand run-off or tyre-wear bands (those are only in the race copy above).
      // Each track sits 8 mm above the previous one so overlapping tracks layer cleanly (no z-fighting), and its lines,
      // kerb and footway are cut wherever they would lie on another track's asphalt or on a visible street / junction.
      const yb = 0.06 + t.k * 0.008;
      const onOther = (x, z, i) => { for (const s of (this.tGrid.get(Math.floor(x / 25) * 100000 + Math.floor(z / 25)) || [])) { if (s.t === t) { let d = Math.abs(s.i - i); if (t.closed) d = Math.min(d, t.n - d); if (d < 12) continue; }
        const dx = s.x2 - s.x1, dz = s.z2 - s.z1, L2 = dx * dx + dz * dz || 1; let u = ((x - s.x1) * dx + (z - s.z1) * dz) / L2; u = Math.max(0, Math.min(1, u)); if (Math.hypot(x - s.x1 - dx * u, z - s.z1 - dz * u) < W / 2 + 0.3) return true; } return false; };
      const onStreet = (x, z) => { for (const s of (this.segGrid.get(Math.floor(x / 25) * 100000 + Math.floor(z / 25)) || [])) { if (s.hid || Math.max(s.h1, s.h2) < -1) continue;
        const dx = s.x2 - s.x1, dz = s.z2 - s.z1, L2 = dx * dx + dz * dz || 1; let u = ((x - s.x1) * dx + (z - s.z1) * dz) / L2; u = Math.max(0, Math.min(1, u)); if (Math.hypot(x - s.x1 - dx * u, z - s.z1 - dz * u) < s.hw + 0.2) return true; } return false; };
      const clip = (R, offs, street) => { const out = []; let a = -1; const i0 = Q.indexOf(R[0]);
        for (let i = 0; i <= R.length; i++) { const ok = i < R.length && offs.every(o => { const q = offsetPt(R, i, o); return !onOther(q[0], q[1], i0 + i) && !(street && onStreet(q[0], q[1])); });
          if (ok && a < 0) a = i; if (!ok && a >= 0) { if (i - a >= 2) out.push(R.slice(a, i)); a = -1; } } return out; };
      for (const R of runs) { if (R.length < 2) continue;
      G.road.push(band(R, -W / 2, W / 2, yb, 28, 2));
      for (const sd of [-1, 1]) {
        for (const C of clip(R, [sd * (W / 2 - 0.58)], false)) G.line.push(band(C, sd > 0 ? W / 2 - 0.75 : -W / 2 + 0.42, sd > 0 ? W / 2 - 0.42 : -W / 2 + 0.75, yb + 0.004, 1));
        for (const C of clip(R, [sd * (W / 2 + 0.15), sd * (W / 2 + 1.8), sd * (W / 2 + 3.4)], true)) { G.kerb.push(band(C, sd > 0 ? W / 2 : -W / 2 - 0.3, sd > 0 ? W / 2 + 0.3 : -W / 2, yb + 0.002, 4));
          G.sand.push(band(C, sd > 0 ? W / 2 + 0.3 : -W / 2 - 3.6, sd > 0 ? W / 2 + 3.6 : -W / 2 - 0.3, yb - 0.004, 1.8, 3.6 / 2.4)); } }
      for (const C of clip(R, [0], false)) G.dash.push(band(C, -0.14, 0.14, yb + 0.004, 9)); }
      // chequered start (circuit) / finish (sprint) lines
      for (const [i0, i1] of t.closed ? [[0, 1]] : [[0, 1], [t.n - 2, t.n - 1]]) { const a = Q[i0], b = Q[i1]; const g = new THREE.PlaneGeometry(W, 2.2); const chk = this._chk || (this._chk = new THREE.MeshStandardMaterial({ roughness: 0.7, map: this.tex(128, 16, g2 => { for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { g2.fillStyle = (x + y) % 2 ? '#151515' : '#f2f2f2'; g2.fillRect(x * 8, y * 8, 8, 8); } }), ...po(-13) }));
        const m = new THREE.Mesh(g, chk); m.rotation.x = -Math.PI / 2; m.rotation.z = Math.atan2(b[0] - a[0], b[1] - a[1]) + Math.PI / 2; m.position.set(a[0], 0.066, a[1]); m.receiveShadow = true; (this.fullTrack[t.r.id] || (this.fullTrack[t.r.id] = new THREE.Group())).add(m); } // race only
      for (let i = 0; i + 1 < Q.length; i++) this.addDrive(Q[i][0], Q[i][1], Q[i + 1][0], Q[i + 1][1], AR - 0.35, 0, 0, false, true);
      t.r._Q = Q;
    }
    for (const [k, mat] of [['road', roadMat], ['wear', wearMat], ['line', lineMat], ['dash', dashMat], ['kerb', kerbMat], ['sand', sandMat]]) {
      const fmat = k === 'kerb' ? freeKerbMat : k === 'sand' ? freePaveMat : mat;
      if (G[k].length) { const m = new THREE.Mesh(mergeGeometries(G[k]), fmat); m.receiveShadow = true; this.freeTrack.add(m); }
      for (const ft of this._fullT) { const fm = new THREE.Mesh(mergeGeometries(ft.F[k]), mat); fm.receiveShadow = true; if (k === 'wear') fm.renderOrder = 2; (this.fullTrack[ft.id] || (this.fullTrack[ft.id] = new THREE.Group())).add(fm); } }
    for (const g of Object.values(this.fullTrack)) { g.visible = false; this.group.add(g); } this.group.add(this.freeTrack);
    this.roadMats?.push(roadMat); this.trackMats = [roadMat, kerbMat, sandMat];
    this.buildRaceKits();
    for (const r of this.routes.routes) for (const g of r.grid) this.addDrive(g[0] - 3, g[1] - 3, g[0] + 3, g[1] + 3, 6, 0, 0);
    const mat = roadMat;
    const m = this.routes.meet; if (m) { this.addDrive(m.x - 12, m.z, m.x + 12, m.z + 10, 14, 0, 0); // car-park meet: a visible asphalt pad covering exactly the drivable box
      const g = new THREE.PlaneGeometry(24 + 28, 10 + 28); g.rotateX(-Math.PI / 2); g.translate(m.x, 0.014, m.z + 5); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 6.5, uv.getY(i) * 4.75);
      this.group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: this.T.asphalt, roughnessMap: this.T.asphaltRough, roughness: 1, color: 0xbdbdbd, polygonOffset: true, polygonOffsetFactor: -1.8, polygonOffsetUnits: -3.6 }))); }
  }
  // returns null when (x,z) is inside the drivable area, else the nearest edge point and the outward direction
  offRoad(x, z, y, inset = 0) {
    const B = this.bounds; if (x < B.minx + 2 || x > B.maxx - 2 || z < B.minz + 2 || z > B.maxz - 2) return { revert: true };
    const gx = Math.floor(x / 25), gz = Math.floor(z / 25); let best = null, bp = 1e9;
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) for (const s of (this.driveGrid?.get((gx + ox) * 100000 + gz + oz) || [])) {
      const dx = s.x2 - s.x1, dz = s.z2 - s.z1, L2 = dx * dx + dz * dz || 1; let t = ((x - s.x1) * dx + (z - s.z1) * dz) / L2; t = Math.max(0, Math.min(1, t));
      const sh = s.h1 + (s.h2 - s.h1) * t; if (Math.abs(sh - y) > 1.5) continue; // different level (bridge / tunnel / cutting)
      if (s.corr && s.corr !== this.activeRoute) continue; // race lanes (and their laid surface) exist only during that race
      if (s.corr && sh > -0.5 && this.cutBelow(x, z)) continue; // race corridors never bridge an open cutting
      const px = s.x1 + dx * t, pz = s.z1 + dz * t, d = Math.hypot(x - px, z - pz), pen = d - (s.hw - inset);
      if (pen <= 0) { this._edge = null; return null; }
      if (pen < bp) { bp = pen; best = { px, pz, d, lim: s.hw - inset }; }
    }
    if (!best) return { revert: true }; // nothing drivable at this level here (e.g. on the ground above a tunnel)
    const ux = (x - best.px) / (best.d || 1), uz = (z - best.pz) / (best.d || 1);
    return { x: best.px + ux * best.lim, z: best.pz + uz * best.lim, ux, uz, pen: bp };
  }
  _lastEdge(x, z) { return null; } // far from any road (e.g. spawned off-map): don't trap the car
  // ---- the one collision rule (BeamNG-like): a car may only stand on a visible road surface, and nothing solid may
  // overlap its footprint. driveAt = drivable surface under (x,z) at the car's level (within tol), else null.
  // (fx,fz) = optional heading: where road pieces overlap near the same level (a slip road or tunnel ramp leaving a
  // street) the piece running the way the car is heading wins, so the car follows the road it is driving along
  // pref = optional preferred height (among pieces within tol of y, the one nearest pref wins)
  driveAt(x, z, y, tol = 1.0, fx, fz, pref) {
    const B = this.bounds; if (x < B.minx + 2 || x > B.maxx - 2 || z < B.minz + 2 || z > B.maxz - 2) return null;
    let best = null, bd = 1e9; // drive pieces are registered in every cell their (padded) box touches: one cell is enough
    for (const s of (this.driveGrid?.get(Math.floor(x / 25) * 100000 + Math.floor(z / 25)) || [])) {
      if (s.corr && s.corr !== this.activeRoute) continue; // race lanes exist only during their race
      const dx = s.x2 - s.x1, dz = s.z2 - s.z1, L2 = dx * dx + dz * dz || 1; let t = ((x - s.x1) * dx + (z - s.z1) * dz) / L2; t = Math.max(0, Math.min(1, t));
      const ex = x - s.x1 - dx * t, ez = z - s.z1 - dz * t; if (ex * ex + ez * ez > s.hw * s.hw) continue;
      const h = s.h1 + (s.h2 - s.h1) * t, dh = Math.abs(h - y); if (dh > tol) continue;
      const sc = (pref === undefined ? dh : Math.abs(h - pref)) + (fx === undefined ? 0 : 3 * (1 - Math.abs(dx * fx + dz * fz) / Math.sqrt(L2)) - (s.corr ? 0.5 : 0)); if (sc >= bd) continue; // the laid race lane is drawn on top: it wins
      if (s.corr && h > -0.5 && this.cutBelow(x, z)) continue; // race lanes never bridge an open cutting
      bd = sc; best = { h, s };
    }
    return best;
  }
  // any drive piece (all race lanes included) containing (x,z) at least `inset` inside its edge, near level y: used at
  // build time so street furniture is never placed on something drivable
  onAnyDrive(x, z, y = 0, inset = 0.15) {
    const gx = Math.floor(x / 25), gz = Math.floor(z / 25);
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) for (const s of (this.driveGrid?.get((gx + ox) * 100000 + gz + oz) || [])) {
      const dx = s.x2 - s.x1, dz = s.z2 - s.z1, L2 = dx * dx + dz * dz || 1; let t = ((x - s.x1) * dx + (z - s.z1) * dz) / L2; t = Math.max(0, Math.min(1, t));
      if (Math.abs(s.h1 + (s.h2 - s.h1) * t - y) > 1.5) continue; if (Math.hypot(x - s.x1 - dx * t, z - s.z1 - dz * t) < s.hw - inset) return true;
    }
    return false;
  }
  // first solid edge (building, parapet, rail, barrier, post, tree...) overlapping the car rectangle centred at (x,z)
  // with heading yaw and half-sizes hl (length) / hw (width). Returns {nx,nz} = unit direction from the car towards it.
  solidHit(x, z, yaw, hl, hw, y) {
    if (y < -1.2) return null; // below street level: sunken roads are bounded by their own drivable edges (tunnel walls)
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), ex = Math.abs(fx) * hl + Math.abs(fz) * hw, ez = Math.abs(fz) * hl + Math.abs(fx) * hw;
    const C = 25, cx0 = Math.floor((x - ex) / C), cx1 = Math.floor((x + ex) / C), cz0 = Math.floor((z - ez) / C), cz1 = Math.floor((z + ez) / C);
    const multi = cx0 !== cx1 || cz0 !== cz1, seen = multi ? new Set() : null;
    for (const G of this.raceGrid ? [this.bGrid, this.raceGrid] : [this.bGrid]) for (let gx = cx0; gx <= cx1; gx++) for (let gz = cz0; gz <= cz1; gz++) for (const s of (G.get(gx * 100000 + gz) || [])) {
      if (s.mh > 3) continue; // raised structures (covered passages / canopies) do not block
      if (seen) { if (seen.has(s)) continue; seen.add(s); }
      if (s.inx !== undefined && (x - s.x1) * s.inx + (z - s.z1) * s.inz < 0) continue; // race barriers hold cars in, never trap one outside
      if (s.ti !== undefined && this._tiFar(s, x, z)) continue; // armco of a far-away part of the track
      // segment in car-local coordinates (u forward, v left) clipped against the rectangle (Liang-Barsky)
      const ax = s.x1 - x, az = s.z1 - z, bx = s.x2 - x, bz = s.z2 - z;
      const u1 = ax * fx + az * fz, v1 = -ax * fz + az * fx, u2 = bx * fx + bz * fz, v2 = -bx * fz + bz * fx, du = u2 - u1, dv = v2 - v1;
      let t0 = 0, t1 = 1, out = false;
      for (const [p, q] of [[-du, u1 + hl], [du, hl - u1], [-dv, v1 + hw], [dv, hw - v1]]) {
        if (Math.abs(p) < 1e-12) { if (q < 0) { out = true; break; } continue; }
        const t = q / p; if (p < 0) { if (t > t1) { out = true; break; } if (t > t0) t0 = t; } else { if (t < t0) { out = true; break; } if (t < t1) t1 = t; }
      }
      if (out) continue;
      const sx = s.x2 - s.x1, sz = s.z2 - s.z1, L2 = sx * sx + sz * sz || 1; let t = (-ax * sx - az * sz) / L2; t = Math.max(0, Math.min(1, t));
      let nx = ax + sx * t, nz = az + sz * t, l = Math.hypot(nx, nz);
      if (l < 1e-3) { const L = Math.sqrt(L2); nx = -sz / L; nz = sx / L; l = 1; }
      return { nx: nx / l, nz: nz / l, px: x + ax + sx * t, pz: z + az + sz * t, src: s.src };
    }
    return null;
  }
  // ---------------- markings, repairs, drains -----------------------------------------------------
  buildMarkings() {
    const pos = [], col = [];
    const W = [0.95, 0.95, 0.92], Y = [0.95, 0.75, 0.1], D = [0.05, 0.05, 0.05], PATCH = [0.16, 0.16, 0.17];
    const quad = (P, a, b, off, w, c, lift = 0.05) => { // segment of path between arc lengths a..b at lateral offset
      const s = slicePath(P, a, b); if (s.length < 2) return;
      for (let i = 0; i < s.length - 1; i++) {
        const [x1, z1, h1] = s[i], [x2, z2, h2] = s[i + 1]; const dx = x2 - x1, dz = z2 - z1, l = Math.hypot(dx, dz) || 1; const nx = -dz / l, nz = dx / l;
        const o1 = off - w / 2, o2 = off + w / 2;
        const v = [[x1 + nx * o1, h1 + lift, z1 + nz * o1], [x1 + nx * o2, h1 + lift, z1 + nz * o2], [x2 + nx * o1, h2 + lift, z2 + nz * o1], [x2 + nx * o2, h2 + lift, z2 + nz * o2]];
        for (const k of [0, 2, 1, 1, 2, 3]) { pos.push(...v[k]); col.push(...c); }
      }
    };
    const rnd = mulberry(99);
    const envLow = this.q.env < 1;
    for (const { e, r, P, hw, hid } of this.edges) { if (hid) continue;
      if (r.k === 'service') continue;
      const L = P[P.length - 1][3]; const s0 = this.deg.get(e[0]) > 2 ? 9 : 1, s1 = L - (this.deg.get(e[1]) > 2 ? 9 : 1);
      if (s1 - s0 < 4) continue;
      const td = this.touchesDress(P); const qd = (P, a, b, off, w, c, lift) => { if (!td) return quad(P, a, b, off, w, c, lift); for (const [x, y] of this.freeRuns(P, a, b, off)) quad(P, x, y, off, w, c, lift); };
      const major = /motorway|trunk|primary/.test(r.k);
      if (envLow && !major) { // Low: minor streets keep their white edge lines + centre line (clear road edges), nothing else
        if (!r.ow && r.w >= 6) for (let a = s0; a < s1 - 3; a += 6) qd(P, a, Math.min(s1, a + 3), 0, 0.12, W);
        for (const sd of [-1, 1]) qd(P, s0, s1, sd * (hw - 0.2), 0.12, W); continue; }
      if (!r.ow && r.w >= 6) { for (let a = s0; a < s1 - 3; a += (major ? 9 : 6)) qd(P, a, Math.min(s1, a + (major ? 6 : 3)), 0, 0.12, W); }
      if (r.ow) { const lanes = Math.max(1, r.lanes || Math.round(r.w / 3.4)); for (let k = 1; k < lanes; k++) { const off = -hw + k * (r.w / lanes); for (let a = s0; a < s1 - 3; a += 9) qd(P, a, Math.min(s1, a + 3), off, 0.12, W); } }
      if (major || r.ow) { qd(P, s0, s1, hw - 0.35, 0.15, W); qd(P, s0, s1, -hw + 0.35, 0.15, W); }
      else if (!r.tun && P[0][2] > -0.5 && /secondary|tertiary|unclassified|residential/.test(r.k)) { // double yellow lines
        for (const sd of [-1, 1]) { qd(P, s0, s1, sd * (hw - 0.2), 0.12, W); qd(P, s0, s1, sd * (hw - 0.4), 0.07, Y); qd(P, s0, s1, sd * (hw - 0.55), 0.07, Y); } // white edge line + double yellows
      }
      if (this.q.env >= 2 && !r.tun) { // drains + patch repairs
        for (let a = s0 + 5; a < s1 - 2; a += 22 + rnd() * 10) qd(P, a, a + 0.6, (rnd() < 0.5 ? -1 : 1) * (hw - 0.45), 0.35, D, 0.045);
        if (rnd() < 0.5) { const a = s0 + rnd() * (s1 - s0); qd(P, a, Math.min(s1, a + 2 + rnd() * 5), (rnd() - 0.5) * hw, 1 + rnd() * 1.6, PATCH, 0.035); }
      }
      // give-way / stop lines at junction ends of minor roads
      if (!major && this.deg.get(e[1]) > 2) for (let a = s1; a < s1 + 0.3; a += 0.6) qd(P, s1, s1 + 0.3, r.ow ? 0 : -hw / 2, r.ow ? r.w - 0.6 : hw - 0.3, W);
    }
    // BeamNG-style edge blending + wear decals: a translucent layer so roads read as real, used surfaces instead of flat ribbons.
    // gutter grime along both kerbs, lighter polished tyre tracks in each lane, dark crack/repair lines.
    { const gp = [], gc = []; const rnd2 = mulberry(7);
      const band = (P, a, b, off, w, c) => { const sl = slicePath(P, a, b); for (let i = 0; i < sl.length - 1; i++) { const [x1, z1, h1] = sl[i], [x2, z2, h2] = sl[i + 1]; const dx = x2 - x1, dz = z2 - z1, l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
        const o1 = off - w / 2, o2 = off + w / 2; const v = [[x1 + nx * o1, h1 + 0.04, z1 + nz * o1], [x1 + nx * o2, h1 + 0.04, z1 + nz * o2], [x2 + nx * o1, h2 + 0.04, z2 + nz * o1], [x2 + nx * o2, h2 + 0.04, z2 + nz * o2]];
        const ca = [c[0], c[1], c[2], c[3]], cb = [c[0], c[1], c[2], c[4] ?? c[3]]; for (const k of [0, 2, 1, 1, 2, 3]) { gp.push(...v[k]); gc.push(...(k % 2 === 0 ? ca : cb)); } } };
      for (const { e, r, P, hw, hid } of this.edges) { if (hid) continue;
        if (r.k === 'service' && envLow) continue; const L = P[P.length - 1][3]; if (L < 3) continue;
        for (const sd of [-1, 1]) band(P, 0, L, sd * (hw - 0.45), 0.9, sd < 0 ? [0.1, 0.09, 0.08, 0.55, 0.0] : [0.1, 0.09, 0.08, 0.0, 0.55]); // grime fades toward the centre
        if (this.q.env >= 1 && r.k !== 'service') { const lanes = Math.max(1, r.ow ? (r.lanes || Math.round(r.w / 3.4)) : 2), lw = r.w / lanes;
          for (let k = 0; k < lanes; k++) { const c0 = -hw + lw * (k + 0.5); for (const t of [-0.8, 0.8]) band(P, 0, L, c0 + t, 0.5, [0.55, 0.55, 0.57, 0.12]); } } // polished tyre tracks
        if (this.q.env >= 1) for (let a = 4 + rnd2() * 20; a < L - 4; a += 25 + rnd2() * 40) band(P, a, Math.min(L, a + 3 + rnd2() * 9), (rnd2() - 0.5) * hw, 0.08, [0.02, 0.02, 0.02, 0.7]); // sealed cracks
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(gc, 4)); g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 })); m.receiveShadow = true; m.renderOrder = 1; this.group.add(m); }
    // race start/finish chequers drawn per route when a race starts (see game.js)
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    this.markMat = markWear(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -16 }), this.q); // High+: worn paint
    const m = new THREE.Mesh(g, this.markMat); m.receiveShadow = true; this.group.add(m);
  }
  // ---------------- tunnels, cuttings, barriers -----------------------------------------------------
  buildTunnels() {
    const walls = [], ceilings = [], lights = [], barriers = [], medians = [], rails = [], cbar = [], cbarTop = [];
    // solid street furniture along a road at lateral offset o: split into runs that never stand on (or right beside) anything drivable
    // (another carriageway, a junction or a race lane); each run is drawn by build(sub) and gets a matching collider
    const solidRuns = (P, s0, s1, o, h, src, build, clear = 0.4) => { // clear: gap kept to any drivable edge (a car body overhangs its tyres)
      let run = null; const flush = b => { if (run != null) { run += run > s0 ? 1.5 : 0; b -= b < s1 ? 1.5 : 0; } // ends kept well back from the drivable area they stop at
        if (run != null && b - run > 0.8) { const sub = slicePath(P, run, b); build(sub);
          for (let i = 0; i < sub.length - 1; i++) { const p1 = sub[i], p2 = sub[i + 1], dx = p2[0] - p1[0], dz = p2[1] - p1[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
            this.addBuildingCollider([[p1[0] + nx * o, p1[1] + nz * o], [p2[0] + nx * o, p2[1] + nz * o]], { h, lm: src }); } } run = null; };
      for (let a = s0; a < s1; a += 1) { const q = pointAt(P, Math.min(a + 0.5, s1)); const x = q[0] + q[3] * o, z = q[1] + q[4] * o;
        if (Math.abs(q[2]) > 0.5 || this.onAnyDrive(x, z, q[2], -clear)) flush(a); else if (run == null) run = a; } // street level only (colliders have no height)
      flush(s1);
    };
    for (const { e, r, P, hw } of this.edges) {
      const below = P.some(p => p[2] < -0.4);
      if (below && r.k !== 'service') {
        const L = P[P.length - 1][3];
        for (const sd of [-1, 1]) walls.push(wall(P, sd * (hw + 0.5), 0.5, (p) => p[2] - 0.2, (p) => r.tun ? p[2] + 5.4 : Math.max(p[2] + 1.1, 0.8)));
        // solid parapets at street level along both sides of every sunken section (open cuttings and tunnel approaches)
        for (let i = 0; i < P.length - 1; i++) {
          if (Math.min(P[i][2], P[i + 1][2]) > -0.6) continue;
          const dx = P[i + 1][0] - P[i][0], dz = P[i + 1][1] - P[i][1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
          for (const sd of [-1, 1]) { const o = sd * (hw + 0.75); const A = [P[i][0] + nx * o, P[i][1] + nz * o], Bp = [P[i + 1][0] + nx * o, P[i + 1][1] + nz * o];
            const onStreet = q => this.streetDrivable(q[0], q[1]) || this.shallowRoadAt(q[0], q[1], P); // never wall off a street-level carriageway
            const n = Math.max(1, Math.ceil(Math.hypot(Bp[0] - A[0], Bp[1] - A[1]) / 3)); // 3 m pieces so gaps open only where a street crosses
            for (let k = 0; k < n; k++) { const q0 = [A[0] + (Bp[0] - A[0]) * k / n, A[1] + (Bp[1] - A[1]) * k / n], q1 = [A[0] + (Bp[0] - A[0]) * (k + 1) / n, A[1] + (Bp[1] - A[1]) * (k + 1) / n];
              if (!onStreet(q0) && !onStreet(q1) && !onStreet([(q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2])) this.addBuildingCollider([q0, q1], { h: 1.2, parapet: true }); } }
        }
        // portal end walls over tunnel mouths (the street above is solid, you cannot drop into the tunnel)
        if (r.tun) {
          ceilings.push(strip(P.map(p => [p[0], p[1], p[2] + 5.4, p[3]]), 0, r.w + 1.4, 0.6));
          for (let a = 3; a < L - 3; a += 6) for (const sd of [-1, 1]) { const s = slicePath(P, a, a + 2.2); if (s.length > 1) lights.push(strip(s.map(p => [p[0], p[1], p[2] + 5.05, p[3]]), sd * (hw - 0.8), 0.25, 0.08)); }
          this.tunnelZones.push(P);
        }
      }
      // central reservations: where a one-way carriageway runs beside its opposite carriageway, the strip between them is a
    // raised, kerbed median (not drivable, now also clearly visible)
    if (r.ow && !r.tun && P[0][2] > -0.5) {
      const L = P[P.length - 1][3];
      if (L > 12) for (const sd of [-1, 1]) {
        const m = P[Math.floor(P.length / 2)], mb = P[Math.min(P.length - 1, Math.floor(P.length / 2) + 1)], ma = P[Math.max(0, Math.floor(P.length / 2) - 1)];
        const dx = mb[0] - ma[0], dz = mb[1] - ma[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
        let gap = 0; for (let g = 0.8; g <= 6; g += 0.4) { const x = m[0] + nx * sd * (hw + g), z = m[1] + nz * sd * (hw + g); if (!this.offRoad(x, z, m[2])) { gap = g; break; } }
        if (gap > 1.2 && gap < 6) { const mo = sd * (hw + 0.35 + (gap - 0.7) / 2); for (const [a, b] of this.freeRuns(P, Math.min(6, L / 4), L - Math.min(6, L / 4), mo)) medians.push(strip(slicePath(P, a, b), mo, gap - 0.7, 0.16)); }
      }
    }
    // (the pedestrian guard-railing that stood here on trunk / primary roads is now part of the road-edge rails: roadedge.js)
    // central-reservation crash barrier on one-way dual carriageways (offside = right in UK)
      if (r.surf && r.ow && P[0][2] > -0.5) { // surfaced Queensway: solid concrete central-reservation barrier at every GFX level, broken only at junctions
        const L = P[P.length - 1][3]; if (L > 8) solidRuns(P, 2, L - 2, hw + 0.8, 0.9, 'barrier', sub => { cbar.push(strip(sub, hw + 0.8, 0.5, 0.82)); cbarTop.push(strip(sub.map(p => [p[0], p[1], p[2] + 0.82, p[3]]), hw + 0.8, 0.3, 0.1)); }, 0.3);
      }
      if (r.ow && /motorway|trunk/.test(r.k) && !r.tun && !r.surf && this.q.env >= 1) {
        const L = P[P.length - 1][3]; if (L > 20) solidRuns(P, 4, L - 4, hw + 0.8, 0.8, 'barrier', sub => barriers.push(wall(sub, hw + 0.8, 0.12, p => p[2] + 0.45, p => p[2] + 0.8)), 0.3);
      }
    }
    // ground mask for open cuttings
    { const B = this.maskB.value; const N = 2048; const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, N, N); g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineCap = 'round';
      const X = x => (x - B.x) / B.z * N, Z = z => (z - B.y) / B.w * N;
      for (const { r, P, hw, hid } of this.edges) { if (hid) continue; if (r.tun) continue; for (let i = 0; i < P.length - 1; i++) { if (Math.min(P[i][2], P[i + 1][2]) > -0.35) continue; g.lineWidth = (hw * 2 + 1.2) / B.z * N; g.beginPath(); g.moveTo(X(P[i][0]), Z(P[i][1])); g.lineTo(X(P[i + 1][0]), Z(P[i + 1][1])); g.stroke(); } }
      const t = new THREE.CanvasTexture(c); t.flipY = false; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; this.maskU.value = t; }
    const wm = new THREE.MeshStandardMaterial({ map: this.T.tunnelTile, roughness: 0.55, side: THREE.DoubleSide });
    if (walls.length) this.group.add(new THREE.Mesh(mergeGeometries(walls), wm));
    if (ceilings.length) { const c = new THREE.Mesh(mergeGeometries(ceilings), new THREE.MeshStandardMaterial({ color: 0x2c2c2e, roughness: 0.9, side: THREE.DoubleSide })); c.castShadow = true; this.group.add(c); }
    if (lights.length) { this.tunnelLightMat = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffe2a8, emissiveIntensity: 2.2 }); this.group.add(new THREE.Mesh(mergeGeometries(lights), this.tunnelLightMat)); }
    if (medians.length) { const mm = new THREE.Mesh(mergeGeometries(medians.map(g => ensureUV(g))), new THREE.MeshStandardMaterial({ map: this.T.concrete, color: 0xc9c6bd, roughness: 0.85 })); mm.receiveShadow = true; this.group.add(mm); this.medianCount = medians.length; }
    if (rails.length) { this.group.add(new THREE.Mesh(mergeGeometries(rails.map(g => ensureUV(g))), new THREE.MeshStandardMaterial({ color: 0x8d949a, metalness: 0.7, roughness: 0.45 }))); this.railCount = rails.length; }
    if (cbar.length) { const cm = new THREE.Mesh(mergeGeometries(cbar.map(g => ensureUV(g))), new THREE.MeshStandardMaterial({ map: this.T.concrete, color: 0xd9d6ce, roughness: 0.8 })); cm.castShadow = cm.receiveShadow = true; this.group.add(cm);
      this.group.add(new THREE.Mesh(mergeGeometries(cbarTop.map(g => ensureUV(g))), new THREE.MeshStandardMaterial({ color: 0xc8202a, roughness: 0.6 }))); this.centralBarrierCount = cbar.length; }
    if (barriers.length) this.group.add(new THREE.Mesh(mergeGeometries(barriers), new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.8, roughness: 0.35 })));
  }
  // ---------------- buildings -------------------------------------------------------------------------
  buildBuildings() {
    // facade kinds (citylook.js FACADES): 0 victorian red brick, 1 dark-brick warehouse, 2 buff-brick office, 3 stone civic,
    // 4 blue-green curtain wall, 5 grey curtain wall, 6 concrete ribbon windows, 7 rendered georgian, 8 modern brick flats
    const { mats: fmats, night } = facadeMaterials(this.q); this.facadeNight = night;
    const groups = fmats.map(() => []); const pilot = []; const shops = []; const roofs = []; const parapets = []; const plant = []; const awnings = [];
    const rnd = mulberry(3), rnd2 = mulberry(4); const env = this.q.env; const slates = []; // rnd2: round-5 choices, keeps rnd's sequence
    const pickFac = (b, h) => {
      const pk = (lo, med) => { const a = env >= 1 ? med : lo; return a[Math.floor(rnd() * a.length)]; }; // Low keeps its old mix (and rnd sequence)
      if (b.m === 'brick') return h > 18 ? pk([2, 8, 1], [2, 8, 1, 9]) : pk([0, 0, 1, 8], [0, 9, 9, 1, 8]); if (b.m === 'glass') return rnd() < 0.55 ? 4 : 5;
      if (b.m === 'stone' || b.m === 'sandstone') return 3; if (b.m === 'concrete') return env >= 1 ? pk([6], [6, 10, 10]) : 6;
      if (h > 40) return [4, 5, 5, 2][Math.floor(rnd() * 4)]; if (h > 22) return pk([4, 5, 6, 2, 8], [4, 5, 6, 2, 8, 10]);
      if (/church|cathedral|heritage|public|civic/.test(b.k)) return 3;
      return pk([0, 0, 1, 7, 2, 8, 3, 6], [0, 9, 9, 1, 7, 2, 8, 3, 6, 10]); // 9 sooty Victorian terrace brick, 10 1960s precast panels
    };
    const lmSkip = new Set(['rotunda', 'selfridges', 'library', 'townhall', 'stchad', 'stmartin', 'council']);
    this.buildingPolys = [];
    this.roadConflicts = { raised: 0, removed: 0 };
    for (const b0 of this.d.buildings) {
      const pts = []; for (let i = 0; i < b0.p.length; i += 2) pts.push([dm(b0.p[i]), dm(b0.p[i + 1])]);
      let b = b0;
      if (!(b.lm && lmSkip.has(b.lm)) && (b.mh || 0) <= 3) { const c = this.clearOfRoads(pts); pts.length = 0; for (const q of c) pts.push(q); }
      const blk = !(b.lm && lmSkip.has(b.lm)) && (b.mh || 0) <= 3 ? this.blocksRoad(pts) : false;
      if (blk) { // OSM building drawn over a drivable road
        let area = 0; for (let i = 0; i < pts.length; i++) { const p1 = pts[i], p2 = pts[(i + 1) % pts.length]; area += p1[0] * p2[1] - p2[0] * p1[1]; } area = Math.abs(area) / 2;
        if (blk === 'track') { this.roadConflicts.track = (this.roadConflicts.track || 0) + 1; continue; } // on a race track or the surfaced Queensway: removed
        // over a main road (motorway/trunk/primary) there is no real overbuild in Birmingham's centre (e.g. the block that
        // used to hover over Smallbrook Queensway): removed. Elsewhere it becomes a covered passage on columns (below).
        if (b.h >= 9 && (blk === 'centre' || area > 600) && !this.majorUnder(pts)) { b = { ...b, mh: Math.max(b.mh || 0, 5.8) }; this.roadConflicts.raised++; } // becomes a covered passage over the road
        else { this.roadConflicts.removed++; continue; }
      }
      // no floating buildings: a raised base (covered passage, OSM min_height canopy / link bridge) stands on columns and gets
      // a soffit; if no columns fit clear of the carriageway it is removed (passage) or snapped to the ground (OSM part).
      // A base part over an open cutting (ground cut away under it) is removed.
      let cols = null;
      if (!(b.lm && lmSkip.has(b.lm))) { const bs = b.mh || 0; this.floatFix = this.floatFix || { cols: 0, snapped: 0, removed: 0, overCut: 0 };
        const sup = bs > 0.3 ? this.supportedPart(pts, bs, b0) : false; if (sup === 'lm') { this.floatFix.removed++; continue; }
        if (bs > 0.3 && !sup) { cols = this.pilotis(pts, bs); if (cols.length < 3) cols = this.pilotis(pts, bs, 5); // tight plot: denser columns
          if (cols.length < 3) { cols = null; if (b !== b0) { this.floatFix.removed++; continue; } b = { ...b, mh: 0 }; this.floatFix.snapped++; } else this.floatFix.cols++; }
        else if (bs <= 0.3 && this.overCut(pts)) { this.floatFix.overCut++; continue; } }
      this.addBuildingCollider(pts, b);
      if (cols) { for (const c of cols) { if (c.wall) { const [A, B] = c.wall; const L = Math.hypot(B[0] - A[0], B[1] - A[1]); const wg = new THREE.BoxGeometry(L, b.mh, 0.5); wg.rotateY(-Math.atan2(B[1] - A[1], B[0] - A[0])); wg.translate((A[0] + B[0]) / 2, b.mh / 2, (A[1] + B[1]) / 2); pilot.push(wg.toNonIndexed());
            const nx = -(B[1] - A[1]) / L * 0.25, nz = (B[0] - A[0]) / L * 0.25; this.addBuildingCollider([[A[0] + nx, A[1] + nz], [B[0] + nx, B[1] + nz], [B[0] - nx, B[1] - nz], [A[0] - nx, A[1] - nz]], { h: b.mh, lm: 'column' }); continue; } // solid podium wall where the edge is clear of every road
          const [x, z] = c, cs = 0.9; const cg = new THREE.BoxGeometry(cs, b.mh, cs); cg.translate(x, b.mh / 2, z); pilot.push(cg.toNonIndexed()); this.addBuildingCollider([[x - cs / 2, z - cs / 2], [x + cs / 2, z - cs / 2], [x + cs / 2, z + cs / 2], [x - cs / 2, z + cs / 2]], { h: b.mh, lm: 'column' }); }
        const sf = roofCap(pts, b.mh); const g = ensureUV(sf.index ? sf.toNonIndexed() : sf); const pa = g.attributes.position.array, uv = g.attributes.uv.array; // soffit (faces down)
        for (let i = 0; i < pa.length; i += 9) for (let k = 0; k < 3; k++) { const t = pa[i + 3 + k]; pa[i + 3 + k] = pa[i + 6 + k]; pa[i + 6 + k] = t; }
        for (let i = 0; i < uv.length; i += 6) for (let k = 0; k < 2; k++) { const t = uv[i + 2 + k]; uv[i + 2 + k] = uv[i + 4 + k]; uv[i + 4 + k] = t; }
        if (g.attributes.normal) g.deleteAttribute('normal'); g.computeVertexNormals(); pilot.push(g); }
      if (b.lm && lmSkip.has(b.lm)) { this.buildingPolys.push({ pts, b }); continue; }
      if (b.lm === 'grandcentral') { this.buildingPolys.push({ pts, b }); continue; } // collider kept; drawn only by its hand-modelled steel skin (a generic block here z-fought it)
      let h = Math.max(3, b.h); const base = b.mh || 0;
      if (b0.h === 11 && !b.lm && base === 0) { // 80% of OSM footprints have no height tag (map default 11 m): give them believable storey counts
        const hs = Math.abs(Math.sin(pts[0][0] * 7.31 + pts[0][1] * 3.17) * 24634.63) % 1, ar = Math.abs(polyArea(pts)); // (visual only: the collider above keeps b.h)
        const st = ar < 90 ? [2, 2, 3, 3, 3, 4] : ar < 400 ? [2, 3, 3, 3, 4, 4, 5] : ar < 1500 ? [3, 3, 4, 4, 5, 6, 7] : [3, 4, 5, 6, 6, 8, 10];
        h = st[Math.floor(hs * st.length)] * 3.5 + (hs * 7 % 1) * 0.6; }
      (this.bLog || (this.bLog = [])).push({ pts, base, h, n: b.n, k: b.k, raised: b0.mh !== b.mh, cols: cols ? cols.length : 0 }); // floating-building audit (tests/x_float_audit.mjs)
      const f = pickFac(b, h); const retail = !!b.s || (h < 30 && rnd() < 0.35 && /retail|commercial|yes/.test(b.k));
      const shop = retail && base === 0 && FACADES[f].style !== 'curtain' && FACADES[f].style !== 'curtain2';
      const g0 = shop ? 4.2 : base;
      if (shop) { shops.push(extrudeWalls(pts, 0, 4.2, 16, 4.2));
        if (env >= 1) { const cw = polyArea(pts) > 0; for (let i = 0; i < pts.length; i++) { const A = pts[i], B = pts[(i + 1) % pts.length]; const L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L < 4.5 || rnd() > 0.45) continue;
          let n = [(B[1] - A[1]) / L, -(B[0] - A[0]) / L]; const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2; if (pointInPoly([mx + n[0] * 0.3, mz + n[1] * 0.3], pts)) n = [-n[0], -n[1]];
          const t0 = rnd() * 0.3, t1 = Math.min(1, t0 + Math.min(0.9, 5.5 / L) * (0.7 + rnd() * 0.3)); const tx = mx + n[0] * 1.4, tz = mz + n[1] * 1.4;
          if (this.onAnyDrive(tx, tz, 0, -0.3)) continue; awnings.push(awningGeo(A, B, n, t0, t1, rnd() * 5 | 0)); void cw; } } }
      const wg = extrudeWalls(pts, g0, h, 12, 10.5, g0); if (env >= 1) tagWalls(wg, h, g0, Math.abs(Math.sin(pts[0][0] * 12.9898 + pts[0][1] * 78.233) * 43758.5453) % 1); groups[f].push(wg); // bInfo: grime / tint / room hash
      const hip = env >= 1 && h <= 15 && !shop && rnd2() < 0.7 ? hipRoof(pts, h, Math.abs(polyArea(pts))) : null; // Medium+: hipped slate roofs on small terraces / villas
      if (hip) { slates.push(hip); roofs.push(roofCap(pts, h)); continue; }
      roofs.push(roofCap(pts, h));
      if (env >= 1 && h >= 6) parapets.push(extrudeWalls(pts, h, h + (h > 20 ? 1.1 : 0.7), 6, 1.2)); // parapet with coping line
      if (h > 10 && env >= 1 && rnd() < (env >= 2 ? 0.75 : 0.45)) { // rooftop plant: AC units, fans, lift overrun on bigger roofs
        const c = centroid(pts); if (pointInPoly(c, pts)) { let area = Math.abs(polyArea(pts)); for (const g of roofPlant(c, h, rnd, area > 600 && h > 18, (x, z) => pointInPoly([x, z], pts), env)) plant.push(g); }
      }
    }
    this.facadeMats = [];
    const bShadow = this.q.shadows >= 2 || (this.q.shadows >= 1 && env >= 2); // High: buildings cast sun shadows onto the street
    groups.forEach((gs, i) => { if (!gs.length) return; const mat = fmats[i]; this.facadeMats.push(mat); const m = new THREE.Mesh(mergeGeometries(gs), mat); m.castShadow = bShadow; m.receiveShadow = true; this.group.add(m); });
    if (shops.length) { this.shopMat = shopfrontMaterial(this.q); const m = new THREE.Mesh(mergeGeometries(shops), this.shopMat); m.receiveShadow = true; this.group.add(m); }
    if (awnings.length) { const m = new THREE.Mesh(mergeGeometries(awnings), awningMaterial(this.q)); m.castShadow = bShadow; m.receiveShadow = true; this.group.add(m); this.awningCount = awnings.length; }
    const rm = new THREE.Mesh(mergeGeometries(roofs.map(g => g.index ? g.toNonIndexed() : g).map(g => ensureUV(g))), roofMaterial(this.q));
    rm.receiveShadow = true; this.group.add(rm);
    if (slates.length) { const sm = new THREE.Mesh(mergeGeometries(slates), slateMaterial(this.q)); sm.castShadow = bShadow; sm.receiveShadow = true; this.group.add(sm); this.slateCount = slates.length; }
    if (parapets.length) { const pm = new THREE.Mesh(mergeGeometries(parapets), parapetMaterial(this.q)); pm.castShadow = bShadow; pm.receiveShadow = true; this.group.add(pm); }
    if (pilot.length) { const pm = new THREE.Mesh(mergeGeometries(pilot.map(g => ensureUV(g))), new THREE.MeshStandardMaterial({ map: cityTex(this.q, 'concrete'), color: 0xcfcbc2, roughness: 0.85 })); pm.castShadow = bShadow; pm.receiveShadow = true; this.group.add(pm); this.pilotCount = pilot.length; }
    if (plant.length) { const pl = new THREE.Mesh(mergeGeometries(plant.map(g => ensureUV(g))), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 })); pl.castShadow = bShadow; pl.receiveShadow = true; this.group.add(pl); }
  }
  // footprint sample points (every `st` m inside the polygon)
  _fpSamples(pts, st = 2) { const [x0, z0, x1, z1] = bbox(pts); const o = []; for (let x = x0 + st / 2; x < x1; x += st) for (let z = z0 + st / 2; z < z1; z += st) if (pointInPoly([x, z], pts)) o.push([x, z]); if (!o.length) o.push(centroid(pts)); return o; }
  // does a motorway / trunk / primary (or ring-road Queensway / Middleway) carriageway run under this footprint?
  majorUnder(pts) { for (const [x, z] of this._fpSamples(pts)) for (const s of (this.segGrid.get(Math.floor(x / 25) * 100000 + Math.floor(z / 25)) || [])) {
    if (!(/motorway|trunk|primary/.test(s.k) || /Queensway|Middleway/.test(s.nm || '')) || Math.max(s.h1, s.h2) < -1) continue; /* ring roads are tagged tertiary in places (Smallbrook) */ const dx = s.x2 - s.x1, dz = s.z2 - s.z1, L2 = dx * dx + dz * dz || 1; let t = ((x - s.x1) * dx + (z - s.z1) * dz) / L2; t = Math.max(0, Math.min(1, t));
    if (Math.hypot(x - s.x1 - dx * t, z - s.z1 - dz * t) < s.hw - 0.4) return true; } return false; }
  // is an OSM part with min_height `base` standing on another (lower) building part for most of its footprint?
  supportedPart(pts, base, self) { const [x0, z0, x1, z1] = bbox(pts); const cand = [];
    for (const q of this.d.buildings) { if (q === self || (q.mh || 0) >= base - 0.3 || q.h < base - 1) continue; let a = [1e9, 1e9, -1e9, -1e9]; for (let i = 0; i < q.p.length; i += 2) { const x = dm(q.p[i]), z = dm(q.p[i + 1]); a[0] = Math.min(a[0], x); a[1] = Math.min(a[1], z); a[2] = Math.max(a[2], x); a[3] = Math.max(a[3], z); }
      if (a[2] < x0 || a[0] > x1 || a[3] < z0 || a[1] > z1) continue; const qp = []; for (let i = 0; i < q.p.length; i += 2) qp.push([dm(q.p[i]), dm(q.p[i + 1])]); if ((q.mh || 0) <= 3 && this.blocksRoad(this.clearOfRoads(qp))) continue; qp.lm = !!q.lm; cand.push(qp); } // a part that is itself raised / removed holds nothing up
    if (!cand.length) return false; const S = this._fpSamples(pts); let n = 0, nl = 0; for (const p of S) { if (cand.some(c => pointInPoly(p, c))) n++; if (cand.some(c => c.lm && pointInPoly(p, c))) nl++; } return nl / S.length >= 0.5 ? 'lm' : n / S.length >= 0.5; } // 'lm': a duplicate of a hand-modelled landmark
  // columns for a raised base: along the footprint edges every ~6 m, 0.6 m inside, kept clear of every drivable surface
  // supports for a raised base: an edge whose whole length is clear of every drivable surface becomes a solid podium wall;
  // elsewhere 0.9 m columns every ~10 m, 0.6 m inside the edge, kept clear of every drivable surface
  pilotis(pts, base, step = 10) { const out = []; const cw = polyArea(pts) > 0 ? 1 : -1; void base;
    for (let i = 0; i < pts.length; i++) { const A = pts[i], B = pts[(i + 1) % pts.length]; const L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L < 0.5) continue;
      const nx = -(B[1] - A[1]) / L * cw, nz = (B[0] - A[0]) / L * cw;
      if (L >= 4) { const ns = Math.ceil(L / 1.5); let clear = true; for (let k = 0; k <= ns && clear; k++) { const t = k / ns, x = A[0] + (B[0] - A[0]) * t + nx * 0.3, z = A[1] + (B[1] - A[1]) * t + nz * 0.3; if (this.onAnyDrive(x, z, 0, -2.2)) clear = false; }
        if (clear) { const s = [A[0] + nx * 0.3, A[1] + nz * 0.3], e = [B[0] + nx * 0.3, B[1] + nz * 0.3]; const w = [s, e]; const c = [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2]; c.wall = w; out.push(c); continue; } }
      const n = Math.max(1, Math.round(L / step));
      for (let k = 0; k < n; k++) { const t = k / n; let x = A[0] + (B[0] - A[0]) * t, z = A[1] + (B[1] - A[1]) * t; x += nx * 0.8; z += nz * 0.8; if (!pointInPoly([x, z], pts)) { x -= nx * 1.6; z -= nz * 1.6; }
        if (!pointInPoly([x, z], pts) || this.onAnyDrive(x, z, 0, -1.2)) continue; out.push([x, z]); } }
    return out; }
  // is the ground under this footprint cut away for an open (roofless) sunken road?
  overCut(pts) { if (!this.tunnelSegs?.length) return false; if (!this._cutCells) { this._cutCells = new Set(); for (const s of this.tunnelSegs) if (!s.tun) for (let gx = Math.floor((Math.min(s.x1, s.x2) - 12) / 25); gx <= Math.floor((Math.max(s.x1, s.x2) + 12) / 25); gx++) for (let gz = Math.floor((Math.min(s.z1, s.z2) - 12) / 25); gz <= Math.floor((Math.max(s.z1, s.z2) + 12) / 25); gz++) this._cutCells.add(gx * 100000 + gz); }
    const [x0, z0, x1, z1] = bbox(pts); let any = false; for (let gx = Math.floor(x0 / 25); gx <= Math.floor(x1 / 25) && !any; gx++) for (let gz = Math.floor(z0 / 25); gz <= Math.floor(z1 / 25); gz++) if (this._cutCells.has(gx * 100000 + gz)) { any = true; break; }
    if (!any) return false; for (const [x, z] of this._fpSamples(pts, 1.5)) if (this.cutBelow(x, z)) return true; return false; }
  // is (x,z) inside any drivable area at street level (roads + race corridors), ignoring sunken roads
  streetDrivable(x, z) {
    const gx = Math.floor(x / 25), gz = Math.floor(z / 25);
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) for (const s of (this.driveGrid?.get((gx + ox) * 100000 + gz + oz) || [])) {
      if (Math.min(s.h1, s.h2) < -0.5) continue; const dx = s.x2 - s.x1, dz = s.z2 - s.z1, L2 = dx * dx + dz * dz || 1; let t = ((x - s.x1) * dx + (z - s.z1) * dz) / L2; t = Math.max(0, Math.min(1, t));
      if (Math.hypot(x - s.x1 - dx * t, z - s.z1 - dz * t) < s.hw - 0.4) return true;
    }
    return false;
  }
  blocksRoad(pts) {
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const p of pts) { x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[1]); x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[1]); }
    const seen = new Set(); let hits = 0;
    for (let gx = Math.floor(x0 / 25); gx <= Math.floor(x1 / 25); gx++) for (let gz = Math.floor(z0 / 25); gz <= Math.floor(z1 / 25); gz++) for (const s of (this.driveGrid.get(gx * 100000 + gz) || [])) {
      if (seen.has(s) || Math.max(s.h1, s.h2) < -1) continue; seen.add(s);
      const dx = s.x2 - s.x1, dz = s.z2 - s.z1, L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L, w = s.track === true ? s.hw : Math.max(0.5, s.hw - World.PAVEMENT - 0.15); // round 6: any overlap of the carriageway (service roads too)
      for (let a = 0; a <= L; a += 2) for (const o of [0, -0.45, 0.45, -0.8, 0.8]) {
        const x = s.x1 + dx * a / L + nx * o * w, z = s.z1 + dz * a / L + nz * o * w;
        if (x < x0 || x > x1 || z < z0 || z > z1) continue; if (pointInPoly([x, z], pts)) return s.track ? 'track' : o === 0 ? 'centre' : 'edge';
      }
      // a footprint edge slicing across the carriageway also blocks it
      for (let a = 0; a <= L; a += 2) { const cx = s.x1 + dx * a / L, cz = s.z1 + dz * a / L; if (cx < x0 - w || cx > x1 + w || cz < z0 - w || cz > z1 + w) continue;
        const ax = cx - nx * w * 0.95, az = cz - nz * w * 0.95, bx = cx + nx * w * 0.95, bz = cz + nz * w * 0.95;
        for (let i = 0; i < pts.length; i++) { const p1 = pts[i], p2 = pts[(i + 1) % pts.length]; if (segX(ax, az, bx, bz, p1[0], p1[1], p2[0], p2[1])) return s.track ? 'track' : 'edge'; } }
    }
    return false;
  }
  addBuildingCollider(pts, b) {
    const C = 25;
    if ((b.mh || 0) <= 3 && pts.length >= 3) { // footprint polygon for inside tests
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const p of pts) { x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[1]); x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[1]); }
      const poly = { pts, x0, z0, x1, z1, h: b.h || 80 }; this.pGrid = this.pGrid || new Map();
      for (let x = Math.floor(x0 / C); x <= Math.floor(x1 / C); x++) for (let z = Math.floor(z0 / C); z <= Math.floor(z1 / C); z++) { const k = x * 100000 + z; let a = this.pGrid.get(k); if (!a) this.pGrid.set(k, a = []); a.push(poly); }
    }
    for (let i = 0; i < (pts.length === 2 ? 1 : pts.length); i++) { // a 2-point wall (rail run) is one segment, not a closed loop (was registered twice)
      const a = pts[i], c = pts[(i + 1) % pts.length]; if (Math.abs(a[0] - c[0]) + Math.abs(a[1] - c[1]) < 0.02) continue;
      const s = { x1: a[0], z1: a[1], x2: c[0], z2: c[1], h: b.h, mh: b.mh || 0, src: b.parapet ? "parapet" : (b.lm || "bld") };
      const minx = Math.floor(Math.min(a[0], c[0]) / C), maxx = Math.floor(Math.max(a[0], c[0]) / C), minz = Math.floor(Math.min(a[1], c[1]) / C), maxz = Math.floor(Math.max(a[1], c[1]) / C);
      for (let x = minx; x <= maxx; x++) for (let z = minz; z <= maxz; z++) { const k = x * 100000 + z; let arr = this.bGrid.get(k); if (!arr) this.bGrid.set(k, arr = []); arr.push(s); }
    }
  }
  // ---------------- landmarks (hand-modelled from the OSM footprints) ------------------------------------
  buildLandmarks() {
    const find = k => this.buildingPolys.find(p => p.b.lm === k);
    const L = this.d.landmarks; const at = k => [dm(L[k][0]), dm(L[k][1])];
    const add = (geo, mat, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast && this.q.shadows >= 1; m.receiveShadow = true; this.group.add(m); return m; };
    const stone = new THREE.MeshStandardMaterial({ color: 0xd8cfbb, roughness: 0.8, map: this.F[2].t });
    // Rotunda: 81 m cylindrical tower - 20 storeys of square windows in a precast grid (original generated PBR), a recessed
    // glazed ground floor behind slim columns, a projecting first-floor band, lit crown band and rooftop plant drum
    { const p = find('rotunda'); const c = p ? centroid(p.pts) : at('rotunda'); const rr = p ? Math.sqrt(Math.abs(polyArea(p.pts)) / Math.PI) : 14;
      const seg = this.q.env >= 2 ? 64 : 48, circ = 2 * Math.PI * rr;
      const grid = lmPBR(this, 'rotunda_facade', Math.max(3, Math.round(circ / 18)), 3.5, { roughness: 1, metalness: 0.1, envMapIntensity: 1.2 });
      const cyl = new THREE.CylinderGeometry(rr, rr, 64, seg, 1, true); cyl.translate(c[0], 8.5 + 32, c[1]); add(cyl, grid);
      const conc = new THREE.MeshStandardMaterial({ color: 0xdedbd2, roughness: 0.8, map: this.F[2].t });
      const band = new THREE.CylinderGeometry(rr * 1.025, rr * 1.025, 1.6, seg); band.translate(c[0], 7.7, c[1]); add(band, conc); // first-floor band
      const top = new THREE.CylinderGeometry(rr * 1.02, rr * 1.02, 1.2, seg); top.translate(c[0], 73, c[1]); add(top, conc);
      const glass = new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.08, metalness: 0.8, envMapIntensity: 1.4 });
      const gf = new THREE.CylinderGeometry(rr * 0.9, rr * 0.9, 6.9, seg, 1, true); gf.translate(c[0], 3.45, c[1]); add(gf, glass); // recessed shop-front glazing
      { const cs = []; const nc = 20; for (let i = 0; i < nc; i++) { const a = i / nc * Math.PI * 2; const g = new THREE.CylinderGeometry(0.32, 0.32, 6.9, 8); g.translate(c[0] + Math.cos(a) * rr * 0.97, 3.45, c[1] + Math.sin(a) * rr * 0.97); cs.push(g.toNonIndexed()); } add(mergeGeometries(cs), conc); }
      const crown = new THREE.CylinderGeometry(rr * 1.03, rr * 1.03, 4.6, seg, 1, true); crown.translate(c[0], 76, c[1]); this.rotundaCrown = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, emissive: 0x88aaff, emissiveIntensity: 0.4, side: THREE.DoubleSide }); add(crown, this.rotundaCrown);
      const lid = new THREE.CylinderGeometry(rr * 1.03, rr * 1.03, 0.6, seg); lid.translate(c[0], 78.6, c[1]); add(lid, conc);
      const plant = new THREE.CylinderGeometry(rr * 0.55, rr * 0.6, 3, 24); plant.translate(c[0], 80.4, c[1]); add(plant, new THREE.MeshStandardMaterial({ color: 0x8d9095, roughness: 0.6, metalness: 0.3 }));
      this.addCircleCollider(c, rr); }
    // Selfridges: curving blue facade clad in aluminium discs
    { const p = find('selfridges'); if (p) {
        const t = this.tex(512, 512, (g, w, h) => { g.fillStyle = '#1b3d8f'; g.fillRect(0, 0, w, h); for (let y = 0; y < h + 20; y += 26) for (let x = ((y / 26) % 2) * 13; x < w + 20; x += 26) { const gr = g.createRadialGradient(x - 3, y - 3, 1, x, y, 11); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#c7ccd4'); gr.addColorStop(1, '#6d7580'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, 10, 0, 7); g.fill(); } });
        const geo = extrudeWalls(smoothPoly(p.pts, 3), 0, 24, 8, 8); void t; const m = add(geo, lmPBR(this, 'selfridges_discs', 1, 1, { metalness: 0.55, roughness: 0.8 })); // original generated PBR disc skin
        const top = roofCap(smoothPoly(p.pts, 3), 24); add(ensureUV(top.index ? top.toNonIndexed() : top), new THREE.MeshStandardMaterial({ color: 0x1b3d8f, roughness: 0.5 }));
      } }
    // Library of Birmingham: stacked boxes with gold/silver ring filigree
    { const p = find('library'); if (p) {
        const t = this.tex(512, 512, (g, w, h) => { g.fillStyle = '#1e2a33'; g.fillRect(0, 0, w, h); g.lineWidth = 5; for (let y = 0; y < h + 60; y += 56) for (let x = 0; x < w + 60; x += 56) { g.strokeStyle = (x + y) % 112 ? '#d4af37' : '#c0c4c8'; g.beginPath(); g.arc(x, y, 26, 0, 7); g.stroke(); g.beginPath(); g.arc(x + 28, y + 28, 14, 0, 7); g.stroke(); } });
        const c = centroid(p.pts); const tiers = [[0, 9, 1], [9, 19, 1.05], [19, 29, 0.93], [29, 34, 0.55]];
        void t; const gold = lmPBR(this, 'library_rings', 1, 1, { metalness: 0.5, roughness: 0.75 }); // original generated ring-filigree PBR
        for (const [y0, y1, s] of tiers) { const pp = p.pts.map(q => [c[0] + (q[0] - c[0]) * s, c[1] + (q[1] - c[1]) * s]); add(extrudeWalls(pp, y0, y1, 10, 10, y0), y0 === 0 ? new THREE.MeshStandardMaterial({ color: 0x2c3a44, roughness: 0.2, metalness: 0.6 }) : gold); add(ensureUV(roofCap(pp, y1)), stone); }
        const rot = new THREE.CylinderGeometry(4, 4, 5, 24); rot.translate(c[0], 36.5, c[1]); add(rot, new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.3 }));
      } }
    // Town Hall: Roman temple on a podium with Corinthian colonnade and pediment roof
    { const p = find('townhall'); if (p) {
        const obb = minRect(p.pts); const { c, ax, ay, hx, hy } = obb; const h = 22;
        const podium = boxOriented(c, ax, hx, hy, 0, 5); add(podium, stone); this.addBoxCollider(c, ax, hx, hy);
        const core = boxOriented(c, ax, hx * 0.86, hy * 0.82, 5, h); add(core, new THREE.MeshStandardMaterial({ color: 0xcfc6b3, roughness: 0.75 }));
        const cols = []; const n1 = Math.max(6, Math.round(hx * 2 / 3.2)), n2 = Math.max(4, Math.round(hy * 2 / 3.2));
        const pushCol = (u, v) => { const g = new THREE.CylinderGeometry(0.7, 0.8, h - 5, 12); g.translate(c[0] + ax[0] * u + ay[0] * v, 5 + (h - 5) / 2, c[1] + ax[1] * u + ay[1] * v); cols.push(g); };
        for (let i = 0; i < n1; i++) { const u = -hx * 0.95 + i * (hx * 1.9) / (n1 - 1); pushCol(u, hy * 0.95); pushCol(u, -hy * 0.95); }
        for (let i = 1; i < n2 - 1; i++) { const v = -hy * 0.95 + i * (hy * 1.9) / (n2 - 1); pushCol(hx * 0.95, v); pushCol(-hx * 0.95, v); }
        add(mergeGeometries(cols), stone);
        add(boxOriented(c, ax, hx, hy, h, h + 2), stone);
        add(gableOriented(c, ax, hx, hy, h + 2, 6), new THREE.MeshStandardMaterial({ color: 0x6e6f70, roughness: 0.8 }));
      } }
    // St Chad's Cathedral: red brick with twin west spires
    { const p = find('stchad'); if (p) {
        const brick = new THREE.MeshStandardMaterial({ map: this.F[1].t, color: 0xc07060, roughness: 0.9 });
        add(extrudeWalls(p.pts, 0, 18, 12, 10.5), brick); const obb = minRect(p.pts); add(gableOriented(obb.c, obb.ax, obb.hx, obb.hy, 18, 8), new THREE.MeshStandardMaterial({ color: 0x3f4a4f, roughness: 0.8 }));
        for (const s of [-1, 1]) { const x = obb.c[0] + obb.ax[0] * obb.hx * 0.9 + obb.ay[0] * s * obb.hy * 0.6, z = obb.c[1] + obb.ax[1] * obb.hx * 0.9 + obb.ay[1] * s * obb.hy * 0.6;
          const tw = new THREE.BoxGeometry(5, 26, 5); tw.translate(x, 13, z); add(tw, brick); this.addBoxCollider([x, z], [1, 0], 2.5, 2.5); const sp = new THREE.ConeGeometry(3.6, 20, 8); sp.translate(x, 36, z); add(sp, new THREE.MeshStandardMaterial({ color: 0x4a5a5e, roughness: 0.7 })); }
      } }
    // St Martin in the Bull Ring: sandstone church and spire
    { const p = find('stmartin'); if (p) { const sand = new THREE.MeshStandardMaterial({ map: this.F[2].t, color: 0xb58a6a, roughness: 0.9 });
        add(extrudeWalls(p.pts, 0, 16, 12, 8), lmPBR(this, 'stmartin_wall')); /* Gothic sandstone bays, traceried windows (original generated PBR) */ const obb = minRect(p.pts); const slate = new THREE.MeshStandardMaterial({ color: 0x3f4a4f, roughness: 0.8 }); add(ensureUV(roofCap(p.pts, 16)), slate); add(gableOriented(obb.c, obb.ax, obb.hx * 0.9, obb.hy * 0.55, 16, 6), slate); /* nave roof kept inside the walls (the bounding box overhung the aisles) */
        const x = obb.c[0] + obb.ax[0] * obb.hx * 0.85, z = obb.c[1] + obb.ax[1] * obb.hx * 0.85; const tw = new THREE.BoxGeometry(7, 30, 7); tw.translate(x, 15, z); add(tw, sand); this.addBoxCollider([x, z], [1, 0], 3.5, 3.5); const sp = new THREE.ConeGeometry(4.2, 30, 8); sp.translate(x, 45, z); add(sp, sand);
        // tower detail: belfry band with lancets, corner pinnacles and a weathervane cross at the spire tip
        { const bb = new THREE.BoxGeometry(7.3, 5, 7.3); bb.translate(x, 25, z); add(bb, lmPBR(this, 'stmartin_wall', 0.6, 0.6)); const pn = []; for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const c1 = new THREE.ConeGeometry(0.55, 5, 6); c1.translate(x + ox * 3.3, 32.5, z + oz * 3.3); pn.push(c1.toNonIndexed()); const c2 = new THREE.BoxGeometry(0.9, 2, 0.9); c2.translate(x + ox * 3.3, 31, z + oz * 3.3); pn.push(c2.toNonIndexed()); }
          add(mergeGeometries(pn.map(g => { g.deleteAttribute('uv'); return g; })), sand); const cr = new THREE.BoxGeometry(0.12, 1.6, 0.12); cr.translate(x, 60.8, z); const cb = new THREE.BoxGeometry(0.9, 0.12, 0.12); cb.translate(x, 61, z); add(mergeGeometries([cr, cb]), new THREE.MeshStandardMaterial({ color: 0xc9a54a, metalness: 0.9, roughness: 0.3 })); } } }
    // Council House with clock tower ("Big Brum")
    { const p = find('council'); if (p) { add(extrudeWalls(p.pts, 0, 20, 12, 10.5), new THREE.MeshStandardMaterial({ map: this.F[2].t, roughness: 0.8 })); add(ensureUV(roofCap(p.pts, 20)), new THREE.MeshStandardMaterial({ color: 0x5c6468 }));
        const c = centroid(p.pts); const tx = c[0] + 18, tz = c[1] + 6; const tw = new THREE.BoxGeometry(7, 48, 7); tw.translate(tx, 24, tz); add(tw, stone); this.addBoxCollider([tx, tz], [1, 0], 3.5, 3.5);
        const clk = this.tex(128, 128, (g) => { g.fillStyle = '#f2efe6'; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.fill(); g.strokeStyle = '#111'; g.lineWidth = 6; g.beginPath(); g.moveTo(64, 64); g.lineTo(64, 20); g.moveTo(64, 64); g.lineTo(95, 70); g.stroke(); }, false);
        for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.CircleGeometry(2.6, 24), new THREE.MeshStandardMaterial({ map: clk })); const a = i * Math.PI / 2; f.position.set(tx + Math.sin(a) * 3.55, 42, tz + Math.cos(a) * 3.55); f.rotation.y = a; this.group.add(f); }
        const cap = new THREE.ConeGeometry(5, 8, 4); cap.rotateY(Math.PI / 4); cap.translate(tx, 52, tz); add(cap, new THREE.MeshStandardMaterial({ color: 0x5b6d63 })); } }
    // BT Tower (visible landmark to the north-west)
    { const c = at('bttower').slice(); // approximate point: slide it off any carriageway onto its plot
      for (let it = 0; it < 12; it++) { const n = this.nearestRoad(c[0], c[1]); if (!n || n.d > n.hw + 9) break; const ux = (c[0] - n.px) / (n.d || 1), uz = (c[1] - n.pz) / (n.d || 1); c[0] = n.px + ux * (n.hw + 9.5); c[1] = n.pz + uz * (n.hw + 9.5); }
      const t = new THREE.CylinderGeometry(6, 7, 140, 20); t.translate(c[0], 70, c[1]); add(t, new THREE.MeshStandardMaterial({ color: 0xb9b6ae, roughness: 0.8 }));
      for (const y of [100, 112, 124]) { const r = new THREE.CylinderGeometry(9, 9, 5, 20); r.translate(c[0], y, c[1]); add(r, new THREE.MeshStandardMaterial({ color: 0xdedbd2 })); }
      const m = new THREE.CylinderGeometry(0.6, 0.6, 30, 6); m.translate(c[0], 155, c[1]); add(m, new THREE.MeshStandardMaterial({ color: 0xd33 })); this.addCircleCollider(c, 7.5); }
    // Grand Central / New Street: mirrored stainless-steel skin (original generated PBR: pixelated curved panels) that
    // bulges out over a recessed, glazed ground floor; an inward-raking lower lip, a dark roof band and lit entrance slots
    { const gc = this.d.buildings.find(b => b.lm === 'grandcentral');
      if (gc) { const pts = []; for (let i = 0; i < gc.p.length; i += 2) pts.push([dm(gc.p[i]), dm(gc.p[i + 1])]); const H = Math.max(14, gc.h);
        const steel = lmPBR(this, 'grandcentral_steel', 1, 1, { metalness: 1, roughness: 0.55, envMapIntensity: 1.7, color: 0xe4e8ec });
        const g = extrudeWalls(pts, 5.2, H, 9, 9, 5.2); const m = add(g, steel); m.position.y += 0.02;
        const cc = centroid(pts), sc = (q, k) => [cc[0] + (q[0] - cc[0]) * k, cc[1] + (q[1] - cc[1]) * k];
        const ext = Math.max(...pts.map(q => Math.hypot(q[0] - cc[0], q[1] - cc[1]))) || 50; const ki = 1 - 2.2 / ext; // ~2.2 m recess
        const lip = extrudeWalls(pts.map(q => sc(q, 1 - 0.9 / ext)), 4.2, 5.2, 9, 1, 4.2); add(lip, steel); // raked lower edge of the skin
        const gl = extrudeWalls(pts.map(q => sc(q, ki)), 0, 4.2, 4, 4.2); this.gcGlass = new THREE.MeshStandardMaterial({ color: 0x18222a, roughness: 0.06, metalness: 0.7, emissive: 0xffe2b0, emissiveIntensity: 0, envMapIntensity: 1.3 }); add(gl, this.gcGlass);
        const sof = roofCap(pts, 4.2); const sg = ensureUV(sof.index ? sof.toNonIndexed() : sof); const pa = sg.attributes.position.array; for (let i = 0; i < pa.length; i += 9) for (let k = 0; k < 3; k++) { const t = pa[i + 3 + k]; pa[i + 3 + k] = pa[i + 6 + k]; pa[i + 6 + k] = t; } sg.deleteAttribute('normal'); sg.computeVertexNormals(); add(sg, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5, metalness: 0.6 }), false);
        const rb = extrudeWalls(pts.map(q => sc(q, 1 - 0.4 / ext)), H, H + 1.2, 9, 1.2, H); add(rb, new THREE.MeshStandardMaterial({ color: 0x2d3338, roughness: 0.5, metalness: 0.4 })); } }
    buildEastLandmarks(this); // St Andrew's, Asda Small Heath, Central Mosque, Ghamkol Sharif, Green Lane Masjid
  }
  addBoxCollider(c, ax, hx, hy) { const ay = [-ax[1], ax[0]]; this.addBuildingCollider([[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([u, v]) => [c[0] + ax[0] * hx * u + ay[0] * hy * v, c[1] + ax[1] * hx * u + ay[1] * hy * v]), { h: 40, lm: 'landmark' }); }
  addCircleCollider(c, r, n = 24) { const pts = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; pts.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]); } this.addBuildingCollider(pts, { h: 80, lm: 'post' }); }
  // ---------------- street furniture ------------------------------------------------------------------------
  buildFurniture() {
    const rnd = mulberry(11); const dummy = new THREE.Object3D();
    // trees: OSM trees + random in parks
    const onCarriageway = (x, z) => this.onAnyDrive(x, z, 0, -0.5); // OSM trees/bollards sometimes sit on the road line (or a race lane): drop them
    const trees = this.d.trees.map(t => [dm(t[0]), dm(t[1])]).filter(p => !onCarriageway(p[0], p[1]));
    for (const a of this.d.areas) if (a.k === 'green') { const pts = []; for (let i = 0; i < a.p.length; i += 2) pts.push([dm(a.p[i]), dm(a.p[i + 1])]); const area = Math.abs(polyArea(pts)); const n = Math.min(40, area / 250); const bb = bbox(pts); for (let i = 0; i < n; i++) { const p = [bb[0] + rnd() * (bb[2] - bb[0]), bb[1] + rnd() * (bb[3] - bb[1])]; if (pointInPoly(p, pts)) trees.push(p); } }
    { const keep = trees.filter(p => !onCarriageway(p[0], p[1])); trees.length = 0; trees.push(...keep); }
    const maxT = [500, 1500, 3000, 6000][this.q.env] || 1500; trees.length = Math.min(trees.length, maxT);
    const TP = treeParts(this.q, rnd);
    const tI = new THREE.InstancedMesh(TP.trunk, TP.bark, trees.length);
    const cI = new THREE.InstancedMesh(TP.crown, TP.crownMat, trees.length);
    const kI = TP.cards ? new THREE.InstancedMesh(TP.cards, TP.cardMat, trees.length) : null;
    const col = new THREE.Color();
    trees.forEach((p, i) => { const s = 0.75 + rnd() * 0.6; dummy.position.set(p[0], 0, p[1]); dummy.rotation.y = rnd() * 6; dummy.scale.set(s, s * (0.9 + rnd() * 0.25), s); dummy.updateMatrix(); tI.setMatrixAt(i, dummy.matrix); cI.setMatrixAt(i, dummy.matrix); if (kI) kI.setMatrixAt(i, dummy.matrix); col.setHSL(0.22 + rnd() * 0.07, 0.35 + rnd() * 0.2, 0.62 + rnd() * 0.22); cI.setColorAt(i, col); if (kI) kI.setColorAt(i, col); });
    if (kI) { kI.castShadow = this.q.shadows >= 1; this.group.add(kI); }
    cI.castShadow = tI.castShadow = this.q.shadows >= 2 || (this.q.shadows >= 1 && this.q.env >= 2); this.group.add(tI, cI);
    for (const p of trees) this.addCircleCollider(p, 0.35);
    // street lamps every ~32 m along major roads + OSM lamps
    const lamps = this.d.lamps.map(l => [dm(l[0]), dm(l[1]), 0]);
    for (const { r, P, hw, hid } of this.edges) { if (hid) continue;
      if (!/motorway|trunk|primary|secondary/.test(r.k) || r.tun || P[0][2] < -0.5) continue;
      const L = P[P.length - 1][3];
      for (let a = 10; a < L - 5; a += 32) { const s = pointAt(P, a); const side = r.ow ? -1 : ((a / 32) % 2 < 1 ? -1 : 1); lamps.push([s[0] + s[3] * side * (hw + 1.2), s[1] + s[4] * side * (hw + 1.2), Math.atan2(s[3] * side, s[4] * side)]); }
    }
    const maxL = [600, 2400, 4000, 6000][this.q.env] || 2400; // instanced: a few thousand posts cost one draw each for post/head/glow
    { const keep = lamps.filter(l => !this.onAnyDrive(l[0], l[1], 0, -0.4)); lamps.length = 0; lamps.push(...keep); } // never a lamp post on a road
    lamps.length = Math.min(lamps.length, maxL);
    const pole = new THREE.CylinderGeometry(0.08, 0.12, 8, 6); pole.translate(0, 4, 0);
    const arm = new THREE.BoxGeometry(0.1, 0.1, 1.6); arm.translate(0, 7.9, -0.75);
    const head = new THREE.BoxGeometry(0.35, 0.12, 0.7); head.translate(0, 7.85, -1.5);
    const lampG = mergeGeometries([pole, arm].map(g => g.toNonIndexed()));
    const lI = new THREE.InstancedMesh(lampG, new THREE.MeshStandardMaterial({ color: 0x5b6066, metalness: 0.7, roughness: 0.4 }), lamps.length);
    this.lampHeadMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffc98a, emissiveIntensity: 0 });
    const hI = new THREE.InstancedMesh(head, this.lampHeadMat, lamps.length);
    lamps.forEach((l, i) => { dummy.position.set(l[0], 0, l[1]); dummy.rotation.set(0, l[2] + Math.PI, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); lI.setMatrixAt(i, dummy.matrix); hI.setMatrixAt(i, dummy.matrix); });
    this.group.add(lI, hI); this.lampPositions = lamps; for (const l of lamps) this.addCircleCollider(l, 0.14, 8); // every visible post is solid
    // night: a soft warm pool of light on the ground under every lamp head (additive decal, one instanced draw; the few
    // nearest lamps also get a real point light in Gfx.updateNightLights). Asda car-park lamps included.
    { const spots = lamps.map(l => { const th = l[2] + Math.PI; return [l[0] - 1.5 * Math.sin(th), l[1] - 1.5 * Math.cos(th)]; }).concat(this.asdaLamps || []);
      const gt = this.tex(128, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.55)'); gr.addColorStop(0.7, 'rgba(255,255,255,.15)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }, false);
      const gp = new THREE.PlaneGeometry(15, 15); gp.rotateX(-Math.PI / 2);
      const gm = new THREE.MeshBasicMaterial({ map: gt, color: new THREE.Color(0xffb866).multiplyScalar(0.42), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -16 });
      const gI = new THREE.InstancedMesh(gp, gm, spots.length); spots.forEach((q, i) => { dummy.position.set(q[0], 0.07, q[1]); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); gI.setMatrixAt(i, dummy.matrix); });
      gI.renderOrder = 3; gI.name = 'lampGlow'; gm.visible = false; this.lampGlowMat = gm; this.group.add(gI); this.lampSpots = spots; } // chunkWorld splits the instances per cell: toggle the shared material
    // traffic signals (3-aspect heads), cycling red → red/amber → green → amber (UK sequence)
    const sig = [];
    for (const s0 of this.d.signals) { const s = [dm(s0[0]), dm(s0[1])]; if (this.surfaceHeight(s[0], s[1], 5) <= -0.5) continue; const near = this.nearestRoad(s[0], s[1]);
      const x = s[0] + (near ? near.nx * (near.hw + 0.8) : 0), z = s[1] + (near ? near.nz * (near.hw + 0.8) : 0); if (this.onAnyDrive(x, z, 0, -0.4)) continue; // a post on the road would block it
      sig.push([x, z, near ? Math.atan2(near.dx, near.dz) : 0]); }
    this.signalPositions = sig; for (const s of sig) this.addCircleCollider(s, 0.1, 8);
    const sp = new THREE.CylinderGeometry(0.07, 0.07, 3.4, 6); sp.translate(0, 1.7, 0);
    const box = new THREE.BoxGeometry(0.34, 0.95, 0.26); box.translate(0, 3.2, 0);
    const sI = new THREE.InstancedMesh(mergeGeometries([sp.toNonIndexed(), box.toNonIndexed()]), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 }), sig.length);
    const lens = (y) => { const g = new THREE.CircleGeometry(0.1, 12); g.translate(0, y, 0.135); return g; };
    this.sigMats = [0xff2a1a, 0xffa000, 0x1aff5a].map(c => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: c, emissiveIntensity: 0 }));
    const lensI = [3.5, 3.2, 2.9].map((y, k) => new THREE.InstancedMesh(lens(y), this.sigMats[k], sig.length));
    sig.forEach((s, i) => { dummy.position.set(s[0], 0, s[1]); dummy.rotation.set(0, s[2] + Math.PI, 0); dummy.updateMatrix(); sI.setMatrixAt(i, dummy.matrix); lensI.forEach(l => l.setMatrixAt(i, dummy.matrix)); });
    this.group.add(sI, ...lensI);
    // bollards & benches around pedestrian squares (Victoria Square / Centenary Square)
    const bl = []; for (const p of this.d.peds) { if (p.l) continue; for (let i = 0; i < p.p.length; i += 8) { const q = [dm(p.p[i]), dm(p.p[i + 1])]; if (!onCarriageway(q[0], q[1])) bl.push(q); } }
    const bI = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.12, 1, 8).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.5, roughness: 0.4 }), bl.length);
    bl.forEach((p, i) => { dummy.position.set(p[0], 0, p[1]); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); bI.setMatrixAt(i, dummy.matrix); this.addCircleCollider(p, 0.2); }); this.group.add(bI);
    // pedestrian squares get a paler stone surface (drivable only on closed race routes)
    const pg = []; for (const p of this.d.peds) if (!p.l) { const pts = []; for (let i = 0; i < p.p.length; i += 2) pts.push(new THREE.Vector2(dm(p.p[i]), dm(p.p[i + 1]))); const g = flatPoly(pts, 0.01, 6); if (g) pg.push(g); }
    // street clutter on the pavements (bins, K6 phone boxes, pillar boxes, cabinets, benches, bus shelters): visual only, placed clear of every drivable surface
    if (this.q.env >= 1) this.clutterCount = buildClutter(this, this.group, this.q);
    if (pg.length) this.group.add(new THREE.Mesh(mergeGeometries(pg), new THREE.MeshStandardMaterial({ map: cityTex(this.q, 'stone'), color: 0xf0ebe2, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -2 })));
  }
  buildSkyline() { // distant silhouettes beyond the mapped area: windowed blocks and towers that fade into the haze
    const rnd = mulberry(5); const g = []; const [x0, z0, x1, z1] = this.d.bounds.map(dm); const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2; const R = Math.max(x1 - x0, z1 - z0) * 0.75 + 200;
    const pal = [0x8b8f96, 0x9a8a7c, 0x7d8590, 0xa39d92, 0x6f7a86, 0xb0a898, 0x5f6b78].map(c => new THREE.Color(c));
    const n = [200, 300, 420, 520][this.q.env] || 300;
    for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, r = R + rnd() * 900; const tower = rnd() < 0.08; const w = tower ? 18 + rnd() * 16 : 15 + rnd() * 40, h = tower ? 60 + rnd() * 70 : 8 + rnd() * (rnd() < 0.15 ? 45 : 22);
      const b = skylineBox(w, h, w * (0.6 + rnd()), pal[rnd() * pal.length | 0]); b.rotateY(rnd() * 3); b.translate(cx + Math.cos(a) * r, h / 2, cz + Math.sin(a) * r); g.push(b); }
    this.group.add(new THREE.Mesh(mergeGeometries(g), skylineMaterial(this.q)));
    const hills = new THREE.CylinderGeometry(R + 2600, R + 2600, 120, 64, 1, true); hills.translate(cx, 20, cz);
    this.group.add(new THREE.Mesh(hills, new THREE.MeshBasicMaterial({ color: 0x55606a, side: THREE.BackSide, fog: true })));
  }
  // ---------------- queries ------------------------------------------------------------------------------------
  segsNear(x, z) { const C = 25; return this.segGrid.get(Math.floor(x / C) * 100000 + Math.floor(z / C)) || []; }
  // returns {h, onRoad, seg, lat} for the road surface nearest to yRef
  surfaceHeight(x, z, yRef = 0) {
    let best = null, bestScore = 1e9;
    for (const s of this.segsNear(x, z)) {
      const dx = s.x2 - s.x1, dz = s.z2 - s.z1, L2 = dx * dx + dz * dz || 1; let t = ((x - s.x1) * dx + (z - s.z1) * dz) / L2; t = Math.max(0, Math.min(1, t));
      const px = s.x1 + dx * t, pz = s.z1 + dz * t, d = Math.hypot(x - px, z - pz);
      if (d > s.hw) continue; const h = s.h1 + (s.h2 - s.h1) * t;
      const score = Math.abs(h - yRef) + (h > yRef + 1.5 ? 100 : 0);
      if (score < bestScore) { bestScore = score; best = h; }
    }
    return best == null ? 0 : best;
  }
  groundAt(x, z, yRef) {
    let best = null, bestScore = 1e9, bs = null;
    for (const s of this.segsNear(x, z)) {
      const dx = s.x2 - s.x1, dz = s.z2 - s.z1, L2 = dx * dx + dz * dz || 1; let t = ((x - s.x1) * dx + (z - s.z1) * dz) / L2; t = Math.max(0, Math.min(1, t));
      const px = s.x1 + dx * t, pz = s.z1 + dz * t, d = Math.hypot(x - px, z - pz);
      if (d > s.hw + 0.2) continue; const h = s.h1 + (s.h2 - s.h1) * t;
      const score = Math.abs(h - yRef) + (h > yRef + 1.6 ? 100 : 0);
      if (score < bestScore) { bestScore = score; best = h; bs = s; }
    }
    if (best == null) return { h: yRef < -1 ? null : 0, road: false };
    if (yRef > best + 3 && best < -1) return { h: bs.tun ? 0 : best, road: !bs.tun, seg: bs.tun ? undefined : bs, fall: !bs.tun }; // above a covered tunnel = street level; above an open cutting = fall in
    return { h: best, road: true, seg: bs };
  }
  nearestRoad(x, z, below = false, yRef = null) {
    let best = null, bd = 1e9;
    const C = 25;
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) for (const s of (this.segGrid.get((Math.floor(x / C) + ox) * 100000 + Math.floor(z / C) + oz) || [])) {
      if (below && Math.min(s.h1, s.h2) > -0.5) continue;
      const dx = s.x2 - s.x1, dz = s.z2 - s.z1, L2 = dx * dx + dz * dz || 1; let t = ((x - s.x1) * dx + (z - s.z1) * dz) / L2; t = Math.max(0, Math.min(1, t));
      if (yRef != null && Math.abs(s.h1 + (s.h2 - s.h1) * t - yRef) > 1.5) continue; // same level only (not the tunnel underneath)
      const px = s.x1 + dx * t, pz = s.z1 + dz * t, d = Math.hypot(x - px, z - pz);
      if (d < bd) { const l = Math.sqrt(L2); bd = d; best = { d, px, pz, h: s.h1 + (s.h2 - s.h1) * t, hw: s.hw - 0.4, dx: dx / l, dz: dz / l, nx: -dz / l, nz: dx / l, seg: s }; }
    }
    return best;
  }
  // circle vs building walls → push-out vector and wall normal
  collide(x, z, r, y) {
    if (y < -1.2) return null; // below ground: tunnel walls handled separately
    const C = 25; let px = 0, pz = 0, hit = false, nx = 0, nz = 0;
    const seen = new Set();
    for (const G of this.raceGrid ? [this.bGrid, this.raceGrid] : [this.bGrid]) for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) for (const s of (G.get((Math.floor(x / C) + ox) * 100000 + Math.floor(z / C) + oz) || [])) {
      if (seen.has(s)) continue; seen.add(s);
      if (s.mh > 3) continue; // raised structures (canopies) do not block
      if (s.inx !== undefined && (x - s.x1) * s.inx + (z - s.z1) * s.inz < -0.2) continue; // race barriers only hold cars IN: never trap anyone outside the track
      if (s.ti !== undefined && this._tiFar(s, x, z)) continue;
      const dx = s.x2 - s.x1, dz = s.z2 - s.z1, L2 = dx * dx + dz * dz || 1; let t = ((x - s.x1) * dx + (z - s.z1) * dz) / L2; t = Math.max(0, Math.min(1, t));
      const cx = s.x1 + dx * t, cz = s.z1 + dz * t; let ddx = x - cx, ddz = z - cz; const d = Math.hypot(ddx, ddz);
      if (d < r) { const k = (r - d) / (d || 1); px += ddx * k; pz += ddz * k; nx += ddx / (d || 1); nz += ddz / (d || 1); hit = true; }
    }
    if (!hit) return null; const l = Math.hypot(nx, nz) || 1; return { px, pz, nx: nx / l, nz: nz / l };
  }
  // building footprint containing (x,z), if any
  insideBuilding(x, z, y) {
    if (y < -1.2) return null; const a = this.pGrid?.get(Math.floor(x / 25) * 100000 + Math.floor(z / 25)); if (!a) return null;
    for (const P of a) { if (x < P.x0 || x > P.x1 || z < P.z0 || z > P.z1 || y > P.h) continue; if (pointInPoly([x, z], P.pts)) return P; }
    return null;
  }
  // nearest point on a polygon's boundary
  polyEdge(P, x, z) {
    let best = null, bd = 1e9; const pts = P.pts;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], c = pts[(i + 1) % pts.length]; const dx = c[0] - a[0], dz = c[1] - a[1], L2 = dx * dx + dz * dz || 1; let t = ((x - a[0]) * dx + (z - a[1]) * dz) / L2; t = Math.max(0, Math.min(1, t)); const px = a[0] + dx * t, pz = a[1] + dz * t, d = Math.hypot(x - px, z - pz); if (d < bd) { bd = d; best = { px, pz, d }; } }
    return best;
  }
  // first building wall crossed moving from (x0,z0) to (x1,z1): stops cars tunnelling through thin walls at speed
  wallCross(x0, z0, x1, z1, y) {
    if (y < -1.2) return null; const C = 25, seen = new Set(); let hit = null, bt = 2;
    for (const G of this.raceGrid ? [this.bGrid, this.raceGrid] : [this.bGrid]) for (const [x, z] of [[x0, z0], [x1, z1]]) for (const s of (G.get(Math.floor(x / C) * 100000 + Math.floor(z / C)) || [])) {
      if (seen.has(s) || s.mh > 3) continue; seen.add(s);
      if (s.inx !== undefined && (x0 - s.x1) * s.inx + (z0 - s.z1) * s.inz < 0) continue; // crossing a race barrier from outside back onto the track is allowed
      if (s.ti !== undefined && this._tiFar(s, x0, z0)) continue;
      const rx = x1 - x0, rz = z1 - z0, sx = s.x2 - s.x1, sz = s.z2 - s.z1, den = rx * sz - rz * sx; if (Math.abs(den) < 1e-9) continue;
      const t = ((s.x1 - x0) * sz - (s.z1 - z0) * sx) / den, u = ((s.x1 - x0) * rz - (s.z1 - z0) * rx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && t < bt) { bt = t; const l = Math.hypot(sx, sz) || 1; let nx = -sz / l, nz = sx / l; if (nx * rx + nz * rz < 0) { nx = -nx; nz = -nz; } hit = { t, nx, nz, src: s.src }; }
    }
    return hit;
  }
  inTunnel(x, z, y) { if (y > -1.5) return 0; const n = this.nearestRoad(x, z, true); return n && n.seg.tun ? 1 : 0.4; }
  update(t, night, rain) {
    if (this.sigMats) { const ph = (t % 24); const red = ph < 10, ra = ph >= 10 && ph < 12, green = ph >= 12 && ph < 21, amb = ph >= 21; this.sigMats[0].emissiveIntensity = red || ra ? 2.5 : 0.05; this.sigMats[1].emissiveIntensity = ra || amb ? 2.5 : 0.05; this.sigMats[2].emissiveIntensity = green ? 2.5 : 0.05; }
    if (this.lampHeadMat) this.lampHeadMat.emissiveIntensity = night ? 6 : 0; // lamp lenses: bright enough to bloom on High
    if (this.parkLampMat) this.parkLampMat.emissiveIntensity = night ? 6 : 0; // Asda car-park lamps
    if (this.nightMats) for (const [m, k] of this.nightMats) m.emissiveIntensity = night ? k : 0;
    if (this.lampGlowMat) this.lampGlowMat.visible = !!night; // warm light pools under every lamp
    if (this.shopMat) this.shopMat.emissive.setScalar(night ? 1.1 : 0);
    if (this.facadeNight) this.facadeNight.value = night ? 1 : 0;
    if (this.rotundaCrown) this.rotundaCrown.emissiveIntensity = night ? 2.5 : 0.3;
    if (this.gcGlass) this.gcGlass.emissiveIntensity = night ? 0.35 : 0; // Grand Central: lit concourse behind the glazing
    if (this.floodMat) { this.floodMat.emissiveIntensity = night ? 3 : 0; this.floodMat.color.setHex(night ? 0xffffff : 0x8e9399); } // St Andrew's floodlights
    // wet road: water film darkens the asphalt and makes it near-mirror smooth (roughness map keeps drier patches rougher),
    // so the sky, headlights and street lamps reflect at the grazing driving angle (Fresnel)
    if (this.roadMats) for (const m of this.roadMats) { if (!m.userData.c0) m.userData.c0 = m.color.clone();
      m.color.copy(m.userData.c0).multiplyScalar(rain ? 0.5 : 1); m.roughness = rain ? 0.3 : 1; m.metalness = rain ? 0.02 : 0; m.envMapIntensity = rain ? 0.6 : 0.3; }
    if (this.markMat) this.markMat.roughness = rain ? 0.3 : 0.6;
    if (this.groundMat) { if (!this.groundMat.userData.c0) this.groundMat.userData.c0 = this.groundMat.color.clone(); this.groundMat.color.copy(this.groundMat.userData.c0).multiplyScalar(rain ? 0.75 : 1); this.groundMat.roughness = rain ? 0.45 : 0.9; }
  }
}

// Split city-wide merged meshes and instanced meshes into ~300 m cells so the renderer can frustum-cull them
// (for the main camera and for the shadow camera). Without this every building is drawn every frame.
export function chunkWorld(group, cell) {
  const key = (x, z) => Math.floor(x / cell) + ',' + Math.floor(z / cell);
  for (const m of [...group.children]) {
    if (m.isInstancedMesh) {
      if (m.count < 50) continue; const buckets = new Map(); const mat = new THREE.Matrix4(); const col = new THREE.Color();
      for (let i = 0; i < m.count; i++) { m.getMatrixAt(i, mat); const k = key(mat.elements[12], mat.elements[14]); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(i); }
      if (buckets.size < 2) continue;
      for (const ids of buckets.values()) { const n = new THREE.InstancedMesh(m.geometry, m.material, ids.length); ids.forEach((id, j) => { m.getMatrixAt(id, mat); n.setMatrixAt(j, mat); if (m.instanceColor) { m.getColorAt(id, col); n.setColorAt(j, col); } }); n.castShadow = m.castShadow; n.receiveShadow = m.receiveShadow; n.renderOrder = m.renderOrder; n.computeBoundingSphere(); group.add(n); }
      group.remove(m); continue;
    }
    if (!m.isMesh || !m.geometry) continue;
    let g = m.geometry; if (!g.boundingBox) g.computeBoundingBox(); const bb = g.boundingBox;
    if (bb.max.x - bb.min.x < cell * 1.5 && bb.max.z - bb.min.z < cell * 1.5) continue;
    if (g.index) g = g.toNonIndexed();
    const pos = g.attributes.position; const tri = pos.count / 3; const buckets = new Map();
    for (let t = 0; t < tri; t++) { const i = t * 3; const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3; const k = key(cx, cz); let b = buckets.get(k); if (!b) { b = []; buckets.set(k, b); } b.push(t); }
    if (buckets.size < 2) continue;
    const names = Object.keys(g.attributes);
    for (const tris of buckets.values()) {
      const ng = new THREE.BufferGeometry();
      for (const nm of names) { const a = g.attributes[nm]; const is = a.itemSize; const out = new a.array.constructor(tris.length * 3 * is); let o = 0; for (const t of tris) { const src = t * 3 * is; for (let j = 0; j < 3 * is; j++) out[o++] = a.array[src + j]; } ng.setAttribute(nm, new THREE.BufferAttribute(out, is, a.normalized)); }
      ng.computeBoundingSphere(); ng.computeBoundingBox();
      const n = new THREE.Mesh(ng, m.material); n.castShadow = m.castShadow; n.receiveShadow = m.receiveShadow; n.renderOrder = m.renderOrder; group.add(n);
    }
    group.remove(m); g.dispose(); m.geometry.dispose();
  }
}

// ======================= geometry helpers ============================================================
export function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function polyArea(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
function centroid(p) { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; }
function bbox(p) { let a = [1e9, 1e9, -1e9, -1e9]; for (const q of p) { a[0] = Math.min(a[0], q[0]); a[1] = Math.min(a[1], q[1]); a[2] = Math.max(a[2], q[0]); a[3] = Math.max(a[3], q[1]); } return a; }
export function pointInPoly(pt, poly) { let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > pt[1]) !== (zj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - zi) / (zj - zi) + xi) ins = !ins; } return ins; }
function ensureUV(g) { if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); if (g.index) g = g.toNonIndexed(); return g; }
function flatPoly(pts2, y, tile) {
  if (pts2.length < 3) return null; let tri; try { tri = THREE.ShapeUtils.triangulateShape(pts2, []); } catch (e) { return null; } if (!tri.length) return null;
  const pos = [], uv = []; for (const t of tri) for (const k of [t[0], t[2], t[1]]) { const p = pts2[k]; pos.push(p.x, y, p.y); uv.push(p.x / tile, p.y / tile); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) { const p = g.attributes.position; for (let i = 0; i < p.count; i += 3) { const x = p.getX(i + 1), yy = p.getY(i + 1), z = p.getZ(i + 1); p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)); p.setXYZ(i + 2, x, yy, z); } g.computeVertexNormals(); }
  return g;
}
function roofCap(pts, h) { const v = pts.map(p => new THREE.Vector2(p[0], p[1])); return flatPoly(v, h, 10) || new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3)).setAttribute('uv', new THREE.Float32BufferAttribute([], 2)).setAttribute('normal', new THREE.Float32BufferAttribute([], 3)); }
function extrudeWalls(pts, y0, y1, tileW, tileH, vOff = 0) {
  const pos = [], uv = []; let u = 0; const n = pts.length; const cw = polyArea(pts) > 0;
  for (let i = 0; i < n; i++) {
    let a = pts[i], b = pts[(i + 1) % n]; if (!cw) { } const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const u2 = u + len / tileW;
    const v0 = (y0 - vOff) / tileH, v1 = (y1 - vOff) / tileH;
    const A = [a[0], y0, a[1]], B = [b[0], y0, b[1]], C = [b[0], y1, b[1]], D = [a[0], y1, a[1]];
    const order = cw ? [A, C, B, A, D, C] : [A, B, C, A, C, D]; const uvs = cw ? [[u, v0], [u2, v1], [u2, v0], [u, v0], [u, v1], [u2, v1]] : [[u, v0], [u2, v0], [u2, v1], [u, v0], [u2, v1], [u, v1]];
    order.forEach((p, k) => { pos.push(...p); uv.push(...uvs[k]); }); u = u2;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); return g;
}
function smoothPoly(pts, iters) { let p = pts; for (let k = 0; k < iters; k++) { const q = []; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); } p = q; } return p; }
// road ribbon with per-vertex heights; P = [[x,z,h,s]...]
function segX(ax, az, bx, bz, cx, cz, dx, dz) {
  const r1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax), r2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax), r3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx), r4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  return r1 * r2 < 0 && r3 * r4 < 0;
}
function offsetPt(Q, i, o) {
  const a = Q[Math.max(0, i - 1)], b = Q[Math.min(Q.length - 1, i + 1)]; let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  return [Q[i][0] - dz * o, Q[i][1] + dx * o, Q[i][2], Q[i][3]];
}
function ribbonVar(P, hws, lift, tile) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)]; let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const nx = -dz, nz = dx, hw = hws[i];
    pos.push(P[i][0] + nx * hw, P[i][2] + lift, P[i][1] + nz * hw, P[i][0] - nx * hw, P[i][2] + lift, P[i][1] - nz * hw);
    uv.push(0, P[i][3] / tile, hw * 2 / tile, P[i][3] / tile);
    if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
  return g.toNonIndexed();
}
function ribbon(P, hw, lift, tile) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)]; let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const nx = -dz, nz = dx; const ext = (i === 0 || i === P.length - 1) ? hw * 0.5 : 0; const ex = (i === 0 ? -1 : i === P.length - 1 ? 1 : 0) * ext;
    pos.push(P[i][0] + nx * hw + dx * ex, P[i][2] + lift, P[i][1] + nz * hw + dz * ex, P[i][0] - nx * hw + dx * ex, P[i][2] + lift, P[i][1] - nz * hw + dz * ex);
    uv.push(0, P[i][3] / tile, hw * 2 / tile, P[i][3] / tile);
    if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
  return g.toNonIndexed();
}
function slicePath(P, a, b) {
  const out = []; if (b <= a) return out;
  for (let i = 0; i < P.length - 1; i++) {
    const s0 = P[i][3], s1 = P[i + 1][3]; if (s1 < a || s0 > b) continue;
    const f = (s) => { const t = (s - s0) / ((s1 - s0) || 1); return [P[i][0] + (P[i + 1][0] - P[i][0]) * t, P[i][1] + (P[i + 1][1] - P[i][1]) * t, P[i][2] + (P[i + 1][2] - P[i][2]) * t, s]; };
    if (!out.length) out.push(f(Math.max(a, s0)));
    out.push(f(Math.min(b, s1)));
  }
  return out;
}
function pointAt(P, a) { const s = slicePath(P, a, a + 1); if (s.length < 2) return [P[0][0], P[0][1], P[0][2], 1, 0]; const dx = s[1][0] - s[0][0], dz = s[1][1] - s[0][1], l = Math.hypot(dx, dz) || 1; return [s[0][0], s[0][1], s[0][2], -dz / l, dx / l]; }
// thin raised strip centred at lateral offset `off`
function strip(P, off, w, h) {
  const pos = [];
  for (let i = 0; i < P.length - 1; i++) {
    const [x1, z1, h1] = P[i], [x2, z2, h2] = P[i + 1]; const dx = x2 - x1, dz = z2 - z1, l = Math.hypot(dx, dz) || 1; const nx = -dz / l, nz = dx / l;
    const o1 = off - w / 2, o2 = off + w / 2;
    const a = [x1 + nx * o1, h1 + h, z1 + nz * o1], b = [x1 + nx * o2, h1 + h, z1 + nz * o2], c = [x2 + nx * o1, h2 + h, z2 + nz * o1], d = [x2 + nx * o2, h2 + h, z2 + nz * o2];
    const a0 = [a[0], h1, a[2]], b0 = [b[0], h1, b[2]], c0 = [c[0], h2, c[2]], d0 = [d[0], h2, d[2]];
    for (const t of [[a, c, b], [b, c, d], [a0, a, c], [a0, c, c0], [b, b0, d0], [b, d0, d]]) for (const p of t) pos.push(...p);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2).map((_, i) => i % 2 ? (i % 4) * 0.5 : ((i / 6) | 0) % 2), 2)); g.computeVertexNormals(); return g;
}
function wall(P, off, thick, yLo, yHi) {
  const pos = [], uv = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p1 = P[i], p2 = P[i + 1]; const dx = p2[0] - p1[0], dz = p2[1] - p1[1], l = Math.hypot(dx, dz) || 1; const nx = -dz / l, nz = dx / l;
    const x1 = p1[0] + nx * off, z1 = p1[1] + nz * off, x2 = p2[0] + nx * off, z2 = p2[1] + nz * off;
    const A = [x1, yLo(p1), z1], B = [x2, yLo(p2), z2], C = [x2, yHi(p2), z2], D = [x1, yHi(p1), z1];
    for (const p of [A, B, C, A, C, D]) pos.push(...p);
    const u1 = p1[3] / 6, u2 = p2[3] / 6; uv.push(u1, 0, u2, 0, u2, (C[1] - B[1]) / 6, u1, 0, u2, (C[1] - B[1]) / 6, u1, (D[1] - A[1]) / 6);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); return g;
}
// oriented bounding rectangle (rotating calipers on hull edges)
function minRect(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l < 0.5) continue; const ax = [(b[0] - a[0]) / l, (b[1] - a[1]) / l], ay = [-ax[1], ax[0]];
    let mnu = 1e9, mxu = -1e9, mnv = 1e9, mxv = -1e9; for (const p of pts) { const u = p[0] * ax[0] + p[1] * ax[1], v = p[0] * ay[0] + p[1] * ay[1]; mnu = Math.min(mnu, u); mxu = Math.max(mxu, u); mnv = Math.min(mnv, v); mxv = Math.max(mxv, v); }
    const area = (mxu - mnu) * (mxv - mnv); if (!best || area < best.area) { const cu = (mnu + mxu) / 2, cv = (mnv + mxv) / 2; best = { area, ax, ay, hx: (mxu - mnu) / 2, hy: (mxv - mnv) / 2, c: [ax[0] * cu + ay[0] * cv, ax[1] * cu + ay[1] * cv] }; }
  }
  if (best.hy > best.hx) { const t = best.hx; best.hx = best.hy; best.hy = t; best.ax = best.ay; best.ay = [-best.ax[1], best.ax[0]]; }
  return best;
}
function boxOriented(c, ax, hx, hy, y0, y1) { const g = new THREE.BoxGeometry(hx * 2, y1 - y0, hy * 2); g.rotateY(-Math.atan2(ax[1], ax[0])); g.translate(c[0], (y0 + y1) / 2, c[1]); return g.toNonIndexed(); }
function gableOriented(c, ax, hx, hy, y0, rise) {
  const s = new THREE.Shape(); s.moveTo(-hy, 0); s.lineTo(hy, 0); s.lineTo(0, rise); s.lineTo(-hy, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: hx * 2, bevelEnabled: false }); g.translate(0, 0, -hx); g.rotateY(Math.PI / 2); g.rotateY(-Math.atan2(ax[1], ax[0])); g.translate(c[0], y0, c[1]); return g.toNonIndexed();
}
