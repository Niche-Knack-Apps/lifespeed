# Lifespeed Regression Test Checklist

**Baseline captured:** 2026-02-10 (branch: `multi-journal`)
**Last verified commit:** `1b0e2f8` (Add batch metadata loading for Tauri and fix metadata cache migration)

---

## Build Verification

| # | Test | Expected | Status | Files |
|---|------|----------|--------|-------|
| B1 | `npm run bundle` completes | Bundle at `renderer/dist/app.bundle.js` ~174KB, no errors | PASS | `esbuild.config.mjs` |
| B2 | `npm run bundle:prod` completes | Minified bundle, no errors | - | `esbuild.config.mjs` |
| B3 | `npm run dev` (Tauri) | App launches, "Ready to type in <200ms" in logs | PASS | `src-tauri/`, `renderer/index.html` |
| B4 | `cargo check --manifest-path src-tauri/Cargo.toml` | Compiles without errors | PASS | `src-tauri/src/lib.rs` |
| B5 | All 14 JS files in `jsFiles` array exist | No "Warning: not found" during bundle | PASS | `esbuild.config.mjs` |

---

## 1. Platform Detection

| # | Test | Expected | Files |
|---|------|----------|-------|
| P1 | Tauri detected via `window.__TAURI_INTERNALS__` | `platform.platform === 'tauri'` | `renderer/js/platform.js:14-16` |
| P2 | Tauri detected via `window.__TAURI_INTERNALS__` | `platform.platform === 'tauri'` | `renderer/js/platform.js:15-16` |
| P3 | Capacitor detected via `window.Capacitor.isNativePlatform()` | `platform.platform === 'capacitor'` | `renderer/js/platform.js:21-23` |
| P4 | Web fallback when no native API | `platform.platform === 'web'` | `renderer/js/platform.js:24` |
| P5 | `platform.isMobile()` returns true on Capacitor or narrow viewport | Correct for < 768px width | `renderer/js/platform.js:45-47` |
| P6 | `platform.isNative()` returns true for Tauri/Capacitor | `true` for all native platforms | `renderer/js/platform.js:28` |

---

## 2. Entry CRUD Operations

### 2a. Create Entry

| # | Test | Expected | Files |
|---|------|----------|-------|
| C1 | App launch creates draft entry (memory only, no disk write) | `isDraft === true`, editor has frontmatter template, no file on disk | `renderer/js/app.js:2710-2746` (prepareDraftEntry) |
| C2 | Typing content triggers auto-save, draft materializes on disk | `isDraft` becomes `false`, file written to `{entriesDir}/{date}-{time}/index.md` | `renderer/js/app.js:887-917` (saveCurrentEntry) |
| C3 | Click "New Entry" button (or Ctrl+N) | Current entry saved/discarded, new draft prepared, editor focused | `renderer/js/app.js:2748-2759` (createNewEntry) |
| C4 | FAB button creates new entry | Same as C3 | `renderer/js/app.js:1830` |
| C5 | Entry dirname format: `YYYY-MM-DD-slug` | Slug from title or time fallback (e.g., `2026-02-10-hello-world` or `2026-02-10-13-43-51`) | `renderer/js/platform.js:648-667` (Tauri), `platform.js:477-501` (Web) |
| C6 | Frontmatter generated with title, date, lastmod, tags, draft | All fields present in YAML block | `renderer/js/frontmatter.js:193-202` |

### 2b. Read Entry

| # | Test | Expected | Files |
|---|------|----------|-------|
| R1 | Click sidebar entry loads content | Editor populated with file content, metadata fields updated | `renderer/js/app.js:2761-2831` (loadEntry) |
| R2 | Frontmatter parsed and displayed in metadata fields | Title, tags, date fields populated correctly | `renderer/js/app.js:2833-2837` (displayMetadata) |
| R3 | Header title updates to entry title | `headerTitle.textContent` matches frontmatter title or dirname slug | `renderer/js/app.js:2796-2801` |
| R4 | Active entry highlighted in sidebar | `.entry-item.active` class applied to loaded entry | `renderer/js/app.js:2806-2808` |
| R5 | Scroll resets to top on entry load | Both editor and preview scrollTop set to 0 | `renderer/js/app.js:2817-2821` |
| R6 | Tauri: `read_file` command reads file content | Returns `{ success: true, content }` | `src-tauri/src/commands/file.rs:6-8` |
| R7 | Tauri: `read_file` command reads file content | Returns `{ success: true, content }` | `src-tauri/src/commands/file.rs` |

