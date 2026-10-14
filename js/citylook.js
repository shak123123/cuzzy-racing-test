// City look: realistic UK facades (real material textures + drawn window layers), shopfronts, awnings, roof
// parapets / plant, street clutter, trees and the distant skyline. Visual only: nothing here adds or changes collision.
// Material textures: client/img/city/*.jpg, generated for this project from our own prompts (tools/make_city_textures.py).
import * as THREE from 'three';
import { mergeGeometries } from './lib/addons/utils/BufferGeometryUtils.js';

const TL = new THREE.TextureLoader();
const texCache = {};
// q.env: 0 low, 1 medium, 2 high, 3 ultra
export function cityTex(q, name, { srgb = true, normal = false } = {}) {
  const size = normal ? (q.env >= 3 ? '2k' : q.env >= 1 ? '1k' : '512') : ['512', '1k', '2k', '2k'][q.env] || '1k';
  const key = name + (normal ? '_n_' : '_') + size; if (texCache[key]) return texCache[key];
  const t = TL.load(new URL(`../img/city/${key}.jpg`, import.meta.url).href);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = q.aniso || 4; if (srgb && !normal) t.colorSpace = THREE.SRGBColorSpace;
  return (texCache[key] = t);
}
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function ctex(c, q, srgb = true) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = q.aniso || 4; return t; }
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ------------------------------------------------------------------------------------------------------------------
// Facade window layers. One tile = 12 m wide x 10.5 m high (3 storeys), drawn in a 1024 x 896 design space.
// overlay (RGBA): windows, frames, lintels, sills (alpha 0 = the wall material shows through)
// mask (RGB): R = glass, G = lit at night, B = sill/lintel stone (slightly smoother)
// ------------------------------------------------------------------------------------------------------------------
const PX = 1024 / 12; // px per metre
function glassFill(g, x, y, w, h, rnd, tint = [52, 62, 72]) { // dark reflective glass with a hint of interior
  const gr = g.createLinearGradient(0, y, 0, y + h); const [r, gg, b] = tint; const v = rnd() * 16 - 8;
  gr.addColorStop(0, `rgb(${r + 30 + v},${gg + 34 + v},${b + 38 + v})`); gr.addColorStop(0.5, `rgb(${r + v},${gg + v},${b + v})`); gr.addColorStop(1, `rgb(${r * 0.45 + v | 0},${gg * 0.45 + v | 0},${b * 0.45 + v | 0})`);
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  const k = rnd(); // interior: blinds / curtains / nets
  if (k < 0.3) { g.fillStyle = `rgba(${200 + rnd() * 40 | 0},${192 + rnd() * 40 | 0},${175 + rnd() * 40 | 0},0.5)`; g.fillRect(x, y, w, h * (0.15 + rnd() * 0.5)); }
  else if (k < 0.45) { const cc = [[120, 40, 40], [60, 70, 110], [150, 130, 90], [90, 100, 80]][rnd() * 4 | 0]; g.fillStyle = `rgba(${cc},0.55)`; g.fillRect(x, y, w * 0.22, h); g.fillRect(x + w * 0.78, y, w * 0.22, h); }
  else if (k < 0.55) { g.fillStyle = 'rgba(235,235,230,0.32)'; g.fillRect(x, y + h * 0.45, w, h * 0.55); }
}
function drawTile(style, rnd, R) {
  const W = 1024, H = 896, fh = H / 3;
  const oc = canvas(R, R * 0.875), mc = canvas(R, R * 0.875); const g = oc.getContext('2d'), m = mc.getContext('2d');
  g.scale(R / 1024, R / 1024); m.scale(R / 1024, R / 1024); m.fillStyle = '#000'; m.fillRect(0, 0, W, H);
  const glass = (x, y, w, h, tint, litP = 0.2) => { glassFill(g, x, y, w, h, rnd, tint); const lit = rnd() < litP; m.fillStyle = lit ? 'rgb(255,255,0)' : 'rgb(255,0,0)'; m.fillRect(x, y, w, h); if (lit) { g.fillStyle = 'rgba(255,220,160,0.10)'; g.fillRect(x, y, w, h); } };
  const solid = (x, y, w, h, col, stone = false) => { g.fillStyle = col; g.fillRect(x, y, w, h); m.fillStyle = stone ? 'rgb(0,0,255)' : '#000'; m.fillRect(x, y, w, h); };
  const bar = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); m.fillStyle = '#000'; m.fillRect(x, y, w, h); };
  const shade = (x, y, w, h, a) => { g.fillStyle = `rgba(0,0,0,${a})`; g.fillRect(x, y, w, h); }; // reveal shadow (window is set back in the wall)
  const streak = (x, y, w) => { const s = g.createLinearGradient(0, y, 0, y + 80); s.addColorStop(0, 'rgba(20,18,16,0.22)'); s.addColorStop(1, 'rgba(20,18,16,0)'); g.fillStyle = s; g.fillRect(x, y, w, 80); };
  if (style === 'curtain' || style === 'curtain2') { // unitised glass curtain wall: 1.5 m mullions, spandrel at each floor slab
    const tint = style === 'curtain' ? [44, 70, 82] : [58, 64, 70]; const cols = 8, cw = W / cols;
    for (let f = 0; f < 3; f++) for (let c = 0; c < cols; c++) { glass(c * cw, f * fh, cw, fh * 0.78, tint.map(v => v + (rnd() * 10 - 5 | 0)), 0.15); const sp = f * fh + fh * 0.78; g.fillStyle = style === 'curtain' ? '#1d2a31' : '#2a2e33'; g.fillRect(c * cw, sp, cw, fh * 0.22); m.fillStyle = 'rgb(160,0,0)'; m.fillRect(c * cw, sp, cw, fh * 0.22); }
    for (let c = 0; c <= cols; c++) bar(c * cw - 4, 0, 8, H, style === 'curtain' ? '#8f979c' : '#3b3f44');
    for (let f = 0; f <= 3; f++) { bar(0, f * fh + fh * 0.78 - 3, W, 6, '#6c7479'); bar(0, f * fh - 3, W, 6, '#6c7479'); }
    return { oc, mc };
  }
  if (style === 'ribbon') { // 1960s-70s concrete: continuous glazed bands, deep concrete spandrels
    for (let f = 0; f < 3; f++) { const y = f * fh + fh * 0.22, h = fh * 0.5; for (let c = 0; c < 8; c++) glass(c * 128, y, 128, h, [50, 58, 64], 0.2);
      for (let c = 0; c <= 8; c++) bar(c * 128 - 5, y, 10, h, '#2b2d2f'); bar(0, y, W, 6, '#2b2d2f'); bar(0, y + h - 6, W, 6, '#2b2d2f'); shade(0, y, W, 14, 0.45); }
    return { oc, mc };
  }
  const L = { // bays per tile, window w/h (m), sill height above floor (m), frame colour, head type
    victorian: [4, 1.1, 2.0, 0.85, '#ece6da', 'arch'], georgian: [4, 1.1, 1.9, 0.9, '#f1eee8', 'flat'], warehouse: [5, 1.5, 2.1, 0.8, '#1d1f21', 'seg'],
    office: [6, 1.45, 1.75, 0.85, '#3a3e42', 'none'], flats: [4, 1.6, 1.5, 0.9, '#dfe0de', 'none'], civic: [3, 1.5, 2.5, 0.6, '#e4ddd0', 'ped'] }[style];
  const [bays, ww0, wh0, sill0, frame, head] = L; const bw = W / bays; const ww = ww0 * PX, wh = wh0 * PX;
  for (let f = 0; f < 3; f++) {
    const fy = f * fh; // floor top in canvas coordinates (canvas y grows down; floor f=0 is the top storey of the tile)
    if (style === 'victorian' || style === 'civic' || style === 'georgian') { solid(0, fy + fh - 0.22 * PX, W, 0.14 * PX, 'rgba(226,216,196,0.9)', true); shade(0, fy + fh - 0.08 * PX, W, 0.06 * PX, 0.2); } // string course
    for (let c = 0; c < bays; c++) {
      const x = c * bw + (bw - ww) / 2, y = fy + fh - sill0 * PX - wh; // window top-left
      if (head === 'arch') { g.fillStyle = 'rgba(160,70,45,0.95)'; g.beginPath(); g.moveTo(x - 14, y + 4); g.quadraticCurveTo(x + ww / 2, y - 40, x + ww + 14, y + 4); g.lineTo(x + ww + 14, y + 10); g.lineTo(x - 14, y + 10); g.fill(); g.fillStyle = 'rgba(235,225,205,0.95)'; g.fillRect(x + ww / 2 - 9, y - 30, 18, 24); } // gauged-brick arch + keystone
      if (head === 'seg') { g.fillStyle = 'rgba(30,20,18,0.35)'; g.beginPath(); g.moveTo(x - 12, y + 2); g.quadraticCurveTo(x + ww / 2, y - 28, x + ww + 12, y + 2); g.lineTo(x + ww + 12, y + 8); g.lineTo(x - 12, y + 8); g.fill(); }
      if (head === 'flat') solid(x - 10, y - 20, ww + 20, 20, 'rgba(232,226,212,0.97)', true);
      if (head === 'ped') { solid(x - 18, y - 26, ww + 36, 22, 'rgba(225,217,200,0.98)', true); g.fillStyle = 'rgba(225,217,200,0.98)'; g.beginPath(); g.moveTo(x - 18, y - 26); g.lineTo(x + ww / 2, y - 60); g.lineTo(x + ww + 18, y - 26); g.fill(); shade(x - 18, y - 6, ww + 36, 5, 0.3); }
      const fw = style === 'office' || style === 'flats' ? 7 : 9; // frame width px
      bar(x, y, ww, wh, frame); glass(x + fw, y + fw, ww - fw * 2, wh - fw * 2, style === 'warehouse' ? [46, 52, 56] : [50, 60, 70], 0.22);
      shade(x + fw, y + fw, ww - fw * 2, 10, 0.45); shade(x + fw, y + fw, 7, wh - fw * 2, 0.3); // reveal shadow
      if (style === 'victorian' || style === 'georgian') { bar(x, y + wh * 0.5 - 5, ww, 10, frame); bar(x + ww / 2 - 3, y, 6, wh, frame); // sash: meeting rail + glazing bar
        if (style === 'georgian') for (const k of [1 / 3, 2 / 3]) bar(x + ww * k - 2, y, 4, wh, frame), bar(x, y + wh * (k * 0.5) - 2, ww, 4, frame), bar(x, y + wh * (0.5 + k * 0.5) - 2, ww, 4, frame); }
      if (style === 'warehouse') { for (let i = 1; i < 4; i++) bar(x + ww * i / 4 - 3, y, 6, wh, frame); for (let i = 1; i < 4; i++) bar(x, y + wh * i / 4 - 3, ww, 6, frame); }
      if (style === 'office') bar(x, y + wh * 0.22, ww, 7, frame);
      if (style === 'flats') { bar(x + ww * 0.62, y, 7, wh, frame); if (rnd() < 0.5 && f < 2) { bar(x - 6, y + wh * 0.55, ww + 12, 5, '#2d2f31'); for (let i = 0; i <= 8; i++) bar(x - 6 + (ww + 12) * i / 8, y + wh * 0.55, 3, wh * 0.45, '#2d2f31'); } } // juliet balcony
      if (style !== 'office' && style !== 'flats') solid(x - 12, y + wh, ww + 24, 14, 'rgba(236,230,216,0.97)', true); // stone sill
      else solid(x - 3, y + wh, ww + 6, 7, 'rgba(120,124,128,0.95)');
      shade(x - 12, y + wh + 14, ww + 24, 5, 0.25); streak(x - 8, y + wh + 19, ww + 16);
    }
  }
  if (style === 'civic') for (let c = 0; c <= bays; c++) { g.fillStyle = 'rgba(0,0,0,0.07)'; g.fillRect(c * bw - 14, 0, 28, H); } // pilasters (shading only)
  if (R >= 1024 && style !== 'civic' && style !== 'office') { // High+: cast-iron downpipe with brackets + hopper at the tile edge, stain beside it
    const px0 = W - 22; const s2 = g.createLinearGradient(px0 - 30, 0, px0 + 40, 0); s2.addColorStop(0, 'rgba(0,0,0,0)'); s2.addColorStop(0.5, 'rgba(25,22,18,0.16)'); s2.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = s2; g.fillRect(px0 - 30, 0, 70, H);
    bar(px0, 0, 11, H, '#232628'); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(px0 + 2, 0, 2, H); for (let y = 40; y < H; y += 110) bar(px0 - 3, y, 17, 6, '#1a1c1d');
    if (style === 'victorian' || style === 'flats') { bar(px0 - 6, 6, 23, 18, '#232628'); // hopper head
      if (style === 'victorian') { bar(W * 0.5 - 22, fh * 2 + 20, 44, 52, '#e8e4dc'); g.fillStyle = '#1f55a8'; g.fillRect(W * 0.5 - 16, fh * 2 + 30, 32, 10); m.fillStyle = '#000'; } } // burglar-alarm box
  }
  return { oc, mc };
}

