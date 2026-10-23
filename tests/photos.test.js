import test from 'node:test';
import assert from 'node:assert/strict';
import {safePhotoUrl, photoPrompt, createPhotoBridge} from '../pocket/photos.js';
import {attachPhotoToMessage, editPhotoMessage, markPhotoAttempt, photoMessageFingerprint, reconcileSourceSnapshot} from '../core/chats.js';
import {parseChatReply} from '../core/chat.js';
import {TTSBackend} from '../core/backend.js';
import {defaultDrawParams} from '../core/novelai.js';
import {createImagePresets} from '../pocket/image-presets.js';
import {visiblePhotoFacts, imageRefinementPrompt, parseRefinedScene} from '../pocket/image-context.js';

const ctx = () => ({chatId: 'story-one', characterId: 0, characters: [{avatar: 'lin.png'}], chat: [], extensionSettings: {}, chatMetadata: {diary: 'PRIVATE_DIARY_SENTINEL'}});
function harness({presets = false} = {}) {
  let context = ctx(), generates = 0, writes = 0, nextGenerate = null, nextWrite = null, enabled = true;
  const photos = new Map(), row = {id: 'thread', space: 'card:lin.png', members: ['林澈'], messages: [{id: 'photo', from: '林澈', kind: 'photo', text: '身穿灰色外套，站在咖啡店門口的自拍。', at: 123}]};
  const inputs = [], events = [];
  const backend = {
    closed: false, spaceKey: () => 'card:lin.png',
    getState: () => ({draw: {engine: 'gpt', gpt: {style: 'style'}, styles: [{id: 'style', positive: 'natural portrait', negative: 'watermark'}]}}),
    drawReady: () => true, drawMissing: () => '未設定圖片模型', threads: async () => [{id: 'thread'}],
    library: {getPhoto: async id => photos.get(id)},
    chats: {get: async () => structuredClone(row), editPhoto: async (thread, id, overrides, options) => { editPhotoMessage(row.messages.find(m => m.id === id), overrides, options); return structuredClone(row); }, photoAttempt: async (thread, id, patch, options) => { markPhotoAttempt(row.messages.find(m => m.id === id), patch, options); return structuredClone(row); }, attachPhoto: async (thread, id, photoId, options) => {
      writes++;
      if (nextWrite) { const fn = nextWrite; nextWrite = null; await fn(); }
      attachPhotoToMessage(row.messages.find(m => m.id === id), photoId, options);
      return structuredClone(row);
    }},
    chatMutate: async (thread, fn) => { const result = await fn(); events.push(thread); return result; },
    async generateImage(input) { if (input.beforeGenerate) await input.beforeGenerate(); generates++; inputs.push(input); if (nextGenerate) await nextGenerate(input); const photoId = `made-${generates}`; photos.set(photoId, {id: photoId, blob: 'test'}); return {photoId}; },
    drawQueue: {cancel: key => events.push(key)},
  };
  const contacts = {profile: () => ({name: '林澈', fields: {outfit: '灰色外套', mood: '放鬆'}, card: {height: '180cm', build: '修長'}, body: [{name: '肩部', value: '寬肩'}, {name: '手臂', value: ''}], private: 'PRIVATE_PROFILE_SENTINEL', contact: {persona: 'UNSELECTED_PERSONA_SENTINEL'}})};
  backend.settings = backend.getState();
  const imagePresets = presets ? createImagePresets({context: () => context, backend}) : null;
  const bridge = createPhotoBridge({context: () => context, backend, contacts, imagePresets, autoEnabled: () => enabled});
  return {bridge, backend, imagePresets, row, photos, inputs, events, setEnabled: v => { enabled = v; }, setContext: c => { context = c; }, getContext: () => context, onGenerate: fn => { nextGenerate = fn; }, onWrite: fn => { nextWrite = fn; }, counts: () => ({generates, writes})};
}

test('photo URLs reject executable schemes, embedded credentials, SVG, privileged paths and encoded traversal', () => {
  for (const value of ['javascript:alert(1)', 'data:image/svg+xml,a', 'blob:https://example/a', '//evil/a.png', '/%2e%2e/secrets.png', '/api/delete', 'https://user:pass@x/a.png', 'https://x/a.svg', '/images/a%5Cb.png', 'https://x/a.html', ' https://x/a.png', '/images/a\n.png']) assert.equal(safePhotoUrl(value), '', value);
  for (const value of ['https://images.example/a.png?sig=123', 'http://127.0.0.1:8188/view?filename=a.png', '/user/images/林澈/照片.webp', '/images/a.png']) assert.equal(safePhotoUrl(value), value);
});

