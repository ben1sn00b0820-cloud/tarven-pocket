import test from 'node:test';
import assert from 'node:assert/strict';
import {StateController} from '../src/controller.js';
import {applyUpdate,replay,anchorFor,makePrompt} from '../src/core.js';
import {defaultSchema,defaultSettings,emptyState,clone} from '../src/schema.js';
const payload=(set={},extra={})=>({version:1,characters:[{id:'c_a',name:'雲璃',set,reason:'正文有明確事件',...extra}]});
const message=(p,text='雲璃放下了茶杯。')=>({is_user:false,mes:text+(p?`<CSB_UPDATE>${JSON.stringify(p)}</CSB_UPDATE>`:'')});
const harness=()=>{const c={chatId:'story',chat:[],chatMetadata:{},extensionSettings:{},saveMetadata:async()=>{},saveChat:async()=>{},saveSettingsDebounced:async()=>{}};return {c,h:new StateController({context:()=>c})};};
test('saved information survives input, empty patches, unknown values and absence',async()=>{
  const {c,h}=harness();c.chat.push(message(payload({energy:40,trust:80,part_8:'銀戒仍戴在左手',identity:'侍女'})));h.getSnapshot();
  await h.saveCharacter({id:'c_a',set:{identity:'隨行侍女',part_8:'左手戴有家族銀戒'}},{},true,false);
  c.chat.push({is_user:true,mes:'看看任務。'},message({version:1,characters:[],present:[]}),message(payload({part_8:null,identity:''})));
  const s=h.getSnapshot().state.characters.c_a;assert.equal(s.values.identity,'隨行侍女');assert.equal(s.values.part_8,'左手戴有家族銀戒');assert.equal(s.values.energy,40);assert.equal(s.present,false);
  c.chat.push(message({version:1,characters:[],present:['c_a']}));assert.equal(h.getSnapshot().state.characters.c_a.values.trust,80);
  c.chatMetadata=clone(c.chatMetadata);assert.equal(h.getSnapshot().state.characters.c_a.values.part_8,'左手戴有家族銀戒');
});
test('information survives editing, swiping and deleting its original message',async()=>{
  const {c,h}=harness();c.chat.push(message(payload({energy:40,trust:50})));h.getSnapshot();await h.saveCharacter({id:'c_a',set:{trust:88}},{},false,false);
  c.chat[0].mes=message(payload({energy:20,trust:10}),'改寫正文').mes;c.chat[0].swipe_id=1;
  assert.equal(h.getSnapshot().state.characters.c_a.values.trust,88);assert.equal(h.getSnapshot().state.characters.c_a.values.energy,20);
  c.chat.length=0;assert.equal(h.getSnapshot().state.characters.c_a.name,'雲璃');assert.equal(h.getSnapshot().state.characters.c_a.values.trust,88);
});
test('future explicit patches update saved information and deleting them restores it',async()=>{
  const {c,h}=harness();c.chat.push(message(payload({energy:40,trust:50})));h.getSnapshot();await h.saveCharacter({id:'c_a',set:{trust:88}},{},false,false);
  c.chat.push(message(payload({trust:92}),'更信任你。'));assert.equal(h.getSnapshot().state.characters.c_a.values.trust,92);
  c.chat[1].swipe_id=1;c.chat[1].mes=message(payload({trust:75}),'有所疑慮。').mes;assert.equal(h.getSnapshot().state.characters.c_a.values.trust,75);
  c.chat.pop();assert.equal(h.getSnapshot().state.characters.c_a.values.trust,88);
});
test('explicit clearing differs from unknown; model cannot erase aliases by omission',()=>{
  const schema=defaultSchema();let state=applyUpdate(emptyState(),schema,payload({outfit_3:'銀戒'},{aliases:['璃兒']})).state;
  state=applyUpdate(state,schema,payload({outfit_3:null},{aliases:[]})).state;assert.equal(state.characters.c_a.values.outfit_3,'銀戒');assert.deepEqual(state.characters.c_a.aliases,['璃兒']);
  state=applyUpdate(state,schema,payload({}, {clear:['outfit_3']})).state;assert.equal(state.characters.c_a.values.outfit_3,null);
  assert.throws(()=>applyUpdate(state,schema,payload({outfit_3:'銀戒'},{clear:['outfit_3']})),/同時/);
});
test('legacy manual edits migrate without deleting the audit trail',()=>{
  const {c,h}=harness();c.chat.push(message(payload({energy:40})));h.getSnapshot();const db=h.db();
  db.manual.push({id:'e_old',anchor:anchorFor(c.chat[0]),payload:payload({energy:77}),createdAt:1});delete db.informationVersion;c.chat[0].mes=message(payload({energy:30}),'舊訊息改寫').mes;
  assert.equal(h.getSnapshot().state.characters.c_a.values.energy,77);assert.equal(db.legacyManualBackup.length,1);assert.equal(db.manual[0].kind,'information');
});
test('unchanged reads cache; append resumes only new messages; old edits invalidate',()=>{
  const {c,h}=harness();c.chat.push(message(payload({energy:40})));h.getSnapshot();for(let i=0;i<100;i++)h.getSnapshot();assert.equal(h.stats.replays,1);assert.equal(h.stats.cacheHits,100);
  c.chat.push(message(payload({energy:60})));assert.equal(h.getSnapshot().state.characters.c_a.values.energy,60);assert.equal(h.stats.resumedMessages,1);
  c.chat[0].mes=message(payload({energy:12,trust:30})).mes;const edited=h.getSnapshot();assert.equal(edited.state.characters.c_a.values.trust,30);assert.deepEqual(edited.state,replay(h.db(),c.chat,{capture:true}).state);assert.equal(h.stats.replays,3);
});
test('public read mode does not create metadata or assign message IDs',()=>{
  const {c,h}=harness();c.chat.push(message(payload({energy:0})));const before=JSON.stringify(c);assert.equal(h.getSnapshot({readOnly:true}).state.characters.c_a.values.energy,0);assert.equal(JSON.stringify(c),before);
});
test('inline visibility can be disabled without disabling storage or updates',async()=>{
  const {c,h}=harness();c.chat.push(message(payload({energy:40})));h.getSnapshot();await h.setInlineCards(false);assert.equal(h.settings().inlineCards,false);assert.equal(h.settings().enabled,true);
  c.chat.push(message(payload({energy:55})));assert.equal(h.getSnapshot().state.characters.c_a.values.energy,55);assert.equal(h.exportBackup().state.characters.c_a.values.energy,55);
});
test('prompt forbids replacing known fields and specifies changed-only patches',()=>{
  const prompt=makePrompt(emptyState(),defaultSchema(),defaultSettings()).text;assert.ok(prompt.includes('角色信息是持久資料庫'));assert.ok(prompt.includes('characters:[]'));assert.ok(prompt.includes('clear:'));assert.ok(prompt.includes('不得以 null'));
});
