// KITT's real dashboard brought to life (cockpit view): the model's own display textures are redrawn each frame —
// main cluster (LED rev arc + digital speed), right-hand bar-graph display, the voice modulator that pulses when he talks,
// the side button banks blinking, and the warning lamps lighting by state.
import * as THREE from 'three';
const NAMES = { main: 'texture_19', bars: 'texture_20', voice: 'texture_30', sideA: 'texture_21', sideB: 'texture_22', col: 'texture_23', btnA: 'texture_0', btnB: 'texture_1', minrpm: 'texture_26', fuel: 'texture_27', power: 'texture_28', ign: 'texture_29' };
// find the lit-able elements (buttons, LED segments) in a display texture: connected bright/coloured regions
function blobs(img, W, H) { const w = Math.min(160, img.width || 128), h = Math.max(1, Math.round(w * (img.height || 128) / (img.width || 128))), c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h); let d; try { d = g.getImageData(0, 0, w, h).data; } catch (e) { return []; }
  const on = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) { const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2]; on[i] = Math.max(r, gg, b) > 70 && Math.max(r, gg, b) - Math.min(r, gg, b) > 25 ? 1 : 0; }
  const out = [], seen = new Uint8Array(w * h), st = []; for (let i = 0; i < w * h; i++) { if (!on[i] || seen[i]) continue; let x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0; st.push(i); seen[i] = 1;
    while (st.length) { const j = st.pop(), x = j % w, y = (j / w) | 0; n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const k of [j - 1, j + 1, j - w, j + w]) if (k >= 0 && k < w * h && on[k] && !seen[k] && Math.abs((k % w) - x) <= 1) { seen[k] = 1; st.push(k); } }
    if (n >= 3) out.push({ x: (x0 - 0.5) / w * W, y: (y0 - 0.5) / h * H, w: (x1 - x0 + 2) / w * W, h: (y1 - y0 + 2) / h * H, cx: (x0 + x1) / 2 / w, cy: (y0 + y1) / 2 / h, ph: Math.random() * 6, hz: 0.6 + Math.random() * 2.4, fixed: Math.random() < 0.35 }); }
  return out; }
