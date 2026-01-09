/**
 * DebugLogger - Cross-platform debug logging system
 *
 * Features:
 * - Auto-intercepts console.log/warn/error/info/debug
 * - Platform detection (Electron vs Capacitor vs Web)
 * - IndexedDB storage (Capacitor/Web) or file storage (Electron via IPC)
 * - Log rotation (FIFO when > maxEntries)
 * - Export as .log file with Web Share API on mobile
 * - Session tracking
 *
 * Usage:
 *   window.debugLogger = new DebugLogger({ appName: 'MyApp' });
 *   await window.debugLogger.init();
 *
 * @version 1.0.0
 * @license MIT
 */
class DebugLogger {
  constructor(options = {}) {
    // Configuration
    this.config = {
      appName: options.appName || 'App',
      maxEntries: options.maxEntries || 500,
      maxSizeBytes: options.maxSizeBytes || 1024 * 1024, // 1MB
      dbName: options.dbName || 'debug-logs',
      storeName: 'logs',
      enabled: options.enabled !== false
    };

    // State
    this.sessionId = this._generateSessionId();
    this.sessionLogs = [];
    this.initialized = false;
    this.db = null;

    // Platform detection
    this.isElectron = typeof window !== 'undefined' &&
                      typeof window.api !== 'undefined';
    this.isCapacitor = typeof window !== 'undefined' &&
                       typeof window.Capacitor !== 'undefined' &&
                       window.Capacitor.isNativePlatform?.();

    // Original console methods (for restoration and internal use)
    this._originalConsole = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      info: console.info.bind(console),
      debug: console.debug.bind(console)
    };
  }

  // ========== Public API ==========

  /**
   * Initialize the logger
   */
  async init() {
    if (this.initialized) return;

    try {
      // Re-check platform detection (window.api may not have been ready at construction)
      this.isElectron = typeof window !== 'undefined' && typeof window.api !== 'undefined';
      this.isCapacitor = typeof window !== 'undefined' &&
                         typeof window.Capacitor !== 'undefined' &&
                         window.Capacitor.isNativePlatform?.();

      this._originalConsole.log('[DebugLogger] Platform detection:', {
        isElectron: this.isElectron,
        isCapacitor: this.isCapacitor,
        hasApi: typeof window.api !== 'undefined',
        hasAppendLog: typeof window.api?.appendLog === 'function'
      });

      // Setup storage based on platform
      if (this.isElectron) {
        this._log('info', '[DebugLogger] Using Electron file storage');
      } else {
        await this._initIndexedDB();
        this._log('info', '[DebugLogger] Using IndexedDB storage');
      }

      // Intercept console methods
      if (this.config.enabled) {
        this._interceptConsole();
      }

      // Log session start
      await this.log('info', `Session started: ${this.config.appName}`, {
        platform: this._getPlatform(),
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString()
      });

      this.initialized = true;
    } catch (error) {
      this._originalConsole.error('[DebugLogger] Initialization failed:', error);
    }
  }

  /**
   * Log a message
   * @param {string} level - 'info' | 'warn' | 'error' | 'debug'
   * @param {string} message - The message to log
   * @param {object} meta - Optional metadata
   */
  async log(level, message, meta = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level: level,
      message: String(message),
      sessionId: this.sessionId,
      source: meta.source || 'app',
      ...meta
    };

    // Add stack trace for errors
    if (level === 'error') {
      entry.stack = this._getStackTrace();
    }

    // Add to session buffer
    this.sessionLogs.push(entry);

    // Trim session buffer if needed
    if (this.sessionLogs.length > this.config.maxEntries) {
      this.sessionLogs = this.sessionLogs.slice(-this.config.maxEntries);
    }

    // Persist to storage
    try {
      await this._persist(entry);
    } catch (error) {
      this._originalConsole.error('[DebugLogger] Persist failed:', error);
    }
  }

  /**
   * Get all logs with optional filtering
   * @param {object} options - { limit, level, sessionId }
   * @returns {Promise<Array>} Array of log entries
   */
  async getLogs(options = {}) {
    const { limit = 1000, level = null, sessionId = null } = options;

    if (this.isElectron && window.api?.getLogs) {
      return await window.api.getLogs({ limit, level, sessionId });
    }

    if (!this.db) return this.sessionLogs;

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.config.storeName, 'readonly');
      const store = tx.objectStore(this.config.storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        let logs = request.result || [];

        // Apply filters
        if (level) {
          logs = logs.filter(l => l.level === level);
        }
        if (sessionId) {
          logs = logs.filter(l => l.sessionId === sessionId);
        }

        // Sort by timestamp descending, limit
        logs = logs
          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
          .slice(0, limit);

        resolve(logs);
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Export logs as downloadable file
   * @returns {Promise<{success: boolean, filename?: string, error?: string}>}
   */
  async downloadLogs() {
    try {
      const logs = await this.getLogs({ limit: this.config.maxEntries });
      const content = this._formatLogsForExport(logs);
      const filename = `${this.config.appName.toLowerCase().replace(/\s+/g, '-')}-logs-${this._formatDate()}.log`;

      // Use platform-appropriate download method
      if (this.isElectron && window.api?.saveLogFile) {
        const result = await window.api.saveLogFile(content, filename);
        return result;
      } else if (this.isCapacitor) {
        // Use Capacitor Filesystem to save, then share
        return await this._capacitorDownload(content, filename);
      } else {
        // Web fallback
        this._blobDownload(content, filename);
        return { success: true, filename };
      }
    } catch (error) {
      this._originalConsole.error('[DebugLogger] Download failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Download logs on Capacitor using Filesystem plugin
   */
  async _capacitorDownload(content, filename) {
    try {
      const { Filesystem } = window.Capacitor.Plugins;

      // Write to Documents directory (user-accessible)
      const result = await Filesystem.writeFile({
        path: filename,
        data: content,
        directory: 'DOCUMENTS',
        encoding: 'utf8'
      });

      // Try to share the file
      if (navigator.share) {
        try {
          // Read the file as blob for sharing
          const fileData = await Filesystem.readFile({
            path: filename,
            directory: 'DOCUMENTS',
            encoding: 'utf8'
          });

          const blob = new Blob([fileData.data], { type: 'text/plain' });
          const file = new File([blob], filename, { type: 'text/plain' });

          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
              files: [file],
              title: 'Debug Logs'
            });
            return { success: true, filename, shared: true };
          }
        } catch (shareError) {
          // Share failed, but file was saved
          this._originalConsole.log('[DebugLogger] Share failed, file saved to Documents:', filename);
        }
      }

      // File saved successfully even if share didn't work
      return { success: true, filename, path: result.uri, message: `Saved to Documents/${filename}` };
    } catch (error) {
      this._originalConsole.error('[DebugLogger] Capacitor download failed:', error);
      // Try blob download as last resort
      this._blobDownload(content, filename);
      return { success: true, filename, fallback: true };
    }
  }

  /**
   * Clear all logs
   */
  async clearLogs() {
    this.sessionLogs = [];

    if (this.isElectron && window.api?.clearLogs) {
      await window.api.clearLogs();
    } else if (this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(this.config.storeName, 'readwrite');
        const store = tx.objectStore(this.config.storeName);
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  }

  /**
   * Get log statistics
   * @returns {Promise<object>} Stats object with counts and sizes
   */
  async getStats() {
    const logs = await this.getLogs({ limit: this.config.maxEntries });

    const stats = {
      totalCount: logs.length,
      byLevel: { info: 0, warn: 0, error: 0, debug: 0 },
      sessions: new Set(),
      oldestLog: null,
      newestLog: null,
      estimatedSize: 0
    };

    logs.forEach(log => {
      stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;
      stats.sessions.add(log.sessionId);
      stats.estimatedSize += JSON.stringify(log).length;

      const logTime = new Date(log.timestamp);
      if (!stats.oldestLog || logTime < new Date(stats.oldestLog)) {
        stats.oldestLog = log.timestamp;
      }
      if (!stats.newestLog || logTime > new Date(stats.newestLog)) {
        stats.newestLog = log.timestamp;
      }
    });

    stats.sessionCount = stats.sessions.size;
    delete stats.sessions;

    return stats;
  }

  /**
   * Restore original console methods and cleanup
   */
  destroy() {
    Object.keys(this._originalConsole).forEach(level => {
      console[level] = this._originalConsole[level];
    });
  }

  // ========== Private Methods ==========

  /**
   * Initialize IndexedDB for web/Capacitor storage
   */
  _initIndexedDB() {
    return new Promise((resolve, reject) => {
      try {
        const request = indexedDB.open(this.config.dbName, 1);

        request.onerror = () => {
          this._originalConsole.warn('[DebugLogger] IndexedDB failed:', request.error);
          resolve(); // Don't fail init, just use session storage
        };

        request.onsuccess = () => {
          this.db = request.result;
          resolve();
        };

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(this.config.storeName)) {
            const store = db.createObjectStore(this.config.storeName, {
              keyPath: 'id',
              autoIncrement: true
            });
            store.createIndex('timestamp', 'timestamp', { unique: false });
            store.createIndex('level', 'level', { unique: false });
            store.createIndex('sessionId', 'sessionId', { unique: false });
          }
        };
      } catch (error) {
        this._originalConsole.warn('[DebugLogger] IndexedDB not available:', error);
        resolve();
      }
    });
  }

  /**
   * Intercept console methods to capture all logs
   */
  _interceptConsole() {
    const self = this;
    const levels = ['log', 'warn', 'error', 'info', 'debug'];

    levels.forEach(level => {
      console[level] = function(...args) {
        // Call original first
        self._originalConsole[level].apply(console, args);

        // Capture to logger
        const logLevel = level === 'log' ? 'info' : level;
        const message = args.map(arg => self._stringify(arg)).join(' ');

        self.log(logLevel, message, { source: 'console' });
      };
    });
  }

  /**
   * Persist log entry to storage
   */
  async _persist(entry) {
    if (this.isElectron && window.api?.appendLog) {
      await window.api.appendLog(JSON.stringify(entry) + '\n');
    } else if (this.db) {
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(this.config.storeName, 'readwrite');
        const store = tx.objectStore(this.config.storeName);
        store.add(entry);

        tx.oncomplete = async () => {
          await this._enforceLimit();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      });
    }
  }

  /**
   * Enforce storage limits (IndexedDB)
   */
  async _enforceLimit() {
    if (!this.db) return;

    return new Promise((resolve) => {
      const tx = this.db.transaction(this.config.storeName, 'readwrite');
      const store = tx.objectStore(this.config.storeName);
      const countRequest = store.count();

      countRequest.onsuccess = () => {
        const count = countRequest.result;
        if (count > this.config.maxEntries) {
          // Delete oldest entries
          const deleteCount = count - this.config.maxEntries;
          const cursorRequest = store.openCursor();
          let deleted = 0;

          cursorRequest.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor && deleted < deleteCount) {
              store.delete(cursor.primaryKey);
              deleted++;
              cursor.continue();
            }
          };
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve(); // Don't fail on cleanup errors
    });
  }

  // ========== Helper Methods ==========

  _generateSessionId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  _getPlatform() {
    if (this.isElectron) return 'electron';
    if (this.isCapacitor) return window.Capacitor.getPlatform();
    return 'web';
  }

  _stringify(arg) {
    if (arg === undefined) return 'undefined';
    if (arg === null) return 'null';
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) {
      return `${arg.name}: ${arg.message}${arg.stack ? '\n' + arg.stack : ''}`;
    }
    try {
      return JSON.stringify(arg, null, 2);
    } catch {
      return String(arg);
    }
  }

  _getStackTrace() {
    try {
      throw new Error();
    } catch (e) {
      return e.stack?.split('\n').slice(3).join('\n') || '';
    }
  }

  _formatDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}`;
  }

  _formatLogsForExport(logs) {
    const header = `${this.config.appName} Debug Logs\n` +
                   `Exported: ${new Date().toISOString()}\n` +
                   `Platform: ${this._getPlatform()}\n` +
                   `Session: ${this.sessionId}\n` +
                   `${'='.repeat(60)}\n\n`;

    const body = logs
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .map(log => {
        const ts = new Date(log.timestamp).toISOString();
        const level = log.level.toUpperCase().padEnd(5);
        let line = `[${ts}] [${level}] ${log.message}`;
        if (log.stack) {
          line += `\n${log.stack}`;
        }
        return line;
      })
      .join('\n');

    return header + body;
  }

  _blobDownload(content, filename) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  _log(level, ...args) {
    this._originalConsole[level]?.apply(console, args);
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DebugLogger;
}

// Auto-initialize when loaded in browser (CSP doesn't allow inline scripts)
if (typeof window !== 'undefined') {
  window.DebugLogger = DebugLogger;
  window.debugLogger = new DebugLogger({ appName: 'AtTheSpeedOfLife', maxEntries: 500 });
  window.debugLogger.init();
}
