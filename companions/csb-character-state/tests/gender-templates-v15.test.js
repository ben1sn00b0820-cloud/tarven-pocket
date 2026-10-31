import test from 'node:test';
import assert from 'node:assert/strict';
import {field,defaultSchema,defaultSettings,emptyState,clone,characterTemplate,fieldAppliesTo,fieldsForCharacter} from '../src/schema.js';
import {applyUpdate,validateSchema,validateState,validateBackup,makePrompt} from '../src/core.js';
import {StateController} from '../src/controller.js';
const schema=()=>{const s=defaultSchema();s.fields.push(field('female_note','女性自訂欄位','basic','text',{appliesTo:'female'}),field('male_note','男性自訂欄位','basic','text',{appliesTo:'male'}));return s;};
const person=(extra={})=>({id:'c_a',name:'林青',aliases:[],present:false,values:{},...extra});
const state=c=>({characters:{c_a:c},scene:{time:'',location:''}});
const update=(set,extra={})=>({version:1,characters:[{id:'c_a',set,reason:'正文直接交代',...extra}]});
function harness(){const ctx={chatId:'story',characterId:0,characters:[{avatar:'a.png'}],chat:[],chatMetadata:{},extensionSettings:{},saveMetadata:async()=>{},saveChat:async()=>{},saveSettingsDebounced:()=>{}};const host=new StateController({context:()=>ctx});host.db().schema=schema();return {host,ctx};}

