import test from 'node:test';
import assert from 'node:assert/strict';
import {createCharacterStateRuntime,stripCharacterStateUpdates} from '../pocket/csb-runtime.js';
import {parsePhoneEvents} from '../pocket/events.js';

const context = () => ({chatId:'a',characterId:0,characters:[{avatar:'a.png'}],chatMetadata:{},extensionSettings:{}});
function fixture() {
  let c=context(), created=false, disposed=0, intercepted=0, loaded=0;
  const globals={}, native={apiVersion:1,openEditor:()=>true,openManager:()=>true};
  const module={initialize(){created=true;globals.CSBCharacterState=native;return native;},ownsRuntime:()=>created,
    setMessageFormatter(){},intercept(){intercepted++;},dispose(){created=false;disposed++;delete globals.CSBCharacterState;}};
  const runtime=createCharacterStateRuntime({context:()=>c,globals,load:async()=>{loaded++;return module;}});
  return {runtime,module,globals,native,read:()=>({disposed,intercepted,loaded}),change:()=>{c=context();c.chatId='b';}};
}

test('bundled runtime starts once, intercepts once, and removes only its owned instance',async()=>{
  const f=fixture();await Promise.all([f.runtime.start(),f.runtime.start()]);
  assert.equal(f.read().loaded,1);await f.runtime.intercept([],1,()=>{},'normal');assert.equal(f.read().intercepted,1);
  f.runtime.dispose();assert.equal(f.read().disposed,1);assert.equal(f.globals.CSBCharacterState,undefined);
  await assert.rejects(()=>f.runtime.start(),/停用/);
});
test('external API and legacy interceptor are never loaded over or disposed',async()=>{
  for(const key of ['CSBCharacterState','csbCharacterStateIntercept']){
    const f=fixture();f.globals[key]=key==='CSBCharacterState'?f.native:()=>{};
    await f.runtime.start();await f.runtime.intercept([]);f.runtime.dispose();
    assert.deepEqual(f.read(),{loaded:0,intercepted:0,disposed:0});assert.ok(f.globals[key]);
  }
});
test('a disabled standalone does not silently start a second bundled CSB',async()=>{
  let loads=0;const c=context();c.extensionSettings.disabledExtensions=['third-party/csb-character-state'];
  const r=createCharacterStateRuntime({context:()=>c,globals:{},load:async()=>{loads++;}});
  assert.equal(await r.start(),null);assert.equal(loads,0);await assert.rejects(()=>r.open(),/尚未啟用/);
});
test('external instance appearing during import remains owned by its original plugin',async()=>{
  const globals={},external={apiVersion:1};let dispose=0;
  const r=createCharacterStateRuntime({context,globals,load:async()=>{
    globals.CSBCharacterState=external;
    return {initialize:()=>null,ownsRuntime:()=>false,dispose:()=>dispose++};
  }});
  assert.equal(await r.start(),external);r.dispose();assert.equal(dispose,0);assert.equal(globals.CSBCharacterState,external);
});
test('native editor cannot open a character after a chat switch during loading',async()=>{
  const f=fixture();const operation=f.runtime.open({id:'c_a'});f.change();await assert.rejects(()=>operation,/聊天已切換/);
});
test('status block quotes never become phone events and positions for real events survive',()=>{
  const event='<phone>'+JSON.stringify({id:'e1',app:'wechat',action:'message',from:'夏',to:'我',text:'晚安'})+'</phone>';
  const text='<CSB_UPDATE>'+event+'</CSB_UPDATE>\n她拿出手機。'+event;
  const result=parsePhoneEvents(text,{withPositions:true});
  assert.equal(result.events.length,1);assert.equal(result.matches[0].start,text.lastIndexOf('<phone>'));
  assert.equal(parsePhoneEvents('<CSB_UPDATE>'+event).events.length,0);
});
test('state stripping leaves prose and ordinary phone blocks unchanged',()=>{
  assert.equal(stripCharacterStateUpdates('前文<CSB_UPDATE>{"x":1}</CSB_UPDATE>後文<phone>{}</phone>'),'前文後文<phone>{}</phone>');
});
