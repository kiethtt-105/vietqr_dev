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
// Mẫu hiển thị QR mặc định LUÔN lấy từ dòng đánh dấu default=TRUE trong tab
// "MauHienThi" trên Google Sheet — không còn nút ☆ để người dùng tự đặt/ghi
// đè bằng localStorage nữa, mọi mặc định đều đến từ 1 nguồn duy nhất (Sheet).
function getDefaultTemplateValue() {
  const sheetDefault = state.templates.find((t) => t.isDefault);
  if (sheetDefault) return sheetDefault.value;
  return (state.templates[0] && state.templates[0].value) || "compact2";
}
// Tài khoản mặc định LUÔN lấy từ cột isDefault trong tab "TaiKhoan" trên
// Google Sheet — không còn nút ☆ và không còn ghi đè bằng localStorage.
function applyDefaults() {
  const defIdx = state.accounts.findIndex((a) => a.isDefault && !a.hidden);
  if (defIdx >= 0) {
    $("#qrAccount").value = defIdx;
  }
  $("#qrTemplate").value = getDefaultTemplateValue();
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
  [$("#qrTemplate")].forEach((sel) => {
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

function updateMauActiveUi() {
  const tag = $("#mauActiveTag");
  const nameEl = $("#mauActiveName");
  if (!tag || !nameEl) return;
  if (state.selectedPresetIdx != null && state.presets[state.selectedPresetIdx]) {
    const preset = state.presets[state.selectedPresetIdx];
    tag.hidden = false;
    nameEl.textContent = preset.name || `Mẫu ${state.selectedPresetIdx + 1}`;
  } else {
    tag.hidden = true;
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
    // Mẫu trỏ tới một tài khoản không nằm trong danh sách "Tài khoản" đã lưu
    // trên Google Sheet — không còn tab nhập tay để áp vào, chỉ báo cho biết.
    showToast(`Tài khoản của mẫu này (${preset.bankCode} — ${preset.accountNum}) không có trong danh sách tài khoản — giữ nguyên tài khoản đang chọn.`, "err");
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
  renderAccountInfo();
}
// ---------- Hiển thị chi tiết tài khoản đang chọn (Ngân hàng / Số TK / Chủ TK) ----------
function bankFullNameForAccount(acc) {
  if (!acc) return "";
  const bank = state.refBanks.find((b) => b.code === acc.data__code);
  const short = acc.data__name || acc.data__shortName || (bank && (bank.shortName || bank.short_name)) || acc.data__code;
  const full = bank && bank.name ? bank.name : "";
  return full && full !== short ? `${short} — ${full}` : short;
}
function renderAccountInfo() {
  const card = $("#accountInfoCard");
  if (!card) return;
  const idx = Number($("#qrAccount").value);
  const acc = state.accounts[idx];
  if (!acc) {
    card.hidden = true;
    return;
  }
  $("#accInfoBank").textContent = bankFullNameForAccount(acc);
  $("#accInfoNum").textContent = acc.data_num || "—";
  $("#accInfoHolder").textContent = acc.name_ac || "—";
  card.hidden = false;
}

// ---------- Đọc số tiền bằng chữ (tiếng Việt) ----------
const VI_DIGIT_WORDS = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
function readThreeDigits(n, isFirstGroup) {
  const tram = Math.floor(n / 100);
  const chuc = Math.floor((n % 100) / 10);
  const donvi = n % 10;
  const parts = [];
  if (tram > 0 || !isFirstGroup) {
    parts.push(VI_DIGIT_WORDS[tram], "trăm");
  }
  if (chuc === 0) {
    if (donvi > 0 && (tram > 0 || !isFirstGroup)) parts.push("lẻ");
    if (donvi > 0) parts.push(VI_DIGIT_WORDS[donvi]);
  } else if (chuc === 1) {
    parts.push("mười");
    if (donvi === 1) parts.push("một");
    else if (donvi === 5) parts.push("lăm");
    else if (donvi > 0) parts.push(VI_DIGIT_WORDS[donvi]);
  } else {
    parts.push(VI_DIGIT_WORDS[chuc], "mươi");
    if (donvi === 1) parts.push("mốt");
    else if (donvi === 5) parts.push("lăm");
    else if (donvi > 0) parts.push(VI_DIGIT_WORDS[donvi]);
  }
  return parts.join(" ");
}
function numberToVietnameseWords(n) {
  n = Math.floor(Number(n) || 0);
  if (n === 0) return "không đồng";
  const UNITS = ["", " nghìn", " triệu", " tỷ"];
  const groups = [];
  let rest = n;
  while (rest > 0) {
    groups.unshift(rest % 1000);
    rest = Math.floor(rest / 1000);
  }
  const words = [];
  groups.forEach((g, i) => {
    if (g === 0) return;
    const isFirstGroup = i === 0;
    words.push(readThreeDigits(g, isFirstGroup) + UNITS[groups.length - 1 - i]);
  });
  const sentence = words.join(" ").replace(/\s+/g, " ").trim();
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + " đồng";
}
function renderAmountWords(rawAmount) {
  const el = $("#qrAmountWords");
  if (!el) return;
  const n = Number(rawAmount);
  if (!rawAmount || !n) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.textContent = numberToVietnameseWords(n);
  el.hidden = false;
}

// ---------- Tóm tắt chi tiết giao dịch bên cạnh mã QR ----------
function renderQrSummary(acc, amount, content, template) {
  const box = $("#qrSummary");
  if (!box || !acc) return;
  const tpl = state.templates.find((t) => t.value === template);
  $("#sumBank").textContent = bankFullNameForAccount(acc);
  $("#sumAccNum").textContent = acc.data_num || "—";
  $("#sumHolder").textContent = acc.name_ac || "—";
  $("#sumAmount").textContent = amount ? `${formatNumber(amount)}đ` : "Không cố định (người chuyển tự nhập)";
  $("#sumContent").textContent = content || "—";
  $("#sumTemplate").textContent = (tpl && tpl.label) || template || "—";
  box.hidden = false;
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
  wrap.innerHTML = state.content
    .map((c) => `<button type="button" class="combo-item" data-content="${escapeAttr(c)}">${escapeHtml(c)}</button>`)
    .join("");
  wrap.querySelectorAll(".combo-item[data-content]").forEach((item) => {
    item.addEventListener("click", () => {
      $("#qrContent").value = item.dataset.content;
      updateContentCounter(item.dataset.content.trim());
      closeContentSuggestions();
      onGenerateQr(null, { silent: true });
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
  renderAmountWords(amount);
  updateCustomSelectTriggerLabel($("#qrAccount"));
  updateCustomSelectTriggerLabel($("#qrTemplate"));
  renderAccountInfo();
  renderQrSummary(acc, amount, content, template);

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
}
function formatCompactAmount(v) {
  const n = Number(v) || 0;
  if (n >= 1_000_000 && n % 1_000_000 === 0) return `${n / 1_000_000}Tr`;
  if (n >= 1000 && n % 1000 === 0) return `${n / 1000}K`;
  return formatNumber(n);
}

// ---------- Workspace tabs (Tạo giao dịch / Mẫu giao dịch) ----------

function switchWorkspaceTab(tabName) {
  $$(".workspace-tabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.workspaceTab === tabName));
  $("#tab-qr").hidden = tabName !== "qr";
  $("#tab-mau").hidden = tabName !== "mau";
  if (tabName === "mau") renderMauList();
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

  $$(".workspace-tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => switchWorkspaceTab(tab.dataset.workspaceTab));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("#confirmBackdrop").hidden) return;
    if (customSelectOpenEl) {
      closeCustomSelect();
      return;
    }
  });

  document.addEventListener("mousedown", (e) => {
    if (!customSelectOpenEl) return;
    if (e.target.closest("#customSelectPanel") || e.target.closest(".custom-select-trigger")) return;
    closeCustomSelect();
  });
  window.addEventListener(
    "scroll",
    (e) => {
      // Bỏ qua sự kiện scroll xảy ra BÊN TRONG chính panel — nếu không, panel
      // bị đóng ngay khi vừa bắt đầu cuộn nên không kéo lên/xuống được.
      const target = e.target;
      const insidePopup = target && target.closest && target.closest("#customSelectPanel");
      if (insidePopup) return;
      if (customSelectOpenEl) closeCustomSelect();
    },
    true
  );
  window.addEventListener("resize", () => {
    if (customSelectOpenEl) closeCustomSelect();
  });

  $("#btnClearQrForm").addEventListener("click", clearQrForm);

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
  // KHÔNG khôi phục lại số tiền/nội dung/mẫu đã chọn của lần dùng trước — mỗi
  // khi mở lại trang (F5) form luôn bắt đầu từ tài khoản & mẫu hiển thị MẶC
  // ĐỊNH lấy trực tiếp từ Google Sheet (cột isDefault/default), số tiền và
  // nội dung luôn để trống.
  applyDefaults();
  updateContentCounter($("#qrContent").value.trim());
  updateMauActiveUi();
  switchWorkspaceTab("qr");
  onGenerateQr(null, { silent: true });
}

document.addEventListener("DOMContentLoaded", init);