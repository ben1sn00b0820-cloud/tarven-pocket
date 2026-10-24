/** CSB + Tavern Pocket browser integration. Real extension/iframe/IndexedDB;
 * only SillyTavern host and model response are mocked. No paid API requests.
 * TP_CHROMIUM_PATH=/path/to/chromium node tests/browser-csb.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
let playwright;try{playwright=require('playwright');}catch{playwright=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'','playwright'));}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'), prefix='/scripts/extensions/third-party/tavern-pocket';
const out=path.join(root,'tests/artifacts');await fs.mkdir(out,{recursive:true});
const mime={'.html':'text/html;charset=utf-8','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{
 let p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(p==='/scripts/personas.js'){res.setHeader('Content-Type','application/javascript');res.end('export const user_avatar="";');return;}
 if(p==='/scripts/world-info.js'){res.setHeader('Content-Type','application/javascript');res.end('export const selected_world_info=[];export const world_info={charLore:[]};export async function checkWorldInfo(){return {allActivatedEntries:[]};}');return;}
 if(p==='/version'){res.setHeader('Content-Type','application/json');res.end('{"pkgVersion":"1.19.0"}');return;}
 if(p==='/tests/avatar.svg'){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#a9cfbf"/></svg>');return;}
 if(p.startsWith(prefix+'/'))p=p.slice(prefix.length);
 const file=path.resolve(root,'.'+p);if(!file.startsWith(root+path.sep))throw Error('path');const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(bytes);
}catch{res.writeHead(404);res.end('not found');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser,page;const checks=[],errors=[];
try{
 browser=await playwright.chromium.launch({headless:true,executablePath:process.env.TP_CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--use-gl=angle','--use-angle=swiftshader']});
 page=await browser.newPage({viewport:{width:1280,height:1000},deviceScaleFactor:1,hasTouch:true});page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/tests/mock-host.html`);
 await page.locator('#sttts-floating .orb').waitFor();
 await page.waitForFunction(()=>!!globalThis.CSBCharacterState?.getSnapshot);
 assert.equal(await page.locator('#csb-launcher').count(),1);
 checks.push('bundled CSB initializes once alongside the actual phone host');
 await page.evaluate(async()=>{
  const base='/scripts/extensions/third-party/tavern-pocket/companions/csb-character-state';
  const {newDatabase,field,defaultSettings}=await import(`${base}/src/schema.js`);
  const c=qa.context,db=newDatabase();
  db.schema.groups.push({id:'custom',label:'自訂角色資訊',icon:'◇',layout:'grid',collapsed:false});
  db.schema.fields.push(
   field('spirit','靈力','custom','bar',{min:-50,max:250,unit:'點',thresholds:[{at:0,label:'初醒'},{at:50,label:'凝聚'}]}),
   field('oath','已立誓','custom','boolean'),
   field('unknown','未設定能力','custom','text'),
   field('counter','剩餘次數','custom','number',{min:0,max:100}),
   field('hiddenMemory','停用的秘密','custom','text',{hidden:true}),
   field('extraAppearance','特殊外觀','body','text'),
   field('literal','標記測試','custom','text')
  );
  db.seed.characters.c_xia={id:'c_xia',name:'林知夏',aliases:['知夏'],present:true,values:{age:'26',height:168,weight:52,identity:'咖啡館友人',mood:'平靜',spirit:25,oath:false,unknown:null,counter:0,hiddenMemory:'HIDDEN_CSB_SENTINEL_872',extraAppearance:'左手有一枚銀色戒指',literal:'<img src=x onerror="window.csbXss=1">'}};
  db.seed.scene={time:'初秋午後',location:'咖啡館'};
  c.extensionSettings.csb_character_state_v1={...defaultSettings(),inlineCards:true};
  c.chatMetadata.csb_character_state_v1=db;
  await qa.emit('CHAT_CHANGED');
 });
 await page.locator('#sttts-floating .orb').click();
 await page.locator('#sttts-panel[open]').waitFor();
 const f=()=>page.frames().find(frame=>frame.url().endsWith('/ui/index.html'));
 await page.waitForFunction(()=>document.querySelector('#sttts-panel iframe')?.contentWindow?.document?.querySelector('[data-app="instagram"]'));
 const api=(fn,arg)=>f().evaluate(fn,arg);
 await api(()=>{window.qaApi=parent.__stIphoniePanelBridge.connect(window);});
 const waitProfile=async predicate=>{
  const deadline=Date.now()+12000;let record;
  do{record=await api(()=>window.qaApi.pocketContactProfile('林知夏'));if(predicate(record))return record;await new Promise(resolve=>setTimeout(resolve,70));}while(Date.now()<deadline);
  throw Error('CSB projection did not settle: '+JSON.stringify(record));
 };
 let profile=await waitProfile(r=>r?.csb?.values?.spirit===25);
 assert.equal(profile.csb.values.oath,false);assert.equal(profile.csb.values.counter,0);assert.equal(profile.csb.values.unknown,null);
 assert(!JSON.stringify(profile.csb).includes('HIDDEN_CSB_SENTINEL_872'));
 assert(profile.body.some(x=>x.value==='左手有一枚銀色戒指'));
 checks.push('phone profiles preserve custom types, 0/false/null, body facts and exclude hidden fields');
 const snapshotIsolation=await page.evaluate(()=>{const a=CSBCharacterState.getSnapshot();a.state.characters.c_xia.values.spirit=999;return CSBCharacterState.getSnapshot().state.characters.c_xia.values.spirit;});
 assert.equal(snapshotIsolation,25);
 checks.push('public snapshot is detached from persisted character state');
 await f().locator('.home-page .app-icon[data-app="roles"]').evaluate(el=>el.closest('.home-page')?.scrollIntoView({behavior:'instant',block:'nearest',inline:'start'}));
 await f().locator('.home-page .app-icon[data-app="roles"]').tap();
 await f().locator('.view[data-app="roles"]').waitFor({state:'visible'});
 await f().waitForFunction(()=>!document.querySelector('.screen')?.hasAttribute('data-opening'));
 await f().locator('[data-action="status-directory"]').click();
 await f().locator('[data-status-name="林知夏"]').click();
 const detail=f().locator('.sheet-body');
 await detail.getByText('靈力',{exact:true}).waitFor();
 const meter=detail.getByRole('progressbar',{name:'靈力',exact:true});
 assert.equal(await meter.getAttribute('aria-valuemin'),'-50');assert.equal(await meter.getAttribute('aria-valuemax'),'250');assert.equal(await meter.getAttribute('aria-valuenow'),'25');
 assert((await detail.textContent()).includes('自訂角色資訊'));
 assert((await detail.textContent()).includes('否'));
 assert.equal(await detail.locator('img[src="x"]').count(),0);
 assert.equal(await api(()=>window.csbXss||0),0);
 await page.screenshot({path:path.join(out,'csb-phone-custom-fields.png'),animations:'disabled'});
 checks.push('real phone detail sheet renders arbitrary bar range, custom fields and safely escaped text');
 await f().locator('[data-sheet-close]').click();
 const mixedIndex=await page.evaluate(async()=>{
  const update={version:1,scene:{time:'午後三點'},present:['c_xia'],characters:[{id:'c_xia',set:{spirit:50},reason:'完成一輪呼吸練習'}]};
  const phone={id:'csb-mixed-phone',app:'wechat',action:'message',from:'林知夏',to:'你',text:'我剛練習完，等你一起喝茶。'};
  return qa.incomingRaw('她放下書，拿起手機。\n<phone>'+JSON.stringify(phone)+'</phone>\n<CSB_UPDATE>'+JSON.stringify(update)+'</CSB_UPDATE>');
 });
 await waitProfile(r=>r?.csb?.values?.spirit===50);
 await page.locator(`.mes[mesid="${mixedIndex}"] .csb-message-card`).waitFor();
 await page.locator(`.mes[mesid="${mixedIndex}"] [data-tp-card="csb-mixed-phone"]`).waitFor();
 assert(!(await page.locator(`.mes[mesid="${mixedIndex}"] .mes_text`).textContent()).includes('<CSB_UPDATE>'));
 checks.push('one narrative message retains phone event card and CSB status card while hiding machine update JSON');
 await f().locator('[data-action="status-directory"]').click();
 await f().locator('[data-status-name="林知夏"]').click();
 await f().locator('[data-action="status-edit"]').click();
 const editor=page.getByRole('dialog',{name:'編輯角色',exact:true});await editor.waitFor();
 await editor.getByLabel('靈力 · 點',{exact:true}).fill('75');
 await editor.getByRole('button',{name:'儲存角色',exact:true}).click();
 profile=await waitProfile(r=>r?.csb?.values?.spirit===75);
 const manualCount=await page.evaluate(()=>qa.context.chatMetadata.csb_character_state_v1.manual.length);
 assert.equal(manualCount,1);
 assert.equal(await page.evaluate(()=>qa.context.chat.length),mixedIndex+1);
 checks.push('phone editor opens native CSB editor; save updates source manual journal without adding legacy chat snapshots');
 for(const dialog of await page.locator('dialog.csb-dialog').all())if(await dialog.isVisible())await dialog.getByRole('button',{name:'關閉',exact:true}).first().click();
 const promptText=await api(async()=>{
  const t=await window.qaApi.createThread({type:'dm',members:['林知夏']});
  parent.qa.nextResponse='林知夏：練習完了，我在窗邊等你。';
  await window.qaApi.chatReply(t.id);
  return parent.qa.requests.at(-1).prompt;
 });
 assert(promptText.includes('靈力'));assert(promptText.includes('75'));assert(!promptText.includes('HIDDEN_CSB_SENTINEL_872'));
 checks.push('WeChat model request receives latest CSB custom values and omits disabled fields');
 const oldRevision=profile.revision;
 await page.evaluate(async index=>{
  const c=qa.context,m=c.chat[index];m.swipe_id=1;
  m.mes='<CSB_UPDATE>'+JSON.stringify({version:1,scene:{time:'次日清晨',location:'書院'},characters:[{id:'c_xia',set:{spirit:125},reason:'本次分支完成進階修練'}]})+'</CSB_UPDATE>';
  c.updateMessageBlock(index,m);await qa.emit('MESSAGE_SWIPED',index);
 },mixedIndex);
 await waitProfile(r=>r?.csb?.values?.spirit===75&&r.time==='次日清晨');
 const stale=await api(async revision=>{try{await window.qaApi.pocketOpenContactState('林知夏',revision);return false;}catch{return true;}},oldRevision);
 assert(stale);
 checks.push('swipe replays branch scene time while durable character information survives and stale phone editor revisions are rejected');
 await page.evaluate(async index=>{qa.context.chat.splice(index,1);document.querySelector(`.mes[mesid="${index}"]`)?.remove();await qa.emit('MESSAGE_DELETED',index);},mixedIndex);
 await waitProfile(r=>r?.csb?.values?.spirit===75&&r.time==='初秋午後');
 checks.push('deleting the update reverts story scene time while preserving the saved character information');
 await page.evaluate(async()=>{window.csbSavedScope={chat:qa.context.chat,metadata:qa.context.chatMetadata,chatId:qa.context.chatId};qa.context.chat=[];qa.context.chatMetadata={};qa.context.chatId='csb-other-chat';await qa.emit('CHAT_CHANGED');});
 const other=await api(()=>window.qaApi.pocketContactProfile('林知夏'));
 assert(!other?.csb);assert(!JSON.stringify(other).includes('靈力'));
 checks.push('switching to a different chat does not expose the previous chat CSB values');
 await page.evaluate(async()=>{const c=qa.context;c.chat=csbSavedScope.chat;c.chatMetadata=csbSavedScope.metadata;c.chatId=csbSavedScope.chatId;c.extensionSettings.csb_character_state_v1.enabled=false;await qa.emit('CHAT_CHANGED');await globalThis.stIphonieInterceptor(c.chat,8192,()=>{},'normal');});
 assert(!(await api(()=>window.qaApi.pocketContactProfile('林知夏')))?.csb);
 assert.equal(await page.evaluate(()=>qa.prompts.csb_character_state_v1||''),'');
 checks.push('disabled CSB contributes neither profile projection nor generation instructions');
 // A separately installed CSB 1.0.0 exposes only its interceptor and formats
 // messages directly. Simulate that actual legacy contract in a fresh context.
 await browser.close();
 browser=await playwright.chromium.launch({headless:true,executablePath:process.env.TP_CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--use-gl=angle','--use-angle=swiftshader']});
 const externalPage=await browser.newPage({viewport:{width:1280,height:1000},deviceScaleFactor:1});page=externalPage;
 externalPage.setDefaultTimeout(12000);externalPage.on('pageerror',e=>errors.push(e.message));
 await externalPage.addInitScript(()=>{globalThis.csbCharacterStateIntercept=function(){};});
 await externalPage.goto(`http://127.0.0.1:${server.address().port}/tests/mock-host.html`);
 await externalPage.locator('#sttts-floating .orb').waitFor();
 assert.equal(await externalPage.locator('#csb-launcher').count(),0);
 assert.equal(await externalPage.evaluate(()=>!!globalThis.CSBCharacterState),false);
 const legacyIndex=await externalPage.evaluate(async()=>{
  const {newDatabase,defaultSettings}=await import('/scripts/extensions/third-party/tavern-pocket/companions/csb-character-state/src/schema.js');
  const c=qa.context,db=newDatabase();db.seed.characters.c_xia={id:'c_xia',name:'林知夏',aliases:[],present:true,values:{energy:10}};
  c.chatMetadata.csb_character_state_v1=db;c.extensionSettings.csb_character_state_v1=defaultSettings();
  await qa.emit('CHAT_CHANGED');
  const phone={id:'external-csb-phone',app:'wechat',action:'message',from:'林知夏',to:'你',text:'休息好了，出發吧。'};
  const update={version:1,characters:[{id:'c_xia',set:{energy:80},reason:'休息後恢復'}]};
  window.csbLegacyRaw='她收好水壺。\n<phone>'+JSON.stringify(phone)+'</phone>\n<CSB_UPDATE>'+JSON.stringify(update)+'</CSB_UPDATE>';
  return qa.incomingRaw(window.csbLegacyRaw);
 });
 for(let pass=0;pass<2;pass++){
  await externalPage.evaluate(index=>{
   const c=qa.context,m=c.chat[index],message=document.querySelector(`.mes[mesid="${index}"]`),box=message.querySelector('.mes_text');
   const cleaned=m.mes.replace(/<CSB_UPDATE>[\s\S]*?<\/CSB_UPDATE>/g,'').trimEnd();
   box.innerHTML=c.messageFormatting(cleaned,m.name,m.is_system,m.is_user,index,{},false);box.dataset.csbCleaned='true';
   if(!message.querySelector('.csb-message-card')){const status=document.createElement('div');status.className='csb-message-card';status.textContent='原版 CSB 狀態卡';box.after(status);}
  },legacyIndex);
  await externalPage.locator(`.mes[mesid="${legacyIndex}"] [data-tp-card="external-csb-phone"]`).waitFor();
 }
 assert.equal(await externalPage.locator(`.mes[mesid="${legacyIndex}"] .csb-message-card`).count(),1);
 assert.equal(await externalPage.evaluate(index=>qa.context.chat[index].mes===window.csbLegacyRaw,legacyIndex),true);
 assert(!(await externalPage.locator(`.mes[mesid="${legacyIndex}"] .mes_text`).textContent()).includes('<CSB_UPDATE>'));
 checks.push('external CSB 1.0.0 skips bundled runtime and repeated direct reformatting restores phone cards without altering raw messages or native status cards');
 await externalPage.locator('#sttts-floating .orb').click();
 await externalPage.locator('#sttts-panel[open]').waitFor();
 await externalPage.waitForFunction(()=>document.querySelector('#sttts-panel iframe')?.contentWindow?.document?.querySelector('[data-app="instagram"]'));
 const externalFrame=externalPage.frames().find(frame=>frame.url().endsWith('/ui/index.html'));
 const fallback=await externalFrame.evaluate(async()=>{
  const c=parent.qa.context,before=JSON.stringify(c.chatMetadata.csb_character_state_v1),api=parent.__stIphoniePanelBridge.connect(window);
  const profile=await api.pocketContactProfile('林知夏');return {energy:profile.csb?.values.energy,unchanged:before===JSON.stringify(c.chatMetadata.csb_character_state_v1)};
 });
 assert.equal(fallback.energy,80);assert.equal(fallback.unchanged,true);
 checks.push('legacy CSB metadata fallback replays the newest update without mutating its source journal');
 await externalPage.close();
 assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(out,'browser-csb-report.json'),JSON.stringify({version:JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8')).version,checks,errors,status:'passed',limitations:'SillyTavern APIs and model responses mocked; actual phone host, iframe, CSB runtime and IndexedDB exercised.'},null,2));
 console.log(JSON.stringify({status:'passed',checks:checks.length,errors},null,2));
}catch(error){
 if(page)await page.screenshot({path:path.join(out,'csb-failure.png'),animations:'disabled'}).catch(()=>{});
 await fs.writeFile(path.join(out,'browser-csb-report.json'),JSON.stringify({status:'failed',checks,errors,failure:error.stack},null,2));
 console.error(error);process.exitCode=1;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
