# Multi-Journal UX Design Recommendation

## Competitive Analysis Summary

### Day One (Best-in-Class for Journals)
- **Desktop**: Journals listed in a left sidebar column, color-coded with customizable icons. Clicking a journal filters the entry timeline. An "All Entries" view shows a combined timeline across journals.
- **Mobile**: Journals accessible via a hamburger menu / navigation drawer. New entries default to the last-used journal. A journal selector appears in the entry creation flow.
- **Key insight**: Journal switching and new-entry creation are separate actions. Users don't need to switch journals before writing; they can reassign entries after the fact.

### Bear (Tag-Based Organization)
- **No notebooks** — uses nested tags (e.g., `#work/project-a`) as the organizational model.
- **Sidebar** shows tags as a tree with disclosure triangles. Pinned tags float to top.
- **Key insight**: Tags allow a note to exist in multiple "journals" simultaneously. Simpler than folder-based separation.

### Obsidian (Vault-Based Separation)
- **Vaults are fully isolated** — separate directories, settings, plugins, and search indexes.
- **Switching is heavy**: requires 3 clicks on mobile, effectively reloads the app.
- **Key insight**: Full isolation is powerful but creates friction. Users request 1-click vault switching. The vault model maps directly to Lifespeed's directory-based approach.

### Notion (Workspace Switcher)
- **Workspace switcher** at top of sidebar — click current workspace name to get a dropdown of all workspaces.
- **Search is scoped** to current workspace by default with an option to search across all.
- **Key insight**: Placing the switcher at the very top of the sidebar is a well-established pattern. 70% of users rely on sidebars for quick navigation.

### Joplin (Notebook Sidebar)
- **Nested notebooks** in a collapsible tree sidebar.
- **Known issues**: Switching via sidebar is slow; mobile navigation to sub-notebooks requires extra taps.
- **Key insight**: Avoid deep nesting. Flat or single-level journal lists minimize tap/click count.

### Google Keep (Labels as Filters)
- **Labels** in a side drawer act as filters — clicking one shows notes with that label.
- **Flat hierarchy only** — no nesting, no sub-labels.
- **Key insight**: Simplicity works for small numbers of categories. Breaks down beyond ~10 labels.

### Standard Notes (Tags as Folders)
- **Tags doubled as folders** — flat list in sidebar, with drag-and-drop nesting.
- **Users requested workspaces** to fully separate work/personal notes.
- **Key insight**: Tags are not a substitute for true journal separation when users want independent collections.

### Simplenote (Instant-Write Pattern)
- **Auto-focus on launch**: app opens with cursor in a new note, keyboard visible.
- **Dedicated "collapse keyboard" button** for switching to browse mode.
- **Key insight**: The best pattern for "instant writing" apps. Lifespeed already follows this.

---

## Design Recommendation for Lifespeed

### Core Principles

1. **Zero-friction writing**: Opening the app always lands on a new entry in the active journal, cursor focused, keyboard open. Journal switching must NEVER interrupt this.
2. **Journal = Directory**: Each journal is a filesystem directory. This is the natural model for Lifespeed and maps to how Obsidian vaults work.
3. **Minimal UI addition**: The journal switcher should add at most one new visible element to the existing layout.
4. **Performance**: Switching journals should feel instant. Pre-load the journal list at startup; lazy-load entries only when switching.

---

### Desktop Layout

#### Journal Switcher: Dropdown in Sidebar Header

```
+------------------------------------------+---------------------------+
| [=] New Entry                    [Q] [+] [*] |                           |
+------------------------------------------+                           |
| Sidebar                         |        |      Editor Area          |
| +------------------------------+|        |                           |
| | [*] Personal Journal    [v]  ||        |  Start writing...         |
| +------------------------------+|        |                           |
| | Entries      | Sort: [Newest]||        |                           |
| |------------------------------||        |                           |
| | > Today                      ||        |                           |
| |   Morning thoughts           ||        |                           |
| |   Meeting notes              ||        |                           |
| | > Yesterday                  ||        |                           |
| |   Evening reflection         ||        |                           |
| +------------------------------+|        |                           |
+----------------------------------+--------+---------------------------+
```

**Placement**: Replace the current static "Entries" heading in the sidebar header with a clickable journal name + dropdown chevron.

**Interaction**:
- Click the journal name or chevron to open a dropdown listing all configured journals.
- Each journal shows: name (derived from directory basename or user-set label), entry count, and a small color dot.
- The dropdown includes a divider and "Manage Journals..." link that opens the Settings modal to the Journals section.
- Keyboard shortcut: `Ctrl+J` opens the journal switcher dropdown directly.
- `Ctrl+Shift+J` cycles to the next journal without opening dropdown.

