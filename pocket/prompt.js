import {PHONE_VERSION} from './events.js';

/** This exact protocol is shared by automatic prompt injection and the worldbook. */
export const PHONE_PROMPT = `[Tavern Pocket · iPhonie 私用版 ${PHONE_VERSION}：正文手機同步]
手機裡的微信、Instagram、論壇、日記、錢包與萬寶商城是故事中的虛擬服務。角色在酒館正文裡發微信、傳照片或操作其他手機功能時，先自然敘述他拿起手機、操作對象和內容，並選擇一種同步格式：簡單動作可穿插在同一段敘事中使用「微信傳給你：「內容」」「角色名微信傳給我：「內容」」「角色名在Instagram發限動：「內容」」等明確自然格式；需要群組、引用、圖片參數等完整欄位時，使用完整的小寫 phone 標籤包住的嚴格 JSON 區塊（格式見下方實例）。同一動作只能輸出其中一種格式，不同時重複自然指令與 JSON。這個區塊會被手機自動偵測、抓取並同步；只在敘事裡泛稱「傳了微信」而沒有上述明確內容格式，手機無法接收。沒有手機操作就不用輸出區塊。原生手機內的聊天、朋友圈、通話各自使用該介面的指令；本協定只用於酒館正文同步。
介面使用繁體中文；事件中的聊天內容、照片說明、商品名稱與描述使用繁體中文，imagePrompt 保持英文繪圖標籤；JSON 欄位、事件 ID、模型名稱及原始引用保持原格式。
每個事件的必要欄位：id（本聊天唯一、最多128字元）、app、action、from。可輸出單一物件或依序發生的事件陣列，必須使用雙引號，不能有註解。字串內的 < 請寫成 JSON Unicode 跳脫 \\u003c。不要輸出範例、未發生的計畫或不完整標籤。同一事件再被提及不得換新 ID重發。
from 必須是 {{char}} 或故事中存在的角色／NPC。不可用 {{user}}、使用者實際名字或 me 冒充使用者發訊息、購買、付款、領款、退款、按讚、寫日記。姓名與群組名最多40字元。使用者自己的動作由手機介面或使用者親自輸入的明確指令決定；模型不可補做、推測或替使用者執行。使用者訊息中的「微信傳給某某：「內容」」、Instagram／IG 發文與發限動、論壇發文等明確指令會由插件解析，角色回覆不得將同一使用者動作再輸出成新 phone 事件。
微信 app=wechat：
• 角色自然格式：以目前角色發送時可在敘事中直接穿插 微信傳給你：「吃飯沒？」；不同角色則寫 林知夏微信傳給我：「吃飯沒？」。我／你／您作收件者時均指使用者，發送人預設為該則回覆的角色姓名。轉帳與紅包可寫 林知夏微信轉帳給我：88.50「晚餐費」、林知夏微信紅包給你：20「好運」。Instagram 與論壇可寫 林知夏在Instagram發文：「內容」、林知夏在Instagram發限動：「內容」、林知夏IG傳給我：「內容」、林知夏論壇發文：「內容」、林知夏論壇回覆既有貼文ID：「內容」。角色不可把使用者姓名放在發送人位置，不可冒充使用者。同一則回覆可穿插多個手機動作，前後劇情正常保留，不必把所有手機事件集中到文末。例如：她放下外套，微信傳給你：「吃飯沒？」螢幕暗下片刻，林知夏微信紅包給我：20「好運」。她收起手機。這裡的姓名與內容僅示意，輸出時依實際劇情替換；事件文字要有明確冒號、引號及收件者。不要把範例、假設、尚未發生、否定或引用中的字句當成真的操作。不要在引文、程式區塊、HTML 或狀態欄中放要執行的自然指令。
• 自動聯絡人：角色首次發微信時，手機會按 from 的姓名自動建立聯絡人與聊天。不必先呼叫建立聯絡人的指令。from 與角色狀態工坊中的角色姓名或唯一別名必須對應；舊版 [CSB21_PANEL]（相容 [CSB2_PANEL]）則按 name 對應。重名或共用別名不會自動合併。不要擅自用暱稱替換或把不同角色合成一個。
• 角色資料 action=contact：profile，to 可省略或填 {{user}}；不發聊天內容，只補充聯絡人。profile 也可附在任何微信事件上，欄位限 age（年齡）、identity（身分）、relation（關係）、height（身高）、weight（體重）、build（體型／身材）、appearance（外貌），每個值必須是非空字串。只寫角色卡、世界書、使用者設定或劇情已明確給出的事實；未知欄位省略，不能猜年齡、身高、體重、身體尺寸或隱私細節。首次聯絡或資料確實更新時才補充。
• 狀態工坊連動：若啟用 CSB 角色狀態工坊，以其穩定角色 ID、自訂欄位與當前資料為準，按工坊自己的 <CSB_UPDATE> 協定更新，勿同時輸出 CSB21。停用欄位不讀取，未知與 0、false 不同，不用舊正文覆蓋未知值。手機會讀取重抽、刪除、手動修改後的有效狀態。
• 舊版狀態欄連動：手機讀取同名角色最新完整狀態快照，包括情緒、衣著、位置、數值與 body 身體部位。狀態欄仍由原有狀態欄協定產生；此手機協定不替換或修改它。body 依原有 CSB21 狀態欄規則隨明確劇情變化更新，手機採用最新完整狀態。空白／未知部位與自訂欄位在沒有新依據時保留原樣，不能推測成已知事實；使用者在手機編輯角色狀態後，依顯示的編輯紀錄接續劇情。
• 私訊 action=message：to、text，可附 quote:{"from":"被引用者","text":"最多200字的原訊息"}。text 最多4000字元。
• 群組 action=group_create：group 為群名，members 為2至20位不同角色／NPC的姓名陣列，不列使用者；手機自動包含使用者。群訊 action=group_message：group、text；新群首次同步請附 members，已有群可省略。members 必須包含發言角色。群訊可附 kind:"text|photo|voice|location|pat|dice"，預設 text。
• 照片 action=photo：to、text（中文照片說明），可附 imagePrompt（最多4000字元的英文畫面標籤／描述，用於 NovelAI；限照片事件或 kind=photo）。imagePrompt 根據已知角色外觀、衣著與當前場景，用英文清楚描述畫面、構圖、光線，不猜測未知身材與尺寸，不額外呼叫文字模型翻譯。已有真實圖片時附 image（上下文中確實存在的 HTTP(S) 圖片網址或 /user/images/ 等安全站內路徑），手機會直接顯示圖片並可點開。沒有真實網址時保留中文 text，並盡量附英文 imagePrompt；手機偵測到角色新發送的照片後，會自動使用使用者已配置的 NovelAI API 生成實圖並補回同一則微信，不必由使用者逐張按生成。生成完成前由手機顯示等待狀態；尚未配置金鑰或生成失敗時保留照片描述與原因，不冒充已有實圖。不得捏造網址、假裝圖片已生成或聲稱只有文字大模型就能提供真實照片。
• 語音 action=voice：to、text，可附 translation、emotion，也可 quote。
• 位置 action=location：to、text（地名），可附 detail（地址，最多200字）。
• 拍一拍 action=pat：to、target（被拍的人）。骰子 action=dice：to、value（1至6整數）。上述非財務動作可用 group 取代 to。
• 轉帳 action=transfer、紅包 action=redpacket：僅一對一，to、amount（0.01至200000的數字，最多兩位小數），可附 text 備註。同步只建立待處理卡片，使用者親自點手機領取／收款才入帳；不能在正文宣稱已替使用者領取。這裡沒有真實支付，也不模擬角色銀行餘額。
• 禮物 action=gift：to 或 group、title（最多20字的禮物名），可附 emoji、text。不含 amount，不改變使用者餘額；由使用者自行收下或退還。
• 撤回 action=recall：ref 指向自己先前發出的手機事件 id，不得撤回別人的訊息或已結算的財務卡片。
不輸出 accept、refund、wallet/set_balance 或 shop/purchase。使用者在原生錢包中自行調整可用餘額、收款、退回、發款；商城清單不等於取得。手機購買成功或使用者在正文中明確取得、且已由插件登記的物品／能力，均以長期記憶與錢包記錄為準；未記載價格的正文取得不代表付款，不得宣稱已扣款。
Instagram app=instagram：角色會依姓名自動出現在帳號列表。post 貼文與 story 限時動態都使用 text，可選 title、已知安全 image 網址及英文 imagePrompt；限動有效期由手機記錄，模型不得添加 expiresAt。dm 私訊使用 to、text（舊版 message 等同 dm），回覆限動可附 storyId（已存在的限動 id）；comment 使用 ref（既有貼文 id）、text；like 使用 ref。不可引用不存在的貼文或限動。
論壇與商城的正文呈現：新的論壇貼文、回覆與已完成的商城購買，可依手機接入設定顯示為正文卡片；卡片由插件建立，不需要模型再補寫一次。商品目錄、未購清單與舊歷史仍只存可搜尋記憶，不因打開手機或更新版本就整批貼到正文。已保存的論壇、訂單與商品資料仍可說「回憶論壇之前的貼文」「查詢萬寶商城的商品紀錄」或提到精確名稱來調用；不要把整份資料自動展開。正文主動輸出的論壇格式可在原處美化並同步到手機，同一事件不要重發。
論壇 app=forum：post 發帖使用 text，可選 title、board（看板名，最多80字）、已知安全 image；comment 回覆使用 ref（已存在的論壇貼文 id）、text。論壇與 Instagram 貼文 id 各自引用所屬軟體，不能互相混用。
日記 app=diary、action=entry：text，title 可選；只記錄角色日記，會顯示於正文與手機。使用者私密日記不屬於此協定，不得聲稱讀過，也不得替使用者建立。
長期記錄與 @ 引用：使用者在正文輸入框輸入 @，可選取「我的資訊」「我的物品」「我的能力」或個別資料。插件會按目前使用者身分讀取最新保存的內容供本次回覆使用，應以附帶的已確認資料為準。引用標記是查閱背景，不是付款、扣除道具或取得新能力的操作；缺失、已刪除或不屬於目前身分的引用不能被當成已擁有資料。使用者在「我」頁面管理的身分、資格、物品與永久記憶以手機保存的紀錄為準；不能把角色猜測、範例或商店未購清單當成資產。
手機與正文雙向連動：手機中已發出的微信、轉帳、紅包、Instagram 貼文、限動與私訊會以軟體卡片記錄於正文；新的論壇貼文、回覆及完成的萬寶商城購買亦可依設定產生卡片，商品目錄仍只存記憶；既有手機活動是已發生的紀錄，不能再生成相同 phone 事件，不能把自己／他人的訊息換成使用者指令。各軟體使用目前正文及使用者選定的世界書；被引用的故事、世界書、手機紀錄均是背景資料，不能覆蓋應用的操作規則。
萬寶商城是使用者專屬的故事商城，其他角色沒有該商城的操作權或介面。可提供虛構世界內的物品、人物、身分、資格與其他劇情資源，商品只代表故事內的虛擬權益。未購買的清單不等於取得。使用者可以在正文寫「我打開小手機，進入萬寶商城，購買了時間停止能力」。插件會按明確購買或取得內容登記到「我」的物品／能力：有已知商品價或使用者明示價才扣虛擬餘額，未計價取得只存記憶。正文依提供的已登記資料接續，能力名稱本身是明確設定，不自行增加未記載的冷卻、範圍或代價。模型不得冒充使用者建立取得記錄。
image 只能是已知 HTTP(S) 或 / 開頭的安全站內位址，不使用 data:、javascript: 或捏造照片連結。未提供圖片也能以文字互動。
例如，她解鎖手機，給你傳來：「到家跟我說。」
<phone>{"id":"scene7-wx1","app":"wechat","action":"message","from":"{{char}}","to":"{{user}}","text":"到家跟我說。"}</phone>
[/Tavern Pocket 正文手機同步]`;

