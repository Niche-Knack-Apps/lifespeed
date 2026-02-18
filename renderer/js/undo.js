/**
 * UndoManager - Snapshot-based undo/redo for Lifespeed editor
 *
 * Stores full markdown strings. Source of truth is always the textarea value.
 * Debounces rapid typing into coalesced snapshots.
 */
class UndoManager {
    constructor() {
        this.stack = [];
        this.index = -1;
        this.maxSnapshots = 100;
        this.debounceMs = 500;
        this.debounceTimer = null;
        this.pendingContent = null;
    }

    /**
     * Set initial state (called on entry load/create)
     */
    init(content) {
        this.clear();
        this.stack.push(content);
        this.index = 0;
    }

    /**
     * Record a change (debounced). Coalesces rapid typing.
     */
    record(content) {
        // Skip if content hasn't actually changed from current snapshot
        if (this.index >= 0 && content === this.stack[this.index]) return;

        this.pendingContent = content;
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this._commit(), this.debounceMs);
    }

    /**
     * Force-commit pending debounced snapshot (e.g., before mode switch)
     */
    flush() {
        if (this.pendingContent !== null) {
            clearTimeout(this.debounceTimer);
            this._commit();
        }
    }

    /**
     * Undo — returns restored content string, or null if at boundary
     */
    undo() {
        this.flush();
        if (this.index <= 0) return null;
        this.index--;
        return this.stack[this.index];
    }

    /**
     * Redo — returns restored content string, or null if at boundary
     */
    redo() {
        this.flush();
        if (this.index >= this.stack.length - 1) return null;
        this.index++;
        return this.stack[this.index];
    }

    /**
     * Reset on entry switch
     */
    clear() {
        this.stack = [];
        this.index = -1;
        this.pendingContent = null;
        clearTimeout(this.debounceTimer);
    }

    /**
     * Internal: commit pending content to the stack
     */
    _commit() {
        const content = this.pendingContent;
        this.pendingContent = null;
        if (content === null) return;

        // Skip duplicate of current position
        if (this.index >= 0 && content === this.stack[this.index]) return;

        // Discard any redo history beyond current position
        this.stack.splice(this.index + 1);

        // Push new snapshot
        this.stack.push(content);
        this.index = this.stack.length - 1;

        // Enforce max size — drop oldest snapshots
        if (this.stack.length > this.maxSnapshots) {
            const overflow = this.stack.length - this.maxSnapshots;
            this.stack.splice(0, overflow);
            this.index -= overflow;
        }
    }
}