**Dropdown wireframe**:
```
+---------------------------+
| * Personal Journal   (42) |  <-- active, shown with accent color
|   Work Notes         (18) |
|   Travel Log          (7) |
|   Ideas & Research   (23) |
|---------------------------|
|   + Add Journal...        |
|   Manage Journals...      |
+---------------------------+
```

**Why dropdown, not a sidebar column**:
- Day One users noted that a dedicated journal sidebar column adds clutter when a dropdown handles switching fine.
- Lifespeed's sidebar is already 280px — adding a second column would crowd the editor on smaller screens.
- A dropdown is a one-click action (click name > click journal) vs. always-visible but space-consuming.
- For users with 2-5 journals (the common case), a dropdown is faster than scanning a persistent list.

#### "All Journals" View
- First item in the dropdown: "All Journals" — shows entries from all journals in a combined timeline.
- Entries in "All Journals" view display a small colored dot or journal name badge to indicate origin.
- Search in "All Journals" mode searches across all indexes.

---

### Mobile Layout

#### Journal Switcher: Top of Sidebar Drawer

On mobile, the sidebar is a slide-out drawer (already implemented). The journal switcher goes at the very top of this drawer, above the entries list.

```
+---------------------------+
| [*] Personal Journal [v]  |   <-- tappable journal switcher
|---------------------------|
| Entries       [Sort: New] |
|---------------------------|
| > Today                   |
|   Morning thoughts        |
|   Meeting notes           |
| > Yesterday               |
|   Evening reflection      |
+---------------------------+
```

**Interaction**:
- Tap the journal name to expand an inline list of journals (pushes entries list down, not a modal/overlay).
- Selecting a journal collapses the list, reloads entries, and closes the sidebar.
- The "new entry" flow (FAB or `+` button) always creates in the **active** journal — no extra step.

**Critical mobile constraint**:
- Opening the app MUST still land on the editor with keyboard open in the active journal.
- Switching journals from the sidebar is an explicit, intentional action — it should never happen accidentally.
- After switching, the app creates a new draft in the new journal and focuses the editor.

#### Mobile Journal Switcher Wireframe (expanded)
```
+---------------------------+
| Select Journal:           |
|                           |
|  (*) Personal Journal     |  <-- radio-button style
|  ( ) Work Notes           |
|  ( ) Travel Log           |
|                           |
|  [Manage Journals]        |
|---------------------------|
| Entries       [Sort: New] |
| ...                       |
+---------------------------+
```

---

### Settings UI: Managing Journal Locations

Add a new "Journals" section to the existing Settings modal, placed above the current "Storage" section (which becomes redundant for single-directory config).

#### Desktop Settings Wireframe
```
+-----------------------------------------------+
|  Settings                              [X]     |
|------------------------------------------------|
|  JOURNALS                                      |
|                                                |
|  Active journals:                              |
|  +------------------------------------------+ |
|  | [*] Personal Journal                     | |
|  |     ~/Documents/journal/                  | |
|  |     42 entries | [Rename] [Remove]        | |
|  +------------------------------------------+ |
|  | [ ] Work Notes                            | |
|  |     ~/Documents/work-notes/               | |
|  |     18 entries | [Rename] [Remove]        | |
|  +------------------------------------------+ |
|  | [ ] Travel Log                            | |
|  |     ~/Dropbox/travel-journal/             | |
|  |     7 entries  | [Rename] [Remove]        | |
|  +------------------------------------------+ |
|                                                |
|  [+ Add Journal Directory...]                  |
|                                                |
|  Default journal: [Personal Journal  v]        |
|                                                |
|------------------------------------------------|
|  APPEARANCE                                    |
|  Theme: [Dark v]    Font Size: [Medium v]      |
|------------------------------------------------|
```

#### Journal Configuration Fields
- **Name/Label**: User-editable display name (defaults to directory basename).
- **Path**: Read-only display of filesystem path + "Choose..." button.
- **Entry count**: Shown inline for quick reference.
- **Actions**: Rename (edits display name only), Remove (removes from config, does NOT delete files), Reorder (drag handles or up/down arrows).
- **Default journal**: Dropdown to select which journal opens on app launch and receives new entries by default.

#### "Add Journal" Flow
1. User clicks "Add Journal Directory..."
2. Native directory picker opens (Tauri `dialog.open`, Capacitor filesystem API).
3. Selected directory is scanned for existing `.md` files.
4. If entries found: "Found 23 entries in this directory. Add as journal?"
5. If empty: "This directory is empty. A new journal will be created here."
6. Journal is added with basename as default name, user can rename immediately.
7. Search index is built for the new journal in the background.

#### "Remove Journal" Flow
1. Confirmation prompt: "Remove 'Work Notes' from Lifespeed? Your files will not be deleted."
2. On confirm: remove from journals config, delete associated search index, update UI.
3. If removing the active journal, switch to the first remaining journal.

