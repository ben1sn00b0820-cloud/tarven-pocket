import test from 'node:test';
import assert from 'node:assert/strict';
import {createActivityBridge, nativeActivitySnapshot} from '../pocket/activity.js';
import {sourceScope, collectSourceEvents} from '../pocket/source-sync.js';

const KEY = 'tavern_pocket_v3';
const gate = () => {let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(policy = {}) {
 const threads = [], posts = [], saves = [], renders = [], updates = [], notices = [], listeners = new Set();
 let active;
 const make = id => ({chatId:id, characterId:0, characters:[{avatar:'alice.png'}], name1:'使用者甲',name2:'Alice',chat:[],chatMetadata:{},saveChat:async()=>{saves.push(id);},addOneMessage:m=>renders.push(m),updateMessageBlock:(id,m)=>updates.push(m)});
 active=make('A');
 const backend={threads:async()=>threads,chats:{get:async id=>threads.find(t=>t.id===id)},apps:{list:async()=>posts},spaceKey:()=>'',emit:(type,data={})=>{for(const fn of listeners)fn({type,...data});},subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},chatMutate:async(id,task)=>{const r=await task();backend.emit('chat',{threadId:id});return r;},addForumPosts:async values=>{posts.push(...values);backend.emit('forum');}};
 const bridge=createActivityBridge({context:()=>active,backend,notice:m=>notices.push(m),getMirrorPolicy:()=>policy});
 return {bridge,backend,threads,posts,saves,renders,updates,notices,get c(){return active;},switch(id){active=make(id);return active;}};
}
const thread=()=>({id:'t',type:'dm',name:'Alice',members:['Alice'],messages:[]});
const message=(id,text,extra={})=>({id,from:'Alice',kind:'text',text,at:Date.now(),...extra});

 test('initial baseline and reload do not flood old phone messages into story',async()=>{
 const f=fixture();f.threads.push(thread());f.threads[0].messages.push(message('old','old history'));
 try{await f.bridge.baseline();await f.bridge.sync();assert.equal(f.c.chat.length,0);
 f.threads[0].messages.push(message('fresh','新的微信'));await f.bridge.sync();assert.equal(f.c.chat.length,1);assert.match(f.c.chat[0].mes,/新的微信/);
 assert.match(f.c.chat[0].extra.display_text,/tp-story-card/);assert.doesNotMatch(f.c.chat[0].mes,/<phone>/);assert.equal(f.c.chat[0].extra.tavern_pocket_activity.scope,sourceScope(f.c));
 await f.bridge.baseline();await f.bridge.sync();assert.equal(f.c.chat.length,1);assert.match(f.bridge.contextText(),/新的微信/);assert.match(f.bridge.contextText(),/old history/);
 }finally{f.bridge.dispose();}
});

test('source-origin messages do not loop; local settlement mirrors once without changing money',async()=>{
 const f=fixture();f.threads.push(thread());let walletCalls=0;f.backend.wallet=()=>{walletCalls++;throw Error('must not touch wallet');};
 try{await f.bridge.baseline();const m=message('paid','晚餐',{kind:'transfer',amount:'35.00',paymentId:'source:paid',state:'sent',source:{scope:sourceScope(f.c),id:'paid'}});f.threads[0].messages.push(m);await f.bridge.sync();assert.equal(f.c.chat.length,0);
 m.state='accepted';m.openedBy='me';f.threads[0].messages.push(message('notice','收下了{对方}的转账',{from:'me',kind:'notice',target:'Alice',paymentId:'notice:take:source:paid'}));await f.bridge.sync();await f.bridge.sync();assert.equal(f.c.chat.length,1);assert.match(f.c.chat[0].mes,/交易狀態.*使用者甲/s);assert.match(f.c.chat[0].mes,/35\.00/);assert.equal(walletCalls,0);
 }finally{f.bridge.dispose();}
});

