import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createPocketHost} from '../pocket/host.js';
import {createMemoryMention, searchMemoryMentions} from '../pocket/mentions.js';

const KEY='tavern_pocket_v3';
const event=value=>`<phone>${JSON.stringify(value)}</phone>`;
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

function fixture(){
 const nativeCalls=[],profileCalls=[],saves=[],emitted=[];
 const settings={disabledExtensions:[],connectionManager:{selectedProfile:'main',profiles:[{id:'main',name:'Main',api:'openai',model:'main-model'},{id:'phone',name:'Phone',api:'openai',model:'phone-model'}]}};
 const books={Cafe:{entries:{0:{content:'CAFE_LORE {{char}} meets {{user}}',comment:'Cafe'},1:{content:'HIDDEN_LORE',disable:true}}},Racing:{entries:{0:{content:'RACING_LORE'}}}};
 let current;
 const makeContext=(id='chat-A')=>{
  const c={chatId:id,characterId:0,groupId:null,name1:'User',name2:'Alice',characters:[{name:'Alice',avatar:'alice.png',description:'CHARACTER_CONTEXT'}],chat:[{name:'Alice',mes:'RECENT_PLOT',is_user:false}],chatMetadata:{},extensionSettings:settings,
   getCurrentChatId:()=>c.chatId,getWorldInfoNames:()=>Object.keys(books),loadWorldInfo:async name=>structuredClone(books[name]),
   substituteParams:text=>text.replaceAll('{{char}}',c.name2).replaceAll('{{user}}',c.name1),
   saveMetadata:async()=>{saves.push({id:c.chatId,data:structuredClone(c.chatMetadata)});},saveSettingsDebounced:()=>{},
   CONNECT_API_MAP:{openai:{selected:'openai',source:'openai'}},
   ConnectionManagerRequestService:{sendRequest:async(...args)=>{profileCalls.push(args);return {content:'profile reply'};}}};
  return c;
 };
 current=makeContext();
 const backend={settings:{text:{source:'custom'},chat:{}},wallet:()=>({balance:520,inventory:[{name:'INVENTORY_SENTINEL',description:'Owned story object'}]}),library:{getPhoto:async id=>id==='photo-real'?{id,blob:new Blob(['image bytes'],{type:'image/png'})}:null},spaceKey:()=>'',threads:async()=>[],chats:{list:async()=>[],reconcileSource:async()=>({threads:0,imported:0,removed:0})},
  emit:(...args)=>emitted.push(args),generateText:async(c,request)=>{nativeCalls.push({c,request});return backend.nativeResponder?backend.nativeResponder(c,request):'native custom reply';}};
 const original=backend.generateText;
 const host=createPocketHost({context:()=>current,backend});
 return {host,api:host.api(),backend,settings,books,nativeCalls,profileCalls,saves,emitted,original,get c(){return current;},switchChat(id='chat-B'){current=makeContext(id);return current;}};
}

test('composer reference resolves current saved facts before the draft joins chat, without spending',async()=>{
 const f=fixture();
 try{
  let state=await f.api.pocketMemoryAction('entry.save',{kind:'abilities',entry:{name:'時間停止',description:'舊效果',quantity:1}});
  const row=searchMemoryMentions(state,'時間停止')[0],token=createMemoryMention(state,row);
  const id=state.abilities[0].id;
  state=await f.api.pocketMemoryAction('entry.save',{kind:'abilities',entry:{id,name:'時間暫停',description:'LATEST_EFFECT_只停止三秒',quantity:1}});
  const plan=f.host.promptPlan({query:'我使用 '+token+' 救人。'}),refs=plan.find(p=>p.key==='sttts.entry.references');
  assert.match(refs.text,/LATEST_EFFECT_只停止三秒/);assert.match(refs.text,/時間暫停/);assert.doesNotMatch(refs.text,/舊效果/);
  assert.equal(f.c.chat.some(m=>m.mes.includes(token)),false);assert.equal(f.nativeCalls.length,0);
  f.c.chat.push({name:'User',is_user:true,mes:'我使用 '+token+'。'+('場景細節'.repeat(2300))});
  assert.match(f.host.promptPlan().find(p=>p.key==='sttts.entry.references').text,/LATEST_EFFECT_只停止三秒/);
  await f.backend.generateText(f.c,{prompt:'接續微信',responseLength:1200});
  assert.match(JSON.stringify(f.nativeCalls[0].request.prompt),/LATEST_EFFECT_只停止三秒/);
  await f.api.pocketMemoryAction('entry.delete',{kind:'abilities',id});
  const missing=f.host.promptPlan().find(p=>p.key==='sttts.entry.references').text;
  assert.match(missing,/已刪除|尚未記錄/);assert.doesNotMatch(missing,/LATEST_EFFECT/);
  f.c.name1='Other';
  const other=f.host.promptPlan().find(p=>p.key==='sttts.entry.references').text;
  assert.match(other,/其他使用者/);assert.doesNotMatch(other,/LATEST_EFFECT/);
 }finally{f.host.dispose();}
});

