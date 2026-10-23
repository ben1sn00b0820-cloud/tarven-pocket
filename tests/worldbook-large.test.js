import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPhoneWorldbooks,inspectPhoneWorldbooks,readPhoneWorldbookEntry,invalidatePhoneWorldbooks,generatePhoneResponse} from '../pocket/services.js';

function fixture(books){let calls=[],active=0,peak=0;const c={name1:'甲',name2:'角色',getWorldInfoNames:()=>Object.keys(books),loadWorldInfo:async name=>{calls.push(name);active++;peak=Math.max(peak,active);await Promise.resolve();active--;return books[name];}};return {c,books,calls,get peak(){return peak;}};}
const book=entries=>({entries});

test('full indexing has no eight-book, 500-entry or 16K-entry rejection and finds late entries',async()=>{
 const entries={};for(let i=0;i<1200;i++)entries[i]={comment:`資料 ${i}`,content:`普通背景 ${i}。`+'路過的風景。'.repeat(90)};
 entries[1199]={comment:'遠方的答案',key:['星門鑰匙'],content:'星門鑰匙只在第1200條出現。'+'記載完整。'.repeat(5000)};
 const books={巨型:book(entries)};for(let i=0;i<9;i++)books['附冊'+i]=book({a:{content:'附冊背景 '+i}});
 const f=fixture(books),names=Object.keys(books),result=await inspectPhoneWorldbooks(f.c,names,{query:'星門鑰匙'});
 assert.equal(result.enabledEntries,1209);assert.ok(result.totalChars>48000);assert.equal(result.books.length,10);assert.equal(result.entries[0].entryId,'1199');assert.equal(f.peak,1);
 const lore=await loadPhoneWorldbooks(f.c,names,{query:'我需要星門鑰匙',budgetChars:4000});
 assert.match(lore,/星門鑰匙只在第1200條出現/);assert.ok(lore.length<=4000);assert.match(lore,/已索引 1209 條/);assert.match(lore,/未帶入/);
});

test('search and 2000-char context reach the tail of a single giant chapter',async()=>{
 const tail='極光之門的密語是霜月白鹿。',content='很長的舊史。'.repeat(20000)+tail;
 const f=fixture({巨章:book({tail:{comment:'歷史',content}})});
 const result=await inspectPhoneWorldbooks(f.c,['巨章'],{query:'極光之門'});
 assert.equal(result.entries.length,1);assert.match(result.entries[0].preview,/極光之門/);
 const lore=await loadPhoneWorldbooks(f.c,['巨章'],{query:'極光之門',budgetChars:2000});
 assert.match(lore,/霜月白鹿/);assert.ok(lore.length<=2000);assert.match(lore,/局部片段/);
 const page=await readPhoneWorldbookEntry(f.c,['巨章'],{book:'巨章',entryId:'tail',offset:content.length-tail.length,limit:6000});
 assert.equal(page.content,tail);assert.equal(page.totalChars,content.length);assert.equal(page.nextOffset,null);
});

test('small books keep enabled fixed background when a task query has no overlap',async()=>{
 const f=fixture({Cafe:book({a:{comment:'Cafe',content:'CAFE_LORE works as small fixed background.'},b:{content:'SECOND_LORE'}})});
 const lore=await loadPhoneWorldbooks(f.c,['Cafe'],{query:'完全不相干的請求'});
 assert.match(lore,/CAFE_LORE/);assert.match(lore,/SECOND_LORE/);assert.match(lore,/未帶入 0 條/);
});

test('inspector pages entries and reading pages an entire entry without bulk state',async()=>{
 const entries={};for(let i=0;i<88;i++)entries[i]={comment:`條目${i}`,content:`內容${i} `+'字'.repeat(2000)};
 const f=fixture({百科:book(entries)}),first=await inspectPhoneWorldbooks(f.c,['百科'],{limit:20});
 assert.equal(first.entries.length,20);assert.equal(first.total,88);assert.equal(first.nextOffset,20);assert.equal(first.entries[0].content,undefined);
 const next=await inspectPhoneWorldbooks(f.c,['百科'],{offset:first.nextOffset,limit:20});assert.equal(next.entries.length,20);assert.notEqual(first.entries[0].entryId,next.entries[0].entryId);
 let content='',offset=0;do{const page=await readPhoneWorldbookEntry(f.c,['百科'],{book:'百科',entryId:'87',offset,limit:700});content+=page.content;offset=page.nextOffset;}while(offset!==null);
 assert.equal(content,entries[87].content);assert.equal(f.calls.length,1);
});

test('disabled entries never enter search, detail or pinned model context',async()=>{
 const f=fixture({書:book({a:{content:'公開內容'},b:{content:'DISABLED_SECRET',disable:true},c:{content:'DISABLED_SECRET2',disable:1},d:{content:'DISABLED_SECRET3',enabled:false}})});
 const result=await inspectPhoneWorldbooks(f.c,['書'],{query:'DISABLED_SECRET'});assert.equal(result.total,0);assert.equal(result.books[0].disabledEntries,3);
 await assert.rejects(readPhoneWorldbookEntry(f.c,['書'],{book:'書',entryId:'b'}),/停用/);
 const lore=await loadPhoneWorldbooks(f.c,['書'],{pinned:[{book:'書',entryId:'b'}]});assert.doesNotMatch(lore,/DISABLED_SECRET/);assert.match(lore,/1 個固定條目已移除、停用/);
});

