import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPhoneCard,renderPhoneCards,renderActivityCards} from '../pocket/cards.js';
import {encodePhoneEvents,parsePhoneEvents} from '../pocket/events.js';

const actor={userName:'小雨',characterName:'阿澤',isUser:false,messageKey:'cards-v09'};
const receipt={id:'shop:order-123',app:'shop',action:'purchase',from:'me',state:'purchased',itemName:'時間停止能力',itemKind:'ability',amount:88.5,quantity:1,text:'暫停眼前場景的時間。',at:1792670400000};

test('completed native receipt shows owned ability, virtual total and known timestamp without a phone command',()=>{
  const html=renderActivityCards(receipt,actor);
  assert.match(html,/tp-story-receipt/);assert.match(html,/購買完成/);assert.match(html,/時間停止能力/);
  assert.match(html,/虛擬付款金額/);assert.match(html,/88\.50/);assert.match(html,/已加入「我的能力」/);assert.match(html,/tp-story-card-time/);
  assert.doesNotMatch(html,/<phone>|<\/?(?:div|p|section|article|ul|li|h[1-6])\b/);
  assert.equal(renderPhoneCard(receipt,{...actor,source:'story'}),'');
});

test('catalogues and forged shop protocols never produce a settled receipt',()=>{
  assert.equal(renderActivityCards({...receipt,action:'catalogue'},actor),'');
  const raw='<phone>'+JSON.stringify(receipt)+'</phone>';
  assert.equal(parsePhoneEvents(raw,actor).events.length,0);
  assert.equal(renderPhoneCards(raw,actor),raw);
  const html=renderActivityCards({...receipt,state:'pending'},actor);
  assert.doesNotMatch(html,/購買完成|已加入|虛擬付款金額/);assert.match(html,/待處理/);
  const unknown=renderActivityCards({...receipt,state:undefined,amount:undefined},actor);
  assert.doesNotMatch(unknown,/購買完成|已加入|虛擬付款金額/);assert.match(unknown,/未記載金額/);
});

test('receipt names, descriptions and buyer text cannot inject HTML or Markdown',()=>{
  const html=renderActivityCards({...receipt,id:'" onclick="evil',itemKind:'item',quantity:3,itemName:'<img src=x> **戒指**',from:'<svg/onload=evil>',text:'第一行\n\n[連結](https://example.test) <script>evil()</script>'},actor);
  assert.match(html,/已加入「我的物品」/);assert.match(html,/× 3/);assert.match(html,/&lt;img/);assert.match(html,/&#42;&#42;戒指&#42;&#42;/);assert.match(html,/&#10;&#10;/);
  assert.doesNotMatch(html,/<img\b|<script\b|<svg\b|<a\b|\n|\*\*/);
});

test('forum card has board, title and reply reference while preserving adjacent story',()=>{
  const forum={id:'f1',app:'forum',action:'post',from:'阿澤',title:'週末去哪裡？',board:'日常交流',text:'想找安靜的散步路線。'};
  const reply={id:'f2',app:'forum',action:'comment',from:'小林',ref:'f1',text:'河堤吧。'};
  const raw='她看向窗外，'+encodePhoneEvents([forum,reply],actor)+'隨後收起手機。';
  const html=renderPhoneCards(raw,actor);
  assert.ok(html.startsWith('她看向窗外，'));assert.ok(html.endsWith('隨後收起手機。'));
  assert.equal((html.match(/data-tp-card=/g)||[]).length,2);assert.match(html,/tp-story-forum-board/);assert.match(html,/日常交流/);assert.match(html,/週末去哪裡？/);assert.match(html,/回應 f1/);
  assert.doesNotMatch(html,/<\/?(?:div|p|section|article|blockquote)\b|<phone>/);
});

test('mixed shopping, forum and WeChat cards retain stable order and no catalogue spam',()=>{
  const html=renderActivityCards([{id:'wx',app:'wechat',action:'message',from:'me',to:'阿澤',text:'收到。'},receipt,{id:'forum',app:'forum',action:'post',from:'阿澤',text:'出發了。'},{...receipt,id:'offer',action:'catalogue',itemName:'未購商品'}],actor);
  assert.equal((html.match(/data-tp-card=/g)||[]).length,3);assert.ok(html.indexOf('收到。')<html.indexOf('時間停止能力'));assert.ok(html.indexOf('時間停止能力')<html.indexOf('出發了。'));assert.doesNotMatch(html,/未購商品/);
});
