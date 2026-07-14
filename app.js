// ============================================================
// SỔ QUỸ — Trình tạo mã QR VietQR (chạy tĩnh trên GitHub Pages)
// 3 nguồn dữ liệu:
//   data/vietqr-banks.json  -> danh sách gốc VietQR (tham chiếu, read-only)
//   data/my-accounts.json   -> tài khoản cá nhân (CRUD, đồng bộ GitHub)
//   data/templates.json     -> mẫu nội dung chuyển khoản (CRUD, đồng bộ GitHub)
// + Link API dạng ?bank=&stk=&amount=&content=&template=&name=&redirect=1|&format=text
//   dùng cho iPhone Shortcuts / gọi trực tiếp, giống pattern pos-charge của dự án MoMo.
// ============================================================

const LS_GH_CONFIG = "vietqr_gh_config";
const LS_GH_TOKEN = "vietqr_gh_token";
const LS_ACCOUNTS_CACHE = "vietqr_accounts_cache";
const LS_TEMPLATES_CACHE = "vietqr_templates_cache";
const LS_DEFAULTS = "vietqr_defaults"; // { accountKey, template }

const VIETQR_BANKS_API = "https://api.vietqr.io/v2/banks";

let state = {
  refBanks: [],
  accounts: [],
  templates: [],
  sha: { accounts: null, templates: null },
  gh: { owner: "", repo: "", branch: "main", pathAccounts: "data/my-accounts.json", pathTemplates: "data/templates.json" },
};

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
  $("#ghPathTemplates").value = state.gh.pathTemplates || "data/templates.json";
  $("#ghToken").value = localStorage.getItem(LS_GH_TOKEN) || "";
  updateGhStatusLabel();
}
function saveGhConfigToStorage() {
  state.gh.owner = $("#ghOwner").value.trim();
  state.gh.repo = $("#ghRepo").value.trim();
  state.gh.branch = $("#ghBranch").value.trim() || "main";
  state.gh.pathAccounts = $("#ghPathAccounts").value.trim() || "data/my-accounts.json";
  state.gh.pathTemplates = $("#ghPathTemplates").value.trim() || "data/templates.json";
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
    const [acc, tpl] = await Promise.all([
      ghReadJson(state.gh.pathAccounts),
      ghReadJson(state.gh.pathTemplates),
    ]);
    if (acc.data) {
      state.accounts = acc.data;
      state.sha.accounts = acc.sha;
      localStorage.setItem(LS_ACCOUNTS_CACHE, JSON.stringify(acc.data));
    }
    if (tpl.data) {
      state.templates = tpl.data;
      state.sha.templates = tpl.sha;
      localStorage.setItem(LS_TEMPLATES_CACHE, JSON.stringify(tpl.data));
    }
    renderTable();
    renderTemplateList();
    renderPresets();
    populateQrAccounts();
    setStatus(
      $("#ghMsg"),
      `Đã tải ${state.accounts.length} tài khoản, ${state.templates.length} mẫu nội dung.`,
      "ok"
    );
    $("#ghDot").className = "dot on";
  } catch (err) {
    console.error(err);
    setStatus($("#ghMsg"), "Lỗi tải dữ liệu: " + err.message, "err");
    $("#ghDot").className = "dot err";
  }
}

async function saveAccountsToGithub() {
  if (!state.gh.owner || !state.gh.repo) {
    setStatus($("#ghMsg"), "Chưa cấu hình GitHub — mở panel kết nối phía trên.", "err");
    $("#ghPanel").hidden = false;
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
    $("#ghPanel").hidden = false;
  }
}

async function saveTemplatesToGithub() {
  const el = $("#tplMsg");
  if (!state.gh.owner || !state.gh.repo || !getToken()) {
    setStatus(el, "Chưa cấu hình GitHub / token — mở panel kết nối ở đầu trang.", "err");
    $("#ghPanel").hidden = false;
    return;
  }
  setStatus(el, "Đang lưu mẫu lên GitHub…");
  try {
    state.sha.templates = await ghWriteJson(
      state.gh.pathTemplates,
      state.templates,
      state.sha.templates,
      `chore: cập nhật templates.json (${new Date().toISOString()})`
    );
    setStatus(el, "Đã lưu mẫu nội dung lên GitHub ✓", "ok");
  } catch (err) {
    console.error(err);
    setStatus(el, "Lỗi khi lưu: " + err.message, "err");
  }
}

