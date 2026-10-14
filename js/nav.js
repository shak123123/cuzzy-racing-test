// Turn-by-turn sat-nav: road graph from the world's street segments, A* route to the waypoint,
// manoeuvre list (left / right / keep / roundabout-ish), banner with distance + street name, spoken prompts, auto re-route.
const K = (x, z) => Math.round(x / 2.5) + ',' + Math.round(z / 2.5);
import * as THREE from 'three';
export class Nav {
  constructor(sess) { this.s = sess; this.g = null; this.route = null; this.el = null; this.said = {}; this.t = 0; }
  graph() { if (this.g) return this.g; const W = this.s.w, seen = new Set(), N = new Map();
    const node = (x, z) => { const k = K(x, z); let n = N.get(k); if (!n) N.set(k, n = { k, x, z, e: [] }); return n; };
    for (const a of W.segGrid.values()) for (const s of a) { if (seen.has(s)) continue; seen.add(s); const A = node(s.x1, s.z1), B = node(s.x2, s.z2); if (A === B) continue; const L = Math.hypot(s.x2 - s.x1, s.z2 - s.z1);
      A.e.push([B, L, s.nm]); B.e.push([A, L, s.nm]); }
    // stitch junctions whose ends don't share a point exactly (lifts / offsets): link nodes within 6 m
    const G2 = new Map(), c6 = n => Math.floor(n.x / 10) + ',' + Math.floor(n.z / 10); for (const n of N.values()) { const c = c6(n); let l = G2.get(c); if (!l) G2.set(c, l = []); l.push(n); }
    for (const n of N.values()) { const cx = Math.floor(n.x / 10), cz = Math.floor(n.z / 10); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const m of G2.get((cx + i) + ',' + (cz + j)) || []) { if (m === n) continue; const d = Math.hypot(m.x - n.x, m.z - n.z); if (d < 10 && !n.e.some(e => e[0] === m)) n.e.push([m, d + 0.5, null]); } }
    // junctions: crossings and T-junctions that don't share a point -> split with a junction node
    const segs = [...seen], ends = new Map(segs.map(s => [s, [N.get(K(s.x1, s.z1)), N.get(K(s.x2, s.z2))]]));
    const link = (J, A, B) => { for (const X of [A, B]) { if (!X || X === J) continue; const d = Math.hypot(X.x - J.x, X.z - J.z) + 0.1; J.e.push([X, d, null]); X.e.push([J, d, null]); } };
    const done2 = new Set();
    for (const s1 of segs) for (const cell of [Math.floor(s1.x1 / 25) * 100000 + Math.floor(s1.z1 / 25), Math.floor(s1.x2 / 25) * 100000 + Math.floor(s1.z2 / 25)]) for (const s2 of W.segGrid.get(cell) || []) {
      if (s2 === s1 || !ends.has(s2)) continue; const key = s1 < s2 ? 0 : 1; const pk = segs.indexOf ? null : null; const id = (ends.get(s1)[0].k + ends.get(s1)[1].k) + '|' + (ends.get(s2)[0].k + ends.get(s2)[1].k); if (done2.has(id)) continue; done2.add(id);
      const dx1 = s1.x2 - s1.x1, dz1 = s1.z2 - s1.z1, dx2 = s2.x2 - s2.x1, dz2 = s2.z2 - s2.z1, den = dx1 * dz2 - dz1 * dx2;
      if (Math.abs(den) > 1e-6) { const t = ((s2.x1 - s1.x1) * dz2 - (s2.z1 - s1.z1) * dx2) / den, u = ((s2.x1 - s1.x1) * dz1 - (s2.z1 - s1.z1) * dx1) / den;
        if (t > -0.02 && t < 1.02 && u > -0.02 && u < 1.02) { const h1 = s1.h1 + (s1.h2 - s1.h1) * t, h2 = s2.h1 + (s2.h2 - s2.h1) * u; if (Math.abs(h1 - h2) < 1.5) { const J = node(s1.x1 + dx1 * t, s1.z1 + dz1 * t); link(J, ...ends.get(s1)); link(J, ...ends.get(s2)); } continue; } }
      // T: an end of s1 close to the body of s2
      for (const [ex, ez, eh, En] of [[s1.x1, s1.z1, s1.h1, ends.get(s1)[0]], [s1.x2, s1.z2, s1.h2, ends.get(s1)[1]]]) { const L2 = dx2 * dx2 + dz2 * dz2 || 1; let u = ((ex - s2.x1) * dx2 + (ez - s2.z1) * dz2) / L2; if (u < 0 || u > 1) continue;
        const px = s2.x1 + dx2 * u, pz = s2.z1 + dz2 * u, d = Math.hypot(px - ex, pz - ez); if (d < s2.hw + 6 && Math.abs(s2.h1 + (s2.h2 - s2.h1) * u - eh) < 1.5) { const J = node(px, pz); link(J, ...ends.get(s2)); link(J, En, null); } } }
    let best = null; const done = new Set(); for (const n of N.values()) { if (done.has(n)) continue; const S = [n], st = [n]; done.add(n); while (st.length) { const c = st.pop(); for (const [m] of c.e) if (!done.has(m)) { done.add(m); S.push(m); st.push(m); } } if (!best || S.length > best.length) best = S; }
    for (const n of best) n.main = 1; /* route only on the main connected street network */
    const grid = new Map(); for (const n of N.values()) { if (!n.main) continue; const c = Math.floor(n.x / 50) + ',' + Math.floor(n.z / 50); let l = grid.get(c); if (!l) grid.set(c, l = []); l.push(n); }
    return this.g = { N, grid }; }
  near(x, z) { const { grid } = this.graph(); let b = null, bd = 1e18; for (let r = 0; r < 6 && !b; r++) for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (const n of grid.get((Math.floor(x / 50) + i) + ',' + (Math.floor(z / 50) + j)) || []) { const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bd) { bd = d; b = n; } } return b; }
  astar(a, b) { const open = new Map([[a, 0]]), g = new Map([[a, 0]]), from = new Map(), h = n => Math.hypot(n.x - b.x, n.z - b.z); let it = 0;
    while (open.size && it++ < 60000) { let cur = null, cf = 1e18; for (const [n, f] of open) if (f < cf) { cf = f; cur = n; } if (cur === b) break; open.delete(cur);
      for (const [m, L, nm] of cur.e) { const ng = g.get(cur) + L; if (ng < (g.get(m) ?? 1e18)) { g.set(m, ng); from.set(m, [cur, nm]); open.set(m, ng + h(m)); } } }
    if (!from.has(b) && a !== b) return null; const pts = [{ x: b.x, z: b.z, nm: from.get(b)?.[1] }]; let n = b; while (from.has(n)) { const [p, nm] = from.get(n); pts.unshift({ x: p.x, z: p.z, nm }); n = p; } return pts; }
  start(wp, q) { this.wp = wp; this.said = {}; if (!wp) { this.route = null; try { this.ribbon(); } catch (e) { } this.ui(false); return; } this.plan(q); this.ui(true); }
  plan(q) { const a = this.near(q.x, q.z), b = this.near(this.wp.x, this.wp.z); const P = a && b && this.astar(a, b); if (!P) { this.route = null; try { this.ribbon(); } catch (e) { } return; }
    P.push({ x: this.wp.x, z: this.wp.z, nm: P[P.length - 1].nm });
    // simplify + manoeuvres: a turn where the heading changes by > 30 deg (over ~12 m either side)
    const cum = [0]; for (let i = 1; i < P.length; i++) cum[i] = cum[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z);
    const at = d => { let i = 1; while (i < P.length - 1 && cum[i] < d) i++; const f = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return { x: P[i - 1].x + (P[i].x - P[i - 1].x) * f, z: P[i - 1].z + (P[i].z - P[i - 1].z) * f }; };
    const M = []; let last = -1e9;
    for (let i = 1; i < P.length - 1; i++) { const d = cum[i]; if (d - last < 25) continue; const A = at(d - 14), B = P[i], C = at(d + 14);
      const h1 = Math.atan2(B.x - A.x, B.z - A.z), h2 = Math.atan2(C.x - B.x, C.z - B.z); let t = h2 - h1; while (t > Math.PI) t -= 2 * Math.PI; while (t < -Math.PI) t += 2 * Math.PI;
      const nameChange = P[i + 1].nm && P[i].nm && P[i + 1].nm !== P[i].nm;
      if (cum[cum.length - 1] - d > 25 && ((Math.abs(t) > 0.9) || (nameChange && Math.abs(t) > 0.35))) { const dir = Math.abs(t) > 2.4 ? 'uturn' : t > 0 ? (t > 1.9 ? 'sharp left' : t < 0.9 ? 'slight left' : 'left') : (t < -1.9 ? 'sharp right' : t > -0.9 ? 'slight right' : 'right');
        M.push({ d, x: B.x, z: B.z, dir, onto: P[i + 1].nm || '' }); last = d; } }
    M.push({ d: cum[cum.length - 1], x: this.wp.x, z: this.wp.z, dir: 'arrive', onto: this.wp.name });
    this.route = { P, cum, M }; try { this.ribbon(); } catch (e) { console.warn('nav ribbon', e); } }
  // world x,z: +x east, +z south (map y). heading atan2(dx, dz) -> left turn is +; check sign with the player's yaw convention at runtime
  step(dt, q) { if (!this.wp || !this.route) return; this.t += dt; const R = this.route;
    // progress = closest point on the route
    let bi = 0, bd = 1e18; for (let i = 0; i < R.P.length; i++) { const d = (R.P[i].x - q.x) ** 2 + (R.P[i].z - q.z) ** 2; if (d < bd) { bd = d; bi = i; } }
    if (Math.sqrt(bd) > 30 && this.t > 1.5) { this.t = 0; this.plan(q); this.say('Re-routing', 'rr' + Math.random()); return; }
    const prog = R.cum[bi]; const m = R.M.find(m => m.d > prog + 3) || R.M[R.M.length - 1]; const dist = Math.max(0, m.d - prog);
    const txt = m.dir === 'arrive' ? 'Arrive at ' + m.onto : (m.dir === 'uturn' ? 'Make a U-turn' : 'Turn ' + m.dir) + (m.onto ? ' onto ' + m.onto : '');
    if (this.el) { this.el.ar.textContent = { left: '↰', right: '↱', 'slight left': '↖', 'slight right': '↗', 'sharp left': '⮢', 'sharp right': '⮣', uturn: '⮌', arrive: '⚑' }[m.dir] || '↑';
      this.el.d.textContent = dist > 1000 ? (dist / 1000).toFixed(1) + ' km' : (Math.round(dist / 10) * 10) + ' m'; this.el.t.textContent = m.dir === 'arrive' ? 'Arrive' : (m.onto || '');
      const nx = R.M[R.M.indexOf(m) + 1]; this.el.n.textContent = nx && m.dir !== 'arrive' ? 'Then ' + (nx.dir === 'arrive' ? 'arrive' : nx.dir) : ''; }
    const id = R.M.indexOf(m); if (dist < 220 && dist > 120) this.say('In 200 metres, ' + txt.toLowerCase(), id + 'a'); if (dist < 45) this.say(txt, id + 'b'); }
  say(t, id) { if (this.said[id]) return; this.said[id] = 1; try { if (this.s.app?.settings?.game?.navVoice === false) return; const u = new SpeechSynthesisUtterance(t); u.lang = 'en-GB'; u.rate = 1.05; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { } }
  ui(on) { if (!on) { this.el?.root.remove(); this.el = null; return; } if (this.el) return;
    const r = document.createElement('div'); r.style.cssText = 'position:absolute;top:calc(56px + env(safe-area-inset-top));left:50%;transform:translateX(-50%);z-index:30;pointer-events:none;display:flex;align-items:center;gap:7px;padding:3px 11px 3px 7px;border-radius:999px;background:transparent;border:2px solid rgba(255,255,255,.55);color:#fff;font:600 12px system-ui;text-shadow:0 1px 2px rgba(0,0,0,.9);max-width:52vw;white-space:nowrap';
    r.innerHTML = '<div class="ar" style="font-size:18px;line-height:1"></div><div class="d" style="font:800 14px system-ui"></div><div class="t" style="opacity:.9;overflow:hidden;text-overflow:ellipsis"></div><div class="n" style="display:none"></div>';
    (document.querySelector('#hud') || document.body).appendChild(r); this.el = { root: r, ar: r.querySelector('.ar'), d: r.querySelector('.d'), t: r.querySelector('.t'), n: r.querySelector('.n') }; }
  draw(g, b, S, z, q) { const R = this.route; if (!R) return; let bi = 0, bd = 1e18; for (let i = 0; i < R.P.length; i++) { const d = (R.P[i].x - q.x) ** 2 + (R.P[i].z - q.z) ** 2; if (d < bd) { bd = d; bi = i; } }
    g.strokeStyle = '#ffc531'; g.lineWidth = 5 / z * 2; g.lineJoin = g.lineCap = 'round'; g.beginPath(); g.moveTo((q.x - b[0]) * S, (q.z - b[1]) * S); for (let i = bi; i < R.P.length; i++) g.lineTo((R.P[i].x - b[0]) * S, (R.P[i].z - b[1]) * S); g.stroke(); }
  // p51: route polyline in screen space (full-screen map)
  drawScreen(g, toScr, q) { const R = this.route; if (!R) return; let bi = 0, bd = 1e18; for (let i = 0; i < R.P.length; i++) { const d = (R.P[i].x - q.x) ** 2 + (R.P[i].z - q.z) ** 2; if (d < bd) { bd = d; bi = i; } }
    g.lineJoin = g.lineCap = 'round'; for (const [w, c] of [[9, 'rgba(0,0,0,.55)'], [5, '#ffc531']]) { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); let [x, y] = toScr(q.x, q.z); g.moveTo(x, y); for (let i = bi; i < R.P.length; i++) { [x, y] = toScr(R.P[i].x, R.P[i].z); g.lineTo(x, y); } g.stroke(); }
    for (const m of R.M) { if (m.dir === 'arrive' || m.d < R.cum[bi]) continue; const [x, y] = toScr(m.x, m.z); g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); } }
  // p51: glowing gold route ribbon laid on the road surface
  ribbon() { const sc = this.s.scene; if (this.rib) { sc.remove(this.rib); this.rib.geometry.dispose(); this.rib.material.dispose(); this.rib = null; } const R = this.route; if (!R || !sc) return;
    const W = this.s.w, P = []; for (let i = 0; i < R.P.length; i++) { const a = R.P[i], b = R.P[i + 1]; if (!b) { P.push(a); break; } const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 4)); for (let k = 0; k < n; k++) P.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n }); }
    const pos = [], idx = []; const hw = 0.85; for (let i = 0; i < P.length; i++) { const p = P[i], q2 = P[Math.min(P.length - 1, i + 1)], p0 = P[Math.max(0, i - 1)]; let dx = q2.x - p0.x, dz = q2.z - p0.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      let h = 0; try { h = W.surfaceHeight(p.x, p.z, 0) || 0; if (!(h > -0.6 && h < 8)) h = 0; h += this.s.visLiftAt?.(p.x, p.z, h) || 0; } catch (e) { } const y = h + 0.12; pos.push(p.x - dz * hw, y, p.z + dx * hw, p.x + dz * hw, y, p.z - dx * hw); if (i) { const j = 2 * i; idx.push(j - 2, j - 1, j, j - 1, j + 1, j); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffc531, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }));
    m.renderOrder = 3; m.frustumCulled = false; this.rib = m; sc.add(m); }
  dispose() { if (this.route) { this.route = null; this.ribbon(); } this.ui(false); try { speechSynthesis.cancel(); } catch (e) { } }
}
