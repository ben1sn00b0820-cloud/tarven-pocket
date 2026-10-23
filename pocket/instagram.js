/** A disposable projection of this chat's social events. No global character-library lookup. */
import {safePhotoUrl} from '../core/photo-url.js';

const DAY = 24 * 60 * 60 * 1000;
const list = value => Array.isArray(value) ? value : [];
const text = (value, max = 4000) => typeof value === 'string' ? value.slice(0, max) : '';
const time = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;

export function projectInstagram(events, {userName = '我', characterName = '', profiles = [], contacts = [], now = Date.now()} = {}) {
  const nameOf = value => {
    const name = text(value, 80).trim();
    if (/[\u0000-\u001f]/.test(name)) return ''; 
    return ['me', '{{user}}', '我'].includes(name) ? userName : name === '{{char}}' ? characterName : name;
  };
  const accounts = new Map(), byPost = new Map(), byStory = new Map(), seen = new Set();
  const discover = (value, profile = null) => {
    const name = nameOf(typeof value === 'string' ? value : value?.name);
    if (!name || /[\u0000-\u001f]/.test(name)) return;
    if (!accounts.has(name)) accounts.set(name, {name, isUser: name === userName, username: name, bio: '', postCount: 0, storyCount: 0, activeStories: 0});
    const account = accounts.get(name), fields = profile?.fields || profile?.card || {};
    if (fields.identity) account.bio = text(fields.identity, 180);
    return account;
  };
  discover(userName); discover(characterName);
  for (const profile of list(profiles)) discover(profile, profile);
  for (const contact of list(contacts)) discover(contact);
  // Deduplication belongs here too: source refreshes must never multiply posts or likes.
  const scoped = list(events).filter(event => {
    if (!event || typeof event !== 'object' || typeof event.id !== 'string' || !event.id || seen.has(event.id)) return false;
    seen.add(event.id); return true;
  }).map((event, index) => ({...event, from: nameOf(event.from), to: nameOf(event.to), at: time(event.at), _index: index}));
  const social = scoped.filter(event => event.app === 'instagram').sort((a, b) => a.at - b.at || a._index - b._index);
  for (const event of scoped) {
    // Only names already present in this conversation's events can add accounts.
    discover(event.from); if (event.to) discover(event.to);
    for (const member of list(event.members)) discover(member);
  }
  const posts = [], dms = [], stories = [];
  const media = event => ({image: safePhotoUrl(event.image) || '', photoId: text(event.photoId, 100), imagePrompt: text(event.imagePrompt, 4000)});
  for (const event of social) {
    if (!event.from) continue;
    const item = {id: event.id, from: event.from, text: text(event.text), at: event.at, ...media(event)};
    if (event.action === 'post') {
      const post = {...item, likes: [], comments: []};
      posts.push(post); byPost.set(post.id, post); discover(post.from).postCount++;
    } else if (event.action === 'story') {
      // Archive rather than remove old stories. Missing legacy timestamps are never renewed on refresh.
      const expiresAt = item.at + DAY, story = {...item, expiresAt, expired: Number(now) >= expiresAt, replies: []};
      stories.push(story); byStory.set(story.id, story);
      const account = discover(story.from); account.storyCount++; if (!story.expired) account.activeStories++;
    } else if (['dm', 'message'].includes(event.action) && event.to) {
      dms.push({...item, to: event.to, storyId: text(event.storyId, 128)});
    }
  }
  for (const event of social) {
    const post = byPost.get(event.postId || event.ref || event.target);
    if (post && event.from && event.action === 'like') {
      const i = post.likes.indexOf(event.from);
      if (event.liked === false) { if (i >= 0) post.likes.splice(i, 1); }
      else if (i < 0) post.likes.push(event.from);
    } else if (post && event.from && event.action === 'comment') {
      post.comments.push({id: event.id, from: event.from, text: text(event.text, 2000), at: event.at});
    }
  }
  for (const dm of dms) {
    const story = byStory.get(dm.storyId);
    if (story && (dm.to === story.from || dm.from === story.from)) story.replies.push({...dm});
  }
  return {posts: posts.reverse(), dms, stories: stories.reverse(), accounts: [...accounts.values()]};
}
