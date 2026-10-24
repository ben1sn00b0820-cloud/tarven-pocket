import test from 'node:test';
import assert from 'node:assert/strict';
import {outgoingChat,withoutVoice} from '../core/outgoing.js';
import {DEFAULT_FORMAT} from '../core/protocol.js';

const voiced=(translation='早安。',role='甲')=>`“${translation}”<tts>${role}|平靜|${translation}</tts>`;

test('outgoing request defaults strip old voice markup from every reply, including the latest',()=>{
    const saved=[{is_user:false,mes:voiced()},{is_user:true,mes:'繼續。'},{is_user:false,mes:voiced('午安。','乙')}];
    const request=saved.slice();
    assert.equal(outgoingChat(request),request);
    assert.deepEqual(request.map(m=>m.mes),['“早安。”','繼續。','“午安。”']);
    assert.equal(saved[0].mes,voiced());
    assert.equal(saved[2].mes,voiced('午安。','乙'));
    assert.notEqual(request[0],saved[0]);
    assert.equal(request[1],saved[1]);
});

test('explicit keepLatest compatibility preserves only the newest voiced assistant reply',()=>{
    const chat=[{is_user:false,mes:voiced()},{is_user:false,mes:voiced('午安。','乙')},{is_user:true,mes:voiced('範例。')},{is_user:false,mes:'普通正文。'}];
    outgoingChat(chat,{keepLatest:true});
    assert.deepEqual(chat.map(m=>m.mes),['“早安。”',voiced('午安。','乙'),'“範例。”','普通正文。']);
});

test('request cleanup removes only duplicate legacy speech copies and preserves intentional repeats',()=>{
    const chat=[{mes:'「早安。」\n\n'+voiced()},{mes:'「再見。」\n「再見。」'}];
    outgoingChat(chat);
    assert.deepEqual(chat.map(m=>m.mes),['「早安。」','「再見。」\n「再見。」']);
});

test('outgoing cleanup retains image stripping and explicit opt-outs independently',()=>{
    const picture='<img>sunlit garden|甲</img>',raw=voiced()+'\n'+picture;
    const both=[{mes:raw}],voiceOnly=[{mes:raw}],picturesOnly=[{mes:raw}],neither=[{mes:raw}];
    outgoingChat(both);outgoingChat(voiceOnly,{pictures:false});outgoingChat(picturesOnly,{voice:false});outgoingChat(neither,{pictures:false,voice:false});
    assert.equal(both[0].mes,'“早安。”');
    assert.equal(voiceOnly[0].mes,'“早安。”\n'+picture);
    assert.equal(picturesOnly[0].mes,voiced());
    assert.equal(neither[0].mes,raw);
});

test('legacy cleanup honors configured formats and keeps code examples untouched',()=>{
    const custom='[說話:{角色}|{情绪}|{文本}|譯文:{译文}]';
    assert.equal(withoutVoice('[說話:甲|平靜|Good morning|譯文:早安。]',[custom]),'“早安。”');
    assert.equal(withoutVoice('```\n'+voiced()+'\n```',[DEFAULT_FORMAT]),'```\n'+voiced()+'\n```');
    assert.equal(withoutVoice('“A &amp; B”<tts>甲|平靜|A and B</tts>'),'“A & B”');
});

test('missing or nontext messages remain unchanged',()=>{
    assert.equal(outgoingChat(null),null);
    const untouched=[null,{content:'host-owned'},undefined,{mes:42}];
    assert.equal(outgoingChat(untouched),untouched);
    assert.deepEqual(untouched,[null,{content:'host-owned'},undefined,{mes:42}]);
});
