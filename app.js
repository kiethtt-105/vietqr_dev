const LS_DEFAULTS = "vietqr_defaults";
const LS_FORM_STATE = "vietqr_form_state";

const ADDINFO_SOFT_LIMIT = 90;
const AMOUNT_WARN_THRESHOLD = 500_000_000;

// Giá trị mặc định khi chưa có data/templates.json và chưa từng lưu gì (dùng làm fallback).
const DEFAULT_QR_TEMPLATES = [
  { value: "compact2", label: "Compact 2" },
  { value: "compact", label: "Compact" },
  { value: "print", label: "Print" },
  { value: "qr_only", label: "Chỉ mã QR" },
];

// Giá trị mặc định cho các nút "số tiền nhanh" khi chưa có data/so-tien-goi-y.json
// và chưa từng lưu gì (dùng làm fallback), tương tự DEFAULT_QR_TEMPLATES ở trên.
const DEFAULT_SUGGESTED_AMOUNTS = [20000, 50000, 100000, 200000, 500000, 1000000];

// ============================================================
// GOOGLE SHEETS (nguồn dữ liệu duy nhất — CHỈ ĐỌC, không ghi/sửa)
// ============================================================
const SHEET_ID = "1a4hAmtPz0KKJZ3il3lUGBewO8ku1JtDroB0DbAHqm2Q";
const SHEET_TABS = {
  accounts: "TaiKhoan",
  presets: "MauChuyenTien",
  content: "NoiDungGoiY",
  templates: "MauHienThi",
  amounts: "SoTienGoiY",
  banks: "Banks",
};

