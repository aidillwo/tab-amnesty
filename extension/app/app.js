import { clusterTabs } from "../lib/cluster.js";
import { summarizeCluster, extractTable, tldrTabs, MODELS, DEFAULT_MODEL } from "../lib/llm.js";
import { localSummary, localTldr } from "../lib/local-summary.js";
import { extractPageContent } from "../content/extract.js";
import * as store from "../lib/storage.js";

const $ = (sel) => document.querySelector(sel);

let state = {
  tabs: [],
  clusters: [],
  settings: { apiKey: "", model: "" },
  view: "triage",
};

// ---------- bootstrap ----------

async function init() {
  state.settings = await store.getSettings();
  initSettingsDialog();
  initNav();
  $("#recluster").addEventListener("click", refresh);
  $("#toast-close").addEventListener("click", hideToast);
  await refresh();
}

async function refresh() {
  const appUrl = chrome.runtime.getURL("");
  const all = await chrome.tabs.query({});
  state.tabs = all.filter(
    (t) => t.url && /^https?:/.test(t.url) && !t.url.startsWith(appUrl)
  );
  state.clusters = clusterTabs(state.tabs);
  $("#tab-count").textContent = `${state.tabs.length} open tabs`;
  renderView();
}

// ---------- views ----------

function initNav() {
  document.querySelectorAll(".nav-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.view = btn.dataset.view;
      document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b === btn));
      renderView();
    })
  );
}

function renderView() {
  for (const v of ["triage", "notes", "workspaces"]) {
    $(`#view-${v}`).classList.toggle("hidden", v !== state.view);
  }
  if (state.view === "triage") renderTriage();
  if (state.view === "notes") renderNotes();
  if (state.view === "workspaces") renderWorkspaces();
}

// ---------- triage ----------

function renderTriage() {
  const root = $("#view-triage");
  root.innerHTML = "";
  if (state.clusters.length === 0) {
    root.innerHTML = `<div class="empty">No open tabs to triage. Enjoy the silence.</div>`;
    return;
  }
  const grid = el("div", "cluster-grid");
  for (const cluster of state.clusters) grid.append(clusterCard(cluster));
  root.append(grid);
}

function clusterCard(cluster) {
  const card = el("div", "cluster-card");

  const head = el("div", "cluster-head");
  head.append(
    el("span", "cluster-label", cluster.label),
    el("span", "cluster-size", `${cluster.tabs.length} tab${cluster.tabs.length > 1 ? "s" : ""}`)
  );
  card.append(head);

  if (cluster.isStale) {
    card.append(
      el("div", "nudge", `Untouched for ${cluster.staleDays} days. You are not going to read these. Get the gist and let go.`)
    );
  }

  const list = el("ul", "tab-list");
  for (const tab of cluster.tabs) {
    const li = el("li");
    if (tab.favIconUrl && /^https?:/.test(tab.favIconUrl)) {
      const img = document.createElement("img");
      img.src = tab.favIconUrl;
      li.append(img);
    }
    const a = el("a", "", tab.title || tab.url);
    a.href = tab.url;
    a.title = tab.url;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.tabs.update(tab.id, { active: true });
    });
    li.append(a);
    list.append(li);
  }
  card.append(list);

  const status = el("div", "working hidden");
  card.append(status);

  const actions = el("div", "cluster-actions");
  const buttons = [
    ["Summarize & close", () => actionSummarize(cluster, card)],
    ["Extract table & close", () => actionTable(cluster, card)],
    ["TLDR triage", () => actionTldr(cluster, card)],
    ["Save as workspace", () => actionWorkspace(cluster)],
    ["Just close", () => closeTabs(cluster.tabs, `Closed ${cluster.tabs.length} tabs.`)],
  ];
  for (const [label, fn] of buttons) {
    const b = el("button", "", label);
    b.addEventListener("click", () => fn());
    actions.append(b);
  }
  card.append(actions);
  return card;
}

