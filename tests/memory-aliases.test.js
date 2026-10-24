import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveBookName, archiveState, exportArchiveWorldbook, recallActivity} from '../pocket/activity-memory.js';
import {createMemoryMention, memoryMentionCandidates, parseMemoryMentions, resolveMemoryMentions, searchMemoryMentions} from '../pocket/mentions.js';

const forum = {id: 'forum:old', app: 'forum', action: 'post', from: '雲璃', title: '大比議程', text: '論壇紀錄：明日登記，河堤集合。', at: 1};
const shop = {id: 'shop:old', app: 'shop', action: 'catalogue', from: '楊生', itemName: '凝氣丹', text: '萬寶商城報價：補充靈氣', amount: 12.34, at: 2};
const state = () => ({persona: '楊生', profile: {name: '楊生', age: '18', customFields: []}, items: [{id: 'pill', name: '凝氣丹', description: '補充靈氣', source: '萬寶商城購買紀錄', quantity: 1}], abilities: []});

test('new forum and shop recall names retrieve the same old records without activating ordinary prose', () => {
  const rows = [forum, shop], original = JSON.stringify(rows);
  const forumRecall = recallActivity(rows, '回憶論壇之前提到河堤的內容');
  assert.ok(forumRecall);
  for (const name of ['論壇', '论坛', '論道臺', '論道台', '论道台']) {
    assert.equal(recallActivity(rows, `回憶${name}之前提到河堤的內容`), forumRecall, name);
    assert.equal(recallActivity(rows, `他打開${name}。`), '', name);
  }
  const shopRecall = recallActivity(rows, '查詢萬寶商城商品紀錄');
  assert.ok(shopRecall);
  for (const name of ['萬寶商城', '万宝商城', '萬寶閣', '万宝阁']) {
    assert.equal(recallActivity(rows, `查詢${name}商品紀錄`), shopRecall, name);
    assert.equal(recallActivity(rows, `他走進${name}。`), '', name);
  }
  assert.equal(JSON.stringify(rows), original);
});

test('archive search aliases find old saved app wording without changing stored rows', () => {
  const rows = [forum, shop], original = JSON.stringify(rows);
  for (const query of ['商城', '商城報價', '萬寶商城報價', '万宝商城報價', '萬寶閣報價', '万宝阁報價']) {
    assert.deepEqual(archiveState(rows, {query}).records, [shop], query);
  }
  for (const query of ['論壇紀錄', '论坛紀錄', '論道臺紀錄', '论道台紀錄']) {
    assert.deepEqual(archiveState(rows, {query}).records, [forum], query);
  }
  assert.equal(JSON.stringify(rows), original);
});

test('archive export adds new trigger aliases while book name, ownership, IDs and event payload remain stable', () => {
  const book = exportArchiveWorldbook([forum, shop], {scope: 'alias-scope', user: '楊生'});
  assert.equal(archiveBookName('alias-scope', '楊生'), 'Tavern Pocket 手機記憶 · 楊生 · 1klt96y');
  assert.equal(book.name, 'Tavern Pocket 手機記憶 · 楊生 · 1klt96y');
  for (const entry of Object.values(book.entries)) {
    const event = entry.extensions.tavern_pocket_archive.entity === forum.id ? forum : shop;
    assert.deepEqual(entry.extensions.tavern_pocket_archive, {owner: 'tavern-pocket', version: 1, scope: 'alias-scope', entity: event.id});
    assert.equal(entry.content.slice(entry.content.indexOf('\n') + 1), JSON.stringify(event));
    const keys = event.app === 'forum' ? ['查閱論壇紀錄', '查閱論道臺紀錄', '查阅论道台记录'] : ['查閱萬寶商城紀錄', '查閱萬寶閣紀錄', '查阅万宝阁记录'];
    for (const key of keys) assert.ok(entry.key.includes(key), key);
  }
});

test('吾身錄 references and renamed-source searches resolve old data without changing mention tokens', () => {
  const s = state(), original = JSON.stringify(s), rows = memoryMentionCandidates(s);
  assert.equal(createMemoryMention(s, rows.find(row => row.key === 'profile:all')), '@【資訊：我的資訊｜楊生｜all】');
  assert.equal(createMemoryMention(s, rows.find(row => row.key === 'items:pill')), '@【物品：凝氣丹｜楊生｜rpill】');
  const oldReferences = resolveMemoryMentions('@我', s).references;
  for (const alias of ['吾身錄', '吾身录']) {
    assert.deepEqual(resolveMemoryMentions('@' + alias, s).references, oldReferences);
    assert.equal(searchMemoryMentions(s, alias)[0]?.key, 'profile:all');
  }
  for (const alias of ['商城', '商城購買', '萬寶商城', '万宝商城', '萬寶閣', '万宝阁']) assert.equal(searchMemoryMentions(s, alias)[0]?.key, 'items:pill');
  for (const text of ['name@吾身錄', '`@吾身錄`', '<div title="@吾身錄">', '@吾身錄尚未結束']) assert.equal(parseMemoryMentions(text).length, 0, text);
  assert.equal(JSON.stringify(s), original);
});
