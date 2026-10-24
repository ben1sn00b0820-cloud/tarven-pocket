// Phone chat history, kept in this browser (IndexedDB) and scoped to the tavern account like the other local data.
// Thread: {id, type:'dm'|'group', name, members:[name], unread, createdAt, updatedAt, messages:[Message]}
// Message: {id, from:'me'|name, kind, text, at, quote?:{from,text}} plus, by kind:
//   voice: translation, emotion · photo: photoId? (none when a contact describes a photo in words)
//   redpacket: amount, state:'sent'|'opened', openedBy? · transfer: amount, state:'sent'|'accepted'|'returned'
//   location: text = place, detail = address · pat: target (who was patted) · dice: text = 1..6
//   notice: text = what `from` did, with {对方} standing for `target` · recall: a withdrawn message · system: app notes
//   gift: gift:{name, emoji, price}, state:'sent'|'accepted'|'returned', openedBy? (a present; price 0 when a character sends it)
//   call: dir:'in'|'out' (from is who called), state:'answered'|'missed'|'declined'|'cancelled', duration (seconds),
//         lines:[{from, text, translation, emotion}] what was said, voicemail:[{text, translation, emotion}] a missed call's message
// list() returns threads without their messages, plus the last message for previews, pinned threads first.
// A thread can be pinned (置顶) or muted (免打扰: its unread messages do not count toward the app's badge).
// streak (聊天火花): days in a row, up to today or yesterday, on which both the user and the other side wrote.
import {connectionLost, lostError} from './idb.js';
import {safePhotoUrl} from './photo-url.js';
import {legacyWalletAmount, SPIRIT_MAX} from './currency.js';

export const CHAT_STORE_LIMITS = Object.freeze({messages: 1000, text: 4000, members: 20});
const KINDS = ['text', 'voice', 'photo', 'system', 'redpacket', 'transfer', 'location', 'pat', 'dice', 'notice', 'recall', 'call', 'gift'];
const CALL_STATES = ['answered', 'missed', 'declined', 'cancelled'];
const spoken = (list, max, withFrom) => (Array.isArray(list) ? list : []).slice(-max).filter(l => l && String(l.text || l.translation || '').trim()).map(l => ({...(withFrom ? {from: clip(l.from, 40).trim() || 'me'} : {}), text: clip(l.text || l.translation, 1000), translation: clip(l.translation || l.text, 1000), emotion: clip(l.emotion || 'calm', 100)}));
const STATES = {redpacket: ['sent', 'opened'], transfer: ['sent', 'accepted', 'returned'], gift: ['sent', 'accepted', 'returned']};
/** Canonical legacy-compatible storage string; lower-grade stones with up to two old decimal places. */
export function money(value) {
  try {
    const n = legacyWalletAmount(String(value ?? '').replace(/[¥￥,，\s元]/g, ''), {zero: false, max: SPIRIT_MAX});
    return n.toFixed(2);
  } catch { return null; }
}
const fail = (message, code = 'INVALID') => Object.assign(new Error(message), {code});
const clip = (value, max) => String(value ?? '').slice(0, max);
const sourceKey = source => `${source.scope}\n${source.id}`;
const sourceLocked = message => (['redpacket', 'transfer', 'gift'].includes(message.kind) && message.state !== 'sent') || message.source?.localRecall === true;

/** The photo attachment is deliberately outside the original narrative fingerprint. */
export function photoMessageFingerprint(message) {
  return JSON.stringify({id: message?.id, from: message?.from, kind: message?.kind, text: message?.text || '', image: message?.image || '', imagePrompt: message?.imagePrompt || '', source: message?.source || null, photoOverrides: message?.photoOverrides || null});
}

