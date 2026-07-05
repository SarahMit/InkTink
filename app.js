// ── Storage (browser-local, no server) ──
// Working state lives in localStorage so a reload keeps your place.
// Named projects also live in localStorage. Moving work between devices
// is done with explicit Export/Import to a .json file (images embedded).
const LS_CURRENT = 'inktink.current';
const LS_PROJECTS = 'inktink.projects'; // { [name]: { data, modified } }
const LS_CURRENT_NAME = 'inktink.currentName'; // which named project is open

// Named projects live only in LS_PROJECTS; LS_CURRENT_NAME points at the open
// one. Unnamed work-in-progress lives in LS_CURRENT instead. Storing the open
// project once (not twice) doubles the room before the localStorage quota hits.
function setCurrentProjectName(name) {
  currentProjectName = name || null;
  try {
    if (currentProjectName) localStorage.setItem(LS_CURRENT_NAME, currentProjectName);
    else localStorage.removeItem(LS_CURRENT_NAME);
  } catch {}
}

function collectProjectData() {
  return { beats, characters, moodboard: moodImages, blurb: projectBlurb, writing, brainstorm, timeline, inspiration, todos, writingGoal, wordHistory, selectedStructure, worldbuilding, ideaMap, storyTheme, ideaWorkshops };
}

function readProjectsStore() {
  try { return JSON.parse(localStorage.getItem(LS_PROJECTS) || '{}'); }
  catch { return {}; }
}
function writeProjectsStore(store) {
  localStorage.setItem(LS_PROJECTS, JSON.stringify(store));
}

// Boot loader. Prefers the v2 layout (pointer + named store). Falls back to the
// old v1 layout where LS_CURRENT always held the freshest copy; migration is
// non-destructive — nothing is deleted here, LS_CURRENT is only removed by the
// save functions after a verified write to the named store.
async function loadInitialProject() {
  const store = readProjectsStore();

  // v2: pointer to a named project
  try {
    const pointer = localStorage.getItem(LS_CURRENT_NAME);
    if (pointer && store[pointer] && store[pointer].data) {
      currentProjectName = pointer;
      return store[pointer].data;
    }
    if (pointer) localStorage.removeItem(LS_CURRENT_NAME); // dangling pointer
  } catch {}

  // v1: full data in LS_CURRENT; adopt the matching name if one exists
  try {
    const raw = localStorage.getItem(LS_CURRENT);
    if (raw) {
      const data = JSON.parse(raw);
      for (const name of Object.keys(store)) {
        if (JSON.stringify(store[name].data) === JSON.stringify(data)) {
          setCurrentProjectName(name);
          return data;
        }
      }
      return data; // newer unsynced work — keep it as the unnamed working copy
    }
  } catch {}

  return { beats: [], characters: [], moodboard: [] };
}

function snapshotWordHistory() {
  const today = new Date().toISOString().slice(0, 10);
  let total = 0;
  for (const ch of writing.chapters)
    for (const sc of (ch.scenes || [])) total += countWords(sc.content || '');
  const existing = wordHistory.find(e => e.date === today);
  if (existing) { existing.words = total; }
  else { wordHistory.push({ date: today, words: total }); }
  wordHistory.sort((a, b) => a.date.localeCompare(b.date));
  if (wordHistory.length > 90) wordHistory = wordHistory.slice(-90);
}

// Saves the project exactly once (named store OR unnamed working copy) and
// never throws: a failed save (usually the localStorage quota, hit by too
// many/large images) shows a persistent warning banner with a backup button.
function saveProject() {
  if (!projectReady) return false; // boot-time call: nothing loaded yet
  snapshotWordHistory();
  try {
    const json = JSON.stringify(collectProjectData());
    if (currentProjectName) {
      const store = readProjectsStore();
      store[currentProjectName] = { data: JSON.parse(json), modified: new Date().toISOString() };
      writeProjectsStore(store); // may throw on quota — previous layout intact
      localStorage.setItem(LS_CURRENT_NAME, currentProjectName);
      localStorage.removeItem(LS_CURRENT); // only after the store write succeeded
    } else {
      localStorage.setItem(LS_CURRENT, json);
      localStorage.removeItem(LS_CURRENT_NAME);
    }
    isDirty = false;
    hideSaveWarning();
    return true;
  } catch (e) {
    console.warn('Save failed:', e);
    showSaveWarning();
    return false;
  }
}

// Persistent banner shown while saving fails (quota full); hidden again by the
// next successful save. Toggling `hidden` is idempotent, so repeated failed
// saves while typing don't flicker or spam.
function showSaveWarning() {
  const el = document.getElementById('save-warning');
  if (el) el.hidden = false;
}
function hideSaveWarning() {
  const el = document.getElementById('save-warning');
  if (el) el.hidden = true;
}

// Images are embedded directly in the project as base64 data URLs, so a
// single exported .json file is fully self-contained.

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Downscales/recompresses an image so embedded photos don't blow the
// localStorage quota. Transparent PNGs stay PNG (JPEG has no alpha); every
// failure path falls back to the original, and the original is kept whenever
// it is already smaller than the compressed result.
const IMG_MAX_DIM = 1600;
const IMG_JPEG_QUALITY = 0.82;
async function compressImage(file) {
  const original = await readFileAsDataURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = original;
    });
    const scale = Math.min(1, IMG_MAX_DIM / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    // Cheap transparency probe on a small canvas, independent of input size.
    let hasAlpha = false;
    if (file.type === 'image/png') {
      const probe = document.createElement('canvas');
      probe.width = probe.height = 64;
      const pctx = probe.getContext('2d');
      pctx.drawImage(img, 0, 0, 64, 64);
      const px = pctx.getImageData(0, 0, 64, 64).data;
      for (let i = 3; i < px.length; i += 4) {
        if (px[i] < 255) { hasAlpha = true; break; }
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const compressed = hasAlpha
      ? canvas.toDataURL('image/png')
      : canvas.toDataURL('image/jpeg', IMG_JPEG_QUALITY);
    return compressed.length < original.length ? compressed : original;
  } catch (e) {
    console.warn('Image compression failed, keeping original:', e);
    return original;
  }
}

async function uploadImage(file) {
  // GIFs skip compression: drawing to a canvas would freeze the animation.
  const path = (file.type && file.type.startsWith('image/') && file.type !== 'image/gif')
    ? await compressImage(file)
    : await readFileAsDataURL(file);
  return { path, filename: String(Date.now()) };
}

// Embedded images need no separate deletion; removing the reference is enough.
async function deleteImage(_filename) { /* no-op: images live inside the project */ }

// ── Project management (localStorage-backed) ──
async function listProjects() {
  const store = readProjectsStore();
  return Object.keys(store)
    .map(name => ({ name, modified: store[name].modified }))
    .sort((a, b) => new Date(b.modified) - new Date(a.modified));
}

function saveProjectAs(name) {
  snapshotWordHistory();
  try {
    const store = readProjectsStore();
    store[name] = { data: collectProjectData(), modified: new Date().toISOString() };
    writeProjectsStore(store); // may throw on quota — previous layout intact
    setCurrentProjectName(name);
    localStorage.removeItem(LS_CURRENT);
    isDirty = false;
    hideSaveWarning();
    return { ok: true, name };
  } catch (e) {
    console.warn('Save failed:', e);
    showSaveWarning();
    return { ok: false, name };
  }
}

async function loadProjectByName(name) {
  const store = readProjectsStore();
  return store[name] ? store[name].data : { beats: [], characters: [], moodboard: [] };
}

async function deleteProjectByName(name) {
  const store = readProjectsStore();
  delete store[name];
  writeProjectsStore(store);
  // Deleting the open project: keep the work as the unnamed working copy.
  if (name === currentProjectName) {
    setCurrentProjectName(null);
    saveProject();
  }
}

// ── File export / import (move work between devices) ──
function exportProjectToFile() {
  snapshotWordHistory();
  // version marks the export format; imports without it are treated as v1.
  const data = { version: 2, ...collectProjectData() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const base = (currentProjectName || 'inktink-project').replace(/[<>:"/\\|?*]/g, '_');
  a.href = url;
  a.download = base + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importProjectFromFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not a project file');
        if (typeof flushEditor === 'function') flushEditor();
        setCurrentProjectName(file.name.replace(/\.json$/i, ''));
        applyProjectData(data);
        updateProjectLabel();
        saveProject();
        if (typeof switchPage === 'function') switchPage('writing');
      } catch (e) {
        alert(t('import.error') || 'Could not read that file.');
      }
    };
    reader.readAsText(file);
  });
  input.click();
}

// ── State ──
// Save plumbing lives up here because saveProject() already runs while the
// rest of the script is still evaluating (e.g. the initial switchPage call).
// Until init() has loaded the stored project, the in-memory state is empty
// defaults — saving then would wipe the real data, so saveProject() no-ops.
let projectReady = false;
let saveTimer = null;
let isDirty = false;
let beats = [];
let characters = [];
let moodImages = [];
let currentProjectName = null;
let projectBlurb = '';
let writing = { chapters: [] };
let activeChapterId = null;
let activeSceneId = null;
let brainstorm = { notes: [], links: [] };
let timeline = { columns: [], rows: [] };
let inspiration = [];
let todos = [];
let writingGoal = 0;
let wordHistory = []; // [{ date: "YYYY-MM-DD", words: number }]
let selectedStructure = null;
let worldbuilding = { entries: [], customCategories: [], hiddenBuiltins: [] };
let ideaMap = { nodes: [] };
let storyTheme = { statement: '', question: '', claim: '', lesson: '', belief: '', motif: '', message: '' };
// Each guided workshop ("develop", "char") is a fixed sequence of fields, worked
// through in any order, each pairing free notes with a conclusion. Some fields are
// "structured": instead of one conclusion textarea they show a few labelled
// sub-textareas (e.g. lie/fear/false want/hidden need) that get combined into the
// conclusion automatically. WORKSHOP_SHAPES describes that structure per language-
// independent field index so saved data can be migrated/defaulted without
// depending on the (language-specific) content in IDEA_WORKSHOP_FIELDS.
const WORKSHOP_SHAPES = {
  develop: [
    { structured: false },
    { structured: false },
    { structured: false },
    { structured: true, partKeys: ['beginning', 'middle', 'end'] },
  ],
  char: [
    { structured: false },
    { structured: true, partKeys: ['lie', 'fear', 'falseWant', 'hiddenNeed'] },
    { structured: false },
    { structured: false },
  ],
};

function ideaWorkshopDefault(name) {
  return { step: 0, fields: WORKSHOP_SHAPES[name].map(s => ({
    notes: '', conclusion: '',
    ...(s.structured ? { parts: Object.fromEntries(s.partKeys.map(k => [k, ''])) } : {}),
  })) };
}

function ideaWorkshopFromData(saved, name) {
  const def = ideaWorkshopDefault(name);
  if (!saved || !Array.isArray(saved.fields) || saved.fields.length !== def.fields.length) return def;
  const shape = WORKSHOP_SHAPES[name];
  const fields = saved.fields.map((f, i) => {
    const base = { notes: f.notes || '', conclusion: f.conclusion || '' };
    if (shape[i].structured) base.parts = { ...def.fields[i].parts, ...(f.parts || {}) };
    return base;
  });
  // `seeded` must be preserved explicitly — this rebuild drops unknown props,
  // and losing it would re-enable "Seed project structure" after every reload.
  return { step: saved.step || 0, seeded: !!saved.seeded, fields };
}

// Builds the combined "conclusion" text for a structured field so the sidebar
// summary and send-to-brainstorm/notes actions keep working unchanged.
function ideaWorkshopCombineParts(field, parts) {
  return field.parts
    .filter(p => (parts[p.key] || '').trim())
    .map(p => p.label + ': ' + parts[p.key].trim())
    .join('\n');
}

let ideaWorkshops = { develop: ideaWorkshopDefault('develop'), char: ideaWorkshopDefault('char') };

const BS2_COLORS = [
  { main: '#e07a5f', dim: 'rgba(224,122,95,0.15)'  },  // terracotta
  { main: '#5b9cf6', dim: 'rgba(91,156,246,0.15)'  },  // blue
  { main: '#4ade80', dim: 'rgba(74,222,128,0.15)'  },  // green
  { main: '#c084fc', dim: 'rgba(192,132,252,0.15)' },  // violet
  { main: '#f9c74f', dim: 'rgba(249,199,79,0.15)'  },  // yellow
  { main: '#f472b6', dim: 'rgba(244,114,182,0.15)' },  // pink
  { main: '#38bdf8', dim: 'rgba(56,189,248,0.15)'  },  // sky
  { main: '#fb923c', dim: 'rgba(251,146,60,0.15)'  },  // orange
];

const WHATIF_PRESETS = [
  'this fails horribly',
  'the opposite were true',
  'someone else was in charge',
  'there were no consequences',
  'this worked perfectly',
  'everything changed overnight',
  'time ran out',
  'there were unlimited resources',
];
let wbFilter = 'Alle';

const WB_BUILTIN_CATS = ['Orte', 'Völker & Fraktionen', 'Geschichte & Lore', 'Magie & Technologie', 'Sonstiges'];

const STRUCTURES = {
  'drei-akt': {
    name: '3-Akt-Struktur',
    phases: [
      { id: 'akt1', label: 'Akt I – Einführung',    desc: 'Wir lernen die Welt kennen, bevor alles in Bewegung gerät.' },
      { id: 'akt2', label: 'Akt II – Konfrontation', desc: 'Der Protagonist kämpft mit wachsenden Hindernissen und erreicht seinen Tiefpunkt.' },
      { id: 'akt3', label: 'Akt III – Auflösung',   desc: 'Die finale Konfrontation und ihre Konsequenzen.' },
    ],
    beats: [],
  },
  'save-the-cat': {
    name: 'Save the Cat',
    phases: [
      { id: 'act1', label: 'Act I – The Setup',    desc: 'Introduce the hero and the world before everything changes.' },
      { id: 'act2', label: 'Act II – The Journey', desc: 'The hero navigates a new world, faces mounting threats, and hits rock bottom.' },
      { id: 'act3', label: 'Act III – The Change', desc: 'The hero proves their transformation by resolving the central conflict.' },
    ],
    beats: [
      { name: 'Opening Image',          desc: 'A visual snapshot showing who the hero is before everything changes.',               phase: 'act1' },
      { name: 'Theme Stated',           desc: 'Another character hints at the life lesson the hero will need to learn.',            phase: 'act1' },
      { name: 'Setup',                  desc: "We explore the hero's current world, goals, flaws, and supporting cast.",            phase: 'act1' },
      { name: 'Catalyst',               desc: "An event shatters the status quo; there's no going back now.",                      phase: 'act1' },
      { name: 'Debate',                 desc: 'The hero hesitates, questioning whether to accept what comes next.',                 phase: 'act1' },
      { name: 'Break Into Two',         desc: 'The hero crosses over into unfamiliar territory, committing to the path.',           phase: 'act2' },
      { name: 'B Story',                desc: "A new relationship or subplot begins that will guide the hero's growth.",            phase: 'act2' },
      { name: 'Fun and Games',          desc: 'The hero navigates challenges and discoveries in this new realm.',                   phase: 'act2' },
      { name: 'Midpoint',               desc: 'A pivotal moment of false success or failure that raises the stakes dramatically.',  phase: 'act2' },
      { name: 'Bad Guys Close In',      desc: 'External threats grow while internal flaws cause problems to multiply.',             phase: 'act2' },
      { name: 'All Is Lost',            desc: "Rock bottom hits; something breaks because of the hero's own mistakes.",             phase: 'act2' },
      { name: 'Dark Night of the Soul', desc: 'The hero sits with defeat and finally sees their part in it.',                      phase: 'act2' },
      { name: 'Break Into Three',       desc: 'An insight sparks hope; the hero finds a way forward.',                             phase: 'act3' },
      { name: 'Finale',                 desc: "The hero acts on what they've learned, resolving the main conflict.",                phase: 'act3' },
      { name: 'Final Image',            desc: 'A contrasting snapshot showing how much the hero has transformed.',                  phase: 'act3' },
    ],
  },
  'freytag': {
    name: "Freytag's Pyramide",
    phases: [
      { id: 'exposition', label: 'Exposition',           desc: 'Einführung von Ort, Zeit und Figuren. Die Welt vor dem Konflikt.' },
      { id: 'rising',     label: 'Steigende Handlung',   desc: 'Konflikte entstehen und häufen sich. Die Spannung baut sich auf.' },
      { id: 'climax',     label: 'Höhepunkt',            desc: 'Der dramatische Wendepunkt. Alles steht auf dem Spiel.' },
      { id: 'falling',    label: 'Fallende Handlung',    desc: 'Die Konsequenzen des Höhepunkts. Die Spannung löst sich langsam.' },
      { id: 'denouement', label: 'Katastrophe / Lösung', desc: 'Die endgültige Auflösung aller Konflikte.' },
    ],
    beats: [
      { name: 'Exposition',           desc: 'Einführung in Ort, Zeit und Figuren. Die Welt vor dem Konflikt.',              phase: 'exposition' },
      { name: 'Erregendes Moment',    desc: 'Der erste Konflikt entzündet sich. Die Spannung beginnt zu steigen.',          phase: 'rising' },
      { name: 'Steigende Spannung',   desc: 'Hindernisse häufen sich. Der Held kämpft gegen wachsenden Widerstand.',        phase: 'rising' },
      { name: 'Klimax',               desc: 'Der dramatische Höhepunkt. Das Schicksal des Helden hängt am seidenen Faden.', phase: 'climax' },
      { name: 'Peripetie',            desc: 'Der Umschwung: Aus Sieg wird Niederlage oder umgekehrt.',                     phase: 'climax' },
      { name: 'Fallende Handlung',    desc: 'Die Konsequenzen des Klimax entfalten sich. Die Spannung löst sich langsam.',  phase: 'falling' },
      { name: 'Verzögerungsmoment',   desc: 'Ein kurzes Aufflackern von Hoffnung, bevor das Ende klar wird.',              phase: 'falling' },
      { name: 'Katastrophe / Lösung', desc: 'Die endgültige Auflösung aller Konflikte. Das Schicksal ist besiegelt.',       phase: 'denouement' },
    ],
  },
};

// ══════════════════════════════════
// ── INTERNATIONALISATION ──
// ══════════════════════════════════
let currentLang = localStorage.getItem('inktink-lang') || 'en';

