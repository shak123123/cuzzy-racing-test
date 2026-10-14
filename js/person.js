// On-foot people. buildPerson('shak') is the player: Shak's own look (cream linen blazer over a camel crew-neck, black
// trousers, white trainers, black sunglasses, short dark styled hair, watch) with his face photo on the head.
// buildPerson(n) gives a generic pedestrian / other player (outfit picked from n). animPerson() drives the walk / run
// / idle / dance cycles. Every person faces -Z (like the cars), feet at y = 0, about 1.8 m tall.
import * as THREE from 'three';
import { GLTFLoader } from './lib/addons/loaders/GLTFLoader.js';
const M = (c, r = 0.8, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
let faceMat = null;
function shakFace(head) { // face photo, faded to transparent at the edges so it blends into the head, skin tinted to match
  if (faceMat) return faceMat; faceMat = new THREE.MeshStandardMaterial({ transparent: true, roughness: 0.75, depthWrite: true });
  const img = new Image(); img.crossOrigin = 'anonymous';
  img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    try { const d = g.getImageData(c.width * 0.42, c.height * 0.55, 12, 12).data; let r = 0, gg = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; } const n = d.length / 4; for (const m of head) m.color.setRGB(r / n / 255, gg / n / 255, b / n / 255).convertSRGBToLinear(); } catch (e) { }
    g.globalCompositeOperation = 'destination-in'; const gr = g.createRadialGradient(c.width / 2, c.height * 0.52, c.width * 0.25, c.width / 2, c.height * 0.52, c.width * 0.52);
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; faceMat.map = t; faceMat.needsUpdate = true; };
  img.src = 'real/me/face.jpg'; return faceMat;
}
const LOOKS = [ // generic people: [skin, hair, top, legs, shoe, jacket?]
  [0xc68e6a, 0x1a1410, 0x2a4d8f, 0x23324a, 0x222222, null], [0x8d5a3b, 0x0d0b09, 0x8f2a2a, 0x1c1c22, 0xeeeeee, 0x202020], [0xe0b9a0, 0x6b4a2a, 0x2a8f5a, 0x4a5a6a, 0x553322, null],
  [0x5c3a26, 0x0d0b09, 0xe8e8e8, 0x2b2b30, 0x111111, 0x3a2f55], [0xb07d5e, 0x2a1d14, 0xd9a520, 0x1f2a44, 0xffffff, null], [0x9a6646, 0x120e0b, 0x111111, 0x111111, 0xb02020, 0x7a1d2a]];