// facade kinds: wall texture, window style, wall tint, physical size of the wall texture (m, w x h), rooms per tile (x) for
// the interior mapping (one room behind each bay; 3 storeys per tile)
export const FACADES = [
  { k: 'victorian', wall: 'brick_red', style: 'victorian', tint: 0xffffff, size: [3.4, 2.25], rooms: 4 },
  { k: 'warehouse', wall: 'brick_dark', style: 'warehouse', tint: 0xffffff, size: [3.4, 2.25], rooms: 5 },
  { k: 'office', wall: 'brick_buff', style: 'office', tint: 0xffffff, size: [3.4, 2.2], rooms: 6 },
  { k: 'civic', wall: 'stone', style: 'civic', tint: 0xf4efe6, size: [4.4, 2.8], rooms: 3 },
  { k: 'glass', wall: 'concrete', style: 'curtain', tint: 0xffffff, size: [4, 4], glass: true, rooms: 4 },
  { k: 'glass2', wall: 'concrete', style: 'curtain2', tint: 0xffffff, size: [4, 4], glass: true, rooms: 4 },
  { k: 'ribbon', wall: 'concrete', style: 'ribbon', tint: 0xe8e4dc, size: [4.2, 4.2], rooms: 4 },
  { k: 'georgian', wall: 'render', style: 'georgian', tint: 0xf3eadb, size: [3.5, 3.5], rooms: 4 },
  { k: 'flats', wall: 'brick_red', style: 'flats', tint: 0xd9c2b4, size: [3.4, 2.25], rooms: 4 },
  // round 5 (Medium+ only): sooty Flemish-bond Victorian terrace brick, 1960s exposed-aggregate precast panel block
  { k: 'victorian2', wall: 'brick_victorian', style: 'victorian', tint: 0xffffff, size: [1.5, 1.45], rooms: 4, min: 1 },
  { k: 'panel60s', wall: 'concrete_panel', style: 'ribbon', tint: 0xf2eee6, size: [4.8, 4.8], rooms: 4, min: 1 },
];
// per-building data for the facade shader: bInfo = (roof height, facade base height, random seed 0..1)
export function tagWalls(g, top, base, seed) { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = top; a[i * 3 + 1] = base; a[i * 3 + 2] = seed; } g.setAttribute('bInfo', new THREE.BufferAttribute(a, 3)); return g; }
// 4x2 interior atlases (tools/make_city_textures2.py): room back walls photographed straight on, with the floor, ceiling and
// side walls in perspective. Interior mapping: ray from the eye through the glass into a room box behind the window, the hit
// point re-projected into the photo's own perspective (back wall = BACK of the frame) -> real parallax depth.
function atlasTex(q, name) { const key = name + '_' + (q.env >= 2 ? '2k' : '1k'); if (texCache[key]) return texCache[key];
  const t = TL.load(new URL(`../img/city/${key}.jpg`, import.meta.url).href); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 6; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return (texCache[key] = t); }
const ROOM_GLSL = `
float hsh(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
// p: entry point in room space (x,y in -1..1 across the window cell, z = 0 at the glass), d: ray in room units
// roomHit: no zero ray components (0 * inf = NaN -> black pixels that bloom spread into boxes)
vec3 roomHit(vec3 p, vec3 d) { d = mix(vec3(1e-4) * (step(0.0, d) * 2.0 - 1.0), d, step(1e-4, abs(d))); vec3 inv = 1.0 / d; vec3 tt = (sign(d) - p) * inv; tt.z = 1.0 / max(d.z, 1e-3); float t = min(min(tt.x, tt.y), tt.z); return p + d * t; }
// roomCol: explicit gradients, so the per-cell fract() jump no longer picks the smallest mip and distant rooms filter instead of sparkling
vec3 roomCol(sampler2D atlas, vec3 h, float tile, float back, vec2 gx, vec2 gy) { float sc = 1.0 / (1.0 + h.z * (1.0 / back - 1.0)); vec2 im = clamp(0.5 + 0.5 * h.xy * sc, 0.0, 1.0);
  vec2 cell = vec2(mod(tile, 4.0), floor(tile / 4.0)); vec2 uv = (cell + 0.025 + im * 0.95) / vec2(4.0, 2.0); return textureGrad(atlas, uv, gx, gy).rgb * (1.0 - 0.35 * h.z); }
`;
export function facadeMaterials(q, onNight) {
  const rnd = mulberry(21); const R = q.env >= 3 ? 1536 : q.env >= 2 ? 1024 : 512; const night = { value: 0 };
  const grime = q.env >= 1, inter = q.env >= 1, hi = q.env >= 2; const atlas = inter ? atlasTex(q, 'interiors') : null;
  const mats = FACADES.map(F => {
    if (F.min && q.env < F.min) return null;
    const { oc, mc } = drawTile(F.style, rnd, R);
    const over = ctex(oc, q), mask = ctex(mc, q, false); over.premultiplyAlpha = true; const wall = cityTex(q, F.wall);
    const wallN = q.env >= 1 ? cityTex(q, F.wall, { normal: true }) : null;
    const sc = new THREE.Vector2(12 / F.size[0], 10.5 / F.size[1]); if (wallN) wallN.repeat.copy(sc);
    const mat = new THREE.MeshStandardMaterial({ map: over, normalMap: wallN, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.88, metalness: 0, envMapIntensity: 0.8 });
    mat.userData.kind = F.k; const key = 'facade' + (wallN ? 'n' : '') + (grime ? 'g' : '') + (inter ? 'i' : '') + (hi ? 'h' : ''); mat.customProgramCacheKey = () => key;
    if (grime) mat.defines = { FAC_GRIME: 1, ...(inter ? { FAC_INT: 1 } : {}), ...(hi ? { FAC_HI: 1 } : {}) };
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, { wallMap: { value: wall }, maskMap: { value: mask }, wallScale: { value: sc }, wallTint: { value: new THREE.Color(F.tint) }, nightK: night, glassMetal: { value: F.glass ? 0.55 : 0.3 },
        intMap: { value: atlas }, roomsN: { value: new THREE.Vector2(F.rooms, 3) }, roomW: { value: 12 / F.rooms } });
      if (grime) sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 bInfo; varying vec3 vWP; varying vec3 vBI; varying vec3 vWN;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vBI = bInfo; vWN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D wallMap; uniform sampler2D maskMap; uniform vec2 wallScale; uniform vec3 wallTint; uniform float nightK; uniform float glassMetal; vec3 fMask; float glassK; vec3 roomE;\n#ifdef FAC_GRIME\nvarying vec3 vWP; varying vec3 vBI; varying vec3 vWN; uniform sampler2D intMap; uniform vec2 roomsN; uniform float roomW;' + ROOM_GLSL + '#endif')
        .replace('#include <map_fragment>', `vec4 ov = texture2D(map, vMapUv); fMask = texture2D(maskMap, vMapUv).rgb; // ov is premultiplied
          vec3 wl = texture2D(wallMap, vMapUv * wallScale).rgb * wallTint;
          float nz = sin(vMapUv.x * 1.9 + sin(vMapUv.y * 1.3) * 2.0) * sin(vMapUv.y * 1.1 + vMapUv.x * 0.6); wl *= 0.9 + 0.12 * nz; // large-scale weathering: breaks up tiling
          glassK = smoothstep(0.7, 0.95, fMask.r); roomE = vec3(0.0);
          #ifdef FAC_GRIME
            float sd = vBI.z; wl *= mix(vec3(1.0), vec3(0.86 + 0.26 * fract(sd * 7.13), 0.86 + 0.24 * fract(sd * 3.71), 0.86 + 0.22 * fract(sd * 5.19)), 0.7); // per-building brick/stone batch
            float col = hsh(vec3(floor(vMapUv.x * 64.0), sd, 1.0)), col2 = hsh(vec3(floor(vMapUv.x * 17.0), sd, 2.0));
            float below = max(vBI.x - vWP.y, 0.0);
            float streak = exp(-below / (1.5 + 7.0 * col2)) * (0.2 + 0.45 * col) + exp(-below / 14.0) * 0.12; // rain run-off under the parapet / coping
            float splash = (1.0 - smoothstep(0.0, 1.4 + 0.5 * nz, vWP.y - vBI.y * step(vBI.y, 0.5))) * (0.5 + 0.2 * col2); // pavement splash-back and traffic grime
            float gr = clamp(streak + splash, 0.0, 0.75);
            wl = mix(wl, wl * vec3(0.5, 0.47, 0.43), gr); ov.rgb *= 1.0 - gr * 0.35;
          #endif
          #ifdef FAC_INT
            if (glassK > 0.01) { // interior mapping: a room box 4 m deep behind every window cell
              vec3 N = normalize(vWN); vec3 Tc = vec3(-N.z, 0.0, N.x); float su = dot(dFdx(vWP), Tc) * dFdx(vMapUv.x) + dot(dFdy(vWP), Tc) * dFdy(vMapUv.x); Tc *= su >= 0.0 ? 1.0 : -1.0;
              vec2 cl = vMapUv * roomsN; vec2 ci = floor(cl); vec2 cf = fract(cl);
              vec3 V = normalize(vWP - cameraPosition); vec3 d = vec3(dot(V, Tc) / (roomW * 0.5), V.y / 1.75, dot(V, -N) / 4.0);
              vec3 h = roomHit(vec3(cf * 2.0 - 1.0, 0.0), d); float rh = hsh(vec3(ci, sd * 91.0));
              vec2 rg = 0.95 / vec2(4.0, 2.0); vec3 rc = roomCol(intMap, h, floor(rh * 8.0), 0.5, dFdx(cl) * rg, dFdy(cl) * rg);
              float lit = fMask.g * nightK; float fr = pow(1.0 - clamp(dot(-V, N), 0.0, 1.0), 3.0);
              float day = (1.0 - nightK) * (0.12 + 0.2 * hsh(vec3(ci, 7.0)));
              roomE = rc * (day + lit * (1.2 + 0.8 * rh) + nightK * 0.015) * (1.0 - fr) * glassK;
              ov.rgb *= 1.0 - glassK * 0.55;
            }
          #endif
          diffuseColor.rgb *= wl * (1.0 - ov.a) + ov.rgb;`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(mix(roughness, 0.6, fMask.b), 0.04, fMask.r);')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = mix(metalness, glassMetal, fMask.r);')
        .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * (1.0 - ov.a);') +
          '\n#ifdef FAC_HI\n{ vec2 pc = floor(vMapUv * roomsN * vec2(2.0, 1.0)); float pfw = length(fwidth(vMapUv * roomsN * vec2(2.0, 1.0))); normal = normalize(normal + (vec3(hsh(vec3(pc, 3.0)), hsh(vec3(pc, 4.0)), 0.0) - 0.5) * 0.07 * glassK * (1.0 - smoothstep(0.25, 0.6, pfw))); } // pane-to-pane wobble: glazing reflections break up like real float glass (faded out where a pane is only a few pixels: it sparkled)\n#endif\n#ifdef FAC_GRIME\n{ vec3 ndx = dFdx(normal), ndy = dFdy(normal); float nv = min(0.18, 2.0 * (dot(ndx, ndx) + dot(ndy, ndy))); roughnessFactor = sqrt(min(1.0, roughnessFactor * roughnessFactor + nv)); // specular anti-aliasing (normal variance -> roughness)\n  roughnessFactor = max(roughnessFactor, 0.2 * glassK * smoothstep(0.03, 0.12, length(fwidth(vMapUv)))); } // distant glazing: no sub-pixel mirror sparkles\n#endif')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef FAC_INT\ntotalEmissiveRadiance += roomE;\n#else\ntotalEmissiveRadiance += vec3(1.0, 0.78, 0.5) * fMask.g * nightK * 1.6;\n#endif');
    };
    return mat;
  });
  return { mats, night };
}

