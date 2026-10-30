import test from 'node:test';
import assert from 'node:assert/strict';
import {StateController,KEY} from '../src/controller.js';
import {validateBackup,filterDeletedUpdate} from '../src/core.js';
import {clone} from '../src/schema.js';
const patch=(characters=[],extra={})=>({version:1,characters,...extra});
const row=(present,id='c_a')=>({id,present,reason:'角色進出目前房間'});
const message=payload=>({mes:`場景。<CSB_UPDATE>${JSON.stringify(payload)}</CSB_UPDATE>`,is_user:false});
function harness(){
  let current={chatId:'story-a',characterId:0,characters:[{avatar:'a.png'}],chat:[],chatMetadata:{},extensionSettings:{},saveMetadata:async()=>{},saveChat:async()=>{},saveSettingsDebounced:()=>{}};
  const h=new StateController({context:()=>current});
  h.db().seed.characters={c_a:{id:'c_a',name:'雲璃',aliases:['璃兒'],present:false,values:{identity:'醫師',trust:64}},c_b:{id:'c_b',name:'林青',aliases:[],present:true,values:{identity:'旅客'}}};
  return {h,get c(){return current;},switch(c){current=c;}};
}
test('current presence changes immediately, clears fixed mode, and later explicit story remains authoritative',async()=>{
 const {h,c}=harness();c.chat.push(message(patch([row(false)])));h.getSnapshot();await h.setPresence('c_a','absent');await h.setCurrentPresence('c_a',true);
 assert.equal(h.getSnapshot().state.characters.c_a.present,true);assert.equal(h.db().presenceOverrides.c_a,undefined);
 assert.equal(h.getSnapshot().state.characters.c_b.present,true);assert.equal(h.getSnapshot().state.characters.c_a.values.trust,64);
 c.chat.push(message(patch([])));assert.equal(h.getSnapshot().state.characters.c_a.present,true);
 c.chat.push(message(patch([row(false)])));assert.equal(h.getSnapshot().state.characters.c_a.present,false);
});
test('current presence survives source edits, removed messages, reload and backup import',async()=>{
 const {h,c}=harness();c.chat.push(message(patch([row(false)])));h.getSnapshot();await h.setCurrentPresence('c_a',true);
 c.chat[0].mes='重新編輯';c.chat[0].swipe_id=1;assert.equal(h.getSnapshot().state.characters.c_a.present,true);
 c.chat.pop();assert.equal(h.getSnapshot().state.characters.c_a.present,true);c.chatMetadata=clone(c.chatMetadata);assert.equal(h.getSnapshot().state.characters.c_a.present,true);
 const other=harness();await other.h.importBackup(h.exportBackup());assert.equal(other.h.getSnapshot().state.characters.c_a.present,true);
});
test('deletion removes current and historical cards, locks and pins while leaving other characters intact',async()=>{
 const {h,c}=harness();c.chat.push(message(patch([row(true)])));h.getSnapshot();h.db().locks.c_a={trust:77};h.db().pinned=['c_a','c_b'];await h.setPresence('c_a','present');
 const other=clone(h.getSnapshot().state.characters.c_b);await h.deleteCharacter('c_a');let s=h.getSnapshot();
 assert.equal(s.state.characters.c_a,undefined);assert.equal(s.result.frames[0].characters.c_a,undefined);assert.equal(s.db.locks.c_a,undefined);assert.equal(s.db.presenceOverrides.c_a,undefined);assert.deepEqual(s.db.pinned,['c_b']);assert.deepEqual(s.state.characters.c_b,other);
 assert.equal(s.db.deletedCharacters.c_a.character.values.trust,77);assert.equal(s.db.deletedCharacters.c_a.pinned,true);
});
test('deleted characters cannot return from captured history, new model IDs, aliases or full-roster updates',async()=>{
 const {h,c}=harness();c.chat.push(message(patch([row(true)])));h.getSnapshot();await h.deleteCharacter('c_a');
 c.chat.push(message(patch([{id:'c_new',name:'璃兒',set:{identity:'重新出場'},reason:'舊角色'},row(false,'c_b')],{present:['c_new']})));
 let s=h.getSnapshot();assert.deepEqual(Object.keys(s.state.characters),['c_b']);assert.equal(s.result.errors.length,0);assert.equal(s.state.characters.c_b.present,false);
 c.chatMetadata=clone(c.chatMetadata);s=h.getSnapshot();assert.deepEqual(Object.keys(s.state.characters),['c_b']);
 await h.rebuild();assert.equal(h.getSnapshot().state.characters.c_a,undefined);
});
test('a distinct existing same-name character is preserved when another role is deleted',async()=>{
 const {h,c}=harness();h.db().seed.characters.c_b.name='雲璃';h.invalidate();await h.deleteCharacter('c_a');c.chat.push(message(patch([{id:'c_b',name:'雲璃',set:{mood:'開心'},reason:'微笑'}])));
 const s=h.getSnapshot();assert.equal(s.state.characters.c_b.name,'雲璃');assert.equal(s.state.characters.c_b.values.mood,'開心');assert.equal(s.result.errors.length,0);
});
test('deleted archive and its fixed/automatic presence survive backup roundtrip and explicit restore',async()=>{
 const {h}=harness();await h.setPresence('c_a','present');h.db().locks.c_a={trust:77};h.db().pinned=['c_a'];h.invalidate();await h.deleteCharacter('c_a');
 const backup=h.exportBackup();assert.equal(backup.deletedCharacters.c_a.automaticPresence,false);assert.equal(backup.state.characters.c_a,undefined);
 const other=harness();await other.h.importBackup(backup);assert.equal(other.h.getSnapshot().state.characters.c_a,undefined);
 await other.h.restoreCharacter('c_a');assert.equal(other.h.getSnapshot().state.characters.c_a.values.trust,77);assert.equal(other.h.getSnapshot().state.characters.c_a.present,true);assert.equal(other.h.db().pinned.includes('c_a'),true);
 await other.h.setPresence('c_a','auto');assert.equal(other.h.getSnapshot().state.characters.c_a.present,false);assert.equal(other.h.db().deletedCharacters.c_a,undefined);
});
test('explicit restore uses archived latest values and later story can update them',async()=>{
 const {h,c}=harness();c.chat.push(message(patch([{id:'c_a',set:{mood:'平靜'},reason:'情緒'}])));h.getSnapshot();await h.deleteCharacter('c_a');
 c.chat.push(message(patch([{id:'c_a',name:'雲璃',set:{mood:'錯誤的重新新增'},reason:'角色'}])));h.getSnapshot();await h.restoreCharacter('c_a');assert.equal(h.getSnapshot().state.characters.c_a.values.mood,'平靜');
 c.chat.push(message(patch([{id:'c_a',set:{mood:'期待'},reason:'準備出發'}])));assert.equal(h.getSnapshot().state.characters.c_a.values.mood,'期待');
});
test('manually adding a deleted identity requires explicit restore',async()=>{
 const {h}=harness();await h.deleteCharacter('c_a');await assert.rejects(()=>h.saveCharacter({id:'c_new',name:'雲璃',set:{}},{},false,true,'auto'),/還原/);assert.equal(h.getSnapshot().state.characters.c_new,undefined);
});
test('deletion and presence persistence failures roll back only their staged state',async()=>{
 const {h,c}=harness();h.getSnapshot();c.saveMetadata=async()=>{throw Error('disk failed');};
 await assert.rejects(()=>h.deleteCharacter('c_a'),/disk failed/);assert.equal(h.getSnapshot().state.characters.c_a.name,'雲璃');assert.equal(h.db().deletedCharacters,undefined);
 const manual=clone(h.db().manual);await assert.rejects(()=>h.setCurrentPresence('c_a',true),/disk failed/);assert.equal(h.getSnapshot().state.characters.c_a.present,false);assert.deepEqual(h.db().manual,manual);
});
test('restore failure preserves deleted archive and does not partially recreate role',async()=>{
 const {h,c}=harness();await h.deleteCharacter('c_a');const before=clone(h.exportBackup());c.saveMetadata=async()=>{throw Error('disk failed');};await assert.rejects(()=>h.restoreCharacter('c_a'),/disk failed/);
 assert.equal(h.getSnapshot().state.characters.c_a,undefined);assert.deepEqual(h.exportBackup().deletedCharacters,before.deletedCharacters);
});
test('pending deletion is guarded against concurrent edits and chat changes',async()=>{
 const fixture=harness(),{h,c}=fixture;let release;c.saveMetadata=()=>new Promise(resolve=>{release=resolve;});const original=c.chatMetadata,pending=h.deleteCharacter('c_a');await Promise.resolve();
 await assert.rejects(()=>h.setCurrentPresence('c_b',false),/正在保存/);fixture.switch({...c,chatId:'other',chatMetadata:{},chat:[]});release();await assert.rejects(()=>pending,/切換/);
 assert.equal(original[KEY].deletedCharacters,undefined);fixture.switch(c);assert.equal(h.getSnapshot().state.characters.c_a.name,'雲璃');
});
test('archive validation rejects invalid or overlapping identities and malicious values',async()=>{
 const {h}=harness();await h.deleteCharacter('c_a');const valid=h.exportBackup();assert.equal(validateBackup(valid).deletedCharacters.c_a.character.name,'雲璃');
 const overlap=clone(valid);overlap.state.characters.c_a=clone(valid.deletedCharacters.c_a.character);assert.throws(()=>validateBackup(overlap),/重複/);
 const bad=clone(valid);bad.deletedCharacters.c_a.automaticPresence='false';assert.throws(()=>validateBackup(bad),/布林/);
 const badValue=clone(valid);badValue.deletedCharacters.c_a.character.values.trust='bad';assert.throws(()=>validateBackup(badValue));
});
