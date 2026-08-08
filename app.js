// ============================================================
// VietQR Generator — Trình tạo mã QR VietQR (chạy tĩnh trên GitHub Pages)
// 2 nguồn dữ liệu:
//   data/vietqr-banks.json  -> danh sách gốc VietQR (tham chiếu, read-only)
//                              nếu chưa có file này / load lỗi -> tự lấy thẳng từ API VietQR
//   data/my-accounts.json   -> tài khoản cá nhân (CRUD, đồng bộ GitHub)
// Mẫu hiển thị QR (compact2/compact/print/qr_only) là dữ liệu tĩnh khai báo
// ngay trong file này (QR_DISPLAY_TEMPLATES), không cần file riêng.
//
// Giao diện tách 2 cửa sổ:
//   - "Mẫu giao dịch": danh sách mẫu chuyển tiền, bấm để nạp vào form.
//   - "Tạo giao dịch": form tạo mã QR (tài khoản/số tiền/nội dung/mẫu hiển thị).
// Toàn bộ thông tin đang nhập ở form (tài khoản, số tiền, nội dung, mẫu hiển
// thị, mẫu giao dịch đang chọn) được lưu vào localStorage sau mỗi lần thay
// đổi -> mở lại / F5 không bị mất. Nút "Xoá thông tin" xoá dữ liệu đã lưu này.
// ============================================================

const LS_GH_CONFIG = "vietqr_gh_config";
const LS_GH_TOKEN = "vietqr_gh_token";
const LS_ACCOUNTS_CACHE = "vietqr_accounts_cache";
const LS_PRESETS_CACHE = "vietqr_presets_cache";
const LS_DEFAULTS = "vietqr_defaults"; // { accountKey, template }
const LS_FORM_STATE = "vietqr_form_state"; // { accountIdx, amount, content, template, selectedPresetIdx }
const LS_REFBANKS_CACHE = "vietqr_refbanks_cache"; // { data, fetchedAt }
const REFBANKS_TTL_MS = 12 * 60 * 60 * 1000; // 12 giờ — tránh gọi API VietQR mỗi lần mở app

const VIETQR_BANKS_API = "https://api.vietqr.io/v2/banks";
const ADDINFO_SOFT_LIMIT = 25; // giới hạn addInfo phổ biến của nhiều ngân hàng qua VietQR
const AMOUNT_WARN_THRESHOLD = 500_000_000; // ngưỡng cảnh báo số tiền bất thường

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

// Danh sách nội dung chuyển khoản gợi ý -> load từ data/noi-dung-chuyen-khoan.json
// Mỗi phần tử là 1 chuỗi (string). Không có -> ẩn hẳn khu vực gợi ý.
let CONTENT_SUGGESTIONS = [];
async function loadContentSuggestions() {
  try {
    const res = await fetch("data/noi-dung-chuyen-khoan.json");
    if (!res.ok) throw new Error("no file");
    const data = await res.json();
    if (Array.isArray(data)) CONTENT_SUGGESTIONS = data.filter((v) => typeof v === "string" && v.trim());
  } catch (e) {
    CONTENT_SUGGESTIONS = [];
  }
}

// Mẫu chuyển tiền (preset điền nhanh cả tài khoản/số tiền/mẫu hiển thị/nội dung) —
// lưu ở state.presets, load/sync giống hệt state.accounts (cache -> file cục bộ -> GitHub).
// Mỗi phần tử: { name, accountName, amount, content, template }.
// accountName để trống -> giữ nguyên tài khoản đang chọn khi áp dụng mẫu.