### 2c. Update/Save Entry

| # | Test | Expected | Files |
|---|------|----------|-------|
| U1 | Auto-save triggers after `autoSaveDelay` (500ms default) | Content saved to disk after typing pause | `renderer/js/app.js:877-885` (scheduleAutoSave) |
| U2 | Frontmatter updated with current title, tags, lastmod on save | `lastmod` timestamp refreshed, title/tags from UI fields | `renderer/js/app.js:929-933` |
| U3 | Ctrl+S triggers immediate save | Entry saved without delay | `renderer/js/app.js:3393-3395` |
| U4 | Word count updates in status bar on every input | `N words` displayed correctly | `renderer/js/app.js:1079-1098` |
| U5 | Metadata cache updated on save (fire-and-forget) | `metadataCache.saveEntry()` called with updated fields | `renderer/js/app.js:941-965` |
| U6 | Sidebar entry title/preview updates live during editing | `updateSidebarEntry()` reflects current title and excerpt | `renderer/js/app.js:1354-1398` |
| U7 | Auto-title: first content line becomes title if title field empty | `metaTitle.value` auto-set, `dataset.autoTitle` flag present | `renderer/js/app.js:734-762` |
| U8 | Entry rename on Tauri when title changes | Directory renamed from old slug to new slug | `renderer/js/app.js` (renameEntry) |
| U9 | Empty entry discarded on app background/exit | `saveOrDiscardCurrentEntry()`: if no body content, entry deleted | `renderer/js/app.js:241-254` |
| U10 | Tauri: `write_file` command creates parent dirs and writes | File saved, parent directories created | `src-tauri/src/commands/file.rs:10-16` |

### 2d. Delete Entry

| # | Test | Expected | Files |
|---|------|----------|-------|
| D1 | Delete button on sidebar entry shows confirmation modal | `asyncConfirm()` dialog with "Delete" button | `renderer/js/app.js:2624-2639` |
| D2 | Confirming delete removes entry from disk | Platform-specific delete: Tauri removes directory, Capacitor via SAF | `renderer/js/platform.js:199-223` |
| D3 | Deleted entry removed from sidebar list | `allEntries` filtered, `renderEntriesList()` called | `renderer/js/app.js:2674-2678` |
| D4 | Deleted entry removed from metadata cache | `metadataCache.deleteEntry(path)` called | `renderer/js/app.js:2682-2684` |
| D5 | If current entry deleted, editor cleared | `currentEntry = null`, editor/preview/metadata fields cleared | `renderer/js/app.js:2660-2670` |
| D6 | Ghost entry cleanup (file already gone) | Still cleans up sidebar/cache even if disk delete returns "No such file" | `renderer/js/app.js:2652-2657` |
| D7 | Finder cache cleared after delete | `finderEntries = []`, `fuse = null` | `renderer/js/app.js:2688-2689` |
| D8 | Toast notification shown after delete | "Entry deleted" toast displayed | `renderer/js/app.js:2692` |

---

## 3. Frontmatter Parsing

