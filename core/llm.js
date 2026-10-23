// 文字模型: which model writes the phone's text (chat replies, 朋友圈, calls, picture plans). 'tavern' uses the model the
// tavern is connected to (generateRaw), as before; 'custom' calls an OpenAI-compatible Chat Completions API directly
// from the browser with its own address, key and model. The story itself always stays on the tavern's model.
// Several custom connections can be kept as presets (address, model, temperature, length), one of them in use.
// Each preset's key lives with the other keys (core/keys.js, engine 'llm', one line per preset) and never appears in
// settings, requests shown to the user, or error messages.

export const TEXT_LIMITS = Object.freeze({maxTokens: [64, 32000], temperature: [0, 2], timeout: 120000});

export function defaultTextPreset(id = 'default', name = '自定义接口') {
  return {id, name, url: '', model: '', temperature: 0.9, maxTokens: 1200};
}
export function defaultText() {
  return {source: 'tavern', active: 'default', presets: [defaultTextPreset()]};
}
export const TEXT_PRESET_ID = /^[\w-]{1,64}$/;
const count = (value, [min, max], fallback, round = true) => { const n = round ? Math.round(Number(value)) : Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };
function normalizePreset(value, index) {
  const base = defaultTextPreset();
  return {id: TEXT_PRESET_ID.test(String(value?.id || '')) ? String(value.id) : crypto.randomUUID(), name: String(value?.name || '').trim().slice(0, 40) || '接口 ' + (index + 1),
    url: String(value?.url || '').trim().slice(0, 500), model: String(value?.model || '').trim().slice(0, 200),
    temperature: Math.round(count(value?.temperature, TEXT_LIMITS.temperature, base.temperature, false) * 100) / 100, maxTokens: count(value?.maxTokens, TEXT_LIMITS.maxTokens, base.maxTokens)};
}
export function normalizeText(value) {
  const base = defaultText();
  if (!value || typeof value !== 'object') return base;
  // Before presets there was one custom connection: it becomes the first preset, and its saved key goes with it ('default').
  const list = Array.isArray(value.presets) && value.presets.length ? value.presets : [{...value, id: 'default', name: '自定义接口'}];
  const presets = [];
  for (const [i, p] of list.slice(0, 30).entries()) { const preset = normalizePreset(p, i); if (presets.some(x => x.id === preset.id)) preset.id = crypto.randomUUID(); presets.push(preset); }
  return {source: value.source === 'custom' ? 'custom' : 'tavern', active: presets.some(p => p.id === value.active) ? value.active : presets[0].id, presets};
}
/** The connection in use: the source plus the active preset's address, model, temperature and length. */
export function activeText(value) {
  const text = normalizeText(value);
  return {source: text.source, ...text.presets.find(p => p.id === text.active)};
}

/** The API base: what the user typed without a trailing slash or a pasted /chat/completions or /models. */
export function apiBase(url) {
  let base = String(url || '').trim().replace(/\/+$/, '');
  base = base.replace(/\/(chat\/completions|completions|models)$/i, '');
  if (!/^https?:\/\/[^\s/]+/i.test(base)) throw Error('請填寫介面地址，例如 https://api.openai.com/v1');
  return base;
}

/** The messages to send: prompts are message lists already; a plain string becomes one user message. */
export function asMessages(prompt) {
  if (Array.isArray(prompt)) return prompt.filter(m => m && typeof m.content === 'string').map(m => ({role: ['system', 'user', 'assistant'].includes(m.role) ? m.role : 'user', content: m.content}));
  return [{role: 'user', content: String(prompt ?? '')}];
}

export function chatBody(text, prompt, responseLength) {
  if (!text.model) throw Error('請先在「引擎 → 文字模型」裡填寫模型名');
  return {model: text.model, messages: asMessages(prompt), temperature: text.temperature, max_tokens: Math.min(text.maxTokens, responseLength || text.maxTokens), stream: false};
}

/** The reply text of a Chat Completions answer (reasoning kept apart by the provider is left out). */
export function replyText(json) {
  const choice = json?.choices?.[0];
  const content = choice?.message?.content ?? choice?.text;
  if (Array.isArray(content)) return content.map(part => typeof part === 'string' ? part : part?.text || '').join('');
  if (typeof content === 'string') return content;
  throw Error('介面返回的內容裡沒有回覆文字');
}

/** The text in one streamed chunk, whatever the provider's shape: OpenAI-style deltas, Claude's content deltas, Gemini's
 *  candidate parts. Reasoning sent apart (reasoning_content, Gemini thoughts) is left out. */
