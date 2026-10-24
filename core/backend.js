import { MomentStore } from './moments-store.js';
import { AppStore } from './app-store.js';
import { FORUM_LIMITS, buildForumRequest, cleanPost as cleanForumPost, cleanReply as cleanForumReply, startingHeat } from './forum.js';
import { buildPeekRequest, cleanPeek, peekId } from './peek.js';
import { normalizeMoments, buildMomentsRequest } from './moments.js';
import { normalizeCalls, buildCallRequest } from './call.js';
import { normalizeText, activeText, customRequest, listModels, streamText, asMessages, TEXT_PRESET_ID } from './llm.js';
import { normalizeSync, runSync, SYNC_PARTS } from './sync.js';
import { BACKUP_PARTS, PART_STORES, writeBackup, readBackup, sealKeys, openKeys } from './backup.js';
import { WALLET_LIMITS, PREMIUM, DECOR_KINDS, SHOP_GIFTS, LEDGER_KINDS, premiumOf, decorKey, cents, yuan, shopGifts, normalizeGift, validateGift, walletAmount, purchaseItem } from './wallet.js';
import { DRAW_ENGINES, DRAW_ENGINE_NAMES, GPT_IMAGE_MODELS, GPT_QUALITIES, normalizeGpt, gptBase, gptSize, gptPrompt, gptGenerate, normalizeComfy, comfyUrl, checkWorkflow, comfySize, comfyPrompt, comfyValues, fillWorkflow, comfyGenerate, comfyCatalog, tavernWorkflows, tavernWorkflow, orientationOf, DEFAULT_COMFY_WORKFLOW } from './image-engines.js';
import { normalizeSettings, validateSettings, freshState } from './state.js';
import { normalizeRoute, switchRouteEngine, removeRoute } from './routes.js';
import { DEFAULT_FORMAT, validatePreset, parseDialogue, isPlaceholderRole, knownFormats } from './protocol.js';
import { TTSParameters } from './parameters.js';
import { KeyStore, keyTail, validateKey, parseTextKeys, joinTextKeys } from './keys.js';
import { Providers } from './providers.js';
import { AudioCache } from './cache.js';
import { LocalLibrary, PHONE_APPS, PHONE_WALLPAPERS, PHONE_GLYPHS, PHONE_SKINS } from './library.js';
import { NovelAIClient, relayUrl, FISH_PATHS, NAI_MODELS, NAI_MODEL_NAMES, NAI_SAMPLERS, NAI_SCHEDULES, buildImageRequest, guardParams, isFree, isV5, normalizeDrawParams } from './novelai.js';
import { PIC_TAG_FORMAT, DEFAULT_DRAW_RULE, DRAW_COUNT_MAX, PRESET_REV as DRAW_PRESET_REV, drawPromptPlan, planRequest, validateDrawPreset, normalizeDraw, defaultDraw, normalizeVibeSettings } from './draw.js';
import { defaultChat, normalizeChatPreset, normalizeContact, validateChatPreset, validateContact, chatContacts, inSpace, activeSpace, buildChatRequest, activeChatPreset, normalizeVoiceText, normalizeProfile , normalizeAvatars } from './chat.js';
import { ChatStore, money } from './chats.js';
import {parseSpiritAmount, parseSpiritText, formatSpiritAmount, addWalletAmount, legacyWalletAmount} from './currency.js';
import { deletedContactNames, isContactDeleted, forgetContact, restoreContact as restoreContactRecord } from './contact-book.js';
import { DrawQueue } from './draw-queue.js';
import { CloudQueue, KeyHashQueue, newRoomCode, validRoom, sha256Hex } from './cloud-queue.js';
import { vibeKey, readVibeFile, imageVibe, mergeVibe, encodingFor, withEncoding, vibeSummary, vibeParameters, singleFile, bundleFile, chatu8File, strength as vibeStrength, MAX_FREE_VIBES, VIBE_ANLAS } from './vibes.js';

export const BACKEND_API_VERSION = '1.0.0';
const ENGINES = ['fish', 'mini', 'eleven', 'mimo'];
/** A small JPEG data URI of a base64 picture, for the vibe list; '' where pictures cannot be drawn (no canvas). */
async function vibeThumbnail(base64) {
    try {
        if (typeof createImageBitmap !== 'function' || !globalThis.document?.createElement) return '';
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))]));
        const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height)), canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close?.();
        return canvas.toDataURL('image/jpeg', 0.82);
    } catch { return ''; }
}
const clone = value => structuredClone(value);
const engineCheck = engine => { if (!ENGINES.includes(engine)) throw Error('引擎無效'); };
// Keys cover the voice engines, NovelAI for drawing, and llm (the phone's own text model).
const keyCheck = engine => { if (engine !== 'nai' && engine !== 'llm' && engine !== 'gpt') engineCheck(engine); };
const modelCheck = (engine, model) => { engineCheck(engine); if (model && !TTSParameters.catalogs[engine].models.includes(model)) throw Error('請選擇列表中的模型'); };
const message = error => error instanceof TypeError ? '设置格式无效，请检查字段和条目' : error.message;
export const TTS_REMOVED_MESSAGE = 'TTS 語音功能已移除；角色資料仍保留在角色庫。';
const speechRemoved = () => { throw Object.assign(Error(TTS_REMOVED_MESSAGE), { code: 'TTS_REMOVED' }); };

/** Compatibility state for old host listeners. It never creates an audio sink or a synthesis queue. */
function inactivePlayer() {
    let volume = 1;
    return {
        phase: 'idle', message: '', index: 0, queue: [], pending: null, requestKey: null, epoch: 0, played: new Set(),
        snapshot() { return { phase: 'idle', message: '', index: 0, total: 0, engine: '', speaker: '', line: null, source: 'dialogue', requestKey: null, volume }; },
        setVolume(value) { if (Number.isFinite(value)) volume = Math.max(0, Math.min(1, value)); return volume; },
        getVolume: () => volume,
        stop() { this.epoch++; },
        start: speechRemoved, playBlob: speechRemoved, toggle: speechRemoved, continuePending: speechRemoved,
        lineState: async () => 'disabled', lineKey: async () => null,
        sink: Object.freeze({ levels: () => [0, 0, 0, 0, 0], stop() {}, close() {}, unlock: speechRemoved }),
        async close() { this.stop(); },
    };
}

/** Framework-independent operations. Host callbacks own SillyTavern persistence and rendering. */
// Audio files are named after who said what: 诺亚 - 午安，格林小姐.
const audioName = (role, said) => [String(role || '').trim(), String(said || '').replace(/\s+/g, ' ').trim().slice(0, 30)].filter(Boolean).join(' - ') || '傳音玉符 语音';

