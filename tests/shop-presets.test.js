import test from 'node:test';
import assert from 'node:assert/strict';
import {SHOP_PRESET_FORMAT, SHOP_PRESET_LIMITS, normalizeShopPresets, listShopPresets, resolveShopPreset, saveShopPreset, deleteShopPreset, selectShopPreset, importShopPresets, exportShopPresets} from '../pocket/shop-presets.js';

test('shop presets retain built-ins, custom edits, selected identity and immutable input', () => {
  const base = normalizeShopPresets();
  assert.equal(base.selectedId, 'explicit-fantasy');
  assert.deepEqual(listShopPresets(base).map(row => row.id), ['current-world', 'explicit-fantasy']);
  const added = saveShopPreset(base, {name: '旅行用品', prompt: '優先輕量、可重複使用的旅行用品。', apiKey: 'not-saved'});
  assert.equal(base.presets.length, 0); assert.equal(added.presets.length, 1);
  assert.deepEqual(Object.keys(added.presets[0]).sort(), ['id','name','prompt']);
  assert.equal(resolveShopPreset(added).name, '旅行用品');
  const edited = saveShopPreset(added, {...added.presets[0], prompt: '優先日常實用商品。'});
  assert.equal(edited.presets[0].id, added.presets[0].id);
  assert.notEqual(edited.presets[0].prompt, added.presets[0].prompt);
  const selected = selectShopPreset(edited, 'current-world');
  assert.equal(resolveShopPreset(selected).id, 'current-world');
  const deleted = deleteShopPreset(edited, added.selectedId);
  assert.equal(deleted.selectedId, 'explicit-fantasy'); assert.equal(deleted.presets.length, 0);
  assert.throws(() => deleteShopPreset(deleted, 'current-world'), /不可刪除/);
});

test('editing a built-in creates a separate custom copy without changing defaults', () => {
  const original = resolveShopPreset(undefined, 'current-world');
  const copied = saveShopPreset(undefined, {...original, name:'我的世界',prompt:'只提供可攜帶物件。'});
  assert.notEqual(copied.selectedId, original.id); assert.equal(copied.presets.length,1);
  assert.deepEqual(resolveShopPreset(copied, original.id), original);
});

test('native export roundtrip maps custom IDs without overwriting existing presets or importing settings', () => {
  const first = saveShopPreset(undefined, {name:'原始',prompt:'提供耐用商品。'});
  const exported = exportShopPresets(first);
  assert.equal(exported.format, SHOP_PRESET_FORMAT);
  const imported = importShopPresets(first, {text:JSON.stringify({...exported,apiKey:'secret',model:'override'})});
  assert.equal(imported.presets.length,2);
  assert.equal(imported.presets[0].id, first.selectedId);
  assert.notEqual(imported.selectedId, first.selectedId);
  assert.equal(resolveShopPreset(imported).prompt, '提供耐用商品。');
  assert.doesNotMatch(JSON.stringify(imported), /secret|override/);
  const single = exportShopPresets(first, first.selectedId);
  assert.equal(single.presets.length,1);assert.equal(single.selectedId,first.selectedId);
  assert.throws(() => exportShopPresets(first, 'deleted'), /已不存在/);
});

test('SillyTavern imports only enabled ordered text, skips dynamic markers and chooses active global order', () => {
  const document = {name:'酒館轉入',api_key:'secret',custom_url:'https://private.test',prompts:[
    {identifier:'a',content:'甲',enabled:false}, {identifier:'b',content:'乙'}, {identifier:'c',content:'不啟用'},
    {identifier:'worldInfoBefore',marker:true,content:'動態世界書不匯入'}, {identifier:'unused',content:'未在順序中'},
  ],prompt_order:[
    {character_id:100000,order:[{identifier:'c',enabled:true}]},
    {character_id:100001,order:[{identifier:'b',enabled:true},{identifier:'worldInfoBefore',enabled:true},{identifier:'a',enabled:true},{identifier:'c',enabled:false}]},
  ]};
  const imported = importShopPresets(undefined, document);
  assert.equal(imported.presets.length,1);assert.equal(imported.presets[0].name,'酒館轉入');
  assert.equal(imported.presets[0].prompt, '乙\n\n甲');
  assert.doesNotMatch(JSON.stringify(exportShopPresets(imported)), /secret|private|未在順序中|不啟用|動態世界書不匯入/);
});

test('plain role/content arrays and direct name/prompt files import as bounded plain text', () => {
  const array = importShopPresets(undefined, {text:JSON.stringify([{role:'system',content:'採用品質較好的物品。'},{role:'user',content:'{{user}} 的需求'},{content:'略過',enabled:false}]),name:'旅人'});
  assert.equal(resolveShopPreset(array).name,'旅人');
  assert.equal(resolveShopPreset(array).prompt,'採用品質較好的物品。\n\n{{user}} 的需求');
  const simple = importShopPresets(array, {name:'古典風格',prompt:'以古典世界觀呈現。'});
  assert.equal(resolveShopPreset(simple).name,'古典風格');assert.equal(simple.presets.length,2);
});

test('invalid or oversized imports fail atomically and never silently truncate prompts', () => {
  const state = saveShopPreset(undefined, {name:'保留',prompt:'保留原文。'}), before = structuredClone(state);
  const invalid = [
    '{bad', ' '.repeat(SHOP_PRESET_LIMITS.bytes+1), {version:2,presets:[{name:'x',prompt:'x'}]},
    {name:'x',prompt:'x'.repeat(SHOP_PRESET_LIMITS.prompt+1)}, {name:'x'.repeat(81),prompt:'x'},
    {prompts:Array(129).fill({content:'x'})}, [{content:{code:'x'}}], [{content:'x',enabled:'false'}],
    {prompts:[{identifier:'a',content:'x'}],prompt_order:[{order:[{identifier:'a',enabled:'true'}]}]},
    {presets:[{id:'same',name:'x',prompt:'x'},{id:'same',name:'y',prompt:'y'}]},
    {prompts:[{identifier:'a',content:'x'},{identifier:'a',content:'y'}],prompt_order:[{order:[]}]},
    {prompts:[{identifier:'a',marker:true}]},
  ];
  for (const document of invalid) {assert.throws(() => importShopPresets(state,document));assert.deepEqual(state,before);}
});

test('limits, stale IDs and invalid saved versions preserve existing state', () => {
  const full = {version:1,selectedId:'explicit-fantasy',presets:Array.from({length:32},(_,i)=>({id:'custom-'+i,name:'預設'+i,prompt:'有效提示詞'}))};
  assert.throws(() => saveShopPreset(full,{name:'超額',prompt:'內容'}),/32/);
  assert.throws(() => importShopPresets(full,{name:'超額',prompt:'內容'}),/32/);
  assert.throws(() => saveShopPreset(full,{id:'missing',name:'x',prompt:'x'}),/已不存在/);
  assert.throws(() => selectShopPreset(full,'missing'),/已不存在/);
  assert.throws(() => normalizeShopPresets({...full,version:2}),/版本/);
  assert.throws(() => normalizeShopPresets({...full,presets:[{id:'current-world',name:'x',prompt:'x'}]}),/重複/);
  assert.equal(full.presets.length,32);
  const huge = {...full,presets:full.presets.map(row=>({...row,prompt:'字'.repeat(24000)}))};
  assert.throws(() => normalizeShopPresets(huge), /1 MB/);
});