test('native photo reply retains known image URL and caption; descriptions remain generatable', () => {
  const reply = '林澈：[图片 https://images.example/selfie.jpg] 咖啡店門口。\n林澈：[图片] 我站在落地窗前。';
  const result = parseChatReply(reply, {members: [{name: '林澈'}]});
  assert.equal(result[0].image, 'https://images.example/selfie.jpg'); assert.equal(result[0].text, '咖啡店門口。');
  assert.equal(result[1].image, undefined); assert.equal(result[1].text, '我站在落地窗前。');
});

test('picture prompt includes explicit visible physique/status and configured style, excludes private fields', () => {
  const input = photoPrompt({from: '林澈', text: '自拍'}, {card: {height: '180cm'}, fields: {outfit: '灰色外套', private: 'DO_NOT_SEND'}, body: [{name: '肩部', value: '寬肩'}, {name: '手臂', value: ''}], diary: 'DIARY'}, {engine: 'gpt', gpt: {style: 'style'}, styles: [{id: 'style', artist: 'portrait', positive: 'natural light', negative: 'watermark'}]});
  assert.match(input.prompt, /180cm/); assert.match(input.prompt, /灰色外套/); assert.match(input.prompt, /寬肩/); assert.match(input.prompt, /natural light/);
  assert.doesNotMatch(input.prompt, /DO_NOT_SEND|DIARY|手臂/); assert.equal(input.negative, 'watermark');
});

test('direct resolve without generation request does not accidentally invoke a model', async () => {
  const h = harness();
  await assert.rejects(h.bridge.resolvePhoto('thread', 'photo'), {code: 'EXPLICIT_GENERATION_REQUIRED'});
  assert.deepEqual(h.counts(), {generates: 0, writes: 0});
});

test('automatic reception establishes history baseline and generates a newly received photo with NovelAI, even when drawing UI selects GPT', async () => {
  const h = harness(); await h.bridge.baseline();
  assert.equal(h.counts().generates, 0);
  h.row.messages.push({id: 'new-photo', from: '林澈', kind: 'photo', text: '咖啡店的自拍', imagePrompt: '1boy, portrait, grey jacket, cafe, soft natural light'});
  assert.equal((await h.bridge.autoReceive()).scheduled, 1); await h.bridge.idle();
  assert.equal(h.inputs[0].engine, 'nai'); assert.equal(h.inputs[0].allowPaid, true);
  assert.match(h.inputs[0].prompt, /1boy, portrait, grey jacket/); assert.doesNotMatch(h.inputs[0].prompt, /Create the photo|Known visible/);
  assert.equal(h.row.messages[0].photoId, undefined); assert.equal(h.row.messages[1].photoId, 'made-1'); assert.equal(h.row.messages[1].photoAuto.state, 'done');
  await h.bridge.autoReceive(); await h.bridge.idle(); assert.equal(h.counts().generates, 1);
  assert.equal(h.backend.getState().draw.engine, 'gpt');
});

test('automatic generation requires NovelAI key even if another image engine is configured, and does not retry on chat reemits', async () => {
  const h = harness(); await h.bridge.baseline(); h.backend.drawReady = engine => engine !== 'nai';
  h.row.messages.push({id: 'no-key', from: '林澈', kind: 'photo', text: '咖啡杯'});
  await h.bridge.autoReceive(); await h.bridge.idle();
  const m = h.row.messages[1]; assert.equal(m.photoAuto.state, 'error'); assert.equal(m.photoAuto.code, 'NOT_CONFIGURED');
  h.backend.drawReady = () => true; await h.bridge.autoReceive(); await h.bridge.idle(); assert.equal(h.counts().generates, 0);
  await h.bridge.resolvePhoto('thread', 'no-key', {generate: true, engine: 'nai', allowPaid: true, retry: true}); assert.equal(h.counts().generates, 1);
});

test('automatic receiver skips user photos, existing images, persisted attempts and stale sources', async () => {
  const h = harness(); await h.bridge.baseline();
  h.row.messages.push({id: 'self', from: 'me', kind: 'photo', text: '自拍'}, {id: 'url', from: '林澈', kind: 'photo', text: '圖片', image: 'https://example.com/image.jpg'}, {id: 'attempt', from: '林澈', kind: 'photo', text: '圖片', photoAuto: {state: 'error', engine: 'nai'}}, {id: 'stale', from: '林澈', kind: 'photo', text: '圖片', source: {stale: true}});
  assert.equal((await h.bridge.autoReceive()).scheduled, 0); await h.bridge.idle(); assert.equal(h.counts().generates, 0);
});

