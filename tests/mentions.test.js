import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryMentionCandidates,searchMemoryMentions,createMemoryMention,parseMemoryMentions,resolveMemoryMentions,memoryMentionContext,renderMemoryMentions,MEMORY_MENTION_LIMITS} from '../pocket/mentions.js';
import {memoryTrigger} from '../pocket/composer.js';
import {renderPhoneCard} from '../pocket/cards.js';

function state() {
  return {persona:'使用者甲',profile:{name:'使用者甲',age:'19',height:'180cm',build:'自己記錄的身材',penis:'',customFields:[{name:'慣用手',value:'右手'}]},
    items:[{id:'18d961c1-fca6-4ebf-a66a-15538df8fb80',name:'救援藥箱',description:'內有紗布、繃帶',quantity:2,source:'手動新增'}],
    abilities:[{id:'bb8cfb1a-19e9-4f23-9a83-8ae2c480e3f2',name:'時間停止',description:'效果以使用者明確填寫的內容為準',quantity:1,source:'萬寶商城'},
      {id:'bb8cfb1a-1111-4f23-9a83-8ae2c480e3f2',name:'時間停止',description:'這是另一個同名能力',quantity:1,source:'自訂'}],
    secretKey:'DO_NOT_EXPORT'};
}
const tokenFor=(s,kind,id)=>createMemoryMention(s,memoryMentionCandidates(s).find(x=>x.kind===kind&&x.id===id));
const payload=text=>JSON.parse(text.slice(text.indexOf('\n')+1));

test('search covers profile fields, categories, saved descriptions and duplicate names',()=>{
  const s=state();
  assert.equal(searchMemoryMentions(s,'年齡')[0].id,'age');
  assert.equal(searchMemoryMentions(s,'慣用手')[0].kind,'profile');
  assert.equal(searchMemoryMentions(s,'紗布')[0].title,'救援藥箱');
  assert.equal(searchMemoryMentions(s,'時間停止',{category:'abilities'}).length,2);
  assert.equal(searchMemoryMentions(s,'時間停止',{category:'items'}).length,0);
  assert.equal(searchMemoryMentions(s,'我的物品')[0].id,'all');
  assert.equal(searchMemoryMentions(s,'能力：另一個')[0].id,s.abilities[1].id);
});

test('compact stable UUID token distinguishes duplicate names and stays bound after rename',()=>{
  const s=state(),token=tokenFor(s,'abilities',s.abilities[1].id);
  assert.match(token,/@【能力：時間停止｜使用者甲｜u[A-Za-z0-9_-]{22}】/);
  const before=resolveMemoryMentions(token,s);
  assert.equal(before.references.length,1);
  assert.equal(before.references[0].id,s.abilities[1].id);
  s.abilities[1].name='最新能力名稱';s.abilities[1].description='剛修改的效果';
  const after=resolveMemoryMentions(token,s);
  assert.equal(after.references[0].name,'最新能力名稱');
  assert.equal(after.references[0].description,'剛修改的效果');
});

test('deleted reference never resolves to a different item with same name or UUID prefix',()=>{
  const s=state(),token=tokenFor(s,'abilities',s.abilities[0].id);
  s.abilities.splice(0,1);
  const result=resolveMemoryMentions(token,s);
  assert.equal(result.references.length,0);
  assert.equal(result.unresolved[0].status,'missing');
  assert.match(result.unresolved[0].reason,/已刪除/);
});

test('exact owner prevents cross-persona reads even when IDs and names are cloned',()=>{
  const s=state(),token=tokenFor(s,'items',s.items[0].id);
  s.persona='另一個使用者';s.items[0].description='PRIVATE_OTHER_PERSONA';
  const result=resolveMemoryMentions(token,s);
  assert.equal(result.unresolved[0].status,'other-persona');
  assert.equal(result.references.length,0);
  assert.doesNotMatch(memoryMentionContext(token,s),/PRIVATE_OTHER_PERSONA/);
});

test('labels and persona separators, brackets, backslashes and newlines round-trip',()=>{
  const s=state();s.persona='王｜子】\\昱';s.items[0].name='特製【道具】｜第二層\\名稱\n新行';
  const token=tokenFor(s,'items',s.items[0].id),parsed=parseMemoryMentions(token);
  assert.equal(parsed.length,1);assert.equal(parsed[0].label,s.items[0].name);assert.equal(parsed[0].persona,s.persona);
  assert.equal(resolveMemoryMentions(token,s).references[0].name,s.items[0].name);
});

test('natural shortcuts resolve profile, collections and exact item names; ambiguous names stay unresolved',()=>{
  const s=state(),result=resolveMemoryMentions('@我，@我的資訊；＠我的物品。@我的能力！@物品「救援藥箱」 @能力「時間停止」',s);
  assert.equal(result.references.length,4);
  assert.equal(result.references[0].profile.age,'19');
  assert.equal(result.references[0].profile.penis,'');
  assert.equal(result.unresolved[0].status,'ambiguous');
});

