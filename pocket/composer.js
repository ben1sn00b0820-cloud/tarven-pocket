import {worldText} from '../core/world.js';
import {createMemoryMentionIndex,searchMemoryMentionIndex,createMemoryMention} from './mentions.js';
const controllers=new WeakMap();

export function memoryTrigger(value,caret) {
  const text=String(value??''),end=Math.max(0,Math.min(text.length,Number.isFinite(caret)?caret:text.length));
  const before=text.slice(0,end),at=Math.max(before.lastIndexOf('@'),before.lastIndexOf('＠'));
  if(at<0||/[A-Za-z0-9_@./-]/.test(before[at-1]||''))return null;
  const query=before.slice(at+1);
  if(query.length>64||/[\r\n【】]/.test(query))return null;
  return {start:at,end,query};
}

/** Geometry uses the visible viewport, including an open mobile keyboard. */
export function memoryPickerLayout(anchor,viewport,{mode='button',height=560}={}) {
  const margin=8,gap=8,left=viewport.left||0,top=viewport.top||0;
  const vw=Math.max(1,viewport.width||1),vh=Math.max(1,viewport.height||1);
  const width=Math.max(1,Math.min(mode==='inline'?440:510,vw-2*margin));
  const above=Math.max(0,anchor.top-top-gap-margin),below=Math.max(0,top+vh-anchor.bottom-gap-margin);
  const available=Math.max(above,below),overlay=available<Math.min(120,vh-2*margin);
  const maxHeight=Math.max(1,Math.min(mode==='inline'?350:560,vh-2*margin,overlay?vh-2*margin:available));
  const actual=Math.min(Math.max(1,height),maxHeight),useAbove=above>=below;
  const x=Math.max(left+Math.min(margin,vw/2),Math.min(anchor.left,left+vw-width-margin));
  const y=overlay?top+margin:useAbove?anchor.top-gap-actual:anchor.bottom+gap;
  return {left:x,top:Math.max(top,Math.min(y,top+vh-actual)),width,maxHeight,compact:maxHeight<320};
}

/** Read-only selector. Input searches a cached snapshot; opening, saved-data
 * events and insertion re-read the source. No model requests or asset writes. */
