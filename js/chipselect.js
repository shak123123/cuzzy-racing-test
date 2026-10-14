// <chip-select> — tap-chip replacement for native <select> (native dropdowns were unreliable on phones; same look as the
// Settings chips in ui_settings.js select()). Drop-in API: put <option value selected disabled> children in it (markup or
// innerHTML), read/write .value, listen with .onchange / addEventListener('change'). Options become <button role=radio> chips.
// Attributes: nodefault — nothing is selected until the user taps (used for "Load setup" style pickers).
class ChipSelect extends HTMLElement {
  constructor() { super(); this._opts = []; this._v = ''; this._built = false; }
  connectedCallback() {
    if (!this._mo) { this._mo = new MutationObserver(() => this._take()); this._mo.observe(this, { childList: true }); }
    this.setAttribute('role', 'radiogroup'); this.classList.add('chips', 'csel'); this._take();
  }
  // turn pending <option> children into chip data and re-render
  _take() {
    const opts = [...this.children].filter(e => e.tagName === 'OPTION'); if (!opts.length) return;
    this._opts = opts.map(o => ({ v: o.hasAttribute('value') ? o.getAttribute('value') : o.textContent, t: o.textContent, dis: o.disabled, sel: o.hasAttribute('selected') }));
    const s = this._opts.find(o => o.sel); this._v = s ? s.v : (this.hasAttribute('nodefault') ? '' : this._opts[0].v);
    this._render();
  }
  _render() {
    this.textContent = '';
    for (const o of this._opts) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn small chip'; b.setAttribute('role', 'radio');
      b.dataset.v = o.v; b.textContent = o.t; b.disabled = o.dis; const on = o.v === this._v && (this._v !== '' || !this.hasAttribute('nodefault'));
      b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
      b.onclick = e => { e.stopPropagation(); if (o.dis) return; const was = this._v; this.value = o.v; if (was !== o.v || this.hasAttribute('nodefault')) { this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true })); } };
      this.appendChild(b);
    }
  }
  get value() { this._take(); return this._v; }
  set value(v) { this._take(); v = v == null ? '' : String(v); if (!this._opts.some(o => o.v === v) && !(v === '' && this.hasAttribute('nodefault'))) return; this._v = v;
    for (const b of this.querySelectorAll(':scope > button')) { const on = b.dataset.v === v && !(v === '' && this.hasAttribute('nodefault')); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); } }
  get options() { this._take(); return this._opts.map(o => ({ value: o.v, text: o.t, disabled: o.dis })); }
  get disabled() { return this.hasAttribute('disabled'); }
}
if (!customElements.get('chip-select')) customElements.define('chip-select', ChipSelect);
export { ChipSelect };