const photoTextLimits = {scene: 16000, artist: 10000, positive: 16000, negative: 16000, model: 100, presetId: 128, presetName: 200, prompt: 40000};
const photoParams = value => Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {}).filter(([key, v]) => ['model', 'width', 'height', 'steps', 'scale', 'sampler', 'schedule', 'seed', 'cfgRescale', 'variety'].includes(key) && ['string', 'number', 'boolean'].includes(typeof v)));
function cleanPhotoInput(value, snapshot = false) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, max] of Object.entries(photoTextLimits)) if (typeof value[key] === 'string' && (snapshot || !['presetName', 'prompt'].includes(key))) out[key] = clip(value[key], max);
  if (value.params && typeof value.params === 'object') out.params = photoParams(value.params);
  if (snapshot) { out.at = Number(value.at) || 0; if (value.photoId) out.photoId = clip(value.photoId, 512); if (Number.isFinite(value.seed)) out.seed = value.seed; }
  return out;
}

/** Edits only the selected message's generation input. The current displayed photo is retained. */
export function editPhotoMessage(message, overrides, {fingerprint, isCurrent = () => true} = {}) {
  if (!isCurrent()) throw fail('對話已切換，圖片提示詞沒有保存。', 'STALE');
  if (!message || message.kind !== 'photo') throw fail('這張照片訊息已不存在或已撤回。', 'MISSING');
  if (!fingerprint || photoMessageFingerprint(message) !== fingerprint) throw fail('照片內容已變更，請重新開啟圖片編輯器。', 'STALE');
  message.photoOverrides = cleanPhotoInput(overrides);
  if (message.photoAuto) message.photoAuto = {...message.photoAuto, state: message.photoId || message.image ? 'done' : 'error', error: message.photoId || message.image ? '' : '提示詞已變更，請點選重新生成。', code: 'EDITED', at: Date.now()};
  return message;
}

export function attachPhotoToMessage(message, photoId, {fingerprint, isCurrent = () => true, replace = false, generation, attemptId} = {}) {
  if (!isCurrent()) throw fail('對話已切換，照片沒有附加到千里傳音訊息。', 'STALE');
  if (!message || message.kind !== 'photo') throw fail('這張照片訊息已不存在或已撤回。', 'MISSING');
  if (!fingerprint || photoMessageFingerprint(message) !== fingerprint) throw fail('照片內容已變更，沒有覆蓋目前訊息。', 'STALE');
  if (typeof photoId !== 'string' || !photoId.trim() || photoId.length > 512) throw fail('照片識別無效');
  if (attemptId && message.photoAuto?.attemptId !== attemptId) throw fail('這張照片已有較新的生成工作。', 'STALE');
  if (!message.photoId || replace) {
    message.photoId = photoId;
    if (generation) message.photoGeneration = {...cleanPhotoInput(generation, true), photoId};
  }
  if (message.photoAuto) message.photoAuto = {...message.photoAuto, state: 'done', error: '', code: ''};
  return message;
}

export function markPhotoAttempt(message, patch, {fingerprint, isCurrent = () => true, onlyNew = false} = {}) {
  if (!isCurrent()) throw fail('對話已切換，照片狀態沒有套用。', 'STALE');
  if (!message || message.kind !== 'photo') throw fail('這張照片訊息已不存在或已撤回。', 'MISSING');
  if (!fingerprint || photoMessageFingerprint(message) !== fingerprint) throw fail('照片內容已變更。', 'STALE');
  if (onlyNew && message.photoAuto) throw fail('這張照片已安排過自動生成。', 'ALREADY_ATTEMPTED');
  if (patch.state === 'queued' && patch.attemptId && ['queued', 'generating'].includes(message.photoAuto?.state) && message.photoAuto?.attemptId && message.photoAuto.attemptId !== patch.attemptId) throw fail('這張照片正在生成，請稍候。', 'PHOTO_BUSY');
  if (patch.state !== 'queued' && patch.attemptId && message.photoAuto?.attemptId && message.photoAuto.attemptId !== patch.attemptId) throw fail('這張照片已有較新的生成工作。', 'STALE');
  message.photoAuto = {...(patch.attemptId ? {attemptId: clip(patch.attemptId, 100)} : {}), engine: 'nai', state: ['queued', 'generating', 'error', 'done'].includes(patch.state) ? patch.state : 'error', at: Number(patch.at) || Date.now(), error: clip(patch.error, 500), code: clip(patch.code, 60)};
  return message;
}

