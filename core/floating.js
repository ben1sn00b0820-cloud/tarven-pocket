// ST-iPhonie floating ball. Plain DOM (no shadow root) so that dock/organizer scripts can clone its look
// and forward clicks to it; every rule in floating.css is scoped under #sttts-floating.
const SPARK = '<svg class="spark" viewBox="-10 -10 20 20" fill="currentColor" aria-hidden="true"><path d="M0-10C1-2 2-1 10 0 2 1 1 2 0 10-1 2-2 1-10 0-2-1-1-2 0-10z"/></svg>';
const WAVE = '<svg class="wave" viewBox="0 0 32 32" aria-hidden="true"><g class="wave"><rect x="4" y="11" width="3" height="10" rx="1.5"/><rect x="9.25" y="6.5" width="3" height="19" rx="1.5"/><rect x="14.5" y="3" width="3" height="26" rx="1.5"/><rect x="19.75" y="8" width="3" height="16" rx="1.5"/><rect x="25" y="12" width="3" height="8" rx="1.5"/></g></svg>';
const STYLE_ID = 'sttts-floating-style';

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = new URL('../floating.css', import.meta.url).href;
  document.head.append(link);
}

export class FloatingPlayer {
  constructor({openSettings, position, savePosition, levels, theme, motion}) {
    Object.assign(this, {openSettings, savePosition, levels, theme, motion});
    this.side = position?.side === 'left' ? 'left' : 'right';
    this.y = Number.isFinite(position?.y) ? Math.max(0, Math.min(1, position.y)) : .58;
    this.phase = 'idle';
    this.mode = 'rest';
    ensureStyle();
    this.root = document.createElement('div');
    this.root.id = 'sttts-floating';
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'ST-iPhonie');
    this.root.innerHTML = `<div class="float" data-side="${this.side}" data-mode="rest" data-phase="idle" data-engine="fish"><span class="pulse"></span><button class="orb" type="button" aria-label="打開傳音玉符，可拖曳">${WAVE}<span class="edge-mark"></span></button>${SPARK}</div>`;
    this.box = this.root.querySelector('.float');
    this.orb = this.root.querySelector('.orb');
    this.bars = [...this.root.querySelectorAll('.wave rect')];
    this.abort = new AbortController();
    const opts = {signal: this.abort.signal};
    document.body.append(this.root);
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.colorScheme = matchMedia('(prefers-color-scheme: dark)');
    this.colorScheme.addEventListener('change', () => this.applyTheme(), opts);
    this.reduced.addEventListener('change', () => this.animate(), opts);
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
    document.addEventListener('visibilitychange', () => this.animate(), opts);
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
  update(value) {
    this.phase = value.phase;
    this.box.dataset.phase = value.phase;
    if (value.engine) this.box.dataset.engine = value.engine;
    this.message = value.message;
    this.orb.title = this.mode === 'docked' ? '打開傳音玉符，可拖曳' : value.message || '打開傳音玉符';
    this.applyTheme();
    this.animate();
  }
  animate() {
    cancelAnimationFrame(this.raf);
    this.bars.forEach(b => b.style.removeProperty('transform'));
    if (this.phase !== 'playing' || !this.motion() || this.reduced.matches || document.hidden) return;
    let previous = 0;
    const draw = now => {
      if (now - previous >= 32) {
        const values = this.levels?.() || [];
        this.bars.forEach((b, i) => { b.style.transform = 'scaleY(' + (.18 + .82 * (values[i] || 0)) + ')'; });
        previous = now;
      }
      this.raf = requestAnimationFrame(draw);
    };
    this.raf = requestAnimationFrame(draw);
  }
  destroy() { this.abort.abort(); this.observer?.disconnect(); clearTimeout(this.timer); cancelAnimationFrame(this.raf); this.root.remove(); }
}
