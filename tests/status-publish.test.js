import test from 'node:test';
import assert from 'node:assert/strict';
import {createStatusPublisher} from '../pocket/status-publish.js';
import {createContactBridge} from '../pocket/contacts.js';
import {serializeStatusProfile} from '../pocket/status.js';
import {sourceScope} from '../pocket/source-sync.js';

function fixture(overrides = {}) {
  const renders = [], events = [], notices = [], saves = [];
  let c = {chatId: 'one', characterId: 0, characters: [{name: '阿澤', avatar: 'a.png'}], name1: '使用者', chat: [], chatMetadata: {},
    saveChat: async function() { saves.push(this.chat.slice()); }, addOneMessage: m => renders.push(m),
    eventTypes: {MESSAGE_SENT: 'sent', USER_MESSAGE_RENDERED: 'rendered'}, eventSource: {emit: async (...args) => events.push(args)}, ...overrides};
  const context = () => c, publish = createStatusPublisher({context, notice: x => notices.push(x)});
  const makeSnapshot = () => ({...serializeStatusProfile('阿澤', {fields: {mood: '休息'}, body: []}), scope: sourceScope(c), isCurrent: () => true});
  return {publish, context, renders, events, notices, saves, makeSnapshot, get c() { return c; }, switchTo(next) { c = next; }};
}

test('status publication persists a user snapshot, renders once, and emits available host events', async () => {
  const f = fixture(), snapshot = f.makeSnapshot();
  const message = await f.publish(snapshot);
  assert.equal(f.c.chat[0], message); assert.equal(message.name, '使用者');
  assert.equal(message.is_user, true); assert.equal(message.is_system, false);
  assert.equal(message.extra.tavern_pocket_status, true); assert.equal(message.mes, snapshot.text);
  assert.equal(typeof message.send_date, 'number');
  assert.equal(f.saves.length, 1); assert.deepEqual(f.renders, [message]);
  assert.deepEqual(f.events, [['sent', 0], ['rendered', 0]]);
});

test('expired revision, wrong scope, and replaced metadata are rejected before appending', async () => {
  const f = fixture();
  await assert.rejects(f.publish({...f.makeSnapshot(), isCurrent: () => false}), {code: 'STALE'});
  await assert.rejects(f.publish({...f.makeSnapshot(), scope: 'other'}), {code: 'STALE'});
  let calls = 0;
  await assert.rejects(f.publish({...f.makeSnapshot(), isCurrent: () => { if (++calls === 2) f.c.chatMetadata = {}; return true; }}), {code: 'STALE'});
  assert.deepEqual(f.c.chat, []); assert.equal(f.saves.length, 0);
});

test('failed save removes only its snapshot and keeps a concurrently appended reply', async () => {
  const other = {mes: '稍後回覆'};
  const f = fixture({saveChat: async function() { this.chat.push(other); throw Error('磁碟已滿'); }});
  await assert.rejects(f.publish(f.makeSnapshot()), /磁碟已滿/);
  assert.deepEqual(f.c.chat, [other]); assert.deepEqual(f.renders, []); assert.deepEqual(f.events, []);
});

test('switch during save does not render into the new chat or remove its messages', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const f = fixture({saveChat: async () => pending});
  const oldChat = f.c.chat, saving = f.publish(f.makeSnapshot());
  const newcomer = {mes: '新對話'};
  f.switchTo({...f.c, chatId: 'two', chatMetadata: {}, chat: [newcomer]});
  release();
  await assert.rejects(saving, {code: 'STALE'});
  assert.equal(oldChat.length, 1); assert.deepEqual(f.c.chat, [newcomer]);
  assert.equal(f.renders.length, 0); assert.equal(f.events.length, 0);
});

test('fallback saveMetadata is used only if saveChat is absent, and event failure does not duplicate saved state', async () => {
  let metadataSaves = 0;
  const f = fixture({saveChat: undefined, saveMetadata: async () => { metadataSaves++; }, eventSource: {emit: async () => { throw Error('擴充事件失敗'); }}});
  await f.publish(f.makeSnapshot());
  assert.equal(metadataSaves, 1); assert.equal(f.c.chat.length, 1); assert.equal(f.renders.length, 1); assert.equal(f.notices.length, 2);
  const unavailable = fixture({saveChat: undefined});
  await assert.rejects(unavailable.publish(unavailable.makeSnapshot()), /未提供/);
  assert.equal(unavailable.c.chat.length, 0);
});

test('publisher works with contact revision expiry after append and subsequent plot snapshots override manual state', async () => {
  const f = fixture();
  const bridge = createContactBridge({context: f.context, backend: {contacts: () => [], getState: () => ({chat: {contacts: []}, routes: []})}, publishStatus: f.publish});
  const before = bridge.profile('阿澤');
  const edited = await bridge.save('阿澤', {revision: before.revision, fields: {mood: '休息'}, body: [{name: '手', value: '包紮'}]});
  assert.equal(edited.fields.mood, '休息');
  f.c.chat.push({mes: serializeStatusProfile('阿澤', {fields: {mood: '已康復'}, body: [{name: '手', value: '痊癒'}]}).text});
  assert.equal(bridge.profile('阿澤').fields.mood, '已康復');
});