test('disabled automatic reception does not later generate a backlog when re-enabled or reopened', async () => {
  const h = harness(); await h.bridge.baseline(); h.setEnabled(false);
  h.row.messages.push({id: 'while-off', from: '林澈', kind: 'photo', text: '咖啡杯'});
  await h.bridge.autoReceive(); h.setEnabled(true); await h.bridge.autoReceive(); await h.bridge.idle(); assert.equal(h.counts().generates, 0);
  h.setContext({...ctx(), chatId: 'another-story'}); await h.bridge.autoReceive(); await h.bridge.idle(); assert.equal(h.counts().generates, 0);
});

test('automatic attempt persists failures and cross-session baseline does not spend on an unfinished old message', async () => {
  const h = harness(); await h.bridge.baseline(); h.onGenerate(async () => { throw new Error('NovelAI 503'); });
  h.row.messages.push({id: 'failed', from: '林澈', kind: 'photo', text: '窗外風景'});
  await h.bridge.autoReceive(); await h.bridge.idle(); assert.equal(h.row.messages[1].photoAuto.state, 'error');
  const restored = createPhotoBridge({context: h.getContext, backend: h.backend}); await restored.baseline(); await restored.autoReceive(); await restored.idle();
  assert.equal(h.counts().generates, 1);
});

test('automatic queue stays bounded at 12 received pictures and overflowing descriptions do not retry on reemit', async () => {
  const h = harness(); await h.bridge.baseline(); let release; const wait = new Promise(resolve => { release = resolve; }); h.onGenerate(() => wait);
  for (let n = 0; n < 15; n++) h.row.messages.push({id: `burst-${n}`, from: '林澈', kind: 'photo', text: '咖啡杯'});
  const scheduled = await h.bridge.autoReceive(); assert.equal(scheduled.scheduled, 12); assert.equal(scheduled.overflow, 3);
  release(); await h.bridge.idle(); await h.bridge.autoReceive(); await h.bridge.idle(); assert.equal(h.counts().generates, 12);
});

test('backend forces NovelAI parameters, key and queue without changing selected GPT engine', async () => {
  const backend = Object.create(TTSBackend.prototype), calls = [], state = {draw: {engine: 'gpt', params: {...defaultDrawParams(), seed: 123}, guard: false, relay: {url: ''}, gpt: {}}};
  Object.assign(backend, {settings: state, closed: false, subscription: null, novelai: {configured: true, generate: async (body) => {calls.push(body); return new Blob(['png'], {type: 'image/png'});}}, library: {addPhoto: async () => ({id: 'native-result'})}, drawQueue: {add: job => {assert.equal(job.engine, 'nai'); return job.task(new AbortController().signal);}}, emit: () => {}, vibePlan: () => ({used: [], encode: 0, extra: 0})});
  const result = await backend.generateImage({engine: 'nai', prompt: '1boy, grey jacket', allowPaid: true});
  assert.equal(result.engine, 'nai'); assert.equal(calls[0].model, state.draw.params.model); assert.equal(result.photoId, 'native-result'); assert.equal(state.draw.engine, 'gpt');
  backend.novelai.configured = false; await assert.rejects(backend.generateImage({engine: 'nai', prompt: 'photo', allowPaid: true}), /NovelAI/); assert.equal(calls.length, 1);
});

test('unconfigured provider fails clearly without a default network request', async () => {
  const h = harness(); h.backend.drawReady = () => false;
  await assert.rejects(h.bridge.resolvePhoto('thread', 'photo', {generate: true}), {code: 'NOT_CONFIGURED'});
  assert.equal(h.counts().generates, 0);
});

test('concurrent taps and completed reentry generate once and reuse the persisted native photo', async () => {
  const h = harness();
  const one = h.bridge.resolvePhoto('thread', 'photo', {generate: true}), two = h.bridge.resolvePhoto('thread', 'photo', {generate: true});
  assert.equal(one, two); const first = await one;
  const repeated = await h.bridge.resolvePhoto('thread', 'photo', {generate: true});
  assert.equal(first.photoId, 'made-1'); assert.equal(repeated.photoId, first.photoId); assert.equal(repeated.existing, true);
  assert.deepEqual(h.counts(), {generates: 1, writes: 1}); assert.equal(h.inputs[0].allowPaid, false);
  assert.doesNotMatch(h.inputs[0].prompt, /PRIVATE_DIARY_SENTINEL|PRIVATE_PROFILE_SENTINEL|UNSELECTED_PERSONA_SENTINEL/);
  assert.equal(h.row.messages[0].photoId, first.photoId);
});

