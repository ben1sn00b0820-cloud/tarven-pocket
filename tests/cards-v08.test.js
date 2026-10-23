import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPhoneCard,renderPhoneCards,renderActivityCards} from '../pocket/cards.js';
import {encodePhoneEvents,parsePhoneEvents,parseRolePhoneCommands} from '../pocket/events.js';

const actor={userName:'小雨',characterName:'阿澤',isUser:false,messageKey:'cards-v08'};
const wx={id:'wx-1',app:'wechat',action:'message',from:'阿澤',to:'小雨',text:'到了嗎？'};
const forum={id:'forum-1',app:'forum',action:'post',from:'阿澤',title:'市集',text:'週末河邊有市集。'};

test('inline cards keep parent paragraphs valid even with quotes, payment status and multiple events',()=>{
  const raw='雨還沒停，'+encodePhoneEvents([{...wx,quote:{from:'小雨',text:'明天見'}},{...wx,id:'red-1',action:'redpacket',amount:20,text:'路上小心'}],actor)+'他收起手機。';
  const output=renderPhoneCards(raw,actor);
  assert.ok(output.startsWith('雨還沒停，'));assert.ok(output.endsWith('他收起手機。'));
  assert.doesNotMatch(output,/<\/?(?:div|p|blockquote|section|article|figure|ul|ol|li|h[1-6])\b/i);
  assert.equal((output.match(/data-tp-card=/g)||[]).length,2);
  assert.match(output,/待收取/);
});

test('message Markdown and blank lines stay literal inside cards before the host Markdown pass',()=>{
  const output=renderPhoneCard({...wx,text:'*原樣* _內容_ ~~沒有刪除~~\n\n[連結](https://bad.test) `code` \\尾',quote:{from:'阿澤',text:'第一行\n第二行'}},actor);
  assert.doesNotMatch(output,/\n|\r|\*|`|~~|\[連結\]/);
  assert.match(output,/&#42;原樣&#42;/);assert.match(output,/&#10;&#10;/);assert.match(output,/&#91;連結&#93;/);assert.match(output,/&#92;尾/);
  assert.doesNotMatch(output,/<a\b/);
});

test('forum protocol renders in place while phone parsing and adjacent narrative remain intact',()=>{
  const protocol=encodePhoneEvents([forum,wx],actor);
  const raw='午後，'+protocol+'我合上手機。';
  const output=renderPhoneCards(raw,actor);
  assert.equal(parsePhoneEvents(raw,actor).events.length,2);
  assert.match(output,/tp-story-forum/);assert.match(output,/市集/);assert.doesNotMatch(output,/<phone>/);
  assert.match(output,/到了嗎？/);assert.ok(output.startsWith('午後，'));assert.ok(output.endsWith('我合上手機。'));
  const single=renderPhoneCards('前文'+encodePhoneEvents(forum,actor)+'後文',actor);assert.ok(single.startsWith('前文'));assert.ok(single.endsWith('後文'));assert.match(single,/週末河邊有市集/);
});

test('explicit forum narrative becomes a card without changing phone event identity',()=>{
  const source='阿澤論壇發文：「週末去哪？」他看了一眼窗外，微信傳給我：「一起嗎？」';
  const before=parseRolePhoneCommands(source,actor).events;
  const output=renderPhoneCards(source,actor);
  assert.match(output,/tp-story-forum/);assert.match(output,/週末去哪？/);assert.match(output,/他看了一眼窗外，/);
  assert.equal((output.match(/data-tp-card=/g)||[]).length,2);
  assert.deepEqual(parseRolePhoneCommands(source,actor).events,before);
});

test('native forum and completed purchases create distinct cards while untrusted shop events do not',()=>{
  const events=[forum,{id:'shop-1',app:'shop',action:'purchase',from:'me',title:'時間停止能力',amount:99},wx];
  const output=renderActivityCards(events,actor);
  assert.match(renderPhoneCard(forum),/tp-story-forum/);assert.equal(renderPhoneCard(events[1]), '');
  assert.match(output,/市集/);assert.match(output,/時間停止能力/);assert.match(output,/tp-story-forum/);assert.match(output,/tp-story-receipt/);
  assert.equal((output.match(/data-tp-card=/g)||[]).length,3);
});

test('financial displays distinguish incoming, user drafts and settled payments without fabricating gift transfers',()=>{
  const transfer={...wx,action:'transfer',amount:88.5};
  const draft=renderPhoneCard({...transfer,from:'小雨',to:'阿澤'},{...actor,isUser:true,source:'user-command'});
  assert.match(draft,/88\.50/);assert.match(draft,/待手機確認 · 尚未扣款/);
  const received=renderPhoneCard({...transfer,action:'payment_status',paymentKind:'transfer',state:'accepted'},actor);
  assert.match(received,/已收款/);assert.doesNotMatch(received,/待收取|尚未扣款/);
  const gift=renderPhoneCard({...wx,action:'payment_status',paymentKind:'gift',title:'向日葵',state:'accepted'},actor);
  assert.doesNotMatch(gift,/tp-story-money|tp-story-transfer|tp-story-card-amount/);
});

test('Instagram stories receive a distinct compact treatment and unsafe text remains escaped',()=>{
  const html=renderPhoneCard({...wx,app:'instagram',action:'story',id:'x" onclick="evil',title:'<img src=x>',text:'<script>bad()</script>',image:'javascript:alert(1)'},actor);
  assert.match(html,/tp-story-ig-story/);assert.match(html,/限時動態/);
  assert.doesNotMatch(html,/<script>|<img\b|href=/);assert.match(html,/&lt;script&gt;/);
});
