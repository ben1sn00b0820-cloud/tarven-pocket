import test from 'node:test';
import assert from 'node:assert/strict';
import {characterName,resolveIdentity,normalizeIncomingIdentities} from '../src/identity.js';
import {StateController,KEY} from '../src/controller.js';
import {applyUpdate,replay} from '../src/core.js';
import {newDatabase,defaultSchema,emptyState,field} from '../src/schema.js';
import {collectSources,plainBody,splitSources,parseScanResponse,scanLocal,makeScanProposal,buildScanPrompt} from '../src/scan.js';

const story='雲璃今年十九歲，是隨行侍女。她說：「我現在很安心。」';
const source={key:'m0.0',index:0,text:story};
function harness(generateScan){
  const ctx={chatId:'a',chat:[],chatMetadata:{},extensionSettings:{},saveMetadata:async()=>{},saveChat:async()=>{},saveSettingsDebounced:async()=>{}};
  let current=ctx;const host=new StateController({context:()=>current,...(generateScan?{generateScan}:{})});
  return {host,ctx,change:c=>{current=c;},add:mes=>ctx.chat.push({mes,is_user:false})};
}
const aiRow=(more={})=>({name:'雲璃',set:{age:19,identity:'隨行侍女'},evidence:{name:{source:'m0.0',quote:'雲璃今年十九歲'},age:{source:'m0.0',quote:'雲璃今年十九歲'},identity:{source:'m0.0',quote:'雲璃今年十九歲，是隨行侍女。'}},...more});
const choose=p=>p.rows.map(r=>({key:r.key,name:r.name,fields:r.changes.map(c=>c.field)}));

test('live narrative blocks local and AI scans without making a model call',async()=>{
  let calls=0;const h=harness(async()=>{calls++;return '{"characters":[]}';});
  h.add('姓名：雲璃');h.host.adapter.isBusy=()=>true;
  await assert.rejects(h.host.scan({mode:'local'}),/正文正在生成/);
  await assert.rejects(h.host.scan({mode:'ai'}),/正文正在生成/);
  assert.equal(calls,0);assert.equal(h.host.db().manual.length,0);
});

test('a preview cannot be applied after a real generation starts',async()=>{
  const h=harness();h.add('姓名：雲璃');const proposal=await h.host.scan();
  h.host.adapter.isBusy=()=>true;
  await assert.rejects(h.host.applyScan(proposal.token,choose(proposal)),/正文正在生成/);
  assert.equal(h.host.db().manual.length,0);
  h.host.adapter.isBusy=()=>false;
  assert.equal((await h.host.applyScan(proposal.token,choose(proposal))).applied,1);
});

test('automatic scan skipped during generation can retry the same message after idle',async()=>{
  const h=harness();h.add('姓名：雲璃');h.host.adapter.isBusy=()=>true;
  await h.host.scanner.automatic(0);assert.equal(h.host.db().manual.length,0);
  h.host.adapter.isBusy=()=>false;
  await h.host.scanner.automatic(0);assert.equal(h.host.db().manual.length,1);
  await h.host.scanner.automatic(0);assert.equal(h.host.db().manual.length,1);
});

test('AI analysis result is rejected if narrative generation starts before it returns',async()=>{
  let finish;const h=harness(()=>new Promise(resolve=>{finish=resolve;}));h.add(story);
  const running=h.host.scan({mode:'ai'});h.host.adapter.isBusy=()=>true;
  finish(JSON.stringify({characters:[aiRow()]}));
  await assert.rejects(running,/正文正在生成/);
  assert.equal(h.host.scanPreview(),null);assert.equal(h.host.db().manual.length,0);
});
function known(h){const db=h.host.db();db.seed=applyUpdate(db.seed,db.schema,{version:1,characters:[{id:'c_yunli',name:'雲璃',aliases:['璃兒'],set:{age:'19',identity:'侍女'},reason:'seed'}]},{manual:true}).state;h.host.invalidate();}

