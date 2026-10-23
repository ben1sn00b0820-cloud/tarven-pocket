import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createContactBridge, contactNames} from '../pocket/contacts.js';
import {sourceScope, collectSourceEvents} from '../pocket/source-sync.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/CharacterStatus_WorldInfo_v2.1.json', import.meta.url), 'utf8'));
const content = fixture.entries['0'].content;
const template = content.slice(content.lastIndexOf('[CSB21_PANEL]'), content.lastIndexOf('[/CSB21_PANEL]') + '[/CSB21_PANEL]'.length);
const status = (name, patch = {}) => {
  let text = template.replace('name: 角色姓名', `name: ${name}`);
  for (const [key, value] of Object.entries(patch)) text = text.replace(new RegExp(`^${key}:.*$`, 'm'), `${key}: ${value}`);
  return text;
};
const phone = value => `<phone>${JSON.stringify(value)}</phone>`;
const event = (id, from = '林澈', extra = {}) => ({id, app: 'wechat', action: 'message', from, to: '使用者', text: '你好', ...extra});
const message = mes => ({mes, name: '林澈', is_user: false, send_date: 123456789});

function fixtureBridge({contacts = [], routes = [], publisher} = {}) {
  let c = {name1: '使用者', name2: '林澈', characterId: 0, chatId: 'one', chatMetadata: {}, chat: [], characters: [
    {name: '林澈', avatar: 'lin.png', description: '身高：182cm\n體重：73kg\n身材：精瘦\n外貌：黑髮，棕色眼睛', personality: '沉穩'},
    {name: '王薇', avatar: 'wang.png', description: '身高：170cm\n外貌：短髮'}]};
  const saved = [], emitted = [], tagged = [];
  const settings = {chat: {contacts: structuredClone(contacts)}, routes: structuredClone(routes), general: {defaultLanguage: 'zh'}};
  const backend = {
    settings, space: {key: 'card:lin.png'},
    getState: () => structuredClone(settings),
    contacts: () => settings.chat.contacts.filter(x => !x.space || x.space === backend.space.key).map(x => ({...x, source: 'manual'})),
    saveContact(value) { const contact = {...value, id: String(saved.length), space: backend.space.key}; settings.chat.contacts.push(contact); saved.push(contact); return contact; },
    tagRoles(names, key) { tagged.push({names, key}); },
    emit(...args) { emitted.push(args); },
  };
  const originalContacts = backend.contacts;
  const publications = [];
  const publishStatus = async payload => {
    if (publisher) return publisher(payload, c);
    assert.equal(payload.isCurrent(), true);
    publications.push(payload);
    c.chat.push({mes: payload.text, is_user: true, is_system: false, extra: {tavern_pocket_status: true}});
  };
  const bridge = createContactBridge({context: () => c, backend, publishStatus});
  return {bridge, backend, saved, emitted, tagged, publications, originalContacts, get c() { return c; }, switchTo(next) { c = next; }};
}

test('registers sender, outgoing recipient, and every group member once as native contacts', async () => {
  const f = fixtureBridge();
  const events = [event('a'), event('b'), event('c', '使用者', {to: '王薇'}), event('g', '林澈', {to: undefined, group: '聚會', members: ['林澈', '路人甲']})];
  assert.deepEqual(contactNames(events, f.c), ['林澈', '王薇', '路人甲']);
  const result = await f.bridge.sync(events, sourceScope(f.c));
  assert.deepEqual(result.created, ['林澈', '王薇', '路人甲']);
  assert.equal(f.saved.length, 3);
  await f.bridge.sync(events, sourceScope(f.c));
  assert.equal(f.saved.length, 3);
  assert.match(f.saved[0].persona, /182cm/);
  assert.equal(f.saved[2].persona, '', 'unrelated NPC never receives the main character card');
  assert.ok(f.saved.every(item => item.space === 'card:lin.png'));
});

test('does not turn a nonparticipating NPC exchange, user, or Instagram actor into a native WeChat contact', () => {
  const f = fixtureBridge();
  assert.deepEqual(contactNames([event('a', '林澈', {to: '王薇'}), event('b', 'me', {to: '{{user}}'}), event('c', '林澈', {app: 'instagram'})], f.c), []);
});

test('keeps an existing manual persona and partition untouched while making its current sender visible', async () => {
  const before = {id: 'manual', name: '林澈', persona: '這是我手動寫的角色資訊', space: 'card:other.png'};
  const f = fixtureBridge({contacts: [before]});
  await f.bridge.sync([event('a')], sourceScope(f.c));
  assert.equal(f.saved.length, 0);
  assert.deepEqual(f.backend.settings.chat.contacts[0], before);
  assert.equal(f.backend.contacts()[0].persona, before.persona);
  assert.equal(f.bridge.profile('林澈').contact.persona, before.persona);
});

test('existing voice roles are tagged for the current card instead of creating conflicting manual contacts', async () => {
  const f = fixtureBridge({routes: [{name: '林澈', voice: true, engine: 'fish', language: 'zh'}]});
  await f.bridge.sync([event('a')], sourceScope(f.c));
  assert.equal(f.saved.length, 0);
  assert.deepEqual(f.tagged, [{names: ['林澈'], key: 'card:lin.png'}]);
  assert.equal(f.backend.contacts()[0].voice, true);
});