test('reference prompt remains available when phone protocol is disabled and policy changes preserve defaults',async()=>{
 const f=fixture();
 try{
  await f.api.pocketMemoryAction('profile.save',{age:'28',appearance:'PROFILE_LATEST'});
  await f.api.pocketAction('settings.save',{worldbooks:[],inject:false,mirrorForum:false,mirrorShop:false});
  let plan=f.host.promptPlan({query:'@我 今天出門。'});
  assert(plan.some(p=>p.key==='sttts.entry.references'&&p.text.includes('PROFILE_LATEST')));
  assert(!plan.some(p=>p.key==='sttts.entry.pocket'));
  const state=await f.api.pocketAction('settings.save',{worldbooks:['Cafe'],inject:false});
  assert.equal(state.settings.mirrorForum,false);assert.equal(state.settings.mirrorShop,false);
 }finally{f.host.dispose();}
});

test('shop preset CRUD persists selection, reaches the request, and failed save rolls back',async()=>{
 const f=fixture();
 try{
  const saved=await f.api.pocketAction('shopPreset.save',{name:'生活小物',prompt:'SHOP_CUSTOM_STYLE_只列生活用品'});
  assert.equal(saved.selectedId,saved.savedId);assert.equal(f.nativeCalls.length,0);
  f.backend.nativeResponder=()=>JSON.stringify({items:[{name:'雨傘',description:'遮雨',price:25}]});
  const state=await f.api.pocketAction('shop.generate',{mode:'query',query:'雨傘'});
  assert.equal(state.catalogueSource.presetId,saved.savedId);
  assert.match(JSON.stringify(f.nativeCalls[0].request.prompt),/SHOP_CUSTOM_STYLE/);
  const before=structuredClone(f.settings[KEY].shopPresets),persist=f.c.saveSettingsDebounced;
  f.c.saveSettingsDebounced=()=>{throw Error('settings storage failed');};
  await assert.rejects(f.api.pocketAction('shopPreset.save',{name:'失敗預設',prompt:'不得保存'}),/storage failed/);
  assert.deepEqual(f.settings[KEY].shopPresets,before);f.c.saveSettingsDebounced=persist;
  const exported=await f.api.pocketAction('shopPreset.export',{id:saved.savedId});
  assert.equal(JSON.parse(exported.json).presets.length,1);
  await f.api.pocketAction('shopPreset.import',{text:exported.json});
  assert.equal((await f.api.pocketState()).shopPresets.presets.filter(p=>!p.builtin).length,2);
  await f.api.pocketAction('shopPreset.delete',{id:saved.savedId});
  await assert.rejects(f.api.pocketAction('shop.generate',{mode:'query',query:'雨傘',presetId:saved.savedId}),/已不存在/);
 }finally{f.host.dispose();}
});

