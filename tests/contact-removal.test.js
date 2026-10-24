import test from 'node:test';
import assert from 'node:assert/strict';
import {TTSBackend} from '../core/backend.js';
import {defaultChat, normalizeChat} from '../core/chat.js';
import {normalizeDeletedContacts, deletedContactNames} from '../core/contact-book.js';
import {createContactBridge} from '../pocket/contacts.js';
import {sourceScope} from '../pocket/source-sync.js';
import {deleteContactWithConfirmation} from '../ui/contact-profile.js';
import {newDatabase} from '../companions/csb-character-state/src/schema.js';

function fixture() {
  const b = Object.create(TTSBackend.prototype);
  b.settings = {scope: 'account-a', general: {defaultLanguage: 'zh'}, routes: [{name: '雲璃', engine: 'fish', voice: true, cards: ['card:a']}], chat: {...defaultChat(),
    contacts: [{id: 'm1', name: '沈禾', persona: '手工設定的人設', space: 'card:a'}, {id: 'm2', name: '陸澤', persona: '另一位朋友'}], starred: ['沈禾']}};
  b.space = {key: 'card:a', members: ['雲璃']};
  b.emitted = []; b.emit = (...args) => b.emitted.push(args);
  b.getState = () => structuredClone(b.settings);
  b.save = next => { if (b.failSave) throw Error('disk failure'); b.settings = {...next, chat: normalizeChat(next.chat)}; return b.getState(); };
  const threads = [{id: 'dm', type: 'dm', members: ['沈禾'], messages: [{id: 'm', text: '保存的私訊'}]},
    {id: 'other', type: 'dm', members: ['陸澤'], messages: []},
    {id: 'g', type: 'group', members: ['沈禾', '雲璃'], messages: []}];
  b.chats = {list: async () => structuredClone(threads)};
  const db = newDatabase();
  db.seed.characters.c_shen = {id: 'c_shen', name: '沈禾', aliases: [], present: false, values: {identity: '醫修', mood: '平靜'}};
  const c = {chatId: 'story-a', characterId: 0, name1: '公子', name2: '雲璃', chat: [],
    characters: [{name: '雲璃', avatar: 'a', description: '身份：侍女'}], chatMetadata: {csb_character_state_v1: db}};
  const bridge = createContactBridge({context: () => c, backend: b});
  return {b, c, db, bridge, threads};
}
const event = (id, from) => ({id, app: 'wechat', action: 'message', from, to: '公子', text: '新傳音'});

test('manual deletion archives persona, hides DM, and leaves character information/group history intact', async () => {
  const {b, c, db, bridge, threads} = fixture(), before = JSON.stringify(db);
  b.deleteContact('m1');
  assert(!b.contacts().some(contact => contact.name === '沈禾'));
  assert(!b.settings.chat.contacts.some(contact => contact.id === 'm1'));
  assert.equal(b.settings.chat.deletedContacts[0].contact.persona, '手工設定的人設');
  assert.deepEqual(b.settings.chat.starred, []);
  assert.deepEqual((await b.threads()).map(thread => thread.id), ['other', 'g']);
  assert.equal(threads[0].messages[0].text, '保存的私訊');
  assert.equal(bridge.profile('沈禾').fields.identity, '醫修');
  await bridge.sync([event('old', '沈禾'), event('new', '沈禾')], sourceScope(c));
  assert(!b.contacts().some(contact => contact.name === '沈禾'), 'old and new plot events do not undo deletion');
  assert.equal(JSON.stringify(db), before, 'CSB database remains untouched');
});

test('voice-role contacts can be removed, remain absent after role discovery, and restore without losing voice settings', async () => {
  const {b, c, bridge} = fixture(), before = structuredClone(b.settings.routes);
  b.deleteContact('雲璃');
  await bridge.sync([event('hello', '雲璃')], sourceScope(c));
  assert(!b.contacts().some(contact => contact.name === '雲璃'));
  assert.deepEqual(b.settings.routes, before);
  b.restoreContact('雲璃');
  assert.equal(b.contacts().find(contact => contact.name === '雲璃').voice, true);
  assert.deepEqual(b.settings.routes, before);
});

