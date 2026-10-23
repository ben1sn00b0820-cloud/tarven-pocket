import {createView, esc, btn, field, input, select, toggle, heading, size, languageField, typedLanguages, groupTitle, help, copyText} from './common.js';
import {buildReport} from '../core/diagnostics.js';
import {saveFile} from '../download.js';
import {icon, GLYPH_NAMES} from './icons.js';
import {APPS} from './apps.js';
import {wallpapers, skins} from './wallpapers.js';

const MARKS = {ok: '✓', warn: '!', error: '✕', info: '·'};
const IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/avif,image/gif';

export function settingsApp(ctx) {
  const {api} = ctx, v = createView(ctx, 'settings');
  let appearance = null, check = null, backup = null, restore = null, epoch = 0;
  const glyphName = key => APPS[key]?.name || GLYPH_NAMES[key] || key;

  // The self-check page: what core/diagnostics.js found, grouped, with the plain report to copy, save or send.
  function renderCheck() {
    const intro = '';
    if (check.loading) { v.draw(heading('自檢', help('自檢會看外掛、酒館、瀏覽器、金鑰和最近一條回覆有沒有問題。出問題時可以把報告複製給幫你的人，報告裡沒有金鑰。'), 'Self-check') + '<div class="group pad"><p class="help-copy">正在檢查……</p></div>' + intro); return; }
    const {sections, counts, text} = check.report, level = counts.error ? 'error' : counts.warn ? 'warn' : 'ok';
    v.draw(heading('自檢', help('自檢會看外掛、酒館、瀏覽器、金鑰和最近一條回覆有沒有問題。出問題時可以把報告複製給幫你的人，報告裡沒有金鑰。'), 'Self-check')
      + `<div class="check-summary" data-level="${level}"><strong>${counts.error ? `發現 ${counts.error} 個問題` : counts.warn ? `有 ${counts.warn} 條提醒` : '一切正常'}</strong><small>問題 ${counts.error} · 提醒 ${counts.warn} · 正常 ${counts.ok}</small></div>`
      + sections.map(s => groupTitle(s.title) + `<div class="group pad">${s.items.map(i => `<div class="check-row" data-level="${i.level}"><span class="check-mark" aria-hidden="true">${MARKS[i.level]}</span><div><strong>${esc(i.label)}</strong>${i.detail ? `<small>${esc(i.detail)}</small>` : ''}</div></div>`).join('')}</div>`).join('')
      + `<div class="actions">${btn('copy-report', icon('copy') + '複製報告', 'primary')}${btn('save-report', icon('download') + '下載報告', 'secondary')}</div>`
      + `<div class="actions">${btn('run-check', icon('refresh') + '再查一次', 'secondary')}</div>`
      + `<details class="report-text"><summary>報告原文（複製不了時長按這裡手動複製）</summary><textarea readonly rows="12" aria-label="報告原文">${esc(text)}</textarea></details>` + intro);
  }
  // Backup: pick the parts, see how much each holds, and save one file.
  async function renderBackup(ticket) {
    const [library, threads, moments] = await Promise.all([api.libraryStats().catch(() => null), api.listThreads().catch(() => null), api.listMoments().catch(() => null)]);
    if (v.disposed || ticket !== epoch) return;
    const s = api.getState(), n = (value, unit) => value === null || value === undefined ? '讀不到' : `${value} ${unit}`;
    const counts = {settings: `${s.routes.length} 個角色 · ${s.presets.length} 個配音預設`, chats: n(threads?.length, '段'), moments: n(moments?.length, '條'), notes: n(library?.notes, '條'), photos: n(library?.photos, '張'), favorites: n(library?.favorites, '段'), vibes: library ? `${library.vibes} 個 · ${s.draw.vibe.groups.length} 組` : '讀不到', keys: savedKeys() ? `這臺瀏覽器裡的 ${savedKeys()} 個金鑰` : '這臺瀏覽器裡還沒有金鑰'};
    v.draw(heading('備份', help('備份是一個 .json 檔案，可以存在電腦、手機或網盤裡。\n金鑰預設不放進去；開啟「金鑰」後會用你設的密碼加密，恢復時輸入同一個密碼才能取出來，沒有密碼的人拿到檔案也看不到金鑰。\n語音快取不備份，需要時會重新生成。相簿、收藏和 Vibe 多的話，檔案會比較大。'), 'Backup')
      + `<div class="group">${Object.entries(api.backupParts()).map(([key, label]) => key === 'keys' && !savedKeys() ? `<div class="setting-row"><span class="row-text"><strong>${esc(label)}</strong><small>這臺瀏覽器裡還沒有金鑰</small></span></div>` : partRow(key, label, counts[key], backup.parts.has(key))).join('')}</div>`
      + (backup.parts.has('keys') ? keyPasswordFields() : '')
      + `<div class="actions">${btn('make-backup', icon('download') + '生成備份檔案', 'primary', canBackup() ? '' : 'disabled')}</div>`);
  }
  const savedKeys = () => ['fish', 'mini', 'eleven', 'mimo', 'nai', 'llm'].filter(engine => { try { return api.keyStatus(engine); } catch { return false; } }).length;
  const passwordOk = () => !backup.parts.has('keys') || backup.password.length >= 6 && backup.password === backup.again;
  const canBackup = () => backup.parts.size > 0 && passwordOk();
  function keyPasswordFields() {
    return `<div class="group pad">${field('備份密碼', input('backup-password', backup.password, 'password', 'autocomplete="new-password" minlength="6"'), '至少 6 位。恢復時要輸入這個密碼才能取出金鑰；密碼忘了，金鑰就取不出來（備份裡的其他內容不受影響）。')}
      ${field('再輸一次', input('backup-again', backup.again, 'password', 'autocomplete="new-password"'))}<p class="hint" data-password-note>${esc(passwordNote())}</p></div>`;
  }
  const passwordNote = () => !backup.password ? '' : backup.password.length < 6 ? '密碼至少 6 位' : backup.again && backup.again !== backup.password ? '兩次輸入的不一樣' : backup.again ? '可以了' : '';
  // Restore: what the chosen file holds, which parts to take, and whether to merge or replace.
  function renderRestore() {
    const {info, parts, replace} = restore, sum = info.summary, labels = api.backupParts();
    const counts = {settings: sum.settings && `${sum.settings.roles} 個角色 · ${sum.settings.presets} 個配音預設`, chats: sum.chats !== null && `${sum.chats} 段`, moments: sum.moments != null && `${sum.moments} 條`, notes: sum.notes !== null && `${sum.notes} 條`, photos: sum.photos !== null && `${sum.photos} 張`, favorites: sum.favorites !== null && `${sum.favorites} 段`, vibes: sum.vibes != null && `${sum.vibes.vibes} 個 · ${sum.vibes.groups} 組`, keys: sum.keys != null && `${sum.keys} 個金鑰（要輸入備份時的密碼）`};
    const when = info.createdAt ? new Date(info.createdAt).toLocaleString('zh-TW', {hour12: false}) : '未知';
    v.draw(heading('恢復', '', 'Restore')
      + `<div class="group pad"><p class="help-copy">備份時間：${esc(when)}${info.version ? ` · 外掛 ${esc(info.version)}` : ''}</p></div>`
      + groupTitle('要恢復的內容')
      + `<div class="group">${Object.entries(labels).map(([key, label]) => counts[key] ? partRow(key, label, counts[key], parts.has(key)) : `<div class="setting-row"><span class="row-text"><strong>${esc(label)}</strong><small>備份裡沒有</small></span></div>`).join('')}</div>`
      + (parts.has('keys') ? `<div class="group pad">${field('備份密碼', input('restore-password', restore.password || '', 'password', 'autocomplete="current-password"'), '輸入備份時設的密碼，才能取出裡面的金鑰。')}</div>` : '')
      + groupTitle('方式')
      + `<div class="segmented"><button data-action="restore-mode" data-value="merge" aria-pressed="${!replace}">合併</button><button data-action="restore-mode" data-value="replace" aria-pressed="${replace}">替換</button></div>`
      + `<p class="hint">${replace ? '替換：選中的內容會先清空，再換成備份裡的。' : '合併：現在的內容都保留，備份裡同一條（同一張照片、同一段聊天）會覆蓋現在的。'}設定和預設總是整體換成備份裡的；金鑰不受影響。</p>`
      + `<div class="actions">${btn('do-restore', icon('refresh') + '開始恢復', 'primary', parts.size ? '' : 'disabled')}</div>`);
  }
  const partRow = (key, label, detail, on) => `<div class="setting-row"><span class="row-text"><strong>${esc(label)}</strong><small>${esc(detail)}</small></span><input class="switch" type="checkbox" data-part="${key}" aria-label="${esc(label)}" ${on ? 'checked' : ''}></div>`;
  const restored = done => [done.keys && `${done.keys} 個金鑰`, done.settings && '設定和預設', done.chats && `${done.chats} 段聊天`, done.moments && `${done.moments} 條朋友圈`, done.notes && `${done.notes} 條備忘錄`, done.photos && `${done.photos} 張照片`, done.favorites && `${done.favorites} 段收藏`, done.vibes && `${done.vibes} 個 Vibe`].filter(Boolean).join('、');

  /** 保存到酒馆: the switch, and when it is on, when it last synced and what the tavern holds. */
  function syncGroup() {
    const st = api.syncStatus?.();
    if (!st) return '';
    const time = at => new Date(at).toLocaleString('zh-TW', {hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'});
    const state = !st.available ? '在酒館裡開啟小手機時才能同步'
      : st.busy ? '正在同步……'
      : st.error ? '同步失敗：' + st.error
      : st.lastAt ? '上次同步 ' + time(st.lastAt) : st.pending ? '有改動，馬上同步' : '還沒同步過';
    const remote = st.remote?.savedAt ? `酒館裡的是${st.remote.deviceName ? ' ' + st.remote.deviceName + ' ' : ''}在 ${time(st.remote.savedAt)} 存的` : '';
    return groupTitle('儲存到酒館')
      + `<div class="group">${toggle('syncEnabled', '儲存到酒館', st.enabled, '聊天記錄、朋友圈、備忘錄和相簿存進酒館裡你賬號的資料夾（data/你的使用者名稱/user/files）。換一臺裝置、換個瀏覽器開啟酒館，小手機裡的東西都還在；清了瀏覽器資料也不會丟。有改動幾秒後自動儲存，開啟小手機時自動讀取別的裝置的新內容。兩臺裝置都改了同一段聊天或同一條朋友圈時，會合併成一份（訊息和評論都保留）；只有一邊改過就直接用那一邊的。金鑰不會存進去；語音快取和收藏的語音也不存，需要時重新生成。')}
        ${st.enabled ? `<div class="setting-row"><span class="row-text"><strong data-sync-state>${esc(state)}</strong>${remote ? `<small>${esc(remote)}</small>` : ''}</span>${btn('sync-now', icon('refresh') + '立即同步', 'chip-button', st.busy || !st.available ? 'disabled' : '')}</div>` : ''}</div>`
      ;
  }
  v.onSync = () => { if (!appearance && !check && !backup && !restore) render().catch(() => {}); };

  async function runCheck() {
    check = {loading: true};
    await render();
    try { const facts = await api.diagnose(); if (check) check = {report: buildReport(facts)}; }
    catch (error) { check = null; await render(); throw error; }
    await render();
  }

  function renderAppearance() {
    const d = appearance;
    v.draw(heading('桌布與圖示', '', 'Appearance')
      + groupTitle('桌布')
      + `<div class="group pad"><div class="wallpaper-options">${Object.entries(wallpapers).map(([key, w]) => `<button class="wallpaper-choice" data-action="wallpaper" data-key="${key}" aria-pressed="${d.wallpaper.kind === 'builtin' && d.wallpaper.key === key}"><span style="--p:${w.background};--ps:${w.size || 'auto'};--pp:${w.pos || 'center'}"></span>${w.name}</button>`).join('')}</div>
        <label class="secondary file-button">${icon('image')}選擇本地圖片作桌布<input type="file" data-personal-file="wallpaper" aria-label="選擇本地桌布" accept="${IMAGE_TYPES}"></label>
        ${d.wallpaper.kind === 'photo' ? `<p class="hint">現在用的是自己的照片。</p><div class="actions">${btn('photo-off', '換回主題桌布', 'secondary')}${btn('photo-delete', icon('trash') + '刪除這張照片', 'danger')}</div>` : ''}
        ${field('圖示外觀', select('iconStyle', d.iconStyle, [['color', '彩色'], ['glass', '玻璃'], ['mono', '單色']]))}</div>`
      + groupTitle('應用圖示')
      + `<div class="group">${Object.entries(APPS).map(([app, meta]) => `<div class="icon-settings-row"><strong>${meta.name}</strong>${select('glyph', d.icons[app]?.kind === 'glyph' ? d.icons[app].key : 'default', api.phoneCatalog.glyphs.map(key => [key, glyphName(key)]), `data-icon-app="${app}"`).replace('aria-label="glyph"', `aria-label="${meta.name}圖示"`)}<label class="chip-button file-button">${d.icons[app]?.kind === 'photo' ? '換圖' : '用圖片'}<input type="file" data-personal-file="icon" data-app="${app}" aria-label="${meta.name}圖示圖片" accept="${IMAGE_TYPES}"></label></div>`).join('')}</div>`
      + `<div class="savebar">${btn('cancel-appearance', '取消', 'secondary')}${btn('save-appearance', '應用', 'primary')}</div>`);
  }

  async function render() {
    const ticket = ++epoch;
    if (appearance) { renderAppearance(); return; }
    if (check) { renderCheck(); return; }
    if (backup) { await renderBackup(ticket); return; }
    if (restore) { renderRestore(); return; }
    const [phone, cache, library, drawn] = await Promise.all([api.getPhone(), api.cacheStats(), api.libraryStats().catch(() => null), api.generatedPhotos().catch(() => null)]);
    const chatPictures = api.chatPictureStats?.() || null;
    if (v.disposed || ticket !== epoch) return;
    const s = api.getState();
    const wallName = phone.wallpaper.kind === 'builtin' ? wallpapers[phone.wallpaper.key]?.name : '自定義照片';
    v.draw(heading('設定', '', 'Settings')
      + groupTitle('外觀')
      + `<div class="group pad">
          <div class="field"><span>主題風格</span><div class="skin-options">${Object.entries(skins).map(([key, s]) => `<button class="skin-choice" data-action="skin" data-value="${key}" aria-pressed="${(phone.skin || 'sky') === key}"><span style="background:${s.preview[0]}"><b style="background:${s.preview[3]}"></b><i style="background:${s.preview[1]}"></i><i style="background:${s.preview[2]}"></i></span>${s.name}</button>`).join('')}</div></div>
          <div class="field"><span>日夜</span><div class="segmented" style="margin:0">${[['system', '跟隨系統'], ['light', '日間'], ['dark', '夜間']].map(([key, label]) => `<button data-action="theme" data-value="${key}" aria-pressed="${phone.theme === key}">${label}</button>`).join('')}</div></div>
          ${toggle('wallpaperMotion', '動態桌布', s.general.wallpaperMotion !== false, '內建桌布會慢慢動起來：晴空飄雲、夜裡星星閃爍和流星、水感晴空的泡泡和夜裡的極光、青草信箋的落葉和夜裡的螢火蟲、櫻色的花瓣。用自己的照片當桌布時不動；系統開啟「減少動態效果」時也保持靜止。')}
          <button class="list-row" data-action="appearance"><span><strong>桌布與圖示</strong><small>${wallName} · ${({color: '彩色', glass: '玻璃', mono: '單色'})[phone.iconStyle]}圖示</small></span>${icon('next')}</button>
          ${phone.wallpaper.kind === 'photo' ? `<div class="setting-row"><span>現在用的是自己的照片當桌布</span>${btn('builtin-wallpaper', '換回主題桌布', 'chip-button')}</div>` : ''}
        </div>`
      + groupTitle('配音')
      + `<div class="group pad">${languageField('defaultLanguage', s.general.defaultLanguage, false, typedLanguages(api.getState()))}
          ${toggle('voiceEnabled', '正文語音', s.general.voiceEnabled !== false, '關掉後，聊天請求裡不再加入語音規則，模型只寫普通對白；正文裡已有的語音標籤只顯示中文譯文，不顯示聲波；手機聊天裡的聯絡人也只發文字。開啟後恢復。')}
          ${toggle('stripVoice', '發給模型時去掉舊配音標籤', s.general.stripVoice !== false, '酒館裡的正文不變，聲波照常顯示；只是之後每次請求模型時，舊回覆裡的每句臺詞只留中文譯文，標籤和原文不發，省上下文，也不用自己寫正則。最新一條帶臺詞的回覆保留原樣，給模型做格式示範（正文語音關掉時也一起去掉）。出圖塊在「繪圖」裡另有同樣的開關。')}
          ${toggle('floatingEnabled', '懸浮入口', s.general.floatingEnabled, '在酒館裡顯示可以拖動的小球，點開再點一次進入手機。')}
          ${toggle('waveformEnabled', '聲波動效', s.general.waveformEnabled, '臺詞旁和手機裡的聲波隨真實音訊跳動。系統開啟減少動態效果時保持靜止。\n\n正文聲波的顏色跟隨酒館主題：\n· 虛線小點：這個角色還沒配音（斜體色）\n· 淡色：還沒生成（正文色）\n· 引號色：已生成，可以播放\n· 引號色加底色：正在播放\n· 下劃線色：已經播放過')}
          <div class="field"><div class="meter-label"><span>播放音量</span><output>${Math.round(phone.volume * 100)}%</output></div><input class="slider" type="range" data-field="volume" min="0" max="100" value="${Math.round(phone.volume * 100)}" aria-label="播放音量"></div>
        </div>`
      + groupTitle('繪圖')
      + `<div class="group">${toggle('drawEnabled', '正文出圖', s.draw.enabled, '開啟後，繪圖預設會加進聊天請求，讓模型在正文裡寫出圖示籤。')}${toggle('drawAuto', '新回覆自動出圖', s.draw.auto, '只自動畫不花錢的：NovelAI 免費檔內的圖、ComfyUI 的圖；GPT 生圖在「每張先問」關掉後也會自動畫。其餘的正文裡顯示“點選生成”。用哪個引擎畫在繪圖 App 頂上選。')}${toggle('drawFold', '正文圖片預設收起', s.draw.fold, '正文裡只留一個小縮圖，點開再看。每張圖也能單獨收起或展開。')}${toggle('drawGuard', '免費檔守衛', s.draw.guard, '步數不超過 28、尺寸不超過 1024×1024，不會發出扣 Anlas 的請求。')}</div>`
      + groupTitle('分割槽')
      + (() => { const space = api.phoneSpace?.() || {}; return `<div class="group">${toggle('partition', '按角色卡分開', s.chat.partition === 'card', '開啟後，每張角色卡（群聊是每個群）一部手機：聊天記錄、朋友圈、論壇、查手機各管各的，換卡就換手機；聯絡人只有這張卡的角色、在這張卡劇情裡說過話的角色，和在這張卡里手動加的聯絡人。「我」跟著酒館給這張卡鎖定的人設走。\n\n開啟之前就有的聊天和動態沒有歸屬，每張卡都看得到；不想要的可以刪掉。關掉分割槽後，所有東西又會一起顯示。')}
          <div class="setting-row"><span>現在是</span><small>${space.key ? esc(space.name || '這張角色卡') + (s.chat.partition === 'card' ? ' 的手機' : '') : '沒有開啟角色卡'}</small></div></div>`; })()
      + groupTitle('手機')
      + `<div class="group">${toggle('lockOnOpen', '開啟時顯示鎖屏', phone.lockOnOpen, '鎖屏可隨時跳過，是外掛內的外觀，不是手機安全鎖。')}<button class="list-row" data-action="lock"><span><strong>看一眼鎖屏</strong></span>${icon('lock')}</button></div>`
      + groupTitle('儲存')
      + `<div class="group">${toggle('cacheEnabled', '儲存語音快取', s.general.cacheEnabled, '已生成的音訊用於重播。清快取不會刪除收藏、相簿、備忘錄或參考音訊。')}
          <div class="setting-row"><span>語音快取</span><small>${cache.available ? cache.count + ' 段 · ' + size(cache.bytes) : '本地快取不可用'}</small></div>
          <div class="setting-row"><span>本地資料</span><small>${library ? size(library.bytes) + ' / ' + size(library.limit) : '無法讀取'}</small></div>
          <div class="setting-row"><span>相簿裡的繪圖</span><small>${drawn ? drawn.count + ' 張 · ' + size(drawn.bytes) : '無法讀取'}</small></div>
          ${chatPictures ? `<div class="setting-row"><span>當前聊天的正文圖片</span><small>${chatPictures.count} 張 · 存在酒館</small></div>` : ''}</div>
        <details class="tool-fold" data-group="storage-clear"><summary>${icon('trash')}清理<small>語音快取 · 相簿裡的繪圖 · 正文圖片</small></summary><div>
          <div class="actions" style="margin-top:0">${btn('clear-cache', icon('trash') + '清理語音快取', 'danger')}${btn('clear-drawn', icon('trash') + '清除相簿裡的繪圖', 'danger', drawn?.count ? '' : 'disabled')}${chatPictures ? btn('clear-chat-pictures', icon('trash') + '清除正文圖片', 'danger', chatPictures.count ? '' : 'disabled') : ''}</div></div></details>
        ${syncGroup()}
        ${groupTitle('備份與恢復')}<div class="group"><button class="list-row" data-action="backup"><span><strong>備份到檔案</strong><small>設定、角色音色、聊天記錄、相簿和收藏存成一個檔案，換裝置或誤刪時能找回</small></span>${icon('next')}</button><label class="list-row file-button"><span><strong>從檔案恢復</strong><small>選一個 ST-iPhonie 備份檔案</small></span>${icon('next')}<input type="file" data-backup-file accept=".json,application/json" aria-label="選擇備份檔案"></label></div>
        ${groupTitle('幫助')}<div class="group"><button class="list-row" data-action="self-check"><span><strong>自檢</strong><small>出問題時看看是哪裡不對，可以把報告發給幫你的人</small></span>${icon('next')}</button></div>
        <div class="actions">${btn('about', '關於 ST-iPhonie', 'text-button')}</div>`);
  }

  v.back = () => { if (!appearance && !check && !backup && !restore) return false; appearance = check = backup = restore = null; render().catch(e => ctx.notify(e.message)); return true; };
  v.refresh = () => { if (!appearance) return render(); };
  v.on('input', '[data-field=volume]', el => { el.previousElementSibling.querySelector('output').textContent = el.value + '%'; });
  v.on('change', '[data-field]', async el => {
    const key = el.dataset.field;
    if (appearance) {
      if (key === 'iconStyle') appearance.iconStyle = el.value;
      if (key === 'glyph') appearance.icons[el.dataset.iconApp] = el.value === 'default' ? null : {kind: 'glyph', key: el.value};
      return;
    }
    if (key === 'syncEnabled') { api.saveSync({enabled: el.checked}); await render(); return; }
    if (['voiceEnabled', 'floatingEnabled', 'waveformEnabled', 'cacheEnabled', 'wallpaperMotion', 'stripVoice'].includes(key)) api.updateGeneral({[key]: el.checked});
    else if (key === 'drawEnabled') api.saveDraw({enabled: el.checked});
    else if (key === 'drawAuto') api.saveDraw({auto: el.checked});
    else if (key === 'drawGuard') api.saveDraw({guard: el.checked});
    else if (key === 'drawFold') api.saveDraw({fold: el.checked});
    else if (key === 'defaultLanguage') api.updateGeneral({defaultLanguage: el.value});
    else if (key === 'volume') await api.setVolume(Number(el.value) / 100);
    else if (key === 'lockOnOpen') await api.savePhone({lockOnOpen: el.checked});
    else if (key === 'partition') { api.saveChatOptions({partition: el.checked ? 'card' : 'none'}); ctx.notify(el.checked ? '已按角色卡分開' : '已關閉分割槽，所有內容一起顯示'); }
  });
  v.on('input', '[data-field=backup-password],[data-field=backup-again],[data-field=restore-password]', el => {
    if (el.dataset.field === 'restore-password') { if (restore) restore.password = el.value; return; }
    if (!backup) return;
    backup[el.dataset.field === 'backup-password' ? 'password' : 'again'] = el.value;
    const note = v.root.querySelector('[data-password-note]');
    if (note) note.textContent = passwordNote();
    const go = v.root.querySelector('[data-action=make-backup]');
    if (go) go.disabled = !canBackup();
  });
  v.on('change', '[data-part]', async el => {
    const parts = backup?.parts || restore?.parts;
    if (!parts) return;
    if (el.checked) parts.add(el.dataset.part); else parts.delete(el.dataset.part);
    // The key part brings its password fields in or out.
    if (el.dataset.part === 'keys') { await render(); return; }
    const go = v.root.querySelector('[data-action=make-backup],[data-action=do-restore]');
    if (go) go.disabled = backup ? !canBackup() : !parts.size;
  });
  v.on('change', '[data-backup-file]', async el => {
    const file = el.files?.[0];
    if (!file) return;
    el.disabled = true;
    try {
      const info = await api.inspectBackup(file), sum = info.summary;
      const parts = new Set(Object.keys(api.backupParts()).filter(key => key === 'settings' ? sum.settings : sum[key] != null));
      restore = {file, info, parts, replace: false};
      await render();
    } finally { if (el.isConnected) { el.value = ''; el.disabled = false; } }
  });
  v.on('change', '[data-personal-file]', async el => {
    const file = el.files?.[0], target = appearance;
    if (!file || !target) return;
    el.disabled = true;
    try {
      const photo = await api.addPhoto({name: file.name, blob: file});
      if (appearance !== target) return;
      if (el.dataset.personalFile === 'wallpaper') target.wallpaper = {kind: 'photo', photoId: photo.id};
      else target.icons[el.dataset.app] = {kind: 'photo', photoId: photo.id};
      await render();
    } finally { if (el.isConnected) { el.disabled = false; el.value = ''; } }
  });
  v.on('click', '[data-action]', async el => {
    switch (el.dataset.action) {
      case 'theme': await api.savePhone({theme: el.dataset.value}); await render(); break;
      // A skin brings its own wallpaper, unless a personal photo is the wallpaper.
      case 'skin': { const p = await api.getPhone(); await api.savePhone({skin: el.dataset.value, ...(p.wallpaper.kind === 'builtin' ? {wallpaper: {kind: 'builtin', key: el.dataset.value}} : {})}); await render(); break; }
      case 'appearance': { const p = await api.getPhone(); appearance = {wallpaper: p.wallpaper, icons: p.icons, iconStyle: p.iconStyle}; await render(); break; }
      case 'wallpaper': appearance.wallpaper = {kind: 'builtin', key: el.dataset.key}; await render(); break;
      // Stop using a photo: back to the skin's own wallpaper, which follows day and night.
      case 'builtin-wallpaper': { const p = await api.getPhone(); await api.savePhone({wallpaper: {kind: 'builtin', key: p.skin || 'sky'}}); await render(); ctx.notify('已換回主題桌布'); break; }
      case 'photo-off': { const p = await api.getPhone(); appearance.wallpaper = {kind: 'builtin', key: p.skin || 'sky'}; await api.savePhone({wallpaper: appearance.wallpaper}); await render(); ctx.notify('已換回主題桌布'); break; }
      case 'photo-delete': {
        if (!await ctx.confirm('刪除這張照片？', '照片會從相簿刪除，桌布換回主題桌布。')) break;
        await api.deletePhoto(appearance.wallpaper.photoId);
        const p = await api.getPhone();
        if (p.wallpaper.kind !== 'builtin' || p.wallpaper.key !== (p.skin || 'sky')) await api.savePhone({wallpaper: {kind: 'builtin', key: p.skin || 'sky'}});
        const now = await api.getPhone();
        appearance = {wallpaper: now.wallpaper, icons: now.icons, iconStyle: now.iconStyle};
        await render();
        ctx.notify('照片已刪除');
        break;
      }
      case 'cancel-appearance': appearance = null; await render(); break;
      case 'save-appearance': await v.busy(el, async () => { await api.savePhone(appearance); appearance = null; await render(); ctx.notify('外觀已應用'); }); break;
      case 'lock': ctx.lock(); break;
      case 'self-check': case 'run-check': await runCheck(); break;
      case 'backup': backup = {parts: new Set(Object.keys(api.backupParts()).filter(part => part !== 'keys')), password: '', again: ''}; await render(); break;
      case 'sync-now': { const st = await api.syncNow(); const r = st.lastResult || {}; ctx.notify(r.pulled?.length || r.merged?.length ? '已讀取別的裝置的新內容' + (r.pushed?.length ? '，也儲存了這裡的改動' : '') : r.pushed?.length ? '已儲存到酒館' : '已經是最新的了'); await render(); break; }
      case 'make-backup':
        await v.busy(el, async () => {
          if (!passwordOk()) throw Error(backup.password.length < 6 ? '密碼至少 6 位' : '兩次輸入的密碼不一樣');
          const {blob, name} = await api.exportBackup([...backup.parts], {password: backup.parts.has('keys') ? backup.password : ''});
          ctx.notify(`已下載 ${await saveFile(ctx.doc, blob, name)}（${size(blob.size)}）`);
        });
        break;
      case 'restore-mode': restore.replace = el.dataset.value === 'replace'; await render(); break;
      case 'do-restore': {
        const {replace, parts, file} = restore;
        if (parts.has('keys') && !restore.password) { ctx.notify('要取出金鑰，先輸入備份時設的密碼（不需要金鑰的話，把「金鑰」關掉）'); break; }
        const sure = await ctx.confirm(replace ? '替換成備份裡的內容？' : '恢復備份？', replace ? '選中的內容會先被清空，再換成備份裡的。這一步不能撤銷，想留著現在的內容可以先備份一次。' : '現在的內容會保留，備份裡同一條會覆蓋現在的；設定和預設會整體換成備份裡的。');
        if (!sure) break;
        const done = await v.busy(el, () => api.importBackup(file, {parts: [...parts], replace, password: restore.password || ''}));
        restore = null;
        await render();
        ctx.notify('已恢復：' + (restored(done) || '沒有內容'));
        break;
      }
      case 'copy-report': {
        const text = check?.report?.text || '';
        try { if (!await copyText(ctx.win, text)) throw Error('copy'); ctx.notify('已複製報告'); }
        catch { const box = v.root.querySelector('.report-text'); if (box) { box.open = true; box.querySelector('textarea')?.select(); } ctx.notify('沒能自動複製，請在下面的報告原文裡手動複製'); }
        break;
      }
      case 'save-report': {
        const text = check?.report?.text || '', stamp = new Date().toLocaleString('zh-TW', {hour12: false}).replace(/[/:]/g, '-');
        await v.busy(el, async () => ctx.notify('已下載 ' + await saveFile(ctx.doc, new Blob([text], {type: 'text/plain;charset=utf-8'}), `ST-iPhonie 自檢 ${stamp}`)));
        break;
      }
      case 'clear-drawn':
        if (await ctx.confirm('清除相簿裡的繪圖？', '繪圖 App 和正文出圖存進相簿的圖片會被刪除，自己匯入的照片保留。正文裡的圖片不受影響。')) { const n = await v.busy(el, () => api.deleteGeneratedPhotos()); await render(); ctx.notify(`已清除 ${n} 張`); }
        break;
      case 'clear-chat-pictures':
        if (await ctx.confirm('清除當前聊天的正文圖片？', '圖片檔案會從酒館刪除，出圖示籤還在，之後可以點“點選生成”重新畫。相簿裡的副本不受影響。')) { const r = await v.busy(el, () => api.clearChatPictures()); await render(); ctx.notify(`已清除 ${r.count} 張` + (r.failed ? `，${r.failed} 張沒刪掉` : '')); }
        break;
      case 'clear-cache':
        if (await ctx.confirm('清理語音快取？', '正在播放的音訊會停止，收藏和其他資料會保留。')) { await v.busy(el, () => api.clearCache()); await render(); ctx.notify('語音快取已清理'); }
        break;
      case 'about': ctx.help('ST-iPhonie\n酒館裡的小手機：聊天、角色配音、聽取、繪圖（NovelAI、GPT 生圖、ComfyUI）、收藏、相簿和備忘錄。\n\n金鑰和本地資料儲存在當前瀏覽器與酒館地址。狀態列的訊號和電量是裝飾。語音只在你點選播放或試聽後生成。'); break;
    }
  });
  render().catch(e => ctx.notify(e.message));
  return v;
}
