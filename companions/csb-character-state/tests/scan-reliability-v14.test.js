import test from 'node:test';
import assert from 'node:assert/strict';
import {StateController} from '../src/controller.js';
import {parseScanResponse,scanResponseText,makeScanProposal,plainBody,collectSources,splitSources,scanLocal} from '../src/scan.js';

function harness(generateScan){
  let ctx={chatId:'a',chat:[{mes:'雲璃是醫者。',is_user:false}],chatMetadata:{},extensionSettings:{},saveMetadata:async()=>{},saveChat:async()=>{},saveSettingsDebounced:async()=>{}};
  const host=new StateController({context:()=>ctx,generateScan});
  return {host,get ctx(){return ctx;},change(){ctx={...ctx,chatId:'b',chat:[],chatMetadata:{}};}};
}
const answer=JSON.stringify({characters:[{name:'雲璃',set:{identity:'醫者'},evidence:{name:{source:'m0.0',quote:'雲璃是醫者。'},identity:{source:'m0.0',quote:'雲璃是醫者。'}}}]});

test('provider text envelopes are normalized without using reasoning or arbitrary object values',()=>{
  for(const response of [
    {choices:[{message:{content:answer,reasoning_content:'ignore'}}]},
    {choices:[{text:answer}]}, {text:answer},{content:[{type:'thinking',thinking:'ignore'},{type:'text',text:answer}]},
    {output:[{type:'reasoning',content:[]},{type:'message',content:[{type:'output_text',text:answer}]}]},
    {output_text:answer}
  ])assert.equal(parseScanResponse(response)[0].name,'雲璃');
  assert.throws(()=>scanResponseText({reasoning_content:answer}),(e)=>e.code==='EMPTY');
});

test('one surrounded JSON object is accepted but multiple objects and JavaScript remain invalid',()=>{
  assert.equal(parseScanResponse('填表結果如下：\n```json\n'+answer+'\n```')[0].name,'雲璃');
  assert.throws(()=>parseScanResponse(answer+'\n'+answer),(e)=>e.code==='FORMAT');
  assert.throws(()=>parseScanResponse('{characters: []}'),(e)=>e.code==='FORMAT');
  assert.throws(()=>parseScanResponse('{"__proto__":{},"characters":[]}'),(e)=>e.code==='FORMAT'&&!e.retryable);
});

test('empty, reasoning-only and refusal outputs have distinct actionable errors',()=>{
  for(const value of ['', '  ', '<analysis>only reasoning</analysis>','<think>unfinished'])assert.throws(()=>parseScanResponse(value),(e)=>e.code==='EMPTY'&&e.retryable);
  for(const value of [
    '很抱歉，我無法協助處理這些內容。',"I'm sorry, but I can't assist with this request.",
    {choices:[{finish_reason:'content_filter',message:{content:''}}]},
    {choices:[{message:{refusal:'blocked'}}]},
    {output:[{type:'message',content:[{type:'refusal',refusal:'blocked'}]}]},
    '{"error":{"code":"content_filter"}}'
  ])assert.throws(()=>parseScanResponse(value),(e)=>e.code==='REFUSED'&&!e.retryable);
});

test('format and empty failures receive at most one retry; trimNames is disabled',async()=>{
  for(const first of ['', 'bad JSON', new Error('No message generated')]){
    let calls=0;const h=harness(async args=>{assert.equal(args.trimNames,false);assert.ok(args.abortSignal instanceof AbortSignal);calls++;if(calls===1){if(first instanceof Error)throw first;return first;}return answer;});
    const proposal=await h.host.scan({mode:'ai'});assert.equal(calls,2);assert.equal(proposal.rows.length,1);assert.match(proposal.diagnostics.join(''),/重試 1 次/);assert.equal(h.host.db().manual.length,0);
  }
  let calls=0;const h=harness(async()=>{calls++;return '';});await assert.rejects(h.host.scan({mode:'ai'}),(e)=>e.code==='EMPTY');assert.equal(calls,2);
});

test('provider refusal and authentication errors are not retried',async()=>{
  for(const value of [{choices:[{finish_reason:'content_filter',message:{content:''}}]}, Object.assign(new Error('authentication failed'),{status:401})]){
    let calls=0;const h=harness(async()=>{calls++;if(value instanceof Error)throw value;return value;});
    await assert.rejects(h.host.scan({mode:'ai'}));assert.equal(calls,1);assert.equal(h.host.db().manual.length,0);
  }
});

