import test from 'node:test';
import assert from 'node:assert/strict';
import {createShopService, normalizeShopRequest, shopInstruction} from '../pocket/shop.js';
import {SHOP_CATEGORIES, searchMarkup} from '../pocket/shop-ui.js';

// The same catalogue and purchase representation handles people/rights as
// fictional inventory descriptions; none of these queries executes a purchase.
test('Wanbao query retains requested fictional people, qualifications, weapons and everyday goods', async () => {
 const items = [
  {name:'旅行牙刷',description:'日常清潔用品。',price:12.5,emoji:'🪥'},
  {name:'NPC 林雨',description:'善於情報整理的虛構人物，購入後作為新角色加入故事。',price:1500,emoji:'👤'},
  {name:'王城通行資格',description:'劇情內獲得進出王城的資格。',price:800,emoji:'🎫'},
  {name:'虛構制式手槍',description:'用於故事場景的武器裝備。',price:600,emoji:'⚙️'},
  {name:'禁用傳送石',description:'世界觀中的違禁物，可在劇情內傳送。',price:900,emoji:'💎'},
 ];
 const data={catalogue:[],wallet:{balance:5000},inventory:[]};let prompt;
 const service=createShopService({backend:{generateText:async(c,request)=>{prompt=request.prompt;return JSON.stringify({items});}},taskPrompt:(c,value)=>value,check:()=>{},edit:async(c,write)=>write(data)});
 const response=await service.generate({name1:'使用者甲',name2:'角色'},{query:'牙刷、人物、資格、手槍與違禁物'});
 assert.deepEqual(response.items.map(x=>x.name),items.map(x=>x.name));
 assert.equal(data.catalogueSource.owner,'使用者甲');assert.equal(data.catalogueSource.exclusive,true);assert.equal(data.catalogueSource.shop,'wanbao');
 assert.equal(data.wallet.balance,5000);assert.deepEqual(data.inventory,[]);
 assert.match(prompt,/只有使用者擁有進入、查詢與購買權限/);assert.match(prompt,/不得因當前世界缺少/);assert.match(prompt,/不提供現實採購與交易管道/);
});

test('all Wanbao category queries use existing valid query route and inclusive categories',()=>{
 assert.deepEqual(SHOP_CATEGORIES.map(x=>x.label),['生活用品','人物／NPC','資格與能力','槍支與武器','特殊物件']);
 for(const category of SHOP_CATEGORIES){assert.equal(normalizeShopRequest({query:category.query}).mode,'query');assert.match(shopInstruction({query:category.query}),/萬寶商城/);}
 const html=searchMarkup();assert.match(html,/萬寶商城查詢/);assert.match(html,/你的專屬商城/);assert.doesNotMatch(html,/劇情商城/);
});
