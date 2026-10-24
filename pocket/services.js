import {buildWorldbookIndex,searchWorldbookIndex,readWorldbookIndexEntry,selectWorldbookContext} from './worldbook-index.js';
import {stripStatusPanels} from './status.js';
import {parseSpiritText, SPIRIT_MAX, SPIRIT_CURRENCY_RULE} from '../core/currency.js';
/**
 * SillyTavern 1.19.0 public-context adapters for phone generation.
 * Saved connection profiles use the host's ConnectionManagerRequestService;
 * this module never switches the main connection or copies API credentials.
 * Selected worldbooks are fully indexed; relevant enabled entries/chunks
 * are retrieved within a configurable generation budget. This deliberately
 * does not simulate the host's keyword, probability, or recursion rules. The current-model path also retains the host's normal chat context.
 */

const LIMITS = Object.freeze({ characterChars: 32000, promptChars: 64000, recentChars: 12000, responseChars: 100000 });
const CATALOGUE_MARKER = '[Tavern Pocket 商城生成]';

function fail(message) { throw new Error(message); }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function worldbookNames(c) {
    if (typeof c?.getWorldInfoNames !== 'function') return [];
    const names = c.getWorldInfoNames();
    if (!Array.isArray(names)) fail('酒館未能提供世界書清單，請重新整理頁面。');
    return [...new Set(names.filter(name => typeof name === 'string' && name.trim()))];
}

function profileMap(c, profile) {
    const map = c?.CONNECT_API_MAP?.[profile?.api];
    if (map?.selected === 'openai' && map.source) return map;
    if (map?.selected === 'textgenerationwebui' && map.type) return map;
    return null;
}

/** Return public labels only. Secret IDs, API URLs and presets stay in ST. */
export function getConnectionOptions(c) {
    const disabled = c?.extensionSettings?.disabledExtensions ?? [];
    const profiles = c?.extensionSettings?.connectionManager?.profiles;
    return {
        worldbookNames: worldbookNames(c),
        modelProfiles: disabled.includes('connection-manager') || !Array.isArray(profiles) ? [] : profiles
            .filter(profile => typeof profile?.id === 'string' && profile.id && profileMap(c, profile))
            .map(profile => ({ id: profile.id, name: typeof profile.name === 'string' && profile.name.trim() ? profile.name : profile.id,
                ...(typeof profile.model === 'string' && profile.model ? { model: profile.model } : {}) })),
    };
}

function substitute(c, value) {
    const result = typeof c.substituteParams === 'function' ? c.substituteParams(value)
        : value.replace(/\{\{user\}\}/gi, () => c.name1 || '使用者').replace(/\{\{char\}\}/gi, () => c.name2 || '角色');
    if (typeof result !== 'string') fail('世界書巨集替換失敗，請檢查所選條目。');
    return result;
}

