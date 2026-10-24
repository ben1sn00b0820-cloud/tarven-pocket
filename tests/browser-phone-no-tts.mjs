/** Actual phone UI with text/image APIs only; no host, credentials or model requests.
 * TP_CHROMIUM_PATH=/path/to/chromium node tests/browser-phone-no-tts.mjs
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
const out = path.join(root, 'tests/artifacts');
await fs.mkdir(out, {recursive: true});
const types = {'.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml'};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') {
      const html = (await fs.readFile(path.join(root, 'ui/index.html'), 'utf8')).replace('<head>', '<head><base href="/ui/">').replace(/<div id="root">.*?<\/div>/s, '').replace(/<script.*?<\/script>/s, '');
      res.setHeader('Content-Type', 'text/html;charset=utf-8'); res.end(html); return;
    }
    const file = path.resolve(root, '.' + url.pathname);
    if (!file.startsWith(root + path.sep)) throw Error('path');
    res.setHeader('Content-Type', types[path.extname(file)] || 'text/plain');
    res.end(await fs.readFile(file));
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
const report = [];
try {
  browser = await playwright.chromium.launch({headless: true, executablePath: process.env.TP_CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage']});
  const page = await browser.newPage({viewport: {width: 900, height: 1000}, hasTouch: true, reducedMotion: 'reduce'});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => {
    // Import before mounting to avoid the standalone backend's auto-start hook.
    const {createPhoneApp} = await import('/ui/phone.js');
    const {freshState} = await import('/core/state.js');
    const state = freshState();
    state.routes = [{id: 'role-1', name: '林夏', appearance: 'short black hair'}];
    state.chat.presets[0].name = '我的聊天規則';
    state.draw.presets[0].name = '我的繪圖規則';
    const phone = {theme: 'dark', wallpaper: {kind: 'builtin', key: 'sky'}, icons: {}, iconStyle: 'color', skin: 'sky', lockOnOpen: false};
    const qa = window.qa = {state, phone, scope: 'chat-one', story: {known: false}, speechCalls: [], storyWrites: [], roleWrites: [], errors: []};
    const api = {
      getState: () => state, getPhone: async () => phone, pocketState: async () => {
        const snapshot = {scope: qa.scope, storyTime: structuredClone(qa.story)};
        if (qa.pauseNextRead) { qa.pauseNextRead = false; return new Promise(resolve => { qa.resumeRead = () => resolve(snapshot); }); }
        return snapshot;
      },
      subscribe: fn => { qa.emit = fn; return () => { qa.unsubscribed = true; }; },
      setStoryTime: async value => {
        qa.storyWrites.push(value);
        qa.story = value ? {...value, known: !!(value.date || value.time), source: 'manual'} : {known: true, date: '天元三年霜月初三', time: '子時', source: 'story'};
        qa.emit({type: 'pocket'});
      },
      saveRoute: role => { const saved = {...role, id: role.id || 'role-new'}; qa.roleWrites.push(saved); const index = state.routes.findIndex(item => item.id === saved.id); if (index < 0) state.routes.push(saved); else state.routes[index] = saved; qa.emit({type: 'settings'}); return saved; },
      listMoments: async () => [], chatUnread: async () => 0, listThreads: async () => [],
      libraryStats: async () => ({bytes: 0, limit: 1024, notes: 0, photos: 0, vibes: 0}), generatedPhotos: async () => ({count: 0, bytes: 0}),
      getPhoto: async () => null, keyStatus: () => false, keyHint: () => '', close() {},
      noteError: message => qa.errors.push(message),
      backupParts: () => ({settings: '設定', chats: '聊天', moments: '朋友圈', notes: '備忘錄', photos: '照片', vibes: '畫風', keys: '金鑰'}),
      defaultChatPreset: state.chat.presets[0], defaultDrawPreset: state.draw.presets[0],
      phoneCatalog: {glyphs: ['default', 'roles', 'settings']}
    };
    for (const key of ['status', 'getVolume', 'setVolume', 'speak', 'audioFile', 'lineState', 'audition', 'cacheStats', 'clearCache']) api[key] = () => { qa.speechCalls.push(key); throw Error('Removed speech API used: ' + key); };
    const mount = document.createElement('div'); mount.id = 'root'; document.body.append(mount);
    qa.app = createPhoneApp({window, api, mount}); await qa.app.ready;
  });
  const clock = page.locator('.home [data-clock="large"]').first();
  const date = page.locator('.home [data-clock="date"]').first();
  assert.equal(await clock.textContent(), '—');
  assert.equal(await date.textContent(), '劇情時間未設定');
  assert.equal(await page.locator('[data-app="listen"], [data-app="library"], [data-widget="player"], .now-playing').count(), 0);
  assert.equal(await page.locator('.home .app-icon[data-app="roles"]').first().textContent(), '角色庫');
  report.push('unknown story time has no device-clock fallback; player/listen/audio-library entries absent');
  await page.evaluate(() => { window.qa.story = {known: true, date: '天元三年霜月初三', time: '子時', source: 'story'}; window.qa.emit({type: 'pocket'}); });
  assert.equal(await clock.textContent(), '子時');
  assert.equal(await date.textContent(), '天元三年霜月初三');
  await page.evaluate(() => {
    window.qa.pauseNextRead = true;
    window.qa.story = {known: true, date: '舊聊天', time: '午夜'};
    window.qa.emit({type: 'pocket'});
    window.qa.scope = 'chat-two';
    window.qa.story = {known: true, date: '新聊天', time: '清晨'};
    window.qa.emit({type: 'space'});
  });
  await page.waitForFunction(() => document.querySelector('.home [data-clock="large"]').textContent === '清晨');
  await page.evaluate(async () => { window.qa.resumeRead(); await Promise.resolve(); });
  assert.equal(await clock.textContent(), '清晨');
  assert.equal(await date.textContent(), '新聊天');
  await page.locator('.home [data-system="story-time"]').click();
  await page.locator('[data-story-field="date"]').fill('不可套用到別的聊天');
  await page.evaluate(() => { window.qa.scope = 'chat-three'; window.qa.story = {known: true, date: '第三段劇情', time: '午後'}; });
  await page.locator('[data-story-save]').click();
  await page.waitForFunction(() => !document.querySelector('[data-story-save]'));
  assert.deepEqual(await page.evaluate(() => window.qa.storyWrites), []);
  assert.equal(await clock.textContent(), '午後');
  report.push('async stale reads cannot overwrite a new chat; a sheet cannot save into a switched chat');
  await page.evaluate(() => { window.qa.scope = 'chat-one'; window.qa.story = {known: true, date: '天元三年霜月初三', time: '子時'}; window.qa.emit({type: 'pocket'}); });
  await page.waitForFunction(() => document.querySelector('.home [data-clock="large"]').textContent === '子時');
  await page.screenshot({path: path.join(out, 'phone-no-tts-desktop.png'), animations: 'disabled'});
  report.push('pocket event refreshes the fantasy story date/time on the real desktop');
  await page.locator('.home [data-system="story-time"]').click();
  await page.locator('[data-story-field="date"]').fill('霜月初四');
  await page.locator('[data-story-field="time"]').fill('黎明前一刻');
  await page.locator('[data-story-save]').click();
  assert.equal(await clock.textContent(), '黎明前一刻');
  assert.deepEqual(await page.evaluate(() => window.qa.storyWrites), [{date: '霜月初四', time: '黎明前一刻', label: ''}]);
  await page.locator('.home [data-system="story-time"]').click();
  await page.locator('[data-story-auto]').click();
  assert.equal(await clock.textContent(), '子時');
  assert.deepEqual(await page.evaluate(() => window.qa.storyWrites.at(-1)), null);
  report.push('manual story date/time saves and follow-story action dispatch through setStoryTime');
  await page.evaluate(() => window.qa.app.open('roles', 'role-1'));
  await page.locator('.view[data-app="roles"] [data-field="name"]').fill('林夏更新');
  await page.locator('.view[data-app="roles"] [data-field="appearance"]').fill('long silver hair, blue eyes');
  await page.locator('[data-action="save-role"]').click();
  assert.deepEqual(await page.evaluate(() => window.qa.roleWrites[0]), {id: 'role-1', name: '林夏更新', appearance: 'long silver hair, blue eyes'});
  assert.doesNotMatch(await page.locator('.view[data-app="roles"]').textContent(), /TTS|試聽|配音|音色|參考音訊/);
  report.push('character name and fixed appearance remain editable and save without voice fields');
  await page.evaluate(() => window.qa.app.open('engines'));
  const connections = page.locator('.view[data-app="engines"]');
  for (const name of ['文字模型', 'NovelAI', 'GPT 生圖', 'ComfyUI']) assert.match(await connections.textContent(), new RegExp(name));
  assert.doesNotMatch(await connections.textContent(), /Fish Audio|MiniMax|ElevenLabs|MiMo|TTS/);
  await page.evaluate(() => window.qa.app.open('presets'));
  const presets = page.locator('.view[data-app="presets"]');
  assert.match(await presets.textContent(), /我的聊天規則/);
  await presets.locator('[data-kind="draw"][data-action="kind"]').click();
  assert.match(await presets.textContent(), /我的繪圖規則/);
  assert.equal(await presets.locator('[data-kind="tts"], [data-kind="voice"]').count(), 0);
  report.push('text/image engines and saved chat/drawing preset names remain accessible');
  await page.evaluate(() => window.qa.app.open('settings'));
  await page.locator('.view[data-app="settings"] .page-heading').waitFor();
  assert.doesNotMatch(await page.locator('.view[data-app="settings"]').textContent(), /配音|TTS|播放音量|語音快取|聲波/);
  assert.equal(await page.locator('.view[data-app="settings"] [data-field="voiceEnabled"], .view[data-app="settings"] [data-field="volume"]').count(), 0);
  report.push('settings renders without speech options or speech/cache API access');
  for (const viewport of [{width: 900, height: 1000}, {width: 390, height: 844}]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.qa.app.home());
    await page.waitForFunction(() => !document.querySelector('.screen').hasAttribute('data-home-in'));
    await page.evaluate(() => { window.qa.story = {known: true, date: '天元三年霜月初三', time: '黎明前一刻', source: 'story'}; window.qa.emit({type: 'pocket'}); document.querySelector('.toast').hidden = true; });
    const geometry = await page.evaluate(() => {
      const screen = document.querySelector('.screen').getBoundingClientRect();
      const clock = document.querySelector('.home-clock').getBoundingClientRect();
      return {docWidth: document.documentElement.scrollWidth, viewport: innerWidth, clockLeft: clock.left, clockRight: clock.right, screenLeft: screen.left, screenRight: screen.right};
    });
    assert(geometry.docWidth <= geometry.viewport + 1, JSON.stringify(geometry));
    assert(geometry.clockLeft >= geometry.screenLeft - 1 && geometry.clockRight <= geometry.screenRight + 1, JSON.stringify(geometry));
    assert(await page.locator('.home-clock').evaluate(el => el.classList.contains('story-clock-text')), 'named story time uses compact layout');
    await page.screenshot({path: path.join(out, `phone-no-tts-${viewport.width === 390 ? 'mobile' : 'desktop'}-long-time.png`), animations: 'disabled'});
    await page.evaluate(() => window.qa.app.open('settings'));
    await page.locator('.view[data-app="settings"] .page-heading').waitFor();
    const overflow = await page.locator('.view[data-app="settings"]').evaluate(el => el.scrollWidth - el.clientWidth);
    assert(overflow <= 1, `Settings overflow at ${viewport.width}: ${overflow}`);
  }
  report.push('desktop/mobile screenshots captured; home and settings have no horizontal overflow');
  assert.deepEqual(await page.evaluate(() => window.qa.speechCalls), []);
  assert.deepEqual(await page.evaluate(() => window.qa.errors), []);
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.qa.app.dispose());
  assert.equal(await page.evaluate(() => window.qa.unsubscribed), true);
  console.log(JSON.stringify({pass: true, checks: report}, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
