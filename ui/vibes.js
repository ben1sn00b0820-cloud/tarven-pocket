// The Vibe tab of the drawing app: one switch for every picture, the groups (tap one to use it), the single vibes,
// import (.naiv4vibe, .naiv4vibebundle, 智绘姬 exports, pictures) and export. The vibes themselves stay in the backend.
import {esc, btn, field, input, toggle, help, groupTitle} from './common.js';
import {icon} from './icons.js';
import {saveFile} from '../download.js';

const MAX_FREE = 4;
const tileImage = s => s.thumb ? `<img src="${esc(s.thumb)}" alt="">` : `<span class="vibe-blank">${icon('image')}</span>`;
const encodedNote = s => s.keys.length ? '已編碼' : s.image ? '第一次用要編碼' : '沒有原圖';
/** A search box appears once the lists are this long. */
const SEARCH_FROM = 8;
const matches = (name, query) => !query || String(name).toLowerCase().includes(query.trim().toLowerCase());
/** Hides the rows of a list ([data-name]) that do not match, and says so when none is left. */
function filterList(box, query) {
  if (!box) return;
  let shown = 0;
  for (const el of box.querySelectorAll('[data-name]')) { const hit = matches(el.dataset.name, query); el.hidden = !hit; shown += hit; }
  const none = box.parentElement.querySelector(`[data-none="${box.dataset.list}"]`);
  if (none) none.hidden = shown > 0;
}

