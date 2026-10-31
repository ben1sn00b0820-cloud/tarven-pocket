import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PHONE_VERSION} from '../pocket/events.js';
import {installPocketPresets,ensurePocketPresets,mergePocketWorldbook,PRESET_SETTINGS_KEY,PRESET_BOOK_NAME,PRESET_REGEX_ID,PRESET_OWNER,getPocketPresetStatus,pocketPresetDownloads} from '../pocket/presets.js';

const read = name => readFile(new URL(`../presets/${name}`,import.meta.url),'utf8').then(JSON.parse);
const fetcher = async url => ({ok:true,json:()=>readFile(url,'utf8').then(JSON.parse)});
function fixture(){
  const settings={regex:[{id:'my-status',findRegex:'/\\[MY_STATUS\\]/g',replaceString:'original'}]};
  const books=new Map(),saves=[];
  const c={extensionSettings:settings,loadWorldInfo:async name=>books.get(name)??null,saveWorldInfo:async(name,book,immediate)=>{books.set(name,structuredClone(book));saves.push({name,book,immediate});},saveSettingsDebounced:()=>{},getWorldInfoNames:()=>[...books.keys()]};
  return {c,settings,books,saves};
}

test('auto installation imports integrated presets once without needing a chat and manual refresh is idempotent',async()=>{
  const f=fixture(),original=structuredClone(f.settings.regex[0]);
  assert.equal((await ensurePocketPresets(f.c,{fetcher})).status,'installed');
  assert.equal(f.saves.length,1);assert.equal(f.saves[0].name,PRESET_BOOK_NAME);assert.equal(f.saves[0].immediate,true);
  assert.equal((await ensurePocketPresets(f.c,{fetcher})).status,'current');assert.equal(f.saves.length,1);
  const count=Object.keys(f.saves[0].book.entries).length;
  f.books.get(PRESET_BOOK_NAME).entries['99']={uid:99,comment:'我的附加條目',content:'keep unchanged',extensions:{other:1}};
  await installPocketPresets(f.c,{fetcher});
  assert.equal(Object.keys(f.books.get(PRESET_BOOK_NAME).entries).length,count+1);
  assert.equal(f.books.get(PRESET_BOOK_NAME).entries['99'].content,'keep unchanged');
  assert.deepEqual(f.settings.regex[0],original);assert.equal(f.settings.regex.filter(x=>x.id===PRESET_REGEX_ID).length,1);
  assert.equal(f.settings[PRESET_SETTINGS_KEY].version,PHONE_VERSION);
});

test('worldbook merge preserves unrelated book metadata and all custom entries even with uid collisions',async()=>{
  const bundled=await read(`TavernPocket_Worldbook_v${PHONE_VERSION}.json`);
  const existing={name:'custom',description:'keep',extensions:{foo:'bar'},entries:{'0':{uid:0,comment:'custom',content:'keep'},'70':{uid:70,extensions:{tavern_pocket:{owner:PRESET_OWNER}},content:'outdated'}}};
  const result=mergePocketWorldbook(existing,bundled);
  assert.equal(result.description,'keep');assert.equal(result.extensions.foo,'bar');assert.deepEqual(result.entries['0'],existing.entries['0']);
  assert(!Object.values(result.entries).some(e=>e.content==='outdated'));assert.equal(Object.values(result.entries).filter(e=>e.extensions?.tavern_pocket?.owner===PRESET_OWNER).length,17);
  assert.equal(new Set(Object.values(result.entries).map(e=>e.uid)).size,Object.keys(result.entries).length);
});

test('failed import never marks installed or replaces unrelated regex; retry succeeds',async()=>{
  const f=fixture(),old=structuredClone(f.settings);
  await assert.rejects(ensurePocketPresets(f.c,{fetcher:async()=>({ok:false})}),/配套檔案缺失/);
  assert.deepEqual(f.settings,old);assert.equal(f.saves.length,0);
  f.c.saveWorldInfo=async()=>{throw Error('server unavailable');};
  await assert.rejects(ensurePocketPresets(f.c,{fetcher}),/server unavailable/);assert.deepEqual(f.settings,old);
});

test('unavailable APIs and unreadable known book do not overwrite data',async()=>{
  const f=fixture();delete f.c.loadWorldInfo;
  assert.equal((await ensurePocketPresets(f.c,{fetcher})).status,'unavailable');
  await assert.rejects(installPocketPresets(f.c,{fetcher}),/世界書讀寫介面/);
  f.c.loadWorldInfo=async()=>null;f.c.getWorldInfoNames=()=>[PRESET_BOOK_NAME];
  await assert.rejects(installPocketPresets(f.c,{fetcher}),/無法讀取/);assert.equal(f.saves.length,0);
});

