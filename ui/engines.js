import {createView, esc, engines, btn, field, input, select, textArea, toggle, heading, help, groupTitle, plate} from './common.js';

const TIERS = {0: '未訂閱', 1: 'Tablet', 2: 'Scroll', 3: 'Opus'};
import {icon, spark} from './icons.js';

export function enginesApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'engines'), drafts = new Map();
  let engine = null, dirty = false, subscription = null, subscriptionError = '', subscriptionStatus = 0, textDraft = null, models = [];
  // ComfyUI: what the last connection check found ({models, samplers, schedulers} or {error}), and the tavern's workflows.
  let comfyInfo = null;
  // The wallet is a stack: the last card is the one in front. A tap on another card draws it to the front; a tap on
  // the front card opens it.
  let order = ['llm', ...Object.keys(engines), 'comfy', 'gpt', 'nai'];
  const IMAGE = ['nai', 'gpt', 'comfy'];
  // Voice balances shown on the ElevenLabs and Fish cards: engine -> {value, error, loading}.
  const balances = new Map(), PRICED = ['eleven', 'fish'];
  const number = n => Number(n).toLocaleString('zh-TW');
  const balanceText = id => {
    const b = balances.get(id)?.value;
    if (!b) return '—';
    return b.kind === 'characters' ? number(b.left) : '$' + b.credit.toFixed(2);
  };
  async function loadBalance(id, refresh = false) {
    if (!PRICED.includes(id) || !api.keyStatus(id)) return;
    const entry = balances.get(id) || {};
    balances.set(id, {...entry, loading: true});
    try { balances.set(id, {value: await api.voiceBalance(id, refresh), error: '', loading: false}); }
    catch (error) { balances.set(id, {value: entry.value || null, error: error.message, loading: false}); }
    if (!v.disposed && (engine === null || engine === id)) render();
  }
  const draft = () => drafts.get(engine);
  const changed = () => { dirty = true; const e = v.root.querySelector('[data-save-state]'); if (e) e.textContent = '未儲存'; };

  /** 已保存，末尾 ab12 · or, with several keys: 已保存 3 个，正在用第 2 个（末尾 ab12），1 个这次被拒已跳过. */
  const keyState = id => {
    const tail = api.keyHint?.(id) || '', pool = api.keyPool?.(id);
    if (!pool || pool.count < 2) return '已儲存' + (tail ? '，末尾 ' + esc(tail) : '');
    return `已儲存 ${pool.count} 個，正在用第 ${pool.current} 個${tail ? '（末尾 ' + esc(tail) + '）' : ''}${pool.refused ? `，${pool.refused} 個這次被拒已跳過` : ''}`;
  };
  /** The saved keys of a voice engine, one row each: never the key, only its last characters. */
  const keyRows = id => {
    const list = api.keyList?.(id) || [];
    if (!list.length) return '';
    return `<div class="key-list">${list.map((k, i) => `<div class="key-row${k.current ? ' current' : ''}"><span class="key-no" aria-label="第 ${i + 1} 個">${i + 1}</span><span class="mono">•••• ${esc(k.tail)}</span>${k.current ? plate('正在用') : ''}${k.refused ? '<small class="error-copy">這次被拒</small>' : ''}${!k.current && list.length > 1 ? `<button class="text-button" data-action="use-key" data-index="${i}" aria-label="改用第 ${i + 1} 個金鑰">用這個</button>` : ''}<button class="text-button" data-action="remove-key" data-index="${i}" aria-label="刪除第 ${i + 1} 個金鑰">刪除</button></div>`).join('')}</div>`;
  };
  /** The text model preset being edited (the draft's active one). */
  const textPreset = () => textDraft.presets.find(p => p.id === textDraft.active) || textDraft.presets[0];
  const nameOf = id => id === 'nai' ? 'NovelAI' : id === 'gpt' ? 'GPT 生圖' : id === 'comfy' ? 'ComfyUI' : id === 'llm' ? '文字模型' : engines[id];
  function card(id, tag = 'button') {
    const comfy = id === 'comfy', saved = comfy ? !!api.getState().draw.comfy.url : api.keyStatus(id), nai = id === 'nai', llm = id === 'llm', d = api.getState().draw;
    const name = nameOf(id), t = llm ? (engine === 'llm' && textDraft ? textDraft : api.getState().text) : null, custom = t?.source === 'custom';
    const fields = id === 'gpt' ? [['MODEL', d.gpt.model], ['QUALITY', d.gpt.quality.toUpperCase()]]
      : comfy ? [['MODEL', d.comfy.model ? d.comfy.model.replace(/\.[^.]*$/, '').slice(0, 18) : '未選'], ['WORKFLOW', d.comfy.workflow ? '自定義' : '預設']]
      : llm
      ? [['SOURCE', custom ? 'CUSTOM API' : 'TAVERN'], ['MODEL', custom ? t.presets.find(p => p.id === t.active)?.model || '未填寫' : '跟隨酒館']]
      : nai
      ? [['TIER', subscription ? TIERS[subscription.tier] || '未知' : '—'], ['ANLAS', subscription ? String(subscription.anlas) : '—']]
      : PRICED.includes(id) && saved
        ? [['MODEL', api.getState().connections[id].model], [id === 'eleven' ? 'CREDITS' : 'BALANCE', balanceText(id)]]
        : [['MODEL', api.getState().connections[id].model], ['ROLES', api.getState().routes.filter(r => r.engine === id && r.voice).length + ' 個角色']];
    const front = order.at(-1) === id;
    const attrs = tag === 'button' ? `data-action="engine" data-engine="${id}" aria-label="${name}，${front ? '點一下開啟' : '點一下抽到最前面'}"` : `data-engine="${id}"`;
    const dots = comfy ? '' : `•••• •••• •••• ${api.keyHint?.(id) || '••••'}`;
    const number = comfy ? d.comfy.url.replace(/^https?:\/\//, '') : llm ? (custom ? (saved ? dots : '未繫結金鑰 · 點卡片去填寫') : '用酒館當前連線的模型') : saved ? dots : '未繫結金鑰 · 點卡片去填寫';
    return `<${tag} class="bank-card${tag === 'div' ? ' detail-card' : ''}" ${attrs}>${spark()}
      <span class="card-top"><span class="card-name">${name}</span><span class="card-kind">${IMAGE.includes(id) ? 'IMAGE' : llm ? 'TEXT' : 'VOICE'}${icon('nfc')}</span></span>
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

  function control(f, c, rowIndex = null, parent = null) {
    const value = rowIndex === null ? c.params[f.key] : c.params[parent.key][rowIndex][f.key];
    const reason = parent?.unavailable || f.unavailable || '';
    const attrs = `data-param="${esc(parent?.key || f.key)}" ${rowIndex !== null ? `data-row="${rowIndex}" data-column="${esc(f.key)}"` : ''} aria-label="${esc(f.label)}" ${reason ? 'disabled' : ''}`;
    const note = [f.help, reason, '官方欄位：' + (parent ? parent.key + '.' : '') + f.key].filter(Boolean).join('\n');
    if (f.type === 'rows') {
      return `<div class="parameter-field" aria-disabled="${!!reason}"><div class="row-heading"><span>${esc(f.label)}${help(note)}</span>${btn('add-row', icon('add') + '增加', 'chip-button', `data-param-key="${esc(f.key)}" ${reason || value.length >= f.max ? 'disabled' : ''}`)}</div>${value.map((row, i) => `<div class="parameter-row">${f.columns.map(col => control(col, c, i, f)).join('')}${btn('remove-row', '刪除這一條', 'text-button', `data-param-key="${esc(f.key)}" data-index="${i}" ${reason ? 'disabled' : ''}`)}</div>`).join('')}</div>`;
    }
    if (f.type === 'boolean') return `<div class="setting-row"><span>${esc(f.label)}${help(note)}</span><input type="checkbox" class="switch" ${attrs} ${value ? 'checked' : ''}></div>`;
    let html;
    if (f.type === 'select') html = `<span class="select"><select ${attrs}>${f.options.map(([option, label]) => `<option value="${esc(option)}" ${value === option ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></span>`;
    // The browser's own file box says 「未选择任何文件」 again once the page redraws, although the audio is kept: a button
    // that says what is there instead.
    else if (f.type === 'file') html = `<label class="file-pick${value ? ' done' : ''}"><input type="file" accept="audio/*,.wav,.mp3,.flac,.m4a,.ogg,.opus" ${attrs}><span>${value ? '✓ 已存好 · 點這裡換一個' : '選擇音訊檔案'}</span></label>`;
    else if (['textarea', 'lines'].includes(f.type)) html = `<textarea rows="4" ${attrs}>${esc(value)}</textarea>`;
    else html = `<input type="${f.type === 'number' ? 'number' : 'text'}" ${attrs} value="${esc(value)}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} ${f.step !== undefined ? `step="${f.step}"` : ''}>`;
    return field(f.label, html, note);
  }

  /** Draws a card to the front of the stack: the cards move from where they were to where they end up (FLIP). */
  function bringFront(id) {
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
    v.draw(heading('靈樞', help('每個服務一張卡：文字模型、四家語音引擎（Fish Audio、MiniMax、ElevenLabs、小米 MiMo），加上繪圖用的 NovelAI、GPT 生圖和 ComfyUI（繪圖 App 裡選用哪個畫）。點一張卡片把它抽到最前面，再點一下開啟，檢視連線和全部引數。ElevenLabs 和 Fish 的卡片上顯示剩餘額度。\n卡片只顯示金鑰是否儲存，不顯示內容；“已儲存”不代表鑑權成功。'), 'Wallet · 05')
      + `<div class="wallet">${order.map(id => card(id)).join('')}</div>`);
    for (const id of PRICED) if (!balances.has(id)) loadBalance(id);
  }
  /** The 额度 group of the ElevenLabs and Fish cards. */
  /** Fish relay (中转): an address in front of Fish Audio, saved on its own, and a check of what it forwards. */
  function fishRelay() {
    const fish = api.getState().connections.fish, relay = fish.relay || '';
    return `${field('中轉地址', input('relay', relay, 'url', 'autocomplete="off" placeholder="留空直連 Fish Audio，例如 https://fish.example.com"'), '用中轉（公益站、自己搭的反代）時填這裡，留空就直連 Fish Audio。\n\n外掛會把請求發到「中轉地址」加上 Fish 官方的路徑：合成 /compat/v1/audio/speech，音色列表 /model，餘額 /wallet/self/api-credit。所以只填到這些路徑前面為止；把完整地址粘進來也行，會自動去掉。\n\n中轉要允許網頁直接訪問（CORS）；酒館用 HTTPS 開啟時，中轉也要是 HTTPS。金鑰填中轉要求的那個（可能是 Fish 的，也可能是站長髮的），一樣可以存好幾個。')}
      ${relay ? field('中轉介面格式', select('relayApi', fish.relayApi || 'fish', [['fish', 'Fish 官方路徑（/compat/v1/audio/speech）'], ['openai', 'OpenAI 格式（/v1/audio/speech）']]), '儲存中轉或者測試連線時會自動認出來，一般不用自己選。\n\nOpenAI 格式的中轉只收文字、音色 ID、模型和語速：情緒標籤寫在文字裡，照樣有效；沒有音色列表（音色 ID 手動填）、不能帶參考音訊、看不到餘額，溫度等其他引數由中轉決定。') : ''}
      <div class="key-actions">${btn('save-fish-relay', relay ? '儲存中轉' : '使用中轉', 'primary')}${btn('test-fish-relay', icon('refresh') + '測試連線', 'secondary', api.keyStatus('fish') ? '' : 'disabled')}</div>`;
  }
  function fishProbeReport(r, switched = '') {
    const where = r.relay ? '中轉' : 'Fish Audio', path = p => `「${esc(r.base)}${p}」`;
    const speech = r.speech.status === 0 ? `✗ 連不上${where}：地址不對，或${r.relay ? '中轉沒有允許跨域（CORS）；酒館用 HTTPS 開啟時中轉也要用 HTTPS' : '網路不通'}`
      : [401, 403].includes(r.speech.status) ? `✗ ${where}拒絕了金鑰（${r.speech.status}）：請填寫${r.relay ? '中轉要求的' : '正確的'}金鑰`
      : r.speech.status === 404 ? `✗ 合成介面 404：試過${path('/compat/v1/audio/speech')}${r.relay ? `和「${esc(r.openaiUrl || r.base + '/v1/audio/speech')}」` : ''}，${where}都不認。中轉地址只填到這些路徑前面為止；如果這個中轉用的是別的路徑，把它的說明發給外掛作者。`
      : r.speech.status === 402 ? `✓ 合成介面通了，但${where}說額度不夠（402）`
      : r.speech.status === 429 ? `✓ 合成介面通了，現在請求太多（429），稍後再試`
      : r.speech.status >= 500 ? `✗ ${where}自己出錯了（HTTP ${r.speech.status}），稍後再試或者問問站長`
      : `✓ 合成介面通了（測試請求故意是空的，返回 ${r.speech.status} 是正常的）`;
    const kind = switched ? `<p class="probe-line">✓ 這個中轉是${switched === 'openai' ? ' OpenAI 格式（/v1/audio/speech）' : ' Fish 官方路徑'}，已經自動切換</p>` : '';
    const voices = (r.detected || r.api) === 'openai' ? '— 這種中轉沒有音色列表：在角色的「音色」裡直接填 Fish 的音色 ID' : r.voices.ok ? '✓ 音色列表也能讀' : r.voices.status === 0 ? '— 讀不到音色列表（不影響合成，音色 ID 可以手動填）' : `— 音色列表返回 ${r.voices.status}（不影響合成，音色 ID 可以手動填）`;
    return `<div class="group pad">${kind}<p class="probe-line">${speech}</p><p class="probe-line">${voices}</p></div>`;
  }
  /** Checks the relay and, when it speaks the other form, switches to it. Returns the form it switched to ('' if none). */
  async function detectFish() {
    const r = await api.fishProbe();
    let switched = '';
    if (r.relay && r.detected && r.detected !== r.api) { api.saveConnection('fish', {relayApi: r.detected}); draft().relayApi = r.detected; switched = r.detected; balances.delete('fish'); }
    return {r, switched};
  }
  function balanceGroup() {
    if (!PRICED.includes(engine)) return '';
    const saved = api.keyStatus(engine), entry = balances.get(engine) || {}, b = entry.value;
    const state = !saved ? '填寫金鑰後可以檢視' : entry.loading && !b ? '讀取中' : entry.error && !b ? '讀取失敗' : '';
    let rows;
    if (b?.kind === 'characters') {
      const ratio = b.limit ? Math.min(1, b.used / b.limit) : 0;
      const status = {active: '生效中', trialing: '試用中', past_due: '待付款', incomplete: '未完成付款', free_disabled: '免費額度已停用'}[b.status] || '';
      const tier = b.tier ? b.tier.charAt(0).toUpperCase() + b.tier.slice(1).replace(/_/g, ' ') : '未知';
      rows = `<div class="setting-row"><span>檔位</span><small>${esc(tier)}${status ? ' · ' + status : ''}</small></div>
        <div class="field balance-meter"><div class="meter-label"><span>本期已用</span><output>${number(b.used)} / ${number(b.limit)}</output></div><span class="meter-track" role="img" aria-label="已用 ${Math.round(ratio * 100)}%"><i style="width:${(ratio * 100).toFixed(1)}%"></i></span></div>
        <div class="setting-row"><span>剩餘額度</span><strong>${number(b.left)}</strong></div>
        <div class="setting-row"><span>下次重置</span><small>${b.resetAt ? new Date(b.resetAt).toLocaleString('zh-TW', {hour12: false}) : '—'}</small></div>`;
    } else if (b?.kind === 'credit') {
      rows = `<div class="setting-row"><span>API 餘額</span><strong>$${b.credit.toFixed(2)}</strong></div>
        <div class="setting-row"><span>免費額度</span><small>${b.free ? '還有' : '沒有或已用完'}</small></div>`;
    } else rows = `<div class="setting-row"><span>額度</span><small>${state || '—'}</small></div>`;
    return groupTitle('額度', btn('refresh-balance', icon('refresh') + '重新整理', 'chip-button', saved ? '' : 'disabled'))
      + `<div class="group${b?.kind === 'characters' ? ' pad' : ''}">${rows}</div>${entry.error ? `<p class="error-copy hint">${esc(entry.error)}</p>` : ''}`
      + `<p class="hint">${engine === 'eleven' ? '每生成一句新語音後自動重新讀取。ElevenLabs 按字元扣積分，v3/v4 等模型的倍率以官網為準。' : '每生成一句新語音後自動重新讀取。金額是 Fish Audio 後臺的 API 餘額。'}</p>`;
  }

  function renderDetail() {
    const schema = api.engineSchema(engine, draft());
    drafts.set(engine, schema.connection);
    const c = draft(), saved = api.keyStatus(engine);
    v.root.dataset.engine = engine;
    const unsupported = schema.models.filter(m => !m.supported).map(m => m.id + '：' + m.reason).join('\n');
    v.draw(heading(engines[engine], '', 'Engine Card')
      + card(engine, 'div')
      + groupTitle('連線')
      + `<div class="group pad">
          <div class="setting-row"><span>金鑰</span><span class="key-state ${saved ? 'ok' : 'no'}">${saved ? keyState(engine) : '還沒有填寫'}</span></div>
          ${keyRows(engine)}
          ${field(saved ? '新增金鑰' : 'API Key', textArea('key', '', `rows="2" class="code" autocomplete="off" spellcheck="false" placeholder="${saved ? '貼上新的金鑰，會加在後面' : '貼上金鑰；有多個賬號可以每行一個'}"`), '可以儲存多個賬號的金鑰，新加的排在後面，不用的可以單獨刪掉。先用排在前面的；某個金鑰被拒（401、403）、額度用完（402）或請求太頻繁（429）時，自動換下一個重試，這次開啟頁面裡不再用它。想手動換，點那個金鑰的「用這個」：馬上改用它，並把它排到第一個，以後開啟也先用它。\n\n金鑰只儲存在當前瀏覽器和酒館地址，按賬戶分別儲存。')}
          <div class="key-actions">${btn('add-key', icon('key') + (saved ? '新增' : '儲存金鑰'), 'primary')}${saved ? btn('clear-key', '全部清除', 'danger') : ''}</div>
          ${field('預設模型', select('model', c.model, schema.models.map(m => [m.id, m.id, !m.supported])), unsupported || '角色沒有單獨指定模型時使用這裡的模型。')}
          ${engine === 'mini' ? field('服務區域', select('region', c.region, [['cn', '國內'], ['global', '國際'], ['uw', '國際 · 低延遲入口']])) : ''}
          ${engine === 'fish' ? fishRelay() : ''}
          <div class="actions">${btn('read-voices', icon('refresh') + '讀取音色列表', 'secondary')}</div><p class="hint" data-connection-status></p>
        </div>`
      + balanceGroup()
      + groupTitle('引數')
      + schema.groups.map((g, i) => `<details data-group="${engine}:${g.id}" ${i === 0 ? 'open' : ''}><summary>${esc(g.title)}</summary><div>${g.fields.map(f => control(f, c)).join('')}</div></details>`).join('')
      + `<details data-group="tags"><summary>情緒與語氣標籤</summary><div>${schema.tagNote ? `<p class="hint">${esc(schema.tagNote)}</p>` : ''}<div class="tags">${schema.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>${engine === 'mini' && c.model.startsWith('speech-2.8') ? '<div class="tags">' + ['laughs', 'chuckle', 'coughs', 'clear-throat', 'groans', 'breath', 'pant', 'inhale', 'exhale', 'gasps', 'sniffs', 'sighs', 'snorts', 'burps', 'lip-smacking', 'humming', 'hissing', 'emm', 'sneezes'].map(x => `<span class="tag">(${x})</span>`).join('') + '</div>' : ''}${schema.sounds?.length ? '<div class="tags">' + schema.sounds.map(x => `<span class="tag">(${esc(x)})</span>`).join('') + '</div>' : ''}<a href="${esc(schema.source)}" target="_blank" rel="noopener noreferrer">檢視官方文件</a></div></details>`
      + `<div class="actions">${engine === 'fish' ? btn('references', '管理參考音訊', 'secondary') : ''}${btn('request-preview', icon('eye') + '請求預覽', 'text-button')}</div>`
      + `<div class="savebar"><span class="save-state" data-save-state>${dirty ? '未儲存' : '已儲存'}</span>${btn('save-connection', '儲存配置', 'primary')}</div>`);
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

  const render = () => engine === 'nai' ? renderNovelAI() : engine === 'gpt' ? renderGpt() : engine === 'comfy' ? renderComfy() : engine === 'llm' ? renderText() : engine ? renderDetail() : renderList();
  function edit(id) {
    engine = id;
    if (!order.length || order.at(-1) !== id) order = [...order.filter(x => x !== id), id];
    if (id === 'llm') { textDraft = structuredClone(api.getState().text); dirty = false; render(); v.root.scrollTop = 0; return; }
    if (id === 'nai') { render(); v.root.scrollTop = 0; loadSubscription(false); return; }
    if (id === 'gpt' || id === 'comfy') { render(); v.root.scrollTop = 0; return; }
    if (!drafts.has(id)) drafts.set(id, structuredClone(api.getState().connections[id]));
    dirty = JSON.stringify(draft()) !== JSON.stringify(api.getState().connections[id]);
    render();
    v.root.scrollTop = 0;
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
    if (el.dataset.field === 'relayApi') { api.saveConnection('fish', {relayApi: el.value}); draft().relayApi = el.value; balances.delete('fish'); render(); return; }
    draft()[el.dataset.field] = el.value; changed(); render();
  });
  const readValue = (el, f) => f.type === 'boolean' ? el.checked : f.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : f.type === 'select' ? f.options.find(([key]) => String(key) === el.value)?.[0] : el.value;
  async function updateParam(el, redraw) {
    const c = draft(), schema = api.engineSchema(engine, c), f = schema.groups.flatMap(g => g.fields).find(x => x.key === el.dataset.param);
    if (!f) return;
    if (el.dataset.row !== undefined) {
      const row = c.params[f.key][Number(el.dataset.row)], col = f.columns.find(x => x.key === el.dataset.column);
      if (!row) return;
      if (col.type === 'file') {
        const file = el.files?.[0];
        if (!file) return;
        el.disabled = true;
        const label = el.nextElementSibling;
        if (label) label.textContent = '正在存……';
        try {
          const id = await api.reference(file, {wav: engine === 'mimo'});
          if (!c.params[f.key].includes(row)) return;
          row[col.key] = id;
          // A clone sample is named after its file when it has no name yet; the list is saved right away when every
          // row is complete, so the audio is not lost if 保存配置 is forgotten.
          const named = f.columns.some(x => x.key === 'name');
          if (named && !String(row.name || '').trim()) row.name = file.name.replace(/\.[^.]+$/, '').trim().slice(0, 40) || '樣本';
          let saved = false;
          try { api.saveConnection(engine, {params: {[f.key]: structuredClone(c.params[f.key])}}); saved = true; } catch {}
          if (draft() === c) { dirty = JSON.stringify(c) !== JSON.stringify(api.getState().connections[engine]); render(); }
          ctx.notify(!saved ? '音訊已存進瀏覽器，把這一行填完整後點「儲存配置」' : named ? `樣本「${row.name}」已儲存，角色的音色填「${row.name}」` : '參考音訊已儲存');
        } finally { if (el.isConnected) el.disabled = false; }
        return;
      }
      row[col.key] = readValue(el, col);
    } else c.params[f.key] = readValue(el, f);
    changed();
    if (redraw && ['select', 'boolean'].includes(f.type)) render();
  }
  v.on('input', '[data-param]', el => { if (!['checkbox', 'file'].includes(el.type) && el.tagName !== 'SELECT') return updateParam(el, false); });
  v.on('change', '[data-param]', el => updateParam(el, true));
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
      case 'save-connection': {
        // A key typed in the box is kept too: people expect the big button to save everything on the page.
        const typed = v.root.querySelector('[data-field=key]')?.value || '';
        if (typed.trim()) { api.setKey(engine, typed); balances.delete(engine); }
        api.saveConnection(engine, draft()); dirty = false; render(); ctx.notify(typed.trim() ? '金鑰和引擎配置都已儲存' : '引擎配置已儲存');
        if (typed.trim()) loadBalance(engine, true);
        break;
      }
      case 'save-key': if (engine === 'llm') { api.setTextKey(textDraft.active, v.root.querySelector('[data-field=key]').value); render(); ctx.notify('金鑰已儲存'); break; } api.setKey(engine, v.root.querySelector('[data-field=key]').value); balances.delete(engine); render(); ctx.notify('金鑰已儲存'); if (engine === 'nai') loadSubscription(true); else loadBalance(engine, true); break;
      case 'refresh-subscription': await v.busy(el, () => loadSubscription(true)); break;
      case 'save-relay': {
        const url = v.root.querySelector('[data-field=relay]').value;
        api.saveDraw({relay: {url}});
        subscription = null; render();
        ctx.notify(api.getState().draw.relay.url ? '中轉地址已儲存' : '已改回直連 NovelAI');
        if (api.keyStatus('nai')) loadSubscription(true);
        break;
      }
      case 'save-fish-relay': {
        api.saveConnection('fish', {relay: v.root.querySelector('[data-field=relay]').value});
        draft().relay = api.getState().connections.fish.relay;
        balances.delete('fish'); render();
        ctx.notify(draft().relay ? 'Fish 中轉地址已儲存' : '已改回直連 Fish Audio');
        // Which form the relay speaks: checked right away when there is a key to check with.
        if (draft().relay && api.keyStatus('fish')) await v.busy(el, async () => { const {switched} = await detectFish(); if (switched) { render(); ctx.notify(switched === 'openai' ? '這個中轉是 OpenAI 格式（/v1/audio/speech），已經自動切換' : '這個中轉用 Fish 官方路徑，已經自動切換'); } }).catch(() => {});
        if (api.keyStatus('fish')) loadBalance('fish', true);
        break;
      }
      case 'test-fish-relay': await v.busy(el, async () => { const {r, switched} = await detectFish(); if (switched) render(); ctx.dialog('測試連線', fishProbeReport(r, switched)); }); break;
      case 'test-relay': await v.busy(el, async () => {
        const result = await api.naiProbe();
        await loadSubscription(false);
        ctx.dialog('測試連線', probeReport(result));
      }); break;
      case 'refresh-balance': await v.busy(el, () => loadBalance(engine, true)); break;
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
      case 'add-key': {
        const added = api.addKeys(engine, v.root.querySelector('[data-field=key]').value);
        balances.delete(engine); render(); ctx.notify(added > 1 ? `已新增 ${added} 個金鑰` : '金鑰已儲存'); loadBalance(engine, true);
        break;
      }
      case 'use-key': {
        const index = Number(el.dataset.index), k = api.keyList(engine)[index];
        if (!k) break;
        api.useKey(engine, index); balances.delete(engine); render(); loadBalance(engine, true);
        ctx.notify(`已改用末尾 ${k.tail} 的金鑰${index > 0 ? '，它排到了第一個，以後開啟也先用它' : ''}`);
        break;
      }
      case 'remove-key': {
        const index = Number(el.dataset.index), k = api.keyList(engine)[index];
        if (!k || !await ctx.confirm('刪除這個金鑰？', `第 ${index + 1} 個（末尾 ${k.tail}）會被刪掉，其他的保留。`)) break;
        api.removeKey(engine, index); balances.delete(engine); render(); ctx.notify('已刪除'); loadBalance(engine, true);
        break;
      }
      case 'clear-key': if (engine === 'llm') { if (await ctx.confirm('清除這套介面的金鑰？', '其他介面預設的金鑰不受影響。')) { api.clearTextKey(textDraft.active); render(); } break; }
        if (await ctx.confirm(['nai', 'gpt'].includes(engine) ? '清除金鑰？' : '清除全部金鑰？', '之後使用這個引擎需要重新填寫。')) { api.clearKey(engine); if (engine === 'nai') subscription = null; balances.delete(engine); render(); } break;
      case 'reveal-key': {
        const field = v.root.querySelector('[data-field=key]');
        field.type = field.type === 'password' ? 'text' : 'password';
        el.textContent = field.type === 'password' ? '顯示' : '隱藏';
        break;
      }
      case 'read-voices': {
        const current = engine;
        await v.busy(el, async () => {
          const r = await api.voices(current, draft());
          if (current === engine) { const status = v.root.querySelector('[data-connection-status]'); if (status) status.textContent = r.note + ' · ' + r.voices.length + ' 個'; }
        });
        break;
      }
      case 'add-row': {
        const f = api.engineSchema(engine, draft()).groups.flatMap(g => g.fields).find(x => x.key === el.dataset.paramKey);
        if (draft().params[f.key].length < f.max) draft().params[f.key].push(Object.fromEntries(f.columns.map(c => [c.key, c.value ?? (c.type === 'boolean' ? false : c.type === 'number' ? c.min ?? 0 : '')])));
        changed();
        render();
        break;
      }
      case 'remove-row': draft().params[el.dataset.paramKey].splice(Number(el.dataset.index), 1); changed(); render(); break;
      case 'request-preview': {
        const state = api.getState(), r = state.routes.find(r => r.engine === engine) || {name: '預覽角色', voice: 'voice-id', engine, language: state.general.defaultLanguage};
        const request = api.previewRequest(engine, draft(), {...r, model: ''}, {role: r.name, emotion: 'calm', text: '雨還沒停，再坐一會兒吧。', translation: '雨還沒停，再坐一會兒吧。'});
        ctx.dialog('請求預覽', `<pre class="code-preview">${esc(JSON.stringify(request, null, 2))}</pre>`);
        break;
      }
      case 'references': await manageReferences(); break;
    }
  });

  async function manageReferences() {
    const d = ctx.dialog('參考音訊', '<p class="hint">正在讀取…</p>');
    const refresh = async () => {
      const rows = await api.listReferences();
      if (!d.live) return;
      d.body.innerHTML = rows.length
        ? '<div class="group">' + rows.map(r => `<div class="list-row"><span><strong>${esc(r.name)}</strong><small>${Math.round(r.size / 1024)} KB</small></span><button class="text-button" data-delete-reference="${esc(r.id)}">刪除</button></div>`).join('') + '</div>'
        : '<p class="hint">還沒有儲存參考音訊。</p>';
    };
    d.body.addEventListener('click', async e => {
      const el = e.target.closest('[data-delete-reference]');
      if (!el) return;
      el.disabled = true;
      try {
        await api.deleteReference(el.dataset.deleteReference);
        for (const c of drafts.values()) if (c.params.references) c.params.references = c.params.references.filter(r => r.audio !== el.dataset.deleteReference);
        await refresh();
      } catch (error) { ctx.notify(error.message); }
      finally { if (el.isConnected) el.disabled = false; }
    });
    await refresh();
  }

  render();
  v.onBalance = event => {
    if (!event.stale || !PRICED.includes(event.engine)) return;
    if (engine === event.engine || (engine === null && balances.has(event.engine))) loadBalance(event.engine, true);
    else balances.delete(event.engine);
  };
  return v;
}
