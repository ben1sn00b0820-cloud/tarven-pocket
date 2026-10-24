import '../core/compat.js';
import {connectBackend} from './backend-client.js';
import {glyph, icon, spark} from './icons.js';
import {esc, avatar, setAvatarPictures} from './common.js';
import {APPS, HOME, SLOT} from './apps.js';
import {wallpaperLook, motionLayer} from './wallpapers.js';
import {rolesApp} from './roles.js';
import {enginesApp} from './engines.js';
import {presetsApp} from './presets.js';
import {galleryApp, notesApp} from './media-apps.js';
import {settingsApp} from './settings.js';
import {drawApp} from './draw.js';
import {forumApp} from './forum.js';
import {peekApp} from './peek.js';
import {chatApp} from './chat.js';
import {momentsNew, momentsSeen} from './moments.js';
import {callScreen} from './call.js';
import {installMotion} from './motion.js';
import {instagramApp, diaryApp, storyshopApp, pocketsettingsApp} from '../pocket/apps.js';
import {meApp} from '../pocket/me-ui.js';
import {characterInfoApp} from '../pocket/character-info.js';
import {createViewRefreshQueue} from '../core/view-refresh.js';

// App factories, keyed by the ids in apps.js.
const FACTORIES = {characterinfo: characterInfoApp, me: meApp, roles: rolesApp, engines: enginesApp, presets: presetsApp, gallery: galleryApp, notes: notesApp, settings: settingsApp, draw: drawApp, chat: chatApp, forum: forumApp, peek: peekApp, instagram: instagramApp, diary: diaryApp, storyshop: storyshopApp, pocketsettings: pocketsettingsApp};
const POCKET_APPS = new Set(['characterinfo', 'me', 'instagram', 'diary', 'storyshop', 'pocketsettings']);

// Network and battery in the status bar come from the user's own device (where the browser tells them).
const BARS = n => `<svg viewBox="0 0 18 12" fill="currentColor" aria-hidden="true">${[[0, 8, 4], [5, 5.5, 6.5], [10, 3, 9], [15, 0, 12]].map(([x, y, h], i) => `<rect x="${x}" y="${y}" width="3" height="${h}" rx="1"${i < n ? '' : ' opacity=".3"'}/>`).join('')}</svg>`;
const WIFI = (n, off = false) => `<svg viewBox="0 0 18 13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">${['M1.6 4.9a10.5 10.5 0 0 1 14.8 0', 'M4.4 7.7a6.6 6.6 0 0 1 9.2 0', 'M7.2 10.5a2.6 2.6 0 0 1 3.6 0'].map((d, i) => `<path d="${d}"${3 - i <= n ? '' : ' opacity=".3"'}/>`).join('')}${off ? '<path d="M2.5 1.2 15.5 12"/>' : ''}</svg>`;
const BOLT = '<svg class="bolt" viewBox="0 0 8 12" fill="currentColor" aria-hidden="true"><path d="M4.8 0 0 7h3.2L2.6 12 8 4.6H4.6z"/></svg>';
/** What the browser knows about the connection: offline, mobile data (with a guess at its strength) or Wi-Fi/wired. */
export function networkState(nav) {
  const c = nav?.connection, strength = ({'slow-2g': 1, '2g': 2, '3g': 3, '4g': 4})[c?.effectiveType] || 4;
  if (nav && nav.onLine === false) return {kind: 'offline', level: 0, label: '沒有網路'};
  if (c?.type === 'cellular') return {kind: 'cell', level: strength, label: '行動網路' + (c.effectiveType ? ' · ' + c.effectiveType.toUpperCase().replace('SLOW-', '慢速 ') : '')};
  return {kind: 'wifi', level: Math.max(1, strength - 1), label: c?.type === 'ethernet' ? '有線網路' : c?.type === 'wifi' ? 'Wi-Fi' : '已聯網'};
}
/** Battery from navigator.getBattery(); null when the browser does not tell (Firefox, Safari). */
export function batteryState(b) {
  if (!b || !Number.isFinite(b.level)) return null;
  const level = Math.round(b.level * 100);
  return {level, charging: !!b.charging, low: level <= 20 && !b.charging};
}

export function storyClockView(story = {}) {
  if (!story.known) return {date: '劇情時間未設定', time: '—', label: '劇情時間未設定'};
  return {
    date: story.date || '劇情日期未設定',
    time: story.time || '—',
    label: story.label || [story.date, story.time].filter(Boolean).join(' · ') || '劇情時間未設定',
  };
}

