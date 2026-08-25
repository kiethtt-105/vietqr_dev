const LS_DEFAULTS = "vietqr_defaults";
const LS_FORM_STATE = "vietqr_form_state";

const ADDINFO_SOFT_LIMIT = 90;
const AMOUNT_WARN_THRESHOLD = 500_000_000;

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
  return rows
    .map((r) => {
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
    })
    .filter((a) => a.data_num && a.data__code); // bỏ dòng rác trên Sheet (vd. ô lẻ còn sót chữ ở cột khác) không phải tài khoản thật —
  // 1 tài khoản hợp lệ BẮT BUỘC phải có số tài khoản + mã ngân hàng, thiếu 1 trong 2 thì không tạo được QR nên loại luôn ở đây.
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
    isDefault: sheetBool(pick(r, "default")),
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

// ---------- Cache dữ liệu Sheet vào trình duyệt để tiết kiệm thời gian load ----------
// Chiến lược "cache trước, làm mới sau" (stale-while-revalidate):
// - Lần mở đầu tiên trên máy/trình duyệt này: chưa có cache → vẫn phải chờ tải từ
//   Google Sheet như bình thường (không có gì để "tiết kiệm" ở lần đầu).
// - Những lần mở sau: hiện NGAY dữ liệu đã lưu lần trước (gần như tức thì, không
//   chờ mạng), đồng thời âm thầm tải bản mới nhất từ Google Sheet ở nền — tải xong
//   thì tự cập nhật lại UI. Nếu mạng lỗi/Sheet đổi cấu trúc, vẫn còn dữ liệu cũ để dùng.
const SHEET_CACHE_PREFIX = "vietqr_sheet_cache_";
const SHEET_CACHE_VERSION = 1; // tăng số này khi đổi cấu trúc field để tự bỏ qua cache cũ không còn khớp

function readSheetCache(key) {
  try {
    const raw = localStorage.getItem(SHEET_CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== SHEET_CACHE_VERSION || !Array.isArray(parsed.data)) return null;
    return parsed.data;
  } catch (e) {
    return null;
  }
}
function writeSheetCache(key, data) {
  try {
    localStorage.setItem(SHEET_CACHE_PREFIX + key, JSON.stringify({ v: SHEET_CACHE_VERSION, data, ts: Date.now() }));
  } catch (e) {
    // Bỏ qua nếu localStorage đầy/bị chặn — app vẫn chạy được, chỉ là không cache được.
  }
}
// cacheKey: tên để lưu trong localStorage (khác SHEET_TABS để dễ đọc log).
// fetchFn: hàm async trả về dữ liệu đã map sẵn (vd. loadAccountsFromSheet).
// onFresh: gọi lại khi bản mới tải xong Ở NỀN (sau khi đã trả cache cũ) — dùng để
// cập nhật state + render lại UI phần tương ứng.
function loadCachedSection(cacheKey, fetchFn, onFresh) {
  const cached = readSheetCache(cacheKey);
  if (cached) {
    fetchFn()
      .then((fresh) => {
        writeSheetCache(cacheKey, fresh);
        onFresh(fresh);
      })
      .catch((e) => console.warn(`Làm mới "${cacheKey}" từ Google Sheet thất bại, tạm dùng dữ liệu đã lưu trước đó:`, e));
    return Promise.resolve(cached);
  }
  return fetchFn().then((fresh) => {
    writeSheetCache(cacheKey, fresh);
    return fresh;
  });
}

// ---------- Ngân hàng (nguồn: tab "Banks" trong Google Sheet) ----------
async function loadRefBanks() {
  try {
    state.refBanks = await loadCachedSection("banks", loadBanksFromSheet, (fresh) => {
      state.refBanks = fresh;
    });
  } catch (e) {
    console.error(e);
    state.refBanks = [];
  }
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
  selectAdhocBank(code);
  closeBankPicker();
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
    const rows = await loadCachedSection("accounts", loadAccountsFromSheet, (fresh) => {
      state.accounts = normalizeAccountFields(fresh);
      sortAccountsByStt();
      populateQrAccounts();
    });
    state.accounts = normalizeAccountFields(rows);
  } catch (e) {
    console.error(e);
    state.accounts = [];
  }
  sortAccountsByStt();
}

