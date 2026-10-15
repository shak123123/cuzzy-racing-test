// p55 more places to walk into, added on top of venues.js (which stays as it is): the COSTCUTTER main hub on Ryland
// Street (OSM node 2642605222, 26 Ryland St, B16) with a 1920s Small Heath-style shop front, run by Saggy and Junior
// who hand out odd jobs (job board -> XP / levels that unlock more jobs); two snooker halls with a playable
// pot-the-ball table; and a corner shop. Doors use Venues.add, so they sit on the pavement facing the street like
// every other venue; interiors are built on entry below the city and disposed on leaving.
import * as THREE from 'three';
import { buildPerson, animPerson } from './person.js';
import { Venues, BASE_Y, ICON, SHOP } from './venues.js';
import { RylandSt } from './rylandst.js';
const PI = Math.PI;
export const PLACES = [ // [id, name, kind, lat, lon, colour]
  ['costcutter', 'COSTCUTTER', 'hub', 52.4754935, -1.9178658, '#1f4a33'],
  ['cueclub', 'CUZZY CUE CLUB', 'snooker', 52.4762, -1.9105, '#2fbf5a'],
  ['potblack', 'POT BLACK SNOOKER', 'snooker', 52.4790, -1.8975, '#2fbf5a'],
  ['minimart', 'LADYWOOD MINI MART', 'store', 52.4782, -1.9125, '#ff8a2a']];
Object.assign(ICON, { hub: '⭐', snooker: '🎱', store: '🏪' });
SHOP.store = [['energy', 'Energy drink', 5], ['crisps', 'Crisps', 3], ['sandwich', 'Sandwich', 8], ['mealdeal', 'Meal deal', 10]];
SHOP.snooker = [['cuppa', 'Cup of tea', 4], ['energy', 'Energy drink', 5]];
// ------------------------------------------------------------------ small build helpers
const STD = (c, r = 0.7, m = 0, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...o }), GLOW = c => new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
function cvTex(w, h, draw, rep) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); } return t; }
const box = (g, w, h, d, m, x, y, z, ry = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.rotation.y = ry; g.add(o); return o; };
const cyl = (g, r, h, m, x, y, z, n = 12) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, n), m); o.position.set(x, y, z); g.add(o); return o; };
const plane = (g, w, h, m, x, y, z, ry = 0, rx = 0) => { const o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); o.position.set(x, y, z); o.rotation.set(rx, ry, 0, 'YXZ'); g.add(o); return o; };
const lamp = (g, c, i, x, y, z, d = 12) => { const l = new THREE.PointLight(c, i, d, 1.6); l.position.set(x, y, z); g.add(l); return l; };
function shell(I, W, D, H, floorT, wallC, o = {}) { const g = I.g; plane(g, W, D, STD(0xffffff, 0.6, 0, { map: floorT }), 0, 0, 0, 0, -PI / 2); plane(g, W, D, STD(o.ceil ?? 0xe8e6e0, 0.9), 0, H, 0, 0, PI / 2);
  const wm = STD(wallC, 0.85); for (const [x, z, ry, l] of [[0, -D / 2, 0, W], [0, D / 2, PI, W], [-W / 2, 0, PI / 2, D], [W / 2, 0, -PI / 2, D]]) plane(g, l, H, wm, x, H / 2, z, ry);
  { const hl = new THREE.HemisphereLight(0xfff4e8, 0x403a34, o.hemi ?? 0.6); hl.position.set(0, H, 0); g.add(hl); } return { bounds: [W / 2 - 0.45, D / 2 - 0.45], entry: { x: 0, z: D / 2 - 1.2 } }; }
const tiles = (a = '#d9d6cf', b = '#c9c5bc', n = 8) => cvTex(256, 256, (c, w, h) => { const s = w / n; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { c.fillStyle = (i + j) % 2 ? a : b; c.fillRect(i * s, j * s, s, s); } c.strokeStyle = 'rgba(0,0,0,.18)'; for (let i = 0; i <= n; i++) { c.beginPath(); c.moveTo(i * s, 0); c.lineTo(i * s, h); c.moveTo(0, i * s); c.lineTo(w, i * s); c.stroke(); } }, [6, 6]);
function exitSpot(I, z) { const g = I.g; box(g, 1.6, 2.3, 0.06, STD(0x2a2d31, 0.5, 0.4), 0, 1.15, z - 0.03); const s = plane(g, 0.8, 0.25, GLOW(0x19e6c1), 0, 2.55, z - 0.07, PI); I.spots.push({ act: 'leave', x: 0, z: z - 1, r: 1.4, label: 'LEAVE' }); }
function npc(I, look, x, z, yaw) { const p = buildPerson(look); p.position.set(x, 0, z); p.rotation.y = yaw; I.g.add(p); I.npcs.push(p); return p; }
// product shelving: one gondola run, instanced packs in shop colours
function gondola(g, x, z, len, ry, seed = 1) { const G = new THREE.Group(); G.position.set(x, 0, z); G.rotation.y = ry; g.add(G); const metal = STD(0xd8dadc, 0.5, 0.3);
  box(G, len, 1.6, 0.06, metal, 0, 0.8, 0); for (const s of [-1, 1]) for (let k = 0; k < 4; k++) box(G, len, 0.03, 0.42, metal, 0, 0.18 + k * 0.42, s * 0.24);
  const cols = [0xd22a2a, 0x2a6ad2, 0xf2c21a, 0x2ab25a, 0xf07a1a, 0x8a2ad2, 0xffffff, 0x1a1a1a]; let r = seed * 9301; const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  const n = Math.floor(len / 0.16) * 8, geo = new THREE.BoxGeometry(0.12, 0.26, 0.2), im = new THREE.InstancedMesh(geo, STD(0xffffff, 0.55), n), m = new THREE.Matrix4(), c = new THREE.Color(); let i = 0;
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) for (let a = -len / 2 + 0.1; a < len / 2 - 0.06 && i < n; a += 0.16) { const hh = 0.6 + rnd() * 0.6; m.makeScale(1, hh, 1).setPosition(a, 0.2 + k * 0.42 + 0.13 * hh, s * 0.25); im.setMatrixAt(i, m); im.setColorAt(i, c.setHex(cols[(rnd() * cols.length) | 0])); i++; }
  im.count = i; im.instanceMatrix.needsUpdate = true; G.add(im); return G; }
