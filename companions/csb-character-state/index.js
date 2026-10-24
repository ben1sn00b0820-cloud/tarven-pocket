import {StateController,KEY} from './src/controller.js';
import {replay,makePrompt,stripUpdate} from './src/core.js';
import {el,openManager,statusPanel,mountInformation,openScanner} from './src/ui.js';
import {createCharacterStateBridge,characterStateScope} from './src/bridge.js';

let controller,manager,bridge,messageFormatter=null,scheduled=null,busy=false,dirty=false,lastSaved='',lastSynced='',started=false,epoch=0,slashRegistered=false;
const listeners=[];
let pendingScanIndex=-1;
let formattedNodes=new WeakMap(),cardSnapshots=new WeakMap(),managerRevision='';
const context=()=>globalThis.SillyTavern.getContext();
const report=e=>{console.error('[CSB]',e);globalThis.toastr?.error(e.message??String(e),'角色信息');};
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
  target.append(el('div',{id:'csb-launcher',class:'csb csb-launcher'},el('button',{type:'button',class:'csb-btn csb-primary',onclick:launchManager},'◈ 角色信息'),el('small',{class:'csb-muted'},'角色記憶 · 共用欄位 · MVU 同步')));
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
function formatMessage(text,message,index,c){
  const html=messageFormatter?messageFormatter(text,{messageId:index,isUser:!!message.is_user,message}):c.messageFormatting(text,message.name,message.is_system,message.is_user,index,{},false);
  if(typeof html!=='string')throw Error('訊息格式化介面必須回傳 HTML 文字');
  return html;
}
function render(snapshot=null){
  if(!started||!controller)return;
  mount();const c=context();if(!c.chatMetadata||!Array.isArray(c.chat))return;
  const s=snapshot??controller.getSnapshot(),pinned=s.db.pinned.join('|');
  for(const mes of document.querySelectorAll('#chat .mes[mesid]')){
    const index=Number(mes.getAttribute('mesid')),message=c.chat[index];if(!message||message.is_user||message.is_system)continue;
    const textNode=mes.querySelector('.mes_text');if(!textNode)continue;
    if(busy&&index===c.chat.length-1||mes.querySelector('textarea.edit_textarea, textarea.mes_edit'))continue;
    let old=mes.querySelector('.csb-message-card');const open=old?openedPaths(old):new Set();
    const original=String(message.extra?.display_text??message.mes??''),cleaned=stripUpdate(original),shouldClean=s.settings.enabled&&cleaned!==original;
    if((shouldClean||textNode.dataset.csbCleaned==='true')&&(messageFormatter||typeof c.messageFormatting==='function')){
      const display=shouldClean?cleaned:original,previous=formattedNodes.get(textNode);
      if(!previous||previous.display!==display||previous.formatter!==messageFormatter||previous.first!==(textNode.firstChild?.classList?.contains('csb-message-card')?null:textNode.firstChild)){
        textNode.innerHTML=formatMessage(display,message,index,c);
        textNode.dataset.csbCleaned=String(shouldClean);formattedNodes.set(textNode,{display,formatter:messageFormatter,first:textNode.firstChild});
        old=mes.querySelector('.csb-message-card');
      }
    }
    const frame=s.result.frames[index];
    if(!s.settings.enabled||!s.settings.inlineCards||!frame||(!Object.keys(frame.characters).length&&!String(message.mes).includes('<CSB_UPDATE>'))){old?.remove();continue;}
    const errors=s.result.errors.filter(e=>e.index===index),errorKey=errors.map(e=>e.message).join('|'),previous=old&&cardSnapshots.get(old);
    if(previous&&previous.frame===frame&&previous.schema===s.db.schema&&previous.showAbsent===s.settings.showAbsent&&previous.pinned===pinned&&previous.errorKey===errorKey){if(old.parentNode!==textNode)textNode.append(old);continue;}
    const holder=el('div',{class:'csb csb-message-card'});
    errors.forEach(e=>holder.append(el('div',{class:'csb-message-error'},`狀態未更新：${e.message}。可編輯原始回覆修正，角色信息保持原值。`)));
    holder.append(statusPanel(frame,s.db.schema,{title:'劇情狀態',showAbsent:s.settings.showAbsent,onManage:showManager,onEdit:showEditor,pinned:s.db.pinned}));
    restoreOpen(holder,open);old?.remove();textNode.append(holder);
    cardSnapshots.set(holder,{frame,schema:s.db.schema,showAbsent:s.settings.showAbsent,pinned,errorKey});
  }
  if(manager?.dialog.isConnected&&managerRevision!==s.revision){manager.refresh();managerRevision=s.revision;}
}
async function settle(session=epoch){
  if(session!==epoch||!started)return;scheduled=null;if(!controller||busy)return;
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
function schedule(changed=false){if(!started)return;dirty||=changed;if(busy)return;if(scheduled!==null)clearTimeout(scheduled);const session=epoch;scheduled=setTimeout(()=>settle(session),80);}

export async function intercept(chat,contextSize,abort,type){
  if(!started||!controller)return;
  const c=context();c.setExtensionPrompt(KEY,'',1,0,false,0);
  if(!characterStateScope(c)||!controller.settings().enabled||['quiet','impersonate'].includes(type))return;
  try{
    const db=controller.db(),settings=controller.settings();
    // ST passes regex-processed prompt copies here. State must replay the original data,
    // otherwise prompt-only regexes or appended file contents could invalidate manual anchors.
    const messages=type==='swipe'?c.chat.slice(0,-1):c.chat;
    const current=replay(db,messages,{allowNew:settings.allowNew}).state;
    for(const ch of Object.values(current.characters))ch.locked=Object.keys(db.locks[ch.id]??{});
    const info=makePrompt(current,db.schema,settings,{recentText:messages.slice(-4).map(m=>m.mes).join('\n'),pinned:db.pinned});
    c.setExtensionPrompt(KEY,info.text,1,0,false,0);
  }catch(e){report(e);abort?.(true);}
};
export function initialize(){
  if(started)return bridge?.api;
  if(!globalThis.SillyTavern?.getContext)return null;
  // A separately installed CSB owns its interceptor. Never replace its instance.
  if(globalThis.CSBCharacterState||globalThis.csbCharacterStateIntercept&&globalThis.csbCharacterStateIntercept!==intercept)return null;
  const c=context(),events=c.eventTypes??c.event_types??{};
  if(!c.eventSource?.on)return null;
  started=true;epoch++;controller=new StateController({context,getMvu:()=>globalThis.Mvu,isBusy:()=>busy});
  bridge=createCharacterStateBridge({context,snapshot:readPublicSnapshot,openEditor:showEditor,openManager:showManager,openScanner:showScanner,mountView:mountInformation,setInlineCards:enabled=>guardedController().setInlineCards(enabled),onError:report});
  globalThis.CSBCharacterState=bridge.api;globalThis.csbCharacterStateIntercept=intercept;
  controller.scanner.onStatus=message=>{if(started&&/等待確認|已新增/.test(message))globalThis.toastr?.info?.(message,'角色信息掃描',{preventDuplicates:true});};
  controller.onChange=()=>{if(!started)return;dirty=true;schedule(true);};
  const listen=(name,fn)=>{if(!events[name])return;c.eventSource.on(events[name],fn);listeners.push({source:c.eventSource,event:events[name],fn});};
  for(const name of ['CHAT_CHANGED','CHAT_CREATED'])listen(name,()=>{
    closeDialogs();controller.cancelScan();controller.scanner.pending=null;pendingScanIndex=-1;controller.invalidate();managerRevision='';lastSaved='';lastSynced='';dirty=false;busy=false;context().setExtensionPrompt(KEY,'',1,0,false,0);schedule();
    // Clear consumers immediately, even when the new selection has no chat.
    try{bridge?.notify();}catch(e){report(e);}
  });
  for(const name of ['MESSAGE_RECEIVED','MESSAGE_UPDATED','MESSAGE_EDITED','MESSAGE_DELETED','MESSAGE_SWIPED','CHARACTER_MESSAGE_RENDERED','USER_MESSAGE_RENDERED'])listen(name,(index)=>{
    if(['MESSAGE_RECEIVED','MESSAGE_UPDATED','MESSAGE_EDITED','MESSAGE_SWIPED'].includes(name)){const i=Number.isInteger(Number(index))&&index!==undefined?Number(index):context().chat.length-1;if(!context().chat[i]?.is_user&&!context().chat[i]?.is_system)pendingScanIndex=i;}
    schedule(true);
  });
  listen('GENERATION_STARTED',()=>{busy=true;});
  for(const name of ['GENERATION_ENDED','GENERATION_STOPPED'])listen(name,()=>{busy=false;schedule(true);});
  listen('APP_READY',()=>schedule());listen('MORE_MESSAGES_LOADED',()=>schedule());
  if(!slashRegistered&&c.SlashCommandParser&&c.SlashCommand){c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({name:'csb',callback:async()=>{if(started)launchManager();return '';},helpString:'開啟角色信息。'}));slashRegistered=true;}
  mount();schedule();return bridge.api;
}

