// Small touches that make the phone feel alive, all skipped when the system asks for reduced motion:
// - a ripple spreading from where a row, tile or tab was pressed;
// - on devices with a mouse, a soft light following the pointer over cards and widgets.
// Entrance, press and idle animations are plain CSS (phone.css, "Motion").
const RIPPLE = '.list-row,.conv,.control-tile,.segmented button,.qq-tabs button,.deco,.tool';
const SPOT = '.widget,.bank-card,.control-tile,.qq-card';

export function installMotion(win, mount, signal) {
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)'), hover = win.matchMedia('(hover: hover) and (pointer: fine)');
  mount.addEventListener('pointerdown', e => {
    if (reduced.matches || e.button > 0) return;
    const target = e.target.closest(RIPPLE);
    if (!target || target.disabled || !mount.contains(target)) return;
    const box = target.getBoundingClientRect(), size = Math.max(box.width, box.height) * 2.2;
    const wave = win.document.createElement('span');
    wave.className = 'ripple';
    wave.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - box.left - size / 2}px;top:${e.clientY - box.top - size / 2}px`;
    target.append(wave);
    wave.addEventListener('animationend', () => wave.remove(), {once: true});
    win.setTimeout(() => wave.remove(), 900);
  }, {signal, passive: true});
  let frame = 0, last = null;
  mount.addEventListener('pointermove', e => {
    if (reduced.matches || !hover.matches || e.pointerType !== 'mouse') return;
    last = e;
    if (frame) return;
    frame = win.requestAnimationFrame(() => {
      frame = 0;
      const target = last.target.closest?.(SPOT);
      if (!target) return;
      if (!target.querySelector(':scope>.spotlight')) target.insertAdjacentHTML('beforeend', '<span class="spotlight" aria-hidden="true"></span>');
      const box = target.getBoundingClientRect();
      target.style.setProperty('--mx', `${last.clientX - box.left}px`);
      target.style.setProperty('--my', `${last.clientY - box.top}px`);
    });
  }, {signal, passive: true});
}
