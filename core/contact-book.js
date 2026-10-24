// Contact removal is a communication preference, not deletion of a character.
// Names are unique across the account's native contact/voice-role lists. Keep a
// tombstone until an explicit user action restores the contact; narrative
// imports, voice-role discovery and CSB snapshots must never clear it.
const nameOf = value => typeof value === 'string' && value.trim().length <= 100 ? value.trim() : '';
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';

export function normalizeDeletedContacts(value) {
  const result = new Map();
  for (const raw of Array.isArray(value) ? value : []) {
    const name = nameOf(typeof raw === 'string' ? raw : raw?.name);
    if (!name) continue;
    const row = {name, deletedAt: Number.isFinite(raw?.deletedAt) ? raw.deletedAt : 0};
    // A removed manual contact can be restored without losing their persona or
    // original card partition. Never copy arbitrary object keys from a backup.
    if (raw?.contact && nameOf(raw.contact.name) === name && raw.contact.id) {
      row.contact = {id: text(String(raw.contact.id), 512), name,
        persona: text(raw.contact.persona, 4000),
        ...(raw.contact.space ? {space: text(raw.contact.space, 300)} : {})};
    }
    result.set(name, row);
  }
  return [...result.values()];
}

export const deletedContactNames = chat => new Set((Array.isArray(chat?.deletedContacts) ? chat.deletedContacts : [])
  .map(row => nameOf(typeof row === 'string' ? row : row?.name)).filter(Boolean));
export const isContactDeleted = (chat, name) => deletedContactNames(chat).has(nameOf(name));

/** Returns a detached chat settings object; caller persists atomically. */
export function forgetContact(chat, name, {now = Date.now()} = {}) {
  name = nameOf(name);
  if (!name) throw Error('聯絡人名字無效');
  const next = structuredClone(chat);
  const removed = (next.contacts || []).find(contact => contact.name === name);
  const archived = normalizeDeletedContacts(next.deletedContacts);
  const prior = archived.find(row => row.name === name);
  const row = prior || {name, deletedAt: Number.isFinite(now) ? now : 0};
  if (removed) row.contact = removed;
  next.deletedContacts = normalizeDeletedContacts([...archived.filter(item => item.name !== name), row]);
  next.contacts = (next.contacts || []).filter(contact => contact.name !== name);
  next.starred = (next.starred || []).filter(value => value !== name);
  return next;
}

/** Reopening the contact is explicit; it never touches message/CSB history. */
export function restoreContact(chat, name, {roleNames = [], maxContacts = 200} = {}) {
  name = nameOf(name);
  if (!name) throw Error('聯絡人名字無效');
  const next = structuredClone(chat), archived = normalizeDeletedContacts(next.deletedContacts);
  const row = archived.find(item => item.name === name);
  if (!row) return next;
  next.contacts ||= [];
  if (row.contact && !next.contacts.some(item => item.name === name) && !roleNames.includes(name)) {
    if (next.contacts.length >= maxContacts) throw Error('聯絡人已達 200 人，請先整理後再恢復。');
    if (next.contacts.some(item => item.id === row.contact.id)) row.contact.id = crypto.randomUUID();
    next.contacts.push(row.contact);
  }
  next.deletedContacts = archived.filter(item => item.name !== name);
  return next;
}
