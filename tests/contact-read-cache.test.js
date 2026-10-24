import test from 'node:test';
import assert from 'node:assert/strict';
import {createContactBridge} from '../pocket/contacts.js';
import {sourceScope} from '../pocket/source-sync.js';
import {newDatabase} from '../companions/csb-character-state/src/schema.js';

function fixture() {
  const db = newDatabase();
  db.seed.characters.c_lin = {id: 'c_lin', name: '林澈', aliases: [], present: true, values: {mood: '平靜'}};
  const c = {chatId: 'one', characterId: 0, name1: '使用者', name2: '林澈', chat: [], chatMetadata: {}, characters: [{name: '林澈', avatar: 'lin.png'}]};
  let revision = 1, snapshots = 0;
  const api = {apiVersion: 1, getRevision: () => `${sourceScope(c)}:${revision}`,
    getSnapshot: () => { snapshots++; return {scope: sourceScope(c), enabled: true, schema: db.schema, state: db.seed, locks: db.locks, pinned: db.pinned}; }};
  const backend = {settings: {chat: {contacts: []}, routes: []}, contacts: () => []};
  return {db, c, api, backend, change: () => revision++, get snapshots() { return snapshots; }};
}

test('repeated profile/directory/prompt reads share one CSB projection until a real revision changes', () => {
  const f = fixture(), previous = globalThis.CSBCharacterState; globalThis.CSBCharacterState = f.api;
  try {
    const bridge = createContactBridge({context: () => f.c, backend: f.backend});
    for (let i = 0; i < 30; i++) { bridge.profile('林澈'); bridge.profiles(); bridge.promptFor(['林澈']); }
    assert.equal(f.snapshots, 1, '90 callers require only one native snapshot/validation/projection');
    f.db.seed.characters.c_lin.values.mood = '期待'; f.change();
    assert.equal(bridge.profile('林澈').fields.mood, '期待'); assert.equal(f.snapshots, 2);
    bridge.dispose();
  } finally { globalThis.CSBCharacterState = previous; }
});

test('same-length edits to old messages and selected swipe changes invalidate the cache', () => {
  const f = fixture(), previous = globalThis.CSBCharacterState; globalThis.CSBCharacterState = f.api;
  try {
    f.c.chat.push({mes: '甲', swipe_id: 0, is_user: false}, {mes: '尾部訊息', is_user: true});
    const bridge = createContactBridge({context: () => f.c, backend: f.backend});
    bridge.profiles(); assert.equal(f.snapshots, 1);
    f.c.chat[0].mes = '乙'; bridge.profiles(); assert.equal(f.snapshots, 2);
    f.c.chat[0].swipe_id = 1; bridge.profiles(); assert.equal(f.snapshots, 3);
    f.c.chat.pop(); bridge.profiles(); assert.equal(f.snapshots, 4);
  } finally { globalThis.CSBCharacterState = previous; }
});

test('manual contact and card edits made in place are visible, without leaking mutable cache objects', () => {
  const f = fixture(), previous = globalThis.CSBCharacterState; globalThis.CSBCharacterState = f.api;
  try {
    const bridge = createContactBridge({context: () => f.c, backend: f.backend});
    const first = bridge.profile('林澈'); first.csb.values.mood = '外部亂改';
    assert.equal(bridge.profile('林澈').csb.values.mood, '平靜');
    f.backend.settings.chat.contacts.push({name: '新人', id: 'n'}); bridge.profiles(); assert.equal(f.snapshots, 2);
    f.c.characters[0].description = '身份：劍修'; bridge.profiles(); assert.equal(f.snapshots, 3);
  } finally { globalThis.CSBCharacterState = previous; }
});

test('native API without revision remains fresh instead of being cached by chat length', () => {
  const f = fixture(), previous = globalThis.CSBCharacterState; delete f.api.getRevision; globalThis.CSBCharacterState = f.api;
  try {
    const bridge = createContactBridge({context: () => f.c, backend: f.backend});
    assert.equal(bridge.profile('林澈').fields.mood, '平靜');
    f.db.seed.characters.c_lin.values.mood = '驚訝';
    assert.equal(bridge.profile('林澈').fields.mood, '驚訝');
  } finally { globalThis.CSBCharacterState = previous; }
});
