import {PHONE_VERSION} from './events.js';

export const PRESET_BOOK_NAME = '傳音玉符 · CSB 配套協定';
export const PRESET_SETTINGS_KEY = 'tavern_pocket_presets';
export const PRESET_OWNER = 'tavern-pocket-protocol';
export const PRESET_REGEX_ID = '9b30c203-7f7c-4d94-98f7-bd3b4e87d71f';
const clone = value => structuredClone(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pending = new WeakMap(), states = new WeakMap();
const isOwned = entry => entry?.extensions?.tavern_pocket?.owner === PRESET_OWNER;
// The official regex import UI assigns a new UUID. Preserve an ownership tag so
// a later automatic repair upgrades that imported rule rather than duplicating it.
const isOwnedRegex = rule => rule?.id === PRESET_REGEX_ID || isOwned(rule);
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);

export function pocketPresetDownloads() {
  return Object.fromEntries([['worldbook','Worldbook'],['regex','Regex']].map(([key,kind]) => {
    const name = `TavernPocket_${kind}_v${PHONE_VERSION}.json`;
    return [key,{name,url:new URL(`../presets/${name}`,import.meta.url).href}];
  }));
}
export function getPocketPresetStatus(c) {
  const settings = c?.extensionSettings, marker = settings?.[PRESET_SETTINGS_KEY];
  return {status:'not-installed',message:'尚未完成配套檢查，可重新匯入或下載手動匯入。',version:PHONE_VERSION,
    installedVersion:marker?.version || '',bookName:PRESET_BOOK_NAME,worldbookVerified:false,refreshRequired:false,
    ...(object(settings) ? states.get(settings) : {}),
    regexInstalled:Array.isArray(settings?.regex) && settings.regex.some(rule=>isOwnedRegex(rule) && rule.disabled!==true)};
}

