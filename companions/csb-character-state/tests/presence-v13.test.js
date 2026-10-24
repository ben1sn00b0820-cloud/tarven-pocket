import test from 'node:test';
import assert from 'node:assert/strict';
import {StateController,KEY} from '../src/controller.js';
import {applyUpdate,anchorFor,validateState,validateBackup} from '../src/core.js';
import {newDatabase,defaultSchema,clone} from '../src/schema.js';
import {createCharacterStateBridge} from '../src/bridge.js';
const patch=(characters=[],extra={})=>({version:1,characters,...extra});
const row=(present,id='c_a')=>({id,present,reason:present?'此人走進當前房間':'此人離開當前房間'});
const message=payload=>({mes:`當前場景。<CSB_UPDATE>${JSON.stringify(payload)}</CSB_UPDATE>`,is_user:false});
function harness(){
  let current={chatId:'story-a',characterId:0,characters:[{avatar:'a.png'}],chat:[],chatMetadata:{},extensionSettings:{},saveMetadata:async()=>{},saveChat:async()=>{},saveSettingsDebounced:()=>{}};
  const h=new StateController({context:()=>current});
  h.db().seed.characters={c_a:{id:'c_a',name:'雲璃',aliases:['璃兒'],present:false,values:{identity:'醫師',trust:64}},c_b:{id:'c_b',name:'王子昱',aliases:[],present:true,values:{identity:'主角'}}};
  return {h,get c(){return current;},switch(c){current=c;}};
}

