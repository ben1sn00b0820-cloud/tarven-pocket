// 钱包 and 商城 of the phone's chat app. One wallet for the whole phone (not split by character card): red packets and
// transfers the user takes go in, the ones the user sends and what is bought in the shop come out. The shop sells
// decorations (better looking than the free ones, bought once) and gifts to send to a character; the user can add
// gifts of their own. Kept in the settings (settings.chat.wallet), so it follows the tavern account.

export const WALLET_START = 520;
export const WALLET_LIMITS = {ledger: 300, gifts: 100, received: 200, inventory: 500, journal: 2000, balance: 99999999};

/** Decorations sold in the shop: key → [name, price]. The free ones are in core/chat.js (BUBBLES, FRAMES, BACKGROUNDS). */
export const PREMIUM = Object.freeze({
  bubble: Object.freeze({aurora: ['极光', 88], sakura: ['樱花信笺', 66], gold: ['鎏金', 128], glass: ['冰晶', 99], galaxy: ['银河', 168]}),
  frame: Object.freeze({crown: ['皇冠', 188], wings: ['天使之翼', 268], neon: ['霓虹环', 128], bunny: ['兔耳蝴蝶结', 99], butterfly: ['蝴蝶', 158]}),
  background: Object.freeze({aurora: ['极光夜', 198], sunset: ['晚霞', 128], ocean: ['海浪', 158], meteor: ['流星雨', 228], garden: ['花园', 138]})
});
export const DECOR_KINDS = Object.freeze({bubble: '聊天气泡', frame: '头像挂件', background: '聊天背景'});
export const decorKey = (kind, key) => kind + ':' + key;
export const premiumOf = (kind, key) => PREMIUM[kind]?.[key] || null;

/** Gifts the shop always has. */
export const SHOP_GIFTS = Object.freeze([
  {id: 'letter', name: '情书', emoji: '💌', price: 5},
  {id: 'milktea', name: '奶茶', emoji: '🧋', price: 18},
  {id: 'coffee', name: '咖啡', emoji: '☕', price: 25},
  {id: 'cake', name: '小蛋糕', emoji: '🍰', price: 38},
  {id: 'flowers', name: '花束', emoji: '💐', price: 52},
  {id: 'plush', name: '玩偶', emoji: '🧸', price: 88},
  {id: 'perfume', name: '香水', emoji: '🌸', price: 299},
  {id: 'necklace', name: '项链', emoji: '📿', price: 520},
  {id: 'game', name: '游戏机', emoji: '🎮', price: 999},
  {id: 'ring', name: '戒指', emoji: '💍', price: 1314}
].map(Object.freeze));

const text = (value, max) => String(value ?? '').slice(0, max);
/** Money with two decimals. */
export const cents = n => Math.round(Number(n) * 100) / 100;
export const yuan = n => cents(n).toFixed(2).replace(/\.00$/, '');
const price = (value, fallback = 0) => { const n = cents(value); return Number.isFinite(n) && n >= 0 ? Math.min(99999, n) : fallback; };
const emojiOf = value => { const s = [...text(value, 16).trim()].slice(0, 2).join(''); return s || '🎁'; };

/** A gift as kept and sent: {id, name, emoji, price, note}. */
export function normalizeGift(g = {}) {
  return {id: /^[\w-]{1,64}$/.test(String(g.id || '')) ? String(g.id) : crypto.randomUUID(), name: text(g.name, 20).trim(), emoji: emojiOf(g.emoji), price: price(g.price), note: text(g.note, 60).trim()};
}
export function validateGift(g) {
  if (!g.name) throw Error('請給禮物起個名字');
  if (SHOP_GIFTS.some(x => x.name === g.name)) throw Error('商城裡已經有「' + g.name + '」了');
  return g;
}

