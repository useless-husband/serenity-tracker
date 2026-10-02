# Serenity Tracker（Serenity 跟單追蹤）

**English summary.** A local, dependency-free toolkit for following the public X posts of retail investor Serenity ([@aleabitoreddit](https://x.com/aleabitoreddit)): a CLI (`serenity.py`) that searches the tweet archive, extracts `$TICKER` mentions and backtests "what if I had bought when he mentioned it" against Yahoo Finance prices; a poller (`watch.py`) that picks up new public tweets without logging in; and a small local web UI (`app_server.py` + `web/`, port 8795) with Traditional Chinese translations and an optional "ask the AI" panel powered by Claude Code. Not affiliated with Serenity. Not investment advice. Built with the help of Claude.

---

## 這是什麼

追蹤美股散戶 Serenity（X 帳號 [@aleabitoreddit](https://x.com/aleabitoreddit)，以 AI 供應鏈瓶頸選股聞名）公開發文的小工具，給投資初學者看的，介面是繁體中文。

它能做到：

- **查推文**：最近發了什麼、某檔股票（例如 `$AAOI`）他提過幾次、第一次／最後一次是什麼時候、全文搜尋關鍵字。
- **跟單回測**：假設「他提到那天收盤價買進」，放到今天賺賠多少、中間從高點最深跌了多少、和 QQQ 比起來如何。可以指定從哪一則推文之後才買。
- **熱門股票計分表**：最近 30 天他最常提的股票一次全部回測。
- **自動抓新推文**：`watch.py` 不用登入 X，從公開頁拿到新推文就存到 `live/`，可選擇交給 Claude 寫中文快報、用 iMessage 傳到手機。
- **本機網頁介面**：四個分頁（最新推文／查股票／熱門股票／問 AI），推文自動翻成繁體中文，只在 `127.0.0.1:8795` 開放。
- **Mac App 外殼**：`macapp/` 用 Swift 把網頁包成一個「Serenity 追蹤.app」，雙擊就會自動啟動伺服器。

只用 Python 內建模組，不需要 `pip install` 任何東西。

## 怎麼跑

需要 macOS 或 Linux、Python 3.9 以上、`git`、`curl`。

```bash
git clone https://github.com/useless-husband/serenity-tracker.git
cd serenity-tracker

# 1. 第一次先拉推文存檔（會把第三方整理的存檔 clone 到 archive/，約 15MB）
python3 serenity.py update

# 2. 命令列查詢
python3 serenity.py latest 10            # 最近 10 則（預設翻成中文；加 --en 看原文）
python3 serenity.py ticker AAOI 8        # 他提過 $AAOI 幾次、最近 8 則
python3 serenity.py search "InP" 10      # 關鍵字搜尋
python3 serenity.py top 15 --days 30     # 最近 30 天最常提的 15 檔
python3 serenity.py follow AAOI          # 跟單回測
python3 serenity.py follow AAOI --tweet <推文ID>
python3 serenity.py scorecard 12 --days 30

# 3. 網頁介面
python3 app_server.py                    # 然後打開 http://127.0.0.1:8795
```

其他：

- `python3 watch.py` 檢查一次有沒有新推文；`--quiet` 只存檔不通知。要自動分析＋傳 iMessage，在專案資料夾放一個 `config.json`（欄位見 `watch.py` 開頭的 `DEFAULT_CONFIG`）。`config.json` 已列在 `.gitignore`，不會被上傳。
- 中文翻譯和「問 AI」功能需要電腦上裝好並登入 [Claude Code](https://claude.com/claude-code)（`claude` 指令），且「問 AI」會呼叫名為 `serenity` 的 agent（範本見姊妹專案 [serenity-tracker-mini](https://github.com/useless-husband/serenity-tracker-mini)）。沒有 Claude 也能用，只是推文會顯示英文原文、問 AI 不能用。
- `bash macapp/build.sh` 可以在 Mac 上編出「Serenity 追蹤.app」（需要 Xcode 命令列工具）。

## 資料夾說明

| 路徑 | 內容 |
|---|---|
| `serenity.py` | 命令列工具：查推文、代號統計、Yahoo 股價回測、中文翻譯快取 |
| `watch.py` | 定時抓新推文、呼叫 Claude 寫快報、iMessage／通知 |
| `app_server.py` | 本機 HTTP 伺服器（只聽 127.0.0.1），給 `web/` 用的 API |
| `web/` | 網頁介面（原生 HTML/CSS/JS，`vendor/marked.min.js` 用來顯示 Markdown） |
| `macapp/` | Swift 寫的 Mac App 外殼與圖示、`build.sh` 編譯腳本 |
| `live/tweets.json` | `watch.py` 抓到、GitHub 存檔還沒收錄的公開推文 |
| `live/zh.json` | 已翻好的繁體中文推文快取（省得每次重翻） |
| `archive/`（不在 repo 裡） | 執行 `serenity.py update` 後自動 clone 的推文存檔 |

## 資料來源

- **推文存檔**：GitHub 上第三方整理的 [yan-labs/serenity-aleabitoreddit](https://github.com/yan-labs/serenity-aleabitoreddit)（非官方，由 `serenity.py update` 自動下載到 `archive/`，不隨本 repo 散布）。
- **即時推文**：x.com 公開個人頁與 X 官方嵌入推文端點（`cdn.syndication.twimg.com`），不需登入、不使用任何 cookie 或 token；因此只抓得到 X 願意給未登入訪客看的那幾則，回覆與付費訂閱內容抓不到。
- **股價**：Yahoo Finance 公開圖表 API（還原權息收盤價）。非美股代號對應表在 `serenity.py` 的 `YAHOO_MAP`。
- **翻譯／分析**：本機 Claude Code CLI。

## 免責聲明

- 本專案**不是投資建議**。所有報酬、回檔數字都是用公開資料回測的結果，過去績效不代表未來。
- 本專案**與 Serenity 本人無關**，不是官方工具，也沒有取得他的背書。推文版權屬原作者。Serenity 的官方管道只有 X 帳號 @aleabitoreddit；任何以他名義的跟單群組、App、私訊都應視為詐騙警訊。
- 回測挑的是「他最近還在講」的股票，天生偏向贏家（倖存者偏差），工具裡有提醒，但請自行留意。
- 第三方存檔與 Yahoo 資料的正確性由其提供者負責，本專案不做保證。

## 關於開發

這個專案由 [useless-husband](https://github.com/useless-husband) 在 Claude（Anthropic 的 AI 助理，透過 Claude Code）協助下開發。程式碼以 [MIT License](LICENSE) 釋出。
