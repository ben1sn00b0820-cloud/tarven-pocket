import fs from 'node:fs/promises';
import {PHONE_PROMPT, PHONE_EXAMPLES} from '../pocket/prompt.js';
import {PHONE_VERSION, encodePhoneEvents} from '../pocket/events.js';
import {SPIRIT_CURRENCY_RULE} from '../core/currency.js';
import {PRESET_OWNER} from '../pocket/presets.js';

// Keep the established import schema and stable IDs; derive live protocol from code.
const dir = new URL('../presets/', import.meta.url);
const book = JSON.parse(await fs.readFile(new URL('TavernPocket_Worldbook_v0.3.0.json', dir), 'utf8'));
const examples = key => PHONE_EXAMPLES[key].map(event => encodePhoneEvents(event)).join('\n');
for (const entry of Object.values(book.entries)) {
  entry.comment = entry.comment.replace(/Tavern Pocket/g, '傳音玉符').replace(/v0\.3\.0/g, `v${PHONE_VERSION}`).replace(/微信/g, '千里傳音').replace(/Instagram/g, '浮光錄').replace(/論壇/g, '論道臺');
}
book.entries['0'].content = PHONE_PROMPT;
book.entries['0'].key = [...new Set([...(book.entries['0'].key || []), '傳音玉符', '千里傳音', '角色信息', '靈石'])];
book.entries['1'].content = '以下只是格式示例，須依當前劇情換成新 id 與實際內容。角色透過千里傳音傳訊、語音、位置或照片。照片使用已知位址或明確描述；生圖仍使用已配置的服務與參數，不捏造圖片。引用只包含原訊息摘要，撤回僅能引用自己先前尚未結算的訊息。\n' + examples('wechat');
book.entries['1'].key.push('千里傳音');
book.entries['2'].content = '千里傳音群組建立後，使用 group_message 發言。發言人須在成員中；保留既有群名與事件 id，勿重建或冒充使用者。\n' + examples('group');
book.entries['3'].content = SPIRIT_CURRENCY_RULE + '\nJSON amount 一律寫換算後的整數下品靈石，不附品級文字，不再次乘上匯率。轉帳與紅包同步成待收卡片，使用者收取才入帳；模型不能替使用者收款、付款或退款。\n' + examples('wallet');
book.entries['3'].key.push('靈石', '下品靈石', '中品靈石', '極品靈石');
book.entries['4'].comment = `傳音玉符 v${PHONE_VERSION} 浮光錄貼文・限時動態・留言・私訊`;
book.entries['4'].key.push('浮光錄', '限時動態', '限動', 'story');
book.entries['4'].content = '浮光錄帳號依角色姓名建立。post 與 story 可附 text、已知安全 image 及英文 imagePrompt；限動時間由玉符處理。dm 可用 storyId 回覆既有限動；comment／like 的 ref 須指向既有貼文。既有玉符紀錄不可重發成新 phone 事件。\n' + examples('instagram');
book.entries['5'].comment = `傳音玉符 v${PHONE_VERSION} 修行札記`;
book.entries['5'].key.push('修行札記');
book.entries['5'].content = '角色札記使用 app diary、action entry。只寫該角色已知之事，不冒充使用者寫私人日記。\n' + examples('diary');
book.entries['6'].comment = `傳音玉符 v${PHONE_VERSION} 使用者專屬萬寶閣`;
book.entries['6'].key.push('萬寶閣', '万宝阁', '萬寶商城', '萬寶');
book.entries['6'].content = '萬寶閣是使用者專屬的故事商城，生成清單不代表購買。成功購買或正文中明確完成並由插件登記的取得，寫入「吾身錄」的物品與能力。有已知價格或使用者明示價才記扣款，未計價取得只存記憶。可寫「我進入萬寶閣，以 2 中品靈石購買了回氣丹」。收據只保存在手機與長期記憶；模型不得輸出 shop/purchase 冒充使用者付款。未購清單與舊紀錄按需要搜尋，不整批貼回正文。\n' + SPIRIT_CURRENCY_RULE;
book.entries['7'] = {...structuredClone(book.entries['1']), uid: 7, displayIndex: 7, order: 107,
  key: ['聯絡人', '联系人', '角色信息', '角色資料', '角色资料', 'CSB_UPDATE', 'CSB21_PANEL', 'CSB2_PANEL'],
  comment: `傳音玉符 v${PHONE_VERSION} 持久角色信息與聯絡人`,
  content: '「角色信息」是持久人物資料。「劇情狀態」是正文中的當回合快照。使用 CSB 穩定角色 ID 與 <CSB_UPDATE> 協定，只更新本回合正文已明確改變的欄位並給理由；未提及的欄位、手動設定、角色離場均保留。禁止每回合整份重建或以 null／空字串清除已知資料。明確移除依 CSB clear 協定；不自行猜值。關閉正文顯示不停止資料保存。不要為 CSB 資料重複生成 HTML 狀態框；角色卡原有獨立狀態欄規則保留。舊版 CSB21／CSB2 仍可讀取。千里傳音以角色姓名或唯一別名對應；使用者刪除的聯絡人不因同步自動恢復。以下 profile 只是格式，不能套給其他角色。\n' + examples('contact')};
