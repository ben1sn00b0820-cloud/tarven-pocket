import {createView, esc, btn, field, input, select, textArea, toggle, heading, help, groupTitle, plate, empty} from './common.js';
import {icon, glyph} from './icons.js';
import {APPS} from './apps.js';

const positions = [['in_chat', '聊天內'], ['before_prompt', '主提示詞之前'], ['in_prompt', '主提示詞之後']];
const roles = [['system', '系統'], ['user', '使用者'], ['assistant', '助手']];
// Preset kinds: voice (dialogue tags), chat (phone chat replies, 朋友圈, and bringing chats into the story), drawing
// (<img> tags in the chat text). A chat rule says where it is used: 私聊, 群聊, 朋友圈.
const KINDS = [['tts', '配音', 'listen'], ['chat', '聊天', 'chat'], ['draw', '繪圖', 'draw']];
const USES = [['dm', '私聊'], ['group', '群聊'], ['moments', '朋友圈'], ['call', '電話'], ['forum', '論壇'], ['peek', '查手機']];
// Drawing rules: which engines an entry is sent with (none ticked or all ticked: every engine).
const ENGINE_USES = [['nai', 'NovelAI'], ['gpt', 'GPT 生圖'], ['comfy', 'ComfyUI']];
const engineScope = e => e.engines?.length ? ' · 只給 ' + ENGINE_USES.filter(([k]) => e.engines.includes(k)).map(([, l]) => l).join('、') : '';