const TR = {
  en: {
    'btn.new': 'New', 'btn.save': 'Save', 'btn.load': 'Load',
    'btn.export': 'Export', 'btn.import': 'Import',
    'btn.export.title': 'Download this project as a .json file',
    'btn.import.title': 'Open a project from a .json file',
    'import.error': 'Could not read that file.',
    'nav.writing': 'Manuscript', 'nav.notes': 'Notes', 'nav.moodboard': 'Moodboard',
    'nav.theme': 'Theme', 'nav.brainstorming': 'Idea Tree', 'nav.ideas': 'Spark', 'nav.beats': 'Story Beats',
    'nav.timeline': 'Timeline', 'nav.characters': 'Characters', 'nav.worldbuilding': 'Worldbuilding', 'nav.stats': 'Stats',
    'nav.ideapool': 'Idea Pool',
    'ideapool.tagline': 'A home for every idea, so none of them has to live rent-free in your head. Capture them, see which ones fit together, and pick one to focus on next.',
    'ideapool.capture.placeholder': 'New project idea — press Enter',
    'ideapool.add': '+ Add',
    'ideapool.focus.label': 'Your focus right now',
    'ideapool.focus.none': 'No focus chosen yet. When a new idea pulls at you, drop it above — then pick one idea as your focus and let the rest rest.',
    'ideapool.focus.set': 'Make this my focus',
    'ideapool.focus.clear': 'Release focus',
    'ideapool.focus.parked': 'Parked while you focus — still here when you want it.',
    'ideapool.sort.label': 'Sort:',
    'ideapool.sort.created': 'Newest',
    'ideapool.sort.spark': 'Most exciting',
    'ideapool.sort.ready': 'Most ready',
    'ideapool.sort.sweet': 'Ready & exciting',
    'ideapool.pick': '🎲 Decide for me',
    'ideapool.suggest': 'How about this one? Make it your focus, or roll again.',
    'ideapool.combine': '⊕ Combine',
    'ideapool.combine.hint': 'Pick two or more ideas, then merge them into a new one.',
    'ideapool.combine.do': 'Merge selected',
    'ideapool.combine.cancel': 'Cancel',
    'ideapool.combined.from': 'Combined from:',
    'ideapool.spark': 'Excitement',
    'ideapool.ready': 'Ready to start',
    'ideapool.title.placeholder': 'Idea title',
    'ideapool.note.placeholder': 'Notes, fragments, why it pulls at you…',
    'ideapool.image.add': '+ Add image',
    'ideapool.image.remove': 'Remove image',
    'ideapool.image.recrop': 'Adjust crop',
    'ideapool.image.crop.title': 'Choose how the image is cropped',
    'ideapool.image.crop.use': 'Use this crop',
    'ideapool.link.placeholder': 'Link (e.g. inspiration, reference)',
    'ideapool.link.open': '↗ Open link',
    'ideapool.delete': 'Delete idea',
    'ideapool.empty': 'No ideas yet — capture your first one above.',
    'ideapool.toproject': '→ Start as project',
    'ideapool.toproject.title': 'Start as a new project',
    'ideapool.toproject.confirm': 'Start this idea as a new project? Its note becomes the project description. Unsaved changes to the current project will be lost.',
    'ideapool.toproject.go': 'Create project',
    'ideapool.toproject.keep': 'Keep idea in pool too',
    'sidebar.inspiration': 'Inspiration', 'sidebar.todo': 'To-do',
    'sidebar.todo.placeholder': 'New task + Enter', 'sidebar.insp.empty': 'Add images as inspiration (+)',
    'project.untitled': 'Untitled Project', 'project.blurb.placeholder': "What's it about? A short description of your project...",
    'save.warning': '⚠️ Saving failed — your browser storage is full. Your latest changes are NOT saved. Remove some images, or download a backup now.',
    'save.warning.backup': 'Download backup',
    'writing.export.docx': 'Export as Word document (.docx)',
    'writing.untitled.chapter': 'Untitled Chapter',
    'writing.untitled.scene': 'Untitled Scene',
    'export.docx.unavailable': 'The Word export module has not loaded yet. Go online once and reload the page, then try again.',
    'writing.sections': 'Chapters & Scenes', 'writing.add.chapter': '+ Chapter',
    'writing.empty.chapters': 'No chapters yet.\nCreate one above.',
    'writing.empty.scene': 'Select a scene on the left\nor create a new one to start writing.',
    'writing.empty.scene.short': 'Select a scene on the left.',
    'writing.add.scene': '+ Scene',
    'writing.chapter.placeholder': 'Chapter name', 'writing.scene.placeholder': 'Scene name',
    'writing.scene.title.placeholder': 'Scene title', 'writing.search.placeholder': 'Search all scenes...',
    'writing.words': 'words', 'writing.search.noresult': 'No results',
    'writing.drag.chapter': 'Drag to reorder chapter', 'writing.drag.scene': 'Drag to reorder scene',
    'writing.collapse': 'Expand/Collapse',
    'writing.delete.chapter': 'Delete chapter', 'writing.delete.scene': 'Delete scene',
    'writing.confirm.delete.chapter': 'Delete chapter "{title}" and all its scenes?',
    'writing.untitled': 'Untitled',
    'writing.status.draft': 'Draft', 'writing.status.revised': 'Revised', 'writing.status.done': 'Done',
    'writing.status.cycle': 'Click to change status',
    'writing.summary.placeholder': 'One line on what happens here — shows as a tooltip in the chapter list…',
    'editor.theme.toggle': 'Toggle light/dark', 'editor.search': 'Search', 'editor.close': 'Close',
    'editor.fmt.bold': 'Bold (Ctrl+B)', 'editor.fmt.italic': 'Italic (Ctrl+I)', 'editor.fmt.underline': 'Underline (Ctrl+U)',
    'editor.fmt.block': 'Paragraph format',
    'editor.fmt.normal': 'Normal text', 'editor.fmt.h1': 'Heading 1', 'editor.fmt.h2': 'Heading 2', 'editor.fmt.h3': 'Heading 3',
    'editor.insert.note': 'Note', 'editor.manuscript.placeholder': 'Write here...',
    'beats.no.template': 'No Template', 'beats.add': '+ New Beat',
    'beats.empty': 'No story beats yet.\nClick "+ New Beat" above to start.',
    'beats.slot.empty': 'No beats yet — click "+ Beat".', 'beats.add.slot': '+ Beat',
    'beats.placeholder': 'Describe this beat...',
    'beats.theme.placeholder': 'How does this beat reflect the story\'s theme?',
    'beats.write.scene': 'Write this scene',
    'beats.drafted': 'Drafted · {n} words',
    'beats.drafted.jump': 'Jump to this scene in the manuscript',
    'beats.coverage': '{n} of {m} beats drafted',
    'beats.write.newchapter': 'Chapter 1',
    'beat.drag.title': 'Drag to reorder', 'beat.delete.title': 'Delete',
    'struct.drei-akt.name': '3-Act Structure',
    'struct.drei-akt.phase.akt1.label': 'Act I – Introduction',
    'struct.drei-akt.phase.akt1.desc': 'We get to know the world before everything is set in motion.',
    'struct.drei-akt.phase.akt2.label': 'Act II – Confrontation',
    'struct.drei-akt.phase.akt2.desc': 'The protagonist struggles with mounting obstacles and hits rock bottom.',
    'struct.drei-akt.phase.akt3.label': 'Act III – Resolution',
    'struct.drei-akt.phase.akt3.desc': 'The final confrontation and its consequences.',
    'struct.save-the-cat.name': 'Save the Cat',
    'struct.save-the-cat.phase.act1.label': 'Act I – The Setup', 'struct.save-the-cat.phase.act1.desc': 'Introduce the hero and the world before everything changes.',
    'struct.save-the-cat.phase.act2.label': 'Act II – The Journey', 'struct.save-the-cat.phase.act2.desc': 'The hero navigates a new world, faces mounting threats, and hits rock bottom.',
    'struct.save-the-cat.phase.act3.label': 'Act III – The Change', 'struct.save-the-cat.phase.act3.desc': 'The hero proves their transformation by resolving the central conflict.',
    'struct.save-the-cat.beat.Opening Image.name': 'Opening Image', 'struct.save-the-cat.beat.Opening Image.desc': 'A visual snapshot showing who the hero is before everything changes.',
    'struct.save-the-cat.beat.Theme Stated.name': 'Theme Stated', 'struct.save-the-cat.beat.Theme Stated.desc': 'Another character hints at the life lesson the hero will need to learn.',
    'struct.save-the-cat.beat.Setup.name': 'Setup', 'struct.save-the-cat.beat.Setup.desc': "We explore the hero's current world, goals, flaws, and supporting cast.",
    'struct.save-the-cat.beat.Catalyst.name': 'Catalyst', 'struct.save-the-cat.beat.Catalyst.desc': "An event shatters the status quo; there's no going back now.",
    'struct.save-the-cat.beat.Debate.name': 'Debate', 'struct.save-the-cat.beat.Debate.desc': 'The hero hesitates, questioning whether to accept what comes next.',
    'struct.save-the-cat.beat.Break Into Two.name': 'Break Into Two', 'struct.save-the-cat.beat.Break Into Two.desc': 'The hero crosses over into unfamiliar territory, committing to the path.',
    'struct.save-the-cat.beat.B Story.name': 'B Story', 'struct.save-the-cat.beat.B Story.desc': "A new relationship or subplot begins that will guide the hero's growth.",
    'struct.save-the-cat.beat.Fun and Games.name': 'Fun and Games', 'struct.save-the-cat.beat.Fun and Games.desc': 'The hero navigates challenges and discoveries in this new realm.',
    'struct.save-the-cat.beat.Midpoint.name': 'Midpoint', 'struct.save-the-cat.beat.Midpoint.desc': 'A pivotal moment of false success or failure that raises the stakes dramatically.',
    'struct.save-the-cat.beat.Bad Guys Close In.name': 'Bad Guys Close In', 'struct.save-the-cat.beat.Bad Guys Close In.desc': 'External threats grow while internal flaws cause problems to multiply.',
    'struct.save-the-cat.beat.All Is Lost.name': 'All Is Lost', 'struct.save-the-cat.beat.All Is Lost.desc': "Rock bottom hits; something breaks because of the hero's own mistakes.",
    'struct.save-the-cat.beat.Dark Night of the Soul.name': 'Dark Night of the Soul', 'struct.save-the-cat.beat.Dark Night of the Soul.desc': 'The hero sits with defeat and finally sees their part in it.',
    'struct.save-the-cat.beat.Break Into Three.name': 'Break Into Three', 'struct.save-the-cat.beat.Break Into Three.desc': 'An insight sparks hope; the hero finds a way forward.',
    'struct.save-the-cat.beat.Finale.name': 'Finale', 'struct.save-the-cat.beat.Finale.desc': "The hero acts on what they've learned, resolving the main conflict.",
    'struct.save-the-cat.beat.Final Image.name': 'Final Image', 'struct.save-the-cat.beat.Final Image.desc': 'A contrasting snapshot showing how much the hero has transformed.',
    'struct.freytag.name': "Freytag's Pyramid",
    'struct.freytag.phase.exposition.label': 'Exposition', 'struct.freytag.phase.exposition.desc': 'Introduction of place, time, and characters. The world before the conflict.',
    'struct.freytag.phase.rising.label': 'Rising Action', 'struct.freytag.phase.rising.desc': 'Conflicts emerge and multiply. Tension builds.',
    'struct.freytag.phase.climax.label': 'Climax', 'struct.freytag.phase.climax.desc': 'The dramatic turning point. Everything is at stake.',
    'struct.freytag.phase.falling.label': 'Falling Action', 'struct.freytag.phase.falling.desc': 'The consequences of the climax unfold. Tension slowly releases.',
    'struct.freytag.phase.denouement.label': 'Catastrophe / Resolution', 'struct.freytag.phase.denouement.desc': 'The final resolution of all conflicts.',
    'struct.freytag.beat.Exposition.name': 'Exposition', 'struct.freytag.beat.Exposition.desc': 'Introduction of place, time, and characters. The world before the conflict.',
    'struct.freytag.beat.Erregendes Moment.name': 'Inciting Incident', 'struct.freytag.beat.Erregendes Moment.desc': 'The first conflict ignites. Tension begins to rise.',
    'struct.freytag.beat.Steigende Spannung.name': 'Rising Tension', 'struct.freytag.beat.Steigende Spannung.desc': 'Obstacles accumulate. The hero fights against growing resistance.',
    'struct.freytag.beat.Klimax.name': 'Climax', 'struct.freytag.beat.Klimax.desc': "The dramatic peak. The hero's fate hangs by a thread.",
    'struct.freytag.beat.Peripetie.name': 'Peripeteia', 'struct.freytag.beat.Peripetie.desc': 'The reversal: victory turns to defeat or vice versa.',
    'struct.freytag.beat.Fallende Handlung.name': 'Falling Action', 'struct.freytag.beat.Fallende Handlung.desc': 'The consequences of the climax unfold. Tension slowly releases.',
    'struct.freytag.beat.Verzögerungsmoment.name': 'Moment of Last Suspense', 'struct.freytag.beat.Verzögerungsmoment.desc': 'A brief flicker of hope before the end becomes clear.',
    'struct.freytag.beat.Katastrophe / Lösung.name': 'Catastrophe / Resolution', 'struct.freytag.beat.Katastrophe / Lösung.desc': 'The final resolution of all conflicts. Fate is sealed.',
    'characters.add': '+ New Character', 'characters.empty': 'No characters yet.\nClick "+ New Character" to create one.',
    'char.name.placeholder': 'Name...', 'char.desc.placeholder': 'Description, background, traits...',
    'char.add.image': 'Add image', 'char.delete': 'Delete character',
    'char.img.drag': 'Drag to reposition',
    'wb.all': 'All', 'wb.add.entry': '+ Entry', 'wb.add.category': '+ Category',
    'wb.empty': 'No entries yet.\nClick "+ Entry" to start.',
    'wb.cat.placeholder': 'New category…', 'wb.entry.title.placeholder': 'Title…', 'wb.entry.text.placeholder': 'Description, notes, details…',
    'wb.del.cat.title': 'Delete category', 'wb.del.cat.msg': '"{cat}" contains {n} entries. They will be moved to {fallback}.',
    'wb.fallback.cat': 'Miscellaneous', 'wb.img.replace': 'Replace image',
    'wb.builtin.Orte': 'Places', 'wb.builtin.Völker & Fraktionen': 'Peoples & Factions',
    'wb.builtin.Geschichte & Lore': 'History & Lore', 'wb.builtin.Magie & Technologie': 'Magic & Technology',
    'wb.builtin.Sonstiges': 'Miscellaneous',
    'moodboard.add': '+ Add Image', 'moodboard.empty': 'No images on the moodboard yet.\nClick "+ Add Image" to start.',
    'mood.comment.placeholder': 'Comment...',
    'brainstorming.add': '+ New Idea', 'brainstorming.empty': 'No ideas yet — click "+ New Idea" to start.',
    'bs2.root.placeholder': 'Enter idea…', 'bs2.child.placeholder': 'Enter thought…',
    'bs2.add.child': '+ Idea', 'bs2.add.whatif': '+ What if…', 'bs2.whatif.placeholder': 'custom scenario',
    'bs2.delete.title': 'Delete this branch?',
    'bs2.delete.msg': 'This idea has branches — deleting it also removes every idea that grew from it.',
    'bs2.delete.confirm': 'Delete',
    'notes.add': '+ Note', 'notes.note.placeholder': 'Idea...',
    'notes.empty': 'Empty canvas.\nClick "+ Note" and drag cards freely.\nUse the connect symbol to link notes into a mind map.',
    'notes.btn.link': 'Link to another note', 'notes.btn.delete': 'Delete note',
    'notes.btn.image': 'Add image', 'notes.image.remove': 'Remove image',
    'notes.link.label.placeholder': 'Label…', 'notes.link.delete': 'Delete connection',
    'notes.btn.resize': 'Drag to resize', 'notes.btn.hyperlink': 'Add hyperlink',
    'notes.hyperlink.url': 'https://…', 'notes.hyperlink.label': 'Link text (optional)',
    'notes.hyperlink.done': 'Save link', 'notes.hyperlink.edit': 'Edit link', 'notes.hyperlink.remove': 'Remove link',
    'timeline.add.col': '+ Column', 'timeline.add.row': '+ Thread',
    'timeline.col.placeholder': 'Chapter', 'timeline.row.placeholder': 'Thread',
    'timeline.card.placeholder': 'What happens here?',
    'timeline.delete.col': 'Delete column', 'timeline.delete.row': 'Delete row', 'timeline.delete.card': 'Delete card',
    'timeline.change.color': 'Change color', 'timeline.new.row': 'New thread',
    'timeline.hint': 'Add chapter columns with + top right\nand story threads (rows) with + bottom left.\nThen click a cell to place a card.',
    'theme.h1': 'Theme', 'theme.statement.title': 'Theme Statement',
    'theme.statement.placeholder': 'This story is about…',
    'theme.statement.hint': 'Formulate the core theme of your story in one sentence. Everything else builds on this.',
    'theme.deeper.title': 'Deep Dive',
    'theme.model.toggle': 'How these connect',
    'theme.model.belief.title': 'False Belief', 'theme.model.belief.sub': 'The flawed way characters see the world — the root of the conflict', 'theme.model.belief.tag': 'Starting condition',
    'theme.model.question.title': 'Central Question', 'theme.model.question.sub': 'What the story tests',
    'theme.model.statement.title': 'Statement', 'theme.model.statement.sub': 'A belief is proven right or wrong by events', 'theme.model.statement.tag': 'Narrative engine',
    'theme.model.lesson.title': 'Lesson', 'theme.model.lesson.sub': 'What the story reveals is actually true', 'theme.model.lesson.tag': "Story's truth",
    'theme.model.message.title': 'Message', 'theme.model.message.sub': 'What we want readers to take away', 'theme.model.message.tag': "Author's intention",
    'theme.q.question.label': 'The Central Question', 'theme.q.question.hint': 'What moral or philosophical question does your story pose?', 'theme.q.question.placeholder': 'e.g. Can good ends justify evil means?',
    'theme.q.claim.label': 'The Statement', 'theme.q.claim.hint': 'Which belief do your events put to the test — proving it right or wrong?', 'theme.q.claim.placeholder': 'e.g. The hero believes power brings respect — and the story disproves it.',
    'theme.q.lesson.label': 'The Lesson — What the Protagonist Learns', 'theme.q.lesson.hint': 'What inner truth does your protagonist come to understand by the end?', 'theme.q.lesson.placeholder': 'e.g. True strength lies not in winning, but in letting go.',
    'theme.q.belief.label': 'The False Belief', 'theme.q.belief.hint': 'What false belief must your protagonist overcome?', 'theme.q.belief.placeholder': 'e.g. Controlling others gives me safety.',
    'theme.q.motif.label': 'Motifs & Symbols', 'theme.q.motif.hint': 'What images, objects, or situations recur throughout your story?', 'theme.q.motif.placeholder': 'e.g. Mirrors, doors, water — symbols of self-reflection.',
    'theme.q.message.label': 'The Message', 'theme.q.message.hint': 'What does the reader take away from this story?', 'theme.q.message.placeholder': "e.g. It's never too late to change.",
    'stats.goal.label': 'Word goal', 'stats.words': 'words',
    'stats.goal.reached': 'Goal reached!', 'stats.goal.none': 'No goal set',
    'stats.goal.remaining': '{n} words left',
    'stats.chapters': 'Chapters', 'stats.scenes': 'Scenes', 'stats.characters': 'Characters',
    'stats.words.per.chapter': 'Words per chapter', 'stats.history.title': 'Writing history',
    'stats.history.empty': 'Not enough data yet — write for a few days to see your progress here.',
    'stats.no.chapters': 'No chapters yet.',
    'popover.placeholder': 'Note...', 'popover.delete': 'Delete', 'popover.done': 'Done',
    'save.modal.title': 'Save project', 'save.modal.label': 'Project name',
    'save.placeholder': 'e.g. My Novel', 'save.btn': 'Save', 'save.saving': 'Saving…', 'save.error': 'Error: Server not reachable. Is the server running?',
    'home.tagline': 'A creative writing workspace', 'home.recent': 'Recent projects',
    'home.recent.hint': 'Stored in this browser only — not your exported files. Use Export to save a copy you can keep, move, or back up.',
    'home.note.label': 'Hi!', 'home.note.text': "This is a hobby project I build in my free time, purely for fun. So it's not professional software, and there may always be the occasional bug or quirk hiding somewhere. InkTink includes features that I feel support my own creative process. That said, I'd be genuinely happy if others find InkTink useful too and want to use it! Your data stays completely with you (i.e. in your browser) — I obviously never see anything from your projects!", 'home.note.sign': '— Sarah',
    'load.modal.title': 'Load project', 'load.modal.empty': 'No saved projects found.',
    'new.modal.title': 'New project', 'new.modal.confirm': 'Unsaved changes will be lost. Continue?',
    'ideas.tagline': 'Find the minimum structure you need to start writing — without sinking too much time into planning.',
    'ideas.have.title': 'What do you already have?',
    'ideas.step.have': 'You have', 'ideas.step.q': 'Question',
    'ideas.answer.placeholder': 'Write freely — even half a thought counts.',
    'ideas.back': '← Back', 'ideas.skip': "Don't know — skip", 'ideas.next': 'Next',
    'ideas.done': 'Done', 'ideas.done.empty': 'Nothing noted yet — go back and fill in a few answers.',
    'ideas.to.notes': 'Send to Notes', 'ideas.to.character': 'Save as Character Entry', 'ideas.restart': 'Another starting point',
    'ideas.seed': 'Seed project structure',
    'ideas.seed.title': 'Your premise becomes the project description; beginning, middle & end become story beats.',
    'ideas.seed.done': 'Added to your project ✓',
    'ideas.seed.beginning': 'Beginning:', 'ideas.seed.middle': 'Middle:', 'ideas.seed.end': 'End:',
    'flow.keep': 'Keep this → send to Notes',
    'flow.keep.done': 'Saved to Notes ✓',
    'ideas.develop.field': 'Field', 'ideas.develop.finish': 'Finish',
    'ideas.develop.sidebar.title': 'Conclusions so far',
    'ideas.develop.empty': 'Not written yet.',
    'ideas.section.find': 'Find & Develop Ideas', 'ideas.section.flow': 'Get Words Flowing',
    'flow.tagline': 'You don\'t need a finished idea or your "real" style to start. These are just for loosening up — nothing here has to be good.',
    'flow.home.title': 'Pick a way in',
    'flow.back': '← Home',
    'flow.min': 'min', 'flow.shuffle': 'New prompt', 'flow.words': 'words',
    'flow.start': 'Start', 'flow.pause': 'Pause', 'flow.done': 'Done', 'flow.again': 'Try another',
    'flow.freewrite.title': 'Freewrite Timer', 'flow.freewrite.sub': 'Set a timer, get a prompt, and just keep writing — no editing, no judging.',
    'flow.freewrite.placeholder': "Don't stop to fix anything. Keep going, even if it's bad — especially if it's bad.",
    'flow.freewrite.done.msg': "Time's up. However many words that was, you proved you can start without a plan — that's the whole point.",
    'flow.badly.title': 'Write It Badly First', 'flow.badly.sub': 'Deliberately write the worst version of a scene. It removes the pressure to be good.',
    'flow.badly.instr1': 'Write the worst, most clichéd version of this scene you can manage. Lean into every cliché — overwrought, melodramatic, cringe. That is the goal here.',
    'flow.badly.instr2': 'Now write it again — just a little less bad this time. Keep one thing from your first try that you secretly liked.',
    'flow.badly.placeholder': 'Go on, make it terrible...',
    'flow.badly.next': 'Now, slightly less bad →',
    'flow.badly.done.msg': "Two drafts in, and the second one already has more of you in it than a blank page ever could. That's how style actually shows up — through bad first drafts, not around them.",
    'flow.style.title': 'Style Sampler', 'flow.style.sub': 'See the same short scene written in a few different voices — then try one of your own.',
    'flow.style.scene': 'Scene',
    'flow.style.yourturn': 'Your turn — write your own version',
    'flow.style.placeholder': "Borrow a voice that pulled at you, or land somewhere between two of them...",
    'new.modal.create': 'Create new project', 'btn.cancel': 'Cancel',
  },
  de: {
    'btn.new': 'Neu', 'btn.save': 'Speichern', 'btn.load': 'Laden',
    'btn.export': 'Export', 'btn.import': 'Import',
    'btn.export.title': 'Dieses Projekt als .json-Datei herunterladen',
    'btn.import.title': 'Ein Projekt aus einer .json-Datei öffnen',
    'import.error': 'Diese Datei konnte nicht gelesen werden.',
    'nav.writing': 'Manuskript', 'nav.notes': 'Notizen', 'nav.moodboard': 'Moodboard',
    'nav.theme': 'Thema', 'nav.brainstorming': 'Ideen-Baum', 'nav.ideas': 'Impulse', 'nav.beats': 'Story Beats',
    'nav.timeline': 'Zeitstrahl', 'nav.characters': 'Charaktere', 'nav.worldbuilding': 'Weltenbau', 'nav.stats': 'Statistiken',
    'nav.ideapool': 'Ideen-Pool',
    'ideapool.tagline': 'Ein Zuhause für jede Idee, damit keine mehr in deinem Kopf herumspukt. Sammle sie, schau welche zusammenpassen, und wähle eine zum Weitermachen aus.',
    'ideapool.capture.placeholder': 'Neue Projektidee — Enter drücken',
    'ideapool.add': '+ Hinzufügen',
    'ideapool.focus.label': 'Dein Fokus gerade',
    'ideapool.focus.none': 'Noch kein Fokus gewählt. Wenn dich eine neue Idee zieht, wirf sie oben rein — wähle dann eine Idee als Fokus und lass die anderen ruhen.',
    'ideapool.focus.set': 'Das ist mein Fokus',
    'ideapool.focus.clear': 'Fokus aufheben',
    'ideapool.focus.parked': 'Geparkt, während du dich konzentrierst — wartet hier auf dich.',
    'ideapool.sort.label': 'Sortieren:',
    'ideapool.sort.created': 'Neueste',
    'ideapool.sort.spark': 'Spannendste',
    'ideapool.sort.ready': 'Startklarste',
    'ideapool.sort.sweet': 'Startklar & spannend',
    'ideapool.pick': '🎲 Entscheide für mich',
    'ideapool.suggest': 'Wie wäre es mit der hier? Mach sie zum Fokus, oder würfle nochmal.',
    'ideapool.combine': '⊕ Kombinieren',
    'ideapool.combine.hint': 'Wähle zwei oder mehr Ideen und füge sie zu einer neuen zusammen.',
    'ideapool.combine.do': 'Auswahl zusammenführen',
    'ideapool.combine.cancel': 'Abbrechen',
    'ideapool.combined.from': 'Kombiniert aus:',
    'ideapool.spark': 'Lust darauf',
    'ideapool.ready': 'Startklar',
    'ideapool.title.placeholder': 'Titel der Idee',
    'ideapool.note.placeholder': 'Notizen, Fragmente, warum sie dich reizt…',
    'ideapool.image.add': '+ Bild hinzufügen',
    'ideapool.image.remove': 'Bild entfernen',
    'ideapool.image.recrop': 'Ausschnitt anpassen',
    'ideapool.image.crop.title': 'Wähle den Bildausschnitt',
    'ideapool.image.crop.use': 'Ausschnitt übernehmen',
    'ideapool.link.placeholder': 'Link (z. B. Inspiration, Referenz)',
    'ideapool.link.open': '↗ Link öffnen',
    'ideapool.delete': 'Idee löschen',
    'ideapool.empty': 'Noch keine Ideen — fang oben mit der ersten an.',
    'ideapool.toproject': '→ Als Projekt starten',
    'ideapool.toproject.title': 'Als neues Projekt starten',
    'ideapool.toproject.confirm': 'Diese Idee als neues Projekt starten? Ihre Notiz wird zur Projektbeschreibung. Nicht gespeicherte Änderungen am aktuellen Projekt gehen verloren.',
    'ideapool.toproject.go': 'Projekt erstellen',
    'ideapool.toproject.keep': 'Idee im Pool behalten',
    'sidebar.inspiration': 'Inspiration', 'sidebar.todo': 'To-do',
    'sidebar.todo.placeholder': 'Neue Aufgabe + Enter', 'sidebar.insp.empty': 'Bilder als Inspiration hinzufügen (+)',
    'project.untitled': 'Unbenanntes Projekt', 'project.blurb.placeholder': "Worum geht's? Kurze Beschreibung deines Projekts...",
    'save.warning': '⚠️ Speichern fehlgeschlagen — der Browser-Speicher ist voll. Deine letzten Änderungen sind NICHT gespeichert. Entferne einige Bilder oder lade jetzt ein Backup herunter.',
    'save.warning.backup': 'Backup herunterladen',
    'writing.export.docx': 'Als Word-Dokument exportieren (.docx)',
    'writing.untitled.chapter': 'Unbenanntes Kapitel',
    'writing.untitled.scene': 'Unbenannte Szene',
    'export.docx.unavailable': 'Das Word-Export-Modul ist noch nicht geladen. Einmal online gehen und die Seite neu laden, dann erneut versuchen.',
    'writing.sections': 'Kapitel & Szenen', 'writing.add.chapter': '+ Kapitel',
    'writing.empty.chapters': 'Noch keine Kapitel.\nLege oben ein Kapitel an.',
    'writing.empty.scene': 'Wähle links eine Szene aus\noder lege eine neue an, um zu schreiben.',
    'writing.empty.scene.short': 'Wähle links eine Szene aus.',
    'writing.add.scene': '+ Szene',
    'writing.chapter.placeholder': 'Kapitelname', 'writing.scene.placeholder': 'Szenenname',
    'writing.scene.title.placeholder': 'Szenentitel', 'writing.search.placeholder': 'In allen Szenen suchen...',
    'writing.words': 'Wörter', 'writing.search.noresult': 'Keine Treffer',
    'writing.drag.chapter': 'Kapitel verschieben', 'writing.drag.scene': 'Szene verschieben',
    'writing.collapse': 'Ein-/Ausklappen',
    'writing.delete.chapter': 'Kapitel löschen', 'writing.delete.scene': 'Szene löschen',
    'writing.confirm.delete.chapter': 'Kapitel „{title}" und alle seine Szenen löschen?',
    'writing.untitled': 'ohne Titel',
    'writing.status.draft': 'Entwurf', 'writing.status.revised': 'Überarbeitet', 'writing.status.done': 'Fertig',
    'writing.status.cycle': 'Klicken, um den Status zu wechseln',
    'writing.summary.placeholder': 'Ein Satz dazu, was hier passiert — erscheint als Tooltip in der Kapitelliste…',
    'editor.theme.toggle': 'Hell/Dunkel umschalten', 'editor.search': 'Suchen', 'editor.close': 'Schließen',
    'editor.fmt.bold': 'Fett (Strg+B)', 'editor.fmt.italic': 'Kursiv (Strg+I)', 'editor.fmt.underline': 'Unterstrichen (Strg+U)',
    'editor.fmt.block': 'Absatzformat',
    'editor.fmt.normal': 'Normaler Text', 'editor.fmt.h1': 'Überschrift 1', 'editor.fmt.h2': 'Überschrift 2', 'editor.fmt.h3': 'Überschrift 3',
    'editor.insert.note': 'Notiz', 'editor.manuscript.placeholder': 'Hier schreiben...',
    'beats.no.template': 'Kein Template', 'beats.add': '+ Neuer Beat',
    'beats.empty': 'Noch keine Story Beats.\nKlicke oben auf "+ Neuer Beat" um zu starten.',
    'beats.slot.empty': 'Noch kein Beat — klicke "+ Beat".', 'beats.add.slot': '+ Beat',
    'beats.placeholder': 'Beat beschreiben...',
    'beats.theme.placeholder': 'Wie spiegelt dieser Beat das Thema der Geschichte wider?',
    'beats.write.scene': 'Diese Szene schreiben',
    'beats.drafted': 'Geschrieben · {n} Wörter',
    'beats.drafted.jump': 'Zu dieser Szene im Manuskript springen',
    'beats.coverage': '{n} von {m} Beats geschrieben',
    'beats.write.newchapter': 'Kapitel 1',
    'beat.drag.title': 'Ziehen zum Umsortieren', 'beat.delete.title': 'Löschen',
    'struct.drei-akt.name': '3-Akt-Struktur',
    'struct.drei-akt.phase.akt1.label': 'Akt I – Einführung', 'struct.drei-akt.phase.akt1.desc': 'Wir lernen die Welt kennen, bevor alles in Bewegung gerät.',
    'struct.drei-akt.phase.akt2.label': 'Akt II – Konfrontation', 'struct.drei-akt.phase.akt2.desc': 'Der Protagonist kämpft mit wachsenden Hindernissen und erreicht seinen Tiefpunkt.',
    'struct.drei-akt.phase.akt3.label': 'Akt III – Auflösung', 'struct.drei-akt.phase.akt3.desc': 'Die finale Konfrontation und ihre Konsequenzen.',
    'struct.save-the-cat.name': 'Save the Cat',
    'struct.save-the-cat.phase.act1.label': 'Akt I – Die Einrichtung', 'struct.save-the-cat.phase.act1.desc': 'Stelle den Helden und die Welt vor, bevor sich alles ändert.',
    'struct.save-the-cat.phase.act2.label': 'Akt II – Die Reise', 'struct.save-the-cat.phase.act2.desc': 'Der Held bewegt sich durch eine neue Welt, trifft auf wachsende Bedrohungen und erreicht den Tiefpunkt.',
    'struct.save-the-cat.phase.act3.label': 'Akt III – Die Wandlung', 'struct.save-the-cat.phase.act3.desc': 'Der Held beweist seine Wandlung, indem er den zentralen Konflikt löst.',
    'struct.save-the-cat.beat.Opening Image.name': 'Eröffnungsbild', 'struct.save-the-cat.beat.Opening Image.desc': 'Ein visueller Schnappschuss, der zeigt, wer der Held ist, bevor sich alles ändert.',
    'struct.save-the-cat.beat.Theme Stated.name': 'Thema benannt', 'struct.save-the-cat.beat.Theme Stated.desc': 'Eine andere Figur deutet die Lebenslektion an, die der Held lernen muss.',
    'struct.save-the-cat.beat.Setup.name': 'Einrichtung', 'struct.save-the-cat.beat.Setup.desc': 'Wir erkunden die aktuelle Welt des Helden, seine Ziele, Schwächen und Nebenfiguren.',
    'struct.save-the-cat.beat.Catalyst.name': 'Katalysator', 'struct.save-the-cat.beat.Catalyst.desc': 'Ein Ereignis zerstört den Status quo; es gibt kein Zurück mehr.',
    'struct.save-the-cat.beat.Debate.name': 'Zögern', 'struct.save-the-cat.beat.Debate.desc': 'Der Held zögert und fragt sich, ob er das Kommende annehmen soll.',
    'struct.save-the-cat.beat.Break Into Two.name': 'Aufbruch in die zweite Welt', 'struct.save-the-cat.beat.Break Into Two.desc': 'Der Held betritt unbekanntes Terrain und verpflichtet sich dem Weg.',
    'struct.save-the-cat.beat.B Story.name': 'B-Handlung', 'struct.save-the-cat.beat.B Story.desc': 'Eine neue Beziehung oder ein Nebenstrang beginnt, der das Wachstum des Helden leitet.',
    'struct.save-the-cat.beat.Fun and Games.name': 'Spiel und Spaß', 'struct.save-the-cat.beat.Fun and Games.desc': 'Der Held meistert Herausforderungen und Entdeckungen in dieser neuen Welt.',
    'struct.save-the-cat.beat.Midpoint.name': 'Mittelpunkt', 'struct.save-the-cat.beat.Midpoint.desc': 'Ein entscheidender Moment falschen Erfolgs oder Scheiterns, der den Einsatz dramatisch erhöht.',
    'struct.save-the-cat.beat.Bad Guys Close In.name': 'Die Gegner rücken näher', 'struct.save-the-cat.beat.Bad Guys Close In.desc': 'Äußere Bedrohungen wachsen, während innere Schwächen die Probleme vervielfachen.',
    'struct.save-the-cat.beat.All Is Lost.name': 'Alles ist verloren', 'struct.save-the-cat.beat.All Is Lost.desc': 'Der Tiefpunkt ist erreicht; etwas zerbricht durch die eigenen Fehler des Helden.',
    'struct.save-the-cat.beat.Dark Night of the Soul.name': 'Dunkle Nacht der Seele', 'struct.save-the-cat.beat.Dark Night of the Soul.desc': 'Der Held verharrt in der Niederlage und erkennt endlich seinen Anteil daran.',
    'struct.save-the-cat.beat.Break Into Three.name': 'Aufbruch in den dritten Akt', 'struct.save-the-cat.beat.Break Into Three.desc': 'Eine Erkenntnis weckt Hoffnung; der Held findet einen Weg nach vorn.',
    'struct.save-the-cat.beat.Finale.name': 'Finale', 'struct.save-the-cat.beat.Finale.desc': 'Der Held handelt nach dem, was er gelernt hat, und löst den Hauptkonflikt.',
    'struct.save-the-cat.beat.Final Image.name': 'Schlussbild', 'struct.save-the-cat.beat.Final Image.desc': 'Ein kontrastierender Schnappschuss, der zeigt, wie sehr sich der Held gewandelt hat.',
    'struct.freytag.name': "Freytags Pyramide",
    'struct.freytag.phase.exposition.label': 'Exposition', 'struct.freytag.phase.exposition.desc': 'Einführung von Ort, Zeit und Figuren. Die Welt vor dem Konflikt.',
    'struct.freytag.phase.rising.label': 'Steigende Handlung', 'struct.freytag.phase.rising.desc': 'Konflikte entstehen und häufen sich. Die Spannung baut sich auf.',
    'struct.freytag.phase.climax.label': 'Höhepunkt', 'struct.freytag.phase.climax.desc': 'Der dramatische Wendepunkt. Alles steht auf dem Spiel.',
    'struct.freytag.phase.falling.label': 'Fallende Handlung', 'struct.freytag.phase.falling.desc': 'Die Konsequenzen des Höhepunkts. Die Spannung löst sich langsam.',
    'struct.freytag.phase.denouement.label': 'Katastrophe / Lösung', 'struct.freytag.phase.denouement.desc': 'Die endgültige Auflösung aller Konflikte.',
    'struct.freytag.beat.Exposition.name': 'Exposition', 'struct.freytag.beat.Exposition.desc': 'Einführung in Ort, Zeit und Figuren. Die Welt vor dem Konflikt.',
    'struct.freytag.beat.Erregendes Moment.name': 'Erregendes Moment', 'struct.freytag.beat.Erregendes Moment.desc': 'Der erste Konflikt entzündet sich. Die Spannung beginnt zu steigen.',
    'struct.freytag.beat.Steigende Spannung.name': 'Steigende Spannung', 'struct.freytag.beat.Steigende Spannung.desc': 'Hindernisse häufen sich. Der Held kämpft gegen wachsenden Widerstand.',
    'struct.freytag.beat.Klimax.name': 'Klimax', 'struct.freytag.beat.Klimax.desc': 'Der dramatische Höhepunkt. Das Schicksal des Helden hängt am seidenen Faden.',
    'struct.freytag.beat.Peripetie.name': 'Peripetie', 'struct.freytag.beat.Peripetie.desc': 'Der Umschwung: Aus Sieg wird Niederlage oder umgekehrt.',
    'struct.freytag.beat.Fallende Handlung.name': 'Fallende Handlung', 'struct.freytag.beat.Fallende Handlung.desc': 'Die Konsequenzen des Klimax entfalten sich. Die Spannung löst sich langsam.',
    'struct.freytag.beat.Verzögerungsmoment.name': 'Verzögerungsmoment', 'struct.freytag.beat.Verzögerungsmoment.desc': 'Ein kurzes Aufflackern von Hoffnung, bevor das Ende klar wird.',
    'struct.freytag.beat.Katastrophe / Lösung.name': 'Katastrophe / Lösung', 'struct.freytag.beat.Katastrophe / Lösung.desc': 'Die endgültige Auflösung aller Konflikte. Das Schicksal ist besiegelt.',
    'characters.add': '+ Neuer Charakter', 'characters.empty': 'Noch keine Charaktere.\nKlicke auf "+ Neuer Charakter" um einen anzulegen.',
    'char.name.placeholder': 'Name...', 'char.desc.placeholder': 'Beschreibung, Hintergrund, Eigenschaften...',
    'char.add.image': 'Bild hinzufügen', 'char.delete': 'Charakter löschen',
    'char.img.drag': 'Ziehen zum Positionieren',
    'wb.all': 'Alle', 'wb.add.entry': '+ Eintrag', 'wb.add.category': '+ Kategorie',
    'wb.empty': 'Noch keine Einträge.\nKlicke auf "+ Eintrag" um zu starten.',
    'wb.cat.placeholder': 'Neue Kategorie…', 'wb.entry.title.placeholder': 'Titel…', 'wb.entry.text.placeholder': 'Beschreibung, Notizen, Details…',
    'wb.del.cat.title': 'Kategorie löschen', 'wb.del.cat.msg': '„{cat}" enthält {n} Einträge. Diese werden nach {fallback} verschoben.',
    'wb.fallback.cat': 'Sonstiges', 'wb.img.replace': 'Bild ersetzen',
    'wb.builtin.Orte': 'Orte', 'wb.builtin.Völker & Fraktionen': 'Völker & Fraktionen',
    'wb.builtin.Geschichte & Lore': 'Geschichte & Lore', 'wb.builtin.Magie & Technologie': 'Magie & Technologie',
    'wb.builtin.Sonstiges': 'Sonstiges',
    'moodboard.add': '+ Bild hinzufügen', 'moodboard.empty': 'Noch keine Bilder auf dem Moodboard.\nKlicke auf "+ Bild hinzufügen" um zu starten.',
    'mood.comment.placeholder': 'Kommentar...',
    'brainstorming.add': '+ Neue Idee', 'brainstorming.empty': 'Noch keine Ideen — klicke "+ Neue Idee" um zu starten.',
    'bs2.root.placeholder': 'Idee eingeben…', 'bs2.child.placeholder': 'Gedanke eingeben…',
    'bs2.add.child': '+ Idee', 'bs2.add.whatif': '+ Was wäre wenn…', 'bs2.whatif.placeholder': 'eigenes Szenario',
    'bs2.delete.title': 'Diesen Zweig löschen?',
    'bs2.delete.msg': 'Diese Idee hat Verzweigungen — beim Löschen verschwinden auch alle Ideen, die daraus entstanden sind.',
    'bs2.delete.confirm': 'Löschen',
    'notes.add': '+ Notiz', 'notes.note.placeholder': 'Idee...',
    'notes.empty': 'Leere Leinwand.\nKlicke auf "+ Notiz" und ziehe die Karten frei herum.\nÜber das Verbinden-Symbol lassen sich Notizen zu einer Mindmap verknüpfen.',
    'notes.btn.link': 'Mit anderer Notiz verbinden', 'notes.btn.delete': 'Notiz löschen',
    'notes.btn.image': 'Bild hinzufügen', 'notes.image.remove': 'Bild entfernen',
    'notes.link.label.placeholder': 'Beschriftung…', 'notes.link.delete': 'Verbindung löschen',
    'notes.btn.resize': 'Zum Skalieren ziehen', 'notes.btn.hyperlink': 'Hyperlink hinzufügen',
    'notes.hyperlink.url': 'https://…', 'notes.hyperlink.label': 'Linktext (optional)',
    'notes.hyperlink.done': 'Link speichern', 'notes.hyperlink.edit': 'Link bearbeiten', 'notes.hyperlink.remove': 'Link entfernen',
    'timeline.add.col': '+ Spalte', 'timeline.add.row': '+ Strang',
    'timeline.col.placeholder': 'Kapitel', 'timeline.row.placeholder': 'Strang',
    'timeline.card.placeholder': 'Was passiert hier?',
    'timeline.delete.col': 'Kapitel-Spalte löschen', 'timeline.delete.row': 'Strang löschen', 'timeline.delete.card': 'Karte löschen',
    'timeline.change.color': 'Farbe wechseln', 'timeline.new.row': 'Neuer Strang',
    'timeline.hint': 'Lege mit + oben rechts Kapitel-Spalten an\nund mit + unten links Story-Stränge (Zeilen).\nDann klicke in eine Zelle, um eine Karte zu setzen.',
    'theme.h1': 'Theme', 'theme.statement.title': 'Thema-Satz',
    'theme.statement.placeholder': 'Diese Geschichte handelt von…',
    'theme.statement.hint': 'Formuliere das Kernthema deiner Geschichte in einem Satz. Alles andere baut darauf auf.',
    'theme.deeper.title': 'Vertiefung',
    'theme.model.toggle': 'Wie das zusammenhängt',
    'theme.model.belief.title': 'Falsche Überzeugung', 'theme.model.belief.sub': 'Die fehlerhafte Sicht der Figuren auf die Welt — der Ursprung des Konflikts', 'theme.model.belief.tag': 'Ausgangslage',
    'theme.model.question.title': 'Zentrale Frage', 'theme.model.question.sub': 'Was die Geschichte auf die Probe stellt',
    'theme.model.statement.title': 'Behauptung', 'theme.model.statement.sub': 'Eine Überzeugung wird durch die Ereignisse bestätigt oder widerlegt', 'theme.model.statement.tag': 'Erzählmotor',
    'theme.model.lesson.title': 'Lektion', 'theme.model.lesson.sub': 'Was die Geschichte als wahr enthüllt', 'theme.model.lesson.tag': 'Wahrheit der Geschichte',
    'theme.model.message.title': 'Botschaft', 'theme.model.message.sub': 'Was die Leser mitnehmen sollen', 'theme.model.message.tag': 'Absicht der Autorin',
    'theme.q.question.label': 'Die zentrale Frage', 'theme.q.question.hint': 'Welche moralische oder philosophische Frage stellt deine Geschichte?', 'theme.q.question.placeholder': 'z.B. Kann man Böses tun, wenn man das Gute will?',
    'theme.q.claim.label': 'Die Behauptung', 'theme.q.claim.hint': 'Welche Überzeugung stellen deine Ereignisse auf die Probe — und bestätigen oder widerlegen sie?', 'theme.q.claim.placeholder': 'z.B. Der Held glaubt, Macht bringe Respekt — und die Geschichte widerlegt es.',
    'theme.q.lesson.label': 'Die Lektion — Was der Protagonist lernt', 'theme.q.lesson.hint': 'Welche innere Wahrheit erkennt dein Protagonist am Ende?', 'theme.q.lesson.placeholder': 'z.B. Wahre Stärke liegt nicht im Sieg, sondern im Loslassen.',
    'theme.q.belief.label': 'Die falsche Überzeugung', 'theme.q.belief.hint': 'Welche Überzeugung muss dein Protagonist überwinden?', 'theme.q.belief.placeholder': 'z.B. Kontrolle über andere gibt mir Sicherheit.',
    'theme.q.motif.label': 'Motive & Symbole', 'theme.q.motif.hint': 'Welche Bilder, Objekte oder Situationen kehren in deiner Geschichte immer wieder?', 'theme.q.motif.placeholder': 'z.B. Spiegel, Türen, Wasser — Symbole für Selbstreflexion.',
    'theme.q.message.label': 'Die Botschaft', 'theme.q.message.hint': 'Was nimmst du als Leser aus dieser Geschichte mit?', 'theme.q.message.placeholder': 'z.B. Es ist nie zu spät, sich zu verändern.',
    'stats.goal.label': 'Schreibziel', 'stats.words': 'Wörter',
    'stats.goal.reached': 'Ziel erreicht!', 'stats.goal.none': 'Kein Ziel gesetzt',
    'stats.goal.remaining': 'noch {n} Wörter',
    'stats.chapters': 'Kapitel', 'stats.scenes': 'Szenen', 'stats.characters': 'Charaktere',
    'stats.words.per.chapter': 'Wörter pro Kapitel', 'stats.history.title': 'Schreibverlauf',
    'stats.history.empty': 'Noch zu wenig Daten — schreib ein paar Tage, dann erscheint hier dein Verlauf.',
    'stats.no.chapters': 'Noch keine Kapitel.',
    'popover.placeholder': 'Notiz...', 'popover.delete': 'Löschen', 'popover.done': 'Fertig',
    'save.modal.title': 'Projekt speichern', 'save.modal.label': 'Projektname',
    'save.placeholder': 'z.B. Mein Roman', 'save.btn': 'Speichern', 'save.saving': 'Speichert…', 'save.error': 'Fehler: Server nicht erreichbar. Läuft der Server noch?',
    'home.tagline': 'Ein kreatives Schreibwerkzeug', 'home.recent': 'Zuletzt geöffnet',
    'home.recent.hint': 'Nur in diesem Browser gespeichert — nicht deine exportierten Dateien. Nutze Export, um eine Kopie zu sichern, die du behalten, verschieben oder sichern kannst.',
    'home.note.label': 'Hi!', 'home.note.text': 'Dies ist ein Hobbyprojekt, welches ich in meiner Freizeit rein zum Spaß entwickle. Dementsprechend ist dies kein professionelles Programm und es können sich immer mal Fehler oder Eigenarten verstecken. InkTink beinhaltet Funktionen, von denen ich denke, dass sie meinen persönlichen kreativen Prozess unterstützen. Ich freue mich allerdings total, wenn andere InkTink auch hilfreich finden und es nutzen! Eure Daten bleiben komplett bei euch (bzw. in eurem Browser), d.h. ich sehe von euren Projekten natürlich nichts!', 'home.note.sign': '— Sarah',
    'load.modal.title': 'Projekt laden', 'load.modal.empty': 'Keine gespeicherten Projekte vorhanden.',
    'new.modal.title': 'Neues Projekt', 'new.modal.confirm': 'Nicht gespeicherte Änderungen gehen verloren. Trotzdem fortfahren?',
    'ideas.tagline': 'Finde die minimale Struktur, die du zum Losschreiben brauchst — ohne zu viel Zeit in die Planung zu stecken.',
    'ideas.have.title': 'Was hast du schon?',
    'ideas.step.have': 'Du hast', 'ideas.step.q': 'Frage',
    'ideas.answer.placeholder': 'Schreib frei — auch ein halber Gedanke zählt.',
    'ideas.back': '← Zurück', 'ideas.skip': 'Weiß nicht — überspringen', 'ideas.next': 'Weiter',
    'ideas.done': 'Geschafft', 'ideas.done.empty': 'Noch nichts notiert — geh zurück und füll ein paar Antworten aus.',
    'ideas.to.notes': 'An Notizen schicken', 'ideas.to.character': 'Als Charaktereintrag speichern', 'ideas.restart': 'Anderer Startpunkt',
    'ideas.seed': 'Struktur ins Projekt übernehmen',
    'ideas.seed.title': 'Deine Prämisse wird zur Projektbeschreibung; Anfang, Mitte & Ende werden Story Beats.',
    'ideas.seed.done': 'Ins Projekt übernommen ✓',
    'ideas.seed.beginning': 'Anfang:', 'ideas.seed.middle': 'Mitte:', 'ideas.seed.end': 'Ende:',
    'flow.keep': 'Behalten → an Notizen schicken',
    'flow.keep.done': 'In den Notizen ✓',
    'ideas.develop.field': 'Feld', 'ideas.develop.finish': 'Abschließen',
    'ideas.develop.sidebar.title': 'Bisherige Conclusions',
    'ideas.develop.empty': 'Noch nicht ausgefüllt.',
    'ideas.section.find': 'Ideen finden und entwickeln', 'ideas.section.flow': 'Ins Schreiben kommen',
    'flow.tagline': 'Du brauchst weder eine fertige Idee noch deinen „echten“ Stil, um anzufangen. Das hier ist nur zum Lockern — nichts davon muss gut sein.',
    'flow.home.title': 'Wähl dir einen Einstieg',
    'flow.back': '← Zurück',
    'flow.min': 'Min', 'flow.shuffle': 'Neuer Impuls', 'flow.words': 'Wörter',
    'flow.start': 'Start', 'flow.pause': 'Pause', 'flow.done': 'Geschafft', 'flow.again': 'Nochmal',
    'flow.freewrite.title': 'Freewrite-Timer', 'flow.freewrite.sub': 'Stell einen Timer, bekomm einen Impuls und schreib einfach weiter — ohne zu redigieren, ohne zu urteilen.',
    'flow.freewrite.placeholder': 'Hör nicht auf zu schreiben, um etwas zu verbessern. Schreib weiter, auch wenn es schlecht ist — vor allem dann.',
    'flow.freewrite.done.msg': 'Zeit abgelaufen. Egal wie viele Wörter es waren — du hast bewiesen, dass du ohne Plan anfangen kannst. Genau darum geht es.',
    'flow.badly.title': 'Erst bewusst schlecht schreiben', 'flow.badly.sub': 'Schreib absichtlich die schlechteste Version einer Szene. Das nimmt den Druck, gut sein zu müssen.',
    'flow.badly.instr1': 'Schreib die schlechteste, klischeehafteste Version dieser Szene, die du schaffst. Geh voll in jedes Klischee rein — überzogen, melodramatisch, peinlich. Genau das ist hier das Ziel.',
    'flow.badly.instr2': 'Schreib sie jetzt noch einmal — diesmal nur ein bisschen weniger schlecht. Behalte eine Sache aus deinem ersten Versuch, die dir heimlich gefallen hat.',
    'flow.badly.placeholder': 'Los, mach es furchtbar...',
    'flow.badly.next': 'Jetzt etwas weniger schlecht →',
    'flow.badly.done.msg': 'Zwei Entwürfe weiter, und im zweiten steckt schon mehr von dir als ein leeres Blatt je hätte zeigen können. So zeigt sich Stil tatsächlich — durch schlechte erste Entwürfe, nicht trotz ihnen.',
    'flow.style.title': 'Stil-Sampler', 'flow.style.sub': 'Sieh dieselbe kurze Szene in ein paar unterschiedlichen Stimmen geschrieben — und probier dann deine eigene.',
    'flow.style.scene': 'Szene',
    'flow.style.yourturn': 'Du bist dran — schreib deine eigene Version',
    'flow.style.placeholder': 'Leih dir eine Stimme, die dich angesprochen hat, oder finde etwas dazwischen...',
    'new.modal.create': 'Neues Projekt erstellen', 'btn.cancel': 'Abbrechen',
  },
};

