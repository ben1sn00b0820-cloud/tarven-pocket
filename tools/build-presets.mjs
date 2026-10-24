import fs from 'node:fs/promises';
import {PHONE_PROMPT, PHONE_EXAMPLES} from '../pocket/prompt.js';
import {PHONE_VERSION, encodePhoneEvents} from '../pocket/events.js';
import {SPIRIT_CURRENCY_RULE} from '../core/currency.js';

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
book.entries['6'].content = '萬寶閣是使用者專屬的故事商城，生成清單不代表購買。成功購買或正文中明確完成並由插件登記的取得，寫入「吾身錄」的物品與能力。有已知價格或使用者明示價才記扣款，未計價取得只存記憶。可寫「我進入萬寶閣，以 2 中品靈石購買了回氣丹」。正文收據由插件生成；模型不得輸出 shop/purchase 冒充使用者付款。未購清單與舊紀錄按需要搜尋，不整批貼回正文。\n' + SPIRIT_CURRENCY_RULE;
book.entries['7'] = {...structuredClone(book.entries['1']), uid: 7, displayIndex: 7, order: 107,
  key: ['聯絡人', '联系人', '角色信息', '角色資料', '角色资料', 'CSB_UPDATE', 'CSB21_PANEL', 'CSB2_PANEL'],
  comment: `傳音玉符 v${PHONE_VERSION} 持久角色信息與聯絡人`,
  content: '「角色信息」是持久人物資料。「劇情狀態」是正文中的當回合快照。使用 CSB 穩定角色 ID 與 <CSB_UPDATE> 協定，只更新本回合正文已明確改變的欄位並給理由；未提及的欄位、手動設定、角色離場均保留。禁止每回合整份重建或以 null／空字串清除已知資料。明確移除依 CSB clear 協定；不自行猜值。關閉正文顯示不停止資料保存。勿重複生成 HTML 狀態框或同時輸出 CSB21。舊版 CSB21／CSB2 仍可讀取。千里傳音以角色姓名或唯一別名對應；使用者刪除的聯絡人不因同步自動恢復。以下 profile 只是格式，不能套給其他角色。\n' + examples('contact')};
book.entries['8'] = {...structuredClone(book.entries['1']), uid: 8, displayIndex: 8, order: 108,
  key: ['論道臺', '论道台', '論壇', '论坛', '發帖', '回帖'], comment: `傳音玉符 v${PHONE_VERSION} 論道臺貼文・回覆`,
  content: '論道臺 post 使用 text，可選 title、board；comment 使用既有貼文 ref 與 text。以角色實際姓名輸出，勿冒充使用者。新的貼文與回覆可依玉符接入設定顯示正文卡片，也保存於本對話記憶；舊歷史不整批補發。\n' + examples('forum')};
book.entries['9'] = {...structuredClone(book.entries['1']), uid: 9, displayIndex: 9, order: 109,
  key: ['千里傳音傳給', '微信傳給', '浮光錄發文', 'IG發文', '論道臺發文', '論壇發文', '玉符紀錄'], comment: `傳音玉符 v${PHONE_VERSION} 明確自然指令`,
  content: '正文可穿插「千里傳音傳給雲璃：「稍後議事。」」「浮光錄發文：「今日山色。」」「論道臺發文：「求購回氣丹。」」「千里傳音轉帳給雲璃：2 中品靈石「丹藥費」」。使用者指令只建立待確認付款，確認發送才扣靈石；角色轉帳則為收到的待領卡片。角色可寫「雲璃千里傳音傳給我：「公子，帳目已核對。」」，我／你／您作收件者指使用者。舊微信、Instagram／IG、論壇別名仍可讀。相同事件只選自然格式或 JSON 一種，不重複輸出。假設、否定、引述、程式區塊、HTML、狀態欄與不完整指令不執行。'};
book.entries['10'] = {...structuredClone(book.entries['1']), uid: 10, displayIndex: 10, order: 110,
  key: ['吾身錄', '@我', '@我的資訊', '@我的信息', '@我的物品', '@我的能力', '我的物品', '我的能力'], comment: `傳音玉符 v${PHONE_VERSION} 吾身錄與正文引用`,
  content: '正文輸入 @ 可搜尋目前身分在「吾身錄」的資訊、物品和能力。引用使用最新已存內容；未知、已刪除或其他身分的資料不可補造。引用本身不扣款、不消耗道具，不代表購買或新增能力。'};

// Standalone display fallback only. The runtime validates full syntax and escapes
// rich events; neither renderer performs payments. Stable ID upgrades the old rule.
const regex = JSON.parse(await fs.readFile(new URL('TavernPocket_Regex_v0.3.0.json', dir), 'utf8'));
regex.scriptName = `傳音玉符 v${PHONE_VERSION} — 正文卡片・千里傳音・論道臺・靈石收據`;
regex.findRegex = String.raw`/((?:(?:千里傳音|微信)(?:傳給|传给|轉帳給|轉賬給|转账给|紅包給|红包给)|(?:浮光錄|Instagram|IG)(?:傳給|传给|私訊給|私信给|發文|发文|發帖|发帖|發限動|发限动|限時動態|限时动态)|(?:論道臺|论道台|論壇|论坛)(?:發文|发文|發帖|发帖|回覆|回复|回帖))[^<>&\r\n：「」]{0,128})[：:][ \t]*((?:[¥￥]?[ \t]*[0-9]+(?:\.[0-9]{1,8})?[ \t]*(?:枚|顆|颗)?[ \t]*(?:(?:極品|极品|中品|下品)(?:靈石|灵石)?|靈石|灵石|元)?[ \t]*){0,3})「([^<>&「」\r\n]{1,4000})」/gmi`;
regex.replaceString = '<span class="tp-story-fallback" style="display:block;box-sizing:border-box;margin:12px 0;padding:13px 15px;max-width:430px;border:1px solid #dce6e1;border-radius:17px;background:#f4f8f3;color:#24362d;overflow-wrap:anywhere"><span style="display:block;color:#27865a;font-size:12px;margin-bottom:7px">玉符紀錄 · $1</span><span style="display:block;white-space:pre-wrap">$2$3</span></span>';
regex.placement = [1, 2];
for (const [names, value] of [
  [[`TavernPocket_Worldbook_v${PHONE_VERSION}.json`, 'worldbook-tavern-pocket.json'], book],
  [[`TavernPocket_Regex_v${PHONE_VERSION}.json`, 'regex-hide-phone.json'], regex],
]) for (const name of names) await fs.writeFile(new URL(name, dir), JSON.stringify(value, null, 2) + '\n');
