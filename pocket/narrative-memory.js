import {sourceScope} from './source-sync.js';

const KEY = 'tavern_pocket_narrative_memory_v1';
const LIMIT = 10000;
const clone = value => structuredClone(value);
const failure = (text, code = 'NARRATIVE_MEMORY') => Object.assign(new Error(text), {code});
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const eligible = message => message && (message.is_user === true || message.role === 'user') && !message.is_system && message.role !== 'system' && !message.extra?.tavern_pocket_activity && !message.extra?.tavern_pocket_status;
const fingerprint = event => JSON.stringify([event.acquisition, event.kind, event.name, event.description, event.price ?? null]);
const blank = value => value.replace(/[^\r\n]/g, ' ');

function safeProse(text) {
  let value = text
    .replace(/(`{3,}|~{3,})[^\r\n]*[\s\S]*?(?:\1|$)/g, blank)
    .replace(/<(?<tag>phone|pre|code|CSB_UPDATE)\b[^>]*>[\s\S]*?(?:<\/\k<tag>\s*>|$)/gi, blank)
    .replace(/<!--(?:[\s\S]*?-->|[\s\S]*$)/g, blank)
    .replace(/\[(CSB21|CSB2)_PANEL\][\s\S]*?(?:\[\/\1_PANEL\]|$)/g, blank)
    .replace(/^\s*>[^\r\n]*/gm, blank)
    .replace(/`[^`\r\n]*`/g, blank);
  const pairs = {'「':'」', '『':'』', '“':'”', '‘':'’', '"':'"', "'":"'"};
  let output = '', cursor = 0;
  for (let i = 0; i < value.length; i++) {
    const end = pairs[value[i]]; if (!end) continue;
    const close = value.indexOf(end, i + 1); if (close < 0) continue;
    const inner = value.slice(i + 1, close), before = value.slice(Math.max(0, i - 24), i);
    // A quoted item name belongs to a command; a quoted command is merely a quotation.
    const item = /(?:購買了|购买了|買下了|买下了|買到了|买到了|買了|买了|購得了?|购得了?|把|記住我的(?:能力|物品)[：:]|记住我的(?:能力|物品)[：:])\s*$/.test(before);
    if (!item && /萬寶商城|万宝商城|購買了|购买了|加入我的|記住我的|记住我的/.test(inner)) {
      output += value.slice(cursor, i) + blank(value.slice(i, close + 1)); cursor = close + 1;
    }
    i = close;
  }
  return output + value.slice(cursor);
}

const notActual = sentence => /如果|假如|假設|假设|要是|例如|舉例|举例|例子|示範|示范|示例|比如|\b(?:if|example)\b/i.test(sentence)
  || /(?:沒有|没有|還沒|还没|尚未|並未|并未|不曾|不會|不会|不要|沒|没|未曾).{0,16}(?:購買|购买|買|买|進入|进入|加入|記住|记住)/.test(sentence)
  || /我(?:只是)?(?:想要?|打算|準備|准备|計畫|计划|希望|可能|也許|也许|或許|或许).{0,60}(?:萬寶商城|万宝商城|購買|购买|買下|买下)/.test(sentence);

function ownShop(prefix) {
  const clauses = prefix.split(/[，,；;]/).map(part => part.trim()).filter(Boolean);
  const last = clauses.at(-1) || '';
  if (/^我(?:現在|现在|已經|已经|剛剛|刚刚|剛|刚|已|又)?(?:在|於|從|从|進入|进入|走進|走进|打開|打开|的|專屬的|专属的)?$/.test(last)) return true;
  if (!/^(?:(?:然後|然后|接著|接着|於是|于是|並|并|便|再)?(?:在|於|從|从|進入|进入|走進|走进|打開|打开)?)$/.test(last)) return false;
  for (const clause of clauses.slice(0, -1).reverse()) {
    const actor = /^(.{1,30}?)(?:打開|打开|開啟|开启|走進|走进|進入|进入)/.exec(clause);
    if (actor) return /^我(?:現在|现在|已經|已经|剛剛|刚刚|剛|刚|已|又)?$/.test(actor[1]);
  }
  return true; // An unqualified first-person user statement, e.g. 「於萬寶商城購買了…」.
}

function itemName(tail) {
  const value = tail.trim().replace(/^(?:一(?:個|个|件|項|项|種|种|份))\s*/, '');
  const quoted = /^[「『“"‘']([^」』”"’'\r\n]{1,80})[」』”"’']/.exec(value);
  const name = (quoted?.[1] || value.split(/[，,。；;！!？?…\r\n]/, 1)[0].split(/(?:然後|然后|接著|接着|並且|并且|用來|用来|用於|用于|於是|于是)/, 1)[0]).trim();
  if (!name || name.length > 80 || /[<>\[\]{}\u0000-\u001f]/.test(name) || /(?:購買|购买|加入我的|萬寶商城|万宝商城)/.test(name)) return '';
  return name;
}
const kindOf = name => /(?:能力|技能|法術|法术|異能|异能|天賦|天赋)$/.test(name) || /^(?:時間停止|时间停止|時間暫停|时间暂停|瞬間移動|瞬间移动|隱身術|隐身术|讀心術|读心术)$/.test(name) ? 'abilities' : 'items';
function explicitPrice(prefix) {
  const match = /(?:以|花費|花费|花了|支付)\s*[¥￥]?\s*(\d+(?:\.\d{1,2})?)\s*(?:元|圓|圆)?\s*$/.exec(prefix);
  if (!match) return undefined;
  const amount = Number(match[1]);
  return Number.isFinite(amount) && amount > 0 && amount <= 200000 ? amount : undefined;
}

/** Strict first-person acquisition instructions. This parser never performs a payment or model request. */
export function parseNarrativeAcquisitions(text, {isUser = false, messageKey = '', mirrored = false} = {}) {
  const out = {events: [], errors: []};
  if (!isUser || mirrored || typeof text !== 'string') return out;
  if (text.length > 2_000_000) return {events: [], errors: [{message: '正文過長，未自動記錄取得內容。'}]};
  const prose = safeProse(text);
  const add = (name, kind, acquisition, price) => {
    if (!name) { out.errors.push({message: '無法確定取得的物品或能力名稱；請使用「名稱」引號。'}); return; }
    if (out.events.length >= 16) { out.errors.push({message: '單則正文最多自動記錄 16 項取得內容。'}); return; }
    const event = {id: `narrative:${messageKey}:${out.events.length}`, kind, name, description: price === undefined ? '正文取得／未記載價格。' : `正文取得／明示價格：¥${price.toFixed(2)}。`, acquisition};
    if (price !== undefined) event.price = price;
    out.events.push(event);
  };
  for (const sentence of prose.split(/[。！？!?\r\n]/)) {
    if (!sentence.trim() || notActual(sentence)) continue;
    for (const match of sentence.matchAll(/(?:記住|记住)我的(能力|物品)[：:]\s*([^\r\n]+)/g)) {
      const name = itemName(match[2]); add(name, match[1] === '能力' ? 'abilities' : 'items', 'remember');
    }
    for (const match of sentence.matchAll(/把\s*([「『“"‘'][^」』”"’'\r\n]+[」』”"’']|[^，,；;\r\n]{1,80}?)\s*加入我的(能力|物品|道具|背包)/g)) {
      add(itemName(match[1]), match[2] === '能力' ? 'abilities' : 'items', 'remember');
    }
    for (const match of sentence.matchAll(/購買了|购买了|買下了|买下了|買到了|买到了|買了|买了|購得了?|购得了?/g)) {
      const before = sentence.slice(0, match.index), shop = /萬寶商城|万宝商城/g;
      const shops = [...before.matchAll(shop)], lastShop = shops.at(-1);
      if (!lastShop || !ownShop(before.slice(0, lastShop.index))) continue;
      // A third party's purchase after the user merely opened the shop is not the user's acquisition.
      const route = before.slice(lastShop.index + lastShop[0].length).trim();
      if (/(?:他|她|對方|对方|角色|NPC|npc|[\p{Script=Han}]{2,8})(?:就|便|已經|已经|又)?\s*$/u.test(route) && !/(?:我|我就|我便|我已經|我已经|我又)\s*$/.test(route) && !/(?:以|花費|花费|花了|支付)\s*[¥￥]?\d+(?:\.\d{1,2})?\s*(?:元|圓|圆)?\s*$/.test(route)) continue;
      const name = itemName(sentence.slice(match.index + match[0].length)), price = explicitPrice(before);
      add(name, kindOf(name), 'purchase', price);
    }
  }
  return out;
}

/** Acquisition callbacks MUST be idempotent by event.id: a saved pending record may resume after a crash. */
export function createNarrativeMemory({context, acquire, notice = () => {}}) {
  let disposed = false, queue = Promise.resolve();
  let last = {baseline: false, acquired: 0, skipped: 0, errors: []};
  const status = () => clone(last);
  function sync(options = {}) {
    const c = context(), scope = sourceScope(c), chat = c?.chat, metadata = c?.chatMetadata, owner = String(c?.name1 || '我');
    const current = () => !disposed && scope && context()?.chat === chat && context()?.chatMetadata === metadata && sourceScope(context()) === scope && String(context()?.name1 || '我') === owner;
    const check = () => { if (!current()) throw failure('對話已切換，正文取得同步已取消。', 'STALE'); };
    const run = async () => {
      const report = {baseline: false, acquired: 0, skipped: 0, errors: []};
      if (!scope) return last = report;
      check();
      if (!Array.isArray(chat) || chat.length > LIMIT) throw failure('目前對話超過正文取得同步上限，請先分拆或備份聊天。', 'LIMIT');
      if (typeof c.saveMetadata !== 'function' || typeof acquire !== 'function') throw failure('目前環境無法保存正文取得紀錄。', 'NOT_CONFIGURED');
      const save = async () => { check(); await c.saveMetadata(); check(); };
      const assigned = [];
      for (const message of chat.filter(eligible)) if (!message.extra?.tavern_pocket_narrative_id) {
        const id = message.extra?.tavern_pocket_source_id || crypto.randomUUID();
        message.extra ??= {}; message.extra.tavern_pocket_narrative_id = id; assigned.push({message, id});
      }
      if (assigned.length) {
        try { check(); await (c.saveChat || c.saveMetadata).call(c); check(); }
        catch (error) { for (const {message, id} of assigned) if (message.extra?.tavern_pocket_narrative_id === id) delete message.extra.tavern_pocket_narrative_id; throw error; }
      }
      const prior = metadata[KEY];
      if (prior && prior.version !== 1) throw failure('正文取得紀錄版本不相容，未修改舊資料。', 'VERSION');
      const state = prior?.scope === scope ? prior : (metadata[KEY] = {version: 1, scope, initialized: false, ignored: [], records: {}});
      if (!state.initialized || options.baseline === true) {
        const ignored = new Set(state.ignored || []), recordedMessages = new Set(Object.values(state.records).map(record => record.messageId));
        for (const message of chat.filter(eligible)) {
          const id = message.extra.tavern_pocket_narrative_id;
          if (!recordedMessages.has(id)) ignored.add(id);
        }
        if (ignored.size > LIMIT) throw failure('舊正文識別已達上限，請另開一段聊天繼續。', 'LIMIT');
        state.ignored = [...ignored]; state.initialized = true; await save();
        report.baseline = true; return last = report;
      }
      const ignored = new Set(state.ignored);
      let recordCount = Object.keys(state.records).length;
      for (const message of chat.filter(eligible)) {
        check();
        const messageId = message.extra.tavern_pocket_narrative_id;
        if (ignored.has(messageId)) continue;
        const raw = message.mes;
        const eventCurrent = () => current() && chat.includes(message) && message.extra?.tavern_pocket_narrative_id === messageId && message.mes === raw;
        const parsed = parseNarrativeAcquisitions(raw, {isUser: true, messageKey: messageId});
        report.errors.push(...parsed.errors.map(error => ({messageId, ...error})));
        for (const event of parsed.events) {
          check();
          const digest = fingerprint(event), record = own(state.records, event.id) ? state.records[event.id] : null;
          // Pending/error can mean the callback completed but its receipt did not save.
          // Never reuse that id for a different item or price, even before a done receipt exists.
          if (record && record.fingerprint !== digest) {
            report.skipped++;
            report.errors.push({id: event.id, messageId, message: `「${record.name}」已有取得紀錄；修改舊正文不會改成「${event.name}」或再次購買。請用新的訊息記錄新取得內容。`, code: record.status === 'done' ? 'COMMITTED_CHANGED' : 'RECORDED_CHANGED'});
            continue;
          }
          if (record?.status === 'done') {
            report.skipped++;
            continue;
          }
          if (record?.owner && record.owner !== owner) {
            report.skipped++; report.errors.push({id: event.id, messageId, message: '這項未完成取得屬於另一個使用者身分，沒有套用到目前身分。請以新的訊息重新指定。', code: 'PERSONA_CHANGED'}); continue;
          }
          if (record?.status === 'error' && record.fingerprint === digest && options.retryErrors !== true) {
            report.skipped++; report.errors.push({id: event.id, messageId, message: record.error, code: record.code || 'ACQUIRE_FAILED'}); continue;
          }
          if (!record && recordCount >= LIMIT) { report.errors.push({id: event.id, message: '取得紀錄已達上限，未執行新的取得。', code: 'LIMIT'}); continue; }
          if (!record) recordCount++;
          state.records[event.id] = {id: event.id, messageId, owner, name: event.name, fingerprint: digest, status: 'pending', at: Date.now()};
          await save();
          let completed = false;
          try {
            check();
            if (!eventCurrent()) throw failure('正文在取得前已變更，請重新同步。', 'SOURCE_CHANGED');
            await acquire(clone(event), {scope, isCurrent: eventCurrent}); check();
            completed = true;
            Object.assign(state.records[event.id], {status: 'done', at: Date.now()});
            await save(); report.acquired++;
          } catch (error) {
            if (!current()) throw error;
            if (completed) {
              report.acquired++;
              report.errors.push({id: event.id, messageId, message: '取得已完成，但正文紀錄暫時無法儲存；重新同步會沿用同一取得識別。', code: 'JOURNAL_SAVE_FAILED'});
              continue;
            }
            Object.assign(state.records[event.id], {status: 'error', error: String(error.message || error).slice(0, 500), code: error.code || 'ACQUIRE_FAILED'});
            await save(); report.errors.push({id: event.id, messageId, message: state.records[event.id].error, code: state.records[event.id].code});
          }
        }
      }
      last = report;
      if (report.errors.length) notice(report.errors[0].message);
      return status();
    };
    const task = queue.then(run); queue = task.catch(() => {}); return task;
  }
  return {sync, baseline: () => sync({baseline: true}), status, dispose() { disposed = true; }};
}
