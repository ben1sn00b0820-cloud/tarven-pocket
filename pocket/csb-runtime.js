import {worldText} from '../core/world.js';
import {sourceScope} from './source-sync.js';

/** One controller owns both the phone and inline status. Older standalone copies
 * are retired only through their exported lifecycle, never by replacing globals. */
export function createCharacterStateRuntime({context, scanModelAdapter, notice = () => {}, formatMessage,
  globals = globalThis, document = globals.document,
  load = () => import('../companions/csb-character-state/index.js'),
  loadExternal = url => import(url)} = {}) {
  let alive = true, pending, owned, ownedApi, style;
  const api = () => globals.CSBCharacterState?.apiVersion === 1 ? globals.CSBCharacterState : null;
  const disabled = () => (context()?.extensionSettings?.disabledExtensions || [])
    .some(name => /(?:^|\/)(?:csb-character-state|csb_character_state)(?:$|\/)/i.test(String(name)));
  function ensureStyle(){
    if(document&&!document.getElementById('tp-csb-style')){
      style=document.createElement('link');style.id='tp-csb-style';style.rel='stylesheet';
      style.href=new URL('../companions/csb-character-state/style.css',import.meta.url).href;document.head.append(style);
    }
  }
  async function retireStandalone(){
    if(!alive)return false;
    if(!api()&&typeof globals.csbCharacterStateIntercept!=='function'&&!document?.getElementById?.('csb-launcher'))return true;
    const lifecycle=globals.CSBCharacterStateRuntime;
    if(lifecycle?.version==='1.6.0'&&typeof lifecycle.setMessageFormatter==='function'){
      lifecycle.setMessageFormatter(formatMessage||null);lifecycle.setScanModelAdapter?.(scanModelAdapter);ensureStyle();return false;
    }
    if(lifecycle&&typeof lifecycle.dispose==='function'){
      lifecycle.dispose();
      if(!api()&&typeof globals.csbCharacterStateIntercept!=='function')return true;
    }
    // ST registers extension entrypoints as module script elements. Re-importing
    // that exact observed URL reuses its singleton and lets it release listeners.
    const originalApi=api(),originalInterceptor=globals.csbCharacterStateIntercept;
    const scripts=[...(document?.querySelectorAll?.('script[type="module"][src]')||[])];
    const candidates=scripts.map(x=>x.src).filter(src=>/\/extensions\/third-party\/[^/]*(?:csb-character-state|csb_character_state)[^/]*\/index\.js(?:[?#].*)?$/i.test(src));
    for(const url of candidates){
      try{
        const previous=await loadExternal(url);
        if(!alive)return false;
        // Another plugin may have claimed the globals while its module loaded.
        if(api()!==originalApi||globals.csbCharacterStateIntercept!==originalInterceptor)return false;
        if(typeof previous.dispose!=='function'||!previous.ownsRuntime?.())continue;
        previous.dispose();
        if(api()||typeof globals.csbCharacterStateIntercept==='function')continue;
        const match=new URL(url).pathname.match(/\/scripts\/extensions\/(third-party\/[^/]+)\/index\.js$/);
        const settings=context()?.extensionSettings;
        if(match&&settings){settings.disabledExtensions??=[];if(!settings.disabledExtensions.includes(match[1]))settings.disabledExtensions.push(match[1]);context()?.saveSettingsDebounced?.();}
        notice('已由小手機內建 CSB 接管；角色資料與欄位沿用，舊獨立副本已停用。');return true;
      }catch(error){if(!alive)return false;notice('獨立 CSB 接管未完成：'+error.message);}
    }
    if(api())ensureStyle();
    notice('偵測到無法安全接管的獨立 CSB。請停用舊獨立 CSB 並重新整理，小手機即會啟用內建新版；角色資料會保留。');
    return false;
  }
  async function start() {
    if (!alive) throw Error(worldText('傳音玉符已停用。'));
    if(owned&&api()===ownedApi)return ownedApi;
    if (pending) return pending;
    pending = (async () => {
      const takeover=await retireStandalone();
      if(!alive)return null;
      if(!takeover)return api();
      const module = await load();
      // Bundled imports are side-effect free; an abandoned start never disposes
      // a singleton that another runtime may already have claimed.
      if (!alive) return null;
      const initialized = module.initialize?.();
      if (!initialized || !module.ownsRuntime?.()) return api();
      owned = module; ownedApi = initialized;
      module.setMessageFormatter?.(formatMessage || null);
      module.setScanModelAdapter?.(scanModelAdapter);
      ensureStyle();
      return ownedApi;
    })();
    try { return await pending; } finally { pending = null; }
  }
  async function open({id, scope} = {}) {
    const before = context(), expected = scope || sourceScope(before), metadata = before?.chatMetadata;
    if (!expected) throw Error('請先開啟一個聊天。');
    await start();
    if (!alive || sourceScope(context()) !== expected || context()?.chatMetadata !== metadata) throw Error('聊天已切換，請重新開啟角色信息。');
    const current = api();
    if (current) {
      if (id) current.openEditor(id, {scope: expected});
      else current.openManager({scope: expected});
      return {opened: true};
    }
    // Original CSB 1.0.0 keeps its controller private. Reuse its own launcher;
    // never initialize a second controller or rewrite its metadata to edit it.
    const launcher = document?.querySelector?.('#csb-launcher button');
    if (!disabled() && launcher) {
      launcher.click();
      if (id) notice('已開啟原版角色信息，請在列表選擇要修改的角色。');
      return {opened: true, legacy: true};
    }
    throw Error('角色信息尚未啟用，請在擴充功能中啟用後重新整理。');
  }
  async function current(scope) {
    const before = context(), expected = scope || sourceScope(before), metadata = before?.chatMetadata;
    if (!expected) throw Error('請先開啟一個聊天。');
    await start();
    if (!alive || sourceScope(context()) !== expected || context()?.chatMetadata !== metadata) throw Error('聊天已切換，請重新開啟角色信息。');
    const bridge = api();
    if (!bridge) {
      if (!disabled() && (typeof globals.csbCharacterStateIntercept === 'function' || document?.getElementById?.('csb-launcher'))) throw Error('請停用舊獨立 CSB 並重新整理，以使用小手機內建新版。原有角色資料會保留。');
      throw Error('角色信息尚未啟用，請啟用 CSB 後重新整理。');
    }
    return {bridge, scope: expected};
  }
  return {
    start, open,
    async snapshot() { const {bridge} = await current(); return bridge.getSnapshot(); },
    async mount(container, options = {}) {
      const {bridge, scope} = await current(options.scope);
      if (typeof bridge.mount !== 'function') throw Error('目前另行啟用的 CSB 版本較舊，請以 1.2.0 更新原來的 CSB 擴充，再重新整理。原有角色資料會保留。');
      return bridge.mount(container, {...options, scope});
    },
    async setInline(enabled, options = {}) {
      const {bridge, scope} = await current(options.scope);
      if (typeof bridge.setInlineCards !== 'function') throw Error('請先更新 CSB 至 1.2.0，才能在此設定正文顯示。');
      return bridge.setInlineCards(enabled, {scope});
    },
    owns: () => !!owned && api() === ownedApi,
    async intercept(...args) {
      if (!alive || !owned || api() !== ownedApi) return;
      await owned.intercept?.(...args);
    },
    dispose() {
      alive = false;
      if (owned && api() === ownedApi) owned.dispose?.();
      if(owned)style?.remove();
      owned = ownedApi = null; style = null;
    },
  };
}

/** Strip only machine-state blocks, leaving raw chat and surrounding prose intact. */
export const stripCharacterStateUpdates = value => String(value ?? '').replace(/<CSB_UPDATE>[\s\S]*?<\/CSB_UPDATE>/g, '');