test('provider paid confirmation is forwarded only from explicit allowPaid boolean', async () => {
  const h = harness(); await h.bridge.resolvePhoto('thread', 'photo', {generate: true, allowPaid: true}); assert.equal(h.inputs[0].allowPaid, true);
});

test('deleted message cannot generate, and a recalled message during generation cannot receive the result', async () => {
  const missing = harness(); missing.row.messages = [];
  await assert.rejects(missing.bridge.resolvePhoto('thread', 'photo', {generate: true}), {code: 'MISSING'}); assert.equal(missing.counts().generates, 0);
  const h = harness(); h.onGenerate(async () => { h.row.messages[0].kind = 'recall'; });
  await assert.rejects(h.bridge.resolvePhoto('thread', 'photo', {generate: true}), {code: 'MISSING'});
  assert.equal(h.counts().writes, 0); assert.equal(h.row.messages[0].photoId, undefined);
});

test('switching story during generation preserves new chat and does not attach an old result', async () => {
  const h = harness(); h.onGenerate(async () => { h.setContext({...ctx(), chatId: 'story-two'}); });
  await assert.rejects(h.bridge.resolvePhoto('thread', 'photo', {generate: true}), {code: 'STALE'});
  assert.equal(h.counts().writes, 0); assert.equal(h.row.messages[0].photoId, undefined);
});

test('description edits during generation reject stale image attachment', async () => {
  const h = harness(); h.onGenerate(async () => { h.row.messages[0].text = '最新內容'; });
  await assert.rejects(h.bridge.resolvePhoto('thread', 'photo', {generate: true}), {code: 'STALE'});
  assert.equal(h.counts().writes, 0); assert.equal(h.row.messages[0].photoId, undefined);
});

test('transaction guard catches chat switch after async read but before native message write', async () => {
  const h = harness(); h.onWrite(async () => { h.setContext({...ctx(), chatId: 'story-two'}); });
  await assert.rejects(h.bridge.resolvePhoto('thread', 'photo', {generate: true}), {code: 'STALE'}); assert.equal(h.row.messages[0].photoId, undefined);
});

test('temporary attachment storage failure retries the existing generated result, avoiding a second billed request', async () => {
  const h = harness(); h.onWrite(async () => { throw new Error('Storage temporarily unavailable'); });
  await assert.rejects(h.bridge.resolvePhoto('thread', 'photo', {generate: true}), /Storage/);
  const result = await h.bridge.resolvePhoto('thread', 'photo', {generate: true});
  assert.equal(result.photoId, 'made-1'); assert.equal(h.counts().generates, 1); assert.equal(h.counts().writes, 2);
});

test('missing previously generated album item reports loss instead of silently spending again', async () => {
  const h = harness(); h.row.messages[0].photoId = 'deleted-album-photo';
  await assert.rejects(h.bridge.resolvePhoto('thread', 'photo', {generate: true}), {code: 'PHOTO_MISSING'});
  assert.equal(h.counts().generates, 0);
});

test('unchanged narrative replay retains received URL and generated photoId; edited source replaces old resolved photo', () => {
  const bundle = text => [{key: 'dm:林澈', type: 'dm', name: '林澈', members: ['林澈'], messages: [{eventId: 'e1', sourceMessage: 'story:1', at: 100, message: {from: '林澈', kind: 'photo', text, image: 'https://images.example/selfie.jpg'}}]}];
  const opts = {accountScope: 'account', space: 'card:lin.png', now: 100, id: (() => { let n = 0; return () => 'id-' + ++n; })()};
  const first = reconcileSourceSnapshot([], [], 'source', bundle('原照'), opts);
  const original = first.rows[0].messages[0]; original.photoId = 'generated-photo';
  const again = reconcileSourceSnapshot(first.rows, first.records, 'source', bundle('原照'), opts);
  assert.equal(again.rows[0].messages[0].photoId, 'generated-photo'); assert.equal(again.rows[0].messages[0].image, 'https://images.example/selfie.jpg');
  const edited = reconcileSourceSnapshot(again.rows, again.records, 'source', bundle('改照'), opts);
  assert.equal(edited.rows[0].messages[0].photoId, undefined);
});

test('atomic photo mutation refuses stale fingerprints and preserves a completed attachment', () => {
  const message = {id: 'p', from: '林澈', kind: 'photo', text: '原照'}, fingerprint = photoMessageFingerprint(message);
  attachPhotoToMessage(message, 'first', {fingerprint}); attachPhotoToMessage(message, 'second', {fingerprint}); assert.equal(message.photoId, 'first');
  message.text = '已變更'; assert.throws(() => attachPhotoToMessage(message, 'third', {fingerprint}), {code: 'STALE'});
});


