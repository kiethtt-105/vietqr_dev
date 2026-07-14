// ============================================================
// VietQR Generator — Trình tạo mã QR VietQR (chạy tĩnh trên GitHub Pages)
// 2 nguồn dữ liệu:
//   data/vietqr-banks.json  -> danh sách gốc VietQR (tham chiếu, read-only)
//                              nếu chưa có file này / load lỗi -> tự lấy thẳng từ API VietQR
//   data/my-accounts.json   -> tài khoản cá nhân (CRUD, đồng bộ GitHub)
// Mẫu hiển thị QR (compact2/compact/print/qr_only) là dữ liệu tĩnh khai báo
// ngay trong file này (QR_DISPLAY_TEMPLATES), không cần file riêng.
//
// Link API — 3 kiểu gọi:
//   1) ?amount=..&addInfo=..                -> dùng tài khoản MẶC ĐỊNH, trả thẳng ảnh QR
//   2) ?bank=<tên gợi nhớ>&amount=..&addInfo=.. -> tìm tài khoản theo "tên gợi nhớ" (list_name)
//   3) ?bank=<mã NH>&stk=<số TK>&amount=..&content=..&redirect=1 -> kiểu cũ, chỉ định thẳng
//   (addInfo và content là 2 tên tương đương cho nội dung chuyển khoản)
//   Thêm &format=text để trang chỉ in ra link ảnh thay vì chuyển thẳng tới ảnh.
// ============================================================

const LS_GH_CONFIG = "vietqr_gh_config";
const LS_GH_TOKEN = "vietqr_gh_token";
const LS_ACCOUNTS_CACHE = "vietqr_accounts_cache";
const LS_DEFAULTS = "vietqr_defaults"; // { accountKey, template }

const VIETQR_BANKS_API = "https://api.vietqr.io/v2/banks";

// Mẫu hiển thị QR: load từ data/templates.json lúc init(), có fallback cứng nếu fetch lỗi
let QR_DISPLAY_TEMPLATES = [
  { value: "compact2", label: "Compact 2" },
  { value: "compact", label: "Compact" },
  { value: "print", label: "Print" },
  { value: "qr_only", label: "Chỉ mã QR" },
];
async function loadQrDisplayTemplates() {
  try {
    const res = await fetch("data/templates.json");
    if (!res.ok) throw new Error("no file");
    const data = await res.json();
    if (Array.isArray(data) && data.length) QR_DISPLAY_TEMPLATES = data;
  } catch (e) {
    /* giữ nguyên fallback cứng ở trên nếu file chưa có / lỗi */
  }
}

let state = {
  refBanks: [],
  accounts: [],
  sha: { accounts: null },
  gh: { owner: "", repo: "", branch: "main", pathAccounts: "data/my-accounts.json" },
};

// ---------- Custom confirm dialog (thay window.confirm mặc định) ----------
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

