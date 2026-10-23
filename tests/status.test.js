import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {STATUS_FIELDS, STATUS_LIMITS, parseStatusPanels, stripStatusPanels, collectCharacterProfiles, extractCharacterCard, serializeStatusProfile} from '../pocket/status.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/CharacterStatus_WorldInfo_v2.1.json', import.meta.url), 'utf8'));
const protocol = Object.values(fixture.entries).map(entry => entry.content).join('\n');
const template = protocol.slice(protocol.lastIndexOf('[CSB21_PANEL]'), protocol.lastIndexOf('[/CSB21_PANEL]') + '[/CSB21_PANEL]'.length);
function role(name, values = {}, parts = [{name: '頭部', value: ''}, {name: '自訂部位 01', value: ''}], token = '21') {
  const defaults = Object.fromEntries(STATUS_FIELDS.map(key => [key, ['affection', 'trust', 'energy', 'fatigue', 'stress', 'satiety', 'hydration', 'lewdness'].includes(key) ? '未知' : '未交代']));
  const data = {name, ...defaults, ...values};
  const lines = Object.entries(data).map(([key, value]) => `${key === 'lewdness' && token === '2' ? 'hygiene' : key}: ${value}`);
  return `[CSB${token}_ROLE]\n${lines.join('\n')}\nbody:\n${parts.map(part => `[CSB${token}_PART|${part.name}|${part.value}]`).join('\n')}\n[/CSB${token}_ROLE]`;
}
const panel = (roles, time = '傍晚', token = '21') => `[CSB${token}_PANEL]\ntime: ${time}\n${roles.join('\n')}\n[/CSB${token}_PANEL]`;
const message = mes => ({name: '阿澤', mes});
const ctx = chat => ({chat, name1: '小雨', name2: '阿澤', chatId: 'one', characterId: 0, characters: [{name: '阿澤', avatar: 'a.png', description: '身高：180 公分\n體重：72 公斤\n身材：高挑\n外貌：黑髮\n年齡：22'}]});

test('edited profiles serialize every CSB21 field, unknown meters, and renamed or blank body rows', () => {
  const result = serializeStatusProfile('阿澤', {fields: {mood: '舒適', hydration: 0}, time: '翌日', body: [{name: '手腕', value: '已恢復'}, {name: '自訂', value: ''}]});
  const parsed = parseStatusPanels(result.text);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.panels[0].roles[0].fields.hydration, '0');
  assert.equal(parsed.panels[0].roles[0].fields.energy, '未知');
  assert.deepEqual(parsed.panels[0].roles[0].body, result.body);
  assert.equal(Object.keys(parsed.panels[0].roles[0].fields).length, STATUS_FIELDS.length);
});

test('edited profile protocol rejects malformed data rather than truncating or inventing values', () => {
  const draft = {fields: {}, body: []};
  for (const hydration of ['101', '-1', '50%', '1.5', '']) assert.throws(() => serializeStatusProfile('阿澤', {...draft, fields: {hydration}}), /0–100/);
  assert.throws(() => serializeStatusProfile('阿澤', {...draft, fields: {bad: '未知'}}), /不支援/);
  assert.throws(() => serializeStatusProfile('阿澤', {...draft, body: [{name: '', value: ''}]}), /不可空白/);
  assert.throws(() => serializeStatusProfile('阿澤', {...draft, body: [{name: '手', value: 'a|b'}]}), /包含/);
  assert.throws(() => serializeStatusProfile('阿澤', {...draft, time: '今天\n[CSB21_ROLE]'}), /保留字元/);
  assert.throws(() => serializeStatusProfile('阿澤', {...draft, body: Array.from({length: 201}, () => ({name: '手', value: ''}))}), /最多/);
});

