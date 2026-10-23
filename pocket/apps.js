/** Additional phone apps. Data and generation stay behind the host bridge. */
import {createView, esc, btn, heading, field, input, textArea, avatar, empty} from '../ui/common.js';
import {icon} from '../ui/icons.js';
export {instagramApp} from './instagram-ui.js';
import {openImageSettings} from './image-settings.js';
import {openWorldbookBrowser} from './worldbook-ui.js';
import {searchMarkup, openShopPresetSettings} from './shop-ui.js';

const rows = value => Array.isArray(value) ? value : [];
const stamp = value => {
  const d = new Date(value || Date.now());
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('zh-TW', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'});
};
const money = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-TW', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '—';
const tabs = (selected, choices) => `<div class="segmented pocket-tabs" role="group" aria-label="切換頁面">${choices.map(([id, label]) => `<button type="button" data-action="tab" data-tab="${esc(id)}" aria-pressed="${selected === id}">${esc(label)}</button>`).join('')}</div>`;
const order = items => [...rows(items)].sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
const person = (value, state) => value === 'me' || value === '{{user}}' ? state.userName || '我' : value || '角色';
const own = (value, state) => value === 'me' || value === '{{user}}' || value === state.userName;
const face = (name, state, size = 36) => avatar(person(name, state), 'none', size, own(name, state) ? 'me' : name);
const pluralNames = values => [...new Set(values.filter(Boolean).map(String))];

function appShell(ctx, name) {
  const v = createView(ctx, name);
  v.root.classList.add('pocket-app');
  let running = false;
  const banner = () => running ? '<p class="pocket-working" role="status"><span></span>正在處理，請稍候…</p>' : '';
  async function run(button, action, success = '') {
    if (running) return;
    running = true;
    v.root.setAttribute('aria-busy', 'true');
    button?.setAttribute('disabled', '');
    const status = ctx.doc.createElement('p');
    status.className = 'pocket-working'; status.setAttribute('role', 'status'); status.textContent = '正在處理，請稍候…';
    if (!v.root.querySelector('.pocket-working')) v.root.prepend(status);
    try {
      await action();
      if (success) ctx.notify(success);
    } finally {
      running = false;
      v.root.removeAttribute('aria-busy');
      status.remove();
      if (button?.isConnected) button.removeAttribute('disabled');
      if (!v.disposed) await v.refresh();
    }
  }
  return {v, run, banner, busy: () => running};
}

export function diaryApp(ctx) {
  const {api} = ctx, {v, run, banner} = appShell(ctx, 'diary');
  let state = {}, tab = 'mine', draft = null, reading = null, epoch = 0;
  function list() {
    const diaries = order(state.diaries).filter(d => tab === 'mine' ? d.private === true || own(d.from, state) : !d.private && !own(d.from, state));
    return tabs(tab, [['mine', '我的日記'], ['character', '角色日記']]) + banner()
      + (tab === 'mine' ? `<div class="pocket-privacy">${icon('lock')}<span>${state.settings?.sharePrivateDiary === true ? '我的日記已允許正文與手機模型讀取，可在「手機接入」關閉。' : '我的日記只供自己閱讀；若要讓正文及手機模型讀取，可在「手機接入」開啟。'}</span></div><div class="actions">${btn('diary-new', icon('add') + '寫一篇日記', 'primary')}</div>`
        : `<p class="hint">角色可以在劇情中寫日記，也可以由所選模型根據目前劇情補寫。</p><div class="actions">${btn('diary-generate', '生成角色日記', 'primary')}</div>`)
      + (diaries.length ? `<div class="pocket-journal-list">${diaries.map(d => `<button type="button" class="pocket-journal-card" data-action="diary-open" data-id="${esc(d.id)}"><small>${esc(stamp(d.at))} · ${esc(person(d.from, state))}</small><h2>${esc(d.title || '無題日記')}</h2><p>${esc(d.text)}</p><span>${d.private ? '私人日記' : '角色的心事'} ${icon('next')}</span></button>`).join('')}</div>` : empty(tab === 'mine' ? '留一頁給今天的自己' : '還沒有角色日記', tab === 'mine' ? '寫下喜歡的片段、沒說出口的話。' : '點上方按鈕，讓角色寫下此刻的心情。', 'edit'));
  }
  function editor() {
    return `<div class="pocket-privacy">${icon('lock')}<span>${state.settings?.sharePrivateDiary === true ? '私人日記 · 已允許模型讀取' : '私人日記 · 不會傳給模型'}</span></div><div class="pocket-diary-paper">${field('標題', input('diary-title', draft.title, 'text', 'maxlength="100" placeholder="今天，想記住…"'))}${field('日記', textArea('diary-text', draft.text, 'rows="14" maxlength="16000" placeholder="慢慢寫，這一頁只屬於你。"'))}</div><div class="pocket-compose-actions">${btn('diary-close', '返回', 'secondary')}${btn('diary-save', '儲存日記', 'primary')}</div>${draft.id ? `<div class="actions">${btn('diary-delete', '刪除日記', 'danger', `data-id="${esc(draft.id)}"`)}</div>` : ''}`;
  }
  function reader() {
    return `<article class="pocket-diary-paper pocket-diary-reading"><small>${esc(stamp(reading.at))} · ${esc(person(reading.from, state))}</small><h2>${esc(reading.title || '無題日記')}</h2><div>${esc(reading.text)}</div></article><div class="pocket-compose-actions">${btn('diary-close', '返回', 'secondary')}</div>`;
  }
  async function render() {
    const ticket = ++epoch, next = await api.pocketState();
    if (v.disposed || ticket !== epoch) return;
    if (state.scope !== undefined && state.scope !== next.scope) { draft = null; reading = null; }
    state = next;
    v.draw(heading(draft ? '寫日記' : '日記', '', '寫下今天') + (draft ? banner() + editor() : reading ? reader() : list()));
  }
  v.refresh = render;
  const close = async () => {
    if (draft && (draft.title.trim() || draft.text.trim()) && !await ctx.confirm('離開日記編輯？', '尚未儲存的修改將放棄。')) return;
    draft = null; reading = null; await render();
  };
  v.back = () => { if (!draft && !reading) return false; close().catch(e => ctx.notify(e.message, {error: true})); return true; };
  v.on('input', '[data-field]', el => { if (draft) draft[el.dataset.field === 'diary-title' ? 'title' : 'text'] = el.value; });
  v.on('click', '[data-action]', async el => {
    const id = el.dataset.id;
    switch (el.dataset.action) {
      case 'tab': tab = el.dataset.tab; await render(); break;
      case 'diary-new': draft = {title: '', text: '', private: true}; await render(); break;
      case 'diary-open': { const d = rows(state.diaries).find(x => x.id === id); if (!d) return; if (d.private === true || own(d.from, state)) draft = {id: d.id, title: d.title || '', text: d.text || '', private: true}; else reading = d; await render(); break; }
      case 'diary-close': await close(); break;
      case 'diary-save': if (!draft?.text.trim()) throw Error('先寫一點日記內容。'); await run(el, async () => { const saved = draft; await api.pocketAction('diary.save', {...saved, title: saved.title.trim(), text: saved.text.trim(), private: true}); if (draft === saved) draft = null; }, '日記已儲存'); break;
      case 'diary-delete': if (await ctx.confirm('刪除這篇日記？', '刪除後無法復原。')) await run(el, async () => { await api.pocketAction('diary.delete', {id}); draft = null; reading = null; }, '日記已刪除'); break;
      case 'diary-generate': await run(el, () => api.pocketAction('diary.generate', {from: state.characterName}), '角色日記已寫好'); break;
    }
  });
  render().catch(e => ctx.notify(e.message, {error: true}));
  return v;
}

export function storyshopApp(ctx) {
  const {api} = ctx, {v, run, banner, busy} = appShell(ctx, 'storyshop');
  let state = {}, wallet = {}, epoch = 0, query = '', draft = null;
  const pendingOrders = new Map();
  function balanceCard() {
    return `<div class="pocket-balance"><div><small>微信錢包 · 虛擬餘額</small><strong><span>¥</span> ${money(wallet.balance)}</strong></div><span class="pocket-shop-bag">${icon('wallet')}</span></div>`;
  }
  function editor() {
    return `<section class="pocket-shop-editor"><h2>${draft.id ? '編輯商品' : '手動新增商品'}</h2><p class="hint">直接設定虛構商品與售價，不需要模型回覆。儲存只會上架，確認購買後才扣款。手動商品會保留，更新只替換模型商品。</p>
      ${field('商品名稱（最多 80 字元）', input('shop-name', draft.name, 'text', 'maxlength="80" placeholder="例如：時間停止能力"'))}
      ${field('商品效果與用途', textArea('shop-description', draft.description, 'rows="5" maxlength="1000" placeholder="寫下在劇情中取得什麼、具有哪些效果"'))}
      ${field('價格（虛擬金錢）', input('shop-price', draft.price, 'text', 'inputmode="decimal" maxlength="15" placeholder="0.01–99999"'))}
      ${field('購入後分類', `<select data-field="shop-kind" aria-label="購入後分類"><option value="items" ${draft.kind !== 'abilities' ? 'selected' : ''}>我的物品（含人物／資格）</option><option value="abilities" ${draft.kind === 'abilities' ? 'selected' : ''}>我的能力</option></select>`)}
      ${field('商品圖示（可選）', input('shop-emoji', draft.emoji, 'text', 'maxlength="24" placeholder="🛍️"'))}
      <div class="pocket-compose-actions">${btn('shop-close', '返回商城', 'secondary')}${btn('shop-save', '儲存商品', 'primary')}</div>
      ${draft.id ? `<div class="actions">${btn('shop-delete', '刪除商品', 'danger', `data-id="${esc(draft.id)}"`)}</div>` : ''}</section>`;
  }
  function shop() {
    const items = rows(state.catalogue);
    return searchMarkup({query, busy: busy(), source: state.catalogueSource, shopPresets: state.shopPresets}) + `<div class="pocket-shop-intro"><span class="eyebrow">${esc(state.catalogueSource?.owner || state.userName || '你')} 專屬</span><h2>只為你開啟的萬寶商城</h2><p>物品、人物、資格與能力，都能依你的世界查詢。模型沒有回傳商品時，也能直接手動上架。購買後分類收進「我」，以記憶保存，供劇情需要時調用。</p><div class="pocket-shop-toolbar">${btn('shop-generate', items.length ? icon('refresh') + '更新模型商品' : '生成萬寶商品', 'primary')}${btn('shop-new', icon('add') + '手動新增', 'secondary')}</div></div>`
      + (items.length ? `<div class="pocket-products">${items.map((item, i) => `<article class="pocket-product"><div class="pocket-product-art tone-${i % 4}" aria-hidden="true">${esc(item.emoji || '🛍️')}</div><div class="pocket-product-info"><h3>${esc(item.name)}</h3><small>${item.kind === 'abilities' ? '能力' : '物品'} · ${item.source === 'manual' ? '手動設定' : '模型生成'}</small><p>${esc(item.description || '為此刻的劇情準備。')}</p><div><strong>¥ ${money(item.price)}</strong><span class="pocket-product-actions">${btn('shop-edit', '編輯', 'text-button', `data-id="${esc(item.id)}"`)}${btn('shop-buy', '購買', 'secondary', `data-id="${esc(item.id)}"`)}</span></div></div></article>`).join('')}</div>` : empty('你的萬寶商城，等你指定需求', '輸入想要的物品、人物或能力，或直接手動新增商品。', 'gift'));
  }
  async function render() {
    const ticket = ++epoch, [next, nextWallet] = await Promise.all([api.pocketState(), Promise.resolve(api.wallet())]);
    if (v.disposed || ticket !== epoch) return;
    if (state.scope !== undefined && state.scope !== next.scope) {query = ''; draft = null;}
    state = next; wallet = nextWallet || {};
    v.draw(heading('萬寶商城', '', '使用者專屬 · 萬物皆可查詢') + (draft ? banner() + editor() : balanceCard() + `<div class="pocket-actionline"><span>物品與能力會保存在「我」</span>${btn('shop-my-items', '開啟我的物品', 'secondary')}</div>` + banner() + shop()));
  }
  v.refresh = render;
  async function close() {
    if (draft && !await ctx.confirm('返回商城？', '尚未儲存的商品修改將放棄。')) return;
    draft = null; await render();
  }
  v.back = () => {if (!draft) return false; close().catch(error => ctx.notify(error.message, {error:true})); return true;};
  v.on('input', '[data-field]', el => {if (el.dataset.field === 'shop-query') query = el.value; else if (draft) draft[el.dataset.field.replace('shop-', '')] = el.value;});
  v.on('change', '[data-field=shop-kind]', el => {if (draft) draft.kind = el.value;});
  v.on('change', '[data-field=shop-preset]', el => run(el, () => api.pocketAction('shopPreset.select', {id:el.value}), '已切換商城生成預設'));
  async function search(el) {await run(el, () => api.pocketAction('shop.generate', {mode:'query', query, presetId:state.shopPresets?.selectedId}), '商品已上架');}
  v.on('keydown', '[data-field=shop-query]', (el,event) => {if(event.key==='Enter'&&!event.isComposing){event.preventDefault();return search(v.root.querySelector('[data-action=shop-search]'));}});
  v.on('click', '[data-action]', async el => {
    if (busy()) return;
    switch (el.dataset.action) {
      case 'shop-my-items': ctx.open('me', 'items'); break;
      case 'shop-presets': await openShopPresetSettings(ctx, {onChange:render}); break;
      case 'shop-search': await search(el); break;
      case 'shop-category': query = el.dataset.query; await search(el); break;
      case 'shop-generate': await run(el, () => api.pocketAction('shop.generate', {mode:'story', presetId:state.shopPresets?.selectedId}), '萬寶商品已更新'); break;
      case 'shop-new': draft = {name:'', description:'', price:'', kind:'items', emoji:'🛍️'}; await render(); break;
      case 'shop-edit': {
        const item = rows(state.catalogue).find(value => value.id === el.dataset.id);
        if (!item) throw Error('這件商品已更新，請重新選擇。');
        draft = {id:item.id, name:item.name, description:item.description, price:String(item.price), kind:item.kind || 'items', emoji:item.emoji || '🛍️'}; await render(); break;
      }
      case 'shop-close': await close(); break;
      case 'shop-save': if (draft) await run(el, async () => {const saved = draft; await api.pocketAction('shop.save', {...saved}); if (draft === saved) draft = null;}, '商品已儲存，尚未購買'); break;
      case 'shop-delete': if (await ctx.confirm('刪除這件商品？', '只會從商城下架，已購買的物品與能力保留。')) await run(el, async () => {await api.pocketAction('shop.delete', {id:el.dataset.id}); draft = null;}, '商品已下架'); break;
      case 'shop-buy': {
        const item = rows(state.catalogue).find(x => x.id === el.dataset.id);
        if (!item) throw Error('這件商品已更新，請重新選擇。');
        if (!await ctx.confirm(`購買「${item.name}」？`, `價格 ¥ ${money(item.price)}，會從微信的虛擬餘額扣除。`)) return;
        const key = JSON.stringify([state.scope, item.id, item.name, item.price]);
        const orderId = pendingOrders.get(key) || 'pocket-order-' + ctx.win.crypto.randomUUID();
        pendingOrders.set(key, orderId);
        await run(el, async () => { await api.pocketPurchase(item, orderId); pendingOrders.delete(key); }, item.kind === 'abilities' ? '購買成功，已放入我的能力' : '購買成功，已放入我的物品');
        break;
      }
    }
  });
  render().catch(e => ctx.notify(e.message, {error: true}));
  return v;
}

export function pocketsettingsApp(ctx) {
  const {api} = ctx, {v, run, banner} = appShell(ctx, 'pocketsettings');
  let state = {}, draft = null, epoch = 0, filter = '';
  const bookName = x => typeof x === 'string' ? x : x?.name || x?.id || '';
  function syncStatus() {
    const sync = state.sync || {}, error = sync.error || sync.lastError;
    const count = sync.events ?? sync.imported ?? sync.count ?? sync.messages;
    const date = sync.lastAt || sync.lastSyncAt || sync.lastSync || sync.at;
    const errors = rows(sync.errors).map(e => typeof e === 'string' ? e : e?.message || '').filter(Boolean);
    return `<div class="pocket-sync-status ${error || errors.length ? 'has-error' : ''}"><strong>${error || errors.length ? '同步有項目需要檢查' : date ? '手機與劇情已同步' : '手機訊息同步'}</strong><p>${typeof sync.status === 'string' ? esc(sync.status) : '角色在正文使用手機時，事件會自動進入相應 App。'}</p>${count != null ? `<small>已處理 ${esc(count)} 則事件${date ? ' · ' + esc(stamp(date)) : ''}</small>` : date ? `<small>最近同步 ${esc(stamp(date))}</small>` : ''}<p class="hint">已讀取 ${Number(sync.statusRoles)||0} 位角色狀態 · 支援 CSB 角色狀態工坊與舊版 CSB v2.1。點微信聯絡人頭像可檢視與修改角色狀態、身材與身體部位；狀態工坊資料會開啟原生編輯器；舊版狀態會寫回目前正文。</p>${error ? `<p class="pocket-error">${esc(error)}</p>` : ''}${errors.length ? `<details><summary>查看詳細訊息（${errors.length}）</summary>${errors.map(e => `<p class="pocket-error">${esc(e)}</p>`).join('')}</details>` : ''}</div>`;
  }
  function books() {
    const available = rows(state.worldbooks).map(bookName).filter(Boolean), all = pluralNames([...available, ...draft.worldbooks]);
    const visible = name => name.toLocaleLowerCase().includes(filter.toLocaleLowerCase());
    return `<div class="pocket-section-head"><h2>手機接入世界書</h2><span>${draft.worldbooks.length} 本</span></div><p class="hint">可選取大型世界書，不再限制 8 本或 500 個條目。所有啟用內容皆可搜尋，生成時按目前任務選取相關段落，結合正文與手機資料；酒館原本的世界書觸發設定繼續運作。</p>
      <input type="search" class="search" data-book-filter value="${esc(filter)}" placeholder="搜尋世界書" aria-label="搜尋世界書">
      <div class="pocket-books">${all.length ? all.map(name => `<label class="pocket-book" ${visible(name) ? '' : 'hidden'}><input type="checkbox" data-worldbook="${esc(name)}" ${draft.worldbooks.includes(name) ? 'checked' : ''}><span><strong>${esc(name)}</strong>${available.includes(name) ? '' : '<small class="pocket-error">此世界書已不存在，請取消選取</small>'}</span>${icon('book')}</label>`).join('') : '<p class="hint">沒有符合的世界書。請先在酒館匯入世界書，再回到這裡。</p>'}</div><div class="pocket-actionline">${btn('worldbooks-browse', '搜尋／閱讀世界書內容', 'secondary')}<small>${draft.worldbookPins.length} 個優先條目</small></div><div class="pocket-lore-budget">${field('每次生成的世界書背景預算（字元）', input('worldbookBudget', draft.worldbookBudget, 'number', 'min="2000" max="2000000" step="1000" inputmode="numeric"'))}<p class="hint">預設 48,000 字元，可依模型調整。這只限制單次送給模型的背景量，不限制整本世界書的讀取與搜尋；模型仍有自己的上下文上限。數值太大可能超出模型容量或增加費用。</p></div>`;
  }
  async function render() {
    const ticket = ++epoch, next = await api.pocketState();
    if (v.disposed || ticket !== epoch) return;
    if (state.scope !== undefined && state.scope !== next.scope) { draft = null; filter = ''; }
    state = next;
    if (!draft) draft = {profileId: state.settings?.profileId || '', worldbooks: [...rows(state.settings?.worldbooks)], worldbookPins: rows(state.settings?.worldbookPins).map(pin => ({...pin})), worldbookBudget: state.settings?.worldbookBudget ?? 48000, inject: state.settings?.inject !== false,autoWeChatPhotos:state.settings?.autoWeChatPhotos!==false,sharePrivateDiary:state.settings?.sharePrivateDiary===true,mirrorForum:state.settings?.mirrorForum!==false,mirrorShop:state.settings?.mirrorShop!==false};
    const profiles = rows(state.connections), savedMissing = draft.profileId && !profiles.some(p => p.id === draft.profileId);
    const options = [['', '沿用手機「引擎」設定'], ...profiles.map(p => [p.id, p.name + (p.model ? ' · ' + p.model : '')]), ...(savedMissing ? [[draft.profileId, '已失效的連線設定，請重新選擇']] : [])];
    v.draw(heading('手機接入', '', '你的世界與模型') + banner()
      + `<div class="pocket-settings-card"><h2>手機使用的大模型</h2><p class="hint">可沿用酒館目前模型、手機獨立 API，或選擇酒館已保存的連線設定。</p>${field('模型連線', `<span class="select"><select data-field="profileId" aria-label="模型連線">${options.map(([id, label]) => `<option value="${esc(id)}" ${draft.profileId === id ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></span>`)}<div class="pocket-actionline">${btn('open-engines', '開啟引擎設定', 'secondary')}<small>目前模型／獨立 API</small></div>${profiles.length ? '' : '<p class="hint">若要使用保存的連線，請先在酒館「連線管理員」建立設定。</p>'}</div>
      <div class="pocket-settings-card">${books()}</div>
      <div class="pocket-settings-card"><h2>微信照片 · NovelAI</h2><label class="pocket-toggle"><span><strong>角色傳圖時自動生成</strong><small>使用你在引擎裡設定的 NovelAI 金鑰與圖片參數，完成後直接送進微信。會依 NovelAI 帳戶方案消耗額度。</small></span><input type="checkbox" class="switch" data-field="autoWeChatPhotos" ${draft.autoWeChatPhotos ? 'checked' : ''}></label><p class="hint">只處理新收到的角色照片描述。已生成圖片、現成圖片網址及安裝前的舊訊息不會重複生成。</p><div class="pocket-preset-toolbar">${btn('open-novelai', '設定 NovelAI 金鑰', 'secondary')}${btn('open-image-settings', '生圖預設與微信模型', 'primary')}</div><p class="hint">長按微信圖片，可修改畫師串、正負面提示詞並重新生成。</p></div>
      <div class="pocket-settings-card"><h2>正文與手機互通</h2><label class="pocket-toggle"><span><strong>向角色提供手機事件規則</strong><small>讓正文讀取目前手機內容，並在角色使用手機時輸出可同步的訊息。</small></span><input type="checkbox" class="switch" data-field="inject" ${draft.inject ? 'checked' : ''}></label><p class="hint">開啟後會向正文提供手機規則、近期聊天、貼文、限動與交易摘要。手機操作也會同步為正文卡片，正文中的手機事件會進入相應軟體。角色日記會作為背景；你的私人日記則依下方設定決定是否提供。內建規則與配套世界書擇一啟用即可。</p><p class="hint">正文輸入框旁的「我・物品・能力」按鈕可搜尋並帶入目前個人資料、持有物品與能力；選取不會自動送出訊息。</p><label class="pocket-toggle"><span><strong>論壇操作顯示正文卡片</strong><small>新的貼文與回覆會合併進手機動態；舊記憶不會補發。</small></span><input type="checkbox" class="switch" data-field="mirrorForum" ${draft.mirrorForum ? 'checked' : ''}></label><label class="pocket-toggle"><span><strong>商城購買顯示正文收據</strong><small>購買成功才顯示；商品搜尋與清單只保存為記憶。關閉後，購買紀錄仍保留。</small></span><input type="checkbox" class="switch" data-field="mirrorShop" ${draft.mirrorShop ? 'checked' : ''}></label><label class="pocket-toggle"><span><strong>允許正文與手機模型讀取我的私人日記</strong><small>預設關閉。開啟後，已儲存的私人日記會加入正文與手機文字生成的背景。</small></span><input type="checkbox" class="switch" data-field="sharePrivateDiary" ${draft.sharePrivateDiary ? 'checked' : ''}></label>${syncStatus()}${Number.isFinite(state.sync?.legacyBalance) ? `<p class="hint">舊版此對話可用餘額 ¥ ${money(state.sync.legacyBalance)}；新版共用錢包未自動合併，可在微信錢包修改。</p>` : ''}<div class="actions">${btn('pocket-sync', icon('refresh') + '重新同步正文訊息', 'secondary')}</div></div>
      <div class="pocket-settings-card"><h2>世界書與正則 · v0.9.0</h2><p class="hint">更新手機協定與正文卡片。微信、轉帳、紅包與 Instagram 保留行內卡片；論壇貼文與購買成功會顯示新卡片，同時保留「我 → 長期記憶」；可在上方分別關閉同步。例如輸入 <code>微信傳給林知夏：「吃飯沒？」</code> 即可顯示聊天卡片。</p>${btn('presets-install', '安裝／更新配套規則', 'secondary')}</div>
      <div class="pocket-settings-save">${btn('settings-save', '儲存手機接入設定', 'primary')}<small>模型與世界書設定儲存後生效</small></div>`);
  }
  v.refresh = render;
  v.on('change', '[data-field]', el => { draft[el.dataset.field] = el.type === 'checkbox' ? el.checked : el.dataset.field === 'worldbookBudget' ? Number(el.value) : el.value; });
  v.on('change', '[data-worldbook]', el => {
    if (el.checked && !draft.worldbooks.includes(el.dataset.worldbook)) {
      draft.worldbooks.push(el.dataset.worldbook);
    } else if (!el.checked) {draft.worldbooks = draft.worldbooks.filter(n => n !== el.dataset.worldbook); draft.worldbookPins = draft.worldbookPins.filter(pin => pin.book !== el.dataset.worldbook);}
    const count = v.root.querySelector('.pocket-section-head > span');
    if (count) count.textContent = `${draft.worldbooks.length} 本`;
    const pinsCount = v.root.querySelector('[data-action="worldbooks-browse"]')?.parentElement.querySelector('small');
    if (pinsCount) pinsCount.textContent = `${draft.worldbookPins.length} 個優先條目`;
  });
  v.on('input', '[data-book-filter]', el => {
    filter = el.value;
    for (const label of v.root.querySelectorAll('.pocket-book')) label.hidden = !label.querySelector('input').dataset.worldbook.toLocaleLowerCase().includes(filter.toLocaleLowerCase());
  });
  v.on('click', '[data-action]', async el => {
    switch (el.dataset.action) {
      case 'open-engines': ctx.open('engines'); break;
      case 'open-novelai': ctx.editEngine?.('nai'); break;
      case 'open-image-settings': await openImageSettings(ctx); break;
      case 'worldbooks-browse': { const editor = draft; const dialog = await openWorldbookBrowser(ctx, {names:[...editor.worldbooks], getPins:() => editor.worldbookPins, onPinsChange:pins => {if (draft === editor) editor.worldbookPins = pins;}}); dialog.onClose(() => {if (!v.disposed) render().catch(error => ctx.notify(error.message, {error:true}));}); break; }
      case 'settings-save': await run(el, async () => { await api.pocketAction('settings.save', {...draft, worldbooks: [...draft.worldbooks]}); draft = null; }, '手機接入設定已儲存'); break;
      case 'pocket-sync': await run(el, () => api.pocketAction('sync', {}), '正文訊息已重新同步'); break;
      case 'presets-install': await run(el, () => api.pocketAction('presets.install', {}), 'Tavern Pocket 世界書與正則已更新'); break;
    }
  });
  render().catch(e => ctx.notify(e.message, {error: true}));
  return v;
}