| # | Test | Expected | Files |
|---|------|----------|-------|
| F1 | Parse `---` delimited YAML frontmatter | Returns `{ data, body, raw }` | `renderer/js/frontmatter.js:12-37` |
| F2 | Parse key-value strings (quoted and unquoted) | Quotes stripped, values returned as strings | `renderer/js/frontmatter.js:96-115` |
| F3 | Parse bracket arrays `[tag1, tag2]` | Returns JS array of strings | `renderer/js/frontmatter.js:61-73` |
| F4 | Parse multi-line YAML list format | `- item` lines parsed into array | `renderer/js/frontmatter.js:76-84` |
| F5 | Parse booleans (`true`/`false`) | Returns JS boolean | `renderer/js/frontmatter.js:104-105` |
| F6 | Parse numbers (int and float) | Returns JS number | `renderer/js/frontmatter.js:108-109` |
| F7 | Parse `null`/`~`/empty as null | Returns `null` | `renderer/js/frontmatter.js:112` |
| F8 | `stringify()` generates valid YAML frontmatter | Output begins with `---\n` and ends with `---\n` | `renderer/js/frontmatter.js:123-148` |
| F9 | `updateInContent()` preserves body while updating fields | Body unchanged, frontmatter fields merged | `renderer/js/frontmatter.js:175-186` |
| F10 | `slugify()` generates URL-safe slugs | Lowercase, special chars replaced with hyphens, max 50 chars | `renderer/js/frontmatter.js:209-215` |
| F11 | `generateDirname()` creates `YYYY-MM-DD-slug` format | Date prefix with slug or time fallback | `renderer/js/frontmatter.js:223-227` |
| F12 | Content without frontmatter returns full body | `data` is empty object, `body` is full content | `renderer/js/frontmatter.js:19-21` |
| F13 | Rust frontmatter parser matches JS behavior | `parse_frontmatter()` in Rust returns same title/date/tags/excerpt | `src-tauri/src/commands/entry.rs:173-221` |

---

## 4. Search / Fuse.js Indexing

| # | Test | Expected | Files |
|---|------|----------|-------|
| S1 | Search index loads from platform storage on init | `search.init()` loads persisted index | `renderer/js/search.js:34-39` |
| S2 | Fuse.js initialized with correct key weights | title: 0.4, tags: 0.3, content: 0.2, date: 0.1 | `renderer/js/search.js:47-58` |
| S3 | `search.rebuildIndex()` reads all entries and rebuilds | Index updated with entries, tags counted, saved to platform | `renderer/js/search.js:67-102` |
| S4 | Stopwords stripped from indexed content | Common words filtered via `SEARCH_STOPWORDS` set | `renderer/js/search.js:6-28` |
| S5 | Finder opens with Ctrl+K or Ctrl+P | Finder overlay shown, input focused | `renderer/js/app.js:3382-3387` |
| S6 | Empty finder query shows all entries | All `finderEntries` displayed in list | `renderer/js/app.js:3048-3051` |
| S7 | Typing in finder performs fuzzy search | Fuse.js results or fallback substring match | `renderer/js/app.js:3044-3065` |
| S8 | Finder debounces input (150ms) | Search doesn't fire on every keystroke | `renderer/js/app.js:2863-2873` |
| S9 | Finder keyboard navigation: Up/Down/Enter/Escape | ArrowDown/Up selects, Enter loads, Escape closes | `renderer/js/app.js:3155-3178` |
| S10 | Finder preview shows entry content snippet | Selected entry's content displayed in preview pane | `renderer/js/app.js:3145-3153` |
| S11 | Finder uses cached sidebar entries (no extra native calls) | `this.allEntries` used as source, not fresh `platform.listEntries()` | `renderer/js/app.js:2887-2888` |
| S12 | Finder enriches entries missing metadata before display | `batchGetMetadata()` called for entries without title/excerpt | `renderer/js/app.js:2925-2948` |

---

## 5. Metadata Cache (IndexedDB)

