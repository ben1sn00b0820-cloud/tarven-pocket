import test from 'node:test';
import assert from 'node:assert/strict';
import {createShopService, normalizeShopRequest, parseShopResponse, shopInstruction} from '../pocket/shop.js';
import {saveShopPreset, selectShopPreset} from '../pocket/shop-presets.js';

const product = {name:'旅行水壺',description:'可重複使用的輕量水壺。',price:25,kind:'items'};
const json = rows => JSON.stringify({items:rows});
function fixture(responses, initialPresets) {
  let presets=initialPresets, switched=false;
  const calls=[], data={catalogue:[{id:'old',name:'舊商品'}],wallet:{balance:300},inventory:['舊物品']};
  const service=createShopService({backend:{generateText:async(_,request)=>{calls.push(request);const response=responses.shift();return typeof response==='function'?response():response;}},taskPrompt:(_,prompt)=>prompt,getPresets:()=>presets,
    check:()=>{if(switched)throw Error('對話已切換');},edit:async(_,write)=>{if(switched)throw Error('對話已切換');write(data);}});
  return {service,calls,data,setPresets:value=>{presets=value;},switchChat:()=>{switched=true;}};
}

test('v0.9 shopping snapshots selected custom style and appends immutable output rules', async () => {
  const presets=saveShopPreset(undefined,{name:'旅人選物',prompt:'優先輕量且耐用的物件；自訂風格結束。'});
  const f=fixture([json([product])],presets);
  await f.service.generate({name1:'小青',name2:'旅伴'},{query:'100 元以內的旅行水壺'});
  const prompt=f.calls[0].prompt;
  assert.match(prompt,/旅人選物/);assert.match(prompt,/品項、用途、規格、數量與預算限制/);
  assert.equal(f.calls[0].pocketQuery,'100 元以內的旅行水壺');
  assert.ok(prompt.indexOf('固定商城輸出規則')>prompt.indexOf('自訂風格結束'));
  assert.match(prompt,/不代表購買/);assert.match(prompt,/只輸出 JSON/);
  assert.equal(f.data.catalogueSource.presetId,presets.selectedId);assert.equal(f.data.catalogueSource.presetName,'旅人選物');
  assert.equal(f.data.wallet.balance,300);assert.deepEqual(f.data.inventory,['舊物品']);
  assert.equal(f.data.catalogueSource.prompt,undefined);
});

test('v0.9 per-request preset override leaves saved selection untouched and invalid IDs do not call a model', async () => {
  const presets=selectShopPreset(undefined,'current-world'), f=fixture([json([product])],presets);
  await f.service.generate({}, {query:'水壺',presetId:'explicit-fantasy'});
  assert.match(f.calls[0].prompt,/商城可跨越故事/);assert.equal(f.data.catalogueSource.presetId,'explicit-fantasy');assert.equal(presets.selectedId,'current-world');
  await assert.rejects(f.service.generate({}, {query:'水壺',presetId:'deleted'}),/已不存在/);
  assert.equal(f.calls.length,1);
  for(const presetId of [null,4,{},'', '../x']) assert.throws(()=>normalizeShopRequest({query:'水壺',presetId}));
  assert.match(shopInstruction({query:'水壺',presetId:'current-world'}),/優先遵守當前故事/);
});

test('v0.9 preset changes during a pending response keep source attribution accurate; chat switches still block writes', async () => {
  const original=saveShopPreset(undefined,{name:'原預設',prompt:'原本提示詞'});
  let finish;
  const delayed=fixture([()=>new Promise(resolve=>{finish=resolve;})],original);
  const request=delayed.service.generate({}, {query:'水壺'});
  delayed.setPresets(selectShopPreset(original,'current-world'));
  finish(json([product])); await request;
  assert.equal(delayed.data.catalogueSource.presetId,original.selectedId);
  assert.equal(delayed.data.catalogueSource.presetName,'原預設');
  const blocked=fixture([()=>new Promise(resolve=>{finish=resolve;})],original), before=structuredClone(blocked.data);
  const blockedRequest=blocked.service.generate({}, {query:'水壺'});blocked.switchChat();finish(json([product]));
  await assert.rejects(blockedRequest,/對話已切換/);assert.deepEqual(blocked.data,before);
});

test('v0.9 custom styles do not enable refusal retries or enter the single syntax-repair prompt', async () => {
  const presets=saveShopPreset(undefined,{name:'我的風格',prompt:'CUSTOM-STYLE-ONLY'});
  const refusal=fixture(['抱歉，我不能提供商品清單。'],presets), before=structuredClone(refusal.data);
  await assert.rejects(refusal.service.generate({}, {query:'水壺'}),/未提供商品清單/);
  assert.equal(refusal.calls.length,1);assert.deepEqual(refusal.data,before);
  const malformed='{"items":[{"name":"旅行水壺" "description":"可重複使用的輕量水壺。","price":25}]}';
  const repair=fixture([malformed,json([product])],presets);
  await repair.service.generate({}, {query:'水壺'});
  assert.equal(repair.calls.length,2);assert.equal(repair.calls[1].pocketTask,'shop-repair');
  assert.doesNotMatch(repair.calls[1].prompt,/CUSTOM-STYLE-ONLY/);assert.deepEqual(repair.calls[1].pocketNames,[]);
  assert.equal(repair.calls[1].pocketQuery,'');
});

test('v0.9 collapses only exact duplicate goods, preserving distinct variants and prices', () => {
  const parsed=parseShopResponse(json([product,{...product,emoji:'🧃'}, {...product,price:30},{...product,description:'大容量旅行水壺。'}]));
  assert.equal(parsed.items.length,3);assert.equal(parsed.duplicates,1);
  assert.deepEqual(parsed.items.map(row=>row.price),[25,30,25]);
  assert.match(parsed.warnings.join(''),/內容與價格完全相同/);
});