test('WeChat preset/model selection produces exact NovelAI prompt metadata while preserving other drawing engine settings', async () => {
  const h = harness({presets: true});
  const {savedId} = h.imagePresets.action('imagePreset.save', {name: '咖啡街拍', artist: 'artist:portrait', positive: 'cinematic, sunlight', negative: 'watermark, blurry', model: 'nai-diffusion-4-full', params: {width: 832, height: 1216}});
  h.imagePresets.action('wechatImage.save', {presetId: savedId, model: 'nai-diffusion-5-full'});
  await h.bridge.resolvePhoto('thread', 'photo', {generate: true, allowPaid: true});
  const input = h.inputs[0], stored = h.row.messages[0].photoGeneration;
  assert.equal(input.engine, 'nai'); assert.equal(input.params.model, 'nai-diffusion-5-full'); assert.equal(input.params.width, 832);
  assert.match(input.prompt, /^artist:portrait\ncinematic, sunlight\n/); assert.equal(input.negative, 'watermark, blurry');
  assert.equal(stored.prompt, input.prompt); assert.equal(stored.negative, input.negative); assert.equal(stored.model, input.params.model); assert.equal(stored.presetId, savedId);
  assert.equal(h.backend.settings.draw.engine, 'gpt');
  h.imagePresets.action('imagePreset.save', {id: savedId, name: '改過的畫風', artist: 'different artist', positive: 'night'});
  const draft = await h.bridge.photoDraft('thread', 'photo');
  assert.equal(draft.prompt, stored.prompt); assert.equal(draft.negative, stored.negative); assert.equal(draft.model, stored.model);
});

test('saving edited photo prompts calls no provider and preserves generated image; source replay keeps overrides', async () => {
  const h = harness({presets: true}); await h.bridge.resolvePhoto('thread', 'photo', {generate: true});
  const draft = await h.bridge.photoDraft('thread', 'photo');
  const saved = await h.bridge.editPhoto('thread', 'photo', {...draft, scene: 'portrait, beach', artist: '', positive: 'golden hour', negative: 'rain', regenerate: false});
  assert.equal(h.counts().generates, 1); assert.equal(h.row.messages[0].photoId, 'made-1');
  assert.equal(saved.scene, 'portrait, beach'); assert.equal(saved.prompt, 'golden hour\nportrait, beach'); assert.equal(saved.negative, 'rain');
  assert.notEqual(saved.token, draft.token); assert.equal(saved.generated.prompt, draft.generated.prompt);
  await assert.rejects(h.bridge.editPhoto('thread', 'photo', {...draft, scene: 'stale dialog'}), {code: 'STALE'});
});

test('regeneration failure retains original photo and exact old snapshot, retry attaches new image and retains original album item', async () => {
  const h = harness({presets: true}); await h.bridge.resolvePhoto('thread', 'photo', {generate: true});
  const old = structuredClone(h.row.messages[0].photoGeneration), draft = await h.bridge.photoDraft('thread', 'photo');
  h.onGenerate(async () => { assert.equal(h.row.messages[0].photoId, 'made-1'); throw new Error('NovelAI 暫時無法使用'); });
  let failed;
  try { await h.bridge.editPhoto('thread', 'photo', {...draft, scene: 'new scene', regenerate: true}); } catch (e) { failed = e; }
  assert.match(failed.message, /暫時/); assert.equal(typeof failed.refreshToken, 'string'); assert.equal(h.row.messages[0].photoId, 'made-1'); assert.deepEqual(h.row.messages[0].photoGeneration, old);
  h.onGenerate(async () => { assert.equal(h.row.messages[0].photoId, 'made-1'); });
  const retry = await h.bridge.photoDraft('thread', 'photo');
  const result = await h.bridge.editPhoto('thread', 'photo', {...retry, regenerate: true});
  assert.equal(result.photoId, 'made-3'); assert.equal(h.row.messages[0].photoId, 'made-3'); assert.equal(h.photos.has('made-1'), true);
  assert.match(h.row.messages[0].photoGeneration.prompt, /new scene/);
});