test('worldbook settings admit nine books, browse without generation, and keep pins scoped to chat',async()=>{
 const f=fixture();
 try{
  for(let i=0;i<9;i++)f.books['Book'+i]={entries:{late:{content:'第'+i+'冊世界內容',comment:'世界資料'}}};
  const names=Object.keys(f.books).filter(name=>name.startsWith('Book'));
  let state=await f.api.pocketAction('settings.save',{worldbooks:names,worldbookBudget:24000,worldbookPins:[{book:'Book8',entryId:'late'}]});
  assert.equal(state.settings.worldbooks.length,9);assert.equal(state.settings.worldbookPins.length,1);
  const found=await f.api.pocketAction('worldbooks.search',{query:'世界資料',limit:3});
  assert.equal(found.total,9);assert.equal(found.entries.length,3);assert.equal(found.nextOffset,3);
  const detail=await f.api.pocketAction('worldbooks.read',{book:'Book8',entryId:'late'});
  assert.match(detail.content,/第8冊世界內容/);assert.equal(f.nativeCalls.length,0);
  await assert.rejects(f.api.pocketAction('settings.save',{worldbooks:names,worldbookBudget:0}),/預算/);
  state=await f.api.pocketState();assert.equal(state.settings.worldbookBudget,24000);
  f.switchChat();state=await f.api.pocketState();assert.deepEqual(state.settings.worldbooks,[]);assert.deepEqual(state.settings.worldbookPins,[]);
 }finally{f.host.dispose();}
});

test('shop keeps valid partial output, archives quietly and recalls only on request',async()=>{
 const f=fixture();
 try{
  await f.host.sync();const before=f.c.chat.length;
  f.backend.nativeResponder=()=> '以下是商品：```json\n'+JSON.stringify({items:[{name:'時間凍結能力',description:'UNBOUGHT_CATALOGUE_FACT',price:'¥ 19.50',kind:'abilities'},{name:'缺價格',description:'不能猜價'}]})+'\n```';
  const state=await f.api.pocketAction('shop.generate',{mode:'query',query:'時間凍結能力'});
  assert.equal(state.catalogue.length,1);assert.equal(state.catalogue[0].price,19.5);
  assert.equal(state.catalogueSource.skipped,1);assert.equal(f.c.chat.length,before);
  assert.equal(f.api.pocketArchiveState().shop,1);
  assert.doesNotMatch(JSON.stringify(f.host.promptPlan()),/UNBOUGHT_CATALOGUE_FACT/);
  f.c.chat.push({name:'User',is_user:true,mes:'回憶萬寶商城的時間凍結能力，售價是多少？'});
  const recall=f.host.promptPlan().find(p=>p.key==='sttts.entry.archive');
  assert.match(recall.text,/UNBOUGHT_CATALOGUE_FACT/);assert.match(recall.text,/不等於已購買/);
  await f.api.pocketAction('settings.save',{worldbooks:[],inject:false});
  assert(f.host.promptPlan().some(p=>p.key==='sttts.entry.archive'));
  f.switchChat();assert.equal(f.api.pocketArchiveState().count,0);
 }finally{f.host.dispose();}
});

test('manual catalogue survives regeneration and deletion only removes the listing',async()=>{
 const f=fixture();
 try{
  await f.host.sync();const before=f.c.chat.length;
  let state=await f.api.pocketAction('shop.save',{name:'星光雨傘',description:'手動收藏商品',price:'88.50',kind:'items'});
  const id=state.catalogue[0].id;assert.equal(f.nativeCalls.length,0);
  f.backend.nativeResponder=()=>JSON.stringify({items:[{name:'瓶裝水',description:'補充水分',price:3}]});
  state=await f.api.pocketAction('shop.generate',{mode:'story'});
  assert(state.catalogue.some(item=>item.id===id&&item.source==='manual'));
  state=await f.api.pocketAction('shop.delete',{id});
  assert(!state.catalogue.some(item=>item.id===id));assert.equal(f.c.chat.length,before);
  assert(f.api.pocketArchiveState('星光雨傘').records.some(row=>row.itemName==='星光雨傘'));
  const book=await f.api.pocketArchiveAction('worldbook.export');
  assert(Object.values(book.entries).every(entry=>entry.constant===false));
  assert.equal(f.nativeCalls.length,1);
 }finally{f.host.dispose();}
});

test('shop repair excludes unrelated character, phone, personal and worldbook context',async()=>{
 const f=fixture();
 try{
  await f.api.pocketAction('settings.save',{profileId:'phone',worldbooks:['Cafe'],inject:true});
  await f.backend.generateText(f.c,{prompt:'REPAIR_ONLY',pocketTask:'shop-repair',responseLength:3600});
  const [id,messages,tokens]=f.profileCalls[0];assert.equal(id,'phone');assert.equal(tokens,3600);
  const sent=JSON.stringify(messages);assert.match(sent,/REPAIR_ONLY/);
  assert.doesNotMatch(sent,/CAFE_LORE|CHARACTER_CONTEXT|RECENT_PLOT|INVENTORY_SENTINEL/);
 }finally{f.host.dispose();}
});

