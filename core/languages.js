// Voice languages the phone offers, as [code, 中文名]. The code is what the voice engines get; the name is what prompts
// and the phone show. A code not in the list (typed by the user) is shown as it is.
export const LANGUAGES = Object.freeze([['', '跟隨預設'], ['zh', '中文'], ['en', '英語'], ['ja', '日語'], ['ko', '韓語'], ['fr', '法語'], ['de', '德語'], ['es', '西班牙語'], ['ru', '俄語'], ['it', '義大利語'], ['pt', '葡萄牙語'], ['ar', '阿拉伯語'], ['hi', '印地語'], ['th', '泰語'], ['vi', '越南語']]);
export const languageName = code => LANGUAGES.find(([value]) => value && value === String(code || '').trim().toLowerCase())?.[1] || String(code || '').trim() || '中文';
const ENGLISH = {zh: 'chinese', en: 'english', ja: 'japanese', ko: 'korean', fr: 'french', de: 'german', es: 'spanish', ru: 'russian', it: 'italian', pt: 'portuguese', ar: 'arabic', hi: 'hindi', th: 'thai', vi: 'vietnamese'};
// Older settings and typed Simplified Chinese language names remain accepted.
const LEGACY_NAMES = {zh: '中文', en: '英语', ja: '日语', ko: '韩语', fr: '法语', de: '德语', es: '西班牙语', ru: '俄语', it: '意大利语', pt: '葡萄牙语', ar: '阿拉伯语', hi: '印地语', th: '泰语', vi: '越南语'};
const known = ([code, name], value) => code && (code === value.toLowerCase() || name === value || LEGACY_NAMES[code] === value || ENGLISH[code] === value.toLowerCase());
/**
 * The language code for what the user wrote ('日语', 'Japanese' and 'ja' are all 'ja'); a code that is not in the list
 * (like 'yue' or 'pt-BR') is kept as it is, and anything else (粤语, 上海话) has no code: ''.
 */
export function languageCode(value) {
  const v = String(value ?? '').trim();
  const hit = LANGUAGES.find(row => known(row, v));
  return hit ? hit[0] : /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(v) ? v.toLowerCase() : '';
}
/** Languages the user typed in (not in the list), from the values given, each once. */
export const customLanguages = values => [...new Set(values.map(v => String(v ?? '').trim()))].filter(v => v && !LANGUAGES.some(row => known(row, v)));
