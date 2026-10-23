// 头像挂件, drawn in SVG over the user's avatar. The drawing box is larger than the avatar (see .pendant in phone.css):
// the avatar is the circle at (50, 50) with radius 37 in a 100 × 100 box, so ears, a halo or flowers can stick out.
const R = 37;
const at = (deg, r = R) => [50 + r * Math.cos(deg * Math.PI / 180), 50 + r * Math.sin(deg * Math.PI / 180)].map(n => +n.toFixed(2));

/** A five-point star centred at (x, y). */
function star(x, y, outer, inner = outer * .45) {
  const points = Array.from({length: 10}, (_, i) => { const r = i % 2 ? inner : outer, a = -90 + i * 36; return at(a, r).map((v, k) => v - 50 + [x, y][k]).join(','); });
  return points.join(' ');
}
/** A four-point sparkle centred at (x, y). */
const sparkle = (x, y, s) => `M${x} ${y - s}Q${x + s * .18} ${y - s * .18} ${x + s} ${y}Q${x + s * .18} ${y + s * .18} ${x} ${y + s}Q${x - s * .18} ${y + s * .18} ${x - s} ${y}Q${x - s * .18} ${y - s * .18} ${x} ${y - s}Z`;
/** A five-petal flower centred at (x, y). */
function flower(x, y, size, petal, heart) {
  const petals = Array.from({length: 5}, (_, i) => { const [px, py] = at(-90 + i * 72, size * .62).map((v, k) => v - 50 + [x, y][k]); return `<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${(size * .5).toFixed(2)}" fill="${petal}"/>`; }).join('');
  return `<g stroke="#fff" stroke-width=".8">${petals}</g><circle cx="${x}" cy="${y}" r="${(size * .34).toFixed(2)}" fill="${heart}"/>`;
}

