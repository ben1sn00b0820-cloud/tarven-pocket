import test from 'node:test';
import assert from 'node:assert/strict';
import {storyClockView} from '../ui/phone.js';
import {APPS, HOME} from '../ui/apps.js';

test('story clock never substitutes the real date or time when the story is unknown', () => {
  for (const value of [undefined, {}, {known: false, date: '忽略舊日期', time: '12:00'}]) {
    assert.deepEqual(storyClockView(value), {date: '劇情時間未設定', time: '—', label: '劇情時間未設定'});
  }
});

test('story clock preserves fantasy dates and named hours without date parsing', () => {
  assert.deepEqual(storyClockView({known: true, date: '景和三年・霜月初三', time: '子時'}), {
    date: '景和三年・霜月初三', time: '子時', label: '景和三年・霜月初三 · 子時'
  });
  assert.deepEqual(storyClockView({known: true, time: '次日清晨'}), {
    date: '劇情日期未設定', time: '次日清晨', label: '次日清晨'
  });
  assert.deepEqual(storyClockView({known: true, date: '春日', label: '故事開端'}), {
    date: '春日', time: '—', label: '故事開端'
  });
});

test('home exposes the character library and retains text/image apps without audio apps', () => {
  assert.equal(APPS.roles.name, '角色庫');
  for (const id of ['listen', 'library']) assert.equal(APPS[id], undefined);
  const visible = [...HOME.pages.flat(), ...HOME.dock].filter(Boolean);
  for (const id of visible) assert.ok(APPS[id], id);
  for (const id of ['roles', 'characterinfo', 'chat', 'draw', 'engines', 'presets', 'instagram', 'diary']) assert.ok(visible.includes(id), id);
  assert.ok(!visible.includes('listen'));
  assert.ok(!visible.includes('library'));
});
