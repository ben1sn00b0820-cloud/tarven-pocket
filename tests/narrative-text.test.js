import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanNarrativeText} from '../core/narrative-text.js';
import {DEFAULT_FORMAT,LEGACY_FORMATS} from '../core/protocol.js';
import {renderMemoryMentions} from '../pocket/mentions.js';

const voice=(said='早安。',role='甲')=>`“${said}”<tts>${role}|平靜|${said}</tts>`;

test('ordinary dialogue followed by its legacy TTS copy shows exactly once',()=>{
    const raw='「早安。」\n\n'+voice();
    assert.equal(cleanNarrativeText(raw),'「早安。」');
    assert.equal(raw,'「早安。」\n\n'+voice());
});
test('ordinary dialogue following its TTS copy is retained verbatim',()=>{
    assert.equal(cleanNarrativeText(voice()+'\n\n『早安。』'),'『早安。』');
});
test('straight and curly quotes compare equally without rewriting surviving quote style',()=>{
    assert.equal(cleanNarrativeText('"早安。" '+voice()),'"早安。"');
    assert.equal(cleanNarrativeText(voice()+' “早安。”'),'“早安。”');
});
test('whitespace and ellipsis normalize only for duplicate comparison',()=>{
    assert.equal(cleanNarrativeText('「Good  morning......」\n'+voice('Good morning…')),'「Good  morning......」');
    assert.equal(cleanNarrativeText('「ab」\n'+voice('a b')),'「ab」\n“a b”');
});
test('ordinary intentional repeated dialogue is never deduplicated',()=>{
    const raw='「早安。」\n\n「早安。」';assert.equal(cleanNarrativeText(raw),raw);
});
test('two tagged speakers are preserved even when their words match',()=>{
    assert.equal(cleanNarrativeText(voice('早安。','甲')+'\n'+voice('早安。','乙')),'“早安。”\n“早安。”');
});
test('intervening narration and different wording prevent deduplication',()=>{
    assert.equal(cleanNarrativeText('「早安。」\n他再次開口。\n'+voice()),'「早安。」\n他再次開口。\n“早安。”');
    assert.equal(cleanNarrativeText('「早安！」\n'+voice()),'「早安！」\n“早安。”');
});
test('only the machine-derived copy is removed between two ordinary copies',()=>{
    assert.equal(cleanNarrativeText('「早安。」\n'+voice()+'\n「早安。」'),'「早安。」\n「早安。」');
});
test('legacy attribute tags and mixed tag formats are rendered',()=>{
    const legacy='“午安。”<tts role="乙" emotion="平靜">午安。</tts>';
    assert.equal(cleanNarrativeText(voice()+'\n'+legacy),'“早安。”\n“午安。”');
    assert.equal(cleanNarrativeText('「午安。」\n'+legacy),'「午安。」');
});
test('user-defined formats are honored without overlapping default reads',()=>{
    const custom='[說話:{角色}|{情绪}|{文本}|譯文:{译文}]';
    assert.equal(cleanNarrativeText('[說話:甲|平靜|Good morning|譯文:早安。]',[custom]),'“早安。”');
    assert.equal(cleanNarrativeText('「早安。」\n[說話:甲|平靜|Good morning|譯文:早安。]',[custom]),'「早安。」');
    assert.equal(cleanNarrativeText(voice(),[DEFAULT_FORMAT,DEFAULT_FORMAT,...LEGACY_FORMATS]),'“早安。”');
});
test('code examples remain untouched for fences, inline code and HTML code',()=>{
    for(const raw of ['```html\n'+voice()+'\n```','~~~\n'+voice()+'\n~~~','`'+voice()+'`','<pre>'+voice()+'</pre>','<code>'+voice()+'</code>'])assert.equal(cleanNarrativeText(raw),raw);
});
test('phone events, CSB machine blocks and unrelated markup remain intact',()=>{
    for(const raw of ['<phone>{"text":"'+voice()+'"}</phone>','<CSB_UPDATE>{"example":"'+voice()+'"}</CSB_UPDATE>','<div class="note">甲|平靜|早安。</div>'])assert.equal(cleanNarrativeText(raw),raw);
    const attribute='<span title="<tts>甲|平靜|早安。</tts>">標籤說明</span>';
    assert.equal(cleanNarrativeText(attribute),attribute);
});
test('html mode escapes only the derived translation and preserves existing markup',()=>{
    const raw='<b>記錄</b>\n“&lt;img src=x&gt;”<tts>甲|平靜|內容</tts>';
    assert.equal(cleanNarrativeText(raw,[],{html:true}),'<b>記錄</b>\n“&lt;img src=x&gt;”');
    assert.equal(cleanNarrativeText(raw),'<b>記錄</b>\n“<img src=x>”');
});
test('malformed closed tags hide undecodable metadata while preserving neighboring text',()=>{
    const raw='前文。\n「早安。」<tts>甲||錯誤|多餘欄位</tts>\n後文。';
    assert.equal(cleanNarrativeText(raw),'前文。\n「早安。」\n後文。');
    assert.equal(cleanNarrativeText('<tts>無法解碼</tts>下一句。'),'下一句。');
});
test('unclosed pipe metadata is hidden only on its own first line',()=>{
    assert.equal(cleanNarrativeText('前文。\n<tts>甲|平靜|未完成\n下一段正常正文。'),'前文。\n\n下一段正常正文。');
    assert.equal(cleanNarrativeText('`<tts>甲|平靜|未完成`'),'`<tts>甲|平靜|未完成`');
});
test('cleanup is idempotent and does not touch unrelated speaker-like prose',()=>{
    const raw='「早安。」\n'+voice()+'\n<span>其他內容</span>';
    const once=cleanNarrativeText(raw,[],{html:true});
    assert.equal(cleanNarrativeText(once,[],{html:true}),once);
    assert.equal(cleanNarrativeText('甲|平靜|早安。'),'甲|平靜|早安。');
});
test('cleaning legacy text before mention rendering preserves working mention chips',()=>{
    const raw=voice('請查看 @我的資訊 。');
    const output=renderMemoryMentions(cleanNarrativeText(raw,[],{html:true}));
    assert.match(output,/<span class="tp-memory-reference tp-memory-reference-profile"/);
    assert.doesNotMatch(output,/&lt;span|<tts>/);
    assert.equal((output.match(/data-tp-memory-reference="profile"/g)||[]).length,1);
});