export class PhoneBackend {
    constructor({ settings, persist = () => {}, notify = () => {}, change = () => {}, unknown = () => {},
        providers = new Providers(), cache, library, keyStore, sink, novelai, chats, indexedDB = globalThis.indexedDB, syncStorage = () => globalThis.localStorage,
        imageFetch = (...args) => globalThis.fetch(...args), tavernHeaders = () => globalThis.SillyTavern?.getContext?.()?.getRequestHeaders?.() || {} } = {}) {
        this.settings = normalizeSettings(settings);
        validateSettings(this.settings);
        this.persist = persist;
        this.notify = notify;
        this.providers = providers;
        // Voice balances (ElevenLabs, Fish) read for the engine cards; a new audio marks them out of date.
        this.balances = new Map();
        // Several Fish keys: when one gives way to the next, the balance shown belongs to the old key.
        providers.onKeySwitch = engine => { this.balances.delete(engine); this.emit('balance', { engine, stale: true, switched: true }); };
        providers.onSpend = engine => { const b = this.balances.get(engine); if (b) b.checkedAt = 0; this.emit('balance', { engine, stale: true }); };
        this.cache = cache || new AudioCache(this.settings.scope, notify, indexedDB);
        this.library = library || new LocalLibrary(this.settings.scope, { indexedDB });
        this.keyStore = keyStore || new KeyStore(this.settings.scope, { indexedDB, onError: message => this.notify(message) });
        this.novelai = novelai || new NovelAIClient();
        this.textKeys = new Map();
        // Saved vibes by id: their summaries (core/vibes.js vibeSummary); the files themselves stay in the library.
        this.vibes = new Map();
        this.chats = chats || new ChatStore(this.settings.scope, { indexedDB });
        this.walletQueue = Promise.resolve();
        this.moments = new MomentStore(this.settings.scope, { indexedDB });
        // 论坛 and 查手机 (core/forum.js, core/peek.js).
        this.apps = new AppStore(this.settings.scope, { indexedDB });
        // 分区: the tavern's open character card (or group), told by the tavern page (index.js).
        this.space = { key: '', name: '', members: [] };
        this.subscription = null;
        // GPT 生图 and ComfyUI: the key of the GPT image engine; requests go out with these (tests pass their own).
        this.gptKey = '';
        this.imageFetch = imageFetch;
        this.tavernHeaders = tavernHeaders;
        // 保存到酒馆: the tavern's file access (set by the tavern side), what this device last saw there, and the state shown in the phone.
        this.syncFiles = null;
        this.syncStorage = syncStorage;
        this.syncState = { busy: false, error: '', lastAt: 0, remote: null, pending: false };
        this.syncTimer = 0;
        this.syncApplying = false;
        this.drawQueue = new DrawQueue({ gap: () => this.settings.draw.queue.gap * 1000, retries: () => this.settings.draw.queue.retries,
            remote: job => (job?.engine || this.settings.draw.engine) === 'nai' ? this.cloudQueue() : null, onChange: (queue, { remoteError }) => this.emit('draw', { queue, cloud: remoteError }) });
        this.listeners = new Set();
        this.revision = 0;
        this.closed = false;
        this.prepared = null;
        this.player = inactivePlayer();
    }
    async initialize() {
        this.assertOpen();
        try { await this.keyStore.open?.(); for (const [engine, key] of this.keyStore.load()) { if (engine === 'nai') this.novelai.setKey(key); else if (engine === 'gpt') this.gptKey = key; else if (engine === 'llm') this.textKeys = parseTextKeys(key); else this.providers.setKey(engine, key); } }
        catch (error) { this.notify(error.message); }
        try {
            const phone = await this.library.getPhone();
            if (!this.closed) this.player.setVolume(phone.volume);
            await this.loadVibes();
        } catch (error) { this.notify(error.message); }
        return this;
    }
    /** Legacy samples remain in backups; the character library never loads them into a speech provider. */
    async loadReferences() {}
    /** A backup file of the chosen parts (core/backup.js BACKUP_PARTS). Keys and the account scope are never written. */
    async exportBackup(parts = Object.keys(BACKUP_PARTS), version = '', { password = '' } = {}) {
        this.assertOpen();
        const want = [...new Set(parts)].filter(part => BACKUP_PARTS[part]);
        if (!want.length) throw Error('請至少選一項要備份的內容');
        const stores = want.flatMap(part => PART_STORES[part]);
        const library = stores.length ? await this.library.exportRows(stores) : {};
        let settings = null;
        if (want.includes('settings')) { settings = this.getState(); delete settings.scope; delete settings.floating; }
        const chats = want.includes('chats') ? await this.chats.exportThreads() : null, moments = want.includes('moments') ? await this.moments.exportPosts() : null;
        // Keys only with a password: sealed here, never written as they are.
        let keys = null;
        if (want.includes('keys')) { const all = Object.fromEntries(this.keyStore.load()); if (!Object.keys(all).length) throw Error('這臺瀏覽器裡還沒有儲存金鑰，備份裡不用帶'); keys = await sealKeys(all, password); }
        // Vibe groups live in the settings; they travel with the vibes too, so a backup of only the vibes keeps them.
        const vibeGroups = want.includes('vibes') ? clone(this.settings.draw.vibe.groups) : null;
        const blob = await writeBackup({ version, settings, library, chats, moments, keys, vibeGroups });
        const day = new Date(), pad = n => String(n).padStart(2, '0');
        return { blob, name: `傳音玉符 备份 ${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}` };
    }
    /** What a backup file holds, to show before restoring. */
    async inspectBackup(file) {
        this.assertOpen();
        const backup = await readBackup(file);
        return { version: backup.version, createdAt: backup.createdAt, summary: backup.summary };
    }
    /**
     * Restores the chosen parts of a backup. replace: those kinds of data are emptied first; otherwise rows with the
     * same id are overwritten and the rest kept. Settings are taken whole from the backup; keys, the account scope and
     * the floating ball's place stay. Everything is checked before anything is written.
     */
    async importBackup(file, { parts = [], replace = false, password = '' } = {}) {
        this.assertOpen();
        const backup = await readBackup(file), want = new Set(parts.filter(part => BACKUP_PARTS[part])), done = {};
        if (!want.size) throw Error('請至少選一項要恢復的內容');
        // Keys first: a wrong password stops the restore before anything else changes.
        let keys = null;
        if (want.has('keys') && backup.keys) keys = await openKeys(backup.keys, password);
        let settings = null;
        if (want.has('settings') && backup.settings) {
            settings = normalizeSettings({ ...backup.settings, scope: this.settings.scope, floating: this.settings.floating });
            validateSettings(settings);
        }
        const rows = {};
        for (const part of want) for (const store of PART_STORES[part]) if (backup.library[store]) rows[store] = backup.library[store];
        // One transaction for the library: photos land before the phone's look that uses them, references before the
        // settings that point at them.
        if (Object.keys(rows).length) Object.assign(done, await this.library.importRows(rows, { replace }));
        if (settings) { this.save(settings); done.settings = true; await this.loadReferences(); }
        if (want.has('vibes') && backup.library.vibes) {
            // The groups: replace takes the backup's; merge keeps the current ones and adds or overwrites by id.
            const now = this.settings.draw.vibe, incoming = backup.vibeGroups || [];
            const groups = replace ? incoming : [...now.groups.filter(g => !incoming.some(x => x?.id === g.id)), ...incoming];
            this.saveDraw({ vibe: { groups } });
            await this.loadVibes();
            const use = this.settings.draw.vibe.use;
            if (use.kind === 'vibe' && !this.vibes.has(use.id)) this.saveDraw({ vibe: { use: { kind: '', id: '' } } });
            this.emit('draw', { vibes: true });
            done.vibeGroups = this.settings.draw.vibe.groups.length;
        }
        if (want.has('chats') && backup.chats) { done.chats = await this.chats.importThreads(backup.chats, { replace }); this.emit('chat', { threadId: '' }); }
        if (want.has('moments') && backup.moments) { done.moments = await this.moments.importPosts(backup.moments, { replace }); this.emit('moments', {}); }
        if (keys) { let count = 0; for (const [engine, key] of Object.entries(keys)) { try { this.setKey(engine, key); count++; } catch { /* an engine this version does not know */ } } done.keys = count; }
        for (const collection of ['favorites', 'photos', 'notes']) if (collection in done) this.emit('library', { collection });
        if ('phone' in done || 'photos' in done) this.emit('phone', { preferences: await this.getPhone() });
        return done;
    }
    assertOpen() { if (this.closed) throw Error('外掛已關閉，請重新開啟設定'); }
    emit(type, data = {}) {
        if (this.closed) return;
        const event = { type, revision: this.revision, ...clone(data) };
        if (!this.syncApplying && (type === 'chat' || type === 'moments' || (type === 'library' && ['notes', 'photos'].includes(data.collection)))) this.scheduleSync();
        for (const listener of this.listeners) { try { listener(clone(event)); } catch { /* One view cannot stop the other subscribers. */ } }
    }
    subscribe(listener) {
        this.assertOpen();
        if (typeof listener !== 'function') throw Error('狀態訂閱需要回撥函式');
        this.listeners.add(listener);
        try { listener({ type: 'playback', revision: this.revision, ...this.player.snapshot() }); } catch { this.listeners.delete(listener); throw Error('介面無法接收播放狀態'); }
        return () => this.listeners.delete(listener);
    }
    getState() { this.assertOpen(); return clone(this.settings); }
    getSnapshot() { return { state: this.getState(), revision: this.revision }; }
    save(next, expectedRevision) {
        this.assertOpen();
        if (expectedRevision !== undefined && expectedRevision !== this.revision) throw Error('配置已在別處修改，請重新讀取後儲存');
        let copy;
        try {
            if (!next || typeof next !== 'object' || !Array.isArray(next.routes) || !Array.isArray(next.presets)) throw Error('設定缺少角色或預設列表');
            copy = normalizeSettings(next);
            copy.scope = this.settings.scope;
            copy.routes = copy.routes.map(route => ({ ...route, id: route.id || crypto.randomUUID(), name: String(route.name || '').trim() }));
            if (new Set(copy.routes.map(route => route.id)).size !== copy.routes.length) throw Error('角色 ID 不可重複');
            if (new Set(copy.presets.map(preset => preset.id)).size !== copy.presets.length) throw Error('預設 ID 不可重複');
            for (const route of copy.routes) {
                modelCheck(route.engine, route.model);
                for (const [engine, binding] of Object.entries(route.bindings || {})) modelCheck(engine, binding.model);
            }
            for (const [engine, connection] of Object.entries(copy.connections)) modelCheck(engine, connection.model);
            validateSettings(copy);
        } catch (error) { throw Error(message(error)); }
        // The host callback completes before the service acknowledges a new settings revision.
        this.persist(clone(copy));
        this.settings = copy;
        this.revision++;
        this.emit('settings', { state: this.getState() });
        return this.getState();
    }
    updateGeneral(patch) {
        if (!patch || typeof patch !== 'object') throw Error('設定格式無效');
        const next = this.getState();
        for (const key of ['voiceEnabled', 'cacheEnabled', 'floatingEnabled', 'waveformEnabled', 'wallpaperMotion', 'stripVoice']) if (key in patch) {
            if (typeof patch[key] !== 'boolean') throw Error('開關設定無效'); next.general[key] = patch[key];
        }
        if ('defaultLanguage' in patch) {
            if (typeof patch.defaultLanguage !== 'string' || !patch.defaultLanguage.trim() || patch.defaultLanguage.length > 40) throw Error('預設語言無效');
            next.general.defaultLanguage = patch.defaultLanguage.trim();
        }
        return this.save(next);
    }
    saveRoute(value) {
        const next = this.getState();
        if (!value || typeof value.name !== 'string' || !value.name.trim() || isPlaceholderRole(value.name)) throw Error('請填寫實際角色名');
        const id = value.id || crypto.randomUUID(), index = next.routes.findIndex(route => route.id === id);
        const route = normalizeRoute({ ...(index >= 0 ? next.routes[index] : { engine: 'fish', voice: '', model: '', language: '' }), ...clone(value), id, name: value.name.trim() });
        if (index >= 0) next.routes[index] = route; else next.routes.push(route);
        next.selected = id;
        this.save(next);
        return clone(this.settings.routes.find(row => row.id === id));
    }
    deleteRoute(id) {
        const route = this.settings.routes.find(row => row.id === id);
        if (route && (this.player.pending === route.name || this.player.queue.some(line => line.role === route.name))) this.player.stop('角色配音已删除');
        return this.save(removeRoute(this.settings, id));
    }
    saveConnection(engine, patch) {
        engineCheck(engine);
        if (!patch || typeof patch !== 'object' || Array.isArray(patch) || ('params' in patch && (!patch.params || typeof patch.params !== 'object' || Array.isArray(patch.params)))) throw Error('引擎設定格式無效');
        patch = clone(patch);
        // Fish relay: an address checked like the NovelAI one ('' = straight to Fish). A new address: the balance is read again.
        if (engine === 'fish' && 'relay' in patch) { patch.relay = relayUrl(patch.relay, undefined, FISH_PATHS); if (patch.relay !== this.settings.connections.fish.relay) this.balances.delete('fish'); }
        else delete patch.relay;
        if (engine === 'fish' && 'relayApi' in patch) { if (!['fish', 'openai'].includes(patch.relayApi)) throw Error('中轉介面格式無效'); this.balances.delete('fish'); }
        else if (engine !== 'fish') delete patch.relayApi;
        const next = this.getState();
        next.connections[engine] = { ...next.connections[engine], ...patch, params: { ...next.connections[engine].params, ...clone(patch.params || {}) } };
        this.save(next);
        return clone(this.settings.connections[engine]);
    }
    savePreset(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('預設格式無效');
        const next = this.getState(), preset = clone(value);
        preset.id ||= crypto.randomUUID();
        validatePreset(preset);
        const index = next.presets.findIndex(item => item.id === preset.id);
        if (index < 0) next.presets.push(preset); else next.presets[index] = preset;
        this.save(next);
        return clone(preset);
    }
    deletePreset(id) {
        const next = this.getState();
        if (!next.presets.some(preset => preset.id === id)) return next;
        if (next.presets.length === 1) throw Error('請至少保留一個提示詞預設');
        next.presets = next.presets.filter(preset => preset.id !== id);
        return this.save(next);
    }
    selectPreset(id) {
        const next = this.getState();
        if (!next.presets.some(preset => preset.id === id)) throw Error('預設不存在');
        next.activePreset = id;
        return this.save(next);
    }
    previewPrompt() { return ''; }
    parse(text) {
        const formats = knownFormats(this.settings);
        for (const format of formats) { const lines = parseDialogue(text, format); if (lines.length) return { format, lines }; }
        return { format: formats[0], lines: [] };
    }
    setKey(engine, key) {
        keyCheck(engine); if (!String(key).trim()) throw Error('請填寫金鑰，或使用清除金鑰');
        // The text model: a stored list (from a backup) replaces every preset's key; a plain key is the active preset's.
        if (engine === 'llm') { if (String(key).includes('\t')) this.storeTextKeys(parseTextKeys(key)); else this.setTextKey(this.settings.text.active, key); return; }
        const saved = this.keyStore.save(engine, key);
        if (engine === 'nai') { this.novelai.setKey(saved); this.subscription = null; } else if (engine === 'gpt') this.gptKey = saved; else { this.providers.setKey(engine, saved); this.balances.delete(engine); }
        this.emit('keys', { engine, configured: true });
    }
    /** Voice engines keep several keys: new ones are added after those saved (repeats once). Returns how many were new. */
    addKeys(engine, value) {
        engineCheck(engine);
        const fresh = validateKey(engine, value).split('\n').filter(Boolean);
        if (!fresh.length) throw Error('請填寫金鑰');
        const saved = this.savedKeys(engine), added = fresh.filter(key => !saved.includes(key));
        if (!added.length) throw Error(fresh.length > 1 ? '這些金鑰都已經儲存過了' : '這個金鑰已經儲存過了');
        this.setKey(engine, [...saved, ...added].join('\n'));
        return added.length;
    }
    /** Deletes one saved key by its place in the list (0-based); the last one deleted clears the engine's key. */
    removeKey(engine, index) {
        engineCheck(engine);
        const saved = this.savedKeys(engine);
        if (!Number.isInteger(index) || !saved[index]) throw Error('這個金鑰已經不在了');
        saved.splice(index, 1);
        if (saved.length) this.setKey(engine, saved.join('\n')); else this.clearKey(engine);
    }
    /**
     * The user picks the key to use: it is used at once and moved to the front of the list, so it is still the one used
     * after the page is opened again. The others keep their order and still take over when it is refused.
     */
    useKey(engine, index) {
        engineCheck(engine);
        const saved = this.savedKeys(engine), key = saved[index];
        if (!Number.isInteger(index) || !key) throw Error('這個金鑰已經不在了');
        if (index > 0) this.setKey(engine, [key, ...saved.filter((_, i) => i !== index)].join('\n'));
        this.providers.useKey(engine, key); this.balances.delete(engine);
        this.emit('keys', { engine, configured: true });
    }
    savedKeys(engine) { return (this.providers.keys.get(engine) || '').split('\n').filter(Boolean); }
    /** The saved keys of a voice engine as the phone shows them: last characters, in use, refused this time. Never the keys. */
    keyList(engine) { engineCheck(engine); return this.providers.keyList(engine); }
    /** The text model's keys, one per connection preset. */
    setTextKey(id, key) {
        if (!TEXT_PRESET_ID.test(String(id))) throw Error('文字模型預設無效');
        const value = [...parseTextKeys(String(key ?? '').replace(/\t/g, ' ')).values()][0];
        if (!value) throw Error('請填寫金鑰，或使用清除金鑰');
        this.storeTextKeys(new Map(this.textKeys).set(id, value));
    }
    clearTextKey(id) { const map = new Map(this.textKeys); map.delete(id); this.storeTextKeys(map); }
    /** The last characters of a preset's key ('••••' for a key too short to show any), '' without one. */
    textKeyHint(id) { const key = this.textKeys.get(id); return key ? keyTail(key) || '••••' : ''; }
    storeTextKeys(map) { this.keyStore.save('llm', joinTextKeys(map)); this.textKeys = map; this.emit('keys', { engine: 'llm', configured: map.has(this.settings.text.active) }); }
    clearKey(engine) {
        keyCheck(engine);
        if (engine === 'llm') { this.clearTextKey(this.settings.text.active); return; }
        this.keyStore.save(engine, '');
        if (engine === 'nai') { this.novelai.setKey(''); this.subscription = null; } else if (engine === 'gpt') this.gptKey = ''; else { this.providers.setKey(engine, ''); this.balances.delete(engine); }
        this.emit('keys', { engine, configured: false });
    }
    /** What is left on a voice account (ElevenLabs credits, Fish API balance); null without a key. Cached for a minute. */
    async voiceBalance() { return speechRemoved(); }
    /** The last 4 characters of the saved key ('' without one), so the user can tell which key is in use. */
    keyHint(engine) { keyCheck(engine); if (engine === 'gpt') return keyTail(this.gptKey); if (engine !== 'nai' && engine !== 'llm') return keyTail(this.providers.currentKey(engine)); if (engine === 'llm') return this.textKeyHint(this.settings.text.active); try { return keyTail(this.keyStore.load().get(engine) || ''); } catch { return ''; } }
    /** For a voice engine with keys: how many, which one is in use (1-based) and how many were refused while this page is open. */
    keyPool(engine) { engineCheck(engine); return this.providers.keyPool(engine); }
    keyStatus(engine) { keyCheck(engine); return engine === 'nai' ? this.novelai.configured : engine === 'gpt' ? !!this.gptKey : engine === 'llm' ? this.textKeys.has(this.settings.text.active) : this.providers.keys.has(engine); }

