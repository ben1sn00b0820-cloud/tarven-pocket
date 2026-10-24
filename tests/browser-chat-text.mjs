/** Browser regression for text-only chat and legacy voice-message history.
 * TP_CHROMIUM_PATH=/path/to/chromium node tests/browser-chat-text.mjs
 */
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
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end('<!doctype html><html><body></body></html>'); return; }
    const file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep)) throw Error('path');
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : 'text/plain');
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await playwright.chromium.launch({headless: true, executablePath: process.env.TP_CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage']});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => {
    const {chatApp} = await import('/ui/chat.js');
    const {callScreen} = await import('/ui/call.js');
    const now = Date.now();
    const thread = {id: 'old-chat', type: 'dm', name: '林夏', members: ['林夏'], unread: 0, messages: [
      {id: 'original', from: '林夏', kind: 'voice', text: '保留下來的原文', at: now},
      {id: 'translated', from: '林夏', kind: 'voice', text: 'Original dialogue', translation: '保留下來的譯文', at: now},
      {id: 'escaped', from: '林夏', kind: 'voice', text: '<img src=x onerror=alert(1)>', at: now},
      {id: 'call-log', from: '林夏', kind: 'call', state: 'missed', voicemail: [{text: '稍後再聊', from: '林夏'}], at: now}
    ]};
    thread.last = thread.messages[0];
    window.qa = {thread, notifications: [], actions: [], speechCalls: []};
    const profile = {name: '我', status: 'online', frame: 'none', bubble: 'plain', background: 'plain'};
    const api = {
      getState: () => ({chat: {profile, contacts: [], starred: []}, calls: {auto: false, every: 5, dailyMax: 3, ring: 30}}),
      listThreads: async () => [thread], chatUnread: async () => 0, listMoments: async () => [], getThread: async () => thread,
      chatContacts: () => [{name: '林夏', source: 'role', voice: 'old-binding', engine: 'none'}],
      chatReply: async () => {}, appendChat: async (_id, lines) => { thread.messages.push(...lines); },
      callDial: async name => { window.qa.actions.push(['callDial', name]); },
      callSay: async text => { window.qa.actions.push(['callSay', text]); },
      callReply: async () => { window.qa.actions.push(['callReply']); }
    };
    for (const key of ['speak', 'audioFile', 'status', 'lineState', 'stop']) api[key] = () => { window.qa.speechCalls.push(key); throw Error('Removed speech API used: ' + key); };
    const ctx = {
      api, doc: document, win: window, engineOf: () => 'none', visible: () => true,
      notify: message => window.qa.notifications.push(message),
      dialog: (title, html) => {
        document.querySelector('.test-dialog')?.remove();
        const body = document.createElement('section'); body.className = 'test-dialog'; body.innerHTML = `<h1>${title}</h1>` + html; document.body.append(body);
        return {body, live: true, close() { this.live = false; body.remove(); }};
      }
    };
    const view = chatApp(ctx); document.body.append(view.root); window.qa.view = view;
    window.qa.calls = callScreen(ctx, document.body);
    await view.openThread(thread.id);
  });
  assert.equal(await page.locator('.chat-bubble[data-mid="original"]').textContent(), '保留下來的原文');
  assert.equal(await page.locator('.chat-bubble[data-mid="translated"]').textContent(), '保留下來的譯文');
  assert.equal(await page.locator('.chat-bubble[data-mid="escaped"]').textContent(), '<img src=x onerror=alert(1)>');
  assert.equal(await page.locator('.chat-bubble img, .voice-msg, [data-action="voice"]').count(), 0);
  assert.doesNotMatch(await page.locator('.th-head').textContent(), /配音|語音/);
  await page.locator('.chat-bubble[data-mid="translated"]').click();
  assert.match(await page.locator('.test-dialog').textContent(), /保留下來的譯文/);
  assert.equal(await page.locator('.test-dialog [data-action="download"], .test-dialog [data-action="transcribe"]').count(), 0);
  await page.locator('.test-dialog [data-action="quote"]').click();
  assert.match(await page.locator('.quote-bar').textContent(), /保留下來的譯文/);
  await page.locator('[data-field="draft"]').fill('文字仍然可以送出');
  await page.locator('[data-action="send"]').click();
  assert(await page.evaluate(() => window.qa.thread.messages.some(m => m.text === '文字仍然可以送出' && m.kind === 'text')));
  await page.locator('[data-action="call-log"]').click();
  assert.match(await page.locator('.test-dialog').textContent(), /留言：稍後再聊/);
  assert.equal(await page.locator('[data-action="call-mail"]').count(), 0);
  await page.locator('[data-action="call-back"]').click();
  await page.evaluate(() => window.qa.calls.update({id: 'text-call', state: 'talking', name: '林夏', dir: 'out', answeredAt: Date.now(), speaking: true, voiced: false, lines: [{from: '林夏', text: '來聊聊劇情吧'}]}));
  assert.equal(await page.locator('.call-screen').getAttribute('aria-label'), '文字通話');
  assert.match(await page.locator('.call-lines').textContent(), /來聊聊劇情吧/);
  assert.equal(await page.locator('[data-call-note]').textContent(), '輪到你了，輸入文字回覆');
  await page.locator('[data-call-input]').fill('用文字回覆');
  await page.locator('.call-send').click();
  await page.locator('.call-send').click();
  assert.deepEqual(await page.evaluate(() => window.qa.actions), [['callDial', '林夏'], ['callSay', '用文字回覆'], ['callReply']]);
  assert.deepEqual(await page.evaluate(() => window.qa.speechCalls), []);
  assert.deepEqual(await page.evaluate(() => window.qa.notifications), []);
  assert.deepEqual(errors, []);
  await page.evaluate(() => { window.qa.calls.dispose(); window.qa.view.dispose(); });
  console.log('PASS: legacy message text, escaping, quote/send, call history and text calls without speech APIs');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