export function createMemoryComposer({getState,document:doc=globalThis.document,selector='#send_textarea',notice=()=>{}}={}) {
  if(!doc||typeof getState!=='function')return {refresh(){},open(){},close(){},dispose(){}};
  controllers.get(doc)?.dispose();
  const win=doc.defaultView||globalThis,frame=win.requestAnimationFrame?.bind(win)||(fn=>win.setTimeout(fn,0)),cancel=win.cancelAnimationFrame?.bind(win)||win.clearTimeout.bind(win);
  let alive=true,shown=false,mode='button',category='profile',query='',rows=[],selected=0,field=null,button=null,range={start:0,end:0},composing=false,inserting=false,lastPersona='';
  let session=0,loadRevision=0,pendingRead=null,readAgain=false,index=null,drawFrame=0,positionFrame=0,previewNode=null,fieldARIA=null,insertOperation=0;
  const nodes=new Map(),removers=[];
  const panel=doc.createElement('section');
  panel.id='tp-memory-picker';panel.className='tp-memory-picker';panel.hidden=true;
  panel.setAttribute('role','dialog');panel.setAttribute('aria-label','引用我的資訊、物品與能力');
  panel.innerHTML='<div class="tp-memory-heading"><span class="tp-memory-heading-icon" aria-hidden="true">@</span><div><strong>我的隨身資料</strong><small id="tp-memory-owner">選取後帶入正文草稿</small></div><button type="button" data-tp-memory-close aria-label="關閉資料選擇器">×</button></div><div class="tp-memory-tabs" role="tablist"><button type="button" role="tab" data-tp-memory-tab="profile">我的資訊</button><button type="button" role="tab" data-tp-memory-tab="items">我的物品</button><button type="button" role="tab" data-tp-memory-tab="abilities">我的能力</button></div><label class="tp-memory-search-wrap"><span aria-hidden="true">⌕</span><input id="tp-memory-search" type="search" role="combobox" aria-autocomplete="list" aria-controls="tp-memory-results" aria-expanded="false" autocomplete="off" placeholder="搜尋名稱或內容" aria-label="搜尋我的資料"></label><div id="tp-memory-results" class="tp-memory-results" role="listbox" aria-label="可引用資料"></div><div id="tp-memory-detail" class="tp-memory-detail"></div><div class="tp-memory-footer"><span id="tp-memory-feedback" role="status" aria-live="polite">點選即可插入，可連續選取</span><kbd>↑ ↓ 選擇　Enter 插入</kbd></div>';
  doc.body.append(panel);
  const search=panel.querySelector('#tp-memory-search'),results=panel.querySelector('#tp-memory-results'),detail=panel.querySelector('#tp-memory-detail'),owner=panel.querySelector('#tp-memory-owner'),feedback=panel.querySelector('#tp-memory-feedback');
  const detailTitle=doc.createElement('strong'),detailText=doc.createElement('span');detail.append(detailTitle,detailText);
  const listen=(target,event,fn,options)=>{target?.addEventListener?.(event,fn,options);return()=>target?.removeEventListener?.(event,fn,options);};
  const remember=()=>{if(field?.isConnected)range={start:field.selectionStart??field.value.length,end:field.selectionEnd??field.value.length};};
  const focusedField=target=>target?.matches?.(selector);
  const report=message=>{feedback.textContent=message;};
  function clearFieldARIA(){if(field&&fieldARIA)for(const [name,value]of Object.entries(fieldARIA))value===null?field.removeAttribute(name):field.setAttribute(name,value);fieldARIA=null;}
  function syncMode(){
    panel.dataset.mode=mode;search.setAttribute('aria-expanded',String(shown));
    if(mode==='inline'&&field){
      if(!fieldARIA)fieldARIA=Object.fromEntries(['aria-controls','aria-expanded','aria-autocomplete','aria-activedescendant'].map(name=>[name,field.getAttribute(name)]));
      field.setAttribute('aria-controls',results.id);field.setAttribute('aria-expanded','true');field.setAttribute('aria-autocomplete','list');
    }else clearFieldARIA();
    for(const tab of panel.querySelectorAll('[data-tp-memory-tab]'))tab.setAttribute('aria-selected',String(tab.dataset.tpMemoryTab===category&&mode==='button'));
  }
  function close({focus=false}={}) {
    shown=false;session++;insertOperation++;index=null;rows=[];panel.hidden=true;panel.removeAttribute('aria-busy');button?.setAttribute('aria-expanded','false');search.setAttribute('aria-expanded','false');search.removeAttribute('aria-activedescendant');clearFieldARIA();
    if(drawFrame){cancel(drawFrame);drawFrame=0;}if(positionFrame){cancel(positionFrame);positionFrame=0;}
    if(focus&&field?.isConnected){field.focus({preventScroll:true});field.setSelectionRange(range.start,range.end);}
  }
  function mount() {
    if(!alive)return;
    const next=doc.querySelector(selector);
    if(next===field&&button?.isConnected)return;
    close();button?.remove();field=next;button=null;
    if(!field)return;
    button=doc.createElement('button');button.id='tp-memory-button';button.type='button';button.className='tp-memory-button';button.textContent='@';
    button.title='我的資訊・物品・能力';button.setAttribute('aria-label','開啟我的資訊、物品與能力');button.setAttribute('aria-controls',panel.id);button.setAttribute('aria-expanded','false');
    button.addEventListener('mousedown',event=>{event.preventDefault();remember();});
    button.addEventListener('click',()=>{if(shown&&mode==='button')close({focus:true});else open();});
    const left=doc.querySelector('#leftSendForm');
    if(left&&field.closest('#send_form, #form_sheld, #nonQRFormItems')?.contains(left))left.append(button);
    else field.insertAdjacentElement('afterend',button);
  }
  function position() {
    positionFrame=0;if(!alive||!shown||!field?.isConnected)return;
    const viewport=win.visualViewport,view={top:viewport?.offsetTop||0,left:viewport?.offsetLeft||0,width:viewport?.width||win.innerWidth,height:viewport?.height||win.innerHeight};
    const anchor=field.getBoundingClientRect(),layout=memoryPickerLayout(anchor,view,{mode,height:panel.scrollHeight});
    panel.dataset.compact=String(layout.compact);panel.dataset.tiny=String(layout.maxHeight<185);panel.style.width=layout.width+'px';panel.style.maxHeight=layout.maxHeight+'px';panel.style.left=layout.left+'px';
    // Measure after width/compact changes so long text never pushes the popup offscreen.
    const measured=memoryPickerLayout(anchor,view,{mode,height:panel.getBoundingClientRect().height});panel.style.top=measured.top+'px';
  }
  function queuePosition(){if(alive&&shown&&!positionFrame)positionFrame=frame(position);}
  function preview() {
    const row=rows[selected],node=row?nodes.get(row.key):null;
    if(previewNode!==node){previewNode?.setAttribute('aria-selected','false');node?.setAttribute('aria-selected','true');previewNode=node;}
    detailTitle.textContent=row?.title||'';detailText.textContent=row?String(row.detail||row.preview).slice(0,2600):worldText('可在傳音玉符「我」中新增或修改資料。');
    if(!node){search.removeAttribute('aria-activedescendant');if(mode==='inline')field?.removeAttribute('aria-activedescendant');return;}
    search.setAttribute('aria-activedescendant',node.id);if(mode==='inline')field?.setAttribute('aria-activedescendant',node.id);
  }
  function option(row,i) {
    let node=nodes.get(row.key);
    if(!node){
      node=doc.createElement('button');node.type='button';node.setAttribute('role','option');node.setAttribute('aria-selected','false');node.tabIndex=-1;
      node.innerHTML='<span class="tp-memory-option-icon" aria-hidden="true"></span><span class="tp-memory-option-copy"><strong></strong><small></small></span><span class="tp-memory-option-meta"></span>';
      nodes.set(row.key,node);
    }
    node.id='tp-memory-option-'+i;node.className='tp-memory-option tp-memory-option-'+row.category;node.dataset.tpMemoryPick=row.key;node.dataset.tpMemoryIndex=String(i);
    if(node.memoryRow!==row){node.memoryRow=row;node.children[0].textContent=row.kind==='abilities'?'✦':row.kind==='items'?'◇':'我';node.querySelector('strong').textContent=row.title;node.querySelector('small').textContent=row.preview.slice(0,120);node.children[2].textContent=row.quantity!==undefined?'× '+row.quantity:row.typeLabel;}
    return node;
  }
  function draw() {
    drawFrame=0;if(!alive||!shown||!index)return;
    const priorKey=rows[selected]?.key;
    rows=searchMemoryMentionIndex(index,query,{category:mode==='inline'?'all':category,limit:60});
    const sameSelection=rows.findIndex(row=>row.key===priorKey);selected=sameSelection<0?Math.min(selected,Math.max(0,rows.length-1)):sameSelection;
    syncMode();
    const keep=new Set(rows.map(row=>row.key));
    for(const child of [...results.children])if(!keep.has(child.dataset.tpMemoryPick))child.remove();
    rows.forEach((row,i)=>{const node=option(row,i);if(results.children[i]!==node)results.insertBefore(node,results.children[i]||null);});
    // Retain only visible nodes; inventory size cannot grow a hidden DOM cache.
    for(const [key,node]of nodes)if(!keep.has(key)){if(previewNode===node)previewNode=null;nodes.delete(key);}
    if(!rows.length){const empty=doc.createElement('div');empty.className='tp-memory-empty';empty.textContent=worldText('找不到符合的資料。可換個關鍵字，或在玉符「我」中新增。');results.append(empty);}
    preview();queuePosition();
  }
  function queueDraw(){if(alive&&shown&&!drawFrame)drawFrame=frame(draw);}
  async function readState() {
    if(!alive||!shown)return;
    if(pendingRead){readAgain=true;return pendingRead;}
    const currentSession=session,currentRevision=++loadRevision;panel.setAttribute('aria-busy','true');
    const task=(async()=>{
      try{
        const state=await getState();
        if(!alive||!shown||currentSession!==session||currentRevision!==loadRevision)return;
        if(lastPersona&&lastPersona!==state?.persona){selected=0;rows=[];report('已切換使用者，清單已更新。');}
        lastPersona=state?.persona||'';owner.textContent=(lastPersona||'目前使用者')+' · 已儲存資料';
        index=createMemoryMentionIndex(state);queueDraw();
      }catch(error){
        if(!alive||!shown||currentSession!==session)return;
        index=null;rows=[];nodes.clear();results.replaceChildren();const empty=doc.createElement('div');empty.className='tp-memory-empty';empty.textContent='暫時無法讀取「我」的資料';results.append(empty);detailTitle.textContent='';detailText.textContent=String(error?.message||error);queuePosition();
      }finally{
        if(currentSession===session)panel.removeAttribute('aria-busy');
      }
    })();
    pendingRead=task;
    try{await task;}finally{if(pendingRead===task)pendingRead=null;if(readAgain){readAgain=false;if(alive&&shown)void readState();}}
  }
  function refresh(){mount();if(shown&&alive)return readState();index=null;}
  function resetResults(){rows=[];nodes.clear();previewNode=null;results.replaceChildren();detailTitle.textContent='';detailText.textContent='';search.removeAttribute('aria-activedescendant');}
  function show(){shown=true;panel.hidden=false;button?.setAttribute('aria-expanded','true');syncMode();queuePosition();}
  function open(options={}) {
    mount();if(!field||!alive)return;
    remember();session++;index=null;resetResults();mode=options.mode||'button';category=options.category||category;query=options.query||'';selected=0;
    if(options.range)range=options.range;
    search.value=query;show();report('點選即可插入，可連續選取');
    void readState();position();if(mode==='button')search.focus({preventScroll:true});
  }
  async function insert(row) {
    if(!row||!shown||!field||inserting)return;
    const operation=++insertOperation,currentSession=session,target=field,expectedMode=mode,expectedPersona=lastPersona,expectedValue=field.value,expectedRange={...range},expectedCaret={start:field.selectionStart,end:field.selectionEnd};
    inserting=true;
    try {
      const state=await getState();
      if(!alive||!shown||currentSession!==session||operation!==insertOperation||target!==field||!target.isConnected)return;
      if(state?.persona!==expectedPersona){await refresh();report('使用者已切換，請重新選取。');return;}
      if(target.value!==expectedValue||target.selectionStart!==expectedCaret.start||target.selectionEnd!==expectedCaret.end){report('草稿已變更，請重新選取引用。');return;}
      const token=createMemoryMention(state,row),start=Math.min(expectedRange.start,target.value.length),end=Math.min(Math.max(start,expectedRange.end),target.value.length);
      target.setRangeText(token+' ',start,end,'end');range={start:target.selectionStart,end:target.selectionEnd};
      target.dispatchEvent(new win.Event('input',{bubbles:true}));report('已插入「'+row.title+'」，可繼續選取');
      if(expectedMode==='inline')close({focus:true});else{search.focus({preventScroll:true});void refresh();}
    }catch(error){report(String(error?.message||error));notice(String(error?.message||error));void refresh();}
    finally{inserting=false;}
  }
  function onInput(event) {
    if(inserting||composing||event.isComposing||!focusedField(event.target))return;
    if(field!==event.target)mount();remember();
    const trigger=field.selectionStart===field.selectionEnd?memoryTrigger(field.value,field.selectionStart):null;
    if(trigger){
      const wasShown=shown;mode='inline';query=trigger.query;range={start:trigger.start,end:trigger.end};search.value=query;selected=0;rows=[];show();
      if(!wasShown){session++;index=null;resetResults();void readState();}else if(index)queueDraw();
    }else if(mode==='inline')close();
  }
  function onKey(event) {
    if(!shown||!(focusedField(event.target)||panel.contains(event.target)))return;
    if(composing||event.isComposing||event.keyCode===229){if(event.key==='Enter'||event.keyCode===229)event.stopImmediatePropagation();return;}
    if(drawFrame&&index){cancel(drawFrame);drawFrame=0;draw();}
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close({focus:true});return;}
    const navigation=focusedField(event.target)||event.target===search||event.target.closest?.('[data-tp-memory-pick]');
    if(!navigation)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      if(!rows.length)return;event.preventDefault();event.stopImmediatePropagation();selected=(selected+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length;preview();previewNode?.scrollIntoView({block:'nearest'});return;
    }
    if(event.key==='Enter'&&!event.shiftKey&&!index&&pendingRead){event.preventDefault();event.stopImmediatePropagation();report('資料仍在讀取，請稍候再選取。');return;}
    if(event.key==='Enter'&&!event.shiftKey&&rows[selected]){event.preventDefault();event.stopImmediatePropagation();void insert(rows[selected]);}
  }
  removers.push(listen(doc,'input',onInput),listen(doc,'keydown',onKey,true));
  removers.push(listen(doc,'compositionstart',event=>{if(focusedField(event.target)||event.target===search)composing=true;}));
  removers.push(listen(doc,'compositionend',event=>{composing=false;if(event.target===search){query=search.value;selected=0;rows=[];queueDraw();}else onInput(event);}));
  removers.push(listen(doc,'selectionchange',()=>{if(doc.activeElement!==field||inserting||composing)return;if(shown&&mode==='inline'){const t=memoryTrigger(field.value,field.selectionStart);if(field.selectionStart!==field.selectionEnd||!t)close();else if(t.start!==range.start||t.end!==range.end)onInput({target:field});}else if(mode==='button')remember();}));
  removers.push(listen(doc,'pointerdown',event=>{if(shown&&!panel.contains(event.target)&&!button?.contains(event.target)&&event.target!==field)close();}));
  removers.push(listen(search,'input',event=>{if(composing||event.isComposing)return;query=search.value;selected=0;rows=[];queueDraw();}));
  // Prevent compatibility mousedown from blurring the draft after a touch tap;
  // touch scrolling itself remains native because pointerdown is not cancelled.
  removers.push(listen(results,'mousedown',event=>{if(event.target.closest('[data-tp-memory-pick]'))event.preventDefault();}));
  removers.push(listen(panel,'click',event=>{
    if(event.target.closest('[data-tp-memory-close]'))return close({focus:true});
    const tab=event.target.closest('[data-tp-memory-tab]');
    if(tab){mode='button';category=tab.dataset.tpMemoryTab;query='';search.value='';selected=0;rows=[];report('點選即可插入，可連續選取');syncMode();queueDraw();search.focus({preventScroll:true});return;}
    const choice=event.target.closest('[data-tp-memory-pick]');
    if(choice){selected=Number(choice.dataset.tpMemoryIndex)||0;preview();void insert(rows[selected]);}
  }));
  removers.push(listen(results,'pointerover',event=>{if(event.pointerType==='touch')return;const choice=event.target.closest('[data-tp-memory-pick]');if(choice){const next=Number(choice.dataset.tpMemoryIndex)||0;if(selected!==next){selected=next;preview();}}}));
  removers.push(listen(win,'resize',queuePosition),listen(win,'scroll',queuePosition,true),listen(win.visualViewport,'resize',queuePosition),listen(win.visualViewport,'scroll',queuePosition));
  const observer=new win.MutationObserver(()=>{if(!field?.isConnected||!button?.isConnected)mount();});
  observer.observe(doc.body,{childList:true,subtree:true});mount();
  const controller={open,refresh,close,dispose(){if(!alive)return;close();alive=false;loadRevision++;observer.disconnect();removers.forEach(remove=>remove());panel.remove();button?.remove();nodes.clear();if(controllers.get(doc)===controller)controllers.delete(doc);}};
  controllers.set(doc,controller);return controller;
}
