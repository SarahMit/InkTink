// Bridges the appStorage seam in app.js to the main process's DiskStore.
// The full store is fetched synchronously ONCE here (before the page runs),
// so every read app.js ever does is a free in-renderer Map lookup — the
// existing fully synchronous save/load code needs no changes.
//
// Writes are fire-and-forget IPC so saving a multi-MB project never blocks
// typing. Electron delivers a renderer's IPC messages in order, which makes
// flushSync() a true barrier: when it returns, main has processed every prior
// setItem AND finished all pending disk writes (see flushPendingSave in app.js).

const { contextBridge, ipcRenderer } = require('electron');

const cache = new Map(Object.entries(ipcRenderer.sendSync('storage:snapshot')));

contextBridge.exposeInMainWorld('inktinkDesktop', {
  version: ipcRenderer.sendSync('app:version'),
  storage: {
    getItem: (k) => (cache.has(k) ? cache.get(k) : null),
    setItem: (k, v) => { cache.set(k, String(v)); ipcRenderer.send('storage:set', k, String(v)); },
    removeItem: (k) => { cache.delete(k); ipcRenderer.send('storage:set', k, null); },
    get length() { return cache.size; },
    key: (i) => [...cache.keys()][i] ?? null,
  },
  flushSync: () => ipcRenderer.sendSync('storage:flush'),
});