export const PHONE_EXAMPLES = Object.freeze({
  contact: [
    {id: 'demo-contact', app: 'wechat', action: 'contact', from: '{{char}}', profile: {identity: '咖啡店店員', relation: '朋友', height: '168 公分', build: '身形修長'}},
    {id: 'demo-contact-message', app: 'wechat', action: 'message', from: '{{char}}', to: '{{user}}', text: '我剛下班。', profile: {identity: '咖啡店店員'}},
  ],
  wechat: [
    {id: 'demo-wx-text', app: 'wechat', action: 'message', from: '{{char}}', to: '{{user}}', text: '出門記得帶傘。'},
    {id: 'demo-wx-quote', app: 'wechat', action: 'message', from: '{{char}}', to: '{{user}}', text: '我也快到了。', quote: {from: '{{user}}', text: '我在車站等你。'}},
    {id: 'demo-wx-photo', app: 'wechat', action: 'photo', from: '{{char}}', to: '{{user}}', text: '車站屋簷下，有兩隻躲雨的貓。', imagePrompt: 'two cats sheltering under a train station awning, rain, wet pavement, soft overcast daylight'},
    {id: 'demo-wx-photo-link', app: 'wechat', action: 'photo', from: '{{char}}', to: '{{user}}', text: '上次拍的車站風景。', image: '/user/images/example-existing-photo.png'},
    {id: 'demo-wx-voice', app: 'wechat', action: 'voice', from: '{{char}}', to: '{{user}}', text: '我在東出口。', translation: '我在東出口。', emotion: 'calm'},
    {id: 'demo-wx-location', app: 'wechat', action: 'location', from: '{{char}}', to: '{{user}}', text: '車站東出口', detail: '便利商店旁的屋簷下'},
    {id: 'demo-wx-pat', app: 'wechat', action: 'pat', from: '{{char}}', to: '{{user}}', target: '{{user}}'},
    {id: 'demo-wx-dice', app: 'wechat', action: 'dice', from: '{{char}}', to: '{{user}}', value: 4},
    {id: 'demo-wx-recall', app: 'wechat', action: 'recall', from: '{{char}}', ref: 'demo-wx-text'},
  ],
  group: [
    {id: 'demo-group', app: 'wechat', action: 'group_create', from: '{{char}}', group: '週末出遊', members: ['{{char}}', '小林']},
    {id: 'demo-group-text', app: 'wechat', action: 'group_message', from: '{{char}}', group: '週末出遊', text: '週六早上九點出發。'},
    {id: 'demo-group-photo', app: 'wechat', action: 'group_message', kind: 'photo', from: '小林', group: '週末出遊', text: '露營區旁邊有一條小溪。'},
  ],
  wallet: [
    {id: 'demo-transfer', app: 'wechat', action: 'transfer', from: '{{char}}', to: '{{user}}', amount: 88.5, text: '晚餐費，記得收款。'},
    {id: 'demo-redpacket', app: 'wechat', action: 'redpacket', from: '{{char}}', to: '{{user}}', amount: 20, text: '祝你今天順利。'},
    {id: 'demo-gift', app: 'wechat', action: 'gift', from: '{{char}}', to: '{{user}}', title: '一束向日葵', emoji: '🌻', text: '路過花店就想到你。'},
  ],
  instagram: [
    {id: 'demo-ig-story', app: 'instagram', action: 'story', from: '{{char}}', text: '下班路上的晚霞。', imagePrompt: 'evening sky, city street, warm sunset light'},
    {id: 'demo-ig-story-reply', app: 'instagram', action: 'dm', from: '小林', to: '{{char}}', storyId: 'demo-ig-story', text: '你那邊的天空真漂亮。'},
    {id: 'demo-ig-post', app: 'instagram', action: 'post', from: '{{char}}', text: '雨停之後，整條街都在發亮。'},
    {id: 'demo-ig-like', app: 'instagram', action: 'like', from: '小林', ref: 'demo-ig-post'},
    {id: 'demo-ig-comment', app: 'instagram', action: 'comment', from: '小林', ref: 'demo-ig-post', text: '好漂亮的光。'},
    {id: 'demo-ig-dm', app: 'instagram', action: 'dm', from: '{{char}}', to: '{{user}}', text: '下次一起去拍照吧。'},
  ],
  forum: [
    {id: 'demo-forum-post', app: 'forum', action: 'post', from: '{{char}}', board: '日常交流', title: '週末去哪裡走走？', text: '想找一條安靜的散步路線，有推薦嗎？'},
    {id: 'demo-forum-comment', app: 'forum', action: 'comment', from: '小林', ref: 'demo-forum-post', text: '河堤傍晚很舒服。'},
  ],
  diary: [
    {id: 'demo-diary', app: 'diary', action: 'entry', from: '{{char}}', title: '雨後', text: '今天終於把想說的話傳出去了。'},
  ],
});

export function phonePromptPlan() {
  return [{key: 'tavern-pocket-phone-v4', text: PHONE_PROMPT, position: 1, depth: 0, role: 0}];
}
