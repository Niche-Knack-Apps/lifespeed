/**
 * At the Speed of Life - Main Application
 * Initializes all components and manages app state
 */

// VERSION MARKER - if you see this in console, new code is loaded
console.log('[App] CODE VERSION: 2026-01-09-v3-filesystem-first');

class App {
    constructor() {
        this.currentEntry = null;
        this.settings = null;
        this.autoSaveTimeout = null;
        this.isInitialized = false;
        this.currentMode = 'preview'; // Default to preview mode (editable WYSIWYG)
        this.wordCount = 0;
        this.lastSavedContent = ''; // Track what was last saved
        this.lastInputTime = 0; // Track last typing time to prevent sync during active editing
        this.isSyncingCache = false; // Prevent concurrent syncs

        // DOM references (cached for speed)
        this.dom = {};
    }

    async init() {
        console.log('[App] Initializing...');
        const startTime = performance.now();

        // Cache DOM references
        this.cacheDOMReferences();

        // Load settings first
        await this.loadSettings();

        // Apply theme and font size
        this.applyTheme(this.settings.theme);
        this.applyFontSize(this.settings.fontSize);

        // Initialize components
        this.initEditor();
        this.initToolbar();
        this.initSidebar();
        this.initFinder();
        this.initSettingsModal();
        this.initKeyboardShortcuts();

        // Setup file watcher for external changes
        if (platform.isElectron()) {
            platform.setupFileWatcher({
                onAdded: (path) => this.onFileAdded(path),
                onChanged: (path) => this.onFileChanged(path),
                onDeleted: (path) => this.onFileDeleted(path)
            });
        }

        // SPEED: Create new entry FIRST, show UI immediately
        await this.createNewEntry();

        // Hide loading, show app IMMEDIATELY
        this.dom.loading.classList.add('hidden');
        this.dom.app.classList.remove('hidden');

        // Focus editor and activate keyboard NOW
        this.focusCurrentEditor();

        // Show keyboard on Capacitor (Android) - Layer 3 fallback
        if (platform.isCapacitor()) {
            await platform.showKeyboard();
        }

        this.isInitialized = true;
        const elapsed = (performance.now() - startTime).toFixed(0);
        console.log(`[App] Ready to type in ${elapsed}ms`);

        // Setup lifecycle handlers (handles save/discard on background)
        this.setupLifecycleHandlers();

        // Load entries list in background (don't block typing)
        // Then ensure newly created entry is visible in sidebar
        this.loadEntriesList().then(async () => {
            console.log('[App] loadEntriesList completed, calling ensureCurrentEntryInSidebar');
            await this.ensureCurrentEntryInSidebar();
            console.log('[App] ensureCurrentEntryInSidebar completed');
        }).catch(err => {
            console.error('[App] Error in loadEntriesList chain:', err);
        });
    }

    /**
     * Ensure the current entry appears in the sidebar after entries list loads.
     * This handles the case where a new entry is created before the cache is loaded.
     */
    async ensureCurrentEntryInSidebar() {
        try {
            if (!this.currentEntry || !this.allEntries) return;

            // Check if current entry is already in the list
            const exists = this.allEntries.some(e =>
                e.path === this.currentEntry.path ||
                e.dirname === this.currentEntry.dirname
            );

            if (!exists) {
                console.log('[App] Adding current entry to sidebar:', this.currentEntry.dirname);
                const newEntry = {
                    path: this.currentEntry.path,
                    dirname: this.currentEntry.dirname,
                    entryUri: this.currentEntry.entryUri,
                    title: 'New Entry',
                    date: new Date().toISOString(),
                    mtime: Date.now()
                };
                this.allEntries.unshift(newEntry);
                this.renderEntriesList(this.allEntries);

                // Save to cache so it persists
                if (window.metadataCache) {
                    await window.metadataCache.saveEntry(newEntry);
                }
            }
        } catch (error) {
            console.error('[App] ensureCurrentEntryInSidebar error:', error);
        }
    }

