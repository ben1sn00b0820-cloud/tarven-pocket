import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveState, archiveBookName, recallActivity, exportArchiveWorldbook, mergeArchiveWorldbook} from '../pocket/activity-memory.js';

const forum = {id:'forum:1',app:'forum',action:'post',from:'Alice',title:'旅館見聞',text:'今天到旅館',at:1};
const shop = {id:'shop:1',app:'shop',action:'catalogue',from:'User',itemName:'折疊帳篷',text:'防風防水',amount:100,at:2};

test('quiet archives return explicit counts and at most 100 recent matching records',()=>{
 const rows=Array.from({length:130},(_,i)=>({...shop,id:'shop:'+i,at:i}));rows.push(forum,{id:'wx',app:'wechat',text:'不可出現',at:999});
 const state=archiveState(rows,{scope:'one',user:'User'});assert.equal(state.count,131);assert.equal(state.shop,130);assert.equal(state.forum,1);assert.equal(state.records.length,100);assert.equal(state.records[0].id,'shop:129');
 assert.equal(archiveState(rows,{query:'防風'}).matched,130);assert.equal(archiveState(rows,{query:'旅館'}).records.length,1);
 assert.notEqual(archiveBookName('one','User'),archiveBookName('two','User'));
});

test('recall requires an explicit archive query or a specific saved title and obeys a bounded output budget',()=>{
 const rows=[forum,shop];for(const q of ['', '繼續劇情', '打開商城', '他走進論壇'])assert.equal(recallActivity(rows,q),'');
 assert.match(recallActivity(rows,'旅館見聞發生什麼事'),/今天到旅館/);assert.doesNotMatch(recallActivity(rows,'查論壇歷史'),/折疊帳篷/);
 assert.match(recallActivity(rows,'上次商城價格多少'),/折疊帳篷/);assert.doesNotMatch(recallActivity(rows,'上次商城價格多少'),/今天到旅館/);
 const large=Array.from({length:50},(_,i)=>({...shop,id:'s'+i,text:'x'.repeat(2000),at:i}));const recalled=recallActivity(large,'查商城紀錄',{budget:4500});assert.ok(recalled.length<=4500);assert.match(recalled,/"omitted":4[89]/);
});

test('archive worldbook entries are keyword triggered and preserve all foreign ownership',()=>{
 const fresh=exportArchiveWorldbook([forum,shop],{scope:'A',user:'User'});assert.equal(Object.keys(fresh.entries).length,2);assert.ok(Object.values(fresh.entries).every(e=>!e.constant&&e.excludeRecursion&&e.preventRecursion));
 const old={entries:{'0':{uid:0,content:'foreign',extensions:{tavern_pocket_archive:{owner:'tavern-pocket',scope:'B'}}},'1':{uid:1,content:'old',extensions:{tavern_pocket_archive:{owner:'tavern-pocket',scope:'A'}}}},custom:'preserved',extensions:{custom:'yes'}};
 const merged=mergeArchiveWorldbook(old,fresh,'A');assert.equal(merged.entries['0'].content,'foreign');assert.equal(merged.custom,'preserved');assert.equal(merged.extensions.custom,'yes');assert.equal(Object.keys(merged.entries).length,3);assert.doesNotMatch(JSON.stringify(merged),/"content":"old"/);assert.equal(old.entries['1'].content,'old');
 assert.throws(()=>mergeArchiveWorldbook({entries:null},fresh,'A'),/讀取失敗/);
});

test('explicit topic recall retrieves an older relevant reply ahead of more than 20 unrelated recent posts',()=>{
 const old={id:'old-reply',app:'forum',action:'comment',from:'Alice',title:'週末安排',text:'我們之前約好在河堤碰面。',at:1};
 const recent=Array.from({length:35},(_,i)=>({...forum,id:'recent:'+i,title:'每日近況 '+i,text:'今天去百貨公司吃飯。',at:i+10}));
 const rows=[old,...recent], out=recallActivity(rows,'回憶論壇之前提到河堤的內容');
 assert.match(out,/old-reply/);const data=JSON.parse(out.slice(out.indexOf('\n')+1));assert.equal(data.records[0].id,'old-reply');assert.equal(data.records.length,20);
 assert.equal(recallActivity(rows,'我走到河堤，想起之前的事情。'),'');assert.equal(recallActivity(rows,'回憶之前提到河堤的內容'),'');
});

test('quoted and English subjects rank explicit archive recall without crossing the requested app',()=>{
 const rows=[{...shop,id:'sku:old',itemName:'儲能元件',text:'支援 arc reactor energy storage',at:1},...Array.from({length:25},(_,i)=>({...shop,id:'sku:'+i,text:'一般旅行用品',at:i+2})),{...forum,id:'forum:match',title:'冷核紀錄',text:'arc reactor energy storage',at:999}];
 const out=recallActivity(rows,'回憶商城「arc reactor」的商品');const data=JSON.parse(out.slice(out.indexOf('\n')+1));assert.equal(data.records[0].id,'sku:old');assert.ok(data.records.every(event=>event.app==='shop'));assert.equal(recallActivity(rows,'arc reactor 應該很實用'),'');
 const plain=recallActivity(rows,'查商城之前 arc reactor 的價格');assert.match(plain,/sku:old/);
});