function fridges(g, x, z, n, ry) { const G = new THREE.Group(); G.position.set(x, 0, z); G.rotation.y = ry; g.add(G); for (let i = 0; i < n; i++) { const X = (i - (n - 1) / 2) * 0.9; box(G, 0.86, 2.0, 0.7, STD(0x1a1c1e, 0.4, 0.4), X, 1.0, 0); box(G, 0.76, 1.8, 0.02, GLOW(0xdff0ff), X, 1.05, 0.33);
    for (let k = 0; k < 5; k++) for (let j = 0; j < 6; j++) cyl(G, 0.035, 0.22, STD([0xd22a2a, 0x1a8a2a, 0xf2c21a, 0x2a6ad2][(i + k + j) % 4], 0.3), X - 0.3 + j * 0.12, 0.35 + k * 0.34, 0.28, 8); box(G, 0.8, 1.84, 0.02, STD(0xcfe6f2, 0.05, 0.1, { transparent: true, opacity: 0.18 }), X, 1.05, 0.36); } return G; }
function counter(g, x, z, ry, noGantry) { const G = new THREE.Group(); G.position.set(x, 0, z); G.rotation.y = ry; g.add(G); box(G, 3.0, 1.0, 0.7, STD(0x3a3f45, 0.5, 0.2), 0, 0.5, 0); box(G, 3.1, 0.04, 0.8, STD(0x101010, 0.3, 0.3), 0, 1.02, 0);
  box(G, 0.4, 0.28, 0.3, STD(0x202224, 0.4, 0.4), -0.8, 1.18, 0); box(G, 0.3, 0.2, 0.02, GLOW(0x6ad0ff), -0.8, 1.36, -0.1); box(G, 0.5, 0.06, 0.4, STD(0x2a2a2a, 0.5), 0.6, 1.07, 0); // till, screen, card reader
  // back gantry (covered tobacco unit + lottery-style screen)
  if (!noGantry) box(G, 3.0, 2.2, 0.4, STD(0x2b2e33, 0.5, 0.3), 0, 1.1, -1.25); if (!noGantry) plane(G, 2.8, 1.2, STD(0x6b7078, 0.4, 0.5), 0, 1.5, -1.04); return G; }
// ------------------------------------------------------------------ dialogue (text bubble + en-GB TTS when available)
const BRUM = { saggy: { name: 'Saggy', pitch: 1.0, rate: 1.0 }, junior: { name: 'Junior', pitch: 0.75, rate: 0.92 } };
export function say(who, text) { const b = document.getElementById('cz-say') || Object.assign(document.createElement('div'), { id: 'cz-say' }); b.style.cssText = 'position:fixed;left:50%;bottom:calc(200px + env(safe-area-inset-bottom));transform:translateX(-50%);max-width:min(560px,90vw);background:rgba(10,12,16,.9);color:#fff;font:600 16px system-ui;border:1px solid rgba(255,255,255,.2);border-radius:14px;padding:12px 16px;z-index:9;pointer-events:none';
  b.innerHTML = `<b style="color:#d9b45a">${BRUM[who]?.name || who}:</b> ${text}`; document.body.appendChild(b); clearTimeout(say.t); say.t = setTimeout(() => b.remove(), 4200 + text.length * 40);
  try { const S = window.speechSynthesis; if (!S || window.CZ_NO_TTS) return; S.cancel(); const u = new SpeechSynthesisUtterance(text.replace(/<[^>]+>/g, '')), V = S.getVoices(); u.voice = V.find(v => /en-GB/i.test(v.lang) && (who === 'junior' ? /male|george|daniel|arthur|ryan/i.test(v.name) : /male|daniel|oliver|thomas/i.test(v.name))) || V.find(v => /en-GB/i.test(v.lang)) || null; u.lang = 'en-GB'; u.pitch = BRUM[who]?.pitch ?? 1; u.rate = BRUM[who]?.rate ?? 1; S.speak(u); } catch (e) { } }
const LINES = { saggy: ['Alright boss! Ow am ya? Shop\'s bostin\' today.', 'Yow want a job doin\'? Have a gander at the board, bab.', 'Junior\'s been on the energy drinks again, I swear down.', 'Tara-a-bit boss, mind ow yer goo.'],
  junior: ['Alright boss. Yam lookin\' sharp today.', 'If yow need muscle, I\'m here. Proper.', 'Saggy keeps nickin\' me cobs from the back, ay he.', 'Keep it lively out there, bab.'] };
// ------------------------------------------------------------------ jobs / XP (stored on this device)
const JK = 'cuzzy.jobs'; export const LEVEL = xp => Math.floor(Math.sqrt(xp / 60)) + 1;
const JOBS = [ // [id, giver, title, min level, xp, stages: venue ids / 'hub'; line when given]
  ['milk', 'saggy', 'Milk run to Balti House', 1, 40, ['balti', 'costcutter'], 'Balti House are out of milk again, bab. Tek em a crate an\' come back.'],
  ['flyers', 'junior', 'Drop flyers at the Cue Club', 1, 40, ['cueclub', 'costcutter'], 'Drop these flyers at the Cue Club for us, boss. Ta.'],
  ['cinema', 'saggy', 'Collect the takings from the cinema', 2, 70, ['cinema', 'costcutter'], 'Cinema owes us for the pop. Goo an\' collect, yeah?'],
  ['gym', 'junior', 'Pick up protein from Cuzzy Gym', 2, 70, ['gym', 'costcutter'], 'Need me protein from the gym, boss. Proper heavy box, mind.'],
  ['library', 'saggy', 'Return Saggy\'s overdue books', 3, 110, ['library', 'costcutter'], 'Them library books am overdue by a month. Don\'t tell me mom.'],
  ['bullring', 'junior', 'Meet a supplier at the Bullring', 3, 120, ['bullring', 'potblack', 'costcutter'], 'Supplier\'s at the Bullring, then Pot Black. Then back ere, quick as yow like.'],
  ['mailbox', 'saggy', 'VIP delivery to The Mailbox', 4, 160, ['mailbox', 'club', 'costcutter'], 'Big order for The Mailbox, then the Flamingo. Don\'t drop nuthin\', boss.']];
