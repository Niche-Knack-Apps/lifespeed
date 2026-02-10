# Lifespeed

Blazing-fast, mobile-first journaling app. Offline-first with markdown and fuzzy search. Launch to typing in milliseconds.

## Features

- **Instant launch** -- open the app and start typing immediately
- **Markdown entries** with YAML frontmatter for tags and metadata
- **Fuzzy search** powered by Fuse.js -- find anything fast
- **Multi-journal** -- manage multiple journal locations and switch between them
- **Offline-first** -- all data stays on your device
- **Cross-platform** -- desktop (Tauri 2) and mobile (Capacitor 6)
- **Themes** -- light and dark modes

## Multi-Journal Support

Lifespeed supports multiple independent journal directories. Each journal has its own entries, search index, and metadata cache.

### Managing journals

Open **Settings** and go to the **Journals** section to:
- Add a new journal (give it a name and choose a directory)
- Rename an existing journal
- Remove a journal (does not delete files on disk)

### Switching journals

- **Dropdown** in the sidebar header (desktop) or top of sidebar drawer (mobile)
- **Ctrl+J** -- open the journal switcher
- **Ctrl+Shift+J** -- cycle to the next journal

Search results and the sidebar entry list are scoped to the active journal.

### Settings data model

Journal configuration is stored in `settings.json`:

```json
{
  "activeJournal": "default",
  "journals": [
    { "id": "default", "name": "Journal", "path": "/path/to/journal" },
    { "id": "work", "name": "Work", "path": "/path/to/work-journal" }
  ]
}
```

Existing single-journal installations auto-migrate on first launch -- no manual setup required.

## Stack

- Vanilla JS with esbuild (ordered file concatenation)
- [Tauri 2](https://tauri.app/) (desktop) + [Capacitor 6](https://capacitorjs.com/) (mobile)
- [Fuse.js](https://www.fusejs.io/) (fuzzy search), [marked](https://marked.js.org/) (markdown), [js-yaml](https://github.com/nodeca/js-yaml) (frontmatter)

## Development

```bash
# Install dependencies
npm install

# Dev bundle (no minification)
npm run bundle

# Start Tauri dev mode
npm run dev

# Production bundle
npm run bundle:prod
```

## Building

```bash
# Linux (deb, appimage, rpm)
npm run build:linux

# Windows (on win11-build VM)
npm run build:windows

# macOS
npm run build:mac

# Android APK
npm run build:android

# All platforms + copy to releases
npm run build:release
```

## License

Apache-2.0
