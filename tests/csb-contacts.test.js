import test from 'node:test';
import assert from 'node:assert/strict';
import {readCharacterState, indexCharacterState, CSB_STATE_KEY} from '../pocket/csb-state.js';
import {createContactBridge, contactNames} from '../pocket/contacts.js';
import {sourceScope} from '../pocket/source-sync.js';
import {visiblePhotoFacts} from '../pocket/image-context.js';
import {newDatabase, field} from '../companions/csb-character-state/src/schema.js';
import {anchorFor} from '../companions/csb-character-state/src/core.js';

function fixture(options = {}) {
  const db = newDatabase();
  db.schema.fields.push(field('qi', '靈力', 'gauges', 'bar', {min: -50, max: 500, unit: '點'}),
    field('resting', '正在休息', 'scene', 'boolean'),
    field('skills', '擅長', 'basic', 'multiselect', {options: ['劍術', '醫術']}),
    field('scar', '傷痕', 'body'), field('privateKey', '不顯示的設定', 'memory', 'text', {hidden: true}));
  db.seed.characters.c_lin = {id: 'c_lin', name: '林澈', aliases: ['阿澈'], present: true,
    values: {age: '25', height: 182, weight: 73, mood: '安靜', qi: 0, resting: false, skills: ['劍術'], scar: '左肩舊傷', thought: '不放進照片', privateKey: 'hidden-secret'}};
  let c = {chatId: 'chat-one', characterId: 0, groupId: null, name1: '使用者', name2: '林澈',
    characters: [{name: '林澈', avatar: 'lin.png', description: '身高：190cm\n體重：99kg'}], chat: [],
    chatMetadata: {[CSB_STATE_KEY]: db}, extensionSettings: {[CSB_STATE_KEY]: {enabled: true, allowNew: true}}};
  const backend = {settings: {chat: {contacts: []}, routes: []}, contacts: () => [], emit() {}};
  const opened = [];
  const bridge = createContactBridge({context: () => c, backend, openStateEditor: options.noEditor ? undefined : async value => { opened.push(value); await options.editor?.(value); }});
  return {bridge, db, backend, opened, get c() { return c; }, switchTo(value) { c = value; }};
}
const update = (set, id = 'm_1') => ({mes: `<CSB_UPDATE>${JSON.stringify({version: 1, characters: [{id: 'c_lin', set, reason: '測試明確事件'}]})}</CSB_UPDATE>`, is_user: false, extra: {csb_uid: id}, swipe_id: 0});

test('CSB projection retains schema, custom types, zero, false and empty defaults', () => {
  const f = fixture(), p = f.bridge.profile('林澈');
  assert.equal(p.source.kind, 'csb');
  assert.equal(p.csb.id, 'c_lin');
  assert.equal(p.csb.values.qi, 0); assert.equal(p.csb.values.resting, false);
  assert.deepEqual(p.csb.values.skills, ['劍術']); assert.equal(p.csb.values.energy, null);
  assert.equal(p.csb.fields.find(field => field.id === 'qi').min, -50);
  assert.equal(p.fields.height, '182 cm'); assert.equal(p.fields.weight, '73 kg');
  assert.equal(p.body.find(row => row.name === '傷痕').value, '左肩舊傷');
  assert.equal(p.csb.editable, true);
});

test('reads CSB partial updates without changing saved database or message anchors', () => {
  const f = fixture(); f.c.chat.push(update({qi: 180, mood: '興奮'}));
  const before = JSON.stringify(f.c);
  const p = f.bridge.profile('林澈');
  assert.equal(p.csb.values.qi, 180); assert.equal(p.fields.mood, '興奮');
  assert.equal(JSON.stringify(f.c), before);
  assert.deepEqual(f.db.processed, {});
});

