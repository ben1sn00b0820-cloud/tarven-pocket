import test from 'node:test';
import assert from 'node:assert/strict';
import {StateController} from '../src/controller.js';
import {getScanPresets,resolveScanPreset,validateScanPreset,saveScanPreset,deleteScanPreset,selectScanPreset,exportScanPresets,importScanPresets} from '../src/scan-presets.js';
import {field} from '../src/schema.js';
import {buildScanPrompt} from '../src/scan.js';

const narrative='雲璃是醫者。';
const answer=JSON.stringify({characters:[{name:'雲璃',set:{identity:'醫者'},evidence:{name:{source:'m0.0',quote:narrative},identity:{source:'m0.0',quote:narrative}}}]});
function harness(extra={}){
  let saves=0;
  let context={chatId:'a',chat:[{mes:narrative,is_user:false}],chatMetadata:{},extensionSettings:{},saveMetadata:async()=>{},saveChat:async()=>{},saveSettingsDebounced:async()=>{saves++;},...extra};
  const host=new StateController({context:()=>context});
  return {host,get context(){return context;},get saves(){return saves;},change(){context={...context,chatId:'b',chat:[],chatMetadata:{}};}};
}

test('built-in raw and host presets are stable and cannot be overwritten or deleted',async()=>{
  const h=harness();assert.deepEqual(getScanPresets({}).map(p=>p.id),['builtin-raw','builtin-host']);
  assert.equal(resolveScanPreset({}).route,'raw');
  assert.throws(()=>validateScanPreset({...getScanPresets({})[0],instructions:'changed'}),/內建/);
  await assert.rejects(deleteScanPreset(h.host,'builtin-host'),/內建/);
  assert.equal(h.saves,0);
});

test('custom preset CRUD persists global settings and deleting selected preset resets selection',async()=>{
  const h=harness();const p=await saveScanPreset(h.host,{name:' 我的填表 ',route:'host',instructions:'欄位使用繁體中文。',responseLength:4096});
  assert.equal(p.name,'我的填表');assert.match(p.id,/^scanpreset_/);
  await selectScanPreset(h.host,p.id);assert.equal(resolveScanPreset(h.host.settings()).id,p.id);
  await saveScanPreset(h.host,{...p,name:'已修改'});assert.equal(getScanPresets(h.host.settings()).at(-1).name,'已修改');
  await deleteScanPreset(h.host,p.id);assert.equal(resolveScanPreset(h.host.settings()).id,'builtin-raw');assert.equal(h.saves,4);
});

test('preset import/export merges only preset settings and preserves unrelated data',async()=>{
  const h=harness();h.host.settings().customSetting='keep';
  const first=await saveScanPreset(h.host,{id:'scanpreset_first',name:'A',route:'raw',instructions:''});
  const exported=exportScanPresets(h.host.settings());assert.equal(exported.format,'CSB_SCAN_PRESETS');assert.equal(exported.presets.length,1);
  const result=await importScanPresets(h.host,{format:'CSB_SCAN_PRESETS',version:1,presets:[{...first,name:'B'},{id:'scanpreset_second',name:'C',route:'host',instructions:'以原文為準。'}],selectedId:'scanpreset_second'});
  assert.equal(result.imported,2);assert.equal(getScanPresets(h.host.settings()).length,4);assert.equal(resolveScanPreset(h.host.settings()).name,'C');assert.equal(h.host.settings().customSetting,'keep');
  assert.equal(h.context.chat[0].mes,narrative);assert.equal(h.host.db().manual.length,0);
});

test('malformed imports are atomic and preset input bounds reject ambiguous data',async()=>{
  const h=harness();const before=JSON.stringify(h.host.settings());
  for(const value of [
    {format:'CSB_SCAN_PRESETS',version:1,presets:[{id:'builtin-host',name:'overwrite',route:'host'}]},
    {format:'CSB_SCAN_PRESETS',version:1,presets:[{id:'scanpreset_a',name:'A',route:'raw'},{id:'scanpreset_a',name:'B',route:'raw'}]},
    {format:'CSB_SCAN_PRESETS',version:1,presets:[],selectedId:'missing'},
    JSON.parse('{"format":"CSB_SCAN_PRESETS","version":1,"presets":[],"__proto__":{}}'),
  ])await assert.rejects(importScanPresets(h.host,value));
  for(const override of [{route:'external'},{name:''},{responseLength:1},{responseLength:65536},{responseLength:1024.5},{instructions:'x'.repeat(20001)}])assert.throws(()=>validateScanPreset({name:'valid',route:'raw',...override}));
  assert.equal(JSON.stringify(h.host.settings()),before);assert.equal(h.saves,0);
});

test('preset save failure restores previous values and disallows overlapping mutation',async()=>{
  let reject;const h=harness({saveSettingsDebounced:()=>new Promise((_,r)=>reject=r)}),settings=h.host.settings();
  const saving=saveScanPreset(h.host,{name:'pending',route:'raw'});
  await assert.rejects(selectScanPreset(h.host,'builtin-host'),/正在保存/);reject(new Error('disk full'));
  await assert.rejects(saving,/disk full/);assert.equal(settings.scanPresets,undefined);assert.equal(settings.scanPresetId,undefined);
});

