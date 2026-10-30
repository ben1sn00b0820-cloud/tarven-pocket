import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PHONE_VERSION} from '../pocket/events.js';
import {installPocketPresets,ensurePocketPresets,mergePocketWorldbook,PRESET_SETTINGS_KEY,PRESET_BOOK_NAME,PRESET_REGEX_ID,PRESET_OWNER} from '../pocket/presets.js';

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
  assert(!Object.values(result.entries).some(e=>e.content==='outdated'));assert.equal(Object.values(result.entries).filter(e=>e.extensions?.tavern_pocket?.owner===PRESET_OWNER).length,15);
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
  await assert.rejects(installPocketPresets(f.c,{fetcher}),/完整世界書讀寫 API/);
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
  assert.equal(Object.keys(f.books.get(PRESET_BOOK_NAME).entries).length,15);
});


test('host cache is not treated as server persistence and world list refresh happens after verified save',async()=>{
  const f=fixture();f.c.getRequestHeaders=()=>({'X-CSRF-Token':'test-only'});let refreshed=0;
  f.c.updateWorldInfoList=async()=>{refreshed++;};
  const broken=async(url,options)=>url==='/api/worldinfo/get'?{ok:false}:fetcher(url,options);
  await assert.rejects(ensurePocketPresets(f.c,{fetcher:broken}),/無法確認/);
  assert.equal(f.settings[PRESET_SETTINGS_KEY],undefined);assert.equal(refreshed,0);
  const working=async(url,options)=>{if(url!=='/api/worldinfo/get')return fetcher(url,options);assert.equal(options.method,'POST');assert.equal(options.cache,'no-store');return {ok:true,json:async()=>structuredClone(f.books.get(PRESET_BOOK_NAME))};};
  assert.equal((await ensurePocketPresets(f.c,{fetcher:working})).status,'installed');assert.equal(refreshed,1);
});
