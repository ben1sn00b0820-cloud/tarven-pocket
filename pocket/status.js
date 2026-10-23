/**
 * Read the raw Character Status Bar protocol, never its rendered HTML.
 * This module deliberately has no cache: editing, deleting, or switching a
 * swipe must rebuild the projection from the current chat's visible messages.
 * Returned values are plain text. Render them with textContent, not innerHTML.
 */
export const STATUS_LIMITS = Object.freeze({message: 1048576, panel: 262144, roles: 100, field: 16000, parts: 200});
export const STATUS_FIELDS = Object.freeze(['age', 'mood', 'identity', 'relation', 'location', 'affection', 'trust', 'energy', 'fatigue', 'stress', 'satiety', 'hydration', 'lewdness', 'condition', 'outfit', 'action', 'thought', 'items', 'note']);
export const STATUS_METERS = Object.freeze(['affection', 'trust', 'energy', 'fatigue', 'stress', 'satiety', 'hydration', 'lewdness']);
const METERS = new Set(['affection', 'trust', 'energy', 'fatigue', 'stress', 'satiety', 'hydration', 'lewdness', 'hygiene']);
const PANEL = /\[CSB(21|2)_PANEL\]([\s\S]*?)\[\/CSB\1_PANEL\]/g;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const string = value => typeof value === 'string' ? value : '';
const issue = (code, message, details = {}) => ({code, message, ...details});

/** Serialize an explicit user edit without admitting extra protocol blocks. */
export function serializeStatusProfile(name, draft = {}) {
  const oneLine = (value, label, limit = STATUS_LIMITS.field) => {
    if (typeof value !== 'string' && typeof value !== 'number') throw Error(`${label}必須是文字。`);
    const text = String(value).trim();
    if (text.length > limit || /[\r\n\[\]]/.test(text)) throw Error(`${label}過長或含有狀態欄保留字元。`);
    return text;
  };
  const cleanName = oneLine(name, '角色姓名', 120);
  if (!cleanName) throw Error('角色姓名不可空白。');
  if (!draft.fields || typeof draft.fields !== 'object' || Array.isArray(draft.fields)) throw Error('角色狀態欄位格式不正確。');
  if (Object.keys(draft.fields).some(key => !STATUS_FIELDS.includes(key))) throw Error('角色狀態包含不支援的欄位。');
  const fields = Object.fromEntries(STATUS_FIELDS.map(key => {
    const value = oneLine(draft.fields[key] ?? (STATUS_METERS.includes(key) ? '未知' : ''), `欄位 ${key}`);
    if (STATUS_METERS.includes(key) && value !== '未知' && !/^(?:100|[1-9]?\d)$/.test(value)) throw Error(`欄位 ${key} 必須是 0–100 整數或「未知」。`);
    return [key, value];
  }));
  if (!Array.isArray(draft.body) || draft.body.length > STATUS_LIMITS.parts) throw Error(`身體部位最多 ${STATUS_LIMITS.parts} 列。`);
  const body = draft.body.map((part, i) => {
    const label = oneLine(part?.name, `第 ${i + 1} 列部位名稱`, 100), value = oneLine(part?.value, `第 ${i + 1} 列部位內容`);
    if (!label || label.includes('|') || value.includes('|')) throw Error(`第 ${i + 1} 列部位名稱不可空白，內容不可包含 |。`);
    return {name: label, value};
  });
  const time = oneLine(draft.time ?? '', '劇情時間', 1000);
  const text = `[CSB21_PANEL]\ntime: ${time}\n[CSB21_ROLE]\nname: ${cleanName}\n${STATUS_FIELDS.map(key => `${key}: ${fields[key]}`).join('\n')}\nbody:\n${body.map(part => `[CSB21_PART|${part.name}|${part.value}]`).join('\n')}\n[/CSB21_ROLE]\n[/CSB21_PANEL]`;
  if (text.length > STATUS_LIMITS.panel) throw Error('角色狀態內容過長，請縮短後再儲存。');
  return {name: cleanName, fields, body, time, text};
}

/** Only complete panels are hidden from a phone-model context. */
export function stripStatusPanels(text) {
  return string(text).replace(new RegExp(PANEL.source, 'g'), '');
}

