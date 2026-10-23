import test from 'node:test';
import assert from 'node:assert/strict';
import {createForumSource, forumSourceId} from '../pocket/forum-source.js';
import {sourceScope} from '../pocket/source-sync.js';

const clone = value => structuredClone(value);
function harness(initial = []) {
  let c = {chatId: 'story', characterId: 0, characters: [{avatar: 'lin.png'}], chat: [], chatMetadata: {}, name1: '小王'}, beforeChange;
  const docs = new Map(initial.map(doc => [doc.id, clone(doc)])), emitted = [];
  const backend = {closed: false, spaceKey: () => 'card:lin.png', apps: {
    list: async kind => [...docs.values()].filter(doc => !kind || doc.kind === kind).map(clone),
    put: async list => { for (const doc of list) docs.set(doc.id, clone(doc)); return list.map(clone); },
    change: async (id, mutator) => {
      if (beforeChange) { const fn = beforeChange; beforeChange = null; await fn(); }
      const row = clone(docs.get(id)); if (!row) throw Object.assign(Error('missing'), {code: 'MISSING'});
      mutator(row); docs.set(id, row); return clone(row);
    },
  }, appsMutate: async (kind, fn) => { const result = await fn(); emitted.push(kind); return result; }};
  const source = createForumSource({context: () => c, backend});
  return {source, backend, docs, emitted, scope: sourceScope(c), context: () => c, switch: () => { c = {...c, chatId: 'new-story', chat: [], chatMetadata: {}}; }, beforeChange: fn => { beforeChange = fn; }};
}
const post = (id = 'post-1', text = '今天咖啡館開幕。') => ({app: 'forum', action: 'post', id, from: '林澈', title: '新店開幕', board: '生活', text, at: 100});
const reply = (id = 'reply-1', ref = 'post-1', text = '一起去看看。') => ({app: 'forum', action: 'comment', id, ref, from: '蘇晴', text, at: 101});

test('forum source imports posts and replies with deterministic ids and explicit origins without repeated copies', async () => {
  const h = harness(), input = [post(), reply()];
  const result = await h.source.reconcile(input, h.scope, {isCurrent: () => true});
  const id = await forumSourceId(h.scope, 'post-1'), row = h.docs.get(id);
  assert.deepEqual(result, {posts: 1, replies: 1, removed: 0, errors: []});
  assert.equal(row.kind, 'forum'); assert.equal(row.author, '林澈'); assert.equal(row.board, '生活');
  assert.deepEqual(row.pocketSource, {scope: h.scope, id: 'post-1'});
  assert.equal(row.replies[0].id, await forumSourceId(h.scope, 'reply-1', true));
  assert.deepEqual(row.replies[0].pocketSource, {scope: h.scope, id: 'reply-1'});
  await h.source.reconcile(input, h.scope); assert.equal(h.docs.size, 1); assert.equal(h.docs.get(id).replies.length, 1); assert.equal(h.emitted.length, 1);
});

test('source edits patch post and imported replies while preserving native replies and reactions from the live transaction', async () => {
  const h = harness(); await h.source.reconcile([post(), reply()], h.scope);
  const id = await forumSourceId(h.scope, 'post-1');
  h.docs.get(id).likes = 9; h.docs.get(id).liked = true; h.docs.get(id).heat = 150;
  h.beforeChange(() => { h.docs.get(id).replies.push({id: 'native-reply', from: 'me', text: '我會到！', at: 102}); });
  await h.source.reconcile([post('post-1', '開幕改到明天。'), reply('reply-1', 'post-1', '明天見。')], h.scope);
  const row = h.docs.get(id);
  assert.equal(row.text, '開幕改到明天。'); assert.equal(row.replies.length, 2);
  assert.equal(row.replies[0].text, '明天見。'); assert.equal(row.replies[1].text, '我會到！');
  assert.equal(row.likes, 9); assert.equal(row.liked, true); assert.equal(row.heat, 150);
});

