// 论坛: a public board next to 朋友圈. The feed (热搜 on top, then posts), a post with its replies as floors, and the
// user's own posts and replies. New posts, replies and the 热搜 are generated in the tavern page (host-apps.js).
import {createView, esc, btn, field, input, textArea, heading, avatar, empty} from './common.js';
import {icon} from './icons.js';

function ago(at) {
  const s = (Date.now() - at) / 1000;
  if (s < 60) return '剛剛';
  if (s < 3600) return `${Math.floor(s / 60)} 分鐘前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小時前`;
  const d = new Date(at);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
const count = n => n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + '萬' : String(n);

export function forumApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'forum');
  let open = '', epoch = 0, posts = [];
  const myName = () => api.getState().chat.profile?.name || api.userName?.() || '我';
  const nameOf = who => who === 'me' ? myName() : who;
  const characters = () => new Set((api.chatContacts?.() || []).map(c => c.name));
  const face = (who, size) => who === 'me' ? avatar(myName(), 'none', size, 'me') : avatar(who, ctx.engineOf(who), size);
  const badge = (who, roles) => who === 'me' ? '<span class="forum-tag me">我</span>' : roles.has(who) ? '<span class="forum-tag">角色</span>' : '';
  const busy = () => api.forumBusy?.();

  function card(p, roles) {
    return `<button type="button" class="forum-card" data-action="open-post" data-id="${esc(p.id)}">
      <span class="forum-author">${face(p.author, 28)}<b>${esc(nameOf(p.author))}</b>${badge(p.author, roles)}<time>${ago(p.at)}</time></span>
      ${p.title ? `<strong class="forum-title">${esc(p.title)}</strong>` : ''}<span class="forum-excerpt">${esc(p.text)}</span>
      <span class="forum-meta"><span>${icon('eye')}${count(p.heat)}</span><span>${icon('bubble')}${p.replies.length}</span><span${p.liked ? ' class="on"' : ''}>${icon('heart', p.liked)}${count(p.likes)}</span></span></button>`;
  }
  async function renderList(ticket) {
    const [all, hot] = await Promise.all([api.listForum(), api.forumHot()]);
    if (v.disposed || ticket !== epoch) return;
    posts = all;
    const roles = characters();
    const tools = btn('forum-refresh', icon('refresh'), 'round-button', `aria-label="重新整理：看看論壇上的新帖子" ${busy() ? 'disabled' : ''}`) + btn('forum-new', icon('add'), 'round-button', 'aria-label="發帖"') + btn('forum-options', icon('more'), 'round-button', 'aria-label="論壇設定"');
    v.draw(heading('論壇', tools, `Forum · ${posts.length}`)
      + (hot.length ? `<div class="forum-hot"><strong>${icon('star')}熱搜</strong><ol>${hot.map((t, i) => `<li><span class="rank${i < 3 ? ' top' : ''}">${i + 1}</span>${esc(t)}</li>`).join('')}</ol></div>` : '')
      + (busy() ? '<p class="moments-busy" role="status">論壇正在重新整理……</p>' : '')
      + (posts.length ? `<div class="forum-feed">${posts.map(p => card(p, roles)).join('')}</div>`
        : empty('論壇還沒有帖子', '點右上角的重新整理，角色和路人網友就會發帖、上熱搜；也可以自己先發一個。每次重新整理會呼叫一次模型。', 'bubble')));
  }
  async function renderPost(ticket) {
    const p = await api.getForumPost(open);
    if (v.disposed || ticket !== epoch) return;
    if (!p) { open = ''; return renderList(ticket); }
    const roles = characters();
    v.draw(heading('帖子', '', 'Forum')
      + `<article class="forum-post"><div class="forum-author">${face(p.author, 36)}<b>${esc(nameOf(p.author))}</b>${badge(p.author, roles)}<time>${ago(p.at)}</time></div>
        ${p.title ? `<h3 class="forum-title">${esc(p.title)}</h3>` : ''}<p class="forum-text">${esc(p.text)}</p>
        <div class="forum-meta"><span>${icon('eye')}${count(p.heat)} 熱度</span>${btn('forum-like', icon('heart', p.liked) + count(p.likes), 'text-button' + (p.liked ? ' on' : ''), `aria-pressed="${p.liked}" aria-label="${p.liked ? '取消點贊' : '點贊'}"`)}${btn('forum-reply', icon('bubble') + '回覆', 'text-button', `data-to=""`)}${btn('forum-delete', icon('trash'), 'text-button', 'aria-label="刪除帖子"')}</div></article>`
      + (busy() ? '<p class="moments-busy" role="status">大家正在回覆……</p>' : '')
      + `<div class="forum-floors">${p.replies.map((r, i) => `<button type="button" class="forum-floor" data-action="${r.from === 'me' ? 'forum-my-reply' : 'forum-reply'}" data-to="${esc(r.from)}" data-reply="${esc(r.id)}">
          ${face(r.from, 30)}<span class="floor-body"><span class="floor-head"><b>${esc(nameOf(r.from))}</b>${badge(r.from, roles)}${r.from === p.author ? '<span class="forum-tag op">樓主</span>' : ''}<span class="floor-no">${i + 1}樓</span></span>
          <span class="floor-text">${r.to ? `回覆 <b>${esc(nameOf(r.to))}</b>：` : ''}${esc(r.text)}</span></span></button>`).join('') || '<p class="hint">還沒有回覆。</p>'}</div>`);
  }
  async function render() {
    const ticket = ++epoch;
    return open ? renderPost(ticket) : renderList(ticket);
  }

  /** Runs a model request in the background; the app shows it as busy and redraws when it ends. */
  function background(job, done) {
    render();
    job.then(result => { if (done) ctx.notify(done(result)); }).catch(error => ctx.notify(error.message, {error: true})).finally(() => render());
  }
  function sheet(title, html, action, run) {
    const d = ctx.dialog(title, html);
    d.body.addEventListener('click', e => {
      if (!e.target.closest(`[data-action="${action}"]`)) return;
      e.preventDefault();
      Promise.resolve().then(() => run(d)).catch(error => ctx.notify(error.message, {error: true}));
    });
    d.body.querySelector('input,textarea')?.focus();
    return d;
  }
  function newPost() {
    sheet('發帖', `${field('標題', input('title', '', 'text', 'maxlength="60" placeholder="一句話說清楚想聊什麼"'))}${field('正文', textArea('text', '', 'rows="5" maxlength="2000" placeholder="寫點什麼…"'))}
      <div class="actions">${btn('send-post', icon('send') + '釋出', 'primary')}</div>`, 'send-post', async d => {
      const title = d.body.querySelector('[data-field=title]').value.trim(), text = d.body.querySelector('[data-field=text]').value.trim();
      if (!text) throw Error('正文寫點什麼再發');
      const post = await api.postForum({title, text});
      d.close(); open = post.id;
      if (api.forumReact) background(api.forumReact(post.id), () => '有人回覆了你的帖子'); else render();
    });
  }
  function replyTo(to = '') {
    const named = to && to !== 'me';
    sheet(named ? `回覆 ${to}` : '回覆', `${field('回覆', textArea('text', '', `rows="3" maxlength="500" placeholder="${named ? '回覆 ' + esc(to) : '說點什麼…'}"`))}<div class="actions">${btn('send-reply', icon('send') + '傳送', 'primary')}</div>`, 'send-reply', async d => {
      const text = d.body.querySelector('[data-field=text]').value.trim();
      if (!text) throw Error('寫點什麼再傳送');
      const {reply} = await api.replyForum(open, {text, ...(named ? {to} : {})});
      d.close();
      if (api.forumReply) background(api.forumReply(open, reply.id)); else render();
    });
  }
  function options() {
    const d = ctx.dialog('論壇設定', `<p class="help-copy">帖子和熱搜怎麼寫，在預設 App 的聊天預設裡：勾了「論壇」的規則就用在這裡（預設是「論壇口吻」）。</p>
      <div class="actions">${btn('edit-prompt', icon('edit') + '編輯聊天預設', 'secondary')}</div><div class="actions">${btn('clear-forum', icon('trash') + '清空論壇', 'danger')}</div>`);
    d.body.addEventListener('click', async e => {
      const b = e.target.closest('[data-action]');
      if (b?.dataset.action === 'edit-prompt') { d.close(); ctx.open('presets'); ctx.showPresetKind?.('chat'); }
      if (b?.dataset.action === 'clear-forum') {
        if (!await ctx.confirm('清空論壇？', '所有帖子、回覆和熱搜都會刪除。')) return;
        d.close(); await api.clearForum(); open = ''; await render(); ctx.notify('論壇已清空');
      }
    });
  }

  v.back = () => { if (!open) return false; open = ''; render(); return true; };
  v.refresh = () => render();
  v.on('click', '[data-action]', async el => {
    const post = posts.find(p => p.id === open);
    switch (el.dataset.action) {
      case 'forum-refresh': background(api.forumRefresh(), made => `刷出了 ${made.length} 個新帖子`); break;
      case 'forum-new': newPost(); break;
      case 'forum-options': options(); break;
      case 'open-post': open = el.dataset.id; await render(); v.root.scrollTop = 0; break;
      case 'forum-like': { const p = post || await api.getForumPost(open); if (p) { await api.likeForum(open, !p.liked); await render(); } break; }
      case 'forum-reply': replyTo(el.dataset.to || ''); break;
      case 'forum-my-reply': if (await ctx.confirm('刪除這條回覆？')) { await api.deleteForumReply(open, el.dataset.reply); await render(); } break;
      case 'forum-delete': if (await ctx.confirm('刪除這個帖子？', '帖子和下面的回覆會一起刪除。')) { await api.deleteForum(open); open = ''; await render(); } break;
    }
  });
  render().catch(error => ctx.notify(error.message));
  return v;
}