// ------------------------------------------------------------------------------------------------------------------
// Shopfronts: 16 m x 4.2 m tile, three units: fascia sign, glazed front with door, stall riser, pilasters.
// ------------------------------------------------------------------------------------------------------------------
const SHOPS = ['BRUM BITES', 'CUZZY CUTS', 'ASTON TAILORS', 'DIGBETH DELI', 'QUARTER GOLD', 'BULL CAFE', 'CANAL BOOKS', 'NEW ST NEWS', 'SELLY SHOES', 'MOSELEY TECH', 'SPARKHILL SWEETS', 'BALTI HOUSE',
  'KINGS PHARMACY', 'HANDSWORTH HARDWARE', 'THE JEWELLERY BOX', 'EDGBASTON ESTATES', 'CORNER COFFEE', 'VAPE & PHONE', 'PERRY BAR GRILL', 'LADYWOOD LAUNDRY', 'MIDLAND OPTICIANS', 'RAILWAY TAVERN'];
const SHOPS2 = ['PATEL & SONS', 'THE CUSTARD FACTORY', 'JEWELLERY QUARTER PAWN', 'ROTUNDA NAILS', 'BULLRING KEBABS', 'KOH-I-NOOR SWEETS', 'DIGBETH DINER', 'MOSELEY MEAT CO',
  'ASTON BARBERS', 'BRUM BOOKMAKERS', 'SOHO FABRICS', 'HOCKLEY CYCLES', 'SUMMER ROW DENTAL', 'NECHELLS NEWS & BOOZE', 'LADYPOOL LETTINGS', 'FIVE WAYS FLORIST', 'STIRCHLEY BAKERY', 'ERDINGTON PHONES', 'KINGS HEATH OPTICS', 'CANALSIDE CAFE', 'THE OLD CROWN', 'SMALL HEATH MOBILES'];
