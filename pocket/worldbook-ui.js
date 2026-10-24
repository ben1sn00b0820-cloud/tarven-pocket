import {esc} from '../ui/common.js';

const list = value => Array.isArray(value) ? value : [];
const num = value => Math.max(0, Number(value) || 0);
const count = value => num(value).toLocaleString('zh-TW');
const same = (a, b) => a?.book === b?.book && String(a?.entryId) === String(b?.entryId);

/** Pins refer to an entry, never a copied snapshot of its contents. */
export function toggleWorldbookPin(pins, entry) {
  if (typeof entry?.book !== 'string' || typeof entry?.entryId !== 'string') throw Error('世界書條目識別無效。');
  const next = list(pins).map(pin => ({book:pin.book, entryId:String(pin.entryId)}));
  return next.some(pin => same(pin, entry)) ? next.filter(pin => !same(pin, entry)) : [...next, {book:entry.book, entryId:entry.entryId}];
}

export function worldbookResultsMarkup(result, {pins = [], busy = false} = {}) {
  if (!result) return '<p class="hint" role="status">正在建立世界書索引…大型世界書首次讀取需要一些時間。</p>';
  const entries = list(result.entries), total = num(result.total), offset = num(result.offset), limit = num(result.limit) || 30;
  const disabled = busy ? ' disabled' : '';
  return `<div class="pocket-lore-counts" role="status"><strong>${count(result.enabledEntries)} 個啟用條目</strong><span>${count(result.totalChars)} 字元 · ${list(result.books).length} 本世界書</span></div>
    <p class="hint">找到 ${count(total)} 筆${total ? `，顯示 ${count(offset + 1)}–${count(Math.min(total, offset + entries.length))}` : ''}。固定條目會在生成時優先選取；仍受你設定的單次背景預算限制。</p>
    <div class="pocket-lore-results">${entries.map((entry, index) => `<article class="pocket-lore-result"><button type="button" class="pocket-lore-open" data-lore-action="read" data-index="${index}"${disabled}><small>${esc(entry.book)} · ${count(entry.chars)} 字元${entry.constant ? ' · 常駐' : ''}</small><strong>${esc(entry.title || '無標題條目')}</strong><span>${esc(entry.preview || '（沒有預覽）')}</span><em>閱讀完整內容 →</em></button><button type="button" class="secondary pocket-lore-pin" data-lore-action="pin" data-index="${index}" aria-pressed="${pins.some(pin => same(pin, entry))}"${disabled}>${pins.some(pin => same(pin, entry)) ? '已固定 · 取消' : '優先讀取'}</button></article>`).join('') || '<p class="hint">沒有符合的啟用條目。試試條目名稱、關鍵字或內容中的詞句。</p>'}</div>
    <div class="pocket-lore-pager"><button type="button" class="secondary" data-lore-action="previous" ${offset === 0 || busy ? 'disabled' : ''}>上一頁</button><span>${total ? Math.floor(offset / limit) + 1 : 0} / ${Math.ceil(total / limit)}</span><button type="button" class="secondary" data-lore-action="next" ${result.nextOffset == null || busy ? 'disabled' : ''}>下一頁</button></div>`;
}

export function worldbookReadingMarkup(entry, {pins = [], busy = false} = {}) {
  const offset = num(entry.offset), total = num(entry.totalChars), length = String(entry.content || '').length;
  const pinned = pins.some(pin => same(pin, entry));
  return `<div class="pocket-lore-reading"><small>${esc(entry.book)}</small><h3>${esc(entry.title || '無標題條目')}</h3><p class="hint">第 ${count(offset + (length ? 1 : 0))}–${count(offset + length)} 字元／共 ${count(total)} 字元。長條目分頁顯示，內容沒有因長度被刪除。</p><div class="pocket-lore-reading-tools"><button type="button" class="secondary" data-lore-action="back" ${busy ? 'disabled' : ''}>返回結果</button><button type="button" class="${pinned ? 'secondary' : 'primary'}" data-lore-action="pin-reading" aria-pressed="${pinned}" ${busy ? 'disabled' : ''}>${pinned ? '已固定 · 取消' : '優先讀取此條目'}</button></div><div class="pocket-lore-content" tabindex="0">${esc(entry.content || '')}</div><div class="pocket-lore-pager"><button type="button" class="secondary" data-lore-action="read-previous" ${offset === 0 || busy ? 'disabled' : ''}>上一段</button><span>${count(total)} 字元</span><button type="button" class="secondary" data-lore-action="read-next" ${entry.nextOffset == null || busy ? 'disabled' : ''}>下一段</button></div></div>`;
}

