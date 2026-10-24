import {createView, esc, btn, heading, empty, size, field, input, textArea} from './common.js';
import {icon} from './icons.js';
import {openImageViewer} from '../image-viewer.js';
import {saveFile, downloadAction} from '../download.js';

const NOTE_COLORS = ['#fff4b0', '#ffd9e6', '#d9ecff', '#e3f5d9', '#efe0ff', '#ffe6cc'];
const hash = text => [...String(text)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
/** Saves the picture a backend call returns ({blob, name}) and says under which name. */
const saveAs = async (ctx, file) => { const {blob, name} = await file; ctx.notify('已下載 ' + await saveFile(ctx.doc, blob, name)); };
const dateLabel = time => new Date(time).toLocaleDateString('zh-TW', {month: 'numeric', day: 'numeric'});

export function galleryApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'gallery'), urls = new Set();
  let current = null, epoch = 0;
  const clear = () => { for (const url of urls) ctx.win.URL.revokeObjectURL(url); urls.clear(); };
  const urlFor = blob => { const url = ctx.win.URL.createObjectURL(blob); urls.add(url); return url; };
  const photoFile = async id => { const photo = await api.getPhoto(id); if (!photo) throw Error('這張照片已經不在了'); return {source: photo.blob, name: photo.name}; };
  const importButton = `<label class="chip-button file-button">${icon('import')}匯入<input type="file" data-photo-files multiple accept="image/png,image/jpeg,image/webp,image/avif,image/gif" aria-label="匯入照片"></label>`;
  async function render() {
    const ticket = ++epoch;
    if (current) {
      const photo = await api.getPhoto(current);
      if (v.disposed || ticket !== epoch) return;
      clear();
      if (!photo) { current = null; return render(); }
      v.draw(heading('照片', '', 'Photo') + `<button type="button" class="photo-zoom" data-action="zoom" aria-label="放大檢視"><img class="photo-full" src="${esc(urlFor(photo.blob))}" alt="${esc(photo.name)}"></button><p class="hint">${esc(photo.name)} · ${size(photo.size)}</p><div class="actions">${btn('wallpaper', icon('image') + '設為桌布', 'primary')}${btn('download-photo', icon('download') + '下載', 'secondary')}${btn('delete-photo', icon('trash') + '刪除', 'danger')}</div>`);
      return;
    }
    const rows = await api.listPhotos();
    if (v.disposed || ticket !== epoch) return;
    clear();
    v.draw(heading('留影閣', importButton, `Album · ${rows.length}`) + (rows.length
      ? `<div class="photo-grid">${rows.map(r => `<button data-action="photo" data-id="${esc(r.id)}" aria-label="檢視 ${esc(r.name)}"><img loading="lazy" data-photo="${esc(r.id)}" alt="${esc(r.name)}"></button>`).join('')}</div>`
      : empty('留住喜歡的畫面', '從本地匯入照片，也可以設為手機桌布。', 'image')));
    for (const row of rows) {
      const photo = await api.getPhoto(row.id);
      if (v.disposed || ticket !== epoch) return;
      if (photo) { const img = [...v.root.querySelectorAll('[data-photo]')].find(el => el.dataset.photo === row.id); if (img) img.src = urlFor(photo.blob); }
    }
  }
  v.back = () => { if (!current) return false; current = null; render().catch(e => ctx.notify(e.message)); return true; };
  v.refresh = render;
  const dispose = v.dispose;
  v.dispose = () => { epoch++; clear(); dispose(); };
  v.on('change', '[data-photo-files]', async el => {
    el.disabled = true;
    try {
      for (const file of el.files || []) await api.addPhoto({name: file.name, blob: file});
      await render();
      ctx.notify('照片已儲存');
    } finally { if (el.isConnected) { el.value = ''; el.disabled = false; } }
  });
  v.on('click', '[data-action]', async el => {
    switch (el.dataset.action) {
      case 'photo': current = el.dataset.id; await render(); break;
      case 'zoom': {
        const img = el.querySelector('img'), id = current;
        openImageViewer({doc: ctx.doc, src: img.src, alt: img.alt, from: img, actions: [
          downloadAction(ctx.doc, () => photoFile(id), ctx.notify),
          {label: '設為桌布', run: async () => { await api.savePhone({wallpaper: {kind: 'photo', photoId: id}}); ctx.notify('已設為桌布'); }},
          {label: '刪除', danger: true, run: async () => { if (!await ctx.confirm('刪除這張照片？', '使用它的桌布和圖示會恢復預設。')) return false; await api.deletePhoto(id); current = null; await render(); }}
        ]});
        break;
      }
      case 'wallpaper': await api.savePhone({wallpaper: {kind: 'photo', photoId: current}}); ctx.notify('已設為桌布'); break;
      case 'download-photo': { const id = current; await v.busy(el, async () => { const {source, name} = await photoFile(id); await saveAs(ctx, {blob: source, name}); }); break; }
      case 'delete-photo': if (await ctx.confirm('刪除這張照片？', '使用它的桌布和圖示會恢復預設。')) { await api.deletePhoto(current); current = null; await render(); } break;
    }
  });
  render().catch(e => ctx.notify(e.message));
  return v;
}

