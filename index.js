import './core/compat.js';
import {createPocketHost} from './pocket/host.js';
import {createCharacterStateRuntime,stripCharacterStateUpdates} from './pocket/csb-runtime.js';
import {renderPhoneCards} from './pocket/cards.js';
import {renderMemoryMentions} from './pocket/mentions.js';
import {createMemoryComposer} from './pocket/composer.js';
import {invalidatePhoneWorldbooks} from './pocket/services.js';
import { PhoneBackend } from './core/backend.js';
import { NAMESPACE } from './core/state.js';
import { parseDialogue,knownFormats } from './core/protocol.js';
import { FloatingLauncher } from './core/floating.js';
import { renderPictures, drawPromptPlan } from './core/draw.js';
import { outgoingChat } from './core/outgoing.js';
import { cleanNarrativeText } from './core/narrative-text.js';
import { createPictureHost } from './host-pictures.js';
import { createChatHost } from './host-chat.js';
import { createMomentsHost } from './host-moments.js';
import { loreBooks } from './host-lore.js';
import { createAppsHost } from './host-apps.js';
import { createCallHost } from './host-call.js';
import { TIER_NAMES } from './core/novelai.js';
const base=new URL('.',import.meta.url),marker=globalThis.crypto?.randomUUID?.()||'unavailable';
let active=false,hooked=false,settings,panel,frame,observer,renderTimer,floating,backend,enabling;
let pocket=null,phoneCommand=false,memoryComposer=null,memoryUnsubscribe=null,characterStateRuntime=null,characterStateChanged=null,characterStateTimer=0;
let pictures=null,chats=null,momentsHost=null,appsHost=null,callHost=null,pendingDraw=null,legacy=false;
const listeners=[],prompts=new Set();
// Every copy of the plugin that loads adds its folder here, so the self-check can tell when it is installed twice.
(globalThis.__stIphonieCopies??=new Set()).add(decodeURIComponent(base.pathname.replace(/\/$/,'').split('/').pop()));
// The latest notices and errors, for the self-check.
const recent=[];function remember(message,kind='notice'){recent.push({at:Date.now(),kind,message:String(message||'').slice(0,300)});if(recent.length>12)recent.shift();}
const context=()=>globalThis.SillyTavern?.getContext();
// Clean only request copies; saved story messages are kept intact.
globalThis.stIphonieInterceptor=async function(chat,...args){if(!active)return;await characterStateRuntime?.intercept(chat,...args);let list=[];try{list=formats();}catch{}outgoingChat(chat,{pictures:settings?.draw?.strip!==false,voice:true,keepLatest:false,formats:list});};
// A call while the phone is closed: a note that stays until answered, and a tap on it opens the phone on the call.
function ringing(name){if(panel?.open)return;remember(name+' 來電');const open=()=>openPanel();if(globalThis.toastr)globalThis.toastr.info('點這裡開啟傳音玉符接聽',`📞 ${name} 來電`,{timeOut:settings?.calls?.ring*1000||30000,extendedTimeOut:0,tapToDismiss:true,onclick:open});else console.info('[傳音玉符]',name+' 來電');}
// The tavern's own avatars, for the phone: each character card's picture by name, and the current persona's.
let personas=null;import(new URL('../../../personas.js',import.meta.url).href).then(m=>{personas=m;}).catch(()=>{});
// 智绘姬 (st-chatu8) keeps its vibes in its own settings (vibePresets: single vibes, vibeGroups) and storage: a file on the
// tavern (configImageStorage[id].path) or its IndexedDB (chatu8_config_images / config_images). Reading them the same
// way brings every vibe and group over at once, in the form its own export uses. Nothing of 智绘姬's is changed.
const CHATU8='st-chatu8';
function chatu8Count(){const s=context()?.extensionSettings?.[CHATU8];return s?Object.keys(s.vibePresets||{}).length+Object.keys(s.vibeGroups||{}).length:0;}
function chatu8Text(value){
 if(value==null)return '';if(value instanceof ArrayBuffer)return new TextDecoder().decode(new Uint8Array(value));
 if(typeof value==='object')return value.data!==undefined?chatu8Text(value.data):JSON.stringify(value);
 let text=String(value).trim();const bytes=b=>new TextDecoder().decode(Uint8Array.from(atob(b),c=>c.charCodeAt(0)));
 if(text.startsWith('data:')){const at=text.indexOf(','),meta=text.slice(5,at),body=text.slice(at+1);try{text=meta.includes(';base64')?bytes(body):decodeURIComponent(body);}catch{return '';}}
 else if(!text.startsWith('{')&&!text.startsWith('[')){try{text=bytes(text);}catch{}}
 return text;}
/** 智绘姬's IndexedDB, opened read-only; null when it is not there (an upgrade is aborted, so none is created). */
function chatu8Database(){return new Promise(resolve=>{let req;try{req=indexedDB.open('chatu8_config_images');}catch{resolve(null);return;}
 req.onupgradeneeded=()=>{try{req.transaction.abort();}catch{}};req.onerror=()=>resolve(null);req.onblocked=()=>resolve(null);
 req.onsuccess=()=>{const db=req.result;if(!db.objectStoreNames.contains('config_images')){db.close();resolve(null);}else resolve(db);};});}