test('changing preset in photo editor replaces frozen preset parameters and honors explicit model override', async () => {
  const h = harness({presets: true}); await h.bridge.resolvePhoto('thread', 'photo', {generate: true});
  const {savedId} = h.imagePresets.action('imagePreset.save', {name: '寬幅', model: 'nai-diffusion-4-full', artist: 'wide artist', positive: 'wide', negative: 'narrow', params: {width: 1216, height: 832}});
  const draft = await h.bridge.photoDraft('thread', 'photo');
  await h.bridge.editPhoto('thread', 'photo', {token: draft.token, presetId: savedId, model: 'nai-diffusion-5-full', artist: 'wide artist', positive: 'wide', negative: 'narrow', scene: 'landscape', regenerate: true});
  assert.equal(h.inputs[1].params.width, 1216); assert.equal(h.inputs[1].params.height, 832); assert.equal(h.inputs[1].params.model, 'nai-diffusion-5-full');
});

test('saving during a pending generation invalidates its attachment; concurrent regenerate requests cannot double-charge', async () => {
  const h = harness({presets: true}); let release;
  const wait = new Promise(resolve => { release = resolve; }); h.onGenerate(async () => wait);
  const pending = h.bridge.resolvePhoto('thread', 'photo', {generate: true});
  while (!h.inputs.length) await new Promise(resolve => setTimeout(resolve, 0));
  const draft = await h.bridge.photoDraft('thread', 'photo');
  await assert.rejects(h.bridge.editPhoto('thread', 'photo', {...draft, regenerate: true}), {code: 'PHOTO_BUSY'});
  await h.bridge.editPhoto('thread', 'photo', {...draft, scene: 'updated while generating'});
  release(); await assert.rejects(pending, {code: 'STALE'});
  assert.equal(h.row.messages[0].photoId, undefined); assert.equal(h.counts().generates, 1); assert.equal(h.photos.size, 1);
});

test('saved draft from another story cannot edit a matching native thread/message', async () => {
  const h = harness({presets: true}), draft = await h.bridge.photoDraft('thread', 'photo');
  h.setContext({...ctx(), chatId: 'another-story'});
  await assert.rejects(h.bridge.editPhoto('thread', 'photo', {...draft, scene: 'wrong context'}), {code: 'STALE'});
  assert.equal(h.row.messages[0].photoOverrides, undefined);
});

test('atomic attempt claims prevent cross-tab duplicate generation and reject late attachment from a replaced attempt', () => {
  const message = {id: 'p', from: '林澈', kind: 'photo', text: '原照'}, fingerprint = photoMessageFingerprint(message);
  markPhotoAttempt(message, {state: 'queued', attemptId: 'one'}, {fingerprint});
  assert.throws(() => markPhotoAttempt(message, {state: 'queued', attemptId: 'two'}, {fingerprint}), {code: 'PHOTO_BUSY'});
  assert.throws(() => attachPhotoToMessage(message, 'wrong', {fingerprint, attemptId: 'two'}), {code: 'STALE'});
  attachPhotoToMessage(message, 'right', {fingerprint, attemptId: 'one'}); assert.equal(message.photoId, 'right');
});

test('caption-only narrative changes preserve edited image and snapshot while image prompt changes clear local overrides', () => {
  const bundle = (text, imagePrompt = 'stable scene') => [{key: 'dm:林澈', type: 'dm', name: '林澈', members: ['林澈'], messages: [{eventId: 'e1', sourceMessage: 'story:1', at: 100, message: {from: '林澈', kind: 'photo', text, imagePrompt}}]}];
  const opts = {accountScope: 'account', space: 'card:lin.png', id: (() => { let n = 0; return () => 'id-' + ++n; })()};
  const first = reconcileSourceSnapshot([], [], 'source', bundle('原說明'), opts), message = first.rows[0].messages[0];
  Object.assign(message, {photoId: 'made', photoOverrides: {scene: 'edited scene'}, photoGeneration: {prompt: 'exact generated scene', negative: 'bad quality'}});
  const replay = reconcileSourceSnapshot(first.rows, first.records, 'source', bundle('原說明'), opts);
  assert.equal(replay.rows[0].messages[0].photoOverrides.scene, 'edited scene');
  const caption = reconcileSourceSnapshot(replay.rows, replay.records, 'source', bundle('新說明'), opts);
  assert.equal(caption.rows[0].messages[0].photoId, 'made'); assert.equal(caption.rows[0].messages[0].photoGeneration.prompt, 'exact generated scene');
  const scene = reconcileSourceSnapshot(caption.rows, caption.records, 'source', bundle('新說明', 'different scene'), opts);
  assert.equal(scene.rows[0].messages[0].photoOverrides, undefined); assert.equal(scene.rows[0].messages[0].photoId, undefined);
});


