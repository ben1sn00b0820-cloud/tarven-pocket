import test from 'node:test';
import assert from 'node:assert/strict';
import {StateController,KEY} from '../src/controller.js';
import {defaultSchema} from '../src/schema.js';
import {collectSources,scanLocal,makeScanProposal,latestPresenceSources,buildScanPrompt} from '../src/scan.js';

function harness(generateScan){
  const ctx={chatId:'a',chat:[],chatMetadata:{},extensionSettings:{},saveMetadata:async()=>{},saveChat:async()=>{},saveSettingsDebounced:async()=>{}};
  const host=new StateController({context:()=>ctx,...(generateScan?{generateScan}:{})});
  const seed=(id,name,present=false)=>{host.db().seed.characters[id]={id,name,aliases:[],present,values:{identity:'原身分'}};host.invalidate();};
  return {ctx,host,seed,add:mes=>ctx.chat.push({mes,is_user:false})};
}
const select=p=>p.rows.map(r=>({key:r.key,name:r.name,fields:r.changes.map(c=>c.field),presence:true}));
const sources=texts=>collectSources(texts.map(mes=>({mes,is_user:false}))).sources;
const role={id:'c_yun',name:'雲璃',aliases:['璃兒'],present:false,values:{}};
const local=texts=>scanLocal(sources(texts),defaultSchema(),{knownState:{characters:{c_yun:role}}});
const latestRow=p=>p.rows.find(r=>r.id==='c_yun');

