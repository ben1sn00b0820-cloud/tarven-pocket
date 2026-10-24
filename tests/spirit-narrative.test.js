import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNarrativeAcquisitions, createNarrativeMemory} from '../pocket/narrative-memory.js';
import {generateShopCatalogue} from '../pocket/services.js';
import {TTSBackend} from '../core/backend.js';
import {defaultWallet, normalizeWallet} from '../core/wallet.js';
import {SPIRIT_CURRENCY_RULE} from '../core/currency.js';

const parse = text => parseNarrativeAcquisitions(text, {isUser: true, messageKey: 'stable-message'});

test('new and legacy shop names recognize the same explicit acquisition without changing old event payloads', () => {
  for (const name of ['萬寶閣', '万宝阁', '萬寶商城', '万宝商城']) {
    const result = parse(`我在${name}以2中品靈石購買了「凝氣丹」。`);
    assert.equal(result.errors.length, 0);
    assert.equal(result.events[0].price, 200);
    assert.equal(result.events[0].name, '凝氣丹');
  }
  const old = parse('我在萬寶商城花費12.34元購買了「急救包」。').events[0];
  assert.deepEqual(old, {id: 'narrative:stable-message:0', kind: 'items', name: '急救包', description: '正文取得／明示價格：¥12.34。', acquisition: 'purchase', price: 12.34});
});

test('narrative grades convert once, with exact fractional higher-grade input', () => {
  for (const [amount, expected] of [['1極品', 100000], ['0.5極品靈石', 50000], ['1.25中品', 125], ['1極品 2中品 3下品', 100203], ['200枚下品靈石', 200]]) {
    const result = parse(`我在萬寶閣花費${amount}購買了「凝氣丹」。`);
    assert.equal(result.errors.length, 0, amount);
    assert.equal(result.events[0].price, expected, amount);
  }
  const transition = parse('我先以茶待客，我在萬寶閣以2中品購買了「凝氣丹」。');
  // An explicit first-person shop phrase is recognized even when price parsing
  // encounters an earlier 「以」 in the surrounding prose.
  assert.equal(transition.events[0].price, 200);
});

test('unpriced purchases remain unpriced; invalid explicit denominations never produce acquisitions', () => {
  const result = parse('我在萬寶閣購買了「尚未定價的丹藥」。');
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].price, undefined);
  assert.equal(result.events[0].description, '正文取得／未記載價格。');
  for (const price of ['0.001中品', '2上品', '1000極品', '約2中品', 'NaN下品']) {
    const result = parse(`我在萬寶閣以${price}購買了「凝氣丹」。`);
    assert.equal(result.events.length, 0, price);
    assert.equal(result.errors[0].code, 'INVALID_PRICE', price);
  }
});

test('new shop names retain quotation, intention and third-party boundaries', () => {
  for (const text of ['如果我在萬寶閣以2中品購買了「凝氣丹」。', '我想在萬寶閣以2中品購買了「凝氣丹」。', '他說：「我在萬寶閣以2中品購買了凝氣丹。」', '我打開萬寶閣，雲璃以2中品購買了「凝氣丹」。']) assert.equal(parse(text).events.length, 0, text);
});

test('production narrative journal and wallet purchase debit a converted price once across replay and restore', async () => {
  const b = Object.create(TTSBackend.prototype);
  b.settings = {chat: {wallet: {...defaultWallet(), balance: 500000}}};
  b.closed = false; b.walletQueue = Promise.resolve(); b.emit = () => {};
  b.getState = () => structuredClone(b.settings);
  b.save = next => { b.settings = {chat: {wallet: normalizeWallet(next.chat.wallet)}}; };
  const c = {chatId: 'jade-story', characterId: 0, characters: [{avatar: 'jade.png'}], chat: [], chatMetadata: {}, name1: '公子', saveChat: async () => {}, saveMetadata: async () => {}};
  const acquire = async event => {
    if (event.price === undefined) return;
    await b.pocketPurchase({id: event.id, name: event.name, description: event.description, price: event.price, kind: event.kind}, event.id);
  };
  const make = () => createNarrativeMemory({context: () => c, acquire});
  const bridge = make(); await bridge.baseline();
  c.chat.push({is_user: true, mes: '我在萬寶閣以1極品 2中品 3下品購買了「凝氣丹」。', extra: {}});
  assert.equal((await bridge.sync()).acquired, 1);
  assert.equal(b.wallet().balance, 399797);
  assert.equal(b.wallet().inventory[0].price, 100203);
  await bridge.sync(); await make().sync();
  assert.equal(b.wallet().balance, 399797);
  assert.equal(b.wallet().journal.length, 1);
});

test('legacy public catalogue generator uses explicit spirit units without mutating input state', async () => {
  const calls = [], metadata = {kept: true};
  const c = {chatMetadata: metadata, generateQuietPrompt: async request => { calls.push(request); return JSON.stringify({items: [{title: '凝氣丹', text: '恢復靈力。', amount: '2中品'}]}); }};
  const items = await generateShopCatalogue(c);
  assert.equal(items[0].amount, 200);
  assert.ok(calls[0].quietPrompt.includes(SPIRIT_CURRENCY_RULE));
  assert.doesNotMatch(calls[0].quietPrompt, /人民幣|"amount":12\.34/);
  assert.deepEqual(metadata, {kept: true});
  for (const amount of [1.25, '0.001中品', 100000000, null]) {
    c.generateQuietPrompt = async () => JSON.stringify({items: [{title: '凝氣丹', text: '恢復靈力。', amount}]});
    await assert.rejects(generateShopCatalogue(c), /價格須為/);
  }
});
