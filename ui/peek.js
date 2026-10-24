// 查手机: pick a contact and look into their phone — their chats with other people, searches, notes and album, made up
// by the model (host-apps.js) from who they are and what has happened. One snapshot per contact; looking again replaces it.
import {createView, esc, btn, heading, avatar, empty, help} from './common.js';
import {icon} from './icons.js';
import {openImageViewer} from '../image-viewer.js';

const TABS = [['chats', '聊天'], ['searches', '搜尋'], ['notes', '備忘錄'], ['photos', '相簿']];
function ago(at) {
  const s = (Date.now() - at) / 1000;
  if (s < 3600) return s < 60 ? '剛剛' : `${Math.floor(s / 60)} 分鐘前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小時前`;
  const d = new Date(at);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function peekApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'peek');
  let who = '', tab = 'chats', epoch = 0;
  const busy = () => api.peekBusy?.();
  const face = (name, size) => avatar(name, ctx.engineOf(name), size);

  async function renderList(ticket) {
    const [contacts, peeks] = await Promise.all([api.chatContacts?.() || [], api.listPeeks()]);
    if (v.disposed || ticket !== epoch) return;
    const seen = new Map(peeks.map(p => [p.name, p]));
    v.draw(heading('觀心鏡', help('能看到 TA 和別人的聊天、搜尋記錄、備忘錄、相簿。內容由模型按人設、世界書和劇情編出來，看一次呼叫一次模型。'), 'Peek')
      + `<p class="hint">選一個人，偷看 TA 的傳音玉符。</p>`
      + (contacts.length ? `<div class="peek-people">${contacts.map(c => `<button type="button" class="peek-person" data-action="peek-open" data-name="${esc(c.name)}">${face(c.name, 52)}<b>${esc(c.name)}</b><small>${seen.has(c.name) ? '看過 · ' + ago(seen.get(c.name).at) : '還沒看過'}</small></button>`).join('')}</div>`
        : empty('還沒有聯絡人', '先在角色 App 裡新增角色，或者在聊天裡新增聯絡人。', 'person')));
  }
  function section(s) {
    if (tab === 'chats') return s.chats.length ? s.chats.map(c => `<details class="peek-chat"><summary>${face(c.with, 34)}<span class="row-text"><strong>${esc(c.with)}</strong><small>${esc(c.lines.at(-1)?.text || '')}</small></span></summary>
        <div class="peek-bubbles">${c.lines.map(l => `<p class="peek-line${l.from === s.name ? ' own' : ''}"><span>${esc(l.text)}</span></p>`).join('')}</div></details>`).join('') : '<p class="hint">沒有聊天記錄。</p>';
    if (tab === 'searches') return s.searches.length ? `<div class="group">${s.searches.map(q => `<div class="setting-row peek-search">${icon('search')}<span>${esc(q)}</span></div>`).join('')}</div>` : '<p class="hint">沒有搜尋記錄。</p>';
    if (tab === 'notes') return s.notes.length ? `<div class="peek-notes">${s.notes.map(n => `<div class="note-card peek-note">${n.title ? `<strong>${esc(n.title)}</strong>` : ''}<span>${esc(n.text)}</span></div>`).join('')}</div>` : '<p class="hint">備忘錄是空的。</p>';
    if (!s.photos.length) return '<p class="hint">相簿裡沒有照片。</p>';
    const nai = api.drawReady(), drawable = s.photos.some(p => p.tags && !p.photoId);
    const tile = (p, i) => {
      if (p.photoId) return `<figure class="peek-photo"><button type="button" class="peek-pic" data-action="peek-view" data-index="${i}" aria-label="檢視照片"><img data-photo="${esc(p.photoId)}" alt="${esc(p.text)}"></button><figcaption>${esc(p.text)}</figcaption></figure>`;
      const action = !nai || !p.tags ? '' : p.state === 'waiting' ? '<small class="peek-draw">正在畫……</small>'
        : `<button type="button" class="peek-draw" data-action="peek-draw" data-index="${i}">${esc(p.state === 'failed' ? (p.note || '沒畫出來') + ' · 重畫' : '畫出來')}</button>`;
      return `<figure class="peek-photo" style="--h:${(i * 47) % 360}"><span>${icon('image')}</span><figcaption>${esc(p.text)}</figcaption>${action}</figure>`;
    };
    return `${nai && drawable ? `<div class="actions" style="margin-top:0">${btn('peek-draw-all', icon('image') + '全部畫出來', 'secondary')}</div>` : ''}<div class="peek-photos">${s.photos.map(tile).join('')}</div>`;
  }
  async function renderPerson(ticket) {
    const s = await api.getPeek(who);
    if (v.disposed || ticket !== epoch) return;
    const working = busy();
    if (!s) {
      v.draw(heading(`${who} 的傳音玉符`, '', 'Peek') + `<div class="peek-lock">${face(who, 72)}<p>${esc(who)} 的傳音玉符就放在桌上……</p>
        ${btn('peek-look', working ? '正在偷看……' : icon('eye') + '拿起來看看', 'primary', working ? 'disabled' : '')}</div>`);
      return;
    }
    const counts = {chats: s.chats.length, searches: s.searches.length, notes: s.notes.length, photos: s.photos.length};
    v.draw(heading(`${who} 的傳音玉符`, btn('peek-look', icon('refresh'), 'round-button', `aria-label="再看一次" ${working ? 'disabled' : ''}`), `Peek · ${ago(s.at)}`)
      + (working ? '<p class="moments-busy" role="status">正在偷看……</p>' : '')
      + `<div class="segmented peek-tabs">${TABS.map(([k, l]) => `<button type="button" data-action="peek-tab" data-tab="${k}" aria-pressed="${k === tab}">${l}${counts[k] ? ` <small>${counts[k]}</small>` : ''}</button>`).join('')}</div>`
      + `<div class="peek-section">${section(s)}</div>`
      + `<div class="actions">${btn('peek-forget', icon('trash') + '忘掉看到的', 'text-button')}</div>`);
  }
  const urls = new Map();
  async function urlFor(id) {
    if (urls.has(id)) return urls.get(id);
    const photo = await api.getPhoto(id), url = photo ? ctx.win.URL.createObjectURL(photo.blob) : '';
    urls.set(id, url);
    return url;
  }
  async function render() {
    const ticket = ++epoch;
    await (who ? renderPerson(ticket) : renderList(ticket));
    for (const img of v.root.querySelectorAll('img[data-photo]')) { const url = await urlFor(img.dataset.photo); if (ticket !== epoch) return; if (url) img.src = url; }
  }
  /** Draws album photos one after another (the drawing queue spaces them); asks first when one would cost Anlas. */
  async function draw(indexes) {
    for (const index of indexes) {
      try { await api.peekDraw(who, index, false); }
      catch (error) {
        if (error.code !== 'PAID' && !/扣 Anlas|花钱/.test(error.message)) { ctx.notify(error.message, {error: true}); continue; }
        const ask = api.paidPrompt();
        if (await ctx.confirm(ask.title, ask.text)) await api.peekDraw(who, index, true).catch(e => ctx.notify(e.message, {error: true}));
        else break;
      }
    }
    await render();
  }

  function look() {
    const job = api.peekLook(who);
    render();
    job.then(() => ctx.notify(`看到了 ${who} 手機裡的東西`)).catch(error => ctx.notify(error.message, {error: true})).finally(() => render());
  }
  v.back = () => { if (!who) return false; who = ''; render(); return true; };
  v.refresh = () => render();
  v.on('click', '[data-action]', async el => {
    switch (el.dataset.action) {
      case 'peek-open': who = el.dataset.name; tab = 'chats'; await render(); v.root.scrollTop = 0; break;
      case 'peek-tab': tab = el.dataset.tab; await render(); break;
      case 'peek-look': {
        if (await api.getPeek(who) && !await ctx.confirm('再看一次？', `會重新編一份 ${who} 手機裡的內容，現在看到的會被換掉。會呼叫一次模型。`)) break;
        look(); break;
      }
      case 'peek-draw': draw([Number(el.dataset.index)]); break;
      case 'peek-draw-all': { const snap = await api.getPeek(who); draw(snap.photos.map((p, i) => p.tags && !p.photoId ? i : -1).filter(i => i >= 0)); break; }
      case 'peek-view': {
        const img = el.querySelector('img');
        if (img?.src) openImageViewer({doc: ctx.doc, src: img.src, alt: img.alt, from: img});
        break;
      }
      case 'peek-forget': if (await ctx.confirm('忘掉看到的？', `${who} 手機裡的這些內容會刪掉。`)) { await api.deletePeek(who); await render(); } break;
    }
  });
  render().catch(error => ctx.notify(error.message));
  return v;
}
