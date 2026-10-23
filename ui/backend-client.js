/** Connect only from the settings iframe mounted by this extension. */
export function connectBackend(view = window) {
    let bridge;
    try { bridge = view.parent.__stIphoniePanelBridge; }
    catch { throw Error('請從酒館的 ST-iPhonie 入口開啟小手機'); }
    if (!bridge?.connect) throw Error('請從酒館的 ST-iPhonie 入口開啟小手機');
    const api = bridge.connect(view);
    if (api.apiVersion?.split('.')[0] !== '1') throw Error('功能層版本不匹配，請更新完整外掛');
    return api;
}