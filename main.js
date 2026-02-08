// Enable V8 code caching for faster startup
require('v8-compile-cache');

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');

// Linux shared memory fix for Chromium
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('disable-dev-shm-usage');
}

// Set app name for Linux dock/dash icon
app.setName('Lifespeed');

// Set user data path
const userDataPath = path.join(os.homedir(), '.config', 'lifespeed');
app.setPath('userData', userDataPath);

let mainWindow;
let entriesDir = null;
let fileWatcher = null;

// Default settings
const DEFAULT_SETTINGS = {
  entriesDirectory: path.join(os.homedir(), 'Documents', 'Journal'),
  theme: 'system',
  fontSize: 'medium',
  autoSave: true,
  autoSaveDelay: 500,
  showMetadata: false,
  createOnLaunch: true
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 320,
    minHeight: 480,
    show: false, // Show when ready for speed
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, 'icon.png'),
    titleBarStyle: 'hiddenInset',
    frame: process.platform === 'darwin' ? true : true
  });

  mainWindow.loadFile('renderer/index.html');

  // Show window when ready (faster perceived startup)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Forward renderer console to main
  mainWindow.webContents.on('console-message', (event, level, message) => {
    const levels = ['debug', 'info', 'warn', 'error'];
    console.log(`[Renderer ${levels[level] || 'log'}] ${message}`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopFileWatcher();
  });
}

app.whenReady().then(async () => {
  await loadSettings();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ===== Settings =====

async function loadSettings() {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    const content = await fs.readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(content);
    entriesDir = settings.entriesDirectory || DEFAULT_SETTINGS.entriesDirectory;
    return settings;
  } catch {
    entriesDir = DEFAULT_SETTINGS.entriesDirectory;
    return DEFAULT_SETTINGS;
  }
}

ipcMain.handle('settings:load', async () => {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    const content = await fs.readFile(settingsPath, 'utf-8');
    return { success: true, settings: JSON.parse(content) };
  } catch {
    return { success: true, settings: DEFAULT_SETTINGS };
  }
});

