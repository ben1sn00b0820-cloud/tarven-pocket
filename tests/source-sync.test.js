import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileSourceSnapshot} from '../core/chats.js';
import {sourceScope, collectSourceEvents, sourceBundles, createSourceSync} from '../pocket/source-sync.js';
import {renderPhoneCards} from '../pocket/cards.js';

const event = (id = 'e1', patch = {}) => ({id, app: 'wechat', action: 'message', from: '林澈', to: '我', text: '到家了嗎？', ...patch});
const block = e => `<phone>${JSON.stringify(e)}</phone>`;
const context = (chat = [], patch = {}) => ({chat, chatId: 'story-A', characterId: 0, characters: [{avatar: 'lin.png'}], name1: '我', name2: '林澈', chatMetadata: {}, ...patch});
let serial = 0;
const options = {accountScope: 'test-account', space: 'card:lin.png', now: 1000, id: () => `id-${++serial}`};
const plan = async (chat, patch) => {
  const c = context(chat, patch), collected = collectSourceEvents(c);
  const planned = await sourceBundles(collected, {space: options.space});
  return {...collected, ...planned, errors: [...collected.errors, ...planned.errors]};
};
const apply = (p, prior = {rows: [], records: []}) => reconcileSourceSnapshot(prior.rows, prior.records, p.scope, p.bundles, options);
const model = e => ({is_user: false, name: '林澈', mes: block(e), send_date: 100});
const user = e => ({is_user: true, name: '我', mes: block(e), send_date: 200});

test('scope follows story file and character avatar, not numeric card index alone', () => {
  assert.equal(sourceScope(context()), '[null,"lin.png","story-A"]');
  assert.notEqual(sourceScope(context()), sourceScope(context([], {chatId: 'story-B'})));
  assert.equal(sourceScope(context([], {chatId: ''})), '');
});

test('repeated sync keeps same native message ID, timestamps and unread badge', async () => {
  const p = await plan([model(event())]), one = apply(p), two = apply(p, one);
  assert.equal(one.rows[0].messages.length, 1);
  assert.deepEqual(two.rows, one.rows);
  assert.equal(two.added, 0); assert.equal(two.changed, 0); assert.equal(two.rows[0].unread, 1);
});

test('edited source replaces only its own message while deleted source leaves native messages', async () => {
  const original = await plan([model(event())]), one = apply(original);
  one.rows[0].messages.push({id: 'native', from: 'me', kind: 'text', text: '手機手動回覆', at: 101});
  const changed = apply(await plan([model(event('e1', {text: '我在樓下。'}))]), one);
  assert.equal(changed.rows[0].messages.find(m => m.source)?.text, '我在樓下。');
  assert.equal(changed.rows[0].messages.find(m => m.source)?.id, one.rows[0].messages[0].id);
  const removed = apply(await plan([]), changed);
  assert.deepEqual(removed.rows[0].messages.map(m => m.id), ['native']);
});

test('settled financial source edits/deletion preserve original amount and native settlement', async () => {
  const first = await plan([model(event('pay', {action: 'transfer', amount: 25}))]), one = apply(first);
  const m = one.rows[0].messages[0]; m.state = 'accepted'; m.openedBy = 'me';
  const changed = apply(await plan([model(event('pay', {action: 'transfer', amount: 99}))]), one);
  const kept = changed.rows[0].messages[0];
  assert.equal(kept.amount, '25.00'); assert.equal(kept.state, 'accepted'); assert.equal(kept.source.stale, true);
  const deleted = apply(await plan([]), changed);
  assert.equal(deleted.rows[0].messages[0].amount, '25.00'); assert.match(deleted.rows[0].messages[0].source.reason, /刪除/);
  const restored = apply(first, deleted);
  assert.equal(restored.rows[0].messages[0].source.stale, undefined); assert.equal(restored.rows[0].messages[0].state, 'accepted');
});