// ---------- Reference bank list (vietqr-banks.json) ----------
async function loadRefBanks() {
  try {
    const res = await fetch("data/vietqr-banks.json");
    state.refBanks = await res.json();
  } catch (e) {
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
    if (!payload.data) throw new Error("Không đọc được dữ liệu từ VietQR");
    state.refBanks = payload.data.map((b) => ({
      id: b.id,
      name: b.name,
      code: b.code,
      bin: b.bin,
      shortName: b.shortName,
      logo: b.logo,
      short_name: b.short_name,
    }));
    renderTable();
    btn.textContent = `Đã cập nhật ${state.refBanks.length} ngân hàng ✓`;
  } catch (err) {
    console.error(err);
    btn.textContent = "Lỗi tải — dùng bản có sẵn";
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
    btn.addEventListener("click", (e) => {
      const idx = Number(e.target.dataset.del);
      if (confirm(`Xoá dòng "${state.accounts[idx].list_name}"?`)) {
        state.accounts.splice(idx, 1);
        renderTable();
        populateQrAccounts();
      }
    });
  });
}
function addRow() {
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

// ---------- Templates CRUD ----------
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
    state.templates = await res.json();
  } catch (e) {
    state.templates = [];
  }
}
function renderPresets() {
  const row = $("#presetRow");
  row.innerHTML = state.templates
    .map((t) => `<button type="button" class="preset-chip">${escapeHtml(t.label)}</button>`)
    .join("");
  row.querySelectorAll(".preset-chip").forEach((chip, i) => {
    chip.addEventListener("click", () => {
      $("#qrContent").value = state.templates[i].content;
    });
  });
}
function renderTemplateList() {
  const ul = $("#tplList");
  ul.innerHTML = state.templates
    .map(
      (t, i) =>
        `<li><div><div>${escapeHtml(t.label)}</div><span class="tpl-content">${escapeHtml(t.content)}</span></div>
         <button class="icon-btn" data-tpldel="${i}" title="Xoá mẫu">✕</button></li>`
    )
    .join("");
  ul.querySelectorAll("[data-tpldel]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const i = Number(e.target.dataset.tpldel);
      state.templates.splice(i, 1);
      localStorage.setItem(LS_TEMPLATES_CACHE, JSON.stringify(state.templates));
      renderTemplateList();
      renderPresets();
    });
  });
}
function addTemplate() {
  const label = $("#tplLabelInput").value.trim();
  const content = $("#tplContentInput").value.trim();
  if (!label || !content) return;
  state.templates.push({ label, content });
  localStorage.setItem(LS_TEMPLATES_CACHE, JSON.stringify(state.templates));
  $("#tplLabelInput").value = "";
  $("#tplContentInput").value = "";
  renderTemplateList();
  renderPresets();
}

// ---------- Mặc định: tài khoản + mẫu QR (chung cho mọi tài khoản) ----------
function accountKey(acc) {
  return `${acc.list_name}|${acc.data_num}`;
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
function setDefaultTemplate() {
  const defaults = loadDefaults();
  defaults.template = $("#qrTemplate").value;
  localStorage.setItem(LS_DEFAULTS, JSON.stringify(defaults));
  flashLinkBtn("#btnSetDefaultTemplate", "★ Đã đặt mặc định");
}
function flashLinkBtn(sel, text) {
  const btn = $(sel);
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = original), 1600);
}

// ---------- QR tab ----------
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
function onGenerateQr(e) {
  if (e) e.preventDefault();
  const idx = Number($("#qrAccount").value);
  const acc = state.accounts[idx];
  if (!acc) {
    alert("Chưa có tài khoản nào — thêm ở tab Danh sách tài khoản trước.");
    return;
  }
  const amount = rawNumber($("#qrAmount").value);
  const content = $("#qrContent").value.trim();
  const template = $("#qrTemplate").value;
  const url = buildQrUrl(acc, amount, content, template);

  $("#qrImage").src = url;
  $("#qrCardBank").textContent = acc.data__name || acc.data__code;
  $("#qrCardName").textContent = acc.name_ac || "—";
  $("#qrCardNumber").textContent = acc.data_num || "—";
  $("#qrCardAmount").textContent = amount ? formatNumber(amount) + " đ" : "—";
  $("#qrCardContent").textContent = content || "—";

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
  restartAnimation($("#qrStamp"));
}