    // ---------- 靈石袋 and 商城 ----------
    wallet() { return clone(this.settings.chat.wallet); }
    /** One wallet transaction at a time in this loaded phone. Failed work does not block the queue. */
    walletSerial(task) {
        const job = (this.walletQueue || Promise.resolve()).then(() => { this.assertOpen(); return task(); });
        this.walletQueue = job.catch(() => {});
        return job;
    }
    walletEntry(w, amount, {kind, note = '', who = '', id = crypto.randomUUID()} = {}) {
        let next;
        try { next = addWalletAmount(w.balance, amount, {signed: true}); }
        catch { throw Object.assign(Error(amount < 0 ? `靈石不足：現有 ${formatSpiritAmount(w.balance)}，需要 ${formatSpiritAmount(-amount)}` : '靈石餘額超過上限'), {code: amount < 0 ? 'BROKE' : 'WALLET_LIMIT'}); }
        if (!Number.isFinite(amount) || !Number.isFinite(next) || next < 0 || next > WALLET_LIMITS.balance) throw Object.assign(Error(amount < 0 ? `靈石不足：現有 ${formatSpiritAmount(w.balance)}，需要 ${formatSpiritAmount(-amount)}` : '靈石袋餘額超過上限'), {code: amount < 0 ? 'BROKE' : 'WALLET_LIMIT'});
        w.balance = next;
        w.ledger.unshift({id, at: Date.now(), amount, kind, note: String(note).slice(0, 60), who: String(who).slice(0, 40)});
        w.ledger.length = Math.min(w.ledger.length, WALLET_LIMITS.ledger);
    }
    walletJournalSlot(w) {
        if (w.journal.length >= WALLET_LIMITS.journal) throw Error('靈石袋交易記錄已滿，請匯出備份後管理記錄；本次沒有扣款');
    }
    walletCommit(next) {
        this.save(next);
        this.emit('wallet', {balance: this.settings.chat.wallet.balance});
        return this.wallet();
    }
    walletSetBalance(value, note = '') {
        const amount = walletAmount(value);
        return this.walletSerial(() => {
            const next = this.getState(), w = next.chat.wallet, delta = addWalletAmount(amount, -w.balance);
            if (!delta) return this.wallet();
            this.walletEntry(w, delta, {kind: 'adjust', note: String(note).trim() || '自行设定剧情零钱'});
            return this.walletCommit(next);
        });
    }
    /** A purchase and its inventory snapshot are saved together. Reusing an order ID never charges twice. */
    pocketPurchase(value, orderId, options = {}) {
        const item = purchaseItem(value), id = String(orderId || '');
        if (!/^[\w:.-]{1,160}$/.test(id)) throw Error('訂單編號無效');
        const fingerprint = JSON.stringify(item);
        return this.walletSerial(() => {
            if(options.isCurrent&&!options.isCurrent())throw Error('對話已切換，購買已取消');
            const next = this.getState(), w = next.chat.wallet, key = 'purchase:' + id;
            const prior = w.journal.find(r => r.id === key);
            if (prior) {
                if (prior.fingerprint !== fingerprint) throw Error('這個訂單編號已經用於另一件商品');
                return this.wallet();
            }
            this.walletJournalSlot(w);
            if (w.inventory.length >= WALLET_LIMITS.inventory) throw Error('物品清單已滿，本次沒有扣款');
            this.walletEntry(w, -item.price, {kind: 'purchase', note: item.name, id: key});
            w.inventory.unshift({...item, orderId: id, at: Date.now()});
            w.journal.push({id: key, flow: 'purchase', status: 'done', at: Date.now(), amount: -item.price, fingerprint});
            return this.walletCommit(next);
        });
    }
    /** Money in (+) or out (-) of the wallet, with a line in its 明细. Out with too little left: code 'BROKE'. */
    walletMove(amount, { kind = 'topup', note = '', who = '' } = {}) {
        const value = cents(amount);
        if (!Number.isFinite(value) || value === 0) throw Error('金額無效');
        const next = this.getState(), w = next.chat.wallet;
        this.walletEntry(w, value, {kind: String(kind).slice(0, 20), note, who});
        return this.walletCommit(next);
    }
    /** Buys a decoration once; it can then be put on in 个性装扮. */
    buyDecoration(kind, key) {
        const item = premiumOf(kind, key);
        if (!item) throw Error('商城裡沒有這件裝扮');
        return this.walletSerial(() => {
            const next = this.getState(), w = next.chat.wallet;
            if (w.owned.includes(decorKey(kind, key))) return this.wallet();
            this.walletEntry(w, -item[1], {kind: 'shop', note: DECOR_KINDS[kind] + ' · ' + item[0]});
            w.owned.push(decorKey(kind, key));
            return this.walletCommit(next);
        });
    }
    /** A gift of the user's own in the shop (new, or changed by id). */
    saveGift(value) {
        const next = this.getState(), list = next.chat.wallet.gifts, previous = list.find(g => g.id === value?.id);
        const samePrice = previous && String(previous.price) === String(value?.price);
        const price = samePrice ? legacyWalletAmount(previous.price) : parseSpiritText(value?.price ?? 0);
        const gift = validateGift(normalizeGift({...clone(value || {}), price}));
        if (list.some(g => g.name === gift.name && g.id !== gift.id)) throw Error('已經有叫「' + gift.name + '」的禮物了');
        const index = list.findIndex(g => g.id === gift.id);
        if (index < 0) { if (list.length >= WALLET_LIMITS.gifts) throw Error('自定義禮物最多 ' + WALLET_LIMITS.gifts + ' 件'); list.push(gift); } else list[index] = gift;
        this.save(next);
        this.emit('wallet', {});
        return clone(gift);
    }
    deleteGift(id) {
        const next = this.getState();
        next.chat.wallet.gifts = next.chat.wallet.gifts.filter(g => g.id !== id);
        this.save(next);
        this.emit('wallet', {});
        return this.wallet();
    }
    /** Payment IDs survive retries; the wallet journal is saved with each debit before the message is appended. */
    async sendPaid(threadId, message, options = {}) {
        const value = clone(message || {}), paymentId = String(value.paymentId || crypto.randomUUID());
        const guard = () => { if (options.isCurrent && !options.isCurrent()) throw Error('對話已切換，付款已取消'); };
        guard();
        if (!/^[\w:.-]{1,160}$/.test(paymentId)) throw Error('付款編號無效');
        return this.walletSerial(async () => {
            guard();
            let thread = await this.chats.get(threadId);
            guard();
            if (!thread) throw Error('這段聊天已不存在');
            let item, cost = 0, note = '';
            if (value.kind === 'gift') {
                const gift = shopGifts(this.settings.chat.wallet).find(g => g.id === value.giftId);
                if (!gift) throw Error('商城裡沒有這件禮物了');
                if (thread.type !== 'dm') throw Error('禮物只能在私聊裡送');
                item = {from: 'me', kind: 'gift', gift: {name: gift.name, emoji: gift.emoji, price: gift.price}, text: String(value.text || '').slice(0, 60), state: 'sent', paymentId};
                cost = gift.price; note = gift.name;
            } else if (['redpacket', 'transfer'].includes(value.kind)) {
                // New UI specifies the unit; unmarked calls retain the legacy
                // API so an interrupted old transaction keeps its fingerprint.
                // Canonicalize the same payload on every retry. The journal
                // already contains lower-grade amounts; never reconvert it.
                const raw = value.unit ? parseSpiritAmount(value.amount, value.unit, {zero: false}) : value.amount;
                const amount = money(raw);
                if (!amount) throw Error('金額無效');
                if (value.kind === 'transfer' && thread.type !== 'dm') throw Error('轉賬只能在私聊裡傳送');
                item = {from: 'me', kind: value.kind, amount, text: String(value.text || '').slice(0, 40), state: 'sent', paymentId};
                cost = Number(amount); note = item.text;
            } else throw Error('這條訊息不用付錢');
            const key = 'send:' + paymentId, fingerprint = JSON.stringify([threadId, item]), who = thread.name;
            let prior = this.settings.chat.wallet.journal.find(r => r.id === key);
            if (prior && prior.fingerprint !== fingerprint) throw Error('付款編號已用於另一筆交易');
            if (prior?.status === 'refunded') throw Error('上次未傳送成功，款項已退回，請重新開啟傳送視窗');
            if (prior?.status === 'done') return thread;
            if (!prior) {
                const next = this.getState(), w = next.chat.wallet;
                this.walletJournalSlot(w);
                if (cost > 0) this.walletEntry(w, -cost, {kind: item.kind, note, who, id: key});
                w.journal.push({id: key, flow: 'send', status: 'pending', at: Date.now(), amount: -cost, threadId, fingerprint});
                this.walletCommit(next);
            }
            try {
                // A retry after interruption first looks for the message saved by the earlier attempt.
                if (!thread.messages.some(m => m.paymentId === paymentId)) thread = await this.chats.append(threadId, [item], {read: true});
                const next = this.getState(), entry = next.chat.wallet.journal.find(r => r.id === key);
                entry.status = 'done'; entry.messageId = thread.messages.find(m => m.paymentId === paymentId)?.id || '';
                this.walletCommit(next);
                this.emit('chat', {threadId});
                return thread;
            } catch (error) {
                // A storage error can arrive after the write; never refund a message that is already present.
                let check;
                try { check = await this.chats.get(threadId); } catch { throw Error('付款結果暫時無法確認，請稍後用同一視窗重試；不要重複新建付款'); }
                if (check?.messages.some(m => m.paymentId === paymentId)) throw Error('訊息已儲存，付款記錄待確認，請用同一視窗重試');
                const next = this.getState(), entry = next.chat.wallet.journal.find(r => r.id === key);
                if (entry.status === 'pending') {
                    if (cost > 0) this.walletEntry(next.chat.wallet, cost, {kind: 'refund', note: (note || LEDGER_KINDS[item.kind]) + '（没发出去）', who, id: 'refund:' + paymentId});
                    entry.status = 'refunded';
                    this.walletCommit(next);
                }
                throw error;
            }
        });
    }
    /** Incoming settlement is serialized and journaled before the message state changes. A retry resumes it. */
    async takeSent(threadId, messageId, accept = true) {
        return this.walletSerial(async () => {
            let thread = await this.chats.get(threadId), m = thread?.messages.find(x => x.id === messageId);
            if (!m || m.from === 'me' || !['redpacket', 'transfer', 'gift'].includes(m.kind)) throw Error('這條訊息已不存在');
            if (m.kind === 'redpacket' && !accept) throw Error('紅包不能退還');
            const state = m.kind === 'redpacket' ? 'opened' : accept ? 'accepted' : 'returned';
            const key = 'take:' + (m.paymentId || (threadId + ':' + messageId));
            if (key.length > 200) throw Error('交易編號過長');
            let prior = this.settings.chat.wallet.journal.find(r => r.id === key);
            if (prior && prior.action !== state) throw Error('這筆交易已經按另一種方式處理');
            if (prior?.status === 'done') {
                if (m.state === 'sent') { thread = await this.chats.updateMessage(threadId, messageId, {state: prior.action, openedBy: 'me'}); this.emit('chat', {threadId}); }
                return thread;
            }
            if (!prior && m.state !== 'sent') return thread;
            if (!prior) {
                const next = this.getState(), w = next.chat.wallet;
                this.walletJournalSlot(w);
                if (accept && m.kind !== 'gift') this.walletEntry(w, walletAmount(m.amount, {zero: false, legacy: true}), {kind: m.kind, note: m.text, who: m.from, id: key});
                if (accept && m.kind === 'gift') {
                    w.received.unshift({id: key, at: Date.now(), from: m.from, name: m.gift.name, emoji: m.gift.emoji, note: m.text || ''});
                    w.received.length = Math.min(w.received.length, WALLET_LIMITS.received);
                }
                w.journal.push({id: key, flow: 'take', status: 'pending', at: Date.now(), amount: accept && m.kind !== 'gift' ? Number(m.amount) : 0, threadId, messageId, action: state, notice: false});
                this.walletCommit(next);
            }
            // If this write fails, the pending journal allows a retry without another credit or gift.
            if (m.state === 'sent') thread = await this.chats.updateMessage(threadId, messageId, {state, openedBy: 'me'});
            const noticeId = 'notice:' + key;
            const text = {opened: '领取了{对方}的红包', accepted: m.kind === 'gift' ? '收下了{对方}的礼物' : '收下了{对方}的转账', returned: m.kind === 'gift' ? '退还了{对方}的礼物' : '退还了{对方}的转账'}[state];
            if (!thread.messages.some(x => x.paymentId === noticeId)) thread = await this.chats.append(threadId, [{from: 'me', kind: 'notice', target: m.from, text, paymentId: noticeId}], {read: true});
            const next = this.getState(), entry = next.chat.wallet.journal.find(r => r.id === key);
            entry.status = 'done'; entry.notice = true;
            this.walletCommit(next);
            this.emit('chat', {threadId});
            return thread;
        });
    }