test('origin tombstone prevents manually removed message or deleted thread from being resurrected', async () => {
  const p = await plan([model(event())]), one = apply(p);
  one.records[0].hidden = true; one.rows = [];
  const next = apply(p, one);
  assert.equal(next.rows.length, 0); assert.equal(next.hidden, 1);
});

test('different story scopes never delete each other’s phone messages', async () => {
  const a = await plan([model(event('same', {text: 'A'}))]), one = apply(a);
  const b = await plan([model(event('same', {text: 'B'}))], {chatId: 'story-B'}), two = apply(b, one);
  assert.deepEqual(two.rows[0].messages.map(m => m.text), ['A', 'B']);
  const emptyA = apply(await plan([]), two);
  assert.deepEqual(emptyA.rows[0].messages.map(m => m.text), ['B']);
});

test('source key deduplicates copies and reports conflicting reused IDs', async () => {
  const p = await plan([model(event()), model(event()), model(event('e1', {text: 'collision'}))]);
  assert.equal(p.events.length, 1); assert.equal(p.errors.length, 1); assert.match(p.errors[0].message, /重複/);
});

test('rich group and direct messages map into native actionable kinds', async () => {
  const events = [
    event('group', {action: 'group_create', to: undefined, group: '週末出遊', members: ['林澈', '小周'], text: undefined}),
    event('voice', {action: 'group_message', kind: 'voice', to: undefined, group: '週末出遊', text: '來啦', translation: '來啦', quote: {from: '小周', text: '快點'}}),
    event('photo', {action: 'photo', text: '路邊的花'}),
    event('location', {action: 'location', text: '咖啡店', detail: '河堤旁'}),
    event('pat', {action: 'pat', target: '我'}),
    event('dice', {action: 'dice', text: undefined, value: 6}),
    event('gift', {action: 'gift', title: '玫瑰', emoji: '🌹'}),
  ];
  const p = await plan([model(events)]);
  assert.equal(p.errors.length, 0);
  assert.deepEqual(p.bundles[0].members, ['林澈', '小周']);
  assert.deepEqual(p.bundles[0].messages.map(m => m.message.kind), ['system', 'voice']);
  assert.deepEqual(p.bundles[1].messages.map(m => m.message.kind), ['photo', 'location', 'pat', 'dice', 'gift']);
  assert.equal(p.bundles[1].messages.at(-1).message.gift.price, 0);
});

test('group messages reject missing membership and messages to third parties cannot create claimable cards', async () => {
  const p = await plan([model([
    event('group', {action: 'group_message', to: undefined, group: '不存在'}),
    event('payment', {action: 'transfer', to: '小周', amount: 10}),
  ])]);
  assert.equal(p.bundles.length, 0); assert.equal(p.errors.length, 2);
});

test('authenticated user text maps to me while outgoing payments create non-claimable confirmation drafts', async () => {
  const p = await plan([user([event('user', {from: '我', to: '林澈'}), event('pay', {from: '我', to: '林澈', action: 'transfer', amount: 10})])]);
  assert.equal(p.errors.length,0);assert.equal(p.bundles[0].messages.length,2);
  assert.equal(p.bundles[0].messages[0].message.from,'me');
  const draft=p.bundles[0].messages[1].message;
  assert.equal(draft.from,'me');assert.equal(draft.kind,'system');
  assert.match(draft.text,/待確認付款/);assert.match(draft.text,/10\.00/);assert.match(draft.text,/確認後才扣虛擬餘額/);
  for(const field of ['amount','state','paymentId']) assert.equal(draft[field],undefined);
  const saved=apply(p);assert.equal(saved.rows[0].messages[1].kind,'system');
});