function chatu8Read(db,id){return new Promise(resolve=>{try{const r=db.transaction('config_images','readonly').objectStore('config_images').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve(null);}catch{resolve(null);}});}
async function chatu8Vibes(){
 const s=context()?.extensionSettings?.[CHATU8];
 if(!s)throw Error('沒有找到智繪姬（st-chatu8）：要在裝著智繪姬的同一個酒館裡匯入');
 const presets=s.vibePresets||{},groups=s.vibeGroups||{},storage=s.configImageStorage||{};
 const ids=new Set([...Object.values(presets).map(p=>p?.vibeDataId),...Object.values(groups).flatMap(g=>(Array.isArray(g?.vibes)?g.vibes:[]).map(v=>v?.vibeDataId))].filter(id=>typeof id==='string'&&id));
 if(!ids.size)throw Error('智繪姬裡還沒有 Vibe');
 const db=await chatu8Database(),vibeData={};
 try{for(const id of ids){
  let text='';const path=storage[id]?.path;
  if(typeof path==='string'&&path.startsWith('/')){try{const r=await fetch(path);if(r.ok)text=chatu8Text(await r.text());}catch{}}
  if(!text&&db)text=chatu8Text(await chatu8Read(db,id));
  try{if(text)vibeData[id]=JSON.parse(text);}catch{}}}
 finally{db?.close();}
 if(!Object.keys(vibeData).length)throw Error('讀不到智繪姬裡的 Vibe 資料（可能存在別的瀏覽器裡）：請在智繪姬裡匯出後再匯入檔案');
 return {groups,vibeData,vibePresets:presets};}
/** 分区: the character card (or group) open in the tavern, {key, name, members}; key '' when none is open. */
function openSpace(){const ctx=context();if(ctx?.groupId!==undefined&&ctx?.groupId!==null&&ctx.groupId!==''){const g=ctx.groups?.find(x=>String(x?.id)===String(ctx.groupId));const members=(g?.members||[]).map(a=>ctx.characters?.find(c=>c?.avatar===a)?.name).filter(Boolean);return {key:'group:'+ctx.groupId,name:g?.name||'群聊',members};}
 const c=ctx?.characters?.[ctx?.characterId];return c?.avatar?{key:'card:'+c.avatar,name:c.name||'',members:[c.name].filter(Boolean)}:{key:'',name:'',members:[]};}
/** The roles speaking in these story messages belong to the open card's contacts. */
function tagSpeakers(messages){if(!active)return;const key=openSpace().key,names=new Set();if(!key)return;for(const m of messages){if(!m||m.is_user||m.is_system)continue;for(const line of parsed(String(m.mes||''))?.lines||[])if(line.role)names.add(line.role);}try{backend.tagRoles([...names],key);}catch{}}
/** A chat was opened: the phone follows the card, and the card's story speakers become its contacts. */
function spaceChanged(){if(!active||!backend)return;memoryComposer?.close();try{backend.setSpace(openSpace());tagSpeakers((context()?.chat||[]).slice(-200));}catch{}}
function tavernAvatars(){const ctx=context(),thumb=(type,file)=>typeof ctx?.getThumbnailUrl==='function'?ctx.getThumbnailUrl(type,file):`/thumbnail?type=${type}&file=${encodeURIComponent(file)}`,characters={};
 for(const c of ctx?.characters||[])if(c?.name&&c.avatar&&c.avatar!=='none'&&!characters[c.name])characters[c.name]=thumb('avatar',c.avatar);
 const persona=personas?.user_avatar;return {me:persona?thumb('persona',persona):'',characters};}
// 保存到酒馆: the tavern user's own files (data/<user>/user/files), through the tavern's file API with its request headers.
function tavernFiles(){const headers=()=>({'Content-Type':'application/json',...(context()?.getRequestHeaders?.()||{})});
 const base64=async blob=>{const bytes=new Uint8Array(await blob.arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=0x8000)text+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(text);};
 return {async read(name,{blob=false}={}){const r=await fetch('/user/files/'+encodeURIComponent(name),{cache:'no-store'});if(r.status===404)return null;if(!r.ok)throw Error(`讀不到酒館裡的 ${name}（${r.status}）`);return blob?r.blob():r.text();},
  async write(name,data){const r=await fetch('/api/files/upload',{method:'POST',headers:headers(),body:JSON.stringify({name,data:await base64(data instanceof Blob?data:new Blob([data]))})});if(!r.ok)throw Error(`酒館沒有存上 ${name}（${r.status}${r.status===413?'，檔案太大':''}）`);},
  async remove(name){const r=await fetch('/api/files/delete',{method:'POST',headers:headers(),body:JSON.stringify({path:'user/files/'+name})});if(!r.ok&&r.status!==404)throw Error(`刪不掉酒館裡的 ${name}（${r.status}）`);}};}
