/**
 * Platform Abstraction Layer for At the Speed of Life
 * Detects and abstracts platform-specific functionality for Electron, Capacitor, and Web
 */

class PlatformService {
    constructor() {
        this.platform = this._detectPlatform();
        this._capacitorPlugins = null;
        this._mobileBreakpoint = 768;
        console.log(`[Platform] Detected: ${this.platform}`);
    }

    _detectPlatform() {
        if (typeof window !== 'undefined' && window.api) {
            return 'electron';
        }
        if (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform()) {
            return 'capacitor';
        }
        return 'web';
    }

    isElectron() { return this.platform === 'electron'; }
    isCapacitor() { return this.platform === 'capacitor'; }
    isWeb() { return this.platform === 'web'; }
    isNative() { return this.isElectron() || this.isCapacitor(); }

    isMobile() {
        return this.isCapacitor() || window.innerWidth < this._mobileBreakpoint;
    }

    async _getCapacitorPlugins() {
        if (this._capacitorPlugins) return this._capacitorPlugins;

        if (this.isCapacitor()) {
            try {
                this._capacitorPlugins = {
                    Filesystem: window.Capacitor.Plugins.Filesystem,
                    Toast: window.Capacitor.Plugins.Toast,
                    Keyboard: window.Capacitor.Plugins.Keyboard,
                    FolderPicker: window.Capacitor.Plugins.FolderPicker
                };

                // Set up native log bridge to forward Android logs to DebugLogger
                if (this._capacitorPlugins.FolderPicker) {
                    this._capacitorPlugins.FolderPicker.addListener('nativeLog', (event) => {
                        if (window.debugLogger) {
                            window.debugLogger.log(event.level || 'debug', event.message, {
                                source: 'android-native',
                                tag: event.tag,
                                nativeTimestamp: event.timestamp
                            });
                        }
                    });
                    console.log('[Platform] Native log bridge initialized');
                }
            } catch (e) {
                console.warn('[Platform] Failed to load Capacitor plugins:', e);
                this._capacitorPlugins = {};
            }
        }
        return this._capacitorPlugins || {};
    }

    // ===== SAF Directory Picker (Android) =====

    async pickDirectory() {
        if (this.isCapacitor()) {
            const plugins = await this._getCapacitorPlugins();
            if (plugins.FolderPicker) {
                try {
                    const result = await plugins.FolderPicker.pickDirectory();
                    return result;
                } catch (e) {
                    console.error('[Platform] SAF directory pick failed:', e);
                    return { success: false, error: e.message };
                }
            }
        } else if (this.isElectron()) {
            return await window.api.chooseEntriesDir();
        }
        return { success: false, error: 'Directory picker not available' };
    }

    async setEntriesDir(uri) {
        if (this.isElectron()) {
            return await window.api.setEntriesDir(uri);
        } else {
            // Store in settings for Capacitor/Web
            const result = this._loadSettingsLocal();
            const settings = result.settings || {};
            settings.entriesDirectoryUri = uri;
            this._saveSettingsLocal(settings);
            console.log('[Platform] Saved entries directory:', uri);
            return { success: true };
        }
    }

    // ===== Entry Operations =====

    async createEntry(title) {
        if (this.isElectron()) {
            return await window.api.createEntry(title);
        } else if (this.isCapacitor()) {
            return await this._createEntryCapacitor(title);
        } else {
            return await this._createEntryWeb(title);
        }
    }

    async saveEntry(path, content) {
        if (this.isElectron()) {
            return await window.api.saveEntry(path, content);
        } else if (this.isCapacitor()) {
            return await this._saveEntryCapacitor(path, content);
        } else {
            return await this._saveEntryWeb(path, content);
        }
    }

    async loadEntry(path) {
        if (this.isElectron()) {
            return await window.api.loadEntry(path);
        } else if (this.isCapacitor()) {
            return await this._loadEntryCapacitor(path);
        } else {
            return await this._loadEntryWeb(path);
        }
    }