test('latest complete status, explicit physique, attribution, and empty manual body rows reach profiles', async () => {
  const f = fixtureBridge();
  f.c.chat.push(message(phone(event('a')) + status('林澈', {age: '25', mood: '平靜', hydration: '80'})));
  const collected = collectSourceEvents(f.c);
  await f.bridge.sync(collected.events, collected.scope);
  const p = f.bridge.profile('林澈');
  assert.equal(p.fields.age, '25');
  assert.equal(String(p.fields.hydration), '80');
  assert.equal(p.card.height, '182cm');
  assert.equal(p.card.build, '精瘦');
  assert.equal(p.body.length, 16);
  assert.ok(p.body.every(part => part.value === ''));
  assert.equal(p.source.kind, 'status');
  assert.equal(p.source.messageIndex, 0);
  assert.match(f.bridge.promptFor(['林澈']), /沒有新事件的空白部位保持空白/);
});

test('editing and deleting status recomputes profiles without leaving stale dynamic data', () => {
  const f = fixtureBridge();
  f.c.chat.push(message(status('林澈', {mood: '開心', satiety: '90'})));
  assert.equal(f.bridge.profile('林澈').fields.mood, '開心');
  f.c.chat[0].mes = status('林澈', {mood: '疲倦', satiety: '40'});
  assert.equal(f.bridge.profile('林澈').fields.mood, '疲倦');
  assert.equal(String(f.bridge.profile('林澈').fields.satiety), '40');
  f.c.chat.length = 0;
  assert.equal(f.bridge.profile('林澈').fields.mood, undefined);
  assert.equal(f.bridge.profile('林澈').card.height, '182cm');
});

test('contact events without a to field and optional profile on messages retain only supplied facts', async () => {
  const f = fixtureBridge();
  const introduction = {id: 'intro', app: 'wechat', action: 'contact', from: '路人甲', profile: {height: '178cm', build: '結實', age: '28'}};
  f.c.chat.push(message(phone(introduction)), message(phone(event('next', '路人甲', {profile: {appearance: '短髮'}}))));
  const collected = collectSourceEvents(f.c);
  assert.deepEqual(collected.errors, []);
  await f.bridge.sync(collected.events, collected.scope);
  const p = f.bridge.profile('路人甲');
  assert.deepEqual(p.fields, {height: '178cm', build: '結實', age: '28', appearance: '短髮'});
  assert.equal(p.fields.weight, undefined);
  assert.equal(p.missing, '未提供');
  assert.deepEqual(p.body, []);
  f.c.chat.shift();
  assert.equal(f.bridge.profile('路人甲').fields.height, undefined, 'deleted source facts vanish');
});

test('a later status beats old profile fields and later explicit contact facts override their field only', () => {
  const f = fixtureBridge();
  f.c.chat.push(message(phone(event('a', '林澈', {profile: {age: '20', height: '180cm'}}))),
    message(status('林澈', {age: '25', identity: '工程師'})),
    message(phone(event('b', '林澈', {profile: {appearance: '戴眼鏡'}}))));
  assert.equal(f.bridge.profile('林澈').fields.age, '25');
  assert.equal(f.bridge.profile('林澈').fields.height, '180cm');
  assert.equal(f.bridge.profile('林澈').fields.appearance, '戴眼鏡');
  f.c.chat.push(message(phone(event('c', '林澈', {profile: {age: '26'}}))));
  assert.equal(f.bridge.profile('林澈').fields.age, '26');
});

test('switching chats clears the profile and read-only contact overlay; stale sync cannot mutate contacts', async () => {
  const f = fixtureBridge({contacts: [{id: 'lin', name: '林澈', persona: '手填', space: 'card:other.png'}]});
  f.c.chat.push(message(status('林澈', {mood: '開心'})));
  const oldScope = sourceScope(f.c);
  await f.bridge.sync([event('a')], oldScope);
  assert.ok(f.backend.contacts().some(item => item.name === '林澈'));
  f.switchTo({...f.c, characterId: 1, name2: '王薇', chatId: 'two', chatMetadata: {}, chat: []});
  f.backend.space.key = 'card:wang.png';
  assert.ok(!f.bridge.profiles().some(item => item.name === '林澈'));
  assert.ok(!f.backend.contacts().some(item => item.name === '林澈'));
  assert.equal((await f.bridge.sync([event('b', '路人乙')], oldScope)).stale, true);
  assert.equal(f.saved.length, 0);
  assert.equal((await f.bridge.sync([event('c', '路人乙')], sourceScope(f.c), {isCurrent: () => false})).stale, true);
  assert.equal(f.saved.length, 0);
});

test('returned profiles are detached and disposal restores backend methods', async () => {
  const f = fixtureBridge();
  f.c.chat.push(message(status('林澈')));
  const p = f.bridge.profile('林澈');
  p.fields.age = '亂填'; p.body[0].value = '亂填';
  assert.notEqual(f.bridge.profile('林澈').fields.age, '亂填');
  assert.equal(f.bridge.profile('林澈').body[0].value, '');
  f.bridge.dispose();
  assert.equal(f.backend.contacts, f.originalContacts);
  assert.deepEqual(f.bridge.profiles(), []);
  assert.equal((await f.bridge.sync([event('a')], sourceScope(f.c))).stale, true);
});