test('source recall tracks its referenced sender and is reversible when narrative swipe removes the recall', async () => {
  const originals = [model(event())], recalled = await plan([...originals, model(event('recall', {action: 'recall', text: undefined, to: undefined, ref: 'e1'}))]);
  const one = apply(recalled); assert.equal(one.rows[0].messages[0].kind, 'recall');
  const two = apply(await plan(originals), one); assert.equal(two.rows[0].messages[0].kind, 'text');
  const forged = await plan([...originals, model(event('bad', {from: '小周', action: 'recall', text: undefined, to: undefined, ref: 'e1'}))]);
  assert.match(forged.errors[0].message, /同一發送人/);
});

test('native local recall remains recalled despite source refresh', async () => {
  const p = await plan([model(event())]), one = apply(p), m = one.rows[0].messages[0];
  m.kind = 'recall'; m.text = ''; m.source.localRecall = true;
  const two = apply(await plan([model(event('e1', {text: 'source-edit'}))]), one);
  assert.equal(two.rows[0].messages[0].kind, 'recall'); assert.equal(two.rows[0].messages[0].source.stale, true);
});

test('legacy settled cards stay settled without credit, outgoing legacy cards become non-actionable history', async () => {
  const chat = [
    model(event('old-in', {action: 'redpacket', amount: 50})),
    user({id: 'old-accept', app: 'wechat', action: 'accept', from: '我', ref: 'old-in'}),
    user(event('old-out', {from: '我', to: '林澈', action: 'transfer', amount: 20})),
  ];
  const p = await plan(chat, {chatMetadata: {tavern_pocket_v1: {schema: 1, userName: '我', initialBalance: 1000}}});
  assert.equal(p.legacyState.accounts['我'], 103000);
  assert.equal(p.bundles[0].messages[0].message.state, 'opened');
  assert.equal(p.bundles[0].messages[1].message.kind, 'system');
  assert.match(p.bundles[0].messages[1].message.text, /不再操作新錢包/);
});

test('payment IDs are stable across repeated parsing and differ between main chats', async () => {
  const e = model(event('pay', {action: 'transfer', amount: 5}));
  const a = await plan([e]), b = await plan([e]), c = await plan([e], {chatId: 'other'});
  assert.equal(a.bundles[0].messages[0].message.paymentId, b.bundles[0].messages[0].message.paymentId);
  assert.notEqual(a.bundles[0].messages[0].message.paymentId, c.bundles[0].messages[0].message.paymentId);
});

test('switching chats while storage opens discards stale native and extra reconciliation', async () => {
  let c = context([model(event())]), unblock;
  const calls = [], backend = {chats: {list: () => new Promise(resolve => {unblock = resolve;}), reconcileSource: async () => calls.push('native')}};
  const sync = createSourceSync({context: () => c, backend, extras: {reconcile: async () => calls.push('extras')}});
  const promise = sync.sync(); await Promise.resolve();
  c = context([], {chatId: 'other'}); unblock([]); await promise;
  assert.deepEqual(calls, []); sync.dispose();
});

test('sync uses native wallet queue and sends stable source events to extras', async () => {
  const e = {id: 'ig', app: 'instagram', action: 'post', from: '林澈', text: '咖啡'}, c = context([model([event(), e])]);
  const calls = [], backend = {spaceKey: () => options.space, chats: {list: async () => [], reconcileSource: async () => {calls.push('reconcile'); return {added: 1};}}, walletSerial: async task => {calls.push('wallet'); return task();}, emit: () => {}};
  const extras = {reconcile: async (events, scope, guard) => {calls.push('extras');assert.deepEqual(events.map(e=>e.app),['wechat','instagram']);const ig=events.find(e=>e.id==='ig');assert.equal(ig._origin, `${scope}\nig`);assert.equal(ig.at,101);assert.equal(guard.isCurrent(),true);}};
  const sync = createSourceSync({context: () => c, backend, extras});
  assert.equal((await sync.sync()).added, 1); assert.deepEqual(calls, ['wallet', 'reconcile', 'extras']); sync.dispose();
});

