# CSB 與小手機整合

發行：Tavern Pocket 0.10.0 / CSB 1.0.1。手機事件協定仍為 0.9.0。

## 安裝與相容

在 SillyDroid 或 SillyTavern 更新 `ben1sn00b0820-cloud/tarven-pocket`，重新啟動／整理後即可。根目錄是可安裝的小手機擴充；`companions/csb-character-state` 是內含工坊。只有沒偵測到獨立工坊時才啟動內含工坊。獨立工坊停用設定也會被尊重。

舊獨立 CSB 1.0.0 沒有公開介面，手機會複製目前聊天的 CSB 資料，再使用相同狀態引擎重播；不以 seed 或渲染 DOM 冒充最新狀態，也不在讀取時修改原始資料。原版編輯入口回到原插件管理器。

## 公開介面

`globalThis.CSBCharacterState` 的 `apiVersion` 為 1。`getSnapshot()` 回傳分離副本 `{scope, enabled, schema, state, locks, pinned}`；`openEditor(id,{scope})` 與 `openManager({scope})` 開啟原生編輯器；`subscribe(listener)` 回傳取消訂閱。`csb:changed` 事件僅帶 `{scope}`，不廣播完整人物內容。

scope 由群組、角色卡與聊天 ID 組成。手機資料保留 CSB 穩定角色 ID；姓名或別名只有唯一匹配才對應。長姓名不截斷成另一個角色。編輯入口比較最新版 revision；切換聊天或改變來源後必須重新開啟。

手機 `record.csb` 保留可見欄位的原始型別、分區、數值範圍、單位、鎖定與出場狀態。文字模型接收具標籤的事實資料；圖片模型只接收已知可見特徵。提示有上下文預算，超出時附 partial/omittedFields；完整資料仍可在手機查看。

## 驗證與限制

測試包含 CSB journal 重播、聊天隔離、重抽／刪除、手動修改、同名辨識、長姓名、隱藏欄位、0/false/null、任意進度條範圍、XSS 文字、實際 iframe 與 IndexedDB。瀏覽器中的 SillyTavern API 與文字／圖片模型是測試替身；未消耗使用者 API 額度，也未直接操作實體 Android 裝置。具體結果見 VALIDATION-GITHUB-0.10.0.json。
