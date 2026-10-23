import {StateController,KEY} from './src/controller.js';
import {replay,makePrompt,stripUpdate} from './src/core.js';
import {el,openManager,statusPanel} from './src/ui.js';
import {createCharacterStateBridge,characterStateScope} from './src/bridge.js';
import {clone,defaultSettings,newDatabase} from './src/schema.js';

let controller,manager,bridge,messageFormatter=null,scheduled=null,busy=false,dirty=false,lastSaved='',lastSynced='',started=false,epoch=0,slashRegistered=false;
const listeners=[];
const context=()=>globalThis.SillyTavern.getContext();
const report=e=>{console.error('[CSB]',e);globalThis.toastr?.error(e.message??String(e),'角色狀態工坊');};
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
  if(!started||!controller)throw Error('角色狀態工坊尚未啟動。');
  if(manager?.dialog?.isConnected){manager.dialog.focus();return manager;}
  const guarded=guardedController();guarded.getSnapshot();manager=openManager(guarded);return manager;
}
function showEditor(id){showManager().editCharacter(id);}
function launchManager(){try{showManager();}catch(e){report(e);}}
function readPublicSnapshot(){
  const c=context(),settings=clone(c.extensionSettings?.[KEY]??defaultSettings());
  // The bridge projects a cloned journal. Reads cannot create message IDs,
  // initialize metadata or accept changes on behalf of the CSB controller.
  const db=clone(c.chatMetadata?.[KEY]??newDatabase(settings.template));
  return {db,settings,state:replay(db,c.chat,{capture:true,allowNew:settings.allowNew}).state};
}
function mount(){
  if(document.getElementById('csb-launcher'))return;
  const target=document.querySelector('#extensions_settings2')??document.querySelector('#extensions_settings');if(!target)return;
  target.append(el('div',{id:'csb-launcher',class:'csb csb-launcher'},el('button',{type:'button',class:'csb-btn csb-primary',onclick:launchManager},'◈ 角色狀態工坊'),el('small',{class:'csb-muted'},'角色記憶 · 共用欄位 · MVU 同步')));
}
function openedPaths(root){return new Set([...root.querySelectorAll('details[open]')].map(d=>d.dataset.char??(d.classList.contains('csb-panel')?'panel':d.querySelector(':scope > summary')?.textContent)));}
function restoreOpen(root,set){for(const d of root.querySelectorAll('details')){const key=d.dataset.char??(d.classList.contains('csb-panel')?'panel':d.querySelector(':scope > summary')?.textContent);if(set.has(key))d.open=true;}}
export function setMessageFormatter(formatter=null){
  if(formatter!==null&&typeof formatter!=='function')throw TypeError('訊息格式化介面必須是函式');
  messageFormatter=formatter;schedule();
}
function formatMessage(text,message,index,c){
  const html=messageFormatter?messageFormatter(text,{messageId:index,isUser:!!message.is_user,message}):c.messageFormatting(text,message.name,message.is_system,message.is_user,index,{},false);
  if(typeof html!=='string')throw Error('訊息格式化介面必須回傳 HTML 文字');
  return html;
}
function render(){
  if(!started||!controller)return;
  mount();const c=context();if(!c.chatMetadata||!Array.isArray(c.chat))return;
  const s=controller.getSnapshot();
  for(const mes of document.querySelectorAll('#chat .mes[mesid]')){
    const index=Number(mes.getAttribute('mesid')),message=c.chat[index];if(!message||message.is_user||message.is_system)continue;
    const old=mes.querySelector(':scope .csb-message-card');const textNode=mes.querySelector('.mes_text');if(!textNode)continue;
    // Never reformat the streaming message or a user's open edit control.
    if(busy&&index===c.chat.length-1)continue;
    if(mes.querySelector('textarea.edit_textarea, textarea.mes_edit'))continue;
    const original=String(message.extra?.display_text??message.mes??'');
    const cleaned=stripUpdate(original),shouldClean=s.settings.enabled&&cleaned!==original;
    if((shouldClean||textNode.dataset.csbCleaned==='true')&&(messageFormatter||typeof c.messageFormatting==='function')){
      const display=shouldClean?cleaned:original;
      // Use ST's own formatter; plugin fields are rendered separately with textContent.
      textNode.innerHTML=formatMessage(display,message,index,c);
      textNode.dataset.csbCleaned=String(shouldClean);
    }
    const open=old?openedPaths(old):new Set();old?.remove();
    if(!s.settings.enabled||!s.settings.inlineCards||!s.result.frames[index])continue;
    const frame=s.result.frames[index];if(!Object.keys(frame.characters).length&&!String(message.mes).includes('<CSB_UPDATE>'))continue;
    const holder=el('div',{class:'csb csb-message-card'}),errors=s.result.errors.filter(e=>e.index===index);
    errors.forEach(e=>holder.append(el('div',{class:'csb-message-error'},`狀態未更新：${e.message}。可編輯原始回覆修正，資料維持上一輪。`)));
    holder.append(statusPanel(frame,s.db.schema,{showAbsent:s.settings.showAbsent,onManage:showManager,onEdit:showEditor,pinned:s.db.pinned}));restoreOpen(holder,open);textNode.after(holder);
  }
  if(manager?.dialog.isConnected)manager.refresh();
}
async function settle(session=epoch){
  if(session!==epoch||!started)return;scheduled=null;if(!controller||busy)return;
  const owner=controller;
  try{
    const c=context(),scope=characterStateScope(c);if(!scope){bridge?.notify();return;}
    const current=()=>started&&session===epoch&&controller===owner&&characterStateScope(context())===scope&&context().chatMetadata===c.chatMetadata&&context().chat===c.chat;
    const s=owner.getSnapshot();render();
    // Persist accepted journal entries once, without rewriting the original messages.
    const stamp=JSON.stringify([scope,s.db]);
    if(stamp!==lastSaved){await owner.flush(c);if(!current())return;lastSaved=stamp;}
    if(s.settings.enabled&&s.settings.mvuSync&&owner.mvu()&&dirty){
      const signature=JSON.stringify([scope,c.chat.length,c.chat.at(-1)?.swipe_id,s.state,s.db.schema]);
      if(signature!==lastSynced){try{await owner.pushMvu();if(!current())return;lastSynced=signature;}catch(e){if(!current())return;owner.mvuMessage=e.message;globalThis.toastr?.warning(e.message,'CSB · MVU 同步未完成',{preventDuplicates:true});}}
    }
    if(!current())return;dirty=false;bridge?.notify();
  }catch(e){if(started&&session===epoch)report(e);}
}
function schedule(changed=false){if(!started)return;dirty||=changed;if(scheduled!==null)clearTimeout(scheduled);const session=epoch;scheduled=setTimeout(()=>settle(session),80);}

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
  started=true;epoch++;controller=new StateController({context,getMvu:()=>globalThis.Mvu});
  bridge=createCharacterStateBridge({context,snapshot:readPublicSnapshot,openEditor:showEditor,openManager:showManager,onError:report});
  globalThis.CSBCharacterState=bridge.api;globalThis.csbCharacterStateIntercept=intercept;
  controller.onChange=()=>{if(!started)return;dirty=true;render();schedule(true);};
  const listen=(name,fn)=>{if(!events[name])return;c.eventSource.on(events[name],fn);listeners.push({source:c.eventSource,event:events[name],fn});};
  for(const name of ['CHAT_CHANGED','CHAT_CREATED'])listen(name,()=>{
    closeDialogs();lastSaved='';lastSynced='';dirty=false;busy=false;context().setExtensionPrompt(KEY,'',1,0,false,0);schedule();
    // Clear consumers immediately, even when the new selection has no chat.
    try{bridge?.notify();}catch(e){report(e);}
  });
  for(const name of ['MESSAGE_RECEIVED','MESSAGE_UPDATED','MESSAGE_EDITED','MESSAGE_DELETED','MESSAGE_SWIPED','CHARACTER_MESSAGE_RENDERED','USER_MESSAGE_RENDERED'])listen(name,()=>{
    if(['MESSAGE_UPDATED','MESSAGE_EDITED','MESSAGE_DELETED','MESSAGE_SWIPED'].includes(name))closeDialogs();schedule(true);
  });
  listen('GENERATION_STARTED',()=>{busy=true;});
  for(const name of ['GENERATION_ENDED','GENERATION_STOPPED'])listen(name,()=>{busy=false;schedule(true);});
  listen('APP_READY',()=>schedule());listen('MORE_MESSAGES_LOADED',()=>schedule());
  if(!slashRegistered&&c.SlashCommandParser&&c.SlashCommand){c.SlashCommandParser.addCommandObject(c.SlashCommand.fromProps({name:'csb',callback:async()=>{if(started)launchManager();return '';},helpString:'開啟角色狀態工坊。'}));slashRegistered=true;}
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
  bridge?.dispose();bridge=null;if(controller)controller.onChange=()=>{};controller=null;messageFormatter=null;busy=false;dirty=false;lastSaved='';lastSynced='';
}
initialize();
