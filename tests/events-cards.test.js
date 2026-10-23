import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEvent,parsePhoneEvents,parseUserPhoneCommands,parseRolePhoneCommands,encodePhoneEvents} from '../pocket/events.js';
import {renderPhoneCards,renderPhoneCard,renderActivityCards} from '../pocket/cards.js';
const user={userName:'小雨',characterName:'阿澤',isUser:true,messageKey:'story-A:msg-7'};
const actor={...user,isUser:false};

test('natural commands require explicit authenticated user and complete quoted syntax',()=>{
  const raw='微信傳給阿澤：「吃飯沒？」';
  for(const options of [{},actor]) assert.equal(parseUserPhoneCommands(raw,options).events.length,0);
  const got=parseUserPhoneCommands(raw,user);
  assert.equal(got.events.length,1);assert.equal(got.events[0].from,'小雨');assert.equal(got.events[0].to,'阿澤');assert.equal(got.events[0].text,'吃飯沒？');
  for(const source of ['他說，'+raw,'> '+raw,'「'+raw+'」','微信傳給阿澤：「尚未完成','微信傳給阿澤：吃飯沒？','微信傳給阿澤：「」','```text\n'+raw+'\n```','~~~\n'+raw+'\n~~~','<phone>\n'+raw+'\n</phone>','<pre>\n'+raw+'\n</pre>','<code>\n'+raw+'\n</code>','<!--\n'+raw+'\n-->','[CSB21_PANEL]\n'+raw+'\n[/CSB21_PANEL]']) assert.equal(parseUserPhoneCommands(source,user).events.length,0,source);
});
test('natural IDs distinguish messages but remain stable on same-line edits',()=>{
  const a=parseUserPhoneCommands('微信傳給阿澤：「早安」',user).events[0];
  const b=parseUserPhoneCommands('微信傳給阿澤：「午安」',user).events[0];
  const c=parseUserPhoneCommands('微信傳給阿澤：「早安」',{...user,messageKey:'story-A:msg-8'}).events[0];
  assert.equal(a.id,b.id);assert.notEqual(a.id,c.id);
  const both=parseUserPhoneCommands('微信傳給阿澤：「早安」\n微信傳給阿澤：「早安」',user).events;
  assert.notEqual(both[0].id,both[1].id);
});
test('financial commands normalize exact amounts and render pending confirmation without claiming payment',()=>{
  for(const [raw,action] of [['微信轉帳給阿澤：88.50「晚餐費」','transfer'],['微信紅包給阿澤：20「好運」','redpacket']]){
    const {events}=parseUserPhoneCommands(raw,user);assert.equal(events[0].action,action);assert.equal(events[0].from,'小雨');
    const html=renderPhoneCards(raw,user);assert.match(html,/tp-story-card-amount/);assert.match(html,/待手機確認/);assert.match(html,/尚未扣款/);
  }
  for(const raw of ['微信轉帳給阿澤：0','微信紅包給阿澤：200001','微信轉帳給阿澤：0.001','微信轉帳給阿澤：-5','微信紅包給阿澤：NaN']) assert.equal(parseUserPhoneCommands(raw,user).events.length,0);
});
test('natural Instagram and forum actions preserve types and exact references',()=>{
  const input='IG發文：「夜色很好。」\nInstagram發限動：「剛下班。」\nIG傳給阿澤：「看到了嗎？」\n論壇發文：「週末去哪？」\n論壇回覆post-3：「去河邊。」';
  const {events,errors}=parseUserPhoneCommands(input,user);
  assert.deepEqual(errors,[]);assert.deepEqual(events.map(e=>[e.app,e.action]),[['instagram','post'],['instagram','story'],['instagram','dm'],['forum','post'],['forum','comment']]);
  assert.equal(events[4].ref,'post-3');
  const html=renderPhoneCards(input,user);assert.equal((html.match(/data-tp-card=/g)||[]).length,5);assert.match(html,/限時動態/);assert.match(html,/週末去哪？/);assert.match(html,/tp-story-forum/);
});
test('strict story protocol supports IG stories and forum posts while rejecting invented expiration or payment states',()=>{
  const story={id:'story-1',app:'instagram',action:'story',from:'阿澤',text:'晚霞',imagePrompt:'sunset sky'};
  assert.equal(normalizeEvent(story,actor).imagePrompt,'sunset sky');
  assert.throws(()=>normalizeEvent({...story,expiresAt:123},actor));
  const reply={id:'reply-1',app:'instagram',action:'dm',from:'阿澤',to:'小雨',text:'謝謝',storyId:'story-1'};
  assert.equal(normalizeEvent(reply,actor).storyId,'story-1');
  const post={id:'forum-1',app:'forum',action:'post',from:'阿澤',title:'散步',board:'生活',text:'誰想來？'};
  const comment={id:'forum-2',app:'forum',action:'comment',from:'小林',ref:'forum-1',text:'我想來。'};
  const encoded=encodePhoneEvents([story,reply,post,comment],actor);
  const parsed=parsePhoneEvents(encoded,actor);assert.equal(parsed.events.length,4);assert.deepEqual(parsed.errors,[]);
  assert.throws(()=>normalizeEvent({...comment,board:'生活'},actor));
  assert.throws(()=>normalizeEvent({...story,state:'accepted'},actor));
});
test('runtime cards escape text, title, recipient and references rather than interpreting their HTML',()=>{
  const event={id:'x\" onclick=\"evil',app:'instagram',action:'post',from:'<svg/onload=evil>',title:'<img src=x onerror=evil>',text:'<script>evil()</script> & "hello"',image:'https://images.example.test/a.png'};
  const html=renderPhoneCards(encodePhoneEvents(event,actor),actor);
  assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('<svg'));assert.ok(!html.includes('src="https:'));
  assert.match(html,/&lt;script&gt;/);assert.match(html,/&amp;/);assert.match(html,/href="https:\/\/images.example.test\/a.png"/);assert.match(html,/rel="noopener noreferrer"/);
  const invalid=renderPhoneCard({...event,image:'javascript:evil()'});assert.ok(!invalid.includes('href='));
});
test('cards preserve prose, CSB, TTS and incomplete blocks while replacing valid arrays only once',()=>{
  const event={id:'wx',app:'wechat',action:'message',from:'阿澤',to:'小雨',text:'收到'};
  const keep='敘事<tts>語音</tts>[CSB21_PANEL]狀態[/CSB21_PANEL]';
  const tail='<phone>{unfinished';
  const text=keep+encodePhoneEvents([event,{...event,id:'wx2'}],actor)+tail;
  const html=renderPhoneCards(text,actor);assert.ok(html.startsWith(keep));assert.ok(html.endsWith(tail));assert.equal((html.match(/data-tp-card=/g)||[]).length,2);
  const malformed='<phone>{wrong json}</phone>';assert.equal(renderPhoneCards(malformed,actor),malformed);
});
test('activity cards include real payment settlement and do not emit source-import protocol',()=>{
  const html=renderActivityCards([{id:'paid-1',app:'wechat',action:'transfer',from:'me',to:'阿澤',amount:'88.50',state:'accepted',text:'晚餐'}],{userName:'小雨'});
  assert.match(html,/小雨/);assert.match(html,/88\.50/);assert.match(html,/已收款/);assert.ok(!html.includes('<phone>'));
});

