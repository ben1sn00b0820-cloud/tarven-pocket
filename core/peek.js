// 查手机: a look into a character's own phone — their chats with other people, what they searched for, their notes and
// the photos in their album — made up by the model from who they are and what has happened. No DOM or network here: the
// prompt, the parser and the checks on what is stored. One snapshot per character; looking again makes a new one.
//
// The model answers in sections, one item per line:
//   【聊天】对象                    a chat with someone; the lines under it are 「名字：内容」
//   【搜索】搜索的内容               one search
//   【备忘录】标题｜内容             one note
//   【相册】照片里拍了什么｜english tags   one photo, described (the tags only when pictures can be drawn)
import {messageLine} from './chat.js';

export const PEEK_LIMITS = Object.freeze({chats: 5, lines: 24, searches: 12, notes: 5, photos: 9, text: 600});

const fill = (template, values) => String(template).replace(/\{\{(.+?)\}\}/g, (m, key) => values[key.trim()] ?? m);
const clip = (value, max) => String(value ?? '').slice(0, max);
const short = value => clip(value, 30).replace(/[|｜【】]/g, '').trim();

/**
 * The request: the preset's rules used in 查手机, the character, the world, the user, the story and the real phone chat
 * between the character and the user (their phone has that chat too, so the other chats may mention the user).
 */
export function buildPeekRequest({preset, person, story = [], user = '我', userPersona = '', history = [], lore = '', images = false}) {
  const name = person.name;
  const rules = preset.entries.filter(e => e.enabled && e.text.trim() && (e.use || []).includes('peek')).map(e => fill(e.text, {'用户': user, '对象': name}));
  const system = [
    rules.join('\n\n'),
    `【手机的主人】\n- ${name}：${(person.persona || person.card || '').trim() || '（没有资料，按剧情里的表现来）'}`,
    lore.trim() ? `【世界书】（这些人物和这个世界的设定：人设、口音、方言、说话方式都按这里来）\n${lore.trim()}` : '',
    userPersona.trim() ? `【${user}】\n${userPersona.trim()}` : '',
    story.length ? `【最近的剧情】（只作背景参考）\n${story.map(s => `${s.name}：${s.text}`).join('\n')}` : '',
    history.length ? `【${name}和${user}在手机上的聊天】（这是真的，${name}的手机里也有；不用再写这一段）\n${history.map(m => messageLine(m, user)).filter(Boolean).join('\n')}` : '',
    ['【输出格式】',
      '分成下面几块，每一项单独一行，只能用这几种写法，不要写别的文字、编号或解释：',
      `「【聊天】对象」开始一段${name}和某人的聊天（2 到 4 段，对象是朋友、家人、同事或别的角色，不要写和${user}的），下面每行写「名字：内容」，名字只用${name}或这个对象；`,
      '「【搜索】搜索的内容」最近的搜索记录，5 到 10 条；',
      '「【备忘录】标题｜内容」备忘录，1 到 3 条；',
      images ? '「【相册】照片里拍了什么｜英文 danbooru tag」相册里最近的照片：先用一句中文描述画面，竖线后面写画这张图用的英文 tag，3 到 6 张。'
        : '「【相册】照片里拍了什么」相册里最近的照片，用一句话描述画面，3 到 6 张。'].join('\n')
  ].filter(Boolean).join('\n\n');
  return [{role: 'system', content: system}, {role: 'user', content: `${user}拿到了${name}的手机。写出${name}手机里现在有的东西。`}];
}

const LINE = /^\s*(?:[-*•]\s*)?[【\[]\s*(聊天|搜索|搜索记录|备忘录|备忘|相册|照片)\s*[】\]]\s*(.*)$/;
const SAID = /^([^:：\n]{1,30}?)\s*[:：]\s*(.+)$/;
const clean = s => String(s).replace(/<[^>]+>/g, '').trim().replace(/^[「“"](.*)[」”"]$/s, '$1').trim();

