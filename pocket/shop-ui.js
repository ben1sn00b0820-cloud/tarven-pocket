import {esc, btn, field, input, textArea} from '../ui/common.js';
import {saveFile} from '../download.js';

export const SHOP_CATEGORIES = Object.freeze([
  {label: '生活用品', query: '牙刷、衛生紙、礦泉水等生活用品'},
  {label: '人物／NPC', query: '可以加入目前劇情的虛構人物或 NPC'},
  {label: '資格與能力', query: '資格、身分、專業技能與特殊能力'},
  {label: '槍支與武器', query: '劇情中可使用的槍支、武器與裝備'},
  {label: '特殊物件', query: '故事中的違禁物、超常道具與稀有物件'},
]);

/** Root app owns draft state and event handling; no request is sent by this markup. */
export function searchMarkup({query = '', busy = false, source = null, shopPresets = {}} = {}) {
  const disabled = busy ? ' disabled' : '';
  const presets = Array.isArray(shopPresets.presets) ? shopPresets.presets : [];
  const selected = presets.find(p => p.id === shopPresets.selectedId);
  const sourceLabel = source?.mode === 'query' ? `查詢「${source.query || ''}」` : source?.mode === 'manual' ? '手動設定' : '目前劇情';
  const status = source
    ? `<p class="pocket-shop-source" role="status">目前商品來源：<strong>${esc(sourceLabel)}</strong>${source.manualCount ? ` · 保留 ${Number(source.manualCount) || 0} 件手動商品` : ''}${source.repaired ? ' · 格式已修復' : ''}</p>
      ${source.presetName ? `<p class="pocket-shop-preset-source">生成預設：${esc(source.presetName)}</p>` : ''}
      ${(Array.isArray(source.warnings) ? source.warnings : []).map(warning => `<p class="pocket-shop-warning">${esc(warning)}</p>`).join('')}`
    : '';
  return `<section class="pocket-shop-search" aria-label="萬寶閣查詢">
    <label for="pocket-shop-query">想在萬寶閣找到什麼？</label>
    <div class="pocket-shop-query-row">
      <input id="pocket-shop-query" data-field="shop-query" type="search" maxlength="200" value="${esc(query)}" placeholder="例如：牙刷、人物、資格、能力、武器" autocomplete="off" enterkeyhint="search"${disabled}>
      <button type="button" class="primary" data-action="shop-search"${disabled}>${busy ? '生成中…' : '查詢生成'}</button>
    </div>
    <div class="pocket-shop-preset-row"><label for="pocket-shop-preset">生成預設</label><select id="pocket-shop-preset" data-field="shop-preset" aria-label="商城生成預設"${disabled}>${presets.map(p => `<option value="${esc(p.id)}"${p.id === shopPresets.selectedId ? ' selected' : ''}>${esc(p.name)}</option>`).join('') || '<option value="">預設商城設定</option>'}</select><button type="button" class="secondary" data-action="shop-presets"${disabled}>管理預設</button></div>
    ${selected?.description ? `<p class="pocket-shop-preset-detail">${esc(selected.description)}</p>` : ''}
    <div class="pocket-shop-categories" role="group" aria-label="萬寶閣分類">${SHOP_CATEGORIES.map(category => `<button type="button" data-action="shop-category" data-query="${esc(category.query)}"${disabled}>${esc(category.label)}</button>`).join('')}</div>
    <p class="hint">你的專屬萬寶閣，查詢生成虛構商品與價格；確認購買才扣除靈石袋餘額。1 極品 = 1000 中品，1 中品 = 100 下品；新價格以整數下品記帳。模型生成最多追加一次格式修復；手動新增不呼叫模型。</p>
    ${status}
  </section>`;
}

export function shopPresetEditorMarkup(state, draft, note = '') {
  const presets = Array.isArray(state?.presets) ? state.presets : [];
  const p = draft, maxPrompt = Number(state?.limits?.prompt) || 24000;
  return `<p class="hint">為商城查詢設定固定提示詞。使用「玉符接入」選擇的模型；切換預設不會查詢、扣款或購買。</p>
    ${note ? `<p class="pocket-shop-preset-note" role="status">${esc(note)}</p>` : ''}
    <div class="pocket-shop-preset-tools">${btn('shop-preset-new', '新增預設', 'primary')}<label class="secondary file-button">匯入 JSON<input type="file" data-shop-preset-import accept=".json,application/json" aria-label="匯入商城生成預設"></label>${btn('shop-preset-export-all', '匯出全部', 'secondary')}</div>
    <div class="pocket-shop-preset-list" aria-label="商城生成預設清單">${presets.map(value => `<button type="button" class="pocket-shop-preset-card" data-action="shop-preset-pick" data-id="${esc(value.id)}" aria-pressed="${p?.id === value.id}"><span><strong>${esc(value.name)}</strong><small>${value.builtin ? '內建' : '自訂'}${state.selectedId === value.id ? ' · 使用中' : ''}</small></span><span>查看</span></button>`).join('')}</div>
    ${p ? `<section class="pocket-shop-preset-editor"><h3>${p.id ? p.builtin ? '內建預設' : '編輯預設' : '新增預設'}</h3>
      ${field('預設名稱', input('shop-preset-name', p.name, 'text', `maxlength="80"${p.builtin ? ' readonly' : ''}`))}
      ${field('商城生成提示詞', textArea('shop-preset-prompt', p.prompt, `rows="10" maxlength="${maxPrompt}" placeholder="例如：優先列出指定的能力本身，補充作用範圍、持續時間與劇情效果。"${p.builtin ? ' readonly' : ''}`))}
      <p class="hint">${p.builtin ? '內建內容可複製成自訂預設，再依照喜好編輯。' : '這些提示詞會在下一次查詢生成時使用。匯入酒館預設時，只讀取其中的文字提示詞，不改動主聊天的模型或參數。'}商品格式與確認購買流程維持不變。</p>
      <div class="pocket-shop-preset-tools">${p.builtin ? btn('shop-preset-copy', '複製並編輯', 'primary') : btn('shop-preset-save', '儲存預設', 'primary')}${p.id ? btn('shop-preset-use', state.selectedId === p.id ? '目前使用中' : '使用此預設', 'secondary', state.selectedId === p.id ? 'disabled' : '') + btn('shop-preset-export', '匯出此預設', 'secondary') + (!p.builtin ? btn('shop-preset-delete', '刪除', 'danger') : '') : ''}</div>
    </section>` : '<p class="hint">點選一份預設查看內容，或新增自己的生成方式。</p>'}
    <p class="hint">支援本插件的預設 JSON，以及酒館預設中的文字提示詞。匯入會新增，不覆蓋原有預設。自訂提示詞無法保證所有模型都回覆指定內容。</p>`;
}