    /** A model contact accepts/returns the user's payment. The actor must belong to this conversation. */
    async settleSent(threadId, messageId, actor, action = 'accept') {
        return this.walletSerial(async () => {
            let thread = await this.chats.get(threadId);
            const m = thread?.messages.find(x => x.id === messageId);
            if (!m || m.from !== 'me' || !['redpacket', 'transfer', 'gift'].includes(m.kind)) throw Error('待處理的付款已不存在');
            if (!thread.members.includes(actor)) throw Error('只有本聊天的聯絡人可以處理付款');
            if (!['accept', 'return'].includes(action)) throw Error('付款操作無效');
            if (m.kind === 'redpacket' && action === 'return') return thread;
            const state = m.kind === 'redpacket' ? 'opened' : action === 'return' ? 'returned' : 'accepted';
            const key = 'claim:' + (m.paymentId || (threadId + ':' + messageId));
            if (key.length > 200) throw Error('交易編號過長');
            const prior = this.settings.chat.wallet.journal.find(r => r.id === key);
            if (prior && (prior.action !== state || prior.actor !== actor)) return thread;
            if (prior?.status === 'done') {
                if (m.state === 'sent') { thread = await this.chats.updateMessage(threadId, messageId, {state: prior.action, openedBy: prior.actor}); this.emit('chat', {threadId}); }
                return thread;
            }
            if (!prior && m.state !== 'sent') return thread;
            if (!prior) {
                const next = this.getState(), w = next.chat.wallet;
                this.walletJournalSlot(w);
                const back = state === 'returned' ? walletAmount(m.kind === 'gift' ? m.gift.price : m.amount, {legacy: true}) : 0;
                // Imported story cards are observations, not proof that this wallet actually paid the amount.
                if (back && m.source && !w.journal.some(r => r.id === 'send:' + m.paymentId && r.status === 'done')) throw Error('這筆劇情付款沒有靈石袋扣款記錄，不能再次退款');
                if (back) this.walletEntry(w, back, {kind: 'refund', note: m.kind === 'gift' ? m.gift.name : m.text, who: actor, id: key});
                w.journal.push({id: key, flow: 'claim', status: 'pending', at: Date.now(), amount: back, threadId, messageId, actor, action: state, notice: false});
                this.walletCommit(next);
            }
            if (m.state === 'sent') thread = await this.chats.updateMessage(threadId, messageId, {state, openedBy: actor});
            const paymentId = 'notice:' + key, gift = m.kind === 'gift';
            const text = {opened: '领取了{对方}的红包', accepted: gift ? '收下了{对方}的礼物' : '收下了{对方}的转账', returned: gift ? '退还了{对方}的礼物' : '退还了{对方}的转账'}[state];
            if (!thread.messages.some(x => x.paymentId === paymentId)) thread = await this.chats.append(threadId, [{from: actor, kind: 'notice', target: 'me', text, paymentId}]);
            const next = this.getState(), entry = next.chat.wallet.journal.find(r => r.id === key);
            entry.status = 'done'; entry.notice = true;
            this.walletCommit(next);
            this.emit('chat', {threadId});
            return thread;
        });
    }
    /** Resume interrupted model settlements before reading/generating another phone reply. */
    async resumeWalletClaims(threadId) {
        const pending = this.wallet().journal.filter(r => r.flow === 'claim' && r.status === 'pending' && r.threadId === threadId);
        for (const row of pending) await this.settleSent(threadId, row.messageId, row.actor, row.action === 'returned' ? 'return' : 'accept');
    }