| # | Test | Expected | Files |
|---|------|----------|-------|
| M1 | MetadataCache initializes IndexedDB `atsl-metadata` v2 | DB opens, `entries` and `meta` stores created | `renderer/js/metadata-cache.js:14-83` |
| M2 | `getAllEntries()` returns sorted by mtime descending | Newest entries first, handles both numeric and ISO string mtimes | `renderer/js/metadata-cache.js:89-111` |
| M3 | `saveEntry()` / `saveEntries()` persists to IndexedDB | Entries written via `put()` in readwrite transaction | `renderer/js/metadata-cache.js:135-169` |
| M4 | `deleteEntry()` / `deleteEntries()` removes from IndexedDB | Entries deleted from store | `renderer/js/metadata-cache.js:175-209` |
| M5 | `clearEntries()` wipes all cached entries | Store cleared | `renderer/js/metadata-cache.js:214-228` |
| M6 | Cache meta tracks `lastSync`, `entryCount`, `folderPath`, `version` | `getMeta()` returns meta object, `updateMeta()` merges updates | `renderer/js/metadata-cache.js:234-265` |
| M7 | `hasCacheForFolder()` checks if cache matches current folder | Normalized path comparison | `renderer/js/metadata-cache.js:285-294` |
| M8 | `compareWithFilesystem()` detects added/modified/deleted entries | Returns `{ added, modified, deleted }` arrays | `renderer/js/metadata-cache.js:350-388` |
| M9 | Cache migration v1->v2 drops and recreates stores | Clears stale entries without metadata | `renderer/js/metadata-cache.js:57-65` |
| M10 | App launch: fast path loads from cache (no animation) | If `hasCacheForFolder`, entries rendered instantly from cache | `renderer/js/app.js:1924-1954` |
| M11 | App launch: slow path builds initial index with progress UI | Shows indexing overlay, batches of 100, preview at 50 entries | `renderer/js/app.js:1995-2098` |
| M12 | Filesystem verification runs after cache load | Removes ghost entries, adds missing entries from disk | `renderer/js/app.js:2105-2223` |
| M13 | Backfill metadata for entries with junk titles | Regex `/^\d{2}( \d{2}){1,2}$/` detects timestamp-only slugs | `renderer/js/app.js:1938-1939`, `renderer/js/app.js:2229-2258` |
| M14 | Cache saved on app exit (`saveCurrentEntryToCache`) | Current entry persisted before unload | `renderer/js/app.js:162-200` |

---

## 6. Sidebar Population

| # | Test | Expected | Files |
|---|------|----------|-------|
| SB1 | Sidebar renders entries with title, preview, date | Each `.entry-item` has `.entry-title`, optional `.entry-preview`, `.entry-date` | `renderer/js/app.js:2468-2523` |
| SB2 | Title priority: frontmatter title > excerpt snippet > dirname slug | Correct fallback chain | `renderer/js/app.js:2474-2485` |
| SB3 | Preview only shown when frontmatter title exists | Avoids redundant preview when title IS the excerpt | `renderer/js/app.js:2488-2491` |
| SB4 | Date extracted from dirname `YYYY-MM-DD-*` | Shows date string in sidebar | `renderer/js/app.js:2494-2495` |
| SB5 | Entries grouped by date (Today/Yesterday/This Week/This Month/Earlier) | Group headers rendered for date-based sorts | `renderer/js/app.js:2425-2445`, `app.js:2581-2622` |
| SB6 | Sort options: date desc/asc, modified desc/asc, title asc/desc | `<select>` dropdown changes sort order | `renderer/js/app.js:1836-1844`, `app.js:1846-1871` |
| SB7 | Lazy loading: only first 50 entries rendered initially | Scroll listener loads more in batches of 50 | `renderer/js/app.js:2413`, `app.js:2529-2553` |
| SB8 | Sidebar toggle via hamburger menu button | `.open` class toggled on sidebar, backdrop visibility | `renderer/js/app.js:1890-1898` |
| SB9 | Mobile swipe right from left edge opens sidebar | Gesture detected, sidebar opened | `renderer/js/gestures.js:37-44` |
| SB10 | Mobile swipe left closes sidebar | Gesture detected, sidebar closed | `renderer/js/gestures.js:47-54` |
| SB11 | New entry appears in sidebar after first save | Draft materialization adds to `allEntries` and renders | `renderer/js/app.js:897-916` |
| SB12 | `ensureCurrentEntryInSidebar()` after entry list loads | Newly created entry added if missing | `renderer/js/app.js:96-127` |

---

## 7. Editor & Preview