test('native transfers and redpackets render sends and one settlement per payment',async()=>{
 const f=fixture();f.threads.push(thread());
 try{await f.bridge.baseline();for(const kind of ['transfer','redpacket'])f.threads[0].messages.push(message(kind,'零用錢',{from:'me',kind,amount:'100',state:'sent',paymentId:kind}));await f.bridge.sync();assert.equal(f.c.chat.length,1);assert.equal(f.c.chat[0].name,'手機動態');assert.equal(f.c.chat[0].is_user,false);assert.equal(f.c.chat[0].extra.tavern_pocket_activity.ids.length,2);
 f.threads[0].messages[0].state='accepted';f.threads[0].messages[0].openedBy='Alice';f.threads[0].messages[1].state='opened';f.threads[0].messages[1].openedBy='Alice';await f.bridge.sync();await f.bridge.sync();assert.equal(f.c.chat.length,1);assert.equal(f.c.chat[0].extra.tavern_pocket_activity.ids.length,4);
 }finally{f.bridge.dispose();}
});

test('native edits update existing outward card; user deletion and manual edit remain respected',async()=>{
 const f=fixture();f.threads.push(thread());
 try{await f.bridge.baseline();f.threads[0].messages.push(message('x','before'));await f.bridge.sync();f.threads[0].messages[0].text='after';await f.bridge.sync();assert.equal(f.c.chat.length,1);assert.match(f.c.chat[0].mes,/after/);assert.equal(f.updates.length,1);
 f.c.chat[0].mes='user changed this card';f.threads[0].messages[0].text='edited again';await f.bridge.sync();assert.equal(f.c.chat[0].mes,'user changed this card');
 f.c.chat.length=0;f.threads[0].messages[0].text='changed once more';await f.bridge.sync();assert.equal(f.c.chat.length,0);await f.bridge.baseline();assert.equal(f.c.chat.length,0);
 }finally{f.bridge.dispose();}
});

test('fresh forum posts/replies and Instagram stories share visible cards while remaining archived; private diary is excluded',async()=>{
 const f=fixture();
 try{await f.bridge.baseline();f.posts.push({id:'p1',author:'Alice',title:'今日',text:'到海邊了',at:1,replies:[{id:'r1',from:'me',text:'好看',at:2}]});await f.bridge.sync();await f.bridge.sync();assert.equal(f.c.chat.length,1);assert.equal(f.c.chat[0].extra.tavern_pocket_activity.ids.length,2);assert.equal(f.bridge.memoryState().forum,2);assert.match(f.bridge.recall('回顧論壇之前的貼文'),/到海邊了/);
 const story={id:'ig1',app:'instagram',action:'story',from:'Alice',text:'夕陽',at:3};await f.bridge.record([story,{id:'secret',app:'diary',action:'entry',from:'me',text:'PRIVATE_SECRET'}]);await f.bridge.record([story]);assert.equal(f.c.chat.length,1);assert.equal(f.c.chat[0].extra.tavern_pocket_activity.ids.length,3);assert.doesNotMatch(f.bridge.contextText(),/PRIVATE_SECRET|到海邊了/);
 }finally{f.bridge.dispose();}
});

test('intent save failure appends nothing and can retry without executing any app action',async()=>{
 const f=fixture();try{await f.bridge.baseline();const original=f.c.saveChat;f.c.saveChat=async()=>{throw Error('disk full');};const e={id:'one',app:'instagram',action:'dm',from:'Alice',to:'使用者甲',text:'hello'};await assert.rejects(f.bridge.record([e]),/disk full/);assert.equal(f.c.chat.length,0);f.c.saveChat=original;await f.bridge.record([e]);assert.equal(f.c.chat.length,1);}finally{f.bridge.dispose();}
});

test('final chat save failure resumes pending journal without appending a duplicate',async()=>{
 const f=fixture();try{await f.bridge.baseline();let calls=0;f.c.saveChat=async()=>{if(++calls===2)throw Error('interrupted');};const e={id:'one',app:'instagram',action:'dm',from:'Alice',to:'使用者甲',text:'hello'};await assert.rejects(f.bridge.record([e]),/interrupted/);assert.equal(f.c.chat.length,1);assert.equal(f.c.chatMetadata[KEY].activity.journal[0].delivery,'pending');await f.bridge.record([e]);assert.equal(f.c.chat.length,1);assert.equal(f.c.chatMetadata[KEY].activity.journal[0].delivery,'done');}finally{f.bridge.dispose();}
});