test('legacy fields migrate to common and unknown gender never guesses from names or other features',()=>{
 const legacy=schema();for(const f of legacy.fields)delete f.appliesTo;
 const valid=validateSchema(legacy);assert.ok(valid.fields.every(f=>f.appliesTo==='common'));
 assert.equal(characterTemplate(person({name:'王小姐',values:{build:'女性體態',identity:'母親'}})),'common');
 assert.equal(characterTemplate(person({values:{gender:'未知'}})),'common');
 assert.equal(characterTemplate(person({values:{gender:'非二元'}})),'common');
 assert.equal(characterTemplate(person({values:{gender:'female or male'}})),'common');
});
test('explicit gender supports Chinese and normalized English; override has precedence',()=>{
 for(const gender of ['女','女性','女人','Female',' ＷＯＭＡＮ '])assert.equal(characterTemplate(person({values:{gender}})),'female');
 for(const gender of ['男','男性','男人','MALE','man'])assert.equal(characterTemplate(person({values:{gender}})),'male');
 assert.equal(characterTemplate(person({template:'common',values:{gender:'女性'}})),'common');
 assert.equal(characterTemplate(person({template:'male',values:{gender:'女性'}})),'male');
 assert.equal(characterTemplate(person({template:'auto',values:{gender:'女性'}})),'female');
});
test('applicable field views combine common with selected template and retain hidden data separately',()=>{
 const s=schema(),female=person({values:{gender:'女性',male_note:'保留舊資料'}});
 assert.ok(fieldsForCharacter(s,female).some(f=>f.id==='female_note'));
 assert.ok(!fieldsForCharacter(s,female).some(f=>f.id==='male_note'));
 assert.ok(fieldsForCharacter(s,person()).every(f=>(f.appliesTo??'common')==='common'));
 s.fields.find(f=>f.id==='female_note').hidden=true;
 assert.ok(!fieldsForCharacter(s,female).some(f=>f.id==='female_note'));
 assert.ok(fieldsForCharacter(s,female,{includeHidden:true}).some(f=>f.id==='female_note'));
 assert.equal(female.values.male_note,'保留舊資料');
 assert.equal(fieldAppliesTo({id:'legacy'},female),true);
});
test('schema and backup validation reject unsupported template scopes',()=>{
 let s=schema();s.fields.at(-1).appliesTo='both';assert.throws(()=>validateSchema(s),/模板/);
 s=schema();s.fields.find(f=>f.id==='gender').appliesTo='female';assert.throws(()=>validateSchema(s),/性別欄位/);
 assert.throws(()=>validateState(state(person({template:'guess'})),schema()),/角色模板/);
});
test('model determines the effective template before other fields irrespective of JSON field order',()=>{
 const result=applyUpdate(emptyState(),schema(),update({female_note:'正式設定',male_note:'錯置',gender:'女性'},{name:'林青'}));
 assert.equal(result.state.characters.c_a.values.female_note,'正式設定');
 assert.equal(result.state.characters.c_a.values.male_note,undefined);
 assert.equal(result.state.characters.c_a.values.gender,'女性');
 assert.match(result.warnings.join(''),/不適用/);
});
test('unknown gender only accepts common fields; explicit override rejects model changes and mismatched fields',()=>{
 let result=applyUpdate(state(person()),schema(),update({female_note:'不應填入',male_note:'不應填入',mood:'平靜'}));
 assert.deepEqual(result.state.characters.c_a.values,{mood:'平靜'});
 result=applyUpdate(state(person({template:'male',values:{gender:'女性'}})),schema(),update({female_note:'不應填入',male_note:'可以填入'},{template:'female'}));
 assert.equal(result.state.characters.c_a.template,'male');assert.equal(result.state.characters.c_a.values.male_note,'可以填入');assert.equal(result.state.characters.c_a.values.female_note,undefined);
 assert.match(result.warnings.join(''),/使用者選擇/);
});
test('locked or fixed gender governs applicability instead of an ignored model gender change',()=>{
 let result=applyUpdate(state(person({values:{gender:'女性'}})),schema(),update({gender:'男性',female_note:'保留女性',male_note:'錯置'}));
 assert.equal(result.state.characters.c_a.values.female_note,'保留女性');assert.equal(result.state.characters.c_a.values.male_note,undefined);
 result=applyUpdate(state(person({values:{gender:'男性'}})),schema(),update({male_note:'錯置',female_note:'鎖定女性',gender:'男性'}),{locks:{c_a:{gender:'女性'}}});
 assert.equal(result.state.characters.c_a.values.female_note,'鎖定女性');assert.equal(result.state.characters.c_a.values.male_note,undefined);
});
test('manual template switch preserves all values and processed historical values survive changed applicability',()=>{
 const before=state(person({template:'female',values:{gender:'女性',female_note:'舊女性欄位',male_note:'舊男性欄位'}}));
 let result=applyUpdate(before,schema(),update({}, {template:'male'}),{manual:true});
 assert.deepEqual(result.state.characters.c_a.values,before.characters.c_a.values);assert.equal(result.state.characters.c_a.template,'male');
 result=applyUpdate(result.state,schema(),update({female_note:'已接受的歷史內容'}),{manual:true,historical:true});
 assert.equal(result.state.characters.c_a.values.female_note,'已接受的歷史內容');
 assert.throws(()=>applyUpdate(before,schema(),update({}, {template:'guess'}),{manual:true}),/角色模板/);
});
test('normal generation prompt explains applicability and excludes inactive values from role details',()=>{
 const s=schema(),c=person({template:'female',values:{gender:'女性',female_note:'VISIBLE',male_note:'HIDDEN_SENTINEL'},locked:['female_note','male_note']});
 const prompt=makePrompt(state(c),s,defaultSettings());
 assert.match(prompt.text,/appliesTo/);assert.match(prompt.text,/不可從姓名、外觀或稱呼猜測性別/);
 const details=JSON.parse(prompt.text.split('角色詳細資料：')[1]);
 assert.equal(details[0].values.female_note,'VISIBLE');assert.equal(details[0].values.male_note,undefined);assert.deepEqual(details[0].locked,['female_note']);
 assert.equal(prompt.text.includes('HIDDEN_SENTINEL'),false);
});
test('controller manual selection persists across redraw, reload, backup and delete/restore with locks intact',async()=>{
 const {host,ctx}=harness();await host.saveCharacter({id:'c_a',name:'林青',template:'female',set:{gender:'女性',female_note:'女性資料',male_note:'舊男性資料'}},{male_note:'舊男性資料'},true,true,'auto');
 await host.saveCharacter({id:'c_a',template:'male',set:{}},{male_note:'舊男性資料'},true,false,'auto');
 ctx.chatMetadata=clone(ctx.chatMetadata);assert.equal(host.getSnapshot().state.characters.c_a.template,'male');
 const backup=host.exportBackup(),valid=validateBackup(backup);assert.equal(valid.state.characters.c_a.template,'male');assert.equal(valid.state.characters.c_a.values.female_note,'女性資料');assert.equal(valid.locks.c_a.male_note,'舊男性資料');
 const other=harness();await other.host.importBackup(backup);assert.equal(other.host.getSnapshot().state.characters.c_a.template,'male');
 await other.host.deleteCharacter('c_a');const archive=validateBackup(other.host.exportBackup());assert.equal(archive.deletedCharacters.c_a.character.template,'male');
 await other.host.restoreCharacter('c_a');assert.equal(other.host.getSnapshot().state.characters.c_a.template,'male');assert.equal(other.host.getSnapshot().state.characters.c_a.values.female_note,'女性資料');
});
test('failed template save rolls back and schema template import keeps old values and applicability',async()=>{
 const {host,ctx}=harness();await host.saveCharacter({id:'c_a',name:'林青',set:{female_note:'已有資料'},template:'female'},{},false,true,'auto');
 ctx.saveMetadata=async()=>{throw Error('save failed');};await assert.rejects(()=>host.saveCharacter({id:'c_a',template:'male',set:{}},{},false,false,'auto'),/save failed/);
 assert.equal(host.getSnapshot().state.characters.c_a.template,'female');
 ctx.saveMetadata=async()=>{};const incoming=schema();incoming.fields.find(f=>f.id==='female_note').label='新的女性欄位名稱';await host.importTemplate(incoming);
 assert.equal(host.db().schema.fields.find(f=>f.id==='female_note').appliesTo,'female');assert.equal(host.getSnapshot().state.characters.c_a.values.female_note,'已有資料');
});
test('MVU pull preserves manual template selection without discarding inactive fields',async()=>{
 const {host,ctx}=harness();await host.saveCharacter({id:'c_a',name:'林青',template:'male',set:{gender:'女性',female_note:'保留',male_note:'現用'}},{},false,true,'auto');
 const backup=host.exportBackup(),other=harness();other.ctx.chat.push({is_user:false,mes:'開始'});other.host.adapter.getMvu=()=>({getMvuData:async()=>({stat_data:{csb:backup}}),replaceMvuData:async()=>{}});
 await other.host.pullMvu();const c=other.host.getSnapshot().state.characters.c_a;assert.equal(c.template,'male');assert.equal(c.values.female_note,'保留');assert.equal(c.values.male_note,'現用');
});
test('gender equal to a schema default remains an explicit recorded update after accepted history replay',async()=>{
 const {host,ctx}=harness();host.db().schema.fields.find(f=>f.id==='gender').default='女性';
 host.db().seed.characters.c_a=person();host.invalidate();assert.equal(characterTemplate(host.getSnapshot().state.characters.c_a),'common');
 ctx.chat.push({is_user:false,mes:`<CSB_UPDATE>${JSON.stringify(update({female_note:'已記錄',gender:'女性'}))}</CSB_UPDATE>`});
 let snapshot=host.getSnapshot();assert.equal(snapshot.state.characters.c_a.values.gender,'女性');assert.equal(snapshot.state.characters.c_a.values.female_note,'已記錄');
 assert.equal(Object.values(host.db().processed)[0].payload.characters[0].set.gender,'女性');
 ctx.chatMetadata=clone(ctx.chatMetadata);snapshot=host.getSnapshot();assert.equal(characterTemplate(snapshot.state.characters.c_a),'female');assert.equal(snapshot.state.characters.c_a.values.female_note,'已記錄');
});
