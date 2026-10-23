import test from 'node:test';
import assert from 'node:assert/strict';
import {shopPrice, parseShopResponse, createShopService} from '../pocket/shop.js';
import {searchMarkup} from '../pocket/shop-ui.js';

const item = (fields = {}) => ({name:'時間停止能力', description:'停止故事中的時間。', price:1200, kind:'abilities', ...fields});
function fixture(responses) {
  const data = {catalogue:[{id:'old', ...item({name:'旧商品'})}], catalogueSource:{mode:'query',query:'先前查詢'}};
  const calls = []; let commits = 0, switched = false;
  const service = createShopService({
    backend:{generateText:async (_, request) => {calls.push(request);const result = responses.shift();if (result instanceof Error) throw result;return result;}},
    taskPrompt:(_, instruction, options) => {assert.deepEqual(options, {app:'shop'}); return instruction;},
    check:() => {if(switched) throw Error('對話已切換');},
    edit:async (_, write) => {if(switched) throw Error('對話已切換');write(data);commits++;},
  });
  return {data, calls, service, commits:()=>commits, switch:()=>{switched = true;}};
}
const ctx = {name1:'使用者', name2:'角色'};
const json = entries => JSON.stringify({items:entries});

test('v0.8 reads prose-wrapped fenced JSON and direct product arrays with exact decimal strings', () => {
  const raw = '為你找到了：\n```json\n' + JSON.stringify([item({price:'¥ 1,200.50', description:'效果包含字元 } ]，保持原文。'})]) + '\n```\n請選擇。';
  const parsed = parseShopResponse(raw, {id:()=> 'only', now:20});
  assert.equal(parsed.items[0].price, 1200.5);assert.equal(parsed.items[0].cents,120050);
  assert.equal(parsed.items[0].description,'效果包含字元 } ]，保持原文。');assert.equal(parsed.items[0].source,'model');
  assert.equal(parsed.items[0].id,'only');assert.equal(parsed.items[0].at,20);
});

test('v0.8 keeps valid partial products and never makes malformed prices free', () => {
  const parsed = parseShopResponse(json([item(), item({price:'免費'}), item({name:'礦泉水',price:'20–30'}), item({name:'旅行牙刷',price:'12.34'}), item({price:null})]));
  assert.deepEqual(parsed.items.map(value=>value.price),[1200,12.34]);assert.equal(parsed.skipped,3);assert.match(parsed.warnings[0],/略過 3 件/);
  for(const bad of ['', '免費','-1','1e3','20–30','1,23','0','1.234',null,true,undefined]) assert.throws(()=>shopPrice(bad),/價格格式錯誤/);
  for(const [given,expected] of [['  NT$ 1,200.50 元 ',1200.5],['0.01',.01],[99999,99999]]) assert.equal(shopPrice(given),expected);
});

test('v0.8 keeps first eight valid products when model returns extra and labels omissions', () => {
  const parsed=parseShopResponse(JSON.stringify({products:Array.from({length:12},(_,i)=>item({name:'商品'+i}))}));
  assert.equal(parsed.items.length,8);assert.equal(parsed.omitted,4);assert.match(parsed.warnings[0],/另 4 件未上架/);
});

test('v0.8 can preserve complete rows from a truncated catalogue without another model request', async () => {
  const f=fixture(['{"items":['+JSON.stringify(item())+',{"name":"未完成']);
  await f.service.generate(ctx,{query:'能力'});
  assert.equal(f.calls.length,1);assert.equal(f.data.catalogue[0].name,'時間停止能力');assert.match(f.data.catalogueSource.warnings[0],/未完整結束/);
});

test('v0.8 ignores reasoning-only catalogues and accepts Chinese field aliases', () => {
  const raw='<think>'+json([item({name:'思考樣本'})])+'</think>\n'+JSON.stringify({商品:[{商品名稱:'礦泉水',說明:'旅行飲水。',售價:'20'}]});
  assert.equal(parseShopResponse(raw).items[0].name,'礦泉水');
});

test('v0.8 distinguishes refusal/plain text, empty results and price errors without repair retries', async () => {
  for(const raw of ['抱歉，我不能提供這份商品清單。', '', json([]), json([item({price:'約100'})])]) {
    const f=fixture([raw]);const before=structuredClone(f.data);
    await assert.rejects(f.service.generate(ctx,{query:'能力'}));
    assert.equal(f.calls.length,1);assert.equal(f.commits(),0);assert.deepEqual(f.data,before);
  }
});