test('chat switch while snapshot is in flight cannot append in either new or old story',async()=>{
 const f=fixture();f.threads.push(thread());try{await f.bridge.baseline();const old=f.c,g=gate();f.backend.threads=()=>g.promise;const pending=f.bridge.sync();await Promise.resolve();f.switch('B');g.resolve([{...thread(),messages:[message('new','late')]}]);await assert.rejects(pending,/對話已切換/);assert.equal(old.chat.length,0);assert.equal(f.c.chat.length,0);assert.equal(f.renders.length,0);}finally{f.bridge.dispose();}
});

test('native operation finishing after chat switch is baselined and never exported to new story',async()=>{
 const f=fixture();f.threads.push(thread());try{await f.bridge.baseline();const g=gate(),pending=f.backend.chatMutate('t',async()=>{await g.promise;f.threads[0].messages.push(message('late','old private reply'));});await Promise.resolve();f.switch('B');await f.bridge.baseline();g.resolve();await pending;await f.bridge.idle();await f.bridge.sync();assert.equal(f.c.chat.length,0);assert.equal(f.c.chat.length,0);}finally{f.bridge.dispose();}
});

test('foreign source messages are never surfaced even when shared phone partitions are enabled',()=>{
 const f=fixture();try{const values=nativeActivitySnapshot(f.c,[{...thread(),messages:[message('x','foreign',{kind:'redpacket',amount:20,state:'opened',source:{scope:'another story',id:'x'}})]}]);assert.deepEqual(values,[]);}finally{f.bridge.dispose();}
});

test('activity IDs cannot poison metadata prototype and UI text is escaped',async()=>{
 const f=fixture();try{await f.bridge.baseline();await f.bridge.record([{id:'__proto__',app:'instagram',action:'post',from:'<script>alert(1)</script>',text:'<img src=x onerror=alert(1)>'},{id:'bad',app:'__proto__',action:'post',from:'x'}]);assert.equal(f.c.chat.length,1);assert.ok(Object.hasOwn(f.c.chatMetadata[KEY].activity.seen,'__proto__'));assert.doesNotMatch(f.c.chat[0].extra.display_text,/<script>|<img src=x/);}finally{f.bridge.dispose();}
});


test('native replies under a source forum post mirror while source replies never echo',()=>{
 const f=fixture();try{const source={scope:sourceScope(f.c),id:'story'};const posts=[{id:'p',author:'Alice',text:'sourcepost',pocketSource:source,replies:[{id:'r1',from:'Alice',text:'source reply',pocketSource:source},{id:'r2',from:'me',text:'native reply'}]}];const values=nativeActivitySnapshot(f.c,[],posts);assert.equal(values.length,1);assert.equal(values[0].text,'native reply');const contextValues=nativeActivitySnapshot(f.c,[],posts,{includeSource:true});assert.equal(contextValues.length,3);}finally{f.bridge.dispose();}
});


