/** Isolated @ picker regression using actual browser layout and input events.
 * TP_CHROMIUM_PATH=/path/to/chrome node tests/browser-mentions.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);let playwright;
try{playwright=require('playwright');}catch{playwright=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'','playwright'));}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),artifacts=path.join(root,'tests/artifacts');
await fs.mkdir(artifacts,{recursive:true});
const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/pocket/composer.css"><style>body{margin:0;background:#111e29;color:#eee;font:16px system-ui}#send_form{position:fixed;bottom:10px;left:10px;right:10px;display:flex;align-items:center}textarea{box-sizing:border-box;width:calc(100% - 48px);height:84px;font:16px system-ui}button{font:inherit}</style><form id="send_form"><textarea id="send_textarea" aria-label="正文草稿"></textarea><span id="leftSendForm"></span></form><script type="module">import {createMemoryComposer} from '/pocket/composer.js';window.fixture={reads:0,sends:0,state:{persona:'旅人',profile:{name:'旅人'},items:[{id:'box',name:'補給箱',description:'長篇說明'.repeat(80),quantity:3},{id:'bag',name:'補給袋',description:'小袋',quantity:1}],abilities:[{id:'light',name:'星光',description:'照明'}]},hold:null};window.picker=createMemoryComposer({getState:async()=>{fixture.reads++;if(fixture.hold)await fixture.hold;return structuredClone(fixture.state);}});document.addEventListener('keydown',e=>{if(e.target.id==='send_textarea'&&e.key==='Enter'&&!e.shiftKey){fixture.sends++;e.preventDefault();}});document.querySelector('form').onsubmit=e=>e.preventDefault();</script>`;
const server=createServer(async(req,res)=>{try{const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/'){res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end(html);return;}const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep))throw Error('path');const bytes=await fs.readFile(file);res.writeHead(200,{'content-type':path.extname(file)==='.css'?'text/css':'text/javascript'});res.end(bytes);}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;const errors=[],checks=[];
try{
 browser=await playwright.chromium.launch({headless:true,executablePath:process.env.TP_CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.locator('#tp-memory-button').waitFor();
 const input=page.locator('#send_textarea'),panel=page.locator('#tp-memory-picker');
 await input.fill('拿出@補');await page.locator('[data-tp-memory-pick="items:box"]').waitFor();
 await page.screenshot({path:path.join(artifacts,'mentions-inline-mobile.png')});
 const reads=await page.evaluate(()=>fixture.reads);
 await page.evaluate(()=>window.firstOption=document.querySelector('[data-tp-memory-pick="items:box"]'));
 await input.pressSequentially('給箱');
 await page.waitForFunction(()=>document.querySelectorAll('[data-tp-memory-pick]').length===1);
 assert.equal(await page.evaluate(()=>fixture.reads),reads);
 assert.equal(await page.evaluate(()=>firstOption===document.querySelector('[data-tp-memory-pick="items:box"]')),true);
 await input.press('Enter');await page.waitForFunction(()=>document.querySelector('#send_textarea').value.includes('@【物品：補給箱'));
 assert.equal(await page.evaluate(()=>fixture.sends),0);assert.equal(await panel.isVisible(),false);
 checks.push('typing reuses the search snapshot and DOM rows; Enter inserts a reference without submitting');
 await input.fill('@');await page.locator('[data-tp-memory-pick]').first().waitFor();
 await page.evaluate(()=>{const el=document.querySelector('#send_textarea');el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.value='@星';el.setSelectionRange(2,2);el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));el.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter',keyCode:229,isComposing:true}));});
 assert.equal(await page.evaluate(()=>fixture.sends),0);assert.equal(await input.inputValue(),'@星');
 await page.evaluate(()=>document.querySelector('#send_textarea').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'星'})));
 await page.locator('[data-tp-memory-pick="abilities:light"]').waitFor();await input.press('Enter');
 await page.waitForFunction(()=>document.querySelector('#send_textarea').value.includes('@【能力：星光'));
 checks.push('Chinese IME composition neither submits nor inserts prematurely');
 await input.fill('前文後文');await input.evaluate(el=>el.setSelectionRange(2,2));await page.locator('#tp-memory-button').click();
 await page.locator('[data-tp-memory-tab="items"]').click();await page.locator('[data-tp-memory-pick="items:box"]').tap();
 await page.waitForFunction(()=>document.querySelector('#send_textarea').value.includes('@【物品：補給箱'));
 const draft=await input.inputValue();assert(draft.startsWith('前文@【'));assert(draft.endsWith('後文'));
 await page.locator('[data-tp-memory-tab="abilities"]').click();await page.locator('[data-tp-memory-pick="abilities:light"]').tap();
 await page.waitForFunction(()=>document.querySelector('#send_textarea').value.includes('@【能力：星光'));
 assert.equal((await input.inputValue()).match(/@【/g).length,2);assert.equal(await panel.isVisible(),true);
 checks.push('touch selection inserts repeated references at the saved caret without replacing following prose');
 await page.locator('[data-tp-memory-close]').click();await input.fill('@補給箱');await page.locator('[data-tp-memory-pick="items:box"]').waitFor();
 await page.evaluate(()=>fixture.state.items=[]);await page.locator('[data-tp-memory-pick="items:box"]').tap();
 await page.waitForFunction(()=>document.querySelector('.tp-memory-empty'));assert.equal(await input.inputValue(),'@補給箱');
 checks.push('deleting an asset after search prevents stale insertion');
 await page.evaluate(()=>picker.close());await input.fill('');await page.locator('#tp-memory-button').click();await page.locator('[data-tp-memory-tab="profile"]').click();
 for(const height of [844,360,180]){
  await page.setViewportSize({width:320,height});await page.waitForTimeout(70);const b=await panel.boundingBox();assert(b.x>=0&&b.y>=0&&b.x+b.width<=321&&b.y+b.height<=height+1);assert(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1));if(height===360)await page.screenshot({path:path.join(artifacts,'mentions-keyboard-320.png')});
 }
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{const view=new EventTarget();Object.assign(view,{offsetTop:120,offsetLeft:0,width:390,height:300});Object.defineProperty(window,'visualViewport',{configurable:true,value:view});window.dispatchEvent(new Event('resize'));});
 await page.waitForTimeout(70);const b=await panel.boundingBox();assert(b.y>=120&&b.y+b.height<=421);
 checks.push('320px, keyboard-height, tiny landscape and shifted visual viewports keep the picker inside visible bounds');
 await page.evaluate(()=>{picker.close();fixture.hold=new Promise(resolve=>fixture.release=resolve);picker.open();picker.dispose();fixture.release();});
 await page.waitForTimeout(40);assert.equal(await page.locator('#tp-memory-picker').count(),0);assert.equal(await page.locator('#tp-memory-button').count(),0);
 assert.deepEqual(errors,[]);checks.push('disposing during a pending read removes the popup and ignores late completion');
 console.log(JSON.stringify({passed:checks.length,checks},null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