test('transient network failure is bounded to one retry without changing the extraction request',async()=>{
  let calls=0,first;const h=harness(async args=>{calls++;if(calls===1){first=args.prompt;throw Object.assign(new Error('busy'),{status:503});}assert.equal(args.prompt,first);return answer;});
  assert.equal((await h.host.scan({mode:'ai'})).rows.length,1);assert.equal(calls,2);
});

test('hung request times out, unlocks UI, and ignores late results without another request',async()=>{
  let release,signal,calls=0;const h=harness(args=>{calls++;signal=args.abortSignal;return new Promise(r=>release=r);});
  await assert.rejects(h.host.scan({mode:'ai',timeoutMs:15}),(e)=>e.code==='TIMEOUT');
  assert.equal(signal.aborted,true);assert.equal(calls,1);assert.equal(h.host.scanner.job,null);assert.equal(h.host.scanPreview(),null);
  release(answer);await new Promise(r=>setTimeout(r,0));assert.equal(h.host.scanPreview(),null);assert.equal(h.host.db().manual.length,0);
});

test('cancel settles without provider response, aborts capable adapters and permits a fresh scan',async()=>{
  let release,signal,calls=0;const h=harness(args=>{calls++;if(calls===2)return answer;signal=args.abortSignal;return new Promise(r=>release=r);});
  const run=h.host.scan({mode:'ai'});h.host.cancelScan();await assert.rejects(run,/已取消/);assert.equal(signal.aborted,true);assert.equal(h.host.scanner.job,null);
  const p=await h.host.scan({mode:'ai'});release('{"characters":[]}');await new Promise(r=>setTimeout(r,0));assert.equal(h.host.scanPreview().token,p.token);
});

test('abort before a request makes no provider call and a failed rescan clears stale preview',async()=>{
  let calls=0;const h=harness(async()=>{calls++;return answer;});await h.host.scan({mode:'ai'});assert.ok(h.host.scanPreview());
  const controller=new AbortController();controller.abort();await assert.rejects(h.host.scan({mode:'ai',signal:controller.signal}),/已取消/);assert.equal(calls,1);assert.equal(h.host.scanPreview(),null);
});

test('changing chat cancels a hanging scan promptly without waiting for timeout',async()=>{
  const h=harness(()=>new Promise(()=>{}));const run=h.host.scan({mode:'ai',timeoutMs:2000});h.change();
  await assert.rejects(run,/聊天、正文/);assert.equal(h.host.scanner.job,null);assert.equal(h.host.scanPreview(),null);
});

test('deleted identities stay out of scan preview even when history contains their names',async()=>{
  const h=harness(async()=>answer);h.host.db().deletedCharacters={c_deleted:{character:{id:'c_deleted',name:'雲璃',aliases:[],values:{},present:false},deletedAt:Date.now(),locks:{},pinned:false}};
  const proposal=await h.host.scan({mode:'ai'});assert.equal(proposal.rows.length,0);assert.match(proposal.diagnostics.join(''),/已刪除/);
});

test('failed automatic extraction does not loop on every redraw of the same message',async()=>{
  let calls=0;const h=harness(async()=>{calls++;return '';});h.host.settings().autoScan='ai';
  await h.host.scanner.automatic(0);await h.host.scanner.automatic(0);assert.equal(calls,2);assert.equal(h.host.db().manual.length,0);
});

 test('a tombstoned ID cannot be redirected by scanning into a surviving same-name character',()=>{
  const h=harness(),snapshot=h.host.getSnapshot();snapshot.state.characters.c_alive={id:'c_alive',name:'雲璃',aliases:[],values:{},present:false};
  snapshot.db.deletedCharacters={c_deleted:{character:{id:'c_deleted',name:'雲璃',aliases:[],values:{},present:false},deletedAt:Date.now(),locks:{},pinned:false}};
  const row={...JSON.parse(answer).characters[0],id:'c_deleted'},sources=[{key:'m0.0',index:0,text:'雲璃是醫者。'}];
  assert.equal(makeScanProposal([row],snapshot,sources,{mode:'ai'}).rows.length,0);
  assert.equal(makeScanProposal([{...row,id:'c_alive'}],snapshot,sources,{mode:'ai'}).rows.length,1);
});


