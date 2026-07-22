// 部署好 Apps Script（見 apps-script/Code.gs 與 README.md）後，把下面網址換成你的 Web App /exec 網址
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyeREeFl4gEK7XrlVy4SFrTEe_uDs_LVzcwUwfJnXVzbO-jKOnxcZjBhUyHYmHVrSap/exec";

const PRICE_PER_PACK = 30;
const MIN_PACKS = 100;
const EMAIL_DOMAIN = "@krtco.com.tw";

const PRODUCTS = [
  { key: "2019光耀之心", name: "2019 光耀之心", color: "var(--flavor-1)" },
  { key: "2017光榮時刻", name: "2017 光榮時刻", color: "var(--flavor-2)" },
  { key: "千古尋", name: "千古尋", color: "var(--flavor-3)" },
  { key: "語生花", name: "語生花", color: "var(--flavor-4)" },
  { key: "禪武定", name: "禪武定", color: "var(--flavor-5)" },
];

const quantities = {};
PRODUCTS.forEach((p) => (quantities[p.key] = 0));

const productListEl = document.getElementById("product-list");
const sumPacksEl = document.getElementById("sum-packs");
const sumSubtotalEl = document.getElementById("sum-subtotal");
const sumShippingEl = document.getElementById("sum-shipping");
const sumTotalEl = document.getElementById("sum-total");
const thresholdMsgEl = document.getElementById("threshold-msg");
const submitBtn = document.getElementById("submit-btn");
const formErrorEl = document.getElementById("form-error");
const successMsgEl = document.getElementById("success-msg");
const secureNoteEl = document.getElementById("secure-note");
const bankInfoEl = document.getElementById("bank-info");
const form = document.getElementById("order-form");

const SUBMIT_LABELS = {
  credit_card: "前往綠界付款（信用卡 / Apple Pay）",
  bank_transfer: "送出訂單（我將自行完成匯款）",
};

function getSelectedPaymentMethod() {
  const checked = form.querySelector('input[name="paymentMethod"]:checked');
  return checked ? checked.value : "credit_card";
}

function updatePaymentMethodUI() {
  const method = getSelectedPaymentMethod();
  bankInfoEl.hidden = method !== "bank_transfer";
  submitBtn.textContent = SUBMIT_LABELS[method];
  secureNoteEl.hidden = method !== "credit_card";
}

document.addEventListener("change", (e) => {
  if (e.target.matches('input[name="paymentMethod"]')) {
    updatePaymentMethodUI();
  }
});

function renderProducts() {
  productListEl.innerHTML = "";
  PRODUCTS.forEach((p) => {
    const row = document.createElement("div");
    row.className = "product-row";
    row.style.setProperty("--row-accent", p.color);
    row.innerHTML = `
      <div class="product-info">
        <span class="product-name">${p.name}</span>
        <span class="product-price">NT$ ${PRICE_PER_PACK} / 包</span>
      </div>
      <div class="qty-control">
        <button type="button" data-action="dec" data-key="${p.key}" aria-label="減少">−</button>
        <input type="number" min="0" step="1" inputmode="numeric" value="0" data-key="${p.key}" />
        <button type="button" data-action="inc" data-key="${p.key}" aria-label="增加">＋</button>
      </div>
    `;
    productListEl.appendChild(row);
  });
}