test('concurrent boots share one install and guard stops stale operations before mutation',async()=>{
  const f=fixture();const results=await Promise.all([ensurePocketPresets(f.c,{fetcher}),ensurePocketPresets(f.c,{fetcher})]);
  assert.equal(f.saves.length,1);assert.equal(results[0].status,'installed');assert.equal(results[1].status,'installed');
  const g=fixture();let count=0;
  await assert.rejects(installPocketPresets(g.c,{fetcher,assertCurrent:()=>{if(++count>2)throw Error('stale');}}),/stale/);
  assert.equal(g.saves.length,0);assert.equal(g.settings[PRESET_SETTINGS_KEY],undefined);
});


test('failed settings persistence restores previous regex and completion marker for safe retry',async()=>{
  const f=fixture(),before=structuredClone(f.settings);
  f.c.saveSettingsDebounced=()=>{throw Error('settings failed');};
  await assert.rejects(ensurePocketPresets(f.c,{fetcher}),/settings failed/);
  assert.deepEqual(f.settings,before);assert.equal(f.saves.length,1);
  f.c.saveSettingsDebounced=()=>{};
  assert.equal((await ensurePocketPresets(f.c,{fetcher})).status,'installed');
  assert.equal(Object.keys(f.books.get(PRESET_BOOK_NAME).entries).length,17);
});


test('host cache is not treated as server persistence and world list refresh happens after verified save',async()=>{
  const f=fixture();f.c.getRequestHeaders=()=>({'X-CSRF-Token':'test-only'});let refreshed=0;
  f.c.updateWorldInfoList=async()=>{refreshed++;};
  const broken=async(url,options)=>url==='/api/worldinfo/get'?{ok:false}:fetcher(url,options);
  await assert.rejects(ensurePocketPresets(f.c,{fetcher:broken}),/無法讀取／確認/);
  assert.equal(f.settings[PRESET_SETTINGS_KEY],undefined);assert.equal(refreshed,0);
  const working=async(url,options)=>{if(url!=='/api/worldinfo/get')return fetcher(url,options);assert.equal(options.method,'POST');assert.equal(options.cache,'no-store');return {ok:true,json:async()=>structuredClone(f.books.get(PRESET_BOOK_NAME) ?? {entries:{}})};};
  assert.equal((await ensurePocketPresets(f.c,{fetcher:working})).status,'installed');assert.equal(refreshed,1);
});

test('a stale success marker does not hide a removed worldbook or regex',async()=>{
  const f=fixture();await ensurePocketPresets(f.c,{fetcher});
  f.books.delete(PRESET_BOOK_NAME);f.settings.regex=f.settings.regex.filter(rule=>rule.id!==PRESET_REGEX_ID);
  assert.equal((await ensurePocketPresets(f.c,{fetcher})).status,'installed');
  assert.equal(f.saves.length,2);assert.equal(f.settings.regex.filter(x=>x.id===PRESET_REGEX_ID).length,1);
  assert.equal(getPocketPresetStatus(f.c).regexInstalled,true);
  assert.equal(Object.keys(f.books.get(PRESET_BOOK_NAME).entries).length,17);
});

test('older contexts can use official module exports without requiring getContext additions',async()=>{
  const f=fixture(),api={loadWorldInfo:f.c.loadWorldInfo,saveWorldInfo:f.c.saveWorldInfo,updateWorldInfoList:async()=>{}};
  delete f.c.loadWorldInfo;delete f.c.saveWorldInfo;
  const result=await installPocketPresets(f.c,{fetcher,moduleLoader:async()=>api});
  assert.equal(result.status,'installed');assert.equal(result.refreshRequired,false);assert.equal(f.saves.length,1);
});

test('authenticated endpoint fallback installs on packaged hosts and verifies the server copy',async()=>{
  const f=fixture();delete f.c.loadWorldInfo;delete f.c.saveWorldInfo;
  f.c.getRequestHeaders=()=>({'X-CSRF-Token':'test-token'});
  let server={entries:{custom:{uid:77,content:'user-owned'}}},writes=0,reads=0;
  const http=async(url,options)=>{
    if(url instanceof URL)return fetcher(url);
    assert.equal(options.headers['X-CSRF-Token'],'test-token');assert.equal(options.method,'POST');
    if(url==='/api/worldinfo/get'){reads++;return {ok:true,json:async()=>structuredClone(server)};}
    if(url==='/api/worldinfo/edit'){writes++;server=JSON.parse(options.body).data;return {ok:true};}
    throw Error('Unexpected endpoint');
  };
  const result=await installPocketPresets(f.c,{fetcher:http,moduleLoader:async()=>{throw Error('no module');}});
  assert.equal(result.status,'installed');assert.equal(result.worldbookVerified,true);assert.equal(result.refreshRequired,true);
  assert.equal(writes,1);assert.equal(reads,2);assert.equal(server.entries.custom.content,'user-owned');
  assert.equal((await ensurePocketPresets(f.c,{fetcher:http,moduleLoader:async()=>({})})).status,'current');assert.equal(writes,1);
});