function cleanMessage(m, id, at) {
  if (!m || typeof m !== 'object') throw fail('消息格式无效');
  const kind = KINDS.includes(m.kind) ? m.kind : 'text';
  const from = clip(m.from, 40).trim();
  if (!from) throw fail('消息缺少发送人');
  const out = {id, from, kind, text: clip(m.text, CHAT_STORE_LIMITS.text), at};
  // A payment key survives backup/restore and retries. Narrative origins are
  // metadata, never interpreted as executable content or a wallet mutation.
  if (m.paymentId) out.paymentId = clip(m.paymentId, 240);
  if (m.source && typeof m.source === 'object' && m.source.scope && m.source.id) {
    out.source = {scope: clip(m.source.scope, 1024), id: clip(m.source.id, 128), message: clip(m.source.message, 300), route: clip(m.source.route, 200), fingerprint: clip(m.source.fingerprint, 20000)};
    if (m.source.localRecall) out.source.localRecall = true;
    if (m.source.stale) { out.source.stale = true; out.source.reason = clip(m.source.reason, 200); }
  }
  if (kind === 'voice') { out.translation = clip(m.translation, CHAT_STORE_LIMITS.text); out.emotion = clip(m.emotion, 100); }
  if (kind === 'photo') {
    if (m.photoId) out.photoId = clip(m.photoId, 512);
    const image = safePhotoUrl(m.image);
    if (image) out.image = image;
    if (m.imagePrompt) out.imagePrompt = clip(m.imagePrompt, 4000);
    if (m.photoOverrides && typeof m.photoOverrides === 'object') out.photoOverrides = cleanPhotoInput(m.photoOverrides);
    if (m.photoGeneration && typeof m.photoGeneration === 'object') out.photoGeneration = cleanPhotoInput(m.photoGeneration, true);
    if (m.photoAuto && typeof m.photoAuto === 'object') out.photoAuto = {...(m.photoAuto.attemptId ? {attemptId: clip(m.photoAuto.attemptId, 100)} : {}), engine: 'nai', state: ['queued', 'generating', 'error', 'done'].includes(m.photoAuto.state) ? m.photoAuto.state : 'error', at: Number(m.photoAuto.at) || at, error: clip(m.photoAuto.error, 500), code: clip(m.photoAuto.code, 60)};
  }
  if (kind === 'gift') {
    const g = m.gift && typeof m.gift === 'object' ? m.gift : {};
    out.gift = {name: clip(g.name, 20).trim(), emoji: [...clip(g.emoji, 16).trim()].slice(0, 2).join('') || '🎁', price: legacyWalletAmount(g.price ?? 0)};
    if (!out.gift.name) throw fail('礼物缺少名字');
  }
  if (STATES[kind]) {
    if (kind !== 'gift') { out.amount = money(m.amount); if (!out.amount) throw fail('金额无效'); }
    out.state = STATES[kind].includes(m.state) ? m.state : 'sent';
    if (m.openedBy) out.openedBy = clip(m.openedBy, 40);
  }
  if (kind === 'location') out.detail = clip(m.detail, 200);
  if (kind === 'pat' || kind === 'notice') out.target = clip(m.target, 40).trim() || 'me';
  if (kind === 'dice') out.text = String(Math.min(6, Math.max(1, Math.round(Number(m.text)) || 1)));
  if (kind === 'recall') out.text = '';
  if (kind === 'call') {
    out.dir = m.dir === 'out' ? 'out' : 'in';
    out.state = CALL_STATES.includes(m.state) ? m.state : 'missed';
    out.duration = Math.max(0, Math.min(86400, Math.round(Number(m.duration) || 0)));
    out.lines = spoken(m.lines, 80, true);
    out.voicemail = spoken(m.voicemail, 4, false);
  }
  if (m.quote?.text && ['text', 'voice'].includes(kind)) out.quote = {from: clip(m.quote.from, 40), text: clip(m.quote.text, 200)};
  const textless = ['photo', 'system', 'redpacket', 'transfer', 'pat', 'dice', 'recall', 'call', 'gift'];
  if (!textless.includes(kind) && !out.text.trim()) throw fail('消息内容为空');
  return out;
}

