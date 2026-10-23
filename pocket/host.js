import {getConnectionOptions,loadPhoneWorldbooks,generatePhoneResponse,inspectPhoneWorldbooks,readPhoneWorldbookEntry} from './services.js';
import {parsePhoneEvents,stripPhoneBlocks} from './events.js';
import {PHONE_PROMPT} from './prompt.js';
import {createSourceSync,sourceScope,collectSourceEvents,paymentKey} from './source-sync.js';
import {asMessages} from '../core/llm.js';
import {createContactBridge} from './contacts.js';
import {createPhotoBridge} from './photos.js';
import {stripStatusPanels} from './status.js';
import {createImagePresets} from './image-presets.js';
import {createShopService} from './shop.js';
import {createActivityBridge} from './activity.js';
import {createForumSource} from './forum-source.js';
import {projectInstagram} from './instagram.js';
import {createStatusPublisher} from './status-publish.js';
import {createPersonalMemory} from './personal-memory.js';
import {createNarrativeMemory} from './narrative-memory.js';
import {memoryMentionContext} from './mentions.js';
import {SHOP_PRESET_LIMITS,normalizeShopPresets,listShopPresets,saveShopPreset,selectShopPreset,deleteShopPreset,importShopPresets,exportShopPresets} from './shop-presets.js';

