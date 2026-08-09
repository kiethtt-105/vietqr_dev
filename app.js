const LS_GH_CONFIG = "vietqr_gh_config";
const LS_GH_TOKEN = "vietqr_gh_token";
const LS_ACCOUNTS_CACHE = "vietqr_accounts_cache";
const LS_PRESETS_CACHE = "vietqr_presets_cache";
const LS_CONTENT_CACHE = "vietqr_content_cache";
const LS_TEMPLATES_CACHE = "vietqr_templates_cache";
const LS_DEFAULTS = "vietqr_defaults";
const LS_FORM_STATE = "vietqr_form_state";
const LS_REFBANKS_CACHE = "vietqr_refbanks_cache";
const LS_THEME = "vietqr_theme";
const REFBANKS_TTL_MS = 12 * 60 * 60 * 1000;

const VIETQR_BANKS_API = "https://api.vietqr.io/v2/banks";
const ADDINFO_SOFT_LIMIT = 25;
const AMOUNT_WARN_THRESHOLD = 500_000_000;

// Giá trị mặc định khi chưa có data/templates.json và chưa từng lưu gì (dùng làm fallback).
const DEFAULT_QR_TEMPLATES = [
  { value: "compact2", label: "Compact 2" },
  { value: "compact", label: "Compact" },
  { value: "print", label: "Print" },
  { value: "qr_only", label: "Chỉ mã QR" },
];

let state = {
  refBanks: [],
  accounts: [],
  presets: [],
  content: [],
  templates: [],
  selectedPresetIdx: null,
  sha: { accounts: null, presets: null, content: null, templates: null },
  gh: {
    owner: "",
    repo: "",
    branch: "main",
    pathAccounts: "data/my-accounts.json",
    pathPresets: "data/mau-chuyen-tien.json",
    pathContent: "data/noi-dung-chuyen-khoan.json",
    pathTemplates: "data/templates.json",
  },
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
  $("#ghPathContent").value = state.gh.pathContent || "data/noi-dung-chuyen-khoan.json";
  $("#ghPathTemplates").value = state.gh.pathTemplates || "data/templates.json";
  $("#ghToken").value = localStorage.getItem(LS_GH_TOKEN) || "";
  updateGhStatusLabel();
}
// Đồng bộ các ô nhập (owner/repo/branch/path/token) đang có trên form vào state.gh + localStorage.
// Gọi hàm này ở ĐẦU mọi thao tác gọi API GitHub (tải/lưu), để không bắt buộc phải bấm
// "Lưu thông tin kết nối" trước — tránh lỗi 401 do dùng token/owner/repo cũ còn sót lại

