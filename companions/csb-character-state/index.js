import {StateController,KEY} from './src/controller.js';
import {replay,makePrompt,stripUpdate} from './src/core.js';
import {el,openManager,statusPanel,mountInformation,openScanner} from './src/ui.js';
import {createCharacterStateBridge,characterStateScope} from './src/bridge.js';
import {createGenerationGuard} from './src/generation.js';

let controller,manager,bridge,messageFormatter=null,scheduled=null,generation=null,dirty=false,lastSaved='',lastSynced='',started=false,epoch=0,slashRegistered=false,observer=null,lifecycle=null;
const listeners=[];
let pendingScanIndex=-1;
let cardSnapshots=new WeakMap(),managerRevision='';
const cleanedFragments=new Map();
const context=()=>globalThis.SillyTavern.getContext();
let hostScript=null,hostGroups=null;
function readHostGeneration(){
  const c=context();
  if(typeof c.isGenerating==='function')return c.isGenerating();
  if(typeof c.isGenerating==='boolean')return c.isGenerating;
  if(typeof hostScript?.isGenerating==='function')return hostScript.isGenerating();
  if(typeof hostScript?.is_send_press==='boolean')return hostScript.is_send_press||hostGroups?.is_group_generating===true;
  return null;
}
function loadHostGeneration(){
  // Reuse the host's ESM singleton; optional for forks and offline fixtures.
  // Loading is asynchronous to avoid a script.js/extension initialization cycle.
  try{
    const url=new URL('script.js',document.baseURI);
    if(!['http:','https:'].includes(url.protocol))return;
    import(url.href).then(async module=>{
      hostScript=module;
      if(typeof module.isGenerating!=='function'){
        try{hostGroups=await import(new URL('scripts/group-chats.js',url).href);}catch{}
      }
      if(started)schedule();
    }).catch(()=>{});
  }catch{}
}
const isBusy=()=>generation?.isBusy()??false;
const report=e=>{console.error('[CSB]',e);globalThis.toastr?.error?.(e.message??String(e),'角色信息');};
function closeDialogs(){
  for(const dialog of document.querySelectorAll('dialog.csb-dialog')){try{dialog.close();}catch{}dialog.remove();}
  manager=null;
}
function guardedController(){
  const c=context(),scope=characterStateScope(c),session=epoch;
  const guard=()=>{const now=context();if(!started||session!==epoch||!scope||characterStateScope(now)!==scope||now.chatMetadata!==c.chatMetadata||now.chat!==c.chat)throw Error('聊天已切換，請重新開啟角色管理介面。');};
  guard();
  return new Proxy(controller,{get(target,key){const value=Reflect.get(target,key);return typeof value==='function'?(...args)=>{guard();return value.apply(target,args);}:value;}});
}
function showManager(){
  if(!started||!controller)throw Error('角色信息尚未啟動。');
  if(manager?.dialog?.isConnected){manager.dialog.focus();return manager;}
  const guarded=guardedController();guarded.getSnapshot();manager=openManager(guarded);return manager;
}
function showScanner(options={}){return openScanner(guardedController(),options);}
function showEditor(id){showManager().editCharacter(id);}
function launchManager(){try{showManager();}catch(e){report(e);}}
function readPublicSnapshot(){
  // Read-only callers share the runtime cache without mutating the journal,
  // assigning message IDs, or creating a database merely by opening a menu.
  return controller.getSnapshot({readOnly:true});
}
function mount(){
  if(document.getElementById('csb-launcher'))return;
  const target=document.querySelector('#extensions_settings2')??document.querySelector('#extensions_settings');if(!target)return;
  target.append(el('div',{id:'csb-launcher',class:'csb csb-launcher'},el('button',{type:'button',class:'csb-btn csb-primary',onclick:launchManager},'◈ 角色信息'),el('small',{class:'csb-muted'},'角色記憶 · 男女模板 · AI 填表預設')));
}
function detailPath(d){if(d.dataset.char)return `character:${d.dataset.char}`;if(d.classList.contains('csb-panel'))return 'panel';return `${d.closest('.csb-character')?.dataset.char??''}:${d.querySelector(':scope > summary')?.textContent}`;}
function openedPaths(root){return new Set([...root.querySelectorAll('details[open]')].map(detailPath));}
function restoreOpen(root,set){
  for(const d of root.querySelectorAll('.csb-panel,.csb-character'))if(set.has(detailPath(d))){d.open=true;d.csbEnsureBody?.();}
  for(const d of root.querySelectorAll('details'))if(set.has(detailPath(d)))d.open=true;
}
export function setMessageFormatter(formatter=null){
  if(formatter!==null&&typeof formatter!=='function')throw TypeError('訊息格式化介面必須是函式');
  messageFormatter=formatter;schedule();
}
// Remove only the machine block from the existing DOM. Reformatting an entire
// message also destroys other extensions' status panels, live frames and handlers.
// Keep detached source fragments so disabling CSB can restore them in place.
function restoreMachineBlocks(root){
  for(const {marker,fragment} of cleanedFragments.get(root)??[])if(marker.parentNode)marker.replaceWith(fragment);
  cleanedFragments.delete(root);delete root.dataset.csbCleaned;
}
function hideMachineBlocks(root){
  const records=(cleanedFragments.get(root)??[]).filter(({marker})=>root.contains(marker));
  const stash=range=>{const fragment=range.extractContents(),marker=document.createComment('csb-update');range.insertNode(marker);records.push({marker,fragment});};
  for(const block of root.querySelectorAll('csb_update')){const range=document.createRange();range.selectNode(block);stash(range);}
  const walker=document.createTreeWalker(root,4),nodes=[];let text='',node;
  while((node=walker.nextNode())){
    if(node.parentElement?.closest('.csb-message-card,script,style,textarea'))continue;
    nodes.push({node,start:text.length,end:text.length+node.data.length});text+=node.data;
  }
  for(const match of [...text.matchAll(/<CSB_UPDATE>[\s\S]*?<\/CSB_UPDATE>/g)].reverse()){
    const start=nodes.find(item=>item.end>match.index),end=nodes.find(item=>item.end>=match.index+match[0].length);
    if(!start||!end)continue;
    const range=document.createRange();range.setStart(start.node,match.index-start.start);range.setEnd(end.node,match.index+match[0].length-end.start);stash(range);
  }
  if(records.length){cleanedFragments.set(root,records);root.dataset.csbCleaned='true';}
  else{cleanedFragments.delete(root);delete root.dataset.csbCleaned;}
}
function observeChat(){if(started&&observer&&document.body)observer.observe(document.body,{childList:true,subtree:true,characterData:true});}
function chatMutated(records){
  if(!started)return;
  const relevant=records.some(record=>{
    const target=record.target.nodeType===1?record.target:record.target.parentElement;
    if(target?.closest?.('.csb-message-card'))return false;
    if(target?.closest?.('#chat .mes[mesid] .mes_text'))return true;
    return [...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1&&(node.matches?.('#chat,.mes[mesid],.mes_text,.csb-message-card')||node.querySelector?.('#chat,.mes[mesid],.mes_text')));
  });
  if(relevant)schedule();
}
function render(snapshot=null){
  if(!started||!controller)return;
  mount();const c=context();if(!c.chatMetadata||!Array.isArray(c.chat))return;
  const s=snapshot??controller.getSnapshot(),pinned=s.db.pinned.join('|'),busy=isBusy();
  let latest=-1;for(let i=c.chat.length-1;i>=0;i--)if(!c.chat[i].is_user&&!c.chat[i].is_system){latest=i;break;}
  // Mutations performed by this render must not schedule another render forever.
  observer?.disconnect();
  try{
  for(const node of cleanedFragments.keys())if(!node.isConnected)cleanedFragments.delete(node);
  for(const mes of document.querySelectorAll('#chat .mes[mesid]')){
    const index=Number(mes.getAttribute('mesid')),message=c.chat[index];if(!message||message.is_user||message.is_system)continue;
    const textNode=mes.querySelector('.mes_text');if(!textNode)continue;
    if(busy&&index===c.chat.length-1||mes.querySelector('textarea.edit_textarea, textarea.mes_edit'))continue;
    let old=mes.querySelector('.csb-message-card');const open=old?openedPaths(old):new Set();
    const original=String(message.extra?.display_text??message.mes??''),cleaned=stripUpdate(original),shouldClean=s.settings.enabled&&cleaned!==original;
    if(shouldClean)hideMachineBlocks(textNode);else if(cleanedFragments.has(textNode))restoreMachineBlocks(textNode);
    const frame=s.result.frames[index]??(index===latest?s.state:null);
    if(!s.settings.enabled||!s.settings.inlineCards||!frame||(!Object.keys(frame.characters).length&&index!==latest&&!String(message.mes).includes('<CSB_UPDATE>'))){old?.remove();continue;}
    const errors=s.result.errors.filter(e=>e.index===index),errorKey=errors.map(e=>e.message).join('|'),previous=old&&cardSnapshots.get(old);
    if(previous&&previous.frame===frame&&previous.schema===s.db.schema&&previous.showAbsent===s.settings.showAbsent&&previous.pinned===pinned&&previous.errorKey===errorKey){if(old.parentNode!==textNode)textNode.append(old);continue;}
    const holder=el('div',{class:'csb csb-message-card'});
    errors.forEach(e=>holder.append(el('div',{class:'csb-message-error'},`部分更新未採用：${e.message}。請核對或編輯原始回覆；未採用項目保留原值，其他有效更新仍會套用。`)));
    holder.append(statusPanel(frame,s.db.schema,{title:'劇情狀態',showAbsent:s.settings.showAbsent,onManage:showManager,onEdit:showEditor,pinned:s.db.pinned}));
    restoreOpen(holder,open);old?.remove();textNode.append(holder);
    cardSnapshots.set(holder,{frame,schema:s.db.schema,showAbsent:s.settings.showAbsent,pinned,errorKey});
  }
  if(manager?.dialog.isConnected&&managerRevision!==s.revision){manager.refresh();managerRevision=s.revision;}
  }finally{observeChat();}
}
async function settle(session=epoch){
  if(session!==epoch||!started)return;scheduled=null;if(!controller)return;if(isBusy()){schedule();return;}
  const owner=controller;
  try{
    const c=context(),scope=characterStateScope(c);if(!scope){bridge?.notify();return;}
    const current=()=>started&&session===epoch&&controller===owner&&characterStateScope(context())===scope&&context().chatMetadata===c.chatMetadata&&context().chat===c.chat;
    const s=owner.getSnapshot();render(s);
    // Persist accepted journal entries once, without rewriting the original messages.
    const stamp=`${scope}:${s.revision}`;
    if(stamp!==lastSaved){await owner.flush(c);if(!current())return;lastSaved=stamp;}
    if(s.settings.enabled&&s.settings.mvuSync&&owner.mvu()&&dirty){
      const signature=JSON.stringify([scope,c.chat.length,c.chat.at(-1)?.swipe_id,s.state,s.db.schema]);
      if(signature!==lastSynced){try{await owner.pushMvu();if(!current())return;lastSynced=signature;}catch(e){if(!current())return;owner.mvuMessage=e.message;globalThis.toastr?.warning(e.message,'CSB · MVU 同步未完成',{preventDuplicates:true});}}
    }
    if(!current())return;dirty=false;bridge?.notify();
    if(pendingScanIndex>=0&&!owner.scanner.job){const i=pendingScanIndex;pendingScanIndex=-1;await owner.scanner.automatic(i);if(current())bridge?.notify();}
  }catch(e){if(started&&session===epoch)report(e);}
}
function schedule(changed=false){if(!started)return;dirty||=changed;if(scheduled!==null)clearTimeout(scheduled);const session=epoch;scheduled=setTimeout(()=>settle(session),isBusy()?500:80);}

