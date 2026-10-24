/** Real mobile iframe + IndexedDB integration. Only the SillyTavern host and
 * model response are fixtures; no external model/service is contacted. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require = createRequire(import.meta.url);
let playwright; try { playwright = require('playwright'); } catch { playwright = require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '', 'playwright')); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prefix = '/scripts/extensions/third-party/tavern-pocket', out = path.join(root, 'tests/artifacts');
await fs.mkdir(out, {recursive: true});
const mime = {'.html': 'text/html;charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml'};
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (p === '/scripts/personas.js') { res.setHeader('Content-Type', 'application/javascript'); res.end('export const user_avatar="";'); return; }
    if (p === '/scripts/world-info.js') { res.setHeader('Content-Type', 'application/javascript'); res.end('export const selected_world_info=[];export const world_info={charLore:[]};export async function checkWorldInfo(){return {allActivatedEntries:[]};}'); return; }
    if (p === '/version') { res.setHeader('Content-Type', 'application/json'); res.end('{"pkgVersion":"1.19.0"}'); return; }
    if (p === '/tests/avatar.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#9aab8c"/></svg>'); return; }
    if (p.startsWith(prefix + '/')) p = p.slice(prefix.length);
    const file = path.resolve(root, '.' + p); if (!file.startsWith(root + path.sep)) throw Error('path');
    const bytes = await fs.readFile(file); res.writeHead(200, {'Content-Type': mime[path.extname(file)] || 'application/octet-stream'}); res.end(bytes);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser, page;
const checks = [], errors = [], layouts = [], transactions = [], started = Date.now();
let contrast;
try {
  let executablePath = process.env.TP_CHROMIUM_PATH || playwright.chromium.executablePath();
  try { await fs.access(executablePath); } catch { executablePath = '/tmp/chromium'; await fs.access(executablePath); }
  browser = await playwright.chromium.launch({headless: true, executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--single-process']});
  page = await browser.newPage({viewport: {width: 430, height: 932}, deviceScaleFactor: 1, hasTouch: true, isMobile: true});
  page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/mock-host.html`);
  await page.locator('#sttts-floating .orb').waitFor();
  await page.waitForFunction(() => typeof globalThis.CSBCharacterState?.getRevision === 'function');
  await page.evaluate(async () => {
    const base = '/scripts/extensions/third-party/tavern-pocket/companions/csb-character-state';
    const {newDatabase, field, defaultSettings} = await import(base + '/src/schema.js');
    const db = newDatabase(), c = qa.context;
    db.schema.fields.push(field('persistentMark', '持久標記', 'basic', 'text'));
    db.seed.characters.c_me = {id: 'c_me', name: '公子', aliases: [], present: true, values: {age: '18', identity: '外門弟子'}};
    db.seed.characters.c_xia = {id: 'c_xia', name: '林知夏', aliases: [], present: true, values: {age: '26', identity: '醫修', mood: '平靜', persistentMark: '初始資料'}};
    db.seed.scene = {time: '4821-03-03 18:40', location: '青竹洞府·寢室'};
    c.extensionSettings.csb_character_state_v1 = {...defaultSettings(), inlineCards: true};
    c.chatMetadata.csb_character_state_v1 = db;
    await qa.emit('CHAT_CHANGED');
  });
  const frame = () => page.frames().find(item => item.url().endsWith('/ui/index.html'));
  const api = (fn, arg) => frame().evaluate(fn, arg);
  async function openPhone() {
    await page.locator('#sttts-floating .orb').click();
    await page.locator('#sttts-panel[open]').waitFor();
    await page.waitForFunction(() => !!document.querySelector('#sttts-panel iframe')?.contentWindow?.document.querySelector('.app-icon[data-app="characterinfo"]'));
    await api(() => { window.qaApi = parent.__stIphoniePanelBridge.connect(window); });
  }
  async function openApp(name) {
    const home = frame().locator('.app-nav [data-system="home"]');
    if (await home.isVisible()) await home.click();
    const tile = frame().locator(`.app-icon[data-app="${name}"]`);
    await tile.evaluate(el => el.closest('.home-page')?.scrollIntoView({behavior: 'instant', block: 'nearest', inline: 'start'}));
    await tile.tap();
    await frame().locator(`.view[data-app="${name}"]`).waitFor({state: 'visible'});
    await frame().waitForFunction(() => !document.querySelector('.screen')?.hasAttribute('data-opening'));
  }
  async function waitState(predicate) {
    const deadline = Date.now() + 15000;
    do {
      const value = await page.evaluate(() => CSBCharacterState.getSnapshot());
      if (predicate(value)) return value;
      await new Promise(resolve => setTimeout(resolve, 60));
    } while (Date.now() < deadline);
    throw Error('CSB state did not settle');
  }
  async function checkLayout(label, selectors) {
    const measurements = await api(selectors => {
      const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
      const roots = selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(visible).map(el => ({selector, el})));
      return {viewport: {width: innerWidth, height: innerHeight}, documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        elements: roots.map(({selector, el}) => { const rect = el.getBoundingClientRect(); return {selector, width: rect.width, scrollOverflow: el.scrollWidth - el.clientWidth, viewportOverflow: Math.max(0, -rect.left, rect.right - innerWidth)}; })};
    }, selectors);
    layouts.push({label, browserViewport: page.viewportSize(), ...measurements});
    assert.equal(measurements.elements.length >= selectors.length, true, label + ': all expected controls should be measurable');
    assert(measurements.documentOverflow <= 2, label + ': iframe document must fit horizontally');
    for (const item of measurements.elements) {
      assert(item.scrollOverflow <= 2, label + ': content overflow ' + JSON.stringify(item));
      assert(item.viewportOverflow <= 2, label + ': element extends beyond viewport ' + JSON.stringify(item));
    }
  }
  async function resize(width, height) {
    await page.setViewportSize({width, height});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await frame().evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  await openPhone(); await openApp('characterinfo');
  await frame().locator('.csb-information-app [data-char="c_xia"]').waitFor();
  assert.equal(await frame().locator('.csb-information-app [data-char]').count(), 2);
  assert((await frame().locator('.view[data-app="characterinfo"]').textContent()).includes('角色信息'));
  checks.push('430px mobile home opens the real embedded character information app with two saved characters');
  assert.equal(await frame().locator('.csb-information-toggle').isVisible(), false);
  assert.equal(await frame().locator('[data-character-inline]:visible').count(), 1);
  contrast = await api(() => {
    const app = document.querySelector('.csb-information-app');
    const bg = getComputedStyle(app).backgroundColor;
    const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
    const ratio = color => { const values = [luminance(color), luminance(bg)].sort((a, b) => b - a); return (values[0] + .05) / (values[1] + .05); };
    return {background: bg, headingRatio: ratio(getComputedStyle(app.querySelector('h2')).color), mutedRatio: ratio(getComputedStyle(app.querySelector('.csb-muted')).color)};
  });
  assert(contrast.headingRatio >= 4.5 && contrast.mutedRatio >= 4.5, 'embedded heading and explanatory copy must have readable contrast');
  const characterLayout = ['.view[data-app="characterinfo"]', '.character-info-toggle', '.csb-information-app', '.csb-information-app .csb-toolbar', '.csb-information-roster'];
  await checkLayout('character information at 430px', characterLayout);
  await resize(360, 800);
  await checkLayout('character information at 360px', characterLayout);
  await resize(430, 932);
  checks.push('character information has one visible inline switch, readable dark-panel contrast and no horizontal overflow at 360px/430px');

  const character = frame().locator('.csb-information-app [data-char="c_xia"]');
  await character.locator('summary').first().click();
  await character.getByRole('button', {name: '編輯角色', exact: true}).click();
  const editor = page.getByRole('dialog', {name: '編輯角色', exact: true});
  await editor.getByLabel('持久標記', {exact: true}).fill('手工設定保持不變');
  await editor.getByRole('button', {name: '儲存角色', exact: true}).click();
  await waitState(value => value.state.characters.c_xia.values.persistentMark === '手工設定保持不變');
  for (const dialog of await page.locator('dialog.csb-dialog').all()) if (await dialog.isVisible()) await dialog.getByRole('button', {name: '關閉', exact: true}).first().click();
  await page.evaluate(async () => {
    await qa.send('我將書卷放在桌邊。');
    await qa.send('接著詢問今日的安排。');
    const update = {version: 1, scene: {time: '4821-03-03 18:50'}, present: ['c_me'], characters: [{id: 'c_xia', set: {mood: '安心'}, reason: '聽見承諾後安心'}]};
    await qa.incomingRaw('她聽見承諾後安心，隨後暫時離開寢室。\n<CSB_UPDATE>' + JSON.stringify(update) + '</CSB_UPDATE>');
  });
  const persisted = await waitState(value => value.state.characters.c_xia.values.mood === '安心');
  assert.equal(persisted.state.characters.c_xia.values.persistentMark, '手工設定保持不變');
  assert.equal(persisted.state.characters.c_xia.present, false);
  assert.equal(persisted.state.characters.c_xia.values.identity, '醫修');
  checks.push('manual edit survives two user messages, a partial narrative update and leaving the scene');

  const toggle = frame().locator('[data-character-inline]');
  await toggle.uncheck();
  await waitState(value => value.inlineCards === false);
  await page.waitForFunction(() => document.querySelectorAll('.csb-message-card').length === 0);
  assert.equal((await page.evaluate(() => CSBCharacterState.getSnapshot())).state.characters.c_xia.values.persistentMark, '手工設定保持不變');
  await toggle.check(); await waitState(value => value.inlineCards === true);
  await page.locator('.csb-message-card').first().waitFor();
  checks.push('inline display can be disabled and re-enabled without clearing or freezing the database');
  await page.screenshot({path: path.join(out, 'jade-character-information-mobile.png'), animations: 'disabled'});

  const threadId = await api(async () => {
    const thread = await qaApi.createThread({type: 'dm', members: ['林知夏']});
    await qaApi.appendChat(thread.id, [{from: '林知夏', kind: 'text', text: '刪除前保留的私聊記錄'}]);
    return thread.id;
  });
  await openApp('chat');
  await frame().locator('[data-action="tab"][data-tab="contacts"]').click();
  await frame().locator('[data-action="profile"][data-name="林知夏"]').first().click();
  await frame().locator('[data-action="profile-delete"]').click();
  await frame().locator('.sheet-body [data-action="cancel"]').click();
  assert(await api(() => qaApi.chatContacts().some(contact => contact.name === '林知夏')));
  checks.push('canceling delete confirmation keeps the contact');
  await frame().locator('[data-action="profile-delete"]').click();
  await frame().locator('.sheet-body [data-action="confirm"]').click();
  await frame().waitForFunction(() => !qaApi.chatContacts().some(contact => contact.name === '林知夏'));
  await api(() => qaApi.pocketAction('sync', {}));
  await page.evaluate(() => qa.incoming({id: 'jade-deleted-contact-new-message', app: 'wechat', action: 'message', from: '林知夏', to: '你', text: '正文又提及這位已刪除聯絡人。'}));
  await api(() => qaApi.pocketAction('sync', {}));
  assert(!await api(() => qaApi.chatContacts().some(contact => contact.name === '林知夏')));
  assert(!await api(async id => (await qaApi.listThreads()).some(thread => thread.id === id), threadId));
  assert(await api(async id => (await qaApi.getThread(id)).messages.some(message => message.text === '刪除前保留的私聊記錄'), threadId));
  assert.equal((await page.evaluate(() => CSBCharacterState.getSnapshot())).state.characters.c_xia.values.persistentMark, '手工設定保持不變');
  assert.equal(await api(() => qaApi.getState().chat.deletedContacts.filter(contact => contact.name === '林知夏').length), 1);
  checks.push('delete hides contact and DM; old/new narrative synchronization cannot resurrect it; original DM and character information remain saved');
  await frame().locator('details[data-group="deleted-contacts"] summary').click();
  await frame().locator('[data-action="contact-restore"][data-name="林知夏"]').click();
  await frame().waitForFunction(() => qaApi.chatContacts().some(contact => contact.name === '林知夏'));
  assert(await api(async id => (await qaApi.listThreads()).some(thread => thread.id === id), threadId));
  assert.equal(await api(() => qaApi.chatContacts().find(contact => contact.name === '林知夏').persona), '喜歡咖啡、閱讀和散步。');
  checks.push('explicit restore recovers the original manual persona and DM history');

  // Seed old records using the production storage adapter. Settlement and new
  // payments below use the visible UI, real backend and real IndexedDB.
  await frame().locator('[data-action="profile"][data-name="林知夏"]').first().click();
  await frame().locator('[data-action="profile-chat"]').click();
  await frame().locator('.composer [data-action="panel"]').waitFor();
  await api(() => qaApi.walletSetBalance(300000, '瀏覽器測試期初靈石'));
  const initialBalance = await api(() => qaApi.wallet().balance);
  async function findPayment(paymentId) {
    return api(async ({id, paymentId}) => (await qaApi.getThread(id)).messages.find(message => message.paymentId === paymentId), {id: threadId, paymentId});
  }
  async function waitPayment(paymentId, state) {
    await frame().waitForFunction(async ({id, paymentId, state}) => (await qaApi.getThread(id)).messages.some(message => message.paymentId === paymentId && (!state || message.state === state)), {id: threadId, paymentId, state});
    return findPayment(paymentId);
  }
  async function openTool(name) {
    if (!await frame().locator(`[data-action="tool-${name}"]`).isVisible()) await frame().locator('.composer [data-action="panel"]').click();
    await frame().locator(`[data-action="tool-${name}"]`).click();
  }
  async function openPayment(message) {
    const card = frame().locator(`[data-action="${message.kind === 'redpacket' ? 'packet' : 'transfer'}"][data-mid="${message.id}"]`);
    await card.waitFor(); await card.click();
    await frame().locator('.sheet-body .po-amount').waitFor();
  }
  async function modelSettlement(paymentId, state, response) {
    await page.evaluate(response => { qa.nextResponse = response; }, response);
    await openTool('nudge');
    return waitPayment(paymentId, state);
  }
  const legacyIncoming = await api(async id => {
    const result = await qaApi.appendChat(id, [{from: '林知夏', kind: 'transfer', amount: '12.34', text: '升級前已存在的轉賬', state: 'sent', paymentId: 'qa-legacy-incoming'}]);
    return result.messages.find(message => message.paymentId === 'qa-legacy-incoming');
  }, threadId);
  await openPayment(legacyIncoming);
  assert.match(await frame().locator('.po-amount').textContent(), /12\.34.*下品/);
  await frame().locator('[data-action="transfer-accept"]').click();
  const acceptedLegacy = await waitPayment('qa-legacy-incoming', 'accepted');
  assert.equal(acceptedLegacy.amount, '12.34');
  assert.equal(await api(() => qaApi.wallet().balance), 300012.34);
  await api(({id, mid}) => qaApi.takeSent(id, mid, true), {id: threadId, mid: acceptedLegacy.id});
  assert.equal(await api(() => qaApi.wallet().balance), 300012.34, 'retrying an old receipt must not credit twice');
  transactions.push({case: 'legacy incoming transfer accepted through UI', amount: acceptedLegacy.amount, delta: 12.34, balance: 300012.34});
  checks.push('legacy 12.34 transfer displays as 12.34 lower stones, accepts unchanged through UI and credits once');

  async function sendWithUnit({kind, quantity, unit, amount, balance, text, narrow = false}) {
    await openTool(kind === 'redpacket' ? 'redpacket' : 'transfer');
    await frame().locator('.sheet [data-field="amount"]').fill(quantity);
    const selector = frame().locator('.sheet [data-field="amount-unit"]');
    assert.deepEqual(await selector.locator('option').evaluateAll(options => options.map(option => option.value)), ['lower', 'middle', 'supreme']);
    await selector.selectOption(unit);
    await frame().locator(`.sheet [data-field="${kind === 'redpacket' ? 'blessing' : 'note'}"]`).fill(text);
    const moneyLayout = ['.sheet', '.sheet-body', '.sheet [data-field="amount"]', '.sheet [data-field="amount-unit"]'];
    await checkLayout(kind + ' amount/unit form at 430px', moneyLayout);
    if (narrow) {
      await resize(360, 800);
      await checkLayout(kind + ' amount/unit form at 360px', moneyLayout);
      await page.screenshot({path: path.join(out, 'jade-transfer-unit-mobile.png'), animations: 'disabled'});
      await resize(430, 932);
    }
    await frame().locator(`[data-action="${kind === 'redpacket' ? 'packet-send' : 'transfer-send'}"]`).click();
    await frame().locator('.sheet').waitFor({state: 'hidden'});
    const message = await api(async ({id, text}) => (await qaApi.getThread(id)).messages.findLast(message => message.from === 'me' && message.text === text), {id: threadId, text});
    assert(message, 'UI payment must be stored');
    assert.equal(message.amount, amount.toFixed(2));
    assert.equal(await api(() => qaApi.wallet().balance), balance);
    const journal = await api(paymentId => qaApi.wallet().journal.find(row => row.id === 'send:' + paymentId), message.paymentId);
    assert.equal(journal.amount, -amount); assert.equal(journal.status, 'done');
    // Replay the normalized payload emitted by the UI to model an interrupted
    // acknowledgement, while retaining the same payment id.
    await api(({id, message, amount}) => qaApi.sendPaid(id, {kind: message.kind, amount, unit: 'lower', text: message.text, paymentId: message.paymentId}), {id: threadId, message, amount});
    assert.equal(await api(() => qaApi.wallet().balance), balance, 'UI retry cannot convert or debit again');
    assert.equal(await api(async ({id, paymentId}) => (await qaApi.getThread(id)).messages.filter(message => message.paymentId === paymentId).length, {id: threadId, paymentId: message.paymentId}), 1);
    transactions.push({case: 'new ' + kind + ' sent through UI', quantity, unit, storedAmount: message.amount, delta: -amount, balance, retryBalance: balance});
    return message;
  }
  const middle = await sendWithUnit({kind: 'transfer', quantity: '2', unit: 'middle', amount: 200, balance: 299812.34, text: '中品單次換算測試', narrow: true});
  await modelSettlement(middle.paymentId, 'accepted', '林知夏：[收款]');
  assert.equal(await api(() => qaApi.wallet().balance), 299812.34);
  const supreme = await sendWithUnit({kind: 'redpacket', quantity: '1', unit: 'supreme', amount: 100000, balance: 199812.34, text: '極品單次換算測試'});
  await modelSettlement(supreme.paymentId, 'opened', '林知夏：[領取紅包]');
  assert.equal(await api(() => qaApi.wallet().balance), 199812.34);
  checks.push('visible middle/supreme selectors send 2 middle = 200 lower and 1 supreme = 100000 lower; retries and recipient acceptance never debit twice or round legacy tails');

  const legacyRejected = await api(async id => {
    const result = await qaApi.appendChat(id, [{from: '林知夏', kind: 'transfer', amount: '45.67', text: '升級前待退還的轉賬', state: 'sent', paymentId: 'qa-legacy-rejected'}]);
    return result.messages.find(message => message.paymentId === 'qa-legacy-rejected');
  }, threadId);
  await openPayment(legacyRejected);
  assert.match(await frame().locator('.po-amount').textContent(), /45\.67.*下品/);
  await frame().locator('[data-action="transfer-return"]').click();
  assert.equal((await waitPayment('qa-legacy-rejected', 'returned')).amount, '45.67');
  await api(({id, mid}) => qaApi.takeSent(id, mid, false), {id: threadId, mid: legacyRejected.id});
  assert.equal(await api(() => qaApi.wallet().balance), 199812.34);
  assert.equal(await api(() => qaApi.wallet().journal.find(row => row.id === 'take:qa-legacy-rejected').amount), 0);
  transactions.push({case: 'legacy incoming transfer rejected through UI', amount: '45.67', delta: 0, balance: 199812.34});

  // Unmarked calls are the pre-upgrade payment API. Seed a pending old payment,
  // then let a mocked contact's reply pass through the real UI/model parser.
  await api(id => qaApi.sendPaid(id, {kind: 'transfer', amount: '8.88', text: '升級前等待對方退款', paymentId: 'qa-legacy-refund'}), threadId);
  assert.equal(await api(() => qaApi.wallet().balance), 199803.46);
  const refund = await waitPayment('qa-legacy-refund', 'sent');
  await openPayment(refund);
  assert.match(await frame().locator('.po-amount').textContent(), /8\.88.*下品/);
  await frame().locator('[data-sheet-close]').click();
  assert.equal((await modelSettlement('qa-legacy-refund', 'returned', '林知夏：[退還]')).amount, '8.88');
  assert.equal(await api(() => qaApi.wallet().balance), 199812.34);
  assert.equal(await api(() => qaApi.wallet().journal.find(row => row.id === 'claim:qa-legacy-refund').amount), 8.88);
  await page.evaluate(() => { qa.nextResponse = '林知夏：[退還]'; });
  await openTool('nudge');
  await frame().waitForFunction(() => !parent.qa.nextResponse);
  await frame().waitForFunction(id => !qaApi.chatTyping(id), threadId);
  assert.equal(await api(() => qaApi.wallet().balance), 199812.34);
  assert.equal(await api(() => qaApi.wallet().journal.filter(row => row.id === 'claim:qa-legacy-refund').length), 1);
  transactions.push({case: 'legacy outgoing transfer returned by contact via UI reply', amount: '8.88', debitBalance: 199803.46, refund: 8.88, balance: 199812.34});
  checks.push('old 45.67 incoming rejection moves no money; old 8.88 outgoing refund returns exactly 8.88 once and preserves original amounts');
  assert.equal(initialBalance, 300000);
  await checkLayout('chat after payments at 430px', ['.view[data-app="chat"]', '.composer']);
  await resize(360, 800);
  await checkLayout('chat after payments at 360px', ['.view[data-app="chat"]', '.composer']);
  await resize(430, 932);

  await openApp('characterinfo');
  await frame().locator('.csb-information-app [data-char="c_xia"]').waitFor();
  assert.equal(await frame().locator('.csb-information-app [data-char]').count(), 2);
  await page.reload();
  await page.waitForFunction(() => typeof globalThis.CSBCharacterState?.getRevision === 'function');
  await waitState(value => value?.state?.characters?.c_xia?.values?.persistentMark === '手工設定保持不變');
  await openPhone(); await openApp('characterinfo');
  await frame().locator('.csb-information-app [data-char="c_xia"]').waitFor();
  assert(await api(() => qaApi.chatContacts().some(contact => contact.name === '林知夏')));
  assert.equal(await api(() => qaApi.wallet().balance), 199812.34);
  assert.equal((await findPayment('qa-legacy-incoming')).amount, '12.34');
  assert.equal((await findPayment('qa-legacy-rejected')).amount, '45.67');
  assert.equal((await findPayment('qa-legacy-refund')).amount, '8.88');
  checks.push('page reload restores saved character information, contact restoration, exact wallet balance and original legacy transaction amounts');
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(out, 'browser-jade-report.json'), JSON.stringify({passed: true, viewports: [{width: 430, height: 932}, {width: 360, height: 800}], elapsedMs: Date.now() - started, checks, transactions, contrast, layouts, pageErrors: errors, realHost: false, realPhone: false}, null, 2));
  console.log(JSON.stringify({passed: true, checks, elapsedMs: Date.now() - started}));
} catch (error) {
  if (page) await page.screenshot({path: path.join(out, 'jade-failure.png'), animations: 'disabled'}).catch(() => {});
  await fs.writeFile(path.join(out, 'browser-jade-report.json'), JSON.stringify({passed: false, checks, transactions, contrast, layouts, error: String(error.stack || error), pageErrors: errors}, null, 2));
  console.error(error); process.exitCode = 1;
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