/** Replace only our protocol entries; user-added entries and book metadata survive. */
export function mergePocketWorldbook(existing, bundled) {
  if (existing != null && (!object(existing) || !object(existing.entries))) throw Error('配套世界書格式異常，尚未覆寫原資料。');
  if (!object(bundled?.entries) || !Object.values(bundled.entries).length || !Object.values(bundled.entries).every(isOwned)) throw Error('配套世界書檔案格式不符，尚未匯入。');
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
function bookCurrent(existing,bundled) {
  if (!object(existing?.entries) || existing?.extensions?.tavern_pocket?.version!==PHONE_VERSION) return false;
  const owned = Object.values(existing.entries).filter(isOwned);
  const target = Object.values(bundled.entries);
  if (owned.length!==target.length) return false;
  return target.every(entry=>{
    const found=owned.find(e=>e.extensions?.tavern_pocket?.key===entry.extensions?.tavern_pocket?.key);
    if(!found)return false;
    const {uid:_a,displayIndex:_b,...a}=found,{uid:_c,displayIndex:_d,...b}=entry;
    return same(a,b);
  });
}
async function readBundled(fetcher, assertCurrent) {
  const downloads=pocketPresetDownloads();
  const [regex, book] = await Promise.all(['regex', 'worldbook'].map(async kind => {
    const response = await fetcher(new URL(downloads[kind].url),{cache:'no-cache'});
    if (!response.ok) throw Error(`配套檔案缺失，請重新安裝 v${PHONE_VERSION}。`);
    const value = await response.json(); assertCurrent(); return value;
  }));
  if (!object(regex) || regex.id !== PRESET_REGEX_ID || regex.markdownOnly !== true || regex.promptOnly !== false || regex.replaceString !== '' || typeof regex.findRegex!=='string') throw Error('配套正則檔案格式不符，尚未匯入。');
  if (!object(book?.entries) || !Object.values(book.entries).length || !Object.values(book.entries).every(isOwned)) throw Error('配套世界書檔案格式不符，尚未匯入。');
  return {regex, book};
}
async function hostAccess(c,moduleLoader) {
  let module={};
  if(typeof c.loadWorldInfo!=='function'||typeof c.saveWorldInfo!=='function'||typeof c.updateWorldInfoList!=='function') {
    try { module=await moduleLoader(); } catch { /* Older/packaged hosts may not expose this module. Authenticated HTTP is the next supported path. */ }
  }
  return {
    load:typeof c.loadWorldInfo==='function'?c.loadWorldInfo.bind(c):module.loadWorldInfo,
    save:typeof c.saveWorldInfo==='function'?c.saveWorldInfo.bind(c):module.saveWorldInfo,
    refresh:typeof c.updateWorldInfoList==='function'?c.updateWorldInfoList.bind(c):module.updateWorldInfoList,
    names:typeof c.getWorldInfoNames==='function'?c.getWorldInfoNames.bind(c):()=>Array.isArray(module.world_names)?[...module.world_names]:null,
    headers:typeof c.getRequestHeaders==='function'?()=>({...c.getRequestHeaders(),'Content-Type':'application/json'}):null,
  };
}
async function serverBook(access,fetcher,assertCurrent) {
  const response=await fetcher('/api/worldinfo/get',{method:'POST',headers:access.headers(),body:JSON.stringify({name:PRESET_BOOK_NAME}),cache:'no-store'});
  assertCurrent();
  if(!response.ok)throw Error('無法讀取／確認伺服器上的配套世界書，尚未標記匯入完成；請確認酒館連線後重試。');
  const book=await response.json();assertCurrent();
  if(!object(book?.entries))throw Error('伺服器回傳的世界書格式不完整，尚未覆寫原資料。');
  return book;
}
/** Debounced host saves return undefined. On hosts with a completion event, wait
 * for it instead of announcing success before the settings request has run. */
async function saveSettings(c,{assertCurrent,timeoutMs}) {
  if(typeof c.saveSettingsDebounced!=='function')throw Error('酒館未提供設定儲存 API，正則尚未保存。請手動匯入正則。');
  const event=c.eventTypes?.SETTINGS_UPDATED ?? c.event_types?.SETTINGS_UPDATED;
  const events=c.eventSource;
  if(!event||typeof events?.on!=='function'||typeof events?.removeListener!=='function') {
    await Promise.resolve(c.saveSettingsDebounced());assertCurrent();return false;
  }
  await new Promise((resolve,reject)=>{
    let done=false,timer;
    const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);events.removeListener(event,updated);error?reject(error):resolve();};
    const updated=()=>{try{assertCurrent();finish();}catch(error){finish(error);}};
    events.on(event,updated);
    timer=setTimeout(()=>finish(Error('世界書已保存，但尚未收到正則設定儲存成功通知；請確認酒館連線後重新匯入。')),timeoutMs);
    try{Promise.resolve(c.saveSettingsDebounced()).catch(finish);}catch(error){finish(error);}
  });
  assertCurrent();
  // SETTINGS_UPDATED is emitted after the official server save succeeds.
  // Do not fetch all account settings merely to recheck one owned rule.
  return true;
}

