import test from 'node:test';
import assert from 'node:assert/strict';
import {PhoneBackend, TTSBackend} from '../core/backend.js';
import {freshState, normalizeSettings} from '../core/state.js';
import {Providers} from '../core/providers.js';
import {DEFAULT_FORMAT} from '../core/protocol.js';
import {defaultChat, chatContacts, buildChatRequest, parseChatReply} from '../core/chat.js';
import {buildCallRequest} from '../core/call.js';
import {createCallHost} from '../host-call.js';
import {writeBackup} from '../core/backup.js';
import {buildReport} from '../core/diagnostics.js';

function fixture() {
  const settings = freshState(), saved = [], requests = [], keys = new Map();
  settings.general.voiceEnabled = true;
  settings.general.waveformEnabled = true;
  settings.routes = [{id: 'alice', name: '雲璃', persona: '醫修，善用草藥', appearance: '銀髮', engine: 'fish', voice: 'old-voice', model: '', language: 'zh'}];
  const library = {getPhone: async () => ({volume: 0.7}), listVibes: async () => [], close: async () => {},
    getReference: () => assert.fail('unused audio sample must not be loaded'), exportRows: async () => ({})};
  const providers = new Providers(async (...args) => { requests.push(args); throw Error('speech network must stay unused'); });
  const keyStore = {open: async () => {}, load: () => keys, save: (engine, value) => { keys.set(engine, value); return value; }, close() {}};
  const backend = new PhoneBackend({settings, providers, library, keyStore, persist: value => saved.push(value),
    cache: {close: async () => {}}, chats: {close() {}}, sink: new Proxy({}, {get: () => assert.fail('audio sink must stay unused')})});
  return {backend, api: backend.api(), saved, requests};
}

test('startup and migration keep characters while speech stays disabled without creating audio objects', async t => {
  const oldAudio = globalThis.Audio, oldContext = globalThis.AudioContext;
  globalThis.Audio = globalThis.AudioContext = class { constructor() { assert.fail('audio was initialized'); } };
  t.after(() => { globalThis.Audio = oldAudio; globalThis.AudioContext = oldContext; });
  const f = fixture(); t.after(() => f.backend.close());
  assert.equal(PhoneBackend, TTSBackend, 'legacy imports stay compatible');
  await f.backend.initialize();
  assert.equal(f.api.capabilities.tts, false);
  assert.equal(f.api.getState().general.voiceEnabled, false);
  assert.equal(f.api.getState().general.waveformEnabled, false);
  assert.deepEqual(f.api.promptPlan(), []);
  assert.equal(f.api.previewPrompt(), '');
  assert.equal(f.api.status().phase, 'idle');
  assert.equal(f.api.getVolume(), 0.7);
  const updated = f.api.updateGeneral({voiceEnabled: true, waveformEnabled: true});
  assert.equal(updated.general.voiceEnabled, false);
  assert.equal(updated.general.waveformEnabled, false);
  f.api.saveRoute({id: 'alice', name: '雲璃', persona: '醫修，擅長診脈'});
  assert.equal(f.api.getState().routes[0].voice, 'old-voice');
  assert.equal(f.api.chatContacts()[0].persona, '醫修，擅長診脈');
  assert.equal(f.api.chatContacts()[0].voice, false);
  assert.equal(f.saved.at(-1).general.voiceEnabled, false);
  assert.equal(f.requests.length, 0);
  assert(!f.api.phoneCatalog.apps.some(app => ['listen', 'library'].includes(app)));
});

test('old playback, synthesis, cloning and speech-provider endpoints reject before any I/O', async t => {
  const f = fixture(); t.after(() => f.backend.close());
  const calls = [
    () => f.api.speak({role: '雲璃', text: '你好'}), () => f.api.audition({name: '雲璃'}),
    () => f.api.playFavorite('old'), () => f.api.reference(new Blob(['audio']), {wav: true}),
    () => f.api.voiceBalance('fish'), () => f.api.fishProbe(), () => f.api.voices('fish'),
    () => f.api.previewRequest('fish'), () => f.api.toggle(), () => f.api.resume(),
    () => f.backend.player.start([{role: '雲璃', text: '你好'}]), () => f.backend.player.sink.unlock(),
  ];
  for (const call of calls) await assert.rejects(Promise.resolve().then(call), error => error.code === 'TTS_REMOVED');
  assert.equal(f.requests.length, 0);
});

