import fs from 'node:fs/promises';
import {PHONE_PROMPT, PHONE_EXAMPLES} from '../pocket/prompt.js';
import {PHONE_VERSION, encodePhoneEvents} from '../pocket/events.js';

// Use the original import schema while deriving every protocol example from code.
const dir = new URL('../presets/', import.meta.url);
const book = JSON.parse(await fs.readFile(new URL('TavernPocket_Worldbook_v0.3.0.json', dir), 'utf8'));
for (const entry of Object.values(book.entries)) entry.comment = entry.comment.replace(/v0\.3\.0/g, `v${PHONE_VERSION}`);
book.entries['0'].content = PHONE_PROMPT;
const examples = key => PHONE_EXAMPLES[key].map(event => encodePhoneEvents(event)).join('\n');
book.entries['1'].content = '以下只是格式示例，必須依當前劇情換成新 id 和實際內容。照片已有真實圖片位址時手機直接顯示；沒有位址時保留清楚的畫面描述，手機偵測新角色照片後自動使用使用者已配置的 NovelAI API 生成實圖並補回同一則訊息，不必逐張按生成。尚未配置金鑰或失敗時保留描述與原因，不假裝已生成。範例路徑僅說明格式，不代表圖片存在，不可直接重用或捏造網址。引用只包含原訊息摘要，撤回僅能引用自己先前尚未結算的訊息。\n' + examples('wechat');
for (const [id, key] of [['2', 'group'], ['3', 'wallet'], ['4', 'instagram'], ['5', 'diary']]) {
  book.entries[id].content = book.entries[id].content.split('\n<phone>')[0] + '\n' + examples(key);
}
book.entries['4'].comment = `Tavern Pocket v${PHONE_VERSION} Instagram 貼文・限時動態・留言・私訊`;
book.entries['4'].key.push('限時動態','限動','story');
book.entries['4'].content = '角色帳號依角色姓名自動抓取。post 與 story 可附 text、已知安全 image 及英文 imagePrompt；限動時間由手機處理。dm 可用 storyId 回覆既有限動；comment／like 的 ref 必須指向既有貼文。角色與使用者的既有手機紀錄不可重發成新 phone 事件。\n' + examples('instagram');
book.entries['6'].comment = `Tavern Pocket v${PHONE_VERSION} 使用者專屬萬寶商城`;
book.entries['6'].key.push('萬寶商城','萬寶');
book.entries['6'].content = '萬寶商城是使用者專屬的虛擬商城，只有使用者能操作，其他角色沒有自己的同款商城。商城依正文、選定世界書與查詢生成故事內物品、人物、身分、資格與其他劇情資源。生成清單不代表購買。手機購買成功，或使用者正文中已完成且由插件登記的購買／取得，都寫入「我」的物品與能力。使用者可寫「我打開小手機，進入萬寶商城，購買了時間停止能力」；已知價格或明示價格才記扣款，未計價取得只存長期記憶，不假裝已付款。新的成功購買可依手機接入設定顯示正文收據卡；商品目錄、未購清單與舊訂單不整批貼到正文，仍保存於可搜尋記憶並依需要調用。已購物品／能力仍由「我」的長期記憶提供。角色依已登記資料接續劇情，不得輸出 shop/purchase 冒充使用者付款。';
book.entries['7'] = {...structuredClone(book.entries['1']), uid: 7, displayIndex: 7, order: 107,
  key: ['聯絡人', '联系人', '角色資料', '角色资料', '身材', '身高', 'CSB21_PANEL', 'CSB2_PANEL'],
  comment: `Tavern Pocket v${PHONE_VERSION} 自動聯絡人・角色狀態欄連動`,
  content: '角色在正文發微信使用明確自然格式或 phone 區塊，手機按 from 建立聯絡人。from 與狀態欄 name 完全相同才能合併。contact 僅更新已知資料；profile 欄位沒有依據就省略。以下身分、身高、體型僅是格式例子，不得直接套給當前角色。手機讀取最新完整 CSB21／CSB2 狀態；body 依原狀態協定隨劇情變化，未交代的欄位與自訂空格保留原值。使用者在手機編輯狀態後依最新編輯紀錄接續。原狀態欄世界書與正則沿用。\n' + examples('contact')};
book.entries['8'] = {...structuredClone(book.entries['1']), uid: 8, displayIndex: 8, order: 108,
  key:['論壇','论坛','論壇貼文','發帖','回帖'], comment:`Tavern Pocket v${PHONE_VERSION} 論壇貼文・回覆`,
  content:'新的論壇貼文與回覆可依手機接入設定顯示正文卡片，也保存在手機及本對話記憶；舊歷史不整批回貼。正文中的明確論壇格式在原處美化並同步，無須模型再輸出一次；不要為了同步而重複全文。論壇 post 使用 text，可選 title、board；comment 使用既有論壇貼文 ref 與 text。以角色實際姓名輸出，勿冒充使用者。\n'+examples('forum')};