const DRAW = {
  star: () => {
    const [x, y] = at(-42, R + 4);
    return `<defs><linearGradient id="pd-star" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe68a"/><stop offset="1" stop-color="#f7a928"/></linearGradient></defs>
      <circle cx="50" cy="50" r="${R + 1.5}" fill="none" stroke="#f7c948" stroke-width="2" stroke-dasharray="1 5.2" stroke-linecap="round"/>
      <polygon points="${star(x, y, 13)}" fill="url(#pd-star)" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/>
      <path d="${sparkle(x + 13, y + 17, 4.5)}" fill="#fff4c2"/><path d="${sparkle(16, 22, 3.2)}" fill="#ffe68a"/>`;
  },
  cat: () => {
    const ear = side => {
      const m = v => side < 0 ? v : 100 - v;
      return `<path d="M${m(15)} 34 L${m(19)} 4 L${m(44)} 15 Z" fill="#fbe3ec" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/><path d="M${m(21)} 27 L${m(23)} 12 L${m(36)} 18 Z" fill="#ff9dbb"/>`;
    };
    return `${ear(-1)}${ear(1)}<g fill="#ff9dbb" opacity=".85"><ellipse cx="30" cy="66" rx="5" ry="3"/><ellipse cx="70" cy="66" rx="5" ry="3"/></g>`;
  },
  flower: () => {
    const kinds = [['#ffb3cf', '#ffd76a'], ['#fff3f7', '#ff9dbb'], ['#ffc9a8', '#fff3b0']];
    // A garland around the chin: flowers along the lower half of the avatar, leaves between them.
    const angles = [22, 50, 78, 106, 134, 162];
    const leaves = angles.slice(0, -1).map(a => { const [x, y] = at(a + 14, R + 1); return `<ellipse cx="${x}" cy="${y}" rx="4.6" ry="2.2" fill="#8fd69a" transform="rotate(${a + 104} ${x} ${y})"/>`; }).join('');
    return leaves + angles.map((a, i) => { const [x, y] = at(a, R + 1); const [petal, heart] = kinds[i % 3]; return flower(x, y, i % 2 ? 9 : 11, petal, heart); }).join('');
  },
  halo: () => `<defs><linearGradient id="pd-halo" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffd86a"/><stop offset=".5" stop-color="#fff6c9"/><stop offset="1" stop-color="#ffc24a"/></linearGradient></defs>
      <ellipse cx="50" cy="7" rx="25" ry="6" fill="none" stroke="#ffd86a" stroke-opacity=".45" stroke-width="7"/>
      <ellipse cx="50" cy="7" rx="25" ry="6" fill="none" stroke="url(#pd-halo)" stroke-width="3.4"/>
      <path d="${sparkle(86, 22, 5)}" fill="#fff4c2"/><path d="${sparkle(13, 30, 3.6)}" fill="#ffe68a"/><path d="${sparkle(90, 70, 2.8)}" fill="#fff"/>`,
  // Sold in the shop (core/wallet.js PREMIUM.frame): more detail and their own motion.
  crown: () => `<defs><linearGradient id="pd-gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3b0"/><stop offset=".55" stop-color="#f5c542"/><stop offset="1" stop-color="#c9850f"/></linearGradient></defs>
      <g class="crown" transform="rotate(-16 34 16)">
        <path d="M15 24 L17 6 L26.5 15 L34 1 L41.5 15 L51 6 L53 24 Z" fill="url(#pd-gold)" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/>
        <rect x="14.5" y="21.5" width="39" height="7" rx="2.5" fill="url(#pd-gold)" stroke="#fff" stroke-width="1.8"/>
        <circle cx="34" cy="25" r="2.6" fill="#ff4f86" stroke="#fff" stroke-width=".8"/><circle cx="23.5" cy="25" r="1.9" fill="#4fc8ff"/><circle cx="44.5" cy="25" r="1.9" fill="#58e6a0"/>
        <circle cx="17" cy="6" r="2.3" fill="#fff8d8"/><circle cx="34" cy="1" r="2.6" fill="#ff8fb5" stroke="#fff" stroke-width=".8"/><circle cx="51" cy="6" r="2.3" fill="#fff8d8"/>
        <path d="M22 17 L25 21" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".8"/>
      </g>
      <path class="twinkle" d="${sparkle(84, 18, 5)}" fill="#fff4c2"/><path class="twinkle late" d="${sparkle(92, 36, 2.8)}" fill="#ffe68a"/><path class="twinkle" d="${sparkle(10, 44, 2.6)}" fill="#fff"/>`,
  wings: () => {
    const wing = side => {
      const m = v => side < 0 ? v : 100 - v;
      const feather = (y, reach, rise) => `<path d="M${m(17)} ${y} C${m(17 - reach * .55)} ${y - rise * .2} ${m(17 - reach)} ${y - rise * .7} ${m(17 - reach * .9)} ${y - rise} C${m(17 - reach * .55)} ${y - rise * .55} ${m(13)} ${y - rise * .25} ${m(19)} ${y - 4} Z"/>`;
      return `<g class="wing ${side < 0 ? 'left' : 'right'}" fill="url(#pd-wing)" stroke="#d6e2ff" stroke-width="1.1" stroke-linejoin="round">${feather(66, 18, 18)}${feather(58, 22, 24)}${feather(50, 24, 30)}${feather(42, 22, 34)}</g>`;
    };
    return `<defs><linearGradient id="pd-wing" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e6eeff"/></linearGradient></defs>${wing(-1)}${wing(1)}
      <path class="twinkle" d="${sparkle(50, 4, 4)}" fill="#fff6c9"/><path class="twinkle late" d="${sparkle(88, 80, 2.6)}" fill="#fff"/>`;
  },
  neon: () => `<defs><linearGradient id="pd-neon" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff4fd8"/><stop offset=".5" stop-color="#7a5cff"/><stop offset="1" stop-color="#2ee6ff"/></linearGradient></defs>
      <circle cx="50" cy="50" r="${R + 3}" fill="none" stroke="url(#pd-neon)" stroke-width="8" opacity=".28"/>
      <g class="neon-spin"><circle cx="50" cy="50" r="${R + 3}" fill="none" stroke="url(#pd-neon)" stroke-width="3" stroke-dasharray="46 7 4 7" stroke-linecap="round"/>
        <circle cx="${at(-90, R + 3)[0]}" cy="${at(-90, R + 3)[1]}" r="3" fill="#fff"/><circle cx="${at(90, R + 3)[0]}" cy="${at(90, R + 3)[1]}" r="2.2" fill="#bff7ff"/></g>`,
  bunny: () => {
    const ear = side => {
      const m = v => side < 0 ? v : 100 - v;
      return `<g class="ear ${side < 0 ? 'left' : 'right'}"><path d="M${m(29)} 24 C${m(19)} 4 ${m(20)} -16 ${m(31)} -15 C${m(42)} -13 ${m(43)} 8 ${m(40)} 22 Z" fill="#fff" stroke="#f1d4e1" stroke-width="2.2"/><path d="M${m(31)} 17 C${m(26)} 2 ${m(27)} -8 ${m(32)} -8 C${m(37)} -7 ${m(38)} 5 ${m(37)} 15 Z" fill="#ffc4d8"/></g>`;
    };
    const bow = `<g class="bow" transform="translate(73 21) rotate(18)"><path d="M0 0 L-13 -8 C-16 -2 -16 4 -13 8 Z" fill="#ff7aa8" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><path d="M0 0 L13 -8 C16 -2 16 4 13 8 Z" fill="#ff7aa8" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><circle r="3.4" fill="#ff5b93" stroke="#fff" stroke-width="1.4"/><circle cx="-8" cy="-1" r="1.1" fill="#fff"/><circle cx="8" cy="2" r="1.1" fill="#fff"/></g>`;
    return ear(-1) + ear(1) + bow;
  },
  butterfly: () => {
    const fly = (x, y, s, c1, c2, cls) => `<g transform="translate(${x} ${y}) scale(${s})"><g class="fly ${cls}"><path class="wing-l" d="M0 0 C-9 -13 -17 -5 -11 3 C-15 9 -7 14 0 4 Z" fill="${c1}" stroke="#fff" stroke-width="1"/><path class="wing-r" d="M0 0 C9 -13 17 -5 11 3 C15 9 7 14 0 4 Z" fill="${c2}" stroke="#fff" stroke-width="1"/><path d="M0 -3 L0 7" stroke="#5b3a29" stroke-width="1.6" stroke-linecap="round"/><path d="M0 -3 L-2.5 -7M0 -3 L2.5 -7" stroke="#5b3a29" stroke-width=".8" stroke-linecap="round"/></g></g>`;
    return fly(82, 16, 1.15, '#8ec5ff', '#b49bff', 'a') + fly(14, 66, .8, '#ffb3cf', '#ffd27a', 'b') + `<path class="twinkle" d="${sparkle(70, 4, 2.8)}" fill="#fff"/>`;
  },
};

/** The pendant for a frame key, or '' for none. Gradient ids are made unique per drawing. */
let serial = 0;
export function pendant(frame) {
  const draw = DRAW[frame];
  if (!draw) return '';
  const n = ++serial;
  return `<svg class="pendant" viewBox="0 0 100 100" aria-hidden="true">${draw().replace(/pd-([a-z]+)/g, (m, id) => 'pd-' + id + n)}</svg>`;
}
