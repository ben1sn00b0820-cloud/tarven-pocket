import test from 'node:test';
import assert from 'node:assert/strict';
import {createImagePresets, parseImagePresetImport, validateImageOverrides, IMAGE_PRESET_FORMAT} from '../pocket/image-presets.js';
import {defaultDrawParams} from '../core/novelai.js';
import {normalizeDraw} from '../core/draw.js';

const KEY = 'tavern_pocket_v3';
function fixture(settings = {}) {
  const saves = [], events = [];
  const c = {extensionSettings: structuredClone(settings), saveSettingsDebounced: () => saves.push(structuredClone(c.extensionSettings))};
  const backend = {settings: {draw: {engine: 'gpt', params: {...defaultDrawParams(), model: 'nai-diffusion-3'}, styles: [{id: 'old', name: '我的舊畫風', artist: 'artist:known', positive: 'soft light', negative: 'blurry'}], activeStyle: 'old', gpt: {model: 'gpt-image-1', style: 'elsewhere'}, relay: {url: 'https://private.example'}, key: 'SECRET_NATIVE_KEY'}}, emit: (type, data) => events.push({type, data}), saveStyle(value) {const styles = this.settings.draw.styles, index = styles.findIndex(s => s.id === value.id); if (index < 0) styles.push(structuredClone(value)); else styles[index] = structuredClone(value);}, saveDraw(value) {Object.assign(this.settings.draw, structuredClone(value));}};
  return {c, backend, saves, events, controller: createImagePresets({context: () => c, backend})};
}
const add = (f, overrides = {}) => f.controller.action('imagePreset.save', {name: '晴日寫真', artist: 'artist:sample', positive: 'sunlight', negative: 'low quality', ...overrides}).savedId;

test('first use captures active NovelAI style once without switching or overwriting native settings', () => {
  const f = fixture({[KEY]: {profileId: 'phone-model', inject: false}}), original = structuredClone(f.backend.settings);
  const state = f.controller.state(), initial = state.presets[0];
  assert.equal(initial.name, '我的舊畫風');
  assert.equal(initial.artist, 'artist:known');
  assert.equal(state.wechat.presetId, initial.id);
  assert.equal(f.controller.resolve().model, 'nai-diffusion-3');
  assert.deepEqual(f.backend.settings, original);
  f.backend.settings.draw.styles[0].artist = 'later-native-edit';
  assert.equal(f.controller.state().presets[0].artist, 'artist:known');
  assert.equal(f.c.extensionSettings[KEY].profileId, 'phone-model');
  assert.equal(f.c.extensionSettings[KEY].inject, false);
  assert.equal(f.saves.length, 1);
});

test('preset CRUD preserves selected IDs and deletion safely falls back to active native style', () => {
  const f = fixture(), id = add(f);
  f.controller.action('wechatImage.save', {presetId: id});
  assert.equal(f.controller.resolve().positive, 'sunlight');
  const saved = f.controller.action('imagePreset.save', {id, name: '修改後', positive: 'studio', negative: ''});
  assert.equal(saved.savedId, id);
  assert.equal(f.controller.resolve().artist, '');
  assert.equal(f.controller.resolve().negative, '');
  assert.equal(saved.wechat.presetId, id);
  const deleted = f.controller.action('imagePreset.delete', {id});
  assert.equal(deleted.wechat.presetId, '');
  assert.equal(f.controller.resolve().artist, 'artist:known');
  assert.throws(() => f.controller.action('imagePreset.delete', {id}), /已不存在/);
});