const deviceName=()=>(/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent||'')?'手機':'電腦')+' · '+browserName();
// Leaving the page (or switching away on a phone) saves what is waiting, so the other device sees it.
function flushSync(){if(document.visibilityState==='hidden'&&backend?.syncState?.pending)backend.syncNow().catch(()=>{});}
function notice(message){remember(message);if(globalThis.toastr)globalThis.toastr.info(message,'傳音玉符');else console.info('[傳音玉符]',message);}
function formats(){return knownFormats(settings);}
// Legacy speech copies become plain narrative; picture and character cards retain their renderers.
function transform(text,meta={}){if(context()?.extensionSettings?.csb_character_state_v1?.enabled!==false&&globalThis.csbCharacterStateIntercept)text=stripCharacterStateUpdates(text);text=cleanNarrativeText(text,formats(),{html:true});const c=context(),m=c?.chat?.[meta.messageId];const out=renderPictures(renderPhoneCards(text,{isUser:!!meta.isUser,userName:c?.name1||'我',characterName:m?.name||c?.name2||'角色',messageKey:m?.extra?.tavern_pocket_source_id||String(meta.messageId??''),legacyLineIds:!!m?.extra?.tavern_pocket_source_id&&m?.extra?.tavern_pocket_parser_version!==7}),marker);return renderMemoryMentions(out);}
const dialogueCache=new Map();let dialogueCacheSize=0,dialogueFormatKey='';
function parsed(message){
 const value=String(message||''),list=formats(),key=JSON.stringify(list);
 if(key!==dialogueFormatKey){dialogueCache.clear();dialogueCacheSize=0;dialogueFormatKey=key;}
 if(dialogueCache.has(value))return dialogueCache.get(value);
 let result={format:list[0],lines:[]};
 for(const format of list){try{const lines=parseDialogue(value,format);if(lines.length){result={format,lines};break;}}catch{}}
 if(value.length<=200000){while(dialogueCache.size>=128||dialogueCacheSize+value.length>2000000){const first=dialogueCache.keys().next().value;if(first===undefined)break;dialogueCache.delete(first);dialogueCacheSize-=first.length;}dialogueCache.set(value,result);dialogueCacheSize+=value.length;}
 return result;
}
function clearPrompts(){const ctx=context();if(!ctx)return;for(const key of Object.keys(ctx.extensionPrompts||{})){if(key.startsWith('sttts.entry.'))ctx.setExtensionPrompt(key,'',-1,0);}prompts.clear();}
// Who may speak in this reply: the chat's character (all members in a group), anyone who spoke with a voice tag in the
// last 8 messages, and anyone named in the last 3. Reading rules and the language line are written only for them.
function speakers(){const ctx=context(),names=new Set(),add=n=>{if(n&&String(n).trim())names.add(String(n).trim());};if(!ctx)return [];add(ctx.name2);
 if(ctx.groupId){const group=ctx.groups?.find(g=>g.id===ctx.groupId);for(const member of group?.members||[])add(ctx.characters?.find(c=>c.avatar===member)?.name);}
 const recent=(ctx.chat||[]).filter(m=>m&&!m.is_system).slice(-8);for(const m of recent){if(!m.is_user)add(m.name);for(const line of parsed(m.mes||'').lines)add(line.role);}
 const text=recent.slice(-3).map(m=>m.mes||'').join('\n');for(const r of settings.routes)if(r.name&&text.includes(r.name))add(r.name);return [...names];}
