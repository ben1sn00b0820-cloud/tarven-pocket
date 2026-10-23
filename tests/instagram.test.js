import test from 'node:test';
import assert from 'node:assert/strict';
import {projectInstagram} from '../pocket/instagram.js';

const DAY = 86_400_000, now = 1_000_000_000;
const options = {userName: '小王', characterName: '林知夏', now};
const event = (id, action, extra = {}) => ({id, app: 'instagram', action, from: '林知夏', text: '午後的光。', at: now - 1000, ...extra});

test('discovers current story participants and status roles without a global character library', () => {
  const result = projectInstagram([
    event('a', 'post'), event('b', 'dm', {from: 'me', to: '小周'}),
    event('w', 'message', {app: 'wechat', from: '阿青', to: '小王', members: ['小張']}),
  ], {...options, profiles: [{name: '老師', fields: {identity: '大學講師', thought: 'PRIVATE_THOUGHT'}, body: [{name: '頭部', value: 'PRIVATE_BODY'}]}], contacts: [{name: '舊友', persona: 'PRIVATE_PERSONA'}], characters: [{name: '別的世界角色'}]});
  assert.deepEqual(result.accounts.map(a => a.name), ['小王', '林知夏', '老師', '舊友', '小周', '阿青', '小張']);
  assert.equal(result.accounts.find(a => a.name === '老師').bio, '大學講師');
  assert.equal(result.accounts.find(a => a.name === '小王').isUser, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|別的世界角色/);
});

test('posts retain unique likes and chronological comments, ignoring another app’s references', () => {
  const events = [event('p', 'post'), event('l', 'like', {from: 'me', postId: 'p', at: now - 900}), event('l2', 'like', {from: 'me', postId: 'p', at: now - 800}), event('c', 'comment', {from: '小周', postId: 'p', text: '好美', at: now - 700}), event('other', 'comment', {app: 'forum', from: '阿青', ref: 'p', text: '不應混入'})];
  let result = projectInstagram([...events, events[2]], options);
  assert.equal(result.posts.length, 1); assert.deepEqual(result.posts[0].likes, ['小王']);
  assert.deepEqual(result.posts[0].comments.map(c => c.text), ['好美']);
  result = projectInstagram([...events, event('unlike', 'like', {from: '小王', postId: 'p', liked: false, at: now})], options);
  assert.deepEqual(result.posts[0].likes, []);
});

test('stories expire at exactly 24 hours but remain readable in the archive', () => {
  const result = projectInstagram([
    event('active', 'story', {at: now - DAY + 1}),
    event('expired', 'story', {at: now - DAY}),
    event('older', 'story', {at: now - DAY - 1, expiresAt: now + DAY * 100}),
  ], options);
  assert.deepEqual(result.stories.map(s => [s.id, s.expired]), [['active', false], ['expired', true], ['older', true]]);
  assert.equal(result.accounts.find(a => a.name === '林知夏').activeStories, 1);
  assert.equal(result.accounts.find(a => a.name === '林知夏').storyCount, 3);
});

test('refresh never gives untimestamped legacy stories another 24 hours', () => {
  const input = [event('legacy', 'story', {at: undefined})];
  const first = projectInstagram(input, options), later = projectInstagram(input, {...options, now: now + DAY});
  assert.equal(first.stories[0].at, 0); assert.equal(first.stories[0].expiresAt, DAY);
  assert.deepEqual(first.stories, later.stories); assert.equal(later.stories[0].expired, true);
});

test('story replies remain ordinary DMs and attach only to matching owners', () => {
  const result = projectInstagram([
    event('story', 'story'),
    event('reply', 'dm', {from: 'me', to: '林知夏', text: '在哪裡？', storyId: 'story'}),
    event('answer', 'dm', {from: '林知夏', to: 'me', text: '咖啡館。', storyId: 'story'}),
    event('wrong', 'dm', {from: '小周', to: '阿青', text: '別的對話', storyId: 'story'}),
  ], options);
  assert.equal(result.dms.length, 3);
  assert.deepEqual(result.stories[0].replies.map(r => r.id), ['reply', 'answer']);
  assert.equal(result.dms[0].from, '小王'); assert.equal(result.dms[1].to, '小王');
});

test('reprojection after source edit, deletion, or chat switch leaves no cached posts or accounts', () => {
  const first = projectInstagram([event('p', 'post', {from: '小周'}), event('s', 'story')], options);
  const edited = projectInstagram([event('p', 'post', {from: '阿青', text: '改過的內容'})], options);
  const switched = projectInstagram([], {...options, characterName: '另一角色'});
  assert.equal(first.stories.length, 1); assert.equal(edited.stories.length, 0);
  assert.equal(edited.posts[0].text, '改過的內容'); assert(!edited.accounts.some(a => a.name === '小周'));
  assert.deepEqual(switched.accounts.map(a => a.name), ['小王', '另一角色']); assert.equal(switched.posts.length, 0);
});

test('unsafe pictures are excluded while safe photo IDs, URLs and English prompts survive', () => {
  const result = projectInstagram([
    event('bad', 'post', {image: 'javascript:alert(1)'}),
    event('file', 'post', {image: '/api/secrets', photoId: 'local-photo'}),
    event('good', 'story', {image: 'https://example.test/cafe.png', imagePrompt: 'sunlit cafe, warm light'}),
  ], options);
  assert.equal(result.posts[0].image, ''); assert.equal(result.posts[1].image, '');
  assert.equal(result.posts[0].photoId, 'local-photo');
  assert.equal(result.stories[0].image, 'https://example.test/cafe.png');
  assert.equal(result.stories[0].imagePrompt, 'sunlit cafe, warm light');
});

test('projection does not modify source objects and ignores incomplete participants', () => {
  const input = [event('a', 'post'), event('b', 'story', {from: '\u0000invalid'}), event('c', 'dm', {to: ''}), null];
  const before = structuredClone(input); const projected = projectInstagram(input, options);
  assert.deepEqual(input, before); assert.equal(projected.stories.length, 0); assert.equal(projected.dms.length, 0);
  projected.posts[0].text = 'changed'; assert.equal(input[0].text, '午後的光。');
});
