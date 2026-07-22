# 雷巴咖啡 高捷福委團購下單網頁 — 部署說明

## 架構總覽

```
使用者瀏覽器 (GitHub Pages: index.html/app.js)
        │  POST JSON (action=createOrder)
        ▼
Google Apps Script Web App（Code.gs）── 寫入「待付款」列到 Google Sheet
        │  計算綠界 CheckMacValue，回傳導轉參數
        ▼
使用者瀏覽器整頁導向綠界 AioCheckOut 付款頁 → 刷卡
        │
        ├─ 綠界背景 POST 回 Apps Script（ReturnURL）→ 驗證簽章 → 更新 Sheet 為「已付款」→ 寄 Email
        └─ 綠界導覽器回 ClientBackURL（GitHub Pages 上的 thankyou.html）
```

密鑰（MerchantID / HashKey / HashIV）只存在 Apps Script 的「指令碼屬性」，不會出現在 GitHub Pages 上的任何檔案。

## 步驟一：部署 Google Apps Script

1. 打開 [Google Sheets](https://docs.google.com/spreadsheets/d/1hWv8p58gNSkiHAkiEYm-AZeTFd2z0a6aMRrlA-Q25oo)（本專案指定的 SHEET_ID）
2. 擴充功能 → Apps Script，把 `apps-script/Code.gs` 的內容整份貼上（取代原本的程式碼）
3. 左側「專案設定」→「指令碼屬性」，新增以下 5 筆：

   | 屬性名稱 | 值 | 說明 |
   |---|---|---|
   | `ECPAY_MERCHANT_ID` | 你的綠界特店代號 | 測試可先用 `2000132` |
   | `ECPAY_HASH_KEY` | 你的綠界 HashKey | 特店後台或測試文件提供 |
   | `ECPAY_HASH_IV` | 你的綠界 HashIV | 特店後台或測試文件提供 |
   | `ECPAY_ENV` | `stage` 或 `production` | 測試環境用 `stage`，正式上線切 `production` |
   | `CLIENT_BACK_URL` | 你的 `thankyou.html` 完整網址 | 例：`https://yourname.github.io/reba-coffee/thankyou.html` |

4. 「部署」→「新增部署作業」→ 類型選「網頁應用程式」：
   - 執行身分：**我**
   - 誰可以存取：**任何人**
5. 部署後會拿到一個 `https://script.google.com/macros/s/xxxx/exec` 網址，**先記下來**（下一步要用，也要填到綠界後台）

> 之後若修改 `Code.gs`，記得「管理部署作業」→ 針對同一個部署按「編輯」→ 新增版本，否則網址上跑的還是舊程式碼。

## 步驟二：設定前端

1. 打開 `app.js`，把最上面的：
   ```js
   const APPS_SCRIPT_URL = "https://script.google.com/macros/s/PUT_YOUR_DEPLOYMENT_ID_HERE/exec";
   ```
   換成步驟一拿到的 `.../exec` 網址

## 步驟三：綠界特店後台設定

登入綠界會員中心，找到這組特店的 API 串接設定，把：
- **ReturnURL**（付款結果背景通知）填 Apps Script 的 `.../exec` 網址（跟 app.js 用同一個）
- 若後台要求填 ClientBackURL，填你的 `thankyou.html` 網址（跟 Script Properties 的 `CLIENT_BACK_URL` 一致）

若目前用的是測試特店（2000132），可直接用綠界提供的測試信用卡卡號跑通全流程，確認無誤後再申請正式特店、把 4 個屬性換成正式值、`ECPAY_ENV` 改 `production`。

## 步驟四：部署到 GitHub Pages

這個資料夾目前還不是 git 專案。你可以自行：

```bash
cd /Users/HuaMingHsuan/test
git init
git add index.html style.css app.js thankyou.html README.md
git commit -m "雷巴咖啡高捷福委團購下單頁"
```

然後在 GitHub 建一個新 repo，把本機專案 push 上去，到 repo 的 Settings → Pages 開啟 GitHub Pages（Branch 選 main / root）。

> `apps-script/Code.gs` 是給 Apps Script 編輯器用的，**不需要**也**不應該**放進會發布到 GitHub Pages 的前端資料夾內容裡（它本身不含密鑰，放著也不影響安全性，但邏輯上它是後端程式碼，只需要存在你的 Apps Script 專案裡）。

## 驗收清單

- [ ] 5 個 Script Properties 都已設定
- [ ] Apps Script 部署為「任何人」可存取，並取得 `.../exec` 網址
- [ ] `app.js` 的 `APPS_SCRIPT_URL` 已替換
- [ ] 綠界後台 ReturnURL 已指向同一個 `.../exec` 網址
- [ ] 用測試特店走一次完整流程：填單（滿 100 包）→ 導到綠界測試付款頁 → 刷測試卡號 → 確認 Google Sheet 該筆訂單「付款狀態」自動變成「已付款」，且收到通知信
- [ ] 測試「未滿 100 包」時，送出按鈕維持 disabled、無法送出訂單