test('name diagnostics distinguish missing, object, blank and actual 101-character input',()=>{
  assert.throws(()=>characterName(undefined),/缺少 name.*不是超過/);
  assert.throws(()=>characterName({name:'雲璃'}),/型別錯誤.*object/);
  assert.throws(()=>characterName('  '),/不能空白/);
  assert.throws(()=>characterName('雲'.repeat(101)),/實際為 101 字/);
  assert.equal(characterName('𠮷'.repeat(100)).length,200);
});
test('automatic identity rejects paragraph names rather than truncating into a different person',()=>{
  for(const name of ['雲璃\n她走進房間','雲璃：她走進房間','<div>雲璃</div>','{{user}}','新角色姓名'])assert.throws(()=>characterName(name,'姓名',{strict:true}));
});
test('known ID can omit name; wrong ID plus known name resolves to existing character',()=>{
  const h=harness();known(h);const state=h.host.getSnapshot().state;
  assert.equal(resolveIdentity({id:'c_yunli'},state).name,'雲璃');
  assert.equal(resolveIdentity({id:'c_modelinvented',name:'璃兒'},state).id,'c_yunli');
  assert.throws(()=>resolveIdentity({id:'c_unknown'},state),/缺少 name/);
});
test('ambiguous aliases and ID/name conflict never merge automatically',()=>{
  const state={characters:{a:{id:'a',name:'雲璃',aliases:['阿璃']},b:{id:'b',name:'白璃',aliases:['阿璃']}}};
  assert.throws(()=>resolveIdentity({name:'阿璃'},state),/多位/);
  assert.throws(()=>resolveIdentity({id:'a',name:'白璃'},state),/不同人物/);
});
test('nested set.name is repaired, body is not interpreted as a name',()=>{
  const r=normalizeIncomingIdentities({version:1,characters:[{id:'c_a',set:{name:'雲璃',identity:'侍女'},reason:'登場'}]},emptyState());
  assert.equal(r.payload.characters[0].name,'雲璃');assert.equal(r.payload.characters[0].set.name,undefined);
});
test('bad newcomer does not block the valid character update or wipe presence',()=>{
  const db=newDatabase();const payload={version:1,present:['c_bad','c_good'],characters:[{id:'c_bad',set:{}},{id:'c_good',name:'雲璃',set:{mood:'安心'},reason:'她說自己安心'}]};
  const r=replay(db,[{mes:`<CSB_UPDATE>${JSON.stringify(payload)}</CSB_UPDATE>`}],{});
  assert.equal(r.state.characters.c_good.values.mood,'安心');assert.equal(r.state.characters.c_bad,undefined);assert.match(r.errors[0].message,/缺少 name/);
});
test('raw source selection ignores system and user by default, uses current swipe text',()=>{
  const chat=[{mes:'system',is_system:true},{mes:'draft',is_user:true},{mes:'current',swipe_id:1,swipes:['old','current'],extra:{display_text:'fake UI panel'}}];
  assert.equal(collectSources(chat,{limit:1}).sources[0].text,'current');assert.equal(collectSources(chat,{limit:'all'}).sources.length,1);
});
test('source limit reports truncation and strips thinking / script / generated state',()=>{
  const raw='<think>hidden</think><script>alert(1)</script><div>雲璃<br>正文</div><CSB_UPDATE>{}</CSB_UPDATE>';
  assert.equal(plainBody(raw),'雲璃\n正文');assert.equal(collectSources([{mes:'x'.repeat(100)}],{maxChars:20}).truncated,true);
  const batches=splitSources([{key:'m0',text:'x'.repeat(21000)}]);assert.equal(batches.length,3);assert.equal(batches.flat().map(s=>s.text).join(''),'x'.repeat(21000));
});
test('blank name line never eats the following identity line',()=>{
  const sources=collectSources([{mes:'name:\nidentity: 玄劍宗弟子\nname: 雲璃\nage: 19'}]).sources;
  const result=scanLocal(sources,defaultSchema());assert.equal(result.rows.length,1);assert.equal(result.rows[0].name,'雲璃');assert.equal(result.rows[0].set.age,'19');assert.match(result.diagnostics.join(''),/空白/);
});
test('local supports Chinese colon, markdown labels and CSB21 without crossing role boundary',()=>{
  const sources=collectSources([{mes:'[CSB21_ROLE]\nname: 雲璃\nage: 19\n[/CSB21_ROLE]\n**姓名**： 溫聞素\n身分：醫者'}]).sources;
  const rows=scanLocal(sources,defaultSchema()).rows;assert.equal(rows.length,2);assert.equal(rows[1].set.identity,'醫者');
});
test('ordinary prose not converted into a long pseudo-name by local guessing',()=>{
  const r=scanLocal(collectSources([{mes:story}]).sources,defaultSchema());assert.equal(r.rows.length,0);
});
test('AI parser accepts fenced JSON only and rejects JS or bad shape without eval',()=>{
  assert.deepEqual(parseScanResponse('```json\n{"characters":[]}\n```'),[]);
  assert.throws(()=>parseScanResponse('{characters:[]}'),/不是有效 JSON/);
  assert.throws(()=>parseScanResponse('{"characters":{}}'),/characters 陣列/);
  assert.throws(()=>parseScanResponse('{"__proto__":{"polluted":1},"characters":[]}'));assert.equal({}.polluted,undefined);
});
test('AI evidence is required per field and must be an exact source quote',()=>{
  const h=harness(),s=h.host.getSnapshot(),p=makeScanProposal([aiRow({set:{age:19,mood:'安心'},evidence:{...aiRow().evidence,mood:{source:'m0.0',quote:'not in source'}}})],s,[source],{mode:'ai'});
  assert.equal(p.rows[0].changes.length,1);assert.equal(p.rows[0].changes[0].field,'age');assert.match(p.diagnostics.join(''),/引句/);
});
test('hallucinated name with unrelated quote is rejected',()=>{
  const h=harness(),p=makeScanProposal([aiRow({name:'不存在的人'})],h.host.getSnapshot(),[source],{mode:'ai'});assert.equal(p.rows.length,0);assert.match(p.diagnostics.join(''),/未包含姓名/);
});
test('locks, static values and unknown fields cannot be changed by scan',()=>{
  const h=harness();known(h);h.host.db().locks.c_yunli={identity:'侍女'};h.host.invalidate();
  const p=makeScanProposal([aiRow({set:{age:100,identity:'宗主',madeUp:100}})],h.host.getSnapshot(),[source],{mode:'ai',merge:'changes'});assert.equal(p.rows.length,0);assert.ok(p.diagnostics.length>=3);
});
test('fill mode preserves populated fields; update mode produces a visible old/new diff',()=>{
  const h=harness();known(h);
  assert.equal(makeScanProposal([aiRow()],h.host.getSnapshot(),[source],{mode:'ai',merge:'fill'}).rows.length,0);
  const p=makeScanProposal([aiRow()],h.host.getSnapshot(),[source],{mode:'ai',merge:'changes'});
  assert.equal(p.rows[0].changes[0].old,'侍女');assert.equal(p.rows[0].changes[0].value,'隨行侍女');
});
test('local scan is preview-only until accepted; second scan does not duplicate',async()=>{
  const h=harness();h.add('姓名：雲璃\n年齡：19\n身分：隨行侍女');
  const p=await h.host.scan({mode:'local'});assert.equal(Object.keys(h.host.getSnapshot().state.characters).length,0);
  const r=await h.host.applyScan(p.token,choose(p));assert.equal(r.applied,1);assert.equal(r.fields,2);
  const p2=await h.host.scan({mode:'local'});assert.equal(p2.rows.length,0);assert.equal(Object.keys(h.host.getSnapshot().state.characters).length,1);
});
test('scan does not reset scene or presence when a character is merely mentioned',async()=>{
  const h=harness();h.add('姓名：雲璃\n身分：侍女');h.host.db().seed.scene.location='青竹洞府';
  const p=await h.host.scan();await h.host.applyScan(p.token,choose(p));const s=h.host.getSnapshot().state;
  assert.equal(s.scene.location,'青竹洞府');assert.equal(Object.values(s.characters)[0].present,false);
});
test('only selected fields and candidates are committed',async()=>{
  const h=harness();h.add('姓名：雲璃\n年齡：19\n身分：侍女\n姓名：溫聞素\n身分：醫者');const p=await h.host.scan();
  await h.host.applyScan(p.token,[{key:p.rows[0].key,fields:['identity']}]);const chars=Object.values(h.host.getSnapshot().state.characters);assert.equal(chars.length,1);assert.equal(chars[0].values.age,undefined);assert.equal(chars[0].values.identity,'侍女');
});
test('manual edits after preview cause stale rejection, not overwritten information',async()=>{
  const h=harness();h.add('姓名：雲璃\n心情：安心');const p=await h.host.scan();
  await h.host.saveCharacter({id:'c_manual',name:'商映雪',set:{}},{},false,true);
  await assert.rejects(h.host.applyScan(p.token,choose(p)),/資料或欄位已變更/);assert.equal(Object.keys(h.host.getSnapshot().state.characters).length,1);
});
test('editing the source or switching swipe invalidates the proposal',async()=>{
  const h=harness();h.add('姓名：雲璃');const p=await h.host.scan();h.ctx.chat[0].swipe_id=1;
  await assert.rejects(h.host.applyScan(p.token,choose(p)),/回覆分支已變更/);
});
test('switching chats during AI request never writes to either chat',async()=>{
  let release;const h=harness(()=>new Promise(r=>release=r));h.add(story);const run=h.host.scan({mode:'ai'});
  h.change({...h.ctx,chatId:'b',chat:[],chatMetadata:{}});release(JSON.stringify({characters:[aiRow()]}));
  await assert.rejects(run,/聊天、正文/);assert.equal(Object.keys(h.ctx.chatMetadata[KEY].seed.characters).length,0);
});
test('AI cancellation discards late result and serializes concurrent calls',async()=>{
  let release;const h=harness(()=>new Promise(r=>release=r));h.add(story);const run=h.host.scan({mode:'ai'});h.host.cancelScan();
  await assert.rejects(h.host.scan({mode:'ai'}),/已有一個/);release(JSON.stringify({characters:[aiRow()]}));await assert.rejects(run,/已取消/);
  assert.equal(Object.keys(h.host.getSnapshot().state.characters).length,0);
});
test('AI failure leaves existing state untouched and does not auto retry',async()=>{
  let n=0;const h=harness(async()=>{n++;return 'not json';});known(h);h.add(story);const before=JSON.stringify(h.host.getSnapshot().state);
  await assert.rejects(h.host.scan({mode:'ai'}),/不是有效 JSON/);assert.equal(JSON.stringify(h.host.getSnapshot().state),before);assert.equal(n,1);
});
test('AI scan uses current custom schema, not a hard-coded set of fields',async()=>{
  const h=harness(async args=>{const task=JSON.parse(args.prompt);assert.ok(task.fields.some(f=>f.id==='realm'));return JSON.stringify({characters:[{name:'雲璃',set:{realm:'煉氣七層'},evidence:{name:{source:'m0.0',quote:'雲璃，煉氣七層'},realm:{source:'m0.0',quote:'雲璃，煉氣七層'}}}]});});
  h.host.db().schema.fields.push(field('realm','修為','basic'));h.add('雲璃，煉氣七層。');const p=await h.host.scan({mode:'ai'});await h.host.applyScan(p.token,choose(p));assert.equal(Object.values(h.host.getSnapshot().state.characters)[0].values.realm,'煉氣七層');
});
test('AI fill can target a single existing character',()=>{
  const h=harness();known(h);const p=makeScanProposal([aiRow(),{...aiRow(),name:'溫聞素',evidence:{name:{source:'m0.0',quote:story}}}],h.host.getSnapshot(),[source],{mode:'ai',merge:'changes',targetId:'c_yunli'});
  assert.equal(p.rows.length,1);assert.equal(p.rows[0].id,'c_yunli');
});
test('automatic local scanning only runs on completed selected assistant messages and deduplicates',async()=>{
  const h=harness();h.add('姓名：雲璃\n心情：安心');await h.host.scanner.automatic(0);const count=h.host.db().manual.length;
  assert.equal(count,1);await h.host.scanner.automatic(0);assert.equal(h.host.db().manual.length,count);
  h.ctx.chat.push({mes:'姓名：溫聞素',is_user:true});await h.host.scanner.automatic(1);assert.equal(h.host.db().manual.length,count);
});
test('automatic AI is opt-in and holds a preview by default',async()=>{
  let calls=0;const h=harness(async()=>{calls++;return JSON.stringify({characters:[aiRow()]});});h.add(story);
  await h.host.scanner.automatic(0);assert.equal(calls,0);h.host.settings().autoScan='ai';h.ctx.chat[0].mes+='\n';
  await h.host.scanner.automatic(0);assert.equal(calls,1);assert.equal(h.host.scanPreview().rows.length,1);assert.equal(Object.keys(h.host.getSnapshot().state.characters).length,0);
});
test('optional automatic AI applies new/empty fields only and survives later messages',async()=>{
  const h=harness(async()=>JSON.stringify({characters:[aiRow()]}));h.add(story);h.host.settings().autoScan='ai';h.host.settings().autoAIApply=true;
  await h.host.scanner.automatic(0);h.add('兩人繼續聊天。');const s=h.host.getSnapshot().state;assert.equal(Object.values(s.characters)[0].values.age,'19');
});
test('disabled automatic scan makes no model calls',async()=>{
  let calls=0;const h=harness(async()=>{calls++;return '{"characters":[]}';});h.add(story);h.host.settings().autoScan='off';await h.host.scanner.automatic(0);assert.equal(calls,0);
});
test('scan prompt does not silently include worldbooks or unrelated character secrets',()=>{
  const h=harness();known(h);h.host.db().seed.characters.c_secret={id:'c_secret',name:'軒雲清',aliases:[],values:{note:'SECRET'},present:false};
  const p=buildScanPrompt(h.host.getSnapshot(),[source]);assert.equal(p.prompt.includes('SECRET'),false);assert.ok(p.systemPrompt.includes('不得使用外部知識'));
});
test('deletion of source does not erase already confirmed persistent character information',async()=>{
  const h=harness();h.add('姓名：雲璃\n身分：侍女');const p=await h.host.scan();await h.host.applyScan(p.token,choose(p));h.ctx.chat.length=0;h.host.invalidate();assert.equal(Object.values(h.host.getSnapshot().state.characters)[0].values.identity,'侍女');
});