test('native phone model remains in control and receives chosen enabled lore without private diaries',async()=>{
 const f=fixture();
 try{
  await f.api.pocketAction('diary.save',{title:'My secret',text:'PRIVATE_DIARY_SENTINEL'});
  await f.api.pocketAction('settings.save',{profileId:'',worldbooks:['Cafe'],inject:true});
  const request={prompt:[{role:'system',content:'NATIVE_SYSTEM'},{role:'user',content:'PHONE_TASK'}],responseLength:900,customFlag:'preserve'};
  assert.equal(await f.backend.generateText(f.c,request),'native custom reply');
  assert.equal(f.nativeCalls.length,1);assert.equal(f.profileCalls.length,0);
  const sent=f.nativeCalls[0].request;
  assert.equal(sent.responseLength,900);assert.equal(sent.customFlag,'preserve');
  assert.deepEqual(sent.prompt.slice(2),request.prompt);
  assert.equal(sent.prompt[1].role,'system');
  assert.match(sent.prompt[1].content,/繁體中文/);
  assert.match(sent.prompt[1].content,/繪圖英文提示詞/);
  assert.match(sent.prompt[0].content,/CAFE_LORE Alice meets User/);
  assert.match(sent.prompt[0].content,/索引.*本次任務檢索/);
  assert.doesNotMatch(JSON.stringify(sent),/PRIVATE_DIARY_SENTINEL|HIDDEN_LORE/);
  assert.equal(f.settings.connectionManager.selectedProfile,'main');
  assert.equal(f.backend.settings.text.source,'custom');
 }finally{f.host.dispose();}
});

test('saved profile overrides all phone text calls without switching main model or leaking private diary',async()=>{
 const f=fixture();
 try{
  await f.api.pocketAction('diary.save',{text:'PRIVATE_DIARY_SENTINEL'});
  await f.api.pocketAction('settings.save',{profileId:'phone',worldbooks:['Cafe'],inject:true});
  assert.equal(await f.backend.generateText(f.c,{prompt:[{role:'system',content:'GROUP_TASK'},{role:'user',content:'reply'}],responseLength:1100}),'profile reply');
  assert.equal(f.nativeCalls.length,0);assert.equal(f.profileCalls.length,1);
  const [id,messages,tokens,options]=f.profileCalls[0];
  assert.equal(id,'phone');assert.equal(tokens,1100);
  assert.deepEqual(options,{stream:false,extractData:true,includePreset:true,includeInstruct:true});
  const serialized=JSON.stringify(messages);
  for(const text of ['CAFE_LORE Alice meets User','CHARACTER_CONTEXT','RECENT_PLOT','GROUP_TASK'])assert.ok(serialized.includes(text),text);
  assert.doesNotMatch(serialized,/PRIVATE_DIARY_SENTINEL|HIDDEN_LORE/);
  assert.equal(f.settings.connectionManager.selectedProfile,'main');
 }finally{f.host.dispose();}
});

test('chat change while loading lore prevents either model from dispatching',async()=>{
 for(const profileId of ['', 'phone']){
  const f=fixture(),gate=deferred(),started=deferred();
  try{
   await f.api.pocketAction('settings.save',{profileId,worldbooks:['Cafe']});
   f.c.loadWorldInfo=async()=>{started.resolve();return gate.promise;};
   const pending=f.backend.generateText(f.c,{prompt:'hello'});
   await started.promise;f.switchChat();gate.resolve(f.books.Cafe);
   await assert.rejects(pending,/對話已切換/);
   assert.equal(f.nativeCalls.length+f.profileCalls.length,0);
  }finally{f.host.dispose();}
 }
});