book.entries['8'] = {...structuredClone(book.entries['1']), uid: 8, displayIndex: 8, order: 108,
  key: ['論道臺', '论道台', '論壇', '论坛', '發帖', '回帖'], comment: `傳音玉符 v${PHONE_VERSION} 論道臺貼文・回覆`,
  content: '論道臺 post 使用 text，可選 title、board；comment 使用既有貼文 ref 與 text。以角色實際姓名輸出，勿冒充使用者。新的貼文與回覆只顯示在手機並保存於本對話記憶；舊歷史不整批補發。\n' + examples('forum')};
book.entries['9'] = {...structuredClone(book.entries['1']), uid: 9, displayIndex: 9, order: 109,
  key: ['千里傳音傳給', '微信傳給', '浮光錄發文', 'IG發文', '論道臺發文', '論壇發文', '玉符紀錄'], comment: `傳音玉符 v${PHONE_VERSION} 明確自然指令`,
  content: '正文可穿插「千里傳音傳給雲璃：「稍後議事。」」「浮光錄發文：「今日山色。」」「論道臺發文：「求購回氣丹。」」「千里傳音轉帳給雲璃：2 中品靈石「丹藥費」」。使用者指令只建立待確認付款，確認發送才扣靈石；角色轉帳則為收到的待領卡片。角色可寫「雲璃千里傳音傳給我：「公子，帳目已核對。」」，我／你／您作收件者指使用者。舊微信、Instagram／IG、論壇別名仍可讀。相同事件只選自然格式或 JSON 一種，不重複輸出。假設、否定、引述、程式區塊、HTML、狀態欄與不完整指令不執行。'};
book.entries['10'] = {...structuredClone(book.entries['1']), uid: 10, displayIndex: 10, order: 110,
  key: ['吾身錄', '@我', '@我的資訊', '@我的信息', '@我的物品', '@我的能力', '我的物品', '我的能力'], comment: `傳音玉符 v${PHONE_VERSION} 吾身錄與正文引用`,
  content: '正文輸入 @ 可搜尋目前身分在「吾身錄」的資訊、物品和能力。引用使用最新已存內容；未知、已刪除或其他身分的資料不可補造。引用本身不扣款、不消耗道具，不代表購買或新增能力。'};

book.entries['11'] = {...structuredClone(book.entries['1']), uid: 11, displayIndex: 11, order: 111,
  constant: true, key: ['CSB', 'CSB_UPDATE', '角色信息'], comment: `傳音玉符 v${PHONE_VERSION} CSB 更新格式`,
  content: 'CSB 狀態由插件讀取資料後顯示，不依賴模型輸出 HTML。正常劇情仍須照常回覆；當角色信息規則啟用時，回覆末尾另附一個完整 <CSB_UPDATE>JSON</CSB_UPDATE> 區塊，勿用程式碼圍欄，勿輸出多個區塊。格式為 {"version":1,"scene":{"time":"已知劇情時間","location":"已知位置"},"present":["c_example"],"characters":[{"id":"c_example","name":"角色姓名","set":{"mood":"已知情緒"},"reason":"本輪正文依據"}]}。此例只說明結構，不建立示例角色。scene 未知項目省略；characters 無變動用 []。既有角色使用插件提供目錄中的 id，新人使用唯一 c_ ID；set 只能使用本次角色信息提示中已啟用欄位及正確型別。自訂欄位以插件當前模板為準，不照抄示例。已知資料持續保存，缺資料不代表空字串、null、0 或 false。原有獨立狀態欄可依角色卡規則繼續生成，不為 CSB 複製另一份 HTML。'};
book.entries['12'] = {...structuredClone(book.entries['1']), uid: 12, displayIndex: 12, order: 112,
  key: ['在場', '離場', '现场', 'present', 'presenceMode'], comment: `傳音玉符 v${PHONE_VERSION} CSB 在場與離場`,
  content: 'present 指目前主要場景實際在場的人；只提到姓名、回憶、假設、未發生計畫或遠端電話／訊息不算在場。頂層 present 是完整在場 ID 陣列，未離場者保留；只有明確全員離場才用 []。無法確定完整名單時省略頂層 present，改在已知角色更新中填 present:true 或 present:false 並給 reason，其他人沿用。present 不可放進 set。使用者可以立即切換現在在場與否，也可另設固定在場、固定離場或跟隨劇情；固定選擇優先，不用推測覆寫。離場保留角色資料。'};