function inject(type,options,dryRun){clearPrompts();if(!active)return;const only=speakers();const draft=options&&!dryRun&&!options.automatic_trigger&&!['regenerate','swipe','quiet','impersonate','continue'].includes(type)?document.querySelector('#send_textarea')?.value:undefined;for(const p of [{key:'sttts.entry.narrative',text:'正文使用普通敘事與台詞。每句台詞只寫一次，不另附朗讀副本，不輸出 TTS 或語音標籤。',position:1,depth:0,role:0},...drawPromptPlan(settings,undefined,only),...(chats?.bringPlan(typeof type==='string'?type:'',dryRun===true)||[]),...(pocket?.promptPlan({query:draft?.trim()?draft:undefined})||[])]){context().setExtensionPrompt(p.key,p.text,p.position,p.depth,false,p.role);prompts.add(p.key);}}
function persist(next){return backend.save(next);}
function storeSettings(next){settings=next;context().extensionSettings[NAMESPACE]=structuredClone(next);context().saveSettingsDebounced();if(active){inject();syncFloating();scheduleRender();}}
function currentMessage(id){const ctx=context(),message=ctx.chat[id];if(!message||message.is_user||message.is_system)return null;return {message,chat:ctx.getCurrentChatId?.()??ctx.chatId,id,raw:message.mes,swipe:message.swipe_id};}
const streaming=()=>{const p=context()?.streamingProcessor;return !!p&&!p.isFinished&&!p.isStopped;};
// Throttled so other extensions cannot postpone picture decoration forever.
// 酒馆助手 and the like turn code blocks into live frontends after a message is drawn (wrapping its <pre>) and do not watch later redraws.
// Our redraws never change code blocks, so the wrappers go back onto the same blocks; if they cannot be matched, that one message is announced as updated.
function keepFrontends(id,redraw){const box=()=>document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`),before=box();
 const wraps=before?[...before.querySelectorAll('pre')].map(pre=>{const w=pre.parentElement;return w&&w!==before&&w.parentElement===before?w:null;}):[],had=before?before.querySelectorAll('iframe').length:0;
 redraw();const after=box();if(!after||!had)return;const pres=[...after.querySelectorAll('pre')];
 if(pres.length===wraps.length)wraps.forEach((w,i)=>{if(w&&pres[i].parentElement===after)pres[i].replaceWith(w);});
 if(after.querySelectorAll('iframe').length<had){const ctx=context();ctx.eventSource?.emit(ctx.eventTypes.MESSAGE_UPDATED,id);}}
function redrawMessage(id,message){keepFrontends(id,()=>context().updateMessageBlock(id,message));}
function scheduleRender(){if(renderTimer)return;renderTimer=setTimeout(()=>{renderTimer=0;decorate();},40);}
/** Only changes that bring in (or take away) messages or our own marks are worth a redraw. */
const ours=node=>node.nodeType===1&&(node.matches?.('.mes,[data-sttts-token]')||!!node.querySelector?.('[data-sttts-token],.mes'));
// Keep completed pictures through streaming redraws without reloading them.
const drawnIn=r=>r.target.closest?.('.mes[mesid]')?.getAttribute('mesid');
const ownedIn=n=>n.nodeType!==1?[]:[n,...n.querySelectorAll('[data-sttts-pic]')].filter(el=>el.dataset?.stttsToken===marker&&el.hasAttribute('data-sttts-pic'));
function carryOver(records){const pics=new Map();for(const r of records){const id=drawnIn(r);if(id==null)continue;for(const n of r.removedNodes)for(const el of ownedIn(n))if(el.dataset.stttsRendered)pics.set(id+':'+el.dataset.stttsHash,el);}if(!pics.size)return;for(const r of records){const id=drawnIn(r);if(id==null)continue;for(const n of r.addedNodes){if(!n.isConnected)continue;for(const el of ownedIn(n)){const key=id+':'+el.dataset.stttsHash,old=pics.get(key);if(old&&!el.dataset.stttsRendered){pics.delete(key);el.replaceWith(old);}}}}}
const externalCharacterState=()=>typeof globalThis.csbCharacterStateIntercept==='function'&&!characterStateRuntime?.owns();
function chatChanged(records){try{carryOver(records);}catch{}if(records.some(r=>[...r.addedNodes,...r.removedNodes].some(ours)||(legacy||externalCharacterState())&&redrawn(r.target)))scheduleRender();}
// SillyTavern before 1.19 has no message formatter hook. There a reply is drawn again after the tavern draws it: the
// transformed text goes through the tavern's own formatting (the steps the hook runs in), and the first node drawn is
// remembered, so a later redraw by the tavern (edit, swipe, other extensions) is noticed and drawn again.
const liveId=()=>streaming()?context().chat.length-1:-1;
const redrawn=t=>t.nodeType===1&&t.classList.contains('mes_text')&&Number(t.closest('.mes')?.getAttribute('mesid'))!==liveId();
function legacyFormat(){if(!legacy&&!externalCharacterState())return;const ctx=context(),live=liveId();for(const element of document.querySelectorAll('#chat .mes[mesid]')){const id=Number(element.getAttribute('mesid')),message=ctx.chat[id],box=element.querySelector('.mes_text');if(!box||!message||message.is_system||id===live||box.querySelector('textarea'))continue;const raw=message.extra?.display_text||message.mes||'',drawn=box.stttsDrawn;if(!legacy&&!raw.includes('<CSB_UPDATE>'))continue;if(drawn&&drawn.raw===raw&&drawn.node?.parentNode===box)continue;let out;try{out=transform(raw,{isUser:!!message.is_user,messageId:id});}catch{continue;}if(out===raw)continue;keepFrontends(id,()=>{box.innerHTML=ctx.messageFormatting(out,message.name,message.is_system,message.is_user,id,message.extra?.uses_system_ui?{MESSAGE_ALLOW_SYSTEM_UI:true}:{},false);});box.stttsDrawn={raw,node:box.firstChild};}}
function decorate(){if(!active)return;legacyFormat();pictures?.decorate(currentMessage);document.querySelectorAll('#chat [data-sttts-owned="toolbar"],#chat [data-sttts-owned="lint"]').forEach(el=>el.remove());}
/** How much of localStorage (≈5 MB per address, shared by the tavern and every extension) is used; null when it cannot be read. */
function localStorageSize(){try{let bytes=0;for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);bytes+=(k.length+(localStorage.getItem(k)||'').length)*2;}return {bytes,items:localStorage.length};}catch{return null;}}
/** Facts for the self-check (core/diagnostics.js makes the report). Keys are only asked whether they work, never read. */
async function diagnose(){const ctx=context(),s=settings,json=url=>fetch(url,{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null);
 const [manifest,version,storage]=await Promise.all([json(new URL('manifest.json',base)),json('/version'),navigator.storage?.estimate?.().catch(()=>null)]);
 const keys={};for(const engine of ['nai','gpt']){const k={set:!!backend.keyStatus(engine),needed:s.draw?.enabled&&s.draw.engine===engine?'正文出圖開著，繪圖用的是它':''};if(k.set&&engine==='nai'){try{const sub=await backend.naiSubscription();k.detail=sub?`${TIER_NAMES[sub.tier]||'訂閱'}${sub.active?'':'（未啟用）'}${sub.anlas!==undefined?' · Anlas '+sub.anlas:''}`:'';k.check='ok';}catch(e){k.check='error';k.detail=e.message;}}if(k.set||k.needed)keys[engine]=k;}
 let reply=null;for(let i=ctx.chat.length-1;i>=0&&!reply;i--){const m=ctx.chat[i];if(!m||m.is_user||m.is_system)continue;const element=document.querySelector(`#chat .mes[mesid="${i}"]`);reply={id:i,name:m.name||'',inChat:!!element,iframes:element?element.querySelectorAll('iframe').length:0,streaming:i===liveId()};}
 return {at:Date.now(),plugin:{version:manifest?.version||'',copies:[...globalThis.__stIphonieCopies],oldCopy:!!globalThis.__stTtsPanelBridge},tavern:{version:version?.pkgVersion||'',mode:legacy?'legacy':'hook'},browser:{secure:globalThis.isSecureContext!==false,indexedDB:!!globalThis.indexedDB,storage:storage?.quota?{usage:storage.usage,quota:storage.quota}:null,localStorage:localStorageSize(),keys:backend?.keyStore?.fallback?'localStorage':'indexedDB',agent:browserName()},extensions:thirdParty(),characters:{count:s.routes.length},voice:{enabled:false,removed:true,roles:[]},keys,draw:{engine:s.draw?.engine||'nai',enabled:!!s.draw?.enabled,comfy:s.draw?.engine==='comfy'?{url:s.draw.comfy.url,model:s.draw.comfy.model,workflow:!!s.draw.comfy.workflow}:null},reply,errors:recent.slice()};}