function sheetTabUrl(tabName) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tabName)}`;
}

// Đọc 1 tab và trả về mảng object { <tên_cột_ở_hàng_1>: <giá_trị>, ... }.
// Ưu tiên lấy giá trị dạng chuỗi gốc (cell.f) cho các cột trông giống số/mã
// (số tài khoản, BIN...) để không bị mất số 0 ở đầu hoặc sai lệch số có nhiều chữ số.
async function fetchSheetTab(tabName) {
  const res = await fetch(sheetTabUrl(tabName));
  if (!res.ok) throw new Error(`Không đọc được tab "${tabName}" từ Google Sheet (HTTP ${res.status})`);
  const text = await res.text();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`Không đọc được tab "${tabName}" từ Google Sheet (sai định dạng)`);
  const json = JSON.parse(text.slice(start, end + 1));
  const cols = (json.table.cols || []).map((c, i) => (c.label || c.id || `col${i}`).trim());
  const rows = json.table.rows || [];
  return rows
    .map((r) => {
      const obj = {};
      cols.forEach((colName, i) => {
        if (!colName) return;
        const cell = (r.c || [])[i];
        if (!cell) {
          obj[colName] = "";
          return;
        }
        // cell.f = giá trị hiển thị dạng text (an toàn cho số dài/mã có số 0 đầu)
        // cell.v = giá trị "thô" (dùng khi không có .f, ví dụ ô trống hoặc số thường)
        const raw = cell.f !== undefined && cell.f !== null && cell.f !== "" ? cell.f : cell.v;
        obj[colName] = raw === null || raw === undefined ? "" : String(raw).trim();
      });
      return obj;
    })
    .filter((obj) => Object.values(obj).some((v) => String(v).trim() !== ""));
}

function sheetBool(v) {
  const s = String(v).trim().toUpperCase();
  return s === "TRUE" || s === "1" || s === "X" || s === "CÓ";
}
function sheetNumber(v) {
  const n = Number(String(v).replace(/[.,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
// Lấy giá trị theo danh sách tên cột khả dĩ (không phân biệt hoa/thường),
// để vẫn chạy được dù tên cột trên Sheet hơi khác cách viết dự kiến.
function pick(row, ...keys) {
  const map = {};
  Object.keys(row).forEach((k) => (map[k.toLowerCase()] = row[k]));
  for (const k of keys) {
    const v = map[k.toLowerCase()];
    if (v !== undefined && v !== "") return v;
  }
  return "";
}

async function loadAccountsFromSheet() {
  const rows = await fetchSheetTab(SHEET_TABS.accounts);
  return rows.map((r) => {
    const shortName = pick(r, "data__short_name", "data__shortName", "data__name");
    return {
      list_name: pick(r, "list_name"),
      name_ac: pick(r, "name_ac"),
      data_num: pick(r, "data_num"),
      data__code: pick(r, "data__code"),
      data__name: shortName,
      data__shortName: shortName,
      data__short_name: shortName,
      data__bin: pick(r, "data__bin"),
      data__logo: pick(r, "data__logo"),
      vietqr_link: pick(r, "vietqr_link"),
      hidden: sheetBool(pick(r, "hidden")),
      isDefault: sheetBool(pick(r, "isDefault", "is_default")),
    };
  });
}

async function loadPresetsFromSheet() {
  const rows = await fetchSheetTab(SHEET_TABS.presets);
  return rows.map((r) => ({
    name: pick(r, "name"),
    accountName: pick(r, "accountName", "account_name"),
    accountNum: pick(r, "accountNum", "account_num"),
    bankCode: pick(r, "bankCode", "bank_code"),
    amount: pick(r, "amount") ? sheetNumber(pick(r, "amount")) : "",
    content: pick(r, "content"),
    template: pick(r, "template"),
  }));
}

async function loadContentFromSheet() {
  const rows = await fetchSheetTab(SHEET_TABS.content);
  return rows.map((r) => pick(r, "content", "text", "value", "noidung") || Object.values(r)[0]).filter(Boolean);
}

async function loadTemplatesFromSheet() {
  const rows = await fetchSheetTab(SHEET_TABS.templates);
  return rows.map((r) => ({
    value: pick(r, "value"),
    label: pick(r, "label"),
  }));
}

async function loadAmountsFromSheet() {
  const rows = await fetchSheetTab(SHEET_TABS.amounts);
  return rows
    .map((r) => sheetNumber(pick(r, "amount", "value", "sotien") || Object.values(r)[0]))
    .filter((n) => n > 0);
}

async function loadBanksFromSheet() {
  const rows = await fetchSheetTab(SHEET_TABS.banks);
  return rows.map((r) => ({
    code: pick(r, "code"),
    name: pick(r, "name"),
    shortName: pick(r, "shortName", "short_name"),
    short_name: pick(r, "short_name", "shortName"),
    bin: pick(r, "bin"),
    logo: pick(r, "logo"),
    swift_code: pick(r, "swift_code", "swiftCode"),
  }));
}

let state = {
  refBanks: [],
  accounts: [],
  presets: [],
  content: [],
  templates: [],
  amounts: [],
  selectedPresetIdx: null,
};

function showConfirm(message, okLabel) {
  return new Promise((resolve) => {
    const backdrop = $("#confirmBackdrop");
    const okBtn = $("#confirmOkBtn");
    const cancelBtn = $("#confirmCancelBtn");
    $("#confirmMessage").textContent = message;
    okBtn.textContent = okLabel || "Xoá";
    backdrop.hidden = false;

    function cleanup(result) {
      backdrop.hidden = true;
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      backdrop.removeEventListener("click", onBackdropClick);
      document.removeEventListener("keydown", onKeydown);
      resolve(result);
    }
    function onOk() {
      cleanup(true);
    }
    function onCancel() {
      cleanup(false);
    }
    function onBackdropClick(e) {
      if (e.target.id === "confirmBackdrop") cleanup(false);
    }
    function onKeydown(e) {
      if (e.key === "Escape") cleanup(false);
    }
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    backdrop.addEventListener("click", onBackdropClick);
    document.addEventListener("keydown", onKeydown);
  });
}

const TOAST_MAX_VISIBLE = 4;
function showToast(message, kind, opts) {
  const stack = document.getElementById("toastStack");
  if (!stack) return;

  while (stack.children.length >= TOAST_MAX_VISIBLE) {
    stack.firstElementChild.remove();
  }

  const toast = document.createElement("div");
  toast.className = "toast" + (kind ? " " + kind : "");

  const textEl = document.createElement("span");
  textEl.className = "toast-text";
  textEl.textContent = message;
  toast.appendChild(textEl);

  const remove = () => {
    toast.classList.add("leaving");
    setTimeout(() => toast.remove(), 180);
  };

  const duration = (opts && opts.duration) || 2600;
  const timer = setTimeout(remove, duration);

  if (opts && opts.actionLabel && opts.onAction) {
    const actionBtn = document.createElement("button");
    actionBtn.type = "button";
    actionBtn.className = "toast-action";
    actionBtn.textContent = opts.actionLabel;
    actionBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      clearTimeout(timer);
      opts.onAction();
      remove();
    });
    toast.appendChild(actionBtn);
  }

  toast.addEventListener("click", () => {
    clearTimeout(timer);
    remove();
  });
  stack.appendChild(toast);
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// Dùng Intl.NumberFormat('vi-VN') chuẩn thay vì tự viết logic phân cách hàng nghìn,
// và cache 1 instance formatter để tránh khởi tạo lại (tra locale data) mỗi lần gõ phím.
const numberFormatterVi = new Intl.NumberFormat("vi-VN");
function formatNumber(n) {
  const num = String(n).replace(/[^\d]/g, "");
  if (!num) return "";
  return numberFormatterVi.format(Number(num));
}
function rawNumber(formatted) {
  return String(formatted).replace(/[^\d]/g, "");
}
function escapeAttr(v) {
  return String(v ?? "").replace(/"/g, "&quot;");
}
function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
function setStatus(el, msg, kind) {
  if (!el) return;
  el.textContent = msg || "";
  el.className = "status" + (kind ? " " + kind : "");
}
function restartAnimation(el) {
  if (!el) return;
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "";
}
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Dữ liệu giờ CHỈ ĐỌC từ Google Sheet (không còn GitHub/token, không còn ghi
// ngược lại đâu cả). Giữ 2 hàm này dạng no-op vì vẫn còn được gọi rải rác
// trong code chỉnh sửa bảng (sẽ dọn nốt ở bước sau).
function markDirty() {}
function clearDirty() {}
function savePresetsCache() {}
function saveContentCache() {}
function saveAmountsCache() {}
function saveTemplatesCache() {}

// ---------- Ngân hàng (nguồn: tab "Banks" trong Google Sheet) ----------
async function loadRefBanks() {
  try {
    state.refBanks = await loadBanksFromSheet();
  } catch (e) {
    console.error(e);
    state.refBanks = [];
  }
}
async function refreshRefBanksFromVietQR() {
  const btn = $("#btnRefreshBanks");
  const original = btn.textContent;
  btn.classList.add("is-loading");
  btn.disabled = true;
  try {
    const banks = await loadBanksFromSheet();
    if (!banks.length) throw new Error("Không đọc được dữ liệu ngân hàng từ Google Sheet");
    state.refBanks = banks;
    renderTable();
    renderVietqrBanksTable();
    btn.classList.remove("is-loading");
    btn.textContent = `Đã cập nhật ${state.refBanks.length} ngân hàng ✓`;
  } catch (err) {
    console.error(err);
    btn.classList.remove("is-loading");
    btn.textContent = "Lỗi tải — thử lại sau";
  } finally {
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
    }, 2500);
  }
}
function bankLabelForRow(acc) {
  if (!acc || !acc.data__code) return "";
  return `${acc.data__name || acc.data__shortName || ""} — ${acc.data__code}`;
}

// ---------- Popup tìm/lọc ngân hàng (thay cho <select> dài, khó tìm khi có nhiều ngân hàng) ----------
let bankPickerOpenIdx = null;
function closeBankPicker() {
  const popup = $("#bankPickerPopup");
  if (popup) popup.hidden = true;
  bankPickerOpenIdx = null;
}
function positionBankPicker(inputEl) {
  const popup = $("#bankPickerPopup");
  const rect = inputEl.getBoundingClientRect();
  const maxHeight = 260;
  const spaceBelow = window.innerHeight - rect.bottom;
  const openUp = spaceBelow < maxHeight && rect.top > spaceBelow;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8));
  popup.style.left = `${left}px`;
  popup.style.width = `${rect.width}px`;
  if (openUp) {
    popup.style.top = "";
    popup.style.bottom = `${window.innerHeight - rect.top + 4}px`;
  } else {
    popup.style.bottom = "";
    popup.style.top = `${rect.bottom + 4}px`;
  }
}
function renderBankPickerList(idx, query) {
  const list = $("#bankPickerList");
  if (!list) return;
  const q = String(query || "").trim().toLowerCase();
  const items = !q
    ? state.refBanks
    : state.refBanks.filter((b) => `${b.shortName || ""} ${b.name || ""} ${b.code || ""}`.toLowerCase().includes(q));

  if (!items.length) {
    list.innerHTML = `<div class="bank-picker-empty">Không tìm thấy ngân hàng phù hợp</div>`;
    return;
  }
  list.innerHTML = items
    .map(
      (b) =>
        `<button type="button" class="bank-picker-item" data-code="${escapeAttr(b.code)}">${escapeHtml(b.shortName)} <span class="bank-picker-code">— ${escapeHtml(b.code)}</span></button>`
    )
    .join("");
  list.querySelectorAll("[data-code]").forEach((btn) => {
    // mousedown (không phải click) để chạy trước sự kiện blur của ô input
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      selectBankForRow(idx, btn.dataset.code);
    });
  });
}
function selectBankForRow(idx, code) {
  if (idx === "adhoc") {
    selectAdhocBank(code);
    closeBankPicker();
    return;
  }
  applyBankToRow(idx, code);
  markDirty("accounts");
  closeBankPicker();
  renderTable();
  populateQrAccounts();
}
function openBankPicker(idx, inputEl) {
  bankPickerOpenIdx = idx;
  const popup = $("#bankPickerPopup");
  if (!popup) return;
  if (!state.refBanks.length) {
    showToast('Chưa có danh sách ngân hàng — bấm nút "⟳" để tải từ VietQR.', "err");
    return;
  }
  popup.hidden = false;
  positionBankPicker(inputEl);
  inputEl.select();
  renderBankPickerList(idx, "");
}

// ---------- Dropdown chọn tuỳ biến (thay <select> gốc cho đẹp & đồng bộ theme) ----------
let customSelectOpenEl = null;
function closeCustomSelect() {
  const panel = $("#customSelectPanel");
  if (panel) panel.hidden = true;
  if (customSelectOpenEl && customSelectOpenEl._csTrigger) {
    customSelectOpenEl._csTrigger.classList.remove("open");
  }
  customSelectOpenEl = null;
}
function positionCustomSelectPanel(triggerEl) {
  const panel = $("#customSelectPanel");
  const rect = triggerEl.getBoundingClientRect();
  const maxHeight = 260;
  const spaceBelow = window.innerHeight - rect.bottom;
  const openUp = spaceBelow < maxHeight && rect.top > spaceBelow;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8));
  panel.style.left = `${left}px`;
  panel.style.width = `${rect.width}px`;
  if (openUp) {
    panel.style.top = "";
    panel.style.bottom = `${window.innerHeight - rect.top + 4}px`;
  } else {
    panel.style.bottom = "";
    panel.style.top = `${rect.bottom + 4}px`;
  }
}
function updateCustomSelectTriggerLabel(selectEl) {
  if (!selectEl || !selectEl._csTrigger) return;
  const opt = selectEl.options[selectEl.selectedIndex];
  selectEl._csTrigger.querySelector(".custom-select-label").textContent = opt ? opt.textContent : "";
}
function renderCustomSelectList(selectEl) {
  const list = $("#customSelectList");
  if (!list) return;
  const options = Array.from(selectEl.options);
  if (!options.length) {
    list.innerHTML = `<div class="bank-picker-empty">Không có lựa chọn</div>`;
    return;
  }
  list.innerHTML = options
    .map(
      (opt, i) =>
        `<button type="button" class="custom-select-item${i === selectEl.selectedIndex ? " active" : ""}" data-idx="${i}">${escapeHtml(
          opt.textContent
        )}</button>`
    )
    .join("");
  list.querySelectorAll("[data-idx]").forEach((btn) => {
    // mousedown (không phải click) để chạy trước sự kiện blur/outside-click
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const opt = options[Number(btn.dataset.idx)];
      if (selectEl.value !== opt.value) {
        selectEl.value = opt.value;
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
      }
      updateCustomSelectTriggerLabel(selectEl);
      closeCustomSelect();
    });
  });
}
function openCustomSelect(selectEl) {
  if (customSelectOpenEl === selectEl) {
    closeCustomSelect();
    return;
  }
  closeCustomSelect();
  if (!selectEl.options.length) return;
  customSelectOpenEl = selectEl;
  selectEl._csTrigger.classList.add("open");
  const panel = $("#customSelectPanel");
  panel.hidden = false;
  positionCustomSelectPanel(selectEl._csTrigger);
  renderCustomSelectList(selectEl);
}
function enhanceSelect(selectEl) {
  if (!selectEl || selectEl._csEnhanced) return;
  selectEl._csEnhanced = true;
  const wrap = document.createElement("div");
  wrap.className = "custom-select";
  selectEl.parentNode.insertBefore(wrap, selectEl);
  wrap.appendChild(selectEl);
  selectEl.classList.add("custom-select-native");
  selectEl.tabIndex = -1;
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "custom-select-trigger";
  trigger.innerHTML = `<span class="custom-select-label"></span><span class="chev">▾</span>`;
  wrap.appendChild(trigger);
  selectEl._csTrigger = trigger;
  trigger.addEventListener("click", () => openCustomSelect(selectEl));
  updateCustomSelectTriggerLabel(selectEl);
}

// ---------- Tài khoản (nguồn: tab "TaiKhoan" trong Google Sheet) ----------
async function loadAccountsInitial() {
  try {
    state.accounts = normalizeAccountFields(await loadAccountsFromSheet());
  } catch (e) {
    console.error(e);
    state.accounts = [];
  }
  sortAccountsByStt();
}

// ---------- Mẫu chuyển tiền (nguồn: tab "MauChuyenTien") ----------
async function loadPresetsInitial() {
  try {
    state.presets = await loadPresetsFromSheet();
  } catch (e) {
    console.error(e);
    state.presets = [];
  }
}

// ---------- Nội dung chuyển khoản gợi ý (nguồn: tab "NoiDungGoiY") ----------
async function loadContentInitial() {
  try {
    state.content = await loadContentFromSheet();
  } catch (e) {
    console.error(e);
    state.content = [];
  }
}

// ---------- Số tiền gợi ý (nguồn: tab "SoTienGoiY") ----------
async function loadAmountsInitial() {
  try {
    const amounts = await loadAmountsFromSheet();
    state.amounts = amounts.length ? amounts : DEFAULT_SUGGESTED_AMOUNTS.slice();
  } catch (e) {
    console.error(e);
    state.amounts = DEFAULT_SUGGESTED_AMOUNTS.slice();
  }
}

// ---------- Mẫu hiển thị QR (nguồn: tab "MauHienThi") ----------
async function loadTemplatesInitial() {
  try {
    const templates = await loadTemplatesFromSheet();
    state.templates = templates.length ? templates : DEFAULT_QR_TEMPLATES.slice();
  } catch (e) {
    console.error(e);
    state.templates = DEFAULT_QR_TEMPLATES.slice();
  }
}
function applyBankToRow(idx, bankCode) {
  const bank = state.refBanks.find((b) => b.code === bankCode);
  if (!bank) return;
  const row = state.accounts[idx];
  row.data__id = bank.id;
  row.data__name = bank.shortName;
  row.data__code = bank.code;
  row.data__bin = bank.bin;
  row.data__shortName = bank.shortName;
  row.data__logo = bank.logo;
  row.data__short_name = bank.short_name;
}
function buildAccountVietQrLink(acc) {
  if (!acc || !acc.data__code || !acc.data_num) return "";
  return buildQrUrlRaw(acc.data__code, acc.data_num, "", "", "compact2", acc.name_ac || "");
}
// ---------- Thứ tự hiển thị (STT) ----------
function renumberAccountsStt() {
  state.accounts.forEach((a, i) => {
    a.stt = i + 1;
  });
}
function sortAccountsByStt() {
  const hasStt = state.accounts.some((a) => a && a.stt != null);
  if (hasStt) {
    state.accounts.sort((a, b) => (a.stt ?? 9999) - (b.stt ?? 9999));
  }
  renumberAccountsStt();
}
function moveAccountRow(idx, dir) {
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= state.accounts.length) return;
  const tmp = state.accounts[idx];
  state.accounts[idx] = state.accounts[newIdx];
  state.accounts[newIdx] = tmp;
  renumberAccountsStt();
  markDirty("accounts");
  renderTable();
  populateQrAccounts();
}
function renderTable() {
  const body = $("#bankTableBody");
  const q = ($("#accountSearch")?.value || "").trim().toLowerCase();
  const sortable = !q;
  body.innerHTML = "";
  let shown = 0;
  state.accounts.forEach((acc, idx) => {
    if (q) {
      const hay = `${acc.list_name || ""} ${acc.data_num || ""} ${acc.name_ac || ""}`.toLowerCase();
      if (!hay.includes(q)) return;
    }
    shown++;
    acc.vietqr_link = buildAccountVietQrLink(acc);
    const hasLink = !!acc.vietqr_link;
    const tr = document.createElement("tr");
    if (acc.hidden) tr.classList.add("row-hidden");
    tr.innerHTML = `
      <td class="stt-cell">${idx + 1}</td>
      <td data-label="Tên gợi nhớ"><input data-idx="${idx}" data-field="list_name" value="${escapeAttr(acc.list_name)}" title="${escapeAttr(acc.list_name)}"></td>
      <td data-label="Số tài khoản"><input data-idx="${idx}" data-field="data_num" value="${escapeAttr(acc.data_num)}" title="${escapeAttr(acc.data_num)}"></td>
      <td data-label="Chủ tài khoản"><input data-idx="${idx}" data-field="name_ac" value="${escapeAttr(acc.name_ac)}" title="${escapeAttr(acc.name_ac)}"></td>
      <td data-label="Ngân hàng">
        <input type="text" class="bank-input" data-idx="${idx}" autocomplete="off"
          placeholder="🔎 Tìm ngân hàng…" value="${escapeAttr(bankLabelForRow(acc))}">
      </td>
      <td class="row-actions">
        ${hasLink
          ? `<a class="icon-btn" href="${escapeAttr(acc.vietqr_link)}" target="_blank" rel="noopener noreferrer" title="Mở link VietQR">🔗</a>
             <button class="icon-btn" type="button" title="Sao chép link VietQR" data-copy-link="${idx}">📋</button>`
          : `<button class="icon-btn" type="button" disabled title="Điền STK &amp; ngân hàng để có link VietQR">🔗</button>`}
        <button class="icon-btn${acc.isDefault ? " is-default" : ""}" type="button" title="${acc.isDefault ? "Đang là tài khoản mặc định — bấm để bỏ" : "Đặt làm tài khoản mặc định"}" data-toggle-default="${idx}">${acc.isDefault ? "★" : "☆"}</button>
        <button class="icon-btn${acc.hidden ? " is-hidden-on" : ""}" type="button" title="${acc.hidden ? "Đang ẩn khỏi danh sách chọn nhanh — bấm để hiện lại" : "Ẩn khỏi danh sách chọn nhanh (vẫn giữ dữ liệu)"}" data-toggle-hidden="${idx}">${acc.hidden ? "🚫" : "👁"}</button>
        <button class="icon-btn order-btn" title="Đưa lên trên" data-move="${idx}" data-dir="-1" ${!sortable || idx === 0 ? "disabled" : ""}>▲</button>
        <button class="icon-btn order-btn" title="Đưa xuống dưới" data-move="${idx}" data-dir="1" ${!sortable || idx === state.accounts.length - 1 ? "disabled" : ""}>▼</button>
        <button class="icon-btn" title="Xoá dòng" data-del="${idx}">✕</button>
      </td>`;
    body.appendChild(tr);
  });
  $("#rowCount").textContent = q ? `${shown}/${state.accounts.length} dòng` : `${state.accounts.length} dòng`;
  if (!state.refBanks.length) {
    showToast("Chưa có danh sách ngân hàng — thử bấm nút làm mới.", "err");
  }

  body.querySelectorAll("input[data-field]").forEach((input) => {
    input.addEventListener("input", (e) => {
      const idx = Number(e.target.dataset.idx);
      const field = e.target.dataset.field;
      state.accounts[idx][field] = e.target.value;
      markDirty("accounts");
      populateQrAccounts();
    });
  });
  body.querySelectorAll("input.bank-input").forEach((input) => {
    input.addEventListener("focus", (e) => openBankPicker(Number(e.target.dataset.idx), e.target));
    input.addEventListener("click", (e) => openBankPicker(Number(e.target.dataset.idx), e.target));
    input.addEventListener("input", (e) => renderBankPickerList(Number(e.target.dataset.idx), e.target.value));
    input.addEventListener("blur", (e) => {

      const i = Number(e.target.dataset.idx);
      e.target.value = bankLabelForRow(state.accounts[i]);
    });
  });
  body.querySelectorAll("[data-copy-link]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const idx = Number(e.currentTarget.dataset.copyLink);
      const link = state.accounts[idx]?.vietqr_link || "";
      if (!link) return;
      try {
        await navigator.clipboard.writeText(link);
        showToast("Đã sao chép link VietQR", "ok");
      } catch (err) {
        showToast("Không sao chép được — hãy sao chép thủ công.", "err");
      }
    });
  });
  body.querySelectorAll("[data-toggle-default]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.currentTarget.dataset.toggleDefault);
      const acc = state.accounts[idx];
      if (!acc) return;
      const turningOn = !acc.isDefault;
      state.accounts.forEach((a) => {
        a.isDefault = false;
      });
      if (turningOn) {
        acc.isDefault = true;
        acc.hidden = false; // tài khoản mặc định thì không thể ở trạng thái ẩn
      }
      markDirty("accounts");
      renderTable();
      populateQrAccounts();
      showToast(turningOn ? `Đã đặt "${acc.list_name || acc.data_num}" làm mặc định` : "Đã bỏ tài khoản mặc định", "ok");
    });
  });
  body.querySelectorAll("[data-toggle-hidden]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.currentTarget.dataset.toggleHidden);
      const acc = state.accounts[idx];
      if (!acc) return;
      acc.hidden = !acc.hidden;
      if (acc.hidden) acc.isDefault = false; // ẩn thì không thể là mặc định
      markDirty("accounts");
      renderTable();
      populateQrAccounts();
      showToast(acc.hidden ? `Đã ẩn "${acc.list_name || acc.data_num}" khỏi danh sách chọn nhanh` : `Đã hiện lại "${acc.list_name || acc.data_num}"`, "ok");
    });
  });
  body.querySelectorAll("[data-move]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.currentTarget.dataset.move);
      const dir = Number(e.currentTarget.dataset.dir);
      moveAccountRow(idx, dir);
    });
  });
  body.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const idx = Number(e.target.dataset.del);
      const removedAcc = state.accounts[idx];
      const name = removedAcc.list_name || `dòng ${idx + 1}`;
      const ok = await showConfirm(`Xoá tài khoản "${name}"?`, "Xoá");
      if (!ok) return;
      state.accounts.splice(idx, 1);
      renumberAccountsStt();
      markDirty("accounts");
      renderTable();
      populateQrAccounts();
      showToast(`Đã xoá "${name}"`, "ok");
    });
  });
}
async function addRow() {
  const btn = $("#btnAddRow");
  if (!state.refBanks.length) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Đang tải ngân hàng…";
    await refreshRefBanksFromVietQR();
    btn.disabled = false;
    btn.textContent = original;
  }
  const defaultBank = state.refBanks[0] || {};
  state.accounts.push({
    data__id: defaultBank.id || 0,
    list_name: "",
    data_num: "",
    name_ac: "",
    data__name: defaultBank.shortName || "",
    data__code: defaultBank.code || "",
    data__bin: defaultBank.bin || "",
    data__shortName: defaultBank.shortName || "",
    data__logo: defaultBank.logo || "",
    data__short_name: defaultBank.short_name || "",
    vietqr_link: "",
    hidden: false,
    isDefault: false,
  });
  renumberAccountsStt();
  markDirty("accounts");
  renderTable();
  populateQrAccounts();
}

// ---------- Mặc định: tài khoản + mẫu hiển thị QR ----------
function normalizeAccountFields(list) {
  (list || []).forEach((a) => {
    if (a.hidden === undefined) a.hidden = false;
    if (a.isDefault === undefined) a.isDefault = false;
  });
  return list;
}
function accountKey(acc) {
  return `${acc.list_name}|${acc.data_num}`;
}
function findAccountByNickname(nick) {
  if (!nick) return null;
  const n = String(nick).trim().toLowerCase();
  return state.accounts.find((a) => (a.list_name || "").trim().toLowerCase() === n) || null;
}
// Tìm tài khoản mà 1 mẫu chuyển tiền (preset) đang trỏ tới.
// Ưu tiên khớp theo SỐ TÀI KHOẢN (accountNum) — không đổi dù người dùng đổi tên gợi nhớ sau này.
// Nếu mẫu cũ chưa có accountNum (tạo trước khi có field này), fallback về khớp tên gợi nhớ,
// rồi khớp gần đúng (tên cũ nằm trong tên hiện tại hoặc ngược lại) để vẫn dùng được sau khi đổi tên.
function findAccountForPreset(preset) {
  if (!preset) return null;
  if (preset.accountNum) {
    const byNum = state.accounts.find((a) => String(a.data_num || "").trim() === String(preset.accountNum).trim());
    if (byNum) return byNum;
  }
  if (!preset.accountName) return null;
  const nick = preset.accountName.trim().toLowerCase();
  if (!nick) return null;
  const exact = state.accounts.find((a) => (a.list_name || "").trim().toLowerCase() === nick);
  if (exact) return exact;
  return (
    state.accounts.find((a) => {
      const cur = (a.list_name || "").trim().toLowerCase();
      return cur && (cur.includes(nick) || nick.includes(cur));
    }) || null
  );
}
function loadDefaults() {
  try {
    return JSON.parse(localStorage.getItem(LS_DEFAULTS) || "{}");
  } catch (e) {
    return {};
  }
}
function applyDefaults() {
  const defaults = loadDefaults();
  const defIdx = state.accounts.findIndex((a) => a.isDefault && !a.hidden);
  if (defIdx >= 0) {
    $("#qrAccount").value = defIdx;
  } else if (defaults.accountKey) {
    // Tương thích ngược: nếu trình duyệt này còn lưu mặc định kiểu cũ (localStorage)
    // từ trước khi có trường isDefault trong JSON, vẫn áp dụng tạm cho tới khi
    // người dùng đặt lại mặc định mới (sẽ tự chuyển sang lưu trong JSON).
    const idx = state.accounts.findIndex((a) => accountKey(a) === defaults.accountKey && !a.hidden);
    if (idx >= 0) $("#qrAccount").value = idx;
  }
  $("#qrTemplate").value = defaults.template || "compact2";
}
function setDefaultAccount() {
  const idx = Number($("#qrAccount").value);
  const acc = state.accounts[idx];
  if (!acc) return;
  state.accounts.forEach((a) => {
    a.isDefault = false;
  });
  acc.isDefault = true;
  markDirty("accounts");
  renderTable();
  flashLinkBtn("#btnSetDefaultAccount", "★ ");
  showToast(`Đã đặt "${acc.list_name || acc.data_num}" làm tài khoản mặc định`, "ok");
}
function setDefaultTemplate() {
  const value = $("#qrTemplate").value;
  if (!value) return;
  const defaults = loadDefaults();
  defaults.template = value;
  localStorage.setItem(LS_DEFAULTS, JSON.stringify(defaults));
  flashLinkBtn("#btnSetDefaultTemplate", "★ ");
  const tpl = state.templates.find((t) => t.value === value);
  showToast(`Đã đặt "${tpl ? tpl.label : value}" làm mẫu hiển thị mặc định`, "ok");
}
function isDefaultContent(content) {
  const defaults = loadDefaults();
  return !!(defaults.contentDefault && defaults.contentDefault === content);
}
function setDefaultContent(content) {
  const defaults = loadDefaults();
  if (defaults.contentDefault === content) {
    delete defaults.contentDefault;
    showToast("Đã bỏ nội dung mặc định", "ok");
  } else {
    defaults.contentDefault = content;
    showToast("Đã đặt nội dung mặc định", "ok");
  }
  localStorage.setItem(LS_DEFAULTS, JSON.stringify(defaults));
  renderContentSuggestions();
}
function applyDefaultContentIfNeeded() {
  const defaults = loadDefaults();
  if (!defaults.contentDefault) return;
  if ($("#qrContent").value.trim()) return;
  $("#qrContent").value = defaults.contentDefault;
  updateContentCounter(defaults.contentDefault.trim());
}
function flashLinkBtn(sel, text) {
  const btn = $(sel);
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = original), 1600);
}

function saveFormState() {
  try {
    localStorage.setItem(
      LS_FORM_STATE,
      JSON.stringify({
        accountIdx: Number($("#qrAccount").value) || 0,
        amount: rawNumber($("#qrAmount").value),
        content: $("#qrContent").value,
        template: $("#qrTemplate").value,
        selectedPresetIdx: state.selectedPresetIdx,
      })
    );
  } catch (e) {}
}
function loadFormStateRaw() {
  try {
    return JSON.parse(localStorage.getItem(LS_FORM_STATE) || "null");
  } catch (e) {
    return null;
  }
}
function clearFormState() {
  localStorage.removeItem(LS_FORM_STATE);
}
function restoreFormState() {
  const s = loadFormStateRaw();
  if (!s) return false;
  if (s.accountIdx != null && s.accountIdx < state.accounts.length) $("#qrAccount").value = s.accountIdx;
  if (s.template) $("#qrTemplate").value = s.template;
  if (s.amount) $("#qrAmount").value = formatNumber(s.amount);
  if (s.content != null) {
    $("#qrContent").value = s.content;
  }
  if (s.selectedPresetIdx != null && state.presets[s.selectedPresetIdx]) {
    state.selectedPresetIdx = s.selectedPresetIdx;
  }
  return true;
}

function populateQrTemplateOptions() {
  const optionsHtml = state.templates.map((t) => `<option value="${escapeAttr(t.value)}">${escapeHtml(t.label)}</option>`).join("");
  const defaultTemplate = loadDefaults().template || "compact2";
  [$("#qrTemplate"), $("#adhocTemplate")].forEach((sel) => {
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = optionsHtml;
    if (prev) {
      sel.value = prev;
    } else {
      // Chưa từng chọn gì ở select này (lần đầu render) — áp mẫu mặc định
      // luôn, thay vì để trình duyệt tự chọn option đầu tiên trong danh sách.
      sel.value = defaultTemplate;
    }
    updateCustomSelectTriggerLabel(sel);
  });
}

// ---------- Mẫu giao dịch (cửa sổ riêng, tách khỏi form Tạo giao dịch) ----------
function renderMauList() {
  const wrap = $("#mauList");
  const emptyHint = $("#mauEmptyHint");
  if (!wrap) return;
  wrap.innerHTML = "";
  if (emptyHint) emptyHint.hidden = state.presets.length > 0;

  state.presets.forEach((p, idx) => {
    const amountText = p.amount ? formatNumber(p.amount) + "đ" : "—";
    let accText = "(giữ tài khoản hiện tại)";
    if (p.accountName) {
      accText = escapeHtml(p.accountName);
    } else if (p.bankCode && p.accountNum) {
      accText = `${escapeHtml(p.bankCode)} — ${escapeHtml(p.accountNum)} (nhập tay)`;
    }
    const card = document.createElement("div");
    card.className = "mau-card" + (state.selectedPresetIdx === idx ? " active" : "");
    card.innerHTML = `
      <button type="button" class="mau-card-body" data-select="${idx}">
        <span class="mau-card-name">${escapeHtml(p.name || `Mẫu ${idx + 1}`)}</span>
        <span class="mau-card-meta">${accText} · ${amountText}</span>
        ${p.content ? `<span class="mau-card-content">${escapeHtml(p.content)}</span>` : ""}
      </button>
      <button type="button" class="icon-btn mau-card-del" title="Xoá mẫu" data-del="${idx}">✕</button>`;
    wrap.appendChild(card);
  });

  $("#mauCount").textContent = `${state.presets.length} mẫu`;

  wrap.querySelectorAll("[data-select]").forEach((btn) => {
    btn.addEventListener("click", () => selectMau(Number(btn.dataset.select)));
  });
  wrap.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteMauPreset(Number(btn.dataset.del));
    });
  });
  renderMauTable();
}

// ---------- Cài đặt: Mẫu chuyển tiền (bảng sửa trực tiếp) ----------
function mauAccountOptionsHtml(selectedIdx) {
  let html = `<option value="">— Chọn tài khoản —</option>`;
  html += state.accounts
    .map((a, i) => {
      const bank = a.data__shortName || a.data__name || a.data__code || "?";
      const label = `${a.list_name || "(chưa đặt tên)"} — ${a.data_num || "?"} (${bank})${a.hidden ? " (Đã ẩn)" : ""}`;
      return `<option value="${i}" ${i === selectedIdx ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
  return html;
}
function mauAccountSelectedLabel(selectedIdx) {
  const a = state.accounts[selectedIdx];
  if (!a) return "— Chọn tài khoản —";
  const bank = a.data__shortName || a.data__name || a.data__code || "?";
  return `${a.list_name || "(chưa đặt tên)"} — ${a.data_num || "?"} (${bank})${a.hidden ? " (Đã ẩn)" : ""}`;
}
function mauTemplateOptionsHtml(selectedValue) {
  const known = state.templates.some((t) => t.value === selectedValue);
  let html = !selectedValue || !known ? `<option value="" ${!selectedValue ? "selected" : ""}>— Chọn mẫu hiển thị —</option>` : "";
  html += state.templates
    .map((t) => `<option value="${escapeAttr(t.value)}" ${t.value === selectedValue ? "selected" : ""}>${escapeHtml(t.label)}</option>`)
    .join("");
  return html;
}
function renderMauTable() {
  const body = $("#mauTableBody");
  if (!body) return;
  if (!state.accounts.length) {
    showToast('Chưa có tài khoản nào — thêm ở tab "Tài khoản" trước khi tạo mẫu chuyển tiền.', "err");
  }
  body.innerHTML = "";
  state.presets.forEach((p, idx) => {
    const acc = findAccountForPreset(p);
    const accIdx = acc ? state.accounts.indexOf(acc) : -1;
    const isAdhoc = !acc && p.bankCode && p.accountNum;
    const unresolved = !acc && !isAdhoc && (p.accountName || p.accountNum);
    const tplUnresolved = p.template && !state.templates.some((t) => t.value === p.template);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="stt-cell">${idx + 1}</td>
      <td data-label="Tên mẫu"><input data-mau-idx="${idx}" data-mau-field="name" value="${escapeAttr(p.name || "")}" title="${escapeAttr(p.name || "")}"></td>
      <td data-label="Tài khoản">
        <select data-mau-idx="${idx}" data-mau-field="accountSelect" class="${unresolved ? "input-err" : ""}" title="${unresolved ? "Không khớp tài khoản nào đã lưu — chọn lại" : escapeAttr(mauAccountSelectedLabel(accIdx))}">
          ${mauAccountOptionsHtml(accIdx)}
        </select>
      </td>
      <td data-label="Số tiền"><input data-mau-idx="${idx}" data-mau-field="amount" inputmode="numeric" value="${escapeAttr(p.amount || "")}"></td>
      <td data-label="Nội dung"><input data-mau-idx="${idx}" data-mau-field="content" value="${escapeAttr(p.content || "")}" title="${escapeAttr(p.content || "")}"></td>
      <td data-label="Mẫu hiển thị">
        <select data-mau-idx="${idx}" data-mau-field="templateSelect" class="${tplUnresolved ? "input-err" : ""}" title="${tplUnresolved ? "Mẫu hiển thị này không còn tồn tại — chọn lại" : ""}">
          ${mauTemplateOptionsHtml(p.template)}
        </select>
      </td>
      <td class="row-actions">
        <button class="icon-btn order-btn" title="Đưa lên trên" data-mau-move="${idx}" data-dir="-1" ${idx === 0 ? "disabled" : ""}>▲</button>
        <button class="icon-btn order-btn" title="Đưa xuống dưới" data-mau-move="${idx}" data-dir="1" ${idx === state.presets.length - 1 ? "disabled" : ""}>▼</button>
        <button class="icon-btn" title="Xoá dòng" data-mau-tbl-del="${idx}">✕</button>
      </td>`;
    body.appendChild(tr);
  });
  const countEl = $("#mauSettingsCount");
  if (countEl) countEl.textContent = `${state.presets.length} mẫu`;

  body.querySelectorAll("input[data-mau-field]").forEach((input) => {
    input.addEventListener("input", (e) => {
      const idx = Number(e.target.dataset.mauIdx);
      const field = e.target.dataset.mauField;
      const preset = state.presets[idx];
      if (!preset) return;
      preset[field] = field === "amount" ? Number(rawNumber(e.target.value)) || 0 : e.target.value;
      savePresetsCache();
      markDirty("presets");
    });
  });
  body.querySelectorAll("select[data-mau-field='accountSelect']").forEach((sel) => {
    sel.addEventListener("change", (e) => {
      const idx = Number(e.target.dataset.mauIdx);
      const preset = state.presets[idx];
      if (!preset) return;
      const val = e.target.value;
      const acc = val === "" ? null : state.accounts[Number(val)];
      preset.accountName = acc ? acc.list_name : "";
      preset.accountNum = acc ? acc.data_num : "";
      savePresetsCache();
      markDirty("presets");
      renderMauTable();
    });
  });
  body.querySelectorAll("select[data-mau-field='templateSelect']").forEach((sel) => {
    sel.addEventListener("change", (e) => {
      const idx = Number(e.target.dataset.mauIdx);
      const preset = state.presets[idx];
      if (!preset) return;
      preset.template = e.target.value;
      savePresetsCache();
      markDirty("presets");
      renderMauTable();
    });
  });
  body.querySelectorAll("[data-mau-move]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.currentTarget.dataset.mauMove);
      const dir = Number(e.currentTarget.dataset.dir);
      movePresetRow(idx, dir);
    });
  });
  body.querySelectorAll("[data-mau-tbl-del]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.target.dataset.mauTblDel);
      deleteMauPreset(idx);
    });
  });
}
function renderVietqrBanksTable(filter) {
  const body = $("#vietqrBanksTableBody");
  if (!body) return;
  const q = (filter || $("#vietqrBankSearch")?.value || "").trim().toLowerCase();
  const list = !q
    ? state.refBanks
    : state.refBanks.filter((b) =>
        `${b.shortName || ""} ${b.name || ""} ${b.code || ""} ${b.bin || ""}`.toLowerCase().includes(q)
      );
  body.innerHTML = "";
  const yesNo = (v) => (v ? "✓" : "—");
  list.forEach((b, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="stt-cell">${idx + 1}</td>
      <td>${b.logo ? `<img src="${escapeAttr(b.logo)}" alt="" style="width:24px;height:24px;object-fit:contain;border-radius:4px;">` : ""}</td>
      <td data-label="Tên ngân hàng">${escapeHtml(b.shortName || b.short_name || b.name || "")}</td>
      <td data-label="Tên đầy đủ" title="${escapeAttr(b.name || "")}">${escapeHtml(b.name || "")}</td>
      <td data-label="Mã">${escapeHtml(b.code || "")}</td>
      <td data-label="BIN">${escapeHtml(b.bin || "")}</td>
      <td data-label="Swift">${escapeHtml(b.swift_code || "")}</td>
      <td data-label="Chuyển" class="cell-center">${yesNo(b.transferSupported)}</td>
      <td data-label="Tra cứu" class="cell-center">${yesNo(b.lookupSupported)}</td>`;
    body.appendChild(tr);
  });
  const countEl = $("#vietqrBanksCount");
  if (countEl) countEl.textContent = `${state.refBanks.length} ngân hàng`;
}
async function refreshVietqrBanksTab() {
  await refreshRefBanksFromVietQR();
  renderVietqrBanksTable();
}

