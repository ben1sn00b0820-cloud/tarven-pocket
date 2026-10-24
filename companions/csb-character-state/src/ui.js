import {TYPES,POLICIES,clone,uid,field,valueOf} from './schema.js';
import {validateSchema,normalizeValue,parseJSON} from './core.js';

export function el(tag,attrs={},...children){return elementIn(document,tag,attrs,...children);}
export function elementIn(doc,tag,attrs={},...children){
  const node=doc.createElement(tag);
  for(const [k,v]of Object.entries(attrs)){
    if(v===null||v===undefined||v===false)continue;
    if(k==='class')node.className=v;
    else if(k==='text')node.textContent=v;
    else if(k.startsWith('on'))node.addEventListener(k.slice(2).toLowerCase(),v);
    else if(k==='checked'||k==='disabled'||k==='open'||k==='multiple')node[k]=!!v;
    else if(k==='value')node.value=v;
    else node.setAttribute(k,v===true?'':String(v));
  }
  for(const child of children.flat(Infinity)){if(child!==null&&child!==undefined&&child!==false)node.append(child&&typeof child==='object'&&typeof child.nodeType==='number'?child:doc.createTextNode(String(child)));}
  return node;
}
const btn=(label,fn,cls='')=>el('button',{type:'button',class:`csb-btn ${cls}`,onclick:fn},label);
const note=t=>el('p',{class:'csb-muted'},t);
const empty=t=>el('div',{class:'csb-empty'},t);
const format=(v,f)=>v===null||v===undefined||v===''?'未設定':Array.isArray(v)?v.join('、'):typeof v==='boolean'?(v?'是':'否'):`${v}${f.unit?' '+f.unit:''}`;
export function barView(f,v,doc=document){
  const el=(tag,attrs,...children)=>elementIn(doc,tag,attrs,...children);
  const known=typeof v==='number'&&Number.isFinite(v),pct=known?Math.max(0,Math.min(100,(v-f.min)/(f.max-f.min)*100)):0;
  let label='未知';if(known)label=f.display==='percent'?`${Math.round(pct)}%`:f.display==='none'?'':`${v}${f.unit?` ${f.unit}`:''} / ${f.max}`;
  const stage=known?[...(f.thresholds||[])].reverse().find(t=>v>=t.at)?.label:null;
  const fill=el('div',{class:'csb-bar-fill'});fill.style.width=`${pct}%`;fill.style.background=f.color;
  const bar=el('div',{class:`csb-bar-track ${known?'':'csb-bar-unknown'}`,role:'progressbar','aria-label':f.label,'aria-valuemin':f.min,'aria-valuemax':f.max,...(known?{'aria-valuenow':v}:{'aria-valuetext':'未知'})},fill);
  return el('div',{class:'csb-gauge'},el('div',{class:'csb-gauge-top'},el('span',{},f.icon?`${f.icon} `:'',f.label),el('strong',{},label)),bar,stage?el('small',{class:'csb-stage'},stage):null);
}
export function characterCard(c,schema,{expanded=false,onEdit=null,pinned=false,document:doc=document}={}){
  const el=(tag,attrs,...children)=>elementIn(doc,tag,attrs,...children);
  const btn=(label,fn,cls='')=>el('button',{type:'button',class:`csb-btn ${cls}`,onclick:fn},label);
  const overview=[c.values.age?`${c.values.age} 歲`:null,c.values.identity,c.values.relation].filter(Boolean).join(' · ');
  const card=el('details',{class:'csb-character',open:expanded,'data-char':c.id});
  const summary=el('summary',{class:'csb-character-head'},el('span',{class:'csb-avatar'},Array.from(c.name)[0]||'◇'),
    el('span',{class:'csb-person'},el('strong',{},c.name),el('small',{},overview||'人物資料待補充')),
    el('span',{class:`csb-presence ${c.present?'is-present':''}`},c.present?'在場':'離場'),el('span',{class:'csb-chevron'},'⌄'));
  card.append(summary);
  let body;const build=()=>{if(body)return;body=el('div',{class:'csb-character-body'});
  if(onEdit)body.append(el('div',{class:'csb-card-actions'},pinned?el('span',{class:'csb-chip'},'已優先載入'):null,btn('編輯角色',()=>onEdit(c.id),'csb-small')));
  for(const group of schema.groups){
    const fields=schema.fields.filter(f=>f.group===group.id&&!f.hidden&&(!f.hideEmpty||![null,undefined,''].includes(valueOf(c,f))));
    if(!fields.length)continue;
    const content=el('div',{class:`csb-field-grid ${group.layout==='list'?'csb-list':''}`});
    for(const f of fields){
      const v=valueOf(c,f);
      if(f.type==='bar')content.append(barView(f,v,doc));
      else content.append(el('div',{class:`csb-value-card ${f.type==='longtext'?'csb-wide':''}`},el('span',{class:'csb-value-label'},f.icon?`${f.icon} `:'',f.label),el('span',{class:`csb-value ${v===null||v===''?'is-empty':''}`},format(v,f))));
    }
    body.append(el('details',{class:'csb-group',open:!group.collapsed},el('summary',{},el('span',{class:'csb-group-icon'},group.icon),group.label,el('span',{class:'csb-group-count'},fields.length)),content));
  }
  card.append(body);};
  card.csbEnsureBody=build;card.addEventListener('toggle',()=>{if(card.open)build();});if(expanded)build();return card;
}
export function statusPanel(state,schema,{showAbsent=false,expanded=false,onManage=null,onEdit=null,pinned=[],title='劇情狀態',document:doc=document}={}){
  const el=(tag,attrs,...children)=>elementIn(doc,tag,attrs,...children);
  const btn=(label,fn,cls='')=>el('button',{type:'button',class:`csb-btn ${cls}`,onclick:fn},label);
  const all=Object.values(state.characters),shown=all.filter(c=>showAbsent||c.present);
  const panel=el('details',{class:'csb csb-panel',open:expanded});
  panel.append(el('summary',{class:'csb-panel-head'},el('span',{class:'csb-emblem'},'◈'),el('span',{},el('strong',{},title),el('small',{},state.scene.location||'CHARACTER ARCHIVE')),el('span',{class:'csb-count'},`${shown.length} 人`),el('span',{class:'csb-chevron'},'⌄')));
  const content=el('div',{class:'csb-panel-body'});
  content.append(el('div',{class:'csb-scene-line'},el('span',{},state.scene.time||'劇情時間未設定'),onManage?btn('管理',onManage,'csb-small'):null));
  if(!shown.length)content.append(empty(all.length?'目前沒有在場角色；完整資料保留於角色庫。':'尚未建立角色。可手動新增、匯入 CSB21，或由下一則劇情建立。'));
  shown.forEach(c=>content.append(characterCard(c,schema,{onEdit,pinned:pinned.includes(c.id),document:doc})));
  panel.append(content);return panel;
}
function control(label,input,hint='') {input.setAttribute('aria-label',label);return el('label',{class:'csb-control'},el('span',{},label),input,hint?el('small',{class:'csb-muted'},hint):null);}
function select(options,value){const s=el('select',{});for(const [v,label]of options)s.append(el('option',{value:v},label));s.value=value;return s;}
function checkbox(checked){return el('input',{type:'checkbox',checked});}
function input(type,value,attrs={}){return el('input',{type,value:value??'',...attrs});}
function modal(title,body,onClose=()=>{}){
  const d=el('dialog',{class:'csb csb-dialog','aria-label':title});
  const close=btn('關閉',()=>d.close(),'csb-close');
  d.append(el('header',{class:'csb-dialog-head'},el('div',{},el('small',{class:'csb-eyebrow'},'CSB / CHARACTER INFORMATION'),el('h2',{},title)),close),body);
  d.addEventListener('close',()=>{d.remove();onClose();},{once:true});document.body.append(d);d.showModal();return d;
}
async function readFile(accept='.json,.txt'){
  return new Promise((resolve,reject)=>{
    const f=input('file','',{accept});f.addEventListener('change',async()=>{try{const file=f.files?.[0];if(!file)return resolve(null);if(file.size>10_000_000)throw Error('檔案超過 10 MB');resolve(await file.text());}catch(e){reject(e);}finally{f.remove();}},{once:true});
    f.addEventListener('cancel',()=>{f.remove();resolve(null);},{once:true});f.style.display='none';document.body.append(f);f.click();
  });
}
export function downloadJson(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=el('a',{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}

// Host contract: all mutations stay in host; the same UI is used by ST and the offline preview.
export function openManager(host,initialTab='characters'){
  let tab=initialTab,search='',filter='all',legacyDraft='';const body=el('div',{class:'csb-manager-body'}),tabs=el('nav',{class:'csb-tabs','aria-label':'角色信息功能'}),area=el('div',{class:'csb-tab-body'}),feedback=el('div',{class:'csb-feedback',role:'status','aria-live':'polite'});
  let dialog;
  const status=(message,error=false)=>{feedback.textContent=message;feedback.classList.toggle('is-error',error);};
  const run=async(fn,success='已儲存')=>{try{await fn();status(success);render();}catch(e){status(e.message,true);}};
  const tabspec=[['characters','角色庫'],['schema','欄位模板'],['data','匯入／備份'],['settings','設定／紀錄']];
  function render(){
    tabs.replaceChildren(...tabspec.map(([id,label])=>btn(label,()=>{tab=id;render();},tab===id?'is-active':'')));
    area.replaceChildren();const snap=host.getSnapshot();
    if(tab==='characters')renderCharacters(snap);
    if(tab==='schema')renderSchema(snap);
    if(tab==='data')renderData(snap);
    if(tab==='settings')renderSettings(snap);
  }
  function renderCharacters(s){
    const chars=Object.values(s.state.characters),q=input('search',search,{placeholder:'搜尋姓名、身分、別名','aria-label':'搜尋角色'}),which=select([['all','全部角色'],['present','只看在場'],['absent','只看離場']],filter),grid=el('div',{class:'csb-roster'});
    const refresh=()=>{const found=chars.filter(c=>(filter==='all'||(filter==='present')===c.present)&&[c.name,...c.aliases,String(c.values.identity??'')].some(x=>x.toLowerCase().includes(search.toLowerCase())));
      grid.replaceChildren(...found.map(c=>characterCard(c,s.db.schema,{onEdit:id=>editCharacter(id),pinned:s.db.pinned.includes(c.id)})));if(!found.length)grid.append(empty('沒有符合條件的角色。'));
    };
    q.addEventListener('input',()=>{search=q.value;refresh();});which.addEventListener('change',()=>{filter=which.value;refresh();});
    area.append(el('div',{class:'csb-section-heading'},el('div',{},el('h3',{},'每個角色，都有自己的故事。'),note(`${chars.filter(c=>c.present).length} 人在場 · ${chars.length} 份角色檔案`)),btn('＋ 新增角色',()=>editCharacter(null),'csb-primary')),
      el('div',{class:'csb-toolbar'},btn('掃描正文',()=>openScanner(host,{mode:'local'})),btn('AI 填表',()=>openScanner(host,{mode:'ai'}),'csb-primary')),el('div',{class:'csb-toolbar'},q,which),grid);refresh();
  }
  function editCharacter(id){
    const s=host.getSnapshot(),c=id?s.state.characters[id]:{id:uid('c'),name:'',aliases:[],present:true,values:{}},form=el('form',{class:'csb-form'}),error=el('p',{class:'csb-error',role:'alert'});
    const name=input('text',c.name,{required:true,maxlength:100}),aliases=input('text',c.aliases.join('、')),present=checkbox(c.present),pin=checkbox(s.db.pinned.includes(c.id));
    form.append(note('角色信息會持續保存；新訊息、切換回覆、離場與省略欄位不會清空設定。只有後續正文的明確條目更新才會改變；勾選「鎖定」可禁止模型修改該欄位。'),el('div',{class:'csb-form-grid'},control('姓名',name),control('別名（以頓號分隔）',aliases),control('目前在場',present),control('優先載入模型',pin,'角色未出場時，也優先提供詳細資料。')));
    const editors=[];
    for(const g of s.db.schema.groups){
      const fields=s.db.schema.fields.filter(f=>f.group===g.id&&!f.hidden);if(!fields.length)continue;
      const rows=el('div',{class:'csb-form-grid'});
      for(const f of fields){const v=valueOf(c,f);let widget;
        if(f.type==='longtext')widget=el('textarea',{rows:3,value:v??'',maxlength:12000});
        else if(f.type==='boolean')widget=select([['','未設定'],['true','是'],['false','否']],v===null?'':String(v));
        else if(f.type==='select')widget=select([['','未設定'],...f.options.map(v=>[v,v])],v??'');
        else if(f.type==='multiselect'){widget=el('select',{multiple:true,size:Math.min(5,f.options.length)});for(const o of f.options){const op=el('option',{value:o},o);op.selected=Array.isArray(v)&&v.includes(o);widget.append(op);}}
        else widget=input(['number','bar'].includes(f.type)?'number':'text',v,{...(['number','bar'].includes(f.type)?{min:f.min,max:f.max,step:'any'}:{maxlength:1000})});
        const lock=checkbox(Object.hasOwn(s.db.locks[c.id]??{},f.id));
        rows.append(el('div',{class:`csb-editor-row ${f.type==='longtext'?'csb-wide':''}`},control(f.label+(f.unit?` · ${f.unit}`:''),widget),el('label',{class:'csb-lock'},lock,'鎖定')));
        editors.push({f,widget,lock,old:v});
      }
      form.append(el('details',{class:'csb-edit-group',open:!g.collapsed},el('summary',{},g.icon,' ',g.label),rows));
    }
    const submit=el('button',{type:'submit',class:'csb-btn csb-primary'},'儲存角色');form.append(error,el('div',{class:'csb-form-footer'},submit));
    const d=modal(id?'編輯角色':'新增角色',form);
    form.addEventListener('submit',async event=>{event.preventDefault();submit.disabled=true;try{
      const set={},locks={};
      for(const {f,widget,lock,old}of editors){let value=widget.value;
        if(f.type==='multiselect')value=[...widget.selectedOptions].map(o=>o.value);
        else if(value==='')value=null;
        else if(['number','bar'].includes(f.type))value=Number(value);
        else if(f.type==='boolean')value=value==='true';
        value=normalizeValue(f,value,false);if(!id||JSON.stringify(value)!==JSON.stringify(old))set[f.id]=value;
        if(lock.checked)locks[f.id]=value;
      }
      await host.saveCharacter({id:c.id,name:name.value.trim(),aliases:aliases.value.split(/[、,，]/).map(s=>s.trim()).filter(Boolean),set,present:present.checked,reason:'使用者手動設定'},locks,pin.checked,!id);
      d.close();status('角色資料已儲存');render();
    }catch(e){error.textContent=e.message;}finally{submit.disabled=false;}});
  }
  function renderSchema(s){
    const schema=s.db.schema;
    area.append(el('div',{class:'csb-section-heading'},el('div',{},el('h3',{},'一份模板，套用所有角色。'),note('改名保留資料；新增欄位依預設值顯示。停用欄位會保留已存內容。')),btn('＋ 新增分區',()=>editGroup(null),'csb-primary')));
    area.append(el('div',{class:'csb-toolbar'},btn('設為新聊天預設',()=>run(()=>host.saveTemplate(schema),'已設為新聊天預設；現有其他聊天不受影響')),btn('匯出模板',()=>downloadJson('CSB_Template.json',{format:'CSB_TEMPLATE',version:1,schema}))));
    for(const g of schema.groups){
      const list=el('div',{class:'csb-schema-list'}),head=el('div',{class:'csb-schema-head'},el('h4',{},g.icon,' ',g.label),el('div',{class:'csb-row-actions'},btn('新增欄位',()=>editField(null,g.id),'csb-small'),btn('編輯',()=>editGroup(g.id),'csb-small')));
      for(const f of schema.fields.filter(f=>f.group===g.id)){
        const move=direction=>run(async()=>{const next=clone(schema),peers=next.fields.filter(x=>x.group===g.id),p=peers.findIndex(x=>x.id===f.id),other=peers[p+direction];if(!other)return;const a=next.fields.findIndex(x=>x.id===f.id),b=next.fields.findIndex(x=>x.id===other.id);[next.fields[a],next.fields[b]]=[next.fields[b],next.fields[a]];await host.saveSchema(next);});
        list.append(el('div',{class:`csb-schema-row ${f.hidden?'is-disabled':''}`},el('span',{class:'csb-field-type'},f.type==='bar'?'▰':'◇'),el('div',{class:'csb-schema-label'},el('strong',{},f.label),el('small',{},`${TYPES[f.type]} · ${POLICIES[f.policy]}${f.hidden?' · 已停用':''}`)),el('div',{class:'csb-row-actions'},btn('↑',()=>move(-1),'csb-icon-btn'),btn('↓',()=>move(1),'csb-icon-btn'),btn('編輯',()=>editField(f.id,g.id),'csb-small'))));
      }
      area.append(el('section',{class:'csb-schema-group'},head,list));
    }
  }
  function editGroup(id){
    const schema=clone(host.getSnapshot().db.schema),g=id?schema.groups.find(x=>x.id===id):{id:uid('g'),label:'',icon:'◇',layout:'grid',collapsed:false};
    const name=input('text',g.label,{required:true,maxlength:80}),icon=input('text',g.icon,{maxlength:8}),layout=select([['grid','雙欄小卡'],['list','單欄列表']],g.layout),fold=checkbox(g.collapsed),form=el('form',{class:'csb-form'}),error=el('p',{class:'csb-error'});
    const move=direction=>{const i=schema.groups.findIndex(x=>x.id===id);if(i+direction<0||i+direction>=schema.groups.length)return;[schema.groups[i],schema.groups[i+direction]]=[schema.groups[i+direction],schema.groups[i]];status('儲存後套用排序');};
    form.append(control('分區名稱',name),control('圖示',icon),control('版式',layout),control('預設收合',fold),id?el('div',{class:'csb-toolbar'},btn('分區上移',()=>move(-1)),btn('分區下移',()=>move(1)),btn('刪除空分區',()=>run(async()=>{if(schema.fields.some(f=>f.group===id))throw Error('請先將此分區的欄位移至其他分區');if(schema.groups.length===1)throw Error('至少保留一個分區');schema.groups=schema.groups.filter(x=>x.id!==id);await host.saveSchema(schema);d.close();}))):null,error,el('button',{type:'submit',class:'csb-btn csb-primary'},'儲存分區'));
    const d=modal('分區設定',form);form.addEventListener('submit',async e=>{e.preventDefault();try{Object.assign(g,{label:name.value.trim(),icon:icon.value,layout:layout.value,collapsed:fold.checked});if(!id)schema.groups.push(g);await host.saveSchema(validateSchema(schema));d.close();render();status('分區已儲存');}catch(e){error.textContent=e.message;}});
  }
  function editField(id,group){
    const s=host.getSnapshot(),schema=clone(s.db.schema),f=id?schema.fields.find(x=>x.id===id):field(uid('f'),'新欄位',group);
    const name=input('text',f.label,{required:true,maxlength:80}),kind=select(Object.entries(TYPES),f.type),section=select(schema.groups.map(g=>[g.id,g.label]),f.group),policy=select(Object.entries(POLICIES),f.policy),unit=input('text',f.unit,{maxlength:30}),icon=input('text',f.icon,{maxlength:8}),color=input('color',f.color),min=input('number',f.min,{step:'any'}),max=input('number',f.max,{step:'any'}),delta=input('number',f.maxDelta,{min:0,step:'any'}),display=select([['value','數值／上限'],['percent','百分比'],['none','只顯示條狀']],f.display),direction=select([['neutral','中性變化'],['positive','增加代表改善'],['negative','增加代表惡化']],f.direction),opts=el('textarea',{rows:3,value:f.options.join('\n')}),stages=el('textarea',{rows:3,value:f.thresholds.map(t=>`${t.at}: ${t.label}`).join('\n')}),description=el('textarea',{rows:3,value:f.description,maxlength:2000}),def=input('text',f.default===null?'':Array.isArray(f.default)?JSON.stringify(f.default):String(f.default)),hideEmpty=checkbox(f.hideEmpty),hidden=checkbox(f.hidden),form=el('form',{class:'csb-form'}),error=el('p',{class:'csb-error',role:'alert'});
    // An existing type remains fixed to preserve all prior messages; create another field for a type migration.
    if(id)kind.disabled=true;
    const numeric=el('div',{class:'csb-form-grid'},control('最小值',min),control('最大值',max),control('單次變動上限',delta,'留空表示不限；只限制模型更新。'),control('數值顯示',display),control('增加時的意義',direction),control('進度條顏色',color),control('分段標籤',stages,'每行：最低值: 標籤，例如 0: 疲憊'));
    const optionsBox=control('選項（每行一項）',opts);
    const refresh=()=>{numeric.hidden=!['number','bar'].includes(kind.value);optionsBox.hidden=!['select','multiselect'].includes(kind.value);};kind.addEventListener('change',refresh);refresh();
    form.append(el('div',{class:'csb-form-grid'},control('欄位名稱',name),control('所屬分區',section),control('欄位類型',kind,id?'既有欄位類型固定；變更類型請新增欄位。':''),control('更新方式',policy),control('單位',unit),control('圖示',icon)),numeric,optionsBox,control('初始值',def,'留空＝未知。多選輸入 JSON 陣列；是／否輸入 true 或 false。'),control('模型更新說明',description,'定義何時改變、如何保留。'),el('div',{class:'csb-form-grid'},control('空值隱藏',hideEmpty),control('停用此欄位',hidden,'停用後不顯示、不供模型更新，資料保留。')),note(`固定 ID：${f.id}`),error,el('button',{type:'submit',class:'csb-btn csb-primary'},'儲存欄位'));
    const d=modal(id?'編輯欄位':'新增欄位',form);form.addEventListener('submit',async e=>{e.preventDefault();try{
      let defaultValue=def.value.trim()||null;if(defaultValue!==null){if(['number','bar'].includes(kind.value))defaultValue=Number(defaultValue);if(['boolean','multiselect'].includes(kind.value))defaultValue=parseJSON(defaultValue);}
      const thresholds=stages.value.split('\n').filter(l=>l.trim()).map(l=>{const m=l.match(/^\s*(-?\d+(?:\.\d+)?)\s*[:：]\s*(.+)$/);if(!m)throw Error('分段標籤請使用「數字: 名稱」');return {at:Number(m[1]),label:m[2].trim()};});
      Object.assign(f,{label:name.value.trim(),group:section.value,type:kind.value,policy:policy.value,unit:unit.value,icon:icon.value,color:color.value,min:Number(min.value),max:Number(max.value),maxDelta:delta.value===''?null:Number(delta.value),display:display.value,direction:direction.value,options:opts.value.split('\n').map(s=>s.trim()).filter(Boolean),thresholds,description:description.value,default:defaultValue,hideEmpty:hideEmpty.checked,hidden:hidden.checked});
      if(!id)schema.fields.push(f);await host.saveSchema(validateSchema(schema));d.close();render();status('欄位已套用所有角色');
    }catch(e){error.textContent=e.message;}});
  }
  function renderData(s){
    const legacy=el('textarea',{rows:7,value:legacyDraft,placeholder:'貼上包含 [CSB21_PANEL]／[CSB21_ROLE] 的原始訊息','aria-label':'CSB21 資料',oninput:e=>{legacyDraft=e.target.value;}});
    area.append(el('h3',{},'帶著角色資料，繼續故事。'),note('完整備份包含模板、角色現況、鎖定與優先載入設定。匯入備份會建立新的狀態起點；原始對話不變。'),
      el('div',{class:'csb-toolbar'},btn('匯出完整備份',()=>downloadJson('CSB_Characters_Backup.json',host.exportBackup()),'csb-primary'),btn('匯入完整備份',()=>run(async()=>{const t=await readFile('.json');if(t===null)return;if(!confirm('以這份備份建立新的角色狀態起點？目前資料會先下載備份。'))return;const data=parseJSON(t);host.validateImport(data);downloadJson('CSB_Before_Import.json',host.exportBackup());await host.importBackup(data);},'備份匯入完成')),btn('匯入欄位模板',()=>run(async()=>{const t=await readFile('.json');if(t===null)return;const v=parseJSON(t);await host.importTemplate(v.schema??v);},'模板已合併，原有欄位保留'))),
      el('section',{class:'csb-data-section'},el('h4',{},'從 CSB21 升級'),note('保留自訂部位名稱；清潔度不會轉成淫蕩值。'),legacy,el('div',{class:'csb-toolbar'},btn('匯入貼上的資料',()=>run(()=>host.importLegacy(legacy.value),'CSB21 已合併到角色庫')),btn('讀取文字檔',()=>run(async()=>{const t=await readFile('.txt,.json');if(t!==null){legacy.value=t;legacyDraft=t;}},'已讀取，請按「匯入貼上的資料」')),host.legacyFromChat?btn('匯入目前聊天 CSB21',()=>run(()=>host.importLegacy(host.legacyFromChat()),'聊天中的 CSB21 已匯入')):null)),
      el('section',{class:'csb-data-section'},el('h4',{},'MVU 橋接'),note(host.mvuStatus()),note('自動同步將本插件資料寫入 stat_data.csb。讀回同一命名空間可手動執行；其他 MVU 變量不會被取代。'),el('div',{class:'csb-toolbar'},btn('立即寫入 MVU',()=>run(()=>host.pushMvu(),'已寫入 MVU')),btn('從 MVU 讀回',()=>run(()=>host.pullMvu(),'MVU 資料已合併')))));
  }
  function renderSettings(s){
    const form=el('form',{class:'csb-form'}),settings=clone(s.settings),items=[];
    for(const [key,label,hint]of [['enabled','啟用角色信息','關閉後停止注入提示與顯示狀態。'],['allowNew','允許模型建立新角色','關閉後只能更新已建立的角色。'],['inlineCards','在正文顯示劇情狀態','只控制正文快照顯示；關閉後角色信息仍持續保存與更新。'],['showAbsent','狀態欄同時顯示離場角色','角色庫始終保留所有角色。'],['mvuSync','完成更新後同步到 MVU','需要先安裝並啟動 MVU。']]){const c=checkbox(settings[key]);items.push([key,c]);form.append(control(label,c,hint));}
    const auto=select([['off','關閉正文掃描'],['local','本機：只識別明確姓名／格式化欄位（免額度）'],['ai','AI：每輪完成後分析正文（額外使用模型額度）']],settings.autoScan??'local'),autoApply=checkbox(settings.autoAIApply===true);
    form.append(control('自動掃描正文',auto,'只在完整回覆收到／編輯後執行，不會在輸入或串流每一個字時掃描。'),control('AI 結果自動新增／補空白',autoApply,'預設關閉，AI 結果等待確認。啟用後仍保留既有欄位、鎖定值與在場名單；需自行核對模型抽取正確性。'));
    const budget=input('number',settings.promptBudget,{min:6000,max:500000,step:1000});form.append(control('角色提示字元預算',budget,'不是 token 數。角色很多時優先載入在場、被提及、已釘選角色；完整資料仍保存。'),el('button',{type:'submit',class:'csb-btn csb-primary'},'儲存設定'));
    form.addEventListener('submit',e=>{e.preventDefault();run(()=>{for(const[k,c]of items)settings[k]=c.checked;settings.autoScan=auto.value;settings.autoAIApply=autoApply.checked;settings.promptBudget=Number(budget.value);return host.saveSettings(settings);});});
    const prompt=host.promptInfo();
    area.append(form,el('section',{class:'csb-data-section'},el('h4',{},'目前模型資料'),note(`載入 ${prompt.selected}／${prompt.total} 位角色詳細資料 · 約 ${prompt.characters} 字元${prompt.overBudget?' · 欄位設定已超過預算，請精簡說明':''}`),prompt.omitted?note(`${prompt.omitted} 位角色目前只提供姓名與 ID；可在角色編輯中開啟優先載入。`):null,btn('查看本輪提示',()=>{modal('注入內容',el('div',{class:'csb-form'},el('textarea',{readonly:true,rows:18,value:prompt.text})));})),
      el('section',{class:'csb-data-section'},el('h4',{},'變化與診斷'),note(`版本 1.2.1 · ${s.result.inactiveEdits||0} 筆手動修改屬於其他回覆分支`),...(s.result.errors||[]).slice(-10).map(e=>el('p',{class:'csb-error'},`第 ${e.index+1} 則：${e.message}`)),...(s.result.warnings||[]).slice(-5).map(e=>note(`第 ${e.index+1} 則：${e.message}`)),el('div',{class:'csb-history'},...(s.result.changes||[]).slice(-30).reverse().map(c=>el('div',{},el('strong',{},`${c.name} · ${c.label}`),el('span',{},`${format(c.old,{})} → ${format(c.value,{})}`),el('small',{},c.reason)))),btn('重新讀取目前對話',()=>run(()=>host.rebuild(),'已依目前訊息重建狀態'))));
  }
  body.append(tabs,feedback,area);dialog=modal('角色信息',body);render();
  return {dialog,refresh(){const active=dialog.ownerDocument.activeElement;if(dialog.contains(active)&&active.matches?.('input,textarea,select,[contenteditable="true"]'))return;if(dialog.ownerDocument.querySelector('dialog.csb-dialog .csb-form'))return;render();},editCharacter};
}

/** A document-local application view backed by the very same persisted database. */
export function mountInformation(container,api,{scope:expectedScope}={}){
  if(!container?.ownerDocument||typeof container.append!=='function')throw TypeError('角色信息需要有效的畫面容器');
  const doc=container.ownerDocument,e=(tag,attrs,...children)=>elementIn(doc,tag,attrs,...children);
  const root=e('section',{class:'csb csb-information-app','aria-label':'角色信息'}),message=e('p',{class:'csb-muted',role:'status'}),count=e('p',{class:'csb-muted'}),list=e('div',{class:'csb-information-roster'});
  const search=e('input',{type:'search',placeholder:'搜尋角色姓名、身分、別名','aria-label':'搜尋角色信息'}),filter=e('select',{'aria-label':'角色顯示範圍'},e('option',{value:'all'},'全部角色'),e('option',{value:'present'},'目前在場'),e('option',{value:'absent'},'目前離場'));
  const inline=e('input',{type:'checkbox','aria-label':'在正文顯示劇情狀態'}),manage=e('button',{type:'button',class:'csb-btn csb-primary'},'管理角色與欄位');
  const scan=e('button',{type:'button',class:'csb-btn'},'掃描正文'),ai=e('button',{type:'button',class:'csb-btn'},'AI 填表');
  root.append(e('header',{},e('h2',{},'角色信息'),e('p',{class:'csb-muted'},'資料持續保存。未更新的條目沿用原值；正文狀態欄只顯示當回合快照。')),e('div',{class:'csb-toolbar'},manage,scan,ai,e('label',{class:'csb-information-toggle'},inline,'在正文顯示劇情狀態')),e('div',{class:'csb-toolbar'},search,filter),count,message,list);container.append(root);
  let alive=true,current=null,lastRevision='',schemaSignature='',cards=new Map(),refreshing=false;
  const showError=error=>{message.textContent=error?.message??String(error);message.classList.add('is-error');};
  function draw(){
    if(!current)return;const query=search.value.trim().toLocaleLowerCase(),characters=Object.values(current.state.characters),pinned=current.pinned??[];
    const shown=characters.filter(c=>(filter.value==='all'||(filter.value==='present')===c.present)&&[c.name,...(c.aliases??[]),String(c.values.identity??'')].some(s=>s.toLocaleLowerCase().includes(query)));
    const nextSchema=JSON.stringify(current.schema),schemaChanged=nextSchema!==schemaSignature;schemaSignature=nextSchema;
    const keep=new Set(characters.map(c=>c.id));for(const id of cards.keys())if(!keep.has(id))cards.delete(id);
    const nodes=shown.map(c=>{const signature=JSON.stringify([c,pinned.includes(c.id)]),old=cards.get(c.id);if(old&&!schemaChanged&&old.signature===signature)return old.node;
      const node=characterCard(c,current.schema,{expanded:!!old?.node.open,pinned:pinned.includes(c.id),document:doc,onEdit:id=>{try{api.openEditor(id,{scope:current.scope});}catch(error){showError(error);}}});
      if(old){const groups=[...old.node.querySelectorAll('.csb-group')].map(g=>g.open);node.querySelectorAll('.csb-group').forEach((g,i)=>{if(groups[i]!==undefined)g.open=groups[i];});}
      cards.set(c.id,{node,signature});return node;});
    list.replaceChildren(...nodes);if(!nodes.length)list.append(e('div',{class:'csb-empty'},characters.length?'沒有符合條件的角色。':'尚未建立角色信息；可從管理介面新增或匯入。'));
    count.textContent=`${characters.filter(c=>c.present).length} 人在場 · ${characters.length} 份持久角色信息 · 顯示 ${shown.length} 人`;
  }
  function refresh(){
    if(!alive||refreshing)return;refreshing=true;
    try{
      const revision=api.getRevision?.();if(current&&revision&&revision===lastRevision)return;
      const snapshot=api.getSnapshot();
      if(!snapshot||(expectedScope!==undefined&&snapshot.scope!==expectedScope)){current=null;lastRevision='';cards.clear();list.replaceChildren();count.textContent='';inline.disabled=true;manage.disabled=true;message.textContent='請在目前聊天重新開啟角色信息。';return;}
      current=snapshot;lastRevision=revision??'';inline.disabled=false;manage.disabled=false;inline.checked=current.inlineCards!==false;message.textContent='';message.classList.remove('is-error');draw();
    }catch(error){showError(error);}finally{refreshing=false;}
  }
  scan.addEventListener('click',()=>{try{if(!api.openScanner)throw Error('請更新 CSB 至 1.2.0');api.openScanner({scope:current?.scope,mode:'local'});}catch(error){showError(error);}});
  ai.addEventListener('click',()=>{try{if(!api.openScanner)throw Error('請更新 CSB 至 1.2.0');api.openScanner({scope:current?.scope,mode:'ai'});}catch(error){showError(error);}});
  search.addEventListener('input',draw);filter.addEventListener('change',draw);
  manage.addEventListener('click',()=>{try{api.openManager({scope:current?.scope});}catch(error){showError(error);}});
  inline.addEventListener('change',async()=>{inline.disabled=true;try{await api.setInlineCards(inline.checked,{scope:current?.scope});lastRevision='';refresh();}catch(error){inline.checked=current?.inlineCards!==false;showError(error);}finally{if(alive)inline.disabled=!current;}});
  const unsubscribe=api.subscribe(refresh);refresh();
  return {refresh,dispose(){if(!alive)return;alive=false;unsubscribe();cards.clear();root.remove();}};
}

/** Review before commit. TextContent/DOM nodes only; no model HTML is executed. */
export function openScanner(host,options={}){
  const initial=host.getSnapshot(),body=el('div',{class:'csb-scan-body csb-form'}),feedback=el('p',{class:'csb-feedback',role:'status','aria-live':'polite'}),results=el('div',{class:'csb-scan-results'});
  const mode=select([['local','本機掃描（免額度）'],['ai','AI 讀正文填表（使用目前模型額度）']],options.mode??'local');
  const limit=select([['1','最新 1 則'],['5','最近 5 則'],['20','最近 20 則'],['all','本聊天（最多最近 60,000 字元）']],String(options.limit??20));
  const merge=select([['fill','只新增角色、補空白欄位'],['changes','預覽明確變更，逐項勾選後更新']],options.merge??'fill');
  const target=select([['','全部角色'],...Object.values(initial.state.characters).map(c=>[c.id,c.name])],options.targetId??'');
  const includeUser=checkbox(false),start=btn('開始掃描',runScan,'csb-primary'),cancel=btn('取消本次掃描',()=>{abort?.abort();host.cancelScan();feedback.textContent='已要求取消；已送出的模型請求可能仍計費，返回結果不會寫入。';}),apply=btn('套用勾選結果',commit,'csb-primary');
  apply.disabled=true;cancel.disabled=true;
  let dialog,proposal=null,editors=[],abort=null,alive=true,running=false;
  function message(text,error=false){feedback.textContent=text;feedback.classList.toggle('is-error',error);}
  function renderProposal(p){
    proposal=p;editors=[];results.replaceChildren();apply.disabled=!p?.rows.length;
    if(!p)return;
    results.append(note(`來源 ${p.sourceCount} 則／${p.sourceCharacters.toLocaleString()} 字元；${p.rows.length} 位可新增或補充。掃描尚未寫入。`));
    if(!p.rows.length)results.append(empty('沒有可採用的新資料。本機掃描不會猜人名；普通敘事可切換 AI 填表。已有值也可能因「只補空白」而保留。'));
    for(const row of p.rows){
      const selected=checkbox(true),name=input('text',row.name,{maxlength:100,readonly:row.existing,'aria-label':`確認姓名 ${row.name}`}),changes=[];
      const card=el('section',{class:'csb-scan-candidate'},control(`${row.existing?'補充':'新增'} ${row.name}`,selected),control('確認角色姓名',name),note(`姓名依據：第 ${(row.evidence?.index??0)+1} 則 · ${row.evidence?.quote??''}`));
      for(const change of row.changes){
        // Replacements require a deliberate check; blank fields are selected by default.
        const on=checkbox(change.old===null||change.old===undefined||change.old===''),entry=el('label',{class:'csb-scan-change'},on,el('span',{},el('strong',{},change.label),el('span',{class:'csb-scan-values'},`${format(change.old,{})} → ${format(change.value,{})}`),el('small',{class:'csb-muted'},`第 ${change.evidence.index+1} 則：${change.evidence.quote}`)));
        card.append(entry);changes.push({field:change.field,on});
      }
      results.append(card);editors.push({row,selected,name,changes});
    }
    if(p.diagnostics.length)results.append(el('details',{class:'csb-scan-diagnostics'},el('summary',{},`診斷與略過項目（${p.diagnostics.length}）`),...p.diagnostics.slice(0,100).map(d=>el('p',{class:'csb-muted'},d))));
  }
  async function runScan(){
    if(running)return;running=true;start.disabled=true;cancel.disabled=false;apply.disabled=true;abort=new AbortController();results.replaceChildren();
    message(mode.value==='ai'?'AI 分析中；只傳本次正文、相關角色與欄位定義，不傳整本世界書。':'正在讀取原始正文，不會掃描畫面上的其他狀態欄。');
    try{const p=await host.scan({mode:mode.value,limit:limit.value==='all'?'all':Number(limit.value),merge:merge.value,targetId:target.value||null,includeUser:includeUser.checked,signal:abort.signal,onProgress:t=>{if(alive)message(t);}});if(alive){renderProposal(p);message('請核對姓名、原值、新值與原文依據，再套用。');}}
    catch(e){if(alive)message(e.message,true);}
    finally{running=false;if(alive){start.disabled=false;cancel.disabled=true;}}
  }
  async function commit(){
    if(!proposal||running)return;apply.disabled=true;
    try{const selected=editors.filter(e=>e.selected.checked).map(e=>({key:e.row.key,name:e.name.value,fields:e.changes.filter(c=>c.on.checked).map(c=>c.field)}));const r=await host.applyScan(proposal.token,selected);message(`已保存 ${r.applied} 位角色、${r.fields} 個欄位。未勾選、未知、鎖定與其他既有資料保持不變。`);proposal=null;results.replaceChildren();}
    catch(e){message(e.message,true);apply.disabled=false;}
  }
  body.append(note('本機掃描讀取 CSB_UPDATE、CSB21 與「姓名：…」等明確資料。AI 可閱讀普通敘事並依目前自訂欄位填表，會額外呼叫酒館目前連線的模型。所有結果都需核對；沒寫到的資訊保持未知。'),el('div',{class:'csb-form-grid'},control('分析方式',mode),control('正文範圍',limit),control('寫入策略',merge),control('指定角色',target)),control('包含使用者已送出的訊息',includeUser,'預設只掃描 AI 正文；不讀輸入框草稿、推理區或整本世界書。'),el('div',{class:'csb-toolbar'},start,cancel,apply),feedback,results);
  dialog=modal('掃描正文／AI 填表',body,()=>{alive=false;abort?.abort();if(running)host.cancelScan();});
  const pending=host.scanPreview();if(pending){renderProposal(pending);message('有一份尚未採用的掃描結果；可直接核對，或重新掃描。');}
  return {dialog};
}
