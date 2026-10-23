import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNarrativeAcquisitions, createNarrativeMemory} from '../pocket/narrative-memory.js';

const parse = text => parseNarrativeAcquisitions(text, {isUser: true, messageKey: 'message-1'});
const message = mes => ({is_user: true, name: '小王', mes, extra: {}});
const sample = '前面發生車禍了，我發現我現在需要特殊能力，我打開小手機，進入萬寶商城，購買了時間停止能力…';
const metadataKey = 'tavern_pocket_narrative_memory_v1';
function harness(chat = []) {
  let c = {chatId: 'story', characterId: 0, characters: [{avatar: 'lin.png'}], chat, chatMetadata: {}, name1: '小王'}, onAcquire = null, saves = 0;
  const calls = [], inventory = new Map(), notices = [];
  c.saveChat = async () => { saves++; };
  c.saveMetadata = async () => { saves++; };
  const acquire = async (event, options) => {
    calls.push(event);
    if (onAcquire) await onAcquire(event, options);
    if (!options.isCurrent()) throw Object.assign(Error('source changed'), {code: 'STALE'});
    if (!inventory.has(event.id)) inventory.set(event.id, event);
  };
  const create = () => createNarrativeMemory({context: () => c, acquire, notice: text => notices.push(text)});
  return {bridge: create(), create, calls, inventory, notices, context: () => c, onAcquire: fn => { onAcquire = fn; }, saves: () => saves, switch: () => { c = {...c, chatId: 'other-story', chat: [], chatMetadata: {}}; }};
}

test('inline completed Wanbao purchase extracts an ability from the user accident narrative without inventing a price', () => {
  const {events, errors} = parse(sample);
  assert.equal(errors.length, 0); assert.equal(events.length, 1);
  assert.deepEqual(events[0], {id: 'narrative:message-1:0', kind: 'abilities', name: '時間停止能力', description: '正文取得／未記載價格。', acquisition: 'purchase'});
  assert.equal(parse('於萬寶商城購買了「急救包」。').events[0].kind, 'items');
  assert.equal(parse('我在萬寶商城購買了「隱身斗篷」。').events[0].kind, 'items');
});

test('explicit memory commands are distinct from purchases and never imply payment', () => {
  const ability = parse('記住我的能力：時間停止').events[0], item = parse('請把「急救包」加入我的物品。').events[0];
  assert.equal(ability.acquisition, 'remember'); assert.equal(ability.name, '時間停止'); assert.equal(ability.kind, 'abilities');
  assert.equal(item.acquisition, 'remember'); assert.equal(item.kind, 'items'); assert.equal(item.name, '急救包');
  assert.equal(item.price, undefined);
});

test('an explicit price is recorded as information and parsing itself cannot charge or select a catalogue item', () => {
  const result = parse('我在萬寶商城花費100元購買了「急救包」。').events[0];
  assert.equal(result.price, 100); assert.equal(result.name, '急救包'); assert.match(result.description, /100\.00/);
});

test('assistant output, quoted examples, code, hypotheses, intentions, negations and third-party purchases cannot grant assets', () => {
  assert.equal(parseNarrativeAcquisitions(sample, {isUser: false, messageKey: 'assistant'}).events.length, 0);
  assert.equal(parseNarrativeAcquisitions(sample, {isUser: true, mirrored: true}).events.length, 0);
  for (const text of [
    '如果我在萬寶商城購買了時間停止能力，就好了。', '我想在萬寶商城購買了時間停止能力。',
    '我沒有在萬寶商城購買了時間停止能力。', '我在萬寶商城沒有購買時間停止能力。',
    '例如：我在萬寶商城購買了時間停止能力。', '他說：「我在萬寶商城購買了時間停止能力。」',
    '> 我在萬寶商城購買了時間停止能力。', '`我在萬寶商城購買了時間停止能力。`',
    '```text\n我在萬寶商城購買了時間停止能力。\n```', '<phone>我在萬寶商城購買了時間停止能力。</phone>',
    '[CSB21_PANEL]\n我在萬寶商城購買了時間停止能力。\n[/CSB21_PANEL]',
    '林澈進入萬寶商城，購買了時間停止能力。', '我打開小手機，林澈進入萬寶商城，購買了時間停止能力。',
  ]) assert.equal(parse(text).events.length, 0, text);
});

test('initial enable establishes a persisted history baseline; a new user acquisition applies before awaited sync returns', async () => {
  const h = harness([message('我在萬寶商城購買了「舊物品」。')]);
  assert.equal((await h.bridge.sync()).baseline, true); assert.equal(h.calls.length, 0);
  h.context().chat.push(message(sample));
  assert.equal((await h.bridge.sync()).acquired, 1); assert.equal(h.inventory.size, 1);
  assert.equal([...h.inventory.values()][0].name, '時間停止能力');
  assert.equal(h.context().chatMetadata[metadataKey].initialized, true);
  assert.ok(h.context().chat.every(item => item.extra.tavern_pocket_narrative_id));
});