function readRole(raw, token, where, errors) {
  const expected = ['name', ...STATUS_FIELDS.map(key => key === 'lewdness' && token === '2' ? 'hygiene' : key)];
  const allowed = new Set(expected), fields = {}, body = [];
  let inBody = false, broken = false;
  const error = (code, message) => { broken = true; errors.push(issue(code, message, where)); };
  if (/\[\/?CSB(?:21|2)_(?:PANEL|ROLE)\]/.test(raw)) {
    error('nested-role', '狀態角色區塊含有未閉合或巢狀標記，未匯入。'); return null;
  }
  for (const original of raw.replace(/\r\n?/g, '\n').split('\n')) {
    const line = original.trim();
    if (!line) continue;
    if (/^body\s*[:：]\s*$/i.test(line)) {
      if (inBody) error('duplicate-body', '同一角色重複了 body 區域。');
      inBody = true; continue;
    }
    if (inBody) {
      const part = new RegExp(`^\\[CSB${token}_PART\\|([^\\[\\]\\|\\r\\n]+)\\|([^\\[\\]\\|\\r\\n]*)\\]$`).exec(line);
      if (!part || !part[1].trim()) { error('invalid-part', '身體部位列格式不完整，未匯入這個角色快照。'); continue; }
      if (part[1].length > 100 || part[2].length > STATUS_LIMITS.field || body.length >= STATUS_LIMITS.parts) {
        error('part-limit', '身體部位名稱、內容或列數超過限制。'); continue;
      }
      // Keep the user's blank field blank. Card information never fills it.
      body.push({name: part[1].trim(), value: part[2].trim()});
      continue;
    }
    const pair = /^([a-z][a-z_0-9]*)\s*[:：]\s*(.*)$/i.exec(line);
    if (!pair || !allowed.has(pair[1].toLowerCase())) {
      error('unknown-field', '狀態快照包含不支援的欄位或格式。'); continue;
    }
    const key = pair[1].toLowerCase(), value = pair[2].trim();
    if (own(fields, key)) {
      if (fields[key] !== value) error('conflicting-field', `欄位 ${key} 在同一角色中有互相衝突的值。`);
      continue;
    }
    if (value.length > STATUS_LIMITS.field) { error('field-limit', `欄位 ${key} 超過長度限制。`); continue; }
    if (METERS.has(key) && value !== '未知' && !/^(?:100|[1-9]?\d)$/.test(value)) {
      error('invalid-meter', `欄位 ${key} 必須是 0–100 整數或「未知」。`); continue;
    }
    fields[key] = value;
  }
  const missing = expected.filter(key => !own(fields, key));
  if (missing.length || !inBody) error('incomplete-role', `狀態快照缺少 ${[...missing, ...(!inBody ? ['body'] : [])].join('、')}。`);
  if (!fields.name || fields.name.length > 120) error('invalid-name', '角色姓名必須是 1–120 字元。');
  if (broken) return null;
  const name = fields.name; delete fields.name;
  return {name, fields, body};
}

/**
 * CSB v2.1 is authoritative; v2 remains readable without mapping hygiene to
 * lewdness. Incomplete streaming panels are ignored until their closing tag.
 */
export function parseStatusPanels(text) {
  const panels = [], errors = [];
  if (typeof text !== 'string' || !text) return {panels, errors};
  if (text.length > STATUS_LIMITS.message) return {panels, errors: [issue('message-limit', '訊息太長，狀態欄未解析。')]};
  let match, panelIndex = 0;
  const matcher = new RegExp(PANEL.source, 'g');
  while ((match = matcher.exec(text))) {
    const token = match[1], raw = match[2], index = panelIndex++, where = {panelIndex: index};
    if (raw.length > STATUS_LIMITS.panel) { errors.push(issue('panel-limit', '狀態面板超過長度限制。', where)); continue; }
    if (/\[\/?CSB(?:21|2)_PANEL\]/.test(raw)) { errors.push(issue('nested-panel', '狀態面板有巢狀或版本不一致的標記。', where)); continue; }
    const roles = [], seen = new Map(), roleMatcher = new RegExp(`\\[CSB${token}_ROLE\\]([\\s\\S]*?)\\[\\/CSB${token}_ROLE\\]`, 'g');
    let roleMatch, roleIndex = 0;
    while ((roleMatch = roleMatcher.exec(raw))) {
      const roleWhere = {...where, roleIndex: roleIndex++};
      if (roleIndex > STATUS_LIMITS.roles) { errors.push(issue('role-limit', '同一狀態面板的角色數超過限制。', where)); break; }
      const role = readRole(roleMatch[1], token, roleWhere, errors);
      if (!role) continue;
      if (seen.has(role.name)) errors.push(issue('duplicate-name', `同一面板重複角色「${role.name}」，採用最後一份有效快照。`, roleWhere));
      seen.set(role.name, roles.length); roles.push({...role, roleIndex: roleWhere.roleIndex});
    }
    const outside = raw.replace(new RegExp(roleMatcher.source, 'g'), '');
    if (/\[\/?CSB(?:21|2)_(?:ROLE|PART)(?:\]|\|)/.test(outside)) errors.push(issue('incomplete-role', '面板內有未完成或版本不一致的角色區塊，未匯入該區塊。', where));
    const timeMatch = /^\s*time\s*[:：]\s*([^\r\n]*)/mi.exec(outside);
    const time = timeMatch ? timeMatch[1].trim().slice(0, 1000) : '';
    if (!timeMatch) errors.push(issue('missing-time', '狀態面板未提供劇情時間。', where));
    panels.push({version: token === '21' ? '2.1' : '2.0', time, roles: roles.filter((role, i) => seen.get(role.name) === i), panelIndex: index});
  }
  return {panels, errors};
}