test('WeChat model selection and explicit image preset follow precedence without touching global engine', () => {
  const f = fixture(), id = add(f, {model: 'nai-diffusion-4-5-full', params: {width: 1024, height: 1024, steps: 20}});
  f.controller.action('wechatImage.save', {presetId: id, model: 'nai-diffusion-5-full'});
  const resolved = f.controller.resolve();
  assert.equal(resolved.model, 'nai-diffusion-5-full');
  assert.equal(resolved.params.width, 1024);
  assert.equal(resolved.params.steps, 20);
  assert.equal(f.controller.resolve({presetId: id}).model, 'nai-diffusion-4-5-full');
  assert.equal(f.controller.resolve({presetId: id, model: 'nai-diffusion-3'}).model, 'nai-diffusion-3');
  assert.equal(f.controller.resolve({params: {model: 'nai-diffusion-4-full', steps: 17}, positive: '', negative: ''}).params.steps, 17);
  assert.equal(f.controller.resolve({positive: ''}).positive, '');
  assert.equal(f.backend.settings.draw.engine, 'gpt');
  assert.equal(f.backend.settings.draw.params.model, 'nai-diffusion-3');
});

test('explicit apply copies selected preset into native NovelAI drawing; repeat updates same style', () => {
  const f = fixture(), id = add(f, {model: 'nai-diffusion-4-full', params: {steps: 16}}), wechat = f.controller.state().wechat;
  const result = f.controller.action('imagePreset.apply', {id});
  assert.equal(result.appliedId, id);
  assert.equal(f.backend.settings.draw.engine, 'nai');
  assert.equal(f.backend.settings.draw.params.model, 'nai-diffusion-4-full');
  assert.equal(f.backend.settings.draw.params.steps, 16);
  assert.equal(f.backend.settings.draw.styles.find(s => s.id === f.backend.settings.draw.activeStyle).positive, 'sunlight');
  f.controller.action('imagePreset.apply', {id});
  assert.equal(f.backend.settings.draw.styles.length, 2);
  assert.deepEqual(f.controller.state().wechat, wechat);
});

test('native drawing normalization preserves full imported preset text', () => {
  const f = fixture(), id = add(f, {name: '長'.repeat(80), artist: 'a'.repeat(10000), positive: 'p'.repeat(12000), negative: 'n'.repeat(12000)});
  f.controller.action('imagePreset.apply', {id});
  const normalized = normalizeDraw(f.backend.settings.draw);
  const style = normalized.styles.find(s => s.id === normalized.activeStyle);
  assert.equal(style.name.length, 80);
  assert.equal(style.artist.length, 10000);
  assert.equal(style.positive.length, 12000);
  assert.equal(style.negative.length, 12000);
});

test('import accepts own single/bundle and common style aliases; imported IDs are always new', () => {
  const f = fixture(), first = f.controller.state().wechat.presetId;
  const a = f.controller.action('imagePreset.import', {json: {format: IMAGE_PRESET_FORMAT, version: 1, preset: {id: first, name: '第一個', artist: 'a', positive: 'p', negative: 'n'}}});
  const b = f.controller.action('imagePreset.import', {json: JSON.stringify({styles: [{id: first, name: '第二個', artist_prompt: 'artist:b', prompt: 'daytime', negative_prompt: 'night'}, {name: '第三個', positive_prompt: 'indoors', uc: 'rain'}]})});
  assert.notEqual(a.importedIds[0], first);
  assert.equal(new Set([...a.importedIds, ...b.importedIds]).size, 3);
  assert.equal(b.presets.at(-2).artist, 'artist:b');
  assert.equal(b.presets.at(-2).negative, 'night');
  assert.equal(b.presets.at(-1).positive, 'indoors');
  assert.equal(b.wechat.presetId, first);
});

test('invalid item rejects entire import and oversized or malformed files are explained', () => {
  const f = fixture(); f.controller.state();
  const before = structuredClone(f.c.extensionSettings), count = f.saves.length;
  assert.throws(() => f.controller.action('imagePreset.import', {json: [{name: '有效', prompt: 'ok'}, {name: '錯誤', params: {width: 800}}]}), /第 2 個預設.*64 的倍數/);
  assert.deepEqual(f.c.extensionSettings, before); assert.equal(f.saves.length, count);
  assert.throws(() => parseImagePresetImport('{bad json'), /不是有效的 JSON/);
  assert.throws(() => parseImagePresetImport({name: '巨大檔案', unused: 'x'.repeat(1048576)}), /1 MB/);
  assert.throws(() => parseImagePresetImport({format: IMAGE_PRESET_FORMAT, version: 99, presets: [{name: 'test'}]}), /版本不受支援/);
  assert.throws(() => parseImagePresetImport({name: '錯誤', model: 'not-a-model'}), /NovelAI 圖片模型/);
});

