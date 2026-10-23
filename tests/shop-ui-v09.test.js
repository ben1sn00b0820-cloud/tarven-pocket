import test from 'node:test';
import assert from 'node:assert/strict';
import {searchMarkup, shopPresetEditorMarkup} from '../pocket/shop-ui.js';

const state = {
  selectedId:'fantasy', limits:{prompt:24000},
  presets:[
    {id:'fantasy', name:'依需求・跨世界幻想', prompt:'保持指定能力。', builtin:true},
    {id:'custom', name:'自訂日用品', prompt:'優先生活用品。'},
  ],
};

test('shop search exposes saved preset selection beside query without generating an action', () => {
  const html = searchMarkup({shopPresets:state});
  assert.match(html, /data-field="shop-preset"/);
  assert.match(html, /value="fantasy" selected/);
  assert.match(html, /value="custom"/);
  assert.match(html, /data-action="shop-presets"/);
  assert.match(html, /data-action="shop-search"/);
  assert.doesNotMatch(html, /onclick=|onchange=/);
});

test('busy search disables both preset selector and manager to preserve request choice', () => {
  const html = searchMarkup({shopPresets:state, busy:true});
  assert.match(html, /data-field="shop-preset"[^>]* disabled/);
  assert.match(html, /data-action="shop-presets" disabled/);
});

test('preset editor preserves readonly builtins with a separate editable copy action', () => {
  const html = shopPresetEditorMarkup(state, state.presets[0]);
  assert.match(html, /data-field="shop-preset-prompt"[^>]*readonly/);
  assert.match(html, /data-action="shop-preset-copy"/);
  assert.doesNotMatch(html, /data-action="shop-preset-save"|data-action="shop-preset-delete"/);
  assert.match(html, /目前使用中/);
});

test('custom preset editor exposes import export save and selection with escaped user content', () => {
  const evil = {...state.presets[1], name:'<img src=x onerror=alert(1)>', prompt:'</textarea><script>alert(1)</script>'};
  const html = shopPresetEditorMarkup({...state,presets:[evil]}, evil, '<script>notice</script>');
  assert.match(html, /data-shop-preset-import/);
  for (const action of ['save','delete','export','use']) assert.match(html, new RegExp(`data-action="shop-preset-${action}"`));
  assert.doesNotMatch(html, /<script>|<img src=x/);
  assert.match(html, /&lt;\/textarea&gt;&lt;script&gt;/);
  assert.match(html, /maxlength="24000"/);
});

test('catalogue diagnostics show escaped generation preset, never treating it as HTML', () => {
  const html = searchMarkup({source:{mode:'query',query:'能力',presetName:'<b>跨世界</b>'}});
  assert.match(html, /生成預設：&lt;b&gt;跨世界&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>跨世界/);
});