test('mixed actors and apps share one ordered activity batch until an ordinary narrative boundary',async()=>{
 const f=fixture();try{await f.bridge.baseline();const events=[{id:'first',app:'wechat',action:'message',from:'使用者甲',to:'Alice',text:'吃飯沒？',at:1},{id:'second',app:'instagram',action:'story',from:'Alice',text:'剛吃完',at:2}];await f.bridge.record(events);assert.equal(f.c.chat.length,1);const first=f.c.chat[0];assert.equal(first.name,'手機動態');assert.equal(first.is_user,false);assert.deepEqual(first.extra.tavern_pocket_activity.ids,['first','second']);assert.ok(first.mes.indexOf('吃飯沒？')<first.mes.indexOf('剛吃完'));assert.equal((first.extra.display_text.match(/data-tp-card/g)||[]).length,2);
 await f.bridge.record([{id:'third',app:'forum',action:'post',from:'Bob',title:'午餐',text:'一起吃',at:3}]);assert.equal(f.c.chat.length,1);assert.equal(first.extra.tavern_pocket_activity.ids.length,3);assert.equal(f.bridge.memoryState().forum,1);const before=structuredClone(first);const narrative={name:'Alice',is_user:false,mes:'她抬起頭，對你微笑。'};f.c.chat.push(narrative);
 await f.bridge.record([{id:'fourth',app:'wechat',action:'message',from:'Alice',to:'使用者甲',text:'下次一起',at:4}]);assert.equal(f.c.chat.length,3);assert.deepEqual(first,before);assert.deepEqual(narrative,{name:'Alice',is_user:false,mes:'她抬起頭，對你微笑。'});assert.deepEqual(f.c.chat[2].extra.tavern_pocket_activity.ids,['fourth']);
 assert.equal(collectSourceEvents(f.c).events.length,0);
 }finally{f.bridge.dispose();}
});

test('a large phone burst creates bounded batches instead of one message per event',async()=>{
 const f=fixture();try{await f.bridge.baseline();const events=Array.from({length:45},(_,i)=>({id:`e${i}`,app:'wechat',action:'message',from:i%2?'Alice':'使用者甲',to:i%2?'使用者甲':'Alice',text:`訊息${i}`,at:i+1}));await f.bridge.record(events);assert.equal(f.c.chat.length,3);assert.deepEqual(f.c.chat.map(m=>m.extra.tavern_pocket_activity.ids.length),[20,20,5]);assert.deepEqual(f.c.chat.flatMap(m=>m.extra.tavern_pocket_activity.ids),events.map(e=>e.id));await f.bridge.record(events);assert.equal(f.c.chat.length,3);}finally{f.bridge.dispose();}
});

test('user editing plaintext, display or swipe blocks later merging without losing fresh activity',async()=>{
 for(const edit of [m=>{m.mes='我的改寫';},m=>{m.extra.display_text='<p>我的顯示</p>';},m=>{m.swipe_id=1;}]){
 const f=fixture();try{await f.bridge.baseline();await f.bridge.record([{id:'a',app:'wechat',action:'message',from:'Alice',text:'原訊息'}]);edit(f.c.chat[0]);const edited=structuredClone(f.c.chat[0]);await f.bridge.record([{id:'a',app:'wechat',action:'message',from:'Alice',text:'手機內修改'}, {id:'b',app:'wechat',action:'message',from:'Bob',text:'新訊息'}]);assert.equal(f.c.chat.length,2);assert.deepEqual(f.c.chat[0],edited);assert.deepEqual(f.c.chat[1].extra.tavern_pocket_activity.ids,['b']);}finally{f.bridge.dispose();}}
});

test('existing v0.6 single activity messages stay immutable and cannot absorb new events',async()=>{
 const f=fixture();try{await f.bridge.baseline();const old={name:'Alice',is_user:false,mes:'舊版獨立卡片',extra:{display_text:'<p>舊版</p>',tavern_pocket_activity:{ids:['old'],scope:sourceScope(f.c)}}};f.c.chat.push(old);const before=structuredClone(old);await f.bridge.record([{id:'old',app:'wechat',action:'message',from:'Alice',text:'已編輯'}, {id:'new',app:'wechat',action:'message',from:'Alice',text:'新版本'}]);assert.equal(f.c.chat.length,2);assert.deepEqual(old,before);assert.equal(f.c.chat[1].extra.tavern_pocket_activity.version,3);assert.deepEqual(f.c.chat[1].extra.tavern_pocket_activity.ids,['new']);}finally{f.bridge.dispose();}
});