/** The model's answer as {chats: [{with, lines: [{from, text}]}], searches, notes: [{title, text}], photos: [{text, tags}]}. */
export function parsePeek(reply, {name, user = '我'} = {}) {
  const body = String(reply || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/```[a-z]*\n?|```/g, '');
  const out = {chats: [], searches: [], notes: [], photos: []};
  let chat = null;
  for (const raw of body.split(/\r?\n/)) {
    const m = raw.match(LINE);
    if (!m) {
      // Lines of the chat being written.
      const s = chat && raw.trim().match(SAID);
      if (s && chat.lines.length < PEEK_LIMITS.lines) { const from = short(s[1]), text = clean(s[2]).slice(0, PEEK_LIMITS.text); if (from && text) chat.lines.push({from: from === user ? 'me' : from, text}); }
      continue;
    }
    const [, kind, rest] = m, value = clean(rest);
    chat = null;
    if (kind === '聊天') {
      const other = short(value);
      if (other && other !== name && out.chats.length < PEEK_LIMITS.chats) { chat = {with: other, lines: []}; out.chats.push(chat); }
    } else if (kind.startsWith('搜索')) {
      if (value && out.searches.length < PEEK_LIMITS.searches) out.searches.push(value.slice(0, 100));
    } else if (kind.startsWith('备忘')) {
      const [title, ...text] = value.split(/[|｜]/);
      const note = text.length ? {title: clean(title).slice(0, 40), text: clean(text.join('｜')).slice(0, PEEK_LIMITS.text)} : {title: '', text: value.slice(0, PEEK_LIMITS.text)};
      if (note.text && out.notes.length < PEEK_LIMITS.notes) out.notes.push(note);
    } else if (value && out.photos.length < PEEK_LIMITS.photos) {
      const [text, ...rest] = value.split(/[|｜]/);
      const tags = rest.join(',').replace(/[一-鿿]+/g, ' ').split(/[,，]/).map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean).join(', ').slice(0, 600);
      if (clean(text)) out.photos.push({text: clean(text).slice(0, 200), tags});
    }
  }
  out.chats = out.chats.filter(c => c.lines.length);
  return out;
}

/** The id of a person's snapshot: one per person (per card, with 分区 on). */
export const peekId = (name, space = '') => 'peek:' + (space ? space + ':' : '') + name;
/** A snapshot as it is stored: {id, kind: 'peek', name, at, chats, searches, notes, photos, space?}. */
export function cleanPeek(p, at) {
  const name = short(p?.name);
  if (!name) throw Error('不知道是誰的手機');
  const chats = (Array.isArray(p.chats) ? p.chats : []).slice(0, PEEK_LIMITS.chats).map(c => ({with: short(c?.with),
    lines: (Array.isArray(c?.lines) ? c.lines : []).slice(0, PEEK_LIMITS.lines).map(l => ({from: short(l?.from), text: clip(l?.text, PEEK_LIMITS.text).trim()})).filter(l => l.from && l.text)})).filter(c => c.with && c.lines.length);
  const list = (value, max, size) => (Array.isArray(value) ? value : []).map(x => clip(x, size).trim()).filter(Boolean).slice(0, max);
  const notes = (Array.isArray(p.notes) ? p.notes : []).slice(0, PEEK_LIMITS.notes).map(n => ({title: clip(n?.title, 40).trim(), text: clip(n?.text, PEEK_LIMITS.text).trim()})).filter(n => n.text);
  // A photo: its description, and (when it can be drawn) its tags, the drawn picture and how drawing went.
  const photos = (Array.isArray(p.photos) ? p.photos : []).slice(0, PEEK_LIMITS.photos).map(x => typeof x === 'string' ? {text: x} : x || {}).map(x => {
    const photo = {text: clip(x.text, 200).trim(), tags: clip(x.tags, 600).trim()};
    if (x.photoId) photo.photoId = clip(x.photoId, 512);
    if (['waiting', 'done', 'failed'].includes(x.state)) photo.state = x.state;
    if (x.note) photo.note = clip(x.note, 200);
    return photo;
  }).filter(x => x.text);
  const space = clip(p.space, 300);
  const out = {id: peekId(name, space), kind: 'peek', name, at, chats, searches: list(p.searches, PEEK_LIMITS.searches, 100), notes, photos, ...(space ? {space} : {})};
  if (!chats.length && !out.searches.length && !notes.length && !out.photos.length) throw Error(`沒看到${name}手機裡的東西，可以再試一次`);
  return out;
}