export async function intercept(chat,contextSize,abort,type){
  if(!started||!controller)return;
  let c;
  try{
    c=context();c.setExtensionPrompt(KEY,'',1,0,false,0);
    if(!characterStateScope(c)||!controller.settings().enabled||['quiet','impersonate'].includes(type))return;
    const db=controller.db(),settings=controller.settings();
    // ST passes regex-processed prompt copies here. State must replay the original data,
    // otherwise prompt-only regexes or appended file contents could invalidate manual anchors.
    const messages=type==='swipe'?c.chat.slice(0,-1):c.chat;
    const current=replay(db,messages,{allowNew:settings.allowNew}).state;
    for(const ch of Object.values(current.characters))ch.locked=Object.keys(db.locks[ch.id]??{});
    const info=makePrompt(current,db.schema,settings,{recentText:messages.slice(-4).map(m=>m.mes).join('\n'),pinned:db.pinned,presenceOverrides:db.presenceOverrides??{}});
    c.setExtensionPrompt(KEY,info.text,1,0,false,0);
  }catch(e){try{c?.setExtensionPrompt?.(KEY,'',1,0,false,0);}catch{}try{report(e);}catch{}}
};
export function initialize(){
  if(started)return bridge?.api;
  if(!globalThis.SillyTavern?.getContext)return null;
  // A separately installed CSB owns its interceptor. Never replace its instance.
  if(globalThis.CSBCharacterState||globalThis.csbCharacterStateIntercept&&globalThis.csbCharacterStateIntercept!==intercept)return null;
  const c=context(),events=c.eventTypes??c.event_types??{};
  if(!c.eventSource?.on)return null;
  started=true;epoch++;generation=createGenerationGuard({context,document,readHostState:readHostGeneration});loadHostGeneration();controller=new StateController({context,getMvu:()=>globalThis.Mvu,isBusy});
  bridge=createCharacterStateBridge({context,snapshot:readPublicSnapshot,openEditor:showEditor,openManager:showManager,openScanner:showScanner,mountView:mountInformation,setInlineCards:enabled=>guardedController().setInlineCards(enabled),setPresence:(id,mode)=>guardedController().setPresence(id,mode),setCurrentPresence:(id,present)=>guardedController().setCurrentPresence(id,present),deleteCharacter:id=>guardedController().deleteCharacter(id),restoreCharacter:id=>guardedController().restoreCharacter(id),onError:report});
  globalThis.CSBCharacterState=bridge.api;globalThis.csbCharacterStateIntercept=intercept;
  lifecycle=Object.freeze({version:'1.5.0',dispose,initialize,setMessageFormatter,intercept});globalThis.CSBCharacterStateRuntime=lifecycle;
  if(typeof globalThis.MutationObserver==='function'){observer=new MutationObserver(chatMutated);observeChat();}
  controller.scanner.onStatus=message=>{
    if(!started||/^AI 正在分析|^第 \d+\/\d+ 批.*重試/.test(message))return;
    const kind=/等待確認|已新增/.test(message)?'info':'warning';
    globalThis.toastr?.[kind]?.(message,'角色信息掃描',{preventDuplicates:true});
  };
  controller.onChange=()=>{if(!started)return;dirty=true;schedule(true);};
  const listen=(name,fn)=>{if(!events[name])return;c.eventSource.on(events[name],fn);listeners.push({source:c.eventSource,event:events[name],fn});};
  for(const name of ['CHAT_CHANGED','CHAT_CREATED'])listen(name,()=>{
    closeDialogs();controller.cancelScan();controller.scanner.pending=null;pendingScanIndex=-1;controller.invalidate();managerRevision='';lastSaved='';lastSynced='';dirty=false;generation.reset();context().setExtensionPrompt(KEY,'',1,0,false,0);schedule();
    // Clear consumers immediately, even when the new selection has no chat.
    try{bridge?.notify();}catch(e){report(e);}
  });
  for(const name of ['MESSAGE_RECEIVED','MESSAGE_UPDATED','MESSAGE_EDITED','MESSAGE_DELETED','MESSAGE_SWIPED','CHARACTER_MESSAGE_RENDERED','USER_MESSAGE_RENDERED'])listen(name,(index)=>{
    if(['MESSAGE_RECEIVED','MESSAGE_UPDATED','MESSAGE_EDITED','MESSAGE_SWIPED'].includes(name)){const i=Number.isInteger(Number(index))&&index!==undefined?Number(index):context().chat.length-1;if(!context().chat[i]?.is_user&&!context().chat[i]?.is_system)pendingScanIndex=i;}
    schedule(true);
  });
  listen('GENERATION_STARTED',(type,options,dryRun)=>{generation.start(type,options,dryRun);schedule();});
  for(const name of ['GENERATION_ENDED','GENERATION_STOPPED'])listen(name,()=>{generation.finish();schedule(true);});
  listen('APP_READY',()=>schedule());listen('MORE_MESSAGES_LOADED',()=>schedule());
  if(!slashRegistered&&c.SlashCommandParser&&c.SlashCommand){c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({name:'csb',callback:async()=>{if(started)launchManager();return '';},helpString:'開啟角色信息。'}));slashRegistered=true;}
  mount();schedule();return bridge.api;
}

