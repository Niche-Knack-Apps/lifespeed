const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
  // ===== Entry Operations =====
  createEntry: (title) => ipcRenderer.invoke('entry:create', title),
  saveEntry: (path, content) => ipcRenderer.invoke('entry:save', path, content),
  loadEntry: (path) => ipcRenderer.invoke('entry:load', path),
  deleteEntry: (path) => ipcRenderer.invoke('entry:delete', path),
  listEntries: () => ipcRenderer.invoke('entry:list'),
  renameEntry: (path, newTitle) => ipcRenderer.invoke('entry:rename', path, newTitle),

  // ===== Image Operations =====
  pasteImage: (base64Data, entryPath) => ipcRenderer.invoke('image:paste', base64Data, entryPath),
  copyImage: (sourcePath, entryPath) => ipcRenderer.invoke('image:copy', sourcePath, entryPath),

  // ===== File Attachments =====
  attachFile: (sourcePath, entryPath) => ipcRenderer.invoke('file:attach', sourcePath, entryPath),

  // ===== Search Index =====
  getIndexPath: () => ipcRenderer.invoke('index:get-path'),
  saveIndex: (indexData) => ipcRenderer.invoke('index:save', indexData),
  loadIndex: () => ipcRenderer.invoke('index:load'),

  // ===== Settings =====
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  getEntriesDir: () => ipcRenderer.invoke('settings:get-entries-dir'),
  setEntriesDir: (dir) => ipcRenderer.invoke('settings:set-entries-dir', dir),
  chooseEntriesDir: () => ipcRenderer.invoke('settings:choose-entries-dir'),

  // ===== File Watcher =====
  startWatcher: () => ipcRenderer.invoke('watcher:start'),
  stopWatcher: () => ipcRenderer.invoke('watcher:stop'),

  // File change events
  onFileAdded: (callback) => {
    ipcRenderer.on('file:added', (event, path) => callback(path));
  },
  onFileChanged: (callback) => {
    ipcRenderer.on('file:changed', (event, path) => callback(path));
  },
  onFileDeleted: (callback) => {
    ipcRenderer.on('file:deleted', (event, path) => callback(path));
  },

  // ===== Shell Operations =====
  openPath: (path) => ipcRenderer.invoke('shell:open-path', path),
  showItemInFolder: (path) => ipcRenderer.invoke('shell:show-item', path),

  // ===== Utility =====
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),

  // ===== Debug Logger =====
  appendLog: (logLine) => ipcRenderer.invoke('append-log', logLine),
  getLogs: (options) => ipcRenderer.invoke('get-logs', options),
  clearLogs: () => ipcRenderer.invoke('clear-logs'),
  saveLogFile: (content, filename) => ipcRenderer.invoke('save-log-file', content, filename)
});