| # | Test | Expected | Files |
|---|------|----------|-------|
| E1 | Default mode is `preview` (WYSIWYG contenteditable) | `this.currentMode === 'preview'`, preview visible | `renderer/js/app.js:16`, `app.js:469` |
| E2 | Source mode shows raw textarea | Editor visible, preview hidden | `renderer/js/app.js:1437-1448` |
| E3 | Preview mode renders markdown with markdown-it | HTML rendered in preview div, markdown-it with footnotes | `renderer/js/app.js:1603-1687` |
| E4 | Mode toggle preserves scroll position | ScrollSync captures/restores position on mode switch | `renderer/js/app.js:1401-1448`, `renderer/js/scroll-sync.js` |
| E5 | Toolbar buttons: bold, italic, strikethrough, code, link, checkbox | Each wraps/prefixes selection in source editor | `renderer/js/app.js:1106-1125` |
| E6 | Secondary toolbar: quote, heading, bullet, number, footnote, table, hr | Accessible via accordion toggle | `renderer/js/app.js:1119-1125` |
| E7 | Table insertion prompts for size | `asyncPrompt()` for "rows x cols", generates markdown table | `renderer/js/app.js:1292-1324` |
| E8 | Link insertion prompts for URL | `asyncPrompt()` for URL, wraps selection | `renderer/js/app.js:1277-1282` |
| E9 | Keyboard shortcuts: Ctrl+B (bold), Ctrl+I (italic), Ctrl+S (save), Ctrl+N (new), Ctrl+K/P (finder), Ctrl+M (metadata) | All shortcuts functional | `renderer/js/app.js:3377-3424` |
| E10 | Escape closes finder or settings modal | Modal/overlay hidden | `renderer/js/app.js:3417-3423` |
| E11 | Task list checkboxes interactive in preview | Click toggles checked state, syncs to source markdown | `renderer/js/app.js:1743-1787` |
| E12 | Preview to source sync (WYSIWYG editing) | `syncPreviewToSource()` converts HTML back to markdown | `renderer/js/app.js:1451-1465` |
| E13 | HTML to markdown conversion handles all elements | Headings, bold, italic, code, links, images, lists, blockquotes, tables | `renderer/js/app.js:1467-1601` |
| E14 | Context menu (right-click/long-press) | Insert image, file, bold, italic, heading, list options | `renderer/js/app.js:472-563` |
| E15 | Editor focuses on app launch | Cursor at end of content in current mode editor | `renderer/js/app.js:3452-3489` |

---

## 8. Scroll Sync

| # | Test | Expected | Files |
|---|------|----------|-------|
| SS1 | ScrollSyncController initializes with editor + preview | `this.scrollSync` set, event listeners attached | `renderer/js/scroll-sync.js:20-52`, `app.js:462-466` |
| SS2 | Source scroll syncs preview position | Anchor-based interpolation maps source line to preview offset | `renderer/js/scroll-sync.js:173-208` |
| SS3 | Preview scroll syncs source position | Reverse interpolation from preview to source | `renderer/js/scroll-sync.js:213-254` |
| SS4 | Scroll map built from `data-source-line` attributes | `buildScrollMap()` reads anchor elements | `renderer/js/scroll-sync.js:103-136` |
| SS5 | Position capture/restore across mode switches | `capturePosition()` saves line/fraction/ratio, `restorePosition()` applies | `renderer/js/scroll-sync.js:345-446` |
| SS6 | Scroll enforcement for 600ms prevents browser resets | RAF loop keeps applying scroll position | `renderer/js/scroll-sync.js:454-523` |
| SS7 | Images trigger scroll map rebuild | `watchImages()` listens for img load/error events | `renderer/js/scroll-sync.js:78-97` |
| SS8 | Line tracking via marked-line-numbers extension | `data-source-line` attributes on block elements in preview | `renderer/js/marked-line-numbers.js` |

---

## 9. Image & File Attachments

| # | Test | Expected | Files |
|---|------|----------|-------|
| I1 | Paste image in editor (clipboard) | Image saved to `{entry}/images/{timestamp}.png`, markdown inserted | `renderer/js/app.js:764-776` (handlePaste), `platform.js:227-240` |
| I2 | Drop image on editor | Image file processed and saved | `renderer/js/app.js:778-788` (handleDrop) |
| I3 | Pick image via context menu / file input | Native picker on Capacitor, HTML input on Web | `renderer/js/app.js:603-671` |
| I4 | Relative image paths resolved in preview | `fixImagePaths()` uses `platform.readImage()` for Tauri asset:// | `renderer/js/app.js:1689-1717` |
| I5 | Image `data-originalSrc` preserved for roundtrip | When syncing preview->source, relative path restored | `renderer/js/app.js:1525-1534` |
| I6 | File attachment (non-image) | File copied to `{entry}/files/{name}`, markdown link inserted | `renderer/js/app.js:708-732`, `platform.js:259-271` |
| I7 | Tauri: `write_file_base64` decodes and writes binary | Base64 decoded, parent dirs created | `src-tauri/src/commands/entry.rs:88-105` |
| I8 | Tauri: `copy_file` copies file with parent dir creation | Source copied to destination | `src-tauri/src/commands/entry.rs:78-86` |