test('hidden complete and unfinished phone blocks never become narrative scan evidence',()=>{
  const phone='<phone>'+JSON.stringify({app:'wechat',action:'message',from:'雲璃',text:'雲璃走進房間。姓名：秘密人物'})+'</phone>';
  assert.equal(plainBody('她端起茶杯。'+phone+'雨仍在下。'),'她端起茶杯。雨仍在下。');
  assert.equal(plainBody('她端起茶杯。<phone>{"text":"雲璃走進房間。"'),'她端起茶杯。');
  assert.equal(plainBody('她端起茶杯。<phone'),'她端起茶杯。');
  const chat=[{mes:'真正的最新正文。'}, {mes:phone}, {mes:'姓名：收據假角色\n雲璃走進房間。',extra:{tavern_pocket_activity:{version:3}}}];
  const selected=collectSources(chat,{limit:1});assert.equal(selected.sources.length,1);assert.equal(selected.sources[0].index,0);assert.equal(selected.sources[0].text,'真正的最新正文。');
  assert.equal(splitSources(collectSources([{mes:phone}]).sources).length,0);
  assert.equal(splitSources(collectSources([{mes:'```json\n'+phone+'\n```'}]).sources).length,0);
});

test('phone filtering precedes budget truncation and preserves raw CSB data for local scanning',()=>{
  const update='<CSB_UPDATE>'+JSON.stringify({version:1,characters:[{id:'c_yunli',name:'雲璃',set:{mood:'安心'},reason:'她說自己安心'}]})+'</CSB_UPDATE>';
  const phone='<phone>'+JSON.stringify({text:'姓名：手機假人物\n'.repeat(1000)})+'</phone>';
  const raw='她說自己安心。'+phone+update,source=collectSources([{mes:raw}],{maxChars:300}).sources[0];
  assert.equal(source.raw,raw);assert.equal(source.original,'她說自己安心。'+update);assert.equal(source.text,'她說自己安心。');
  const h=harness(),rows=scanLocal([source],h.host.db().schema).rows;assert.equal(rows.length,1);assert.equal(rows[0].name,'雲璃');assert.equal(rows[0].set.mood,'安心');
  const unfinished=collectSources([{mes:'她說自己安心。<phone>{"text":"未完"'+update}]).sources[0];
  assert(unfinished.original.includes(update));assert.equal(unfinished.text,'她說自己安心。');
  const embedded=update.replace('安心','提到 <phone>文字</phone>');assert.equal(collectSources([{mes:embedded}]).sources[0].original,embedded);
});

test('AI batches and current scene omit hidden phone records and native activity receipts',async()=>{
  let calls=0;const h=harness(async args=>{
    calls++;const task=JSON.parse(args.prompt),all=JSON.stringify([task.sources,task.currentSceneSources]);
    assert(!all.includes('遠端秘密'));assert(!all.includes('收據假角色'));assert(all.includes('她仍坐在茶桌旁'));
    return '{"characters":[]}';
  });
  h.ctx.chat=[{mes:'雲璃說：「她仍坐在茶桌旁。」<phone>{"text":"遠端秘密：雲璃走進房間。"}</phone>',is_user:false},
    {mes:'姓名：收據假角色',is_user:false,extra:{tavern_pocket_activity:{version:3}}}];
  await h.host.scan({mode:'ai',limit:1});assert.equal(calls,1);assert.equal(h.host.db().manual.length,0);
});


test('automatic scanning skips hidden phone-only replies and receipts without model calls or warning noise',async()=>{
  let calls=0;const h=harness(async()=>{calls++;return '{"characters":[]}';}),statuses=[];
  h.host.settings().autoScan='ai';h.host.scanner.onStatus=text=>statuses.push(text);
  h.ctx.chat=[{mes:'<phone>{"text":"遠端秘密"}</phone>',is_user:false},
    {mes:'姓名：收據假角色',is_user:false,extra:{tavern_pocket_activity:{version:3}}}];
  await h.host.scanner.automatic(0);await h.host.scanner.automatic(1);
  assert.equal(calls,0);assert.deepEqual(statuses,[]);assert.equal(h.host.scanPreview(),null);
});
