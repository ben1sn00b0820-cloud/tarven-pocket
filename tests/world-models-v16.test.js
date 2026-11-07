import test from 'node:test';
import assert from 'node:assert/strict';
import {setWorldMode,getWorldMode,worldText,worldProfile} from '../core/world.js';
import {parseSpiritText,formatSpiritAmount,SPIRIT_CURRENCY_RULE,addWalletAmount} from '../core/currency.js';
import {normalizeSettings} from '../core/state.js';
import {APPS} from '../ui/apps.js';
import {PHONE_PROMPT} from '../pocket/prompt.js';
import {shopInstruction,createShopService,shopPrice} from '../pocket/shop.js';
import {searchMarkup} from '../pocket/shop-ui.js';
import {createTaskModels} from '../pocket/task-models.js';
import {StateController} from '../companions/csb-character-state/src/controller.js';

test.afterEach(()=>setWorldMode('xianxia'));
test('world modes use their own units, exact arithmetic and reject other-world units',()=>{
 setWorldMode('ancient');assert.equal(parseSpiritText('1 兩金子 2 兩銀子 3 文銅錢'),12003);
 assert.equal(parseSpiritText('0.5 兩銀子'),500);assert.equal(formatSpiritAmount(12003),'1 兩金子 · 2 兩銀子 · 3 文銅錢');
 assert.throws(()=>parseSpiritText('2 中品靈石'));assert.equal(shopPrice('2 兩銀子'),2000);
 setWorldMode('modern');assert.equal(parseSpiritText('1 萬元 2 百元 3 元'),10203);assert.equal(formatSpiritAmount(1234.25),'1234.25 元');
 assert.throws(()=>parseSpiritText('2 兩銀子'));assert.throws(()=>parseSpiritText('3 元，'));assert.equal(addWalletAmount(12.25,-2),10.25);
 setWorldMode('xianxia');assert.equal(parseSpiritText('1極品 2中品 3下品'),100203);
});
test('live names and prompts switch without rewriting user text or balances',()=>{
 const saved=normalizeSettings({general:{},chat:{wallet:{balance:520.25}}});
 for(const [mode,name,unit] of [['modern','微信','元'],['ancient','飛鴿傳書','文銅錢'],['xianxia','千里傳音','下品靈石']]){
  setWorldMode(mode);assert.equal(APPS.chat.name,name);assert.ok(PHONE_PROMPT.includes(name));assert.ok(PHONE_PROMPT.includes(SPIRIT_CURRENCY_RULE));
  assert.equal(worldProfile().base,unit);assert.equal(saved.chat.wallet.balance,520.25);
  if(mode!=='xianxia'){assert.doesNotMatch(PHONE_PROMPT,/靈石/);assert.doesNotMatch(shopInstruction({query:'牙刷'}),/靈石|1000 中品/);assert.doesNotMatch(searchMarkup(),/靈石|1000 中品/);}
 }
 setWorldMode('modern');const user='我的靈石收藏／千里傳音';assert.equal(worldText`開啟千里傳音：${user}`,'開啟微信：'+user);
 assert.equal(normalizeSettings({general:{worldMode:'bad'}}).general.worldMode,'xianxia');
});
function modelFixture(){
 const calls=[],c={extensionSettings:{connectionManager:{profiles:[{id:'profile-a',name:'A',api:'openai',model:'model-a'}]}},CONNECT_API_MAP:{openai:{selected:'openai',source:'openai'}},ConnectionManagerRequestService:{sendRequest:async(...args)=>{calls.push(['profile',...args]);return {content:'profile-result'};}},generateRaw:async args=>{calls.push(['raw',args]);return 'raw-result';},generateQuietPrompt:async args=>{calls.push(['quiet',args]);return 'quiet-result';}};
 const backend={settings:{text:{presets:[{id:'custom-a',name:'Local',url:'https://example.invalid/v1',model:'model-b',temperature:0.4,maxTokens:4096}]}},textKeys:new Map([['custom-a','private-test-key']]),getState(){return structuredClone(this.settings);},save(s){this.settings=s;}};
 return {c,backend,calls,models:createTaskModels({context:()=>c,backend})};
}
test('independent task selections persist and do not alter the main model',async()=>{
 const h=modelFixture();h.models.save('characters','profile:profile-a');h.models.save('shop','tavern');
 assert.equal(h.models.state('characters').selected,'profile:profile-a');assert.equal(h.models.state('shop').selected,'tavern');
 assert.doesNotMatch(JSON.stringify(h.models.state('characters')),/private-test-key|https:/);
 await h.models.generate(h.c,{systemPrompt:'format',prompt:'evidence',responseLength:3000},'profile:profile-a');
 assert.equal(h.calls[0][1],'profile-a');assert.equal(h.calls[0][2][0].content,'format');assert.equal(h.calls[0][3],3000);
 await h.models.generate(h.c,{prompt:'shop'},'tavern');assert.equal(h.calls[1][0],'raw');
 await h.models.generate(h.c,{prompt:'scan'},'tavern',{route:'host'});assert.equal(h.calls[2][0],'quiet');
 assert.equal(h.c.extensionSettings.connectionManager.profiles[0].model,'model-a');
 h.backend.settings.text.presets=[];await assert.rejects(h.models.generate(h.c,{prompt:'scan'},'custom:custom-a'),/刪除/);
});
test('custom model includes scan system rules and keeps keys out of persisted settings',async()=>{
 const h=modelFixture(),prior=globalThis.fetch;let sent;
 globalThis.fetch=async(url,options)=>{sent={url,options};return new Response(JSON.stringify({choices:[{message:{content:'custom-result'}}]}));};
 try{
  h.models.save('characters','custom:custom-a');assert.equal(await h.models.generate(h.c,{systemPrompt:'JSON only',prompt:'source'},'custom:custom-a'),'custom-result');
  const body=JSON.parse(sent.options.body);assert.equal(body.model,'model-b');assert.equal(body.messages[0].content,'JSON only');assert.equal(body.messages[1].content,'source');
  assert.equal(sent.options.headers.Authorization,'Bearer private-test-key');assert.doesNotMatch(JSON.stringify(h.backend.settings),/private-test-key/);assert.equal(h.calls.length,0);
 }finally{globalThis.fetch=prior;}
});
test('selected profile is used for real scanner and only reviewed results can commit',async()=>{
 const h=modelFixture(),line='雲璃是醫者。';Object.assign(h.c,{chatId:'a',chat:[{mes:line,is_user:false}],chatMetadata:{},saveMetadata:async()=>{},saveChat:async()=>{},saveSettingsDebounced:async()=>{}});
 let requests=0;h.c.ConnectionManagerRequestService.sendRequest=async(id,messages)=>{requests++;assert.equal(id,'profile-a');assert.ok(messages.some(m=>m.content.includes(line)));return {content:JSON.stringify({characters:[{name:'雲璃',set:{identity:'醫者'},evidence:{name:{source:'m0.0',quote:line},identity:{source:'m0.0',quote:line}}}]})};};
 h.models.save('characters','profile:profile-a');const host=new StateController({context:()=>h.c,...h.models.scanAdapter});
 const proposal=await host.scan({mode:'ai'});assert.equal(requests,1);assert.equal(proposal.rows[0].name,'雲璃');assert.equal(Object.keys(host.getSnapshot().state.characters).length,0);assert.equal(h.calls.length,0);
});
test('changing world during a delayed shop response cannot apply the old currency',async()=>{
 let release,edited=false;const service=createShopService({backend:{generateText:()=>new Promise(r=>{release=r;})},check:()=>{},taskPrompt:(c,p)=>p,edit:async()=>{edited=true;}});
 const pending=service.generate({name1:'我'},{query:'杯子'});setWorldMode('modern');release('{"items":[{"name":"杯子","description":"喝水","price":10}]}');
 await assert.rejects(pending,/世界模式/);assert.equal(edited,false);
});