// ---------- Mẫu chuyển tiền (nguồn: tab "MauChuyenTien") ----------
async function loadPresetsInitial() {
  try {
    state.presets = await loadCachedSection("presets", loadPresetsFromSheet, (fresh) => {
      state.presets = fresh;
      renderMauList();
    });
  } catch (e) {
    console.error(e);
    state.presets = [];
  }
}

// ---------- Nội dung chuyển khoản gợi ý (nguồn: tab "NoiDungGoiY") ----------
async function loadContentInitial() {
  try {
    state.content = await loadCachedSection("content", loadContentFromSheet, (fresh) => {
      state.content = fresh;
      renderContentSuggestions();
    });
  } catch (e) {
    // Tab "NoiDungGoiY" có thể chưa được tạo trên Google Sheet — đây là tính
    // năng tuỳ chọn (gợi ý nội dung chuyển khoản), không chặn app hoạt động,
    // nên không hiện toast lỗi làm phiền mỗi lần mở trang. Vẫn log ra console
    // để dễ tra khi cần debug.
    console.warn('Không đọc được tab "NoiDungGoiY" (gợi ý nội dung) — có thể tab này chưa tồn tại trên Google Sheet:', e);
    state.content = [];
  }
}

// ---------- Số tiền gợi ý (nguồn: tab "SoTienGoiY") ----------
async function loadAmountsInitial() {
  try {
    state.amounts = await loadCachedSection("amounts", loadAmountsFromSheet, (fresh) => {
      state.amounts = fresh;
      renderQuickAmountsChips();
    });
  } catch (e) {
    console.error(e);
    state.amounts = [];
    showToast("Không đọc được Số tiền gợi ý từ Google Sheet", "err");
  }
}

