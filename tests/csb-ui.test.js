import test from 'node:test';
import assert from 'node:assert/strict';
import {contactDetailsHTML, openContactStatusEditor} from '../ui/contact-profile.js';

const field = (id, type = 'text', extra = {}) => ({id, label: id, group: 'custom', type, default: null, ...extra});
const record = (fields, values, extra = {}) => ({name: '林澈', revision: 'rev-1', source: {kind: 'csb', version: '1.0.1'}, csb: {id: 'char-1', scope: 'one', groups: [{id: 'custom', label: '自訂資料', layout: 'grid', collapsed: false}], fields, values, editable: true, ...extra}});

test('CSB details preserve zero, false, typed lists, defaults and unknown independently', () => {
  const html = contactDetailsHTML(record([
    field('零', 'number', {unit: '點', hideEmpty: true}), field('布林', 'boolean', {hideEmpty: true}),
    field('空白'), field('選項', 'multiselect'), field('預設', 'text', {default: '已知預設'}),
  ], {'零': 0, '布林': false, '空白': null, '選項': ['甲', '乙']}));
  assert.match(html, /<dd>0 <small>點<\/small><\/dd>/);
  assert.match(html, /<dd>否<\/dd>/);
  assert.match(html, /<dd>未知<\/dd>/);
  assert.match(html, /甲、乙/);
  assert.match(html, /已知預設/);
  assert.doesNotMatch(html, /好感度|飲水度/);
});

test('CSB custom bars retain arbitrary ranges, percent, thresholds, zero and unknown', () => {
  const html = contactDetailsHTML(record([
    field('靈力', 'bar', {min: -100, max: 300, display: 'percent', color: '#12AB34', thresholds: [{at: -100, label: '休息'}, {at: 0, label: '充足'}, {at: 100, label: '過量'}]}),
    field('未知條', 'bar', {min: 0, max: 1000}),
    field('隱藏值', 'bar', {min: 0, max: 200, display: 'none'}),
  ], {'靈力': 0, '未知條': null, '隱藏值': 50}));
  assert.match(html, /<strong>25%<\/strong>/);
  assert.match(html, /aria-valuemin="-100" aria-valuemax="300" aria-valuenow="0"/);
  assert.match(html, /width:25%;background-color:#12AB34/);
  assert.match(html, /tp-csb-stage">充足/);
  assert.doesNotMatch(html, /tp-csb-stage">過量/);
  assert.match(html, /aria-label="未知條" aria-valuetext="未知"/);
  assert.match(html, /<span>隱藏值<\/span><strong><\/strong>/);
});

test('CSB groups follow order, collapse and layout while filtering hidden and empty fields', () => {
  const html = contactDetailsHTML(record([
    field('顯示'), field('停用', 'text', {hidden: true}), field('空值', 'text', {hideEmpty: true}),
    field('長文', 'longtext', {group: 'memory'}),
  ], {'顯示': 'OK', '停用': 'HIDDEN_SENTINEL', '空值': '', '長文': '記憶一\n記憶二'}, {
    groups: [{id: 'memory', label: '回憶', collapsed: true, layout: 'list'}, {id: 'custom', label: '基本', collapsed: false}],
  }));
  assert.ok(html.indexOf('回憶') < html.indexOf('基本'));
  assert.match(html, /data-group="tp-csb-memory"><summary>/);
  assert.match(html, /data-group="tp-csb-custom" open>/);
  assert.match(html, /tp-csb-fields is-list/);
  assert.match(html, /tp-csb-wide/);
  assert.doesNotMatch(html, /HIDDEN_SENTINEL|停用|空值/);
});

test('CSB schema labels and values cannot inject HTML, CSS or invalid numeric geometry', () => {
  const html = contactDetailsHTML(record([
    field('text', 'text', {label: '<img src=x onerror=alert(1)>', icon: '<b>'}),
    field('bar', 'bar', {label: '" onmouseover="bad', min: 0, max: 0, color: 'red;position:fixed', thresholds: [{at: 0, label: '<script>bad</script>'}]}),
  ], {text: '<svg onload=bad()>', bar: 1}, {aliases: ['<img src=x>']}));
  assert.doesNotMatch(html, /<img|<svg|<script|background-color:red|NaN|Infinity/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;svg/);
  assert.match(html, /aria-label="&quot; onmouseover=&quot;bad"/);
  assert.match(html, /aria-valuetext="未知"/);
});

test('legacy details still show the original status fields and body rows', () => {
  const html = contactDetailsHTML({name: '林澈', fields: {mood: '平靜', affection: '0'}, body: [{name: '左手', value: '包紮'}], source: {kind: 'status', version: '2.1'}});
  assert.match(html, /好感度/);
  assert.match(html, /<meter min="0" max="100" value="0"/);
  assert.match(html, /左手/);
  assert.match(html, /包紮/);
  assert.doesNotMatch(html, /tp-csb-fields/);
});

function editorFixture(profile, overrides = {}) {
  const calls = [], notifications = [];
  const dialog = {live: true, body: {innerHTML: ''}, close() { this.live = false; calls.push('close'); }};
  const ctx = {dialog: () => dialog, notify: text => notifications.push(text), api: {
    pocketContactProfile: async () => profile,
    pocketOpenContactState: async (name, revision) => { calls.push({name, revision}); },
    pocketSaveContactProfile: async () => { throw Error('legacy writer must not be used'); }, ...overrides,
  }};
  return {ctx, dialog, calls, notifications};
}

test('CSB editor opens native plugin by current revision without creating legacy snapshot', async () => {
  const f = editorFixture(record([], {}));
  await openContactStatusEditor(f.ctx, '林澈');
  assert.deepEqual(f.calls, [{name: '林澈', revision: 'rev-1'}, 'close']);
  assert.equal(f.dialog.live, false);
  assert.match(f.notifications[0], /角色信息/);
});

test('missing CSB editor and ambiguous names fail explicitly instead of falling back to legacy writes', async () => {
  for (const [profile, overrides, expected] of [
    [record([], {}), {pocketOpenContactState: undefined}, /確認角色信息插件/],
    [record([], {}, {editable: false}), {}, /確認角色信息插件/],
    [{name: '同名', csbAmbiguous: true}, {}, /多位角色/],
  ]) {
    const f = editorFixture(profile, overrides);
    await openContactStatusEditor(f.ctx, profile.name);
    assert.match(f.dialog.body.innerHTML, expected);
    assert.equal(f.dialog.live, true);
    assert.deepEqual(f.calls, []);
  }
  assert.match(contactDetailsHTML({csbAmbiguous: true}), /無法確認對應角色/);
});

test('CSB native editor errors leave a visible error and no false success notification', async () => {
  const f = editorFixture(record([], {}), {pocketOpenContactState: async () => { throw Error('角色狀態已變動'); }});
  await openContactStatusEditor(f.ctx, '林澈');
  assert.match(f.dialog.body.innerHTML, /角色狀態已變動/);
  assert.equal(f.dialog.live, true);
  assert.deepEqual(f.notifications, []);
});
