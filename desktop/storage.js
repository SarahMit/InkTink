// Disk backend for the appStorage seam in app.js. The renderer keeps talking
// to a synchronous localStorage-shaped API (see preload.js); this class maps
// those keys onto visible .json files so there is no browser quota:
//
//   Documents/InkTink/
//   ├── projects/<name>.json   one per named project, same format as the
//   │                          web app's Export button (version 2, plus the
//   │                          name/modified fields, which the web import
//   │                          ignores) — files open in either variant
//   ├── current.json           the unnamed working copy (inktink.current)
//   ├── meta.json              the small keys (currentName, ideapool, ui,
//   │                          theme, lang) as raw strings
//   └── trash/                 deleted projects are parked here, never erased
//
// Reads happen once at boot (synchronous snapshot); writes are debounced and
// atomic (tmp + rename). flush() completes every pending write synchronously —
// called via the renderer's flushPendingSave() and on before-quit.

const fs = require('fs');
const path = require('path');

const WRITE_DEBOUNCE_MS = 300;
// Windows device names that cannot be used as filenames.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function sanitizeFilename(name) {
  let base = String(name)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '')
    .slice(0, 100)
    .trim();
  if (!base || RESERVED.test(base)) base = '_' + base;
  return base;
}

function atomicWrite(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file); // overwrites on Windows too (MOVEFILE_REPLACE_EXISTING)
}

class DiskStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.projectsDir = path.join(dataDir, 'projects');
    this.trashDir = path.join(dataDir, 'trash');
    this.kv = new Map(); // authoritative key → string, mirrors what app.js sees
    this.meta = {}; // raw strings for the small keys
    this.files = new Map(); // project name → { filename, modified } as last written
    this.pending = new Map(); // debounce label → { timer, run }
    this.load();
  }

  // ── boot: read everything on disk into the snapshot ──
  load() {
    fs.mkdirSync(this.projectsDir, { recursive: true });
    fs.mkdirSync(this.trashDir, { recursive: true });

    try {
      this.meta = JSON.parse(fs.readFileSync(path.join(this.dataDir, 'meta.json'), 'utf8')) || {};
    } catch { this.meta = {}; }
    for (const [k, v] of Object.entries(this.meta)) {
      if (typeof v === 'string') this.kv.set(k, v);
    }

    const current = this.readProjectFile(path.join(this.dataDir, 'current.json'));
    if (current) this.kv.set('inktink.current', JSON.stringify(current.data));

    const store = {};
    for (const filename of fs.readdirSync(this.projectsDir).sort()) {
      if (!filename.toLowerCase().endsWith('.json')) continue;
      const file = path.join(this.projectsDir, filename);
      const parsed = this.readProjectFile(file);
      if (!parsed) { console.warn('InkTink: skipping unreadable project file', file); continue; }
      const name = parsed.name || filename.replace(/\.json$/i, '');
      if (this.files.has(name)) { console.warn('InkTink: duplicate project name, ignoring', file); continue; }
      const modified = parsed.modified || fs.statSync(file).mtime.toISOString();
      store[name] = { data: parsed.data, modified };
      this.files.set(name, { filename, modified });
    }
    this.kv.set('inktink.projects', JSON.stringify(store));
  }

  // Reads a project .json and splits it into the envelope (name/modified) and
  // the bare project data that app.js works with. Returns null if unreadable.
  readProjectFile(file) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const { version, name, modified, ...data } = parsed;
      return { name, modified, data };
    } catch { return null; }
  }

  snapshot() {
    return Object.fromEntries(this.kv);
  }

  // ── writes: route each key to its file, debounced ──
  set(key, value) {
    if (value === null) this.kv.delete(key); else this.kv.set(key, value);

    if (key === 'inktink.projects') {
      let store = {};
      if (value !== null) {
        try { store = JSON.parse(value) || {}; }
        catch (e) { console.warn('InkTink: unparseable projects payload, not writing', e); return; }
      }
      this.diffProjects(store);
    } else if (key === 'inktink.current') {
      const file = path.join(this.dataDir, 'current.json');
      if (value === null) {
        this.schedule('current', () => { try { fs.rmSync(file, { force: true }); } catch {} });
      } else {
        let data;
        try { data = JSON.parse(value); }
        catch (e) { console.warn('InkTink: unparseable working copy, not writing', e); return; }
        this.schedule('current', () => atomicWrite(file, JSON.stringify({ version: 2, ...data }, null, 2)));
      }
    } else {
      if (value === null) delete this.meta[key]; else this.meta[key] = value;
      this.schedule('meta', () => atomicWrite(path.join(this.dataDir, 'meta.json'), JSON.stringify(this.meta, null, 2)));
    }
  }

  // Compares the incoming full store against what was last written and only
  // touches files whose project changed (by `modified`), appeared, or vanished.
  diffProjects(store) {
    for (const [name, entry] of Object.entries(store)) {
      if (!entry || !entry.data || typeof entry.data !== 'object') continue;
      const prev = this.files.get(name);
      if (prev && prev.modified === entry.modified) continue;
      const filename = prev ? prev.filename : this.claimFilename(name);
      this.files.set(name, { filename, modified: entry.modified });
      const file = path.join(this.projectsDir, filename);
      const payload = { version: 2, name, modified: entry.modified, ...entry.data };
      this.schedule('project:' + name, () => atomicWrite(file, JSON.stringify(payload, null, 2)));
    }
    for (const name of [...this.files.keys()]) {
      if (name in store) continue;
      const { filename } = this.files.get(name);
      this.files.delete(name);
      this.cancel('project:' + name);
      const src = path.join(this.projectsDir, filename);
      const dst = path.join(this.trashDir, new Date().toISOString().replace(/[:.]/g, '-') + '-' + filename);
      this.schedule('trash:' + name, () => { try { fs.renameSync(src, dst); } catch {} });
    }
  }

  claimFilename(name) {
    const taken = new Set([...this.files.values()].map(f => f.filename.toLowerCase()));
    try { for (const f of fs.readdirSync(this.projectsDir)) taken.add(f.toLowerCase()); } catch {}
    const base = sanitizeFilename(name);
    let candidate = base + '.json';
    for (let i = 2; taken.has(candidate.toLowerCase()); i++) candidate = `${base}-${i}.json`;
    return candidate;
  }

  schedule(label, run) {
    this.cancel(label);
    const timer = setTimeout(() => {
      this.pending.delete(label);
      try { run(); } catch (e) { console.warn('InkTink: write failed for', label, e); }
    }, WRITE_DEBOUNCE_MS);
    this.pending.set(label, { timer, run });
  }

  cancel(label) {
    const p = this.pending.get(label);
    if (p) { clearTimeout(p.timer); this.pending.delete(label); }
  }

  // Runs every pending write now. Trash moves must run after project writes so
  // a rename (new file + old file trashed) never races itself.
  flush() {
    const entries = [...this.pending.entries()]
      .sort(([a], [b]) => (a.startsWith('trash:') ? 1 : 0) - (b.startsWith('trash:') ? 1 : 0));
    this.pending.clear();
    for (const [label, { timer, run }] of entries) {
      clearTimeout(timer);
      try { run(); } catch (e) { console.warn('InkTink: write failed for', label, e); }
    }
  }
}

module.exports = DiskStore;