const CARD_LABELS = Object.freeze({
  height: ['身高', 'height'], weight: ['體重', '体重', 'weight'],
  build: ['身材', '體型', '体型', '體態', '体态', 'build', 'physique', 'body type'],
  appearance: ['外貌', '外觀', '外观', '容貌', 'appearance', 'looks'],
  age: ['年齡', '年龄', 'age'], identity: ['身分', '身份', '職業', '职业', 'identity', 'occupation'],
  relation: ['關係', '关系', 'relationship', 'relation'],
  measurements: ['三圍', '三围', 'measurements'],
});
const GENERIC_HEADINGS = new Set(['基本資料', '基本资料', '個人資料', '个人资料', '角色資料', '角色资料', '人物設定', '人物设定', '人物資料', '人物资料', '角色設定', '角色设定', '角色', '人物', '資料', '资料', '描述', '介紹', '介绍', '性格', '場景', '场景', '外貌與身材', '外貌与身材', '外貌', '外觀', '外观', 'appearance', 'personality', 'description', 'scenario', 'profile', 'basic information']);
const quoteRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cardName = card => string(card?.name || card?.data?.name).trim();
const cardTexts = card => ['description', 'personality', 'scenario'].map(key => string(card?.[key] || card?.data?.[key])).filter(Boolean);

function sectionName(line) {
  let match = /^\s*(?:#{1,6}\s+|【)(.+?)(?:】)?\s*$/.exec(line);
  if (!match) match = /^\s*\[([^\[\]]+)\]\s*$/.exec(line);
  if (!match) match = /^\s*(?:姓名|名字|角色名|name|character)\s*[:：]\s*(.+?)\s*$/i.exec(line);
  return match?.[1].replace(/^\*\*|\*\*$/g, '').trim();
}

/** Select exact named sections. An unlabelled parent card never describes an NPC. */
function attributedText(text, owner, target) {
  let current = owner, lines = [];
  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = sectionName(rawLine);
    if (heading && !GENERIC_HEADINGS.has(heading.toLowerCase())) { current = heading; continue; }
    const inline = /^\s*([^:：\n]{1,120})\s*[:：]\s*(.+)$/.exec(rawLine);
    if (inline && inline[1].trim() === target && target !== owner) { lines.push(inline[2]); continue; }
    if (current === target) lines.push(rawLine);
  }
  return lines.join('\n').trim();
}