    // ---------- 保存到酒馆 ----------
    /** The tavern's user files: {read(name, {blob}), write(name, data), remove(name)}. Without it, syncing is off. */
    setSyncFiles(files) { this.syncFiles = files; }
    #syncMemory(value) {
        const key = 'st-iphonie-sync:' + this.settings.scope;
        try {
            const storage = this.syncStorage();
            if (value === undefined) return JSON.parse(storage?.getItem(key) || 'null') || {};
            storage?.setItem(key, JSON.stringify(value));
        } catch { /* private window: this device starts from the tavern's copy again next time */ }
        return {};
    }
    #device() {
        try {
            const storage = this.syncStorage();
            let id = storage?.getItem('st-iphonie-device');
            if (!id) { id = crypto.randomUUID(); storage?.setItem('st-iphonie-device', id); }
            return id;
        } catch { return 'unknown'; }
    }
    syncStatus() {
        const { running, ...state } = this.syncState;
        return clone({ enabled: this.settings.sync.enabled, available: !!this.syncFiles, parts: SYNC_PARTS, ...state, memoryAt: this.#syncMemory().savedAt || 0 });
    }
    saveSync(patch) {
        const next = this.getState();
        next.sync = normalizeSync({ ...next.sync, ...(patch || {}) });
        const saved = this.save(next).sync;
        if (saved.enabled) this.scheduleSync(200);
        return saved;
    }
    /** Syncs soon (changes come in bursts: a chat reply is several writes). */
    scheduleSync(delay = 4000) {
        if (!this.settings.sync.enabled || !this.syncFiles || this.closed) return;
        clearTimeout(this.syncTimer);
        this.syncState.pending = true;
        this.syncTimer = setTimeout(() => { this.syncNow().catch(() => {}); }, delay);
    }
    /** One sync with the tavern: takes what changed there, writes what changed here. */
    async syncNow({ deviceName = '' } = {}) {
        this.assertOpen();
        if (!this.syncFiles) throw Error('在酒館裡開啟傳音玉符時才能儲存到酒館');
        if (this.syncState.busy) return this.syncState.running;
        clearTimeout(this.syncTimer);
        const stores = {
            read: async part => part === 'chats' ? this.chats.exportThreads() : part === 'moments' ? this.moments.exportPosts() : (await this.library.exportRows([part]))[part],
            write: async (part, items, options) => {
                if (part === 'chats') await this.chats.importThreads(items, options);
                else if (part === 'moments') await this.moments.importPosts(items, options);
                else await this.library.importRows({ [part]: items }, options);
            },
            photoBlob: row => row.blob,
        };
        this.syncState = { ...this.syncState, busy: true, pending: false, error: '' };
        this.emit('sync', this.syncStatus());
        this.syncState.running = (async () => {
            try {
                this.syncApplying = true;
                const result = await runSync({ stores, files: this.syncFiles, memory: this.#syncMemory(), device: this.#device(), deviceName: deviceName || this.syncDeviceName || '' });
                this.#syncMemory(result.memory);
                this.syncState = { ...this.syncState, busy: false, error: '', lastAt: Date.now(), remote: result.remote, lastResult: { pulled: result.pulled, pushed: result.pushed, merged: result.merged } };
                for (const part of [...result.pulled, ...result.merged]) {
                    if (part === 'chats') this.emit('chat', { threadId: '' });
                    else if (part === 'moments') this.emit('moments', {});
                    else this.emit('library', { collection: part });
                }
                if ([...result.pulled, ...result.merged].includes('photos')) this.emit('phone', { preferences: await this.getPhone() });
                return clone(result);
            } catch (error) {
                this.syncState = { ...this.syncState, busy: false, error: error.message || '同步失败' };
                throw error;
            } finally {
                this.syncApplying = false;
                delete this.syncState.running;
                this.emit('sync', this.syncStatus());
            }
        })();
        return this.syncState.running;
    }

    // ---------- 文字模型 ----------
    /** Text model options: {source:'tavern'|'custom', url, model, temperature, maxTokens}. */
    /** The text settings with a change applied: presets, active and source as given; url, model, temperature, maxTokens and name edit the preset in use. */
    textWith(patch) {
        const p = patch && typeof patch === 'object' ? patch : {};
        const text = normalizeText({ ...this.settings.text, ...Object.fromEntries(['source', 'active', 'presets'].filter(key => key in p).map(key => [key, clone(p[key])])) });
        const active = text.presets.find(x => x.id === text.active);
        for (const key of ['name', 'url', 'model', 'temperature', 'maxTokens']) if (key in p) active[key] = p[key];
        return normalizeText(text);
    }
    saveText(patch) {
        const next = this.getState();
        next.text = this.textWith(patch);
        // A deleted preset takes its key with it.
        const ids = new Set(next.text.presets.map(x => x.id)), kept = new Map([...this.textKeys].filter(([id]) => ids.has(id)));
        const saved = this.save(next).text;
        if (kept.size !== this.textKeys.size) this.storeTextKeys(kept);
        return saved;
    }
    /**
     * Writes phone text (chat, 朋友圈, calls, picture plans) with the chosen model. context: the tavern context, used
     * when the source is the tavern's model. request: {prompt, responseLength?, ...} as for generateRaw.
     */
    async generateText(context, request) {
        const text = activeText(this.settings.text);
        if (text.source === 'custom') return customRequest({ text, key: this.textKeys.get(text.id) || '', prompt: request.prompt, responseLength: request.responseLength });
        if (!context?.generateRaw) throw Error('當前酒館版本不支援後臺生成');
        // The chat-completion request the tavern builds is kept, so an empty answer can be asked again as a stream:
        // "假流式" channels only answer streamed requests, and the tavern's background generation never streams.
        const source = context.eventSource, event = context.eventTypes?.CHAT_COMPLETION_SETTINGS_READY, last = JSON.stringify(asMessages(request.prompt).at(-1)?.content ?? '');
        let payload = null;
        const keep = data => { if (!payload && data?.type === 'quiet' && JSON.stringify(data.messages?.at?.(-1)?.content ?? '') === last) payload = clone(data); };
        if (source?.on && event) source.on(event, keep);
        let empty = false;
        try {
            const text = await context.generateRaw(request);
            if (String(text ?? '').trim() || !payload) return text;
            empty = true;
        } catch (error) {
            if (!payload || !/no message generated|empty/i.test(String(error?.message || ''))) throw error;
            empty = true;
        } finally { source?.removeListener?.(event, keep); }
        if (empty) return this.streamTavern(context, payload);
    }
    /** Sends the tavern's chat-completion request again with streaming on, and reads the whole answer. */
    async streamTavern(context, payload) {
        if (typeof context.getRequestHeaders !== 'function') throw Error('模型沒有返回內容');
        let response;
        try { response = await fetch('/api/backends/chat-completions/generate', { method: 'POST', headers: context.getRequestHeaders(), cache: 'no-cache', body: JSON.stringify({ ...payload, stream: true }) }); }
        catch { throw Error('模型沒有返回內容，改用流式請求也沒連上'); }
        if (!response.ok) throw Error(`模型沒有返回內容，改用流式請求也失敗了（HTTP ${response.status}）`);
        const text = await streamText(response);
        if (!text.trim()) throw Error('模型沒有返回內容（普通請求和流式請求都試過了）');
        return text;
    }
    /** Model ids of the custom API (also a free connection check). `draft`: options not saved yet. */
    textModels(draft) { const text = activeText(this.textWith(draft)); return listModels({ text, key: this.textKeys.get(text.id) || '' }); }

    // ---------- Drawing ----------
    saveDraw(patch) {
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Error('繪圖設定格式無效');
        const next = this.getState(), draw = next.draw;
        if ('queue' in patch) draw.queue = normalizeDraw({ queue: { ...draw.queue, ...clone(patch.queue) } }).queue;
        for (const key of ['enabled', 'auto', 'guard', 'fold', 'strip']) if (key in patch) { if (typeof patch[key] !== 'boolean') throw Error('開關設定無效'); draw[key] = patch[key]; }
        if ('mode' in patch) { if (!['separate', 'inline'].includes(patch.mode)) throw Error('配圖方式無效'); draw.mode = patch.mode; }
        if ('vibe' in patch) draw.vibe = normalizeVibeSettings({ ...draw.vibe, ...clone(patch.vibe || {}) });
        if ('relay' in patch) {
            const relay = patch.relay && typeof patch.relay === 'object' ? patch.relay : {};
            draw.relay = { url: 'url' in relay ? relayUrl(relay.url) : draw.relay.url, assumeOpus: 'assumeOpus' in relay ? !!relay.assumeOpus : draw.relay.assumeOpus };
            this.subscription = null;
        }
        if ('params' in patch) draw.params = normalizeDrawParams({ ...draw.params, ...clone(patch.params) });
        if ('engine' in patch) { if (!DRAW_ENGINES.includes(patch.engine)) throw Error('繪圖引擎無效'); draw.engine = patch.engine; }
        if ('gpt' in patch) {
            const g = patch.gpt && typeof patch.gpt === 'object' ? clone(patch.gpt) : {};
            if ('url' in g) g.url = gptBase(g.url);
            if ('model' in g && !/^[\w.:/-]{1,80}$/.test(String(g.model).trim())) throw Error('模型名稱無效');
            draw.gpt = normalizeGpt({ ...draw.gpt, ...g });
        }
        if ('comfy' in patch) {
            const c = patch.comfy && typeof patch.comfy === 'object' ? clone(patch.comfy) : {};
            if ('url' in c) c.url = comfyUrl(c.url);
            if ('workflow' in c) c.workflow = checkWorkflow(c.workflow);
            draw.comfy = normalizeComfy({ ...draw.comfy, ...c });
        }
        // The 画风 picked belongs to the engine in use.
        if ('activeStyle' in patch) { if (!draw.styles.some(s => s.id === patch.activeStyle)) throw Error('畫風預設不存在'); if (draw.engine === 'nai') draw.activeStyle = patch.activeStyle; else draw[draw.engine].style = patch.activeStyle; }
        if ('activePreset' in patch) { if (!draw.presets.some(p => p.id === patch.activePreset)) throw Error('繪圖預設不存在'); draw.activePreset = patch.activePreset; }
        this.save(next);
        return clone(this.settings.draw);
    }
    saveStyle(value) {
        if (!value || typeof value !== 'object' || !String(value.name || '').trim()) throw Error('請填寫畫風名稱');
        const next = this.getState(), style = { id: value.id || crypto.randomUUID(), name: String(value.name).trim(), artist: String(value.artist || ''), positive: String(value.positive || ''), negative: String(value.negative || '') };
        const index = next.draw.styles.findIndex(s => s.id === style.id);
        if (index < 0) next.draw.styles.push(style); else next.draw.styles[index] = style;
        this.save(next);
        return clone(this.settings.draw.styles.find(s => s.id === style.id));
    }
    deleteStyle(id) {
        const next = this.getState();
        if (next.draw.styles.length === 1) throw Error('請至少保留一個畫風預設');
        next.draw.styles = next.draw.styles.filter(s => s.id !== id);
        return this.save(next).draw;
    }
    saveDrawPreset(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('繪圖預設格式無效');
        // What is saved is what the user wrote: no entries are added to it as to a preset from an older version.
        const next = this.getState(), preset = normalizeDraw({ presets: [{ ...clone(value), id: value.id || crypto.randomUUID(), rev: DRAW_PRESET_REV }] }).presets[0];
        validateDrawPreset(preset);
        const index = next.draw.presets.findIndex(p => p.id === preset.id);
        if (index < 0) next.draw.presets.push(preset); else next.draw.presets[index] = preset;
        this.save(next);
        return clone(preset);
    }
    deleteDrawPreset(id) {
        const next = this.getState();
        if (next.draw.presets.length === 1) throw Error('請至少保留一個繪圖預設');
        next.draw.presets = next.draw.presets.filter(p => p.id !== id);
        return this.save(next).draw;
    }
    previewDrawPrompt(preset) {
        const draft = preset ? normalizeDraw({ presets: [clone(preset)] }).presets[0] : null;
        if (draft) validateDrawPreset(draft);
        const draw = this.settings.draw, used = draft || draw.presets.find(p => p.id === draw.activePreset) || draw.presets[0];
        // 'separate' mode: the request made after a reply, with a stand-in for the reply.
        if (draw.mode === 'separate') return planRequest(this.settings, { message: '（这里是刚写好的正文，第一段）\n（第二段……每一段前面会标上 [P1]、[P2]）', preset: used })
            .map(m => `【${m.role}】\n${m.content}`).join('\n\n');
        return drawPromptPlan(this.settings, used).map(entry => entry.text).join('\n\n');
    }
    async naiSubscription(refresh = false) {
        this.assertOpen();
        if (!this.novelai.configured) return null;
        if (!refresh && this.subscription && Date.now() - this.subscription.checkedAt < 10 * 60 * 1000) return clone(this.subscription);
        this.novelai.relay = this.settings.draw.relay.url;
        this.subscription = await this.novelai.subscription();
        this.emit('draw', { subscription: this.subscription });
        return clone(this.subscription);
    }
    /**
     * The relay (or NovelAI itself) checked from the phone: the drawing route by an empty request that draws nothing,
     * and the subscription. {relay, draw: {ok, status}, subscription: {ok, tier} | {ok: false, status, message}}.
     */
    async naiProbe() {
        this.assertOpen();
        if (!this.novelai.configured) throw Error('還沒有填寫 NovelAI 金鑰');
        this.novelai.relay = this.settings.draw.relay.url;
        const draw = await this.novelai.probe();
        let subscription;
        try { const s = await this.naiSubscription(true); subscription = { ok: true, tier: s.tier }; }
        catch (error) { subscription = { ok: false, status: error.status || 0, message: error.message }; }
        return { relay: !!this.settings.draw.relay.url, draw, subscription };
    }
    /** Whether params cost Anlas. free: true (covered), false (costs Anlas), null (subscription unknown). */
    drawQuote(params, engine = this.settings.draw.engine) {
        if (engine !== 'nai') return this.engineQuote(engine, params);
        const requested = normalizeDrawParams(params || this.settings.draw.params);
        const effective = this.settings.draw.guard ? guardParams(requested) : requested;
        // Through a relay that does not pass the subscription on, the user may say the account is Opus: small non-V5 images count as free.
        const relay = this.settings.draw.relay, subscription = this.subscription || (relay.url && relay.assumeOpus ? { unlimited: true, active: true, usage: null, assumed: true } : null);
        // Vibes: encoding one (first use) and every vibe past four cost Anlas, so such a picture is not free.
        const vibes = this.vibePlan(effective.model), vibeAnlas = (vibes.encode + vibes.extra) * VIBE_ANLAS, free = isFree(effective, subscription);
        return { params: effective, clamped: JSON.stringify(effective) !== JSON.stringify(requested), free: vibeAnlas && free !== false ? false : free, guard: this.settings.draw.guard,
            v5: isV5(effective.model), usage: this.subscription?.usage ? clone(this.subscription.usage) : null, vibes, vibeAnlas };
    }
    // ---------- Vibes ----------
    async loadVibes() { const rows = await this.library.listVibes(); this.vibes = new Map(rows.map(row => [row.id, { ...row.meta, id: row.id, name: row.name }])); }
    listVibes() { return [...this.vibes.values()].map(clone); }
    async vibeDoc(id) {
        const row = await this.library.getVibe(id);
        if (!row) throw Error('這個 Vibe 已經不在了');
        try { return JSON.parse(await row.blob.text()); } catch { throw Error('這個 Vibe 的資料壞了，請刪掉重新匯入'); }
    }
    async storeVibe(doc) {
        if (!doc.thumbnail && doc.image) { const thumb = await vibeThumbnail(doc.image); if (thumb) doc = { ...doc, thumbnail: thumb }; }
        const summary = vibeSummary(doc);
        await this.library.saveVibe({ id: doc.id, name: doc.name, meta: summary, blob: new Blob([JSON.stringify(doc)], { type: 'application/json' }) });
        this.vibes.set(doc.id, summary);
        return summary;
    }
    /**
     * Imports vibe files (.naiv4vibe, .naiv4vibebundle, 智绘姬 exports) and pictures. A vibe already saved gains what it
     * lacked (encodings, image); groups in the files become groups here. names: a vibe already saved also takes the name
     * 智绘姬 gives it (importing from 智绘姬 again). {added, updated, renamed, groups, errors: [{name, message}]}.
     */
    async importVibes(files, { names = false } = {}) {
        this.assertOpen();
        const result = { added: 0, updated: 0, renamed: 0, groups: 0, errors: [] }, groups = [];
        for (const file of [...(files || [])]) {
            const name = String(file?.name || 'vibe');
            try {
                const picture = /^image\//.test(file.type || '') && !/\.naiv4vibe/i.test(name) || /\.(png|jpe?g|webp|avif|gif)$/i.test(name) && !/\.naiv4vibe/i.test(name);
                const found = picture ? { vibes: [await imageVibe(name, await this.base64(file))], groups: [] } : await readVibeFile(name, await file.text());
                for (const doc of found.vibes) {
                    if (this.vibes.has(doc.id)) {
                        const merged = mergeVibe(await this.vibeDoc(doc.id), doc);
                        if (names && found.named?.includes(doc.id) && merged.name !== doc.name) { merged.name = doc.name; result.renamed++; }
                        await this.storeVibe(merged); result.updated++;
                    }
                    else { await this.storeVibe(doc); result.added++; }
                }
                groups.push(...found.groups);
            } catch (error) { result.errors.push({ name, message: error.message }); }
        }
        if (groups.length) {
            const next = this.getState(), taken = new Set(next.draw.vibe.groups.map(g => g.name));
            for (const group of groups) {
                const same = next.draw.vibe.groups.some(g => g.name === group.name && JSON.stringify(g.items.map(i => [i.vibe, i.strength])) === JSON.stringify(group.items.map(i => [i.id, i.strength])));
                if (same) continue;
                // A group of that name left empty (its vibes were deleted, to import them again): fill it rather than make a copy.
                const empty = next.draw.vibe.groups.find(g => g.name === group.name && !g.items.length);
                if (empty) { empty.items = group.items.map(i => ({ vibe: i.id, strength: i.strength })); result.groups++; continue; }
                let name = group.name, n = 1;
                while (taken.has(name)) name = `${group.name} (${++n})`;
                taken.add(name);
                next.draw.vibe.groups.push({ id: crypto.randomUUID(), name, items: group.items.map(i => ({ vibe: i.id, strength: i.strength })) });
                result.groups++;
            }
            next.draw.vibe = normalizeVibeSettings(next.draw.vibe);
            this.save(next);
        }
        this.emit('draw', { vibes: true });
        return result;
    }
    /** Renames a vibe or sets its own strength (used when it is used alone, and as the default when added to a group). */
    async updateVibe(id, patch = {}) {
        const doc = await this.vibeDoc(id);
        if ('name' in patch) { const name = String(patch.name || '').trim().slice(0, 80); if (!name) throw Error('請填寫 Vibe 名字'); doc.name = name; }
        if ('strength' in patch) doc.importInfo.strength = vibeStrength(patch.strength, doc.importInfo.strength);
        const summary = await this.storeVibe(doc);
        this.emit('draw', { vibes: true });
        return clone(summary);
    }
    /** Deletes a vibe, and takes it out of every group (and out of use). */
    async deleteVibe(id) { await this.deleteVibes([id]); }
    /** Deletes several vibes at once (one save, one redraw). Returns how many were deleted. */
    async deleteVibes(ids) {
        this.assertOpen();
        const gone = new Set([...(ids || [])].map(String).filter(id => this.vibes.has(id)));
        for (const id of gone) { await this.library.deleteVibe(id); this.vibes.delete(id); }
        const next = this.getState(), v = next.draw.vibe;
        for (const group of v.groups) group.items = group.items.filter(item => !gone.has(item.vibe));
        if (v.use.kind === 'vibe' && gone.has(v.use.id)) v.use = { kind: '', id: '' };
        this.save(next);
        this.emit('draw', { vibes: true });
        return gone.size;
    }
    /** A file to save: {vibe: id} → .naiv4vibe; {group: id} → .naiv4vibebundle; {all: true} → everything, in the 智绘姬 form. */
    async exportVibes(target = {}) {
        const safe = name => String(name).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'vibe';
        if (target.vibe) { const doc = await this.vibeDoc(target.vibe); // Not marked as JSON: saving would add .json after .naiv4vibe.
            return { name: safe(doc.name) + '.naiv4vibe', blob: new Blob([singleFile(doc)], { type: 'application/octet-stream' }) }; }
        if (target.group) {
            const group = this.settings.draw.vibe.groups.find(g => g.id === target.group);
            if (!group) throw Error('這個 Vibe 組已經不在了');
            const entries = [];
            for (const item of group.items) if (this.vibes.has(item.vibe)) entries.push({ doc: await this.vibeDoc(item.vibe), strength: item.strength });
            if (!entries.length) throw Error('這個組裡沒有 Vibe');
            return { name: safe(group.name) + '.naiv4vibebundle', blob: new Blob([bundleFile(entries)], { type: 'application/octet-stream' }) };
        }
        const docs = new Map();
        for (const id of this.vibes.keys()) docs.set(id, await this.vibeDoc(id));
        if (!docs.size) throw Error('還沒有 Vibe');
        const groups = this.settings.draw.vibe.groups.map(g => ({ name: g.name, items: g.items.map(i => ({ id: i.vibe, strength: i.strength })) }));
        return { name: `vibes-${new Date().toISOString().slice(0, 10)}.json`, blob: new Blob([chatu8File(groups, docs)], { type: 'application/json' }) };
    }
    /**
     * The vibes a picture with this model would use (see VibePlan in ui/backend-client.d.ts). The free-tier guard keeps
     * the first four; a vibe without an encoding for the model is encoded first (2 Anlas), or left out without a picture.
     */
    vibePlan(model) {
        const v = this.settings.draw.vibe, empty = { on: false, model: !!vibeKey(model), used: [], skipped: [], over: 0, encode: 0, extra: 0 };
        if (!v.enabled || !v.use.kind) return empty;
        const items = v.use.kind === 'group' ? (v.groups.find(g => g.id === v.use.id)?.items || []).map(i => ({ id: i.vibe, strength: i.strength }))
            : [{ id: v.use.id, strength: this.vibes.get(v.use.id)?.strength ?? 0.6 }];
        const key = vibeKey(model), used = [], skipped = [];
        for (const item of items) {
            const s = this.vibes.get(item.id);
            if (!s) { skipped.push({ name: '已删除的 Vibe', why: 'missing' }); continue; }
            if (!key) { skipped.push({ name: s.name, why: 'model' }); continue; }
            const encoded = s.keys.includes(key);
            if (!encoded && !s.image) { skipped.push({ name: s.name, why: 'no-encoding' }); continue; }
            used.push({ id: item.id, name: s.name, strength: item.strength, encode: !encoded });
        }
        const over = this.settings.draw.guard ? Math.max(0, used.length - MAX_FREE_VIBES) : 0;
        if (over) used.length = MAX_FREE_VIBES;
        return { on: true, model: !!key, used, skipped, over, encode: used.filter(u => u.encode).length, extra: Math.max(0, used.length - MAX_FREE_VIBES) };
    }
    /** The encodings to send, encoding (and keeping) those missing for the model first. */
    async vibeEncodings(used, model, signal) {
        const key = vibeKey(model), list = [];
        for (const u of used) {
            let doc = await this.vibeDoc(u.id), encoding = encodingFor(doc, key);
            if (!encoding) {
                this.novelai.relay = this.settings.draw.relay.url;
                encoding = await this.novelai.encodeVibe(doc.image, model, doc.importInfo.information_extracted, signal);
                doc = await withEncoding(doc, key, doc.importInfo.information_extracted, encoding);
                await this.storeVibe(doc);
                if (this.subscription) this.subscription.checkedAt = 0;
                this.emit('draw', { vibes: true });
            }
            list.push({ encoding, strength: u.strength });
        }
        return list;
    }
    /** GPT and ComfyUI: GPT costs money on every picture (asked first unless 每张先问 is off); ComfyUI is the user's own. */
    engineQuote(engine, params) {
        const draw = this.settings.draw, orientation = orientationOf(Number(params?.width), Number(params?.height));
        const none = { on: false, model: false, used: [], skipped: [], over: 0, encode: 0, extra: 0 };
        if (engine === 'gpt') {
            const size = gptSize(draw.gpt.model, orientation || draw.gpt.orientation), [width, height] = size.split('x').map(Number);
            return { engine, params: { model: draw.gpt.model, width, height, seed: -1 }, clamped: false, free: draw.gpt.ask ? false : true, paid: true, guard: false, v5: false, usage: null, vibes: none, vibeAnlas: 0 };
        }
        const c = draw.comfy, size = comfySize(c, orientation || orientationOf(c.width, c.height));
        return { engine, params: { model: c.model, ...size, steps: c.steps, scale: c.scale, sampler: c.sampler, seed: Number.isInteger(params?.seed) && params.seed >= 0 ? params.seed : -1 }, clamped: false, free: true, guard: false, v5: false, usage: null, vibes: none, vibeAnlas: 0 };
    }
    /** Whether pictures can be drawn with the engine in use; drawMissing() says what is missing. */
    drawReady(engine = this.settings.draw.engine) { return engine === 'nai' ? this.novelai.configured : engine === 'gpt' ? !!this.gptKey : !!this.settings.draw.comfy.url; }
    /** What to ask before a picture that costs money, for the engine in use: {title, text, note}. */
    paidPrompt() { return this.settings.draw.engine === 'gpt' ? { title: 'GPT 生图要花钱', text: '每张图都按 OpenAI（或中转）的价格收费，确认后再画。', note: 'GPT 生图要花钱，点一下确认后再画' } : { title: '这张图会扣 Anlas', text: '超出了 NovelAI 的免费档，确认后再画。', note: '这张图会扣 Anlas，点一下确认后再画' }; }
    drawMissing(engine = this.settings.draw.engine) { return this.drawReady(engine) ? '' : engine === 'gpt' ? '还没有填写 GPT 生图的密钥' : engine === 'comfy' ? '还没有填写 ComfyUI 地址' : '还没有填写 NovelAI 密钥'; }
    /** ComfyUI: connection check and what it offers (models, samplers, schedulers). url: an address not saved yet. */
    async comfyCatalog(url) { this.assertOpen(); return comfyCatalog({ fetch: this.imageFetch, headers: this.tavernHeaders(), url: comfyUrl(url ?? this.settings.draw.comfy.url) }); }
    async comfyWorkflows() { this.assertOpen(); return tavernWorkflows({ fetch: this.imageFetch, headers: this.tavernHeaders() }); }
    async comfyWorkflow(name) { this.assertOpen(); return tavernWorkflow({ fetch: this.imageFetch, headers: this.tavernHeaders(), name: String(name || '') }); }
    /** Draws with GPT or ComfyUI. Inputs are the NovelAI-shaped picture (scene prompt, one caption per person). */
    async drawWithEngine(engine, { prompt, negative, characters, quote, signal }) {
        const draw = this.settings.draw, p = quote.params;
        if (engine === 'gpt') {
            const text = gptPrompt({ prompt, characters });
            const blob = await gptGenerate({ fetch: this.imageFetch, settings: draw.gpt, key: this.gptKey, prompt: text, size: `${p.width}x${p.height}`, signal });
            return { blob, seed: -1, params: { model: draw.gpt.model, width: p.width, height: p.height }, prompt: text };
        }
        const c = draw.comfy, seed = p.seed >= 0 ? p.seed : Math.floor(Math.random() * 4294967295);
        const text = comfyPrompt({ prompt, negative, characters });
        const workflow = fillWorkflow(c.workflow, comfyValues(c, { prompt: text.prompt, negative: text.negative, width: p.width, height: p.height, seed }));
        const blob = await comfyGenerate({ fetch: this.imageFetch, headers: this.tavernHeaders(), url: c.url, workflow, signal });
        return { blob, seed, params: { model: c.model || '工作流', width: p.width, height: p.height, steps: c.steps, scale: c.scale, sampler: c.sampler }, prompt: text.prompt };
    }
    /** Generates one image and keeps it in the album. Requests wait in the NovelAI queue (see draw-queue.js).
     *  key identifies the job in the queue (the same key joins the job already waiting); label is shown in the line. */
    generateImage({ prompt, negative = '', characters = [], params, allowPaid = false, name = '', key, label = '', engine = this.settings.draw.engine, beforeGenerate = null } = {}) {
        this.assertOpen();
        if (!String(prompt || '').trim()) return Promise.reject(Error('請先寫提示詞'));
        if (!DRAW_ENGINES.includes(engine)) return Promise.reject(Error('繪圖引擎無效'));
        if (!this.drawReady(engine)) return Promise.reject(Error(this.drawMissing(engine)));
        const quote = this.drawQuote(params, engine);
        if (engine !== 'nai') {
            if (quote.free === false && !allowPaid) return Promise.reject(Object.assign(Error('GPT 生圖每張都要花錢，需要確認後再生成'), { code: 'PAID' }));
            const job = this.drawQueue.add({ key, engine, label: label || String(prompt).slice(0, 40), task: async signal => {
                this.assertOpen();
                if (typeof beforeGenerate === 'function') await beforeGenerate();
                this.emit('draw', { phase: 'generating' });
                const made = await this.drawWithEngine(engine, { prompt, negative, characters, quote, signal });
                this.assertOpen();
                const ext = made.blob.type === 'image/jpeg' ? 'jpg' : made.blob.type === 'image/webp' ? 'webp' : 'png';
                const photo = await this.library.addPhoto({ name: (name || DRAW_ENGINE_NAMES[engine]) + '-' + (made.seed >= 0 ? made.seed : Date.now()) + '.' + ext, blob: made.blob });
                this.emit('library', { collection: 'photos' });
                this.emit('draw', { phase: 'done' });
                return { photoId: photo.id, seed: made.seed, params: made.params, prompt: made.prompt, engine, blob: made.blob };
            } });
            job.catch(error => { this.emit('draw', { phase: error.cancelled ? 'cancelled' : 'error', message: error.message }); });
            return job;
        }
        if (quote.free === false && !allowPaid) return Promise.reject(Object.assign(Error('這張圖會扣 Anlas，需要確認後再生成'), { code: 'PAID' }));
        const request = buildImageRequest({ prompt, negative, characters, params: quote.params });
        const job = this.drawQueue.add({ key, engine, label: label || String(prompt).slice(0, 40), task: async signal => {
            this.assertOpen();
            if (typeof beforeGenerate === 'function') await beforeGenerate();
            this.emit('draw', { phase: 'generating' });
            if (quote.vibes.used.length) Object.assign(request.body.parameters, vibeParameters(await this.vibeEncodings(quote.vibes.used, request.params.model, signal)));
            this.novelai.relay = this.settings.draw.relay.url;
            const blob = await this.novelai.generate(request.body, signal);
            this.assertOpen();
            const photo = await this.library.addPhoto({ name: (name || 'NovelAI') + '-' + request.seed + '.png', blob });
            this.emit('library', { collection: 'photos' });
            this.emit('draw', { phase: 'done' });
            // Paid images change the Anlas balance and V5 images use up the allowance: read the subscription again next time.
            if (this.subscription && (quote.free === false || isV5(request.params.model))) this.subscription.checkedAt = 0;
            return { photoId: photo.id, seed: request.seed, params: request.params, prompt: request.body.input, engine: 'nai', blob };
        } });
        job.catch(error => { this.emit('draw', { phase: error.cancelled ? 'cancelled' : 'error', message: error.message }); });
        return job;
    }
    // ---------- Chat ----------
    /** The voice tag format used for voice messages: the active voice preset's format. */
    voiceFormat() { return (this.settings.presets.find(p => p.id === this.settings.activePreset) || this.settings.presets[0]).format || DEFAULT_FORMAT; }
    saveChatPreset(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('聊天預設格式無效');
        const next = this.getState(), preset = validateChatPreset(normalizeChatPreset({ ...clone(value), id: value.id || crypto.randomUUID() }));
        const index = next.chat.presets.findIndex(p => p.id === preset.id);
        if (index < 0) next.chat.presets.push(preset); else next.chat.presets[index] = preset;
        this.save(next);
        return clone(preset);
    }
    deleteChatPreset(id) {
        const next = this.getState();
        if (next.chat.presets.length === 1) throw Error('請至少保留一個聊天預設');
        next.chat.presets = next.chat.presets.filter(p => p.id !== id);
        return this.save(next).chat;
    }
    selectChatPreset(id) {
        const next = this.getState();
        if (!next.chat.presets.some(p => p.id === id)) throw Error('聊天預設不存在');
        next.chat.activePreset = id;
        return this.save(next).chat;
    }
    saveContact(value) {
        const next = this.getState(), draft = clone(value || {});
        // An explicit re-add is allowed to restore a voice role. Automatic
        // narrative imports are filtered before they reach this method.
        const name = String(draft.name || '').trim();
        if (isContactDeleted(next.chat, name) && next.routes.some(route => route.name === name)) {
            next.chat = restoreContactRecord(next.chat, name, {roleNames: next.routes.map(route => route.name)});
            this.save(next); this.emit('chat', {contacts: true});
            return clone(this.contacts().find(contact => contact.name === name) || {name, source: 'role'});
        }
        const contact = validateContact(normalizeContact(draft), next.routes);
        if (next.chat.contacts.some(c => c.name === contact.name && c.id !== contact.id)) throw Error('已經有同名的聯絡人');
        const index = next.chat.contacts.findIndex(c => c.id === contact.id);
        if (index < 0 && next.chat.contacts.length >= 200) throw Error('聯絡人已達 200 人，請先整理聯絡人。');
        if (index < 0 && this.spaceKey()) contact.space = this.spaceKey();
        if (index >= 0 && next.chat.contacts[index].space) contact.space = next.chat.contacts[index].space;
        if (index < 0) next.chat.contacts.push(contact); else next.chat.contacts[index] = contact;
        next.chat.deletedContacts = (next.chat.deletedContacts || []).filter(row => row.name !== contact.name);
        this.save(next);
        this.emit('chat', {contacts: true});
        return clone(contact);
    }
    /** Phone chat options: {voiceText: {mode, auto}, profile: {name, status, statusText, signature, bubble, frame, background, backgroundPhoto}, starred: [name]}. */
    saveChatOptions(patch) {
        const next = this.getState();
        if (patch?.voiceText) next.chat.voiceText = normalizeVoiceText({ ...next.chat.voiceText, ...patch.voiceText });
        if (patch?.profile) {
            // A look from the shop goes on only once it is bought.
            for (const kind of ['bubble', 'frame', 'background']) if (patch.profile[kind] && premiumOf(kind, patch.profile[kind]) && !next.chat.wallet.owned.includes(decorKey(kind, patch.profile[kind]))) throw Error('這件裝扮還沒買：先在商城裡買下');
            next.chat.profile = normalizeProfile({ ...next.chat.profile, ...patch.profile });
        }
        if (Array.isArray(patch?.starred)) next.chat.starred = patch.starred;
        if (patch?.partition !== undefined) { if (!['none', 'card'].includes(patch.partition)) throw Error('分割槽方式無效'); next.chat.partition = patch.partition; }
        // avatars: {name: choice | null}; null goes back to the tavern's avatar (or the first letter).
        if (patch?.avatars && typeof patch.avatars === 'object') { const merged = { ...next.chat.avatars }; for (const [name, a] of Object.entries(patch.avatars)) { if (a) merged[name] = a; else delete merged[name]; } next.chat.avatars = normalizeAvatars(merged); }
        return this.save(next).chat;
    }
    deleteContact(idOrName) {
        const next = this.getState();
        const manual = next.chat.contacts.find(contact => contact.id === idOrName || contact.name === idOrName);
        const name = manual?.name || next.routes.find(route => route.name === idOrName)?.name
            || this.contacts().find(contact => contact.name === idOrName)?.name
            || (next.chat.deletedContacts || []).find(contact => contact.name === idOrName || contact.contact?.id === idOrName)?.name;
        if (!name) throw Error('找不到這位聯絡人，請重新開啟聯絡簿。');
        next.chat = forgetContact(next.chat, name);
        const result = this.save(next).chat;
        this.emit('chat', {contacts: true, deletedContact: name});
        return result;
    }
    restoreContact(name) {
        const next = this.getState();
        next.chat = restoreContactRecord(next.chat, name, {roleNames: next.routes.map(route => route.name)});
        const result = this.save(next).chat;
        this.emit('chat', {contacts: true, restoredContact: name});
        return result;
    }
    previewChatPrompt(preset) {
        const p = validateChatPreset(normalizeChatPreset(clone(preset || activeChatPreset(this.settings.chat))));
        const contact = chatContacts(this.settings)[0] || { name: '联系人', persona: '', voice: false };
        const thread = { type: 'dm', name: contact.name, members: [contact.name], messages: [{ from: 'me', kind: 'text', text: '（这里是手机里的聊天记录）' }] };
        const member = { ...contact, card: contact.persona ? '' : '（酒馆角色卡里的设定）' }, story = [{ name: '（最近的剧情）', text: '……' }], text = request => request.map(m => `【${m.role}】\n${m.content}`).join('\n\n');
        const other = { name: '另一位联系人', persona: '', card: '（酒馆角色卡里的设定）', voice: false };
        const group = { type: 'group', name: '群聊', members: [contact.name, other.name], messages: thread.messages };
        const lore = p.lore !== false ? '（这里是触发的世界书条目：常驻的，以及名字、最近的正文和聊天里命中关键词的）' : '';
        return ['━━ 私聊 ━━', text(buildChatRequest({ preset: p, thread, members: [member], story, user: '{{user}}', voiceFormat: this.voiceFormat(), lore })),
            '━━ 群聊 ━━', text(buildChatRequest({ preset: p, thread: group, members: [member, other], story, user: '{{user}}', voiceFormat: this.voiceFormat(), lore })),
            '━━ 朋友圈（刷新时） ━━', text(buildMomentsRequest({ preset: p, people: [member, other], story, user: '{{user}}', images: this.settings.moments.images, lore })),
            '━━ 电话（接通后第一句） ━━', text(buildCallRequest({ preset: p, mode: 'incoming', contact: { ...member, voice: false }, history: thread.messages, story, user: '{{user}}', lore })),
            '━━ 论坛（刷新时） ━━', text(buildForumRequest({ preset: p, people: [member, other], story, user: '{{user}}', lore })),
            '━━ 查手机 ━━', text(buildPeekRequest({ preset: p, person: member, story, user: '{{user}}', history: thread.messages, lore }))].join('\n\n');
    }
    /** 来电 options: {auto, every, dailyMax, ring}. */
    saveCalls(patch) {
        const next = this.getState(), allowed = ['auto', 'every', 'dailyMax', 'ring'];
        next.calls = normalizeCalls({ ...next.calls, ...Object.fromEntries(Object.entries(patch || {}).filter(([key]) => allowed.includes(key))) });
        return this.save(next).calls;
    }
    // ---------- 朋友圈 ----------
    /** Moments options: {auto, every, dailyMax, images, replyToMe}. */
    saveMoments(patch) {
        const next = this.getState(), allowed = ['auto', 'every', 'dailyMax', 'images', 'replyToMe'];
        next.moments = normalizeMoments({ ...next.moments, ...Object.fromEntries(Object.entries(patch || {}).filter(([key]) => allowed.includes(key))) });
        return this.save(next).moments;
    }
    // ---------- 分区 ----------
    /** The card open in the tavern now: {key, name, members}. With 分区 on, the phone shows that card's own things. */
    setSpace(space) {
        const next = { key: String(space?.key || '').slice(0, 300), name: String(space?.name || '').slice(0, 80), members: (Array.isArray(space?.members) ? space.members : []).map(String).filter(Boolean).slice(0, 30) };
        if (next.key === this.space.key && next.name === this.space.name && next.members.join('\n') === this.space.members.join('\n')) return;
        this.space = next;
        this.emit('space', { space: clone(next) });
        if (!this.here()) return;
        this.emit('chat', { threadId: '' }); this.emit('moments', {}); this.emit('forum', {}); this.emit('peek', {});
    }
    /** The space lists are filtered by, or null when 分区 is off (or no card is open). */
    here() { return activeSpace(this.settings, this.space); }
    /** The key new items are made under ('' = shared). */
    spaceKey() { return this.here()?.key || ''; }
    /** The roles that speak in a card's story belong to that card's contacts. Saved only when something changed. */
    tagRoles(names, key = this.space.key) {
        if (!key || !names?.length) return false;
        const want = new Set(names.map(String)), next = this.getState();
        let changed = false;
        for (const route of next.routes) {
            if (!want.has(route.name)) continue;
            const cards = Array.isArray(route.cards) ? route.cards : [];
            if (!cards.includes(key)) { route.cards = [...cards, key].slice(-100); changed = true; }
        }
        if (changed) this.save(next);
        return changed;
    }
    /** Contacts of the card open now (all of them when 分区 is off). */
    contacts() { return chatContacts(this.settings, this.here()); }
    /** Phone chats of the card open now. */
    async threads() {
        const here = this.here(), removed = deletedContactNames(this.settings.chat);
        return (await this.chats.list()).filter(t => inSpace(t, here) && !(t.type === 'dm' && removed.has(t.members?.[0])));
    }
    /** Removes what was made under the open card (or everything, with 分区 off). */
    async clearHere(list, remove, clearAll) {
        const here = this.here();
        if (!here) return clearAll();
        const mine = (await list()).filter(x => x.space === here.key);
        for (const x of mine) await remove(x.id);
        return mine.length;
    }
    hotId() { const key = this.spaceKey(); return key ? 'forum-hot:' + key : 'forum-hot'; }

    // ---------- 论坛 ----------
    /** Runs a change to an app's documents and tells the phone ('forum' or 'peek'). */
    async appsMutate(type, task) {
        this.assertOpen();
        const result = await task();
        this.emit(type, {});
        return result;
    }
    /** New posts from the board (characters and strangers), with made-up likes and 热度; the oldest go past the limit. */
    async addForumPosts(posts, { source = 'auto' } = {}) {
        // The first post the model wrote is shown on top (newest first).
        const now = Date.now(), id = () => crypto.randomUUID();
        const docs = posts.map((p, i) => cleanForumPost({ ...p, source, space: this.spaceKey(), ...(source === 'me' ? { likes: 0, heat: 1 } : startingHeat(p)) }, id(), now - i * 10, id));
        return this.appsMutate('forum', () => this.apps.put(docs, { keep: FORUM_LIMITS.posts }));
    }
    async setForumHot(topics) {
        const list = [...new Set((topics || []).map(t => String(t).trim().slice(0, 40)).filter(Boolean))].slice(0, FORUM_LIMITS.hot);
        if (!list.length) return [];
        await this.appsMutate('forum', () => this.apps.put([{ id: this.hotId(), kind: 'forum-hot', at: Date.now(), topics: list }]));
        return list;
    }
    /** Replies added under a post; each one makes it a little hotter. */
    async addForumReplies(postId, replies) {
        const now = Date.now();
        return this.appsMutate('forum', () => this.apps.change(postId, post => {
            if (post.kind !== 'forum') throw Error('這個帖子已經不在了');
            replies.forEach((r, i) => post.replies.push(cleanForumReply(r, crypto.randomUUID(), now + i)));
            post.replies = post.replies.slice(-FORUM_LIMITS.replies);
            post.heat += replies.length * (20 + Math.round(Math.random() * 80));
            post.likes += replies.filter(r => r.from !== 'me').length ? Math.round(Math.random() * 6) : 0;
        }));
    }
    // ---------- 查手机 ----------
    /** A character's phone as the model made it up; replaces the earlier one of the same person. */
    async savePeek(snapshot) { const doc = cleanPeek({ ...snapshot, space: this.spaceKey() }, Date.now()); return (await this.appsMutate('peek', () => this.apps.put([doc])))[0]; }

    /** Runs a change to the moments and tells the phone. */
    async momentsMutate(task) {
        this.assertOpen();
        const result = await task();
        this.emit('moments', {});
        return result;
    }
    async chatMutate(threadId, task) {
        this.assertOpen();
        const result = await task();
        this.emit('chat', { threadId });
        return result;
    }
    speak() { return speechRemoved(); }
    /** Album photos made by the drawing app or in-text pictures (named NovelAI-<seed>.png / chat-<seed>.png). */
    async generatedPhotos() {
        const rows = (await this.library.listPhotos()).filter(row => /^(?:NovelAI|chat)-\d+\.png$/.test(row.name));
        return { count: rows.length, bytes: rows.reduce((n, row) => n + (row.size || 0), 0), ids: rows.map(row => row.id) };
    }
    async deleteGeneratedPhotos() {
        const { ids } = await this.generatedPhotos();
        for (const id of ids) await this.library.deletePhoto(id);
        this.emit('library', { collection: 'photos' });
        this.emit('phone', { preferences: await this.getPhone() });
        return ids.length;
    }
    /** The shared cloud queue from the drawing settings, or null when it is off or incomplete. */
    cloudQueue() {
        const c = this.settings.draw.queue.cloud;
        if (!c.enabled || !c.url) return null;
        if (c.kind === 'keyhash') {
            if (!(this.cloud instanceof KeyHashQueue) || !this.cloud.matches(c)) this.cloud = new KeyHashQueue(c, { keyHash: () => this.naiKeyHash() });
            return this.cloud;
        }
        if (!validRoom(c.room)) return null;
        if (!(this.cloud instanceof CloudQueue) || !this.cloud.matches(c)) this.cloud = new CloudQueue(c);
        return this.cloud;
    }
    /** SHA-256 of the NovelAI key, for queues that group people by key. Cached per key. */
    async naiKeyHash() {
        const key = this.novelai.key;
        if (!key) return '';
        if (this.keyHashFor !== key) { this.keyHashValue = await sha256Hex(key); this.keyHashFor = key; }
        return this.keyHashValue;
    }
    /** Checks the cloud queue address and room: {ok, length, holder} or {ok: false, message}. */
    async testCloudQueue(value) {
        const c = { ...this.settings.draw.queue.cloud, ...clone(value || {}) };
        try {
            const queue = c.kind === 'keyhash' ? new KeyHashQueue(c, { keyHash: () => this.naiKeyHash() }) : new CloudQueue(c);
            const s = await queue.status();
            return { ok: true, length: s.length, holder: s.holder, cooldown: s.cooldown };
        }
        catch (error) { return { ok: false, message: error.message }; }
    }
    async base64(blob) {
        const bytes = new Uint8Array(await blob.arrayBuffer()); let text = '';
        for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return btoa(text);
    }
    async reference() { return speechRemoved(); }
    async deleteReference(id) {
        const next = this.getState();
        next.connections.fish.params.references = next.connections.fish.params.references.filter(reference => reference.audio !== id);
        next.connections.mimo.params.samples = next.connections.mimo.params.samples.filter(sample => sample.audio !== id);
        this.save(next); await this.library.deleteReference(id); this.providers.references.delete(id);
    }
    getEngineSchema(engine, connection = this.settings.connections[engine]) {
        engineCheck(engine); modelCheck(engine, connection.model);
        const current = clone(connection); TTSParameters.normalize(engine, current);
        const catalog = clone(TTSParameters.catalogs[engine]);
        catalog.models = catalog.models.map(id => ({ id, supported: id !== 'drama-3-preview', reason: id === 'drama-3-preview' ? '尚未接入 Fish 兼容通道' : '' }));
        catalog.groups = catalog.groups.map(group => ({ ...group, fields: group.fields.map(field => ({
            ...field, ...(field.type === 'select' ? { options: TTSParameters.allowed(engine, field, current) } : {}),
            unavailable: TTSParameters.unavailable(engine, field, current),
            ...(field.key === 'references' ? { help: '参考音频保存在当前浏览器，按酒馆账户隔离。' } : {}),
            ...(field.key === 'samples' ? { help: '上传 mp3 或 wav（编码后不超过 10 MB），起个名字，角色的音色填这个名字。保存在当前浏览器，按酒馆账户隔离。' } : {}),
        })) }));
        return { engine, ...catalog, connection: current, tags: TTSParameters.tags(engine, current.model), tagNote: TTSParameters.tagNote(engine, current.model), sounds: current.model === 's1' && engine === 'fish' ? [...TTSParameters.vocab.FISH_S1_TONES, ...TTSParameters.vocab.FISH_S1_SOUNDS] : [], sourceDate: '2026-09-30' };
    }
    audioInfo(audio) {
        return { key: audio.key, line: clone(audio.line), route: clone(audio.route), bytes: audio.blob.size, fromCache: audio.fromCache };
    }
    /** The audio of a favorite ({favorite: id}), a cached line ({key}) or a line as spoken now ({line}), with a file name. */
    async audioFile({ favorite, key, line } = {}) {
        this.assertOpen();
        if (favorite) {
            const row = await this.library.getFavorite(favorite);
            if (!row?.blob) throw Error('這段收藏已經不在了');
            return { blob: row.blob, name: audioName(row.role, row.translation || row.text) };
        }
        if (!key && line) key = await this.player.lineKey(line);
        const prepared = key && this.prepared?.key === key ? this.prepared : null;
        const record = prepared || !key ? null : await this.cache.getRecord(key);
        const blob = prepared?.blob || record?.blob;
        if (!blob?.size) throw Error('這句還沒有生成語音，先播放一次再下載');
        const said = prepared?.line || record?.metadata?.line || line || {};
        return { blob, name: audioName(said.role, said.translation || said.text) };
    }
    async favoriteAudio(key) {
        this.assertOpen();
        const prepared = this.prepared?.key === key ? this.prepared : null;
        const row = prepared ? null : await this.cache.getRecord(key);
        const blob = prepared?.blob || row?.blob;
        if (!blob) throw Error('音訊已不在快取中，請先手動播放一次');
        const line = prepared?.line || row?.metadata?.line || {};
        const route = prepared?.route || row?.metadata?.route || {};
        if (!route.engine) throw Error('舊版快取缺少角色資訊，請先手動播放這句臺詞再收藏');
        const favorite = await this.library.saveFavorite({ id: 'audio-' + key, requestKey: key, blob, role: line.role || route.name || '未标注角色', text: line.text || '旧版缓存音频', translation: line.translation || '', engine: route.engine || '', model: route.model || '', voice: route.voice || '' });
        this.emit('library', { collection: 'favorites' });
        return favorite;
    }
    async playFavorite() { return speechRemoved(); }
    audition() { return speechRemoved(); }
    async clearCache() {
        this.player.stop('缓存已清理'); this.prepared = null;
        await this.cache.clear(); this.assertOpen(); this.player.played.clear();
        this.emit('library', { collection: 'cache' }); return this.cache.stats();
    }
    async getPhone() { return { ...await this.library.getPhone(), theme: this.settings.theme }; }
    async savePhone(patch) {
        const { theme, ...local } = clone(patch);
        if (theme !== undefined && !['system', 'light', 'dark'].includes(theme)) throw Error('主題無效');
        const phone = await this.library.savePhone(local);
        if (theme !== undefined) this.save({ ...this.getState(), theme });
        this.assertOpen();
        this.player.setVolume(phone.volume);
        this.emit('phone', { preferences: { ...phone, theme: this.settings.theme } });
        return { ...phone, theme: this.settings.theme };
    }
    async mutateLibrary(collection, method, ...args) {
        const result = await this.library[method](...args.map(clone));
        this.emit('library', { collection });
        if (method === 'deletePhoto') this.emit('phone', { preferences: await this.getPhone() });
        return result;
    }
    api() {
        const methods = {
            getState: () => this.getState(), getSnapshot: () => this.getSnapshot(), save: (next, revision) => this.save(next, revision),
            updateGeneral: patch => this.updateGeneral(patch), saveRoute: route => this.saveRoute(route), deleteRoute: id => this.deleteRoute(id),
            switchRouteEngine, validRoleName: name => typeof name === 'string' && !!name.trim() && !isPlaceholderRole(name),
            saveConnection: (engine, patch) => this.saveConnection(engine, patch),
            savePreset: preset => this.savePreset(preset), deletePreset: id => this.deletePreset(id), selectPreset: id => this.selectPreset(id),
            validatePreset: preset => { try { validatePreset(preset); return ''; } catch (error) { return message(error); } },
            previewPrompt: preset => this.previewPrompt(preset), promptPlan: () => [], parse: text => this.parse(text),
            voiceBalance: (engine, refresh) => this.voiceBalance(engine, refresh), keyStatus: engine => this.keyStatus(engine), keyHint: engine => this.keyHint(engine), keyPool: engine => this.keyPool(engine), keyList: engine => this.keyList(engine), addKeys: (engine, value) => this.addKeys(engine, value), removeKey: (engine, index) => this.removeKey(engine, index), useKey: (engine, index) => this.useKey(engine, index), setKey: (engine, key) => this.setKey(engine, key), clearKey: engine => this.clearKey(engine),
            saveDraw: patch => this.saveDraw(patch), saveStyle: style => this.saveStyle(style), deleteStyle: id => this.deleteStyle(id),
            drawReady: () => this.drawReady(), drawMissing: () => this.drawMissing(), paidPrompt: () => this.paidPrompt(), comfyCatalog: url => this.comfyCatalog(url), comfyWorkflows: () => this.comfyWorkflows(), comfyWorkflow: name => this.comfyWorkflow(name),
            saveDrawPreset: preset => this.saveDrawPreset(preset), deleteDrawPreset: id => this.deleteDrawPreset(id), previewDrawPrompt: preset => this.previewDrawPrompt(preset),
            naiSubscription: refresh => this.naiSubscription(refresh), naiProbe: () => this.naiProbe(), fishProbe: speechRemoved,
            listVibes: () => this.listVibes(), importVibes: (files, options) => this.importVibes(files, clone(options || {})), updateVibe: (id, patch) => this.updateVibe(id, clone(patch || {})), deleteVibe: id => this.deleteVibe(id), deleteVibes: ids => this.deleteVibes([...(ids || [])]), exportVibes: target => this.exportVibes(clone(target || {})), vibePlan: model => clone(this.vibePlan(model || this.settings.draw.params.model)), drawQuote: params => this.drawQuote(params),
            generateImage: input => this.generateImage(input).then(({ blob, ...result }) => result),
            drawQueue: () => this.drawQueue.list(), cancelDraw: key => this.drawQueue.cancel(key), cancelAllDraws: () => this.drawQueue.cancelAll(),
            cloudQueueError: () => this.drawQueue.remoteError, testCloudQueue: value => this.testCloudQueue(value), newRoomCode: () => newRoomCode(),
            reference: (file, options) => this.reference(file, clone(options || {})), listReferences: () => this.library.listReferences(), deleteReference: id => this.deleteReference(id),
            engineSchema: (engine, connection) => this.getEngineSchema(engine, connection),
            validateConnection: (engine, connection) => { try { modelCheck(engine, connection.model); return TTSParameters.validate(engine, connection); } catch (error) { return message(error); } },
            voices: speechRemoved, previewRequest: speechRemoved,
            status: () => this.player.snapshot(), subscribe: listener => this.subscribe(listener), levels: () => this.player.sink.levels(),
            pendingRole: () => this.player.pending, stop: () => this.player.stop(), toggle: () => this.player.toggle(), resume: () => this.player.continuePending(),
            audition: route => this.audition(route), lineState: line => this.player.lineState(line),
            setVolume: value => this.savePhone({ volume: value }), getVolume: () => this.player.getVolume(),
            cacheStats: () => this.cache.stats(), clearCache: () => this.clearCache(), listAudio: () => this.cache.list(),
            deleteAudio: async key => { if (this.player.requestKey === key) this.player.stop('音频已删除'); if (this.prepared?.key === key) this.prepared = null; await this.cache.remove(key); this.emit('library', { collection: 'cache' }); },
            latestAudio: () => this.prepared ? this.audioInfo(this.prepared) : null,
            favoriteAudio: key => this.favoriteAudio(key), audioFile: ref => this.audioFile(ref),
            backupParts: () => ({ ...BACKUP_PARTS }), exportBackup: (parts, version, options) => typeof version === 'object' && version ? this.exportBackup(parts, '', version) : this.exportBackup(parts, version, options || {}), inspectBackup: file => this.inspectBackup(file), importBackup: (file, options) => this.importBackup(file, options), listFavorites: query => this.library.listFavorites(query),
            getFavorite: id => this.library.getFavorite(id), playFavorite: id => this.playFavorite(id),
            deleteFavorite: id => this.mutateLibrary('favorites', 'deleteFavorite', id),
            listPhotos: () => this.library.listPhotos(), addPhoto: value => this.mutateLibrary('photos', 'addPhoto', value),
            getPhoto: id => this.library.getPhoto(id), deletePhoto: id => this.mutateLibrary('photos', 'deletePhoto', id),
            listNotes: () => this.library.listNotes(), saveNote: value => this.mutateLibrary('notes', 'saveNote', value), deleteNote: id => this.mutateLibrary('notes', 'deleteNote', id),
            getPhone: () => this.getPhone(), savePhone: patch => this.savePhone(patch), libraryStats: () => this.library.stats(),
            generatedPhotos: () => this.generatedPhotos().then(({ count, bytes }) => ({ count, bytes })), deleteGeneratedPhotos: () => this.deleteGeneratedPhotos(),
            saveMoments: patch => this.saveMoments(clone(patch)), saveCalls: patch => this.saveCalls(clone(patch)),
            saveText: patch => this.saveText(clone(patch)), setTextKey: (id, key) => this.setTextKey(id, key), clearTextKey: id => this.clearTextKey(id), textKeyHint: id => this.textKeyHint(id), textModels: draft => this.textModels(clone(draft || {})),
            syncStatus: () => this.syncStatus(), saveSync: patch => this.saveSync(clone(patch)), syncNow: () => this.syncNow().then(() => this.syncStatus()),
            listMoments: async () => { const here = this.here(); return (await this.moments.list()).filter(p => inSpace(p, here)); }, getMoment: id => this.moments.get(id),
            postMoment: ({ text, photoId } = {}) => this.momentsMutate(async () => (await this.moments.add([{ author: 'me', source: 'me', text, photoId, space: this.spaceKey() }]))[0]),
            likeMoment: (id, on = true) => this.momentsMutate(() => this.moments.like(id, 'me', on)),
            commentMoment: (id, { text, to } = {}) => this.momentsMutate(() => this.moments.comment(id, { from: 'me', text, to })),
            deleteMoment: id => this.momentsMutate(() => this.moments.remove(id)), deleteMomentComment: (id, commentId) => this.momentsMutate(() => this.moments.removeComment(id, commentId)),
            clearMoments: () => this.momentsMutate(() => this.clearHere(() => this.moments.list(), id => this.moments.remove(id), () => this.moments.clear())),
            listForum: async () => { const here = this.here(); return (await this.apps.list('forum')).filter(p => inSpace(p, here)); }, getForumPost: id => this.apps.get(id),
            forumHot: async () => (await this.apps.get(this.hotId()))?.topics || [],
            postForum: async ({ title = '', text = '' } = {}) => (await this.addForumPosts([{ author: 'me', title, text }], { source: 'me' }))[0],
            replyForum: async (id, { text, to } = {}) => { const post = await this.addForumReplies(id, [{ from: 'me', text, to }]); return { post, reply: post.replies.at(-1) }; },
            likeForum: (id, on = true) => this.appsMutate('forum', () => this.apps.change(id, post => { if (post.liked === !!on) return; post.liked = !!on; post.likes = Math.max(0, post.likes + (on ? 1 : -1)); })),
            deleteForumReply: (id, replyId) => this.appsMutate('forum', () => this.apps.change(id, post => { post.replies = post.replies.filter(r => r.id !== replyId); })),
            deleteForum: id => this.appsMutate('forum', () => this.apps.remove(id)),
            clearForum: () => this.appsMutate('forum', async () => { const n = await this.clearHere(() => this.apps.list('forum'), id => this.apps.remove(id), () => this.apps.clear('forum')); await this.apps.remove(this.hotId()); return n; }),
            // 查手机: the open card's snapshot of a person, else the shared one from before 分区.
            listPeeks: async () => { const here = this.here(); return (await this.apps.list('peek')).filter(p => inSpace(p, here)); },
            getPeek: async name => (await this.apps.get(peekId(name, this.spaceKey()))) || (this.spaceKey() ? this.apps.get(peekId(name)) : null),
            deletePeek: name => this.appsMutate('peek', async () => { await this.apps.remove(peekId(name, this.spaceKey())); if (this.spaceKey()) await this.apps.remove(peekId(name)); return true; }),
            /** 分区: the card open now ({key, name}) and whether 分区 is on. */
            phoneSpace: () => ({ ...clone(this.space), on: !!this.here() }),
            saveChatPreset: preset => this.saveChatPreset(preset), deleteChatPreset: id => this.deleteChatPreset(id), selectChatPreset: id => this.selectChatPreset(id),
            previewChatPrompt: preset => this.previewChatPrompt(preset), validateChatPreset: preset => { try { validateChatPreset(normalizeChatPreset(clone(preset))); return ''; } catch (error) { return message(error); } },
            saveChatOptions: patch => this.saveChatOptions(clone(patch)),
            wallet: () => this.wallet(), walletSetBalance: (value, note) => this.walletSetBalance(value, note), pocketPurchase: (item, orderId) => this.pocketPurchase(item, orderId), buyDecoration: (kind, key) => this.buyDecoration(kind, key), saveGift: gift => this.saveGift(gift), deleteGift: id => this.deleteGift(id),
            sendPaid: (threadId, message) => this.sendPaid(threadId, message), takeSent: (threadId, messageId, accept) => this.takeSent(threadId, messageId, accept !== false),
            shopCatalog: () => clone({ premium: PREMIUM, kinds: DECOR_KINDS, gifts: shopGifts(this.settings.chat.wallet), ledgerKinds: LEDGER_KINDS }), saveContact: contact => this.saveContact(contact), deleteContact: id => this.deleteContact(id), restoreContact: name => this.restoreContact(name), chatContacts: () => clone(this.contacts()),
            listThreads: () => this.threads(), getThread: id => this.chats.get(id), chatUnread: async () => (await this.threads()).reduce((n, t) => n + (t.muted ? 0 : t.unread), 0),
            createThread: value => this.chatMutate(null, () => this.chats.create({ ...clone(value), space: this.spaceKey() })),
            updateThread: (id, patch) => this.chatMutate(id, () => this.chats.update(id, clone(patch))),
            deleteThread: id => this.chatMutate(id, () => this.chats.remove(id)),
            appendChat: (id, messages, options) => this.chatMutate(id, () => this.chats.append(id, clone(messages), clone(options || {}))),
            deleteChatMessages: (id, ids) => this.chatMutate(id, () => this.chats.removeMessages(id, clone(ids))),
            updateChatMessage: (id, messageId, patch) => this.chatMutate(id, () => this.chats.updateMessage(id, messageId, clone(patch || {}))),
            markThreadRead: id => this.chatMutate(id, () => this.chats.markRead(id)),
            speak: line => this.speak(clone(line)), voiceFormat: () => this.voiceFormat(),
        };
        return Object.freeze({ apiVersion: BACKEND_API_VERSION, capabilities: Object.freeze({ tts: false }), defaultPrompt: '', defaultFormat: DEFAULT_FORMAT,
            picTagFormat: PIC_TAG_FORMAT, defaultDrawRule: DEFAULT_DRAW_RULE, drawCountMax: DRAW_COUNT_MAX, defaultChatPreset: Object.freeze((({ id, ...rest }) => rest)(defaultChat().presets[0])),
            // The shipped presets of each kind, without ids: for 恢复默认 in the preset app.
            defaultVoicePreset: Object.freeze((({ id, ...rest }) => rest)(freshState().presets[0])), defaultDrawPreset: Object.freeze((({ id, ...rest }) => rest)(defaultDraw().presets[0])),
            drawCatalog: Object.freeze({ models: NAI_MODELS, modelNames: NAI_MODEL_NAMES, samplers: NAI_SAMPLERS, schedules: NAI_SCHEDULES, engines: DRAW_ENGINES, engineNames: DRAW_ENGINE_NAMES, gptModels: GPT_IMAGE_MODELS, gptQualities: GPT_QUALITIES, comfyWorkflow: DEFAULT_COMFY_WORKFLOW }),
            phoneCatalog: Object.freeze({ apps: PHONE_APPS, wallpapers: PHONE_WALLPAPERS, glyphs: PHONE_GLYPHS, skins: PHONE_SKINS }),
            ...Object.fromEntries(Object.entries(methods).map(([name, fn]) => [name, (...args) => { this.assertOpen(); return fn(...args); }])),
        });
    }
    async close() {
        if (this.closing) return this.closing;
        this.closed = true; this.prepared = null; this.listeners.clear(); this.providers.clear();
        this.chats.close();
        clearTimeout(this.syncTimer);
        this.moments.close();
        this.apps.close();
        this.drawQueue.cancelAll();
        this.closing = Promise.all([this.player.close(), this.cache.close(), this.library.close(), Promise.resolve(this.keyStore.flush?.()).then(() => this.keyStore.close?.())]);
        await this.closing;
    }
}

// Keep imports from older host integrations working while callers migrate to the character-library backend.
export { PhoneBackend as TTSBackend };