const KEY='tavern_pocket_v3', clone=v=>structuredClone(v), uid=()=>crypto.randomUUID();
const plain=(v,max,label)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)throw Error(`${label}須為 1–${max} 字元`);return v.trim();};
const empty=()=>({version:3,events:[],diaries:[],catalogue:[],worldbooks:[]});
export function createPocketHost({context,backend,notice=()=>{}}){
 let alive=true,sourceEvents=[],sourceKey='',busy=false,actionQueue=Promise.resolve(),photoScope='',photoSyncs=0,renderTimer;
 const emit=()=>{if(alive)backend.emit('pocket',{});};
 const contacts=createContactBridge({context,backend,notice,publishStatus:createStatusPublisher({context,notice})});
 const activity=createActivityBridge({context,backend,notice,getMirrorPolicy:()=>({forum:config().mirrorForum!==false,shop:config().mirrorShop!==false})});
 const memory=createPersonalMemory({context,backend,notice});
 const narrativeMemory=createNarrativeMemory({context,acquire:acquireNarrative,notice});
 const forumSource=createForumSource({context,backend});
 const imagePresets=createImagePresets({context,backend});
 const photos=createPhotoBridge({context,backend,contacts,imagePresets,notice,autoEnabled:()=>config().autoWeChatPhotos!==false});
 const shopService=createShopService({backend,taskPrompt,check,edit,getPresets:()=>config().shopPresets});
 const photoUnsubscribe=backend.subscribe?.(event=>{if(event.type==='chat'&&!photoSyncs&&photoScope&&photoScope===sourceScope(context()))photos.autoReceive().catch(e=>notice(e.message));});
 function config(){const c=context(),old=c.extensionSettings.tavern_pocket_v1||{};const saved=c.extensionSettings[KEY]??={profileId:old.modelProfileId||'',inject:old.injectPrompt!==false};for(const key of ['autoWeChatPhotos','mirrorForum','mirrorShop'])if(typeof saved[key]!=='boolean')saved[key]=true;if(!Number.isInteger(saved.worldbookBudget))saved.worldbookBudget=48000;return saved;}
 function check(c,scope=sourceScope(c)){if(!alive||!scope||sourceScope(context())!==scope||context().chatMetadata!==c.chatMetadata)throw Error('對話已切換，本次操作未套用。');}
 function data(c=context()){
  if(!sourceScope(c))return empty();
  if(!c.chatMetadata[KEY]){
   const old=c.chatMetadata.tavern_pocket_v1;
   c.chatMetadata[KEY]={...empty(),worldbooks:Array.isArray(old?.phoneWorldbooks)?clone(old.phoneWorldbooks):[],diaries:Array.isArray(old?.diaries)?old.diaries.map(d=>({id:d.id||uid(),from:c.name1||'我',title:d.title||'舊版日記',text:d.text||'',private:true,at:d.at||Date.now()})):[]};
  }
  const d=c.chatMetadata[KEY];if(d.version!==3)throw Error('手機資料版本不相容，請先保留備份。');return d;
 }
 async function edit(c,fn){check(c);const before=clone(data(c));fn(data(c));try{check(c);await c.saveMetadata();check(c);}catch(e){const current=c.chatMetadata[KEY];c.chatMetadata[KEY]={...before,...(current?.activity?{activity:current.activity}:{})};throw e;}emit();}
 function project(c){
  const d=data(c),events=[...(sourceKey===sourceScope(c)?sourceEvents:[]),...d.events],diaries=clone(d.diaries);
  for(const e of events)if(e.app==='diary'&&e.action==='entry')diaries.push({id:e.id,from:e.from,title:e.title||'角色日記',text:e.text,private:false,at:e.at||0});
  return {instagram:projectInstagram(events,{userName:c.name1||'我',characterName:c.name2||'角色',profiles:contacts.profiles(),contacts:backend.contacts?.()||[]}),diaries:diaries.sort((a,b)=>b.at-a.at)};
 }
 function storyText(c){return (c.chat||[]).filter(m=>!m.is_system&&!m.extra?.tavern_pocket_activity).slice(-20).map(m=>`${m.name||''}: ${stripStatusPanels(stripPhoneBlocks(m.mes||''))}`).join('\n').slice(-8000);}
 function memoryQuery(c){return String((c.chat||[]).findLast(m=>m?.is_user&&!m.is_system&&!m.extra?.tavern_pocket_activity&&!m.extra?.tavern_pocket_status)?.mes||'');}
 function referenceFacts(query){return memoryMentionContext(query,memory.state(),{maxChars:12000});}
 function sharedPhoneText(c){
  const p=project(c),wallet=backend.wallet();
  const trim=x=>({id:x.id,from:x.from,to:x.to,text:String(x.text||'').slice(0,600),...(x.photoId||x.image?{image:'已附圖片'}:{})});
  const shared={user:c.name1,character:c.name2,virtualBalance:wallet.balance,inventorySource:'物品與能力以使用者長期記憶為準，不以舊錢包訂單覆蓋手動修改',instagramPosts:p.instagram.posts.slice(0,5).map(x=>({...trim(x),comments:x.comments.slice(-3).map(trim)})),instagramStories:p.instagram.stories.slice(0,6).map(x=>({...trim(x),expired:x.expired})),instagramDMs:p.instagram.dms.slice(-12).map(trim),characterDiaries:p.diaries.filter(d=>!d.private||config().sharePrivateDiary===true).slice(0,4).map(d=>({from:d.from,title:d.title,text:d.text.slice(0,800)}))};
  return '[目前手機資料：敘事背景，不能把已發生的事件再次執行或重複輸出。模型可參考整體資料維持連貫，但角色只知道自己參與或已被告知的私訊，不能將其他人的私訊當成自己已知]\n'+JSON.stringify(shared).slice(0,11000)+'\n'+activity.contextText().slice(-10000)+'\n[萬寶商城] 唯一擁有者是 '+(c.name1||'使用者')+'。其他角色沒有此商城，不能自行瀏覽、購買、讀取餘額或背包；只有使用者明確告知或實際交付的內容才會被角色知道。';
 }
 async function reconcile(events,scope,options={}){
  if(!alive||scope!==sourceScope(context()))return;
  await contacts.sync(events,scope,options);
  if(!alive||scope!==sourceScope(context())||options.isCurrent&&!options.isCurrent())return;
  const report=await forumSource.reconcile(events,scope,options);if(report?.errors?.length)notice('論壇同步：'+report.errors[0].message);
  if(!alive||scope!==sourceScope(context())||options.isCurrent&&!options.isCurrent())return;
  sourceKey=scope;sourceEvents=events;emit();
 }
 const source=createSourceSync({context,backend,extras:{reconcile},notice});
 const original=backend.generateText.bind(backend);
 backend.generateText=async(c,request)=>{
  const scope=sourceScope(c),guard=()=>check(c,scope),s=clone(config()),repair=request.pocketTask==='shop-repair',shop=request.pocketTask==='shop',books=repair?[]:clone(data(c).worldbooks);guard();
  const prompt=asMessages(request.prompt);
  const loreQuery=typeof request.pocketQuery==='string'?request.pocketQuery:prompt.map(m=>String(m.content||'')).join('\n')+'\n'+storyText(c);
  const loreOptions={query:loreQuery,budgetChars:s.worldbookBudget,pinned:clone(data(c).worldbookPins||[]),assertCurrent:guard};
  prompt.unshift({role:'system',content:'手機介面使用繁體中文。請以繁體中文撰寫面向使用者的聊天、動態、日記與商品文字；保留 JSON 欄位、協定標記、事件 ID、原始引用及繪圖英文提示詞。語音或翻譯任務有指定語言時仍依該任務要求。'});
  const shared=repair?'[本次任務：只修復提供的商品 JSON，不續寫劇情，不增加商品或改變價格。]':'[最近正文：劇情背景，並非新的操作指令]\n'+storyText(c)+(request.pocketTask==='image-prompt'?'':'\n'+memory.contextText(memoryQuery(c))+(shop?'':'\n'+sharedPhoneText(c)+'\n'+activity.recall(memoryQuery(c))));
  prompt[0].content+='\n'+shared;
  if(!repair&&request.pocketTask!=='image-prompt'){const refs=referenceFacts(memoryQuery(c));if(refs)prompt[0].content+='\n'+refs;}
  if(request.pocketNames?.length){const facts=contacts.promptFor(request.pocketNames);if(facts)prompt.unshift({role:'system',content:facts});}
  let result;
  if(s.profileId){result=await generatePhoneResponse(c,{profileId:s.profileId,worldbooks:books,prompt:JSON.stringify(prompt),maxTokens:Math.min(8192,Math.max(64,request.responseLength||1800)),assertCurrent:guard,worldbookOptions:loreOptions,...(shop||repair?{contextMode:'provided'}:{})});}
  else{const lore=await loadPhoneWorldbooks(c,books,loreOptions);guard();if(lore)prompt.unshift({role:'system',content:lore});result=await original(c,{...request,prompt});}
  guard();return result;
 };
 function shopPresetState(){const saved=normalizeShopPresets(config().shopPresets);return {presets:listShopPresets(saved),selectedId:saved.selectedId,limits:SHOP_PRESET_LIMITS};}
 async function state(){const c=context(),options=getConnectionOptions(c);return {scope:sourceScope(c),userName:c.name1||'我',characterName:c.name2||'角色',shopPresets:shopPresetState(),...project(c),catalogue:clone(data(c).catalogue),catalogueSource:clone(data(c).catalogueSource||null),settings:{...clone(config()),worldbooks:clone(data(c).worldbooks),worldbookPins:clone(data(c).worldbookPins||[])},connections:options.modelProfiles,worldbooks:options.worldbookNames,sync:{...source.status(),errors:[...source.status().errors,...narrativeMemory.status().errors],memory:narrativeMemory.status(),statusRoles:contacts.profiles().filter(p=>p.body?.length||p.source?.version).length,busy},version:'0.9.1'};}
 function taskPrompt(c,task,{app}={}){const char=c.characters?.[c.characterId];return `${app==='shop'?'你正在產生虛構商品目錄。只完成本次商城任務，不扮演角色發言，不續寫故事；角色與世界書只作為背景資料。':'你正在虛構手機中扮演角色。'}使用者是 ${c.name1}，目前角色是 ${c.name2}。\n[角色背景]\n${JSON.stringify({name:char?.name,description:char?.description||char?.data?.description,personality:char?.personality||char?.data?.personality,scenario:char?.scenario||char?.data?.scenario}).slice(0,12000)}\n[任務]\n所有面向使用者的商品名稱與說明、貼文、日記、聊天回覆使用繁體中文；繪圖英文標籤與 JSON 欄位名稱保持原格式。\n${task}`;}

 async function modelEvents(c,action,payload){
  const p=project(c),target=plain(payload.to||payload.from||c.name2,80,'角色名');
  const task=action==='ig.generate'?`請以 ${target} 發佈一則符合現在劇情的 Instagram 貼文。只輸出 app instagram、action post 的一個 phone 區塊。`:
   action==='ig.story.generate'?`請以 ${target} 發佈一則符合現在劇情的 Instagram 限時動態。只輸出 app instagram、action story 的一個 phone 區塊。`:
   action==='ig.reply'?`請以 ${target} 在 Instagram 私訊回覆 ${c.name1}。以下是雙方公開私訊：${JSON.stringify(p.instagram.dms.filter(m=>(m.from===target&&m.to===c.name1)||(m.from===c.name1&&m.to===target)).slice(-20))}。只輸出 app instagram、action dm、to ${c.name1} 的 phone 區塊。`:
   `請以 ${target} 寫一篇當前劇情的角色日記，包含 title 與 text。只輸出 app diary、action entry 的 phone 區塊。`;
  const out=await backend.generateText(c,{prompt:taskPrompt(c,task+'\n'+PHONE_PROMPT),responseLength:1500,pocketNames:[target]});check(c);
  const parsed=parsePhoneEvents(out,{userName:c.name1,characterName:c.name2}),events=parsed.events.filter(e=>e.from===target&&(action==='diary.generate'?e.app==='diary'&&e.action==='entry':e.app==='instagram'&&(action==='ig.generate'?e.action==='post':action==='ig.story.generate'?e.action==='story':['dm','message'].includes(e.action)&&e.to===c.name1)));
  if(!events.length)throw Error('模型未回傳符合這個應用的手機事件，沒有匯入，請重試。');
  const saved=events.slice(0,8).map(e=>({...e,id:uid(),at:Date.now()}));
  await edit(c,d=>{d.events.push(...saved);d.events=d.events.slice(-1500);});
  if(action!=='diary.generate')await activity.record(saved);
 }
 async function installPresets(c){
  const [regex,book]=await Promise.all(['TavernPocket_Regex_v0.9.0.json','TavernPocket_Worldbook_v0.9.0.json'].map(async name=>{const r=await fetch(new URL('../presets/'+name,import.meta.url));if(!r.ok)throw Error('配套檔案缺失，請重新安裝 v0.9.0。');return r.json();}));check(c);
  const save=c.saveWorldInfo;if(typeof save!=='function')throw Error('此酒館未提供世界書寫入 API，請使用安裝器輸出的 JSON 手動匯入。');
  await save('Tavern Pocket 手機協定 v0.9.0',book,true);check(c);
  const arr=c.extensionSettings.regex??=[];const old='9b30c203-7f7c-4d94-98f7-bd3b4e87d71f';
  const filtered=arr.filter(r=>r.id!==regex.id&&r.id!==old);filtered.push(regex);c.extensionSettings.regex=filtered;c.saveSettingsDebounced();
  notice('已更新世界書與顯示正則至 v0.9.0。世界書已儲存；內建協定開啟時不用重複綁定。重新整理可更新 Regex 清單。');
 }
 async function action(name,p={},c=context(),scope=sourceScope(c)){
  check(c,scope);busy=true;emit();
  try{
   if(name.startsWith('imagePreset.')||name==='wechatImage.save'){const result=await imagePresets.action(name,p);check(c,scope);emit();return result;}
   else if(name.startsWith('shopPreset.')){
    const saved=config(),before=saved.shopPresets;
    if(name==='shopPreset.state')return shopPresetState();
    if(name==='shopPreset.export')return {json:JSON.stringify(exportShopPresets(before,p.id),null,2),name:'TavernPocket_ShopPresets.json'};
    const update={'shopPreset.save':()=>saveShopPreset(before,p),'shopPreset.select':()=>selectShopPreset(before,p.id),'shopPreset.delete':()=>deleteShopPreset(before,p.id),'shopPreset.import':()=>importShopPresets(before,p)}[name];
    if(!update)throw Error('不支援的商城預設操作。');
    const next=update(),previousIds=new Set(normalizeShopPresets(before).presets.map(x=>x.id));saved.shopPresets=next;
    try{await Promise.resolve(c.saveSettingsDebounced());}catch(error){if(saved.shopPresets===next){if(before===undefined)delete saved.shopPresets;else saved.shopPresets=before;}throw error;}
    check(c,scope);emit();return {...shopPresetState(),savedId:next.selectedId,importedIds:next.presets.filter(x=>!previousIds.has(x.id)).map(x=>x.id)};
   }else if(name==='worldbooks.search'||name==='worldbooks.read'){
    const names=p.names??data(c).worldbooks,options={...p,assertCurrent:()=>check(c,scope)};
    return name==='worldbooks.search'?await inspectPhoneWorldbooks(c,names,options):await readPhoneWorldbookEntry(c,names,options);
   }else if(name==='sync'){await syncNow({retryNarrative:true});}
   else if(name==='presets.install')await installPresets(c);
   else if(name==='settings.save'){
    for(const key of ['autoWeChatPhotos','mirrorForum','mirrorShop'])if(p[key]!==undefined&&typeof p[key]!=='boolean')throw Error('手機設定格式錯誤：'+key);
    const options=getConnectionOptions(c),id=String(p.profileId||''),books=p.worldbooks;if(id&&!options.modelProfiles.some(x=>x.id===id))throw Error('找不到這個模型連線設定。');
    if(!Array.isArray(books)||new Set(books).size!==books.length||books.some(n=>!options.worldbookNames.includes(n)))throw Error('請選擇有效世界書，不可重複。');
    const budget=p.worldbookBudget??config().worldbookBudget,pins=p.worldbookPins??data(c).worldbookPins??[];
    if(!Number.isInteger(budget)||budget<2000||budget>2000000)throw Error('世界書上下文預算須為 2000–2000000 字元的整數；請配合所用模型的上下文容量。');
    if(!Array.isArray(pins)||pins.some(x=>!x||typeof x.book!=='string'||typeof x.entryId!=='string'))throw Error('世界書選取條目格式錯誤。');
    await edit(c,d=>{d.worldbooks=clone(books);d.worldbookPins=clone(pins.filter(x=>books.includes(x.book)));});Object.assign(config(),{worldbookBudget:budget,profileId:id,inject:p.inject!==false,autoWeChatPhotos:p.autoWeChatPhotos??config().autoWeChatPhotos,sharePrivateDiary:p.sharePrivateDiary===true,mirrorForum:p.mirrorForum??config().mirrorForum,mirrorShop:p.mirrorShop??config().mirrorShop});c.saveSettingsDebounced();
   }else if(['ig.generate','ig.story.generate','ig.reply','diary.generate'].includes(name))await modelEvents(c,name,p);
   else if(name==='shop.generate'){const result=await shopService.generate(c,p);await archiveCatalogue(c,result.items);}
   else if(name==='shop.save'){await shopService.save(c,p);await archiveCatalogue(c,data(c).catalogue);}
   else if(name==='shop.delete')await shopService.remove(c,p);
   else if(name==='diary.save'){const value={id:p.id||uid(),from:c.name1||'我',title:plain(p.title||'我的日記',100,'標題'),text:plain(p.text,16000,'日記'),private:true,at:Date.now()};await edit(c,d=>{const i=d.diaries.findIndex(x=>x.id===value.id);if(i<0)d.diaries.push(value);else d.diaries[i]=value;});}
   else if(name==='diary.delete')await edit(c,d=>{d.diaries=d.diaries.filter(x=>x.id!==p.id);});
   else if(['ig.post','ig.story','ig.story.reply','ig.like','ig.comment','ig.dm'].includes(name)){
    const e={id:uid(),app:'instagram',action:name.slice(3),from:c.name1||'我',at:Date.now()};
    if(['ig.post','ig.story','ig.dm'].includes(name)&&p.photoId){const photoId=plain(p.photoId,100,'相片 ID');const photo=await backend.library.getPhoto(photoId);check(c);if(!photo)throw Error('找不到這張相片，請重新上傳。');e.photoId=photoId;}
    if(name!=='ig.like')e.text=e.photoId&&!String(p.text||'').trim()?'':plain(p.text,4000,'內容');
    if(name==='ig.dm')e.to=plain(p.to,80,'收件人');
    if(name==='ig.story.reply'){const story=project(c).instagram.stories.find(x=>x.id===p.id);if(!story)throw Error('找不到這則限時動態。');e.action='dm';e.to=story.from;e.storyId=story.id;}
    if(['ig.like','ig.comment'].includes(name)){const post=project(c).instagram.posts.find(x=>x.id===p.id);if(!post)throw Error('原貼文已不存在。');e.postId=p.id;if(name==='ig.like')e.liked=!post.likes.includes(e.from);}
    await edit(c,d=>{d.events.push(e);d.events=d.events.slice(-1500);});await activity.record([e]);
   }else throw Error('不支援的手機操作。');
   return await state();
  }finally{busy=false;emit();}
 }
 async function archiveCatalogue(c,items){
  check(c);await activity.record((items||[]).map(item=>({id:'catalogue:'+item.id,app:'shop',action:'catalogue',from:c.name1||'我',itemName:item.name,text:item.description||'',amount:item.price,at:item.at||Date.now()})));check(c);
 }
 async function archiveAction(name){
  if(name==='worldbook.export')return activity.exportWorldbook();
  if(name!=='worldbook.sync')throw Error('不支援的論壇與商城記憶操作。');
  const result=await activity.syncWorldbook();emit();return result;
 }
 async function purchase(value,orderId,{mirror=true,isCurrent}={}){
  const c=context(),scope=sourceScope(c),persona=String(c.name1||'我');check(c,scope);
  const guard=()=>{check(c,scope);if(String(context().name1||'我')!==persona||isCurrent&&!isCurrent())throw Error('購買來源或使用者已變動，請重新確認。');};
  await memory.importWallet();guard();
  const item={...clone(value),memoryOwner:persona};
  const result=await backend.pocketPurchase(item,orderId,{isCurrent:()=>{try{guard();return true;}catch{return false;}}});
  guard();
  await memory.recordAcquisition(item,{id:orderId,orderId,source:'萬寶商城購買'});guard();
  await activity.record([{id:'purchase:'+orderId,app:'shop',action:'purchase',from:persona,itemName:item.name,itemKind:item.kind,quantity:item.quantity||1,state:'purchased',text:item.description||'',amount:item.price,at:Date.now()}],{mirror});
  emit();return result;
 }
 async function acquireNarrative(event,options){
  const c=context();check(c,options.scope);if(!options.isCurrent())throw Error('正文已變動，本次取得未套用。');
  const orderId='story-'+(await paymentKey(options.scope,event.id)).slice(7);check(c,options.scope);if(!options.isCurrent())throw Error('正文已變動，本次取得未套用。');
  const known=data(c).catalogue.find(item=>item.name===event.name),price=event.price??known?.price;
  if(event.acquisition==='purchase'&&Number.isFinite(price)){
   if(event.name.length>80)throw Error('計價商品名稱超過 80 字元，請縮短名稱。');
   const item={id:'narrative-'+orderId.slice(6),name:event.name,kind:known?.kind||event.kind,description:known?.description||event.description||'由使用者在正文中指定取得。',price,emoji:known?.emoji||'✦'};
   await purchase(item,orderId,{mirror:false,isCurrent:options.isCurrent});return {kind:item.kind,name:item.name,price,status:'purchased'};
  }
  const asset={kind:event.kind,name:event.name,description:event.description||(event.acquisition==='purchase'?'由正文於萬寶商城取得；未記載價格，未扣除虛擬餘額。':'由使用者明確加入長期記憶。'),quantity:1};
  await memory.recordAcquisition(asset,{id:orderId,isCurrent:options.isCurrent,source:event.acquisition==='purchase'?'正文取得・未記載價格':'使用者正文記憶'});emit();return {kind:asset.kind,name:asset.name,status:'recorded',unpriced:event.acquisition==='purchase'};
 }
 async function memoryAction(name,p={}){
  let value;
  if(name==='profile.save')value=await memory.saveProfile(p);
  else if(name==='entry.save')value=await memory.saveEntry(p.kind,p.entry||p);
  else if(name==='entry.delete')value=await memory.deleteEntry(p.kind,p.id,{revision:p.revision});
  else if(name==='options.save')value=await memory.saveOptions(p);
  else if(name==='worldbook.sync')value=await memory.syncWorldbook();
  else if(name==='wallet.import')value=await memory.importWallet();
  else if(name==='worldbook.export')return memory.exportWorldbook();
  else throw Error('不支援的個人記憶操作。');
  emit();return value||memory.state();
 }
 async function confirmPayment(threadId,eventId){
  const c=context(),scope=sourceScope(c);check(c,scope);
  const event=collectSourceEvents(c).events.find(e=>e.id===eventId&&e.app==='wechat'&&e._isUser&&['transfer','redpacket'].includes(e.action));
  if(!event)throw Error('原付款指令已變更或刪除，請重新整理。');
  const thread=await backend.chats.get(threadId);check(c,scope);
  const draft=thread?.messages?.find(m=>m.source?.scope===scope&&m.source.id===eventId&&m.from==='me');
  if(!draft||!String(draft.text).startsWith('[待確認付款]')&&!String(draft.text).startsWith('[已處理付款]'))throw Error('找不到這筆待確認付款。');
  if(event.group?thread.type!=='group'||thread.name!==event.group:thread.type!=='dm'||!thread.members?.includes(event.to))throw Error('付款對象不一致，請重新開啟。');
  const paymentId=await paymentKey(scope,event.id);check(c,scope);
  const result=await backend.sendPaid(threadId,{kind:event.action,amount:event.amount,text:event.text,paymentId},{isCurrent:()=>alive&&sourceScope(context())===scope&&context().chatMetadata===c.chatMetadata});
  check(c,scope);await syncNow();return result;
 }
 async function syncNow({retryNarrative=false}={}){
  const scope=sourceScope(context()),changed=scope!==photoScope;photoSyncs++;
  try{await memory.importWallet();await narrativeMemory.sync({retryErrors:retryNarrative});await source.sync();if(!alive||scope!==sourceScope(context()))return;
   if(changed){await photos.baseline();await activity.baseline();photoScope=scope;}else{await photos.autoReceive();await activity.sync();}
   if(activity.takeRenderRefresh?.()){
    const c=context();clearTimeout(renderTimer);renderTimer=setTimeout(()=>{
     if(!alive||sourceScope(context())!==scope||context().chat!==c.chat)return;
     const render=c.printMessages||c.reloadCurrentChat;
     if(typeof render==='function')Promise.resolve().then(()=>render.call(c)).catch(()=>notice('舊版論壇與商城卡片已整理，請重新整理頁面更新顯示。'));
     else notice('舊版論壇與商城卡片已整理，請重新整理頁面更新顯示。');
    },0);
   }
   emit();
  }finally{photoSyncs--;}
 }
 return {api:()=>({pocketState:state,pocketImageState:async()=>imagePresets.state(),...photos.api(),
  pocketContactProfile:async name=>contacts.profile(name),pocketContactProfiles:async()=>contacts.profiles(),pocketSaveContactProfile:(name,value)=>contacts.save(name,value),
  pocketConfirmPayment:confirmPayment,pocketPurchase:purchase,
  pocketMemoryState:async()=>{await memory.importWallet();return memory.state();},pocketMemoryAction:memoryAction,
  pocketArchiveState:query=>activity.memoryState(query),pocketArchiveAction:archiveAction,
  pocketResolvePhoto:(threadId,messageId,options)=>photos.api().pocketResolvePhoto(threadId,messageId,options),
  pocketAction:(name,p)=>{const c=context(),scope=sourceScope(c);const run=actionQueue.then(()=>action(name,p,c,scope));actionQueue=run.catch(()=>{});return run;}}),
  sync:syncNow,memoryState:()=>memory.state(),promptPlan:({query:override}={})=>{if(!sourceScope(context()))return [];const c=context(),plan=[],query=typeof override==='string'?override:memoryQuery(c),facts=memory.contextText(query),refs=referenceFacts(query),archive=activity.recall(query);if(refs)plan.push({key:'sttts.entry.references',text:refs,position:1,depth:0,role:0});if(facts)plan.push({key:'sttts.entry.memory',text:facts,position:1,depth:1,role:0});if(archive)plan.push({key:'sttts.entry.archive',text:archive,position:1,depth:1,role:0});if(config().inject)plan.push({key:'sttts.entry.pocket',text:PHONE_PROMPT+'\n'+sharedPhoneText(c),position:1,depth:1,role:0});return plan;},
  dispose(){alive=false;clearTimeout(renderTimer);source.dispose();photoUnsubscribe?.();photos.dispose();activity.dispose();narrativeMemory.dispose();memory.dispose?.();forumSource.dispose();contacts.dispose();backend.generateText=original;},status:()=>source.status()};
}
