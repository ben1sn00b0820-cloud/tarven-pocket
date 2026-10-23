/**
 * Deterministic phone-event projection. No DOM, host APIs, storage, clocks,
 * randomness, eval, or network access belong in this module.
 */
const LIMITS = Object.freeze({ block: 100_000, message: 2_000_000, events: 256, text: 20_000 });
const ACTIONS = Object.freeze({
    wechat: new Set(['message', 'transfer', 'redpacket', 'accept', 'refund']),
    instagram: new Set(['message', 'post', 'like', 'comment']),
    diary: new Set(['entry']),
    wallet: new Set(['set_balance']),
    shop: new Set(['purchase']),
});
const EVENT_KEYS = new Set(['id', 'app', 'action', 'from', 'to', 'text', 'amount', 'ref', 'title', 'image']);
const CONTROL = /[\u0000-\u001f\u007f]/;
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function stringField(value, field, maximum, required = false) {
    if (value === undefined && !required) return undefined;
    if (typeof value !== 'string' || value.length > maximum || !value.trim()) {
        throw new Error(`${field} 必須是非空字串，且不可超過 ${maximum} 個字元。`);
    }
    if (['id', 'from', 'to', 'ref'].includes(field) && CONTROL.test(value)) {
        throw new Error(`${field} 不可包含控制字元。`);
    }
    return value;
}

function moneyToCents(value, allowZero = false) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value > 1_000_000 ||
        value < 0 || (!allowZero && value === 0) || !/^\d+(?:\.\d{1,2})?$/.test(String(value))) {
        throw new Error(`金額必須${allowZero ? '大於或等於' : '大於'} 0、最多 1,000,000 元，且最多兩位小數。`);
    }
    return Math.round(value * 100);
}