export function createPhoneApp({window: win, api, mount = win.document.getElementById('root')}) {
  const doc = win.document;
  const controller = new win.AbortController(), signal = controller.signal;
  const views = new Map(), assets = new Map();
  const media = win.matchMedia('(prefers-color-scheme: dark)'), motion = win.matchMedia('(prefers-reduced-motion: reduce)');
  let panelVisible = true, active = null, locked = false, sheet = null, disposed = false;
  let preferences = null, appearanceKey = '', appearanceEpoch = 0, toastTimer, openTimer, unread = 0, unreadTimer, fresh = 0, freshTimer;
  let cachedStoryTime = {known: false}, storyScope = null, storyClockEpoch = 0, storyDialog = null;
  const refreshQueue = createViewRefreshQueue({
    visible: name => !disposed && panelVisible && !doc.hidden && !locked && active === name,
    run: (name, task) => { const view = views.get(name); return task.kind === 'chat' && view?.onChat ? view.onChat(task.event || {}) : view?.refresh?.(); },
    setTimer: (fn, ms) => win.setTimeout(fn, ms), clearTimer: id => win.clearTimeout(id), onError: error => fail(error),
  });
  const refreshView = (name, kind = 'refresh', event = {}) => refreshQueue.request(name, {kind, event});

  mount.innerHTML = `
    <div class="stage">
      <div class="stage-bar" title="按住這裡拖動手機，雙擊放回原處"><span>傳音玉符</span><div class="stage-actions"><button class="size-button" data-system="size" aria-label="換手機大小" hidden></button><button class="info" data-system="help" aria-label="手機介面說明">i</button><button class="close" data-system="close" aria-label="返回酒館">${icon('close')}</button></div></div>
      <div class="device">
        <button class="power-key" data-system="power" aria-label="鎖屏或喚醒"></button>
        <div class="screen" data-view="home">
          <div class="wallpaper"></div>
          <div class="statusbar"><time data-clock="small"></time><button class="status-icons" data-system="control" aria-label="開啟控制中心，或向下拖動"><span class="net" data-net></span><span class="battery" data-battery aria-hidden="true"></span></button></div>
          <button class="pull-tab" data-system="control" aria-label="開啟控制中心，也可以從螢幕頂端往下拉"></button><span class="safe-probe" aria-hidden="true"></span>
          <button class="island" data-system="island" aria-label="開啟角色庫"><span class="camera"></span></button>
          <main class="home">
            <button class="home-close" data-system="close" aria-label="返回酒館">${icon('close')}</button>
            <div class="home-pages"></div>
            <div class="dots" aria-hidden="true"></div>
            <nav class="phone-dock" aria-label="常用應用"></nav>
          </main>
          <section class="app-frame" hidden><header class="app-nav"><button class="nav-button" data-system="back" aria-label="返回">${icon('back')}</button><button class="nav-button" data-system="home" aria-label="返回桌面">${icon('home')}</button></header><div class="app-content"></div></section>
          <button class="home-indicator" data-system="home" aria-label="返回桌面"></button>
          <section class="lockscreen" role="dialog" aria-modal="true" aria-label="鎖屏" hidden></section>
          <div class="toast" role="status" hidden></div>
        </div>
      </div>
    </div>`;
  const $ = s => mount.querySelector(s);
  const screen = $('.screen'), home = $('.home'), frame = $('.app-frame'), content = $('.app-content'), lockscreen = $('.lockscreen');

  /** A short note at the bottom. Errors stay longer (20 s), can be closed with ×, and can be selected to copy. */
  function notify(text, {error = false} = {}) {
    if (disposed) return;
    if (error) api.noteError?.(text || '操作未完成');
    const el = $('.toast');
    el.innerHTML = `<span class="toast-text">${esc(text || '操作未完成')}</span>${error ? `<button type="button" class="toast-close" data-toast-close aria-label="關閉提示">${icon('close')}</button>` : ''}`;
    el.classList.toggle('error', error);
    el.setAttribute('role', error ? 'alert' : 'status');
    el.hidden = false;
    win.clearTimeout(toastTimer);
    toastTimer = win.setTimeout(() => el.hidden = true, error ? 20000 : 4500);
  }
  const fail = error => notify(error?.message, {error: true});
  function run(fn) {
    try {
      const result = fn();
      result?.catch?.(fail);
      return result;
    } catch (error) { fail(error); }
  }
  mount.addEventListener('click', e => {
    if (!e.target.closest('[data-toast-close]')) return;
    win.clearTimeout(toastTimer);
    $('.toast').hidden = true;
  });
  function syncInert() {
    home.inert = !!active || locked || !!sheet;
    frame.inert = !active || locked || !!sheet;
    for (const s of ['.statusbar', '.pull-tab', '.island', '.home-indicator']) $(s).inert = locked || !!sheet;
    lockscreen.inert = !locked || !!sheet;
  }

  // ---------- Sheets ----------
  function dialog(title, html, {top = false} = {}) {
    sheet?.close(null);
    const focus = doc.activeElement, overlay = doc.createElement('div');
    overlay.className = 'overlay' + (top ? ' top' : '');
    overlay.innerHTML = `<section class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header class="sheet-header"><h2>${esc(title)}</h2><button class="nav-button" data-sheet-close aria-label="關閉">${icon('close')}</button></header><div class="sheet-body">${html}</div></section>`;
    screen.append(overlay);
    let live = true;
    const callbacks = [];
    const result = {
      overlay,
      body: overlay.querySelector('.sheet-body'),
      get live() { return live; },
      onClose(fn) { callbacks.push(fn); },
      close(value = null) {
        if (!live) return;
        live = false;
        overlay.remove();
        if (sheet === result) sheet = null;
        syncInert();
        for (const callback of callbacks) callback(value);
        if (focus?.isConnected && !focus.closest('[inert]')) focus.focus({preventScroll: true});
      }
    };
    overlay.addEventListener('click', e => { if (e.target === overlay || e.target.closest('[data-sheet-close]')) result.close(null); });
    // An 「i」 inside a sheet opens its note right under the row (opening the 说明 sheet would close this one); again to fold it.
    overlay.addEventListener('click', e => {
      const info = e.target.closest('[data-help]');
      if (!info || !overlay.contains(info)) return;
      e.preventDefault();
      const row = info.closest('.setting-row, .field, .actions, .row-heading') || info.parentElement, next = row.nextElementSibling;
      if (next?.classList.contains('sheet-help')) { next.remove(); info.setAttribute('aria-expanded', 'false'); return; }
      const note = doc.createElement('p');
      note.className = 'help-copy sheet-help';
      note.textContent = info.dataset.help;
      row.after(note);
      info.setAttribute('aria-expanded', 'true');
    });
    overlay.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const controls = [...overlay.querySelectorAll('button,input,select,textarea,a[href]')].filter(el => !el.disabled && !el.hidden);
      if (!controls.length) return;
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    sheet = result;
    syncInert();
    overlay.querySelector('button').focus({preventScroll: true});
    return result;
  }
  function confirm(title, text = '') {
    return new Promise(resolve => {
      const d = dialog(title, `<p class="help-copy">${esc(text)}</p><div class="actions"><button type="button" class="secondary" data-action="cancel">取消</button><button type="button" class="primary" data-action="confirm">確認</button></div>`);
      d.onClose(value => resolve(value === true));
      d.body.addEventListener('click', e => {
        const action = e.target.closest('button')?.dataset.action;
        if (action === 'confirm') d.close(true);
        if (action === 'cancel') d.close(false);
      });
    });
  }
  const help = text => dialog('說明', `<p class="help-copy">${esc(text)}</p>`);

  const routeFor = name => api.getState().routes.find(r => r.name === name);
  const engineOf = () => 'none';
  const ctx = {api, doc, win, notify, dialog, confirm, help, lock, open, routeFor, engineOf, openPendingRole: name => openPendingRole(name), visible: name => active === name && !locked,
    editEngine: id => views.get('engines')?.edit?.(id), showPresetKind: kind => views.get('presets')?.showKind?.(kind), momentsSeen: () => { if (fresh) { fresh = 0; renderHome(); } }};
  installMotion(win, mount, signal);
  // On a computer the phone is a floating window: its top bar moves it.
  const stageBar = $('.stage-bar'), sizeButton = $('[data-system=size]');
  function floatingBar() {
    let float = false;
    try { float = !!api.panelFloating?.(); } catch { /* outside the tavern */ }
    stageBar.toggleAttribute('data-draggable', float);
    doc.documentElement.toggleAttribute('data-floating', float);
    sizeButton.hidden = !float;
    if (float) sizeButton.textContent = api.panelSizeName?.() || '中';
  }
  stageBar.addEventListener('pointerdown', e => {
    if (e.button || e.target.closest('button') || !stageBar.hasAttribute('data-draggable')) return;
    e.preventDefault();
    stageBar.setPointerCapture?.(e.pointerId);
    stageBar.dataset.dragging = '';
    api.panelDrag?.('start', e.screenX, e.screenY);
  }, {signal});
  stageBar.addEventListener('pointermove', e => { if ('dragging' in stageBar.dataset) api.panelDrag?.('move', e.screenX, e.screenY); }, {signal});
  for (const type of ['pointerup', 'pointercancel']) stageBar.addEventListener(type, () => { if (!('dragging' in stageBar.dataset)) return; delete stageBar.dataset.dragging; api.panelDrag?.('end'); }, {signal});
  stageBar.addEventListener('dblclick', e => { if (!e.target.closest('button')) api.panelDrag?.('reset'); }, {signal});
  // 来电: one layer over everything, drawn from what the tavern side reports.
  const calls = callScreen(ctx, screen);
  // Opening the phone shows a call still going on; one that already ended (the host keeps it) is not shown again.
  const callState = () => { try { const c = api.callStatus?.() || null; calls.update(c?.state === 'ended' ? null : c); } catch { /* not in the tavern */ } };

  // ---------- Navigation ----------
  function open(name, roleId) {
    if (!FACTORIES[name]) return;
    sheet?.close(null);
    unlock();
    active = name;
    let v = views.get(name);
    if (!v) { v = FACTORIES[name](ctx); views.set(name, v); content.append(v.root); }
    else refreshView(name);
    for (const [id, view] of views) view.root.hidden = id !== name;
    home.hidden = true;
    frame.hidden = false;
    screen.dataset.view = 'app';
    screen.dataset.opening = 'true';
    win.clearTimeout(openTimer);
    openTimer = win.setTimeout(() => delete screen.dataset.opening, 260);
    syncInert();
    $('.app-nav [data-system=back]').focus({preventScroll: true});
    if (roleId && v.edit) v.edit(roleId);
    refreshQueue.resume();
  }
  function showHome() {
    sheet?.close(null);
    if (locked) return;
    const arriving = active !== null;
    active = null;
    home.hidden = false;
    frame.hidden = true;
    screen.dataset.view = 'home';
    syncInert();
    if (arriving) homeIn();
  }
  // Icons and widgets come in one after another when the home screen appears (not when a badge redraws it).
  let homeTimer = 0;
  function homeIn() {
    win.clearTimeout(homeTimer);
    delete screen.dataset.homeIn;
    void screen.offsetWidth;
    screen.dataset.homeIn = '';
    homeTimer = win.setTimeout(() => delete screen.dataset.homeIn, 800);
  }
  function back() {
    if (sheet) { sheet.close(null); return; }
    if (locked) { unlock(); return; }
    if (active && views.get(active)?.back?.()) return;
    showHome();
  }
  function lock() {
    sheet?.close(null);
    locked = true;
    renderLock();
    lockscreen.hidden = false;
    syncInert();
    lockscreen.querySelector('[data-system=unlock]').focus({preventScroll: true});
  }
  function unlock() {
    if (!locked) return;
    locked = false;
    lockscreen.hidden = true;
    syncInert();
    refreshQueue.resume();
    if (!active) homeIn();
    if (active) $('.app-nav [data-system=back]').focus({preventScroll: true});
    else home.querySelector('.app-icon')?.focus({preventScroll: true});
  }
  function openPendingRole(name) {
    const route = routeFor(name);
    if (route) { open('roles', route.id); return; }
    open('roles');
    views.get('roles')?.create?.(name);
  }

  // ---------- Clock and theme ----------
  async function refreshStoryTime({reset = false} = {}) {
    const ticket = ++storyClockEpoch;
    if (reset) {
      cachedStoryTime = {known: false}; storyScope = null;
      storyDialog?.close();
      clock();
    }
    let snapshot;
    try { snapshot = await api.pocketState?.(); }
    catch { snapshot = null; }
    if (disposed || ticket !== storyClockEpoch) return null;
    const scope = snapshot?.scope ?? null;
    if (storyScope !== scope) storyDialog?.close();
    storyScope = scope;
    cachedStoryTime = snapshot?.storyTime || {known: false};
    clock();
    return snapshot;
  }
  function clock() {
    if (disposed || !panelVisible || doc.hidden) return;
    const view = storyClockView(cachedStoryTime);
    for (const el of mount.querySelectorAll('[data-clock]')) {
      el.textContent = el.dataset.clock === 'date' ? view.date : view.time;
      if (el.dataset.clock === 'large') el.classList.toggle('story-clock-text', view.time !== '—' && !/^\d{1,2}:\d{2}$/.test(view.time));
    }
    for (const el of mount.querySelectorAll('[data-story-label]')) el.textContent = view.label;
  }
  async function editStoryTime() {
    const snapshot = await refreshStoryTime();
    if (!snapshot || disposed) return;
    const current = cachedStoryTime, editingScope = storyScope;
    const d = dialog('劇情時間', `<p class="hint">讀取正文或角色狀態裡明確寫出的時間。也可以手動設定這段聊天的劇情時間。</p>
      <div class="group pad"><label class="field"><span>劇情日期</span><input data-story-field="date" value="${esc(current.date || '')}" placeholder="例如 霜月初三"></label>
      <label class="field"><span>劇情時刻</span><input data-story-field="time" value="${esc(current.time || '')}" placeholder="例如 子時、夜間、23:30"></label></div>
      <div class="actions"><button class="secondary" data-story-auto>跟隨劇情</button><button class="primary" data-story-save>儲存</button></div>`);
    storyDialog = d;
    d.onClose(() => { if (storyDialog === d) storyDialog = null; });
    d.body.addEventListener('click', e => {
      const button = e.target.closest('button');
      if (!button || !(button.hasAttribute('data-story-auto') || button.hasAttribute('data-story-save'))) return;
      run(async () => {
        const value = button.hasAttribute('data-story-auto') ? null : {
          date: d.body.querySelector('[data-story-field=date]').value.trim(),
          time: d.body.querySelector('[data-story-field=time]').value.trim(), label: ''
        };
        if (value && !value.date && !value.time) { notify('請填寫劇情日期或時刻'); return; }
        button.disabled = true;
        try {
          const latest = await refreshStoryTime();
          if (!latest || !d.live || latest.scope !== editingScope) {
            d.close(); notify('聊天已切換，請重新設定這段劇情的時間'); return;
          }
          await api.setStoryTime(value);
          d.close();
          await refreshStoryTime();
          notify(value ? '劇情時間已儲存' : '已改為跟隨劇情');
        }
        finally { button.disabled = false; }
      });
    });
  }
  const isDark = () => doc.documentElement.dataset.theme === 'dark';
  function applyThemeMode() {
    const mode = preferences?.theme || api.getState().theme;
    doc.documentElement.dataset.theme = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode;
    doc.documentElement.dataset.skin = preferences?.skin || 'sky';
    doc.documentElement.dataset.performance = api.getState().general.fastMode !== false ? 'fast' : 'balanced';
  }
  function theme() {
    applyThemeMode();
    if (preferences) run(() => appearance(preferences));
  }

  // ---------- Home screen ----------
  function appIcon(id) {
    if (id === SLOT) return `<button class="app-icon slot" data-slot aria-label="預留位置"><span class="icon-tile">${icon('add')}</span><span class="app-label">預留</span></button>`;
    const meta = APPS[id], custom = preferences?.icons?.[id], [t1, t2, tac] = meta.colors;
    const image = custom?.kind === 'photo' ? assets.get(custom.photoId) : null;
    const art = image ? `<img src="${esc(image)}" alt="">` : glyph(custom?.kind === 'glyph' && custom.key !== 'default' ? custom.key : meta.glyph || id);
    // The chat icon: unread messages as a number; new 动态 alone as a dot.
    const count = id === 'chat' ? unread : 0, dot = id === 'chat' && !unread && fresh;
    const badge = count ? `<span class="badge app-badge">${count > 99 ? '99+' : count}</span>` : dot ? '<span class="badge app-badge dot"></span>' : '';
    return `<button class="app-icon" data-app="${id}" aria-label="${esc(meta.name)}${count ? `，${count} 條未讀` : dot ? '，有新動態' : ''}"><span class="icon-tile" style="--t1:${t1};--t2:${t2};--tac:${tac}">${art}</span>${badge}<span class="app-label">${esc(meta.name)}</span></button>`;
  }
  function renderHome() {
    const shown = HOME.pages.map(ids => ids.filter(id => id !== SLOT)).filter((ids, index) => index === 0 || ids.length);
    const pages = shown.map((ids, index) => `<div class="home-page">${index === 0
      ? `<button class="clock-block story-clock-button" data-system="story-time" aria-label="設定劇情時間"><span class="story-clock-caption">劇情時間</span><span class="home-date" data-clock="date"></span><span class="home-clock" data-clock="large"></span></button><div class="widgets"><div class="widget cast-widget" data-widget="cast"></div></div>`
      : ''}<div class="apps-grid">${ids.map(appIcon).join('')}</div></div>`).join('');
    $('.home-pages').innerHTML = pages;
    $('.dots').innerHTML = shown.length > 1 ? shown.map((_, i) => `<i${i === 0 ? ' data-on' : ''}></i>`).join('') : '';
    $('.phone-dock').innerHTML = HOME.dock.map(appIcon).join('');
    clock();
    renderWidgets();
  }
  function renderBadges() {
    for (const button of mount.querySelectorAll('.app-icon[data-app="chat"]')) {
      button.querySelector('.app-badge')?.remove();
      button.setAttribute('aria-label', APPS.chat.name + (unread ? `，${unread} 條未讀` : fresh ? '，有新動態' : ''));
      if (unread || fresh) {
        const badge = doc.createElement('span'); badge.className = 'badge app-badge' + (unread ? '' : ' dot');
        badge.textContent = unread ? (unread > 99 ? '99+' : String(unread)) : ''; button.append(badge);
      }
    }
  }
  function renderWidgets() {
    const cast = $('[data-widget=cast]');
    if (cast) {
      const routes = api.getState().routes.slice(0, 4);
      cast.innerHTML = `<span class="widget-head"><span class="eyebrow">角色庫</span><button class="chip-button" data-app="roles">查看全部</button></span>${routes.length
        ? `<div class="cast">${routes.map(r => `<button data-open-role="${esc(r.id)}" aria-label="開啟 ${esc(r.name)} 的角色資料">${avatar(r.name, 'none', 28)}<span>${esc(r.name)}</span></button>`).join('')}</div>`
        : `<span class="widget-line">還沒有角色</span><button class="chip-button" data-app="roles">新增角色</button>`}`;
    }
  }
  function renderLock() {
    lockscreen.innerHTML = `${icon('lock')}<span class="story-clock-caption">劇情時間</span><p class="home-date" data-clock="date"></p><p class="home-clock" data-clock="large"></p>
      <div class="widget"><span class="widget-head"><span class="eyebrow">劇情進度</span></span><span class="widget-line" data-story-label></span></div>
      <div class="lock-bottom"><button class="primary" data-system="unlock">點這裡進入</button><button class="chip-button" data-system="unlock">跳過鎖屏</button></div>`;
    clock();
  }

  async function appearance(phone) {
    preferences = phone;
    applyThemeMode();
    const dark = isDark();
    const key = JSON.stringify([phone.wallpaper, phone.icons, phone.iconStyle, dark]);
    if (key === appearanceKey) return;
    const ticket = ++appearanceEpoch;
    const photoIds = new Set([phone.wallpaper.kind === 'photo' ? phone.wallpaper.photoId : null, ...Object.values(phone.icons).filter(x => x?.kind === 'photo').map(x => x.photoId)].filter(Boolean));
    const records = await Promise.all([...photoIds].map(async id => [id, await api.getPhoto(id)]));
    if (disposed || ticket !== appearanceEpoch) return;
    for (const url of assets.values()) win.URL.revokeObjectURL(url);
    assets.clear();
    for (const [id, record] of records) if (record) assets.set(id, win.URL.createObjectURL(record.blob));
    const photo = phone.wallpaper.kind === 'photo' ? assets.get(phone.wallpaper.photoId) : null;
    const look = wallpaperLook(phone.wallpaper.key, dark);
    const vars = photo
      ? {'--wall': `linear-gradient(#0000001f,#0000001f),url("${photo}")`, '--wall-size': 'cover', '--wall-pos': 'center', '--wall-ink': '#fff', '--label-halo': '#000'}
      : {'--wall': look.background, '--wall-size': look.size || 'auto', '--wall-pos': look.pos || 'center', '--wall-ink': look.ink, '--clock-stroke': look.stroke, '--clock-shadow': look.shadow || look.stroke, '--label-halo': look.halo};
    for (const [name, value] of Object.entries(vars)) screen.style.setProperty(name, value);
    screen.dataset.clockStyle = photo ? 'shade' : look.clock;
    screen.dataset.iconStyle = phone.iconStyle;
    $('.wallpaper').innerHTML = (photo || look.clock === 'glow' ? '' : [['12%', '20%', 14], ['84%', '14%', 22], ['72%', '28%', 10], ['20%', '58%', 12]].map(([x, y, s]) => spark('spark').replace('<svg', `<svg style="left:${x};top:${y};width:${s}px;height:${s}px"`)).join('')) + (photo ? '' : motionLayer(look.motion));
    wallMotion();
    appearanceKey = key;
    renderHome();
  }

  /** 动态壁纸 on or off (settings); the CSS also stops it for reduced motion and while an app is open. */
  function wallMotion() { const general = api.getState().general; screen.dataset.wallMotion = general.wallpaperMotion === false || general.fastMode !== false ? 'off' : 'on'; }

  // ---------- Avatars ----------
  // Pictures for avatars: the user's choice (an album photo, or text), else the tavern's own avatar for that name
  // (character card, current persona). Loaded once and again when the choices or the tavern's avatars change.
  const avatarURLs = new Map();
  let avatarKey = '', avatarRun = 0, lastSyncAt = 0;
  async function refreshAvatars() {
    const run = ++avatarRun, chosen = api.getState().chat?.avatars || {};
    let tavern = {me: '', characters: {}};
    try { tavern = api.tavernAvatars?.() || tavern; } catch { /* outside the tavern */ }
    const map = {...tavern.characters, ...(tavern.me ? {me: tavern.me} : {})}, used = new Set();
    for (const [name, a] of Object.entries(chosen)) {
      if (a.kind === 'text') { delete map[name]; continue; }
      used.add(a.photoId);
      if (!avatarURLs.has(a.photoId)) {
        const photo = await api.getPhoto(a.photoId).catch(() => null);
        if (run !== avatarRun || disposed) return;
        avatarURLs.set(a.photoId, photo?.blob ? win.URL.createObjectURL(photo.blob) : '');
      }
      if (avatarURLs.get(a.photoId)) map[name] = avatarURLs.get(a.photoId);
    }
    for (const [id, url] of avatarURLs) if (!used.has(id)) { if (url) win.URL.revokeObjectURL(url); avatarURLs.delete(id); }
    const key = JSON.stringify(map);
    if (key === avatarKey || disposed) return;
    avatarKey = key;
    setAvatarPictures(map);
    renderHome();
    const v = active && views.get(active);
    if (v) run === avatarRun && (v.onAvatars ? v.onAvatars() : v.refresh?.());
  }

  // ---------- Device (network and battery) ----------
  const nav = win.navigator;
  let battery = null;
  function paintDevice() {
    if (disposed) return;
    const n = networkState(nav), b = batteryState(battery);
    const netIcon = n.kind === 'cell' ? BARS(n.level) : WIFI(n.level, n.kind === 'offline');
    const batteryText = b ? `電量 ${b.level}%${b.charging ? '，正在充電' : ''}` : '這個瀏覽器不提供電量';
    for (const el of mount.querySelectorAll('[data-net]')) { el.innerHTML = netIcon; el.dataset.kind = n.kind; }
    for (const el of mount.querySelectorAll('[data-battery]')) {
      el.style.setProperty('--level', b ? Math.max(b.level, 4) + '%' : '100%');
      el.toggleAttribute('data-unknown', !b);
      el.toggleAttribute('data-charging', !!b?.charging);
      el.toggleAttribute('data-low', !!b?.low);
      el.innerHTML = b?.charging ? BOLT : '';
    }
    for (const el of mount.querySelectorAll('[data-net-label]')) el.textContent = n.label;
    for (const el of mount.querySelectorAll('[data-battery-label]')) el.textContent = b ? `${b.level}%${b.charging ? ' · 充電中' : b.low ? ' · 電量低' : ''}` : '電量未知';
    $('.status-icons').setAttribute('aria-label', `開啟控制中心，或向下拖動（${n.label}，${batteryText}）`);
  }
  win.addEventListener('online', paintDevice, {signal});
  win.addEventListener('offline', paintDevice, {signal});
  nav.connection?.addEventListener?.('change', paintDevice, {signal});
  Promise.resolve(nav.getBattery?.()).then(b => {
    if (!b || disposed) return;
    battery = b;
    for (const type of ['levelchange', 'chargingchange']) b.addEventListener(type, paintDevice, {signal});
    paintDevice();
  }).catch(() => {});

  // ---------- Control center ----------
  function control({pulling = false} = {}) {
    const s = api.getState(), p = preferences || {theme: s.theme};
    const toggles = [['fast', 'settings', '流暢模式', s.general.fastMode !== false], ['floating', 'float', '懸浮入口', s.general.floatingEnabled], ['motion', 'image', '動態桌布', s.general.wallpaperMotion !== false]];
    const d = dialog('控制中心', `<div class="control-grid">
      <div class="control-tile wide cc-device"><span class="net" data-net></span><span data-net-label></span><span class="cc-battery"><span class="battery" data-battery aria-hidden="true"></span><span data-battery-label></span></span></div>
      <button class="control-tile wide" data-system="story-time"><span class="bubble">${icon('notes')}</span><span>劇情時間<small data-story-label></small></span></button>
      <div class="control-tile wide cc-toggles">${toggles.map(([key, glyphKey, label, value]) => `<button class="cc-toggle" data-control="${key}" aria-pressed="${value}"><span class="bubble">${icon(glyphKey)}</span>${label}</button>`).join('')}<button class="cc-toggle" data-system="power" aria-pressed="true"><span class="bubble">${icon('lock')}</span>鎖屏</button></div>
      <div class="control-tile wide" style="flex-direction:column;align-items:stretch"><span>主題</span><div class="segmented">${[['system', '跟隨系統'], ['light', '日間'], ['dark', '夜間']].map(([key, label]) => `<button data-theme="${key}" aria-pressed="${p.theme === key}">${label}</button>`).join('')}</div></div>
    </div>`, {top: true});
    d.control = true;
    if (pulling) pullTo(d, 0);
    d.body.addEventListener('click', e => {
      const el = e.target.closest('button');
      if (!el) return;
      run(async () => {
        if (el.dataset.theme) {
          await api.savePhone({theme: el.dataset.theme});
          if (d.live) for (const b of d.body.querySelectorAll('[data-theme]')) b.setAttribute('aria-pressed', String(b === el));
        }
        const flip = {fast: 'fastMode', floating: 'floatingEnabled', motion: 'wallpaperMotion'}[el.dataset.control];
        if (flip) {
          const enabled = el.getAttribute('aria-pressed') !== 'true';
          api.updateGeneral({[flip]: enabled});
          el.setAttribute('aria-pressed', String(enabled));
        }
      });
    });
    paintDevice();
    clock();
    return d;
  }
  // Pulled down from the top of the screen it follows the finger (or mouse) and stays open once pulled far enough;
  // pushed back up the same way it closes.
  function pullTo(d, amount) {
    d.overlay.classList.add('pulling');
    d.overlay.classList.remove('settling');
    d.overlay.style.setProperty('--pull', String(Math.min(1, Math.max(0, amount))));
  }
  function settle(d, open) {
    if (!d.live) return;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      d.overlay.classList.remove('pulling', 'settling');
      d.overlay.style.removeProperty('--pull');
      if (!open) d.close(null);
    };
    d.overlay.classList.add('settling');
    d.overlay.style.setProperty('--pull', open ? '1' : '0');
    if (motion.matches) done();
    else { d.overlay.querySelector('.sheet').addEventListener('transitionend', done, {once: true}); win.setTimeout(done, 360); }
  }
  let gesture = null, pulledAt = 0;
  /** Where a drag may start: the top strip of the screen (the status bar; on a real phone, where it would be), the
   *  status icons, an open control center (to push it back up), or the lock screen (to swipe it away). */
  function gestureStart(target, x, y) {
    gesture = null;
    if (disposed || !panelVisible) return;
    if (locked && !sheet) { if (target.closest('.lockscreen')) gesture = {kind: 'unlock', x, y}; return; }
    if (sheet?.control && target.closest('.overlay.top') && !target.closest('input,select,textarea')) {
      const body = target.closest('.sheet-body');
      if (!body || body.scrollHeight <= body.clientHeight + 1) gesture = {kind: 'close', x, y, d: sheet};
      return;
    }
    if (sheet || locked || target.closest('.stage-bar')) return;
    const top = y - screen.getBoundingClientRect().top;
    if (target.closest('.status-icons,.pull-tab') || top >= 0 && top < Math.max(34, $('.safe-probe').offsetHeight + 26)) gesture = {kind: 'open', x, y};
  }
  /** Returns true while the drag is ours, so the page does not scroll under it. */
  function gestureMove(x, y) {
    const g = gesture;
    if (!g) return false;
    const dx = x - g.x, dy = y - g.y;
    if (!g.decided) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return false;
      if (Math.abs(dx) > Math.abs(dy)) { gesture = null; return false; }
      g.decided = true;
    }
    if (g.kind === 'unlock') return true;
    if (!g.pulling) {
      if (g.kind === 'open' && dy > 8) g.d = control({pulling: true});
      else if (g.kind === 'close' && dy < -8) pullTo(g.d, 1);
      else return true;
      g.pulling = true;
    }
    if (!g.d.live) { gesture = null; return false; }
    const h = g.d.overlay.querySelector('.sheet').offsetHeight || 400;
    g.amount = g.kind === 'open' ? (dy + 30) / h : 1 + dy / h;
    pullTo(g.d, g.amount);
    return true;
  }
  function gestureEnd(x, y, cancelled = false) {
    const g = gesture;
    gesture = null;
    if (!g) return;
    const dx = x - g.x, dy = y - g.y;
    if (g.kind === 'unlock') { if (!cancelled && Math.abs(dx) <= 70 && dy < -45) unlock(); return; }
    if (!g.pulling) return;
    pulledAt = Date.now();
    settle(g.d, g.kind === 'open' ? !cancelled && (g.amount > .3 || dy > 90) : cancelled || !(g.amount < .75 || dy < -80));
  }

  // ---------- Events ----------
  mount.addEventListener('click', event => {
    const b = event.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.app) { open(b.dataset.app); return; }
    if (b.dataset.openRole) { open('roles', b.dataset.openRole); return; }
    if (b.hasAttribute('data-slot')) { notify('這個位置留給以後的新 App'); return; }
    if (!b.dataset.system) return;
    run(() => {
      switch (b.dataset.system) {
        case 'close': api.close(); break;
        case 'home': showHome(); break;
        case 'back': back(); break;
        case 'power': locked ? unlock() : lock(); break;
        case 'unlock': unlock(); break;
        case 'island': open('roles'); break;
        case 'story-time': return editStoryTime();
        case 'control': if (Date.now() - pulledAt > 400) control(); break;
        case 'size': b.textContent = api.panelSize?.() || b.textContent; break;
        case 'help': help('桌面左右滑動翻頁，圖示開啟對應應用；底部橫條或左上角返回鍵回到桌面。\n從螢幕頂端往下拉（或點右上角的訊號和電量）開啟控制中心，往上推收起。側鍵可以看鎖屏，鎖屏隨時可以跳過。\n\n訊號和電量是你裝置上的真實狀態（有的瀏覽器不提供電量，比如 Safari、Firefox）。日期和時間跟隨劇情，點桌面時間可手動設定。角色庫保存角色名稱與固定外貌。'); break;
      }
    });
  }, {signal});
  // A mouse drags the home screen sideways to change page (fingers swipe it natively); a drag is not also a tap.
  {
    const pagesEl = $('.home-pages');
    let drag = null, dragged = 0;
    pagesEl.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button === 0 && pagesEl.children.length > 1) drag = {id: e.pointerId, x: e.clientX, left: pagesEl.scrollLeft, moved: false}; }, {signal});
    win.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < 6) return;
      if (!drag.moved) { drag.moved = true; pagesEl.style.scrollSnapType = 'none'; pagesEl.style.scrollBehavior = 'auto'; }
      pagesEl.scrollLeft = drag.left - dx;
    }, {signal});
    win.addEventListener('pointerup', e => {
      const d = drag; drag = null;
      if (!d?.moved) return;
      const w = pagesEl.clientWidth || 1, dx = e.clientX - d.x;
      let page = Math.round(d.left / w);
      if (Math.abs(dx) > w * 0.15) page += dx < 0 ? 1 : -1;
      page = Math.max(0, Math.min(pagesEl.children.length - 1, page));
      pagesEl.style.scrollSnapType = ''; pagesEl.style.scrollBehavior = '';
      pagesEl.scrollTo({left: page * w, behavior: 'smooth'});
      dragged = Date.now();
    }, {signal});
    pagesEl.addEventListener('click', e => { if (Date.now() - dragged < 350) { e.stopPropagation(); e.preventDefault(); } }, {signal, capture: true});
  }
  $('.home-pages').addEventListener('scroll', e => {
    const i = Math.round(e.target.scrollLeft / (e.target.clientWidth || 1));
    mount.querySelectorAll('.dots i').forEach((dot, k) => dot.toggleAttribute('data-on', k === i));
  }, {signal, passive: true});
  // Mouse and pen through pointer events; fingers through touch events, whose moves can be held back from scrolling.
  mount.addEventListener('pointerdown', e => { if (e.pointerType !== 'touch' && e.button === 0) gestureStart(e.target, e.clientX, e.clientY); }, {signal});
  mount.addEventListener('pointermove', e => { if (e.pointerType !== 'touch' && gesture && gestureMove(e.clientX, e.clientY)) e.preventDefault(); }, {signal});
  mount.addEventListener('pointerup', e => { if (e.pointerType !== 'touch') gestureEnd(e.clientX, e.clientY); }, {signal});
  mount.addEventListener('pointercancel', e => { if (e.pointerType !== 'touch') gestureEnd(e.clientX, e.clientY, true); }, {signal});
  mount.addEventListener('touchstart', e => { const t = e.touches[0]; if (e.touches.length === 1) gestureStart(e.target, t.clientX, t.clientY); else gestureEnd(0, 0, true); }, {signal, passive: true});
  mount.addEventListener('touchmove', e => { const t = e.touches[0]; if (t && gesture && gestureMove(t.clientX, t.clientY) && e.cancelable) e.preventDefault(); }, {signal, passive: false});
  mount.addEventListener('touchend', e => { const t = e.changedTouches[0]; if (t) gestureEnd(t.clientX, t.clientY); }, {signal});
  mount.addEventListener('touchcancel', () => gestureEnd(0, 0, true), {signal});
  doc.addEventListener('keydown', e => {
    doc.documentElement.dataset.keyboard = 'true';
    if (e.key === 'Escape') {
      e.preventDefault();
      if (sheet || locked || active) back(); else api.close();
    }
    if (locked && e.key === 'Tab') {
      const focusable = [...lockscreen.querySelectorAll('button')].filter(el => !el.disabled), first = focusable[0], last = focusable.at(-1);
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, {signal});
  doc.addEventListener('pointerdown', () => delete doc.documentElement.dataset.keyboard, {signal});
  doc.addEventListener('visibilitychange', () => { if (!doc.hidden) { run(refreshStoryTime); countUnread(); countMoments(); refreshQueue.resume(); } }, {signal});
  media.addEventListener('change', theme, {signal});

  const unsubscribe = api.subscribe(event => {
    if (disposed) return;
    if (event.type === 'settings') { theme(); renderWidgets(); wallMotion(); run(refreshAvatars); }
    if (event.type === 'phone') run(() => appearance(event.preferences));
    if (event.type === 'library') {
      const key = ({photos: 'gallery', notes: 'notes'})[event.collection];
      if (active === key) run(() => views.get(key)?.refresh());
    }
    if (event.type === 'draw') views.get('draw')?.onDraw?.(event);
    if (event.type === 'chat') { refreshView('chat', 'chat', event); countUnread(); }
    if (event.type === 'moments') { refreshView('chat'); countMoments(); }
    if (event.type === 'call') calls.update(event.call);
    if (event.type === 'forum' || event.type === 'peek') { const app = event.type; if (active === app) run(() => views.get(app)?.refresh()); }
    if (event.type === 'pocket') refreshView('chat', 'chat');
    if (event.type === 'pocket' || event.type === 'csb' || event.type === 'space') run(() => refreshStoryTime({reset: event.type === 'space'}));
    if (event.type === 'pocket' || event.type === 'csb') for (const name of POCKET_APPS) refreshView(name);
    // 分区: another card was opened in the tavern; the open app and the badges follow it.
    if (event.type === 'space') { for (const name of views.keys()) refreshView(name); countUnread(); countMoments(); }
    if (event.type === 'sync') {
      views.get('settings')?.onSync?.();
      // Content from another device: say so once, when that sync is over.
      const r = event.lastResult;
      if (!event.busy && event.lastAt !== lastSyncAt && (r?.pulled?.length || r?.merged?.length)) notify(r.merged?.length ? '兩臺裝置都有改動，已經合併好了' : '已讀取別的裝置的新內容');
      if (!event.busy) lastSyncAt = event.lastAt;
    }
    if (event.type === 'settings') refreshView('chat', 'chat');
  });

  // Unread chat messages, shown as a badge on the chat icon.
  // New 朋友圈 posts and comments by others since the user last opened it.
  function countMoments() {
    if (disposed || !panelVisible || doc.hidden) return;
    win.clearTimeout(freshTimer);
    freshTimer = win.setTimeout(() => run(async () => {
      const n = momentsNew(await api.listMoments(), momentsSeen(win));
      if (disposed || n === fresh) return;
      fresh = n;
      renderBadges();
    }), 150);
  }
  function countUnread() {
    if (disposed || !panelVisible || doc.hidden) return;
    win.clearTimeout(unreadTimer);
    unreadTimer = win.setTimeout(() => run(async () => {
      const n = await api.chatUnread();
      if (disposed || n === unread) return;
      unread = n;
      renderBadges();
    }), 120);
  }

  // ---------- Host hooks ----------
  const previousOpenRole = win.stTtsOpenRole, previousVisibility = win.stTtsPanelVisibility, previousOpenDraw = win.stTtsOpenDraw;
  win.stTtsOpenRole = id => open('roles', id);
  function takeDraw() {
    const request = api.takeDraw?.();
    if (!request) return false;
    open('draw');
    views.get('draw')?.load?.(request);
    return true;
  }
  win.stTtsOpenDraw = () => run(takeDraw);
  win.stTtsPanelVisibility = visible => {
    panelVisible = visible;
    doc.documentElement.toggleAttribute('data-panel-hidden', !visible);
    if (visible) { callState(); run(refreshAvatars); floatingBar(); run(refreshStoryTime); countUnread(); countMoments(); refreshQueue.resume(); if (active) refreshView(active); }
    if (!visible) sheet?.close(null);
    else if (takeDraw()) { /* opened from a chat picture */ }
    else if (preferences?.lockOnOpen) lock();
  };
  function dispose() {
    if (disposed) return;
    disposed = true;
    appearanceEpoch++;
    storyClockEpoch++;
    unsubscribe();
    refreshQueue.dispose();
    controller.abort();
    sheet?.close(null);
    for (const v of views.values()) v.dispose();
    calls.dispose();
    for (const url of avatarURLs.values()) if (url) win.URL.revokeObjectURL(url);
    setAvatarPictures({});
    for (const url of assets.values()) win.URL.revokeObjectURL(url);
    assets.clear();
    win.clearTimeout(toastTimer);
    win.clearTimeout(openTimer);
    win.clearTimeout(unreadTimer); win.clearTimeout(freshTimer);
    win.stTtsOpenRole = previousOpenRole;
    win.stTtsPanelVisibility = previousVisibility;
    win.stTtsOpenDraw = previousOpenDraw;
  }
  win.addEventListener('pagehide', dispose, {signal});
  applyThemeMode();
  renderHome();
  paintDevice();
  countUnread();
  countMoments();
  callState();
  run(refreshAvatars);
  floatingBar();

  const fallback = {wallpaper: {kind: 'builtin', key: 'sky'}, icons: {}, iconStyle: 'color', lockOnOpen: false, theme: api.getState().theme};
  const ready = api.getPhone().then(async p => {
    if (disposed) return;
    preferences = p;
    theme();
    await appearance(p);
    await refreshStoryTime();
    if (disposed) return;
    if (takeDraw()) { /* opened from a chat picture */ }
    else if (p.lockOnOpen) lock();
  }).catch(error => {
    if (disposed) return;
    notify(error.message, {error: true});
    return appearance(fallback);
  });
  return {ready, open, home: showHome, back, lock, unlock, dispose, views, get active() { return active; }, get locked() { return locked; }};
}

if (typeof window !== 'undefined' && window.document.getElementById('root')) {
  try { window.stTtsPhone = createPhoneApp({window, api: connectBackend()}); }
  catch (error) {
    const el = window.document.querySelector('.startup');
    if (el) { el.textContent = error.message; el.setAttribute('role', 'alert'); }
  }
}