book.entries['9'] = {...structuredClone(book.entries['1']), uid: 9, displayIndex: 9, order: 109,
  key:['微信傳給','IG發文','IG發限動','論壇發文','手機紀錄'],comment:`Tavern Pocket v${PHONE_VERSION} 正文卡片與明確使用者指令`,
  content:'微信、Instagram、論壇與日記的 phone JSON 可轉為有軟體標籤、姓名、內容、金額的正文卡片；商城已完成購買由插件生成專屬收據卡，模型不可輸出付款成功指令。使用者親自輸入的明確自然指令如 微信傳給某某：「吃飯沒？」、IG發文：「內容」、IG發限動：「內容」、IG傳給某某：「內容」、論壇發文：「內容」、論壇回覆貼文ID：「內容」會被解析為本人操作。模型不得把該指令重新複製為新事件。微信轉帳給某某：88.50「備註」、微信紅包給某某：20「祝福」可顯示財務卡片，但正文指令不會直接扣款，需在手機內確認發送。角色回覆也能在同一段正文穿插多個自然格式，如 微信傳給你：「吃飯沒？」、林知夏微信傳給我：「吃飯沒？」、林知夏在Instagram發限動：「散步」。未寫姓名時採用該則回覆的角色姓名；角色指令的我／你／您收件者均指使用者。角色轉帳、紅包屬於收到的待領卡片，不可冒充使用者付款。相同事件選自然格式或 JSON 其中一種。例如整段文字可寫：她放下外套，微信傳給你：「吃飯沒？」螢幕暗下片刻，林知夏微信紅包給我：20「好運」。她收起手機。手機卡片在原處顯示，前後正文保留。這些範例不得直接當成已發生事件；假設、否定、引述、程式區塊、HTML、狀態欄與不完整指令不當成操作。'};
book.entries['10'] = {...structuredClone(book.entries['1']), uid:10, displayIndex:10, order:110,
  key:['@我','@我的資訊','@我的信息','@我的物品','@我的能力','我的物品','我的能力'], comment:`Tavern Pocket v${PHONE_VERSION} 正文 @ 引用與個人資料`,
  content:'使用者在正文輸入框輸入 @ 可搜尋目前身分在「我」裡的資訊、物品和能力。選取後插入引用，插件於產生回覆時讀取最新保存資料。精確引用以提供的目前資料為準；未知、已刪除或其他身分的資料不可補造。引用本身不扣款、不消耗道具、不代表購買或新增能力；依使用者敘述及已確認能力描述接續劇情。'};
// Keep the stable ID so installation replaces the old hide-all regex. This
// standalone fallback accepts text without HTML metacharacters; full Unicode,
// JSON arrays and rich events are escaped by the extension's runtime renderer.
const regex = JSON.parse(await fs.readFile(new URL('TavernPocket_Regex_v0.3.0.json', dir), 'utf8'));
regex.scriptName = `Tavern Pocket v${PHONE_VERSION} — 正文手機卡片・微信・論壇・購物收據`;
regex.findRegex = '/((?:微信(?:傳給|传给|轉帳給|转账给|紅包給|红包给)|(?:Instagram|IG)(?:傳給|传给|私訊給|私信给|發文|发文|發帖|发帖|發限動|发限动|限時動態|限时动态)|(?:論壇|论坛)(?:發文|发文|發帖|发帖|回覆|回复|回帖))[^<>&\\r\\n：「」]{0,128})[：:][ \\t]*((?:[¥￥]?[ \\t]*[0-9]+(?:\\.[0-9]{1,2})?[ \\t]*)?)「([^<>&「」\\r\\n]{1,4000})」/gmi';
regex.replaceString = '<span class="tp-story-fallback" style="display:block;box-sizing:border-box;margin:12px 0;padding:13px 15px;max-width:430px;border:1px solid #dce6e1;border-radius:17px;background:linear-gradient(145deg,#fbfdfb,#f0f6f2);color:#24362d;overflow-wrap:anywhere;box-shadow:0 3px 12px #1733260b"><span style="display:block;color:#27865a;font-size:12px;margin-bottom:7px">手機紀錄 · $1</span><span style="display:block;white-space:pre-wrap">$2$3</span></span>';
regex.placement = [1, 2];
for (const [names, value] of [
  [[`TavernPocket_Worldbook_v${PHONE_VERSION}.json`, 'worldbook-tavern-pocket.json'], book],
  [[`TavernPocket_Regex_v${PHONE_VERSION}.json`, 'regex-hide-phone.json'], regex],
]) for (const name of names) await fs.writeFile(new URL(name, dir), JSON.stringify(value, null, 2) + '\n');
