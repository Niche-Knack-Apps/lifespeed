# Lifespeed Performance Baseline & Multi-Journal Guardrails

**Date:** 2026-02-10
**Branch:** multi-journal
**Baseline measurement:** 51ms launch-to-typing (Tauri, warm cache)

---

## 1. Current Startup Sequence (Critical Path)

The app optimizes for a single metric: **time from launch to editor-focused and typeable**. Here is the exact sequence:

### Phase 0: HTML Parse & Pre-Bundle Scripts (~sync, blocks rendering)
```
index.html loads:
  1. theme-cache.js         — SYNC, instant (~0ms). Reads localStorage for theme/font-size,
                               applies data-theme attribute. Prevents flash-of-wrong-theme.
  2. debug-logger.js        — SYNC, initializes logger.
  3. metadata-cache.js      — SYNC constructor + ASYNC init(). Constructor is instant.
                               metadataCache.init() opens IndexedDB — returns a Promise
                               that resolves later. Does NOT block HTML parsing.
  4. niche-knack-config.js  — SYNC, trivial config object.
  5. about-section.js       — SYNC, trivial.
  6. lib/markdown-it.min.js — SYNC, ~50KB parsed.
  7. lib/markdown-it-footnote.min.js — SYNC, small.
  8. lib/markdown-it-source-lines.js — SYNC, small.
  9. lib/fuse.min.js        — SYNC, ~25KB parsed.
 10. dist/app.bundle.js     — SYNC, ~174KB parsed. Contains all app code.
```

### Phase 1: DOMContentLoaded → App.init() (~51ms total)
```
DOMContentLoaded fires → new App() → app.init():

  STEP 1: cacheDOMReferences()          — ~0ms (getElementById calls, all sync)
  STEP 2: await loadSettings()          — ~1-5ms
           └─ platform.loadSettings()   (Tauri: invoke; Web: localStorage)
           └─ platform.getEntriesDir()  (reads settings again for entries path)
  STEP 3: applyTheme() / applyFontSize() — ~0ms (setAttribute, redundant if theme-cache hit)
  STEP 4: initEditor()                  — ~0ms (event listeners + ScrollSync init)
  STEP 5: initToolbar()                 — ~0ms (event listeners)
  STEP 6: initSidebar()                 — ~0ms (event listeners + sort controls)
  STEP 7: initFinder()                  — ~0ms (event listeners)
  STEP 8: initSettingsModal()           — ~0ms (event listeners)
  STEP 9: initKeyboardShortcuts()       — ~0ms (event listeners)
  STEP 10: setupFileWatcher()           — ~0ms (not yet implemented)
  STEP 11: await prepareDraftEntry()    — ~2-10ms
           └─ platform.getEntriesDir()  (reads settings, may be cached)
           └─ Constructs in-memory entry (NO disk write — isDraft=true)
           └─ Sets editor.value, parses frontmatter, renders preview
  STEP 12: Hide loading, show app       — ~0ms (classList toggle)
  STEP 13: focusCurrentEditor()         — ~0ms (focus + selection range)

  ══════════════════════════════════════════════════
  EDITOR IS NOW FOCUSED AND TYPEABLE (~51ms)
  ══════════════════════════════════════════════════
```

### Phase 2: Background Operations (NON-BLOCKING, after editor is ready)
```
  STEP 14: loadEntriesList()            — ASYNC, runs in background
           ├─ metadataCache.init()      (if not ready, awaits IndexedDB open ~5-20ms)
           ├─ platform.getEntriesDir()  (~1ms, gets folder path)
           ├─ metadataCache.hasCacheForFolder()  (~1ms, IndexedDB read)
           │
           ├─ FAST PATH (cache exists for folder):
           │   ├─ metadataCache.getAllEntries()    (~5-50ms depending on count)
           │   ├─ renderEntriesList()              (~5-20ms, max 50 DOM items)
           │   ├─ backfillMetadata()               (ASYNC, background)
           │   └─ verifyFilesystemEntries()        (ASYNC, background)
           │
           └─ SLOW PATH (first launch / new folder):
               └─ buildInitialIndex()              (shows progress overlay)
                   ├─ listEntriesFast()            (directory listing, no file reads)
                   ├─ batchGetMetadata() in batches of 100
                   ├─ Progressive rendering at 50 entries
                   └─ Cache persistence to IndexedDB

  STEP 15: ensureCurrentEntryInSidebar() — after loadEntriesList completes
```

