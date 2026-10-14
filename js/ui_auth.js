// Sign in / Create account screen (shown on boot before the main menu when there is no valid session).
const $ = (s, r = document) => r.querySelector(s);
const USER_RE = /^[A-Za-z0-9_]{3,16}$/;

export class AuthUI {
  constructor(app) { this.app = app; this.mode = 'login'; this.bound = false; }
  // resolves once the player is signed in (store.profile is then loaded)
  show(reason) {
    this.bind(); this.setMode('login');
    if (reason) this.error(reason); else this.error('');
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('show', s.id === 'auth');
    this.app.screen = 'auth'; this.app.nav?.screenShown('auth');
    return new Promise(res => { this.done = res; });
  }
  bind() {
    if (this.bound) return; this.bound = true;
    for (const b of document.querySelectorAll('[data-am]')) b.onclick = () => { this.app.audio.click(); this.setMode(b.dataset.am); };
    $('#auth-back').onclick = () => { this.app.audio.click('back'); if (this.mode === 'register') this.setMode('login'); else this.toTitle(); };
    $('#auth-show').onclick = () => { const on = $('#auth-pass').type === 'password'; for (const i of [$('#auth-pass'), $('#auth-pass2')]) i.type = on ? 'text' : 'password'; $('#auth-show').textContent = on ? 'Hide' : 'Show'; $('#auth-show').setAttribute('aria-pressed', on); };
    $('#auth-form').onsubmit = e => { e.preventDefault(); this.submit(); };
    $('#auth-user').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#auth-pass').focus(); } });
    $('#auth-pass').addEventListener('keydown', e => { if (e.key === 'Enter' && this.mode === 'register') { e.preventDefault(); $('#auth-pass2').focus(); } });
    // on-screen keyboards cover the lower half of a landscape phone: keep the focused field visible
    for (const i of document.querySelectorAll('#auth input')) i.addEventListener('focus', () => setTimeout(() => i.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300));
    $('#boot-signin').onclick = () => { $('#boot-signin').hidden = true; for (const s of document.querySelectorAll('.screen')) s.classList.toggle('show', s.id === 'auth'); this.app.screen = 'auth'; };
  }
  toTitle() { for (const s of document.querySelectorAll('.screen')) s.classList.toggle('show', s.id === 'boot'); this.app.screen = 'boot'; $('#boot-signin').hidden = false; }
  setMode(m) {
    this.mode = m; const reg = m === 'register';
    for (const b of document.querySelectorAll('[data-am]')) { const on = b.dataset.am === m; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); }
    $('#auth-title').textContent = reg ? 'Create account' : 'Sign in';
    $('#auth-go').textContent = reg ? 'Create account' : 'Sign in';
    $('#auth-pass2-wrap').hidden = !reg; $('#auth-norecover').hidden = !reg; $('#auth-user-hint').hidden = !reg;
    $('#auth-pass').autocomplete = reg ? 'new-password' : 'current-password'; $('#auth-pass').setAttribute('enterkeyhint', reg ? 'next' : 'go');
    $('#auth-pass-hint').hidden = !reg; $('#auth-back').textContent = '‹ Back'; $('#auth-back').setAttribute('aria-label', reg ? 'Back to sign in' : 'Back to title');
    this.error('');
  }
  error(msg) { const e = $('#auth-err'); e.hidden = !msg; e.textContent = msg || ''; }
  async submit() {
    if (this.busy) return;
    const u = $('#auth-user').value.trim(), p = $('#auth-pass').value, reg = this.mode === 'register';
    if (!u) return this.error('Enter your username'), $('#auth-user').focus();
    if (reg && !USER_RE.test(u)) return this.error('Usernames are 3–16 characters: letters, numbers and _ only'), $('#auth-user').focus();
    if (!p) return this.error('Enter your password'), $('#auth-pass').focus();
    if (reg && p.length < 8) return this.error('Passwords need at least 8 characters'), $('#auth-pass').focus();
    if (reg && p !== $('#auth-pass2').value) return this.error("The two passwords don't match"), $('#auth-pass2').focus();
    this.busy = true; const btn = $('#auth-go'); btn.disabled = true; const label = btn.textContent; btn.textContent = reg ? 'Creating…' : 'Signing in…'; this.error('');
    try {
      if (reg) await this.app.store.register(u, p); else await this.app.store.signIn(u, p);
      $('#auth-pass').value = ''; $('#auth-pass2').value = ''; document.activeElement?.blur?.();
      this.app.audio.click(); const d = this.done; this.done = null; d?.(this.app.store.user);
    } catch (e) {
      this.error(e.offline ? 'Could not reach the CUZZY RACING server — check your connection and try again.' : e.message);
      if (e.code === 'name_taken' || String(e.code).startsWith('name_')) $('#auth-user').focus(); else if (e.code === 'bad_login' || String(e.code).startsWith('pw_')) { $('#auth-pass').select?.(); }
    } finally { this.busy = false; btn.disabled = false; btn.textContent = label; }
  }
}