function addMauRow() {
  state.presets.push({ name: "", accountName: "", accountNum: "", amount: 0, content: "", template: "" });
  savePresetsCache();
  markDirty("presets");
  renderMauList();
  const inputs = $("#mauTableBody").querySelectorAll("input[data-mau-field='name']");
  const last = inputs[inputs.length - 1];
  if (last) last.focus();
}
// So sánh số tiền/nội dung/mẫu hiển thị đang nhập trên form với giá trị đã
// lưu trong mẫu (preset) đang được chọn — chỉ khi có khác biệt mới cần hiện
// nút "Cập nhật mẫu" (đổi tài khoản không tính ở đây, vì đổi tài khoản sẽ
// tự động thoát mẫu, xem checkPresetAccountMismatch()).
function presetFormDiffers(preset) {
  if (!preset) return false;
  const amount = Number(rawNumber($("#qrAmount").value)) || 0;
  const content = $("#qrContent").value.trim();
  const template = $("#qrTemplate").value;
  const presetAmount = Number(preset.amount) || 0;
  const presetContent = (preset.content || "").trim();
  const presetTemplate = preset.template || "";
  return amount !== presetAmount || content !== presetContent || template !== presetTemplate;
}
function updateMauActiveUi() {
  const tag = $("#mauActiveTag");
  const nameEl = $("#mauActiveName");
  const updateBtn = $("#btnUpdatePreset");
  if (!tag || !nameEl || !updateBtn) return;
  if (state.selectedPresetIdx != null && state.presets[state.selectedPresetIdx]) {
    const preset = state.presets[state.selectedPresetIdx];
    tag.hidden = false;
    nameEl.textContent = preset.name || `Mẫu ${state.selectedPresetIdx + 1}`;
    // Chỉ hiện nút "Cập nhật mẫu" khi số tiền/nội dung/mẫu hiển thị đã bị
    // đổi khác so với mẫu đang chọn — tránh hiện nút thừa ngay sau khi vừa chọn mẫu.
    updateBtn.hidden = !presetFormDiffers(preset);
  } else {
    tag.hidden = true;
    updateBtn.hidden = true;
  }
}
function clearActivePreset(opts) {
  if (state.selectedPresetIdx == null) return;
  state.selectedPresetIdx = null;
  renderMauList();
  updateMauActiveUi();
  saveFormState();
  if (!(opts && opts.silent)) {
    showToast((opts && opts.message) || "Đã bỏ chọn mẫu — số tiền/nội dung đang nhập không còn gắn với mẫu nào.", "ok");
  }
}
// Khi đang chọn 1 mẫu mà người dùng đổi sang tài khoản KHÁC với tài khoản
// của mẫu đó (qua dropdown "Tài khoản" trên form chính) — tự động thoát khỏi
// mẫu đang chọn, vì mẫu giờ không còn khớp với tài khoản đang dùng nữa.
function checkPresetAccountMismatch() {
  if (state.selectedPresetIdx == null) return;
  const preset = state.presets[state.selectedPresetIdx];
  if (!preset) return;
  const presetAcc = findAccountForPreset(preset);
  // Mẫu chưa khớp được tài khoản đã lưu nào (vd. mẫu "QR cho người khác") — không có gì để so sánh.
  if (!presetAcc) return;
  const idx = Number($("#qrAccount").value);
  const acc = state.accounts[idx];
  if (acc !== presetAcc) {
    clearActivePreset({ message: `Đã đổi tài khoản khác — thoát khỏi mẫu "${preset.name || `Mẫu ${state.selectedPresetIdx + 1}`}".` });
  }
}
function applyPresetToForm(preset) {
  const acc = findAccountForPreset(preset);
  if (acc) {
    $("#qrAccount").value = state.accounts.indexOf(acc);
  } else if (preset.bankCode && preset.accountNum) {
    // Mẫu tạo từ tab "QR cho người khác" — tài khoản không nằm trong danh
    // sách "Tài khoản" đã lưu, áp thẳng vào tab đó thay vì tab chính.
    applyPresetToAdhocForm(preset);
    switchWorkspaceTab("adhoc");
    return;
  } else if (preset.accountName) {
    showToast(`Không tìm thấy tài khoản "${preset.accountName}" cho mẫu này — giữ nguyên tài khoản đang chọn.`, "err");
  }
  if (preset.amount != null && preset.amount !== "") {
    $("#qrAmount").value = formatNumber(preset.amount);
  }
  if (preset.content != null) {
    $("#qrContent").value = preset.content;
    updateContentCounter(String(preset.content).trim());
  }
  if (preset.template) {
    $("#qrTemplate").value = preset.template;
  }
  $$("#quickAmounts .chip").forEach((c) => c.classList.remove("active"));
  switchWorkspaceTab("qr");
  onGenerateQr(null, { silent: true });
}
function selectMau(idx) {
  const preset = state.presets[idx];
  if (!preset) return;
  state.selectedPresetIdx = idx;
  applyPresetToForm(preset);
  renderMauList();
  updateMauActiveUi();
  saveFormState();
}
function deleteMauPreset(idx) {
  const removed = state.presets[idx];
  const name = removed.name || `Mẫu ${idx + 1}`;
  showConfirm(`Xoá mẫu "${name}"?`, "Xoá").then((ok) => {
    if (!ok) return;
    state.presets.splice(idx, 1);
    if (state.selectedPresetIdx === idx) {
      state.selectedPresetIdx = null;
    } else if (state.selectedPresetIdx != null && state.selectedPresetIdx > idx) {
      state.selectedPresetIdx -= 1;
    }
    savePresetsCache();
    markDirty("presets");
    renderMauList();
    updateMauActiveUi();
    saveFormState();
    showToast(`Đã xoá "${name}"`, "ok");
  });
}

