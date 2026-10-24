import {createView, heading, btn, esc} from '../ui/common.js';

/** A view into the original CSB database, never a second editable copy. */
export function characterInfoApp(ctx) {
  const v = createView(ctx, 'characterinfo');
  let mounted = null, scope = '', epoch = 0, pending = null;
  v.draw(heading('角色信息', '', '人物卷宗') +
    '<p class="character-info-intro">已設定的信息會持續保存。正文只更新有明確變化的條目，離場與未提及都不會清空資料。</p>' +
    '<label class="character-info-toggle"><span><strong>在正文顯示狀態欄</strong><small>關閉後，角色信息仍會保存及更新。</small></span><input type="checkbox" class="switch" data-character-inline aria-label="在正文顯示狀態欄"></label>' +
    '<p class="character-info-feedback" role="status" data-character-feedback>正在讀取角色信息…</p>' +
    '<div class="character-info-host" data-character-info-mount></div>' +
    '<div class="actions">' + btn('character-manager', '欄位設定與匯入備份', 'secondary') + '</div>');
  const host = v.root.querySelector('[data-character-info-mount]');
  const toggle = v.root.querySelector('[data-character-inline]');
  const feedback = v.root.querySelector('[data-character-feedback]');
  async function update() {
    const ticket = ++epoch;
    try {
      const snapshot = await ctx.api.characterInfoSnapshot();
      if (v.disposed || ticket !== epoch) return;
      if (!snapshot?.enabled) throw Error('角色信息目前未啟用。');
      toggle.checked = snapshot.inlineCards !== false;
      if (scope !== snapshot.scope || !mounted) {
        mounted?.dispose(); mounted = null; host.replaceChildren(); scope = snapshot.scope;
        const next = await ctx.api.mountCharacterInfo(host, {scope});
        if (v.disposed || ticket !== epoch) { next?.dispose(); return; }
        mounted = next;
      } else mounted.refresh?.();
      feedback.textContent = `${Object.keys(snapshot.state?.characters || {}).length} 位角色 · 修改後自動保存`;
      feedback.classList.remove('error');
    } catch (error) {
      if (v.disposed || ticket !== epoch) return;
      feedback.textContent = error.message || String(error);
      feedback.classList.add('error');
    }
  }
  v.refresh = () => {
    if (pending) return pending;
    pending = update().finally(() => { pending = null; });
    return pending;
  };
  v.on('change', '[data-character-inline]', async el => {
    const enabled = el.checked; el.disabled = true;
    try {
      await ctx.api.setCharacterInfoInline(enabled, {scope});
      feedback.textContent = enabled ? '正文狀態欄已開啟，角色信息持續保存。' : '正文狀態欄已關閉，角色信息仍持續保存。';
    } catch (error) { el.checked = !enabled; throw error; }
    finally { el.disabled = false; }
  });
  v.on('click', '[data-action="character-manager"]', () => ctx.api.pocketOpenStateManager());
  const dispose = v.dispose;
  v.dispose = () => { epoch++; mounted?.dispose(); mounted = null; dispose(); };
  v.refresh();
  return v;
}