export function buildPerson(look = 'shak') {
  const shak = look === 'shak', L = shak ? { skin: 0xa0694a, hair: 0x14100c, top: 0xa8744e, legs: 0x141519, shoe: 0xf3f3ef, jacket: 0xcdbf9f }
    : (([skin, hair, top, legs, shoe, jacket]) => ({ skin, hair, top, legs, shoe, jacket }))(LOOKS[Math.abs(look | 0) % LOOKS.length]);
  const g = new THREE.Group(), P = { g }; g.userData.person = P;
  const skin = M(L.skin, 0.7), jac = L.jacket != null ? M(L.jacket, 0.85) : null;
  const leg = s => { const p = new THREE.Group(); p.position.set(s * 0.095, 0.9, 0);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.072, 0.7, 4, 8), M(L.legs, 0.7)); m.position.y = -0.43; p.add(m);
    const sh = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.085, 0.27), M(L.shoe, 0.45)); sh.position.set(0, -0.86, -0.05); p.add(sh); g.add(p); return p; };
  P.lL = leg(-1); P.lR = leg(1);
  const T = P.torso = new THREE.Group(); T.position.y = 0.9; g.add(T);
  const top = new THREE.Mesh(new THREE.CapsuleGeometry(0.165, 0.34, 4, 10), M(L.top, 0.9)); top.scale.set(1.12, 1, 0.7); top.position.y = 0.33; T.add(top);
  if (jac) { for (const s of [-1, 1]) { const pn = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.6, 0.27), jac); pn.position.set(s * 0.125, 0.32, 0.005); T.add(pn); // open blazer: two fronts and the back, top showing between
      const lap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.26, 0.02), jac); lap.position.set(s * 0.075, 0.47, -0.135); lap.rotation.z = s * 0.35; T.add(lap); }
    const bk = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 0.05), jac); bk.position.set(0, 0.32, 0.12); T.add(bk); }
  const arm = s => { const p = new THREE.Group(); p.position.set(s * 0.235, 0.58, 0);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.48, 4, 8), jac || M(L.top, 0.9)); m.position.y = -0.27; p.add(m);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), skin); h.position.y = -0.57; p.add(h);
    if (shak && s < 0) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.035, 12), M(0x2a2a2e, 0.3, 0.8)); w.position.y = -0.5; p.add(w); } // watch
    T.add(p); return p; };
  P.aL = arm(-1); P.aR = arm(1);
  const nk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 10), skin); nk.position.y = 0.67; T.add(nk);
  const H = P.head = new THREE.Group(); H.position.y = 0.8; T.add(H);
  const hd = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 14), skin.clone()); hd.scale.set(0.9, 1.12, 1); H.add(hd);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.117, 18, 10, 0, Math.PI * 2, 0, shak ? 1.3 : 1.2), M(L.hair, 0.95)); hair.scale.set(0.93, 1.12, 1.03); hair.position.y = shak ? 0.012 : 0.012; if (shak) { hair.rotation.x = 0.5; hair.position.z = 0.012; } /* tilted back: covers the crown and back, leaves the forehead */ H.add(hair);
  if (shak) { for (let i = 0; i < 12; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.04, 5), hair.material); c.position.set((i % 4 - 1.5) * 0.03, 0.118 - Math.floor(i / 4) * 0.008, -0.05 + Math.floor(i / 4) * 0.04); c.rotation.x = -0.5; H.add(c); } // styled-up top
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.1125, 20, 16, Math.PI * 1.5 - 0.95, 1.9, 0.62, 1.85), shakFace([hd.material, skin])); face.scale.copy(hd.scale); H.add(face);
    const lm = M(0x050505, 0.08, 0.5), sh = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.008, 0.01), lm); sh.position.set(0, 0.03, -0.118); H.add(sh); // sunglasses: two lenses and a bridge
    for (const s2 of [-1, 1]) { const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.017, 0.04, 3, 8), lm); l.rotation.z = Math.PI / 2; l.position.set(s2 * 0.042, 0.026, -0.112); l.rotation.y = s2 * 0.25; H.add(l); }
    for (const s of [-1, 1]) { const arm2 = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.012, 0.11), sh.material); arm2.position.set(s * 0.088, 0.03, -0.06); H.add(arm2); } }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  P.t = Math.random() * 10; if (shak) loadShak(g, P); return g;
}
// mode: 'walk' (speed in m/s drives the cycle), 'dance', 'sit', 'idle'
export function animPerson(g, dt, speed = 0, mode = 'walk') {
  const P = g.userData.person; if (!P) return; P.t += dt;
  if (P.mix) { const sp = mode === 'walk' ? speed : 0, A = P.act, run = Math.min(1, Math.max(0, (sp - 2.2) / 1.6)), mv = Math.min(1, sp / 0.5);
    A.idle.setEffectiveWeight(1 - mv); A.walk.setEffectiveWeight(mv * (1 - run)); A.run.setEffectiveWeight(mv * run);
    A.walk.timeScale = Math.max(0.6, Math.min(1.8, sp / 1.25)); A.run.timeScale = Math.max(0.8, Math.min(1.5, sp / 4)); P.mix.update(dt); return; }
  if (P.cyber && window.CY_FREEZE) return; if (P.cyber) { const sp = mode === 'walk' ? speed : 0, run = Math.min(1, Math.max(0, (sp - 2) / 3)), amp = Math.min(1, sp / 1.4) * (0.5 + run * 0.35); P.ph = (P.ph || 0) + dt * (1.6 + sp * 1.15) * 2.2; animCyber(P, Math.sin(P.ph), amp, mode, P.t); return; }
  if (mode === 'dance') { const t = P.t * 5.2; P.torso.position.y = 0.9 + Math.abs(Math.sin(t)) * 0.05; P.torso.rotation.y = Math.sin(t * 0.5) * 0.35;
    P.aL.rotation.set(-1.6 + Math.sin(t) * 0.6, 0, 0.4); P.aR.rotation.set(-1.6 - Math.sin(t) * 0.6, 0, -0.4); P.lL.rotation.x = Math.sin(t) * 0.25; P.lR.rotation.x = -Math.sin(t) * 0.25; P.head.rotation.x = Math.sin(t * 2) * 0.12; return; }
  if (mode === 'sit') { P.lL.rotation.x = P.lR.rotation.x = -1.45; P.torso.position.y = 0.48; g.position.y = g.position.y; P.aL.rotation.x = P.aR.rotation.x = -0.5; return; }
  const run = Math.min(1, Math.max(0, (speed - 2) / 3)), amp = Math.min(1, speed / 1.4) * (0.55 + run * 0.4), w = 1.6 + speed * 1.15;
  P.ph = (P.ph || 0) + dt * w * 2.2; const s = Math.sin(P.ph);
  P.lL.rotation.x = s * amp; P.lR.rotation.x = -s * amp; P.aL.rotation.set(-s * amp * 0.85, 0, 0.06); P.aR.rotation.set(s * amp * 0.85, 0, -0.06);
  P.torso.position.y = 0.9 + Math.abs(Math.cos(P.ph)) * 0.035 * Math.min(1, speed) + (speed < 0.1 ? Math.sin(P.t * 1.6) * 0.004 : 0); P.torso.rotation.x = -run * 0.18; P.torso.rotation.y = 0; P.head.rotation.x = run * 0.12;
}