// ---------- utils ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}
function base64ToUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function formatNumber(n) {
  const num = String(n).replace(/[^\d]/g, "");
  if (!num) return "";
  return Number(num).toLocaleString("vi-VN");
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

// ---------- GitHub config persistence ----------
function loadGhConfigFromStorage() {
  try {
    const cfg = JSON.parse(localStorage.getItem(LS_GH_CONFIG) || "{}");
    state.gh = { ...state.gh, ...cfg };
  } catch (e) {}
  $("#ghOwner").value = state.gh.owner || "";
  $("#ghRepo").value = state.gh.repo || "";
  $("#ghBranch").value = state.gh.branch || "main";
  $("#ghPathAccounts").value = state.gh.pathAccounts || "data/my-accounts.json";
  $("#ghToken").value = localStorage.getItem(LS_GH_TOKEN) || "";
  updateGhStatusLabel();
}
function saveGhConfigToStorage() {
  state.gh.owner = $("#ghOwner").value.trim();
  state.gh.repo = $("#ghRepo").value.trim();
  state.gh.branch = $("#ghBranch").value.trim() || "main";
  state.gh.pathAccounts = $("#ghPathAccounts").value.trim() || "data/my-accounts.json";
  localStorage.setItem(LS_GH_CONFIG, JSON.stringify(state.gh));
  const token = $("#ghToken").value.trim();
  if (token) localStorage.setItem(LS_GH_TOKEN, token);
  updateGhStatusLabel();
  setStatus($("#ghMsg"), "Đã lưu thông tin kết nối trên trình duyệt này.", "ok");
}
function getToken() {
  return localStorage.getItem(LS_GH_TOKEN) || "";
}
function updateGhStatusLabel() {
  const ok = state.gh.owner && state.gh.repo && getToken();
  $("#ghDot").className = "dot" + (ok ? " on" : "");
  $("#ghStatusLabel").textContent = ok ? `${state.gh.owner}/${state.gh.repo}` : "Chưa kết nối GitHub";
}
function ghApiUrl(path) {
  return `https://api.github.com/repos/${state.gh.owner}/${state.gh.repo}/contents/${path}`;
}

async function checkGhConnection() {
  const owner = $("#ghOwner").value.trim();
  const repo = $("#ghRepo").value.trim();
  const token = $("#ghToken").value.trim() || getToken();
  const btn = $("#btnGhCheck");
  const msgEl = $("#ghCheckMsg");

  if (!owner || !repo) {
    setStatus(msgEl, "Nhập owner/repo trước đã.", "err");
    return;
  }

  btn.disabled = true;
  const oldLabel = btn.textContent;
  btn.textContent = "Đang kiểm tra…";
  setStatus(msgEl, "");

  try {
    const headers = { Accept: "application/vnd.github+json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });

    if (res.status === 404) {
      throw new Error("Không tìm thấy repo, hoặc token chưa được cấp quyền truy cập repo này.");
    }
    if (res.status === 401) {
      throw new Error("Token không hợp lệ hoặc đã hết hạn.");
    }
    if (!res.ok) {
      throw new Error(`GitHub trả về lỗi ${res.status}.`);
    }

    const data = await res.json();
    const perm = data.permissions || {};

    if (!token) {
      setStatus(msgEl, `Repo ${owner}/${repo} tồn tại và công khai. Nhập token để kiểm tra quyền ghi.`, "ok");
      $("#ghDot").className = "dot";
    } else if (perm.push) {
      setStatus(msgEl, `Kết nối OK ✓ — token có quyền ghi vào ${owner}/${repo}.`, "ok");
      $("#ghDot").className = "dot on";
    } else if (perm.pull) {
      setStatus(msgEl, "Repo tồn tại nhưng token chỉ có quyền đọc — cấp lại quyền Contents: Read and write.", "err");
      $("#ghDot").className = "dot err";
    } else {
      setStatus(msgEl, "Đã kết nối tới repo nhưng không xác định được quyền ghi của token.", "err");
      $("#ghDot").className = "dot err";
    }
  } catch (err) {
    console.error(err);
    setStatus(msgEl, err.message, "err");
    $("#ghDot").className = "dot err";
  } finally {
    btn.disabled = false;
    btn.textContent = oldLabel;
  }
}

// ---------- Generic GitHub read/write for a JSON file ----------
async function ghReadJson(path) {
  const headers = { Accept: "application/vnd.github+json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${ghApiUrl(path)}?ref=${encodeURIComponent(state.gh.branch)}`, { headers });
  if (res.status === 404) return { sha: null, data: null };
  if (!res.ok) throw new Error(`GitHub trả về lỗi ${res.status} (${path})`);
  const payload = await res.json();
  return { sha: payload.sha, data: JSON.parse(base64ToUtf8(payload.content)) };
}
async function ghWriteJson(path, data, sha, message) {
  const token = getToken();
  if (!token) throw new Error("Cần Personal Access Token để ghi lên GitHub.");
  const body = { message, content: utf8ToBase64(JSON.stringify(data, null, 2)), branch: state.gh.branch };
  if (sha) body.sha = sha;
  const res = await fetch(ghApiUrl(path), {
    method: "PUT",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.message || `GitHub trả về lỗi ${res.status} (${path})`);
  return payload.content.sha;
}

async function loadAllFromGithub() {
  if (!state.gh.owner || !state.gh.repo) {
    setStatus($("#ghMsg"), "Nhập owner/repo trước đã.", "err");
    return;
  }
  setStatus($("#ghMsg"), "Đang tải từ GitHub…");
  try {
    const acc = await ghReadJson(state.gh.pathAccounts);
    if (acc.data) {
      state.accounts = acc.data;
      state.sha.accounts = acc.sha;
      localStorage.setItem(LS_ACCOUNTS_CACHE, JSON.stringify(acc.data));
    }
    renderTable();
    populateQrAccounts();
    setStatus($("#ghMsg"), `Đã tải ${state.accounts.length} tài khoản.`, "ok");
    $("#ghDot").className = "dot on";
  } catch (err) {
    console.error(err);
    setStatus($("#ghMsg"), "Lỗi tải dữ liệu: " + err.message, "err");
    $("#ghDot").className = "dot err";
  }
}

async function saveAccountsToGithub() {
  if (!state.gh.owner || !state.gh.repo) {
    setStatus($("#ghMsg"), "Chưa cấu hình GitHub — mở tab Kết nối GitHub.", "err");
    openSettingsModal("github");
    return;
  }
  setStatus($("#ghMsg"), "Đang lưu tài khoản lên GitHub…");
  try {
    state.sha.accounts = await ghWriteJson(
      state.gh.pathAccounts,
      state.accounts,
      state.sha.accounts,
      `chore: cập nhật my-accounts.json (${new Date().toISOString()})`
    );
    setStatus($("#ghMsg"), "Đã lưu danh sách tài khoản lên GitHub ✓", "ok");
  } catch (err) {
    console.error(err);
    setStatus($("#ghMsg"), "Lỗi khi lưu: " + err.message, "err");
    openSettingsModal("github");
  }
}

// ---------- Reference bank list (vietqr-banks.json) ----------
function mapVietQrApiBanks(payload) {
  if (!payload || !Array.isArray(payload.data)) return [];
  return payload.data.map((b) => ({
    id: b.id,
    name: b.name,
    code: b.code,
    bin: b.bin,
    shortName: b.shortName,
    logo: b.logo,
    short_name: b.short_name,
  }));
}
async function loadRefBanks() {
  // Ưu tiên file cục bộ trong repo, nếu chưa có / lỗi thì lấy thẳng từ API VietQR
  // (đây là nguyên nhân chính khiến "+ Thêm dòng" trước đó như không hoạt động:
  //  dropdown ngân hàng bị rỗng vì data/vietqr-banks.json chưa tồn tại)
  try {
    const res = await fetch("data/vietqr-banks.json");
    if (!res.ok) throw new Error("no local file");
    const data = await res.json();
    if (Array.isArray(data) && data.length) {
      state.refBanks = data;
      return;
    }
    throw new Error("empty local file");
  } catch (e) {
    /* rơi xuống lấy từ API */
  }
  try {
    const res = await fetch(VIETQR_BANKS_API);
    const payload = await res.json();
    state.refBanks = mapVietQrApiBanks(payload);
  } catch (e2) {
    state.refBanks = [];
  }
}
async function refreshRefBanksFromVietQR() {
  const btn = $("#btnRefreshBanks");
  const original = btn.textContent;
  btn.textContent = "Đang tải…";
  btn.disabled = true;
  try {
    const res = await fetch(VIETQR_BANKS_API);
    const payload = await res.json();
    const banks = mapVietQrApiBanks(payload);
    if (!banks.length) throw new Error("Không đọc được dữ liệu từ VietQR");
    state.refBanks = banks;
    renderTable();
    btn.textContent = `Đã cập nhật ${state.refBanks.length} ngân hàng ✓`;
  } catch (err) {
    console.error(err);
    btn.textContent = "Lỗi tải — thử lại sau";
  } finally {
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
    }, 2500);
  }
}
function bankOptionsHtml(selectedCode) {
  return state.refBanks
    .map(
      (b) =>
        `<option value="${b.code}" ${b.code === selectedCode ? "selected" : ""}>${escapeHtml(b.shortName)} — ${b.code}</option>`
    )
    .join("");
}

// ---------- Accounts table CRUD ----------
function loadAccountsCache() {
  const cached = localStorage.getItem(LS_ACCOUNTS_CACHE);
  if (cached) {
    try {
      state.accounts = JSON.parse(cached);
      return;
    } catch (e) {}
  }
}
async function loadAccountsInitial() {
  loadAccountsCache();
  if (state.accounts.length) return;
  try {
    const res = await fetch("data/my-accounts.json");
    state.accounts = await res.json();
  } catch (e) {
    state.accounts = [];
  }
}
// Dùng cho đường API nhanh (redirect thẳng): chỉ đọc cache / fetch nhẹ, không đụng DOM
async function ensureAccountsLoaded() {
  if (state.accounts.length) return;
  loadAccountsCache();
  if (state.accounts.length) return;
  try {
    const res = await fetch("data/my-accounts.json");
    if (res.ok) state.accounts = await res.json();
  } catch (e) {
    state.accounts = [];
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
function renderTable() {
  const body = $("#bankTableBody");
  body.innerHTML = "";
  state.accounts.forEach((acc, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input data-idx="${idx}" data-field="list_name" value="${escapeAttr(acc.list_name)}"></td>
      <td><input data-idx="${idx}" data-field="data_num" value="${escapeAttr(acc.data_num)}"></td>
      <td><input data-idx="${idx}" data-field="name_ac" value="${escapeAttr(acc.name_ac)}"></td>
      <td>
        <select class="bank-select" data-idx="${idx}">${bankOptionsHtml(acc.data__code)}</select>
        <div class="bank-meta">BIN ${escapeHtml(acc.data__bin || "—")} · id ${acc.data__id ?? "—"}</div>
      </td>
      <td class="row-actions"><button class="icon-btn" title="Xoá dòng" data-del="${idx}">✕</button></td>`;
    body.appendChild(tr);
  });
  $("#rowCount").textContent = `${state.accounts.length} dòng`;
  if (!state.refBanks.length) {
    setStatus($("#ghMsg"), "Chưa có danh sách ngân hàng — bấm \"Làm mới ngân hàng từ VietQR\".", "err");
  }

  body.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", (e) => {
      const idx = Number(e.target.dataset.idx);
      const field = e.target.dataset.field;
      state.accounts[idx][field] = e.target.value;
      populateQrAccounts();
    });
  });
  body.querySelectorAll("select.bank-select").forEach((sel) => {
    sel.addEventListener("change", (e) => {
      const idx = Number(e.target.dataset.idx);
      applyBankToRow(idx, e.target.value);
      renderTable();
      populateQrAccounts();
    });
  });
  body.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const idx = Number(e.target.dataset.del);
      const ok = await showConfirm(`Xoá dòng "${state.accounts[idx].list_name}"?`);
      if (ok) {
        state.accounts.splice(idx, 1);
        renderTable();
        populateQrAccounts();
      }
    });
  });
}
async function addRow() {
  const btn = $("#btnAddRow");
  // Nếu chưa có danh sách ngân hàng thì tự tải trước, tránh dòng mới bị kẹt "không có ngân hàng để chọn"
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
    list_name: "Tài khoản mới",
    data_num: "",
    name_ac: "",
    data__name: defaultBank.shortName || "",
    data__code: defaultBank.code || "",
    data__bin: defaultBank.bin || "",
    data__shortName: defaultBank.shortName || "",
    data__logo: defaultBank.logo || "",
    data__short_name: defaultBank.short_name || "",
  });
  renderTable();
  populateQrAccounts();
}

// ---------- Mặc định: tài khoản + mẫu hiển thị QR ----------
function accountKey(acc) {
  return `${acc.list_name}|${acc.data_num}`;
}
function findAccountByNickname(nick) {
  if (!nick) return null;
  const n = String(nick).trim().toLowerCase();
  return state.accounts.find((a) => (a.list_name || "").trim().toLowerCase() === n) || null;
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
  if (defaults.accountKey) {
    const idx = state.accounts.findIndex((a) => accountKey(a) === defaults.accountKey);
    if (idx >= 0) $("#qrAccount").value = idx;
  }
  $("#qrTemplate").value = defaults.template || "compact2";
}
function setDefaultAccount() {
  const idx = Number($("#qrAccount").value);
  const acc = state.accounts[idx];
  if (!acc) return;
  const defaults = loadDefaults();
  defaults.accountKey = accountKey(acc);
  localStorage.setItem(LS_DEFAULTS, JSON.stringify(defaults));
  flashLinkBtn("#btnSetDefaultAccount", "★ Đã đặt mặc định");
}
function flashLinkBtn(sel, text) {
  const btn = $(sel);
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = original), 1600);
}

// ---------- QR tab ----------
function populateQrTemplateOptions() {
  const sel = $("#qrTemplate");
  const prev = sel.value;
  sel.innerHTML = QR_DISPLAY_TEMPLATES.map((t) => `<option value="${t.value}">${escapeHtml(t.label)}</option>`).join("");
  if (prev) sel.value = prev;
}
function populateQrAccounts() {
  const sel = $("#qrAccount");
  const prev = sel.value;
  sel.innerHTML = state.accounts
    .map((a, i) => `<option value="${i}">${escapeHtml(a.list_name)} — ${escapeHtml(a.data_num)} (${escapeHtml(a.data__code)})</option>`)
    .join("");
  if (prev && Number(prev) < state.accounts.length) {
    sel.value = prev;
  } else {
    applyDefaults();
  }
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
  const url = buildQrUrl(acc, amount, content, template);

  $("#qrImage").src = url;
  $("#qrCardBank").textContent = acc.data__name || acc.data__code;

  $("#qrCard").hidden = false;
  $("#qrEmpty").hidden = true;
  $("#qrActions").hidden = false;
  $("#btnDownload").href = url;
  $("#btnCopyLink").dataset.url = url;

  const apiParams = new URLSearchParams();
  apiParams.set("bank", acc.data__code);
  apiParams.set("stk", acc.data_num);
  if (amount) apiParams.set("amount", amount);
  if (content) apiParams.set("content", content);
  apiParams.set("template", template);
  apiParams.set("redirect", "1");
  const apiUrl = `${location.origin}${location.pathname}?${apiParams.toString()}`;
  $("#btnCopyApiLink").dataset.url = apiUrl;

  restartAnimation($("#qrCard"));
}

// ---------- Link API ----------
// resolveApiAccount quyết định dùng tài khoản nào dựa trên tham số URL:
//  - bank + stk (đủ cả 2)      -> dùng thẳng như cũ, không tự redirect trừ khi có &redirect=1
//  - bank (là tên gợi nhớ, không có stk) -> tra trong danh sách tài khoản theo list_name, tự redirect
//  - không có bank/stk         -> dùng tài khoản mặc định (hoặc tài khoản đầu tiên), tự redirect
function resolveApiAccount(params) {
  const bankParam = (params.get("bank") || "").trim();
  const stkParam = (params.get("stk") || "").trim();

  if (bankParam && stkParam) {
    const idx = state.accounts.findIndex((a) => a.data__code === bankParam && a.data_num === stkParam);
    const acc = idx >= 0 ? state.accounts[idx] : null;
    return {
      bank: bankParam,
      stk: stkParam,
      name: params.get("name") || (acc ? acc.name_ac : ""),
      idx,
      auto: false,
    };
  }

  if (bankParam && !stkParam) {
    const acc = findAccountByNickname(bankParam);
    if (acc) {
      return { bank: acc.data__code, stk: acc.data_num, name: acc.name_ac, idx: state.accounts.indexOf(acc), auto: true };
    }
  }

  const defaults = loadDefaults();
  let acc = null;
  if (defaults.accountKey) {
    acc = state.accounts.find((a) => accountKey(a) === defaults.accountKey) || null;
  }
  if (!acc) acc = state.accounts[0] || null;
  if (!acc) return null;
  return { bank: acc.data__code, stk: acc.data_num, name: acc.name_ac, idx: state.accounts.indexOf(acc), auto: true };
}

async function handleApiParams() {
  const params = new URLSearchParams(window.location.search);
  const hasApiIntent =
    params.has("bank") || params.has("stk") || params.has("amount") || params.has("content") || params.has("addInfo");
  if (!hasApiIntent) return false;

  await ensureAccountsLoaded();

  const resolved = resolveApiAccount(params);
  if (!resolved) return false; // chưa có tài khoản nào -> mở app bình thường để thêm tài khoản trước

  const amount = rawNumber(params.get("amount") || "");
  const content = params.get("content") || params.get("addInfo") || "";
  const template = params.get("template") || loadDefaults().template || "compact2";
  const url = buildQrUrlRaw(resolved.bank, resolved.stk, amount, content, template, resolved.name);

  const wantsText = params.get("format") === "text";
  const wantsRedirect = params.get("redirect") === "1" || (resolved.auto && params.get("redirect") !== "0");

  if (wantsText) {
    document.documentElement.innerHTML = "";
    document.body = document.createElement("body");
    document.body.style.cssText =
      "margin:0;padding:16px;font-family:monospace;font-size:13px;background:#fff;color:#000;word-break:break-all;";
    document.body.textContent = url;
    document.title = "VietQR link";
    return true;
  }
  if (wantsRedirect) {
    window.location.replace(url);
    return true;
  }

  // Không redirect/text -> điền sẵn vào form bình thường sau khi init xong
  window.__apiPrefill = { bank: resolved.bank, stk: resolved.stk, amount, content, template, name: resolved.name, idx: resolved.idx };
  return false;
}
function applyApiPrefill() {
  const p = window.__apiPrefill;
  if (!p) return;
  let idx = p.idx != null && p.idx >= 0 ? p.idx : state.accounts.findIndex((a) => a.data__code === p.bank && a.data_num === p.stk);
  if (idx < 0) {
    state.accounts.push({
      data__id: 0,
      list_name: "Từ link",
      data_num: p.stk,
      name_ac: p.name || "",
      data__name: p.bank,
      data__code: p.bank,
      data__bin: "",
      data__shortName: p.bank,
      data__logo: "",
      data__short_name: p.bank,
    });
    renderTable();
    populateQrAccounts();
    idx = state.accounts.length - 1;
  }
  $("#qrAccount").value = idx;
  $("#qrAmount").value = formatNumber(p.amount);
  $("#qrContent").value = p.content;
  if (p.template) $("#qrTemplate").value = p.template;
  onGenerateQr(null);
}

// ---------- Settings modal (danh sách tài khoản + kết nối GitHub) ----------
function switchSettingsTab(tabName) {
  $$(".settings-tabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.settingsTab === tabName));
  $("#settingsTabAccounts").hidden = tabName !== "accounts";
  $("#settingsTabGithub").hidden = tabName !== "github";
}
function openSettingsModal(tabName) {
  $("#settingsBackdrop").hidden = false;
  switchSettingsTab(tabName || "accounts");
}
function closeSettingsModal() {
  $("#settingsBackdrop").hidden = true;
}

// ---------- Init ----------
async function init() {
  const handled = await handleApiParams();
  if (handled) return; // đã redirect hoặc in ra text, không cần dựng UI

  loadGhConfigFromStorage();

  await loadRefBanks();
  await loadAccountsInitial();
  await loadQrDisplayTemplates();

  renderTable();
  populateQrTemplateOptions();
  populateQrAccounts();

  $("#btnOpenSettings").addEventListener("click", () => openSettingsModal("accounts"));
  $("#btnOpenSettingsGithub").addEventListener("click", () => openSettingsModal("github"));
  $("#btnSettingsClose").addEventListener("click", closeSettingsModal);
  $("#settingsBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "settingsBackdrop") closeSettingsModal();
  });
  $$(".settings-tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => switchSettingsTab(tab.dataset.settingsTab));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("#confirmBackdrop").hidden) return; // để confirm dialog tự xử lý Escape của riêng nó
    if (!$("#settingsBackdrop").hidden) closeSettingsModal();
  });
  $("#btnToggleTokenVisibility").addEventListener("click", () => {
    const input = $("#ghToken");
    const btn = $("#btnToggleTokenVisibility");
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    btn.textContent = showing ? "👁" : "🙈";
  });
  $("#btnGhSave").addEventListener("click", saveGhConfigToStorage);
  $("#btnGhLoad").addEventListener("click", loadAllFromGithub);
  $("#btnGhCheck").addEventListener("click", checkGhConnection);
  $("#btnGhForget").addEventListener("click", () => {
    localStorage.removeItem(LS_GH_TOKEN);
    $("#ghToken").value = "";
    updateGhStatusLabel();
    setStatus($("#ghMsg"), "Đã xoá token khỏi trình duyệt.", "ok");
    setStatus($("#ghCheckMsg"), "");
  });

  $("#btnAddRow").addEventListener("click", addRow);
  $("#btnRefreshBanks").addEventListener("click", refreshRefBanksFromVietQR);
  $("#btnSaveGithub").addEventListener("click", async () => {
    localStorage.setItem(LS_ACCOUNTS_CACHE, JSON.stringify(state.accounts));
    await saveAccountsToGithub();
  });

  $("#btnSetDefaultAccount").addEventListener("click", setDefaultAccount);

  $("#qrForm").addEventListener("submit", (e) => onGenerateQr(e));
  $("#qrAmount").addEventListener("input", (e) => {
    e.target.value = formatNumber(e.target.value);
  });

  const liveGenerate = debounce(() => onGenerateQr(null, { silent: true }), 350);
  $("#qrAccount").addEventListener("change", () => onGenerateQr(null, { silent: true }));
  $("#qrTemplate").addEventListener("change", () => onGenerateQr(null, { silent: true }));
  $("#qrAmount").addEventListener("input", liveGenerate);
  $("#qrContent").addEventListener("input", liveGenerate);
  $("#btnCopyLink").addEventListener("click", async (e) => {
    const url = e.target.dataset.url;
    if (!url) return;
    await navigator.clipboard.writeText(url);
    e.target.textContent = "Đã sao chép ✓";
    setTimeout(() => (e.target.textContent = "Sao chép link ảnh"), 1500);
  });
  $("#btnCopyApiLink").addEventListener("click", async (e) => {
    const url = e.target.dataset.url;
    if (!url) {
      alert("Tạo mã QR trước đã, rồi mới sao chép link API.");
      return;
    }
    await navigator.clipboard.writeText(url);
    e.target.textContent = "Đã sao chép ✓";
    setTimeout(() => (e.target.textContent = "Sao chép link API"), 1500);
  });

  applyDefaults();
  if (window.__apiPrefill) {
    applyApiPrefill();
  } else {
    onGenerateQr(null, { silent: true });
  }
}

document.addEventListener("DOMContentLoaded", init);