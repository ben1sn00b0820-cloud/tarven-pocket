import test from 'node:test';
import assert from 'node:assert/strict';
import {createStoryClock, readStoryTime, splitStoryTime, STORY_TIME_KEY} from '../pocket/story-time.js';
import {newDatabase} from '../companions/csb-character-state/src/schema.js';
import {sourceScope} from '../pocket/source-sync.js';
import {createPocketHost} from '../pocket/host.js';

const message = mes => ({name: '旁白', is_user: false, mes});
const context = (chat = []) => ({chatId: 'story-a', characterId: 0, groupId: null,
  characters: [{name: '雲璃', avatar: 'yunli.png'}], name1: '我', name2: '雲璃',
  chat, chatMetadata: {}, extensionSettings: {}, saveMetadata: async () => {}, saveSettingsDebounced() {}});
const structured = time => `<CSB_UPDATE>${JSON.stringify({version: 1, scene: {time}, characters: []})}</CSB_UPDATE>`;
const csb = time => () => ({snapshot: {state: {scene: {time}}}});

test('unknown is explicit and reading neither uses device dates nor mutates metadata', () => {
  const c = context([message('她問：「明天下午三點見？」')]);
  const before = JSON.stringify(c);
  const result = readStoryTime(c, {characterState: () => ({snapshot: null})});
  assert.deepEqual(result, {date: '', time: '', label: '劇情時間未設定', source: 'unknown', known: false});
  assert.equal(JSON.stringify(c), before);
  assert.equal(readStoryTime({...c, chatId: ''}).known, false);
});

test('fantasy calendars and traditional periods are preserved without a Gregorian conversion', () => {
  assert.deepEqual(splitStoryTime('景元三年冬月初八 · 子時'), {date: '景元三年冬月初八', time: '子時', label: '景元三年冬月初八 · 子時'});
  assert.deepEqual(splitStoryTime('夜間'), {date: '', time: '夜間', label: '夜間'});
  assert.deepEqual(splitStoryTime('第三日'), {date: '第三日', time: '', label: '第三日'});
  assert.deepEqual(splitStoryTime('2026-03-04 09:15'), {date: '2026-03-04', time: '09:15', label: '2026-03-04 09:15'});
});

test('explicit narrative date and time labels are read together', () => {
  const c = context([message('**劇情日期**：景元三年冬月初八\n【劇情時間：子時】\n眾人離開客棧。')]);
  const result = readStoryTime(c);
  assert.equal(result.date, '景元三年冬月初八');
  assert.equal(result.time, '子時');
  assert.equal(result.source, 'narrative');
  assert.equal(result.known, true);
});

test('quoted dates, planned dialogue, examples and hidden reasoning do not move time', () => {
  const c = context([message('劇情時間：黃昏'), message('她說：「劇情時間：凌晨」\n> 劇情時間：凌晨\n```text\n劇情時間：午夜\n```\n<think>\n劇情時間：清晨\n</think>\n明天下午他們會面。')]);
  assert.equal(readStoryTime(c).time, '黃昏');
  c.chat.push(message('```text\n劇情時間：子時'));
  assert.equal(readStoryTime(c).time, '黃昏');
});

test('system and mirrored phone activity do not become narrative clocks', () => {
  const c = context([{mes: '劇情時間：午時', is_system: true}, {mes: '劇情時間：清晨', extra: {tavern_pocket_activity: true}}]);
  assert.equal(readStoryTime(c).known, false);
});

test('CSB scene time is the authority over older explicit narrative labels', () => {
  const c = context([message('劇情時間：黃昏'), message(structured('景元三年冬月初八 子時'))]);
  const result = readStoryTime(c, {characterState: csb('景元三年冬月初八 子時')});
  assert.equal(result.source, 'csb'); assert.equal(result.date, '景元三年冬月初八'); assert.equal(result.time, '子時');
});

test('a later explicit marker supersedes the CSB source only when snapshot still matches it', () => {
  const c = context([message(structured('清晨')), message('劇情時間：正午')]);
  assert.equal(readStoryTime(c, {characterState: csb('清晨')}).time, '正午');
  assert.equal(readStoryTime(c, {characterState: csb('清晨')}).source, 'narrative');
  assert.equal(readStoryTime(c, {characterState: csb('黃昏')}).time, '黃昏');
  assert.equal(readStoryTime(c, {characterState: csb('黃昏')}).source, 'csb');
});

test('CSB seed or manual state without raw time markers keeps authority', () => {
  const c = context([message('劇情時間：早晨')]);
  assert.equal(readStoryTime(c, {characterState: csb('深夜')}).time, '深夜');
});

test('same-message ordering is deterministic', () => {
  let c = context([message(structured('清晨') + '\n劇情時間：正午')]);
  assert.equal(readStoryTime(c, {characterState: csb('清晨')}).time, '正午');
  c = context([message('劇情時間：正午\n' + structured('清晨'))]);
  assert.equal(readStoryTime(c, {characterState: csb('清晨')}).time, '清晨');
});