test('pins include unrelated current entries before query matches without implying unbounded context',async()=>{
 const f=fixture({書:book({p:{comment:'持久規則',content:'PINNED_RULE 現在使用的魔法不能影響同伴。'},q:{comment:'目標',content:'目標情報。'.repeat(5000)}})});
 const lore=await loadPhoneWorldbooks(f.c,['書'],{query:'目標',budgetChars:3000,pinned:[{book:'書',entryId:'p'},{book:'其他書',entryId:'p'}]});
 assert.match(lore,/PINNED_RULE/);assert.match(lore,/目標情報/);assert.ok(lore.indexOf('PINNED_RULE')<lore.indexOf('目標情報'));assert.match(lore,/1 個固定條目/);assert.ok(lore.length<=3000);
});

test('generation refresh and explicit invalidation see edits, and raw caches do not preserve persona macros',async()=>{
 const f=fixture({書:book({a:{content:'{{user}} OLD'}})});
 assert.match(await loadPhoneWorldbooks(f.c,['書']),/甲 OLD/);
 f.books.書.entries.a.content='{{user}} NEW';f.c.name1='乙';
 const lore=await loadPhoneWorldbooks(f.c,['書']);assert.match(lore,/乙 NEW/);assert.doesNotMatch(lore,/甲|OLD/);
 f.books.書.entries.a.content='LATEST';invalidatePhoneWorldbooks(f.c,'書');
 assert.match((await inspectPhoneWorldbooks(f.c,['書'])).entries[0].preview,/LATEST/);
 f.books.書.entries.a.content='REFRESHED';assert.match((await inspectPhoneWorldbooks(f.c,['書'],{refresh:true})).entries[0].preview,/REFRESHED/);
});

test('selection membership and chat guard prevent stale or other-book reads',async()=>{
 const f=fixture({公開:book({a:{content:'OPEN'}}),私藏:book({a:{content:'OTHER_BOOK'}})});
 await inspectPhoneWorldbooks(f.c,['私藏']);await assert.rejects(readPhoneWorldbookEntry(f.c,['公開'],{book:'私藏',entryId:'a'}),/未接入/);
 let switched=false;f.c.loadWorldInfo=async()=>{switched=true;return f.books.公開;};
 await assert.rejects(loadPhoneWorldbooks(f.c,['公開'],{assertCurrent:()=>{if(switched)throw Error('對話已切換');}}),/對話已切換/);
});

test('load errors and invalid metadata are explicit without old size errors',async()=>{
 const f=fixture({壞書:{entries:{a:{content:3}}}});
 await assert.rejects(loadPhoneWorldbooks(f.c,['壞書']),/內容格式錯誤/);
 await assert.rejects(loadPhoneWorldbooks(f.c,['不存在']),/已不存在/);
 await assert.rejects(loadPhoneWorldbooks(f.c,['壞書','壞書']),/重複選取/);
 f.c.loadWorldInfo=async()=>{throw Error('backend');};await assert.rejects(loadPhoneWorldbooks(f.c,['壞書']),/讀取失敗/);
});

test('generation uses explicit worldbookOptions and enforces serialized context budget after macro expansion',async()=>{
 const f=fixture({書:book({a:{content:'{{user}} '.repeat(2000)+'終點浮島天梯'}})});f.c.name1='很長的目前使用者名字';let received;
 f.c.generateQuietPrompt=async request=>{received=request.quietPrompt;return '完成';};
 const result=await generatePhoneResponse(f.c,{worldbooks:['書'],prompt:'任務本文',worldbookOptions:{query:'終點浮島天梯',budgetChars:2000}});
 assert.equal(result,'完成');assert.match(received,/終點浮島天梯/);assert.ok(received.length<=2005);
 await assert.rejects(loadPhoneWorldbooks(f.c,['書'],{budgetChars:Infinity}),/生成預算/);
});

test('invalidation during loading cannot resurrect an obsolete cached index',async()=>{
 const old=book({a:{content:'OLD_SNAPSHOT'}}),fresh=book({a:{content:'FRESH_SNAPSHOT'}});let reads=0;
 const c={getWorldInfoNames:()=>['書'],loadWorldInfo:async()=>{reads++;if(reads===1){invalidatePhoneWorldbooks(c,'書');return old;}return fresh;}};
 const result=await inspectPhoneWorldbooks(c,['書']);assert.equal(reads,2);assert.match(result.entries[0].preview,/FRESH_SNAPSHOT/);
 assert.match((await inspectPhoneWorldbooks(c,['書'])).entries[0].preview,/FRESH_SNAPSHOT/);
});
