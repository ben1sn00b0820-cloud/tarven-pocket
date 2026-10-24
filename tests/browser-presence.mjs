/** Actual phone entry/iframe + bundled CSB presence integration.
 * Only SillyTavern/model APIs are local fixtures; no external requests. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
let playwright;try{playwright=require('playwright');}catch{playwright=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'','playwright'));}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),prefix='/scripts/extensions/third-party/tavern-pocket';
const mime={'.html':'text/html;charset=utf-8','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{
 let p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(p==='/scripts/personas.js'){res.setHeader('Content-Type','application/javascript');res.end('export const user_avatar="";');return;}
 if(p==='/scripts/world-info.js'){res.setHeader('Content-Type','application/javascript');res.end('export const selected_world_info=[];export const world_info={charLore:[]};export async function checkWorldInfo(){return {allActivatedEntries:[]};}');return;}
 if(p==='/version'){res.setHeader('Content-Type','application/json');res.end('{"pkgVersion":"1.19.0"}');return;}
 if(p==='/tests/avatar.svg'){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#9aab8c"/></svg>');return;}
 if(p.startsWith(prefix+'/'))p=p.slice(prefix.length);
 const file=path.resolve(root,'.'+p);if(!file.startsWith(root+path.sep))throw Error('path');
 const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(bytes);
}catch{res.writeHead(404);res.end('not found');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser,page;const checks=[],errors=[],external=[];
try{
 browser=await playwright.chromium.launch({headless:true,executablePath:process.env.TP_CHROMIUM_PATH||'/tmp/moxu-chromium',args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--use-gl=angle','--use-angle=swiftshader']});
 page=await browser.newPage({viewport:{width:430,height:932},hasTouch:true,isMobile:true,reducedMotion:'reduce'});page.setDefaultTimeout(12000);
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:'))external.push(request.url());});
 const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS',name);};
 await page.goto(`http://127.0.0.1:${server.address().port}/tests/mock-host.html`);
 await page.locator('#sttts-floating .orb').waitFor();await page.waitForFunction(()=>typeof CSBCharacterState?.setPresence==='function'&&!!qa.context.extensionSettings.csb_character_state_v1);
 const ids=await page.evaluate(async()=>{
  const settings=qa.context.extensionSettings.csb_character_state_v1;settings.autoScan='off';settings.showAbsent=true;
  const first=await qa.incomingRaw('雲璃站在藥堂內，溫聞素仍留在外地。\n<CSB_UPDATE>'+JSON.stringify({version:1,scene:{time:'未時三刻',location:'藥堂'},present:['c_yun'],characters:[{id:'c_yun',name:'雲璃',set:{identity:'隨行侍女'},reason:'雲璃在藥堂'},{id:'c_wen',name:'溫聞素',set:{identity:'醫者'},reason:'溫聞素在外地'}]})+'</CSB_UPDATE>');
  const latest=await qa.incomingRaw('藥堂內仍只有雲璃。\n<CSB_UPDATE>'+JSON.stringify({version:1,present:['c_yun'],characters:[]})+'</CSB_UPDATE>');
  const user=await qa.send('我繼續等待醫者。');return {first,latest,user};
 });
 const presenceAt=(index,id)=>page.locator(`.mes[mesid="${index}"] .csb-message-card [data-char="${id}"] .csb-presence`).first();
 await presenceAt(ids.latest,'c_yun').waitFor({state:'attached'});
 await page.locator('#sttts-floating .orb').click();await page.locator('#sttts-panel[open]').waitFor();
 await page.waitForFunction(()=>document.querySelector('#sttts-panel iframe')?.contentWindow?.document.querySelector('.home-page [data-app="characterinfo"]'));
 const frame=page.frames().find(frame=>frame.url().endsWith('/ui/index.html'));
 await frame.locator('.home-page .app-icon[data-app="characterinfo"]').click();
 await frame.locator('.view[data-app="characterinfo"]').waitFor({state:'visible'});
 const info=frame.locator('.csb-information-app');await info.getByLabel('雲璃 在場設定',{exact:true}).waitFor();
 await check('real phone iframe and story cards agree on initial scene presence',async()=>{
  assert.equal(await presenceAt(ids.latest,'c_yun').textContent(),'在場');
  assert.equal(await presenceAt(ids.latest,'c_wen').textContent(),'離場');
  assert.equal(await info.locator('[data-char="c_yun"] .csb-presence').textContent(),'在場');
  assert.equal(await info.locator('[data-char="c_wen"] .csb-presence').textContent(),'離場');
 });
 await check('manual false updates latest assistant card behind a user turn and preserves historical card',async()=>{
  await info.getByLabel('雲璃 在場設定',{exact:true}).selectOption('absent');
  await page.waitForFunction(index=>document.querySelector(`.mes[mesid="${index}"] [data-char="c_yun"] .csb-presence`)?.textContent==='離場',ids.latest);
  assert.equal(await presenceAt(ids.first,'c_yun').textContent(),'在場');
  assert.equal(await page.locator(`.mes[mesid="${ids.user}"] .csb-message-card`).count(),0);
  assert.equal(await info.locator('[data-char="c_yun"] .csb-presence').textContent(),'離場');
  assert.equal(await page.evaluate(()=>CSBCharacterState.getSnapshot().presenceOverrides.c_yun),false);
 });
 await check('fixed absence survives a new present roster; auto resumes its current story value',async()=>{
  const next=await page.evaluate(()=>qa.incomingRaw('雲璃仍在堂中。\n<CSB_UPDATE>{"version":1,"present":["c_yun"],"characters":[]}</CSB_UPDATE>'));
  await page.waitForFunction(index=>document.querySelector(`.mes[mesid="${index}"] [data-char="c_yun"] .csb-presence`)?.textContent==='離場',next);
  await info.getByLabel('雲璃 在場設定',{exact:true}).selectOption('auto');
  await page.waitForFunction(index=>document.querySelector(`.mes[mesid="${index}"] [data-char="c_yun"] .csb-presence`)?.textContent==='在場',next);
  assert.equal(await page.evaluate(()=>Object.hasOwn(CSBCharacterState.getSnapshot().presenceOverrides,'c_yun')),false);
 });
 await check('presence-only scan after a user turn updates the latest assistant card and survives fixed-to-auto reset',async()=>{
  const history=await page.evaluate(()=>qa.incomingRaw('雲璃已離開藥堂。\n<CSB_UPDATE>{"version":1,"present":[],"characters":[]}</CSB_UPDATE>'));
  await page.waitForFunction(index=>document.querySelector(`.mes[mesid="${index}"] [data-char="c_yun"] .csb-presence`)?.textContent==='離場',history);
  const current=await page.evaluate(async()=>{const assistant=await qa.incomingRaw('姓名：雲璃\n目前在場：是');const user=await qa.send('我向她點頭。');return {assistant,user};});
  assert.equal(await page.evaluate(()=>CSBCharacterState.getSnapshot().state.characters.c_yun.present),false);
  await info.getByRole('button',{name:'掃描正文',exact:true}).click();
  const scanner=page.getByRole('dialog',{name:'掃描正文／AI 填表',exact:true});
  await scanner.getByLabel('正文範圍',{exact:true}).selectOption('1');
  await scanner.getByRole('button',{name:'開始掃描',exact:true}).click();
  const change=scanner.locator('.csb-scan-presence');await change.waitFor();
  assert((await change.textContent()).includes('離場 → 在場'));await change.locator('input').check();
  await scanner.getByRole('button',{name:'套用勾選結果',exact:true}).click();await scanner.getByText(/已保存 1 位角色/).waitFor();
  await scanner.getByRole('button',{name:'關閉',exact:true}).click();
  await page.waitForFunction(index=>document.querySelector(`.mes[mesid="${index}"] [data-char="c_yun"] .csb-presence`)?.textContent==='在場',current.assistant);
  await frame.waitForFunction(()=>document.querySelector('.csb-information-app [data-char="c_yun"] .csb-presence')?.textContent==='在場');
  assert.equal(await presenceAt(history,'c_yun').textContent(),'離場');
  assert.equal(await page.locator(`.mes[mesid="${current.user}"] .csb-message-card`).count(),0);
  await info.getByLabel('雲璃 在場設定',{exact:true}).selectOption('absent');
  await page.waitForFunction(index=>document.querySelector(`.mes[mesid="${index}"] [data-char="c_yun"] .csb-presence`)?.textContent==='離場',current.assistant);
  await info.getByLabel('雲璃 在場設定',{exact:true}).selectOption('auto');
  await page.waitForFunction(index=>document.querySelector(`.mes[mesid="${index}"] [data-char="c_yun"] .csb-presence`)?.textContent==='在場',current.assistant);
  await frame.waitForFunction(()=>document.querySelector('.csb-information-app [data-char="c_yun"] .csb-presence')?.textContent==='在場');
  assert.equal(await presenceAt(history,'c_yun').textContent(),'離場');
  assert.equal(await page.evaluate(()=>Object.hasOwn(CSBCharacterState.getSnapshot().presenceOverrides,'c_yun')),false);
 });
 await check('automatic AI presence-only preview requires review and applies through the actual phone scanner',async()=>{
  await page.evaluate(()=>{
   qa.notices.length=0;qa.context.extensionSettings.csb_character_state_v1.autoScan='ai';qa.context.extensionSettings.csb_character_state_v1.autoAIApply=false;
   qa.context.generateRaw=async({prompt})=>{const task=JSON.parse(prompt),source=task.currentSceneSources.at(-1).source;return JSON.stringify({characters:[{id:'c_yun',name:'雲璃',set:{},present:false,evidence:{name:{source,quote:'雲璃轉身離開藥堂。'},present:{source,quote:'雲璃轉身離開藥堂。'}}}]});};
  });
  await page.evaluate(()=>qa.incomingRaw('雲璃轉身離開藥堂。'));
  await page.waitForFunction(()=>qa.notices.some(message=>message.includes('等待確認')));
  assert.equal(await page.evaluate(()=>CSBCharacterState.getSnapshot().state.characters.c_yun.present),true);
  await info.getByRole('button',{name:'掃描正文',exact:true}).click();
  const scanner=page.getByRole('dialog',{name:'掃描正文／AI 填表',exact:true});
  const change=scanner.locator('.csb-scan-presence');await change.waitFor();
  assert((await change.textContent()).includes('在場 → 離場'));await change.locator('input').check();
  await scanner.getByRole('button',{name:'套用勾選結果',exact:true}).click();await scanner.getByText(/已保存 1 位角色/).waitFor();
  await page.waitForFunction(()=>CSBCharacterState.getSnapshot().state.characters.c_yun.present===false);
  await scanner.getByRole('button',{name:'關閉',exact:true}).click();
  await frame.waitForFunction(()=>document.querySelector('.csb-information-app [data-char="c_yun"] .csb-presence')?.textContent==='離場');
  assert.equal(await info.locator('[data-char="c_yun"] .csb-presence').textContent(),'離場');
  await page.evaluate(()=>{qa.context.extensionSettings.csb_character_state_v1.autoScan='off';});
 });
 await check('presence overrides remain isolated to their own story chat',async()=>{
  await info.getByLabel('雲璃 在場設定',{exact:true}).selectOption('present');
  await page.waitForFunction(()=>CSBCharacterState.getSnapshot().state.characters.c_yun.present===true);
  await page.evaluate(async()=>{window.presenceSavedChat={chatId:qa.context.chatId,chat:qa.context.chat,metadata:qa.context.chatMetadata};qa.context.chatId='presence-other';qa.context.chat=[];qa.context.chatMetadata={};await qa.emit('CHAT_CHANGED');});
  await frame.waitForFunction(()=>!document.querySelector('.csb-information-app [data-char="c_yun"]'));
  assert.equal(await page.evaluate(()=>Object.hasOwn(CSBCharacterState.getSnapshot().presenceOverrides,'c_yun')),false);
  await page.evaluate(async()=>{qa.context.chatId=presenceSavedChat.chatId;qa.context.chat=presenceSavedChat.chat;qa.context.chatMetadata=presenceSavedChat.metadata;await qa.emit('CHAT_CHANGED');});
  await info.getByLabel('雲璃 在場設定',{exact:true}).waitFor();
  assert.equal(await info.getByLabel('雲璃 在場設定',{exact:true}).inputValue(),'present');
  assert.equal(await page.evaluate(()=>CSBCharacterState.getSnapshot().state.characters.c_yun.present),true);
 });
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const out=path.join(root,'tests/artifacts');await fs.mkdir(out,{recursive:true});
 await fs.writeFile(path.join(out,'browser-presence-report.json'),JSON.stringify({fixture:'actual root entry, backend, phone iframe and bundled CSB; SillyTavern/model responses mocked',passed:checks.length,checks,pageErrors:errors,externalRequests:external},null,2));
 console.log('PASS',checks.length,'actual phone presence integration checks');
}catch(error){console.error('Passed:',checks);console.error('Page errors:',errors);if(page)console.error('BODY:',(await page.locator('body').innerText()).slice(-18000));throw error;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
