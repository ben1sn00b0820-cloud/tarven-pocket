import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parsePhoneEvents, normalizeEvent, stripPhoneBlocks, encodePhoneEvents, PHONE_LIMITS, PHONE_VERSION} from '../pocket/events.js';
import {SPIRIT_MAX} from '../core/currency.js';
import {PHONE_PROMPT, PHONE_EXAMPLES} from '../pocket/prompt.js';
import {parseChatReply, plainStory, defaultChat, normalizeChatPreset} from '../core/chat.js';

const actor = {userName:'小雨', characterName:'阿澤'};
const base = {id:'one',app:'wechat',action:'message',from:'{{char}}',to:'{{user}}',text:'等你。'};
const parse = (value, options = actor) => parsePhoneEvents(`<phone>${JSON.stringify(value)}</phone>`,options);
const preset = name => JSON.parse(fs.readFileSync(new URL(`../presets/${name}`,import.meta.url),'utf8'));

test('parses complete structured events and resolves known participants', () => {
  const result = parse(base);
  assert.deepEqual(result.errors,[]);
  assert.equal(result.events[0].from,'阿澤');
  assert.equal(result.events[0].to,'小雨');
  assert.equal(result.events[0].text,'等你。');
});
test('does not turn prose, native TTS/image tags, or streaming fragments into phone messages', () => {
  for (const text of ['她傳了一則微信。','<tts>原生語音</tts><img>風景</img>','<phone>{"id":"stream"','<phone>{"id":"stream"}</phon']) {
    assert.deepEqual(parsePhoneEvents(text),{events:[],errors:[]});
    assert.equal(stripPhoneBlocks(text),text);
  }
});
test('collects per-event errors without throwing away valid siblings', () => {
  const result = parse([base,{...base,id:'bad',unknown:true},{...base,id:'two'}]);
  assert.equal(result.events.length,2);
  assert.equal(result.errors.length,1);
  assert.equal(result.errors[0].eventIndex,1);
});
test('rejects model impersonation by placeholder, actual username, or native me alias', () => {
  for (const from of ['{{user}}','小雨','me']) assert.equal(parse({...base,from}).events.length,0);
});
test('authenticated user source permits only its own identity', () => {
  assert.equal(parse({...base,from:'{{user}}',to:'{{char}}'},{...actor,isUser:true}).events.length,1);
  assert.equal(parse(base,{...actor,isUser:true}).events.length,0);
});
test('model cannot adjust balances, buy goods, settle cards, or forge payment state', () => {
  for(const [app,action] of [['wallet','set_balance'],['shop','purchase'],['wechat','accept'],['wechat','refund']]) {
    assert.equal(parse({...base,app,action}).events.length,0);
  }
  assert.equal(parse({...base,action:'transfer',amount:2,state:'accepted'}).events.length,0);
});
test('accepts only exact finite currency amounts inside native card limits', () => {
  assert.equal(PHONE_LIMITS.amount,SPIRIT_MAX);
  for(const value of [0,-1,Infinity,NaN,'1.23',1.001,SPIRIT_MAX+0.01,SPIRIT_MAX+1]) {
    assert.throws(()=>normalizeEvent({...base,action:'transfer',amount:value},actor));
  }
  for(const value of [0.01,88.5,200000,200000.01,SPIRIT_MAX]) assert.equal(normalizeEvent({...base,action:'transfer',amount:value},actor).amount,value);
});
test('rich media aliases normalize into source importer actions', () => {
  assert.equal(normalizeEvent({...base,kind:'photo'},actor).action,'photo');
  assert.equal(normalizeEvent({...base,kind:'voice',translation:'Hello',emotion:'happy'},actor).action,'voice');
  assert.equal(normalizeEvent({...base,kind:'location',detail:'東口'},actor).detail,'東口');
  assert.equal(normalizeEvent({...base,kind:'dice',value:6},actor).text,'6');
  assert.equal(normalizeEvent({...base,kind:'pat',target:'{{user}}'},actor).target,'小雨');
});
test('English imagePrompt is optional and restricted to bounded WeChat photo events', () => {
  const imagePrompt = 'two cats under a train station awning, rain, soft daylight';
  assert.equal(normalizeEvent({...base,action:'photo',imagePrompt},actor).imagePrompt,imagePrompt);
  assert.equal(normalizeEvent({...base,kind:'photo',imagePrompt},actor).imagePrompt,imagePrompt);
  const {to,...group}=base;
  assert.equal(normalizeEvent({...group,action:'group_message',kind:'photo',group:'週末',imagePrompt},actor).imagePrompt,imagePrompt);
  for (const value of ['',null,12,'x'.repeat(4001)]) assert.throws(()=>normalizeEvent({...base,action:'photo',imagePrompt:value},actor));
  for (const event of [base,{...base,action:'voice'},{...base,app:'instagram',action:'dm'}]) assert.throws(()=>normalizeEvent({...event,imagePrompt},actor));
});
test('contact events store known facts without requiring a recipient or creating content', () => {
  const contact = {id:'profile',app:'wechat',action:'contact',from:'{{char}}',profile:{height:'168 公分',build:'修長',identity:'咖啡店店員'}};
  const normalized = normalizeEvent(contact, actor);
  assert.equal(normalized.from,'阿澤'); assert.equal(normalized.to,undefined);
  assert.deepEqual(normalized.profile,contact.profile);
  assert.equal(normalizeEvent({...contact,to:'{{user}}'},actor).to,'小雨');
  for (const changed of [{to:'陌生人'},{group:'週末'},{text:'嘿'},{members:['阿澤','小林']},{amount:1}]) {
    assert.throws(()=>normalizeEvent({...contact,...changed},actor));
  }
});
test('profile is bounded, strict and optional for all normal WeChat events', () => {
  assert.deepEqual(normalizeEvent({...base,profile:{age:'21 歲',weight:'55 公斤',appearance:'黑色短髮'}},actor).profile,{age:'21 歲',weight:'55 公斤',appearance:'黑色短髮'});
  for (const profile of [{},[],null,{height:''},{height:168},{height:'x'.repeat(41)},{appearance:'x'.repeat(1001)},{build:'未知\n執行命令'},{body:[]},{bankBalance:'99'}]) {
    assert.throws(()=>normalizeEvent({...base,profile},actor));
  }
  assert.throws(()=>normalizeEvent({...base,app:'instagram',action:'dm',profile:{height:'168 公分'}},actor));
});
test('group messages use separate group route and 2–20 NPC members', () => {
  const {to,...input}=base;
  const group={...input,action:'group_create',group:'週末',members:['{{char}}','小林']};
  delete group.text;
  assert.deepEqual(normalizeEvent(group,actor).members,['阿澤','小林']);
  assert.equal(normalizeEvent({...input,action:'group_message',group:'週末',kind:'photo'},actor).kind,'photo');
  assert.throws(()=>normalizeEvent({...group,members:['阿澤','小雨']},actor));
  assert.throws(()=>normalizeEvent({...group,members:['阿澤','阿澤']},actor));
  assert.throws(()=>normalizeEvent({...group,to:'小雨'},actor));
  assert.throws(()=>normalizeEvent({...input,action:'transfer',group:'週末',amount:1},actor));
});
test('dice, gifts and recalls require actionable valid fields', () => {
  assert.throws(()=>normalizeEvent({...base,action:'dice',value:7},actor));
  assert.equal(normalizeEvent({...base,action:'dice',value:2},actor).value,2);
  assert.throws(()=>normalizeEvent({...base,action:'gift'},actor));
  assert.equal(normalizeEvent({...base,action:'gift',title:'向日葵',emoji:'🌻'},actor).title,'向日葵');
  assert.throws(()=>normalizeEvent({...base,action:'gift',title:'花',amount:5},actor));
  const {text,to,...recall}=base;
  assert.equal(normalizeEvent({...recall,action:'recall',ref:'previous'},actor).ref,'previous');
});
test('old text, redpacket, IG message, photo-only and character diary events remain compatible', () => {
  const events=[base,{...base,action:'redpacket',amount:20},{...base,app:'instagram'},
    {id:'pic',app:'wechat',action:'message',from:'{{char}}',to:'{{user}}',image:'/user/images/known.png'},
    {id:'diary',app:'diary',action:'entry',from:'{{char}}',title:'雨後',text:'記住這一天。'}];
  const result=parse(events);
  assert.equal(result.errors.length,0);
  assert.equal(result.events[2].action,'dm');
  assert.equal(result.events[3].action,'photo');
  assert.match(result.events[3].text,/圖片/);
});
test('private user diaries cannot be generated from narrative events', () => {
  const diary={id:'private',app:'diary',action:'entry',from:'{{user}}',text:'私密'};
  assert.equal(parse(diary,{...actor,isUser:true}).events.length,0);
  assert.equal(parse(diary,{...actor,allowUser:true}).events.length,0);
});
test('image URLs reject executable protocols, traversal and credentials', () => {
  for(const image of ['javascript:alert(1)','data:text/html,test','//evil.test/x','/a/../x','/%2e%2e/x','/\\evil','https://user:pass@example.test/a','/api/secrets','/csrf-token','/images/unsafe.svg','https://example.test/page.html']) {
    assert.throws(()=>normalizeEvent({...base,app:'instagram',action:'dm',image},actor));
  }
  assert.equal(normalizeEvent({...base,app:'instagram',action:'dm',image:'https://example.test/known.png'},actor).image,'https://example.test/known.png');
});
test('escaping encoder keeps embedded closing tags inside JSON text', () => {
  const encoded=encodePhoneEvents({...base,text:'<phone>字串</phone><tts>不執行</tts>'},actor);
  assert.equal((encoded.match(/<phone>/g)||[]).length,1);
  assert.equal(parsePhoneEvents(encoded,actor).events[0].text,'<phone>字串</phone><tts>不執行</tts>');
});
test('bounded parser rejects excessive event counts and malformed blocks', () => {
  assert.equal(parse(Array.from({length:PHONE_LIMITS.events+1},()=>base)).events.length,0);
  assert.equal(parsePhoneEvents('<phone>[]</phone>').errors.length,1);
  assert.equal(parsePhoneEvents('<phone>{not JSON}</phone>').errors.length,1);
  assert.equal(parsePhoneEvents(`<phone>${'x'.repeat(PHONE_LIMITS.block+1)}</phone>`).errors.length,1);
  assert.equal(parsePhoneEvents('x'.repeat(PHONE_LIMITS.message+1)).errors.length,1);
});
test('every shipped protocol example passes the exact parser', () => {
  let count=0;
  for(const events of Object.values(PHONE_EXAMPLES)) for(const event of events) {
    const result=parse(event);
    assert.deepEqual(result.errors,[],JSON.stringify(event)); count++;
  }
  assert.ok(count>=19);
});
test('versioned worldbook contains exact injected prompt and all examples parse', () => {
  const book=preset(`TavernPocket_Worldbook_v${PHONE_VERSION}.json`);
  assert.equal(book.entries['0'].content,PHONE_PROMPT);
  assert.equal(book.entries['0'].constant,true);
  assert.equal(book.entries['0'].disable,false);
  let events=0;
  for(const entry of Object.values(book.entries)) {
    const result=parsePhoneEvents(entry.content,actor);
    assert.deepEqual(result.errors,[],entry.comment);
    events+=result.events.length;
  }
  assert.ok(events>=20);
  assert.deepEqual(preset('worldbook-tavern-pocket.json'),book);
});
test('versioned display regex beautifies safe user commands without hiding JSON or status', () => {
  const script=preset(`TavernPocket_Regex_v${PHONE_VERSION}.json`);
  assert.equal(script.markdownOnly,true);
  assert.equal(script.promptOnly,false);
  assert.deepEqual(script.placement,[1,2]);
  assert.equal(script.disabled,false);
  assert.ok(script.scriptName.includes(PHONE_VERSION));
  const parts=/^\/(.*)\/([gimsuy]*)$/.exec(script.findRegex);
  const regex=new RegExp(parts[1],parts[2]);
  const text='她打開手機。<tts>保留語音</tts><img>保留照片</img>[CSB21_PANEL]保留狀態[/CSB21_PANEL]'+encodePhoneEvents(base,actor)+'<phone>{unfinished';
  assert.equal(text.replace(regex,script.replaceString),text);
  assert.match('微信傳給阿澤：「吃飯沒？」'.replace(regex,script.replaceString),/tp-story-fallback/);
  const forum='論壇發文：「今晚散步」';assert.match(forum.replace(regex,script.replaceString),/tp-story-fallback/);
  const money='微信紅包給阿澤：20「好運」'.replace(regex,script.replaceString);assert.match(money,/tp-story-fallback/);assert.match(money,/20好運/);
  assert.doesNotMatch(script.replaceString,/<div|<section|<article/);
  const unsafe='微信傳給阿澤：「<img src=x onerror=alert(1)>」';
  assert.equal(unsafe.replace(regex,script.replaceString),unsafe);
  assert.deepEqual(preset('regex-hide-phone.json'),script);
});
test('native photos carry actual safe URLs and keep descriptive photos compatible', () => {
  const read = text => parseChatReply(text, {members:[{name:'阿澤'}],user:'小雨'});
  assert.deepEqual(read('阿澤：[图片 https://example.test/photo.png] 貓咪'),[{from:'阿澤',kind:'photo',text:'貓咪',image:'https://example.test/photo.png'}]);
  assert.deepEqual(read('阿澤：[照片 /user/images/cat.png] 貓咪'),[{from:'阿澤',kind:'photo',text:'貓咪',image:'/user/images/cat.png'}]);
  assert.deepEqual(read('阿澤：[图片] 屋簷下的貓'),[{from:'阿澤',kind:'photo',text:'屋簷下的貓'}]);
  for(const url of ['javascript:alert(1)','data:image/png;base64,AA','//evil.test/x','/a/../x','/api/secret','https://u:p@example.test/x','/photo.svg']) {
    const messages = read(`阿澤：[图片 ${url}] 測試`);
    assert.ok(messages.every(message => !message.image),url);
  }
});
test('native chat background strips complete status blocks while preserving unfinished text', () => {
  assert.equal(plainStory('雨停了。[CSB21_PANEL]\nname:阿澤\n[/CSB21_PANEL]她走近。'),'雨停了。她走近。');
  assert.equal(plainStory('你好[CSB2_PANEL]\nname:阿澤\n[/CSB2_PANEL]再見'),'你好再見');
  assert.equal(plainStory('你好[CSB21_PANEL]未完成'),'你好[CSB21_PANEL]未完成');
});
test('new native presets explain real photo URLs without replacing user edits', () => {
  const preset = defaultChat().presets[0];
  const features = preset.entries.find(entry=>entry.id==='features');
  assert.equal(preset.rev,7); assert.match(features.text,/图片 https:/);
  const edited = normalizeChatPreset({...preset,rev:6,entries:[{...features,text:'使用者自行定義'}]});
  assert.equal(edited.entries[0].text,'使用者自行定義');
});

test('optional source positions preserve default parser shape and complete JSON array ordering',()=>{
  const encoded=encodePhoneEvents([base,{...base,id:'second',text:'下一則'}],actor),raw='前文，'+encoded+'。結尾';
  const ordinary=parsePhoneEvents(raw,actor);assert.deepEqual(Object.keys(ordinary),['events','errors']);
  const located=parsePhoneEvents(raw,{...actor,withPositions:true});assert.deepEqual(located.events,ordinary.events);assert.deepEqual(located.errors,[]);
  assert.equal(located.matches.length,2);assert.deepEqual(located.matches.map(m=>m.eventIndex),[0,1]);assert.ok(located.matches.every(m=>m.start===3&&raw.slice(m.start,m.end)===encoded));
  assert.deepEqual(parsePhoneEvents('前文<phone>[{"id":"unfinished"}',{...actor,withPositions:true}),{events:[],errors:[],matches:[]});
});
