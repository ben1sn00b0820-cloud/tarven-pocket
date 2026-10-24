import {searchMemoryMentions,createMemoryMention} from './mentions.js';
const controllers=new WeakMap();
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function memoryTrigger(value,caret) {
  const before=String(value??'').slice(0,caret),at=Math.max(before.lastIndexOf('@'),before.lastIndexOf('＠'));
  if(at<0||/[A-Za-z0-9_@./-]/.test(before[at-1]||''))return null;
  const query=before.slice(at+1);
  if(query.length>64||/[\r\n【】]/.test(query))return null;
  return {start:at,end:caret,query};
}

/** Read-only selector: choosing a record inserts a reference into the draft.
 * It never submits a message, invokes a model, or changes saved assets. */
export function createMemoryComposer({getState,document:doc=globalThis.document,selector='#send_textarea',notice=()=>{}}={}) {
  if(!doc||typeof getState!=='function')return {refresh(){},open(){},close(){},dispose(){}};
  controllers.get(doc)?.dispose();
  const win=doc.defaultView||globalThis;
  let alive=true,shown=false,mode='button',category='profile',query='',rows=[],selected=0,ticket=0,field=null,button=null,range={start:0,end:0},composing=false,inserting=false,lastPersona='',positionQueued=false;
  const panel=doc.createElement('section');
  panel.id='tp-memory-picker';panel.className='tp-memory-picker';panel.hidden=true;
  panel.setAttribute('role','dialog');panel.setAttribute('aria-label','引用我的資訊、物品與能力');
  panel.innerHTML='<div class="tp-memory-heading"><span class="tp-memory-heading-icon" aria-hidden="true">我</span><div><strong>我的隨身資料</strong><small id="tp-memory-owner">選取後帶入正文草稿</small></div><button type="button" data-tp-memory-close aria-label="關閉資料選擇器">×</button></div><div class="tp-memory-tabs" role="tablist"><button type="button" role="tab" data-tp-memory-tab="profile">我的資訊</button><button type="button" role="tab" data-tp-memory-tab="items">我的物品</button><button type="button" role="tab" data-tp-memory-tab="abilities">我的能力</button></div><label class="tp-memory-search-wrap"><span aria-hidden="true">⌕</span><input id="tp-memory-search" type="search" autocomplete="off" placeholder="搜尋名稱或內容" aria-label="搜尋我的資料"></label><div id="tp-memory-results" class="tp-memory-results" role="listbox" aria-label="可引用資料"></div><div id="tp-memory-detail" class="tp-memory-detail"></div><div class="tp-memory-footer"><span id="tp-memory-feedback" role="status">點選即可插入，可連續選取</span><kbd>↑ ↓ 選擇　Enter 插入</kbd></div>';
  doc.body.append(panel);
  const search=panel.querySelector('#tp-memory-search'),results=panel.querySelector('#tp-memory-results'),detail=panel.querySelector('#tp-memory-detail'),owner=panel.querySelector('#tp-memory-owner'),feedback=panel.querySelector('#tp-memory-feedback');
  const listen=(target,event,fn,options)=>{target?.addEventListener?.(event,fn,options);return()=>target?.removeEventListener?.(event,fn,options);};
  const removers=[];
  const remember=()=>{if(field?.isConnected)range={start:field.selectionStart??field.value.length,end:field.selectionEnd??field.value.length};};
  const focusedField=target=>target?.matches?.(selector);
  const report=message=>{feedback.textContent=message;};

  function close({focus=false}={}) {
    shown=false;ticket++;panel.hidden=true;button?.setAttribute('aria-expanded','false');
    field?.removeAttribute('aria-activedescendant');
    if(focus&&field?.isConnected){field.focus({preventScroll:true});field.setSelectionRange(range.start,range.end);}
  }
  function mount() {
    if(!alive)return;
    const next=doc.querySelector(selector);
    if(next===field&&button?.isConnected)return;
    close();button?.remove();field=next;button=null;
    if(!field)return;
    button=doc.createElement('button');button.id='tp-memory-button';button.type='button';button.className='tp-memory-button';button.textContent='我';
    button.title='我的資訊・物品・能力';button.setAttribute('aria-label','開啟我的資訊、物品與能力');button.setAttribute('aria-controls',panel.id);button.setAttribute('aria-expanded','false');
    button.addEventListener('mousedown',event=>{event.preventDefault();remember();});
    button.addEventListener('click',()=>{if(shown&&mode==='button')close({focus:true});else open();});
    const left=doc.querySelector('#leftSendForm');
    if(left&&field.closest('#send_form, #form_sheld, #nonQRFormItems')?.contains(left))left.append(button);
    else field.insertAdjacentElement('afterend',button);
  }
  function position() {
    positionQueued=false;
    if(!shown||!field?.isConnected)return;
    const viewport=win.visualViewport,top=viewport?.offsetTop||0,left=viewport?.offsetLeft||0,width=viewport?.width||win.innerWidth,height=viewport?.height||win.innerHeight;
    const rect=field.getBoundingClientRect(),panelWidth=Math.min(510,width-20),x=Math.max(left+10,Math.min(rect.left,left+width-panelWidth-10));
    panel.style.width=panelWidth+'px';panel.style.left=x+'px';
    const above=rect.top-top-12,below=top+height-rect.bottom-12;
    const maxHeight=Math.max(150,Math.min(560,Math.max(above,below),height-24));
    panel.style.maxHeight=maxHeight+'px';
    const actual=Math.min(panel.scrollHeight,maxHeight);
    const y=above>=Math.min(actual,220)?rect.top-actual-8:Math.max(top+10,Math.min(rect.bottom+8,top+height-actual-10));
    panel.style.top=Math.max(top+10,y)+'px';
  }
  function queuePosition(){if(positionQueued)return;positionQueued=true;(win.requestAnimationFrame||setTimeout)(position);}
  function preview() {
    const row=rows[selected];
    for(const [index,node]of [...results.querySelectorAll('[data-tp-memory-pick]')].entries())node.setAttribute('aria-selected',String(index===selected));
    if(!row){detail.textContent='可在傳音玉符「我」中新增或修改資料。';field?.removeAttribute('aria-activedescendant');return;}
    detail.innerHTML='<strong>'+esc(row.title)+'</strong><span>'+esc(row.detail||row.preview).slice(0,2600)+'</span>';
    const id='tp-memory-option-'+selected;search.setAttribute('aria-activedescendant',id);
    if(mode==='inline')field?.setAttribute('aria-activedescendant',id);
  }
  function draw(state) {
    rows=searchMemoryMentions(state,query,{category:mode==='inline'?'all':category,limit:60});
    selected=Math.min(selected,Math.max(0,rows.length-1));
    owner.textContent=(state?.persona||'目前使用者')+' · 已儲存資料';
    panel.dataset.mode=mode;
    for(const tab of panel.querySelectorAll('[data-tp-memory-tab]'))tab.setAttribute('aria-selected',String(tab.dataset.tpMemoryTab===category&&mode==='button'));
    results.innerHTML=rows.length?rows.map((row,index)=>'<button type="button" role="option" id="tp-memory-option-'+index+'" class="tp-memory-option tp-memory-option-'+row.category+'" data-tp-memory-pick="'+esc(row.key)+'" data-tp-memory-index="'+index+'"><span class="tp-memory-option-icon" aria-hidden="true">'+(row.kind==='abilities'?'✦':row.kind==='items'?'◇':'我')+'</span><span class="tp-memory-option-copy"><strong>'+esc(row.title)+'</strong><small>'+esc(row.preview.slice(0,120))+'</small></span><span class="tp-memory-option-meta">'+esc(row.quantity!==undefined?'× '+row.quantity:row.typeLabel)+'</span></button>').join(''):'<div class="tp-memory-empty">找不到符合的資料<br><small>試試其他名稱，或先在傳音玉符「我」中新增。</small></div>';
    preview();queuePosition();
  }
  async function refresh() {
    mount();if(!shown||!alive)return;
    const current=++ticket;
    try {
      const state=await getState();
      if(!alive||!shown||current!==ticket)return;
      if(lastPersona&&lastPersona!==state?.persona){selected=0;report('已切換使用者，清單已更新。');}
      lastPersona=state?.persona||'';draw(state);
    }catch(error){if(!alive||!shown||current!==ticket)return;rows=[];results.innerHTML='<div class="tp-memory-empty">暫時無法讀取「我」的資料</div>';detail.textContent=String(error?.message||error);queuePosition();}
  }
  function open(options={}) {
    mount();if(!field||!alive)return;
    remember();mode=options.mode||'button';category=options.category||category;query=options.query||'';selected=0;
    if(options.range)range=options.range;
    search.value=query;shown=true;panel.hidden=false;button?.setAttribute('aria-expanded','true');report('點選即可插入，可連續選取');
    refresh();position();if(mode==='button')search.focus({preventScroll:true});
  }
  async function insert(row) {
    if(!row||!shown||!field)return;
    const current=++ticket,target=field,expectedMode=mode,expectedPersona=lastPersona;
    try {
      const state=await getState();
      if(!alive||!shown||current!==ticket||target!==field||!target.isConnected)return;
      if(state?.persona!==expectedPersona){await refresh();report('使用者已切換，請重新選取。');return;}
      const token=createMemoryMention(state,row),start=Math.min(range.start,target.value.length),end=Math.min(Math.max(start,range.end),target.value.length);
      inserting=true;target.setRangeText(token+' ',start,end,'end');range={start:target.selectionStart,end:target.selectionEnd};
      target.dispatchEvent(new win.Event('input',{bubbles:true}));inserting=false;
      report('已插入「'+row.title+'」，可繼續選取');
      if(expectedMode==='inline')close({focus:true});else{search.focus({preventScroll:true});refresh();}
    }catch(error){inserting=false;report(String(error?.message||error));notice(String(error?.message||error));refresh();}
  }
  function onInput(event) {
    if(inserting||composing||!focusedField(event.target))return;
    if(field!==event.target)mount();remember();
    const trigger=memoryTrigger(field.value,field.selectionStart);
    if(trigger){mode='inline';query=trigger.query;range={start:trigger.start,end:trigger.end};search.value=query;selected=0;if(!shown){shown=true;panel.hidden=false;button?.setAttribute('aria-expanded','true');}refresh();}
    else if(mode==='inline')close();
  }
  function onKey(event) {
    if(!shown||composing||event.isComposing||event.keyCode===229||!(focusedField(event.target)||panel.contains(event.target)))return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close({focus:true});return;}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      if(!rows.length)return;event.preventDefault();event.stopImmediatePropagation();selected=(selected+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length;preview();results.querySelector('#tp-memory-option-'+selected)?.scrollIntoView({block:'nearest'});return;
    }
    if(event.key==='Enter'&&!event.shiftKey&&rows[selected]){event.preventDefault();event.stopImmediatePropagation();insert(rows[selected]);}
  }
  removers.push(listen(doc,'input',onInput),listen(doc,'keydown',onKey,true));
  removers.push(listen(doc,'compositionstart',event=>{if(focusedField(event.target)||event.target===search)composing=true;}));
  removers.push(listen(doc,'compositionend',event=>{composing=false;if(event.target===search){query=search.value;selected=0;refresh();}else onInput(event);}));
  removers.push(listen(doc,'selectionchange',()=>{if(doc.activeElement===field&&!inserting&&mode==='button')remember();}));
  removers.push(listen(doc,'pointerdown',event=>{if(shown&&!panel.contains(event.target)&&!button?.contains(event.target)&&event.target!==field)close();}));
  removers.push(listen(search,'input',()=>{if(composing)return;query=search.value;selected=0;refresh();}));
  removers.push(listen(panel,'click',event=>{
    if(event.target.closest('[data-tp-memory-close]'))return close({focus:true});
    const tab=event.target.closest('[data-tp-memory-tab]');
    if(tab){mode='button';category=tab.dataset.tpMemoryTab;query='';search.value='';selected=0;report('點選即可插入，可連續選取');refresh();search.focus({preventScroll:true});return;}
    const choice=event.target.closest('[data-tp-memory-pick]');
    if(choice){selected=Number(choice.dataset.tpMemoryIndex)||0;preview();insert(rows[selected]);}
  }));
  removers.push(listen(results,'pointerover',event=>{const choice=event.target.closest('[data-tp-memory-pick]');if(choice){selected=Number(choice.dataset.tpMemoryIndex)||0;preview();}}));
  removers.push(listen(win,'resize',queuePosition),listen(win,'scroll',queuePosition,true),listen(win.visualViewport,'resize',queuePosition),listen(win.visualViewport,'scroll',queuePosition));
  const observer=new win.MutationObserver(()=>{if(!field?.isConnected||!button?.isConnected)mount();});
  observer.observe(doc.body,{childList:true,subtree:true});mount();
  const controller={open,refresh,close,dispose(){if(!alive)return;alive=false;ticket++;observer.disconnect();removers.forEach(remove=>remove());panel.remove();button?.remove();field?.removeAttribute('aria-activedescendant');if(controllers.get(doc)===controller)controllers.delete(doc);}};
  controllers.set(doc,controller);return controller;
}