function t(key) {
  return (TR[currentLang] && TR[currentLang][key]) ?? TR.en[key] ?? key;
}

function ts(structKey, subKey, fallback) {
  return TR[currentLang]?.['struct.' + structKey + '.' + subKey] ?? fallback;
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-tooltip]').forEach(el => { el.dataset.tooltip = t(el.dataset.i18nTooltip); });
  const blurb = document.getElementById('project-blurb');
  if (blurb) blurb.placeholder = t('project.blurb.placeholder');
  const exportWordBtn = document.getElementById('btn-export-word');
  if (exportWordBtn) exportWordBtn.title = t('writing.export.docx');
  const todoInput = document.getElementById('todo-input');
  if (todoInput) todoInput.placeholder = t('sidebar.todo.placeholder');
  const notePopoverTextEl = document.getElementById('note-popover-text');
  if (notePopoverTextEl) notePopoverTextEl.placeholder = t('popover.placeholder');
  const langBtn = document.getElementById('lang-toggle');
  if (langBtn) langBtn.textContent = currentLang === 'en' ? 'DE' : 'EN';
  updateProjectLabel();
}

function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('inktink-lang', lang);
  applyI18n();
  if (typeof renderInspiration === 'function') renderInspiration();
  if (typeof renderTodos === 'function') renderTodos();
  if (typeof renderChapterTree === 'function') renderChapterTree();
  if (typeof renderEditor === 'function') renderEditor();
  const activePage = document.querySelector('.page.active');
  if (activePage) switchPage(activePage.id.replace('page-', ''));
}

// ══════════════════════════════════
// ── FIND IDEAS (guided, for when you're stuck) ──
// ══════════════════════════════════
// Each starter is a path: you pick what you already have, then answer one
// question at a time until you've built something concrete. Content is kept
// here (not in TR) so each language's flow reads as a whole.
const IDEA_ICONS = {
  user:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  spark:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></svg>',
  layers:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
  tree:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
};

// 'ideapool' and 'brainstorming' are handled specially in ideaHome() — they
// open inline tools instead of a guided workshop — but ride along on the same
// starter card grid and icon/meta lookup as 'develop' and 'char'.
const IDEA_STARTERS = ['develop', 'char', 'brainstorming', 'ideapool'];

// Metadata for the starter cards on the "Find & Develop Ideas" home screen.
// The actual field content for the two guided workshops lives in IDEA_WORKSHOP_FIELDS.
const IDEA_WORKSHOP_META = {
  en: {
    develop: { icon: 'spark', title: 'Develop the Initial Idea', sub: 'Turn scattered notes into a workable foundation',
      doneClose: 'You have worked your initial idea into a premise, a moodboard-driven set of ideas, your main characters, and a structure with rising stakes.' },
    char: { icon: 'user', title: 'Who Is My Character', sub: 'What drives the character',
      doneClose: 'You have worked out what set your character\'s story in motion, what holds them in place, what they\'re already up against, and why we\'d follow them.' },
    ideapool: { icon: 'layers', title: 'Idea Pool', sub: 'Too many project ideas at once? Collect, combine, and choose what to focus on' },
    brainstorming: { icon: 'tree', title: 'Idea Tree', sub: 'Branch one idea into a tree with Why?, What if…, and And then?' },
  },
  de: {
    develop: { icon: 'spark', title: 'Erste Idee ausarbeiten', sub: 'Mach aus verstreuten Notizen ein tragfähiges Fundament',
      doneClose: 'Aus deiner ersten Idee sind eine Prämisse, vom Moodboard inspirierte Ideen, deine Hauptcharaktere und eine Struktur mit steigendem Konflikt geworden.' },
    char: { icon: 'user', title: 'Wer ist mein Charakter', sub: 'Was den Charakter antreibt',
      doneClose: 'Du hast herausgearbeitet, was die Geschichte deines Charakters ins Rollen brachte, was ihn in der Patt-Situation hält, womit er bereits zu kämpfen hat und warum wir ihn begleiten wollen.' },
    ideapool: { icon: 'layers', title: 'Ideen-Pool', sub: 'Zu viele Projektideen im Kopf? Sammeln, kombinieren und wählen, worauf du dich konzentrierst' },
    brainstorming: { icon: 'tree', title: 'Ideen-Baum', sub: 'Eine Idee mit Warum?, Was wäre wenn… und Und dann? zum Baum verzweigen' },
  },
};

// Each workshop is a fixed sequence of fields, worked through in any order.
// Field types: "structured" shows a few labelled sub-textareas that combine into
// the conclusion (see WORKSHOP_SHAPES); "simple" is a single textarea that IS the
// conclusion; otherwise the field pairs free bullet notes with a conclusion
// textarea. Conclusions stay visible in the sidebar the whole time.
const IDEA_WORKSHOP_FIELDS = {
  develop: {
    en: [
      { title: 'What I Love in Other Stories',
        instructions: [
          'Jot down bullet points: tropes, archetypes, settings — anything you love.',
          'Then combine your bullets into a Premise — a few sentences that capture the spirit of the story.',
        ],
        notesPlaceholder: 'Tropes, archetypes, settings, ...',
        conclusionLabel: 'Premise',
        conclusionPlaceholder: 'A few sentences that capture the spirit of your story...' },
      { title: 'Vibes, Aesthetics & (Recurring) Symbols & Imagery',
        instructions: [
          'Make a moodboard — images, music, quotes, whatever works for you. This might happen on another platform.',
          'Look at your moodboard and write down everything that catches your eye: character traits, scenes, objects...',
          'Group them (e.g. by symbols, setting, characters...) and add new points as you come up with them.',
          'Develop ideas from each group below. Setting, characters, and plot are groups that often make sense.',
        ],
        notesPlaceholder: 'Everything that catches your eye, grouped...',
        conclusionLabel: 'Ideas developed from the groups',
        conclusionPlaceholder: 'What ideas grew out of each group...' },
      { title: 'Set Up Main Characters',
        instructions: [
          'Note the most important characters you know about in your story so far.',
          'Add a few very short notes about each one — who they are, in a sentence or so.',
        ],
        notesPlaceholder: 'List your characters and anything you know about them...',
        conclusionLabel: 'Short character notes',
        conclusionPlaceholder: 'Name — who they are, in one short sentence...' },
      { title: 'Add Structure with Conflict & Stakes',
        instructions: [
          'Work through the beginning, the middle, and the end one at a time below.',
          'Most important: every time you write something down, go back over it and try to raise the stakes.',
        ],
        structured: true,
        parts: [
          { key: 'beginning', label: 'Beginning', hint: 'How and in what situation are the main characters at the start?', placeholder: 'The situation and the characters at the beginning...' },
          { key: 'middle', label: 'Middle', hint: 'What turns the situation up? Add any loose ideas or scene snippets you have here too.', placeholder: 'What happens in the middle, building the conflict — loose ideas and scene snippets welcome...' },
          { key: 'end', label: 'End', hint: 'How do the situation and the changed characters look at the end?', placeholder: 'The situation and the changed characters at the end...' },
        ],
        stakesPrompt: 'Raise the stakes: go back over what you just wrote — what makes it cost more, hurt more, or matter more?',
        conclusionLabel: 'Beginning – Middle – End' },
    ],
    de: [
      { title: 'Was ich an anderen Geschichten liebe',
        instructions: [
          'Sammle stichpunktartig: Tropes, Archetypen, Settings — alles, was du liebst.',
          'Verwandle deine Stichpunkte dann in eine Prämisse — ein paar Sätze, die den Spirit der Geschichte einfangen.',
        ],
        notesPlaceholder: 'Tropes, Archetypen, Settings, ...',
        conclusionLabel: 'Prämisse',
        conclusionPlaceholder: 'Ein paar Sätze, die den Spirit deiner Geschichte einfangen...' },
      { title: 'Vibes, Ästhetik & (wiederkehrende) Symbole & Bildsprache',
        instructions: [
          'Erstelle ein Moodboard — Bilder, Musik, Zitate, was auch immer für dich funktioniert. Das kann auch auf einer anderen Plattform passieren.',
          'Schau dir dein Moodboard an und notiere alles, was dir auffällt: bestimmte Charaktereigenschaften, Szenen, Objekte...',
          'Gruppiere sie (z. B. nach Symbolen, Setting, Charakteren...) und füge neue Punkte hinzu, wenn dir welche einfallen.',
          'Entwickle aus jeder Gruppe Ideen — Setting, Charaktere und Plot sind oft sinnvolle Gruppen.',
        ],
        notesPlaceholder: 'Alles, was dir auffällt, gruppiert...',
        conclusionLabel: 'Aus den Gruppen entwickelte Ideen',
        conclusionPlaceholder: 'Welche Ideen sich aus jeder Gruppe ergeben haben...' },
      { title: 'Hauptcharaktere festlegen',
        instructions: [
          'Notiere die wichtigsten Charaktere, die du bisher in deiner Geschichte kennst.',
          'Füge ein paar ganz kurze Infos zu jedem hinzu — wer sie sind, in etwa einem Satz.',
        ],
        notesPlaceholder: 'Liste deine Charaktere und was du bisher über sie weißt...',
        conclusionLabel: 'Kurze Charakterinfos',
        conclusionPlaceholder: 'Name — wer sie sind, in einem kurzen Satz...' },
      { title: 'Struktur mit Konflikt & Stakes hinzufügen',
        instructions: [
          'Arbeite unten Anfang, Mitte und Ende einzeln nacheinander durch.',
          'Das Wichtigste: Immer wenn du etwas aufschreibst, geh noch einmal darüber und versuche, den Konflikt zu erhöhen (raising the stakes).',
        ],
        structured: true,
        parts: [
          { key: 'beginning', label: 'Anfang', hint: 'Wie und in welcher Situation sind die Hauptcharaktere am Anfang?', placeholder: 'Die Situation und die Charaktere am Anfang...' },
          { key: 'middle', label: 'Mitte', hint: 'Was treibt die Situation an? Füge hier auch gerne lose Ideen oder Szenenfragmente hinzu.', placeholder: 'Was in der Mitte passiert und den Konflikt aufbaut — lose Ideen und Szenenfragmente willkommen...' },
          { key: 'end', label: 'Ende', hint: 'Wie sehen die Situation und die veränderten Charaktere am Ende aus?', placeholder: 'Die Situation und die veränderten Charaktere am Ende...' },
        ],
        stakesPrompt: 'Konflikt erhöhen: Geh noch einmal über das, was du gerade geschrieben hast — was macht es teurer, schmerzhafter oder bedeutsamer?',
        conclusionLabel: 'Anfang – Mitte – Ende' },
    ],
  },
  char: {
    en: [
      { title: 'Inciting Incident (Before the Story Starts)',
        instructions: [
          'Something happens — often before the story begins — which, if it didn\'t happen, would prevent the story as it exists from ever coming to be.',
        ],
        simple: true,
        conclusionLabel: 'Inciting Incident',
        conclusionPlaceholder: 'What happened before the story started that set everything in motion...' },
      { title: 'Stalemate Situation',
        instructions: [
          'Your character begins the story in a less-than-ideal situation they would like to change but seemingly cannot.',
          'What holds them there is usually a lie they believe, the fear that protects it, a false want it points them toward, and a hidden need they don\'t yet see.',
        ],
        structured: true,
        parts: [
          { key: 'lie', label: 'Lie', hint: 'What false belief does this character live by — the one that shapes every decision they make?', placeholder: 'The false belief they hold...' },
          { key: 'fear', label: 'Fear', hint: 'What fear keeps that lie in place? What do they think would happen if they let it go?', placeholder: 'The fear protecting the lie...' },
          { key: 'falseWant', label: 'False Want', hint: 'What do they think will make them happy — the thing they chase that their fear keeps just out of reach?', placeholder: 'The thing they chase instead...' },
          { key: 'hiddenNeed', label: 'Hidden Need', hint: 'What do they actually need? (They won\'t know it until they gain or lose it at the very end.)', placeholder: 'What they actually need...' },
        ],
        conclusionLabel: 'Lie, Fear, False Want & Hidden Need' },
      { title: 'Pre-Existing Conflict',
        instructions: [
          'When the story begins, the character is already dealing with personal conflicts as well as the conflicts of the world at large.',
        ],
        simple: true,
        conclusionLabel: 'Pre-Existing Conflict',
        conclusionPlaceholder: 'The personal conflicts and the conflicts of the wider world already in motion when the story begins...' },
      { title: 'Likability & Empathy Factors',
        instructions: [
          'The character is shown to be someone the audience would like to see succeed, or would be willing to follow on the journey of the story.',
        ],
        simple: true,
        conclusionLabel: 'Likability & Empathy Factors',
        conclusionPlaceholder: 'What makes the audience want to root for this character...' },
    ],
    de: [
      { title: 'Auslösendes Ereignis (vor Beginn der Geschichte)',
        instructions: [
          'Etwas geschieht — oft noch bevor die Geschichte beginnt —, das, wenn es nicht passiert wäre, die Geschichte in dieser Form verhindert hätte.',
        ],
        simple: true,
        conclusionLabel: 'Auslösendes Ereignis',
        conclusionPlaceholder: 'Was vor Beginn der Geschichte geschah und alles ins Rollen brachte...' },
      { title: 'Patt-Situation',
        instructions: [
          'Dein Charakter beginnt die Geschichte in einer wenig idealen Situation, die er ändern möchte, aber scheinbar nicht kann.',
          'Was ihn dort hält, ist meist eine Lüge, an die er glaubt, die Angst, die diese Lüge schützt, ein falscher Wunsch, den sie weckt, und ein verborgenes Bedürfnis, das er noch nicht erkennt.',
        ],
        structured: true,
        parts: [
          { key: 'lie', label: 'Lüge', hint: 'Welche falsche Überzeugung lebt diese Figur — die, die jede ihrer Entscheidungen prägt?', placeholder: 'Die falsche Überzeugung, die sie hat...' },
          { key: 'fear', label: 'Angst', hint: 'Welche Angst hält diese Lüge aufrecht? Was glaubt sie, würde passieren, wenn sie loslässt?', placeholder: 'Die Angst, die die Lüge schützt...' },
          { key: 'falseWant', label: 'Falscher Wunsch', hint: 'Was glaubt sie, würde sie glücklich machen — das Ziel, das ihre Angst immer unerreichbar hält?', placeholder: 'Das Ziel, dem sie stattdessen nachjagt...' },
          { key: 'hiddenNeed', label: 'Verborgenes Bedürfnis', hint: 'Was braucht sie wirklich? (Wird ihr erst am Ende klar, wenn sie es gewinnt oder verliert.)', placeholder: 'Was sie wirklich braucht...' },
        ],
        conclusionLabel: 'Lüge, Angst, falscher Wunsch & verborgenes Bedürfnis' },
      { title: 'Bereits bestehender Konflikt',
        instructions: [
          'Wenn die Geschichte beginnt, steckt der Charakter bereits in persönlichen Konflikten sowie in den Konflikten der Welt um ihn herum.',
        ],
        simple: true,
        conclusionLabel: 'Bereits bestehender Konflikt',
        conclusionPlaceholder: 'Die persönlichen Konflikte und die Konflikte der Welt, die beim Start der Geschichte schon bestehen...' },
      { title: 'Sympathie- & Empathiefaktoren',
        instructions: [
          'Der Charakter wird so gezeigt, dass das Publikum ihm Erfolg wünscht oder ihn gerne auf seiner Reise durch die Geschichte begleitet.',
        ],
        simple: true,
        conclusionLabel: 'Sympathie- & Empathiefaktoren',
        conclusionPlaceholder: 'Was das Publikum dazu bringt, diesem Charakter die Daumen zu drücken...' },
    ],
  },
};

const IDEA_NOTE_COLORS = ['#c8a2ff', '#ffd479', '#7ee0a0', '#7ec8ff', '#ff9eb1'];

function ideaEsc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function ideaGenId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function ideaStage() { return document.getElementById('idea-stage'); }

let ideaSection = 'find'; // 'find' | 'flow'

function renderIdeas() {
  const page = document.getElementById('page-ideas');
  if (!page) return;
  flowClearTimer();
  page.innerHTML =
    '<div class="page-header"><h1>' + t('nav.ideas') + '</h1></div>' +
    '<div class="idea-section-tabs">' +
      '<button class="idea-section-tab' + (ideaSection === 'find' ? ' on' : '') + '" data-sec="find">' + t('ideas.section.find') + '</button>' +
      '<button class="idea-section-tab' + (ideaSection === 'flow' ? ' on' : '') + '" data-sec="flow">' + t('ideas.section.flow') + '</button>' +
    '</div>' +
    '<div id="idea-section-body"></div>';
  page.querySelectorAll('.idea-section-tab').forEach(btn => {
    btn.addEventListener('click', () => { ideaSection = btn.dataset.sec; renderIdeas(); });
  });
  if (ideaSection === 'flow') renderFlow(); else renderIdeasFind();
}

function renderIdeasFind() {
  const body = document.getElementById('idea-section-body');
  if (!body) return;
  body.innerHTML =
    '<div class="idea-intro">' + t('ideas.tagline') + '</div>' +
    '<div class="idea-stage" id="idea-stage"></div>';
  ideaHome();
}

function ideaHome() {
  const meta = IDEA_WORKSHOP_META[currentLang] || IDEA_WORKSHOP_META.en;
  const stage = ideaStage();
  if (!stage) return;
  stage.innerHTML =
    '<div class="idea-lead">' + t('ideas.have.title') + '</div>' +
    '<div class="idea-pick-grid" id="idea-pick-grid"></div>';
  const grid = stage.querySelector('#idea-pick-grid');
  IDEA_STARTERS.forEach(key => {
    const m = meta[key];
    const b = document.createElement('button');
    b.className = 'idea-pick';
    b.innerHTML =
      '<span class="idea-pick-ic">' + IDEA_ICONS[m.icon] + '</span>' +
      '<span class="idea-pick-txt"><span class="idea-pick-t">' + m.title + '</span>' +
      '<span class="idea-pick-s">' + m.sub + '</span></span>';
    b.addEventListener('click', () => {
      if (key === 'ideapool') ideaPoolStageRender();
      else if (key === 'brainstorming') ideaBrainstormingStageRender();
      else ideaWorkshopRender(key);
    });
    grid.appendChild(b);
  });
}

// Brainstorming idea tree, inline within the "Find & Develop Ideas" stage —
// same back-button pattern (bottom-left) as the other starter cards.
function ideaBrainstormingStageRender() {
  const stage = ideaStage();
  if (!stage) return;
  stage.innerHTML =
    '<div class="idea-lead-row">' +
      '<div class="idea-lead">' + t('nav.brainstorming') + '</div>' +
      '<button class="btn-primary" id="bs2-add-root">' + t('brainstorming.add') + '</button>' +
    '</div>' +
    '<div class="bs2-tree" id="bs2-tree"></div>' +
    '<div class="idea-actions"><button class="idea-ghost" id="idea-bs2-back">' + t('ideas.back') + '</button></div>';
  stage.querySelector('#idea-bs2-back').addEventListener('click', ideaHome);
  stage.querySelector('#bs2-add-root').addEventListener('click', () => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    ideaMap.nodes.push({ id, parentId: null, type: 'root', text: '', prompt: null });
    saveProject();
    renderBrainstorming();
    const newText = document.querySelector(`#bs2-tree [data-node-id="${id}"] .bs2-text`);
    if (newText) newText.focus();
  });
  renderBrainstorming();
}

// Idea Pool, inline within the "Find & Develop Ideas" stage: a back button
// (same pattern as the guided workshops) plus the pool itself rendered into
// a sub-container.
function ideaPoolStageRender() {
  const stage = ideaStage();
  if (!stage) return;
  stage.innerHTML =
    '<div id="idea-pool-inline"></div>' +
    '<div class="idea-actions idea-pool-stage-foot">' +
      '<button class="idea-ghost" id="idea-pool-back">' + t('ideas.back') + '</button>' +
    '</div>';
  stage.querySelector('#idea-pool-back').addEventListener('click', ideaHome);
  renderIdeaPool(stage.querySelector('#idea-pool-inline'));
}

