import {safePhotoUrl} from '../core/photo-url.js';
import {legacyWalletAmount, parseSpiritText, SPIRIT_MAX} from '../core/currency.js';

/** Strict, side-effect-free narrative → phone protocol. Never guesses events from prose. */
export const PHONE_VERSION = '0.12.0';
export const PHONE_LIMITS = Object.freeze({message: 2_000_000, block: 100_000, events: 256, name: 40, text: 4000, longText: 20_000, members: 20, amount: SPIRIT_MAX});
const WX = new Set(['contact', 'message', 'group_message', 'group_create', 'photo', 'voice', 'location', 'pat', 'dice', 'transfer', 'redpacket', 'gift', 'recall']);
const IG = new Set(['post', 'story', 'dm', 'comment', 'like']);
const FORUM = new Set(['post', 'comment']);
const KINDS = new Set(['text', 'photo', 'voice', 'location', 'pat', 'dice']);
const COMMON = ['id', 'app', 'action', 'from'];
const ROUTE = ['to', 'group', 'members'];
const CONTROL = /[\u0000-\u001f\u007f]/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(message); };
function str(value, label, max, required = false, clean = false) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${label} 必須是非空字串，最多 ${max} 個字元。`);
  if (clean && CONTROL.test(value)) fail(`${label} 不可包含控制字元。`);
  return clean ? value.trim() : value;
}
function keys(input, allowed) {
  const valid = new Set(allowed);
  for (const key of Object.keys(input)) if (!valid.has(key)) fail(`此操作不支援欄位「${key}」。`);
}
export function safeImage(value) {
  const safe = safePhotoUrl(value);
  if (!safe) fail('image 必須是已知的 HTTP(S) 或安全站內圖片位址，不支援程式、文件或 API 路徑。');
  return safe;
}
/** Facts supplied by the story; no guessed measurements or free-form code. */
export function normalizeContactProfile(value) {
  if (!object(value)) fail('profile 必須是角色資料物件。');
  const limits = {age: 40, identity: 120, relation: 120, height: 40, weight: 40, build: 300, appearance: 1000};
  keys(value, Object.keys(limits));
  if (!Object.keys(value).length) fail('profile 至少要有一個已知欄位。');
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, str(field, `profile.${key}`, limits[key], true, true)]));
}
function amount(value) {
  // This parser also replays saved events. Preserve their exact original tails;
  // newly generated protocol amounts are integer lower-grade stones.
  if (typeof value === 'number') {
    try { return legacyWalletAmount(value, {zero: false, max: PHONE_LIMITS.amount}); } catch {}
  }
  fail(`amount 必須是大於 0 且不超過 ${PHONE_LIMITS.amount} 的下品靈石數字；新事件使用整數，舊事件最多保留兩位小數。`);
}

/**
 * Normalizes one event, throwing on unsupported actions/fields or impersonation.
 * `isUser: true` is only for caller-authenticated user chat messages and restricts
 * the sender to that user. `allowUser` permits user actors without changing the
 * schema; it must never be enabled for model output.
 */
export function normalizeEvent(input, options = {}) {
  if (!object(input)) fail('每個手機事件必須是 JSON 物件。');
  const name = (value, label, required = false) => {
    let result = str(value, label, PHONE_LIMITS.name, required, true);
    if (result === '{{user}}' && options.userName) result = str(options.userName, label, PHONE_LIMITS.name, true, true);
    if (result === '{{char}}' && options.characterName) result = str(options.characterName, label, PHONE_LIMITS.name, true, true);
    return result;
  };
  const event = {id: str(input.id, 'id', 128, true, true), app: str(input.app, 'app', 24, true, true), action: str(input.action, 'action', 32, true, true), from: name(input.from, 'from', true)};
  const isUserActor = actor => actor === '{{user}}' || actor === 'me' || (typeof options.userName === 'string' && actor === options.userName.trim());
  if (options.isUser === true) {
    if (!isUserActor(event.from)) fail('使用者訊息只能以使用者本人名義產生手機事件。');
  } else if (options.allowUser !== true && isUserActor(event.from)) fail('角色回覆不可代替使用者操作手機。');
  if (event.app === 'instagram' && event.action === 'message') event.action = 'dm'; // v0.1/v0.2 compatibility
  if (!(event.app === 'wechat' && WX.has(event.action)) && !(event.app === 'instagram' && IG.has(event.action)) && !(event.app === 'forum' && FORUM.has(event.action)) && !(event.app === 'diary' && event.action === 'entry')) fail('不支援的 app / action；錢包調整、購買、領款與退款只能從手機介面操作。');
  if (event.app === 'diary' && isUserActor(event.from)) fail('diary/entry 只用於角色日記；使用者私密日記請在手機內編輯。');

  if (event.app === 'wechat') {
    if (event.action === 'contact') {
      keys(input, [...COMMON, 'to', 'profile']);
      if (input.to !== undefined) event.to = name(input.to, 'to');
      if (event.to && !isUserActor(event.to)) fail('contact 的 to 只能是使用者；也可省略。');
      if (event.to === event.from) fail('不可向自己發送手機事件。');
      event.profile = normalizeContactProfile(input.profile);
      return event;
    }
    let kind = input.kind;
    if (kind !== undefined && !['message', 'group_message'].includes(event.action)) fail('kind 只適用於 message / group_message。');
    if (kind !== undefined && !KINDS.has(kind)) fail('不支援的訊息 kind。');
    if (event.action === 'message' && kind && kind !== 'text') event.action = kind;
    // Old image-only messages become a visible photo description. URLs are not
    // silently registered as native media assets or fetched by this parser.
    if (event.action === 'message' && input.image !== undefined && !input.text) event.action = 'photo';
    if (event.action === 'group_message') event.kind = kind || 'text';
    const contentKind = event.action === 'group_message' ? event.kind : event.action === 'message' ? 'text' : event.action;
    const allowed = [...COMMON, ...ROUTE, 'profile'];
    if (['message', 'group_message'].includes(input.action)) allowed.push('kind');
    if (['text', 'voice', 'photo', 'location', 'pat', 'dice', 'transfer', 'redpacket', 'gift'].includes(contentKind)) allowed.push('text');
    if (['text', 'photo'].includes(contentKind)) allowed.push('image');
    if (contentKind === 'photo') allowed.push('imagePrompt');
    if (['text', 'voice'].includes(contentKind)) allowed.push('quote');
    if (contentKind === 'voice') allowed.push('translation', 'emotion');
    if (contentKind === 'location') allowed.push('detail');
    if (contentKind === 'pat') allowed.push('target');
    if (contentKind === 'dice') allowed.push('value');
    if (['transfer', 'redpacket'].includes(contentKind)) allowed.push('amount');
    if (contentKind === 'gift') allowed.push('title', 'emoji');
    if (contentKind === 'recall') allowed.push('ref');
    keys(input, allowed);
    if (input.profile !== undefined) event.profile = normalizeContactProfile(input.profile);
    if (input.to !== undefined) event.to = name(input.to, 'to');
    if (input.group !== undefined) event.group = name(input.group, 'group');
    if (input.members !== undefined) {
      if (!Array.isArray(input.members) || input.members.length < 2 || input.members.length > PHONE_LIMITS.members) fail('members 必須是 2 至 20 位角色的姓名陣列。');
      event.members = [...new Set(input.members.map(m => name(m, 'members', true)))];
      if (event.members.length < 2) fail('members 至少要有兩位不同的角色。');
      if (event.members.some(isUserActor)) fail('members 僅列出角色與 NPC；使用者會由手機自動加入。');
    }
    if (['group_create', 'group_message'].includes(event.action) && !event.group) fail(`${event.action} 必須提供 group 群組名稱。`);
    if (event.action === 'group_create' && !event.members) fail('group_create 必須提供 members。');
    if (!event.group && event.members) fail('members 必須同時提供 group。');
    if (!event.group && event.action !== 'recall' && !event.to) fail('私訊必須提供 to 收件者。');
    if (event.group && event.to) fail('群訊只使用 group，不使用 to。');
    if (event.to === event.from) fail('不可向自己發送手機事件。');
    if (input.text !== undefined) event.text = str(input.text, 'text', PHONE_LIMITS.text);
    if (input.image !== undefined) event.image = safeImage(input.image);
    if (input.imagePrompt !== undefined) event.imagePrompt = str(input.imagePrompt, 'imagePrompt', 4000, true);
    if (contentKind === 'photo' && !event.text && event.image) event.text = `圖片：${event.image}`;
    if (['text', 'voice', 'location', 'photo'].includes(contentKind) && !event.text && !event.image) fail(`${contentKind} 必須提供 text。`);
    if (input.quote !== undefined) {
      if (!object(input.quote)) fail('quote 必須是 {from,text} 物件。');
      keys(input.quote, ['from', 'text']);
      event.quote = {from: name(input.quote.from, 'quote.from', true), text: str(input.quote.text, 'quote.text', 200, true)};
    }
    for (const [key, limit] of [['translation', 4000], ['emotion', 100], ['detail', 200]]) if (input[key] !== undefined) event[key] = str(input[key], key, limit);
    if (contentKind === 'pat') event.target = name(input.target ?? input.to ?? '{{user}}', 'target', true);
    if (contentKind === 'dice') {
      const value = input.value ?? (typeof input.text === 'string' && /^[1-6]$/.test(input.text) ? Number(input.text) : undefined);
      if (!Number.isInteger(value) || value < 1 || value > 6) fail('骰子的 value 必須是 1 至 6 的整數。');
      event.value = value; event.text = String(value);
    }
    if (['transfer', 'redpacket'].includes(contentKind)) {
      if (event.group) fail('正文財務卡片僅支援一對一收款；群聊付款請使用手機原生介面。');
      event.amount = amount(input.amount);
    }
    if (contentKind === 'gift') {
      event.title = str(input.title, 'title', 20, true, true);
      if (input.emoji !== undefined) event.emoji = str(input.emoji, 'emoji', 16, true, true);
    }
    if (contentKind === 'recall') event.ref = str(input.ref, 'ref', 128, true, true);
    return event;
  }

  const fields = event.app === 'diary' ? ['text', 'title']
    : event.app === 'forum' ? (event.action === 'post' ? ['text', 'title', 'board', 'image'] : ['ref', 'text'])
    : ['post', 'story'].includes(event.action) ? ['text', 'image', 'title', 'imagePrompt']
    : event.action === 'dm' ? ['to', 'text', 'image', 'storyId']
    : event.action === 'comment' ? ['ref', 'text'] : ['ref'];
  keys(input, [...COMMON, ...fields]);
  if (fields.includes('to')) event.to = name(input.to, 'to', true);
  if (event.to === event.from) fail('不可向自己發送手機事件。');
  if (fields.includes('ref')) event.ref = str(input.ref, 'ref', 128, true, true);
  if (input.text !== undefined) event.text = str(input.text, 'text', PHONE_LIMITS.longText);
  if (input.title !== undefined) event.title = str(input.title, 'title', 256);
  if (input.board !== undefined) event.board = str(input.board, 'board', 80, true, true);
  if (input.storyId !== undefined) event.storyId = str(input.storyId, 'storyId', 128, true, true);
  if (input.imagePrompt !== undefined) event.imagePrompt = str(input.imagePrompt, 'imagePrompt', 4000, true);
  if (input.image !== undefined) event.image = safeImage(input.image);
  if (['entry', 'comment'].includes(event.action)) str(event.text, 'text', PHONE_LIMITS.longText, true);
  if (['post', 'story', 'dm'].includes(event.action) && !event.text && !event.image) fail(`${event.action} 必須提供 text 或 image。`);
  return event;
}

/** Parse complete blocks only; streaming fragments and ordinary narrative stay untouched. */
export function parsePhoneEvents(text, options = {}) {
  const events = [], errors = [], matches = [];
  const result = () => options.withPositions === true ? {events,errors,matches} : {events,errors};
  if (typeof text !== 'string') return result();
  if (text.length > PHONE_LIMITS.message) { errors.push({blockIndex:-1,message:'訊息超過手機解析上限。'});return result(); }
  // A status field may quote phone syntax; it is data, never an action.
  const source = text.replace(/<CSB_UPDATE>[\s\S]*?(?:<\/CSB_UPDATE>|$)/g, block => block.replace(/[^\r\n]/g, ' '));
  let blockIndex = 0, seen = 0;
  for (const match of source.matchAll(/<phone>([\s\S]*?)<\/phone>/g)) {
    const at = blockIndex++;
    if (match[1].length > PHONE_LIMITS.block) { errors.push({blockIndex: at, message: '手機區塊超過長度上限。'}); continue; }
    let parsed;
    try { parsed = JSON.parse(match[1]); } catch { errors.push({blockIndex: at, message: '手機區塊不是有效 JSON。'}); continue; }
    const values = Array.isArray(parsed) ? parsed : [parsed];
    if (!values.length) { errors.push({blockIndex: at, message: '手機事件陣列不可為空。'}); continue; }
    if (seen + values.length > PHONE_LIMITS.events) { errors.push({blockIndex: at, message: `單則訊息最多 ${PHONE_LIMITS.events} 個手機事件。`}); break; }
    seen += values.length;
    for (const [eventIndex, value] of values.entries()) {
      try {
        const event=normalizeEvent(value,options);events.push(event);
        if(options.withPositions===true)matches.push({start:match.index,end:match.index+match[0].length,blockIndex:at,eventIndex,event});
      }
      catch (error) { errors.push({blockIndex: at, eventIndex, message: String(error?.message || error)}); }
    }
  }
  return result();
}

export function stripPhoneBlocks(text) { return String(text ?? '').replace(/<phone>[\s\S]*?<\/phone>/g, ''); }
export function encodePhoneEvents(events, options = {}) {
  const values = Array.isArray(events) ? events : [events];
  if (!values.length || values.length > PHONE_LIMITS.events) fail('手機事件數量無效。');
  const valid = values.map(event => normalizeEvent(event, options));
  const json = JSON.stringify(Array.isArray(events) ? valid : valid[0]).replace(/</g, '\\u003c');
  if (json.length > PHONE_LIMITS.block) fail('手機區塊超過長度上限。');
  return `<phone>${json}</phone>`;
}

const commandHash = value => {
  let a = 2166136261, b = 5381;
  for (const c of String(value)) { const n = c.codePointAt(0); a = Math.imul(a ^ n, 16777619); b = Math.imul(b, 33) ^ n; }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
};
/** Protected spans keep examples in code, HTML and quoted prose inert. */
function protectedCommandSpans(source) {
  const spans = [], add = (start,end) => spans.push({start,end});
  const quotes={'「':'」','『':'』','“':'”','"':'"'},quoteStack=[];
  for(let at=0;at<source.length;at++) {
    const c=source[at];if(c==='\\'){at++;continue;}
    if(quoteStack.length&&c===quoteStack.at(-1).close){const open=quoteStack.pop();add(open.start,at+1);}
    else if(Object.hasOwn(quotes,c))quoteStack.push({start:at,close:quotes[c]});
  }
  for(const open of quoteStack)add(open.start,source.length);
  const quoted=[...spans].sort((a,b)=>a.start-b.start||b.end-a.end);let quoteIndex=0;
  for (const match of source.matchAll(/<!--(?:[\s\S]*?)(?:-->|(?![\s\S]))|\[(CSB21_PANEL|CSB2_PANEL)\][\s\S]*?(?:\[\/\1\]|(?![\s\S]))|^[ \t]*>[^\n]*(?:\n|$)/gm)) add(match.index,match.index+match[0].length);
  // HTML containers (including phone blocks) are data, not natural commands.
  const stack=[];
  for(const match of source.matchAll(/<\/?([A-Za-z][\w:-]*)\b[^>]*>/g)) {
    while(quoted[quoteIndex]&&quoted[quoteIndex].end<=match.index)quoteIndex++;
    if(quoted[quoteIndex]?.start<=match.index&&match.index<quoted[quoteIndex].end)continue;
    const tag=match[1].toLowerCase(), closing=match[0].startsWith('</');
    if(closing) { const index=stack.map(x=>x.tag).lastIndexOf(tag);if(index>=0){const first=stack[index];stack.splice(index);add(first.start,match.index+match[0].length);}else add(match.index,match.index+match[0].length); }
    else if(/\/>$/.test(match[0])||['br','hr','img','input','meta','link','wbr','source','area','base','col','embed','param','track'].includes(tag)) add(match.index,match.index+match[0].length);
    else stack.push({tag,start:match.index});
  }
  for(const open of stack)add(open.start,source.length);
  let fence=null,offset=0;
  for(const line of source.split(/(?<=\n)/)) {
    const marker=/^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
    if(marker){if(!fence)fence={start:offset,char:marker[1][0],length:marker[1].length};else if(marker[1][0]===fence.char&&marker[1].length>=fence.length){add(fence.start,offset+line.length);fence=null;}}
    offset+=line.length;
  }
  if(fence)add(fence.start,source.length);
  for(const match of source.matchAll(/(`+)[^`]*?\1/g))add(match.index,match.index+match[0].length);
  spans.sort((a,b)=>a.start-b.start||a.end-b.end);
  const merged=[];for(const span of spans){const last=merged.at(-1);if(last&&span.start<=last.end)last.end=Math.max(last.end,span.end);else merged.push({...span});}
  return merged;
}
function readCommandQuote(source, at) {
  const pairs={'「':'」','『':'』','“':'”','"':'"'};
  if(!Object.hasOwn(pairs,source[at]))return null;
  const stack=[pairs[source[at]]],start=at;
  for(at++;at<source.length&&at-start<=PHONE_LIMITS.longText+2;at++) {
    const c=source[at];if(c==='\\'&&source[at+1]){at++;continue;}
    if(c===stack.at(-1)){stack.pop();if(!stack.length)return {text:source.slice(start+1,at),end:at+1};}
    else if(Object.hasOwn(pairs,c))stack.push(pairs[c]);
  }
  return null;
}
const inertPrefix = prefix => /例如|譬如|比如|舉例|举例|範例|范例|示例|例子|語法|语法|格式|示範|示范|如果|假如|假設|假设|倘若|萬一|万一|若是|可能會|可能会|打算|計畫|计划|準備要|准备要|考慮|考虑|想要|想著|想着|本來想|本来想|尚未|還沒|还没|沒有|没有|不會|不会|不打算|不要|別|别|勿|未曾|能否|要不要|可以|(?:說|说|說道|说道|問|问)[，,：:]\s*$/.test(prefix.replace(/沒有猶豫|没有犹豫/g,''));
/** Read a complete explicit denomination expression, then convert exactly once.
 * Bare numbers / 元 keep their old numeric payload and therefore their receipt
 * fingerprints. Delimiters before prose remain outside the event's source span.
 */
function readCommandAmount(source, start) {
  const tail = source.slice(start, start + 241);
  // Deliberately capture malformed numeric punctuation as well: a bad grouped
  // value such as 1,00下品 must fail as a whole, never become a transfer of 1.
  const term = /\d[\d.,]*[ \t]*(?:枚[ \t]*)?(?:極品|极品|中品|下品|靈石|灵石)(?:靈石|灵石)?/y;
  let match = term.exec(tail);
  if (match) {
    let end = term.lastIndex;
    while (end < tail.length) {
      const gap = /^[ \t、，,+]*/.exec(tail.slice(end))[0], next = end + gap.length;
      if (/\d/.test(tail[next] || '')) {
        term.lastIndex = next;
        match = term.exec(tail);
        if (!match) return null; // e.g. 1中品，2上品: do not import a partial sum.
        end = term.lastIndex;
      } else {
        if (/[、+]/.test(gap) || /^(?:極品|极品|上品|中品|下品|靈石|灵石)/.test(tail.slice(next))) return null;
        break;
      }
    }
    try { return {value: parseSpiritText(tail.slice(0, end), {zero: false, max: PHONE_LIMITS.amount}), end: start + end}; }
    catch { return null; }
  }
  const legacy = /^(\d+(?:\.\d{1,2})?)(?:[ \t]*元)?/.exec(tail.slice(0, 40));
  if (!legacy) return null;
  // Number only decodes the existing, bounded decimal syntax. The shared exact
  // validator in normalizeEvent checks precision / limits without rounding.
  return {value: Number(legacy[1]), end: start + legacy[0].length};
}
/** Explicit inline commands with quoted boundaries. `matches` preserves exact
 * source offsets; stable messageKey + occurrence IDs survive surrounding edits.
 */
function parseNaturalPhoneCommands(source, options = {}, roleOrigin = false) {
  const result={events:[],errors:[],matches:[]};
  if((roleOrigin?options.isUser!==false:options.isUser!==true)||typeof source!=='string'||source.length>PHONE_LIMITS.message)return result;
  const protectedSpans=protectedCommandSpans(source),messageKey=options.messageKey??source;
  const starts=/(千里傳音|千里传音|微信)(傳給|传给|轉帳給|轉賬給|转账给|紅包給|红包给)|(浮光錄|浮光录|Instagram|IG)(傳給|传给|私訊給|私信给|發限動|发限动|限時動態|限时动态|發文|发文|發帖|发帖)|(論道臺|論道台|论道台|论坛|論壇)(發文|发文|發帖|发帖|回覆|回复)/gi;
  let spanIndex=0,consumed=0,ordinal=0;
  for(const head of source.matchAll(starts)) {
    const appStart=head.index;if(appStart<consumed)continue;
    while(protectedSpans[spanIndex]&&protectedSpans[spanIndex].end<=appStart)spanIndex++;
    if(protectedSpans[spanIndex]?.start<=appStart&&appStart<protectedSpans[spanIndex].end)continue;
    const sentenceStart=Math.max(source.lastIndexOf('\n',appStart-1),source.lastIndexOf('。',appStart-1),source.lastIndexOf('！',appStart-1),source.lastIndexOf('？',appStart-1),consumed-1)+1;
    const prefix=source.slice(sentenceStart,appStart);
    if(inertPrefix(prefix.slice(-240)))continue;
    const app=head[1]?'wechat':head[3]?'instagram':'forum',verb=head[2]||head[4]||head[6];
    const money=/轉帳給|轉賬給|转账给|紅包給|红包给/.test(verb);
    const routed=money||/傳給|传给|私訊給|私信给|回覆|回复/.test(verb);
    let at=appStart+head[0].length,to;
    if(routed){const route=/^\s*([^：:\r\n，,。；;「」<>]{1,128}?)\s*[：:]/.exec(source.slice(at,at+160));if(!route)continue;to=route[1].trim();at+=route[0].length;}
    else {const colon=/^[ \t]*[：:]/.exec(source.slice(at,at+12));if(!colon)continue;at+=colon[0].length;}
    while(/[ \t]/.test(source[at]||'')&&at<source.length)at++;
    let event,end;
    if(money) {
      const parsedAmount=readCommandAmount(source,at);if(!parsedAmount)continue;
      at=parsedAmount.end;
      // Never accept a valid prefix of an invalid number or currency expression.
      if(/[\d.A-Za-z]/.test(source[at]||''))continue;
      while(/[ \t]/.test(source[at]||'')&&at<source.length)at++;
      const memo=readCommandQuote(source,at);
      if(/[「『“"]/.test(source[at]||'')&&!memo)continue;
      if(!memo&&at<source.length&&!/[\s，,。；;！!？?）)]/.test(source[at]))continue;
      end=memo?.end??at;event={app,action:/紅包|红包/.test(verb)?'redpacket':'transfer',to,amount:parsedAmount.value};
      if(memo?.text.trim())event.text=memo.text;
    }else{
      const content=readCommandQuote(source,at);if(!content)continue;end=content.end;
      const action=app==='wechat'?'message':/傳給|传给|私訊給|私信给/.test(verb)?'dm':/回覆|回复/.test(verb)?'comment':/限/.test(verb)?'story':'post';
      event={app,action,text:content.text};if(to)event[action==='comment'?'ref':'to']=to;
    }
    if(/^[ \t，,]*(?:(?:只是|僅是|仅是|是個|是个|作為|作为|僅供|仅供)[ \t]*)?(?:例子|範例|范例|示例|格式|假設|假设|不是真的|並未發送|并未发送)/.test(source.slice(end,end+70)))continue;
    let start=appStart,sender=roleOrigin?options.characterName||'{{char}}':options.userName||'{{user}}';
    const clauseStart=Math.max(sentenceStart,source.lastIndexOf('，',appStart-1)+1,source.lastIndexOf(',',appStart-1)+1,source.lastIndexOf('；',appStart-1)+1,source.lastIndexOf(';',appStart-1)+1,source.lastIndexOf('（',appStart-1)+1,source.lastIndexOf('(',appStart-1)+1);
    const originalClause=source.slice(clauseStart,appStart);
    const connector=/^\s*(?:(?:接著|接着|然後|然后|隨後|随后|最後|最后|於是|于是|接下來|接下来|並且|并且|而|又|再)\s*)+/.exec(originalClause)?.[0]||'';
    const clause=originalClause.slice(connector.length);
    const named=/^\s*([\p{L}\p{N}_·．. -]{1,40}?)(?:\s*(?:在|：|:)\s*)?$/u.exec(clause);
    const narrative=/拿|笑|說|说|傳來|传来|訊息|消息|手機|手机|玉符|接著|接着|然後|然后|隨後|随后|最後|最后|於是|于是|開啟|开启|打開|打开|操作|點擊|点击|輸入|输入|送出|傳送|发送|螢幕|屏幕|看見|看见|看著|看着|放下|外套|片刻|通知|低頭|低头/;
    if(named&&!narrative.test(named[1])) {
      const possible=named[1].trim();
      if(roleOrigin){sender=possible;start=clauseStart+connector.length+clause.indexOf(possible);}
      else if(possible!==sender&&!['我','本人'].includes(possible))continue;
    }else if(roleOrigin){
      // A known character name may follow a short prose connector without a comma.
      const candidates=[options.characterName,...(Array.isArray(options.roleNames)?options.roleNames:[])].filter(Boolean).sort((a,b)=>b.length-a.length);
      for(const name of candidates){const suffixes=[name,name+'在'];const suffix=suffixes.find(s=>clause.trimEnd().endsWith(s));if(suffix){sender=name;start=appStart-(clause.length-clause.trimEnd().length)-suffix.length;break;}}
    }
    try{
      if(roleOrigin){if(['我','你','您','本人','使用者','用户','用戶','user','me','{{user}}'].includes(sender)||sender===options.userName)fail('角色訊息不可冒充使用者發送手機操作。');if(['我','你','您','使用者'].includes(event.to))event.to=options.userName||'{{user}}';}
      const lineIndex=(source.slice(0,start).match(/\n/g)||[]).length;
      const lineStart=source.lastIndexOf('\n',start-1)+1,lineEnd=source.indexOf('\n',end);
      const standalone=!source.slice(lineStart,start).trim()&&!source.slice(end,lineEnd<0?source.length:lineEnd).trim();
      const suffix=options.legacyLineIds?(standalone?String(lineIndex):`inline-${ordinal}`):String(ordinal);
      const normalized=normalizeEvent({...event,id:`${roleOrigin?'rolecmd':'cmd'}-${commandHash(messageKey)}-${suffix}`,from:sender},{...options,isUser:!roleOrigin,allowUser:false});
      result.events.push(normalized);result.matches.push({start,end,lineIndex,occurrence:ordinal,event:normalized});ordinal++;consumed=end;
    }catch(error){result.errors.push({start,lineIndex:(source.slice(0,start).match(/\n/g)||[]).length,message:String(error?.message||error)});}
    if(result.events.length>=PHONE_LIMITS.events)break;
  }
  return result;
}

/** Authenticated user-side commands retain their original sender boundary. */
export function parseUserPhoneCommands(text, options = {}) { return parseNaturalPhoneCommands(text, options, false); }
/** Authenticated assistant-side commands use the reply's named character, never the user. */
export function parseRolePhoneCommands(text, options = {}) { return parseNaturalPhoneCommands(text, options, true); }
