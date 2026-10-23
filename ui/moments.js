// 动态 (朋友圈) in the chat app: the characters' posts, likes and comments, and the user's own posts and comments.
// New posts, reactions and replies are generated in the tavern page (host-moments.js); this panel only shows them and
// sends what the user does. It draws into the chat app's view, inside the frame the chat app gives it (tabs and all).
import {esc, btn, empty, avatar, field, textArea, input, toggle, help} from './common.js';
import {icon} from './icons.js';
import {openImageViewer} from '../image-viewer.js';
import {downloadAction} from '../download.js';

const SEEN_KEY = 'st-iphonie-moments-seen';
/** When the user last looked at 动态 (per browser; only for the dots). */
export function momentsSeen(win) { try { return Number(win.localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; } }
function markSeen(win) { try { win.localStorage.setItem(SEEN_KEY, String(Date.now())); } catch { /* the dot is only a convenience */ } }
/** Posts and comments by others since the user last looked. */
export const momentsNew = (posts, seen) => posts.reduce((n, p) => n + (p.author !== 'me' && p.at > seen ? 1 : 0) + p.comments.filter(c => c.from !== 'me' && c.at > seen).length, 0);

function ago(at) {
  const s = (Date.now() - at) / 1000;
  if (s < 60) return '剛剛';
  if (s < 3600) return `${Math.floor(s / 60)} 分鐘前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小時前`;
  const d = new Date(at), today = new Date(); today.setHours(0, 0, 0, 0);
  if (at >= today.getTime() - 86400000) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/**
 * v: the chat app's view. frame(html): the page with the chat app's tabs. me(): {name, avatar(size)} for the user.
 * visible(): whether the 动态 tab is on screen (only then does it count as seen).
 */
export function momentsPanel(ctx, {v, frame, me, visible}) {
  const {api} = ctx, urls = new Map();
  let epoch = 0, posts = [], author = '';
  const nameOf = who => who === 'me' ? me().name : who;
  const urlFor = async id => {
    if (urls.has(id)) return urls.get(id);
    const photo = await api.getPhoto(id);
    const url = photo ? ctx.win.URL.createObjectURL(photo.blob) : '';
    urls.set(id, url);
    return url;
  };
  const face = (who, size) => who === 'me' ? me().avatar(size) : avatar(who, ctx.engineOf(who), size);

  function picture(p) {
    if (p.photoId) return `<button type="button" class="moment-photo" data-action="view-photo" data-id="${esc(p.id)}" aria-label="檢視配圖"><img data-photo="${esc(p.photoId)}" alt="${esc(nameOf(p.author))} 的配圖"></button>`;
    if (!p.imageTags) return '';
    if (p.imageState === 'waiting') return '<p class="moment-note">配圖正在畫……</p>';
    // Without a drawing engine set up there is nothing to retry; once it is the note turns into a button again.
    if (p.imageState === 'failed' && /密钥/.test(p.imageNote || '') && !api.drawReady()) return `<p class="moment-note">${esc(p.imageNote)}，這張配圖沒有畫</p>`;
    if (p.imageState === 'failed') return `<button type="button" class="moment-note" data-action="draw-image" data-id="${esc(p.id)}">${esc(p.imageNote || '配圖沒畫出來')} · 點一下重畫</button>`;
    return `<button type="button" class="moment-note" data-action="draw-image" data-id="${esc(p.id)}">這條動態有配圖 · 點一下畫出來</button>`;
  }
  function post(p) {
    const liked = p.likes.includes('me');
    const social = p.likes.length || p.comments.length
      ? `<div class="moment-social">${p.likes.length ? `<p class="moment-likes">${icon('heart', true)}${esc(p.likes.map(nameOf).join('、'))}</p>` : ''}${p.comments.map(c => `<button type="button" class="moment-comment" data-action="${c.from === 'me' ? 'm-my-comment' : 'm-comment'}" data-id="${esc(p.id)}" data-comment="${esc(c.id)}" data-to="${esc(c.from)}"><b>${esc(nameOf(c.from))}</b>${c.to ? ` 回覆 <b>${esc(nameOf(c.to))}</b>` : ''}：${esc(c.text)}</button>`).join('')}</div>`
      : '';
    return `<article class="moment" data-id="${esc(p.id)}"><button type="button" class="moment-av" data-action="m-author" data-name="${esc(p.author)}" aria-label="只看 ${esc(nameOf(p.author))} 的動態">${face(p.author, 42)}</button>
      <div class="moment-body"><strong class="moment-name">${esc(nameOf(p.author))}</strong>${p.text ? `<p class="moment-text">${esc(p.text)}</p>` : ''}${picture(p)}
        <div class="moment-meta"><time>${ago(p.at)}${p.source === 'chat' ? ' · 聊天時發的' : ''}</time><span class="moment-tools">${btn('m-like', icon('heart', liked), 'text-button', `data-id="${esc(p.id)}" aria-pressed="${liked}" aria-label="${liked ? '取消點贊' : '點贊'}"`)}${btn('m-comment', icon('bubble'), 'text-button', `data-id="${esc(p.id)}" aria-label="評論"`)}${btn('m-post-menu', icon('more'), 'text-button', `data-id="${esc(p.id)}" aria-label="更多"`)}</span></div>
        ${social}</div></article>`;
  }

  async function render() {
    const ticket = ++epoch;
    const all = await api.listMoments();
    if (ticket !== epoch || v.disposed) return;
    posts = author ? all.filter(p => p.author === author) : all;
    const busy = api.momentsBusy?.(), who = me();
    const tools = btn('m-refresh', icon('refresh'), 'round-button', `aria-label="重新整理：讓角色發新動態" ${busy ? 'disabled' : ''}`) + btn('m-new', icon('add'), 'round-button', 'aria-label="發動態"') + btn('m-options', icon('sliders'), 'round-button', 'aria-label="動態設定"');
    const scroll = v.root.scrollTop;
    v.draw(frame(`<div class="qzone-cover"><span class="qzone-title">好友動態</span><span class="qzone-tools">${tools}</span><span class="qzone-me">${who.avatar(58)}<strong>${esc(who.name)}</strong></span></div>`
      + (author ? `<div class="banner">${icon('person')}<span>只看 ${esc(nameOf(author))} 的動態</span>${btn('m-all', '看全部', 'chip-button')}</div>` : '')
      + (busy ? '<p class="moments-busy" role="status">朋友們正在刷動態……</p>' : '')
      + (posts.length ? `<div class="moments-feed">${posts.map(post).join('')}</div>`
        : empty(author ? `${nameOf(author)} 還沒有發過動態` : '還沒有動態', author ? '' : '點封面右上角的重新整理，角色們就會發動態；也可以自己先發一條。每次重新整理會呼叫一次酒館當前的模型。', 'image'))));
    v.root.scrollTop = scroll;
    // Seen only when it is on screen: the panel also redraws in the background when new posts arrive.
    if (visible()) { markSeen(ctx.win); ctx.momentsSeen?.(); }
    for (const img of v.root.querySelectorAll('img[data-photo]')) {
      const url = await urlFor(img.dataset.photo);
      if (ticket !== epoch || v.disposed) return;
      if (url) img.src = url; else img.closest('.moment-photo')?.replaceWith(Object.assign(ctx.doc.createElement('p'), {className: 'moment-note', textContent: '配圖已經從相簿刪掉了'}));
    }
  }

  function sheet(title, html, handlers) {
    const d = ctx.dialog(title, html);
    d.body.addEventListener('click', e => {
      const b = e.target.closest('[data-action]');
      if (!b || !handlers[b.dataset.action]) return;
      e.preventDefault();
      ctx.win.Promise.resolve().then(() => handlers[b.dataset.action](b)).catch(error => ctx.notify(error.message, {error: true}));
    });
    return d;
  }
  /** Runs a model request in the background; the panel shows it as busy and redraws when it ends. */
  function background(job, done) {
    if (visible()) render();
    job.then(result => { if (done) ctx.notify(done(result)); }).catch(error => ctx.notify(error.message, {error: true})).finally(() => { if (visible()) render(); });
  }
  const replyOn = () => api.getState().moments.replyToMe !== false;

  async function newPost() {
    const photos = await api.listPhotos();
    let chosen = '';
    const d = sheet('發動態', `${field('這一刻的想法', textArea('text', '', 'rows="4" maxlength="2000" placeholder="寫點什麼…"'))}
      ${photos.length ? `<p class="help-copy">配一張相簿裡的照片（可選）</p><div class="photo-grid pick-photos">${photos.slice(0, 24).map(r => `<button data-action="pick" data-id="${esc(r.id)}" aria-pressed="false" aria-label="選擇 ${esc(r.name)}"><img data-photo="${esc(r.id)}" alt="${esc(r.name)}"></button>`).join('')}</div>` : ''}
      <div class="actions">${btn('send-post', icon('send') + '發表', 'primary')}</div>`, {
      pick: b => { chosen = chosen === b.dataset.id ? '' : b.dataset.id; for (const x of d.body.querySelectorAll('[data-action=pick]')) x.setAttribute('aria-pressed', String(x.dataset.id === chosen)); },
      'send-post': async () => {
        const text = d.body.querySelector('[data-field=text]').value.trim();
        if (!text && !chosen) throw Error('寫點什麼，或者選一張照片');
        const made = await api.postMoment({text, ...(chosen ? {photoId: chosen} : {})});
        d.close();
        if (replyOn() && api.momentsReact) background(api.momentsReact(made.id), () => '朋友們看到了你的動態');
        else render();
      }
    });
    for (const img of d.body.querySelectorAll('img[data-photo]')) urlFor(img.dataset.photo).then(url => { if (url) img.src = url; });
  }
  function commentOn(id, to = '') {
    const reply = to && to !== 'me';
    const d = sheet(reply ? `回覆 ${to}` : '評論', `${field('評論', textArea('text', '', `rows="3" maxlength="500" placeholder="${reply ? '回覆 ' + esc(to) : '說點什麼…'}"`))}<div class="actions">${btn('send-comment', icon('send') + '傳送', 'primary')}</div>`, {
      'send-comment': async () => {
        const text = d.body.querySelector('[data-field=text]').value.trim();
        if (!text) throw Error('寫點什麼再傳送');
        const {comment} = await api.commentMoment(id, {text, ...(reply ? {to} : {})});
        d.close();
        if (replyOn() && api.momentsReply) background(api.momentsReply(id, comment.id));
        else render();
      }
    });
    d.body.querySelector('textarea')?.focus();
  }
  function options() {
    const m = api.getState().moments;
    const d = sheet('動態設定', `<div class="group">${toggle('auto', '角色自己發動態', m.auto, '開啟後，每隔幾條正文回覆，角色們會自己發一次動態（會呼叫一次酒館當前的模型，花費和一次聊天回覆差不多）。')}
        ${field('每幾條正文回覆發一次', input('every', m.every, 'number', 'min="1" max="100" step="1"'))}
        ${field('每天最多自動發幾次', input('dailyMax', m.dailyMax, 'number', 'min="1" max="30" step="1"'))}
        ${toggle('images', '動態配圖', m.images, '有畫面感的動態會用繪圖 App 裡選的引擎畫一張配圖。只自動畫不花錢的（NovelAI 免費檔內、ComfyUI）；會扣 Anlas 或 GPT 要花錢的圖，要你點一下確認。引擎沒配好時只顯示文字。')}
        ${toggle('replyToMe', '角色回覆我', m.replyToMe, '你發動態或評論後，角色會點贊、評論和回覆（每次呼叫一次模型）。')}</div>
      <div class="actions">${btn('edit-prompt', icon('edit') + '編輯聊天預設', 'secondary')}${help('動態怎麼寫，在預設 App 的聊天預設裡：勾了「朋友圈」的規則就用在這裡。')}</div>
      <div class="actions">${btn('clear-moments', icon('trash') + '清空動態', 'danger')}</div>`, {
      'edit-prompt': () => { d.close(); ctx.open('presets'); ctx.showPresetKind?.('chat'); },
      'clear-moments': async () => { if (!await ctx.confirm('清空所有動態？', '所有動態、點贊和評論都會刪除，配圖還留在相簿裡。')) return; d.close(); await api.clearMoments(); await render(); ctx.notify('動態已清空'); }
    });
    d.body.addEventListener('change', e => {
      const el = e.target.closest('[data-field]');
      if (!el) return;
      try { api.saveMoments({[el.dataset.field]: el.type === 'checkbox' ? el.checked : Number(el.value)}); }
      catch (error) { ctx.notify(error.message, {error: true}); }
    });
  }

  /** Handles a click inside the panel; false when it is not the panel's. */
  async function click(el) {
    const id = el.dataset.id, target = posts.find(p => p.id === id);
    switch (el.dataset.action) {
      case 'm-refresh': background(api.momentsRefresh(), made => `${[...new Set(made.map(p => p.author))].join('、')} 發了新動態`); return true;
      case 'm-new': await newPost(); return true;
      case 'm-options': options(); return true;
      case 'm-all': author = ''; await render(); return true;
      case 'm-author': author = el.dataset.name; await render(); return true;
      case 'm-like': if (target) { await api.likeMoment(id, !target.likes.includes('me')); await render(); } return true;
      case 'm-comment': commentOn(id, el.dataset.to || ''); return true;
      case 'm-my-comment': if (await ctx.confirm('刪除這條評論？')) { await api.deleteMomentComment(id, el.dataset.comment); await render(); } return true;
      case 'm-post-menu': if (await ctx.confirm('刪除這條動態？', '點贊和評論會一起刪除，配圖還留在相簿裡。')) { await api.deleteMoment(id); await render(); } return true;
      case 'view-photo': {
        const img = el.querySelector('img');
        if (img?.src && target) openImageViewer({doc: ctx.doc, src: img.src, alt: img.alt, from: img, actions: [downloadAction(ctx.doc, async () => ({source: (await api.getPhoto(target.photoId)).blob, name: `動態 · ${nameOf(target.author)}`}), ctx.notify)]});
        return true;
      }
      case 'draw-image': {
        const paid = /Anlas|花钱/.test(target?.imageNote || ''), ask = api.paidPrompt();
        if (!paid || await ctx.confirm(ask.title, ask.text)) background(api.momentsDrawImage(id, paid));
        return true;
      }
    }
    return false;
  }
  return {
    render, click,
    /** Shows one person's posts (their profile's 「TA 的动态」), or everyone's. */
    only(name = '') { author = name; },
    dispose() { epoch++; for (const url of urls.values()) if (url) ctx.win.URL.revokeObjectURL(url); urls.clear(); }
  };
}