// ── Guided workshops ("Develop the Initial Idea", "Who Is My Character") ──
function ideaWorkshopRender(name) {
  const fields = IDEA_WORKSHOP_FIELDS[name][currentLang] || IDEA_WORKSHOP_FIELDS[name].en;
  const stage = ideaStage();
  if (!stage) return;
  const ws = ideaWorkshops[name];
  const step = ws.step;
  const f = fields[step];
  const fd = ws.fields[step];

  const tabs = fields.map((field, i) => {
    const filled = ws.fields[i].conclusion.trim() || ws.fields[i].notes.trim();
    return '<button class="idea-dev-tab' + (i === step ? ' on' : '') + (filled ? ' filled' : '') + '" data-i="' + i + '">' + (i + 1) + '</button>';
  }).join('');

  const sidebarItems = fields.map((field, i) => {
    const c = ws.fields[i].conclusion.trim();
    return '<div class="idea-dev-sum-item' + (i === step ? ' active' : '') + '">' +
      '<div class="idea-dev-sum-num">' + (i + 1) + '</div>' +
      '<div class="idea-dev-sum-body">' +
        '<div class="idea-dev-sum-title">' + ideaEsc(field.conclusionLabel) + '</div>' +
        '<div class="idea-dev-sum-text" id="idea-dev-sum-text-' + i + '">' +
          (c ? ideaEsc(c) : '<span class="idea-dev-sum-empty">' + t('ideas.develop.empty') + '</span>') +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  const bodyHtml = f.structured
    ? '<div class="idea-dev-bme">' +
        f.parts.map(p => (
          '<div class="idea-dev-bme-col">' +
            '<div class="idea-dev-bme-label">' + ideaEsc(p.label) + '</div>' +
            '<div class="idea-dev-bme-hint">' + ideaEsc(p.hint) + '</div>' +
            '<textarea class="idea-answer idea-dev-bme-area" data-part="' + p.key + '" rows="5" placeholder="' + ideaEsc(p.placeholder) + '">' + ideaEsc(fd.parts[p.key] || '') + '</textarea>' +
          '</div>'
        )).join('') +
      '</div>' +
      (f.stakesPrompt ? '<div class="idea-dev-stakes">' + ideaEsc(f.stakesPrompt) + '</div>' : '')
    : f.simple
    ? '<textarea class="idea-answer idea-dev-conclusion" id="idea-dev-conclusion" rows="6" placeholder="' + ideaEsc(f.conclusionPlaceholder) + '">' + ideaEsc(fd.conclusion) + '</textarea>'
    : '<textarea class="idea-answer idea-dev-notes" id="idea-dev-notes" rows="4" placeholder="' + ideaEsc(f.notesPlaceholder) + '">' + ideaEsc(fd.notes) + '</textarea>' +
      '<div class="idea-dev-conclusion-label">' + ideaEsc(f.conclusionLabel) + '</div>' +
      '<textarea class="idea-answer idea-dev-conclusion" id="idea-dev-conclusion" rows="3" placeholder="' + ideaEsc(f.conclusionPlaceholder) + '">' + ideaEsc(fd.conclusion) + '</textarea>';

  stage.innerHTML =
    '<div class="idea-dev-layout">' +
      '<div class="idea-dev-main">' +
        '<div class="idea-dev-tabs">' + tabs + '</div>' +
        '<div class="idea-dev-field-title">' + t('ideas.develop.field') + ' ' + (step + 1) + ': ' + ideaEsc(f.title) + '</div>' +
        '<div class="idea-dev-instructions">' + f.instructions.map(p => '<p>' + ideaEsc(p) + '</p>').join('') + '</div>' +
        bodyHtml +
        '<div class="idea-actions">' +
          (step > 0
            ? '<button class="idea-ghost" id="idea-dev-back">' + t('ideas.back') + '</button>'
            : '<button class="idea-ghost" id="idea-dev-home">' + t('ideas.back') + '</button>') +
          '<div class="idea-spacer"></div>' +
          (step < fields.length - 1
            ? '<button class="idea-next" id="idea-dev-next">' + t('ideas.next') + '</button>'
            : '<button class="idea-next" id="idea-dev-finish">' + t('ideas.develop.finish') + '</button>') +
        '</div>' +
      '</div>' +
      '<div class="idea-dev-sidebar">' +
        '<div class="idea-dev-sidebar-title">' + t('ideas.develop.sidebar.title') + '</div>' +
        sidebarItems +
      '</div>' +
    '</div>';

  const notesEl = stage.querySelector('#idea-dev-notes');
  if (notesEl) {
    autoResize(notesEl);
    notesEl.addEventListener('input', () => { fd.notes = notesEl.value; autoResize(notesEl); saveProjectDebounced(); });
  }

  const refreshSummary = () => {
    const sumText = stage.querySelector('#idea-dev-sum-text-' + step);
    if (sumText) sumText.innerHTML = fd.conclusion.trim() ? ideaEsc(fd.conclusion) : '<span class="idea-dev-sum-empty">' + t('ideas.develop.empty') + '</span>';
    const tab = stage.querySelector('.idea-dev-tab[data-i="' + step + '"]');
    if (tab) tab.classList.toggle('filled', !!(fd.conclusion.trim() || fd.notes.trim()));
  };

  if (f.structured) {
    stage.querySelectorAll('.idea-dev-bme-area').forEach(area => {
      autoResize(area);
      area.addEventListener('input', () => {
        fd.parts[area.dataset.part] = area.value;
        fd.conclusion = ideaWorkshopCombineParts(f, fd.parts);
        autoResize(area);
        saveProjectDebounced();
        refreshSummary();
      });
    });
  } else {
    const conclEl = stage.querySelector('#idea-dev-conclusion');
    autoResize(conclEl);
    conclEl.addEventListener('input', () => {
      fd.conclusion = conclEl.value;
      autoResize(conclEl);
      saveProjectDebounced();
      refreshSummary();
    });
  }

  stage.querySelectorAll('.idea-dev-tab').forEach(btn => {
    btn.addEventListener('click', () => { ws.step = parseInt(btn.dataset.i, 10); saveProjectDebounced(); ideaWorkshopRender(name); });
  });
  const backBtn = stage.querySelector('#idea-dev-back');
  if (backBtn) backBtn.addEventListener('click', () => { ws.step--; saveProjectDebounced(); ideaWorkshopRender(name); });
  const homeBtn = stage.querySelector('#idea-dev-home');
  if (homeBtn) homeBtn.addEventListener('click', ideaHome);
  const nextBtn = stage.querySelector('#idea-dev-next');
  if (nextBtn) nextBtn.addEventListener('click', () => { ws.step++; saveProjectDebounced(); ideaWorkshopRender(name); });
  const finishBtn = stage.querySelector('#idea-dev-finish');
  if (finishBtn) finishBtn.addEventListener('click', () => ideaWorkshopFinish(name));
}

function ideaWorkshopFinish(name) {
  const fields = IDEA_WORKSHOP_FIELDS[name][currentLang] || IDEA_WORKSHOP_FIELDS[name].en;
  const meta = (IDEA_WORKSHOP_META[currentLang] || IDEA_WORKSHOP_META.en)[name];
  const ws = ideaWorkshops[name];
  const stage = ideaStage();
  if (!stage) return;
  const bullets = fields.map((f, i) => {
    const c = ws.fields[i].conclusion.trim();
    return c ? '<div class="idea-bullet"><span class="idea-bullet-q">' + ideaEsc(f.conclusionLabel) + '</span>' + ideaEsc(c) + '</div>' : '';
  }).join('');
  // The develop workshop can seed the project: premise → blurb, B/M/E → beats.
  // Only shown when there is something to seed; one-shot (ws.seeded).
  const seedParts = name === 'develop' ? (ws.fields[3].parts || {}) : {};
  const canSeed = name === 'develop' && (
    ws.fields[0].conclusion.trim() ||
    ['beginning', 'middle', 'end'].some(k => (seedParts[k] || '').trim())
  );
  stage.innerHTML =
    '<div class="idea-done-tag">' + t('ideas.done') + '</div>' +
    '<div class="idea-close">' + ideaEsc(meta.doneClose) + '</div>' +
    (bullets || '<div class="idea-meta">' + t('ideas.done.empty') + '</div>') +
    '<div class="idea-actions idea-actions-end">' +
      (name === 'char' ? '<button class="idea-next" id="idea-dev-to-char">' + t('ideas.to.character') + '</button>' : '') +
      (canSeed ? '<button class="idea-next" id="idea-dev-seed" title="' + ideaEsc(t('ideas.seed.title')) + '"' + (ws.seeded ? ' disabled' : '') + '>' + (ws.seeded ? t('ideas.seed.done') : t('ideas.seed')) + '</button>' : '') +
      '<button class="idea-ghost" id="idea-dev-to-notes">' + t('ideas.to.notes') + '</button>' +
      '<button class="idea-ghost" id="idea-dev-restart">' + t('ideas.restart') + '</button>' +
    '</div>';
  stage.querySelector('#idea-dev-restart').addEventListener('click', ideaHome);
  stage.querySelector('#idea-dev-to-notes').addEventListener('click', () => ideaWorkshopSendToNotes(name, fields));
  const toCharBtn = stage.querySelector('#idea-dev-to-char');
  if (toCharBtn) toCharBtn.addEventListener('click', () => ideaWorkshopSaveAsCharacter(fields));
  const seedBtn = stage.querySelector('#idea-dev-seed');
  if (seedBtn) seedBtn.addEventListener('click', () => { ideaWorkshopSeedProject(); seedBtn.disabled = true; seedBtn.textContent = t('ideas.seed.done'); });
}

// Carries the develop workshop's results into the project so the thinking
// doesn't stay trapped in the workshop: the premise becomes the project
// description (only if it's still empty), and beginning/middle/end become
// three free-form beats. Note: while a structure template is selected the
// beats page only shows template beats, so the seeded (phase-less) beats stay
// hidden until "No Template" — they are kept, not lost.
function ideaWorkshopSeedProject() {
  const ws = ideaWorkshops.develop;
  if (ws.seeded) return;
  const premise = ws.fields[0].conclusion.trim();
  if (premise && !projectBlurb.trim()) {
    projectBlurb = premise;
    blurbInput.value = premise;
  }
  const parts = ws.fields[3].parts || {};
  [['beginning', 'ideas.seed.beginning'], ['middle', 'ideas.seed.middle'], ['end', 'ideas.seed.end']]
    .forEach(([k, key], i) => {
      const v = (parts[k] || '').trim();
      if (v) beats.push({ id: Date.now() + i, text: t(key) + ' ' + v, theme: '' });
    });
  ws.seeded = true;
  saveProject();
  renderBeats();
}

function ideaWorkshopSendToNotes(name, fields) {
  const ws = ideaWorkshops[name];
  let y = 40, ci = 0;
  fields.forEach((f, i) => {
    const c = ws.fields[i].conclusion.trim();
    if (!c) return;
    brainstorm.notes.push({ id: Date.now() + i, x: 40, y, text: c, color: IDEA_NOTE_COLORS[ci++ % IDEA_NOTE_COLORS.length] });
    y += 130;
  });
  saveProject();
  renderBrainstorm();
  switchPage('brainstorm');
}

// Turns the char workshop's conclusions into a new Characters page entry, so the
// writer doesn't have to retype what they just worked out.
function ideaWorkshopSaveAsCharacter(fields) {
  const ws = ideaWorkshops.char;
  const description = fields
    .map((f, i) => ws.fields[i].conclusion.trim())
    .filter(Boolean)
    .join('\n\n');
  characters.push({ id: Date.now(), name: '', description, image: null });
  saveProject();
  renderCharacters();
  switchPage('characters');
}

// ══════════════════════════════════
// ── GET WORDS FLOWING (low-stakes warm-up exercises) ──
// ══════════════════════════════════
// Pure practice — nothing here is saved to the project. The point is to lower
// the stakes of starting, so state resets each visit on purpose.
const FLOW_PROMPTS = {
  en: [
    "Someone is waiting for a bus that isn't coming.",
    'A character finds a key that doesn\'t open anything they own.',
    'Two people are stuck in an elevator, and one of them starts laughing.',
    'Someone is rehearsing what they\'re about to say, out loud, alone.',
    'A character is the last one to leave a party.',
    'Someone reads a text message three times before replying.',
    'A character is packing a bag and can\'t decide what matters.',
    'Two strangers recognize each other from somewhere, but can\'t place it.',
  ],
  de: [
    'Jemand wartet auf einen Bus, der nicht kommt.',
    'Eine Figur findet einen Schlüssel, der zu nichts passt, das sie besitzt.',
    'Zwei Menschen stecken im Aufzug fest, und einer fängt an zu lachen.',
    'Jemand probt allein und laut, was er gleich sagen will.',
    'Eine Figur ist die letzte Person, die eine Party verlässt.',
    'Jemand liest eine Nachricht dreimal, bevor er antwortet.',
    'Eine Figur packt eine Tasche und kann sich nicht entscheiden, was wichtig ist.',
    'Zwei Fremde erkennen sich von irgendwoher, können es aber nicht einordnen.',
  ],
};

// Each scene is described in four contrasting "voices", named by how the prose
// feels rather than after any author. All content here is original.
//   Tactile & Tender   — craft, texture, emotion carried by small made things
//   Breathless & Defiant — clipped, high-pressure, first-person nerve under fire
//   Deadpan & Theatrical — dry narrator wit, gothic-comic, stylish timing
//   Caustic & Candid   — opinionated first-person rant, world explained while annoyed
const WRITING_STYLE_SCENES = {
  en: [
    {
      base: 'Nora duels her rival Zane as the great hall burns around them.',
      voices: [
        { label: 'Tactile & Tender', text: "Nora's grandmother had woven her coat-lining with copper thread, one careful row a night, for exactly this — and when Zane's fire-spell broke against her, it slid off the weave like rain off oilcloth. She felt every stitch hold. A rafter came down where her head had been, and she was already inside his reach, driving her shoulder into his ribs. He had grinned like the duel was won. The work her family made for her did what love does: it kept her standing one more breath." },
        { label: 'Breathless & Defiant', text: "Zane threw fire. It broke on my coat and slid off — thank you, Grandmother. He swung. I dropped. The rafter came down where my head had been. He grinned like he'd already won, so I let him think it, then drove my shoulder into his ribs. We don't both walk out of this hall. Fine. I am Not the one who falls." },
        { label: 'Deadpan & Theatrical', text: "The hall was on fire, which Nora felt was a bit much, even for Zane. His fire-spell slid off her copper-threaded coat and accomplished nothing but ruining the curtains. \"You've redecorated,\" she observed, ducking a blow as a rafter obligingly fell where her head had been. Zane snarled something about destiny. She drove her shoulder into his ribs, mostly to make him stop talking." },
        { label: 'Caustic & Candid', text: "Everyone romanticizes a duel to the death, and everyone is an idiot, because nobody mentions the smoke. Zane was flinging a forbidden fire-rite that'll cost him his soul in a decade — not that the showoff thinks that far ahead — and it slid right off the coat my grandmother threaded with copper. A rafter nearly settled the matter for both of us. So I quit fencing like a gentlewoman and drove my shoulder into his ribs instead." },
        { label: 'Storybook & Atmospheric', text: "The fire bloomed against the high windows like a second, hungrier sunset, and for a heartbeat the burning hall was almost beautiful. Zane's spell rushed at Nora — and slid from the copper her grandmother had threaded into her coat, one patient row each winter evening, as if the old woman's hands were still keeping her warm. A rafter fell where her head had been, trailing sparks like startled fireflies. He smiled, certain. Nora stepped inside that certainty and drove her shoulder into his ribs." },
        { label: 'Cheeky & Warm', text: "So the great hall was on fire, which — dramatic, Zane, really. He flung a fire-spell at me with this insufferably smug little flourish, and it just... slid off my coat. Thanks, Grandma, and your nine hundred hours of copper thread. A rafter came down exactly where my head used to be, which I chose not to think about. He grinned like he'd already won. Cute. I put my shoulder into his ribs and wiped the grin right off." },
      ],
    },
    {
      base: 'The rope bridge gives way over the gorge — Nora catches the last plank.',
      voices: [
        { label: 'Tactile & Tender', text: "The plank was old cedar, worn smooth by a hundred years of crossing hands, and the smoothness nearly killed her — then saved her, because Nora knew this grain. She'd helped re-bind these ropes as a child; her fingers found her father's knot now, the clumsy strong one, and held it the way you hold a hand. The wood tore her palms open. She got one knee up, then the other, and climbed back to the ledge." },
        { label: 'Breathless & Defiant', text: "The bridge went. Just — gone, under me. I grabbed the last plank and the wood tore my palms open and I did not care. My father re-bound these ropes; I knew his knot by feel. Below me the gorge wanted me and the wind agreed. No. Not today. One knee up. Then the other. I climbed my own scream back to the ledge." },
        { label: 'Deadpan & Theatrical', text: "The bridge collapsed with the enthusiasm of something that had been waiting all week. Nora found herself dangling from a single plank over a drop generously described as fatal, palms torn, recognizing — of all things — her father's knotwork. \"Well,\" she told the gorge, which did not answer, being a gorge. She got one knee up, then the other, and undertook the tedious business of not dying." },
        { label: 'Caustic & Candid', text: "Here's what nobody tells you about ancient rope bridges: they're maintained by exactly nobody and held together by tradition and optimism. So when it dropped me, I wasn't surprised — furious, dangling, palms bleeding, but not surprised. The one mercy was the rope: my father re-bound these knots, and his held. I got one knee up, then the other, purely out of spite. Spite, it turns out, has an excellent grip." },
        { label: 'Storybook & Atmospheric', text: "The bridge gave way beneath Nora like a held breath finally let go, and the gorge opened its long blue throat below her. Her hands found the last plank — old cedar, smooth as a story told too many times — and the wood bit her palms even as it saved her. Her father had re-bound these ropes; she knew his clumsy, faithful knot the way one knows a voice in the dark. One knee, then the other, and she climbed back into the living world." },
        { label: 'Cheeky & Warm', text: "The bridge just... left. One second a bridge, next second a strongly worded suggestion that I learn to fly. I grabbed the last plank — wood, splinters, blood, the works — and honestly? Rude. But my dad re-bound these ropes when I was small, and I'd know his lumpy knot anywhere. Below me the gorge made its case. I declined. One knee up, then the other, and I hauled myself back to the ledge, swearing the entire way." },
      ],
    },
    {
      base: 'Nora and Zane pick the same lock in the dark, shoulders touching.',
      voices: [
        { label: 'Tactile & Tender', text: "Their hands kept meeting on the lockpick — Zane's calloused at the thumb, Nora's ink-stained — and neither pulled away as fast as they should have. The tumblers were brass, warm now from being worked, their shoulders pressed together in a doorway built for one. \"You're doing it wrong,\" she murmured, guiding his fingers a half-turn. The lock gave the same moment her breath did. \"Teamwork,\" he whispered, and she did not move away." },
        { label: 'Breathless & Defiant', text: "\"Move over.\" \"I had it.\" \"You did not have it.\" Zane's shoulder was against mine, warm, distracting, deeply unfair. Our hands kept colliding on the pick. The lock clicked. We both froze — too close, both grinning, neither admitting it. \"See,\" he breathed. \"Teamwork.\" I told him to shut up. I did not move away." },
        { label: 'Deadpan & Theatrical', text: "\"You're breathing on my neck,\" Nora noted. \"I'm concentrating,\" said Zane, who was very obviously not concentrating. They were crammed into a doorway built for one repentant monk, hands knocking together on a single pick, working a lock that required considerably less tension between the two people attached to it. The lock surrendered first. \"Teamwork,\" Zane said. Nora counted it a tactical loss and did not move away." },
        { label: 'Caustic & Candid', text: "Picking a lock with someone is supposedly a great bonding exercise. What it actually is, is two people pretending the only reason their hands keep touching is the lock. I knew this mechanism — left, left, hard right — and could've done it alone in three seconds. With Zane's shoulder against mine I took thirty. The thing clicked; he grinned and said \"teamwork.\" I told him to shut up. He smells like rain and bad decisions, and I've always been weak for both — so no, I didn't move away." },
        { label: 'Storybook & Atmospheric', text: "The doorway was built for one repentant monk and held two thieves instead, shoulder warm against shoulder in the dark. Their hands kept meeting on the pick like moths at the same small flame; the brass tumblers had gone warm beneath their fingers. \"You're doing it wrong,\" Nora breathed, and turned Zane's hand a half-turn, and the lock sighed open at the very moment she forgot to breathe. \"Teamwork,\" he whispered, and she did not move away." },
        { label: 'Cheeky & Warm', text: "Okay, picture it: one doorway, built for a single very small monk, and somehow both of us in it, shoulder to shoulder, way too close. Our hands kept bumping on the pick and I was Not Going To Think About That. \"You're doing it wrong.\" \"I had it.\" \"You absolutely did not have it.\" The lock clicked. We froze — grinning like idiots, neither admitting anything. \"Teamwork,\" Zane breathed. I told him to shut up. And no, I did not move away." },
      ],
    },
    {
      base: 'After the battle, Zane sits down beside Nora and splits the last ration.',
      voices: [
        { label: 'Tactile & Tender', text: "Zane broke the last waybread along the seam they'd both learned from the same dead cook, and the crumbs fell between them like small forgivenesses. He pressed the bigger half into Nora's hand — \"they're the same,\" he lied — and closed her fingers around it. He said nothing about the battle, or the ones not sitting with them. He just let the warmth of his palm say the rest, and they breathed, which was more than some could." },
        { label: 'Breathless & Defiant', text: "We were both still shaking. Didn't matter. Zane dropped down beside me, tore the last waybread in two, shoved the bigger half at my chest. \"They're the same,\" he lied. \"Eat.\" \"You eat.\" \"Eat, or I'll sit on you.\" I ate. He watched me do it like it was the only order that had gone right all day. We were both still breathing. Maybe that was enough." },
        { label: 'Deadpan & Theatrical', text: "\"I saved you the bigger piece,\" said Zane, which was a lie; the halves were identical and he had measured them with the grim precision of a man who'd nearly died and intended to be petty about smaller things now. He pressed it on Nora until she ate. They sat in the wreckage, sharing stale waybread like it was a feast. It was, a bit. They were both still breathing, which was more than the architecture could say." },
        { label: 'Caustic & Candid', text: "People think wartime friendship is all noble speeches. It's not. It's Zane, your idiot best friend, splitting one sad heel of waybread and insisting his half is smaller when it obviously isn't. I let him win that lie. You learn which fights matter. This one — the bread, the sitting-down-next-to-me, the both-of-us-still-breathing — this one I lose on purpose, every time." },
        { label: 'Storybook & Atmospheric', text: "Zane broke the last waybread along the seam they'd both learned from the same dead cook, and the crumbs fell between them like a small and ordinary mercy. \"They're the same size,\" he said, which was a kind lie, and folded Nora's fingers around the larger half. He spoke of neither the battle nor the empty places where friends had sat. He only let the warmth of his hand finish the sentence — and they breathed, the two of them, which the evening had promised no one." },
        { label: 'Cheeky & Warm', text: "We were both still shaking, which I was pretending not to notice about myself. Zane dropped down next to me, ripped the last waybread in half, and shoved the bigger piece at my chest. \"They're the same,\" he said, lying directly to my face. \"Eat.\" \"You eat.\" \"Eat, or I sit on you.\" I ate. He watched me like it was the one thing that had gone right all day — and we were both still breathing, so. Maybe it was." },
      ],
    },
    {
      base: 'Zane stands the night watch alone, at the top of the tower.',
      voices: [
        { label: 'Tactile & Tender', text: "Zane had his mother's woolen scarf wound twice around his throat, and he kept finding the place where the dye had run, a small map of an old rainstorm. The tower was cold, the stars far, the watch his alone. He set his back to the stone and looked up. For a while the wool remembered warmth even where his hands had stopped believing in it, and the far stars did not seem quite so far." },
        { label: 'Breathless & Defiant', text: "Just me up here. Me, the wind, the dark, and whatever the dark is hiding tonight. My mother's scarf is wound twice at my throat and it'll have to be enough. I set my back to the cold stone and look up. Fine. I can do alone — I've done alone. I stare the night down like it owes me money. It does not blink. Neither do I." },
        { label: 'Deadpan & Theatrical', text: "The night watch, Zane had decided, was a magnificent way to be reminded that one was deeply unimportant to the universe. The stars ignored him. The wind ignored him with real commitment. He tugged his mother's scarf higher, set his back to the cold stone, and looked up at them anyway. He saluted the darkness. Standards, after all, were standards." },
        { label: 'Caustic & Candid', text: "Night watch is punishment duty dressed up as honor, and everyone above me knows it. You stand six hours on a freezing tower so that if something terrible comes, you can scream about it slightly before it kills everyone. That's the whole job. So there I was — my mother's scarf doubled at my throat, back to the cold stone, gloriously expendable — and, fine, yes, looking up, because nobody warns you how unfair the stars are from up here." },
        { label: 'Storybook & Atmospheric', text: "High on the tower the night was vast and old, and Zane stood alone inside it with his mother's woolen scarf wound twice at his throat. He kept finding the place where the dye had run, a small faded map of some long-ago rainstorm. The wind went by like something with somewhere to be; the stars hung far and patient. He set his back to the cold stone and looked up, and for a while the wool remembered a warmth his hands had forgotten." },
        { label: 'Cheeky & Warm', text: "Just me up here. Me, the wind, the dark, and whatever the dark's hiding tonight — fabulous. My mother's scarf is wound twice around my neck and it's going to have to be enough, because the tower's idea of hospitality is 'freezing.' I put my back to the cold stone and looked up. And, fine, yes — the stars were ridiculous. Nobody warns you about that part. I'd never give the night the satisfaction of saying so out loud." },
      ],
    },
    {
      base: 'Nora holds Zane as he dies, while the snow falls.',
      voices: [
        { label: 'Tactile & Tender', text: "Nora had whittled the little wooden bird on a hundred easier nights, and she pressed it into Zane's failing hand now because she had nothing else to give that her own fingers had made. Her other hand stayed on the wound. The snow settled on his hair and did not melt. He apologized — for the blood on her sleeve, the fool — and smiled like it was all right. She kept her thumb moving against his knuckle, the old whittling motion, as if she could carve one more morning out of nothing." },
        { label: 'Breathless & Defiant', text: "Stay. Stay with me, Zane. I'm ordering you. The snow came down and his blood was so warm against it, and I pressed both hands to the wound like I could hold him in by force. The little bird I'd carved was still in his hand. \"Don't,\" I said. \"Don't you dare.\" He smiled — that was the worst part — and apologized for my sleeve. He smiled like it was all right. It was not all right." },
        { label: 'Deadpan & Theatrical', text: "\"This is embarrassing,\" Zane managed, blood on his teeth, snow in his lashes, the little carved bird loose in his palm. \"Dying. In winter. So dramatic.\" Nora told him to save his breath and pressed harder on the wound; he said breath was rather the issue, wasn't it, and apologized for her sleeve. The snow kept falling, indifferent and clean. He made one more joke. He did not make a second." },
        { label: 'Caustic & Candid', text: "Nobody warns you that the dying keep talking. In the songs they get one clean line and a tasteful fade. In real life Zane was bleeding into the snow and apologizing — apologizing, the maddening fool — for the blood on my sleeve, the carved bird I'd given him still in his fist. I told him the sleeve was already ruined. I told him to shut up and stay. He did one of those things. I'm still angry about which one." },
        { label: 'Storybook & Atmospheric', text: "The snow came down soft as forgetting, settling in Zane's hair without melting. Nora pressed one hand to the wound and with the other folded the little wooden bird — carved on a hundred kinder nights — into his failing fingers. He apologized, the fool, for the blood on her sleeve, and smiled as though the whole white world were not coming apart. \"Stay,\" she told him. He made one more small joke into the falling snow. He did not make another." },
        { label: 'Cheeky & Warm', text: "I always thought, when it came to it, I'd say something perfect. Instead I said \"don't you dare\" about four times, which is not in any of the songs. Zane was bleeding into the snow and using his last breaths to apologize for my sleeve — my sleeve! — the carved bird I'd given him still tucked in his fist. \"Stay,\" I told him. He smiled like it was all fine, the absolute menace. He got out one more joke. He didn't get out a second." },
      ],
    },
  ],
  de: [
    {
      base: 'Nora duelliert sich mit ihrem Rivalen Zane, während die große Halle ringsum brennt.',
      voices: [
        { label: 'Sinnlich & zärtlich', text: "Noras Großmutter hatte ihr Mantelfutter mit Kupferfaden durchwirkt, Nacht für Nacht eine sorgsame Reihe, genau für diesen Moment — und als Zanes Feuerzauber an ihr zerbrach, glitt er an dem Gewebe ab wie Regen von Öltuch. Sie spürte jeden Stich halten. Ein Dachbalken krachte dorthin, wo eben ihr Kopf gewesen war, und da war sie ihm schon zu nah und rammte ihm die Schulter in die Rippen. Er hatte gegrinst, als wäre das Duell gewonnen. Was ihre Familie für sie gemacht hatte, tat, was Liebe tut: Es hielt sie einen Atemzug länger aufrecht." },
        { label: 'Atemlos & trotzig', text: "Zane schleuderte Feuer. Es zerbrach an meinem Mantel und glitt ab — danke, Großmutter. Er schlug zu. Ich ging runter. Der Dachbalken krachte dorthin, wo eben mein Kopf war. Er grinste, als hätte er schon gewonnen — also ließ ich ihn das glauben und rammte ihm dann die Schulter in die Rippen. Wir gehen nicht beide aus dieser Halle. Gut. Ich bin nicht die, die fällt." },
        { label: 'Trocken & theatralisch', text: "Die Halle stand in Flammen, was Nora selbst für Zane ein wenig übertrieben fand. Sein Feuerzauber glitt an ihrem kupferdurchwirkten Mantel ab und brachte nichts zustande außer ruinierten Vorhängen. „Du hast neu dekoriert“, bemerkte sie und duckte sich unter einem Hieb, während ein Dachbalken gefällig dorthin fiel, wo eben ihr Kopf gewesen war. Zane knurrte etwas von Bestimmung. Sie rammte ihm die Schulter in die Rippen, vor allem, um ihn zum Schweigen zu bringen." },
        { label: 'Bissig & ungeschönt', text: "Alle romantisieren ein Duell auf Leben und Tod, und alle sind Idioten, denn keiner erwähnt den Rauch. Zane schleuderte einen verbotenen Feuerritus, der ihn in einem Jahrzehnt die Seele kostet — nicht, dass der Angeber so weit dächte —, und der glitt einfach an dem Mantel ab, den meine Großmutter mit Kupfer durchwirkt hatte. Ein Dachbalken hätte die Sache fast für uns beide entschieden. Also hörte ich auf, wie eine Dame zu fechten, und rammte ihm stattdessen die Schulter in die Rippen." },
        { label: 'Märchenhaft & atmosphärisch', text: "Das Feuer blühte an den hohen Fenstern auf wie ein zweiter, hungrigerer Sonnenuntergang, und einen Herzschlag lang war die brennende Halle beinahe schön. Zane' Zauber schoss auf Nora zu — und glitt von dem Kupfer ab, das ihre Großmutter Winterabend für Winterabend in ihren Mantel gefädelt hatte, als hielten die Hände der alten Frau sie noch immer warm. Ein Dachbalken fiel dorthin, wo eben ihr Kopf gewesen war, und zog Funken hinter sich her wie aufgeschreckte Glühwürmchen. Zane lächelte, seiner Sache sicher. Nora trat in diese Sicherheit hinein und rammte ihm die Schulter in die Rippen." },
        { label: 'Frech & herzlich', text: "Die große Halle stand also in Flammen — sehr dramatisch, Zane, wirklich. Er schleuderte mir mit einer unerträglich selbstgefälligen kleinen Geste einen Feuerzauber entgegen, und der... glitt einfach an meinem Mantel ab. Danke, Oma, und danke für deine neunhundert Stunden Kupferfaden. Ein Dachbalken krachte genau dorthin, wo eben mein Kopf gewesen war, worüber ich beschloss, nicht nachzudenken. Er grinste, als hätte er schon gewonnen. Süß. Ich rammte ihm die Schulter in die Rippen und wischte ihm das Grinsen aus dem Gesicht." },
      ],
    },
    {
      base: 'Die Seilbrücke reißt über der Schlucht — Nora fängt die letzte Planke.',
      voices: [
        { label: 'Sinnlich & zärtlich', text: "Die Planke war altes Zedernholz, glatt geschliffen von hundert Jahren kreuzender Hände, und beinahe hätte sie genau diese Glätte umgebracht — dann rettete sie sie, denn Nora kannte diese Maserung. Als Kind hatte sie geholfen, diese Seile neu zu binden; jetzt fanden ihre Finger den Knoten ihres Vaters, den ungeschickten, festen, und hielten ihn, wie man eine Hand hält. Das Holz riss ihr die Handflächen auf. Sie brachte ein Knie hoch, dann das andere, und kletterte zurück auf den Sims." },
        { label: 'Atemlos & trotzig', text: "Die Brücke gab nach. Einfach — weg, unter mir. Ich packte die letzte Planke, und das Holz riss mir die Handflächen auf, und es war mir egal. Mein Vater hatte diese Seile neu gebunden; ich kannte seinen Knoten am Griff. Unter mir wollte die Schlucht mich haben, und der Wind gab ihr recht. Nein. Nicht heute. Ein Knie hoch. Dann das andere. Ich kletterte meinen eigenen Schrei zurück auf den Sims." },
        { label: 'Trocken & theatralisch', text: "Die Brücke stürzte mit der Begeisterung von etwas ein, das die ganze Woche darauf gewartet hatte. Nora fand sich an einer einzigen Planke baumelnd wieder, über einem Abgrund, den man großzügig als tödlich bezeichnen durfte, die Handflächen aufgerissen — und erkannte ausgerechnet das Knotenwerk ihres Vaters. „Na schön“, sagte sie zur Schlucht, die nicht antwortete, weil sie eine Schlucht war. Sie brachte ein Knie hoch, dann das andere, und machte sich an das mühsame Geschäft, nicht zu sterben." },
        { label: 'Bissig & ungeschönt', text: "Was dir niemand über uralte Seilbrücken sagt: Sie werden von exakt niemandem gewartet und nur von Tradition und Optimismus zusammengehalten. Als sie mich also fallen ließ, war ich nicht überrascht — wütend, baumelnd, mit blutenden Handflächen, aber nicht überrascht. Die einzige Gnade war das Seil: Mein Vater hatte diese Knoten neu gebunden, und seiner hielt. Ich brachte ein Knie hoch, dann das andere, aus reinem Trotz. Trotz, wie sich herausstellt, hat einen ausgezeichneten Griff." },
        { label: 'Märchenhaft & atmosphärisch', text: "Die Brücke gab unter Nora nach wie ein zu lange angehaltener Atem, der endlich entweicht, und unter ihr öffnete die Schlucht ihren langen blauen Schlund. Ihre Hände fanden die letzte Planke — altes Zedernholz, glatt wie eine zu oft erzählte Geschichte —, und das Holz biss ihr in die Handflächen, noch während es sie rettete. Ihr Vater hatte diese Seile neu gebunden; sie kannte seinen ungeschickten, treuen Knoten, wie man eine Stimme im Dunkeln kennt. Ein Knie, dann das andere, und sie kletterte zurück in die Welt der Lebenden." },
        { label: 'Frech & herzlich', text: "Die Brücke war einfach... weg. Eben noch eine Brücke, im nächsten Moment ein nachdrücklicher Vorschlag, doch bitte fliegen zu lernen. Ich packte die letzte Planke — Holz, Splitter, Blut, das ganze Programm — und ehrlich? Unverschämt. Aber mein Vater hatte diese Seile neu gebunden, als ich klein war, und seinen knubbeligen Knoten würde ich überall erkennen. Unter mir hielt die Schlucht ihr Plädoyer. Ich lehnte ab. Ein Knie hoch, dann das andere, und ich zog mich zurück auf den Sims, fluchend den ganzen Weg." },
      ],
    },
    {
      base: 'Nora und Zane knacken dasselbe Schloss im Dunkeln, Schulter an Schulter.',
      voices: [
        { label: 'Sinnlich & zärtlich', text: "Ihre Hände trafen sich immer wieder am Dietrich — Zanes am Daumen schwielig, Noras tintenfleckig — und keiner zog so schnell zurück, wie er sollte. Die Zuhaltungen waren aus Messing, warm jetzt vom Arbeiten, ihre Schultern aneinandergedrängt in einem Türrahmen, der für einen gebaut war. „Du machst es falsch“, murmelte sie und führte seine Finger eine halbe Drehung. Das Schloss gab im selben Moment nach wie ihr Atem. „Teamwork“, flüsterte er, und sie rückte nicht weg." },
        { label: 'Atemlos & trotzig', text: "„Rück rüber.“ „Ich hatt's.“ „Du hattest es nicht.“ Zanes Schulter lag an meiner, warm, ablenkend, zutiefst unfair. Unsere Hände stießen ständig am Dietrich zusammen. Das Schloss klickte. Wir erstarrten beide — zu nah, beide grinsend, keiner gab's zu. „Siehst du“, hauchte er. „Teamwork.“ Ich sagte ihm, er solle den Mund halten. Ich rückte nicht weg." },
        { label: 'Trocken & theatralisch', text: "„Du atmest mir in den Nacken“, stellte Nora fest. „Ich konzentriere mich“, sagte Zane, der sich ganz offensichtlich nicht konzentrierte. Sie steckten zusammengequetscht in einem Türrahmen, gebaut für einen einzigen reuigen Mönch, die Hände aneinanderstoßend an einem einzigen Dietrich, und arbeiteten an einem Schloss, das deutlich weniger Spannung zwischen den beiden verlangte, die daran hingen. Das Schloss kapitulierte zuerst. „Teamwork“, sagte Zane. Nora verbuchte es als taktische Niederlage und rückte nicht weg." },
        { label: 'Bissig & ungeschönt', text: "Ein Schloss zu zweit zu knacken gilt als großartige Vertrauensübung. Was es tatsächlich ist: zwei Leute, die so tun, als wäre der einzige Grund, warum ihre Hände sich ständig berühren, das Schloss. Ich kannte diesen Mechanismus — links, links, hart rechts — und hätte es allein in drei Sekunden geschafft. Mit Zanes Schulter an meiner brauchte ich dreißig. Das Ding klickte; er grinste und sagte „Teamwork“. Ich sagte ihm, er solle den Mund halten. Er riecht nach Regen und schlechten Entscheidungen, und für beides war ich schon immer schwach — also nein, ich rückte nicht weg." },
        { label: 'Märchenhaft & atmosphärisch', text: "Der Türrahmen war für einen einzigen reuigen Mönch gebaut und beherbergte stattdessen zwei Diebe, Schulter warm an Schulter im Dunkeln. Ihre Hände trafen sich am Dietrich immer wieder wie Motten an derselben kleinen Flamme; die messingnen Zuhaltungen waren unter ihren Fingern warm geworden. „Du machst es falsch“, hauchte Nora und drehte Zanes Hand eine halbe Umdrehung, und das Schloss seufzte sich auf — genau in dem Moment, in dem sie vergaß zu atmen. „Teamwork“, flüsterte er, und sie rückte nicht weg." },
        { label: 'Frech & herzlich', text: "Stell dir das vor: ein Türrahmen, gebaut für einen einzigen, sehr kleinen Mönch, und trotzdem irgendwie wir beide darin, Schulter an Schulter, viel zu nah. Unsere Hände stießen ständig am Dietrich zusammen, und ich Würde Da Jetzt Nicht Drüber Nachdenken. „Du machst es falsch.“ „Ich hatt's.“ „Du hattest es ganz sicher nicht.“ Das Schloss klickte. Wir erstarrten — grinsend wie zwei Idioten, keiner gab irgendwas zu. „Teamwork“, hauchte Zane. Ich sagte ihm, er solle den Mund halten. Und nein, ich rückte nicht weg." },
      ],
    },
    {
      base: 'Nach der Schlacht setzt sich Zane neben Nora und teilt die letzte Ration.',
      voices: [
        { label: 'Sinnlich & zärtlich', text: "Zane brach das letzte Wegbrot entlang der Naht, die sie beide von derselben toten Köchin gelernt hatten, und die Krümel fielen zwischen sie wie kleine Vergebungen. Er drückte Nora die größere Hälfte in die Hand — „die sind gleich groß“, log er — und schloss ihre Finger darum. Er sagte nichts über die Schlacht oder über die, die nicht mit ihnen saßen. Er ließ nur die Wärme seiner Handfläche den Rest sagen, und sie atmeten beide, was mehr war, als manche konnten." },
        { label: 'Atemlos & trotzig', text: "Wir zitterten beide noch. Egal. Zane ließ sich neben mir fallen, riss das letzte Wegbrot entzwei, drückte mir die größere Hälfte gegen die Brust. „Die sind gleich groß“, log er. „Iss.“ „Iss du.“ „Iss, oder ich setz mich auf dich.“ Ich aß. Er sah mir dabei zu, als wäre es der einzige Befehl, der den ganzen Tag richtig gelaufen war. Wir atmeten beide noch. Vielleicht war das genug." },
        { label: 'Trocken & theatralisch', text: "„Ich hab dir das größere Stück aufgehoben“, sagte Zane, was eine Lüge war; die Hälften waren identisch, und er hatte sie mit der grimmigen Präzision eines Mannes abgemessen, der beinahe gestorben war und nun gedachte, bei kleineren Dingen kleinlich zu sein. Er drängte es Nora auf, bis sie aß. Sie saßen im Trümmerfeld und teilten altes Wegbrot, als wäre es ein Festmahl. Ein bisschen war es das. Sie atmeten beide noch, was die Architektur nicht von sich behaupten konnte." },
        { label: 'Bissig & ungeschönt', text: "Die Leute denken, Freundschaft im Krieg bestehe aus edlen Reden. Tut sie nicht. Sie besteht aus Zane, deinem trotteligen besten Freund, der einen traurigen Wegbrotkanten teilt und darauf beharrt, seine Hälfte sei kleiner, obwohl sie das offensichtlich nicht ist. Ich ließ ihm diese Lüge. Man lernt, welche Kämpfe zählen. Diesen hier — das Brot, das Sich-neben-mich-Setzen, das Wir-beide-atmen-noch — den verliere ich mit Absicht, jedes Mal." },
        { label: 'Märchenhaft & atmosphärisch', text: "Zane brach das letzte Wegbrot entlang der Naht, die sie beide von derselben toten Köchin gelernt hatten, und die Krümel fielen zwischen sie wie eine kleine, alltägliche Gnade. „Die sind gleich groß“, sagte er, was eine gütige Lüge war, und schloss Noras Finger um die größere Hälfte. Er sprach weder von der Schlacht noch von den leeren Plätzen, an denen Freunde gesessen hatten. Er ließ nur die Wärme seiner Hand den Satz zu Ende bringen — und sie atmeten, die beiden, was der Abend niemandem versprochen hatte." },
        { label: 'Frech & herzlich', text: "Wir zitterten beide noch, was ich an mir selbst gekonnt zu ignorieren versuchte. Zane ließ sich neben mir fallen, riss das letzte Wegbrot entzwei und drückte mir das größere Stück gegen die Brust. „Die sind gleich groß“, log er mir mitten ins Gesicht. „Iss.“ „Iss du.“ „Iss, oder ich setz mich auf dich.“ Ich aß. Er sah mir dabei zu, als wäre es das Einzige, was den ganzen Tag richtig gelaufen war — und wir atmeten beide noch, also. Vielleicht war es das ja." },
      ],
    },
    {
      base: 'Zane steht allein die Nachtwache, hoch oben auf dem Turm.',
      voices: [
        { label: 'Sinnlich & zärtlich', text: "Zane hatte den Wollschal seiner Mutter zweimal um den Hals geschlungen und fand immer wieder die Stelle, an der die Farbe verlaufen war, eine kleine Landkarte eines alten Regensturms. Der Turm war kalt, die Sterne fern, die Wache ganz allein seine. Er lehnte den Rücken an den Stein und sah hinauf. Eine Weile erinnerte sich die Wolle an Wärme, selbst dort, wo seine Hände nicht mehr daran glaubten, und die fernen Sterne schienen gar nicht mehr so fern." },
        { label: 'Atemlos & trotzig', text: "Nur ich hier oben. Ich, der Wind, die Dunkelheit und was auch immer die Dunkelheit heute Nacht verbirgt. Der Schal meiner Mutter ist zweimal um meinen Hals geschlungen, und er muss reichen. Ich lehne den Rücken an den kalten Stein und sehe hinauf. Gut. Allein kann ich — allein hab ich schon hinter mir. Ich starre die Nacht nieder, als schulde sie mir Geld. Sie blinzelt nicht. Ich auch nicht." },
        { label: 'Trocken & theatralisch', text: "Die Nachtwache, hatte Zane beschlossen, war eine großartige Art, daran erinnert zu werden, wie zutiefst unwichtig man dem Universum war. Die Sterne ignorierten ihn. Der Wind ignorierte ihn mit echter Hingabe. Er zog den Schal seiner Mutter höher, lehnte den Rücken an den kalten Stein und sah trotzdem zu ihnen hinauf. Er salutierte der Dunkelheit. Prinzipien waren schließlich Prinzipien." },
        { label: 'Bissig & ungeschönt', text: "Nachtwache ist Strafdienst, der sich als Ehre verkleidet, und alle über mir wissen das. Du stehst sechs Stunden auf einem eiskalten Turm, damit du, falls etwas Schreckliches kommt, ein kleines bisschen früher darüber schreien kannst, bevor es alle umbringt. Das ist der ganze Job. Also stand ich da — den Schal meiner Mutter doppelt um den Hals, den Rücken am kalten Stein, herrlich entbehrlich — und, ja, gut, sah hinauf, weil dir niemand sagt, wie ungerecht die Sterne von hier oben sind." },
        { label: 'Märchenhaft & atmosphärisch', text: "Hoch oben auf dem Turm war die Nacht weit und alt, und Zane stand ganz allein in ihr, den Wollschal seiner Mutter zweimal um den Hals geschlungen. Immer wieder fand er die Stelle, an der die Farbe verlaufen war, eine kleine verblasste Landkarte irgendeines längst vergangenen Regensturms. Der Wind zog vorüber wie etwas, das anderswo erwartet wurde; die Sterne hingen fern und geduldig. Er lehnte den Rücken an den kalten Stein und sah hinauf, und eine Weile erinnerte sich die Wolle an eine Wärme, die seine Hände vergessen hatten." },
        { label: 'Frech & herzlich', text: "Nur ich hier oben. Ich, der Wind, die Dunkelheit und was auch immer die Dunkelheit heute Nacht versteckt — wunderbar. Der Schal meiner Mutter ist zweimal um meinen Hals geschlungen, und er wird reichen müssen, denn die Gastfreundschaft dieses Turms heißt „eiskalt“. Ich lehnte den Rücken an den kalten Stein und sah hinauf. Und, na gut, ja — die Sterne waren lächerlich schön. Vor dem Teil warnt einen keiner. Der Nacht würde ich nie die Genugtuung geben, das laut zuzugeben." },
      ],
    },
    {
      base: 'Nora hält Zane, während er stirbt und der Schnee fällt.',
      voices: [
        { label: 'Sinnlich & zärtlich', text: "Nora hatte den kleinen Holzvogel an hundert leichteren Abenden geschnitzt, und nun drückte sie ihn in Zanes versagende Hand, weil sie ihm nichts anderes zu geben hatte, das ihre eigenen Finger gemacht hatten. Ihre andere Hand blieb auf der Wunde. Der Schnee legte sich auf sein Haar und schmolz nicht. Er entschuldigte sich — für das Blut auf ihrem Ärmel, der Narr — und lächelte, als wäre alles in Ordnung. Sie hielt den Daumen an seinem Knöchel in Bewegung, die alte Schnitzbewegung, als könnte sie aus dem Nichts noch einen Morgen schnitzen." },
        { label: 'Atemlos & trotzig', text: "Bleib. Bleib bei mir, Zane. Ich befehle es dir. Der Schnee fiel und sein Blut war so warm dagegen, und ich presste beide Hände auf die Wunde, als könnte ich ihn mit Gewalt zusammenhalten. Der kleine Vogel, den ich geschnitzt hatte, lag noch in seiner Hand. „Wag es nicht“, sagte ich. „Wag es ja nicht.“ Er lächelte — das war das Schlimmste — und entschuldigte sich für meinen Ärmel. Er lächelte, als wäre alles in Ordnung. Es war nicht in Ordnung." },
        { label: 'Trocken & theatralisch', text: "„Das ist peinlich“, brachte Zane hervor, Blut auf den Zähnen, Schnee in den Wimpern, der kleine geschnitzte Vogel lose in seiner Hand. „Sterben. Im Winter. So dramatisch.“ Nora sagte ihm, er solle seinen Atem sparen, und drückte fester auf die Wunde; er sagte, der Atem sei ja genau das Problem, nicht wahr, und entschuldigte sich für ihren Ärmel. Der Schnee fiel weiter, gleichgültig und rein. Er machte noch einen Witz. Einen zweiten machte er nicht." },
        { label: 'Bissig & ungeschönt', text: "Niemand warnt dich, dass die Sterbenden weiterreden. In den Liedern bekommen sie eine saubere Zeile und ein geschmackvolles Verklingen. Im echten Leben verblutete Zane im Schnee und entschuldigte sich — entschuldigte sich, der wahnsinnige Narr — für das Blut auf meinem Ärmel, den geschnitzten Vogel, den ich ihm gegeben hatte, noch in seiner Faust. Ich sagte ihm, der Ärmel sei ohnehin ruiniert. Ich sagte ihm, er solle den Mund halten und bleiben. Eines von beidem tat er. Über welches bin ich immer noch wütend." },
      ],
    },
  ],
};

let flowState = {
  freewrite: { duration: 300, remaining: 300, timerId: null, running: false, prompt: '', text: '' },
  badly: { prompt: '', bad: '', less: '', phase: 'bad' },
  style: { sceneIdx: 0, attempt: '' },
};

function flowWordCount(text) { const m = (text || '').trim().match(/\S+/g); return m ? m.length : 0; }

function flowRandomPrompt(exclude) {
  const list = FLOW_PROMPTS[currentLang] || FLOW_PROMPTS.en;
  if (list.length === 1) return list[0];
  let p;
  do { p = list[Math.floor(Math.random() * list.length)]; } while (p === exclude);
  return p;
}

function flowClearTimer() {
  if (flowState.freewrite.timerId) { clearInterval(flowState.freewrite.timerId); flowState.freewrite.timerId = null; }
}

function flowStageEl() { return document.getElementById('flow-stage'); }

function renderFlow() {
  flowClearTimer();
  const body = document.getElementById('idea-section-body');
  if (!body) return;
  body.innerHTML =
    '<div class="idea-intro">' + t('flow.tagline') + '</div>' +
    '<div class="idea-stage" id="flow-stage"></div>';
  flowHome();
}

function flowHome() {
  flowClearTimer();
  const stage = flowStageEl();
  if (!stage) return;
  stage.innerHTML =
    '<div class="idea-lead">' + t('flow.home.title') + '</div>' +
    '<div class="idea-pick-grid" id="flow-pick-grid"></div>';
  const grid = stage.querySelector('#flow-pick-grid');
  [
    { key: 'freewrite', title: t('flow.freewrite.title'), sub: t('flow.freewrite.sub'), go: flowFreewriteStart },
    { key: 'badly', title: t('flow.badly.title'), sub: t('flow.badly.sub'), go: flowBadlyStart },
    { key: 'style', title: t('flow.style.title'), sub: t('flow.style.sub'), go: flowStyleStart },
  ].forEach(o => {
    const b = document.createElement('button');
    b.className = 'idea-pick';
    b.innerHTML = '<span class="idea-pick-txt"><span class="idea-pick-t">' + ideaEsc(o.title) + '</span><span class="idea-pick-s">' + ideaEsc(o.sub) + '</span></span>';
    b.addEventListener('click', o.go);
    grid.appendChild(b);
  });
}

// Escape hatch for warm-up text worth keeping: copy it onto the Notes canvas.
// Deliberately does NOT switch pages — leaving would destroy the RAM-only
// warm-up state. The button flips to a confirmation instead; the text stays.
function flowKeepToNotes(text, btn) {
  const s = (text || '').trim();
  if (!s) return;
  brainstorm.notes.push({
    id: Date.now(),
    x: 40,
    y: 40 + (brainstorm.notes.length % 6) * 130,
    text: s,
    color: IDEA_NOTE_COLORS[brainstorm.notes.length % IDEA_NOTE_COLORS.length],
  });
  saveProject();
  renderBrainstorm();
  if (btn) { btn.disabled = true; btn.textContent = t('flow.keep.done'); }
}

// ── Freewrite Timer ──
function flowFreewriteStart() {
  const fw = flowState.freewrite;
  fw.prompt = flowRandomPrompt();
  fw.duration = fw.duration || 300;
  fw.remaining = fw.duration;
  fw.running = false;
  fw.text = '';
  flowRenderFreewrite();
}

function flowRenderFreewrite() {
  const stage = flowStageEl();
  if (!stage) return;
  const fw = flowState.freewrite;
  const mins = Math.floor(fw.remaining / 60), secs = fw.remaining % 60;
  const timeStr = mins + ':' + (secs < 10 ? '0' : '') + secs;
  stage.innerHTML =
    '<div class="idea-lead">' + t('flow.freewrite.title') + '</div>' +
    '<div class="flow-duration-row">' +
      [300, 600, 900].map(d => '<button class="flow-dur-btn' + (fw.duration === d ? ' on' : '') + '" data-d="' + d + '">' + (d / 60) + ' ' + t('flow.min') + '</button>').join('') +
    '</div>' +
    '<div class="flow-prompt-row">' +
      '<div class="flow-prompt">' + ideaEsc(fw.prompt) + '</div>' +
      '<button class="idea-ghost flow-shuffle" id="flow-shuffle-btn" title="' + ideaEsc(t('flow.shuffle')) + '">&#10227;</button>' +
    '</div>' +
    '<textarea class="idea-answer flow-freewrite-area" id="flow-freewrite-area" rows="10" placeholder="' + ideaEsc(t('flow.freewrite.placeholder')) + '">' + ideaEsc(fw.text) + '</textarea>' +
    '<div class="flow-timer-row">' +
      '<div class="flow-timer" id="flow-timer">' + timeStr + '</div>' +
      '<div class="flow-wordcount" id="flow-wordcount">' + flowWordCount(fw.text) + ' ' + t('flow.words') + '</div>' +
      '<div class="idea-spacer"></div>' +
      '<button class="idea-next" id="flow-start-btn">' + (fw.running ? t('flow.pause') : t('flow.start')) + '</button>' +
    '</div>' +
    '<div class="idea-actions">' +
      '<button class="idea-ghost" id="flow-home-btn">' + t('flow.back') + '</button>' +
      '<div class="idea-spacer"></div>' +
      '<button class="idea-ghost" id="flow-keep-btn"' + (fw.text.trim() ? '' : ' style="display:none"') + '>' + t('flow.keep') + '</button>' +
    '</div>';

  stage.querySelector('#flow-home-btn').addEventListener('click', () => { flowClearTimer(); flowHome(); });
  stage.querySelector('#flow-keep-btn').addEventListener('click', () => flowKeepToNotes(fw.text, stage.querySelector('#flow-keep-btn')));
  stage.querySelectorAll('.flow-dur-btn').forEach(btn => btn.addEventListener('click', () => {
    if (fw.running) return;
    fw.duration = parseInt(btn.dataset.d, 10);
    fw.remaining = fw.duration;
    flowRenderFreewrite();
  }));
  stage.querySelector('#flow-shuffle-btn').addEventListener('click', () => { fw.prompt = flowRandomPrompt(fw.prompt); flowRenderFreewrite(); });
  const area = stage.querySelector('#flow-freewrite-area');
  autoResize(area);
  area.addEventListener('input', () => {
    fw.text = area.value;
    autoResize(area);
    const wc = stage.querySelector('#flow-wordcount');
    if (wc) wc.textContent = flowWordCount(fw.text) + ' ' + t('flow.words');
    const keepBtn = stage.querySelector('#flow-keep-btn');
    if (keepBtn && !keepBtn.disabled) keepBtn.style.display = fw.text.trim() ? '' : 'none';
  });
  stage.querySelector('#flow-start-btn').addEventListener('click', flowToggleTimer);
}

function flowToggleTimer() {
  const fw = flowState.freewrite;
  if (fw.running) {
    flowClearTimer();
    fw.running = false;
    flowRenderFreewrite();
    return;
  }
  fw.running = true;
  fw.timerId = setInterval(() => {
    fw.remaining--;
    const timerEl = document.getElementById('flow-timer');
    if (timerEl) {
      const m = Math.floor(fw.remaining / 60), s = fw.remaining % 60;
      timerEl.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    }
    if (fw.remaining <= 0) {
      flowClearTimer();
      fw.running = false;
      flowFreewriteDone();
    }
  }, 1000);
  flowRenderFreewrite();
}

function flowFreewriteDone() {
  const stage = flowStageEl();
  if (!stage) return;
  const fw = flowState.freewrite;
  stage.innerHTML =
    '<div class="idea-done-tag">' + t('flow.done') + '</div>' +
    '<div class="idea-close">' + ideaEsc(t('flow.freewrite.done.msg')) + ' (' + flowWordCount(fw.text) + ' ' + t('flow.words') + ')</div>' +
    '<div class="idea-actions idea-actions-end">' +
      '<button class="idea-ghost" id="flow-home-btn2">' + t('flow.back') + '</button>' +
      '<div class="idea-spacer"></div>' +
      (fw.text.trim() ? '<button class="idea-ghost" id="flow-keep-btn">' + t('flow.keep') + '</button>' : '') +
      '<button class="idea-next" id="flow-again-btn">' + t('flow.again') + '</button>' +
    '</div>';
  stage.querySelector('#flow-again-btn').addEventListener('click', flowFreewriteStart);
  stage.querySelector('#flow-home-btn2').addEventListener('click', flowHome);
  const keepBtn = stage.querySelector('#flow-keep-btn');
  if (keepBtn) keepBtn.addEventListener('click', () => flowKeepToNotes(fw.text, keepBtn));
}

// ── Write It Badly First ──
function flowBadlyStart() {
  const b = flowState.badly;
  b.prompt = flowRandomPrompt();
  b.bad = '';
  b.less = '';
  b.phase = 'bad';
  flowRenderBadly();
}

function flowRenderBadly() {
  const stage = flowStageEl();
  if (!stage) return;
  const b = flowState.badly;
  const isBad = b.phase === 'bad';
  stage.innerHTML =
    '<div class="idea-lead">' + t('flow.badly.title') + '</div>' +
    '<div class="flow-prompt-row">' +
      '<div class="flow-prompt">' + ideaEsc(b.prompt) + '</div>' +
      (isBad ? '<button class="idea-ghost flow-shuffle" id="flow-shuffle-btn" title="' + ideaEsc(t('flow.shuffle')) + '">&#10227;</button>' : '') +
    '</div>' +
    '<div class="idea-dev-instructions"><p>' + ideaEsc(isBad ? t('flow.badly.instr1') : t('flow.badly.instr2')) + '</p></div>' +
    '<textarea class="idea-answer" id="flow-badly-area" rows="8" placeholder="' + ideaEsc(t('flow.badly.placeholder')) + '">' + ideaEsc(isBad ? b.bad : b.less) + '</textarea>' +
    '<div class="idea-actions">' +
      '<button class="idea-ghost" id="flow-home-btn">' + t('flow.back') + '</button>' +
      '<div class="idea-spacer"></div>' +
      '<button class="idea-next" id="flow-badly-next">' + (isBad ? t('flow.badly.next') : t('flow.done')) + '</button>' +
    '</div>';

  stage.querySelector('#flow-home-btn').addEventListener('click', flowHome);
  const shuffleBtn = stage.querySelector('#flow-shuffle-btn');
  if (shuffleBtn) shuffleBtn.addEventListener('click', () => { b.prompt = flowRandomPrompt(b.prompt); flowRenderBadly(); });
  const area = stage.querySelector('#flow-badly-area');
  autoResize(area);
  area.addEventListener('input', () => {
    if (isBad) b.bad = area.value; else b.less = area.value;
    autoResize(area);
  });
  stage.querySelector('#flow-badly-next').addEventListener('click', () => {
    if (isBad) { b.phase = 'less'; flowRenderBadly(); } else { flowBadlyDone(); }
  });
}

function flowBadlyDone() {
  const stage = flowStageEl();
  if (!stage) return;
  // Only the second, "less bad" draft is worth keeping — the deliberately bad
  // one is disposable by design.
  const keepText = (flowState.badly.less.trim() || flowState.badly.bad.trim());
  stage.innerHTML =
    '<div class="idea-done-tag">' + t('flow.done') + '</div>' +
    '<div class="idea-close">' + ideaEsc(t('flow.badly.done.msg')) + '</div>' +
    '<div class="idea-actions idea-actions-end">' +
      '<button class="idea-ghost" id="flow-home-btn2">' + t('flow.back') + '</button>' +
      '<div class="idea-spacer"></div>' +
      (keepText ? '<button class="idea-ghost" id="flow-keep-btn">' + t('flow.keep') + '</button>' : '') +
      '<button class="idea-next" id="flow-again-btn">' + t('flow.again') + '</button>' +
    '</div>';
  stage.querySelector('#flow-again-btn').addEventListener('click', flowBadlyStart);
  stage.querySelector('#flow-home-btn2').addEventListener('click', flowHome);
  const keepBtn = stage.querySelector('#flow-keep-btn');
  if (keepBtn) keepBtn.addEventListener('click', () => flowKeepToNotes(keepText, keepBtn));
}

// ── Style Sampler (hardcoded scenes — static site, no generated text) ──
function flowStyleStart() {
  const s = flowState.style;
  s.sceneIdx = 0;
  s.attempt = '';
  flowRenderStyle();
}

function flowRenderStyle() {
  const stage = flowStageEl();
  if (!stage) return;
  const scenes = WRITING_STYLE_SCENES[currentLang] || WRITING_STYLE_SCENES.en;
  const s = flowState.style;
  const scene = scenes[s.sceneIdx];
  stage.innerHTML =
    '<div class="idea-lead">' + t('flow.style.title') + '</div>' +
    '<div class="flow-scene-picker">' +
      scenes.map((sc, i) => '<button class="flow-scene-btn' + (i === s.sceneIdx ? ' on' : '') + '" data-i="' + i + '">' + t('flow.style.scene') + ' ' + (i + 1) + '</button>').join('') +
    '</div>' +
    '<div class="flow-scene-base">' + ideaEsc(scene.base) + '</div>' +
    '<div class="flow-voices">' + scene.voices.map(v => '<div class="flow-voice"><div class="flow-voice-label">' + ideaEsc(v.label) + '</div><div class="flow-voice-text">' + ideaEsc(v.text) + '</div></div>').join('') + '</div>' +
    '<div class="idea-dev-conclusion-label">' + t('flow.style.yourturn') + '</div>' +
    '<textarea class="idea-answer" id="flow-style-area" rows="6" placeholder="' + ideaEsc(t('flow.style.placeholder')) + '">' + ideaEsc(s.attempt) + '</textarea>' +
    '<div class="idea-actions">' +
      '<button class="idea-ghost" id="flow-home-btn">' + t('flow.back') + '</button>' +
      '<div class="idea-spacer"></div>' +
      '<button class="idea-ghost" id="flow-keep-btn"' + (s.attempt.trim() ? '' : ' style="display:none"') + '>' + t('flow.keep') + '</button>' +
    '</div>';

  stage.querySelector('#flow-home-btn').addEventListener('click', flowHome);
  stage.querySelector('#flow-keep-btn').addEventListener('click', () => flowKeepToNotes(s.attempt, stage.querySelector('#flow-keep-btn')));
  stage.querySelectorAll('.flow-scene-btn').forEach(btn => btn.addEventListener('click', () => {
    s.sceneIdx = parseInt(btn.dataset.i, 10);
    s.attempt = '';
    flowRenderStyle();
  }));
  const area = stage.querySelector('#flow-style-area');
  if (area) {
    autoResize(area);
    area.addEventListener('input', () => {
      s.attempt = area.value;
      autoResize(area);
      const keepBtn = stage.querySelector('#flow-keep-btn');
      if (keepBtn && !keepBtn.disabled) keepBtn.style.display = s.attempt.trim() ? '' : 'none';
    });
  }
}

// ── Brainstorming (idea tree) ──
function bs2AddChild(parentId, type, prompt) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  ideaMap.nodes.push({ id, parentId, type, text: '', prompt: prompt || null });
  saveProject();
  renderBrainstorming();
  const newText = document.querySelector(`#bs2-tree [data-node-id="${id}"] .bs2-text`);
  if (newText) { newText.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); newText.focus(); }
}

