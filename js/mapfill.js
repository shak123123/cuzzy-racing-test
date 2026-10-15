// Mapfill: fills the blank / grey parts of the map and dresses Birmingham hotspots + in-game ads.
//  - data/mapfill.json (tools/mapfill/build_mapfill.py, © OpenStreetMap contributors, ODbL): missing OSM building
//    footprints (o=0 inside the road network: drawn + solid; o=1 off-network backdrop: drawn only, thinned on Low),
//    procedural fillers for genuinely blank road-side cells, missing parks/pitches, shop/amenity POIs
//  - hotspots: look-alike dressing with parody names only (Bulldog Ring, Selfwidges, The Postbox, Custard Fact'ry,
//    Balti Triangle, Coventry Rd, Broad St strip, Arcadiant...) - no real logos or trademarks
//  - ads starring Shak: billboards (2:1), bus shelters (1:2 posters), shop-window posters, big LED screens that play the
//    in-engine commercials (img/ads/film_*.mp4) when close; window.CUZZY_ADS lets the cinema / TVs play them too.
// Phones: everything is merged into a few meshes per 300 m cell (frustum culled), sign text lives in shared atlases,
// posters are 512 px on Low / 1k Medium / 2k High+, and only one video screen decodes at a time.
import * as THREE from 'three';
import { mergeGeometries } from './lib/addons/utils/BufferGeometryUtils.js';
import { ADS, POSTERS, HOTSPOTS } from './ads_data.js';

const dm = v => v / 10, O = [52.479, -1.899], KLAT = 111320, KLON = KLAT * Math.cos(O[0] * Math.PI / 180);
const ll = (la, lo) => [(lo - O[1]) * KLON, -(la - O[0]) * KLAT];
function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const pip = (p, poly) => { let ins = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > p[1]) !== (zj > p[1]) && p[0] < (xj - xi) * (p[1] - zi) / (zj - zi) + xi) ins = !ins; } return ins; };
// real hotspot anchors (public coordinates) -> parody dressing
const SPOTS = [
  { k: 'mailbox', at: ll(52.4757, -1.9037), names: ['THE POSTBOX', 'POSTBOX CANAL BAR', 'SIGNED, SEALED, DELIVERED CAFE'], col: '#b3262c' },
  { k: 'broadst', road: 'Broad Street', names: ['THE TIPSY NARROWBOAT', 'NEON CANAL', 'BRUM BRUM BAR', 'GAS ST SPEAKEASY', 'SHOTS & SHAK', 'THE WOBBLY LOCK', 'CLUB 0121', 'THE LAST ORDERS'], col: '#ff2fb0', neon: 1 },
  { k: 'digbeth', road: 'Digbeth', names: ["CUSTARD FACT'RY", 'ARCH 47 RECORDS', 'DIGBEFF DINER', 'VINYL & VIMTO', 'GRIME FM 0121', 'THE RUSTY ARCH'], col: '#f2c200', neon: 1 },
  { k: 'digbeth', road: 'Fazeley Street', names: ['FAZELEY FLEA MARKET', 'CANAL-SIDE COFFEE', 'GRAFF YARD'], col: '#f2c200' },
  { k: 'balti', road: 'Ladypool Road', names: ['BALTI BROS', 'SPICE ROUNDABOUT', 'THE MIGHTY KARAHI', 'SWEET CENTRE 0121', 'NAAN STOP'], col: '#ff7a00', neon: 1 },
  { k: 'balti', road: 'Stratford Road', names: ['BALTI BROS', 'SPARKHILL SWEETS', 'KEBABISH-ISH', 'SHAK\'S BALTI TURBO', 'THE CHAAI SPOT', 'GOLD & GLITZ JEWELLERS', 'SAREE SUPREME'], col: '#ff7a00', neon: 1 },
  { k: 'covrd', road: 'Coventry Road', names: ['COV RD CASH & CARRY', 'SMALL HEATH SWEET CENTRE', 'HEATH HALAL MEATS', 'FADE KINGS BARBERS', 'PHONE DOCTOR 0121', 'CUZZY CABS', 'BLUENOSE CAFE', 'PRAYER MAT PALACE', 'MOBILE & MORE'], col: '#1d5fbf', neon: 1 },
  { k: 'smallheath', road: 'Small Heath Highway', names: ['HIGHWAY TYRES', 'HEATH HAND CAR WASH', 'CUZZY CABS DEPOT'], col: '#1d5fbf' },
  { k: 'chinese', road: 'Hurst Street', names: ['ARCADIANT', 'DRAGON NOODLE BAR', 'HURST ST KARAOKE', 'BUBBLE TEA BOSS', 'THE PINK PINT'], col: '#e0003c', neon: 1 },
];
const CATN = { mini: ['BRUM MINI MART', 'CORNER SHOP 24/7', 'OPEN ALL HOURS-ISH'], barber: ['FADE KINGS', 'TRIM & TRIM', 'SKIN FADE SAM'], clothes: ['THREADZ', 'DRIP DEPOT'], phone: ['PHONE DOCTOR', 'UNLOCK IT 0121'],
  bakery: ['BAP ATTACK BAKERY', 'CRUMBS'], butcher: ['HALAL MEATS', 'CHOP SHOP'], food: ['CHICK KING', 'PERI PERI PALACE', 'PIZZA PLANET B', 'MUNCH BOX'], cafe: ['BREW-MMIE COFFEE', 'BEAN THERE'],
  bar: ['THE CANAL TAP', 'BAR NONE'], pub: ['THE RED LION-ISH', 'THE BRUMMIE ARMS'], club: ['CLUB 0121'], cinema: ['CUZZYPLEX'], bank: ['BANK OF BRUM'], chemist: ['PILLS & THRILLS'], jewel: ['GOLD & GLITZ'],
  garage: ['TYRES R US-ISH', 'MOT WHILE U WAIT'], beauty: ['NAILED IT'], bet: ['BET YA CUZ'], offy: ['OFFY 24/7'] };