test('custom raw scan uses instructions and response budget without forwarding credentials or route flags',async()=>{
  let request;const h=harness({generateRaw:async args=>{request=args;return answer;}});
  const p=await saveScanPreset(h.host,{name:'raw',route:'raw',instructions:'欄位使用繁體中文。',responseLength:2048,api:'untrusted',apiKey:'not-forwarded'});
  await selectScanPreset(h.host,p.id);const preview=await h.host.scan({mode:'ai'});
  assert.match(request.systemPrompt,/欄位使用繁體中文/);assert.match(request.systemPrompt,/只輸出有效 JSON/);assert.equal(request.responseLength,2048);assert.equal(request.api,undefined);assert.equal(request.apiKey,undefined);
  assert.equal(preview.preset.id,p.id);assert.equal(preview.rows.length,1);assert.equal(h.host.db().manual.length,0);
});

test('host route actually calls quiet generation with current preset context and never raw generation',async()=>{
  let request,raw=0;const h=harness({generateQuietPrompt:async args=>{request=args;return answer;},generateRaw:async()=>{raw++;return answer;}});
  const original=JSON.stringify(h.context.chat);const preview=await h.host.scan({mode:'ai',presetId:'builtin-host'});
  assert.equal(raw,0);assert.equal(request.quietToLoud,false);assert.equal(request.skipWIAN,false);assert.equal(request.trimToSentence,false);assert.equal(request.removeReasoning,true);
  assert.match(request.quietPrompt,/只輸出有效 JSON/);assert.match(request.quietPrompt,/雲璃是醫者/);assert.equal(request.responseLength,undefined);
  assert.equal(preview.preset.route,'host');assert.equal(h.context.chat[0].mes,JSON.parse(original)[0].mes);assert.equal(h.context.chat.length,1);assert.equal(h.host.db().manual.length,0);
});

test('host unavailable is reported without silently switching to raw',async()=>{
  let raw=0;const h=harness({generateRaw:async()=>{raw++;return answer;}});
  await assert.rejects(h.host.scan({mode:'ai',presetId:'builtin-host'}),/未提供 generateQuietPrompt/);assert.equal(raw,0);assert.equal(h.host.scanPreview(),null);
});

test('host preset context cannot supply unselected-source evidence',async()=>{
  const h=harness({generateQuietPrompt:async()=>JSON.stringify({characters:[{name:'遠端人物',set:{identity:'來自世界書'},evidence:{name:{source:'worldbook',quote:'遠端人物'},identity:{source:'worldbook',quote:'來自世界書'}}}]})});
  const preview=await h.host.scan({mode:'ai',presetId:'builtin-host'});assert.equal(preview.rows.length,0);assert.match(preview.diagnostics.join(''),/原文依據/);
});

test('timed-out host request retains a lease until actual settlement, with no late writes',async()=>{
  let release,calls=0;const h=harness({generateQuietPrompt:()=>{calls++;return new Promise(r=>release=r);}});
  await assert.rejects(h.host.scan({mode:'ai',presetId:'builtin-host',timeoutMs:10}),(e)=>e.code==='TIMEOUT');
  await assert.rejects(h.host.scan({mode:'ai',presetId:'builtin-host'}),/上一個酒館預設掃描/);assert.equal(calls,1);
  release(answer);await new Promise(r=>setTimeout(r,0));assert.equal(h.host.scanPreview(),null);assert.equal(h.host.db().manual.length,0);
  h.context.generateQuietPrompt=async()=>answer;assert.equal((await h.host.scan({mode:'ai',presetId:'builtin-host'})).rows.length,1);
});

test('host refusal is surfaced once and never retried with changed preset instructions',async()=>{
  let calls=0;const h=harness({generateQuietPrompt:async()=>{calls++;return '很抱歉，我無法協助處理這些內容。';}});
  await assert.rejects(h.host.scan({mode:'ai',presetId:'builtin-host'}),(e)=>e.code==='REFUSED');assert.equal(calls,1);
});

test('host preset run cancels on chat change and ignores its late response',async()=>{
  let finish;const h=harness({generateQuietPrompt:()=>new Promise(r=>finish=r)});
  const running=h.host.scan({mode:'ai',presetId:'builtin-host'});h.change();finish(answer);
  await assert.rejects(running,/聊天、正文/);assert.equal(h.host.scanPreview(),null);
});

test('in-flight scan records the preset actually used even if selected preset later changes',async()=>{
  let finish;const h=harness({generateRaw:()=>new Promise(r=>finish=r)});
  const running=h.host.scan({mode:'ai'});await selectScanPreset(h.host,'builtin-host');finish(answer);
  const preview=await running;assert.equal(preview.preset.id,'builtin-raw');
});

