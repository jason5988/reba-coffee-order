// ============================================================
// 雷巴咖啡 高捷福委團購 - 訂單後端（Google Apps Script）
//
// 部署前必做：「專案設定」→「指令碼屬性」新增下列 key（絕對不要寫在程式碼或前端）：
//   ECPAY_MERCHANT_ID   綠界特店代號（測試特店可用 2000132）
//   ECPAY_HASH_KEY      綠界 HashKey
//   ECPAY_HASH_IV       綠界 HashIV
//   ECPAY_ENV           "stage"（測試）或 "production"（正式）
//   CLIENT_BACK_URL     付款完成後導回的靜態頁網址，例如
//                       https://yourname.github.io/reba-coffee/thankyou.html
//
// 部署方式：「部署」→「新增部署作業」→ 類型選「網頁應用程式」，
//   執行身分：我，誰可以存取：任何人。
//   部署後得到的 .../exec 網址，填入前端 app.js 的 APPS_SCRIPT_URL，
//   同時也要填到綠界特店後台的 ReturnURL 設定。
// ============================================================

const SHEET_ID = "1hWv8p58gNSkiHAkiEYm-AZeTFd2z0a6aMRrlA-Q25oo";
const NOTIFY_EMAIL = "freshroastkan@gmail.com";
const LINE_TOKEN = ""; // 如需 LINE 通知，填 LINE Notify token

const PRICE_PER_PACK = 30;
const MIN_PACKS = 100;
const EMAIL_DOMAIN = "@krtco.com.tw";
const PRODUCT_KEYS = ["2019光耀之心", "2017光榮時刻", "千古尋", "語生花", "禪武定"];

const HEADER_ROW = [
  "時間", "姓名", "部門/分機", "Email", "電話", "寄件地址",
  "2019光耀之心", "2017光榮時刻", "千古尋", "語生花", "禪武定",
  "總包數", "商品小計", "運費", "應付總額",
  "訂單編號", "付款狀態", "備註", "網域", "出貨狀態",
];
const COL = {
  時間: 1, 姓名: 2, 部門分機: 3, Email: 4, 電話: 5, 寄件地址: 6,
  品項起始: 7, // 7~11 為五種風味
  總包數: 12, 商品小計: 13, 運費: 14, 應付總額: 15,
  訂單編號: 16, 付款狀態: 17, 備註: 18, 網域: 19, 出貨狀態: 20,
};

function doPost(e) {
  try {
    // 綠界的付款結果回調是 application/x-www-form-urlencoded，
    // 我們自己前端呼叫是 JSON（text/plain），用這點區分兩種請求來源。
    // 注意：Apps Script 的 e.parameter 自動解析會把 RtnMsg 等欄位裡的中文字弄丟，
    // 所以綠界回調一律改成自己從 e.postData.contents 解析，不用 e.parameter。
    if (e.parameter && e.parameter.CheckMacValue && e.parameter.MerchantTradeNo) {
      const rawBody = e.postData ? e.postData.contents : "";
      const parsedParams = parseFormBody(rawBody);
      return handleEcpayCallback(parsedParams, rawBody);
    }

    const data = JSON.parse(e.postData.contents);
    if (data.action === "createOrder") {
      return handleCreateOrder(data);
    }
    return jsonOutput({ result: "error", message: "unknown action" });
  } catch (err) {
    Logger.log(err);
    return jsonOutput({ result: "error", message: String(err) });
  }
}

function doGet() {
  return ContentService.createTextOutput("OK");
}

// 自己解析 form-urlencoded 原始內容，避免 Apps Script 的 e.parameter 自動解析
// 弄丟中文字（例如 RtnMsg 開頭的「付款失敗」）
function parseFormBody(rawBody) {
  const result = {};
  (rawBody || "").split("&").forEach((pair) => {
    if (!pair) return;
    const idx = pair.indexOf("=");
    const key = idx === -1 ? pair : pair.slice(0, idx);
    let value = idx === -1 ? "" : pair.slice(idx + 1);
    value = value.replace(/\+/g, " ");
    try {
      value = decodeURIComponent(value);
    } catch (e) {
      // 已經是解碼過的內容，或含有無效的 % 序列，維持原樣
    }
    result[key] = value;
  });
  return result;
}