test('failed batch save followed by user deletion does not resurrect the removed batch',async()=>{
 const f=fixture();try{await f.bridge.baseline();let count=0;f.c.saveChat=async()=>{if(++count===2)throw Error('interrupted');};const events=[{id:'a',app:'wechat',action:'message',from:'Alice',text:'一'}, {id:'b',app:'wechat',action:'message',from:'Bob',text:'二'}];await assert.rejects(f.bridge.record(events),/interrupted/);assert.equal(f.c.chat.length,1);f.c.chat.length=0;await f.bridge.record(events);assert.equal(f.c.chat.length,0);assert.ok(f.c.chatMetadata[KEY].activity.journal.every(r=>r.delivery==='done'));}finally{f.bridge.dispose();}
});

test('existing and source-origin forum posts are quietly archived, edited in place and available after reload',async()=>{
 const f=fixture();try{
  f.posts.push({id:'old',author:'Alice',title:'旅行筆記',text:'第一版',at:1,pocketSource:{scope:sourceScope(f.c),id:'origin'}});
  await f.bridge.baseline();assert.equal(f.c.chat.length,0);assert.equal(f.bridge.memoryState().count,1);
  assert.equal(f.bridge.recall('繼續吃飯'), '');assert.match(f.bridge.recall('旅行筆記寫了什麼'),/第一版/);
  f.posts[0].text='修訂內容';await f.bridge.sync();assert.equal(f.bridge.memoryState().count,1);assert.match(f.bridge.recall('查論壇紀錄'),/修訂內容/);assert.doesNotMatch(f.bridge.contextText(),/旅行筆記|修訂內容/);
  const reloaded=createActivityBridge({context:()=>f.c,backend:f.backend});try{assert.equal(reloaded.memoryState().count,1);assert.match(reloaded.recall('查論壇紀錄'),/修訂內容/);}finally{reloaded.dispose();}
 }finally{f.bridge.dispose();}
});

test('catalogues remain archive-only while confirmed purchases create a visible durable receipt',async()=>{
 const f=fixture();try{await f.bridge.baseline();const item={id:'sku:time',app:'shop',action:'catalogue',from:'使用者甲',itemName:'時間停止能力',text:'暫停周圍時間',amount:100,at:1};await f.bridge.record([item,{...item,id:'order:1',action:'purchase',state:'purchased',at:2}]);await f.bridge.record({...item,text:'新商品描述'});
  assert.equal(f.c.chat.length,1);assert.deepEqual(f.c.chat[0].extra.tavern_pocket_activity.ids,['order:1']);assert.equal(f.bridge.memoryState().shop,2);assert.equal(f.bridge.memoryState('新商品').matched,1);assert.equal(f.bridge.recall('角色向我走來'), '');assert.match(f.bridge.recall('時間停止能力之前多少錢'),/100/);assert.equal(f.bridge.contextText(),'');
  f.switch('B');await f.bridge.baseline();assert.equal(f.bridge.memoryState().count,0);assert.equal(f.bridge.recall('時間停止能力'), '');
 }finally{f.bridge.dispose();}
});

test('old saved catalogue is migrated to quiet recallable memory before any new search',async()=>{
 const f=fixture();try{f.c.chatMetadata[KEY]={version:3,events:[],diaries:[],worldbooks:[],catalogue:[{id:'old-item',name:'飛行能力',description:'自由飛行',price:99,at:1}]};await f.bridge.baseline();assert.equal(f.c.chat.length,0);assert.equal(f.bridge.memoryState().shop,1);assert.match(f.bridge.recall('回憶商城內容'),/自由飛行/);await f.bridge.baseline();assert.equal(f.bridge.memoryState().shop,1);}finally{f.bridge.dispose();}
});

function legacyBatch(f,events,{edited=false}={}){
 const data=f.c.chatMetadata[KEY]??={version:3,events:[],diaries:[],catalogue:[],worldbooks:[]};
 data.activity??={version:1,seen:{},journal:[]};for(const event of events)data.activity.journal.push({id:event.id,event,delivery:'done',published:true});
 const m={name:'手機動態',is_user:false,is_system:false,mes:'舊版手機合併文字',extra:{display_text:'<article>舊版手機卡片</article>',tavern_pocket_activity:{version:2,ids:events.map(e=>e.id),scope:sourceScope(f.c)}}};
 const value=JSON.stringify([m.mes,m.extra.display_text,m.extra.tavern_pocket_activity.ids,null]);let hash=2166136261;for(let i=0;i<value.length;i++)hash=Math.imul(hash^value.charCodeAt(i),16777619);m.extra.tavern_pocket_activity.rendered=`${value.length}:${hash>>>0}`;
 if(edited)m.mes='使用者自行改写';f.c.chat.push(m);return m;
}