test('selected swipe, edits, and message deletion recompute rather than retaining a stale clock', () => {
  const c = context([message('劇情時間：清晨'), message('劇情時間：正午')]);
  const last = c.chat[1]; last.swipes = [last.mes, '劇情時間：深夜']; last.swipe_id = 0;
  assert.equal(readStoryTime(c).time, '正午');
  last.mes = last.swipes[1]; last.swipe_id = 1;
  assert.equal(readStoryTime(c).time, '深夜');
  c.chat.pop(); assert.equal(readStoryTime(c).time, '清晨');
  c.chat[0].mes = '此段未提供時間。'; assert.equal(readStoryTime(c).known, false);
});

test('real CSB snapshot fallback reads an isolated database without creating message IDs', () => {
  const c = context([message(structured('第三日 06:30'))]);
  c.chatMetadata.csb_character_state_v1 = newDatabase();
  const before = JSON.stringify(c);
  const result = readStoryTime(c);
  assert.equal(result.source, 'csb'); assert.equal(result.time, '06:30'); assert.equal(result.date, '第三日');
  assert.equal(JSON.stringify(c), before);
});

test('manual per-chat override persists once and clear resumes automatic reading', async () => {
  const c = context([message('劇情時間：正午')]); let saves = 0, changed = 0;
  c.saveMetadata = async () => { saves++; };
  const clock = createStoryClock({context: () => c, onChange: () => changed++});
  assert.equal(clock.current().time, '正午');
  const value = await clock.set({date: '玄衡紀元二十九年', time: '子時'});
  assert.equal(value.source, 'manual'); assert.equal(value.date, '玄衡紀元二十九年'); assert.equal(value.time, '子時');
  assert.equal(saves, 1); assert.equal(changed, 1);
  assert.equal(c.chatMetadata[STORY_TIME_KEY].scope, sourceScope(c));
  const restored = await clock.set(null);
  assert.equal(restored.source, 'narrative'); assert.equal(restored.time, '正午');
  assert.equal(Object.hasOwn(c.chatMetadata, STORY_TIME_KEY), false); assert.equal(saves, 2);
});

test('manual override cannot leak across chats even when metadata was copied', async () => {
  let c = context(); const clock = createStoryClock({context: () => c});
  await clock.set({label: '冬月初八 深夜'}); const old = c;
  c = {...context(), chatId: 'story-b', chatMetadata: structuredClone(old.chatMetadata)};
  assert.equal(clock.current().known, false);
  c = old; assert.equal(clock.current().source, 'manual');
});

test('invalid manual values never write and explicit clear is supported', async () => {
  const c = context(); let saves = 0; c.saveMetadata = async () => { saves++; };
  const clock = createStoryClock({context: () => c});
  for (const value of [{}, {time: 123}, {time: 'x'.repeat(121)}, ['子時']]) await assert.rejects(clock.set(value));
  assert.equal(saves, 0); assert.deepEqual(c.chatMetadata, {});
  await clock.set({time: '子時'}); await clock.set({clear: true});
  assert.equal(clock.current().known, false);
});

test('failed save restores original per-chat override', async () => {
  const c = context(); const clock = createStoryClock({context: () => c});
  await clock.set({time: '午時'}); const before = structuredClone(c.chatMetadata);
  c.saveMetadata = async () => { throw Error('disk full'); };
  await assert.rejects(clock.set({time: '子時'}), /disk full/);
  assert.deepEqual(c.chatMetadata, before);
  await assert.rejects(clock.set(null), /disk full/);
  assert.deepEqual(c.chatMetadata, before);
});

test('switching chats during persistence never writes into the new chat', async () => {
  let c = context(), finish; const previous = c;
  c.saveMetadata = () => new Promise(resolve => { finish = resolve; });
  const clock = createStoryClock({context: () => c});
  const pending = clock.set({time: '子時'});
  c = {...context(), chatId: 'story-b'}; finish();
  await assert.rejects(pending, /聊天已切換/);
  assert.deepEqual(c.chatMetadata, {}); assert.equal(previous.chatMetadata[STORY_TIME_KEY], undefined);
});

test('closed clocks reject writes and concurrent saves do not overwrite one another', async () => {
  const c = context(); let finish; c.saveMetadata = () => new Promise(resolve => { finish = resolve; });
  const clock = createStoryClock({context: () => c}); const pending = clock.set({time: '子時'});
  await assert.rejects(clock.set({time: '午時'}), /正在保存/); finish(); await pending;
  clock.dispose(); await assert.rejects(clock.set(null), /已關閉/);
});

test('pocket bridge exposes scene clock and emits an update when manual time changes', async () => {
  const c = context([message('劇情時間：黃昏')]), emitted = [];
  const backend = {settings: {text: {}, chat: {}}, wallet: () => ({balance: 0, inventory: []}),
    library: {}, spaceKey: () => '', threads: async () => [], chats: {list: async () => []},
    emit: (...args) => emitted.push(args), generateText: async () => ''};
  const host = createPocketHost({context: () => c, backend});
  try {
    assert.equal((await host.api().pocketState()).storyTime.time, '黃昏');
    const result = await host.api().setStoryTime({time: '子時'});
    assert.equal(result.source, 'manual'); assert.equal((await host.api().pocketState()).storyTime.time, '子時');
    assert.equal(emitted.at(-1)[0], 'pocket');
  } finally { host.dispose(); }
});