// ------------------------------------------------------------
// 建立訂單：後端重新驗證數量與金額，寫入 Sheet（待付款），組綠界參數
// ------------------------------------------------------------
function handleCreateOrder(data) {
  const products = data.products || {};
  let totalPacks = 0;
  const itemNames = [];
  PRODUCT_KEYS.forEach((key) => {
    const qty = Math.max(0, parseInt(products[key], 10) || 0);
    if (qty > 0) itemNames.push(`${key} x${qty}`);
    totalPacks += qty;
  });

  if (totalPacks < MIN_PACKS) {
    return jsonOutput({
      result: "error",
      message: `未達 ${MIN_PACKS} 包最低出貨門檻（目前 ${totalPacks} 包）`,
    });
  }

  if (!data.name || !data.email || !data.phone || !data.address) {
    return jsonOutput({ result: "error", message: "訂購人資料不完整" });
  }

  const emailLower = String(data.email).toLowerCase();
  if (emailLower.slice(-EMAIL_DOMAIN.length) !== EMAIL_DOMAIN) {
    return jsonOutput({
      result: "error",
      message: `本優惠專案為高捷員工專屬優惠，請輸入公司 email（${EMAIL_DOMAIN}）`,
    });
  }

  const subtotal = totalPacks * PRICE_PER_PACK;
  const shippingFee = 0;
  const finalTotal = subtotal + shippingFee;
  const tradeNo = generateTradeNo();

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheets()[0];
  ensureHeader(sheet);

  const row = [
    new Date(), data.name, data.dept || "", data.email, data.phone, data.address,
  ];
  PRODUCT_KEYS.forEach((key) => row.push(parseInt(products[key], 10) || 0));
  row.push(totalPacks, subtotal, shippingFee, finalTotal, tradeNo, "待付款", data.note || "", data.domain || "", "未出貨");
  sheet.appendRow(row);

  const lastRow = sheet.getLastRow();
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(["未出貨", "出貨中", "已出貨"], true).build();
  sheet.getRange(lastRow, COL.出貨狀態).setDataValidation(rule);

  const props = PropertiesService.getScriptProperties();
  const merchantId = props.getProperty("ECPAY_MERCHANT_ID");
  const hashKey = props.getProperty("ECPAY_HASH_KEY");
  const hashIV = props.getProperty("ECPAY_HASH_IV");
  const env = props.getProperty("ECPAY_ENV") || "stage";
  const clientBackURL = props.getProperty("CLIENT_BACK_URL");

  if (!merchantId || !hashKey || !hashIV || !clientBackURL) {
    return jsonOutput({ result: "error", message: "後端尚未設定綠界金鑰，請聯繫管理員（Script Properties 未完成）" });
  }

  const returnURL = ScriptApp.getService().getUrl();
  const now = new Date();
  const tradeDate = Utilities.formatDate(now, "GMT+8", "yyyy/MM/dd HH:mm:ss");

  const params = {
    MerchantID: merchantId,
    MerchantTradeNo: tradeNo,
    MerchantTradeDate: tradeDate,
    PaymentType: "aio",
    TotalAmount: String(finalTotal),
    TradeDesc: "雷巴咖啡福委團購",
    ItemName: itemNames.join("#"),
    ReturnURL: returnURL,
    ChoosePayment: "Credit", // Apple Pay 會在支援的裝置/瀏覽器上自動顯示於信用卡付款頁，不需額外的 ChoosePayment 值
    ClientBackURL: clientBackURL,
    EncryptType: "1",
  };
  params.CheckMacValue = generateCheckMacValue(params, hashKey, hashIV);

  const actionUrl =
    env === "production"
      ? "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5"
      : "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5";

  return jsonOutput({ result: "success", actionUrl, fields: params });
}

// ------------------------------------------------------------
// 綠界付款結果回調（ReturnURL）：驗證簽章後更新 Sheet 付款狀態
// ------------------------------------------------------------
function handleEcpayCallback(params, rawBody) {
  try {
    const props = PropertiesService.getScriptProperties();
    const hashKey = props.getProperty("ECPAY_HASH_KEY");
    const hashIV = props.getProperty("ECPAY_HASH_IV");

    const received = params.CheckMacValue;
    const toVerify = {};
    Object.keys(params).forEach((k) => {
      if (k !== "CheckMacValue") toVerify[k] = params[k];
    });
    const keys = Object.keys(toVerify).sort();
    const pairs = keys.map((k) => `${k}=${toVerify[k]}`);
    const rawString = `HashKey=${hashKey}&${pairs.join("&")}&HashIV=${hashIV}`;
    const encodedString = dotNetUrlEncode(rawString);
    const expected = generateCheckMacValue(toVerify, hashKey, hashIV);
    const macMatch = expected === received;

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const tradeNo = params.MerchantTradeNo;
    let rowIndex = -1;
    if (macMatch) {
      const sheet = ss.getSheets()[0];
      rowIndex = findRowByTradeNo(sheet, tradeNo);
    }

    writeDebugLog(ss, {
      params: JSON.stringify(params),
      expected,
      received,
      macMatch,
      rowIndex,
      hashKeyLen: hashKey ? hashKey.length : -1,
      hashIVLen: hashIV ? hashIV.length : -1,
      encodedString,
      hashKeyFingerprint: hashKey ? toHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, hashKey)) : "",
      hashIVFingerprint: hashIV ? toHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, hashIV)) : "",
      rawBody: rawBody || "",
    });

    if (!macMatch) {
      return ContentService.createTextOutput("0|CheckMacValueError");
    }

    if (rowIndex > 0) {
      const sheet = ss.getSheets()[0];
      const paid = params.RtnCode === "1";
      sheet.getRange(rowIndex, COL.付款狀態).setValue(paid ? "已付款" : "付款失敗");

      if (paid) {
        const rowValues = sheet.getRange(rowIndex, 1, 1, HEADER_ROW.length).getValues()[0];
        notifyNewPaidOrder(rowValues, tradeNo);
      }
    }

    return ContentService.createTextOutput("1|OK");
  } catch (err) {
    try {
      const ss = SpreadsheetApp.openById(SHEET_ID);
      writeDebugLog(ss, { params: JSON.stringify(params), error: String(err) });
    } catch (err2) {
      Logger.log(err2);
    }
    return ContentService.createTextOutput("0|Error");
  }
}