function movePresetRow(idx, dir) {
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= state.presets.length) return;
  const tmp = state.presets[idx];
  state.presets[idx] = state.presets[newIdx];
  state.presets[newIdx] = tmp;
  // Giữ đúng mẫu đang được chọn (nếu có) đi theo vị trí mới sau khi đảo chỗ.
  if (state.selectedPresetIdx === idx) state.selectedPresetIdx = newIdx;
  else if (state.selectedPresetIdx === newIdx) state.selectedPresetIdx = idx;
  savePresetsCache();
  markDirty("presets");
  renderMauTable();
}
function saveCurrentFormAsPreset() {
  const idx = Number($("#qrAccount").value);
  const acc = state.accounts[idx];
  const defaultName = $("#qrContent").value.trim() || (acc ? acc.list_name : "Mẫu mới");
  const name = window.prompt("Tên mẫu chuyển tiền:", defaultName);
  if (name == null) return;
  const trimmed = name.trim();
  if (!trimmed) {
    showToast("Tên mẫu không được để trống", "err");
    return;
  }
  state.presets.push({
    name: trimmed,
    accountName: acc ? acc.list_name : "",
    accountNum: acc ? acc.data_num : "",
    amount: Number(rawNumber($("#qrAmount").value)) || 0,
    content: $("#qrContent").value.trim(),
    template: $("#qrTemplate").value,
  });
  savePresetsCache();
  markDirty("presets");
  state.selectedPresetIdx = state.presets.length - 1;
  renderMauList();
  updateMauActiveUi();
  saveFormState();
  showToast(`Đã lưu mẫu "${trimmed}"`, "ok");
}

