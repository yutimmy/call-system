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
