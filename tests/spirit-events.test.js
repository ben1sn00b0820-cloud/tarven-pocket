import test from 'node:test';
import assert from 'node:assert/strict';
import {encodePhoneEvents, normalizeEvent, parsePhoneEvents, parseRolePhoneCommands, parseUserPhoneCommands, PHONE_LIMITS, PHONE_VERSION} from '../pocket/events.js';
import {legacyWalletAmount, SPIRIT_MAX} from '../core/currency.js';
import {collectSourceEvents, sourceBundles} from '../pocket/source-sync.js';
import {reconcileSourceSnapshot} from '../core/chats.js';

const user = {userName: '小雨', characterName: '阿澤', isUser: true, messageKey: 'spirit-compat:message-7'};
const role = {...user, isUser: false};

test('spirit protocol version and structured money limits retain exact historical tails', () => {
  assert.equal(PHONE_VERSION, '0.13.0');
  assert.equal(PHONE_LIMITS.amount, SPIRIT_MAX);
  const event = {id: 'old-payment', app: 'wechat', action: 'transfer', from: '阿澤', to: '小雨'};
  for (const amount of [0.01, 12.34, 88.5, 200000.01, SPIRIT_MAX - 0.01, SPIRIT_MAX]) {
    assert.equal(normalizeEvent({...event, amount}, role).amount, amount);
  }
  for (const amount of [0, -1, 0.001, 1.005, 0.1 + 0.2, SPIRIT_MAX + 0.01, SPIRIT_MAX + 1, Infinity, '2中品', '12.34']) {
    assert.throws(() => normalizeEvent({...event, amount}, role));
  }
});

test('legacy bare-number and 元 event payloads, key order and IDs are unchanged', () => {
  // Literal JSON snapshots captured from the original parser before this update.
  const fixtures = [
    [parseUserPhoneCommands, user, '微信轉帳給阿澤：88.50「晚餐費」', '{"id":"cmd-1bh6o68gkevqa-0","app":"wechat","action":"transfer","from":"小雨","to":"阿澤","text":"晚餐費","amount":88.5}'],
    [parseUserPhoneCommands, user, '微信紅包給阿澤：12.34元「舊帳」', '{"id":"cmd-1bh6o68gkevqa-0","app":"wechat","action":"redpacket","from":"小雨","to":"阿澤","text":"舊帳","amount":12.34}'],
    [parseRolePhoneCommands, role, '阿澤微信轉帳給我：88.50「晚餐費」', '{"id":"rolecmd-1bh6o68gkevqa-0","app":"wechat","action":"transfer","from":"阿澤","to":"小雨","text":"晚餐費","amount":88.5}'],
    [parseRolePhoneCommands, role, '林知夏微信紅包給你：0.01元「舊帳」', '{"id":"rolecmd-1bh6o68gkevqa-0","app":"wechat","action":"redpacket","from":"林知夏","to":"小雨","text":"舊帳","amount":0.01}'],
    [parseRolePhoneCommands, {...role, legacyLineIds: true}, '舊故事前文\n\n微信轉帳給你：88.50元「晚餐費」', '{"id":"rolecmd-1bh6o68gkevqa-2","app":"wechat","action":"transfer","from":"阿澤","to":"小雨","text":"晚餐費","amount":88.5}'],
    [parseRolePhoneCommands, {...role, legacyLineIds: true}, '她笑了，微信紅包給我：20「好運」', '{"id":"rolecmd-1bh6o68gkevqa-inline-0","app":"wechat","action":"redpacket","from":"阿澤","to":"小雨","text":"好運","amount":20}'],
  ];
  for (const [parse, options, source, expected] of fixtures) {
    const result = parse(source, options);
    assert.deepEqual(result.errors, [], source);
    assert.equal(result.events.length, 1, source);
    assert.equal(JSON.stringify(result.events[0]), expected, source);
  }
});

test('new and old app aliases produce the same existing protocol actions and stable IDs', () => {
  const families = [
    [['微信', '千里傳音', '千里传音'], '傳給阿澤：「早安」', 'wechat', 'message'],
    [['Instagram', 'IG', '浮光錄', '浮光录'], '發文：「晚霞」', 'instagram', 'post'],
    [['Instagram', 'IG', '浮光錄', '浮光录'], '發限動：「練劍」', 'instagram', 'story'],
    [['Instagram', 'IG', '浮光錄', '浮光录'], '私訊給阿澤：「收到」', 'instagram', 'dm'],
    [['論壇', '论坛', '論道臺', '論道台', '论道台'], '發文：「道友請進」', 'forum', 'post'],
    [['論壇', '论坛', '論道臺', '論道台', '论道台'], '回覆post-7：「收到」', 'forum', 'comment'],
  ];
  for (const [aliases, tail, app, action] of families) {
    const expected = parseUserPhoneCommands(aliases[0] + tail, user).events;
    assert.equal(expected[0]?.app, app);
    assert.equal(expected[0]?.action, action);
    for (const alias of aliases) assert.deepEqual(parseUserPhoneCommands(alias + tail, user).events, expected, alias);
  }
  const named = parseRolePhoneCommands('林知夏在浮光錄發限動：「練劍」。接著阿澤論道臺發文：「明日大比」。', role);
  assert.deepEqual(named.events.map(e => [e.from, e.app, e.action]), [['林知夏', 'instagram', 'story'], ['阿澤', 'forum', 'post']]);
});