export async function buildMapfill(W, app) {
  const t0 = performance.now(), root = new THREE.Group(); root.name = 'mapfill';
  const info = { buildings: 0, backdrop: 0, fillers: 0, areas: 0, signs: 0, billboards: 0, shelters: 0, screens: 0, skipped: 0 };
  let D; try { D = await (await fetch(new URL('../data/mapfill.json', import.meta.url))).json(); } catch (e) { console.warn('mapfill data', e); return null; }
  const env = W.q.env ?? 0, low = env < 1, res = env >= 2 ? '2k' : env >= 1 ? '1k' : '512', rnd = rng(1234);
  const CELL = 500, cells = new Map(), GLOBAL = /^(frame|glass|pw|pt)/; const put = (x, z, key, mat, g) => { const k = GLOBAL.test(key) ? 'g' : Math.floor(x / CELL) + ',' + Math.floor(z / CELL); let c = cells.get(k); if (!c) cells.set(k, c = new Map()); let b = c.get(key); if (!b) c.set(key, b = { mat, gs: [] }); b.gs.push(g); };
  // ------------------------------------------------ materials (all generated here)
  const cv = (w, h, f) => { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = W.q.aniso || 4; return t; };
  const FAC = cv(128, 128, (g, w, h) => { const r = rng(9); g.fillStyle = '#d8d2c8'; g.fillRect(0, 0, w, h); // neutral brick + sash window, tinted per building by vertex colour
    for (let y = 0; y < h; y += 4) for (let x = (y / 4) % 2 * 6; x < w; x += 12) { g.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.1})`; g.fillRect(x, y, 11, 3); }
    g.fillStyle = '#f4f2ee'; g.fillRect(26, 30, 76, 64); g.fillStyle = '#26303c'; g.fillRect(30, 34, 68, 56); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(30, 34, 68, 10); g.fillStyle = '#f4f2ee'; g.fillRect(62, 34, 4, 56); });
  const TINT = [0x9a4a36, 0xb0634a, 0x84402f, 0xd8ccb4, 0xa79c90, 0x707884, 0xc8c0b2, 0x7a4636].map(c => new THREE.Color(c));
  const facM = new THREE.MeshStandardMaterial({ map: FAC, roughness: 0.88, vertexColors: true });
  const tint = (g, i) => { const c = TINT[i % TINT.length], n = g.attributes.position.count, a = new Float32Array(n * 3); for (let k = 0; k < n; k++) { a[k * 3] = c.r; a[k * 3 + 1] = c.g; a[k * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const roofM = new THREE.MeshStandardMaterial({ color: 0x4a4b50, roughness: 0.95 }), farM = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 1 });
  const greenM = new THREE.MeshStandardMaterial({ color: 0x6f9a52, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const pitchM = new THREE.MeshStandardMaterial({ color: 0x4f8f3e, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  // ------------------------------------------------ extruded footprints
  const extrude = (pts, h, far) => { // walls (UV: u per 3.5 m bay, v per 3.2 m storey) + flat roof
    const P = [], U = [], I = []; let per = 0;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.05) continue; const n = P.length / 3;
      P.push(a[0], 0, a[1], b[0], 0, b[1], b[0], h, b[1], a[0], h, a[1]); const u0 = per / 3.5, u1 = (per + L) / 3.5, v = h / 3.2; U.push(u0, 0, u1, 0, u1, v, u0, v); I.push(n, n + 1, n + 2, n, n + 2, n + 3); per += L; }
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); wg.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); wg.setIndex(I);
    let ccw = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; ccw += (b[0] - a[0]) * (b[1] + a[1]); }
    if (ccw > 0) { const ix = wg.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } } // outward faces
    wg.computeVertexNormals();
    const tri = THREE.ShapeUtils.triangulateShape(pts.map(p => new THREE.Vector2(p[0], p[1])), []); const RP = [], RI = []; for (const p of pts) RP.push(p[0], h, p[1]); for (const t of tri) RI.push(t[0], t[2], t[1]);
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(RP, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pts.length * 2), 2)); rg.setIndex(RI); rg.computeVertexNormals();
    if (rg.attributes.normal.array[1] < 0) { const ix = rg.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } rg.computeVertexNormals(); }
    return [wg, rg]; };
  const solidPolys = []; // for sign placement: every footprint (game + mapfill) near the network
  for (const b of W.d.buildings) { if ((b.mh || 0) > 3) continue; const pts = []; for (let i = 0; i < b.p.length; i += 2) pts.push([dm(b.p[i]), dm(b.p[i + 1])]); solidPolys.push({ pts, h: b.h }); }
  for (const b of D.buildings) {
    const pts = []; for (let i = 0; i < b.p.length; i += 2) pts.push([dm(b.p[i]), dm(b.p[i + 1])]); if (pts.length < 3) continue;
    let ar = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], c = pts[(i + 1) % pts.length]; ar += a[0] * c[1] - c[0] * a[1]; } ar = Math.abs(ar / 2);
    if (b.o && low && ar < 250) continue; if (b.o && env < 2 && ar < 90) continue;
    if (!b.o && W.driveGrid && W.blocksRoad(pts)) { info.skipped++; continue; }
    let cx = 0, cz = 0; for (const p of pts) { cx += p[0]; cz += p[1]; } cx /= pts.length; cz /= pts.length;
    const [wg, rg] = extrude(pts, b.h, b.o); const fi = (b.osm || 0) % TINT.length;
    if (b.o && low) put(cx, cz, 'far', farM, wg); else put(cx, cz, 'fac', facM, tint(wg, fi)); put(cx, cz, 'roof', roofM, rg);
    if (!b.o) { W.addBuildingCollider(pts, { h: b.h, lm: 'mapfill' }); solidPolys.push({ pts, h: b.h }); info.buildings++; } else info.backdrop++;
  }
  for (const f of D.fillers) { const x = dm(f.c[0]), z = dm(f.c[1]), w = dm(f.w) / 2, d = dm(f.d) / 2, a = rnd() * 0.2;
    const pts = [[-w, -d], [w, -d], [w, d], [-w, d]].map(([u, v]) => [x + u * Math.cos(a) - v * Math.sin(a), z + u * Math.sin(a) + v * Math.cos(a)]);
    if (W.driveGrid && W.blocksRoad(pts)) { info.skipped++; continue; } if (W.groundAt && W.groundAt(x, z, 0).road) { info.skipped++; continue; }
    const [wg, rg] = extrude(pts, f.h); put(x, z, 'fac', facM, tint(wg, f.s)); put(x, z, 'roof', roofM, rg); W.addBuildingCollider(pts, { h: f.h, lm: 'mapfill' }); solidPolys.push({ pts, h: f.h }); info.fillers++; }
  for (const a of D.areas) { const pts = []; for (let i = 0; i < a.p.length; i += 2) pts.push(new THREE.Vector2(dm(a.p[i]), dm(a.p[i + 1]))); if (pts.length < 3) continue;
    const g = new THREE.ShapeGeometry(new THREE.Shape(pts)); g.rotateX(Math.PI / 2); g.translate(0, 0.02, 0); const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals();
    put(pts[0].x, pts[0].y, a.k === 'pitch' ? 'pitch' : 'green', a.k === 'pitch' ? pitchM : greenM, g); info.areas++; }
  { const C = D.cell || 20, rs = new Set(); for (const [i, j] of D.green || []) rs.add(i + ',' + j); let n = 0;
    for (const [i, j] of D.green || []) { const x = (i + 0.5) * C, z = (j + 0.5) * C; if (W.groundAt && [[0, 0], [-8, -8], [8, -8], [8, 8], [-8, 8]].some(([a, b]) => W.groundAt(x + a, z + b, 0).road)) continue;
      const g = new THREE.PlaneGeometry(C, C); g.rotateX(-Math.PI / 2); g.translate(x, 0.025, z); put(x, z, 'green', greenM, g); n++; } info.lawns = n; }
  // ------------------------------------------------ sign text atlas (512x128 slots, 64 per 2048 atlas)
  const atlases = []; const slot = (text, o = {}) => { let A = atlases[atlases.length - 1]; if (!A || A.n >= 64) { const c = document.createElement('canvas'); c.width = c.height = 2048; A = { c, g: c.getContext('2d'), n: 0 }; atlases.push(A); }
    const i = A.n++, x = (i % 4) * 512, y = Math.floor(i / 4) * 128, g = A.g; g.fillStyle = o.bg || '#151515'; g.fillRect(x, y, 512, 128); g.fillStyle = o.stripe || '#ffffff'; g.fillRect(x, y + 112, 512, 16);
    let fs = 74; g.font = `900 ${fs}px Impact, 'Arial Black', sans-serif`; while (g.measureText(text).width > 480 && fs > 20) { fs -= 3; g.font = `900 ${fs}px Impact, 'Arial Black', sans-serif`; }
    g.textAlign = 'center'; g.textBaseline = 'middle'; if (o.glow) { g.shadowColor = o.glow; g.shadowBlur = 18; } g.fillStyle = o.fg || '#fff'; g.fillText(text, x + 256, y + 58); g.shadowBlur = 0;
    return { A: atlases.length - 1, u0: x / 2048, v0: 1 - (y + 128) / 2048, u1: (x + 512) / 2048, v1: 1 - y / 2048, lit: !!o.glow }; };
  const signQ = []; // [slot, centre, dir along facade, normal, w, h]
  const quad = (c, t, n, w, h, s) => { const g = new THREE.PlaneGeometry(w, h); const uv = g.attributes.uv; for (let i = 0; i < 4; i++) uv.setXY(i, uv.getX(i) ? s.u1 : s.u0, uv.getY(i) ? s.v1 : s.v0);
    const m = new THREE.Matrix4().makeBasis(t, new THREE.Vector3(0, 1, 0), n).setPosition(c); g.applyMatrix4(m); return g; };
  // put a fascia on the nearest footprint edge facing point (x,z) (the road-side), returns true when placed
  const pGrid = new Map(); for (const sp of solidPolys) { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const p of sp.pts) { x0 = Math.min(x0, p[0]); z0 = Math.min(z0, p[1]); x1 = Math.max(x1, p[0]); z1 = Math.max(z1, p[1]); }
    for (let gx = Math.floor(x0 / 20); gx <= Math.floor(x1 / 20); gx++) for (let gz = Math.floor(z0 / 20); gz <= Math.floor(z1 / 20); gz++) { const k = gx * 100000 + gz; let a = pGrid.get(k); if (!a) pGrid.set(k, a = []); a.push(sp); } }
  const used = new Set();
  const fascia = (x, z, text, o = {}, maxD = 14) => { let best = null, bd = maxD;
    for (let gx = Math.floor((x - maxD) / 20); gx <= Math.floor((x + maxD) / 20); gx++) for (let gz = Math.floor((z - maxD) / 20); gz <= Math.floor((z + maxD) / 20); gz++) for (const sp of pGrid.get(gx * 100000 + gz) || []) {
      const P = sp.pts; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); if (L < 4.5) continue;
        let t = ((x - a[0]) * dx + (z - a[1]) * dz) / (L * L); t = Math.max(2 / L, Math.min(1 - 2 / L, t)); const px = a[0] + dx * t, pz = a[1] + dz * t, d = Math.hypot(x - px, z - pz); if (d < bd) { bd = d; best = { px, pz, dx: dx / L, dz: dz / L, L, h: sp.h, key: sp.pts[0][0] + ',' + i }; } } }
    if (!best || used.has(best.key)) return false; used.add(best.key);
    let nx = -best.dz, nz = best.dx; if ((x - best.px) * nx + (z - best.pz) * nz < 0) { nx = -nx; nz = -nz; }
    const w = Math.min(best.L - 1, o.w || 6.5), h = w / 4, y = Math.min(Math.max(3.4, (best.h || 8) * 0.38), 5.2);
    signQ.push([slot(text, o), new THREE.Vector3(best.px + nx * 0.12, y, best.pz + nz * 0.12), new THREE.Vector3(nz, 0, -nx), new THREE.Vector3(nx, 0, nz), w, h]); info.signs++; return true; };
  // road-side sample points along a named road
  const roadSide = (name, step, off) => { const out = []; for (const r of W.d.roads) { if (r.n !== name || r.tun) continue; const p = r.p; for (let i = 0; i + 3 < p.length; i += 2) { const ax = dm(p[i]), az = dm(p[i + 1]), bx = dm(p[i + 2]), bz = dm(p[i + 3]), L = Math.hypot(bx - ax, bz - az); if (L < 1) continue;
      const nx = -(bz - az) / L, nz = (bx - ax) / L; for (let a = step / 2; a < L; a += step) for (const s of [-1, 1]) out.push({ x: ax + (bx - ax) * a / L + nx * s * (r.w / 2 + off), z: az + (bz - az) * a / L + nz * s * (r.w / 2 + off), yaw: Math.atan2(-nx * s, -nz * s), k: r.k }); } } return out; };
  const spotFirst = {}; for (const S of SPOTS) { let n = 0; spotFirst[S.k + (S.road ? ':' + S.road : '')] = signQ.length; const pts = S.road ? roadSide(S.road, 28, 2) : (() => { const o = []; for (let a = 0; a < 12; a++) o.push({ x: S.at[0] + Math.cos(a) * 14, z: S.at[1] + Math.sin(a) * 14 }); return o; })();
    for (const p of pts) { if (fascia(p.x, p.z, S.names[n % S.names.length], { bg: S.neon ? '#0d0d12' : S.col, fg: S.neon ? S.col : '#fff', glow: S.neon ? S.col : null, stripe: S.col, w: S.neon ? 7 : 8 })) n++; if (n >= S.names.length * 2) break; } info[S.k] = (info[S.k] || 0) + n; }
  // landmark parody plaques (totems by the real landmarks the world already models)
  const totems = []; for (const [k, nm] of Object.entries(HOTSPOTS)) { const at = W.d.landmarks[k]; if (!at) continue; totems.push([dm(at[0]), dm(at[1]), nm]); }
  { const mb = SPOTS[0].at; totems.push([mb[0], mb[1], HOTSPOTS.mailbox]); }
  // POI fascias (category parody names), near the network only, capped for phones
  { let n = 0; const cap = low ? 160 : 420; const pois = D.pois.slice().sort((a, b) => ((a.c[0] * 7 + a.c[1]) % 97) - ((b.c[0] * 7 + b.c[1]) % 97));
    for (const p of pois) { if (n >= cap) break; const names = CATN[p.k]; if (!names) continue; const nm = names[(Math.abs(p.c[0] + p.c[1]) >> 3) % names.length]; const hue = (Math.abs(p.c[0] * 13 + p.c[1]) % 360);
      if (fascia(dm(p.c[0]), dm(p.c[1]), nm, { bg: `hsl(${hue},55%,22%)`, fg: '#fff', stripe: `hsl(${hue},80%,55%)` }, 9)) n++; } info.poiSigns = n; }
  // ------------------------------------------------ posters / billboards / shelters / screens
  const TL = new THREE.TextureLoader(); const ptex = {}; const poster = (id, shape) => { const k = id + shape; if (ptex[k]) return ptex[k]; const t = TL.load(new URL(`../img/ads/${id}_${shape}_${res}.jpg`, import.meta.url).href); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = W.q.aniso || 4;
    return (ptex[k] = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.5 })); };
  const frameM = new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.6, roughness: 0.45 }), glassM = new THREE.MeshStandardMaterial({ color: 0xbfd6e0, transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0.1, depthWrite: false });
  const box = (w, h, d, x, y, z, yaw) => { const g = new THREE.BoxGeometry(w, h, d); g.rotateY(yaw); g.translate(x, y, z); return g; };
  const free = (x, z, r) => { if (W.groundAt && W.groundAt(x, z, 0).road) return false; for (let gx = Math.floor((x - r) / 20); gx <= Math.floor((x + r) / 20); gx++) for (let gz = Math.floor((z - r) / 20); gz <= Math.floor((z + r) / 20); gz++) for (const sp of pGrid.get(gx * 100000 + gz) || []) if (pip([x, z], sp.pts)) return false; return true; };
  const big = W.d.roads.filter(r => !r.tun && /primary|secondary|trunk/.test(r.k) && r.n).map(r => r.n); const bigNames = [...new Set(big)];
  let bi = 0, si = 0; const spacedOK = [], far = (x, z, d) => spacedOK.every(([a, b]) => Math.hypot(a - x, b - z) > d);
  const bbCap = low ? 26 : 48, shCap = low ? 18 : 36;
  for (const nm of bigNames) for (const p of roadSide(nm, 60, 4.5)) {
    if (bi < bbCap && far(p.x, p.z, 160) && free(p.x, p.z, 5)) { const id = POSTERS[bi % POSTERS.length].id, yaw = p.yaw + Math.PI, ox = Math.cos(p.yaw) * 0, x = p.x, z = p.z; // 2:1 roadside billboard on two legs, faces the road
      put(x, z, 'frame', frameM, box(8.6, 4.6, 0.35, x, 5.6, z, yaw)); for (const s of [-2.6, 2.6]) put(x, z, 'frame', frameM, box(0.35, 3.6, 0.35, x + Math.cos(yaw) * s, 1.8, z - Math.sin(yaw) * s, yaw));
      const g = new THREE.PlaneGeometry(8, 4); g.rotateY(yaw + Math.PI); g.translate(x - Math.sin(yaw) * 0.19, 5.6, z - Math.cos(yaw) * 0.19); put(x, z, 'pw' + id, poster(id, 'wide'), g);
      W.addBuildingCollider([[x + Math.cos(yaw) * 2.6 - 0.2, z - Math.sin(yaw) * 2.6], [x + Math.cos(yaw) * 2.6 + 0.2, z - Math.sin(yaw) * 2.6 + 0.2]], { h: 3.6, lm: 'billboard' });
      spacedOK.push([x, z]); bi++; continue; }
    if (si < shCap && far(p.x, p.z, 120) && free(p.x, p.z, 3)) { const id = POSTERS[(si + 3) % POSTERS.length].id, yaw = p.yaw + Math.PI, x = p.x - Math.sin(p.yaw) * -1.2, z = p.z - Math.cos(p.yaw) * -1.2; // bus shelter: roof, back glass, end poster panel
      put(x, z, 'frame', frameM, box(4.2, 0.12, 1.6, x, 2.55, z, yaw)); put(x, z, 'glass', glassM, box(4.0, 2.3, 0.04, x - Math.sin(yaw) * 0.75, 1.3, z - Math.cos(yaw) * 0.75, yaw));
      const ex = x + Math.cos(yaw) * 2.05, ez = z - Math.sin(yaw) * 2.05; put(x, z, 'frame', frameM, box(0.12, 2.4, 1.4, ex, 1.25, ez, yaw));
      for (const sd of [1, -1]) { const g = new THREE.PlaneGeometry(1.15, 2.1); g.rotateY(yaw + sd * Math.PI / 2); g.translate(ex + Math.cos(yaw) * 0.07 * sd, 1.25, ez - Math.sin(yaw) * 0.07 * sd); put(x, z, 'pt' + id, poster(id, 'tall'), g); }
      W.addBuildingCollider([[ex, ez], [x - Math.cos(yaw) * 2.05, z + Math.sin(yaw) * 2.05]], { h: 2.5, lm: 'shelter', parapet: true });
      spacedOK.push([x, z]); si++; } }
  info.billboards = bi; info.shelters = si;
  // shop-window posters on hotspot / POI fascias (every 3rd sign gets an A1 poster beside its door)
  for (let i = 0; i < signQ.length; i += 3) { const [, c, t, n] = signQ[i]; const id = POSTERS[i % POSTERS.length].id; const g = new THREE.PlaneGeometry(0.84, 1.19); const m = new THREE.Matrix4().makeBasis(t, new THREE.Vector3(0, 1, 0), n).setPosition(c.x + t.x * 2.4 + n.x * 0.02, 1.35, c.z + t.z * 2.4 + n.z * 0.02); g.applyMatrix4(m); put(c.x, c.z, 'pt' + id, poster(id, 'tall'), g); info.shopPosters = (info.shopPosters || 0) + 1; }
  // totems
  const atlasMats = []; const amat = i => atlasMats[i] || (atlasMats[i] = (() => { const t = new THREE.CanvasTexture(atlases[i].c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = W.q.aniso || 4; return new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.45 }); })());
  for (const [x0, z0, nm] of totems) { let x = x0, z = z0, ok = false; for (let r = 18; r < 70 && !ok; r += 6) for (let a = 0; a < 12 && !ok; a++) { const xx = x0 + Math.cos(a / 12 * 6.283) * r, zz = z0 + Math.sin(a / 12 * 6.283) * r; if (free(xx, zz, 2.5)) { x = xx; z = zz; ok = true; } } if (!ok) continue;
    const yaw = Math.atan2(x0 - x, z0 - z) + Math.PI; put(x, z, 'frame', frameM, box(0.4, 7, 0.4, x, 3.5, z, yaw)); put(x, z, 'frame', frameM, box(6.4, 1.8, 0.3, x, 6.6, z, yaw));
    const s = slot(nm, { bg: '#101014', fg: '#ffffff', glow: '#ffd400', stripe: '#ffd400' }); for (const sd of [1, -1]) signQ.push([s, new THREE.Vector3(x + Math.sin(yaw) * 0.17 * sd, 6.6, z + Math.cos(yaw) * 0.17 * sd), new THREE.Vector3(Math.cos(yaw) * sd, 0, -Math.sin(yaw) * sd), new THREE.Vector3(Math.sin(yaw) * sd, 0, Math.cos(yaw) * sd), 6.2, 1.55]);
    W.addBuildingCollider([[x - 0.3, z], [x + 0.3, z + 0.01]], { h: 7, lm: 'totem' }); info.totems = (info.totems || 0) + 1; }
  for (const [s, c, t, n, w, h] of signQ) put(c.x, c.z, 'atlas' + s.A, null, quad(c, t, n, w, h, s));
  // big LED screens at the hotspots: poster at rest, the in-engine commercial when the camera is close
  const screens = []; const SCR = [['bullring', 0], ['broadst', 1], ['digbeth', 2], ['covrd', 3]];
  for (const [k, ai] of SCR) { const ss = SPOTS.find(s => s.k === k); let at = W.d.landmarks[k] ? [dm(W.d.landmarks[k][0]), dm(W.d.landmarks[k][1])] : null; let yaw = 0;
    if (!at && ss?.road) { const p = roadSide(ss.road, 40, 6).find(q => free(q.x, q.z, 6)); if (p) { at = [p.x, p.z]; yaw = p.yaw; } }
    if (at && W.d.landmarks[k]) { for (let r = 30; r < 90; r += 6) { let hit = null; for (let a = 0; a < 16 && !hit; a++) { const xx = at[0] + Math.cos(a / 16 * 6.283) * r, zz = at[1] + Math.sin(a / 16 * 6.283) * r; if (free(xx, zz, 6)) hit = [xx, zz]; } if (hit) { yaw = Math.atan2(at[0] - hit[0], at[1] - hit[1]); at = hit; break; } } }
    if (!at) continue; const [x, z] = at; const mat = poster(ADS[ai].id, 'wide').clone(); mat.emissiveIntensity = 0.8;
    const fx = Math.sin(yaw), fz = Math.cos(yaw); // screen faces direction (fx, fz)
    const back = new THREE.Mesh(new THREE.BoxGeometry(12.6, 7.3, 0.5), frameM); back.position.set(x, 9, z); back.rotation.y = yaw; root.add(back);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(12, 6.75), mat); scr.position.set(x + fx * 0.27, 9, z + fz * 0.27); scr.rotation.y = yaw; root.add(scr);
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.8, 5.4, 0.8), frameM); pole.position.set(x, 2.7, z); root.add(pole);
    W.addBuildingCollider([[x - 0.5, z - 0.5], [x + 0.5, z - 0.5], [x + 0.5, z + 0.5], [x - 0.5, z + 0.5]], { h: 5.4, lm: 'screen' });
    screens.push({ mesh: scr, mat, rest: mat.map, ai, x, z }); info.screens++; }
  // ------------------------------------------------ flush merged cells
  let draws = 0; for (const [, c] of cells) for (const [key, b] of c) { const mat = b.mat || amat(+key.slice(5)); const g = mergeGeometries(b.gs.map(g => g.index ? g : g), false); if (!g) continue; g.computeBoundingSphere(); const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true; m.castShadow = W.q.shadows >= 2 && key === 'fac'; m.matrixAutoUpdate = false; m.updateMatrix(); root.add(m); draws++; for (const x of b.gs) x.dispose(); }
  info.draws = draws; info.atlases = atlases.length;
  // ------------------------------------------------ ad video player (shared by screens, cinema, TVs)
  const vq = env >= 2 ? '720' : '360'; const films = ADS.map(a => new URL(`../img/ads/film_${a.id}_${vq}.mp4`, import.meta.url).href);
  let have = []; try { have = await (await fetch(new URL('../img/ads/films.json', import.meta.url))).json(); } catch (e) { } // only ads whose film was exported
  let vid = null, vtex = null, cur = null; const video = i => { if (!vid) { vid = document.createElement('video'); vid.muted = true; vid.loop = true; vid.playsInline = true; vid.crossOrigin = 'anonymous'; vtex = new THREE.VideoTexture(vid); vtex.colorSpace = THREE.SRGBColorSpace; vid.addEventListener('error', () => { }); }
    if (vid.dataset.i !== String(i)) { vid.dataset.i = i; vid.src = films[i]; } vid.play().catch(() => { }); return vtex; };
  const API = window.CUZZY_ADS = { have, ads: ADS, posters: POSTERS, films, video, info, posterURL: (id, shape = 'wide') => new URL(`../img/ads/${id}_${shape}_${res}.jpg`, import.meta.url).href,
    filmHQ: ADS.map(a => new URL(`../img/ads/film_${a.id}_720.mp4`, import.meta.url).href) };
  let acc = 0; API.update = (dt, cam) => { acc += dt; if (acc < 0.5 || !cam) return; acc = 0; let best = null, bd = 140; // only the nearest screen in range plays (one decoder on phones)
    for (const s of screens) { if (!have.includes(ADS[s.ai].id)) continue; const d = Math.hypot(cam.position.x - s.x, cam.position.z - s.z); if (d < bd) { bd = d; best = s; } }
    if (best !== cur) { if (cur) { cur.mat.map = cur.mat.emissiveMap = cur.rest; cur.mat.needsUpdate = true; } cur = best; if (cur) { const t = video(cur.ai), me = cur; const swap = () => { if (cur !== me) return; me.mat.map = me.mat.emissiveMap = t; me.mat.needsUpdate = true; }; if (vid.readyState >= 2) swap(); else vid.addEventListener('playing', swap, { once: true }); } else if (vid) vid.pause(); } };
  API.screens = screens; API.debug = { signs: signQ.map(q => [q[1].x, q[1].y, q[1].z, q[3].x, q[3].z]), spots: spotFirst, furniture: spacedOK }; info.ms = Math.round(performance.now() - t0); console.log('mapfill', JSON.stringify(info));
  return { group: root, info, update: API.update };
}