    async listEntries() {
        if (this.isElectron()) {
            return await window.api.listEntries();
        } else if (this.isCapacitor()) {
            return await this._listEntriesCapacitor();
        } else {
            return await this._listEntriesWeb();
        }
    }

    async deleteEntry(path, entryUri) {
        if (this.isElectron()) {
            return await window.api.deleteEntry(path);
        } else if (this.isCapacitor()) {
            return await this._deleteEntryCapacitor(path, entryUri);
        } else {
            return await this._deleteEntryWeb(path);
        }
    }

    // ===== Image Operations =====

    async pasteImage(base64Data, entry) {
        if (this.isElectron()) {
            // Electron expects the file path string
            const entryPath = typeof entry === 'string' ? entry : entry.path;
            return await window.api.pasteImage(base64Data, entryPath);
        } else if (this.isCapacitor()) {
            return await this._pasteImageCapacitor(base64Data, entry);
        } else {
            return await this._pasteImageWeb(base64Data, entry);
        }
    }

    async copyImage(sourcePath, entry) {
        if (this.isElectron()) {
            const entryPath = typeof entry === 'string' ? entry : entry.path;
            return await window.api.copyImage(sourcePath, entryPath);
        } else if (this.isCapacitor()) {
            return await this._copyImageCapacitor(sourcePath, entry);
        } else {
            // Web: read file as base64 and store
            return await this._pasteImageWeb(sourcePath, entry);
        }
    }

    // ===== File Attachment Operations =====

    async attachFile(sourcePath, entry, filename) {
        if (this.isElectron()) {
            const entryPath = typeof entry === 'string' ? entry : entry.path;
            return await window.api.attachFile(sourcePath, entryPath);
        } else if (this.isCapacitor()) {
            return await this._attachFileCapacitor(sourcePath, entry, filename);
        } else {
            return await this._attachFileWeb(sourcePath, entry, filename);
        }
    }

    // ===== Settings =====

    async loadSettings() {
        if (this.isElectron()) {
            return await window.api.loadSettings();
        } else {
            return this._loadSettingsLocal();
        }
    }

    async saveSettings(settings) {
        if (this.isElectron()) {
            return await window.api.saveSettings(settings);
        } else {
            return this._saveSettingsLocal(settings);
        }
    }

    async getEntriesDir() {
        if (this.isElectron()) {
            return await window.api.getEntriesDir();
        } else {
            const settings = this._loadSettingsLocal();
            // Use entriesDirectoryUri (set by SAF picker) or fall back to entriesDirectory
            return settings.settings?.entriesDirectoryUri || settings.settings?.entriesDirectory || 'journal';
        }
    }

    // ===== Search Index =====

    async loadIndex() {
        if (this.isElectron()) {
            return await window.api.loadIndex();
        } else {
            return this._loadIndexLocal();
        }
    }

    async saveIndex(indexData) {
        if (this.isElectron()) {
            return await window.api.saveIndex(indexData);
        } else {
            return this._saveIndexLocal(indexData);
        }
    }

    // ===== Image Reading (for preview) =====

    async readImage(entry, relativePath) {
        if (this.isElectron()) {
            // Electron: construct file:// URL
            const entryPath = typeof entry === 'string' ? entry : entry.path;
            const basePath = entryPath.replace('/index.md', '');
            return { success: true, dataUrl: `file://${basePath}/${relativePath}` };
        } else if (this.isCapacitor() && entry && entry.entryUri) {
            const plugins = await this._getCapacitorPlugins();
            if (plugins.FolderPicker) {
                try {
                    const result = await plugins.FolderPicker.readImage({
                        entryUri: entry.entryUri,
                        relativePath: relativePath
                    });
                    return result;
                } catch (e) {
                    console.error('[Platform] SAF readImage error:', e);
                    return { success: false, error: e.message };
                }
            }
        }
        // Web/fallback: return relative path (works if same origin)
        return { success: true, dataUrl: relativePath };
    }

    // ===== Keyboard Control =====

    async showKeyboard() {
        if (this.isCapacitor()) {
            const plugins = await this._getCapacitorPlugins();
            if (plugins.Keyboard?.show) {
                try {
                    await plugins.Keyboard.show();
                    console.log('[Platform] Keyboard.show() called');
                } catch (e) {
                    console.warn('[Platform] Keyboard.show() failed:', e);
                }
            }
        }
    }

