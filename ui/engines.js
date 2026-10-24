import {createView, esc, btn, field, input, select, textArea, toggle, heading, help, groupTitle, plate} from './common.js';

const TIERS = {0: '未訂閱', 1: 'Tablet', 2: 'Scroll', 3: 'Opus'};
import {icon, spark} from './icons.js';

export function enginesApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'engines');
  let engine = null, dirty = false, subscription = null, subscriptionError = '', subscriptionStatus = 0, textDraft = null, models = [];
  // ComfyUI: what the last connection check found ({models, samplers, schedulers} or {error}), and the tavern's workflows.
  let comfyInfo = null;
  // The wallet is a stack: the last card is the one in front. A tap on another card draws it to the front; a tap on
  // the front card opens it.
  let order = ['llm', 'comfy', 'gpt', 'nai'];
  const IMAGE = ['nai', 'gpt', 'comfy'];
  const changed = () => { dirty = true; const e = v.root.querySelector('[data-save-state]'); if (e) e.textContent = '未儲存'; };

  /** The text model preset being edited (the draft's active one). */
  const textPreset = () => textDraft.presets.find(p => p.id === textDraft.active) || textDraft.presets[0];
  const nameOf = id => id === 'nai' ? 'NovelAI' : id === 'gpt' ? 'GPT 生圖' : id === 'comfy' ? 'ComfyUI' : id === 'llm' ? '文字模型' : '';
  function card(id, tag = 'button') {
    const comfy = id === 'comfy', saved = comfy ? !!api.getState().draw.comfy.url : api.keyStatus(id), nai = id === 'nai', llm = id === 'llm', d = api.getState().draw;
    const name = nameOf(id), t = llm ? (engine === 'llm' && textDraft ? textDraft : api.getState().text) : null, custom = t?.source === 'custom';
    const fields = id === 'gpt' ? [['MODEL', d.gpt.model], ['QUALITY', d.gpt.quality.toUpperCase()]]
      : comfy ? [['MODEL', d.comfy.model ? d.comfy.model.replace(/\.[^.]*$/, '').slice(0, 18) : '未選'], ['WORKFLOW', d.comfy.workflow ? '自定義' : '預設']]
      : llm
      ? [['SOURCE', custom ? 'CUSTOM API' : 'TAVERN'], ['MODEL', custom ? t.presets.find(p => p.id === t.active)?.model || '未填寫' : '跟隨酒館']]
      : nai
      ? [['TIER', subscription ? TIERS[subscription.tier] || '未知' : '—'], ['ANLAS', subscription ? String(subscription.anlas) : '—']]
      : [];
    const front = order.at(-1) === id;
    const attrs = tag === 'button' ? `data-action="engine" data-engine="${id}" aria-label="${name}，${front ? '點一下開啟' : '點一下抽到最前面'}"` : `data-engine="${id}"`;
    const dots = comfy ? '' : `•••• •••• •••• ${api.keyHint?.(id) || '••••'}`;
    const number = comfy ? d.comfy.url.replace(/^https?:\/\//, '') : llm ? (custom ? (saved ? dots : '未繫結金鑰 · 點卡片去填寫') : '用酒館當前連線的模型') : saved ? dots : '未繫結金鑰 · 點卡片去填寫';
    return `<${tag} class="bank-card${tag === 'div' ? ' detail-card' : ''}" ${attrs}>${spark()}
      <span class="card-top"><span class="card-name">${name}</span><span class="card-kind">${IMAGE.includes(id) ? 'IMAGE' : 'TEXT'}${icon('nfc')}</span></span>
      <span class="card-chip"></span>
      <span class="card-number${number.startsWith('•') || comfy ? '' : ' none'}${comfy ? ' address' : ''}">${number}</span>
      <span class="card-bottom">${fields.map(([k, value]) => `<span><span class="k">${k}</span><span class="v">${esc(value)}</span></span>`).join('')}<span class="card-brand">傳音玉符</span></span></${tag}>`;
  }

  const relayNoSubscription = () => !subscription && subscriptionStatus === 404 && !!api.getState().draw.relay.url;
  /** What the relay check found, one line each for drawing and the subscription. */
  function probeReport(r) {
    const d = r.draw, s = r.subscription, where = r.relay ? '中轉' : 'NovelAI';
    const draw = d.ok ? `✓ 出圖介面通了${d.status === 429 ? '，不過賬號現在正忙（429）' : ''}（只發了一個空請求試探，沒有出圖，不扣 Anlas）`
      : d.status === 0 ? `✗ 連不上${where}：地址不對，或${r.relay ? '中轉沒有允許跨域（CORS）；酒館用 HTTPS 開啟時中轉也要用 HTTPS' : '網路不通'}`
      : [401, 403].includes(d.status) ? `✗ ${where}拒絕了金鑰（${d.status}）：請填寫${r.relay ? '中轉要求的' : '正確的'}金鑰`
      : d.status === 404 ? `✗ 出圖介面 404：外掛請求的是「${esc(api.getState().draw.relay.url || 'https://image.novelai.net')}/ai/generate-image」，${where}不認這個路徑。中轉地址只填到這個路徑前面為止。`
      : `? 出圖介面返回 ${d.status}，說不準能不能出圖，可以直接試著畫一張`;
    const sub = s.ok ? `✓ 讀到訂閱：${TIERS[s.tier] || '未知檔位'}`
      : r.relay && s.status === 404 ? `— 這個中轉不轉發查訂閱，不影響出圖。${api.getState().draw.relay.assumeOpus ? '已經按 Opus 算。' : '想自動出圖，開啟「讀不到訂閱時按 Opus 算」。'}`
      : `✗ 查訂閱失敗：${esc(s.message)}`;
    return `<div class="group pad"><p class="probe-line">${draw}</p><p class="probe-line">${sub}</p></div>`;
  }
  async function loadSubscription(refresh) {
    subscriptionError = ''; subscriptionStatus = 0;
    try { subscription = await api.naiSubscription(refresh); }
    catch (error) { subscription = null; subscriptionError = error.message; subscriptionStatus = error.status || 0; }
    if (!v.disposed) render();
  }

  function renderNovelAI() {
    const saved = api.keyStatus('nai'), d = api.getState().draw;
    v.root.dataset.engine = 'nai';
    v.draw(heading('NovelAI', '', 'Image Card')
      + card('nai', 'div')
      + groupTitle('連線')
      + `<div class="group pad">
          <div class="setting-row"><span>金鑰</span><span class="key-state ${saved ? 'ok' : 'no'}">${saved ? `已儲存${api.keyHint?.(engine) ? '，末尾 ' + esc(api.keyHint(engine)) : ''}` : '還沒有填寫'}</span></div>
          ${field(d.relay.url ? '中轉金鑰' : 'Persistent API Token', input('key', '', 'password', `autocomplete="off" placeholder="${saved ? '已儲存，填寫新的可替換' : d.relay.url ? '填中轉要求的金鑰' : '在 NovelAI 賬戶設定裡獲取，以 pst- 開頭'}"`), d.relay.url ? '用了中轉時，填中轉要求的金鑰（可能就是 NovelAI 的 pst- 金鑰，也可能是中轉自己發的）。金鑰只儲存在當前瀏覽器和酒館地址。' : '外掛直接連線 NovelAI，不經過酒館。金鑰只儲存在當前瀏覽器和酒館地址。')}
          <div class="key-actions">${btn('save-key', icon('key') + '儲存金鑰', 'primary')}${btn('reveal-key', '顯示', 'secondary')}${btn('clear-key', '清除', 'danger')}</div>
        </div>`
      + groupTitle('中轉', help('自己搭的 NovelAI 中轉。中轉的路徑要和官方一樣：出圖 /ai/generate-image，查訂閱 /user/subscription；外掛把請求原樣發到「中轉地址 + 路徑」。留空就直連 NovelAI。\n\n中轉要允許跨域（CORS）；酒館用 HTTPS 開啟時，中轉也要用 HTTPS。'))
      + `<div class="group pad">
          ${field('中轉地址', input('relay', d.relay.url, 'url', 'autocomplete="off" placeholder="留空直連，例如 https://nai.example.com"'))}
          ${d.relay.url ? toggle('relayOpus', '讀不到訂閱時按 Opus 算', d.relay.assumeOpus, '中轉不轉發查訂閱的介面時開啟：28 步、1024×1024 以內的非 V5 小圖當作免費，可以自動出圖。V5 的免費額度讀不到，仍然會先問。賬號不是 Opus 時，這些圖會扣 Anlas。') : ''}
          <div class="key-actions">${btn('save-relay', d.relay.url ? '儲存中轉' : '使用中轉', 'primary')}${d.relay.url ? btn('test-relay', icon('refresh') + '測試連線', 'secondary', saved ? '' : 'disabled') : ''}</div>
        </div>`
      + groupTitle('訂閱', btn('refresh-subscription', icon('refresh') + '重新整理', 'chip-button', saved ? '' : 'disabled'))
      + `<div class="group">
          <div class="setting-row"><span>檔位</span><small>${subscription ? TIERS[subscription.tier] || '未知' : saved ? (relayNoSubscription() ? '中轉不提供' : subscriptionError ? '讀取失敗' : '讀取中') : '—'}</small></div>
          <div class="setting-row"><span>Anlas 餘額</span><strong>${subscription ? subscription.anlas : '—'}</strong></div>
          <div class="setting-row"><span>免費小圖</span><small>${subscription ? (subscription.unlimited ? 'V4.5 及更早：無限（28 步、1024×1024 以內）' : subscription.active ? '僅 Opus 可用：每張圖都會扣 Anlas' : '訂閱未生效：每張圖都會扣 Anlas') : '—'}</small></div>
          ${subscription?.unlimited ? `<div class="setting-row"><span>V5 免費額度</span><small>${subscription.usage ? (subscription.usage.negative || subscription.usage.percent < 2 ? `${subscription.usage.percent}% · 已用完，會扣 Anlas` : `還剩 ${subscription.usage.percent}%，會慢慢恢復`) : '未讀到'}</small></div>` : ''}
        </div>${relayNoSubscription() ? `<p class="hint">這個中轉不轉發查訂閱（外掛請求的是「中轉地址/user/subscription」），出圖不受影響。${d.relay.assumeOpus ? '已經按 Opus 算，小圖會自動出。' : '想讓新回覆自動出圖，開啟上面的「讀不到訂閱時按 Opus 算」。'}點「測試連線」可以單獨檢查出圖介面。</p>` : subscriptionError ? `<p class="error-copy hint">${esc(subscriptionError)}</p>` : ''}`
      + `<div class="group">${toggle('guard', '免費檔守衛', d.guard, '開啟時繪圖引數不會超出免費檔，不會發出扣 Anlas 的請求。')}</div>
        <div class="actions">${btn('open-draw', icon('paint') + '開啟繪圖', 'primary')}</div>`);
  }

  /** The engine the 绘图 App draws with: a line on each image card, with a button to switch to this one. */
  const drawingWith = id => {
    const using = api.getState().draw.engine === id;
    return `<div class="group"><div class="setting-row"><span>繪圖 App 用它來畫</span>${using ? plate('正在用') : btn('use-draw-engine', '改用它畫', 'chip-button', `data-engine="${id}"`)}</div></div>`;
  };
  function renderGpt() {
    const saved = api.keyStatus('gpt'), g = api.getState().draw.gpt;
    v.root.dataset.engine = 'gpt';
    v.draw(heading('GPT 生圖', '', 'Image Card')
      + card('gpt', 'div')
      + drawingWith('gpt')
      + groupTitle('連線')
      + `<div class="group pad">
          <div class="setting-row"><span>金鑰</span><span class="key-state ${saved ? 'ok' : 'no'}">${saved ? `已儲存${api.keyHint('gpt') ? '，末尾 ' + esc(api.keyHint('gpt')) : ''}` : '還沒有填寫'}</span></div>
          ${field(g.url ? '中轉金鑰' : 'OpenAI API Key', input('key', '', 'password', `autocomplete="off" placeholder="${saved ? '已儲存，填寫新的可替換' : g.url ? '填中轉要求的金鑰' : 'sk- 開頭'}"`), '外掛從瀏覽器直接請求 OpenAI（或你填的中轉），金鑰只儲存在當前瀏覽器和酒館地址。每張圖都按對方的價格收費。')}
          <div class="key-actions">${btn('save-key', icon('key') + '儲存金鑰', 'primary')}${btn('reveal-key', '顯示', 'secondary')}${btn('clear-key', '清除', 'danger')}</div>
        </div>`
      + groupTitle('介面', help('留空就直連 OpenAI（https://api.openai.com/v1）。用中轉時填中轉給的地址，寫到 /v1 為止；外掛請求的是「地址/images/generations」。\n\n中轉要允許跨域（CORS）；酒館用 HTTPS 開啟時，中轉也要用 HTTPS。'))
      + `<div class="group pad">
          ${field('介面地址', input('gpt-url', g.url, 'url', 'autocomplete="off" placeholder="留空直連 OpenAI，例如 https://relay.example.com/v1"'))}
          <div class="key-actions">${btn('save-gpt-url', g.url ? '儲存地址' : '使用中轉', 'primary')}</div>
          ${field('模型', input('gpt-model', g.model, 'text', `list="sttts-gpt-models" autocomplete="off" spellcheck="false"`) + `<datalist id="sttts-gpt-models">${api.drawCatalog.gptModels.map(m => `<option value="${esc(m)}">`).join('')}</datalist>`, 'gpt-image 系列畫得最好；dall-e-3 便宜一些但不太聽 tag。中轉上別的模型名（只要是 OpenAI 的 images 介面）也可以直接填。')}
        </div>
        <p class="hint">GPT 讀不懂 NovelAI 的寫法：外掛會把出圖塊裡的英文 tag 和每個人的外貌整理成一段英文描述再發過去；畫師串、權重括號和負面不會發。GPT 的內容稽核比較嚴，被拒時會顯示它給的原因。畫質、畫幅和要不要每張先問，在繪圖 App 的「引數」裡改。</p>
        <div class="actions">${btn('open-draw', icon('paint') + '開啟繪圖', 'primary')}</div>`);
  }
  function renderComfy() {
    const c = api.getState().draw.comfy, info = comfyInfo, models = info?.models || [];
    v.root.dataset.engine = 'comfy';
    const placeholders = '"%prompt%"（正面）、"%negative_prompt%"（負面）、"%seed%"、"%steps%"、"%scale%"、"%width%"、"%height%"、"%sampler%"、"%scheduler%"、"%model%"、"%vae%"、"%denoise%"、"%clip_skip%"';
    v.draw(heading('ComfyUI', '', 'Image Card')
      + card('comfy', 'div')
      + drawingWith('comfy')
      + groupTitle('連線', help('外掛透過酒館伺服器去連 ComfyUI（和酒館自帶的生圖一樣），所以不用開跨域，手機上開啟酒館也能用。\n\n地址要填「酒館所在的電腦」能開啟的地址：ComfyUI 和酒館在同一臺電腦上，就是 http://127.0.0.1:8188；在另一臺電腦上，填那臺電腦的區域網地址，並且 ComfyUI 要用 --listen 啟動。'))
      + `<div class="group pad">
          ${field('ComfyUI 地址', input('comfy-url', c.url, 'url', 'autocomplete="off" placeholder="http://127.0.0.1:8188"'))}
          <div class="key-actions">${btn('save-comfy-url', '儲存地址', 'primary')}${btn('comfy-test', icon('refresh') + '測試並讀取模型', 'secondary')}</div>
          ${info ? `<p class="hint${info.error ? ' error-copy' : ''}" style="padding:0">${esc(info.error || `✓ 連上了：${models.length} 個模型、${info.samplers.length} 個取樣器`)}</p>` : ''}
          ${field('模型', models.length
            ? select('comfy-model', c.model, [['', '請選擇'], ...models.map(m => [m.value, m.text])])
            : input('comfy-model', c.model, 'text', 'autocomplete="off" spellcheck="false" placeholder="點上面「測試並讀取模型」，或直接填檔名"'), '工作流裡 "%model%" 填的就是它（預設工作流用 CheckpointLoaderSimple 讀取）。')}
        </div>`
      + groupTitle('工作流', help(`在 ComfyUI 裡搭好工作流，用「匯出 (API)」（Export (API)）存成 JSON 檔案，點「匯入 JSON 檔案」選它（也可以把內容粘到框裡再儲存）。把需要外掛填的地方寫成佔位符（帶引號）：\n${placeholders}\n\n至少要有 "%prompt%"。留空就用酒館自帶的預設工作流（一個 checkpoint + 一個 KSampler）。酒館的生圖裡存過的工作流可以直接讀進來。`))
      + `<div class="group pad">
          ${textArea('comfy-workflow', c.workflow, `class="code" rows="8" spellcheck="false" placeholder="留空 = 預設工作流"`)}
          <div class="key-actions"><label class="file-pick"><input type="file" accept=".json,application/json" data-comfy-file aria-label="匯入工作流 JSON 檔案"><span>匯入 JSON 檔案</span></label>${btn('comfy-load-wf', '從酒館讀取', 'secondary')}</div>
          <div class="key-actions">${btn('save-comfy-wf', '儲存貼上的工作流', 'primary')}${c.workflow ? btn('comfy-default-wf', '改回預設', 'danger') : ''}</div>
        </div>
        <p class="hint">ComfyUI 沒有 NovelAI 那種分角色的提示詞：外掛把場景和每個人的外貌合成一條提示詞；NovelAI 的權重寫法（{tag}、[tag]、1.2::tag::）會換成 (tag:1.1) 這種。取樣器、步數、尺寸在繪圖 App 的「引數」裡改。</p>
        <div class="actions">${btn('open-draw', icon('paint') + '開啟繪圖', 'primary')}</div>`);
  }
  async function loadComfy() {
    comfyInfo = null; render();
    try { comfyInfo = await api.comfyCatalog(v.root.querySelector('[data-field=comfy-url]')?.value); }
    catch (error) { comfyInfo = {error: error.message, models: [], samplers: [], schedulers: []}; }
    if (!v.disposed && engine === 'comfy') render();
  }

  /** Draws a card to the front of the stack: the cards move from where they were to where they end up (FLIP). */
  function bringFront(id) {
    if (!['llm', ...IMAGE].includes(id)) return;
    const wallet = v.root.querySelector('.wallet');
    order = [...order.filter(x => x !== id), id];
    if (!wallet) return render();
    const before = new Map([...wallet.children].map(el => [el.dataset.engine, el.getBoundingClientRect().top]));
    for (const key of order) { const el = wallet.querySelector(`[data-engine="${key}"]`); if (el) wallet.append(el); }
    const reduce = ctx.win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    for (const el of wallet.children) {
      const key = el.dataset.engine, dy = (before.get(key) ?? 0) - el.getBoundingClientRect().top;
      el.setAttribute('aria-label', `${nameOf(key)}，${key === id ? '點一下開啟' : '點一下抽到最前面'}`);
      if (!dy || reduce) continue;
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
    }
    void wallet.offsetHeight;
    for (const el of wallet.children) { el.style.transition = ''; el.style.transform = ''; }
    wallet.querySelector(`[data-engine="${id}"]`)?.focus({preventScroll: true});
  }

  function renderList() {
    delete v.root.dataset.engine;
    v.draw(heading('接入設定', help('設定手機的文字模型，以及 NovelAI、GPT 生圖和 ComfyUI 的連線。點一張卡片把它抽到最前面，再點一下開啟。\n卡片只顯示金鑰是否儲存，不顯示內容；「已儲存」不代表連線成功。'), 'Connections · 04')
      + `<div class="wallet">${order.map(id => card(id)).join('')}</div>`);
  }

  /** 文字模型: the tavern's model, or an OpenAI-compatible API of the user's own. */
  function renderText() {
    const all = textDraft, t = textPreset(), hint = api.textKeyHint?.(t.id) || '', saved = !!hint, custom = all.source === 'custom';
    v.root.dataset.engine = 'llm';
    v.draw(heading('文字模型', '', 'Text Card')
      + card('llm', 'div')
      + groupTitle('誰來寫手機裡的字', help('手機裡的字：聊天回覆、朋友圈、來電，以及正文配圖時挑畫面。正文字身始終用酒館的模型。\n酒館主模型：和正文一樣，用酒館當前連線的模型，換了酒館的模型手機也跟著換。\n自定義介面：用你自己的 OpenAI 相容介面，不佔用酒館正在用的模型，正文和手機可以用不同的模型。外掛直接從瀏覽器連線這個介面，不經過酒館。'))
      + `<div class="group pad"><div class="segmented" style="margin:0">${[['tavern', '酒館主模型'], ['custom', '自定義介面']].map(([k, l]) => `<button type="button" data-action="text-source" data-source="${k}" aria-pressed="${all.source === k}">${l}</button>`).join('')}</div>
</div>`
      + (custom ? groupTitle('介面預設', help('可以存好幾套自定義介面：地址、模型、金鑰、溫度、長度各一份，點一下切換正在用的那套。每套的金鑰分開儲存；刪掉一套，它的金鑰也一起刪掉。切換、新建、刪除和改名都要點下面的「儲存」才生效。'))
        + `<div class="group pad"><div class="text-presets">${all.presets.map(p => `<button type="button" class="combo-chip" data-action="text-preset" data-id="${esc(p.id)}" aria-pressed="${p.id === all.active}">${esc(p.name)}</button>`).join('')}${btn('text-new', icon('add') + '新建', 'chip-button')}</div>
          ${field('預設名字', input('text-name', t.name, 'text', 'maxlength="40" autocomplete="off"'))}
          ${all.presets.length > 1 ? `<div class="actions" style="margin-top:0">${btn('text-delete', icon('trash') + '刪除這套', 'danger')}</div>` : ''}</div>`
        + groupTitle('連線') + `<div class="group pad">
          ${field('介面地址', input('text-url', t.url, 'url', 'autocomplete="off" placeholder="https://api.openai.com/v1"'), '填到 /v1 為止，後面的 /chat/completions 不用寫。OpenAI 格式的服務都可以：OpenAI、DeepSeek、OpenRouter、矽基流動、各種中轉站。介面要允許網頁直接訪問（CORS），不然瀏覽器會攔下請求。')}
          <div class="setting-row"><span>金鑰</span><span class="key-state ${saved ? 'ok' : 'no'}">${saved ? `已儲存，末尾 ${esc(hint)}` : '還沒有填寫'}</span></div>
          ${field('API Key', input('key', '', 'password', `autocomplete="off" placeholder="${saved ? '已儲存，填寫新金鑰可替換' : '這個介面的金鑰（本地模型可以不填）'}"`), '金鑰只儲存在當前瀏覽器和酒館地址，不會寫進設定或備份。')}
          <div class="key-actions">${btn('save-key', icon('key') + '儲存金鑰', 'primary')}${btn('reveal-key', '顯示', 'secondary')}${btn('clear-key', '清除', 'danger')}</div>
          ${field('模型', input('text-model', t.model, 'text', 'autocomplete="off" placeholder="例如 gpt-4o-mini、deepseek-chat"'))}
          <div class="actions">${btn('text-models', icon('refresh') + '讀取模型列表', 'secondary')}</div>
          <div class="combo-menu model-list" data-model-list ${models.length ? '' : 'hidden'}>${models.map(m => `<button type="button" class="combo-chip" data-action="text-pick" data-model="${esc(m)}" aria-pressed="${m === t.model}">${esc(m)}</button>`).join('')}</div>
          <p class="hint" data-text-status></p>
          ${field('溫度', input('text-temperature', t.temperature, 'number', 'min="0" max="2" step="0.05"'), '越高越隨性，越低越穩定。0.7–1 比較常用。')}
          ${field('最長回覆（tokens）', input('text-maxTokens', t.maxTokens, 'number', 'min="64" max="32000" step="1"'), '一次回覆最多寫多少。聊天和電話用不了多少，配圖規劃會按需要取更小的值。')}
        </div>` : '')
      + `<div class="savebar"><span class="save-state" data-save-state>${dirty ? '未儲存' : '已儲存'}</span>${btn('save-text', '儲存', 'primary')}</div>`);
  }

  const render = () => engine === 'nai' ? renderNovelAI() : engine === 'gpt' ? renderGpt() : engine === 'comfy' ? renderComfy() : engine === 'llm' ? renderText() : renderList();
  function edit(id) {
    if (!['llm', ...IMAGE].includes(id)) return;
    engine = id;
    if (!order.length || order.at(-1) !== id) order = [...order.filter(x => x !== id), id];
    if (id === 'llm') { textDraft = structuredClone(api.getState().text); dirty = false; render(); v.root.scrollTop = 0; return; }
    if (id === 'nai') { render(); v.root.scrollTop = 0; loadSubscription(false); return; }
    if (id === 'gpt' || id === 'comfy') { render(); v.root.scrollTop = 0; return; }
  }
  v.edit = edit;
  v.back = () => { if (!engine) return false; engine = null; render(); return true; };
  v.refresh = () => { if (!engine) render(); };
  if (api.keyStatus('nai')) loadSubscription(false);

  v.on('change', '[data-field]', el => {
    if (el.dataset.field === 'key') return;
    if (engine === 'llm') {
      const key = el.dataset.field.replace(/^text-/, '');
      if (!['name', 'url', 'model', 'temperature', 'maxTokens'].includes(key)) return;
      textPreset()[key] = ['temperature', 'maxTokens'].includes(key) ? Number(el.value) : el.value.trim();
      changed();
      return;
    }
    if (el.dataset.field === 'gpt-model') { try { api.saveDraw({gpt: {model: el.value.trim()}}); ctx.notify('模型已儲存'); } catch (error) { ctx.notify(error.message); } render(); return; }
    if (el.dataset.field === 'comfy-model') { api.saveDraw({comfy: {model: el.value.trim()}}); render(); return; }
    if (['gpt-url', 'comfy-url', 'comfy-workflow'].includes(el.dataset.field)) return;
    if (el.dataset.field === 'guard') { api.saveDraw({guard: el.checked}); render(); return; }
    if (el.dataset.field === 'relayOpus') { api.saveDraw({relay: {assumeOpus: el.checked}}); render(); return; }
    if (el.dataset.field === 'relay') return;
  });
  // ComfyUI: a workflow JSON file, checked and saved as it is chosen.
  v.on('change', '[data-comfy-file]', async el => {
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    try {
      if (file.size > 300000) throw Error('工作流太大了（超過 300 KB）');
      api.saveDraw({comfy: {workflow: await file.text()}});
      render(); ctx.notify('已匯入「' + file.name.replace(/\.json$/i, '') + '」');
    } catch (error) { ctx.notify(error.message); }
  });
  v.on('click', '[data-action]', async el => {
    switch (el.dataset.action) {
      case 'engine': if (order.at(-1) === el.dataset.engine) edit(el.dataset.engine); else bringFront(el.dataset.engine); break;
      case 'text-source': textDraft.source = el.dataset.source; changed(); dirty = true; render(); break;
      case 'text-preset': if (textDraft.active !== el.dataset.id) { textDraft.active = el.dataset.id; models = []; changed(); dirty = true; render(); } break;
      case 'text-new': {
        const id = crypto.randomUUID(), now = textPreset();
        textDraft.presets.push({id, name: '介面 ' + (textDraft.presets.length + 1), url: '', model: '', temperature: now.temperature, maxTokens: now.maxTokens});
        textDraft.active = id; models = []; changed(); dirty = true; render();
        v.root.querySelector('[data-field=text-name]')?.focus();
        break;
      }
      case 'text-delete': {
        const gone = textPreset();
        if (textDraft.presets.length < 2 || !await ctx.confirm('刪除這套介面？', `「${gone.name}」和它的金鑰會被刪掉（點「儲存」後生效），其他的保留。`)) break;
        textDraft.presets = textDraft.presets.filter(p => p.id !== gone.id); textDraft.active = textDraft.presets[0].id; models = []; changed(); dirty = true; render();
        break;
      }
      case 'save-text': api.saveText(textDraft); textDraft = structuredClone(api.getState().text); dirty = false; render(); ctx.notify('文字模型已儲存'); break;
      case 'text-pick': {
        textPreset().model = el.dataset.model;
        const box = v.root.querySelector('[data-field=text-model]');
        if (box) box.value = textPreset().model;
        for (const chip of v.root.querySelectorAll('[data-action=text-pick]')) chip.setAttribute('aria-pressed', String(chip === el));
        changed();
        break;
      }
      case 'text-models': {
        const status = () => v.root.querySelector('[data-text-status]');
        await v.busy(el, async () => {
          try {
            models = await api.textModels(textDraft);
            render();
            if (status()) status().textContent = models.length ? `連線成功，讀到 ${models.length} 個模型，點一個就能選上` : '連線成功，但這個介面沒有列出模型，直接填寫模型名就好';
          } catch (error) { if (status()) status().textContent = error.message; }
        });
        break;
      }
      case 'save-key':
        if (engine === 'llm') api.setTextKey(textDraft.active, v.root.querySelector('[data-field=key]').value);
        else api.setKey(engine, v.root.querySelector('[data-field=key]').value);
        render(); ctx.notify('金鑰已儲存');
        if (engine === 'nai') loadSubscription(true);
        break;
      case 'refresh-subscription': await v.busy(el, () => loadSubscription(true)); break;
      case 'save-relay': {
        const url = v.root.querySelector('[data-field=relay]').value;
        api.saveDraw({relay: {url}});
        subscription = null; render();
        ctx.notify(api.getState().draw.relay.url ? '中轉地址已儲存' : '已改回直連 NovelAI');
        if (api.keyStatus('nai')) loadSubscription(true);
        break;
      }
      case 'test-relay': await v.busy(el, async () => {
        const result = await api.naiProbe();
        await loadSubscription(false);
        ctx.dialog('測試連線', probeReport(result));
      }); break;
      case 'open-draw': ctx.open('draw'); break;
      case 'use-draw-engine': api.saveDraw({engine: el.dataset.engine}); render(); ctx.notify(`繪圖改用 ${nameOf(el.dataset.engine)} 畫`); break;
      case 'save-gpt-url': {
        api.saveDraw({gpt: {url: v.root.querySelector('[data-field=gpt-url]').value}});
        render(); ctx.notify(api.getState().draw.gpt.url ? '介面地址已儲存' : '已改回直連 OpenAI');
        break;
      }
      case 'save-comfy-url': api.saveDraw({comfy: {url: v.root.querySelector('[data-field=comfy-url]').value}}); render(); ctx.notify('ComfyUI 地址已儲存'); break;
      case 'comfy-test': await v.busy(el, loadComfy); break;
      case 'save-comfy-wf': api.saveDraw({comfy: {workflow: v.root.querySelector('[data-field=comfy-workflow]').value}}); render(); ctx.notify(api.getState().draw.comfy.workflow ? '工作流已儲存' : '工作流是空的，用預設工作流'); break;
      case 'comfy-default-wf': if (await ctx.confirm('改回預設工作流？', '現在這份工作流會被清掉。')) { api.saveDraw({comfy: {workflow: ''}}); render(); } break;
      case 'comfy-load-wf': await v.busy(el, async () => {
        const names = await api.comfyWorkflows();
        if (!names.length) { ctx.notify('酒館裡還沒有存過工作流'); return; }
        const d = ctx.dialog('從酒館讀取工作流', `<div class="group">${names.map(n => `<button class="list-row" data-wf="${esc(n)}"><span><strong>${esc(n.replace(/\.json$/i, ''))}</strong></span>${icon('next')}</button>`).join('')}</div>`);
        d.body.addEventListener('click', async e => {
          const b = e.target.closest('[data-wf]');
          if (!b) return;
          d.close();
          try { api.saveDraw({comfy: {workflow: await api.comfyWorkflow(b.dataset.wf)}}); render(); ctx.notify('已讀入「' + b.dataset.wf.replace(/\.json$/i, '') + '」'); }
          catch (error) { ctx.notify(error.message); }
        });
      }); break;
      case 'clear-key': if (engine === 'llm') { if (await ctx.confirm('清除這套介面的金鑰？', '其他介面預設的金鑰不受影響。')) { api.clearTextKey(textDraft.active); render(); } break; }
        if (await ctx.confirm('清除金鑰？', '之後使用這個引擎需要重新填寫。')) { api.clearKey(engine); if (engine === 'nai') subscription = null; render(); } break;
      case 'reveal-key': {
        const field = v.root.querySelector('[data-field=key]');
        field.type = field.type === 'password' ? 'text' : 'password';
        el.textContent = field.type === 'password' ? '顯示' : '隱藏';
        break;
      }
    }
  });

  render();
  return v;
}