export class Jobs {
  constructor(foot) { this.f = foot; try { this.d = JSON.parse(localStorage.getItem(JK) || '{}'); } catch (e) { this.d = {}; } this.d.xp ||= 0; this.d.done ||= {}; this.cur = null;
    this.hud = Object.assign(document.createElement('div'), { id: 'cz-job' }); this.hud.style.cssText = 'position:absolute;left:calc(14px + env(safe-area-inset-left));top:calc(56px + env(safe-area-inset-top));color:#fff;font:700 13px system-ui;text-shadow:0 1px 3px #000;background:rgba(0,0,0,.35);padding:6px 10px;border-radius:10px;pointer-events:none;max-width:260px'; foot.U.appendChild(this.hud); this.paint(); }
  get level() { return LEVEL(this.d.xp); }
  save() { try { localStorage.setItem(JK, JSON.stringify(this.d)); } catch (e) { } }
  addXP(n, why) { const l0 = this.level; this.d.xp += n; this.save(); const l = this.level; this.f.s.hud?.flash?.(`+${n} XP${why ? ' · ' + why : ''}${l > l0 ? `  ·  LEVEL ${l}! New jobs at Costcutter` : ''}`, 2.2); this.paint(); }
  paint() { const l = this.level, nx = Math.pow(l, 2) * 60; this.hud.innerHTML = `<span style="color:#d9b45a">LVL ${l}</span> · ${this.d.xp}/${nx} XP${this.cur ? `<br>JOB: ${this.cur.j[2]}<br><small>Go to: ${this.cur.name}</small>` : ''}`; }
  list() { return JOBS.map(j => ({ j, locked: j[3] > this.level, done: !!this.d.done[j[0]] })); }
  start(j) { if (this.cur) return; this.cur = { j, i: 0 }; say(j[1], j[6]); this.target(); }
  target() { const v = this.f.venues.list.find(q => q.id === this.cur.j[5][this.cur.i]); if (!v) { this.cur = null; return; } this.cur.v = v; this.cur.name = v.name; this.f.setWp(v); this.paint(); }
  step() { const c = this.cur; if (!c?.v) return; const q = this.f.q; if (Math.hypot(q.x - c.v.x, q.z - c.v.z) < 7 || this.f.venues.inside?.v === c.v) { c.i++; if (c.i >= c.j[5].length) { this.d.done[c.j[0]] = (this.d.done[c.j[0]] || 0) + 1; this.cur = null; this.f.setWp(null); this.addXP(c.j[4], 'Job done'); } else { this.f.s.hud?.flash?.('Sorted. Next: ' + (this.f.venues.list.find(q => q.id === c.j[5][c.i])?.name || ''), 1.6); this.target(); } } }
  board(foot) { const rows = this.list().map(({ j, locked, done }) => foot.row(`${locked ? '🔒 ' : done ? '✔ ' : ''}<b>${j[2]}</b><br><small style="opacity:.7">${BRUM[j[1]].name} · ${j[4]} XP${locked ? ' · needs level ' + j[3] : ''}</small>`, this.cur?.j === j ? 'ON IT' : locked ? 'LOCKED' : 'TAKE', b => { if (locked || this.cur) return; foot.closeMenu(); this.start(j); }));
    const h = document.createElement('div'); h.innerHTML = `<small style="opacity:.8">Level ${this.level} · ${this.d.xp} XP · jobs unlock as you level up.${this.cur ? ' Finish your current job first.' : ''}</small>`; foot.menu('ODD JOBS — Costcutter board', [h, ...rows]); }
}
// ------------------------------------------------------------------ side characters
export const SAGGY = { skin: 0x9a6a4a, hair: 0x120e0b, top: 0x2b3a55, legs: 0x2a2a2e, shoe: 0x1a1a1a, jacket: null };
export const JUNIOR = { skin: 0x4a2e1e, hair: 0x0d0b09, top: 0x1c1c1e, legs: 0x23324a, shoe: 0xf0f0f0, jacket: 0x3d5a3a };
export function dress(p, who) { const P = p.userData.person, H = P.head, dk = STD(0x0e0c0a, 0.9);
  if (who === 'saggy') { const b = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8, 0, PI * 2, PI * 0.55, PI * 0.45), dk); b.scale.set(0.9, 1.1, 1); b.position.set(0, -0.005, -0.008); H.add(b); } // neat short beard
  else { const cap = new THREE.Mesh(new THREE.SphereGeometry(0.122, 14, 8, 0, PI * 2, 0, PI / 2), STD(0x111214, 0.7)); cap.position.y = 0.035; H.add(cap); const br = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.012, 14, 1, false, -PI / 2 - 0.9, 1.8), cap.material); br.position.set(0, 0.04, -0.07); br.scale.set(1, 1, 1.25); H.add(br); p.scale.set(1.16, 1.05, 1.12); } // cap with peak, big build
  p.userData.who = who; return p; }
// ------------------------------------------------------------------ exteriors: Costcutter, 26 Ryland St (matched to the user's photos)
// ground floor of a modern block of flats: royal-blue render above the shop with white render to the right, grey metal
// balconies, CCTV cameras and lamps on the blue wall, white fascia 'Costcutter ....your local Supermarket', glazed shop
// front with window vinyl of black flat-cap silhouettes over a white / red / green wave band, an ATM in the window,
// a '26' plaque on the white wall, block paving and a steel bollard. Door group local frame: -Z = into the building.
function silhouettes(c, x0, y0, w, h) { c.fillStyle = '#0a0a0a'; const n = 7; for (let i = 0; i < n; i++) { const x = x0 + (i + 0.5) * w / n + (i % 2 ? 6 : -6), s = h * (0.92 + (i % 3) * 0.04), y = y0 + h;
    c.beginPath(); c.moveTo(x - s * 0.13, y); c.lineTo(x - s * 0.16, y - s * 0.62); c.lineTo(x - s * 0.1, y - s * 0.78); c.lineTo(x + s * 0.1, y - s * 0.78); c.lineTo(x + s * 0.16, y - s * 0.62); c.lineTo(x + s * 0.13, y); c.closePath(); c.fill(); // long coat
    c.beginPath(); c.arc(x, y - s * 0.84, s * 0.065, 0, 7); c.fill(); c.beginPath(); c.ellipse(x, y - s * 0.885, s * 0.11, s * 0.025, 0, 0, 7); c.fill(); c.beginPath(); c.ellipse(x + s * 0.01, y - s * 0.9, s * 0.07, s * 0.04, 0, PI, PI * 2); c.fill(); // head + flat cap
    if (i === 4) { c.fillRect(x + s * 0.14, y - s * 0.6, s * 0.16, s * 0.035); c.fillRect(x + s * 0.27, y - s * 0.6, s * 0.03, s * 0.09); } } } // one holding a pistol