test('explicit ID disambiguates shared alias instead of forcing a wrong merge',()=>{
  const s={characters:{c_a:{id:'c_a',name:'雲璃',aliases:['阿璃']},c_b:{id:'c_b',name:'白璃',aliases:['阿璃']}}};
  assert.equal(resolveIdentity({id:'c_a',name:'阿璃'},s).id,'c_a');
});
test('unclosed hidden reasoning is removed, including when scan budget truncates a message',()=>{
  assert.equal(plainBody('正文<think>未結束的隱藏思考'),'正文');
  const s=collectSources([{mes:'<think>'+('姓名：秘密\n'.repeat(100))+'</think>姓名：雲璃'}],{maxChars:40}).sources[0];
  assert.equal(s.text,'姓名：雲璃');assert.equal(s.original.includes('秘密'),false);
});
test('a list of names is not silently treated as one name',()=>{
  assert.throws(()=>characterName('雲璃、溫聞素','姓名',{strict:true}),/疑似/);
});
test('double apply is serialized and a used token cannot append a duplicate journal event',async()=>{
  const h=harness();h.add('姓名：雲璃\n身分：侍女');const p=await h.host.scan();let release;
  h.ctx.saveMetadata=()=>new Promise(r=>release=r);const first=h.host.applyScan(p.token,choose(p));
  await assert.rejects(h.host.applyScan(p.token,choose(p)),/正在保存/);
  await new Promise(r=>setTimeout(r,0));release();await first;
  assert.equal(h.host.db().manual.length,1);await assert.rejects(h.host.applyScan(p.token,choose(p)),/過期/);
});
test('failed metadata save rolls back only the new local scan journal record',async()=>{
  const h=harness();known(h);h.add('姓名：雲璃\n心情：安心');const p=await h.host.scan();h.ctx.saveMetadata=async()=>{throw Error('save failed');};
  await assert.rejects(h.host.applyScan(p.token,choose(p)),/save failed/);assert.equal(h.host.db().manual.length,0);assert.equal(h.host.getSnapshot().state.characters.c_yunli.values.mood,undefined);
});
test('zero and false remain valid extracted values, not missing values',async()=>{
  const h=harness();h.host.db().schema.fields.push(field('oath','已立誓','basic','boolean'));h.add('姓名：雲璃\n精力值：0\n已立誓：否');const p=await h.host.scan();await h.host.applyScan(p.token,choose(p));
  const c=Object.values(h.host.getSnapshot().state.characters)[0];assert.equal(c.values.energy,0);assert.equal(c.values.oath,false);
});
test('large candidate lists are capped with an explicit diagnostic',()=>{
  const h=harness(),rows=Array.from({length:305},(_,i)=>({name:`弟子${i}`,set:{},_trustedLocal:true,_source:'m0',_quote:'姓名'}));
  const p=makeScanProposal(rows,h.host.getSnapshot(),[{key:'m0',index:0}],{mode:'local'});assert.equal(p.rows.length,300);assert.match(p.diagnostics.join(''),/超過 300/);
});
test('replay normalizes ID drift by name without creating a second existing person',()=>{
  const h=harness();known(h);h.add('<CSB_UPDATE>'+JSON.stringify({version:1,present:['c_wrong'],characters:[{id:'c_wrong',name:'雲璃',set:{mood:'安心'},reason:'正文已說明安心'}]})+'</CSB_UPDATE>');
  const s=h.host.getSnapshot().state;assert.equal(Object.keys(s.characters).length,1);assert.equal(s.characters.c_yunli.values.mood,'安心');assert.equal(s.characters.c_yunli.present,true);
});
