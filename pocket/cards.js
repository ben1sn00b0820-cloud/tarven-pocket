import {parsePhoneEvents, parseUserPhoneCommands, parseRolePhoneCommands, PHONE_LIMITS} from './events.js';
import {safePhotoUrl} from '../core/photo-url.js';
import {formatSpiritAmount} from '../core/currency.js';

export const escapeCardText = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bounded = (value, max = 20_000) => String(value ?? '').slice(0,max);
// The formatter runs before Markdown. Encode literal Markdown punctuation and
// newlines too: a phone message must not create links/emphasis or split a parent
// story paragraph. HTML entities display the exact original characters.
const text = (value, max) => escapeCardText(bounded(value,max)).replace(/[\\`*_~\[\]「」\r\n]/g, c => `&#${c.charCodeAt(0)};`);
const apps = {wechat:['千里傳音',''],instagram:['浮光錄','IG'],forum:['論道臺','壇'],diary:['修行札記','記'],shop:['萬寶閣','萬']};
const actions = {message:'訊息',group_message:'群組訊息',dm:'私訊',post:'貼文',story:'限時動態',comment:'留言',like:'按讚',contact:'角色資料',photo:'照片',voice:'語音',location:'位置',pat:'拍一拍',dice:'骰子',transfer:'轉帳',redpacket:'紅包',gift:'禮物',recall:'撤回',group_create:'建立群組',entry:'日記',payment_status:'款項狀態',purchase:'已購商品'};
const states = {sent:'已送出',pending:'待處理',accepted:'已收款',opened:'已領取',returned:'已退回',refunded:'已退款',rejected:'已拒收',declined:'已拒收',cancelled:'已取消',queued:'排隊生圖',generating:'正在生圖',error:'生圖未完成',done:'圖片已生成'};

const stamp = event => {
  const at = Number(event.at);
  if (!Number.isFinite(at) || at <= 0 || !Number.isFinite(new Date(at).getTime())) return '';
  const label = new Date(at).toLocaleTimeString('zh-TW', {hour:'2-digit',minute:'2-digit',hour12:false});
  return `<span class="tp-story-card-time">${text(label,30)}</span>`;
};
const heading = (app, label, icon, action, event) => `<span class="tp-story-card-top"><span class="tp-story-card-icon tp-story-icon-${app}" aria-hidden="true">${icon}</span><strong>${label}</strong><span class="tp-story-card-action">${text(action,40)}</span>${stamp(event)}</span>`;

/** Only the native activity bridge can render a settled shopping receipt.
 * Catalogue offers and model-authored shop blocks never imply a purchase.
 */
function purchaseCard(event, options) {
  if (options.source !== 'activity' || event.action !== 'purchase') return '';
  const title = event.itemName || event.title || '商品';
  const buyer = ['me','{{user}}'].includes(event.from) ? options.userName || '我' : event.from || options.userName || '我';
  const kind = event.itemKind || event.kind;
  const ability = ['ability','abilities'].includes(kind), item = ['item','items'].includes(kind);
  const settled = event.state === 'purchased';
  const status = settled ? '購買完成' : states[event.state] || '購買紀錄';
  const hasAmount = event.amount !== undefined && event.amount !== null && event.amount !== '' && Number.isFinite(Number(event.amount)) && Number(event.amount) >= 0;
  const money = hasAmount ? formatSpiritAmount(event.amount) : '未記載金額';
  const quantity = Number.isSafeInteger(Number(event.quantity)) && Number(event.quantity) > 0 ? Number(event.quantity) : 1;
  const destination = settled ? ability ? '已加入「我的能力」' : item ? '已加入「我的物品」' : '購買紀錄已保存' : '以手機內的訂單狀態為準';
  return `<span class="tp-story-card tp-story-shop tp-story-receipt" data-tp-card="${text(event.id || '',160)}" role="group" aria-label="${text(`萬寶閣 · ${status} · ${title}`,260)}">${heading('shop','萬寶閣','萬','專屬商城',event)}<span class="tp-story-receipt-head"><span class="tp-story-receipt-check${settled?' is-complete':''}" aria-hidden="true"></span><span><strong class="tp-story-receipt-status">${text(status,40)}</strong><span class="tp-story-receipt-buyer">${text(buyer,80)}的購買紀錄</span></span></span><span class="tp-story-receipt-product"><span class="tp-story-receipt-kind">${ability?'能力':item?'物品':'商品'}</span><strong class="tp-story-card-title">${text(title,256)}</strong><span class="tp-story-receipt-quantity">× ${quantity}</span></span>${event.text?`<span class="tp-story-card-body tp-story-receipt-description">${text(event.text,4000)}</span>`:''}<span class="tp-story-receipt-total"><span>${settled&&hasAmount?'支付靈石':'訂單金額'}</span><strong class="tp-story-card-amount">${text(money,80)}</strong></span><span class="tp-story-receipt-foot"><span class="tp-story-receipt-dot" aria-hidden="true"></span>${destination}</span></span>`;
}

/** Safe display only: no action handlers, no external image fetches and no imports.
 * Native activity events may carry settlement `state`; model protocol may not.
 */
export function renderPhoneCard(event, options = {}) {
  if (!event || typeof event !== 'object') return '';
  if (event.app === 'shop') return purchaseCard(event,options);
  const app = Object.hasOwn(apps,event.app) ? event.app : 'wechat';
  const [label,icon] = apps[app], action = event.action === 'payment_status' && ['transfer','redpacket','gift'].includes(event.paymentKind) ? `${actions[event.paymentKind]}狀態` : actions[event.action] || '手機紀錄';
  const actor = value => ['me','{{user}}'].includes(value) ? options.userName || '我' : value;
  const from = actor(event.from) || '角色';
  const route = event.group ? `群組 · ${event.group}` : event.to ? actor(event.to) : '';
  const paymentKind=event.action==='payment_status'?event.paymentKind:event.action;
  const financial = ['transfer','redpacket'].includes(paymentKind);
  const own=['me','{{user}}'].includes(event.from)||event.from===options.userName||options.isUser===true;
  const amount = Number(event.amount);
  const money = financial && Number.isFinite(amount) && amount >= 0 ? `<span class="tp-story-card-amount">${text(formatSpiritAmount(amount),100)}</span>` : '';
  const link = safePhotoUrl(event.image);
  const imageLink = link ? `<a class="tp-story-card-image" href="${escapeCardText(link)}" target="_blank" rel="noopener noreferrer">查看圖片</a>` : event.photoId ? '<span class="tp-story-card-image">圖片已存入手機相簿</span>' : '';
  let body = event.text || (event.action === 'like' ? '按了讚' : event.action === 'recall' ? '撤回了一則訊息' : event.action === 'pat' ? `拍了拍 ${actor(event.target) || route}` : event.action === 'dice' ? `擲出了 ${event.value ?? ''} 點` : '');
  if (!body && event.profile) body = Object.entries(event.profile).map(([k,v])=>`${k}：${v}`).join('\n');
  let status = states[event.state] || '';
  if (financial && !status) status = options.source === 'user-command' || options.isUser === true ? '待手機確認 · 尚未扣款' : '待收取';
  if (!status && event.photoAuto) status = states[event.photoAuto.state] || '';
  const quote = event.quote ? `<span class="tp-story-card-quote">${text(actor(event.quote.from),40)}：${text(event.quote.text,200)}</span>` : '';
  const reference = event.ref ? `<span class="tp-story-card-ref">回應 ${text(event.ref,128)}</span>` : event.storyId ? `<span class="tp-story-card-ref">回覆限動 ${text(event.storyId,128)}</span>` : '';
  const paymentIcon=financial?`<span class="tp-story-payment-icon" aria-hidden="true">${paymentKind==='redpacket'?'福':''}</span>`:'';
  const topic=app==='forum'&&event.board?`<span class="tp-story-forum-board">${text(event.board,80)}</span>`:'';
  const forumFoot=app==='forum'?`<span class="tp-story-forum-foot"><span class="tp-story-forum-mark" aria-hidden="true"></span>${event.action==='comment'?'論道臺回覆':'論道臺貼文'}${options.source==='activity'?' · 已發佈':''}</span>`:'';
  const aria = `${label} · ${action} · ${from}${route?` → ${route}`:''}`;
  // Phrasing content is deliberate. SillyTavern inserts this inside a Markdown
  // paragraph, so div/blockquote would prematurely close and rearrange prose.
  return `<span class="tp-story-card tp-story-${app}${own?' tp-story-own':''}${financial?' tp-story-money':''}${financial&&paymentKind==='redpacket'?' tp-story-redpacket':financial?' tp-story-transfer':''}${app==='instagram'&&event.action==='story'?' tp-story-ig-story':''}" data-tp-card="${text(event.id || event.ref || '',160)}" role="group" aria-label="${text(aria,260)}">${heading(app,label,icon,action,event)}<span class="tp-story-thread"><span class="tp-story-avatar" aria-hidden="true">${text([...String(from)][0],2)}</span><span class="tp-story-stack"><span class="tp-story-card-route"><span class="tp-story-card-name">${text(from,80)}</span>${route?`<span class="tp-story-route-to">→ ${text(route,120)}</span>`:''}</span><span class="tp-story-card-content">${paymentIcon}${topic}${event.title?`<span class="tp-story-card-title">${text(event.title,256)}</span>`:''}${quote}${money}${body?`<span class="tp-story-card-body">${text(body)}</span>`:''}${imageLink}${event.detail?`<span class="tp-story-card-ref">${text(event.detail,200)}</span>`:''}${reference}${forumFoot}</span>${status?`<span class="tp-story-card-status">${text(status,80)}</span>`:''}</span></span></span>`;
}

export function renderActivityCards(events, options = {}) {
  return (Array.isArray(events)?events:[events]).slice(0,PHONE_LIMITS.events).map(event=>renderPhoneCard(event,{...options,source:'activity'})).join('');
}

/** Replaces valid complete protocol blocks and authenticated user commands.
 * Invalid or streaming blocks remain visible; rendering never changes chat data.
 */
export function renderPhoneCards(value, options = {}) {
  const source = String(value ?? '');
  if (source.length > PHONE_LIMITS.message) return source;
  const edits = [];
  let remaining = PHONE_LIMITS.events;
  for (const match of source.matchAll(/<phone>([\s\S]*?)<\/phone>/g)) {
    const parsed = parsePhoneEvents(match[0],options);
    if (!parsed.events.length) continue;
    if (remaining <= 0) break;
    parsed.events = parsed.events.slice(0,remaining); remaining -= parsed.events.length;
    edits.push({start:match.index,end:match.index+match[0].length,html:parsed.events.map(event=>renderPhoneCard(event,{...options,source:'story'})).join('') + (parsed.errors.length?'<span class="tp-story-card-error">部分手機事件格式有誤，未同步。</span>':'')});
  }
  const natural = options.isUser === false ? parseRolePhoneCommands(source,options) : parseUserPhoneCommands(source,options);
  for (const match of natural.matches) {
    if (remaining <= 0) break;
    if (edits.some(edit=>match.start<edit.end&&match.end>edit.start)) continue;
    remaining--;
    edits.push({...match,html:renderPhoneCard(match.event,{...options,source:options.isUser===false?'role-command':'user-command'})});
  }
  let output = source;
  for (const edit of edits.sort((a,b)=>b.start-a.start)) output=output.slice(0,edit.start)+edit.html+output.slice(edit.end);
  return output;
}
