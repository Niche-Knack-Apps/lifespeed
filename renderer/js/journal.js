/**
 * Journal Manager for Lifespeed
 * Manages multiple journal locations, switching, and persistence.
 * Each journal = a filesystem directory with markdown entries.
 */

class JournalManager {
    constructor() {
        this.journals = [];
        this.activeJournal = null;
    }

    /**
     * Initialize from settings. Call after settings are loaded.
     * @param {Object} settings - App settings object
     */
    init(settings) {
        this.journals = platform.getJournalsFromSettings(settings);
        const activeId = platform.getActiveJournalId(settings);
        this.activeJournal = this.journals.find(j => j.id === activeId) || this.journals[0] || null;
        console.log('[JournalManager] Initialized with', this.journals.length, 'journals, active:', this.activeJournal?.id);
    }

    getActiveJournal() {
        return this.activeJournal;
    }

    getActiveJournalId() {
        return this.activeJournal?.id || 'default';
    }

    getActiveJournalPath() {
        return this.activeJournal?.path || null;
    }

    getActiveJournalName() {
        return this.activeJournal?.name || 'Journal';
    }

    getJournals() {
        return this.journals;
    }

    getJournalById(id) {
        return this.journals.find(j => j.id === id) || null;
    }

    /**
     * Switch to a different journal.
     * Handles metadata cache swap and search reset.
     * Caller is responsible for UI updates (sidebar, editor, etc).
     * @param {string} journalId
     * @returns {Object|null} The new active journal, or null if not found
     */
    async switchJournal(journalId) {
        const journal = this.journals.find(j => j.id === journalId);
        if (!journal) {
            console.error('[JournalManager] Journal not found:', journalId);
            return null;
        }
        if (journal.id === this.activeJournal?.id) return journal;

        console.log('[JournalManager] Switching from', this.activeJournal?.id, 'to', journal.id);

        // Close current metadata cache DB
        if (window.metadataCache) {
            window.metadataCache.close();
        }

        // Update active journal
        this.activeJournal = journal;

        // Open new journal's metadata cache DB
        if (window.metadataCache) {
            await window.metadataCache.switchToJournal(journal.id);
        }

        // Reset search (lazy-load on next search)
        search.reset();

        return journal;
    }

    /**
     * Add a new journal
     * @param {string} name - Display name
     * @param {string} path - Filesystem path
     * @returns {Object} The new journal
     */
    addJournal(name, path) {
        const id = this._generateId(name);
        const journal = { id, name, path };
        this.journals.push(journal);
        console.log('[JournalManager] Added journal:', id, name, path);
        return journal;
    }

    /**
     * Remove a journal from the list.
     * Does NOT delete files from disk.
     * @param {string} id - Journal ID to remove
     * @returns {boolean} Whether the removal succeeded
     */
    removeJournal(id) {
        if (this.journals.length <= 1) return false; // Must keep at least one
        if (id === this.activeJournal?.id) return false; // Can't remove active
        this.journals = this.journals.filter(j => j.id !== id);
        console.log('[JournalManager] Removed journal:', id);
        return true;
    }

    /**
     * Rename a journal's display name
     */
    renameJournal(id, newName) {
        const journal = this.journals.find(j => j.id === id);
        if (journal) {
            journal.name = newName;
            console.log('[JournalManager] Renamed journal:', id, 'to', newName);
        }
    }

    /**
     * Generate a settings-safe ID from a name
     */
    _generateId(name) {
        const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
        // Ensure unique
        if (!this.journals.some(j => j.id === base)) return base || `journal-${Date.now().toString(36)}`;
        return `${base}-${Date.now().toString(36)}`;
    }

    /**
     * Serialize journal state for settings persistence
     */
    toSettingsData() {
        return {
            activeJournal: this.activeJournal?.id || 'default',
            journals: this.journals
        };
    }
}

// Global instance
const journalManager = new JournalManager();
