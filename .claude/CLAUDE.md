## Project
Lifespeed -- Blazing-fast mobile-first journaling app, offline-first with markdown and fuzzy search.

## Stack
- Vanilla JS, esbuild (ordered file concatenation), Tauri 2 + Capacitor 6
- Fuse.js (fuzzy search), marked (markdown), js-yaml (frontmatter)

## Structure
- renderer/js/ -- 15 files in dependency order (see esbuild.config.mjs)
- renderer/js/journal.js -- JournalManager: multi-journal switching, add/remove/rename
- renderer/dist/ -- bundle output (app.bundle.js)
- src-tauri/ -- Rust backend (commands, services)
- android/ -- Capacitor Android project

## Commands
- Dev bundle: `npm run bundle` / Prod: `npm run bundle:prod`
- Tauri dev: `npm run dev`
- Build Linux: `npm run build:linux` (targets: deb, appimage, rpm)
- Build Windows: `npm run build:windows` -- on win11-build VM
- Build macOS: `npm run build:mac`
- Build all + copy releases: `npm run build:release`
- Android APK: `npm run build:android` / Debug: `npm run build:android:debug`
- Open Android Studio: `npm run cap:open:android` (requires CAPACITOR_ANDROID_STUDIO_PATH)
- Arch pkg: `../_shared/builders/arch/build.sh lifespeed` (Podman) or via arch-build VM

## Verification
After changes:
1. `npm run bundle` -- must complete without errors

## Conventions
- Performance is the top priority -- launch-to-typing must be near-instant
- File load order defined in esbuild.config.mjs jsFiles array; new files need correct position
- Entries are markdown with YAML frontmatter (parsed by frontmatter.js)
- Fuse.js powers search.js; index rebuilds on entry changes
- Multi-journal support: journals managed by JournalManager (journal.js), each with independent search index and metadata cache
- Settings model: `{ activeJournal, journals: [{id, name, path}] }` -- single-journal installs auto-migrate
- Platform detection (platform.js) gates Tauri vs Capacitor vs Web behavior
- Android builds use Android Studio at /mnt/data/android-studio/ with SDKs at /mnt/data/android-sdks/
- Releases output to ../_shared/releases/lifespeed/
- Arch/AUR packages built via Podman (see _shared/builders/arch/) or arch-build VM (builder:builder)
- Windows builds run on win11-build VM (user: builder, pass: builder) -- project shared via Samba on Z:\

## Don't
- Don't add files to renderer/js/ without updating jsFiles in esbuild.config.mjs
- Don't introduce blocking operations at startup -- performance is the core value proposition
- Don't use TypeScript or frameworks -- this is vanilla JS with global scope
