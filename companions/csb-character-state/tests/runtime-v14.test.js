import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSettings,newDatabase} from '../src/schema.js';

test('auxiliary prompt failures are fail-open and the registered lifecycle releases its observer',async()=>{
  const module=await import('../index.js');
  const keys=['SillyTavern','document','MutationObserver','CSBCharacterState','CSBCharacterStateRuntime','csbCharacterStateIntercept','toastr'];
  const saved=Object.fromEntries(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const savedError=console.error,observers=[],notices=[],handlers=new Map(),prompts={};
  const c={chatId:'runtime-regression',chatMetadata:{csb_character_state_v1:newDatabase()},chat:[],extensionSettings:{csb_character_state_v1:defaultSettings()},
    eventTypes:{MESSAGE_UPDATED:'MESSAGE_UPDATED',GENERATION_ENDED:'GENERATION_ENDED'},
    eventSource:{on(event,fn){if(!handlers.has(event))handlers.set(event,new Set());handlers.get(event).add(fn);},removeListener(event,fn){handlers.get(event)?.delete(fn);}},
    setExtensionPrompt(key,value){prompts[key]=value;},saveChat:async()=>{},saveMetadata:async()=>{}};
  try{
    console.error=()=>{};globalThis.toastr={error:message=>notices.push(message)};
    globalThis.document={body:{},getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[]};
    globalThis.MutationObserver=class{constructor(callback){this.callback=callback;this.live=false;observers.push(this);}observe(){this.live=true;}disconnect(){this.live=false;}};
    globalThis.SillyTavern={getContext:()=>c};delete globalThis.CSBCharacterState;delete globalThis.csbCharacterStateIntercept;delete globalThis.CSBCharacterStateRuntime;
    const api=module.initialize(),lifecycle=globalThis.CSBCharacterStateRuntime;
    assert.equal(lifecycle.version,'1.4.0');assert.equal(lifecycle.intercept,module.intercept);assert.equal(lifecycle.dispose,module.dispose);
    assert.equal(observers.length,1);assert.equal(observers[0].live,true);
    assert.equal(module.initialize(),api);assert.equal(observers.length,1);
    let aborted=0;
    c.chatMetadata.csb_character_state_v1.schema.fields=null;
    await assert.doesNotReject(()=>module.intercept(c.chat,8192,()=>{aborted++;},'normal'));
    assert.equal(aborted,0);assert.equal(prompts.csb_character_state_v1,'');assert.equal(notices.length,1);
    c.chatMetadata=null;
    await assert.doesNotReject(()=>module.intercept(c.chat,8192,()=>{aborted++;},'normal'));
    assert.equal(aborted,0);assert.equal(prompts.csb_character_state_v1,'');assert.equal(notices.length,2);
    c.chatMetadata={csb_character_state_v1:newDatabase()};
    lifecycle.dispose();assert.equal(observers[0].live,false);assert.equal(globalThis.CSBCharacterStateRuntime,undefined);
    assert([...handlers.values()].every(set=>set.size===0));assert.equal(api.getSnapshot(),null);
    lifecycle.initialize();assert.equal(observers.length,2);assert.equal(observers[1].live,true);
    module.dispose();assert.equal(observers[1].live,false);assert([...handlers.values()].every(set=>set.size===0));
  }finally{
    module.dispose();console.error=savedError;
    for(const [key,descriptor] of Object.entries(saved)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  }
});