test('local explicit true/false presence is independent of fill-only field policy',async()=>{
  const h=harness();h.seed('c_yun','雲璃',false);h.add('姓名：雲璃\n目前在場：是\n身分：不同身分');
  const p=await h.host.scan({mode:'local',merge:'fill'}),row=latestRow(p);
  assert.equal(row.changes.length,0);assert.equal(row.presence.value,true);assert.match(row.presence.evidence.quote,/目前在場：是/);
  const result=await h.host.applyScan(p.token,select(p));assert.equal(result.presences,1);assert.equal(result.fields,0);
  assert.equal(h.host.getSnapshot().state.characters.c_yun.present,true);assert.equal(h.host.getSnapshot().state.characters.c_yun.values.identity,'原身分');
  h.add('姓名：雲璃\n目前在場：false');const p2=await h.host.scan();assert.equal(latestRow(p2).presence.value,false);
  await h.host.applyScan(p2.token,select(p2));assert.equal(h.host.getSnapshot().state.characters.c_yun.present,false);
});
test('presence-only scan journals contain no field writes and remain branch local',async()=>{
  const h=harness();h.seed('c_yun','雲璃',true);h.add('雲璃離開房間。');const p=await h.host.scan();
  await h.host.applyScan(p.token,select(p));const events=h.host.db().manual;
  assert.equal(events.length,1);assert.equal(events[0].kind,'presence');assert.deepEqual(events[0].payload.characters[0].set,{});
  h.ctx.chat[0].swipe_id=1;h.ctx.chat[0].mes='雲璃仍然在場。';h.host.invalidate();assert.equal(h.host.getSnapshot().state.characters.c_yun.present,true);
});
test('new identity/fields survive deleting source but scanned presence does not',async()=>{
  const h=harness();h.add('姓名：雲璃\n目前在場：是\n身分：侍女');const p=await h.host.scan();await h.host.applyScan(p.token,select(p));
  let c=Object.values(h.host.getSnapshot().state.characters)[0];assert.equal(c.present,true);assert.equal(c.values.identity,'侍女');
  h.ctx.chat.length=0;h.host.invalidate();c=Object.values(h.host.getSnapshot().state.characters)[0];assert.equal(c.values.identity,'侍女');assert.equal(c.present,false);
});
test('latest named departure wins over earlier arrival, including within one message',async()=>{
  const h=harness();h.seed('c_yun','雲璃');h.add('雲璃走進房間。雲璃離開房間。');
  const p=await h.host.scan();assert.equal(latestRow(p).presence.value,false);assert.match(latestRow(p).presence.evidence.quote,/離開/);
  h.add('雲璃回到房內。');const p2=await h.host.scan();assert.equal(latestRow(p2).presence.value,true);assert.equal(latestRow(p2).presence.evidence.index,1);
});
test('historical presence without confirmation in latest narrative is unknown, not replayed as current',async()=>{
  const h=harness();h.seed('c_yun','雲璃',true);h.add('雲璃離開房間。');h.add('地點：書房\n王子昱繼續看書。');
  const p=await h.host.scan();assert.equal(latestRow(p).presence.value,null);
  const r=await h.host.applyScan(p.token,select(p));assert.equal(r.applied,0);assert.equal(h.host.getSnapshot().state.characters.c_yun.present,true);
});
test('mere mention, memories, hypothetical actions, direct quotes, remote dialogue and code do not set presence',()=>{
  for(const text of ['大家提到了雲璃。','雲璃曾經走進房間。','雲璃將走進房間。','雲璃可能離開房間。','「雲璃離開房間。」','雲璃透過玉符表示已走進房間。','```\n雲璃走進房間。\n```','雲璃沒有離開房間。','雲璃在場外等候。'])assert.equal(local([text]).rows.length,0,text);
});
test('exact names are escaped rather than treated as regular expressions',()=>{
  const r=scanLocal(sources(['雲x璃走進房間。']),defaultSchema(),{knownState:{characters:{c_yun:{...role,name:'雲.璃'}}}});assert.equal(r.rows.length,0);
});
test('complete latest structured presence roster handles existing characters without field rows',()=>{
  const h=harness();h.seed('c_yun','雲璃',true);h.seed('c_wen','溫聞素',false);
  const ss=sources(['<CSB_UPDATE>{"version":1,"present":["c_wen"],"characters":[]}</CSB_UPDATE>']);
  const r=scanLocal(ss,h.host.db().schema,{knownState:h.host.getSnapshot().state});
  const p=makeScanProposal(r.rows,h.host.getSnapshot(),ss,{mode:'local'});
  assert.equal(latestRow(p).presence.value,false);assert.equal(p.rows.find(r=>r.id==='c_wen').presence.value,true);
});
test('unresolved roster membership never implicitly removes everyone else',()=>{
  const r=local(['<CSB_UPDATE>{"version":1,"present":["c_missing"],"characters":[]}</CSB_UPDATE>']);assert.equal(r.rows.length,0);assert.match(r.diagnostics.join(''),/無法識別/);
});
test('only the final complete CSB21 panel defines the current roster',()=>{
  const h=harness();h.seed('c_yun','雲璃',true);h.seed('c_wen','溫聞素',false);
  const ss=sources(['[CSB21_PANEL]\n[CSB21_ROLE]\nname: 雲璃\n[/CSB21_ROLE]\n[/CSB21_PANEL]\n[CSB21_PANEL]\n[CSB21_ROLE]\nname: 溫聞素\n[/CSB21_ROLE]\n[/CSB21_PANEL]']);
  const r=scanLocal(ss,h.host.db().schema,{knownState:h.host.getSnapshot().state});const p=makeScanProposal(r.rows,h.host.getSnapshot(),ss,{mode:'local'});
  assert.equal(latestRow(p).presence.value,false);assert.equal(p.rows.find(r=>r.id==='c_wen').presence.value,true);
});
test('scan option off skips presence while retaining field extraction',async()=>{
  const h=harness();h.seed('c_yun','雲璃',true);h.add('姓名：雲璃\n目前在場：否\n心情：安心');const p=await h.host.scan({assessPresence:false});
  assert.equal(p.rows[0].presence,undefined);await h.host.applyScan(p.token,select(p));assert.equal(h.host.getSnapshot().state.characters.c_yun.present,true);assert.equal(h.host.getSnapshot().state.characters.c_yun.values.mood,'安心');
});
test('manual override is shown as locked and cannot be overwritten by scan selection',async()=>{
  const h=harness();h.seed('c_yun','雲璃',true);h.host.db().presenceOverrides={c_yun:true};h.host.invalidate();h.add('雲璃離開房間。');
  const p=await h.host.scan(),row=latestRow(p);assert.equal(row.presence.value,false);assert.equal(row.presence.locked,true);
  const r=await h.host.applyScan(p.token,select(p));assert.equal(r.applied,0);assert.equal(h.host.getSnapshot().state.characters.c_yun.present,true);assert.equal(h.host.db().manual.length,0);
});
test('override change after preview rejects stale scan even when effective presence stays the same',async()=>{
  const h=harness();h.seed('c_yun','雲璃',true);h.add('雲璃離開房間。');const p=await h.host.scan();h.host.db().presenceOverrides={c_yun:true};h.host.invalidate();
  await assert.rejects(h.host.applyScan(p.token,select(p)),/資料或欄位已變更/);
});
test('unchecked presence is left unchanged while selected fields are applied',async()=>{
  const h=harness();h.seed('c_yun','雲璃',true);h.add('姓名：雲璃\n目前在場：否\n心情：安心');const p=await h.host.scan();
  await h.host.applyScan(p.token,select(p).map(r=>({...r,presence:false})));assert.equal(h.host.getSnapshot().state.characters.c_yun.present,true);assert.equal(h.host.getSnapshot().state.characters.c_yun.values.mood,'安心');
});
test('unknown and unchanged presence are no-ops and consume the preview without journal writes',async()=>{
  for(const value of ['未知','是']){const h=harness();h.seed('c_yun','雲璃',true);h.add('姓名：雲璃\n目前在場：'+value);const p=await h.host.scan();const r=await h.host.applyScan(p.token,select(p));assert.equal(r.applied,0);assert.equal(h.host.db().manual.length,0);assert.equal(h.host.scanPreview(),null);}
});
test('save failure rolls back both durable fields and presence event',async()=>{
  const h=harness();h.add('姓名：雲璃\n目前在場：是\n心情：安心');const p=await h.host.scan();h.ctx.saveMetadata=async()=>{throw Error('disk failure');};
  await assert.rejects(h.host.applyScan(p.token,select(p)),/disk failure/);assert.equal(h.host.db().manual.length,0);assert.equal(Object.keys(h.host.getSnapshot().state.characters).length,0);
});
function aiProposal(present,evidenceSource='m1.current',quote='雲璃離開房間。'){
  const h=harness();h.seed('c_yun','雲璃',true);const ss=sources(['雲璃走進房間。','雲璃離開房間。']);const ps=latestPresenceSources(ss);
  const row={id:'c_yun',name:'雲璃',set:{},present,evidence:{name:{source:'m1.current',quote:'雲璃離開房間。'},present:{source:evidenceSource,quote}}};
  return {h,p:makeScanProposal([row],h.host.getSnapshot(),[...ss,...ps],{mode:'ai',presenceSources:ps})};
}
test('AI current-scene boolean has exact named evidence; historical evidence is unknown',()=>{
  assert.equal(latestRow(aiProposal(false).p).presence.value,false);
  const old=aiProposal(true,'m0','雲璃走進房間。');assert.equal(latestRow(old.p).presence.value,null);assert.match(old.p.diagnostics.join(''),/最新場景/);
});
test('AI null and string false never become a guessed boolean',()=>{
  assert.equal(latestRow(aiProposal(null).p).presence.value,null);
  const p=aiProposal('false').p;assert.equal(latestRow(p).presence.value,null);assert.match(p.diagnostics.join(''),/禁止|沒有自動轉換/);
});
test('AI multiple observations within latest message choose the later exact quote',()=>{
  const h=harness();h.seed('c_yun','雲璃');const ss=sources(['雲璃走進房間。雲璃離開房間。']),ps=latestPresenceSources(ss),name={source:'m0.current',quote:'雲璃走進房間。'};
  const rows=[{id:'c_yun',set:{},present:false,evidence:{name,present:{source:'m0.current',quote:'雲璃離開房間。'}}},{id:'c_yun',set:{},present:true,evidence:{name,present:{source:'m0.current',quote:'雲璃走進房間。'}}}];
  const p=makeScanProposal(rows,h.host.getSnapshot(),[...ss,...ps],{mode:'ai',presenceSources:ps});assert.equal(latestRow(p).presence.value,false);
});
test('every historical AI batch receives final scene context and can apply presence without fields',async()=>{
  const requests=[];const h=harness(async args=>{const task=JSON.parse(args.prompt);requests.push(task);const key=task.currentSceneSources[0].source;return JSON.stringify({characters:[{id:'c_yun',name:'雲璃',set:{},present:false,evidence:{name:{source:key,quote:'雲璃離開房間。'},present:{source:key,quote:'雲璃離開房間。'}}}]});});
  h.seed('c_yun','雲璃',true);h.add('雲璃走進房間。'+('敘事。'.repeat(4000)));h.add('雲璃離開房間。');
  const p=await h.host.scan({mode:'ai'});assert(requests.length>=2);assert(requests.every(t=>t.currentSceneSources[0].text==='雲璃離開房間。'));
  await h.host.applyScan(p.token,select(p));assert.equal(h.host.getSnapshot().state.characters.c_yun.present,false);
});
test('pure generated state at the end does not let earlier prose stand in for latest AI scene',()=>{
  const ss=sources(['雲璃走進房間。','<CSB_UPDATE>{"version":1,"characters":[],"present":[]}</CSB_UPDATE>']);assert.deepEqual(latestPresenceSources(ss),[]);
});
test('automatic scan of an older edited message cannot reset current presence',async()=>{
  const h=harness();h.seed('c_yun','雲璃',true);h.add('雲璃離開房間。');h.add('最新正文。');await h.host.scanner.automatic(0);
  assert.equal(h.host.getSnapshot().state.characters.c_yun.present,true);assert.equal(h.host.db().manual.length,0);
});
test('automatic latest presence scan does not repeatedly append events',async()=>{
  const h=harness();h.seed('c_yun','雲璃',true);h.add('雲璃離開房間。');await h.host.scanner.automatic(0);const count=h.host.db().manual.length;assert.equal(count,1);
  await h.host.scanner.automatic(0);assert.equal(h.host.db().manual.length,count);h.host.scanner.lastAuto.delete(h.ctx.chat[0]);await h.host.scanner.automatic(0);assert.equal(h.host.db().manual.length,count);
});
test('scan prompt defines physical scene rather than remote conversation or mere mentions',()=>{
  const h=harness();h.seed('c_yun','雲璃');const ss=sources(['雲璃遠端傳音。']),p=buildScanPrompt(h.host.getSnapshot(),ss);
  assert.match(p.systemPrompt,/遠端傳音/);assert.match(p.systemPrompt,/沒有提及不等於已離場/);assert.equal(JSON.parse(p.prompt).assessPresence,true);
});


