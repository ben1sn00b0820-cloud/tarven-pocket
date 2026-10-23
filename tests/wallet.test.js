import test from 'node:test';
import assert from 'node:assert/strict';
import {TTSBackend} from '../core/backend.js';
import {defaultWallet, normalizeWallet, WALLET_LIMITS} from '../core/wallet.js';

// Exercise production transaction methods against an asynchronous store with failure injection.
function host({wallet = defaultWallet(), messages = [], type = 'dm'} = {}) {
  const b = Object.create(TTSBackend.prototype);
  b.settings = {chat: {wallet: normalizeWallet(wallet)}};
  b.closed = false; b.walletQueue = Promise.resolve(); b.emit = () => {};
  b.getState = () => structuredClone(b.settings);
  b.save = next => { if (b.failSave) throw Error('disk failure'); b.settings = {chat: {wallet: normalizeWallet(next.chat.wallet)}}; };
  let thread = {id: 't', type, name: 'A', members: ['A', ...(type === 'group' ? ['B'] : [])], messages: structuredClone(messages)};
  b.chats = {
    async get() { await Promise.resolve(); return structuredClone(thread); },
    async append(id, list) {
      await Promise.resolve();
      if (b.failAppend) { b.failAppend = false; throw Error('append failed'); }
      thread.messages.push(...list.map(m => ({...structuredClone(m), id: crypto.randomUUID(), at: Date.now()})));
      if (b.appendThenThrow) { b.appendThenThrow = false; throw Error('lost acknowledgement'); }
      return structuredClone(thread);
    },
    async updateMessage(id, mid, patch) {
      await Promise.resolve();
      if (b.failUpdate) { b.failUpdate = false; throw Error('state failed'); }
      Object.assign(thread.messages.find(m => m.id === mid), patch);
      return structuredClone(thread);
    },
  };
  b.thread = () => thread;
  b.replace = value => { thread = value; };
  return b;
}
const incoming = (kind = 'transfer', more = {}) => ({id: 'm', from: 'A', kind, text: '你好', amount: '10.05', state: 'sent', ...more});
const item = {id: 'tea', name: '茶', price: 18.8, description: '剧情茶馆的热茶', emoji: '🍵'};

test('concurrent incoming claims credit one time and append one notice', async () => {
  const b = host({messages: [incoming()]});
  await Promise.all(Array.from({length: 80}, () => b.takeSent('t', 'm')));
  assert.equal(b.wallet().balance, 530.05);
  assert.equal(b.wallet().journal.length, 1);
  assert.equal(b.thread().messages.filter(m => m.kind === 'notice').length, 1);
  assert.equal(b.thread().messages[0].state, 'accepted');
});

test('outgoing same payment ID appends and debits only once', async () => {
  const b = host(), m = {kind: 'redpacket', amount: 13.14, text: '你好', paymentId: 'one-send'};
  await Promise.all(Array.from({length: 40}, () => b.sendPaid('t', m)));
  assert.equal(b.wallet().balance, 506.86);
  assert.equal(b.thread().messages.length, 1);
  assert.equal(b.wallet().journal[0].status, 'done');
});

test('outgoing append failure compensates exactly once and rejects reuse', async () => {
  const b = host(); b.failAppend = true;
  const m = {kind: 'transfer', amount: '12.34', paymentId: 'failed'};
  await assert.rejects(b.sendPaid('t', m), /append failed/);
  assert.equal(b.wallet().balance, 520);
  assert.equal(b.thread().messages.length, 0);
  await assert.rejects(b.sendPaid('t', m), /已退回/);
  assert.equal(b.wallet().ledger.filter(e => e.kind === 'refund').length, 1);
});

test('append committed but acknowledgement lost keeps debit and retry completes journal', async () => {
  const b = host(); b.appendThenThrow = true;
  const m = {kind: 'transfer', amount: '12.34', paymentId: 'uncertain'};
  await assert.rejects(b.sendPaid('t', m), /訊息已儲存/);
  assert.equal(b.wallet().balance, 507.66);
  await b.sendPaid('t', m);
  assert.equal(b.thread().messages.length, 1);
  assert.equal(b.wallet().balance, 507.66);
});

test('incoming state-write interruption resumes after normalized settings restore', async () => {
  const b = host({messages: [incoming()]}); b.failUpdate = true;
  await assert.rejects(b.takeSent('t', 'm'), /state failed/);
  const restored = host({wallet: b.wallet(), messages: b.thread().messages});
  await restored.takeSent('t', 'm');
  assert.equal(restored.wallet().balance, 530.05);
  assert.equal(restored.thread().messages[0].state, 'accepted');
  assert.equal(restored.wallet().journal[0].status, 'done');
});

