/** Actual CSB UI in Chromium with mocked SillyTavern persistence and model responses. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
let playwright;try{playwright=require('playwright');}catch{playwright=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'','playwright'));}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'tests/artifacts');await fs.mkdir(out,{recursive:true});
const mime={'.html':'text/html;charset=utf-8','.js':'application/javascript','.css':'text/css','.json':'application/json'};
const server=createServer(async(req,res)=>{try{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+path.sep))throw Error('outside');const bytes=await fs.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});res.end(bytes);}catch{res.writeHead(404);res.end('not found');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser,page;const checks=[],errors=[];
const report=async(status,error)=>fs.writeFile(path.join(out,'ui-v15-browser.json'),JSON.stringify({status,checks,errors,...(error?{error}:{}),fixture:'Actual Chromium, standalone CSB UI, mocked SillyTavern APIs/model'},null,2)+'\n');
try{
 browser=await playwright.chromium.launch({headless:true,executablePath:process.env.CSB_CHROMIUM||process.env.TP_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--use-gl=angle','--use-angle=swiftshader']});
 page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce',acceptDownloads:true});page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 const check=async(name,fn)=>{await fn();checks.push(name);console.log('PASS',name);};
 const manager=()=>page.getByRole('dialog',{name:'角色信息',exact:true}),editor=()=>page.getByRole('dialog',{name:'編輯角色',exact:true}),scanner=()=>page.getByRole('dialog',{name:'掃描正文／AI 填表',exact:true});
 const close=async dialog=>{if(await dialog.count())await dialog.getByRole('button',{name:'關閉',exact:true}).first().click();};
 const snapshot=()=>page.evaluate(()=>CSBCharacterState.getSnapshot());
 const fit=async locator=>{const s=await locator.evaluate(n=>({w:n.clientWidth,sw:n.scrollWidth}));assert(s.sw<=s.w+1,JSON.stringify(s));};
 await page.goto(`http://127.0.0.1:${server.address().port}/tests/host.html`);await page.locator('#csb-launcher').waitFor();
 await page.evaluate(async()=>{
  const {newDatabase,defaultSettings,field}=await import('/src/schema.js'),db=newDatabase();
  db.schema.fields.find(f=>f.id==='gender').default='女性';
  db.schema.fields.push(field('female_fact','女性備註','basic','text',{appliesTo:'female'}),field('male_fact','男性備註','basic','text',{appliesTo:'male'}));
  db.seed.characters={c_yun:{id:'c_yun',name:'雲璃',aliases:[],present:true,values:{gender:'女性',female_fact:'已保存女性資料',male_fact:'保留男性舊值',mood:'平靜'}},c_wen:{id:'c_wen',name:'溫聞素',aliases:[],present:false,values:{gender:'男性',identity:'醫者'}},c_unknown:{id:'c_unknown',name:'旅人',aliases:[],present:false,values:{mood:'等待'}}};
  db.seed.scene={time:'週六午後',location:'街角咖啡館'};db.locks.c_yun={female_fact:'已保存女性資料'};
  testHost.ctx.chatMetadata.csb_character_state_v1=db;testHost.ctx.extensionSettings.csb_character_state_v1={...defaultSettings(),autoScan:'off'};
  testHost.ctx.chat=[{name:'旁白',is_user:false,mes:'雲璃是醫者。'}];await testHost.ctx.eventSource.emit('CHAT_CHANGED');await testHost.render();
  window.scanRequests=[];window.rawRequests=[];window.scanAnswer=JSON.stringify({characters:[{id:'c_yun',name:'雲璃',set:{identity:'醫者'},evidence:{name:{source:'m0.0',quote:'雲璃是醫者。'},identity:{source:'m0.0',quote:'雲璃是醫者。'}}}]});
  testHost.ctx.generateQuietPrompt=async args=>{window.scanRequests.push(args);return window.scanAnswer;};testHost.ctx.generateRaw=async args=>{window.rawRequests.push(args);return window.scanAnswer;};
  const draft=document.createElement('textarea');draft.id='send_textarea';draft.value='未送出的草稿';document.body.append(draft);
 });
 await check('manager cards remain readable and fit 390px mobile and desktop widths',async()=>{
  await page.evaluate(()=>CSBCharacterState.openManager());await manager().locator('[data-char="c_yun"]').waitFor();
  await fit(manager());await fit(manager().locator('.csb-roster'));await page.screenshot({path:path.join(out,'ui-v15-manager-mobile.png')});
  await page.setViewportSize({width:1180,height:900});await fit(manager());await page.screenshot({path:path.join(out,'ui-v15-manager-desktop.png')});await page.setViewportSize({width:390,height:844});await close(manager());
 });
 await check('role template switch filters fields and preserves inactive values and locks',async()=>{
  await page.evaluate(()=>CSBCharacterState.openEditor('c_yun'));assert(await editor().getByLabel('女性備註',{exact:true}).isVisible());assert(!(await editor().getByLabel('男性備註',{exact:true}).isVisible()));
  await editor().getByLabel('角色模板',{exact:true}).selectOption('male');assert(await editor().getByLabel('男性備註',{exact:true}).isVisible());assert(!(await editor().getByLabel('女性備註',{exact:true}).isVisible()));
  await editor().getByLabel('男性備註',{exact:true}).fill('男性模板更新');await editor().getByRole('button',{name:'儲存角色',exact:true}).click();await editor().waitFor({state:'detached'});
  const s=await snapshot();assert.equal(s.state.characters.c_yun.template,'male');assert.equal(s.state.characters.c_yun.values.female_fact,'已保存女性資料');assert.equal(s.state.characters.c_yun.values.male_fact,'男性模板更新');assert.equal(s.locks.c_yun.female_fact,'已保存女性資料');
  await close(manager());await page.evaluate(()=>CSBCharacterState.openEditor('c_yun'));await editor().getByLabel('角色模板',{exact:true}).selectOption('auto');await editor().getByRole('button',{name:'儲存角色',exact:true}).click();await editor().waitFor({state:'detached'});await close(manager());
 });
 await check('schema gender default does not assign a sex or reveal gender-only fields for an unknown role',async()=>{
  await page.evaluate(()=>CSBCharacterState.openEditor('c_unknown'));assert.equal(await editor().getByLabel('性別',{exact:true}).inputValue(),'');assert(!(await editor().getByLabel('女性備註',{exact:true}).isVisible()));assert(!(await editor().getByLabel('男性備註',{exact:true}).isVisible()));
  await editor().getByLabel('別名（以頓號分隔）',{exact:true}).fill('過客');await editor().getByRole('button',{name:'儲存角色',exact:true}).click();await editor().waitFor({state:'detached'});assert.equal((await snapshot()).state.characters.c_unknown.values.gender,undefined);await close(manager());
 });
 await check('template category editor creates a female-only field without changing common/male fields',async()=>{
  await page.evaluate(()=>CSBCharacterState.openManager());await manager().getByRole('button',{name:'欄位模板',exact:true}).click();await manager().locator('[data-template-view="female"]').click();assert(await manager().getByText('女性備註',{exact:true}).isVisible());assert.equal(await manager().getByText('男性備註',{exact:true}).count(),0);
  await manager().getByRole('button',{name:'新增欄位',exact:true}).first().click();const field=page.getByRole('dialog',{name:'新增欄位',exact:true});assert.equal(await field.getByLabel('適用模板',{exact:true}).inputValue(),'female');await field.getByLabel('欄位名稱',{exact:true}).fill('女性專用自訂欄位');await field.getByRole('button',{name:'儲存欄位',exact:true}).click();await field.waitFor({state:'detached'});
  assert.equal((await snapshot()).schema.fields.find(f=>f.label==='女性專用自訂欄位').appliesTo,'female');await manager().locator('[data-template-view="male"]').click();assert.equal(await manager().getByText('女性專用自訂欄位',{exact:true}).count(),0);await fit(manager());await close(manager());
 });
 await check('custom AI scan preset stores host route, editable instructions, and response limit',async()=>{
  await page.evaluate(()=>CSBCharacterState.openScanner({mode:'ai',limit:1}));await scanner().getByLabel('掃描預設',{exact:true}).selectOption('builtin-host');await scanner().getByText(/已記住掃描預設/).waitFor();assert((await scanner().locator('.csb-preset-box').textContent()).includes('角色卡、世界書與歷史可能一起送出'));
  await scanner().getByRole('button',{name:'＋ 新增',exact:true}).click();const preset=page.getByRole('dialog',{name:'新增掃描預設',exact:true});await preset.getByLabel('預設名稱',{exact:true}).fill('角色抽取測試');await preset.getByLabel('掃描指示',{exact:true}).fill('用繁體中文，保留原文依據。UI_PRESET_MARKER');await preset.getByLabel('回應長度上限',{exact:true}).fill('1024');await fit(preset);await preset.getByRole('button',{name:'儲存預設',exact:true}).click();await preset.waitFor({state:'detached'});
  const stored=await page.evaluate(()=>testHost.ctx.extensionSettings.csb_character_state_v1);assert.equal(stored.scanPresets.length,1);assert.equal(stored.scanPresets[0].route,'host');assert.equal(stored.scanPresets[0].responseLength,1024);assert.equal(await scanner().getByLabel('掃描預設',{exact:true}).inputValue(),stored.scanPresets[0].id);
  await scanner().getByRole('button',{name:'編輯',exact:true}).click();const edit=page.getByRole('dialog',{name:'編輯掃描預設',exact:true});await edit.getByLabel('掃描指示',{exact:true}).fill('優先整理人物身分。UI_PRESET_MARKER_EDIT');await edit.getByRole('button',{name:'儲存預設',exact:true}).click();await edit.waitFor({state:'detached'});
 });
 let exported;
 await check('scan preset export and import round trip retains selection without duplicate IDs',async()=>{
  const downloadPromise=page.waitForEvent('download');await scanner().getByRole('button',{name:'匯出',exact:true}).click();const download=await downloadPromise;exported=JSON.parse(await fs.readFile(await download.path(),'utf8'));assert.equal(exported.format,'CSB_SCAN_PRESETS');assert.equal(exported.presets.length,1);assert.equal(exported.presets[0].instructions,'優先整理人物身分。UI_PRESET_MARKER_EDIT');
  const chooserPromise=page.waitForEvent('filechooser');await scanner().getByRole('button',{name:'匯入',exact:true}).click();await (await chooserPromise).setFiles({name:'scan-presets.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});await scanner().getByText('已匯入 1 份掃描預設。',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>testHost.ctx.extensionSettings.csb_character_state_v1.scanPresets.length),1);
 });
 await check('AI scanner calls actual host preset route, previews evidence, and leaves narrative/draft intact',async()=>{
  const before=await page.evaluate(()=>testHost.ctx.chat.map(m=>m.mes));await scanner().getByRole('button',{name:'開始掃描',exact:true}).click();await scanner().locator('.csb-scan-candidate').waitFor();assert((await scanner().locator('.csb-scan-preset-used').textContent()).includes('沿用酒館預設'));
  const calls=await page.evaluate(()=>({quiet:scanRequests,raw:rawRequests,draft:document.querySelector('#send_textarea').value,chat:testHost.ctx.chat.map(m=>m.mes)}));assert.equal(calls.quiet.length,1);assert.equal(calls.raw.length,0);assert(calls.quiet[0].quietPrompt.includes('UI_PRESET_MARKER_EDIT'));assert.equal(calls.quiet[0].quietToLoud,false);assert.equal(calls.quiet[0].responseLength,1024);assert.equal(calls.draft,'未送出的草稿');assert.deepEqual(calls.chat,before);
  await scanner().getByRole('button',{name:'套用勾選結果',exact:true}).click();await scanner().getByText(/已保存 1 位角色/).waitFor();assert.equal((await snapshot()).state.characters.c_yun.values.identity,'醫者');await fit(scanner());await scanner().evaluate(n=>n.scrollTop=0);await page.screenshot({path:path.join(out,'ui-v15-scan-mobile.png')});
 });
 await check('custom scan preset can be deleted and builtin remains selected on reopening',async()=>{
  page.once('dialog',d=>d.accept());await scanner().getByRole('button',{name:'刪除',exact:true}).click();await scanner().getByText('掃描預設已刪除。',{exact:true}).waitFor();assert.equal(await scanner().getByLabel('掃描預設',{exact:true}).inputValue(),'builtin-raw');await close(scanner());await page.evaluate(()=>CSBCharacterState.openScanner({mode:'ai'}));assert.equal(await scanner().getByLabel('掃描預設',{exact:true}).inputValue(),'builtin-raw');assert.equal(await page.evaluate(()=>testHost.ctx.extensionSettings.csb_character_state_v1.scanPresets.length),0);await close(scanner());
 });
 assert.deepEqual(errors,[]);await report('passed');console.log('PASS',checks.length,'v1.5 UI browser checks');
}catch(e){await report('failed',String(e));if(page){console.error((await page.locator('body').innerText()).slice(-8000));await page.screenshot({path:path.join(out,'ui-v15-failure.png')}).catch(()=>{});}throw e;}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
