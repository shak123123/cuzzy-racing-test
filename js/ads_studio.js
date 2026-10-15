// In-engine parody commercials + posters starring Shak (v2: PBR sets, depth of field, bloom, GPU particles).
// Deterministic: frame(t) poses everything at absolute time t, so tools/mapfill/render_ads.mjs captures frame by frame.
import * as THREE from 'three';
import { RoomEnvironment } from './lib/addons/environments/RoomEnvironment.js';
import { EffectComposer } from './lib/addons/postprocessing/EffectComposer.js';
import { RenderPass } from './lib/addons/postprocessing/RenderPass.js';
import { BokehPass } from './lib/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from './lib/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './lib/addons/postprocessing/OutputPass.js';
import { buildPerson, animPerson } from './person.js';
import { buildCar } from './carmodel.js';
import { ensureRealModel, registerCars } from './realcars.js';
import { ADS, POSTERS } from './ads_data.js';
import { pbr, softTex, Particles, fireCol, lumpy, canvasTex, rng } from './ads_kit.js';

const L = (a, b, k) => a + (b - a) * k, sm = k => k * k * (3 - 2 * k), cl = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, ...o });
const phys = (c, o = {}) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.5, ...o });
const rbox = (w, h, d, r = 0.02) => { const s = new THREE.Shape(), x = w / 2 - r, y = d / 2 - r; s.moveTo(-x, -y - r); s.lineTo(x, -y - r); s.quadraticCurveTo(x + r, -y - r, x + r, -y); s.lineTo(x + r, y); s.quadraticCurveTo(x + r, y + r, x, y + r); s.lineTo(-x, y + r); s.quadraticCurveTo(-x - r, y + r, -x - r, y); s.lineTo(-x - r, -y); s.quadraticCurveTo(-x - r, -y - r, -x, -y - r);
  const g = new THREE.ExtrudeGeometry(s, { depth: h - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r * 0.6, bevelSegments: 3, curveSegments: 4 }); g.rotateX(-Math.PI / 2); g.translate(0, r, 0); return g; };