ipcMain.handle('settings:save', async (event, settings) => {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

    // Update entries directory if changed
    if (settings.entriesDirectory !== entriesDir) {
      entriesDir = settings.entriesDirectory;
      restartFileWatcher();
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('settings:get-entries-dir', () => {
  return entriesDir || DEFAULT_SETTINGS.entriesDirectory;
});

ipcMain.handle('settings:set-entries-dir', async (event, dir) => {
  try {
    // Verify directory exists or create it
    await fs.mkdir(dir, { recursive: true });
    entriesDir = dir;

    // Save to settings
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    let settings = DEFAULT_SETTINGS;
    try {
      const content = await fs.readFile(settingsPath, 'utf-8');
      settings = JSON.parse(content);
    } catch {}
    settings.entriesDirectory = dir;
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

    restartFileWatcher();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('settings:choose-entries-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Journal Entries Directory',
    properties: ['openDirectory', 'createDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return { success: true, path: result.filePaths[0] };
  }
  return { success: false, canceled: true };
});

// ===== Entry Operations =====

function getEntriesPath() {
  return entriesDir || DEFAULT_SETTINGS.entriesDirectory;
}

function generateEntryFilename(title) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 8).replace(/:/g, '-');

  if (title && title.trim()) {
    const slug = title.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
    return `${date}-${slug}`;
  }
  return `${date}-${time}`;
}

function generateFrontmatter(title) {
  const now = new Date().toISOString();
  return `---
title: "${title || ''}"
date: ${now}
lastmod: ${now}
tags: []
draft: false
---

`;
}

ipcMain.handle('entry:create', async (event, title) => {
  try {
    const basePath = getEntriesPath();
    const dirname = generateEntryFilename(title);
    const entryDir = path.join(basePath, dirname);
    const entryPath = path.join(entryDir, 'index.md');
    const imagesDir = path.join(entryDir, 'images');
    const filesDir = path.join(entryDir, 'files');

    // Create directories
    await fs.mkdir(imagesDir, { recursive: true });
    await fs.mkdir(filesDir, { recursive: true });

    // Create entry file with frontmatter
    const content = generateFrontmatter(title);
    await fs.writeFile(entryPath, content, 'utf-8');

    return {
      success: true,
      path: entryPath,
      dirname,
      content
    };
  } catch (error) {
    console.error('Error creating entry:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('entry:save', async (event, entryPath, content) => {
  try {
    await fs.writeFile(entryPath, content, 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('Error saving entry:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('entry:load', async (event, entryPath) => {
  try {
    const content = await fs.readFile(entryPath, 'utf-8');
    return { success: true, content };
  } catch (error) {
    console.error('Error loading entry:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('entry:delete', async (event, entryPath) => {
  try {
    const entryDir = path.dirname(entryPath);
    await fs.rm(entryDir, { recursive: true, force: true });
    return { success: true };
  } catch (error) {
    console.error('Error deleting entry:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('entry:list', async () => {
  try {
    const basePath = getEntriesPath();
    await fs.mkdir(basePath, { recursive: true });

    const items = await fs.readdir(basePath, { withFileTypes: true });
    const entries = [];

    for (const item of items) {
      if (item.isDirectory()) {
        const indexPath = path.join(basePath, item.name, 'index.md');
        try {
          const stat = await fs.stat(indexPath);
          entries.push({
            dirname: item.name,
            path: indexPath,
            mtime: stat.mtime.toISOString()
          });
        } catch {
          // Not a valid entry directory
        }
      }
    }

    // Sort by modification time, newest first
    entries.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));

    return { success: true, entries };
  } catch (error) {
    console.error('Error listing entries:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('entry:rename', async (event, oldPath, newTitle) => {
  try {
    const basePath = getEntriesPath();
    const oldDir = path.dirname(oldPath);
    const oldDirname = path.basename(oldDir);

    // Extract date from old dirname
    const dateMatch = oldDirname.match(/^(\d{4}-\d{2}-\d{2})/);
    const date = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10);

    const slug = newTitle.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);

    const newDirname = `${date}-${slug}`;
    const newDir = path.join(basePath, newDirname);

    if (oldDir !== newDir) {
      await fs.rename(oldDir, newDir);
    }

    return {
      success: true,
      path: path.join(newDir, 'index.md'),
      dirname: newDirname
    };
  } catch (error) {
    console.error('Error renaming entry:', error);
    return { success: false, error: error.message };
  }
});

// ===== Image Operations =====

ipcMain.handle('image:paste', async (event, base64Data, entryPath) => {
  try {
    const entryDir = path.dirname(entryPath);
    const imagesDir = path.join(entryDir, 'images');
    await fs.mkdir(imagesDir, { recursive: true });

    // Generate filename with timestamp
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `${timestamp}.png`;
    const imagePath = path.join(imagesDir, filename);

    // Decode base64 and save
    const base64Image = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Image, 'base64');
    await fs.writeFile(imagePath, buffer);

    return {
      success: true,
      filename,
      relativePath: `images/${filename}`,
      markdown: `![](images/${filename})`
    };
  } catch (error) {
    console.error('Error pasting image:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('image:copy', async (event, sourcePath, entryPath) => {
  try {
    const entryDir = path.dirname(entryPath);
    const imagesDir = path.join(entryDir, 'images');
    await fs.mkdir(imagesDir, { recursive: true });

    const ext = path.extname(sourcePath);
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `${timestamp}${ext}`;
    const destPath = path.join(imagesDir, filename);

    await fs.copyFile(sourcePath, destPath);

    return {
      success: true,
      filename,
      relativePath: `images/${filename}`,
      markdown: `![](images/${filename})`
    };
  } catch (error) {
    console.error('Error copying image:', error);
    return { success: false, error: error.message };
  }
});

// ===== File Attachments =====

ipcMain.handle('file:attach', async (event, sourcePath, entryPath) => {
  try {
    const entryDir = path.dirname(entryPath);
    const filesDir = path.join(entryDir, 'files');
    await fs.mkdir(filesDir, { recursive: true });

    const filename = path.basename(sourcePath);
    const destPath = path.join(filesDir, filename);

    await fs.copyFile(sourcePath, destPath);

    return {
      success: true,
      filename,
      relativePath: `files/${filename}`,
      markdown: `[${filename}](files/${filename})`
    };
  } catch (error) {
    console.error('Error attaching file:', error);
    return { success: false, error: error.message };
  }
});

// ===== Search Index =====

ipcMain.handle('index:get-path', () => {
  return path.join(app.getPath('userData'), 'search-index.json');
});

ipcMain.handle('index:save', async (event, indexData) => {
  try {
    const indexPath = path.join(app.getPath('userData'), 'search-index.json');
    await fs.writeFile(indexPath, JSON.stringify(indexData), 'utf-8');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('index:load', async () => {
  try {
    const indexPath = path.join(app.getPath('userData'), 'search-index.json');
    const content = await fs.readFile(indexPath, 'utf-8');
    return { success: true, index: JSON.parse(content) };
  } catch {
    return { success: true, index: null };
  }
});

// ===== File Watching =====

function startFileWatcher() {
  if (fileWatcher) return;

  try {
    const chokidar = require('chokidar');
    const watchPath = getEntriesPath();

    fileWatcher = chokidar.watch(watchPath, {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      ignoreInitial: true,
      depth: 2
    });

    fileWatcher
      .on('add', (filePath) => {
        if (filePath.endsWith('index.md') && mainWindow) {
          mainWindow.webContents.send('file:added', filePath);
        }
      })
      .on('change', (filePath) => {
        if (filePath.endsWith('index.md') && mainWindow) {
          mainWindow.webContents.send('file:changed', filePath);
        }
      })
      .on('unlink', (filePath) => {
        if (filePath.endsWith('index.md') && mainWindow) {
          mainWindow.webContents.send('file:deleted', filePath);
        }
      });

    console.log('File watcher started:', watchPath);
  } catch (error) {
    console.error('Error starting file watcher:', error);
  }
}

function stopFileWatcher() {
  if (fileWatcher) {
    fileWatcher.close();
    fileWatcher = null;
  }
}

function restartFileWatcher() {
  stopFileWatcher();
  startFileWatcher();
}

ipcMain.handle('watcher:start', () => {
  startFileWatcher();
  return { success: true };
});

ipcMain.handle('watcher:stop', () => {
  stopFileWatcher();
  return { success: true };
});

// ===== Utility =====

ipcMain.handle('shell:open-path', async (event, filePath) => {
  try {
    await shell.openPath(filePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('shell:show-item', async (event, filePath) => {
  shell.showItemInFolder(filePath);
  return { success: true };
});

ipcMain.handle('get-user-data-path', () => {
  return app.getPath('userData');
});

// ========== Debug Logger IPC Handlers ==========

const LOG_FILE_MAX_SIZE = 1024 * 1024; // 1MB

function getLogFilePath() {
  return path.join(app.getPath('userData'), 'debug.log');
}

ipcMain.handle('append-log', async (event, logLine) => {
  try {
    const logFilePath = getLogFilePath();

    // Check file size and rotate if needed
    try {
      const stats = await fs.stat(logFilePath);
      if (stats.size > LOG_FILE_MAX_SIZE) {
        const oldPath = logFilePath + '.old';
        try { await fs.unlink(oldPath); } catch {}
        await fs.rename(logFilePath, oldPath);
      }
    } catch {}

    await fs.appendFile(logFilePath, logLine, 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('Error appending log:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-logs', async (event, options = {}) => {
  try {
    const logFilePath = getLogFilePath();
    let content = '';

    try {
      content = await fs.readFile(logFilePath, 'utf-8');
    } catch {}

    try {
      const oldContent = await fs.readFile(logFilePath + '.old', 'utf-8');
      content = oldContent + content;
    } catch {}

    const logs = content
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line); }
        catch { return null; }
      })
      .filter(log => log !== null);

    let filtered = logs;
    if (options.level) {
      filtered = filtered.filter(l => l.level === options.level);
    }
    if (options.sessionId) {
      filtered = filtered.filter(l => l.sessionId === options.sessionId);
    }
    if (options.limit) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  } catch (error) {
    console.error('Error getting logs:', error);
    return [];
  }
});

ipcMain.handle('clear-logs', async () => {
  try {
    const logFilePath = getLogFilePath();
    await fs.writeFile(logFilePath, '', 'utf-8');
    try { await fs.unlink(logFilePath + '.old'); } catch {}
    return { success: true };
  } catch (error) {
    console.error('Error clearing logs:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-log-file', async (event, content, defaultFilename) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultFilename,
      filters: [{ name: 'Log Files', extensions: ['log', 'txt'] }]
    });

    if (!result.canceled && result.filePath) {
      await fs.writeFile(result.filePath, content, 'utf-8');
      return { success: true, path: result.filePath };
    }
    return { success: false, cancelled: true };
  } catch (error) {
    console.error('Error saving log file:', error);
    return { success: false, error: error.message };
  }
});
