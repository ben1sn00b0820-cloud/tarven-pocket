import test from 'node:test';
import assert from 'node:assert/strict';
import {SPIRIT_UNITS, SPIRIT_CURRENCY_RULE, SPIRIT_MAX, parseSpiritAmount, parseSpiritText, splitSpiritAmount, formatSpiritAmount, legacyWalletAmount, legacyHundredths, addWalletAmount} from '../core/currency.js';
import {defaultWallet, normalizeWallet, walletAmount, purchaseItem} from '../core/wallet.js';
import {parseShopItems, parseShopResponse, shopPrice, shopInstruction} from '../pocket/shop.js';

test('three grades have the requested exact ratios, with no fourth grade', () => {
  assert.deepEqual(SPIRIT_UNITS, {lower: 1, middle: 100, supreme: 100000});
  assert.equal(parseSpiritAmount('1', '極品'), parseSpiritAmount('1000', '中品'));
  assert.equal(parseSpiritAmount('1', '中品'), parseSpiritAmount('100', '下品'));
  assert.deepEqual(splitSpiritAmount(100203), {supreme: 1, middle: 2, lower: 3});
  assert.throws(() => parseSpiritAmount(1, '上品'));
});

test('decimal higher-grade input converts exactly into whole lower-grade stones', () => {
  assert.equal(parseSpiritAmount('1.25', 'middle'), 125);
  assert.equal(parseSpiritAmount('0.00001', 'supreme'), 1);
  assert.equal(parseSpiritAmount('0.01', 'middle'), 1);
  assert.equal(parseSpiritAmount('12.00'), 12);
  assert.throws(() => parseSpiritAmount('0.001', 'middle'));
  assert.throws(() => parseSpiritAmount('0.000001', 'supreme'));
  assert.throws(() => parseSpiritAmount('0.25', 'lower'));
});

test('mixed amounts parse explicit grades without interpreting a price expression as code', () => {
  assert.equal(parseSpiritText('1極品 2中品 3下品'), 100203);
  assert.equal(parseSpiritText('1 枚極品靈石、2 枚中品靈石、3 枚下品靈石'), 100203);
  assert.equal(parseSpiritText('1,000 中品靈石'), 100000);
  assert.equal(parseSpiritText('2极品灵石'), 200000);
  assert.equal(parseSpiritText('25 枚靈石'), 25);
  for (const raw of ['1e5', '2*100', 'Infinity', '1上品', '1中品執行腳本', '1下品-2下品', '1下品+', '1,,000', '  ', null, {}, true]) assert.throws(() => parseSpiritText(raw));
});

test('negative, unsafe and over-limit new amounts are rejected before numeric conversion', () => {
  for (const amount of [-1, NaN, Infinity, '9007199254740993', SPIRIT_MAX + 1, '1.234567890123456789']) assert.throws(() => parseSpiritAmount(amount));
  assert.throws(() => parseSpiritAmount('9007199254740991', 'supreme', {max: Number.MAX_SAFE_INTEGER}));
  assert.throws(() => parseSpiritAmount('0', 'lower', {zero: false}));
  assert.equal(parseSpiritAmount('0'), 0);
  assert.equal(parseSpiritAmount(String(SPIRIT_MAX)), SPIRIT_MAX);
});

test('formatting decomposes grades and retains legacy tails without rounding or multiplying', () => {
  assert.equal(formatSpiritAmount(100203), '1 枚極品靈石 · 2 枚中品靈石 · 3 枚下品靈石');
  assert.equal(formatSpiritAmount(520), '5 枚中品靈石 · 20 枚下品靈石');
  assert.equal(formatSpiritAmount(520.05), '5 枚中品靈石 · 20.05 枚下品靈石');
  assert.equal(formatSpiritAmount(520.05, {legacyNote: true}), '5 枚中品靈石 · 20.05 枚下品靈石（含舊帳尾數）');
  assert.equal(formatSpiritAmount(520.05, {compact: false}), '520.05 枚下品靈石');
  assert.equal(formatSpiritAmount(0), '0 枚下品靈石');
  assert.equal(formatSpiritAmount(-0.01), '−0.01 枚下品靈石');
  assert.equal(formatSpiritAmount(NaN), '未知靈石');
});