test('v0.9 preserves old visible cards and does not backfill v0.8 archived records',async()=>{
 const f=fixture();try{
  const normal={name:'Alice',is_user:false,mes:'普通正文：我看了論壇。'};f.c.chat.push(normal);
  const quiet={id:'forum:1',app:'forum',action:'post',from:'Alice',title:'論壇舊文',text:'內容',at:1};
  legacyBatch(f,[quiet,{id:'wx1',app:'wechat',action:'message',from:'Alice',text:'微信保留',at:2}]);
  legacyBatch(f,[{...quiet,id:'forum:2'}]);legacyBatch(f,[{...quiet,id:'forum:3'}],{edited:true});
  f.c.chatMetadata[KEY].activity.journal.push({id:'old-quiet',event:{...quiet,id:'old-quiet'},delivery:'memory'});
  const before=structuredClone(f.c.chat);await f.bridge.baseline();assert.deepEqual(f.c.chat,before);
  await f.bridge.record({...quiet,id:'old-quiet',text:'手機裡修改舊記憶'});assert.deepEqual(f.c.chat,before);
  assert.equal(f.bridge.memoryState().forum,4);assert.equal(f.bridge.takeRenderRefresh(),false);
 }finally{f.bridge.dispose();}
});

test('old pending quiet rows are archived without emitting an upgrade backlog',async()=>{
 const f=fixture();try{
  f.c.chatMetadata[KEY]={version:3,events:[],diaries:[],catalogue:[],worldbooks:[],activity:{version:1,seen:{},journal:[{id:'old',event:{id:'old',app:'forum',action:'post',from:'Alice',text:'old pending',at:1},delivery:'pending'}]}};
  await f.bridge.baseline();assert.equal(f.c.chat.length,0);assert.equal(f.c.chatMetadata[KEY].activity.journal[0].delivery,'memory');
 }finally{f.bridge.dispose();}
});

test('archive worldbook sync uses cached existing books, preserves unrelated entries and uses keyword activation',async()=>{
 const f=fixture();try{
  await f.bridge.baseline();await f.bridge.record({id:'shop:one',app:'shop',action:'catalogue',from:'我',itemName:'空間戒指',text:'收納用',amount:300});
  let stored=null;f.c.getWorldInfoNames=()=>[];f.c.loadWorldInfo=async()=>stored;f.c.saveWorldInfo=async(name,book)=>{stored=structuredClone(book);};
  await f.bridge.syncWorldbook();assert.equal(f.bridge.memoryState().worldbook.status,'已同步');assert.equal(Object.values(stored.entries)[0].constant,false);assert.ok(Object.values(stored.entries)[0].key.includes('空間戒指'));
  stored.extraCustom='keep root';stored.entries['50']={uid:50,comment:'使用者條目',content:'不可改'};
  await f.bridge.record({id:'shop:one',app:'shop',action:'catalogue',from:'我',itemName:'空間戒指',text:'修訂',amount:300});assert.equal(f.bridge.memoryState().worldbook.status,'有待同步的更新');
  await f.bridge.syncWorldbook();assert.equal(stored.extraCustom,'keep root');assert.equal(stored.entries['50'].content,'不可改');assert.equal(Object.keys(stored.entries).length,2);assert.match(JSON.stringify(stored),/修訂/);
  f.c.loadWorldInfo=async()=>null;await assert.rejects(f.bridge.syncWorldbook(),/讀取失敗/);assert.equal(f.bridge.memoryState().worldbook.status,'同步失敗');assert.equal(stored.entries['50'].content,'不可改');
 }finally{f.bridge.dispose();}
});