// ---------- Link API: ?bank=&stk=&amount=&content=&template=&name=&redirect=1|format=text ----------
function handleApiParams() {
  const params = new URLSearchParams(window.location.search);
  const bank = params.get("bank");
  const stk = params.get("stk");
  if (!bank || !stk) return false;

  const amount = rawNumber(params.get("amount") || "");
  const content = params.get("content") || "";
  const template = params.get("template") || loadDefaults().template || "compact2";
  const name = params.get("name") || "";
  const url = buildQrUrlRaw(bank, stk, amount, content, template, name);

  if (params.get("redirect") === "1") {
    window.location.replace(url);
    return true;
  }
  if (params.get("format") === "text") {
    document.documentElement.innerHTML = "";
    document.body = document.createElement("body");
    document.body.style.cssText = "margin:0;padding:16px;font-family:monospace;font-size:13px;background:#fff;color:#000;word-break:break-all;";
    document.body.textContent = url;
    document.title = "VietQR link";
    return true;
  }

  // Không redirect/text -> điền sẵn vào form bình thường sau khi init xong
  window.__apiPrefill = { bank, stk, amount, content, template, name };
  return false;
}
function applyApiPrefill() {
  const p = window.__apiPrefill;
  if (!p) return;
  let idx = state.accounts.findIndex((a) => a.data__code === p.bank && a.data_num === p.stk);
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

// ---------- Tabs ----------
function initTabs() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      $("#tab-list").hidden = tab.dataset.tab !== "list";
      $("#tab-qr").hidden = tab.dataset.tab !== "qr";
    });
  });
}

// ---------- Init ----------
async function init() {
  const handled = handleApiParams();
  if (handled) return; // đã redirect hoặc in ra text, không cần dựng UI

  initTabs();
  loadGhConfigFromStorage();

  await loadRefBanks();
  await loadAccountsInitial();
  await loadTemplatesInitial();

  renderTable();
  renderTemplateList();
  renderPresets();
  populateQrAccounts();

  $("#btnToggleGithub").addEventListener("click", () => {
    $("#ghPanel").hidden = !$("#ghPanel").hidden;
  });
  $("#btnGhSave").addEventListener("click", saveGhConfigToStorage);
  $("#btnGhLoad").addEventListener("click", loadAllFromGithub);
  $("#btnGhForget").addEventListener("click", () => {
    localStorage.removeItem(LS_GH_TOKEN);
    $("#ghToken").value = "";
    updateGhStatusLabel();
    setStatus($("#ghMsg"), "Đã xoá token khỏi trình duyệt.", "ok");
  });

  $("#btnAddRow").addEventListener("click", addRow);
  $("#btnRefreshBanks").addEventListener("click", refreshRefBanksFromVietQR);
  $("#btnSaveGithub").addEventListener("click", async () => {
    localStorage.setItem(LS_ACCOUNTS_CACHE, JSON.stringify(state.accounts));
    await saveAccountsToGithub();
  });

  $("#btnManageTemplates").addEventListener("click", () => {
    $("#tplPanel").hidden = !$("#tplPanel").hidden;
  });
  $("#btnAddTemplate").addEventListener("click", addTemplate);
  $("#btnSaveTemplates").addEventListener("click", saveTemplatesToGithub);

  $("#btnSetDefaultAccount").addEventListener("click", setDefaultAccount);
  $("#btnSetDefaultTemplate").addEventListener("click", setDefaultTemplate);

  $("#qrForm").addEventListener("submit", onGenerateQr);
  $("#qrAmount").addEventListener("input", (e) => {
    e.target.value = formatNumber(e.target.value);
  });
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
  applyApiPrefill();
}

document.addEventListener("DOMContentLoaded", init);