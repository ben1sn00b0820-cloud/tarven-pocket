import {esc, btn} from './common.js';
import {STATUS_FIELDS, STATUS_METERS} from '../pocket/status.js';

const CONTACT_FIELDS = [['identity', '身分'], ['age', '年齡'], ['relation', '關係'], ['location', '所在位置'], ['mood', '心情'], ['condition', '身體狀態'], ['outfit', '穿著'], ['action', '當前行動'], ['thought', '內心想法'], ['items', '隨身物品'], ['note', '備註']];
const CONTACT_METERS = [['affection', '好感度'], ['trust', '信任度'], ['energy', '精力'], ['fatigue', '疲勞'], ['stress', '壓力'], ['satiety', '飽食度'], ['hydration', '飲水度'], ['lewdness', '淫蕩值']];
const CONTACT_CARD_FIELDS = [['height', '身高'], ['weight', '體重'], ['build', '身材'], ['appearance', '外貌'], ['hair', '髮型／髮色'], ['eyes', '眼睛'], ['skin', '膚色']];
const profileValue = value => value === null || value === undefined || value === '' ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const profileDatum = (label, value, blank = '未提供') => `<div class="tp-contact-datum${profileValue(value) ? '' : ' is-empty'}"><dt>${esc(label)}</dt><dd>${esc(profileValue(value) || blank)}</dd></div>`;
export function contactDetailsHTML(record) {
  if (!record) return '<section class="tp-contact-section"><h3>劇情狀態</h3><p class="hint">尚未讀到這位角色的狀態列。新的正文狀態與微信事件會自動同步到這裡。</p></section>';
  const fields = record.fields || {}, card = {...record.card, ...fields}, body = Array.isArray(record.body) ? record.body : [];
  const source = record.source || {}, sourceParts = [];
  if (record.time) sourceParts.push(profileValue(record.time));
  if (Number.isInteger(source.messageIndex) && source.messageIndex >= 0) sourceParts.push(`正文第 ${source.messageIndex + 1} 則`);
  if (source.version) sourceParts.push(profileValue(source.version));
  const meter = ([key, label]) => {
    const raw = profileValue(fields[key]), match = /^(\d+(?:\.\d+)?)(?:\s*\/\s*100|\s*%)?$/.exec(raw.trim());
    const number = match && Number(match[1]);
    const valid = !!match && Number.isFinite(number) && number >= 0 && number <= 100;
    return `<div class="tp-contact-meter${raw ? '' : ' is-empty'}"><span>${esc(label)}</span><strong>${esc(raw || '未提供')}</strong>${valid ? `<meter min="0" max="100" value="${number}" aria-label="${esc(label)}">${number}</meter>` : '<span class="tp-contact-meter-empty" aria-hidden="true"></span>'}</div>`;
  };
  const knownCard = CONTACT_CARD_FIELDS.filter(([key]) => profileValue(card[key]));
  const status = CONTACT_FIELDS.map(([key, label]) => profileDatum(label, fields[key])).join('');
  return `<div class="tp-contact-data">
    <section class="tp-contact-section"><div class="tp-contact-section-head"><h3>最新角色狀態</h3><span class="tp-contact-tag">自動讀取</span></div><p class="tp-contact-source">${esc(sourceParts.join(' · ') || '資料來自正文狀態列與角色卡')}</p>
      <div class="tp-contact-meters">${CONTACT_METERS.map(meter).join('')}</div><dl class="tp-contact-grid">${status}</dl></section>
    ${knownCard.length ? `<section class="tp-contact-section"><h3>身材與外貌</h3><dl class="tp-contact-grid">${knownCard.map(([key, label]) => profileDatum(label, card[key])).join('')}</dl></section>` : ''}
    <details class="tp-contact-section tp-contact-body" data-group="tp-contact-body"><summary><span>身材與身體部位</span><small>${body.length ? `${body.length} 個欄位` : '尚無資料'}</small></summary>${body.length ? `<dl class="tp-contact-grid">${body.map(row => profileDatum(profileValue(row.name) || '自訂部位', row.value, '空白')).join('')}</dl>` : '<p class="hint">狀態列的身體部位欄位會保留原名與空白，不自動推測。</p>'}</details>
  </div>`;
}

const LABELS = Object.fromEntries([...CONTACT_FIELDS, ...CONTACT_METERS]);