test('removing source replies removes only their current-story copies and deleting source posts hides them without losing native discussion', async () => {
  const h = harness(); await h.source.reconcile([post(), reply()], h.scope);
  const id = await forumSourceId(h.scope, 'post-1');
  h.docs.get(id).replies.push({id: 'native-reply', from: 'me', text: '已讀', at: 102});
  await h.source.reconcile([post()], h.scope); assert.deepEqual(h.docs.get(id).replies.map(x => x.id), ['native-reply']);
  assert.equal((await h.source.reconcile([], h.scope)).removed, 1);
  assert.equal((await h.backend.apps.list('forum')).length, 0); assert.equal(h.docs.get(id).replies[0].text, '已讀');
  await h.source.reconcile([post()], h.scope); assert.equal(h.docs.get(id).kind, 'forum'); assert.equal(h.docs.get(id).replies[0].text, '已讀');
});

test('narrative replies can target native activity refs but never another character partition', async () => {
  const native = (id, space) => ({id, kind: 'forum', space, author: 'me', title: '問題', text: '去哪？', replies: [], at: 20, liked: false, likes: 0, heat: 1});
  const h = harness([native('local', 'card:lin.png'), native('foreign', 'card:other.png')]);
  const report = await h.source.reconcile([reply('r1', 'forum:local'), reply('r2', 'foreign')], h.scope);
  assert.equal(report.replies, 1); assert.equal(report.errors.length, 1); assert.equal(h.docs.get('local').replies[0].text, '一起去看看。'); assert.equal(h.docs.get('foreign').replies.length, 0);
  await h.source.reconcile([], h.scope); assert.equal(h.docs.get('local').kind, 'forum'); assert.equal(h.docs.get('local').replies.length, 0);
});

test('forum import respects source scope and callback checks before writes and inside existing-document transactions', async () => {
  const h = harness(); await h.source.reconcile([post()], h.scope);
  const id = await forumSourceId(h.scope, 'post-1'), previous = clone(h.docs.get(id));
  await assert.rejects(h.source.reconcile([post('post-1', '錯誤')], h.scope, {isCurrent: () => false}), {code: 'STALE'});
  assert.deepEqual(h.docs.get(id), previous);
  h.beforeChange(() => h.switch());
  await assert.rejects(h.source.reconcile([post('post-1', '切換後的錯誤')], h.scope), {code: 'STALE'});
  assert.deepEqual(h.docs.get(id), previous);
});

test('source feed and replies stay bounded while preserving native user posts and replies', async () => {
  const native = {id: 'my-post', kind: 'forum', space: 'card:lin.png', author: 'me', title: '自己的貼文', text: '保留', replies: [], at: 1};
  const h = harness([native]);
  const posts = Array.from({length: 205}, (_, i) => post('p-' + i));
  await h.source.reconcile(posts, h.scope); assert.equal(h.docs.size, 201); assert.deepEqual(h.docs.get('my-post'), native);
  const id = await forumSourceId(h.scope, 'p-204');
  h.docs.get(id).replies = [{id: 'mine', from: 'me', text: '保留我的回覆', at: 10}];
  const replies = Array.from({length: 100}, (_, i) => reply('r-' + i, 'p-204'));
  await h.source.reconcile([...posts, ...replies], h.scope);
  assert.equal(h.docs.get(id).replies.length, 80); assert.equal(h.docs.get(id).replies[0].id, 'mine');
});

test('identical event ids from different stories remain isolated and user names map to native me', async () => {
  const h = harness(); await h.source.reconcile([{...post(), from: '小王'}, {...reply(), from: '小王'}], h.scope);
  const firstId = await forumSourceId(h.scope, 'post-1');
  assert.equal(h.docs.get(firstId).author, 'me'); assert.equal(h.docs.get(firstId).source, 'me'); assert.equal(h.docs.get(firstId).replies[0].from, 'me');
  h.switch(); const scope2 = sourceScope(h.context()); await h.source.reconcile([post('post-1', '另一故事')], scope2);
  const secondId = await forumSourceId(scope2, 'post-1'); assert.notEqual(firstId, secondId); assert.equal(h.docs.get(firstId).text, post().text);
  await h.source.reconcile([], scope2); assert.equal(h.docs.get(firstId).kind, 'forum'); assert.equal(h.docs.get(secondId).kind, 'pocket-forum-removed');
});