/** Pure reconciliation used by the IDB transaction and deterministic tests.
 * Only messages carrying this originScope are replaceable. Ordinary phone
 * messages, wallet records and other narrative scopes are never replayed.
 */
export function reconcileSourceSnapshot(inputRows, inputRecords, originScope, bundles, {accountScope = '', space = '', now = Date.now(), id = () => crypto.randomUUID()} = {}) {
  if (typeof originScope !== 'string' || !originScope || originScope.length > 1024) throw fail('正文來源識別無效');
  if (!Array.isArray(bundles) || bundles.length > 1000) throw fail('正文聊天數量超過上限');
  const rows = structuredClone(inputRows), records = new Map(inputRecords.map(r => [r.key, structuredClone(r)]));
  const desired = new Map(), existing = new Map();
  const result = {added: 0, changed: 0, removed: 0, retained: 0, hidden: 0};
  bundles = bundles.map(bundle => {
    const members = [...new Set((bundle.members || []).map(m => clip(m, 40).trim()).filter(Boolean))].slice(0, CHAT_STORE_LIMITS.members);
    if (!members.length || (bundle.type === 'group' && members.length < 2)) throw fail('正文聊天對象無效');
    return {...bundle, members};
  });
  for (const bundle of bundles) for (const entry of (bundle.messages || []).slice(-CHAT_STORE_LIMITS.messages)) {
    const eventId = clip(entry.eventId, 128);
    if (!eventId) throw fail('正文訊息缺少事件 ID');
    const source = {scope: originScope, id: eventId, message: clip(entry.sourceMessage, 300), route: clip(bundle.key, 200)};
    const key = sourceKey(source);
    if (desired.has(key)) throw fail('正文事件 ID 重複');
    const message = cleanMessage(entry.message, 'pending', Number.isFinite(entry.at) ? entry.at : now);
    const {id: unusedId, at: unusedAt, ...content} = message;
    source.fingerprint = JSON.stringify(content);
    message.source = source;
    desired.set(key, {message, bundle});
  }
  for (const row of rows) for (const message of row.messages) if (message.source?.scope === originScope) existing.set(sourceKey(message.source), {row, message});
  // First remove or retain all old source messages; new content is placed below.
  for (const row of rows) {
    row.messages = row.messages.filter(message => {
      if (message.source?.scope !== originScope) return true;
      const key = sourceKey(message.source), want = desired.get(key);
      if (!want && sourceLocked(message)) {
        if (!message.source.stale) result.retained++;
        message.source.stale = true; message.source.reason = '正文來源已刪除，已處理的訊息與交易保留。';
        records.set(key, {scope: accountScope, key, threadId: row.id, message: structuredClone(message), hidden: false});
        return true;
      }
      if (!want) result.removed++;
      return false;
    });
  }
  for (const [key, {message: proposed, bundle}] of desired) {
    const record = records.get(key), old = existing.get(key);
    if (record?.hidden) { result.hidden++; continue; }
    const prior = old?.message || record?.message;
    let message, row;
    const unchanged = prior?.source?.fingerprint === proposed.source.fingerprint && prior?.source?.route === proposed.source.route;
    if (prior && (unchanged || sourceLocked(prior))) {
      message = structuredClone(prior);
      if (unchanged) { delete message.source.stale; delete message.source.reason; }
      else {
        if (!message.source.stale) result.retained++;
        message.source.stale = true; message.source.reason = '正文來源已變更，已處理的訊息與交易保留。';
      }
      row = old?.row || rows.find(r => r.id === record?.threadId);
    } else {
      message = {...proposed, id: prior?.id || id(), at: prior?.at ?? proposed.at};
      // Caption-only narrative edits must not discard a user-edited image when the actual image input is unchanged.
      const samePhotoInput = prior?.kind === 'photo' && proposed.kind === 'photo' && prior.from === proposed.from && prior.source?.route === proposed.source.route && (prior.image || '') === (proposed.image || '') && (prior.imagePrompt || prior.text || '') === (proposed.imagePrompt || proposed.text || '');
      if (samePhotoInput) for (const field of ['photoId', 'photoAuto', 'photoOverrides', 'photoGeneration']) if (prior[field] !== undefined) message[field] = structuredClone(prior[field]);
      if (prior) result.changed++; else result.added++;
    }
    if (!row) row = rows.find(r => (r.space || '') === (space || '') && r.type === (bundle.type === 'group' ? 'group' : 'dm') && (r.type === 'group' ? r.name === bundle.name : r.members[0] === bundle.members[0]));
    if (!row) {
      row = {scope: accountScope, id: id(), type: bundle.type === 'group' ? 'group' : 'dm', name: clip(bundle.name, 40).trim() || bundle.members[0], members: [...bundle.members], unread: 0, createdAt: now, updatedAt: now, messages: [], ...(space ? {space} : {})};
      rows.push(row);
    }
    if (row.type === 'group') row.members = [...new Set([...row.members, ...bundle.members])].slice(0, CHAT_STORE_LIMITS.members);
    row.messages.push(message);
    if (!prior && message.from !== 'me' && !['system', 'notice', 'recall'].includes(message.kind)) row.unread++;
    if (!prior || !unchanged) row.updatedAt = now;
    records.set(key, {scope: accountScope, key, threadId: row.id, message: structuredClone(message), hidden: false});
  }
  for (const row of rows) {
    row.messages.sort((a, b) => a.at - b.at);
    row.messages = row.messages.slice(-CHAT_STORE_LIMITS.messages);
    row.unread = Math.min(row.unread || 0, row.messages.length);
  }
  return {rows, records: [...records.values()], ...result};
}

