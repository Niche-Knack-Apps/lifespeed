/**
 * MetadataCache - IndexedDB-based metadata caching for fast entry loading
 *
 * Purpose: Cache entry metadata (title, date, tags, excerpt) to avoid
 * expensive file reads on every app launch. The cache enables:
 * - Instant sidebar rendering from cache
 * - Background sync to detect new/changed/deleted entries
 * - Fast search without loading all files
 *
 * Schema:
 * - entries: { path, dirname, title, date, tags, mtime, excerpt, entryUri }
 * - meta: { id, lastSync, entryCount, version }
 */
class MetadataCache {
    constructor() {
        this.dbName = 'atsl-metadata';
        this.dbVersion = 2;
        this.db = null;
        this.initialized = false;
    }

    /**
     * Initialize the IndexedDB database
     */
    async init() {
        if (this.initialized) return true;

        try {
            this.db = await this._openDB();
            this.initialized = true;
            console.log('[MetadataCache] Initialized successfully');
            return true;
        } catch (error) {
            console.error('[MetadataCache] Failed to initialize:', error);
            return false;
        }
    }

    _openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                console.error('[MetadataCache] Failed to open database:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const oldVersion = event.oldVersion;

                // v1→v2: drop and recreate stores to clear stale entries without metadata
                if (oldVersion >= 1 && oldVersion < 2) {
                    if (db.objectStoreNames.contains('entries')) {
                        db.deleteObjectStore('entries');
                    }
                    if (db.objectStoreNames.contains('meta')) {
                        db.deleteObjectStore('meta');
                    }
                    console.log('[MetadataCache] Upgraded v1→v2: cleared stale cache');
                }

                // Create entries store
                if (!db.objectStoreNames.contains('entries')) {
                    const entriesStore = db.createObjectStore('entries', { keyPath: 'path' });
                    entriesStore.createIndex('dirname', 'dirname', { unique: false });
                    entriesStore.createIndex('mtime', 'mtime', { unique: false });
                    entriesStore.createIndex('date', 'date', { unique: false });
                    console.log('[MetadataCache] Created entries store');
                }

                // Create meta store
                if (!db.objectStoreNames.contains('meta')) {
                    db.createObjectStore('meta', { keyPath: 'id' });
                    console.log('[MetadataCache] Created meta store');
                }
            };
        });
    }

    /**
     * Get all cached entries
     * @returns {Promise<Array>} Array of entry metadata objects
     */
    async getAllEntries() {
        if (!this.db) return [];

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('entries', 'readonly');
            const store = tx.objectStore('entries');
            const request = store.getAll();

            request.onsuccess = () => {
                const entries = request.result || [];
                // Sort by mtime descending (newest first)
                // Handle both numeric timestamps and ISO strings
                entries.sort((a, b) => {
                    const mtimeA = typeof a.mtime === 'string' ? new Date(a.mtime).getTime() : (a.mtime || 0);
                    const mtimeB = typeof b.mtime === 'string' ? new Date(b.mtime).getTime() : (b.mtime || 0);
                    return mtimeB - mtimeA;
                });
                resolve(entries);
            };

            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get a single entry by path
     * @param {string} path - Entry path (SAF URI or file path)
     * @returns {Promise<Object|null>} Entry metadata or null
     */
    async getEntry(path) {
        if (!this.db) return null;

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('entries', 'readonly');
            const store = tx.objectStore('entries');
            const request = store.get(path);

            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Save a single entry
     * @param {Object} entry - Entry metadata object
     */
    async saveEntry(entry) {
        if (!this.db) return false;

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('entries', 'readwrite');
            const store = tx.objectStore('entries');
            const request = store.put(entry);

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Save multiple entries at once
     * @param {Array} entries - Array of entry metadata objects
     */
    async saveEntries(entries) {
        if (!this.db || !entries || entries.length === 0) return false;

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('entries', 'readwrite');
            const store = tx.objectStore('entries');

            for (const entry of entries) {
                store.put(entry);
            }

            tx.oncomplete = () => {
                console.log('[MetadataCache] Saved', entries.length, 'entries');
                resolve(true);
            };
            tx.onerror = () => reject(tx.error);
        });
    }

    /**
     * Delete an entry by path
     * @param {string} path - Entry path
     */
    async deleteEntry(path) {
        if (!this.db) return false;

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('entries', 'readwrite');
            const store = tx.objectStore('entries');
            const request = store.delete(path);

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Delete multiple entries by path
     * @param {Array<string>} paths - Array of entry paths
     */
    async deleteEntries(paths) {
        if (!this.db || !paths || paths.length === 0) return false;

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('entries', 'readwrite');
            const store = tx.objectStore('entries');

            for (const path of paths) {
                store.delete(path);
            }

            tx.oncomplete = () => {
                console.log('[MetadataCache] Deleted', paths.length, 'entries');
                resolve(true);
            };
            tx.onerror = () => reject(tx.error);
        });
    }

    /**
     * Clear all cached entries
     */
    async clearEntries() {
        if (!this.db) return false;

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('entries', 'readwrite');
            const store = tx.objectStore('entries');
            const request = store.clear();

            request.onsuccess = () => {
                console.log('[MetadataCache] Cleared all entries');
                resolve(true);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Get cache metadata
     * @returns {Promise<Object>} Meta object with lastSync, entryCount, version
     */
    async getMeta() {
        if (!this.db) return null;

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('meta', 'readonly');
            const store = tx.objectStore('meta');
            const request = store.get('cache');

            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Update cache metadata
     * @param {Object} updates - Partial meta object to merge
     */
    async updateMeta(updates) {
        if (!this.db) return false;

        const current = await this.getMeta() || { id: 'cache' };
        const updated = { ...current, ...updates, id: 'cache' };

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('meta', 'readwrite');
            const store = tx.objectStore('meta');
            const request = store.put(updated);

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Check if cache is fresh (less than maxAge ms old)
     * @param {number} maxAge - Maximum age in milliseconds (default: 1 hour)
     * @returns {Promise<boolean>}
     */
    async isCacheFresh(maxAge = 3600000) {
        const meta = await this.getMeta();
        if (!meta || !meta.lastSync) return false;

        const age = Date.now() - meta.lastSync;
        return age < maxAge;
    }

    /**
     * Check if cache exists for a specific folder
     * @param {string} folderPath - Folder path or URI
     * @returns {Promise<boolean>}
     */
    async hasCacheForFolder(folderPath) {
        const meta = await this.getMeta();
        if (!meta || !meta.folderPath) return false;

        // Normalize paths for comparison
        const cached = meta.folderPath.replace(/\/$/, '');
        const current = folderPath.replace(/\/$/, '');

        return cached === current && meta.entryCount > 0;
    }

    /**
     * Get the cached folder path
     * @returns {Promise<string|null>}
     */
    async getCachedFolderPath() {
        const meta = await this.getMeta();
        return meta?.folderPath || null;
    }

    /**
     * Get cached entry count
     * @returns {Promise<number>}
     */
    async getEntryCount() {
        if (!this.db) return 0;

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('entries', 'readonly');
            const store = tx.objectStore('entries');
            const request = store.count();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * Build a map of path -> mtime for efficient comparison
     * @returns {Promise<Map<string, number>>}
     */
    async getMtimeMap() {
        const entries = await this.getAllEntries();
        const map = new Map();
        for (const entry of entries) {
            map.set(entry.path, entry.mtime || 0);
        }
        return map;
    }

    /**
     * Normalize mtime to numeric timestamp
     */
    _normalizeMtime(mtime) {
        if (typeof mtime === 'string') {
            return new Date(mtime).getTime();
        }
        return mtime || 0;
    }

    /**
     * Compare current filesystem state with cache to find changes
     * @param {Array} currentEntries - Array of { path, mtime } from filesystem
     * @returns {Object} { added: [], modified: [], deleted: [] }
     */
    async compareWithFilesystem(currentEntries) {
        const cachedMap = await this.getMtimeMap();
        const currentMap = new Map();

        const added = [];
        const modified = [];

        // Check each current entry
        for (const entry of currentEntries) {
            currentMap.set(entry.path, entry.mtime);

            if (!cachedMap.has(entry.path)) {
                added.push(entry);
            } else {
                // Normalize both mtimes for comparison (handle string vs number)
                const cachedMtime = this._normalizeMtime(cachedMap.get(entry.path));
                const currentMtime = this._normalizeMtime(entry.mtime);
                if (cachedMtime !== currentMtime) {
                    modified.push(entry);
                }
            }
        }

        // Find deleted entries (in cache but not in current)
        const deleted = [];
        for (const [path] of cachedMap) {
            if (!currentMap.has(path)) {
                deleted.push(path);
            }
        }

        console.log('[MetadataCache] Comparison:', {
            added: added.length,
            modified: modified.length,
            deleted: deleted.length
        });

        return { added, modified, deleted };
    }

    /**
     * Search cached entries by title, tags, or excerpt
     * @param {string} query - Search query
     * @returns {Promise<Array>} Matching entries
     */
    async search(query) {
        const entries = await this.getAllEntries();
        if (!query.trim()) return entries;

        const q = query.toLowerCase();
        return entries.filter(entry => {
            const title = (entry.title || '').toLowerCase();
            const tags = (entry.tags || []).join(' ').toLowerCase();
            const excerpt = (entry.excerpt || '').toLowerCase();
            const dirname = (entry.dirname || '').toLowerCase();

            return title.includes(q) ||
                   tags.includes(q) ||
                   excerpt.includes(q) ||
                   dirname.includes(q);
        });
    }

    /**
     * Close the current database connection
     */
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
        this.initialized = false;
    }

    /**
     * Switch to a different journal's database
     * Closes current DB and opens the journal-specific one.
     * Default journal uses 'atsl-metadata' for backward compat.
     * @param {string} journalId - Journal identifier
     * @returns {Promise<boolean>}
     */
    async switchToJournal(journalId) {
        this.close();
        this.dbName = journalId === 'default' ? 'atsl-metadata' : `atsl-metadata-${journalId}`;
        console.log(`[MetadataCache] Switching to journal DB: ${this.dbName}`);
        return await this.init();
    }
}

// Global instance
const metadataCache = new MetadataCache();

// Auto-initialize when loaded in browser (CSP doesn't allow inline scripts)
if (typeof window !== 'undefined') {
    window.metadataCache = metadataCache;
    metadataCache.init();
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MetadataCache;
}
