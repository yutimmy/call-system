# 點名單網頁

依照 `document.md` 建立的前後端分離點名系統。後端使用 Express、Zod、Luxon，資料第一版存放於 JSON 檔案；前端使用原生 HTML/CSS/JavaScript 與 SSE 即時更新。

## 環境準備

```bash
python3 -m venv .venv
source .venv/bin/activate
npm install
npm run dev
```

瀏覽器開啟：

```text
http://localhost:3000
```

預設登入帳密：


登入頁可勾選「記住帳號密碼」，之後同一台裝置會自動帶入並登入。

> `.venv` 依使用者要求作為本專案本機隔離入口；Node 套件依 npm 標準安裝在專案內的 `node_modules`。

## 常用指令

```bash
source .venv/bin/activate
npm run check
npm start
```

## Render 部署

1. 到 Render Dashboard，選 `New` -> `Web Service`。
2. 連接 GitHub repo：`yutimmy/call-system`。
3. Render 會讀取 `render.yaml`，主要設定如下：
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Health Check Path: `/api/health`
   - `HOST=0.0.0.0`
   - `DATA_FILE=/var/data/store.json`
4. 在 Environment Variables 設定：
   - `APP_USERNAME`
   - `APP_PASSWORD`
5. 部署完成後，Render 會提供 `https://...onrender.com` 網址。

資料保存注意事項：Render 預設檔案系統是暫時性的，重新部署或重啟後，執行期間寫入的 JSON 可能消失。若要長期保存新增/刪除/事故紀錄，請在 Render 服務加 Persistent Disk，Mount Path 設為 `/var/data`。

## 匯入名單

可使用 `examples/people.sample.json` 測試匯入。格式如下：

```json
{
  "people": [
    {
      "id": "A001",
      "name": "王小明",
      "category": "一年級",
      "enabled": true
    }
  ]
}
```

## 資料檔

第一版資料放在 `data/store.json`：

- `people`：人員名單
- `incidents`：事故紀錄，含有效、已結束、作廢紀錄
