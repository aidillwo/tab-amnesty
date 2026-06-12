# Tab Amnesty

Open tabs are not a storage problem — they are **anxiety to batch-resolve**.

Tab Amnesty is a Chrome extension that reads your open tabs, clusters them
semantically (locally, instantly), and offers the right *resolution* per cluster:
summarize into one note, extract a comparison table, TLDR-triage tab by tab, or
save as a reopenable workspace — then closes the tabs. You end the session with
fewer tabs and a single artifact that captures what mattered, so closing costs
you nothing.

📋 [Product plan](docs/PLAN.md) · 🏗 [Architecture](docs/ARCHITECTURE.md)

## Install (load unpacked — no build step)

1. Clone this repo.
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and select the `extension/` folder.
4. Click the Tab Amnesty toolbar icon (badge shows your open-tab count).

## Optional: Claude API key

Tab Amnesty works without any key using a local extractive fallback. For real
summaries, comparison tables, and per-tab TLDRs, open **Settings** in the app
and paste a Claude API key (get one at <https://platform.claude.com>). The key is
stored only in your browser's local extension storage and sent only to
`api.anthropic.com`, one request per cluster you resolve. Default model is
Claude Opus 4.8; Haiku 4.5 is available for cheap/fast runs.

## What it does

| Action | Result |
|---|---|
| **Summarize & close** | One markdown note (key points + source links), tabs closed |
| **Extract table & close** | Comparison table — prices, specs, deadlines — tabs closed |
| **TLDR triage** | One honest line per tab, keep/close checkboxes, decisions in 30s |
| **Save as workspace** | Named session you can reopen in one click |
| **Just close** | For when you already know |

Every close is **undoable** from the toast. Stale clusters get the honest nudge:
*"Untouched for 13 days. You are not going to read these."*

## Privacy

- No analytics, no servers, no accounts.
- Page text leaves your machine only for the one cluster you act on, only if you
  configured an API key, and only to Anthropic's API.

## Repository layout

```
extension/        the Chrome extension (load this folder unpacked)
  manifest.json   MV3 manifest
  background.js   service worker: badge + app launcher
  app/            full-page triage UI (vanilla ES modules)
  lib/            clustering, Claude client, storage, local fallback
  content/        on-demand page text extractor
docs/             PLAN.md and ARCHITECTURE.md
```