export function ownsRuntime(){return started&&!!bridge;}

export function dispose(){
  if(!started)return;
  started=false;epoch++;if(scheduled!==null)clearTimeout(scheduled);scheduled=null;
  observer?.disconnect();observer=null;
  for(const {source,event,fn} of listeners.splice(0)){
    if(typeof source.removeListener==='function')source.removeListener(event,fn);else source.off?.(event,fn);
  }
  closeDialogs();document.getElementById('csb-launcher')?.remove();
  for(const card of document.querySelectorAll('.csb-message-card'))card.remove();
  const c=context();
  for(const node of cleanedFragments.keys())restoreMachineBlocks(node);
  if(globalThis.CSBCharacterState===bridge?.api)delete globalThis.CSBCharacterState;
  if(globalThis.csbCharacterStateIntercept===intercept){delete globalThis.csbCharacterStateIntercept;c.setExtensionPrompt?.(KEY,'',1,0,false,0);}
  if(globalThis.CSBCharacterStateRuntime===lifecycle)delete globalThis.CSBCharacterStateRuntime;lifecycle=null;
  controller?.scanner.dispose();pendingScanIndex=-1;bridge?.dispose();bridge=null;if(controller)controller.onChange=()=>{};controller=null;messageFormatter=null;generation?.reset();generation=null;dirty=false;lastSaved='';lastSynced='';cardSnapshots=new WeakMap();managerRevision='';
}
/** Only direct extension entrypoint scripts auto-start. Dynamic bundled imports
 * are initialized by their owner after its cancellation guard has passed. */
export function isRuntimeEntryPoint(doc=globalThis.document,url=import.meta.url){
  return [...(doc?.querySelectorAll?.('script[type="module"][src]')??[])].some(script=>{
    try{return new URL(script.src,doc.baseURI).href===url;}catch{return false;}
  });
}
if(isRuntimeEntryPoint())initialize();