function genderHarness({genderEvidence=true,gender='女性'}={}){
  const text='雲璃是女性。女性欄位是甲。男性欄位是乙。';
  const evidence={name:{source:'m0.0',quote:'雲璃是女性。'},female_detail:{source:'m0.0',quote:'女性欄位是甲。'},male_detail:{source:'m0.0',quote:'男性欄位是乙。'},...(genderEvidence?{gender:{source:'m0.0',quote:'雲璃是女性。'}}:{})};
  const h=harness({chat:[{mes:text,is_user:false}],generateRaw:async()=>JSON.stringify({characters:[{name:'雲璃',set:{female_detail:'甲',male_detail:'乙',gender},evidence}]})});
  h.host.db().schema.fields.push(field('female_detail','女性欄位','basic','text',{appliesTo:'female'}),field('male_detail','男性欄位','basic','text',{appliesTo:'male'}));h.host.invalidate();
  return h;
}

test('scan preview accepts only applicable fields using evidenced gender regardless of key order',async()=>{
  const h=genderHarness(),preview=await h.host.scan({mode:'ai'});
  assert.equal(preview.rows[0].template,'female');assert.deepEqual(new Set(preview.rows[0].changes.map(c=>c.field)),new Set(['gender','female_detail']));
  assert.match(preview.diagnostics.join(''),/男性欄位.*不適用/);
  const withoutEvidence=genderHarness({genderEvidence:false}),other=await withoutEvidence.host.scan({mode:'ai'});
  assert.equal(other.rows[0].template,'common');assert.equal(other.rows[0].changes.length,0);
});

test('deselecting proposed gender cannot write the dependent sex-specific field',async()=>{
  const h=genderHarness(),preview=await h.host.scan({mode:'ai'}),row=preview.rows[0];
  const result=await h.host.applyScan(preview.token,[{key:row.key,name:row.name,fields:['female_detail']}]);
  const character=Object.values(h.host.getSnapshot().state.characters)[0];assert.equal(character.values.female_detail,undefined);assert.equal(character.values.gender,undefined);
  assert.match(result.warnings.join(''),/女性欄位.*不適用/);
});

test('selected gender permits its template fields and current manual template wins over gender',async()=>{
  const h=genderHarness(),preview=await h.host.scan({mode:'ai'}),row=preview.rows[0];
  await h.host.applyScan(preview.token,[{key:row.key,name:row.name,fields:row.changes.map(c=>c.field)}]);
  assert.equal(Object.values(h.host.getSnapshot().state.characters)[0].values.female_detail,'甲');
  const fixed=genderHarness();fixed.host.db().seed.characters.c_yunli={id:'c_yunli',name:'雲璃',aliases:[],values:{},present:false,template:'male'};fixed.host.invalidate();
  const fixedPreview=await fixed.host.scan({mode:'ai'});assert.equal(fixedPreview.rows[0].template,'male');assert.deepEqual(new Set(fixedPreview.rows[0].changes.map(c=>c.field)),new Set(['gender','male_detail']));
});

test('scan prompt exposes applicability and excludes stored values outside active role template',()=>{
  const h=genderHarness();h.host.db().seed.characters.c_yunli={id:'c_yunli',name:'雲璃',aliases:[],values:{gender:'女性',female_detail:'keep',male_detail:'archived'},present:false};h.host.invalidate();
  const request=buildScanPrompt(h.host.getSnapshot(),[{key:'m0.0',text:'雲璃在此。'}]),task=JSON.parse(request.prompt);
  assert.equal(task.fields.find(f=>f.id==='female_detail').appliesTo,'female');assert.equal(task.knownCharacters[0].effectiveTemplate,'female');
  assert.equal(task.knownCharacters[0].values.female_detail,'keep');assert.equal(task.knownCharacters[0].values.male_detail,undefined);
  assert.match(request.systemPrompt,/不能依姓名/);
});

test('schema gender default does not suppress evidenced gender initialization or grant a template',async()=>{
  const h=genderHarness();h.host.db().schema.fields.find(f=>f.id==='gender').default='女性';
  h.host.db().seed.characters.c_yunli={id:'c_yunli',name:'雲璃',aliases:[],values:{},present:false};h.host.invalidate();
  const request=JSON.parse(buildScanPrompt(h.host.getSnapshot(),[{key:'m0.0',text:'雲璃在此。'}]).prompt);
  assert.equal(request.knownCharacters[0].effectiveTemplate,'common');
  const preview=await h.host.scan({mode:'ai'}),row=preview.rows[0];assert(row.changes.some(c=>c.field==='gender'));
  await h.host.applyScan(preview.token,[{key:row.key,name:row.name,fields:row.changes.map(c=>c.field)}]);
  assert.equal(h.host.getSnapshot().state.characters.c_yunli.values.gender,'女性');
  assert.equal(h.host.getSnapshot().state.characters.c_yunli.values.female_detail,'甲');
});
