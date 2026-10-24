import fs from 'node:fs';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const server=http.createServer((req,res)=>{try{const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2'};res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const {chromium}=await import(process.env.CSB_PLAYWRIGHT||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CSB_CHROMIUM?{executablePath:process.env.CSB_CHROMIUM}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote','--single-process']});
const base=process.env.CSB_TEST_URL||`http://127.0.0.1:${server.address().port}`;
const errors=[],checks=[];
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
// Optional in-process HTTPS fixture routing: no localhost navigation or network requests.
if(process.env.CSB_ROUTE_FILES==='1')await context.route(base+'/**',async route=>{
  try{const file=path.resolve(root,'.'+decodeURIComponent(new URL(route.request().url()).pathname));if(!file.startsWith(root+path.sep))throw Error('path');
    await route.fulfill({status:200,contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
  }catch{await route.fulfill({status:404,body:'not found'});}
});

if(fs.existsSync(path.join(root,'tests/fonts/400.css')))await page.addInitScript(({base})=>document.addEventListener('DOMContentLoaded',()=>{const link=document.createElement('link');link.rel='stylesheet';link.href=base+'/tests/fonts/400.css';document.head.append(link);const style=document.createElement('style');style.textContent='.csb,body{font-family:"Noto Sans TC",sans-serif}';document.head.append(style);}),{base});
const check=(name,fn)=>fn().then(()=>{checks.push(name);console.log('PASS',name);});
try{
await page.goto(base+'/Preview.html');await page.waitForSelector('[data-char="c_zhiwei"]');
await check('preview loads two characters with independent values',async()=>{assert.equal(await page.locator('[data-char]').count(),2);assert.equal(await page.evaluate(()=>csbPreview.host.getSnapshot().state.characters.c_zhiwei.values.energy),58);});
await check('rest event changes energy and hydration, keeps injury',async()=>{await page.locator('#simulate-rest').click();assert.equal(await page.evaluate(()=>csbPreview.host.getSnapshot().state.characters.c_zhiwei.values.energy),68);assert.equal(await page.evaluate(()=>csbPreview.host.getSnapshot().state.characters.c_zhiwei.values.part_8),'左手指節有輕微擦傷，已包紮');});
await check('leave/reenter preserves independent character data',async()=>{await page.locator('#simulate-leave').click();assert.equal(await page.locator('[data-char]').count(),1);await page.locator('#simulate-leave').click();assert.equal(await page.locator('[data-char]').count(),2);assert.equal(await page.evaluate(()=>csbPreview.host.getSnapshot().state.characters.c_xingzhou.values.energy),82);});
await check('add a custom gauge through actual form',async()=>{
  await page.locator('#open-fields').click();const group=page.locator('.csb-schema-group').filter({has:page.getByRole('heading',{name:'◈ 狀態數值',exact:true})});await group.getByRole('button',{name:'新增欄位',exact:true}).click();
  const d=page.getByRole('dialog',{name:'新增欄位',exact:true});await d.getByLabel('欄位名稱',{exact:true}).fill('靈力');await d.getByLabel('欄位類型',{exact:true}).selectOption('bar');await d.getByLabel('最大值',{exact:true}).fill('1000');await d.getByLabel('單次變動上限',{exact:false}).fill('50');await d.getByLabel('分段標籤',{exact:false}).fill('0: 枯竭\n500: 充盈');await d.getByRole('button',{name:'儲存欄位'}).click();await d.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>csbPreview.host.getSnapshot().db.schema.fields.find(f=>f.label==='靈力').max),1000);
});
await check('custom field appears in every character but edited values stay independent',async()=>{
  const manager=page.getByRole('dialog',{name:'角色信息',exact:true});await manager.getByRole('button',{name:'角色庫',exact:true}).click();const card=manager.locator('[data-char="c_zhiwei"]');await card.locator(':scope > summary').click();await card.getByRole('button',{name:'編輯角色'}).click();
  const editor=page.getByRole('dialog',{name:'編輯角色',exact:true});await editor.getByLabel('靈力',{exact:true}).fill('700');await editor.getByRole('button',{name:'儲存角色'}).click();await editor.waitFor({state:'detached'});
  const values=await page.evaluate(()=>{const s=csbPreview.host.getSnapshot(),f=s.db.schema.fields.find(f=>f.label==='靈力');return [s.state.characters.c_zhiwei.values[f.id],s.state.characters.c_xingzhou.values[f.id]??null];});assert.deepEqual(values,[700,null]);
  await manager.getByRole('button',{name:'關閉',exact:true}).click();
});
await check('reload restores edited template and values',async()=>{await page.reload();await page.waitForSelector('[data-char="c_zhiwei"]');assert.equal(await page.evaluate(()=>{const s=csbPreview.host.getSnapshot(),f=s.db.schema.fields.find(f=>f.label==='靈力');return s.state.characters.c_zhiwei.values[f.id];}),700);});
await check('untrusted text is displayed without HTML execution',async()=>{await page.evaluate(async()=>{await csbPreview.host.saveCharacter({id:'c_html',name:'<img src=x onerror="window.PWNED=1">',set:{note:'<script>window.PWNED=2</script>'},present:true},{},false,true);});assert.equal(await page.evaluate(()=>window.PWNED),undefined);assert.equal(await page.locator('#preview-stage img').count(),0);});
await page.evaluate(()=>{delete csbPreview.context.chatMetadata.csb_character_state_v1.seed.characters.c_html;csbPreview.context.chatMetadata.csb_character_state_v1.manual=csbPreview.context.chatMetadata.csb_character_state_v1.manual.filter(e=>!e.payload.characters.some(c=>c.id==='c_html'));csbPreview.paint();});
for(const width of [320,390,768,1280])await check(`responsive page and editor at ${width}px`,async()=>{
  await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.locator('#open-manager').click();const d=page.getByRole('dialog',{name:'角色信息',exact:true});assert.ok(await d.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  await d.getByRole('button',{name:'欄位模板',exact:true}).click();assert.ok(await d.evaluate(el=>el.scrollWidth<=el.clientWidth+1));await d.getByRole('button',{name:'關閉',exact:true}).click();
});
fs.mkdirSync(new URL('./artifacts/',import.meta.url),{recursive:true});
await page.setViewportSize({width:1280,height:1000});await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:new URL('./artifacts/preview-desktop.png',import.meta.url).pathname,fullPage:true});
await page.setViewportSize({width:390,height:844});await page.screenshot({path:new URL('./artifacts/preview-mobile.png',import.meta.url).pathname,fullPage:true});
await check('SillyTavern adapter mounts and injects prompt',async()=>{await page.goto(base+'/tests/host.html');await page.waitForSelector('#csb-launcher');await page.evaluate(async()=>{await csbCharacterStateIntercept([],8000,()=>{throw Error('unexpected abort');},'normal');});assert.ok(await page.evaluate(()=>injected[1].includes('CSB_UPDATE')));});
await check('host response shows folded status and hides raw JSON without editing source',async()=>{
  await page.evaluate(async()=>testHost.send({version:1,present:['c_demo'],characters:[{id:'c_demo',name:'測試角色',set:{energy:45,trust:72},reason:'初次登場'}]}));await page.waitForSelector('.csb-message-card');assert.ok(!(await page.locator('.mes_text').innerText()).includes('CSB_UPDATE'));assert.ok(await page.evaluate(()=>testHost.ctx.chat[0].mes.includes('CSB_UPDATE')));await page.locator('.csb-panel-head').click();await page.locator('.csb-character-head').click();assert.ok((await page.locator('.csb-gauge').first().innerText()).length>0);
});
await check('quiet generation clears the injected prompt',async()=>{await page.evaluate(async()=>csbCharacterStateIntercept(testHost.ctx.chat,8000,()=>{},'quiet'));assert.equal(await page.evaluate(()=>injected[1]),'');});
await check('swipe generation prompt uses state before discarded answer',async()=>{await page.evaluate(async()=>csbCharacterStateIntercept([],8000,()=>{},'swipe'));assert.ok(!(await page.evaluate(()=>injected[1])).includes('測試角色'));});
await check('host editing a reply applies new state and malformed update keeps old state',async()=>{
  await page.evaluate(async()=>{testHost.ctx.chat[0].mes='正文<CSB_UPDATE>'+JSON.stringify({version:1,present:['c_demo'],characters:[{id:'c_demo',name:'測試角色',set:{energy:29},reason:'重新生成'}]})+'</CSB_UPDATE>';await testHost.render();await testHost.ctx.eventSource.emit('MESSAGE_UPDATED',0);});await page.waitForTimeout(200);await page.evaluate(async()=>{await testHost.send({version:1,characters:[{id:'c_demo',set:{energy:'invalid'},reason:'壞資料'}]});});await page.waitForSelector('.csb-message-error');assert.ok((await page.locator('.csb-message-error').innerText()).includes('必須是數字'));
});
await check('editing character information survives message events without losing typed input',async()=>{
  await page.evaluate(()=>CSBCharacterState.openEditor('c_demo'));
  const editor=page.getByRole('dialog',{name:'編輯角色',exact:true});await editor.getByLabel('身分',{exact:true}).fill('持續保存的身份');
  await page.evaluate(async()=>{testHost.ctx.chat.push({is_user:true,mes:'新的使用者訊息'});await testHost.ctx.eventSource.emit('USER_MESSAGE_RENDERED');await testHost.ctx.eventSource.emit('MESSAGE_UPDATED');});await page.waitForTimeout(200);
  assert.equal(await editor.getByLabel('身分',{exact:true}).inputValue(),'持續保存的身份');await editor.getByRole('button',{name:'儲存角色'}).click();await editor.waitFor({state:'detached'});
  await page.evaluate(async()=>{await testHost.send({version:1,characters:[],present:[]});});await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>CSBCharacterState.getSnapshot().state.characters.c_demo.values.identity),'持續保存的身份');
  await page.getByRole('dialog',{name:'角色信息',exact:true}).getByRole('button',{name:'關閉',exact:true}).click();
});
await check('inline display toggle retains information and places cards within the message body',async()=>{
  assert.ok(await page.locator('.mes_text > .csb-message-card').count()>0);await page.evaluate(()=>CSBCharacterState.setInlineCards(false));await page.waitForTimeout(200);assert.equal(await page.locator('.csb-message-card').count(),0);
  assert.equal(await page.evaluate(()=>CSBCharacterState.getSnapshot().state.characters.c_demo.values.identity),'持續保存的身份');await page.evaluate(()=>CSBCharacterState.setInlineCards(true));await page.waitForTimeout(200);assert.ok(await page.locator('.mes_text > .csb-message-card').count()>0);
});
assert.deepEqual(errors,[]);fs.writeFileSync(new URL('./artifacts/ui-results.json',import.meta.url),JSON.stringify({passed:checks.length,checks,pageErrors:errors},null,2));console.log(`PASS ${checks.length} browser scenarios; no page errors`);
}finally{await browser.close();server.close();}
