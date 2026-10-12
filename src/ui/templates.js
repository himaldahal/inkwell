/* Template gallery. `base` is the page background the editor understands
   (blank|lined|grid|dot|cornell|todo); `preset` is stored on the note for richer layouts. */
export const TEMPLATES = [
  { id: 'blank', label: 'Blank', base: 'blank' },
  { id: 'lined', label: 'Lined', base: 'lined' },
  { id: 'grid', label: 'Grid', base: 'grid' },
  { id: 'dot', label: 'Dot grid', base: 'dot' },
  { id: 'cornell', label: 'Cornell', base: 'cornell' },
  { id: 'todo', label: 'To-do', base: 'todo' },
];
export const PRESETS = [
  { id: 'planner', label: 'Daily planner', base: 'lined', title: 'Daily planner', text: '<h2>Today</h2><p><strong>Top 3</strong></p><ol><li></li><li></li><li></li></ol><p><strong>Schedule</strong></p><p>Notes</p>' },
  { id: 'weekly', label: 'Weekly plan', base: 'grid', title: 'Weekly plan', text: '<h2>Week of </h2><p>Mon / Tue / Wed / Thu / Fri / Sat / Sun</p>' },
  { id: 'cornell', label: 'Cornell notes', base: 'cornell', title: 'Lecture notes', text: '<h2>Topic</h2><p>Date: </p>' },
  { id: 'meeting', label: 'Meeting notes', base: 'lined', title: 'Meeting notes', text: '<h2>Meeting</h2><p><strong>Attendees:</strong> </p><p><strong>Agenda</strong></p><ul><li></li></ul><p><strong>Action items</strong></p><ul><li></li></ul>' },
  { id: 'todo', label: 'To-do list', base: 'todo', title: 'To-do', text: '<h2>To-do</h2><ul><li></li><li></li><li></li></ul>' },
  { id: 'staff', label: 'Music staff', base: 'lined', title: 'Sheet music', text: '' },
  { id: 'graph', label: 'Graph paper', base: 'grid', title: 'Graph', text: '' },
  { id: 'journal', label: 'Journal', base: 'lined', title: 'Journal', text: '<h2>Journal</h2><p>How was today?</p>' },
  { id: 'sketch', label: 'Sketchbook', base: 'dot', title: 'Sketch', text: '' },
];
export const PAPER_COLORS = [
  { v: null, label: 'White' }, { v: '#fbf6e9', label: 'Cream' }, { v: '#fff4c2', label: 'Sun' },
  { v: '#e6f0ff', label: 'Sky' }, { v: '#e5f5ea', label: 'Mint' }, { v: '#fde8ef', label: 'Rose' }, { v: '#23252f', label: 'Slate' },
];
export const NB_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#64748b'];
export const NB_ICONS = ['📓', '📚', '🎓', '💼', '🧪', '🎨', '🏠', '💡', '✈️', '🎵', '💻', '⭐'];
export const ACCENTS = ['#FF9F0A', '#FF453A', '#FF375F', '#30B454', '#0A84FF', '#5E5CE6', '#BF5AF2', '#4f46e5', '#64748b'];
export const SMART = [
  { id: 'week', label: 'This week', icon: 'calendar', test: (n) => n.updatedAt > Date.now() - 7 * 864e5 },
  { id: 'untagged', label: 'Untagged', icon: 'tag', test: (n) => !(n.tags || []).length },
  { id: 'pdf', label: 'Has PDF', icon: 'file', test: (n) => (n.pages || []).some((p) => p.type === 'pdf') },
  { id: 'audio', label: 'Has audio', icon: 'mic', test: (n) => (n.recordings || []).length > 0 },
  { id: 'locked', label: 'Locked', icon: 'lock', test: (n) => !!n.lock },
];