---

## 10. Settings

| # | Test | Expected | Files |
|---|------|----------|-------|
| ST1 | Settings loaded on app init | `loadSettings()` via platform-specific storage | `renderer/js/app.js:369-389` |
| ST2 | Default settings: theme=dark/system, fontSize=medium, autoSave=true, delay=500ms | Defaults returned when no saved settings | `renderer/js/app.js:395-404`, `platform.js:607-616` |
| ST3 | Settings modal opens via gear button | Modal shown, debug log stats updated | `renderer/js/app.js:3335-3338` |
| ST4 | Theme change applies immediately | `data-theme` attribute set on `<html>`, saved to localStorage and settings | `renderer/js/app.js:406-409` |
| ST5 | Font size change applies immediately | `data-font-size` attribute set on `<html>` | `renderer/js/app.js:412-414` |
| ST6 | Theme cached in localStorage for instant apply | `theme-cache.js` reads on page load before async settings | `renderer/js/theme-cache.js:1-11` |
| ST7 | Directory chooser changes entries directory | Picker shown, `setEntriesDir()` called, entries reloaded | `renderer/js/app.js:3196-3217` |
| ST8 | Rebuild index button triggers full re-index | Cache cleared, `buildInitialIndex()` called with progress UI | `renderer/js/app.js:3361-3373` |
| ST9 | Tauri settings: merged save preserves all keys | `_saveSettingsTauri` merges with existing to preserve entriesDirectory | `renderer/js/platform.js:291-309` |
| ST10 | Tauri: settings via `_loadSettingsTauri()` / `_saveSettingsTauri()` | invoke read_file/write_file | `renderer/js/platform.js` |
| ST11 | Web/Capacitor: settings in localStorage `atsl-settings` | JSON serialized to localStorage | `renderer/js/platform.js:571-605` |

---

## 11. Theme Support

| # | Test | Expected | Files |
|---|------|----------|-------|
| TH1 | Dark theme | `[data-theme="dark"]` CSS variables applied | `renderer/css/main.css:41-53` |
| TH2 | Light theme | `[data-theme="light"]` CSS variables applied | `renderer/css/main.css:55-67` |
| TH3 | Sepia theme | `[data-theme="sepia"]` CSS variables applied | `renderer/css/main.css:69-85` |
| TH4 | System theme (auto dark/light) | `prefers-color-scheme` media query | `renderer/css/main.css:87-102` |
| TH5 | Theme persists across restarts | `localStorage.getItem('lifespeed-theme')` applied by `theme-cache.js` | `renderer/js/theme-cache.js` |
| TH6 | No flash on Tauri launch (theme-cache.js) | Theme applied synchronously before async IPC completes | `renderer/js/theme-cache.js:6-11` |

---

## 12. File Watcher (not yet implemented)

| # | Test | Expected | Files |
|---|------|----------|-------|
| FW1 | File watcher is a no-op (not yet implemented) | `platform.setupFileWatcher()` does nothing | `renderer/js/platform.js` |
| FW2 | File added/changed/deleted callbacks registered | Console logs show file events | `renderer/js/app.js:3429-3442` |
| FW3 | Tauri: file watcher not implemented (no-op) | `setupFileWatcher()` returns immediately | `renderer/js/platform.js:446` |
| FW4 | File watcher events don't trigger reload during use | Cache syncs on app close, not on every file event (speed priority) | `renderer/js/app.js:3431-3442` |

---

## 13. Tauri-Specific Commands

