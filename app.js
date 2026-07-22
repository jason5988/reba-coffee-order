// 部署好 Apps Script（見 apps-script/Code.gs 與 README.md）後，把下面網址換成你的 Web App /exec 網址
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbybHCIm2DBlpB5u5d4nA0eahJxwkFyHjj4zkepwPD1pR7XbU4KWIh5mYOJlvjg6FVIg/exec";

const PRICE_PER_PACK = 30;
const MIN_PACKS = 100;

const PRODUCTS = [
  { key: "2019光耀之心", name: "2019 光耀之心" },
  { key: "2017光榮時刻", name: "2017 光榮時刻" },
  { key: "千古尋", name: "千古尋" },
  { key: "語生花", name: "語生花" },
  { key: "禪武定", name: "禪武定" },
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
const form = document.getElementById("order-form");

function renderProducts() {
  productListEl.innerHTML = "";
  PRODUCTS.forEach((p) => {
    const row = document.createElement("div");
    row.className = "product-row";
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

  const { totalPacks, subtotal, shippingFee, finalTotal, qualifies } = updateSummary();
  if (!qualifies) {
    formErrorEl.textContent = "尚未達到 100 包最低出貨門檻，無法送出訂單。";
    return;
  }

  const fd = new FormData(form);
  const name = fd.get("name").trim();
  const dept = fd.get("dept").trim();
  const email = fd.get("email").trim();
  const phone = fd.get("phone").trim();
  const address = fd.get("address").trim();
  const note = fd.get("note").trim();

  if (!name || !dept || !email || !phone || !address) {
    formErrorEl.textContent = "請完整填寫訂購人資料。";
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

    redirectToEcpay(data.actionUrl, data.fields);
  } catch (err) {
    formErrorEl.textContent = `發生錯誤：${err.message}`;
    submitBtn.disabled = false;
    submitBtn.textContent = "前往綠界刷卡付款";
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
