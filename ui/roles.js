import {createView, esc, engines, btn, field, input, select, textArea, heading, help, groupTitle, plate, avatar, languageField, languageName, typedLanguages} from './common.js';
import {icon, halo} from './icons.js';
import {openContactStatus, openStatusDirectory} from './contact-profile.js';

function barcode(seed) {
  let h = 0, bars = '';
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  for (let i = 0; i < 40; i++) { h = (h * 1103515245 + 12345) >>> 0; bars += `<i style="flex:${1 + (h >>> 28) % 3}"></i>`; }
  return bars;
}
const number = i => 'No.' + String(i + 1).padStart(3, '0');

export function rolesApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'roles'), drafts = new Map(), voiceNames = new Map();
  let current = null;
  const changed = () => { const el = v.root.querySelector('[data-save-state]'); if (el) el.textContent = '未儲存'; };
  // A MiMo voice description can run to a few sentences: cards show its start, the editor shows it whole.
  const voiceLabel = voice => { const name = voiceNames.get(voice) || voice; return name.length > 16 ? name.slice(0, 15) + '…' : name; };

  function renderList() {
    const roles = api.getState().routes;
    const cards = roles.map((r, i) => {
      const voiced = !!r.voice, engine = voiced ? r.engine : 'none';
      return `<button class="role-card" data-action="edit-role" data-id="${esc(r.id)}" data-engine="${engine}">
        <span class="role-top"><span class="role-no">${number(i)}</span>${voiced ? halo() : ''}${avatar(r.name, engine, 54)}</span>
        <span class="role-body"><strong>${esc(r.name)}</strong>${voiced
          ? `<span>${plate(engines[r.engine])}</span><small>${esc(voiceLabel(r.voice))}<br>${esc(r.language ? languageName(r.language) : '跟隨預設語言')}</small>`
          : '<small class="unset">待選擇音色</small><small>出現在聊天裡時會等你配音</small>'}</span></button>`;
    }).join('');
    v.draw(heading('聲律譜', help('給聊天裡說話的角色配一個聲音。也可以直接點聊天裡的聲波，遇到沒配過的角色會帶你來這裡。') + btn('add-role', icon('add'), 'round-button', 'aria-label="新增角色"'), `Character · ${String(roles.length).padStart(2, '0')}`)
      + (api.pocketContactProfiles ? `<div class="group">${btn('status-directory', `${icon('person')}<span><strong>劇情角色信息</strong><small>讀取正文狀態、身體部位，並直接修改</small></span>${icon('next')}`, 'list-row')}</div>` : '')
      + `<div class="role-grid">${cards}<button class="role-card add" data-action="add-role">${icon('add')}新增角色</button></div>`
      );
  }

  function renderEditor() {
    const r = current, c = api.getState().connections[r.engine], schema = api.engineSchema(r.engine);
    const saved = api.getState().routes.findIndex(x => x.id === r.id), pending = api.pendingRole() === r.name && !!r.name;
    const voiced = !!r.voice, model = r.model || c.model;
    const mimo = r.engine !== 'mimo' ? '' : /voicedesign$/.test(model) ? 'design' : /voiceclone$/.test(model) ? 'clone' : 'preset';
    v.draw(heading(r.id ? '角色配音' : '新增角色', '', 'Voice Route')
      + (pending ? `<div class="banner">${icon('alert')}<span>播放停在「${esc(r.name)}」這裡，選好音色後可以繼續。</span></div>` : '')
      + `<div class="id-card${voiced ? '' : ' none'}" data-engine="${r.engine}">
          <div class="id-top"><span>VOICE ID CARD</span>${plate(saved >= 0 ? number(saved) : 'NEW')}</div>
          <div class="id-main"><span class="id-photo">${halo()}${avatar(r.name || '新', voiced ? r.engine : 'none', 76)}</span>
            <div style="min-width:0;flex:1"><div class="id-name" data-id-name>${esc(r.name || '新角色')}</div>
            <div class="id-fields"><span>ENGINE</span><span>${engines[r.engine]}</span><span>VOICE</span><span data-id-voice>${esc(voiced ? voiceLabel(r.voice) : '未選擇')}</span><span>LANG</span><span>${esc(r.language ? languageName(r.language) : '跟隨預設')}</span></div></div></div>
          <div class="barcode">${barcode((r.name || '') + r.engine + (r.voice || ''))}</div><span class="id-stamp">${voiced ? '已配音' : '待配音'}</span>
        </div>
        <div class="group pad">${field('角色名稱', input('name', r.name, 'text', 'placeholder="與臺詞裡的說話者一致"'))}</div>
        ${api.pocketContactProfile && r.name ? `<div class="group">${btn('role-status', `${icon('person')}<span><strong>查看／修改角色信息</strong><small>正文與千里傳音共用的最新角色資料</small></span>${icon('next')}`, 'list-row')}</div>` : ''}
        ${groupTitle('引擎', help('每個角色在各家引擎裡各自記住一套音色和模型，切過去再切回來不會丟。'))}
        <div class="engine-tabs">${Object.entries(engines).map(([k, label]) => {
          const bound = k === r.engine ? r.voice : r.bindings?.[k]?.voice;
          return `<button class="engine-tab" data-action="route-engine" data-engine="${k}" aria-pressed="${r.engine === k}" title="${esc(label + '：' + (bound ? voiceLabel(bound) : '未選音色'))}">${label}<small>${esc(bound ? voiceLabel(bound) : '未選音色')}</small></button>`;
        }).join('')}</div>
        ${groupTitle('聲音')}
        <div class="group pad" data-engine="${r.engine}">
          <div class="voice-row"><span class="disc">${icon('wave')}</span><div>${voiced ? `<strong>${esc(voiceLabel(r.voice))}</strong><small class="mono">${esc(mimo === 'design' ? '音色設計' : r.voice)}</small>` : '<strong class="unset">還沒有選擇音色</strong><small>從列表選擇，或在下面貼上音色 ID</small>'}</div>${mimo === 'design' ? '' : btn('pick-voice', '從列表選', 'chip-button')}</div>
          ${mimo === 'design'
            ? field('音色描述', textArea('voice', r.voice, 'rows="3" placeholder="例如：二十歲出頭的女生，聲音清亮，帶點慵懶，說話慢悠悠的"'), '用一到四句話描述：性別年齡、音色質感、情緒語氣、語速節奏。不要寫混響、回聲這類後期效果，也不要寫“普通”“正常”這種模糊的詞。')
            : field(mimo === 'clone' ? '克隆樣本' : '音色 ID', input('voice', r.voice, 'text', `placeholder="${mimo === 'clone' ? '填克隆樣本的名字，或從列表選擇' : '貼上音色 ID 或從列表選擇'}" autocomplete="off"`))}
          ${field('模型', select('model', r.model || '', [['', '跟隨引擎 · ' + c.model], ...schema.models.map(m => [m.id, m.id, !m.supported])]))}
          ${languageField('language', r.language || '', true, typedLanguages(api.getState()))}
        </div>
        ${groupTitle('繪圖')}
        <div class="group pad">${field('外貌 tag', textArea('appearance', r.appearance || '', 'class="code" rows="3" placeholder="例如 1girl, long silver hair, blue eyes, slender"'), '這個角色入畫時會自動補上這些 tag，讓長相保持一致。寫英文 danbooru tag，逗號分隔，只寫不會變的特徵：1girl 或 1boy、髮型髮色、瞳色、體型、顯眼的特徵；衣服、表情、動作讓模型按劇情寫。已有作品裡的角色，把識別 tag 放最前，比如 hatsune miku (vocaloid)。\n\n新角色第一次入畫時，模型寫的外貌會自動填到這裡，可以隨時改。')}</div>
        <div class="savebar" data-engine="${r.engine}"><span class="save-state" data-save-state>草稿</span>${btn('audition', icon('play', true) + '試聽', 'secondary')}${btn('save-role', '儲存', 'primary')}</div>
        ${pending ? `<div class="actions" data-engine="${r.engine}">${btn('continue-role', '儲存並繼續朗讀', 'primary')}</div>` : ''}
        ${r.id ? `<div class="actions">${btn('delete-role', '刪除角色配音', 'danger')}</div>` : ''}`);
  }

  const render = () => current ? renderEditor() : renderList();

  function edit(id) {
    const saved = api.getState().routes.find(r => r.id === id);
    if (!saved) { ctx.notify('角色已不存在'); return; }
    current = drafts.get(id) || structuredClone(saved);
    drafts.set(id, current);
    render();
  }
  // Starts a new draft for a speaker that appeared in chat without a voice.
  function create(name = '') {
    current = drafts.get('new') || {name: '', engine: 'fish', voice: '', model: '', language: '', bindings: {}};
    if (name) current.name = name;
    drafts.set('new', current);
    render();
  }
  v.edit = edit;
  v.create = create;
  v.back = () => { if (!current) return false; current = null; render(); return true; };
  v.refresh = () => { if (!current) render(); };

  v.on('input', '[data-field]', el => {
    if (!current) return;
    current[el.dataset.field] = el.value;
    changed();
    if (el.dataset.field === 'name') { const n = v.root.querySelector('[data-id-name]'); if (n) n.textContent = el.value || '新角色'; }
    if (el.dataset.field === 'voice') { const n = v.root.querySelector('[data-id-voice]'); if (n) n.textContent = el.value ? voiceLabel(el.value) : '未選擇'; }
  });
  // A MiMo model change turns the 音色 field into a description or a clone sample name.
  v.on('change', 'select[data-field]', el => { current[el.dataset.field] = el.value; changed(); if (el.dataset.field === 'model' && current.engine === 'mimo') render(); });
  v.on('click', '[data-action]', async el => {
    switch (el.dataset.action) {
      case 'status-directory': await openStatusDirectory(ctx); break;
      case 'role-status': if (current?.name) await openContactStatus(ctx, current.name); break;
      case 'add-role': create(); break;
      case 'edit-role': edit(el.dataset.id); break;
      case 'route-engine':
        current = api.switchRouteEngine(current, el.dataset.engine);
        drafts.set(current.id || 'new', current);
        render();
        changed();
        break;
      case 'save-role':
      case 'continue-role': {
        const previous = current.id || 'new';
        current = api.saveRoute(current);
        drafts.delete(previous);
        drafts.set(current.id, current);
        render();
        v.root.querySelector('[data-save-state]').textContent = '已儲存';
        ctx.notify('角色配音已儲存');
        if (el.dataset.action === 'continue-role') api.resume();
        break;
      }
      case 'audition': api.audition(current); break;
      case 'delete-role':
        if (await ctx.confirm('刪除角色配音？', '其他角色的音色和預設會保留。')) {
          api.deleteRoute(current.id);
          drafts.delete(current.id);
          current = null;
          render();
        }
        break;
      case 'pick-voice': pickVoice(); break;
    }
  });

  function pickVoice() {
    const target = current, engine = target.engine, saved = api.getState().connections[engine], connection = {...saved, model: target.model || saved.model};
    let page = 0, token = '', search = '', epoch = 0;
    const dialog = ctx.dialog('選擇音色', `<div class="field"><input class="search" type="search" placeholder="搜尋音色" aria-label="搜尋音色"></div><div class="actions">${btn('search', '搜尋', 'secondary')}</div><div class="group" data-engine="${engine}" data-voices></div>`);
    const load = async more => {
      const ticket = ++epoch;
      if (!more) { page = 0; token = ''; }
      const list = dialog.body.querySelector('[data-voices]');
      if (!more) list.innerHTML = '<p class="hint">正在讀取…</p>';
      try {
        const result = await api.voices(engine, connection, {search, page, token});
        if (!dialog.live || ticket !== epoch) return;
        const rows = engine === 'mini' && search ? result.voices.filter(x => x.name.toLowerCase().includes(search.toLowerCase()) || x.id.includes(search)) : result.voices;
        for (const r of rows) voiceNames.set(r.id, r.name);
        const html = rows.map(r => `<button class="list-row" data-voice="${esc(r.id)}"><span class="disc">${icon('wave')}</span><span><strong>${esc(r.name)}</strong><small class="mono">${esc(r.id)}</small></span>${icon('next')}</button>`).join('');
        if (!more) list.innerHTML = html || '<p class="hint">沒有找到音色，可以直接填寫音色 ID。</p>';
        else { list.querySelector('[data-more]')?.remove(); list.insertAdjacentHTML('beforeend', html); }
        if (result.more) list.insertAdjacentHTML('beforeend', '<button class="text-button" data-more>載入更多</button>');
        token = result.token;
        page++;
      } catch (error) {
        if (dialog.live && ticket === epoch) { list.innerHTML = ''; const p = ctx.doc.createElement('p'); p.className = 'error-copy'; p.textContent = error.message; list.append(p); }
      }
    };
    dialog.body.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.voice) {
        target.voice = b.dataset.voice;
        dialog.close();
        if (current === target) { render(); changed(); }
      } else if (b.hasAttribute('data-more')) { b.disabled = true; load(true); }
      else if (b.dataset.action === 'search') { search = dialog.body.querySelector('input').value.trim(); load(false); }
    });
    load(false);
  }

  render();
  return v;
}
