import {clone,uid,newDatabase,defaultSettings} from './schema.js';
import {validateSchema,validateState,applyUpdate,replay,anchorFor,makePrompt,makeBackup,validateBackup,parseCSB21} from './core.js';
export const KEY='csb_character_state_v1';

export class StateController {
  constructor(adapter){this.adapter=adapter;this.onChange=()=>{};this.mvuMessage='尚未同步';this.pendingChats=new WeakSet();this.cache=null;this.revision=0;this.stats={replays:0,resumedMessages:0,cacheHits:0};}
  invalidate(){this.cache=null;this.revision++;}
  context(){const c=this.adapter.context();if(!c?.chatMetadata||!Array.isArray(c.chat))throw Error('請先開啟一個聊天');return c;}
  settings(){const c=this.context();if(!c.extensionSettings[KEY])c.extensionSettings[KEY]=defaultSettings();return c.extensionSettings[KEY];}
  db(){const c=this.context();if(!c.chatMetadata[KEY])c.chatMetadata[KEY]=newDatabase(this.settings().template);return c.chatMetadata[KEY];}
  getSnapshot({readOnly=false}={}){
    const c=this.context(),db=readOnly?(c.chatMetadata[KEY]??newDatabase(c.extensionSettings?.[KEY]?.template)):this.db(),settings=readOnly?(c.extensionSettings?.[KEY]??defaultSettings()):this.settings();
    if(!readOnly){if(this.ensureIds(c))this.pendingChats.add(c.chatMetadata);this.migrateInformation(c,db);}
    const entries=c.chat.map(m=>[m,m.mes,m.swipe_id??0,!!m.is_user,!!m.is_system,m.extra?.csb_uid,m.extra?.csb_order]);
    const prior=this.cache,refs=[db,db.seed,db.schema,db.schema.fields.length,db.schema.groups.length,db.manual,db.manual.length,db.locks,db.pinned,db.ignoredIds,settings.allowNew,settings.enabled,settings.inlineCards];
    const sameRefs=prior&&refs.every((v,i)=>v===prior.refs[i])&&(!readOnly?prior.capture:true);
    const prefix=sameRefs&&prior.entries.length<=entries.length&&prior.entries.every((row,i)=>row.every((v,j)=>v===entries[i][j]));
    if(prefix&&prior.entries.length===entries.length){this.stats.cacheHits++;return {...prior.snapshot,settings};}
    const result=replay(db,c.chat,{capture:!readOnly,allowNew:settings.allowNew,...(prefix?{resume:prior.snapshot.result}:{})});
    this.stats.replays++;if(prefix)this.stats.resumedMessages+=entries.length-prior.entries.length;
    const snapshot={db,settings,result,state:result.state,revision:++this.revision};
    this.cache={refs,entries,snapshot,capture:!readOnly};return snapshot;
  }
  migrateInformation(c,db){
    if(db.informationVersion===1)return;
    if(db.manual?.length){
      db.legacyManualBackup??=clone(db.manual);
      const orders=new Map(c.chat.map(m=>[m.extra.csb_uid,m.extra.csb_order]));
      for(const event of db.manual){
        if(event.kind==='information')continue;
        const id=event.anchor?.split(':')[0];
        event.kind='information';event.afterOrder=event.anchor==='start'?0:(orders.get(id)??Math.max(0,...orders.values()));
      }
    }
    db.informationVersion=1;this.invalidate();
  }
  assertContext(c){if(this.context().chatMetadata!==c.chatMetadata)throw Error('聊天已切換，取消對原聊天的操作');}
  async flush(c=this.context(),messagesChanged=false){this.assertContext(c);if(messagesChanged||this.pendingChats.has(c.chatMetadata)){await c.saveChat();this.pendingChats.delete(c.chatMetadata);}this.assertContext(c);await c.saveMetadata();this.assertContext(c);}
  async persist(c=this.context(),messagesChanged=false){this.invalidate();await this.flush(c,messagesChanged);this.onChange();}
  ensureIds(c){let changed=false;const db=this.db();let order=Math.max(db.nextOrder??1,1,...c.chat.map(m=>Number.isSafeInteger(m.extra?.csb_order)?m.extra.csb_order+1:1));for(const m of c.chat){m.extra??={};if(!m.extra.csb_uid){m.extra.csb_uid=uid('m');changed=true;}if(!Number.isSafeInteger(m.extra.csb_order)||m.extra.csb_order<1){m.extra.csb_order=order++;changed=true;}}db.nextOrder=order;return changed;}
  addManual(payload){const c=this.context(),db=this.db();const changed=this.ensureIds(c);const anchor=c.chat.length?anchorFor(c.chat.at(-1)):'start';const afterOrder=Math.max(0,...c.chat.map(m=>m.extra.csb_order));db.manual.push({id:uid('e'),kind:'information',anchor,afterOrder,payload:clone(payload),createdAt:Date.now()});this.invalidate();return changed;}
  async saveCharacter(update,locks,pinned,isNew){
    const c=this.context(),{db,state}=this.getSnapshot();
    // Validate the entire transaction before touching persisted data.
    const verified=applyUpdate(state,db.schema,{version:1,characters:[update]},{manual:true});
    if(isNew&&Object.hasOwn(state.characters,update.id))throw Error('角色 ID 已存在');
    for(const [key,val]of Object.entries(locks))if(!db.schema.fields.some(f=>f.id===key))throw Error('鎖定欄位不存在');
    if(isNew){db.seed.characters[update.id]=clone(verified.state.characters[update.id]);db.seed.characters[update.id].present=false;}
    const durableUpdate={...update,name:update.name??verified.state.characters[update.id].name};
    const changed=this.addManual({version:1,characters:[durableUpdate]});db.locks[update.id]=clone(locks);
    db.pinned=db.pinned.filter(id=>id!==update.id);if(pinned)db.pinned.push(update.id);
    await this.persist(c,changed);
  }
  async saveSchema(schema){const c=this.context(),next=validateSchema(schema),db=this.db();
    // Configuration edits do not rewrite stored snapshots. Validate conversions against live data.
    const old=this.getSnapshot().state;
    for(const f of next.fields){const prev=db.schema.fields.find(p=>p.id===f.id);if(prev&&prev.type!==f.type)throw Error('不能直接變更既有欄位類型，請新增欄位');}
    for(const f of db.schema.fields)if(!next.fields.some(n=>n.id===f.id))throw Error('請使用停用欄位保留資料，不能直接刪除欄位 ID');
    validateState(old,next);db.schema=next;await this.persist(c);
  }
  async saveTemplate(schema){const c=this.context();this.settings().template=validateSchema(schema);await c.saveSettingsDebounced();this.onChange();}
  async saveSettings(settings){const c=this.context();this.getSnapshot();if(!Number.isFinite(settings.promptBudget)||settings.promptBudget<6000||settings.promptBudget>500000)throw Error('提示預算需介於 6000～500000 字元');c.extensionSettings[KEY]=clone(settings);await c.saveSettingsDebounced();await this.persist(c);}
  async importTemplate(schema){const next=validateSchema(schema),old=this.db().schema,merged=clone(old);
    for(const g of next.groups){const i=merged.groups.findIndex(x=>x.id===g.id);if(i<0)merged.groups.push(g);else merged.groups[i]=g;}
    for(const f of next.fields){const i=merged.fields.findIndex(x=>x.id===f.id);if(i<0)merged.fields.push(f);else merged.fields[i]=f;}
    await this.saveSchema(merged);
  }
  exportBackup(){const {db,state}=this.getSnapshot();return makeBackup(db,state);}
  validateImport(data){return validateBackup(data);}
  async importBackup(data){const valid=validateBackup(data),c=this.context();const changed=this.ensureIds(c),db=newDatabase(valid.schema);
    db.seed=valid.state;db.locks=valid.locks;db.pinned=valid.pinned;db.ignoredIds=c.chat.map(m=>m.extra.csb_uid);
    c.chatMetadata[KEY]=db;await this.persist(c,changed);
  }
  async importLegacy(source){const c=this.context(),s=this.getSnapshot(),converted=parseCSB21(source,s.db.schema,s.state);
    // Validate before schema or journal mutation, preserving existing data on malformed imports.
    applyUpdate(s.state,converted.schema,converted.payload,{manual:true});s.db.schema=converted.schema;
    const changed=this.addManual(converted.payload);await this.persist(c,changed);
  }
  legacyFromChat(){return this.context().chat.filter(m=>!m.is_user).map(m=>m.mes).join('\n');}
  promptInfo(){const {db,state,settings}=this.getSnapshot();const copy=clone(state);for(const c of Object.values(copy.characters))c.locked=Object.keys(db.locks[c.id]??{});
    return makePrompt(copy,db.schema,settings,{recentText:this.context().chat.slice(-4).map(m=>m.mes).join('\n'),pinned:db.pinned});
  }
  async rebuild(){this.invalidate();await this.persist();}
  async setInlineCards(enabled){if(typeof enabled!=='boolean')throw Error('正文顯示必須是布林值');await this.saveSettings({...this.settings(),inlineCards:enabled});return enabled;}
  mvu(){const m=this.adapter.getMvu?.();return m&&typeof m.getMvuData==='function'&&typeof m.replaceMvuData==='function'?m:null;}
  mvuStatus(){return this.mvu()?`已偵測到 MVU · ${this.mvuMessage}`:'未偵測到 MVU；內建變量功能可獨立使用。';}
  async pushMvu(){
    const m=this.mvu();if(!m)throw Error('未偵測到已啟動的 MVU');const c=this.context();if(!c.chat.length)throw Error('至少需要一則訊息才能同步到 MVU');
    const index=c.chat.length-1,swipe=c.chat[index].swipe_id??0,mes=c.chat[index].mes;
    const opts={type:'message',message_id:index};const previous=await m.getMvuData(opts);this.assertContext(c);
    if((c.chat[index]?.swipe_id??0)!==swipe||c.chat[index]?.mes!==mes)throw Error('回覆已變更，取消 MVU 同步');
    if(!previous||typeof previous!=='object'||!previous.stat_data||typeof previous.stat_data!=='object')throw Error('MVU 尚未初始化此訊息的 stat_data');
    const data=clone(previous);data.stat_data.csb=this.exportBackup();
    await m.replaceMvuData(data,opts);this.assertContext(c);this.mvuMessage='已同步角色資料';
  }
  async pullMvu(){
    const m=this.mvu();if(!m)throw Error('未偵測到已啟動的 MVU');const c=this.context();if(!c.chat.length)throw Error('沒有可讀取的 MVU 訊息');
    const data=await m.getMvuData({type:'message',message_id:c.chat.length-1});this.assertContext(c);
    const valid=validateBackup(data?.stat_data?.csb);
    // Pull as a manual, branch-local update; no unrelated MVU namespace is consumed.
    const merged=clone(this.db().schema);
    for(const g of valid.schema.groups)if(!merged.groups.some(x=>x.id===g.id))merged.groups.push(g);
    for(const f of valid.schema.fields){const old=merged.fields.find(x=>x.id===f.id);if(old&&old.type!==f.type)throw Error('MVU 模板與本地欄位類型衝突');if(!old)merged.fields.push(f);}
    const payload={version:1,scene:valid.state.scene,present:Object.values(valid.state.characters).filter(c=>c.present).map(c=>c.id),characters:Object.values(valid.state.characters).map(c=>({id:c.id,name:c.name,aliases:c.aliases,set:Object.fromEntries(Object.entries(c.values).filter(([key])=>!merged.fields.find(f=>f.id===key)?.hidden)),reason:'從 MVU 讀回'}))};
    applyUpdate(this.getSnapshot().state,merged,payload,{manual:true});this.db().schema=validateSchema(merged);const changed=this.addManual(payload);await this.persist(c,changed);this.mvuMessage='已讀回角色資料（本地鎖定優先）';
  }
}
