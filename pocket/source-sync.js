import {formatSpiritAmount} from '../core/currency.js';
import {parsePhoneEvents,parseUserPhoneCommands,parseRolePhoneCommands} from './events.js';
import {buildState as readLegacyState} from './legacy-v02.js';

const MAX_EVENTS = 10000;
const paid = new Set(['transfer', 'redpacket', 'gift']);
const clone = value => structuredClone(value);

/** A story file, not merely its character card, identifies an event source. */
export function sourceScope(c) {
  if (!c) return '';
  const chatId = c.getCurrentChatId?.() ?? c.chatId;
  if (chatId === undefined || chatId === null || chatId === '') return '';
  return JSON.stringify([c.groupId ?? null, c.characters?.[c.characterId]?.avatar ?? c.characterId ?? null, chatId]);
}
const userActor = (name, userName) => name === userName || name === '{{user}}' || name === 'me';
const actor = (name, userName) => userActor(name, userName) ? 'me' : name;
export async function paymentKey(scope, id) {
  const bytes = new TextEncoder().encode(`${scope}\n${id}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return 'source:' + [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

export function collectSourceEvents(c) {
  const scope = sourceScope(c), events = [], errors = [], seen = new Map();
  const legacy = c.chatMetadata?.tavern_pocket_v1;
  const userName = legacy?.userName || c.name1 || '我';
  let legacyState = null;
  if (legacy?.schema === 1) legacyState = readLegacyState(c.chat, {userName, characterName: c.name2 || '角色', initialBalance: legacy.initialBalance});
  for (const [messageIndex, message] of (Array.isArray(c.chat) ? c.chat : []).entries()) {
    if (!message || message.is_system || message.role === 'system' || message.extra?.tavern_pocket_activity) continue;
    const isUser = message.is_user === true || message.role === 'user';
    const parsed = parsePhoneEvents(message.mes, {withPositions:true, isUser, userName, characterName: !isUser && message.name ? message.name : c.name2 || '角色'});
    const natural=(isUser?parseUserPhoneCommands:parseRolePhoneCommands)(message.mes,{isUser,userName,characterName:!isUser&&message.name?message.name:c.name2||'角色',messageKey:String(message.extra?.tavern_pocket_source_id||`${messageIndex}:${message.send_date||''}`),legacyLineIds:!!message.extra?.tavern_pocket_source_id&&message.extra?.tavern_pocket_parser_version!==7});
    // Structured array siblings share one source span and retain array order.
    // Natural commands may occur before, between or after complete blocks.
    parsed.events=[...parsed.matches,...natural.matches].sort((a,b)=>a.start-b.start).map(match=>match.event);
    parsed.errors.push(...natural.errors);
    for (const error of parsed.errors) errors.push({...error, messageIndex});
    const date = typeof message.send_date === 'number' ? message.send_date : Date.parse(message.send_date);
    for (const [eventIndex, event] of parsed.events.entries()) {
      const fingerprint = JSON.stringify(event), prior = seen.get(event.id);
      if (prior) {
        if (prior !== fingerprint) errors.push({messageIndex, eventId: event.id, message: `事件「${event.id}」重複使用於不同內容，後出現的事件未同步。`});
        continue;
      }
      seen.set(event.id, fingerprint);
      events.push({...event, _origin: `${scope}\n${event.id}`, _sourceIndex: messageIndex, _sourceMessage: String(message.extra?.tavern_pocket_source_id || `${messageIndex}:${message.send_date || ''}`), _isUser: isUser, at: Number.isFinite(date) ? date + eventIndex : 946684800000 + messageIndex * 1000 + eventIndex});
      if (events.length > MAX_EVENTS) throw new Error('正文手機事件超過 10000 筆；保留目前手機資料，請先分拆聊天或匯出歷史。');
    }
  }
  return {scope, userName, events, errors, legacyState};
}

/** Plans only native chat changes. No money is changed by this module. */
export async function sourceBundles(collected, {threads = [], space = '', journal = []} = {}) {
  const {scope, userName, legacyState} = collected;
  const groups = new Map(threads.filter(t => t.type === 'group' && (t.space || '') === space).map(t => [t.name, t.members]));
  const bundles = new Map(), byId = new Map(), errors = [];
  const legacyTransactions = new Map((legacyState?.transactions || []).map(t => [t.id, t]));
  const getBundle = event => {
    if (event.group) {
      if (event.members) groups.set(event.group, event.members);
      const members = groups.get(event.group);
      if (!members?.length) throw new Error(`群組「${event.group}」還沒有成員；先輸出 group_create 或提供 members。`);
      if (!userActor(event.from, userName) && !members.includes(event.from)) throw new Error(`「${event.from}」不在「${event.group}」的成員名單。`);
      const key = `group:${event.group}`;
      if (!bundles.has(key)) bundles.set(key, {key, type: 'group', name: event.group, members: [...members], messages: []});
      else bundles.get(key).members = [...members];
      return bundles.get(key);
    }
    if (!userActor(event.from, userName) && !userActor(event.to, userName)) throw new Error('只同步使用者參與的私訊；角色之間的群訊請指定 group。');
    const peer = userActor(event.from, userName) ? event.to : event.from;
    if (!peer || userActor(peer, userName)) throw new Error('私訊缺少其他聊天對象。');
    const key = `dm:${peer}`;
    if (!bundles.has(key)) bundles.set(key, {key, type: 'dm', name: peer, members: [peer], messages: []});
    return bundles.get(key);
  };
  for (const event of collected.events.filter(e => e.app === 'wechat')) {
    try {
      if (event.action === 'contact') continue;
      if (event.action === 'recall') {
        const target = byId.get(event.ref);
        if (!target) throw new Error(`撤回找不到先前同步的訊息「${event.ref}」。`);
        if (target.message.from !== actor(event.from, userName)) throw new Error('只能撤回同一發送人的訊息。');
        if (event.group && target.route !== `group:${event.group}`) throw new Error('撤回指定了不同群組。');
        target.message = {...target.message, kind: 'recall', text: ''};
        continue;
      }
      let nativeKind = event.action === 'message' ? 'text' : event.action === 'group_message' ? event.kind : event.action;
      if (nativeKind === 'text' && event.image) nativeKind = 'photo';
      const legacy = legacyTransactions.get(event.id);
      if (nativeKind === 'gift' && event._isUser && !legacy) throw new Error('請在手機商城選擇禮物並確認付款後傳送。');
      if (paid.has(nativeKind) && event._isUser && !legacy) {
        const bundle=getBundle(event),id=await paymentKey(scope,event.id),saved=journal.find(r=>r.id==='send:'+id),done=saved?.status==='done';
        const message={from:'me',kind:'system',text:`${done?'[已處理付款]':'[待確認付款]'} ${nativeKind==='redpacket'?'紅包':'轉帳'}給${event.to} · ${formatSpiritAmount(event.amount||0)}${event.text?' · '+event.text:''}${done?'':'（確認後才扣靈石）'}`};
        bundle.messages.push({eventId:event.id,sourceMessage:event._sourceMessage,message,at:event.at,route:bundle.key});continue;
      }
      const bundle = getBundle(event);
      let message = {from: actor(event.from, userName), kind: nativeKind, text: event.text || ''};
      if (nativeKind === 'group_create') message = {...message, kind: 'system', text: `${event.from} 建立了「${event.group}」群組。`};
      if (event.image && nativeKind === 'photo') message.image = event.image;
      if (event.imagePrompt && nativeKind === 'photo') message.imagePrompt = event.imagePrompt;
      if (event.quote) message.quote = {from: actor(event.quote.from, userName), text: event.quote.text};
      if (event.image && nativeKind === 'text') message.text += `\n圖片：${event.image}`;
      for (const key of ['translation', 'emotion', 'detail']) if (event[key]) message[key] = event[key];
      if (nativeKind === 'pat') message.target = actor(event.target, userName);
      if (nativeKind === 'dice') message.text = String(event.value);
      if (paid.has(nativeKind)) {
        message.paymentId = await paymentKey(scope, event.id);
        message.state = 'sent';
        if (nativeKind === 'gift') message.gift = {name: event.title, emoji: event.emoji || '🎁', price: 0};
        else message.amount = Number(event.amount).toFixed(2);
        if (legacy && event._isUser) {
          message = {from: 'me', kind: 'system', text: `舊版${nativeKind === 'redpacket' ? '紅包' : '轉帳'}紀錄：${event.to} · ${formatSpiritAmount(event.amount)} · ${legacy.status === 'pending' ? '原帳本待處理' : legacy.status === 'accepted' ? '原帳本已領取' : '原帳本已退回'}。此歷史紀錄不再操作新靈石袋。`};
        } else if (legacy?.status === 'accepted') {
          message.state = nativeKind === 'redpacket' ? 'opened' : 'accepted'; message.openedBy = actor(legacy.settledBy, userName);
        } else if (legacy?.status === 'refunded') {
          // Native red packets cannot be returned. Display the historical
          // refund as a system record instead of recreating a claimable card.
          if (nativeKind === 'redpacket') message = {from: message.from, kind: 'system', text: `舊版紅包 ${formatSpiritAmount(event.amount)} 已退回，歷史紀錄保留。`};
          else { message.state = 'returned'; message.openedBy = actor(legacy.settledBy, userName); }
        }
      }
      const entry = {eventId: event.id, sourceMessage: event._sourceMessage, message, at: event.at, route: bundle.key};
      bundle.messages.push(entry); byId.set(event.id, entry);
    } catch (error) { errors.push({eventId: event.id, message: String(error?.message || error)}); }
  }
  return {bundles: [...bundles.values()], errors};
}

/** Latest-request-wins synchronization; switching chats invalidates every await. */
export function createSourceSync({context, backend, extras, notice = () => {}}) {
  let disposed = false, revision = 0, queue = Promise.resolve();
  let last = {scope: '', events: 0, errors: [], added: 0, changed: 0, removed: 0, retained: 0};
  const status = () => clone(last);
  const sync = () => {
    const request = ++revision;
    const run = async () => {
      if (disposed || request !== revision) return status();
      const c = context(), scope = sourceScope(c);
      if (!scope || !Array.isArray(c.chat)) { last = {...last, scope: '', events: 0, errors: []}; return status(); }
      const chat = c.chat, metadata = c.chatMetadata;
      const current = () => !disposed && request === revision && sourceScope(context()) === scope && context().chat === chat && context().chatMetadata === metadata;
      try {
        let idsChanged=false;
        for(const m of c.chat){if(!m||m.is_system||m.extra?.tavern_pocket_activity||m.extra?.tavern_pocket_source_id)continue;if((m.is_user||m.role==='user'?parseUserPhoneCommands:parseRolePhoneCommands)(m.mes,{isUser:m.is_user===true||m.role==='user',userName:c.name1,characterName:!m.is_user&&m.name?m.name:c.name2,messageKey:'check'}).events.length){m.extra??={};m.extra.tavern_pocket_source_id=crypto.randomUUID();m.extra.tavern_pocket_parser_version=7;idsChanged=true;}}
        if(idsChanged){if(typeof c.saveChat==='function')await c.saveChat();else if(typeof c.saveMetadata==='function')await c.saveMetadata();if(!current())return status();}
        const collected = collectSourceEvents(c), space = backend.spaceKey?.() || '';
        const threads = await backend.chats.list();
        if (!current()) return status();
        const planned = await sourceBundles(collected, {threads, space, journal:backend.settings?.chat?.wallet?.journal||[]});
        if (!current()) return status();
        const reconcile = () => backend.chats.reconcileSource(scope, planned.bundles, {space, isCurrent: current});
        // A native claim spans settings and IDB writes. Do not let an edited
        // source card replace it halfway through that payment transaction.
        const result = await (backend.walletSerial ? backend.walletSerial(reconcile) : reconcile());
        if (!current() || result?.stale) return status();
        if (extras?.reconcile) await extras.reconcile(collected.events, scope, {isCurrent: current});
        if (!current()) return status();
        const legacyCents = collected.legacyState?.accounts?.[collected.userName];
        last = {scope, events: collected.events.length, errors: [...collected.errors, ...planned.errors].slice(0, 100), ...result, ...(Number.isFinite(legacyCents) ? {legacyBalance: legacyCents / 100} : {})};
        backend.emit?.('chat', {threadId: ''});
        backend.emit?.('pocket', {source: status()});
        if (result.retained) notice('正文來源已改動；已處理的訊息與交易保留，未再次增減餘額。');
      } catch (error) {
        if (current()) { last = {...last, scope, errors: [{message: String(error?.message || error)}]}; notice(`手機正文同步未完成：${String(error?.message || error)}`); }
      }
      return status();
    };
    queue = queue.then(run, run);
    return queue;
  };
  return {sync, status, dispose() { disposed = true; revision++; }};
}