// ---------- Mẫu hiển thị QR (nguồn: tab "MauHienThi") ----------
async function loadTemplatesInitial() {
  try {
    state.templates = await loadCachedSection("templates", loadTemplatesFromSheet, (fresh) => {
      state.templates = fresh;
      populateQrTemplateOptions();
    });
  } catch (e) {
    console.error(e);
    state.templates = [];
    showToast("Không đọc được Mẫu hiển thị QR từ Google Sheet", "err");
  }
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
// Thứ tự ưu tiên mẫu hiển thị mặc định:
// 1) Người dùng đã tự đặt qua nút ☆ (lưu trong localStorage) — luôn ưu tiên cao nhất.
// 2) Dòng được đánh dấu default=TRUE trong tab "MauHienThi" trên Google Sheet.
// 3) "compact2" — chỉ dùng khi 2 nguồn trên đều không có.
function getDefaultTemplateValue() {
  const saved = loadDefaults().template;
  if (saved) return saved;
  const sheetDefault = state.templates.find((t) => t.isDefault);
  if (sheetDefault) return sheetDefault.value;
  return "compact2";
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
  $("#qrTemplate").value = getDefaultTemplateValue();
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
  const defaultTemplate = getDefaultTemplateValue();
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
  showToast(`Đã thêm "${trimmed}" vào danh sách tài khoản (chỉ trong phiên này — nguồn dữ liệu chính là Google Sheet).`, "ok", { duration: 3600 });
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

// ---------- Nút "số tiền nhanh" trên form — nay lấy từ state.amounts (JSON quản lý được) ----------
function renderQuickAmountsInto(wrapSel, inputSel, onPick) {
  const wrap = $(wrapSel);
  if (!wrap) return;
  const list = state.amounts || [];
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

// ---------- Workspace tabs (Tạo giao dịch / Mẫu giao dịch) ----------
// ---------- Tab "Quản lý" — khoá bằng Passkey của THIẾT BỊ, không lưu mật khẩu ----------
// Vì code public trên GitHub nên không thể giấu mật khẩu trong source (ai đọc code
// cũng thấy). Passkey (WebAuthn) giải quyết đúng vấn đề này: khoá riêng (private key)
// không bao giờ rời khỏi thiết bị (nằm trong chip bảo mật/OS), trình duyệt chỉ lưu lại
// ID của khoá công khai trong localStorage — thứ này vô hại nếu lộ ra, không dùng để
// mở khoá được nếu không có đúng thiết bị + vân tay/Face ID/PIN. Mỗi thiết bị cần tự
// thiết lập passkey riêng (không đồng bộ qua GitHub hay server nào).
const MANAGE_PASSKEY_ID_KEY = "vietqr_manage_passkey_id";
const MANAGE_UNLOCK_SESSION_KEY = "vietqr_manage_unlocked";

// ---------- Mã thiết lập (setup code) — chặn người lạ tự đăng ký passkey đầu tiên ----------
// LƯU Ý QUAN TRỌNG VỀ GIỚI HẠN CỦA CƠ CHẾ NÀY (đọc trước khi đổi):
// Vì đây là code chạy 100% ở trình duyệt và public trên GitHub, KHÔNG có cách nào giấu
// một bí mật tuyệt đối trong file .js — ai cũng đọc được toàn bộ logic bên dưới. Cơ chế
// này KHÔNG lưu mã gốc, chỉ lưu SHA-256 hash của mã (một chiều, không giải ngược ra mã
// gốc được), nên người đọc source không thấy mã thật.
// -> Việc này CHẶN được: người tình cờ vào link / bot / người không rành kỹ thuật bấm
//    "Thiết lập Passkey" và tự đăng ký trước bạn.
// -> Việc này KHÔNG chặn được: người rành kỹ thuật mở DevTools Console và tự gọi thẳng
//    registerManagePasskey() để bỏ qua bước kiểm tra mã, hoặc brute-force hash nếu mã quá
//    ngắn/dễ đoán. Nếu cần chặn cả trường hợp này thì bắt buộc phải có server xác thực —
//    không thể làm được nếu chỉ dùng client-side thuần.
//
// CÁCH ĐẶT MÃ CỦA BẠN (tôi không biết mã, bạn tự chọn rồi tự tạo hash — không dán mã thật
// dưới dạng chữ thường vào file này, chỉ dán hash):
//   1. Mở Console của trình duyệt (F12) ở BẤT KỲ trang https nào (không cần mở app này).
//   2. Chạy đoạn sau, thay "MA-CUA-BAN" bằng mã bạn muốn dùng (nên dài, khó đoán):
//        crypto.subtle.digest("SHA-256", new TextEncoder().encode("MA-CUA-BAN"))
//          .then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2,"0")).join("")))
//   3. Copy chuỗi hex in ra, dán thay cho giá trị rỗng bên dưới.
const MANAGE_SETUP_CODE_HASH = ""; // <-- dán hex SHA-256 của mã thiết lập vào đây

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function showPrompt(message, opts) {
  return new Promise((resolve) => {
    const backdrop = $("#promptBackdrop");
    const input = $("#promptInput");
    const okBtn = $("#promptOkBtn");
    const cancelBtn = $("#promptCancelBtn");
    const errEl = $("#promptError");
    $("#promptMessage").textContent = message;
    input.type = (opts && opts.type) || "text";
    input.value = "";
    errEl.hidden = true;
    errEl.textContent = "";
    backdrop.hidden = false;
    input.focus();

    function cleanup(result) {
      backdrop.hidden = true;
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      backdrop.removeEventListener("click", onBackdropClick);
      input.removeEventListener("keydown", onKeydown);
      resolve(result);
    }
    function onOk() {
      cleanup(input.value);
    }
    function onCancel() {
      cleanup(null);
    }
    function onBackdropClick(e) {
      if (e.target.id === "promptBackdrop") cleanup(null);
    }
    function onKeydown(e) {
      if (e.key === "Escape") cleanup(null);
      if (e.key === "Enter") {
        e.preventDefault();
        cleanup(input.value);
      }
    }
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    backdrop.addEventListener("click", onBackdropClick);
    input.addEventListener("keydown", onKeydown);
  });
}

function passkeySupported() {
  return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create && navigator.credentials.get);
}
function bufToBase64url(buf) {
  let str = "";
  new Uint8Array(buf).forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64urlToBuf(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  const str = atob(b64);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes.buffer;
}
function randomBytes(n) {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return arr;
}
function getStoredPasskeyId() {
  try {
    return localStorage.getItem(MANAGE_PASSKEY_ID_KEY);
  } catch (e) {
    return null;
  }
}
function setStoredPasskeyId(id) {
  try {
    localStorage.setItem(MANAGE_PASSKEY_ID_KEY, id);
  } catch (e) {}
}
function clearStoredPasskeyId() {
  try {
    localStorage.removeItem(MANAGE_PASSKEY_ID_KEY);
  } catch (e) {}
}
function isManageUnlockedThisSession() {
  try {
    return sessionStorage.getItem(MANAGE_UNLOCK_SESSION_KEY) === "1";
  } catch (e) {
    return false;
  }
}
function setManageUnlockedThisSession(v) {
  try {
    if (v) sessionStorage.setItem(MANAGE_UNLOCK_SESSION_KEY, "1");
    else sessionStorage.removeItem(MANAGE_UNLOCK_SESSION_KEY);
  } catch (e) {}
}

async function registerManagePasskey() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { name: "VietQR Generator" },
      user: { id: randomBytes(16), name: "quanly@thiet-bi-nay", displayName: "Quản lý (thiết bị này)" },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 }, // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
      timeout: 60000,
      attestation: "none",
    },
  });
  if (!cred) throw new Error("Không tạo được passkey");
  setStoredPasskeyId(bufToBase64url(cred.rawId));
}
async function verifyManagePasskey() {
  const storedId = getStoredPasskeyId();
  if (!storedId) throw new Error("Chưa thiết lập passkey trên thiết bị này");
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: [{ id: base64urlToBuf(storedId), type: "public-key" }],
      userVerification: "required",
      timeout: 60000,
    },
  });
  if (!assertion) throw new Error("Xác thực thất bại");
}

