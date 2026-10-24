# CSB 與傳音玉符整合

發行：傳音玉符 0.11.0 / CSB 角色信息 1.1.0；玉符事件協定 0.11.0。

## 安裝與既有資料

根目錄是可安裝的主擴充，`companions/csb-character-state/` 是內建角色信息模組。沒有獨立 CSB 時由主插件載入；已啟用獨立 CSB 時優先沿用，防止兩個控制器同時寫入同一資料庫。停用設定也會被尊重。

**若另有獨立 CSB，須同步以 1.1.0 更新原來那份擴充。**只更新主插件不會暗中覆蓋另一個擴充。1.0.x 的舊管理器仍可開啟，但它不具備本次持久修正及內嵌 App API；新 App 會顯示明確更新提示。單純停用獨立 CSB 不會繞過其停用設定。

既有資料仍在 `chatMetadata.csb_character_state_v1`。手動日誌自動遷移，原紀錄另存 `legacyManualBackup`；備份格式 `CSB_CHARACTER_STATE`、version 1 保持相容。不要為了升級重新匯入初始備份；這會把目前劇情換回開局。

## 資料與顯示分工

- **角色信息 App**：完整持久人物資料，可搜尋、篩選在場人物、展開詳細欄位及編輯。
- **劇情狀態**：正文 `.mes_text` 內的當回合快照。內文顯示開關不影響保存與模型更新。
- 模型只提交正文已明確變動的欄位。省略、未知 `null`／空字串及離場不清除已知值；明確清空使用 `clear` 並附理由，或由使用者手動編輯。
- 手動修改不再綁定原訊息內容 hash／swipe。更晚的明確劇情更新仍能改變相應欄位；其他欄位保留。
- 模型分支重抽、刪除仍依當前有效分支重算，不把不同分支的事件累加。程式驗證資料結構與清空規則；正文是否真的支持某項更新仍由模型與使用者判斷。

## 公開介面

`globalThis.CSBCharacterState.apiVersion` 仍為 1，原介面保留：

```js
const api = globalThis.CSBCharacterState;
const snapshot = api.getSnapshot();
// {scope, enabled, revision, inlineCards, schema, state, locks, pinned}
const revision = api.getRevision();
const view = api.mount(container, {scope: snapshot.scope});
await api.setInlineCards(false, {scope: snapshot.scope});
view.refresh();
view.dispose();
api.openEditor(characterId, {scope: snapshot.scope});
api.openManager({scope: snapshot.scope});
const unsubscribe = api.subscribe(listener);
```

`mount` 使用容器的 `ownerDocument`，可內嵌到同來源玉符 iframe。角色編輯視窗由原 CSB 建立，保留欄位型別、鎖定及手動日誌。人物詳細 DOM 只在展開後建立。

主插件 bridge 對 iframe 提供 `characterInfoSnapshot()`、`mountCharacterInfo(container, options)` 與 `setCharacterInfoInline(enabled, options)`；三者均檢查目前聊天範圍。容器必須屬於已連線 iframe。傳遞到 `csb:changed` 的只有 scope，沒有完整人物內容。

## 範圍與資料來源

scope 由群組、角色卡及聊天 ID 組成。人物使用穩定 ID，姓名／別名只有唯一匹配才對應。編輯入口檢查 revision 及聊天範圍，避免儲存到已切換的聊天。

聯絡人保留欄位原型別、分區、數值範圍、單位、鎖定與出場狀態。停用欄位不注入模型提示；圖片模型只讀已知可見特徵。提示超出預算時標示 omittedFields，完整資料仍保存在 App。

刪除千里傳音聯絡人只影響聯絡簿／私聊列表，不刪除 CSB 人物。刪除記錄持久保存，舊／新正文同步均不會自動恢復。

## 效能與驗證

資料重播、人物投影與原文解析均有失效條件及大小／範圍約束。相同 revision 重用結果；新事件增量處理。隱藏 App 暫停繪製，重新顯示時合併刷新；資料寫入、交易與模型事件不因繪製合併而省略。

驗證包含手動資料持久保存、編輯中到達新訊息、重抽／刪除、未知值與明確清空、54 人／69 欄既有備份匯入、手機尺寸 iframe／IndexedDB 以及聯絡人防復活。詳見 [0.11.0 驗證紀錄](VALIDATION-0.11.0.md) 與 [CSB 模組測試報告](../companions/csb-character-state/TEST_REPORT.md)。瀏覽器使用測試宿主與模型，沒有在實體 Android 裝置上量測 FPS。