test('restoring a manual contact recovers its id/persona/card and old DM records', async () => {
  const {b} = fixture(); b.deleteContact('m1'); b.restoreContact('沈禾');
  assert.deepEqual(b.settings.chat.contacts.find(contact => contact.name === '沈禾'), {id: 'm1', name: '沈禾', persona: '手工設定的人設', space: 'card:a'});
  assert(!deletedContactNames(b.settings.chat).has('沈禾'));
  assert((await b.threads()).some(thread => thread.id === 'dm'));
});

test('explicit re-add clears the tombstone for a manual contact and a voice role', () => {
  const {b} = fixture();
  b.deleteContact('m1'); b.saveContact({name: '沈禾', persona: '明確重填'});
  assert.equal(b.contacts().find(contact => contact.name === '沈禾').persona, '明確重填');
  assert(!deletedContactNames(b.settings.chat).has('沈禾'));
  b.deleteContact('雲璃'); b.saveContact({name: '雲璃'});
  assert(b.contacts().some(contact => contact.name === '雲璃'));
  assert(!deletedContactNames(b.settings.chat).has('雲璃'));
});

test('settings normalization and reload preserve deletion; repeat deletion is idempotent', async () => {
  const {b, c, bridge} = fixture(); b.deleteContact('m1');
  const first = structuredClone(b.settings.chat.deletedContacts);
  b.deleteContact('沈禾');
  assert.deepEqual(b.settings.chat.deletedContacts, first);
  b.settings.chat = normalizeChat(JSON.parse(JSON.stringify(b.settings.chat)));
  await bridge.sync([event('again', '沈禾')], sourceScope(c));
  assert(!b.contacts().some(contact => contact.name === '沈禾'));
  assert.equal(b.settings.chat.deletedContacts.length, 1);
});

test('failed save leaves the original contact/settings and tombstones unchanged', () => {
  const {b} = fixture(), before = b.getState(); b.failSave = true;
  assert.throws(() => b.deleteContact('m1'), /disk failure/);
  assert.deepEqual(b.settings, before);
});

test('normalization does not silently evict old deletion records and rejects invalid names', () => {
  const rows = Array.from({length: 2500}, (_, i) => ({name: `路人${i}`, deletedAt: i}));
  assert.equal(normalizeDeletedContacts(rows).length, rows.length);
  assert.deepEqual(normalizeDeletedContacts([null, {}, {name: ' '}, {name: 'x'.repeat(101)}, '沈禾', {name: '沈禾', deletedAt: 4}]), [{name: '沈禾', deletedAt: 4}]);
});

test('canceling the one UI confirmation performs no write; accepting deletes through the production API', async () => {
  const {b} = fixture(); let confirmed = false, confirmations = 0;
  const ctx = {api: {getState: () => b.getState(), deleteContact: target => b.deleteContact(target)},
    confirm: async (title, detail) => { confirmations++; assert.match(title, /沈禾/); assert.match(detail, /角色信息.*保留/); return confirmed; }, notify() {}};
  assert.equal(await deleteContactWithConfirmation(ctx, {id: 'm1', name: '沈禾'}), false);
  assert(b.contacts().some(contact => contact.name === '沈禾'));
  confirmed = true;
  assert.equal(await deleteContactWithConfirmation(ctx, {id: 'm1', name: '沈禾'}), true);
  assert(!b.contacts().some(contact => contact.name === '沈禾'));
  assert.equal(confirmations, 2, 'exactly one confirmation per attempted deletion');
});

test('double tap cannot open duplicate confirmations and a failed operation releases the guard', async () => {
  const {b} = fixture(); let release;
  const pending = new Promise(resolve => { release = resolve; });
  const ctx = {api: {getState: () => b.getState(), deleteContact: target => b.deleteContact(target)}, confirm: () => pending, notify() {}};
  const first = deleteContactWithConfirmation(ctx, {id: 'm1', name: '沈禾'});
  assert.equal(await deleteContactWithConfirmation(ctx, {id: 'm1', name: '沈禾'}), false);
  release(true); assert.equal(await first, true);
});