function writeDebugLog(ss, data) {
  let sheet = ss.getSheetByName("Debug");
  if (!sheet) {
    sheet = ss.insertSheet("Debug");
    sheet.appendRow(["時間", "params", "expected", "received", "macMatch", "rowIndex", "error", "hashKeyLen", "hashIVLen", "encodedString", "hashKeyFingerprint", "hashIVFingerprint", "rawBody"]);
  }
  sheet.appendRow([
    new Date(),
    data.params || "",
    data.expected || "",
    data.received || "",
    data.macMatch === undefined ? "" : String(data.macMatch),
    data.rowIndex === undefined ? "" : data.rowIndex,
    data.error || "",
    data.hashKeyLen === undefined ? "" : data.hashKeyLen,
    data.hashIVLen === undefined ? "" : data.hashIVLen,
    data.encodedString || "",
    data.hashKeyFingerprint || "",
    data.hashIVFingerprint || "",
    data.rawBody || "",
  ]);
}

function findRowByTradeNo(sheet, tradeNo) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const values = sheet.getRange(2, COL.訂單編號, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(tradeNo)) return i + 2;
  }
  return -1;
}

function notifyNewPaidOrder(rowValues, tradeNo) {
  try {
    const name = rowValues[COL.姓名 - 1];
    const totalPacks = rowValues[COL.總包數 - 1];
    const finalTotal = rowValues[COL.應付總額 - 1];
    const address = rowValues[COL.寄件地址 - 1];
    const phone = rowValues[COL.電話 - 1];
    const msg = `【已付款新訂單】${name} ${totalPacks}包 $${finalTotal}\n訂單編號:${tradeNo}\n地址:${address}\n電話:${phone}`;

    if (NOTIFY_EMAIL) {
      MailApp.sendEmail(
        NOTIFY_EMAIL,
        `高捷福委團購新訂單(已付款) - ${name}`,
        msg + "\n\n看表: https://docs.google.com/spreadsheets/d/" + SHEET_ID
      );
    }
    if (LINE_TOKEN) {
      UrlFetchApp.fetch("https://notify-api.line.me/api/notify", {
        method: "post",
        headers: { Authorization: "Bearer " + LINE_TOKEN },
        payload: { message: msg },
      });
    }
  } catch (err) {
    Logger.log(err);
  }
}

function ensureHeader(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADER_ROW);
  }
}

function generateTradeNo() {
  const ts = Utilities.formatDate(new Date(), "GMT+8", "yyyyMMddHHmmss");
  const rand = Math.floor(Math.random() * 900 + 100);
  return `RB${ts}${rand}`;
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------
// 綠界 CheckMacValue 簽章（官方演算法：排序參數 -> 組字串 -> .NET UrlEncode 規則編碼 -> SHA256 -> 轉大寫）
// ------------------------------------------------------------
function generateCheckMacValue(params, hashKey, hashIV) {
  const keys = Object.keys(params).sort();
  const pairs = keys.map((k) => `${k}=${params[k]}`);
  const raw = `HashKey=${hashKey}&${pairs.join("&")}&HashIV=${hashIV}`;
  const encoded = dotNetUrlEncode(raw);
  const digestBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, encoded);
  return toHex(digestBytes).toUpperCase();
}

function dotNetUrlEncode(str) {
  let result = encodeURIComponent(str).toLowerCase();
  const replacements = {
    "%2d": "-", "%5f": "_", "%2e": ".", "%21": "!",
    "%2a": "*", "%28": "(", "%29": ")", "%20": "+",
  };
  Object.keys(replacements).forEach((k) => {
    result = result.split(k).join(replacements[k]);
  });
  return result;
}

function toHex(bytes) {
  return bytes
    .map((b) => {
      const v = b < 0 ? b + 256 : b;
      return ("0" + v.toString(16)).slice(-2);
    })
    .join("");
}