function thirdParty(){const names=new Set();for(const el of document.querySelectorAll('script[src*="/extensions/third-party/"],link[href*="/extensions/third-party/"]')){const m=/\/extensions\/third-party\/([^/]+)\//.exec(el.src||el.href);if(m)names.add(decodeURIComponent(m[1]));}return [...names];}
function browserName(){const ua=navigator.userAgent||'',b=(/(Edg|OPR|Firefox|Chrome)\/(\d+)/.exec(ua)||[]).slice(1).join(' ')||(/Version\/(\d+).*Safari/.test(ua)?'Safari '+/Version\/(\d+)/.exec(ua)[1]:''),os=/Android/.test(ua)?'Android':/iPhone|iPad/.test(ua)?'iOS':/Windows/.test(ua)?'Windows':/Mac OS/.test(ua)?'macOS':/Linux/.test(ua)?'Linux':'';return [b.replace('Edg','Edge').replace('OPR','Opera'),os].filter(Boolean).join(' · ');}
function rerender(){const ctx=context();document.querySelectorAll('#chat .mes[mesid]').forEach(el=>{const id=Number(el.getAttribute('mesid'));if(ctx.chat[id])redrawMessage(id,ctx.chat[id]);});scheduleRender();}
// On a computer the phone floats beside the story: no backdrop, the story stays readable and clickable, the phone is
// dragged by its top bar, comes in three sizes, and stays where it was left. On a phone it is full screen as before.
// Sizes: a share of the window's height, at most this tall, so 小/中/大 differ on any screen.
const PANEL_KEY='st-iphonie-panel',PANEL_SIZES={s:[600,.7],m:[740,.85],l:[880,1]},PANEL_NAMES={s:'小',m:'中',l:'大'};
const fullScreen=()=>matchMedia('(pointer: coarse) and (max-width: 540px), (max-width: 360px)').matches;
let place=(()=>{try{return JSON.parse(localStorage.getItem(PANEL_KEY)||'null')||{};}catch{return {};}})(),drag=null;
const keepPlace=()=>{try{localStorage.setItem(PANEL_KEY,JSON.stringify(place));}catch{}};
// The phone inside is always laid out at one design size and scaled to the chosen size, so a small phone is the same
// phone, smaller, instead of a squeezed one.
const DESIGN_H=760,DESIGN_W=Math.round((DESIGN_H-54)*390/844+18);
function placePanel(){if(!panel)return;const float=!fullScreen();panel.classList.toggle('floating',float);if(!float){for(const k of ['left','top','width','height'])panel.style.removeProperty(k);if(frame)for(const k of ['width','height','transform'])frame.style.removeProperty(k);return;}
 const [most,share]=PANEL_SIZES[place.size]||PANEL_SIZES.m,h=Math.round(Math.min(most,(innerHeight-16)*share)),scale=h/DESIGN_H,w=Math.round(DESIGN_W*scale);
 if(frame)Object.assign(frame.style,{width:DESIGN_W+'px',height:DESIGN_H+'px',transform:`scale(${scale})`});
 const x=Math.min(Math.max(8,place.x??innerWidth-w-24),Math.max(8,innerWidth-w-8)),y=Math.min(Math.max(8,place.y??(innerHeight-h)/2),Math.max(8,innerHeight-h-8));
 Object.assign(panel.style,{width:w+'px',height:h+'px',left:Math.round(x)+'px',top:Math.round(y)+'px'});}
/** Dragging from the phone's top bar (inside the frame), in screen coordinates so the moving frame does not matter. */
function panelDrag(phase,sx,sy){if(!panel?.classList.contains('floating'))return false;const r=panel.getBoundingClientRect();
 if(phase==='start')drag={sx,sy,x:r.left,y:r.top};
 else if(phase==='move'&&drag){place.x=drag.x+sx-drag.sx;place.y=drag.y+sy-drag.sy;placePanel();}
 else if(phase==='end'){drag=null;place.x=r.left;place.y=r.top;keepPlace();}
 else if(phase==='reset'){delete place.x;delete place.y;keepPlace();placePanel();}
 return true;}
function panelSize(){const order=['s','m','l'],next=order[(order.indexOf(place.size||'m')+1)%3],r=panel?.getBoundingClientRect();
 // Grows and shrinks around the top-right corner, so the phone does not jump away from where it was put.
 if(r){const before=r.right;place.size=next;placePanel();const after=panel.getBoundingClientRect();place.x=after.left-(after.right-before);place.y=r.top;}else place.size=next;
 placePanel();keepPlace();return PANEL_NAMES[next];}
function panelResized(){if(!panel?.open)return;const float=!fullScreen();if(float!==panel.classList.contains('floating')){panel.close();openPanel();}else placePanel();}
// Older ST-TTS copies publish __stTtsPanelBridge (this one no longer does): both running doubles the waves and prompts.
let oldCopyNoted=false;
function openPanel(roleId){floating?.setMode('docked');if(globalThis.__stTtsPanelBridge&&!oldCopyNoted){oldCopyNoted=true;notice('這個酒館裡還裝著舊版「ST-TTS · 角色對白」，會和 傳音玉符 互相干擾：請在擴充套件管理裡刪除它，然後重新整理頁面');}if(settings?.sync?.enabled&&!panel?.open)backend?.syncNow().catch(()=>{});if(!panel){panel=document.createElement('dialog');panel.id='sttts-panel';panel.setAttribute('aria-label','傳音玉符');frame=document.createElement('iframe');frame.title='傳音玉符';frame.src=new URL('ui/index.html',base).href;panel.append(frame);panel.addEventListener('close',()=>frame?.contentWindow?.stTtsPanelVisibility?.(false));document.body.append(panel);}if(!panel.open){placePanel();if(panel.classList.contains('floating'))panel.show();else panel.showModal();frame.contentWindow?.stTtsPanelVisibility?.(true);}if(roleId)frame.contentWindow?.stTtsOpenRole?.(roleId);}
function connect(source){
 if(!active||source!==frame?.contentWindow)throw Error('設定頁面未連線');
 const owner=backend,api=owner.api();
 const check=()=>{if(!active||backend!==owner||owner.closed||source!==frame?.contentWindow)throw Error('設定頁面已失效，請重新開啟');};
 return Object.freeze({...api,
  characterInfoSnapshot:()=>{check();return characterStateRuntime.snapshot();},
  mountCharacterInfo:(container,options)=>{check();if(container?.ownerDocument!==source.document)throw Error('角色信息容器不屬於目前玉符介面。');return characterStateRuntime.mount(container,options);},
  setCharacterInfoInline:(enabled,options)=>{check();return characterStateRuntime.setInline(enabled,options);},
  pocketOptimizePhoto:(threadId,messageId,options)=>{check();return pocket.api().pocketOptimizePhoto(threadId,messageId,options);},
  pocketContactProfiles:()=>{check();return pocket.api().pocketContactProfiles();},
  pocketOpenContactState:async(name,revision)=>{check();const result=await pocket.api().pocketOpenContactState(name,revision);panel?.close();return result;},
  pocketOpenStateManager:async()=>{check();const result=await pocket.api().pocketOpenStateManager();panel?.close();return result;},
  pocketSaveContactProfile:(name,value)=>{check();return pocket.api().pocketSaveContactProfile(name,value);},
  pocketConfirmPayment:(threadId,eventId)=>{check();return pocket.api().pocketConfirmPayment(threadId,eventId);},
  pocketState:()=>{check();return pocket.api().pocketState();},
  setStoryTime:value=>{check();return pocket.api().setStoryTime(value);},
  pocketPurchase:(item,orderId)=>{check();return pocket.api().pocketPurchase(item,orderId);},
  pocketMemoryState:()=>{check();return pocket.api().pocketMemoryState();},
  pocketMemoryAction:(name,payload)=>{check();return pocket.api().pocketMemoryAction(name,payload);},
  pocketArchiveState:query=>{check();return pocket.api().pocketArchiveState(query);},
  pocketArchiveAction:name=>{check();return pocket.api().pocketArchiveAction(name);},
  pocketContactProfile:name=>{check();return pocket.api().pocketContactProfile(name);},
  pocketResolvePhoto:(threadId,messageId,options)=>{check();return pocket.api().pocketResolvePhoto(threadId,messageId,options);},
  pocketImageState:()=>{check();return pocket.api().pocketImageState();},
  pocketPhotoDraft:(threadId,messageId)=>{check();return pocket.api().pocketPhotoDraft(threadId,messageId);},
  pocketEditPhoto:(threadId,messageId,options)=>{check();return pocket.api().pocketEditPhoto(threadId,messageId,options);},
  pocketAction:(name,payload)=>{check();return pocket.api().pocketAction(name,payload);},
  save:(next,revision)=>{check();return api.save({...next,floating:settings.floating},revision);},
  close:()=>{check();panel?.close();},
  recentMessages:()=>{check();return pictures.recentMessages();},
  insertImage:(id,photoId)=>{check();return pictures.insertImage(id,photoId);},
  suggestPrompt:()=>{check();return pictures.suggestPrompt();},
  chatPictureStats:()=>{check();return pictures.pictureStats();},
  planLatestPictures:()=>{check();return pictures.planLatest();},
  clearChatPictures:()=>{check();return pictures.clearPictures();},
  takeDraw:()=>{check();const value=pendingDraw;pendingDraw=null;return value;},
  chatReply:threadId=>{check();return chats.reply(threadId);},
  chatBring:(threadId,ids)=>{check();return chats.bring(threadId,ids);},
  chatPendingBring:()=>{check();return chats.pendingBring();},
  chatCancelBring:()=>{check();chats.cancelBring();},
  chatTyping:threadId=>{check();return chats.typing(threadId);},
  momentsRefresh:()=>{check();return momentsHost.refresh();},
  momentsReact:id=>{check();return momentsHost.react(id);},
  momentsReply:(id,commentId)=>{check();return momentsHost.reply(id,commentId);},
  momentsDrawImage:(id,allowPaid)=>{check();return momentsHost.drawImage(id,{allowPaid});},
  momentsBusy:()=>{check();return momentsHost.busy();},
  forumRefresh:()=>{check();return appsHost.forumRefresh();},
  forumReact:id=>{check();return appsHost.forumReact(id);},
  forumReply:(id,replyId)=>{check();return appsHost.forumReply(id,replyId);},
  forumBusy:()=>{check();return appsHost.busy('forum');},
  peekLook:name=>{check();return appsHost.peekLook(name);},
  peekBusy:()=>{check();return appsHost.busy('peek');},
  peekDraw:(name,index,allowPaid)=>{check();return appsHost.peekDraw(name,index,{allowPaid});},
  callStatus:()=>{check();return callHost.status();},
  callDial:name=>{check();return callHost.dial(name);},
  callAnswer:()=>{check();return callHost.answer();},
  callDecline:()=>{check();return callHost.decline();},
  callHangup:()=>{check();return callHost.hangup();},
  callSay:text=>{check();return callHost.say(text);},
  callReply:()=>{check();return callHost.reply();},
  callRetry:()=>{check();return callHost.retry();},
  diagnose:()=>{check();return diagnose();},
  tavernAvatars:()=>{check();return tavernAvatars();},
  chatu8Vibes:()=>{check();return chatu8Count();},
  loreBooks:async()=>{check();return loreBooks(context);},
  importChatu8:async()=>{check();return owner.importVibes([new File([JSON.stringify(await chatu8Vibes())],'智繪姬.json',{type:'application/json'})],{names:true});},
  panelFloating:()=>{check();return !!panel?.classList.contains('floating');},
  panelDrag:(phase,sx,sy)=>{check();return panelDrag(phase,sx,sy);},
  panelSize:()=>{check();return panelSize();},
  panelSizeName:()=>{check();return PANEL_NAMES[place.size||'m'];},
  userName:()=>{check();return context()?.name1||'';},
  exportBackup:async(parts,options)=>{check();const manifest=await fetch(new URL('manifest.json',base)).then(r=>r.ok?r.json():null).catch(()=>null);return api.exportBackup(parts,manifest?.version||'',options);},
  noteError:text=>{check();remember(text,'error');}
 });
}
// Picture clicks are captured before host themes can swallow them.
function click(event){if(active)pictures?.click(event);}
function mountEntry(){const mount=document.querySelector('#extensions_settings');if(!mount)return;const entry=document.createElement('div');entry.id='sttts-extension-entry';entry.innerHTML='<div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header" id="sttts-entry-header" tabindex="0"><b>傳音玉符 v0.13.1</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><button type="button" id="sttts-open" class="menu_button">開啟傳音玉符</button></div></div>';entry.querySelector('#sttts-open').addEventListener('click',()=>openPanel());entry.querySelector('#sttts-entry-header').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.currentTarget.click();}});mount.append(entry);}
function syncFloating(){if(!active)return;if(!settings.general.floatingEnabled){floating?.destroy();floating=null;return;}if(floating){floating.applyTheme();return;}floating=new FloatingLauncher({openSettings:()=>openPanel(),position:settings.floating,savePosition:p=>{settings.floating=p;persist(settings);},theme:()=>settings.theme});}
async function enableInternal(){if(active)return;const ctx=context();// generateRaw joined the context in 1.13.2, which also ignores minimum_client_version: this keeps older taverns out.
 if(!ctx?.setExtensionPrompt||!ctx.generateRaw||!(ctx.messageFormatter?.addHook||ctx.messageFormatting)||!ctx.updateMessageBlock||!ctx.eventSource?.on||!ctx.eventSource?.removeListener||!ctx.eventTypes||!ctx.extensionSettings||!ctx.saveSettingsDebounced){notice('傳音玉符 需要 SillyTavern 1.13.2 或更新版本');return;}if(!globalThis.crypto?.getRandomValues||!globalThis.crypto?.randomUUID){notice('當前瀏覽器缺少隨機數功能，請更新瀏覽器');return;}backend=new PhoneBackend({settings:ctx.extensionSettings[NAMESPACE],persist:storeSettings,notify:notice});settings=backend.settings;pictures=createPictureHost({context,redrawMessage,settings:()=>settings,backend,marker,scheduleRender,notice,openDraw:payload=>{pendingDraw=payload;openPanel();frame?.contentWindow?.stTtsOpenDraw?.();}});callHost=createCallHost({context,settings:()=>settings,backend,notice,ringing});chats=createChatHost({context,settings:()=>settings,backend,notice,onCall:(name,reason)=>{try{callHost.ring(name,{reason});}catch{}}});momentsHost=createMomentsHost({context,settings:()=>settings,backend,notice});appsHost=createAppsHost({context,settings:()=>settings,backend});await backend.initialize();characterStateRuntime=createCharacterStateRuntime({context,notice,formatMessage:(text,meta)=>context().messageFormatting(transform(text,meta),meta.message.name,meta.message.is_system,meta.message.is_user,meta.messageId,{},false)});await characterStateRuntime.start().catch(e=>notice('角色狀態工坊啟動失敗：'+e.message));pocket=createPocketHost({context,backend,notice,openStateEditor:info=>characterStateRuntime.open(info),openStateManager:()=>characterStateRuntime.open()});backend.setSyncFiles(tavernFiles());backend.syncDeviceName=deviceName();if(backend.settings.sync.enabled)backend.syncNow().catch(()=>{});document.addEventListener('visibilitychange',flushSync);globalThis.window?.addEventListener?.('resize',panelResized);ctx.extensionSettings[NAMESPACE]=structuredClone(settings);ctx.saveSettingsDebounced();active=true;globalThis.__stIphoniePanelBridge={connect};
 legacy=!ctx.messageFormatter?.addHook;
 if(!hooked&&!legacy){ctx.messageFormatter.addHook((text,meta)=>{if(!active||meta.isSystem||meta.isReasoning||meta.messageId<0)return text;try{return transform(text,meta);}catch{return text;}},{stage:ctx.messageFormatter.stage.BEFORE_REGEX,order:100});hooked=true;}
 const subscribe=(name,fn)=>{if(!name)return;ctx.eventSource.on(name,fn);listeners.push([ctx.eventSource,name,fn]);};subscribe(ctx.eventTypes.GENERATION_AFTER_COMMANDS,inject);
 // Each new story reply counts toward automatic 朋友圈 posts (off unless the user turns it on).
 subscribe(ctx.eventTypes.MESSAGE_RECEIVED,()=>{tagSpeakers((context()?.chat||[]).slice(-1));momentsHost?.storyReplied();callHost?.storyReplied();});subscribe(ctx.eventTypes.CHAT_CHANGED,spaceChanged);spaceChanged();
 for(const event of ['CHAT_CHANGED','MESSAGE_RECEIVED','MESSAGE_EDITED','MESSAGE_SWIPED','MESSAGE_DELETED','MESSAGE_SENT'])subscribe(ctx.eventTypes[event],async()=>{try{await pocket?.sync();if(active)inject();}catch(e){notice(e.message);}});
 await pocket.sync();
 characterStateChanged=()=>{if(!active||characterStateTimer)return;characterStateTimer=setTimeout(()=>{characterStateTimer=0;if(!active)return;backend.emit('csb',{});backend.emit('chat',{contacts:true,status:true});inject();},60);};globalThis.addEventListener?.('csb:changed',characterStateChanged);
 memoryComposer=createMemoryComposer({getState:()=>pocket?.memoryState(),document,notice});
 memoryUnsubscribe=backend.subscribe?.(event=>{if(event.type==='pocket')memoryComposer?.refresh();});
 subscribe(ctx.eventTypes.PERSONA_CHANGED,()=>{memoryComposer?.refresh();if(active)inject();});
 subscribe(ctx.eventTypes.WORLDINFO_UPDATED,name=>invalidatePhoneWorldbooks(context(),typeof name==='string'?name:undefined));
 if(!phoneCommand&&ctx.SlashCommandParser&&ctx.SlashCommand){ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({name:'phone',callback:async()=>{if(active)openPanel();return '';},helpString:'開啟 傳音玉符（也可以單擊懸浮球）'}));phoneCommand=true;}
 for(const event of ['CHAT_CHANGED','MESSAGE_SWIPED','MESSAGE_EDITED','MESSAGE_DELETED'])subscribe(ctx.eventTypes[event],scheduleRender);for(const event of ['CHARACTER_MESSAGE_RENDERED','USER_MESSAGE_RENDERED','MESSAGE_RECEIVED','MESSAGE_SENT'])subscribe(ctx.eventTypes[event],scheduleRender);subscribe(ctx.eventTypes.CHARACTER_MESSAGE_RENDERED,id=>{pictures?.autoPictures(Number(id)).catch(e=>notice(e.message));});
 document.addEventListener('click',click,true);mountEntry();syncFloating();observer=new MutationObserver(chatChanged);const chat=document.querySelector('#chat');if(chat)observer.observe(chat,{childList:true,subtree:true});inject();rerender();}
