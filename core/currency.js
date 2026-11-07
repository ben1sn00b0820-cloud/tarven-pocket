import {worldProfile,getWorldMode,onWorldChange,currencyRule,worldText} from './world.js';
/** Fictional spirit-stone currency. New amounts are integer lower-grade stones.
 * Legacy decimal balances are retained at their original value; they are never
 * multiplied during upgrade. Their old hundredths are used only for exact
 * settlement of an existing balance, catalogue item or payment.
 */
export let SPIRIT_UNITS = Object.freeze({lower: 1, middle: 100, supreme: 100000});
export let SPIRIT_UNIT_LABELS = Object.freeze({lower: '下品靈石', middle: '中品靈石', supreme: '極品靈石'});
export let SPIRIT_CURRENCY_RULE = '貨幣為靈石，只有下品、中品、極品三等。1 枚中品靈石 = 100 枚下品靈石；1 枚極品靈石 = 1000 枚中品靈石 = 100000 枚下品靈石。所有新交易的 amount / price 數字一律以整數枚下品靈石記帳，不得把中品或極品的面額直接當作下品數字。舊帳小數僅保留原值，不乘倍數、不憑空補足。';
const spiritRule=SPIRIT_CURRENCY_RULE;
onWorldChange(()=>{SPIRIT_UNITS=worldProfile().units;SPIRIT_UNIT_LABELS=worldProfile().labels;SPIRIT_CURRENCY_RULE=getWorldMode()==='xianxia'?spiritRule:currencyRule();});
export const SPIRIT_MAX = 99999999;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const aliases = Object.freeze({lower: 'lower', middle: 'middle', supreme: 'supreme', '下品': 'lower', '下品靈石': 'lower', '下品灵石': 'lower', '靈石': 'lower', '灵石': 'lower', '中品': 'middle', '中品靈石': 'middle', '中品灵石': 'middle', '極品': 'supreme', '极品': 'supreme', '極品靈石': 'supreme', '极品灵石': 'supreme'});
function amountAliases(mode=getWorldMode()){
 if(mode==='xianxia')return aliases;
 return {lower:'lower',middle:'middle',supreme:'supreme',...(mode==='ancient'?{'文':'lower','文銅錢':'lower','銅錢':'lower','铜钱':'lower','兩銀子':'middle','两银子':'middle','兩白銀':'middle','銀子':'middle','银子':'middle','兩金子':'supreme','两金子':'supreme','兩黃金':'supreme','金子':'supreme'}:{'元':'lower','圓':'lower','圆':'lower','百元':'middle','萬元':'supreme','万元':'supreme'})};
}
const invalid = () => Error(worldText('靈石數量無效；請輸入整數下品，或能精確換成整數下品的中品／極品數量。'));

function decimal(value, {signed = false, maxDigits = 40} = {}) {
  if (!['string', 'number'].includes(typeof value)) throw invalid();
  const raw = String(value).trim();
  // Exponents, NaN, Infinity, empty values, partial parses and malformed comma
  // grouping are rejected before Number conversion can lose any information.
  if (!raw || raw.length > 100 || !(signed ? /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/ : /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/).test(raw)) throw invalid();
  const s = raw.replaceAll(',', ''), negative = s.startsWith('-');
  const [whole, fraction = ''] = (negative ? s.slice(1) : s).split('.');
  if (whole.length + fraction.length > maxDigits) throw invalid();
  return {whole, fraction, negative, numerator: BigInt(whole + fraction) * (negative ? -1n : 1n), denominator: 10n ** BigInt(fraction.length)};
}

function bound(value, {zero = true, max = SPIRIT_MAX, signed = false} = {}) {
  if (!Number.isSafeInteger(max) || max < 0) throw Error(worldText('靈石上限設定無效。'));
  const limit = BigInt(max);
  if (value > limit || value < (signed ? -limit : zero ? 0n : 1n) || value > MAX_SAFE || value < -MAX_SAFE) throw Error(worldText('靈石數量超出允許範圍。'));
  return Number(value);
}

/** Convert an explicitly selected unit to exact integer lower-grade stones. */
export function parseSpiritAmount(value, unit = 'lower', options = {}) {
  const key = amountAliases(options.worldMode)[String(unit).trim()];
  if (!key) throw Error(worldText('靈石品級無效；只能使用下品、中品或極品。'));
  const d = decimal(value), scaled = d.numerator * BigInt(worldProfile(options.worldMode).units[key]);
  if (scaled % d.denominator !== 0n) throw invalid();
  return bound(scaled / d.denominator, options);
}

/** A plain number means lower grade. Optional unit suffixes make model/manual
 * catalogue amounts unambiguous, e.g. "2 中品靈石" or "1極品 2中品 3下品".
 */