const editable = p => ({revision: p.revision, time: p.time, fields: Object.fromEntries(Object.entries(p.fields).filter(([key]) => !['height', 'weight', 'build', 'appearance'].includes(key))), body: p.body});

test('user edits publish a complete current-story CSB snapshot; later plot changes become the new baseline', async () => {
  const f = fixtureBridge();
  f.c.chat.push(message(status('林澈', {mood: '疲倦', hydration: '40'})));
  const before = f.bridge.profile('林澈'), draft = editable(before);
  draft.fields.mood = '休息完畢'; draft.fields.hydration = '0'; draft.fields.energy = '未知';
  draft.body[0] = {name: '左手', value: '剛包紮'}; draft.body.push({name: '新部位', value: ''});
  const result = await f.bridge.save('林澈', draft);
  assert.equal(result.fields.mood, '休息完畢');
  assert.equal(result.fields.hydration, '0'); assert.equal(result.fields.energy, '未知');
  assert.equal(result.body.at(-1).value, '');
  assert.equal(f.publications.length, 1);
  assert.equal(f.c.chat.at(-1).extra.tavern_pocket_status, true);
  assert.match(f.bridge.promptFor(['林澈']), /剛包紮/);
  f.c.chat.push(message(status('林澈', {mood: '愉快', hydration: '75'}).replace('[CSB21_PART|頭部|]', '[CSB21_PART|左手|包紮已拆除]')));
  assert.equal(f.bridge.profile('林澈').fields.mood, '愉快');
  assert.equal(f.bridge.profile('林澈').body[0].value, '包紮已拆除');
  f.c.chat.pop();
  assert.equal(f.bridge.profile('林澈').fields.mood, '休息完畢', 'deleting the later plot restores the manual baseline');
  f.c.chat.pop();
  assert.equal(f.bridge.profile('林澈').fields.mood, '疲倦', 'deleting the manual snapshot restores its predecessor');
});

test('stale editors cannot overwrite edited snapshots or another same-name chat', async () => {
  const f = fixtureBridge(); f.c.chat.push(message(status('林澈', {mood: '原本'})));
  const draft = editable(f.bridge.profile('林澈'));
  f.c.chat[0].mes = status('林澈', {mood: '新劇情'});
  await assert.rejects(f.bridge.save('林澈', draft), {code: 'STALE'});
  const current = editable(f.bridge.profile('林澈'));
  f.switchTo({...f.c, chatId: 'another', chatMetadata: {}, chat: structuredClone(f.c.chat)});
  await assert.rejects(f.bridge.save('林澈', current), {code: 'STALE'});
  assert.equal(f.publications.length, 0);
});

test('invalid meters or embedded protocol cannot publish or change the profile', async () => {
  const f = fixtureBridge(); f.c.chat.push(message(status('林澈', {mood: '原本'})));
  const before = f.bridge.profile('林澈');
  const draft = editable(before); draft.fields.hydration = '101';
  await assert.rejects(f.bridge.save('林澈', draft), /0–100/);
  draft.fields.hydration = '未知'; draft.body[0].value = '內容|偽造欄位';
  await assert.rejects(f.bridge.save('林澈', draft), /包含/);
  draft.body[0].value = ''; draft.fields.note = '正常\n[CSB21_ROLE]';
  await assert.rejects(f.bridge.save('林澈', draft), /保留字元/);
  assert.equal(f.publications.length, 0); assert.deepEqual(f.bridge.profile('林澈'), before);
});

test('failed publication leaves no permanent manual overlay and preserves the prior snapshot', async () => {
  const f = fixtureBridge({publisher: async () => { throw Error('寫入失敗'); }});
  f.c.chat.push(message(status('林澈', {mood: '原本'})));
  const before = f.bridge.profile('林澈'), draft = editable(before); draft.fields.mood = '不可儲存';
  await assert.rejects(f.bridge.save('林澈', draft), /寫入失敗/);
  assert.deepEqual(f.bridge.profile('林澈'), before); assert.equal(f.c.chat.length, 1);
});

test('publisher receives a current guard that rejects asynchronous chat switches', async () => {
  let release, seen;
  const wait = new Promise(resolve => { release = resolve; });
  const f = fixtureBridge({publisher: async payload => { seen = payload; await wait; if (!payload.isCurrent()) throw Object.assign(Error('過期'), {code: 'STALE'}); }});
  f.c.chat.push(message(status('林澈')));
  const saving = f.bridge.save('林澈', editable(f.bridge.profile('林澈')));
  assert.equal(seen.isCurrent(), true);
  f.switchTo({...f.c, chatId: 'two', chat: [], chatMetadata: {}});
  assert.equal(seen.isCurrent(), false); release();
  await assert.rejects(saving, {code: 'STALE'}); assert.equal(f.c.chat.length, 0);
});