/** Settings use the same bridge queue as shop requests; no model call is made here. */
export async function openShopPresetSettings(ctx, {onChange = () => {}} = {}) {
  const {api} = ctx, initial = await api.pocketState(), scope = initial.scope;
  let state = initial.shopPresets || {presets:[]}, draft = null, running = false, note = '';
  const d = ctx.dialog('商城生成預設', '');
  d.body.classList.add('pocket-shop-preset-settings');
  const read = key => d.body.querySelector(`[data-field="${key}"]`)?.value ?? '';
  function readDraft() { return {...draft, name:read('shop-preset-name'), prompt:read('shop-preset-prompt')}; }
  function render() {
    if (!d.live) return;
    d.body.innerHTML = shopPresetEditorMarkup(state, draft, note);
    if (running) for (const el of d.body.querySelectorAll('button,input,select,textarea')) el.disabled = true;
  }
  async function valid() {
    if (!d.live) return false;
    if ((await api.pocketState()).scope !== scope) {d.close(); throw Error('對話已切換，請重新開啟商城預設。');}
    return d.live;
  }
  async function perform(fn) {
    if (running) return;
    running = true;
    for (const el of d.body.querySelectorAll('button,input,select,textarea')) el.disabled = true;
    try {
      if (!await valid()) return;
      await fn();
      if (await valid()) state = (await api.pocketState()).shopPresets || state;
      await onChange();
    } catch (error) {note = error.message; ctx.notify(error.message, {error:true});}
    finally {running = false; render();}
  }
  async function download(id) {
    const value = await api.pocketAction('shopPreset.export', id ? {id} : {});
    if (!await valid()) return;
    await saveFile(ctx.doc, new ctx.win.Blob([typeof value.json === 'string' ? value.json : JSON.stringify(value.json, null, 2)], {type:'application/json'}), value.name || 'TavernPocket_ShopPresets.json');
    note = '商城預設已匯出。';
  }
  d.body.addEventListener('input', event => {if (draft && !draft.builtin && event.target.matches('[data-field^="shop-preset-"]')) draft = readDraft();});
  d.body.addEventListener('change', event => {
    const file = event.target.matches('[data-shop-preset-import]') ? event.target.files?.[0] : null;
    if (!file) return;
    perform(async () => {
      if (file.size > (state.limits?.bytes || 1048576)) throw Error('預設檔案過大，請分開匯入。');
      const text = await file.text();
      if (!await valid()) return;
      const result = await api.pocketAction('shopPreset.import', {text});
      draft = null; note = `已匯入 ${result.importedIds?.length ?? '新'} 份商城預設，請確認標示「使用中」的預設。`;
    });
  });
  d.body.addEventListener('click', event => {
    const el = event.target.closest('[data-action]');
    if (!el || running) return;
    event.preventDefault();
    const action = el.dataset.action;
    if (action === 'shop-preset-new') {draft = {name:'新商城預設', prompt:''}; note = ''; render(); return;}
    if (action === 'shop-preset-pick') {draft = structuredClone(state.presets.find(p => p.id === el.dataset.id)); note = ''; render(); return;}
    if (action === 'shop-preset-copy' && draft) {draft = {name:(draft.name + '（自訂）').slice(0, 80), prompt:draft.prompt}; note = ''; render(); return;}
    if (action === 'shop-preset-save' && draft && !draft.builtin) {
      const payload = readDraft();
      perform(async () => {const result = await api.pocketAction('shopPreset.save', payload); draft = result.presets?.find(p => p.id === (result.savedId || result.affectedId || payload.id)) || null; note = '預設已儲存並選用，下一次查詢會使用這份提示詞。';});
    } else if (action === 'shop-preset-use' && draft?.id) perform(async () => {await api.pocketAction('shopPreset.select', {id:draft.id}); note = '已切換商城生成預設。';});
    else if (action === 'shop-preset-export-all') perform(() => download());
    else if (action === 'shop-preset-export' && draft?.id) perform(() => download(draft.id));
    else if (action === 'shop-preset-delete' && draft?.id && !draft.builtin) perform(async () => {await api.pocketAction('shopPreset.delete', {id:draft.id}); draft = null; note = '預設已刪除；已生成商品與已購物品保留。';});
  });
  render(); return d;
}
