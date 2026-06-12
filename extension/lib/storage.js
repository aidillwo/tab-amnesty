// Promise wrappers over chrome.storage.local for settings, notes, workspaces, undo.

const UNDO_LIMIT = 5;

async function get(key, fallback) {
  const obj = await chrome.storage.local.get(key);
  return obj[key] ?? fallback;
}

function set(key, value) {
  return chrome.storage.local.set({ [key]: value });
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// --- settings ---
export const getSettings = () => get("settings", { apiKey: "", model: "" });
export const saveSettings = (settings) => set("settings", settings);

// --- notes ---
export const getNotes = () => get("notes", []);

export async function addNote({ title, kind, markdown, sources }) {
  const notes = await getNotes();
  const note = { id: newId(), title, kind, markdown, sources, createdAt: Date.now() };
  notes.unshift(note);
  await set("notes", notes);
  return note;
}

export async function deleteNote(id) {
  await set("notes", (await getNotes()).filter((n) => n.id !== id));
}

// --- workspaces ---
export const getWorkspaces = () => get("workspaces", []);

export async function addWorkspace({ name, tabs }) {
  const workspaces = await getWorkspaces();
  const ws = {
    id: newId(),
    name,
    tabs: tabs.map((t) => ({ url: t.url, title: t.title })),
    createdAt: Date.now(),
  };
  workspaces.unshift(ws);
  await set("workspaces", workspaces);
  return ws;
}

export async function deleteWorkspace(id) {
  await set("workspaces", (await getWorkspaces()).filter((w) => w.id !== id));
}

// --- undo ---
export async function pushUndo(tabs) {
  const stack = await get("undoStack", []);
  stack.push({ tabs: tabs.map((t) => ({ url: t.url, title: t.title })), ts: Date.now() });
  await set("undoStack", stack.slice(-UNDO_LIMIT));
}

export async function popUndo() {
  const stack = await get("undoStack", []);
  const entry = stack.pop();
  await set("undoStack", stack);
  return entry || null;
}