    setupLifecycleHandlers() {
        // Handle visibility change - ONLY save current entry, NOT sync cache
        // (keyboard show/hide triggers visibilitychange on Android - don't sync!)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                // Just save, don't sync cache (would cause pauses during typing)
                this.saveOrDiscardCurrentEntry();
            }
        });

        // Handle page unload (desktop browser close)
        window.addEventListener('beforeunload', () => {
            this.saveOrDiscardCurrentEntry();
            // Save current entry to cache immediately (sync-ish, fast)
            this.saveCurrentEntryToCache();
        });

        // Capacitor app state change - this is the TRUE app background event
        if (platform.isCapacitor() && window.Capacitor?.Plugins?.App) {
            window.Capacitor.Plugins.App.addListener('appStateChange', (state) => {
                if (!state.isActive) {
                    this.saveOrDiscardCurrentEntry();
                    // Save current entry to cache (fast, reliable)
                    this.saveCurrentEntryToCache();
                }
            });
        }
    }

    /**
     * Save current entry to cache - called on quit to ensure it persists
     * This is fast (single entry) so it completes before page unloads
     */
    saveCurrentEntryToCache() {
        if (!this.currentEntry || !window.metadataCache) return;

        try {
            const entry = {
                path: this.currentEntry.path,
                dirname: this.currentEntry.dirname,
                entryUri: this.currentEntry.entryUri,
                title: this.dom.metaTitle?.value || 'Untitled',
                date: new Date().toISOString(),
                mtime: Date.now()
            };

            // Save to cache - this is fast enough to complete before unload
            window.metadataCache.saveEntry(entry);
            console.log('[App] Saved current entry to cache on exit:', entry.dirname);
        } catch (error) {
            console.error('[App] Failed to save entry to cache on exit:', error);
        }
    }

    /**
     * Sync cache before app exit/background - keeps cache fresh for instant next launch
     * Includes guards to prevent sync during active typing
     */
    async syncCacheBeforeExit() {
        // Guard: Don't sync if user was typing in the last 2 seconds
        const timeSinceLastInput = Date.now() - this.lastInputTime;
        if (timeSinceLastInput < 2000) {
            console.log('[App] Skipping cache sync - user was typing recently');
            return;
        }

        // Guard: Don't run concurrent syncs
        if (this.isSyncingCache) {
            console.log('[App] Skipping cache sync - already syncing');
            return;
        }

        this.isSyncingCache = true;
        console.log('[App] Syncing cache before exit...');
        try {
            await this.syncEntriesInBackground();
            console.log('[App] Cache synced successfully');
        } catch (error) {
            console.error('[App] Failed to sync cache:', error);
        } finally {
            this.isSyncingCache = false;
        }
    }

    // Check if entry has actual content (not just metadata)
    hasContent() {
        const content = this.dom.editor.value;
        const parsed = frontmatter.parse(content);
        const body = parsed.body.trim();
        return body.length > 0;
    }

    // Save if has content, otherwise discard empty entry
    async saveOrDiscardCurrentEntry() {
        if (!this.currentEntry) return;

        if (this.hasContent()) {
            await this.saveCurrentEntryImmediate();
        } else {
            // Discard empty entry
            console.log('[App] Discarding empty entry:', this.currentEntry.path);
            await platform.deleteEntry(this.currentEntry.path);
        }
    }


    cacheDOMReferences() {
        this.dom = {
            // Main elements
            loading: document.getElementById('loading'),
            app: document.getElementById('app'),
            editor: document.getElementById('editor'),
            headerTitle: document.getElementById('header-title'),
            status: document.getElementById('status'),

            // Sidebar
            sidebar: document.getElementById('sidebar'),
            sidebarBackdrop: document.getElementById('sidebar-backdrop'),
            entriesList: document.getElementById('entries-list'),
            btnMenu: document.getElementById('btn-menu'),

            // Metadata
            metadataSection: document.getElementById('metadata-section'),
            btnToggleMetadata: document.getElementById('btn-toggle-metadata'),
            metaTitle: document.getElementById('meta-title'),
            metaTags: document.getElementById('meta-tags'),
            metaDate: document.getElementById('meta-date'),

            // Toolbar - Primary row (Desktop)
            toolbarLeft: document.getElementById('toolbar-left'),
            btnBold: document.getElementById('btn-bold'),
            btnItalic: document.getElementById('btn-italic'),
            btnStrikethrough: document.getElementById('btn-strikethrough'),
            btnCode: document.getElementById('btn-code'),
            btnLink: document.getElementById('btn-link'),
            btnCheckbox: document.getElementById('btn-checkbox'),
            btnMoreTools: document.getElementById('btn-more-tools'),
            btnSource: document.getElementById('btn-source'),
            btnPreview: document.getElementById('btn-preview'),

            // Toolbar - Secondary row (accordion)
            toolbarSecondary: document.getElementById('toolbar-secondary'),
            btnQuote: document.getElementById('btn-quote'),
            btnHeading: document.getElementById('btn-heading'),
            btnBullet: document.getElementById('btn-bullet'),
            btnNumber: document.getElementById('btn-number'),
            btnFootnote: document.getElementById('btn-footnote'),
            btnTable: document.getElementById('btn-table'),
            btnHr: document.getElementById('btn-hr'),

            // Header actions
            btnNew: document.getElementById('btn-new'),
            btnFind: document.getElementById('btn-find'),
            btnSettings: document.getElementById('btn-settings'),

            // Finder
            finder: document.getElementById('finder'),
            finderInput: document.getElementById('finder-input'),
            finderResultsList: document.getElementById('finder-results-list'),
            finderPreviewContent: document.getElementById('finder-preview-content'),
            finderClose: document.getElementById('finder-close'),

            // Settings modal
            settingsModal: document.getElementById('settings-modal'),
            settingsClose: document.getElementById('settings-close'),
            settingEntriesDir: document.getElementById('setting-entries-dir'),
            btnChooseDir: document.getElementById('btn-choose-dir'),
            indexStatus: document.getElementById('index-status'),
            btnRebuildIndex: document.getElementById('btn-rebuild-index'),
            settingTheme: document.getElementById('setting-theme'),
            settingFontSize: document.getElementById('setting-font-size'),

            // FAB
            fab: document.getElementById('fab'),

            // Preview
            preview: document.getElementById('preview'),

            // Context menu
            contextMenu: document.getElementById('insert-context-menu'),
            contextMenuInsertImage: document.getElementById('context-insert-image'),
            contextMenuInsertFile: document.getElementById('context-insert-file'),
            contextMenuBold: document.getElementById('context-bold'),
            contextMenuItalic: document.getElementById('context-italic'),
            contextMenuHeading: document.getElementById('context-heading'),
            contextMenuList: document.getElementById('context-list'),

            // Debug logs
            debugLogStats: document.getElementById('debug-log-stats'),
            downloadLogsBtn: document.getElementById('download-logs-btn'),
            clearLogsBtn: document.getElementById('clear-logs-btn'),

            // Indexing overlay
            indexingOverlay: document.getElementById('indexing-overlay'),
            indexingMessage: document.getElementById('indexing-message'),
            indexingProgressFill: document.getElementById('indexing-progress-fill'),
            indexingStatus: document.getElementById('indexing-status'),

            // Prompt modal
            promptModal: document.getElementById('prompt-modal'),
            promptMessage: document.getElementById('prompt-message'),
            promptInput: document.getElementById('prompt-input'),
            promptOk: document.getElementById('prompt-ok'),
            promptCancel: document.getElementById('prompt-cancel'),

            // Sort controls
            sortBy: document.getElementById('sort-by')
        };

        // Cache state
        this.allEntries = [];      // Full list of entries from cache
        this.renderedCount = 0;    // Number of entries rendered in sidebar
        this.isIndexing = false;   // Flag to prevent concurrent indexing
        this.currentSort = 'date-desc'; // Default sort order
    }

    // ===== Settings =====

    async loadSettings() {
        const result = await platform.loadSettings();
        this.settings = result.settings || this.defaultSettings();

        // Update settings UI
        if (this.dom.settingEntriesDir) {
            const entriesDir = await platform.getEntriesDir();
            this.dom.settingEntriesDir.value = entriesDir;
        }
        if (this.dom.settingTheme) {
            this.dom.settingTheme.value = this.settings.theme;
        }
        if (this.dom.settingFontSize) {
            this.dom.settingFontSize.value = this.settings.fontSize;
        }
    }

    async saveSettings() {
        await platform.saveSettings(this.settings);
    }

    defaultSettings() {
        return {
            theme: 'dark',
            fontSize: 'medium',
            autoSave: true,
            autoSaveDelay: 500,
            showMetadata: false,
            createOnLaunch: true
        };
    }

    applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
    }

    applyFontSize(size) {
        document.documentElement.setAttribute('data-font-size', size);
    }

    // ===== Editor =====

    initEditor() {
        // Auto-save on input for source mode
        this.dom.editor.addEventListener('input', () => {
            this.lastInputTime = Date.now(); // Track for sync guard
            this.scheduleAutoSave();
            this.updateWordCount();
            this.updateAutoTitle();
        });

        // Handle paste for images in source
        this.dom.editor.addEventListener('paste', (e) => this.handlePaste(e));

        // Handle drop for images/files in source
        this.dom.editor.addEventListener('drop', (e) => this.handleDrop(e));
        this.dom.editor.addEventListener('dragover', (e) => e.preventDefault());

        // Make preview EDITABLE (WYSIWYG mode)
        this.dom.preview.setAttribute('contenteditable', 'true');
        this.dom.preview.addEventListener('input', () => {
            this.lastInputTime = Date.now(); // Track for sync guard
            this.syncPreviewToSource();
            this.scheduleAutoSave();
            this.updateWordCount();
            this.updateAutoTitle();
        });

        // Handle paste for images in preview
        this.dom.preview.addEventListener('paste', (e) => this.handlePaste(e));
        this.dom.preview.addEventListener('drop', (e) => this.handleDrop(e));
        this.dom.preview.addEventListener('dragover', (e) => e.preventDefault());

        // Tap-and-hold for insert menu (mobile) - on both editors
        this.initContextMenu();

        // Start in PREVIEW mode for WYSIWYG editing
        this.setMode('preview');
    }

    initContextMenu() {
        this.longPressTimer = null;
        this.longPressTarget = null;

        const editors = [this.dom.editor, this.dom.preview];

        editors.forEach(editor => {
            // Touch start - begin long press timer
            editor.addEventListener('touchstart', (e) => {
                // Only start timer if single touch
                if (e.touches.length !== 1) return;

                const touch = e.touches[0];
                this.longPressTimer = setTimeout(() => {
                    this.showContextMenu(touch.clientX, touch.clientY);
                }, 600); // 600ms long press

                this.longPressTarget = { x: touch.clientX, y: touch.clientY };
            }, { passive: true });

            // Touch move - cancel if moved too far
            editor.addEventListener('touchmove', (e) => {
                if (!this.longPressTimer || !this.longPressTarget) return;

                const touch = e.touches[0];
                const dx = Math.abs(touch.clientX - this.longPressTarget.x);
                const dy = Math.abs(touch.clientY - this.longPressTarget.y);

                if (dx > 10 || dy > 10) {
                    clearTimeout(this.longPressTimer);
                    this.longPressTimer = null;
                }
            }, { passive: true });

            // Touch end - cancel timer
            editor.addEventListener('touchend', () => {
                if (this.longPressTimer) {
                    clearTimeout(this.longPressTimer);
                    this.longPressTimer = null;
                }
            }, { passive: true });

            editor.addEventListener('touchcancel', () => {
                if (this.longPressTimer) {
                    clearTimeout(this.longPressTimer);
                    this.longPressTimer = null;
                }
            }, { passive: true });
        });

        // Close context menu when tapping elsewhere
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.insert-context-menu')) {
                this.hideContextMenu();
            }
        });

        // Right-click for desktop
        editors.forEach(editor => {
            editor.addEventListener('contextmenu', (e) => {
                // Only show our custom menu if the editor is focused
                if (document.activeElement === editor ||
                    editor.contains(document.activeElement) ||
                    this.currentMode === 'preview') {
                    e.preventDefault();
                    this.showContextMenu(e.clientX, e.clientY);
                }
            });
        });

        // Setup context menu button handlers
        this.dom.contextMenuInsertImage?.addEventListener('click', () => this.pickAndInsertImage());
        this.dom.contextMenuInsertFile?.addEventListener('click', () => this.pickAndInsertFile());

        // Context menu formatting tools
        this.dom.contextMenuBold?.addEventListener('click', () => {
            this.hideContextMenu();
            this.wrapSelection('**');
        });
        this.dom.contextMenuItalic?.addEventListener('click', () => {
            this.hideContextMenu();
            this.wrapSelection('*');
        });
        this.dom.contextMenuHeading?.addEventListener('click', () => {
            this.hideContextMenu();
            this.prefixLine('## ');
        });
        this.dom.contextMenuList?.addEventListener('click', () => {
            this.hideContextMenu();
            this.prefixLine('- ');
        });
    }

    showContextMenu(x, y) {
        // Position menu BELOW tap location
        const menu = this.dom.contextMenu;
        menu.classList.remove('hidden');

        // Calculate position - below tap point
        const menuHeight = menu.offsetHeight;
        const menuWidth = menu.offsetWidth;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Position below tap, centered horizontally on tap point
        let left = x - (menuWidth / 2);
        let top = y + 20; // 20px below tap

        // Keep in viewport
        if (left < 10) left = 10;
        if (left + menuWidth > viewportWidth - 10) left = viewportWidth - menuWidth - 10;
        if (top + menuHeight > viewportHeight - 10) {
            // If not enough room below, position above
            top = y - menuHeight - 10;
        }

        menu.style.left = left + 'px';
        menu.style.top = top + 'px';

        // Haptic feedback if available
        if (navigator.vibrate) {
            navigator.vibrate(20);
        }
    }

    hideContextMenu() {
        if (this.dom.contextMenu) {
            this.dom.contextMenu.classList.add('hidden');
        }
    }

    async pickAndInsertImage() {
        this.hideContextMenu();
        await this.pickFile('image');
    }

    async pickAndInsertFile() {
        this.hideContextMenu();
        await this.pickFile('file');
    }

    async pickFile(type) {
        if (!this.currentEntry) return;

        // Use native file picker on Capacitor (Android)
        if (platform.isCapacitor()) {
            try {
                let result;
                if (type === 'image') {
                    result = await platform.pickImage();
                } else {
                    result = await platform.pickFile();
                }

                if (result.success && result.base64Data) {
                    // Save picked file to entry
                    if (result.isImage || type === 'image' || result.mimeType?.startsWith('image/')) {
                        // Save as image
                        const saveResult = await platform.pasteImage(result.base64Data, this.currentEntry);
                        if (saveResult.success) {
                            await this.insertTextInCurrentMode(saveResult.markdown + '\n');
                            this.scheduleAutoSave();
                            platform.showToast('Image inserted');
                        }
                    } else {
                        // Save as file attachment
                        const saveResult = await this._savePickedFile(result.base64Data, result.filename);
                        if (saveResult.success) {
                            await this.insertTextInCurrentMode(saveResult.markdown + '\n');
                            this.scheduleAutoSave();
                            platform.showToast('File attached');
                        }
                    }
                    return;
                } else if (result.canceled) {
                    // User cancelled, do nothing
                    return;
                }
                // If native picker fails, fall through to HTML input
            } catch (error) {
                console.error('[App] Native file pick failed, using fallback:', error);
            }
        }

        // Use HTML file input for Electron/Web
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = type === 'image' ? 'image/*' : '*/*';
        input.onchange = async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            if (type === 'image' && file.type.startsWith('image/')) {
                await this.insertImage(file);
            } else {
                await this.insertFile(file);
            }
        };
        input.click();
    }

    async _savePickedFile(base64Data, filename) {
        // Save a picked file (non-image) to the entry's files directory
        if (!this.currentEntry) return { success: false };

        try {
            const plugins = await platform._getCapacitorPlugins();
            if (plugins.FolderPicker && this.currentEntry.entryUri) {
                const result = await plugins.FolderPicker.saveFile({
                    entryUri: this.currentEntry.entryUri,
                    base64Data: base64Data,
                    filename: filename
                });
                return result;
            }
        } catch (e) {
            console.error('[App] Error saving picked file:', e);
        }

        return {
            success: true,
            filename: filename,
            relativePath: `files/${filename}`,
            markdown: `[${filename}](files/${filename})`
        };
    }

    async insertTextInCurrentMode(text) {
        // Always insert into source editor
        this.insertTextAtCursor(text);
        // Update preview if visible
        if (this.currentMode === 'preview') {
            await this.renderPreview();
        }
    }

    async insertFile(file) {
        if (!this.currentEntry) return;

        // Check if file is an image - if so, use insertImage instead
        if (file.type.startsWith('image/')) {
            return await this.insertImage(file);
        }

        try {
            // Copy file to entry's files/ directory
            const result = await platform.attachFile(file, this.currentEntry, file.name);

            if (result.success) {
                await this.insertTextInCurrentMode(result.markdown + '\n');
                this.scheduleAutoSave();
                platform.showToast('File attached');
            } else {
                console.error('[App] Failed to attach file:', result.error);
                platform.showToast('Failed to attach file');
            }
        } catch (error) {
            console.error('[App] Error attaching file:', error);
            platform.showToast('Failed to attach file');
        }
    }

    updateAutoTitle() {
        // Only auto-update title if it's empty or matches previous auto-title
        if (this.dom.metaTitle.value && !this.dom.metaTitle.dataset.autoTitle) {
            return;
        }

        const content = this.dom.editor.value;
        const parsed = frontmatter.parse(content);
        const body = parsed.body.trim();

        if (!body) return;

        // Get first line of content (excluding frontmatter)
        const firstLine = body.split('\n')[0]
            .replace(/^#+\s*/, '') // Remove markdown headings
            .replace(/^\*+\s*/, '') // Remove bold/italic markers
            .replace(/^>\s*/, '') // Remove blockquote
            .trim()
            .slice(0, 60); // Limit length

        if (firstLine && firstLine !== this.dom.metaTitle.value) {
            this.dom.metaTitle.value = firstLine;
            this.dom.metaTitle.dataset.autoTitle = 'true';
            this.dom.headerTitle.textContent = firstLine;
            this.updateSidebarEntryTitle(firstLine);
        }
    }

    async handlePaste(e) {
        const items = e.clipboardData?.items;
        if (!items) return;

        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                await this.insertImage(file);
                break;
            }
        }
    }

    async handleDrop(e) {
        e.preventDefault();
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;

        for (const file of files) {
            if (file.type.startsWith('image/')) {
                await this.insertImage(file);
            }
        }
    }

    async insertImage(file) {
        if (!this.currentEntry) {
            console.warn('[App] insertImage: No current entry');
            return;
        }

        console.log('[App] insertImage: Starting', { fileName: file?.name, fileType: file?.type, hasEntryUri: !!this.currentEntry?.entryUri });

        try {
            // Convert to base64
            console.log('[App] insertImage: Converting to base64...');
            const base64 = await this._fileToBase64(file);
            console.log('[App] insertImage: Base64 ready, length:', base64?.length);

            // Pass the full currentEntry object so SAF can use entryUri
            console.log('[App] insertImage: Calling platform.pasteImage...');
            const result = await platform.pasteImage(base64, this.currentEntry);
            console.log('[App] insertImage: pasteImage result:', { success: result?.success, markdown: result?.markdown, error: result?.error });

            if (result.success) {
                console.log('[App] insertImage: Inserting markdown into editor...');
                await this.insertTextInCurrentMode(result.markdown + '\n');
                console.log('[App] insertImage: Scheduling auto-save...');
                this.scheduleAutoSave();
                console.log('[App] insertImage: Complete');
                platform.showToast('Image inserted');
            } else {
                console.error('[App] Failed to insert image:', result.error);
                platform.showToast('Failed to insert image');
            }
        } catch (error) {
            console.error('[App] Error inserting image:', error, error?.stack);
            platform.showToast('Failed to insert image');
        }
    }

    _fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    insertTextAtCursor(text) {
        const editor = this.dom.editor;
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const value = editor.value;

        editor.value = value.substring(0, start) + text + value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + text.length;
        editor.focus();
    }

    wrapSelection(prefix, suffix = prefix) {
        const editor = this.dom.editor;
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const value = editor.value;
        const selected = value.substring(start, end);

        editor.value = value.substring(0, start) + prefix + selected + suffix + value.substring(end);
        editor.selectionStart = start + prefix.length;
        editor.selectionEnd = start + prefix.length + selected.length;
        editor.focus();
        this.scheduleAutoSave();
    }

    prefixLine(prefix) {
        const editor = this.dom.editor;
        const start = editor.selectionStart;
        const value = editor.value;

        // Find line start
        let lineStart = start;
        while (lineStart > 0 && value[lineStart - 1] !== '\n') {
            lineStart--;
        }

        editor.value = value.substring(0, lineStart) + prefix + value.substring(lineStart);
        editor.selectionStart = editor.selectionEnd = start + prefix.length;
        editor.focus();
        this.scheduleAutoSave();
    }

    scheduleAutoSave() {
        if (!this.settings.autoSave) return;

        clearTimeout(this.autoSaveTimeout);

        this.autoSaveTimeout = setTimeout(() => {
            this.saveCurrentEntry();
        }, this.settings.autoSaveDelay);
    }

    async saveCurrentEntry() {
        if (!this.currentEntry) return;

        try {
            // Sync preview to source if in preview mode
            if (this.currentMode === 'preview') {
                this.syncPreviewToSource();
            }

            // Update content from editor
            const content = this.dom.editor.value;
            const newTitle = this.dom.metaTitle.value.trim();

            // Update frontmatter with metadata fields
            const updatedContent = frontmatter.updateInContent(content, {
                title: newTitle,
                tags: this.dom.metaTags.value.split(',').map(t => t.trim()).filter(t => t),
                lastmod: new Date().toISOString()
            });

            const result = await platform.saveEntry(this.currentEntry.path, updatedContent);

            if (result.success) {
                this.lastSavedContent = updatedContent;
                this.updateWordCount(); // This now updates status automatically

                // Check if we need to rename the entry directory
                const currentSlug = this.extractSlugFromDirname(this.currentEntry.dirname);
                const newSlug = frontmatter.slugify(newTitle);

                if (newTitle && newSlug && currentSlug !== newSlug && platform.isElectron()) {
                    await this.renameEntry(newTitle);
                }
            } else {
                console.error('[App] Save failed:', result.error);
                this.updateStatus('Save failed!');
            }
        } catch (error) {
            console.error('[App] Save failed:', error);
            this.updateStatus('Save failed!');
        }
    }

    // Immediate save without debounce - for app lifecycle events
    async saveCurrentEntryImmediate() {
        clearTimeout(this.autoSaveTimeout);
        await this.saveCurrentEntry();
    }

    extractSlugFromDirname(dirname) {
        const match = dirname.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
        return match ? match[1] : '';
    }

    async renameEntry(newTitle) {
        if (!this.currentEntry || !platform.isElectron()) return;

        try {
            const result = await window.api.renameEntry(this.currentEntry.path, newTitle);
            if (result.success) {
                const oldPath = this.currentEntry.path;
                this.currentEntry.path = result.path;
                this.currentEntry.dirname = result.dirname;

                // Update sidebar entry in-place (don't reload entire list!)
                this.updateSidebarEntryPath(oldPath, result.path, result.dirname);

                // Update cache entry - delete old, add new immediately
                if (window.metadataCache) {
                    await window.metadataCache.deleteEntry(oldPath);
                    // Immediately save renamed entry to cache (don't wait for sync!)
                    await window.metadataCache.saveEntry({
                        path: result.path,
                        dirname: result.dirname,
                        entryUri: this.currentEntry.entryUri,
                        title: newTitle,
                        date: new Date().toISOString(),
                        mtime: Date.now()
                    });
                }

                console.log('[App] Entry renamed:', oldPath, '->', result.path);
            }
        } catch (error) {
            console.error('[App] Rename failed:', error);
        }
    }

    // Update a single sidebar entry path without reloading entire list
    updateSidebarEntryPath(oldPath, newPath, newDirname) {
        // Find and update in allEntries array
        const entry = this.allEntries?.find(e => e.path === oldPath);
        if (entry) {
            entry.path = newPath;
            entry.dirname = newDirname;
        }

        // Update DOM element if visible
        const entryEl = this.dom.entriesList?.querySelector(`[data-path="${CSS.escape(oldPath)}"]`);
        if (entryEl) {
            entryEl.dataset.path = newPath;
        }
    }

    updateStatus(text) {
        this.dom.status.textContent = text;
    }

    updateWordCount() {
        const content = this.dom.editor.value;
        const parsed = frontmatter.parse(content);
        const text = parsed.body.trim();

        if (!text) {
            this.wordCount = 0;
        } else {
            this.wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
        }

        // Always update the status to show word count
        this.dom.status.textContent = this.formatWordCount();
    }

    formatWordCount() {
        const words = this.wordCount || 0;
        const wordText = words === 1 ? 'word' : 'words';
        return `${words} ${wordText}`;
    }

    formatStatus() {
        return this.formatWordCount();
    }

    // ===== Toolbar =====

    initToolbar() {
        // Primary row - formatting buttons
        this.dom.btnBold?.addEventListener('click', () => this.wrapSelection('**'));
        this.dom.btnItalic?.addEventListener('click', () => this.wrapSelection('*'));
        this.dom.btnStrikethrough?.addEventListener('click', () => this.wrapSelection('~~'));
        this.dom.btnCode?.addEventListener('click', () => this.wrapSelection('`'));
        this.dom.btnLink?.addEventListener('click', () => this.insertLink());
        this.dom.btnCheckbox?.addEventListener('click', () => this.prefixLine('- [ ] '));

        // Accordion toggle
        this.dom.btnMoreTools?.addEventListener('click', () => this.toggleSecondaryToolbar());

        // Secondary row - block formatting buttons
        this.dom.btnQuote.addEventListener('click', () => this.prefixLine('> '));
        this.dom.btnHeading.addEventListener('click', () => this.prefixLine('## '));
        this.dom.btnBullet?.addEventListener('click', () => this.prefixLine('- '));
        this.dom.btnNumber?.addEventListener('click', () => this.prefixLine('1. '));
        this.dom.btnFootnote?.addEventListener('click', () => this.insertFootnote());
        this.dom.btnTable?.addEventListener('click', () => this.insertTable());
        this.dom.btnHr?.addEventListener('click', () => this.insertAtCursor('\n---\n'));

        // Mode toggle
        this.dom.btnSource.addEventListener('click', () => this.setMode('source'));
        this.dom.btnPreview.addEventListener('click', () => this.setMode('preview'));

        this.dom.btnToggleMetadata.addEventListener('click', () => this.toggleMetadata());

        // Manual title edit - sync to source frontmatter and sidebar
        this.dom.metaTitle.addEventListener('input', () => {
            delete this.dom.metaTitle.dataset.autoTitle;
            const title = this.dom.metaTitle.value || 'Untitled';
            this.dom.headerTitle.textContent = title;
            this.updateSidebarEntryTitle(title);
            this.syncMetadataToSource();
            this.scheduleAutoSave();
        });

        // Tags input - sync to source frontmatter
        this.dom.metaTags.addEventListener('input', () => {
            this.syncMetadataToSource();
            this.scheduleAutoSave();
        });
    }

    // ===== Toolbar Methods =====

    toggleSecondaryToolbar() {
        if (this.dom.toolbarSecondary) {
            this.dom.toolbarSecondary.classList.toggle('hidden');
            this.dom.btnMoreTools.textContent =
                this.dom.toolbarSecondary.classList.contains('hidden') ? '▼' : '▲';
        }
    }

    // Custom async prompt (Electron doesn't support native prompt())
    asyncPrompt(message, defaultValue = '') {
        return new Promise((resolve) => {
            this.dom.promptMessage.textContent = message;
            this.dom.promptInput.value = defaultValue;
            this.dom.promptModal.classList.remove('hidden');
            this.dom.promptInput.focus();
            this.dom.promptInput.select();

            const cleanup = () => {
                this.dom.promptModal.classList.add('hidden');
                this.dom.promptOk.removeEventListener('click', onOk);
                this.dom.promptCancel.removeEventListener('click', onCancel);
                this.dom.promptInput.removeEventListener('keydown', onKeydown);
                this.dom.promptModal.querySelector('.modal-backdrop').removeEventListener('click', onCancel);
            };

            const onOk = () => {
                const value = this.dom.promptInput.value;
                cleanup();
                resolve(value || null);
            };

            const onCancel = () => {
                cleanup();
                resolve(null);
            };

            const onKeydown = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    onOk();
                } else if (e.key === 'Escape') {
                    onCancel();
                }
            };

            this.dom.promptOk.addEventListener('click', onOk);
            this.dom.promptCancel.addEventListener('click', onCancel);
            this.dom.promptInput.addEventListener('keydown', onKeydown);
            this.dom.promptModal.querySelector('.modal-backdrop').addEventListener('click', onCancel);
        });
    }

    async insertLink() {
        const url = await this.asyncPrompt('Enter URL:');
        if (url) {
            this.wrapSelection('[', `](${url})`);
        }
    }

    insertFootnote() {
        // Count existing footnotes to get next number
        const content = this.dom.editor.value;
        const matches = content.match(/\[\^(\d+)\]/g) || [];
        const num = matches.length + 1;
        this.insertAtCursor(`[^${num}]`);
    }

    async insertTable() {
        // Prompt for table size: "rows x cols" or "rows,cols" format
        const input = await this.asyncPrompt('Table size (rows x columns):', '3x3');
        if (!input) return;

        // Parse input - accept "3x3", "3,3", "3 3" formats
        const match = input.match(/(\d+)\s*[x,\s]\s*(\d+)/i);
        if (!match) {
            platform.showToast('Invalid format. Use "rows x cols" (e.g., 3x3)');
            return;
        }

        const rows = Math.min(parseInt(match[1], 10), 20); // Cap at 20 rows
        const cols = Math.min(parseInt(match[2], 10), 10); // Cap at 10 cols

        if (rows < 1 || cols < 1) return;

        // Build table markdown
        let table = '\n';

        // Header row
        table += '| ' + Array(cols).fill('Header').map((h, i) => `${h} ${i + 1}`).join(' | ') + ' |\n';

        // Separator row
        table += '| ' + Array(cols).fill('---').join(' | ') + ' |\n';

        // Data rows (rows - 1 because header counts as one row)
        for (let r = 0; r < rows - 1; r++) {
            table += '| ' + Array(cols).fill('').map((_, c) => `Cell ${r + 1},${c + 1}`).join(' | ') + ' |\n';
        }

        this.insertAtCursor(table);
    }

    insertAtCursor(text) {
        const editor = this.dom.editor;
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.value = editor.value.slice(0, start) + text + editor.value.slice(end);
        editor.selectionStart = editor.selectionEnd = start + text.length;
        editor.focus();
        this.scheduleAutoSave();
    }

    // Sync metadata fields to source frontmatter
    syncMetadataToSource() {
        const content = this.dom.editor.value;
        const parsed = frontmatter.parse(content);

        // Update frontmatter data from UI fields
        parsed.data.title = this.dom.metaTitle.value.trim();
        parsed.data.tags = this.dom.metaTags.value
            .split(',')
            .map(t => t.trim())
            .filter(t => t.length > 0);
        parsed.data.lastmod = new Date().toISOString();

        // Regenerate content with updated frontmatter
        const newContent = frontmatter.stringify(parsed.data, parsed.body);
        this.dom.editor.value = newContent;
    }

    // Update the current entry's title in the sidebar
    updateSidebarEntryTitle(title) {
        if (!this.currentEntry) return;

        // Find entry item by iterating (safer than CSS selector with special chars in path)
        const entryItems = this.dom.entriesList.querySelectorAll('.entry-item');
        for (const item of entryItems) {
            if (item.dataset.path === this.currentEntry.path) {
                const titleEl = item.querySelector('.entry-title');
                if (titleEl) {
                    titleEl.textContent = title || 'Untitled';
                }
                break;
            }
        }
    }

    async setMode(mode) {
        this.currentMode = mode;
        this.dom.btnSource.classList.toggle('active', mode === 'source');
        this.dom.btnPreview.classList.toggle('active', mode === 'preview');

        // Hide/show formatting toolbar based on mode
        const isPreview = (mode === 'preview');
        if (this.dom.toolbarLeft) {
            this.dom.toolbarLeft.classList.toggle('hidden', isPreview);
        }
        if (this.dom.toolbarSecondary) {
            // Always hide secondary toolbar in preview
            if (isPreview) this.dom.toolbarSecondary.classList.add('hidden');
        }

        if (mode === 'preview') {
            await this.renderPreview();
            this.dom.editor.classList.add('hidden');
            this.dom.preview.classList.remove('hidden');
            this.dom.preview.focus();
        } else {
            // Sync preview to source before switching
            this.syncPreviewToSource();
            this.dom.editor.classList.remove('hidden');
            this.dom.preview.classList.add('hidden');
            this.dom.editor.focus();
        }
    }

    syncPreviewToSource() {
        if (!this.dom.preview.innerHTML.trim()) return;

        // Convert HTML back to markdown
        const html = this.dom.preview.innerHTML;
        const markdown = this.htmlToMarkdown(html);

        // Get existing frontmatter
        const currentContent = this.dom.editor.value;
        const parsed = frontmatter.parse(currentContent);

        // Combine frontmatter with new body
        const newContent = frontmatter.stringify(parsed.data, markdown);
        this.dom.editor.value = newContent;
    }

    htmlToMarkdown(html) {
        const temp = document.createElement('div');
        temp.innerHTML = html;
        return this.processNode(temp).trim();
    }

    processNode(node) {
        let result = '';

        for (const child of node.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                result += child.textContent;
            } else if (child.nodeType === Node.ELEMENT_NODE) {
                const tag = child.tagName.toLowerCase();

                switch (tag) {
                    case 'h1':
                        result += '# ' + this.processNode(child).trim() + '\n\n';
                        break;
                    case 'h2':
                        result += '## ' + this.processNode(child).trim() + '\n\n';
                        break;
                    case 'h3':
                        result += '### ' + this.processNode(child).trim() + '\n\n';
                        break;
                    case 'h4':
                        result += '#### ' + this.processNode(child).trim() + '\n\n';
                        break;
                    case 'strong':
                    case 'b':
                        result += '**' + this.processNode(child) + '**';
                        break;
                    case 'em':
                    case 'i':
                        result += '*' + this.processNode(child) + '*';
                        break;
                    case 'blockquote':
                        const quoteLines = this.processNode(child).trim().split('\n');
                        result += quoteLines.map(l => '> ' + l).join('\n') + '\n\n';
                        break;
                    case 'code':
                        if (child.parentElement?.tagName.toLowerCase() === 'pre') {
                            result += this.processNode(child);
                        } else {
                            result += '`' + this.processNode(child) + '`';
                        }
                        break;
                    case 'pre':
                        result += '```\n' + this.processNode(child).trim() + '\n```\n\n';
                        break;
                    case 'a':
                        const href = child.getAttribute('href') || '';
                        result += '[' + this.processNode(child) + '](' + href + ')';
                        break;
                    case 'img':
                        const alt = child.getAttribute('alt') || '';
                        // Use original relative path if stored, otherwise try to extract from src
                        let src = child.dataset.originalSrc || child.getAttribute('src') || '';
                        // Convert file:// URLs back to relative paths
                        if (src.startsWith('file://') && this.currentEntry) {
                            const basePath = this.currentEntry.path.replace('/index.md', '');
                            src = src.replace('file://' + basePath + '/', '');
                        }
                        // Skip data: and blob: URLs - use original path or placeholder
                        if (src.startsWith('data:') || src.startsWith('blob:')) {
                            src = child.dataset.originalSrc || 'images/image.png';
                        }
                        result += '![' + alt + '](' + src + ')\n\n';
                        break;
                    case 'ul':
                    case 'ol':
                        result += this.processNode(child) + '\n';
                        break;
                    case 'li':
                        // Check if this is a task list item with a checkbox
                        const checkbox = child.querySelector('input[type="checkbox"]');
                        if (checkbox) {
                            const checked = checkbox.checked ? 'x' : ' ';
                            // Get content after checkbox
                            const content = this.processNode(child).trim();
                            result += `- [${checked}] ${content}\n`;
                        } else {
                            result += '- ' + this.processNode(child).trim() + '\n';
                        }
                        break;
                    case 'input':
                        // Skip checkbox inputs - handled in li case
                        if (child.type === 'checkbox') {
                            // Don't output anything, handled by parent li
                        }
                        break;
                    case 'p':
                        result += this.processNode(child).trim() + '\n\n';
                        break;
                    case 'br':
                        result += '\n';
                        break;
                    case 'div':
                        result += this.processNode(child) + '\n';
                        break;
                    default:
                        result += this.processNode(child);
                }
            }
        }

        return result;
    }

    async renderPreview() {
        const content = this.dom.editor.value;
        const parsed = frontmatter.parse(content);

        // Use marked.js if available, otherwise simple fallback
        if (typeof marked !== 'undefined') {
            // Configure marked for extended GFM features (only once)
            if (!this._markedConfigured) {
                marked.setOptions({
                    gfm: true,           // GitHub Flavored Markdown
                    breaks: true,        // Line breaks as <br>
                    headerIds: true,     // IDs on headers for linking
                    mangle: false        // Don't escape email addresses
                });


                // Override checkbox to make it interactive (remove disabled attribute)
                marked.use({
                    renderer: {
                        checkbox(token) {
                            return `<input type="checkbox"${token.checked ? ' checked' : ''}>`;
                        }
                    }
                });

                // Register footnotes extension if available
                if (typeof markedFootnote !== 'undefined') {
                    marked.use(markedFootnote());
                }

                this._markedConfigured = true;
            }

            this.dom.preview.innerHTML = marked.parse(parsed.body);
        } else {
            // Simple markdown rendering fallback
            this.dom.preview.innerHTML = this.simpleMarkdown(parsed.body);
        }

        // Post-process: add GFM task list classes for CSS styling
        this.addTaskListClasses();

        // Make task list checkboxes interactive
        this.bindPreviewCheckboxes();

        // Fix relative image paths for entry bundles
        await this.fixImagePaths();
    }

    async fixImagePaths() {
        if (!this.currentEntry) return;

        const images = this.dom.preview.querySelectorAll('img');

        for (const img of images) {
            const src = img.getAttribute('src');
            if (!src || src.startsWith('http') || src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('file://')) {
                continue; // Already absolute, data URL, or file URL
            }

            // Store original relative path for restoration when syncing back to source
            img.dataset.originalSrc = src;

            // Handle relative paths like "images/photo.webp"
            try {
                const result = await platform.readImage(this.currentEntry, src);
                if (result.success && result.dataUrl) {
                    img.src = result.dataUrl;
                } else {
                    // Set alt text as fallback
                    img.alt = img.alt || `[Image: ${src}]`;
                }
            } catch (e) {
                console.error('[App] Error loading image:', src, e);
                img.alt = img.alt || `[Image: ${src}]`;
            }
        }
    }

    /**
     * Add GFM task list CSS classes to rendered HTML
     */
    addTaskListClasses() {
        // Find all list items containing checkboxes and add classes
        const checkboxes = this.dom.preview.querySelectorAll('li > input[type="checkbox"]');

        checkboxes.forEach(checkbox => {
            const li = checkbox.parentElement;
            if (li && li.tagName === 'LI') {
                li.classList.add('task-list-item');

                // Add class to parent UL
                const ul = li.parentElement;
                if (ul && (ul.tagName === 'UL' || ul.tagName === 'OL')) {
                    ul.classList.add('contains-task-list');
                }
            }
        });
    }

    /**
     * Bind click handlers to preview checkboxes for interactive toggling
     */
    bindPreviewCheckboxes() {
        const checkboxes = this.dom.preview.querySelectorAll('input[type="checkbox"]');

        checkboxes.forEach((checkbox, index) => {
            checkbox.addEventListener('change', () => {
                this.toggleCheckboxInSource(index, checkbox.checked);
            });
        });
    }

    /**
     * Toggle a checkbox in the source markdown
     * @param {number} checkboxIndex - Index of the checkbox in order of appearance
     * @param {boolean} checked - New checked state
     */
    toggleCheckboxInSource(checkboxIndex, checked) {
        const content = this.dom.editor.value;
        const lines = content.split('\n');

        // Find the nth task list item (- [ ] or - [x])
        let foundCount = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const match = line.match(/^(\s*-\s*)\[([ xX])\](.*)$/);
            if (match) {
                if (foundCount === checkboxIndex) {
                    // Toggle this checkbox
                    const prefix = match[1];
                    const suffix = match[3];
                    lines[i] = `${prefix}[${checked ? 'x' : ' '}]${suffix}`;
                    break;
                }
                foundCount++;
            }
        }

        // Update editor content
        this.dom.editor.value = lines.join('\n');
        this.scheduleAutoSave();
    }

    simpleMarkdown(text) {
        return text
            // Headers
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
            .replace(/^# (.+)$/gm, '<h1>$1</h1>')
            // Bold and italic
            .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            // Links
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
            // Images
            .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">')
            // Blockquotes
            .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
            // Code blocks
            .replace(/```([^`]+)```/gs, '<pre><code>$1</code></pre>')
            // Inline code
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            // Lists
            .replace(/^- (.+)$/gm, '<li>$1</li>')
            .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
            // Paragraphs
            .replace(/\n\n/g, '</p><p>')
            .replace(/^(.+)$/gm, (match) => {
                if (match.startsWith('<')) return match;
                return match;
            });
    }

    toggleMetadata() {
        this.dom.metadataSection.classList.toggle('collapsed');
    }

    // ===== Sidebar =====

    initSidebar() {
        this.dom.btnMenu.addEventListener('click', () => this.toggleSidebar());
        this.dom.sidebarBackdrop.addEventListener('click', () => this.closeSidebar());
        this.dom.btnNew.addEventListener('click', () => this.createNewEntry());
        this.dom.fab.addEventListener('click', () => this.createNewEntry());

        // Initialize sort controls
        this.initSortControls();
    }

    initSortControls() {
        if (this.dom.sortBy) {
            this.dom.sortBy.value = this.currentSort;
            this.dom.sortBy.addEventListener('change', (e) => {
                this.currentSort = e.target.value;
                this.sortAndRenderEntries();
            });
        }
    }

    sortEntries(entries) {
        const sorted = [...entries];

        switch (this.currentSort) {
            case 'date-desc':
                sorted.sort((a, b) => this.compareDates(b, a, 'date'));
                break;
            case 'date-asc':
                sorted.sort((a, b) => this.compareDates(a, b, 'date'));
                break;
            case 'modified-desc':
                sorted.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
                break;
            case 'modified-asc':
                sorted.sort((a, b) => (a.mtime || 0) - (b.mtime || 0));
                break;
            case 'title-asc':
                sorted.sort((a, b) => this.getEntryTitle(a).localeCompare(this.getEntryTitle(b)));
                break;
            case 'title-desc':
                sorted.sort((a, b) => this.getEntryTitle(b).localeCompare(this.getEntryTitle(a)));
                break;
        }

        return sorted;
    }

    compareDates(a, b, field) {
        const dateA = a[field] || a.dirname?.substring(0, 10) || '';
        const dateB = b[field] || b.dirname?.substring(0, 10) || '';
        return dateA.localeCompare(dateB);
    }

    getEntryTitle(entry) {
        if (entry.title) return entry.title.toLowerCase();
        const match = entry.dirname?.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
        return match ? match[1].replace(/-/g, ' ').toLowerCase() : (entry.dirname || '').toLowerCase();
    }

    sortAndRenderEntries() {
        if (this.allEntries.length === 0) return;
        this.renderEntriesList(this.allEntries);
    }

    toggleSidebar() {
        const isOpen = this.dom.sidebar.classList.toggle('open');
        this.dom.sidebarBackdrop.classList.toggle('visible', isOpen);
    }

    closeSidebar() {
        this.dom.sidebar.classList.remove('open');
        this.dom.sidebarBackdrop.classList.remove('visible');
    }

    /**
     * Instant entry loading from cache - NO background sync during usage for max speed
     * Sync happens only on app exit to keep cache fresh for next launch
     * SPEED IS #1 PRIORITY - skip animation if cache exists for current folder
     */
    async loadEntriesList() {
        console.log('[App] loadEntriesList - checking cache');
        const startTime = performance.now();

        try {
            // Ensure cache is initialized (may not be ready from index.html async call)
            if (window.metadataCache && !window.metadataCache.initialized) {
                console.log('[App] Waiting for metadataCache to initialize...');
                await window.metadataCache.init();
            }

            // Get current folder path
            const currentFolder = await platform.getEntriesDir();
            console.log('[App] Current folder:', currentFolder);

            // Check if we have a cache for this specific folder
            const hasCacheForFolder = await window.metadataCache?.hasCacheForFolder(currentFolder);
            console.log('[App] Has cache for folder:', hasCacheForFolder);

            if (hasCacheForFolder) {
                // FAST PATH: Load from cache silently (NO animation)
                const cachedEntries = await window.metadataCache?.getAllEntries();
                console.log('[App] Loaded', cachedEntries?.length || 0, 'entries from cache (instant)');

                if (cachedEntries && cachedEntries.length > 0) {
                    this.allEntries = cachedEntries;
                    this.renderEntriesList(cachedEntries);

                    const elapsed = (performance.now() - startTime).toFixed(0);
                    console.log(`[App] Sidebar ready in ${elapsed}ms (from cache)`);

                    // CRITICAL: Always verify filesystem matches cache
                    // Filesystem is source of truth - cache is just for speed
                    console.log('[App] Starting filesystem verification...');
                    this.verifyFilesystemEntries().catch(err => {
                        console.error('[App] Filesystem verification error:', err);
                    });
                    return;
                }
            }

            // SLOW PATH: No cache for this folder - need to build index (one-time)
            // This shows the indexing animation
            console.log('[App] No cache for folder, building initial index (one-time)');
            await this.buildInitialIndex(currentFolder);

        } catch (error) {
            console.error('[App] Failed to load entries:', error);
            // Fallback to direct loading without cache
            await this.loadEntriesListDirect();
        }
    }

    /**
     * Fallback direct loading without cache (original implementation)
     */
    async loadEntriesListDirect() {
        try {
            const result = await platform.listEntries();
            if (!result.success) return;

            this.allEntries = result.entries;
            this.renderEntriesList(result.entries);
        } catch (error) {
            console.error('[App] Failed to load entries directly:', error);
        }
    }

    /**
     * Build initial index with progress UI
     * Called when no cache exists (first run or after cache clear)
     * @param {string} folderPath - The folder being indexed (stored in cache meta)
     */
    async buildInitialIndex(folderPath) {
        if (this.isIndexing) {
            console.log('[App] Already indexing, skipping');
            return;
        }

        // Get folder path if not provided
        if (!folderPath) {
            folderPath = await platform.getEntriesDir();
        }

        this.isIndexing = true;
        this.showIndexingProgress(0, 'Scanning journal folder...');

        try {
            // Clear existing cache since we're rebuilding for this folder
            await window.metadataCache?.clearEntries();

            // Get fast directory listing (no file reads)
            const dirList = await platform.listEntriesFast();

            if (!dirList.success || !dirList.entries || dirList.entries.length === 0) {
                console.log('[App] No entries found in directory');
                // Still save folder path so we know this folder was indexed (even if empty)
                await window.metadataCache?.updateMeta({
                    folderPath: folderPath,
                    lastSync: Date.now(),
                    entryCount: 0
                });
                this.hideIndexingProgress();
                this.isIndexing = false;
                return;
            }

            const total = dirList.entries.length;
            console.log('[App] Found', total, 'entries to index');
            this.showIndexingProgress(0, `Building index - this is a one-time operation`);
            this.updateIndexingStatus(`Found ${total} entries`);

            // Larger batch size for faster processing (fewer native calls)
            const BATCH_SIZE = 100;
            // Show preview after this many entries
            const PREVIEW_THRESHOLD = 50;
            const allMetadata = [];
            let previewShown = false;

            for (let i = 0; i < total; i += BATCH_SIZE) {
                const batch = dirList.entries.slice(i, i + BATCH_SIZE);
                const batchEnd = Math.min(i + BATCH_SIZE, total);

                // Read metadata for this batch
                const result = await platform.batchGetMetadata(batch);

                if (result.success && result.entries) {
                    allMetadata.push(...result.entries);

                    // Save batch to cache immediately
                    await window.metadataCache?.saveEntries(result.entries);

                    // Show preview of entries after first batch (so user sees something early)
                    if (!previewShown && allMetadata.length >= PREVIEW_THRESHOLD) {
                        previewShown = true;
                        this.allEntries = [...allMetadata];
                        this.renderEntriesList(this.allEntries);
                        console.log('[App] Showing preview with', allMetadata.length, 'entries');
                    }
                }

                // Update progress
                const progress = batchEnd / total;
                this.showIndexingProgress(progress, `Indexing entries...`);
                this.updateIndexingStatus(`${batchEnd} of ${total} entries`);

                // Yield to UI to keep it responsive (longer yield every 500 entries)
                if (batchEnd % 500 === 0) {
                    await new Promise(r => setTimeout(r, 10));
                } else {
                    await new Promise(r => setTimeout(r, 0));
                }
            }

            // Update cache metadata WITH folder path
            await window.metadataCache?.updateMeta({
                folderPath: folderPath,
                lastSync: Date.now(),
                entryCount: allMetadata.length
            });

            console.log('[App] Initial index complete:', allMetadata.length, 'entries for folder:', folderPath);

            // Store and render entries
            this.allEntries = allMetadata;
            this.renderEntriesList(allMetadata);

            this.hideIndexingProgress();
        } catch (error) {
            console.error('[App] Initial index failed:', error);
            this.hideIndexingProgress();
            // Fall back to direct loading
            await this.loadEntriesListDirect();
        } finally {
            this.isIndexing = false;
        }
    }

    /**
     * BULLETPROOF: Verify filesystem entries match what's displayed
     * Filesystem is the SOURCE OF TRUTH - cache is just for speed
     * If a file exists on disk, it MUST appear in the sidebar
     */
    async verifyFilesystemEntries() {
        console.log('[App] Filesystem verification starting...');

        try {
            // Get ALL entries from filesystem (the source of truth)
            const dirList = await platform.listEntriesFast();
            console.log('[App] Filesystem has', dirList.entries?.length || 0, 'entries');

            if (!dirList.success || !dirList.entries) {
                console.error('[App] Failed to list filesystem entries');
                return;
            }

            // Build lookup of what's currently in sidebar
            const sidebarPaths = new Set(this.allEntries?.map(e => e.path) || []);
            const sidebarDirnames = new Set(this.allEntries?.map(e => e.dirname) || []);

            // Find entries on disk that aren't in sidebar
            const missingFromSidebar = dirList.entries.filter(e =>
                !sidebarPaths.has(e.path) && !sidebarDirnames.has(e.dirname)
            );

            console.log('[App] Found', missingFromSidebar.length, 'entries on disk not in sidebar');

            if (missingFromSidebar.length > 0) {
                // Add missing entries to sidebar
                for (const entry of missingFromSidebar) {
                    const newEntry = {
                        path: entry.path,
                        dirname: entry.dirname,
                        entryUri: entry.entryUri,
                        title: this.extractTitleFromDirname(entry.dirname),
                        date: this.extractDateFromDirname(entry.dirname),
                        mtime: entry.mtime
                    };
                    this.allEntries.unshift(newEntry);

                    // Also save to cache for next time
                    if (window.metadataCache) {
                        await window.metadataCache.saveEntry(newEntry);
                    }
                }

                // Re-render sidebar with new entries
                this.renderEntriesList(this.allEntries);
                console.log('[App] Added', missingFromSidebar.length, 'missing entries to sidebar');
            }

            console.log('[App] Filesystem verification complete');

        } catch (error) {
            console.error('[App] Filesystem verification failed:', error);
        }
    }

    /**
     * Quick sync to catch recent entries missing from cache
     * Runs in background after cache is loaded - doesn't block UI
     * Only checks filesystem entries, doesn't re-read content
     */
    async quickSyncRecentEntries(cachedEntries) {
        try {
            console.log('[App] Quick sync - checking for missing recent entries...');

            // Get filesystem listing (fast - just paths and mtimes)
            const dirList = await platform.listEntriesFast();
            if (!dirList.success || !dirList.entries) return;

            // Build set of cached paths for fast lookup
            const cachedPaths = new Set(cachedEntries.map(e => e.path));
            const cachedDirnames = new Set(cachedEntries.map(e => e.dirname));

            // Find entries on disk that aren't in cache
            const missing = dirList.entries.filter(e =>
                !cachedPaths.has(e.path) && !cachedDirnames.has(e.dirname)
            );

            if (missing.length === 0) {
                console.log('[App] Quick sync - no missing entries');
                return;
            }

            console.log('[App] Quick sync - found', missing.length, 'missing entries, adding to sidebar');

            // Add missing entries to allEntries and cache
            for (const entry of missing) {
                const newEntry = {
                    path: entry.path,
                    dirname: entry.dirname,
                    entryUri: entry.entryUri,
                    title: this.extractTitleFromDirname(entry.dirname),
                    date: this.extractDateFromDirname(entry.dirname),
                    mtime: entry.mtime
                };

                this.allEntries.unshift(newEntry);

                // Save to cache
                if (window.metadataCache) {
                    await window.metadataCache.saveEntry(newEntry);
                }
            }

            // Re-render with the new entries
            this.renderEntriesList(this.allEntries);
            console.log('[App] Quick sync - added', missing.length, 'entries, total now:', this.allEntries.length);

        } catch (error) {
            console.error('[App] Quick sync error:', error);
        }
    }

    /**
     * Extract title from dirname (e.g., "2026-01-09-hello-world" -> "hello world")
     */
    extractTitleFromDirname(dirname) {
        if (!dirname) return 'Untitled';
        const match = dirname.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
        return match ? match[1].replace(/-/g, ' ') : dirname;
    }

    /**
     * Extract date from dirname (e.g., "2026-01-09-hello" -> "2026-01-09")
     */
    extractDateFromDirname(dirname) {
        if (!dirname) return new Date().toISOString();
        const match = dirname.match(/^(\d{4}-\d{2}-\d{2})/);
        return match ? match[1] : new Date().toISOString();
    }

    /**
     * Background sync to detect new/modified/deleted entries
     */
    async syncEntriesInBackground() {
        console.log('[App] Starting background sync');

        try {
            // Get current filesystem state
            const dirList = await platform.listEntriesFast();
            console.log('[App] Sync - filesystem has', dirList.entries?.length || 0, 'entries');
            if (!dirList.success) return;

            // Compare with cache
            const changes = await window.metadataCache?.compareWithFilesystem(
                dirList.entries.map(e => ({ path: e.path, mtime: e.mtime }))
            );

            if (!changes) return;

            const { added, modified, deleted } = changes;
            console.log('[App] Sync changes - added:', added.length, 'modified:', modified.length, 'deleted:', deleted.length);

            // Handle deleted entries
            if (deleted.length > 0) {
                console.log('[App] Removing', deleted.length, 'deleted entries from cache');
                console.log('[App] First 3 deleted paths:', deleted.slice(0, 3));
                await window.metadataCache?.deleteEntries(deleted);
            }

            // Handle new and modified entries
            const toFetch = [...added, ...modified];
            if (toFetch.length > 0) {
                console.log('[App] Fetching metadata for', toFetch.length, 'new/modified entries');

                // Batch fetch metadata
                const BATCH_SIZE = 50;
                for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
                    const batch = toFetch.slice(i, i + BATCH_SIZE);
                    const result = await platform.batchGetMetadata(batch);

                    if (result.success && result.entries) {
                        await window.metadataCache?.saveEntries(result.entries);
                    }
                }
            }

            // Update cache metadata
            if (added.length > 0 || modified.length > 0 || deleted.length > 0) {
                await window.metadataCache?.updateMeta({
                    lastSync: Date.now()
                });

                // Refresh display from cache
                const refreshedEntries = await window.metadataCache?.getAllEntries();
                if (refreshedEntries && refreshedEntries.length > 0) {
                    this.allEntries = refreshedEntries;
                    this.renderEntriesList(refreshedEntries);
                    console.log('[App] Sidebar refreshed after background sync');
                }
            } else {
                console.log('[App] Background sync complete - no changes detected');
            }
        } catch (error) {
            console.error('[App] Background sync failed:', error);
        }
    }

    /**
     * Render entries list with virtualization (only visible items + buffer)
     */
    renderEntriesList(entries) {
        const INITIAL_RENDER = 50; // Only render first 50 entries initially

        this.dom.entriesList.innerHTML = '';
        this.allEntries = entries;

        // Apply current sort
        const sorted = this.sortEntries(entries);

        // Determine if we should group by date (only for date-based sorts)
        const useGroups = this.currentSort.startsWith('date-');
        let rendered = 0;

        if (useGroups) {
            // Grouped rendering for date-based sorting
            const groups = this.groupEntriesByDate(sorted);

            for (const [groupName, groupEntries] of Object.entries(groups)) {
                if (groupEntries.length === 0) continue;
                if (rendered >= INITIAL_RENDER) break;

                // Create group header
                const groupHeader = document.createElement('div');
                groupHeader.className = 'entry-group-header';
                groupHeader.textContent = groupName;
                this.dom.entriesList.appendChild(groupHeader);

                // Create entry items
                for (const entry of groupEntries) {
                    if (rendered >= INITIAL_RENDER) break;
                    this.renderEntryItem(entry);
                    rendered++;
                }
            }
        } else {
            // Flat list for title/modified sorting
            for (const entry of sorted) {
                if (rendered >= INITIAL_RENDER) break;
                this.renderEntryItem(entry);
                rendered++;
            }
        }

        this.renderedCount = rendered;

        // Add scroll listener for lazy loading more entries
        if (entries.length > INITIAL_RENDER) {
            this.dom.entriesList.removeEventListener('scroll', this._onEntriesScroll);
            this._onEntriesScroll = () => this.onEntriesListScroll();
            this.dom.entriesList.addEventListener('scroll', this._onEntriesScroll, { passive: true });
        }
    }

    /**
     * Render a single entry item
     */
    renderEntryItem(entry) {
        const item = document.createElement('div');
        item.className = 'entry-item';
        item.dataset.path = entry.path;

        // Use frontmatter title if available, otherwise extract from dirname
        let title = entry.title;
        if (!title) {
            const titleMatch = entry.dirname?.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
            title = titleMatch ? titleMatch[1].replace(/-/g, ' ') : (entry.dirname || 'Untitled');
        }

        // Extract date
        const dateMatch = entry.dirname?.match(/^(\d{4}-\d{2}-\d{2})/);
        const date = dateMatch ? dateMatch[1] : '';

        item.innerHTML = `
            <div class="entry-info">
                <div class="entry-title">${this.escapeHtml(title)}</div>
                <div class="entry-date">${date}</div>
            </div>
            <button class="btn-delete-entry" aria-label="Delete entry">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        `;

        // Click on entry info to load
        item.querySelector('.entry-info').addEventListener('click', () => {
            this.loadEntry(entry.path, entry.dirname, entry.entryUri);
        });

        // Click on delete button
        item.querySelector('.btn-delete-entry').addEventListener('click', (e) => {
            e.stopPropagation();
            this.confirmDeleteEntry(entry.path, entry.dirname, title, entry.entryUri);
        });

        this.dom.entriesList.appendChild(item);
    }

    /**
     * Handle scroll event for lazy loading more entries
     */
    onEntriesListScroll() {
        const list = this.dom.entriesList;
        const scrollBottom = list.scrollHeight - list.scrollTop - list.clientHeight;

        // Load more when within 200px of bottom
        if (scrollBottom < 200 && this.renderedCount < this.allEntries.length) {
            this.loadMoreEntries();
        }
    }

    /**
     * Load more entries as user scrolls
     */
    loadMoreEntries() {
        const BATCH = 50;
        const start = this.renderedCount;
        const end = Math.min(start + BATCH, this.allEntries.length);

        for (let i = start; i < end; i++) {
            this.renderEntryItem(this.allEntries[i]);
        }

        this.renderedCount = end;
        console.log('[App] Loaded more entries, now showing', this.renderedCount, 'of', this.allEntries.length);
    }

    // ===== Indexing Progress UI =====

    showIndexingProgress(progress, message) {
        if (this.dom.indexingOverlay) {
            this.dom.indexingOverlay.classList.remove('hidden');
        }
        if (this.dom.indexingMessage) {
            this.dom.indexingMessage.textContent = message || 'Building index...';
        }
        if (this.dom.indexingProgressFill) {
            this.dom.indexingProgressFill.style.width = `${Math.round(progress * 100)}%`;
        }
    }

    updateIndexingStatus(status) {
        if (this.dom.indexingStatus) {
            this.dom.indexingStatus.textContent = status;
        }
    }

    hideIndexingProgress() {
        if (this.dom.indexingOverlay) {
            this.dom.indexingOverlay.classList.add('hidden');
        }
    }

    groupEntriesByDate(entries) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        const monthAgo = new Date(today);
        monthAgo.setDate(monthAgo.getDate() - 30);

        const groups = {
            'Today': [],
            'Yesterday': [],
            'This Week': [],
            'This Month': [],
            'Earlier': []
        };

        for (const entry of entries) {
            const dateMatch = entry.dirname.match(/^(\d{4}-\d{2}-\d{2})/);
            if (!dateMatch) {
                groups['Earlier'].push(entry);
                continue;
            }

            const entryDate = new Date(dateMatch[1] + 'T00:00:00');

            if (entryDate >= today) {
                groups['Today'].push(entry);
            } else if (entryDate >= yesterday) {
                groups['Yesterday'].push(entry);
            } else if (entryDate >= weekAgo) {
                groups['This Week'].push(entry);
            } else if (entryDate >= monthAgo) {
                groups['This Month'].push(entry);
            } else {
                groups['Earlier'].push(entry);
            }
        }

        return groups;
    }

    confirmDeleteEntry(path, dirname, title, entryUri) {
        // Simple confirmation
        const confirmed = confirm(`Delete "${title}"?\n\nThis cannot be undone.`);
        if (confirmed) {
            this.deleteEntry(path, dirname, entryUri);
        }
    }

    async deleteEntry(path, dirname, entryUri) {
        try {
            const result = await platform.deleteEntry(path, entryUri);
            if (result.success) {
                // If we deleted the current entry, clear editor (don't auto-create new)
                if (this.currentEntry && this.currentEntry.path === path) {
                    this.currentEntry = null;
                    this.dom.editor.value = '';
                    this.dom.preview.innerHTML = '';
                    this.dom.headerTitle.textContent = 'At the Speed of Life';
                    this.dom.metaTitle.value = '';
                    this.dom.metaTags.value = '';
                    this.dom.metaDate.textContent = '';
                    this.updateWordCount();
                }

                // Remove from local entries array (don't reload entire list!)
                if (this.allEntries) {
                    this.allEntries = this.allEntries.filter(e => e.path !== path);
                    this.renderEntriesList(this.allEntries);
                }

                // Remove from cache
                if (window.metadataCache) {
                    await window.metadataCache.deleteEntry(path);
                }

                // Clear finder cache (will rebuild on next search)
                this.finderEntries = [];
                this.fuse = null;

                console.log('[App] Entry deleted:', path);
                platform.showToast('Entry deleted');
            } else {
                platform.showToast('Failed to delete entry');
            }
        } catch (error) {
            console.error('[App] Delete failed:', error);
            platform.showToast('Failed to delete entry');
        }
    }

    // ===== Entry Operations =====

    async createNewEntry() {
        try {
            const result = await platform.createEntry();
            if (!result.success) return;

            this.currentEntry = {
                path: result.path,
                dirname: result.dirname,
                entryUri: result.entryUri // SAF entry directory URI
            };

            // Set editor content
            this.dom.editor.value = result.content;
            this.lastSavedContent = result.content;

            // Parse and display metadata
            const parsed = frontmatter.parse(result.content);
            this.displayMetadata(parsed.data);

            // Update header
            this.dom.headerTitle.textContent = 'New Entry';

            // Render preview if in preview mode
            if (this.currentMode === 'preview') {
                await this.renderPreview();
            }

            // Add to sidebar locally (don't reload entire list)
            // loadEntriesList() is called separately in init()
            if (this.isInitialized && this.allEntries) {
                const newEntry = {
                    path: result.path,
                    dirname: result.dirname,
                    entryUri: result.entryUri,
                    title: 'New Entry',
                    date: new Date().toISOString(),
                    mtime: Date.now()
                };
                this.allEntries.unshift(newEntry);
                this.renderEntriesList(this.allEntries);

                // Save to metadata cache so it persists across restarts
                if (window.metadataCache) {
                    await window.metadataCache.saveEntry(newEntry);
                }
            }

            // Focus current editor
            this.focusCurrentEditor();
            // Don't close sidebar - let user close it manually

            this.updateWordCount(); // Updates status automatically
        } catch (error) {
            console.error('[App] Failed to create entry:', error);
        }
    }

    async loadEntry(path, dirname, entryUri) {
        try {
            const result = await platform.loadEntry(path);
            if (!result.success) return;

            this.currentEntry = { path, dirname, entryUri };

            // Set editor content
            this.dom.editor.value = result.content;
            this.lastSavedContent = result.content;

            // Parse and display metadata
            const parsed = frontmatter.parse(result.content);
            this.displayMetadata(parsed.data);

            // Update header and sidebar with frontmatter title (or fallback to dirname)
            const frontmatterTitle = parsed.data.title;
            const dirnameMatch = dirname.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
            const fallbackTitle = dirnameMatch ? dirnameMatch[1].replace(/-/g, ' ') : dirname;
            const title = frontmatterTitle || fallbackTitle;
            this.dom.headerTitle.textContent = title;
            this.updateSidebarEntryTitle(title);

            // Highlight active entry in list
            this.dom.entriesList.querySelectorAll('.entry-item').forEach(item => {
                item.classList.toggle('active', item.dataset.path === path);
            });

            // Re-render preview if in preview mode
            if (this.currentMode === 'preview') {
                await this.renderPreview();
            }

            // Focus current editor
            this.focusCurrentEditor();
            // Don't close sidebar - let user close it manually

            this.updateWordCount(); // Updates status automatically
        } catch (error) {
            console.error('[App] Failed to load entry:', error);
        }
    }

    displayMetadata(data) {
        this.dom.metaTitle.value = data.title || '';
        this.dom.metaTags.value = Array.isArray(data.tags) ? data.tags.join(', ') : '';
        this.dom.metaDate.textContent = data.date ? new Date(data.date).toLocaleString() : '';
    }

    // ===== Finder =====

    initFinder() {
        this.dom.btnFind.addEventListener('click', () => this.openFinder());
        this.dom.finderClose.addEventListener('click', () => this.closeFinder());
        this.dom.finder.addEventListener('click', (e) => {
            if (e.target === this.dom.finder) this.closeFinder();
        });

        this.finderSelectedIndex = 0;
        this.finderResults = [];
        this.finderEntries = [];
        this.fuse = null;
        this.finderDebounceTimer = null;
        this.finderIndexing = false;

        this.dom.finderInput.addEventListener('input', () => this.onFinderInputDebounced());
        this.dom.finderInput.addEventListener('keydown', (e) => this.onFinderKeydown(e));
    }

    /**
     * Debounced search input handler - prevents hammering search on every keystroke
     * Critical for Android performance with large directories
     */
    onFinderInputDebounced() {
        // Clear any pending search
        if (this.finderDebounceTimer) {
            clearTimeout(this.finderDebounceTimer);
        }

        // Debounce: wait 150ms after last keystroke before searching
        this.finderDebounceTimer = setTimeout(() => {
            this.onFinderInput();
        }, 150);
    }

    async initFinderIndex() {
        if (this.finderIndexing) {
            console.log('[Finder] Already indexing, skipping');
            return;
        }

        this.finderIndexing = true;
        console.log('[Finder] Building search index...');
        const startTime = performance.now();

        // Use cached entries from sidebar (already loaded on app init)
        // This is MUCH faster than calling platform.listEntries() which makes fresh native calls
        let sourceEntries = this.allEntries;

        // If sidebar entries not loaded yet, try metadata cache directly
        if (!sourceEntries || sourceEntries.length === 0) {
            console.log('[Finder] No sidebar entries, checking metadata cache...');
            if (window.metadataCache) {
                // Ensure cache is initialized
                if (!window.metadataCache.initialized) {
                    await window.metadataCache.init();
                }
                sourceEntries = await window.metadataCache.getAllEntries();
            }
        }

        // Last resort: fall back to platform.listEntries() (slow on Android)
        if (!sourceEntries || sourceEntries.length === 0) {
            console.log('[Finder] No cache available, falling back to platform.listEntries()');
            try {
                const result = await platform.listEntries();
                console.log('[Finder] listEntries result:', { success: result.success, count: result.entries?.length });
                if (result.success && result.entries) {
                    sourceEntries = result.entries;
                }
            } catch (error) {
                console.error('[Finder] listEntries failed:', error);
            }
        }

        // If still no entries, show empty state
        if (!sourceEntries || sourceEntries.length === 0) {
            console.log('[Finder] No entries found');
            this.finderIndexing = false;
            return;
        }

        console.log('[Finder] Using', sourceEntries.length, 'entries');

        this.finderEntries = [];

        for (const entry of sourceEntries) {
            // Use cached title or derive from dirname
            let title = entry.title;
            if (!title) {
                const titleMatch = entry.dirname?.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
                title = titleMatch ? titleMatch[1].replace(/-/g, ' ') : (entry.dirname || 'Untitled');
            }

            // Use cached date or extract from dirname
            let date = entry.date;
            if (!date && entry.dirname) {
                const dateMatch = entry.dirname.match(/^(\d{4}-\d{2}-\d{2})/);
                date = dateMatch ? dateMatch[1] : '';
            }

            // Use cached excerpt as content (already trimmed to 300 chars)
            // and cached tags - no need to load and parse files again
            const content = entry.excerpt || '';
            const tags = entry.tags || [];

            this.finderEntries.push({
                path: entry.path,
                dirname: entry.dirname,
                entryUri: entry.entryUri,
                title,
                date,
                tags,
                content
            });
        }

        // Initialize Fuse.js if available
        if (typeof Fuse !== 'undefined') {
            this.fuse = new Fuse(this.finderEntries, {
                keys: [
                    { name: 'title', weight: 0.4 },
                    { name: 'tags', weight: 0.3 },
                    { name: 'content', weight: 0.2 },
                    { name: 'date', weight: 0.1 }
                ],
                threshold: 0.4,
                ignoreLocation: true,
                includeScore: true,
                includeMatches: true
            });
            console.log('[Finder] Fuse.js initialized with', this.finderEntries.length, 'entries');
        } else {
            console.log('[Finder] Fuse.js not available, using fallback search');
        }

        const elapsed = (performance.now() - startTime).toFixed(0);
        console.log(`[Finder] Index built: ${this.finderEntries.length} entries in ${elapsed}ms`);
        console.log('[Finder] Sample entries:', this.finderEntries.slice(0, 3).map(e => ({ title: e.title, date: e.date, tagsCount: e.tags?.length, contentLen: e.content?.length })));

        this.finderIndexing = false;
    }

    async openFinder() {
        this.dom.finder.classList.remove('hidden');
        this.dom.finderInput.value = '';
        this.dom.finderInput.focus();
        this.finderSelectedIndex = 0;

        // Build index if needed (with loading state)
        if (this.finderEntries.length === 0 && !this.finderIndexing) {
            // Show loading message
            this.dom.finderResultsList.innerHTML = '<div class="finder-loading">Loading entries...</div>';
            this.dom.finderPreviewContent.innerHTML = '';

            await this.initFinderIndex();
        }

        this.loadFinderResults('');
    }

    closeFinder() {
        this.dom.finder.classList.add('hidden');
        this.focusCurrentEditor();
    }

    onFinderInput() {
        const query = this.dom.finderInput.value;
        console.log('[Finder] Input changed:', query);
        this.loadFinderResults(query);
    }

    loadFinderResults(query) {
        console.log('[Finder] loadFinderResults called:', { query, entriesCount: this.finderEntries?.length, hasFuse: !!this.fuse });
        let results;

        if (!query.trim()) {
            // Show all entries sorted by date
            results = this.finderEntries;
            console.log('[Finder] No query, showing all entries:', results?.length);
        } else if (this.fuse) {
            // Use Fuse.js for fuzzy search
            const fuseResults = this.fuse.search(query);
            results = fuseResults.map(r => r.item);
            console.log('[Finder] Fuse search results:', { query, resultsCount: results.length, topScores: fuseResults.slice(0, 3).map(r => ({ title: r.item.title, score: r.score })) });
        } else {
            // Fallback to simple matching
            const q = query.toLowerCase();
            results = this.finderEntries.filter(e => {
                const text = `${e.title} ${e.tags.join(' ')} ${e.content}`.toLowerCase();
                return text.includes(q) || this.fuzzyMatch(text, q);
            });
            console.log('[Finder] Fallback search results:', results.length);
        }

        this.finderResults = results;
        this.finderSelectedIndex = 0;
        this.renderFinderResults();
    }

    fuzzyMatch(text, query) {
        let qi = 0;
        for (let ti = 0; ti < text.length && qi < query.length; ti++) {
            if (text[ti] === query[qi]) qi++;
        }
        return qi === query.length;
    }

    renderFinderResults() {
        this.dom.finderResultsList.innerHTML = '';

        // Show message if no entries to display
        if (!this.finderResults || this.finderResults.length === 0) {
            const message = this.finderEntries.length === 0
                ? 'No entries available. Try creating a new entry first.'
                : 'No matching entries found.';
            this.dom.finderResultsList.innerHTML = `<div class="finder-loading">${message}</div>`;
            this.dom.finderPreviewContent.innerHTML = '';
            return;
        }

        this.finderResults.forEach((entry, index) => {
            const item = document.createElement('div');
            item.className = 'finder-result-item';
            if (index === this.finderSelectedIndex) {
                item.classList.add('selected');
            }

            // Use pre-parsed data from finderEntries
            const title = entry.title || entry.dirname;
            const date = entry.date || '';
            const tags = entry.tags || [];

            let tagsHtml = '';
            if (tags.length > 0) {
                tagsHtml = `<div class="finder-result-tags">${tags.map(t => '#' + this.escapeHtml(t)).join(' ')}</div>`;
            }

            item.innerHTML = `
                <div class="finder-result-title">${this.escapeHtml(title)}</div>
                <div class="finder-result-date">${date}</div>
                ${tagsHtml}
            `;

            item.addEventListener('click', () => {
                this.loadEntry(entry.path, entry.dirname, entry.entryUri);
                this.closeFinder();
            });

            item.addEventListener('mouseenter', () => {
                this.finderSelectedIndex = index;
                this.updateSelectedClass();
                this.updateFinderPreview(entry);
            });

            this.dom.finderResultsList.appendChild(item);
        });

        // Update preview for selected
        if (this.finderResults.length > 0) {
            this.updateFinderPreview(this.finderResults[this.finderSelectedIndex]);
        } else {
            this.dom.finderPreviewContent.innerHTML = '<div class="finder-preview-empty">No entries found</div>';
        }
    }

    updateSelectedClass() {
        const items = this.dom.finderResultsList.querySelectorAll('.finder-result-item');
        items.forEach((item, index) => {
            item.classList.toggle('selected', index === this.finderSelectedIndex);
        });
    }

    updateFinderPreview(entry) {
        // Use pre-loaded content if available
        if (entry.content) {
            const preview = entry.content.substring(0, 500);
            this.dom.finderPreviewContent.textContent = preview + (entry.content.length > 500 ? '...' : '');
        } else {
            this.dom.finderPreviewContent.innerHTML = '<div class="finder-preview-empty">No preview available</div>';
        }
    }

    onFinderKeydown(e) {
        if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
            e.preventDefault();
            this.finderSelectedIndex = Math.min(this.finderSelectedIndex + 1, this.finderResults.length - 1);
            this.updateSelectedClass();
            this.updateFinderPreview(this.finderResults[this.finderSelectedIndex]);
            this.scrollSelectedIntoView();
        } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
            e.preventDefault();
            this.finderSelectedIndex = Math.max(this.finderSelectedIndex - 1, 0);
            this.updateSelectedClass();
            this.updateFinderPreview(this.finderResults[this.finderSelectedIndex]);
            this.scrollSelectedIntoView();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (this.finderResults.length > 0) {
                const entry = this.finderResults[this.finderSelectedIndex];
                this.loadEntry(entry.path, entry.dirname, entry.entryUri);
                this.closeFinder();
            }
        } else if (e.key === 'Escape') {
            this.closeFinder();
        }
    }

    scrollSelectedIntoView() {
        const selected = this.dom.finderResultsList.querySelector('.finder-result-item.selected');
        if (selected) {
            selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    // ===== Settings Modal =====

    initSettingsModal() {
        this.dom.btnSettings.addEventListener('click', () => this.openSettings());
        this.dom.settingsClose.addEventListener('click', () => this.closeSettings());
        this.dom.settingsModal.querySelector('.modal-backdrop').addEventListener('click', () => this.closeSettings());

        // Directory chooser (works on both Electron and Capacitor/Android)
        if (this.dom.btnChooseDir) {
            this.dom.btnChooseDir.addEventListener('click', async () => {
                const result = await platform.pickDirectory();
                if (result.success) {
                    const displayPath = result.name || result.path || result.uri || 'Selected folder';
                    this.dom.settingEntriesDir.value = displayPath;

                    // Store the URI/path
                    await platform.setEntriesDir(result.uri || result.path);

                    // Reload entries from new location (will trigger rebuild since folder changed)
                    await this.loadEntriesList();

                    // Clear finder cache
                    this.finderEntries = [];
                    this.fuse = null;

                    platform.showToast('Journal folder updated');
                }
            });
        }

        // Rebuild index button
        if (this.dom.btnRebuildIndex) {
            this.dom.btnRebuildIndex.addEventListener('click', async () => {
                if (confirm('Rebuild the search index? This may take a moment for large journals.')) {
                    this.closeSettings();
                    await this.rebuildIndex();
                }
            });
        }

        // Theme change
        this.dom.settingTheme.addEventListener('change', async () => {
            this.settings.theme = this.dom.settingTheme.value;
            this.applyTheme(this.settings.theme);
            await this.saveSettings();
        });

        // Font size change
        this.dom.settingFontSize.addEventListener('change', async () => {
            this.settings.fontSize = this.dom.settingFontSize.value;
            this.applyFontSize(this.settings.fontSize);
            await this.saveSettings();
        });

        // Debug log buttons
        if (this.dom.downloadLogsBtn) {
            this.dom.downloadLogsBtn.addEventListener('click', () => this.downloadLogs());
        }
        if (this.dom.clearLogsBtn) {
            this.dom.clearLogsBtn.addEventListener('click', () => this.clearLogs());
        }
    }

    // ===== Debug Logging =====

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    async updateDebugLogStats() {
        console.log('[App] updateDebugLogStats called', {
            hasElement: !!this.dom.debugLogStats,
            hasLogger: !!window.debugLogger,
            loggerInitialized: window.debugLogger?.initialized
        });

        if (!this.dom.debugLogStats) {
            console.error('[App] debugLogStats element not found');
            return;
        }

        if (!window.debugLogger) {
            this.dom.debugLogStats.textContent = 'Logger not available';
            return;
        }

        // Ensure logger is initialized
        if (!window.debugLogger.initialized) {
            console.log('[App] Waiting for debugLogger to initialize...');
            await window.debugLogger.init();
        }

        try {
            const stats = await window.debugLogger.getStats();
            console.log('[App] Got log stats:', stats);
            this.dom.debugLogStats.innerHTML = `
                <div>Entries: <strong>${stats.totalCount}</strong></div>
                <div>Errors: <strong class="error-count">${stats.byLevel.error || 0}</strong> |
                     Warnings: <strong class="warn-count">${stats.byLevel.warn || 0}</strong></div>
                <div>Size: <strong>${this.formatBytes(stats.estimatedSize)}</strong></div>
            `;
        } catch (e) {
            console.error('[App] Failed to get debug log stats:', e);
            this.dom.debugLogStats.textContent = 'Error: ' + e.message;
        }
    }

    async downloadLogs() {
        if (!window.debugLogger) {
            platform.showToast('Debug logger not available');
            return;
        }
        try {
            const result = await window.debugLogger.downloadLogs();
            if (result.success) {
                if (result.message) {
                    platform.showToast(result.message);
                } else {
                    platform.showToast('Logs downloaded');
                }
            } else if (result.error) {
                platform.showToast('Failed: ' + result.error);
            }
        } catch (e) {
            console.error('Download logs failed:', e);
            platform.showToast('Failed to download logs');
        }
    }

    async clearLogs() {
        if (!confirm('Clear all debug logs?')) return;
        if (!window.debugLogger) return;
        try {
            await window.debugLogger.clearLogs();
            await this.updateDebugLogStats();
            platform.showToast('Logs cleared');
        } catch (e) {
            console.error('Clear logs failed:', e);
            platform.showToast('Failed to clear logs');
        }
    }

    openSettings() {
        this.dom.settingsModal.classList.remove('hidden');
        this.updateDebugLogStats();
        this.updateIndexStatus();
    }

    closeSettings() {
        this.dom.settingsModal.classList.add('hidden');
    }

    async updateIndexStatus() {
        if (!this.dom.indexStatus) return;

        try {
            const meta = await window.metadataCache?.getMeta();
            if (meta && meta.entryCount > 0) {
                const date = meta.lastSync ? new Date(meta.lastSync).toLocaleDateString() : 'Unknown';
                this.dom.indexStatus.textContent = `${meta.entryCount} entries indexed (${date})`;
            } else {
                this.dom.indexStatus.textContent = 'Not indexed';
            }
        } catch (e) {
            this.dom.indexStatus.textContent = 'Unknown';
        }
    }

    async rebuildIndex() {
        console.log('[App] Manual index rebuild requested');

        // Clear finder cache
        this.finderEntries = [];
        this.fuse = null;

        // Get current folder and rebuild
        const folderPath = await platform.getEntriesDir();
        await this.buildInitialIndex(folderPath);

        platform.showToast('Index rebuilt successfully');
    }

    // ===== Keyboard Shortcuts =====

    initKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Global shortcuts
            if (e.ctrlKey || e.metaKey) {
                switch (e.key.toLowerCase()) {
                    case 'k':
                    case 'p':
                        if (!e.shiftKey) {
                            e.preventDefault();
                            this.openFinder();
                        }
                        break;
                    case 'n':
                        e.preventDefault();
                        this.createNewEntry();
                        break;
                    case 's':
                        e.preventDefault();
                        this.saveCurrentEntry();
                        break;
                    case 'm':
                        e.preventDefault();
                        this.toggleMetadata();
                        break;
                    case 'b':
                        if (document.activeElement === this.dom.editor) {
                            e.preventDefault();
                            this.wrapSelection('**');
                        }
                        break;
                    case 'i':
                        if (document.activeElement === this.dom.editor) {
                            e.preventDefault();
                            this.wrapSelection('*');
                        }
                        break;
                }
            }

            // Escape to close modals
            if (e.key === 'Escape') {
                if (!this.dom.finder.classList.contains('hidden')) {
                    this.closeFinder();
                } else if (!this.dom.settingsModal.classList.contains('hidden')) {
                    this.closeSettings();
                }
            }
        });
    }

    // ===== File Watcher Callbacks =====

    onFileAdded(path) {
        console.log('[App] File added:', path);
        // Don't reload - cache syncs on app close for maximum speed during usage
    }

    onFileChanged(path) {
        console.log('[App] File changed:', path);
        // Don't reload - cache syncs on app close
    }

    onFileDeleted(path) {
        console.log('[App] File deleted:', path);
        // Don't reload - cache syncs on app close for maximum speed during usage
    }

    // ===== Utilities =====

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    focusCurrentEditor() {
        if (this.currentMode === 'preview') {
            // Focus the preview for WYSIWYG editing
            this.dom.preview.focus();

            // Move cursor to end
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(this.dom.preview);
            range.collapse(false); // false = collapse to end
            selection.removeAllRanges();
            selection.addRange(range);

            // On mobile, trigger keyboard
            if (platform.isMobile()) {
                setTimeout(() => {
                    this.dom.preview.focus();
                    this.dom.preview.click();
                }, 100);
            }
        } else {
            // Focus the source editor
            const editor = this.dom.editor;
            editor.focus();

            // Move cursor to end
            const len = editor.value.length;
            editor.setSelectionRange(len, len);

            // On mobile, trigger keyboard
            if (platform.isMobile()) {
                setTimeout(() => {
                    editor.focus();
                    editor.click();
                }, 100);
            }
        }
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
    window.app.init();
});
