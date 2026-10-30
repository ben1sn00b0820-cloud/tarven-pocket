import test from 'node:test';
import assert from 'node:assert/strict';
import {stripPhoneOperations,isPhoneOnlyMessage} from '../pocket/cards.js';
import {parsePhoneEvents,parseRolePhoneCommands} from '../pocket/events.js';
import {createActivityBridge} from '../pocket/activity.js';
const options={isUser:false,userName:'小雨',characterName:'阿澤',messageKey:'msg-1'};
const event={id:'remote-1',app:'wechat',action:'message',from:'阿澤',to:'小雨',text:'下班見'};
const block='<phone>'+JSON.stringify(event)+'</phone>';

test('phone-only protocol, natural commands and historical receipts leave no story bubble',()=>{
  for (const mes of [block,'```json\n'+block+'\n```','阿澤微信傳給你：「下班見」。']) {
    const message={mes,is_user:false};
    assert.equal(stripPhoneOperations(mes,options),'');
    assert.equal(isPhoneOnlyMessage(message,options),true);
    assert.equal(message.mes,mes);
  }
  assert.equal(isPhoneOnlyMessage({mes:'old receipt',extra:{tavern_pocket_activity:{version:3}}},options),true);
  assert.equal(stripPhoneOperations('<span>old receipt</span>',{activity:true}),'');
});

test('hidden phone operations remain parseable and preserve narrative, drawings and both status systems',()=>{
  const status='<CSB_UPDATE>{"characters":[{"id":"a","set":{"mood":"平靜"}}]}</CSB_UPDATE>';
  const legacy='[CSB21_PANEL]角色狀態[/CSB21_PANEL]';
  const draw='<pic>sunset</pic>';
  const mes='他走到門口。'+block+'她抬頭笑了。'+status+legacy+draw;
  const original=parsePhoneEvents(mes,options);
  assert.equal(stripPhoneOperations(mes,options),'他走到門口。她抬頭笑了。'+status+legacy+draw);
  assert.deepEqual(parsePhoneEvents(mes,options),original);
  assert.equal(isPhoneOnlyMessage({mes,is_user:false},options),false);
  assert.equal(stripPhoneOperations(status.replace('平靜',block),options),status.replace('平靜',block));
  const natural='他走到門口。阿澤微信傳給你：「下班見」。她抬頭笑了。';
  assert.equal(parseRolePhoneCommands(natural,options).events.length,1);
  assert.equal(stripPhoneOperations(natural,options),'他走到門口。她抬頭笑了。');
});

test('examples and ordinary discussion stay visible; incomplete streaming cannot eat following CSB',()=>{
  for(const mes of ['例如微信傳給你：「範例」','「微信傳給你：「引用」」','```\n微信傳給你：「範例」\n```','他打算稍後傳訊息。']) {
    assert.equal(stripPhoneOperations(mes,options),mes);
    assert.equal(isPhoneOnlyMessage({mes,is_user:false},options),false);
  }
  const partial='正文。<phone>{"app":"wechat",';
  assert.equal(stripPhoneOperations(partial,{...options,streaming:true}),'正文。');
  assert.equal(stripPhoneOperations(partial+'<CSB_UPDATE>{"present":[]}</CSB_UPDATE>',{...options,streaming:true}),'正文。<CSB_UPDATE>{"present":[]}</CSB_UPDATE>');
  assert.equal(stripPhoneOperations('正文。<phone>bad json</phone>後續。',options),'正文。後續。');
});

function fixture() {
  const threads=[],renders=[],saves=[];
  const c={chatId:'A',characterId:0,characters:[{avatar:'a.png'}],name1:'小雨',name2:'阿澤',chat:[],chatMetadata:{},saveChat:async()=>saves.push(1),addOneMessage:m=>renders.push(m)};
  const backend={threads:async()=>threads,apps:{list:async()=>[]},spaceKey:()=>''};
  const bridge=createActivityBridge({context:()=>c,backend,getMirrorPolicy:()=>({enabled:false,forum:true,shop:true})});
  return {c,threads,renders,saves,bridge};
}

test('background-only mode journals send, incoming reply, settlement, purchase and posts without appending chat',async()=>{
  const f=fixture();
  try {
    f.threads.push({id:'dm',type:'dm',name:'阿澤',members:['阿澤'],messages:[]});
    await f.bridge.baseline();
    f.threads[0].messages.push({id:'send',from:'me',kind:'text',text:'我到門口了',at:1},{id:'reply',from:'阿澤',kind:'text',text:'馬上下樓',at:2},{id:'pay',from:'me',kind:'transfer',amount:20,paymentId:'p',state:'accepted',openedBy:'阿澤',at:3});
    await f.bridge.sync();
    await f.bridge.record([{id:'purchase:p',app:'shop',action:'purchase',from:'小雨',itemName:'傘',itemKind:'items',amount:10,state:'purchased',at:4},{id:'post',app:'forum',action:'post',from:'阿澤',title:'今晚',text:'吃飯',at:5},{id:'ig',app:'instagram',action:'dm',from:'阿澤',to:'小雨',text:'IG回覆',at:6}]);
    const rows=f.c.chatMetadata.tavern_pocket_v3.activity.journal;
    assert.equal(rows.length,7);
    assert(rows.every(row=>row.delivery==='memory'));
    assert.equal(f.c.chat.length,0);assert.equal(f.renders.length,0);
    assert.match(f.bridge.contextText(),/我到門口了|馬上下樓|IG回覆/);
    assert.match(f.bridge.recall('查詢萬寶閣的購買紀錄'),/傘/);
    await f.bridge.baseline();await f.bridge.sync();
    assert.equal(f.c.chat.length,0);assert.equal(rows.length,7);
  } finally {f.bridge.dispose();}
});

test('upgrade cancels pending outward delivery but retains old saved receipt and source metadata',async()=>{
  const f=fixture();
  try {
    await f.bridge.baseline();
    const d=f.c.chatMetadata.tavern_pocket_v3.activity;
    d.journal.push({id:'pending',event:{id:'pending',app:'instagram',action:'post',from:'阿澤',text:'waiting',at:1},delivery:'pending',mirrorVersion:3});
    const legacy={mes:'old',extra:{tavern_pocket_activity:{version:3,ids:['old']}}};
    f.c.chat.push(legacy);
    await f.bridge.baseline();
    assert.equal(d.journal[0].delivery,'memory');
    assert.equal(f.c.chat.length,1);assert.equal(f.c.chat[0],legacy);assert.equal(f.renders.length,0);
  } finally {f.bridge.dispose();}
});
