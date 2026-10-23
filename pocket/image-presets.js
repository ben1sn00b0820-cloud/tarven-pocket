import {NAI_MODELS, NAI_MODEL_NAMES, NAI_SAMPLERS, NAI_SCHEDULES, defaultDrawParams, normalizeDrawParams} from '../core/novelai.js';

const KEY = 'tavern_pocket_v3';
export const IMAGE_PRESET_FORMAT = 'tavern-pocket-image-presets';
export const IMAGE_PRESET_LIMITS = Object.freeze({presets: 50, bytes: 1048576, name: 80, artist: 10000, positive: 12000, negative: 12000});
const PARAMS = new Set(['width', 'height', 'steps', 'scale', 'sampler', 'schedule', 'seed', 'cfgRescale', 'variety']);
const clone = value => structuredClone(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = text => { throw Error(text); };
const bytes = value => new TextEncoder().encode(value).length;
const bounded = (value, key, {required = false} = {}) => {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') fail(`${({name: '預設名稱', artist: '畫師串', positive: '正面提示詞', negative: '負面提示詞'})[key]}必須是文字。`);
  const text = value.trim();
  if (text.length > IMAGE_PRESET_LIMITS[key] || required && !text) fail(`${({name: '預設名稱', artist: '畫師串', positive: '正面提示詞', negative: '負面提示詞'})[key]}${required ? '需要填寫，且' : ''}不能超過 ${IMAGE_PRESET_LIMITS[key]} 字元。`);
  return text;
};
const model = value => {
  if (value === undefined || value === '') return '';
  if (!NAI_MODELS.includes(value)) fail('找不到這個 NovelAI 圖片模型，請重新選擇。');
  return value;
};

/** Keep only supported NovelAI parameters; reject bad values instead of silently changing an import. */
export function validateImageParams(value = {}) {
  if (!object(value)) fail('生圖參數必須是 JSON 物件。');
  const result = {};
  for (const [key, val] of Object.entries(value)) {
    if (key === 'model') { model(val); continue; }
    if (!PARAMS.has(key)) fail(`不支援的生圖參數：${String(key).slice(0, 50)}。`);
    if (key === 'sampler' || key === 'schedule') {
      if (!(key === 'sampler' ? NAI_SAMPLERS : NAI_SCHEDULES).includes(val)) fail(key === 'sampler' ? 'NovelAI 取樣器無效。' : 'NovelAI 排程器無效。');
    } else if (key === 'variety') {
      if (typeof val !== 'boolean') fail('多樣性設定必須是開啟或關閉。');
    } else {
      const [min, max] = ({width: [64, 1856], height: [64, 1856], steps: [1, 50], scale: [0, 10], seed: [-1, 4294967295], cfgRescale: [0, 1]})[key];
      if (typeof val !== 'number' || !Number.isFinite(val) || val < min || val > max) fail(`生圖參數 ${key} 必須是 ${min}–${max} 的數字。`);
      if (['width', 'height', 'steps', 'seed'].includes(key) && !Number.isInteger(val)) fail(`生圖參數 ${key} 必須是整數。`);
      if (['width', 'height'].includes(key) && val % 64 !== 0) fail('圖片寬高必須是 64 的倍數。');
    }
    result[key] = val;
  }
  return result;
}

function preset(value) {
  if (!object(value)) fail('每個生圖預設都必須是 JSON 物件。');
  const params = validateImageParams(value.params === undefined ? {} : value.params);
  if (value.model && value.params?.model && value.model !== value.params.model) fail('預設與參數內的模型不一致，請只保留同一個模型。');
  return {
    name: bounded(value.name, 'name', {required: true}),
    artist: bounded(value.artist ?? value.artist_prompt, 'artist'),
    positive: bounded(value.positive ?? value.prompt ?? value.positive_prompt, 'positive'),
    negative: bounded(value.negative ?? value.negative_prompt ?? value.uc, 'negative'),
    model: model(value.model ?? value.params?.model), params,
  };
}

/** Untrusted JSON is reduced to known fields; keys, relays and other provider settings never enter presets. */
export function parseImagePresetImport(input) {
  let document, text;
  try { text = typeof input === 'string' ? input : JSON.stringify(input); }
  catch { fail('預設內容無法讀取為 JSON。'); }
  if (typeof text !== 'string' || !text.trim()) fail('請選擇有效的 JSON 預設檔案。');
  if (bytes(text) > IMAGE_PRESET_LIMITS.bytes) fail('預設檔案不能超過 1 MB。');
  try { document = JSON.parse(text); }
  catch { fail('預設檔案不是有效的 JSON，沒有匯入任何內容。'); }
  let list;
  if (object(document) && own(document, 'format')) {
    if (document.format !== IMAGE_PRESET_FORMAT || document.version !== 1) fail('這個生圖預設的格式或版本不受支援。');
    list = document.presets ?? (document.preset ? [document.preset] : null);
  } else if (Array.isArray(document)) list = document;
  else if (object(document) && own(document, 'presets')) list = document.presets;
  else if (object(document) && own(document, 'styles')) list = document.styles;
  else list = [document];
  if (!Array.isArray(list) || !list.length || list.length > IMAGE_PRESET_LIMITS.presets) fail('每次需要匯入 1–50 個生圖預設。');
  return list.map((value, index) => {
    try { return preset(value); }
    catch (error) { throw Error(`第 ${index + 1} 個預設：${error.message}`); }
  });
}

/** Validate a per-photo patch without filling absent fields; empty text deliberately clears that field. */
export function validateImageOverrides(value = {}) {
  if (!object(value)) fail('圖片提示詞設定格式錯誤。');
  const result = {};
  if (own(value, 'presetId')) {
    if (typeof value.presetId !== 'string' || value.presetId.length > 120) fail('生圖預設識別無效。');
    result.presetId = value.presetId;
  }
  if (own(value, 'model')) result.model = model(value.model);
  for (const key of ['artist', 'positive', 'negative']) if (own(value, key)) result[key] = bounded(value[key], key);
  if (own(value, 'params')) {
    result.params = validateImageParams(value.params);
    if (value.params.model && value.model && value.params.model !== value.model) fail('圖片與參數內的模型不一致，請只保留同一個模型。');
    if (value.params.model && !own(value, 'model')) result.model = model(value.params.model);
  }
  return result;
}

/** Phone presets are independent from the drawing app: selecting one never switches its engine or style. */
export function createImagePresets({context, backend}) {
  const nativeDraw = () => backend.settings?.draw || {};
  const nativeStyle = () => {
    const draw = nativeDraw(), styles = Array.isArray(draw.styles) ? draw.styles : [];
    return styles.find(item => item.id === draw.activeStyle) || styles[0] || {};
  };
  const nativeValues = () => {
    const style = nativeStyle();
    return {name: typeof style.name === 'string' ? style.name.slice(0, 80) : '目前 NovelAI 畫風', artist: String(style.artist || '').slice(0, IMAGE_PRESET_LIMITS.artist), positive: String(style.positive || '').slice(0, IMAGE_PRESET_LIMITS.positive), negative: String(style.negative || '').slice(0, IMAGE_PRESET_LIMITS.negative), model: '', params: {}};
  };
  function configuration() {
    const c = context();
    if (!object(c?.extensionSettings)) fail('目前無法存取酒館擴充功能設定。');
    const config = c.extensionSettings[KEY] ??= {};
    if (!own(config, 'imagePresets')) {
      const initial = {id: crypto.randomUUID(), ...nativeValues()};
      config.imagePresets = {version: 1, presets: [initial]};
      config.wechatImage ??= {presetId: initial.id, model: ''};
      c.saveSettingsDebounced?.();
    }
    if (!object(config.imagePresets) || config.imagePresets.version !== 1 || !Array.isArray(config.imagePresets.presets)) fail('生圖預設資料版本不相容，請先保留備份。');
    config.wechatImage ??= {presetId: '', model: ''};
    return {c, config};
  }
  function snapshot() {
    const {config} = configuration();
    return {presets: clone(config.imagePresets.presets), wechat: clone(config.wechatImage)};
  }
  function persist(next) {
    const exported = next.presets.map(item => preset(item));
    if (bytes(JSON.stringify({format: IMAGE_PRESET_FORMAT, version: 1, presets: exported}, null, 2)) > IMAGE_PRESET_LIMITS.bytes) fail('全部生圖預設合計不能超過 1 MB，請縮短提示詞或刪除不需要的預設。');
    const {c, config} = configuration(), oldPresets = config.imagePresets, oldSelection = config.wechatImage;
    config.imagePresets = {version: 1, presets: clone(next.presets)};
    config.wechatImage = clone(next.wechat);
    try { c.saveSettingsDebounced?.(); }
    catch (error) { config.imagePresets = oldPresets; config.wechatImage = oldSelection; throw error; }
    backend.emit?.('pocket', {});
  }
  function state() {
    const {presets, wechat} = snapshot();
    // Whitelisting here also prevents unrelated fields in hand-edited settings from reaching exports or UI.
    return {version: 1, presets: presets.map(item => ({id: item.id, ...preset(item)})), wechat: {presetId: String(wechat.presetId || ''), model: model(wechat.model)}, catalogue: {models: [...NAI_MODELS], modelNames: {...NAI_MODEL_NAMES}, samplers: [...NAI_SAMPLERS], schedules: [...NAI_SCHEDULES]}, limits: {...IMAGE_PRESET_LIMITS}};
  }
  function resolve(value = {}) {
    const overrides = validateImageOverrides(value), {presets, wechat} = snapshot();
    const presetId = own(overrides, 'presetId') ? overrides.presetId : wechat.presetId || '';
    const chosen = presetId ? presets.find(item => item.id === presetId) : null;
    if (presetId && !chosen) fail('選擇的生圖預設已不存在，請重新選擇。');
    const selected = chosen ? preset(chosen) : nativeValues();
    const modelId = overrides.model || (own(overrides, 'presetId') && chosen ? selected.model : '') || wechat.model || selected.model || normalizeDrawParams(nativeDraw().params || defaultDrawParams()).model;
    const params = normalizeDrawParams({...nativeDraw().params, ...selected.params, ...overrides.params, model: model(modelId)});
    return {presetId, presetName: selected.name, artist: overrides.artist ?? selected.artist, positive: overrides.positive ?? selected.positive, negative: overrides.negative ?? selected.negative, model: params.model, params};
  }
  function action(name, payload = {}) {
    if (!object(payload)) fail('生圖預設操作格式錯誤。');
    if (name === 'imagePreset.apply') {
      const item = state().presets.find(item => item.id === payload.id);
      if (!item) fail('要套用的生圖預設已不存在。');
      if (typeof backend.saveStyle !== 'function' || typeof backend.saveDraw !== 'function') fail('目前無法套用繪圖設定，請重新開啟手機。');
      const styleId = `pocket-image-${item.id}`;
      const params = normalizeDrawParams({...nativeDraw().params, ...item.params, ...(item.model ? {model: item.model} : {})});
      backend.saveStyle({id: styleId, name: item.name, artist: item.artist, positive: item.positive, negative: item.negative});
      backend.saveDraw({engine: 'nai', activeStyle: styleId, params});
      return {...state(), appliedId: item.id};
    }
    if (name === 'imagePreset.export') {
      const current = state(), items = payload.id ? current.presets.filter(item => item.id === payload.id) : current.presets;
      if (!items.length) fail('沒有可以匯出的生圖預設。');
      const exported = items.map(({id, ...item}) => item);
      return {name: `TavernPocket_ImagePresets${payload.id ? '_' + items[0].name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') : ''}.json`, json: JSON.stringify({format: IMAGE_PRESET_FORMAT, version: 1, presets: exported}, null, 2)};
    }
    const next = snapshot();
    let result = {};
    if (name === 'imagePreset.save') {
      const item = preset(payload);
      if (payload.id !== undefined && (typeof payload.id !== 'string' || !payload.id)) fail('生圖預設識別無效。');
      const existing = payload.id ? next.presets.findIndex(item => item.id === payload.id) : -1;
      if (payload.id && existing < 0) fail('要修改的生圖預設已不存在。');
      if (existing < 0 && next.presets.length >= IMAGE_PRESET_LIMITS.presets) fail('最多可以儲存 50 個生圖預設，請先刪除不需要的預設。');
      const saved = {id: payload.id || crypto.randomUUID(), ...item};
      if (existing >= 0) next.presets[existing] = saved; else next.presets.push(saved);
      result.savedId = saved.id;
    } else if (name === 'imagePreset.delete') {
      if (!next.presets.some(item => item.id === payload.id)) fail('要刪除的生圖預設已不存在。');
      next.presets = next.presets.filter(item => item.id !== payload.id);
      if (next.wechat.presetId === payload.id) next.wechat.presetId = '';
    } else if (name === 'imagePreset.import') {
      const imported = parseImagePresetImport(payload.json);
      if (next.presets.length + imported.length > IMAGE_PRESET_LIMITS.presets) fail('匯入後會超過 50 個生圖預設，沒有匯入任何內容。');
      const items = imported.map(item => ({id: crypto.randomUUID(), ...item}));
      next.presets.push(...items);
      result.importedIds = items.map(item => item.id);
    } else if (name === 'wechatImage.save') {
      if (own(payload, 'presetId')) {
        if (typeof payload.presetId !== 'string' || payload.presetId && !next.presets.some(item => item.id === payload.presetId)) fail('請選擇有效的微信生圖預設。');
        next.wechat.presetId = payload.presetId;
      }
      if (own(payload, 'model')) next.wechat.model = model(payload.model);
    } else fail('不支援的生圖預設操作。');
    persist(next);
    return {...state(), ...result};
  }
  return {state, action, resolve};
}
