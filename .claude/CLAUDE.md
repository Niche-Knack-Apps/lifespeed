## Project
Lifespeed -- Blazing-fast mobile-first journaling app, offline-first with markdown and fuzzy search.

## Stack
- Vanilla JS, esbuild (ordered file concatenation), Electron 28 + Capacitor 6 + Tauri 2
- Fuse.js (fuzzy search), marked (markdown), js-yaml (frontmatter)

## Structure
- renderer/js/ -- 14 files in dependency order (see esbuild.config.mjs)
- renderer/dist/ -- bundle output (app.bundle.js)
- android/ -- Capacitor Android project

## Commands
- Dev bundle: `npm run bundle` / Prod: `npm run bundle:prod`
- Electron dev: `npm start`
- Tauri dev: `npm run tauri:dev`
- Build Linux: `npm run build:linux` (Electron) / `npm run tauri:build:linux` (Tauri, targets: deb, appimage, rpm)
- Build Windows: `npm run build:win` (Electron) / `npm run tauri:build:windows` (Tauri) -- on win11-build VM
- Build macOS: `npm run build:mac` (Electron) / `npm run tauri:build:mac` (Tauri)
- Build all desktop: `npm run build:all-desktop` / All + Android: `npm run build:all`
- Android APK: `npm run build:android` / Debug: `npm run build:android:debug`
- Open Android Studio: `npm run cap:open:android` (requires CAPACITOR_ANDROID_STUDIO_PATH)
- Release: `npm run tauri:build:release` -- builds + copies to _shared/releases/
- Arch pkg: `../_shared/builders/arch/build.sh lifespeed` (Podman) or via arch-build VM

## Verification
After changes:
1. `npm run bundle` -- must complete without errors
2. `timeout 8 npm start` -- verify app launches and editor is responsive

## Conventions
- Performance is the top priority -- launch-to-typing must be near-instant
- File load order defined in esbuild.config.mjs jsFiles array; new files need correct position
- Entries are markdown with YAML frontmatter (parsed by frontmatter.js)
- Fuse.js powers search.js; index rebuilds on entry changes
- Platform detection (platform.js) gates Electron vs Capacitor vs Tauri behavior
- Android builds use Android Studio at /mnt/data/android-studio/ with SDKs at /mnt/data/android-sdks/
- Releases output to ../_shared/releases/lifespeed/
- Arch/AUR packages built via Podman (see _shared/builders/arch/) or arch-build VM (builder:builder)
- Windows builds run on win11-build VM (user: builder, pass: builder) -- project shared via Samba on Z:\

## Don't
- Don't add files to renderer/js/ without updating jsFiles in esbuild.config.mjs
- Don't introduce blocking operations at startup -- performance is the core value proposition
- Don't use TypeScript or frameworks -- this is vanilla JS with global scope
