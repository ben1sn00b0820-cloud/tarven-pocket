import test from 'node:test';
import assert from 'node:assert/strict';
import {parseChatReply, buildChatRequest} from '../core/chat.js';
import {DEFAULT_FORMAT} from '../core/protocol.js';
const options = {members: [{name: '雲璃'}], user: '公子', voiceFormat: DEFAULT_FORMAT};

test('native chat converts all explicit grades once and keeps legacy amounts exact', () => {
  const rows = parseChatReply('雲璃：[轉帳 2 中品靈石] 丹藥費\n雲璃：[紅包 1 極品 2 中品 3 下品] 賀禮\n雲璃：[转账 ¥12.34] 舊帳', options);
  assert.deepEqual(rows.map(x => [x.kind, x.amount]), [['transfer','200.00'], ['redpacket','100203.00'], ['transfer','12.34']]);
});

test('malformed explicit payments never become a different random amount', () => {
  for (const label of ['紅包','轉帳']) {
    for (const amount of ['1 上品靈石', '0.001 中品靈石', '1 極品 2 上品', 'Infinity 中品靈石']) {
      const rows = parseChatReply(`雲璃：[${label} ${amount}] 賀禮`, options);
      assert(!rows.some(x => ['transfer','redpacket'].includes(x.kind)), amount);
    }
  }
});

test('currency context distinguishes canonical balance from displayed mixed grades', () => {
  const messages = [{from: '雲璃', kind: 'transfer', amount: '100203.00', state: 'sent'}];
  const request = buildChatRequest({...options, preset: {entries: [], history: 20}, thread: {type: 'dm', name: '雲璃', messages}});
  assert.match(request[0].content, /1000 枚中品靈石 = 100000 枚下品靈石/);
  assert.match(request[1].content, /1 枚極品靈石 · 2 枚中品靈石 · 3 枚下品靈石/);
  assert.doesNotMatch(request[1].content, /¥/);
});