function setWorking(card, msg) {
  const status = card.querySelector(".working");
  status.textContent = msg || "";
  status.classList.toggle("hidden", !msg);
  card.querySelectorAll(".cluster-actions button").forEach((b) => (b.disabled = !!msg));
}

// ---------- page extraction ----------

async function extractPages(cluster, { withText = true } = {}) {
  return Promise.all(
    cluster.tabs.map(async (tab) => {
      const fallback = { title: tab.title || "", url: tab.url, description: "", text: "" };
      if (!withText) return fallback;
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractPageContent,
        });
        return result?.result || fallback;
      } catch {
        return fallback; // PDFs, store pages, discarded tabs — degrade to title+URL
      }
    })
  );
}

// ---------- resolution actions ----------

async function actionSummarize(cluster, card) {
  const { apiKey, model } = state.settings;
  try {
    setWorking(card, "Reading pages…");
    const pages = await extractPages(cluster, { withText: !!apiKey });
    setWorking(card, apiKey ? "Summarizing with Claude…" : "Building local summary…");
    const markdown = apiKey
      ? await summarizeCluster({ apiKey, model: model || DEFAULT_MODEL, label: cluster.label, pages })
      : localSummary({ label: cluster.label, pages });
    await store.addNote({
      title: cluster.label,
      kind: "summary",
      markdown,
      sources: pages.map((p) => p.url),
    });
    await closeTabs(cluster.tabs, `Summarized & closed ${cluster.tabs.length} tabs. Note saved.`);
  } catch (err) {
    setWorking(card, "");
    showToast(`Summarize failed: ${err.message}`);
  }
}

async function actionTable(cluster, card) {
  const { apiKey, model } = state.settings;
  if (!apiKey) {
    showToast("Table extraction needs a Claude API key — add one in Settings.");
    return;
  }
  try {
    setWorking(card, "Reading pages…");
    const pages = await extractPages(cluster);
    setWorking(card, "Extracting table with Claude…");
    const table = await extractTable({ apiKey, model: model || DEFAULT_MODEL, label: cluster.label, pages });
    const markdown = tableToMarkdown(table, pages);
    await store.addNote({
      title: table.title || cluster.label,
      kind: "table",
      markdown,
      sources: pages.map((p) => p.url),
    });
    await closeTabs(cluster.tabs, `Extracted table & closed ${cluster.tabs.length} tabs. Note saved.`);
  } catch (err) {
    setWorking(card, "");
    showToast(`Extraction failed: ${err.message}`);
  }
}

function tableToMarkdown(table, pages) {
  const esc = (cell) => String(cell ?? "").replace(/\|/g, "\\|");
  const lines = [
    `| ${table.columns.map(esc).join(" | ")} |`,
    `| ${table.columns.map(() => "---").join(" | ")} |`,
    ...table.rows.map((row) => `| ${row.map(esc).join(" | ")} |`),
  ];
  if (table.note) lines.push("", `> ${table.note}`);
  lines.push("", "## Sources", "", ...pages.map((p) => `- [${p.title || p.url}](${p.url})`));
  return lines.join("\n");
}

async function actionTldr(cluster, card) {
  const { apiKey, model } = state.settings;
  try {
    setWorking(card, "Reading pages…");
    const pages = await extractPages(cluster, { withText: !!apiKey });
    setWorking(card, apiKey ? "Writing TLDRs with Claude…" : "Building local TLDRs…");
    const { items } = apiKey
      ? await tldrTabs({ apiKey, model: model || DEFAULT_MODEL, pages })
      : localTldr({ pages });
    setWorking(card, "");
    openTldrDialog(cluster, pages, items);
  } catch (err) {
    setWorking(card, "");
    showToast(`TLDR failed: ${err.message}`);
  }
}

