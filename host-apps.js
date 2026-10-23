// 论坛 and 查手机, tavern side. Like 朋友圈, they are generated apart from the story with the tavern's connected model (or
// the phone's own text model) and nothing is written into the story. One model request per app at a time.
import {buildForumRequest, parseForum} from './core/forum.js';
import {buildPeekRequest, parsePeek, peekId} from './core/peek.js';
import {storyLines} from './core/moments.js';
import {inSpace, activeChatPreset, cleanTagged} from './core/chat.js';
import {worldInfoFor, loreOptions} from './host-lore.js';
import {pictureInputs} from './core/draw.js';

const PEOPLE = 12;

export function createAppsHost({context, settings, backend}) {
  const busy = {forum: null, peek: null};
  const userName = () => context()?.name1 || '我';
  const userPersona = () => String(context()?.powerUserSettings?.persona_description || '').slice(0, 1500);
  function card(name) {
    const c = context()?.characters?.find(ch => ch?.name === name);
    if (!c) return '';
    return [c.description, c.personality && '性格：' + c.personality].filter(Boolean).join('\n')
      .replaceAll('{{char}}', name).replaceAll('{{user}}', userName()).slice(0, 1500);
  }
  const people = () => backend.contacts().slice(0, PEOPLE).map(c => ({name: c.name, persona: c.persona, card: c.persona ? '' : card(c.name)}));
  const lore = (preset, crowd, story, texts) => preset.lore === false ? Promise.resolve('') : worldInfoFor(context, {...loreOptions(preset), persona: userPersona(), characters: crowd.map(p => p.persona || p.card).join('\n'),
    texts: [crowd.map(p => p.name).join('、'), ...story.map(r => `${r.name}: ${r.text}`), ...texts]});
  async function ask(ctx, prompt, preset) {
    return cleanTagged(String(await backend.generateText(ctx, {prompt, trimNames: false}) || ''), preset.cleanTags);
  }
  /** One request per app at a time; the phone shows it as busy. */
  function run(app, task) {
    if (busy[app]) return busy[app];
    busy[app] = (async () => { backend.emit(app, {busy: true}); return task(context()); })().finally(() => { busy[app] = null; backend.emit(app, {busy: false}); });
    return busy[app];
  }
  const base = () => {
    const s = settings(), preset = activeChatPreset(s.chat);
    return {s, preset, crowd: people(), user: userName()};
  };

  // ---------- 论坛 ----------
  /** New posts and the 热搜. */
  function forumRefresh() {
    return run('forum', async ctx => {
      const {preset, crowd, user} = base();
      const recent = (await backend.apps.list('forum')).filter(p => inSpace(p, backend.here())).slice(0, 8), hot = (await backend.apps.get(backend.hotId()))?.topics || [];
      const story = storyLines(ctx.chat, preset.context, user);
      const prompt = buildForumRequest({preset, mode: 'posts', people: crowd, story, user, userPersona: userPersona(), recent, hot, lore: await lore(preset, crowd, story, [...hot, ...recent.map(p => p.title)])});
      const found = parseForum(await ask(ctx, prompt, preset), {user, mode: 'posts'});
      if (!found.posts.length) throw Error('这次没有刷出新帖子，可以再刷新一次');
      if (found.hot.length) await backend.setForumHot(found.hot);
      return backend.addForumPosts(found.posts);
    });
  }
  /** Replies to the user's new post. */
  function forumReact(postId) {
    return run('forum', async ctx => {
      const {preset, crowd, user} = base();
      const post = await backend.apps.get(postId);
      if (!post) throw Error('这个帖子已经不在了');
      const story = storyLines(ctx.chat, preset.context, user);
      const prompt = buildForumRequest({preset, mode: 'react', people: crowd, story, user, userPersona: userPersona(), post, lore: await lore(preset, crowd, story, [post.title, post.text])});
      const found = parseForum(await ask(ctx, prompt, preset), {user, mode: 'react'});
      if (!found.replies.length) throw Error('这次没有人回复，可以再试一次');
      return backend.addForumReplies(postId, found.replies);
    });
  }
  /** Answers to the user's reply. */
  function forumReply(postId, replyId) {
    return run('forum', async ctx => {
      const {preset, crowd, user} = base();
      const post = await backend.apps.get(postId), mine = post?.replies.find(r => r.id === replyId);
      if (!post || !mine) throw Error('这条回复已经不在了');
      const story = storyLines(ctx.chat, preset.context, user);
      const prompt = buildForumRequest({preset, mode: 'reply', people: crowd, story, user, userPersona: userPersona(), post, reply: mine, lore: await lore(preset, crowd, story, [post.title, mine.text])});
      const found = parseForum(await ask(ctx, prompt, preset), {user, mode: 'reply'});
      if (!found.replies.length) throw Error('这次没有人接话，可以再试一次');
      return backend.addForumReplies(postId, found.replies);
    });
  }

  // ---------- 查手机 ----------
  /** Looks into a character's phone (a new snapshot each time). */
  function peekLook(name) {
    return run('peek', async ctx => {
      const {preset, user} = base(), contact = backend.contacts().find(c => c.name === name);
      if (!contact) throw Error(`联系人里没有「${name}」`);
      const person = {name, persona: contact.persona, card: contact.persona ? '' : card(name)};
      const thread = (await backend.threads()).find(t => t.type === 'dm' && t.members[0] === name);
      const history = thread ? (await backend.chats.get(thread.id)).messages.filter(m => m.kind !== 'system').slice(-20) : [];
      const story = storyLines(ctx.chat, preset.context, user);
      const prompt = buildPeekRequest({preset, person, story, user, userPersona: userPersona(), history, images: !!backend.drawReady(), lore: await lore(preset, [person], story, history.map(m => m.text || ''))});
      const found = parsePeek(await ask(ctx, prompt, preset), {name, user});
      return backend.savePeek({name, ...found});
    });
  }

  /** Draws one photo of a character's album with NovelAI. Without allowPaid, only when the free tier covers it. */
  async function peekDraw(name, index, {allowPaid = false} = {}) {
    // The open card's snapshot of this person, else the shared one from before 分区.
    const key = backend.spaceKey(), snap = (await backend.apps.get(peekId(name, key))) || (key ? await backend.apps.get(peekId(name)) : null), id = snap?.id, photo = snap?.photos?.[index];
    if (!photo) throw Error('这张照片已经不在了');
    if (!photo.tags) throw Error('这张照片没有画图用的描述，「再看一次」后就有了');
    if (!backend.drawReady()) throw Error(backend.drawMissing() + '，相册只能看文字');
    const set = patch => backend.appsMutate('peek', () => backend.apps.change(id, doc => { Object.assign(doc.photos[index], patch); for (const k of Object.keys(patch)) if (patch[k] === '') delete doc.photos[index][k]; }));
    // The owner's saved look only when the picture shows a person (a selfie), not for a view or a meal.
    const person = /(\d+(?:girl|boy|other)s?|solo|selfie|portrait|upper body|cowboy shot)/i.test(photo.tags);
    try {
      await set({state: 'waiting', note: ''});
      const input = pictureInputs(settings(), {prompt: photo.tags, characters: person ? [name] : []}, '');
      const result = await backend.generateImage({...input, allowPaid, name: `查手机-${name}`, key: `peek:${name}:${index}`, label: `查手机 · ${name}`});
      await set({photoId: result.photoId, state: 'done', note: ''});
      return result.photoId;
    } catch (error) {
      await set({state: 'failed', note: error.code === 'PAID' ? backend.paidPrompt().note : error.message.slice(0, 200)});
      throw error;
    }
  }

  return {forumRefresh, forumReact, forumReply, peekLook, peekDraw, busy: app => !!busy[app]};
}