test('chat change during profile completion discards generated entries',async()=>{
 const f=fixture(),gate=deferred(),started=deferred(),old=f.c;
 try{
  await f.api.pocketAction('settings.save',{profileId:'phone',worldbooks:[]});
  old.ConnectionManagerRequestService.sendRequest=async()=>{started.resolve();return gate.promise;};
  const pending=f.api.pocketAction('ig.generate',{});
  await started.promise;f.switchChat();gate.resolve({content:event({id:'generated',app:'instagram',action:'post',from:'Alice',text:'stale'})});
  await assert.rejects(pending,/對話已切換/);
  assert.equal(old.chatMetadata[KEY].events.length,0);
  assert.equal((await f.api.pocketState()).instagram.posts.length,0);
 }finally{f.host.dispose();}
});

test('native custom model completion is also rejected after the chat switches',async()=>{
 const f=fixture(),gate=deferred(),started=deferred();
 try{
  f.backend.nativeResponder=async()=>{started.resolve();return gate.promise;};
  const pending=f.backend.generateText(f.c,{prompt:'Native reply'});
  await started.promise;f.switchChat();gate.resolve('old answer');
  await assert.rejects(pending,/對話已切換/);
  assert.equal(f.nativeCalls.length,1);
 }finally{f.host.dispose();}
});

test('actions queued in previous chat cannot run in newly selected chat',async()=>{
 const f=fixture(),gate=deferred(),started=deferred(),old=f.c;
 try{
  old.saveMetadata=async()=>{started.resolve();return gate.promise;};
  const first=f.api.pocketAction('ig.post',{text:'first'});
  const queued=f.api.pocketAction('ig.post',{text:'second'});
  const firstCheck=assert.rejects(first,/對話已切換/),queuedCheck=assert.rejects(queued,/對話已切換/);
  await started.promise;f.switchChat();gate.resolve();
  await Promise.all([firstCheck,queuedCheck]);
  assert.equal((await f.api.pocketState()).instagram.posts.length,0);
  assert.equal(old.chatMetadata[KEY].events.length,0);
 }finally{f.host.dispose();}
});

test('Instagram posts, toggled likes, comments and directed DMs persist in chat metadata',async()=>{
 const f=fixture();
 try{
  let state=await f.api.pocketAction('ig.post',{text:'A cafe photo caption'});
  const id=state.instagram.posts[0].id;
  state=await f.api.pocketAction('ig.like',{id});assert.deepEqual(state.instagram.posts[0].likes,['User']);
  state=await f.api.pocketAction('ig.like',{id});assert.deepEqual(state.instagram.posts[0].likes,[]);
  state=await f.api.pocketAction('ig.comment',{id,text:'Nice afternoon'});assert.equal(state.instagram.posts[0].comments[0].text,'Nice afternoon');
  state=await f.api.pocketAction('ig.dm',{to:'Alice',text:'Meet me here'});assert.deepEqual(state.instagram.dms.map(({from,to,text})=>({from,to,text})),[{from:'User',to:'Alice',text:'Meet me here'}]);
  assert.equal(f.c.chatMetadata[KEY].events.length,5);assert.equal(f.c.chat.filter(m=>m.extra?.tavern_pocket_activity).length,1);assert.equal(f.c.chat.at(-1).extra.tavern_pocket_activity.ids.length,5);
  f.host.dispose();const restored=createPocketHost({context:()=>f.c,backend:f.backend});
  try{assert.deepEqual((await restored.api().pocketState()).instagram,state.instagram);}finally{restored.dispose();}
 }finally{f.host.dispose();}
});

test('private diary can be updated and deleted, while failed metadata write rolls back',async()=>{
 const f=fixture();
 try{
  let state=await f.api.pocketAction('diary.save',{title:'Evening',text:'Secret thought'});const id=state.diaries[0].id;
  assert.equal(state.diaries[0].private,true);assert.equal(state.diaries[0].from,'User');
  state=await f.api.pocketAction('diary.save',{id,title:'Night',text:'Updated secret'});
  assert.equal(state.diaries.length,1);assert.equal(state.diaries[0].text,'Updated secret');
  const goodSave=f.c.saveMetadata;f.c.saveMetadata=async()=>{throw Error('disk full');};
  await assert.rejects(f.api.pocketAction('diary.save',{id,text:'must roll back'}),/disk full/);
  assert.equal((await f.api.pocketState()).diaries[0].text,'Updated secret');
  f.c.saveMetadata=goodSave;state=await f.api.pocketAction('diary.delete',{id});assert.equal(state.diaries.length,0);
 }finally{f.host.dispose();}
});