function bs2DeleteNode(nodeId) {
  const collect = id => {
    const children = ideaMap.nodes.filter(n => n.parentId === id).map(n => n.id);
    return [id, ...children.flatMap(collect)];
  };
  const ids = new Set(collect(nodeId));
  ideaMap.nodes = ideaMap.nodes.filter(n => !ids.has(n.id));
  saveProject();
  renderBrainstorming();
}

function createBs2Card(node, colorMap = {}) {
  const children = ideaMap.nodes.filter(n => n.parentId === node.id);
  const wrap = document.createElement('div');
  wrap.className = 'bs2-node' + (node.parentId ? ' bs2-child' : '');
  wrap.dataset.nodeId = node.id;
  const c = colorMap[node.id];
  if (c) {
    wrap.style.setProperty('--bs2-color', c.main);
    wrap.style.setProperty('--bs2-color-dim', c.dim);
  }

  const TYPE_LABEL = { why: 'WHY?', 'what-if': `WHAT IF … ${node.prompt}?`, 'and-then': 'AND THEN?' };

  wrap.innerHTML = `
    ${node.parentId ? '<div class="bs2-connector"></div>' : ''}
    <div class="bs2-card">
      ${TYPE_LABEL[node.type] ? `<div class="bs2-type-label">${TYPE_LABEL[node.type]}</div>` : ''}
      <textarea class="bs2-text" rows="1" placeholder="${node.type === 'root' ? t('bs2.root.placeholder') : t('bs2.child.placeholder')}">${ideaEsc(node.text)}</textarea>
      <div class="bs2-actions">
        <button class="bs2-btn bs2-btn-why">+ Why?</button>
        <button class="bs2-btn bs2-btn-whatif">+ What if…</button>
        <button class="bs2-btn bs2-btn-andthen">+ And then?</button>
        <button class="bs2-btn bs2-btn-del" title="${t('beat.delete.title')}">&times;</button>
      </div>
      <div class="bs2-picker" style="display:none">
        <div class="bs2-picker-chips">
          ${WHATIF_PRESETS.map(p => `<button class="bs2-chip" data-p="${p}">${p}</button>`).join('')}
        </div>
        <div class="bs2-picker-row">
          <span class="bs2-picker-prefix">What if…</span>
          <input class="bs2-picker-input" placeholder="${t('bs2.whatif.placeholder')}" maxlength="80">
          <button class="bs2-picker-go">→</button>
        </div>
      </div>
    </div>
    <div class="bs2-children"></div>
  `;

  const textarea = wrap.querySelector('.bs2-text');
  textarea.addEventListener('input', () => {
    const n = ideaMap.nodes.find(n => n.id === node.id);
    if (n) n.text = textarea.value;
    autoResize(textarea);
    saveProjectDebounced();
  });
  textarea.addEventListener('blur', () => autoResize(textarea));

  wrap.querySelector('.bs2-btn-why').addEventListener('click', () => bs2AddChild(node.id, 'why', null));
  wrap.querySelector('.bs2-btn-andthen').addEventListener('click', () => bs2AddChild(node.id, 'and-then', null));

  const picker = wrap.querySelector('.bs2-picker');
  wrap.querySelector('.bs2-btn-whatif').addEventListener('click', e => {
    e.stopPropagation();
    picker.style.display = picker.style.display === 'none' ? '' : 'none';
    if (picker.style.display !== 'none') wrap.querySelector('.bs2-picker-input').focus();
  });

  wrap.querySelectorAll('.bs2-chip').forEach(chip => {
    chip.addEventListener('click', () => { picker.style.display = 'none'; bs2AddChild(node.id, 'what-if', chip.dataset.p); });
  });

  const pickerInput = wrap.querySelector('.bs2-picker-input');
  const addCustom = () => {
    const p = pickerInput.value.trim();
    if (!p) return;
    picker.style.display = 'none';
    bs2AddChild(node.id, 'what-if', p);
  };
  wrap.querySelector('.bs2-picker-go').addEventListener('click', addCustom);
  pickerInput.addEventListener('keydown', e => { if (e.key === 'Enter') addCustom(); });

  wrap.querySelector('.bs2-btn-del').addEventListener('click', () => {
    const hasChildren = ideaMap.nodes.some(n => n.parentId === node.id);
    if (!hasChildren) { bs2DeleteNode(node.id); return; }
    const c = document.createElement('div');
    c.innerHTML = `
      <div class="modal-title">${t('bs2.delete.title')}</div>
      <div class="modal-empty">${t('bs2.delete.msg')}</div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
        <button class="btn-secondary" id="bs2-del-cancel">${t('btn.cancel')}</button>
        <button class="btn-primary" id="bs2-del-confirm">${t('bs2.delete.confirm')}</button>
      </div>`;
    openModal(c);
    c.querySelector('#bs2-del-cancel').addEventListener('click', closeModal);
    c.querySelector('#bs2-del-confirm').addEventListener('click', () => { closeModal(); bs2DeleteNode(node.id); });
  });

  const childrenEl = wrap.querySelector('.bs2-children');
  children.forEach(child => childrenEl.appendChild(createBs2Card(child, colorMap)));

  return wrap;
}

function renderBrainstorming() {
  const tree = document.getElementById('bs2-tree');
  if (!tree) return;
  tree.innerHTML = '';
  const roots = ideaMap.nodes.filter(n => !n.parentId);
  if (roots.length === 0) {
    tree.innerHTML = `<div class="bs2-empty">${t('brainstorming.empty')}</div>`;
    return;
  }
  // Assign colors at every branching point (node with 2+ children).
  // Only those nodes get a color entry; CSS cascade propagates it to their subtrees.
  // A deeper branch overrides an ancestor's color automatically via cascade.
  const colorMap = {};
  let colorIdx = 0;
  const walk = (nodeId) => {
    const children = ideaMap.nodes.filter(n => n.parentId === nodeId);
    if (children.length >= 2) {
      children.forEach(child => {
        colorMap[child.id] = BS2_COLORS[colorIdx % BS2_COLORS.length];
        colorIdx++;
        walk(child.id);
      });
    } else {
      children.forEach(child => walk(child.id));
    }
  };
  if (roots.length >= 2) {
    roots.forEach(root => {
      colorMap[root.id] = BS2_COLORS[colorIdx % BS2_COLORS.length];
      colorIdx++;
      walk(root.id);
    });
  } else {
    walk(roots[0].id);
  }
  roots.forEach(node => tree.appendChild(createBs2Card(node, colorMap)));
  // Run autoResize after cards are in the DOM
  requestAnimationFrame(() => tree.querySelectorAll('.bs2-text').forEach(autoResize));
}

// ── Worldbuilding ──
function renderWorldbuilding() {
  const sidebar = document.getElementById('wb-sidebar');
  const main = document.getElementById('wb-main');
  if (!sidebar || !main) return;

  const visibleBuiltins = WB_BUILTIN_CATS.filter(c => !(worldbuilding.hiddenBuiltins || []).includes(c));
  const allCats = [...visibleBuiltins, ...worldbuilding.customCategories];
  const countFor = cat => worldbuilding.entries.filter(e => e.category === cat).length;
  const totalCount = worldbuilding.entries.length;

  // Sidebar
  const allLabel = t('wb.all');
  sidebar.innerHTML = `
    <div class="wb-cat-list">
      <div class="wb-cat-item ${wbFilter === 'Alle' ? 'active' : ''}" data-cat="Alle">
        <span>${allLabel}</span><span class="wb-cat-count">${totalCount}</span>
      </div>
      ${allCats.map(cat => `
        <div class="wb-cat-item wb-cat-custom ${wbFilter === cat ? 'active' : ''}" data-cat="${cat}">
          <span>${t('wb.builtin.' + cat) || cat}</span>
          <div class="wb-cat-right">
            <span class="wb-cat-count">${countFor(cat)}</span>
            <button class="wb-cat-del" data-cat="${cat}" title="Delete category">&times;</button>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="wb-cat-add">
      <input class="wb-cat-input" id="wb-cat-input" placeholder="${t('wb.cat.placeholder')}" maxlength="32">
      <button class="wb-cat-add-btn" id="wb-cat-add-btn">+</button>
    </div>
  `;

  sidebar.querySelectorAll('.wb-cat-item').forEach(el => {
    el.addEventListener('click', () => { wbFilter = el.dataset.cat; renderWorldbuilding(); });
  });

  sidebar.querySelectorAll('.wb-cat-del').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const cat = btn.dataset.cat;
      const count = countFor(cat);
      const doDelete = () => {
        worldbuilding.entries.forEach(entry => { if (entry.category === cat) entry.category = 'Sonstiges'; });
        if (WB_BUILTIN_CATS.includes(cat)) {
          if (!worldbuilding.hiddenBuiltins) worldbuilding.hiddenBuiltins = [];
          worldbuilding.hiddenBuiltins.push(cat);
        } else {
          worldbuilding.customCategories = worldbuilding.customCategories.filter(c => c !== cat);
        }
        if (wbFilter === cat) wbFilter = 'Alle';
        saveProject();
        renderWorldbuilding();
      };
      if (count === 0) { doDelete(); return; }
      const container = document.createElement('div');
      container.innerHTML = `
        <div class="modal-title">${t('wb.del.cat.title')}</div>
        <div class="modal-empty">${t('wb.del.cat.msg').replace('{cat}', cat).replace('{n}', count).replace('{fallback}', t('wb.fallback.cat'))}</div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
          <button class="btn-secondary" id="del-cat-cancel">${t('btn.cancel')}</button>
          <button class="btn-primary" id="del-cat-confirm">${t('beat.delete.title')}</button>
        </div>`;
      openModal(container);
      container.querySelector('#del-cat-cancel').addEventListener('click', closeModal);
      container.querySelector('#del-cat-confirm').addEventListener('click', () => { closeModal(); doDelete(); });
    });
  });

  const catInput = sidebar.querySelector('#wb-cat-input');
  sidebar.querySelector('#wb-cat-add-btn').addEventListener('click', () => {
    const name = catInput.value.trim();
    if (!name || allCats.includes(name)) { catInput.focus(); return; }
    worldbuilding.customCategories.push(name);
    wbFilter = name;
    saveProject();
    renderWorldbuilding();
  });
  catInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') sidebar.querySelector('#wb-cat-add-btn').click();
  });

  // Main area
  const visibleEntries = wbFilter === 'Alle'
    ? worldbuilding.entries
    : worldbuilding.entries.filter(e => e.category === wbFilter);

  const addCat = wbFilter === 'Alle' ? 'Sonstiges' : wbFilter;

  main.innerHTML = `
    <div class="page-header">
      <h1>${wbFilter === 'Alle' ? t('nav.worldbuilding') : (t('wb.builtin.' + wbFilter) || wbFilter)}</h1>
      <button class="btn-primary" id="wb-add-btn">${t('wb.add.entry')}</button>
    </div>
    <div class="wb-grid" id="wb-grid"></div>
  `;

  const grid = main.querySelector('#wb-grid');

  if (visibleEntries.length === 0) {
    grid.innerHTML = `<div class="empty-state">${t('wb.empty').replace('\n', '<br>')}</div>`;
  } else {
    visibleEntries.forEach(entry => {
      const idx = worldbuilding.entries.indexOf(entry);
      const card = document.createElement('div');
      card.className = 'wb-card';
      card.innerHTML = `
        <div class="wb-card-header">
          <input class="wb-card-title" value="${ideaEsc(entry.title)}" placeholder="${t('wb.entry.title.placeholder')}">
          <span class="wb-card-cat">${t('wb.builtin.' + entry.category) || entry.category}</span>
          <button class="wb-card-delete" title="Delete">&times;</button>
        </div>
        ${entry.image ? `
          <div class="wb-card-img-wrap">
            <img src="${entry.image}" class="wb-card-img" alt="">
            <button class="wb-card-img-del" title="Remove image">&times;</button>
          </div>
        ` : ''}
        <textarea class="wb-card-text" placeholder="${t('wb.entry.text.placeholder')}" rows="4">${ideaEsc(entry.text)}</textarea>
        <label class="wb-card-img-add" title="${t('char.add.image')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          ${entry.image ? t('wb.img.replace') : t('char.add.image')}
          <input type="file" accept="image/*" class="wb-img-input" style="display:none">
        </label>
      `;
      card.querySelector('.wb-card-title').addEventListener('input', e => {
        worldbuilding.entries[idx].title = e.target.value;
        saveProjectDebounced();
      });
      card.querySelector('.wb-card-text').addEventListener('input', e => {
        worldbuilding.entries[idx].text = e.target.value;
        saveProjectDebounced();
      });
      card.querySelector('.wb-card-delete').addEventListener('click', () => {
        if (entry.image) deleteImage(entry.image.split('/').pop());
        worldbuilding.entries.splice(idx, 1);
        saveProject();
        renderWorldbuilding();
      });
      if (entry.image) {
        card.querySelector('.wb-card-img-del').addEventListener('click', () => {
          deleteImage(entry.image.split('/').pop());
          worldbuilding.entries[idx].image = null;
          saveProject();
          renderWorldbuilding();
        });
      }
      card.querySelector('.wb-img-input').addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        const result = await uploadImage(file);
        worldbuilding.entries[idx].image = result.path;
        await saveProject();
        renderWorldbuilding();
      });
      grid.appendChild(card);
    });
  }

  main.querySelector('#wb-add-btn').addEventListener('click', () => {
    worldbuilding.entries.push({ id: Date.now(), category: addCat, title: '', text: '' });
    if (wbFilter !== 'Alle' && wbFilter !== addCat) wbFilter = addCat;
    saveProject();
    renderWorldbuilding();
    const cards = grid.querySelectorAll('.wb-card');
    if (cards.length) cards[cards.length - 1].querySelector('.wb-card-title').focus();
  });
}

// ── Navigation (icon sidebar) ──
function switchPage(page) {
  if (typeof flushEditor === 'function') { flushEditor(); saveProject(); }
  if (page !== 'ideas' && typeof flowClearTimer === 'function') flowClearTimer();
  document.querySelectorAll('.icon-nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const btn = document.querySelector(`.icon-nav-btn[data-page="${page}"]`);
  if (btn) btn.classList.add('active');
  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');
  if (page === 'home') renderHome();
  if (page === 'stats') renderStats();
  if (page === 'beats') renderBeats(); // keeps drafted chips & coverage current
  if (page === 'worldbuilding') renderWorldbuilding();
  if (page === 'ideas') renderIdeas();
  if (page === 'theme') renderTheme();
  if (page === 'brainstorm') requestAnimationFrame(() => { bsCanvas.querySelectorAll('.bs-note-text').forEach(autoResize); expandCanvas(); });
}

async function renderHome() {
  const container = document.getElementById('home-recent');
  container.innerHTML = '';

  const projects = await listProjects();
  if (!projects.length) return;

  const label = document.createElement('div');
  label.className = 'home-recent-label';
  label.textContent = t('home.recent');
  container.appendChild(label);

  const hint = document.createElement('div');
  hint.className = 'home-recent-hint';
  hint.textContent = t('home.recent.hint');
  container.appendChild(hint);

  const grid = document.createElement('div');
  grid.className = 'home-projects-grid';

  const locale = currentLang === 'de' ? 'de-DE' : 'en-GB';
  projects.forEach(p => {
    const date = new Date(p.modified).toLocaleDateString(locale, {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
    const card = document.createElement('div');
    card.className = 'home-project-card';
    card.innerHTML = `
      <div class="home-project-name">${ideaEsc(p.name)}</div>
      <div class="home-project-date">${date}</div>
      <button class="home-project-del" title="${t('beat.delete.title')}">&times;</button>
    `;
    card.addEventListener('click', async e => {
      if (e.target.closest('.home-project-del')) return;
      const data = await loadProjectByName(p.name);
      setCurrentProjectName(p.name);
      applyProjectData(data);
      updateProjectLabel();
      switchPage('writing');
    });
    card.querySelector('.home-project-del').addEventListener('click', async e => {
      e.stopPropagation();
      await deleteProjectByName(p.name);
      renderHome();
    });
    grid.appendChild(card);
  });

  container.appendChild(grid);
}

// ══════════════════════════════════
// ── IDEA POOL ──
// A cross-project collection that lives ABOVE individual projects: a place to
// dump every "what if I wrote…" idea so it stops competing for attention,
// combine ideas that fit together, and decide which one to develop next.
// Stored in its own localStorage key (not inside any project).
// ══════════════════════════════════
const LS_IDEAPOOL = 'inktink.ideapool';
// idea: { id, title, note, spark: 0-3, ready: 0-3, combinedFrom: [titles], created }
let ideaPool = { focusId: null, sort: 'created', ideas: [] };
let ideaPoolCombine = false;       // combine-mode toggle
let ideaPoolSelected = new Set();  // ids selected while combining
let ideaPoolSuggestId = null;      // transient "decide for me" highlight

function loadIdeaPool() {
  try {
    const raw = localStorage.getItem(LS_IDEAPOOL);
    if (raw) {
      const d = JSON.parse(raw);
      ideaPool = {
        focusId: d.focusId || null,
        sort: d.sort || 'created',
        ideas: Array.isArray(d.ideas) ? d.ideas : [],
      };
    }
  } catch {}
}

function saveIdeaPool() {
  try { localStorage.setItem(LS_IDEAPOOL, JSON.stringify(ideaPool)); } catch {}
}

function ideaPoolId() {
  return 'idea-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function ideaPoolSorted() {
  const list = ideaPool.ideas.slice();
  const sweet = i => (i.spark || 0) + (i.ready || 0);
  switch (ideaPool.sort) {
    case 'spark': list.sort((a, b) => (b.spark || 0) - (a.spark || 0)); break;
    case 'ready': list.sort((a, b) => (b.ready || 0) - (a.ready || 0)); break;
    case 'sweet': list.sort((a, b) => sweet(b) - sweet(a)); break;
    default:      list.sort((a, b) => (b.created || 0) - (a.created || 0));
  }
  // The current focus always floats to the very top, whatever the sort.
  if (ideaPool.focusId) {
    list.sort((a, b) => (b.id === ideaPool.focusId) - (a.id === ideaPool.focusId));
  }
  return list;
}

function ideaPoolAdd(title) {
  const text = (title || '').trim();
  if (!text) return;
  ideaPool.ideas.push({
    id: ideaPoolId(), title: text, note: '', link: '', image: '',
    spark: 0, ready: 0, combinedFrom: [], created: Date.now(),
  });
  saveIdeaPool();
  renderIdeaPool();
}

// Weighted-random pick so excitement nudges the dice without making it
// deterministic — the point is to break decision paralysis, not to be "right".
function ideaPoolPick() {
  const pool = ideaPool.ideas.filter(i => i.id !== ideaPool.focusId);
  if (!pool.length) return;
  let total = 0;
  for (const i of pool) total += (i.spark || 0) + 1;
  let r = Math.random() * total;
  let chosen = pool[0];
  for (const i of pool) { r -= (i.spark || 0) + 1; if (r <= 0) { chosen = i; break; } }
  ideaPoolSuggestId = chosen.id;
  renderIdeaPool();
}

function ideaPoolCombineSelected() {
  const picked = ideaPool.ideas.filter(i => ideaPoolSelected.has(i.id));
  if (picked.length < 2) return;
  const sources = picked.map(i => i.title);
  const note = picked.map(i => i.note).filter(Boolean).join('\n\n');
  ideaPool.ideas.push({
    id: ideaPoolId(),
    title: sources.join(' + '),
    note,
    spark: Math.max(...picked.map(i => i.spark || 0)),
    ready: 0,
    combinedFrom: sources,
    created: Date.now(),
  });
  ideaPoolCombine = false;
  ideaPoolSelected.clear();
  saveIdeaPool();
  renderIdeaPool();
}

// Picks a project name that won't silently overwrite an existing saved
// project ("My idea", "My idea 2", …). Used both for ideas graduating into
// projects and for renaming the current project via the sidebar title.
function uniqueProjectName(base, exceptCurrent) {
  const store = readProjectsStore();
  let name = base || t('project.untitled');
  let n = 2;
  while (store[name] && name !== exceptCurrent) name = base + ' ' + (n++);
  return name;
}

// Turns an idea into a real, saved InkTink project: a fresh workspace whose
// description is seeded from the idea's note. Optionally leaves the idea in the
// pool (default removes it, since it has "graduated").
function ideaPoolToProject(idea, keepInPool) {
  if (typeof flushEditor === 'function') flushEditor();
  // Carry the idea's collected material into the new project, not just the
  // note: its image seeds the moodboard, its link becomes a Notes sticky.
  const fresh = {
    beats: [],
    characters: [],
    moodboard: idea.image ? [{ id: Date.now(), src: idea.image, comment: idea.title || '' }] : [],
    blurb: idea.note || '',
    writing: { chapters: [] },
    brainstorm: idea.link
      ? { notes: [{ id: Date.now(), x: 40, y: 40, text: idea.title || '', color: IDEA_NOTE_COLORS[0], hyperlinks: [{ url: idea.link, label: '' }] }], links: [] }
      : { notes: [], links: [] },
    timeline: { columns: [], rows: [] }, inspiration: [], todos: [],
    writingGoal: 0, wordHistory: [], selectedStructure: null,
    worldbuilding: { entries: [], customCategories: [], hiddenBuiltins: [] },
    ideaMap: { nodes: [] }, storyTheme: {}, ideaWorkshops: {},
  };
  setCurrentProjectName(null);
  applyProjectData(fresh);
  const name = uniqueProjectName((idea.title || '').trim());
  saveProjectAs(name); // also adopts the name + persists the pointer
  updateProjectLabel();

  if (!keepInPool) {
    ideaPool.ideas = ideaPool.ideas.filter(i => i.id !== idea.id);
    if (ideaPool.focusId === idea.id) ideaPool.focusId = null;
    if (ideaPoolSuggestId === idea.id) ideaPoolSuggestId = null;
    saveIdeaPool();
  }
  switchPage('writing');
}

// Lets the user pan & zoom a picked image inside a fixed-aspect frame so
// they choose the crop themselves, instead of us guessing via object-fit.
function openImageCropModal(dataUrl, onConfirm) {
  const FRAME_W = 320, FRAME_H = 240;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="modal-title">${t('ideapool.image.crop.title')}</div>
    <div class="ip-crop-frame" style="width:${FRAME_W}px;height:${FRAME_H}px">
      <img class="ip-crop-img" draggable="false">
    </div>
    <input type="range" class="ip-crop-zoom" min="0" max="100" value="0">
    <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:16px">
      <button class="btn-secondary" id="ip-crop-cancel">${t('btn.cancel')}</button>
      <button class="btn-primary" id="ip-crop-use">${t('ideapool.image.crop.use')}</button>
    </div>
  `;
  openModal(wrap);

  const frame = wrap.querySelector('.ip-crop-frame');
  const img = wrap.querySelector('.ip-crop-img');
  const zoomSlider = wrap.querySelector('.ip-crop-zoom');

  let natW = 0, natH = 0, minScale = 1, scale = 1, offX = 0, offY = 0;
  let dragging = false, startX = 0, startY = 0, startOffX = 0, startOffY = 0;

  function applyTransform() {
    img.style.width = (natW * scale) + 'px';
    img.style.height = (natH * scale) + 'px';
    img.style.transform = `translate(${offX}px, ${offY}px)`;
  }
  function clampOffsets() {
    const w = natW * scale, h = natH * scale;
    offX = Math.min(0, Math.max(FRAME_W - w, offX));
    offY = Math.min(0, Math.max(FRAME_H - h, offY));
  }

  img.onload = () => {
    natW = img.naturalWidth; natH = img.naturalHeight;
    minScale = Math.max(FRAME_W / natW, FRAME_H / natH);
    scale = minScale;
    offX = (FRAME_W - natW * scale) / 2;
    offY = (FRAME_H - natH * scale) / 2;
    zoomSlider.value = 0;
    applyTransform();
  };
  img.src = dataUrl;

  zoomSlider.addEventListener('input', () => {
    const frac = zoomSlider.value / 100;
    const maxScale = minScale * 3;
    const cx = FRAME_W / 2, cy = FRAME_H / 2;
    const imgX = (cx - offX) / scale, imgY = (cy - offY) / scale;
    scale = minScale + (maxScale - minScale) * frac;
    offX = cx - imgX * scale;
    offY = cy - imgY * scale;
    clampOffsets();
    applyTransform();
  });

  function pointerDown(e) {
    dragging = true;
    const p = e.touches ? e.touches[0] : e;
    startX = p.clientX; startY = p.clientY;
    startOffX = offX; startOffY = offY;
  }
  function pointerMove(e) {
    if (!dragging) return;
    const p = e.touches ? e.touches[0] : e;
    offX = startOffX + (p.clientX - startX);
    offY = startOffY + (p.clientY - startY);
    clampOffsets();
    applyTransform();
  }
  function pointerUp() { dragging = false; }

  frame.addEventListener('mousedown', pointerDown);
  window.addEventListener('mousemove', pointerMove);
  window.addEventListener('mouseup', pointerUp);
  frame.addEventListener('touchstart', pointerDown, { passive: true });
  frame.addEventListener('touchmove', pointerMove, { passive: true });
  frame.addEventListener('touchend', pointerUp);

  function cleanup() {
    window.removeEventListener('mousemove', pointerMove);
    window.removeEventListener('mouseup', pointerUp);
  }

  wrap.querySelector('#ip-crop-cancel').addEventListener('click', () => { cleanup(); closeModal(); });
  wrap.querySelector('#ip-crop-use').addEventListener('click', () => {
    const OUT_W = 640, OUT_H = 480;
    const canvas = document.createElement('canvas');
    canvas.width = OUT_W; canvas.height = OUT_H;
    const ctx = canvas.getContext('2d');
    const sx = -offX / scale, sy = -offY / scale;
    const sw = FRAME_W / scale, sh = FRAME_H / scale;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, OUT_W, OUT_H);
    const result = canvas.toDataURL('image/jpeg', 0.88);
    cleanup();
    closeModal();
    onConfirm(result);
  });
}

