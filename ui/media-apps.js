import {createView, esc, engines, btn, heading, empty, size, field, input, textArea, groupTitle, avatar} from './common.js';
import {icon, wave, halo} from './icons.js';
import {openImageViewer} from '../image-viewer.js';
import {saveFile, downloadAction} from '../download.js';
import {decodeMono, joinClips, encodeWav, JOIN_RATE} from '../core/audio-join.js';

const NOTE_COLORS = ['#fff4b0', '#ffd9e6', '#d9ecff', '#e3f5d9', '#efe0ff', '#ffe6cc'];
const hash = text => [...String(text)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
/** Saves the audio or picture a backend call returns ({blob, name}) and says under which name. */
const saveAs = async (ctx, file) => { const {blob, name} = await file; ctx.notify('已下載 ' + await saveFile(ctx.doc, blob, name)); };
const dateLabel = time => new Date(time).toLocaleDateString('zh-TW', {month: 'numeric', day: 'numeric'});

export function libraryApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'library');
  let tab = 'favorites', role = '', epoch = 0;
  async function render() {
    const ticket = ++epoch;
    const [rows, cache, library] = await Promise.all([tab === 'favorites' ? api.listFavorites() : api.listAudio(), api.cacheStats(), api.libraryStats().catch(() => null)]);
    if (v.disposed || ticket !== epoch) return;
    const roleOf = r => r.role || r.metadata?.line?.role || '';
    const roles = [...new Set(rows.map(roleOf).filter(Boolean))];
    const shown = rows.filter(r => !role || roleOf(r) === role);
    const tabs = `<div class="segmented"><button data-action="tab" data-tab="favorites" aria-pressed="${tab === 'favorites'}">收藏</button><button data-action="tab" data-tab="cache" aria-pressed="${tab === 'cache'}">快取</button></div>`;
    const filters = roles.length ? `<div class="filter-row"><button data-action="role" data-role="" aria-pressed="${!role}">全部</button>${roles.map(r => `<button data-action="role" data-role="${esc(r)}" aria-pressed="${role === r}">${esc(r)}</button>`).join('')}</div>` : '';
    let body;
    if (tab === 'favorites') {
      body = shown.length
        ? '<div class="group">' + shown.map(r => `<div class="audio-row" data-engine="${esc(r.engine)}">${btn('play-favorite', icon('play', true), 'play-round', `data-id="${esc(r.id)}" aria-label="播放收藏"`)}<div><p>“${esc(r.translation || r.text)}”</p><small>${esc(r.role)} · ${engines[r.engine] || r.engine} · ${size(r.size)} · ${dateLabel(r.createdAt)}</small></div><span class="row-tools">${btn('download-favorite', icon('download'), 'text-button', `data-id="${esc(r.id)}" aria-label="下載到本地"`)}${btn('delete-favorite', icon('trash'), 'text-button', `data-id="${esc(r.id)}" aria-label="刪除收藏"`)}</span></div>`).join('') + '</div>'
        : empty('把喜歡的對白留在這裡', '在聽取裡點愛心，就能把生成過的臺詞收藏起來。', 'heart');
    } else {
      const used = library?.limit ? Math.min(100, cache.bytes / library.limit * 100) : 0, fav = library?.limit ? Math.min(100, library.bytes / library.limit * 100) : 0;
      body = `<div class="group pad"><strong>本機音訊</strong><div class="storage-meter"><i style="width:${fav}%;background:var(--pink)"></i><i style="width:${used}%;background:var(--accent)"></i></div>
          <div class="legend"><span style="--c:var(--pink)">收藏與資料 ${library ? size(library.bytes) : '無法讀取'}</span><span style="--c:var(--accent)">快取 ${cache.available ? cache.count + ' 段 · ' + size(cache.bytes) : '不可用'}</span></div></div>`
        + (shown.length
          ? '<div class="group">' + shown.map(r => { const line = r.metadata?.line || {}; return `<div class="audio-row" data-engine="${esc(r.metadata?.route?.engine || 'none')}"><span class="disc">${icon('wave')}</span><div><p>${esc(line.translation ? '“' + line.translation + '”' : '早期快取的音訊')}</p><small>${esc(line.role || '未知角色')} · ${size(r.bytes)}</small></div><span class="row-tools">${btn('download-cache', icon('download'), 'text-button', `data-id="${esc(r.key)}" aria-label="下載到本地"`)}${btn('favorite-cache', icon('heart'), 'text-button', `data-id="${esc(r.key)}" aria-label="收藏"`)}${btn('delete-cache', icon('trash'), 'text-button', `data-id="${esc(r.key)}" aria-label="清理"`)}</span></div>`; }).join('') + '</div>'
          : empty('還沒有音訊快取', '點聊天裡的聲波生成過的臺詞會暫存在這裡。'))
        + `<div class="actions">${btn('clear-cache', icon('trash') + '清理全部快取', 'danger')}</div><p class="hint">收藏和快取分開儲存，清理快取不會刪掉收藏。</p>`;
    }
    v.draw(heading('音訊收藏', '', 'Voice Library') + tabs + filters + body);
  }
  v.refresh = render;
  v.on('click', '[data-action]', async el => {
    const id = el.dataset.id;
    switch (el.dataset.action) {
      case 'tab': tab = el.dataset.tab; role = ''; await render(); break;
      case 'role': role = el.dataset.role; await render(); break;
      case 'play-favorite': await api.playFavorite(id); break;
      case 'download-favorite': await v.busy(el, () => saveAs(ctx, api.audioFile({favorite: id}))); break;
      case 'download-cache': await v.busy(el, () => saveAs(ctx, api.audioFile({key: id}))); break;
      case 'favorite-cache': await v.busy(el, () => api.favoriteAudio(id)); ctx.notify('已加入收藏'); break;
      case 'delete-cache': if (await ctx.confirm('清理這段快取？')) { await api.deleteAudio(id); await render(); } break;
      case 'delete-favorite': if (await ctx.confirm('刪除這段收藏？')) { await api.deleteFavorite(id); await render(); } break;
      case 'clear-cache':
        if (await ctx.confirm('清理語音快取？', '正在播放的音訊會停止，收藏和其他資料會保留。')) { await v.busy(el, () => api.clearCache()); await render(); ctx.notify('語音快取已清理'); }
        break;
    }
  });
  render().catch(e => ctx.notify(e.message));
  return v;
}

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
    v.draw(heading('相簿', importButton, `Album · ${rows.length}`) + (rows.length
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
    v.draw(heading('備忘錄', btn('add-note', icon('add'), 'round-button', 'aria-label="新增備忘錄"'), `Memo · ${rows.length}`) + (rows.length
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

export function listenApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'listen');
  let latest = {id: -1, lines: []}, epoch = 0, playbackRevision = 0, currentIndex = -1;
  const ACTIVE = ['playing', 'paused', 'generating', 'waiting'];
  const indexOf = state => state.source !== 'dialogue' || !state.line ? -1 : latest.lines.findIndex((l, i) => l.role === state.line.role && l.text === state.line.text && (state.line.uiIndex === undefined || state.line.uiIndex === i));

  async function render() {
    const ticket = ++epoch;
    latest = api.latest();
    v.draw(heading('聽取', btn('refresh', icon('refresh') + '重新整理', 'chip-button'), 'Now Playing')
      + `<div class="listen-stage"><div class="portrait"><span class="ring"></span><span class="ring"></span>${halo()}<span data-portrait></span></div><span class="chip emotion" data-emotion hidden></span><div class="visualizer" aria-hidden="true">${'<i></i>'.repeat(32)}</div></div>
        <div class="dialogue-box"><span class="plate" data-speaker-plate><span></span></span><span class="dialogue-engine" data-engine-label></span><p class="play-caption" data-playback-line aria-live="polite"></p><div class="dialogue-foot"><span data-playback-message></span><svg viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><path d="M1 3h12L7 12z"/></svg></div></div>
        <div class="actions" data-waiting hidden>${btn('configure', icon('mic') + '去給這個角色選音色', 'primary')}</div>
        <div class="transport">${btn('favorite', icon('heart'), '', 'aria-label="收藏這一句"')}${btn('download', icon('download'), '', 'aria-label="下載這一句"')}${btn('prev', icon('prev', true), '', 'aria-label="上一句"')}${btn('main-play', icon('play', true), 'main-play', 'aria-label="播放"')}${btn('next', icon('skip', true), '', 'aria-label="下一句"')}${btn('stop', icon('stop', true), '', 'aria-label="停止"')}</div>
        ${latest.lines.length
          ? groupTitle('本條回覆', `<span class="title-tools">${btn('export-all', icon('download') + '匯出', 'chip-button', 'aria-label="匯出整條：把這條回覆的臺詞拼成一個音訊檔案"')}${btn('play-all', icon('play', true) + '整條播放', 'chip-button')}</span>`)
            + `<div class="group">${latest.lines.map((l, i) => `<div class="dialogue-row" data-row="${i}" data-engine="${ctx.engineOf(l.role)}"><div><small>${esc(l.role)}</small><p>${esc(l.translation)}</p></div>${btn('play-line', wave, 'wave-button', `data-index="${i}" data-state="ungenerated" aria-label="朗讀 ${esc(l.role)} 的臺詞"`)}</div>`).join('')}</div>`
          : empty('等一句真正說出口的話', '回到聊天，點臺詞旁的聲波；最新一條回覆的臺詞會出現在這裡。')}`);
    v.onPlayback(api.status());
    for (let i = 0; i < latest.lines.length; i++) {
      const state = await api.lineState(latest.lines[i]);
      if (v.disposed || ticket !== epoch) return;
      const b = v.root.querySelector(`[data-action=play-line][data-index="${i}"]`);
      if (b && !ACTIVE.includes(b.dataset.state)) b.dataset.state = state;
    }
  }

  v.onPlayback = state => {
    const revision = ++playbackRevision, on = ACTIVE.includes(state.phase);
    currentIndex = indexOf(state);
    for (const b of v.root.querySelectorAll('[data-action=play-line]')) {
      const i = Number(b.dataset.index), line = latest.lines[i];
      if (!line) continue;
      const row = b.closest('.dialogue-row');
      row?.toggleAttribute('data-current', i === currentIndex && on);
      if (i === currentIndex && on) b.dataset.state = state.phase;
      else api.lineState(line).then(value => { if (!v.disposed && revision === playbackRevision && b.isConnected) b.dataset.state = value; });
    }
    const speaker = on || state.line ? state.speaker || state.line?.role || '' : '';
    const engine = speaker ? ctx.engineOf(speaker) : 'none';
    v.root.dataset.engine = engine;
    v.root.dataset.phase = state.phase;
    const q = s => v.root.querySelector(s);
    if (q('[data-portrait]')) q('[data-portrait]').outerHTML = `<span data-portrait>${avatar(speaker || '聽', engine, 106)}</span>`;
    if (q('[data-speaker-plate] span')) q('[data-speaker-plate] span').textContent = speaker || '聽取';
    if (q('[data-engine-label]')) q('[data-engine-label]').textContent = engine === 'none' ? (speaker ? '未配置' : '') : engines[engine];
    if (q('[data-playback-line]')) q('[data-playback-line]').textContent = state.line?.translation ? '“' + state.line.translation + '”' : '點下面的臺詞，或者按整條播放。';
    if (q('[data-playback-message]')) q('[data-playback-message]').textContent = state.message || (currentIndex >= 0 ? `${currentIndex + 1} / ${latest.lines.length}` : '等待播放');
    const emotion = q('[data-emotion]');
    if (emotion) { emotion.hidden = !state.line?.emotion; emotion.textContent = state.line?.emotion || ''; }
    if (q('[data-waiting]')) q('[data-waiting]').hidden = state.phase !== 'waiting';
    const main = q('[data-action=main-play]');
    if (main) { main.innerHTML = icon(state.phase === 'playing' ? 'pause' : 'play', true); main.setAttribute('aria-label', state.phase === 'playing' ? '暫停' : '播放'); }
    const favorite = q('[data-action=favorite]');
    if (favorite) favorite.disabled = !api.latestAudio();
    const download = q('[data-action=download]');
    if (download) download.disabled = !api.latestAudio();
    const stop = q('[data-action=stop]');
    if (stop) stop.disabled = state.phase === 'idle';
    const prev = q('[data-action=prev]'), next = q('[data-action=next]');
    if (prev) prev.disabled = currentIndex <= 0;
    if (next) next.disabled = !latest.lines.length || currentIndex >= latest.lines.length - 1;
  };
  v.refresh = render;

  // The latest reply as one audio file, from the lines already generated (no new requests, no quota).
  async function exportReply() {
    const now = api.latest();
    if (!now.lines.length) throw Error('最新的回覆裡沒有臺詞');
    const found = [], missing = [];
    for (const line of now.lines) {
      try { found.push((await api.audioFile({line})).blob); }
      catch (error) { if (/还没有生成/.test(error.message)) missing.push(line); else throw error; }
    }
    if (!found.length) throw Error('這條回覆的臺詞都還沒生成語音：先點「整條播放」，生成完再匯出');
    if (missing.length && !await ctx.confirm(`有 ${missing.length} 句還沒生成`, `只匯出已經生成的 ${found.length} 句？想要完整的話，先點「整條播放」把每句都生成一遍，再匯出。`)) return;
    const clips = [];
    for (const blob of found) clips.push(await decodeMono(ctx.win, blob));
    const roles = [...new Set(now.lines.map(l => l.role))].join('、');
    const name = await saveFile(ctx.doc, encodeWav(joinClips(clips), JOIN_RATE), `回覆 #${now.id} · ${roles}`);
    ctx.notify(`已下載 ${name}（${found.length} 句）`);
  }
  function play(index) {
    const now = api.latest();
    if (JSON.stringify(now) !== JSON.stringify(latest)) { render().catch(e => ctx.notify(e.message)); ctx.notify('聊天內容已變化，請重新選擇臺詞'); return; }
    api.play(latest.id, index);
  }
  v.on('click', '[data-action]', async el => {
    switch (el.dataset.action) {
      case 'refresh': await render(); break;
      case 'play-all': play(); break;
      case 'export-all': await v.busy(el, exportReply); break;
      case 'play-line': play(Number(el.dataset.index)); break;
      case 'main-play': {
        const phase = api.status().phase;
        if (['playing', 'paused', 'generating'].includes(phase)) api.toggle();
        else if (latest.lines.length) play(currentIndex > 0 ? currentIndex : undefined);
        break;
      }
      case 'prev': if (currentIndex > 0) play(currentIndex - 1); break;
      case 'next': play(currentIndex + 1); break;
      case 'stop': api.stop(); break;
      case 'configure': { const name = api.pendingRole(); if (name) ctx.openPendingRole(name); break; }
      case 'download': {
        const audio = api.latestAudio();
        if (!audio) throw Error('先生成一句臺詞再下載');
        await v.busy(el, () => saveAs(ctx, api.audioFile({key: audio.key})));
        break;
      }
      case 'favorite': {
        const audio = api.latestAudio();
        if (!audio) throw Error('先生成一句臺詞再收藏');
        await v.busy(el, () => api.favoriteAudio(audio.key));
        ctx.notify('已加入收藏');
        break;
      }
    }
  });
  render().catch(e => ctx.notify(e.message));
  return v;
}