| # | Test | Expected | Files |
|---|------|----------|-------|
| T1 | `get_default_entries_dir` returns `{app_data}/journal/` | Directory created if missing | `src-tauri/src/commands/entry.rs:30-36` |
| T2 | `list_directory` returns `Vec<DirEntry>` with name, is_dir, mtime | Handles missing directory by creating it | `src-tauri/src/commands/entry.rs:39-66` |
| T3 | `list_entries_with_metadata` returns full metadata in single call | Returns title, date, tags, excerpt from YAML frontmatter | `src-tauri/src/commands/entry.rs:111-171` |
| T4 | `delete_directory` removes entry folder recursively | `fs::remove_dir_all()` | `src-tauri/src/commands/entry.rs:69-71` |
| T5 | `rename_path` renames file/directory | `fs::rename()` | `src-tauri/src/commands/entry.rs:74-76` |
| T6 | `read_file` / `write_file` / `file_exists` | Basic file I/O commands | `src-tauri/src/commands/file.rs` |
| T7 | `write_file_base64` decodes base64 data URLs | Strips `data:...;base64,` prefix, decodes, writes binary | `src-tauri/src/commands/entry.rs:88-105` |
| T8 | `get_user_data_path` returns app data directory | Path service singleton, initialized in `setup()` | `src-tauri/src/commands/settings.rs`, `src-tauri/src/services/path_service.rs` |
| T9 | `choose_directory` opens native folder picker | Tauri dialog plugin | `src-tauri/src/commands/dialog.rs:65-78` |
| T10 | `open_file_dialog` / `save_file_dialog` | File picker with filters | `src-tauri/src/commands/dialog.rs:12-63` |
| T11 | Rust frontmatter parser: strips quotes, handles empty tags | `strip_quotes()`, empty tag filtering | `src-tauri/src/commands/entry.rs:223-229` |
| T12 | Tauri plugins registered: dialog, fs, shell | `lib.rs` setup with plugins and command handlers | `src-tauri/src/lib.rs:8-11` |
| T13 | All Tauri commands registered in invoke handler | 13 commands in `generate_handler![]` | `src-tauri/src/lib.rs:12-27` |

---

## 14. Lifecycle & State Management

| # | Test | Expected | Files |
|---|------|----------|-------|
| L1 | `visibilitychange` triggers save (not cache sync) | Only `saveOrDiscardCurrentEntry()` called, no expensive sync | `renderer/js/app.js:132-137` |
| L2 | `beforeunload` saves entry and cache | Both `saveOrDiscardCurrentEntry()` and `saveCurrentEntryToCache()` | `renderer/js/app.js:140-144` |
| L3 | Capacitor `appStateChange` handles background | Save entry and cache on `!state.isActive` | `renderer/js/app.js:147-155` |
| L4 | Cache sync guard prevents sync during typing | `lastInputTime` check: skip if < 2 seconds since last input | `renderer/js/app.js:208-210` |
| L5 | Concurrent sync prevention | `isSyncingCache` flag prevents parallel syncs | `renderer/js/app.js:215-217` |
| L6 | Draft entry not saved/deleted on background | `isDraft` check in `saveOrDiscardCurrentEntry()` | `renderer/js/app.js:245` |

---

## 15. Debug Logger

| # | Test | Expected | Files |
|---|------|----------|-------|
| DL1 | DebugLogger auto-initializes on load | `window.debugLogger` available, `init()` called | `renderer/js/debug-logger.js:568-572` |
| DL2 | Console methods intercepted | `console.log/warn/error/info/debug` captured to logger | `renderer/js/debug-logger.js:408-424` |
| DL3 | Logs stored in IndexedDB (all platforms) | Platform-specific persistence | `renderer/js/debug-logger.js:429-445` |
| DL4 | Log rotation at 500 entries | Oldest entries deleted when exceeding `maxEntries` | `renderer/js/debug-logger.js:450-480` |
| DL5 | Download logs exports as .log file | Platform-specific: Tauri save dialog, Capacitor share, Web blob | `renderer/js/debug-logger.js:190-249` |
| DL6 | Clear logs wipes storage | IndexedDB store cleared | `renderer/js/debug-logger.js:305-319` |
| DL7 | Settings modal shows log stats | Entry count, error/warn counts, size | `renderer/js/app.js:3262-3298` |

---

## 16. About / V4V / Branding

| # | Test | Expected | Files |
|---|------|----------|-------|
| A1 | Niche-Knack config loaded | `NICHE_KNACK_CONFIG` global with brand and V4V options | `renderer/js/niche-knack-config.js` |
| A2 | About section populated from config | Donation options, copy buttons initialized | `renderer/js/about-section.js:13-62` |
| A3 | Copy-to-clipboard for payment addresses | Clipboard API with "Copied!" feedback | `renderer/js/about-section.js:67-96` |
| A4 | App version info accessible | `about.version`, `about.name`, `about.description` | `renderer/js/about.js` |

