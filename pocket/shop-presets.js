/** Shopping styles are plain prompt text, never provider settings or executable code. */
export const SHOP_PRESET_FORMAT = 'tavern-pocket-shop-presets';
export const SHOP_PRESET_LIMITS = Object.freeze({presets: 32, name: 80, prompt: 24000, bytes: 1048576, segments: 128});
export const DEFAULT_SHOP_PRESET_ID = 'explicit-fantasy';
const builtins = Object.freeze([
  Object.freeze({id: 'current-world', name: '當前世界', builtin: true, prompt: '優先遵守當前故事的世界觀、年代、科技、貨幣與角色生活條件。日用品直接依用途提供；劇情推薦以能立即派上用場的物件為主。使用者明確要求的超常物件可作為萬寶商城特例，但要交代融入當前場景的方式。不要自行擴充成無關的強力能力或昂貴套裝。'}),
  Object.freeze({id: 'explicit-fantasy', name: '依需求・跨世界幻想', builtin: true, prompt: '商城可跨越故事的時代、科技與一般取得條件。不得因當前世界缺少某種技術、資格或品項就刪除需求、拒絕上架或擅自改成別的東西。優先忠於使用者明確指定的虛構商品與效果；生活用品仍按日常用途提供。描述物件如何出現在目前劇情中。人物以虛構 NPC 的特徵與角色用途呈現，資格與能力只在故事內生效。'}),
]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const bytes = value => new TextEncoder().encode(value).length;
const error = message => { throw Error(message); };
function bounded(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) error(`${label}須為 1–${max} 字元。`);
  return value.trim();
}
function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{1,120}$/.test(value)) error('商城預設識別無效。');
  return value;
}
function preset(value, withId = true) {
  if (!object(value)) error('商城預設格式錯誤。');
  return {...(withId ? {id: identifier(value.id)} : {}), name: bounded(value.name, SHOP_PRESET_LIMITS.name, '預設名稱'), prompt: bounded(value.prompt, SHOP_PRESET_LIMITS.prompt, '預設提示詞')};
}
function sizeCheck(value) {
  if (bytes(JSON.stringify(value)) > SHOP_PRESET_LIMITS.bytes) error('商城預設合計不得超過 1 MB，請縮短提示詞或刪除不需要的預設。');
  return value;
}

/** Reject corrupt saved state instead of silently dropping the user's presets. */
export function normalizeShopPresets(raw) {
  if (raw === undefined || raw === null) return {version: 1, selectedId: DEFAULT_SHOP_PRESET_ID, presets: []};
  if (!object(raw) || raw.version !== 1 || !Array.isArray(raw.presets) || raw.presets.length > SHOP_PRESET_LIMITS.presets) error('商城預設資料版本或格式不相容，請先保留備份。');
  const presets = raw.presets.map(value => preset(value)), ids = new Set(builtins.map(row => row.id));
  for (const row of presets) { if (ids.has(row.id)) error('商城預設識別重複。'); ids.add(row.id); }
  const selectedId = raw.selectedId === undefined ? DEFAULT_SHOP_PRESET_ID : identifier(raw.selectedId);
  if (!ids.has(selectedId)) error('選擇的商城預設已不存在，請重新選擇。');
  return sizeCheck({version: 1, selectedId, presets});
}

export function listShopPresets(raw) {
  return [...builtins.map(row => ({...row})), ...normalizeShopPresets(raw).presets.map(row => ({...row, builtin: false}))];
}

export function resolveShopPreset(raw, id) {
  const state = normalizeShopPresets(raw), selectedId = id === undefined ? state.selectedId : identifier(id);
  const selected = [...builtins, ...state.presets].find(row => row.id === selectedId);
  if (!selected) error('選擇的商城預設已不存在，請重新選擇。');
  return {...selected};
}

export function saveShopPreset(raw, input) {
  const state = normalizeShopPresets(raw), item = preset(input, false);
  const id = input.id === undefined ? '' : identifier(input.id), builtin = builtins.some(row => row.id === id);
  const index = state.presets.findIndex(row => row.id === id);
  if (id && !builtin && index < 0) error('要編輯的商城預設已不存在。');
  if (index < 0 && state.presets.length >= SHOP_PRESET_LIMITS.presets) error('最多可以儲存 32 個自訂商城預設。');
  const saved = {id: index < 0 ? `shop-${crypto.randomUUID()}` : id, ...item};
  if (index < 0) state.presets.push(saved); else state.presets[index] = saved;
  state.selectedId = saved.id;
  return sizeCheck(state);
}

export function selectShopPreset(raw, id) {
  const state = normalizeShopPresets(raw);
  state.selectedId = resolveShopPreset(state, id).id;
  return state;
}

export function deleteShopPreset(raw, id) {
  const state = normalizeShopPresets(raw); identifier(id);
  if (builtins.some(row => row.id === id)) error('內建商城預設不可刪除，可另存自訂版本。');
  if (!state.presets.some(row => row.id === id)) error('要刪除的商城預設已不存在。');
  state.presets = state.presets.filter(row => row.id !== id);
  if (state.selectedId === id) state.selectedId = DEFAULT_SHOP_PRESET_ID;
  return state;
}

