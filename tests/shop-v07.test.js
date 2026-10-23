import test from 'node:test';
import assert from 'node:assert/strict';
import {parseShopItems} from '../pocket/shop.js';
import {purchaseItem, normalizeWallet, defaultWallet} from '../core/wallet.js';

const item=(name,fields={})=>({name,description:'故事中的取得效果。',price:25,emoji:'✨',...fields});

test('catalogue types distinguish direct abilities and preserve explicit physical skill books',()=>{
 let index=0;
 const values=parseShopItems(JSON.stringify({items:[item('飛行',{kind:'abilities'}),item('魔術手冊',{kind:'items'}),item('心靈感應',{type:'abilities'}),item('火焰異能'),item('王城資格'),item('特殊技能',{kind:'invalid'})]}),{id:()=>`kind-${++index}`});
 assert.deepEqual(values.map(x=>x.kind),['abilities','items','abilities','abilities','items','abilities']);
 for(const value of values)assert.equal(purchaseItem(value).kind,value.kind);
 const wallet=normalizeWallet({...defaultWallet(),inventory:values.map(value=>({...value,orderId:`order-${value.id}`,at:10}))});
 assert.deepEqual(wallet.inventory.map(x=>x.kind),values.map(x=>x.kind));
});

test('legacy purchases keep exact fingerprint and normalized inventory without adding a kind field',()=>{
 const old={id:'old',name:'古書',price:12.5,description:'舊版買入',emoji:'📖'};
 const fingerprint='{"id":"old","name":"古書","price":12.5,"description":"舊版買入","emoji":"📖"}';
 assert.equal(JSON.stringify(purchaseItem(old)),fingerprint);
 assert.equal(JSON.stringify(purchaseItem({...old,kind:'unknown'})),fingerprint);
 const wallet=normalizeWallet({...defaultWallet(),inventory:[{...old,orderId:'original',at:1}],journal:[{id:'purchase:original',flow:'purchase',status:'done',fingerprint,amount:-12.5}]});
 assert.equal(Object.hasOwn(wallet.inventory[0],'kind'),false);assert.equal(wallet.journal[0].fingerprint,fingerprint);
 assert.equal(JSON.stringify(purchaseItem(wallet.inventory[0])),fingerprint);
});


test('purchase ownership survives wallet normalization without altering legacy fingerprints',()=>{
 const base={id:'ability',name:'飛行',description:'可在故事中飛行。',price:20,emoji:'✨',kind:'abilities'};
 const owned=purchaseItem({...base,memoryOwner:'使用者甲'});assert.equal(owned.memoryOwner,'使用者甲');
 const wallet=normalizeWallet({...defaultWallet(),inventory:[{...owned,orderId:'owner-order',at:123}]});assert.equal(wallet.inventory[0].memoryOwner,'使用者甲');assert.equal(wallet.inventory[0].kind,'abilities');
 for(const memoryOwner of [undefined,'','   ',123,'名'.repeat(81)])assert.equal(Object.hasOwn(purchaseItem({...base,memoryOwner}),'memoryOwner'),false);
 assert.equal(JSON.stringify(purchaseItem({...base,memoryOwner:undefined})),JSON.stringify(purchaseItem(base)));
});
