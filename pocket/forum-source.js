import {FORUM_LIMITS, cleanPost, cleanReply} from '../core/forum.js';
import {sourceScope} from './source-sync.js';

const REMOVED = 'pocket-forum-removed';
const fail = (text, code = 'STALE') => Object.assign(new Error(text), {code});
const clone = value => structuredClone(value);
const isUser = (name, user) => ['me', '{{user}}', user].includes(name);
const actor = (name, user) => isUser(name, user) ? 'me' : name;
const timeOf = (event, index) => Number.isFinite(Number(event.at)) ? Number(event.at) : 946684800000 + index;

export async function forumSourceId(scope, id, reply = false) {
  const bytes = new TextEncoder().encode(JSON.stringify([scope, id]));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return (reply ? 'pocket-forum-reply:' : 'pocket-forum:') + [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}

/** Reconciles only this story's forum events; native replies/likes stay owned by the native app. */
export function createForumSource({context, backend}) {
  let disposed = false, queue = Promise.resolve();
  function reconcile(input, scope, options = {}) {
    const c = context(), snapshot = {chat: c?.chat, metadata: c?.chatMetadata, space: backend.spaceKey(), user: c?.name1 || '我'};
    const current = () => !disposed && !backend.closed && scope && sourceScope(context()) === scope && context()?.chat === snapshot.chat && context()?.chatMetadata === snapshot.metadata && backend.spaceKey() === snapshot.space && (!options.isCurrent || options.isCurrent());
    const check = () => { if (!current()) throw fail('對話已切換，論壇同步已取消。'); };
    const events = clone((Array.isArray(input) ? input : []).filter(event => event?.app === 'forum'));
    const run = async () => {
      check();
      if (!backend.apps?.list || !backend.apps?.put || !backend.apps?.change || !backend.appsMutate) return {posts: 0, replies: 0, removed: 0, errors: []};
      const rows = await backend.apps.list(); check();
      const local = rows.filter(row => (row.kind === 'forum' || row.kind === REMOVED) && (row.space || '') === snapshot.space);
      const existing = new Map(local.map(row => [row.id, row]));
      const wanted = new Map(), sourceIds = new Map(), replyGroups = new Map(), errors = [];
      // The native board has a finite feed. Keep the latest source posts without pruning native user documents.
      const posts = events.filter(event => event.action === 'post').slice(-FORUM_LIMITS.posts);
      for (const [index, event] of posts.entries()) {
        try {
          if (typeof event.id !== 'string' || !event.id) throw Error('論壇貼文缺少事件 ID。');
          const id = await forumSourceId(scope, event.id); check();
          const doc = cleanPost({author: actor(event.from, snapshot.user), title: event.title || '', text: event.text || (event.image ? `圖片：${event.image}` : ''), source: isUser(event.from, snapshot.user) ? 'me' : 'auto', space: snapshot.space, replies: []}, id, timeOf(event, index), () => '');
          doc.pocketSource = {scope, id: event.id};
          if (event.board) doc.board = String(event.board).slice(0, 80);
          if (event.image) doc.image = event.image;
          wanted.set(id, doc); sourceIds.set(event.id, id);
        } catch (error) { if (!current()) throw error; errors.push({eventId: event.id, message: error.message}); }
      }
      for (const [index, event] of events.entries()) {
        if (!['comment', 'reply'].includes(event.action)) continue;
        try {
          if (typeof event.id !== 'string' || !event.id) throw Error('論壇回覆缺少事件 ID。');
          const ref = event.ref || event.postId;
          const nativeRef = typeof ref === 'string' && ref.startsWith('forum:') ? ref.slice(6) : ref;
          const id = sourceIds.get(ref) || (existing.get(ref)?.kind === 'forum' ? ref : existing.get(nativeRef)?.kind === 'forum' ? nativeRef : '');
          if (!id || (existing.get(id)?.pocketSource?.scope === scope && !wanted.has(id))) throw Error('論壇回覆找不到目前分區的貼文。');
          const reply = cleanReply({from: actor(event.from, snapshot.user), text: event.text, ...(event.to ? {to: actor(event.to, snapshot.user)} : {})}, await forumSourceId(scope, event.id, true), timeOf(event, index));
          check(); reply.pocketSource = {scope, id: event.id};
          if (!replyGroups.has(id)) replyGroups.set(id, []);
          if (!replyGroups.get(id).some(item => item.id === reply.id)) replyGroups.get(id).push(reply);
        } catch (error) { if (!current()) throw error; errors.push({eventId: event.id, message: error.message}); }
      }
      const affected = new Set([...wanted.keys(), ...replyGroups.keys(), ...local.filter(row => row.pocketSource?.scope === scope || row.replies?.some(reply => reply.pocketSource?.scope === scope)).map(row => row.id)]);
      const report = {posts: wanted.size, replies: 0, removed: 0, errors};
      const apply = (row, id, count = false) => {
        check();
        if ((row.space || '') !== snapshot.space) throw fail('論壇貼文分區已變更。');
        const doc = wanted.get(id);
        if (doc) {
          if (row.pocketSource && (row.pocketSource.scope !== scope || row.pocketSource.id !== doc.pocketSource.id)) throw fail('論壇來源識別衝突，未覆寫原貼文。', 'SOURCE_CONFLICT');
          for (const key of ['kind', 'author', 'title', 'text', 'at', 'source', 'pocketSource']) row[key] = clone(doc[key]);
          for (const key of ['board', 'image']) { if (doc[key]) row[key] = doc[key]; else delete row[key]; }
        } else if (row.pocketSource?.scope === scope) {
          if (count && row.kind !== REMOVED) report.removed++;
          row.kind = REMOVED;
        }
        const native = (Array.isArray(row.replies) ? row.replies : []).filter(reply => reply.pocketSource?.scope !== scope);
        const remaining = Math.max(0, FORUM_LIMITS.replies - native.length);
        const imported = remaining ? (replyGroups.get(id) || []).slice(-remaining) : [];
        row.replies = [...native, ...imported].sort((a, b) => a.at - b.at);
        if (count) report.replies += imported.length;
      };
      const changed = [];
      for (const id of affected) {
        const before = existing.get(id), doc = clone(before || wanted.get(id));
        apply(doc, id, true);
        if (!before || JSON.stringify(before) !== JSON.stringify(doc)) changed.push({id, doc, exists: !!before});
      }
      if (changed.length) await backend.appsMutate('forum', async () => {
        for (const {id, doc, exists} of changed) {
          check();
          // Existing documents are patched inside the store transaction, so a late native reply is never lost.
          if (exists) await backend.apps.change(id, row => apply(row, id));
          else {
            check();
            await backend.apps.put([doc]);
          }
          check();
        }
      });
      check(); return report;
    };
    const task = queue.then(run); queue = task.catch(() => {}); return task;
  }
  return {reconcile, dispose() { disposed = true; }};
}