function promptArray(document, values, name) {
  if (!Array.isArray(values) || !values.length || values.length > SHOP_PRESET_LIMITS.segments) error('提示詞陣列需要 1–128 個區段。');
  for (const row of values) {
    if (!object(row) || (row.content !== undefined && typeof row.content !== 'string') || (row.enabled !== undefined && typeof row.enabled !== 'boolean') || (row.marker !== undefined && typeof row.marker !== 'boolean')) error('提示詞區段格式錯誤。');
  }
  let rows = values;
  if (object(document) && document.prompt_order !== undefined) {
    if (!Array.isArray(document.prompt_order) || !document.prompt_order.length || document.prompt_order.length > 32) error('酒館預設的提示詞順序格式錯誤。');
    for (const group of document.prompt_order) {
      if (!object(group) || !Array.isArray(group.order) || group.order.length > SHOP_PRESET_LIMITS.segments) error('酒館預設的提示詞順序格式錯誤。');
      for (const row of group.order) if (!object(row) || typeof row.identifier !== 'string' || (row.enabled !== undefined && typeof row.enabled !== 'boolean')) error('酒館預設的提示詞順序格式錯誤。');
    }
    // SillyTavern uses the global character 100001 for the active custom order.
    const order = (document.prompt_order.find(group => Number(group.character_id) === 100001) || document.prompt_order[0]).order;
    const indexed = new Map();
    for (const row of values) {
      if (typeof row.identifier !== 'string' || !row.identifier || indexed.has(row.identifier)) error('酒館預設的提示詞識別缺失或重複。');
      indexed.set(row.identifier, row);
    }
    const seen = new Set();
    rows = order.flatMap(entry => {
      if (seen.has(entry.identifier)) error('酒館預設的提示詞順序含重複識別。');
      seen.add(entry.identifier);
      const row = indexed.get(entry.identifier);
      return entry.enabled === false || !row ? [] : [{...row, enabled: entry.enabled ?? row.enabled}];
    });
  }
  const contents = rows.filter(row => row.marker !== true && row.enabled !== false).map(row => row.content?.trim() || '').filter(Boolean);
  return preset({name: name || (object(document) && document.name) || '匯入的商城預設', prompt: contents.join('\n\n')}, false);
}

/** Import prompt text only. Credentials, connection settings and macros are not executed. */
export function importShopPresets(raw, payload) {
  const state = normalizeShopPresets(raw);
  let document = payload, importedName;
  if (object(payload) && (own(payload, 'text') || own(payload, 'json'))) { importedName = payload.name; document = payload.text ?? payload.json; }
  if (typeof document === 'string') {
    if (bytes(document) > SHOP_PRESET_LIMITS.bytes) error('商城預設檔案不可超過 1 MB。');
    try { document = JSON.parse(document); } catch { error('商城預設不是有效的 JSON。'); }
  } else {
    try { sizeCheck(document); } catch { error('商城預設格式錯誤或超過 1 MB。'); }
  }
  let rows;
  if (object(document) && Array.isArray(document.prompts)) rows = [promptArray(document, document.prompts, importedName)];
  else if (Array.isArray(document) && document.some(row => object(row) && own(row, 'content'))) rows = [promptArray(null, document, importedName)];
  else {
    if (object(document) && own(document, 'format') && document.format !== SHOP_PRESET_FORMAT) error('這不是支援的商城預設格式。');
    if (object(document) && own(document, 'version') && document.version !== 1) error('商城預設版本不相容。');
    const values = Array.isArray(document) ? document : object(document) && Array.isArray(document.presets) ? document.presets : object(document) && own(document, 'prompt') ? [document] : null;
    if (!values || !values.length || values.length > SHOP_PRESET_LIMITS.presets + builtins.length) error('請匯入商城預設，或含有 prompts／content 的酒館提示詞 JSON。');
    const seen = new Set();
    rows = values.map(value => {
      const item = preset(value, false);
      if (own(value, 'id')) {
        const id = identifier(value.id);
        if (seen.has(id)) error('匯入的商城預設識別重複。');
        seen.add(id); item.originalId = id;
      }
      return item;
    });
  }
  const imports = [], idMap = new Map();
  for (const row of rows) {
    const builtin = builtins.find(value => value.id === row.originalId && value.name === row.name && value.prompt === row.prompt);
    if (builtin) { idMap.set(row.originalId, builtin.id); continue; }
    const saved = {id: `shop-${crypto.randomUUID()}`, name: row.name, prompt: row.prompt};
    imports.push(saved);
    if (row.originalId) idMap.set(row.originalId, saved.id);
  }
  if (state.presets.length + imports.length > SHOP_PRESET_LIMITS.presets) error('匯入後會超過 32 個自訂商城預設，沒有匯入任何內容。');
  state.presets.push(...imports);
  state.selectedId = (object(document) && idMap.get(document.selectedId)) || imports[0]?.id || state.selectedId;
  return sizeCheck(state);
}

export function exportShopPresets(raw, id) {
  const state = normalizeShopPresets(raw), selected = id === undefined ? listShopPresets(state) : [resolveShopPreset(state, id)];
  return {format: SHOP_PRESET_FORMAT, version: 1, selectedId: id === undefined ? state.selectedId : selected[0].id,
    presets: selected.map(({id, name, prompt}) => ({id, name, prompt}))};
}
