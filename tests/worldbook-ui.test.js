import test from 'node:test';
import assert from 'node:assert/strict';
import {worldbookResultsMarkup, worldbookReadingMarkup, toggleWorldbookPin, openWorldbookBrowser} from '../pocket/worldbook-ui.js';

const entry = {book:'大型世界書',entryId:'9500',title:'時間停止',preview:'可暫停時間。',chars:45000};
const results = {entries:[entry],books:Array.from({length:12},(_,i)=>({name:'書'+i})),enabledEntries:12000,totalChars:18000000,total:65,offset:0,limit:30,nextOffset:30};
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const handlers = {}, attributes = {}, calls = [], notices = [], callbacks = [];
  let live = true, scope = 'chat-A';
  const body = {innerHTML:'',classList:{add(){}},setAttribute:(name,value)=>{attributes[name]=value;},addEventListener:(type,handler)=>{handlers[type]=handler;}};
  const dialog = {body,get live(){return live;},onClose:fn=>callbacks.push(fn),close(){if(!live)return;live=false;callbacks.forEach(fn=>fn());}};
  const ctx = {notify:message=>notices.push(message),dialog:()=>dialog,api:{
    pocketState:async()=>({scope}),pocketAction:async(action,payload)=>{calls.push({action,payload});return action==='worldbooks.search' ? structuredClone(results) : {...entry,content:'第 '+payload.offset+' 段',offset:payload.offset,totalChars:45000,nextOffset:payload.offset+12000<45000?payload.offset+12000:null};}
  }};
  const click = async(action,index=0)=>{handlers.click({target:{closest:()=>({dataset:{loreAction:action,index:String(index)}})},preventDefault(){}});await settle();await settle();};
  return {ctx,dialog,body,calls,notices,handlers,attributes,click,switch:()=>{scope='chat-B';}};
}

test('worldbook results retain large counts, paginate, and escape source markup',()=>{
  const hostile = {...entry,title:'<img src=x onerror=alert(1)>',book:'<svg/onload=1>',preview:'<script>attack()</script>'};
  const html=worldbookResultsMarkup({...results,entries:[hostile]});
  assert.match(html,/12,000 個啟用條目/);assert.match(html,/18,000,000 字元 · 12 本世界書/);
  assert.match(html,/data-lore-action="previous" disabled/);assert.doesNotMatch(html,/data-lore-action="next" disabled/);
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|<img|<svg/);
});

test('large entry reader shows page position and escapes complete page content',()=>{
  const html=worldbookReadingMarkup({...entry,content:'<script>bad()</script>',offset:12000,totalChars:45000,nextOffset:24000},{pins:[entry]});
  assert.match(html,/第 12,001–12,022 字元／共 45,000/);assert.match(html,/已固定 · 取消/);
  assert.match(html,/&lt;script&gt;bad\(\)&lt;\/script&gt;/);assert.doesNotMatch(html,/<script>/);
  assert.doesNotMatch(html,/data-lore-action="read-previous" disabled/);
  const last=worldbookReadingMarkup({...entry,content:'結尾',offset:44998,totalChars:45000,nextOffset:null});
  assert.match(last,/data-lore-action="read-next" disabled/);
});

test('worldbook pin identifies book and entry independently, preserves inputs, and toggles',()=>{
  const pins=[{book:'同名條目一',entryId:'1'}], before=structuredClone(pins);
  const selected=toggleWorldbookPin(pins,{book:'同名條目二',entryId:'1',content:'不要複製內容'});
  assert.deepEqual(pins,before);assert.equal(selected.length,2);assert.equal(selected[1].content,undefined);
  assert.deepEqual(toggleWorldbookPin(selected,{book:'同名條目二',entryId:'1'}),pins);
  assert.throws(()=>toggleWorldbookPin(pins,{}),/識別無效/);
});

test('worldbook browser pages reads and updates pins without a model call or wholebook payload',async()=>{
  const f=fixture();let pins=[];
  await openWorldbookBrowser(f.ctx,{names:['大型世界書'],getPins:()=>pins,onPinsChange:value=>{pins=value;}});
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].action,'worldbooks.search');
  assert.deepEqual(f.calls[0].payload,{names:['大型世界書'],query:'',offset:0,limit:30,refresh:false});
  await f.click('pin');assert.deepEqual(pins,[{book:'大型世界書',entryId:'9500'}]);
  await f.click('read');assert.equal(f.calls.at(-1).action,'worldbooks.read');assert.equal(f.calls.at(-1).payload.limit,12000);
  await f.click('read-next');assert.equal(f.calls.at(-1).payload.offset,12000);
  await f.click('read-previous');assert.equal(f.calls.at(-1).payload.offset,0);
  await f.click('back');await f.click('next');assert.equal(f.calls.at(-1).payload.offset,30);
  await f.click('refresh');assert.equal(f.calls.at(-1).payload.refresh,true);
  assert.ok(f.calls.every(call=>['worldbooks.search','worldbooks.read'].includes(call.action)));
});

test('worldbook browser rejects empty book selection and closes on chat switch before pinning',async()=>{
  const f=fixture();let pins=[];
  await assert.rejects(openWorldbookBrowser(f.ctx,{names:[]}),/先勾選/);assert.equal(f.calls.length,0);
  await openWorldbookBrowser(f.ctx,{names:['大型世界書'],getPins:()=>pins,onPinsChange:value=>{pins=value;}});
  f.switch();await f.click('pin');assert.equal(f.dialog.live,false);assert.deepEqual(pins,[]);
  assert.match(f.notices.at(-1),/對話已切換/);
});

test('worldbook browser discards late results after its dialog closes',async()=>{
  const f=fixture();let complete;
  f.ctx.api.pocketAction=()=>new Promise(resolve=>{complete=resolve;});
  const opening=openWorldbookBrowser(f.ctx,{names:['大型世界書']});await settle();
  const before=f.body.innerHTML;f.dialog.close();complete({...results,entries:[{...entry,title:'LATE_NEW_RESULT'}]});
  await opening;assert.equal(f.body.innerHTML,before);assert.doesNotMatch(f.body.innerHTML,/LATE_NEW_RESULT/);
});