test('exports contain no credentials or unrelated fields; exported JSON round-trips with fresh IDs', () => {
  const f = fixture();
  const imported = f.controller.action('imagePreset.import', {json: {name: '旅行', prompt: 'coast', negative_prompt: 'fog', apiKey: 'IMPORT_KEY', relay: 'PRIVATE_RELAY', token: 'TOKEN'}});
  // Simulate an unrelated field accidentally inserted by a settings editor or old add-on.
  f.c.extensionSettings[KEY].imagePresets.presets.at(-1).secret = 'INJECTED_KEY';
  const output = f.controller.action('imagePreset.export', {id: imported.importedIds[0]});
  assert.equal(output.name, 'TavernPocket_ImagePresets_旅行.json');
  assert.doesNotMatch(output.json, /IMPORT_KEY|PRIVATE_RELAY|TOKEN|INJECTED_KEY|SECRET_NATIVE_KEY|apiKey|relay|secret/);
  const parsed = parseImagePresetImport(output.json);
  assert.deepEqual(parsed, [{name: '旅行', artist: '', positive: 'coast', negative: 'fog', model: '', params: {}}]);
  const again = f.controller.action('imagePreset.import', {json: output.json});
  assert.notEqual(again.importedIds[0], imported.importedIds[0]);
});

test('invalid parameter and override values fail before mutation; unknown data never enters prompt overrides', () => {
  const f = fixture(); f.controller.state();
  const before = structuredClone(f.c.extensionSettings);
  for (const params of [{width: 800}, {steps: 0}, {seed: 1.2}, {sampler: 'unknown'}, {variety: 'yes'}, {apiKey: 'NO'}]) assert.throws(() => add(f, {params}));
  assert.throws(() => f.controller.action('wechatImage.save', {presetId: 'missing'}), /有效的千里傳音生圖預設/);
  assert.throws(() => validateImageOverrides({model: 'nai-diffusion-3', params: {model: 'nai-diffusion-4-full'}}), /模型不一致/);
  assert.throws(() => validateImageOverrides({artist: 'x'.repeat(10001)}), /10000 字元/);
  assert.deepEqual(validateImageOverrides({positive: '', secret: 'bad', params: {model: 'nai-diffusion-3', width: 1024}}), {positive: '', params: {width: 1024}, model: 'nai-diffusion-3'});
  assert.deepEqual(f.c.extensionSettings, before);
});

test('preset count is capped and returned state cannot mutate persistent settings', () => {
  const f = fixture(), copy = f.controller.state();
  copy.presets[0].artist = 'tampered';
  copy.catalogue.models.push('fake');
  assert.equal(f.controller.state().presets[0].artist, 'artist:known');
  f.controller.action('imagePreset.import', {json: Array.from({length: 49}, (_, i) => ({name: `預設 ${i}`}))});
  assert.equal(f.controller.state().presets.length, 50);
  assert.throws(() => add(f), /最多可以儲存 50/);
  assert.throws(() => f.controller.action('imagePreset.import', {json: {name: '多一個'}}), /超過 50/);
});

test('persistent presets reload and failed save rolls back both preset and selection', () => {
  const f = fixture(), id = add(f);
  f.controller.action('wechatImage.save', {presetId: id, model: 'nai-diffusion-4-full'});
  const reloaded = createImagePresets({context: () => f.c, backend: f.backend});
  assert.equal(reloaded.resolve().presetId, id); assert.equal(reloaded.resolve().model, 'nai-diffusion-4-full');
  const before = structuredClone(f.c.extensionSettings);
  f.c.saveSettingsDebounced = () => {throw Error('save failed');};
  assert.throws(() => reloaded.action('imagePreset.delete', {id}), /save failed/);
  assert.deepEqual(f.c.extensionSettings, before);
});