test('the exact authoritative CSB v2.1 template parses including all sixteen blank body parts', () => {
  const parsed = parseStatusPanels(template);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.panels[0].version, '2.1');
  assert.equal(parsed.panels[0].roles[0].name, '角色姓名');
  assert.equal(parsed.panels[0].roles[0].body.length, 16);
  assert.ok(parsed.panels[0].roles[0].body.every(part => part.value === ''));
});
test('two roles retain independent custom labels, blank fields and latest time', () => {
  const parsed = parseStatusPanels(panel([
    role('阿澤', {satiety: '70', hydration: '0'}, [{name: '左手', value: '使用者填寫'}, {name: '預留', value: ''}]),
    role('小林', {satiety: '未知'}, [{name: '左手', value: ''}]),
  ], '翌日早晨'));
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.panels[0].time, '翌日早晨');
  assert.equal(parsed.panels[0].roles[0].fields.hydration, '0');
  assert.equal(parsed.panels[0].roles[1].fields.satiety, '未知');
  assert.deepEqual(parsed.panels[0].roles[0].body, [{name: '左手', value: '使用者填寫'}, {name: '預留', value: ''}]);
  assert.deepEqual(parsed.panels[0].roles[1].body, [{name: '左手', value: ''}]);
});
test('partial streamed panels are inert and stripping preserves narrative and partial tags', () => {
  const complete = panel([role('阿澤')]);
  const partial = panel([role('小林')]).replace('[/CSB21_PANEL]', '');
  assert.deepEqual(parseStatusPanels(partial), {panels: [], errors: []});
  assert.equal(stripStatusPanels('前文' + complete + '\n' + partial), '前文\n' + partial);
  assert.equal(stripStatusPanels('<phone>{"id":"test"}</phone><img>風景</img>'), '<phone>{"id":"test"}</phone><img>風景</img>');
});
test('an incomplete role cannot erase the latest valid complete snapshot', () => {
  const good = panel([role('阿澤', {mood: '平靜'})]);
  const broken = panel([role('阿澤', {mood: '不可套用'}).replace('age: 未交代\n', '')]);
  const c = ctx([message(good), message(broken)]);
  const result = collectCharacterProfiles(c);
  assert.equal(result.profiles[0].fields.mood, '平靜');
  assert.ok(result.errors.some(error => error.code === 'incomplete-role' && error.messageIndex === 1));
});
test('numeric meters are bounded, unknown stays unknown, and v2 hygiene never becomes lewdness', () => {
  for (const value of ['-1', '101', '1.5', '50%', '', 'NaN']) {
    assert.equal(parseStatusPanels(panel([role('阿澤', {hydration: value})])).panels[0].roles.length, 0);
  }
  const old = parseStatusPanels(panel([role('阿澤', {lewdness: '88'}, [], '2')], '昨天', '2'));
  assert.deepEqual(old.errors, []);
  assert.equal(old.panels[0].roles[0].fields.hygiene, '88');
  assert.equal(old.panels[0].roles[0].fields.lewdness, undefined);
  const c = ctx([message(panel([role('阿澤', {lewdness: '88'}, [], '2')], '昨天', '2')), message(panel([role('阿澤')]))]);
  const profile = collectCharacterProfiles(c).profiles[0];
  assert.equal(profile.fields.lewdness, '未知');
  assert.equal(profile.fields.hygiene, undefined);
});
test('latest complete snapshot wins, absent roles remain known, and later blanks are not backfilled', () => {
  const c = ctx([
    message(panel([role('阿澤', {mood: '不開心'}, [{name: '肩', value: '明確手填'}]), role('小林', {mood: '愉快'})], '早晨')),
    message(panel([role('阿澤', {mood: '平靜'}, [{name: '肩', value: ''}])], '晚上')),
    message(panel([], '深夜')),
  ]);
  const profiles = collectCharacterProfiles(c).profiles;
  assert.equal(profiles.length, 2);
  assert.equal(profiles.find(profile => profile.name === '阿澤').time, '晚上');
  assert.equal(profiles.find(profile => profile.name === '小林').fields.mood, '愉快');
  assert.equal(profiles.find(profile => profile.name === '阿澤').body[0].value, '');
});
test('editing, deleting and switching selected swipe recomputes from current mes without stale data', () => {
  const earlier = panel([role('阿澤', {mood: '早前'})]);
  const c = ctx([message(earlier), {mes: panel([role('阿澤', {mood: '現在'}), role('小林')]), swipes: [panel([role('不應載入')])]}]);
  assert.equal(collectCharacterProfiles(c).profiles[0].fields.mood, '現在');
  c.chat[1].mes = panel([role('阿澤', {mood: '編輯後'})]);
  assert.equal(collectCharacterProfiles(c).profiles[0].fields.mood, '編輯後');
  assert.equal(collectCharacterProfiles(c).profiles.some(profile => profile.name === '小林'), false);
  assert.equal(collectCharacterProfiles(c).profiles.some(profile => profile.name === '不應載入'), false);
  c.chat.pop();
  assert.equal(collectCharacterProfiles(c).profiles[0].fields.mood, '早前');
});
test('the same name in a different chat never inherits a prior projection', () => {
  const first = ctx([message(panel([role('阿澤', {mood: 'one'})]))]);
  const second = {...ctx([message(panel([role('阿澤', {mood: 'two'})]))]), chatId: 'two'};
  const a = collectCharacterProfiles(first).profiles[0], b = collectCharacterProfiles(second).profiles[0];
  assert.notEqual(a.source.scope, b.source.scope);
  assert.equal(b.fields.mood, 'two');
  second.chat = [];
  assert.deepEqual(collectCharacterProfiles(second).profiles[0].fields, {});
});
test('duplicate role names use the last complete role and conflicting duplicate fields fail closed', () => {
  const result = parseStatusPanels(panel([role('阿澤', {mood: 'before'}), role('阿澤', {mood: 'after'})]));
  assert.equal(result.panels[0].roles.length, 1);
  assert.equal(result.panels[0].roles[0].fields.mood, 'after');
  assert.ok(result.errors.some(error => error.code === 'duplicate-name'));
  const conflict = parseStatusPanels(panel([role('阿澤').replace('body:', 'mood: 衝突\nbody:')]));
  assert.equal(conflict.panels[0].roles.length, 0);
  assert.ok(conflict.errors.some(error => error.code === 'conflicting-field'));
});
test('card fields come only from labelled facts and never fill reserved body data', () => {
  const c = ctx([message(panel([role('阿澤')]))]);
  const profile = collectCharacterProfiles(c).profiles[0];
  assert.deepEqual(profile.card.fields, {height: '180 公分', weight: '72 公斤', build: '高挑', appearance: '黑髮', age: '22'});
  assert.equal(profile.fields.age, '未交代');
  assert.ok(profile.body.every(part => part.value === ''));
  c.characters[0].description = '看起來很高、纖細，總之是一位漂亮的人。';
  assert.deepEqual(extractCharacterCard(c, '阿澤').fields, {});
});
test('inline card labels and conventional labelled measurements parse without guessed conversion', () => {
  const c = ctx([]);
  c.characters[0].description = '- **身高**：180cm，體重：72kg；身材：纖長，外貌：黑髮黑眼\n三圍：未交代';
  assert.deepEqual(extractCharacterCard(c, '阿澤').fields, {height: '180cm', weight: '72kg', build: '纖長', appearance: '黑髮黑眼', measurements: '未交代'});
  c.characters[0].description = '身高 180 cm，體重 72 kg';
  assert.deepEqual(extractCharacterCard(c, '阿澤').fields, {height: '180 cm', weight: '72 kg'});
});
test('NPCs only receive exact named sections, not the parent card or near-matching names', () => {
  const c = ctx([]);
  c.characters[0].description = '身高：180cm\n【小林】\n身高：165cm\n身材：纖細\n【小林子】\n身高：190cm\n【其他角色】\n體重：99kg';
  assert.deepEqual(extractCharacterCard(c, '阿澤').fields, {height: '180cm'});
  const npc = extractCharacterCard(c, '小林');
  assert.deepEqual(npc.fields, {height: '165cm', build: '纖細'});
  assert.equal(npc.source.kind, 'card-section');
  assert.doesNotMatch(npc.text, /180|190|99/);
  assert.equal(extractCharacterCard(c, '小'), undefined);
  assert.equal(extractCharacterCard(c, '不存在'), undefined);
});
test('active group members can supply exact cards, unrelated cards do not become contacts', () => {
  const c = ctx([]);
  c.characters.push({name: '小林', avatar: 'b.png', data: {description: '身高：165cm'}}, {name: '旁人', avatar: 'c.png', description: '身高：170cm'});
  c.groupId = 'g'; c.groups = [{id: 'g', members: ['a.png', 'b.png']}];
  assert.deepEqual(collectCharacterProfiles(c).profiles.map(profile => profile.name), ['阿澤', '小林']);
  assert.deepEqual(extractCharacterCard(c, '小林').fields, {height: '165cm'});
});
test('ambiguous exact card names are not guessed, but the single active card wins', () => {
  const c = ctx([]);
  c.characters.push({name: '小林', avatar: 'b.png', description: '身高：165cm'}, {name: '小林', avatar: 'c.png', description: '身高：170cm'});
  assert.equal(extractCharacterCard(c, '小林'), undefined);
  c.characterId = 2;
  assert.equal(extractCharacterCard(c, '小林').fields.height, '170cm');
});
test('HTML-looking content stays inert plain text and prototype fields cannot alter objects', () => {
  const attack = '<img src=x onerror="globalThis.pwned=1">';
  const parsed = parseStatusPanels(panel([role('阿澤', {note: attack})]));
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.panels[0].roles[0].fields.note, attack);
  assert.equal(globalThis.pwned, undefined);
  const polluted = parseStatusPanels(panel([role('阿澤').replace('body:', '__proto__: hacked\nbody:')]));
  assert.equal(polluted.panels[0].roles.length, 0);
  assert.equal({}.hacked, undefined);
});
test('system messages and rendered or off-swipe fields do not create status profiles', () => {
  const c = ctx([{is_system: true, mes: panel([role('系統人')])}, {mes: '正文', extra: {rendered: panel([role('HTML人')])}}]);
  assert.deepEqual(collectCharacterProfiles(c).profiles.map(profile => profile.name), ['阿澤']);
});
test('malformed nested tags, malformed body parts and oversized input remain non-actionable', () => {
  const badPart = panel([role('阿澤').replace('[CSB21_PART|頭部|]', '[CSB21_PART|頭部]')]);
  assert.equal(parseStatusPanels(badPart).panels[0].roles.length, 0);
  const nested = panel([role('阿澤').replace('age: 未交代', '[CSB21_ROLE]\nage: 未交代')]);
  assert.equal(parseStatusPanels(nested).panels[0].roles.length, 0);
  assert.equal(parseStatusPanels('x'.repeat(STATUS_LIMITS.message + 1)).errors[0].code, 'message-limit');
});
