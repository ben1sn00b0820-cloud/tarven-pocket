import {sourceScope} from './source-sync.js';

/** A companion is started only when a separately installed CSB is not running. */
export function createCharacterStateRuntime({context, notice = () => {}, formatMessage,
  globals = globalThis, document = globals.document,
  load = () => import('../companions/csb-character-state/index.js')} = {}) {
  let alive = true, pending, owned, ownedApi, style;
  const api = () => globals.CSBCharacterState?.apiVersion === 1 ? globals.CSBCharacterState : null;
  const disabled = () => (context()?.extensionSettings?.disabledExtensions || [])
    .some(name => /(?:^|\/)(?:csb-character-state|csb_character_state)(?:$|\/)/i.test(String(name)));
  async function start() {
    if (!alive) throw Error('小手機已停用。');
    if (api()) return api();
    if (disabled() || typeof globals.csbCharacterStateIntercept === 'function' || document?.getElementById?.('csb-launcher')) return null;
    if (pending) return pending;
    pending = (async () => {
      const module = await load();
      if (!alive) { if (module.ownsRuntime?.()) module.dispose?.(); return null; }
      const initialized = module.initialize?.();
      if (!initialized || !module.ownsRuntime?.()) return api();
      owned = module; ownedApi = initialized;
      module.setMessageFormatter?.(formatMessage || null);
      if (document && !document.getElementById('tp-csb-style')) {
        style = document.createElement('link'); style.id = 'tp-csb-style'; style.rel = 'stylesheet';
        style.href = new URL('../companions/csb-character-state/style.css', import.meta.url).href;
        document.head.append(style);
      }
      return ownedApi;
    })();
    try { return await pending; } finally { pending = null; }
  }
  async function open({id, scope} = {}) {
    const before = context(), expected = scope || sourceScope(before), metadata = before?.chatMetadata;
    if (!expected) throw Error('請先開啟一個聊天。');
    await start();
    if (!alive || sourceScope(context()) !== expected || context()?.chatMetadata !== metadata) throw Error('聊天已切換，請重新開啟角色狀態。');
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
      if (id) notice('已開啟原版角色狀態工坊，請在列表選擇要修改的角色。');
      return {opened: true, legacy: true};
    }
    throw Error('角色狀態工坊尚未啟用，請在擴充功能中啟用後重新整理。');
  }
  return {
    start, open,
    owns: () => !!owned && api() === ownedApi,
    async intercept(...args) {
      if (!alive || !owned || api() !== ownedApi) return;
      await owned.intercept?.(...args);
    },
    dispose() {
      alive = false;
      if (owned && api() === ownedApi) owned.dispose?.();
      owned = ownedApi = null; style?.remove(); style = null;
    },
  };
}

/** Strip only machine-state blocks, leaving raw chat and surrounding prose intact. */
export const stripCharacterStateUpdates = value => String(value ?? '').replace(/<CSB_UPDATE>[\s\S]*?<\/CSB_UPDATE>/g, '');
