import { ACCENTS, TEMPLATES, PAPER_COLORS } from './templates.js';

const S = (key, label, options, hint) => ({ key, label, hint, type: 'seg', options });
const SW = (key, label, hint) => ({ key, label, hint, type: 'switch' });
const SEL = (key, label, options, hint) => ({ key, label, hint, type: 'select', options });
const R = (key, label, min, max, step, hint, unit = '') => ({ key, label, hint, type: 'range', min, max, step, unit });
const C = (key, label) => ({ key, label, type: 'color' });
const speech = () => (typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices().map((v) => [v.name, `${v.name} (${v.lang})`]) : []);

/** Declarative settings. `custom` sections are rendered by settingsPage.js. */
export const SECTIONS = [
  { id: 'appearance', title: 'Appearance', icon: 'sun', items: [
    S('theme', 'Theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark'], ['sepia', 'Sepia']]),
    { key: 'accent', label: 'Accent color', type: 'accent', options: ACCENTS },
    S('density', 'UI density', [['compact', 'Compact'], ['comfortable', 'Comfortable']]),
    S('radius', 'Corner radius', [['small', 'Sharp'], ['medium', 'Soft'], ['large', 'Round']]),
    S('uiFont', 'UI font', [['system', 'Modern'], ['serif', 'Serif'], ['mono', 'Mono']]),
    S('fontSize', 'UI text size', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]),
    S('iconStyle', 'Icon style', [['light', 'Light'], ['regular', 'Regular'], ['bold', 'Bold']]),
    S('iconSize', 'Icon size', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]),
    SW('reducedMotion', 'Reduce motion', 'Turn off animations'), SW('highContrast', 'High contrast', 'Stronger borders and text'),
    SW('badge', 'App icon badge', 'Show the number of unsynced changes on the installed app icon'),
  ] },
  { id: 'library', title: 'Library', icon: 'file', items: [
    S('view', 'Default view', [['grid', 'Grid'], ['list', 'List']]), S('cardSize', 'Card size', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]),
    S('sort', 'Sort by', [['updated', 'Modified'], ['created', 'Created'], ['title', 'Title']]), S('groupBy', 'Group by', [['none', 'None'], ['date', 'Date'], ['notebook', 'Notebook']]),
    SW('showPreviews', 'Show previews'), SW('showDates', 'Show dates'), SW('showTags', 'Show tags'),
    { key: 'defaultNotebook', label: 'Default notebook', type: 'select', async: 'notebooks', hint: 'Where new notes go' },
    SW('confirmDelete', 'Confirm before deleting'), { type: 'info', label: 'Trash retention', text: 'Deleted notes stay in Trash for 60 days.' },
    S('defaultTemplate', 'Default page style', TEMPLATES.map((t) => [t.id, t.label])), SEL('pageSize', 'Default page size', [['a4', 'A4'], ['letter', 'Letter'], ['infinite', 'Infinite scroll']]),
    { key: 'defaultPaper', label: 'Default paper color', type: 'paper', options: PAPER_COLORS },
  ] },
  { id: 'pen', title: 'Pen & touch', icon: 'edit', items: [
    S('editor.layout', 'Writing screen', [['notability', 'Floating tools'], ['classic', 'Classic bar']], 'Floating tools give the page the whole screen'),
    { type: 'calibrate' },
    SW('editor.autoCalibrate', 'Calibrate automatically', 'Learns your pressure range and hand steadiness as you write, separately for pencil, finger and mouse'),
    SW('editor.smoothingAuto', 'Automatic smoothing', 'Pick the smoothing for each input from what was learned. Turn off to use the slider'),
    R('editor.smoothing', 'Manual smoothing', 0, 100, 5, 'Used when automatic smoothing is off', '%'),
    S('editor.pressureCurve', 'Pressure feel', [['soft', 'Soft'], ['normal', 'Normal'], ['firm', 'Firm']]),
    SW('editor.prediction', 'Pen prediction', 'Draws slightly ahead of the pen to hide lag'),
    R('editor.snapDelay', 'Hold-to-snap delay', 250, 1200, 50, 'How long to hold at the end of a stroke to straighten it', ' ms'),
    R('editor.zoomSpeed', 'Pinch and trackpad zoom speed', 50, 200, 10, null, '%'),
    SW('editor.momentum', 'Momentum scrolling', 'Panning keeps gliding after you let go'),
    SW('editor.smartZoom', 'Double-tap to zoom', 'With the hand tool, double-tap or double-click to jump between fit and close-up'),
  ] },
  { id: 'editor', title: 'Editor', icon: 'edit', items: [
    C('editor.canvasColor', 'Editor background'), C('editor.pageColor', 'Default page color'),
    S('pen.tool', 'Default tool', [['pen', 'Pen'], ['pencil', 'Pencil'], ['highlighter', 'Highlighter']]),
    C('pen.color', 'Pen color'), R('pen.size', 'Pen size', 1, 12, .5), C('editor.highlighter.color', 'Highlighter color'), R('editor.highlighter.size', 'Highlighter size', 6, 30, 1),
    R('editor.eraser.size', 'Eraser size', 4, 40, 1), S('editor.eraser.mode', 'Eraser mode', [['stroke', 'Whole stroke'], ['pixel', 'Pixel']]),
    S('editor.palmRejection', 'Palm rejection', [['off', 'Off'], ['auto', 'Auto'], ['strict', 'Strict']]), S('editor.inputMode', 'Drawing input', [['any', 'Finger and pencil'], ['pencil-only', 'Pencil only']]),
    S('editor.zoom', 'Zoom behavior', [['pinch', 'Pinch'], ['fit-width', 'Fit width'], ['locked', 'Locked']]), SW('editor.snap', 'Snap to shapes'), SW('editor.guides', 'Guides'),
    S('editor.scrollDir', 'Scroll direction', [['vertical', 'Vertical'], ['horizontal', 'Horizontal']]), SW('editor.autoScroll', 'Auto-scroll while writing'),
    S('editor.twoFinger', 'Two-finger gesture', [['pan-zoom', 'Pan and zoom'], ['undo', 'Undo tap'], ['none', 'None']]),
    S('editor.toolbarPos', 'Toolbar position', [['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right']]), SW('editor.toolbarAutoHide', 'Auto-hide toolbar'),
    SW('editor.leftHanded', 'Left-handed mode'), SW('editor.haptics', 'Haptic feedback'),
  ] },
  { id: 'modules', title: 'Modules', icon: 'zap', items: [{ type: 'modules' }] },
  { id: 'typing', title: 'Typing & voice', icon: 'keyboard', items: [
    S('typing.font', 'Typing font', [['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']]), R('typing.size', 'Typing size', 12, 28, 1, null, 'px'),
    SW('typing.spellcheck', 'Spell-check'), SW('typing.autocorrect', 'Autocorrect'),
    { key: 'voice.name', label: 'Read-aloud voice', type: 'select', async: 'voices' }, R('voice.rate', 'Read-aloud speed', .5, 2, .1), R('voice.pitch', 'Read-aloud pitch', .5, 2, .1),
    SEL('voice.dictLang', 'Dictation language', [['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['es-ES', 'Spanish'], ['fr-FR', 'French'], ['de-DE', 'German'], ['hi-IN', 'Hindi'], ['ne-NP', 'Nepali']]),
  ] },
  { id: 'sync', title: 'Sync', icon: 'cloud', items: [
    SEL('sync.interval', 'Auto-sync interval', [[15, 'Every 15 s'], [30, 'Every 30 s'], [60, 'Every minute'], [300, 'Every 5 min'], [0, 'Manual only']]),
    SW('sync.wifiOnlyLarge', 'Wi-Fi only for large files'), SW('sync.background', 'Background sync'),
    S('sync.conflict', 'Conflicts', [['newest', 'Newest wins'], ['both', 'Keep both']]), { type: 'sync' },
  ] },
  { id: 'privacy', title: 'Privacy & security', icon: 'lock', items: [
    { type: 'applock' }, SEL('autoLockSecs', 'Auto-lock after', [[0, 'Immediately'], [10, '10 seconds'], [60, '1 minute'], [300, '5 minutes'], [-1, 'Never']]),
    SW('hidePreviews', 'Hide previews in app switcher'), { type: 'clearcache' }, { type: 'devices' },
  ] },
  { id: 'notifications', title: 'Notifications', icon: 'info', items: [
    SW('notif.inApp', 'In-app share and invite alerts'), { key: 'notif.emailShare', label: 'Email me when a note is shared', type: 'switch', commercial: true }, { key: 'notif.emailDigest', label: 'Weekly email digest', type: 'switch', commercial: true },
  ] },
  { id: 'accessibility', title: 'Accessibility', icon: 'focus', items: [
    SW('a11y.largeUI', 'Large UI'), SW('a11y.dyslexia', 'Dyslexia-friendly font'), SW('a11y.srHints', 'Extra screen-reader hints'),
    S('a11y.colorBlind', 'Color-blind safe palette', [['none', 'Off'], ['deuteranopia', 'Red-green'], ['tritanopia', 'Blue-yellow']]),
  ] },
  { id: 'region', title: 'Language & region', icon: 'book', items: [
    SEL('region.language', 'Language', [['en', 'English']]), SEL('region.dateFormat', 'Date format', [['auto', 'Automatic'], ['MDY', 'MM/DD/YYYY'], ['DMY', 'DD/MM/YYYY'], ['YMD', 'YYYY-MM-DD']]),
    S('region.timeFormat', 'Time format', [['auto', 'Auto'], ['12', '12-hour'], ['24', '24-hour']]), S('region.weekStart', 'Week starts on', [['sun', 'Sunday'], ['mon', 'Monday']]),
  ] },
  { id: 'shortcuts', title: 'Shortcuts', icon: 'command', items: [{ type: 'shortcuts' }] },
  { id: 'storage', title: 'Storage', icon: 'archive', items: [{ type: 'storage' }, { type: 'offline' }] },
  { id: 'advanced', title: 'Advanced', icon: 'info', items: [S('devMode', 'Developer info', [[false, 'Hidden'], [true, 'Shown']]), { type: 'about' }, { type: 'reset' }] },
];
export const RESETTABLE = (sec) => sec.items.filter((i) => i.key).map((i) => i.key);

export const SHORTCUT_DEFAULTS = { new: 'mod+n', notebook: 'mod+shift+n', palette: 'mod+k', daily: 'mod+d', sidebar: 'mod+\\', zen: 'mod+shift+f' };
export const SHORTCUT_LABELS = { new: 'New note', notebook: 'New notebook', palette: 'Command palette', daily: 'Daily note', sidebar: 'Toggle sidebar', zen: 'Focus mode' };
export function comboOf(e) { return [(e.ctrlKey || e.metaKey) ? 'mod' : '', e.altKey ? 'alt' : '', e.shiftKey ? 'shift' : '', e.key.toLowerCase()].filter(Boolean).join('+'); }
export const prettyCombo = (c) => c.split('+').map((p) => ({ mod: /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl', shift: 'Shift', alt: 'Alt' }[p] || p.toUpperCase())).join(' + ');