const SUBS = ['EST. 1987', 'OPEN 7 DAYS', 'FAMILY RUN SINCE 1972', 'FREE WIFI', 'HALAL', 'REPAIRS WHILE U WAIT', 'ALL OCCASIONS', '0121 643 ', 'BUY - SELL - EXCHANGE', 'LICENSED'];
// High+ sign styles: 0 flat colour + sans caps (base), 1 dark gloss + gold serif, 2 white lightbox + coloured text, 3 black fascia with raised
// letters and shadows, 4 italic signwriting; small strap line; the odd projecting-sign bracket shadow. Draws over the base fascia.
function shopSignHi(g, e, m, rnd, x, uw, fy, fH, px, col) {
  const st = rnd() * 5 | 0; if (st === 0 && rnd() < 0.5) return; const name = SHOPS2[rnd() * SHOPS2.length | 0]; const fx = x + 0.35 * px, fw = uw - 0.7 * px;
  const bg = st === 1 ? '#15181a' : st === 2 ? '#f4f2ec' : st === 3 ? '#0d0d0e' : st === 4 ? ['#2a4b3a', '#5b1a22', '#1b2d4f', '#e8dcc0'][rnd() * 4 | 0] : col;
  g.fillStyle = bg; g.fillRect(fx, fy, fw, fH); if (st === 2) { const gr = g.createLinearGradient(0, fy, 0, fy + fH); gr.addColorStop(0, 'rgba(255,255,255,0.4)'); gr.addColorStop(1, 'rgba(0,0,0,0.08)'); g.fillStyle = gr; g.fillRect(fx, fy, fw, fH); }
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(fx, fy + fH - 3, fw, 3); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(fx, fy, fw, 2);
  if (st === 1 || st === 4) { g.strokeStyle = st === 1 ? '#c9a24a' : 'rgba(240,230,200,0.8)'; g.lineWidth = 2; g.strokeRect(fx + 5, fy + 4, fw - 10, fH - 8); }
  const tc = st === 1 ? '#d8b25a' : st === 2 ? col : st === 3 ? '#f1efe8' : st === 4 ? (bg === '#e8dcc0' ? '#3a2616' : '#f3e7c6') : '#fff';
  const font = st === 1 ? `bold ${Math.round(fH * 0.46)}px Georgia, 'Times New Roman', serif` : st === 4 ? `italic bold ${Math.round(fH * 0.5)}px Georgia, serif` : st === 3 ? `900 ${Math.round(fH * 0.52)}px Impact, 'Arial Black', sans-serif` : `bold ${Math.round(fH * 0.46)}px Verdana, Arial, sans-serif`;
  const sub = rnd() < 0.45 ? SUBS[rnd() * SUBS.length | 0] : null; const subT = sub && sub.endsWith(' ') ? sub + (1000 + rnd() * 8999 | 0) : sub; const ty = fy + fH * (sub ? 0.42 : 0.52);
  for (const [k, emit] of [[g, false], [e, true]]) { k.font = font; k.textAlign = 'center'; k.textBaseline = 'middle'; const fit = Math.min(1, (fw - 0.6 * px) / k.measureText(name).width);
    k.save(); k.translate(x + uw / 2, ty); k.scale(fit, 1);
    if (!emit && st === 3) { k.fillStyle = 'rgba(0,0,0,0.6)'; k.fillText(name, 2, 3); }
    k.fillStyle = emit ? (st === 1 ? '#ffd890' : '#fff') : tc; if (emit) { k.clearRect(-fw / fit / 2, -fH / 2, fw / fit, fH); k.fillStyle = '#000'; k.fillRect(-fw / fit / 2, -fH / 2, fw / fit, fH); k.fillStyle = st === 2 ? '#ffffff' : '#fff2d8'; }
    if (emit && st === 2) k.fillRect(-fw / fit / 2, -fH / 2, fw / fit, fH); // lightbox: the whole panel glows at night
    k.fillText(name, 0, 0); k.restore();
    if (subT) { k.font = `bold ${Math.round(fH * 0.2)}px Arial, sans-serif`; k.fillStyle = emit ? '#aaa' : tc; k.fillText(subT, x + uw / 2, fy + fH * 0.8); } }
  m.fillStyle = st === 2 ? 'rgb(0,60,0)' : st === 1 ? 'rgb(0,40,0)' : 'rgb(0,110,0)'; m.fillRect(fx, fy, fw, fH); // gloss / lightbox acrylic is smoother
}
// High+ glazing extras: shutter box, the odd half-down roller shutter (not glass), window vinyls, tiled stall riser, door hours strip
function shopGlazingHi(g, e, m, rnd, x, uw, gx, gy, gw, gh, h, px) {
  g.fillStyle = '#3b3e41'; g.fillRect(gx - 5, gy - 9, gw + 10, 8); // roller-shutter box under the fascia
  if (rnd() < 0.16) { const sh = gh * (0.3 + rnd() * 0.5); g.fillStyle = '#8c9094'; g.fillRect(gx, gy, gw, sh); g.fillStyle = 'rgba(0,0,0,0.22)'; for (let y = gy; y < gy + sh; y += 5) g.fillRect(gx, y, gw, 1.5);
    if (rnd() < 0.6) { g.fillStyle = ['#c23b22', '#2f6fb3', '#e0c21a', '#3c9a4a'][rnd() * 4 | 0]; g.font = `bold ${Math.round(sh * 0.35)}px Impact, sans-serif`; g.textAlign = 'left'; g.save(); g.globalAlpha = 0.7; g.fillText(['TAGZ', 'BRUM', 'B12', 'KRZ', 'ZAK'][rnd() * 5 | 0], gx + gw * rnd() * 0.5, gy + sh * 0.6); g.restore(); } // graffiti tag
    m.fillStyle = 'rgb(0,150,60)'; m.fillRect(gx, gy, gw, sh); e.fillStyle = '#000'; e.fillRect(gx, gy, gw, sh); }
  else if (rnd() < 0.55) { const t = ['SALE', 'OPEN', '50% OFF', 'NOW OPEN', 'TO LET', 'CARDS ACCEPTED', 'NEW IN'][rnd() * 7 | 0]; g.fillStyle = t === 'SALE' || t === '50% OFF' ? 'rgba(220,30,30,0.85)' : 'rgba(250,250,250,0.8)';
    g.font = `bold ${Math.round(gh * 0.13)}px Arial, sans-serif`; g.textAlign = 'center'; g.fillText(t, gx + gw * (0.25 + rnd() * 0.5), gy + gh * (0.2 + rnd() * 0.15)); }
  if (rnd() < 0.5) { g.fillStyle = ['#7a2b22', '#1f3c5a', '#2d4a33', '#3a3a3a'][rnd() * 4 | 0]; g.fillRect(x + 0.35 * px, h - 0.45 * px, uw - 0.7 * px, 0.45 * px); g.fillStyle = 'rgba(255,255,255,0.14)'; // glazed tile riser
    for (let tx = x + 0.35 * px; tx < x + uw - 0.35 * px; tx += 9) g.fillRect(tx, h - 0.45 * px, 1, 0.45 * px); for (let ty = h - 0.45 * px; ty < h; ty += 9) g.fillRect(x + 0.35 * px, ty, uw - 0.7 * px, 1); }
}
export function shopfrontMaterial(q) {
  const rnd = mulberry(5); const R = q.env >= 2 ? 2048 : 1024, S = R / 1024; const H = 270 * S; // 16 m -> R px, 4.2 m -> ~269 px at 1024
  const rows = q.env >= 2 ? 4 : 1, hi = rows > 1; // High+: 4 different shop rows (picked per 16 m tile in the shader) with varied sign styles
  const c = canvas(R, H * rows), mk = canvas(R, H * rows), em = canvas(R, H * rows); const g = c.getContext('2d'), m = mk.getContext('2d'), e = em.getContext('2d');
  g.scale(S, S); m.scale(S, S); e.scale(S, S); const w = 1024, h = 270, px = w / 16;
  m.fillStyle = 'rgb(0,200,0)'; m.fillRect(0, 0, w, h * rows); e.fillStyle = '#000'; e.fillRect(0, 0, w, h * rows); // mask here: G = roughness, B = metalness (three.js convention)
  const cols = ['#1f3f78', '#8f1119', '#1e6b3a', '#1c1c1c', '#5a2d82', '#c26a05', '#0f5f59', '#6a2a10', '#2d3e50', '#7d0f3c', '#355e3b', '#b08d2e'];
  const units = [5.5, 5, 5.5];
  for (let row = 0; row < rows; row++) { let x0 = 0; for (const k of [g, m, e]) { k.save(); k.translate(0, row * h); }
  for (let u = 0; u < 3; u++) {
    const uw = units[u] * px, x = x0; x0 += uw; const col = cols[rnd() * cols.length | 0]; const name = SHOPS[rnd() * SHOPS.length | 0];
    g.fillStyle = '#d8d2c6'; g.fillRect(x, 0, uw, h); // stone surround
    g.fillStyle = '#b9b2a4'; g.fillRect(x, 0, 0.35 * px, h); g.fillRect(x + uw - 0.35 * px, 0, 0.35 * px, h); // pilasters
    const fy = 0.35 * px, fH = 0.75 * px; g.fillStyle = col; g.fillRect(x + 0.35 * px, fy, uw - 0.7 * px, fH); // fascia
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x + 0.35 * px, fy, uw - 0.7 * px, 3); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 0.35 * px, fy + fH - 4, uw - 0.7 * px, 4);
    g.fillStyle = rnd() < 0.3 ? '#f2c14e' : '#fff'; g.font = `bold ${Math.round(fH * 0.5)}px Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const fit = Math.min(1, (uw - 1 * px) / g.measureText(name).width); g.save(); g.translate(x + uw / 2, fy + fH / 2 + 1); g.scale(fit, 1); g.fillText(name, 0, 0); g.restore();
    e.fillStyle = '#fff'; e.font = g.font; e.textAlign = 'center'; e.textBaseline = 'middle'; e.save(); e.translate(x + uw / 2, fy + fH / 2 + 1); e.scale(fit, 1); e.fillText(name, 0, 0); e.restore();
    if (hi) shopSignHi(g, e, m, rnd, x, uw, fy, fH, px, col);
    const gy = fy + fH + 0.12 * px, gh = h - gy - 0.45 * px, gx = x + 0.45 * px, gw = uw - 0.9 * px; // glazing
    g.fillStyle = '#2a2c2e'; g.fillRect(gx - 5, gy - 5, gw + 10, gh + 10);
    const gr = g.createLinearGradient(0, gy, 0, gy + gh); gr.addColorStop(0, '#5b6a73'); gr.addColorStop(0.4, '#2d363c'); gr.addColorStop(1, '#171b1e'); g.fillStyle = gr; g.fillRect(gx, gy, gw, gh);
    for (let i = 0; i < 7; i++) { g.fillStyle = `hsla(${rnd() * 360},35%,${35 + rnd() * 30}%,0.45)`; g.fillRect(gx + rnd() * gw * 0.9, gy + gh * (0.45 + rnd() * 0.3), 10 + rnd() * 30, 8 + rnd() * 20); } // displays
    g.fillStyle = 'rgba(255,236,200,0.18)'; g.fillRect(gx, gy, gw, gh * 0.25); // interior lighting
    const dx = rnd() < 0.5 ? gx + 6 : gx + gw - 1.1 * px - 6; g.fillStyle = '#23272a'; g.fillRect(dx, gy, 1.1 * px, gh + 0.45 * px - 6); g.fillStyle = '#3c4a52'; g.fillRect(dx + 6, gy + 6, 1.1 * px - 12, gh * 0.8); // door
    g.fillStyle = '#2a2c2e'; g.fillRect(gx + gw / 2 - 3, gy, 6, gh); // mullion
    g.fillStyle = '#4a4540'; g.fillRect(x + 0.35 * px, h - 0.45 * px, uw - 0.7 * px, 0.45 * px); // stall riser
    m.fillStyle = 'rgb(0,15,120)'; m.fillRect(gx, gy, gw, gh); m.fillStyle = 'rgb(0,90,0)'; m.fillRect(x + 0.35 * px, fy, uw - 0.7 * px, fH);
    e.fillStyle = 'rgba(255,225,170,0.55)'; e.fillRect(gx, gy, gw, gh);
    if (hi) shopGlazingHi(g, e, m, rnd, x, uw, gx, gy, gw, gh, h, px);
  }
  for (const k of [g, m, e]) k.restore(); }
  const map = ctex(c, q), rm = ctex(mk, q, false), emt = ctex(em, q);
  const mat = new THREE.MeshStandardMaterial({ map, roughnessMap: rm, metalnessMap: rm, roughness: 1, metalness: 1, emissiveMap: emt, emissive: 0x000000, envMapIntensity: 1 });
  if (q.env >= 1) { // Medium+: shop interiors (interior mapping into the 4x2 shop atlas, 5 m deep behind each unit's glazing), lit day and night
    const atlas = atlasTex(q, 'shops'); mat.customProgramCacheKey = () => 'shopint' + rows; mat.defines = { SHOP_INT: 1 };
    mat.onBeforeCompile = sh => { sh.uniforms.intMap = { value: atlas };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; varying vec2 vSU;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal); vSU = uv;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; varying vec2 vSU; uniform sampler2D intMap; vec3 roomE; float glassK;' + ROOM_GLSL)
        .replace('#include <map_fragment>', (hi ? `vec3 sNr = normalize(vWN); float shRow = floor(hsh(vec3(floor(vSU.x), floor(sNr.x * 6.0 + 0.5), floor(sNr.z * 6.0 + 0.5))) * ${rows}.0);
          vec2 sUV = vec2(vMapUv.x, (clamp(vMapUv.y, 0.004, 0.996) + shRow) / ${rows}.0);\n` + THREE.ShaderChunk.map_fragment.replaceAll('vMapUv', 'sUV') : '#include <map_fragment>') + `
          roomE = vec3(0.0); glassK = 0.0;
          { float um = fract(vSU.x) * 16.0; float ui = floor(vSU.x); float u0 = um < 5.5 ? 0.0 : um < 10.5 ? 5.5 : 10.5; float u1 = um < 5.5 ? 5.5 : um < 10.5 ? 10.5 : 16.0;
            float ym = vSU.y * 4.2; vec2 lp = vec2((um - u0 - 0.45) / (u1 - u0 - 0.9), (ym - 0.45) / 2.53);
            glassK = step(0.0, lp.x) * step(lp.x, 1.0) * step(0.0, lp.y) * step(lp.y, 1.0) * step(0.35, texture2D(roughnessMap, ${hi ? 'sUV' : 'vRoughnessMapUv'}).b);
            if (glassK > 0.5) { vec3 N = normalize(vWN); vec3 Tc = vec3(-N.z, 0.0, N.x); float su = dot(dFdx(vWP), Tc) * dFdx(vSU.x) + dot(dFdy(vWP), Tc) * dFdy(vSU.x); Tc *= su >= 0.0 ? 1.0 : -1.0;
              vec3 V = normalize(vWP - cameraPosition); float hw = (u1 - u0 - 0.9) * 0.5; vec3 d = vec3(dot(V, Tc) / hw, V.y / 1.265, dot(V, -N) / 5.0);
              vec3 h = roomHit(vec3(lp * 2.0 - 1.0, 0.0), d); float rh = hsh(vec3(ui, u0, floor(vWP.x * 0.05) + floor(vWP.z * 0.05) * 7.0));
              float fr = pow(1.0 - clamp(dot(-V, N), 0.0, 1.0), 2.0); vec2 rg2 = 0.95 / vec2(4.0, 2.0) * 0.5; roomE = roomCol(intMap, h, floor(rh * 8.0), 0.45, dFdx(lp * 2.0) * rg2, dFdy(lp * 2.0) * rg2) * vec3(0.9, 0.95, 0.97) * (1.0 - fr) * (0.32 + 1.0 * clamp(emissive.r, 0.0, 1.0));
              diffuseColor.rgb *= 0.35; } }`)
        .replace('#include <emissivemap_fragment>', (hi ? THREE.ShaderChunk.emissivemap_fragment.replaceAll('vEmissiveMapUv', 'sUV') : '#include <emissivemap_fragment>') + '\ntotalEmissiveRadiance = totalEmissiveRadiance * (1.0 - glassK) + roomE;');
      if (hi) sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', THREE.ShaderChunk.roughnessmap_fragment.replaceAll('vRoughnessMapUv', 'sUV'))
        .replace('#include <metalnessmap_fragment>', THREE.ShaderChunk.metalnessmap_fragment.replaceAll('vMetalnessMapUv', 'sUV'));
    };
  }
  return mat;
}
// awning texture: coloured stripes
export function awningMaterial(q) {
  const c = canvas(256, 64), g = c.getContext('2d'); const cs = [['#1f5f3a', '#efe9dc'], ['#8f1119', '#efe9dc'], ['#1f3f78', '#e8e8e8'], ['#2b2b2b', '#2b2b2b'], ['#6a2a10', '#d8b67a']];
  for (let i = 0; i < 5; i++) { const [a, b] = cs[i]; for (let s = 0; s < 8; s++) { g.fillStyle = s % 2 ? b : a; g.fillRect(i * 51 + s * 6.4, 0, 6.4, 64); } g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(i * 51, 54, 51, 10); }
  const t = ctex(c, q); t.wrapS = THREE.ClampToEdgeWrapping; return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, side: THREE.DoubleSide });
}
// awning quad from wall edge a->b (outward normal n) between arc fraction t0..t1
export function awningGeo(a, b, n, t0, t1, colour) {
  const p = t => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; const A = p(t0), B = p(t1); const out = 1.3, y0 = 3.35, y1 = 2.7;
  const v = [[A[0], y0, A[1]], [B[0], y0, B[1]], [B[0] + n[0] * out, y1, B[1] + n[1] * out], [A[0] + n[0] * out, y1, A[1] + n[1] * out]];
  const pos = [], uv = []; const u0 = colour / 5 + 0.01, u1 = (colour + 1) / 5 - 0.01;
  const U = [[u0, 1], [u1, 1], [u1, 0], [u0, 0]]; for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...v[k]); uv.push(...U[k]); }
  // valance (hanging front strip)
  const va = [v[3], v[2], [v[2][0], y1 - 0.25, v[2][2]], [v[3][0], y1 - 0.25, v[3][2]]]; for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...va[k]); uv.push(...[[u0, 0.12], [u1, 0.12], [u1, 0], [u0, 0]][k]); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); return g;
}

// ------------------------------------------------------------------------------------------------------------------
// Street clutter: litter bins, K6 phone boxes, pillar boxes, BT/utility cabinets, benches, bus shelters.
// Built as vertex-coloured geometry (one draw call per map chunk) + one glass material for shelter panels.
// ------------------------------------------------------------------------------------------------------------------
function colourise(g, hex) { g = g.index ? g.toNonIndexed() : g; const c = new THREE.Color(hex); const n = g.attributes.position.count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (g.attributes.uv) g.deleteAttribute('uv'); return g; }
const box = (w, h, d, x, y, z, col) => colourise(new THREE.BoxGeometry(w, h, d).translate(x, y, z), col);
const cyl = (r0, r1, h, seg, x, y, z, col) => colourise(new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y, z), col);
let PROPS = null;
function props() { // local frame: x along the kerb, z = away from the road (+z towards buildings), y up
  if (PROPS) return PROPS;
  const bin = mergeGeometries([cyl(0.28, 0.25, 0.95, 10, 0, 0.475, 0, 0x1c1f1d), cyl(0.3, 0.3, 0.1, 10, 0, 0.9, 0, 0x2a2d2b), cyl(0.285, 0.285, 0.08, 10, 0, 0.72, 0, 0xb39245)]);
  const pillar = mergeGeometries([cyl(0.26, 0.26, 1.25, 12, 0, 0.625, 0, 0xb3120f), new THREE.SphereGeometry(0.28, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.25, 0), cyl(0.3, 0.3, 0.12, 12, 0, 0.06, 0, 0x151515), box(0.22, 0.03, 0.02, 0, 1.05, -0.262, 0x111111)].map((g, i) => i === 1 ? colourise(g, 0xb3120f) : g));
  const k6 = []; { const R = 0xa8120e; k6.push(box(0.92, 0.12, 0.92, 0, 0.06, 0, 0x8a0f0c), box(0.86, 2.2, 0.86, 0, 1.22, 0, R), box(0.94, 0.12, 0.94, 0, 2.38, 0, R), box(0.7, 0.16, 0.7, 0, 2.52, 0, R));
    for (const [sx, sz, rx] of [[0, -0.435, 0], [0, 0.435, 0], [-0.435, 0, 1], [0.435, 0, 1]]) { k6.push(box(rx ? 0.02 : 0.6, 1.5, rx ? 0.6 : 0.02, sx * 1.01, 1.25, sz * 1.01, 0x1b2226)); for (let i = 1; i < 3; i++) k6.push(box(rx ? 0.03 : 0.6, 0.03, rx ? 0.6 : 0.03, sx * 1.02, 0.5 + i * 0.5, sz * 1.02, R)); k6.push(box(rx ? 0.03 : 0.03, 1.5, rx ? 0.03 : 0.03, sx * 1.02, 1.25, sz * 1.02, R)); k6.push(box(rx ? 0.02 : 0.5, 0.1, rx ? 0.5 : 0.02, sx * 1.07, 2.25, sz * 1.07, 0xeeeeee)); } }
  const phone = mergeGeometries(k6);
  const cab = mergeGeometries([box(1.1, 1.2, 0.42, 0, 0.6, 0, 0x2f4a3a), box(1.14, 0.05, 0.46, 0, 1.22, 0, 0x2a4032)]);
  const bench = mergeGeometries([box(1.8, 0.05, 0.45, 0, 0.45, 0, 0x5a4330), box(1.8, 0.4, 0.05, 0, 0.7, 0.22, 0x5a4330), box(0.06, 0.45, 0.45, -0.8, 0.22, 0, 0x2a2a2a), box(0.06, 0.45, 0.45, 0.8, 0.22, 0, 0x2a2a2a)]);
  const shelter = mergeGeometries([box(3.6, 0.08, 1.5, 0, 2.5, 0.25, 0x3a3d40), ...[-1.75, 1.75].flatMap(x => [box(0.07, 2.5, 0.07, x, 1.25, 0.95, 0x55595d), box(0.07, 2.5, 0.07, x, 1.25, -0.4, 0x55595d)]), box(3.4, 0.05, 0.35, 0, 0.45, 0.8, 0x44484c), box(0.12, 2.3, 0.05, 1.2, 1.25, -0.45, 0x2a2d2f), box(0.5, 0.6, 0.06, 1.2, 1.8, -0.46, 0xe8eef3)]);
  const shelterGlass = mergeGeometries([box(3.4, 2.2, 0.02, 0, 1.3, 0.97, 0xffffff), box(0.02, 2.2, 1.2, -1.75, 1.3, 0.3, 0xffffff), box(0.02, 2.2, 1.2, 1.75, 1.3, 0.3, 0xffffff)]);
  const post = mergeGeometries([cyl(0.04, 0.04, 2.6, 6, 0, 1.3, 0, 0x6d7276), box(0.02, 0.4, 0.4, 0, 2.5, 0, 0x1e3b8a)]); // bus-stop flag
  // High+ extras: bollards, sign posts (red-ring, blue, warning triangle), street name plate, grit bin, wheelie/recycling bins,
  // Sheffield cycle stands, parking pay station
  const disc = (r, x, y, z, col) => colourise(new THREE.CylinderGeometry(r, r, 0.02, 14).rotateX(Math.PI / 2).translate(x, y, z), col);
  const bollard = mergeGeometries([cyl(0.09, 0.1, 0.95, 8, 0, 0.475, 0, 0x151617), cyl(0.1, 0.1, 0.05, 8, 0, 0.72, 0, 0xc9a54a), cyl(0.07, 0.1, 0.08, 8, 0, 0.99, 0, 0x151617)]);
  const signRed = mergeGeometries([cyl(0.035, 0.035, 2.7, 6, 0, 1.35, 0, 0x8d9296), disc(0.3, 0, 2.45, -0.05, 0xc0141a), disc(0.24, 0, 2.45, -0.062, 0xf2f2f0), box(0.14, 0.05, 0.01, 0, 2.47, -0.075, 0x111111), box(0.06, 0.12, 0.01, 0.07, 2.42, -0.075, 0x111111)]);
  const signBlue = mergeGeometries([cyl(0.035, 0.035, 2.7, 6, 0, 1.35, 0, 0x8d9296), disc(0.3, 0, 2.45, -0.05, 0x1d4fa0), box(0.3, 0.06, 0.01, 0, 2.45, -0.064, 0xf2f2f0), box(0.06, 0.2, 0.01, 0.08, 2.45, -0.064, 0xf2f2f0)]);
  const tri = (() => { const g = new THREE.CylinderGeometry(0.36, 0.36, 0.02, 3).rotateX(Math.PI / 2).rotateZ(Math.PI).translate(0, 2.5, -0.05); const g2 = new THREE.CylinderGeometry(0.26, 0.26, 0.02, 3).rotateX(Math.PI / 2).rotateZ(Math.PI).translate(0, 2.5, -0.062); return [colourise(g, 0xc0141a), colourise(g2, 0xf2f2f0)]; })();
  const signWarn = mergeGeometries([cyl(0.035, 0.035, 2.7, 6, 0, 1.35, 0, 0x8d9296), ...tri, box(0.05, 0.2, 0.01, 0, 2.47, -0.075, 0x111111)]);
  const namePlate = mergeGeometries([box(0.05, 1.0, 0.05, -0.6, 0.5, 0, 0x1a1a1a), box(0.05, 1.0, 0.05, 0.6, 0.5, 0, 0x1a1a1a), box(1.3, 0.28, 0.04, 0, 0.9, 0, 0x111111), box(1.24, 0.22, 0.045, 0, 0.9, 0, 0xf4f4f0),
    ...[-0.45, -0.3, -0.15, 0, 0.15, 0.3].map(x => box(0.09, 0.1, 0.05, x, 0.9, 0, 0x151515)), box(0.12, 0.1, 0.05, 0.47, 0.9, 0, 0xb81d1d)]); // lettering blocks + red postcode box
  const grit = mergeGeometries([box(0.9, 0.6, 0.6, 0, 0.3, 0, 0xe0b51a), box(0.95, 0.12, 0.66, 0, 0.66, 0, 0xd1a714), box(0.5, 0.12, 0.02, 0, 0.45, -0.31, 0x1a1a1a)]);
  const wheelie = mergeGeometries([box(0.58, 0.95, 0.72, 0, 0.5, 0, 0x2d5d33), box(0.62, 0.06, 0.78, 0, 1.0, 0, 0x2a5530), box(0.5, 0.95, 0.02, 0, 0.5, -0.37, 0x264f2b)]);
  const recyc = mergeGeometries([box(0.58, 0.95, 0.72, 0, 0.5, 0, 0x1f3f78), box(0.62, 0.06, 0.78, 0, 1.0, 0, 0x5b6068)]);
  const hoop = (x) => { const g = new THREE.TorusGeometry(0.38, 0.03, 5, 10, Math.PI).translate(0, 0.45, 0); const a = [colourise(g, 0x2a2d30)]; a.push(box(0.06, 0.45, 0.06, -0.38, 0.22, 0, 0x2a2d30), box(0.06, 0.45, 0.06, 0.38, 0.22, 0, 0x2a2d30)); return a.map(g => g.translate(x, 0, 0)); };
  const cycles = mergeGeometries([...hoop(-0.5), ...hoop(0.5)]);
  const payst = mergeGeometries([box(0.35, 1.4, 0.28, 0, 0.7, 0, 0x2b2f33), box(0.3, 0.3, 0.02, 0, 1.15, -0.15, 0x0e1a24), box(0.33, 0.12, 0.3, 0, 1.46, 0, 0xe0b51a), box(0.12, 0.05, 0.02, 0, 0.85, -0.15, 0x777b80)]);
  return (PROPS = { bin, pillar, phone, cab, bench, shelter, shelterGlass, post, bollard, signRed, signBlue, signWarn, namePlate, grit, wheelie, recyc, cycles, payst });
}
// W: World (for onAnyDrive / insideBuilding checks); pavements: [{P, side, off}] candidate lines
export function buildClutter(W, group, q) {
  const rnd = mulberry(31); const P = props(); const out = [], glass = []; const m4 = new THREE.Matrix4(), qu = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const clearAt = (x, z, r) => { for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) { if (W.onAnyDrive(x + ox, z + oz, 0, -0.5)) return false; if (W.insideBuilding(x + ox, z + oz, 0)) return false; } return true; };
  const place = (geo, x, z, yaw, list) => { qu.setFromAxisAngle(up, yaw); m4.compose(new THREE.Vector3(x, 0.11, z), qu, new THREE.Vector3(1, 1, 1)); list.push(geo.clone().applyMatrix4(m4)); };
  const rj = mulberry(47); const hiC = q.env >= 2; // High+: extra prop types, denser placement, bollards / signs / name plates near junctions
  const dens = [0.35, 0.7, 1.5, 1.8][q.env] || 0.7; let n = 0; const cap = [700, 1600, 3800, 5000][q.env] || 1600; const taken = [];
  const farFrom = (x, z, d) => { for (const t of taken) if ((t[0] - x) ** 2 + (t[1] - z) ** 2 < d * d) return false; return true; };
  for (const { r, P: pts, hw, hid } of W.edges) {
    if (hid || r.tun || /service|motorway|footway|path/.test(r.k) || pts[0][2] < -0.5 || Math.abs(pts[0][2]) > 0.5 || Math.abs(pts[pts.length - 1][2]) > 0.5) continue;
    const L = pts[pts.length - 1][3]; if (L < 25) continue; const pw = /trunk|primary/.test(r.k) ? 3 : 2.4; const major = /trunk|primary|secondary/.test(r.k);
    let a = 8 + rnd() * 20;
    while (a < L - 8 && n < cap) {
      const s = pointAtP(pts, a); const side = rnd() < 0.5 ? -1 : 1; const off = hw + 0.3 + pw * 0.62;
      const x = s[0] + s[3] * side * off, z = s[1] + s[4] * side * off; const yaw = Math.atan2(s[3] * side, s[4] * side); // local +z points away from the road
      const k = rnd(); let geo, rad = 0.4, gl = null;
      if (major && k < 0.07) { geo = P.shelter; gl = P.shelterGlass; rad = 1.9; } else if (major && k < 0.1) { geo = P.post; rad = 0.3; }
      else if (k < 0.16) { geo = P.phone; rad = 0.6; } else if (k < 0.26) { geo = P.pillar; rad = 0.35; } else if (k < 0.42) { geo = P.cab; rad = 0.65; } else if (k < 0.52 && q.env >= 1) { geo = P.bench; rad = 1; } else if (hiC && k < 0.6) { geo = P.grit; rad = 0.55; } else if (hiC && k < 0.68) { geo = k < 0.64 ? P.wheelie : P.recyc; rad = 0.45; } else if (hiC && k < 0.74) { geo = P.cycles; rad = 1.0; } else if (hiC && major && k < 0.8) { geo = P.payst; rad = 0.35; } else geo = P.bin;
      if (clearAt(x, z, rad) && farFrom(x, z, 6)) { place(geo, x, z, yaw, out); if (gl) place(gl, x, z, yaw, glass); taken.push([x, z]); n++; }
      a += (major ? 28 : 45) / dens * (0.6 + rnd() * 0.8);
    }
    if (hiC && n < cap) for (const end of [0, 1]) for (const side of [-1, 1]) { // junction ends: sign posts, street name plates, bollard runs
      const kk = rj(); const a0 = end ? L - 5 - rj() * 5 : 5 + rj() * 5; const s = pointAtP(pts, a0); const yaw = Math.atan2(s[3] * side, s[4] * side);
      const at = o => [s[0] + s[3] * side * o, s[1] + s[4] * side * o];
      if (kk < 0.3) { const [x, z] = at(hw + 0.5); if (clearAt(x, z, 0.3) && farFrom(x, z, 2.5)) { place([P.signRed, P.signBlue, P.signWarn][rj() * 3 | 0], x, z, yaw, out); taken.push([x, z]); n++; } }
      else if (kk < 0.5) { const [x, z] = at(hw + 0.3 + pw * 0.92); if (clearAt(x, z, 0.7) && farFrom(x, z, 3)) { place(P.namePlate, x, z, yaw, out); taken.push([x, z]); n++; } }
      else if (kk < 0.75) { const dir = end ? -1 : 1; for (let b = 0; b < 3 + (rj() * 3 | 0); b++) { const q2 = pointAtP(pts, a0 + dir * b * 1.5); const x = q2[0] + q2[3] * side * (hw + 0.55), z = q2[1] + q2[4] * side * (hw + 0.55);
        if (clearAt(x, z, 0.15) && farFrom(x, z, 1.1)) { place(P.bollard, x, z, yaw, out); taken.push([x, z]); n++; } } }
    }
  }
  if (out.length) { const m = new THREE.Mesh(mergeGeometries(out), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 })); m.castShadow = q.shadows >= 1 && q.env >= 2; m.receiveShadow = true; group.add(m); }
  if (glass.length) { const m = new THREE.Mesh(mergeGeometries(glass), new THREE.MeshStandardMaterial({ color: 0xcfe0e8, transparent: true, opacity: 0.28, roughness: 0.05, metalness: 0.1, depthWrite: false })); group.add(m); }
  return n;
}
function pointAtP(P, a) { for (let i = 0; i < P.length - 1; i++) if (P[i + 1][3] >= a || i === P.length - 2) { const dx = P[i + 1][0] - P[i][0], dz = P[i + 1][1] - P[i][1], l = Math.hypot(dx, dz) || 1; const t = Math.max(0, Math.min(1, (a - P[i][3]) / l)); return [P[i][0] + dx * t, P[i][1] + dz * t, 0, -dz / l, dx / l]; } return [P[0][0], P[0][1], 0, 1, 0]; }

// ------------------------------------------------------------------------------------------------------------------
// Rooftops: parapet walls with coping, plant (AC units, lift overrun, water tank)
// ------------------------------------------------------------------------------------------------------------------
export function roofMaterial(q) { const t = cityTex(q, 'roof'); t.repeat.set(1, 1); return new THREE.MeshStandardMaterial({ map: t, color: 0xb8b8b8, roughness: 0.95, normalMap: q.env >= 1 ? cityTex(q, 'roof', { normal: true }) : null }); }
export function parapetMaterial(q) { const t = cityTex(q, 'concrete'); return new THREE.MeshStandardMaterial({ map: t, color: 0xc8c3ba, roughness: 0.9, side: THREE.DoubleSide }); }
// roof plant (vertex-coloured, one merged mesh): condenser/AC units with fan grilles, lift overrun with louvre band,
// galvanised sectional water tank on a steel stand, vent stacks, the odd satellite dish. inside(x,z) keeps items on the roof.
export function roofPlant(c, h, rnd, big, inside = () => true, env = 1) {
  const out = []; const n = big ? 2 + (rnd() * 3 | 0) : 1 + (rnd() * 2 | 0); const ok = (x, z, r) => inside(x - r, z - r) && inside(x + r, z - r) && inside(x + r, z + r) && inside(x - r, z + r);
  for (let i = 0; i < n; i++) { const w = 1.2 + rnd() * 2.2, d = 1 + rnd() * 1.6, hh = 0.9 + rnd() * 1; const ox = (rnd() - 0.5) * 6, oz = (rnd() - 0.5) * 6; const x = c[0] + ox, z = c[1] + oz;
    const fan = rnd() < 0.5; if (!ok(x, z, Math.max(w, d) / 2)) continue;
    out.push(box(w, hh, d, x, h + hh / 2, z, 0xb7babc), box(w + 0.06, 0.06, d + 0.06, x, h + 0.03, z, 0x6e7274)); // AC unit on its plinth
    if (env >= 2) out.push(box(w * 0.9, hh * 0.5, 0.02, x, h + hh * 0.5, z - d / 2 - 0.011, 0x4a4e51)); // side grille
    if (fan) out.push(cyl(0.38, 0.38, 0.1, 8, x, h + hh + 0.05, z, 0x3b3e40), cyl(0.3, 0.3, 0.11, 8, x, h + hh + 0.06, z, 0x1f2122)); }
  if (big) { const x = c[0] + 2, z = c[1] - 2; out.push(box(3.2, 2.8, 2.6, x, h + 1.4, z, 0x8e8a83)); if (env >= 1) out.push(box(3.24, 0.6, 2.64, x, h + 2.1, z, 0x5c5e5f), box(3.4, 0.12, 2.8, x, h + 2.86, z, 0x77736d)); } // lift overrun: louvres + coping
  if (env >= 1 && (big || rnd() < 0.35)) { const x = c[0] - 2.5 + rnd(), z = c[1] + 2 + rnd(); if (ok(x, z, 1.4)) { const tw = 2 + rnd() * 1.2, td = 1.6 + rnd() * 0.8, th = 1.4 + rnd() * 0.6, st = 0.9;
      const col = rnd() < 0.5 ? 0xa4aaad : 0x7d8b7c; out.push(box(tw, th, td, x, h + st + th / 2, z, col), box(tw + 0.08, 0.08, td + 0.08, x, h + st + th, z, 0x6a7072));
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) out.push(box(0.1, st, 0.1, x + sx * (tw / 2 - 0.1), h + st / 2, z + sz * (td / 2 - 0.1), 0x3f4244)); // tank legs
      if (env >= 2) for (let k = 1; k < 3; k++) out.push(box(tw + 0.03, 0.04, td + 0.03, x, h + st + th * k / 3, z, 0x8c9295)); } } // panel seams
  if (env >= 2) { const nv = 1 + (rnd() * 3 | 0); for (let i = 0; i < nv; i++) { const x = c[0] + (rnd() - 0.5) * 8, z = c[1] + (rnd() - 0.5) * 8; if (!ok(x, z, 0.3)) continue; const vh = 0.8 + rnd() * 1.4;
      out.push(cyl(0.12, 0.12, vh, 6, x, h + vh / 2, z, 0x55595c), cyl(0.2, 0.2, 0.12, 6, x, h + vh + 0.06, z, 0x3d4042)); } // vent stacks with cowls
    if (rnd() < 0.2) { const x = c[0] + (rnd() - 0.5) * 5, z = c[1] + (rnd() - 0.5) * 5; if (ok(x, z, 0.6)) out.push(cyl(0.04, 0.04, 1.2, 6, x, h + 0.6, z, 0x6d7276), colourise(new THREE.SphereGeometry(0.5, 10, 5, 0, Math.PI * 2, 0, 0.8).rotateX(1.3).translate(x, h + 1.25, z), 0xd9dcdd)); } } // satellite dish
  return out.map(g => g.index ? g.toNonIndexed() : g);
}

// hipped slate roof for small, near-rectangular low-rise footprints (UK terraces / villas). Returns null if the footprint
// is not close to its minimum-area rectangle. Planar UVs in metres / 4 along the slope.
export function hipRoof(pts, h, area) {
  let best = null; const n = pts.length;
  for (let i = 0; i < n; i++) { const A = pts[i], B = pts[(i + 1) % n]; const L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L < 1) continue; const ux = (B[0] - A[0]) / L, uz = (B[1] - A[1]) / L;
    let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9; for (const p of pts) { const a = p[0] * ux + p[1] * uz, b = -p[0] * uz + p[1] * ux; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
    const ar = (a1 - a0) * (b1 - b0); if (!best || ar < best.ar) best = { ar, ux, uz, a0, a1, b0, b1 }; }
  if (!best || area / best.ar < 0.9) return null;
  let { ux, uz, a0, a1, b0, b1 } = best; if (a1 - a0 < b1 - b0) { [ux, uz] = [-uz, ux]; [a0, a1, b0, b1] = [b0, b1, -a1, -a0]; } // long axis = a
  const S = b1 - b0, Lg = a1 - a0; if (S < 3 || S > 14) return null; const H = S / 2 * Math.tan(0.56), bm = (b0 + b1) / 2, o = 0.25; // ~32 deg pitch, 0.25 m eaves overhang
  const W = (a, b, y) => [a * ux - b * uz, y, a * uz + b * ux];
  const e = [W(a0 - o, b0 - o, h), W(a1 + o, b0 - o, h), W(a1 + o, b1 + o, h), W(a0 - o, b1 + o, h)], r0 = W(a0 + S / 2, bm, h + H), r1 = W(a1 - S / 2, bm, h + H);
  const tris = [[e[0], r0, e[1]], [e[1], r0, r1], [e[1], r1, e[2]], [e[2], r1, e[3]], [e[3], r1, r0], [e[3], r0, e[0]]];
  const pos = [], uv = []; for (const t of tris) for (const v of t) { pos.push(...v); uv.push((v[0] * ux + v[2] * uz) / 4, (-v[0] * uz + v[2] * ux) / 4 + v[1] / 4); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) { const p = g.attributes.position; for (let i = 0; i < p.count; i += 3) { const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1); p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)); p.setXYZ(i + 2, x, y, z); } g.computeVertexNormals(); }
  return g;
}
export function slateMaterial(q) { const t = cityTex(q, 'roof'); return new THREE.MeshStandardMaterial({ map: t, color: 0x6c727a, roughness: 0.7, metalness: 0.05, normalMap: q.env >= 1 ? cityTex(q, 'roof', { normal: true }) : null, side: THREE.DoubleSide }); }

// ------------------------------------------------------------------------------------------------------------------
// Trees: trunk with forks, multi-lobe crown with a real leaf texture; on High+ alpha-cut leaf cards round the crown
// ------------------------------------------------------------------------------------------------------------------
export function treeParts(q, rnd) {
  const trunk = mergeGeometries([new THREE.CylinderGeometry(0.16, 0.28, 3.4, 7).translate(0, 1.7, 0), new THREE.CylinderGeometry(0.07, 0.13, 2.2, 5).rotateZ(0.5).translate(-0.5, 4, 0), new THREE.CylinderGeometry(0.07, 0.13, 2.2, 5).rotateZ(-0.45).rotateY(1.2).translate(0.3, 4, 0.4)].map(g => g.toNonIndexed()));
  const lobes = q.env >= 1 ? [[0, 5.6, 0, 2.3], [-1.3, 5.0, 0.4, 1.7], [1.2, 5.2, -0.5, 1.8], [0.2, 6.6, 0.3, 1.6]] : [[0, 5.4, 0, 2.6]];
  const crown = mergeGeometries(lobes.map(([x, y, z, r]) => { const g = new THREE.IcosahedronGeometry(r, 1); const pa = g.attributes.position; for (let i = 0; i < pa.count; i++) { const k = 0.82 + rnd() * 0.36; pa.setXYZ(i, pa.getX(i) * k, pa.getY(i) * k * 1.05, pa.getZ(i) * k); } // spherical UVs are poor on an icosahedron: planar-ish UVs from position
    const uv = g.attributes.uv; for (let i = 0; i < pa.count; i++) uv.setXY(i, (pa.getX(i) + pa.getZ(i) * 0.7) / 2.2, pa.getY(i) / 2.2); g.computeVertexNormals(); return g.translate(x, y, z); }));
  const leaf = cityTex(q, 'leaves'); const leafN = q.env >= 1 ? cityTex(q, 'leaves', { normal: true }) : null;
  const crownMat = new THREE.MeshStandardMaterial({ map: leaf, normalMap: leafN, roughness: 0.85, color: 0xc8d8b0 });
  const bark = new THREE.MeshStandardMaterial({ color: 0x5b4a3a, roughness: 1 });
  let cards = null, cardMat = null;
  if (q.env >= 2) { // High+: layered alpha leaf cards (twig sprays with pointed leaves) in two shells round each lobe, barked trunk
    const c = canvas(512, 512), g = c.getContext('2d'); const r2 = mulberry(77);
    const leafAt = (x, y, a, L, hue, lit) => { g.save(); g.translate(x, y); g.rotate(a); const W = L * 0.42;
      g.fillStyle = `hsl(${hue},${38 + r2() * 22}%,${lit}%)`; g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(L * 0.3, -W, L * 0.75, -W * 0.7, L, 0); g.bezierCurveTo(L * 0.75, W * 0.7, L * 0.3, W, 0, 0); g.fill();
      g.strokeStyle = `hsla(${hue},30%,${lit + 12}%,0.55)`; g.lineWidth = 1; g.beginPath(); g.moveTo(1, 0); g.lineTo(L * 0.92, 0); g.stroke(); g.restore(); };
    for (let s = 0; s < 7; s++) { // sprays radiating from the card centre; darker underneath (self-shadow), lighter on top
      const a0 = s / 7 * 6.28 + r2() * 0.6, len = 150 + r2() * 90; g.strokeStyle = '#4b3a2a'; g.lineWidth = 3; g.beginPath(); g.moveTo(256, 256);
      const ex = 256 + Math.cos(a0) * len, ey = 256 + Math.sin(a0) * len; g.quadraticCurveTo(256 + Math.cos(a0 + 0.3) * len * 0.5, 256 + Math.sin(a0 + 0.3) * len * 0.5, ex, ey); g.stroke();
      for (let k = 0; k < 26; k++) { const t = 0.15 + r2() * 0.85, px = 256 + (ex - 256) * t + (r2() - 0.5) * 30, py = 256 + (ey - 256) * t + (r2() - 0.5) * 30;
        const lit = 20 + (1 - py / 512) * 24 + r2() * 10; leafAt(px, py, a0 + (r2() - 0.5) * 2.2, 26 + r2() * 22, 78 + r2() * 38, lit); } }
    const t = ctex(c, q); t.anisotropy = 6;
    cardMat = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, color: 0xd6e2c4 });
    cardMat.customProgramCacheKey = () => 'leafCardLod';
    cardMat.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
      { vec3 ip = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; float dC = distance(ip, cameraPosition); transformed *= 1.0 - step(170.0, dC); } // distance LOD: cards collapse, the crown carries the silhouette
      #endif`); };
    const qs = []; const dir = new THREE.Vector3();
    for (let i = 0; i < 40; i++) { const L = lobes[i % lobes.length]; dir.set(r2() - 0.5, r2() * 1.0 - 0.3, r2() - 0.5).normalize(); const sz = 1.3 + r2() * 0.8, sh = i < 26 ? 0.98 + r2() * 0.1 : 0.65 + r2() * 0.2; // outer + inner shell
      const p = new THREE.PlaneGeometry(sz, sz); p.rotateZ(r2() * 6.28); p.lookAt(dir); p.translate(L[0] + dir.x * L[3] * sh, L[1] + dir.y * L[3] * sh, L[2] + dir.z * L[3] * sh);
      const n = p.attributes.normal; for (let k = 0; k < n.count; k++) n.setXYZ(k, dir.x * 0.7, dir.y * 0.7 + 0.3, dir.z * 0.7); // crown-shaped normals: soft, even foliage shading
      qs.push(p.toNonIndexed()); }
    cards = mergeGeometries(qs);
    crownMat.color.setHex(0x9fb488); // inner mass reads as shaded foliage behind the cards
    const bc = canvas(128, 256), bg = bc.getContext('2d'); bg.fillStyle = '#5a4a3b'; bg.fillRect(0, 0, 128, 256); const r3 = mulberry(55);
    for (let i = 0; i < 70; i++) { const x = r3() * 128; bg.strokeStyle = `rgba(${20 + r3() * 30 | 0},${16 + r3() * 20 | 0},${10 + r3() * 14 | 0},${0.4 + r3() * 0.4})`; bg.lineWidth = 1 + r3() * 3; bg.beginPath(); bg.moveTo(x, 0); let y = 0, xx = x; while (y < 256) { y += 8 + r3() * 20; xx += (r3() - 0.5) * 6; bg.lineTo(xx, y); } bg.stroke(); } // bark fissures
    for (let i = 0; i < 40; i++) { bg.fillStyle = `rgba(${120 + r3() * 40 | 0},${120 + r3() * 30 | 0},${90 + r3() * 30 | 0},0.18)`; bg.fillRect(r3() * 128, r3() * 256, 4 + r3() * 10, 8 + r3() * 20); } // lichen / lighter plates
    const bt = ctex(bc, q); bt.repeat.set(2, 1.5); bark.map = bt; bark.color.setHex(0xb0a090);
  }
  return { trunk, crown, crownMat, bark, cards, cardMat };
}