// Cache only raw, chat-independent index data. ST's loadWorldInfo reads its
// current cache (saveWorldInfo replaces it immediately). Generation rebuilds
// selected indexes by default; inspector refresh and WORLDINFO_UPDATED can
// explicitly invalidate these local indexes too.
let worldbookCaches = new WeakMap();
function cacheFor(c) {
    const key = c?.loadWorldInfo;
    if (typeof key !== 'function') fail('目前酒館沒有世界書讀取 API，請更新至支援版本。');
    let cache = worldbookCaches.get(key);
    if (!cache) { cache = {indexes:new Map(),revision:0}; worldbookCaches.set(key,cache); }
    return cache;
}
export function invalidatePhoneWorldbooks(c, name) {
    if (!c) { worldbookCaches = new WeakMap(); return; }
    const cache = typeof c.loadWorldInfo === 'function' ? worldbookCaches.get(c.loadWorldInfo) : null;
    if(cache){cache.revision++;if (typeof name === 'string') cache.indexes.delete(name); else cache.indexes.clear();}
}
async function selectedWorldbookIndexes(c, names, {refresh=false,assertCurrent}={}) {
    if (!Array.isArray(names) || names.some(name => typeof name !== 'string' || !name.trim())) fail('手機世界書設定格式錯誤，請重新選擇世界書。');
    if (new Set(names).size !== names.length) fail('手機世界書重複選取，請重新儲存設定。');
    if (assertCurrent !== undefined && typeof assertCurrent !== 'function') fail('手機對話檢查設定錯誤。');
    assertCurrent?.();
    if (!names.length) return [];
    const available = new Set(worldbookNames(c));
    for (const name of names) if (!available.has(name)) fail(`世界書「${name}」已不存在，請重新選擇。`);
    const cache=cacheFor(c),selected=new Set(names);
    // Release books no longer selected instead of retaining every giant book
    // visited across chats for the entire browser session. This is eviction,
    // never a limit on the selected collection.
    for(const cachedName of cache.indexes.keys())if(!selected.has(cachedName))cache.indexes.delete(cachedName);
    // Sequential loading avoids launching hundreds of backend requests or
    // retaining Promise.all copies of all giant books on a mobile device.
    // If an editor save arrives during a read, restart from the new revision
    // instead of resurrecting an invalidated index with obsolete contents.
    for(let attempt=0;attempt<3;attempt++){
        const revision=cache.revision,indexes=[];
        for (const name of names) {
            assertCurrent?.();let index=refresh?undefined:cache.indexes.get(name);
            if(!index){
                let book;
                try { book=await c.loadWorldInfo(name); }
                catch(error){assertCurrent?.();throw new Error(`世界書「${name}」讀取失敗，請檢查酒館連線後重試。`,{cause:error});}
                assertCurrent?.();index=await buildWorldbookIndex(name,book,{assertCurrent});assertCurrent?.();
                if(cache.revision!==revision)break;
                cache.indexes.set(name,index);
            }
            indexes.push(index);
            await new Promise(resolve=>setTimeout(resolve,0));assertCurrent?.();
            if(cache.revision!==revision)break;
        }
        if(cache.revision===revision)return indexes;
    }
    fail('世界書在讀取期間持續變更，請完成儲存後重新讀取。');
}

/** Read/index whole selected books, then retrieve a bounded relevant context.
 * No source book, entry count, or entry text length is truncated/rejected.
 * Existing two-argument callers retain a string result and a 48K model budget.
 */
export async function loadPhoneWorldbooks(c, names = [], options = {}) {
    const indexes=await selectedWorldbookIndexes(c,names,{...options,refresh:options.refresh!==false});
    return selectWorldbookContext(indexes,{...options,substitute:value=>substitute(c,value)});
}
export async function inspectPhoneWorldbooks(c, names = [], options = {}) {
    const indexes=await selectedWorldbookIndexes(c,names,options);
    return searchWorldbookIndex(indexes,options);
}
export async function readPhoneWorldbookEntry(c, names = [], options = {}) {
    const indexes=await selectedWorldbookIndexes(c,names,options);
    return readWorldbookIndexEntry(indexes,options);
}

function activeCharacter(c) {
    const character = c?.characters?.[c.characterId];
    if (!character) return '';
    const selected = { name: character.name || c.name2 || '角色' };
    for (const key of ['description', 'personality', 'scenario', 'system_prompt']) {
        const value = character.data?.[key] ?? character[key];
        if (typeof value === 'string' && value.trim()) selected[key] = substitute(c, value);
    }
    const text = JSON.stringify(selected);
    if (text.length > LIMITS.characterChars) fail(`目前角色設定超過 ${LIMITS.characterChars} 字元，請精簡角色設定後再使用手機獨立模型。`);
    return text;
}

function recentChat(c) {
    const chat = Array.isArray(c?.chat) ? c.chat : [];
    const records = [];
    let budget = LIMITS.recentChars;
    for (let i = chat.length - 1; i >= 0 && budget > 0; i--) {
        const message = chat[i];
        if (!message || message.is_system || message.extra?.tavern_pocket_activity || typeof message.mes !== 'string' || !message.mes.trim()) continue;
        const name = typeof message.name === 'string' ? message.name.slice(0, 100) : (message.is_user ? c.name1 || '使用者' : c.name2 || '角色');
        const prefix = `${message.is_user ? 'user' : 'character'} ${name}: `;
        if (budget <= prefix.length + 1) break;
        const contentBudget = budget - prefix.length - 1;
        const raw = stripStatusPanels(message.mes.replace(/<phone\b[^>]*>[\s\S]*?<\/phone\s*>/gi, ''));
        const content = raw.length > contentBudget ? raw.slice(-contentBudget) : raw;
        records.unshift(prefix + content);
        budget -= prefix.length + content.length + 1;
    }
    return records.join('\n');
}