test('deleting a preset does not prevent opening or regenerating an existing photo with its exact frozen inputs', async () => {
  const h = harness({presets: true});
  const {savedId} = h.imagePresets.action('imagePreset.save', {name: '照片原畫風', artist: 'old artist', positive: 'old positive', negative: 'old negative', model: 'nai-diffusion-4-full'});
  h.imagePresets.action('wechatImage.save', {presetId: savedId});
  await h.bridge.resolvePhoto('thread', 'photo', {generate: true});
  const before = await h.bridge.photoDraft('thread', 'photo');
  h.imagePresets.action('imagePreset.delete', {id: savedId});
  const after = await h.bridge.photoDraft('thread', 'photo');
  assert.equal(after.prompt, before.prompt); assert.equal(after.negative, before.negative); assert.equal(after.presetName, '照片原畫風');
  await h.bridge.editPhoto('thread', 'photo', {...after, regenerate: true});
  assert.equal(h.inputs[1].prompt, h.inputs[0].prompt); assert.equal(h.inputs[1].params.model, 'nai-diffusion-4-full');
});


test('reopened photo editor can change only the model after saving prompts without passing stale snapshot parameters', async () => {
  const h = harness({presets: true});
  const {savedId} = h.imagePresets.action('imagePreset.save', {name: '原始畫風', model: 'nai-diffusion-4-full', positive: 'portrait', params: {width: 1216, height: 832}});
  h.imagePresets.action('wechatImage.save', {presetId: savedId});
  await h.bridge.resolvePhoto('thread', 'photo', {generate: true});
  const uiPayload = draft => Object.fromEntries(['token', 'scene', 'artist', 'positive', 'negative', 'model', 'presetId'].map(key => [key, draft[key]]));
  const first = await h.bridge.photoDraft('thread', 'photo');
  await h.bridge.editPhoto('thread', 'photo', {...uiPayload(first), scene: 'edited portrait', regenerate: false});
  assert.equal(h.counts().generates, 1);
  const reopened = await h.bridge.photoDraft('thread', 'photo');
  assert.equal(reopened.params.model, 'nai-diffusion-4-full');
  await h.bridge.editPhoto('thread', 'photo', {...uiPayload(reopened), model: 'nai-diffusion-4-5-curated', regenerate: true});
  assert.equal(h.counts().generates, 2); assert.equal(h.inputs[1].params.model, 'nai-diffusion-4-5-curated');
  assert.equal(h.inputs[1].params.width, 1216); assert.equal(h.inputs[1].params.height, 832);
  assert.equal(h.row.messages[0].photoId, 'made-2'); assert.equal(h.photos.has('made-1'), true);
  assert.equal(h.row.messages[0].photoGeneration.model, 'nai-diffusion-4-5-curated');
});

test('picture refinement uses visible contact facts and a bounded current draft, excluding private fields and blank body slots', () => {
  const profile = {fields: {appearance: '黑髮', outfit: '灰色外套', thought: 'PRIVATE_THOUGHT', note: 'PRIVATE_NOTE'}, card: {height: '180cm', text: 'PRIVATE_CARD'}, body: [{name: '肩部', value: '寬肩'}, {name: '手臂', value: ''}], diary: 'PRIVATE_DIARY'};
  assert.deepEqual(visiblePhotoFacts(profile), {height: '180cm', appearance: '黑髮', outfit: '灰色外套', body: [{name: '肩部', value: '寬肩'}]});
  const prompt = imageRefinementPrompt({from: '林澈', text: '自拍'}, profile, 'x'.repeat(20000)), data = JSON.parse(prompt[1].content);
  assert.equal(data.requestedScene.length, 16000); assert.equal(data.photoSender, '林澈');
  assert.doesNotMatch(JSON.stringify(prompt), /PRIVATE_|手臂/);
});

test('refined scene accepts only a bounded English scene object and never silently overwrites a draft with malformed text', () => {
  assert.equal(parseRefinedScene('```json\n{"scene":"1boy, black hair, 1.2::grey coat::, cafe"}\n```'), '1boy, black hair, 1.2::grey coat::, cafe');
  for (const raw of ['', '{}', '{"scene":""}', '{"scene":"黑髮, selfie"}', '{"scene":"<script>bad</script>"}', '{"scene":"photo","negative":"changed"}', JSON.stringify({scene: 'x'.repeat(6001)}), 'A description instead of JSON']) {
    assert.throws(() => parseRefinedScene(raw), {code: 'INVALID_IMAGE_PROMPT'});
  }
});

