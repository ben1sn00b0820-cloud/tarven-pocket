/** Offline browser fixture: real CSB modules bundled inline; host and AI are mocked.
 * No paid model requests and no external page navigation. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.CSB_PLAYWRIGHT||'playwright');
const root=path.resolve(new URL('..',import.meta.url).pathname);
const modules=['src/schema.js','src/identity.js','src/core.js','src/scan.js','src/controller.js','src/ui.js','src/bridge.js','src/generation.js','index.js'];
const js=modules.map(p=>fs.readFileSync(path.join(root,p),'utf8').replace(/^import .*?;\n/gm,'').replace(/^export /gm,'')).join('\n');
const html=fs.readFileSync(path.join(root,'tests/host.html'),'utf8')
  .replace('<link rel="stylesheet" href="../style.css">','<style>'+fs.readFileSync(path.join(root,'style.css'),'utf8')+'</style>')
  .replace('<script type="module" src="../index.js"></script>','<script type="module">'+js.replaceAll('</script','<\\/script')+'</script>');
const browser=await chromium.launch({headless:true,...(process.env.CSB_CHROMIUM?{executablePath:process.env.CSB_CHROMIUM}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});page.setDefaultTimeout(8000);
const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS',name);};
const count=()=>page.evaluate(()=>Object.keys(CB().state.characters).length);
const scanner=()=>page.getByRole('dialog',{name:'掃描正文／AI 填表',exact:true});
const closeScan=()=>scanner().getByRole('button',{name:'關閉',exact:true}).click();
const raw=async text=>page.evaluate(async text=>{testHost.ctx.chat.push({mes:text,name:'旁白',is_user:false});await testHost.render();},text);
try{
 await page.setContent(html);await page.waitForSelector('#csb-launcher');await page.evaluate(()=>{window.CB=()=>CSBCharacterState.getSnapshot();});
 await check('runtime initializes, exposes scan entry, and the raw original message is kept',async()=>{
  await raw('姓名：雲璃\n年齡：19\n身分：隨行侍女');
  await page.evaluate(()=>CSBCharacterState.openScanner({mode:'local'}));await scanner().getByRole('button',{name:'開始掃描',exact:true}).click();await scanner().getByText('新增 雲璃',{exact:true}).waitFor();
  assert.equal(await count(),0);assert.equal(await page.evaluate(()=>testHost.ctx.chat[0].mes),'姓名：雲璃\n年齡：19\n身分：隨行侍女');
 });
 await check('selected local proposal persists and renders the expected fields',async()=>{
  await scanner().getByRole('button',{name:'套用勾選結果',exact:true}).click();await scanner().getByText(/已保存 1 位角色、2 個欄位/).waitFor();assert.equal(await count(),1);
  assert.equal(await page.evaluate(()=>Object.values(CB().state.characters)[0].values.age),'19');await closeScan();
 });
 await check('repeated local scan does not duplicate the same character',async()=>{
  await page.evaluate(()=>CSBCharacterState.openScanner({mode:'local'}));await scanner().getByRole('button',{name:'開始掃描',exact:true}).click();await scanner().getByText(/沒有可採用的新資料/).waitFor();assert.equal(await count(),1);await closeScan();
 });
 await check('dry-run start without an end event never blocks a local scan',async()=>{
  await page.evaluate(async()=>{await testHost.ctx.eventSource.emit('GENERATION_STARTED','normal',{},true);CSBCharacterState.openScanner({mode:'local'});});
  await scanner().getByRole('button',{name:'開始掃描',exact:true}).click();await scanner().getByText(/沒有可採用的新資料/).waitFor();await closeScan();
 });
 await check('background quiet generation does not lock completed narrative scanning',async()=>{
  await page.evaluate(async()=>{window.hostGenerating=true;await testHost.ctx.eventSource.emit('GENERATION_STARTED','quiet',{},false);CSBCharacterState.openScanner({mode:'local'});});
  await scanner().getByRole('button',{name:'開始掃描',exact:true}).click();await scanner().getByText(/沒有可採用的新資料/).waitFor();await closeScan();
  await page.evaluate(async()=>{window.hostGenerating=false;await testHost.ctx.eventSource.emit('GENERATION_ENDED');});
 });
 await check('quiet start remains background when the host lock arrives after initial scheduling',async()=>{
  await page.evaluate(async()=>{window.hostGenerating=false;await testHost.ctx.eventSource.emit('GENERATION_STARTED','quiet',{},false);});
  await page.waitForTimeout(120);
  await page.evaluate(()=>{window.hostGenerating=true;CSBCharacterState.openScanner({mode:'local'});});
  await scanner().getByRole('button',{name:'開始掃描',exact:true}).click();await scanner().getByText(/沒有可採用的新資料/).waitFor();await closeScan();
  await page.evaluate(async()=>{await testHost.ctx.eventSource.emit('GENERATION_ENDED');window.hostGenerating=false;CSBCharacterState.openScanner({mode:'local'});});
  await scanner().getByRole('button',{name:'開始掃描',exact:true}).click();await scanner().getByText(/沒有可採用的新資料/).waitFor();await closeScan();
 });
 await check('real narrative generation blocks local scanning',async()=>{
  await page.evaluate(async()=>{window.hostGenerating=true;await testHost.ctx.eventSource.emit('GENERATION_STARTED','normal',{},false);CSBCharacterState.openScanner({mode:'local'});});
  await scanner().getByRole('button',{name:'開始掃描',exact:true}).click();await scanner().getByText('正文正在生成，請待本輪完成再掃描',{exact:true}).waitFor();
 });
 await check('live idle state releases a stale start even when the end event is missing',async()=>{
  await page.evaluate(()=>{window.hostGenerating=false;});
  await scanner().getByRole('button',{name:'開始掃描',exact:true}).click();await scanner().getByText(/沒有可採用的新資料/).waitFor();await closeScan();
 });
 await check('active streaming remains protected after an unrelated end event',async()=>{
  await page.evaluate(async()=>{window.hostGenerating=true;testHost.ctx.streamingProcessor={isFinished:false,isStopped:false,type:'normal'};await testHost.ctx.eventSource.emit('GENERATION_STARTED','normal',{},false);window.hostGenerating=false;await testHost.ctx.eventSource.emit('GENERATION_ENDED');CSBCharacterState.openScanner({mode:'local'});});
  await scanner().getByRole('button',{name:'開始掃描',exact:true}).click();await scanner().getByText('正文正在生成，請待本輪完成再掃描',{exact:true}).waitFor();
 });
 await check('finished streaming releases the scan without requiring another end event',async()=>{
  await page.evaluate(()=>{testHost.ctx.streamingProcessor.isFinished=true;});
  await scanner().getByRole('button',{name:'開始掃描',exact:true}).click();await scanner().getByText(/沒有可採用的新資料/).waitFor();await closeScan();
  await page.evaluate(()=>{delete testHost.ctx.streamingProcessor;});
 });
 await check('phone-style mounted information view has scan and AI buttons',async()=>{
  await page.evaluate(()=>{const div=document.createElement('div');div.id='information-app';document.body.append(div);window.informationMount=CSBCharacterState.mount(div);});
  await page.locator('#information-app').getByRole('button',{name:'AI 填表',exact:true}).click();assert.equal(await scanner().getByLabel('分析方式',{exact:true}).inputValue(),'ai');await closeScan();
 });
 await check('AI extraction previews a valid role, quarantines a malformed name, and uses exact evidence',async()=>{
  await raw('溫聞素是春衡藥堂的醫者，她走進洞府。');
  await page.evaluate(()=>{window.aiCalls=0;testHost.ctx.generateRaw=async({prompt})=>{window.aiCalls++;const task=JSON.parse(prompt),source=task.sources.at(-1).source;return JSON.stringify({characters:[{name:{wrong:'paragraph'},set:{}},{name:'溫聞素',set:{identity:'春衡藥堂醫者'},evidence:{name:{source,quote:'溫聞素是春衡藥堂的醫者'},identity:{source,quote:'溫聞素是春衡藥堂的醫者'}}}]});};CSBCharacterState.openScanner({mode:'ai',limit:1});});
  await scanner().getByRole('button',{name:'開始掃描',exact:true}).click();await scanner().getByText('新增 溫聞素',{exact:true}).waitFor();assert.equal(await count(),1);assert.equal(await page.evaluate(()=>aiCalls),1);
  await scanner().locator('.csb-scan-diagnostics summary').click();assert.ok((await scanner().innerText()).includes('型別錯誤'));
  await scanner().getByRole('button',{name:'套用勾選結果',exact:true}).click();await scanner().getByText(/已保存 1 位角色/).waitFor();assert.equal(await count(),2);await closeScan();
 });
 await check('replacing an existing value is opt-in per field and not prechecked',async()=>{
  await raw('姓名：雲璃\n身分：外院管事');await page.evaluate(()=>CSBCharacterState.openScanner({mode:'local',limit:1,merge:'changes'}));await scanner().getByRole('button',{name:'開始掃描',exact:true}).click();await scanner().getByText('補充 雲璃',{exact:true}).waitFor();
  const box=scanner().locator('.csb-scan-change input');assert.equal(await box.isChecked(),false);assert.ok((await scanner().innerText()).includes('隨行侍女 → 外院管事'));await box.check();
  await scanner().getByRole('button',{name:'套用勾選結果',exact:true}).click();await scanner().getByText(/已保存 1 位角色、1 個欄位/).waitFor();assert.equal(await page.evaluate(()=>Object.values(CB().state.characters).find(c=>c.name==='雲璃').values.identity),'外院管事');await closeScan();
 });
 await check('a cancelled AI request cannot write a late result',async()=>{
  await raw('林雀然是外門弟子。');await page.evaluate(()=>{testHost.ctx.generateRaw=()=>new Promise(r=>window.finishAI=r);CSBCharacterState.openScanner({mode:'ai',limit:1});});
  await scanner().getByRole('button',{name:'開始掃描',exact:true}).click();await page.waitForFunction(()=>typeof finishAI==='function');await scanner().getByRole('button',{name:'取消本次掃描',exact:true}).click();await page.evaluate(()=>finishAI('{"characters":[]}'));
  await scanner().getByText(/已取消掃描，結果不會寫入/).waitFor();assert.equal(await count(),2);await closeScan();
 });
 await check('new user messages preserve information while not being auto-scanned',async()=>{
  await page.evaluate(async()=>{testHost.ctx.chat.push({mes:'姓名：我不是一個新角色',is_user:true});await testHost.render();await testHost.ctx.eventSource.emit('USER_MESSAGE_RENDERED');});await page.waitForTimeout(200);assert.equal(await count(),2);
 });
 await check('finished assistant response triggers no-cost local detection once',async()=>{
  await raw('姓名：林雀然\n身分：外門弟子');await page.evaluate(async()=>{const i=testHost.ctx.chat.length-1;await testHost.ctx.eventSource.emit('MESSAGE_RECEIVED',i);await testHost.ctx.eventSource.emit('MESSAGE_RECEIVED',i);});
  await page.waitForFunction(()=>Object.values(CB().state.characters).some(c=>c.name==='林雀然'));assert.equal(await count(),3);
 });
 await check('settings expose automatic AI separately with auto-apply disabled by default',async()=>{
  await page.evaluate(()=>CSBCharacterState.openManager());const d=page.getByRole('dialog',{name:'角色信息',exact:true});await d.getByRole('button',{name:'設定／紀錄',exact:true}).click();
  assert.equal(await d.getByLabel('自動掃描正文',{exact:true}).inputValue(),'local');assert.equal(await d.getByLabel('AI 結果自動新增／補空白',{exact:true}).isChecked(),false);
  await d.getByLabel('自動掃描正文',{exact:true}).selectOption('ai');await d.getByRole('button',{name:'儲存設定',exact:true}).click();await d.getByRole('button',{name:'關閉',exact:true}).click();
 });
 await check('automatic AI call queues a review without unapproved writes or recursive calls',async()=>{
  await page.evaluate(()=>{testHost.ctx.generateRaw=async({prompt})=>{window.autoCalls=(window.autoCalls??0)+1;const t=JSON.parse(prompt),source=t.sources[0].source;return JSON.stringify({characters:[{name:'謝知微',set:{identity:'長老'},evidence:{name:{source,quote:'謝知微是身法長老'},identity:{source,quote:'謝知微是身法長老'}}}]});};});
  await raw('謝知微是身法長老。');await page.evaluate(()=>testHost.ctx.eventSource.emit('MESSAGE_RECEIVED',testHost.ctx.chat.length-1));await page.waitForFunction(()=>window.autoCalls===1);await page.waitForTimeout(250);
  assert.equal(await count(),3);await page.evaluate(()=>CSBCharacterState.openScanner({mode:'ai'}));await scanner().getByText('新增 謝知微',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>autoCalls),1);await closeScan();
 });
 await check('switching chats while AI is running closes the dialog and rejects its late result',async()=>{
  await page.evaluate(()=>{testHost.ctx.generateRaw=()=>new Promise(r=>window.finishSwitch=r);CSBCharacterState.openScanner({mode:'ai',limit:1});});await scanner().getByRole('button',{name:'開始掃描',exact:true}).click();await page.waitForFunction(()=>typeof finishSwitch==='function');
  await page.evaluate(async()=>{window.previousMetadata=testHost.ctx.chatMetadata;testHost.ctx.chatMetadata={};testHost.ctx.chat=[];testHost.ctx.chatId='chat-two';await testHost.ctx.eventSource.emit('CHAT_CHANGED');finishSwitch('{"characters":[]}');});
  await page.waitForTimeout(250);assert.equal(await count(),0);assert.equal(await scanner().count(),0);
 });
 await check('automatic local scan waits for generation and recovers without an end event',async()=>{
  await page.evaluate(async()=>{testHost.ctx.extensionSettings.csb_character_state_v1.autoScan='local';window.hostGenerating=true;await testHost.ctx.eventSource.emit('GENERATION_STARTED','normal',{},false);});
  await raw('姓名：沈清秋\n身分：掌門');
  await page.evaluate(()=>testHost.ctx.eventSource.emit('MESSAGE_RECEIVED',testHost.ctx.chat.length-1));
  await page.waitForTimeout(650);assert.equal(await count(),0);
  await page.evaluate(()=>{window.hostGenerating=false;});
  await page.waitForFunction(()=>Object.values(CB().state.characters).some(c=>c.name==='沈清秋'));
  assert.equal(await count(),1);
 });
 for(const width of [320,390,768,1280])await check(`scan dialog remains horizontally contained at ${width}px`,async()=>{
  await page.setViewportSize({width,height:900});await page.evaluate(()=>CSBCharacterState.openScanner());const d=scanner();assert.ok(await d.evaluate(e=>e.scrollWidth<=e.clientWidth+1));await closeScan();
 });
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>CSBCharacterState.openScanner({mode:'ai'}));
 fs.mkdirSync(path.join(root,'tests/artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'tests/artifacts/scan-v12-mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(root,'tests/artifacts/scan-v12-browser.json'),JSON.stringify({fixture:'inline actual modules, mocked SillyTavern host and AI; no external navigation',passed:checks.length,checks,pageErrors:errors},null,2));
 console.log('PASS',checks.length,'offline browser scenarios');
}catch(error){console.error('PAGE ERRORS',errors);console.error('BODY',await page.locator('body').innerText());console.error('STATE',await page.evaluate(()=>({chat:testHost.ctx.chat,settings:testHost.ctx.extensionSettings})));throw error;}finally{await browser.close();}