test('edited, swiped and deleted responses recompute current CSB data', () => {
  const f = fixture(); f.c.chat.push(update({qi: 180}));
  assert.equal(f.bridge.profile('林澈').csb.values.qi, 180);
  f.c.chat[0].mes = update({qi: -20}).mes;
  assert.equal(f.bridge.profile('林澈').csb.values.qi, -20);
  f.c.chat[0].swipe_id = 1; f.c.chat[0].mes = update({qi: 12}).mes;
  assert.equal(f.bridge.profile('林澈').csb.values.qi, 12);
  f.c.chat.pop(); assert.equal(f.bridge.profile('林澈').csb.values.qi, 0);
});

test('manual edits stay on their message branch and locked values remain authoritative', () => {
  const f = fixture(); f.c.chat.push(update({qi: 20}));
  f.db.manual.push({id: 'e_1', anchor: anchorFor(f.c.chat[0]), payload: {version: 1, characters: [{id: 'c_lin', set: {qi: 40}}]}});
  assert.equal(f.bridge.profile('林澈').csb.values.qi, 40);
  f.c.chat[0].swipe_id = 2;
  assert.equal(f.bridge.profile('林澈').csb.values.qi, 20);
  f.db.locks.c_lin = {qi: 80};
  const p = f.bridge.profile('林澈');
  assert.equal(p.csb.values.qi, 80); assert.deepEqual(p.csb.locked, ['qi']);
});

test('processed snapshots preserve previously accepted state with the native replay engine', () => {
  const f = fixture(); f.c.chat.push(update({qi: 200}));
  f.db.processed[anchorFor(f.c.chat[0])] = {payload: {version: 1, characters: [{id: 'c_lin', set: {qi: 25}}]}, warnings: []};
  assert.equal(f.bridge.profile('林澈').csb.values.qi, 25);
});

test('CSB null and hidden fields never recover old card or legacy status values', () => {
  const f = fixture();
  f.db.seed.characters.c_lin.values.height = null;
  f.db.schema.fields.find(field => field.id === 'weight').hidden = true;
  const p = f.bridge.profile('林澈');
  assert.equal(p.fields.height, null); assert.equal(p.fields.weight, undefined);
  assert.equal(p.card.height, undefined); assert.equal(p.card.weight, undefined);
  assert.equal(p.csb.values.privateKey, undefined);
  assert.ok(!p.csb.fields.some(field => field.id === 'privateKey'));
  const prompt = f.bridge.promptFor(['林澈']);
  assert.doesNotMatch(prompt, /hidden-secret|privateKey|190cm|99kg/);
  assert.match(prompt, /"value":null/);
});

test('text model gets active typed custom facts, photo model only gets visible facts', () => {
  const f = fixture(), p = f.bridge.profile('林澈');
  const prompt = f.bridge.promptFor(['阿澈']);
  assert.match(prompt, /"label":"靈力"/); assert.match(prompt, /"min":-50/);
  assert.match(prompt, /"value":false/); assert.match(prompt, /"value":0/);
  const visible = visiblePhotoFacts(p);
  assert.equal(visible.height, '182 cm');
  assert.ok(visible.body.some(row => row.value === '左肩舊傷'));
  assert.doesNotMatch(JSON.stringify(visible), /不放進照片|resting|privateKey|靈力/);
});

test('unique aliases resolve to the original stable character ID', () => {
  const f = fixture(), p = f.bridge.profile('阿澈');
  assert.equal(p.name, '阿澈'); assert.equal(p.csb.name, '林澈'); assert.equal(p.csb.id, 'c_lin');
  assert.equal(f.bridge.profiles().filter(row => row.csb?.id === 'c_lin').length, 1);
});

test('duplicate canonical names refuse implicit merges or guessed prompt facts', async () => {
  const f = fixture();
  f.db.seed.characters.c_other = {id: 'c_other', name: '林澈', aliases: [], present: false, values: {mood: '另一位'}};
  const p = f.bridge.profile('林澈');
  assert.equal(p.csbAmbiguous, true); assert.deepEqual(p.fields, {}); assert.deepEqual(p.card, {});
  assert.equal(f.bridge.promptFor(['林澈']), '');
  await assert.rejects(f.bridge.openEditor('林澈', p.revision), /多位角色/);
});