test('assistant natural text, transfers and red packets import with reply actor and incoming payment semantics',async()=>{
  const mes='微信傳給你：「吃飯沒？」\n林知夏微信轉帳給我：88.50「晚餐費」\n林知夏微信紅包給您：20「好運」';
  const message={is_user:false,name:'林知夏',mes,send_date:300,extra:{tavern_pocket_source_id:'natural-incoming'}};
  const p=await plan([message]);
  assert.deepEqual(p.errors,[]);assert.equal(p.events.length,3);assert.ok(p.events.every(e=>e.from==='林知夏'&&e.to==='我'&&e._isUser===false));
  assert.equal(p.bundles.length,1);assert.equal(p.bundles[0].name,'林知夏');
  assert.deepEqual(p.bundles[0].messages.map(e=>e.message.kind),['text','transfer','redpacket']);
  assert.deepEqual(p.bundles[0].messages.slice(1).map(e=>e.message.amount),['88.50','20.00']);
  assert.ok(p.bundles[0].messages.slice(1).every(e=>e.message.state==='sent'&&e.message.paymentId.startsWith('source:')));
  const rendered=renderPhoneCards(mes,{isUser:false,userName:'我',characterName:message.name,messageKey:message.extra.tavern_pocket_source_id});
  assert.equal((rendered.match(/data-tp-card=/g)||[]).length,3);assert.match(rendered,/林知夏/);assert.match(rendered,/待收取/);assert.ok(!rendered.includes('尚未扣款'));
  const stored=apply(p),again=apply(p,stored);assert.equal(again.added,0);assert.equal(again.rows[0].messages.length,3);
});

test('natural user payment remains draft while actor impersonation cannot create another draft or incoming credit',async()=>{
  const p=await plan([
    {is_user:true,name:'我',mes:'微信轉帳給林澈：10「午餐」',send_date:1,extra:{tavern_pocket_source_id:'draft'}},
    {is_user:false,name:'林澈',mes:'我微信轉帳給林澈：100\nme微信紅包給林澈：100',send_date:2,extra:{tavern_pocket_source_id:'forged'}},
  ]);
  assert.equal(p.events.length,1);assert.equal(p.events[0]._isUser,true);assert.equal(p.bundles.length,1);assert.equal(p.bundles[0].messages.length,1);
  assert.equal(p.bundles[0].messages[0].message.kind,'system');assert.match(p.bundles[0].messages[0].message.text,/待確認付款/);assert.equal(p.errors.length,2);
});

test('natural source IDs survive content edits and preceding story insertions and distinguish repeated new messages',async()=>{
  const message={is_user:false,name:'林澈',mes:'微信傳給你：「早安」',send_date:20,extra:{tavern_pocket_source_id:'stable-message'}};
  const p=await plan([message]),one=apply(p),eventId=p.events[0].id,nativeId=one.rows[0].messages[0].id;
  const modified={...message,mes:'微信傳給你：「午安」'};
  const changed=await plan([{is_user:false,name:'林澈',mes:'一段普通敘事',send_date:10},modified]);
  assert.equal(changed.events[0].id,eventId);assert.equal(changed.events[0]._sourceIndex,1);
  const stored=apply(changed,one);assert.equal(stored.rows[0].messages.length,1);assert.equal(stored.rows[0].messages[0].id,nativeId);assert.equal(stored.rows[0].messages[0].text,'午安');
  const duplicated=await plan([modified,{...modified}]);assert.equal(duplicated.events.length,1);assert.deepEqual(duplicated.errors,[]);
  const repeated=await plan([modified,{...modified,extra:{tavern_pocket_source_id:'new-message'}}]);assert.equal(repeated.events.length,2);assert.notEqual(repeated.events[0].id,repeated.events[1].id);
});