function updateSelectedPreset() {
  if (state.selectedPresetIdx == null) return;
  const preset = state.presets[state.selectedPresetIdx];
  if (!preset) return;
  const idx = Number($("#qrAccount").value);
  const acc = state.accounts[idx];
  preset.accountName = acc ? acc.list_name : preset.accountName;
  preset.accountNum = acc ? acc.data_num : preset.accountNum;
  preset.amount = Number(rawNumber($("#qrAmount").value)) || 0;
  preset.content = $("#qrContent").value.trim();
  preset.template = $("#qrTemplate").value;
  savePresetsCache();
  markDirty("presets");
  renderMauList();
  updateMauActiveUi();
  showToast(`Đã cập nhật mẫu "${preset.name}"`, "ok");
}
function populateQrAccounts() {
  const sel = $("#qrAccount");
  const prev = sel.value;
  sel.innerHTML = state.accounts
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => !a.hidden)
    .map(({ a, i }) => `<option value="${i}">${escapeHtml(a.list_name)} — ${escapeHtml(a.data_num)} (${escapeHtml(a.data__code)})</option>`)
    .join("");
  if (prev && state.accounts[Number(prev)] && !state.accounts[Number(prev)].hidden) {
    sel.value = prev;
  } else {
    applyDefaults();
  }
  updateCustomSelectTriggerLabel(sel);
}
function buildQrUrlRaw(bankCode, accNum, amount, content, template, accountName) {
  const base = `https://img.vietqr.io/image/${encodeURIComponent(bankCode)}-${encodeURIComponent(accNum)}-${encodeURIComponent(
    template
  )}.png`;
  const params = new URLSearchParams();
  if (amount) params.set("amount", amount);
  if (content) params.set("addInfo", content);
  if (accountName) params.set("accountName", accountName);
  return `${base}?${params.toString()}`;
}
function buildQrUrl(acc, amount, content, template) {
  return buildQrUrlRaw(acc.data__code, acc.data_num, amount, content, template, acc.name_ac);
}

let qrActiveLayer = "A";
function validateAmount(rawAmount) {
  const el = $("#qrAmountWarning");
  if (!rawAmount) {
    el.hidden = true;
    return true;
  }
  const n = Number(rawAmount);
  if (n <= 0) {
    el.textContent = "Số tiền phải lớn hơn 0.";
    el.hidden = false;
    return false;
  }
  if (n > AMOUNT_WARN_THRESHOLD) {
    el.textContent = `Số tiền khá lớn (${formatNumber(n)}đ) — kiểm tra lại trước khi gửi.`;
    el.hidden = false;
    return true;
  }
  el.hidden = true;
  return true;
}
function updateContentCounter(content) {
  const counter = $("#qrContentCounter");
  if (counter) {
    const len = content.length;
    counter.textContent = `${len}/${ADDINFO_SOFT_LIMIT}`;
    counter.className = "field-counter" + (len > ADDINFO_SOFT_LIMIT ? " err" : len > ADDINFO_SOFT_LIMIT - 5 ? " warn" : "");
  }
  updateContentPreview(content);
}
// Ô nhập nội dung có bề rộng cố định — khi gõ nội dung dài, phần đầu/giữa
// chuỗi có thể bị cuộn khuất khỏi tầm nhìn. Hiển thị thêm 1 dòng xem trước
// đầy đủ (wrap xuống dòng) bên dưới ô nhập để luôn thấy trọn nội dung, và
// đồng thời gắn "title" để hiện tooltip đầy đủ khi rê chuột vào ô nhập.
function updateContentPreview(content) {
  const input = $("#qrContent");
  const preview = $("#qrContentPreview");
  if (input) input.title = content || "";
  if (!preview) return;
  const overflowing = input && input.scrollWidth > input.clientWidth + 1;
  if (content && overflowing) {
    preview.textContent = content;
    preview.hidden = false;
  } else {
    preview.textContent = "";
    preview.hidden = true;
  }
}

// ---------- Gợi ý số tiền theo con số đang gõ ----------
const AMOUNT_SUGGEST_MULTIPLIERS = [1000, 10000, 100000];
const AMOUNT_SUGGEST_CAP = 1_000_000_000;
function computeAmountSuggestions(rawAmount) {
  if (!rawAmount || rawAmount.length > 3) return [];
  const n = Number(rawAmount);
  if (!n) return [];
  const seen = new Set();
  const list = [];
  AMOUNT_SUGGEST_MULTIPLIERS.forEach((m) => {
    const v = n * m;
    if (v > AMOUNT_SUGGEST_CAP || seen.has(v)) return;
    seen.add(v);
    list.push(v);
  });
  return list;
}
function renderAmountSuggestions() {
  const sugWrap = $("#suggestAmounts");
  const staticWrap = $("#quickAmounts");
  if (!sugWrap || !staticWrap) return;
  const raw = rawNumber($("#qrAmount").value);
  const list = computeAmountSuggestions(raw);

  if (!list.length) {
    sugWrap.hidden = true;
    sugWrap.innerHTML = "";
    staticWrap.hidden = false;
    return;
  }

  staticWrap.hidden = true;
  sugWrap.hidden = false;
  sugWrap.innerHTML =
    `<span class="suggest-label">Gợi ý</span>` +
    list.map((v) => `<button type="button" class="chip suggest" data-val="${v}">${formatNumber(v)}đ</button>`).join("");

  sugWrap.querySelectorAll(".chip[data-val]").forEach((chip) => {
    chip.addEventListener("click", () => {
      $("#qrAmount").value = formatNumber(chip.dataset.val);
      sugWrap.hidden = true;
      staticWrap.hidden = false;
      $$("#quickAmounts .chip").forEach((c) => c.classList.remove("active"));
      onGenerateQr(null, { silent: true });
    });
  });
}

// ---------- Gợi ý nội dung chuyển khoản: combobox ----------
function renderContentSuggestions() {
  const wrap = $("#contentSuggestions");
  const toggle = $("#btnContentSuggestToggle");
  if (!wrap || !toggle) return;
  if (!state.content.length) {
    toggle.hidden = true;
    wrap.hidden = true;
    wrap.innerHTML = "";
    return;
  }
  toggle.hidden = false;
  wrap.innerHTML = state.content.map((c) => {
    const isDefault = isDefaultContent(c);
    return `<div class="combo-row">
      <button type="button" class="combo-item" data-content="${escapeAttr(c)}">${escapeHtml(c)}</button>
      <button type="button" class="icon-btn combo-star${isDefault ? " is-default" : ""}" title="${isDefault ? "Đang là nội dung mặc định — bấm để bỏ" : "Đặt làm nội dung mặc định"}" data-star-content="${escapeAttr(c)}">${isDefault ? "★" : "☆"}</button>
    </div>`;
  }).join("");
  wrap.querySelectorAll(".combo-item[data-content]").forEach((item) => {
    item.addEventListener("click", () => {
      $("#qrContent").value = item.dataset.content;
      updateContentCounter(item.dataset.content.trim());
      closeContentSuggestions();
      onGenerateQr(null, { silent: true });
    });
  });
  wrap.querySelectorAll("[data-star-content]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setDefaultContent(btn.dataset.starContent);
    });
  });
}
function openContentSuggestions() {
  const wrap = $("#contentSuggestions");
  if (!wrap || !wrap.innerHTML.trim()) return;
  wrap.hidden = false;
}
function closeContentSuggestions() {
  const wrap = $("#contentSuggestions");
  if (wrap) wrap.hidden = true;
}
function toggleContentSuggestions() {
  const wrap = $("#contentSuggestions");
  if (!wrap) return;
  if (wrap.hidden) openContentSuggestions();
  else closeContentSuggestions();
}

