import {readCharacterState} from './csb-state.js';
import {sourceScope} from './source-sync.js';

export const STORY_TIME_KEY = 'tavern_pocket_story_time_v1';
const messageCache = new WeakMap();
const UNKNOWN = /^(?:未知|未設定|未设定|尚未設定|unknown|n\/a|[?？—–-]+)$/i;
const text = (value, max = 200) => typeof value === 'string' && value.trim().length <= max && !UNKNOWN.test(value.trim()) ? value.trim() : '';
const empty = () => ({date: '', time: '', label: '劇情時間未設定', source: 'unknown', known: false});
const join = (date, time) => [date, time].filter(Boolean).join(' · ');

/** Preserve the story's calendar and wording. Never derive a date from the device. */
export function splitStoryTime(value) {
  const label = text(value);
  if (!label) return {date: '', time: '', label: ''};
  const clock = label.match(/^(.*?)(?:[\s·｜|，,]+|^)((?:[01]?\d|2[0-3])[:：][0-5]\d(?:[:：][0-5]\d)?)$/u);
  if (clock) return {date: clock[1].trim(), time: clock[2].replaceAll('：', ':'), label};
  const period = label.match(/^(.*?)([子丑寅卯辰巳午未申酉戌亥]時(?:初|正|末|[一二三四五六七八九十半]+刻)?|凌晨|清晨|拂曉|拂晓|早晨|上午|中午|正午|下午|午後|午后|黃昏|黄昏|傍晚|晚上|夜間|夜间|夜晚|深夜|午夜|夜半|黎明)$/u);
  if (period) return {date: period[1].trim().replace(/[\s·｜|，,]+$/u, ''), time: period[2], label};
  if (/(?:年|月|日|第.{1,12}天|節|节)$/u.test(label)) return {date: label, time: '', label};
  return {date: '', time: label, label};
}

function clockValue(value, source) {
  const date = text(value?.date, 120), time = text(value?.time, 120);
  const label = text(value?.label) || join(date, time);
  if (!date && !time && !label) return empty();
  const split = !date && !time ? splitStoryTime(label) : {date, time};
  return {...split, label, source, known: true};
}

/** A marker in a fenced example, block quote, or hidden reasoning is not the scene. */
function visibleSource(raw) {
  let value = raw.replace(/<(think|thinking|analysis|reasoning|script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, match => match.replace(/[^\n]/g, ' '));
  let fence = null;
  value = value.split('\n').map(line => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = {char: marker[1][0], size: marker[1].length};
      else if (marker[1][0] === fence.char && marker[1].length >= fence.size) fence = null;
      return ' '.repeat(line.length);
    }
    return fence || /^\s*>/.test(line) ? ' '.repeat(line.length) : line;
  }).join('\n');
  return value;
}

function messageTime(message) {
  if (!message || typeof message !== 'object' || message.is_system || message.role === 'system' || message.extra?.tavern_pocket_activity || message.extra?.tavern_pocket_status) return null;
  const raw = String(message.mes ?? ''), old = messageCache.get(message);
  if (old?.raw === raw) return old.result;
  const source = visibleSource(raw);
  let csb = null, narrative = null;
  // CSB is the established protocol. Its snapshot remains the source of truth;
  // this position is only used to compare a later explicit narrative marker.
  for (const match of source.matchAll(/<CSB_UPDATE>([\s\S]*?)<\/CSB_UPDATE>/g)) {
    try {
      const payload = JSON.parse(match[1]), time = text(payload?.scene?.time);
      if (payload?.version === 1 && time) csb = {text: time, offset: match.index};
    } catch {}
  }
  // Read only complete, anchored labels. Ordinary dialogue mentioning a date
  // or a plan for tomorrow cannot move the current scene's clock.
  const plain = source.replace(/<CSB_UPDATE>[\s\S]*?<\/CSB_UPDATE>/g, match => match.replace(/[^\n]/g, ' '));
  let date = '', time = '', offset = 0;
  for (const line of plain.split('\n')) {
    const match = line.match(/^\s*(?:【|\[)?\s*(?:\*\*)?(劇情日期|剧情日期|劇情時間|剧情时间|場景時間|场景时间)(?:\*\*)?\s*[:：]\s*(.*?)\s*(?:】|\])?\s*$/u);
    if (match) {
      const value = text(match[2]);
      if (value && !/[<>「」“”]/u.test(value)) {
        if (/日期/.test(match[1])) date = value;
        else {
          const parsed = splitStoryTime(value);
          if (parsed.date) date = parsed.date;
          time = parsed.time;
        }
        narrative = {date, time, label: join(date, time), offset};
      }
    }
    offset += line.length + 1;
  }
  const result = {csb, narrative};
  messageCache.set(message, {raw, result});
  return result;
}