test('name versus another character alias collisions are treated as ambiguous', () => {
  const f = fixture();
  f.db.seed.characters.c_other = {id: 'c_other', name: '別人', aliases: ['林澈', '阿澈'], present: false, values: {mood: '另一位'}};
  assert.equal(f.bridge.profile('林澈').csbAmbiguous, true);
  assert.equal(f.bridge.profile('阿澈').csbAmbiguous, true);
  assert.equal(f.bridge.profile('別人').csb.id, 'c_other');
});

test('schema edits and field locks change revision even when chat length is constant', () => {
  const f = fixture(); const before = f.bridge.profile('林澈').revision;
  f.db.schema.fields.find(field => field.id === 'qi').label = '法力';
  const afterSchema = f.bridge.profile('林澈').revision;
  assert.notEqual(before, afterSchema);
  f.db.locks.c_lin = {qi: 0}; assert.notEqual(f.bridge.profile('林澈').revision, afterSchema);
});

test('native editor receives stable ID and current scope, and stale revisions are rejected', async () => {
  const f = fixture(); const p = f.bridge.profile('林澈');
  await f.bridge.openEditor('林澈', p.revision);
  assert.deepEqual(f.opened, [{id: 'c_lin', scope: sourceScope(f.c)}]);
  f.db.seed.characters.c_lin.values.qi = 10;
  await assert.rejects(f.bridge.openEditor('林澈', p.revision), {code: 'STALE'});
  assert.equal(f.opened.length, 1);
});

test('CSB records cannot be written through the old fixed CSB21 serializer', async () => {
  const f = fixture(), p = f.bridge.profile('林澈');
  await assert.rejects(f.bridge.save('林澈', {revision: p.revision, fields: {mood: 'wrong'}}), /原生編輯器/);
  assert.equal(f.c.chat.length, 0); assert.equal(f.db.seed.characters.c_lin.values.mood, '安靜');
});

test('switching chats clears CSB source and makes prior editor revision unusable', async () => {
  const f = fixture(), previous = f.bridge.profile('林澈');
  f.switchTo({...f.c, chatId: 'other', chat: [], chatMetadata: {}});
  assert.equal(f.bridge.profile('林澈').csb, undefined);
  await assert.rejects(f.bridge.openEditor('林澈', previous.revision), {code: 'STALE'});
});

test('snapshot API is preferred, cloned, scope checked and respects disabled state', () => {
  const f = fixture(); const snapshot = readCharacterState(f.c, null).snapshot;
  snapshot.state.characters.c_lin.values.qi = 99;
  const api = {apiVersion: 1, getSnapshot: () => snapshot};
  const got = readCharacterState(f.c, api).snapshot;
  assert.equal(got.state.characters.c_lin.values.qi, 99);
  got.state.characters.c_lin.values.qi = 120;
  assert.equal(snapshot.state.characters.c_lin.values.qi, 99);
  snapshot.scope = 'wrong'; assert.equal(readCharacterState(f.c, api).snapshot, null);
  snapshot.scope = sourceScope(f.c); snapshot.enabled = false;
  assert.equal(readCharacterState(f.c, api).snapshot, null);
});

test('read-only fallback never initializes absent CSB data and disabled plugin is skipped', () => {
  const f = fixture(); f.c.extensionSettings[CSB_STATE_KEY].enabled = false;
  assert.equal(readCharacterState(f.c, null).snapshot, null);
  delete f.c.chatMetadata[CSB_STATE_KEY]; delete f.c.extensionSettings[CSB_STATE_KEY];
  const before = JSON.stringify(f.c);
  assert.equal(readCharacterState(f.c, null).snapshot, null);
  assert.equal(JSON.stringify(f.c), before);
});

test('host-disabled standalone CSB is not read through metadata fallback', () => {
  const f = fixture();
  for (const path of ['third-party/csb-character-state', 'third-party/csb_character_state', 'third-party/csb_character_state/']) {
    f.c.extensionSettings.disabledExtensions = [path];
    assert.equal(readCharacterState(f.c, null).snapshot, null, path);
  }
});