// Nút "Xoá thông tin" — trả form về trạng thái trống: xoá số tiền/nội dung
// đang nhập, bỏ chọn mẫu đang gắn (nếu có). Không cần lưu trạng thái này lại
// để khôi phục sau F5 nữa — trang giờ luôn mở lên ở trạng thái mặc định
// (tài khoản & mẫu hiển thị mặc định, số tiền/nội dung trống) mỗi lần tải lại.
function clearQrForm() {
  $("#qrAmount").value = "";
  $("#qrContent").value = "";
  $$("#quickAmounts .chip").forEach((c) => c.classList.remove("active"));
  updateContentCounter("");
  validateAmount("");
  clearActivePreset({ silent: true });
  $("#qrCard").hidden = true;
  $("#qrEmpty").hidden = false;
  $("#qrActions").hidden = true;
  $("#qrContent").focus();
  showToast("Đã xoá thông tin đang nhập", "ok");
}
// ---------- Ảnh QR dự phòng cục bộ (khi img.vietqr.io bị nghẽn/gián đoạn) ----------
// Nếu ảnh QR động từ img.vietqr.io tải lỗi, thử tải ảnh QR TĨNH đã lưu sẵn
// trong thư mục qr-fallback/ (người dùng tự tạo lúc API còn chạy tốt rồi
// upload lên, xem qr-fallback/README.md), đặt tên theo "MãNgânHàng-SốTK.png".
// Ảnh dự phòng là ảnh tĩnh nên có thể không khớp đúng số tiền/nội dung vừa
// nhập — báo rõ cho người dùng biết bằng toast màu vàng khi phải dùng tới nó.
const QR_FALLBACK_DIR = "qr-fallback/";
function qrFallbackUrl(bankCode, accNum) {
  return `${QR_FALLBACK_DIR}${encodeURIComponent(bankCode || "")}-${encodeURIComponent(accNum || "")}.png`;
}
function onGenerateQr(e, opts) {
  if (e) e.preventDefault();
  const silent = opts && opts.silent;
  const idx = Number($("#qrAccount").value);
  const acc = state.accounts[idx];
  if (!acc) {
    if (!silent) alert("Chưa có tài khoản nào — thêm ở tab Danh sách tài khoản trước.");
    return;
  }
  const amount = rawNumber($("#qrAmount").value);
  const content = $("#qrContent").value.trim();
  const template = $("#qrTemplate").value;

  updateContentCounter(content);
  validateAmount(amount);
  updateCustomSelectTriggerLabel($("#qrAccount"));
  updateCustomSelectTriggerLabel($("#qrTemplate"));

  const url = buildQrUrl(acc, amount, content, template);

  const qrCard = $("#qrCard");
  const layerNext = qrActiveLayer === "A" ? "B" : "A";
  const imgNext = $(`#qrImage${layerNext}`);
  const imgCur = $(`#qrImage${qrActiveLayer}`);

  qrCard.classList.add("loading");
  imgNext.onload = () => {
    qrCard.classList.remove("loading");
    imgNext.classList.add("visible");
    imgCur.classList.remove("visible");
    qrActiveLayer = layerNext;
  };
  imgNext.onerror = () => {
    // Ảnh động lỗi (img.vietqr.io gián đoạn) — thử ảnh dự phòng tĩnh trong
    // qr-fallback/ trước khi báo lỗi hẳn.
    const fallbackUrl = qrFallbackUrl(acc.data__code, acc.data_num);
    imgNext.onload = () => {
      qrCard.classList.remove("loading");
      imgNext.classList.add("visible");
      imgCur.classList.remove("visible");
      qrActiveLayer = layerNext;
      // Ảnh dự phòng đang hiển thị — trỏ luôn nút tải/mở/copy link về ảnh
      // này, tránh bấm vào lại ra link ảnh động đang lỗi.
      $("#btnDownload").href = fallbackUrl;
      $("#btnOpenLink").href = fallbackUrl;
      $("#btnCopyLink").dataset.url = fallbackUrl;
      showToast("img.vietqr.io đang gián đoạn — đang dùng ảnh QR dự phòng đã lưu sẵn (có thể không khớp đúng số tiền/nội dung vừa nhập).", "warn", { duration: 5000 });
    };
    imgNext.onerror = () => {
      qrCard.classList.remove("loading");
      showToast("Không tải được ảnh QR — img.vietqr.io có thể đang gián đoạn, và cũng chưa có ảnh dự phòng cho tài khoản này trong qr-fallback/.", "err");
    };
    imgNext.src = fallbackUrl;
  };
  imgNext.src = url;
  $("#qrCardBank").textContent = acc.data__name || acc.data__code;

  $("#qrCard").hidden = false;
  $("#qrEmpty").hidden = true;
  $("#qrActions").hidden = false;
  $("#btnDownload").href = url;
  $("#btnOpenLink").href = url;
  $("#btnCopyLink").dataset.url = url;

  restartAnimation($("#qrCard"));
  saveFormState();
}

// ---------- Tab "QR cho người khác" — nhập tay ngân hàng/số TK, không cần có
// sẵn trong danh sách "Tài khoản" ----------
let adhocBank = null;
let adhocQrActiveLayer = "A";

function adhocBankLabel(bank) {
  if (!bank) return "";
  return `${bank.shortName || bank.short_name || bank.name || ""} — ${bank.code || ""}`;
}
function selectAdhocBank(code) {
  const bank = state.refBanks.find((b) => b.code === code);
  if (!bank) return;
  adhocBank = bank;
  const input = $("#adhocBankInput");
  if (input) input.value = adhocBankLabel(bank);
  generateAdhocQr({ silent: true });
}
function setupAdhocBankInput() {
  const input = $("#adhocBankInput");
  if (!input || input._adhocBound) return;
  input._adhocBound = true;
  input.addEventListener("focus", () => openBankPicker("adhoc", input));
  input.addEventListener("click", () => openBankPicker("adhoc", input));
  input.addEventListener("input", (e) => renderBankPickerList("adhoc", e.target.value));
  input.addEventListener("blur", () => {
    input.value = adhocBankLabel(adhocBank);
  });
}
function generateAdhocQr(opts) {
  const silent = opts && opts.silent;
  const accNum = $("#adhocAccountNum").value.trim();
  if (!adhocBank || !accNum) {
    if (!silent) showToast("Chọn ngân hàng và nhập số tài khoản trước.", "err");
    return;
  }
  const amount = rawNumber($("#adhocAmount").value);
  const content = $("#adhocContent").value.trim();
  const template = $("#adhocTemplate").value || (state.templates[0] && state.templates[0].value) || "compact2";
  const accountName = $("#adhocAccountName").value.trim();

  validateAdhocAmount(amount);
  updateCustomSelectTriggerLabel($("#adhocTemplate"));

  const url = buildQrUrlRaw(adhocBank.code, accNum, amount, content, template, accountName);

  const qrCard = $("#adhocQrCard");
  const layerNext = adhocQrActiveLayer === "A" ? "B" : "A";
  const imgNext = $(`#adhocQrImage${layerNext}`);
  const imgCur = $(`#adhocQrImage${adhocQrActiveLayer}`);

  qrCard.classList.add("loading");
  imgNext.onload = () => {
    qrCard.classList.remove("loading");
    imgNext.classList.add("visible");
    imgCur.classList.remove("visible");
    adhocQrActiveLayer = layerNext;
  };
  imgNext.onerror = () => {
    const fallbackUrl = qrFallbackUrl(adhocBank.code, accNum);
    imgNext.onload = () => {
      qrCard.classList.remove("loading");
      imgNext.classList.add("visible");
      imgCur.classList.remove("visible");
      adhocQrActiveLayer = layerNext;
      $("#adhocBtnDownload").href = fallbackUrl;
      $("#adhocBtnOpenLink").href = fallbackUrl;
      $("#adhocBtnCopyLink").dataset.url = fallbackUrl;
      showToast("img.vietqr.io đang gián đoạn — đang dùng ảnh QR dự phòng đã lưu sẵn (có thể không khớp đúng số tiền/nội dung vừa nhập).", "warn", { duration: 5000 });
    };
    imgNext.onerror = () => {
      qrCard.classList.remove("loading");
      showToast("Không tải được ảnh QR — img.vietqr.io có thể đang gián đoạn, và cũng chưa có ảnh dự phòng cho tài khoản này trong qr-fallback/.", "err");
    };
    imgNext.src = fallbackUrl;
  };
  imgNext.src = url;
  $("#adhocQrCardBank").textContent = adhocBank.shortName || adhocBank.name || adhocBank.code;

  $("#adhocQrCard").hidden = false;
  $("#adhocQrEmpty").hidden = true;
  $("#adhocQrActions").hidden = false;
  $("#adhocBtnDownload").href = url;
  $("#adhocBtnOpenLink").href = url;
  $("#adhocBtnCopyLink").dataset.url = url;

  restartAnimation($("#adhocQrCard"));
}
function validateAdhocAmount(rawAmount) {
  const n = Number(rawAmount);
  if (rawAmount && n > AMOUNT_WARN_THRESHOLD) {
    showToast(`Số tiền khá lớn (${formatNumber(n)}đ) — kiểm tra lại trước khi gửi.`, "err");
  }
}
function saveAdhocAsAccount() {
  if (!adhocBank) {
    showToast("Chọn ngân hàng trước.", "err");
    return;
  }
  const accNum = $("#adhocAccountNum").value.trim();
  if (!accNum) {
    showToast("Nhập số tài khoản trước.", "err");
    return;
  }
  const accountName = $("#adhocAccountName").value.trim();
  const defaultNick = accountName || `${adhocBank.shortName || adhocBank.code} — ${accNum}`;
  const nick = window.prompt("Tên gợi nhớ cho tài khoản này:", defaultNick);
  if (nick == null) return;
  const trimmed = nick.trim();
  if (!trimmed) {
    showToast("Tên gợi nhớ không được để trống", "err");
    return;
  }
  state.accounts.push({
    data__id: adhocBank.id || 0,
    list_name: trimmed,
    data_num: accNum,
    name_ac: accountName,
    data__name: adhocBank.shortName || adhocBank.name || "",
    data__code: adhocBank.code || "",
    data__bin: adhocBank.bin || "",
    data__shortName: adhocBank.shortName || "",
    data__logo: adhocBank.logo || "",
    data__short_name: adhocBank.short_name || "",
    hidden: false,
    isDefault: false,
  });
  renumberAccountsStt();
  markDirty("accounts");
  populateQrAccounts();
  showToast(`Đã thêm "${trimmed}" vào danh sách tài khoản — vào Cài đặt ▸ Tài khoản để lưu lên GitHub.`, "ok", { duration: 3600 });
}
function saveAdhocAsPreset() {
  if (!adhocBank) {
    showToast("Chọn ngân hàng trước.", "err");
    return;
  }
  const accNum = $("#adhocAccountNum").value.trim();
  if (!accNum) {
    showToast("Nhập số tài khoản trước.", "err");
    return;
  }
  const accountName = $("#adhocAccountName").value.trim();
  const defaultName = $("#adhocContent").value.trim() || accountName || `${adhocBank.shortName || adhocBank.code} — ${accNum}`;
  const name = window.prompt("Tên mẫu chuyển tiền:", defaultName);
  if (name == null) return;
  const trimmed = name.trim();
  if (!trimmed) {
    showToast("Tên mẫu không được để trống", "err");
    return;
  }
  // Mẫu lưu trực tiếp bankCode + accountNum — không cần tài khoản này có
  // trong danh sách "Tài khoản" đã lưu (khác với mẫu tạo từ tab "Tạo giao
  // dịch", vốn chỉ tham chiếu tới 1 tài khoản đã lưu qua accountName/accountNum).
  state.presets.push({
    name: trimmed,
    accountName: accountName,
    accountNum: accNum,
    bankCode: adhocBank.code,
    amount: Number(rawNumber($("#adhocAmount").value)) || 0,
    content: $("#adhocContent").value.trim(),
    template: $("#adhocTemplate").value,
  });
  savePresetsCache();
  markDirty("presets");
  renderMauList();
  showToast(`Đã lưu mẫu "${trimmed}"`, "ok");
}
function applyPresetToAdhocForm(preset) {
  const bank = state.refBanks.find((b) => b.code === preset.bankCode);
  adhocBank = bank || { code: preset.bankCode, shortName: preset.bankCode };
  const input = $("#adhocBankInput");
  if (input) input.value = adhocBankLabel(adhocBank);
  $("#adhocAccountNum").value = preset.accountNum || "";
  $("#adhocAccountName").value = preset.accountName || "";
  $("#adhocAmount").value = preset.amount != null && preset.amount !== "" ? formatNumber(preset.amount) : "";
  $("#adhocContent").value = preset.content || "";
  if (preset.template) $("#adhocTemplate").value = preset.template;
  updateCustomSelectTriggerLabel($("#adhocTemplate"));
  generateAdhocQr({ silent: true });
}