function narrativeTimes(chat) {
  let narrative = null, csb = null;
  for (let index = (chat?.length ?? 0) - 1; index >= 0 && (!narrative || !csb); index--) {
    const parsed = messageTime(chat[index]);
    if (!narrative && parsed?.narrative) narrative = {...parsed.narrative, index};
    if (!csb && parsed?.csb) csb = {...parsed.csb, index};
  }
  return {narrative, csb};
}

/**
 * Precedence: explicit per-chat override > authoritative CSB scene time >
 * explicit narrative marker. A later narrative marker can supersede CSB only
 * when its preceding CSB source still exactly matches the current snapshot.
 * A manual CSB edit or imported seed therefore keeps its authority.
 */
export function readStoryTime(context, {characterState = readCharacterState} = {}) {
  const scope = sourceScope(context);
  if (!scope || !context?.chatMetadata || !Array.isArray(context.chat)) return empty();
  const manual = context.chatMetadata[STORY_TIME_KEY];
  if (manual?.version === 1 && manual.scope === scope) {
    const result = clockValue(manual, 'manual');
    if (result.known) return result;
  }
  let stateTime = '';
  try { stateTime = text(characterState(context)?.snapshot?.state?.scene?.time); } catch {}
  const {narrative, csb} = narrativeTimes(context.chat);
  const later = narrative && csb && (narrative.index > csb.index || narrative.index === csb.index && narrative.offset > csb.offset);
  if (stateTime && !(later && csb.text === stateTime)) return clockValue(splitStoryTime(stateTime), 'csb');
  if (narrative) return clockValue(narrative, 'narrative');
  if (stateTime) return clockValue(splitStoryTime(stateTime), 'csb');
  return empty();
}

function normalizeManual(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('劇情時間格式錯誤。');
  for (const [key, max] of [['date', 120], ['time', 120], ['label', 200]]) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].trim().length > max)) throw Error(`劇情時間 ${key} 須為 ${max} 字元內的文字。`);
  }
  const result = clockValue(value, 'manual');
  if (!result.known) throw Error('請至少填入劇情日期或時間；恢復自動讀取請使用清除設定。');
  return {date: result.date, time: result.time, label: result.label};
}

export function createStoryClock({context, onChange = () => {}, assertCurrent = () => {}, characterState} = {}) {
  let alive = true, saving = false;
  const current = () => readStoryTime(context(), {characterState});
  async function set(value) {
    if (!alive) throw Error('劇情時鐘已關閉。');
    if (saving) throw Error('正在保存劇情時間，請稍後。');
    const c = context(), scope = sourceScope(c), metadata = c?.chatMetadata, chat = c?.chat;
    if (!scope || !metadata || !Array.isArray(chat)) throw Error('請先開啟一個聊天。');
    const guard = () => {
      const now = context();
      if (!alive || sourceScope(now) !== scope || now?.chatMetadata !== metadata || now?.chat !== chat) throw Error('聊天已切換，劇情時間未套用至其他聊天。');
      assertCurrent(c, scope);
    };
    guard();
    const clear = value === null || value?.clear === true;
    const next = clear ? null : {version: 1, scope, ...normalizeManual(value)};
    const had = Object.hasOwn(metadata, STORY_TIME_KEY), before = metadata[STORY_TIME_KEY];
    saving = true;
    try {
      if (clear) delete metadata[STORY_TIME_KEY]; else metadata[STORY_TIME_KEY] = next;
      if (typeof c.saveMetadata !== 'function') throw Error('此酒館未提供聊天資料保存功能。');
      await c.saveMetadata();
      guard();
      onChange();
      return current();
    } catch (error) {
      // Only restore our own write, even when this old chat is no longer active.
      if (clear ? !Object.hasOwn(metadata, STORY_TIME_KEY) : metadata[STORY_TIME_KEY] === next) {
        if (had) metadata[STORY_TIME_KEY] = before; else delete metadata[STORY_TIME_KEY];
      }
      throw error;
    } finally { saving = false; }
  }
  return {current, set, dispose() { alive = false; }};
}