export class KittDash {
  constructor() { this.P = {}; this.t = 0; this.lv = [0, 0, 0]; this.clock = 0; }
  attach(obj) { if (this.done) return; this.done = true;
    obj.traverse(o => { if (!o.isMesh || !o.material?.map?.image) return; const key = Object.keys(NAMES).find(k => o.material.name === NAMES[k]); if (!key) return;
      let p = this.P[key]; if (!p) { const img = o.material.map.image, w = Math.min(512, img.width || 256), h = Math.round(w * (img.height || 256) / (img.width || 256));
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h; let tex = new THREE.CanvasTexture(cv); tex.flipY = o.material.map.flipY; tex.colorSpace = THREE.SRGBColorSpace;
        const rot = key === 'main' || key === 'bars'; let out = cv; if (rot) { out = document.createElement('canvas'); out.width = w; out.height = h; tex.image = out; } // the model maps these two upside down: draw upright, upload rotated 180°
        p = this.P[key] = { img, cv, out, rot, g: cv.getContext('2d'), w, h, tex, B: blobs(img, w, h), mat: new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: o.material.transparent, side: o.material.side }) }; }
      o.material = p.mat; }); }
  base(p, a) { const g = p.g; g.globalAlpha = 1; g.fillStyle = '#000'; g.fillRect(0, 0, p.w, p.h); g.globalAlpha = a; g.drawImage(p.img, 0, 0, p.w, p.h); g.globalAlpha = 1; }
  lit(p, x, y, w, h) { if (w > 0 && h > 0) p.g.drawImage(p.img, x / p.w * p.img.width, y / p.h * p.img.height, w / p.w * p.img.width, h / p.h * p.img.height, x, y, w, h); }
  up(p) { if (p.rot) { const o = p.out.getContext('2d'); o.setTransform(-1, 0, 0, -1, p.w, p.h); o.drawImage(p.cv, 0, 0); o.setTransform(1, 0, 0, 1, 0, 0); } p.tex.needsUpdate = true; }
  litB(p, b) { this.lit(p, Math.max(0, b.x), Math.max(0, b.y), b.w, b.h); }
  digits(p, txt, cx, cy, hgt, col) { const g = p.g; g.save(); g.translate(cx, cy);
    g.font = `bold ${Math.round(hgt)}px "Courier New", monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 8; g.fillText(txt, 0, 2); g.restore(); }
  draw(S, Pp, dt, talk, units, inp) { this.t += dt; if (this.t < 1 / 15) return; const T = this.t; this.t = 0; this.clock += T; const C = this.clock;
    const v = Math.abs(S.vx || 0), sp = Math.round(units === 'kmh' ? v * 3.6 : v * 2.237), f = Math.min(1, (S.rpm || 0) / ((Pp && Pp.redline) || 6500));
    let p = this.P.main; if (p) { this.base(p, 0.38); // LED segments light as a sweep with the revs (texture is rotated, so screen-left = image-right)
      for (const b of p.B) { const u = b.cx, row = 1 - b.cy; if (b.cy > 0.45 ? u < f : u < Math.min(1, v / 50) * (0.6 + 0.4 * row)) this.litB(p, b); }
      const bx = p.w * 0.37, by = p.h * 0.5, bw = p.w * 0.3, bh = p.h * 0.36; p.g.fillStyle = '#000'; p.g.fillRect(bx, by, bw, bh); this.digits(p, String(sp).padStart(3, '0'), bx + bw / 2, by + bh / 2, bh * 0.95, '#ff2a10'); this.up(p); }
    p = this.P.bars; if (p) { this.base(p, 0.38); const vals = [inp?.throttle || 0, inp?.brake || 0, Math.min(1, v / 60), f];
      for (const b of p.B) { if (b.cy > 0.8) continue; const col = Math.min(3, Math.floor(b.cx * 4)), k = vals[col]; if (b.cy < 0.5 ? b.cy > 1 - k * 2 || (1 - b.cy / 0.5) < k : (b.cx < f)) this.litB(p, b); }
      p.g.fillStyle = '#000'; p.g.fillRect(p.w * 0.3, p.h * 0.82, p.w * 0.4, p.h * 0.16); this.digits(p, String(Math.round(S.rpm || 0)).padStart(4, '0'), p.w / 2, p.h * 0.9, p.h * 0.14, '#ff3018'); this.up(p); }
    p = this.P.voice; if (p) { this.base(p, 0.12); for (let c = 0; c < 3; c++) { const tgt = talk ? (c === 1 ? 0.55 + Math.random() * 0.45 : 0.25 + Math.random() * 0.5) : 0; this.lv[c] += (tgt - this.lv[c]) * Math.min(1, T * 16); }
      for (const b of p.B) { const c = Math.min(2, Math.floor(b.cx * 3)); if (Math.abs(b.cy - 0.5) * 2 < this.lv[c]) this.litB(p, b); } p.tex.needsUpdate = true; }
    for (const k of ['sideA', 'sideB', 'col', 'btnA', 'btnB']) { p = this.P[k]; if (!p) continue; this.base(p, 0.22); // each real button/lamp lights on its own: some steady, others blinking at their own rate
      for (const b of p.B) if (b.fixed || Math.sin(C * b.hz + b.ph) > -0.1) this.litB(p, b); p.tex.needsUpdate = true; }
    for (const [k, on] of [['minrpm', (S.rpm || 0) < 1100], ['fuel', true], ['power', true], ['ign', v < 0.5]]) { p = this.P[k]; if (!p || p.on === on) continue; p.on = on; this.base(p, on ? 1 : 0.18); p.tex.needsUpdate = true; } }
}
// The two dash TVs: left = live rear-bumper camera, right = Knight Rider clips (YouTube embed laid over the screen).
const YT = 'https://www.youtube-nocookie.com/embed/oNyXYPhnUIs?autoplay=1&mute=1&controls=0&playsinline=1&loop=1&modestbranding=1&rel=0&playlist=oNyXYPhnUIs';
export class KittTVs {
  constructor(obj, car) { let n = null; obj.traverse(o => { if (!n && o.userData.cockpit) n = o; }); this.ok = !!n; if (!n) return; const e = n.userData.cockpit, L = car.dims[0];
    this.rt = new THREE.WebGLRenderTarget(256, 160); this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    const bez = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.5 }), W = 0.13, H = 0.095, xc = e.x * 0.2, y = e.y - 0.215, z = e.z - 0.55;
    // the single dash TV is the model's own screen (texture_25, right of the main cluster): we swap its material and pin the clip player to it
    let tv = null; obj.traverse(o => { if (!tv && o.isMesh && o.material?.map?.name === 'texture_25') tv = o; }); if (!tv) obj.traverse(o => { if (!tv && o.isMesh && /texture_25/.test(o.material?.name || '') ) tv = o; });
    this.ok = !!tv; if (!tv) return; const ps = tv.geometry.attributes.position, uv = tv.geometry.attributes.uv; this.cn = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => { let bi = 0, bd = 1e9; for (let k = 0; k < ps.count; k++) { const d = (uv.getX(k) - u) ** 2 + (uv.getY(k) - v) ** 2; if (d < bd) { bd = d; bi = k; } } return new THREE.Vector3().fromBufferAttribute(ps, bi); }); // TL, TR, BR, BL of the screen image
    this.camMat = new THREE.MeshBasicMaterial({ map: this.rt.texture, toneMapped: false }); /* upright and mirrored, like a real reversing camera */ this.offMat = new THREE.MeshBasicMaterial({ color: 0x050808 });
    const tl = new THREE.TextureLoader(); this.pics = ['real/kitt/me1.jpg', 'real/kitt/me2.jpg'].map(u => { const t = tl.load(u); t.colorSpace = THREE.SRGBColorSpace; return new THREE.MeshBasicMaterial({ map: t, toneMapped: false }); }); this.cyc = 0; // the owner's photos come up between plays of the theme
    this.scr = [tv, tv];
    this.cam = new THREE.PerspectiveCamera(70, 1.6, 0.1, 400); this.cam.position.set(0, 0.62, L / 2 - 0.02); this.cam.rotation.y = Math.PI; obj.add(this.cam); // car faces -Z, so the rear camera turns round to look along +Z
    this.t = 0; this.v = new THREE.Vector3(); }
  step(dt, gfx, inCockpit, rev) { if (!this.ok) return; this.cyc = (this.cyc + dt) % 50; const pic = !rev && (this.cyc > 20 && this.cyc < 25 ? this.pics[0] : this.cyc > 45 ? this.pics[1] : null); // 20 s theme, 5 s photo, repeat
    this.scr[0].material = rev ? this.camMat : pic || this.offMat; this.t += dt; const f = this.ifr; this.scr[1].updateWorldMatrix(true, false); gfx.cam.updateMatrixWorld();
    if (!inCockpit) { if (f) f.style.display = 'none'; return; }
    if (rev && this.t > 1 / 12) { this.t = 0; const r = gfx.r, cur = r.getRenderTarget(), sh = r.shadowMap.autoUpdate; r.shadowMap.autoUpdate = false; r.setRenderTarget(this.rt); r.render(gfx.scene, this.cam); r.setRenderTarget(cur); r.shadowMap.autoUpdate = sh; }
    if (!this.ifr) { const w = this.ifr = document.createElement('div'), i = document.createElement('iframe'); i.src = YT; i.allow = 'autoplay; encrypted-media'; i.setAttribute('frameborder', '0'); w.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:180px;overflow:hidden;transform-origin:0 0;pointer-events:none;z-index:1;background:#000;display:none';
      i.style.cssText = 'position:absolute;left:0;top:0;width:320px;height:180px;border:0;pointer-events:none'; w.appendChild(i); document.body.appendChild(w); } // full YouTube player, fitted to the TV's four corners
    // place the clip player over the right-hand TV's on-screen rectangle
    // map the clip player onto the TV's four corners with a CSS homography, so it sits exactly in the angled screen and moves with it
    const m = this.scr[1], cam = gfx.cam, R = gfx.r.domElement.getBoundingClientRect(), P = [];
    for (const c of this.cn) { this.v.copy(c); m.localToWorld(this.v); this.v.project(cam); if (this.v.z > 1 || this.v.z < -1) { P.length = 0; break; } P.push([R.left + (this.v.x + 1) / 2 * R.width, R.top + (1 - this.v.y) / 2 * R.height]); }
    const s = this.ifr.style; if (rev || pic || P.length < 4) { s.display = 'none'; return; }
    P.sort((a, b) => a[1] - b[1]); const T = P.slice(0, 2).sort((a, b) => a[0] - b[0]), Bt = P.slice(2).sort((a, b) => a[0] - b[0]); // the model's UVs are upside down, so order the corners as seen on screen
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = [T[0], T[1], Bt[1], Bt[0]], dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3, den = dx1 * dy2 - dx2 * dy1;
    const g = den ? (dx3 * dy2 - dx2 * dy3) / den : 0, h = den ? (dx1 * dy3 - dx3 * dy1) / den : 0, A = x1 - x0 + g * x1, B = x3 - x0 + h * x3, D = y1 - y0 + g * y1, E = y3 - y0 + h * y3, w = 320, hh = 180;
    s.display = ''; s.transform = `matrix3d(${A / w},${D / w},0,${g / w},${B / hh},${E / hh},0,${h / hh},0,0,1,0,${x0},${y0},0,1)`; }
  dispose() { this.ifr?.remove(); this.rt?.dispose(); }
}
