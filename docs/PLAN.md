# Tab Amnesty — Product Plan

## The flip

Open tabs are not a storage problem, they are **anxiety to batch-resolve**. Bookmark
managers fail because saving a tab just moves the guilt somewhere you'll never look.
The right action is *resolution*, not archival: notice a stale cluster, extract
whatever value is in it, and close it in one move.

**End state of a session:** fewer tabs + a single artifact that captures what
mattered, so closing costs you nothing.

## Core flow

1. Open the Tab Amnesty page (toolbar button). It reads every open tab's title + URL.
2. Tabs are grouped **semantically** into clusters, instantly and locally.
3. Each cluster card shows its tabs, age ("stale for 12 days"), and the resolution
   actions that fit it.
4. The user picks an action; page text is pulled **only for the cluster they act on**.
5. The artifact (note / table / workspace) is saved, the tabs close, and an **Undo**
   toast guards against regret.

## Resolution actions

| Action | What it produces | Best for |
|---|---|---|
| **Summarize & close** | One markdown note: key points + source links | Research rabbit holes, "read later" piles |
| **Extract table & close** | Comparison table (columns chosen by the model) | Shopping, job postings, flights/hotels |
| **TLDR triage** | One-liner per tab + keep/close checkbox per tab | Mixed piles you want to decide on in 30s |
| **Save as workspace** | Named, reopenable session | Work context tied to a ticket/project |

## Improvements added beyond the original brief

1. **Undo everything.** Every close action pushes the closed URLs onto an undo stack
   with a visible toast. Closing tabs must feel free, not risky — this is the single
   biggest trust feature.
2. **Honest nudge.** Clusters whose tabs haven't been touched in days get flagged:
   *"Untouched for 13 days. You are not going to read these."* Uses
   `tab.lastAccessed` — no tracking, no storage.
3. **Works without an API key.** A local extractive fallback (titles + meta
   descriptions + link list) keeps the demo and the core close-with-artifact loop
   functional offline. The Claude API key (user-supplied, stored locally) unlocks
   real summaries, tables, and TLDRs.
4. **Amnesty log.** Notes and workspaces live in a second view in the same page —
   one place to look, copy-as-markdown, or delete. Artifacts are useless if they
   are scattered.
5. **Badge counter.** The toolbar icon shows your open-tab count — ambient pressure
   that makes the "40 → 4" payoff visible.
6. **The app never eats itself.** Internal pages (chrome://, the app itself) are
   excluded from clustering and closing.

## Deliberate scope cuts (v1)

- **No LLM clustering.** Local TF-IDF + domain clustering on titles/URLs is fast,
  free, and good enough; an LLM refinement pass is a clean future add.
- **No recurring-tab detection / morning sessions.** Needs history over days;
  workspaces cover 80% of the value. Future.
- **No recipe-cookbook / itinerary templates.** The generic summarize + extract
  actions already handle these; specialized prompts can come later.
- **Chrome only.** MV3 with `chrome.*` APIs; Firefox port is mostly mechanical.
- **No build step.** Plain ES modules, load-unpacked. A weekend project should not
  have a webpack config.

## Demo script (under a minute)

1. Start with a chaotic ~40-tab window. Badge reads **40**.
2. Click the toolbar icon → clusters appear instantly.
3. "Mechanical keyboards" cluster (8 tabs, stale 9 days) → **Extract table** →
   comparison table appears, tabs close.
4. "React Server Components" cluster (12 tabs) → **Summarize** → one note with key
   points + links, tabs close.
5. "PROJ-142 ticket" cluster (6 tabs) → **Save as workspace** → named, closed,
   one-click reopenable.
6. Badge reads **7**. Three artifacts in the Amnesty log. Done.

## Milestones

- **M1** — Extension skeleton: manifest, background worker, app page opens, tabs
  listed, badge counter. *(this repo, done)*
- **M2** — Local clustering + cluster cards + staleness. *(done)*
- **M3** — Resolution actions wired end-to-end with Claude API + local fallback,
  undo, storage. *(done)*
- **M4** — Polish: settings panel, Amnesty log view, copy/export. *(done)*
- **Future** — LLM cluster refinement, recurring-tab detection, Firefox port,
  cookbook/itinerary templates, options sync.