test('explicit scene optimization uses configured text backend, preserves artist/model/negative and never generates an image or writes chat', async () => {
  const h = harness({presets: true}), requests = [], draft = await h.bridge.photoDraft('thread', 'photo'), before = structuredClone(h.row);
  h.backend.generateText = async (context, request) => { requests.push(request); assert.equal(context, h.getContext()); return '{"scene":"1boy, black hair, grey coat, cafe, soft light"}'; };
  const result = await h.bridge.api().pocketOptimizePhoto('thread', 'photo', {token: draft.token, scene: '在咖啡館窗邊自拍'});
  assert.equal(result.scene, '1boy, black hair, grey coat, cafe, soft light'); assert.equal(result.token, draft.token);
  assert.equal(requests.length, 1); assert.equal(requests[0].pocketTask, 'image-prompt'); assert.equal(requests[0].pocketNames, undefined);
  assert.match(JSON.stringify(requests[0].prompt), /180cm|在咖啡館窗邊自拍/);
  assert.doesNotMatch(JSON.stringify(requests[0].prompt), /PRIVATE_DIARY_SENTINEL|PRIVATE_PROFILE_SENTINEL|UNSELECTED_PERSONA_SENTINEL/);
  assert.deepEqual(h.row, before); assert.deepEqual(await h.bridge.photoDraft('thread', 'photo'), draft);
  assert.deepEqual(h.counts(), {generates: 0, writes: 0}); assert.equal(h.events.length, 0);
});

test('repeated scene optimization clicks coalesce and reject a changed concurrent request', async () => {
  const h = harness(), draft = await h.bridge.photoDraft('thread', 'photo'); let release, calls = 0;
  const wait = new Promise(resolve => { release = resolve; });
  h.backend.generateText = async () => { calls++; await wait; return '{"scene":"grey coat, cafe"}'; };
  const options = {token: draft.token, scene: '咖啡馆'}, first = h.bridge.optimizePhoto('thread', 'photo', options), second = h.bridge.optimizePhoto('thread', 'photo', options);
  assert.equal(first, second);
  await assert.rejects(h.bridge.optimizePhoto('thread', 'photo', {...options, scene: '別的場景'}), {code: 'PHOTO_BUSY'});
  release(); await first; assert.equal(calls, 1);
  await h.bridge.optimizePhoto('thread', 'photo', options); assert.equal(calls, 2);
});

test('old image editor token rejects optimization before any text request and changing story during refinement rejects its result', async () => {
  const h = harness(), draft = await h.bridge.photoDraft('thread', 'photo'); let calls = 0;
  h.backend.generateText = async () => { calls++; h.setContext({...ctx(), chatId: 'new-story'}); return '{"scene":"portrait"}'; };
  await assert.rejects(h.bridge.optimizePhoto('thread', 'photo', {token: 'bad token', scene: 'portrait'}), {code: 'STALE'}); assert.equal(calls, 0);
  await assert.rejects(h.bridge.optimizePhoto('thread', 'photo', {token: draft.token, scene: 'portrait'}), {code: 'STALE'}); assert.equal(calls, 1);
  assert.equal(h.row.messages[0].photoOverrides, undefined); assert.deepEqual(h.counts(), {generates: 0, writes: 0});
});

test('editing the original photo while text refinement is running invalidates the result without losing the edited draft', async () => {
  const h = harness(), draft = await h.bridge.photoDraft('thread', 'photo');
  h.backend.generateText = async () => {
    await h.bridge.editPhoto('thread', 'photo', {token: draft.token, scene: 'new scene by user'});
    return '{"scene":"old scene optimized"}';
  };
  await assert.rejects(h.bridge.optimizePhoto('thread', 'photo', {token: draft.token, scene: 'old scene'}), {code: 'STALE'});
  assert.equal(h.row.messages[0].photoOverrides.scene, 'new scene by user'); assert.equal(h.counts().generates, 0);
});

test('invalid scene output, disabled bridge and missing text backend do not mutate or generate an image', async () => {
  const h = harness(), draft = await h.bridge.photoDraft('thread', 'photo');
  const options = {token: draft.token, scene: '咖啡館'};
  await assert.rejects(h.bridge.optimizePhoto('thread', 'photo', options), {code: 'NOT_CONFIGURED'});
  h.backend.generateText = async () => '{"scene":"中文描述"}';
  await assert.rejects(h.bridge.optimizePhoto('thread', 'photo', options), {code: 'INVALID_IMAGE_PROMPT'});
  h.bridge.dispose();
  await assert.rejects(h.bridge.optimizePhoto('thread', 'photo', options), {code: 'STALE'});
  assert.equal(h.row.messages[0].photoOverrides, undefined); assert.deepEqual(h.counts(), {generates: 0, writes: 0});
});