// ------------------------------------------------------------------------------------------------------------------
// Distant skyline: varied blocks with a window texture (fades into the fog), a few towers
// ------------------------------------------------------------------------------------------------------------------
export function skylineMaterial(q) {
  const c = canvas(128, 128), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128); const r = mulberry(9);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const v = 70 + r() * 50 | 0; g.fillStyle = `rgb(${v},${v + 6},${v + 14})`; g.fillRect(x * 16 + 3, y * 16 + 4, 10, 8); }
  const t = ctex(c, q); return new THREE.MeshStandardMaterial({ map: t, vertexColors: true, roughness: 0.9, metalness: 0 });
}
export function skylineBox(w, h, d, col) { const b = new THREE.BoxGeometry(w, h, d); const uv = b.attributes.uv, n = b.attributes.normal; for (let i = 0; i < uv.count; i++) { const side = Math.abs(n.getY(i)) < 0.5; const fw = Math.abs(n.getX(i)) > 0.5 ? d : w; uv.setXY(i, side ? uv.getX(i) * fw / 10 : 0.01, side ? uv.getY(i) * h / 7 : 0.01); } return colourise2(b, col); }
function colourise2(g, col) { const n = g.attributes.position.count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g.index ? g.toNonIndexed() : g; }
export function planarUV(g, tile) { g = g.index ? g.toNonIndexed() : g; const p = g.attributes.position; const uv = new Float32Array(p.count * 2); for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / tile; uv[i * 2 + 1] = p.getZ(i) / tile; } g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g; }

