import {sourceScope} from './source-sync.js';

const stale = () => Object.assign(Error('對話已切換或角色狀態已更新，請重新開啟後再修改。'), {code: 'STALE'});

/** Publish a validated manual CSB21 edit as a user-authored story snapshot. */
export function createStatusPublisher({context, notice = () => {}}) {
  return async function publishStatus(snapshot) {
    const c = context(), scope = sourceScope(c), chat = c?.chat, metadata = c?.chatMetadata;
    const current = () => !!scope && sourceScope(context()) === scope && context()?.chat === chat && context()?.chatMetadata === metadata;
    if (!Array.isArray(chat) || !scope || snapshot?.scope !== scope || typeof snapshot.isCurrent !== 'function' || !snapshot.isCurrent() || !current()) throw stale();
    const save = typeof c.saveChat === 'function' ? c.saveChat : c.saveMetadata;
    if (typeof save !== 'function') throw Error('酒館未提供對話儲存功能，角色狀態尚未寫入。');
    if (typeof snapshot.text !== 'string' || !snapshot.text) throw Error('角色狀態內容不可空白。');
    const message = {name: c.name1 || '我', is_user: true, is_system: false, mes: snapshot.text, send_date: Date.now(), extra: {tavern_pocket_status: true}};
    // No await between the final revision guard and append. Once appended,
    // snapshot.isCurrent() deliberately expires because the chat has changed.
    if (!snapshot.isCurrent() || !current()) throw stale();
    chat.push(message);
    try { await save.call(c); }
    catch (error) {
      // Other work may append messages while save is pending. Remove only this
      // exact object and never pop another reply or mutate a newly selected chat.
      if (current()) { const index = chat.indexOf(message); if (index >= 0) chat.splice(index, 1); }
      throw error;
    }
    if (!current() || !chat.includes(message)) throw stale();
    // Render only after persistence, so a failed save leaves no phantom bubble.
    try { c.addOneMessage?.(message); }
    catch (error) { notice(`角色狀態已儲存，重新整理可更新顯示：${error.message || error}`); }
    for (const key of ['MESSAGE_SENT', 'USER_MESSAGE_RENDERED']) {
      if (!current() || !chat.includes(message)) throw stale();
      const event = c.eventTypes?.[key];
      if (!event || typeof c.eventSource?.emit !== 'function') continue;
      try { await c.eventSource.emit(event, chat.indexOf(message)); }
      catch (error) { notice(`角色狀態已儲存，部分畫面稍後更新：${error.message || error}`); }
    }
    return message;
  };
}