test('chat switch during archive worldbook loading prevents writing into another story',async()=>{
 const f=fixture();try{await f.bridge.baseline();let writes=0;const g=gate();f.c.loadWorldInfo=()=>g.promise;f.c.saveWorldInfo=async()=>{writes++;};const pending=f.bridge.syncWorldbook();await Promise.resolve();f.switch('B');g.resolve(null);await assert.rejects(pending,/對話已切換/);assert.equal(writes,0);}finally{f.bridge.dispose();}
});

test('new chats baseline shared forum history without claiming it; only fresh local posts and replies enter memory',async()=>{
 const f=fixture();try{
  f.posts.push({id:'legacy',author:'Alice',title:'不明歸屬舊貼文',text:'shared history',at:1});
  await f.bridge.baseline();assert.equal(f.bridge.memoryState().count,0);await f.bridge.sync();assert.equal(f.bridge.memoryState().count,0);
  f.posts.push({id:'a',author:'Alice',title:'A 對話貼文',text:'in A',at:2});await f.bridge.sync();assert.equal(f.bridge.memoryState().count,1);
  const original=f.c;f.switch('B');await f.bridge.baseline();await f.bridge.sync();assert.equal(f.bridge.memoryState().count,0);
  f.posts.push({id:'b',author:'Alice',title:'B 對話貼文',text:'in B',at:3});await f.bridge.sync();assert.equal(f.bridge.memoryState().count,1);assert.equal(f.bridge.memoryState().records[0].id,'forum:b');
  f.posts[1].text='A 的舊貼文在共用儲存區改寫';await f.bridge.sync();assert.equal(f.bridge.memoryState().count,1);
  f.posts[1].replies=[{id:'reply-b',from:'me',text:'目前 B 的新回覆',at:4}];await f.bridge.sync();assert.equal(f.bridge.memoryState().count,2);assert.ok(f.bridge.memoryState().records.some(e=>e.id==='forum:a:reply:reply-b'));
  f.posts.push({id:'source-b',author:'Alice',title:'正文 B',text:'source',at:5,pocketSource:{scope:sourceScope(f.c),id:'from-body'}});await f.bridge.baseline();assert.equal(f.bridge.memoryState().count,3);
  const restored=createActivityBridge({context:()=>original,backend:f.backend});try{assert.equal(restored.memoryState().count,1);assert.equal(restored.memoryState().records[0].id,'forum:a');}finally{restored.dispose();}
 }finally{f.bridge.dispose();}
});

test('a late native forum mutation after switching chats is baselined without assigning old work to the new story',async()=>{
 const f=fixture();try{await f.bridge.baseline();const g=gate();f.backend.addForumPosts=undefined;
  // Wrap a delayed native forum mutator through a fresh bridge.
  f.backend.addForumPosts=async values=>{await g.promise;f.posts.push(...values);f.backend.emit('forum');};
  const bridge=createActivityBridge({context:()=>f.c,backend:f.backend});try{await bridge.baseline();const pending=f.backend.addForumPosts([{id:'late',author:'Alice',title:'A 延遲貼文',text:'old work',at:1}]);await Promise.resolve();f.switch('B');await bridge.baseline();g.resolve();await pending;await bridge.idle();await bridge.sync();assert.equal(bridge.memoryState().count,0);}finally{bridge.dispose();}
 }finally{f.bridge.dispose();}
});


test('source-origin fresh forum posts/replies archive without echo; a native reply mirrors once',async()=>{
 const f=fixture();try{await f.bridge.baseline();const source={scope:sourceScope(f.c),id:'body'};
  f.posts.push({id:'source-post',author:'Alice',title:'正文論壇',text:'正文中已呈現',at:1,pocketSource:source,replies:[{id:'source-reply',from:'me',text:'正文回覆',at:2,pocketSource:source}]});
  await f.bridge.sync();assert.equal(f.c.chat.length,0);assert.equal(f.bridge.memoryState().count,2);
  f.posts[0].replies.push({id:'native-reply',from:'me',text:'從手機送出的回覆',at:3});await f.bridge.sync();await f.bridge.sync();
  assert.equal(f.c.chat.length,1);assert.deepEqual(f.c.chat[0].extra.tavern_pocket_activity.ids,['forum:source-post:reply:native-reply']);assert.equal(f.bridge.memoryState().count,3);
 }finally{f.bridge.dispose();}
});

