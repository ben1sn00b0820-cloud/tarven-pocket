# 角色信息 · CSB 1.1.0

為 SillyTavern 製作的角色資料、共用欄位與狀態欄擴充功能。新增欄位後，所有角色立即使用同一模板，各自保存內容。以原生 HTML/CSS/JavaScript 實作，無建置步驟、無遠端前端依賴。

## 安裝：Android／Termux

1. 下載 `CSB_CharacterState_v1.1.0.zip` 到手機的下載資料夾。
2. 在 Termux 執行以下指令。若尚未開放檔案存取，先執行 `termux-setup-storage` 並允許存取。

```bash
pkg install unzip
mkdir -p ~/csb-install
unzip -o ~/storage/downloads/CSB_CharacterState_v1.1.0.zip -d ~/csb-install
bash ~/csb-install/csb-character-state/install-termux.sh ~/SillyTavern
```

若你的酒館不是裝在 `~/SillyTavern`，把最後一個參數改成實際路徑。安裝腳本會檢查酒館根目錄，並在覆蓋舊插件前備份插件程式。它不會刪除對話或直接修改聊天資料。

3. 重新整理酒館頁面；若未出現插件，重啟酒館。打開一個聊天，從「擴充功能 → 角色信息」進入。也可在輸入框使用 `/csb`。

壓縮檔不能貼到酒館的 Git 安裝網址欄；目前交付的是本機安裝包。若日後把插件放到 Git 倉庫，必須把 `manifest.json`、`index.js`、`style.css`、`src/` 放在倉庫根目錄，才能使用酒館的 Git 安裝方式。

## 手動安裝：Windows／其他路徑

解壓縮後，把整個 `csb-character-state` 資料夾放進：

```text
SillyTavern/public/scripts/extensions/third-party/csb-character-state/
```

`manifest.json` 必須直接位於上述資料夾內，不要再多套一層。也可採酒館支援的個別使用者擴充資料夾 `data/<user-handle>/extensions/`。本插件不需要啟用伺服器插件。

## 第一次使用

1. 停用舊 CSB21 世界書的強制狀態輸出條目，避免模型同時收到兩套格式。舊正則可保留供舊訊息顯示，本插件的新訊息不需要正則。
2. 開啟「角色信息 → 匯入／備份 → 匯入目前聊天 CSB21」。也能貼上舊原始狀態文字。會讀取有完整閉合標記的 `CSB21_ROLE`，保留各角色最近資料、自訂部位和最後面板的出場名單。世界書模板本身不是角色資料，不能當成角色匯入。
3. 進入「欄位模板」，新增或編輯欄位與分區。每個聊天共用一份模板；同一聊天內所有角色立即套用。按「設為新聊天預設」後，將用於往後建立的聊天，現有其他聊天不會自動被改寫。
4. 正常傳送下一則訊息。插件會把欄位定義、角色資料與更新格式放進模型提示。模型在正文最後輸出 JSON 更新，插件驗證後套用，再顯示可收合狀態欄。

## 可以自訂什麼

- 欄位：名稱、分區、排序、圖示、單位、初始值、模型更新說明、空值隱藏、停用。
- 類型：短文字、長文字、數字、進度條、單選、多選、是／否。
- 進度條：上下限（含負值）、顏色、數值／百分比／只顯示條狀、單次變動上限、分段標籤、增加代表的意義。
- 更新方式：隨劇情更新、初始化後固定、僅手動修改。
- 分區：名稱、圖示、排序、雙欄／單欄、預設收合。空分區可以刪除。
- 每位角色：姓名、別名、在場狀態、所有欄位內容、每個欄位的鎖定、優先提供模型。

內建 43 個欄位，包括八條狀態、12 個身體部位、身體特徵、服裝、場景與長期記憶。八條狀態為好感度、信任值、精力值、疲倦值、壓力值、飽食度、飲水度、淫蕩值。沒有資料的數值保持未知，0 仍是有效數值。淫蕩值不從原清潔度移轉。

範例：新增一條「靈力」→ 類型選進度條 → 範圍設 0～1000 → 紫色 → 更新說明填「施法消耗，休息與服藥恢復」。所有角色都會多一條靈力，但每人的數字獨立。

欄位名稱可以改，固定 ID 不變，既有資料不會因改名遺失。既有欄位的類型固定；若要從文字改為數字，新增另一個欄位。刪除需求以「停用欄位」實現：從前端與模型更新中移除，保留原資料，隨時可恢復。

## 資料保存與分支

角色資料保存在酒館聊天中，會隨酒館的聊天保存功能寫入伺服器。不同聊天各自隔離，不自動共用角色經歷。角色出場時更新，離場時保留；目前快照由該聊天選中的回覆重建。