export function chunkText(json) {
  const choice = json?.choices?.[0];
  if (choice) {
    const part = choice.delta?.content ?? choice.message?.content ?? choice.text;
    if (Array.isArray(part)) return part.map(p => typeof p === 'string' ? p : p?.text || '').join('');
    return typeof part === 'string' ? part : '';
  }
  if (json?.type === 'content_block_delta') return typeof json.delta?.text === 'string' ? json.delta.text : '';
  const parts = json?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) return parts.filter(p => !p?.thought).map(p => p?.text || '').join('');
  return '';
}
/**
 * Reads a streamed answer (server-sent events) to the end and returns the whole text. Some relays ("假流式" channels)
 * only answer a streamed request: asked without streaming they send back an empty message.
 */
export async function streamText(response) {
  const reader = response.body?.getReader?.();
  const decoder = new TextDecoder();
  let buffer = '', text = '';
  const take = block => {
    const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('');
    if (!data || data === '[DONE]') return;
    let json; try { json = JSON.parse(data); } catch { return; }
    const message = json?.error?.message || (typeof json?.error === 'string' ? json.error : '');
    if (message) throw Error(String(message).slice(0, 300));
    text += chunkText(json);
  };
  if (!reader) { for (const block of (await response.text()).split(/\r?\n\r?\n/)) take(block); return text; }
  for (;;) {
    const {done, value} = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), {stream: !done});
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = done ? '' : blocks.pop();
    for (const block of blocks) take(block);
    if (done) { if (buffer) take(buffer); return text; }
  }
}

/** A readable reason for a failed request. The key is never part of it. */
export function failure(status, body, key = '') {
  let detail = '';
  try { const json = typeof body === 'string' ? JSON.parse(body) : body; detail = json?.error?.message || json?.message || json?.detail || ''; } catch { detail = String(body || '').slice(0, 200); }
  detail = String(detail).slice(0, 300);
  if (key) detail = detail.split(key).join('••••');
  const reason = {401: '密钥无效或已过期', 403: '这个密钥没有权限', 404: '地址或模型名不对', 408: '接口超时了', 413: '请求内容太长', 429: '请求太频繁或额度用完了', 500: '接口服务出错了', 502: '接口服务暂时不可用', 503: '接口服务暂时不可用'}[status] || `接口返回错误 ${status}`;
  return Error(`文字模型：${reason}${detail ? '（' + detail + '）' : ''}`);
}

/**
 * Calls the custom API. fetch is passed in (tests). A network error in a browser is usually the API refusing web
 * pages (CORS) or a wrong address; the message says so.
 */
export async function customRequest({text, key, prompt, responseLength, fetch: send = globalThis.fetch, signal}) {
  const base = apiBase(text.url), body = chatBody(text, prompt, responseLength);
  const post = async stream => {
    const timeout = AbortSignal.timeout ? AbortSignal.timeout(TEXT_LIMITS.timeout) : undefined;
    try {
      return await send(base + '/chat/completions', {method: 'POST', headers: {'Content-Type': 'application/json', ...(key ? {Authorization: 'Bearer ' + key} : {})}, body: JSON.stringify({...body, stream}),
        signal: signal && timeout && AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal || timeout});
    } catch (error) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw Error('文字模型：等太久了，介面沒有回應');
      throw Error('文字模型：連不上這個介面。可能是地址寫錯了，或者這個介面不允許網頁直接訪問（CORS）');
    }
  };
  const response = await post(false);
  const raw = await response.text();
  if (!response.ok) throw failure(response.status, raw, key);
  let json;
  try { json = JSON.parse(raw); } catch { throw Error('文字模型：介面返回的不是 JSON，地址可能填錯了'); }
  let reply = '';
  try { reply = replyText(json); } catch { /* no text: tried again as a stream below */ }
  if (reply.trim()) return reply;
  // An empty answer: a "假流式" channel only answers streamed requests. Asked again as a stream.
  const streamed = await post(true);
  if (!streamed.ok) throw failure(streamed.status, await streamed.text(), key);
  reply = await streamText(streamed);
  if (!reply.trim()) throw Error('文字模型：介面沒有返回內容（普通請求和流式請求都試過了）');
  return reply;
}

/** Model ids the API lists (GET /models): for picking a model and checking the connection. Listing costs nothing. */
export async function listModels({text, key, fetch: send = globalThis.fetch}) {
  const base = apiBase(text.url);
  let response;
  try { response = await send(base + '/models', {headers: key ? {Authorization: 'Bearer ' + key} : {}}); }
  catch { throw Error('文字模型：連不上這個介面。可能是地址寫錯了，或者這個介面不允許網頁直接訪問（CORS）'); }
  const raw = await response.text();
  if (!response.ok) throw failure(response.status, raw, key);
  let json;
  try { json = JSON.parse(raw); } catch { throw Error('文字模型：介面返回的不是 JSON，地址可能填錯了'); }
  const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : Array.isArray(json) ? json : [];
  return [...new Set(list.map(m => typeof m === 'string' ? m : m?.id || m?.name).filter(Boolean).map(String))].sort().slice(0, 500);
}
