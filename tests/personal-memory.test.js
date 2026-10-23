import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonalMemory, PERSONAL_MEMORY_KEY, PERSONAL_MEMORY_LIMITS} from '../pocket/personal-memory.js';

function fixture() {
  const settings = {secretKey: 'NOT_FOR_MODEL_OR_WORLDBOOK'}, books = new Map(), notices = [], savedBooks = [];
  let saves = 0, c = {name1: '使用者甲', chatId: 'one', extensionSettings: settings, saveSettingsDebounced() { saves++; }, getWorldInfoNames: () => [...books.keys()],
    loadWorldInfo: async name => structuredClone(books.get(name)), saveWorldInfo: async (name, book) => { books.set(name, structuredClone(book)); savedBooks.push({name, book}); }};
  const wallet = {inventory: [], ledger: [{id: 'original-ledger', amount: -10}]};
  const backend = {wallet: () => structuredClone(wallet)}, context = () => c;
  const service = createPersonalMemory({context, backend, notice: x => notices.push(x)});
  return {service, settings, books, notices, savedBooks, wallet, context, backend, get c() { return c; }, get saves() { return saves; }, switchTo(next) { c = {...c, ...next}; }};
}
const profileDraft = (service, fields) => { const state = service.state(); return {revision: state.revision, profile: {...state.profile, ...fields}}; };

test('explicit profile facts and blank anatomy persist across chats and service reload without credentials', async () => {
  const f = fixture();
  await f.service.saveProfile(profileDraft(f.service, {age: '19', height: '180cm', penis: '', body: '已提供的身體描述', customFields: [{name: '慣用手', value: '右手'}, {name: '預留', value: ''}]}));
  f.switchTo({chatId: 'two'});
  const reloaded = createPersonalMemory({context: f.context, backend: f.backend});
  assert.equal(reloaded.state().profile.age, '19'); assert.equal(reloaded.state().profile.penis, '');
  assert.deepEqual(reloaded.state().profile.customFields[1], {name: '預留', value: ''});
  assert.doesNotMatch(reloaded.contextText(), /NOT_FOR_MODEL_OR_WORLDBOOK|secretKey/);
  assert.doesNotMatch(JSON.stringify(reloaded.exportWorldbook()), /NOT_FOR_MODEL_OR_WORLDBOOK/);
  assert.ok(f.saves > 0);
});

test('personas have isolated profiles and assets, even without an active chat', async () => {
  const f = fixture(); f.switchTo({chatId: undefined});
  await f.service.saveEntry('abilities', {name: '瞬間移動能力', description: '只能移動至看得見的位置'});
  f.switchTo({name1: '另一位使用者'});
  assert.equal(f.service.state().profile.name, '另一位使用者'); assert.equal(f.service.state().abilities.length, 0);
  await f.service.saveProfile(profileDraft(f.service, {age: '30'}));
  f.switchTo({name1: '使用者甲'});
  assert.equal(f.service.state().abilities.length, 1); assert.equal(f.service.state().profile.age, '');
});

test('item and ability CRUD preserve explicit fields, reject stale revision, and never mutate the wallet', async () => {
  const f = fixture(), beforeWallet = structuredClone(f.wallet);
  await f.service.saveEntry('items', {revision: f.service.state().revision, name: '牙刷', description: '全新', quantity: 2});
  const state = f.service.state(), item = state.items[0];
  await f.service.saveEntry('items', {...item, revision: state.revision, description: '已使用', quantity: 1});
  await assert.rejects(f.service.saveEntry('items', {...item, revision: state.revision, name: '舊編輯器'}), {code: 'STALE'});
  await f.service.deleteEntry('items', item.id, {revision: f.service.state().revision});
  assert.equal(f.service.state().items.length, 0); assert.deepEqual(f.wallet, beforeWallet);
});

test('stable acquisition and order IDs deduplicate even after edits or deletion', async () => {
  const f = fixture(), asset = {name: '夜視能力', description: '夜間可以看清輪廓', kind: 'abilities'};
  await f.service.recordAcquisition(asset, {orderId: 'buy-1', source: '商城'});
  await f.service.recordAcquisition({...asset, description: '不可覆蓋'}, {id: 'other', orderId: 'buy-1'});
  const entry = f.service.state().abilities[0]; assert.equal(f.service.state().abilities.length, 1); assert.equal(entry.description, asset.description);
  await f.service.deleteEntry('abilities', entry.id);
  await f.service.recordAcquisition(asset, {orderId: 'buy-1'});
  assert.equal(f.service.state().abilities.length, 0);
  await assert.rejects(f.service.recordAcquisition(asset), /穩定編號/);
});