function validateProfile(c, id) {
    if (c?.extensionSettings?.disabledExtensions?.includes('connection-manager')) fail('酒館的 Connection Manager 已停用，請啟用它或選擇「跟隨酒館目前模型」。');
    const profiles = c?.extensionSettings?.connectionManager?.profiles;
    const profile = Array.isArray(profiles) ? profiles.find(profile => profile.id === id) : undefined;
    if (!profile) fail('所選手機模型連線設定已不存在，請在手機設定中重新選擇。');
    const map = profileMap(c, profile);
    if (!map) fail('所選連線設定缺少可用 API，請在酒館 Connection Manager 修正並儲存。');
    if (map.selected === 'openai' && (typeof profile.model !== 'string' || !profile.model.trim())) fail('所選連線設定沒有儲存模型名稱，請在酒館選好模型並更新此連線設定。');
    if (typeof c.ConnectionManagerRequestService?.sendRequest !== 'function') fail('酒館未提供獨立模型請求服務，請更新酒館或改為跟隨目前模型。');
    return profile;
}

/**
 * prompt: caller's public phone state/protocol/action instructions, never private
 * diaries. Explicit profiles add active character fields and the last 12K chat
 * characters here. Empty profile follows the host's normal quiet generation.
 * assertCurrent: optional synchronous guard, called before and after lore loads
 * and immediately before dispatch, so a switched chat cannot start generation.
 */
export async function generatePhoneResponse(c, { profileId = '', worldbooks = [], prompt, maxTokens = 1200, assertCurrent, contextMode = 'full', worldbookOptions = {} } = {}) {
    if (typeof prompt !== 'string' || !prompt.trim()) fail('手機生成指令不可為空。');
    if (prompt.length > LIMITS.promptChars) fail(`手機生成指令超過 ${LIMITS.promptChars} 字元，請縮短內容。`);
    if (!Number.isInteger(maxTokens) || maxTokens < 64 || maxTokens > 8192) fail('手機回覆長度須為 64–8192 tokens 的整數。');
    if (typeof profileId !== 'string') fail('手機模型連線設定格式錯誤，請重新選擇。');
    if (assertCurrent !== undefined && typeof assertCurrent !== 'function') fail('手機對話檢查設定錯誤。');
    if (!['full', 'provided'].includes(contextMode)) fail('手機生成背景模式無效。');
    if (!isObject(worldbookOptions)) fail('手機世界書讀取設定格式錯誤。');
    assertCurrent?.();
    const selectedProfile = profileId ? validateProfile(c, profileId) : null;
    if (!selectedProfile && typeof c?.generateQuietPrompt !== 'function') fail('酒館未提供目前模型生成 API，請重新整理或更新酒館。');
    const character = selectedProfile && contextMode === 'full' ? activeCharacter(c) : '';
    const plot = selectedProfile && contextMode === 'full' ? recentChat(c) : '';
    const lore = await loadPhoneWorldbooks(c, worldbooks, {...worldbookOptions, query:worldbookOptions.query ?? prompt, assertCurrent});
    assertCurrent?.();
    let response;
    try {
        if (selectedProfile) {
            const messages = [
                { role: 'system', content: '你正在 SillyTavern 的虛擬手機中協助延續角色劇情。所有帳戶、金錢、商城與社群均為虛構。依本次任務格式回覆。以下角色設定與世界書作為本次背景。\n' + character + '\n' + lore },
                { role: 'user', content: '[最近主對話，僅取末尾最多 12000 字元]\n' + plot + '\n[本次手機任務]\n' + prompt },
            ];
            assertCurrent?.();
            const result = await c.ConnectionManagerRequestService.sendRequest(profileId, messages, maxTokens, {
                stream: false, extractData: true, includePreset: true, includeInstruct: true,
            });
            response = result?.content;
        } else {
            assertCurrent?.();
            response = await c.generateQuietPrompt({ quietPrompt: `${lore}\n${prompt}`.trim(), quietToLoud: false, responseLength: maxTokens, removeReasoning: true, trimToSentence: false });
        }
    } catch (error) {
        // Preserve chat-switch guard messages; never expose provider objects or
        // URLs/credentials from deeply nested API errors in the phone UI.
        assertCurrent?.();
        throw new Error('手機模型生成失敗，請檢查酒館的模型連線、額度與連線設定後重試。', { cause: error });
    }
    if (typeof response !== 'string' || !response.trim()) fail('模型沒有回傳文字，請檢查連線或更換模型後重試。');
    if (response.length > LIMITS.responseChars) fail(`模型回傳超過 ${LIMITS.responseChars} 字元，本次內容未匯入，請降低回覆長度。`);
    return response.trim();
}