// ---------- Cài đặt: Nội dung chuyển khoản (bảng quản lý) ----------
function renderContentTable() {
  const body = $("#contentTableBody");
  if (!body) return;
  body.innerHTML = "";
  state.content.forEach((text, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="stt-cell">${idx + 1}</td>
      <td class="row-actions">
        <button class="icon-btn order-btn" title="Đưa lên trên" data-content-move="${idx}" data-dir="-1" ${idx === 0 ? "disabled" : ""}>▲</button>
        <button class="icon-btn order-btn" title="Đưa xuống dưới" data-content-move="${idx}" data-dir="1" ${idx === state.content.length - 1 ? "disabled" : ""}>▼</button>
        <button class="icon-btn" title="Xoá dòng" data-content-del="${idx}">✕</button>
      </td>`;
    body.appendChild(tr);
  });
  const countEl = $("#contentCount");
  if (countEl) countEl.textContent = `${state.content.length} dòng`;

  body.querySelectorAll("input[data-content-idx]").forEach((input) => {
    input.addEventListener("input", (e) => {
      const idx = Number(e.target.dataset.contentIdx);
      state.content[idx] = e.target.value;
      saveContentCache();
      markDirty("content");
      renderContentSuggestions();
    });
  });
  body.querySelectorAll("[data-content-move]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.currentTarget.dataset.contentMove);
      const dir = Number(e.currentTarget.dataset.dir);
      moveContentRow(idx, dir);
    });
  });
  body.querySelectorAll("[data-content-del]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const idx = Number(e.target.dataset.contentDel);
      const removed = state.content[idx];
      const ok = await showConfirm(`Xoá nội dung "${removed}"?`, "Xoá");
      if (!ok) return;
      state.content.splice(idx, 1);
      saveContentCache();
      markDirty("content");
      renderContentTable();
      renderContentSuggestions();
      showToast(`Đã xoá "${removed}"`, "ok");
    });
  });
}
function moveContentRow(idx, dir) {
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= state.content.length) return;
  const tmp = state.content[idx];
  state.content[idx] = state.content[newIdx];
  state.content[newIdx] = tmp;
  saveContentCache();
  markDirty("content");
  renderContentTable();
  renderContentSuggestions();
}
function addContentRow() {
  state.content.push("");
  saveContentCache();
  markDirty("content");
  renderContentTable();
  const inputs = $("#contentTableBody").querySelectorAll("input[data-content-idx]");
  const last = inputs[inputs.length - 1];
  if (last) last.focus();
}

// ---------- Cài đặt: Số tiền gợi ý (bảng quản lý) ----------
function renderAmountsTable() {
  const body = $("#amountsTableBody");
  if (!body) return;
  body.innerHTML = "";
  state.amounts.forEach((amount, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="stt-cell">${idx + 1}</td>
      <td data-label="Số tiền gợi ý (đ)"><input data-amount-idx="${idx}" inputmode="numeric" value="${escapeAttr(formatNumber(amount))}" title="${escapeAttr(formatNumber(amount))}"></td>
      <td class="row-actions">
        <button class="icon-btn order-btn" title="Đưa lên trên" data-amount-move="${idx}" data-dir="-1" ${idx === 0 ? "disabled" : ""}>▲</button>
        <button class="icon-btn order-btn" title="Đưa xuống dưới" data-amount-move="${idx}" data-dir="1" ${idx === state.amounts.length - 1 ? "disabled" : ""}>▼</button>
        <button class="icon-btn" title="Xoá dòng" data-amount-del="${idx}">✕</button>
      </td>`;
    body.appendChild(tr);
  });
  const countEl = $("#amountsCount");
  if (countEl) countEl.textContent = `${state.amounts.length} dòng`;

  body.querySelectorAll("input[data-amount-idx]").forEach((input) => {
    input.addEventListener("input", (e) => {
      e.target.value = formatNumber(e.target.value);
      e.target.title = e.target.value;
      const idx = Number(e.target.dataset.amountIdx);
      state.amounts[idx] = Number(rawNumber(e.target.value)) || 0;
      saveAmountsCache();
      markDirty("amounts");
      renderQuickAmountsChips();
    });
  });
  body.querySelectorAll("[data-amount-move]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.currentTarget.dataset.amountMove);
      const dir = Number(e.currentTarget.dataset.dir);
      moveAmountRow(idx, dir);
    });
  });
  body.querySelectorAll("[data-amount-del]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const idx = Number(e.target.dataset.amountDel);
      const removed = state.amounts[idx];
      const ok = await showConfirm(`Xoá số tiền gợi ý ${formatNumber(removed)}đ?`, "Xoá");
      if (!ok) return;
      state.amounts.splice(idx, 1);
      saveAmountsCache();
      markDirty("amounts");
      renderAmountsTable();
      renderQuickAmountsChips();
      showToast(`Đã xoá ${formatNumber(removed)}đ`, "ok");
    });
  });
}
function moveAmountRow(idx, dir) {
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= state.amounts.length) return;
  const tmp = state.amounts[idx];
  state.amounts[idx] = state.amounts[newIdx];
  state.amounts[newIdx] = tmp;
  saveAmountsCache();
  markDirty("amounts");
  renderAmountsTable();
  renderQuickAmountsChips();
}
function addAmountRow() {
  state.amounts.push(0);
  saveAmountsCache();
  markDirty("amounts");
  renderAmountsTable();
  const inputs = $("#amountsTableBody").querySelectorAll("input[data-amount-idx]");
  const last = inputs[inputs.length - 1];
  if (last) last.focus();
}
// ---------- Nút "số tiền nhanh" trên form — nay lấy từ state.amounts (JSON quản lý được) ----------
function renderQuickAmountsInto(wrapSel, inputSel, onPick) {
  const wrap = $(wrapSel);
  if (!wrap) return;
  const list = state.amounts && state.amounts.length ? state.amounts : DEFAULT_SUGGESTED_AMOUNTS;
  wrap.innerHTML = list
    .map((v) => `<button type="button" class="chip" data-val="${v}">${formatCompactAmount(v)}</button>`)
    .join("");
  wrap.querySelectorAll(".chip[data-val]").forEach((chip) => {
    chip.addEventListener("click", () => {
      wrap.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      $(inputSel).value = formatNumber(chip.dataset.val);
      onPick();
    });
  });
}
function renderQuickAmountsChips() {
  renderQuickAmountsInto("#quickAmounts", "#qrAmount", () => onGenerateQr(null, { silent: true }));
  renderQuickAmountsInto("#adhocQuickAmounts", "#adhocAmount", () => generateAdhocQr({ silent: true }));
}
function formatCompactAmount(v) {
  const n = Number(v) || 0;
  if (n >= 1_000_000 && n % 1_000_000 === 0) return `${n / 1_000_000}Tr`;
  if (n >= 1000 && n % 1000 === 0) return `${n / 1000}K`;
  return formatNumber(n);
}