/** Browsing uses bounded pages and never calls a text or image model. */
export async function openWorldbookBrowser(ctx, {names = [], getPins = () => [], onPinsChange = () => {}} = {}) {
  if (!names.length) throw Error('先勾選至少一本世界書，再開啟內容搜尋。');
  const selected = [...names], scope = (await ctx.api.pocketState()).scope;
  const dialog = ctx.dialog('世界書內容搜尋', '');
  dialog.body.classList.add('pocket-worldbook-browser');
  let query = '', result = null, reading = null, busy = false, note = '', epoch = 0;
  const pageSize = 30, readSize = 12000;
  function render() {
    if (!dialog.live) return;
    dialog.body.innerHTML = `<p class="hint">搜尋目前勾選的 ${selected.length} 本世界書。只讀取啟用條目，不會呼叫模型。內容可跨頁閱讀；勾選與固定項目請回到玉符接入頁儲存。</p>${note ? `<p class="pocket-lore-error" role="alert">${esc(note)}</p>` : ''}${reading ? worldbookReadingMarkup(reading, {pins:getPins(), busy}) : `<form class="pocket-lore-search" data-lore-form><label for="pocket-lore-query">搜尋標題、關鍵字與內容</label><div><input type="search" id="pocket-lore-query" data-lore-query value="${esc(query)}" maxlength="1000" placeholder="例如：時間停止、人物姓名、城鎮" autocomplete="off" enterkeyhint="search"><button type="submit" class="primary" ${busy ? 'disabled' : ''}>${busy ? '讀取中…' : '搜尋'}</button></div><button type="button" class="secondary" data-lore-action="refresh" ${busy ? 'disabled' : ''}>重新讀取世界書</button></form>${worldbookResultsMarkup(result, {pins:getPins(), busy})}`}`;
    dialog.body.setAttribute('aria-busy', String(busy));
  }
  async function valid() {
    if (!dialog.live) return false;
    if ((await ctx.api.pocketState()).scope !== scope) {dialog.close(); throw Error('對話已切換，請重新開啟世界書搜尋。');}
    return dialog.live;
  }
  async function perform(action) {
    if (busy) return;
    const ticket = ++epoch;
    try {
      if (!await valid() || ticket !== epoch) return;
      busy = true; note = ''; render();
      const apply = await action();
      if (!await valid() || ticket !== epoch) return;
      apply?.();
    } catch (error) {if (dialog.live) {note = error.message; ctx.notify(error.message, {error:true});}}
    finally {if (ticket === epoch) {busy = false; render();}}
  }
  const search = (offset = 0, refresh = false) => perform(async () => {
    const next = await ctx.api.pocketAction('worldbooks.search', {names:selected, query, offset, limit:pageSize, refresh});
    return () => {result = next; reading = null;};
  });
  const read = (entry, offset = 0) => perform(async () => {
    const next = await ctx.api.pocketAction('worldbooks.read', {names:selected, book:entry.book, entryId:entry.entryId, offset, limit:readSize});
    return () => {reading = next;};
  });
  async function pin(entry) {
    if (!await valid() || busy) return;
    onPinsChange(toggleWorldbookPin(getPins(), entry));
    note = ''; render();
  }
  dialog.onClose(() => {epoch++;});
  dialog.body.addEventListener('input', event => {if (event.target.matches('[data-lore-query]')) query = event.target.value;});
  dialog.body.addEventListener('submit', event => {if (!event.target.matches('[data-lore-form]')) return; event.preventDefault(); search();});
  dialog.body.addEventListener('click', event => {
    const button = event.target.closest('[data-lore-action]');
    if (!button || busy) return;
    event.preventDefault();
    const entry = list(result?.entries)[Number(button.dataset.index)];
    const actions = {
      refresh: () => search(0, true), previous: () => search(Math.max(0, num(result?.offset) - pageSize)),
      next: () => result?.nextOffset != null && search(result.nextOffset), read: () => entry && read(entry),
      pin: () => entry && pin(entry), 'pin-reading': () => reading && pin(reading),
      back: async () => {if (await valid()) {reading = null; render();}},
      'read-previous': () => reading && read(reading, Math.max(0, num(reading.offset) - readSize)),
      'read-next': () => reading?.nextOffset != null && read(reading, reading.nextOffset),
    };
    Promise.resolve(actions[button.dataset.loreAction]?.()).catch(error => ctx.notify(error.message, {error:true}));
  });
  await search();
  return dialog;
}
