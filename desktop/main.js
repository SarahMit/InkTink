// InkTink desktop shell. Loads the exact same index.html/app.js/style.css as
// the web version (dev: straight from the repo root; packaged: the copy that
// electron-builder bundled into resources/web) and hosts the DiskStore that
// backs the appStorage seam with files in Documents/InkTink.

const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const DiskStore = require('./storage');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  let store = null;

  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  // ── window state (position/size across launches) ──
  const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
  function readWindowState() {
    try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')) || {}; } catch { return {}; }
  }
  function saveWindowState() {
    if (!win) return;
    try {
      const bounds = win.getNormalBounds();
      fs.writeFileSync(stateFile(), JSON.stringify({ ...bounds, maximized: win.isMaximized() }));
    } catch (e) { console.warn('InkTink: window-state save failed', e); }
  }

  function createWindow() {
    const webRoot = app.isPackaged
      ? path.join(process.resourcesPath, 'web')
      : path.join(__dirname, '..');
    const state = readWindowState();
    win = new BrowserWindow({
      width: state.width || 1280,
      height: state.height || 800,
      x: state.x,
      y: state.y,
      minWidth: 700,
      minHeight: 500,
      icon: path.join(__dirname, 'build', 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    if (state.maximized) win.maximize();
    // 'close' does not fire for renderer-initiated closes (window.close()),
    // so also persist on resize/move — this covers crashes as a bonus.
    let stateTimer = null;
    const saveStateDebounced = () => { clearTimeout(stateTimer); stateTimer = setTimeout(saveWindowState, 500); };
    win.on('resize', saveStateDebounced);
    win.on('move', saveStateDebounced);
    win.on('close', saveWindowState);
    win.on('closed', () => { clearTimeout(stateTimer); win = null; });

    // Links (e.g. "View on GitHub") open in the default browser, never in-app.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      if (/^https?:/i.test(url)) { e.preventDefault(); shell.openExternal(url); }
    });

    win.loadFile(path.join(webRoot, 'index.html'));
  }

  function buildMenu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      {
        label: 'File',
        submenu: [
          { label: 'Show Projects Folder', click: () => shell.openPath(store.dataDir) },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
          { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Help',
        submenu: [
          { label: 'InkTink on GitHub', click: () => shell.openExternal('https://github.com/SarahMit/InkTink') },
          { label: `Version ${app.getVersion()}`, enabled: false },
        ],
      },
    ]));
  }

  app.whenReady().then(() => {
    // INKTINK_DATA_DIR lets tests (and the curious) point the app elsewhere.
    store = new DiskStore(process.env.INKTINK_DATA_DIR || path.join(app.getPath('documents'), 'InkTink'));

    ipcMain.on('storage:snapshot', (e) => { e.returnValue = store.snapshot(); });
    ipcMain.on('storage:set', (e, key, value) => { store.set(key, value); });
    ipcMain.on('storage:flush', (e) => { store.flush(); e.returnValue = true; });
    ipcMain.on('app:version', (e) => { e.returnValue = app.getVersion(); });

    buildMenu();
    createWindow();

    app.on('activate', () => { if (!win) createWindow(); }); // macOS dock click

    if (app.isPackaged) {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.autoInstallOnAppQuit = true; // silent: installs on next quit
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    }
  });

  app.on('before-quit', () => { if (store) store.flush(); });
  app.on('window-all-closed', () => app.quit());
}
