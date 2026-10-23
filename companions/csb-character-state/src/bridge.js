import {clone} from './schema.js';

export const BRIDGE_VERSION = 1;
export const CHANGE_EVENT = 'csb:changed';

/** Match the host's story identity, including group and character avatar. */
export function characterStateScope(c) {
  if (!c) return '';
  const chatId = c.getCurrentChatId?.() ?? c.chatId;
  if (chatId === undefined || chatId === null || chatId === '') return '';
  return JSON.stringify([c.groupId ?? null, c.characters?.[c.characterId]?.avatar ?? c.characterId ?? null, chatId]);
}

/** Read-only public contract. Mutations stay in the existing guarded editor. */
export function createCharacterStateBridge({context, snapshot, openEditor, openManager, target = globalThis, onError = () => {}}) {
  let alive = true, signature;
  const listeners = new Set();
  const stale = () => Object.assign(Error('角色狀態或對話已變動，請重新開啟角色資料。'), {code:'STALE'});
  function getSnapshot() {
    if (!alive) return null;
    const c = context(), scope = characterStateScope(c);
    if (!scope || !c?.chatMetadata || !Array.isArray(c.chat)) return null;
    const current = snapshot();
    const now = context();
    if (!alive || characterStateScope(now) !== scope || now.chatMetadata !== c.chatMetadata || now.chat !== c.chat) throw stale();
    return clone({scope, enabled:current.settings?.enabled !== false,
      schema:current.db.schema, state:current.state, locks:current.db.locks ?? {}, pinned:current.db.pinned ?? []});
  }
  function edit(id, {scope:expectedScope} = {}) {
    const c = context(), current = getSnapshot();
    if (!alive || !current || (expectedScope !== undefined && current.scope !== expectedScope)) throw stale();
    if (!current.enabled) throw Error('角色狀態工坊已停用，請先啟用後再編輯。');
    if (typeof id !== 'string' || !Object.hasOwn(current.state.characters, id)) throw Error('找不到這個角色，請重新讀取角色資料。');
    if (context().chatMetadata !== c.chatMetadata || context().chat !== c.chat || characterStateScope(context()) !== current.scope) throw stale();
    openEditor(id, {scope:current.scope, metadata:c.chatMetadata, chat:c.chat});
    return true;
  }
  function subscribe(listener) {
    if (!alive) return () => {};
    if (typeof listener !== 'function') throw TypeError('狀態訂閱者必須是函式');
    listeners.add(listener);
    return () => listeners.delete(listener);
  }
  function manage({scope:expectedScope} = {}) {
    const current = getSnapshot();
    if (!current || (expectedScope !== undefined && current.scope !== expectedScope)) throw stale();
    if (typeof openManager !== 'function') throw Error('目前環境無法開啟角色管理介面。');
    openManager({scope:current.scope});
    return true;
  }
  function notify() {
    if (!alive) return false;
    const current = getSnapshot(), next = JSON.stringify(current);
    if (signature === next) return false;
    signature = next;
    const detail = Object.freeze({scope:current?.scope ?? ''});
    for (const listener of [...listeners]) { try { listener(detail); } catch (error) { onError(error); } }
    if (typeof target?.dispatchEvent === 'function' && typeof target?.CustomEvent === 'function') {
      target.dispatchEvent(new target.CustomEvent(CHANGE_EVENT, {detail}));
    }
    return true;
  }
  const api = Object.freeze({apiVersion:BRIDGE_VERSION, getSnapshot, openEditor:edit, openManager:manage, subscribe});
  return {api, notify, dispose() {alive=false;listeners.clear();signature=undefined;}};
}