    // ===== Toast Notifications =====

    async showToast(message, duration = 'short') {
        if (this.isCapacitor()) {
            const plugins = await this._getCapacitorPlugins();
            if (plugins.Toast) {
                await plugins.Toast.show({ text: message, duration });
            }
        } else {
            // Show simple notification for other platforms
            this._showWebToast(message);
        }
    }

    _showWebToast(message) {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    // ===== File Watcher =====

    setupFileWatcher(callbacks) {
        if (this.isElectron() && window.api) {
            if (callbacks.onAdded) window.api.onFileAdded(callbacks.onAdded);
            if (callbacks.onChanged) window.api.onFileChanged(callbacks.onChanged);
            if (callbacks.onDeleted) window.api.onFileDeleted(callbacks.onDeleted);
            window.api.startWatcher();
        }
    }

    // ===== Web/IndexedDB Fallbacks =====

    _getDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('at-the-speed-of-life', 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('entries')) {
                    db.createObjectStore('entries', { keyPath: 'path' });
                }
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('index')) {
                    db.createObjectStore('index', { keyPath: 'id' });
                }
            };
        });
    }

    async _createEntryWeb(title) {
        const now = new Date();
        const date = now.toISOString().slice(0, 10);
        const time = now.toTimeString().slice(0, 8).replace(/:/g, '-');
        const slug = title ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50) : time;
        const dirname = `${date}-${slug}`;
        const path = `${dirname}/index.md`;

        const content = `---
title: "${title || ''}"
date: ${now.toISOString()}
lastmod: ${now.toISOString()}
tags: []
draft: false
---

`;

        const db = await this._getDB();
        const tx = db.transaction('entries', 'readwrite');
        const store = tx.objectStore('entries');
        await store.put({ path, content, dirname, mtime: now.toISOString() });

        return { success: true, path, dirname, content };
    }

    async _saveEntryWeb(path, content) {
        try {
            const db = await this._getDB();
            const tx = db.transaction('entries', 'readwrite');
            const store = tx.objectStore('entries');

            // Get existing entry or create new one
            let entry = await this._promisifyRequest(store.get(path));
            const now = new Date().toISOString();

            if (entry) {
                entry.content = content;
                entry.mtime = now;
            } else {
                // Create new entry if it doesn't exist
                const dirname = path.replace('/index.md', '');
                entry = { path, content, dirname, mtime: now };
            }

            await this._promisifyRequest(store.put(entry));
            console.log('[Platform] Entry saved:', path);
            return { success: true };
        } catch (e) {
            console.error('[Platform] Save failed:', e);
            return { success: false, error: e.message };
        }
    }

    async _loadEntryWeb(path) {
        const db = await this._getDB();
        const tx = db.transaction('entries', 'readonly');
        const store = tx.objectStore('entries');
        const entry = await this._promisifyRequest(store.get(path));
        return entry ? { success: true, content: entry.content } : { success: false };
    }

    async _listEntriesWeb() {
        const db = await this._getDB();
        const tx = db.transaction('entries', 'readonly');
        const store = tx.objectStore('entries');
        const entries = await this._promisifyRequest(store.getAll());
        return {
            success: true,
            entries: entries.map(e => ({ path: e.path, dirname: e.dirname, mtime: e.mtime }))
                .sort((a, b) => new Date(b.mtime) - new Date(a.mtime))
        };
    }

    async _deleteEntryWeb(path) {
        const db = await this._getDB();
        const tx = db.transaction('entries', 'readwrite');
        const store = tx.objectStore('entries');
        await store.delete(path);
        return { success: true };
    }

    async _pasteImageWeb(base64Data, entryPath) {
        // In web mode, store as data URL in the entry content
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `${timestamp}.png`;
        return {
            success: true,
            filename,
            relativePath: `images/${filename}`,
            markdown: `![](${base64Data})` // Store as data URL for web
        };
    }

    _loadSettingsLocal() {
        try {
            const stored = localStorage.getItem('atsl-settings');
            return { success: true, settings: stored ? JSON.parse(stored) : this._defaultSettings() };
        } catch {
            return { success: true, settings: this._defaultSettings() };
        }
    }

    _saveSettingsLocal(settings) {
        try {
            localStorage.setItem('atsl-settings', JSON.stringify(settings));
            return { success: true };
        } catch {
            return { success: false };
        }
    }

    _loadIndexLocal() {
        try {
            const stored = localStorage.getItem('atsl-search-index');
            return { success: true, index: stored ? JSON.parse(stored) : null };
        } catch {
            return { success: true, index: null };
        }
    }

    _saveIndexLocal(indexData) {
        try {
            localStorage.setItem('atsl-search-index', JSON.stringify(indexData));
            return { success: true };
        } catch {
            return { success: false };
        }
    }

    _defaultSettings() {
        return {
            theme: 'system',
            fontSize: 'medium',
            autoSave: true,
            autoSaveDelay: 500,
            showMetadata: false,
            createOnLaunch: true
        };
    }

    _promisifyRequest(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // ===== Capacitor Implementations =====

    async _getEntriesDirectoryUri() {
        const result = this._loadSettingsLocal();
        const uri = result.settings?.entriesDirectoryUri || null;
        console.log('[Platform] Getting entries directory URI:', uri);
        return uri;
    }

    async _createEntryCapacitor(title) {
        const baseUri = await this._getEntriesDirectoryUri();

        // If no SAF directory is set, use IndexedDB fallback
        if (!baseUri) {
            console.log('[Platform] No SAF directory set, using IndexedDB fallback');
            return this._createEntryWeb(title);
        }

        const plugins = await this._getCapacitorPlugins();
        if (!plugins.FolderPicker) {
            return this._createEntryWeb(title);
        }

        try {
            const now = new Date();
            const date = now.toISOString().slice(0, 10);
            const time = now.toTimeString().slice(0, 8).replace(/:/g, '-');
            const slug = title ? title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50) : time;
            const dirname = `${date}-${slug}`;

            const content = `---
title: "${title || ''}"
date: ${now.toISOString()}
lastmod: ${now.toISOString()}
tags: []
draft: false
---

`;

            const result = await plugins.FolderPicker.createEntry({
                uri: baseUri,
                dirname: dirname,
                content: content
            });

            if (result.success) {
                return {
                    success: true,
                    path: result.indexUri,
                    dirname: dirname,
                    content: content,
                    entryUri: result.uri
                };
            } else {
                console.error('[Platform] SAF createEntry failed:', result.error);
                return this._createEntryWeb(title);
            }
        } catch (e) {
            console.error('[Platform] SAF createEntry error:', e);
            return this._createEntryWeb(title);
        }
    }

    async _saveEntryCapacitor(path, content) {
        const plugins = await this._getCapacitorPlugins();

        // Check if path is a SAF URI
        if (path && path.startsWith('content://') && plugins.FolderPicker) {
            try {
                const result = await plugins.FolderPicker.writeFile({
                    uri: path,
                    content: content
                });
                return result;
            } catch (e) {
                console.error('[Platform] SAF save error:', e);
            }
        }

        // Fallback to IndexedDB
        return this._saveEntryWeb(path, content);
    }

    async _loadEntryCapacitor(path) {
        const plugins = await this._getCapacitorPlugins();

        // Check if path is a SAF URI
        if (path && path.startsWith('content://') && plugins.FolderPicker) {
            try {
                const result = await plugins.FolderPicker.readFile({
                    uri: path
                });
                return result;
            } catch (e) {
                console.error('[Platform] SAF load error:', e);
            }
        }

        // Fallback to IndexedDB
        return this._loadEntryWeb(path);
    }

    async _listEntriesCapacitor() {
        const baseUri = await this._getEntriesDirectoryUri();

        // If no SAF directory is set, use IndexedDB fallback
        if (!baseUri) {
            return this._listEntriesWeb();
        }

        const plugins = await this._getCapacitorPlugins();
        if (!plugins.FolderPicker) {
            return this._listEntriesWeb();
        }

        try {
            const result = await plugins.FolderPicker.listEntries({
                uri: baseUri
            });

            if (result.success) {
                // Transform entries to match expected format
                const entries = result.entries.map(e => ({
                    path: e.indexUri,
                    dirname: e.dirname,
                    mtime: e.mtime,
                    entryUri: e.uri,
                    title: e.title || null  // Pass through frontmatter title
                }));

                // Sort by mtime descending
                entries.sort((a, b) => b.mtime - a.mtime);

                return { success: true, entries };
            } else {
                console.error('[Platform] SAF listEntries failed:', result.error);
                return this._listEntriesWeb();
            }
        } catch (e) {
            console.error('[Platform] SAF listEntries error:', e);
            return this._listEntriesWeb();
        }
    }

    async _deleteEntryCapacitor(path, entryUri) {
        // Use native SAF delete if we have an entryUri
        if (entryUri) {
            const plugins = await this._getCapacitorPlugins();
            if (plugins.FolderPicker) {
                try {
                    const result = await plugins.FolderPicker.deleteEntry({
                        entryUri: entryUri
                    });
                    return result;
                } catch (e) {
                    console.error('[Platform] SAF deleteEntry error:', e);
                    return { success: false, error: e.message };
                }
            }
        }
        // Fallback to IndexedDB delete
        return this._deleteEntryWeb(path);
    }

    async _pasteImageCapacitor(base64Data, entry) {
        const plugins = await this._getCapacitorPlugins();

        // If entry contains an entryUri, use SAF
        if (entry && entry.entryUri && plugins.FolderPicker) {
            try {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                const filename = `${timestamp}.png`;

                const result = await plugins.FolderPicker.saveImage({
                    entryUri: entry.entryUri,
                    base64Data: base64Data,
                    filename: filename
                });

                return result;
            } catch (e) {
                console.error('[Platform] SAF saveImage error:', e);
            }
        }

        // Fallback to data URL
        return this._pasteImageWeb(base64Data, entry);
    }

    async _copyImageCapacitor(file, entry) {
        // Read file as base64 and save via SAF
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const base64Data = e.target.result;
                const result = await this._pasteImageCapacitor(base64Data, entry);
                resolve(result);
            };
            reader.onerror = () => {
                resolve({ success: false, error: 'Failed to read file' });
            };
            reader.readAsDataURL(file);
        });
    }

    async _attachFileCapacitor(file, entry, filename) {
        const plugins = await this._getCapacitorPlugins();

        console.log('[Platform] _attachFileCapacitor called:', {
            hasFile: !!file,
            fileName: file?.name,
            hasEntry: !!entry,
            entryUri: entry?.entryUri,
            hasPlugin: !!plugins.FolderPicker
        });

        // If entry contains an entryUri, use SAF
        if (entry && entry.entryUri && plugins.FolderPicker) {
            try {
                // Read file as base64
                const base64Data = await this._fileToBase64(file);
                console.log('[Platform] File read as base64, length:', base64Data?.length);

                const result = await plugins.FolderPicker.saveFile({
                    entryUri: entry.entryUri,
                    base64Data: base64Data,
                    filename: filename || file.name
                });

                console.log('[Platform] saveFile result:', result);
                return result;
            } catch (e) {
                console.error('[Platform] SAF saveFile error:', e);
            }
        } else {
            console.warn('[Platform] Missing entryUri or plugin, falling back to web storage');
        }

        // Fallback to web storage
        return this._attachFileWeb(file, entry, filename);
    }

    async _attachFileWeb(file, entry, filename) {
        // In web mode, we can't truly copy files - just create a reference
        const name = filename || file.name;
        return {
            success: true,
            filename: name,
            relativePath: `files/${name}`,
            markdown: `[${name}](files/${name})`
        };
    }

    _fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    // ===== Fast Entry Listing (for cache comparison) =====

    /**
     * Fast list of entries - only returns dirname, uri, mtime (no file content)
     * Used for comparing with cache to detect new/modified/deleted entries
     */
    async listEntriesFast() {
        if (this.isCapacitor()) {
            const baseUri = await this._getEntriesDirectoryUri();
            if (!baseUri) {
                console.warn('[Platform] No entries directory set');
                return { success: false, error: 'No entries directory set', entries: [] };
            }

            const plugins = await this._getCapacitorPlugins();
            if (plugins.FolderPicker) {
                try {
                    const result = await plugins.FolderPicker.listEntriesFast({ uri: baseUri });
                    if (result.success) {
                        // Transform entries to standard format
                        const entries = result.entries.map(e => ({
                            path: e.indexUri,
                            dirname: e.dirname,
                            mtime: e.mtime,
                            entryUri: e.uri,
                            indexUri: e.indexUri
                        }));
                        return { success: true, entries, count: result.count };
                    }
                    return result;
                } catch (e) {
                    console.error('[Platform] listEntriesFast error:', e);
                    return { success: false, error: e.message, entries: [] };
                }
            }
        }

        // Fallback to regular listEntries for Electron/Web
        return this.listEntries();
    }

    /**
     * Batch read metadata for multiple entries
     * @param {Array} entries - Array of { indexUri, dirname, uri, mtime }
     * @returns {Promise<Object>} { success, entries: Array<metadata> }
     */
    async batchGetMetadata(entries) {
        if (!entries || entries.length === 0) {
            return { success: true, entries: [] };
        }

        if (this.isCapacitor()) {
            const plugins = await this._getCapacitorPlugins();
            if (plugins.FolderPicker) {
                try {
                    // Transform to native format
                    const nativeEntries = entries.map(e => ({
                        indexUri: e.indexUri || e.path,
                        dirname: e.dirname,
                        uri: e.entryUri,
                        mtime: e.mtime
                    }));

                    const result = await plugins.FolderPicker.batchGetMetadata({
                        entries: nativeEntries
                    });

                    if (result.success) {
                        return {
                            success: true,
                            entries: result.entries,
                            count: result.count
                        };
                    }
                    return result;
                } catch (e) {
                    console.error('[Platform] batchGetMetadata error:', e);
                    return { success: false, error: e.message, entries: [] };
                }
            }
        }

        // Fallback for Electron/Web - load entries individually
        const results = [];
        for (const entry of entries) {
            try {
                const loadResult = await this.loadEntry(entry.path || entry.indexUri);
                if (loadResult.success) {
                    const parsed = window.frontmatter?.parse(loadResult.content) || {};
                    results.push({
                        path: entry.path || entry.indexUri,
                        dirname: entry.dirname,
                        entryUri: entry.entryUri,
                        mtime: entry.mtime,
                        title: parsed.data?.title || '',
                        date: parsed.data?.date || '',
                        tags: parsed.data?.tags || [],
                        excerpt: (parsed.body || '').substring(0, 300)
                    });
                }
            } catch (e) {
                console.warn('[Platform] Failed to get metadata for:', entry.dirname);
            }
        }

        return { success: true, entries: results };
    }

    // ===== File Picker =====

    async pickImage() {
        if (this.isCapacitor()) {
            const plugins = await this._getCapacitorPlugins();
            if (plugins.FolderPicker) {
                try {
                    const result = await plugins.FolderPicker.pickImage();
                    return result;
                } catch (e) {
                    console.error('[Platform] pickImage error:', e);
                    return { success: false, error: e.message };
                }
            }
        }
        // Electron/Web: use HTML input (handled in app.js)
        return { success: false, error: 'Use HTML file input' };
    }

    async pickFile() {
        if (this.isCapacitor()) {
            const plugins = await this._getCapacitorPlugins();
            if (plugins.FolderPicker) {
                try {
                    const result = await plugins.FolderPicker.pickFile();
                    return result;
                } catch (e) {
                    console.error('[Platform] pickFile error:', e);
                    return { success: false, error: e.message };
                }
            }
        }
        // Electron/Web: use HTML input (handled in app.js)
        return { success: false, error: 'Use HTML file input' };
    }
}

// Global instance
const platform = new PlatformService();