test('source payment ID remains settled after delete and re-import with new thread/message IDs', async () => {
  const b = host({messages: [incoming('transfer', {paymentId: 'source:abc'})]});
  await b.takeSent('t', 'm');
  b.replace({id: 'new-thread', type: 'dm', name: 'A', messages: [incoming('transfer', {id: 'new-message', paymentId: 'source:abc'})]});
  await b.takeSent('new-thread', 'new-message');
  assert.equal(b.wallet().balance, 530.05);
  assert.equal(b.thread().messages[0].state, 'accepted');
});

test('purchases snapshot products, preserve through normalization, and reject order-ID collision', async () => {
  const b = host();
  await Promise.all(Array.from({length: 30}, () => b.pocketPurchase(item, 'order-1')));
  const w = normalizeWallet(b.wallet());
  assert.equal(w.balance, 501.2);
  assert.equal(w.inventory.length, 1);
  assert.deepEqual(w.inventory[0].description, item.description);
  const restored = host({wallet: w});
  await restored.pocketPurchase(item, 'order-1');
  assert.equal(restored.wallet().balance, 501.2);
  await assert.rejects(restored.pocketPurchase({...item, price: 1}, 'order-1'), /另一件商品/);
});

test('distinct concurrent purchases cannot spend more than the balance', async () => {
  const b = host(); await b.walletSetBalance(20);
  const jobs = await Promise.allSettled([b.pocketPurchase(item, 'a'), b.pocketPurchase(item, 'b')]);
  assert.equal(jobs.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(b.wallet().balance, 1.2);
  assert.equal(b.wallet().inventory.length, 1);
});

test('invalid prices and balances make no changes; manual adjustment is auditable', async () => {
  const b = host();
  for (const value of [-1, NaN, Infinity, '', '1.999', {}, WALLET_LIMITS.balance + 1]) {
    await assert.rejects(async () => b.walletSetBalance(value));
    await assert.rejects(async () => b.pocketPurchase({...item, price: value}, 'invalid'));
  }
  assert.equal(b.wallet().balance, 520);
  await b.walletSetBalance('1234.56', '新章节资金');
  assert.equal(b.wallet().balance, 1234.56);
  assert.equal(b.wallet().ledger[0].kind, 'adjust');
  assert.equal(b.wallet().ledger[0].amount, 714.56);
  assert.equal(b.wallet().ledger[0].note, '新章节资金');
});

test('purchase persistence failure leaves both money and inventory unchanged', async () => {
  const b = host(); b.failSave = true;
  await assert.rejects(b.pocketPurchase(item, 'failed-store'), /disk failure/);
  assert.equal(b.wallet().balance, 520);
  assert.equal(b.wallet().inventory.length, 0);
});

test('gift acceptance is idempotent and return never credits nonexistent money', async () => {
  const b = host({messages: [incoming('gift', {gift: {name: '花束', emoji: '💐', price: 0}})]});
  await Promise.all([b.takeSent('t', 'm'), b.takeSent('t', 'm')]);
  assert.equal(b.wallet().received.length, 1);
  assert.equal(b.wallet().balance, 520);
  const returned = host({messages: [incoming()]});
  await returned.takeSent('t', 'm', false);
  assert.equal(returned.wallet().balance, 520);
  assert.equal(returned.thread().messages[0].state, 'returned');
});

test('group supports red packets while transfer and gift remain private', async () => {
  const b = host({type: 'group'});
  await b.sendPaid('t', {kind: 'redpacket', amount: 5, paymentId: 'group-rp'});
  await assert.rejects(b.sendPaid('t', {kind: 'transfer', amount: 5, paymentId: 'group-tr'}), /私聊/);
  await assert.rejects(b.sendPaid('t', {kind: 'gift', giftId: 'letter', paymentId: 'group-gift'}), /私聊/);
  assert.equal(b.wallet().balance, 515);
});

test('full permanent journal blocks new charges rather than forgetting transaction IDs', async () => {
  const b = host();
  b.settings.chat.wallet.journal = Array.from({length: WALLET_LIMITS.journal}, (_, i) => ({id: 'purchase:' + i, flow: 'purchase', status: 'done'}));
  await assert.rejects(b.pocketPurchase(item, 'over-limit'), /已滿/);
  assert.equal(b.wallet().balance, 520);
});

test('native generated refund is idempotent across repeated generations', async () => {
  const {createChatHost} = await import('../host-chat.js');
  const {freshState} = await import('../core/state.js');
  const b = host();
  await b.sendPaid('t', {kind: 'transfer', amount: 20, paymentId: 'model-return'});
  b.contacts = () => [{name: 'A'}]; b.voiceFormat = () => ''; b.generateText = async () => 'A：[退还]';
  const h = createChatHost({context: () => ({name1: '我', characters: [], chat: []}), settings: freshState, backend: b, notice() {}});
  await h.reply('t'); await h.reply('t');
  assert.equal(b.wallet().balance, 520);
  assert.equal(b.wallet().ledger.filter(e => e.kind === 'refund').length, 1);
  assert.equal(b.thread().messages.filter(m => m.kind === 'notice').length, 1);
});

test('outgoing model refund interrupted at state write resumes with no second refund', async () => {
  const b = host();
  await b.sendPaid('t', {kind: 'transfer', amount: 20, paymentId: 'partial-return'});
  const mid = b.thread().messages[0].id;
  b.failUpdate = true;
  await assert.rejects(b.settleSent('t', mid, 'A', 'return'), /state failed/);
  assert.equal(b.wallet().balance, 520);
  const restored = host({wallet: b.wallet(), messages: b.thread().messages});
  await restored.resumeWalletClaims('t');
  assert.equal(restored.wallet().balance, 520);
  assert.equal(restored.thread().messages[0].state, 'returned');
  assert.equal(restored.wallet().ledger.filter(e => e.kind === 'refund').length, 1);
});

test('outgoing model refund settings-write failure can retry without losing money', async () => {
  const b = host();
  await b.sendPaid('t', {kind: 'transfer', amount: 20, paymentId: 'store-return'});
  const mid = b.thread().messages[0].id; b.failSave = true;
  await assert.rejects(b.settleSent('t', mid, 'A', 'return'), /disk failure/);
  assert.equal(b.wallet().balance, 500);
  assert.equal(b.thread().messages[0].state, 'sent');
  b.failSave = false;
  await b.settleSent('t', mid, 'A', 'return');
  assert.equal(b.wallet().balance, 520);
});

test('model claims require a real thread actor and only one group member takes a packet', async () => {
  const b = host({type: 'group'});
  await b.sendPaid('t', {kind: 'redpacket', amount: 8, paymentId: 'group-claim'});
  const mid = b.thread().messages[0].id;
  await assert.rejects(b.settleSent('t', mid, '{{char}}', 'accept'), /聯絡人/);
  await Promise.all([b.settleSent('t', mid, 'B', 'accept'), b.settleSent('t', mid, 'A', 'accept')]);
  assert.equal(b.thread().messages[0].openedBy, 'B');
  assert.equal(b.thread().messages.filter(m => m.kind === 'notice').length, 1);
  assert.equal(b.wallet().balance, 512);
});

test('source-only outgoing observation cannot manufacture a wallet refund', async () => {
  const b = host({messages: [{...incoming(), from: 'me', paymentId: 'source:user-transfer', source: {eventId: 'e1'}}]});
  await assert.rejects(b.settleSent('t', 'm', 'A', 'return'), /沒有錢包扣款/);
  assert.equal(b.wallet().balance, 520);
});

test('decor ownership and debit are atomic, duplicate purchases are harmless', async () => {
  const b = host(); b.failSave = true;
  await assert.rejects(b.buyDecoration('bubble', 'aurora'), /disk failure/);
  assert.equal(b.wallet().balance, 520);
  assert.equal(b.wallet().owned.length, 0);
  b.failSave = false;
  await Promise.all([b.buyDecoration('bubble', 'aurora'), b.buyDecoration('bubble', 'aurora')]);
  assert.equal(b.wallet().balance, 432);
  assert.deepEqual(b.wallet().owned, ['bubble:aurora']);
});


test('confirmed source payment queued across a chat change cancels before debit',async()=>{
 const b=host();let release,current=true;
 b.walletQueue=new Promise(resolve=>{release=resolve;});
 const pending=b.sendPaid('t',{kind:'transfer',amount:20,paymentId:'stale-source'},{isCurrent:()=>current});
 current=false;release();await assert.rejects(pending,/對話已切換/);
 assert.equal(b.wallet().balance,520);assert.equal(b.thread().messages.length,0);assert.equal(b.wallet().journal.length,0);
});


test('queued narrative purchase cancels on story switch before changing wallet or inventory',async()=>{
 const b=host();let release,current=true;b.walletQueue=new Promise(resolve=>{release=resolve;});
 const pending=b.pocketPurchase(item,'source-purchase',{isCurrent:()=>current});current=false;release();
 await assert.rejects(pending,/對話已切換/);assert.equal(b.wallet().balance,520);assert.equal(b.wallet().inventory.length,0);
});