test('replay, deletion and restore keep acquisition idempotent; editing a committed event reports a conflict rather than granting a replacement', async () => {
  const h = harness(); await h.bridge.baseline();
  const row = message(sample); h.context().chat.push(row); await h.bridge.sync();
  assert.equal((await h.bridge.sync()).skipped, 1); assert.equal(h.calls.length, 1);
  h.context().chat.splice(0, 1); await h.bridge.sync(); h.context().chat.push(row); await h.bridge.sync();
  assert.equal(h.calls.length, 1); assert.equal(h.inventory.size, 1);
  row.mes = '我在萬寶商城購買了「瞬間移動能力」。';
  const report = await h.bridge.sync(); assert.equal(report.errors[0].code, 'COMMITTED_CHANGED'); assert.equal(h.calls.length, 1);
  assert.equal([...h.inventory.values()][0].name, '時間停止能力');
});

test('stable message identity does not change when another bridge later assigns its own source id', async () => {
  const h = harness(); await h.bridge.baseline(); h.context().chat.push(message(sample));
  await h.bridge.sync(); const id = h.calls[0].id;
  h.context().chat[0].extra.tavern_pocket_source_id = 'assigned-later'; await h.bridge.sync();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].id, id);
});

test('persisted acquisition journal survives a recreated bridge and resumes pending work by the same callback id', async () => {
  const h = harness(); await h.bridge.baseline(); h.context().chat.push(message(sample)); await h.bridge.sync();
  const entry = Object.values(h.context().chatMetadata[metadataKey].records)[0]; entry.status = 'pending';
  const restored = h.create(); await restored.sync();
  assert.equal(h.calls.length, 2); assert.equal(h.calls[0].id, h.calls[1].id); assert.equal(h.inventory.size, 1);
  await restored.sync(); assert.equal(h.calls.length, 2);
});

test('failed acquisition is reported and requires an explicit retry instead of retrying whenever the chat emits', async () => {
  const h = harness(); await h.bridge.baseline(); h.context().chat.push(message(sample));
  h.onAcquire(() => { throw Object.assign(Error('虛擬餘額不足'), {code: 'INSUFFICIENT'}); });
  const first = await h.bridge.sync(); assert.equal(first.errors[0].code, 'INSUFFICIENT'); assert.equal(h.inventory.size, 0);
  await h.bridge.sync(); assert.equal(h.calls.length, 1);
  h.onAcquire(null); const retried = await h.bridge.sync({retryErrors: true});
  assert.equal(retried.acquired, 1); assert.equal(h.calls.length, 2); assert.equal(h.inventory.size, 1);
});

test('activity mirrors and assistant narration never reach acquisition callbacks, including after baseline', async () => {
  const h = harness(); await h.bridge.baseline();
  h.context().chat.push({...message(sample), extra: {tavern_pocket_activity: {ids: ['mirror']}}}, {is_user: false, name: '林澈', mes: sample});
  assert.equal((await h.bridge.sync()).acquired, 0); assert.equal(h.calls.length, 0);
});

test('acquisition callback receives a guard that rejects deleted or edited source before commit', async () => {
  const h = harness(); await h.bridge.baseline(); h.context().chat.push(message(sample));
  h.onAcquire((event, options) => { h.context().chat[0].mes = '我不買了。'; assert.equal(options.isCurrent(), false); });
  const report = await h.bridge.sync(); assert.equal(report.errors[0].code, 'STALE'); assert.equal(h.inventory.size, 0);
});

test('switching stories while acquiring rejects the old operation without adding to the new story', async () => {
  const h = harness(); await h.bridge.baseline(); h.context().chat.push(message(sample));
  h.onAcquire((event, options) => { h.switch(); assert.equal(options.isCurrent(), false); });
  await assert.rejects(h.bridge.sync(), {code: 'STALE'}); assert.equal(h.inventory.size, 0); assert.equal(h.context().chat.length, 0);
});

test('pending acquisition does not resume into a different selected user persona', async () => {
  const h = harness(); await h.bridge.baseline(); h.context().chat.push(message(sample)); await h.bridge.sync();
  Object.values(h.context().chatMetadata[metadataKey].records)[0].status = 'pending';
  h.context().name1 = '另一個身分';
  const result = await h.create().sync();
  assert.equal(result.errors[0].code, 'PERSONA_CHANGED'); assert.equal(h.calls.length, 1); assert.equal(h.inventory.size, 1);
});

test('a pending receipt cannot reuse an already-issued acquisition id for an edited item', async () => {
  const h = harness(); await h.bridge.baseline(); h.context().chat.push(message(sample)); await h.bridge.sync();
  Object.values(h.context().chatMetadata[metadataKey].records)[0].status = 'pending';
  h.context().chat[0].mes = '我在萬寶商城購買了「急救包」。';
  const report = await h.create().sync();
  assert.equal(report.errors[0].code, 'RECORDED_CHANGED'); assert.equal(h.calls.length, 1);
  assert.equal([...h.inventory.values()][0].name, '時間停止能力');
});