### Key Timing Analysis

| Operation | Time | Blocking? |
|-----------|------|-----------|
| Theme cache apply | <1ms | Sync (intentional) |
| DOM reference caching | <1ms | Sync |
| Settings load | 1-5ms | Async (awaited) |
| Editor/toolbar/sidebar init | <1ms | Sync (listeners only) |
| Draft entry preparation | 2-10ms | Async (awaited, no disk I/O) |
| **TOTAL TO TYPEABLE** | **~51ms** | — |
| IndexedDB open | 5-20ms | Background |
| Cache read (all entries) | 5-50ms | Background |
| Sidebar render (50 items) | 5-20ms | Background |
| Filesystem verification | 50-500ms | Background |

---

## 2. Async vs Sync Operations at Startup

### Synchronous (blocks rendering)
- `theme-cache.js` — intentional, prevents theme flash
- `cacheDOMReferences()` — fast getElementById calls
- Event listener setup (initEditor, initToolbar, etc.)
- `focusCurrentEditor()` — focus + selection

### Asynchronous (awaited in init, before editor focus)
- `loadSettings()` — platform IPC/invoke, ~1-5ms
- `prepareDraftEntry()` — gets entries dir, builds in-memory entry, ~2-10ms

### Asynchronous (background, after editor focus)
- `loadEntriesList()` — IndexedDB + optional filesystem verify
- `ensureCurrentEntryInSidebar()` — minor DOM update
- `backfillMetadata()` — batch file reads if cache incomplete
- `verifyFilesystemEntries()` — filesystem listing + diff against cache

---

## 3. Where Time Is Spent

### File I/O
- **Settings read:** 1-5ms per platform call (Tauri: 2 invokes for file_exists + read_file)
- **Entry listing:** Tauri's `list_entries_with_metadata` is a single Rust call returning all entries with frontmatter parsed — very fast. Capacitor uses SAF.
- **Entry load:** Single file read per entry (~1-5ms)
- **Search index save/load:** JSON serialization to file (~10-50ms for large journals)

### IndexedDB
- **Open:** 5-20ms (includes upgrade check)
- **getAllEntries():** 5-50ms for hundreds of entries
- **saveEntries() batch:** 5-20ms per batch of 50-100
- **Single entry operations:** <5ms

### DOM Rendering
- **renderEntriesList():** Creates DOM elements, max 50 initially (virtualized)
- **renderEntryItem():** innerHTML per item + 2 event listeners
- **Lazy loading:** Additional batches of 50 on scroll

### Search Indexing
- **Fuse.js init:** Instant if index data exists (new Fuse(data, options))
- **Full rebuild:** Sequential file reads — O(n) where n = entry count. Each entry: loadEntry + frontmatter.parse + stripStopwords
- **Finder index build:** Reuses sidebar allEntries or metadataCache — no extra file reads

---

## 4. New Entry Creation Flow

```
createNewEntry():
  1. saveOrDiscardCurrentEntry()    — save or delete previous entry
  2. prepareDraftEntry()            — in-memory only (isDraft=true)
     └─ NO disk write until first auto-save
  3. focusCurrentEditor()           — focus + cursor at end

First keypress → input event → scheduleAutoSave():
  └─ setTimeout(500ms) → saveCurrentEntryImmediate():
     └─ If isDraft: platform.createEntry() — FIRST disk write
     └─ Then: platform.saveEntry() with current content
```