test('email text, code blocks and HTML attributes are not reference instructions',()=>{
  const s=state(),token=tokenFor(s,'items',s.items[0].id),tick=String.fromCharCode(96);
  const text='name@我 example@我的資訊 '+tick+token+tick+'\n'+tick.repeat(3)+'\n@我的能力\n'+tick.repeat(3)+'\n<div title="'+token+'">文字</div>';
  assert.equal(parseMemoryMentions(text).length,0);
  assert.equal(memoryMentionContext(text,s),'');
});

test('rendered reference chips escape labels and remain phrasing-only',()=>{
  const s=state();s.items[0].name='<img src=x onerror=alert(1)> **危險** [label]';
  const token=tokenFor(s,'items',s.items[0].id),html=renderMemoryMentions('前文'+token+'後文');
  assert.match(html,/tp-memory-reference-items/);
  assert.doesNotMatch(html,/<img|<div|<blockquote|<script|\*\*危險/);
  assert.match(html,/&lt;img/);assert.match(html,/前文/);assert.match(html,/後文/);
  assert.doesNotMatch(html,/18d961c1|｜使用者甲｜/);
});

test('references inside escaped phone cards retain exact UUIDs and safe readable labels',()=>{
  const s=state();s.items[0].id='ffffffff-ffff-4fff-bfff-ffffffffffff';s.items[0].name='<img src=x> &amp; **藥箱**｜特製';
  const token=tokenFor(s,'items',s.items[0].id),card=renderPhoneCard({app:'wechat',action:'message',from:'me',to:'林沐',text:'我帶了 '+token});
  assert.match(card,/&#95;/);
  const html=renderMemoryMentions('前文'+card+'後文');
  assert.match(html,/tp-memory-reference-items/);assert.doesNotMatch(html,/@【|<img|&amp;lt;|\*\*藥箱/);
  assert.match(html,/&lt;img src=x&gt; &amp;amp;/);assert.match(html,/｜特製/);
  assert.match(html,/^前文/);assert.match(html,/後文$/);
});

test('plain reference labels retain literal HTML entities outside card wrappers',()=>{
  const s=state();s.items[0].name='字面 &amp; 字串';const token=tokenFor(s,'items',s.items[0].id);
  assert.match(renderMemoryMentions(token),/字面 &amp;amp; 字串/);
});

test('context uses current descriptions and explicit unknown flags without leaking unrelated settings',()=>{
  const s=state(),token=tokenFor(s,'items',s.items[0].id)+' '+tokenFor(s,'profile','all');
  const context=memoryMentionContext(token,s),data=payload(context);
  assert.equal(data.references[0].description,'內有紗布、繃帶');
  assert.equal(data.references[1].profile.penis,'');
  assert.deepEqual(data.references[1].customFields,[{name:'慣用手',value:'右手'}]);
  assert.doesNotMatch(context,/secretKey|DO_NOT_EXPORT/);
  assert.match(context,/不代表消耗物品/);
});

test('bounded context and collection expansion preserve original saved entries',()=>{
  const s=state();s.items=Array.from({length:500},(_,i)=>({id:'item-'+i,name:'物品'+i,description:'很長的描述'.repeat(100),quantity:i+1}));
  const before=JSON.stringify(s),context=memoryMentionContext('@我的物品',s,{maxChars:1800}),data=payload(context);
  assert.ok(context.length<=1800);
  assert.equal(data.references[0].total,500);
  assert.ok(data.references[0].omitted>0);
  assert.ok(data.references[0].entries.length<=MEMORY_MENTION_LIMITS.groupEntries);
  assert.equal(JSON.stringify(s),before);
});

test('many explicit references are bounded and omitted requests are reported',()=>{
  const s=state();s.items=Array.from({length:60},(_,i)=>({id:'item-'+i,name:'物品'+i,description:'描述'.repeat(4000),quantity:1}));
  const text=s.items.map(row=>tokenFor(s,'items',row.id)).join(' '),context=memoryMentionContext(text,s,{maxChars:3000}),data=payload(context);
  assert.ok(context.length<=3000);
  assert.ok(data.omittedRequests>=36);
  assert.equal(data.truncated,true);
  assert.ok(data.references.every(row=>row.description.length<8000));
});

test('duplicate exact IDs are rejected as ambiguous instead of choosing one',()=>{
  const s=state(),token=tokenFor(s,'items',s.items[0].id);s.items.push({...s.items[0],description:'複製的第二筆'});
  assert.equal(resolveMemoryMentions(token,s).unresolved[0].status,'ambiguous');
});

test('stale selector candidates and invalid field references cannot invent records',()=>{
  const s=state(),candidate=searchMemoryMentions(s,'救援')[0];s.items=[];
  assert.throws(()=>createMemoryMention(s,candidate),/資料已變更/);
  const invalid='@【欄位：密鑰｜使用者甲｜secretKey】';
  assert.equal(resolveMemoryMentions(invalid,s).unresolved[0].status,'missing');
});

test('trigger detects caret-local @ with Chinese text and excludes emails and completed tokens',()=>{
  assert.deepEqual(memoryTrigger('我準備使用@時間停止，後文',10),{start:5,end:10,query:'時間停止'});
  assert.equal(memoryTrigger('user@example.com',16),null);
  assert.equal(memoryTrigger('@【能力：已插入】',10),null);
  assert.deepEqual(memoryTrigger('我＠藥箱',4),{start:1,end:4,query:'藥箱'});
});