export function enable(){if(enabling)return enabling;enabling=enableInternal().finally(()=>{enabling=null;});return enabling;}
export async function disable(){if(enabling)await enabling;if(!active)return;active=false;clearPrompts();for(const [source,event,fn] of listeners)source.removeListener(event,fn);listeners.length=0;observer?.disconnect();clearTimeout(renderTimer);renderTimer=0;document.removeEventListener('click',click,true);document.removeEventListener('visibilitychange',flushSync);globalThis.window?.removeEventListener?.('resize',panelResized);document.querySelector('#sttts-extension-entry')?.remove();floating?.destroy();floating=null;document.querySelectorAll('[data-sttts-owned="toolbar"]').forEach(el=>el.remove());panel?.remove();panel=frame=null;delete globalThis.__stIphoniePanelBridge;pictures=null;chats=null;momentsHost=null;appsHost=null;callHost?.dispose();callHost=null;pendingDraw=null;memoryComposer?.dispose();memoryComposer=null;memoryUnsubscribe?.();memoryUnsubscribe=null;pocket?.dispose();pocket=null;globalThis.removeEventListener?.('csb:changed',characterStateChanged);characterStateChanged=null;clearTimeout(characterStateTimer);characterStateTimer=0;characterStateRuntime?.dispose();characterStateRuntime=null;await backend.close();rerender();}
export const dispose=disable;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>enable().catch(e=>notice(e.message)),{once:true});else enable().catch(e=>notice(e.message));