export function presetsApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'presets'), drafts = new Map();
  let current = null, currentKind = 'tts', kind = 'tts';
  const mark = () => { const el = v.root.querySelector('[data-save-state]'); if (el) el.textContent = '未儲存'; };
  /** A fresh copy of the shipped preset of a kind: new entry ids, no preset id. */
  const shipped = k => {
    const base = structuredClone(k === 'chat' ? api.defaultChatPreset : k === 'draw' ? api.defaultDrawPreset : api.defaultVoicePreset);
    base.entries = base.entries.map(e => ({...e, id: e.id && k !== 'tts' ? e.id : crypto.randomUUID()}));
    return base;
  };
  const tile = app => { const [t1, t2, tac] = APPS[app].colors; return `<span class="mini-tile" style="--t1:${t1};--t2:${t2};--tac:${tac}">${glyph(app)}</span>`; };
  // Operations differ only in which backend list they touch.
  const ops = k => k === 'draw'
    ? {list: () => api.getState().draw.presets, active: () => api.getState().draw.activePreset, save: p => api.saveDrawPreset(p), remove: id => api.deleteDrawPreset(id), use: id => api.saveDraw({activePreset: id}), preview: p => api.previewDrawPrompt(p), validate: () => ''}
    : k === 'chat'
    ? {list: () => api.getState().chat.presets, active: () => api.getState().chat.activePreset, save: p => api.saveChatPreset(p), remove: id => api.deleteChatPreset(id), use: id => api.selectChatPreset(id), preview: p => api.previewChatPrompt(p), validate: p => api.validateChatPreset(p)}
    : {list: () => api.getState().presets, active: () => api.getState().activePreset, save: p => api.savePreset(p), remove: id => api.deletePreset(id), use: id => api.selectPreset(id), preview: p => api.previewPrompt({...p, id: p.id || 'preview'}), validate: p => api.validatePreset(p)};

  function injection(i, index = 'preset') {
    const attrs = `data-injection-owner="${index}"`;
    const inChat = i.position === 'in_chat';
    return field('插入位置', select('position', i.position, positions, attrs))
      + field('深度', input('depth', i.depth, 'number', `${attrs} min="0" max="10000" step="1" ${inChat ? '' : 'disabled'}`))
      + field('身份', select('role', i.role, roles, `${attrs} ${inChat ? '' : 'disabled'}`));
  }

  function renderList() {
    const [, label, app] = KINDS.find(k => k[0] === kind);
    const tabs = `<div class="segmented">${KINDS.map(([k, l]) => `<button data-action="kind" data-kind="${k}" aria-pressed="${k === kind}">${l}</button>`).join('')}</div>`;
    let body;
    {
      const o = ops(kind), active = o.active();
      const draw = api.getState().draw;
      body = (kind === 'draw' && !draw.enabled ? '<p class="hint">正文出圖沒有開啟，在「設定 · 繪圖」裡開啟後，使用中的繪圖預設才會加進聊天請求。</p>' : '')
        + o.list().map(p => `<button class="preset-card" data-action="edit-preset" data-kind="${kind}" data-id="${esc(p.id)}"${p.id === active ? ' data-active' : ''}>${tile(app)}<span><strong>${esc(p.name || '未命名預設')}</strong><small>${kind === 'chat' ? `讀正文 ${p.context} 條 · 聊天記錄 ${p.history} 條` : kind === 'draw' ? `每條回覆 ${p.count} 張 · ${p.entries.length} 條規則` : `${p.entries.length} 條規則 · ${esc(positions.find(x => x[0] === p.injection.position)?.[1] || '')}`}</small></span>${p.id === active ? plate('使用中') : icon('next')}</button>`).join('')
        + `<div class="actions">${btn('restore-default', icon('refresh') + '恢復預設預設', 'secondary')}</div>`
        + `<p class="hint">${kind === 'draw'
          ? '繪圖預設是給正文模型看的出圖規則：什麼時候出圖、標籤怎麼寫。畫師串和固定 tag 在繪圖 App 的“畫風”裡。'
          : kind === 'chat'
          ? '聊天預設決定手機裡的聯絡人怎麼回訊息、朋友圈怎麼發、能看到多少劇情，以及“帶進劇情”時怎麼寫進下一次正文。每條規則可以選用在私聊、群聊還是朋友圈。手機聊天和朋友圈單獨生成，不會寫進正文。'
          : '配音預設讓模型把臺詞寫成帶 TTS 標籤的格式。角色配音不在預設裡，切換預設不會改動角色。'}</p>`;
    }
    v.draw(heading('預設', btn('add-preset', icon('add'), 'round-button', `aria-label="新增${label}預設"`), 'Preset · 3 類') + tabs + body);
  }

  /** The 世界书 line: how much is left out (picked in a sheet), and the tags cleaned away (status bars). */
  function loreFields(p) {
    const books = (p.loreSkipBooks || []).length, entries = (p.loreSkipEntries || []).length;
    return `<div class="setting-row"><span class="row-text"><strong>手機讀哪些世界書</strong><small>${books || entries ? `不讀 ${books} 本、${entries} 條` : '現在開著的都讀'}</small></span>${btn('lore-pick', '選擇', 'chip-button')}</div>
      ${field('清洗標籤', input('cleanTags', Array.isArray(p.cleanTags) ? p.cleanTags.join(', ') : String(p.cleanTags ?? ''), 'text', 'placeholder="比如 status, 狀態列" autocomplete="off"'), '寫標籤名，逗號隔開。世界書裡用這些標籤包住的內容（比如 <status>…</status>）不給手機，手機回覆裡要是寫了也會去掉。')}`;
  }
  /** A sheet listing the books turned on now and their entries: switch one off and the phone leaves it out. */
  async function pickLore() {
    const d = ctx.dialog('手機讀哪些世界書', '<p class="hint">正在讀取世界書……</p>');
    let books = [];
    try { books = await api.loreBooks?.() || []; } catch (error) { d.body.innerHTML = `<p class="hint error-copy">${esc(error.message)}</p>`; return; }
    if (!d.live) return;
    const skipBooks = new Set(current.loreSkipBooks || []), skipEntries = new Set(current.loreSkipEntries || []);
    let query = '';
    const hit = (...texts) => !query || texts.some(t => String(t || '').toLowerCase().includes(query));
    const paint = () => {
      const keep = d.body.querySelector('[data-lore-list]')?.scrollTop || 0;
      const rows = books.map(b => {
        const off = skipBooks.has(b.name), shown = b.entries.filter(e => hit(e.title, e.keys.join(' '), e.preview, b.name));
        if (query && !shown.length && !hit(b.name)) return '';
        const left = b.entries.filter(e => skipEntries.has(e.id)).length;
        return `<details class="lore-book${off ? ' off' : ''}" ${query ? 'open' : ''}><summary><span class="row-text"><strong>${esc(b.name)}</strong><small>${esc(b.from.join(' · '))} · ${b.entries.length} 條${left ? `，不讀 ${left} 條` : ''}</small></span>
            <input class="switch" type="checkbox" data-lore-book="${esc(b.name)}" ${off ? '' : 'checked'} aria-label="讀「${esc(b.name)}」"></summary>
          <div>${shown.map(e => `<label class="lore-entry${skipEntries.has(e.id) ? ' off' : ''}"><span class="row-text"><strong>${esc(e.title)}</strong><small>${e.constant ? '常駐' : e.keys.length ? '關鍵詞：' + esc(e.keys.join('、')) : '沒有關鍵詞'}${e.preview ? ' · ' + esc(e.preview) : ''}</small></span>
            <input class="switch" type="checkbox" data-lore-entry="${esc(e.id)}" ${skipEntries.has(e.id) ? '' : 'checked'} ${off ? 'disabled' : ''} aria-label="讀「${esc(e.title)}」"></label>`).join('') || '<p class="hint">這本書沒有啟用的條目。</p>'}</div></details>`;
      }).join('');
      d.body.querySelector('[data-lore-list]').innerHTML = rows || `<p class="hint">${query ? '沒有搜到。' : '現在沒有開著的世界書。'}</p>`;
      d.body.querySelector('[data-lore-list]').scrollTop = keep;
    };
    d.body.innerHTML = `<div class="vibe-search">${icon('search')}<input type="search" data-lore-search placeholder="搜尋書名、條目標題、關鍵詞" aria-label="搜尋世界書"></div>
      <p class="hint" style="padding:6px 2px">列出的是現在開著的世界書（全域性、角色卡、聊天、人設繫結的）和裡面啟用的條目。關掉的手機就不讀，正文照常用。改完點「儲存預設」才生效。</p>
      <div class="lore-list" data-lore-list></div>`;
    paint();
    d.body.addEventListener('input', e => { if (e.target.matches('[data-lore-search]')) { query = e.target.value.trim().toLowerCase(); paint(); } });
    d.body.addEventListener('change', e => {
      const el = e.target;
      if (el.dataset.loreBook !== undefined) { if (el.checked) skipBooks.delete(el.dataset.loreBook); else skipBooks.add(el.dataset.loreBook); }
      else if (el.dataset.loreEntry !== undefined) { if (el.checked) skipEntries.delete(el.dataset.loreEntry); else skipEntries.add(el.dataset.loreEntry); }
      else return;
      current.loreSkipBooks = [...skipBooks]; current.loreSkipEntries = [...skipEntries]; mark();
      const open = [...d.body.querySelectorAll('details.lore-book')].map(x => x.open);
      paint();
      d.body.querySelectorAll('details.lore-book').forEach((x, i) => { if (open[i]) x.open = true; });
    });
    // A click on the switch inside a summary must not also open or close the book.
    d.body.addEventListener('click', e => { if (e.target.matches('summary .switch')) e.stopPropagation(); }, true);
    d.onClose(() => render());
  }
  function renderEditor() {
    const p = current, o = ops(currentKind), draw = currentKind === 'draw', chat = currentKind === 'chat';
    const used = p.id && p.id === o.active();
    v.draw(heading(p.id ? '編輯預設' : '新預設', '', draw ? 'Drawing Preset' : chat ? 'Chat Preset' : 'Voice Preset')
      + `<div class="group pad">${field('名稱', input('name', p.name))}${chat
        ? `${field('讀取最近的正文', input('context', p.context, 'number', 'min="0" max="40" step="1"'), '回訊息時參考最近幾條正文，0 表示不看劇情。')}${field('讀取聊天記錄', input('history', p.history, 'number', 'min="2" max="200" step="1"'), '回訊息時帶上最近多少條手機聊天。')}${field('每次重新整理朋友圈最多幾條', input('posts', p.posts ?? 2, 'number', 'min="1" max="5" step="1"'), '在動態裡重新整理時，由模型挑 1 到這麼多個人發動態。')}${toggle('lore', '帶上世界書', p.lore !== false, '聊天、電話和朋友圈也帶上酒館的世界書：和寫正文時一樣，常駐的條目，以及在名字、最近的正文和聊天裡觸發關鍵詞的條目（當前角色卡的世界書、全域性和聊天繫結的世界書都算）。人設寫在世界書裡的話要開啟。\n\n條目多的話會多佔一些上下文。')}${p.lore !== false ? loreFields(p) : ''}${field('帶進劇情的寫法', textArea('bring', p.bring, 'class="code" rows="4"'), '選中的聊天訊息會按這段文字注入下一次正文，只用一次。需要包含 {{聊天記錄}}；也可以用 {{使用者}}、{{物件}}。')}`
        : draw
        ? `${field('每條回覆出圖數量', input('count', p.count ?? 1, 'number', `min="1" max="${api.drawCountMax}" step="1"`), '每條回覆固定出這麼多張圖。規則裡寫 {{出圖數量}} 會換成這個數字；外掛還會在規則最後加一段硬性要求，讓張數更穩定。張數越多，出圖越久。')}<div class="field"><span>出圖塊格式${help('規則裡寫 {{出圖格式}} 會換成下面這段（回覆後單獨配圖時，還會多一行「位置」）；{{角色列表}} 會換成已登記的角色和他們的固定外貌；{{出圖數量}} 換成張數。別的外掛要排除出圖內容時，排除標籤填 <img></img>。')}</span><pre class="code-preview" style="margin:0">${esc(api.picTagFormat)}</pre></div>`
        : field('臺詞格式', textArea('format', p.format, 'class="code"'), '{譯文}、{角色}、{情緒}、{文字} 各保留一次。譯文供閱讀，原語言供語音生成。預設格式是成對的 <tts></tts>，別的外掛要排除語音原文時，排除標籤填 <tts></tts>。')}</div>
        <details data-group="preset-injection"><summary>${chat ? '帶進劇情的插入位置' : '預設插入設定'} ${help(chat ? '帶進劇情的文字插在正文請求的哪裡。深度與身份僅在聊天內插入時生效。' : '深度與身份僅在聊天內插入時生效；條目可以單獨覆蓋。')}</summary><div>${injection(p.injection)}</div></details>
        ${groupTitle(draw ? '出圖規則' : chat ? '聊天與朋友圈規則' : '提示詞條目', btn('add-entry', icon('add') + '條目', 'chip-button'))}
        ${p.entries.map((e, i) => `<details data-group="entry:${esc(e.id)}" ${i === 0 ? 'open' : ''}><summary>${esc(e.title || '未命名條目')}${draw ? esc(engineScope(e)) : ''}${e.enabled ? '' : ' · 已停用'}</summary><div data-entry="${i}">
          ${toggle('enabled', '啟用此條目', e.enabled)}
          ${field('條目名稱', input('title', e.title))}
          ${draw ? `<div class="field"><span>用在哪個引擎${help('勾了哪個，用那個引擎畫圖時才把這條規則發給模型。都勾或都不勾就是三個都用。在繪圖 App 頂上選用哪個畫。')}</span><div class="use-row">${ENGINE_USES.map(([u, l]) => `<label class="use-chip"><input type="checkbox" data-engine-use="${u}" ${!e.engines?.length || e.engines.includes(u) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>` : ''}
          ${chat ? `<div class="field"><span>用在</span><div class="use-row">${USES.map(([u, l]) => `<label class="use-chip"><input type="checkbox" data-use="${u}" ${(e.use || []).includes(u) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>` : ''}${field(draw || chat ? '規則' : '提示詞', textArea('text', e.text, 'class="code"'), draw ? '可以用 {{出圖格式}}、{{出圖數量}}、{{角色列表}}。外掛會在最後自動加上格式和張數的硬性要求。' : chat ? '可以用 {{使用者}}、{{物件}}；寫語音訊息規則時用 {{語音格式}}、{{可發語音}}。用在朋友圈的規則只能用 {{使用者}}。外掛會在最後自動加上輸出格式的硬性要求。' : '啟用規則的合計文字需包含 {{格式}} 和 {{語言}}。')}
          ${chat ? '' : toggle('customInjection', '單獨設定插入位置', !!e.injection)}${!chat && e.injection ? injection(e.injection, i) : ''}
          <div class="entry-tools">${btn('entry-up', icon('up') + '上移', 'text-button', `data-index="${i}" ${i === 0 ? 'disabled' : ''}`)}${btn('entry-down', icon('down') + '下移', 'text-button', `data-index="${i}" ${i === p.entries.length - 1 ? 'disabled' : ''}`)}${btn('delete-entry', icon('trash') + '刪除', 'text-button', `data-index="${i}"`)}</div>
        </div></details>`).join('')}
        <div class="actions">${btn('prompt-preview', icon('eye') + '傳送預覽', 'secondary')}${p.id ? btn('use-preset', used ? '正在使用' : '儲存並使用', 'secondary', used ? 'disabled' : '') : ''}</div>
        <div class="savebar"><span class="save-state" data-save-state>草稿</span>${btn('save-preset', '儲存預設', 'primary')}</div>
        <div class="actions">${btn('reset-content', icon('refresh') + '恢復成預設內容', 'secondary')}${p.id ? btn('delete-preset', '刪除預設', 'danger') : ''}</div>`);
  }

  const render = () => current ? renderEditor() : renderList();
  function edit(k, id) {
    const key = k + ':' + id;
    current = drafts.get(key) || structuredClone(ops(k).list().find(p => p.id === id));
    if (!current) return;
    currentKind = k;
    drafts.set(key, current);
    render();
  }
  v.showKind = k => { current = null; kind = k; render(); };
  v.back = () => { if (!current) return false; current = null; render(); return true; };
  v.refresh = () => { if (!current) render(); };

  function update(el, redraw) {
    const key = el.dataset.field, index = el.closest('[data-entry]')?.dataset.entry;
    if (el.dataset.injectionOwner !== undefined) {
      const owner = el.dataset.injectionOwner === 'preset' ? current : current.entries[Number(el.dataset.injectionOwner)];
      owner.injection[key] = key === 'depth' ? Number(el.value) : el.value;
    } else if (index !== undefined) {
      const entry = current.entries[Number(index)];
      if (key === 'customInjection') { if (el.checked) entry.injection = structuredClone(current.injection); else delete entry.injection; }
      else entry[key] = el.type === 'checkbox' ? el.checked : el.value;
    } else current[key] = el.type === 'checkbox' ? el.checked : el.value;
    mark();
    if (redraw) render();
  }
  v.on('input', '[data-field]', el => { if (current && el.type !== 'checkbox' && el.tagName !== 'SELECT') update(el, false); });
  v.on('change', '[data-engine-use]', el => {
    const entry = current?.entries[Number(el.closest('[data-entry]')?.dataset.entry)];
    if (!entry) return;
    const list = [...el.closest('.use-row').querySelectorAll('[data-engine-use]')].filter(x => x.checked).map(x => x.dataset.engineUse);
    if (!list.length || list.length === ENGINE_USES.length) delete entry.engines; else entry.engines = list;
    const summary = el.closest('details')?.querySelector('summary');
    if (summary) summary.textContent = (entry.title || '未命名條目') + engineScope(entry) + (entry.enabled ? '' : ' · 已停用');
    mark();
  });
  v.on('change', '[data-use]', el => {
    const entry = current?.entries[Number(el.closest('[data-entry]')?.dataset.entry)];
    if (!entry) return;
    entry.use = USES.map(([u]) => u).filter(u => u === el.dataset.use ? el.checked : (entry.use || []).includes(u));
    mark();
  });
  v.on('change', '[data-field]', el => {
    if (current && (el.type === 'checkbox' || el.tagName === 'SELECT')) update(el, true);
  });
  function save() {
    const key = currentKind + ':' + (current.id || 'new');
    current = ops(currentKind).save(current);
    drafts.delete(key);
    drafts.set(currentKind + ':' + current.id, current);
    render();
    v.root.querySelector('[data-save-state]').textContent = '已儲存';
    ctx.notify('預設已儲存');
  }
  v.on('click', '[data-action]', async el => {
    const index = Number(el.dataset.index);
    switch (el.dataset.action) {
      case 'kind': kind = el.dataset.kind; render(); break;
      case 'add-preset':
        currentKind = kind;
        current = drafts.get(kind + ':new') || {...shipped(kind), name: kind === 'chat' ? '新聊天預設' : kind === 'draw' ? '新出圖規則' : '新預設'};
        drafts.set(kind + ':new', current);
        render();
        break;
      case 'edit-preset': edit(el.dataset.kind || 'tts', el.dataset.id); break;
      // Adds the shipped preset again, for when it was deleted or edited beyond repair. Nothing else changes.
      case 'restore-default': {
        const names = ops(kind).list().map(p => p.name), base = shipped(kind);
        let name = base.name, n = 2;
        while (names.includes(name)) name = `${base.name}（${n++}）`;
        const saved = ops(kind).save({...base, name});
        ctx.notify(`已新增預設預設「${saved.name}」`);
        render();
        break;
      }
      // Puts the shipped rules, format and insertion back into this preset; its name stays. Saving makes it stick.
      case 'reset-content':
        if (await ctx.confirm('恢復成預設內容？', '這個預設的條目、格式和插入位置會換成預設的，名字不變。儲存之後才生效，不儲存就不會改動。')) {
          current = {...shipped(currentKind), id: current.id, name: current.name};
          drafts.set(currentKind + ':' + (current.id || 'new'), current);
          render();
          mark();
          ctx.notify('已換成預設內容，記得儲存');
        }
        break;
      case 'save-preset': save(); break;
      case 'use-preset': save(); ops(currentKind).use(current.id); render(); break;
      case 'lore-pick': await pickLore(); break;
      case 'add-entry':
        current.entries.push({id: crypto.randomUUID(), title: '新條目', enabled: true, text: ''});
        render();
        v.root.querySelector('details:last-of-type').open = true;
        mark();
        break;
      case 'delete-entry': if (await ctx.confirm('刪除這條規則？', '儲存預設後生效。')) { current.entries.splice(index, 1); render(); mark(); } break;
      case 'entry-up':
      case 'entry-down': {
        const to = index + (el.dataset.action === 'entry-up' ? -1 : 1);
        if (to >= 0 && to < current.entries.length) { [current.entries[index], current.entries[to]] = [current.entries[to], current.entries[index]]; render(); mark(); }
        break;
      }
      case 'delete-preset':
        if (await ctx.confirm('刪除這個預設？', '角色配音和畫風不會被刪除。')) { ops(currentKind).remove(current.id); drafts.delete(currentKind + ':' + current.id); current = null; render(); }
        break;
      case 'prompt-preview': {
        const o = ops(currentKind), error = o.validate(current);
        if (error) throw Error(error);
        ctx.dialog('傳送預覽', `<pre class="code-preview">${esc(o.preview(current))}</pre>`);
        break;
      }
    }
  });
  render();
  return v;
}