function syncGhInputsToState() {
  const owner = $("#ghOwner").value.trim();
  const repo = $("#ghRepo").value.trim();
  if (owner) state.gh.owner = owner;
  if (repo) state.gh.repo = repo;
  state.gh.branch = $("#ghBranch").value.trim() || state.gh.branch || "main";
  state.gh.pathAccounts = $("#ghPathAccounts").value.trim() || state.gh.pathAccounts || "data/my-accounts.json";
  state.gh.pathPresets = $("#ghPathPresets").value.trim() || state.gh.pathPresets || "data/mau-chuyen-tien.json";
  state.gh.pathContent = $("#ghPathContent").value.trim() || state.gh.pathContent || "data/noi-dung-chuyen-khoan.json";
  state.gh.pathTemplates = $("#ghPathTemplates").value.trim() || state.gh.pathTemplates || "data/templates.json";
  const token = $("#ghToken").value.trim();
  if (token) localStorage.setItem(LS_GH_TOKEN, token);
  localStorage.setItem(LS_GH_CONFIG, JSON.stringify(state.gh));
}
function saveGhConfigToStorage() {
  syncGhInputsToState();
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

    let currentSha = sha;
    if (!currentSha) {
      const latest = await ghReadJson(path);
      currentSha = latest.sha;
    }
    return await put(currentSha);
  } catch (err) {

    const isShaMismatch =
      err.status === 409 ||
      (err.message && /does not match|sha.*mismatch|conflict/i.test(err.message));
    if (!isShaMismatch) throw err;

    const latest = await ghReadJson(path);
    return await put(latest.sha);
  }
}
async function loadAllFromGithub() {
  syncGhInputsToState();
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
    const content = await ghReadJson(state.gh.pathContent);
    if (content.data) {
      state.content = Array.isArray(content.data) ? content.data.filter((v) => typeof v === "string" && v.trim()) : [];
      state.sha.content = content.sha;
      saveContentCache();
    }
    const templates = await ghReadJson(state.gh.pathTemplates);
    if (templates.data) {
      state.templates = Array.isArray(templates.data) && templates.data.length ? templates.data : DEFAULT_QR_TEMPLATES.slice();
      state.sha.templates = templates.sha;
      saveTemplatesCache();
    }
    renderTable();
    populateQrAccounts();
    renderMauList();
    populateQrTemplateOptions();
    renderContentSuggestions();
    setStatus(
      $("#ghMsg"),
      `Đã tải ${state.accounts.length} tài khoản, ${state.presets.length} mẫu chuyển tiền, ${state.content.length} nội dung, ${state.templates.length} mẫu hiển thị.`,
      "ok"
    );
    $("#ghDot").className = "dot on";
  } catch (err) {
    console.error(err);
    setStatus($("#ghMsg"), "Lỗi tải dữ liệu: " + err.message, "err");
    $("#ghDot").className = "dot err";
  }
}

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
    const content = await ghReadJson(state.gh.pathContent);
    if (content.data) {
      state.content = Array.isArray(content.data) ? content.data.filter((v) => typeof v === "string" && v.trim()) : [];
      state.sha.content = content.sha;
      saveContentCache();
      changed = true;
    }
    const templates = await ghReadJson(state.gh.pathTemplates);
    if (templates.data) {
      state.templates = Array.isArray(templates.data) && templates.data.length ? templates.data : DEFAULT_QR_TEMPLATES.slice();
      state.sha.templates = templates.sha;
      saveTemplatesCache();
      changed = true;
    }
    if (changed) {
      renderTable();
      populateQrAccounts();
      renderMauList();
      populateQrTemplateOptions();
      renderContentSuggestions();
      updateMauActiveUi();
      onGenerateQr(null, { silent: true });
    }
    $("#ghDot").className = "dot on";
  } catch (err) {
    console.error("Tự động đồng bộ GitHub lỗi:", err);
  }
}

async function saveAccountsToGithub() {
  syncGhInputsToState();
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
  syncGhInputsToState();
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
  const btns = $$(".js-save-mau-btn");
  btns.forEach((b) => {
    b.classList.add("is-loading");
    b.disabled = true;
  });
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
    btns.forEach((b) => {
      b.classList.remove("is-loading");
      b.disabled = false;
    });
  }
}

