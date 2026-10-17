// Snapshot files for the renderer's snapshot history (see the SNAPSHOTS
// section in app.js). Unlike the appStorage seam, snapshots bypass the
// key/value store entirely — a project snapshot with embedded images can be
// multi-MB and must never end up inside meta.json.
//
//   Documents/InkTink/
//   └── snapshots/
//       └── <sanitized-project-name>/
//           ├── index.json                    [{ file, ts, words }], newest first
//           └── 2026-07-12T14-30-00-000Z.json full project (version 2), images included
//
// index.json keeps listing cheap (no reading of the big files); if it is ever
// missing or corrupt the list is simply empty until the next snapshot rebuilds
// it — the snapshot files themselves are plain project exports and can always
// be imported by hand (encrypted ones, written while encryption is on, import
// with the passphrase).

const fs = require('fs');
const path = require('path');
const { sanitizeFilename, atomicWrite } = require('./storage');

const SNAP_CAP = 40;

// Keep everything from the last hour, then one per calendar day, newest first,
// capped. Mirrors the renderer's browser-side pruning (larger cap: disk has room).
function prune(index, cap) {
  const sorted = [...index].sort((a, b) => b.ts - a.ts);
  const hourAgo = Date.now() - 3600 * 1000;
  const days = new Set();
  const kept = [];
  for (const e of sorted) {
    if (e.ts >= hourAgo) { kept.push(e); continue; }
    const day = new Date(e.ts).toISOString().slice(0, 10);
    if (!days.has(day)) { days.add(day); kept.push(e); }
  }
  return kept.slice(0, cap);
}

class SnapshotStore {
  constructor(dataDir) {
    this.root = path.join(dataDir, 'snapshots');
  }

  dirFor(project) {
    const dir = path.join(this.root, sanitizeFilename(project));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  readIndex(dir) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
      return Array.isArray(parsed) ? parsed.filter(e => e && e.file && e.ts) : [];
    } catch { return []; }
  }

  write(project, ts, words, json) {
    const dir = this.dirFor(project);
    const file = new Date(ts).toISOString().replace(/[:.]/g, '-') + '.json';
    atomicWrite(path.join(dir, file), json);
    const index = this.readIndex(dir).filter(e => e.file !== file);
    index.push({ file, ts, words });
    const kept = prune(index, SNAP_CAP);
    for (const e of index) {
      if (!kept.includes(e)) {
        try { fs.rmSync(path.join(dir, e.file), { force: true }); } catch {}
      }
    }
    atomicWrite(path.join(dir, 'index.json'), JSON.stringify(kept, null, 2));
  }

  list(project) {
    return this.readIndex(this.dirFor(project)).map(({ ts, words }) => ({ ts, words }));
  }

  // Every snapshot file, for re-writing them all when the renderer switches
  // encryption on or off. dir/file are names inside root, as returned here.
  files() {
    const out = [];
    let dirs = [];
    try { dirs = fs.readdirSync(this.root, { withFileTypes: true }); } catch { return out; }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      for (const e of this.readIndex(path.join(this.root, d.name))) out.push({ dir: d.name, file: e.file });
    }
    return out;
  }

  // Resolves dir/file from files() inside root; anything else (path
  // separators, "..", index.json) is refused.
  fileFor(dir, file) {
    const ok = n => typeof n === 'string' && n && n === path.basename(n) && n !== '.' && n !== '..';
    if (!ok(dir) || !ok(file) || !/\.json$/i.test(file) || file.toLowerCase() === 'index.json') return null;
    return path.join(this.root, dir, file);
  }

  readFile(dir, file) {
    const f = this.fileFor(dir, file);
    if (!f) return null;
    try { return fs.readFileSync(f, 'utf8'); } catch { return null; }
  }

  rewriteFile(dir, file, json) {
    const f = this.fileFor(dir, file);
    if (!f || !fs.existsSync(f)) return false;
    atomicWrite(f, json);
    return true;
  }

  read(project, ts) {
    const entry = this.readIndex(this.dirFor(project)).find(e => e.ts === ts);
    if (!entry) return null;
    try { return fs.readFileSync(path.join(this.dirFor(project), entry.file), 'utf8'); }
    catch { return null; }
  }
}

module.exports = SnapshotStore;