test('wallet migration imports unattributed legacy assets once into only the first persona', async () => {
  const f = fixture(); f.wallet.inventory.push({id: 'gift', name: '項鍊', description: '銀色', orderId: 'legacy-order', at: 10});
  const original = structuredClone(f.wallet);
  await f.service.importWallet(); await f.service.recordAcquisition(f.wallet.inventory[0], {orderId: 'legacy-order'}); await f.service.importWallet();
  assert.equal(f.service.state().items.length, 1); assert.deepEqual(f.wallet, original);
  f.switchTo({name1: '第二使用者'}); await f.service.importWallet();
  assert.equal(f.service.state().items.length, 0);
  f.switchTo({name1: '使用者甲'}); const item = f.service.state().items[0]; await f.service.deleteEntry('items', item.id); await f.service.importWallet();
  assert.equal(f.service.state().items.length, 0);
});

test('owned wallet purchases reconcile after initial migration, recover interrupted memory writes, and stay persona-scoped', async () => {
  const f = fixture(); await f.service.importWallet();
  f.wallet.inventory.push({id: 'a', name: '萬能鑰匙', description: '開啟指定房門', orderId: 'owned-a', memoryOwner: '使用者甲'}, {id: 'b', name: '私人物品', description: '', orderId: 'owned-b', memoryOwner: '另一人'});
  await f.service.importWallet(); assert.deepEqual(f.service.state().items.map(x => x.name), ['萬能鑰匙']);
  await f.service.recordAcquisition(f.wallet.inventory[0], {orderId: 'owned-a'}); assert.equal(f.service.state().items.length, 1);
  await f.service.deleteEntry('items', f.service.state().items[0].id); await f.service.importWallet(); assert.equal(f.service.state().items.length, 0);
  f.switchTo({name1: '另一人'}); await f.service.importWallet(); assert.deepEqual(f.service.state().items.map(x => x.name), ['私人物品']);
});

test('invalid and over-limit edits reject without truncating or changing saved memory', async () => {
  const f = fixture(); await f.service.saveEntry('items', {name: '書', description: '原內容'});
  const before = f.service.state();
  await assert.rejects(f.service.saveEntry('items', {name: '錯誤', quantity: 0}), /數量/);
  await assert.rejects(f.service.saveProfile(profileDraft(f.service, {customFields: [{name: '', value: 'x'}]})), /不可空白/);
  await assert.rejects(f.service.saveEntry('items', {name: 'x', description: 'x'.repeat(8001)}), /8000/);
  assert.deepEqual(f.service.state(), before);
  const data = f.settings[PERSONAL_MEMORY_KEY].personas[encodeURIComponent('使用者甲')];
  data.items = Array.from({length: PERSONAL_MEMORY_LIMITS.assets}, (_, i) => ({...data.items[0], id: String(i), name: `物品${i}`}));
  await assert.rejects(f.service.saveEntry('abilities', {name: '新能力'}), /已達/);
  assert.equal(f.service.state().items.length, 500);
});

test('queued operations reject after persona switch and failed settings saves roll back exactly', async () => {
  const f = fixture();
  const pending = f.service.saveEntry('items', {name: '不可混入'});
  f.switchTo({name1: '另一人'}); await assert.rejects(pending, {code: 'STALE'});
  assert.equal(f.service.state().items.length, 0);
  f.c.saveSettingsDebounced = async () => { throw Error('儲存失敗'); };
  await assert.rejects(f.service.saveEntry('items', {name: '未完成'}), /儲存失敗/);
  assert.equal(f.service.state().items.length, 0); assert.equal(f.settings[PERSONAL_MEMORY_KEY], undefined);
});

test('context prioritizes named assets, reports omitted facts, and keeps all stored content', async () => {
  const f = fixture();
  await f.service.saveProfile(profileDraft(f.service, {body: '身'.repeat(4000), appearance: '貌'.repeat(4000), anatomy: '體'.repeat(4000)}));
  for (let i = 0; i < 8; i++) await f.service.saveEntry('items', {name: i === 0 ? '龍紋鑰匙' : `物品${i}`, description: `明確記載${i}` + '內'.repeat(3000)});
  const prompt = f.service.contextText('我要使用龍紋鑰匙');
  assert.ok(prompt.length <= PERSONAL_MEMORY_LIMITS.context); assert.match(prompt, /龍紋鑰匙/); assert.match(prompt, /omitted/);
  assert.ok(f.service.state().contextStatus.omitted > 0); assert.equal(f.service.state().items.length, 8); assert.equal(f.service.state().profile.anatomy.length, 4000);
});

test('requested profile fields precede oversized unrelated fields and named abilities need no invented restrictions', async () => {
  const f = fixture();
  await f.service.saveProfile(profileDraft(f.service, {build: '型'.repeat(4000), body: '體'.repeat(4000), appearance: '外貌資料' + '貌'.repeat(3900), penis: '使用者明確填寫' + '資'.repeat(3900)}));
  await f.service.saveEntry('abilities', {name: '時間停止能力', description: ''});
  const requested = f.service.contextText('角色詢問我的陰莖資料');
  assert.match(requested, /使用者明確填寫/); assert.match(requested, /時間停止能力/);
  assert.ok(requested.length <= PERSONAL_MEMORY_LIMITS.context);
  assert.match(f.service.contextText('describe my appearance'), /外貌資料/);
  assert.match(requested, /以能力名稱與使用者填寫的描述接續劇情/);
  assert.match(JSON.stringify(f.service.exportWorldbook()), /不可擅加未記載的冷卻/);
});

