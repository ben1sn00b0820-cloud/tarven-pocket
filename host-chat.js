// Phone chat, tavern side. Replies are generated separately from the story with the tavern's connected model
// (generateRaw): the prompt carries the chat preset, each contact's persona or character card, the user's persona,
// recent story messages and the chat history. Nothing is written into the story unless the user brings a chat
// into it; that text is injected once, into the next story reply.
import {buildChatRequest, parseChatReply, bringText, plainStory, activeChatPreset, messageLine, cleanTagged} from './core/chat.js';
import {worldInfoFor, loreOptions} from './host-lore.js';

export function createChatHost({context, settings, backend, notice, onCall = () => {}}) {
  const busy = new Map();
  let pending = null;

  const userName = () => context()?.name1 || '我';
  const userPersona = () => String(context()?.powerUserSettings?.persona_description || '').slice(0, 1500);

  /** Character card text for a contact that is also a tavern character. */
  function card(name) {
    const c = context()?.characters?.find(ch => ch?.name === name);
    if (!c) return '';
    return [c.description, c.personality && '性格：' + c.personality].filter(Boolean).join('\n')
      .replaceAll('{{char}}', name).replaceAll('{{user}}', userName()).slice(0, 2000);
  }
  function story(limit) {
    const chat = context()?.chat || [], out = [];
    for (let i = chat.length - 1; i >= 0 && out.length < limit; i--) {
      const m = chat[i];
      if (!m || m.is_system) continue;
      const text = plainStory(m.mes);
      if (text) out.unshift({name: m.name || (m.is_user ? userName() : '旁白'), text: text.slice(0, 600)});
    }
    return out;
  }
  function members(thread) {
    const s = settings(), contacts = backend.contacts();
    return thread.members.map(name => {
      const c = contacts.find(x => x.name === name);
      return {name, persona: c?.persona || '', card: c?.persona ? '' : card(name), voice: !!c?.voice, language: c?.language || s.general.defaultLanguage};
    });
  }

  /** Asks the model for the contact's next messages and stores them. One request per chat at a time. */
  function reply(threadId) {
    if (busy.has(threadId)) return busy.get(threadId);
    const job = (async () => {
      const ctx = context();
      await backend.resumeWalletClaims(threadId);
      const thread = await backend.chats.get(threadId);
      if (!thread) throw Error('这段聊天已不存在');
      const s = settings(), preset = activeChatPreset(s.chat), people = members(thread), voiceFormat = backend.voiceFormat(), user = userName();
      // Voice switched off: nobody sends voice messages.
      if (s.general.voiceEnabled === false) for (const p of people) p.voice = false;
      backend.emit('chat', {threadId, typing: true});
      const recent = story(preset.context);
      // 世界书: scanned over who is in the chat, the recent story and the chat itself, as the story's own request would be.
      const lore = preset.lore === false ? '' : await worldInfoFor(context, {...loreOptions(preset), persona: userPersona(), characters: people.map(p => p.persona || p.card).join('\n'),
        texts: [people.map(p => p.name).join('、'), ...recent.map(r => `${r.name}: ${r.text}`), ...thread.messages.slice(-preset.history).map(m => messageLine(m, user))]});
      const prompt = buildChatRequest({preset, thread, members: people, story: recent, user, userPersona: userPersona(), voiceFormat, lore});
      const text = cleanTagged(await backend.generateText(ctx, {prompt, trimNames: false, pocketNames:people.map(p=>p.name)}), preset.cleanTags);
      const items = parseChatReply(text, {members: people, user, voiceFormat, voiceNames: people.filter(p => p.voice).map(p => p.name)});
      if (!items.length) throw Error('这次没有收到消息，可以再试一次');
      return backend.chatMutate(threadId, () => settle(threadId, items));
    })().finally(() => { busy.delete(threadId); backend.emit('chat', {threadId, typing: false}); });
    busy.set(threadId, job);
    return job;
  }

  /**
   * Stores a reply. A claim takes (or returns) the user's latest red packet or transfer that is still waiting,
   * and leaves a notice where it happened.
   */
  async function settle(threadId, items) {
    const thread = await backend.chats.get(threadId), taken = new Set(), out = [], posts = [];
    let calling = null;
    let latest = thread;
    for (const item of items) {
      // 「[朋友圈] …」: posted to 朋友圈 while chatting, not a chat message.
      if (item.kind === 'moment') { posts.push({author: item.from, text: item.text, source: 'chat'}); continue; }
      // 「[打电话] …」: the contact calls right after this reply (private chats only; one call).
      if (item.kind === 'call') { if (thread.type === 'dm' && !calling) calling = item; continue; }
      if (item.kind !== 'claim') { out.push(item); continue; }
      const kinds = item.what ? [item.what] : item.action === 'return' ? ['transfer'] : ['redpacket', 'transfer', 'gift'];
      const target = thread.messages.findLast(m => m.from === 'me' && kinds.includes(m.kind) && m.state === 'sent' && !taken.has(m.id));
      if (!target) continue;
      taken.add(target.id);
      latest = await backend.settleSent(threadId, target.id, item.from, item.action);
    }
    if (posts.length) await backend.momentsMutate(() => backend.moments.add(posts)).catch(() => {});
    const saved = out.length ? await backend.chats.append(threadId, out) : latest;
    if (calling) setTimeout(() => onCall(calling.from, calling.reason), 1200);
    return saved;
  }

  /** Prepares chat messages to be carried into the next story reply. */
  async function bring(threadId, ids) {
    const thread = await backend.chats.get(threadId);
    if (!thread) throw Error('这段聊天已不存在');
    const chosen = thread.messages.filter(m => ids.includes(m.id) && m.kind !== 'system');
    if (!chosen.length) throw Error('请先选择要带进剧情的消息');
    const preset = activeChatPreset(settings().chat);
    pending = {threadId, name: thread.name, count: chosen.length, text: bringText(preset, {thread, messages: chosen, user: userName()})};
    await backend.chatMutate(threadId, () => backend.chats.append(threadId, [{from: 'me', kind: 'system', text: `${chosen.length} 条消息会带进下一次正文`}], {read: true}));
    return {...pending};
  }

  /**
   * Prompt entries for inject(). A real story reply (not a dry run, a quiet request or an impersonation) uses the pending
   * chat once; the entry stays until the next inject() clears the sttts.entry.* keys.
   */
  function bringPlan(type, dryRun) {
    if (!pending) return [];
    const i = activeChatPreset(settings().chat).injection, inChat = i.position === 'in_chat';
    const entry = {key: 'sttts.entry.bring', text: pending.text, position: {in_chat: 1, in_prompt: 0, before_prompt: 2}[i.position], depth: inChat ? i.depth : 0, role: inChat ? {system: 0, user: 1, assistant: 2}[i.role] : 0};
    if (type && !['quiet', 'impersonate'].includes(type) && !dryRun) {
      const used = pending;
      pending = null;
      notice(`和${used.name}的聊天已带进这次正文`);
      backend.emit('chat', {threadId: used.threadId, bring: false});
    }
    return [entry];
  }

  return {
    reply, bring, bringPlan,
    typing: threadId => busy.has(threadId),
    pendingBring: () => pending && {threadId: pending.threadId, name: pending.name, count: pending.count},
    cancelBring: () => { const threadId = pending?.threadId; pending = null; if (threadId) backend.emit('chat', {threadId, bring: false}); }
  };
}