function renderManageGate() {
  const gate = $("#manageGate");
  const dash = $("#manageDashboard");
  if (!gate || !dash) return;

  if (isManageUnlockedThisSession()) {
    gate.hidden = true;
    dash.hidden = false;
    renderManageDashboard();
    return;
  }
  dash.hidden = true;
  gate.hidden = false;

  const icon = $("#manageGateIcon");
  const title = $("#manageGateTitle");
  const desc = $("#manageGateDesc");
  const btn = $("#btnManageAction");
  const hint = $("#manageGateHint");
  hint.hidden = true;
  hint.textContent = "";

  if (!passkeySupported()) {
    icon.textContent = "⚠️";
    title.textContent = "Trình duyệt này không hỗ trợ Passkey";
    desc.textContent = "Hãy dùng Chrome/Edge/Safari bản mới, hoặc mở trên điện thoại có vân tay/Face ID.";
    btn.hidden = true;
    return;
  }
  btn.hidden = false;

  if (getStoredPasskeyId()) {
    icon.textContent = "🔒";
    title.textContent = "Khu vực quản lý — đã khoá";
    desc.textContent = "Mở khoá bằng vân tay / Face ID / mã PIN của thiết bị này.";
    btn.textContent = "🔓 Mở khoá bằng Passkey";
    btn.onclick = handleManageUnlockClick;
  } else {
    icon.textContent = "🔐";
    title.textContent = "Thiết lập khoá cho thiết bị này";
    desc.textContent = MANAGE_SETUP_CODE_HASH
      ? "Passkey được lưu ngay trên thiết bị này, không đưa lên GitHub hay bất kỳ server nào. Cần nhập đúng mã thiết lập để đăng ký lần đầu."
      : "Passkey được lưu ngay trên thiết bị này, không đưa lên GitHub hay bất kỳ server nào — mỗi thiết bị cần thiết lập riêng.";
    btn.textContent = "🔐 Thiết lập Passkey";
    btn.onclick = handleManageSetupClick;
  }
}

