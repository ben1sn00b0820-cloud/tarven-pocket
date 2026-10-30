/** Role deletion/current-presence UI regression with the actual phone iframe and CSB runtime.
 * Only SillyTavern APIs/model responses are mocked. No paid model requests.
 * TP_CHROMIUM_PATH=/path/to/chrome node tests/browser-role-controls.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
let playwright;try{playwright=require('playwright');}catch{playwright=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'','playwright'));}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const prefix='/scripts/extensions/third-party/tavern-pocket';
const external='/scripts/extensions/third-party/csb-character-state';
const out=path.join(root,'tests/artifacts');await fs.mkdir(out,{recursive:true});
const mime={'.html':'text/html;charset=utf-8','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{
  let p=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const mock={
    '/scripts/personas.js':'export const user_avatar="";',
    '/scripts/world-info.js':'export const selected_world_info=[];export const world_info={charLore:[]};export async function checkWorldInfo(){return {allActivatedEntries:[]};}',
    '/version':'{"pkgVersion":"1.19.0"}',
    '/tests/avatar.svg':'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#a9cfbf"/></svg>',
  };
  if(Object.hasOwn(mock,p)){res.setHeader('Content-Type',p==='/version'?'application/json':mime[path.extname(p)]);res.end(mock[p]);return;}
  if(p.startsWith(prefix+'/'))p=p.slice(prefix.length);
  else if(p.startsWith(external+'/'))p='/companions/csb-character-state'+p.slice(external.length);
  const file=path.resolve(root,'.'+p);if(!file.startsWith(root+path.sep))throw Error('path');
  let bytes=await fs.readFile(file);
  if(p==='/tests/mock-host.js')bytes=Buffer.from(bytes.toString().replace(`await import('${prefix}/index.js');`,
    `if(new URL(location.href).searchParams.has('external')){(await import('${external}/index.js')).initialize();}
     await import('${prefix}/index.js');`));
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(bytes);
}catch{res.writeHead(404);res.end('not found');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const checks=[],errors=[];let browser,page;
const report=async(status,failure)=>fs.writeFile(path.join(out,'browser-role-controls-report.json'),JSON.stringify({status,checks,errors,failure,limitations:'Actual phone iframe and CSB UI/runtime; SillyTavern host persistence/event bus are local fixtures. No paid model calls.'},null,2));
try{
 browser=await playwright.chromium.launch({headless:true,executablePath:process.env.TP_CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
 const snapshot=()=>page.evaluate(()=>CSBCharacterState.getSnapshot());
 const waitPresence=(value)=>page.waitForFunction(value=>CSBCharacterState.getSnapshot()?.state.characters.c_xia?.present===value,value);
 const frame=()=>page.frames().find(f=>f.url().endsWith('/ui/index.html'));
 const manager=()=>page.getByRole('dialog',{name:'角色信息',exact:true});
 async function openPhone(){await page.locator('#sttts-floating .orb').click();await page.locator('#sttts-panel[open]').waitFor();await page.waitForFunction(()=>document.querySelector('#sttts-panel iframe')?.contentWindow?.document?.querySelector('[data-app="characterinfo"]'));const f=frame();const button=f.locator('.app-icon[data-app="characterinfo"]');await button.evaluate(node=>node.closest('.home-page')?.scrollIntoView({behavior:'instant',block:'nearest',inline:'start'}));await button.click();await f.locator('.view[data-app="characterinfo"]').waitFor({state:'visible'});await f.locator('[data-current-presence="c_xia"]').waitFor();return f;}
 const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS',name);};
 await page.goto(`http://127.0.0.1:${server.address().port}/tests/mock-host.html`);await page.waitForFunction(()=>globalThis.CSBCharacterStateRuntime?.version==='1.4.0');
 await page.evaluate(async()=>{const {newDatabase,defaultSettings}=await import('/scripts/extensions/third-party/tavern-pocket/companions/csb-character-state/src/schema.js');const db=newDatabase();db.seed.characters={c_xia:{id:'c_xia',name:'林知夏',aliases:['知夏'],present:true,values:{energy:42,mood:'平靜'}},c_lu:{id:'c_lu',name:'陸澤',aliases:[],present:false,values:{identity:'友人'}}};db.locks.c_xia={energy:42};db.pinned=['c_xia'];qa.context.chatMetadata.csb_character_state_v1=db;qa.context.extensionSettings.csb_character_state_v1={...defaultSettings(),autoScan:'off'};await qa.emit('CHAT_CHANGED');await qa.context.saveMetadata();await qa.context.saveSettingsDebounced();});
 let f=await openPhone();const info=()=>f.locator('.csb-information-app');
 await check('phone current-state toggle is separate from fixed mode and immediately restores following-story behavior',async()=>{
  const select=info().getByLabel('林知夏 在場設定',{exact:true});await select.selectOption('absent');await waitPresence(false);assert.equal((await snapshot()).presenceOverrides.c_xia,false);
  await info().locator('[data-current-presence="c_xia"]').click();await waitPresence(true);assert.equal((await snapshot()).presenceOverrides.c_xia,undefined);assert.equal(await info().getByLabel('林知夏 在場設定',{exact:true}).inputValue(),'auto');
  await page.evaluate(()=>qa.incomingRaw('林知夏走出房間。<CSB_UPDATE>'+JSON.stringify({version:1,characters:[{id:'c_xia',present:false,reason:'走出目前房間'}]})+'</CSB_UPDATE>'));await waitPresence(false);
  await info().locator('[data-current-presence="c_xia"]').click();await waitPresence(true);assert.equal((await snapshot()).state.characters.c_xia.values.energy,42);
 });
 await check('deletion confirmation cancellation leaves the character and saved data intact',async()=>{
  await info().locator('[data-char="c_xia"] > summary .csb-person').click();await info().locator('[data-delete-character="c_xia"]').waitFor();
  page.once('dialog',dialog=>dialog.dismiss());await info().locator('[data-delete-character="c_xia"]').click();assert.equal((await snapshot()).state.characters.c_xia.name,'林知夏');
 });
 await check('confirmed deletion removes phone and inline role cards while preserving unrelated roles',async()=>{
  page.once('dialog',dialog=>dialog.accept());await info().locator('[data-delete-character="c_xia"]').click();await page.waitForFunction(()=>!CSBCharacterState.getSnapshot()?.state.characters.c_xia);
  await info().locator('[data-char="c_xia"]').waitFor({state:'detached'});assert.equal((await snapshot()).state.characters.c_lu.name,'陸澤');await page.waitForFunction(()=>document.querySelectorAll('#chat [data-char="c_xia"]').length===0);assert.equal(await page.locator('#chat [data-char="c_xia"]').count(),0);
  const deleted=(await snapshot()).deletedCharacters.c_xia;assert.equal(deleted.character.values.energy,42);assert.equal(deleted.locks.energy,42);assert.equal(deleted.pinned,true);
 });
 await check('deleted identity stays removed after model reintroduction under a new ID and browser reload',async()=>{
  await page.evaluate(()=>qa.incomingRaw('信中提到知夏。<CSB_UPDATE>'+JSON.stringify({version:1,characters:[{id:'c_new_xia',name:'知夏',set:{mood:'等待'},reason:'舊資料'}],present:['c_new_xia']})+'</CSB_UPDATE>'));
  assert.deepEqual(Object.keys((await snapshot()).state.characters),['c_lu']);await page.reload();await page.waitForFunction(()=>globalThis.CSBCharacterStateRuntime?.version==='1.4.0');assert.deepEqual(Object.keys((await snapshot()).state.characters),['c_lu']);assert.equal((await snapshot()).deletedCharacters.c_xia.character.name,'林知夏');
 });
 await check('manager restores archived fields and flags explicitly; phone UI shows the restored role',async()=>{
  await page.evaluate(()=>CSBCharacterState.openManager());await manager().getByText('已刪除角色（1）',{exact:true}).click();await manager().getByRole('button',{name:'還原角色',exact:true}).click();await page.waitForFunction(()=>!!CSBCharacterState.getSnapshot()?.state.characters.c_xia);
  assert.equal((await snapshot()).state.characters.c_xia.values.energy,42);assert.equal((await snapshot()).locks.c_xia.energy,42);assert((await snapshot()).pinned.includes('c_xia'));assert.equal((await snapshot()).deletedCharacters.c_xia,undefined);
  await manager().getByRole('button',{name:'關閉',exact:true}).click();f=await openPhone();await info().locator('[data-current-presence="c_xia"]').waitFor();
 });
 await check('current controls and expanded deletion actions fit mobile phone layouts',async()=>{
  for(const width of [320,390]){await page.setViewportSize({width,height:844});await info().locator('[data-char="c_xia"]').evaluate(node=>{node.open=true;node.csbEnsureBody();});const overflow=await info().evaluate(node=>({width:node.clientWidth,scroll:node.scrollWidth}));assert(overflow.scroll<=overflow.width+1,JSON.stringify(overflow));}
  await info().locator('[data-current-presence="c_xia"]').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'role-controls-phone.png'),animations:'disabled'});
 });
 assert.deepEqual(errors,[]);await report('passed');console.log('PASS',checks.length,'role controls browser checks');
}catch(error){await report('failed',String(error));if(page){console.error((await page.locator('body').innerText()).slice(-6000));for(const f of page.frames().filter(f=>f!==page.mainFrame()))console.error((await f.locator('body').innerText()).slice(-6000));};throw error;}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
