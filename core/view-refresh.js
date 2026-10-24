/** Coalesce display work only. Persistence and model events never go through
 * this queue. Hidden views stay dirty until visible; an async view never races
 * another refresh of itself. */
export function createViewRefreshQueue({run, visible, delay = 48,
  setTimer = setTimeout, clearTimer = clearTimeout, onError = () => {}}) {
  const dirty = new Map(), running = new Set();
  let timer = null, disposed = false;
  function mergeTask(previous, task) {
    if (!previous) return task;
    if (!task) return previous;
    const event = {...previous.event, ...task.event};
    if (previous.event?.threadId !== task.event?.threadId) event.threadId = '';
    return {kind: previous.kind === task.kind ? task.kind : 'refresh', event};
  }
  function arm() {
    if (disposed || timer !== null || ![...dirty.keys()].some(key => visible(key) && !running.has(key))) return;
    timer = setTimer(flush, delay);
  }
  function flush() {
    timer = null;
    if (disposed) return;
    for (const [key, task] of dirty) {
      if (!visible(key) || running.has(key)) continue;
      dirty.delete(key); running.add(key);
      Promise.resolve().then(() => { if (disposed) return; if (visible(key)) return run(key, task); dirty.set(key, mergeTask(task, dirty.get(key))); })
        .catch(onError).finally(() => { running.delete(key); arm(); });
    }
  }
  return {
    request(key, task = {}) {
      if (disposed) return;
      dirty.set(key, mergeTask(dirty.get(key), task));
      arm();
    },
    resume: arm,
    dispose() { disposed = true; if (timer !== null) clearTimer(timer); timer = null; dirty.clear(); },
  };
}