async function handleManageSetupClick() {
  const btn = $("#btnManageAction");
  const hint = $("#manageGateHint");
  const oldLabel = btn.textContent;

  // Chỉ hỏi mã thiết lập nếu app đã được cấu hình mã (MANAGE_SETUP_CODE_HASH khác rỗng).
  // Nếu chưa cấu hình, bỏ qua bước này để không tự khoá cứng người mới clone code lại.
  if (MANAGE_SETUP_CODE_HASH) {
    const code = await showPrompt("Nhập mã thiết lập để đăng ký passkey lần đầu cho thiết bị này:", { type: "password" });
    if (code === null) return; // người dùng bấm huỷ
    if (!code.trim()) {
      hint.hidden = false;
      hint.textContent = "Chưa nhập mã thiết lập.";
      return;
    }
    const hash = await sha256Hex(code.trim());
    if (hash !== MANAGE_SETUP_CODE_HASH) {
      hint.hidden = false;
      hint.textContent = "Mã thiết lập không đúng.";
      return;
    }
  }

  btn.disabled = true;
  btn.textContent = "Đang thiết lập…";
  try {
    await registerManagePasskey();
    setManageUnlockedThisSession(true);
    showToast("Đã thiết lập passkey cho thiết bị này", "ok");
    renderManageGate();
  } catch (e) {
    console.error(e);
    hint.hidden = false;
    hint.textContent = "Không thiết lập được passkey — thiết bị có thể chưa hỗ trợ vân tay/Face ID/PIN, hoặc bạn đã huỷ thao tác.";
    btn.disabled = false;
    btn.textContent = oldLabel;
  }
}
async function handleManageUnlockClick() {
  const btn = $("#btnManageAction");
  const hint = $("#manageGateHint");
  const oldLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Đang xác thực…";
  try {
    await verifyManagePasskey();
    setManageUnlockedThisSession(true);
    renderManageGate();
  } catch (e) {
    console.error(e);
    hint.hidden = false;
    hint.textContent = "Xác thực thất bại hoặc đã huỷ — thử lại.";
    btn.disabled = false;
    btn.textContent = oldLabel;
  }
}
function lockManageTab() {
  setManageUnlockedThisSession(false);
  renderManageGate();
  showToast("Đã khoá lại", "ok");
}
function resetManagePasskey() {
  showConfirm("Gỡ passkey đã thiết lập trên thiết bị này? Lần sau mở tab Quản lý sẽ phải thiết lập lại.", "Gỡ khoá").then((ok) => {
    if (!ok) return;
    clearStoredPasskeyId();
    setManageUnlockedThisSession(false);
    showToast("Đã gỡ passkey trên thiết bị này", "ok");
    renderManageGate();
  });
}

function formatCacheAge(cacheKey) {
  const cached = readSheetCache(cacheKey);
  if (!cached) return "chưa có cache";
  try {
    const raw = localStorage.getItem(SHEET_CACHE_PREFIX + cacheKey);
    const parsed = JSON.parse(raw);
    const diffMin = Math.round((Date.now() - parsed.ts) / 60000);
    if (diffMin < 1) return "vừa xong";
    if (diffMin < 60) return `${diffMin} phút trước`;
    return `${Math.round(diffMin / 60)} giờ trước`;
  } catch (e) {
    return "—";
  }
}

