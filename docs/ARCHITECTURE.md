# Tab Amnesty — Architecture

## Overview

Chrome Manifest V3 extension, **no build step** — plain ES modules loaded unpacked.
All state is local (`chrome.storage.local`). The only network call is the optional,
user-keyed Claude API request, made for **one cluster at a time** when the user acts.

```
┌────────────────────────────────────────────────────────────────┐
│ background.js (service worker)                                 │
│  • toolbar click → open/focus app tab                          │
│  • badge = open tab count (tabs.onCreated/onRemoved)           │
└────────────────────────────────────────────────────────────────┘
            │ opens
            ▼
┌────────────────────────────────────────────────────────────────┐
│ app/ (extension page: app.html + app.js + app.css)             │
│                                                                │
│  chrome.tabs.query ──▶ lib/cluster.js ──▶ cluster cards        │
│                         (TF-IDF + domain, local, instant)      │
│                                                                │
│  action on ONE cluster:                                        │
│    chrome.scripting.executeScript(content/extract.js)          │
│        │  page text, per tab, only for this cluster            │
│        ▼                                                       │
│    lib/llm.js ── fetch ──▶ api.anthropic.com /v1/messages      │
│    (or lib/local-summary.js when no API key)                   │
│        │                                                       │
│        ▼                                                       │
│    lib/storage.js  notes / workspaces / undo / settings        │
│        │                                                       │
│        ▼                                                       │
│    chrome.tabs.remove(...)  +  Undo toast                      │
└────────────────────────────────────────────────────────────────┘
```

## Components

### `manifest.json` (MV3)
- `permissions`: `tabs` (titles/URLs/lastAccessed), `storage`, `scripting`
- `host_permissions`: `<all_urls>` (on-demand text extraction) and
  `https://api.anthropic.com/*` (Claude API; also exempts the fetch from CORS)
- `background.service_worker`: `background.js`
- The app UI is a full extension page (`app/app.html`), not a popup — triage needs
  room, and a popup dies when focus moves.

### `background.js`
Stateless service worker. Opens/focuses the app tab on toolbar click; keeps the
badge tab-count fresh on tab create/remove. No long-lived state (MV3 workers are
killed at will).

### `lib/cluster.js` — local semantic clustering
Titles + URL tokens are enough to cluster; page text is never needed at this stage.

1. **Tokenize** title + hostname + path segments: lowercase, split on non-alphanumerics,
   drop stopwords and short tokens, light plural stemming.
2. **TF-IDF vectors** per tab, cosine similarity, plus a flat bonus for a shared
   registrable domain (two Amazon product pages belong together even when titles
   share no tokens).
3. **Agglomerative merge** (average linkage) until no pair exceeds the threshold.
   n is small (tens of tabs), so the naive O(n³) is fine.
4. **Label** each cluster from its top shared tokens, falling back to the domain.
   Leftover singletons collapse into one "Everything else" bucket.
5. **Staleness** = newest `tab.lastAccessed` in the cluster; ≥3 days triggers the
   honest nudge.

### `content/extract.js`
A function injected on demand via `chrome.scripting.executeScript` — there is **no
persistent content script**. Grabs title, meta description, and readable text
(`<article>`/`<main>` preferred, `body.innerText` fallback), capped at ~8k chars
per page. Pages that refuse injection (PDFs, chrome pages) degrade to title+URL.

### `lib/llm.js` — Claude client
Raw `fetch` to `POST https://api.anthropic.com/v1/messages` (no SDK — keeps the
zero-build constraint). Headers: `x-api-key` (user's key from settings),
`anthropic-version: 2023-06-01`, and `anthropic-dangerous-direct-browser-access: true`
(required for browser-originated calls). Default model `claude-opus-4-8`; the
settings panel offers `claude-haiku-4-5` for cheap/fast runs.

Three operations, each one request per cluster:
- **summarize** — plain markdown out.
- **extractTable** — structured output via `output_config.format` with a JSON
  schema `{title, columns[], rows[][]}` → rendered as a markdown table.
- **tldr** — structured output `{items: [{url, tldr, recommend_close}]}` →
  per-tab triage list with pre-checked verdicts.

Handles `stop_reason: "refusal"` and non-2xx errors with user-visible messages.

### `lib/local-summary.js` — no-key fallback
Extractive: bullet per tab from meta description / first sentences + a links
section. Keeps summarize and TLDR usable offline; table extraction requires a key.

### `lib/storage.js`
Thin promise wrapper over `chrome.storage.local`:

| Key | Shape |
|---|---|
| `settings` | `{apiKey, model}` |
| `notes` | `[{id, title, kind, markdown, sources[], createdAt}]` |
| `workspaces` | `[{id, name, tabs: [{url, title}], createdAt}]` |
| `undoStack` | `[{tabs: [{url, title}], ts}]` (last 5 closes) |

### `app/app.js`
Single-page UI with three views — **Triage** (cluster cards), **Notes**,
**Workspaces** — plus a settings drawer and the undo toast. Vanilla DOM, no
framework. Cluster actions are async pipelines:
`extract → (llm | fallback) → save artifact → close tabs → push undo`.

## Security & privacy

- API key lives only in `chrome.storage.local`, sent only to `api.anthropic.com`.
- Page text leaves the machine only for the cluster the user explicitly acts on,
  only when a key is configured.
- No analytics, no third-party endpoints, no remote code.

## Why these choices

- **Local clustering, LLM resolution.** Clustering must be instant and run on all
  tabs; resolution is rare, user-initiated, and high-value — exactly where an LLM
  call is worth it. This is also what keeps cost ≈ one request per resolved cluster.
- **Full-page app over popup.** Triage is a seated task; popups close on any
  misclick and can't host a notes archive.
- **Raw fetch over SDK.** The official TS SDK wants a bundler; the API surface used
  here is one endpoint. Trade made consciously, isolated inside `lib/llm.js`.
