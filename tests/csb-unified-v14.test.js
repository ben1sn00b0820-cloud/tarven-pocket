import test from 'node:test';
import assert from 'node:assert/strict';
import {createCharacterStateRuntime} from '../pocket/csb-runtime.js';
import {createCharacterStateBridge} from '../companions/csb-character-state/src/bridge.js';

function fixture(){const c={chatId:'a',chat:[],chatMetadata:{},extensionSettings:{},saveSettingsDebounced(){}};return c;}
test('known standalone is disposed before bundled controller starts; metadata survives',async()=>{
 const c=fixture(),metadata=c.chatMetadata,globals={CSBCharacterState:{apiVersion:1}},order=[];
 const node={src:'https://host/scripts/extensions/third-party/csb-character-state/index.js'};
 const doc={querySelectorAll:()=>[node],getElementById:()=>null,createElement:()=>({remove(){}}),head:{append(){}}};
 const next={apiVersion:1,runtimeVersion:'1.5.0'};
 const runtime=createCharacterStateRuntime({context:()=>c,globals,document:doc,loadExternal:async url=>{assert.equal(url,node.src);return {ownsRuntime:()=>true,dispose(){order.push('old-dispose');delete globals.CSBCharacterState;}};},load:async()=>({initialize(){order.push('new-start');globals.CSBCharacterState=next;return next;},ownsRuntime:()=>true,setMessageFormatter(){}})});
 assert.equal(await runtime.start(),next);assert.deepEqual(order,['old-dispose','new-start']);assert.equal(c.chatMetadata,metadata);
 assert.deepEqual(c.extensionSettings.disabledExtensions,['third-party/csb-character-state']);
});
test('unknown external remains untouched when lifecycle cannot safely release its listeners',async()=>{
 const c=fixture(),old={apiVersion:1},globals={CSBCharacterState:old},messages=[];let loaded=0;
 const runtime=createCharacterStateRuntime({context:()=>c,globals,notice:x=>messages.push(x),load:async()=>{loaded++;}});
 assert.equal(await runtime.start(),old);assert.equal(loaded,0);assert(messages.some(x=>x.includes('停用舊獨立 CSB')));
});
test('public role mutations validate chat scope and dispatch separate current vs fixed operations',async()=>{
 const c=fixture(),calls=[],state={characters:{c_a:{id:'c_a',name:'甲',present:true}}},snapshot=()=>({revision:2,settings:{},db:{schema:{fields:[],groups:[]},deletedCharacters:{c_b:{name:'乙'}}},state});
 const {api}=createCharacterStateBridge({context:()=>c,snapshot,setCurrentPresence:(id,value)=>calls.push(['current',id,value]),setPresence:(id,value)=>calls.push(['fixed',id,value]),deleteCharacter:id=>calls.push(['delete',id]),restoreCharacter:id=>calls.push(['restore',id])});
 await api.setCurrentPresence('c_a',false);await api.setPresence('c_a','present');await api.deleteCharacter('c_a');await api.restoreCharacter('c_b');
 assert.deepEqual(calls,[['current','c_a',false],['fixed','c_a','present'],['delete','c_a'],['restore','c_b']]);
 assert.throws(()=>api.setCurrentPresence('c_a','absent'),/布林/);await assert.rejects(api.deleteCharacter('c_a',{scope:'stale'}),/已變動/);
});

test('cancelling while the standalone module loads leaves its runtime and enabled setting intact',async()=>{
 const c=fixture(),old={apiVersion:1},globals={CSBCharacterState:old},node={src:'https://host/scripts/extensions/third-party/csb-character-state/index.js'};
 let release,disposed=0,loads=0;const doc={querySelectorAll:()=>[node],getElementById:()=>null};
 const runtime=createCharacterStateRuntime({context:()=>c,globals,document:doc,loadExternal:()=>new Promise(r=>release=r),load:async()=>{loads++;}});
 const pending=runtime.start();runtime.dispose();release({ownsRuntime:()=>true,dispose(){disposed++;delete globals.CSBCharacterState;}});
 assert.equal(await pending,null);assert.equal(disposed,0);assert.equal(loads,0);assert.equal(globals.CSBCharacterState,old);assert.equal(c.extensionSettings.disabledExtensions,undefined);
});

test('an external owner replacement during discovery is not disposed or disabled',async()=>{
 const c=fixture(),old={apiVersion:1},next={apiVersion:1},globals={CSBCharacterState:old},node={src:'https://host/scripts/extensions/third-party/csb-character-state/index.js'};
 let release,disposed=0;const doc={querySelectorAll:()=>[node],getElementById:()=>null};
 const runtime=createCharacterStateRuntime({context:()=>c,globals,document:doc,loadExternal:()=>new Promise(r=>release=r),load:async()=>{throw Error('should not load');}});
 const pending=runtime.start();globals.CSBCharacterState=next;release({ownsRuntime:()=>true,dispose(){disposed++;}});
 assert.equal(await pending,next);assert.equal(disposed,0);assert.equal(c.extensionSettings.disabledExtensions,undefined);runtime.dispose();assert.equal(globals.CSBCharacterState,next);
});

test('late bundled import after cancellation cannot initialize or dispose another live owner',async()=>{
 const c=fixture(),globals={};let release,loaded,initialized=0,disposed=0;
 const loading=new Promise(r=>loaded=r),module={initialize(){initialized++;return globals.CSBCharacterState;},ownsRuntime:()=>true,dispose(){disposed++;delete globals.CSBCharacterState;}};
 const runtime=createCharacterStateRuntime({context:()=>c,globals,load:()=>{loaded();return new Promise(r=>release=r);}});
 const pending=runtime.start();await loading;runtime.dispose();const replacement={apiVersion:1};globals.CSBCharacterState=replacement;release(module);
 assert.equal(await pending,null);assert.equal(initialized,0);assert.equal(disposed,0);assert.equal(globals.CSBCharacterState,replacement);
});

test('dynamic companion import is side-effect free; matching extension script remains auto-start eligible',async()=>{
 const module=await import('../companions/csb-character-state/index.js');
 const url='https://host/scripts/extensions/third-party/csb-character-state/index.js?v=4';
 assert.equal(module.isRuntimeEntryPoint({querySelectorAll:()=>[],baseURI:'https://host/'},url),false);
 assert.equal(module.isRuntimeEntryPoint({querySelectorAll:()=>[{src:url}],baseURI:'https://host/'},url),true);
 assert.equal(module.isRuntimeEntryPoint({querySelectorAll:()=>[{src:url+'other'}],baseURI:'https://host/'},url),false);
 const keys=['SillyTavern','document','CSBCharacterState','CSBCharacterStateRuntime','csbCharacterStateIntercept'],saved=Object.fromEntries(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 try{
  const c=fixture();c.eventSource={on(){throw Error('dynamic import must not register listeners');}};c.eventTypes={};
  globalThis.SillyTavern={getContext:()=>c};globalThis.document={querySelectorAll:()=>[]};
  delete globalThis.CSBCharacterState;delete globalThis.CSBCharacterStateRuntime;delete globalThis.csbCharacterStateIntercept;
  await import('../companions/csb-character-state/index.js?side-effect-free-import');
  assert.equal(globalThis.CSBCharacterState,undefined);assert.equal(globalThis.CSBCharacterStateRuntime,undefined);
 }finally{for(const [key,descriptor] of Object.entries(saved)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
});