function renderManageDashboard() {
  const statsWrap = $("#manageStats");
  if (statsWrap) {
    const stats = [
      { label: "Tài khoản", value: state.accounts.length },
      { label: "Mẫu giao dịch", value: state.presets.length },
      { label: "Ngân hàng hỗ trợ", value: state.refBanks.length },
      { label: "Đồng bộ gần nhất", value: formatCacheAge("accounts") },
    ];
    statsWrap.innerHTML = stats
      .map(
        (s) =>
          `<div class="manage-stat-card"><span class="manage-stat-value">${escapeHtml(String(s.value))}</span><span class="manage-stat-label">${escapeHtml(s.label)}</span></div>`
      )
      .join("");
  }

  const accTable = $("#manageAccountsTable");
  if (accTable) {
    const rows = state.accounts
      .map(
        (a) =>
          `<tr><td>${escapeHtml(a.list_name)}</td><td>${escapeHtml(a.data__code)}</td><td class="mono">${escapeHtml(a.data_num)}</td><td>${a.isDefault ? '<span class="manage-tag">Mặc định</span>' : ""}</td></tr>`
      )
      .join("");
    accTable.innerHTML = `<thead><tr><th>Tên gợi nhớ</th><th>NH</th><th>Số TK</th><th></th></tr></thead><tbody>${
      rows || `<tr><td colspan="4" class="manage-empty-row">Chưa có tài khoản nào</td></tr>`
    }</tbody>`;
  }

  const presetTable = $("#managePresetsTable");
  if (presetTable) {
    const rows = state.presets
      .map(
        (p) =>
          `<tr><td>${escapeHtml(p.name || "—")}</td><td>${escapeHtml(p.accountName || p.bankCode || "—")}</td><td>${
            p.amount ? escapeHtml(formatNumber(p.amount)) + "đ" : "—"
          }</td></tr>`
      )
      .join("");
    presetTable.innerHTML = `<thead><tr><th>Tên mẫu</th><th>Tài khoản</th><th>Số tiền</th></tr></thead><tbody>${
      rows || `<tr><td colspan="3" class="manage-empty-row">Chưa có mẫu nào</td></tr>`
    }</tbody>`;
  }
}

async function refreshManageData() {
  const btn = $("#btnManageRefresh");
  const oldLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Đang làm mới…";
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(SHEET_CACHE_PREFIX))
      .forEach((k) => localStorage.removeItem(k));
    await Promise.all([
      loadRefBanks(),
      loadAccountsInitial(),
      loadPresetsInitial(),
      loadTemplatesInitial(),
      loadContentInitial(),
      loadAmountsInitial(),
    ]);
    populateQrTemplateOptions();
    populateQrAccounts();
    renderMauList();
    renderContentSuggestions();
    renderQuickAmountsChips();
    renderManageDashboard();
    showToast("Đã làm mới dữ liệu từ Google Sheet", "ok");
  } catch (e) {
    console.error(e);
    showToast("Làm mới dữ liệu thất bại", "err");
  } finally {
    btn.disabled = false;
    btn.textContent = oldLabel;
  }
}

function switchWorkspaceTab(tabName) {
  $$(".workspace-tabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.workspaceTab === tabName));
  $("#tab-qr").hidden = tabName !== "qr";
  $("#tab-mau").hidden = tabName !== "mau";
  $("#tab-adhoc").hidden = tabName !== "adhoc";
  $("#tab-quanly").hidden = tabName !== "quanly";
  if (tabName === "mau") renderMauList();
  if (tabName === "quanly") renderManageGate();
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

  populateQrTemplateOptions();
  populateQrAccounts();
  renderMauList();
  renderContentSuggestions();
  renderQuickAmountsChips();
  enhanceSelect($("#qrAccount"));
  enhanceSelect($("#qrTemplate"));
  enhanceSelect($("#adhocTemplate"));
  setupAdhocBankInput();

  $$(".workspace-tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => switchWorkspaceTab(tab.dataset.workspaceTab));
  });
  $("#btnManageRefresh").addEventListener("click", refreshManageData);
  $("#btnManageLock").addEventListener("click", lockManageTab);
  $("#btnManageResetPasskey").addEventListener("click", resetManagePasskey);

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