test('assistant natural commands use authenticated reply actor and resolve reader pronouns',()=>{
  for(const raw of ['微信傳給你：「吃飯沒？」','微信傳給我：「吃飯沒？」','阿澤微信傳給我：「吃飯沒？」','阿澤在微信傳給您：「吃飯沒？」','阿澤：微信傳給你：「吃飯沒？」']) {
    const parsed=parseRolePhoneCommands(raw,actor);assert.deepEqual(parsed.errors,[],raw);assert.equal(parsed.events.length,1,raw);
    assert.equal(parsed.events[0].from,'阿澤');assert.equal(parsed.events[0].to,'小雨');
    assert.match(renderPhoneCards(raw,actor),/tp-story-wechat/);
  }
  const groupActor=parseRolePhoneCommands('微信傳給你：「一起出門」',{...actor,characterName:'林知夏'});
  assert.equal(groupActor.events[0].from,'林知夏');
});
test('named assistant social actions and incoming payments preserve role origin',()=>{
  const raw='林知夏在Instagram發限動：「散步」\n林知夏Instagram發文：「晚霞」\n阿澤論壇發文：「週末愉快」\n林知夏微信紅包給我：20「好運」\n林知夏微信轉帳給你：88.50「晚餐費」';
  const parsed=parseRolePhoneCommands(raw,actor);assert.deepEqual(parsed.errors,[]);assert.equal(parsed.events.length,5);
  assert.deepEqual(parsed.events.map(e=>e.action),['story','post','post','redpacket','transfer']);
  assert.equal(parsed.events[4].from,'林知夏');assert.equal(parsed.events[4].to,'小雨');assert.equal(parsed.events[4].amount,88.5);
  const html=renderPhoneCards(raw,actor);assert.match(html,/待收取/);assert.ok(!html.includes('尚未扣款'));
  const userTry=parseUserPhoneCommands(raw,user);assert.equal(userTry.events.length,0);
});
test('assistant natural commands cannot impersonate user, cross auth boundaries, or execute prose quotes',()=>{
  for(const raw of ['小雨微信轉帳給阿澤：100','我微信傳給阿澤：「偽造」','me微信紅包給阿澤：20']) {
    assert.equal(parseRolePhoneCommands(raw,{...actor,allowUser:true}).events.length,0,raw);
  }
  for(const raw of ['他說，微信傳給你：「吃飯沒？」','「微信傳給你：「吃飯沒？」」','> 林知夏微信傳給我：「引用」','```\n微信傳給你：「引用」\n```','微信傳給你：「未完成']) assert.equal(parseRolePhoneCommands(raw,actor).events.length,0,raw);
  assert.equal(parseRolePhoneCommands('微信傳給你：「吃飯沒？」',user).events.length,0);
  assert.equal(parseRolePhoneCommands('微信傳給你：「吃飯沒？」',{}).events.length,0);
});