// ---------- Cài đặt: Mẫu hiển thị QR (bảng quản lý) ----------
function renderTemplatesTable() {
  const body = $("#templatesTableBody");
  if (!body) return;
  body.innerHTML = "";
  const defaultValue = loadDefaults().template || "compact2";
  state.templates.forEach((t, idx) => {
    const isDefault = t.value === defaultValue;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="stt-cell">${idx + 1}</td>
      <td data-label="Value"><input data-tpl-idx="${idx}" data-tpl-field="value" value="${escapeAttr(t.value)}" title="${escapeAttr(t.value)}"></td>
      <td data-label="Label"><input data-tpl-idx="${idx}" data-tpl-field="label" value="${escapeAttr(t.label)}" title="${escapeAttr(t.label)}"></td>
      <td class="row-actions">
        <button class="icon-btn${isDefault ? " is-default" : ""}" type="button" title="${isDefault ? "Đang là mẫu mặc định — áp dụng ở mọi nơi (form chính, thêm tài khoản...) mỗi khi mở lại trang" : "Đặt làm mẫu hiển thị mặc định"}" data-tpl-set-default="${idx}">${isDefault ? "★" : "☆"}</button>
        <button class="icon-btn order-btn" title="Đưa lên trên" data-tpl-move="${idx}" data-dir="-1" ${idx === 0 ? "disabled" : ""}>▲</button>
        <button class="icon-btn order-btn" title="Đưa xuống dưới" data-tpl-move="${idx}" data-dir="1" ${idx === state.templates.length - 1 ? "disabled" : ""}>▼</button>
        <button class="icon-btn" title="Xoá dòng" data-tpl-del="${idx}">✕</button>
      </td>`;
    body.appendChild(tr);
  });
  const countEl = $("#templatesCount");
  if (countEl) countEl.textContent = `${state.templates.length} mẫu`;

  body.querySelectorAll("input[data-tpl-field]").forEach((input) => {
    input.addEventListener("input", (e) => {
      const idx = Number(e.target.dataset.tplIdx);
      const field = e.target.dataset.tplField;
      state.templates[idx][field] = e.target.value;
      saveTemplatesCache();
      markDirty("templates");
      populateQrTemplateOptions();
    });
  });
  body.querySelectorAll("[data-tpl-set-default]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.currentTarget.dataset.tplSetDefault);
      const t = state.templates[idx];
      if (!t || !t.value) return;
      const defaults = loadDefaults();
      defaults.template = t.value;
      localStorage.setItem(LS_DEFAULTS, JSON.stringify(defaults));
      renderTemplatesTable();
      // Chỉ đổi mẫu hiển thị đang chọn trên form chính — KHÔNG gọi applyDefaults()
      // ở đây vì hàm đó áp cả tài khoản mặc định, sẽ vô tình đổi luôn tài khoản
      // người dùng đang chọn dở trên form chính dù họ chỉ đang đặt mặc định mẫu.
      $("#qrTemplate").value = t.value;
      updateCustomSelectTriggerLabel($("#qrTemplate"));
      showToast(`Đã đặt "${t.label || t.value}" làm mẫu hiển thị mặc định`, "ok");
    });
  });
  body.querySelectorAll("[data-tpl-move]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.currentTarget.dataset.tplMove);
      const dir = Number(e.currentTarget.dataset.dir);
      moveTemplateRow(idx, dir);
    });
  });
  body.querySelectorAll("[data-tpl-del]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const idx = Number(e.target.dataset.tplDel);
      const removed = state.templates[idx];
      const ok = await showConfirm(`Xoá mẫu hiển thị "${removed.label || removed.value}"?`, "Xoá");
      if (!ok) return;
      state.templates.splice(idx, 1);
      saveTemplatesCache();
      markDirty("templates");
      renderTemplatesTable();
      populateQrTemplateOptions();
      showToast(`Đã xoá "${removed.label || removed.value}"`, "ok");
    });
  });
}
function moveTemplateRow(idx, dir) {
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= state.templates.length) return;
  const tmp = state.templates[idx];
  state.templates[idx] = state.templates[newIdx];
  state.templates[newIdx] = tmp;
  saveTemplatesCache();
  markDirty("templates");
  renderTemplatesTable();
  populateQrTemplateOptions();
}
function addTemplateRow() {
  state.templates.push({ value: "", label: "" });
  saveTemplatesCache();
  markDirty("templates");
  renderTemplatesTable();
  const inputs = $("#templatesTableBody").querySelectorAll("input[data-tpl-field='value']");
  const last = inputs[inputs.length - 1];
  if (last) last.focus();
}

// ---------- Workspace tabs (Tạo giao dịch / Mẫu giao dịch) ----------
function switchWorkspaceTab(tabName) {
  $$(".workspace-tabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.workspaceTab === tabName));
  $("#tab-qr").hidden = tabName !== "qr";
  $("#tab-mau").hidden = tabName !== "mau";
  $("#tab-adhoc").hidden = tabName !== "adhoc";
  if (tabName === "mau") renderMauList();
}

// ---------- Settings modal (chỉ xem — dữ liệu đọc trực tiếp từ Google Sheet) ----------
// Khung cửa sổ Cài đặt có chiều cao CỐ ĐỊNH bằng CSS (.gh-panel.settings-panel),
// nên chuyển tab chỉ cần ẩn/hiện panel — không cần animate chiều cao bằng JS nữa
// (cách cũ hay bị nhảy/co rồi mất nội dung khi chuyển tab nhanh).
function switchSettingsTab(tabName) {
  $$(".settings-tabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.settingsTab === tabName));

  $("#settingsTabAccounts").hidden = tabName !== "accounts";
  $("#settingsTabContent").hidden = tabName !== "content";
  $("#settingsTabAmounts").hidden = tabName !== "amounts";
  $("#settingsTabTemplates").hidden = tabName !== "templates";
  $("#settingsTabMau").hidden = tabName !== "mau";
  $("#settingsTabVietqrBanks").hidden = tabName !== "vietqr";
  if (tabName === "accounts") renderTable();
  if (tabName === "content") renderContentTable();
  if (tabName === "amounts") renderAmountsTable();
  if (tabName === "templates") renderTemplatesTable();
  if (tabName === "mau") renderMauTable();
  if (tabName === "vietqr") renderVietqrBanksTable();
}
function openSettingsModal(tabName) {
  $("#settingsBackdrop").hidden = false;
  switchSettingsTab(tabName || "accounts");
}
function closeSettingsModal() {
  $("#settingsBackdrop").hidden = true;
}

function initRippleEffect() {
  document.addEventListener("click", (e) => {
    const target = e.target.closest(".btn, .icon-btn, .chip, .tab, .mau-card-body");
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.5;
    const ripple = document.createElement("span");
    ripple.className = "ripple";
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
    target.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove());
  });
}

async function clearEnteredInfo() {
  const ok = await showConfirm("Xoá số tiền, nội dung và mẫu đang chọn trên form", "Xoá");
  if (!ok) return;
  state.selectedPresetIdx = null;
  clearFormState();
  $("#qrAmount").value = "";
  $("#qrContent").value = "";
  updateContentCounter("");
  $$("#quickAmounts .chip").forEach((c) => c.classList.remove("active"));
  applyDefaults();
  applyDefaultContentIfNeeded();
  renderMauList();
  updateMauActiveUi();
  $("#qrCard").hidden = true;
  $("#qrEmpty").hidden = false;
  $("#qrActions").hidden = true;
  showToast("Đã xoá thông tin đang nhập", "ok");
}

async function init() {
  initRippleEffect();

  await loadRefBanks();
  await loadAccountsInitial();
  await loadPresetsInitial();
  await loadTemplatesInitial();
  await loadContentInitial();
  await loadAmountsInitial();

  renderTable();
  populateQrTemplateOptions();
  populateQrAccounts();
  renderMauList();
  renderContentSuggestions();
  renderQuickAmountsChips();
  renderVietqrBanksTable();
  enhanceSelect($("#qrAccount"));
  enhanceSelect($("#qrTemplate"));
  enhanceSelect($("#adhocTemplate"));
  setupAdhocBankInput();

  $("#btnOpenSettings").addEventListener("click", () => openSettingsModal("accounts"));
  $("#btnSettingsClose").addEventListener("click", closeSettingsModal);
  $("#settingsBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "settingsBackdrop") closeSettingsModal();
  });
  $$(".settings-tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => switchSettingsTab(tab.dataset.settingsTab));
  });

  $$(".workspace-tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => switchWorkspaceTab(tab.dataset.workspaceTab));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("#confirmBackdrop").hidden) return;
    if (!$("#bankPickerPopup").hidden) {
      closeBankPicker();
      return;
    }
    if (customSelectOpenEl) {
      closeCustomSelect();
      return;
    }
    if (!$("#settingsBackdrop").hidden) closeSettingsModal();
  });

  document.addEventListener("mousedown", (e) => {
    if (bankPickerOpenIdx == null) return;
    if (e.target.closest("#bankPickerPopup") || e.target.closest(".bank-input")) return;
    closeBankPicker();
  });
  document.addEventListener("mousedown", (e) => {
    if (!customSelectOpenEl) return;
    if (e.target.closest("#customSelectPanel") || e.target.closest(".custom-select-trigger")) return;
    closeCustomSelect();
  });
  window.addEventListener(
    "scroll",
    (e) => {
      // Bỏ qua sự kiện scroll xảy ra BÊN TRONG chính popup/panel (vd. người
      // dùng kéo chuột để xem thêm ngân hàng) — nếu không, popup bị đóng
      // ngay khi vừa bắt đầu cuộn nên không kéo lên/xuống được.
      const target = e.target;
      const insidePopup =
        target &&
        target.closest &&
        (target.closest("#bankPickerPopup") || target.closest("#customSelectPanel"));
      if (insidePopup) return;
      if (bankPickerOpenIdx != null) closeBankPicker();
      if (customSelectOpenEl) closeCustomSelect();
    },
    true
  );
  window.addEventListener("resize", () => {
    if (bankPickerOpenIdx != null) closeBankPicker();
    if (customSelectOpenEl) closeCustomSelect();
  });
  $("#btnAddRow").addEventListener("click", addRow);
  $("#btnRefreshBanks").addEventListener("click", refreshRefBanksFromVietQR);
  $("#btnAddMauRow").addEventListener("click", addMauRow);
  $("#btnRefreshBanksVietqrTab").addEventListener("click", refreshVietqrBanksTab);
  $("#vietqrBankSearch").addEventListener("input", (e) => renderVietqrBanksTable(e.target.value));
  $("#btnAddContentRow").addEventListener("click", addContentRow);
  $("#btnAddTemplateRow").addEventListener("click", addTemplateRow);
  $("#btnAddAmountRow").addEventListener("click", addAmountRow);
  $("#btnUpdatePreset").addEventListener("click", updateSelectedPreset);
  $("#btnSaveAsPreset").addEventListener("click", saveCurrentFormAsPreset);

  $("#adhocForm").addEventListener("submit", (e) => {
    e.preventDefault();
    generateAdhocQr();
  });
  $("#adhocBankInput").addEventListener("input", () => generateAdhocQr({ silent: true }));
  $("#adhocAccountNum").addEventListener("input", () => generateAdhocQr({ silent: true }));
  $("#adhocAccountName").addEventListener("input", () => generateAdhocQr({ silent: true }));
  $("#adhocTemplate").addEventListener("change", () => generateAdhocQr({ silent: true }));
  $("#adhocAmount").addEventListener("input", (e) => {
    e.target.value = formatNumber(e.target.value);
    $$("#adhocQuickAmounts .chip").forEach((c) => c.classList.remove("active"));
    generateAdhocQr({ silent: true });
  });
  $("#adhocContent").addEventListener("input", () => generateAdhocQr({ silent: true }));
  $("#btnSaveAdhocAccount").addEventListener("click", saveAdhocAsAccount);
  $("#btnClearQrForm").addEventListener("click", clearQrForm);
  $("#btnSaveAdhocPreset").addEventListener("click", saveAdhocAsPreset);
  $("#adhocBtnCopyLink").addEventListener("click", async (e) => {
    const url = e.target.dataset.url;
    if (!url) return;
    await navigator.clipboard.writeText(url);
    showToast("Đã sao chép link ảnh", "ok");
  });
  $("#adhocBtnDownload").addEventListener("click", async (e) => {
    const url = e.currentTarget.href;
    if (!url) return;
    e.preventDefault();
    const btn = e.currentTarget;
    const oldLabel = btn.textContent;
    btn.textContent = "Đang tải…";
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = "qr-thanh-toan.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
    } catch (err) {
      console.error(err);
      showToast("Không tải được ảnh QR về máy — thử \"Mở link ảnh\" rồi lưu thủ công.", "err");
    } finally {
      btn.textContent = oldLabel;
    }
  });

  $("#btnContentSuggestToggle").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleContentSuggestions();
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".combo-wrap")) closeContentSuggestions();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeContentSuggestions();
  });

  $("#btnSetDefaultAccount").addEventListener("click", setDefaultAccount);
  $("#btnSetDefaultTemplate").addEventListener("click", setDefaultTemplate);
  $("#btnClearActivePreset").addEventListener("click", clearActivePreset);

  $("#qrAmount").addEventListener("input", () => {
    $$("#quickAmounts .chip").forEach((c) => c.classList.remove("active"));
  });
  $("#qrAmount").addEventListener("input", () => renderAmountSuggestions());

  $("#accountSearch").addEventListener(
    "input",
    debounce(() => renderTable(), 200)
  );

  // Đồng bộ "title" (tooltip khi rê chuột) = giá trị đầy đủ cho mọi ô nhập
  // trong các bảng quản lý — nội dung dài bị cắt/khuất trong ô nhỏ vẫn xem
  // được đầy đủ bằng cách rê chuột vào, không cần mở rộng bảng.
  document.addEventListener("input", (e) => {
    const el = e.target;
    if (el.tagName === "INPUT" && el.type !== "password" && el.closest(".table-wrap")) {
      el.title = el.value;
    }
  });

  $("#qrForm").addEventListener("submit", (e) => onGenerateQr(e));
  $("#qrAmount").addEventListener("input", (e) => {
    e.target.value = formatNumber(e.target.value);
  });

  const liveGenerate = debounce(() => onGenerateQr(null, { silent: true }), 350);
  $("#qrAccount").addEventListener("change", () => {
    checkPresetAccountMismatch();
    onGenerateQr(null, { silent: true });
  });
  $("#qrTemplate").addEventListener("change", () => {
    updateMauActiveUi();
    onGenerateQr(null, { silent: true });
  });
  $("#qrAmount").addEventListener("input", () => {
    updateMauActiveUi();
    liveGenerate();
  });
  $("#qrContent").addEventListener("input", (e) => {
    updateContentCounter(e.target.value.trim());
    updateMauActiveUi();
    liveGenerate();
  });
  $("#btnCopyLink").addEventListener("click", async (e) => {
    const url = e.target.dataset.url;
    if (!url) return;
    await navigator.clipboard.writeText(url);
    e.target.textContent = "Đã sao chép ✓";
    showToast("Đã sao chép link ảnh", "ok");
    setTimeout(() => (e.target.textContent = "Sao chép link ảnh"), 1500);
  });

  // Ảnh QR nằm ở domain khác (img.vietqr.io) — thuộc tính "download" trên thẻ <a>
  // bị trình duyệt BỎ QUA với link cross-origin, nên bấm nút chỉ mở/điều hướng
  // tới ảnh chứ không lưu file. Tự fetch ảnh về dạng blob rồi tải qua blob URL
  // (cùng-origin) để nút "Tải ảnh QR" hoạt động đúng như tên gọi.
  $("#btnDownload").addEventListener("click", async (e) => {
    const url = e.currentTarget.href;
    if (!url) return;
    e.preventDefault();
    const btn = e.currentTarget;
    const oldLabel = btn.textContent;
    btn.textContent = "Đang tải…";
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = "qr-thanh-toan.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
    } catch (err) {
      console.error(err);
      showToast("Không tải được ảnh QR về máy — thử \"Mở link ảnh\" rồi lưu thủ công.", "err");
    } finally {
      btn.textContent = oldLabel;
    }
  });

  updateContentCounter($("#qrContent").value.trim());
  applyDefaults();
  // KHÔNG khôi phục lại số tiền/nội dung/mẫu đã chọn của lần dùng trước — mỗi
  // khi mở lại trang (F5) form luôn bắt đầu từ tài khoản & mẫu hiển thị MẶC
  // ĐỊNH (đặt bằng nút ☆ ở trên), số tiền và nội dung để trống. Nội dung mặc
  // định (nếu có đặt riêng, xem setDefaultContent()) vẫn được tự điền vào ô
  // trống ở applyDefaultContentIfNeeded() bên dưới.
  applyDefaultContentIfNeeded();
  updateContentCounter($("#qrContent").value.trim());
  updateMauActiveUi();
  switchWorkspaceTab("qr");
  onGenerateQr(null, { silent: true });
}

document.addEventListener("DOMContentLoaded", init);