// Shak in the cyberpunk outfit (from Google Drive: cyberpunk-character), with his face, skin tone, beard and brown eyes
// baked into the head texture. Rigged model; the walk is driven procedurally on its leg / arm / spine bones.
let cyberUsed = false;
// Shak: realistic body in his own look (cream blazer, tan top, navy trousers, white trainers, his face + beard)
// with motion-captured idle / walk / run clips retargeted onto the rig, blended by speed.
// soft edge on the 3D head scan: fades its open border into the matched stock skin / hair tones
function scanBlend(m) { const c = x => new THREE.Color().setRGB(x[0], x[1], x[2], THREE.SRGBColorSpace), uS = { value: c(m.userData.skin) }, uH = { value: c(m.userData.hair) };
  m.onBeforeCompile = sh => { sh.uniforms.uSkin = uS; sh.uniforms.uHair = uH; sh.vertexShader = 'attribute vec2 aBlend;\nvarying vec2 vBl;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvBl = aBlend;'); sh.fragmentShader = 'uniform vec3 uSkin;\nuniform vec3 uHair;\nvarying vec2 vBl;\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(mix(uSkin, uHair, vBl.y), diffuseColor.rgb, vBl.x) * mix(1.0, 0.7, vBl.y);'); }; m.needsUpdate = true; }