test('per-character presence accepts true and false without clearing other characters or fields',()=>{
  const {h}=harness(),s=h.getSnapshot();
  const entered=applyUpdate(s.state,s.db.schema,patch([row(true)]));
  assert.equal(entered.state.characters.c_a.present,true);assert.equal(entered.state.characters.c_b.present,true);
  assert.deepEqual(entered.state.characters.c_a.values,s.state.characters.c_a.values);assert.equal(entered.presenceChanges.length,1);assert.equal(entered.changes.length,0);
  const left=applyUpdate(entered.state,s.db.schema,patch([row(false)]));assert.equal(left.state.characters.c_a.present,false);
  assert.equal(applyUpdate(left.state,s.db.schema,patch([])).state.characters.c_b.present,true);
});
test('presence rejects truthy strings, numbers and null rather than reversing false',()=>{
  const {h}=harness(),s=h.getSnapshot();
  for(const value of ['false','true',0,1,null])assert.throws(()=>applyUpdate(s.state,s.db.schema,patch([row(value)])),/true 或 false/);
  assert.throws(()=>applyUpdate(s.state,s.db.schema,patch([{id:'c_a',present:true}])),/reason/);
  const state=clone(s.state);state.characters.c_a.present='false';assert.throws(()=>validateState(state,s.db.schema),/true 或 false/);
});
test('full roster explicitly replaces presence while omissions preserve current state',()=>{
  const {h}=harness(),s=h.getSnapshot();
  const first=applyUpdate(s.state,s.db.schema,patch([],{present:['c_a']})).state;
  assert.equal(first.characters.c_a.present,true);assert.equal(first.characters.c_b.present,false);
  const none=applyUpdate(first,s.db.schema,patch([],{present:[]})).state;
  assert.equal(none.characters.c_a.present,false);assert.equal(none.characters.c_b.present,false);
});
test('captured journals keep individual presence after invalidation and reload',()=>{
  const {h,c}=harness();c.chat.push(message(patch([row(true)])));assert.equal(h.getSnapshot().state.characters.c_a.present,true);
  assert.equal(h.db().processed[anchorFor(c.chat[0])].payload.characters[0].present,true);
  c.chat.push(message(patch([row(false)])));assert.equal(h.getSnapshot().state.characters.c_a.present,false);
  h.invalidate();assert.equal(h.getSnapshot().state.characters.c_a.present,false);
  c.chatMetadata=clone(c.chatMetadata);assert.equal(h.getSnapshot().state.characters.c_a.present,false);
});
test('legacy accepted journal recovers missing presence without recalculating accepted fields',()=>{
  const {h,c}=harness();c.chat.push(message(patch([{...row(true),set:{trust:90}}])));h.getSnapshot();
  const record=h.db().processed[anchorFor(c.chat[0])];delete record.presenceVersion;delete record.payload.characters[0].present;record.payload.characters[0].set.trust=70;
  h.invalidate();const s=h.getSnapshot();assert.equal(s.state.characters.c_a.present,true);assert.equal(s.state.characters.c_a.values.trust,70);
});
test('fixed modes survive future story updates and auto immediately restores narrative presence',async()=>{
  const {h,c}=harness();c.chat.push(message(patch([row(true)])));h.getSnapshot();
  await h.setPresence('c_a','absent');assert.equal(h.getSnapshot().state.characters.c_a.present,false);
  c.chat.push(message(patch([row(true)],{present:['c_a','c_b']})));assert.equal(h.getSnapshot().state.characters.c_a.present,false);
  c.chatMetadata=clone(c.chatMetadata);assert.equal(h.getSnapshot().state.characters.c_a.present,false);
  await h.setPresence('c_a','auto');assert.equal(h.getSnapshot().state.characters.c_a.present,true);
  await h.setPresence('c_a','present');c.chat.push(message(patch([row(false)])));assert.equal(h.getSnapshot().state.characters.c_a.present,true);
  await h.setPresence('c_a','auto');assert.equal(h.getSnapshot().state.characters.c_a.present,false);
});
test('override updates newest visible assistant card after user text without poisoning history on append',async()=>{
  const {h,c}=harness();c.chat.push(message(patch([row(true)])));h.getSnapshot();c.chat.push({mes:'等一下。',is_user:true});
  await h.setPresence('c_a','absent');let s=h.getSnapshot();assert.equal(s.result.frames[0].characters.c_a.present,false);assert.equal(s.result.rawFrames[0].characters.c_a.present,true);
  c.chat.push(message(patch([])));s=h.getSnapshot();assert.equal(s.result.frames[0].characters.c_a.present,true);assert.equal(s.result.frames[2].characters.c_a.present,false);
  await h.setPresence('c_a','auto');s=h.getSnapshot();assert.equal(s.result.frames[2].characters.c_a.present,true);
});
test('branch-local scanned presence follows source swipe and deletion while saved identity stays',async()=>{
  const {h,c}=harness();c.chat.push(message(patch([])));h.getSnapshot();
  h.addManual(patch([{id:'c_new',name:'林青',set:{identity:'客人'},reason:'掃描確認姓名'}]));
  h.addPresence(patch([row(true,'c_new')]));await h.persist(c);
  assert.equal(h.getSnapshot().state.characters.c_new.present,true);
  c.chat[0].swipe_id=1;assert.equal(h.getSnapshot().state.characters.c_new.present,false);assert.equal(h.getSnapshot().state.characters.c_new.name,'林青');
  c.chat.pop();assert.equal(h.getSnapshot().state.characters.c_new.present,false);assert.equal(h.getSnapshot().state.characters.c_new.values.identity,'客人');
});
test('unrelated character edits leave scene presence and existing fixed mode unchanged',async()=>{
  const {h,c}=harness();c.chat.push(message(patch([row(true)])));h.getSnapshot();await h.setPresence('c_a','absent');
  await h.saveCharacter({id:'c_a',set:{identity:'醫館長老'}},{},false,false);
  assert.equal(h.getSnapshot().state.characters.c_a.present,false);assert.equal(h.db().presenceOverrides.c_a,false);
  assert.equal(Object.hasOwn(h.db().manual.at(-1).payload.characters[0],'present'),false);
  await h.saveCharacter({id:'c_a',set:{},present:false},{},false,false,'auto');assert.equal(h.getSnapshot().state.characters.c_a.present,true);
});
test('character creation stores chosen mode separately and rejects invalid mode before any mutation',async()=>{
  const {h,c}=harness();await h.saveCharacter({id:'c_new',name:'林青',set:{}},{},false,true,'present');
  assert.equal(h.getSnapshot().state.characters.c_new.present,true);assert.equal(h.db().seed.characters.c_new.present,false);
  const before=JSON.stringify(c.chatMetadata);await assert.rejects(()=>h.setPresence('c_new','false'),/在場設定/);await assert.rejects(()=>h.setPresence('missing','present'),/找不到/);assert.equal(JSON.stringify(c.chatMetadata),before);
});
test('failed saves roll back presence and combined character edits',async()=>{
  const {h,c}=harness();h.getSnapshot();const before=clone(h.db());c.saveMetadata=async()=>{throw Error('disk failed');};
  await assert.rejects(()=>h.setPresence('c_a','present'),/disk failed/);assert.deepEqual(h.db().presenceOverrides,before.presenceOverrides);
  await assert.rejects(()=>h.saveCharacter({id:'c_a',set:{identity:'wrong'}},{},true,false,'present'),/disk failed/);
  assert.equal(h.getSnapshot().state.characters.c_a.values.identity,'醫師');assert.deepEqual(h.db().manual,before.manual);assert.deepEqual(h.db().pinned,before.pinned);
});
test('presence save cannot cross chats or allow concurrent mutation while awaiting persistence',async()=>{
  const fixture=harness(),{h,c}=fixture;let release;c.saveMetadata=()=>new Promise(resolve=>{release=resolve;});
  const pending=h.setPresence('c_a','present');await Promise.resolve();
  await assert.rejects(()=>h.setPresence('c_a','absent'),/正在保存/);
  const original=c.chatMetadata;fixture.switch({...c,chatId:'other',chatMetadata:{},chat:[]});release();await assert.rejects(()=>pending,/切換/);
  assert.deepEqual(original[KEY].presenceOverrides,{});assert.equal(Object.keys(h.getSnapshot().state.characters).length,0);
  fixture.switch(c);assert.equal(h.getSnapshot().state.characters.c_a.present,false);
});
test('same mutable host context switching during save is also detected',async()=>{
  const {h,c}=harness();let release;c.saveMetadata=()=>new Promise(resolve=>{release=resolve;});
  const original=c.chatMetadata,pending=h.setPresence('c_a','present');await Promise.resolve();
  c.chatMetadata={};c.chat=[];c.chatId='other';release();await assert.rejects(()=>pending,/切換/);assert.deepEqual(original[KEY].presenceOverrides,{});assert.equal(Object.keys(h.getSnapshot().state.characters).length,0);
});
test('backup preserves fixed mode and hidden automatic presence for returning to auto',async()=>{
  const {h,c}=harness();c.chat.push(message(patch([row(true)])));h.getSnapshot();await h.setPresence('c_a','absent');
  const backup=h.exportBackup();assert.equal(backup.state.characters.c_a.present,false);assert.equal(backup.automaticPresence.c_a,true);
  const other=harness();await other.h.importBackup(backup);assert.equal(other.h.getSnapshot().state.characters.c_a.present,false);await other.h.setPresence('c_a','auto');assert.equal(other.h.getSnapshot().state.characters.c_a.present,true);
  const bad=clone(backup);bad.presenceOverrides.c_a='false';assert.throws(()=>validateBackup(bad),/非布林/);
});
test('MVU preserves fixed modes, keeps local override priority and carries automatic base',async()=>{
  const a=harness();a.c.chat.push(message(patch([row(true)])));a.h.getSnapshot();await a.h.setPresence('c_a','absent');const backup=a.h.exportBackup();
  const b=harness();b.c.chat.push(message(patch([])));b.h.adapter.getMvu=()=>({getMvuData:async()=>({stat_data:{csb:backup}}),replaceMvuData:async()=>{}});
  await b.h.pullMvu();assert.equal(b.h.getSnapshot().state.characters.c_a.present,false);await b.h.setPresence('c_a','auto');assert.equal(b.h.getSnapshot().state.characters.c_a.present,true);
  await b.h.setPresence('c_a','present');await b.h.pullMvu();assert.equal(b.h.db().presenceOverrides.c_a,true);
});
test('public bridge exposes isolated modes and rejects stale revision/scope',async()=>{
  const fixture=harness(),{h}=fixture;h.getSnapshot();
  const bridge=createCharacterStateBridge({context:()=>fixture.c,snapshot:()=>h.getSnapshot(),openEditor:()=>{},setPresence:(id,mode)=>h.setPresence(id,mode)});
  let s=bridge.api.getSnapshot();await bridge.api.setPresence('c_a','present',{scope:s.scope,revision:s.revision});
  await assert.rejects(()=>bridge.api.setPresence('c_a','absent',{scope:s.scope,revision:s.revision}),/已變動/);
  s=bridge.api.getSnapshot();s.presenceOverrides.c_a=false;assert.equal(bridge.api.getSnapshot().presenceOverrides.c_a,true);
  await assert.rejects(()=>bridge.api.setPresence('c_a','absent',{scope:'wrong'}),/已變動/);
  const text=h.promptInfo().text;assert.match(text,/"presenceMode":"present"/);assert.match(text,/遠端傳音／訊息不算實際在場/);
});


