import {PHONE_VERSION} from './events.js';

export const PRESET_BOOK_NAME = '傳音玉符 · CSB 配套協定';
export const PRESET_SETTINGS_KEY = 'tavern_pocket_presets';
export const PRESET_OWNER = 'tavern-pocket-protocol';
export const PRESET_REGEX_ID = '9b30c203-7f7c-4d94-98f7-bd3b4e87d71f';
const clone = value => structuredClone(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pending = new WeakMap();
const isOwned = entry => entry?.extensions?.tavern_pocket?.owner === PRESET_OWNER;

/** Replace only our protocol entries; user-added entries and book metadata survive. */
export function mergePocketWorldbook(existing, bundled) {
  if (existing != null && (!object(existing) || !object(existing.entries))) throw Error('配套世界書格式異常，尚未覆寫原資料。');
  if (!object(bundled?.entries) || !Object.values(bundled.entries).every(isOwned)) throw Error('配套世界書檔案格式不符，尚未匯入。');
  const book = clone(existing || {entries: {}}), entries = {};
  for (const [key, entry] of Object.entries(book.entries)) if (!isOwned(entry)) entries[key] = entry;
  const used = new Set([...Object.keys(entries), ...Object.values(entries).map(entry => String(entry?.uid))]);
  let next = 0;
  for (const entry of Object.values(bundled.entries)) {
    while (used.has(String(next))) next++;
    entries[String(next)] = {...clone(entry), uid: next, displayIndex: next};
    used.add(String(next++));
  }
  book.entries = entries;
  book.extensions = {...(object(book.extensions) ? book.extensions : {}), tavern_pocket: {owner: PRESET_OWNER, version: PHONE_VERSION}};
  return book;
}

async function readBundled(fetcher, assertCurrent) {
  const [regex, book] = await Promise.all(['Regex', 'Worldbook'].map(async kind => {
    const response = await fetcher(new URL(`../presets/TavernPocket_${kind}_v${PHONE_VERSION}.json`, import.meta.url));
    if (!response.ok) throw Error(`配套檔案缺失，請重新安裝 v${PHONE_VERSION}。`);
    const value = await response.json(); assertCurrent(); return value;
  }));
  if (!object(regex) || regex.id !== PRESET_REGEX_ID || regex.markdownOnly !== true || regex.promptOnly !== false || regex.replaceString !== '') throw Error('配套正則檔案格式不符，尚未匯入。');
  return {regex, book};
}

/** Settings-level install: does not require or alter any open chat. */
export function installPocketPresets(c, {notice = () => {}, assertCurrent = () => {}, automatic = false, fetcher = globalThis.fetch} = {}) {
  const settings = c?.extensionSettings;
  if (!object(settings)) return Promise.reject(Error('酒館設定尚未就緒，請稍後再試。'));
  if (automatic && settings[PRESET_SETTINGS_KEY]?.version === PHONE_VERSION) return Promise.resolve({status: 'current', version: PHONE_VERSION, bookName: PRESET_BOOK_NAME});
  if (pending.has(settings)) return pending.get(settings);
  const job = (async () => {
    if (typeof c.saveWorldInfo !== 'function' || typeof c.loadWorldInfo !== 'function') {
      if (automatic) {
        const reason = '酒館未提供完整世界書讀寫 API，配套未自動匯入。請在玉符接入重試，或手動匯入插件 presets 內的世界書與正則。';
        notice(reason); return {status: 'unavailable', reason};
      }
      throw Error('酒館未提供完整世界書讀寫 API；請手動匯入插件 presets 內的世界書與正則。');
    }
    assertCurrent();
    const {regex, book: bundled} = await readBundled(fetcher, assertCurrent);
    const existing = await c.loadWorldInfo(PRESET_BOOK_NAME); assertCurrent();
    const names = typeof c.getWorldInfoNames === 'function' ? c.getWorldInfoNames() : [];
    if (existing == null && (Array.isArray(names) && names.includes(PRESET_BOOK_NAME) || settings[PRESET_SETTINGS_KEY]?.version)) throw Error('既有配套世界書無法讀取，尚未覆寫；請稍後重試。');
    const book = mergePocketWorldbook(existing, bundled);
    assertCurrent(); await c.saveWorldInfo(PRESET_BOOK_NAME, book, true); assertCurrent();
    // ST saveWorldInfo updates its cache before saving and some releases do not
    // reject non-OK HTTP responses. Verify the server copy when authenticated
    // request headers are available, before recording install completion.
    if (typeof c.getRequestHeaders === 'function') {
      const response = await fetcher('/api/worldinfo/get', {method: 'POST', headers: {...c.getRequestHeaders(), 'Content-Type': 'application/json'}, body: JSON.stringify({name: PRESET_BOOK_NAME}), cache: 'no-store'});
      assertCurrent();
      if (!response.ok) throw Error('無法確認配套世界書已儲存，尚未標記匯入完成；請稍後重試。');
      const persisted = await response.json(); assertCurrent();
      if (persisted?.extensions?.tavern_pocket?.version !== PHONE_VERSION || JSON.stringify(persisted.entries) !== JSON.stringify(book.entries)) throw Error('配套世界書儲存結果不完整，尚未標記匯入完成；請稍後重試。');
    }
    await c.updateWorldInfoList?.(); assertCurrent();
    if (settings.regex != null && !Array.isArray(settings.regex)) throw Error('酒館正則設定格式異常，已保留原設定。');
    // A stable rule ID upgrades only our former display-card rule. Other scripts
    // (including original character status bars) are left byte-for-byte intact.
    const previousRegex = settings.regex, previousMarker = settings[PRESET_SETTINGS_KEY];
    const nextRegex = [...(settings.regex || []).filter(rule => rule?.id !== PRESET_REGEX_ID), clone(regex)];
    const nextMarker = {version: PHONE_VERSION, bookName: PRESET_BOOK_NAME};
    settings.regex = nextRegex; settings[PRESET_SETTINGS_KEY] = nextMarker;
    try {await Promise.resolve(c.saveSettingsDebounced?.());}
    catch (error) {
      if (settings.regex === nextRegex) {if (previousRegex === undefined) delete settings.regex; else settings.regex = previousRegex;}
      if (settings[PRESET_SETTINGS_KEY] === nextMarker) {if (previousMarker === undefined) delete settings[PRESET_SETTINGS_KEY]; else settings[PRESET_SETTINGS_KEY] = previousMarker;}
      throw error;
    }
    notice(`已內建匯入 v${PHONE_VERSION} 世界書與正則；原有狀態欄保留，手機操作在手機內顯示。內建規則已提供協定，不需再重複綁定配套世界書。`);
    return {status: 'installed', version: PHONE_VERSION, bookName: PRESET_BOOK_NAME, entries: Object.keys(book.entries).length};
  })().finally(() => {if (pending.get(settings) === job) pending.delete(settings);});
  pending.set(settings, job); return job;
}

export function ensurePocketPresets(c, options = {}) {return installPocketPresets(c, {...options, automatic: true});}
