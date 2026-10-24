import {esc, btn, field, input, textArea, select} from '../ui/common.js';
import {saveFile} from '../download.js';

/** Presets are data only; API credentials stay in the engine settings. */
export async function openImageSettings(ctx) {
  const {api}=ctx, scope=(await api.pocketState()).scope;
  let state=await api.pocketImageState(), draft=null, running=false, note='';
  const d=ctx.dialog('生圖預設與千里傳音模型','');
  d.body.classList.add('pocket-image-settings');
  const models=()=>[['','沿用目前設定'],...state.catalogue.models.map(id=>[id,state.catalogue.modelNames[id]||id])];
  async function valid(){if(!d.live)return false;if((await api.pocketState()).scope!==scope){d.close();throw Error('對話已切換，請重新開啟生圖設定。');}return d.live;}
  function render(){
    if(!d.live)return;
    const p=draft, presets=state.presets||[];
    d.body.innerHTML=`<p class="hint">管理 NovelAI 的畫師串、正面與負面提示詞。千里傳音可獨立選擇模型與預設；API Key 沿用「引擎 → NovelAI」。</p>
      ${note?`<p class="pocket-preset-note" role="status">${esc(note)}</p>`:''}
      <div class="pocket-settings-card"><h3>千里傳音自動生圖</h3>
        ${field('千里傳音使用的預設',select('wechat-preset',state.wechat.presetId,[['','沿用繪圖目前畫風'],...presets.map(x=>[x.id,x.name])]))}
        ${field('千里傳音使用的模型',select('wechat-model',state.wechat.model,[['','依預設／繪圖目前模型'],...models().slice(1)]))}
        <p class="hint">指定的千里傳音模型優先於預設模型。只影響之後生成的圖片。</p>
        ${btn('wechat-image-save','儲存千里傳音生圖設定','primary')}
      </div>
      <div class="pocket-preset-toolbar">${btn('image-preset-new','新增預設','secondary')}<label class="secondary file-button">匯入 JSON<input type="file" data-image-preset-import accept=".json,application/json" aria-label="匯入生圖預設"></label>${btn('image-preset-export-all','匯出全部','secondary')}</div>
      <div class="pocket-preset-list">${presets.map(x=>`<button type="button" class="list-row" data-action="image-preset-pick" data-id="${esc(x.id)}" aria-pressed="${p?.id===x.id}"><span><strong>${esc(x.name)}</strong><small>${esc(state.catalogue.modelNames[x.model]||x.model||'沿用繪圖模型')}</small></span><span>編輯</span></button>`).join('')||'<p class="hint">尚無預設，新增或匯入一份開始。</p>'}</div>
      ${p?`<div class="pocket-settings-card pocket-preset-editor"><h3>${p.id?'編輯預設':'新增預設'}</h3>
        ${field('預設名稱',input('preset-name',p.name,'text','maxlength="80"'))}
        ${field('預設模型',select('preset-model',p.model,models()))}
        ${field('畫師串',textArea('preset-artist',p.artist,'rows="3" maxlength="10000" placeholder="例如 artist:你的畫師標籤"'))}
        ${field('正面提示詞',textArea('preset-positive',p.positive,'rows="4" maxlength="12000" placeholder="固定畫風、品質與構圖標籤"'))}
        ${field('負面提示詞',textArea('preset-negative',p.negative,'rows="4" maxlength="12000" placeholder="希望排除的畫面內容"'))}
        <details><summary>圖片參數（空白則沿用繪圖設定）</summary><div class="pocket-preset-params">${[['width','寬度',64,1856,64],['height','高度',64,1856,64],['steps','步數',1,50,1],['scale','提示詞強度',0,10,.1],['seed','種子（-1 為隨機）',-1,4294967295,1]].map(([key,label,min,max,step])=>field(label,input('param-'+key,p.params?.[key]??'','number',`min="${min}" max="${max}" step="${step}"`))).join('')}</div>${field('採樣器',select('param-sampler',p.params?.sampler||'',[['','沿用繪圖設定'],...state.catalogue.samplers.map(x=>[x,x])]))}</details>
        <div class="pocket-preset-toolbar">${btn('image-preset-save','儲存預設','primary')}${p.id?btn('image-preset-export','匯出此預設','secondary')+btn('image-preset-apply','套用到繪圖','secondary')+btn('image-preset-delete','刪除此預設','danger'):''}</div>
        <p class="hint">「套用到繪圖」會把已儲存的預設設為繪圖 App 的 NovelAI 設定。修改欄位後請先儲存。</p>
      </div>`:''}
      <p class="hint">支援本插件匯出的 JSON、畫風物件或陣列（name、artist、positive／prompt、negative／negative_prompt）。匯入會新增預設。檔案不含 API Key。重新生成圖片可能消耗 NovelAI 額度。</p>`;
    if(running)for(const el of d.body.querySelectorAll('button,input,select,textarea'))el.disabled=true;
  }
  const read=key=>d.body.querySelector(`[data-field="${key}"]`)?.value??'';
  function readDraft(){const params={...(draft?.params||{})};for(const key of ['width','height','steps','scale','seed','sampler']){const v=read('param-'+key);if(v==='')delete params[key];else params[key]=key==='sampler'?v:Number(v);}return {...draft,name:read('preset-name'),model:read('preset-model'),artist:read('preset-artist'),positive:read('preset-positive'),negative:read('preset-negative'),params};}
  async function perform(fn){if(running||!await valid())return;running=true;for(const el of d.body.querySelectorAll('button,input,select,textarea'))el.disabled=true;try{await fn();if(await valid())state=await api.pocketImageState();}catch(e){note=e.message;ctx.notify(e.message,{error:true});}finally{running=false;render();}}
  async function download(id){const value=await api.pocketAction('imagePreset.export',id?{id}:{});if(!await valid())return;await saveFile(ctx.doc,new ctx.win.Blob([typeof value.json==='string'?value.json:JSON.stringify(value.json,null,2)],{type:'application/json'}),value.name||'TavernPocket_ImagePresets.json');note='預設已匯出。';}
  d.body.addEventListener('input',event=>{if(draft&&event.target.matches('[data-field^="preset-"],[data-field^="param-"]'))draft=readDraft();});
  d.body.addEventListener('change',event=>{if(draft&&event.target.matches('[data-field^="preset-"],[data-field^="param-"]'))draft=readDraft();const file=event.target.matches('[data-image-preset-import]')?event.target.files?.[0]:null;if(file)perform(async()=>{if(file.size>(state.limits?.bytes||1048576))throw Error('預設檔案不可超過 1 MB。');const json=await file.text();if(!await valid())return;const result=await api.pocketAction('imagePreset.import',{json});draft=null;note=`已匯入 ${result.importedIds?.length||'新'} 份預設。`;});});
  d.body.addEventListener('click',event=>{const el=event.target.closest('[data-action]');if(!el||running)return;event.preventDefault();const action=el.dataset.action;
    if(action==='image-preset-new'){draft={name:'新生圖預設',artist:'',positive:'',negative:'',model:'',params:{}};note='';render();return;}
    if(action==='image-preset-pick'){draft=structuredClone(state.presets.find(p=>p.id===el.dataset.id));note='';render();return;}
    if(action==='wechat-image-save'){const payload={presetId:read('wechat-preset'),model:read('wechat-model')};perform(async()=>{await api.pocketAction('wechatImage.save',payload);note='千里傳音生圖設定已儲存。';});}
    else if(action==='image-preset-save'){const payload=readDraft();perform(async()=>{const result=await api.pocketAction('imagePreset.save',payload);draft=result.presets?.find(p=>p.id===(result.savedId||result.affectedId||payload.id))||null;note='預設已儲存。';});}
    else if(action==='image-preset-export-all')perform(()=>download());
    else if(action==='image-preset-export')perform(()=>download(draft.id));
    else if(action==='image-preset-apply')perform(async()=>{await api.pocketAction('imagePreset.apply',{id:draft.id});note='已套用到繪圖 App 的 NovelAI。';});
    else if(action==='image-preset-delete')perform(async()=>{await api.pocketAction('imagePreset.delete',{id:draft.id});draft=null;note='預設已刪除。';});
  });
  render();return d;
}