// the character file is fetched once (shortly after start-up) and re-parsed for each session, so stepping out is instant
let _shakBuf = null; const shakBuf = () => _shakBuf || (_shakBuf = fetch('real/me/rb.glb?v=18').then(r => { if (!r.ok) throw new Error('rb ' + r.status); return r.arrayBuffer(); }).catch(e => { _shakBuf = null; throw e; }));
setTimeout(() => shakBuf().catch(() => {}), 1500);
function loadShak(g, P) {
  // every session gets the real character (the old once-only flag left later modes with the old stand-in figure);
  // the stand-in is hidden straight away so it never flashes up while the model streams in
  for (const c of g.children) c.visible = false;
  shakBuf().then(b => new GLTFLoader().parse(b.slice(0), '', gl => { const root = gl.scene; root.rotation.y = Math.PI / 2; root.position.y = 0.06 /* lift soles clear of the raised road surface */;
    root.traverse(o => { if (!o.isMesh) return; o.castShadow = true; o.frustumCulled = false; const m0 = o.material; if (m0.map) m0.map.anisotropy = 4;
      if (o.name === 'RB_Head') o.material = Object.assign(new THREE.MeshPhysicalMaterial({ map: m0.map, normalMap: m0.normalMap, roughness: 0.78, sheen: 0.05, sheenRoughness: 0.8, sheenColor: new THREE.Color(0.7, 0.4, 0.3) }), { name: m0.name });
      else if (o.name === 'RB_Body') { m0.roughness = 0.88; m0.color.setScalar(0.8); }
      else if (o.name === 'RB_Scan' && m0.userData.skin) { const ga = o.geometry.attributes, b = ga.__blend || ga._blend; if (b) { o.geometry.setAttribute('aBlend', b); scanBlend(m0); } } });
    const mix = new THREE.AnimationMixer(root), A = {}; for (const c of gl.animations) { const a = mix.clipAction(c); a.play(); a.setEffectiveWeight(0); A[c.name] = a; }
    if (!A.idle || !A.walk || !A.run) return; A.idle.setEffectiveWeight(1); for (const c of [...g.children]) c.visible = false; g.add(root); P.mix = mix; P.act = A; }, () => { for (const c of g.children) c.visible = true; })).catch(() => { for (const c of g.children) c.visible = true; });
}
function loadShakOld(g, P) {
  new GLTFLoader().load('real/me/shak.glb', gl => { const root = gl.scene; root.rotation.y = Math.PI;
    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; if (o.material.map) o.material.map.anisotropy = 4; if (/Top/.test(o.material.name)) o.material.color.setRGB(0.86, 0.78, 0.64); } });
    const mix = new THREE.AnimationMixer(root), A = {}; for (const c of gl.animations) { const a = mix.clipAction(c); a.play(); a.setEffectiveWeight(0); A[c.name] = a; }
    root.position.y = 0.04 /* soles sat slightly under the road surface */; root.traverse(o => { if (o.isSkinnedMesh && /Head/.test(o.name)) addHair(o); if (o.isMesh) realMat(o); if (o.isMesh && /Top/.test(o.name)) noRose(o); });
    if (!A.idle || !A.walk || !A.run) return; A.idle.setEffectiveWeight(1); for (const c of [...g.children]) c.visible = false; g.add(root); P.mix = mix; P.act = A; });
}
// realistic surfaces: skin with soft sheen + fine pore normals, woven fabric for the clothes, leather trainers, wet eyes
const TLr = new THREE.TextureLoader(), nTex = (n, r) => { const t = TLr.load('real/tex/' + n + '.jpg'); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(r, r); t.anisotropy = 4; return t; };
function realMat(o) { const m0 = o.material, n = o.name; let m;
  if (/Head|Body/.test(n)) { m = new THREE.MeshPhysicalMaterial({ map: m0.map, color: m0.color, roughness: 0.52, metalness: 0, sheen: 0.35, sheenRoughness: 0.55, sheenColor: new THREE.Color(0.75, 0.42, 0.32), normalMap: nTex('n_leather', 14), normalScale: new THREE.Vector2(0.12, 0.12), clearcoat: 0.08, clearcoatRoughness: 0.5 }); }
  else if (/Top|Bottom/.test(n)) { m = new THREE.MeshPhysicalMaterial({ map: m0.map, color: m0.color, roughness: 0.88, metalness: 0, sheen: 0.6, sheenRoughness: 0.8, sheenColor: new THREE.Color(0.35, 0.33, 0.3), normalMap: nTex('n_fabric', /Top/.test(n) ? 9 : 7), normalScale: new THREE.Vector2(0.55, 0.55) }); }
  else if (/Footwear/.test(n)) { m = new THREE.MeshStandardMaterial({ map: m0.map, color: m0.color, roughness: 0.55, metalness: 0, normalMap: nTex('n_leather', 5), normalScale: new THREE.Vector2(0.4, 0.4) }); }
  else if (/Eye/.test(n)) { m = new THREE.MeshPhysicalMaterial({ map: m0.map, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 }); }
  if (m) { m.name = m0.name; o.material = m; }
  if (window.UVDBG && /Top/.test(n)) { const c = document.createElement('canvas'); c.width = c.height = 1024; const g = c.getContext('2d'); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = `hsl(${(x * 8 + y) * 47 % 360},70%,${x % 2 ? 40 : 65}%)`; g.fillRect(x * 128, y * 128, 128, 128); g.fillStyle = '#000'; g.font = 'bold 60px sans-serif'; g.fillText(x + '' + y, x * 128 + 20, y * 128 + 85); } const t = new THREE.CanvasTexture(c); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; o.material.map = t; o.material.color.set(0xffffff); } }