export function parseSpiritText(value, options = {}) {
  if (typeof value === 'number') return parseSpiritAmount(value, 'lower', options);
  if (typeof value !== 'string' || value.length > 240) throw invalid();
  const raw = value.trim();
  if (/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) return parseSpiritAmount(raw, 'lower', options);
  const matcher = (options.worldMode||getWorldMode())==='xianxia' ? /((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(?:枚\s*)?(極品|极品|中品|下品|靈石|灵石)(?:靈石|灵石)?/gy : new RegExp('((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?)\\s*('+Object.keys(amountAliases(options.worldMode)).filter(x=>!['lower','middle','supreme'].includes(x)).sort((a,b)=>b.length-a.length).join('|')+')','gy');
  let index = 0, total = 0n, count = 0;
  while (index < raw.length) {
    matcher.lastIndex = index;
    const match = matcher.exec(raw);
    if (!match) throw invalid();
    total += BigInt(parseSpiritAmount(match[1], match[2], {...options, zero: true}));
    index = matcher.lastIndex;
    const gap = /^[\s、，,+]*/.exec(raw.slice(index))[0];
    index += gap.length;
    if (index === raw.length && /[、，,+]/.test(gap)) throw invalid();
    count++;
  }
  if (!count) throw invalid();
  return bound(total, options);
}

/** Exact legacy hundredths; only legacy settlement/normalization may call this.
 * Never round a third decimal or a value outside the safe integer range.
 */
export function legacyHundredths(value, {signed = false, max = SPIRIT_MAX} = {}) {
  const d = decimal(value, {signed});
  if (d.fraction.length > 2 || !Number.isSafeInteger(max) || max < 0) throw invalid();
  const n = d.numerator * (100n / d.denominator);
  const limit = BigInt(max) * 100n;
  if (n > limit || n < (signed ? -limit : 0n) || n > MAX_SAFE || n < -MAX_SAFE) throw Error(worldText('靈石數量超出允許範圍。'));
  return n;
}

function fromHundredths(value) {
  if (value > MAX_SAFE || value < -MAX_SAFE) throw Error(worldText('靈石數量超出安全範圍。'));
  // Each operation is performed in integer hundredths. Division is used only
  // at the existing storage API boundary, not to calculate the transaction.
  const result = Number(value) / 100;
  const roundTrip = decimal(result, {signed: true});
  if (roundTrip.numerator * 100n % roundTrip.denominator !== 0n || roundTrip.numerator * 100n / roundTrip.denominator !== value) throw Error(worldText('靈石數量超出安全精度範圍。'));
  return result;
}

export function legacyWalletAmount(value, {zero = true, max = SPIRIT_MAX, signed = false} = {}) {
  const n = legacyHundredths(value, {signed, max});
  if (!zero && n === 0n) throw Error(worldText('靈石數量須大於零。'));
  return fromHundredths(n);
}

/** Exact arithmetic for both integer new payments and unmodified old tails. */
export function addWalletAmount(left, right, {max = SPIRIT_MAX, signed = true} = {}) {
  const n = legacyHundredths(left, {signed: true, max}) + legacyHundredths(right, {signed: true, max});
  if (n > BigInt(max) * 100n || n < (signed ? -BigInt(max) * 100n : 0n)) throw Error(worldText('靈石數量超出允許範圍。'));
  return fromHundredths(n);
}

export function splitSpiritAmount(value) {
  const n = parseSpiritAmount(value);
  return {supreme: Math.floor(n / SPIRIT_UNITS.supreme), middle: Math.floor(n % SPIRIT_UNITS.supreme / SPIRIT_UNITS.middle), lower: n % SPIRIT_UNITS.middle};
}

/** Read-only formatting accepts old exact two-decimal tails without silently
 * rounding them up, spending them or introducing a fourth currency grade.
 */
export function formatSpiritAmount(value, {compact = true, legacyNote = false, worldMode = getWorldMode()} = {}) {
  let n;
  try { n = legacyHundredths(value, {signed: true}); } catch { return worldText('未知靈石'); }
  const negative = n < 0n;
  if (negative) n = -n;
  const whole = n / 100n, tail = n % 100n;
  const decimalTail = tail ? '.' + String(tail).padStart(2, '0').replace(/0$/, '') : '';
  let parts;
  const p=worldProfile(worldMode),unit=key=>(p.counts[key]||'')+p.labels[key];
  if (!compact || worldMode==='modern') parts = [`${whole}${decimalTail} ${unit('lower')}`];
  else {
    const high=BigInt(p.units.supreme),mid=BigInt(p.units.middle);
    const supreme = whole / high, middle = whole % high / mid, lower = whole % mid;
    parts = [];
    if (supreme) parts.push(`${supreme} ${unit('supreme')}`);
    if (middle) parts.push(`${middle} ${unit('middle')}`);
    if (lower || tail || !parts.length) parts.push(`${lower}${decimalTail} ${unit('lower')}`);
  }
  return (negative ? '−' : '') + parts.join(' · ') + (tail && legacyNote ? '（含舊帳尾數）' : '');
}

/** Explicit old denominations retain their numeric meaning during history replay. */
export function storyCurrencyMode(value){
 const text=String(value);
 return /靈石|灵石|極品|极品|中品|下品/.test(text)?'xianxia':/銀子|银子|金子|銅錢|铜钱|白銀|黃金/.test(text)?'ancient':/元|圓|圆/.test(text)?'modern':getWorldMode();
}
export function parseStoryAmount(value,options={}){
 return parseSpiritText(value,{...options,worldMode:storyCurrencyMode(value)});
}