test('mirroring policy toggles affect only new operations and preserve visible cards plus memory',async()=>{
 const policy={forum:true,shop:true},f=fixture(policy);try{await f.bridge.baseline();
  await f.bridge.record({id:'visible',app:'forum',action:'post',from:'me',title:'先前貼文',text:'原內容',at:1});const before=structuredClone(f.c.chat);
  policy.forum=false;policy.shop=false;
  await f.bridge.record([{id:'visible',app:'forum',action:'post',from:'me',title:'先前貼文',text:'關閉後編輯',at:1},{id:'muted',app:'forum',action:'post',from:'me',text:'靜默新貼文',at:2},{id:'muted-order',app:'shop',action:'purchase',state:'purchased',from:'me',itemName:'背包',amount:20,at:3}]);
  assert.deepEqual(f.c.chat,before);assert.equal(f.bridge.memoryState().count,3);
  policy.forum=true;policy.shop=true;await f.bridge.baseline();await f.bridge.sync();assert.deepEqual(f.c.chat,before);
  await f.bridge.record({id:'muted',app:'forum',action:'post',from:'me',text:'重新開啟後改寫舊貼文',at:2});assert.deepEqual(f.c.chat,before);
  await f.bridge.record({id:'fresh-order',app:'shop',action:'purchase',state:'purchased',from:'me',itemName:'新物品',amount:30,at:4});assert.equal(f.c.chat.length,1);assert.deepEqual(f.c.chat[0].extra.tavern_pocket_activity.ids,['visible','fresh-order']);
 }finally{f.bridge.dispose();}
});

test('narrative purchases, unconfirmed orders and forum likes never append another activity card',async()=>{
 const f=fixture();try{await f.bridge.baseline();
  const event={id:'story-purchase',app:'shop',action:'purchase',state:'purchased',from:'me',itemName:'空間戒指',amount:50,quantity:2,itemKind:'item'};
  await f.bridge.record(event,{mirror:false});await f.bridge.record(event);assert.equal(f.c.chat.length,0);assert.equal(f.bridge.memoryState().shop,1);
  await f.bridge.record([{...event,id:'pending-order',state:'pending'},{id:'like',app:'forum',action:'like',from:'me'}]);assert.equal(f.c.chat.length,0);
  assert.equal(f.c.chatMetadata[KEY].activity.journal[0].event.quantity,2);assert.equal(f.c.chatMetadata[KEY].activity.journal[0].event.itemKind,'item');
  await f.bridge.record({id:'ig-like',app:'instagram',action:'like',from:'me'});assert.equal(f.c.chat.length,1);assert.deepEqual(f.c.chat[0].extra.tavern_pocket_activity.ids,['ig-like']);
 }finally{f.bridge.dispose();}
});

test('failed new forum card save resumes the same v0.9 pending batch after reload',async()=>{
 const f=fixture();try{await f.bridge.baseline();let calls=0;const save=f.c.saveChat;f.c.saveChat=async()=>{if(++calls===2)throw Error('interrupted');};
  const post={id:'pending-forum',app:'forum',action:'post',from:'me',title:'新貼文',text:'待保存',at:1};await assert.rejects(f.bridge.record(post),/interrupted/);
  assert.equal(f.c.chat.length,1);assert.equal(f.c.chatMetadata[KEY].activity.journal[0].delivery,'pending');
  f.c.saveChat=save;await f.bridge.baseline();await f.bridge.sync();assert.equal(f.c.chat.length,1);assert.equal(f.c.chatMetadata[KEY].activity.journal[0].delivery,'done');
 }finally{f.bridge.dispose();}
});