/** Settings-level install: does not require or alter any open chat. */
export function installPocketPresets(c, {notice = () => {}, assertCurrent = () => {}, automatic = false, fetcher = globalThis.fetch,
  moduleLoader=()=>import('/scripts/world-info.js'), settingsTimeoutMs=12000} = {}) {
  const settings = c?.extensionSettings;
  if (!object(settings)) return Promise.reject(Error('酒館設定尚未就緒，請稍後再試。'));
  if (pending.has(settings)) return pending.get(settings);
  const update=(status,message,extra={})=>{states.set(settings,{...states.get(settings),status,message,...extra});return getPocketPresetStatus(c);};
  const job = (async () => {
    update('checking','正在檢查世界書與正則是否完整。',{worldbookVerified:false,settingsVerified:false,refreshRequired:false});
    const access=await hostAccess(c,moduleLoader);assertCurrent();
    if ((!access.load||!access.save)&&!access.headers) {
      const reason='酒館未提供可用的世界書讀寫介面，配套未自動匯入。請使用下方下載檔，在世界書與正則頁面手動匯入。';
      if(automatic){notice(reason);return update('unavailable',reason);}
      throw Error(reason);
    }
    const {regex, book: bundled} = await readBundled(fetcher, assertCurrent);
    // Prefer the server copy: host caches may still contain an old deleted or failed save.
    const existing=access.headers?await serverBook(access,fetcher,assertCurrent):await access.load(PRESET_BOOK_NAME);assertCurrent();
    const names=access.names();
    if(existing==null&&(Array.isArray(names)&&names.includes(PRESET_BOOK_NAME)||!Array.isArray(names)&&settings[PRESET_SETTINGS_KEY]?.version))throw Error('既有配套世界書無法讀取，尚未覆寫；請稍後重試。');
    if (settings.regex != null && !Array.isArray(settings.regex)) throw Error('酒館正則設定格式異常，已保留原設定。');
    const rules=(settings.regex||[]).filter(isOwnedRegex);
    if(automatic&&settings[PRESET_SETTINGS_KEY]?.version===PHONE_VERSION&&bookCurrent(existing,bundled)&&rules.length===1&&same(rules[0],regex)){
      return update('current',`v${PHONE_VERSION} 世界書與正則已檢查完成。`,{worldbookVerified:!!access.headers});
    }
    const book = mergePocketWorldbook(existing, bundled);
    assertCurrent();
    if(access.save)await access.save(PRESET_BOOK_NAME,book,true);
    else {
      const response=await fetcher('/api/worldinfo/edit',{method:'POST',headers:access.headers(),body:JSON.stringify({name:PRESET_BOOK_NAME,data:book})});
      assertCurrent();if(!response.ok)throw Error('配套世界書儲存失敗，沒有標記匯入完成；請確認酒館連線後重試。');
    }
    assertCurrent();
    if(access.headers) {
      const persisted=await serverBook(access,fetcher,assertCurrent);
      if(persisted?.extensions?.tavern_pocket?.version!==PHONE_VERSION||!same(persisted.entries,book.entries))throw Error('配套世界書儲存結果不完整，尚未標記匯入完成；請稍後重試。');
    }
    // Refresh failures do not erase a successfully persisted book; expose the
    // need to reload explicitly and let the user retry through the same button.
    let refreshRequired=!access.refresh;
    if(access.refresh){try{await access.refresh();}catch{refreshRequired=true;}assertCurrent();}
    const previousRegex = settings.regex, previousMarker = settings[PRESET_SETTINGS_KEY];
    const nextRegex = [...(settings.regex || []).filter(rule => !isOwnedRegex(rule)), clone(regex)];
    const nextMarker = {version: PHONE_VERSION, bookName: PRESET_BOOK_NAME};
    settings.regex = nextRegex; settings[PRESET_SETTINGS_KEY] = nextMarker;
    let settingsVerified=false;
    try {settingsVerified=await saveSettings(c,{assertCurrent,timeoutMs:settingsTimeoutMs});}
    catch (error) {
      if (settings.regex === nextRegex) {if (previousRegex === undefined) delete settings.regex; else settings.regex = previousRegex;}
      if (settings[PRESET_SETTINGS_KEY] === nextMarker) {if (previousMarker === undefined) delete settings[PRESET_SETTINGS_KEY]; else settings[PRESET_SETTINGS_KEY] = previousMarker;}
      throw error;
    }
    const message=`已匯入 v${PHONE_VERSION} 世界書與正則；原有狀態欄保留。${refreshRequired?'請重新整理酒館以更新世界書列表。':'可在世界書列表與全域正則找到配套。'}內建規則已提供協定，不需重複綁定。`;
    notice(message);
    return update('installed',message,{version:PHONE_VERSION,bookName:PRESET_BOOK_NAME,entries:Object.keys(book.entries).length,worldbookVerified:!!access.headers,settingsVerified,refreshRequired});
  })().catch(error=>{update('error',error.message);throw error;}).finally(() => {if (pending.get(settings) === job) pending.delete(settings);});
  pending.set(settings, job); return job;
}
export function ensurePocketPresets(c, options = {}) {return installPocketPresets(c, {...options, automatic: true});}
