import {createView, esc, btn, field, input, textArea, heading, help, groupTitle, plate, avatar} from './common.js';
import {icon} from './icons.js';
import {openContactStatus, openStatusDirectory} from './contact-profile.js';

const number = i => 'No.' + String(i + 1).padStart(3, '0');

/** The character library keeps names, appearance and links to story profiles. */
export function rolesApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'roles'), drafts = new Map();
  let current = null;
  const changed = () => { const el = v.root.querySelector('[data-save-state]'); if (el) el.textContent = '未儲存'; };

  function renderList() {
    const roles = api.getState().routes;
    const cards = roles.map((r, i) => `<button class="role-card" data-action="edit-role" data-id="${esc(r.id)}">
      <span class="role-top"><span class="role-no">${number(i)}</span>${avatar(r.name, 'none', 54)}</span>
      <span class="role-body"><strong>${esc(r.name)}</strong><small>${esc(r.appearance || '尚未填寫固定外貌')}</small></span></button>`).join('');
    v.draw(heading('角色庫', help('保存角色名稱與固定外貌。詳細人設、身體狀態與劇情資料可在「角色信息」中查看或修改。') + btn('add-role', icon('add'), 'round-button', 'aria-label="新增角色"'), `Characters · ${String(roles.length).padStart(2, '0')}`)
      + (api.pocketContactProfiles ? `<div class="group">${btn('status-directory', `${icon('person')}<span><strong>劇情角色信息</strong><small>查看與修改正文中的角色資料</small></span>${icon('next')}`, 'list-row')}</div>` : '')
      + `<div class="role-grid">${cards}<button class="role-card add" data-action="add-role">${icon('add')}新增角色</button></div>`);
  }

  function renderEditor() {
    const r = current, saved = api.getState().routes.findIndex(x => x.id === r.id);
    v.draw(heading(r.id ? '編輯角色' : '新增角色', '', 'Character Library')
      + `<div class="id-card none">
          <div class="id-top"><span>CHARACTER CARD</span>${plate(saved >= 0 ? number(saved) : 'NEW')}</div>
          <div class="id-main"><span class="id-photo">${avatar(r.name || '新', 'none', 76)}</span><div class="id-name" data-id-name>${esc(r.name || '新角色')}</div></div>
        </div>
        <div class="group pad">${field('角色名稱', input('name', r.name, 'text', 'placeholder="填寫劇情中的角色名稱"'))}</div>
        ${api.pocketContactProfile && r.name ? `<div class="group">${btn('role-status', `${icon('person')}<span><strong>查看／修改角色信息</strong><small>人設、身體狀態與最新劇情資料</small></span>${icon('next')}`, 'list-row')}</div>` : ''}
        ${groupTitle('固定外貌')}
        <div class="group pad">${field('外貌 tag', textArea('appearance', r.appearance || '', 'class="code" rows="4" placeholder="例如 1girl, long silver hair, blue eyes, slender"'), '角色入畫時會補上這些特徵，讓長相保持一致。用英文 tag，逗號分隔；衣服、表情和動作可由劇情決定。')}</div>
        <div class="savebar"><span class="save-state" data-save-state>草稿</span>${btn('save-role', '儲存', 'primary')}</div>
        ${r.id ? `<div class="actions">${btn('delete-role', '從角色庫移除', 'danger')}</div>` : ''}`);
  }
  const render = () => current ? renderEditor() : renderList();
  function edit(id) {
    const saved = api.getState().routes.find(r => r.id === id);
    if (!saved) { ctx.notify('角色已不存在'); return; }
    current = drafts.get(id) || structuredClone(saved);
    drafts.set(id, current);
    render();
  }
  function create(name = '') {
    current = drafts.get('new') || {name: '', appearance: ''};
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
  });
  v.on('click', '[data-action]', async el => {
    switch (el.dataset.action) {
      case 'status-directory': await openStatusDirectory(ctx); break;
      case 'role-status': if (current?.name) await openContactStatus(ctx, current.name); break;
      case 'add-role': create(); break;
      case 'edit-role': edit(el.dataset.id); break;
      case 'save-role': {
        const previous = current.id || 'new';
        current = api.saveRoute(current);
        drafts.delete(previous);
        drafts.set(current.id, current);
        render();
        v.root.querySelector('[data-save-state]').textContent = '已儲存';
        ctx.notify('角色資料已儲存');
        break;
      }
      case 'delete-role':
        if (await ctx.confirm('從角色庫移除？', '會移除此處的角色名稱與固定外貌；聊天記錄與劇情角色信息會保留。')) {
          api.deleteRoute(current.id);
          drafts.delete(current.id);
          current = null;
          render();
        }
        break;
    }
  });
  render();
  return v;
}