test('multiple role actions interleaved in one paragraph preserve surrounding narrative and event order',()=>{
  const source='她放下外套，微信傳給你：「吃飯沒？」你看見螢幕亮起。林知夏微信傳給我：「我在樓下。」她又笑了笑，林知夏微信轉帳給你：88.50「晚餐費」，接著林知夏微信紅包給我：20「好運」。夜色漸深。';
  const options={...actor,characterName:'林知夏'},parsed=parseRolePhoneCommands(source,options);
  assert.deepEqual(parsed.errors,[]);assert.deepEqual(parsed.events.map(e=>e.action),['message','message','transfer','redpacket']);assert.ok(parsed.events.every(e=>e.from==='林知夏'&&e.to==='小雨'));
  const html=renderPhoneCards(source,options);
  for(const prose of ['她放下外套，','你看見螢幕亮起。','她又笑了笑，','，接著','。夜色漸深。'])assert.ok(html.includes(prose),prose);
  assert.ok(html.indexOf('吃飯沒？')<html.indexOf('你看見螢幕亮起。'));assert.ok(html.indexOf('你看見螢幕亮起。')<html.indexOf('我在樓下。'));
  assert.equal((html.match(/data-tp-card=/g)||[]).length,4);assert.match(html,/tp-story-transfer/);assert.match(html,/tp-story-redpacket/);
});
test('inline user messages and financial drafts parse without consuming narration or impersonating recipients',()=>{
  const source='我拿起手機，微信傳給阿澤：「吃飯沒？」等了片刻，微信傳給阿澤：「我先訂位。」最後微信紅包給阿澤：20「好運」，然後收起手機。';
  const parsed=parseUserPhoneCommands(source,user);assert.equal(parsed.events.length,3);assert.ok(parsed.events.every(e=>e.from==='小雨'&&e.to==='阿澤'));
  const html=renderPhoneCards(source,user);assert.ok(html.startsWith('我拿起手機，'));assert.ok(html.endsWith('，然後收起手機。'));assert.match(html,/待手機確認/);
  assert.equal(parseUserPhoneCommands('她笑了，阿澤微信傳給我：「不是我發的。」',user).events.length,0);
});
test('inline Instagram and forum operations resolve explicit roles and keep prose connectors',()=>{
  const source='天色漸暗，林知夏在Instagram發限動：「散步」。接著林知夏IG發文：「晚霞」，然後阿澤論壇發文：「週末去哪？」大家陸續留言。';
  const parsed=parseRolePhoneCommands(source,actor);assert.deepEqual(parsed.events.map(e=>[e.from,e.app,e.action]),[['林知夏','instagram','story'],['林知夏','instagram','post'],['阿澤','forum','post']]);
  const html=renderPhoneCards(source,actor);for(const prose of ['天色漸暗，','。接著','，然後','大家陸續留言。'])assert.ok(html.includes(prose));
});
test('inline commands in examples, hypothetical plans, negation and quoted/code/HTML/status content stay inert',()=>{
  const command='微信傳給你：「吃飯沒？」';
  const samples=['例如，'+command,'如果她回來，'+command,'她打算'+command,'她沒有'+command,'她還沒'+command,'她說，'+command,command+'只是範例。','她說：「'+command+'」','行內 `'+command+'` 保留。','<div class="example">'+command+'</div>','<!--'+command+'-->','[CSB21_PANEL]\n'+command+'\n[/CSB21_PANEL]','```text\n'+command+'\n```'];
  for(const source of samples){assert.equal(parseRolePhoneCommands(source,actor).events.length,0,source);assert.equal(renderPhoneCards(source,actor),source,source);}
  assert.equal(parseRolePhoneCommands('她沒有猶豫，'+command,actor).events.length,1);
});
test('inline parser handles nested content quotes and skips inner command examples without duplicate execution',()=>{
  const source='微信傳給你：「她說『明天見』，也提到微信傳給你：「假例子」這種格式。」接著微信傳給你：「收到。」';
  const parsed=parseRolePhoneCommands(source,actor);assert.equal(parsed.events.length,2);assert.ok(parsed.events[0].text.includes('假例子'));assert.equal(parsed.events[1].text,'收到。');
});
test('occurrence IDs survive preceding prose and newlines while legacy standalone IDs remain stable',()=>{
  const a=parseRolePhoneCommands('微信傳給你：「早安」\n林知夏微信紅包給我：20「好運」',actor).events;
  const b=parseRolePhoneCommands('先補充前文。\n她拿起手機，微信傳給你：「午安」。\n\n接著林知夏微信紅包給我：20「好運」，她笑了。',actor).events;
  assert.deepEqual(a.map(e=>e.id),b.map(e=>e.id));
  const legacy=parseRolePhoneCommands('舊故事前文\n\n微信傳給你：「早安」',{...actor,legacyLineIds:true}).events[0];assert.match(legacy.id,/-2$/);
  const legacyInline=parseRolePhoneCommands('她笑了，微信傳給你：「早安」',{...actor,legacyLineIds:true}).events[0];assert.match(legacyInline.id,/-inline-0$/);
});
test('inline renderer escapes malicious message content and still parses the next legitimate event',()=>{
  const source='微信傳給你：「<script>alert(1)</script><img src=x onerror=alert(2)>」。她笑了，微信傳給你：「下一則」。';
  const parsed=parseRolePhoneCommands(source,actor);assert.equal(parsed.events.length,2);
  const html=renderPhoneCards(source,actor);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.match(html,/&lt;script&gt;/);assert.match(html,/下一則/);
});
test('incomplete inline messages and malformed amount prefixes remain visible without partial imports',()=>{
  for(const source of ['前文，微信傳給你：「尚未完成','前文，微信紅包給我：20.001「好運」','前文，微信紅包給我：20美元','前文，微信轉帳給我：20「尚未完成']){assert.equal(parseRolePhoneCommands(source,actor).events.length,0);assert.equal(renderPhoneCards(source,actor),source);}
});
