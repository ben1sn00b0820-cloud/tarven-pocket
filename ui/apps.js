// App registry. Adding an app: add an entry here, register its factory in phone.js,
// and place its id on the home screen below (a reserved slot is replaced by the id).
//   colors: [tile top, tile bottom / glyph shade, glyph accent]
export const APPS = {
  characterinfo: {name: '角色信息', eyebrow: '人物卷宗', colors: ['#dce8d4', '#6d917d', '#ead9a5']},
  me: {name: '吾身錄', eyebrow: 'Personal', colors: ['#c9decb', '#6e9b80', '#fff0be']},
  roles: {name: '聲律譜', eyebrow: 'Character', colors: ['#9ad8ff', '#4a9af0', '#ff9dbb']},
  engines: {name: '靈樞', eyebrow: 'Wallet', colors: ['#cdb6ff', '#8a6cf2', '#fff09a']},
  presets: {name: '法式集', eyebrow: 'Preset', colors: ['#ffe39c', '#ffac3f', '#ff7f86']},
  library: {name: '留聲閣', eyebrow: 'Voice Library', colors: ['#ffb6cc', '#ee6690', '#fff0a0']},
  gallery: {name: '留影閣', eyebrow: 'Album', colors: ['#ffcfb0', '#ff8d69', '#8fd1ff']},
  notes: {name: '隨行箋', eyebrow: 'Memo', colors: ['#fff4b3', '#f6c53c', '#ff9d5c']},
  listen: {name: '聽風閣', eyebrow: 'Now Playing', colors: ['#ffa3c3', '#e9588e', '#fff09a']},
  settings: {name: '玉符設定', eyebrow: 'Settings', colors: ['#e4e8f0', '#98a2b6', '#ffd36a']},
  draw: {name: '丹青閣', eyebrow: 'NovelAI', colors: ['#c3c3ff', '#6d6ff0', '#ffd46a']},
  chat: {name: '千里傳音', eyebrow: 'WeChat', colors: ['#a9edab', '#31b85e', '#fff6b5']},
  forum: {name: '論道臺', eyebrow: 'Forum', colors: ['#b8f0d0', '#38b07a', '#ffd36a']},
  peek: {name: '觀心鏡', eyebrow: 'Peek', colors: ['#ffc6e0', '#c85a9a', '#9fe0ff']},
  instagram: {name: '浮光錄', eyebrow: 'Social', colors: ['#ffbe91', '#d7448d', '#ffe89b']},
  diary: {name: '修行札記', eyebrow: 'Diary', colors: ['#f4d4b7', '#b37d61', '#fff3cf']},
  storyshop: {name: '萬寶閣', eyebrow: 'Wanbao Shop', colors: ['#c5b3ff', '#8260d1', '#ffe8a3']},
  pocketsettings: {name: '玉符接入', eyebrow: 'Integration', colors: ['#b8e8ed', '#398da6', '#fff0ac']}
};

export const SLOT = null;

// Home screen: page 1 sits under the clock and widgets; later pages hold apps to come. Reserved places (SLOT) are not
// shown, and a page with only reserved places is left out.
export const HOME = {
  pages: [
    ['characterinfo', 'me', 'instagram', 'diary', 'storyshop', 'pocketsettings', 'roles', 'engines'],
    ['presets', 'gallery', 'library', 'notes', 'forum', 'peek', SLOT, SLOT]
  ],
  dock: ['chat', 'draw', 'listen', 'settings']
};

export const appName = id => APPS[id]?.name || id;