test('model Instagram and diary events are validated and never impersonate user',async()=>{
 const f=fixture();
 try{
  await f.api.pocketAction('settings.save',{profileId:'phone',worldbooks:[]});
  let response=event({id:'ig-generated',app:'instagram',action:'post',from:'{{char}}',text:'On my way'});
  f.c.ConnectionManagerRequestService.sendRequest=async()=>({content:response});
  let state=await f.api.pocketAction('ig.generate',{});assert.equal(state.instagram.posts[0].from,'Alice');
  response=event({id:'diary-generated',app:'diary',action:'entry',from:'Alice',title:'Afternoon',text:'We met again.'});
  state=await f.api.pocketAction('diary.generate',{});assert.equal(state.diaries[0].private,false);
  response=event({id:'impersonation',app:'instagram',action:'post',from:'User',text:'AI should not post as me'});
  await assert.rejects(f.api.pocketAction('ig.generate',{}),/未回傳符合/);
  assert.equal((await f.api.pocketState()).instagram.posts.length,1);
 }finally{f.host.dispose();}
});

test('generated private-message reply targets selected recipient with shared phone context and no private diary',async()=>{
 const f=fixture(),calls=[];
 try{
  await f.api.pocketAction('diary.save',{text:'PRIVATE_DIARY_SENTINEL'});
  await f.api.pocketAction('ig.dm',{to:'Bob',text:'BOB_ONLY_SENTINEL'});
  await f.api.pocketAction('ig.dm',{to:'Alice',text:'ALICE_MESSAGE'});
  await f.api.pocketAction('settings.save',{profileId:'phone',worldbooks:[]});
  f.c.ConnectionManagerRequestService.sendRequest=async(id,messages)=>{calls.push(messages);return {content:event({id:'reply',app:'instagram',action:'dm',from:'Alice',to:'User',text:'I will be there'})};};
  const state=await f.api.pocketAction('ig.reply',{to:'Alice'});
  assert.equal(state.instagram.dms.at(-1).text,'I will be there');
  const sent=JSON.stringify(calls);assert.match(sent,/ALICE_MESSAGE/);assert.match(sent,/BOB_ONLY_SENTINEL/);assert.doesNotMatch(sent,/PRIVATE_DIARY_SENTINEL/);
 }finally{f.host.dispose();}
});

test('invalid model merchandise retains previous catalogue and successful generation does not purchase',async()=>{
 const f=fixture();
 try{
  await f.api.pocketAction('settings.save',{profileId:'phone',worldbooks:['Cafe']});
  let response=JSON.stringify({items:[{name:'Cafe mug',description:'The cup Alice chose.',price:12.34,emoji:'☕'}]});
  f.c.ConnectionManagerRequestService.sendRequest=async()=>({content:response});
  const state=await f.api.pocketAction('shop.generate',{});assert.equal(state.catalogue[0].price,12.34);
  assert.equal(f.c.chatMetadata[KEY].events.length,0);
  response=JSON.stringify({items:[{name:'Bad price',description:'Invalid precision',price:1.234}]});
  await assert.rejects(f.api.pocketAction('shop.generate',{}),/價格格式錯誤/);
  assert.deepEqual((await f.api.pocketState()).catalogue,state.catalogue);
 }finally{f.host.dispose();}
});

test('invalid model or worldbook selection leaves existing settings intact',async()=>{
 const f=fixture();
 try{
  await f.api.pocketAction('settings.save',{profileId:'phone',worldbooks:['Cafe'],inject:false});
  await assert.rejects(f.api.pocketAction('settings.save',{profileId:'missing',worldbooks:['Racing']}),/找不到/);
  await assert.rejects(f.api.pocketAction('settings.save',{profileId:'main',worldbooks:['missing']}),/有效世界書/);
  const state=await f.api.pocketState();assert.equal(state.settings.profileId,'phone');assert.deepEqual(state.settings.worldbooks,['Cafe']);assert.equal(state.settings.inject,false);
  assert.ok(f.host.promptPlan().every(p=>p.key==='sttts.entry.memory'));assert.doesNotMatch(f.host.promptPlan().map(p=>p.text).join(''),/PUBLIC_INSTAGRAM_SENTINEL/);
 }finally{f.host.dispose();}
});

