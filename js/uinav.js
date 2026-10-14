// Keyboard and gamepad navigation for every menu screen and overlay (not used while driving).
// Arrow keys / D-pad / left stick move focus spatially, Enter / A presses, Escape / B goes back or closes a dialog,
// LB / RB (or Q / E) switch tabs. A visible focus ring is shown only after keyboard/gamepad use.
import { standardPad } from './wheel.js';
const SEL = 'button:not([disabled]),select:not([disabled]),input:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';
const vis = el => { if (el.closest('[hidden]')) return false; const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none'; };

export class UINav {
  constructor(app) {
    this.app = app; this.prev = {}; this.rep = {}; this.last = 0;
    addEventListener('keydown', e => this.key(e), true);
    addEventListener('pointerdown', () => document.body.classList.remove('kbd'), true);
    const loop = () => { requestAnimationFrame(loop); try { this.pad(); } catch (e) { } }; requestAnimationFrame(loop);
  }
  // the top-most interactive layer that should own focus right now, or null while driving
  layer() {
    const q = s => document.querySelector(s);
    for (const s of ['#modal', '#ow-panel', '#pause']) { const e = q(s); if (e && !e.hidden) return e; }
    if (this.app.session) return null;
    return q('.screen.show');
  }
  items(root) { return [...root.querySelectorAll(SEL)].filter(vis); }
  screenShown(name) { if (document.body.classList.contains('kbd')) setTimeout(() => this.focusFirst(), 60); }
  focusFirst() { const L = this.layer(); if (!L) return; const it = this.items(L); const pick = it.find(e => e.matches('.mi, .gc.on, .btn.primary')) || it[0]; pick?.focus({ preventScroll: false }); }
  move(dx, dy) {
    const L = this.layer(); if (!L) return; const it = this.items(L); if (!it.length) return;
    const cur = document.activeElement; if (!cur || !L.contains(cur) || !vis(cur)) { this.focusFirst(); return; }
    const a = cur.getBoundingClientRect(); const ax = a.left + a.width / 2, ay = a.top + a.height / 2; let best = null, bs = Infinity;
    for (const el of it) { if (el === cur) continue; const r = el.getBoundingClientRect(); const bx = r.left + r.width / 2, by = r.top + r.height / 2;
      // edge-based primary distance so long rows/columns work; must lie in the requested direction
      const p = dx > 0 ? r.left - a.right + 1 : dx < 0 ? a.left - r.right + 1 : dy > 0 ? r.top - a.bottom + 1 : a.top - r.bottom + 1;
      const pc = dx ? (dx > 0 ? bx - ax : ax - bx) : (dy > 0 ? by - ay : ay - by); if (pc <= 2 || p < -Math.min(a.width, a.height) * 0.5) continue;
      const o = dx ? Math.max(0, Math.max(r.top, a.top) - Math.min(r.bottom, a.bottom)) + Math.abs(by - ay) * 0.3 : Math.max(0, Math.max(r.left, a.left) - Math.min(r.right, a.right)) + Math.abs(bx - ax) * 0.3;
      const sc = Math.max(0, p) + o * 2.2; if (sc < bs) { bs = sc; best = el; } }
    if (best) { best.focus({ preventScroll: true }); best.scrollIntoView({ block: 'nearest', inline: 'nearest' }); this.app.audio?.beep?.(1400, 0.02, 'menu'); this.app.rumble?.tick(); }
  }
  tab(dir) { // cycle the nearest tab group: garage sections, settings tabs
    const L = this.layer(); if (!L) return; const tabs = [...L.querySelectorAll('.gx-tabs [role=tab], #set-tabs .tab')].filter(vis); if (!tabs.length) return;
    const i = tabs.findIndex(t => t.classList.contains('on')); const n = tabs[(i + dir + tabs.length) % tabs.length]; n.click(); setTimeout(() => (document.querySelector('.gx-tabs .on, #set-tabs .tab.on'))?.focus(), 30);
  }
  back() {
    const m = document.querySelector('#modal'); if (m && !m.hidden) { const c = m.querySelector('#m-btns .btn.ghost') || (m.querySelector('#m-btns').children.length === 1 && m.querySelector('#m-btns .btn')); c?.click(); return; }
    const ow = document.querySelector('#ow-panel'); if (ow && !ow.hidden) { document.querySelector('#ow-back')?.click(); return; }
    const p = document.querySelector('#pause'); if (p && !p.hidden) { document.querySelector('#p-resume')?.click(); return; }
    if (!this.app.session && this.app.screen !== 'menu' && this.app.screen !== 'boot') this.app.back();
  }
  key(e) {
    const L = this.layer(); if (!L) return; const t = e.target; const typing = t && (t.tagName === 'INPUT' && t.type !== 'range' && t.type !== 'checkbox') ;
    const k = e.key; const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[k]) { if (typing || t?.tagName === 'SELECT' && (k === 'ArrowUp' || k === 'ArrowDown') || t?.type === 'range' && (k === 'ArrowLeft' || k === 'ArrowRight')) return; e.preventDefault(); document.body.classList.add('kbd'); this.move(...arrows[k]); return; }
    if (k === 'Tab' || k === 'Enter' || k === ' ') document.body.classList.add('kbd');
    if (!typing && (k === 'q' || k === 'e') && !e.ctrlKey && !e.metaKey) { this.tab(k === 'e' ? 1 : -1); }
  }
  pad() {
    const gp = standardPad(); if (!gp) return;
    const L = this.layer(); const now = performance.now(); const B = i => !!gp.buttons[i]?.pressed; const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    const st = { up: B(12) || ay < -0.6, down: B(13) || ay > 0.6, left: B(14) || ax < -0.6, right: B(15) || ax > 0.6, a: B(0), b: B(1), lb: B(4), rb: B(5) };
    const edge = (k, f, repeat) => { if (st[k]) { if (!this.prev[k]) { f(); this.rep[k] = now + 380; } else if (repeat && now > this.rep[k]) { f(); this.rep[k] = now + 110; } } this.prev[k] = st[k]; };
    if (!L) { for (const k in st) this.prev[k] = st[k]; return; }
    const kb = () => document.body.classList.add('kbd');
    edge('up', () => { kb(); this.move(0, -1); }, true); edge('down', () => { kb(); this.move(0, 1); }, true); edge('left', () => { kb(); this.move(-1, 0); }, true); edge('right', () => { kb(); this.move(1, 0); }, true);
    edge('a', () => { kb(); const el = document.activeElement; if (el && L.contains(el) && el !== document.body) el.click(); else this.focusFirst(); });
    edge('b', () => this.back()); edge('lb', () => this.tab(-1)); edge('rb', () => this.tab(1));
  }
}
