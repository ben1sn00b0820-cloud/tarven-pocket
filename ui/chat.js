import {createView, esc, btn, field, input, select, textArea, toggle, heading, groupTitle, avatar, avatarPicture, empty, help, copyText} from './common.js';
import {icon} from './icons.js';
import {openImageViewer} from '../image-viewer.js';
import {saveFile, downloadAction} from '../download.js';
import {momentsPanel, momentsNew, momentsSeen} from './moments.js';
import {PROFILE_STATUS, BUBBLES, FRAMES, BACKGROUNDS} from '../core/chat.js';
import {callSummary} from '../core/call.js';
import {pendant} from './pendants.js';
import {PREMIUM} from '../core/wallet.js';
import {formatSpiritAmount as yuan, parseSpiritAmount, parseSpiritText, SPIRIT_UNIT_LABELS, SPIRIT_MAX} from '../core/currency.js';
import {safePhotoUrl} from '../pocket/photos.js';
import {contactDetailsHTML, openContactStatusEditor, deleteContactWithConfirmation} from './contact-profile.js';

// Chat app, QQ style: 消息 (conversations, with search, 置顶 and 免打扰), 联系人 (特别关心, friends, groups, profile cards)
// and 动态 (朋友圈, ui/moments.js). Tapping your own avatar opens 我: name, status, signature and 个性装扮 (chat bubble,
// avatar pendant, chat background). Private and group chats have voice messages, manual contacts, and "带进剧情"
// (carry selected messages into the next story reply).
// The + button next to the message box opens the phone features: photos, emoji, red packets, transfers,
// locations, 拍一拍, dice and "let them talk". Long-press (right-click) a message to quote, recall or delete it.
// Sending only puts a message in the chat, so the user can send several in a row. With the box empty, the send button
// turns into 让对方回复 and asks the model. Replies come from the host (api.chatReply); outside the tavern the app still
// stores and shows chats.

const clock = at => new Date(at).toLocaleTimeString('zh-TW', {hour: '2-digit', minute: '2-digit', hour12: false});
function stamp(at) {
  const d = new Date(at), now = new Date();
  if (d.toDateString() === now.toDateString()) return clock(at);
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return '昨天';
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
const dayLabel = at => { const s = stamp(at); return s.includes(':') ? '今天' : s; };
const BLESSING = '恭喜發財，大吉大利';
const you = who => who === 'me' ? '你' : who;
const patText = m => `${you(m.from)} 拍了拍 ${you(m.target)}`;
const noticeText = m => you(m.from) + String(m.text).replaceAll('{对方}', you(m.target));
// Messages drawn as a centred line instead of a bubble.
const LINE_KINDS = ['system', 'pat', 'notice', 'recall'];
function preview(m) {
  if (!m) return '還沒有訊息';
  switch (m.kind) {
    case 'voice': return `[語音] ${seconds(m)}″`;
    case 'photo': return '[圖片]';
    case 'redpacket': return '[紅包] ' + (m.text || BLESSING);
    case 'transfer': return '[轉賬] ' + yuan(m.amount);
    case 'gift': return '[禮物] ' + (m.gift?.name || '');
    case 'location': return '[位置] ' + m.text;
    case 'dice': return '[骰子]';
    case 'call': return `[${callSummary(m)}]`;
    case 'pat': return patText(m);
    case 'notice': return noticeText(m);
    case 'recall': return you(m.from) + ' 撤回了一條訊息';
    default: return m.text;
  }
}
const quotable = m => ['text', 'voice', 'photo', 'location'].includes(m.kind);
const quoteText = m => m.kind === 'voice' ? m.translation || m.text : m.kind === 'photo' ? '[圖片]' + (m.text ? ' ' + m.text : '') : m.kind === 'location' ? '[位置] ' + m.text : m.text;
const seconds = m => Math.max(1, Math.min(60, Math.round((m.text || '').length / 5)));
const lineOf = m => ({role: m.from, emotion: m.emotion || 'calm', text: m.text, translation: m.translation || ''});
const WAVE_HEIGHTS = [6, 12, 18, 10, 16, 22, 14, 8, 16, 20, 12, 7, 14, 10];
// Dice pips on a 3×3 grid, by face.
const PIPS = {1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8]};
const EMOJI = ['😀', '😂', '🥹', '😭', '😊', '🥰', '😘', '😳', '🤔', '😴', '😡', '🙄', '😏', '🤗', '🥺', '😱', '👍', '👌', '🙏', '👏', '💪', '❤️', '💔', '✨', '🎉', '🌸', '☕', '🌙', '🍰', '🐱', '🐶', '🌧️'];
const KAOMOJI = ['(｡•̀ᴗ-)✧', '(╥﹏╥)', '(๑•̀ㅂ•́)و✧', 'ヾ(≧▽≦*)o', '(〃▽〃)', '(｀へ´)', '( ˘ω˘ )zzZ', '(ﾉ>ω<)ﾉ', '(・∀・)', 'Σ(っ °Д °;)っ', '(*/ω＼*)', '(^_−)☆'];

// Only web images and local tavern paths may become <img> URLs. Album blob URLs are
// created locally from validated image blobs, never from untrusted message strings.
function messagePhotoURL(value, win) {
  const safe = safePhotoUrl(value);
  if (!safe) return '';
  try {
    return new URL(safe, win.location.href).href;
  } catch { return ''; }
}

