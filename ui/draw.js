import {createView, esc, btn, field, input, select, textArea, toggle, heading, help, groupTitle, plate, avatar, empty} from './common.js';
import {icon} from './icons.js';
import {openImageViewer} from '../image-viewer.js';
import {downloadAction} from '../download.js';
import {vibePanel} from './vibes.js';
import {openImageSettings} from '../pocket/image-settings.js';

const SIZES = [['portrait', '豎圖', 832, 1216], ['landscape', '橫圖', 1216, 832], ['square', '方圖', 1024, 1024], ['tall', '大豎圖', 1024, 1536]];
/** Pictures kept in the column beside the canvas (this visit of the app; all of them are also in the album). */
const MAX_RESULTS = 30;
const TIERS = {0: '未訂閱', 1: 'Tablet', 2: 'Scroll', 3: 'Opus'};
const POSITION = i => i < 0 ? '自動' : 'ABCDE'[i % 5] + (Math.floor(i / 5) + 1);

export function drawApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'draw'), urls = new Map();
  let tab = 'prompt', prompt = '', negative = '', characters = [], seed = -1, results = [], current = -1, newest = false, busy = false, subscription = null, styleDraft = null, epoch = 0;
  // ComfyUI: models, samplers and schedulers read from it (null until 读取 is pressed).
  let comfyInfo = null;
  const vibes = vibePanel({ctx, api, root: () => v.root, rerender: () => render()});
  let queue = api.drawQueue?.() || [], cloudError = api.cloudQueueError?.() || '', cloudNote = null;
  const jobState = j => j.state === 'running' ? '正在畫' : j.state === 'busy' ? `賬號正忙，稍後重試（第 ${j.attempt} 次）` : j.state === 'spacing' ? '馬上開始'
    : j.state === 'remote' ? (j.cloud?.position > 0 ? `雲端排隊，前面 ${j.cloud.position} 位` : j.cloud?.cooldown > 5000 ? `大家一起等 ${Math.ceil(j.cloud.cooldown / 1000)} 秒` : '雲端馬上輪到') : `第 ${j.position + 1} 位`;
  const queueCard = () => (queue.length || cloudError) ? `<div class="group pad queue-card"><div class="row-heading"><strong style="flex:1">排隊 · ${queue.length} 張</strong>${queue.length ? btn('cancel-all', '全部取消', 'text-button') : ''}</div>${cloudError && state().queue.cloud.enabled ? `<p class="hint error-copy" style="padding:0 0 6px">${esc(cloudError)}，這次按本機排隊</p>` : ''}${queue.map(j => `<div class="setting-row"><span>${esc(j.label || '圖片')}</span><small>${esc(jobState(j))}</small>${j.state === 'running' ? '' : btn('cancel-job', icon('close'), 'text-button', `data-key="${esc(j.key)}" aria-label="取消這張"`)}</div>`).join('')}</div>` : '';
  const state = () => api.getState().draw;
  const eng = () => state().engine, engineName = (e = eng()) => api.drawCatalog.engineNames?.[e] || 'NovelAI';
  // Cloud queue fields as typed; saved when an input changes or a button uses them.
  const cloudFields = () => {
    const saved = state().queue.cloud, field = key => v.root.querySelector(`[data-cloud=${key}]`)?.value;
    return {enabled: saved.enabled, kind: saved.kind, url: (field('url') ?? saved.url).trim(), room: (field('room') ?? saved.room).trim()};
  };
  // Each engine remembers its own 画风; GPT and ComfyUI use NovelAI's until one is picked for them.
  const styleId = () => { const d = state(); return (d.engine === 'nai' ? '' : d[d.engine]?.style) || d.activeStyle; };
  const style = () => { const d = state(); return d.styles.find(s => s.id === styleId()) || d.styles[0]; };
  // A result as a file: NovelAI_种子.png.
  const resultFile = async result => { const photo = await api.getPhoto(result.photoId); if (!photo) throw Error('這張圖已經不在相簿裡了'); return {source: photo.blob, name: `${(api.drawCatalog.engineNames?.[result.engine] || 'NovelAI').replace(/\s+/g, '')}_${result.seed >= 0 ? result.seed : photo.name}`}; };
  const urlFor = async id => {
    if (urls.has(id)) return urls.get(id);
    const photo = await api.getPhoto(id);
    if (!photo) return '';
    const url = ctx.win.URL.createObjectURL(photo.blob);
    urls.set(id, url);
    return url;
  };

  function quote() {
    const d = state();
    return api.drawQuote(d.engine === 'nai' ? {...d.params, ...(seed >= 0 ? {seed} : {})} : seed >= 0 ? {seed} : {});
  }
  function costChip(q) {
    const e = eng();
    if (!api.drawReady()) return `<span class="chip" data-engine="none">${e === 'comfy' ? '未填地址' : '未填金鑰'}</span>`;
    if (e === 'gpt') return `<span class="chip${q.free === false ? ' warn' : ''}">${icon('alert')}每張都要花錢${q.free === false ? '' : ' · 不先問'}</span>`;
    if (e === 'comfy') return `<span class="chip">${icon('lock')}自己的 ComfyUI · 不花錢</span>`;
    if (q.free === true) return `<span class="chip">${icon(q.guard ? 'lock' : 'unlock')}${q.v5 ? `V5 免費額度 ${q.usage.percent}%` : '免費檔 · 0 Anlas'}</span>`;
    if (q.free === false) return `<span class="chip warn">${icon('alert')}${q.v5 && q.usage && q.params.steps <= 28 && q.params.width * q.params.height <= 1048576 ? 'V5 免費額度用完 · 會扣 Anlas' : '會扣 Anlas'}</span>`;
    return `<span class="chip" data-engine="none">${icon(q.guard ? 'lock' : 'unlock')}免費檔內 · 訂閱未確認</span>`;
  }

  async function render() {
    const ticket = ++epoch, d = state(), e = d.engine, s = styleDraft || style(), q = quote(), p = q.params, keyed = api.drawReady();
    if (e !== 'nai' && tab === 'vibe') tab = 'prompt';
    const shown = results[current];
    const main = shown ? await urlFor(shown.photoId) : '';
    const thumbs = await Promise.all(results.map(r => urlFor(r.photoId)));
    if (v.disposed || ticket !== epoch) return;
    const size = SIZES.find(([, , w, h]) => w === d.params.width && h === d.params.height)?.[0] || 'custom';
    const tabs = [['prompt', '提示詞'], ['chars', '角色'], ['params', '引數'], ...(e === 'nai' ? [['vibe', 'Vibe']] : []), ['chat', '正文出圖']];
    v.root.dataset.engine = e;
    let body = '';
    if (tab === 'prompt') body = `
      <div class="group pad">${field('這張圖的提示詞', textArea('prompt', prompt, 'rows="4" placeholder="英文 tag，逗號分隔，例如 2girls, rainy day, cafe window, sharing an umbrella"'), e === 'gpt' ? '會和畫風的固定正面、每個角色的外貌一起整理成一段英文描述發給 GPT。畫師串、權重括號和負面不會發給 GPT。' : e === 'comfy' ? '實際傳送：畫師串 + 固定正面 + 這裡的提示詞，後面接上每個角色的外貌；NovelAI 的權重寫法會自動換成 ComfyUI 的。' : '實際傳送：畫師串 + 固定正面 + 這裡的提示詞。')}
        <div class="actions" style="margin-top:0">${btn('suggest', icon('wand') + '從劇情生成', 'secondary')}</div>
        ${e === 'gpt' ? '' : field('這張圖額外的負面', textArea('negative', negative, 'rows="2" placeholder="可以留空，會和固定負面合在一起"'))}</div>`;
    if (tab === 'chars') body = (characters.length ? characters.map((c, i) => `
      <div class="group pad draw-char" data-engine="${ctx.engineOf(c.name)}"><div class="row-heading">${avatar(c.name, ctx.engineOf(c.name), 30)}<strong style="flex:1">${esc(c.name)}</strong><span class="chip">位置 ${POSITION(c.position)}</span>${btn('remove-char', icon('trash'), 'text-button', `data-index="${i}" aria-label="移除 ${esc(c.name)}"`)}</div>
        <div class="char-body">${textArea('char', c.prompt, `data-index="${i}" rows="3" aria-label="${esc(c.name)} 的提示詞"`)}
          <div class="pos-grid" aria-label="畫面位置">${Array.from({length: 25}, (_, k) => `<button data-action="position" data-index="${i}" data-position="${k}" aria-pressed="${c.position === k}" aria-label="位置 ${POSITION(k)}"></button>`).join('')}</div></div>
        ${btn('position', '讓模型自己決定位置', 'text-button', `data-index="${i}" data-position="-1" aria-pressed="${c.position < 0}"`)}</div>`).join('') : empty('還沒有加入角色', e === 'gpt' ? '每個角色的外貌和在畫面裡的位置，會寫進給 GPT 的描述裡。' : e === 'comfy' ? 'ComfyUI 沒有分角色的提示詞：每個人的外貌接在提示詞後面，位置不起作用。' : 'V4 / 4.5 可以給每個角色單獨寫外貌，並指定在畫面裡的大致位置。', 'person'))
      + `<div class="actions">${btn('add-char', icon('add') + '從角色裡新增', 'secondary')}${btn('add-custom', icon('add') + '手動新增', 'secondary')}</div>`;
    if (tab === 'params' && e === 'gpt') body = gptParams(d.gpt);
    if (tab === 'params' && e === 'comfy') body = comfyParams(d.comfy);
    if (tab === 'params' && e === 'nai') body = `
      <div class="group pad">
        ${field('模型', select('model', d.params.model, api.drawCatalog.models.map(m => [m, api.drawCatalog.modelNames[m] || m])), /^nai-diffusion-5/.test(d.params.model) ? 'V5 對 Opus 不是無限的：免費檔內的圖用一份會慢慢恢復的免費額度，用完後改扣 Anlas。V4.5 及更早的模型仍然無限。' : '')}
        <div class="field"><span>尺寸</span><div class="size-chips">${SIZES.map(([k, label, w, h]) => `<button data-action="size" data-size="${k}" aria-pressed="${size === k}" ${d.guard && w * h > 1048576 ? 'disabled' : ''}><i style="width:${w / 100}px;height:${h / 100}px"></i>${label}<small>${w}×${h}</small></button>`).join('')}</div></div>
        <div class="field"><div class="meter-label"><span>步數${d.guard ? ' · 免費檔最多 28' : ''}</span><output>${d.params.steps}</output></div><input class="slider" type="range" data-param="steps" min="1" max="${d.guard ? 28 : 50}" value="${d.params.steps}" aria-label="步數"></div>
        <div class="field"><div class="meter-label"><span>提示詞相關性 CFG</span><output>${d.params.scale.toFixed(1)}</output></div><input class="slider" type="range" data-param="scale" min="0" max="10" step="0.1" value="${d.params.scale}" aria-label="CFG"></div>
        ${field('取樣器', select('sampler', d.params.sampler, api.drawCatalog.samplers.map(m => [m, m])))}
        ${field('噪聲排程', select('schedule', d.params.schedule, api.drawCatalog.schedules.map(m => [m, m])))}
        <div class="field"><span>種子${help('填 -1 或留空表示每次隨機。')}</span><div class="inline-row">${input('seed', seed >= 0 ? seed : '', 'number', 'min="-1" placeholder="隨機"')}${btn('dice', icon('dice'), 'round-button', 'aria-label="隨機一個種子"')}</div></div>
        ${/^nai-diffusion-5/.test(d.params.model) ? '' : toggle('variety', 'Variety+', d.params.variety, '讓構圖更多變，適合 V4 / 4.5。')}
      </div>
      <div class="group">${toggle('guard', '免費檔守衛', d.guard, '開啟時步數不超過 28、尺寸不超過 1024×1024，不會發出扣 Anlas 的請求。關閉後，會扣點的生成每次都先問你。')}</div>
      ${groupTitle('排隊', help('一個 NovelAI 賬號同一時間只能畫一張。幾個人共用賬號時，同時請求會得到 429，太頻繁還可能被風控。\n\n外掛裡所有出圖都排成一隊，一張畫完再發下一張（同一個瀏覽器裡開的幾個酒館頁面也會互相等）；兩張之間留出間隔；遇到 429 就等一會兒再試，等待時間一次比一次長。'))}
      <div class="group pad">
        <div class="field"><div class="meter-label"><span>兩張圖之間至少間隔</span><output>${d.queue.gap} 秒</output></div><input class="slider" type="range" data-queue="gap" min="0" max="60" value="${d.queue.gap}" aria-label="兩張圖之間的間隔秒數"></div>
        <div class="field"><div class="meter-label"><span>賬號正忙（429）時重試</span><output>${d.queue.retries} 次</output></div><input class="slider" type="range" data-queue="retries" min="0" max="10" value="${d.queue.retries}" aria-label="429 重試次數"></div>
      </div>
      ${groupTitle('雲端佇列', help('幾個人共用一個 NovelAI 賬號時，讓所有人排同一條隊：前面有人在畫就先等著。\n\n兩種佇列服務：\n· 按金鑰排隊：已經有的佇列服務（比如智繪姬用的那個）。不用房間碼，用同一個 NovelAI 金鑰的人自動排進同一條隊，也能和用智繪姬的朋友一起排。外掛只傳送金鑰的 SHA-256 摘要（算不回金鑰）、這臺瀏覽器的隨機編號和每張圖的隨機編號。\n· 房間碼：自己在 Cloudflare 免費部署的佇列（外掛目錄 cloud-queue/部署說明.md），大家填同一個地址和房間碼；撞上 429 時全房間一起等。只傳送房間碼和排隊號。\n\n兩種都看不到金鑰、提示詞和圖片。連不上時照常出圖，只是退回本機排隊。'))}
      <div class="group pad">
        ${toggle('cloud', '使用雲端佇列', d.queue.cloud.enabled)}
        <div class="field"><span>佇列型別</span><div class="segmented" style="margin:0">${[['keyhash', '按金鑰排隊'], ['room', '房間碼']].map(([k, l]) => `<button data-action="cloud-kind" data-kind="${k}" aria-pressed="${d.queue.cloud.kind === k}">${l}</button>`).join('')}</div></div>
        <div class="field"><span>佇列地址</span><input data-cloud="url" type="url" value="${esc(d.queue.cloud.url)}" placeholder="${d.queue.cloud.kind === 'keyhash' ? 'https://……hf.space' : 'https://st-iphonie-queue.你的名字.workers.dev'}" autocomplete="off" aria-label="佇列地址"></div>
        ${d.queue.cloud.kind === 'keyhash' ? '<p class="hint" style="padding:0">不用房間碼：用同一個 NovelAI 金鑰的人會自動排進同一條隊。</p>' : `<div class="field"><span>房間碼</span><div class="inline-row"><input data-cloud="room" value="${esc(d.queue.cloud.room)}" placeholder="16–64 位字母或數字" autocomplete="off" aria-label="房間碼">${btn('new-room', '生成', 'chip-button')}</div></div>`}
        <div class="actions" style="margin-top:0">${btn('test-cloud', icon('refresh') + '測試連線', 'secondary')}</div>
        ${cloudNote ? `<p class="hint${cloudNote.ok ? '' : ' error-copy'}" style="padding:0">${esc(cloudNote.text)}</p>` : ''}
      </div>`;
    if (tab === 'vibe') body = vibes.html();
    if (tab === 'chat') body = `
      ${d.enabled ? '' : `<div class="banner">${icon('image')}<span>正文出圖沒有開啟，在「設定 · 繪圖」裡開啟。</span>${btn('go-settings', '去開啟', 'chip-button')}</div>`}<div class="group">${toggle('auto', '新回覆自動出圖', d.auto, '只自動畫不花錢的：NovelAI 免費檔內的圖、ComfyUI 的圖；GPT 生圖在「每張先問」關掉後也會自動畫。其餘的正文裡會顯示“點選生成”。')}${toggle('fold', '正文圖片預設收起', d.fold, '收起後正文裡只留一個小縮圖，點開再看，手機上不佔地方。每張圖也可以單獨收起或展開。')}</div>
      <div class="field"><span>配圖方式${help('單獨配圖：正文模型只管寫故事；回覆寫完後，外掛用同一個模型再單獨請求一次，讀這條回覆、挑畫面、寫出圖塊，再把圖插到對應的段落後面。出圖規則不會擠佔正文，張數和格式更穩，每條回覆多一次請求。\n\n正文裡順手寫：把出圖規則加進正文請求，模型寫故事時順手寫出圖塊。只要一次請求，但規則較長，偶爾會影響正文或漏寫。')}</span><div class="segmented" style="margin:0">${[['separate', '回覆後單獨配圖'], ['inline', '正文裡順手寫']].map(([k, l]) => `<button data-action="mode" data-mode="${k}" aria-pressed="${d.mode === k}">${l}</button>`).join('')}</div></div>
      <div class="group">${toggle('strip', '發給模型時去掉舊出圖塊', d.strip, '出圖塊留在聊天記錄裡（圖片靠它顯示），但之後每次請求模型時會把它們去掉，省下上下文。')}</div>
      <div class="actions">${btn('plan-latest', icon('wand') + '給最新回覆配圖', 'secondary', api.planLatestPictures && d.enabled ? '' : 'disabled')}</div>
      <div class="group pad"><p class="hint" style="padding:6px 0">出圖塊長這樣（一張圖一塊）：${help('場景和每個人分開寫：人數、鏡頭、光線放場景；表情、視線、動作放各自的角色行。外掛把畫風固定串接在場景前面，把角色 App 裡的固定外貌補進對應的角色行，再交給選中的繪圖引擎（GPT 會整理成英文描述，ComfyUI 會合成一條提示詞）。新角色第一次出現時，模型寫的「新外貌」會自動存進角色 App。圖片會上傳到酒館，並存進相簿。')}</p><pre class="code-preview">${esc(api.picTagFormat)}</pre></div>
      <p class="hint">每條回覆固定出 ${(d.presets.find(p => p.id === d.activePreset) || d.presets[0]).count} 張圖，在出圖規則裡改張數。</p><div class="actions">${btn('open-presets', icon('edit') + '編輯出圖規則', 'secondary')}</div>`;
    const sub = e === 'gpt' ? d.gpt.model : e === 'comfy' ? (d.comfy.model || '還沒選模型').replace(/\.[^.]*$/, '') : subscription ? `${TIERS[subscription.tier] || '訂閱'} · ${subscription.anlas} Anlas` : keyed ? '讀取中' : '';
    v.draw(heading('丹青閣', keyed ? `<span class="chip">${esc(sub)}</span>` : '', engineName(e)) + `<div class="actions">${btn('pocket-image-settings','生圖預設管理','secondary')}</div>`
      + `<div class="segmented draw-engines" role="group" aria-label="用哪個畫">${api.drawCatalog.engines.map(k => `<button data-action="draw-engine" data-pick="${k}" aria-pressed="${k === e}">${esc(engineName(k))}</button>`).join('')}</div>`
      + (keyed ? '' : `<div class="banner">${icon('key')}<span>${esc(api.drawMissing())}。</span>${btn('go-key', '去填寫', 'chip-button')}</div>`)
      + queueCard()
      + `<div class="draw-meta">${btn('pick-style', icon('layers') + esc(style().name) + icon('down'), 'chip-button')}${costChip(q)}</div>
        <div class="canvas-card"><div class="canvas-main${main ? '' : ' empty'}" style="aspect-ratio:${p.width}/${p.height}">${main ? `<button type="button" class="canvas-zoom" data-action="zoom" aria-label="放大檢視"><img src="${esc(main)}" alt="生成的圖片"></button>` : `<span>${p.width} × ${p.height}<br>還沒有圖</span>`}${busy ? `<span class="canvas-busy">${esc(engineName(e))} 正在畫……</span>` : ''}</div>
          ${results.length ? `<div class="canvas-side" data-keep-scroll="results">${thumbs.map((url, i) => `<button class="thumb" data-action="thumb" data-index="${i}" aria-pressed="${i === current}" aria-label="第 ${i + 1} 張">${url ? `<img src="${esc(url)}" alt="">` : ''}</button>`).join('')}</div>` : ''}</div>
        ${shown ? `<p class="hint canvas-meta">${[shown.params.model, `${shown.params.width}×${shown.params.height}`, shown.params.steps ? shown.params.steps + ' 步' : '', shown.seed >= 0 ? '種子 ' + shown.seed : ''].filter(Boolean).map(esc).join(' · ')}</p>` : ''}
        <details data-group="style" class="style-card"><summary>${icon('paint')}畫風 · ${esc(s.name)}<span class="save-state" data-style-state>${styleDraft ? '未儲存' : ''}</span></summary><div>
          ${field('名字', input('name', s.name, 'text', 'data-style-field maxlength="40"'))}
          ${field('畫師串', textArea('artist', s.artist, 'class="code" rows="2" data-style-field placeholder="例如 artist:wlop, artist:ciloranko"'))}
          ${field('固定正面', textArea('positive', s.positive, 'class="code" rows="2" data-style-field'))}
          ${field('固定負面', textArea('negative-fixed', s.negative, 'class="code" rows="2" data-style-field'))}
          <div class="actions" style="margin-top:0">${btn('save-style', '儲存畫風', 'primary')}</div>
          <p class="hint" style="padding:0">正文出圖和這裡單獨生圖都會帶上這三欄。每個引擎記住自己用的畫風，現在這個是 ${esc(engineName(e))} 用的${e === 'gpt' ? '；GPT 不讀畫師串和固定負面' : ''}。</p></div></details>
        <div class="segmented draw-tabs">${tabs.map(([k, l]) => `<button data-action="tab" data-tab="${k}" aria-pressed="${k === tab}">${l}</button>`).join('')}</div>
        ${body}
        <div class="savebar">${btn('generate', busy ? '正在畫……' : q.free === false ? icon('alert') + (e === 'gpt' ? '生成（要花錢）' : '生成（會扣 Anlas）') : icon('paint') + '生成', 'primary', busy || !keyed ? 'disabled' : '')}</div>`);
    // A new picture goes on top of the column: show it.
    if (newest) { newest = false; const side = v.root.querySelector('.canvas-side'); if (side) side.scrollTop = 0; }
  }

  /** GPT: quality, default 画幅 (正文出图 follows each block's own) and whether to ask before every paid picture. */
  function gptParams(g) {
    const seg = (action, value, list) => `<div class="segmented" style="margin:0">${list.map(([k, l]) => `<button data-action="${action}" data-value="${k}" aria-pressed="${value === k}">${l}</button>`).join('')}</div>`;
    return `<div class="group pad">
        <div class="setting-row"><span>模型</span><small>${esc(g.model)}</small>${btn('go-key', '在引擎卡包裡改', 'text-button')}</div>
        <div class="field"><span>畫質${help('low 最便宜最快，high 最貴最細。auto 讓 GPT 自己定。dall-e-3 只分普通和高畫質（high）。')}</span>${seg('gpt-quality', g.quality, [['auto', '自動'], ['low', '低'], ['medium', '中'], ['high', '高']])}</div>
        <div class="field"><span>畫幅${help('這裡單獨生圖用的畫幅。正文出圖按每個出圖塊寫的畫幅來。GPT 只能畫 1024×1024、1024×1536、1536×1024 這幾種（dall-e-3 是 1792 的）。')}</span>${seg('gpt-orientation', g.orientation, [['portrait', '豎圖'], ['landscape', '橫圖'], ['square', '方圖']])}</div>
      </div>
      <div class="group">${toggle('gptAsk', '每張先問', g.ask, 'GPT 生圖每張都要花錢。開啟時，每張圖畫之前都先問你，新回覆也不會自動畫（正文裡顯示“點選生成”）。關掉後不再問，新回覆會自動畫，費用自己留意。')}</div>`;
  }
  /** ComfyUI: model, size, steps, CFG, sampler, scheduler and seed (the workflow decides what it uses). */
  function comfyParams(c) {
    const info = comfyInfo, size = SIZES.find(([, , w, h]) => w === c.width && h === c.height)?.[0] || 'custom';
    const choose = (key, value, list, placeholder) => list?.length
      ? select(key, value, [...(list.includes(value) || !value ? [] : [[value, value]]), ...list.map(x => typeof x === 'string' ? [x, x] : [x.value, x.text])])
      : input(key, value, 'text', `autocomplete="off" spellcheck="false" placeholder="${placeholder}"`);
    return `<div class="group pad">
        ${field('模型', choose('comfy-model', c.model, info?.models, '點「讀取」，或直接填檔名'))}
        <div class="actions" style="margin-top:0">${btn('comfy-read', icon('refresh') + '讀取模型和取樣器', 'secondary')}</div>
        ${info?.error ? `<p class="hint error-copy" style="padding:0">${esc(info.error)}</p>` : ''}
        <div class="field"><span>尺寸</span><div class="size-chips">${SIZES.map(([k, label, w, h]) => `<button data-action="comfy-size" data-size="${k}" aria-pressed="${size === k}"><i style="width:${w / 100}px;height:${h / 100}px"></i>${label}<small>${w}×${h}</small></button>`).join('')}</div></div>
        <div class="field"><div class="meter-label"><span>步數</span><output>${c.steps}</output></div><input class="slider" type="range" data-comfy="steps" min="1" max="80" value="${c.steps}" aria-label="步數"></div>
        <div class="field"><div class="meter-label"><span>提示詞相關性 CFG</span><output>${c.scale.toFixed(1)}</output></div><input class="slider" type="range" data-comfy="scale" min="0" max="20" step="0.5" value="${c.scale}" aria-label="CFG"></div>
        ${field('取樣器', choose('comfy-sampler', c.sampler, info?.samplers, 'euler_ancestral'))}
        ${field('噪聲排程', choose('comfy-scheduler', c.scheduler, info?.schedulers, 'normal'))}
        <div class="field"><span>種子${help('填 -1 或留空表示每次隨機。')}</span><div class="inline-row">${input('seed', seed >= 0 ? seed : '', 'number', 'min="-1" placeholder="隨機"')}${btn('dice', icon('dice'), 'round-button', 'aria-label="隨機一個種子"')}</div></div>
      </div>
      <p class="hint">這些值填進工作流的佔位符（"%steps%"、"%scale%" 這些）；工作流裡寫死的值不受影響。地址和工作流在引擎卡包的 ComfyUI 裡。</p>`;
  }
  async function readComfy() {
    try { comfyInfo = await api.comfyCatalog(); }
    catch (error) { comfyInfo = {error: error.message, models: [], samplers: [], schedulers: []}; }
    if (!v.disposed) render();
  }

  async function refreshSubscription(force = false) {
    if (eng() !== 'nai' || !api.keyStatus('nai')) { subscription = null; return; }
    try { subscription = await api.naiSubscription(force); }
    catch (error) { subscription = null; ctx.notify(error.message); }
    if (!v.disposed) render();
  }

  // Loads a picture request sent from the chat ("在绘图中打开").
  v.load = request => {
    if (!request) return;
    prompt = request.tag || request.prompt || '';
    seed = Number.isInteger(request.seed) ? request.seed : -1;
    const routes = api.getState().routes;
    characters = (request.characters || []).map(c => ({name: routes.find(r => r.appearance?.trim() === c.prompt?.trim())?.name || '角色', prompt: c.prompt, position: c.position ?? -1}));
    tab = 'prompt';
    render();
  };
  v.refresh = () => { styleDraft = null; render(); refreshSubscription(); };
  v.onDraw = event => {
    if (event.subscription) subscription = event.subscription;
    if (event.queue) { queue = event.queue; cloudError = event.cloud || ''; }
    if (event.subscription || event.queue || event.vibes && tab === 'vibe') render();
  };
  const dispose = v.dispose;
  v.dispose = () => { epoch++; for (const url of urls.values()) ctx.win.URL.revokeObjectURL(url); urls.clear(); dispose(); };

  v.on('input', '[data-field]', el => {
    const key = el.dataset.field;
    if (key === 'prompt') prompt = el.value;
    else if (key === 'negative') negative = el.value;
    else if (key === 'char') characters[Number(el.dataset.index)].prompt = el.value;
    else if (el.hasAttribute('data-style-field')) {
      styleDraft ||= {...style()};
      styleDraft[key === 'negative-fixed' ? 'negative' : key] = el.value;
      const mark = v.root.querySelector('[data-style-state]');
      if (mark) mark.textContent = '未儲存';
    } else if (key === 'seed') seed = el.value === '' ? -1 : Math.max(-1, Math.floor(Number(el.value) || -1));
  });
  v.on('input', '[data-param]', el => { el.previousElementSibling.querySelector('output').textContent = el.dataset.param === 'scale' ? Number(el.value).toFixed(1) : el.value; });
  v.on('change', '[data-param]', el => { api.saveDraw({params: {[el.dataset.param]: Number(el.value)}}); render(); });
  v.on('input', '[data-queue]', el => { el.previousElementSibling.querySelector('output').textContent = el.value + (el.dataset.queue === 'gap' ? ' 秒' : ' 次'); });
  v.on('change', '[data-queue]', el => { api.saveDraw({queue: {[el.dataset.queue]: Number(el.value)}}); });
  v.on('change', 'select[data-field]', el => { if (/^comfy-/.test(el.dataset.field)) return; api.saveDraw({params: {[el.dataset.field]: el.value}}); render(); });
  // ComfyUI fields: a select from 读取, or a typed name when nothing was read.
  v.on('change', '[data-field^=comfy-]', el => { api.saveDraw({comfy: {[el.dataset.field.slice(6)]: el.value.trim()}}); render(); });
  v.on('input', '[data-comfy]', el => { el.previousElementSibling.querySelector('output').textContent = el.dataset.comfy === 'scale' ? Number(el.value).toFixed(1) : el.value; });
  v.on('change', '[data-comfy]', el => { api.saveDraw({comfy: {[el.dataset.comfy]: Number(el.value)}}); render(); });
  v.on('change', '[data-cloud]', () => { api.saveDraw({queue: {cloud: cloudFields()}}); cloudNote = null; });
  v.on('change', 'input.switch[data-field]', el => {
    const key = el.dataset.field;
    if (key === 'variety') api.saveDraw({params: {variety: el.checked}});
    else if (key === 'vibeEnabled') api.saveDraw({vibe: {enabled: el.checked}});
    else if (key === 'cloud') api.saveDraw({queue: {cloud: {...cloudFields(), enabled: el.checked}}});
    else if (key === 'gptAsk') api.saveDraw({gpt: {ask: el.checked}});
    else api.saveDraw({[key]: el.checked});
    render();
  });
  v.on('input', '[data-vibe-search]', el => vibes.search(el.value));
  v.on('change', '[data-vibe-file]', async el => { const files = [...el.files]; el.value = ''; await vibes.importFiles(files); });
  v.on('click', '[data-action]', async el => {
    if (el.dataset.action?.startsWith('vibe-') && await vibes.click(el)) return;
    const index = Number(el.dataset.index);
    switch (el.dataset.action) {
      case 'pocket-image-settings': await openImageSettings(ctx); break;
      case 'tab': tab = el.dataset.tab; render(); break;
      case 'draw-engine': api.saveDraw({engine: el.dataset.pick}); styleDraft = null; render(); refreshSubscription(); break;
      case 'gpt-quality': api.saveDraw({gpt: {quality: el.dataset.value}}); render(); break;
      case 'gpt-orientation': api.saveDraw({gpt: {orientation: el.dataset.value}}); render(); break;
      case 'comfy-size': { const [, , width, height] = SIZES.find(s => s[0] === el.dataset.size); api.saveDraw({comfy: {width, height}}); render(); break; }
      case 'comfy-read': await v.busy(el, readComfy); break;
      case 'size': { const [, , width, height] = SIZES.find(s => s[0] === el.dataset.size); api.saveDraw({params: {width, height}}); render(); break; }
      case 'dice': seed = Math.floor(Math.random() * 4294967295); render(); break;
      case 'thumb': current = index; render(); break;
      case 'cancel-job': api.cancelDraw(el.dataset.key); break;
      case 'mode': api.saveDraw({mode: el.dataset.mode}); render(); break;
      case 'cloud-kind': api.saveDraw({queue: {cloud: {...cloudFields(), kind: el.dataset.kind}}}); cloudNote = null; render(); break;
      case 'plan-latest': await v.busy(el, () => api.planLatestPictures()); break;
      case 'new-room': { const room = api.newRoomCode(); v.root.querySelector('[data-cloud=room]').value = room; api.saveDraw({queue: {cloud: cloudFields()}}); cloudNote = {ok: true, text: '已生成房間碼。把佇列地址和房間碼發給共用賬號的朋友。'}; render(); break; }
      case 'test-cloud': {
        api.saveDraw({queue: {cloud: cloudFields()}});
        cloudNote = {ok: true, text: '正在連線……'}; render();
        const r = await api.testCloudQueue(cloudFields());
        cloudNote = r.ok ? {ok: true, text: `連線正常。隊裡現在 ${r.length} 張${r.holder ? `，${r.holder} 正在畫` : ''}。`} : {ok: false, text: r.message};
        render();
        break;
      }
      case 'cancel-all': if (await ctx.confirm('取消所有排隊的圖？', '正在畫的那一張也會停下。')) api.cancelAllDraws(); break;
      case 'go-settings': ctx.open('settings'); break;
      case 'go-key': ctx.open('engines'); ctx.editEngine?.(eng()); break;
      case 'open-presets': ctx.open('presets'); ctx.showPresetKind?.('draw'); break;
      case 'position': characters[index].position = Number(el.dataset.position); render(); break;
      case 'remove-char': characters.splice(index, 1); render(); break;
      case 'add-custom': characters.push({name: '角色', prompt: '', position: -1}); render(); break;
      case 'add-char': pickCharacter(); break;
      case 'zoom': { const img = el.querySelector('img'), shown = results[current]; if (img) openImageViewer({doc: ctx.doc, src: img.src, alt: '生成的圖片', from: img, actions: shown ? [downloadAction(ctx.doc, () => resultFile(shown), ctx.notify)] : []}); break; }
      case 'suggest':
        await v.busy(el, async () => {
          el.innerHTML = icon('spin') + '正在讀劇情…';
          prompt = await api.suggestPrompt();
          render();
          ctx.notify('已根據最近的劇情寫好提示詞，可以再改');
        });
        break;
      case 'pick-style': pickStyle(); break;
      case 'save-style': {
        if (!styleDraft) { ctx.notify('畫風沒有改動'); break; }
        if (!styleDraft.name.trim()) { ctx.notify('請填寫畫風名字'); break; }
        api.saveStyle(styleDraft);
        styleDraft = null;
        render();
        ctx.notify('畫風已儲存');
        break;
      }
      case 'generate': await generate(); break;
    }
  });

  async function generate() {
    const s = styleDraft || style(), q = quote();
    let allowPaid = false;
    if (q.free === false && eng() === 'gpt') {
      const ask = api.paidPrompt();
      if (!await ctx.confirm(ask.title, ask.text)) return;
      allowPaid = true;
    } else if (q.free === false) {
      const vibeNote = q.vibeAnlas ? `其中 Vibe 約 ${q.vibeAnlas} Anlas（${[q.vibes.encode && `${q.vibes.encode} 個第一次用要編碼`, q.vibes.extra && `超過 4 個多了 ${q.vibes.extra} 個`].filter(Boolean).join('，')}）。` : '';
      if (!await ctx.confirm('這張圖會扣 Anlas', `按當前引數和訂閱，這次生成要消耗 Anlas${subscription ? `（現有 ${subscription.anlas}）` : ''}。${vibeNote}實際扣多少以 NovelAI 結算為準。`)) return;
      allowPaid = true;
    }
    busy = true;
    render();
    try {
      const result = await api.generateImage({
        prompt: [s.artist, s.positive, prompt].map(x => (x || '').trim()).filter(Boolean).join(', '),
        negative: [s.negative, negative].map(x => (x || '').trim()).filter(Boolean).join(', '),
        characters: characters.filter(c => c.prompt.trim()).map(c => ({prompt: c.prompt, position: c.position})),
        params: eng() === 'nai' ? {...state().params, seed} : {seed}, allowPaid, name: engineName().replace(/\s+/g, ''), label: '繪圖 App · ' + (prompt.trim().slice(0, 24) || s.name)
      });
      results.unshift(result);
      results = results.slice(0, MAX_RESULTS);
      current = 0;
      newest = true;
      if (allowPaid && eng() === 'nai') refreshSubscription(true);
    } catch (error) { if (!error.cancelled) ctx.notify(error.message); }
    busy = false;
    render();
  }

  function pickCharacter() {
    const routes = api.getState().routes;
    const d = ctx.dialog('從角色裡新增', routes.length
      ? `<div class="group">${routes.map(r => `<button class="list-row" data-pick="${esc(r.id)}">${avatar(r.name, r.voice ? r.engine : 'none', 36)}<span><strong>${esc(r.name)}</strong><small>${esc(r.appearance?.trim() || '還沒有填寫外貌 tag')}</small></span>${icon('add')}</button>`).join('')}</div>`
      : '<p class="hint">還沒有角色。可以先在角色 App 裡新增，並填寫外貌 tag。</p>');
    d.body.addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      const r = routes.find(x => x.id === b.dataset.pick);
      characters.push({name: r.name, prompt: r.appearance || '', position: -1});
      d.close();
      render();
    });
  }

  function pickStyle() {
    const d0 = state(), using = styleId();
    const d = ctx.dialog('畫風預設', `<div class="group">${d0.styles.map(s => `<button class="list-row" data-style="${esc(s.id)}"><span><strong>${esc(s.name)}</strong><small class="mono">${esc(s.artist || '沒有畫師串')}</small></span>${s.id === using ? plate('使用中') : icon('next')}</button>`).join('')}</div>
      <div class="actions">${btn('new-style', icon('add') + '新建畫風', 'secondary')}${d0.styles.length > 1 ? btn('delete-style', icon('trash') + '刪除當前', 'danger') : ''}</div>`);
    d.body.addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b) return;
      try {
        if (b.dataset.style) { api.saveDraw({activeStyle: b.dataset.style}); styleDraft = null; d.close(); render(); }
        if (b.dataset.action === 'new-style') {
          const created = api.saveStyle({name: '新畫風 ' + (d0.styles.length + 1), artist: '', positive: style().positive, negative: style().negative});
          api.saveDraw({activeStyle: created.id});
          styleDraft = null; d.close(); render();
          ctx.notify('已新建畫風，在下面改名字、填寫畫師串');
        }
        if (b.dataset.action === 'delete-style') {
          d.close();
          if (await ctx.confirm('刪除當前畫風？', `「${style().name}」會被刪除，其他畫風保留。`)) { api.deleteStyle(style().id); styleDraft = null; render(); }
        }
      } catch (error) { ctx.notify(error.message); }
    });
  }


  render();
  refreshSubscription();
  return v;
}