test('latest assistant card follows automatic scan presence after a user turn and restores it from fixed mode',async()=>{
  const {h,c}=harness();c.chat.push(message(patch([])));h.getSnapshot();c.chat.push({mes:'看看目前房間。',is_user:true});h.getSnapshot();
  h.addManual(patch([{id:'c_new',name:'林青',set:{identity:'客人'},reason:'掃描確認姓名'}]));
  h.addPresence(patch([row(true),row(true,'c_new')]));await h.persist(c);
  let s=h.getSnapshot();assert.equal(s.result.frames[0].characters.c_a.present,true);assert.equal(s.result.rawFrames[0].characters.c_a.present,false);
  assert.equal(s.result.frames[0].characters.c_new.present,true);assert.equal(s.result.rawFrames[0].characters.c_new,undefined);
  await h.setPresence('c_a','absent');assert.equal(h.getSnapshot().result.frames[0].characters.c_a.present,false);
  await h.setPresence('c_a','auto');assert.equal(h.getSnapshot().result.frames[0].characters.c_a.present,true);
  c.chat[1].mes='換一種問法。';c.chat[1].swipe_id=1;s=h.getSnapshot();assert.equal(s.state.characters.c_a.present,false);assert.equal(s.result.frames[0].characters.c_a.present,false);
});