test('narrative Instagram and diary projections resync edits and deletion without duplicating local entries',async()=>{
 const f=fixture();
 try{
  const first={id:'plot-post',app:'instagram',action:'post',from:'Alice',text:'From the story'};
  f.c.chat.push({name:'Alice',is_user:false,mes:event([first,{id:'plot-comment',app:'instagram',action:'comment',from:'Bob',ref:'plot-post',text:'Looking good'},{id:'plot-like',app:'instagram',action:'like',from:'Bob',ref:'plot-post'},{id:'plot-diary',app:'diary',action:'entry',from:'Alice',title:'Afternoon',text:'Character thoughts'}]),send_date:1700000000000});
  await f.host.sync();let state=await f.api.pocketState();
  assert.equal(state.instagram.posts.length,1);assert.equal(state.instagram.posts[0].at,1700000000000);
  assert.deepEqual(state.instagram.posts[0].likes,['Bob']);assert.equal(state.instagram.posts[0].comments[0].text,'Looking good');
  assert.equal(state.diaries[0].private,false);
  await f.api.pocketAction('ig.post',{text:'Local entry'});
  await f.host.sync();state=await f.api.pocketState();assert.equal(state.instagram.posts.length,2);
  f.c.chat[1].mes=event({...first,text:'Edited story post'});
  await f.host.sync();state=await f.api.pocketState();
  assert.equal(state.instagram.posts.find(p=>p.id==='plot-post').text,'Edited story post');assert.equal(state.diaries.length,0);
  f.c.chat.splice(1,1);await f.host.sync();state=await f.api.pocketState();
  assert.equal(state.instagram.posts.length,1);assert.equal(state.instagram.posts[0].text,'Local entry');
  f.switchChat();assert.equal((await f.api.pocketState()).instagram.posts.length,0);
 }finally{f.host.dispose();}
});

test('preset installer updates old regex in place, preserves other scripts and saves bundled worldbook',async()=>{
 const f=fixture(),originalFetch=globalThis.fetch,worldbookSaves=[];
 try{
  const oldId='9b30c203-7f7c-4d94-98f7-bd3b4e87d71f';
  f.settings.regex=[{id:oldId,scriptName:'Old Tavern Pocket'},{id:'unrelated',scriptName:'User custom script',findRegex:'/unchanged/'}];
  f.c.saveWorldInfo=async(...args)=>{worldbookSaves.push(args);};
  globalThis.fetch=async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))});
  await f.api.pocketAction('presets.install');
  assert.equal(worldbookSaves.length,1);assert.equal(worldbookSaves[0][0],'Tavern Pocket 手機協定 v0.9.0');assert.equal(worldbookSaves[0][2],true);
  assert.match(JSON.stringify(worldbookSaves[0][1]),/group_message/);
  assert.equal(f.settings.regex.length,2);assert.equal(f.settings.regex.find(r=>r.id==='unrelated').findRegex,'/unchanged/');
  const installed=f.settings.regex.find(r=>r.id===oldId);assert.match(installed.scriptName,/v0\.9\.0/);assert.equal(installed.markdownOnly,true);assert.equal(installed.promptOnly,false);
  await f.api.pocketAction('presets.install');assert.equal(f.settings.regex.filter(r=>r.id===oldId).length,1);
 }finally{globalThis.fetch=originalFetch;f.host.dispose();}
});

test('Instagram photo-only post and DM preserve valid local photo reference and reject nonexistent photos',async()=>{
 const f=fixture();
 try{
  let state=await f.api.pocketAction('ig.post',{photoId:'photo-real'});
  assert.equal(state.instagram.posts[0].photoId,'photo-real');assert.equal(state.instagram.posts[0].text,'');
  state=await f.api.pocketAction('ig.dm',{photoId:'photo-real',to:'Alice'});
  assert.equal(state.instagram.dms[0].photoId,'photo-real');assert.equal(state.instagram.dms[0].text,'');
  const before=structuredClone(f.c.chatMetadata[KEY]),saveCount=f.saves.length;
  await assert.rejects(f.api.pocketAction('ig.post',{photoId:'missing',text:'Should not save'}),/找不到這張相片/);
  await assert.rejects(f.api.pocketAction('ig.dm',{photoId:'missing',to:'Alice'}),/找不到這張相片/);
  assert.deepEqual(f.c.chatMetadata[KEY],before);assert.equal(f.saves.length,saveCount);
 }finally{f.host.dispose();}
});