test('malformed schema and invalid update report errors instead of corrupting phone state', () => {
  const f = fixture(); f.c.chat.push(update({qi: 'invalid'}));
  assert.equal(f.bridge.profile('林澈').csb.values.qi, 0);
  assert.ok(f.bridge.errors().some(error => /CSB/.test(error.message)));
  f.db.schema.fields[0].id = '__proto__';
  assert.equal(readCharacterState(f.c, null).snapshot, null);
  assert.match(readCharacterState(f.c, null).errors[0].message, /讀取失敗/);
});

test('long CSB names remain addressable without silently truncating to phone event limit', () => {
  const f = fixture(), name = '長'.repeat(80);
  f.db.seed.characters.c_lin.name = name;
  assert.equal(f.bridge.profile(name).csb.id, 'c_lin');
});

test('CSB names sharing their first forty characters stay distinct in directory, editor and prompts', async () => {
  const f = fixture(), prefix = '同'.repeat(40), first = `${prefix}甲`, second = `${prefix}乙`, alias = `${prefix}的別名`;
  Object.assign(f.db.seed.characters.c_lin, {name: first, aliases: [alias]});
  f.db.seed.characters.c_other = {id: 'c_other', name: second, aliases: [], present: true, values: {mood: '第二位'}};
  const directory = f.bridge.profiles();
  assert.ok(directory.some(row => row.name === first)); assert.ok(directory.some(row => row.name === second));
  assert.equal(f.bridge.profile(first).csb.id, 'c_lin'); assert.equal(f.bridge.profile(second).csb.id, 'c_other');
  assert.equal(f.bridge.profile(alias).csb.id, 'c_lin');
  const p = f.bridge.profile(second); await f.bridge.openEditor(second, p.revision);
  assert.equal(f.opened[0].id, 'c_other');
  const prompt = f.bridge.promptFor([second, alias]);
  const facts = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
  assert.deepEqual(facts.map(row => row.characterState.id), ['c_other', 'c_lin']);
});

test('overlong CSB lookup and phone contact names are rejected instead of prefix matched', () => {
  const f = fixture(), longest = '長'.repeat(100);
  f.db.seed.characters.c_lin.name = longest;
  assert.equal(f.bridge.profile(longest).csb.id, 'c_lin');
  assert.equal(f.bridge.profile(`${longest}多`), null);
  assert.equal(f.bridge.promptFor([`${longest}多`]), '');
  assert.deepEqual(contactNames([{app: 'wechat', action: 'message', from: '使用者', to: '名'.repeat(41)}], f.c), []);
});

test('projection returns independent clones and includes unknown or false defaults', () => {
  const f = fixture(); const custom = f.db.schema.fields.find(field => field.id === 'resting');
  custom.default = false; delete f.db.seed.characters.c_lin.values.resting;
  const snapshot = readCharacterState(f.c, null).snapshot;
  const index = indexCharacterState(snapshot); const p = index.resolve('林澈');
  assert.equal(p.csb.values.resting, false); p.csb.values.skills.push('醫術');
  assert.deepEqual(index.resolve('林澈').csb.values.skills, ['劍術']);
});

test('oversized custom schema retains bounded identity and typed fields with explicit omissions', () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) {
    const id = `history_${i}`;
    f.db.schema.fields.push(field(id, `經歷 ${i}`, 'memory', 'longtext'));
    f.db.seed.characters.c_lin.values[id] = '長'.repeat(12000);
  }
  const text = f.bridge.promptFor(['林澈']);
  const facts = JSON.parse(text.slice(text.indexOf('\n') + 1));
  assert.equal(facts[0].characterState.id, 'c_lin');
  assert.equal(facts[0].characterState.partial, true);
  assert.ok(facts[0].characterState.omittedFields > 0);
  assert.equal(facts[0].characterState.fields.find(row => row.id === 'qi').value, 0);
  assert.ok(JSON.stringify(facts).length <= 32000);
  assert.equal(f.bridge.profile('林澈').csb.values.history_9.length, 12000, 'UI/source keeps the entire data');
});