test('explicit spirit transfer and redpacket amounts convert once to integer lower grade', () => {
  const quantities = [
    ['25下品', 25], ['25 枚下品靈石', 25], ['25 枚靈石', 25],
    ['2中品靈石', 200], ['1.25 中品', 125], ['0.01中品', 1],
    ['1極品靈石', 100000], ['0.5极品灵石', 50000], ['0.00001極品', 1],
    ['1極品2中品3下品', 100203], ['1 極品 2 中品 3 下品', 100203],
    ['1枚極品靈石、2枚中品靈石、3枚下品靈石', 100203],
    ['1極品，2中品，3下品', 100203], ['1極品+2中品+3下品', 100203],
    ['1,000 中品靈石', 100000], ['999極品999中品99下品', SPIRIT_MAX],
  ];
  for (const [quantity, expected] of quantities) for (const verb of ['轉帳給', '紅包給']) {
    const source = `千里傳音${verb}阿澤：${quantity}「宗門資源」`;
    const result = parseUserPhoneCommands(source, user);
    assert.deepEqual(result.errors, [], source);
    assert.equal(result.events.length, 1, source);
    assert.equal(result.events[0].amount, expected, source);
    assert.ok(Number.isSafeInteger(result.events[0].amount));
    const encoded = encodePhoneEvents(result.events, user);
    assert.deepEqual(parsePhoneEvents(encoded, user).events, result.events, source);
    assert.deepEqual(normalizeEvent(result.events[0], user), result.events[0], source);
  }
  const incoming = parseRolePhoneCommands('阿澤千里傳音轉帳給你：2中品靈石「月例」', role).events[0];
  assert.equal(incoming.from, '阿澤'); assert.equal(incoming.to, '小雨'); assert.equal(incoming.amount, 200);
});

test('invalid or incomplete explicit money expressions never import a partial amount', () => {
  const quantities = [
    '0下品', '-1中品', '0.01下品', '0.001中品', '0.000001極品', '1上品',
    '1中品2上品', '1中品，2上品', '1中品，2', '1中品、', '1中品+',
    '1中品，極品', '1中品0.25下品', '1中品美元', '1中品元',
    '1,00下品', '1.0.0下品', '1.下品', '1e3中品', 'Infinity中品',
    '1000極品', '999極品999中品100下品', '999999999999999999999999999中品',
  ];
  for (const quantity of quantities) {
    const source = `千里傳音轉帳給阿澤：${quantity}「不能部分付款」`;
    assert.equal(parseUserPhoneCommands(source, user).events.length, 0, source);
  }
  for (const source of ['千里傳音轉帳給阿澤：1中品「尚未結束', '千里傳音紅包給阿澤：1中品靈石「']) {
    assert.equal(parseUserPhoneCommands(source, user).events.length, 0, source);
  }
});

test('mixed currency spans leave prose intact and aliases retain quote/auth protections', () => {
  const source = '她抬起玉符，阿澤千里傳音轉帳給你：1極品，2中品，3下品「月例」，接著雲璃千里傳音紅包給我：2中品。她放下玉符。';
  const result = parseRolePhoneCommands(source, role);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.events.map(e => [e.from, e.to, e.amount]), [['阿澤', '小雨', 100203], ['雲璃', '小雨', 200]]);
  assert.equal(source.slice(result.matches[0].start, result.matches[0].end), '阿澤千里傳音轉帳給你：1極品，2中品，3下品「月例」');
  assert.equal(source.slice(result.matches[1].start, result.matches[1].end), '雲璃千里傳音紅包給我：2中品');
  const command = '千里傳音轉帳給阿澤：2中品「月例」';
  for (const text of [`如果成功，${command}`, `我打算${command}`, `「${command}」`, `> ${command}`, `\`${command}\``, `<CSB_UPDATE>${command}</CSB_UPDATE>`, `[CSB21_PANEL]${command}[/CSB21_PANEL]`, `<div>${command}</div>`]) {
    assert.equal(parseUserPhoneCommands(text, user).events.length, 0, text);
  }
  assert.equal(parseRolePhoneCommands('小雨千里傳音轉帳給阿澤：2中品', role).events.length, 0);
  assert.equal(parseUserPhoneCommands('阿澤千里傳音轉帳給我：2中品', user).events.length, 0);
  assert.equal(parseUserPhoneCommands(command, role).events.length, 0);
  assert.equal(parseRolePhoneCommands(command, user).events.length, 0);
});

test('native source import keeps converted amount and stable receipts across repeated sync', async () => {
  const context = {
    chatId: 'spirit-events', characterId: 0, characters: [{avatar: 'aze.png'}], name1: '小雨', name2: '阿澤', chatMetadata: {},
    chat: [{is_user: false, name: '阿澤', mes: '阿澤千里傳音轉帳給你：1 極品 2 中品 3 下品「宗門資源」', send_date: 100, extra: {tavern_pocket_source_id: 'stable-spirit-event'}}],
  };
  const collected = collectSourceEvents(context), planned = await sourceBundles(collected, {space: 'card:aze.png'});
  assert.deepEqual([...collected.errors, ...planned.errors], []);
  assert.equal(collected.events.length, 1);
  assert.equal(collected.events[0].amount, 100203);
  assert.equal(planned.bundles.length, 1);
  const entry = planned.bundles[0].messages[0].message;
  assert.equal(entry.kind, 'transfer'); assert.equal(legacyWalletAmount(entry.amount), 100203);
  let serial = 0;
  const options = {accountScope: 'test', space: 'card:aze.png', now: 1000, id: () => `spirit-${++serial}`};
  const first = reconcileSourceSnapshot([], [], collected.scope, planned.bundles, options);
  const second = reconcileSourceSnapshot(first.rows, first.records, collected.scope, planned.bundles, options);
  assert.equal(first.rows[0].messages.length, 1);
  assert.equal(legacyWalletAmount(first.rows[0].messages[0].amount), 100203);
  assert.deepEqual(second.rows, first.rows);
  assert.equal(second.added, 0); assert.equal(second.changed, 0);
});