// ------------------------------------------------------------------------------------------------------------------
// Round 13 (High / Ultra / Adaptive only, env >= 2): procedural surface detail in the road, marking and pavement shaders.
// All detail is computed from the road's own metre UVs (u across from the kerb, v along) and world position, and fades out
// with the pixel footprint (fwidth) so distant tarmac filters to a flat average instead of sparkling. Low/Medium: untouched.
// ------------------------------------------------------------------------------------------------------------------
const SURF_GLSL = `
float rh1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rh1(i), rh1(i + vec2(1.0, 0.0)), f.x), mix(rh1(i + vec2(0.0, 1.0)), rh1(i + vec2(1.0, 1.0)), f.x), f.y); }
`;
function worldPosVarying(sh) {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRW;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vRW; float rK = 1.0;' + SURF_GLSL);
}
// asphalt: ageing tone, road-aligned patch repairs with sealed edges, crack networks, skid marks, cast-iron manhole covers
export function roadDetail(mat, q) {
  if (!q || q.env < 2 || !mat) return mat;
  mat.customProgramCacheKey = () => 'roadHi'; mat.userData.roadHi = 1;
  mat.onBeforeCompile = sh => { worldPosVarying(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      { vec2 rm = vMapUv * 8.0; float fw = length(fwidth(rm)); float lod = 1.0 - smoothstep(0.06, 0.3, fw), lod2 = 1.0 - smoothstep(0.25, 1.4, fw);
        vec3 ac = diffuseColor.rgb;
        float mN = vn(vRW.xz * 0.035) * 0.6 + vn(vRW.xz * 0.13) * 0.4; ac *= mix(0.84, 1.12, mN); // older / newer surfacing
        ac = mix(ac, ac * vec3(1.05, 1.0, 0.93), smoothstep(0.4, 0.9, vn(vRW.xz * 0.018 + 7.0)) * 0.6); // bleached, dusty stretches
        // patch repairs: road-aligned rectangles (3.2 m x 9 m cells) with a black bitumen seal round the edge
        { vec2 cs = vec2(3.2, 9.0); vec2 c = floor(rm / cs); float h = rh1(c + 0.37);
          if (h < 0.15) { vec2 l = fract(rm / cs) * cs; vec2 a = vec2(0.2 + 0.9 * rh1(c + 1.3), 0.4 + 3.0 * rh1(c + 2.1)), b = cs - vec2(0.2 + 0.9 * rh1(c + 3.7), 0.4 + 3.0 * rh1(c + 4.9));
            float d = min(min(l.x - a.x, b.x - l.x), min(l.y - a.y, b.y - l.y)); float inn = smoothstep(-fw, fw, d);
            vec3 pc = h < 0.08 ? ac * vec3(0.66, 0.66, 0.68) : ac * vec3(1.12, 1.1, 1.06); ac = mix(ac, pc, inn); rK = mix(rK, h < 0.08 ? 0.85 : 1.05, inn);
            ac *= 1.0 - 0.6 * (1.0 - smoothstep(0.03, 0.07 + fw, abs(d))) * lod2; } }
        // cracks: long longitudinal cracks + crazed areas, only where the crack mask is on
        { float cm = smoothstep(0.55, 0.78, vn(vRW.xz * 0.06 + 3.1));
          float l1 = abs(vn(rm * vec2(1.1, 0.25)) - 0.5), l2 = abs(vn(vRW.xz * 1.6 + 9.0) - 0.5);
          float ck = max(1.0 - smoothstep(0.0, 0.012 + fwidth(l1), l1), (1.0 - smoothstep(0.0, 0.02 + fwidth(l2), l2)) * smoothstep(0.7, 0.85, vn(vRW.xz * 0.09 + 1.7)));
          ac *= 1.0 - 0.55 * ck * cm * lod; rK = mix(rK, 1.08, ck * cm * lod); }
        // skid / tyre marks: pairs of dark curving strips (1.55 m track) on some 45 m stretches
        { float tc = floor(rm.y / 45.0); float th = rh1(vec2(tc, 5.1));
          if (th < 0.3) { float t = fract(rm.y / 45.0); float a0 = rh1(vec2(tc, 6.3)) * 0.5, a1 = a0 + 0.12 + 0.3 * rh1(vec2(tc, 7.7));
            float cx = 1.3 + rh1(vec2(tc, 2.0)) * 3.5 + sin(rm.y * 0.12 + th * 40.0) * 0.35 * (t - a0);
            float along = smoothstep(a0, a0 + 0.03, t) * (1.0 - smoothstep(a1 - 0.08, a1, t));
            float k = max(1.0 - smoothstep(0.08, 0.13 + fw, abs(rm.x - cx)), 1.0 - smoothstep(0.08, 0.13 + fw, abs(rm.x - cx - 1.55)));
            ac *= 1.0 - 0.4 * k * along * (0.6 + 0.4 * vn(rm * vec2(3.0, 0.6))) * lod2; rK = mix(rK, 0.8, k * along * lod2); } }
        // manhole / utility covers: every ~56 m on average, round or square, cast iron with a tread pattern and a frame
        { float mc = floor(rm.y / 28.0); float mh = rh1(vec2(mc, 9.7));
          if (mh < 0.5) { vec2 ce = vec2(1.4 + rh1(vec2(mc, 3.3)) * 3.2, (mc + 0.3 + 0.4 * rh1(vec2(mc, 4.4))) * 28.0); vec2 p = rm - ce;
            bool sq = rh1(vec2(mc, 8.8)) < 0.45; float d = sq ? max(abs(p.x), abs(p.y)) : length(p); float r = sq ? 0.3 : 0.33;
            float cov = 1.0 - smoothstep(r - fw, r + fw, d), fr = (1.0 - smoothstep(r + 0.06 - fw, r + 0.06 + fw, d)) - cov;
            float tread = step(0.5, fract((p.x + p.y) * 12.0)) * step(0.5, fract((p.x - p.y) * 12.0));
            vec3 iron = vec3(0.17, 0.16, 0.15) * (0.85 + 0.3 * vn(p * 9.0)) * mix(1.0, 0.75 + 0.5 * tread, lod); iron = mix(iron, vec3(0.3, 0.19, 0.12), 0.3 * vn(p * 5.0 + mc));
            ac = mix(ac, iron, cov * lod2); ac = mix(ac, vec3(0.3, 0.3, 0.3), fr * 0.8 * lod2); rK = mix(rK, 0.5, cov * lod2); } }
        diffuseColor.rgb = ac; }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * rK, 0.04, 1.0);');
  };
  return mat;
}
// painted lines: worn paint (asphalt showing through in patches, polished tyre paths) on the bright markings only
export function markWear(mat, q) {
  if (!q || q.env < 2 || !mat) return mat;
  mat.customProgramCacheKey = () => 'markHi';
  mat.onBeforeCompile = sh => { worldPosVarying(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      { float fw = length(fwidth(vRW.xz)); float lod = 1.0 - smoothstep(0.08, 0.5, fw);
        float w = vn(vRW.xz * 0.7) * 0.55 + vn(vRW.xz * 3.1) * 0.3 + vn(vRW.xz * 11.0) * 0.15 * lod;
        float bright = smoothstep(0.35, 0.6, max(diffuseColor.r, diffuseColor.g));
        float worn = smoothstep(0.42, 0.78, w) * 0.7 * bright; diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.2, 0.21), worn);
        diffuseColor.rgb *= 1.0 - 0.12 * bright * vn(vRW.xz * 0.25); } // road dirt on older paint`);
  };
  return mat;
}
// pavement: per-slab tone (each 600 mm slab its own batch/age), stained and replaced slabs, grime in the macro
export function paveDetail(mat, q) {
  if (!q || q.env < 2 || !mat) return mat;
  mat.customProgramCacheKey = () => 'paveHi';
  mat.onBeforeCompile = sh => { worldPosVarying(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      { vec2 sl = floor(vMapUv * vec2(4.0, 3.0)); float hs = rh1(sl + 0.5); float fw = length(fwidth(vMapUv * vec2(4.0, 3.0))); float lod = 1.0 - smoothstep(0.08, 0.4, fw);
        vec3 pc = diffuseColor.rgb * mix(1.0, 0.9 + 0.2 * hs, lod);
        if (hs < 0.05) pc *= mix(vec3(1.0), vec3(0.78, 0.74, 0.68), lod); else if (hs > 0.96) pc *= mix(vec3(1.0), vec3(1.12, 1.1, 1.06), lod); // oil-stained / replaced slabs
        pc *= 0.86 + 0.2 * vn(vRW.xz * 0.12); pc = mix(pc, pc * vec3(0.8, 0.78, 0.72), smoothstep(0.6, 0.9, vn(vRW.xz * 0.5 + 4.0)) * 0.5); // dirt / damp patches
        diffuseColor.rgb = pc; }`);
  };
  return mat;
}
// kerb stones: 915 mm units with dark joints and per-stone tone (world-space; joints follow the dominant horizontal axis)
export function kerbDetail(mat, q) {
  if (!q || q.env < 2 || !mat) return mat;
  mat.customProgramCacheKey = () => 'kerbHi';
  mat.onBeforeCompile = sh => { worldPosVarying(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      { float s = (vRW.x + vRW.z) / 0.915; float fw = fwidth(s); float lod = 1.0 - smoothstep(0.1, 0.5, fw);
        float j = abs(fract(s) - 0.5) * 2.0; float jt = smoothstep(0.93 - fw, 0.97, j) * lod;
        diffuseColor.rgb *= (0.88 + 0.22 * rh1(vec2(floor(s), 1.0)) * lod) * (1.0 - 0.5 * jt);
        diffuseColor.rgb *= 0.85 + 0.2 * vn(vRW.xz * 0.2); }`);
  };
  return mat;
}