// the base outfit's lapel flower: collapse it (UV island) so the blazer lapel is plain
function noRose(o) { const g = o.geometry, uv = g.attributes.uv, P = g.attributes.position, I = g.index?.array; if (!uv || !I) return; const n = P.count, par = new Int32Array(n).map((_, i) => i), fd = x => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
  const key = new Map(); for (let i = 0; i < n; i++) { const k = Math.round(P.getX(i) * 1e4) + ',' + Math.round(P.getY(i) * 1e4) + ',' + Math.round(P.getZ(i) * 1e4); const j = key.get(k); if (j == null) key.set(k, i); else par[fd(i)] = fd(j); }
  for (let t = 0; t < I.length; t += 3) { const a = fd(I[t]); par[fd(I[t + 1])] = a; par[fd(I[t + 2])] = fd(a); }
  const C = new Map(); for (let i = 0; i < n; i++) { const r = fd(i); let c = C.get(r); if (!c) C.set(r, c = { ids: [], inR: true, mn: [1e9, 1e9, 1e9], mx: [-1e9, -1e9, -1e9] }); c.ids.push(i); const u = uv.getX(i), v = uv.getY(i); if (!(u > 0.18 && u < 0.53 && v > 0.62 && v < 0.92)) c.inR = false; const p = [P.getX(i), P.getY(i), P.getZ(i)]; for (let k = 0; k < 3; k++) { c.mn[k] = Math.min(c.mn[k], p[k]); c.mx[k] = Math.max(c.mx[k], p[k]); } }
  let k0 = 0; for (const c of C.values()) { if (!c.inR || Math.max(c.mx[0] - c.mn[0], c.mx[1] - c.mn[1], c.mx[2] - c.mn[2]) > 0.14) continue; const m = [(c.mn[0] + c.mx[0]) / 2, (c.mn[1] + c.mx[1]) / 2, (c.mn[2] + c.mx[2]) / 2]; for (const i of c.ids) P.setXYZ(i, m[0], m[1], m[2]); k0++; }
  P.needsUpdate = true; }
// short faded hair: a shell over the scalp grown from the head mesh itself (dark on top, fading short at back/sides)
function addHair(head) {
  const G = head.geometry, P = G.attributes.position, Nn = G.attributes.normal; G.computeBoundingBox(); const bb = G.boundingBox, h = bb.max.y - bb.min.y, d = bb.max.z - bb.min.z, w = bb.max.x - bb.min.x, cz = (bb.max.z + bb.min.z) / 2;
  const fade = new Float32Array(P.count), keep = new Uint8Array(P.count);
  for (let i = 0; i < P.count; i++) { const x = P.getX(i), y = (P.getY(i) - bb.min.y) / h, z = (P.getZ(i) - cz) / d, ax = Math.abs(x - (bb.max.x + bb.min.x) / 2) / w;
    const top = y > 0.83 - Math.max(0, -z) * 0.55, face = z > 0.18 && y < 0.9, ear = ax > 0.4 && y < 0.74 && y > 0.5 && z > -0.2;
    if (top && !face && !ear && y > 0.47) { keep[i] = 1; fade[i] = Math.min(1, Math.max(0, (y - 0.5) / 0.3)); } }
  const idx = G.index.array, ni = []; for (let t = 0; t < idx.length; t += 3) if (keep[idx[t]] && keep[idx[t + 1]] && keep[idx[t + 2]]) ni.push(idx[t], idx[t + 1], idx[t + 2]);
  const g2 = new THREE.BufferGeometry(); for (const k in G.attributes) g2.setAttribute(k, G.attributes[k].clone()); g2.setIndex(ni);
  const p2 = g2.attributes.position; for (let i = 0; i < p2.count; i++) { const o = 0.0035 + fade[i] * 0.006; p2.setXYZ(i, p2.getX(i) + Nn.getX(i) * o, p2.getY(i) + Nn.getY(i) * o, p2.getZ(i) + Nn.getZ(i) * o); }
  const col = new Float32Array(p2.count * 3); for (let i = 0; i < p2.count; i++) { const k = 0.05 + (1 - fade[i]) * 0.07; col[i * 3] = k * 1.05; col[i * 3 + 1] = k * 0.9; col[i * 3 + 2] = k * 0.8; } g2.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, 256, 256); for (let i = 0; i < 9000; i++) { const v = 150 + Math.random() * 105 | 0; c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(Math.random() * 256, Math.random() * 256, 1, 2 + Math.random() * 3); }
  const tx = new THREE.CanvasTexture(cv); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(6, 6); tx.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: tx, roughness: 0.85, metalness: 0, transparent: true, opacity: 0.97 });
  const hm = new THREE.SkinnedMesh(g2, m); hm.name = 'Hair'; hm.frustumCulled = false; hm.castShadow = true; head.parent.add(hm); hm.bind(head.skeleton, head.bindMatrix); }