test('restoring a legacy backup cannot enable speech or discard saved character details', async t => {
  const f = fixture(); t.after(() => f.backend.close());
  const incoming = f.api.getState(); incoming.general.voiceEnabled = true; incoming.general.waveformEnabled = true;
  incoming.routes[0].persona = '舊備份裡的醫修人設';
  const blob = await writeBackup({settings: incoming, library: {}});
  const result = await f.api.importBackup(blob, {parts: ['settings']});
  assert.equal(result.settings, true);
  const state = f.api.getState();
  assert.equal(state.general.voiceEnabled, false);
  assert.equal(state.general.waveformEnabled, false);
  assert.equal(state.routes[0].persona, '舊備份裡的醫修人設');
  assert.equal(state.routes[0].voice, 'old-voice');
  assert.equal(normalizeSettings(incoming).routes[0].appearance, '銀髮');
});

test('chat and call request builders ignore legacy voice bindings and render old replies as text', () => {
  const settings = freshState(); settings.routes = [{name: '雲璃', engine: 'fish', voice: 'legacy', persona: '醫修'}];
  assert.equal(chatContacts(settings)[0].voice, false);
  const preset = defaultChat().presets[0], member = {name: '雲璃', voice: true, persona: '醫修'};
  preset.entries.push({id: 'voice', enabled: true, use: ['dm', 'group', 'call'], text: 'SHOULD_NOT_INJECT {{语音格式}}'});
  const thread = {type: 'dm', name: '雲璃', messages: []};
  const chat = buildChatRequest({preset, thread, members: [member], voiceFormat: 'VOICE_FORMAT_SENTINEL'});
  const call = buildCallRequest({preset, mode: 'incoming', contact: member, voiceFormat: 'VOICE_FORMAT_SENTINEL', voiceRules: 'VOICE_RULES_SENTINEL'});
  for (const request of [chat, call]) {
    assert.doesNotMatch(JSON.stringify(request), /SHOULD_NOT_INJECT|VOICE_FORMAT_SENTINEL|VOICE_RULES_SENTINEL/);
    assert.match(request[0].content, /不输出 TTS 标签/);
  }
  const legacy = DEFAULT_FORMAT.replace('{角色}', '雲璃').replace('{情绪}', 'calm').replace('{文本}', 'Hello').replace('{译文}', '你好');
  assert.deepEqual(parseChatReply(`雲璃：${legacy}`, {members: [member], voiceFormat: DEFAULT_FORMAT, voiceNames: ['雲璃']}), [{from: '雲璃', kind: 'text', text: '你好'}]);
});

test('a saved voice binding cannot start playback during a simulated call', async t => {
  const f = fixture(); t.after(() => f.backend.close());
  const generated = [], records = [];
  f.backend.threads = async () => [];
  f.backend.chats = {create: async () => ({id: 'dm'}), append: async (id, rows) => { records.push(...rows); }, close() {}};
  f.backend.generateText = async (ctx, request) => { generated.push(request); return '你好，今天過得如何？'; };
  f.backend.player.start = () => assert.fail('call attempted speech playback');
  const host = createCallHost({context: () => ({name1: '公子', name2: '雲璃', characters: [], chat: []}), settings: () => f.backend.settings,
    backend: f.backend, notice() {}, timing: {ring: () => 1000}});
  t.after(() => host.dispose());
  const state = host.ring('雲璃'); assert.equal(state.voiced, false);
  host.answer();
  for (let i = 0; i < 20 && host.status().thinking; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(host.status().thinking, false);
  assert.equal(host.status().speaking, false);
  assert.equal(host.status().lines[0].text, '你好，今天過得如何？');
  await host.hangup();
  assert.equal(records[0].kind, 'call');
  assert.equal(generated.length, 1);
  assert.equal(f.requests.length, 0);
});

test('self-check reports no removed audio requirements and still checks text/image connections', () => {
  const report = buildReport({browser: {audio: false, indexedDB: true}, voice: {enabled: true, roles: [{name: '雲璃'}]},
    keys: {fish: {set: false, needed: 'legacy voice'}, nai: {set: true}, llm: {set: false, needed: 'phone text'}},
    reply: {id: 1, inChat: true, tags: 0, lines: 0}});
  assert(!report.sections.some(section => section.title === '配音'));
  assert.doesNotMatch(report.text, /语音标签|音色|网页音频|Fish Audio/);
  assert.match(report.text, /NovelAI|文字模型/);
});