test('replacing chat metadata under the same host object invalidates scan preview',async()=>{
  const h=harness();h.seed('c_yun','雲璃',true);h.add('雲璃離開房間。');const p=await h.host.scan();const before=h.ctx.chatMetadata;
  h.ctx.chatMetadata=structuredClone(before);await assert.rejects(h.host.applyScan(p.token,select(p)),/聊天、正文/);
  assert.equal(before[KEY].manual.length,0);assert.equal(h.ctx.chatMetadata[KEY].manual.length,0);
});
test('automatic empty or unknown-only scans leave no stale pending preview',async()=>{
  const h=harness();h.seed('c_yun','雲璃',true);h.add('沒有角色資料。');await h.host.scanner.automatic(0);assert.equal(h.host.scanPreview(),null);
  h.add('姓名：雲璃\n目前在場：未知');await h.host.scanner.automatic(1);assert.equal(h.host.scanPreview(),null);assert.equal(h.host.db().manual.length,0);
});


test('ambiguous shared alias never assigns physical presence to multiple people',()=>{
  const h=harness();h.seed('c_yun','雲璃');h.seed('c_bai','白璃');h.host.db().seed.characters.c_yun.aliases=['阿璃'];h.host.db().seed.characters.c_bai.aliases=['阿璃'];h.host.invalidate();
  const r=scanLocal(sources(['阿璃走進房間。']),h.host.db().schema,{knownState:h.host.getSnapshot().state});assert.equal(r.rows.length,0);assert.match(r.diagnostics.join(''),/對應多位/);
});