---

### Search Scope

#### Per-Journal Search (Default)
- The Finder (`Ctrl+K`) searches within the **active journal** by default.
- The Finder header shows the active journal name to indicate scope.
- Results only show entries from the current journal.

#### Global Search (Opt-In)
- A toggle or scope indicator in the Finder header allows switching to "All Journals" search.
- Keyboard shortcut: `Ctrl+Shift+K` opens Finder in "All Journals" mode.
- In global mode, each result shows a journal name badge for disambiguation.

#### Finder Wireframe with Scope
```
+--------------------------------------------------+
| > [search query here]                        [X] |
| Scope: [Personal Journal v] | [All Journals]     |
|--------------------------------------------------|
| Results:                      | Preview:          |
|   Morning thoughts            |                   |
|   [Personal] Feb 10           | Content preview   |
|                               | appears here...   |
|   Meeting notes               |                   |
|   [Personal] Feb 9            |                   |
|--------------------------------------------------|
| [Up/Down] navigate  [Enter] open  [Esc] cancel   |
+--------------------------------------------------+
```

---

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+J` | Open journal switcher dropdown |
| `Ctrl+Shift+J` | Cycle to next journal |
| `Ctrl+K` | Open Finder (current journal scope) |
| `Ctrl+Shift+K` | Open Finder (all journals scope) |
| `Ctrl+N` | New entry in active journal |
| `Ctrl+,` | Open Settings |

On macOS, `Ctrl` maps to `Cmd` as is standard.

---

### Data Model

Each journal is stored as a config entry:

```json
{
  "journals": [
    {
      "id": "personal",
      "name": "Personal Journal",
      "path": "/home/user/Documents/journal/",
      "color": "#B08D57",
      "isDefault": true
    },
    {
      "id": "work",
      "name": "Work Notes",
      "path": "/home/user/Documents/work-notes/",
      "color": "#5B8DEF",
      "isDefault": false
    }
  ],
  "activeJournalId": "personal"
}
```

- **Backward compatibility**: If `journals` array is absent, treat the existing `entriesDirectory` as a single journal with id `"default"`.
- **Independent search indexes**: Each journal gets its own search index file: `search-index-{id}.json`.
- **Independent metadata caches**: Each journal gets its own metadata cache: `metadata-cache-{id}.json`.

---

### Performance Considerations

1. **Startup**: Only load entries for the active journal. Journal list (names, paths, entry counts) is cached in settings and loads instantly.
2. **Switching**: When user switches journals, the entry list and search index swap. The editor creates a new draft in the target journal. This should take <100ms for cached journals.
3. **Background indexing**: When a new journal is added, its search index builds in the background (existing pattern with indexing overlay for large journals).
4. **Memory**: Only one journal's entries are in memory at a time. The "All Journals" view loads entries on-demand with pagination if total count exceeds ~500.
5. **No eager loading**: Don't pre-load all journals' entries at startup. Only the active journal's entries load; others load on switch.

---

### Migration Path

For existing users upgrading:
1. The current `entriesDirectory` setting becomes the first (and only) journal in the `journals` array.
2. It's automatically named from the directory basename (e.g., "journal").
3. All existing search indexes and caches continue to work as-is.
4. The UI looks identical to before — the sidebar header just shows the journal name instead of "Entries".
5. No action required from the user. Multi-journal becomes available when they add a second journal through Settings.

---

### What NOT to Do

- **Don't add a permanent sidebar column for journals**: It wastes space for the 80% of users who have 1-3 journals.
- **Don't require journal selection before writing**: The app must open to the editor, ready to type, always.
- **Don't use tabs**: Tabs work for 2-3 items but become unwieldy with more. The dropdown scales better.
- **Don't nest journals**: Keep it flat. Each journal = one directory. No sub-journals.
- **Don't auto-discover directories**: Only add journals explicitly through the settings UI. No magic scanning.
- **Don't show journal switching UI on mobile home screen**: It's in the sidebar drawer, accessed only when needed.

---

## Summary of Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Switcher type | Dropdown in sidebar header | Minimal footprint, scales to 10+ journals, one-click access |
| Mobile placement | Top of sidebar drawer | Doesn't interfere with instant-write flow |
| Search default | Per-journal | Matches user mental model, faster results |
| Global search | Opt-in via toggle/shortcut | Available when needed, not default |
| Journal config | Settings modal section | Consistent with existing settings pattern |
| Data isolation | Per-journal indexes + caches | Independent operation, clean separation |
| Default behavior | Last-used journal persists | Reduces switching frequency |
| "All Journals" | Combined view option | Cross-cutting visibility when needed |