const face = (dx, dz) => Math.atan2(-dx, -dz); // person yaw that faces direction (dx, dz)
export function signTex(text, o = {}) { // flat sign / fascia canvas texture
  const w = o.w || 1024, h = o.h || 256, c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = o.bg || '#111'; g.fillRect(0, 0, w, h); if (o.stripe) { g.fillStyle = o.stripe; g.fillRect(0, h * 0.82, w, h * 0.18); }
  let fs = h * (o.fs || 0.56); g.font = `900 ${fs}px Impact, 'Arial Black', sans-serif`; while (g.measureText(text).width > w * 0.92 && fs > 8) { fs *= 0.92; g.font = `900 ${fs}px Impact, 'Arial Black', sans-serif`; }
  g.textAlign = 'center'; g.textBaseline = 'middle'; if (o.glow) { g.shadowColor = o.glow; g.shadowBlur = h * 0.12; }
  g.fillStyle = o.fg || '#fff'; g.fillText(text, w / 2, h * (o.stripe ? 0.42 : 0.52));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

export class Studio {
  constructor(W, H) {
    this.W = W; this.H = H;
    const r = this.r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true }); r.setPixelRatio(1); r.setSize(W, H);
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1; r.outputColorSpace = THREE.SRGBColorSpace; r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.out = document.createElement('canvas'); this.out.width = W; this.out.height = H; this.g = this.out.getContext('2d');
    const sc = this.sc = new THREE.Scene(); const pm = new THREE.PMREMGenerator(r); this.envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture; sc.environment = this.envTex;
    this.cam = new THREE.PerspectiveCamera(35, W / H, 0.05, 400);
    const sun = this.sun = new THREE.DirectionalLight(0xfff1dd, 2.6); sun.position.set(6, 10, 4); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14 }); sc.add(sun, sun.target);
    this.hemi = new THREE.HemisphereLight(0xcfe0ff, 0x554433, 0.6); sc.add(this.hemi);
    const cp = this.comp = new EffectComposer(r); cp.setPixelRatio(1); cp.setSize(W, H); cp.addPass(new RenderPass(sc, this.cam));
    this.bokeh = new BokehPass(sc, this.cam, { focus: 4, aperture: 0.004, maxblur: 0.008 }); cp.addPass(this.bokeh);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.35, 0.5, 0.92); cp.addPass(this.bloom); cp.addPass(new OutputPass());
    this.shak = buildPerson('shak'); sc.add(this.shak); this.sets = {}; this.cur = null; this.clips = [];
    this.tex = { soft: softTex('soft'), smoke: softTex('smoke'), flame: softTex('flame') };
  }
  async ready() { if (this._rd) return this._rd; this._rd = (async () => { const P = this.shak.userData.person; const t0 = performance.now(); while (!P.mix && performance.now() - t0 < 90000) await new Promise(r => setTimeout(r, 100)); this.clips = P.act ? Object.keys(P.act) : [];
    this.bones = this.bonesOf(this.shak);
    try { const cars = await (await fetch('shared/cars.json')).json(); registerCars?.(cars); this.carDef = cars.find(c => c.id === 'rs3') || cars[0]; await ensureRealModel(this.carDef); } catch (e) { console.warn('car', e.message); } })(); return this._rd; }
  bonesOf(o) { const b = {}; o.traverse(x => { if (x.isBone) b[x.name.replace('Bip01_', '')] = x; }); return b; }
  // pose overrides on top of the idle clip (Biped: +z on a thigh = hip flexion, -z on a calf = knee bend)
  sit(B, lean = 0) { if (!B.L_Thigh) return; for (const s of ['L', 'R']) { B[s + '_Thigh'].rotation.z += 1.5; B[s + '_Calf'].rotation.z -= 1.45; B[s + '_Foot'].rotation.z += 0.0; } B.Spine1.rotation.z += lean; }
  // ------------------------------------------------------------------ shared builders
  room(G, w, d, h, wallM, floorM) { const fl = new THREE.Mesh(new THREE.PlaneGeometry(w, d), floorM); fl.rotation.x = -Math.PI / 2; fl.receiveShadow = true; G.add(fl);
    const ce = new THREE.Mesh(new THREE.PlaneGeometry(w, d), std(0x2a1c16, { roughness: 0.9 })); ce.rotation.x = Math.PI / 2; ce.position.y = h; G.add(ce);
    for (const [x, z, ry, len] of [[0, -d / 2, 0, w], [0, d / 2, Math.PI, w], [-w / 2, 0, Math.PI / 2, d], [w / 2, 0, -Math.PI / 2, d]]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(len, h), wallM); m.position.set(x, h / 2, z); m.rotation.y = ry; m.receiveShadow = true; G.add(m); } }
  street(G, o = {}) { const road = new THREE.Mesh(new THREE.PlaneGeometry(220, 12), pbr('asphalt', { rep: [60, 4], size: 512 })); road.rotation.x = -Math.PI / 2; road.receiveShadow = true; G.add(road);
    for (const s of [-1, 1]) { const pv = new THREE.Mesh(new THREE.BoxGeometry(220, 0.14, 5.5), pbr('pave', { rep: [55, 1.4] })); pv.position.set(0, 0.07, s * 8.75); pv.receiveShadow = true; G.add(pv);
      const kb = new THREE.Mesh(new THREE.BoxGeometry(220, 0.16, 0.3), std(0x9a968e, { roughness: 0.8 })); kb.position.set(0, 0.08, s * 6.1); G.add(kb);
      for (const yo of [0.12, 0.32]) { const yl = new THREE.Mesh(new THREE.PlaneGeometry(220, 0.1), std(0xe8c200, { roughness: 0.6 })); yl.rotation.x = -Math.PI / 2; yl.position.set(0, 0.012, s * (5.9 - yo)); G.add(yl); } }
    const dash = std(0xf0f0f0, { roughness: 0.6 }); for (let i = -18; i < 18; i++) { const d = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.12), dash); d.rotation.x = -Math.PI / 2; d.position.set(i * 6 + 1, 0.011, 0); G.add(d); }
    const brick = [pbr('brick', { rep: [2, 3] }), pbr('brick', { color: 0x9b5a3c, seed: 9, rep: [2, 3] }), pbr('brick', { color: 0x7a3d2c, seed: 5, rep: [2, 3] }), pbr('plaster', { color: 0xd8d0c0, rep: [2, 2] })];
    const glass = phys(0x1a2430, { roughness: 0.05, metalness: 0.2, envMapIntensity: 1.6 }), frame = std(0xf2f0ea, { roughness: 0.5 }), sill = std(0xd9d4c8);
    const shopGlow = std(0xfff0d0, { emissive: 0xffd9a0, emissiveIntensity: 0.6 }); const names = o.shops || [];
    for (let i = -7; i < 7; i++) { const h = 10 + ((i * 7 + 21) % 4), x = i * 9 + 4.5, z = -14.5, m = brick[(i + 7) % brick.length]; if (o.gap && x > o.gap[0] && x < o.gap[1]) continue;
      const b = new THREE.Mesh(new THREE.BoxGeometry(8.8, h, 6), m); b.material = m; b.position.set(x, h / 2, z); b.castShadow = b.receiveShadow = true; G.add(b);
      const cor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.35, 0.4), sill); cor.position.set(x, h - 0.2, z + 3.1); G.add(cor);
      for (let f = 1; f < Math.floor(h / 3.2); f++) for (const wx of [-2.4, 0, 2.4]) { const y = 1.6 + f * 3.1; const fr = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.85, 0.12), frame); fr.position.set(x + wx, y, z + 3.03); const gl = new THREE.Mesh(new THREE.BoxGeometry(1.12, 1.7, 0.05), glass); gl.position.set(x + wx, y, z + 3.07);
        const s2 = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.25), sill); s2.position.set(x + wx, y - 1.0, z + 3.1); G.add(fr, gl, s2); }
      const sf = new THREE.Mesh(new THREE.BoxGeometry(7.6, 2.6, 0.1), glass); sf.position.set(x, 1.5, z + 3.06); const inner = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 2.4), shopGlow); inner.position.set(x, 1.5, z + 2.7); G.add(sf, inner);
      if (names.length) { const n = names[(i + 7) % names.length]; this.sign(G, n[0], { bg: n[1], fg: n[2] || '#fff', glow: n[3] }, x, 3.35, z + 3.12, 8, 0.85, 0, 0.5); } }
    const lampM = std(0x1e1f22, { metalness: 0.7, roughness: 0.4 }); for (let i = -4; i < 5; i++) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 7, 12), lampM); p.position.set(i * 18, 3.5, -6.6); const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.4), lampM); arm.position.set(i * 18, 6.9, -6); const hd = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.12, 0.6), lampM); hd.position.set(i * 18, 6.85, -5.3); G.add(p, arm, hd); p.castShadow = true; }
    const binM = std(0x1d3b28, { roughness: 0.55 }); for (const x of [-11, 13]) { const bn = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.95, 20), binM); bn.position.set(x, 0.62, 7.2); bn.castShadow = true; G.add(bn); }
  }
  sign(G, text, o, x, y, z, w, h, ry = 0, lit = 0.6) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: signTex(text, o), roughness: 0.4, emissive: 0xffffff, emissiveIntensity: o.lit ?? lit }));
    m.material.emissiveMap = m.material.map; m.position.set(x, y, z); m.rotation.y = ry; G.add(m); return m; }
  realCar(color) { try { if (this.carDef) { const c = buildCar(this.carDef, { detail: 2, colour: color, plate: 'CUZZY' }); c.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } }); return c; } } catch (e) { console.warn('car build', e.message); } return null; }
  // ------------------------------------------------------------------ sets
  build(id) { if (this.sets[id]) return this.sets[id]; const G = new THREE.Group(); G.name = id; let upd = () => { }; const T = this.tex, H = this.H;
    if (id === 'balti') { // Ladypool Road-style balti house interior
      const wallM = pbr('plaster', { color: 0xa8482a, rep: [4, 2] }), floorM = pbr('wood', { rep: [5, 4], color: 0x5a3720 }); this.room(G, 14, 12, 3.4, wallM, floorM);
      const dado = pbr('tile', { color: 0x2f6e5a, rep: [16, 1.5] }); for (const [x, z, ry, len] of [[0, -5.98, 0, 14], [-6.98, 0, Math.PI / 2, 12], [6.98, 0, -Math.PI / 2, 12]]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.1), dado); m.position.set(x, 0.55, z); m.rotation.y = ry; G.add(m); }
      // kitchen pass in the back wall: opening, steel counter, heat lamps, kitchen behind
      const steel = pbr('steel', { rep: [3, 1] }); const passM = std(0x1b120d, { roughness: 0.9 });
      const op = new THREE.Mesh(new THREE.BoxGeometry(5, 1.6, 0.3), passM); op.visible = false; G.add(op);
      const cnt = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.08, 0.7), steel); cnt.position.set(0, 1.12, -5.9); const cntF = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.1, 0.06), steel); cntF.position.set(0, 0.55, -5.6); G.add(cnt, cntF);
      const kitchen = new THREE.Group(); kitchen.position.set(0, 0, -8.2); G.add(kitchen); { const kw = pbr('tile', { color: 0xb8b6ae, rep: [10, 4] }); const back = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.4), kw); back.position.set(0, 1.7, -2); kitchen.add(back);
        for (const s of [-1, 1]) { const sw = new THREE.Mesh(new THREE.PlaneGeometry(4, 3.4), kw); sw.position.set(s * 4, 1.7, 0); sw.rotation.y = -s * Math.PI / 2; kitchen.add(sw); }
        const kf = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), pbr('tile', { color: 0x777770, rep: [8, 4] })); kf.rotation.x = -Math.PI / 2; kitchen.add(kf);
        const range = new THREE.Mesh(rbox(3, 0.9, 0.9, 0.03), steel); range.position.set(0, 0, -1.4); kitchen.add(range); const hood = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.6, 1.1), steel); hood.position.set(0, 2.7, -1.4); kitchen.add(hood);
        for (const x of [-0.8, 0.8]) { const bn = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 8, 24), std(0x111, { metalness: 0.8, roughness: 0.4 })); bn.rotation.x = Math.PI / 2; bn.position.set(x, 0.92, -1.4); kitchen.add(bn); }
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(3, 0.04, 0.3), steel); shelf.position.set(-2.2, 1.9, -1.85); kitchen.add(shelf); for (let i = 0; i < 6; i++) { const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 16), phys([0xc0392b, 0xe8a317, 0x6b8e23, 0x8b4513, 0xd35400, 0xf1c40f][i], { roughness: 0.3, transmission: 0, clearcoat: 0.8 })); jar.position.set(-3.3 + i * 0.4, 2.02, -1.85); kitchen.add(jar); }
        const kl = new THREE.PointLight(0xfff4e0, 2.2, 7, 2); kl.position.set(0, 2.6, -0.5); kitchen.add(kl); }
      // the wall around the pass (two side pieces + header)
      const wseg = (x, w, y, h) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.2), wallM); m.position.set(x, y, -6.05); m.receiveShadow = true; G.add(m); }; wseg(-4.75, 4.5, 1.7, 3.4); wseg(4.75, 4.5, 1.7, 3.4); wseg(0, 5, 2.85, 1.1); wseg(0, 5, 0.56, 1.12);
      this.sign(G, "SHAK'S BALTI TURBO", { bg: '#2a0d08', fg: '#ffcc55', glow: '#ff9933' }, 0, 2.95, -5.93, 4.4, 0.75, 0, 1.0);
      // menu boards
      const menu = canvasTex(1024, 640, (g, w, h) => { g.fillStyle = '#16120f'; g.fillRect(0, 0, w, h); g.strokeStyle = '#c9a24a'; g.lineWidth = 10; g.strokeRect(14, 14, w - 28, h - 28); g.fillStyle = '#f2d27a'; g.font = '900 70px Georgia, serif'; g.textAlign = 'center'; g.fillText('BALTI MENU', w / 2, 100);
        g.font = '600 40px Georgia, serif'; g.textAlign = 'left'; [['Chicken Balti', '7.50'], ['Lamb Balti', '8.95'], ['Keema Balti', '7.95'], ['Family Naan (1 metre)', '6.00'], ['TURBO BALTI (2.9 sec)', '9.99'], ['Chips (for Junior)', '2.50']].forEach(([a, b], i) => { g.fillStyle = i === 4 ? '#ff9a3a' : '#efe6d2'; g.fillText(a, 70, 190 + i * 70); g.textAlign = 'right'; g.fillText('£' + b, w - 70, 190 + i * 70); g.textAlign = 'left'; }); });
      for (const [x, z, ry] of [[-6.95, -2, Math.PI / 2], [6.95, -1, -Math.PI / 2]]) { const mb = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.375), new THREE.MeshStandardMaterial({ map: menu, roughness: 0.5, emissive: 0xffffff, emissiveMap: menu, emissiveIntensity: 0.15 })); mb.position.set(x, 2.1, z); mb.rotation.y = ry; G.add(mb); }
      // framed photos
      for (let i = 0; i < 3; i++) { const fr = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.9), std(0xb08d3a, { metalness: 0.8, roughness: 0.35 })); fr.position.set(-6.94, 2.1, 1.2 + i * 1.6); G.add(fr); const ph = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.55), std([0x6d7f8a, 0x8a6d4f, 0x5d6b4a][i], { roughness: 0.4 })); ph.position.set(-6.9, 2.1, 1.2 + i * 1.6); ph.rotation.y = Math.PI / 2; G.add(ph); }
      // tables, chairs, place settings
      const top = phys(0x24130a, { roughness: 0.55, clearcoat: 0.15, clearcoatRoughness: 0.5, envMapIntensity: 0.4 }), chairM = std(0x3a2416, { roughness: 0.6 }), cloth = std(0xf1e9da, { roughness: 0.95 }), plateM = phys(0xf6f6f2, { roughness: 0.15, clearcoat: 1 }), glassM = phys(0xffffff, { roughness: 0.02, transmission: 0.9, thickness: 0.02, transparent: true, opacity: 0.5 });
      const tables = [[0, 1.5], [-3.4, -1.5], [3.4, -1.5], [-3.4, 3.2], [3.4, 3.2], [0, -2.8]];
      for (const [x, z] of tables) { const tb = new THREE.Mesh(rbox(1.6, 0.05, 0.95, 0.015), top); tb.position.set(x, 0.74, z); tb.castShadow = tb.receiveShadow = true; G.add(tb);
        for (const [lx, lz] of [[-0.7, -0.4], [0.7, -0.4], [-0.7, 0.4], [0.7, 0.4]]) { const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.74, 10), std(0x111, { metalness: 0.7, roughness: 0.4 })); lg.position.set(x + lx, 0.37, z + lz); G.add(lg); }
        for (const s of [-1, 1]) { const ch = new THREE.Group(); const seat = new THREE.Mesh(rbox(0.46, 0.05, 0.46, 0.012), chairM); seat.position.y = 0.46; const bk = new THREE.Mesh(rbox(0.46, 0.5, 0.04, 0.01), chairM); bk.position.set(0, 0.5, 0.22); ch.add(seat, bk);
          for (const [a, b] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.46, 8), chairM); l.position.set(a, 0.23, b); ch.add(l); }
          ch.position.set(x, 0, z + s * 0.75); ch.rotation.y = s > 0 ? 0 : Math.PI; ch.traverse(o => { if (o.isMesh) o.castShadow = true; }); G.add(ch); }
        if (x !== 0 || z !== 1.5) for (const s of [-1, 1]) { const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.015, 32), plateM); pl.position.set(x + s * 0.35, 0.775, z); G.add(pl); const gl = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.12, 20, 1, true), glassM); gl.position.set(x + s * 0.55, 0.83, z - 0.2); G.add(gl); }
        const nap = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.2), cloth); nap.position.set(x - 0.6, 0.775, z + 0.25); G.add(nap); }
      // pendant lamps (warm 2700 K)
      const shade = std(0x8a5a2b, { metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide }), bulbM = std(0xffffff, { emissive: 0xffc27a, emissiveIntensity: 6 });
      for (const [x, z] of tables) { const sh = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.24, 28, 1, true), shade); sh.position.set(x, 2.15, z); const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1.1), std(0x111)); cord.position.set(x, 2.82, z); const bl = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 10), bulbM); bl.position.set(x, 2.06, z); G.add(sh, cord, bl);
        const pl = new THREE.PointLight(0xffb070, 5.5, 6, 2); pl.position.set(x, 1.98, z); pl.castShadow = x === 0 && z === 1.5; if (pl.castShadow) { pl.shadow.mapSize.set(1024, 1024); pl.shadow.bias = -0.002; } G.add(pl); }
      // the karahi (cast iron, two handles) with modelled balti: oily sauce surface, chicken pieces, peppers, coriander, chilli
      const kar = new THREE.Group(); const iron = std(0x1c1b1a, { metalness: 0.75, roughness: 0.42 });
      const prof = []; for (let i = 0; i <= 12; i++) { const a = i / 12; prof.push(new THREE.Vector2(0.03 + Math.sin(a * Math.PI / 2) * 0.17, (1 - Math.cos(a * Math.PI / 2)) * 0.085)); } prof.push(new THREE.Vector2(0.205, 0.088));
      const bowl = new THREE.Mesh(new THREE.LatheGeometry(prof, 56), Object.assign(iron.clone(), { side: THREE.DoubleSide })); kar.add(bowl);
      for (const s of [-1, 1]) { const hd = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 10, 20, Math.PI), iron); hd.position.set(s * 0.215, 0.075, 0); hd.rotation.set(Math.PI / 2, 0, s > 0 ? -Math.PI / 2 : Math.PI / 2); kar.add(hd); }
      const sg = new THREE.CircleGeometry(0.185, 64, 0, Math.PI * 2); { const p = sg.attributes.position, r = rng(5); for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), d = Math.hypot(x, y); p.setZ(i, (Math.sin(x * 60) * Math.cos(y * 55) * 0.004 + (r() - 0.5) * 0.002) * (1 - d / 0.19)); } sg.computeVertexNormals(); }
      const sauce = new THREE.Mesh(sg, phys(0x7a1f05, { roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.15, sheen: 0.2 })); sauce.rotation.x = -Math.PI / 2; sauce.position.y = 0.06; kar.add(sauce);
      const chick = phys(0x9a4a1c, { roughness: 0.45, clearcoat: 0.7 }), pep = phys(0x2f7d1f, { roughness: 0.3, clearcoat: 0.8 }), rd = phys(0xb3160c, { roughness: 0.3, clearcoat: 0.8 }), cor = std(0x3f8f2a, { roughness: 0.6, side: THREE.DoubleSide });
      { const r = rng(21); for (let i = 0; i < 26; i++) { const a = r() * 6.283, d = Math.sqrt(r()) * 0.15; const c = new THREE.Mesh(lumpy(new THREE.BoxGeometry(0.034, 0.02, 0.026, 3, 2, 3), 0.6, i), chick); c.scale.set(1 + r() * 0.5, 0.8, 1); c.position.set(Math.cos(a) * d, 0.058, Math.sin(a) * d); c.rotation.set(r() * 3, r() * 3, r() * 3); c.castShadow = true; kar.add(c); }
        for (let i = 0; i < 10; i++) { const a = r() * 6.283, d = Math.sqrt(r()) * 0.15; const pp = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.004, 0.009), i % 3 ? pep : rd); pp.position.set(Math.cos(a) * d, 0.068, Math.sin(a) * d); pp.rotation.set(r() * 0.4, r() * 6, r() * 0.4); kar.add(pp); }
        const leaf = new THREE.Shape(); leaf.moveTo(0, 0); leaf.quadraticCurveTo(0.012, 0.008, 0, 0.022); leaf.quadraticCurveTo(-0.012, 0.008, 0, 0); const lg = new THREE.ShapeGeometry(leaf, 4);
        for (let i = 0; i < 26; i++) { const a = r() * 6.283, d = Math.sqrt(r()) * 0.15; const lf = new THREE.Mesh(lg, cor); lf.position.set(Math.cos(a) * d, 0.074, Math.sin(a) * d); lf.rotation.set(-Math.PI / 2 + (r() - 0.5) * 0.6, 0, r() * 6.283); kar.add(lf); } }
      kar.traverse(o => { if (o.isMesh) o.castShadow = true; }); kar.scale.setScalar(1.25); G.add(kar); this.kar = kar;
      const board = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.025, 40), pbr('wood', { color: 0x7a5230, rep: [1, 1], seed: 8 })); board.position.set(0.05, 0.778, 1.5); board.receiveShadow = true; G.add(board);
      // naan on a steel plate: puffy, char-spotted
      const naanT = canvasTex(512, 512, (g, w, h) => { g.fillStyle = '#e6b86a'; g.fillRect(0, 0, w, h); const r = rng(3); for (let i = 0; i < 260; i++) { const x = r() * w, y = r() * h, s = 4 + r() * 22, gr = g.createRadialGradient(x, y, 0, x, y, s); gr.addColorStop(0, r() < 0.4 ? 'rgba(60,30,10,0.85)' : 'rgba(160,95,35,0.6)'); gr.addColorStop(1, 'rgba(160,95,35,0)'); g.fillStyle = gr; g.fillRect(x - s, y - s, s * 2, s * 2); } });
      const ng = lumpy(new THREE.SphereGeometry(0.2, 40, 16), 0.12, 4); ng.scale(1, 0.06, 0.62); const naan = new THREE.Mesh(ng, phys(0xffffff, { map: naanT, roughness: 0.7, sheen: 0.3, clearcoat: 0.15 })); const nplate = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.22, 0.012, 40), steel);
      nplate.position.set(-0.52, 0.775, 1.42); naan.position.set(-0.52, 0.795, 1.42); naan.rotation.y = 0.4; naan.castShadow = true; G.add(nplate, naan);
      const chut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.035, 24), steel); chut.position.set(0.55, 0.79, 1.25); const chs = new THREE.Mesh(new THREE.CircleGeometry(0.045, 24), phys(0x6a9a3a, { roughness: 0.3, clearcoat: 0.6 })); chs.rotation.x = -Math.PI / 2; chs.position.set(0.55, 0.805, 1.25); G.add(chut, chs);
      // chef in whites at the range (hat + apron), and his karahi with a burner flame
      const chef = this.chef = buildPerson('shak'); G.add(chef); const hat = new THREE.Group(); const band = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.11, 0.09, 24), std(0xfafafa, { roughness: 0.9 })); const puff = new THREE.Mesh(lumpy(new THREE.SphereGeometry(0.15, 24, 16), 0.25, 2), std(0xfafafa, { roughness: 0.95 })); puff.scale.set(1, 0.65, 1); puff.position.y = 0.11; hat.add(band, puff); this.chefHat = hat;
      const apron = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.7), std(0x2a2a2a, { roughness: 0.9, side: THREE.DoubleSide })); this.chefApron = apron;
      const pan = new THREE.Group(); const pb = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), Object.assign(iron.clone(), { side: THREE.DoubleSide })); pan.add(pb); const ps = new THREE.Mesh(new THREE.CircleGeometry(0.18, 40), phys(0x9c2f08, { roughness: 0.3, clearcoat: 0.9 })); ps.rotation.x = -Math.PI / 2; ps.position.y = 0.055; pan.add(ps); pan.scale.setScalar(1.6); G.add(pan);
      const fire = new Particles(260, { tex: T.flame, additive: true, life: 0.55, H, spawn: (i, k, r, o, t) => { const a = r() * 6.283, d = r() * 0.32; const sw = Math.sin(t * 9 + i) * 0.04; o.x = pan.position.x + Math.cos(a) * d * (1 - k * 0.6) + sw * k; o.z = pan.position.z + Math.sin(a) * d * (1 - k * 0.6); o.y = 0.93 + k * (0.55 + r() * 0.7) * this.fireH; o.s = (0.16 + r() * 0.14) * (1 - k * 0.7) * (0.6 + this.fireH * 0.6); o.a = Math.sin(k * Math.PI) * (0.12 + this.fireH * 0.3); fireCol(k, o); } });
      const embers = new Particles(80, { tex: T.soft, additive: true, life: 1.2, H, spawn: (i, k, r, o, t) => { o.x = pan.position.x + (r() - 0.5) * 0.4 + Math.sin(k * 6 + i) * 0.1 * k; o.z = pan.position.z + (r() - 0.5) * 0.4; o.y = 1.0 + k * (1.2 + r()) * this.fireH; o.s = 0.012 + r() * 0.012; o.a = (1 - k) * (this.fireH > 0.6 ? 1 : 0); o.r = 3; o.g = 1.4; o.b = 0.3; } });
      const smoke = new Particles(60, { tex: T.smoke, life: 2.5, H, spawn: (i, k, r, o) => { o.x = pan.position.x + (r() - 0.5) * 0.3 + k * 0.2; o.z = pan.position.z + (r() - 0.5) * 0.3; o.y = 1.4 + k * 1.4; o.s = 0.3 + k * 0.9; o.a = Math.sin(k * Math.PI) * 0.12 * this.fireH; o.r = o.g = o.b = 0.5; } });
      const steam = new Particles(90, { tex: T.smoke, life: 2.2, H, spawn: (i, k, r, o, t) => { const a = r() * 6.283, d = r() * 0.17; o.x = kar.position.x + Math.cos(a) * d + Math.sin(t * 1.3 + i) * 0.03 * k + k * 0.05; o.z = kar.position.z + Math.sin(a) * d; o.y = kar.position.y + 0.1 + k * (0.5 + r() * 0.3); o.s = 0.04 + k * 0.16; o.a = Math.sin(k * Math.PI) * 0.07 * this.steamA; o.r = o.g = o.b = 1.0; } });
      const spit = new Particles(70, { tex: T.soft, additive: true, life: 0.35, H, spawn: (i, k, r, o) => { const a = r() * 6.283, v = 0.4 + r() * 0.6; o.x = kar.position.x + Math.cos(a) * (0.05 + k * 0.25 * v); o.z = kar.position.z + Math.sin(a) * (0.05 + k * 0.25 * v); o.y = kar.position.y + 0.09 + (k * 1.4 - k * k * 2) * 0.25 * v; o.s = 0.006 + r() * 0.006; o.a = (1 - k) * this.sizzle; o.r = 2.2; o.g = 1.5; o.b = 0.8; } });
      G.add(fire, embers, smoke, steam, spit); const fl = new THREE.PointLight(0xff7a2a, 0, 6, 2); G.add(fl);
      const amb = new THREE.AmbientLight(0xffd9b0, 0.08); G.add(amb);
      upd = t => { const S = this.shak, B = this.bones; S.visible = true;
        // chef: rev + toss (4.4 - 8.4), slides the karahi down the pass (8.0 - 8.6)
        chef.position.set(0.2, 0, -9.0); chef.rotation.y = face(0, 1); const CB = this.chefBones || (chef.userData.person.mix ? (this.chefBones = this.bonesOf(chef)) : null);
        this.fireH = t > 4.4 && t < 8.4 ? 0.5 + 0.5 * cl(Math.sin((t - 4.4) * 5.5) * 0.5 + 0.5 + (t > 5.6 && t < 7.4 ? 0.5 : 0)) : t > 1 && t < 4.4 ? 0.25 : 0.12;
        const toss = t > 5.6 && t < 7.6 ? Math.max(0, Math.sin((t - 5.6) * 7)) : 0; pan.position.set(-0.8, 0.93 + toss * 0.12, -9.6); pan.rotation.z = toss * 0.25;
        fl.position.set(-0.8, 1.4, -9.4); fl.intensity = 1.5 + this.fireH * 7 + Math.sin(t * 37) * 1.2 * this.fireH;
        // the karahi arrives at Shak's table
        const arr = sm(cl((t - 8.4) / 0.9)); kar.position.set(L(-0.8, 0.05, arr), L(1.2, 0.79, arr), L(-5.9, 1.5, arr)); kar.visible = t > 8.4;
        this.steamA = kar.visible ? 1 : 0; this.sizzle = t > 9.0 && t < 12.6 ? 1 - (t - 9) / 4 : 0;
        fire.at(t); embers.at(t); smoke.at(t); steam.at(t); spit.at(t);
        // Shak seated, facing the pass (-z) at the table
        S.position.set(0.0, 0, 2.28); S.rotation.y = face(0, -1); this.spd = 0; this.post = () => { this.sit(B, t > 12.6 ? -0.25 * sm(cl((t - 12.6) / 0.4)) : t > 9.2 ? 0.18 * sm(cl((t - 9.2) / 0.6)) : 0);
          if (B.Head) { B.Head.rotation.y += t < 4.4 ? Math.sin(t * 0.8) * 0.25 : 0; }
          if (t > 12.6 && B.Head) { B.Head.rotation.z += Math.sin((t - 12.6) * 30) * 0.05; } // spice shudder
                    if (CB?.R_Forearm) { CB.R_Forearm.rotation.z += 0.5 + toss * 0.5; } };
        S.position.y = -0.47 + (t > 12.6 && t < 15 ? Math.sin(t * 40) * 0.006 : 0);
        this.shot(t, [[0, [4.5, 1.7, 7], [0, 1.0, 2], [1.6, 1.25, 4.3], [0, 1.05, 1.9], 0.003], [4.4, [1.4, 1.75, -6.6], [-0.6, 1.2, -9.4], [0.4, 1.5, -7.2], [-0.8, 1.15, -9.6], 0.004],
          [8.4, [0.9, 1.25, 0.5], [0.05, 0.85, 1.5], [0.55, 1.05, 0.75], [0.05, 0.82, 1.5], 0.006], [10.4, [-0.9, 1.15, 0.8], [0, 1.05, 2.1], [-0.7, 1.2, 0.95], [0, 1.1, 2.15], 0.004], [12.6, [0.5, 1.3, 0.2], [0, 1.15, 2.2], [0.25, 1.25, 0.55], [0, 1.15, 2.2], 0.003]]); };
      this.lightRig = 'interior'; }
    else if (id === 'cabs') { this.street(G, { shops: [['CUZZY CABS 24/7', '#111', '#ffd400', '#ffd400'], ['FADE KINGS', '#3a1010', '#fff'], ['BRUM MINI MART', '#0b3d2e', '#fff'], ['PHONE DOCTOR', '#102040', '#7fd3ff'], ['CHICK KING', '#7a0f0f', '#ffd27a'], ['BET YA CUZ', '#0c4a1e', '#fff']] });
      const car = this.realCar('#ffcc00') || this.blockCar(0xffd400); G.add(car); this.taxi = car;
      const rs = new THREE.Mesh(rbox(0.9, 0.24, 0.3, 0.04), new THREE.MeshStandardMaterial({ map: signTex('CUZZY CABS', { bg: '#ffd400', fg: '#111' }), emissive: 0xffd400, emissiveIntensity: 0.25 })); rs.position.set(0, 1.5, 0); rs.rotation.y = Math.PI / 2; car.add(rs);
      const box = new THREE.Box3().setFromObject(car); this.taxiLen = box.max.z - box.min.z; rs.position.y = box.max.y + 0.02;
      const cones = []; const coneM = std(0xff5a00, { roughness: 0.5 }), band = std(0xffffff, { roughness: 0.4 }); for (let i = 0; i < 6; i++) { const c = new THREE.Group(); const cn = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.72, 24), coneM); cn.position.y = 0.38; const bs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.4), coneM); bs.position.y = 0.02; const bd = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.1, 24, 1, true), band); bd.position.y = 0.42; c.add(cn, bs, bd); c.traverse(o => { if (o.isMesh) o.castShadow = true; }); c.position.set(6 + i * 1.4, 0, 1.6); cones.push(c); G.add(c); }
      const dust = new Particles(80, { tex: this.tex.smoke, life: 1.6, H, spawn: (i, k, r, o) => { o.x = car.position.x - 2 + (r() - 0.5) * 1.2 - k * 1.5; o.z = car.position.z + (r() - 0.5) * 1.6; o.y = 0.2 + k * 0.8; o.s = 0.3 + k * 1.2; o.a = Math.sin(k * Math.PI) * 0.18 * this.dust; o.r = o.g = 0.85; o.b = 0.8; } }); G.add(dust);
      upd = t => { const x = t < 4.2 ? L(-40, -2, sm(cl(t / 4))) : t < 8.6 ? -2 : L(-2, 40, cl((t - 8.6) / 4) ** 2), k = cl((t - 8.6) / 4); car.position.set(x, 0, t < 8.6 ? 2.6 : 2.6 - Math.sin(k * Math.PI) * 1.4); car.rotation.y = Math.PI / 2 + (t > 8.6 && t < 12.6 ? Math.sin(k * Math.PI * 2) * 0.12 : 0);
        this.dust = t > 8.6 && t < 13 ? 1 : 0; dust.at(t);
        cones.forEach((c, i) => { const ht = t > 8.6 ? cl((car.position.x + 2 - c.userData.x0 || 0)) : 0; c.userData.x0 ??= c.position.x; const kk = t > 8.6 ? cl((car.position.x - c.userData.x0 + 2.2) / 6) : 0; c.position.set(c.userData.x0 + kk * 4, Math.sin(kk * Math.PI) * 1.4, 1.6 - kk * 2.5 * ((i % 2) * 2 - 1)); c.rotation.set(kk * 5 * ((i % 2) * 2 - 1), 0, kk * 7); });
        const S = this.shak; const out = t > 4.4 && t < 9.4; S.visible = out; S.position.set(L(-2.6, -1.4, sm(cl((t - 4.4) / 1.4))), 0, L(3.4, 6.6, sm(cl((t - 4.4) / 1.6)))); S.rotation.y = t < 6 ? face(0.3, 1) : face(1, -1.2); this.spd = t > 4.4 && t < 6 ? 1.4 : 0; this.post = null;
        this.shot(t, [[0, [8, 1.1, 10], [-14, 0.9, 2.6], [3, 1.2, 10], [-3, 0.9, 2.6], 0.002], [4.2, [1.5, 1.6, 11], [-2, 1.2, 4.5], [-0.2, 1.62, 9.8], [-1.6, 1.5, 6.4], 0.004], [8.6, [-7, 2.2, 11], [3, 0.8, 2], [16, 3, 11], [17, 1, 1], 0.0015], [12.6, [14, 1.4, 9.5], [17, 1.1, 2], [11, 1.6, 9], [14, 1.0, 1.5], 0.0025]]); };
      this.lightRig = 'day'; }
    else if (id === 'grime') { // studio in a railway arch: brick vault, acoustic foam, desk, monitors, mic + pop filter, haze
      const brick = pbr('brick', { rep: [6, 3], color: 0x7a3a28 }), floorM = pbr('wood', { rep: [4, 4], color: 0x2a1d16 }); this.room(G, 10, 10, 4.2, brick, floorM);
      const vault = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 10, 48, 1, true, -Math.PI / 2, Math.PI), brick); vault.rotation.z = Math.PI / 2; vault.rotation.y = Math.PI / 2; vault.position.y = 2.2; vault.material = brick.clone(); vault.material.side = THREE.BackSide; G.add(vault);
      const foam = pbr('foam', { rep: [3, 1.5] }); for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.6, 3.2), foam); f.position.set(s * 4.4, 1.9, -1.5); G.add(f); } const fb = new THREE.Mesh(new THREE.BoxGeometry(4, 1.6, 0.08), foam); fb.position.set(0, 2.1, -4.9); G.add(fb);
      const neon = []; for (const [x, c] of [[-4.3, 0xff2fb0], [4.3, 0x00e5ff]]) { const n = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3, 12), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: c, emissiveIntensity: 5 })); n.position.set(x, 1.9, 0.6); G.add(n); const pl = new THREE.PointLight(c, 10, 9, 2); pl.position.set(x * 0.85, 2, 0.6); G.add(pl); neon.push(pl); }
      this.sign(G, 'GRIME FM 0121', { bg: '#07000f', fg: '#00e5ff', glow: '#00e5ff' }, 0, 3.4, -4.85, 3.6, 0.72, 0, 1.6);
      const desk = new THREE.Mesh(rbox(2.4, 0.08, 0.9, 0.02), std(0x151515, { roughness: 0.4 })); desk.position.set(0, 0.78, -1.9); G.add(desk);
      const mixer = new THREE.Mesh(rbox(1.2, 0.07, 0.55, 0.01), std(0x222326, { metalness: 0.5, roughness: 0.35 })); mixer.position.set(0, 0.86, -1.9); mixer.rotation.x = 0.12; G.add(mixer);
      const leds = new THREE.InstancedMesh(new THREE.BoxGeometry(0.018, 0.01, 0.018), new THREE.MeshStandardMaterial({ color: 0, emissive: 0x33ff66, emissiveIntensity: 3 }), 96); { const o = new THREE.Object3D(); for (let i = 0; i < 96; i++) { o.position.set(-0.55 + (i % 24) * 0.048, 0.93, -2.1 + Math.floor(i / 24) * 0.11); o.updateMatrix(); leds.setMatrixAt(i, o.matrix); } } G.add(leds);
      const wav = canvasTex(512, 256, (g, w, h) => { g.fillStyle = '#05070a'; g.fillRect(0, 0, w, h); g.strokeStyle = '#00e5ff'; g.lineWidth = 2; g.beginPath(); for (let x = 0; x < w; x++) { const y = h / 2 + Math.sin(x * 0.09) * Math.sin(x * 0.013) * h * 0.4; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); g.fillStyle = '#ff2fb0'; g.font = 'bold 28px monospace'; g.fillText('GRIME_FM_LIVE.wav', 12, 34); });
      for (const x of [-0.75, 0.75]) { const mon = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.38, 0.03), std(0x0a0a0a)); mon.position.set(x, 1.15, -2.25); mon.rotation.y = -x * 0.4; const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.34), new THREE.MeshStandardMaterial({ map: wav, emissive: 0xffffff, emissiveMap: wav, emissiveIntensity: 1.2 })); scr.position.set(x + Math.sin(-x * 0.4) * 0.016, 1.15, -2.234); scr.rotation.y = -x * 0.4; G.add(mon, scr); }
      const spk = []; for (const x of [-1.6, 1.6]) { const b = new THREE.Mesh(rbox(0.5, 0.8, 0.45, 0.03), std(0x111111, { roughness: 0.6 })); b.position.set(x, 0.82, -2.3); const cone = new THREE.Mesh(new THREE.LatheGeometry([0.02, 0.08, 0.15, 0.18].map((r, i) => new THREE.Vector2(r, -i * 0.012)), 32), std(0x2a2a2a, { roughness: 0.8, side: THREE.DoubleSide })); cone.rotation.x = -Math.PI / 2; cone.position.set(x, 1.08, -2.07); G.add(b, cone); spk.push(cone); }
      const mic = new THREE.Group(); const metal = std(0x333, { metalness: 1, roughness: 0.3 }); const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.55, 12), metal); pole.position.y = 0.78; const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.03, 24), metal);
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.12, 8, 16), std(0x9a9a9a, { metalness: 1, roughness: 0.25 })); body.rotation.x = Math.PI / 2; body.position.set(0, 1.6, 0.09); const pop = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.006, 8, 32), metal); pop.position.set(0, 1.6, 0.2);
      const mesh = new THREE.Mesh(new THREE.CircleGeometry(0.072, 32), new THREE.MeshStandardMaterial({ color: 0x111, transparent: true, opacity: 0.55, side: THREE.DoubleSide })); mesh.position.set(0, 1.6, 0.2); mic.add(pole, base, body, pop, mesh); mic.position.set(0, 0, -0.6); G.add(mic);
      const phones = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.014, 10, 30, Math.PI), std(0x111, { roughness: 0.4 })); this.phones = phones;
      const haze = new Particles(50, { tex: this.tex.smoke, life: 9, H, spawn: (i, k, r, o) => { o.x = (r() - 0.5) * 8 + k * 0.6; o.z = (r() - 0.5) * 6 - 1; o.y = 0.5 + r() * 3; o.s = 1.6 + r() * 1.6; o.a = Math.sin(k * Math.PI) * 0.06; o.r = 0.6; o.g = 0.55; o.b = 0.8; } }); G.add(haze);
      const key = new THREE.SpotLight(0xffe2c8, 30, 10, 0.45, 0.7, 2); key.position.set(1.8, 3.4, 1.8); key.target.position.set(0, 1.5, -0.2); key.castShadow = true; G.add(key, key.target);
      upd = t => { const beat = Math.pow(1 - ((t * 140 / 60) % 1), 4); spk.forEach(s => s.scale.set(1, 1, 1 + beat * 1.5)); neon.forEach((n, i) => n.intensity = 8 + beat * 10 * (i ? 1 : 0.7)); haze.at(t);
        const S = this.shak, B = this.bones; S.visible = true; S.position.set(0, 0, -0.1); S.rotation.y = face(0, -1); this.spd = 0;
        if (!phones.parent) { S.add(phones); phones.position.set(0, 1.66, 0.0); phones.rotation.set(0, 0, 0); phones.scale.set(1, 1.1, 1); }
        this.post = () => { if (!B.Head) return; B.Head.rotation.z += -beat * 0.12; B.Neck.rotation.z += -beat * 0.06; B.Spine1.rotation.z += -beat * 0.03; };
        this.shot(t, [[0, [0, 2.4, 4.6], [0, 1.4, -2], [0, 1.9, 2.9], [0, 1.55, -0.3], 0.002], [4.2, [1.3, 1.7, -1.7], [0, 1.6, -0.1], [-1.3, 1.65, -1.7], [0, 1.6, -0.1], 0.005], [8.6, [-2.2, 0.7, 1.8], [-1.6, 1.0, -2.2], [2.2, 0.9, 1.8], [1.6, 1.0, -2.2], 0.003], [12.6, [0, 1.62, -1.5], [0, 1.6, -0.1], [0, 1.62, -1.15], [0, 1.6, -0.1], 0.006]]); };
      this.lightRig = 'dark'; }
    else { // bullpen: high street + Selfwidges-style disc building
      this.street(G, { gap: [22, 40], shops: [['BULLPEN CENTRE · MEGA SALE', '#c4002b', '#fff', '#ff3355'], ['THREADZ', '#111', '#fff'], ['DRIP DEPOT', '#1d5fbf', '#fff'], ['GOLD & GLITZ', '#1a1205', '#e8c35a'], ['BEAN THERE', '#2b1a10', '#f2d2a0'], ['SALE 90% OFF', '#ffe100', '#111']] });
      const disc = new THREE.Group(); const blob = new THREE.Mesh(new THREE.SphereGeometry(9, 64, 32), phys(0x0f1c33, { roughness: 0.35, clearcoat: 0.6 })); blob.scale.set(1.6, 1.05, 0.7); blob.position.y = 8; disc.add(blob);
      const dm = std(0xe6e8ec, { metalness: 1, roughness: 0.12 }); const dg = new THREE.SphereGeometry(0.42, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2.6); const im = new THREE.InstancedMesh(dg, dm, 1400); const o = new THREE.Object3D(); let n = 0;
      for (let i = 0; i < 46; i++) for (let j = 0; j < 30 && n < 1400; j++) { const th = (i / 46) * Math.PI * 1.1 - Math.PI * 0.55, ph = 0.15 + (j / 30) * (Math.PI - 0.3); const u = new THREE.Vector3(Math.sin(ph) * Math.sin(th), Math.cos(ph), Math.sin(ph) * Math.cos(th)); if (u.z < 0.1) continue;
        const p = new THREE.Vector3(u.x * 9 * 1.6, 8 + u.y * 9 * 1.05, u.z * 9 * 0.7); const nn = new THREE.Vector3(u.x / 1.6, u.y / 1.05, u.z / 0.7).normalize(); o.position.copy(p).addScaledVector(nn, 0.05); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), nn); o.updateMatrix(); im.setMatrixAt(n++, o.matrix); }
      im.count = n; disc.add(im); disc.position.set(30, 0, -26); G.add(disc); this.sign(G, 'SELFWIDGES', { bg: '#ffe100', fg: '#111' }, 30, 2.2, -19.4, 7, 1.3, 0, 0.4);
      const bagM = [0xc4002b, 0xffe100, 0x111111, 0x1d5fbf].map(c => phys(c, { roughness: 0.4, clearcoat: 0.5 })); const bags = bagM.map(m => { const b = new THREE.Group(); const bx = new THREE.Mesh(rbox(0.32, 0.4, 0.12, 0.01), m); const hd = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.006, 6, 16, Math.PI), std(0x222)); hd.position.y = 0.4; b.add(bx, hd); b.traverse(x => { if (x.isMesh) x.castShadow = true; }); G.add(b); return b; }); this.bagsG = bags;
      const confetti = new Particles(200, { tex: this.tex.soft, life: 3, H, spawn: (i, k, r, o, t) => { o.x = 18 + (r() - 0.5) * 8 + Math.sin(k * 8 + i) * 0.4; o.z = 2 + (r() - 0.5) * 5; o.y = 6 - k * 6; o.s = 0.05; o.a = t > 12.6 ? 1 : 0; const c = [[3, 0.2, 0.3], [3, 2.6, 0.2], [0.3, 1, 3], [2.5, 2.5, 2.5]][i % 4]; o.r = c[0]; o.g = c[1]; o.b = c[2]; } }); G.add(confetti);
      upd = t => { const S = this.shak, B = this.bones; S.visible = true; const run = t > 4.4 && t < 12.6; S.position.set(t < 4.4 ? -4 : t < 12.6 ? L(-4, 18, cl((t - 4.4) / 8.2)) : 18, 0, 4); S.rotation.y = run ? face(1, 0) : face(0, 1); this.spd = run ? 4.4 : 0; confetti.at(t);
        const nb = t < 4.4 ? 0 : t < 8.6 ? 2 : 4; S.updateMatrixWorld(true); const hand = s => { const h = B[s + '_Hand']; return h ? h.getWorldPosition(new THREE.Vector3()) : S.position.clone().add(new THREE.Vector3(0, 0.8, 0)); };
        this.post = () => { S.updateMatrixWorld(true); bags.forEach((b, i) => { b.visible = i < nb || t > 12.6; if (t > 12.6) { b.position.set(18 - 0.7 + i * 0.45, 0.0, 4.6); b.rotation.set(0, 0.3 * i, 0); return; } const p = hand(i % 2 ? 'L' : 'R'); b.position.set(p.x, p.y - 0.44 - (i >> 1) * 0.03, p.z + (i >> 1) * 0.08); b.rotation.set(0, S.rotation.y, 0); }); if (t > 12.6 && B.R_UpperArm) { B.R_UpperArm.rotation.z += 2.4; B.L_UpperArm.rotation.z += 2.4; } };
        this.shot(t, [[0, [-4, 1.65, 8.5], [-4, 1.45, 4], [-4, 1.7, 6.6], [-4, 1.55, 4], 0.004], [4.4, [-9, 1.0, 8.5], [-4, 0.9, 4], [3, 1.3, 8.5], [6, 0.9, 4], 0.002], [8.6, [9, 1.5, 9], [6, 1, 4], [21, 1.5, 9], [20, 1.1, 4], 0.002], [12.6, [18, 1.4, 9.5], [24, 6, -20], [16.5, 1.3, 8], [24, 8, -24], 0.0012]]); };
      this.lightRig = 'day'; }
    G.visible = false; this.sc.add(G); return (this.sets[id] = { G, upd, rig: this.lightRig });
  }
  blockCar(color) { const G = new THREE.Group(); const b = new THREE.Mesh(rbox(4.4, 0.8, 1.8, 0.2), phys(color, { metalness: 0.5, roughness: 0.3, clearcoat: 1 })); b.position.y = 0.3; G.add(b); G.rotation.y = Math.PI / 2; return G; }
  // camera shots: [tStart, camFrom, lookFrom, camTo, lookTo, aperture]; each runs until the next shot starts; focus = look target
  shot(t, list) { let i = 0; while (i + 1 < list.length && t >= list[i + 1][0]) i++; const s = list[i], e = list[i + 1] ? list[i + 1][0] : this.A.dur; const k = sm(cl((t - s[0]) / (e - s[0])));
    const p = s[1].map((v, j) => L(v, s[3][j], k)), l = s[2].map((v, j) => L(v, s[4][j], k)); this.cam.position.set(...p); this.cam.lookAt(...l); this.focus = Math.hypot(p[0] - l[0], p[1] - l[1], p[2] - l[2]); this.aperture = s[5] ?? 0.002; }
  load(i) { for (const k in this.sets) this.sets[k].G.visible = false; const A = ADS[i]; this.A = A; this.set = this.build(A.id); this.set.G.visible = true;
    const rig = this.set.rig; this.cam.fov = 35; this.cam.aspect = this.W / this.H; this.cam.updateProjectionMatrix();
    if (rig === 'day') { this.sc.background = new THREE.Color(0xa9c2df); this.sc.fog = new THREE.Fog(0xa9c2df, 50, 170); this.sun.intensity = 2.8; this.hemi.intensity = 0.55; this.sc.environmentIntensity = 1; this.r.toneMappingExposure = 1.0; }
    else if (rig === 'interior') { this.sc.background = new THREE.Color(0x120b08); this.sc.fog = null; this.sun.intensity = 0; this.hemi.intensity = 0.06; this.sc.environmentIntensity = 0.25; this.r.toneMappingExposure = 1.15; }
    else { this.sc.background = new THREE.Color(0x05030a); this.sc.fog = null; this.sun.intensity = 0; this.hemi.intensity = 0.05; this.sc.environmentIntensity = 0.15; this.r.toneMappingExposure = 1.1; }
    this.shak.visible = true; }
  frame(t, opt = {}) { const S = this.shak, P = S.userData.person; this.spd = 0; this.post = null; S.position.y = 0; this.set.upd(t);
    animPerson(S, 0, this.spd, 'walk'); if (P.mix) P.mix.setTime(t);
    if (this.chef && this.set.G.name === 'balti') { const cp = this.chef.userData.person; if (cp.mix) { animPerson(this.chef, 0, 0, 'walk'); cp.mix.setTime(t + 3);
        if (!this.chefHat.parent) { this.chef.add(this.chefHat); this.chefHat.position.set(0, 1.83, 0.01); {  this.chef.add(this.chefApron); this.chefApron.position.set(0, 0.85, -0.14); this.chefApron.rotation.y = Math.PI; } } } }
    if (this.post) this.post();
    this.bokeh.uniforms.focus.value = this.focus || 4; this.bokeh.uniforms.aperture.value = this.aperture || 0.002; this.bokeh.uniforms.maxblur.value = 0.01;
    this.comp.render(); this.overlay(t, opt); return this.out; }
  overlay(t, opt) { const g = this.g, W = this.W, H = this.H, A = this.A, u = H / 1080; g.drawImage(this.r.domElement, 0, 0);
    // letterbox bars + channel bug
    g.fillStyle = '#000'; g.fillRect(0, 0, W, 60 * u); g.fillRect(0, H - 60 * u, W, 60 * u);
    g.font = `800 ${28 * u}px Arial, sans-serif`; g.fillStyle = 'rgba(255,255,255,0.85)'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText('CUZZY TV', 40 * u, 30 * u);
    g.textAlign = 'right'; g.font = `500 ${20 * u}px Arial, sans-serif`; g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillText('Parody ad · all brands made up', W - 40 * u, 30 * u);
    for (const [a, b, txt] of A.caps) if (t >= a && t < b) { const k = cl((t - a) / 0.25) * cl((b - t) / 0.25); g.globalAlpha = k; g.font = `900 ${64 * u}px Impact, 'Arial Black', sans-serif`; g.textAlign = 'center'; const w = g.measureText(txt).width + 80 * u;
      const y = H - 170 * u + (1 - k) * 30 * u; g.fillStyle = A.c2; g.fillRect(W / 2 - w / 2, y - 50 * u, w, 100 * u); g.fillStyle = A.c1; g.fillRect(W / 2 - w / 2, y + 42 * u, w, 8 * u); g.fillStyle = A.ink === '#111111' ? '#ffffff' : A.ink; g.fillText(txt, W / 2, y + 4 * u); g.globalAlpha = 1; }
    if (t >= 15) { const k = sm(cl((t - 15) / 0.5)); g.globalAlpha = k; const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, A.c2); gr.addColorStop(1, A.c1); g.fillStyle = gr; g.fillRect(0, 60 * u, W, H - 120 * u);
      g.drawImage(this.r.domElement, W * 0.58, H * 0.18, W * 0.38, H * 0.38 * 1.0); g.strokeStyle = '#fff'; g.lineWidth = 6 * u; g.strokeRect(W * 0.58, H * 0.18, W * 0.38, H * 0.38);
      g.textAlign = 'left'; g.fillStyle = A.ink === '#111111' ? '#111' : '#fff'; const s = 1 + Math.sin((t - 15) * 6) * 0.02 * (1 - cl(t - 15.5)); g.font = `900 ${150 * u * s}px Impact, 'Arial Black', sans-serif`; g.fillText(A.end[0], 80 * u, H * 0.45);
      g.font = `700 ${60 * u}px Arial, sans-serif`; g.fillText(A.end[1], 84 * u, H * 0.62); g.font = `500 ${34 * u}px Arial, sans-serif`; g.fillText(A.tag, 84 * u, H * 0.72); g.fillText('Starring SHAK', 84 * u, H * 0.8); g.globalAlpha = 1; }
    if (t < 0.3) { g.fillStyle = `rgba(0,0,0,${1 - t / 0.3})`; g.fillRect(0, 0, W, H); } if (t > A.dur - 0.4) { g.fillStyle = `rgba(0,0,0,${(t - A.dur + 0.4) / 0.4})`; g.fillRect(0, 0, W, H); } }
  // poster still: campaign layout with an in-engine render of Shak (mode 'wide' 2:1 billboard, 'tall' 1:2 shelter / shop poster)
  poster(pi) { const Pst = POSTERS[pi], A = ADS[Pst.ad], c1 = Pst.c1 || A.c1, c2 = Pst.c2 || A.c2, ink = Pst.ink || A.ink; this.load(Pst.ad); const W = this.W, H = this.H, g = this.g, tall = H > W, u = Math.min(W, H) / 1024;
    for (const k in this.sets) this.sets[k].G.visible = false; this.sc.background = null; this.sc.fog = null; this.sc.environmentIntensity = 1; this.r.toneMappingExposure = 1; this.sun.intensity = 2.8; this.hemi.intensity = 0.8; if (this.bags) this.bags.forEach(([b]) => b.visible = false);
    const S = this.shak, P = S.userData.person; S.visible = true; S.position.set(0, 0, 0); S.rotation.y = Pst.pose === 'run' ? (tall ? -0.9 : -0.6) : Math.PI + (tall ? 0.25 : -0.45); animPerson(S, 0, Pst.pose === 'run' ? 4.5 : Pst.pose === 'walk' ? 1.4 : 0, 'walk'); if (P.mix) P.mix.setTime(Pst.pose === 'run' ? 0.3 : 0.6);
    this.cam.aspect = W / H; this.cam.fov = 30; this.cam.updateProjectionMatrix(); if (tall) { this.cam.position.set(0, 1.0, 6.2); this.cam.lookAt(0, 0.45, 0); } else { this.cam.position.set(1.7, 1.0, 4.6); this.cam.lookAt(1.35, 0.92, 0); }
    this.r.setClearColor(0, 0); this.r.render(this.sc, this.cam);
    const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, c2); gr.addColorStop(1, c1); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.12; g.fillStyle = '#fff'; for (let i = -H; i < W; i += 80 * u) { g.beginPath(); g.moveTo(i, H); g.lineTo(i + H, 0); g.lineTo(i + H + 30 * u, 0); g.lineTo(i + 30 * u, H); g.fill(); } g.globalAlpha = 1;
    g.drawImage(this.r.domElement, 0, 0); const tc = ink === '#111111' ? '#111' : '#fff';
    const fit = (txt, max, size, wt = 900, fam = "Impact, 'Arial Black', sans-serif") => { let s = size; g.font = `${wt} ${s}px ${fam}`; while (g.measureText(txt).width > max && s > 8) { s *= 0.94; g.font = `${wt} ${s}px ${fam}`; } return s; };
    const wrap = (txt, x, y, max, size, lh) => { const ws = txt.split(' '); let line = '', yy = y; g.font = `700 ${size}px Arial, sans-serif`; for (const w of ws) { const tl = line ? line + ' ' + w : w; if (g.measureText(tl).width > max && line) { g.fillText(line, x, yy); line = w; yy += lh; } else line = tl; } g.fillText(line, x, yy); };
    g.fillStyle = tc; g.textBaseline = 'alphabetic'; g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 12 * u;
    if (tall) { g.textAlign = 'center'; fit(Pst.head, W * 0.9, 170 * u); g.fillText(Pst.head, W / 2, H * 0.1); wrap(Pst.sub, W / 2, H * 0.86, W * 0.86, 52 * u, 62 * u); }
    else { g.textAlign = 'left'; fit(Pst.head, W * 0.5, 190 * u); g.fillText(Pst.head, W * 0.46, H * 0.4); wrap(Pst.sub, W * 0.46, H * 0.56, W * 0.5, 58 * u, 70 * u); g.font = `600 ${36 * u}px Arial, sans-serif`; g.fillText('Starring SHAK · ' + A.tag, W * 0.46, H * 0.86); }
    g.shadowBlur = 0; g.font = `600 ${22 * u}px Arial, sans-serif`; g.textAlign = 'right'; g.globalAlpha = 0.7; g.fillText('Parody ad · Cuzzy Racing', W - 24 * u, H - 24 * u); g.globalAlpha = 1; return this.out; }
}