export class ChatStore {
  #scope; #factory; #now; #id; #db = null; #opening = null; #closed = false;
  constructor(scope, {indexedDB = globalThis.indexedDB, now = Date.now, id = () => globalThis.crypto.randomUUID()} = {}) {
    this.#scope = String(scope); this.#factory = indexedDB; this.#now = now; this.#id = id;
  }
  async #open() {
    if (this.#closed) throw fail('聊天记录已关闭', 'CLOSED');
    if (this.#db) return this.#db;
    if (!this.#factory?.open) throw fail('浏览器不支持本地保存聊天记录，请检查存储权限', 'STORAGE_UNAVAILABLE');
    this.#opening ||= new Promise((resolve, reject) => {
      const req = this.#factory.open('st-iphonie-chats-v1', 2);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('threads')) { const store = req.result.createObjectStore('threads', {keyPath: ['scope', 'id']}); store.createIndex('scope', 'scope'); }
        // Tombstones prevent a deleted imported message from reappearing on
        // every narrative render. Settled snapshots also survive source edits.
        if (!req.result.objectStoreNames.contains('sourceRecords')) { const store = req.result.createObjectStore('sourceRecords', {keyPath: ['scope', 'key']}); store.createIndex('scope', 'scope'); }
      };
      req.onerror = () => reject(fail('无法打开聊天记录，请检查浏览器的存储权限', 'STORAGE_UNAVAILABLE'));
      req.onblocked = () => reject(fail('另一个页面占用了聊天记录，请关闭旧页面后重试', 'STORAGE_BLOCKED'));
      req.onsuccess = () => {
        if (this.#closed) { req.result.close(); reject(fail('聊天记录已关闭', 'CLOSED')); return; }
        this.#db = req.result;
        const db = this.#db;
        db.onversionchange = () => { db.close(); if (this.#db === db) this.#db = null; };
        db.onclose = () => { if (this.#db === db) this.#db = null; };
        resolve(db);
      };
    }).finally(() => { this.#opening = null; });
    return this.#opening;
  }
  // A dropped connection (iPhone Safari after the page sat in the background) is reopened once; nothing was written.
  async #tx(mode, work, again = true) {
    const db = await this.#open();
    try {
      return await new Promise((resolve, reject) => {
        let result, own, tx;
        try { tx = db.transaction(['threads', 'sourceRecords'], mode); } catch (error) { reject(this.#closed ? fail('聊天记录已关闭', 'CLOSED') : lostError(error)); return; }
        const store = tx.objectStore('threads');
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(own || (connectionLost(tx.error) ? lostError(tx.error) : fail(tx.error?.name === 'QuotaExceededError' ? '设备存储空间不足，聊天没有保存' : '聊天记录没有保存，请重试', 'STORAGE')));
        work(store, value => { result = value; }, error => { own = error; tx.abort(); }, tx.objectStore('sourceRecords'));
      });
    } catch (error) {
      if (error?.code !== 'STORAGE_LOST' || this.#closed) throw error;
      if (this.#db === db) { try { db.close(); } catch {} this.#db = null; }
      if (again) return this.#tx(mode, work, false);
      throw error;
    }
  }
  #get(store, id, then) {
    const req = store.get([this.#scope, String(id)]);
    req.onsuccess = () => then(req.result || null);
  }
  #public(row, full = true) {
    if (!row) return null;
    const {scope, messages, ...rest} = row;
    const base = {pinned: false, muted: false, ...rest};
    return full ? structuredClone({...base, messages}) : structuredClone({...base, count: messages.length, last: messages.filter(m => m.kind !== 'system').at(-1) || null, streak: this.#streak(messages)});
  }
  #streak(messages) {
    const day = at => { const d = new Date(at); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
    const mine = new Set(), theirs = new Set();
    for (const m of messages) if (!['system', 'notice', 'recall'].includes(m.kind)) (m.from === 'me' ? mine : theirs).add(day(m.at));
    const both = [...mine].filter(d => theirs.has(d)).sort((a, b) => b - a);
    const today = day(this.#now()), DAY = 86400000;
    if (!both.length || today - both[0] > DAY) return 0;
    let n = 1;
    while (n < both.length && both[n - 1] - both[n] <= DAY + 3600000 && both[n - 1] - both[n] >= DAY - 3600000) n++;
    return n;
  }

  async list() {
    const rows = await this.#tx('readonly', (store, done) => { const req = store.index('scope').getAll(this.#scope); req.onsuccess = () => done(req.result); });
    return rows.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt).map(row => this.#public(row, false));
  }
  async get(id) {
    return this.#tx('readonly', (store, done) => this.#get(store, id, row => done(this.#public(row))));
  }
  async create({type = 'dm', name = '', members = [], space = ''} = {}) {
    const list = [...new Set((Array.isArray(members) ? members : []).map(m => clip(m, 40).trim()).filter(Boolean))];
    if (!list.length) throw fail('请选择聊天对象');
    if (list.length > CHAT_STORE_LIMITS.members) throw fail('群聊最多 20 人');
    if (type === 'group' && list.length < 2) throw fail('群聊至少要选两个人');
    const now = this.#now(), row = {scope: this.#scope, id: this.#id(), type: type === 'group' ? 'group' : 'dm', name: clip(name, 40).trim() || (type === 'group' ? list.join('、').slice(0, 40) : list[0]), members: type === 'group' ? list : [list[0]], unread: 0, createdAt: now, updatedAt: now, messages: [], ...(space ? {space: clip(space, 300)} : {})};
    await this.#tx('readwrite', (store, done) => { store.put(row); done(); });
    return this.#public(row);
  }
  async #change(id, change) {
    return this.#tx('readwrite', (store, done, abort, records) => this.#get(store, id, row => {
      if (!row) { abort(fail('这段聊天已不存在', 'MISSING')); return; }
      try { change(row, records); } catch (error) { abort(error); return; }
      if (row.messages.length > CHAT_STORE_LIMITS.messages) row.messages = row.messages.slice(-CHAT_STORE_LIMITS.messages);
      for (const m of row.messages) if (m.source) this.#remember(records, row.id, m);
      store.put(row);
      done(this.#public(row));
    }));
  }
  #remember(records, threadId, message, hidden = false) {
    if (!message.source) return;
    records.put({scope: this.#scope, key: sourceKey(message.source), threadId, ...(hidden ? {} : {message: structuredClone(message)}), hidden});
  }
  async update(id, {name, members, pinned, muted} = {}) {
    return this.#change(id, row => {
      if (pinned !== undefined) row.pinned = pinned === true;
      if (muted !== undefined) row.muted = muted === true;
      if (name !== undefined) row.name = clip(name, 40).trim() || row.name;
      if (members !== undefined && row.type === 'group') {
        const list = [...new Set(members.map(m => clip(m, 40).trim()).filter(Boolean))];
        if (list.length < 2) throw fail('群聊至少要选两个人');
        row.members = list.slice(0, CHAT_STORE_LIMITS.members);
      }
      if (name !== undefined || members !== undefined) row.updatedAt = this.#now();
    });
  }
  /** Adds messages. Replies count as unread unless `read` is set (the chat is open on screen). */
  async append(id, messages, {read = false} = {}) {
    return this.#change(id, row => {
      const now = this.#now();
      const added = messages.map((m, i) => cleanMessage(m, this.#id(), now + i));
      row.messages.push(...added);
      if (!read) row.unread += added.filter(m => m.from !== 'me' && !['system', 'notice', 'recall'].includes(m.kind)).length;
      row.updatedAt = now;
    });
  }
  /**
   * Changes one message: {state, openedBy} for a red packet or transfer, or {recall: true} to withdraw it
   * (the message keeps its place and sender and loses its content).
   */
  async updateMessage(id, messageId, patch = {}) {
    return this.#change(id, row => {
      const m = row.messages.find(x => x.id === messageId);
      if (!m) throw fail('这条消息已不存在', 'MISSING');
      if (patch.recall) {
        for (const key of Object.keys(m)) if (!['id', 'from', 'at', 'source', 'paymentId'].includes(key)) delete m[key];
        Object.assign(m, {kind: 'recall', text: ''});
        if (m.source) m.source.localRecall = true;
        return;
      }
      if (!STATES[m.kind]) throw fail('这条消息不能修改');
      if (patch.state !== undefined) {
        if (!STATES[m.kind].includes(patch.state)) throw fail('状态无效');
        m.state = patch.state;
      }
      if (patch.openedBy !== undefined) m.openedBy = clip(patch.openedBy, 40);
    });
  }
  /** Compare-and-attach in the same IDB transaction; deleted/edited messages never resurrect. */
  async attachPhoto(id, messageId, photoId, options = {}) {
    return this.#change(id, row => {
      const message = row.messages.find(m => m.id === messageId);
      attachPhotoToMessage(message, photoId, options);
    });
  }
  /** Claim and status updates share the message's IDB transaction, including cross-tab claims. */
  async photoAttempt(id, messageId, patch, options = {}) {
    return this.#change(id, row => {
      markPhotoAttempt(row.messages.find(m => m.id === messageId), patch, options);
    });
  }
  async editPhoto(id, messageId, overrides, options = {}) {
    return this.#change(id, row => {
      editPhotoMessage(row.messages.find(m => m.id === messageId), overrides, options);
    });
  }
  async removeMessages(id, ids) {
    const drop = new Set(ids);
    return this.#change(id, (row, records) => {
      for (const m of row.messages) if (drop.has(m.id)) this.#remember(records, row.id, m, true);
      row.messages = row.messages.filter(m => !drop.has(m.id));
    });
  }
  async markRead(id) {
    return this.#change(id, row => { row.unread = 0; });
  }
  async remove(id) {
    return this.#tx('readwrite', (store, done, abort, records) => this.#get(store, id, row => {
      for (const m of row?.messages || []) this.#remember(records, row.id, m, true);
      store.delete([this.#scope, String(id)]); done(true);
    }));
  }
  async unread() {
    return (await this.list()).reduce((n, t) => n + (t.muted ? 0 : t.unread), 0);
  }
  /** Atomically reconciles a full snapshot from one main-story chat. */
  async reconcileSource(originScope, bundles, {space = '', isCurrent = () => true} = {}) {
    return this.#tx('readwrite', (store, done, abort, records) => {
      const rowRequest = store.index('scope').getAll(this.#scope);
      rowRequest.onsuccess = () => {
        const recordRequest = records.index('scope').getAll(this.#scope);
        recordRequest.onsuccess = () => {
          if (!isCurrent()) { done({stale: true, added: 0, changed: 0, removed: 0, retained: 0}); return; }
          try {
            const value = reconcileSourceSnapshot(rowRequest.result, recordRequest.result, originScope, bundles, {accountScope: this.#scope, space, now: this.#now(), id: this.#id});
            for (const row of value.rows) store.put(row);
            for (const record of value.records) records.put(record);
            const {rows, records: snapshots, ...result} = value;
            done(result);
          } catch (error) { abort(error); }
        };
      };
    });
  }
  /** Every thread with its messages, for a backup. */
  async exportThreads() {
    const rows = await this.#tx('readonly', (store, done) => { const req = store.index('scope').getAll(this.#scope); req.onsuccess = () => done(req.result); });
    return rows.map(row => this.#public(row));
  }
  /** Puts backup threads back with their ids, checked like new ones, in one transaction. replace: other threads go. */
  async importThreads(threads, {replace = false} = {}) {
    if (!Array.isArray(threads)) throw fail('备份里的聊天记录无效');
    const now = this.#now(), rows = threads.map(t => {
      if (!t || typeof t !== 'object' || !t.id) throw fail('备份里的聊天记录无效');
      const members = [...new Set((Array.isArray(t.members) ? t.members : []).map(m => clip(m, 40).trim()).filter(Boolean))].slice(0, CHAT_STORE_LIMITS.members);
      if (!members.length) throw fail('备份里有一段聊天没有聊天对象');
      const messages = (Array.isArray(t.messages) ? t.messages : []).slice(-CHAT_STORE_LIMITS.messages).map(m => cleanMessage(m, clip(m?.id || this.#id(), 512), Number.isFinite(m?.at) ? m.at : now));
      return {scope: this.#scope, id: clip(t.id, 512), type: t.type === 'group' ? 'group' : 'dm', name: clip(t.name, 40).trim() || members.join('、').slice(0, 40), members: t.type === 'group' ? members : [members[0]], pinned: t.pinned === true, muted: t.muted === true,
        unread: Math.max(0, Math.min(CHAT_STORE_LIMITS.messages, Math.round(Number(t.unread)) || 0)), createdAt: Number.isFinite(t.createdAt) ? t.createdAt : now, updatedAt: Number.isFinite(t.updatedAt) ? t.updatedAt : now, messages, ...(t.space ? {space: clip(t.space, 300)} : {})};
    });
    return this.#tx('readwrite', (store, done, abort, records) => {
      const write = () => { for (const row of rows) { store.put(row); for (const m of row.messages) if (m.source) this.#remember(records, row.id, m); } done(rows.length); };
      if (!replace) { write(); return; }
      const req = store.index('scope').getAllKeys(this.#scope);
      req.onsuccess = () => { for (const key of req.result) store.delete(key); write(); };
    });
  }
  close() { this.#closed = true; this.#db?.close(); this.#db = null; }
}