function loadCyber(g, P) {
  if (cyberUsed) return; cyberUsed = true;
  const TL = new THREE.TextureLoader(), T = (n, srgb) => { const t = TL.load('real/me/' + n + '.jpg'); t.flipY = true; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  new GLTFLoader().load('real/me/cyber.glb', gl => {
    const mats = {}; const mat = k => mats[k] || (mats[k] = new THREE.MeshStandardMaterial({ map: T(k + '_bc', true), normalMap: T(k + '_n'), roughnessMap: T(k + '_orm'), metalnessMap: T(k + '_orm'), roughness: 1, metalness: 1 }));
    const glass = new THREE.MeshBasicMaterial({ visible: false }) /* visor removed so his eyes show */, eye = new THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0.12, roughness: 0 });
    const root = gl.scene; root.rotation.y = Math.PI; // model faces +Z, people face -Z
    root.traverse(o => { if (!o.isMesh) return; o.castShadow = true; o.frustumCulled = false; const fix = m => /glass/i.test(m.name) ? glass : /eyetrans/i.test(m.name) ? eye : mat(/^CPP/.test(m.name) ? 'cpp' : 'cpd'); o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material); });
    root.updateMatrixWorld(true); const rqi = root.getWorldQuaternion(new THREE.Quaternion()).invert(), B = {};
    root.traverse(o => { if (!o.isBone) return; (B[o.name.replace(/_\d+$/, "")] ||= []).push(o); o.userData.q0 = o.quaternion.clone(); o.userData.pqi = rqi.clone().multiply(o.parent.getWorldQuaternion(new THREE.Quaternion())).invert(); }); /* rest frame of each bone's parent, relative to the model */
    for (const c of [...g.children]) c.visible = false; g.add(root); P.cyber = B;
  });
}
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
// rotate a bone by `a` about an axis given in the model's own frame (model faces +Z, its left is +X)
function pose(B, name, axis, a, axis2, a2) { const L = B[name]; if (!L) return; for (const b of L) { _q.setFromAxisAngle(_v.copy(axis).applyQuaternion(b.userData.pqi), a); b.quaternion.copy(_q).multiply(b.userData.q0);
  if (axis2) { _q.setFromAxisAngle(_v.copy(axis2).applyQuaternion(b.userData.pqi), a2); b.quaternion.premultiply(_q); } } }
window.__cyPose = (B, n, ax, a) => { if (ax[0] === 'l') { const v = new THREE.Vector3(ax[1] === 'x' ? 1 : 0, ax[1] === 'y' ? 1 : 0, ax[1] === 'z' ? 1 : 0); for (const b of B[n]) b.quaternion.copy(b.userData.q0).multiply(_q.setFromAxisAngle(v, a)); return; } pose(B, n, ax === 'x' ? X : ax === 'y' ? new THREE.Vector3(0, 1, 0) : Z, a); };
const _q2 = new THREE.Quaternion(), LX = new THREE.Vector3(1, 0, 0), LZ = new THREE.Vector3(0, 0, 1);
// arms: bone-local axes (X lowers the arm from the A-pose, Z swings it forward / back)
function poseL(B, name, down, swing) { const L = B[name]; if (!L) return; for (const b of L) b.quaternion.copy(b.userData.q0).multiply(_q.setFromAxisAngle(LX, down)).multiply(_q2.setFromAxisAngle(LZ, swing)); }
export function animCyber(P, s, amp, mode, t) { const B = P.cyber; if (!B) return false; const D = window.CY_DOWN ?? 0.6;
  if (mode === 'dance') { s = Math.sin(t * 5.2); amp = 0.55; }
  if (mode === 'sit') { pose(B, 'l_leg', X, -0.75); pose(B, 'r_leg', X, -0.75); pose(B, 'l_knee', X, -0.75); pose(B, 'r_knee', X, -0.75); poseL(B, 'l_arm', D, 0); poseL(B, 'r_arm', D * (window.CY_RS ?? -1), 0); return true; }
  const c = Math.cos(P.ph || 0);
  pose(B, 'l_leg', X, -s * amp * 0.3); pose(B, 'r_leg', X, s * amp * 0.3);
  pose(B, 'l_knee', X, -(Math.max(0, c) * amp * 0.45 + 0.03)); pose(B, 'r_knee', X, -(Math.max(0, -c) * amp * 0.45 + 0.03));
  poseL(B, 'l_arm', D, s * amp * 0.5); poseL(B, 'r_arm', D * (window.CY_RS ?? -1), -s * amp * 0.5 * (window.CY_RZ ?? 1));
   return true; }