function openTldrDialog(cluster, pages, items) {
  const dialog = $("#triage-dialog");
  const body = $("#triage-dialog-body");
  body.innerHTML = "";
  body.append(el("h2", "", `TLDR triage — ${cluster.label}`));
  body.append(el("p", "hint", "Checked tabs will be closed. Their TLDRs are saved as one note either way."));

  const byUrl = new Map(items.map((i) => [i.url, i]));
  const rows = cluster.tabs.map((tab) => {
    const item = byUrl.get(tab.url) || { tldr: tab.title || tab.url, recommend_close: true };
    const row = el("div", "tldr-item");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.recommend_close;
    const text = el("div", "tldr-text");
    text.append(el("b", "", tab.title || tab.url), el("span", "", item.tldr));
    row.append(checkbox, text);
    body.append(row);
    return { tab, item, checkbox };
  });

  const actions = el("div", "dialog-actions");
  const cancel = el("button", "", "Cancel");
  cancel.addEventListener("click", () => dialog.close());
  const confirm = el("button", "primary", "Save note & close selected");
  confirm.addEventListener("click", async () => {
    dialog.close();
    const markdown = [
      ...rows.map(({ tab, item }) => `- **[${tab.title || tab.url}](${tab.url})** — ${item.tldr}`),
    ].join("\n");
    await store.addNote({
      title: `TLDR: ${cluster.label}`,
      kind: "tldr",
      markdown,
      sources: cluster.tabs.map((t) => t.url),
    });
    const toClose = rows.filter((r) => r.checkbox.checked).map((r) => r.tab);
    if (toClose.length > 0) {
      await closeTabs(toClose, `Saved TLDRs, closed ${toClose.length} of ${rows.length} tabs.`);
    } else {
      showToast("Saved TLDRs. Nothing closed.");
      await refresh();
    }
  });
  actions.append(cancel, confirm);
  body.append(actions);
  dialog.showModal();
}

async function actionWorkspace(cluster) {
  const name = prompt("Workspace name:", cluster.label);
  if (!name) return;
  await store.addWorkspace({ name, tabs: cluster.tabs });
  await closeTabs(cluster.tabs, `Workspace “${name}” saved. ${cluster.tabs.length} tabs closed — reopen any time.`);
}

// ---------- closing & undo ----------

async function closeTabs(tabs, message) {
  await store.pushUndo(tabs);
  await chrome.tabs.remove(tabs.map((t) => t.id));
  showToast(message, { undo: true });
  await refresh();
}

async function undoClose() {
  const entry = await store.popUndo();
  if (!entry) return;
  for (const t of entry.tabs) chrome.tabs.create({ url: t.url, active: false });
  hideToast();
  setTimeout(refresh, 500);
}

// ---------- notes view ----------

async function renderNotes() {
  const root = $("#view-notes");
  root.innerHTML = "";
  const notes = await store.getNotes();
  if (notes.length === 0) {
    root.innerHTML = `<div class="empty">No notes yet. Resolve a cluster in Triage and the artifact lands here.</div>`;
    return;
  }
  for (const note of notes) {
    const card = el("div", "note-card");
    const head = el("div", "note-head");
    head.append(
      el("h3", "", note.title),
      el("span", "note-meta", `${note.kind} · ${new Date(note.createdAt).toLocaleString()}`)
    );
    card.append(head);
    const body = el("div", "note-body");
    body.innerHTML = renderMarkdown(note.markdown);
    card.append(body);

    const actions = el("div", "note-actions");
    const copy = el("button", "", "Copy markdown");
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(note.markdown);
      showToast("Copied to clipboard.");
    });
    const del = el("button", "danger", "Delete");
    del.addEventListener("click", async () => {
      await store.deleteNote(note.id);
      renderNotes();
    });
    actions.append(copy, del);
    card.append(actions);
    root.append(card);
  }
}

// ---------- workspaces view ----------