**Critical insight:** New entries are drafts in memory. File creation is deferred to first auto-save (500ms after typing). This means **entry creation itself is near-instant**.

---

## 5. Performance Risks from Multi-Journal

### 5.1 Multiple Search Indexes

**Current state:** One search index file per app (`search-index.json`). One Fuse.js instance.

**Risk:** If each journal has its own index, journal switching requires:
- Loading new index from disk (10-50ms for JSON parse)
- Creating new Fuse instance (instant with pre-built data)
- Saving old index if modified

**Guardrail:** Lazy-load search indexes. Only load the active journal's index. Never load all indexes at startup.

### 5.2 Journal Switching Cost

**Current state:** App assumes one entries directory. Switching directory would require:
1. Save current entry
2. Update `entriesDirectory` in settings
3. Reload sidebar (cache lookup or build index)
4. Prepare new draft entry

**Risk areas:**
- `loadEntriesList()` is the expensive path — IndexedDB reads + potential filesystem verify
- `renderEntriesList()` wipes `innerHTML` and rebuilds DOM

**Guardrail:** Journal switching must use the FAST PATH (cache hit). Each journal's cache must be pre-warmed so switching never triggers `buildInitialIndex()` in the foreground.

### 5.3 IndexedDB with Multiple Stores/Databases

**Current state:** Single IndexedDB `atsl-metadata` with `entries` and `meta` stores. Cache is folder-aware via `meta.folderPath`.

**Risk:** Two approaches, each with tradeoffs:

**Option A: One DB, multi-journal key prefixing**
- Simpler, fewer DB connections
- Risk: getAllEntries() returns ALL journals' data, needs filtering
- Risk: cache clearing for one journal requires selective deletes

**Option B: Separate DB per journal (e.g., `atsl-metadata-{journalId}`)**
- Clean isolation — getAllEntries() returns only active journal
- Switching journals = close one DB, open another (~5-20ms)
- No cross-contamination risk
- **Recommended approach**

**Guardrail:** Keep IndexedDB open/close cost under 20ms. Pre-open the last-used journal's DB at startup.

### 5.4 Settings Reads with Journal List

**Current state:** Settings are read once at startup via `platform.loadSettings()`. Settings include `entriesDirectory`.

**Risk:** Multi-journal adds a journal list to settings. If journals list is large, settings file grows. Every `loadSettings()` / `saveSettings()` call pays the cost.

**Guardrail:** Keep journal list lightweight — just `{id, name, path}` objects. No metadata or index data in settings. Settings reads must stay under 5ms.

---

## 6. Performance Guardrails for Multi-Journal Implementation

### MUST (Hard Requirements)

1. **Launch-to-typing MUST remain under 100ms** (currently 51ms, budget allows ~50ms overhead)
2. **Journal switching MUST complete in under 200ms** (save + cache swap + draft prep + focus)
3. **Never call `buildInitialIndex()` during journal switch** — pre-warm caches on journal add
4. **Never load multiple Fuse.js indexes simultaneously** — one active index only
5. **Draft entry creation MUST remain in-memory** — no disk I/O on journal switch
6. **`prepareDraftEntry()` must NOT become slower** — it only needs the entries dir path

### SHOULD (Strong Recommendations)

7. **Use separate IndexedDB per journal** — clean isolation, no filtering overhead
8. **Pre-open the default journal's DB at startup** — same timing as current
9. **Lazy-load non-active journal metadata** — only when user switches or opens finder
10. **Cache the journal list in localStorage** — avoid settings IPC on startup
11. **Keep `verifyFilesystemEntries()` per-journal** — only verify active journal
12. **Journal picker UI must not add DOM weight to main editor view**

### MUST NOT (Anti-Patterns to Avoid)