test('server readback catches an ignored failed save even when the host cache looks current',async()=>{
  const f=fixture();f.c.getRequestHeaders=()=>({});const server={entries:{}};
  const http=async(url,options)=>url==='/api/worldinfo/get'?{ok:true,json:async()=>structuredClone(server)}:fetcher(url,options);
  await assert.rejects(installPocketPresets(f.c,{fetcher:http}),/儲存結果不完整/);
  assert.equal(f.saves.length,1);assert.equal(f.settings[PRESET_SETTINGS_KEY],undefined);
  assert.equal(getPocketPresetStatus(f.c).status,'error');assert(!getPocketPresetStatus(f.c).regexInstalled);
});

test('debounced host settings wait for completion and release their listener after success',async()=>{
  const f=fixture(),listeners=new Set();let scheduled=false;
  f.c.eventTypes={SETTINGS_UPDATED:'saved'};f.c.eventSource={on:(name,fn)=>listeners.add(fn),removeListener:(name,fn)=>listeners.delete(fn)};
  f.c.saveSettingsDebounced=()=>{scheduled=true;};
  let done=false;const job=installPocketPresets(f.c,{fetcher,settingsTimeoutMs:500}).then(v=>{done=true;return v;});
  while(!scheduled)await new Promise(r=>setTimeout(r,1));
  assert.equal(done,false);assert.equal(getPocketPresetStatus(f.c).status,'checking');
  for(const fn of listeners)fn();const result=await job;
  assert.equal(result.settingsVerified,true);assert.equal(listeners.size,0);assert.equal(done,true);
});

test('missing settings acknowledgement rolls back the marker and allows explicit retry',async()=>{
  const f=fixture(),before=structuredClone(f.settings),listeners=new Set();
  f.c.eventTypes={SETTINGS_UPDATED:'saved'};f.c.eventSource={on:(name,fn)=>listeners.add(fn),removeListener:(name,fn)=>listeners.delete(fn)};
  await assert.rejects(installPocketPresets(f.c,{fetcher,settingsTimeoutMs:10}),/尚未收到正則設定儲存成功/);
  assert.deepEqual(f.settings,before);assert.equal(listeners.size,0);assert.equal(getPocketPresetStatus(f.c).status,'error');
  f.c.saveSettingsDebounced=()=>{for(const fn of listeners)fn();};
  assert.equal((await installPocketPresets(f.c,{fetcher,settingsTimeoutMs:10})).status,'installed');
});

test('manual export files use native worldbook and single-regex shapes and preserve narrative panels',async()=>{
  const downloads=pocketPresetDownloads();
  assert.equal(downloads.worldbook.name,`TavernPocket_Worldbook_v${PHONE_VERSION}.json`);
  assert.equal(downloads.regex.name,`TavernPocket_Regex_v${PHONE_VERSION}.json`);
  const book=await read(downloads.worldbook.name),rule=await read(downloads.regex.name);
  assert(!Array.isArray(book.entries));assert.equal(Object.keys(book.entries).length,17);
  assert(Object.values(book.entries).every(e=>Number.isInteger(e.uid)&&Array.isArray(e.key)&&typeof e.content==='string'));
  assert.equal(typeof rule.scriptName,'string');assert.equal(rule.markdownOnly,true);assert.equal(rule.promptOnly,false);
  assert.deepEqual(rule.placement,[1,2]);assert.equal(rule.disabled,false);
  const last=rule.findRegex.lastIndexOf('/'),re=new RegExp(rule.findRegex.slice(1,last),rule.findRegex.slice(last+1));
  const text='故事正文\n[CSB21_PANEL]原有狀態[/CSB21_PANEL]\n<phone>{"id":"one"}</phone>\n<CSB_UPDATE>{"version":1,"characters":[]}</CSB_UPDATE>';
  assert.equal(text.replace(re,rule.replaceString),'故事正文\n[CSB21_PANEL]原有狀態[/CSB21_PANEL]\n\n');
});

test('manual regex import can change the UUID without creating duplicate owned rules on repair',async()=>{
  const f=fixture(),imported=await read(`TavernPocket_Regex_v${PHONE_VERSION}.json`);
  imported.id='uuid-assigned-by-official-import';f.settings.regex.push(imported);
  assert.equal(getPocketPresetStatus(f.c).regexInstalled,true);
  await installPocketPresets(f.c,{fetcher});
  assert.equal(f.settings.regex.length,2);assert.equal(f.settings.regex[0].id,'my-status');
  assert.equal(f.settings.regex[1].id,PRESET_REGEX_ID);
});