test('legacy settlement uses exact arithmetic and rejects precision loss', () => {
  assert.equal(addWalletAmount(.1, .2), .3);
  assert.equal(addWalletAmount(520, -13.14), 506.86);
  assert.equal(addWalletAmount(506.86, 13.14), 520);
  assert.equal(addWalletAmount(100.01, -100, {signed: false}), .01);
  assert.throws(() => addWalletAmount(1, -2, {signed: false}));
  assert.throws(() => addWalletAmount(SPIRIT_MAX, 1));
  assert.throws(() => legacyWalletAmount('1.005'));
  assert.throws(() => legacyWalletAmount('0.30000000000000004'));
  assert.throws(() => legacyHundredths('9007199254740991', {max: Number.MAX_SAFE_INTEGER}));
  assert.throws(() => legacyWalletAmount('90071992547409.91', {max: Number.MAX_SAFE_INTEGER}));
});

test('old balances, ledger, inventory, pending transaction IDs and tails survive repeat normalization', () => {
  const old = {balance: 520.05, ledger: [{id: 'x', at: 1, amount: -12.34, kind: 'transfer', note: '原註記', who: '雲璃'}], owned: [], gifts: [], received: [],
    inventory: [{id: 'old-item', name: '舊丹藥', price: 12.34, description: '舊物', emoji: '💊', orderId: 'order-1', at: 1}],
    journal: [{id: 'send-1', flow: 'send', status: 'pending', at: 1, amount: -12.34, threadId: 't', messageId: 'm', action: '', actor: '', notice: false, fingerprint: 'same-original-payment'}]};
  const first = normalizeWallet(old), second = normalizeWallet(first);
  assert.equal(first.balance, old.balance);
  assert.equal(first.ledger[0].amount, -12.34);
  assert.equal(first.inventory[0].price, 12.34);
  assert.equal(first.journal[0].id, 'send-1');
  assert.equal(first.journal[0].amount, -12.34);
  assert.equal(first.journal[0].fingerprint, 'same-original-payment');
  assert.deepEqual(first, second);
  assert.equal(defaultWallet().balance, 520);
});

test('new wallet entry is whole lower grade while explicit legacy settlement remains available', () => {
  assert.equal(walletAmount(25), 25);
  assert.equal(walletAmount('1.25', {unit: 'middle'}), 125);
  assert.throws(() => walletAmount(25.5));
  assert.equal(walletAmount(25.5, {legacy: true}), 25.5);
  assert.equal(purchaseItem({id: 'cached', name: '舊商品', price: 12.34}).price, 12.34);
});

test('new catalogue prices use integer lower grade and accept exact explicit higher grades', () => {
  const item = {name: '丹藥', description: '恢復靈力', price: 100000};
  assert.equal(parseShopItems(JSON.stringify({items: [item]}))[0].price, 100000);
  assert.equal(shopPrice('2 中品靈石'), 200);
  assert.equal(shopPrice('0.5 極品靈石'), 50000);
  assert.equal(parseShopResponse(JSON.stringify({items: [{...item, price: '1極品 2中品 3下品'}]})).items[0].price, 100203);
  for (const bad of [.01, 12.34, SPIRIT_MAX + 1, '¥25', '25元', '0.001中品', null]) assert.throws(() => shopPrice(bad));
  assert.throws(() => parseShopItems(JSON.stringify({items: [{...item, price: 1.25}]})));
});

test('catalogue prompt fixes the grade conversion and never emits fractional new prices', () => {
  const prompt = shopInstruction({query: '丹藥'});
  assert.ok(prompt.includes(SPIRIT_CURRENCY_RULE));
  assert.match(prompt, /萬寶閣/);
  assert.match(prompt, /"price":25,/);
  assert.doesNotMatch(prompt, /最多兩位小數的數字|使用虛擬金錢/);
});