function labelledFields(text) {
  const fields = {};
  const clean = text.replace(/\*\*|__/g, '');
  const allLabels = Object.values(CARD_LABELS).flat().map(quoteRegex).sort((a, b) => b.length - a.length).join('|');
  for (const [key, labels] of Object.entries(CARD_LABELS)) {
    const label = labels.map(quoteRegex).sort((a, b) => b.length - a.length).join('|');
    // End at a new labelled field, so inline "身高：180cm，體重：70kg"
    // cannot leak the entire card into the first measurement.
    const matcher = new RegExp(`(?:^|[\\n；;，,。]|\\s[-*•]\\s*)(?:[-*•]\\s*)?(?:${label})\\s*[:：=]\\s*([^\\n]*)`, 'ig');
    const found = matcher.exec(clean);
    if (found) {
      const value = found[1].split(new RegExp(`(?:[；;，,。]|\\s+)(?:${allLabels})\\s*[:：=]`, 'i'))[0].trim().replace(/[；;，,。]\s*$/, '');
      if (value) fields[key] = value.slice(0, 1600);
    }
  }
  for (const [key, label, unit] of [['height', '(?:身高|height)', '(?:cm|公分|厘米|m|米|呎|尺|feet|ft|inches|in|吋|英寸)'], ['weight', '(?:體重|体重|weight)', '(?:kg|公斤|千克|斤|磅|lbs?|pounds?)']]) {
    if (fields[key]) continue;
    const match = new RegExp(`(?:^|[\\n；;，,。\\s])${label}\\s*(\\d+(?:\\.\\d+)?\\s*${unit})(?=$|[\\n；;，,。\\s])`, 'i').exec(clean);
    if (match) fields[key] = match[1];
  }
  return fields;
}

function availableCards(context) {
  const cards = context?.characters;
  return Array.isArray(cards) ? cards.filter(Boolean) : cards && typeof cards === 'object' ? Object.values(cards).filter(Boolean) : [];
}

function activeCards(context) {
  const all = availableCards(context), out = [];
  const current = context?.characters?.[context.characterId];
  if (current) out.push(current);
  const group = Array.isArray(context?.groups) ? context.groups.find(item => String(item.id) === String(context.groupId)) : null;
  for (const member of Array.isArray(group?.members) ? group.members : []) {
    const card = all.find(item => item.avatar === member);
    if (card && !out.includes(card)) out.push(card);
  }
  return out;
}

/**
 * Return only explicit, attributable card facts. Exact duplicate card names
 * resolve to the active card, or remain unresolved when neither is active.
 */
export function extractCharacterCard(context, name) {
  if (typeof name !== 'string' || !name.trim()) return undefined;
  const target = name.trim(), active = activeCards(context), matches = availableCards(context).filter(card => cardName(card) === target);
  const preferred = matches.filter(card => active.includes(card));
  const exact = preferred.length === 1 ? preferred[0] : matches.length === 1 ? matches[0] : null;
  if (matches.length && !exact) return undefined;
  if (exact) {
    const raw = cardTexts(exact).join('\n');
    const attributed = cardTexts(exact).map(text => attributedText(text, target, target)).filter(Boolean).join('\n');
    return {fields: labelledFields(attributed), text: raw.slice(0, 12000), source: {kind: 'card', name: target, avatar: string(exact.avatar)}};
  }
  const sections = active.map(card => ({card, text: cardTexts(card).map(text => attributedText(text, cardName(card), target)).filter(Boolean).join('\n')})).filter(item => item.text);
  if (!sections.length) return undefined;
  const text = sections.map(item => item.text).join('\n').slice(0, 12000);
  return {fields: labelledFields(text), text, source: {kind: 'card-section', name: target, avatar: string(sections[0].card.avatar)}};
}

/** Latest complete snapshot wins per exact name; departed characters stay known. */
export function collectCharacterProfiles(context = {}) {
  const profiles = new Map(), errors = [];
  const scope = JSON.stringify([context.groupId ?? null, context.characters?.[context.characterId]?.avatar ?? context.characterId ?? null, context.getCurrentChatId?.() ?? context.chatId ?? '']);
  for (const [messageIndex, message] of (Array.isArray(context.chat) ? context.chat : []).entries()) {
    if (!message || message.is_system || message.role === 'system') continue;
    const parsed = parseStatusPanels(message.mes);
    errors.push(...parsed.errors.map(error => ({...error, messageIndex})));
    for (const panel of parsed.panels) for (const role of panel.roles) {
      profiles.set(role.name, {name: role.name, fields: {...role.fields}, body: role.body.map(part => ({...part})), time: panel.time,
        source: {kind: 'status', scope, messageIndex, panelIndex: panel.panelIndex, roleIndex: role.roleIndex, version: panel.version},
        card: extractCharacterCard(context, role.name)});
    }
  }
  for (const card of activeCards(context)) {
    const name = cardName(card);
    if (!name || profiles.has(name)) continue;
    const record = extractCharacterCard(context, name);
    if (record) profiles.set(name, {name, fields: {}, body: [], time: '', source: {...record.source, scope}, card: record});
  }
  return {profiles: [...profiles.values()], errors};
}