let state = {
  refBanks: [],
  accounts: [],
  presets: [],
  selectedPresetIdx: null, // mẫu giao dịch đang được nạp vào form (null = không có)
  sha: { accounts: null, presets: null },
  gh: { owner: "", repo: "", branch: "main", pathAccounts: "data/my-accounts.json", pathPresets: "data/mau-chuyen-tien.json" },
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

// ---------- Toast notification ----------
const TOAST_MAX_VISIBLE = 4; // giới hạn số toast chồng cùng lúc, tránh spam khi thao tác liên tiếp
function showToast(message, kind, opts) {
  const stack = document.getElementById("toastStack");
  if (!stack) return;
  // Nếu đã đầy, dọn bớt toast cũ nhất (không animation-out, để nhường chỗ ngay)
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
  $("#ghPathPresets").value = state.gh.pathPresets || "data/mau-chuyen-tien.json";
  $("#ghToken").value = localStorage.getItem(LS_GH_TOKEN) || "";
  updateGhStatusLabel();
}
function saveGhConfigToStorage() {
  state.gh.owner = $("#ghOwner").value.trim();
  state.gh.repo = $("#ghRepo").value.trim();
  state.gh.branch = $("#ghBranch").value.trim() || "main";
  state.gh.pathAccounts = $("#ghPathAccounts").value.trim() || "data/my-accounts.json";
  state.gh.pathPresets = $("#ghPathPresets").value.trim() || "data/mau-chuyen-tien.json";
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

  async function put(currentSha) {
    const body = {
      message,
      content: utf8ToBase64(JSON.stringify(data, null, 2)),
      branch: state.gh.branch,
    };
    if (currentSha) body.sha = currentSha;

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
    if (!res.ok) {
      const err = new Error(payload.message || `GitHub trả về lỗi ${res.status} (${path})`);
      err.status = res.status;
      throw err;
    }
    return payload.content.sha;
  }

  try {
    // Nếu chưa có SHA → lấy mới từ GitHub
    let currentSha = sha;
    if (!currentSha) {
      const latest = await ghReadJson(path);
      currentSha = latest.sha;
    }
    return await put(currentSha);
  } catch (err) {
    // SHA cũ không khớp → lấy SHA mới nhất rồi thử lại 1 lần
    const isShaMismatch =
      err.status === 409 ||
      (err.message && /does not match|sha.*mismatch|conflict/i.test(err.message));
    if (!isShaMismatch) throw err;

    const latest = await ghReadJson(path);
    return await put(latest.sha);
  }
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
      sortAccountsByStt();
      localStorage.setItem(LS_ACCOUNTS_CACHE, JSON.stringify(state.accounts));
    }
    const presets = await ghReadJson(state.gh.pathPresets);
    if (presets.data) {
      state.presets = presets.data;
      state.sha.presets = presets.sha;
      savePresetsCache();
    }
    renderTable();
    populateQrAccounts();
    renderMauList();
    setStatus($("#ghMsg"), `Đã tải ${state.accounts.length} tài khoản, ${state.presets.length} mẫu chuyển tiền.`, "ok");
    $("#ghDot").className = "dot on";
  } catch (err) {
    console.error(err);
    setStatus($("#ghMsg"), "Lỗi tải dữ liệu: " + err.message, "err");
    $("#ghDot").className = "dot err";
  }
}

// Tự động kéo dữ liệu mới nhất từ GitHub ngay khi mở app (nếu đã cấu hình kết nối) —
// không cần bấm nút "Tải dữ liệu từ GitHub" thủ công mỗi lần. Chạy ngầm, lỗi thì bỏ qua
// trong im lặng (vẫn còn dữ liệu cache cục bộ để dùng), không làm phiền lúc mới mở app.
async function syncFromGithubSilently() {
  if (!state.gh.owner || !state.gh.repo || !getToken()) return;
  try {
    let changed = false;
    const acc = await ghReadJson(state.gh.pathAccounts);
    if (acc.data) {
      state.accounts = acc.data;
      state.sha.accounts = acc.sha;
      sortAccountsByStt();
      localStorage.setItem(LS_ACCOUNTS_CACHE, JSON.stringify(state.accounts));
      changed = true;
    }
    const presets = await ghReadJson(state.gh.pathPresets);
    if (presets.data) {
      state.presets = presets.data;
      state.sha.presets = presets.sha;
      savePresetsCache();
      changed = true;
    }
    if (changed) {
      renderTable();
      populateQrAccounts();
      renderMauList();
      updateMauActiveUi();
      onGenerateQr(null, { silent: true });
    }
    $("#ghDot").className = "dot on";
  } catch (err) {
    console.error("Tự động đồng bộ GitHub lỗi:", err);
  }
}

