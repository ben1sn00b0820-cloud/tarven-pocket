/** Actual CSB runtime + UI in Chromium; SillyTavern and model responses are local fixtures.
 * Run: CSB_CHROMIUM=/tmp/moxu-chromium node tests/presence-ui.smoke.mjs
 * No external services, synthesis, or paid model calls are used. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
let playwright;try{playwright=require('playwright');}catch{playwright=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'','playwright'));}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mime={'.html':'text/html;charset=utf-8','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json'};
const server=createServer(async(req,res)=>{try{
 const requestPath=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,'.'+requestPath);
 if(!file.startsWith(root+path.sep))throw Error('outside fixture');
 let bytes=await fs.readFile(file);
 if(requestPath==='/tests/host.html')bytes=Buffer.from(bytes.toString().replace('<script type="module" src="../index.js"></script>','<script>if(window.fixtureSaved)Object.assign(testHost.ctx,window.fixtureSaved);</script><script type="module" src="../index.js"></script>'));
 res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(bytes);
}catch{res.writeHead(404);res.end('not found');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser,page;const checks=[],errors=[],external=[];
try{
 browser=await playwright.chromium.launch({headless:true,executablePath:process.env.CSB_CHROMIUM||'/tmp/moxu-chromium',args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--use-gl=angle','--use-angle=swiftshader']});
 page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});page.setDefaultTimeout(10000);
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith('http://127.0.0.1:'))external.push(request.url());});
 const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS',name);};
 const manager=()=>page.getByRole('dialog',{name:'角色信息',exact:true});
 const editor=()=>page.getByRole('dialog',{name:'編輯角色',exact:true});
 const scanner=()=>page.getByRole('dialog',{name:'掃描正文／AI 填表',exact:true});
 const snapshot=()=>page.evaluate(()=>CSBCharacterState.getSnapshot());
 const close=async locator=>{if(await locator.count())await locator.getByRole('button',{name:'關閉',exact:true}).first().click();};
 const raw=async text=>page.evaluate(async text=>{testHost.ctx.chat.push({mes:text,name:'旁白',is_user:false});await testHost.render();},text);
 const waitPresence=(id,value)=>page.waitForFunction(({id,value})=>CSBCharacterState.getSnapshot()?.state.characters[id]?.present===value,{id,value});
 await page.goto(`http://127.0.0.1:${server.address().port}/tests/host.html`);await page.locator('#csb-launcher').waitFor();
 await page.waitForFunction(()=>!!testHost.ctx.extensionSettings.csb_character_state_v1);
 await page.evaluate(async()=>{
  testHost.ctx.extensionSettings.csb_character_state_v1.autoScan='off';
  await testHost.send({version:1,scene:{time:'未時三刻',location:'藥堂'},present:['c_yun'],characters:[{id:'c_yun',name:'雲璃',set:{identity:'隨行侍女'},reason:'雲璃站在藥堂內'},{id:'c_wen',name:'溫聞素',set:{identity:'醫者'},reason:'溫聞素正在外地行醫'}]});
 });
 await waitPresence('c_yun',true);await waitPresence('c_wen',false);
 await check('current manager has visible three-way controls; historical story cards remain read-only',async()=>{
  await page.evaluate(()=>CSBCharacterState.openManager());
  const select=manager().getByLabel('雲璃 在場設定',{exact:true});await select.waitFor();
  assert.equal(await select.inputValue(),'auto');
  assert.deepEqual(await select.locator('option').allTextContents(),['跟隨劇情','固定在場','固定離場']);
  assert.equal(await page.locator('#chat [data-presence-control]').count(),0);
  await select.selectOption('absent');await waitPresence('c_yun',false);
  assert.equal((await snapshot()).presenceOverrides.c_yun,false);
  assert.equal(await manager().getByLabel('雲璃 在場設定',{exact:true}).inputValue(),'absent');
  await close(manager());
 });
 await check('fixed absent survives a new present roster and persists through reload',async()=>{
  await page.evaluate(async()=>testHost.send({version:1,present:['c_yun'],characters:[]}));
  await waitPresence('c_yun',false);
  const saved=await page.evaluate(()=>({chatId:testHost.ctx.chatId,chat:testHost.ctx.chat,chatMetadata:testHost.ctx.chatMetadata,extensionSettings:testHost.ctx.extensionSettings}));
  await page.addInitScript(seed=>{window.fixtureSaved=seed;},saved);
  await page.reload();await page.locator('#csb-launcher').waitFor();
  await waitPresence('c_yun',false);assert.equal((await snapshot()).presenceOverrides.c_yun,false);
  await page.evaluate(()=>CSBCharacterState.openManager());
  assert.equal(await manager().getByLabel('雲璃 在場設定',{exact:true}).inputValue(),'absent');
  await manager().getByLabel('雲璃 在場設定',{exact:true}).selectOption('auto');
  await waitPresence('c_yun',true);assert(!Object.hasOwn((await snapshot()).presenceOverrides,'c_yun'));
  await close(manager());
 });
 await check('editing unrelated character fields leaves presence following the story',async()=>{
  await page.evaluate(()=>CSBCharacterState.openEditor('c_yun'));
  assert.equal(await editor().getByLabel('在場設定',{exact:true}).inputValue(),'auto');
  await editor().getByLabel('別名（以頓號分隔）',{exact:true}).fill('阿璃');
  await editor().getByRole('button',{name:'儲存角色',exact:true}).click();
  await editor().waitFor({state:'detached'});
  assert(!Object.hasOwn((await snapshot()).presenceOverrides,'c_yun'));
  await close(manager());
  await page.evaluate(async()=>testHost.send({version:1,present:[],characters:[]}));
  await waitPresence('c_yun',false);
  assert.deepEqual((await snapshot()).state.characters.c_yun.aliases,['阿璃']);
 });
 await check('document-local character information controls update the same persisted state',async()=>{
  await page.evaluate(()=>{const mount=document.createElement('div');mount.id='presence-information';document.body.append(mount);window.presenceMount=CSBCharacterState.mount(mount);});
  const info=page.locator('#presence-information'),select=info.getByLabel('雲璃 在場設定',{exact:true});
  await select.selectOption('present');await waitPresence('c_yun',true);
  assert.equal((await snapshot()).presenceOverrides.c_yun,true);
  await info.getByLabel('雲璃 在場設定',{exact:true}).selectOption('auto');await waitPresence('c_yun',false);
  assert(!Object.hasOwn((await snapshot()).presenceOverrides,'c_yun'));
 });
 await check('local scan previews and applies presence-only change in fill mode with exact evidence',async()=>{
  await raw('姓名：雲璃\n目前在場：是');
  await page.evaluate(()=>CSBCharacterState.openScanner({mode:'local',limit:1,merge:'fill'}));
  assert.equal(await scanner().getByLabel('判定目前在場／離場',{exact:true}).isChecked(),true);
  await scanner().getByRole('button',{name:'開始掃描',exact:true}).click();
  const presence=scanner().locator('.csb-scan-presence');await presence.waitFor();
  assert((await presence.textContent()).includes('離場 → 在場'));
  assert((await presence.textContent()).includes('目前在場：是'));
  const choice=presence.locator('input[type="checkbox"]');await choice.check();
  await scanner().getByRole('button',{name:'套用勾選結果',exact:true}).click();
  await scanner().getByText(/已保存 1 位角色/).waitFor();
  await waitPresence('c_yun',true);assert.equal((await snapshot()).state.characters.c_yun.values.identity,'隨行侍女');
  await close(scanner());
 });
 await check('presence scan can be disabled without changing current status',async()=>{
  await raw('姓名：雲璃\n目前在場：否');
  await page.evaluate(()=>CSBCharacterState.openScanner({mode:'local',limit:1,merge:'fill'}));
  await scanner().getByLabel('判定目前在場／離場',{exact:true}).uncheck();
  await scanner().getByRole('button',{name:'開始掃描',exact:true}).click();
  await scanner().getByText(/沒有可採用的新資料/).waitFor();
  assert.equal(await scanner().locator('.csb-scan-presence input:not(:disabled)').count(),0);
  assert.equal((await snapshot()).state.characters.c_yun.present,true);await close(scanner());
 });
 await check('fixed status is displayed as protected in a conflicting scan result',async()=>{
  await page.evaluate(()=>CSBCharacterState.setPresence('c_yun','present'));
  await page.evaluate(()=>CSBCharacterState.openScanner({mode:'local',limit:1,merge:'fill'}));
  await scanner().getByRole('button',{name:'開始掃描',exact:true}).click();
  const presence=scanner().locator('.csb-scan-presence');await presence.waitFor();
  assert((await presence.textContent()).includes('固定'));
  assert.equal(await presence.locator('input[type="checkbox"]').isDisabled(),true);
  assert.equal((await snapshot()).state.characters.c_yun.present,true);await close(scanner());
 });
 await check('unknown AI presence remains reviewable and cannot silently mark a known character absent',async()=>{
  await page.evaluate(()=>CSBCharacterState.setPresence('c_yun','auto'));
  const before=(await snapshot()).state.characters.c_yun.present;
  await raw('信上只提到雲璃的名字，沒有說她身在何處。');
  await page.evaluate(()=>{testHost.ctx.generateRaw=async({prompt})=>{const task=JSON.parse(prompt),source=task.sources.at(-1).source;return JSON.stringify({characters:[{id:'c_yun',name:'雲璃',set:{},present:null,evidence:{name:{source,quote:'信上只提到雲璃的名字，沒有說她身在何處。'}}}]});};CSBCharacterState.openScanner({mode:'ai',limit:1,merge:'fill'});});
  await scanner().getByRole('button',{name:'開始掃描',exact:true}).click();
  const presence=scanner().locator('.csb-scan-presence');await presence.waitFor();
  assert((await presence.textContent()).includes('無法判定'));
  assert.equal(await presence.locator('input[type="checkbox"]').isDisabled(),true);
  await scanner().getByRole('button',{name:'套用勾選結果',exact:true}).click();
  await scanner().getByText(/已保存 0 位角色/).waitFor();
  assert.equal((await snapshot()).state.characters.c_yun.present,before);await close(scanner());
 });
 await check('scanner and visible presence controls stay within narrow mobile viewport',async()=>{
  for(const width of [320,390]){
   await page.setViewportSize({width,height:844});
   await page.evaluate(()=>CSBCharacterState.openManager());
   assert(await manager().evaluate(node=>node.scrollWidth<=node.clientWidth+1));
   await close(manager());
   await page.evaluate(()=>CSBCharacterState.openScanner({mode:'local'}));
   assert(await scanner().evaluate(node=>node.scrollWidth<=node.clientWidth+1));
   await close(scanner());
  }
 });
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 const artifacts=path.join(root,'tests/artifacts');await fs.mkdir(artifacts,{recursive:true});
 await fs.writeFile(path.join(artifacts,'presence-ui-browser.json'),JSON.stringify({fixture:'actual CSB runtime and UI; local SillyTavern host fixture',passed:checks.length,checks,pageErrors:errors,externalRequests:external},null,2));
 console.log('PASS',checks.length,'presence browser checks');
}catch(error){console.error('Passed checks:',checks);console.error('Page errors:',errors);if(page)console.error('Page text:',(await page.locator('body').innerText()).slice(-16000));throw error;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
