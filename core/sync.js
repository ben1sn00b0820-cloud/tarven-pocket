// 保存到酒馆: the phone's own data (chats, 朋友圈, notes, album) kept as files in the tavern user's folder, so another
// browser or device of the same tavern account sees the same phone, and clearing a browser loses nothing.
// Settings already live in the tavern; keys never leave the browser; the voice cache and saved voices stay local
// (they are large, and a voice can be made again).
//
// Files (in data/<user>/user/files, written with the tavern's /api/files/upload):
//   st-iphonie-sync.json        {app, kind:'sync', format, savedAt, device, deviceName, parts:{part:{hash, count}}}
//   st-iphonie-chats.json       chat threads          st-iphonie-moments.json   朋友圈 posts
//   st-iphonie-notes.json       notes                 st-iphonie-photos.json    album index (no pictures)
//   st-iphonie-p-<id>.<ext>     one file per picture, written once (a picture never changes)
//
// A sync reads the tavern's copy first. A part changed only there is taken as it is (so deletions carry over); a part
// changed on both sides is merged item by item (the newer item wins, messages and comments are joined); then what
// changed here is written back. Each device remembers the hashes of the last copy it saw.
import {sha256Hex} from './hash.js';

export const SYNC_FORMAT = 1;
export const SYNC_PARTS = Object.freeze({chats: '聊天记录', moments: '朋友圈', notes: '备忘录', photos: '相册'});
export const MANIFEST = 'st-iphonie-sync.json';
export const partFile = part => `st-iphonie-${part}.json`;
const EXT = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif'};
export const photoFile = row => `st-iphonie-p-${String(row.id).replace(/[^a-zA-Z0-9_-]/g, '_')}.${EXT[row.type] || 'png'}`;

export function defaultSync() { return {enabled: false}; }
export function normalizeSync(value) { return {enabled: value?.enabled === true}; }

const byId = list => [...list].sort((a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);
/** The JSON that is compared and written for a part: items in id order, the album without its pictures. */
export function canonical(part, items) {
  if (part === 'photos') return byId(items.map(({id, name, type, size, createdAt, updatedAt}) => ({id, name, type, size, createdAt, updatedAt})));
  return byId(items);
}
export async function hashText(text) { return sha256Hex(text); }

const newer = (a, b, time) => (time(b) || 0) > (time(a) || 0) ? b : a;
const union = (a = [], b = [], key = x => x.id) => { const map = new Map(); for (const x of [...a, ...b]) map.set(key(x), x); return [...map.values()]; };
/** Both sides changed a part: joins them item by item. */
export function mergePart(part, local, remote) {
  const mine = new Map(local.map(x => [x.id, x])), out = [];
  for (const theirs of remote) {
    const here = mine.get(theirs.id);
    mine.delete(theirs.id);
    if (!here) { out.push(theirs); continue; }
    if (part === 'chats') {
      const base = newer(here, theirs, t => t.updatedAt);
      out.push({...base, messages: union(here.messages, theirs.messages).sort((a, b) => a.at - b.at), unread: Math.max(here.unread || 0, theirs.unread || 0)});
    } else if (part === 'moments') {
      out.push({...here, ...theirs, likes: [...new Set([...(here.likes || []), ...(theirs.likes || [])])], comments: union(here.comments, theirs.comments).sort((a, b) => a.at - b.at), photoId: theirs.photoId || here.photoId});
    } else if (part === 'notes') out.push(newer(here, theirs, n => n.updatedAt));
    else out.push(here);
  }
  return [...out, ...mine.values()];
}

/**
 * Runs one sync. stores: {read(part) → items (photos: rows with blobs), write(part, items, {replace}), photoBlob(row)}
 * files: {read(name, {blob}) → text | Blob | null, write(name, text | Blob), remove(name)}; memory: {hashes, savedAt}.
 * Returns {memory, pulled:[parts], pushed:[parts], merged:[parts], savedAt, remote}.
 */
export async function runSync({stores, files, memory = {}, device = '', deviceName = '', now = () => Date.now(), parts = Object.keys(SYNC_PARTS)}) {
  const hashes = {...(memory.hashes || {})}, pulled = [], pushed = [], merged = [];
  let manifest = null;
  const raw = await files.read(MANIFEST);
  if (raw) {
    try { manifest = JSON.parse(raw); } catch { throw Error('酒館裡的同步檔案讀不出來（st-iphonie-sync.json），可以在酒館的資料資料夾裡刪掉它再試'); }
    if (manifest?.app !== 'ST-iPhonie' || manifest.kind !== 'sync') throw Error('酒館裡的 st-iphonie-sync.json 不是小手機的同步檔案');
    if (manifest.format > SYNC_FORMAT) throw Error('酒館裡的資料來自更新版本的外掛，請先在這臺裝置上更新外掛');
  }
  const remoteParts = manifest?.parts || {}, next = {};
  for (const part of parts) {
    let items = await stores.read(part);
    let text = JSON.stringify(canonical(part, items)), hash = await hashText(text);
    const remoteHash = remoteParts[part]?.hash, base = hashes[part];
    if (remoteHash && remoteHash !== base && remoteHash !== hash) {
      const body = await files.read(partFile(part));
      if (body === null) throw Error(`酒館裡少了 ${partFile(part)}，這次先不同步`);
      const theirs = JSON.parse(body);
      const changedHere = base !== undefined ? hash !== base : items.length > 0;
      let result = changedHere ? mergePart(part, items, theirs) : theirs;
      if (part === 'photos') {
        const have = new Map(items.map(r => [r.id, r]));
        result = await Promise.all(result.map(async row => have.get(row.id) || {...row, blob: await files.read(photoFile(row), {blob: true})}));
        result = result.filter(row => row.blob);
      }
      await stores.write(part, result, {replace: true});
      (changedHere ? merged : pulled).push(part);
      items = await stores.read(part);
      text = JSON.stringify(canonical(part, items));
      hash = await hashText(text);
    }
    if (hash !== remoteHash) {
      if (part === 'photos') {
        const theirs = new Set((remoteHash ? JSON.parse(await files.read(partFile('photos')) || '[]') : []).map(photoFile));
        const mine = new Set(items.map(photoFile));
        for (const row of items) if (!theirs.has(photoFile(row))) await files.write(photoFile(row), await stores.photoBlob(row));
        for (const name of theirs) if (!mine.has(name)) await files.remove(name).catch(() => {});
      }
      await files.write(partFile(part), text);
      pushed.push(part);
    }
    next[part] = {hash, count: items.length};
    hashes[part] = hash;
  }
  let remote = manifest ? {savedAt: manifest.savedAt, deviceName: manifest.deviceName || '', device: manifest.device || ''} : null;
  if (pushed.length || !manifest) {
    remote = {savedAt: now(), deviceName, device};
    await files.write(MANIFEST, JSON.stringify({app: 'ST-iPhonie', kind: 'sync', format: SYNC_FORMAT, ...remote, parts: {...remoteParts, ...next}}));
  }
  // The tavern's copy is now what this device holds.
  return {memory: {hashes, savedAt: remote.savedAt}, pulled, pushed, merged, savedAt: remote.savedAt, remote};
}