function wave(c, x0, y0, w, h) { const band = (col, o, t) => { c.fillStyle = col; c.beginPath(); c.moveTo(x0, y0 + h); for (let x = 0; x <= w; x += 8) c.lineTo(x0 + x, y0 + o + Math.sin(x / w * PI * 2.2) * t); c.lineTo(x0 + w, y0 + h); c.closePath(); c.fill(); };
  band('#2a8a3a', h * 0.25, h * 0.2); band('#d42a2a', h * 0.45, h * 0.22); band('#ffffff', h * 0.62, h * 0.2); }
function rylandFront(v) { const G = v.g; if (!G) return; const blue = STD(0x1f47b8, 0.85), white = STD(0xeeeeea, 0.85), grey = STD(0x7c8288, 0.45, 0.6), dark = STD(0x2a2d31, 0.5, 0.4);
  const Z = -0.5; // facade plane, a touch behind the door marker
  box(G, 9, 7.2, 0.3, blue, -1.2, 3.6 + 3.4, Z - 0.15); box(G, 5, 10.6, 0.3, white, 6.0, 5.3, Z - 0.15); box(G, 9.6, 0.25, 0.4, white, -1.2, 3.35, Z - 0.1); // blue upper floors, white block to the right, slab edge
  for (const [x, y] of [[-4, 5.2], [1.5, 5.2], [-4, 8.2], [1.5, 8.2]]) { box(G, 2.6, 1.4, 0.02, STD(0x223040, 0.1, 0.5), x, y, Z + 0.02); box(G, 2.7, 0.08, 0.1, white, x, y - 0.74, Z + 0.05); } // windows
  for (const y of [4.3, 7.3]) { box(G, 3.2, 0.12, 1.3, grey, -6.2, y, Z + 0.6); for (let k = 0; k <= 10; k++) box(G, 0.03, 1.0, 0.03, grey, -7.8 + k * 0.32, y + 0.55, Z + 1.24); box(G, 3.2, 0.05, 0.05, grey, -6.2, y + 1.05, Z + 1.24); } // grey metal balconies
  for (const x of [-3.2, 2.2]) { box(G, 0.12, 0.12, 0.25, white, x, 3.95, Z + 0.15); const cam = box(G, 0.12, 0.12, 0.3, white, x, 3.88, Z + 0.35); cam.rotation.x = 0.35; } // CCTV
  for (const x of [-0.6]) { box(G, 0.25, 0.35, 0.15, dark, x, 4.2, Z + 0.08); box(G, 0.2, 0.05, 0.12, GLOW(0xffe6b0), x, 4.0, Z + 0.12); } // wall lamp
  const fasT = cvTex(1024, 128, (c, w, h) => { c.fillStyle = '#fafafa'; c.fillRect(0, 0, w, h); c.fillStyle = '#123a8a'; c.font = 'bold 74px Georgia,"Times New Roman",serif'; c.textBaseline = 'middle'; c.fillText('Costcutter', 40, h / 2 + 2); c.fillStyle = '#c4161c'; c.font = 'italic 34px Georgia,serif'; c.fillText('....your local Supermarket', 470, h / 2 + 16); });
  plane(G, 7.6, 0.95, STD(0xffffff, 0.4, 0, { map: fasT, emissive: 0xffffff, emissiveMap: fasT, emissiveIntensity: 0.35 }), -1.0, 2.85, Z + 0.32); box(G, 7.8, 1.05, 0.25, white, -1.0, 2.85, Z + 0.18);
  const vin = cvTex(1024, 300, (c, w, h) => { c.clearRect(0, 0, w, h); silhouettes(c, 30, 20, w * 0.42, h * 0.62); silhouettes(c, w * 0.55, 20, w * 0.42, h * 0.62); wave(c, 0, h * 0.62, w, h * 0.38); });
  plane(G, 7.4, 2.25, STD(0xc6d8e2, 0.05, 0.3, { transparent: true, opacity: 0.35 }), -1.0, 1.2, Z + 0.3); plane(G, 7.4, 2.17, new THREE.MeshStandardMaterial({ map: vin, transparent: true, roughness: 0.5 }), -1.0, 1.15, Z + 0.32); plane(G, 7.2, 2.1, GLOW(0x8a8678), -1.0, 1.2, Z - 0.6); // glass, vinyl, lit interior
  for (const x of [-4.75, -1.0, 2.75]) box(G, 0.1, 2.35, 0.12, dark, x, 1.18, Z + 0.3);
  const atm = new THREE.Group(); atm.position.set(1.9, 0, Z + 0.25); G.add(atm); box(atm, 0.75, 1.7, 0.4, STD(0x3a3e44, 0.4, 0.5), 0, 0.85, -0.2); box(atm, 0.45, 0.32, 0.02, GLOW(0x5ab0ff), 0, 1.32, 0.01); box(atm, 0.4, 0.15, 0.06, STD(0x9ea4aa, 0.3, 0.8), 0, 1.0, 0.03); // ATM in the window
  const pl = cvTex(128, 96, (c, w, h) => { c.fillStyle = '#d8dadc'; c.fillRect(0, 0, w, h); c.fillStyle = '#333'; c.font = 'bold 56px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('26', w / 2, h / 2 + 2); });
  plane(G, 0.45, 0.34, STD(0xffffff, 0.3, 0.6, { map: pl }), 4.3, 2.1, Z + 0.02); // '26' plaque on the white wall
  const pave = cvTex(256, 256, (c, w, h) => { c.fillStyle = '#9a8f88'; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? -16 : 0; x < w; x += 32) { c.fillStyle = `rgb(${150 + Math.random() * 30 | 0},${140 + Math.random() * 25 | 0},${132 + Math.random() * 25 | 0})`; c.fillRect(x + 1, y + 1, 30, 14); } }, [6, 2]);
  plane(G, 12, 3.4, STD(0xffffff, 0.9, 0, { map: pave, polygonOffset: true, polygonOffsetFactor: -2 }), 0.5, 0.03, Z + 1.9, 0, -PI / 2); // block paving
  cyl(G, 0.07, 0.95, STD(0xb8bcc0, 0.25, 0.9), 3.4, 0.48, Z + 2.6, 12); cyl(G, 0.075, 0.04, STD(0xb8bcc0, 0.25, 0.9), 3.4, 0.97, Z + 2.6, 12); } // steel bollard
// ------------------------------------------------------------------ interiors
function storeRoom(I, v, V, hub) { const W = hub ? 12 : 9, D = hub ? 14 : 10, H = 3.1, g = I.g; const info = shell(I, W, D, H, tiles(), hub ? 0x1d2e24 : 0xe9e6df, { hemi: 0.7 });
  if (hub) { box(g, W, 1.1, 0.02, STD(0x0f1a14, 0.5), 0, 0.55, -D / 2 + 0.01); box(g, W, 0.05, 0.04, STD(0xc8a24a, 0.3, 0.9), 0, 1.12, -D / 2 + 0.02); } // green dado + gold rail
  for (let i = 0; i < (hub ? 3 : 2); i++) gondola(g, -W / 2 + 3.2 + i * 2.4, 0.2, hub ? 6 : 4.6, PI / 2, i + 1);
  fridges(g, W / 2 - 0.4, -0.5, hub ? 6 : 4, -PI / 2); counter(g, -W / 2 + 2.4, -D / 2 + 2.0, 0, hub);
  for (let x = -W / 2 + 1.5; x < W / 2; x += 3) for (let z = -D / 2 + 2; z < D / 2; z += 3.5) box(g, 1.2, 0.04, 0.3, GLOW(0xf4f8ff), x, H - 0.03, z);
  lamp(g, 0xfff2e0, 9, 0, H - 0.3, -2, 16); lamp(g, 0xfff2e0, 7, 0, H - 0.3, 3.5, 14);
  const sk = { x: -W / 2 + 2.4, z: -D / 2 + 1.1 }; I.spots.push({ act: 'shop', shop: 'store', x: -W / 2 + 2.4, z: -D / 2 + 3.1, r: 1.6, label: 'BUY' });
  if (hub) { // back-lit sky-and-clouds ceiling panels, spirits shelves either side of the till, painted roller shutter
    const sky = cvTex(512, 512, (c, w, h) => { const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#3a9ae8'); gr.addColorStop(1, '#8ccaf4'); c.fillStyle = gr; c.fillRect(0, 0, w, h); for (let i = 0; i < 26; i++) { const x = Math.random() * w, y = Math.random() * h; for (let k = 0; k < 7; k++) { c.fillStyle = 'rgba(255,255,255,.55)'; c.beginPath(); c.ellipse(x + k * 14 - 40, y + Math.sin(k) * 8, 30 + Math.random() * 20, 12 + Math.random() * 8, 0, 0, 7); c.fill(); } } });
    for (let x = -W / 2 + 2; x < W / 2 - 1; x += 2.6) for (let z = -D / 2 + 1.8; z < D / 2 - 1; z += 2.6) { plane(g, 2.4, 2.4, new THREE.MeshBasicMaterial({ map: sky, toneMapped: false }), x, H - 0.02, z, 0, PI / 2); box(g, 2.6, 0.04, 0.08, STD(0x2a2d31, 0.5, 0.4), x, H - 0.03, z + 1.25); box(g, 0.08, 0.04, 2.6, STD(0x2a2d31, 0.5, 0.4), x + 1.25, H - 0.03, z); }
    const bx0 = -W / 2 + 2.4, bz = -D / 2 + 0.75;
    for (const s2 of [-1, 1]) { const sx = bx0 + s2 * 1.75; for (let k = 0; k < 5; k++) { box(g, 1.2, 0.03, 0.3, STD(0xdedede, 0.4, 0.3), sx, 0.9 + k * 0.38, bz); for (let j = 0; j < 8; j++) { const col = [0x6a3a10, 0x2a6a2a, 0xd8d0b0, 0x8a1a1a, 0x1a3a8a, 0xc8a040][(j + k * 3) % 6]; const b = cyl(g, 0.035, 0.26, STD(col, 0.1, 0.1, { transparent: true, opacity: 0.85 }), sx - 0.52 + j * 0.15, 0.9 + k * 0.38 + 0.15, bz, 8); cyl(g, 0.012, 0.06, STD(0x111111, 0.4), b.position.x, b.position.y + 0.16, bz, 6); } } }
    const sh = cvTex(512, 640, (c, w, h) => { c.fillStyle = '#f2f2f0'; c.fillRect(0, 0, w, h); c.fillStyle = '#111'; // skyline crown (incl. a Rotunda-ish drum and BT-tower mast)
      c.beginPath(); c.moveTo(70, 300); const sk = [[70, 210], [90, 210], [90, 150], [115, 150], [115, 230], [140, 230], [140, 120], [150, 60], [160, 120], [175, 120], [175, 190], [205, 190], [205, 90], [240, 90], [240, 170], [265, 170], [265, 40], [272, 10], [279, 40], [279, 160], [310, 160], [310, 110], [345, 110], [345, 200], [370, 200], [370, 140], [400, 140], [400, 230], [440, 230], [440, 300]]; for (const [x, y] of sk) c.lineTo(x, y); c.closePath(); c.fill();
      c.beginPath(); c.ellipse(256, 305, 230, 26, 0, 0, 7); c.fill(); // cap peak
      c.beginPath(); c.moveTo(120, 330); c.quadraticCurveTo(256, 300, 392, 330); c.lineTo(370, 470); c.quadraticCurveTo(256, 560, 142, 470); c.closePath(); c.fill(); // face in shadow
      c.fillStyle = '#f2f2f0'; c.beginPath(); c.moveTo(190, 420); c.quadraticCurveTo(256, 400, 330, 425); c.quadraticCurveTo(256, 470, 190, 420); c.fill(); c.beginPath(); c.moveTo(210, 470); c.quadraticCurveTo(256, 455, 305, 470); c.quadraticCurveTo(256, 500, 210, 470); c.fill(); // hand / cigarette highlights
      c.fillStyle = '#111'; c.font = 'bold 54px Impact,Arial Black,sans-serif'; c.textAlign = 'center'; c.fillText('PROUD TO BE LOCAL', w / 2, 610, w - 20); c.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 0; y < h; y += 14) c.fillRect(0, y, w, 2); }); // shutter slats
    plane(g, 2.2, 2.75, STD(0xffffff, 0.6, 0.1, { map: sh }), bx0, 1.45, bz + 0.05);
    const sg = dress(npc(I, SAGGY, sk.x - 0.7, sk.z, PI), 'saggy'), jr = dress(npc(I, JUNIOR, W / 2 - 2.2, 3.0, -PI / 2), 'junior'); I.cast = { saggy: sg, junior: jr };
    const t = (who, p) => ({ act: 'talk', x: p.position.x + (who === 'saggy' ? 0.8 : -1.1), z: p.position.z + (who === 'saggy' ? 2.1 : 0), r: 1.4, label: 'TALK', fn: foot => { const L = LINES[who]; say(who, L[(foot._lineI = (foot._lineI || 0) + 1) % L.length]); } });
    I.spots.push(t('saggy', sg), t('junior', jr));
    // job board (cork board with pinned notes) on the left wall
    const bt = cvTex(512, 340, (c, w, h) => { c.fillStyle = '#7a5a34'; c.fillRect(0, 0, w, h); c.strokeStyle = '#3a2a14'; c.lineWidth = 16; c.strokeRect(0, 0, w, h); c.fillStyle = '#d8b25a'; c.font = 'bold 34px Georgia,serif'; c.textAlign = 'center'; c.fillText('ODD JOBS', w / 2, 50);
      for (let i = 0; i < 6; i++) { c.save(); c.translate(70 + (i % 3) * 150, 110 + Math.floor(i / 3) * 120); c.rotate((i % 2 ? 1 : -1) * 0.05); c.fillStyle = ['#f4f0d8', '#ffe9a8', '#d8f0e8'][i % 3]; c.fillRect(0, 0, 120, 90); c.fillStyle = '#333'; c.font = '16px system-ui'; c.textAlign = 'left'; c.fillText(JOBS[i]?.[2].slice(0, 14) || '', 8, 30); c.fillStyle = '#c22'; c.beginPath(); c.arc(60, 6, 6, 0, 7); c.fill(); c.restore(); } });
    plane(g, 1.9, 1.26, STD(0xffffff, 0.8, 0, { map: bt }), -W / 2 + 0.03, 1.7, 2.2, PI / 2); I.spots.push({ act: 'jobs', x: -W / 2 + 1.0, z: 2.2, r: 1.4, label: 'JOBS', fn: foot => V.jobs?.board(foot) });
    // a framed 1920s poster and the shop's own neon
    const pt = cvTex(256, 360, (c, w, h) => { c.fillStyle = '#1b1712'; c.fillRect(0, 0, w, h); c.fillStyle = '#c8a24a'; c.textAlign = 'center'; c.font = 'bold 30px Georgia,serif'; c.fillText('SMALL HEATH', w / 2, 60); c.font = 'italic 22px Georgia,serif'; c.fillText('Est. 1919', w / 2, 96); c.beginPath(); c.ellipse(w / 2, 200, 80, 20, 0, 0, 7); c.fill(); c.beginPath(); c.ellipse(w / 2 + 6, 180, 54, 34, 0, PI, PI * 2); c.fill(); c.font = '18px Georgia,serif'; c.fillText('By order of the boss', w / 2, 300); });
    plane(g, 0.8, 1.12, STD(0xffffff, 0.6, 0, { map: pt }), 1.5, 1.8, -D / 2 + 0.03); }
  else npc(I, 4, sk.x, sk.z, PI);
  exitSpot(I, D / 2); I.step = dt => { for (const p of I.npcs) animPerson(p, dt, 0); }; info.envI = 0.5; info.msg = hub ? 'Costcutter — Saggy and Junior are in. Check the job board.' : 'Welcome in'; return info; }
function snookerRoom(I, v, V) { const W = 16, D = 14, H = 3.3, g = I.g; const carpet = cvTex(128, 128, (c, w, h) => { c.fillStyle = '#3a1418'; c.fillRect(0, 0, w, h); for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(${120 + Math.random() * 60},40,40,.25)`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }, [8, 8]);
  const info = shell(I, W, D, H, carpet, 0x2a221c, { ceil: 0x15120f, hemi: 0.25 }); const baize = STD(0x0f6a2e, 0.95), wood = STD(0x4a2a14, 0.45, 0.05), leg = STD(0x2a1608, 0.5);
  const tables = [[-4, -1.5], [0, -1.5], [4, -1.5], [-2, 3.2], [2, 3.2]].slice(0, 5);
  for (const [x, z] of tables) { box(g, 1.9, 0.08, 3.7, baize, x, 0.86, z); for (const [sx, sz] of [[-1, 0], [1, 0]]) box(g, 0.14, 0.12, 3.9, wood, x + sx * 1.02, 0.9, z); for (const sz of [-1, 1]) box(g, 2.18, 0.12, 0.14, wood, x, 0.9, z + sz * 1.92); box(g, 1.8, 0.62, 3.5, wood, x, 0.5, z);
    for (const [lx, lz] of [[-0.8, -1.6], [0.8, -1.6], [-0.8, 1.6], [0.8, 1.6], [-0.8, 0], [0.8, 0]]) cyl(g, 0.09, 0.3, leg, x + lx, 0.15, z + lz, 8);
    for (const [px, pz] of [[-0.93, -1.83], [0.93, -1.83], [-0.97, 0], [0.97, 0], [-0.93, 1.83], [0.93, 1.83]]) cyl(g, 0.06, 0.02, STD(0x050505, 0.9), x + px, 0.905, z + pz, 10);
    for (let i = 0; i < 15; i++) { const r = Math.floor((Math.sqrt(8 * i + 1) - 1) / 2), k = i - r * (r + 1) / 2; const b = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), STD(0xb01010, 0.15, 0.1)); b.position.set(x + (k - r / 2) * 0.054, 0.926, z - 0.9 - r * 0.047); g.add(b); }
    for (const [c, bx, bz] of [[0xffffff, 0, 1.2], [0x111111, 0, -1.5], [0xf2d21a, -0.29, 0.95], [0x1a8a2a, 0.29, 0.95], [0x8a5a2a, 0, 0.95], [0x2a4ad2, 0, 0], [0xff70a0, 0, -0.85]]) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), STD(c, 0.15, 0.1)); b.position.set(x + bx, 0.926, z + bz); g.add(b); }
    const shade = box(g, 1.3, 0.22, 2.6, STD(0x0f2a18, 0.5, 0.2), x, 2.3, z); box(g, 1.2, 0.02, 2.5, GLOW(0xfff1d0), x, 2.18, z); for (const s of [-1, 1]) cyl(g, 0.008, 1.0, STD(0x111111), x, 2.85, z + s * 1.0, 4); lamp(g, 0xfff0d0, 4, x, 2.0, z, 4.5); }
  for (let i = 0; i < 10; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.014, 1.45, 6), STD(0xc8a070, 0.5)); c.position.set(-W / 2 + 0.1, 1.2, -4 + i * 0.12); c.rotation.z = 0.08; g.add(c); } box(g, 0.08, 1.6, 1.4, wood, -W / 2 + 0.05, 1.2, -3.45); // cue rack
  const sb = cvTex(256, 128, (c, w, h) => { c.fillStyle = '#111'; c.fillRect(0, 0, w, h); c.fillStyle = '#d8b25a'; c.font = 'bold 30px Georgia'; c.textAlign = 'center'; c.fillText(v.name, w / 2, 44, w - 10); c.fillStyle = '#fff'; c.font = '22px monospace'; c.fillText('BREAK  047   FRAME 3', w / 2, 92); });
  plane(g, 2.4, 1.2, new THREE.MeshBasicMaterial({ map: sb, toneMapped: false }), 0, 2.2, -D / 2 + 0.03);
  box(g, 3.2, 1.05, 0.7, wood, W / 2 - 2.4, 0.52, D / 2 - 3); box(g, 3.3, 0.05, 0.8, STD(0x151515, 0.3, 0.3), W / 2 - 2.4, 1.07, D / 2 - 3); npc(I, 1, W / 2 - 2.4, D / 2 - 3.8, 0);
  npc(I, 0, -4 + 1.4, -1.5, -PI / 2); npc(I, 5, 4 - 1.4, -1.5, PI / 2); npc(I, 3, -2 + 1.3, 3.2 + 1.0, -PI / 3);
  I.spots.push({ act: 'shop', shop: 'snooker', x: W / 2 - 2.4, z: D / 2 - 2.0, r: 1.5, label: 'BAR' }, { act: 'pool', x: 0, z: 0.9, r: 1.6, label: 'PLAY', fn: foot => potGame(foot, V) });
  exitSpot(I, D / 2); I.step = dt => { for (const p of I.npcs) animPerson(p, dt, 0); }; info.envI = 0.35; info.msg = v.name + ' — walk up to the middle table to play'; return info; }
// ------------------------------------------------------------------ pot-the-ball minigame (top-down, drag back from the cue ball and let go)
export function potGame(foot, V) { if (document.getElementById('cz-pot')) return; const O = document.createElement('div'); O.id = 'cz-pot'; O.style.cssText = 'position:fixed;inset:0;background:rgba(5,8,6,.92);z-index:30;display:flex;align-items:center;justify-content:center;flex-direction:column;touch-action:none;color:#fff;font:700 15px system-ui'; document.body.appendChild(O);
  const top = document.createElement('div'); top.style.cssText = 'display:flex;gap:16px;align-items:center;margin-bottom:8px'; O.appendChild(top); const info = document.createElement('span'); top.appendChild(info); const x = document.createElement('button'); x.textContent = 'DONE'; x.style.cssText = 'background:transparent;border:2px solid #fff;color:#fff;border-radius:12px;height:38px;min-width:70px;font:800 14px system-ui'; top.appendChild(x);
  const cv = document.createElement('canvas'), Wd = Math.min(innerWidth * 0.94, (innerHeight - 70) * 2), Hd = Wd / 2; cv.width = Wd * 2; cv.height = Hd * 2; cv.style.cssText = `width:${Wd}px;height:${Hd}px;border-radius:12px`; O.appendChild(cv); const g = cv.getContext('2d'), S = cv.width / 3.6;
  const R = 0.028, rail = 0.09, TW = 3.6 - 2 * rail, TH = 1.8 - 2 * rail, P = [[0, 0], [TW / 2, 0], [TW, 0], [0, TH], [TW / 2, TH], [TW, TH]];
  const balls = [{ x: TW * 0.22, y: TH / 2, vx: 0, vy: 0, c: '#fff', cue: 1 }]; for (let r = 0; r < 4; r++) for (let k = 0; k <= r; k++) balls.push({ x: TW * 0.7 + r * R * 1.8, y: TH / 2 + (k - r / 2) * R * 2.05, vx: 0, vy: 0, c: '#c01818', v: 1 }); balls.push({ x: TW * 0.9, y: TH / 2, vx: 0, vy: 0, c: '#111', v: 7 });
  let score = 0, shots = 12, drag = null, msg = 'Drag back from the white ball, let go to shoot'; const tx = p => (p + rail) * S;
  const moving = () => balls.some(b => Math.hypot(b.vx, b.vy) > 0.003);
  const draw = () => { g.fillStyle = '#4a2a14'; g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = '#0f6a2e'; g.fillRect(rail * S, rail * S, TW * S, TH * S); g.fillStyle = '#000'; for (const [px, py] of P) { g.beginPath(); g.arc(tx(px), tx(py), R * 2.1 * S, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.moveTo(tx(TW * 0.22), tx(0)); g.lineTo(tx(TW * 0.22), tx(TH)); g.stroke();
    for (const b of balls) { if (b.gone) continue; g.fillStyle = b.c; g.beginPath(); g.arc(tx(b.x), tx(b.y), R * S, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.arc(tx(b.x) - R * S * 0.3, tx(b.y) - R * S * 0.3, R * S * 0.3, 0, 7); g.fill(); }
    const c = balls[0]; if (drag && !moving()) { const dx = drag.x - c.x, dy = drag.y - c.y; g.strokeStyle = '#ffd23f'; g.lineWidth = 4; g.setLineDash([12, 10]); g.beginPath(); g.moveTo(tx(c.x), tx(c.y)); g.lineTo(tx(c.x - dx * 3), tx(c.y - dy * 3)); g.stroke(); g.setLineDash([]); g.strokeStyle = '#c8a070'; g.lineWidth = 8; g.beginPath(); g.moveTo(tx(c.x + dx * 0.4), tx(c.y + dy * 0.4)); g.lineTo(tx(c.x + dx * 0.4 + dx / Math.hypot(dx, dy || 1e-6) * 1.0), tx(c.y + dy * 0.4 + dy / Math.hypot(dx, dy || 1e-6) * 1.0)); g.stroke(); }
    info.textContent = `SCORE ${score}  ·  SHOTS LEFT ${shots}  ·  ${msg}`; };
  const toT = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * 3.6 - rail, y: (e.clientY - r.top) / r.height * 1.8 - rail }; };
  cv.onpointerdown = e => { if (moving() || shots <= 0) return; drag = toT(e); cv.setPointerCapture?.(e.pointerId); }; cv.onpointermove = e => { if (drag) drag = toT(e); };
  cv.onpointerup = () => { if (!drag) return; const c = balls[0], dx = c.x - drag.x, dy = c.y - drag.y, p = Math.min(1.4, Math.hypot(dx, dy)) * 5; if (p > 0.1) { const l = Math.hypot(dx, dy); c.vx = dx / l * p; c.vy = dy / l * p; shots--; msg = ''; } drag = null; };
  const shoot = (ang, pow) => { const c = balls[0]; c.vx = Math.cos(ang) * pow; c.vy = Math.sin(ang) * pow; shots--; }; O.shoot = shoot; // for tests
  let last = performance.now(), alive = true; const tick = now => { if (!alive) return; const dt = Math.min(0.033, (now - last) / 1000); last = now;
    for (let s = 0; s < 4; s++) { const h = dt / 4; for (const b of balls) { if (b.gone) continue; b.x += b.vx * h; b.y += b.vy * h; const f = Math.max(0, 1 - 0.9 * h); b.vx *= f; b.vy *= f;
        if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx) * 0.8; } if (b.x > TW - R) { b.x = TW - R; b.vx = -Math.abs(b.vx) * 0.8; } if (b.y < R) { b.y = R; b.vy = Math.abs(b.vy) * 0.8; } if (b.y > TH - R) { b.y = TH - R; b.vy = -Math.abs(b.vy) * 0.8; }
        for (const [px, py] of P) if (Math.hypot(b.x - px, b.y - py) < R * 2.2) { if (b.cue) { b.x = TW * 0.22; b.y = TH / 2; b.vx = b.vy = 0; score = Math.max(0, score - 4); msg = 'Foul! -4'; } else { b.gone = true; score += b.v; msg = b.v === 7 ? 'Black! +7' : 'Potted! +1'; V.jobs?.addXP(b.v * 3, 'Pot'); } } }
      for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) { const a = balls[i], b = balls[j]; if (a.gone || b.gone) continue; const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy); if (d < 2 * R && d > 0) { const nx = dx / d, ny = dy / d, p = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny; if (p > 0) { a.vx -= p * nx; a.vy -= p * ny; b.vx += p * nx; b.vy += p * ny; } const o = (2 * R - d) / 2; a.x -= nx * o; a.y -= ny * o; b.x += nx * o; b.y += ny * o; } } }
    if (shots <= 0 && !moving()) msg = 'Game over — tap DONE'; draw(); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  x.onclick = () => { alive = false; O.remove(); if (score) foot.s.hud?.flash?.('Snooker: ' + score + ' points', 1.6); }; return O; }
// ------------------------------------------------------------------ hook into Venues / OnFoot
const BUILD = { hub: (I, v, V) => storeRoom(I, v, V, true), store: (I, v, V) => storeRoom(I, v, V, false), snooker: snookerRoom };
if (!Venues.prototype._p55) { Venues.prototype._p55 = true; const enter0 = Venues.prototype.enter;
  Venues.prototype.enter = function (v) { const b = BUILD[v.kind]; if (!b) return enter0.call(this, v); const I = this.inside = { v, g: new THREE.Group(), npcs: [], step: null, spots: [] }; I.g.position.set(0, BASE_Y, 0); this.s.scene.add(I.g);
    const info = b(I, v, this); I.entry = info.entry; I.bounds = info.bounds; I.info = info; this.indoorLook(I, info); return I; }; }
export function addPlaces(foot) { const V = foot.venues, data = foot.s.app.data, [lat0, lon0] = data.origin, ll = (la, lo) => [(lo - lon0) * 111320 * Math.cos(lat0 * PI / 180), -(la - lat0) * 110574];
  let RS = null; try { RS = foot.rylandSt = new RylandSt(foot.s); } catch (e) { console.warn('places ryland st', e); }
  for (const [id, name, kind, la, lo, col] of PLACES) { const [x, z] = ll(la, lo); const n = V.list.length; V.add({ id, name, kind, col }, x, z, null); const v = V.list[n];
    if (v && kind === 'hub' && RS?.door) { const d = RS.door; Object.assign(v, { x: d.x, z: d.z, y: d.y, yaw: d.yaw }); v.g.position.set(d.x, d.y, d.z); v.g.rotation.y = d.yaw; } // on its real Ryland Street wall
    if (v && kind === 'hub') { const sg = v.g.children[2]; if (sg) sg.visible = false; rylandFront(v); v.hub = true; } }
  V.jobs = new Jobs(foot); return V; }