export function chatApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'chat');
  // mode: list (the tabs) · thread · profile (a contact's card) · me (the user's card and 个性装扮) · contact-edit
  let mode = 'list', tab = 'msgs', search = '', searching = false, profileOf = '', threadId = null, thread = null, selecting = null, contactDraft = null, epoch = 0, stick = false;
  let unreadTotal = 0, freshMoments = 0;
  let panel = null, quote = null;
  const drafts = new Map(), live = typeof api.chatReply === 'function';
  const photoURLs = new Map(), recalled = new Map(), transcribed = new Set(), generatingPhotos = new Set();
  let press = null, pressedAt = 0, photoEditor = null, photoEditEpoch = 0;
  const voiceText = () => api.getState().chat.voiceText || {mode: 'translation', auto: false};
  /** 转文字 for a voice message: the translation, the original line, or both (original first). */
  function transcriptHTML(m) {
    const mode = voiceText().mode, original = m.text || '', translation = m.translation || '';
    if (mode === 'original' || !translation) return `<span class="v-text">${esc(original)}</span>`;
    if (mode === 'both' && original && original !== translation) return `<span class="v-text both"><span class="v-orig">${esc(original)}</span><span>${esc(translation)}</span></span>`;
    return `<span class="v-text">${esc(translation)}</span>`;
  }

  // ---------- The user (我) ----------
  const profile = () => api.getState().chat.profile;
  const myName = () => profile().name || api.userName?.() || '我';
  let switchTimer = 0;
  const myAvatar = size => `<span class="me-av" data-frame="${esc(profile().frame)}" style="--s:${size}px">${avatar(myName(), 'none', size, 'me')}${pendant(profile().frame)}</span>`;
  const statusLine = () => { const p = profile(); return `<i class="qq-dot" data-status="${p.status}"></i>${esc(PROFILE_STATUS[p.status])}${p.statusText ? ' · ' + esc(p.statusText) : ''}`; };
  const starred = () => api.getState().chat.starred || [];
  /** A contact's one line: a manual contact's persona, or where a role comes from. */
  const signatureOf = c => c.source === 'manual' ? (c.persona || '還沒有寫人設').split('\n')[0].slice(0, 40) : c.voice ? '角色 · 能發語音訊息' : '角色 · 還沒有配音';
  const moments = momentsPanel(ctx, {v, frame: html => frame(html), me: () => ({name: myName(), avatar: myAvatar}), visible: () => ctx.visible?.('chat') !== false && mode === 'list' && tab === 'moments'});
  /** A tab page with the tab bar under it. */
  function frame(html) {
    const tabs = [['msgs', '訊息', 'chat'], ['contacts', '聯絡人', 'person'], ['moments', '動態', 'moments']];
    return `<div class="qq-page">${html}</div><nav class="qq-tabs" aria-label="聊天">${tabs.map(([k, l, g]) => `<button type="button" data-action="tab" data-tab="${k}" aria-pressed="${tab === k}"><span class="qq-tab-ico">${icon(g)}${k === 'msgs' && unreadTotal ? `<b class="badge">${unreadTotal > 99 ? '99+' : unreadTotal}</b>` : k === 'moments' && freshMoments && tab !== 'moments' ? '<b class="qq-dot-new" aria-label="有新動態"></b>' : ''}</span><span>${l}</span></button>`).join('')}</nav>`;
  }
  async function counts() {
    unreadTotal = await api.chatUnread().catch(() => 0);
    freshMoments = momentsNew(await api.listMoments().catch(() => []), momentsSeen(ctx.win));
  }

  const engine = name => ctx.engineOf(name);
  const groupAvatar = (members, size) => `<span class="group-av" style="--s:${size}px">${members.slice(0, 3).map(m => `<i data-engine="${engine(m)}">${esc(m.slice(0, 1))}</i>`).join('')}</span>`;
  const threadAvatar = (t, size = 48) => t.type === 'group' ? groupAvatar(t.members, size) : avatar(t.members[0], engine(t.members[0]), size);
  const pendingBring = () => api.chatPendingBring?.() || null;
  const typing = () => !!threadId && !!api.chatTyping?.(threadId);
  const partner = () => thread.type === 'group' ? '群裡' : thread.members[0];

  // ---------- 消息 ----------
  function convRow(t, me) {
    const last = t.last, line = last && LINE_KINDS.includes(last.kind);
    const who = line || !last ? '' : last.from === 'me' ? '我：' : t.type === 'group' ? last.from + '：' : '';
    const atMe = t.type === 'group' && t.unread && last && last.from !== 'me' && String(last.text || '').includes('@' + me) ? '<em class="at-me">[有人@我]</em>' : '';
    const badge = t.unread ? `<span class="badge${t.muted ? ' muted' : ''}">${t.unread > 99 ? '99+' : t.unread}</span>` : '';
    const spark = t.type === 'dm' && t.streak >= 3 ? `<span class="spark" title="聊天火花：連續 ${t.streak} 天">🔥${t.streak}</span>` : '';
    return `<button class="conv${t.pinned ? ' pinned' : ''}" data-action="open" data-id="${esc(t.id)}" data-conv="${esc(t.id)}">${threadAvatar(t, 50)}<span class="grow"><span class="conv-top"><strong>${esc(t.name)}</strong>${t.type === 'group' ? '<span class="tag-s">群</span>' : ''}${spark}<span class="conv-time">${last ? stamp(last.at) : ''}</span></span><span class="conv-bot"><span class="pv">${atMe}${esc(who + preview(last))}</span>${t.muted ? `<span class="mute-ico" aria-label="免打擾">${icon('mute')}</span>` : ''}${badge}</span></span></button>`;
  }
  async function renderMessages(ticket) {
    const [threads] = await Promise.all([api.listThreads(), counts()]);
    if (v.disposed || ticket !== epoch) return;
    const q = search.trim().toLowerCase(), me = myName();
    const shown = threads.filter(t => !q || [t.name, ...t.members, preview(t.last)].some(x => String(x || '').toLowerCase().includes(q)));
    const people = q ? api.chatContacts().filter(c => c.name.toLowerCase().includes(q) && !threads.some(t => t.type === 'dm' && t.members[0] === c.name)) : [];
    const bring = pendingBring();
    v.draw(frame(`<header class="qq-top"><button type="button" class="qq-me" data-action="me" aria-label="我的資料和個性裝扮">${myAvatar(42)}<span class="qq-me-text"><strong>${esc(me)}</strong><small>${statusLine()}</small></span></button>${btn('plus-menu', icon('add'), 'round-button', 'aria-label="發起聊天、新增聯絡人"')}</header>
      <label class="qq-search">${icon('search')}<input data-field="chat-search" type="search" value="${esc(search)}" placeholder="搜尋聊天和聯絡人" aria-label="搜尋" autocomplete="off"></label>`
      + (bring ? `<div class="banner bring-banner">${icon('book')}<span>和${esc(bring.name)}的 ${bring.count} 條訊息會帶進下一次正文</span>${btn('cancel-bring', '取消', 'chip-button')}</div>` : '')
      + (live ? '' : '<div class="banner">' + icon('alert') + '<span>在酒館裡開啟傳音玉符時，聯絡人才會回覆。</span></div>')
      + (shown.length ? `<div class="conv-list qq-list">${shown.map(t => convRow(t, me)).join('')}</div>` : q ? '' : empty('還沒有聊天', '點右上角的加號，和角色私聊，或者拉一個群。聯絡人來自角色 App，也可以手動新增。', 'chat'))
      + (people.length ? groupTitle('聯絡人') + `<div class="group">${people.map(c => `<button class="list-row" data-action="dm-open" data-name="${esc(c.name)}">${avatar(c.name, c.engine, 40)}<span><strong>${esc(c.name)}</strong><small>發訊息</small></span>${icon('next')}</button>`).join('')}</div>` : '')
      + (q && !shown.length && !people.length ? `<p class="hint">沒有找到「${esc(search)}」</p>` : '')));
    if (searching) { const box = v.root.querySelector('[data-field=chat-search]'); box?.focus({preventScroll: true}); box?.setSelectionRange?.(box.value.length, box.value.length); }
  }

  // ---------- 联系人 ----------
  async function renderContactsTab(ticket) {
    const [threads] = await Promise.all([api.listThreads(), counts()]);
    if (v.disposed || ticket !== epoch) return;
    const contacts = api.chatContacts(), stars = starred(), groups = threads.filter(t => t.type === 'group');
    const deleted = api.getState().chat.deletedContacts || [];
    const row = c => `<button class="list-row" data-action="profile" data-name="${esc(c.name)}">${avatar(c.name, c.engine, 42)}<span><strong>${esc(c.name)}</strong><small>${esc(signatureOf(c))}</small></span>${stars.includes(c.name) ? '<span class="star-mark" aria-label="特別關心">★</span>' : icon('next')}</button>`;
    const special = contacts.filter(c => stars.includes(c.name));
    v.draw(frame(heading('聯絡人', btn('contact-add', icon('add'), 'round-button', 'aria-label="手動新增聯絡人"'), 'Contacts')
      + (special.length ? groupTitle('特別關心') + `<div class="group">${special.map(row).join('')}</div>` : '')
      + groupTitle(`好友 · ${contacts.length}`, help('角色 App 裡的角色會自動出現在這裡；劇情之外的人（同學、店員、網友……）可以點右上角的「＋」手動新增，寫上人設就能聊。'))
      + (contacts.length ? `<div class="group">${contacts.map(row).join('')}</div>` : '<p class="hint">還沒有好友。</p>')
      + (groups.length ? groupTitle(`群聊 · ${groups.length}`) + `<div class="group">${groups.map(t => `<button class="list-row" data-action="open" data-id="${esc(t.id)}">${threadAvatar(t, 42)}<span><strong>${esc(t.name)}</strong><small>${t.members.length} 人</small></span>${icon('next')}</button>`).join('')}</div>` : '')
      + (deleted.length && api.restoreContact ? `<details class="group pad" data-group="deleted-contacts"><summary>已刪除聯絡人 · ${deleted.length}</summary><p class="hint">這些聯絡人不會因正文更新或角色同步而自動加回。恢復後可繼續查看原私聊記錄。</p>${deleted.map(contact => `<button class="list-row" data-action="contact-restore" data-name="${esc(contact.name)}"><span><strong>${esc(contact.name)}</strong><small>恢復聯絡人</small></span>${icon('add')}</button>`).join('')}</details>` : '')));
  }
  function renderContactForm() {
    v.draw(heading(contactDraft.id ? '編輯聯絡人' : '新聯絡人', '', 'Contact')
      + `<div class="group pad">${field('名字', input('contact-name', contactDraft.name, 'text', 'maxlength="40"'))}${field('人設', textArea('contact-persona', contactDraft.persona, 'rows="6" placeholder="性格、身份、和你的關係、說話習慣……"'), '寫給模型看的資料。第一行也是資料卡上的簽名。角色 App 裡的角色會自動讀取酒館角色卡，不用在這裡填。')}</div>
      <div class="savebar">${btn('contact-cancel', '取消', 'secondary')}${btn('contact-save', '儲存', 'primary')}</div>
      ${contactDraft.id ? `<div class="actions">${btn('contact-delete', '刪除聯絡人', 'danger')}</div>` : ''}`);
  }
  /** A contact's card: send a message, see their posts, 特别关心. */
  async function renderProfile(ticket) {
    const c = api.chatContacts().find(x => x.name === profileOf);
    if (!c) { mode = 'list'; return render(); }
    const star = starred().includes(c.name), manual = c.source === 'manual' && api.getState().chat.contacts.find(x => x.name === c.name);
    const shell = body => `<div class="qq-card" data-engine="${c.engine}" data-contact-name="${esc(c.name)}"><span class="qq-card-cover" aria-hidden="true"></span>${avatar(c.name, c.engine, 84)}<h2>${esc(c.name)}</h2><p>${esc(signatureOf(c))}</p>
        <div class="qq-card-tags"><span class="chip">${c.source === 'role' ? '角色' : c.source === 'story' ? '劇情聯絡人' : '聯絡人'}</span>${c.voice ? '<span class="chip">能發語音</span>' : ''}${star ? '<span class="chip">★ 特別關心</span>' : ''}</div></div>
      <div class="actions">${btn('profile-chat', icon('chat') + '發訊息', 'primary')}${api.pocketSaveContactProfile ? btn('profile-status-edit', icon('edit') + '修改角色信息', 'secondary') : ''}${api.callDial ? btn('profile-call', icon('phone') + '打電話', 'secondary') : ''}${btn('profile-moments', icon('moments') + 'TA 的動態', 'secondary')}</div>
      <div class="group">${btn('avatar-pick', `${icon('image')}<span><strong>換頭像</strong><small>${esc(avatarState(c.name))}</small></span>`, 'list-row', `data-key="${esc(c.name)}"`)}${btn('star', `<span>${star ? '★ 取消特別關心' : '☆ 設為特別關心'}</span>`, 'list-row')}${manual ? `<button class="list-row" data-action="contact-edit" data-id="${esc(manual.id)}">${icon('edit')}<span><strong>編輯資料和人設</strong></span></button>` : ''}</div>
      ${body}${c.persona ? `<details class="tp-contact-section" data-group="tp-contact-persona"><summary>聯絡人人設</summary><p class="tp-contact-persona">${esc(c.persona)}</p></details>` : ''}
      ${api.deleteContact ? `<div class="actions">${btn('profile-delete', '刪除聯絡人', 'danger')}</div>` : ''}`;
    if (v.root.querySelector('[data-contact-name]')?.dataset.contactName !== c.name) v.draw(shell('<p class="hint" role="status">正在讀取角色信息…</p>'));
    try {
      const record = typeof api.pocketContactProfile === 'function' ? await api.pocketContactProfile(c.name) : null;
      if (v.disposed || ticket !== epoch || mode !== 'profile' || profileOf !== c.name) return;
      v.draw(shell(contactDetailsHTML(record)));
    } catch (error) {
      if (v.disposed || ticket !== epoch || mode !== 'profile') return;
      v.draw(shell(`<p class="hint" role="status">讀取角色信息失敗：${esc(error.message || error)}</p>`));
    }
  }
  /** 我: name, status, signature, and 个性装扮. */
  function renderMe() {
    const p = profile();
    // The free looks, then the shop's: a bought one is put on like a free one; one not bought yet shows its price.
    const w = api.wallet();
    const chips = (key, list, value) => `<div class="deco-row">${[...Object.entries(list).map(([k, l]) => [k, l, null]), ...Object.entries(PREMIUM[key] || {}).map(([k, [l, price]]) => [k, l, price])].map(([k, l, price]) => { const owned = price === null || w.owned.includes(key + ':' + k); return `<button type="button" class="deco${price === null ? '' : ' premium'}" data-action="${owned ? 'me-set' : 'me-buy'}" data-key="${key}" data-value="${k}" data-name="${esc(l)}" data-price="${price ?? 0}" data-${key}="${k}" aria-pressed="${value === k}"><span class="deco-sample" aria-hidden="true">${key === 'frame' ? `<span class="me-av" style="--s:36px"><span class="avatar none" style="--s:36px"></span>${pendant(k)}</span>` : ''}</span><span>${l}</span>${price === null ? '' : `<small class="deco-price">${owned ? '已擁有' : yuan(price)}</small>`}</button>`; }).join('')}</div>`;
    v.draw(heading('我', '', 'Me')
      + `<div class="qq-card me" data-bubble="${esc(p.bubble)}"><span class="qq-card-cover" aria-hidden="true"></span>${myAvatar(84)}<h2>${esc(myName())}</h2><p>${esc(p.signature || '還沒有個性簽名')}</p><div class="qq-card-tags"><span class="chip">${statusLine()}</span></div></div>`
      + `<div class="group pad"><div class="field"><span>頭像</span><div class="actions" style="margin:0">${btn('avatar-pick', icon('image') + '換頭像', 'secondary', 'data-key="me"')}</div><small class="hint">${esc(avatarState('me'))}</small></div>${field('名字', input('me-name', p.name, 'text', `maxlength="40" placeholder="${esc(api.userName?.() || '我')}（跟隨酒館裡的使用者名稱）"`))}${field('個性簽名', input('me-signature', p.signature, 'text', 'maxlength="80" placeholder="寫一句話"'))}
        <div class="field"><span>狀態</span><div class="deco-row">${Object.entries(PROFILE_STATUS).map(([k, l]) => `<button type="button" class="status-chip" data-action="me-set" data-key="status" data-value="${k}" aria-pressed="${p.status === k}"><i class="qq-dot" data-status="${k}"></i>${l}</button>`).join('')}</div></div>
        ${field('自定義狀態', input('me-statusText', p.statusText, 'text', 'maxlength="20" placeholder="例如：摸魚中、在聽歌"'))}</div>`
      + groupTitle('靈石袋與商城')
      + `<div class="group"><button class="list-row" data-action="me-wallet">${icon('wallet')}<span><strong>靈石袋</strong><small>靈石 ${esc(yuan(w.balance))} · 明細和收到的禮物</small></span>${icon('next')}</button><button class="list-row" data-action="me-shop">${icon('shop')}<span><strong>商城</strong><small>更好看的氣泡、掛件、背景，送給角色的禮物</small></span>${icon('next')}</button></div>`
      + groupTitle('個性裝扮')
      + `<div class="group pad"><div class="field"><span>聊天氣泡</span>${chips('bubble', BUBBLES, p.bubble)}</div><div class="field"><span>頭像掛件</span>${chips('frame', FRAMES, p.frame)}</div><div class="field"><span>聊天背景</span>${chips('background', BACKGROUNDS, p.background)}</div>
        <div class="actions" style="margin-top:0">${btn('me-bg-photo', icon('image') + (p.backgroundPhoto ? '換一張照片當背景' : '用相簿裡的照片當背景'), 'secondary')}${p.backgroundPhoto ? btn('me-bg-clear', '不用照片', 'text-button') : ''}</div></div>`
      + groupTitle('聊天設定')
      + `<div class="group"><button class="list-row" data-action="me-voice">${icon('book')}<span><strong>語音訊息</strong><small>轉文字顯示什麼、要不要自動轉</small></span>${icon('next')}</button><button class="list-row" data-action="me-calls">${icon('phone')}<span><strong>來電</strong><small>角色會不會自己打來、響鈴多久</small></span>${icon('next')}</button><button class="list-row" data-action="me-presets">${icon('edit')}<span><strong>聊天預設</strong><small>怎麼回訊息、朋友圈怎麼發、電話裡怎麼說</small></span>${icon('next')}</button></div>`);
  }

  // ---------- Thread ----------
  function bodyHTML(m) {
    const mid = `data-mid="${esc(m.id)}"`;
    switch (m.kind) {
      case 'voice': return `<button class="voice-msg" data-action="voice" ${mid} data-state="ungenerated" aria-label="播放 ${esc(m.from)} 的語音"><span class="v-ico">${icon('play', true)}</span><span class="v-wave">${WAVE_HEIGHTS.map(h => `<i style="height:${h}px"></i>`).join('')}</span><span class="v-sec">${seconds(m)}″</span></button>${voiceText().auto || transcribed.has(m.id) ? transcriptHTML(m) : ''}`;
      case 'photo': {
        const url = messagePhotoURL(m.image, ctx.win), busy = generatingPhotos.has(`${threadId}:${m.id}`);
        const auto = m.photoAuto || {}, state = busy ? 'generating' : auto.state;
        const missingKey = auto.code === 'NOT_CONFIGURED', failed = state === 'error';
        const incoming = m.from !== 'me' && typeof api.pocketResolvePhoto === 'function';
        const hasImage = !!(m.photoId || url), pending = state === 'queued' || state === 'generating';
        const status = state === 'generating' ? hasImage ? '正在重新生成，原圖會保留…' : 'NovelAI 自動生成中…' : state === 'queued' ? 'NovelAI 正在排隊…' : failed ? missingKey ? '請設定 NovelAI' : hasImage ? '重新生成失敗，原圖已保留' : '圖片生成失敗' : '圖片描述';
        const error = failed && !missingKey && auto.error ? `<small class="tp-photo-note tp-photo-failure">${esc(auto.error)}</small>` : '';
        const control = incoming && failed ? btn(missingKey ? 'photo-setup' : 'photo-retry', missingKey ? '設定 NovelAI' : '重試圖片', 'chip-button tp-photo-generate', mid) : incoming && !state && !hasImage ? btn(api.keyStatus?.('nai') ? 'photo-retry' : 'photo-setup', api.keyStatus?.('nai') ? '使用 NovelAI 生成這張照片' : '設定 NovelAI', 'chip-button tp-photo-generate', mid) : '';
        const options = incoming && typeof api.pocketPhotoDraft === 'function' ? btn('photo-options', icon('edit') + '圖片選項', 'text-button tp-photo-options', `${mid} aria-label="編輯這張圖片的提示詞"`) : '';
        const progress = !hasImage || pending || failed ? `<small class="tp-photo-note tp-photo-status" data-photo-state="${esc(state || 'idle')}" role="status">${pending ? '<i class="tp-photo-spinner" aria-hidden="true"></i>' : ''}${esc(status)}</small>${error}${control}` : '';
        if (hasImage) return `<button class="chat-photo" data-action="photo" ${mid} aria-label="檢視照片，長按開啟圖片選項"><img draggable="false" ${m.photoId ? `data-chat-photo="${esc(m.photoId)}"` : `src="${esc(url)}" data-chat-remote referrerpolicy="no-referrer" loading="lazy"`} alt="${esc(m.text || '照片')}"><span class="tp-photo-error" hidden>圖片無法載入</span></button>${m.text ? `<span class="v-text">${esc(m.text)}</span>` : ''}${progress}${options}`;
        return `<button class="chat-photo described" data-action="message" ${mid}><span class="ph-art">${icon('image')}</span><span class="ph-cap">${esc(m.text || '角色傳來一張圖片')}</span></button>${progress}${options}`;
      }
      case 'redpacket': {
        const opened = m.state === 'opened';
        return `<button class="packet${opened ? ' done' : ''}" data-action="packet" ${mid}><span class="pk-main"><span class="pk-ico" aria-hidden="true"></span><span class="pk-text"><strong>${esc(m.text || BLESSING)}</strong>${opened ? `<small>${m.openedBy === 'me' ? '你已領取' : esc(you(m.openedBy)) + ' 已領取'}</small>` : ''}</span></span><span class="pk-foot">紅包</span></button>`;
      }
      case 'transfer': {
        const state = {sent: m.from === 'me' ? '等對方收款' : '請收款', accepted: '已收款', returned: '已退還'}[m.state] || '';
        return `<button class="packet transfer${m.state !== 'sent' ? ' done' : ''}" data-action="transfer" ${mid}><span class="pk-main"><span class="pk-ico" aria-hidden="true">${icon(m.state === 'returned' ? 'undo' : m.state === 'accepted' ? 'check' : 'swap')}</span><span class="pk-text"><strong>${esc(yuan(m.amount))}</strong><small>${esc(m.text || state)}</small></span></span><span class="pk-foot">轉賬${m.text ? ' · ' + esc(state) : ''}</span></button>`;
      }
      case 'gift': {
        const g = m.gift || {}, mine = m.from === 'me';
        const state = m.state === 'accepted' ? (mine ? '對方已收下' : '你已收下') : m.state === 'returned' ? (mine ? '對方退還了' : '你退還了') : mine ? '等對方收下' : '點開收下';
        return `<button class="gift-card${m.state !== 'sent' ? ' done' : ''}" data-action="gift" ${mid}><span class="gc-main"><span class="gc-emoji" aria-hidden="true">${esc(g.emoji || '🎁')}</span><span class="gc-text"><strong>${esc(g.name)}</strong><small>${esc(m.text || state)}</small></span></span><span class="gc-foot">禮物${m.text ? ' · ' + esc(state) : ''}</span></button>`;
      }
      case 'location': return `<button class="loc-card" data-action="message" ${mid}><span class="loc-text"><strong>${esc(m.text)}</strong>${m.detail ? `<small>${esc(m.detail)}</small>` : ''}</span><span class="loc-map" aria-hidden="true">${icon('pin')}</span></button>`;
      case 'dice': {
        const fresh = Date.now() - m.at < 1500;
        return `<button class="dice-msg${fresh ? ' rolling' : ''}" data-action="message" ${mid} data-face="${esc(m.text)}" aria-label="骰子 ${esc(m.text)} 點">${Array.from({length: 9}, (_, i) => `<i${PIPS[m.text]?.includes(i) ? ' class="on"' : ''}></i>`).join('')}</button>`;
      }
      case 'call': return `<button class="call-msg${m.state === 'answered' ? '' : ' missed'}" data-action="call-log" ${mid}>${icon('phone', true)}<span>${esc(callSummary(m))}</span></button>`;
      default: return `<button class="chat-bubble" data-action="message" ${mid}>${esc(m.text)}</button>`;
    }
  }
  function lineHTML(m) {
    const mid = `data-mid="${esc(m.id)}"`;
    if (m.kind === 'system' && m.source?.id && m.text?.startsWith('[待確認付款]') && api.pocketConfirmPayment) return `<div class="tp-payment-draft" ${mid}><strong>${icon('swap')}待確認付款</strong><p>${esc(m.text.slice('[待確認付款]'.length).trim())}</p><small>目前尚未扣除千里傳音靈石袋餘額。</small>${btn('pocket-confirm-payment', '確認付款', 'primary', mid)}</div>`;
    if (m.kind === 'system') return `<div class="sys">${icon('book')}${esc(m.text)}</div>`;
    if (m.kind === 'pat') return `<div class="note-line" ${mid}>${esc(patText(m))}</div>`;
    if (m.kind === 'notice') return `<div class="note-line" ${mid}>${/红包/.test(m.text) ? '<span class="pk-dot" aria-hidden="true"></span>' : ''}${esc(noticeText(m))}</div>`;
    const again = m.from === 'me' && recalled.has(m.id) ? btn('re-edit', '重新編輯', 'text-button', mid) : '';
    return `<div class="note-line" ${mid}>${esc(you(m.from))} 撤回了一條訊息${again}</div>`;
  }
  function messageHTML(m, i, list) {
    const day = i === 0 || new Date(list[i - 1].at).toDateString() !== new Date(m.at).toDateString() ? `<div class="day">${dayLabel(m.at)}</div>` : '';
    if (LINE_KINDS.includes(m.kind)) return day + lineHTML(m);
    const me = m.from === 'me', group = thread.type === 'group', picked = selecting?.has(m.id);
    const quoted = m.quote ? `<span class="m-quote">${esc(you(m.quote.from))}：${esc(m.quote.text)}</span>` : '';
    return day + `<div class="msg${me ? ' me' : ''}" data-engine="${me ? 'none' : engine(m.from)}" data-kind="${m.kind}" data-mid="${esc(m.id)}"${picked ? ' data-picked' : ''}>${selecting ? '<span class="pick" aria-hidden="true"></span>' : ''}${me ? `<span class="me-side">${myAvatar(34)}</span>` : `<span class="pat-target" data-pat="${esc(m.from)}" title="雙擊拍一拍">${avatar(m.from, engine(m.from), 34)}</span>`}<div class="m-body">${group && !me ? `<button class="m-name tp-contact-name" data-action="profile" data-name="${esc(m.from)}" aria-label="檢視 ${esc(m.from)} 的資料">${esc(m.from)}</button>` : ''}${bodyHTML(m)}${quoted}${m.source?.stale ? `<small class="m-quote" role="note">${esc(m.source.reason || '來源劇情已變化；保留已結算記錄')}</small>` : ''}</div></div>`;
  }
  function toolsHTML() {
    const group = thread.type === 'group';
    const tools = [['photo', 'image', '照片'], ['emoji', 'smile', '表情'], ['redpacket', 'packet', '紅包'], ...(group ? [] : [['transfer', 'swap', '轉賬'], ['gift', 'gift', '禮物']]),
      ['location', 'pin', '位置'], ['pat', 'hand', '拍一拍'], ['dice', 'dice', '骰子'], ['nudge', 'reply', group ? '讓大家說' : '讓TA說']];
    if (panel === 'emoji') return `<div class="chat-panel emoji-panel" role="group" aria-label="表情">
      <div class="emoji-grid">${EMOJI.map(e => `<button data-action="emoji-pick" data-emoji="${e}" aria-label="${e}">${e}</button>`).join('')}</div>
      <div class="kao-row">${KAOMOJI.map(e => `<button data-action="emoji-pick" data-emoji="${esc(e)}">${esc(e)}</button>`).join('')}</div>
      <div class="panel-foot">${btn('panel-tools', icon('back') + '更多功能', 'text-button')}${btn('emoji-del', icon('backspace'), 'round-button', 'aria-label="刪除一個字"')}</div></div>`;
    return `<div class="chat-panel" role="group" aria-label="更多功能"><div class="tool-grid">${tools.map(([action, glyph, label]) =>
      `<button class="tool" data-action="tool-${action}" ${action === 'nudge' && !live ? 'disabled' : ''}><span class="tool-ico" data-tool="${action}">${icon(glyph)}</span><span>${label}</span></button>`).join('')}</div></div>`;
  }
  function composerHTML() {
    const group = thread.type === 'group';
    return `<div class="composer-wrap">
      ${quote ? `<div class="quote-bar"><span>回覆 ${esc(you(quote.from))}：${esc(quote.text)}</span>${btn('quote-off', icon('close'), 'round-button', 'aria-label="取消引用"')}</div>` : ''}
      <div class="composer">${btn('panel', icon('add'), 'round-button plus', `aria-label="更多功能" aria-expanded="${!!panel}"`)}<input class="field-in" data-field="draft" value="${esc(drafts.get(threadId) || '')}" placeholder="${group ? '發到群聊…' : '發訊息…'}" enterkeyhint="send" autocomplete="off" aria-label="訊息">${sendButton()}</div>
      ${panel ? toolsHTML() : ''}</div>`;
  }
  async function renderThread(ticket) {
    thread = await api.getThread(threadId);
    if (v.disposed || ticket !== epoch) return;
    if (!thread) { mode = 'list'; threadId = null; return render(); }
    if (thread.unread) api.markThreadRead(threadId).catch(() => {});
    const group = thread.type === 'group', contacts = api.chatContacts();
    const voiced = thread.members.filter(n => contacts.find(c => c.name === n)?.voice).length;
    const sub = group ? `${thread.members.length} 人 · ${voiced} 人能發語音` : contacts.find(c => c.name === thread.members[0])?.source === 'manual' ? '手動聯絡人' : voiced ? '能發語音訊息' : '還沒有配音 · 只發文字';
    const bring = pendingBring(), scroller = v.root.querySelector('.msgs'), atBottom = !scroller || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    const focused = ctx.doc.activeElement?.dataset?.field === 'draft' && v.root.contains(ctx.doc.activeElement);
    const list = thread.messages;
    const look = profile();
    v.draw(`<div class="chat-thread${selecting ? ' selecting' : ''}" data-bubble="${esc(look.bubble)}" data-bg="${esc(look.backgroundPhoto ? 'photo' : look.background)}">
      <div class="th-head" data-engine="${group ? 'none' : engine(thread.members[0])}">${threadAvatar(thread, 38)}<div class="th-title">${group ? `<strong>${esc(thread.name)}</strong>` : `<button class="tp-thread-person" data-action="profile" data-name="${esc(thread.members[0])}" aria-label="檢視 ${esc(thread.name)} 的資料"><strong>${esc(thread.name)}</strong></button>`}<small>${esc(sub)}</small></div>
        ${btn('bring', selecting ? '取消' : icon('book') + '<span class="bring-label">帶進劇情</span>', 'chip-button', selecting ? '' : 'aria-label="帶進劇情" title="帶進劇情"')}${!group && api.callDial ? btn('call', icon('phone'), 'round-button call-go', 'aria-label="語音通話"') : ''}${btn('thread-menu', icon('more'), 'round-button', 'aria-label="更多"')}</div>
      <div class="msgs" role="log" aria-live="polite">${list.length ? list.map((m, i) => messageHTML(m, i, list)).join('') : `<p class="chat-empty">${live ? '發幾條訊息都行，發完點右下角的氣泡按鈕讓對方回覆；輸入框空著時傳送鍵就會變成它。也可以直接點它，讓對方先開口。' : '在酒館裡開啟傳音玉符時，聯絡人才會回覆。'}</p>`}
        ${bring?.threadId === threadId ? `<div class="sys">${icon('book')}${bring.count} 條訊息會帶進下一次正文 ${btn('cancel-bring', '取消', 'text-button')}</div>` : ''}
        ${typing() ? `<div class="msg" data-engine="${group ? 'none' : engine(thread.members[0])}">${avatar(group ? '…' : thread.members[0], group ? 'none' : engine(thread.members[0]), 34)}<div class="m-body"><div class="chat-bubble typing" aria-label="對方正在輸入"><i></i><i></i><i></i></div></div></div>` : ''}</div>
      ${selecting
        ? `<div class="bring-bar"><span>${selecting.size ? `已選 ${selecting.size} 條` : '點訊息來選擇'}</span>${btn('bring-go', '帶進下一次正文', 'primary', selecting.size ? '' : 'disabled')}</div>`
        : composerHTML()}
    </div>`);
    const msgs = v.root.querySelector('.msgs');
    if (atBottom || stick) msgs.scrollTop = msgs.scrollHeight;
    stick = false;
    if (focused) v.root.querySelector('[data-field=draft]')?.focus({preventScroll: true});
    paintVoices();
    paintPhotos();
    if (look.backgroundPhoto) photoURL(look.backgroundPhoto).then(url => { const box = v.root.querySelector('.msgs'); if (box && url) box.style.backgroundImage = `url("${url}")`; });
  }
  // Opens or closes the + panel in place, so the message box keeps its text and focus.
  function syncPanel() {
    const wrap = v.root.querySelector('.composer-wrap');
    if (!wrap) return;
    const msgs = v.root.querySelector('.msgs'), atBottom = msgs && msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80;
    const old = wrap.querySelector('.chat-panel');
    old?.remove();
    if (panel) {
      wrap.insertAdjacentHTML('beforeend', toolsHTML());
      if (!old) wrap.querySelector('.chat-panel').classList.add('enter');
    }
    wrap.querySelector('[data-action=panel]')?.setAttribute('aria-expanded', String(!!panel));
    if (msgs && atBottom) msgs.scrollTop = msgs.scrollHeight;
  }
  async function paintVoices() {
    const status = api.status();
    for (const el of v.root.querySelectorAll('.voice-msg[data-mid]')) {
      const m = thread?.messages.find(x => x.id === el.dataset.mid);
      if (!m) continue;
      const on = ['playing', 'paused', 'generating'].includes(status.phase) && status.line?.text === m.text && status.line?.role === m.from;
      const state = on ? (status.phase === 'generating' ? 'generating' : 'playing') : await api.lineState(lineOf(m));
      if (!el.isConnected) continue;
      el.dataset.state = state;
      el.querySelector('.v-ico').innerHTML = state === 'generating' ? icon('spin') : icon(state === 'playing' ? 'pause' : 'play', true);
    }
  }
  // Album photos sent in the chat; each picture is read once and kept while the app is open.
  async function photoURL(id) {
    if (!photoURLs.has(id)) {
      const photo = await api.getPhoto(id);
      photoURLs.set(id, photo ? ctx.win.URL.createObjectURL(photo.blob) : '');
    }
    return photoURLs.get(id);
  }
  async function paintPhotos() {
    for (const img of v.root.querySelectorAll('img[data-chat-remote]')) {
      const showError = () => { img.closest('.chat-photo')?.classList.add('missing'); const note = img.parentElement?.querySelector('.tp-photo-error'); if (note) note.hidden = false; };
      img.addEventListener('error', showError, {once: true});
      if (img.complete && !img.naturalWidth) showError();
    }
    for (const img of v.root.querySelectorAll('img[data-chat-photo]')) {
      const url = await photoURL(img.dataset.chatPhoto).catch(() => '');
      if (!img.isConnected) continue;
      if (url) img.src = url; else { img.closest('.chat-photo')?.classList.add('missing'); const note = img.parentElement?.querySelector('.tp-photo-error'); if (note) note.hidden = false; }
    }
  }

  function render() {
    const ticket = ++epoch;
    v.root.classList.toggle('chat-mode', mode === 'thread');
    v.root.classList.toggle('qq-mode', mode === 'list');
    if (mode === 'thread') return renderThread(ticket);
    if (mode === 'profile') return renderProfile(ticket);
    if (mode === 'me') return renderMe();
    if (mode === 'contact-edit') return renderContactForm();
    if (tab === 'contacts') return renderContactsTab(ticket);
    if (tab === 'moments') return counts().then(() => { if (ticket === epoch) return moments.render(); });
    return renderMessages(ticket);
  }
  function open(id) {
    closePhotoEditor();
    threadId = id; mode = 'thread'; selecting = null; stick = true; panel = null; quote = null;
    return render();
  }

  // ---------- Sending ----------
  /** Puts the user's messages in the chat. Nothing goes to the model until the user asks for a reply. */
  async function post(messages) {
    stick = true;
    await api.appendChat(threadId, messages, {read: true});
  }
  async function send() {
    const el = v.root.querySelector('[data-field=draft]'), text = el?.value.trim();
    // An empty box asks the other side to reply to everything sent so far.
    if (!text) { if (live && el) requestReply(); return; }
    el.value = '';
    drafts.delete(threadId);
    syncSend();
    const q = quote;
    quote = null;
    await post([{from: 'me', kind: 'text', text, ...(q ? {quote: q} : {})}]);
  }
  /** Paper plane while there is text; 让对方回复 when the box is empty. */
  const sendButton = () => {
    const empty = !(drafts.get(threadId) || '').trim(), group = thread?.type === 'group';
    return empty
      ? btn('send', icon('bubble'), 'round-button send ask', `aria-label="讓${group ? '群裡' : '對方'}回覆" title="讓${group ? '群裡' : '對方'}回覆" ${live ? '' : 'disabled'}`)
      : btn('send', icon('send'), 'round-button send', 'aria-label="傳送" title="傳送"');
  };
  function syncSend() {
    const old = v.root.querySelector('.composer [data-action=send]');
    if (!old) return;
    const empty = !(drafts.get(threadId) || '').trim();
    if (old.classList.contains('ask') === empty) return;
    old.insertAdjacentHTML('afterend', sendButton());
    old.remove();
  }
  function requestReply(id = threadId) {
    if (!live || !id) return;
    const job = api.chatReply(id);
    if (mode === 'thread' && id === threadId) render();
    job.catch(error => ctx.notify(error.message));
  }
  /** Runs a sheet's buttons: `handlers[action](button)`; errors become notices. */
  function sheet(title, html, handlers) {
    const d = ctx.dialog(title, html);
    d.body.addEventListener('click', e => {
      const b = e.target.closest('[data-action]');
      if (!b || !handlers[b.dataset.action]) return;
      e.preventDefault();
      ctx.win.Promise.resolve().then(() => handlers[b.dataset.action](b)).catch(error => ctx.notify(error.message));
    });
    return d;
  }
  const value = (d, key) => d.body.querySelector(`[data-field=${key}]`)?.value.trim() || '';
  const unitChoices = Object.entries(SPIRIT_UNIT_LABELS);
  const amountFields = (key, initial = '') => field('數量', input(key, initial, 'text', 'inputmode="decimal" maxlength="20" placeholder="輸入數量"')) + field('靈石品級', select(key + '-unit', 'lower', unitChoices)) + '<p class="hint">1 極品 = 1000 中品；1 中品 = 100 下品。送出時依選擇的品級換算。</p>';
  const amountOf = (text, unit = 'lower') => parseSpiritAmount(text, unit, {zero: false});

  async function sendPhoto() {
    const rows = await api.listPhotos(), local = [];
    let chosen = null;
    const d = sheet('傳送照片', `<div class="photo-grid pick-photos">${rows.map(r => `<button data-action="pick-photo" data-id="${esc(r.id)}" aria-pressed="false" aria-label="選擇 ${esc(r.name)}"><img data-photo="${esc(r.id)}" alt="${esc(r.name)}"></button>`).join('')}</div>
      ${rows.length ? '' : '<p class="help-copy">相簿裡還沒有照片，可以直接從本地選一張。</p>'}
      <div class="actions"><label class="secondary file-button">${icon('import')}從本地選<input type="file" data-chat-file accept="image/png,image/jpeg,image/webp,image/avif,image/gif" aria-label="從本地選照片"></label></div>
      ${field('照片說明', input('caption', '', 'text', 'maxlength="200" placeholder="比如：下班路上的晚霞"'), '對方看不到圖片本身，只看得到這句說明。寫清楚照片裡有什麼，對方才好接話。')}
      <div class="actions">${btn('photo-send', icon('send') + '傳送', 'primary', 'disabled')}</div>`, {
      'pick-photo': b => {
        chosen = b.dataset.id;
        for (const x of d.body.querySelectorAll('[data-action=pick-photo]')) x.setAttribute('aria-pressed', String(x === b));
        d.body.querySelector('[data-action=photo-send]').disabled = false;
      },
      'photo-send': async () => {
        if (!chosen) return;
        const caption = value(d, 'caption');
        d.close();
        await post([{from: 'me', kind: 'photo', photoId: chosen, text: caption}]);
      }
    });
    d.onClose(() => { for (const url of local) ctx.win.URL.revokeObjectURL(url); });
    d.body.addEventListener('change', e => {
      const file = e.target.closest('[data-chat-file]')?.files?.[0];
      if (!file) return;
      api.addPhoto({name: file.name, blob: file}).then(async photo => {
        const caption = value(d, 'caption');
        d.close();
        await post([{from: 'me', kind: 'photo', photoId: photo.id, text: caption}]);
      }).catch(error => ctx.notify(error.message));
    });
    for (const row of rows) {
      const photo = await api.getPhoto(row.id);
      if (!d.live) return;
      const img = [...d.body.querySelectorAll('img[data-photo]')].find(x => x.dataset.photo === row.id);
      if (photo && img) { const url = ctx.win.URL.createObjectURL(photo.blob); local.push(url); img.src = url; }
    }
  }
  function sendPacket() {
    const paymentId = crypto.randomUUID();
    const d = sheet('發紅包', `<div class="packet-sheet">${amountFields('amount', '6')}${field('祝福語', input('blessing', '', 'text', `maxlength="40" placeholder="${BLESSING}"`))}</div>
      <div class="actions">${btn('packet-send', '塞錢進紅包', 'primary packet-go')}</div>`, {
      'packet-send': async () => {
        const amount = amountOf(value(d, 'amount'), value(d, 'amount-unit')), text = value(d, 'blessing') || BLESSING;
        // Paid from the wallet; too little left says so and the sheet stays open.
        await api.sendPaid(threadId, {kind: 'redpacket', amount, unit: 'lower', text, paymentId});
        d.close();
        stick = true;
      }
    });
  }
  function sendTransfer() {
    const paymentId = crypto.randomUUID();
    const d = sheet(`轉賬給${thread.members[0]}`, `${amountFields('amount')}${field('備註', input('note', '', 'text', 'maxlength="40" placeholder="可以不填"'))}
      <div class="actions">${btn('transfer-send', '轉賬', 'primary')}</div>`, {
      'transfer-send': async () => {
        const amount = amountOf(value(d, 'amount'), value(d, 'amount-unit')), text = value(d, 'note');
        await api.sendPaid(threadId, {kind: 'transfer', amount, unit: 'lower', text, paymentId});
        d.close();
        stick = true;
      }
    });
  }
  function sendLocation() {
    const d = sheet('傳送位置', `${field('地點', input('place', '', 'text', 'maxlength="100" placeholder="比如：學校後門的便利店"'))}${field('詳細地址', input('detail', '', 'text', 'maxlength="200" placeholder="可以不填"'))}
      <div class="actions">${btn('location-send', icon('pin') + '傳送', 'primary')}</div>`, {
      'location-send': async () => {
        const text = value(d, 'place');
        if (!text) throw Error('請填寫地點');
        const detail = value(d, 'detail');
        d.close();
        await post([{from: 'me', kind: 'location', text, detail}]);
      }
    });
  }
  const pat = name => post([{from: 'me', kind: 'pat', target: name}]);
  function choosePat() {
    if (thread.type !== 'group') return pat(thread.members[0]);
    const d = sheet('拍一拍', `<div class="pick-list">${thread.members.map(n => `<button class="list-row" data-action="pat-one" data-name="${esc(n)}">${avatar(n, engine(n), 36)}<span><strong>${esc(n)}</strong></span>${icon('hand')}</button>`).join('')}</div>`, {
      'pat-one': async b => { d.close(); await pat(b.dataset.name); }
    });
  }
  const rollDice = () => post([{from: 'me', kind: 'dice', text: String(1 + Math.floor(Math.random() * 6))}]);
  function insertText(text) {
    const el = v.root.querySelector('[data-field=draft]');
    if (!el) return;
    const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;
    drafts.set(threadId, el.value);
    syncSend();
  }
  function deleteChar() {
    const el = v.root.querySelector('[data-field=draft]');
    if (!el?.value) return;
    el.value = [...el.value].slice(0, -1).join('');
    drafts.set(threadId, el.value);
    syncSend();
  }

  // ---------- Red packets and transfers ----------
  function openPacket(m) {
    const mine = m.from === 'me', opened = m.state === 'opened';
    const status = opened ? (m.openedBy === 'me' ? '已存入靈石' : `${esc(you(m.openedBy))} 已領取`) : mine ? '等對方領取' : '';
    const d = sheet(`${you(m.from)}的紅包`, `<div class="packet-open${opened || mine ? ' shown' : ''}">${avatar(m.from === 'me' ? '我' : m.from, mine ? 'none' : engine(m.from), 54)}
      <p class="po-from">${esc(mine ? '你發出的紅包' : m.from + ' 發出的紅包')}</p><p class="po-wish">${esc(m.text || BLESSING)}</p>
      ${opened || mine ? `<p class="po-amount">${esc(yuan(m.amount))}</p><p class="po-state">${status}</p>` : btn('packet-open', '開', 'packet-coin', 'aria-label="拆開紅包"')}</div>`, {
      'packet-open': async () => {
        d.close();
        await api.takeSent(threadId, m.id, true);
        ctx.notify(`領到 ${yuan(m.amount)}，已存入靈石`);
      }
    });
  }
  function openTransfer(m) {
    const mine = m.from === 'me', waiting = m.state === 'sent';
    const state = {sent: mine ? '等對方收款' : '待你收款', accepted: mine ? '對方已收款' : '你已收款', returned: mine ? '對方已退還' : '你已退還'}[m.state];
    const settle = next => async () => {
      d.close();
      await api.takeSent(threadId, m.id, next === 'accepted');
      if (next === 'accepted') ctx.notify(`收下 ${yuan(m.amount)}，已存入靈石`);
    };
    const d = sheet(mine ? '轉賬' : `${m.from}的轉賬`, `<div class="transfer-open"><span class="to-ico">${icon(waiting ? 'swap' : m.state === 'accepted' ? 'check' : 'undo')}</span><p class="po-state">${esc(state)}</p><p class="po-amount">${esc(yuan(m.amount))}</p>${m.text ? `<p class="po-wish">${esc(m.text)}</p>` : ''}</div>
      ${!mine && waiting ? `<div class="actions">${btn('transfer-accept', '收款', 'primary')}</div><div class="actions">${btn('transfer-return', '退還', 'text-button')}</div>` : ''}`, {
      'transfer-accept': settle('accepted'),
      'transfer-return': settle('returned')
    });
  }

  // ---------- 礼物 ----------
  /** The user picks a gift from the shop, pays for it from the wallet and sends it; it can go into the story too. */
  function sendGift() {
    const paymentId = crypto.randomUUID();
    const w = api.wallet(), gifts = api.shopCatalog().gifts;
    let picked = null;
    const d = sheet(`送禮物給${thread.members[0]}`, `<p class="wallet-line">${icon('wallet')}靈石 ${esc(yuan(w.balance))}</p>
      <div class="gift-grid">${gifts.map(g => `<button type="button" class="gift-item" data-action="gift-pick" data-id="${esc(g.id)}" aria-pressed="false"${g.price > w.balance ? ' data-short' : ''}><span class="gi-emoji" aria-hidden="true">${esc(g.emoji)}</span><strong>${esc(g.name)}</strong><small>${esc(yuan(g.price))}</small></button>`).join('')}</div>
      ${field('附言', input('note', '', 'text', 'maxlength="60" placeholder="可以不寫"'))}
      ${toggle('bring', '帶進劇情', false, '開啟後，下一次正文回覆會知道你送了這份禮物（和聊天裡的「帶進劇情」一樣，用一次）。')}
      <div class="actions">${btn('gift-send', icon('gift') + '買下並送出', 'primary')}</div>
      <div class="actions">${btn('gift-shop', icon('shop') + '去商城加自己的禮物', 'text-button')}</div>`, {
      'gift-pick': b => { picked = b.dataset.id; for (const x of d.body.querySelectorAll('.gift-item')) x.setAttribute('aria-pressed', String(x === b)); },
      'gift-send': async () => {
        if (!picked) throw Error('先選一件禮物');
        const note = value(d, 'note'), bring = !!d.body.querySelector('[data-field=bring]')?.checked;
        const saved = await api.sendPaid(threadId, {kind: 'gift', giftId: picked, text: note, paymentId});
        d.close();
        stick = true;
        const sent = saved?.messages?.findLast?.(m => m.from === 'me' && m.kind === 'gift');
        if (bring && sent) await api.chatBring(threadId, [sent.id]);
      },
      'gift-shop': () => { d.close(); openShop('gifts'); }
    });
  }
  function openGift(m) {
    const mine = m.from === 'me', waiting = m.state === 'sent', g = m.gift || {};
    const state = {sent: mine ? '等對方收下' : '要收下嗎？', accepted: mine ? '對方收下了' : '你收下了', returned: mine ? '對方退還了，錢已退回靈石' : '你退還了'}[m.state] || '';
    const d = sheet(mine ? '你送的禮物' : `${m.from}送的禮物`, `<div class="gift-open"><span class="go-emoji" aria-hidden="true">${esc(g.emoji || '🎁')}</span><p class="go-name">${esc(g.name)}</p>${mine && g.price ? `<p class="po-amount">${esc(yuan(g.price))}</p>` : ''}${m.text ? `<p class="po-wish">${esc(m.text)}</p>` : ''}<p class="po-state">${esc(state)}</p></div>
      ${!mine && waiting ? `<div class="actions">${btn('gift-accept', '收下', 'primary')}</div><div class="actions">${btn('gift-return', '退還', 'text-button')}</div>` : ''}`, {
      'gift-accept': async () => { d.close(); await api.takeSent(threadId, m.id, true); ctx.notify(`收下了「${g.name}」，在靈石袋的「收到的禮物」裡`); },
      'gift-return': async () => { d.close(); await api.takeSent(threadId, m.id, false); }
    });
  }

  // ---------- 靈石袋 and 商城 ----------
  const when = at => { if (!at) return ''; const t = new Date(at); return `${t.getMonth() + 1}月${t.getDate()}日 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`; };
  function openWallet() {
    const w = api.wallet(), kinds = api.shopCatalog().ledgerKinds;
    const d = sheet('靈石袋', `<div class="wallet-card"><small>靈石</small><strong>${esc(yuan(w.balance))}</strong><span>領到的紅包、收下的轉賬存進來；發紅包、轉賬、買裝扮和禮物從這裡出。</span></div>
      <div class="actions">${btn('wallet-edit', '修改餘額', 'primary')}${btn('wallet-shop', icon('shop') + '去商城', 'secondary')}</div>
      ${groupTitle('已購物品')}${w.inventory?.length ? `<div class="gift-grid received">${w.inventory.map(r => `<div class="gift-item"><span class="gi-emoji" aria-hidden="true">${esc(r.emoji)}</span><strong>${esc(r.name)}</strong><small>${esc(yuan(r.price))} · ${esc(when(r.at))}</small><small>${esc(r.description)}</small></div>`).join('')}</div>` : '<p class="hint">劇情商城買下的物品會儲存在這裡。</p>'}
      ${groupTitle('收到的禮物')}${w.received.length ? `<div class="gift-grid received">${w.received.map(r => `<div class="gift-item"><span class="gi-emoji" aria-hidden="true">${esc(r.emoji)}</span><strong>${esc(r.name)}</strong><small>${esc(r.from)} 送的</small></div>`).join('')}</div>` : '<p class="hint">還沒有收到禮物。角色送的禮物，點開收下就會放在這裡。</p>'}
      ${groupTitle('明細')}<div class="group">${w.ledger.map(e => `<div class="setting-row ledger-row"><span><strong>${esc(kinds[e.kind] || e.kind)}${e.who ? ' · ' + esc(e.who) : ''}</strong><small>${esc([e.note, when(e.at)].filter(Boolean).join(' · '))}</small></span><b class="${e.amount > 0 ? 'in' : 'out'}">${e.amount > 0 ? '+' : '−'}${esc(yuan(Math.abs(e.amount)))}</b></div>`).join('')}</div>`, {
      'wallet-edit': () => { d.close(); editWalletBalance(); },
      'wallet-shop': () => { d.close(); openShop(); }
    });
  }
  function editWalletBalance() {
    const d = sheet('修改靈石袋餘額', `${field('餘額（靈石）', input('balance', api.wallet().balance, 'text', 'maxlength="80" placeholder="例如：1 極品 2 中品 3 下品"'), '未寫品級時以整數下品計算；調整會寫入收支明細，舊帳尾數保持原值。')}
      ${field('備註', input('note', '', 'text', 'maxlength="60" placeholder="例如：本章初始資金"'))}
      <div class="actions">${btn('wallet-save', '儲存餘額', 'primary')}</div>`, {
      'wallet-save': async () => { if (value(d, 'balance') !== String(api.wallet().balance)) await api.walletSetBalance(parseSpiritText(value(d, 'balance')), value(d, 'note')); d.close(); ctx.notify('餘額已更新，調整已記入明細'); openWallet(); }
    });
  }
  /** A decoration as it looks: the same sample the 个性装扮 chips use. */
  const decoSample = (kind, key) => `<span class="deco-sample" aria-hidden="true">${kind === 'frame' ? `<span class="me-av" style="--s:36px"><span class="avatar none" style="--s:36px"></span>${pendant(key)}</span>` : ''}</span>`;
  function openShop(start = 'decor') {
    let tab = start;
    const d = sheet('商城', '', {
      'shop-tab': b => { tab = b.dataset.tab; draw(); },
      // Two taps to buy: the first one asks, the second one pays.
      'shop-buy': async b => {
        if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = '再點一下買下'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = b.dataset.label; } }, 3000); return; }
        await api.buyDecoration(b.dataset.kind, b.dataset.key);
        ctx.notify('買下了，在「我」的個性裝扮裡換上');
        draw();
      },
      'shop-wear': async b => { api.saveChatOptions({profile: {[b.dataset.kind]: b.dataset.key}}); ctx.notify('換上了'); draw(); render(); },
      'gift-new': () => { d.close(); editGift(null); },
      'gift-edit': b => { d.close(); editGift(api.wallet().gifts.find(g => g.id === b.dataset.id)); },
      'gift-delete': async b => {
        if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = '再點刪除'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = '刪除'; } }, 3000); return; }
        api.deleteGift(b.dataset.id); draw();
      }
    });
    function draw() {
      if (!d.live) return;
      const w = api.wallet(), c = api.shopCatalog(), p = profile();
      const decor = Object.entries(c.premium).map(([kind, items]) => groupTitle(c.kinds[kind]) + `<div class="shop-grid">${Object.entries(items).map(([key, [name, price]]) => {
        const owned = w.owned.includes(kind + ':' + key), wearing = p[kind] === key, label = `${yuan(price)} 買下`;
        return `<div class="deco shop-deco premium" data-${kind}="${esc(key)}">${decoSample(kind, key)}<span>${esc(name)}</span>${owned ? (wearing ? '<small class="deco-price">使用中</small>' : btn('shop-wear', '換上', 'chip-button', `data-kind="${kind}" data-key="${esc(key)}"`)) : btn('shop-buy', label, 'chip-button', `data-kind="${kind}" data-key="${esc(key)}" data-label="${label}"${price > w.balance ? ' data-short' : ''}`)}</div>`;
      }).join('')}</div>`).join('');
      const gifts = `<div class="gift-grid">${c.gifts.map(g => `<div class="gift-item${g.own ? ' own' : ''}"><span class="gi-emoji" aria-hidden="true">${esc(g.emoji)}</span><strong>${esc(g.name)}</strong><small>${esc(yuan(g.price))}</small>${g.note ? `<small class="gi-note">${esc(g.note)}</small>` : ''}${g.own ? `<span class="gi-tools">${btn('gift-edit', '改', 'text-button', `data-id="${esc(g.id)}"`)}${btn('gift-delete', '刪除', 'text-button', `data-id="${esc(g.id)}"`)}</span>` : ''}</div>`).join('')}</div>
        <div class="actions">${btn('gift-new', icon('add') + '自定義禮物', 'secondary')}</div><p class="hint">送禮物：在私聊裡點「+」→「禮物」。</p>`;
      d.body.innerHTML = `<p class="wallet-line">${icon('wallet')}靈石 ${esc(yuan(w.balance))}</p><div class="segmented" style="margin:0 0 10px">${[['decor', '裝扮'], ['gifts', '禮物']].map(([k, l]) => `<button data-action="shop-tab" data-tab="${k}" aria-pressed="${tab === k}">${l}</button>`).join('')}</div>${tab === 'gifts' ? gifts : decor}`;
    }
    draw();
  }
  /** A gift of the user's own: name, emoji, price and a line about it. */
  function editGift(gift) {
    const g = gift || {name: '', emoji: '🎁', price: 20, note: ''};
    const d = sheet(gift ? '改禮物' : '自定義禮物', `${field('名字', input('gift-name', g.name, 'text', 'maxlength="20" placeholder="比如：手寫賀卡、演唱會門票"'))}
      ${field('圖示', input('gift-emoji', g.emoji, 'text', 'maxlength="4" placeholder="一個表情，比如 🎫"'))}
      ${field('價格（靈石）', input('gift-price', g.price, 'text', 'maxlength="40" placeholder="例如：2 中品靈石"'))}
      ${field('說明', input('gift-note', g.note, 'text', 'maxlength="60" placeholder="可以不寫"'))}
      <div class="actions">${btn('gift-save', '儲存', 'primary')}</div>`, {
      'gift-save': async () => {
        const entered = value(d, 'gift-price');
        const price = gift && entered === String(gift.price) ? gift.price : parseSpiritText(entered);
        api.saveGift({id: gift?.id, name: value(d, 'gift-name'), emoji: value(d, 'gift-emoji'), price, note: value(d, 'gift-note')});
        d.close();
        openShop('gifts');
      }
    });
  }

  // ---------- Individual WeChat photo prompts ----------
  function closePhotoEditor() {
    ++photoEditEpoch;
    photoEditor?.close();
    photoEditor = null;
  }
  async function editPhoto(m, id = threadId) {
    if (m?.kind !== 'photo' || m.from === 'me' || typeof api.pocketPhotoDraft !== 'function' || typeof api.pocketEditPhoto !== 'function') return;
    closePhotoEditor();
    const ticket = photoEditEpoch;
    const d = ctx.dialog('圖片提示詞', '<p class="help-copy" role="status">正在讀取這張圖片的生成設定…</p>');
    photoEditor = d;
    d.onClose(() => { if (photoEditor === d) photoEditor = null; });
    const current = () => !v.disposed && d.live && ticket === photoEditEpoch && mode === 'thread' && threadId === id && thread?.messages.some(x => x.id === m.id && x.kind === 'photo');
    try {
      const [draft, state] = await Promise.all([api.pocketPhotoDraft(id, m.id), api.pocketImageState?.() || {}]);
      if (!current()) { d.close(); return; }
      const presets = Array.isArray(state.presets) ? state.presets : [];
      const catalogue = state.catalogue || {}, modelNames = catalogue.modelNames || {};
      const models = Array.isArray(catalogue.models) ? catalogue.models.map(model => Array.isArray(model) ? model : typeof model === 'string' ? [model, modelNames[model] || model] : [model.id || model.value, model.name || model.label || model.id || model.value]) : [];
      models.unshift(['', '沿用千里傳音生圖模型']);
      if (draft.model && !models.some(([model]) => model === draft.model)) models.unshift([draft.model, modelNames[draft.model] || draft.model]);
      const presetChoices = [['', '不套用預設・使用下方設定'], ...presets.map(p => [p.id, p.name])];
      if (draft.presetId && !presets.some(p => p.id === draft.presetId)) presetChoices.push([draft.presetId, `${draft.presetName || '原圖片預設'}（已移除）`]);
      d.body.innerHTML = `<div class="tp-photo-editor" data-photo-editor="${esc(m.id)}">
        <p class="tp-photo-editor-intro">${esc(m.from)}的照片。修改只套用到這張圖片；重新生成成功後才會替換千里傳音中的原圖。</p>
        <div class="tp-photo-editor-pickers">${field('圖片預設', select('photo-preset', draft.presetId || '', presetChoices))}${field('NovelAI 模型', select('photo-model', draft.model, models))}</div>
        <p class="tp-photo-editor-hint">選擇預設會帶入模型、畫師串及正負面提示詞，保留這張圖片的場景。</p>
        ${field('圖片內容與場景', textArea('photo-scene', draft.scene || '', 'rows="5" maxlength="16000" placeholder="角色外貌、身材、穿著、動作、場景與構圖"'), '此欄是這張圖片的場景提示詞，包含已讀取的外貌資料。英文標籤通常較適合 NovelAI；畫師標籤與權重會保留原文。')}
        ${api.pocketOptimizePhoto ? `<div class="actions">${btn('photo-edit-optimize', '依劇情整理提示詞', 'secondary')}</div><p class="tp-photo-editor-hint">使用已選文字模型讀取正文與手機世界書，整理英文畫面提示詞；此步不生成圖片。</p>` : ''}
        ${field('畫師串', textArea('photo-artist', draft.artist || '', 'rows="3" maxlength="10000" placeholder="artist:artist_name, 1.2::artist:another_artist::"'))}
        ${field('正面提示詞', textArea('photo-positive', draft.positive || '', 'rows="4" maxlength="12000" placeholder="希望出現的畫風、品質與細節"'))}
        ${field('負面提示詞', textArea('photo-negative', draft.negative || '', 'rows="4" maxlength="12000" placeholder="不希望出現的內容與瑕疵"'))}
        <p class="tp-photo-editor-error" data-photo-editor-error role="alert" hidden></p>
        <p class="tp-photo-editor-hint">「儲存」只保留設定。「儲存並重新生成」會使用你的 NovelAI API 與額度。</p>
        <div class="tp-photo-editor-actions">${btn('photo-edit-save', '儲存', 'secondary')}${btn('photo-edit-generate', icon('refresh') + '儲存並重新生成', 'primary')}</div>
      </div>`;
      d.body.addEventListener('change', e => {
        if (e.target.dataset.field !== 'photo-preset') return;
        const preset = presets.find(p => p.id === e.target.value);
        if (!preset) return;
        for (const [fieldName, source] of [['model', 'model'], ['artist', 'artist'], ['positive', 'positive'], ['negative', 'negative']]) {
          const el = d.body.querySelector(`[data-field=photo-${fieldName}]`);
          if (el && preset[source] !== undefined) el.value = String(preset[source]);
        }
      });
      let saving = false;
      d.body.addEventListener('click', e => {
        const button = e.target.closest('[data-action]');
        if (!button || !['photo-edit-save', 'photo-edit-generate', 'photo-edit-optimize'].includes(button.dataset.action) || saving) return;
        e.preventDefault();
        if (!current()) { d.close(); ctx.notify('聊天已切換，請重新開啟圖片設定'); return; }
        const regenerate = button.dataset.action === 'photo-edit-generate', optimize = button.dataset.action === 'photo-edit-optimize', key = `${id}:${m.id}`;
        const update = {token: draft.token, regenerate};
        for (const fieldName of ['scene', 'artist', 'positive', 'negative', 'model']) update[fieldName] = value(d, `photo-${fieldName}`);
        update.presetId = value(d, 'photo-preset');
        const error = d.body.querySelector('[data-photo-editor-error]');
        error.hidden = true;
        saving = true;
        for (const el of d.body.querySelectorAll('button, input, select, textarea')) el.disabled = true;
        if (regenerate) { generatingPhotos.add(key); render(); }
        ctx.win.Promise.resolve().then(() => optimize ? api.pocketOptimizePhoto(id, m.id, {token: draft.token, scene: update.scene}) : api.pocketEditPhoto(id, m.id, update)).then(result => {
          if (optimize) {
            if (current() && typeof result?.scene === 'string') { d.body.querySelector('[data-field=photo-scene]').value = result.scene; ctx.notify('提示詞已整理，可檢查後儲存或重新生成'); }
            return;
          }
          if (d.live) d.close();
          if (!v.disposed && mode === 'thread' && threadId === id) ctx.notify(regenerate ? '新圖片已加入千里傳音，原圖保留在相簿' : '這張圖片的提示詞已儲存');
        }).catch(err => {
          // The backend issues a new guard only while the original narrative and
          // photo still exist. Never read a fresh token from a newly switched chat.
          if (d.live && current() && err.code !== 'STALE' && typeof err.refreshToken === 'string') draft.token = err.refreshToken;
          if (d.live && current()) { error.textContent = err.message || String(err); error.hidden = false; }
          else if (!v.disposed) ctx.notify(err.message || String(err));
        }).finally(() => {
          saving = false;
          generatingPhotos.delete(key);
          if (d.live) for (const el of d.body.querySelectorAll('button, input, select, textarea')) el.disabled = false;
          if (!v.disposed && mode === 'thread' && threadId === id) render();
        });
      });
    } catch (error) {
      if (d.live) d.body.innerHTML = `<p class="help-copy" role="alert">${esc(error.message || error)}</p>`;
    }
  }

  // ---------- Menus ----------
  function messageMenu(m) {
    const photoThreadId = threadId;
    const contact = m.from !== 'me', last = contact && thread.messages.at(-1)?.id === m.id;
    const copyable = ['text', 'voice', 'location', 'photo'].includes(m.kind) && quoteText(m);
    const canRecall = !contact && !['redpacket', 'transfer', 'gift'].includes(m.kind);
    const shown = m.kind === 'voice' ? (m.translation || m.text) : m.kind === 'dice' ? `骰子 ${m.text} 點` : ['redpacket', 'transfer', 'gift'].includes(m.kind) ? preview(m) : quoteText(m);
    const voice = m.kind === 'voice', open = voice && (voiceText().auto || transcribed.has(m.id));
    const editablePhoto = m.kind === 'photo' && contact && typeof api.pocketPhotoDraft === 'function' && typeof api.pocketEditPhoto === 'function';
    const d = sheet('訊息', `${editablePhoto ? `<div class="actions">${btn('edit-photo', icon('edit') + '編輯圖片提示詞', 'primary')}</div>` : ''}${voice ? '' : `<p class="help-copy">${esc(shown)}</p>`}
      ${voice ? `<div class="actions">${btn('transcribe', icon('book') + (open ? '收起文字' : '轉文字'), 'primary')}${btn('download', icon('download') + '下載語音', 'secondary')}</div>` : ''}
      <div class="actions">${quotable(m) ? btn('quote', icon('reply') + '引用', 'secondary') : ''}${copyable ? btn('copy', icon('copy') + '複製', 'secondary') : ''}</div>
      <div class="actions">${canRecall ? btn('recall', icon('undo') + '撤回', 'secondary') : ''}${btn('delete', icon('trash') + '刪除', 'danger')}</div>
      ${last && live ? `<div class="actions">${btn('reroll', icon('refresh') + '重新回覆這一輪', 'secondary')}</div>` : ''}`, {
      'edit-photo': () => { d.close(); return editPhoto(m, photoThreadId); },
      transcribe: () => {
        d.close();
        if (open && voiceText().auto) { ctx.notify('語音自動轉文字開著，可以在右上角「⋯ → 語音訊息」裡關掉'); return; }
        if (open) transcribed.delete(m.id); else transcribed.add(m.id);
        render();
      },
      download: async () => { d.close(); const {blob, name} = await api.audioFile({line: lineOf(m)}); ctx.notify('已下載 ' + await saveFile(ctx.doc, blob, name)); },
      quote: () => { d.close(); quote = {from: m.from, text: quoteText(m).slice(0, 200)}; panel = null; render(); },
      copy: async () => { d.close(); ctx.notify(await copyText(ctx.win, m.kind === 'voice' ? m.text : quoteText(m)) ? '已複製' : '這個瀏覽器不讓複製，可以長按文字手動複製'); },
      recall: async () => {
        d.close();
        if (m.kind === 'text') recalled.set(m.id, m.text);
        await api.updateChatMessage(threadId, m.id, {recall: true});
      },
      delete: async () => { d.close(); await api.deleteChatMessages(threadId, [m.id]); },
      reroll: async () => { d.close(); await reroll(); }
    });
  }
  // Removes the contacts' latest messages (after the user's last one) and asks again.
  async function reroll() {
    const list = thread.messages, cut = list.findLastIndex(m => m.from === 'me' && m.kind !== 'system');
    const drop = list.slice(cut + 1).filter(m => m.from !== 'me').map(m => m.id);
    if (drop.length) await api.deleteChatMessages(threadId, drop);
    requestReply();
  }
  function newChat() {
    const contacts = api.chatContacts();
    const d = ctx.dialog('新建聊天', contacts.length
      ? `${groupTitle('私聊')}<div class="pick-list">${contacts.map(c => `<button class="list-row" data-new-dm="${esc(c.name)}">${avatar(c.name, c.engine, 36)}<span><strong>${esc(c.name)}</strong><small>${c.source === 'role' ? (c.voice ? '角色 · 能發語音' : '角色 · 只發文字') : '手動聯絡人'}</small></span>${icon('next')}</button>`).join('')}</div>
        ${contacts.length > 1 ? `${groupTitle('群聊')}<div class="pick-list">${contacts.map(c => `<label class="setting-row"><span>${avatar(c.name, c.engine, 28)}${esc(c.name)}</span><input class="switch" type="checkbox" data-member="${esc(c.name)}" aria-label="拉 ${esc(c.name)} 進群"></label>`).join('')}</div>
          ${field('群名', input('group-name', '', 'text', 'maxlength="40" placeholder="可以不填"'))}<div class="actions">${btn('create-group', icon('group') + '建群', 'primary')}</div>` : ''}
        <div class="actions">${btn('manage-contacts', icon('person') + '管理聯絡人', 'text-button')}</div>`
      : `<p class="help-copy">還沒有聯絡人。在角色 App 裡新增角色，或者手動新增一個聯絡人。</p><div class="actions">${btn('manage-contacts', icon('add') + '新增聯絡人', 'primary')}</div>`);
    d.body.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      ctx.win.Promise.resolve().then(async () => {
        if (b.dataset.newDm) {
          const existing = (await api.listThreads()).find(t => t.type === 'dm' && t.members[0] === b.dataset.newDm);
          const t = existing || await api.createThread({type: 'dm', members: [b.dataset.newDm]});
          d.close(); open(t.id);
        }
        if (b.dataset.action === 'create-group') {
          const members = [...d.body.querySelectorAll('[data-member]:checked')].map(x => x.dataset.member);
          const t = await api.createThread({type: 'group', members, name: d.body.querySelector('[data-field=group-name]').value});
          d.close(); open(t.id);
        }
        if (b.dataset.action === 'manage-contacts') { d.close(); mode = 'list'; tab = 'contacts'; contactDraft = null; render(); }
      }).catch(error => ctx.notify(error.message));
    });
  }
  /** Options for voice messages in every chat: what 转文字 shows, and whether it happens by itself. */
  function voiceTextSheet() {
    const draw = () => {
      const o = voiceText();
      return `<p class="help-copy">語音訊息平時只顯示語音條，長按（電腦上右鍵）選「轉文字」才顯示文字。</p>
        <div class="field"><span>轉文字顯示</span><div class="segmented" style="margin:0">${[['translation', '中文譯文'], ['original', '原文'], ['both', '原文和譯文']].map(([k, l]) => `<button data-action="vt-mode" data-mode="${k}" aria-pressed="${o.mode === k}">${l}</button>`).join('')}</div></div>
        <div class="setting-row"><span>新舊語音都自動轉文字</span><input class="switch" type="checkbox" data-field="vt-auto" aria-label="語音自動轉文字" ${o.auto ? 'checked' : ''}></div>`;
    };
    const d = sheet('語音訊息', `<div class="vt-body">${draw()}</div>`, {
      'vt-mode': b => { api.saveChatOptions({voiceText: {mode: b.dataset.mode}}); d.body.querySelector('.vt-body').innerHTML = draw(); render(); }
    });
    d.body.addEventListener('change', e => {
      if (!e.target.matches('[data-field=vt-auto]')) return;
      try { api.saveChatOptions({voiceText: {auto: e.target.checked}}); render(); } catch (error) { ctx.notify(error.message); }
    });
  }
  /** Where an avatar comes from, in words. */
  function avatarState(key) {
    const chosen = api.getState().chat.avatars?.[key];
    if (chosen?.kind === 'photo') return '用的是相簿裡的照片';
    if (chosen?.kind === 'text') return '只顯示文字';
    return avatarPicture(key) ? (key === 'me' ? '用的是酒館裡當前人設的頭像' : '用的是酒館角色卡的頭像') : '只顯示文字（酒館裡沒有這個頭像）';
  }
  /** Picks an avatar for the user ('me') or a contact: an album photo, a new picture, the tavern's avatar, or text. */
  async function avatarSheet(key) {
    const rows = (await api.listPhotos()).slice(0, 30), who = key === 'me' ? '我' : key, chosen = api.getState().chat.avatars?.[key];
    const d = ctx.dialog(`${who}的頭像`, `<p class="help-copy">點一張照片，或者上傳一張新的。</p>
      <label class="secondary file-button">${icon('import')}上傳圖片<input type="file" accept="image/*" data-avatar-file hidden></label>
      ${rows.length ? `<div class="photo-grid pick-photos">${rows.map(r => `<button data-avatar-photo="${esc(r.id)}" aria-label="用 ${esc(r.name)} 當頭像"${chosen?.photoId === r.id ? ' aria-pressed="true"' : ''}><img data-chat-photo="${esc(r.id)}" alt=""></button>`).join('')}</div>` : '<p class="hint">相簿裡還沒有照片。</p>'}
      <div class="actions">${btn('avatar-tavern', '用酒館的頭像', 'secondary')}${btn('avatar-text', '只顯示文字', 'text-button')}</div>`);
    for (const img of d.body.querySelectorAll('img[data-chat-photo]')) photoURL(img.dataset.chatPhoto).then(url => { if (url) img.src = url; });
    const choose = value => { d.close(); api.saveChatOptions({avatars: {[key]: value}}); ctx.notify('頭像已換好'); };
    d.body.addEventListener('click', e => {
      const photo = e.target.closest('[data-avatar-photo]')?.dataset.avatarPhoto;
      if (photo) return choose({kind: 'photo', photoId: photo});
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'avatar-tavern') choose(null);
      if (action === 'avatar-text') choose({kind: 'text'});
    });
    d.body.addEventListener('change', e => {
      const file = e.target.closest('[data-avatar-file]')?.files?.[0];
      if (!file) return;
      if (!/^image\//.test(file.type)) { ctx.notify('請選擇圖片檔案'); return; }
      api.addPhoto({name: file.name, blob: file}).then(photo => choose({kind: 'photo', photoId: photo.id})).catch(error => ctx.notify(error.message));
    });
  }
  /** 来电 options: characters calling by themselves (off by default), and how long a call rings. */
  function callsSheet() {
    const o = () => api.getState().calls;
    const draw = () => `<div class="setting-row"><span>角色自己打來${help('角色可以給你打語音電話：接通後用 TA 的音色說話，你打字回。開啟這裡後，每隔幾條正文回覆，角色可能會自己打來；不開啟時，聊天裡角色偶爾也會直接打過來（聊天預設的「打電話」規則）。每句話都要呼叫一次模型並生成語音。')}</span><input class="switch" type="checkbox" data-field="call-auto" aria-label="角色自己打來" ${o().auto ? 'checked' : ''}></div>
      <div class="field"><span>每幾條正文回覆可能打來一次</span><input data-field="call-every" type="number" min="1" max="100" value="${o().every}"></div>
      <div class="field"><span>每天最多</span><input data-field="call-dailyMax" type="number" min="1" max="10" value="${o().dailyMax}"></div>
      <div class="field"><span>響鈴多久算未接（秒）</span><input data-field="call-ring" type="number" min="15" max="60" value="${o().ring}"></div>`;
    const d = sheet('來電', `<div class="calls-body">${draw()}</div>`, {});
    d.body.addEventListener('change', e => {
      const key = e.target.dataset.field?.replace(/^call-/, '');
      if (!key) return;
      try { api.saveCalls({[key]: key === 'auto' ? e.target.checked : Number(e.target.value)}); d.body.querySelector('.calls-body').innerHTML = draw(); } catch (error) { ctx.notify(error.message); }
    });
  }
  /** A finished call: what was said, the voice message of a missed call, and calling back. */
  function callLog(m) {
    const name = m.from === 'me' ? thread.members[0] : m.from, who = l => l.from === 'me' ? '你' : l.from;
    const said = m.lines?.length ? `<div class="call-log">${m.lines.map(l => `<p><b>${esc(who(l))}：</b>${esc(l.translation || l.text)}</p>`).join('')}</div>` : '';
    const mail = m.voicemail?.length ? `<p class="help-copy"><b>語音留言：</b>${esc(m.voicemail.map(l => l.translation || l.text).join(' '))}</p>` : '';
    const d = sheet(callSummary(m), `${said || mail ? '' : '<p class="help-copy">這通電話沒有說話內容。</p>'}${mail}${said}
      <div class="actions">${m.voicemail?.length && ctx.routeFor(name)?.voice ? btn('call-mail', icon('play', true) + '聽留言', 'secondary') : ''}${api.callDial ? btn('call-back', icon('phone') + '回撥', 'primary') : ''}</div>`, {
      'call-mail': () => api.speak(m.voicemail.map(l => ({role: name, text: l.text, translation: l.translation, emotion: l.emotion}))),
      'call-back': async () => { d.close(); await api.callDial(name); }
    });
  }
  /** 置顶 / 免打扰 / 标为已读 / 删除, from a long press (or right click) on a conversation. */
  async function convMenu(id) {
    const t = (await api.listThreads()).find(x => x.id === id);
    if (!t) return;
    const d = ctx.dialog(t.name, `<div class="pick-list">
      <button class="list-row" data-menu="pin">${icon('pin')}<span><strong>${t.pinned ? '取消置頂' : '置頂'}</strong></span></button>
      <button class="list-row" data-menu="mute">${icon('mute')}<span><strong>${t.muted ? '取消免打擾' : '訊息免打擾'}</strong><small>免打擾的聊天不算進桌面上的未讀數</small></span></button>
      ${t.unread ? `<button class="list-row" data-menu="read">${icon('check')}<span><strong>標為已讀</strong></span></button>` : ''}
      <button class="list-row" data-menu="delete">${icon('trash')}<span><strong>刪除聊天</strong></span></button></div>`);
    d.body.addEventListener('click', e => {
      const action = e.target.closest('[data-menu]')?.dataset.menu;
      if (!action) return;
      d.close();
      ctx.win.Promise.resolve().then(async () => {
        if (action === 'pin') await api.updateThread(id, {pinned: !t.pinned});
        if (action === 'mute') await api.updateThread(id, {muted: !t.muted});
        if (action === 'read') await api.markThreadRead(id);
        if (action === 'delete' && await ctx.confirm('刪除這段聊天？', '聊天記錄會一起刪除，聯絡人不受影響。')) await api.deleteThread(id);
        render();
      }).catch(error => ctx.notify(error.message));
    });
  }
  function plusMenu() {
    const d = ctx.dialog('發起', `<div class="pick-list">
      <button class="list-row" data-menu="chat">${icon('chat')}<span><strong>發起聊天</strong><small>私聊，或者拉幾個人建群</small></span></button>
      <button class="list-row" data-menu="contact">${icon('person')}<span><strong>新增聯絡人</strong><small>劇情之外的人，寫上人設就能聊</small></span></button>
      <button class="list-row" data-menu="me">${icon('smile')}<span><strong>個性裝扮</strong><small>氣泡、頭像掛件、聊天背景、狀態</small></span></button></div>`);
    d.body.addEventListener('click', e => {
      const action = e.target.closest('[data-menu]')?.dataset.menu;
      if (!action) return;
      d.close();
      if (action === 'chat') newChat();
      if (action === 'contact') { contactDraft = {name: '', persona: ''}; mode = 'contact-edit'; render(); }
      if (action === 'me') { mode = 'me'; render(); }
    });
  }
  async function pickBackground() {
    const rows = await api.listPhotos();
    if (!rows.length) throw Error('相簿裡還沒有照片，先在相簿裡匯入一張');
    const d = ctx.dialog('選一張聊天背景', `<div class="photo-grid pick-photos">${rows.slice(0, 30).map(r => `<button data-bg-photo="${esc(r.id)}" aria-label="用 ${esc(r.name)} 當背景"><img data-chat-photo="${esc(r.id)}" alt="${esc(r.name)}"></button>`).join('')}</div>`);
    for (const img of d.body.querySelectorAll('img[data-chat-photo]')) photoURL(img.dataset.chatPhoto).then(url => { if (url) img.src = url; });
    d.body.addEventListener('click', e => {
      const id = e.target.closest('[data-bg-photo]')?.dataset.bgPhoto;
      if (!id) return;
      d.close();
      api.saveChatOptions({profile: {backgroundPhoto: id}});
      render();
    });
  }
  async function openDm(name) {
    const existing = (await api.listThreads()).find(t => t.type === 'dm' && t.members[0] === name);
    const t = existing || await api.createThread({type: 'dm', members: [name]});
    open(t.id);
  }
  function threadMenu() {
    const group = thread.type === 'group';
    const d = ctx.dialog(thread.name, `<div class="pick-list">
      ${live ? `<button class="list-row" data-menu="reroll">${icon('refresh')}<span><strong>重新回覆最後一輪</strong></span></button>` : ''}
      ${group ? `<button class="list-row" data-menu="rename">${icon('edit')}<span><strong>改群名</strong></span></button>` : ''}
      <button class="list-row" data-menu="voice-text">${icon('book')}<span><strong>語音訊息</strong><small>轉文字顯示什麼、要不要自動轉</small></span></button>
      <button class="list-row" data-menu="clear">${icon('trash')}<span><strong>清空聊天記錄</strong></span></button>
      <button class="list-row" data-menu="delete">${icon('close')}<span><strong>刪除這段聊天</strong></span></button></div>`);
    d.body.addEventListener('click', e => {
      const action = e.target.closest('[data-menu]')?.dataset.menu;
      if (!action) return;
      d.close();
      ctx.win.Promise.resolve().then(async () => {
        if (action === 'reroll') await reroll();
        if (action === 'rename') {
          const r = ctx.dialog('改群名', `${field('群名', input('rename', thread.name, 'text', 'maxlength="40"'))}<div class="actions">${btn('rename-save', '儲存', 'primary')}</div>`);
          r.body.addEventListener('click', ev => { if (ev.target.closest('[data-action=rename-save]')) { const name = r.body.querySelector('[data-field=rename]').value; r.close(); api.updateThread(threadId, {name}).catch(err => ctx.notify(err.message)); } });
        }
        if (action === 'voice-text') voiceTextSheet();
        if (action === 'clear' && await ctx.confirm('清空聊天記錄？', '這段聊天會保留，訊息全部刪除。')) await api.deleteChatMessages(threadId, thread.messages.map(m => m.id));
        if (action === 'delete' && await ctx.confirm('刪除這段聊天？', '聊天記錄會一起刪除，聯絡人不受影響。')) { await api.deleteThread(threadId); mode = 'list'; threadId = null; render(); }
      }).catch(error => ctx.notify(error.message));
    });
  }

  v.on('input', '[data-field=draft]', el => { drafts.set(threadId, el.value); syncSend(); });
  v.on('input', '[data-field=chat-search]', el => { search = el.value; searching = true; render(); });
  v.on('focusout', '[data-field=chat-search]', () => { searching = false; });
  v.on('change', '[data-field^=me-]', el => {
    const key = el.dataset.field.slice(3);
    try { api.saveChatOptions({profile: {[key]: el.value}}); render(); } catch (error) { ctx.notify(error.message, {error: true}); }
  });
  // Long-press (or right-click) a conversation for 置顶 and 免打扰.
  let convPress = null, convPressedAt = 0;
  v.on('pointerdown', '.conv[data-conv]', (el, e) => {
    if (e.button > 0) return;
    ctx.win.clearTimeout(convPress?.timer);
    convPress = {x: e.clientX, y: e.clientY, timer: ctx.win.setTimeout(() => { convPress = null; convPressedAt = Date.now(); convMenu(el.dataset.conv); }, 480)};
  });
  for (const type of ['pointermove', 'pointerup', 'pointercancel']) v.on(type, '.conv[data-conv]', (el, e) => {
    if (!convPress || (e.type === 'pointermove' && Math.hypot(e.clientX - convPress.x, e.clientY - convPress.y) < 10)) return;
    ctx.win.clearTimeout(convPress.timer); convPress = null;
  });
  v.on('contextmenu', '.conv[data-conv]', (el, e) => { e.preventDefault(); if (Date.now() - convPressedAt > 1000) convMenu(el.dataset.conv); });
  v.on('keydown', '[data-field=draft]', (el, e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); return send(); } });
  // Typing closes the + panel, like a phone keyboard replacing it.
  v.on('focusin', '[data-field=draft]', () => { if (panel) { panel = null; syncPanel(); } });
  v.on('click', '.msg[data-mid]', el => {
    if (!selecting) return;
    const id = el.dataset.mid;
    if (selecting.has(id)) selecting.delete(id); else selecting.add(id);
    render();
  });
  // Double-tap an avatar to 拍一拍; long-press (or right-click) a message for its menu.
  v.on('dblclick', '[data-pat]', el => { if (!selecting) return pat(el.dataset.pat); });
  // Long-press works the same on phones that do not send contextmenu (iOS): hold a message for half a second.
  v.on('pointerdown', '.msg[data-mid] .m-body', (el, e) => {
    if (selecting || e.button > 0) return;
    const id = el.closest('.msg').dataset.mid, sourceThread = threadId;
    ctx.win.clearTimeout(press?.timer);
    press = {x: e.clientX, y: e.clientY, timer: ctx.win.setTimeout(() => {
      press = null;
      if (v.disposed || mode !== 'thread' || threadId !== sourceThread || !el.isConnected) return;
      const m = thread?.messages.find(x => x.id === id);
      if (m) { pressedAt = Date.now(); messageMenu(m); }
    }, 480)};
  });
  const cancelPress = (el, e) => {
    if (!press || (e.type === 'pointermove' && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 10)) return;
    ctx.win.clearTimeout(press.timer);
    press = null;
  };
  for (const type of ['pointermove', 'pointerup', 'pointercancel']) v.on(type, '*', cancelPress);
  const cancelScrollPress = () => { ctx.win.clearTimeout(press?.timer); press = null; };
  v.root.addEventListener('scroll', cancelScrollPress, true);
  v.on('dragstart', '.chat-photo img', (el, e) => e.preventDefault());
  v.on('contextmenu', '.msg[data-mid]', (el, e) => {
    if (Date.now() - pressedAt < 1000) { e.preventDefault(); return; }
    if (selecting) return;
    const m = thread?.messages.find(x => x.id === el.dataset.mid);
    if (m) { e.preventDefault(); messageMenu(m); }
  });
  v.on('click', '[data-action]', async el => {
    const action = el.dataset.action;
    if (mode === 'list' && tab === 'moments' && await moments.click(el)) return;
    // The click that ends a long-press on a conversation only opened its menu.
    if (action === 'open' && el.dataset.conv && Date.now() - convPressedAt < 700) return;
    // The click that ends a long-press only closes the press, it does not play or open anything.
    if (Date.now() - pressedAt < 700 && el.closest('.msg')) return;
    if (selecting && ['message', 'voice', 'photo', 'photo-options', 'photo-retry', 'photo-setup', 'packet', 'transfer', 'gift', 'profile'].includes(action)) return;
    const find = () => thread.messages.find(x => x.id === el.dataset.mid);
    switch (action) {
      case 'pocket-confirm-payment': {
        const payment = find(), id = threadId;
        if (!payment?.source?.id || !payment.text?.startsWith('[待確認付款]')) break;
        if (!await ctx.confirm('確認從千里傳音靈石袋付款？', payment.text.slice('[待確認付款]'.length).trim())) break;
        el.disabled = true;
        try { await api.pocketConfirmPayment(id, payment.source.id); ctx.notify('付款已處理'); }
        catch (error) { ctx.notify(error.message || String(error), {error: true}); }
        finally { if (!v.disposed && mode === 'thread' && threadId === id) render(); }
        break;
      }
      case 'tab': {
        if (tab !== el.dataset.tab) { v.root.dataset.switching = el.dataset.tab; ctx.win.clearTimeout(switchTimer); switchTimer = ctx.win.setTimeout(() => delete v.root.dataset.switching, 420); }
        tab = el.dataset.tab; search = ''; if (tab === 'moments') moments.only(''); v.root.scrollTop = 0; render(); break;
      }
      case 'open': open(el.dataset.id); break;
      case 'new-chat': newChat(); break;
      case 'plus-menu': plusMenu(); break;
      case 'me': mode = 'me'; render(); break;
      case 'me-set': api.saveChatOptions({profile: {[el.dataset.key]: el.dataset.value}}); render(); break;
      case 'me-buy': {
        const left = api.wallet().balance, price = Number(el.dataset.price);
        if (!await ctx.confirm(`買下「${el.dataset.name}」？`, `${yuan(price)}，靈石還有 ${yuan(left)}。買下以後一直能用。`)) break;
        api.buyDecoration(el.dataset.key, el.dataset.value);
        api.saveChatOptions({profile: {[el.dataset.key]: el.dataset.value}});
        render(); ctx.notify('買下並換上了');
        break;
      }
      case 'me-wallet': openWallet(); break;
      case 'me-shop': openShop(); break;
      case 'me-bg-photo': await pickBackground(); break;
      case 'me-bg-clear': api.saveChatOptions({profile: {backgroundPhoto: ''}}); render(); break;
      case 'me-voice': voiceTextSheet(); break;
      case 'me-calls': callsSheet(); break;
      case 'avatar-pick': await avatarSheet(el.dataset.key); break;
      case 'call': await api.callDial(thread.members[0]); break;
      case 'profile-call': await api.callDial(profileOf); break;
      case 'call-log': { const m = find(); if (m) callLog(m); break; }
      case 'me-presets': ctx.open('presets'); ctx.showPresetKind?.('chat'); break;
      case 'dm-open': await openDm(el.dataset.name); break;
      case 'profile': profileOf = el.dataset.name; mode = 'profile'; render(); break;
      case 'profile-chat': await openDm(profileOf); break;
      case 'profile-status-edit': await openContactStatusEditor(ctx, profileOf, {onSaved: () => { if (!v.disposed && mode === 'profile') render(); }}); break;
      case 'profile-delete':
        if (await deleteContactWithConfirmation(ctx, api.chatContacts().find(contact => contact.name === profileOf) || profileOf)) { profileOf = null; mode = 'list'; tab = 'contacts'; render(); }
        break;
      case 'profile-moments': mode = 'list'; tab = 'moments'; moments.only(profileOf); render(); break;
      case 'star': {
        const list = starred(), on = !list.includes(profileOf);
        api.saveChatOptions({starred: on ? [...list, profileOf] : list.filter(n => n !== profileOf)});
        ctx.notify(on ? `已把 ${profileOf} 設為特別關心` : '已取消特別關心');
        render();
        break;
      }
      case 'send': await send(); break;
      case 'panel': panel = panel ? null : 'tools'; syncPanel(); break;
      case 'panel-tools': panel = 'tools'; syncPanel(); break;
      case 'tool-emoji': panel = 'emoji'; syncPanel(); break;
      case 'emoji-pick': insertText(el.dataset.emoji); break;
      case 'emoji-del': deleteChar(); break;
      case 'tool-photo': panel = null; syncPanel(); await sendPhoto(); break;
      case 'tool-redpacket': panel = null; syncPanel(); sendPacket(); break;
      case 'tool-transfer': panel = null; syncPanel(); sendTransfer(); break;
      case 'tool-gift': panel = null; syncPanel(); sendGift(); break;
      case 'tool-location': panel = null; syncPanel(); sendLocation(); break;
      case 'tool-pat': panel = null; syncPanel(); await choosePat(); break;
      case 'tool-dice': panel = null; syncPanel(); await rollDice(); break;
      case 'tool-nudge': panel = null; syncPanel(); requestReply(); break;
      case 'quote-off': quote = null; render(); break;
      case 're-edit': {
        const text = recalled.get(el.dataset.mid) || '';
        recalled.delete(el.dataset.mid);
        drafts.set(threadId, (drafts.get(threadId) || '') + text);
        render();
        break;
      }
      case 'message': { const m = find(); if (m) messageMenu(m); break; }
      case 'photo-options': { const m = find(); if (m) messageMenu(m); break; }
      case 'photo': {
        const m = find(), id = threadId, img = el.querySelector('img');
        if (!m || !img?.src) break;
        openImageViewer({doc: ctx.doc, src: img.src, alt: img.alt, from: img, actions: [downloadAction(ctx.doc, () => ({source: img.src, name: `${m.from === 'me' ? '我' : m.from} 的照片`}), ctx.notify), {label: '訊息選項', run: () => messageMenu(m)}, ...(m.from !== 'me' && typeof api.pocketPhotoDraft === 'function' ? [{label: '編輯提示詞', run: () => editPhoto(m, id)}] : [])]});
        break;
      }
      case 'photo-setup': ctx.open('engines'); ctx.editEngine?.('nai'); break;
      case 'photo-retry': {
        const m = find(), id = threadId, key = `${id}:${m?.id}`;
        if (!m || generatingPhotos.has(key)) break;
        if (!api.keyStatus?.('nai')) { ctx.open('engines'); ctx.editEngine?.('nai'); break; }
        generatingPhotos.add(key);
        render();
        try {
          await api.pocketResolvePhoto(id, m.id, {generate: true, engine: 'nai', allowPaid: true, retry: true, ...(m.photoId || m.image ? {regenerate: true} : {})});
          if (!v.disposed) ctx.notify('角色圖片已加入千里傳音與相簿');
        } finally {
          generatingPhotos.delete(key);
          if (!v.disposed && mode === 'thread' && threadId === id) render();
        }
        break;
      }
      case 'packet': { const m = find(); if (m) openPacket(m); break; }
      case 'transfer': { const m = find(); if (m) openTransfer(m); break; }
      case 'gift': { const m = find(); if (m) openGift(m); break; }
      case 'voice': {
        const m = find();
        if (!m) break;
        if (!ctx.routeFor(m.from)?.voice) { ctx.notify(`${m.from} 還沒有配音`); break; }
        if (el.dataset.state === 'playing') { api.stop(); break; }
        await api.speak(lineOf(m));
        break;
      }
      case 'thread-menu': threadMenu(); break;
      case 'bring': selecting = selecting ? null : new Set(); panel = null; render(); break;
      case 'bring-go': {
        const count = selecting.size;
        if (!live) throw Error('在酒館裡開啟傳音玉符時才能帶進劇情');
        await api.chatBring(threadId, [...selecting]);
        selecting = null;
        ctx.notify(`下一次正文會帶上這 ${count} 條訊息`);
        render();
        break;
      }
      case 'cancel-bring': api.chatCancelBring?.(); ctx.notify('已取消'); render(); break;
      case 'contact-add': contactDraft = {name: '', persona: ''}; mode = 'contact-edit'; render(); break;
      case 'contact-edit': contactDraft = structuredClone(api.getState().chat.contacts.find(c => c.id === el.dataset.id)); mode = 'contact-edit'; render(); break;
      case 'contact-cancel': contactDraft = null; mode = 'list'; render(); break;
      case 'contact-save': {
        contactDraft.name = v.root.querySelector('[data-field=contact-name]').value;
        contactDraft.persona = v.root.querySelector('[data-field=contact-persona]').value;
        api.saveContact(contactDraft);
        contactDraft = null;
        mode = 'list';
        ctx.notify('聯絡人已儲存');
        render();
        break;
      }
      case 'contact-restore':
        await api.restoreContact(el.dataset.name); ctx.notify(`已恢復「${el.dataset.name}」`); mode = 'list'; tab = 'contacts'; render();
        break;
      case 'contact-delete':
        if (await deleteContactWithConfirmation(ctx, contactDraft)) { contactDraft = null; mode = 'list'; tab = 'contacts'; render(); }
        break;
    }
  });

  v.back = () => {
    if (photoEditor?.live) { closePhotoEditor(); return true; }
    if (mode === 'thread' && panel) { panel = null; syncPanel(); return true; }
    if (mode === 'thread' && selecting) { selecting = null; render(); return true; }
    if (mode !== 'list') { mode = 'list'; threadId = null; selecting = null; quote = null; contactDraft = null; render(); return true; }
    if (tab !== 'msgs') { tab = 'msgs'; render(); return true; }
    return false;
  };
  v.refresh = () => render();
  v.onAvatars = () => render();
  v.openThread = open;
  v.onChat = event => {
    if (mode === 'list' && tab !== 'moments') return render();
    if (mode === 'profile') return render();
    if (mode === 'thread' && (!event.threadId || event.threadId === threadId)) return render();
  };
  v.onPlayback = () => { if (mode === 'thread') paintVoices(); };
  v.onMoments = () => { if (mode === 'list') render(); };
  const dispose = v.dispose;
  v.dispose = () => { closePhotoEditor(); cancelScrollPress(); ctx.win.clearTimeout(convPress?.timer); v.root.removeEventListener('scroll', cancelScrollPress, true); moments.dispose(); for (const url of photoURLs.values()) if (url) ctx.win.URL.revokeObjectURL(url); photoURLs.clear(); dispose(); };
  render();
  return v;
}