export function ownsRuntime(){return started&&!!bridge;}

export function dispose(){
  if(!started)return;
  started=false;epoch++;if(scheduled!==null)clearTimeout(scheduled);scheduled=null;
  for(const {source,event,fn} of listeners.splice(0)){
    if(typeof source.removeListener==='function')source.removeListener(event,fn);else source.off?.(event,fn);
  }
  closeDialogs();document.getElementById('csb-launcher')?.remove();
  for(const card of document.querySelectorAll('.csb-message-card'))card.remove();
  const c=context();
  for(const node of document.querySelectorAll('.mes_text[data-csb-cleaned="true"]')){
    const mes=node.closest('.mes[mesid]'),index=Number(mes?.getAttribute('mesid')),message=c.chat?.[index];
    if(message&&(messageFormatter||typeof c.messageFormatting==='function')&&!mes.querySelector('textarea.edit_textarea, textarea.mes_edit'))node.innerHTML=formatMessage(String(message.extra?.display_text??message.mes??''),message,index,c);
    delete node.dataset.csbCleaned;
  }
  if(globalThis.CSBCharacterState===bridge?.api)delete globalThis.CSBCharacterState;
  if(globalThis.csbCharacterStateIntercept===intercept){delete globalThis.csbCharacterStateIntercept;c.setExtensionPrompt?.(KEY,'',1,0,false,0);}
  controller?.scanner.dispose();pendingScanIndex=-1;bridge?.dispose();bridge=null;if(controller)controller.onChange=()=>{};controller=null;messageFormatter=null;busy=false;dirty=false;lastSaved='';lastSynced='';formattedNodes=new WeakMap();cardSnapshots=new WeakMap();managerRevision='';
}
initialize();
