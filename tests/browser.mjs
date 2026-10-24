/** Browser integration: original host entry + original iframe + real IndexedDB.
 * Only SillyTavern APIs/model responses are mocked. No network/model credentials.
 * TP_CHROMIUM_PATH=/path/to/chromium node tests/browser.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {PHONE_VERSION} from '../pocket/events.js';
const require=createRequire(import.meta.url);
let playwright;try{playwright=require('playwright');}catch{playwright=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'','playwright'));}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), prefix='/scripts/extensions/third-party/tavern-pocket';
const version=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8')).version;
const out=path.join(root,'tests/artifacts');await fs.mkdir(out,{recursive:true});
// Optional local QA captures; regression runs produce only their JSON report.
const capture=async(target,name)=>{if(process.env.TP_BROWSER_SCREENSHOTS==='1')await target.screenshot({path:path.join(out,name),animations:'disabled'});};
const mime={'.html':'text/html;charset=utf-8','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{
 let p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(p==='/scripts/personas.js'){res.setHeader('Content-Type','application/javascript');res.end('export const user_avatar="";');return;}
 if(p==='/scripts/world-info.js'){res.setHeader('Content-Type','application/javascript');res.end('export const selected_world_info=["咖啡館世界"];export const world_info={charLore:[]};export async function checkWorldInfo(){return {allActivatedEntries:[{world:"咖啡館世界",uid:0,content:"ACTIVE_LORE：咖啡館的午後。"}]};}');return;}
 if(p==='/version'){res.setHeader('Content-Type','application/json');res.end('{"pkgVersion":"1.19.0"}');return;}
 if(p==='/user/images/test.png'){res.setHeader('Content-Type','image/png');res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64'));return;}
 if(p==='/tests/avatar.svg'){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="40" fill="#a9cfbf"/><text x="40" y="54" font-size="40" text-anchor="middle" fill="#285f51">夏</text></svg>');return;}
 if(p.startsWith(prefix+'/'))p=p.slice(prefix.length);
 const file=path.resolve(root,'.'+p);if(!file.startsWith(root+path.sep))throw Error('path');const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(bytes);
}catch{res.writeHead(404);res.end('not found');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;const checks=[],errors=[],naiCalls=[];let page;
const progress=setInterval(()=>console.log('BROWSER_PROGRESS',checks.length,checks.at(-1)||'initializing'),30000);
try{
 browser=await playwright.chromium.launch({headless:true,executablePath:process.env.TP_CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process']});
 page=await browser.newPage({viewport:{width:1440,height:980},deviceScaleFactor:1,hasTouch:true});page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://image.novelai.net/**',async route=>{
  const request=route.request(),headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'};
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(request.url().endsWith('/user/subscription'))return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({tier:3,active:true,usage:{percent:100,isNegative:false},trainingStepsLeft:10000})});
  if(request.url().endsWith('/ai/generate-image')){naiCalls.push(JSON.parse(request.postData()||'{}'));return route.fulfill({status:200,headers,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64')});}
  return route.fulfill({status:404,headers,body:'unexpected mocked NovelAI endpoint'});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/tests/mock-host.html`);
 await page.locator('#sttts-floating .orb').waitFor();
 await page.locator('#sttts-floating .orb').click();
 await page.locator('#sttts-panel[open]').waitFor();
 let frame=await page.locator('#sttts-panel iframe').contentFrame();
 await frame.locator('[data-app="instagram"]').first().waitFor();
 const f=()=>page.frames().find(f=>f.url().endsWith('/ui/index.html'));
 const api=async(fn,arg)=>f().evaluate(fn,arg);
 const waitAsync=async fn=>{const deadline=Date.now()+12000;do{const result=await api(fn);if(result)return result;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()<deadline);throw Error('Asynchronous browser state did not settle within 12 seconds');};
 await api(()=>{window.qaApi=parent.__stIphoniePanelBridge.connect(window);});
 checks.push('actual index initializes and a single floating-ball click opens the actual iframe');
 assert.equal(await frame.locator('.app-icon').count(),18);
 checks.push('all twelve upstream apps, four existing additions, Me and character information remain on the desktop');
 await capture(page,'desktop-home.png');

 // Closing the panel leaves the ball docked; its next single tap must reopen it.
 await api(()=>window.qaApi.close());await page.locator('#sttts-floating .orb').click();await page.locator('#sttts-panel[open]').waitFor();
 checks.push('docked floating ball reopens phone with one click');
 const go=async id=>{await frame.locator('.home-indicator').tap();await f().waitForFunction(()=>!document.querySelector('.screen')?.hasAttribute('data-home-in'));const target=frame.locator(`.app-icon[data-app="${id}"]`);await target.evaluate(el=>el.closest('.home-page')?.scrollIntoView({behavior:'instant',block:'nearest',inline:'start'}));await target.tap();await frame.locator(`.view[data-app="${id}"]`).waitFor({state:'visible'});await f().waitForFunction(()=>!document.querySelector('.screen')?.hasAttribute('data-opening'));};
 const chatResult=await api(async()=>{
  const a=window.qaApi,dm=await a.createThread({type:'dm',members:['林知夏']}),group=await a.createThread({type:'group',name:'午後小隊',members:['林知夏','陸澤']});
  let t=await a.appendChat(dm.id,[{from:'林知夏',kind:'text',text:'咖啡好了，你到了嗎？'},{from:'me',kind:'text',text:'我到門口了。',quote:{from:'林知夏',text:'咖啡好了，你到了嗎？'}},{from:'林知夏',kind:'location',text:'老地方咖啡館',detail:'靠窗座位'},{from:'me',kind:'dice',text:'6'},{from:'me',kind:'pat',target:'林知夏',text:''}]);
  const toRecall=t.messages.find(m=>m.from==='me'&&m.kind==='text');await a.updateChatMessage(dm.id,toRecall.id,{recall:true});
  const photo=await a.addPhoto({name:'咖啡館',blob:new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],{type:'image/png'})});
  await a.appendChat(dm.id,[{from:'me',kind:'photo',photoId:photo.id,text:'午後咖啡'}]);
  await a.appendChat(group.id,[{from:'林知夏',kind:'text',text:'下午去哪裡？'},{from:'陸澤',kind:'text',text:'先去咖啡館集合吧。'}]);
  window.qaDm=dm.id;window.qaGroup=group.id;t=await a.getThread(dm.id);return {dm:t,group:await a.getThread(group.id)};
 });
 assert(chatResult.dm.messages.some(m=>m.kind==='recall'));assert(chatResult.dm.messages.some(m=>m.kind==='photo'));assert.equal(chatResult.group.members.length,2);
 checks.push('real IndexedDB stores private/group chat, quote/retraction, location, dice, pat and photo');
 await go('chat');await frame.locator('.conv[data-action="open"]').first().waitFor();
 // UI-specific thread navigation is verified after reading the actual rendered conversation list.
 const chatText=await frame.locator('.view[data-app="chat"]').textContent();assert(chatText.includes('林知夏')||chatText.includes('午後小隊'));
 checks.push('WeChat renders conversations created through the actual bridge');
 const dmId=await api(()=>window.qaDm);await frame.locator(`.conv[data-id="${dmId}"]`).click();
 await frame.locator('.composer [data-field="draft"]').fill('這是介面送出的訊息');
 await frame.locator('[data-action="send"]').click();
 assert(await api(async()=>(await window.qaApi.getThread(window.qaDm)).messages.some(m=>m.text==='這是介面送出的訊息')));
 await capture(page,'wechat.png');
 checks.push('WeChat composer sends a real persisted message via the UI');
 const walletResult=await api(async()=>{
  const a=window.qaApi;
  const setter=a.walletSetBalance||a.pocketSetBalance;
  if(!setter)throw Error('Wallet balance editor API missing');
  await setter(1000,'QA 自訂餘額');
  let t=await a.appendChat(window.qaDm,[{from:'林知夏',kind:'redpacket',amount:'88.50',text:'喝杯咖啡',state:'sent'}]);const red=t.messages.at(-1);
  const race=await Promise.allSettled([a.takeSent(window.qaDm,red.id,true),a.takeSent(window.qaDm,red.id,true)]);
  const received=a.wallet();await a.sendPaid(window.qaDm,{kind:'transfer',amount:'12.34',text:'咖啡錢'});
  return {race:race.map(r=>r.status),received:received.balance,sent:a.wallet().balance,ledger:a.wallet().ledger};
 });
 assert.equal(walletResult.received,1088.5);assert.equal(walletResult.sent,1076.16);assert(walletResult.ledger.some(e=>e.kind==='adjust'));
 checks.push('editable wallet preserves ledger; concurrent redpacket accepts credit once; transfer deducts once');
 await api(()=>{parent.qa.nextResponse='林知夏：收到，我在窗邊等你。';return window.qaApi.chatReply(window.qaDm);});
 assert(await api(async()=>(await window.qaApi.getThread(window.qaDm)).messages.some(m=>m.text==='收到，我在窗邊等你。')));
 checks.push('WeChat independent reply reaches mock host model and returns to real chat storage');
 const pocketResult=await api(async()=>{
  const a=window.qaApi;
  await a.pocketAction('settings.save',{profileId:'phone',worldbooks:['咖啡館世界'],inject:true});
  await a.pocketAction('diary.save',{title:'只留給自己',text:'PRIVATE_DIARY_SENTINEL_9211',private:true});
  await a.pocketAction('ig.post',{text:'咖啡館的午後，一切剛剛好。'});
  let s=await a.pocketState();const p=s.instagram.posts[0];
  await a.pocketAction('ig.like',{id:p.id});await a.pocketAction('ig.comment',{id:p.id,text:'把這一刻留下。'});
  await a.pocketAction('ig.dm',{to:'林知夏',text:'晚上一起散步？'});
  parent.qa.nextResponse='<phone>'+JSON.stringify({id:'mock-ig-reply',app:'instagram',action:'dm',from:'林知夏',to:'你',text:'好，我在門口等你。'})+'</phone>';
  await a.pocketAction('ig.reply',{to:'林知夏'});
  parent.qa.nextResponse='<phone>'+JSON.stringify({id:'mock-diary',app:'diary',action:'entry',from:'林知夏',title:'午後的約定',text:'他坐在窗邊的時候，我覺得今天可以過得慢一些。'})+'</phone>';
  await a.pocketAction('diary.generate',{from:'林知夏'});
  // Newly generated catalogue prices are integer lower-grade spirit stones.
  parent.qa.nextResponse=JSON.stringify({items:[{title:'窗邊拿鐵',text:'老地方咖啡館的熱拿鐵。',amount:35},{title:'手作杯墊',text:'小店手工製作的棉麻杯墊。',amount:28},{title:'午後書籤',text:'壓花書籤。',amount:18}]});
  await a.pocketAction('shop.generate',{});
  s=await a.pocketState();const before=a.wallet().balance,item=s.catalogue[0];
  await Promise.all([a.pocketPurchase(item,'browser-order-one'),a.pocketPurchase(item,'browser-order-one')]);
  return {state:await a.pocketState(),before,after:a.wallet().balance,wallet:a.wallet(),requests:parent.qa.requests};
 });
 assert.equal(pocketResult.state.settings.profileId,'phone');assert.deepEqual(pocketResult.state.settings.worldbooks,['咖啡館世界']);
 assert.equal(pocketResult.state.instagram.posts[0].likes.length,1);assert.equal(pocketResult.state.instagram.posts[0].comments.length,1);assert.equal(pocketResult.state.instagram.dms.length,2);
 assert.equal(pocketResult.state.diaries.length,2);assert.equal(pocketResult.state.catalogue.length,3);
 assert.equal(pocketResult.after,Math.round((pocketResult.before-pocketResult.state.catalogue[0].price)*100)/100);assert.equal(pocketResult.wallet.inventory.filter(x=>x.orderId==='browser-order-one').length,1);
 assert(pocketResult.requests.some(r=>r.profileId==='phone'&&r.prompt.includes('COFFEE_LORE')));
 assert(!JSON.stringify(pocketResult.requests).includes('PRIVATE_DIARY_SENTINEL_9211'));assert(!JSON.stringify(pocketResult.requests).includes('DISABLED_BOOK_SENTINEL'));
 checks.push('selected connection profile and enabled worldbook reach generation; private diary and disabled entry stay excluded');
 checks.push('Instagram post/like/comment/DM/model reply and private/character diaries persist');
 checks.push('plot catalogue generation and duplicate purchase request charge once and create one inventory item');
 await page.evaluate(async()=>{await window.qa.incoming([
  {id:'source-wx',app:'wechat',action:'message',from:'林知夏',to:'你',text:'從正文同步到微信。'},
  {id:'source-ig',app:'instagram',action:'post',from:'林知夏',text:'今天的照片，想留在這裡。'},
  {id:'source-diary',app:'diary',action:'entry',from:'林知夏',title:'正文同步日記',text:'劇情裡寫下的一頁。'}
 ]);});
 const sourceResult=await api(async()=>{await window.qaApi.pocketAction('sync',{});await window.qaApi.pocketAction('sync',{});const ts=await window.qaApi.listThreads();const messages=(await Promise.all(ts.map(t=>window.qaApi.getThread(t.id)))).flatMap(t=>t.messages);return {messages,state:await window.qaApi.pocketState()};});
 assert.equal(sourceResult.messages.filter(m=>m.text==='從正文同步到微信。').length,1);assert.equal(sourceResult.state.instagram.posts.filter(p=>p.text==='今天的照片，想留在這裡。').length,1);assert(sourceResult.state.diaries.some(d=>d.title==='正文同步日記'));
 checks.push('narrative phone blocks auto-sync WeChat, Instagram and character diary without duplicate replay');
 await page.evaluate(async()=>{const m=window.qa.context.chat.at(-1);m.mes=m.mes.replace('從正文同步到微信。','正文編輯後的新訊息。');await window.qa.emit('MESSAGE_EDITED',window.qa.context.chat.length-1);});
 const edited=await api(async()=>{await window.qaApi.pocketAction('sync',{});const ts=await window.qaApi.listThreads();return(await Promise.all(ts.map(t=>window.qaApi.getThread(t.id)))).flatMap(t=>t.messages);});
 assert(!edited.some(m=>m.text==='從正文同步到微信。'));assert.equal(edited.filter(m=>m.text==='正文編輯後的新訊息。').length,1);
 await api(async()=>{const a=window.qaApi;for(const t of await a.listThreads()){const full=await a.getThread(t.id),m=full.messages.find(m=>m.source?.id==='source-wx');if(m)await a.deleteChatMessages(t.id,[m.id]);}await a.pocketAction('sync',{});});
 assert.equal(await api(async()=>{const a=window.qaApi,ts=await a.listThreads();return(await Promise.all(ts.map(t=>a.getThread(t.id)))).flatMap(t=>t.messages).filter(m=>m.source?.id==='source-wx').length;}),0);
 checks.push('main-story edit reconciles message content; native deletion remains hidden after replay');
 await page.evaluate(()=>window.qa.incoming({id:'source-red',app:'wechat',action:'redpacket',from:'林知夏',to:'你',amount:57.15,text:'來源交易保留測試'}));
 const payment=await api(async()=>{const a=window.qaApi;await a.pocketAction('sync',{});for(const t of await a.listThreads()){const m=(await a.getThread(t.id)).messages.find(m=>m.source?.id==='source-red');if(m){const before=a.wallet().balance;await a.takeSent(t.id,m.id,true);window.qaPayment={threadId:t.id,id:m.id,sourceIndex:parent.qa.lastIncoming};return {before,after:a.wallet().balance};}}throw Error('source payment missing');});
 assert.equal(payment.after,Math.round((payment.before+57.15)*100)/100);
 await api(async()=>{parent.qa.context.chat.splice(window.qaPayment.sourceIndex,1);await parent.qa.emit('MESSAGE_DELETED');});
 const retained=await api(async()=>{const a=window.qaApi;await a.pocketAction('sync',{});const x=window.qaPayment,m=(await a.getThread(x.threadId)).messages.find(m=>m.id===x.id);await a.takeSent(x.threadId,x.id,true);const exported=await a.exportBackup(['chats']);const backup=JSON.parse(await exported.blob.text());return {m,balance:a.wallet().balance,backup};});
 assert.equal(retained.m.state,'opened');assert(retained.m.source.stale);assert.equal(retained.balance,payment.after);assert(JSON.stringify(retained.backup).includes(retained.m.paymentId));assert(JSON.stringify(retained.backup).includes('source-red'));
 checks.push('settled narrative redpacket survives source deletion as stale without re-credit; backup retains payment/source identity');
 await api(()=>window.qaApi.pocketAction('presets.install',{}));
 const presets=await page.evaluate(version=>({regex:window.qa.context.extensionSettings.regex,book:window.qa.books['傳音玉符協定 v'+version]}),PHONE_VERSION);
 assert(presets.regex?.length);assert(presets.book?.entries);checks.push('bundled protocol v'+PHONE_VERSION+' regex and worldbook install through host APIs');
 for(const id of ['instagram','diary','storyshop','pocketsettings']){await go(id);assert(await frame.locator(`.view[data-app="${id}"]`).isVisible());}
 checks.push('all four added apps open via desktop navigation');
 await frame.locator('[data-field="profileId"]').selectOption('main');await frame.locator('[data-worldbook="賽車世界"]').check();await frame.locator('[data-action="settings-save"]').click();
 await waitAsync(async()=>{const s=await window.qaApi.pocketState();return s.settings.profileId==='main'&&s.settings.worldbooks.includes('賽車世界');});
 checks.push('model and worldbook selectors save through actual settings UI');
 await go('instagram');await frame.locator('[data-field="post-text"]').fill('UI 測試：把午後的光留在這裡。');await frame.locator('[data-action="ig-post"]').click();
 await waitAsync(async()=>(await window.qaApi.pocketState()).instagram.posts.some(p=>p.text==='UI 測試：把午後的光留在這裡。'));
 const uiPost=await api(async()=>(await window.qaApi.pocketState()).instagram.posts.find(p=>p.text==='UI 測試：把午後的光留在這裡。').id);
 await frame.locator(`[data-action="ig-like"][data-id="${uiPost}"]`).click();
 await frame.locator(`[data-comment="${uiPost}"]`).fill('介面留言已連接。');await frame.locator(`[data-action="ig-comment"][data-id="${uiPost}"]`).click();
 await waitAsync(async()=>{const p=(await window.qaApi.pocketState()).instagram.posts.find(p=>p.text==='UI 測試：把午後的光留在這裡。');return p?.likes.length===1&&p?.comments.length===1;});
 const photoData=await api(()=>{const c=document.createElement('canvas');c.width=360;c.height=240;const x=c.getContext('2d'),g=x.createLinearGradient(0,0,360,240);g.addColorStop(0,'#f0d6b8');g.addColorStop(1,'#a7cabb');x.fillStyle=g;x.fillRect(0,0,360,240);x.fillStyle='#e4c7a1';x.fillRect(0,160,360,80);x.fillStyle='#faf5e8';x.beginPath();x.ellipse(180,183,66,18,0,0,Math.PI*2);x.fill();x.fillStyle='#fffdf7';x.fillRect(140,94,80,80);x.beginPath();x.ellipse(180,94,40,12,0,0,Math.PI*2);x.fill();x.fillStyle='#ad7856';x.beginPath();x.ellipse(180,94,33,9,0,0,Math.PI*2);x.fill();x.strokeStyle='#fffdf7';x.lineWidth=10;x.beginPath();x.arc(224,132,22,-Math.PI/2,Math.PI/2);x.stroke();x.fillStyle='#405e52';x.font='18px sans-serif';x.fillText('CAFÉ · AFTERNOON',22,32);return c.toDataURL('image/png').split(',')[1];});
 await frame.locator('[data-ig-photo="post"]').setInputFiles({name:'cafe-fixture.png',mimeType:'image/png',buffer:Buffer.from(photoData,'base64')});await frame.locator('[data-action="ig-remove-photo"][data-target="post"]').waitFor();await frame.locator('[data-action="ig-post"]').click();
 await waitAsync(async()=>(await window.qaApi.pocketState()).instagram.posts.some(p=>p.photoId&&!p.text));
 await frame.locator('img[data-pocket-photo]').first().waitFor({state:'visible'});await f().waitForFunction(()=>[...document.querySelectorAll('img[data-pocket-photo]')].some(i=>i.complete&&i.naturalWidth>0));
 checks.push('Instagram image-only upload reaches photo storage and renders a decoded image');
 await capture(page,'instagram.png');checks.push('Instagram UI compose, like and comment persist');
 await go('diary');await frame.locator('[data-action="diary-new"]').click();await frame.locator('[data-field="diary-title"]').fill('介面日記');await frame.locator('[data-field="diary-text"]').fill('只屬於我的一頁。');await frame.locator('[data-action="diary-save"]').click();
 await waitAsync(async()=>(await window.qaApi.pocketState()).diaries.some(d=>d.title==='介面日記'&&d.private));checks.push('private diary UI editor saves title and content');
 await go('storyshop');const beforeUiBuy=await api(()=>window.qaApi.wallet().balance);await frame.locator('[data-action="shop-buy"]').nth(1).click();await frame.locator('[data-action="confirm"]').click();
 await waitAsync(async()=>window.qaApi.wallet().inventory.length===2);assert.equal(await api(()=>window.qaApi.wallet().balance),Math.round((beforeUiBuy-28)*100)/100);checks.push('shop UI confirmation purchases and deducts wallet');
 await go('chat');await frame.locator('.app-nav [data-system="back"]').click();await frame.locator('[data-action="me"]').click();await frame.locator('[data-action="me-wallet"]').click();await frame.locator('[data-action="wallet-edit"]').click();await frame.locator('[data-field="balance"]').fill('22 中品 22 下品');await frame.locator('[data-action="wallet-save"]').click();await f().waitForFunction(()=>window.qaApi.wallet().balance===2222);
 checks.push('WeChat wallet edit form sets balance with ledger');
 await frame.locator('.wallet-card').waitFor({state:'visible'});await capture(page,'wallet.png');await frame.locator('[data-sheet-close]').click();

 // v0.4: structured messages discover NPCs, CSB21 follows visible narrative, and real photos decode.
 const statusRole=(name,{hydration='61',body='細長的手指',blank='',satiety='74'}={})=>`[CSB21_ROLE]\nname: ${name}\nage: 24\nmood: 放鬆\nidentity: 咖啡館店員\nrelation: 朋友\nlocation: 老地方咖啡館\naffection: 63\ntrust: 67\nenergy: 81\nfatigue: 19\nstress: 12\nsatiety: ${satiety}\nhydration: ${hydration}\nlewdness: 未知\ncondition: 良好\noutfit: 白襯衫與淺色長褲\naction: 在窗邊傳微信\nthought: 今天的光線很好\nitems: 手機\nnote: 喝過水\nbody:\n[CSB21_PART|手部|${body}]\n[CSB21_PART|自訂部位 01|${blank}]\n[/CSB21_ROLE]`;
 const panel=roles=>`[CSB21_PANEL]\ntime: 午後 15:40\n${roles.join('\n')}\n[/CSB21_PANEL]`;
 assert(!await api(()=>window.qaApi.chatContacts().some(c=>c.name==='沈禾')));
 await page.evaluate(()=>window.qa.incoming([
  {id:'v04-new-npc',app:'wechat',action:'message',from:'沈禾',to:'你',text:'我是沈禾，窗邊的位置替你留好了。'},
  {id:'v04-npc-photo',app:'wechat',action:'photo',from:'沈禾',to:'你',text:'午後咖啡館窗邊的照片',image:'/user/images/test.png'},
  {id:'v04-npc-description',app:'wechat',action:'photo',from:'沈禾',to:'你',text:'一杯放在木桌上的拿鐵，窗外有午後陽光。'}
 ]));
 await f().waitForFunction(()=>window.qaApi.chatContacts().some(c=>c.name==='沈禾'));
 const npc=await api(async()=>{const a=window.qaApi,threads=await a.listThreads(),row=threads.find(t=>t.type==='dm'&&t.members.includes('沈禾'));if(!row)return null;return a.getThread(row.id);});
 assert(npc?.messages.some(m=>m.text==='我是沈禾，窗邊的位置替你留好了。'));assert.equal(npc.messages.filter(m=>m.source?.id==='v04-npc-photo').length,1);
 checks.push('an unseen NPC structured narrative sender automatically becomes a native contact with a WeChat DM');
 const baseline=panel([statusRole('林知夏',{hydration:'82',body:'左手腕戴銀色手環',satiety:'69'}),statusRole('沈禾')]);
 await page.evaluate(text=>window.qa.incomingRaw(text),baseline);
 await waitAsync(async()=>{const p=await window.qaApi.pocketContactProfile('沈禾');return p?.fields.hydration==='61';});
 let npcProfile=await api(()=>window.qaApi.pocketContactProfile('沈禾'));
 let xiaProfile=await api(()=>window.qaApi.pocketContactProfile('林知夏'));
 assert.equal(npcProfile.body.find(x=>x.name==='自訂部位 01').value,'');assert.equal(npcProfile.body.find(x=>x.name==='手部').value,'細長的手指');
 assert.equal(xiaProfile.body.find(x=>x.name==='手部').value,'左手腕戴銀色手環');assert.equal(xiaProfile.card.height,'168 cm');assert.equal(xiaProfile.card.build,'修長');assert.equal(npcProfile.card.height,undefined);
 checks.push('CSB21 status and labelled card physique merge per name while blank body fields and unrelated NPC information remain separate');
 const nextPanel=panel([statusRole('沈禾',{hydration:'88',body:'手中拿著相機'})]);
 await page.evaluate(text=>window.qa.incomingRaw(text),nextPanel);
 await waitAsync(async()=>(await window.qaApi.pocketContactProfile('沈禾'))?.fields.hydration==='88');
 await page.evaluate(async()=>{window.qa.context.chat.at(-1).mes=window.qa.context.chat.at(-1).mes.replace('hydration: 88','hydration: 91');await window.qa.emit('MESSAGE_EDITED',window.qa.context.chat.length-1);});
 assert.equal((await api(()=>window.qaApi.pocketContactProfile('沈禾'))).fields.hydration,'91');
 await page.evaluate(async()=>{const m=window.qa.context.chat.at(-1);m.mes=m.mes.replace('hydration: 91','hydration: 55');m.swipe_id=1;await window.qa.emit('MESSAGE_SWIPED',window.qa.context.chat.length-1);});
 assert.equal((await api(()=>window.qaApi.pocketContactProfile('沈禾'))).fields.hydration,'55');
 await page.evaluate(async()=>{window.qa.context.chat.pop();await window.qa.emit('MESSAGE_DELETED');});
 npcProfile=await api(()=>window.qaApi.pocketContactProfile('沈禾'));assert.equal(npcProfile.fields.hydration,'61');assert.equal(npcProfile.body.find(x=>x.name==='手部').value,'細長的手指');
 checks.push('status values recompute after main-message edit, swipe and deletion and restore the earlier visible snapshot');
 // Return from WeChat Me into native Contacts; open the auto-registered NPC card.
 await frame.locator('.app-nav [data-system="back"]').click();await frame.locator('[data-action="tab"][data-tab="contacts"]').click();
 await frame.locator('[data-action="profile"][data-name="沈禾"]').click();await frame.locator('.tp-contact-data').waitFor();
 assert.equal(await frame.locator('meter[aria-label="飲水度"]').getAttribute('value'),'61');
 assert((await frame.locator('.tp-contact-body').textContent()).includes('空白'));assert((await frame.locator('.tp-contact-body').textContent()).includes('細長的手指'));
 await frame.locator('[data-action="profile-chat"]').click();await frame.locator('img[data-chat-remote]').waitFor();
 await f().waitForFunction(()=>[...document.querySelectorAll('img[data-chat-remote]')].some(i=>i.complete&&i.naturalWidth>0));
 assert(await frame.locator('[data-action="photo-setup"]').isVisible());
 const photoBefore=await api(async()=>{const t=await window.qaApi.getThread(window.qaApi.chatContacts().find(c=>c.name==='沈禾')&&((await window.qaApi.listThreads()).find(t=>t.members.includes('沈禾')).id));return t.messages.find(m=>m.source?.id==='v04-npc-photo');});
 await api(()=>window.qaApi.pocketAction('sync',{}));await api(()=>window.qaApi.pocketAction('sync',{}));
 const photoAfter=await api(async()=>{const t=await window.qaApi.getThread((await window.qaApi.listThreads()).find(t=>t.members.includes('沈禾')).id);return t.messages.filter(m=>m.source?.id==='v04-npc-photo');});
 assert.equal(photoAfter.length,1);assert.equal(photoAfter[0].id,photoBefore.id);assert.equal(photoAfter[0].image,'/user/images/test.png');
 await frame.locator('.chat-photo[data-action="photo"]').click();await frame.locator('.sttts-viewer img').waitFor();await frame.locator('.sttts-viewer [data-v="close"]').click();
 checks.push('NPC photo URL renders an actual decoded image; source replay retains one image and description-only photo offers generation setup');
 // Intercept the real native NovelAI transport with a deterministic PNG; no request leaves Chromium.
 assert.equal(naiCalls.length,0);
 await api(async()=>{const a=window.qaApi,s=await a.pocketState();a.setKey('nai','QA_FAKE_KEY_NOT_A_SECRET');a.saveDraw({engine:'gpt'});await a.pocketAction('settings.save',{profileId:s.settings.profileId,worldbooks:s.settings.worldbooks,inject:s.settings.inject,autoWeChatPhotos:true});});
 await page.evaluate(()=>window.qa.incoming({id:'v04-auto-photo',app:'wechat',action:'photo',from:'林知夏',to:'你',text:'林知夏坐在咖啡館窗邊，白襯衫映著午後陽光。'}));
 await waitAsync(async()=>{const a=window.qaApi;for(const row of await a.listThreads()){const t=await a.getThread(row.id),m=t.messages.find(m=>m.source?.id==='v04-auto-photo');if(m?.photoId)return true;}return false;});
 assert.equal(naiCalls.length,1);assert(naiCalls[0].input.includes('168 cm'));assert(naiCalls[0].input.includes('林知夏坐在咖啡館窗邊'));assert.equal(await api(()=>window.qaApi.getState().draw.engine),'gpt');
 await api(()=>window.qaApi.pocketAction('sync',{}));await api(()=>window.qaApi.pocketAction('sync',{}));
 assert.equal(naiCalls.length,1);
 const oldPhoto=await api(async()=>{const a=window.qaApi;for(const row of await a.listThreads()){const m=(await a.getThread(row.id)).messages.find(m=>m.source?.id==='v04-npc-description');if(m)return m;}return null;});assert(!oldPhoto?.photoId);
 const autoBlob=await api(async()=>{const a=window.qaApi,ts=await a.listThreads();let photoId='';for(const row of ts){const m=(await a.getThread(row.id)).messages.find(m=>m.source?.id==='v04-auto-photo');if(m?.photoId)photoId=m.photoId;}const p=await a.getPhoto(photoId);const url=URL.createObjectURL(p.blob);try{const i=new Image();i.src=url;await i.decode();return {width:i.naturalWidth,type:p.blob.type};}finally{URL.revokeObjectURL(url);}});assert(autoBlob.width>0);assert.equal(autoBlob.type,'image/png');
 checks.push('new narrative photo automatically uses NovelAI without a click, includes known physique, preserves selected global engine and avoids historical backlog/replay regeneration');
 await api(()=>{parent.qa.nextResponse='林知夏：[图片] 手中的拿鐵與窗邊的午後光影。';return window.qaApi.chatReply(window.qaDm);});
 await waitAsync(async()=>{const t=await window.qaApi.getThread(window.qaDm);return t.messages.some(m=>m.kind==='photo'&&m.from==='林知夏'&&m.text==='手中的拿鐵與窗邊的午後光影。'&&m.photoId);});
 if(naiCalls.length!==2)console.log('AUTO_NATIVE_DEBUG',JSON.stringify({calls:naiCalls.length,thread:await api(()=>window.qaApi.getThread(window.qaDm)),notices:await page.evaluate(()=>window.qa.notices)}));
 assert.equal(naiCalls.length,2);assert(naiCalls[1].input.includes('手中的拿鐵與窗邊的午後光影'));
 checks.push('native independent WeChat reply photo also automatically renders through the mocked NovelAI transport and persists in the album');
 // Existing contacts still open, with explicit card/body data readable in the actual UI.
 await frame.locator('.tp-thread-person[data-name="沈禾"]').click();await frame.locator('.tp-contact-data').waitFor();
 await frame.locator('.app-nav [data-system="back"]').click();await frame.locator('[data-action="tab"][data-tab="contacts"]').click();
 await frame.locator('[data-action="profile"][data-name="林知夏"]').click();await frame.locator('.tp-contact-data').waitFor();
 assert((await frame.locator('.tp-contact-data').textContent()).includes('168 cm'));assert((await frame.locator('.tp-contact-data').textContent()).includes('修長'));
 await frame.locator('.tp-contact-body summary').click();await frame.locator('.toast').waitFor({state:'hidden'});
 await frame.locator('.view[data-app="chat"]').evaluate(el=>{el.scrollTop=0;});
 await capture(page.locator('#sttts-panel'),'v04-contact-profile.png');

 await frame.locator('.tp-contact-body').scrollIntoViewIfNeeded();await capture(page.locator('#sttts-panel'),'v04-contact-details.png');

 checks.push('native contact profile UI renders physique, current meters, custom body labels and empty reserved fields');
 // v0.5: query-generated essentials have explicit fictional catalogue provenance and real wallet semantics.
 await go('storyshop');
 const requestsBeforeEmptyQuery=await page.evaluate(()=>window.qa.requests.length);
 await frame.locator('[data-field="shop-query"]').fill('');await frame.locator('[data-action="shop-search"]').click();
 // Completion includes the action's final render; the next edit must not be
 // replaced by a still-pending render from the rejected empty query.
 await f().waitForFunction(()=>{const view=document.querySelector('.view[data-app="storyshop"]');return view&&!view.hasAttribute('aria-busy');});
 assert.equal(await page.evaluate(()=>window.qa.requests.length),requestsBeforeEmptyQuery);
 await frame.locator('[data-field="shop-query"]').fill('牙刷、衛生紙、礦泉水');
 await page.evaluate(()=>{window.qa.nextResponse=JSON.stringify({items:[{name:'旅行牙刷',description:'柔軟刷毛，適合每日清潔。',price:12,emoji:'🪥'},{name:'隨身衛生紙',description:'日常外出使用的小包裝衛生紙。',price:8,emoji:'🧻'},{name:'礦泉水',description:'可攜帶的飲用水，供補充水分。',price:5,emoji:'💧'}]});});
 await frame.locator('[data-action="shop-search"]').click();
 await waitAsync(async()=>{const s=await window.qaApi.pocketState();return s.catalogueSource?.mode==='query'&&s.catalogueSource?.query==='牙刷、衛生紙、礦泉水'&&s.catalogue.some(x=>x.name==='旅行牙刷');});
 assert((await frame.locator('.pocket-shop-source').textContent()).includes('牙刷、衛生紙、礦泉水'));
 const queriedShopRequest=await page.evaluate(()=>window.qa.requests.at(-1));
 assert(queriedShopRequest.prompt.includes('不必已在劇情中出現'));assert(queriedShopRequest.prompt.includes('一律使用繁體中文'));assert(queriedShopRequest.prompt.includes('牙刷、衛生紙、礦泉水'));assert(queriedShopRequest.prompt.includes('沒有進行真實網路搜尋'));
 const queryBuyBefore=await api(()=>({balance:window.qaApi.wallet().balance,count:window.qaApi.wallet().inventory.length}));
 await frame.locator('[data-action="shop-buy"]').first().click();await frame.locator('[data-action="confirm"]').click();
 await waitAsync(async()=>window.qaApi.wallet().inventory.some(x=>x.name==='旅行牙刷'));
 assert.equal(await api(()=>window.qaApi.wallet().balance),Math.round((queryBuyBefore.balance-12)*100)/100);
 assert.equal(await api(()=>window.qaApi.wallet().inventory.length),queryBuyBefore.count+1);
 checks.push('query UI generates everyday essentials absent from the narrative with Traditional Chinese instructions, labelled fictional source and virtual wallet purchase; empty query makes no model request');
 await frame.locator('.toast').waitFor({state:'hidden'});await frame.locator('.view[data-app="storyshop"]').evaluate(el=>{el.scrollTop=0;});
 await capture(page.locator('#sttts-panel'),'v05-query-shop.png');

 // v0.5: complete preset creation and JSON export/import use the shipped settings UI.
 await go('pocketsettings');await frame.locator('[data-action="open-image-settings"]').click();await frame.locator('.pocket-image-settings').waitFor();
 assert.equal(await api(()=>document.documentElement.lang),'zh-TW');
 assert((await frame.locator('.pocket-image-settings').textContent()).includes('畫師串'));assert((await frame.locator('.pocket-image-settings').textContent()).includes('千里傳音使用的預設'));
 await frame.locator('[data-action="image-preset-new"]').click();
 await frame.locator('[data-field="preset-name"]').fill('水彩午後');
 await frame.locator('[data-field="preset-model"]').selectOption('nai-diffusion-3');
 await frame.locator('[data-field="preset-artist"]').fill('artist:qa_watercolor');
 await frame.locator('[data-field="preset-positive"]').fill('soft natural lighting');
 await frame.locator('[data-field="preset-negative"]').fill('blurry, watermark, low quality');
 await frame.locator('[data-action="image-preset-save"]').click();
 const createdPreset=await waitAsync(async()=>(await window.qaApi.pocketImageState()).presets.find(p=>p.name==='水彩午後'));
 assert.equal(createdPreset.artist,'artist:qa_watercolor');assert.equal(createdPreset.positive,'soft natural lighting');assert.equal(createdPreset.negative,'blurry, watermark, low quality');assert.equal(createdPreset.model,'nai-diffusion-3');
 await frame.locator(`[data-action="image-preset-pick"][data-id="${createdPreset.id}"]`).click();
 const exportReady=page.waitForEvent('download');await frame.locator('[data-action="image-preset-export"]').click();const exportedPresetDownload=await exportReady;
 const exportedPresetText=await fs.readFile(await exportedPresetDownload.path(),'utf8'),exportedPreset=JSON.parse(exportedPresetText);
 assert.equal(exportedPreset.format,'tavern-pocket-image-presets');assert.equal(exportedPreset.presets.length,1);assert.equal(exportedPreset.presets[0].name,'水彩午後');assert(!exportedPresetText.includes('QA_FAKE_KEY_NOT_A_SECRET'));
 await api(id=>{window.qaCreatedPresetId=id;},createdPreset.id);
 await frame.locator('[data-image-preset-import]').setInputFiles({name:'roundtrip-preset.json',mimeType:'application/json',buffer:Buffer.from(exportedPresetText)});
 const importedPreset=await waitAsync(async()=>{const ps=(await window.qaApi.pocketImageState()).presets.filter(p=>p.name==='水彩午後');return ps.length===2&&ps.find(p=>p.id!==window.qaCreatedPresetId);});
 assert.notEqual(importedPreset.id,createdPreset.id);assert.equal(importedPreset.artist,createdPreset.artist);assert.equal(importedPreset.positive,createdPreset.positive);assert.equal(importedPreset.negative,createdPreset.negative);
 checks.push('Traditional Chinese preset manager creates artist/positive/negative/model values, exports credential-free JSON and imports a lossless fresh-ID copy without converting user-authored text');
 await api(id=>{window.qaSelectedPresetId=id;},importedPreset.id);
 await frame.locator('[data-field="wechat-preset"]').selectOption(importedPreset.id);await frame.locator('[data-field="wechat-model"]').selectOption('nai-diffusion-4-full');await frame.locator('[data-action="wechat-image-save"]').click();
 await waitAsync(async()=>{const s=await window.qaApi.pocketImageState();return s.wechat.presetId===window.qaSelectedPresetId&&s.wechat.model==='nai-diffusion-4-full';});
 await frame.locator(`[data-action="image-preset-pick"][data-id="${importedPreset.id}"]`).click();
 await frame.locator('.sheet-body').evaluate(el=>{el.scrollTop=0;});await capture(page.locator('#sttts-panel'),'v05-image-presets.png');

 await frame.locator('[data-sheet-close]').click();
 checks.push('WeChat preset and model choices save through the actual settings UI independently of the global drawing engine');
 // The selected WeChat preset and per-WeChat model must reach NovelAI, independently of the global drawing engine.
 await page.evaluate(()=>window.qa.incoming({id:'v05-preset-photo',app:'wechat',action:'photo',from:'林知夏',to:'你',text:'晚霞映在杯緣上的照片。',imagePrompt:'sunset cafe, holding a ceramic cup'}));
 const presetPhoto=await waitAsync(async()=>{const a=window.qaApi;for(const row of await a.listThreads()){const m=(await a.getThread(row.id)).messages.find(m=>m.source?.id==='v05-preset-photo');if(m?.photoId)return {threadId:row.id,id:m.id,photoId:m.photoId};}return false;});
 assert.equal(naiCalls.length,3);assert.equal(naiCalls[2].model,'nai-diffusion-4-full');assert(naiCalls[2].input.includes('artist:qa_watercolor'));assert(naiCalls[2].input.includes('soft natural lighting'));assert(naiCalls[2].input.includes('sunset cafe'));assert.equal(naiCalls[2].parameters.negative_prompt,'blurry, watermark, low quality');
 assert.equal(naiCalls[2].parameters.v4_prompt.caption.base_caption,naiCalls[2].input);assert.equal(naiCalls[2].parameters.v4_negative_prompt.caption.base_caption,naiCalls[2].parameters.negative_prompt);
 assert.equal(await api(()=>window.qaApi.getState().draw.engine),'gpt');
 checks.push('selected WeChat preset supplies artist, positive and negative prompts while its explicit model overrides the preset/global drawing model in the real NovelAI request');
 await go('chat');await frame.locator('[data-action="profile-chat"]').click();
 const longPressPhoto=async photoId=>{
  const img=frame.locator(`img[data-chat-photo="${photoId}"]`);await img.hover();await page.mouse.down();await frame.locator('[data-action="edit-photo"]').waitFor({state:'visible'});await page.mouse.up();await frame.locator('[data-action="edit-photo"]').click();await frame.locator('[data-photo-editor]').waitFor({state:'visible'});
 };
 await longPressPhoto(presetPhoto.photoId);
 assert.equal(await frame.locator('[data-field="photo-artist"]').inputValue(),'artist:qa_watercolor');
 assert.equal(await frame.locator('[data-field="photo-negative"]').inputValue(),'blurry, watermark, low quality');
 await frame.locator('[data-field="photo-scene"]').fill('sunset terrace, ceramic cup, gentle breeze');
 await frame.locator('[data-field="photo-positive"]').fill('soft natural lighting, detailed hands, 简体原文');
 await frame.locator('[data-field="photo-negative"]').fill('blurry, watermark, duplicated fingers');
 await frame.locator('[data-action="photo-edit-save"]').click();await frame.locator('[data-photo-editor]').waitFor({state:'hidden'});
 const savedPhotoDraft=await api(async info=>window.qaApi.pocketPhotoDraft(info.threadId,info.id),presetPhoto);
 assert.equal(savedPhotoDraft.scene,'sunset terrace, ceramic cup, gentle breeze');assert.equal(savedPhotoDraft.positive,'soft natural lighting, detailed hands, 简体原文');assert.equal(naiCalls.length,3);
 const originalPhotoAfterSave=await api(async info=>(await window.qaApi.getThread(info.threadId)).messages.find(m=>m.id===info.id).photoId,presetPhoto);assert.equal(originalPhotoAfterSave,presetPhoto.photoId);
 checks.push('holding an actual WeChat image opens the prompt editor; save-only persists this image’s prompts without an API call or image replacement and preserves user-authored simplified text');
 await frame.locator('.toast').waitFor({state:'hidden'});await longPressPhoto(presetPhoto.photoId);
 assert.equal(await frame.locator('[data-field="photo-positive"]').inputValue(),'soft natural lighting, detailed hands, 简体原文');
 await page.evaluate(()=>{window.qa.nextResponse=JSON.stringify({scene:'sunset terrace, ceramic cup, gentle breeze, cinematic warm lighting'});});
 await frame.locator('[data-action="photo-edit-optimize"]').click();
 await f().waitForFunction(()=>document.querySelector('[data-field="photo-scene"]')?.value==='sunset terrace, ceramic cup, gentle breeze, cinematic warm lighting');
 assert.equal(naiCalls.length,3);
 const afterOptimizeDraft=await api(async info=>window.qaApi.pocketPhotoDraft(info.threadId,info.id),presetPhoto);assert.equal(afterOptimizeDraft.scene,'sunset terrace, ceramic cup, gentle breeze');
 const optimizeRequest=await page.evaluate(()=>window.qa.requests.at(-1));assert(optimizeRequest.prompt.includes('168 cm'));assert(optimizeRequest.prompt.includes('COFFEE_LORE'));
 checks.push('explicit prompt optimization fills English scene tags in the image editor using known character context without saving the draft, replacing the image or making an image API call');
 await frame.locator('[data-field="photo-positive"]').fill('soft natural lighting, detailed hands');
 await frame.locator('[data-field="photo-model"]').selectOption('nai-diffusion-4-5-curated');
 await frame.locator('.sheet-body').evaluate(el=>{el.scrollTop=0;});
 await capture(page.locator('#sttts-panel'),'v05-image-editor.png');

 await frame.locator('[data-action="photo-edit-generate"]').click();await frame.locator('[data-photo-editor]').waitFor({state:'hidden'});
 const regeneratedPhoto=await api(async info=>{const a=window.qaApi,m=(await a.getThread(info.threadId)).messages.find(m=>m.id===info.id),old=await a.getPhoto(info.photoId),current=await a.getPhoto(m.photoId);return {id:m.photoId,oldSize:old?.blob?.size,currentSize:current?.blob?.size};},presetPhoto);
 assert.notEqual(regeneratedPhoto.id,presetPhoto.photoId);assert(regeneratedPhoto.oldSize>0&&regeneratedPhoto.currentSize>0);assert.equal(naiCalls.length,4);assert.equal(naiCalls[3].model,'nai-diffusion-4-5-curated');assert(naiCalls[3].input.includes('sunset terrace, ceramic cup, gentle breeze'));assert(naiCalls[3].input.includes('detailed hands'));assert.equal(naiCalls[3].parameters.negative_prompt,'blurry, watermark, duplicated fingers');
 await api(()=>window.qaApi.pocketAction('sync',{}));assert.equal(naiCalls.length,4);
 checks.push('explicit photo regeneration sends edited model and prompts, atomically replaces the message image, retains the original album asset and does not regenerate again during narrative replay');
 // Natural role activity is recognized from authenticated assistant story messages too.
 const roleNaturalId=await page.evaluate(()=>window.qa.incomingRaw('林知夏微信傳給我：「吃飯了嗎？」\n林知夏在Instagram發文：「V06 角色自然貼文：晚餐前的光。」\n林知夏在Instagram發限動：「V06 角色自然限動：等你到了再點餐。」'));
 await api(()=>window.qaApi.pocketAction('sync',{}));
 const naturalRoleState=await api(async()=>{const a=window.qaApi;return {messages:(await Promise.all((await a.listThreads()).map(t=>a.getThread(t.id)))).flatMap(t=>t.messages),s:await a.pocketState()};});
 assert.equal(naturalRoleState.messages.filter(m=>m.from==='林知夏'&&m.text==='吃飯了嗎？').length,1);assert(naturalRoleState.s.instagram.posts.some(p=>p.text.includes('V06 角色自然貼文')));assert(naturalRoleState.s.instagram.stories.some(p=>p.text.includes('V06 角色自然限動')));
 assert.equal(await page.locator(`.mes[mesid="${roleNaturalId}"] .tp-story-card`).count(),3);
 checks.push('natural assistant role WeChat/post/story prose becomes both formatted main-story cards and one synchronized record in each phone app');
 const naturalIncomingBalance=await api(()=>window.qaApi.wallet().balance);
 await page.evaluate(()=>window.qa.incomingRaw('林知夏微信轉帳給我：13.20「晚餐找零」'));await api(()=>window.qaApi.pocketAction('sync',{}));assert.equal(await api(()=>window.qaApi.wallet().balance),naturalIncomingBalance);
 const naturalIncoming=await api(async()=>{const a=window.qaApi;for(const t of await a.listThreads()){const m=(await a.getThread(t.id)).messages.find(m=>m.from==='林知夏'&&m.kind==='transfer'&&m.text==='晚餐找零');if(m)return {threadId:t.id,id:m.id};}return null;});assert(naturalIncoming);
 await api(async info=>{await window.qaApi.takeSent(info.threadId,info.id,true);await window.qaApi.takeSent(info.threadId,info.id,true);await window.qaApi.pocketAction('sync',{});},naturalIncoming);
 assert.equal(await api(()=>window.qaApi.wallet().balance),Math.round((naturalIncomingBalance+13.2)*100)/100);
 checks.push('natural role transfer becomes a receivable phone payment, credits only on acceptance, and repeated acceptance/source replay do not credit twice');
 // v0.6: main-story cards and outward activity remain distinct, persistent and replay-safe.
 const naturalMessageId=await page.evaluate(()=>window.qa.send('微信傳給林知夏：「吃飯沒？」'));
 await api(()=>window.qaApi.pocketAction('sync',{}));
 const naturalMessages=await api(async()=>{const a=window.qaApi;return(await Promise.all((await a.listThreads()).map(t=>a.getThread(t.id)))).flatMap(t=>t.messages).filter(m=>m.text==='吃飯沒？');});
 assert.equal(naturalMessages.length,1);assert.equal(naturalMessages[0].from,'me');
 const naturalCard=page.locator(`.mes[mesid="${naturalMessageId}"] .tp-story-wechat`);await naturalCard.waitFor();assert((await naturalCard.textContent()).includes('吃飯沒？'));
 await api(()=>window.qaApi.pocketAction('sync',{}));
 assert.equal(await api(async()=>{const a=window.qaApi;return(await Promise.all((await a.listThreads()).map(t=>a.getThread(t.id)))).flatMap(t=>t.messages).filter(m=>m.text==='吃飯沒？').length;}),1);
 checks.push('a natural user WeChat prompt renders a main-story card and synchronizes one real outgoing message without replay duplication');
 const nativeVisible=await api(async()=>{const a=window.qaApi;await a.appendChat(window.qaDm,[{from:'林知夏',kind:'text',text:'V06 微信同步正文：晚餐在老地方。'}]);const p=await a.postForum({title:'午後留言板',text:'V06 論壇同步正文：晚餐約在窗邊。'});await a.replyForum(p.id,{text:'V06 論壇回覆：我也會到。'});await a.pocketAction('ig.dm',{to:'林知夏',text:'V06 IG同步正文：記得帶相機。'});await a.pocketAction('sync',{});return {postId:p.id};});
 await waitAsync(()=>['V06 微信同步正文','V06 IG同步正文','V06 論壇同步正文','V06 論壇回覆'].every(t=>parent.qa.context.chat.some(m=>m.extra?.tavern_pocket_activity&&m.mes.includes(t))));
 assert(await page.evaluate(()=>window.qa.context.chat.some(m=>m.extra?.tavern_pocket_activity&&/V06 論壇同步正文|V06 論壇回覆/.test(m.mes))));
 const mirrorBefore=await page.evaluate(()=>window.qa.context.chat.filter(m=>m.extra?.tavern_pocket_activity).length);
 await api(()=>window.qaApi.pocketAction('sync',{}));await api(()=>window.qaApi.pocketAction('sync',{}));
 assert.equal(await page.evaluate(()=>window.qa.context.chat.filter(m=>m.extra?.tavern_pocket_activity).length),mirrorBefore);
 const mirroredTexts=await page.evaluate(()=>window.qa.context.chat.filter(m=>m.extra?.tavern_pocket_activity).map(m=>({text:m.mes,html:m.extra.display_text})));assert(mirroredTexts.every(m=>!m.text.includes('<phone>')));assert(mirroredTexts.some(m=>m.html.includes('tp-story-forum')));assert(mirroredTexts.some(m=>m.html.includes('tp-story-instagram')));
 assert(await page.evaluate(()=>window.qa.hostCalls.saveChat>0&&window.qa.hostCalls.addOneMessage>0));
 checks.push('native WeChat, Instagram DMs and new forum posts/replies append grouped main-chat cards; repeated sync neither feeds mirrors back nor creates duplicates');
 // Every phone text model path receives the selected books plus the current visible main story.
 await page.evaluate(()=>window.qa.incomingRaw('V06_MAIN_STORY_SENTINEL：晚餐改在有銀色手環的小店。'));
 await api(async()=>{const a=window.qaApi,s=await a.pocketState();await a.pocketAction('settings.save',{profileId:'phone',worldbooks:['咖啡館世界','賽車世界'],inject:true,autoWeChatPhotos:s.settings.autoWeChatPhotos});parent.qa.nextResponse='【帖子】林知夏｜窗邊的約定｜V06論壇模型回覆。\n【回复】陸澤：記得留個位置。';await a.forumRefresh();});
 const sharedForumRequest=await page.evaluate(()=>window.qa.requests.at(-1));assert(sharedForumRequest.prompt.includes('COFFEE_LORE'));assert(sharedForumRequest.prompt.includes('RACING_LORE'));assert(sharedForumRequest.prompt.includes('V06_MAIN_STORY_SENTINEL'));assert(!sharedForumRequest.prompt.includes('DISABLED_BOOK_SENTINEL'));assert(!sharedForumRequest.prompt.includes('PRIVATE_DIARY_SENTINEL_9211'));
 checks.push('native forum generation receives selected worldbooks and the current main narrative through the common model bridge while private diary and disabled lore remain excluded');
 // Structured story forum events project into the existing native forum and reconcile edits/deletion.
 const sourceForumIndex=await page.evaluate(()=>window.qa.incoming({id:'v06-source-forum',app:'forum',action:'post',from:'沈禾',title:'窗邊的邀請',text:'V06 正文論壇：今晚咖啡館見。'}));
 await api(()=>window.qaApi.pocketAction('sync',{}));
 const sourceForumPost=await api(async()=>(await window.qaApi.listForum()).find(p=>p.text==='V06 正文論壇：今晚咖啡館見。'));assert(sourceForumPost);
 await api(async id=>{await window.qaApi.replyForum(id,{text:'V06 原生留言保留'});await window.qaApi.pocketAction('sync',{});},sourceForumPost.id);
 await page.evaluate(async id=>{const m=window.qa.context.chat[id];m.mes=m.mes.replace('今晚咖啡館見。','改約明天午后。');await window.qa.emit('MESSAGE_EDITED',id);},sourceForumIndex);
 await api(()=>window.qaApi.pocketAction('sync',{}));
 const updatedForum=await api(id=>window.qaApi.getForumPost(id),sourceForumPost.id);assert.equal(updatedForum.text,'V06 正文論壇：改約明天午后。');assert(updatedForum.replies.some(r=>r.text==='V06 原生留言保留'));
 assert.equal(await api(async()=>(await window.qaApi.listForum()).filter(p=>p.pocketSource?.id==='v06-source-forum').length),1);
 await page.evaluate(async id=>{window.qa.context.chat.splice(id,1);await window.qa.emit('MESSAGE_DELETED');},sourceForumIndex);await api(()=>window.qaApi.pocketAction('sync',{}));
 assert(!await api(async id=>(await window.qaApi.listForum()).some(p=>p.id===id),sourceForumPost.id));
 checks.push('main-story forum posts appear in the native forum, edited source text reconciles without erasing native comments, and deleting the source removes only its projection');
 // Natural payment prose creates reviewable drafts; explicit confirmation settles each exactly once.
 const naturalBalance=await api(()=>window.qaApi.wallet().balance);await api(n=>{parent.qaNaturalBalance=n;},naturalBalance);
 const naturalTransferId=await page.evaluate(()=>window.qa.send('微信轉帳給林知夏：88.50「晚餐費」'));
 const naturalRedId=await page.evaluate(()=>window.qa.send('微信紅包給林知夏：20「好運」'));
 await api(()=>window.qaApi.pocketAction('sync',{}));assert.equal(await api(()=>window.qaApi.wallet().balance),naturalBalance);
 await page.locator(`.mes[mesid="${naturalTransferId}"] .tp-story-card-amount`).waitFor();await page.locator(`.mes[mesid="${naturalRedId}"] .tp-story-card-amount`).waitFor();
 const paymentDrafts=await api(async()=>{const a=window.qaApi;return(await Promise.all((await a.listThreads()).map(async row=>{const t=await a.getThread(row.id);return t.messages.filter(m=>m.kind==='system'&&m.text.startsWith('[待確認付款]')).map(m=>({threadId:row.id,id:m.id,sourceId:m.source.id,text:m.text}));}))).flat();});
 assert.equal(paymentDrafts.length,2);
 await go('chat');const transferDraft=paymentDrafts.find(m=>m.text.includes('88.50'))||paymentDrafts[0];
 await frame.locator(`[data-action="pocket-confirm-payment"][data-mid="${transferDraft.id}"]`).click();await frame.locator('[data-action="confirm"]').click();
 await waitAsync(()=>Math.abs(window.qaApi.wallet().balance-(parent.qaNaturalBalance-88.5))<0.001);
 await api(async draft=>{await window.qaApi.pocketConfirmPayment(draft.threadId,draft.sourceId);await window.qaApi.pocketAction('sync',{});},transferDraft);
 assert.equal(await api(()=>window.qaApi.wallet().balance),Math.round((naturalBalance-88.5)*100)/100);
 const redDraft=paymentDrafts.find(m=>m.id!==transferDraft.id);
 await api(async draft=>{await window.qaApi.pocketConfirmPayment(draft.threadId,draft.sourceId);await window.qaApi.pocketConfirmPayment(draft.threadId,draft.sourceId);await window.qaApi.pocketAction('sync',{});},redDraft);
 assert.equal(await api(()=>window.qaApi.wallet().balance),Math.round((naturalBalance-108.5)*100)/100);
 checks.push('natural transfer/redpacket prompts render amount cards and remain unpaid phone drafts until explicit confirmation; UI confirmation plus repeated API/sync each debit once');
 // Native WeChat contact status editor writes a fresh CSB21 snapshot back into the visible story.
 await frame.locator('.tp-thread-person[data-name="林知夏"]').click();await frame.locator('[data-action="profile-status-edit"]').click();await frame.locator('[data-status-editor="林知夏"]').waitFor();
 await frame.locator('[data-status-field="hydration"]').fill('93');await frame.locator('[data-status-field="mood"]').fill('期待晚餐');await frame.locator('[data-status-field="outfit"]').fill('海軍藍針織外套');
 await frame.locator('[data-status-part]').first().locator('[data-part-value]').fill('左手腕戴銀色手環，指尖沾著水珠');
 await frame.locator('.toast').waitFor({state:'hidden'});await frame.locator('.sheet-body').evaluate(el=>{el.scrollTop=0;});
 await capture(page.locator('#sttts-panel'),'v06-status-editor.png');
 await frame.locator('[data-action="status-save"]').click();await frame.locator('[data-status-editor]').waitFor({state:'hidden'});
 const editedContact=await api(()=>window.qaApi.pocketContactProfile('林知夏'));assert.equal(editedContact.fields.hydration,'93');assert.equal(editedContact.fields.outfit,'海軍藍針織外套');assert.equal(editedContact.body[0].value,'左手腕戴銀色手環，指尖沾著水珠');
 assert(await page.evaluate(()=>window.qa.context.chat.some(m=>m.mes.includes('[CSB21_PANEL]')&&m.mes.includes('hydration: 93')&&m.mes.includes('海軍藍針織外套'))));
 await api(async info=>{parent.qa.nextResponse=JSON.stringify({scene:'cafe portrait, navy blue cardigan, silver wrist bracelet'});const d=await window.qaApi.pocketPhotoDraft(info.threadId,info.id);await window.qaApi.pocketOptimizePhoto(info.threadId,info.id,{token:d.token,scene:d.scene});},presetPhoto);
 const editedImageRequest=await page.evaluate(()=>window.qa.requests.at(-1));assert(editedImageRequest.prompt.includes('海軍藍針織外套'));assert(editedImageRequest.prompt.includes('銀色手環'));assert.equal(naiCalls.length,4);
 checks.push('contact status UI edits meters, outfit and body details, writes a CSB21 main-story snapshot and makes updated visible appearance available to image prompt optimization without an image call');
 // Instagram discovers current-story role accounts and generates posts/stories for the selected character.
 await go('instagram');await frame.locator('[data-action="tab"][data-tab="accounts"]').click();
 const accountsText=await frame.locator('.tp-ig-accounts').textContent();assert(accountsText.includes('林知夏'));assert(accountsText.includes('沈禾'));
 await frame.locator('[data-action="ig-account-publisher"][data-name="沈禾"]').click();assert.equal(await frame.locator('[data-field="ig-publisher"]').inputValue(),'沈禾');
 await page.evaluate(()=>{window.qa.nextResponse='<phone>'+JSON.stringify({id:'v06-gen-post',app:'instagram',action:'post',from:'沈禾',text:'V06 角色貼文：咖啡香裡等晚餐。'})+'</phone>';});
 await frame.locator('[data-action="ig-generate"]').click();await waitAsync(async()=>(await window.qaApi.pocketState()).instagram.posts.some(p=>p.from==='沈禾'&&p.text==='V06 角色貼文：咖啡香裡等晚餐。'));
 await page.evaluate(()=>{window.qa.nextResponse='<phone>'+JSON.stringify({id:'v06-gen-story',app:'instagram',action:'story',from:'沈禾',text:'V06 限時動態：今天的窗邊座位留給你。'})+'</phone>';});
 await frame.locator('[data-action="ig-story-generate"]').click();
 const story=await waitAsync(async()=>(await window.qaApi.pocketState()).instagram.stories.find(p=>p.from==='沈禾'&&p.text==='V06 限時動態：今天的窗邊座位留給你。'));assert(story.expiresAt>story.at);
 await frame.locator('[data-action="tab"][data-tab="stories"]').click();await frame.locator(`[data-action="ig-story-open"][data-id="${story.id}"]`).click();await frame.locator('[data-field="story-reply"]').fill('V06 限動回覆：我馬上到。');await frame.locator('[data-action="ig-story-reply"]').click();
 await waitAsync(async()=>(await window.qaApi.pocketState()).instagram.dms.some(m=>m.storyId&&m.to==='沈禾'&&m.text==='V06 限動回覆：我馬上到。'));
 await frame.locator('.toast').waitFor({state:'hidden'});await frame.locator('.view[data-app="instagram"]').evaluate(el=>{el.scrollTop=0;});
 await capture(page.locator('#sttts-panel'),'v06-instagram-story.png');
 assert(await page.evaluate(()=>window.qa.context.chat.some(m=>m.extra?.tavern_pocket_activity&&m.mes.includes('V06 限時動態'))));
 checks.push('Instagram discovers CSB/contact roles, selects an NPC publisher, generates a post and 24-hour story, syncs story replies into DM and mirrors the story into the main chat');
 // Owner-only fictional catalogue accepts categories beyond everyday supplies.
 await go('storyshop');assert((await frame.locator('.view[data-app="storyshop"]').textContent()).includes('萬寶閣'));
 await frame.locator('[data-field="shop-query"]').fill('星際通行資格、冒險夥伴、虛構能量槍');
 await page.evaluate(()=>{window.qa.nextResponse=JSON.stringify({items:[{name:'星際通行資格',description:'此劇情世界中的虛構通行資格。',price:45,emoji:'🎫'},{name:'冒險夥伴',description:'自願同行的虛構角色契約。',price:55,emoji:'🧑'},{name:'虛構能量槍',description:'僅作為劇情道具的能量槍。',price:65,emoji:'🔮'}]});});
 await frame.locator('[data-action="shop-search"]').click();await waitAsync(async()=>(await window.qaApi.pocketState()).catalogue.some(x=>x.name==='星際通行資格'));
 const ownerShopRequest=await page.evaluate(()=>window.qa.requests.at(-1));assert(ownerShopRequest.prompt.includes('專屬'));assert(ownerShopRequest.prompt.includes('星際通行資格'));assert(ownerShopRequest.prompt.includes('虛構'));
 await frame.locator('.toast').waitFor({state:'hidden'});await frame.locator('.view[data-app="storyshop"]').evaluate(el=>{el.scrollTop=0;});
 await capture(page.locator('#sttts-panel'),'v06-wanbao-shop.png');
 checks.push('Wanbao owner-only fictional catalogue generates queried qualifications, companions and fantasy props while using the existing virtual purchase system');
 await api(()=>window.qaApi.close());await page.locator(`.mes[mesid="${roleNaturalId}"]`).scrollIntoViewIfNeeded();await capture(page.locator(`.mes[mesid="${roleNaturalId}"]`),'v06-main-chat-card.png');await page.locator('#sttts-floating .orb').click();await page.locator('#sttts-panel[open]').waitFor();
 // v0.7: several inline actions preserve the prose and stay inside one original story message.
 const inlineText='她放下外套，微信傳給你：「吃飯沒？」你看見螢幕亮起。林知夏微信傳給我：「我在樓下。」她又笑了笑，林知夏微信轉帳給你：88.50「晚餐費」，接著林知夏微信紅包給我：20「好運」。夜色漸深。';
 const beforeInline=await page.evaluate(()=>window.qa.context.chat.length);
 const inlineId=await page.evaluate(text=>window.qa.incomingRaw(text),inlineText);await api(()=>window.qaApi.pocketAction('sync',{}));
 const inlineEl=page.locator(`.mes[mesid="${inlineId}"]`);assert.equal(await inlineEl.locator('.tp-story-card').count(),4);
 const inlineDom=await inlineEl.textContent();for(const fragment of ['她放下外套，','你看見螢幕亮起。','她又笑了笑，','接著','夜色漸深。'])assert(inlineDom.includes(fragment));
 assert(inlineDom.indexOf('她放下外套，')<inlineDom.indexOf('吃飯沒？'));assert(inlineDom.indexOf('吃飯沒？')<inlineDom.indexOf('你看見螢幕亮起。'));assert(inlineDom.indexOf('我在樓下。')<inlineDom.indexOf('她又笑了笑，'));
 assert.equal(await page.evaluate(id=>window.qa.context.chat[id].mes,inlineId),inlineText);assert.equal(await page.evaluate(()=>window.qa.context.chat.length),beforeInline+1);
 await api(()=>window.qaApi.pocketAction('sync',{}));assert.equal(await page.evaluate(()=>window.qa.context.chat.length),beforeInline+1);
 await api(()=>window.qaApi.close());await inlineEl.scrollIntoViewIfNeeded();await capture(inlineEl,'v07-inline-chat.png');await page.locator('#sttts-floating .orb').click();await page.locator('#sttts-panel[open]').waitFor();
 checks.push('multiple inline WeChat messages, a transfer and a redpacket render inside the original story message in place, preserve all surrounding prose/raw text and do not append duplicate activity messages');

 // v0.8: the formatter must survive a real Markdown paragraph pass at phone width.
 const inlineStructure=await inlineEl.locator('.tp-story-card').evaluateAll(cards=>cards.map(card=>({tag:card.tagName,paragraph:!!card.closest('p'),invalid:card.querySelectorAll('section,div,article,header,footer,p').length})));
 assert(inlineStructure.every(x=>x.tag==='SPAN'&&x.paragraph&&x.invalid===0));
 await api(()=>window.qaApi.close());await page.setViewportSize({width:390,height:844});
 const inlineOverflow=await inlineEl.evaluate(el=>[...el.querySelectorAll('.tp-story-card')].map(card=>({scroll:card.scrollWidth,client:card.clientWidth,width:card.getBoundingClientRect().width,parent:el.querySelector('.mes_text').clientWidth})));
 assert(inlineOverflow.every(x=>x.scroll<=x.client+1&&x.width<=x.parent+1));
 await capture(inlineEl,'v08-inline-chat-mobile.png');
 await page.setViewportSize({width:1440,height:980});await page.locator('#sttts-floating .orb').click();await page.locator('#sttts-panel[open]').waitFor();
 checks.push('inline cards use span-only HTML inside a real Markdown paragraph and preserve readable prose without card overflow at a 390px mobile viewport');
 // Several actors in one native phone operation produce one main-story batch with stable event IDs.
 await page.evaluate(()=>window.qa.incomingRaw('V07 批次分界：三人準備在微信群組確認行程。'));
 const beforeBatch=await page.evaluate(()=>window.qa.context.chat.length);
 await api(async()=>{const a=window.qaApi;await a.appendChat(window.qaGroup,[{from:'me',kind:'text',text:'V07_BATCH_USER：明天早上出發。'},{from:'林知夏',kind:'text',text:'V07_BATCH_XIA：我會帶相機。'},{from:'陸澤',kind:'text',text:'V07_BATCH_LU：我負責開車。'}]);await a.pocketAction('sync',{});});
 const nativeBatch=await page.evaluate(()=>window.qa.context.chat.filter(m=>m.extra?.tavern_pocket_activity&&m.mes.includes('V07_BATCH_USER')));assert.equal(nativeBatch.length,1);assert.equal(nativeBatch[0].extra.tavern_pocket_activity.ids.length,3);assert(nativeBatch[0].mes.includes('V07_BATCH_XIA'));assert(nativeBatch[0].mes.includes('V07_BATCH_LU'));assert.equal(await page.evaluate(()=>window.qa.context.chat.length),beforeBatch+1);
 await api(async()=>{await window.qaApi.appendChat(window.qaGroup,[{from:'林知夏',kind:'text',text:'V07_BATCH_FOLLOWUP：到時候見。'}]);await window.qaApi.pocketAction('sync',{});await window.qaApi.pocketAction('sync',{});});
 const appendedBatch=await page.evaluate(()=>window.qa.context.chat.filter(m=>m.extra?.tavern_pocket_activity&&m.mes.includes('V07_BATCH_USER')));assert.equal(appendedBatch.length,1);assert.equal(appendedBatch[0].extra.tavern_pocket_activity.ids.length,4);assert(appendedBatch[0].mes.includes('V07_BATCH_FOLLOWUP'));assert.equal(await page.evaluate(()=>window.qa.context.chat.length),beforeBatch+1);
 checks.push('mixed user/role phone activity is grouped into one main-chat message; a consecutive phone reply extends that batch and repeated sync preserves all four unique event IDs');
 // The Me app stores explicit profile fields and custom facts for the current persona.
 await go('me');await frame.locator('[data-action="me-branch"][data-branch="profile"]').click();
 for(const [field,value] of Object.entries({name:'夜航旅人',age:'24',height:'180 cm',weight:'75 kg',build:'精實',appearance:'黑髮、深色眼睛',body:'肩背挺直',anatomy:'右手掌有一道舊疤',penis:'由使用者自行維護'}))await frame.locator(`[data-field="me-${field}"]`).fill(value);
 await frame.locator('[data-action="me-custom-add"]').click();await frame.locator('[data-field="me-custom-name"]').fill('慣用手');await frame.locator('[data-field="me-custom-value"]').fill('右手');await frame.locator('[data-action="me-profile-save"]').click();
 const savedMe=await waitAsync(async()=>{const s=await window.qaApi.pocketMemoryState();return s.profile.name==='夜航旅人'&&s;});assert.equal(savedMe.profile.age,'24');assert.equal(savedMe.profile.body,'肩背挺直');assert.equal(savedMe.profile.penis,'由使用者自行維護');assert.deepEqual(savedMe.profile.customFields,[{name:'慣用手',value:'右手'}]);
 await frame.locator('.toast').waitFor({state:'hidden'});await frame.locator('.view[data-app="me"]').evaluate(el=>{el.scrollTop=0;});await capture(page.locator('#sttts-panel'),'v07-me-profile.png');
 checks.push('Me profile UI saves explicit age, build, appearance, body/anatomy/penis and custom fields without filling unknown values or changing the active persona identity');
 const meBranch=async name=>{await frame.locator('[data-action="me-home"]').click();await frame.locator(`[data-action="me-branch"][data-branch="${name}"]`).click();};
 await meBranch('items');await frame.locator('[data-action="me-entry-new"]').click();await frame.locator('[data-field="me-entry-name"]').fill('銀色指南針');await frame.locator('[data-field="me-entry-description"]').fill('V07 手動收藏：指向故事中的北方。');await frame.locator('[data-field="me-entry-quantity"]').fill('2');await frame.locator('[data-action="me-entry-save"]').click();
 const compass=await waitAsync(async()=>(await window.qaApi.pocketMemoryState()).items.find(x=>x.name==='銀色指南針'));assert.equal(compass.quantity,2);
 await frame.locator(`[data-action="me-entry-edit"][data-id="${compass.id}"]`).click();await frame.locator('[data-field="me-entry-description"]').fill('V07 手動收藏：羅盤外殼有星紋。');await frame.locator('[data-field="me-entry-quantity"]').fill('3');await frame.locator('[data-action="me-entry-save"]').click();
 await waitAsync(async()=>(await window.qaApi.pocketMemoryState()).items.find(x=>x.name==='銀色指南針')?.quantity===3);
 await frame.locator(`[data-action="me-entry-edit"][data-id="${compass.id}"]`).click();await frame.locator('[data-action="me-entry-delete"]').click();await frame.locator('[data-action="confirm"]').click();await waitAsync(async()=>!(await window.qaApi.pocketMemoryState()).items.some(x=>x.name==='銀色指南針'));
 checks.push('Me items UI creates, edits quantity/description and deletes a personal item using the persistent store');
 await meBranch('abilities');await frame.locator('[data-action="me-entry-new"]').click();await frame.locator('[data-field="me-entry-name"]').fill('快速閱讀');await frame.locator('[data-field="me-entry-description"]').fill('V07 能力：能迅速整理一頁資料的要點。');await frame.locator('[data-action="me-entry-save"]').click();
 const readingAbility=await waitAsync(async()=>(await window.qaApi.pocketMemoryState()).abilities.find(x=>x.name==='快速閱讀'));
 await frame.locator(`[data-action="me-entry-edit"][data-id="${readingAbility.id}"]`).click();await frame.locator('[data-field="me-entry-description"]').fill('V07 能力：能迅速整理一頁資料的要點，仍需親自閱讀。');await frame.locator('[data-action="me-entry-save"]').click();await waitAsync(async()=>(await window.qaApi.pocketMemoryState()).abilities.find(x=>x.name==='快速閱讀')?.description.endsWith('仍需親自閱讀。'));
 await api(async()=>{const a=window.qaApi;await a.pocketMemoryAction('entry.save',{kind:'abilities',name:'暫存測試能力',description:'僅供刪除測試'});});
 const tempAbility=await api(async()=>(await window.qaApi.pocketMemoryState()).abilities.find(x=>x.name==='暫存測試能力'));await frame.locator(`[data-action="me-entry-edit"][data-id="${tempAbility.id}"]`).click();await frame.locator('[data-action="me-entry-delete"]').click();await frame.locator('[data-action="confirm"]').click();await waitAsync(async()=>!(await window.qaApi.pocketMemoryState()).abilities.some(x=>x.name==='暫存測試能力'));
 checks.push('Me abilities UI creates and edits an ability while explicit deletion removes only the selected entry');
 // Worldbook sync owns only its marked entries and preserves unrelated existing content.
 const memoryBookName=await api(async()=>(await window.qaApi.pocketMemoryState()).worldbook.name);
 await page.evaluate(name=>{window.qa.books[name]={name,extensions:{externalFixture:'preserve-root'},entries:{900:{uid:900,key:['QA_KEEP'],comment:'外部保留條目',content:'V07_UNRELATED_ENTRY_MUST_SURVIVE',disable:false,constant:true,extensions:{external:{value:42}}}}};},memoryBookName);
 await meBranch('memory');await frame.locator('[data-action="me-worldbook-sync"]').click();await waitAsync(async()=>(await window.qaApi.pocketMemoryState()).worldbook.lastSyncedAt>0);
 const firstMemoryBook=await page.evaluate(name=>structuredClone(window.qa.books[name]),memoryBookName);assert.equal(firstMemoryBook.entries['900'].content,'V07_UNRELATED_ENTRY_MUST_SURVIVE');assert.equal(firstMemoryBook.extensions.externalFixture,'preserve-root');assert(Object.values(firstMemoryBook.entries).some(e=>e.extensions?.tavern_pocket_memory?.owner==='tavern-pocket'&&e.content.includes('快速閱讀')));
 await frame.locator('[data-action="me-worldbook-sync"]').click();await waitAsync(()=>parent.qa.hostCalls.saveWorldInfo.filter(n=>n.includes('長期記憶')).length>=2);
 const secondMemoryBook=await page.evaluate(name=>structuredClone(window.qa.books[name]),memoryBookName);assert.deepEqual(secondMemoryBook.entries['900'],firstMemoryBook.entries['900']);assert.equal(Object.keys(secondMemoryBook.entries).length,Object.keys(firstMemoryBook.entries).length);
 checks.push('personal-memory worldbook sync writes owned entries, preserves unrelated entry metadata/content and root extensions, and repeated sync does not duplicate entries');
 // The exact accident scenario is acquired before the next main generation; an unpriced ability cannot invent a wallet charge.
 const beforeAccident=await api(()=>window.qaApi.wallet().balance);
 const accidentId=await page.evaluate(()=>window.qa.send('前面發生車禍了，我發現我現在需要特殊能力，我打開小手機，進入萬寶商城，購買了時間停止能力…'));
 const accidentState=await api(()=>window.qaApi.pocketMemoryState());const timeStop=accidentState.abilities.find(x=>x.name==='時間停止能力');assert(timeStop);assert.equal(await api(()=>window.qaApi.wallet().balance),beforeAccident);assert(/未記載價格|未扣款|正文取得/.test(timeStop.source));
 assert(await page.evaluate(()=>Object.values(window.qa.prompts).some(text=>String(text).includes('時間停止能力'))));
 await api(()=>window.qaApi.pocketAction('sync',{}));await page.evaluate(id=>window.qa.emit('MESSAGE_SENT',id),accidentId);assert.equal((await api(()=>window.qaApi.pocketMemoryState())).abilities.filter(x=>x.name==='時間停止能力').length,1);assert.equal(await api(()=>window.qaApi.wallet().balance),beforeAccident);
 await api(async()=>{parent.qa.nextResponse='林知夏：先用快速閱讀整理路線，再決定時間停止能力的用途。';await window.qaApi.chatReply(window.qaDm);});const memoryModelRequest=await page.evaluate(()=>window.qa.requests.at(-1));assert(memoryModelRequest.prompt.includes('時間停止能力'));assert(memoryModelRequest.prompt.includes('快速閱讀'));assert(memoryModelRequest.prompt.includes('夜航旅人'));
 checks.push('the exact user accident/purchase sentence creates one persistent time-stop ability before generation, includes it in main/phone model context and records the unspecified price without charging or replay duplication');
 const assetsBeforeRejected=await api(async()=>{const s=await window.qaApi.pocketMemoryState();return s.items.length+s.abilities.length;});
 await page.evaluate(()=>window.qa.incomingRaw('我打開萬寶商城，購買了「不該自動取得能力」。'));await page.evaluate(()=>window.qa.send('如果我在萬寶商城購買了「假設測試能力」，之後會怎樣？'));await api(()=>window.qaApi.pocketAction('sync',{}));assert.equal(await api(async()=>{const s=await window.qaApi.pocketMemoryState();return s.items.length+s.abilities.length;}),assetsBeforeRejected);assert.equal(await api(()=>window.qaApi.wallet().balance),beforeAccident);
 checks.push('assistant-authored acquisition text and hypothetical user prose cannot add assets or debit the wallet');
 await api(async()=>{parent.qa.nextResponse=JSON.stringify({items:[{name:'急救包',description:'劇情用品，供旅途備用。',price:19,emoji:'🧰'}]});await window.qaApi.pocketAction('shop.generate',{query:'急救包'});});
 const beforeKnownPurchase=await api(()=>window.qaApi.wallet().balance);
 const knownPurchaseId=await page.evaluate(()=>window.qa.send('我打開萬寶商城，購買了「急救包」。'));
 await api(()=>window.qaApi.pocketAction('sync',{}));const knownItem=await api(async()=>(await window.qaApi.pocketMemoryState()).items.find(x=>x.name==='急救包'));assert(knownItem);assert.equal(await api(()=>window.qaApi.wallet().balance),Math.round((beforeKnownPurchase-19)*100)/100);
 await page.evaluate(id=>window.qa.emit('MESSAGE_SENT',id),knownPurchaseId);await api(()=>window.qaApi.pocketAction('sync',{}));assert.equal(await api(async()=>(await window.qaApi.pocketMemoryState()).items.filter(x=>x.name==='急救包').length),1);assert.equal(await api(()=>window.qaApi.wallet().balance),Math.round((beforeKnownPurchase-19)*100)/100);
 checks.push('a narrative purchase of an exact catalogued item uses its known price once and stores one lasting item across repeated message/sync events');
 await frame.locator('[data-action="me-home"]').click();await frame.locator('[data-action="me-branch"][data-branch="abilities"]').click();await frame.locator('.toast').waitFor({state:'hidden'});await frame.locator('.view[data-app="me"]').evaluate(el=>{el.scrollTop=0;});await capture(page.locator('#sttts-panel'),'v07-me-abilities.png');

 // v0.8: malformed catalogue entries are isolated, one schema repair is bounded,
 // and a manual product remains usable when the model cannot return products.
 await go('storyshop');const manualBefore=await api(()=>({balance:window.qaApi.wallet().balance,requests:parent.qa.requests.length,chat:parent.qa.context.chat.length}));
 await frame.locator('[data-action="shop-new"]').click();await frame.locator('[data-field="shop-name"]').fill('星紋護符');await frame.locator('[data-field="shop-description"]').fill('由我設定的虛構護符，能在夜晚辨識方向。');await frame.locator('[data-field="shop-price"]').fill('12');await frame.locator('[data-field="shop-kind"]').selectOption('items');await frame.locator('[data-action="shop-save"]').click();
 let manualProduct=await waitAsync(async()=>(await window.qaApi.pocketState()).catalogue.find(x=>x.name==='星紋護符'));assert.equal(manualProduct.source,'manual');assert.equal(await page.evaluate(()=>window.qa.requests.length),manualBefore.requests);assert.equal(await api(()=>window.qaApi.wallet().balance),manualBefore.balance);
 await frame.locator(`[data-action="shop-edit"][data-id="${manualProduct.id}"]`).click();await frame.locator('[data-field="shop-description"]').fill('手動商品記憶：護符刻有星紋，在夜晚指出北方。');await frame.locator('[data-action="shop-save"]').click();await waitAsync(async()=>(await window.qaApi.pocketState()).catalogue.find(x=>x.name==='星紋護符')?.description.startsWith('手動商品記憶'));
 await api(async()=>{parent.qa.nextResponse=JSON.stringify({items:[{name:'保留的補給包',description:'完整有效的商品。',price:8},{name:'缺失價格商品',description:'不可猜價'}]});await window.qaApi.pocketAction('shop.generate',{query:'補給包'});});
 const partialCatalogue=await api(()=>window.qaApi.pocketState());assert(partialCatalogue.catalogue.some(x=>x.name==='星紋護符'));assert(partialCatalogue.catalogue.some(x=>x.name==='保留的補給包'));assert(!partialCatalogue.catalogue.some(x=>x.name==='缺失價格商品'));assert.equal(partialCatalogue.catalogueSource.skipped,1);
 checks.push('manual shop UI creates/edits a product without a model call or charge; malformed generated entries are skipped individually and a valid item plus manual stock remain');
 const repairBefore=await page.evaluate(()=>window.qa.requests.length);
 await api(async()=>{parent.qa.responseQueue=['{"items":[{"name":"格式修復書籤" "description":"只修復 JSON 分隔符。","price":3}]}',JSON.stringify({items:[{name:'格式修復書籤',description:'只修復 JSON 分隔符。',price:3}]})];await window.qaApi.pocketAction('shop.generate',{query:'格式修復書籤'});});
 const repairedCatalogue=await api(()=>window.qaApi.pocketState());assert(repairedCatalogue.catalogueSource.repaired);assert.equal(await page.evaluate(()=>window.qa.requests.length),repairBefore+2);assert(repairedCatalogue.catalogue.some(x=>x.name==='星紋護符'));
 const retainedNames=repairedCatalogue.catalogue.map(x=>x.name),refusalBefore=await page.evaluate(()=>window.qa.requests.length);
 const refusal=await api(async()=>{parent.qa.nextResponse='很抱歉，我無法提供這些商品。';try{await window.qaApi.pocketAction('shop.generate',{query:'測試失敗保留'});return '';}catch(e){return e.message;}});assert(refusal);assert.equal(await page.evaluate(()=>window.qa.requests.length),refusalBefore+1);assert.deepEqual((await api(()=>window.qaApi.pocketState())).catalogue.map(x=>x.name),retainedNames);
 checks.push('a single format-only repair can recover explicit product fields; refusal is not retried and failure preserves the existing catalogue');
 await frame.locator(`[data-action="shop-buy"][data-id="${manualProduct.id}"]`).click();await frame.locator('[data-action="confirm"]').click();await waitAsync(async()=>(await window.qaApi.pocketMemoryState()).items.some(x=>x.name==='星紋護符'));assert.equal(await api(()=>window.qaApi.wallet().balance),Math.round((manualBefore.balance-12)*100)/100);await api(()=>window.qaApi.pocketAction('sync',{}));assert(await page.evaluate(()=>window.qa.context.chat.some(m=>m.extra?.tavern_pocket_activity&&m.mes.includes('星紋護符')&&m.extra.display_text.includes('tp-story-shop'))));
 const purchaseMirrorCount=await page.evaluate(()=>window.qa.context.chat.filter(m=>m.extra?.tavern_pocket_activity&&m.mes.includes('星紋護符')).length);await api(()=>window.qaApi.pocketAction('sync',{}));assert.equal(await page.evaluate(()=>window.qa.context.chat.filter(m=>m.extra?.tavern_pocket_activity&&m.mes.includes('星紋護符')).length),purchaseMirrorCount);assert.equal(await api(()=>window.qaApi.wallet().balance),Math.round((manualBefore.balance-12)*100)/100);
 checks.push('manual product purchase charges once, stores it in My Items and renders one grouped shop receipt without replay duplication');
 // New forum/shop actions also remain searchable in archives; recall prompt stays request-driven.
 await api(async()=>{const a=window.qaApi,p=await a.postForum({title:'北極星觀測記錄',text:'今晚在山頂能看見獵戶座。'});await a.replyForum(p.id,{text:'記得帶上望遠鏡，夜裡山風會比較冷。'});await a.pocketAction('sync',{});});
 assert(await page.evaluate(()=>window.qa.context.chat.some(m=>m.extra?.tavern_pocket_activity&&m.mes.includes('今晚在山頂能看見獵戶座')&&m.extra.display_text.includes('tp-story-forum'))));
 let archive=await api(()=>window.qaApi.pocketArchiveState());assert(archive.forum>0&&archive.shop>0);assert(archive.records.some(x=>x.text.includes('今晚在山頂能看見獵戶座')));assert(archive.records.some(x=>x.itemName==='星紋護符'));
 await page.evaluate(()=>window.qa.send('我推開咖啡館的門，問知夏今天過得如何。'));const ordinaryPrompts=await page.evaluate(()=>Object.values(window.qa.prompts).join('\n'));assert(!ordinaryPrompts.includes('今晚在山頂能看見獵戶座'));assert(!ordinaryPrompts.includes('格式修復書籤'));
 await page.evaluate(()=>window.qa.send('調用論壇記憶：北極星觀測記錄。'));assert(await page.evaluate(()=>String(window.qa.prompts['sttts.entry.archive']).includes('今晚在山頂能看見獵戶座')));
 await page.evaluate(()=>window.qa.send('調用萬寶商城記憶：格式修復書籤。'));assert(await page.evaluate(()=>String(window.qa.prompts['sttts.entry.archive']).includes('格式修復書籤')));
 checks.push('new forum posts/replies render in the main chat while archive injection stays request-driven; explicit forum/shop recall exposes stored records');
 await go('me');if(await frame.locator('[data-action="me-home"]').isVisible())await frame.locator('[data-action="me-home"]').click();await frame.locator('[data-action="me-branch"][data-branch="memory"]').click();await frame.locator('.tp-me-archive').waitFor();
 await frame.locator('[data-field="me-archive-query"]').fill('完全不存在的記憶');await frame.locator('[data-action="me-archive-search"]').click();await frame.locator('.tp-me-archive-empty').waitFor();
 await frame.locator('[data-field="me-archive-query"]').fill('北極星觀測記錄');await frame.locator('[data-action="me-archive-search"]').click();await frame.locator('details.tp-me-archive-record[data-archive-app="forum"]').first().waitFor();await frame.locator('details.tp-me-archive-record').first().locator('summary').click();assert((await frame.locator('.tp-me-archive').textContent()).includes('今晚在山頂能看見獵戶座'));
 await frame.locator('[data-action="me-archive-sync"]').click();await waitAsync(async()=>(await window.qaApi.pocketArchiveState()).worldbook.lastSyncedAt>0);
 archive=await api(()=>window.qaApi.pocketArchiveState());const archiveName=archive.worldbook.name;const archiveBook=await page.evaluate(name=>window.qa.books[name],archiveName);assert(Object.values(archiveBook.entries).some(x=>x.content.includes('今晚在山頂能看見獵戶座')));assert(Object.values(archiveBook.entries).some(x=>x.content.includes('格式修復書籤')));
 const archiveDownloadPromise=page.waitForEvent('download');await frame.locator('[data-action="me-archive-export"]').click();const archiveDownload=await archiveDownloadPromise;assert(archiveDownload.suggestedFilename().endsWith('.json'));const downloadPath=await archiveDownload.path();const exportedArchive=JSON.parse(await fs.readFile(downloadPath,'utf8'));assert(Object.values(exportedArchive.entries).some(x=>x.content.includes('今晚在山頂能看見獵戶座')));
 checks.push('quiet-memory UI searches and expands records, shows empty results, writes the dedicated worldbook and exports complete JSON through a real browser download');
 await page.setViewportSize({width:390,height:844});await frame.locator('[data-field="me-archive-query"]').fill('獵戶座');await frame.locator('[data-action="me-archive-search"]').click();await frame.locator('details.tp-me-archive-record').first().locator('summary').click();await frame.locator('.toast').waitFor({state:'hidden'});await frame.locator('.tp-me-archive').evaluate(el=>{const view=el.closest('.view');view.scrollTop+=el.getBoundingClientRect().top-view.getBoundingClientRect().top-12;});assert(await frame.locator('.tp-me-archive').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await capture(page.locator('#sttts-panel'),'v08-archive-mobile.png');
 await page.setViewportSize({width:390,height:844});
 await go('storyshop');await frame.locator('.pocket-products').waitFor({state:'visible'});await frame.locator('.pocket-shop-intro').evaluate(el=>{const view=el.closest('.view');view.scrollTop+=el.getBoundingClientRect().top-view.getBoundingClientRect().top-12;});await capture(page.locator('#sttts-panel'),'mobile-shop.png');
 const bounds=await page.locator('#sttts-panel').boundingBox();assert(bounds.width<=390&&bounds.height<=844);
 checks.push('390px viewport keeps phone inside viewport');
 const scopedState=await api(async()=>{const a=window.qaApi;window.qaScopeSnapshot={id:parent.qa.context.chatId,meta:parent.qa.context.chatMetadata,chat:[...parent.qa.context.chat]};const balance=a.wallet().balance;parent.qa.context.chatId='qa-other-conversation';parent.qa.context.chatMetadata={};parent.qa.context.chat.splice(0);await parent.qa.emit('CHAT_CHANGED');await a.pocketAction('sync',{});const s=await a.pocketState(),p=await a.pocketContactProfile('林知夏');return {balance,after:a.wallet().balance,postCount:s.instagram.posts.length,storyCount:s.instagram.stories.length,hydration:p?.fields?.hydration,chatCount:parent.qa.context.chat.length,memory:await a.pocketMemoryState(),archive:await a.pocketArchiveState()};});
 assert.equal(scopedState.memory.profile.name,'夜航旅人');assert.equal(scopedState.memory.profile.penis,'由使用者自行維護');assert(scopedState.memory.abilities.some(x=>x.name==='時間停止能力'));assert(scopedState.memory.items.some(x=>x.name==='急救包'));
 assert.equal(scopedState.archive.count,0);assert.equal(scopedState.postCount,0);assert.equal(scopedState.storyCount,0);assert.notEqual(scopedState.hydration,'93');assert.equal(scopedState.chatCount,0);assert.equal(scopedState.after,scopedState.balance);assert.equal(naiCalls.length,4);
 await api(async()=>{const s=window.qaScopeSnapshot,c=parent.qa.context;c.chatId=s.id;c.chatMetadata=s.meta;c.chat.splice(0,c.chat.length,...s.chat);await parent.qa.emit('CHAT_CHANGED');await window.qaApi.pocketAction('sync',{});});
 assert.equal((await api(()=>window.qaApi.pocketContactProfile('林知夏'))).fields.hydration,'93');assert.equal(await api(()=>window.qaApi.wallet().balance),scopedState.balance);
 checks.push('switching conversations isolates Instagram and edited role status, baselines old native activity/photos without history spam or image calls, and restoring the conversation preserves wallet and status');
 await api(()=>window.qaApi.close());await page.evaluate(async()=>{const m=await import('/scripts/extensions/third-party/tavern-pocket/index.js');await m.disable();await m.enable();});await page.locator('#sttts-floating .orb').waitFor();assert.equal(await page.locator('#sttts-floating').count(),1);await page.locator('#sttts-floating .orb').click();await page.locator('#sttts-panel[open]').waitFor();checks.push('disable/re-enable cleans up and creates one working floating phone');
 await f().evaluate(()=>parent.__stIphoniePanelBridge.connect(window).close());assert.equal(await page.evaluate(()=>typeof window.qa.commands.phone),'function');await page.evaluate(()=>window.qa.commands.phone());await page.locator('#sttts-panel[open]').waitFor();checks.push('/phone slash command opens the same phone');
 const reenabledImageState=await f().evaluate(()=>parent.__stIphoniePanelBridge.connect(window).pocketImageState());
 assert.equal(reenabledImageState.wechat.presetId,importedPreset.id);assert.equal(reenabledImageState.wechat.model,'nai-diffusion-4-full');assert.equal(reenabledImageState.presets.find(p=>p.id===createdPreset.id).name,'水彩午後');
 checks.push('preset content and WeChat model selection survive extension disable/re-enable without repeating already generated photos');
 const beforeReloadBalance=await f().evaluate(()=>parent.__stIphoniePanelBridge.connect(window).wallet().balance);
 await page.reload();await page.locator('#sttts-floating .orb').waitFor();await page.locator('#sttts-floating .orb').click();await page.locator('#sttts-panel[open]').waitFor();frame=await page.locator('#sttts-panel iframe').contentFrame();await frame.locator('[data-app="me"]').first().waitFor();await api(()=>{window.qaApi=parent.__stIphoniePanelBridge.connect(window);});
 const reloadedMemory=await api(()=>window.qaApi.pocketMemoryState());assert.equal(reloadedMemory.profile.name,'夜航旅人');assert.equal(reloadedMemory.profile.age,'24');assert.equal(reloadedMemory.profile.penis,'由使用者自行維護');assert.deepEqual(reloadedMemory.profile.customFields,[{name:'慣用手',value:'右手'}]);assert.equal(reloadedMemory.abilities.filter(x=>x.name==='時間停止能力').length,1);assert.equal(reloadedMemory.items.filter(x=>x.name==='急救包').length,1);assert.equal(await api(()=>window.qaApi.wallet().balance),beforeReloadBalance);assert.equal(naiCalls.length,4);assert((await api(()=>window.qaApi.pocketArchiveState('北極星觀測記錄'))).records.some(x=>x.text.includes('今晚在山頂能看見獵戶座')));
 assert.equal(await page.evaluate(name=>window.qa.books[name].entries['900'].content,memoryBookName),'V07_UNRELATED_ENTRY_MUST_SURVIVE');
 checks.push('personal profile/body/custom fields, acquired items/abilities and the dedicated worldbook survive an actual page reload and conversation changes with no duplicate purchase or historical image generation');
 // v0.9: the main composer references current persistent data before ST creates
 // the user message. This deliberately exercises the real generation event order.
 const referenceSetup=await api(async()=>{const a=window.qaApi;await a.pocketMemoryAction('entry.save',{kind:'abilities',name:'同名星光',description:'V09_WRONG_DUPLICATE：只會照亮指尖。'});await a.pocketMemoryAction('entry.save',{kind:'abilities',name:'同名星光',description:'V09_CHOSEN_ABILITY：照亮整座溫室，限時三分鐘。'});await a.pocketMemoryAction('entry.save',{kind:'items',name:'旅行者的星紋補給箱',description:'V09_CHOSEN_ITEM：內含筆記本與乾糧。',quantity:3});const s=await a.pocketMemoryState();return {ability:s.abilities.find(x=>x.description.includes('V09_CHOSEN_ABILITY')),item:s.items.find(x=>x.description.includes('V09_CHOSEN_ITEM')),wallet:a.wallet().balance,requests:parent.qa.requests.length};});
 await api(()=>window.qaApi.close());await page.locator('#tp-memory-button').waitFor();assert.equal(await page.locator('#tp-memory-button').count(),1);
 await page.locator('#send_textarea').fill('我走近門口，接著離開。');await page.locator('#send_textarea').evaluate(el=>{el.focus();el.setSelectionRange(6,6);});await page.locator('#tp-memory-button').click();await page.locator('#tp-memory-picker').waitFor({state:'visible'});
 await page.locator('[data-tp-memory-tab="abilities"]').click();await page.locator('#tp-memory-search').fill('同名星光');assert.equal(await page.locator('[data-tp-memory-pick^="abilities:"]').count(),2);assert((await page.locator('#tp-memory-results').textContent()).includes('照亮整座溫室'));
 await page.locator(`[data-tp-memory-pick="abilities:${referenceSetup.ability.id}"]`).click();await page.waitForFunction(()=>document.querySelector('#send_textarea').value.includes('@【能力：同名星光'));
 await page.locator('[data-tp-memory-tab="items"]').click();await page.locator('#tp-memory-search').fill('星紋補給');await page.locator(`[data-tp-memory-pick="items:${referenceSetup.item.id}"]`).click();await page.waitForFunction(()=>document.querySelector('#send_textarea').value.includes('@【物品：旅行者'));
 await page.locator('[data-tp-memory-tab="profile"]').click();await page.locator('[data-tp-memory-pick="profile:all"]').click();await page.waitForFunction(()=>document.querySelector('#send_textarea').value.includes('@【資訊：'));
 const pickedDraft=await page.locator('#send_textarea').inputValue();assert(pickedDraft.startsWith('我走近門口，'));assert(pickedDraft.endsWith('接著離開。'));assert.equal((pickedDraft.match(/@【/g)||[]).length,3);assert(await page.locator('#tp-memory-picker').isVisible());
 await page.locator('#tp-memory-search').fill('不存在的資料查詢');await page.locator('.tp-memory-empty').waitFor();await page.locator('#tp-memory-search').fill('');await page.locator('[data-tp-memory-pick="profile:all"]').waitFor();
 const pickerBounds=await page.locator('#tp-memory-picker').boundingBox();assert(pickerBounds.x>=0&&pickerBounds.y>=0&&pickerBounds.x+pickerBounds.width<=390&&pickerBounds.y+pickerBounds.height<=844);assert(await page.locator('#tp-memory-picker').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await capture(page,'v09-composer-picker-mobile.png');
 assert.equal(await api(()=>window.qaApi.wallet().balance),referenceSetup.wallet);assert.equal(await page.evaluate(()=>window.qa.requests.length),referenceSetup.requests);assert.equal(await api(async id=>(await window.qaApi.pocketMemoryState()).items.find(x=>x.id===id)?.quantity,referenceSetup.item.id),3);
 await page.locator('[data-tp-memory-close]').click();
 const beforeReferenceSend=await page.evaluate(()=>window.qa.context.chat.length);await page.evaluate(()=>window.qa.emit('GENERATION_AFTER_COMMANDS','normal',{},false));assert.equal(await page.evaluate(()=>window.qa.context.chat.length),beforeReferenceSend);
 let referencePrompt=await page.evaluate(()=>window.qa.prompts['sttts.entry.references']);assert(referencePrompt.includes('V09_CHOSEN_ABILITY'));assert(referencePrompt.includes('V09_CHOSEN_ITEM'));assert(referencePrompt.includes('夜航旅人'));assert(!referencePrompt.includes('V09_WRONG_DUPLICATE'));
 checks.push('main-input button opens searchable profile/item/ability tabs, distinguishes duplicate names, inserts three references at the saved caret without sending/spending, and fits a 390px viewport');
 checks.push('the first GENERATION_AFTER_COMMANDS event reads unsent composer references before the user message exists and injects only the selected duplicate ability plus current item/profile');
 const referenceMessage=await page.evaluate(text=>window.qa.send(text),pickedDraft);await page.locator('#send_textarea').fill('');const mentionMessage=page.locator(`.mes[mesid="${referenceMessage}"]`);assert.equal(await mentionMessage.locator('.tp-memory-reference').count(),3);assert(!(await mentionMessage.textContent()).includes(referenceSetup.ability.id));assert(await mentionMessage.locator('.mes_text').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 await api(async ids=>{await window.qaApi.pocketMemoryAction('entry.save',{kind:'abilities',id:ids.ability,name:'更新後星光',description:'V09_UPDATED_ABILITY：現在能持續五分鐘。'});await window.qaApi.pocketMemoryAction('entry.delete',{kind:'items',id:ids.item});},{ability:referenceSetup.ability.id,item:referenceSetup.item.id});
 await page.evaluate(()=>window.qa.emit('GENERATION_AFTER_COMMANDS','normal',{},false));referencePrompt=await page.evaluate(()=>window.qa.prompts['sttts.entry.references']);assert(referencePrompt.includes('V09_UPDATED_ABILITY'));assert(referencePrompt.includes('更新後星光'));assert(!referencePrompt.includes('V09_CHOSEN_ABILITY'));assert(!referencePrompt.includes('V09_CHOSEN_ITEM'));assert(/missing|已刪除|不存在|找不到/.test(referencePrompt));assert.equal(await api(()=>window.qaApi.wallet().balance),referenceSetup.wallet);
 checks.push('rendered reference chips survive Showdown paragraph formatting; edits resolve by stable ID to current values and deleted items are reported missing without stale ownership or wallet effects');
 const encodedReferenceMessage=await page.evaluate(async()=>{const {createMemoryMention}=await import('/scripts/extensions/third-party/tavern-pocket/pocket/mentions.js');const candidate={kind:'items',id:'ffffffff-ffff-4fff-bfff-ffffffffffff',name:'<img src=x> &amp; **藥箱**｜特製',description:'字面文字測試'},state={persona:'你',profile:{name:'你'},items:[candidate],abilities:[]};const token=createMemoryMention(state,{...candidate,title:candidate.name,key:'items:'+candidate.id});return window.qa.incoming([{id:'v09-nested-encoded-reference',app:'wechat',action:'message',from:'林知夏',to:'你',text:'看看這件 '+token+'。'}]);});const encodedReferenceCard=page.locator(`.mes[mesid="${encodedReferenceMessage}"] .tp-story-wechat`);assert.equal(await encodedReferenceCard.locator('.tp-memory-reference-items').count(),1);assert.equal(await encodedReferenceCard.locator('img').count(),0);const encodedReferenceText=await encodedReferenceCard.textContent();assert(encodedReferenceText.includes('<img src=x> &amp; **藥箱**｜特製'));assert(!encodedReferenceText.includes('@【'));assert(!encodedReferenceText.includes('ffffffff'));
 checks.push('a compact UUID containing underscores renders as a nested reference chip inside a WeChat card under Showdown while literal HTML/entities/Markdown in the asset label remain harmless text');
 await page.evaluate(async()=>{window.qa.context.name1='另一位旅人';await window.qa.emit('CHAT_CHANGED');});await page.locator('#tp-memory-button').click();await page.locator('[data-tp-memory-tab="abilities"]').click();await page.locator('#tp-memory-search').fill('星光');await page.locator('.tp-memory-empty').waitFor();assert((await page.locator('#tp-memory-owner').textContent()).includes('另一位旅人'));await page.locator('[data-tp-memory-close]').click();await page.evaluate(()=>window.qa.emit('GENERATION_AFTER_COMMANDS','normal',{},false));referencePrompt=await page.evaluate(()=>window.qa.prompts['sttts.entry.references']);assert(/other-persona|其他|另一/.test(referencePrompt));assert(!referencePrompt.includes('V09_UPDATED_ABILITY'));assert(!referencePrompt.includes('黑髮、深色眼睛'));await page.evaluate(async()=>{window.qa.context.name1='你';await window.qa.emit('CHAT_CHANGED');});
 checks.push('switching personas immediately refreshes the picker and rejects references owned by the prior persona without leaking its profile or ability description');
 // IME Enter must not choose an item; ordinary keyboard selection remains available.
 await page.locator('#send_textarea').fill('@更新後星光');await page.locator('#tp-memory-picker').waitFor({state:'visible'});await page.locator(`[data-tp-memory-pick="abilities:${referenceSetup.ability.id}"]`).waitFor();
 await page.locator('#send_textarea').evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'光'}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));});assert.equal(await page.locator('#send_textarea').inputValue(),'@更新後星光');await page.locator('#send_textarea').evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'光'})));await page.locator('#send_textarea').press('Enter');await page.waitForFunction(()=>document.querySelector('#send_textarea').value.startsWith('@【能力：更新後星光'));await page.locator('#tp-memory-picker').waitFor({state:'hidden'});await page.locator('#send_textarea').fill('');
 checks.push('optional @ keyboard completion resolves the selected ability and does not consume Enter during Chinese IME composition');
 await page.locator('#send_textarea').fill('聊天切換時保留這份草稿。');await page.locator('#tp-memory-button').click();await page.locator('#tp-memory-picker').waitFor({state:'visible'});await page.evaluate(()=>window.qa.emit('CHAT_CHANGED'));await page.locator('#tp-memory-picker').waitFor({state:'hidden'});assert.equal(await page.locator('#send_textarea').inputValue(),'聊天切換時保留這份草稿。');await page.locator('#send_textarea').fill('');
 checks.push('CHAT_CHANGED closes an open memory picker without inserting a stale selection or modifying the user draft');
 // A disabled forum mirror stays an archive even after the user enables new cards.
 await api(async()=>{const a=window.qaApi;await a.pocketAction('settings.save',{...(await a.pocketState()).settings,mirrorForum:false});await a.postForum({title:'V09 舊的安靜記憶',text:'V09_QUIET_ONLY：只保存在論壇記憶。'});await a.pocketAction('sync',{});await a.pocketAction('settings.save',{...(await a.pocketState()).settings,mirrorForum:true});await a.postForum({title:'V09 新的論壇卡片',text:'V09_VISIBLE_FORUM：啟用後的這則需要顯示。'});await a.pocketAction('sync',{});});
 assert(!await page.evaluate(()=>window.qa.context.chat.some(m=>m.extra?.tavern_pocket_activity&&m.mes.includes('V09_QUIET_ONLY'))));assert(await page.evaluate(()=>window.qa.context.chat.some(m=>m.extra?.tavern_pocket_activity&&m.mes.includes('V09_VISIBLE_FORUM'))));assert((await api(()=>window.qaApi.pocketArchiveState())).records.some(x=>x.text.includes('V09_QUIET_ONLY')));
 checks.push('turning forum mirroring off archives new records quietly; turning it back on shows subsequent posts without replaying the prior quiet record');
 // Fresh native actions share one clean card batch. Catalogue browsing itself is silent.
 await page.evaluate(()=>window.qa.incomingRaw('我在窗邊整理手機裡的消息與剛買好的補給。'));
 const visualActivity=await api(async()=>{const a=window.qaApi;await a.pocketAction('shop.save',{name:'旅人的星空防水筆記本與補給套裝',description:'方便旅途攜帶的日常文具與補給。',price:7,kind:'items'});const product=(await a.pocketState()).catalogue.find(x=>x.name==='旅人的星空防水筆記本與補給套裝'),before=a.wallet().balance,thread=(await a.listThreads()).find(x=>x.type==='dm');await a.appendChat(thread.id,[{from:'me',kind:'text',text:'知夏，補給買好了，我們下午出發。'},{from:'林知夏',kind:'text',text:'收到！我在咖啡館門口等你。'}]);const post=await a.postForum({title:'週末山徑觀星與溫室散步的行程',text:'記得帶上外套、筆記本和你的好心情。'});await a.replyForum(post.id,{text:'我會帶熱茶，一起出發吧。'});await a.pocketPurchase(product,'v09-visual-order');await a.pocketAction('sync',{});return {before,after:a.wallet().balance};});
 assert.equal(visualActivity.after,Math.round((visualActivity.before-7)*100)/100);const visualMirrorId=await page.evaluate(()=>window.qa.context.chat.findLastIndex(m=>m.extra?.tavern_pocket_activity&&m.mes.includes('旅人的星空防水筆記本與補給套裝')));assert(visualMirrorId>=0);const visualMirror=page.locator(`.mes[mesid="${visualMirrorId}"]`);assert(await visualMirror.locator('.tp-story-receipt').count());assert(await visualMirror.locator('.tp-story-forum').count());assert(await visualMirror.locator('.tp-story-wechat').count());
 assert(await visualMirror.locator('.mes_text').evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert.equal(await visualMirror.locator('.tp-story-card').evaluateAll(els=>els.filter(el=>el.scrollWidth>el.clientWidth+1).length),0);await capture(visualMirror,'v09-mixed-cards-mobile.png');
 const visualMirrorCount=await page.evaluate(()=>window.qa.context.chat.filter(m=>m.extra?.tavern_pocket_activity&&m.mes.includes('旅人的星空防水筆記本與補給套裝')).length);await api(()=>window.qaApi.pocketAction('sync',{}));assert.equal(await page.evaluate(()=>window.qa.context.chat.filter(m=>m.extra?.tavern_pocket_activity&&m.mes.includes('旅人的星空防水筆記本與補給套裝')).length),visualMirrorCount);assert.equal(await api(()=>window.qaApi.wallet().balance),visualActivity.after);
 checks.push('390px Showdown-rendered native batch presents incoming/outgoing WeChat, forum post/reply and one confirmed shop receipt without horizontal overflow, duplicate mirrors or duplicate payment');
 // User-authored shop presets affect a subsequent request; managing them does not call a model.
 await page.locator('#sttts-floating .orb').click();await page.locator('#sttts-panel[open]').waitFor();await go('storyshop');const presetCalls=await page.evaluate(()=>window.qa.requests.length);await frame.locator('[data-action="shop-presets"]').click();await frame.locator('[data-action="shop-preset-new"]').click();await frame.locator('[data-field="shop-preset-name"]').fill('旅程補給');await frame.locator('[data-field="shop-preset-prompt"]').fill('V09_CUSTOM_PRESET：優先提供旅途中的日用品，詳細描述收納方式。');await frame.locator('[data-action="shop-preset-save"]').click();const newShopPreset=await waitAsync(async()=>{const s=(await window.qaApi.pocketState()).shopPresets;return s?.presets.find(x=>x.name==='旅程補給');});assert.equal(await page.evaluate(()=>window.qa.requests.length),presetCalls);assert.equal((await api(()=>window.qaApi.pocketState())).shopPresets.selectedId,newShopPreset.id);
 await frame.locator('[data-sheet-close]').click();await api(()=>{parent.qa.nextResponse=JSON.stringify({items:[{name:'折疊旅行收納袋',description:'輕便，可放入外套口袋。',price:6}]});});await frame.locator('[data-action="shop-generate"]').click();await waitAsync(async()=>(await window.qaApi.pocketState()).catalogue.some(x=>x.name==='折疊旅行收納袋'));assert((await page.evaluate(()=>window.qa.requests.at(-1).prompt)).includes('V09_CUSTOM_PRESET'));
 await frame.locator('[data-action="shop-presets"]').click();const importCalls=await page.evaluate(()=>window.qa.requests.length);await frame.locator('[data-shop-preset-import]').setInputFiles({name:'V09_Imported_ST_Preset.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({name:'匯入的旅行預設',prompts:[{identifier:'enabled',content:'V09_IMPORTED_PRESET：商品附上旅行用途。'},{identifier:'disabled',content:'V09_DISABLED_PRESET_MUST_NOT_APPEAR'}],prompt_order:[{character_id:100001,order:[{identifier:'disabled',enabled:false},{identifier:'enabled',enabled:true}]}]}))});const importedShopPreset=await waitAsync(async()=>(await window.qaApi.pocketState()).shopPresets.presets.find(x=>x.name==='匯入的旅行預設'));assert.equal(await page.evaluate(()=>window.qa.requests.length),importCalls);assert(importedShopPreset.prompt.includes('V09_IMPORTED_PRESET'));assert(!importedShopPreset.prompt.includes('V09_DISABLED_PRESET'));
 await frame.locator('[data-sheet-close]').click();await frame.locator('[data-field="shop-preset"]').selectOption(importedShopPreset.id);await api(()=>{parent.qa.nextResponse=JSON.stringify({items:[{name:'旅行用輕便水壺',description:'有防漏瓶蓋。',price:9}]});});await frame.locator('[data-action="shop-generate"]').click();await waitAsync(async()=>(await window.qaApi.pocketState()).catalogue.some(x=>x.name==='旅行用輕便水壺'));const importedPresetPrompt=await page.evaluate(()=>window.qa.requests.at(-1).prompt);assert(importedPresetPrompt.includes('V09_IMPORTED_PRESET'));assert(!importedPresetPrompt.includes('V09_DISABLED_PRESET'));checks.push('shop preset manager creates and imports real JSON files without model calls, selects the saved preset, respects disabled ST prompt-order segments and includes only active custom text in subsequent product generation');
 // Search must reach entries beyond the old 500-entry cap and the end of a long chapter.
 const worldbookCalls=await page.evaluate(()=>window.qa.requests.length);await page.evaluate(()=>{const entries={};for(let i=0;i<650;i++)entries[i]={uid:i,comment:'旅行備忘 '+i,key:['旅行備忘'],content:'這是一份旅途備忘，記載各地景色與生活習俗。'.repeat(20),disable:false};entries[649]={uid:649,comment:'長篇航行日誌',key:['V09_DEEP_LORE'],content:'沿途的天氣與海色均已記錄。'.repeat(1000)+'V09_DEEP_LORE：極光之門位於第六百四十九號航標。',disable:false};window.qa.books['V09 大型世界書']={entries};for(let i=0;i<8;i++)window.qa.books['V09 附錄 '+i]={entries:{0:{uid:0,comment:'附錄',content:'第 '+i+' 份已啟用的旅行附錄。',disable:false}}};});
 const largeBooks=['V09 大型世界書',...Array.from({length:8},(_,i)=>'V09 附錄 '+i)];await api(async books=>{const a=window.qaApi;await a.pocketAction('settings.save',{...(await a.pocketState()).settings,worldbooks:books});},largeBooks);await go('pocketsettings');assert.equal(await frame.locator('[data-worldbook]:checked').count(),9);await frame.locator('[data-action="worldbooks-browse"]').click();await frame.locator('[data-lore-query]').fill('V09_DEEP_LORE');await frame.locator('[data-lore-form] button[type="submit"]').click();await frame.locator('.pocket-lore-open strong').filter({hasText:'長篇航行日誌'}).waitFor();assert((await frame.locator('.pocket-lore-counts').textContent()).includes('658'));assert((await frame.locator('.pocket-lore-results').textContent()).includes('長篇航行日誌'));await frame.locator('[data-lore-action="read"]').first().click();await frame.locator('.pocket-lore-content').waitFor();assert(!(await frame.locator('.pocket-lore-content').textContent()).includes('V09_DEEP_LORE'));await frame.locator('[data-lore-action="read-next"]').click();await page.waitForFunction(()=>{const doc=document.querySelector('#sttts-panel iframe')?.contentDocument;return doc?.querySelector('.pocket-lore-content')?.textContent.includes('V09_DEEP_LORE');});await frame.locator('[data-lore-action="pin-reading"]').click();await frame.locator('[data-lore-action="pin-reading"][aria-pressed="true"]').waitFor();assert(await frame.locator('.pocket-lore-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await capture(page.locator('#sttts-panel'),'v09-worldbook-reader-mobile.png');await frame.locator('[data-sheet-close]').click();await frame.locator('[data-action="settings-save"]').click();await waitAsync(async()=>(await window.qaApi.pocketState()).settings.worldbookPins.some(x=>x.book==='V09 大型世界書'&&x.entryId==='649'));assert.equal(await page.evaluate(()=>window.qa.requests.length),worldbookCalls);
 await api(async()=>{parent.qa.nextResponse='林知夏：極光之門位於第六百四十九號航標。';const thread=(await window.qaApi.listThreads()).find(x=>x.type==='dm');await window.qaApi.appendChat(thread.id,[{from:'me',kind:'text',text:'V09_DEEP_LORE 裡的極光之門在哪裡？'}]);await window.qaApi.chatReply(thread.id);});const deepLorePrompt=await page.evaluate(()=>window.qa.requests.at(-1).prompt);assert(deepLorePrompt.includes('V09_DEEP_LORE：極光之門位於第六百四十九號航標'));
 checks.push('phone settings accept nine books, browse all 658 enabled entries, search past entry 500, read and pin the end of a 12k+ chapter without calling a model, and retrieve that late passage into a subsequent phone-model request');
 // Locking suspends the visible-view queue. Unlocking must flush the saved
 // dirty event itself, without requiring another chat or settings event.
 const lockThread=await api(async()=>(await window.qaApi.listThreads()).find(x=>x.type==='dm'&&x.members.includes('林知夏')));
 assert(lockThread);await go('chat');
 if(await frame.locator('.composer').isVisible())await frame.locator('.app-nav [data-system="back"]').click();
 await frame.locator(`.conv[data-id="${lockThread.id}"]`).click();await frame.locator('.composer').waitFor();
 await frame.locator('.pull-tab[data-system="control"]').click();await frame.locator('.sheet [data-system="power"]').click();
 await frame.locator('.lockscreen').waitFor({state:'visible'});
 await api(id=>window.qaApi.appendChat(id,[{from:'林知夏',kind:'text',text:'V11_UNLOCK_RESUME：鎖屏期間的新訊息'}]),lockThread.id);
 assert.equal(await frame.locator('.chat-bubble').filter({hasText:'V11_UNLOCK_RESUME'}).count(),0);
 await frame.locator('.lockscreen [data-system="unlock"]').first().click();await frame.locator('.lockscreen').waitFor({state:'hidden'});
 await frame.locator('.chat-bubble').filter({hasText:'V11_UNLOCK_RESUME'}).waitFor({state:'visible'});
 checks.push('locking defers a real incoming chat update; unlocking alone resumes the pending render and immediately shows the saved message without a later event');
 assert.deepEqual(errors,[]);
 assert.equal(naiCalls.length,4);
 const report={passed:checks.length,checks,mockedNovelAIRequests:naiCalls.length,browser:await browser.version(),pageErrors:errors,host:'mock SillyTavern 1.19 APIs, original host+iframe, real Chromium IndexedDB, Showdown 2.1.0 paragraph fixture (not full ST formatting pipeline), deterministic model fixture'};
 await fs.writeFile(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){await fs.writeFile(path.join(out,'browser-report.json'),JSON.stringify({passed:false,completed:checks.length,checks,error:String(error.stack||error),mockedNovelAIRequests:naiCalls.length,pageErrors:errors},null,2));console.error('CHECKS_COMPLETED',checks.length,checks.at(-1));if(page){await capture(page,'failure.png').catch(()=>{});console.error('NOTICES',await page.evaluate(()=>window.qa?.notices).catch(()=>[]));console.error('PAGE_ERRORS',errors);console.error('EDITOR_ERRORS',await page.frames().find(x=>x.url().endsWith('/ui/index.html'))?.locator('[data-photo-editor-error]').allTextContents());console.error('NAI_CALL_COUNT',naiCalls.length);console.error('UI_STATE',await page.frames().find(x=>x.url().endsWith('/ui/index.html'))?.evaluate(async()=>{const s=await window.qaApi.pocketState();return {query:document.querySelector('[data-field=shop-query]')?.value,working:document.querySelectorAll('.pocket-working').length,toasts:[...document.querySelectorAll('.toast')].map(x=>x.textContent),source:s.catalogueSource,products:s.catalogue.map(x=>({name:x.name,price:x.price})),nextResponse:parent.qa.nextResponse,requests:parent.qa.requests.slice(-2).map(x=>({profileId:x.profileId,prompt:x.prompt.slice(0,800)}))};}).catch(()=>null));}throw error;
}finally{clearInterval(progress);await browser?.close();await new Promise(resolve=>server.close(resolve));}