/** Shared status editor used by WeChat and Roles. Saves a story snapshot. */
export async function openContactStatusEditor(ctx, name, {onSaved = () => {}} = {}) {
  const {api} = ctx;
  const d = ctx.dialog(`${name} · 角色狀態`, '<p class="hint" role="status">正在讀取最新狀態…</p>');
  let record, draft, busy = false;
  const readInputs = () => {
    draft.time = d.body.querySelector('[data-status-time]')?.value || '';
    for (const el of d.body.querySelectorAll('[data-status-field]')) draft.fields[el.dataset.statusField] = el.value;
    draft.body = [...d.body.querySelectorAll('[data-status-part]')].map(row => ({name: row.querySelector('[data-part-name]').value, value: row.querySelector('[data-part-value]').value}));
  };
  const render = () => {
    d.body.innerHTML = `<form class="tp-status-editor" data-status-editor="${esc(name)}">
      <p class="tp-photo-editor-intro">修改會作為新狀態寫入目前正文，所有小程式與後續劇情均可讀取。之後的劇情仍可更新這些狀態。</p>
      <label class="field"><span>劇情時間</span><input data-status-time value="${esc(draft.time)}" maxlength="1000"></label>
      <div class="tp-status-fields">${STATUS_FIELDS.map(key => `<label class="field"><span>${esc(LABELS[key] || key)}</span><input data-status-field="${key}" value="${esc(draft.fields[key])}" ${STATUS_METERS.includes(key) ? 'inputmode="text" placeholder="0–100 或 未知" maxlength="3"' : 'maxlength="16000"'}></label>`).join('')}</div>
      <p class="hint">數值欄位可填 0–100 或「未知」；0 與未知會分開保存。文字使用單行，不能包含 [ 或 ]。</p>
      <div class="tp-contact-section-head"><h3>身體部位</h3>${btn('status-add-part', '新增部位', 'secondary')}</div>
      <div class="tp-status-parts">${draft.body.map((part, i) => `<div class="tp-status-part" data-status-part="${i}"><label class="field"><span>部位名稱</span><input data-part-name value="${esc(part.name)}" maxlength="100" aria-label="第 ${i + 1} 列部位名稱"></label><label class="field"><span>當前內容</span><input data-part-value value="${esc(part.value)}" maxlength="16000" placeholder="可保留空白" aria-label="第 ${i + 1} 列部位內容"></label>${btn('status-delete-part', '刪除', 'danger', `data-part-index="${i}" aria-label="刪除第 ${i + 1} 列部位"`)}</div>`).join('')}</div>
      <p class="tp-photo-editor-error" data-status-error role="alert" hidden></p>
      <div class="tp-photo-editor-actions">${btn('status-save', '儲存並同步正文', 'primary')}</div>
    </form>`;
  };
  try {
    record = await api.pocketContactProfile(name);
    if (!d.live) return d;
    if (!record) throw Error('目前對話找不到這位角色的資料。');
    draft = {revision: record.revision, time: record.time || '', fields: Object.fromEntries(STATUS_FIELDS.map(key => [key, String(record.fields?.[key] ?? (STATUS_METERS.includes(key) ? '未知' : ''))])), body: structuredClone(record.body || [])};
    render();
  } catch (error) { if (d.live) d.body.innerHTML = `<p class="help-copy" role="alert">${esc(error.message || error)}</p>`; return d; }
  d.body.addEventListener('submit', e => e.preventDefault());
  d.body.addEventListener('click', async e => {
    const button = e.target.closest('[data-action]');
    if (!button || busy || !d.live) return;
    e.preventDefault();
    readInputs();
    if (button.dataset.action === 'status-add-part') {
      if (draft.body.length >= 200) { ctx.notify('身體部位最多 200 列'); return; }
      draft.body.push({name: `自訂部位 ${String(draft.body.length + 1).padStart(2, '0')}`, value: ''}); render();
      d.body.querySelector('[data-status-part]:last-child input')?.focus(); return;
    }
    if (button.dataset.action === 'status-delete-part') { draft.body.splice(Number(button.dataset.partIndex), 1); render(); return; }
    if (button.dataset.action !== 'status-save') return;
    busy = true;
    const errorBox = d.body.querySelector('[data-status-error]'); errorBox.hidden = true;
    for (const el of d.body.querySelectorAll('input, button')) el.disabled = true;
    try {
      await api.pocketSaveContactProfile(name, draft);
      if (d.live) d.close();
      ctx.notify('角色狀態已儲存並同步正文'); onSaved();
    } catch (error) {
      if (d.live) { errorBox.textContent = error.message || String(error); errorBox.hidden = false; }
    } finally { busy = false; if (d.live) for (const el of d.body.querySelectorAll('input, button')) el.disabled = false; }
  });
  return d;
}

export async function openContactStatus(ctx, name) {
  const d = ctx.dialog(`${name} · 角色狀態`, '<p class="hint" role="status">正在讀取角色狀態…</p>');
  try {
    const record = await ctx.api.pocketContactProfile(name);
    if (!d.live) return d;
    d.body.innerHTML = contactDetailsHTML(record) + (record && ctx.api.pocketSaveContactProfile ? `<div class="actions">${btn('status-edit', '修改角色狀態', 'primary')}</div>` : '');
    d.body.addEventListener('click', e => { if (e.target.closest('[data-action=status-edit]')) openContactStatusEditor(ctx, name); });
  } catch (error) { if (d.live) d.body.innerHTML = `<p class="help-copy" role="alert">${esc(error.message || error)}</p>`; }
  return d;
}

export async function openStatusDirectory(ctx) {
  const d = ctx.dialog('劇情角色狀態', '<p class="hint" role="status">正在讀取目前對話的角色…</p>');
  try {
    const records = await ctx.api.pocketContactProfiles();
    if (!d.live) return d;
    d.body.innerHTML = records.length ? `<div class="group">${records.map(record => btn('status-open', `<span><strong>${esc(record.name)}</strong><small>${esc(record.fields?.mood || record.fields?.identity || '檢視或修改狀態')}</small></span>`, 'list-row', `data-status-name="${esc(record.name)}"`)).join('')}</div>` : '<p class="hint">目前對話尚無角色資料。角色卡、正文狀態欄及微信聯絡人會同步到這裡。</p>';
    d.body.addEventListener('click', e => { const b = e.target.closest('[data-status-name]'); if (b) openContactStatus(ctx, b.dataset.statusName); });
  } catch (error) { if (d.live) d.body.innerHTML = `<p class="help-copy" role="alert">${esc(error.message || error)}</p>`; }
  return d;
}