book.entries['13'] = {...structuredClone(book.entries['1']), uid: 13, displayIndex: 13, order: 113,
  key: ['刪除角色', '删除角色', '恢復角色', '恢复角色', '角色管理', '手動修改'], comment: `傳音玉符 v${PHONE_VERSION} CSB 手動管理與保存`,
  content: '角色刪除、恢復、姓名修正及手動固定狀態由使用者在角色信息介面操作。已刪除的角色不可因舊正文、掃描或換一個 ID 自動重新建立。未提及欄位保留，手動及鎖定欄位不可由模型改寫。欄位確實清除才依 clear:["欄位ID"] 配合具體 reason，這不等於刪除整個角色。關閉正文卡片只影響顯示，資料仍保存。'};
book.entries['14'] = {...structuredClone(book.entries['1']), uid: 14, displayIndex: 14, order: 114,
  key: ['AI 掃描', 'AI扫描', '掃描正文', '資料抽取'], comment: `傳音玉符 v${PHONE_VERSION} CSB 掃描資料原則`,
  content: '掃描只抽取已提供的正文事實，與角色扮演續寫分開。保留既有角色 ID 與已知資料，不為補欄位編造事件、不把遠端訊息當在場。依當次掃描任務要求回傳資料結構，不回傳故事正文、HTML 或額外評論。沒有可更新的事實時用有效空結果。服務拒絕、連線失敗或資料不完整不能被當成成功更新，也不能清空既有資料。'};
book.entries['15'] = {...structuredClone(book.entries['1']), uid: 15, displayIndex: 15, order: 115,
  key: ['女性模板', '男性模板', '通用模板', '角色模板', 'appliesTo'], comment: `傳音玉符 v${PHONE_VERSION} 男女角色模板`,
  content: '角色欄位有通用、女性、男性三種適用範圍。通用欄位供所有角色使用，女性／男性專用欄位只供符合目前角色模板的角色使用。實際欄位 ID、型別與說明以本次插件提供的模板為準，禁止自行建立未定義欄位。自動選擇只依角色明確已知的性別，不從姓名、外觀、性格或職業推測；性別未知時只使用通用欄位。使用者可以手動指定模板，其選擇優先。切換模板只改變適用及顯示欄位，不刪除原本保存的資料；已停用或不適用欄位不得由模型繼續更新。'};
book.entries['16'] = {...structuredClone(book.entries['1']), uid: 16, displayIndex: 16, order: 116,
  key: ['掃描預設', '扫描预设', 'AI 填表', '酒館預設', '自訂掃描'], comment: `傳音玉符 v${PHONE_VERSION} AI 填表預設`,
  content: 'AI 填表的掃描預設由使用者新增、編輯、選用或匯入，保存的是抽取任務說明。使用者可選擇沿用酒館目前提示預設的安靜生成流程，或使用獨立資料抽取流程；兩者都只交付掃描結果，不續寫故事、不替使用者發送訊息，也不將結果貼進正文。沿用酒館預設時仍以本次掃描指定的正文、來源引用與欄位清單核對可採用的資料，不從其他背景或預設示例新增無來源的角色事實。結構、來源依據、既有鎖定及手動設定始終有效。模型沒有返回有效資料時顯示診斷，不能假稱已填表。'};
for (const entry of Object.values(book.entries)) entry.extensions = {...entry.extensions, tavern_pocket: {owner: PRESET_OWNER, key: String(entry.uid), version: PHONE_VERSION}};
book.extensions = {...book.extensions, tavern_pocket: {owner: PRESET_OWNER, version: PHONE_VERSION}};

// Display-only fallback. Raw chat remains available to the phone/CSB parsers.
// Never match natural-language fragments or old status panels: the runtime
// validates natural events and keeps unrelated status renderers intact.
const regex = JSON.parse(await fs.readFile(new URL('TavernPocket_Regex_v0.3.0.json', dir), 'utf8'));
regex.scriptName = `傳音玉符 v${PHONE_VERSION} — 隱藏手機與 CSB 資料協定`;
regex.findRegex = String.raw`/<phone>\s*(?:\{(?:(?!<\/?phone>)[\s\S])*?\}|\[(?:(?!<\/?phone>)[\s\S])*?\])\s*<\/phone>|<CSB_UPDATE>\s*\{(?:(?!<\/?CSB_UPDATE>)[\s\S])*?\}\s*<\/CSB_UPDATE>/g`;
regex.replaceString = '';
regex.placement = [1, 2];
regex.markdownOnly = true;
regex.promptOnly = false;
regex.disabled = false;
regex.runOnEdit = true;
regex.extensions = {...regex.extensions, tavern_pocket: {owner: PRESET_OWNER, version: PHONE_VERSION}};
for (const [names, value] of [
  [[`TavernPocket_Worldbook_v${PHONE_VERSION}.json`, 'worldbook-tavern-pocket.json'], book],
  [[`TavernPocket_Regex_v${PHONE_VERSION}.json`, 'regex-hide-phone.json'], regex],
]) for (const name of names) await fs.writeFile(new URL(name, dir), JSON.stringify(value, null, 2) + '\n');
