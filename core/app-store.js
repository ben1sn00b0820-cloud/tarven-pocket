// Documents of the smaller phone apps (论坛 posts and its 热搜, 查手机 snapshots), kept in this browser (IndexedDB) and
// scoped to the tavern account like the other local data. Each document is {id, kind, at, ...}; the apps check their own
// fields (core/forum.js, core/peek.js) before anything is written.
import {connectionLost, lostError} from './idb.js';
const fail = (message, code = 'INVALID') => Object.assign(new Error(message), {code});

export class AppStore {
  #scope; #factory; #db = null; #opening = null; #closed = false;
  constructor(scope, {indexedDB = globalThis.indexedDB} = {}) { this.#scope = String(scope); this.#factory = indexedDB; }
  async #open() {
    if (this.#closed) throw fail('已关闭', 'CLOSED');
    if (this.#db) return this.#db;
    if (!this.#factory?.open) throw fail('浏览器不支持本地保存，请检查存储权限', 'STORAGE_UNAVAILABLE');
    this.#opening ||= new Promise((resolve, reject) => {
      const req = this.#factory.open('st-iphonie-apps-v1', 1);
      req.onupgradeneeded = () => { const store = req.result.createObjectStore('docs', {keyPath: ['scope', 'id']}); store.createIndex('scope', 'scope'); };
      req.onerror = () => reject(fail('无法打开本地数据，请检查浏览器的存储权限', 'STORAGE_UNAVAILABLE'));
      req.onblocked = () => reject(fail('另一个页面占用了本地数据，请关闭旧页面后重试', 'STORAGE_BLOCKED'));
      req.onsuccess = () => {
        if (this.#closed) { req.result.close(); reject(fail('已关闭', 'CLOSED')); return; }
        this.#db = req.result;
        const db = this.#db;
        db.onversionchange = () => { db.close(); if (this.#db === db) this.#db = null; };
        db.onclose = () => { if (this.#db === db) this.#db = null; };
        resolve(db);
      };
    }).finally(() => { this.#opening = null; });
    return this.#opening;
  }
  // A dropped connection (iPhone Safari after the page sat in the background) is reopened once; nothing was written.
  async #tx(mode, work, again = true) {
    const db = await this.#open();
    try {
      return await new Promise((resolve, reject) => {
        let result, own, tx;
        try { tx = db.transaction('docs', mode); } catch (error) { reject(this.#closed ? fail('已关闭', 'CLOSED') : lostError(error)); return; }
        const store = tx.objectStore('docs');
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(own || (connectionLost(tx.error) ? lostError(tx.error) : fail(tx.error?.name === 'QuotaExceededError' ? '设备存储空间不足，没有保存' : '没有保存，请重试', 'STORAGE')));
        work(store, value => { result = value; }, error => { own = error; tx.abort(); });
      });
    } catch (error) {
      if (error?.code !== 'STORAGE_LOST' || this.#closed) throw error;
      if (this.#db === db) { try { db.close(); } catch {} this.#db = null; }
      if (again) return this.#tx(mode, work, false);
      throw error;
    }
  }
  #all(store, then) { const req = store.index('scope').getAll(this.#scope); req.onsuccess = () => then(req.result); }
  #public(row) { if (!row) return null; const {scope, ...rest} = row; return structuredClone(rest); }

  /** Documents of one kind, newest first. */
  async list(kind) {
    const rows = await this.#tx('readonly', (store, done) => this.#all(store, done));
    return rows.filter(r => !kind || r.kind === kind).sort((a, b) => b.at - a.at).map(r => this.#public(r));
  }
  async get(id) { return this.#tx('readonly', (store, done) => { const req = store.get([this.#scope, String(id)]); req.onsuccess = () => done(this.#public(req.result)); }); }
  /** Writes documents; keep: at most this many of their kind stay (the oldest go). */
  async put(docs, {keep = 0} = {}) {
    const rows = docs.map(d => ({...structuredClone(d), scope: this.#scope, id: String(d.id)}));
    return this.#tx('readwrite', (store, done) => {
      for (const row of rows) store.put(row);
      if (!keep) { done(rows.map(r => this.#public(r))); return; }
      this.#all(store, existing => {
        const kinds = new Set(rows.map(r => r.kind));
        for (const kind of kinds) {
          const all = [...existing.filter(r => r.kind === kind && !rows.some(x => x.id === r.id)), ...rows.filter(r => r.kind === kind)].sort((a, b) => b.at - a.at);
          for (const old of all.slice(keep)) store.delete([this.#scope, old.id]);
        }
        done(rows.map(r => this.#public(r)));
      });
    });
  }
  /** Changes one document in a transaction; change(doc) edits it in place. */
  async change(id, change) {
    return this.#tx('readwrite', (store, done, abort) => {
      const req = store.get([this.#scope, String(id)]);
      req.onsuccess = () => {
        const row = req.result;
        if (!row) { abort(fail('这条内容已经不在了', 'MISSING')); return; }
        try { change(row); } catch (error) { abort(error); return; }
        store.put(row);
        done(this.#public(row));
      };
    });
  }
  async remove(id) { return this.#tx('readwrite', (store, done) => { store.delete([this.#scope, String(id)]); done(true); }); }
  async clear(kind) { return this.#tx('readwrite', (store, done) => this.#all(store, rows => { const gone = rows.filter(r => !kind || r.kind === kind); for (const r of gone) store.delete([this.#scope, r.id]); done(gone.length); })); }
  close() { this.#closed = true; this.#db?.close(); this.#db = null; }
}