13. **DO NOT iterate all journals at startup** — only load active journal
14. **DO NOT pre-build search indexes for all journals** — build on first search per journal
15. **DO NOT add synchronous operations to the init() path** — everything new must be background
16. **DO NOT use `innerHTML` for journal switcher** — use lightweight DOM creation
17. **DO NOT store entry content in the journal list** — only `{id, name, path}` + optional `entryCount`
18. **DO NOT make settings reads dependent on journal count** — O(1) not O(n)
19. **DO NOT block editor focus for journal metadata loading** — editor must be typeable before sidebar is populated
20. **DO NOT add new `await` calls to init() between `prepareDraftEntry()` and `focusCurrentEditor()`** — this is the critical path

---

## 7. Specific Recommendations

### 7.1 Journal Switching Architecture

```
switchJournal(journalId):
  1. saveOrDiscardCurrentEntry()          — fast if content exists
  2. Close current metadataCache DB       — ~1ms
  3. Update activeJournal in memory       — ~0ms
  4. Open new journal's metadataCache DB  — ~5-20ms
  5. prepareDraftEntry(newJournalPath)    — ~2-10ms
  6. focusCurrentEditor()                 — ~0ms
  === EDITOR TYPEABLE ===                 Total: ~20-30ms

  7. loadEntriesList() in background      — uses new journal's cache
  8. Swap Fuse.js index lazily            — only if finder is opened
```

### 7.2 Cache Strategy

- **Active journal:** Full cache in IndexedDB, opened at startup
- **Inactive journals:** Cache DBs exist on disk but NOT opened until switched to
- **Cache warming:** When a new journal is added, run `buildInitialIndex()` immediately (one-time). This ensures the cache exists before the user ever switches to it.
- **Cache invalidation:** Per-journal `meta.folderPath` already supports this. Each journal DB has its own meta store.

### 7.3 Search Index Strategy

- **Active journal:** Fuse.js index loaded from `search-index.json` (current behavior)
- **Inactive journals:** No Fuse.js instance. Index file may exist on disk.
- **Cross-journal search:** Future feature. Would require iterating journal DBs — expensive, should be opt-in and show progress.

### 7.4 Settings Structure

```json
{
  "theme": "dark",
  "fontSize": "medium",
  "autoSave": true,
  "autoSaveDelay": 500,
  "activeJournal": "default",
  "journals": [
    { "id": "default", "name": "Journal", "path": "/home/user/Documents/Journal" },
    { "id": "work", "name": "Work Notes", "path": "/home/user/Documents/Work" }
  ]
}
```

Keep it flat. No nested objects per journal beyond `{id, name, path}`.

---

## 8. File Load Order Impact

Current esbuild.config.mjs order:
```
1. platform.js      — PlatformService (global `platform`)
2. frontmatter.js   — frontmatter parser (global `frontmatter`)
3. entries.js       — placeholder
4. search.js        — search index + Fuse.js wrapper
5. tags.js          — tag management
6. finder.js        — placeholder
7. images.js        — image handling
8. files.js         — file attachment
9. editor.js        — placeholder
10. gestures.js     — touch gestures
11. settings.js     — placeholder
12. about.js        — about section
13. scroll-sync.js  — scroll synchronization
14. app.js          — main App class (DOMContentLoaded → init)
```

**For multi-journal:** If a `journal.js` module is added, it should go between `platform.js` and `entries.js` (position 2 or 3) since it provides journal context that entries/search/cache will need. However, it must NOT add any initialization cost at parse time — only define a class/object.

---

## 9. Summary

The current architecture is well-optimized with clear separation between the critical path (51ms to typing) and background operations. The multi-journal feature can be added safely IF:

1. Journal switching reuses the existing cache fast-path
2. Each journal gets its own isolated IndexedDB
3. No new awaits are added to the critical init() path
4. Search indexes are loaded lazily per-journal
5. The journal list stays in settings as a lightweight array

The 51ms baseline leaves room for ~50ms of additional overhead before hitting the 100ms threshold. Journal switching should target 30ms (save + DB swap + draft prep + focus).
