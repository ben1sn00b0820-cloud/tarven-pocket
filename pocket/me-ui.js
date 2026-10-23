import {createView, esc, btn, heading, field, input, textArea, avatar, empty} from '../ui/common.js';
import {icon} from '../ui/icons.js';
import {saveFile} from '../download.js';

const rows = value => Array.isArray(value) ? value : [];
const clone = value => structuredClone(value);
const BRANCHES = [['profile', '我的資訊', 'person', '名字、身體與自訂欄位'], ['items', '我的物品', 'gift', '購買所得與隨身收藏'], ['abilities', '我的能力', 'wand', '技能、資格與特殊能力'], ['memory', '長期記憶', 'book', '保存資料與專屬世界書']];
const SHORT = [['name', '名字'], ['age', '年齡'], ['height', '身高'], ['weight', '體重']];
const LONG = [['build', '身材'], ['appearance', '外貌'], ['body', '身體描述'], ['anatomy', '其他身體資訊'], ['penis', '陰莖資訊']];
const date = value => value ? new Date(value).toLocaleString('zh-TW', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'}) : '';
const ARCHIVE_ACTIONS = {post: '貼文', comment: '留言', reply: '回覆', purchase: '購買', query: '查詢', search: '查詢', catalogue: '商品目錄', catalog: '商品目錄', generate: '商品生成'};

/** Personal facts are edited explicitly. Live phone updates never replace an unsaved draft. */
export function meApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'me'); v.root.classList.add('pocket-app', 'tp-me');
  let state = null, branch = '', draft = null, dirty = false, running = false, epoch = 0, changedElsewhere = false;
  let archive = null, archiveError = '', archiveQuery = '', archiveQueryDraft = '', archiveFilter = 'all';
  const profile = () => state?.profile || {};
  const branchLabel = () => BRANCHES.find(([id]) => id === branch)?.[1] || '我';
  const revision = () => state?.revision;
  function beginProfile() { draft = {kind: 'profile', revision: revision(), value: clone(profile())}; draft.value.customFields = rows(draft.value.customFields); dirty = false; changedElsewhere = false; }
  function updateDirty() {
    dirty = true;
    const el = v.root.querySelector('[data-me-draft-state]');
    if (el) { el.textContent = '尚未儲存'; el.classList.add('dirty'); }
  }
  function header() {
    return heading(branchLabel(), '', '你的故事，由你定義') + (branch ? `<div class="tp-me-subnav">${btn('me-home', icon('back') + '回到我', 'text-button')}<span>${esc(state?.persona || '目前使用者')}</span></div>` : '');
  }
  function home() {
    return `<section class="tp-me-hero">${avatar(profile().name || state.persona || '我', 'none', 66, 'me')}<div><span class="eyebrow">屬於你的角色</span><h2>${esc(profile().name || state.persona || '我')}</h2><p>資訊、物品與能力，保存在這裡。</p></div></section><div class="tp-me-branches">${BRANCHES.map(([id, label, art, detail]) => `<button type="button" class="tp-me-branch" data-action="me-branch" data-branch="${id}"><span class="tp-me-branch-icon">${icon(art)}</span><span><strong>${label}</strong><small>${esc(detail)}</small></span>${icon('next')}</button>`).join('')}</div><p class="hint tp-me-footnote">資料跟隨目前使用者名稱保存。切換對話仍保留；切換使用者名稱會使用各自的資料。</p>`;
  }
  function statusLine() {
    return `<div class="tp-me-draft-line"><span data-me-draft-state class="${dirty ? 'dirty' : ''}">${dirty ? '尚未儲存' : '可直接編輯'}</span><small>未填寫的欄位保持空白</small></div><div class="tp-me-stale" data-me-stale ${changedElsewhere ? '' : 'hidden'} role="status">資料已有新版本。你的草稿仍保留，重新載入後再修改。${btn('me-reload', '重新載入', 'text-button')}</div>`;
  }
  function profileEditor() {
    const p = draft?.value || profile();
    return `<div class="tp-me-profile-intro">${avatar(p.name || state.persona || '我', 'none', 48, 'me')}<div><strong>我的資訊</strong><p>只記錄你填入的內容，不自動補猜。</p></div></div>${statusLine()}<div class="tp-me-panel"><div class="tp-me-fields">${SHORT.map(([key, label]) => field(label, input('me-' + key, p[key] || '', 'text', 'maxlength="120" placeholder="未填寫"'))).join('')}</div>${LONG.map(([key, label]) => field(label, textArea('me-' + key, p[key] || '', 'rows="3" maxlength="4000" placeholder="可留空；由你自行描述"'))).join('')}</div><section class="tp-me-panel"><div class="tp-me-section-head"><h2>自訂欄位</h2>${btn('me-custom-add', icon('add') + '新增欄位', 'secondary')}</div><p class="hint">可加入身分、生日、偏好或其他想保留的資料。</p><div class="tp-me-custom-list">${rows(p.customFields).map((f, index) => `<div class="tp-me-custom" data-me-custom="${index}">${field('欄位名稱', input('me-custom-name', f.name, 'text', `data-custom-index="${index}" maxlength="80" placeholder="例如：慣用手"`))}${field('內容', textArea('me-custom-value', f.value, `data-custom-index="${index}" rows="2" maxlength="2000" placeholder="自行填寫"`))}${btn('me-custom-remove', icon('trash'), 'text-button', `data-index="${index}" aria-label="移除自訂欄位 ${index + 1}"`)}</div>`).join('') || '<p class="tp-me-soft">尚未新增自訂欄位。</p>'}</div></section><div class="tp-me-savebar">${btn('me-profile-save', icon('check') + '儲存我的資訊', 'primary')}</div>`;
  }
  function assetList() {
    const list = rows(state[branch]), isItems = branch === 'items';
    return `<div class="tp-me-section-head"><div><h2>${branchLabel()}</h2><p>${isItems ? '萬寶商城購買的物品會收進這裡' : '收藏你的技能、資格與特殊能力'}</p></div>${btn('me-entry-new', icon('add') + '新增', 'primary')}</div>${isItems ? `<div class="tp-me-list-actions">${btn('me-open-shop', icon('shop') + '前往萬寶商城', 'secondary')}${!state.migration?.walletImported ? btn('me-wallet-import', '匯入舊版我的物品', 'text-button') : ''}</div>` : ''}${list.length ? `<div class="tp-me-entry-list">${list.map(item => `<article class="tp-me-entry"><div class="tp-me-entry-title"><span class="tp-me-entry-art">${icon(isItems ? 'gift' : 'wand')}</span><div><h3>${esc(item.name)}</h3><small>${isItems ? '我的物品' : '我的能力'}${item.quantity ? ' · × ' + esc(item.quantity) : ''}</small></div>${btn('me-entry-edit', '編輯', 'text-button', `data-id="${esc(item.id)}"`)}</div>${item.description ? `<p>${esc(item.description)}</p>` : '<p class="tp-me-soft">尚未填寫描述。</p>'}${item.source ? `<small class="tp-me-source">來源：${esc(item.source)}</small>` : ''}</article>`).join('')}</div>` : empty(isItems ? '先收進一件屬於你的物品' : '寫下你的第一項能力', isItems ? '可以手動新增，或到萬寶商城購買。' : '名稱與說明由你決定，也可在萬寶商城查詢。', isItems ? 'gift' : 'wand')}`;
  }
  function entryEditor() {
    const p = draft.value;
    return `${statusLine()}<section class="tp-me-panel"><h2>${p.id ? '編輯' : '新增'}${branch === 'items' ? '物品' : '能力'}</h2>${field('名稱', input('me-entry-name', p.name, 'text', 'maxlength="120" placeholder="自行命名"'))}${field('描述', textArea('me-entry-description', p.description, 'rows="8" maxlength="8000" placeholder="用途、特性、限制或來歷"'))}${field('數量', input('me-entry-quantity', p.quantity ?? '', 'number', 'min="1" max="999999" step="1" placeholder="未填寫時為 1"'))}</section><div class="tp-me-savebar">${btn('me-entry-cancel', '返回列表', 'secondary')}${btn('me-entry-save', '儲存', 'primary')}</div>${p.id ? `<div class="tp-me-delete">${btn('me-entry-delete', '刪除這項' + (branch === 'items' ? '物品' : '能力'), 'danger', `data-id="${esc(p.id)}"`)}</div>` : ''}`;
  }
  function archivePanel() {
    const wb = archive?.worldbook || {}, list = rows(archive?.records).filter(record => archiveFilter === 'all' || record.app === archiveFilter);
    const total = Number(archive?.count) || 0, matched = Number(archive?.matched ?? total) || 0;
    const syncLabel = wb.error ? '等待重新同步' : wb.lastSyncedAt ? '已寫入世界書' : '尚未寫入世界書';
    return `<section class="tp-me-panel tp-me-archive" aria-label="論壇與商城記憶"><div class="tp-me-section-head"><div><span class="eyebrow">目前這段對話</span><h2>論壇與商城記憶</h2></div><span class="tp-me-archive-symbol">${icon('layers')}</span></div><p class="tp-me-soft">論壇貼文與商城記錄收在這裡，不另發到正文。需要時，可在正文提及論壇或萬寶商城，並說明要回憶的內容。</p><div class="tp-me-archive-counts"><span>${icon('bubble')}<strong>${Number(archive?.forum) || 0}</strong><small>論壇記錄</small></span><span>${icon('shop')}<strong>${Number(archive?.shop) || 0}</strong><small>商城記錄</small></span></div><div class="tp-me-archive-search">${input('me-archive-query', archiveQueryDraft, 'search', 'maxlength="300" placeholder="搜尋人物、商品或關鍵字" autocomplete="off"').replace('aria-label="me-archive-query"', 'aria-label="搜尋論壇與商城記憶"')}${btn('me-archive-search', icon('search'), 'secondary', 'aria-label="搜尋記憶"')}</div><div class="tp-me-archive-toolbar"><div class="tp-me-archive-filters" role="group" aria-label="記憶來源">${[['all', '全部'], ['forum', '論壇'], ['shop', '萬寶商城']].map(([key, label]) => btn('me-archive-filter', label, 'text-button', `data-filter="${key}" aria-pressed="${archiveFilter === key}"`)).join('')}</div>${btn('me-archive-refresh', icon('refresh'), 'text-button', 'aria-label="重新整理記憶"')}</div>${archiveError ? `<p class="tp-me-error" role="alert">${esc(archiveError)}</p>` : ''}${archive ? `<p class="tp-me-archive-result" role="status">${archiveQuery ? `「${esc(archiveQuery)}」符合 ${matched} 筆` : `已保存 ${total} 筆記憶`} · 顯示 ${list.length} 筆${rows(archive.records).length < matched ? '，可搜尋較早的內容' : ''}</p>` : ''}<div class="tp-me-archive-records">${list.map(record => {
      const title = record.title || record.itemName || (record.app === 'forum' ? '論壇動態' : '商城記錄'), from = [record.from, record.to ? '→ ' + record.to : ''].filter(Boolean).join(' ');
      const amount = record.amount != null && Number.isFinite(Number(record.amount)) ? Number(record.amount).toLocaleString('zh-TW', {maximumFractionDigits: 2}) : '';
      return `<details class="tp-me-archive-record" data-group="tp-archive-${esc(record.id)}" data-archive-app="${record.app === 'forum' ? 'forum' : 'shop'}"><summary><span class="tp-me-archive-record-icon">${icon(record.app === 'forum' ? 'bubble' : 'shop')}</span><span><small>${record.app === 'forum' ? '論壇' : '萬寶商城'} · ${esc(ARCHIVE_ACTIONS[record.action] || '記錄')}</small><strong>${esc(title)}</strong><time>${esc(date(record.at))}</time></span>${icon('down')}</summary><div class="tp-me-archive-record-body">${from ? `<small>${esc(from)}</small>` : ''}${record.text ? `<p>${esc(record.text)}</p>` : '<p class="tp-me-soft">未附文字說明。</p>'}${amount !== '' ? `<span class="tp-me-archive-amount">記錄金額 · ${esc(amount)}</span>` : ''}</div></details>`;
    }).join('') || `<div class="tp-me-archive-empty">${icon('book')}<strong>${archiveError ? '記憶暫時未載入' : archiveQuery || archiveFilter !== 'all' ? '沒有符合的記錄' : '這段對話還沒有記錄'}</strong><p>${archiveError ? '請按重新整理，再次取得已保存的內容。' : archiveQuery || archiveFilter !== 'all' ? '換個關鍵字，或切換到全部記憶。' : '使用論壇或萬寶商城後，會自動收錄在這裡。'}</p></div>`}</div><div class="tp-me-archive-worldbook"><div><strong>本對話專屬世界書</strong><span class="tp-me-badge">${syncLabel}</span></div><p class="tp-me-worldbook-name">${esc(wb.name || '寫入時建立本對話的記憶世界書')}</p>${wb.lastSyncedAt ? `<small>最近寫入：${esc(date(wb.lastSyncedAt))}</small>` : ''}${wb.error ? `<p class="tp-me-error" role="alert">${esc(wb.error)}</p>` : ''}<div class="tp-me-list-actions">${btn('me-archive-sync', icon('book') + '寫入世界書', 'secondary')}${btn('me-archive-export', icon('download') + '匯出 JSON', 'text-button')}</div><p class="hint">這裡的記錄跟隨目前對話保存。你的物品與能力仍保存在「我」的個人資料中。</p></div></section>`;
  }
  function memory() {
    const wb = state.worldbook || {}, known = [...SHORT, ...LONG].filter(([key]) => String(profile()[key] || '').trim()).length + rows(profile().customFields).filter(f => f.name && f.value).length;
    const label = wb.error ? '同步尚未完成' : wb.lastSyncedAt ? '已寫入世界書' : '尚未寫入世界書';
    return `<section class="tp-me-memory-hero"><span>${icon('book')}</span><h2>讓故事記得你</h2><p>你的資訊、物品與能力會保存為個人資料，供正文與手機生成參考。專屬世界書可另外寫入酒館或匯出備份。</p><div class="tp-me-memory-counts"><span><b>${known}</b> 項資訊</span><span><b>${rows(state.items).length}</b> 件物品</span><span><b>${rows(state.abilities).length}</b> 項能力</span></div></section>${archivePanel()}<section class="tp-me-panel"><div class="tp-me-section-head"><h2>個人資料世界書</h2><span class="tp-me-badge">${label}</span></div><p class="tp-me-worldbook-name">${esc(wb.name || '將依目前使用者建立')}</p>${wb.lastSyncedAt ? `<small>最近寫入：${esc(date(wb.lastSyncedAt))}</small>` : ''}${wb.error ? `<p class="tp-me-error" role="alert">${esc(wb.error)}</p>` : ''}<label class="pocket-toggle tp-me-worldbook-toggle"><span><strong>修改後自動更新世界書</strong><small>儲存個人資料或增減物品、能力時，同步到這本專屬世界書。</small></span><input class="switch" type="checkbox" data-field="me-auto-worldbook" ${state.options?.autoWorldbook ? 'checked' : ''}></label><div class="tp-me-list-actions">${btn('me-worldbook-sync', icon('book') + '立即寫入世界書', 'primary')}${btn('me-worldbook-export', '匯出世界書 JSON', 'secondary')}</div><p class="hint">JSON 可在酒館世界書管理中匯入。手機已提供個人資料時，無須再重複綁定相同條目。</p></section>${Number(state.contextStatus?.omitted) > 0 ? `<p class="hint">資料已完整保存；單次生成為控制長度，略過 ${Number(state.contextStatus.omitted)} 項較後面的資料。</p>` : ''}<div class="tp-me-list-actions">${btn('me-branch', '編輯我的資訊', 'secondary', 'data-branch="profile"')}${btn('me-branch', '查看我的能力', 'secondary', 'data-branch="abilities"')}</div>`;
  }
  function draw() {
    if (!state || v.disposed) return;
    const searchFocused = ctx.doc.activeElement?.matches('[data-field="me-archive-query"]') && v.root.contains(ctx.doc.activeElement);
    const selection = searchFocused ? [ctx.doc.activeElement.selectionStart, ctx.doc.activeElement.selectionEnd] : null;
    v.draw(header() + (running ? '<p class="pocket-working" role="status">正在儲存，請稍候…</p>' : '') + (!branch ? home() : branch === 'profile' ? profileEditor() : branch === 'memory' ? memory() : draft?.kind === 'entry' ? entryEditor() : assetList()));
    if (running) for (const control of v.root.querySelectorAll('button,input,textarea,select')) control.disabled = true;
    else if (searchFocused) { const box = v.root.querySelector('[data-field="me-archive-query"]'); box?.focus({preventScroll: true}); if (box && selection) box.setSelectionRange(...selection); }
  }
  async function refresh() {
    const ticket = ++epoch, requestedArchive = branch === 'memory';
    const [next, nextArchive] = await Promise.all([api.pocketMemoryState(), requestedArchive ? (async () => {
      try {
        if (typeof api.pocketArchiveState !== 'function') throw Error('請重新整理酒館，載入新版記憶功能。');
        return {value: await api.pocketArchiveState(archiveQuery)};
      }
      catch (error) { return {error: error?.message || '暫時無法載入論壇與商城記憶，請重新整理。'}; }
    })() : null]);
    if (v.disposed || ticket !== epoch) return;
    if (state && state.persona !== next.persona) { draft = null; dirty = false; branch = ''; changedElsewhere = false; archive = null; archiveQuery = ''; archiveQueryDraft = ''; archiveFilter = 'all'; }
    else if (requestedArchive) { archive = nextArchive?.value || null; archiveError = nextArchive?.error || ''; }
    state = next;
    if (draft && dirty) {
      changedElsewhere = draft.revision !== state.revision;
      const notice = v.root.querySelector('[data-me-stale]'); if (notice) notice.hidden = !changedElsewhere;
      return;
    }
    if (branch === 'profile') beginProfile();
    else if (draft?.kind === 'entry') {
      if (draft.value.id) { const current = rows(state[branch]).find(x => x.id === draft.value.id); draft = current ? {kind: 'entry', revision: revision(), value: clone(current)} : null; }
      else draft.revision = revision();
    }
    draw();
  }
  async function leaveDraft() {
    if (dirty && !await ctx.confirm('放棄尚未儲存的修改？', '已儲存的個人資料會保留。')) return false;
    draft = null; dirty = false; changedElsewhere = false; return true;
  }
  async function openBranch(next) {
    if (!await leaveDraft()) return;
    branch = BRANCHES.some(([id]) => id === next) ? next : '';
    await refresh();
  }
  async function perform(el, action, payload, success, {clear = false} = {}) {
    if (running || !state) return;
    const persona = state.persona; running = true; el?.setAttribute('disabled', '');
    for (const control of v.root.querySelectorAll('button,input,textarea,select')) control.disabled = true;
    try {
      const result = await api.pocketMemoryAction(action, payload);
      const live = await api.pocketMemoryState();
      if (v.disposed) return result;
      if (live.persona !== persona) { state = live; draft = null; dirty = false; branch = ''; return; }
      state = live;
      if (clear) { draft = null; dirty = false; changedElsewhere = false; }
      if (branch === 'profile' && !draft) beginProfile();
      if (success) ctx.notify(success);
      return result;
    } catch (error) {
      if (error?.code === 'STALE' || /已變更|已變動/.test(error?.message || '')) changedElsewhere = true;
      throw error;
    } finally { running = false; if (!v.disposed) draw(); }
  }
  async function performArchive(el, action) {
    if (running || !state) return;
    running = true; el?.setAttribute('disabled', '');
    for (const control of v.root.querySelectorAll('button,input,textarea,select')) control.disabled = true;
    try {
      const result = await api.pocketArchiveAction(action);
      if (v.disposed) return;
      await refresh();
      if (action === 'worldbook.export') {
        const book = result.book || result, fileName = (result.name || 'TavernPocket_論壇與商城記憶').replace(/[\\/:*?"<>|]/g, '_') + '.json';
        await saveFile(ctx.doc, new ctx.win.Blob([JSON.stringify(book, null, 2)], {type: 'application/json'}), fileName);
        ctx.notify('論壇與商城記憶已匯出');
      } else ctx.notify('論壇與商城記憶已寫入世界書');
    } finally { running = false; if (!v.disposed) draw(); }
  }
  v.refresh = refresh;
  v.edit = next => { openBranch(next).catch(e => ctx.notify(e.message, {error: true})); };
  v.back = () => { if (!branch) return false; openBranch('').catch(e => ctx.notify(e.message, {error: true})); return true; };
  const dispose = v.dispose; v.dispose = () => { epoch++; dispose(); };
  v.on('input', '[data-field]', el => {
    if (el.dataset.field === 'me-archive-query') { archiveQueryDraft = el.value; return; }
    if (!draft || running) return;
    const key = el.dataset.field;
    if (draft.kind === 'profile') {
      if (key === 'me-custom-name' || key === 'me-custom-value') {
        const f = draft.value.customFields[Number(el.dataset.customIndex)]; if (!f) return; f[key === 'me-custom-name' ? 'name' : 'value'] = el.value;
      } else if ([...SHORT, ...LONG].some(([name]) => key === 'me-' + name)) draft.value[key.slice(3)] = el.value;
      else return;
    } else if (key.startsWith('me-entry-')) draft.value[key.slice(9)] = el.value;
    else return;
    updateDirty();
  });
  v.on('change', '[data-field="me-auto-worldbook"]', async el => {
    const value = el.checked; await perform(el, 'options.save', {revision: revision(), autoWorldbook: value}, value ? '已開啟自動更新世界書' : '已關閉自動更新世界書');
  });
  v.on('keydown', '[data-field="me-archive-query"]', async (el, event) => {
    if (event.key !== 'Enter' || event.isComposing || running) return;
    event.preventDefault(); archiveQuery = el.value.trim(); archiveQueryDraft = el.value; await refresh();
  });
  v.on('click', '[data-action]', async el => {
    if (running) return;
    switch (el.dataset.action) {
      case 'me-home': await openBranch(''); break;
      case 'me-branch': await openBranch(el.dataset.branch); break;
      case 'me-reload': if (await leaveDraft()) await refresh(); break;
      case 'me-custom-add': if (rows(draft?.value.customFields).length >= 100) throw Error('最多可新增 100 個自訂欄位。'); draft.value.customFields.push({name: '', value: ''}); updateDirty(); draw(); break;
      case 'me-custom-remove': draft.value.customFields.splice(Number(el.dataset.index), 1); updateDirty(); draw(); break;
      case 'me-profile-save': await perform(el, 'profile.save', {revision: draft.revision, profile: clone(draft.value)}, '我的資訊已儲存', {clear: true}); break;
      case 'me-entry-new': draft = {kind: 'entry', revision: revision(), value: {name: '', description: '', quantity: ''}}; dirty = false; changedElsewhere = false; draw(); break;
      case 'me-entry-edit': { const found = rows(state[branch]).find(x => x.id === el.dataset.id); if (!found) throw Error('資料已更新，請重新開啟。'); draft = {kind: 'entry', revision: revision(), value: clone(found)}; dirty = false; changedElsewhere = false; draw(); break; }
      case 'me-entry-cancel': if (await leaveDraft()) draw(); break;
      case 'me-entry-save': {
        const value = clone(draft.value), payload = {kind: branch, revision: draft.revision, ...(value.id ? {id: value.id} : {}), name: value.name, description: value.description};
        if (value.quantity !== '' && value.quantity != null) payload.quantity = Number(value.quantity);
        await perform(el, 'entry.save', payload, branch === 'items' ? '物品已儲存' : '能力已儲存', {clear: true}); break;
      }
      case 'me-entry-delete': if (await ctx.confirm('刪除「' + draft.value.name + '」？', '會從目前使用者的個人資料中移除。')) await perform(el, 'entry.delete', {kind: branch, id: el.dataset.id, revision: draft.revision}, '已刪除', {clear: true}); break;
      case 'me-open-shop': ctx.open('storyshop'); break;
      case 'me-wallet-import': await perform(el, 'wallet.import', {revision: revision()}, '舊版物品已匯入'); break;
      case 'me-worldbook-sync': await perform(el, 'worldbook.sync', {revision: revision()}, '專屬世界書已更新'); break;
      case 'me-archive-search': archiveQuery = archiveQueryDraft.trim(); await refresh(); break;
      case 'me-archive-refresh': await refresh(); break;
      case 'me-archive-filter': archiveFilter = ['all', 'forum', 'shop'].includes(el.dataset.filter) ? el.dataset.filter : 'all'; draw(); break;
      case 'me-archive-sync': await performArchive(el, 'worldbook.sync'); break;
      case 'me-archive-export': await performArchive(el, 'worldbook.export'); break;
      case 'me-worldbook-export': {
        const result = await perform(el, 'worldbook.export', {revision: revision()}, '');
        if (v.disposed || !result) return;
        const book = result.book || result, fileName = (result.name || 'TavernPocket_我的世界書').replace(/[\\/:*?"<>|]/g, '_') + '.json';
        await saveFile(ctx.doc, new ctx.win.Blob([JSON.stringify(book, null, 2)], {type: 'application/json'}), fileName); ctx.notify('世界書 JSON 已匯出'); break;
      }
    }
  });
  refresh().catch(e => ctx.notify(e.message, {error: true}));
  return v;
}
