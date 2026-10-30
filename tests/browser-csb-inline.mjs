/** Inline CSB regression harness using the real phone host and companion modules.
 * Only SillyTavern APIs/model responses are mocked. No paid model requests.
 * TP_CHROMIUM_PATH=/path/to/chrome node tests/browser-csb-inline.mjs
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
const report=async(status,failure)=>fs.writeFile(path.join(out,'browser-csb-inline-report.json'),JSON.stringify({status,checks,errors,failure,limitations:'Actual phone, iframe and companion code; SillyTavern event bus/model calls mocked.'},null,2));
try{
  browser=await playwright.chromium.launch({headless:true,executablePath:process.env.TP_CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  page=await browser.newPage({viewport:{width:1280,height:1000}});page.setDefaultTimeout(8000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/mock-host.html`);
  await page.waitForFunction(()=>globalThis.CSBCharacterStateRuntime?.version==='1.4.0');
  const card=index=>page.locator(`.mes[mesid="${index}"] .csb-message-card`);
  await card(0).waitFor();
  assert.equal(await card(0).count(),1);
  assert.equal(await page.evaluate(()=>Object.keys(CSBCharacterState.getSnapshot().state.characters).length),0);
  assert((await card(0).textContent()).includes('尚未建立角色'));
  checks.push('empty database shows one honest latest-assistant status panel without inventing characters');

  await page.evaluate(async()=>{
    const {newDatabase,defaultSettings}=await import('/scripts/extensions/third-party/tavern-pocket/companions/csb-character-state/src/schema.js');
    const db=newDatabase();db.seed.characters.c_xia={id:'c_xia',name:'林知夏',aliases:[],present:true,values:{energy:42,mood:'平靜'}};
    qa.context.chatMetadata.csb_character_state_v1=db;
    qa.context.extensionSettings.csb_character_state_v1={...defaultSettings(),autoScan:'off'};
    await qa.emit('CHAT_CHANGED');
  });
  const plain=await page.evaluate(()=>qa.incomingRaw('林知夏將杯子放回桌面，望向窗外。'));
  await card(plain).waitFor();
  assert.equal(await card(plain).count(),1);
  assert.equal(await page.evaluate(i=>qa.context.chat[i].mes,plain),'林知夏將杯子放回桌面，望向窗外。');
  assert.equal(await page.evaluate(i=>document.querySelector(`.mes[mesid="${i}"] .mes_text`).lastElementChild.classList.contains('csb-message-card'),plain),true);
  checks.push('ordinary narrative without CSB_UPDATE retains source text and appends one status card');

  await page.evaluate(i=>{
    const box=document.querySelector(`.mes[mesid="${i}"] .mes_text`);
    box.innerHTML='<p>林知夏將杯子放回桌面，望向窗外。</p><section id="foreign-status"><button>原始狀態欄</button></section>';
    window.foreignStatus=box.querySelector('#foreign-status');window.foreignClicks=0;
    foreignStatus.querySelector('button').addEventListener('click',()=>foreignClicks++);
  },plain);
  await card(plain).waitFor();await page.locator('#foreign-status button').click();
  assert.equal(await page.evaluate(()=>document.querySelector('#foreign-status')===foreignStatus&&foreignClicks===1),true);
  checks.push('silent host DOM replacement restores CSB while retaining foreign status node and handlers');

  await page.evaluate(i=>{
    const old=document.querySelector(`.mes[mesid="${i}"] .mes_text`),next=document.createElement('div');
    next.className='mes_text';next.innerHTML='<p>替換整個正文容器。</p>';next.append(foreignStatus);old.replaceWith(next);
  },plain);
  await card(plain).waitFor();assert.equal(await card(plain).count(),1);
  checks.push('replacing the entire mes_text node recovers exactly one inline card without a host event');

  const mixed=await page.evaluate(async()=>{
    const update={version:1,characters:[{id:'c_xia',set:{energy:80},reason:'已休息'}]};
    return qa.incomingRaw('她休息片刻。<CSB_UPDATE>'+JSON.stringify(update)+'</CSB_UPDATE>接著繼續交談。');
  });
  await card(mixed).waitFor();
  await page.evaluate(i=>{
    const box=document.querySelector(`.mes[mesid="${i}"] .mes_text`);box.replaceChildren();
    const p=document.createElement('p');p.textContent=qa.context.chat[i].mes;box.append(p,foreignStatus);
    window.originalMixed=qa.context.chat[i].mes;
  },mixed);
  await page.waitForFunction(i=>!document.querySelector(`.mes[mesid="${i}"] .mes_text`).textContent.includes('<CSB_UPDATE>'),mixed);
  await card(mixed).waitFor();
  assert.equal(await page.evaluate(()=>document.querySelector('#foreign-status')===foreignStatus),true);
  assert.equal(await page.evaluate(i=>qa.context.chat[i].mes===originalMixed,mixed),true);
  await page.locator('#foreign-status button').click();assert.equal(await page.evaluate(()=>foreignClicks),2);
  checks.push('machine block removal is local: raw message, unrelated markup and attached handlers survive');

  await page.evaluate(()=>CSBCharacterState.setInlineCards(false));
  await page.waitForFunction(()=>document.querySelectorAll('.csb-message-card').length===0);
  assert.equal(await page.evaluate(()=>document.querySelector('#foreign-status')===foreignStatus),true);
  await page.evaluate(()=>CSBCharacterState.setInlineCards(true));await card(mixed).waitFor();
  assert.equal(await card(mixed).count(),1);
  checks.push('inline off/on removes and restores cards once without changing original status or stored values');

  await page.evaluate(async()=>{qa.context.extensionSettings.csb_character_state_v1.enabled=false;await qa.emit('MESSAGE_UPDATED',qa.context.chat.length-1);});
  await page.waitForFunction(()=>document.querySelectorAll('.csb-message-card').length===0);
  assert.equal(await page.evaluate(i=>document.querySelector(`.mes[mesid="${i}"] .mes_text`).textContent.includes('<CSB_UPDATE>'),mixed),true);
  await page.evaluate(async()=>{qa.context.extensionSettings.csb_character_state_v1.enabled=true;await qa.emit('MESSAGE_UPDATED',qa.context.chat.length-1);});
  await card(mixed).waitFor();
  assert.equal(await page.evaluate(i=>document.querySelector(`.mes[mesid="${i}"] .mes_text`).textContent.includes('<CSB_UPDATE>'),mixed),false);
  checks.push('full CSB disable/enable restores and rehides only the original machine fragment');

  const stream=await page.evaluate(async()=>{
    qa.context.isGenerating=true;qa.context.streamingProcessor={isFinished:false,isStopped:false,type:'normal'};
    await qa.emit('GENERATION_STARTED','normal',{},false);
    return qa.incomingRaw('尚未完成的串流');
  });
  await page.waitForTimeout(650);assert.equal(await card(stream).count(),0);
  await page.evaluate(i=>{
    qa.context.chat[i].mes='串流完成後，她靜靜坐下。';
    qa.context.isGenerating=false;qa.context.streamingProcessor.isFinished=true;
    qa.context.updateMessageBlock(i,qa.context.chat[i]);
  },stream);
  await card(stream).waitFor();assert.equal(await card(stream).count(),1);
  checks.push('active streaming is untouched; final silent redraw restores card even without GENERATION_ENDED');

  const failure=await page.evaluate(async()=>{
    const c=qa.context,old=c.chatMetadata.csb_character_state_v1;c.chatMetadata.csb_character_state_v1={...old,schema:{...old.schema,fields:null}};
    let aborted=false,rejected=false;
    try{await CSBCharacterStateRuntime.intercept(c.chat,8192,()=>{aborted=true;},'normal');}catch{rejected=true;}
    const result={aborted,rejected,prompt:qa.prompts.csb_character_state_v1};c.chatMetadata.csb_character_state_v1=old;return result;
  });
  assert.deepEqual(failure,{aborted:false,rejected:false,prompt:''});
  checks.push('invalid auxiliary state clears its prompt and never aborts or rejects the story generation');

  await page.evaluate(()=>{window.inlineLifecycle=CSBCharacterStateRuntime;inlineLifecycle.dispose();});
  assert.equal(await page.locator('.csb-message-card').count(),0);
  assert.equal(await page.evaluate(()=>!globalThis.CSBCharacterStateRuntime&&document.querySelector('#foreign-status')===foreignStatus),true);
  await page.evaluate(()=>inlineLifecycle.initialize());await card(stream).waitFor();
  const before=await page.evaluate(()=>qa.hostCalls.saveMetadata);
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(()=>qa.hostCalls.saveMetadata),before);
  assert.equal(await page.locator('#csb-launcher').count(),1);
  assert.equal(await card(stream).count(),1);
  checks.push('dispose/reinitialize releases observers and lifecycle ownership; stable DOM causes no save/render loop');
  await page.screenshot({path:path.join(out,'csb-inline-regression.png'),animations:'disabled'});

  const oldPage=page;page=await browser.newPage({viewport:{width:1280,height:1000}});page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/mock-host.html?external=1`);
  await page.waitForFunction(()=>globalThis.CSBCharacterStateRuntime?.version==='1.4.0');
  await page.locator('#sttts-floating .orb').waitFor();
  await page.locator('.csb-message-card').waitFor();
  assert.equal(await page.locator('#csb-launcher').count(),1);
  assert.equal(await page.locator('#tp-csb-style').count(),1);
  assert.equal(await page.locator('.csb-message-card').count(),1);
  checks.push('a current standalone loaded before the phone shares one runtime, launcher, stylesheet and inline card');
  await oldPage.close();
  assert.deepEqual(errors,[]);await report('passed');console.log(JSON.stringify({status:'passed',checks:checks.length,errors},null,2));
}catch(error){
  await page?.screenshot({path:path.join(out,'csb-inline-failure.png'),animations:'disabled'}).catch(()=>{});
  await report('failed',error.stack);console.error(error);process.exitCode=1;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
