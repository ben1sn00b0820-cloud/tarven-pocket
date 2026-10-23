import test from 'node:test';
import assert from 'node:assert/strict';
import {LANGUAGES, languageCode, customLanguages} from '../core/languages.js';
import {TTSParameters} from '../core/parameters.js';
import {input, textArea, esc} from '../ui/common.js';

test('Traditional Chinese language labels keep existing Simplified and English selections compatible', () => {
  assert.equal(LANGUAGES.find(([code]) => code === 'ja')[1], '日語');
  for (const value of ['日語', '日语', 'Japanese', 'ja']) assert.equal(languageCode(value), 'ja');
  for (const value of ['英語', '英语', 'English', 'en']) assert.equal(languageCode(value), 'en');
  assert.deepEqual(customLanguages(['日语', '日語', 'ja', 'English', '自訂方言']), ['自訂方言']);
});

test('interface localization preserves user-authored prompt text and external Chinese voice identifiers', () => {
  const text = '我的画师串，正面提示词，截图简体保持原文 & <tag>';
  assert.ok(input('prompt', text).includes('value="' + esc(text) + '"'));
  assert.ok(textArea('negative', text).includes('>' + esc(text) + '</textarea>'));
  assert.ok(TTSParameters.vocab.MIMO_VOICES.some(([id, label]) => id === '苏打' && label === '蘇打 · 中文男聲'));
  assert.ok(TTSParameters.vocab.MIMO_VOICES.some(([id]) => id === '白桦'));
  assert.equal(TTSParameters.miniEmotion('speech-2.8-hd', '开心'), 'happy');
});