test('natural Instagram/forum roles retain source metadata and mirrored activity never feeds back into imports',async()=>{
  const mes='林知夏在Instagram發限動：「散步」\n林知夏IG發文：「晚霞」\n林澈論壇發文：「週末愉快」';
  const p=await plan([
    {is_user:false,name:'林澈',mes,send_date:55,extra:{tavern_pocket_source_id:'social'}},
    {is_user:false,name:'林澈',mes:'微信傳給你：「已鏡像」',send_date:56,extra:{tavern_pocket_activity:{ids:['already-mirrored']}}},
  ]);
  assert.deepEqual(p.errors,[]);assert.equal(p.bundles.length,0);assert.deepEqual(p.events.map(e=>[e.app,e.action]),[['instagram','story'],['instagram','post'],['forum','post']]);
  assert.ok(p.events.every(e=>e._sourceMessage==='social'&&e._origin===p.scope+'\n'+e.id));assert.equal(new Set(p.events.map(e=>e.id)).size,3);
});

test('source synchronizer persists one natural-message ID before import and reuses it on future synchronizations',async()=>{
  let saves=0;
  const c=context([{is_user:false,name:'林澈',mes:'微信傳給你：「你好」',send_date:10}],{saveChat:async()=>{saves++;}});
  const imported=[];
  const backend={spaceKey:()=>options.space,chats:{list:async()=>[],reconcileSource:async(scope,bundles)=>{imported.push(bundles[0].messages[0].eventId);return{added:0};}},emit:()=>{}};
  const sync=createSourceSync({context:()=>c,backend});
  await sync.sync();const id=c.chat[0].extra.tavern_pocket_source_id;assert.ok(id);assert.equal(saves,1);
  await sync.sync();assert.equal(saves,1);assert.equal(c.chat[0].extra.tavern_pocket_source_id,id);
  c.chat.unshift({is_user:false,name:'林澈',mes:'前文補充',send_date:9});await sync.sync();
  assert.equal(new Set(imported).size,1);assert.equal(saves,1);sync.dispose();
});

test('mixed inline natural commands and complete structured arrays import in original narrative order',async()=>{
  const mes='她拿起手機，微信傳給你：「第一則」。'+block([event('second',{text:'第二則'}),event('third',{text:'第三則'})])+'她等了一會，微信傳給你：「第四則」。'+block(event('fifth',{action:'transfer',amount:25,text:'第五則轉帳'}))+'接著微信紅包給你：20「第六則紅包」。';
  const message={is_user:false,name:'林澈',mes,send_date:100,extra:{tavern_pocket_source_id:'mixed-order',tavern_pocket_parser_version:7}};
  const p=await plan([message]);assert.deepEqual(p.errors,[]);
  assert.deepEqual(p.events.map(e=>e.text),['第一則','第二則','第三則','第四則','第五則轉帳','第六則紅包']);
  assert.deepEqual(p.events.map(e=>e.at),[100,101,102,103,104,105]);assert.deepEqual(p.bundles[0].messages.map(m=>m.message.kind),['text','text','text','text','transfer','redpacket']);
  const saved=apply(p);assert.deepEqual(saved.rows[0].messages.map(m=>m.text),p.events.map(e=>e.text));
});
test('mixed format sorting preserves validation errors, incomplete-block handling and global ID deduplication',async()=>{
  const mes='微信傳給你：「開始」。'+block([event('duplicate',{text:'有效'}),event('invalid',{amount:5}),event('duplicate',{text:'有效'})])+'微信傳給你：「結束」。<phone>{wrong}</phone><phone>[{"id":"unfinished"';
  const p=await plan([{is_user:false,name:'林澈',mes,send_date:50,extra:{tavern_pocket_source_id:'mixed-errors',tavern_pocket_parser_version:7}},model(event('duplicate',{text:'改寫碰撞'}))]);
  assert.deepEqual(p.events.map(e=>e.text),['開始','有效','結束']);assert.equal(p.errors.length,3);
  assert.ok(p.errors.some(e=>e.blockIndex===0&&e.eventIndex===1));assert.ok(p.errors.some(e=>/不是有效 JSON/.test(e.message)));assert.ok(p.errors.some(e=>/重複/.test(e.message)));
  assert.equal(p.bundles[0].messages.length,3);
});