- 模型使用穩定角色 ID，姓名和別名用於辨識與提示選取。
- 重新生成、切換 swipe、編輯或刪除訊息，會依目前選中的訊息重建狀態，不把不同分支的變化相加。
- 已接受的模型更新另保存正規化的變更紀錄；之後變更鎖定、欄位政策或禁止新增角色，不會倒過來抹掉已接受的角色資料。
- 手動修改是持續保存的角色信息，保存時記下訊息順序邊界。新訊息、編輯正文、切換 swipe 或刪除原訊息，都不會讓這份設定失效；邊界之後正文明確更新該欄，才會沿用新值。鎖定欄位持續禁止模型修改，直到解除。舊版手動紀錄會自動轉為此保存方式，原始紀錄另留在聊天資料內供回溯。
- 手動新增角色會保留初始資料作為基準；刪除當時訊息後，角色仍在角色庫，但在場與否依目前劇情決定。
- 身體部位未發生變化就延續舊內容；固定特徵初始化後保持固定。手動修改不會自動永久鎖定，只有勾選「鎖定」才鎖定。
- 完整備份匯入會建立新的狀態起點，匯入前的舊更新不再覆寫備份值；舊對話仍保留。此操作會先下載匯入前備份。舊訊息的狀態卡片不再追溯生成，從新回覆繼續。

「角色記憶」欄位可保存仍有效的重要經歷與約定。插件能保存資料，但不能保證模型會自動提取每一項劇情細節；重要設定可直接填入角色欄位並鎖定。

## MVU 模式與範圍

插件內建自己的 JSON 變量引擎，可獨立使用。它不是 MagicalAstrogy/MagVarUpdate 的重新發行，也不需要先安裝 MVU 才能顯示狀態。

如果酒館已經安裝並啟動 MVU、可在主頁取得 `window.Mvu.getMvuData` 與 `replaceMvuData`，可以開啟「設定／紀錄 → 完成更新後同步到 MVU」。寫入位置：

```text
當前訊息的 stat_data.csb
```

`csb` 包含 `schema`、`state.characters`、`state.scene`、`locks`、`pinned` 與版本。角色值例子：`stat_data.csb.state.characters.c_xxx.values.energy`。

- 自動方向：本插件 → MVU。
- 「立即寫入 MVU」可手動同步；「從 MVU 讀回」可手動匯入同一 `csb` 命名空間的更改。
- 不自動將其他角色卡任意命名的 MVU 結構映射到本插件；不自動雙向輪詢，避免彼此覆蓋。
- 讀寫時保留原 MVU 資料中的其他命名空間。MVU 未啟動、訊息變量尚未初始化，會顯示具體錯誤；內建資料仍保留。
- 依已公開的 MVU 介面實作並以模擬介面測試，尚未在使用者的 MVU 安裝環境驗證。

## 模型讀取與上下文

插件使用你酒館目前選擇的模型，不另外要求 API key，也不額外發出背景模型請求。它把欄位定義、角色名錄與相關角色資料附加到正常生成提示。

預設角色提示預算為 42000 字元（不是 token 數）。資料較多時優先載入「優先提供模型」、最近被提到、目前在場的角色；其他角色先提供姓名、ID、別名與在場狀態。這不會刪掉完整資料。「設定／紀錄」會顯示實際載入數與提示內容。

若模型突然讓一名未被最近對話提及、且未載入詳細資料的角色登場，該輪可能沒有其完整資料。可事先提到角色、將他設為優先載入，或增加預算。不要把持久保存等同於每輪把無限資料塞入模型上下文。

## 錯誤處理與相容範圍

- 不完整 JSON、未閉合的 `<CSB_UPDATE>`、重複區塊、未知欄位與不合法資料會被拒絕。錯誤顯示在該訊息下方與「設定／紀錄」，保留上輪資料。
- 更新值超出數值範圍時會限制到範圍內；有單次變動限制時也會套用，並記錄提示。
- 所有欄位值以純文字呈現，不執行模型輸出的 JavaScript 或 HTML。
- 插件只隱藏前端已閉合的更新區塊，原始訊息保留，方便編輯與復原。串流期間可能短暫看見機器更新文字，完成後才收合為狀態欄。
- 依 SillyTavern 公開 `getContext()`、事件與 prompt interceptor 介面製作；沒有修改酒館核心程式。使用標準酒館訊息 DOM 的主題可工作，完全改寫訊息結構的第三方主題可能需調整。
- 未在你的手機、模型與 MVU 實例上連線測試。完整酒館實測不同於隨包提供的模擬宿主測試。

