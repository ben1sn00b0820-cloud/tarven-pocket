/** Additional phone apps. Data and generation stay behind the host bridge. */
import {createView, esc, btn, heading, field, input, textArea, avatar, empty} from '../ui/common.js';
import {icon} from '../ui/icons.js';
import {safePhotoUrl} from '../core/photo-url.js';
import {openImageViewer} from '../image-viewer.js';

const rows = value => Array.isArray(value) ? value : [];
const stamp = value => {
  const d = new Date(value || Date.now());
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('zh-TW', {month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'});
};
const money = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('zh-TW', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '—';
const tabs = (selected, choices) => `<div class="segmented pocket-tabs" role="group" aria-label="切換頁面">${choices.map(([id, label]) => `<button type="button" data-action="tab" data-tab="${esc(id)}" aria-pressed="${selected === id}">${esc(label)}</button>`).join('')}</div>`;
const order = items => [...rows(items)].sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
const person = (value, state) => value === 'me' || value === '{{user}}' ? state.userName || '我' : value || '角色';
const own = (value, state) => value === 'me' || value === '{{user}}' || value === state.userName;
const face = (name, state, size = 36) => avatar(person(name, state), 'none', size, own(name, state) ? 'me' : name);
const pluralNames = values => [...new Set(values.filter(Boolean).map(String))];
const imageUrl = safePhotoUrl;
function picture(value, caption = '', photoId = '', loaded = false) {
  if (photoId) return `<button type="button" class="pocket-ig-picture" data-action="ig-image" aria-label="查看圖片"><img data-pocket-photo="${esc(photoId)}" alt="${esc(caption || '貼文圖片')}" loading="lazy" decoding="async"></button>`;
  const url = imageUrl(value);
  if (!url) return '';
  if (!loaded) return `<button type="button" class="pocket-image-placeholder" data-action="ig-load-image" data-image="${esc(url)}">${icon('image')}<span>查看外部圖片<small>點擊後連線到圖片來源</small></span></button>`;
  return `<button type="button" class="pocket-ig-picture" data-action="ig-image" aria-label="查看圖片"><img src="${esc(url)}" alt="${esc(caption || '貼文圖片')}" loading="lazy" decoding="async" referrerpolicy="no-referrer"></button>`;
}

function appShell(ctx, name) {
  const v = createView(ctx, name);
  v.root.classList.add('pocket-app');
  let running = false;
  const banner = () => running ? '<p class="pocket-working" role="status"><span></span>正在處理，請稍候…</p>' : '';
  async function run(button, action, success = '') {
    if (running) return;
    running = true;
    v.root.setAttribute('aria-busy', 'true');
    button?.setAttribute('disabled', '');
    const status = ctx.doc.createElement('p');
    status.className = 'pocket-working'; status.setAttribute('role', 'status'); status.textContent = '正在處理，請稍候…';
    if (!v.root.querySelector('.pocket-working')) v.root.prepend(status);
    try {
      await action();
      if (success) ctx.notify(success);
    } finally {
      running = false;
      v.root.removeAttribute('aria-busy');
      status.remove();
      if (button?.isConnected) button.removeAttribute('disabled');
      if (!v.disposed) await v.refresh();
    }
  }
  return {v, run, banner, busy: () => running};
}

export function instagramApp(ctx) {
  const {api} = ctx, {v, run, banner} = appShell(ctx, 'instagram');
  let state = {}, tab = 'feed', epoch = 0, recipient = '', publisher = '', postDraft = '', dmDraft = '', postPicture = null, dmPicture = null, publishKind = 'post', readingStory = '', storyReply = '', showArchive = false;
  const photoUrls = new Map(), loadedImages = new Set();
  const comments = new Map();
  const hasLiked = post => rows(post.likes).some(name => own(typeof name === 'string' ? name : name?.from, state));
  const imageOf = p => picture(p.image, p.text, p.photoId, loadedImages.has(p.image));
  const attach = (target, item) => `<div class="pocket-attach"><label class="chip-button file-button">${icon('image')}附上照片<input type="file" data-ig-photo="${target}" accept="image/png,image/jpeg,image/webp,image/avif,image/gif" aria-label="${target === 'post' ? '貼文或限時動態' : '私訊'}附上照片"></label>${item ? `<span>${esc(item.name)} <button type="button" data-action="ig-remove-photo" data-target="${target}" aria-label="移除附圖">${icon('close')}</button></span>` : ''}</div>`;
  const accounts = () => rows(state.instagram?.accounts);
  const stories = () => order(state.instagram?.stories);
  const roleAccounts = () => accounts().filter(a => !a.isUser && !own(a.name, state));
  function storyRail() {
    const active = accounts().filter(a => a.activeStories > 0);
    return `<div class="tp-ig-stories" aria-label="限時動態"><button type="button" class="tp-ig-story-dot mine" data-action="ig-story-compose"><span>${face('me', state, 48)}<b>＋</b></span><small>你的限時動態</small></button>${active.map(a => `<button type="button" class="tp-ig-story-dot" data-action="ig-story-person" data-name="${esc(a.name)}"><span>${face(a.name, state, 48)}</span><small>${esc(a.name)}</small></button>`).join('')}</div>`;
  }
  function roleControls() {
    const roles = roleAccounts();
    return `<div class="tp-ig-publisher"><div><span class="eyebrow">角色帳號</span><strong>讓故事裡的人分享近況</strong></div>${roles.length ? `<label class="field"><span>選擇發文角色</span><select data-field="ig-publisher" aria-label="選擇發文角色">${roles.map(a => `<option value="${esc(a.name)}" ${a.name === publisher ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label><div class="tp-ig-role-actions">${btn('ig-generate', icon('wand') + '角色發貼文', 'secondary')}${btn('ig-story-generate', icon('add') + '角色發限動', 'secondary')}</div><small>依角色、正文與手機接入的世界書生成</small>` : '<p>在正文或微信出現角色後，這裡會自動建立帳號。</p>'}</div>`;
  }
  async function fillPhotos(ticket) {
    const ids = new Set([...v.root.querySelectorAll('[data-pocket-photo]')].map(el => el.dataset.pocketPhoto));
    for (const [id, url] of photoUrls) if (!ids.has(id)) { ctx.win.URL.revokeObjectURL(url); photoUrls.delete(id); }
    for (const id of ids) {
      if (!photoUrls.has(id)) { const photo = await api.getPhoto(id); if (v.disposed || ticket !== epoch) return; if (photo?.blob) photoUrls.set(id, ctx.win.URL.createObjectURL(photo.blob)); }
      for (const img of v.root.querySelectorAll('[data-pocket-photo]')) if (img.dataset.pocketPhoto === id && photoUrls.has(id)) img.src = photoUrls.get(id);
    }
  }
  function feed() {
    const posts = order(state.instagram?.posts);
    return storyRail() + `<div class="pocket-compose pocket-ig-compose"><div class="pocket-person">${face('me', state)}<div><strong>${esc(state.userName || '我')}</strong><small>分享這一刻</small></div></div>
      <div class="tp-ig-compose-kind" role="group" aria-label="發布類型"><button type="button" data-action="ig-kind" data-kind="post" aria-pressed="${publishKind === 'post'}">貼文</button><button type="button" data-action="ig-kind" data-kind="story" aria-pressed="${publishKind === 'story'}">限時動態 · 24 小時</button></div>
      ${textArea('post-text', postDraft, 'rows="3" maxlength="4000" placeholder="今天有什麼想分享的？"')}${attach('post', postPicture)}
      <div class="pocket-compose-actions"><small>${publishKind === 'story' ? '到期後保存在限動封存' : '正文與手機同步顯示'}</small>${btn('ig-post', publishKind === 'story' ? '發布限時動態' : '發布動態', 'primary')}</div></div>` + roleControls() + `
      ${posts.length ? `<div class="pocket-feed">${posts.map(post => `<article class="pocket-post">
        <div class="pocket-person">${face(post.from, state)}<div><strong>${esc(person(post.from, state))}</strong><small>${esc(stamp(post.at))}</small></div><span class="pocket-network">Instagram</span></div>
        ${imageOf(post)}<p class="pocket-post-text">${esc(post.text)}</p>
        <div class="pocket-post-tools"><button type="button" data-action="ig-like" data-id="${esc(post.id)}" aria-label="${hasLiked(post) ? '取消讚' : '讚'}" aria-pressed="${hasLiked(post)}">${icon('heart')}<span>${rows(post.likes).length || '喜歡'}</span></button><span>${rows(post.comments).length} 則留言</span></div>
        ${rows(post.comments).length ? `<div class="pocket-comments">${rows(post.comments).map(c => `<p><b>${esc(person(c.from, state))}</b><span>${esc(c.text)}</span></p>`).join('')}</div>` : ''}
        <div class="pocket-inline-compose"><input type="text" data-comment="${esc(post.id)}" value="${esc(comments.get(post.id) || '')}" maxlength="2000" placeholder="留下回應…" aria-label="回應 ${esc(person(post.from, state))} 的動態"><button type="button" data-action="ig-comment" data-id="${esc(post.id)}" aria-label="送出留言">${icon('send')}</button></div>
      </article>`).join('')}</div>` : empty('第一則動態，從此刻開始', '自己發布，或讓角色根據目前劇情發一則動態。', 'heart')}`;
  }
  function direct() {
    const dms = rows(state.instagram?.dms);
    const contacts = pluralNames([state.characterName, recipient, ...roleAccounts().map(a => a.name), ...dms.filter(m => own(m.from, state) || own(m.to, state)).map(m => own(m.from, state) ? m.to : m.from)]).filter(n => !own(n, state));
    const current = recipient || state.characterName || contacts[0] || '';
    if (!recipient && current) recipient = current;
    const history = dms.filter(m => (own(m.from, state) && m.to === current) || (m.from === current && own(m.to, state))).sort((a, b) => Number(a.at) - Number(b.at));
    return `<div class="pocket-recipient">${field('私訊對象', input('recipient', recipient, 'text', 'maxlength="80" placeholder="輸入角色名字"'))}
      ${contacts.length ? `<div class="pocket-contactchips">${contacts.map(name => `<button type="button" data-action="ig-person" data-name="${esc(name)}" aria-pressed="${name === current}">${face(name, state, 26)}<span>${esc(name)}</span></button>`).join('')}</div>` : ''}</div>
      <div class="pocket-dm-history" data-keep-scroll="ig-dms" aria-live="polite">${history.length ? history.map(m => `<div class="pocket-dm ${own(m.from, state) ? 'mine' : ''}"><small>${esc(person(m.from, state))} · ${esc(stamp(m.at))}</small>${m.storyId ? '<span class="tp-ig-reply-tag">回覆限時動態</span>' : ''}<p>${esc(m.text)}${imageOf(m)}</p></div>`).join('') : `<div class="pocket-soft-empty">${icon('chat')}<p>向 ${esc(current || '角色')} 說聲嗨</p><small>Instagram 私訊與微信聊天分開保存</small></div>`}</div>
      <div class="pocket-compose pocket-dm-compose">${textArea('dm-text', dmDraft, 'rows="3" maxlength="4000" placeholder="傳送私訊…"')}${attach('dm', dmPicture)}
        <div class="pocket-compose-actions">${btn('ig-reply', '請角色回覆', 'secondary')}${btn('ig-dm', '傳送', 'primary')}</div></div>`;
  }
  function storyList() {
    const items = stories().filter(s => showArchive ? s.expired : !s.expired);
    return storyRail() + `<div class="tp-ig-section-head"><div><h2>${showArchive ? '限動封存' : '限時動態'}</h2><p>${showArchive ? '已到期的片刻仍會保留' : '分享的片刻，24 小時後移入封存'}</p></div>${btn('ig-story-archive', showArchive ? '看最新限動' : '查看封存', 'text-button')}</div>` + roleControls() + (items.length ? `<div class="tp-ig-story-grid">${items.map((s, i) => `<button type="button" class="tp-ig-story-tile tone-${i % 4}" data-action="ig-story-open" data-id="${esc(s.id)}"><span class="tp-ig-story-owner">${face(s.from, state, 30)}<b>${esc(person(s.from, state))}</b></span><span class="tp-ig-story-excerpt">${esc(s.text || '分享了一張照片')}</span><small>${esc(stamp(s.at))}${s.image || s.photoId ? ' · 附有照片' : ''}</small></button>`).join('')}</div>` : empty(showArchive ? '還沒有封存的限時動態' : '此刻還沒有新的限時動態', '你可以自己發布，也能選擇角色分享劇情裡的片刻。', 'image'));
  }
  function accountList() {
    return `<div class="tp-ig-section-head"><div><h2>故事裡的帳號</h2><p>從當前對話、聯絡人與角色狀態自動抓取</p></div></div><div class="tp-ig-accounts">${accounts().map(a => `<article class="tp-ig-account"><div class="pocket-person">${face(a.name, state, 46)}<div><strong>${esc(a.name)}</strong><small>${a.isUser ? '你的帳號' : '角色帳號'}</small></div></div>${a.bio ? `<p>${esc(a.bio)}</p>` : ''}<div class="tp-ig-account-stats"><span><b>${a.postCount}</b> 貼文</span><span><b>${a.activeStories}</b> 則限動</span></div>${!a.isUser ? `<div class="tp-ig-role-actions">${btn('ig-account-publisher', '選為發文角色', 'secondary', `data-name="${esc(a.name)}"`)}${btn('ig-account-dm', '傳送私訊', 'text-button', `data-name="${esc(a.name)}"`)}</div>` : ''}</article>`).join('')}</div>`;
  }
  function storyView() {
    const items = stories(), current = items.find(s => s.id === readingStory);
    if (!current) { readingStory = ''; return storyList(); }
    const visibleReplies = rows(current.replies).filter(m => own(m.from, state) || own(m.to, state));
    return `<div class="tp-ig-story-top">${btn('ig-story-close', '返回', 'text-button')}<span>${current.expired ? '限動封存' : '限時動態'}</span><div>${btn('ig-story-prev', icon('back'), 'text-button', 'aria-label="上一則限時動態"')}${btn('ig-story-next', icon('next'), 'text-button', 'aria-label="下一則限時動態"')}</div></div><article class="tp-ig-story-view"><div class="pocket-person">${face(current.from, state, 38)}<div><strong>${esc(person(current.from, state))}</strong><small>${esc(stamp(current.at))}</small></div></div>${imageOf(current)}<div class="tp-ig-story-copy">${esc(current.text || '分享了一張照片')}</div><small class="tp-ig-story-expiry">${current.expired ? '已封存' : '到期時間 ' + esc(stamp(current.expiresAt))}</small></article>${visibleReplies.length ? `<div class="pocket-comments tp-ig-story-replies">${visibleReplies.map(m => `<p><b>${esc(person(m.from, state))}</b><span>${esc(m.text)}</span></p>`).join('')}</div>` : ''}${!own(current.from, state) ? `<div class="pocket-compose"><label class="field"><span>回覆這則限時動態</span>${textArea('story-reply', storyReply, 'maxlength="4000" rows="3" placeholder="傳送一則回覆…"')}</label><div class="pocket-compose-actions"><small>會同步到與 ${esc(current.from)} 的私訊</small>${btn('ig-story-reply', '傳送回覆', 'primary', `data-id="${esc(current.id)}"`)}</div></div>` : ''}`;
  }
  async function render() {
    const ticket = ++epoch, next = await api.pocketState();
    if (v.disposed || ticket !== epoch) return;
    if (state.scope !== undefined && state.scope !== next.scope) { recipient = ''; publisher = ''; postDraft = ''; dmDraft = ''; postPicture = null; dmPicture = null; readingStory = ''; storyReply = ''; showArchive = false; publishKind = 'post'; tab = 'feed'; comments.clear(); loadedImages.clear(); }
    state = next;
    if (!roleAccounts().some(a => a.name === publisher)) publisher = roleAccounts().find(a => a.name === state.characterName)?.name || roleAccounts()[0]?.name || '';
    if (readingStory && !stories().some(s => s.id === readingStory)) { readingStory = ''; storyReply = ''; }
    v.draw(heading('Instagram', '', '故事裡的每一刻') + tabs(tab, [['feed', '動態'], ['stories', '限動'], ['dm', '私訊'], ['accounts', '帳號']]) + banner() + (readingStory ? storyView() : tab === 'feed' ? feed() : tab === 'stories' ? storyList() : tab === 'accounts' ? accountList() : direct()));
    await fillPhotos(ticket);
  }
  v.refresh = render;
  const dispose = v.dispose;
  v.dispose = () => { epoch++; for (const url of photoUrls.values()) ctx.win.URL.revokeObjectURL(url); photoUrls.clear(); dispose(); };
  v.back = () => { if (!readingStory) return false; readingStory = ''; storyReply = ''; render().catch(e => ctx.notify(e.message, {error: true})); return true; };
  v.on('change', '[data-ig-photo]', async el => {
    const file = el.files?.[0], target = el.dataset.igPhoto, scope = state.scope;
    if (!file) return;
    await run(el, async () => { const photo = await api.addPhoto({name: file.name, blob: file}); const live = await api.pocketState(); if (v.disposed || live.scope !== scope || state.scope !== scope) return; const attachment = {photoId: photo.id, name: file.name}; if (target === 'post') postPicture = attachment; else dmPicture = attachment; });
  });
  v.on('input', '[data-field]', el => {
    if (el.dataset.field === 'post-text') postDraft = el.value;
    if (el.dataset.field === 'dm-text') dmDraft = el.value;
    if (el.dataset.field === 'recipient') recipient = el.value;
    if (el.dataset.field === 'story-reply') storyReply = el.value;
  });
  v.on('change', '[data-field="ig-publisher"]', el => { if (roleAccounts().some(a => a.name === el.value)) publisher = el.value; });
  v.on('change', '[data-field="recipient"]', () => render());
  v.on('input', '[data-comment]', el => comments.set(el.dataset.comment, el.value));
  v.on('click', '[data-action]', async el => {
    const id = el.dataset.id;
    switch (el.dataset.action) {
      case 'tab': tab = el.dataset.tab; readingStory = ''; storyReply = ''; await render(); break;
      case 'ig-kind': publishKind = el.dataset.kind === 'story' ? 'story' : 'post'; await render(); break;
      case 'ig-story-compose': publishKind = 'story'; tab = 'feed'; readingStory = ''; await render(); v.root.querySelector('[data-field="post-text"]')?.focus(); break;
      case 'ig-story-archive': showArchive = !showArchive; await render(); break;
      case 'ig-story-person': { const first = stories().find(s => s.from === el.dataset.name && !s.expired); if (first) { readingStory = first.id; storyReply = ''; tab = 'stories'; await render(); } break; }
      case 'ig-story-open': readingStory = id; storyReply = ''; tab = 'stories'; await render(); break;
      case 'ig-story-close': readingStory = ''; storyReply = ''; await render(); break;
      case 'ig-story-prev': case 'ig-story-next': { const items = stories(), index = items.findIndex(s => s.id === readingStory), delta = el.dataset.action === 'ig-story-prev' ? -1 : 1; if (items.length) { readingStory = items[(index + delta + items.length) % items.length].id; storyReply = ''; await render(); } break; }
      case 'ig-account-publisher': publisher = el.dataset.name; tab = 'feed'; await render(); break;
      case 'ig-account-dm': recipient = el.dataset.name; tab = 'dm'; await render(); break;
      case 'ig-remove-photo': if (el.dataset.target === 'post') postPicture = null; else dmPicture = null; await render(); break;
      case 'ig-load-image': if (imageUrl(el.dataset.image)) { loadedImages.add(el.dataset.image); await render(); } break;
      case 'ig-image': { const img = el.querySelector('img'); if (img?.src) openImageViewer({doc: ctx.doc, src: img.src, alt: img.alt, from: img}); break; }
      case 'ig-person': recipient = el.dataset.name; await render(); break;
      case 'ig-post': if (!postDraft.trim() && !postPicture) throw Error('先寫一點內容，或附上一張照片。'); await run(el, async () => { const sent = postDraft, photo = postPicture; await api.pocketAction(publishKind === 'story' ? 'ig.story' : 'ig.post', {text: sent.trim(), ...(photo ? {photoId: photo.photoId} : {})}); if (postDraft === sent) postDraft = ''; if (postPicture === photo) postPicture = null; }, publishKind === 'story' ? '限時動態已發布' : '動態已發布'); break;
      case 'ig-like': await run(el, () => api.pocketAction('ig.like', {id})); break;
      case 'ig-comment': if (!comments.get(id)?.trim()) throw Error('先輸入留言內容。'); await run(el, async () => { const sent = comments.get(id); await api.pocketAction('ig.comment', {id, text: sent.trim()}); if (comments.get(id) === sent) comments.delete(id); }); break;
      case 'ig-generate': if (!publisher) throw Error('先選擇一位發文角色。'); await run(el, () => api.pocketAction('ig.generate', {from: publisher}), '角色動態已更新'); break;
      case 'ig-story-generate': if (!publisher) throw Error('先選擇一位發文角色。'); await run(el, () => api.pocketAction('ig.story.generate', {from: publisher}), '角色限時動態已更新'); break;
      case 'ig-story-reply': if (!storyReply.trim()) throw Error('先輸入回覆內容。'); await run(el, async () => { const sent = storyReply; await api.pocketAction('ig.story.reply', {id, text: sent.trim()}); if (storyReply === sent) storyReply = ''; }, '回覆已傳送至私訊'); break;
      case 'ig-dm': if (!recipient.trim() || (!dmDraft.trim() && !dmPicture)) throw Error('請填寫私訊對象，再輸入內容或附上照片。'); await run(el, async () => { const sent = dmDraft, photo = dmPicture; await api.pocketAction('ig.dm', {to: recipient.trim(), text: sent.trim(), ...(photo ? {photoId: photo.photoId} : {})}); if (dmDraft === sent) dmDraft = ''; if (dmPicture === photo) dmPicture = null; }); break;
      case 'ig-reply': if (!recipient.trim()) throw Error('先選擇一位私訊對象。'); await run(el, () => api.pocketAction('ig.reply', {to: recipient.trim()})); break;
    }
  });
  render().catch(e => ctx.notify(e.message, {error: true}));
  return v;
}
