// ST-iPhonie floating ball. Plain DOM (no shadow root) so that dock/organizer scripts can clone its look
// and forward clicks to it; every rule in floating.css is scoped under #sttts-floating.
const SPARK = '<svg class="spark" viewBox="-10 -10 20 20" fill="currentColor" aria-hidden="true"><path d="M0-10C1-2 2-1 10 0 2 1 1 2 0 10-1 2-2 1-10 0-2-1-1-2 0-10z"/></svg>';
const JADE = '<svg class="wave" viewBox="0 0 32 32" aria-hidden="true"><rect x="7" y="5" width="18" height="24" rx="6" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="16" cy="10" r="2" fill="currentColor"/><path d="M16 2v5M11 19h10M16 14v10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const STYLE_ID = 'sttts-floating-style';

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = new URL('../floating.css', import.meta.url).href;
  document.head.append(link);
}

export class FloatingLauncher {
  constructor({openSettings, position, savePosition, theme}) {
    Object.assign(this, {openSettings, savePosition, theme});
    this.side = position?.side === 'left' ? 'left' : 'right';
    this.y = Number.isFinite(position?.y) ? Math.max(0, Math.min(1, position.y)) : .58;
    this.phase = 'idle';
    this.mode = 'rest';
    ensureStyle();
    this.root = document.createElement('div');
    this.root.id = 'sttts-floating';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', '傳音玉符');
    this.root.innerHTML = `<div class="float" data-side="${this.side}" data-mode="rest" data-phase="idle" ><span class="pulse"></span><button class="orb" type="button" aria-label="打開傳音玉符，可拖曳">${JADE}<span class="edge-mark"></span></button>${SPARK}</div>`;
    this.box = this.root.querySelector('.float');
    this.orb = this.root.querySelector('.orb');
    this.abort = new AbortController();
    const opts = {signal: this.abort.signal};
    document.body.append(this.root);
    this.colorScheme = matchMedia('(prefers-color-scheme: dark)');
    this.colorScheme.addEventListener('change', () => this.applyTheme(), opts);
    // Clicks that a script dispatches on the outer element (e.g. a dock that hid the ball) open the phone directly.
    this.root.addEventListener('click', e => { if (e.target === this.root) this.activate(); }, opts);
    this.box.addEventListener('click', e => { if (e.target === this.box && (this.mode === 'docked' || this.hidden)) this.activate(); }, opts);
    // A dock script hides the ball (display:none) and briefly shows it again only while it forwards a click.
    // The observer never runs inside that synchronous window, so `hidden` still says the user could not see the ball.
    this.hidden = false;
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(([entry]) => {
        this.hidden = !entry.contentRect.width;
        // Stay expanded while another script holds the ball, so a later copy of its look shows the full icon.
        if (this.hidden && this.mode === 'docked') this.setMode('rest'); else this.arm();
      });
      this.observer.observe(this.root);
    }
    this.orb.addEventListener('pointerdown', e => this.down(e), opts);
    this.orb.addEventListener('pointermove', e => this.move(e), opts);
    this.orb.addEventListener('pointerup', e => this.up(e), opts);
    this.orb.addEventListener('pointercancel', () => this.cancelDrag(), opts);
    this.orb.addEventListener('click', e => { e.stopPropagation(); this.activate(); }, opts);
    this.root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); this.setMode('docked'); this.orb.focus({preventScroll: true}); } }, opts);
    window.addEventListener('resize', () => this.place(), opts);
    window.visualViewport?.addEventListener('resize', () => this.place(), opts);
    this.place();
    this.applyTheme();
    // The first tuck waits longer: dock scripts copy the ball's look a few seconds after the page loads.
    this.arm(8000);
  }
  applyTheme() {
    const theme = this.theme();
    this.box.dataset.theme = theme === 'dark' || theme === 'system' && this.colorScheme.matches ? 'dark' : 'light';
  }
  place() {
    const height = window.visualViewport?.height || innerHeight;
    const top = 24 + this.y * Math.max(0, height - 136);
    this.root.style.top = Math.round(top) + 'px';
    this.root.style.left = this.side === 'left' ? '8px' : 'auto';
    this.root.style.right = this.side === 'right' ? '8px' : 'auto';
    this.box.dataset.side = this.side;
  }
  arm(delay = 3200) {
    clearTimeout(this.timer);
    if (this.mode === 'rest' && !this.hidden) this.timer = setTimeout(() => { if (this.mode === 'rest' && !this.hidden && !this.drag && !this.orb.matches(':focus-visible')) this.setMode('docked'); }, delay);
  }
  /** A single tap opens the phone, including when the ball is tucked against the edge. */
  activate() {
    if (Date.now() - (this.lastDrag || 0) < 400) return;
    if (!this.hidden) this.setMode('docked');
    this.openSettings();
  }
  setMode(mode) {
    this.mode = mode === 'docked' ? 'docked' : 'rest';
    this.box.dataset.mode = this.mode;
    const label = '打開傳音玉符，可拖曳';
    this.orb.setAttribute('aria-label', label);
    this.orb.title = this.mode === 'docked' ? label : this.message || label;
    this.arm();
  }
  down(e) {
    if (e.button !== 0) return;
    clearTimeout(this.timer);
    const rect = this.root.getBoundingClientRect();
    this.drag = {x: e.clientX, y: e.clientY, left: rect.left, top: rect.top, moved: false, pointer: e.pointerId};
    try { this.orb.setPointerCapture(e.pointerId); } catch { /* Synthetic pointers from other scripts cannot be captured. */ }
  }
  move(e) {
    const d = this.drag;
    if (!d || d.pointer !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    this.box.dataset.dragging = 'true';
    this.box.dataset.mode = 'rest';
    const h = window.visualViewport?.height || innerHeight;
    this.root.style.left = Math.min(innerWidth - 62, Math.max(2, d.left + dx)) + 'px';
    this.root.style.right = 'auto';
    this.root.style.top = Math.min(h - 76, Math.max(20, d.top + dy)) + 'px';
  }
  up(e) {
    const d = this.drag;
    if (!d || d.pointer !== e.pointerId) return;
    if (d.moved) {
      this.lastDrag = Date.now();
      const rect = this.root.getBoundingClientRect(), h = window.visualViewport?.height || innerHeight;
      this.side = rect.left + 30 < innerWidth / 2 ? 'left' : 'right';
      this.y = Math.max(0, Math.min(1, (rect.top - 24) / Math.max(1, h - 136)));
      this.place();
      this.savePosition({side: this.side, y: this.y});
      this.setMode('rest');
    }
    this.drag = null;
    delete this.box.dataset.dragging;
    try { this.orb.releasePointerCapture(e.pointerId); } catch { /* Not captured. */ }
    this.arm();
  }
  cancelDrag() { this.drag = null; delete this.box.dataset.dragging; this.place(); this.setMode('rest'); }
  destroy() { this.abort.abort(); this.observer?.disconnect(); clearTimeout(this.timer); this.root.remove(); }
}
