import test from 'node:test';
import assert from 'node:assert/strict';
import {StateController} from '../src/controller.js';
import {clone,field} from '../src/schema.js';
import {createCharacterStateBridge,characterStateScope,CHANGE_EVENT} from '../src/bridge.js';

const message=(energy=0)=>({mes:`正文<CSB_UPDATE>${JSON.stringify({version:1,characters:[{id:'c_a',name:'甲',set:{energy},reason:'當前事件'}]})}</CSB_UPDATE>`,is_user:false});
function harness(){
  let c={chatId:'story',characterId:0,characters:[{avatar:'a.png'}],chatMetadata:{},chat:[message()],extensionSettings:{},saveMetadata:async()=>{},saveChat:async()=>{},saveSettingsDebounced:()=>{}};
  const context=()=>c,controller=new StateController({context}),opened=[];
  const target=new EventTarget();target.CustomEvent=class extends Event{constructor(type,{detail}){super(type);this.detail=detail;}};
  const bridge=createCharacterStateBridge({context,snapshot:()=>controller.getSnapshot(),openEditor:(...args)=>opened.push(args),openManager:()=>opened.push('manager'),target});
  return {context,controller,bridge,opened,target,switchChat(next){c=next;}};
}

test('public snapshots are isolated clones and preserve zero, false and custom schema',()=>{
  const h=harness(),db=h.controller.db();db.schema.fields.push(field('custom','可見','basic','boolean',{default:false}));
  db.seed.characters.c_seed={id:'c_seed',name:'乙',aliases:[],present:false,values:{custom:false}};
  const snapshot=h.bridge.api.getSnapshot();assert.equal(h.bridge.api.apiVersion,1);assert.equal(snapshot.state.characters.c_a.values.energy,0);assert.equal(snapshot.state.characters.c_seed.values.custom,false);
  snapshot.state.characters.c_a.values.energy=99;snapshot.schema.fields[0].label='外部修改';snapshot.locks.c_a={energy:100};snapshot.pinned.push('c_a');
  const fresh=h.bridge.api.getSnapshot();assert.equal(fresh.state.characters.c_a.values.energy,0);assert.notEqual(fresh.schema.fields[0].label,'外部修改');assert.deepEqual(fresh.locks,{});assert.deepEqual(fresh.pinned,[]);
});
test('scope separates character avatars, groups, story files and no active chat',()=>{
  const c={chatId:'s',characterId:0,characters:[{avatar:'a.png'}]};
  assert.equal(characterStateScope(c),'[null,"a.png","s"]');
  assert.notEqual(characterStateScope(c),characterStateScope({...c,groupId:'group'}));
  assert.notEqual(characterStateScope(c),characterStateScope({...c,characters:[{avatar:'b.png'}]}));
  assert.notEqual(characterStateScope(c),characterStateScope({...c,getCurrentChatId:()=> 'other'}));
  assert.equal(characterStateScope({...c,chatId:''}),'');
});
test('switching chats never returns the previous story character',()=>{
  const h=harness(),previous=h.bridge.api.getSnapshot();
  h.switchChat({...h.context(),chatId:'b',chatMetadata:{},chat:[]});
  const current=h.bridge.api.getSnapshot();assert.notEqual(current.scope,previous.scope);assert.deepEqual(current.state.characters,{});
  assert.throws(()=>h.bridge.api.openEditor('c_a',{scope:previous.scope}),/已變動/);
  h.switchChat({...h.context(),chatId:''});assert.equal(h.bridge.api.getSnapshot(),null);
});
test('state edits follow the selected swipe and reflect disabled setting',async()=>{
  const h=harness(),c=h.context();assert.equal(h.bridge.api.getSnapshot().state.characters.c_a.values.energy,0);
  c.chat[0].mes=message(80).mes;c.chat[0].swipe_id=1;assert.equal(h.bridge.api.getSnapshot().state.characters.c_a.values.energy,80);
  await h.controller.saveSettings({...h.controller.settings(),enabled:false});
  assert.equal(h.bridge.api.getSnapshot().enabled,false);assert.throws(()=>h.bridge.api.openEditor('c_a'),/停用/);
  assert.equal(h.bridge.api.openManager(),true);assert.deepEqual(h.opened,['manager']);
});
test('editor rejects stale scope and missing ID, opens only current stable ID',()=>{
  const h=harness(),scope=h.bridge.api.getSnapshot().scope;
  assert.throws(()=>h.bridge.api.openEditor('c_a',{scope:'old'}),/已變動/);assert.throws(()=>h.bridge.api.openEditor('missing',{scope}),/找不到/);
  assert.equal(h.bridge.api.openEditor('c_a',{scope}),true);assert.equal(h.opened[0][0],'c_a');assert.equal(h.opened[0][1].scope,scope);
});
test('notifications deduplicate snapshots and carry scope only, including manual/schema/disabled changes',async()=>{
  const h=harness(),events=[],subscribed=[];h.target.addEventListener(CHANGE_EVENT,e=>events.push(e.detail));
  const unsubscribe=h.bridge.api.subscribe(detail=>subscribed.push(detail));
  assert.equal(h.bridge.notify(),true);assert.equal(h.bridge.notify(),false);h.bridge.api.getSnapshot();assert.equal(h.bridge.notify(),false);
  await h.controller.saveCharacter({id:'c_a',set:{trust:60}},{},false,false);assert.equal(h.bridge.notify(),true);
  const schema=clone(h.controller.db().schema);schema.fields[0].label='年歲';await h.controller.saveSchema(schema);assert.equal(h.bridge.notify(),true);
  await h.controller.saveSettings({...h.controller.settings(),enabled:false});assert.equal(h.bridge.notify(),true);
  assert.equal(events.length,4);assert.equal(subscribed.length,4);for(const event of events)assert.deepEqual(Object.keys(event),['scope']);
  unsubscribe();h.switchChat({...h.context(),chatId:'',chatMetadata:{},chat:[]});assert.equal(h.bridge.notify(),true);assert.deepEqual(events.at(-1),{scope:''});assert.equal(subscribed.length,4);
  h.bridge.dispose();assert.equal(h.bridge.api.getSnapshot(),null);assert.equal(h.bridge.notify(),false);assert.throws(()=>h.bridge.api.openEditor('c_a'),/已變動/);
});