export function defaultWallet() {
  return {balance: WALLET_START, ledger: [{id: 'start', at: 0, amount: WALLET_START, kind: 'start', note: '开通钱包', who: ''}], owned: [], gifts: [], received: [], inventory: [], journal: []};
}
/** Exact two-decimal, finite fictional money. Invalid values are rejected, never turned into free purchases. */
export function walletAmount(value, {zero = true, max = WALLET_LIMITS.balance} = {}) {
  if (!['string', 'number'].includes(typeof value) || String(value).trim() === '' || !/^\d+(?:\.\d{1,2})?$/.test(String(value).trim())) throw Error('金額請填寫非負數字，最多兩位小數');
  const n = Number(value);
  if (!Number.isFinite(n) || n < (zero ? 0 : 0.01) || n > max) throw Error('金額超出允許範圍');
  return cents(n);
}
export function purchaseItem(value) {
  if (!value || typeof value !== 'object' || !/^[\w:.-]{1,100}$/.test(String(value.id || ''))) throw Error('商品編號無效');
  const name = text(value.name, 80).trim();
  if (!name) throw Error('商品缺少名稱');
  return {id: String(value.id), name, price: walletAmount(value.price), description: text(value.description, 1200), emoji: text(value.emoji, 32).trim() || '🛍️', ...(['items', 'abilities'].includes(value.kind) ? {kind: value.kind} : {}), ...(typeof value.memoryOwner === 'string' && value.memoryOwner.trim() && value.memoryOwner.length <= 80 ? {memoryOwner: value.memoryOwner.trim()} : {})};
}
export function normalizeWallet(value) {
  if (!value || typeof value !== 'object') return defaultWallet();
  const owned = (Array.isArray(value.owned) ? value.owned : []).map(String).filter(k => { const [kind, key] = k.split(':'); return !!premiumOf(kind, key); });
  return {
    balance: Math.min(WALLET_LIMITS.balance, Math.max(0, cents(Number(value.balance) || 0))),
    ledger: (Array.isArray(value.ledger) ? value.ledger : []).slice(0, WALLET_LIMITS.ledger).map(e => ({id: text(e?.id, 64) || crypto.randomUUID(), at: Number(e?.at) || 0, amount: cents(Number(e?.amount) || 0), kind: text(e?.kind, 20), note: text(e?.note, 60), who: text(e?.who, 40)})),
    owned: [...new Set(owned)],
    gifts: (Array.isArray(value.gifts) ? value.gifts : []).slice(0, WALLET_LIMITS.gifts).map(normalizeGift).filter(g => g.name),
    received: (Array.isArray(value.received) ? value.received : []).slice(0, WALLET_LIMITS.received).map(r => ({id: text(r?.id, 200) || crypto.randomUUID(), at: Number(r?.at) || 0, from: text(r?.from, 40), name: text(r?.name, 20), emoji: emojiOf(r?.emoji), note: text(r?.note, 60)})).filter(r => r.name),
    inventory: (Array.isArray(value.inventory) ? value.inventory : []).slice(0, WALLET_LIMITS.inventory).flatMap(r => { try { return [{...purchaseItem(r), orderId: text(r.orderId, 200), at: Number(r.at) || 0}]; } catch { return []; } }),
    // The journal is separate from the short visible ledger. Do not prune old IDs: they prevent repeated charges.
    journal: (Array.isArray(value.journal) ? value.journal : []).slice(0, WALLET_LIMITS.journal).filter(r => r?.id && ['send', 'take', 'purchase', 'claim'].includes(r.flow)).map(r => ({id: text(r.id, 200), flow: r.flow, status: ['pending', 'done', 'refunded'].includes(r.status) ? r.status : 'pending', at: Number(r.at) || 0, amount: cents(Number(r.amount) || 0), threadId: text(r.threadId, 100), messageId: text(r.messageId, 100), action: text(r.action, 20), actor: text(r.actor, 40), notice: r.notice === true, fingerprint: text(r.fingerprint, 2000)}))
  };
}

/** Every gift the shop offers: its own, then the user's. */
export const shopGifts = wallet => [...SHOP_GIFTS.map(g => ({...g, own: false})), ...(wallet?.gifts || []).map(g => ({...g, own: true}))];

/** A gift a character sends (「[礼物 花束] 附言」): an emoji picked from what it is called. */
const GUESS = [[/花|玫瑰|rose|flower/i, '💐'], [/奶茶|茶/, '🧋'], [/咖啡|coffee/i, '☕'], [/蛋糕|甜点|cake/i, '🍰'], [/巧克力|chocolate/i, '🍫'], [/糖/, '🍬'], [/信|letter/i, '💌'], [/项链|necklace/i, '📿'], [/戒指|ring/i, '💍'], [/熊|玩偶|娃娃|plush/i, '🧸'], [/香水|perfume/i, '🌸'], [/游戏|switch|game/i, '🎮'], [/书|book/i, '📚'], [/耳机|音乐|唱片/, '🎧'], [/围巾|衣|外套|裙/, '🧣'], [/手表|表/, '⌚'], [/票|电影/, '🎟️'], [/包/, '👜']];
export const guessEmoji = name => GUESS.find(([re]) => re.test(String(name)))?.[1] || '🎁';

/** How much the ledger kinds read as. */
export const LEDGER_KINDS = Object.freeze({start: '开通钱包', redpacket: '红包', transfer: '转账', refund: '退回', shop: '商城', gift: '送礼物', topup: '零钱', adjust: '手动调整', purchase: '萬寶商城'});
