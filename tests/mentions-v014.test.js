import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemoryMentionIndex,searchMemoryMentionIndex,searchMemoryMentions,createMemoryMention} from '../pocket/mentions.js';
import {memoryPickerLayout,memoryTrigger} from '../pocket/composer.js';
const sample=()=>({persona:'旅人',profile:{name:'旅人',customFields:[]},items:[{id:'bag',name:'補給箱',description:'長途旅行的補給',quantity:2,source:'萬寶商城'}],abilities:[{id:'light',name:'星光',description:'照明'}]});

test('cached search snapshot performs no saved-state reads while typing and returns stable rows',()=>{
  const s=sample();let reads=0;const items=s.items;Object.defineProperty(s,'items',{get(){reads++;return items;}});
  const index=createMemoryMentionIndex(s),afterBuild=reads;
  for(const q of ['補','補給','補給箱','物品：補給','万宝阁'])assert.equal(searchMemoryMentionIndex(index,q)[0].id,'bag');
  assert.equal(reads,afterBuild);
  assert.equal(searchMemoryMentionIndex(index,'補給')[0],searchMemoryMentionIndex(index,'補給箱')[0]);
  assert.ok(Object.isFrozen(index));assert.ok(Object.isFrozen(index[0].row));
});

test('rebuild follows saved changes; cached selection is still validated at insertion',()=>{
  const s=sample(),oldIndex=createMemoryMentionIndex(s),old=searchMemoryMentionIndex(oldIndex,'補給')[0];
  s.items[0].name='醫療箱';s.items[0].description='新的描述';
  assert.equal(searchMemoryMentionIndex(oldIndex,'補給')[0].title,'補給箱');
  assert.equal(searchMemoryMentions(s,'醫療箱')[0].title,'醫療箱');
  assert.match(createMemoryMention(s,old),/醫療箱/);
  s.items=[];assert.throws(()=>createMemoryMention(s,old),/已變更/);
  s.persona='別人';assert.throws(()=>createMemoryMention(s,old),/已變更/);
});

test('indexed ranking, aliases, category filters and limits preserve the direct search contract',()=>{
  const s=sample();s.items.push({id:'bag2',name:'補給箱附袋',description:'補給箱補充袋',quantity:0});
  const index=createMemoryMentionIndex(s);
  for(const q of ['','補給箱','物品：補給','能力：星光','萬寶閣','論壇','我的資訊'])for(const category of ['all','items','abilities','profile'])assert.deepEqual(searchMemoryMentionIndex(index,q,{category,limit:3}),searchMemoryMentions(s,q,{category,limit:3}));
  assert.deepEqual(searchMemoryMentionIndex(index,'補給箱').map(x=>x.id),['bag','bag2']);
  assert.equal(searchMemoryMentionIndex(index,'',{limit:1}).length,1);
  assert.ok(searchMemoryMentionIndex(index,'',{limit:Infinity}).length>0);
});

test('large saved inventories only expose bounded stable candidate rows',()=>{
  const s=sample();s.items=Array.from({length:5000},(_,i)=>({id:'item_'+i,name:'物品'+i,description:'描述',quantity:i}));
  const index=createMemoryMentionIndex(s);
  assert.equal(searchMemoryMentionIndex(index,'',{category:'items'}).length,60);
  assert.equal(searchMemoryMentionIndex(index,'物品4999')[0].id,'item_4999');
  assert.equal(searchMemoryMentionIndex(index,'物品49').length,60);
});

for(const [name,anchor,viewport]of[
  ['desktop',{left:400,top:700,bottom:760},{left:0,top:0,width:1280,height:900}],
  ['mobile keyboard',{left:12,top:300,bottom:350},{left:0,top:0,width:360,height:360}],
  ['zoomed viewport',{left:220,top:420,bottom:480},{left:200,top:260,width:290,height:280}],
  ['tiny landscape',{left:0,top:50,bottom:90},{left:0,top:0,width:320,height:140}],
  ['offscreen anchor',{left:900,top:800,bottom:850},{left:0,top:0,width:360,height:320}],
])test('picker stays within '+name,()=>{
  for(const mode of ['inline','button']){
    const r=memoryPickerLayout(anchor,viewport,{mode,height:1000});
    assert.ok(r.left>=viewport.left);assert.ok(r.left+r.width<=viewport.left+viewport.width);
    assert.ok(r.top>=viewport.top);assert.ok(r.top+r.maxHeight<=viewport.top+viewport.height);
    assert.ok(r.width>0&&r.maxHeight>0);
  }
});

test('caret trigger clamps bounds and does not activate completed references or multiline prose',()=>{
  assert.deepEqual(memoryTrigger('拿出＠物品',100),{start:2,end:5,query:'物品'});
  assert.equal(memoryTrigger('x@domain.tld',100),null);
  assert.equal(memoryTrigger('@【物品：箱｜旅人｜rbag】',100),null);
  assert.equal(memoryTrigger('@箱\n離開',100),null);
  assert.equal(memoryTrigger('@箱',-1),null);
});