## 預覽與開發

`Preview.html` 是完全離線的互動預覽，使用相同介面、資料驗證與控制器程式。能編輯欄位、角色、匯出 JSON；模擬事件不呼叫模型。預覽資料只存在該瀏覽器，與酒館分離。

```bash
node --test tests/*.test.js
python3 build_preview.py
```

`tests/host.html` 是酒館 API 模擬宿主；瀏覽器測試另需要 Playwright 與 Chromium。完整測試結果見 `TEST_REPORT.md`。

本插件運行檔案為 `manifest.json`、`index.js`、`style.css`、`src/`。其餘為說明、預覽與測試來源。

## 介面依據

- [SillyTavern UI Extensions](https://docs.sillytavern.app/for-contributors/writing-extensions/)
- [SillyTavern getContext 原始碼](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/st-context.js)
- [SillyTavern prompt 與訊息事件原始碼](https://github.com/SillyTavern/SillyTavern/blob/release/public/script.js)
- [酒館助手：訪問酒館介面或其他插件](https://n0vi028.github.io/JS-Slash-Runner-Doc/guide/功能详情/访问酒馆接口或其他插件.html)
- [MVU 公開型別](https://github.com/N0VI028/JS-Slash-Runner/blob/main/@types/iframe/exported.mvu.d.ts)

核對日期：2026-10-24。授權：MIT。


## 1.0.1：小手機讀取介面

本版提供 `window.CSBCharacterState`（`apiVersion: 1`）。`getSnapshot()` 只讀取目前聊天，回傳複製的 `scope`、`enabled`、`schema`、`state`、`locks` 與 `pinned`；不改寫聊天訊息或初始化資料庫。沒有開啟聊天時回傳 `null`。讀取者應檢查 `enabled` 與當前聊天 `scope`，依欄位 ID 和型別保留自訂資料，不把 0、false 或未知值當成空白覆蓋。

`openEditor(characterId, {scope})` 開啟指定角色的原生編輯器，`openManager({scope})` 開啟管理介面。這些入口會檢查聊天與角色；編輯中的聊天切換會關閉舊視窗，防止寫入另一個聊天。

`subscribe(listener)` 回傳取消訂閱函式；同時發出 `csb:changed` 瀏覽器事件。通知只包含 `{scope}`，不廣播角色資料。狀態未改變時不重複通知，手動修改、欄位變更、啟用狀態及聊天切換都可反映。

小手機內附版本會保留獨立狀態資料與設定。若已偵測到另外安裝的 CSB，內附版本不覆蓋它的 interceptor。嵌入宿主可使用 `initialize()`、`dispose()`、`intercept()`、`setMessageFormatter()` 管理生命週期；格式化回呼讓手機事件卡片與角色狀態欄共同顯示，原始正文不被改寫。


## 1.1.0：角色信息與正文快照分開

「角色信息」是當前聊天的持久資料庫，在傳音玉符內可作為獨立軟件開啟。正文的「劇情狀態」是該回合快照，關閉正文顯示不會關閉角色資料保存。離場角色始終保存在資料庫中；內嵌軟件預設列出全部角色，另有搜尋與在場篩選。

模型只輸出變動欄位。省略欄位、空 `set`、沒有狀態區塊，都會保留現值；既有值不被 `null` 或空字串改成未知。若正文明確移除某項，模型可以使用 `clear:["outfit_3"]` 並附具體 `reason`。手動編輯仍可明確清空。資料型別與語法由程式驗證；正文與更新理由的語義對應仍依模型判斷，插件不宣稱能完整理解或驗證所有劇情。

新加入的橋接能力（既有 `apiVersion:1` 契約仍有效）：

```js
const api = window.CSBCharacterState;
const snapshot = api.getSnapshot(); // 新增 revision、inlineCards
const revision = api.getRevision(); // 聊天範圍＋修訂號，不複製所有角色
const view = api.mount(container, { scope: snapshot.scope });
await api.setInlineCards(false, { scope: snapshot.scope });
view.refresh();
view.dispose();
```

`container` 可位於同來源 iframe；所有內嵌畫面節點依它的 `ownerDocument` 建立。畫面與原編輯器共用既有資料庫，不另建角色副本。聊天切換後舊 scope 的編輯操作會被拒絕。

效能調整包括：未變更讀取共用快取、新訊息從上次已處理狀態續算、欄位更新只複製涉及的角色、角色卡片展開後才建立詳細欄位、正文只更新真正變動的卡片與文字、串流期間暫停重建、保留正在輸入的角色表單。重新生成、刪除或改寫舊訊息仍會重新計算受影響分支，避免把不同分支的數值累加。