test('main story prompt includes public phone state and inventory while excluding private diary',async()=>{
 const f=fixture();
 try{
  await f.api.pocketAction('diary.save',{title:'PRIVATE_TITLE_SENTINEL',text:'PRIVATE_DIARY_SENTINEL'});
  await f.api.pocketAction('ig.post',{text:'PUBLIC_INSTAGRAM_SENTINEL'});
  await f.host.sync();const plan=f.host.promptPlan(),text=plan.map(p=>p.text).join('\n');assert.equal(plan.length,2);
  assert.match(text,/PUBLIC_INSTAGRAM_SENTINEL/);assert.match(text,/INVENTORY_SENTINEL/);
  assert.doesNotMatch(text,/PRIVATE_DIARY_SENTINEL|PRIVATE_TITLE_SENTINEL/);
 }finally{f.host.dispose();}
});


test('private diary sharing requires explicit setting and can be disabled again',async()=>{
 const f=fixture();try{
  await f.api.pocketAction('diary.save',{text:'PRIVATE_OPTIN_CONTENT'});
  assert.doesNotMatch(f.host.promptPlan().map(p=>p.text).join('\n'),/PRIVATE_OPTIN_CONTENT/);
  await f.api.pocketAction('settings.save',{worldbooks:[],sharePrivateDiary:true});
  assert.match(f.host.promptPlan().map(p=>p.text).join('\n'),/PRIVATE_OPTIN_CONTENT/);
  await f.backend.generateText(f.c,{prompt:'shared reader'});
  assert.match(JSON.stringify(f.nativeCalls.at(-1).request),/PRIVATE_OPTIN_CONTENT/);
  await f.api.pocketAction('settings.save',{worldbooks:[],sharePrivateDiary:false});
  assert.doesNotMatch(f.host.promptPlan().map(p=>p.text).join('\n'),/PRIVATE_OPTIN_CONTENT/);
 }finally{f.host.dispose();}
});


test('personal memory crosses chats and remains in model context when phone protocol is disabled',async()=>{
 const f=fixture();try{
  await f.host.sync();let m=await f.api.pocketMemoryState();
  await f.api.pocketMemoryAction('profile.save',{revision:m.revision,profile:{...m.profile,age:'成年',body:'我的明確外觀'}});
  m=await f.api.pocketMemoryState();await f.api.pocketMemoryAction('entry.save',{kind:'abilities',revision:m.revision,name:'時間停止能力',description:'停止場景內時間，由我解除。'});
  await f.api.pocketAction('settings.save',{worldbooks:[],inject:false});f.switchChat();await f.host.sync();
  assert.equal((await f.api.pocketMemoryState()).abilities[0].name,'時間停止能力');
  assert.match(f.host.promptPlan().map(p=>p.text).join(''),/停止場景內時間/);
  await f.backend.generateText(f.c,{prompt:'調出我的能力'});assert.match(JSON.stringify(f.nativeCalls.at(-1).request),/時間停止能力/);
 }finally{f.host.dispose();}
});

test('new inline narrative acquisition is available to current story and never charges unknown prices',async()=>{
 const f=fixture();try{
  await f.host.sync();
  f.c.chat.push({name:'User',is_user:true,mes:'前面發生車禍了，我發現我現在需要特殊能力，我打開小手機，進入萬寶商城，購買了時間停止能力…'});
  await f.host.sync();const m=await f.api.pocketMemoryState();
  assert.equal(m.abilities.length,1);assert.equal(m.abilities[0].name,'時間停止能力');assert.equal(f.backend.wallet().balance,520);
  assert.match(f.host.promptPlan().map(p=>p.text).join(''),/時間停止能力/);await f.host.sync();assert.equal((await f.api.pocketMemoryState()).abilities.length,1);
  f.c.chat.push({name:'Alice',is_user:false,mes:'我在萬寶商城購買了讀心能力。'});await f.host.sync();assert.equal((await f.api.pocketMemoryState()).abilities.length,1);
 }finally{f.host.dispose();}
});
