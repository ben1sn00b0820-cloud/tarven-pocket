/** Actual extension entry + backend + phone iframe. SillyTavern and model responses
 * are local fixtures; no external synthesis/model services are contacted. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); }
catch { playwright = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '', 'playwright')); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prefix = '/scripts/extensions/third-party/tavern-pocket';
const out = path.join(root, 'tests/artifacts');
await fs.mkdir(out, {recursive: true});
const types = {'.html': 'text/html;charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml'};
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (p === '/scripts/personas.js') { res.setHeader('Content-Type', 'application/javascript'); res.end('export const user_avatar="";'); return; }
    if (p === '/scripts/world-info.js') { res.setHeader('Content-Type', 'application/javascript'); res.end('export const selected_world_info=[];export const world_info={charLore:[]};export async function checkWorldInfo(){return {allActivatedEntries:[]};}'); return; }
    if (p === '/version') { res.setHeader('Content-Type', 'application/json'); res.end('{"pkgVersion":"1.19.0"}'); return; }
    if (p === '/tests/avatar.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#9aab8c"/></svg>'); return; }
    if (p.startsWith(prefix + '/')) p = p.slice(prefix.length);
    const file = path.resolve(root, '.' + p);
    if (!file.startsWith(root + path.sep)) throw Error('path');
    const bytes = await fs.readFile(file);
    res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'});
    res.end(bytes);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
const checks = [], errors = [], network = [];
try {
  browser = await playwright.chromium.launch({headless: true, executablePath: process.env.TP_CHROMIUM_PATH || '/tmp/moxu-chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader']});
  const page = await browser.newPage({viewport: {width: 430, height: 932}, hasTouch: true, isMobile: true, reducedMotion: 'reduce'});
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:')) network.push(request.url()); });
  await page.addInitScript(() => {
    if (window === window.top) localStorage.setItem('tp-qa-host-fixture', JSON.stringify({settings: {disabledExtensions: [], stTtsDialogue: {theme: 'light', general: {voiceEnabled: true, floatingEnabled: true}, routes: [{id: 'legacy-role', name: '林知夏', engine: 'fish', voice: 'saved-voice-id', appearance: 'short black hair'}], chat: {contacts: [{id: 'contact-xia', name: '林知夏', persona: '喜歡閱讀的朋友。'}]}}}}));
    Object.defineProperty(window, 'AudioContext', {value: undefined, configurable: true});
    Object.defineProperty(window, 'webkitAudioContext', {value: undefined, configurable: true});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/mock-host.html`);
  await page.locator('#sttts-floating .orb').waitFor();
  await page.waitForFunction(() => !!window.__stIphoniePanelBridge && typeof window.CSBCharacterState?.getSnapshot === 'function');
  assert.equal(await page.evaluate(() => typeof AudioContext), 'undefined');
  assert.equal(await page.locator('#sttts-all, #sttts-toggle, #sttts-stop').count(), 0);
  checks.push('actual entry enables without AudioContext and has no playback extension controls');

  const raw = '她將杯子放到桌上。\n\n「今晚……一起喝茶，好不好。」\n\n“今晚……一起喝茶，好不好。”<tts>林知夏|平靜|今晚……一起喝茶，好不好。</tts>\n\n她靜靜等候回答。';
  const id = await page.evaluate(text => qa.incomingRaw(text), raw);
  const rendered = await page.locator(`.mes[mesid="${id}"] .mes_text`).textContent();
  assert.equal(rendered.split('一起喝茶').length - 1, 1);
  assert(rendered.includes('她靜靜等候回答。'));
  assert.doesNotMatch(rendered, /<tts>|林知夏\|平靜/);
  assert.equal(await page.locator('[data-sttts-line], [data-sttts-action="line"]').count(), 0);
  assert.equal(await page.evaluate(id => qa.context.chat[id].mes, id), raw);
  checks.push('legacy adjacent duplicate dialogue renders once; no wave control; raw stored story unchanged');
  const outgoing = await page.evaluate(async () => {
    const originals = qa.context.chat.slice(), copies = qa.context.chat.slice();
    await stIphonieInterceptor(copies);
    await qa.emit('GENERATION_AFTER_COMMANDS', 'normal', {});
    return {clean: copies.at(-1).mes, saved: originals.at(-1).mes, replaced: copies.at(-1) !== originals.at(-1), prompts: qa.prompts};
  });
  assert.equal(outgoing.clean.split('一起喝茶').length - 1, 1);
  assert.doesNotMatch(outgoing.clean, /<tts>/i);
  assert.equal(outgoing.saved, raw);
  assert.equal(outgoing.replaced, true);
  assert(outgoing.prompts['sttts.entry.narrative'].includes('每句台詞只寫一次'));
  assert(!Object.entries(outgoing.prompts).some(([key, value]) => value && /^sttts\.entry\.(?:format|language|rules|dialogue|voice)/.test(key)));
  assert(!Object.values(outgoing.prompts).some(value => String(value).includes('{译文}') || String(value).includes('{角色}|{情绪}|{文本}')));
  checks.push('newest outgoing model copy loses speech markup/copy; speech-generation contract no longer injected');

  await page.locator('#sttts-floating .orb').click();
  await page.locator('#sttts-panel[open]').waitFor();
  await page.waitForFunction(() => !!document.querySelector('#sttts-panel iframe')?.contentWindow?.document.querySelector('.app-icon[data-app="roles"]'));
  const frame = page.frames().find(item => item.url().endsWith('/ui/index.html'));
  await frame.evaluate(() => { window.qaApi = parent.__stIphoniePanelBridge.connect(window); });
  const clock = frame.locator('.home [data-clock="large"]').first(), date = frame.locator('.home [data-clock="date"]').first();
  assert.equal(await clock.textContent(), '—');
  assert.equal(await date.textContent(), '劇情時間未設定');
  assert.equal(await frame.locator('.home .app-icon[data-app="roles"]').first().textContent(), '角色庫');
  assert.equal(await frame.locator('[data-app="listen"], [data-app="library"], [data-widget="player"]').count(), 0);
  assert.equal(await frame.evaluate(() => qaApi.capabilities.tts), false);
  assert.equal(await frame.evaluate(() => qaApi.getState().general.voiceEnabled), false);
  assert.equal(await frame.evaluate(() => qaApi.getState().routes.find(role => role.name === '林知夏').appearance), 'short black hair');
  checks.push('old voice-enabled settings migrate to text-only; role appearance retained; real iframe has no speech apps and unknown story clock');

  await frame.locator('.home [data-system="story-time"]').click();
  await frame.locator('[data-story-field="date"]').fill('天元三年霜月初三');
  await frame.locator('[data-story-field="time"]').fill('子時');
  await frame.locator('[data-story-save]').click();
  await frame.waitForFunction(() => document.querySelector('.home [data-clock=large]')?.textContent === '子時');
  assert.equal(await clock.textContent(), '子時');
  assert.equal(await date.textContent(), '天元三年霜月初三');
  assert.equal(await frame.evaluate(async () => (await qaApi.pocketState()).storyTime.source), 'manual');
  await page.screenshot({path: path.join(out, 'integrated-no-tts-story-clock.png'), animations: 'disabled'});
  const original = await page.evaluate(() => ({chatId: qa.context.chatId, metadata: qa.context.chatMetadata, chat: qa.context.chat.slice()}));
  await page.evaluate(async () => {
    qa.context.chatId = 'qa-clock-separate'; qa.context.chatMetadata = {};
    qa.context.chat.splice(0, qa.context.chat.length, {name: '林知夏', is_user: false, is_system: false, mes: '清風拂過窗邊。', extra: {}});
    await qa.emit('CHAT_CHANGED');
  });
  await frame.waitForFunction(async () => !(await qaApi.pocketState()).storyTime.known);
  await frame.waitForFunction(() => document.querySelector('.home [data-clock=large]')?.textContent === '—');
  assert.equal(await clock.textContent(), '—');
  await page.evaluate(async original => {
    qa.context.chatId = original.chatId; qa.context.chatMetadata = original.metadata;
    qa.context.chat.splice(0, qa.context.chat.length, ...original.chat);
    await qa.emit('CHAT_CHANGED');
  }, original);
  await frame.waitForFunction(async () => (await qaApi.pocketState()).storyTime.time === '子時');
  await frame.waitForFunction(() => document.querySelector('.home [data-clock=large]')?.textContent === '子時');
  assert.equal(await clock.textContent(), '子時');
  checks.push('visible manual editor saves through real bridge and metadata; chat switch isolates and restores the clock');
  await frame.evaluate(() => qaApi.setStoryTime(null));
  await page.evaluate(() => qa.incomingRaw('劇情時間：天元三年霜月初四 子時\n\n她推開窗戶。'));
  await frame.waitForFunction(async () => (await qaApi.pocketState()).storyTime.known);
  assert.equal(await frame.evaluate(async () => (await qaApi.pocketState()).storyTime.source), 'narrative');
  await frame.waitForFunction(() => document.querySelector('.home [data-clock=date]')?.textContent.includes('天元三年霜月初四'));
  assert((await date.textContent()).includes('天元三年霜月初四'));
  checks.push('clearing manual override follows an explicit story-time marker from incoming narrative');

  // Production phone-card renderer and message sync still receive ordinary story content.
  const cardId = await page.evaluate(() => qa.incomingRaw('她低頭在手機上輸入訊息。\n<phone>' + JSON.stringify({id: 'no-tts-message', app: 'wechat', action: 'message', from: '林知夏', to: '你', text: '這是移除語音後仍保留的手機訊息。'}) + '</phone>\n<img>tea cup, wooden table|林知夏</img>'));
  assert((await page.locator(`.mes[mesid="${cardId}"] .mes_text`).textContent()).includes('這是移除語音後仍保留的手機訊息。'));
  await page.locator(`.mes[mesid="${cardId}"] [data-sttts-pic]`).waitFor();
  assert(await frame.evaluate(async () => (await qaApi.listThreads()).length > 0));
  checks.push('phone message cards, picture placeholders and real chat synchronization remain active');
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  await fs.writeFile(path.join(out, 'browser-no-tts-report.json'), JSON.stringify({checks, errors, externalRequests: network}, null, 2));
  console.log(JSON.stringify({passed: checks.length, checks}, null, 2));
} catch (error) {
  await fs.writeFile(path.join(out, 'browser-no-tts-report.json'), JSON.stringify({checks, errors, externalRequests: network, failure: error.message}, null, 2));
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