function updateSummary() {
  const totalPacks = Object.values(quantities).reduce((a, b) => a + b, 0);
  const subtotal = totalPacks * PRICE_PER_PACK;
  const qualifies = totalPacks >= MIN_PACKS;
  const shippingFee = 0;
  const finalTotal = subtotal + shippingFee;

  sumPacksEl.textContent = totalPacks;
  sumSubtotalEl.textContent = `NT$ ${subtotal.toLocaleString()}`;
  sumShippingEl.textContent = qualifies ? "免運" : "—（未達出貨門檻）";
  sumTotalEl.textContent = `NT$ ${finalTotal.toLocaleString()}`;

  if (qualifies) {
    thresholdMsgEl.textContent = `已達 100 包最低出貨門檻，可享優惠價與免運！`;
    thresholdMsgEl.className = "threshold-msg ok";
    submitBtn.disabled = false;
  } else {
    const remaining = MIN_PACKS - totalPacks;
    thresholdMsgEl.textContent = `此優惠僅限單筆訂單滿 100 包成立，還差 ${remaining} 包`;
    thresholdMsgEl.className = "threshold-msg warn";
    submitBtn.disabled = true;
  }

  return { totalPacks, subtotal, shippingFee, finalTotal, qualifies };
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const key = btn.dataset.key;
  const input = productListEl.querySelector(`input[data-key="${key}"]`);
  let val = quantities[key];
  if (btn.dataset.action === "inc") val += 1;
  if (btn.dataset.action === "dec") val = Math.max(0, val - 1);
  quantities[key] = val;
  input.value = val;
  updateSummary();
});

document.addEventListener("input", (e) => {
  if (e.target.matches("input[data-key]")) {
    const key = e.target.dataset.key;
    let val = parseInt(e.target.value, 10);
    if (isNaN(val) || val < 0) val = 0;
    quantities[key] = val;
    e.target.value = val;
    updateSummary();
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formErrorEl.textContent = "";
  successMsgEl.hidden = true;

  const { totalPacks, subtotal, shippingFee, finalTotal, qualifies } = updateSummary();
  if (!qualifies) {
    formErrorEl.textContent = "尚未達到 100 包最低出貨門檻，無法送出訂單。";
    return;
  }

  const paymentMethod = getSelectedPaymentMethod();
  const fd = new FormData(form);
  const name = fd.get("name").trim();
  const dept = fd.get("dept").trim();
  const email = fd.get("email").trim();
  const phone = fd.get("phone").trim();
  const address = fd.get("address").trim();
  const last5 = fd.get("last5").trim();
  const note = fd.get("note").trim();

  if (!name || !dept || !email || !phone || !address) {
    formErrorEl.textContent = "請完整填寫訂購人資料。";
    return;
  }

  if (!email.toLowerCase().endsWith(EMAIL_DOMAIN)) {
    formErrorEl.textContent = `本優惠專案為高捷員工專屬優惠，請輸入公司 email（${EMAIL_DOMAIN}）。`;
    return;
  }

  if (APPS_SCRIPT_URL.includes("PUT_YOUR_DEPLOYMENT_ID_HERE")) {
    formErrorEl.textContent = "尚未設定後端網址（APPS_SCRIPT_URL），請先完成部署，詳見 README.md。";
    return;
  }

  const payload = {
    action: "createOrder",
    name,
    dept,
    email,
    phone,
    address,
    note,
    paymentMethod,
    last5,
    products: { ...quantities },
    totalPacks,
    subtotal,
    shippingFee,
    finalTotal,
    domain: location.hostname,
  };

  submitBtn.disabled = true;
  submitBtn.textContent = "處理中，請稍候…";

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (data.result !== "success") {
      throw new Error(data.message || "建立訂單失敗，請稍後再試。");
    }

    if (paymentMethod === "bank_transfer") {
      successMsgEl.textContent = "訂單已送出！請完成匯款，我們確認款項到帳後會安排出貨並寄送確認信。";
      successMsgEl.hidden = false;
      submitBtn.disabled = true;
      submitBtn.textContent = "已送出";
    } else {
      redirectToEcpay(data.actionUrl, data.fields);
    }
  } catch (err) {
    formErrorEl.textContent = `發生錯誤：${err.message}`;
    submitBtn.disabled = false;
    submitBtn.textContent = SUBMIT_LABELS[paymentMethod];
  }
});

function redirectToEcpay(actionUrl, fields) {
  const ecpayForm = document.createElement("form");
  ecpayForm.method = "POST";
  ecpayForm.action = actionUrl;
  Object.entries(fields).forEach(([key, value]) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = key;
    input.value = value;
    ecpayForm.appendChild(input);
  });
  document.body.appendChild(ecpayForm);
  ecpayForm.submit();
}

renderProducts();
updateSummary();
updatePaymentMethodUI();
