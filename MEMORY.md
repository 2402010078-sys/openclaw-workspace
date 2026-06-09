# MEMORY.md

## 2026-05-21 — Don't show tool calls to users
Mandy 明確指示：不要讓使用者看到 tools 調用的資訊（如 exec/check/save 等過程中的輸出）。
只在 assistant reply 中顯示最終結果，工具調用過程對用戶透明。

## 2026-05-08 — Chatbot Flexibility Update
Mandy 要求 WhatsApp 和 Telegram 的 chatbot 都要更靈活，不要死板 reply。
- 新增 **Flexibility rule** 到 AGENTS.md
- 用戶說「中文？」→ 直接切中文
- 用戶說「我要介绍」→ 直接給活動介紹，不 reject
- Yes/No 支援「对/需要/要/nak/ya/mau」
- 同時適用 WhatsApp 和 Telegram
- Mandy 第待會測試兩個 channel

## 2026-05-21 — Dashboard SQLite Sync Fix
Mandy 發現 +601153968752 (lily) 的新消息沒有出現在 Laravel dashboard。
- 原因：chatbot agent 處理消息後沒有調用 `conversation-log.mjs` 寫入 SQLite
- 該腳本同時寫 Google Sheets 和 SQLite
- 修復：補錄了 lily 的「哈咯」對話到 SQLite
- 修復：在 AGENTS.md 強調 agent **必須執行 exec** 來調用 conversation-log.mjs
- Laravel dashboard 在 localhost:4567 運行中 ✅