export function vibePanel({ctx, api, root, rerender}) {
  const state = () => api.getState().draw.vibe;
  const vibes = () => api.listVibes();
  let query = '', selecting = false;
  /** Multi-select: the vibes and groups picked. */
  const picked = {vibes: new Set(), groups: new Set()};

  /** One line saying what the next picture will use and what it costs. */
  function planText() {
    const v = state(), plan = api.vibePlan();
    if (!v.enabled) return 'Vibe 已關閉。開啟後，不管用哪個畫風，每張圖都會帶上選中的 Vibe。';
    if (!v.use.kind) return '還沒有選：點一個 Vibe 組，或者開啟單個 Vibe 點「單獨使用」。';
    const model = api.getState().draw.params.model;
    if (!plan.model) return `當前模型 ${model} 不能用 Vibe（V5 還不支援），出圖時會跳過。換成 V4.5 才會生效。`;
    const group = v.use.kind === 'group' ? v.groups.find(g => g.id === v.use.id) : null;
    const parts = [`正在用：${group ? `組「${esc(group.name)}」` : `「${esc(plan.used[0]?.name || plan.skipped[0]?.name || '')}」`} · ${plan.used.length} 個`];
    if (plan.over) parts.push(`免費檔守衛只用前 ${MAX_FREE} 個，後面 ${plan.over} 個這次不用`);
    if (plan.extra) parts.push(`超過 ${MAX_FREE} 個，每張圖多扣 ${plan.extra * 2} Anlas`);
    if (plan.encode) parts.push(`其中 ${plan.encode} 個第一次用要編碼，每個扣 2 Anlas，編碼一次以後就不扣了`);
    const lost = plan.skipped.filter(s => s.why !== 'model');
    if (lost.length) parts.push(`${lost.map(s => esc(s.name)).join('、')} 沒有這個模型的編碼也沒有原圖，跳過`);
    return parts.join('；') + '。';
  }

  function html() {
    const v = state(), list = vibes(), byId = new Map(list.map(s => [s.id, s]));
    const check = on => selecting ? `<span class="vibe-check${on ? ' on' : ''}">${on ? icon('check') : ''}</span>` : '';
    const groupRows = v.groups.map(g => {
      const using = v.use.kind === 'group' && v.use.id === g.id, thumbs = g.items.slice(0, 3).map(i => byId.get(i.vibe)).filter(Boolean), on = picked.groups.has(g.id);
      return `<div class="vibe-group${using ? ' using' : ''}${on ? ' picked' : ''}" data-name="${esc(g.name)}"${matches(g.name, query) ? '' : ' hidden'}><button type="button" class="vibe-group-main" data-action="${selecting ? 'vibe-pick' : 'vibe-use-group'}" data-kind="groups" data-id="${esc(g.id)}" aria-pressed="${selecting ? on : using}">
        ${check(on)}<span class="vibe-stack">${thumbs.map(tileImage).join('') || `<span class="vibe-blank">${icon('layers')}</span>`}</span>
        <span class="grow"><strong>${esc(g.name)}</strong><small>${using ? '使用中 · ' : ''}${g.items.length} 個${g.items.length > MAX_FREE ? ` · 守衛只用前 ${MAX_FREE} 個` : ''}</small></span></button>
        ${selecting ? '' : `<button type="button" class="nav-button" data-action="vibe-group-menu" data-id="${esc(g.id)}" aria-label="編輯「${esc(g.name)}」">${icon('more')}</button>`}</div>`;
    }).join('');
    const tiles = list.map(s => {
      const using = v.use.kind === 'vibe' && v.use.id === s.id, on = picked.vibes.has(s.id);
      return `<button type="button" class="vibe-tile${using ? ' using' : ''}${on ? ' picked' : ''}" data-name="${esc(s.name)}"${matches(s.name, query) ? '' : ' hidden'} data-action="${selecting ? 'vibe-pick' : 'vibe-open'}" data-kind="vibes" data-id="${esc(s.id)}" aria-label="${esc(s.name)}"${selecting ? ` aria-pressed="${on}"` : ''}>${check(on)}${tileImage(s)}<span class="vibe-name">${esc(s.name)}</span><small>${using ? '使用中' : encodedNote(s)}</small></button>`;
    }).join('');
    // Select all / none, for the names the search shows.
    const pickAll = (kind, items) => {
      if (!selecting || !items.length) return '';
      const shown = items.filter(x => matches(x.name, query)), all = shown.length && shown.every(x => picked[kind].has(x.id));
      return btn('vibe-pick-all', all ? '全不選' : query ? '全選搜到的' : '全選', 'text-button', `data-kind="${kind}"`);
    };
    const count = picked.vibes.size + picked.groups.size;
    const buttons = selecting
      ? `<div class="vibe-selectbar"><strong>已選 ${picked.vibes.size} 個 Vibe${picked.groups.size ? `、${picked.groups.size} 個組` : ''}</strong>${btn('vibe-pick-done', '完成', 'chip-button')}</div>
        <div class="actions" style="margin-top:0">${btn('vibe-pick-group', icon('add') + '加入組', 'secondary', picked.vibes.size ? '' : 'disabled')}${btn('vibe-pick-delete', icon('trash') + '刪除', 'danger', count ? '' : 'disabled')}</div>`
      // The buttons fold away (ui/common.js keeps the fold open across redraws); with nothing saved yet they are open.
      : `<details class="tool-fold" data-group="vibe-tools"${list.length + v.groups.length ? '' : ' open'}><summary>${icon('layers')}匯入與管理<small>匯入 · 新建組 · 多選 · 匯出</small></summary><div><div class="actions" style="margin-top:0">${btn('vibe-import', icon('import') + '匯入', 'secondary')}${btn('vibe-new-group', icon('add') + '新建組', 'secondary')}${list.length + v.groups.length ? btn('vibe-select', icon('check') + '多選', 'secondary') : ''}${list.length ? btn('vibe-export-all', icon('download') + '全部匯出', 'secondary') : ''}${api.chatu8Vibes?.() ? btn('vibe-chatu8', icon('import') + '從智繪姬匯入', 'secondary') : ''}</div></div></details>`;
    const tools = (kind, items, info) => `<span class="title-tools">${pickAll(kind, items)}${help(info)}</span>`;
    return `<div class="group">${toggle('vibeEnabled', '使用 Vibe', v.enabled, '開啟後，不管用哪個畫風或畫師串，繪圖 App 和正文出圖的每張圖都會帶上選中的 Vibe（一個組，或者單個 Vibe）。\n\n只有 V4 / V4.5 模型能用，V5 還不支援，會自動跳過。\n\n費用：一張圖片第一次用要編碼，扣 2 Anlas，編碼存下來以後再用就不扣了；一次最多 4 個不額外收費，第 5 個起每多一個扣 2 Anlas。免費檔守衛開啟時只用前 4 個。')}</div>
      <p class="hint vibe-plan">${planText()}</p>
      ${buttons}
      <input type="file" data-vibe-file multiple hidden accept=".naiv4vibe,.naiv4vibebundle,.json,image/png,image/jpeg,image/webp">
      ${list.length + v.groups.length > SEARCH_FROM ? `<div class="vibe-search">${icon('search')}<input type="search" data-vibe-search value="${esc(query)}" placeholder="搜尋組和 Vibe 的名字" aria-label="搜尋 Vibe"></div>` : ''}
      ${groupTitle(`Vibe 組 · ${v.groups.length}`, tools('groups', v.groups, '點一個組就用這個組。組裡每個 Vibe 有自己的強度；強度加起來超過 1 時會按比例縮回 1。\n\n匯入官網的 .naiv4vibebundle 或智繪姬匯出的 Vibe 組，會自動建好組。\n\n「多選」可以一次刪除好幾個組。'))}
      ${v.groups.length ? `<div class="vibe-groups vibe-scroll" data-list="groups" data-keep-scroll="vibe-groups">${groupRows}</div><p class="hint" data-none="groups"${v.groups.some(g => matches(g.name, query)) ? ' hidden' : ''}>沒有名字裡帶「${esc(query)}」的組。</p>` : '<p class="hint">還沒有組。匯入組檔案，或者點「新建組」。</p>'}
      ${groupTitle(`單個 Vibe · ${list.length}`, tools('vibes', list, '可以匯入：官網的 .naiv4vibe（單個）、.naiv4vibebundle（一組）、智繪姬「匯出全部」的 Vibe 組檔案，以及普通圖片（第一次用時編碼）。已經有的 Vibe 不會重複新增。再點一次「從智繪姬匯入」，已經有的 Vibe 會改成智繪姬裡的名字。\n\n「多選」可以一次刪除好幾個，或者一起加進一個組。\n\nVibe 儲存在當前瀏覽器裡；換裝置用 設定 → 備份與恢復（勾「Vibe 和 Vibe 組」），或者先匯出再匯入。'))}
      ${list.length ? `<div class="vibe-grid vibe-scroll" data-list="vibes" data-keep-scroll="vibe-grid">${tiles}</div><p class="hint" data-none="vibes"${list.some(s => matches(s.name, query)) ? ' hidden' : ''}>沒有名字裡帶「${esc(query)}」的 Vibe。</p>` : '<p class="hint">還沒有 Vibe。點「匯入」。</p>'}`;
  }

  /** Several vibes into one group (a new one, or one that is there), each with its own strength. */
  function pickToGroup() {
    const groups = state().groups, ids = [...picked.vibes];
    const d = ctx.dialog(`加入組 · ${ids.length} 個 Vibe`, `<div class="group pad">${field('加到', `<span class="select"><select data-field="pick-group" aria-label="加到">${groups.map(g => `<option value="${esc(g.id)}">${esc(g.name)}（${g.items.length} 個）</option>`).join('')}<option value="">新建一個組</option></select></span>`)}
      ${field('新組的名字', input('pick-name', '新組 ' + (groups.length + 1), 'text', 'maxlength="40"'))}
      <p class="hint" style="padding:0">已經在組裡的不會重複加；一個組最多 50 個。每個 Vibe 用它自己的強度，加進去以後可以在組裡調。</p></div>
      <div class="actions">${btn('pick-group-ok', '加入', 'primary')}</div>`);
    const nameField = () => d.body.querySelector('[data-field=pick-name]').closest('.field');
    const sync = () => { nameField().style.display = d.body.querySelector('[data-field=pick-group]').value ? 'none' : ''; };
    sync();
    d.body.addEventListener('change', sync);
    d.body.addEventListener('click', e => {
      if (!e.target.closest('[data-action=pick-group-ok]')) return;
      try {
        const all = structuredClone(state().groups), gid = d.body.querySelector('[data-field=pick-group]').value;
        let g = all.find(x => x.id === gid);
        if (!g) { g = {id: crypto.randomUUID(), name: d.body.querySelector('[data-field=pick-name]').value.trim() || '新組 ' + (all.length + 1), items: []}; all.push(g); }
        const strengthOf = new Map(vibes().map(s => [s.id, s.strength]));
        let added = 0;
        for (const id of ids) { if (g.items.length >= 50) break; if (g.items.some(i => i.vibe === id)) continue; g.items.push({vibe: id, strength: strengthOf.get(id) ?? 0.6}); added++; }
        api.saveDraw({vibe: {groups: all}});
        d.close(); selecting = false; picked.vibes.clear(); picked.groups.clear(); rerender();
        ctx.notify(`已把 ${added} 個 Vibe 加進「${g.name}」${added < ids.length ? `（${ids.length - added} 個已經在裡面或者超過 50 個）` : ''}`);
      } catch (error) { ctx.notify(error.message, {error: true}); }
    });
  }

  async function save(file) { ctx.notify('已下載 ' + await saveFile(ctx.doc, file.blob, file.name)); }

  /** A vibe: rename, its own strength, use it alone, add it to a group, export, delete. */
  function openVibe(id) {
    const s = vibes().find(x => x.id === id);
    if (!s) return;
    const groups = state().groups;
    const d = ctx.dialog(s.name, `<div class="vibe-detail">${tileImage(s)}</div>
      <div class="group pad">${field('名字', input('vibe-name', s.name, 'text', 'maxlength="80"'))}
        <div class="field"><div class="meter-label"><span>強度${help('單獨使用時的強度，也是加進組時的預設強度。越高越像這張圖。')}</span><output>${s.strength}</output></div><input class="slider" type="range" data-field="vibe-strength" min="0" max="1" step="0.05" value="${s.strength}" aria-label="強度"></div>
        <p class="hint" style="padding:0">${s.keys.length ? '已編碼：' + s.keys.join('、') + '（用這些模型不再扣 Anlas）' : s.image ? '還沒有編碼：第一次用時編碼，扣 2 Anlas' : '沒有原圖，也沒有編碼，用不了'} · 提取資訊量 ${s.ie}</p></div>
      ${groups.length ? `<div class="group pad">${field('加入組', `<span class="select"><select data-field="vibe-group" aria-label="加入組">${groups.map(g => `<option value="${esc(g.id)}">${esc(g.name)}${g.items.some(i => i.vibe === id) ? '（已在）' : ''}</option>`).join('')}</select></span>`)}<div class="actions" style="margin-top:0">${btn('vibe-to-group', icon('add') + '加入', 'secondary')}</div></div>` : ''}
      <div class="actions">${btn('vibe-save', '儲存', 'primary')}${btn('vibe-alone', '單獨使用', 'secondary')}${btn('vibe-export', icon('download') + '匯出', 'secondary')}${btn('vibe-delete', icon('trash') + '刪除', 'danger')}</div>`);
    d.body.addEventListener('input', e => { if (e.target.dataset.field === 'vibe-strength') e.target.previousElementSibling.querySelector('output').textContent = e.target.value; });
    d.body.addEventListener('click', async e => {
      const b = e.target.closest('[data-action]');
      if (!b) return;
      try {
        if (b.dataset.action === 'vibe-save') { await api.updateVibe(id, {name: d.body.querySelector('[data-field=vibe-name]').value, strength: Number(d.body.querySelector('[data-field=vibe-strength]').value)}); d.close(); rerender(); ctx.notify('已儲存'); }
        if (b.dataset.action === 'vibe-alone') { api.saveDraw({vibe: {enabled: true, use: {kind: 'vibe', id}}}); d.close(); rerender(); ctx.notify(`正在用「${s.name}」`); }
        if (b.dataset.action === 'vibe-export') await save(await api.exportVibes({vibe: id}));
        if (b.dataset.action === 'vibe-to-group') {
          const gid = d.body.querySelector('[data-field=vibe-group]').value, all = structuredClone(state().groups), g = all.find(x => x.id === gid);
          if (!g) return;
          if (g.items.some(i => i.vibe === id)) { ctx.notify('已經在這個組裡了'); return; }
          g.items.push({vibe: id, strength: Number(d.body.querySelector('[data-field=vibe-strength]').value)});
          api.saveDraw({vibe: {groups: all}}); d.close(); rerender(); ctx.notify(`已加入「${g.name}」`);
        }
        if (b.dataset.action === 'vibe-delete') {
          d.close();
          if (await ctx.confirm('刪除這個 Vibe？', `「${s.name}」會從這臺裝置刪除，也會從所有組裡去掉。想留著可以先匯出。`)) { await api.deleteVibe(id); rerender(); }
        }
      } catch (error) { ctx.notify(error.message, {error: true}); }
    });
  }

  /** A group: rename, each vibe's strength, take vibes out or add more, use it, export, delete. */
  function openGroup(gid) {
    const draft = structuredClone(state().groups.find(g => g.id === gid));
    if (!draft) return;
    const d = ctx.dialog('Vibe 組', '');
    let find = '';
    const paint = () => {
      const keep = d.body.querySelector('[data-list=add]')?.scrollTop || 0;
      const list = vibes(), byId = new Map(list.map(s => [s.id, s])), outside = list.filter(s => !draft.items.some(i => i.vibe === s.id));
      d.body.innerHTML = `<div class="group pad">${field('組名', input('group-name', draft.name, 'text', 'maxlength="40"'))}</div>
        ${groupTitle(`組裡的 Vibe · ${draft.items.length}`, help('第 5 個起每多一個扣 2 Anlas；免費檔守衛開啟時只用前 4 個。'))}
        <div class="group pad">${draft.items.map((item, n) => { const s = byId.get(item.vibe); return `<div class="vibe-item${n >= MAX_FREE ? ' beyond' : ''}">${s ? tileImage(s) : `<span class="vibe-blank">${icon('alert')}</span>`}
          <div class="grow"><div class="meter-label"><span>${esc(s?.name || '已刪除')}</span><output>${item.strength}</output></div><input class="slider" type="range" data-item-strength="${n}" min="0" max="1" step="0.05" value="${item.strength}" aria-label="${esc(s?.name || '')} 強度"></div>
          <button type="button" class="text-button" data-item-remove="${n}">移出</button></div>`; }).join('') || '<p class="hint">組裡還沒有 Vibe，從下面加。</p>'}</div>
        ${outside.length ? groupTitle(`加進來 · ${outside.length}`) + (outside.length > SEARCH_FROM ? `<div class="vibe-search">${icon('search')}<input type="search" data-add-search value="${esc(find)}" placeholder="搜尋名字" aria-label="搜尋要加的 Vibe"></div>` : '')
          + `<div class="vibe-grid small vibe-scroll" data-list="add">${outside.map(s => `<button type="button" class="vibe-tile" data-name="${esc(s.name)}"${matches(s.name, find) ? '' : ' hidden'} data-item-add="${esc(s.id)}" aria-label="加入 ${esc(s.name)}">${tileImage(s)}<span class="vibe-name">${esc(s.name)}</span></button>`).join('')}</div><p class="hint" data-none="add"${outside.some(s => matches(s.name, find)) ? ' hidden' : ''}>沒有名字裡帶「${esc(find)}」的 Vibe。</p>` : ''}
        <div class="actions">${btn('group-save', '儲存', 'primary')}${btn('group-use', '使用這個組', 'secondary')}${btn('group-export', icon('download') + '匯出', 'secondary')}${btn('group-delete', icon('trash') + '刪除組', 'danger')}</div>`;
      const add = d.body.querySelector('[data-list=add]');
      if (add) add.scrollTop = keep;
    };
    paint();
    const commit = () => { const all = structuredClone(state().groups), at = all.findIndex(g => g.id === gid); if (at < 0) throw Error('這個組已經不在了'); draft.name = d.body.querySelector('[data-field=group-name]').value.trim() || draft.name; all[at] = draft; api.saveDraw({vibe: {groups: all}}); };
    d.body.addEventListener('input', e => {
      if (e.target.dataset.addSearch !== undefined) { find = e.target.value; filterList(d.body.querySelector('[data-list=add]'), find); return; }
      if (e.target.dataset.itemStrength !== undefined) { draft.items[Number(e.target.dataset.itemStrength)].strength = Number(e.target.value); e.target.previousElementSibling.querySelector('output').textContent = e.target.value; }
      if (e.target.dataset.field === 'group-name') draft.name = e.target.value;
    });
    d.body.addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b) return;
      try {
        if (b.dataset.itemRemove !== undefined) { draft.items.splice(Number(b.dataset.itemRemove), 1); paint(); return; }
        if (b.dataset.itemAdd) { const s = vibes().find(x => x.id === b.dataset.itemAdd); draft.items.push({vibe: b.dataset.itemAdd, strength: s?.strength ?? 0.6}); paint(); return; }
        switch (b.dataset.action) {
          case 'group-save': commit(); d.close(); rerender(); ctx.notify('組已儲存'); break;
          case 'group-use': commit(); api.saveDraw({vibe: {enabled: true, use: {kind: 'group', id: gid}}}); d.close(); rerender(); ctx.notify(`正在用「${draft.name}」`); break;
          case 'group-export': commit(); await save(await api.exportVibes({group: gid})); break;
          case 'group-delete':
            d.close();
            if (await ctx.confirm('刪除這個組？', `組「${draft.name}」會被刪除，裡面的 Vibe 還在。`)) {
              const v = state();
              api.saveDraw({vibe: {groups: v.groups.filter(g => g.id !== gid), use: v.use.kind === 'group' && v.use.id === gid ? {kind: '', id: ''} : v.use}});
              rerender();
            }
            break;
        }
      } catch (error) { ctx.notify(error.message, {error: true}); }
    });
  }

  /** The tab's buttons; returns true when the action was a Vibe one. */
  async function click(el) {
    switch (el.dataset.action) {
      case 'vibe-import': root().querySelector('[data-vibe-file]')?.click(); return true;
      case 'vibe-use-group': {
        const v = state(), same = v.use.kind === 'group' && v.use.id === el.dataset.id;
        api.saveDraw({vibe: same ? {use: {kind: '', id: ''}} : {enabled: true, use: {kind: 'group', id: el.dataset.id}}});
        rerender();
        return true;
      }
      case 'vibe-group-menu': openGroup(el.dataset.id); return true;
      case 'vibe-open': openVibe(el.dataset.id); return true;
      case 'vibe-new-group': {
        const v = state(), id = crypto.randomUUID();
        api.saveDraw({vibe: {groups: [...v.groups, {id, name: '新組 ' + (v.groups.length + 1), items: []}]}});
        rerender(); openGroup(id);
        return true;
      }
      case 'vibe-export-all': await save(await api.exportVibes({all: true})); return true;
      case 'vibe-chatu8': report(await api.importChatu8()); return true;
      case 'vibe-select': selecting = true; picked.vibes.clear(); picked.groups.clear(); rerender(); return true;
      case 'vibe-pick-done': selecting = false; picked.vibes.clear(); picked.groups.clear(); rerender(); return true;
      case 'vibe-pick': { const set = picked[el.dataset.kind]; if (set) { if (set.has(el.dataset.id)) set.delete(el.dataset.id); else set.add(el.dataset.id); rerender(); } return true; }
      case 'vibe-pick-all': {
        const kind = el.dataset.kind, set = picked[kind], items = kind === 'groups' ? state().groups : vibes();
        if (!set) return true;
        const shown = items.filter(x => matches(x.name, query)).map(x => x.id);
        if (shown.length && shown.every(id => set.has(id))) shown.forEach(id => set.delete(id)); else shown.forEach(id => set.add(id));
        rerender();
        return true;
      }
      case 'vibe-pick-group': if (picked.vibes.size) pickToGroup(); return true;
      case 'vibe-pick-delete': {
        const nv = picked.vibes.size, ng = picked.groups.size;
        if (!nv && !ng) return true;
        const what = [nv && `${nv} 個 Vibe`, ng && `${ng} 個組`].filter(Boolean).join('和');
        if (!await ctx.confirm(`刪除 ${what}？`, `${nv ? '刪掉的 Vibe 會從這臺裝置刪除，也會從所有組裡去掉。' : ''}${ng ? '刪掉組不會刪組裡的 Vibe。' : ''}想留著可以先「全部匯出」或者備份一次。`)) return true;
        if (ng) {
          const v = state();
          api.saveDraw({vibe: {groups: v.groups.filter(g => !picked.groups.has(g.id)), use: v.use.kind === 'group' && picked.groups.has(v.use.id) ? {kind: '', id: ''} : v.use}});
        }
        if (nv) await api.deleteVibes([...picked.vibes]);
        selecting = false; picked.vibes.clear(); picked.groups.clear(); rerender();
        ctx.notify(`已刪除 ${what}`);
        return true;
      }
    }
    return false;
  }
  /** Files picked for import. */
  async function importFiles(files) {
    if (!files?.length) return;
    report(await api.importVibes(files));
  }
  function report(r) {
    rerender();
    const done = [r.added && `新增 ${r.added} 個 Vibe`, r.updated && `${r.updated} 個已經有了`, r.renamed && `${r.renamed} 個改成了智繪姬裡的名字`, r.groups && `${r.groups} 個組`].filter(Boolean).join('，');
    if (r.errors.length) ctx.notify((done ? done + '；' : '') + r.errors.map(x => `${x.name}：${x.message}`).join('；'), {error: true});
    else ctx.notify(done ? '已匯入：' + done : '沒有匯入任何內容');
  }
  /** Typing in the search box: filters both lists in place (no redraw, so the keyboard stays up). */
  function search(value) {
    query = value;
    for (const box of root().querySelectorAll('[data-list]')) filterList(box, query);
  }
  return {html, click, importFiles, search};
}