async function renderWorkspaces() {
  const root = $("#view-workspaces");
  root.innerHTML = "";
  const workspaces = await store.getWorkspaces();
  if (workspaces.length === 0) {
    root.innerHTML = `<div class="empty">No workspaces yet. Save a cluster as a workspace to clear your screen without losing the thread.</div>`;
    return;
  }
  for (const ws of workspaces) {
    const card = el("div", "ws-card");
    const head = el("div", "ws-head");
    head.append(
      el("h3", "", ws.name),
      el("span", "note-meta", `${ws.tabs.length} tabs · ${new Date(ws.createdAt).toLocaleDateString()}`)
    );
    card.append(head);

    const list = el("ul", "tab-list");
    for (const t of ws.tabs) {
      const li = el("li");
      const a = el("a", "", t.title || t.url);
      a.href = t.url;
      a.target = "_blank";
      li.append(a);
      list.append(li);
    }
    card.append(list);

    const actions = el("div", "note-actions");
    const open = el("button", "primary", "Reopen all");
    open.addEventListener("click", () => {
      chrome.windows.create({ url: ws.tabs.map((t) => t.url) });
    });
    const del = el("button", "danger", "Delete");
    del.addEventListener("click", async () => {
      await store.deleteWorkspace(ws.id);
      renderWorkspaces();
    });
    actions.append(open, del);
    card.append(actions);
    root.append(card);
  }
}

// ---------- settings ----------

function initSettingsDialog() {
  const dialog = $("#settings-dialog");
  const select = $("#model-select");
  select.innerHTML = "";
  for (const m of MODELS) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.label;
    select.append(opt);
  }

  $("#open-settings").addEventListener("click", () => {
    $("#api-key").value = state.settings.apiKey;
    select.value = state.settings.model || DEFAULT_MODEL;
    dialog.showModal();
  });
  $("#settings-cancel").addEventListener("click", () => dialog.close());
  $("#settings-form").addEventListener("submit", async () => {
    state.settings = { apiKey: $("#api-key").value.trim(), model: select.value };
    await store.saveSettings(state.settings);
    showToast(state.settings.apiKey ? "Settings saved." : "Settings saved — running in local fallback mode.");
  });
}

// ---------- toast ----------

let toastTimer = null;

function showToast(message, { undo = false } = {}) {
  $("#toast-msg").textContent = message;
  const undoBtn = $("#toast-undo");
  undoBtn.classList.toggle("hidden", !undo);
  undoBtn.onclick = undoClose;
  $("#toast").classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, undo ? 12000 : 5000);
}

function hideToast() {
  $("#toast").classList.add("hidden");
}

// ---------- minimal markdown renderer (escaped first, so injected HTML stays inert) ----------

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(s) {
  return s
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) =>
      /^https?:/.test(href) ? `<a href="${href}" target="_blank">${text}</a>` : text
    )
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/_([^_]+)_/g, "<i>$1</i>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function renderMarkdown(md) {
  const lines = escapeHtml(md).split("\n");
  const out = [];
  let listOpen = false;
  let tableRows = [];

  const flushList = () => { if (listOpen) { out.push("</ul>"); listOpen = false; } };
  const flushTable = () => {
    if (tableRows.length === 0) return;
    const rows = tableRows.filter((r) => !/^\s*\|[\s:-]+\|\s*$/.test(r));
    out.push("<table>");
    rows.forEach((row, i) => {
      const cells = row.replace(/^\s*\||\|\s*$/g, "").split("|").map((c) => inline(c.trim()));
      const tag = i === 0 ? "th" : "td";
      out.push(`<tr>${cells.map((c) => `<${tag}>${c}</${tag}>`).join("")}</tr>`);
    });
    out.push("</table>");
    tableRows = [];
  };

  for (const line of lines) {
    if (/^\s*\|.*\|\s*$/.test(line)) { flushList(); tableRows.push(line); continue; }
    flushTable();
    const heading = line.match(/^(#{1,4})\s+(.*)/);
    if (heading) {
      flushList();
      const level = Math.min(heading[1].length + 2, 6);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (!listOpen) { out.push("<ul>"); listOpen = true; }
      out.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
    } else if (/^\s*&gt;\s?/.test(line)) {
      flushList();
      out.push(`<blockquote>${inline(line.replace(/^\s*&gt;\s?/, ""))}</blockquote>`);
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  flushList();
  flushTable();
  return out.join("\n");
}

// ---------- utils ----------

function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

init();