export function notesApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'notes'), drafts = new Map();
  let current = null, epoch = 0;
  const color = id => NOTE_COLORS[hash(id || 'new') % NOTE_COLORS.length];
  async function render() {
    const ticket = ++epoch;
    if (current) {
      v.draw(heading(current.id ? '備忘錄' : '新備忘錄', '', 'Memo')
        + `<div class="note-paper" style="--nc:${color(current.id)}">${field('標題', input('title', current.title, 'text', 'maxlength="200" placeholder="標題"'))}${field('正文', textArea('text', current.text, 'rows="12" placeholder="寫點什麼…"'))}</div>
          <div class="savebar"><span class="save-state" data-save-state>草稿</span>${btn('save-note', '儲存', 'primary')}</div>
          ${current.id ? `<div class="actions">${btn('delete-note', icon('trash') + '刪除備忘錄', 'danger')}</div>` : ''}`);
      return;
    }
    const rows = await api.listNotes();
    if (v.disposed || ticket !== epoch) return;
    v.draw(heading('隨行箋', btn('add-note', icon('add'), 'round-button', 'aria-label="新增備忘錄"'), `Memo · ${rows.length}`) + (rows.length
      ? `<div class="notes-grid">${rows.map((n, i) => `<button class="note-card" style="--nc:${color(n.id)};--r:${(hash(n.id) % 5 - 2) * .6}deg" data-action="edit-note" data-id="${esc(n.id)}"><strong>${esc(n.title || '未命名')}</strong><small>${esc(n.text.slice(0, 80) || '空白備忘錄')}</small><small>${dateLabel(n.updatedAt)}</small></button>`).join('')}</div>`
      : empty('隨手記下這一刻', '備忘錄只由你手動記錄，不讀取聊天，也不會注入提示詞。', 'edit')));
  }
  v.back = () => { if (!current) return false; current = null; render().catch(e => ctx.notify(e.message)); return true; };
  v.refresh = () => { if (!current) return render(); };
  v.on('input', '[data-field]', el => {
    current[el.dataset.field] = el.value;
    const s = v.root.querySelector('[data-save-state]');
    if (s) s.textContent = '未儲存';
  });
  v.on('click', '[data-action]', async el => {
    switch (el.dataset.action) {
      case 'add-note': current = drafts.get('new') || {title: '', text: ''}; drafts.set('new', current); await render(); break;
      case 'edit-note': {
        const rows = await api.listNotes(), saved = rows.find(r => r.id === el.dataset.id);
        if (!saved) return;
        current = drafts.get(saved.id) || saved;
        drafts.set(saved.id, current);
        await render();
        break;
      }
      case 'save-note':
        await v.busy(el, async () => {
          // Only what the user edits goes back: a saved note also carries its dates, which saveNote does not take.
          const target = current, saved = await api.saveNote({...(target.id ? {id: target.id} : {}), title: target.title, text: target.text});
          drafts.delete(target.id || 'new');
          drafts.set(saved.id, saved);
          if (current === target) { current = saved; await render(); v.root.querySelector('[data-save-state]').textContent = '已儲存'; }
          ctx.notify('備忘錄已儲存');
        });
        break;
      case 'delete-note': if (await ctx.confirm('刪除這條備忘錄？')) { await api.deleteNote(current.id); drafts.delete(current.id); current = null; await render(); } break;
    }
  });
  render().catch(e => ctx.notify(e.message));
  return v;
}