test('ancient natural commands and modern acquisitions keep explicit prices and legacy replay values',async()=>{
 const {parseUserPhoneCommands}=await import('../pocket/events.js');const {parseNarrativeAcquisitions}=await import('../pocket/narrative-memory.js');
 const user={userName:'我',characterName:'雲璃',isUser:true,messageKey:'v16'};
 setWorldMode('ancient');const ancient=parseUserPhoneCommands('飛鴿傳書轉帳給雲璃：2 兩銀子「茶錢」',user);assert.equal(ancient.events[0]?.amount,2000);
 const old='千里傳音轉帳給雲璃：2 中品靈石「茶錢」';assert.equal(parseUserPhoneCommands(old,user).events[0]?.amount,200);
 const a=parseNarrativeAcquisitions('我進入萬寶商行，以 2 兩銀子購買了「摺扇」。',user);assert.equal(a.events[0]?.price,2000);
 const oldPurchase='我進入萬寶閣，以 2 中品靈石購買了「摺扇」。';
 const before=parseNarrativeAcquisitions(oldPurchase,user);
 setWorldMode('modern');assert.deepEqual(parseNarrativeAcquisitions(oldPurchase,user),before);assert.equal(parseUserPhoneCommands(old,user).events[0]?.amount,200);
 const m=parseNarrativeAcquisitions('我進入購物商城，以 200 元購買了「耳機」。',user);assert.equal(m.events[0]?.price,200);
});