function ideaPoolToProjectModal(idea) {
  const container = document.createElement('div');
  container.innerHTML = `
    <div class="modal-title">${t('ideapool.toproject.title')}</div>
    <div class="modal-empty">${t('ideapool.toproject.confirm')}</div>
    <label class="ip-keep"><input type="checkbox" id="ip-keep"> ${t('ideapool.toproject.keep')}</label>
    <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:20px">
      <button class="btn-secondary" id="ip-tp-cancel">${t('btn.cancel')}</button>
      <button class="btn-primary" id="ip-tp-go">${t('ideapool.toproject.go')}</button>
    </div>
  `;
  openModal(container);
  container.querySelector('#ip-tp-cancel').addEventListener('click', closeModal);
  container.querySelector('#ip-tp-go').addEventListener('click', () => {
    const keep = container.querySelector('#ip-keep').checked;
    closeModal();
    ideaPoolToProject(idea, keep);
  });
}

function ideaPoolRatingEl(idea, key, label) {
  const wrap = document.createElement('div');
  wrap.className = 'ip-rating';
  const lab = document.createElement('span');
  lab.className = 'ip-rating-label';
  lab.textContent = label;
  wrap.appendChild(lab);
  const dots = document.createElement('div');
  dots.className = 'ip-dots';
  for (let i = 1; i <= 3; i++) {
    const dot = document.createElement('button');
    dot.className = 'ip-dot' + ((idea[key] || 0) >= i ? ' on' : '');
    dot.type = 'button';
    dot.addEventListener('click', () => {
      idea[key] = (idea[key] === i) ? i - 1 : i; // click current top dot to clear it
      saveIdeaPool();
      renderIdeaPool();
    });
    dots.appendChild(dot);
  }
  wrap.appendChild(dots);
  return wrap;
}