async function saveAccountsToGithub() {
  if (!state.gh.owner || !state.gh.repo) {
    setStatus($("#ghMsg"), "Chưa cấu hình GitHub — mở tab Kết nối GitHub.", "err");
    openSettingsModal("github");
    return;
  }
  if (!state.accounts.length) {
    const ok = await showConfirm(
      "Danh sách tài khoản đang trống — lưu lúc này sẽ XOÁ TOÀN BỘ dữ liệu tài khoản đang có trên GitHub. Vẫn tiếp tục?",
      "Vẫn lưu (xoá hết)"
    );
    if (!ok) return;
  }
  const invalidRows = [];
  state.accounts.forEach((acc, i) => {
    const missing = [];
    if (!acc.list_name || !acc.list_name.trim()) missing.push("tên gợi nhớ");
    if (!acc.data_num || !String(acc.data_num).trim()) missing.push("số tài khoản");
    if (!acc.name_ac || !acc.name_ac.trim()) missing.push("chủ tài khoản");
    if (!acc.data__code || !acc.data__code.trim()) missing.push("ngân hàng");
    if (missing.length) invalidRows.push({ row: i + 1, missing });
  });
  if (invalidRows.length) {
    const detail = invalidRows.map((r) => `dòng ${r.row} (thiếu ${r.missing.join(", ")})`).join("; ");
    setStatus($("#ghMsg"), `Chưa lưu được: ${detail}. Điền đủ hoặc xoá dòng đó trước khi lưu.`, "err");
    showToast("Còn dòng tài khoản chưa điền đủ thông tin", "err");
    openSettingsModal("accounts");
    return;
  }
  const btn = $("#btnSaveGithub");
  btn.classList.add("is-loading");
  btn.disabled = true;
  setStatus($("#ghMsg"), "Đang lưu tài khoản lên GitHub…");
  try {
    state.sha.accounts = await ghWriteJson(
      state.gh.pathAccounts,
      state.accounts,
      state.sha.accounts,
      `chore: cập nhật my-accounts.json (${new Date().toISOString()})`
    );
    setStatus($("#ghMsg"), "Đã lưu danh sách tài khoản lên GitHub ✓", "ok");
    showToast("Đã lưu tài khoản lên GitHub ✓", "ok");
  } catch (err) {
    console.error(err);
    setStatus($("#ghMsg"), "Lỗi khi lưu: " + err.message, "err");
    showToast("Lỗi khi lưu lên GitHub", "err");
    openSettingsModal("github");
  } finally {
    btn.classList.remove("is-loading");
    btn.disabled = false;
  }
}