test('worldbook export includes all facts and explicit blanks without host API access', async () => {
  const f = fixture();
  await f.service.saveProfile(profileDraft(f.service, {penis: '', customFields: [{name: '自訂', value: '測試'}]}));
  await f.service.saveEntry('abilities', {name: '能力甲', description: '效果只有這一項'});
  const exported = f.service.exportWorldbook(), entries = Object.values(exported.entries);
  assert.ok(entries.every(e => e.constant && e.extensions.tavern_pocket_memory.persona === '使用者甲'));
  assert.ok(entries.some(e => e.content.includes('"field":"penis","value":""')));
  assert.ok(entries.some(e => e.content.includes('能力甲'))); assert.ok(entries.some(e => e.content.includes('自訂')));
  assert.equal(f.savedBooks.length, 0);
});

test('worldbook sync replaces only owned entries, preserving unrelated entries and metadata exactly', async () => {
  const f = fixture(), name = f.service.state().worldbook.name;
  const unrelated = {uid: '0', comment: '自己寫的', content: 'KEEP_ME', custom: {unchanged: true}};
  const foreign = {uid: 9, content: 'OTHER_OWNER', extensions: {tavern_pocket_memory: {owner: 'tavern-pocket', version: 1, persona: '其他人'}}};
  f.books.set(name, {customRoot: 'KEEP_ROOT', entries: {custom: unrelated, other: foreign, old: {uid: 7, content: 'OLD_OWNED', extensions: {tavern_pocket_memory: {owner: 'tavern-pocket', version: 1, persona: '使用者甲'}}}}});
  await f.service.saveEntry('items', {name: '全新物品', description: '完整資料'});
  await f.service.syncWorldbook();
  const book = f.books.get(name);
  assert.deepEqual(book.entries.custom, unrelated); assert.deepEqual(book.entries.other, foreign); assert.equal(book.customRoot, 'KEEP_ROOT');
  assert.doesNotMatch(JSON.stringify(book), /OLD_OWNED/); assert.match(JSON.stringify(book), /全新物品/);
  assert.equal(new Set(Object.values(book.entries).map(x => String(x.uid))).size, Object.values(book.entries).length);
  assert.equal(f.service.state().worldbook.status, '已同步');
  await f.service.syncWorldbook(); assert.equal(Object.keys(f.books.get(name).entries).length, Object.keys(book.entries).length);
});

test('stale worldbook name lists never hide cached existing entries or cause duplicate owned rows', async () => {
  const f = fixture(), name = f.service.state().worldbook.name;
  const unrelated = {uid: 0, comment: '快取中的手動條目', content: 'KEEP_CACHED_ENTRY'};
  f.books.set(name, {entries: {manual: unrelated}});
  f.c.getWorldInfoNames = () => [];
  let loads = 0; f.c.loadWorldInfo = async target => { loads++; return structuredClone(f.books.get(target)); };
  await f.service.syncWorldbook();
  const count = Object.keys(f.books.get(name).entries).length;
  await f.service.syncWorldbook();
  assert.equal(loads, 2);
  assert.deepEqual(f.books.get(name).entries.manual, unrelated);
  assert.equal(Object.keys(f.books.get(name).entries).length, count);
  f.c.loadWorldInfo = async () => null;
  await assert.rejects(f.service.syncWorldbook(), /讀取失敗/);
  assert.equal(f.savedBooks.length, 2, 'a previously synced but unreadable book is never replaced');
});

test('worldbook auto sync defaults off; failure keeps durable facts and surfaces the error', async () => {
  const f = fixture(); await f.service.saveEntry('items', {name: '已保存'}); assert.equal(f.savedBooks.length, 0);
  f.c.saveWorldInfo = async () => { throw Error('世界書連線失敗'); };
  await f.service.saveOptions({revision: f.service.state().revision, autoWorldbook: true});
  assert.equal(f.service.state().items.length, 1); assert.equal(f.service.state().worldbook.status, '同步失敗');
  assert.match(f.service.state().worldbook.error, /連線失敗/); assert.equal(f.notices.length, 1);
});

test('switching persona while loading a worldbook never writes into either persona book', async () => {
  const f = fixture(), name = f.service.state().worldbook.name;
  let release; const pending = new Promise(resolve => { release = resolve; });
  f.books.set(name, {entries: {}}); f.c.loadWorldInfo = async () => pending;
  const saving = f.service.syncWorldbook(); await Promise.resolve();
  f.switchTo({name1: '新使用者'}); release({entries: {}});
  await assert.rejects(saving, {code: 'STALE'}); assert.equal(f.savedBooks.length, 0); assert.equal(f.service.state().worldbook.lastSyncedAt, 0);
});