// container: the element to render into (the idea pool now lives inline inside
// the "Find & Develop Ideas" stage, reached via a starter card, rather than
// having its own top-level nav page). Remembered across re-renders so internal
// calls like renderIdeaPool() after an edit don't need to pass it again.
let ideaPoolContainer = null;
function renderIdeaPool(container) {
  if (container) ideaPoolContainer = container;
  const page = ideaPoolContainer;
  if (!page) return;
  page.innerHTML = '';

  const intro = document.createElement('div');
  intro.className = 'ip-intro';
  intro.textContent = t('ideapool.tagline');
  page.appendChild(intro);

  // ── Capture row ──
  const capture = document.createElement('div');
  capture.className = 'ip-capture';
  const input = document.createElement('input');
  input.className = 'ip-capture-input';
  input.placeholder = t('ideapool.capture.placeholder');
  const addBtn = document.createElement('button');
  addBtn.className = 'btn-primary';
  addBtn.textContent = t('ideapool.add');
  const submit = () => { ideaPoolAdd(input.value); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  addBtn.addEventListener('click', submit);
  capture.appendChild(input);
  capture.appendChild(addBtn);
  page.appendChild(capture);

  // ── Focus banner ──
  const focus = ideaPool.ideas.find(i => i.id === ideaPool.focusId);
  const banner = document.createElement('div');
  banner.className = 'ip-focus' + (focus ? ' has' : '');
  if (focus) {
    const info = document.createElement('div');
    info.className = 'ip-focus-info';
    info.innerHTML = '<span class="ip-focus-label">' + t('ideapool.focus.label') + '</span>' +
      '<span class="ip-focus-title"></span>';
    info.querySelector('.ip-focus-title').textContent = focus.title;
    const clear = document.createElement('button');
    clear.className = 'ip-focus-clear';
    clear.textContent = t('ideapool.focus.clear');
    clear.addEventListener('click', () => { ideaPool.focusId = null; saveIdeaPool(); renderIdeaPool(); });
    banner.appendChild(info);
    banner.appendChild(clear);
  } else {
    banner.textContent = t('ideapool.focus.none');
  }
  page.appendChild(banner);

  // ── Suggestion (from "decide for me") ──
  if (ideaPoolSuggestId) {
    const sug = ideaPool.ideas.find(i => i.id === ideaPoolSuggestId);
    if (sug) {
      const s = document.createElement('div');
      s.className = 'ip-suggest';
      const txt = document.createElement('span');
      txt.innerHTML = '<strong></strong> — ' + t('ideapool.suggest');
      txt.querySelector('strong').textContent = sug.title;
      const yes = document.createElement('button');
      yes.className = 'btn-primary';
      yes.textContent = t('ideapool.focus.set');
      yes.addEventListener('click', () => {
        ideaPool.focusId = sug.id; ideaPoolSuggestId = null; saveIdeaPool(); renderIdeaPool();
      });
      const again = document.createElement('button');
      again.className = 'btn-secondary';
      again.textContent = t('ideapool.pick');
      again.addEventListener('click', ideaPoolPick);
      s.appendChild(txt); s.appendChild(yes); s.appendChild(again);
      page.appendChild(s);
    } else {
      ideaPoolSuggestId = null;
    }
  }

  // ── Toolbar (sort / decide / combine) ──
  const toolbar = document.createElement('div');
  toolbar.className = 'ip-toolbar';

  const sortWrap = document.createElement('label');
  sortWrap.className = 'ip-sort';
  sortWrap.innerHTML = '<span>' + t('ideapool.sort.label') + '</span>';
  const sortSel = document.createElement('select');
  [['created', 'ideapool.sort.created'], ['sweet', 'ideapool.sort.sweet'],
   ['spark', 'ideapool.sort.spark'], ['ready', 'ideapool.sort.ready']].forEach(([v, k]) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = t(k);
    if (ideaPool.sort === v) o.selected = true;
    sortSel.appendChild(o);
  });
  sortSel.addEventListener('change', () => { ideaPool.sort = sortSel.value; saveIdeaPool(); renderIdeaPool(); });
  sortWrap.appendChild(sortSel);
  toolbar.appendChild(sortWrap);

  const spacer = document.createElement('div');
  spacer.className = 'ip-toolbar-spacer';
  toolbar.appendChild(spacer);

  if (ideaPool.ideas.length >= 2) {
    const pickBtn = document.createElement('button');
    pickBtn.className = 'ip-tool-btn';
    pickBtn.textContent = t('ideapool.pick');
    pickBtn.addEventListener('click', ideaPoolPick);
    toolbar.appendChild(pickBtn);

    const combineBtn = document.createElement('button');
    combineBtn.className = 'ip-tool-btn' + (ideaPoolCombine ? ' on' : '');
    combineBtn.textContent = ideaPoolCombine ? t('ideapool.combine.cancel') : t('ideapool.combine');
    combineBtn.addEventListener('click', () => {
      ideaPoolCombine = !ideaPoolCombine;
      ideaPoolSelected.clear();
      renderIdeaPool();
    });
    toolbar.appendChild(combineBtn);
  }
  page.appendChild(toolbar);

  if (ideaPoolCombine) {
    const hint = document.createElement('div');
    hint.className = 'ip-combine-bar';
    const h = document.createElement('span');
    h.textContent = t('ideapool.combine.hint');
    const merge = document.createElement('button');
    merge.className = 'btn-primary';
    merge.textContent = t('ideapool.combine.do');
    merge.disabled = ideaPoolSelected.size < 2;
    merge.addEventListener('click', ideaPoolCombineSelected);
    hint.appendChild(h);
    hint.appendChild(merge);
    page.appendChild(hint);
  }

  // ── Cards ──
  if (!ideaPool.ideas.length) {
    const empty = document.createElement('div');
    empty.className = 'ip-empty';
    empty.textContent = t('ideapool.empty');
    page.appendChild(empty);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'ip-grid';
  ideaPoolSorted().forEach(idea => {
    const isFocus = idea.id === ideaPool.focusId;
    const parked = ideaPool.focusId && !isFocus;
    const card = document.createElement('div');
    card.className = 'ip-card'
      + (isFocus ? ' is-focus' : '')
      + (parked ? ' is-parked' : '')
      + (idea.id === ideaPoolSuggestId ? ' is-suggest' : '')
      + (ideaPoolSelected.has(idea.id) ? ' is-selected' : '');

    if (ideaPoolCombine) {
      card.classList.add('selectable');
      card.addEventListener('click', e => {
        if (e.target.closest('input, textarea, button')) return;
        if (ideaPoolSelected.has(idea.id)) ideaPoolSelected.delete(idea.id);
        else ideaPoolSelected.add(idea.id);
        renderIdeaPool();
      });
    }

    // Title
    const title = document.createElement('input');
    title.className = 'ip-card-title';
    title.value = idea.title;
    title.placeholder = t('ideapool.title.placeholder');
    title.addEventListener('input', () => { idea.title = title.value; saveIdeaPool(); });
    card.appendChild(title);

    // Combined-from badge
    if (idea.combinedFrom && idea.combinedFrom.length) {
      const badge = document.createElement('div');
      badge.className = 'ip-combined';
      badge.textContent = t('ideapool.combined.from') + ' ' + idea.combinedFrom.join(', ');
      card.appendChild(badge);
    }

    // Note
    const note = document.createElement('textarea');
    note.className = 'ip-card-note';
    note.value = idea.note || '';
    note.placeholder = t('ideapool.note.placeholder');
    note.rows = 3;
    note.addEventListener('input', () => { idea.note = note.value; saveIdeaPool(); autoResize(note); });
    card.appendChild(note);

    // Image
    if (idea.image) {
      const imgWrap = document.createElement('div');
      imgWrap.className = 'ip-card-image-wrap';
      const img = document.createElement('img');
      img.className = 'ip-card-image';
      img.src = idea.image;
      img.alt = '';
      const editImg = document.createElement('button');
      editImg.className = 'ip-card-image-edit';
      editImg.title = t('ideapool.image.recrop');
      editImg.textContent = '⤢';
      editImg.addEventListener('click', () => {
        openImageCropModal(idea.image, cropped => {
          idea.image = cropped;
          saveIdeaPool();
          renderIdeaPool();
        });
      });
      const rmImg = document.createElement('button');
      rmImg.className = 'ip-card-image-rm';
      rmImg.title = t('ideapool.image.remove');
      rmImg.textContent = '×';
      rmImg.addEventListener('click', () => { idea.image = ''; saveIdeaPool(); renderIdeaPool(); });
      imgWrap.appendChild(img);
      imgWrap.appendChild(editImg);
      imgWrap.appendChild(rmImg);
      card.appendChild(imgWrap);
    } else {
      const imgBtn = document.createElement('label');
      imgBtn.className = 'ip-card-image-add';
      imgBtn.textContent = t('ideapool.image.add');
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/*';
      fileInput.style.display = 'none';
      fileInput.addEventListener('change', () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          openImageCropModal(reader.result, cropped => {
            idea.image = cropped;
            saveIdeaPool();
            renderIdeaPool();
          });
        };
        reader.readAsDataURL(file);
      });
      imgBtn.appendChild(fileInput);
      card.appendChild(imgBtn);
    }

    // Link
    const link = document.createElement('input');
    link.className = 'ip-card-link';
    link.type = 'url';
    link.value = idea.link || '';
    link.placeholder = t('ideapool.link.placeholder');
    link.addEventListener('input', () => { idea.link = link.value; saveIdeaPool(); });
    card.appendChild(link);
    if (idea.link) {
      const linkOpen = document.createElement('a');
      linkOpen.className = 'ip-card-link-open';
      linkOpen.href = idea.link;
      linkOpen.target = '_blank';
      linkOpen.rel = 'noopener noreferrer';
      linkOpen.textContent = t('ideapool.link.open');
      card.appendChild(linkOpen);
    }

    // Ratings
    const ratings = document.createElement('div');
    ratings.className = 'ip-ratings';
    ratings.appendChild(ideaPoolRatingEl(idea, 'spark', t('ideapool.spark')));
    ratings.appendChild(ideaPoolRatingEl(idea, 'ready', t('ideapool.ready')));
    card.appendChild(ratings);

    // Start-as-project action
    const toProj = document.createElement('button');
    toProj.className = 'ip-card-toproject';
    toProj.textContent = t('ideapool.toproject');
    toProj.addEventListener('click', () => ideaPoolToProjectModal(idea));
    card.appendChild(toProj);

    // Footer actions
    const foot = document.createElement('div');
    foot.className = 'ip-card-foot';
    const focusBtn = document.createElement('button');
    focusBtn.className = 'ip-card-focus' + (isFocus ? ' on' : '');
    focusBtn.textContent = isFocus ? '★ ' + t('ideapool.focus.label') : '☆ ' + t('ideapool.focus.set');
    focusBtn.addEventListener('click', () => {
      ideaPool.focusId = isFocus ? null : idea.id;
      ideaPoolSuggestId = null;
      saveIdeaPool();
      renderIdeaPool();
    });
    const del = document.createElement('button');
    del.className = 'ip-card-del';
    del.title = t('ideapool.delete');
    del.textContent = '×';
    del.addEventListener('click', () => {
      ideaPool.ideas = ideaPool.ideas.filter(i => i.id !== idea.id);
      if (ideaPool.focusId === idea.id) ideaPool.focusId = null;
      if (ideaPoolSuggestId === idea.id) ideaPoolSuggestId = null;
      ideaPoolSelected.delete(idea.id);
      saveIdeaPool();
      renderIdeaPool();
    });
    foot.appendChild(focusBtn);
    foot.appendChild(del);
    card.appendChild(foot);

    if (parked) {
      const parkedNote = document.createElement('div');
      parkedNote.className = 'ip-parked-note';
      parkedNote.textContent = t('ideapool.focus.parked');
      card.appendChild(parkedNote);
    }

    grid.appendChild(card);
  });
  page.appendChild(grid);
  requestAnimationFrame(() => grid.querySelectorAll('textarea').forEach(autoResize));
}

// ══════════════════════════════════
// ── THEME ──
// ══════════════════════════════════
const THEME_QUESTIONS = [
  { key: 'belief',   color: 'amber'  },
  { key: 'question', color: 'violet' },
  { key: 'claim',    color: 'sage'   },
  { key: 'lesson',   color: 'terracotta' },
  { key: 'message',  color: 'blue'   },
  { key: 'motif' },
];

function renderTheme() {
  const page = document.getElementById('page-theme');
  if (!page) return;
  page.innerHTML = `
    <div class="theme-layout">
      <div class="page-header">
        <h1>${t('theme.h1')}</h1>
      </div>
      <div class="theme-section">
        <div class="theme-section-title">${t('theme.statement.title')}</div>
        <textarea class="theme-statement" id="theme-statement" placeholder="${t('theme.statement.placeholder')}" rows="2">${storyTheme.statement || ''}</textarea>
        <div class="theme-statement-hint">${t('theme.statement.hint')}</div>
      </div>
      <div class="theme-section">
        <details class="theme-model" id="theme-model" open>
          <summary class="theme-model-toggle">${t('theme.model.toggle')}</summary>
          ${renderThemeModel()}
        </details>
      </div>
      <div class="theme-section">
        <div class="theme-section-title">${t('theme.deeper.title')}</div>
        <div class="theme-questions" id="theme-questions"></div>
      </div>
    </div>
  `;

  page.querySelector('#theme-statement').addEventListener('input', e => {
    storyTheme.statement = e.target.value;
    saveProjectDebounced();
  });

  const questionsEl = page.querySelector('#theme-questions');
  THEME_QUESTIONS.forEach(q => {
    const item = document.createElement('div');
    item.className = 'theme-question' + (q.color ? ' theme-question--' + q.color : '');
    item.innerHTML = `
      <div class="theme-question-label">${t('theme.q.' + q.key + '.label')}</div>
      <div class="theme-question-hint">${t('theme.q.' + q.key + '.hint')}</div>
      <textarea class="theme-question-area" placeholder="${t('theme.q.' + q.key + '.placeholder')}" rows="2">${storyTheme[q.key] || ''}</textarea>
    `;
    item.querySelector('textarea').addEventListener('input', e => {
      storyTheme[q.key] = e.target.value;
      saveProjectDebounced();
    });
    questionsEl.appendChild(item);
  });

  // Auto-resize all textareas
  requestAnimationFrame(() => page.querySelectorAll('textarea').forEach(autoResize));
}

// Visual model of how the theme pieces relate: Belief → Question → Statement → Lesson → Message.
// Each node echoes the writer's own field content when present, otherwise the generic description.
function renderThemeModel() {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const node = (key, field, color) => {
    const own = (storyTheme[field] || '').trim();
    const body = own ? esc(own) : t('theme.model.' + key + '.sub');
    return `
      <div class="theme-model-node theme-model-node--${color} ${own ? 'is-filled' : ''}">
        <div class="theme-model-node-title">${t('theme.model.' + key + '.title')}</div>
        <div class="theme-model-node-sub">${body}</div>
      </div>`;
  };
  const tagFor = key => {
    const tag = t('theme.model.' + key + '.tag');
    return tag !== 'theme.model.' + key + '.tag' ? tag : '';
  };
  // Belief and Question share the top layer (Belief → Question), then both feed into Statement.
  const row = (inner, tagKey) =>
    `<div class="theme-model-row"><div class="theme-model-cell">${inner}</div>` +
    `<div class="theme-model-tag">${tagFor(tagKey)}</div></div>`;
  const arrow = `<div class="theme-model-arrow">↓</div>`;
  return `<div class="theme-model-flow">
    ${row(`<div class="theme-model-pair">
      ${node('belief', 'belief', 'amber')}
      <div class="theme-model-arrow theme-model-arrow--h">→</div>
      ${node('question', 'question', 'violet')}
    </div>`, 'belief')}
    ${arrow}
    ${row(node('statement', 'claim', 'sage'), 'statement')}
    ${arrow}
    ${row(node('lesson', 'lesson', 'terracotta'), 'lesson')}
    ${arrow}
    ${row(node('message', 'message', 'blue'), 'message')}
  </div>`;
}

function renderWordHistoryChart() {
  const hist = wordHistory.filter(e => e.words > 0);
  if (hist.length < 2) {
    return `<p class="stats-empty">${t('stats.history.empty')}</p>`;
  }

  const W = 760, H = 180;
  const PAD = { top: 12, right: 16, bottom: 36, left: 56 };
  const iW = W - PAD.left - PAD.right;
  const iH = H - PAD.top - PAD.bottom;
  const n = hist.length;
  const maxW = Math.max(1, ...hist.map(e => e.words));
  const minW = Math.min(...hist.map(e => e.words));
  const range = maxW - minW || 1;

  const xOf = i => PAD.left + (i / (n - 1)) * iW;
  const yOf = v => PAD.top + iH - ((v - minW) / range) * iH;

  // polyline path
  const pts = hist.map((e, i) => `${xOf(i).toFixed(1)},${yOf(e.words).toFixed(1)}`).join(' ');
  // filled area
  const areaPts = `${xOf(0).toFixed(1)},${(PAD.top + iH).toFixed(1)} ${pts} ${xOf(n - 1).toFixed(1)},${(PAD.top + iH).toFixed(1)}`;

  // Y axis ticks (3 levels)
  const yTicks = [minW, Math.round((minW + maxW) / 2), maxW].map(v => ({
    y: yOf(v),
    label: v.toLocaleString('de-DE')
  }));

  // X axis labels: first, evenly spaced middles, last — max 5
  const labelCount = Math.min(5, n);
  const labelIndices = n === 1 ? [0] : Array.from({ length: labelCount }, (_, k) => Math.round(k * (n - 1) / (labelCount - 1)));
  const uniqueIndices = [...new Set(labelIndices)];
  const xLabels = uniqueIndices.map(i => {
    const d = new Date(hist[i].date + 'T00:00:00');
    const locale = currentLang === 'de' ? 'de-DE' : 'en-GB';
    return { x: xOf(i), label: d.toLocaleDateString(locale, { day: '2-digit', month: 'short' }) };
  });

  // horizontal grid lines
  const gridLines = yTicks.map(t =>
    `<line x1="${PAD.left}" y1="${t.y.toFixed(1)}" x2="${(PAD.left + iW).toFixed(1)}" y2="${t.y.toFixed(1)}" stroke="var(--border)" stroke-width="1" stroke-dasharray="4 4"/>`
  ).join('');

  // dots with tooltips
  const dots = hist.map((e, i) => {
    const locale = currentLang === 'de' ? 'de-DE' : 'en-GB';
    const d = new Date(e.date + 'T00:00:00');
    const label = d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
    return `<circle cx="${xOf(i).toFixed(1)}" cy="${yOf(e.words).toFixed(1)}" r="3.5" fill="var(--accent)" stroke="var(--bg-card)" stroke-width="1.5"><title>${label}: ${e.words.toLocaleString('de-DE')} ${t('stats.words')}</title></circle>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">
    <defs>
      <linearGradient id="lc-grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.01"/>
      </linearGradient>
    </defs>
    ${gridLines}
    <line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${(PAD.top + iH).toFixed(1)}" stroke="var(--border)" stroke-width="1"/>
    <line x1="${PAD.left}" y1="${(PAD.top + iH).toFixed(1)}" x2="${(PAD.left + iW).toFixed(1)}" y2="${(PAD.top + iH).toFixed(1)}" stroke="var(--border)" stroke-width="1"/>
    <polygon points="${areaPts}" fill="url(#lc-grad)"/>
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    ${yTicks.map(t => `<text x="${(PAD.left - 8).toFixed(1)}" y="${(t.y + 4).toFixed(1)}" text-anchor="end" fill="var(--text-muted)" font-size="11" font-family="Inter,sans-serif">${t.label}</text>`).join('')}
    ${xLabels.map(l => `<text x="${l.x.toFixed(1)}" y="${(PAD.top + iH + 22).toFixed(1)}" text-anchor="middle" fill="var(--text-muted)" font-size="11" font-family="Inter,sans-serif">${l.label}</text>`).join('')}
  </svg>`;
}

function renderStats() {
  const page = document.getElementById('page-stats');
  if (!page) return;

  let totalWords = 0;
  const chapterData = [];
  for (const ch of writing.chapters) {
    const scenes = (ch.scenes || []).map((sc, i) => ({
      title: sc.title || `Szene ${i + 1}`,
      words: countWords(sc.content || '')
    }));
    const chWords = scenes.reduce((s, sc) => s + sc.words, 0);
    totalWords += chWords;
    chapterData.push({ title: ch.title || 'Unbenannt', scenes, words: chWords });
  }
  const totalScenes = chapterData.reduce((s, ch) => s + ch.scenes.length, 0);
  const progress = writingGoal > 0 ? Math.min(100, Math.round((totalWords / writingGoal) * 100)) : 0;
  const maxChWords = Math.max(1, ...chapterData.map(c => c.words));
  const wordsLeft = writingGoal > 0 ? Math.max(0, writingGoal - totalWords) : null;

  page.innerHTML = `
    <div class="page-header"><h1>Stats</h1></div>
    <div class="stats-layout">

      <div class="stats-top">
        <div class="stats-goal-card">
          <div class="stats-goal-header">
            <span class="stats-section-label">${t('stats.goal.label')}</span>
            <div class="stats-goal-input-wrap">
              <button class="stats-goal-btn" id="goal-dec">−</button>
              <input type="number" id="goal-input" class="stats-goal-input"
                value="${writingGoal || ''}" placeholder="—" min="0">
              <button class="stats-goal-btn" id="goal-inc">+</button>
              <span class="stats-goal-unit">${t('stats.words')}</span>
            </div>
          </div>
          <div class="stats-progress-track">
            <div class="stats-progress-fill" style="width:${progress}%"></div>
          </div>
          <div class="stats-progress-labels">
            <span><strong>${totalWords.toLocaleString('de-DE')}</strong> ${t('stats.words')}</span>
            <span>${writingGoal > 0
              ? (progress === 100 ? '🎉 ' + t('stats.goal.reached') : `${progress}% · ${t('stats.goal.remaining').replace('{n}', wordsLeft.toLocaleString('de-DE'))}`)
              : t('stats.goal.none')}</span>
          </div>
        </div>

        <div class="stats-cards">
          <div class="stats-card"><div class="stats-number">${totalWords.toLocaleString('de-DE')}</div><div class="stats-label">${t('stats.words')}</div></div>
          <div class="stats-card"><div class="stats-number">${writing.chapters.length}</div><div class="stats-label">${t('stats.chapters')}</div></div>
          <div class="stats-card"><div class="stats-number">${totalScenes}</div><div class="stats-label">${t('stats.scenes')}</div></div>
          <div class="stats-card"><div class="stats-number">${beats.length}</div><div class="stats-label">Story Beats</div></div>
          <div class="stats-card"><div class="stats-number">${characters.length}</div><div class="stats-label">${t('stats.characters')}</div></div>
          <div class="stats-card"><div class="stats-number">${brainstorm.notes.length}</div><div class="stats-label">${t('nav.notes')}</div></div>
        </div>
      </div>

      <div class="stats-chart-card">
          <div class="stats-section-label" style="margin-bottom:20px">${t('stats.words.per.chapter')}</div>
          ${chapterData.length === 0
            ? `<p class="stats-empty">${t('stats.no.chapters')}</p>`
            : `<div class="stats-chart">
            ${chapterData.map(ch => {
              const barPct = ch.words === 0 ? 0 : Math.max(1, Math.round((ch.words / maxChWords) * 100));
              const segments = ch.scenes.map((sc, i) => {
                const shade = 100 - (i % 5) * 15; // shades of the theme accent: 100,85,70,55,40
                return `<div class="stats-stack-seg" style="flex:${sc.words || 0.01};background:color-mix(in srgb, var(--accent) ${shade}%, var(--bg-card))" title="${ideaEsc(sc.title)}: ${sc.words.toLocaleString('de-DE')} ${t('stats.words')}"></div>`;
              }).join('');
              return `
                <div class="stats-bar-row">
                  <div class="stats-bar-label">${ideaEsc(ch.title)}</div>
                  <div class="stats-bar-track">
                    <div class="stats-stacked-bar" style="width:${barPct}%">${segments}</div>
                  </div>
                  <div class="stats-bar-count">${ch.words.toLocaleString('de-DE')}</div>
                </div>`;
            }).join('')}
          </div>`}
        </div>

      <div class="stats-chart-card">
        <div class="stats-section-label" style="margin-bottom:20px">${t('stats.history.title')}</div>
        ${renderWordHistoryChart()}
      </div>

    </div>
  `;

  document.getElementById('goal-input').addEventListener('change', e => {
    writingGoal = parseInt(e.target.value) || 0;
    saveProjectDebounced();
    renderStats();
  });

  document.getElementById('goal-dec').addEventListener('click', () => {
    writingGoal = Math.max(0, (writingGoal || 0) - 100);
    document.getElementById('goal-input').value = writingGoal || '';
    saveProject();
    renderStats();
  });

  document.getElementById('goal-inc').addEventListener('click', () => {
    writingGoal = (writingGoal || 0) + 100;
    document.getElementById('goal-input').value = writingGoal || '';
    saveProject();
    renderStats();
  });
}

document.querySelectorAll('.icon-nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchPage(btn.dataset.page));
});

switchPage('home');
applyI18n();

document.getElementById('lang-toggle').addEventListener('click', () => setLang(currentLang === 'en' ? 'de' : 'en'));

// Logo click → home
document.querySelector('.topbar-brand').addEventListener('click', () => switchPage('home'));

// Home page CTA buttons delegate to the existing topbar handlers
document.getElementById('home-btn-new').addEventListener('click', () => document.getElementById('btn-new-project').click());
document.getElementById('home-btn-import').addEventListener('click', () => document.getElementById('btn-import-project').click());

// ── Global light / dark theme ──
function applyTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  localStorage.setItem('inktink-theme', dark ? 'dark' : 'light');
  const btn = document.getElementById('theme-switch');
  if (btn) {
    btn.textContent = dark ? '☀' : '☾';
    btn.title = dark ? 'Switch to light' : 'Switch to dark';
  }
}
applyTheme(localStorage.getItem('inktink-theme') || 'light');
document.getElementById('theme-switch').addEventListener('click', () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  applyTheme(isDark ? 'light' : 'dark');
});

// ── Modal ──
const modalOverlay = document.getElementById('modal-overlay');
const modalBody = document.getElementById('modal-body');

function openModal(content) {
  modalBody.innerHTML = '';
  if (typeof content === 'string') modalBody.innerHTML = content;
  else modalBody.appendChild(content);
  modalOverlay.classList.add('open');
}

function closeModal() {
  modalOverlay.classList.remove('open');
}

document.getElementById('modal-close').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });

// ══════════════════════════════════
// ── STORY BEATS ──
// ══════════════════════════════════
const beatsList = document.getElementById('beats-list');

// A beat can point at the scene that drafts it (beat.sceneId). The scene keeps
// no back-reference: deleting either side leaves the other untouched, and a
// dangling sceneId is cleared lazily when the beat card renders.
function beatSceneTitle(beat) {
  if (beat.structBeat && selectedStructure)
    return ts(selectedStructure, 'beat.' + beat.structBeat + '.name', beat.structBeat);
  const txt = (beat.text || '').trim().replace(/\s+/g, ' ');
  if (!txt) return t('writing.untitled.scene');
  return txt.length <= 40 ? txt : txt.slice(0, 40).replace(/\s+\S*$/, '') + '…';
}

function beatWriteScene(beat) {
  let ch = writing.chapters[writing.chapters.length - 1];
  if (!ch) {
    ch = { id: Date.now(), title: t('beats.write.newchapter'), collapsed: false, scenes: [] };
    writing.chapters.push(ch);
  }
  ch.scenes = ch.scenes || [];
  const scene = { id: Date.now(), title: beatSceneTitle(beat), content: '', status: 'draft', summary: (beat.text || '').trim() };
  ch.scenes.push(scene);
  ch.collapsed = false;
  beat.sceneId = scene.id;
  saveProject();
  switchPage('writing');
  renderChapterTree();
  selectScene(ch.id, scene.id);
}

function createBeatCard(beat, i) {
  const card = document.createElement('div');
  card.className = 'beat-card';
  card.dataset.index = i;

  let linked = beat.sceneId != null ? findSceneAnywhere(beat.sceneId) : {};
  if (beat.sceneId != null && !linked.scene) { beat.sceneId = undefined; linked = {}; } // scene was deleted

  card.innerHTML = `
    <div class="beat-handle" title="${t('beat.drag.title')}">&#8942;&#8942;</div>
    <div class="beat-content">
      <textarea class="beat-text" rows="1" placeholder="${t('beats.placeholder')}">${ideaEsc(beat.text)}</textarea>
      <textarea class="beat-theme" rows="1" placeholder="${t('beats.theme.placeholder')}">${ideaEsc(beat.theme)}</textarea>
      <div class="beat-scene-row">${linked.scene
        ? `<button class="beat-drafted-chip" title="${t('beats.drafted.jump')}">&#10003; ${t('beats.drafted').replace('{n}', countWords(linked.scene.content || ''))}</button>`
        : `<button class="btn-mini beat-write-btn">&#9998; ${t('beats.write.scene')}</button>`}</div>
    </div>
    <button class="beat-delete" title="${t('beat.delete.title')}">&times;</button>
  `;

  const writeBtn = card.querySelector('.beat-write-btn');
  if (writeBtn) writeBtn.addEventListener('click', () => beatWriteScene(beat));
  const draftedChip = card.querySelector('.beat-drafted-chip');
  if (draftedChip) draftedChip.addEventListener('click', () => {
    switchPage('writing');
    selectScene(linked.chapter.id, linked.scene.id);
  });

  card.querySelector('.beat-delete').addEventListener('click', () => {
    beats.splice(i, 1);
    saveProject();
    renderBeats();
  });

  const handle = card.querySelector('.beat-handle');
  handle.addEventListener('mousedown', () => { card.draggable = true; });
  handle.addEventListener('mouseup', () => { card.draggable = false; });

  card.addEventListener('dragstart', e => {
    if (!card.draggable) { e.preventDefault(); return; }
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', i.toString());
  });
  card.addEventListener('dragend', () => card.classList.remove('dragging'));
  card.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); card.classList.add('drag-over'); });
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
  card.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation();
    card.classList.remove('drag-over');
    const from = parseInt(e.dataTransfer.getData('text/plain'));
    if (from === i) return;
    const [moved] = beats.splice(from, 1);
    const targetIdx = from < i ? i - 1 : i;
    if (selectedStructure && beats[targetIdx]) {
      moved.structBeat = beats[targetIdx].structBeat;
      moved.phase = beats[targetIdx].phase;
    }
    beats.splice(targetIdx, 0, moved);
    saveProject();
    renderBeats();
  });

  const textarea = card.querySelector('.beat-text');
  requestAnimationFrame(() => autoResize(textarea));
  textarea.addEventListener('input', () => {
    beats[i].text = textarea.value;
    saveProjectDebounced();
    autoResize(textarea);
  });

  const themeArea = card.querySelector('.beat-theme');
  requestAnimationFrame(() => autoResize(themeArea));
  themeArea.addEventListener('input', () => {
    beats[i].theme = themeArea.value;
    saveProjectDebounced();
    autoResize(themeArea);
  });

  return card;
}

function syncBeatsToStructure(structKey) {
  const struct = STRUCTURES[structKey];
  const validPhaseIds = new Set(struct.phases.map(p => p.id));
  // Migrate old-format beats (name field = structured slot) to new format (structBeat field)
  beats = beats
    .map(b => {
      if (b.structBeat) return b;
      if (b.name) return { id: b.id, text: b.text || '', structBeat: b.name, phase: b.phase };
      return b;
    })
    .filter(b => !b.phase || validPhaseIds.has(b.phase));
}

function renderBeats() {
  beatsList.innerHTML = '';
  const struct = selectedStructure ? STRUCTURES[selectedStructure] : null;
  const addBeatBtn = document.getElementById('add-beat');

  // Coverage counter: how much of the outline has a drafted scene behind it.
  const cov = document.getElementById('beats-coverage');
  if (cov) {
    const drafted = beats.filter(b => b.sceneId != null && findSceneAnywhere(b.sceneId).scene).length;
    cov.textContent = (selectedStructure && beats.length)
      ? t('beats.coverage').replace('{n}', drafted).replace('{m}', beats.length) : '';
  }

  if (!struct) {
    if (addBeatBtn) addBeatBtn.style.display = '';
    if (beats.length === 0) {
      beatsList.innerHTML = `<div class="empty-state">${t('beats.empty').replace('\n', '<br>')}</div>`;
      return;
    }
    beats.forEach((beat, i) => beatsList.appendChild(createBeatCard(beat, i)));
    return;
  }

  if (addBeatBtn) addBeatBtn.style.display = 'none';

  struct.phases.forEach((phase, phaseIdx) => {
    const phaseColor = BS2_COLORS[phaseIdx % BS2_COLORS.length].main;
    const phaseStructBeats = struct.beats.filter(b => b.phase === phase.id);
    const directMode = phaseStructBeats.length === 0;

    // Act header — in directMode, include beat count + add button right on the header
    const actHeader = document.createElement('div');
    actHeader.className = 'phase-header';
    actHeader.style.setProperty('--phase-color', phaseColor);
    if (directMode) {
      const directBeats = beats.filter(b => b.phase === phase.id);
      actHeader.innerHTML = `
        <div class="phase-header-top">
          <div class="phase-header-left">
            <div class="phase-label">${ts(selectedStructure, 'phase.' + phase.id + '.label', phase.label)}</div>
            <span class="phase-count">${directBeats.length} Beat${directBeats.length !== 1 ? 's' : ''}</span>
          </div>
          <button class="phase-add-btn">${t('beats.add.slot')}</button>
        </div>
        <div class="phase-desc">${ts(selectedStructure, 'phase.' + phase.id + '.desc', phase.desc)}</div>
      `;
      actHeader.querySelector('.phase-add-btn').addEventListener('click', () => {
        beats.push({ id: Date.now() + Math.random(), text: '', phase: phase.id });
        saveProject();
        renderBeats();
        requestAnimationFrame(() => {
          const sec = beatsList.querySelector(`.beat-section[data-phase="${phase.id}"]`);
          const cards = sec?.querySelectorAll('.beat-card');
          if (cards?.length) cards[cards.length - 1].querySelector('.beat-text').focus();
        });
      });
    } else {
      actHeader.innerHTML = `
        <div class="phase-label">${ts(selectedStructure, 'phase.' + phase.id + '.label', phase.label)}</div>
        <div class="phase-desc">${ts(selectedStructure, 'phase.' + phase.id + '.desc', phase.desc)}</div>
      `;
    }
    beatsList.appendChild(actHeader);

    if (directMode) {
      // Phase beats go directly here, no sub-headers
      const directBeats = beats.filter(b => b.phase === phase.id);
      const section = document.createElement('div');
      section.className = 'beat-section';
      section.dataset.phase = phase.id;

      if (directBeats.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'phase-empty';
        empty.textContent = t('beats.slot.empty');
        section.appendChild(empty);
      } else {
        directBeats.forEach(beat => section.appendChild(createBeatCard(beat, beats.indexOf(beat))));
      }

      section.addEventListener('dragover', e => { e.preventDefault(); section.classList.add('drag-over-phase'); });
      section.addEventListener('dragleave', e => { if (!section.contains(e.relatedTarget)) section.classList.remove('drag-over-phase'); });
      section.addEventListener('drop', e => {
        e.preventDefault();
        section.classList.remove('drag-over-phase');
        const from = parseInt(e.dataTransfer.getData('text/plain'));
        if (isNaN(from) || from < 0 || from >= beats.length) return;
        beats[from].structBeat = undefined;
        beats[from].phase = phase.id;
        saveProject();
        renderBeats();
      });

      beatsList.appendChild(section);
    } else {
      // Key story point sub-headers + user beats beneath each
      phaseStructBeats.forEach(structBeat => {
        const userBeats = beats.filter(b => b.structBeat === structBeat.name && b.phase === phase.id);

        const subHeader = document.createElement('div');
        subHeader.className = 'beat-header';
        subHeader.style.setProperty('--phase-color', phaseColor);
        subHeader.innerHTML = `
          <div class="beat-header-top">
            <div class="beat-header-left">
              <span class="beat-header-name">${ts(selectedStructure, 'beat.' + structBeat.name + '.name', structBeat.name)}</span>
              <span class="beat-header-count">${userBeats.length} Beat${userBeats.length !== 1 ? 's' : ''}</span>
            </div>
            <button class="phase-add-btn">${t('beats.add.slot')}</button>
          </div>
          <div class="beat-header-desc">${ts(selectedStructure, 'beat.' + structBeat.name + '.desc', structBeat.desc)}</div>
        `;
        subHeader.querySelector('.phase-add-btn').addEventListener('click', () => {
          beats.push({ id: Date.now() + Math.random(), text: '', structBeat: structBeat.name, phase: phase.id });
          saveProject();
          renderBeats();
          requestAnimationFrame(() => {
            const sec = beatsList.querySelector(`.beat-section[data-struct-beat="${structBeat.name}"]`);
            const last = sec?.querySelectorAll('.beat-card');
            if (last?.length) last[last.length - 1].querySelector('.beat-text').focus();
          });
        });
        beatsList.appendChild(subHeader);

        const section = document.createElement('div');
        section.className = 'beat-section';
        section.dataset.structBeat = structBeat.name;
        section.dataset.phase = phase.id;

        if (userBeats.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'phase-empty';
          empty.textContent = t('beats.slot.empty');
          section.appendChild(empty);
        } else {
          userBeats.forEach(beat => section.appendChild(createBeatCard(beat, beats.indexOf(beat))));
        }

        section.addEventListener('dragover', e => { e.preventDefault(); section.classList.add('drag-over-phase'); });
        section.addEventListener('dragleave', e => { if (!section.contains(e.relatedTarget)) section.classList.remove('drag-over-phase'); });
        section.addEventListener('drop', e => {
          e.preventDefault();
          section.classList.remove('drag-over-phase');
          const from = parseInt(e.dataTransfer.getData('text/plain'));
          if (isNaN(from) || from < 0 || from >= beats.length) return;
          beats[from].structBeat = structBeat.name;
          beats[from].phase = phase.id;
          saveProject();
          renderBeats();
        });

        beatsList.appendChild(section);
      });
    }
  });
}

function autoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = textarea.scrollHeight + 'px';
}

document.getElementById('add-beat').addEventListener('click', () => {
  beats.push({ id: Date.now(), text: '' });
  saveProject();
  renderBeats();
  const cards = beatsList.querySelectorAll('.beat-card');
  const last = cards[cards.length - 1];
  if (last) last.querySelector('.beat-text').focus();
});

const structureSelect = document.getElementById('structure-select');

structureSelect.addEventListener('change', () => {
  selectedStructure = structureSelect.value || null;
  if (selectedStructure) syncBeatsToStructure(selectedStructure);
  saveProject();
  renderBeats();
});

// ══════════════════════════════════
// ── CHARACTERS ──
// ══════════════════════════════════
const charsGrid = document.getElementById('characters-grid');

function renderCharacters() {
  charsGrid.innerHTML = '';
  if (characters.length === 0) {
    charsGrid.innerHTML = `<div class="empty-state">${t('characters.empty').replace('\n', '<br>')}</div>`;
    return;
  }
  let charDragFrom = null;

  characters.forEach((char, i) => {
    const card = document.createElement('div');
    card.className = 'char-card';
    card.draggable = true;

    const fileId = 'char-file-' + i;
    card.innerHTML = `
      <div class="char-drag-handle">&#8942;&#8942;&#8942;</div>
      <div class="char-image-wrap" data-index="${i}">
        ${char.image
          ? `<img src="${char.image}" alt="${ideaEsc(char.name || t('char.name.placeholder'))}" draggable="false" style="object-position:${char.imagePosition ? char.imagePosition.x + '% ' + char.imagePosition.y + '%' : '50% 50%'}">
             <div class="char-img-hint">${t('char.img.drag')}</div>`
          : `<div class="char-image-placeholder"><span>&#128247;</span>${t('char.add.image')}</div>`
        }
      </div>
      <input type="file" accept="image/*" class="hidden-input" id="${fileId}">
      <div class="char-body">
        <input class="char-name" type="text" placeholder="${t('char.name.placeholder')}" value="${ideaEsc(char.name)}">
        <textarea class="char-desc" placeholder="${t('char.desc.placeholder')}">${ideaEsc(char.description)}</textarea>
        <button class="char-delete">${t('char.delete')}</button>
      </div>
    `;

    card.addEventListener('dragstart', e => {
      charDragFrom = i;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => card.classList.add('dragging'), 0);
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      charsGrid.querySelectorAll('.char-card').forEach(c => c.classList.remove('drag-over'));
    });
    card.addEventListener('dragover', e => { e.preventDefault(); card.classList.add('drag-over'); });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('drag-over');
      if (charDragFrom === null || charDragFrom === i) return;
      const [moved] = characters.splice(charDragFrom, 1);
      characters.splice(i, 0, moved);
      charDragFrom = null;
      saveProject();
      renderCharacters();
    });

    const fileInput = card.querySelector(`#${fileId}`);
    const imgWrap = card.querySelector('.char-image-wrap');
    const img = imgWrap.querySelector('img');

    if (img) {
      let dragActive = false;
      let startX, startY, startPosX, startPosY;

      img.addEventListener('mousedown', e => {
        e.preventDefault();
        dragActive = false;
        startX = e.clientX;
        startY = e.clientY;
        const pos = characters[i].imagePosition || { x: 50, y: 50 };
        startPosX = pos.x;
        startPosY = pos.y;
        img.classList.add('dragging');

        function onMove(e) {
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragActive = true;
          if (!dragActive) return;
          // 1px mouse movement ≈ 0.1% position shift (tuned for 200px tall frame)
          const x = Math.max(0, Math.min(100, startPosX - dx * 0.1));
          const y = Math.max(0, Math.min(100, startPosY - dy * 0.1));
          img.style.objectPosition = `${x}% ${y}%`;
          characters[i].imagePosition = { x, y };
        }

        function onUp() {
          img.classList.remove('dragging');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          if (dragActive) saveProject();
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      imgWrap.addEventListener('click', e => {
        if (dragActive) { dragActive = false; return; }
        fileInput.click();
      });
    } else {
      imgWrap.addEventListener('click', () => fileInput.click());
    }

    fileInput.addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const result = await uploadImage(file);
      if (characters[i].image) {
        const oldFile = characters[i].image.split('/').pop();
        deleteImage(oldFile);
      }
      characters[i].image = result.path;
      await saveProject();
      renderCharacters();
    });

    card.querySelector('.char-name').addEventListener('input', e => {
      characters[i].name = e.target.value;
      saveProject();
    });

    card.querySelector('.char-desc').addEventListener('input', e => {
      characters[i].description = e.target.value;
      saveProject();
    });

    card.querySelector('.char-delete').addEventListener('click', async () => {
      if (characters[i].image) {
        const oldFile = characters[i].image.split('/').pop();
        await deleteImage(oldFile);
      }
      characters.splice(i, 1);
      await saveProject();
      renderCharacters();
    });

    charsGrid.appendChild(card);
  });
}

document.getElementById('add-character').addEventListener('click', () => {
  characters.push({ id: Date.now(), name: '', description: '', image: null });
  saveProject();
  renderCharacters();
  const cards = charsGrid.querySelectorAll('.char-card');
  const last = cards[cards.length - 1];
  if (last) last.querySelector('.char-name').focus();
});

// ══════════════════════════════════
// ── MOODBOARD ──
// ══════════════════════════════════
const moodGrid = document.getElementById('moodboard-grid');
const moodFileInput = document.createElement('input');
moodFileInput.type = 'file';
moodFileInput.accept = 'image/*';
moodFileInput.multiple = true;
moodFileInput.className = 'hidden-input';
document.body.appendChild(moodFileInput);

function renderMoodboard() {
  moodGrid.innerHTML = '';
  if (moodImages.length === 0) {
    moodGrid.innerHTML = `<div class="empty-state">${t('moodboard.empty').replace('\n', '<br>')}</div>`;
    return;
  }

  let moodDragFrom = null;

  moodImages.forEach((img, i) => {
    const card = document.createElement('div');
    card.className = 'mood-card';
    card.draggable = true;
    card.innerHTML = `
      <img src="${img.src}" alt="Mood image" draggable="false">
      <div class="mood-body">
        <textarea class="mood-comment" placeholder="${t('mood.comment.placeholder')}" rows="1">${img.comment || ''}</textarea>
        <button class="mood-delete" title="${t('beat.delete.title')}">&times;</button>
      </div>
    `;

    card.addEventListener('dragstart', e => {
      moodDragFrom = i;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => card.classList.add('dragging'), 0);
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      moodGrid.querySelectorAll('.mood-card').forEach(c => c.classList.remove('drag-over'));
    });
    card.addEventListener('dragover', e => { e.preventDefault(); card.classList.add('drag-over'); });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('drag-over');
      if (moodDragFrom === null || moodDragFrom === i) return;
      const [moved] = moodImages.splice(moodDragFrom, 1);
      moodImages.splice(i, 0, moved);
      moodDragFrom = null;
      saveProject();
      renderMoodboard();
    });

    const commentEl = card.querySelector('.mood-comment');
    autoResize(commentEl);
    commentEl.addEventListener('input', () => {
      moodImages[i].comment = commentEl.value;
      saveProject();
      autoResize(commentEl);
    });

    card.querySelector('.mood-delete').addEventListener('click', async () => {
      const oldFile = moodImages[i].src.split('/').pop();
      await deleteImage(oldFile);
      moodImages.splice(i, 1);
      await saveProject();
      renderMoodboard();
    });

    moodGrid.appendChild(card);
  });
}

document.getElementById('add-mood-image').addEventListener('click', () => moodFileInput.click());

moodFileInput.addEventListener('change', async e => {
  const files = Array.from(e.target.files);
  for (const file of files) {
    const result = await uploadImage(file);
    moodImages.push({ id: Date.now(), src: result.path, comment: '' });
  }
  await saveProject();
  renderMoodboard();
  moodFileInput.value = '';
});

// ══════════════════════════════════
// ── WRITING (Chapters & Scenes) ──
// ══════════════════════════════════
const chapterTree = document.getElementById('chapter-tree');
const editorPane = document.getElementById('editor-pane');

function saveProjectDebounced() {
  isDirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveProject, 350);
}

// Closing the tab mid-debounce would lose the last keystrokes, so flush the
// pending save first (localStorage is synchronous). The "unsaved changes"
// dialog only appears if that save actually failed.
function flushPendingSave() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (typeof flushEditor === 'function') flushEditor(); // pull live editor DOM into state
  if (isDirty) saveProject();
}
window.addEventListener('pagehide', flushPendingSave);
window.addEventListener('beforeunload', e => {
  flushPendingSave();
  if (isDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

function findScene(chId, scId) {
  const ch = writing.chapters.find(c => c.id === chId);
  if (!ch) return {};
  const sc = (ch.scenes || []).find(s => s.id === scId);
  return { chapter: ch, scene: sc };
}

// Locate a scene by id alone (beats store only the scene id, not the chapter).
function findSceneAnywhere(scId) {
  for (const ch of writing.chapters) {
    const sc = (ch.scenes || []).find(s => s.id === scId);
    if (sc) return { chapter: ch, scene: sc };
  }
  return {};
}

// Scenes from before this feature have no status field — they count as drafts.
const SCENE_STATUSES = ['draft', 'revised', 'done'];
function sceneStatus(sc) {
  return SCENE_STATUSES.includes(sc && sc.status) ? sc.status : 'draft';
}

// Read the live editor DOM back into state (call before switching scenes)
function flushEditor() {
  const ms = document.getElementById('manuscript');
  if (ms && activeChapterId && activeSceneId) {
    const { scene } = findScene(activeChapterId, activeSceneId);
    if (scene) scene.content = ms.innerHTML;
  }
}

let dragKind = null;

function renderChapterTree() {
  chapterTree.innerHTML = '';
  if (!writing.chapters.length) {
    chapterTree.innerHTML = `<div class="empty-state" style="padding:30px 12px;font-size:13px">${t('writing.empty.chapters').replace('\n', '<br>')}</div>`;
    return;
  }

  writing.chapters.forEach((ch, ci) => {
    const block = document.createElement('div');
    block.className = 'chapter-block';
    block.dataset.chapter = ch.id;

    const collapsed = !!ch.collapsed;
    block.innerHTML = `
      <div class="chapter-row">
        <span class="chapter-drag" draggable="true" title="${t('writing.drag.chapter')}" style="cursor:grab;color:var(--text-muted);font-size:13px">&#8942;&#8942;</span>
        <button class="chapter-toggle" title="${t('writing.collapse')}">${collapsed ? '&#9656;' : '&#9662;'}</button>
        <input class="chapter-title" value="${ideaEsc(ch.title)}" placeholder="${t('writing.chapter.placeholder')}">
        <div class="chapter-actions">
          <button class="tree-icon-btn del" title="${t('writing.delete.chapter')}">&times;</button>
        </div>
      </div>
    `;

    // Toggle collapse
    block.querySelector('.chapter-toggle').addEventListener('click', () => {
      ch.collapsed = !ch.collapsed;
      saveProject();
      renderChapterTree();
    });

    // Rename chapter
    block.querySelector('.chapter-title').addEventListener('input', e => {
      ch.title = e.target.value;
      saveProjectDebounced();
    });

    // Delete chapter
    block.querySelector('.tree-icon-btn.del').addEventListener('click', () => {
      if (!confirm(t('writing.confirm.delete.chapter').replace('{title}', ch.title || t('writing.untitled')))) return;
      const idx = writing.chapters.findIndex(c => c.id === ch.id);
      writing.chapters.splice(idx, 1);
      if (activeChapterId === ch.id) { activeChapterId = null; activeSceneId = null; }
      saveProject();
      renderChapterTree();
      renderEditor();
    });

    // Chapter drag (handle)
    const handle = block.querySelector('.chapter-drag');
    handle.addEventListener('dragstart', e => {
      dragKind = 'chapter';
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'chapter:' + ch.id);
    });
    handle.addEventListener('dragend', () => { dragKind = null; });
    block.addEventListener('dragover', e => {
      if (dragKind !== 'chapter') return;
      e.preventDefault();
      block.classList.add('drag-over');
    });
    block.addEventListener('dragleave', () => block.classList.remove('drag-over'));
    block.addEventListener('drop', e => {
      if (dragKind !== 'chapter') return;
      e.preventDefault();
      block.classList.remove('drag-over');
      const fromId = e.dataTransfer.getData('text/plain').split(':')[1];
      const from = writing.chapters.findIndex(c => String(c.id) === fromId);
      const to = ci;
      if (from === -1 || from === to) return;
      const [moved] = writing.chapters.splice(from, 1);
      writing.chapters.splice(to, 0, moved);
      saveProject();
      renderChapterTree();
    });

    // Scenes
    if (!collapsed) {
      const list = document.createElement('ul');
      list.className = 'scene-list';
      (ch.scenes || []).forEach((sc, si) => {
        const li = document.createElement('li');
        li.className = 'scene-item' + (sc.id === activeSceneId ? ' active' : '');
        li.dataset.scene = sc.id;
        li.innerHTML = `
          <span class="scene-drag" draggable="true" title="${t('writing.drag.scene')}">&#8942;&#8942;</span>
          <span class="scene-status-dot status-${sceneStatus(sc)}"></span>
          <input class="scene-name-input" value="${ideaEsc(sc.title)}" placeholder="${t('writing.scene.placeholder')}">
          <button class="scene-del" title="${t('writing.delete.scene')}">&times;</button>
        `;
        if (sc.summary) li.title = sc.summary;

        // Select scene (and focus the manuscript) when clicking empty row area
        li.addEventListener('click', e => {
          if (e.target.closest('.scene-del') || e.target.closest('.scene-name-input') || e.target.closest('.scene-drag')) return;
          selectScene(ch.id, sc.id);
        });

        // Rename scene inline; selecting on focus (without stealing focus to the editor)
        const nameInput = li.querySelector('.scene-name-input');
        nameInput.addEventListener('focus', () => setActiveScene(ch.id, sc.id, false));
        nameInput.addEventListener('input', () => {
          sc.title = nameInput.value;
          const headerInput = document.getElementById('scene-title-input');
          if (headerInput && activeSceneId === sc.id) headerInput.value = nameInput.value;
          saveProjectDebounced();
        });

        li.querySelector('.scene-del').addEventListener('click', e => {
          e.stopPropagation();
          const idx = ch.scenes.findIndex(s => s.id === sc.id);
          ch.scenes.splice(idx, 1);
          if (activeSceneId === sc.id) { activeChapterId = null; activeSceneId = null; }
          saveProject();
          renderChapterTree();
          renderEditor();
        });

        // Scene drag (reorder within chapter) — via handle
        const sceneHandle = li.querySelector('.scene-drag');
        sceneHandle.style.cursor = 'grab';
        sceneHandle.style.color = 'var(--text-muted)';
        sceneHandle.style.fontSize = '12px';
        sceneHandle.style.flexShrink = '0';
        sceneHandle.addEventListener('dragstart', e => {
          dragKind = 'scene';
          e.stopPropagation();
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', 'scene:' + ch.id + ':' + sc.id);
        });
        sceneHandle.addEventListener('dragend', () => { dragKind = null; });
        li.addEventListener('dragover', e => {
          if (dragKind !== 'scene') return;
          e.preventDefault();
          e.stopPropagation();
          li.classList.add('drag-over');
        });
        li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
        li.addEventListener('drop', e => {
          if (dragKind !== 'scene') return;
          e.preventDefault();
          e.stopPropagation();
          li.classList.remove('drag-over');
          const parts = e.dataTransfer.getData('text/plain').split(':');
          const fromChId = parts[1], fromScId = parts[2];
          if (String(ch.id) !== fromChId) return; // only within same chapter
          const from = ch.scenes.findIndex(s => String(s.id) === fromScId);
          const to = si;
          if (from === -1 || from === to) return;
          const [moved] = ch.scenes.splice(from, 1);
          ch.scenes.splice(to, 0, moved);
          saveProject();
          renderChapterTree();
        });

        list.appendChild(li);
      });

      const addBtn = document.createElement('button');
      addBtn.className = 'add-scene-btn';
      addBtn.innerHTML = t('writing.add.scene');
      addBtn.addEventListener('click', () => {
        const scene = { id: Date.now(), title: t('writing.untitled.scene'), content: '', status: 'draft', summary: '' };
        ch.scenes = ch.scenes || [];
        ch.scenes.push(scene);
        saveProject();
        renderChapterTree();
        setActiveScene(ch.id, scene.id, false);
        const ni = chapterTree.querySelector(`.scene-item[data-scene="${scene.id}"] .scene-name-input`);
        if (ni) { ni.focus(); ni.select(); }
      });
      list.appendChild(addBtn);
      block.appendChild(list);
    }

    chapterTree.appendChild(block);
  });
}

// Switch active scene by toggling classes only (keeps tree DOM + focus intact)
function setActiveScene(chId, scId, focusEditor) {
  if (activeChapterId === chId && activeSceneId === scId) return;
  flushEditor();
  activeChapterId = chId;
  activeSceneId = scId;
  chapterTree.querySelectorAll('.scene-item').forEach(el => {
    el.classList.toggle('active', el.dataset.scene === String(scId));
  });
  renderEditor();
  if (focusEditor) {
    const ms = document.getElementById('manuscript');
    if (ms) ms.focus();
  }
}

function selectScene(chId, scId) {
  setActiveScene(chId, scId, true);
}

function countWords(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('.inline-note').forEach(n => n.remove());
  const text = tmp.textContent.trim();
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function renderEditor() {
  if (!activeChapterId || !activeSceneId) {
    editorPane.innerHTML = `<div class="empty-state" style="margin:auto"><span>&#9998;</span>${t('writing.empty.scene').replace('\n', '<br>')}</div>`;
    return;
  }
  const { scene } = findScene(activeChapterId, activeSceneId);
  if (!scene) {
    editorPane.innerHTML = `<div class="empty-state" style="margin:auto">${t('writing.empty.scene.short')}</div>`;
    return;
  }

  const st = sceneStatus(scene);
  editorPane.innerHTML = `
    <div class="editor-header">
      <input class="scene-title-input" id="scene-title-input" value="${(scene.title || '').replace(/"/g, '&quot;')}" placeholder="${t('writing.scene.title.placeholder')}">
      <button class="scene-status-chip status-${st}" id="scene-status-chip" title="${t('writing.status.cycle')}">${t('writing.status.' + st)}</button>
      <button class="editor-theme-btn" id="theme-toggle" title="${t('editor.theme.toggle')}">&#9790;</button>
      <button class="icon-btn" id="search-toggle" title="${t('editor.search')}">&#128269;</button>
    </div>
    <div class="editor-summary-row">
      <input class="scene-summary-input" id="scene-summary-input" placeholder="${t('writing.summary.placeholder')}" value="${ideaEsc(scene.summary)}">
    </div>
    <div class="format-toolbar">
      <button class="fmt-btn" data-cmd="bold" title="${t('editor.fmt.bold')}"><b>B</b></button>
      <button class="fmt-btn" data-cmd="italic" title="${t('editor.fmt.italic')}"><i>I</i></button>
      <button class="fmt-btn" data-cmd="underline" title="${t('editor.fmt.underline')}"><u>U</u></button>
      <span class="fmt-divider"></span>
      <select class="fmt-select" id="block-format" title="${t('editor.fmt.block')}">
        <option value="P">${t('editor.fmt.normal')}</option>
        <option value="H1">${t('editor.fmt.h1')}</option>
        <option value="H2">${t('editor.fmt.h2')}</option>
        <option value="H3">${t('editor.fmt.h3')}</option>
      </select>
      <span class="fmt-divider"></span>
      <button class="btn-mini" id="insert-note">&#128221; ${t('editor.insert.note')}</button>
      <span class="editor-spacer"></span>
      <span class="word-count" id="word-count"></span>
    </div>
    <div class="search-bar" id="search-bar" hidden>
      <span class="search-icon">&#128269;</span>
      <input class="search-input" id="search-input" placeholder="${t('writing.search.placeholder')}">
      <button class="icon-btn" id="search-close" title="${t('editor.close')}">&times;</button>
      <div class="search-results" id="search-results"></div>
    </div>
    <div class="manuscript" id="manuscript" contenteditable="true" data-placeholder="${t('editor.manuscript.placeholder')}"></div>
  `;

  const titleInput = editorPane.querySelector('#scene-title-input');
  const manuscript = editorPane.querySelector('#manuscript');
  const wordCount = editorPane.querySelector('#word-count');

  manuscript.innerHTML = scene.content || '';
  wordCount.textContent = countWords(manuscript.innerHTML) + ' ' + t('stats.words');

  function persist() {
    scene.content = manuscript.innerHTML;
    wordCount.textContent = countWords(manuscript.innerHTML) + ' ' + t('stats.words');
    saveProjectDebounced();
  }

  // Status chip cycles draft → revised → done; the tree dot is patched in place
  // (a full renderChapterTree would steal focus, same as the title sync below).
  const statusChip = editorPane.querySelector('#scene-status-chip');
  statusChip.addEventListener('click', () => {
    const next = SCENE_STATUSES[(SCENE_STATUSES.indexOf(sceneStatus(scene)) + 1) % SCENE_STATUSES.length];
    scene.status = next;
    statusChip.className = 'scene-status-chip status-' + next;
    statusChip.textContent = t('writing.status.' + next);
    const treeDot = chapterTree.querySelector(`.scene-item[data-scene="${scene.id}"] .scene-status-dot`);
    if (treeDot) treeDot.className = 'scene-status-dot status-' + next;
    saveProject();
  });

  const summaryInput = editorPane.querySelector('#scene-summary-input');
  summaryInput.addEventListener('input', () => {
    scene.summary = summaryInput.value;
    const treeItem = chapterTree.querySelector(`.scene-item[data-scene="${scene.id}"]`);
    if (treeItem) treeItem.title = scene.summary;
    saveProjectDebounced();
  });

  titleInput.addEventListener('input', () => {
    scene.title = titleInput.value;
    // sync the inline name in the tree without rebuilding focus
    const treeInput = chapterTree.querySelector(`.scene-item[data-scene="${scene.id}"] .scene-name-input`);
    if (treeInput && treeInput.value !== titleInput.value) treeInput.value = titleInput.value;
    saveProjectDebounced();
  });

  manuscript.addEventListener('input', persist);

  // ── Formatting toolbar (bold / italic / underline) ──
  editorPane.querySelectorAll('.fmt-btn').forEach(btn => {
    // mousedown preventDefault keeps the manuscript selection while clicking the button
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => {
      manuscript.focus();
      document.execCommand(btn.dataset.cmd, false, null);
      persist();
    });
  });

  // ── Paragraph format (Normal / H1 / H2 / H3) ──
  const blockSelect = editorPane.querySelector('#block-format');

  function syncBlockFormat() {
    let v = '';
    try { v = (document.queryCommandValue('formatBlock') || '').toLowerCase(); } catch (e) {}
    blockSelect.value = (v === 'h1' || v === 'h2' || v === 'h3') ? v.toUpperCase() : 'P';
  }

  blockSelect.addEventListener('change', () => {
    manuscript.focus();
    document.execCommand('formatBlock', false, blockSelect.value);
    persist();
    syncBlockFormat();
  });

  // keep the dropdown showing the format at the cursor position
  ['keyup', 'mouseup'].forEach(ev => manuscript.addEventListener(ev, syncBlockFormat));

  // Click on existing note chip → edit
  manuscript.addEventListener('click', e => {
    const chip = e.target.closest('.inline-note');
    if (chip) openNotePopover(chip);
  });

  editorPane.querySelector('#insert-note').addEventListener('click', () => insertNoteAtCursor(manuscript));

  // ── Light / Dark editor toggle ──
  const themeToggleBtn = editorPane.querySelector('#theme-toggle');
  const isDarkEditor = () => editorPane.classList.contains('editor-dark');
  if (isDarkEditor()) themeToggleBtn.textContent = '☀️';
  themeToggleBtn.addEventListener('click', () => {
    editorPane.classList.toggle('editor-dark');
    themeToggleBtn.textContent = isDarkEditor() ? '☀️' : '🌙';
  });

  // ── Search across all scenes ──
  const searchBar = editorPane.querySelector('#search-bar');
  const searchInput = editorPane.querySelector('#search-input');
  const searchResults = editorPane.querySelector('#search-results');

  editorPane.querySelector('#search-toggle').addEventListener('click', () => {
    searchBar.hidden = !searchBar.hidden;
    if (!searchBar.hidden) searchInput.focus();
  });
  editorPane.querySelector('#search-close').addEventListener('click', () => {
    searchBar.hidden = true;
    searchResults.innerHTML = '';
    searchInput.value = '';
  });
  searchInput.addEventListener('input', () => runSceneSearch(searchInput.value, searchResults));
}

function plainTextOf(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  tmp.querySelectorAll('.inline-note').forEach(n => n.remove());
  return tmp.textContent || '';
}

function runSceneSearch(term, container) {
  const t = term.trim().toLowerCase();
  container.innerHTML = '';
  if (!t) return;

  const hits = [];
  writing.chapters.forEach(ch => {
    (ch.scenes || []).forEach(sc => {
      const text = plainTextOf(sc.content);
      const lowText = text.toLowerCase();
      const inTitle = (sc.title || '').toLowerCase().includes(t);
      const idx = lowText.indexOf(t);
      if (inTitle || idx >= 0) {
        let snippet = '';
        if (idx >= 0) {
          const start = Math.max(0, idx - 30);
          snippet = (start > 0 ? '…' : '') +
            text.substring(start, idx) +
            '【' + text.substr(idx, term.length) + '】' +
            text.substring(idx + term.length, idx + term.length + 30) + '…';
        }
        hits.push({ chId: ch.id, scId: sc.id, chTitle: ch.title || 'Kapitel', scTitle: sc.title || 'Szene', snippet });
      }
    });
  });

  if (!hits.length) {
    container.innerHTML = `<div class="search-noresult">${t('writing.search.noresult')}</div>`;
    return;
  }

  hits.forEach(h => {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.innerHTML = `
      <div class="search-result-loc">${ideaEsc(h.chTitle)} &rsaquo; ${ideaEsc(h.scTitle)}</div>
      ${h.snippet ? `<div class="search-result-snippet">${ideaEsc(h.snippet).replace('【', '<mark>').replace('】', '</mark>')}</div>` : ''}
    `;
    item.addEventListener('click', () => {
      selectScene(h.chId, h.scId);
      // best-effort: highlight the term in the freshly opened scene
      setTimeout(() => { try { window.getSelection().removeAllRanges(); window.find(term); } catch (e) {} }, 50);
    });
    container.appendChild(item);
  });
}

// ── Inline notes ──
const notePopover = document.getElementById('note-popover');
const notePopoverText = document.getElementById('note-popover-text');
let currentNoteChip = null;

function makeChip(noteText) {
  const chip = document.createElement('span');
  chip.className = 'inline-note';
  chip.contentEditable = 'false';
  chip.textContent = '\u{1F4DD}';
  chip.dataset.note = noteText || '';
  if (noteText) chip.title = noteText;
  return chip;
}

function insertNoteAtCursor(manuscript) {
  manuscript.focus();
  const sel = window.getSelection();
  const chip = makeChip('');
  if (sel && sel.rangeCount && manuscript.contains(sel.anchorNode)) {
    const range = sel.getRangeAt(0);
    range.collapse(false);
    range.insertNode(chip);
    // caret after chip
    const after = document.createTextNode(' ');
    chip.after(after);
    range.setStartAfter(after);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else {
    manuscript.appendChild(chip);
  }
  // persist
  const { scene } = findScene(activeChapterId, activeSceneId);
  if (scene) scene.content = manuscript.innerHTML;
  saveProjectDebounced();
  openNotePopover(chip);
}

function openNotePopover(chip) {
  currentNoteChip = chip;
  notePopoverText.value = chip.dataset.note || '';
  const rect = chip.getBoundingClientRect();
  notePopover.classList.add('open');
  // position: below the chip, clamped to viewport
  let left = rect.left;
  let top = rect.bottom + 6;
  const pw = 260, ph = 140;
  if (left + pw > window.innerWidth - 10) left = window.innerWidth - pw - 10;
  if (top + ph > window.innerHeight - 10) top = rect.top - ph - 6;
  notePopover.style.left = Math.max(10, left) + 'px';
  notePopover.style.top = Math.max(10, top) + 'px';
  notePopoverText.focus();
}

function closeNotePopover() {
  notePopover.classList.remove('open');
  currentNoteChip = null;
}

notePopoverText.addEventListener('input', () => {
  if (!currentNoteChip) return;
  currentNoteChip.dataset.note = notePopoverText.value;
  currentNoteChip.title = notePopoverText.value;
  const ms = document.getElementById('manuscript');
  const { scene } = findScene(activeChapterId, activeSceneId);
  if (ms && scene) scene.content = ms.innerHTML;
  saveProjectDebounced();
});

document.getElementById('note-popover-done').addEventListener('click', closeNotePopover);

document.getElementById('note-popover-delete').addEventListener('click', () => {
  if (currentNoteChip) {
    currentNoteChip.remove();
    const ms = document.getElementById('manuscript');
    const { scene } = findScene(activeChapterId, activeSceneId);
    if (ms && scene) {
      scene.content = ms.innerHTML;
      const wc = document.getElementById('word-count');
      if (wc) wc.textContent = countWords(ms.innerHTML) + ' ' + t('stats.words');
    }
    saveProjectDebounced();
  }
  closeNotePopover();
});

// Close popover when clicking outside it (and not on a chip)
document.addEventListener('mousedown', e => {
  if (!notePopover.classList.contains('open')) return;
  if (notePopover.contains(e.target)) return;
  if (e.target.closest('.inline-note')) return;
  closeNotePopover();
});

// Add chapter
document.getElementById('add-chapter').addEventListener('click', () => {
  flushEditor();
  const chapter = { id: Date.now(), title: 'Neues Kapitel', collapsed: false, scenes: [] };
  writing.chapters.push(chapter);
  saveProject();
  renderChapterTree();
  // focus the new chapter title
  const input = chapterTree.querySelector(`.chapter-block[data-chapter="${chapter.id}"] .chapter-title`);
  if (input) { input.focus(); input.select(); }
});

// ══════════════════════════════════
// ── BRAINSTORMING (free canvas) ──
// ══════════════════════════════════
const bsCanvas = document.getElementById('bs-canvas');
const bsCanvasWrap = document.getElementById('bs-canvas-wrap');
const bsLinks = document.getElementById('bs-links');
const bsHint = document.getElementById('bs-hint');
const SVGNS = 'http://www.w3.org/2000/svg';
const BS_PALETTE = ['#c8a2ff', '#ffd479', '#7ee0a0', '#7ec8ff', '#ff9eb1'];

let linkingFrom = null;
const noteEls = {}; // id -> element

function setBsHint(text) {
  bsHint.textContent = text || '';
}

const BS_NOTE_W = 210; // matches .bs-note width in CSS
const BS_NOTE_MIN_W = 140;
const BS_NOTE_MAX_W = 520;
const BS_PAD    = 80;  // padding beyond the furthest note

function expandCanvas() {
  const wrapW = bsCanvasWrap.clientWidth;
  const wrapH = bsCanvasWrap.clientHeight;
  let maxX = wrapW, maxY = wrapH;
  brainstorm.notes.forEach(n => {
    const el = noteEls[n.id];
    const h = el ? el.offsetHeight : 100;
    const w = el ? el.offsetWidth : BS_NOTE_W;
    maxX = Math.max(maxX, (n.x || 0) + w + BS_PAD);
    maxY = Math.max(maxY, (n.y || 0) + h + BS_PAD);
  });
  bsCanvas.style.width  = maxX + 'px';
  bsCanvas.style.height = maxY + 'px';
  bsLinks.setAttribute('width',  maxX);
  bsLinks.setAttribute('height', maxY);
}

function renderBrainstorm() {
  // remove existing note elements (keep the svg)
  bsCanvas.querySelectorAll('.bs-note, .bs-empty').forEach(n => n.remove());
  for (const k in noteEls) delete noteEls[k];

  if (!brainstorm.notes.length) {
    const empty = document.createElement('div');
    empty.className = 'bs-empty';
    empty.innerHTML = t('notes.empty').replace(/\n/g, '<br>');
    bsCanvas.appendChild(empty);
  }

  brainstorm.notes.forEach(note => bsCanvas.appendChild(createNoteEl(note)));
  drawLinks();
  requestAnimationFrame(expandCanvas);
}

function createNoteEl(note) {
  const el = document.createElement('div');
  el.className = 'bs-note';
  el.dataset.id = note.id;
  el.style.left = (note.x || 0) + 'px';
  el.style.top = (note.y || 0) + 'px';
  el.style.setProperty('--note', note.color || BS_PALETTE[0]);
  applyNoteScale(el, note);

  el.innerHTML = `
    <div class="bs-note-header">
      <button class="bs-note-swatch" title="${t('timeline.change.color')}"></button>
      <div class="bs-note-spacer"></div>
      <label class="bs-note-btn img" title="${t('notes.btn.image')}">&#128247;<input type="file" accept="image/*" class="bs-note-img-input" style="display:none"></label>
      <button class="bs-note-btn hyperlink" title="${t('notes.btn.hyperlink')}">&#127760;</button>
      <button class="bs-note-btn link" title="${t('notes.btn.link')}">&#128279;</button>
      <button class="bs-note-btn del" title="${t('notes.btn.delete')}">&times;</button>
    </div>
    <div class="bs-note-img-wrap"></div>
    <textarea class="bs-note-text" placeholder="${t('notes.note.placeholder')}">${ideaEsc(note.text)}</textarea>
    <div class="bs-note-links"></div>
    <div class="bs-note-resize" title="${t('notes.btn.resize')}"></div>
  `;

  const textarea = el.querySelector('.bs-note-text');
  requestAnimationFrame(() => autoResize(textarea));
  textarea.addEventListener('input', () => {
    note.text = textarea.value;
    autoResize(textarea);
    drawLinks();
    saveProjectDebounced();
  });

  // Image: render existing, and wire the header picker
  const imgWrap = el.querySelector('.bs-note-img-wrap');
  function renderNoteImage() {
    imgWrap.innerHTML = '';
    if (!note.image) return;
    const img = document.createElement('img');
    img.className = 'bs-note-img';
    img.src = note.image;
    img.alt = '';
    const rm = document.createElement('button');
    rm.className = 'bs-note-img-rm';
    rm.title = t('notes.image.remove');
    rm.textContent = '×';
    rm.addEventListener('click', e => {
      e.stopPropagation();
      note.image = '';
      renderNoteImage();
      drawLinks();
      saveProject();
    });
    imgWrap.appendChild(img);
    imgWrap.appendChild(rm);
  }
  renderNoteImage();

  const imgInput = el.querySelector('.bs-note-img-input');
  imgInput.addEventListener('click', e => e.stopPropagation());
  imgInput.addEventListener('change', () => {
    const file = imgInput.files && imgInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      note.image = reader.result;
      renderNoteImage();
      drawLinks();
      saveProject();
    };
    reader.readAsDataURL(file);
    imgInput.value = '';
  });

  // Hyperlinks: attach one or more clickable links to the note
  const linksWrap = el.querySelector('.bs-note-links');
  if (!Array.isArray(note.hyperlinks)) note.hyperlinks = [];
  const editingLinks = new WeakSet();

  function renderNoteLinks() {
    linksWrap.innerHTML = '';
    note.hyperlinks.forEach(lk => {
      const row = document.createElement('div');
      row.className = 'bs-note-link';
      if (editingLinks.has(lk)) {
        const label = document.createElement('input');
        label.type = 'text';
        label.className = 'bs-note-link-input label';
        label.placeholder = t('notes.hyperlink.label');
        label.value = lk.label || '';
        const url = document.createElement('input');
        url.type = 'url';
        url.className = 'bs-note-link-input url';
        url.placeholder = t('notes.hyperlink.url');
        url.value = lk.url || '';
        const done = document.createElement('button');
        done.className = 'bs-note-link-done';
        done.textContent = '✓';
        done.title = t('notes.hyperlink.done');
        const commit = () => {
          lk.url = normalizeUrl(url.value.trim());
          lk.label = label.value.trim();
          if (!lk.url) note.hyperlinks = note.hyperlinks.filter(x => x !== lk);
          editingLinks.delete(lk);
          renderNoteLinks();
          drawLinks();
          expandCanvas();
          saveProject();
        };
        const cancel = () => {
          if (!lk.url) note.hyperlinks = note.hyperlinks.filter(x => x !== lk);
          editingLinks.delete(lk);
          renderNoteLinks();
          drawLinks();
          expandCanvas();
        };
        [label, url].forEach(inp => {
          inp.addEventListener('click', e => e.stopPropagation());
          inp.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
          });
        });
        done.addEventListener('click', e => { e.stopPropagation(); commit(); });
        row.appendChild(label);
        row.appendChild(url);
        row.appendChild(done);
      } else {
        const a = document.createElement('a');
        a.className = 'bs-note-link-a';
        a.href = lk.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = lk.label || lk.url;
        a.title = lk.url;
        a.addEventListener('click', e => e.stopPropagation());
        const edit = document.createElement('button');
        edit.className = 'bs-note-link-edit';
        edit.textContent = '✎';
        edit.title = t('notes.hyperlink.edit');
        edit.addEventListener('click', e => {
          e.stopPropagation();
          editingLinks.add(lk);
          renderNoteLinks();
        });
        const rm = document.createElement('button');
        rm.className = 'bs-note-link-rm';
        rm.textContent = '×';
        rm.title = t('notes.hyperlink.remove');
        rm.addEventListener('click', e => {
          e.stopPropagation();
          note.hyperlinks = note.hyperlinks.filter(x => x !== lk);
          renderNoteLinks();
          drawLinks();
          expandCanvas();
          saveProject();
        });
        row.appendChild(a);
        row.appendChild(edit);
        row.appendChild(rm);
      }
      linksWrap.appendChild(row);
    });
  }
  renderNoteLinks();

  el.querySelector('.bs-note-btn.hyperlink').addEventListener('click', e => {
    e.stopPropagation();
    const lk = { url: '', label: '' };
    note.hyperlinks.push(lk);
    editingLinks.add(lk);
    renderNoteLinks();
    const urlInput = linksWrap.querySelector('.bs-note-link:last-child .bs-note-link-input.url');
    if (urlInput) urlInput.focus();
    drawLinks();
    expandCanvas();
  });

  // Color cycle
  el.querySelector('.bs-note-swatch').addEventListener('click', () => {
    const idx = BS_PALETTE.indexOf(note.color);
    note.color = BS_PALETTE[(idx + 1) % BS_PALETTE.length];
    el.style.setProperty('--note', note.color);
    saveProjectDebounced();
  });

  // Delete note (and its links)
  el.querySelector('.bs-note-btn.del').addEventListener('click', () => {
    brainstorm.notes = brainstorm.notes.filter(n => n.id !== note.id);
    brainstorm.links = brainstorm.links.filter(l => l.from !== note.id && l.to !== note.id);
    if (linkingFrom === note.id) cancelLinking();
    saveProject();
    renderBrainstorm();
  });

  // Start linking
  el.querySelector('.bs-note-btn.link').addEventListener('click', e => {
    e.stopPropagation();
    if (linkingFrom === note.id) { cancelLinking(); return; }
    linkingFrom = note.id;
    bsCanvas.classList.add('linking');
    document.querySelectorAll('.bs-note').forEach(n => {
      n.classList.toggle('linking-from', n.dataset.id == note.id);
      if (n.dataset.id != note.id) n.classList.add('link-target');
    });
    setBsHint('Klicke eine andere Notiz, um sie zu verbinden (Esc zum Abbrechen)');
  });

  // Complete linking when clicking a target note
  el.addEventListener('click', () => {
    if (linkingFrom && linkingFrom !== note.id) {
      addLink(linkingFrom, note.id);
      cancelLinking();
    }
  });

  // Drag via header
  const header = el.querySelector('.bs-note-header');
  header.addEventListener('mousedown', e => {
    if (e.target.closest('.bs-note-btn') || e.target.closest('.bs-note-swatch')) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const origX = note.x || 0, origY = note.y || 0;
    el.style.zIndex = 10;

    function move(ev) {
      note.x = Math.max(0, origX + (ev.clientX - startX));
      note.y = Math.max(0, origY + (ev.clientY - startY));
      el.style.left = note.x + 'px';
      el.style.top = note.y + 'px';
      drawLinks();
      expandCanvas();
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      el.style.zIndex = '';
      saveProjectDebounced();
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  // Resize / scale via bottom-right handle
  el.querySelector('.bs-note-resize').addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const origW = note.w || BS_NOTE_W;
    el.style.zIndex = 10;

    function move(ev) {
      const w = Math.round(clamp(origW + (ev.clientX - startX), BS_NOTE_MIN_W, BS_NOTE_MAX_W));
      note.w = w;
      applyNoteScale(el, note);
      autoResize(textarea);
      drawLinks();
      expandCanvas();
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      el.style.zIndex = '';
      saveProjectDebounced();
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  noteEls[note.id] = el;
  return el;
}

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

// Adds a scheme when the user typed a bare domain, leaving mailto:/other
// schemes and already-qualified URLs untouched. Empty input stays empty.
function normalizeUrl(url) {
  if (!url) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return url;
  return 'https://' + url;
}

// Applies a note's stored width and scales its text/handles proportionally,
// so widening a note enlarges the whole card (a genuine "scale").
function applyNoteScale(el, note) {
  const w = note.w || BS_NOTE_W;
  el.style.width = w + 'px';
  el.style.setProperty('--note-scale', (w / BS_NOTE_W).toFixed(3));
}

function addLink(fromId, toId) {
  const exists = brainstorm.links.some(l =>
    (l.from === fromId && l.to === toId) || (l.from === toId && l.to === fromId));
  if (exists) return;
  brainstorm.links.push({ id: Date.now(), from: fromId, to: toId });
  saveProject();
  drawLinks();
}

function cancelLinking() {
  linkingFrom = null;
  bsCanvas.classList.remove('linking');
  document.querySelectorAll('.bs-note').forEach(n => n.classList.remove('linking-from', 'link-target'));
  setBsHint('');
}

function noteCenter(id) {
  const el = noteEls[id];
  if (!el) return null;
  return {
    x: el.offsetLeft + el.offsetWidth / 2,
    y: el.offsetTop + el.offsetHeight / 2
  };
}

function drawLinks() {
  // clear all line groups
  bsLinks.innerHTML = '';
  brainstorm.links.forEach(link => {
    const a = noteCenter(link.from);
    const b = noteCenter(link.to);
    if (!a || !b) return;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;

    const line = document.createElementNS(SVGNS, 'line');
    line.setAttribute('class', 'bs-link-line');
    line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
    line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);

    const hit = document.createElementNS(SVGNS, 'line');
    hit.setAttribute('class', 'bs-link-hit');
    hit.setAttribute('x1', a.x); hit.setAttribute('y1', a.y);
    hit.setAttribute('x2', b.x); hit.setAttribute('y2', b.y);
    hit.addEventListener('click', () => openLinkEditor(link, mx, my));

    bsLinks.appendChild(line);
    bsLinks.appendChild(hit);

    if (link.label) {
      const label = document.createElementNS(SVGNS, 'text');
      label.setAttribute('class', 'bs-link-label');
      label.setAttribute('x', mx);
      label.setAttribute('y', my);
      label.textContent = link.label;
      label.addEventListener('click', () => openLinkEditor(link, mx, my));
      bsLinks.appendChild(label);
    }
  });
}

// Inline editor for a connection: rename its label or delete the line.
function openLinkEditor(link, x, y) {
  closeLinkEditor();
  const box = document.createElement('div');
  box.className = 'bs-link-editor';
  box.id = 'bs-link-editor';
  box.style.left = x + 'px';
  box.style.top = y + 'px';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'bs-link-editor-input';
  input.placeholder = t('notes.link.label.placeholder');
  input.value = link.label || '';

  const del = document.createElement('button');
  del.className = 'bs-link-editor-del';
  del.title = t('notes.link.delete');
  del.innerHTML = '&times;';
  del.addEventListener('click', () => {
    brainstorm.links = brainstorm.links.filter(l => l.id !== link.id);
    closeLinkEditor();
    saveProject();
    drawLinks();
  });

  input.addEventListener('input', () => {
    link.label = input.value;
    saveProjectDebounced();
    drawLinks();
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); closeLinkEditor(); saveProject(); }
  });

  box.appendChild(input);
  box.appendChild(del);
  bsCanvas.appendChild(box);
  input.focus();
  input.select();
}

function closeLinkEditor() {
  const existing = document.getElementById('bs-link-editor');
  if (existing) existing.remove();
}

// Dismiss the link editor when clicking elsewhere on the canvas.
bsCanvas.addEventListener('mousedown', e => {
  if (!e.target.closest('.bs-link-editor') && !e.target.closest('.bs-link-hit') && !e.target.closest('.bs-link-label')) {
    closeLinkEditor();
  }
});

// Add note
document.getElementById('add-note-bs').addEventListener('click', () => {
  const note = {
    id: Date.now(),
    x: bsCanvasWrap.scrollLeft + 40 + Math.floor(Math.random() * 120),
    y: bsCanvasWrap.scrollTop  + 40 + Math.floor(Math.random() * 80),
    text: '',
    color: BS_PALETTE[brainstorm.notes.length % BS_PALETTE.length]
  };
  brainstorm.notes.push(note);
  saveProject();
  const empty = bsCanvas.querySelector('.bs-empty');
  if (empty) empty.remove();
  const el = createNoteEl(note);
  bsCanvas.appendChild(el);
  el.querySelector('.bs-note-text').focus();
  requestAnimationFrame(expandCanvas);
});

// Cancel linking on empty-canvas click or Esc
bsCanvas.addEventListener('click', e => {
  if (linkingFrom && (e.target === bsCanvas || e.target === bsLinks)) cancelLinking();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && linkingFrom) cancelLinking();
});

// ══════════════════════════════════
// ── TIMELINE (story strands) ──
// ══════════════════════════════════
const tlGrid = document.getElementById('tl-grid');
const tlWrap = document.getElementById('tl-wrap');
const TL_PALETTE = ['#c8a2ff', '#ffd479', '#7ee0a0', '#7ec8ff', '#ff9eb1'];

function renderTimeline() {
  tlGrid.innerHTML = '';
  const cols = timeline.columns;
  const ncols = cols.length;

  tlGrid.style.gridTemplateColumns = `160px repeat(${ncols}, 190px) 70px`;

  // ── Header row ──
  const corner = document.createElement('div');
  corner.className = 'tl-corner tl-colhead';
  tlGrid.appendChild(corner);

  cols.forEach(col => {
    const head = document.createElement('div');
    head.className = 'tl-colhead';
    head.innerHTML = `
      <button class="tl-col-del" title="${t('timeline.delete.col')}">&times;</button>
      <input class="tl-colhead-input" value="${(col.title || '').replace(/"/g, '&quot;')}" placeholder="${t('timeline.col.placeholder')}">
    `;
    head.querySelector('.tl-colhead-input').addEventListener('input', e => {
      col.title = e.target.value;
      saveProjectDebounced();
    });
    head.querySelector('.tl-col-del').addEventListener('click', () => {
      timeline.columns = timeline.columns.filter(c => c.id !== col.id);
      timeline.rows.forEach(r => { delete r.cells[col.id]; });
      saveProject();
      renderTimeline();
    });
    tlGrid.appendChild(head);
  });

  // add-column button (header, last cell)
  const addColCell = document.createElement('div');
  addColCell.className = 'tl-addcol';
  addColCell.innerHTML = `<button class="tl-add-btn" title="${t('timeline.add.col')}">+</button>`;
  addColCell.querySelector('.tl-add-btn').addEventListener('click', addColumn);
  tlGrid.appendChild(addColCell);

  // ── Strand rows ──
  let tlDragId = null;

  timeline.rows.forEach(row => {
    if (!row.cells) row.cells = {};

    const label = document.createElement('div');
    label.className = 'tl-rowlabel';
    label.draggable = true;
    label.dataset.rowId = row.id;
    label.innerHTML = `
      <span class="tl-row-handle" title="Drag to reorder">⠿</span>
      <button class="tl-row-swatch" title="${t('timeline.change.color')}"></button>
      <input class="tl-rowlabel-input" value="${(row.title || '').replace(/"/g, '&quot;')}" placeholder="${t('timeline.row.placeholder')}">
      <button class="tl-row-del" title="${t('timeline.delete.row')}">&times;</button>
    `;
    label.style.setProperty('--row', row.color || TL_PALETTE[0]);

    label.addEventListener('dragstart', e => {
      tlDragId = row.id;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => label.classList.add('tl-row-dragging'), 0);
    });
    label.addEventListener('dragend', () => {
      tlDragId = null;
      label.classList.remove('tl-row-dragging');
      document.querySelectorAll('.tl-rowlabel').forEach(el => el.classList.remove('tl-row-drag-over'));
    });
    label.addEventListener('dragover', e => {
      if (tlDragId == null || tlDragId === row.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      document.querySelectorAll('.tl-rowlabel').forEach(el => el.classList.remove('tl-row-drag-over'));
      label.classList.add('tl-row-drag-over');
    });
    label.addEventListener('dragleave', () => {
      label.classList.remove('tl-row-drag-over');
    });
    label.addEventListener('drop', e => {
      e.preventDefault();
      label.classList.remove('tl-row-drag-over');
      if (tlDragId == null || tlDragId === row.id) return;
      const fromIdx = timeline.rows.findIndex(r => r.id === tlDragId);
      const toIdx   = timeline.rows.findIndex(r => r.id === row.id);
      if (fromIdx === -1 || toIdx === -1) return;
      const [moved] = timeline.rows.splice(fromIdx, 1);
      timeline.rows.splice(toIdx, 0, moved);
      saveProject();
      renderTimeline();
    });

    label.querySelector('.tl-rowlabel-input').addEventListener('input', e => {
      row.title = e.target.value;
      saveProjectDebounced();
    });
    label.querySelector('.tl-row-swatch').addEventListener('click', () => {
      const idx = TL_PALETTE.indexOf(row.color);
      row.color = TL_PALETTE[(idx + 1) % TL_PALETTE.length];
      saveProject();
      renderTimeline();
    });
    label.querySelector('.tl-row-del').addEventListener('click', () => {
      timeline.rows = timeline.rows.filter(r => r.id !== row.id);
      saveProject();
      renderTimeline();
    });
    tlGrid.appendChild(label);

    cols.forEach(col => {
      const cell = document.createElement('div');
      cell.className = 'tl-cell';
      cell.style.setProperty('--row', row.color || TL_PALETTE[0]);
      const hasCard = Object.prototype.hasOwnProperty.call(row.cells, col.id);

      if (hasCard) {
        const card = document.createElement('div');
        card.className = 'tl-card';
        card.innerHTML = `
          <button class="tl-card-del" title="${t('timeline.delete.card')}">&times;</button>
          <textarea class="tl-card-text" placeholder="${t('timeline.card.placeholder')}">${ideaEsc(row.cells[col.id])}</textarea>
        `;
        const ta = card.querySelector('.tl-card-text');
        requestAnimationFrame(() => autoResize(ta));
        ta.addEventListener('input', () => {
          row.cells[col.id] = ta.value;
          autoResize(ta);
          saveProjectDebounced();
        });
        card.querySelector('.tl-card-del').addEventListener('click', () => {
          delete row.cells[col.id];
          saveProject();
          renderTimeline();
        });
        cell.appendChild(card);
      } else {
        cell.classList.add('empty');
        cell.addEventListener('click', () => {
          row.cells[col.id] = '';
          saveProject();
          renderTimeline();
          const newCell = tlGrid.querySelector(`.tl-cell[data-row="${row.id}"][data-col="${col.id}"] .tl-card-text`);
          if (newCell) newCell.focus();
        });
      }
      cell.dataset.row = row.id;
      cell.dataset.col = col.id;
      tlGrid.appendChild(cell);
    });

    // filler under the add-column track
    const filler = document.createElement('div');
    tlGrid.appendChild(filler);
  });

  // ── Footer: add-row ──
  const addRowCell = document.createElement('div');
  addRowCell.className = 'tl-addrow';
  addRowCell.innerHTML = `<button class="tl-add-btn" title="${t('timeline.add.row')}">+</button>`;
  addRowCell.querySelector('.tl-add-btn').addEventListener('click', addRow);
  tlGrid.appendChild(addRowCell);

  // empty-state hint
  if (ncols === 0 && timeline.rows.length === 0) {
    const hint = document.createElement('div');
    hint.style.cssText = 'grid-column:1 / -1; padding:40px 20px; text-align:center; color:var(--text-muted); font-size:14px; line-height:1.7;';
    hint.innerHTML = t('timeline.hint').replace(/\n/g, '<br>').replace(/\+/g, '<strong>+</strong>');
    tlGrid.appendChild(hint);
  }
}

function addColumn() {
  timeline.columns.push({ id: Date.now(), title: t('timeline.col.placeholder') + ' ' + (timeline.columns.length + 1) });
  saveProject();
  renderTimeline();
}

function addRow() {
  timeline.rows.push({
    id: Date.now(),
    title: t('timeline.new.row'),
    color: TL_PALETTE[timeline.rows.length % TL_PALETTE.length],
    cells: {}
  });
  saveProject();
  renderTimeline();
  const inputs = tlGrid.querySelectorAll('.tl-rowlabel-input');
  const last = inputs[inputs.length - 1];
  if (last) { last.focus(); last.select(); }
}

// ══════════════════════════════════
// ── PROJECT SAVE / LOAD ──
// ══════════════════════════════════
const projectTitle = document.getElementById('proj-title');
const blurbInput = document.getElementById('project-blurb');

blurbInput.addEventListener('input', () => {
  projectBlurb = blurbInput.value;
  saveProject();
});

function updateProjectLabel() {
  const el = document.getElementById('proj-title');
  if (el) el.textContent = currentProjectName || t('project.untitled');
}

// The sidebar title doubles as the project name: editing it renames the saved
// project (or creates it, if this workspace was never named) and the export
// filename follows along automatically, since exportProjectToFile() already
// uses currentProjectName.
function commitProjectTitle(rawName) {
  const fallback = t('project.untitled');
  let newName = (rawName || '').trim() || fallback;
  const prevName = currentProjectName || fallback;
  if (newName === prevName) { updateProjectLabel(); return; }

  const store = readProjectsStore();
  if (currentProjectName && store[currentProjectName]) {
    const finalName = uniqueProjectName(newName, currentProjectName);
    store[finalName] = store[currentProjectName];
    store[finalName].modified = new Date().toISOString();
    if (finalName !== currentProjectName) delete store[currentProjectName];
    writeProjectsStore(store);
    setCurrentProjectName(finalName);
    updateProjectLabel();
  } else {
    const finalName = uniqueProjectName(newName);
    saveProjectAs(finalName); // also adopts the name + persists the pointer
    updateProjectLabel();
  }
}

// Scene content is stored as editor HTML and rendered with innerHTML, so
// anything arriving from an imported .json must be scrubbed of script vectors
// first. A <template> parses without executing anything.
function sanitizeHtml(html) {
  if (typeof html !== 'string' || !html) return '';
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  tpl.content.querySelectorAll('script, style, iframe, object, embed, link, meta, base, form').forEach(el => el.remove());
  tpl.content.querySelectorAll('*').forEach(el => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc') { el.removeAttribute(attr.name); continue; }
      if (name === 'href' || name === 'src' || name === 'xlink:href') {
        const value = attr.value.replace(/\s+/g, '').toLowerCase();
        if (value.startsWith('javascript:') || value.startsWith('vbscript:')) el.removeAttribute(attr.name);
      }
    }
  });
  return tpl.innerHTML;
}

function applyProjectData(data) {
  beats = data.beats || [];
  characters = data.characters || [];
  moodImages = data.moodboard || [];
  projectBlurb = data.blurb || '';
  blurbInput.value = projectBlurb;
  writing = data.writing && Array.isArray(data.writing.chapters) ? data.writing : { chapters: [] };
  writing.chapters = writing.chapters
    .filter(ch => ch && typeof ch === 'object')
    .map(ch => ({
      ...ch,
      scenes: (Array.isArray(ch.scenes) ? ch.scenes : [])
        .filter(sc => sc && typeof sc === 'object')
        .map(sc => ({ ...sc, content: sanitizeHtml(sc.content) })),
    }));
  // Select first available scene, if any
  activeChapterId = null;
  activeSceneId = null;
  for (const ch of writing.chapters) {
    if (ch.scenes && ch.scenes.length) {
      activeChapterId = ch.id;
      activeSceneId = ch.scenes[0].id;
      break;
    }
  }
  brainstorm = data.brainstorm && Array.isArray(data.brainstorm.notes)
    ? { notes: data.brainstorm.notes, links: data.brainstorm.links || [] }
    : { notes: [], links: [] };
  timeline = data.timeline && Array.isArray(data.timeline.rows)
    ? { columns: data.timeline.columns || [], rows: data.timeline.rows }
    : { columns: [], rows: [] };
  inspiration = Array.isArray(data.inspiration) ? data.inspiration : [];
  todos = Array.isArray(data.todos) ? data.todos : [];
  writingGoal = data.writingGoal || 0;
  wordHistory = Array.isArray(data.wordHistory) ? data.wordHistory : [];
  selectedStructure = data.selectedStructure || null;
  if (selectedStructure && STRUCTURES[selectedStructure]) syncBeatsToStructure(selectedStructure);
  worldbuilding = data.worldbuilding && Array.isArray(data.worldbuilding.entries)
    ? { entries: data.worldbuilding.entries, customCategories: data.worldbuilding.customCategories || [], hiddenBuiltins: data.worldbuilding.hiddenBuiltins || [] }
    : { entries: [], customCategories: [], hiddenBuiltins: [] };
  wbFilter = 'Alle';
  ideaMap = data.ideaMap && Array.isArray(data.ideaMap.nodes) ? data.ideaMap : { nodes: [] };
  ideaWorkshops = {
    develop: ideaWorkshopFromData((data.ideaWorkshops || {}).develop || data.ideaDevelop, 'develop'),
    char: ideaWorkshopFromData((data.ideaWorkshops || {}).char, 'char'),
  };
  storyTheme = data.storyTheme && typeof data.storyTheme === 'object'
    ? { statement: '', question: '', claim: '', lesson: '', belief: '', motif: '', message: '', ...data.storyTheme }
    : { statement: '', question: '', claim: '', lesson: '', belief: '', motif: '', message: '' };
  if (structureSelect) {
    structureSelect.value = selectedStructure || '';
  }
  renderBeats();
  renderCharacters();
  renderMoodboard();
  renderChapterTree();
  renderEditor();
  renderBrainstorm();
  renderTimeline();
  renderInspiration();
  renderTodos();
  updateProjectLabel();
}

// ══════════════════════════════════
// ── SIDEBAR: Inspiration & To-dos ──
// ══════════════════════════════════
const inspirationGrid = document.getElementById('inspiration-grid');
const todoList = document.getElementById('todo-list');
const todoInput = document.getElementById('todo-input');

// Inspiration mini-moodboard
const inspFileInput = document.createElement('input');
inspFileInput.type = 'file';
inspFileInput.accept = 'image/*';
inspFileInput.multiple = true;
inspFileInput.style.display = 'none';
document.body.appendChild(inspFileInput);

function renderInspiration() {
  inspirationGrid.innerHTML = '';
  if (!inspiration.length) {
    inspirationGrid.innerHTML = `<div class="insp-empty">${t('sidebar.insp.empty')}</div>`;
    return;
  }
  inspiration.forEach((img, i) => {
    const item = document.createElement('div');
    item.className = 'insp-item';
    item.innerHTML = `
      <img src="${img.src}" alt="Inspiration">
      <button class="insp-del" title="${t('beat.delete.title')}">&times;</button>
    `;
    item.querySelector('.insp-del').addEventListener('click', async () => {
      const file = inspiration[i].src.split('/').pop();
      await deleteImage(file);
      inspiration.splice(i, 1);
      await saveProject();
      renderInspiration();
    });
    inspirationGrid.appendChild(item);
  });
}

document.getElementById('add-inspiration').addEventListener('click', () => inspFileInput.click());

inspFileInput.addEventListener('change', async e => {
  const files = Array.from(e.target.files);
  for (const file of files) {
    const result = await uploadImage(file);
    inspiration.push({ id: Date.now() + Math.random(), src: result.path });
  }
  await saveProject();
  renderInspiration();
  inspFileInput.value = '';
});

// To-do list
function renderTodos() {
  todoList.innerHTML = '';
  todos.forEach((todo, i) => {
    const item = document.createElement('div');
    item.className = 'todo-item' + (todo.done ? ' done' : '');
    item.innerHTML = `
      <input type="checkbox" class="todo-check" ${todo.done ? 'checked' : ''}>
      <span class="todo-text" contenteditable="true"></span>
      <button class="todo-del" title="${t('beat.delete.title')}">&times;</button>
    `;
    item.querySelector('.todo-text').textContent = todo.text;

    item.querySelector('.todo-check').addEventListener('change', e => {
      todos[i].done = e.target.checked;
      item.classList.toggle('done', e.target.checked);
      saveProject();
    });

    const textEl = item.querySelector('.todo-text');
    textEl.addEventListener('input', () => {
      todos[i].text = textEl.textContent;
      saveProjectDebounced();
    });

    item.querySelector('.todo-del').addEventListener('click', () => {
      todos.splice(i, 1);
      saveProject();
      renderTodos();
    });

    todoList.appendChild(item);
  });
}

todoInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && todoInput.value.trim()) {
    todos.push({ id: Date.now(), text: todoInput.value.trim(), done: false });
    todoInput.value = '';
    saveProject();
    renderTodos();
  }
});

// New project button
document.getElementById('btn-new-project').addEventListener('click', () => {
  const container = document.createElement('div');
  container.innerHTML = `
    <div class="modal-title">${t('new.modal.title')}</div>
    <div class="modal-empty">${t('new.modal.confirm')}</div>
    <div style="display:flex;gap:12px;justify-content:flex-end;margin-top:20px">
      <button class="btn-secondary" id="new-cancel">${t('btn.cancel')}</button>
      <button class="btn-primary" id="new-confirm">${t('new.modal.create')}</button>
    </div>
  `;
  openModal(container);

  container.querySelector('#new-cancel').addEventListener('click', closeModal);
  container.querySelector('#new-confirm').addEventListener('click', () => {
    if (typeof flushEditor === 'function') flushEditor();

    beats = [];
    characters = [];
    moodImages = [];
    projectBlurb = '';
    writing = { chapters: [] };
    brainstorm = { notes: [], links: [] };
    timeline = { columns: [], rows: [] };
    inspiration = [];
    todos = [];
    writingGoal = 0;
    wordHistory = [];
    selectedStructure = null;
    worldbuilding = { entries: [], customCategories: [], hiddenBuiltins: [] };
    ideaMap = { nodes: [] };
    ideaWorkshops = { develop: ideaWorkshopDefault('develop'), char: ideaWorkshopDefault('char') };
    wbFilter = 'Alle';
    structureSelect.value = '';
    setCurrentProjectName(null);
    activeChapterId = null;
    activeSceneId = null;

    document.getElementById('project-blurb').value = '';
    updateProjectLabel();
    renderBeats();
    renderCharacters();
    renderMoodboard();
    renderChapterTree();
    renderEditor();
    renderBrainstorm();
    renderTimeline();
    renderInspiration();
    renderTodos();

    saveProject();
    closeModal();
  });
});

// ── Word export (.docx via the vendored docx library) ──
// Converts a scene's editor HTML (p/div/h1-h3 blocks; b/strong, i/em, u, br
// inline; span.inline-note margin notes) into docx Paragraph objects.
// Margin notes are working notes, not manuscript — they are dropped.
function sceneHtmlToParagraphs(html) {
  const { Paragraph, TextRun, HeadingLevel } = docx;
  const HEADINGS = { H1: HeadingLevel.HEADING_1, H2: HeadingLevel.HEADING_2, H3: HeadingLevel.HEADING_3 };
  const BLOCKS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'LI']);

  function runsForNode(node, fmt) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ? [new TextRun({ text: node.textContent, ...fmt })] : [];
    }
    if (node.nodeType !== Node.ELEMENT_NODE || node.classList.contains('inline-note')) return [];
    const tag = node.tagName;
    if (tag === 'BR') return [new TextRun({ text: '', break: 1 })];
    const next = { ...fmt };
    if (tag === 'B' || tag === 'STRONG') next.bold = true;
    if (tag === 'I' || tag === 'EM') next.italics = true;
    if (tag === 'U') next.underline = {};
    const runs = [];
    for (const child of node.childNodes) runs.push(...runsForNode(child, next));
    return runs;
  }

  const tpl = document.createElement('template');
  tpl.innerHTML = html || '';
  const paragraphs = [];
  let loose = []; // top-level text/inline nodes collect into an implicit paragraph

  const flushLoose = () => {
    if (loose.length) { paragraphs.push(new Paragraph({ children: loose })); loose = []; }
  };

  for (const node of tpl.content.childNodes) {
    if (node.nodeType === Node.ELEMENT_NODE && BLOCKS.has(node.tagName)) {
      flushLoose();
      let runs = runsForNode(node, {});
      // "<div><br></div>" is the editor's empty line — one empty paragraph, not two
      if (runs.length === 1 && node.children.length === 1 && node.children[0].tagName === 'BR') runs = [];
      paragraphs.push(new Paragraph({ children: runs, heading: HEADINGS[node.tagName] }));
    } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') {
      flushLoose();
    } else {
      loose.push(...runsForNode(node, {}));
    }
  }
  flushLoose();
  return paragraphs;
}

async function exportToDocx() {
  if (typeof docx === 'undefined') { alert(t('export.docx.unavailable')); return; }
  if (typeof flushEditor === 'function') flushEditor();

  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = docx;
  const projectTitle = document.getElementById('proj-title').textContent || t('project.untitled');

  const children = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun(projectTitle)],
    }),
  ];
  for (const chapter of writing.chapters) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun(chapter.title || t('writing.untitled.chapter'))],
    }));
    for (const scene of (chapter.scenes || [])) {
      if (chapter.scenes.length > 1 || scene.title) {
        children.push(new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun(scene.title || t('writing.untitled.scene'))],
        }));
      }
      children.push(...sceneHtmlToParagraphs(scene.content || ''));
    }
  }

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (currentProjectName || projectTitle || 'export').replace(/[<>:"/\\|?*]/g, '_') + '.docx';
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById('btn-export-word').addEventListener('click', exportToDocx);
document.getElementById('btn-export-project').addEventListener('click', exportProjectToFile);
document.getElementById('btn-import-project').addEventListener('click', importProjectFromFile);
document.getElementById('save-warning-backup').addEventListener('click', exportProjectToFile);

// Sidebar title: click to rename — doubles as the project name (and export filename)
const projTitleEl = document.getElementById('proj-title');
projTitleEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); projTitleEl.blur(); }
  if (e.key === 'Escape') { e.preventDefault(); updateProjectLabel(); projTitleEl.blur(); }
});
projTitleEl.addEventListener('blur', () => commitProjectTitle(projTitleEl.textContent));

// Load button
// ── Init: load from server ──
(async function init() {
  loadIdeaPool();
  const data = await loadInitialProject();
  projectReady = true; // loaded — saving is safe from here on
  applyProjectData(data);
})();