async function saveContentToGithub() {
  syncGhInputsToState();
  if (!state.gh.owner || !state.gh.repo) {
    setStatus($("#ghMsg"), "Chưa cấu hình GitHub — mở tab Kết nối GitHub.", "err");
    openSettingsModal("github");
    return;
  }
  if (!state.content.length) {
    const ok = await showConfirm(
      "Danh sách nội dung chuyển khoản đang trống — lưu lúc này sẽ XOÁ TOÀN BỘ dữ liệu đang có trên GitHub. Vẫn tiếp tục?",
      "Vẫn lưu (xoá hết)"
    );
    if (!ok) return;
  }
  const emptyRows = state.content.map((c, i) => (!c || !c.trim() ? i + 1 : null)).filter((n) => n != null);
  if (emptyRows.length) {
    showToast(`Dòng ${emptyRows.join(", ")} chưa có nội dung — điền hoặc xoá trước khi lưu.`, "err");
    return;
  }
  const btn = $("#btnSaveContentGithub");
  btn.classList.add("is-loading");
  btn.disabled = true;
  setStatus($("#ghMsg"), "Đang lưu nội dung chuyển khoản lên GitHub…");
  try {
    state.sha.content = await ghWriteJson(
      state.gh.pathContent,
      state.content,
      state.sha.content,
      `chore: cập nhật noi-dung-chuyen-khoan.json (${new Date().toISOString()})`
    );
    setStatus($("#ghMsg"), "Đã lưu nội dung chuyển khoản lên GitHub ✓", "ok");
    showToast("Đã lưu nội dung chuyển khoản lên GitHub ✓", "ok");
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

async function saveTemplatesToGithub() {
  syncGhInputsToState();
  if (!state.gh.owner || !state.gh.repo) {
    setStatus($("#ghMsg"), "Chưa cấu hình GitHub — mở tab Kết nối GitHub.", "err");
    openSettingsModal("github");
    return;
  }
  if (!state.templates.length) {
    const ok = await showConfirm(
      "Danh sách mẫu hiển thị QR đang trống — lưu lúc này sẽ XOÁ TOÀN BỘ dữ liệu đang có trên GitHub. Vẫn tiếp tục?",
      "Vẫn lưu (xoá hết)"
    );
    if (!ok) return;
  }
  const invalidRows = [];
  state.templates.forEach((t, i) => {
    const missing = [];
    if (!t.value || !String(t.value).trim()) missing.push("value");
    if (!t.label || !String(t.label).trim()) missing.push("label");
    if (missing.length) invalidRows.push({ row: i + 1, missing });
  });
  if (invalidRows.length) {
    const detail = invalidRows.map((r) => `dòng ${r.row} (thiếu ${r.missing.join(", ")})`).join("; ");
    showToast(`Chưa lưu được: ${detail}.`, "err");
    return;
  }
  const btn = $("#btnSaveTemplatesGithub");
  btn.classList.add("is-loading");
  btn.disabled = true;
  setStatus($("#ghMsg"), "Đang lưu mẫu hiển thị QR lên GitHub…");
  try {
    state.sha.templates = await ghWriteJson(
      state.gh.pathTemplates,
      state.templates,
      state.sha.templates,
      `chore: cập nhật templates.json (${new Date().toISOString()})`
    );
    setStatus($("#ghMsg"), "Đã lưu mẫu hiển thị QR lên GitHub ✓", "ok");
    showToast("Đã lưu mẫu hiển thị QR lên GitHub ✓", "ok");
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

// ---------- Nội dung chuyển khoản (gợi ý) cache + load ----------
function loadContentCache() {
  const cached = localStorage.getItem(LS_CONTENT_CACHE);
  if (cached) {
    try {
      state.content = JSON.parse(cached);
      return;
    } catch (e) {}
  }
}
async function loadContentInitial() {
  loadContentCache();
  if (state.content.length) return;
  try {
    const res = await fetch("data/noi-dung-chuyen-khoan.json");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) state.content = data.filter((v) => typeof v === "string" && v.trim());
    }
  } catch (e) {
    state.content = [];
  }
}
function saveContentCache() {
  localStorage.setItem(LS_CONTENT_CACHE, JSON.stringify(state.content));
}

// ---------- Mẫu hiển thị QR cache + load ----------
function loadTemplatesCache() {
  const cached = localStorage.getItem(LS_TEMPLATES_CACHE);
  if (cached) {
    try {
      state.templates = JSON.parse(cached);
      return;
    } catch (e) {}
  }
}
async function loadTemplatesInitial() {
  loadTemplatesCache();
  if (state.templates.length) return;
  try {
    const res = await fetch("data/templates.json");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length) state.templates = data;
    }
  } catch (e) {}
  if (!state.templates.length) state.templates = DEFAULT_QR_TEMPLATES.slice();
}
function saveTemplatesCache() {
  localStorage.setItem(LS_TEMPLATES_CACHE, JSON.stringify(state.templates));
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
function isDefaultPreset(preset) {
  const defaults = loadDefaults();
  return !!(defaults.presetName && preset && preset.name === defaults.presetName);
}
function setDefaultPreset(idx) {
  const preset = state.presets[idx];
  if (!preset) return;
  const defaults = loadDefaults();
  if (defaults.presetName === preset.name) {
    delete defaults.presetName;
    showToast("Đã bỏ mẫu mặc định", "ok");
  } else {
    defaults.presetName = preset.name;
    showToast(`Đã đặt "${preset.name}" làm mẫu mặc định`, "ok");
  }
  localStorage.setItem(LS_DEFAULTS, JSON.stringify(defaults));
  renderMauList();
}
function applyDefaultPresetIfNeeded() {
  if (state.selectedPresetIdx != null) return;
  const defaults = loadDefaults();
  if (!defaults.presetName) return;
  const idx = state.presets.findIndex((p) => p.name === defaults.presetName);
  if (idx < 0) return;
  state.selectedPresetIdx = idx;
  applyPresetToForm(state.presets[idx]);
  updateMauActiveUi();
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
  const sel = $("#qrTemplate");
  const prev = sel.value;
  sel.innerHTML = state.templates.map((t) => `<option value="${escapeAttr(t.value)}">${escapeHtml(t.label)}</option>`).join("");
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
    const isDefault = isDefaultPreset(p);
    const card = document.createElement("div");
    card.className = "mau-card" + (state.selectedPresetIdx === idx ? " active" : "");
    card.innerHTML = `
      <button type="button" class="mau-card-body" data-select="${idx}">
        <span class="mau-card-name">${escapeHtml(p.name || `Mẫu ${idx + 1}`)}</span>
        <span class="mau-card-meta">${accText} · ${amountText}</span>
        ${p.content ? `<span class="mau-card-content">${escapeHtml(p.content)}</span>` : ""}
      </button>
      <button type="button" class="icon-btn mau-card-star${isDefault ? " is-default" : ""}" title="${isDefault ? "Đang là mẫu mặc định — bấm để bỏ" : "Đặt làm mẫu mặc định"}" data-star="${idx}">${isDefault ? "★" : "☆"}</button>
      <button type="button" class="icon-btn mau-card-del" title="Xoá mẫu" data-del="${idx}">✕</button>`;
    wrap.appendChild(card);
  });

  $("#mauCount").textContent = `${state.presets.length} mẫu`;

  wrap.querySelectorAll("[data-select]").forEach((btn) => {
    btn.addEventListener("click", () => selectMau(Number(btn.dataset.select)));
  });
  wrap.querySelectorAll("[data-star]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setDefaultPreset(Number(btn.dataset.star));
    });
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
function renderMauTable() {
  const body = $("#mauTableBody");
  if (!body) return;
  body.innerHTML = "";
  state.presets.forEach((p, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="stt-cell">${idx + 1}</td>
      <td data-label="Tên mẫu"><input data-mau-idx="${idx}" data-mau-field="name" value="${escapeAttr(p.name || "")}"></td>
      <td data-label="Tài khoản"><input data-mau-idx="${idx}" data-mau-field="accountName" value="${escapeAttr(p.accountName || "")}"></td>
      <td data-label="Số TK"><input data-mau-idx="${idx}" data-mau-field="accountNum" value="${escapeAttr(p.accountNum || "")}"></td>
      <td data-label="Số tiền"><input data-mau-idx="${idx}" data-mau-field="amount" inputmode="numeric" value="${escapeAttr(p.amount || "")}"></td>
      <td data-label="Nội dung"><input data-mau-idx="${idx}" data-mau-field="content" value="${escapeAttr(p.content || "")}"></td>
      <td data-label="Mẫu hiển thị"><input data-mau-idx="${idx}" data-mau-field="template" value="${escapeAttr(p.template || "")}"></td>
      <td class="row-actions">
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
      if (field !== "amount") return;
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
  list.forEach((b, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="stt-cell">${idx + 1}</td>
      <td>${b.logo ? `<img src="${escapeAttr(b.logo)}" alt="" style="width:24px;height:24px;object-fit:contain;border-radius:4px;">` : ""}</td>
      <td data-label="Tên ngân hàng">${escapeHtml(b.shortName || b.name || "")}</td>
      <td data-label="Mã">${escapeHtml(b.code || "")}</td>
      <td data-label="BIN">${escapeHtml(b.bin || "")}</td>`;
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
  renderMauList();
  const inputs = $("#mauTableBody").querySelectorAll("input[data-mau-field='name']");
  const last = inputs[inputs.length - 1];
  if (last) last.focus();
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
function clearActivePreset() {
  if (state.selectedPresetIdx == null) return;
  state.selectedPresetIdx = null;
  renderMauList();
  updateMauActiveUi();
  saveFormState();
  showToast("Đã bỏ chọn mẫu — số tiền/nội dung đang nhập không còn gắn với mẫu nào.", "ok");
}
function applyPresetToForm(preset) {
  if (preset.accountName || preset.accountNum) {
    const acc = findAccountForPreset(preset);
    if (acc) {
      $("#qrAccount").value = state.accounts.indexOf(acc);
    } else if (preset.accountName) {
      showToast(`Không tìm thấy tài khoản "${preset.accountName}" cho mẫu này — giữ nguyên tài khoản đang chọn.`, "err");
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

  switchWorkspaceTab("qr");
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
  if (!counter) return;
  const len = content.length;
  counter.textContent = `${len}/${ADDINFO_SOFT_LIMIT}`;
  counter.className = "field-counter" + (len > ADDINFO_SOFT_LIMIT ? " err" : len > ADDINFO_SOFT_LIMIT - 5 ? " warn" : "");
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

// ---------- Cài đặt: Nội dung chuyển khoản (bảng quản lý) ----------
function renderContentTable() {
  const body = $("#contentTableBody");
  if (!body) return;
  body.innerHTML = "";
  state.content.forEach((text, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="stt-cell">${idx + 1}</td>
      <td data-label="Nội dung gợi ý"><input data-content-idx="${idx}" value="${escapeAttr(text)}"></td>
      <td class="row-actions">
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
      renderContentSuggestions();
    });
  });
  body.querySelectorAll("[data-content-del]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.target.dataset.contentDel);
      const removed = state.content[idx];
      state.content.splice(idx, 1);
      saveContentCache();
      renderContentTable();
      renderContentSuggestions();
      showToast(`Đã xoá "${removed}"`, "ok", {
        duration: 5000,
        actionLabel: "Hoàn tác",
        onAction: () => {
          const restoreAt = Math.min(idx, state.content.length);
          state.content.splice(restoreAt, 0, removed);
          saveContentCache();
          renderContentTable();
          renderContentSuggestions();
          showToast(`Đã khôi phục "${removed}"`, "ok");
        },
      });
    });
  });
}
function addContentRow() {
  state.content.push("");
  saveContentCache();
  renderContentTable();
  const inputs = $("#contentTableBody").querySelectorAll("input[data-content-idx]");
  const last = inputs[inputs.length - 1];
  if (last) last.focus();
}

// ---------- Cài đặt: Mẫu hiển thị QR (bảng quản lý) ----------
function renderTemplatesTable() {
  const body = $("#templatesTableBody");
  if (!body) return;
  body.innerHTML = "";
  state.templates.forEach((t, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="stt-cell">${idx + 1}</td>
      <td data-label="Value"><input data-tpl-idx="${idx}" data-tpl-field="value" value="${escapeAttr(t.value)}"></td>
      <td data-label="Label"><input data-tpl-idx="${idx}" data-tpl-field="label" value="${escapeAttr(t.label)}"></td>
      <td class="row-actions">
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
      populateQrTemplateOptions();
    });
  });
  body.querySelectorAll("[data-tpl-del]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = Number(e.target.dataset.tplDel);
      const removed = state.templates[idx];
      state.templates.splice(idx, 1);
      saveTemplatesCache();
      renderTemplatesTable();
      populateQrTemplateOptions();
      showToast(`Đã xoá "${removed.label || removed.value}"`, "ok", {
        duration: 5000,
        actionLabel: "Hoàn tác",
        onAction: () => {
          const restoreAt = Math.min(idx, state.templates.length);
          state.templates.splice(restoreAt, 0, removed);
          saveTemplatesCache();
          renderTemplatesTable();
          populateQrTemplateOptions();
          showToast(`Đã khôi phục "${removed.label || removed.value}"`, "ok");
        },
      });
    });
  });
}
function addTemplateRow() {
  state.templates.push({ value: "", label: "" });
  saveTemplatesCache();
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
  if (tabName === "mau") renderMauList();
}

// ---------- Settings modal (danh sách tài khoản + kết nối GitHub) ----------
// Chuyển tab: chốt chiều cao hiện tại của viewport, đổi nội dung, rồi animate
// mượt sang chiều cao thật của tab mới (thay vì để CSS ép 1 chiều cao cố định
// gây khoảng trắng thừa ở tab ngắn, hoặc để khung nhảy khựng khi tab dài/ngắn
// khác nhau). Sau khi animate xong, trả viewport về height:auto để các thay
// đổi sau đó trong cùng tab (thêm/xoá dòng) tự co giãn bình thường.
function switchSettingsTab(tabName) {
  $$(".settings-tabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.settingsTab === tabName));

  const viewport = $("#settingsTabsViewport");
  if (viewport) {
    viewport.style.height = viewport.getBoundingClientRect().height + "px";
  }

  $("#settingsTabAccounts").hidden = tabName !== "accounts";
  $("#settingsTabContent").hidden = tabName !== "content";
  $("#settingsTabTemplates").hidden = tabName !== "templates";
  $("#settingsTabMau").hidden = tabName !== "mau";
  $("#settingsTabVietqrBanks").hidden = tabName !== "vietqr";
  $("#settingsTabGithub").hidden = tabName !== "github";
  if (tabName === "accounts") renderTable();
  if (tabName === "content") renderContentTable();
  if (tabName === "templates") renderTemplatesTable();
  if (tabName === "mau") renderMauTable();
  if (tabName === "vietqr") renderVietqrBanksTable();

  if (viewport) {
    const activePanel = viewport.querySelector(".settings-tab-panel:not([hidden])");
    requestAnimationFrame(() => {
      if (!activePanel) return;
      viewport.style.height = activePanel.getBoundingClientRect().height + "px";
      clearTimeout(viewport._heightResetTimer);
      viewport._heightResetTimer = setTimeout(() => {
        viewport.style.height = "auto";
      }, 240);
    });
  }
}
function openSettingsModal(tabName) {
  $("#settingsBackdrop").hidden = false;
  switchSettingsTab(tabName || "accounts");
}
function closeSettingsModal() {
  $("#settingsBackdrop").hidden = true;
}

// ---------- Ripple effect (hiệu ứng khi bấm chuột) ----------
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(LS_THEME, theme);
  } catch (e) {}
  const btn = $("#btnToggleTheme");
  if (btn) {
    btn.textContent = theme === "light" ? "☀" : "🌙";
    btn.title = theme === "light" ? "Chuyển sang giao diện tối" : "Chuyển sang giao diện sáng";
  }
}

function initTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  applyTheme(current);
  $("#btnToggleTheme").addEventListener("click", () => {
    const now = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(now === "light" ? "dark" : "light");
  });
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
  const ok = await showConfirm("Xoá số tiền, nội dung và mẫu đang chọn trên form? (không xoá danh sách tài khoản/mẫu)", "Xoá");
  if (!ok) return;
  state.selectedPresetIdx = null;
  clearFormState();
  $("#qrAmount").value = "";
  $("#qrContent").value = "";
  updateContentCounter("");
  $$("#quickAmounts .chip").forEach((c) => c.classList.remove("active"));
  applyDefaults();
  applyDefaultPresetIfNeeded();
  applyDefaultContentIfNeeded();
  renderMauList();
  updateMauActiveUi();
  $("#qrCard").hidden = true;
  $("#qrEmpty").hidden = false;
  $("#qrActions").hidden = true;
  showToast("Đã xoá thông tin đang nhập", "ok");
}

async function init() {
  loadGhConfigFromStorage();
  initTheme();
  initRippleEffect();

  await loadRefBanks();
  await loadAccountsInitial();
  await loadPresetsInitial();
  await loadTemplatesInitial();
  await loadContentInitial();

  renderTable();
  populateQrTemplateOptions();
  populateQrAccounts();
  renderMauList();
  renderContentSuggestions();
  renderVietqrBanksTable();

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
    if (!$("#settingsBackdrop").hidden) closeSettingsModal();
  });

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
  $("#btnAddMauRow").addEventListener("click", addMauRow);
  $("#btnSaveMauSettingsGithub").addEventListener("click", async () => {
    savePresetsCache();
    await savePresetsToGithub();
  });
  $("#btnRefreshBanksVietqrTab").addEventListener("click", refreshVietqrBanksTab);
  $("#vietqrBankSearch").addEventListener("input", (e) => renderVietqrBanksTable(e.target.value));
  $("#btnAddContentRow").addEventListener("click", addContentRow);
  $("#btnSaveContentGithub").addEventListener("click", async () => {
    saveContentCache();
    await saveContentToGithub();
  });
  $("#btnAddTemplateRow").addEventListener("click", addTemplateRow);
  $("#btnSaveTemplatesGithub").addEventListener("click", async () => {
    saveTemplatesCache();
    await saveTemplatesToGithub();
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
  $("#btnClearActivePreset").addEventListener("click", clearActivePreset);

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
    updateContentCounter(e.target.value.trim());
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
  const hadSavedState = restoreFormState();
  if (!hadSavedState) {
    applyDefaultPresetIfNeeded();
    applyDefaultContentIfNeeded();
  }
  updateContentCounter($("#qrContent").value.trim());
  updateMauActiveUi();
  switchWorkspaceTab("qr");
  onGenerateQr(null, { silent: true });

  syncFromGithubSilently();
}

document.addEventListener("DOMContentLoaded", init);