function safeImage(value) {
    stringField(value, 'image', 2048, true);
    if (CONTROL.test(value) || /[\\<>"`]/.test(value) || value !== value.trim()) {
        throw new Error('image 含有不安全的 URL 字元。');
    }
    if (value.startsWith('/') && !value.startsWith('//')) {
        let path;
        try { path = decodeURIComponent(value.split(/[?#]/, 1)[0]); }
        catch { throw new Error('image 的路徑編碼無效。'); }
        if (path.startsWith('//') || /[\\<>"`]/.test(path) || CONTROL.test(path) || path.split('/').includes('..')) {
            throw new Error('image 必須使用安全的站內路徑。');
        }
        return value;
    }
    let url;
    try { url = new URL(value); }
    catch { throw new Error('image 必須是 HTTP(S) URL 或以 / 開頭的安全站內路徑。'); }
    if (!['https:', 'http:'].includes(url.protocol) || !/^https?:\/\//i.test(value) || !url.hostname || url.username || url.password) {
        throw new Error('image 僅支援 HTTP(S) URL 或安全站內路徑。');
    }
    return value;
}

function validateEvent(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('每個手機事件必須是 JSON 物件。');
    for (const key of Object.keys(input)) {
        if (!EVENT_KEYS.has(key)) throw new Error(`不支援的手機事件欄位：${key}。`);
    }
    const event = {
        id: stringField(input.id, 'id', 128, true),
        app: stringField(input.app, 'app', 32, true),
        action: stringField(input.action, 'action', 32, true),
        from: stringField(input.from, 'from', 128, true),
    };
    if (!own(ACTIONS, event.app) || !ACTIONS[event.app].has(event.action)) throw new Error('不支援的 app / action 組合。');
    for (const [key, limit] of [['to', 128], ['ref', 128], ['text', LIMITS.text], ['title', 256]]) {
        if (input[key] !== undefined) event[key] = stringField(input[key], key, limit);
    }
    if (input.image !== undefined) event.image = safeImage(input.image);
    if (input.amount !== undefined) {
        moneyToCents(input.amount, event.app === 'wallet' && event.action === 'set_balance');
        event.amount = input.amount;
    }
    if (event.action === 'message') {
        stringField(event.to, 'to', 128, true);
        if (!event.text && !event.image) throw new Error('message 必須包含 text 或 image。');
    }
    if (event.app === 'wechat' && ['transfer', 'redpacket'].includes(event.action)) {
        stringField(event.to, 'to', 128, true);
        moneyToCents(event.amount);
    }
    if (['accept', 'refund', 'like', 'comment', 'purchase'].includes(event.action)) stringField(event.ref, 'ref', 128, true);
    if (event.action === 'post' && !event.text && !event.image) throw new Error('post 必須包含 text 或 image。');
    if (['entry', 'comment'].includes(event.action)) stringField(event.text, 'text', LIMITS.text, true);
    if (event.app === 'wallet' || event.app === 'shop') {
        moneyToCents(event.amount, event.action === 'set_balance');
        if (event.to !== undefined || event.image !== undefined) throw new Error('錢包調整與商城購買不接受 to / image。');
    }
    if (event.action === 'purchase') stringField(event.title, 'title', 256, true);
    if (event.amount !== undefined && !['transfer', 'redpacket', 'set_balance', 'purchase'].includes(event.action)) throw new Error('只有 transfer / redpacket / set_balance / purchase 可以包含 amount。');
    return event;
}

/** Parse complete, explicitly tagged JSON only. An unfinished streaming block is ignored. */
export function parseEvents(text) {
    const events = [];
    const errors = [];
    if (typeof text !== 'string') return { events, errors };
    if (text.length > LIMITS.message) {
        errors.push({ blockIndex: -1, message: `訊息過長，手機解析上限為 ${LIMITS.message} 個字元。` });
        return { events, errors };
    }
    const blocks = /<phone>([\s\S]*?)<\/phone>/g;
    let match;
    let blockIndex = 0;
    let seen = 0;
    while ((match = blocks.exec(text)) !== null) {
        const currentBlock = blockIndex++;
        if (match[1].length > LIMITS.block) {
            errors.push({ blockIndex: currentBlock, message: `手機區塊過長，上限為 ${LIMITS.block} 個字元。` });
            continue;
        }
        let parsed;
        try { parsed = JSON.parse(match[1]); }
        catch { errors.push({ blockIndex: currentBlock, message: '手機區塊不是有效 JSON。' }); continue; }
        const candidates = Array.isArray(parsed) ? parsed : [parsed];
        if (candidates.length === 0) {
            errors.push({ blockIndex: currentBlock, message: '手機事件陣列不可為空。' });
            continue;
        }
        if (seen + candidates.length > LIMITS.events) {
            errors.push({ blockIndex: currentBlock, message: `單則訊息最多包含 ${LIMITS.events} 個手機事件。` });
            break;
        }
        seen += candidates.length;
        for (let eventIndex = 0; eventIndex < candidates.length; eventIndex++) {
            try { events.push(validateEvent(candidates[eventIndex])); }
            catch (error) { errors.push({ blockIndex: currentBlock, eventIndex, message: error.message }); }
        }
    }
    return { events, errors };
}

/** Use this instead of concatenating unescaped JSON into a phone tag. */
export function encodeEvent(event) {
    const valid = Array.isArray(event) ? event.map(validateEvent) : validateEvent(event);
    if (Array.isArray(valid) && (!valid.length || valid.length > LIMITS.events)) throw new Error('手機事件陣列數量無效。');
    const json = JSON.stringify(valid).replace(/</g, '\\u003c');
    if (json.length > LIMITS.block) throw new Error('手機區塊過長。');
    return `<phone>${json}</phone>`;
}

function actorOption(value, fallback) {
    try { return stringField(value, 'from', 128, true); }
    catch { return fallback; }
}

/** Recompute exclusively from the active mes text. Calling it again never re-pays a transaction. */
export function buildState(chat, options = {}) {
    const userName = actorOption(options.userName, '你');
    const characterName = actorOption(options.characterName, '角色');
    const state = {
        events: [], errors: [], contacts: [], messages: [], posts: [], diaries: [],
        accounts: Object.create(null), transactions: [], ledger: [], inventory: [],
    };
    let initialCents = 100_000;
    if (options.initialBalance !== undefined) {
        try { initialCents = moneyToCents(options.initialBalance, true); }
        catch (error) { state.errors.push({ messageIndex: -1, message: `初始餘額無效，採用 1,000 元：${error.message}` }); }
    }
    state.accounts[userName] = initialCents;
    // Ids identify immutable attempts, including authorized attempts rejected by
    // business rules. Repeating one later must not exploit changed preconditions.
    const attempts = new Map();
    const transactions = new Map();
    const posts = new Map();
    const contacts = new Set();
    const accountBalance = name => own(state.accounts, name) ? state.accounts[name] : initialCents;
    const registerActor = name => {
        if (!name) return;
        if (!own(state.accounts, name)) state.accounts[name] = initialCents;
        if (name !== userName) contacts.add(name);
    };
    const ledgerEntry = (event, name, delta, kind, transactionId) => {
        state.accounts[name] += delta;
        state.ledger.push({
            id: `${event.id}:${kind}`, eventId: event.id, transactionId, account: name,
            from: event.from, to: event.to, app: event.app, action: event.action,
            kind, delta, cents: delta, balance: state.accounts[name], messageIndex: event.messageIndex,
        });
    };
    for (const [messageIndex, message] of (Array.isArray(chat) ? chat : []).entries()) {
        if (!message || message.is_system === true || message.role === 'system') continue;
        const parsed = parseEvents(message.mes);
        for (const error of parsed.errors) state.errors.push({ ...error, messageIndex });
        const isUser = message.is_user === true || message.role === 'user';
        const speaker = isUser ? characterName : actorOption(message.name, characterName);
        const resolve = name => name === '{{user}}' ? userName : name === '{{char}}' ? speaker : name;
        for (const original of parsed.events) {
            const event = { ...original, from: resolve(original.from), messageIndex };
            if (original.to !== undefined) event.to = resolve(original.to);
            try {
                if (isUser && event.from !== userName) throw new Error('使用者訊息只能以使用者本人名義發送手機事件。');
                if (!isUser && event.from === userName) throw new Error('角色訊息不可代替使用者發送手機事件。');
                if (!isUser && (event.app === 'wallet' || event.app === 'shop')) throw new Error('只有使用者本人可調整錢包餘額或購買商城物品。');
                const identity = JSON.stringify({ ...event, messageIndex: undefined });
                if (attempts.has(event.id)) {
                    if (attempts.get(event.id) !== identity) throw new Error(`事件 id「${event.id}」已被其他內容使用。`);
                    continue;
                }
                attempts.set(event.id, identity);
                let transaction;
                let post;
                let cents;
                // Validate all business rules before creating accounts or mutating any collection.
                if (event.app === 'wechat' && ['transfer', 'redpacket'].includes(event.action)) {
                    if (event.from === event.to) throw new Error('不可向自己轉帳或發紅包。');
                    cents = moneyToCents(event.amount);
                    if (accountBalance(event.from) < cents) throw new Error(`${event.from} 的錢包餘額不足。`);
                }
                if (event.app === 'wechat' && ['accept', 'refund'].includes(event.action)) {
                    transaction = transactions.get(event.ref);
                    if (!transaction) throw new Error(`找不到先前的交易「${event.ref}」。`);
                    if (transaction.status !== 'pending') throw new Error('交易已結算，不可再次領取或退回。');
                    if (event.action === 'accept' && event.from !== transaction.to) throw new Error('只有收款人可以領取這筆交易。');
                    if (event.action === 'refund' && ![transaction.from, transaction.to].includes(event.from)) throw new Error('只有付款人或收款人可以退回這筆交易。');
                    if (event.to !== undefined && event.to !== (event.from === transaction.from ? transaction.to : transaction.from)) {
                        throw new Error('交易處理事件的 to 必須是原交易的另一方。');
                    }
                }
                if (event.app === 'instagram' && ['like', 'comment'].includes(event.action)) {
                    post = posts.get(event.ref);
                    if (!post) throw new Error(`找不到先前的 Instagram 貼文「${event.ref}」。`);
                }
                if (event.app === 'wallet') cents = moneyToCents(event.amount, true);
                if (event.app === 'shop') {
                    cents = moneyToCents(event.amount);
                    if (accountBalance(event.from) < cents) throw new Error(`${event.from} 的錢包餘額不足。`);
                }
                registerActor(event.from);
                registerActor(event.to);
                state.events.push(event);
                if (event.app === 'wallet') {
                    // Only available funds are adjusted. Existing transfer escrow is independent.
                    ledgerEntry(event, event.from, cents - state.accounts[event.from], 'adjustment', event.id);
                } else if (event.app === 'shop') {
                    ledgerEntry(event, event.from, -cents, 'purchase', event.id);
                    // Keep the paid item snapshot in the source event. Future catalogues cannot rewrite a purchase.
                    state.inventory.push({
                        id: event.id, itemId: event.ref, ref: event.ref, title: event.title,
                        text: event.text, amount: event.amount, cents, owner: event.from,
                        from: event.from, messageIndex: event.messageIndex,
                    });
                } else if (event.action === 'message') state.messages.push({ ...event });
                else if (event.app === 'wechat' && ['transfer', 'redpacket'].includes(event.action)) {
                    transaction = { ...event, cents, status: 'pending' };
                    transactions.set(event.id, transaction);
                    state.transactions.push(transaction);
                    // A shared card object keeps the chat card settlement status up to date.
                    state.messages.push(transaction);
                    ledgerEntry(event, event.from, -cents, 'escrow', event.id);
                } else if (event.app === 'wechat' && ['accept', 'refund'].includes(event.action)) {
                    const recipient = event.action === 'accept' ? transaction.to : transaction.from;
                    transaction.status = event.action === 'accept' ? 'accepted' : 'refunded';
                    transaction.settledBy = event.from;
                    transaction.settledEventId = event.id;
                    ledgerEntry(event, recipient, transaction.cents, event.action, transaction.id);
                } else if (event.app === 'instagram' && event.action === 'post') {
                    post = { ...event, likes: [], comments: [] };
                    posts.set(event.id, post);
                    state.posts.push(post);
                } else if (event.app === 'instagram' && event.action === 'like') {
                    const index = post.likes.indexOf(event.from);
                    if (index < 0) post.likes.push(event.from);
                    else post.likes.splice(index, 1);
                } else if (event.app === 'instagram' && event.action === 'comment') post.comments.push({ ...event });
                else if (event.app === 'diary') state.diaries.push({ ...event });
            } catch (error) {
                state.errors.push({ messageIndex, eventId: event.id, message: error.message });
            }
        }
    }
    state.contacts = [...contacts];
    return state;
}

export function formatMoney(cents) {
    if (!Number.isSafeInteger(cents)) return '0.00';
    return (cents / 100).toFixed(2);
}

/** Human-readable text for the host transcript; render this as text, never HTML. */
export function describeEvent(event) {
    const from = event.from || '角色';
    const to = event.to || '對方';
    const note = event.text ? `：${event.text}` : '';
    const platform = event.app === 'instagram' ? 'Instagram' : '微信';
    switch (event.action) {
        case 'set_balance': return `${from} 手動將虛擬錢包可用餘額調整為 ${formatMoney(Math.round(Number(event.amount) * 100))} 元${note}`;
        case 'purchase': return `${from} 在手機商城花費 ${formatMoney(Math.round(Number(event.amount) * 100))} 元購買了「${event.title || '物品'}」${note}`;
        case 'message': return `${from} 拿起手機，透過 ${platform} 傳訊息給 ${to}${note}${event.image ? '（附圖）' : ''}`;
        case 'transfer': return `${from} 透過微信轉帳 ${formatMoney(Math.round(Number(event.amount) * 100))} 元給 ${to}${note}`;
        case 'redpacket': return `${from} 透過微信發了 ${formatMoney(Math.round(Number(event.amount) * 100))} 元紅包給 ${to}${note}`;
        case 'accept': return `${from} 在微信領取了款項（${event.ref || ''}）`;
        case 'refund': return `${from} 在微信退回了款項（${event.ref || ''}）`;
        case 'post': return `${from} 發布了一則 Instagram 貼文${note}${event.image ? '（附圖）' : ''}`;
        case 'like': return `${from} 切換了 Instagram 貼文的讚（${event.ref || ''}）`;
        case 'comment': return `${from} 在 Instagram 貼文下留言${note}`;
        case 'entry': return `${from} 在手機日記中寫下${event.title ? `〈${event.title}〉` : '一篇日記'}${note}`;
        default: return `${from} 使用了手機。`;
    }
}