async function savePresetsToGithub() {
  if (!state.gh.owner || !state.gh.repo) {
    setStatus($("#ghMsg"), "Chưa cấu hình GitHub — mở tab Kết nối GitHub.", "err");
    openSettingsModal("github");
    return;
  }
  if (!state.presets.length) {
    const ok = await showConfirm(
      "Danh sách mẫu chuyển tiền đang trống — lưu lúc này sẽ XOÁ TOÀN BỘ mẫu đang có trên GitHub. Vẫn tiếp tục?",
      "Vẫn lưu (xoá hết)"
    );
    if (!ok) return;
  }
  const emptyRows = state.presets
    .map((p, i) => (!p.name || !p.name.trim() ? i + 1 : null))
    .filter((n) => n != null);
  if (emptyRows.length) {
    showToast(`Mẫu ở dòng ${emptyRows.join(", ")} chưa có tên — điền hoặc xoá trước khi lưu.`, "err");
    return;
  }
  const btn = $("#btnSaveMauGithub");
  btn.classList.add("is-loading");
  btn.disabled = true;
  setStatus($("#ghMsg"), "Đang lưu mẫu chuyển tiền lên GitHub…");
  try {
    state.sha.presets = await ghWriteJson(
      state.gh.pathPresets,
      state.presets,
      state.sha.presets,
      `chore: cập nhật mau-chuyen-tien.json (${new Date().toISOString()})`
    );
    setStatus($("#ghMsg"), "Đã lưu mẫu chuyển tiền lên GitHub ✓", "ok");
    showToast("Đã lưu mẫu chuyển tiền lên GitHub ✓", "ok");
  } catch (err) {
    console.error(err);
    setStatus($("#ghMsg"), "Lỗi khi lưu: " + err.message, "err");
    showToast("Lỗi khi lưu lên GitHub", "err");
    openSettingsModal("github");
  } finally {
    btn.classList.remove("is-loading");
    btn.disabled = false;
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
function readRefBanksCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_REFBANKS_CACHE) || "null");
    if (raw && Array.isArray(raw.data) && raw.data.length) return raw;
  } catch (e) {}
  return null;
}
function writeRefBanksCache(data) {
  try {
    localStorage.setItem(LS_REFBANKS_CACHE, JSON.stringify({ data, fetchedAt: Date.now() }));
  } catch (e) {}
}
async function fetchRefBanksFromApi() {
  const res = await fetch(VIETQR_BANKS_API);
  const payload = await res.json();
  return mapVietQrApiBanks(payload);
}
async function loadRefBanks() {
  // Ưu tiên file cục bộ trong repo, nếu chưa có / lỗi thì lấy thẳng từ API VietQR
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
    /* rơi xuống lấy từ cache/API */
  }
  const cached = readRefBanksCache();
  if (cached && Date.now() - cached.fetchedAt < REFBANKS_TTL_MS) {
    state.refBanks = cached.data;
    return;
  }
  try {
    const banks = await fetchRefBanksFromApi();
    if (banks.length) {
      state.refBanks = banks;
      writeRefBanksCache(banks);
      return;
    }
    throw new Error("empty api response");
  } catch (e2) {
    state.refBanks = cached ? cached.data : [];
  }
}
async function refreshRefBanksFromVietQR() {
  const btn = $("#btnRefreshBanks");
  const original = btn.textContent;
  btn.classList.add("is-loading");
  btn.disabled = true;
  try {
    const banks = await fetchRefBanksFromApi();
    if (!banks.length) throw new Error("Không đọc được dữ liệu từ VietQR");
    state.refBanks = banks;
    writeRefBanksCache(banks);
    renderTable();
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
  applyBankToRow(idx, code);
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
  if (state.accounts.length) {
    sortAccountsByStt();
    return;
  }
  try {
    const res = await fetch("data/my-accounts.json");
    state.accounts = await res.json();
  } catch (e) {
    state.accounts = [];
  }
  sortAccountsByStt();
}

// ---------- Presets (mẫu chuyển tiền) cache + load ----------
function loadPresetsCache() {
  const cached = localStorage.getItem(LS_PRESETS_CACHE);
  if (cached) {
    try {
      state.presets = JSON.parse(cached);
      return;
    } catch (e) {}
  }
}
async function loadPresetsInitial() {
  loadPresetsCache();
  if (state.presets.length) return;
  try {
    const res = await fetch("data/mau-chuyen-tien.json");
    if (res.ok) state.presets = await res.json();
  } catch (e) {
    state.presets = [];
  }
}
function savePresetsCache() {
  localStorage.setItem(LS_PRESETS_CACHE, JSON.stringify(state.presets));
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
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="stt-cell">${idx + 1}</td>
      <td data-label="Tên gợi nhớ"><input data-idx="${idx}" data-field="list_name" value="${escapeAttr(acc.list_name)}"></td>
      <td data-label="Số tài khoản"><input data-idx="${idx}" data-field="data_num" value="${escapeAttr(acc.data_num)}"></td>
      <td data-label="Chủ tài khoản"><input data-idx="${idx}" data-field="name_ac" value="${escapeAttr(acc.name_ac)}"></td>
      <td data-label="Ngân hàng">
        <input type="text" class="bank-input" data-idx="${idx}" autocomplete="off"
          placeholder="🔎 Tìm ngân hàng…" value="${escapeAttr(bankLabelForRow(acc))}">
      </td>
      <td class="row-actions">
        <button class="icon-btn order-btn" title="Đưa lên trên" data-move="${idx}" data-dir="-1" ${!sortable || idx === 0 ? "disabled" : ""}>▲</button>
        <button class="icon-btn order-btn" title="Đưa xuống dưới" data-move="${idx}" data-dir="1" ${!sortable || idx === state.accounts.length - 1 ? "disabled" : ""}>▼</button>
        <button class="icon-btn" title="Xoá dòng" data-del="${idx}">✕</button>
      </td>`;
    body.appendChild(tr);
  });
  $("#rowCount").textContent = q ? `${shown}/${state.accounts.length} dòng` : `${state.accounts.length} dòng`;
  if (!state.refBanks.length) {
    setStatus($("#ghMsg"), "Chưa có danh sách ngân hàng — bấm \"Làm mới ngân hàng từ VietQR\".", "err");
  }

  body.querySelectorAll("input[data-field]").forEach((input) => {
    input.addEventListener("input", (e) => {
      const idx = Number(e.target.dataset.idx);
      const field = e.target.dataset.field;
      state.accounts[idx][field] = e.target.value;
      populateQrAccounts();
    });
  });
  body.querySelectorAll("input.bank-input").forEach((input) => {
    input.addEventListener("focus", (e) => openBankPicker(Number(e.target.dataset.idx), e.target));
    input.addEventListener("click", (e) => openBankPicker(Number(e.target.dataset.idx), e.target));
    input.addEventListener("input", (e) => renderBankPickerList(Number(e.target.dataset.idx), e.target.value));
    input.addEventListener("blur", (e) => {
      // gõ tìm rồi bấm ra ngoài mà không chọn -> khôi phục lại đúng tên ngân hàng đang lưu
      const i = Number(e.target.dataset.idx);
      e.target.value = bankLabelForRow(state.accounts[i]);
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
    btn.addEventListener("click", (e) => {
      const idx = Number(e.target.dataset.del);
      const removedAcc = state.accounts[idx];
      const name = removedAcc.list_name;
      state.accounts.splice(idx, 1);
      renumberAccountsStt();
      renderTable();
      populateQrAccounts();
      showToast(`Đã xoá "${name}"`, "ok", {
        duration: 5000,
        actionLabel: "Hoàn tác",
        onAction: () => {
          const restoreAt = Math.min(idx, state.accounts.length);
          state.accounts.splice(restoreAt, 0, removedAcc);
          renumberAccountsStt();
          renderTable();
          populateQrAccounts();
          showToast(`Đã khôi phục "${name}"`, "ok");
        },
      });
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
  renumberAccountsStt();
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

// ---------- Lưu / khôi phục trạng thái form (sống sót qua F5) ----------
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

// ---------- QR tab ----------
function populateQrTemplateOptions() {
  const sel = $("#qrTemplate");
  const prev = sel.value;
  sel.innerHTML = QR_DISPLAY_TEMPLATES.map((t) => `<option value="${escapeAttr(t.value)}">${escapeHtml(t.label)}</option>`).join("");
  if (prev) sel.value = prev;
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
    const accText = p.accountName ? escapeHtml(p.accountName) : "(giữ tài khoản hiện tại)";
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
  const updateBtn = $("#btnUpdatePreset");
  if (!tag || !nameEl || !updateBtn) return;
  if (state.selectedPresetIdx != null && state.presets[state.selectedPresetIdx]) {
    tag.hidden = false;
    nameEl.textContent = state.presets[state.selectedPresetIdx].name || `Mẫu ${state.selectedPresetIdx + 1}`;
    updateBtn.hidden = false;
  } else {
    tag.hidden = true;
    updateBtn.hidden = true;
  }
}
function applyPresetToForm(preset) {
  if (preset.accountName) {
    const acc = findAccountByNickname(preset.accountName);
    if (acc) {
      $("#qrAccount").value = state.accounts.indexOf(acc);
    } else {
      showToast(`Không tìm thấy tài khoản "${preset.accountName}" cho mẫu này.`, "err");
    }
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
  state.presets.splice(idx, 1);
  if (state.selectedPresetIdx === idx) {
    state.selectedPresetIdx = null;
  } else if (state.selectedPresetIdx != null && state.selectedPresetIdx > idx) {
    state.selectedPresetIdx -= 1;
  }
  savePresetsCache();
  renderMauList();
  updateMauActiveUi();
  saveFormState();
  showToast(`Đã xoá "${name}"`, "ok", {
    duration: 5000,
    actionLabel: "Hoàn tác",
    onAction: () => {
      const restoreAt = Math.min(idx, state.presets.length);
      state.presets.splice(restoreAt, 0, removed);
      savePresetsCache();
      renderMauList();
      showToast(`Đã khôi phục "${name}"`, "ok");
    },
  });
}
// Lưu form hiện tại thành 1 mẫu MỚI (không đụng tới mẫu đang chọn, nếu có).
function saveCurrentFormAsPreset() {
  const idx = Number($("#qrAccount").value);
  const acc = state.accounts[idx];
  const defaultName = $("#qrContent").value.trim() || (acc ? acc.list_name : "Mẫu mới");
  const name = window.prompt("Tên mẫu chuyển tiền:", defaultName);
  if (name == null) return; // huỷ
  const trimmed = name.trim();
  if (!trimmed) {
    showToast("Tên mẫu không được để trống", "err");
    return;
  }
  state.presets.push({
    name: trimmed,
    accountName: acc ? acc.list_name : "",
    amount: Number(rawNumber($("#qrAmount").value)) || 0,
    content: $("#qrContent").value.trim(),
    template: $("#qrTemplate").value,
  });
  savePresetsCache();
  state.selectedPresetIdx = state.presets.length - 1;
  renderMauList();
  updateMauActiveUi();
  saveFormState();
  showToast(`Đã lưu mẫu "${trimmed}"`, "ok");
}
// Ghi đè mẫu ĐANG CHỌN bằng nội dung form hiện tại.
function updateSelectedPreset() {
  if (state.selectedPresetIdx == null) return;
  const preset = state.presets[state.selectedPresetIdx];
  if (!preset) return;
  const idx = Number($("#qrAccount").value);
  const acc = state.accounts[idx];
  preset.accountName = acc ? acc.list_name : preset.accountName;
  preset.amount = Number(rawNumber($("#qrAmount").value)) || 0;
  preset.content = $("#qrContent").value.trim();
  preset.template = $("#qrTemplate").value;
  savePresetsCache();
  renderMauList();
  updateMauActiveUi();
  showToast(`Đã cập nhật mẫu "${preset.name}"`, "ok");
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
// Hai <img> chồng nhau (#qrImageA / #qrImageB): ảnh mới load ngầm ở lớp ẩn,
// khi load xong mới crossfade lên trên, tránh chớp trắng lúc đổi ảnh QR.
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
    return true; // chỉ cảnh báo, không chặn tạo QR
  }
  el.hidden = true;
  return true;
}
function updateContentCounter(content) {
  const counter = $("#qrContentCounter");
  if (!counter) return;
  const len = content.length;
  counter.textContent = `${len}/${ADDINFO_SOFT_LIMIT}`;
  counter.className = "field-counter" + (len > ADDINFO_SOFT_LIMIT ? " err" : len > ADDINFO_SOFT_LIMIT - 5 ? " warn" : "");
}

// ---------- Gợi ý số tiền theo con số đang gõ ----------
const AMOUNT_SUGGEST_MULTIPLIERS = [1000, 10000, 100000];
const AMOUNT_SUGGEST_CAP = 1_000_000_000;
function computeAmountSuggestions(rawAmount) {
  if (!rawAmount) return [];
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
  if (!CONTENT_SUGGESTIONS.length) {
    toggle.hidden = true;
    wrap.hidden = true;
    wrap.innerHTML = "";
    return;
  }
  toggle.hidden = false;
  wrap.innerHTML = CONTENT_SUGGESTIONS.map((c) => `<button type="button" class="combo-item" data-content="${escapeAttr(c)}">${escapeHtml(c)}</button>`).join("");
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
    qrCard.classList.remove("loading");
    showToast("Không tải được ảnh QR — img.vietqr.io có thể đang gián đoạn.", "err");
  };
  imgNext.src = url;
  $("#qrCardBank").textContent = acc.data__name || acc.data__code;

  $("#qrCard").hidden = false;
  $("#qrEmpty").hidden = true;
  $("#qrActions").hidden = false;
  $("#btnDownload").href = url;
  $("#btnCopyLink").dataset.url = url;

  restartAnimation($("#qrCard"));
  saveFormState();
}

// ---------- Workspace tabs (Tạo giao dịch / Mẫu giao dịch) ----------
function switchWorkspaceTab(tabName) {
  $$(".workspace-tabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.workspaceTab === tabName));
  $("#tab-qr").hidden = tabName !== "qr";
  $("#tab-mau").hidden = tabName !== "mau";
  if (tabName === "mau") renderMauList();
}

// ---------- Settings modal (danh sách tài khoản + kết nối GitHub) ----------
function switchSettingsTab(tabName) {
  $$(".settings-tabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.settingsTab === tabName));
  $("#settingsTabAccounts").hidden = tabName !== "accounts";
  $("#settingsTabGithub").hidden = tabName !== "github";
  if (tabName === "accounts") renderTable();
}
function openSettingsModal(tabName) {
  $("#settingsBackdrop").hidden = false;
  switchSettingsTab(tabName || "accounts");
}
function closeSettingsModal() {
  $("#settingsBackdrop").hidden = true;
}

// ---------- Ripple effect (hiệu ứng khi bấm chuột) ----------
function initRippleEffect() {
  document.addEventListener("click", (e) => {
    const target = e.target.closest(".btn, .icon-btn");
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

// ---------- Xoá thông tin đang nhập (giữ nguyên danh sách tài khoản/mẫu) ----------
async function clearEnteredInfo() {
  const ok = await showConfirm("Xoá số tiền, nội dung và mẫu đang chọn trên form? (không xoá danh sách tài khoản/mẫu)", "Xoá");
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

// ---------- Init ----------
async function init() {
  loadGhConfigFromStorage();
  initRippleEffect();

  await loadRefBanks();
  await loadAccountsInitial();
  await loadPresetsInitial();
  await loadQrDisplayTemplates();
  await loadContentSuggestions();

  renderTable();
  populateQrTemplateOptions();
  populateQrAccounts();
  renderMauList();
  renderContentSuggestions();

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
    if (!$("#confirmBackdrop").hidden) return; // để confirm dialog tự xử lý Escape của riêng nó
    if (!$("#bankPickerPopup").hidden) {
      closeBankPicker();
      return;
    }
    if (!$("#settingsBackdrop").hidden) closeSettingsModal();
  });

  // Đóng popup tìm ngân hàng khi bấm ra ngoài / cuộn / đổi kích thước cửa sổ
  document.addEventListener("mousedown", (e) => {
    if (bankPickerOpenIdx == null) return;
    if (e.target.closest("#bankPickerPopup") || e.target.closest(".bank-input")) return;
    closeBankPicker();
  });
  window.addEventListener(
    "scroll",
    () => {
      if (bankPickerOpenIdx != null) closeBankPicker();
    },
    true
  );
  window.addEventListener("resize", () => {
    if (bankPickerOpenIdx != null) closeBankPicker();
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
  $("#btnSaveMauGithub").addEventListener("click", async () => {
    savePresetsCache();
    await savePresetsToGithub();
  });
  $("#btnSavePreset").addEventListener("click", saveCurrentFormAsPreset);
  $("#btnUpdatePreset").addEventListener("click", updateSelectedPreset);
  $("#btnClearForm").addEventListener("click", clearEnteredInfo);

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

  $$("#quickAmounts .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      $$("#quickAmounts .chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      $("#qrAmount").value = formatNumber(chip.dataset.val);
      onGenerateQr(null, { silent: true });
    });
  });
  $("#qrAmount").addEventListener("input", () => {
    $$("#quickAmounts .chip").forEach((c) => c.classList.remove("active"));
  });
  $("#qrAmount").addEventListener("input", () => renderAmountSuggestions());

  $("#accountSearch").addEventListener(
    "input",
    debounce(() => renderTable(), 200)
  );

  $("#qrForm").addEventListener("submit", (e) => onGenerateQr(e));
  $("#qrAmount").addEventListener("input", (e) => {
    e.target.value = formatNumber(e.target.value);
  });

  const liveGenerate = debounce(() => onGenerateQr(null, { silent: true }), 350);
  $("#qrAccount").addEventListener("change", () => {
    onGenerateQr(null, { silent: true });
  });
  $("#qrTemplate").addEventListener("change", () => {
    onGenerateQr(null, { silent: true });
  });
  $("#qrAmount").addEventListener("input", () => {
    liveGenerate();
  });
  $("#qrContent").addEventListener("input", (e) => {
    updateContentCounter(e.target.value.trim()); // phản hồi tức thì, không chờ debounce
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

  updateContentCounter($("#qrContent").value.trim());
  applyDefaults();
  restoreFormState();
  updateContentCounter($("#qrContent").value.trim());
  updateMauActiveUi();
  switchWorkspaceTab("qr");
  onGenerateQr(null, { silent: true });

  // Đồng bộ ngầm từ GitHub (nếu đã kết nối) — không chặn giao diện, không cần bấm nút thủ công
  syncFromGithubSilently();
}

document.addEventListener("DOMContentLoaded", init);