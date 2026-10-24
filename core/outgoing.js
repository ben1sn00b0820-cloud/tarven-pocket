// What the story model is sent: the tavern's chat keeps every tag (waves and pictures are drawn from them),
// but the copies handed to the model can leave the tags out, so users need no regex of their own.
import {cleanNarrativeText} from './narrative-text.js';
import {withoutPictures} from './draw.js';

/** A reply with each voiced line turned back into its translation: “你好”<tts>A|calm|Hello</tts> → “你好”. */
export function withoutVoice(message, formats = []) {
  return cleanNarrativeText(message, formats);
}

/**
 * The chat for one story request, changed in place by replacing messages (never mutating them).
 * pictures: drop picture blocks. voice: drop voice tags; keepLatest leaves the newest reply that has voice lines
 * as it is, so the model still sees one example of the format.
 */
export function outgoingChat(chat, {pictures = true, voice = true, keepLatest = false, formats = []} = {}) {
  if (!Array.isArray(chat) || (!pictures && !voice)) return chat;
  const voiced = m => !m?.is_user && typeof m?.mes === 'string' && withoutVoice(m.mes, formats) !== m.mes;
  let keep = -1;
  if (voice && keepLatest) for (let i = chat.length - 1; i >= 0; i--) if (voiced(chat[i])) { keep = i; break; }
  for (let i = 0; i < chat.length; i++) {
    const m = chat[i];
    if (typeof m?.mes !== 'string') continue;
    let mes = m.mes;
    if (pictures && /<img\b/i.test(mes)) mes = withoutPictures(mes);
    if (voice && i !== keep) mes = withoutVoice(mes, formats);
    if (mes !== m.mes) chat[i] = {...m, mes};
  }
  return chat;
}
