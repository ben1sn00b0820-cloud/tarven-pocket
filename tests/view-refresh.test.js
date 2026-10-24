import test from 'node:test';
import assert from 'node:assert/strict';
import {createViewRefreshQueue} from '../core/view-refresh.js';

const drain = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject}; }
function clock() {
  let sequence = 0; const timers = new Map();
  return {
    setTimer(fn, delay) { const id = ++sequence; timers.set(id, {fn, delay}); return id; },
    clearTimer(id) { timers.delete(id); },
    fire() { const first = timers.entries().next().value; assert.ok(first, 'a timer must be scheduled'); timers.delete(first[0]); first[1].fn(); },
    count: () => timers.size,
  };
}
function harness(run) {
  const time = clock(), visible = new Set(), calls = [], errors = [];
  const queue = createViewRefreshQueue({visible: key => visible.has(key), run: run || ((key, task) => calls.push({key, task})),
    setTimer: time.setTimer, clearTimer: time.clearTimer, onError: error => errors.push(error)});
  return {time, visible, calls, errors, queue};
}
const chat = threadId => ({kind: 'chat', event: {threadId}});

test('hidden views remain dirty without creating timers; resume refreshes once', async () => {
  const h = harness(); h.queue.request('chat', chat('a')); h.queue.request('chat', chat('a'));
  assert.equal(h.time.count(), 0); await drain(); assert.equal(h.calls.length, 0);
  h.visible.add('chat'); h.queue.resume(); h.queue.resume(); assert.equal(h.time.count(), 1);
  h.time.fire(); await drain(); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].task.event.threadId, 'a'); assert.equal(h.time.count(), 0);
});
test('becoming hidden before a scheduled flush defers work until resume', async () => {
  const h = harness(); h.visible.add('chat'); h.queue.request('chat', chat('a')); h.visible.delete('chat'); h.time.fire(); await drain();
  assert.equal(h.calls.length, 0); assert.equal(h.time.count(), 0);
  h.visible.add('chat'); h.queue.resume(); h.time.fire(); await drain(); assert.equal(h.calls.length, 1);
});
test('a burst coalesces to one refresh and preserves merged event fields', async () => {
  const h = harness(); h.visible.add('chat');
  h.queue.request('chat', {kind: 'chat', event: {threadId: 'a', contacts: true}});
  for (let i = 0; i < 100; i++) h.queue.request('chat', {kind: 'chat', event: {threadId: 'a', sequence: i}});
  assert.equal(h.time.count(), 1); h.time.fire(); await drain(); assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].task, {kind: 'chat', event: {threadId: 'a', contacts: true, sequence: 99}});
});
test('different thread IDs request a full chat refresh and cannot narrow again', async () => {
  const h = harness(); h.visible.add('chat'); h.queue.request('chat', chat('a')); h.queue.request('chat', chat('b')); h.queue.request('chat', chat('a'));
  h.time.fire(); await drain(); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].task.event.threadId, '');
});
test('mixed operation kinds merge to refresh rather than a partial chat event', async () => {
  const h = harness(); h.visible.add('chat'); h.queue.request('chat', chat('a')); h.queue.request('chat', {kind: 'refresh', event: {status: true}});
  h.time.fire(); await drain(); assert.equal(h.calls[0].task.kind, 'refresh'); assert.equal(h.calls[0].task.event.threadId, ''); assert.equal(h.calls[0].task.event.status, true);
});
test('an async view never overlaps itself and receives one follow-up for a dirty burst', async () => {
  const first = deferred(), second = deferred(); let active = 0, peak = 0; const seen = [];
  const h = harness(async (key, task) => {active++; peak = Math.max(peak, active); seen.push({key, task}); await (seen.length === 1 ? first.promise : second.promise); active--;});
  h.visible.add('chat'); h.queue.request('chat', chat('a')); h.time.fire(); await drain(); assert.equal(active, 1);
  for (let i = 0; i < 30; i++) h.queue.request('chat', chat(i % 2 ? 'a' : 'b'));
  assert.equal(h.time.count(), 0); assert.equal(seen.length, 1);
  first.resolve(); await drain(); assert.equal(h.time.count(), 1); h.time.fire(); await drain(); assert.equal(seen.length, 2); assert.equal(seen[1].task.event.threadId, ''); assert.equal(peak, 1);
  second.resolve(); await drain(); assert.equal(active, 0); assert.equal(h.time.count(), 0);
});
test('another visible view can refresh while an unrelated view is running', async () => {
  const waiting = deferred(), seen = []; const h = harness((key) => {seen.push(key); if (key === 'chat') return waiting.promise;});
  h.visible.add('chat'); h.visible.add('roles'); h.queue.request('chat'); h.time.fire(); await drain();
  h.queue.request('roles'); h.time.fire(); await drain(); assert.deepEqual(seen, ['chat', 'roles']); waiting.resolve(); await drain();
});
test('visibility race merges deferred work with requests arriving before its microtask', async () => {
  const h = harness(); h.visible.add('chat'); h.queue.request('chat', {kind: 'chat', event: {threadId: 'a', contacts: true}}); h.time.fire();
  // The flush has reserved A, but run() has not started. B arrives, then the panel hides.
  h.queue.request('chat', {kind: 'chat', event: {threadId: 'b', status: true}}); h.visible.delete('chat'); await drain();
  assert.equal(h.calls.length, 0); assert.equal(h.time.count(), 0);
  h.visible.add('chat'); h.queue.resume(); h.time.fire(); await drain();
  assert.deepEqual(h.calls[0].task, {kind: 'chat', event: {threadId: '', contacts: true, status: true}});
});
test('dispose cancels timers and rejects all later requests and resumes', async () => {
  const h = harness(); h.visible.add('chat'); h.queue.request('chat'); assert.equal(h.time.count(), 1); h.queue.dispose();
  assert.equal(h.time.count(), 0); h.queue.request('chat'); h.queue.resume(); await drain(); assert.equal(h.time.count(), 0); assert.equal(h.calls.length, 0);
});
test('dispose between flush and its microtask prevents run entirely', async () => {
  const h = harness(); h.visible.add('chat'); h.queue.request('chat'); h.time.fire(); h.queue.dispose(); await drain(); assert.equal(h.calls.length, 0);
});
test('disposing a running queue discards dirty follow-up after completion', async () => {
  const waiting = deferred(); let calls = 0; const h = harness(() => {calls++; return waiting.promise;}); h.visible.add('chat');
  h.queue.request('chat'); h.time.fire(); await drain(); h.queue.request('chat'); h.queue.dispose(); waiting.resolve(); await drain(); assert.equal(calls, 1); assert.equal(h.time.count(), 0);
});
test('a rejected refresh reports its error and releases the view for later updates', async () => {
  let count = 0; const error = Error('view failed'), h = harness(() => {count++; if (count === 1) return Promise.reject(error);}); h.visible.add('chat');
  h.queue.request('chat'); h.time.fire(); await drain(); assert.deepEqual(h.errors, [error]); h.queue.request('chat'); h.time.fire(); await drain(); assert.equal(count, 2);
});