---

## 17. Platform-Specific Batch Metadata

| # | Test | Expected | Files |
|---|------|----------|-------|
| BM1 | Tauri `batchGetMetadata` uses `list_entries_with_metadata` | Single Rust call returns all metadata, filtered to requested paths | `renderer/js/platform.js:1119-1137` |
| BM2 | Capacitor `batchGetMetadata` uses native `FolderPicker.batchGetMetadata` | Native SAF batch read | `renderer/js/platform.js:1139-1167` |
| BM3 | Web fallback reads entries individually | `loadEntry()` + `frontmatter.parse()` per entry | `renderer/js/platform.js:1170-1210` |
| BM4 | Excerpt stripped of markdown for clean sidebar display | Headings, bold, italic, code, images, links, blockquotes, lists stripped | `renderer/js/platform.js:1179-1193` |
| BM5 | `listEntriesFast()` for cache comparison | Tauri delegates to `listEntries()`, Capacitor uses fast native call | `renderer/js/platform.js:1077-1112` |

---

## 18. JS File Load Order (esbuild.config.mjs)

The 14 files MUST load in this exact order (dependency chain):

```
1. platform.js          - PlatformService (no deps)
2. frontmatter.js       - frontmatter parser (no deps)
3. entries.js            - Entry utilities (placeholder)
4. search.js             - Search index + Fuse.js (depends on: platform, frontmatter)
5. tags.js               - Tag management (depends on: platform)
6. finder.js             - Finder placeholder
7. images.js             - Images placeholder
8. files.js              - File attachments (depends on: platform)
9. editor.js             - Editor placeholder
10. gestures.js          - Touch gestures (depends on: platform)
11. settings.js          - Settings placeholder
12. about.js             - About/V4V info
13. scroll-sync.js       - ScrollSyncController (no deps, exports to window)
14. app.js               - Main App class (depends on ALL above)
```

**Additional non-bundled files** (loaded separately in index.html or as modules):
- `metadata-cache.js` - MetadataCache IndexedDB wrapper
- `debug-logger.js` - DebugLogger with console intercept
- `theme-cache.js` - Instant theme restore from localStorage
- `niche-knack-config.js` - V4V configuration
- `about-section.js` - About section DOM logic
- `marked-line-numbers.js` - marked.js line tracking extension

---

## Quick Manual Test Procedure

Run after every change:

```bash
# 1. Build
npm run bundle

# 2. Verify Tauri dev launches
npm run dev
# Expected: "Ready to type in <200ms", no console errors

# 3. Verify Tauri compiles
cargo check --manifest-path src-tauri/Cargo.toml

# 4. In-app checks (manual):
#    a. Type text -> auto-saves (word count updates)
#    b. Open sidebar -> entries listed with titles/dates
#    c. Ctrl+K -> finder opens with fuzzy search
#    d. Switch source/preview modes -> scroll position preserved
#    e. Check settings modal opens -> theme change works
#    f. Create new entry -> appears in sidebar
#    g. Delete entry -> removed from sidebar and disk
```

---

## Critical Invariants (MUST NEVER BREAK)

1. **Launch-to-typing < 200ms** - No blocking operations at startup
2. **Draft entry pattern** - New entry is memory-only until first content typed
3. **Cache is speed layer, filesystem is truth** - `verifyFilesystemEntries()` always reconciles
4. **Frontmatter roundtrip** - parse -> modify -> stringify must not corrupt content
5. **Platform abstraction** - Every operation in PlatformService has Tauri + Capacitor + Web paths
6. **Auto-save debounce** - 500ms delay, immediate on Ctrl+S or app background
7. **Empty entry cleanup** - Entries with no body content are deleted on switch/exit
8. **Metadata cache migration** - v1->v2 drops stale cache, junk titles detected and backfilled
9. **Sidebar entry count matches filesystem** - Ghost entries removed, missing entries added
10. **Theme flash prevention** - `theme-cache.js` applies theme synchronously before any async loads