test('v0.8 repairs one malformed JSON response and proves original values before publishing', async () => {
  const bad='{"items":[{"name":"時間停止能力" "description":"停止故事中的時間。", "price":1200}]}';
  const f=fixture([bad,json([item()])]);
  await f.service.generate(ctx,{query:'時間停止能力'});
  assert.equal(f.calls.length,2);assert.equal(f.calls[0].pocketTask,'shop');assert.equal(f.calls[1].pocketTask,'shop-repair');assert.deepEqual(f.calls[1].pocketNames,[]);
  assert.equal(f.data.catalogueSource.repaired,true);assert.equal(f.data.catalogue[0].price,1200);assert.equal(f.commits(),1);
});

test('v0.8 failed format repair is bounded and altered or invented prices cannot be published', async () => {
  const bad='{"items":[{"name":"時間停止能力" "description":"停止故事中的時間。", "price":1200}]}';
  for (const fixed of [bad,json([item({price:1})]),json([item({description:'額外獲得無敵效果。'})]),json([item({name:'另一項能力'})])]) {
    const f=fixture([bad,fixed]);const before=structuredClone(f.data);
    await assert.rejects(f.service.generate(ctx,{query:'能力'}),/修復/);assert.equal(f.calls.length,2);assert.equal(f.commits(),0);assert.deepEqual(f.data,before);
  }
});

test('v0.8 upstream failures are classified without exposing provider URLs, keys or raw text', async () => {
  const f=fixture([Error('HTTP 401 https://provider.test/?api_key=sk-private-secret')]);
  await assert.rejects(f.service.generate(ctx,{query:'能力'}),error=>{assert.match(error.message,/未獲授權/);assert.doesNotMatch(error.message,/private|https|provider/);return true;});
  assert.equal(f.calls.length,1);assert.equal(f.commits(),0);
});

test('v0.8 manual catalogue CRUD neither requests models nor purchases, and updates retain manual goods', async () => {
  const f=fixture([json([item({name:'模型水瓶'})])]);
  f.data.wallet={balance:3000};f.data.inventory=['已購物品'];
  const saved=await f.service.save(ctx,item({name:'手動能力',price:'23.45'}));
  assert.equal(saved.source,'manual');assert.equal(f.calls.length,0);assert.equal(f.data.catalogue.length,2);
  await f.service.save(ctx,{...saved,description:'可自行定義效果。',price:'24'});
  assert.equal(f.data.catalogue.find(value=>value.id===saved.id).price,24);
  await f.service.generate(ctx,{query:'水瓶'});
  assert.deepEqual(f.data.catalogue.map(value=>value.name),['手動能力','模型水瓶']);assert.equal(f.data.catalogueSource.manualCount,1);
  await f.service.remove(ctx,{id:saved.id});
  assert.deepEqual(f.data.catalogue.map(value=>value.name),['模型水瓶']);assert.equal(f.data.wallet.balance,3000);assert.deepEqual(f.data.inventory,['已購物品']);
});

test('v0.8 editing generated products pins them as manual and rejects deleted or invalid rows', async () => {
  const f=fixture([]);await f.service.save(ctx,{...f.data.catalogue[0],price:'35'});
  assert.equal(f.data.catalogue[0].source,'manual');
  const before=structuredClone(f.data);
  await assert.rejects(f.service.save(ctx,item({id:'missing'})),/已更新或刪除/);
  await assert.rejects(f.service.save(ctx,item({price:''})),/價格格式錯誤/);
  await assert.rejects(f.service.remove(ctx,{id:'missing'}),/已更新或刪除/);
  assert.deepEqual(f.data,before);
});

test('v0.8 manual catalogue limits fail before mutation and source diagnostics are escaped', async () => {
  const f=fixture([]);f.data.catalogue=Array.from({length:64},(_,i)=>({...item(),id:String(i),source:'manual'}));
  await assert.rejects(f.service.save(ctx,item()),/最多 64 件/);assert.equal(f.data.catalogue.length,64);
  const html=searchMarkup({source:{mode:'manual',manualCount:2,repaired:true,warnings:['<script>bad</script>']}});
  assert.match(html,/手動設定/);assert.match(html,/保留 2 件/);assert.match(html,/格式已修復/);assert.doesNotMatch(html,/<script>/);
});

test('v0.8 accepts only purchase-compatible product names up to 80 characters', async () => {
  const f=fixture([]);
  const saved=await f.service.save(ctx,item({name:'名'.repeat(80)}));
  assert.equal(saved.name.length,80);
  const {purchaseItem}=await import('../core/wallet.js');
  assert.equal(purchaseItem(saved).name,saved.name);
  await assert.rejects(f.service.save(ctx,item({name:'名'.repeat(81)})),/1–80/);
  const parsed=parseShopResponse(json([item({name:'名'.repeat(81)}),item()]));
  assert.equal(parsed.skipped,1);assert.equal(parsed.items.length,1);
});
