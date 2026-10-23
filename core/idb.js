// iPhone Safari (WebKit) drops IndexedDB connections, most often after the page sat in the background: the old
// connection then refuses every transaction ("Connection to Indexed Database server lost"). A fresh connection
// usually works again, so the stores reconnect once before giving up with this message.
export const LOST_MESSAGE = '浏览器断开了本地存储（iPhone 上页面在后台放久了常见），请刷新页面后再试';

/** Whether a failed transaction looks like a dropped connection rather than a full disk or a bad value. */
export function connectionLost(error) {
  if (!error) return false;
  if (['InvalidStateError', 'UnknownError', 'TransactionInactiveError'].includes(error.name)) return true;
  return /connection|closing|closed|server lost/i.test(String(error.message || ''));
}

export const lostError = cause => Object.assign(new Error(LOST_MESSAGE), {code: 'STORAGE_LOST', cause});