test('standalone initialization is idempotent, preserves external ownership, and removes listeners on dispose',async()=>{
  const module=await import('../index.js');
  const saved=Object.fromEntries(['SillyTavern','document','csbCharacterStateIntercept','CSBCharacterState'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const handlers=new Map(),events=['CHAT_CHANGED','MESSAGE_RECEIVED','MESSAGE_EDITED','GENERATION_STARTED','GENERATION_ENDED'];
  const c={chatId:'test',chatMetadata:{},chat:[],extensionSettings:{},eventTypes:Object.fromEntries(events.map(x=>[x,x])),eventSource:{on(event,fn){if(!handlers.has(event))handlers.set(event,new Set());handlers.get(event).add(fn);},removeListener(event,fn){handlers.get(event)?.delete(fn);}},setExtensionPrompt(){},saveMetadata:async()=>{},saveChat:async()=>{}};
  try{
    globalThis.document={getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[]};globalThis.SillyTavern={getContext:()=>c};
    const external=()=>{};globalThis.csbCharacterStateIntercept=external;
    assert.equal(module.initialize(),null);assert.equal(globalThis.csbCharacterStateIntercept,external);assert.equal(handlers.size,0);
    delete globalThis.csbCharacterStateIntercept;
    const api=module.initialize();assert.equal(api.apiVersion,1);assert.equal(module.initialize(),api);assert.equal(handlers.get('CHAT_CHANGED').size,1);assert.equal(globalThis.csbCharacterStateIntercept,module.intercept);
    c.chat.push(message(10));const before=JSON.stringify([c.chat,c.chatMetadata,c.extensionSettings]);
    assert.equal(api.getSnapshot().state.characters.c_a.values.energy,10);assert.equal(JSON.stringify([c.chat,c.chatMetadata,c.extensionSettings]),before,'public reads do not initialize metadata or write source messages');
    module.dispose();assert.equal(globalThis.CSBCharacterState,undefined);assert.equal(globalThis.csbCharacterStateIntercept,undefined);assert.ok([...handlers.values()].every(x=>x.size===0));assert.equal(api.getSnapshot(),null);
    module.dispose();assert.equal(globalThis.CSBCharacterState,undefined);
  }finally{module.dispose();for(const [key,descriptor]of Object.entries(saved)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