function newItemId() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return 'shop-' + globalThis.crypto.randomUUID();
    if (typeof globalThis.crypto?.getRandomValues === 'function') {
        const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
        return 'shop-' + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    }
    fail('瀏覽器無法產生商品 ID，請使用 localhost 或 HTTPS 開啟酒館。');
}

function parseCatalogue(response) {
    let text = response.trim();
    if (text.startsWith('```')) {
        const match = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(text);
        if (!match) fail('商城模型回傳的 JSON 程式碼區塊不完整，請重新生成。');
        text = match[1].trim();
    }
    let parsed;
    try { parsed = JSON.parse(text); } catch { fail('商城模型沒有回傳有效 JSON，商品尚未更新，請重新生成。'); }
    const items = Array.isArray(parsed) ? parsed : isObject(parsed) ? parsed.items : undefined;
    if (!Array.isArray(items) || items.length < 1 || items.length > 8) fail('商城模型須回傳 1–8 件商品，商品尚未更新。');
    const validated = items.map((item, index) => {
        const label = `第 ${index + 1} 件商品`;
        if (!isObject(item)) fail(`${label}格式錯誤，商品尚未更新。`);
        if (typeof item.title !== 'string' || !item.title.trim() || item.title.trim().length > 100) fail(`${label}名稱須為 1–100 字元，商品尚未更新。`);
        if (typeof item.text !== 'string' || !item.text.trim() || item.text.trim().length > 1000) fail(`${label}描述須為 1–1000 字元，商品尚未更新。`);
        let amount;
        try { amount = parseSpiritText(item.amount, {zero: false, max: SPIRIT_MAX}); }
        catch { fail(`${label}價格須為 1–${SPIRIT_MAX} 枚下品靈石，或能精確換算的明確中品／極品數量，商品尚未更新。`); }
        return { title: item.title.trim(), text: item.text.trim(), amount };
    });
    // Allocate identities only after every item passes validation. Model IDs
    // are ignored and can never target an existing purchase or wallet entry.
    return validated.map(item => ({ id: newItemId(), ...item }));
}

/** Generate merchandise only; this never spends money or appends chat events. */
export async function generateShopCatalogue(c, { prompt = '', maxTokens = 1800, ...options } = {}) {
    if (typeof prompt !== 'string') fail('商城背景指令格式錯誤。');
    const instruction = `${prompt}\n${CATALOGUE_MARKER}\n請根據目前角色、最近劇情與傳音玉符所選世界書，生成 1–8 件此刻合理出現在萬寶閣的商品，建議 4–6 件。名稱使用繁體中文，每件描述建議 30–80 字，交代物件用途及與劇情的關係；可為衣物、食物、道具、禮物或此世界合理的物件。${SPIRIT_CURRENCY_RULE} amount 必須是 1–${SPIRIT_MAX} 的 JSON 整數。不要聲稱使用者已購買或已扣款。不要生成付款、轉帳、手機事件或任何圖片網址。\n只回傳以下形狀的完整 JSON，無前後文、無 Markdown：{"items":[{"title":"商品名稱（1–100 字元）","text":"商品描述（1–1000 字元）","amount":12}]}。不生成 id；商品 ID 由手機系統配置。`;
    const response = await generatePhoneResponse(c, { ...options, prompt: instruction, maxTokens });
    return parseCatalogue(response);
}
