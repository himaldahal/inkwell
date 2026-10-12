import { h, icon, openModal, confirmDialog } from '../ui/dom.js';
import { toast } from '../core/store.js';
import { navigate } from '../core/router.js';
import { loadStudy, study, save, uid, today, addDays, daysUntil, subjectName, progress, streak, minutesOn, LEVELS, seedSubjects, REV_STEPS, addRevision, completeRevision, grade, newCard, clozeParts } from './data.js';
import { CALCS } from './calc.js';
import { getAll } from '../core/db.js';
import { createNote } from '../ui/actions.js';

const TABS = [['today', 'Today', 'home'], ['subjects', 'Subjects', 'book'], ['planner', 'Planner', 'calendar'], ['timer', 'Focus', 'clock'], ['revise', 'Revise', 'refresh'], ['cards', 'Flashcards', 'copy'], ['ref', 'Quick ref', 'link'], ['mistakes', 'Mistakes', 'alert'], ['tests', 'Tests', 'check'], ['calc', 'Calculators', 'command'], ['paper', 'Paper templates', 'file']];
let tab = 'today', timer = null;

// ----- tiny UI helpers -----
function form(fields, onSubmit, label = 'Add') {
  const inputs = fields.map((f) => {
    const c = f.type === 'select' ? h('select', { class: 'input', 'aria-label': f.label }, f.options.map(([v, t]) => h('option', { value: v, selected: v === f.def }, t)))
      : f.type === 'textarea' ? h('textarea', { class: 'input', rows: 2, placeholder: f.label, 'aria-label': f.label }, f.def || '')
        : h('input', { class: 'input', type: f.type || 'text', placeholder: f.label, 'aria-label': f.label, value: f.def ?? '', step: 'any' });
    return [f, c];
  });
  const el = h('form', { class: 'st-form' }, inputs.map(([f, c]) => h('label', { class: 'st-f' }, h('span', {}, f.label), c)), h('button', { class: 'btn primary', type: 'submit' }, label));
  el.addEventListener('submit', (e) => {
    e.preventDefault(); const v = {};
    for (const [f, c] of inputs) v[f.k] = f.type === 'number' ? +c.value : c.value;
    if (fields.some((f) => f.req && !String(v[f.k]).trim())) return;
    onSubmit(v); el.reset?.();
  });
  return el;
}
const subOpts = (all = true) => [...(all ? [['', 'General']] : []), ...study().subjects.filter((s) => s.level === study().level).map((s) => [s.id, s.name])];
const card = (title, ...kids) => h('section', { class: 'st-card' }, title && h('h3', {}, title), ...kids);
const bar = (p, label) => h('div', { class: 'st-bar', title: label }, h('i', { style: { width: Math.round(p * 100) + '%' } }));
const del = (fn) => h('button', { class: 'icon-btn sm', type: 'button', 'aria-label': 'Delete', onclick: fn }, icon('trash', 16));
function bars(data, max) {
  const m = max || Math.max(1, ...data.map((d) => d.v));
  return h('div', { class: 'st-chart', role: 'img', 'aria-label': 'Bar chart' }, data.map((d) => h('div', { class: 'st-col' }, h('div', { class: 'st-colbar', style: { height: Math.round((d.v / m) * 100) + '%' }, title: `${d.l}: ${d.v}` }), h('small', {}, d.l))));
}
const list = (items, row, empty) => (items.length ? h('div', { class: 'st-list' }, items.map(row)) : h('p', { class: 'hint' }, empty));
const rerender = () => render();

// ----- views -----
function today_() {
  const D = study(), t = today();
  const dueRev = D.revisions.filter((r) => r.due <= t), dueCards = D.cards.filter((c) => c.due <= t), tasks = D.plan.tasks.filter((x) => x.date === t);
  const mins = minutesOn(t), left = daysUntil(D.exam.date);
  return h('div', { class: 'st-grid' },
    card('Exam countdown', left == null ? h('p', { class: 'hint' }, 'Set your exam date in Planner.') : h('div', { class: 'st-big' }, left >= 0 ? left : 0, h('small', {}, left >= 0 ? ` days to ${D.exam.label || 'exam'}` : ' - exam date passed'))),
    card('Today', h('div', { class: 'st-stats' }, h('div', {}, h('b', {}, `${Math.round(mins)} / ${D.plan.dailyMinutes}`), h('small', {}, 'minutes')), h('div', {}, h('b', {}, streak()), h('small', {}, 'day streak')), h('div', {}, h('b', {}, dueRev.length + dueCards.length), h('small', {}, 'reviews due'))), bar(Math.min(1, mins / D.plan.dailyMinutes), 'Daily target'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => { tab = 'timer'; render(); } }, 'Start focus'), h('button', { class: 'btn', type: 'button', onclick: () => { tab = 'cards'; render(); } }, 'Review cards'))),
    card('Tasks for today', list(tasks, (x) => h('label', { class: 'st-row' }, h('input', { type: 'checkbox', checked: x.done, onchange: (e) => { x.done = e.target.checked; save(); } }), h('span', { class: 'grow' }, x.text)), 'Nothing planned. Add tasks in Planner.')),
    card('Revision due', list(dueRev, (r) => h('div', { class: 'st-row' }, h('span', { class: 'grow' }, r.title, h('small', {}, ' ' + subjectName(r.subjectId))), r.noteId ? h('button', { class: 'btn sm', type: 'button', onclick: () => navigate('/note/' + encodeURIComponent(r.noteId)) }, 'Open note') : null, h('button', { class: 'btn sm primary', type: 'button', onclick: () => { completeRevision(r); rerender(); } }, 'Done')), 'No revisions due today.')));
}
function subjects_() {
  const D = study();
  const subs = D.subjects.filter((s) => s.level === D.level);
  return h('div', {}, h('div', { class: 'seg' }, LEVELS.map(([k, l]) => h('button', { type: 'button', class: D.level === k ? 'on' : '', onclick: () => { D.level = k; save(); render(); } }, l))),
    h('div', { class: 'st-grid' }, subs.map((s) => {
      const p = progress(s);
      return card(s.name, h('small', { class: 'hint' }, s.group), bar(p.all, 'Overall'), h('p', { class: 'hint' }, `Read ${Math.round(p.read * 100)}% - Revised ${Math.round(p.revised * 100)}% - Practiced ${Math.round(p.practiced * 100)}%`),
        h('div', { class: 'st-chapters' }, s.chapters.map((c) => h('div', { class: 'st-ch' }, h('span', { class: 'grow ellipsis', title: c.name }, c.name),
          [['read', 'R', 'Read'], ['revised', 'V', 'Revised'], ['practiced', 'P', 'Practiced']].map(([k, a, t]) => h('button', { type: 'button', class: 'st-chk' + (c[k] ? ' on' : ''), title: t, 'aria-label': `${c.name}: ${t}`, 'aria-pressed': String(!!c[k]), onclick: () => { c[k] = !c[k]; save(); render(); } }, a)),
          h('button', { class: 'st-chk', type: 'button', title: 'Add to revision schedule', 'aria-label': 'Schedule revision', onclick: () => { addRevision({ title: `${s.name}: ${c.name}`, subjectId: s.id }); toast('Revision scheduled for tomorrow'); } }, '+'),
          del(() => { s.chapters = s.chapters.filter((x) => x !== c); save(); render(); })))),
        form([{ k: 'name', label: 'New chapter', req: true }], (v) => { s.chapters.push({ id: uid(), name: v.name, read: false, revised: false, practiced: false }); save(); render(); }, 'Add chapter'));
    })),
    h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', onclick: async () => { const name = prompt('Subject name'); if (name) { D.subjects.push({ id: uid(), level: D.level, group: 'Custom', name, chapters: [] }); save(); render(); } } }, 'Add subject'),
      h('button', { class: 'btn ghost', type: 'button', onclick: async () => { if (await confirmDialog({ title: 'Restore default subjects?', message: 'Your progress on subjects will be reset.', confirmLabel: 'Restore', danger: true })) { D.subjects = seedSubjects(); save(); render(); } } }, 'Restore defaults')));
}
function planner_() {
  const D = study(), t = today();
  const week = Array.from({ length: 7 }, (_, i) => addDays(t, i));
  const doneWeek = D.subjects.reduce((n, s) => n + s.chapters.filter((c) => c.read).length, 0);
  return h('div', { class: 'st-grid' },
    card('Exam and targets', form([{ k: 'label', label: 'Exam name', def: D.exam.label }, { k: 'date', label: 'Exam date', type: 'date', def: D.exam.date }, { k: 'attempt', label: 'Attempt (e.g. May 2026)', def: D.exam.attempt }, { k: 'dailyMinutes', label: 'Daily target (minutes)', type: 'number', def: D.plan.dailyMinutes }, { k: 'weeklyChapters', label: 'Weekly chapter target', type: 'number', def: D.plan.weeklyChapters }],
      (v) => { Object.assign(D.exam, { label: v.label, date: v.date, attempt: v.attempt }); D.plan.dailyMinutes = v.dailyMinutes || 240; D.plan.weeklyChapters = v.weeklyChapters || 5; save(); toast('Saved'); render(); }, 'Save'),
      h('p', { class: 'hint' }, `Chapters read so far: ${doneWeek}. Weekly target: ${D.plan.weeklyChapters}.`)),
    card('Add task', form([{ k: 'text', label: 'Task', req: true }, { k: 'date', label: 'Date', type: 'date', def: t }], (v) => { D.plan.tasks.push({ id: uid(), date: v.date || t, text: v.text, done: false }); save(); render(); })),
    ...week.map((d) => card(d === t ? 'Today' : new Date(d + 'T00:00:00').toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }),
      list(D.plan.tasks.filter((x) => x.date === d), (x) => h('label', { class: 'st-row' }, h('input', { type: 'checkbox', checked: x.done, onchange: (e) => { x.done = e.target.checked; save(); } }), h('span', { class: 'grow' }, x.text), del(() => { D.plan.tasks = D.plan.tasks.filter((y) => y !== x); save(); render(); })), 'No tasks.'))));
}
function timer_() {
  const D = study();
  if (!timer) timer = { mode: 'focus', left: 25 * 60, running: false, sub: '', id: null, focusMin: 25, breakMin: 5 };
  const T = timer;
  const disp = h('div', { class: 'st-timer' });
  const draw = () => { disp.textContent = `${String(Math.floor(T.left / 60)).padStart(2, '0')}:${String(T.left % 60).padStart(2, '0')}`; };
  const stop = () => { clearInterval(T.id); T.id = null; T.running = false; };
  const finish = () => {
    stop();
    if (T.mode === 'focus') { D.sessions.push({ id: uid(), date: today(), min: T.focusMin, subjectId: T.sub, kind: 'pomodoro' }); save(); toast(`Logged ${T.focusMin} minutes. Take a break.`); navigator.vibrate?.([80, 60, 80]); T.mode = 'break'; T.left = T.breakMin * 60; } else { T.mode = 'focus'; T.left = T.focusMin * 60; toast('Break over. Ready to focus.'); }
    render();
  };
  const toggle = () => { if (T.running) { stop(); } else { T.running = true; T.id = setInterval(() => { T.left--; draw(); if (T.left <= 0) finish(); }, 1000); } render(); };
  draw();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today(), i - 6));
  return h('div', { class: 'st-grid' },
    card(T.mode === 'focus' ? 'Focus session' : 'Break', disp, h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', type: 'button', onclick: toggle }, T.running ? 'Pause' : 'Start'), h('button', { class: 'btn', type: 'button', onclick: () => { stop(); T.mode = 'focus'; T.left = T.focusMin * 60; render(); } }, 'Reset')),
      h('label', { class: 'st-f' }, h('span', {}, 'Subject'), h('select', { class: 'input', onchange: (e) => { T.sub = e.target.value; } }, subOpts().map(([v, t]) => h('option', { value: v, selected: v === T.sub }, t)))),
      h('label', { class: 'st-f' }, h('span', {}, 'Focus minutes'), h('input', { class: 'input', type: 'number', min: 5, max: 120, value: T.focusMin, onchange: (e) => { T.focusMin = Math.max(5, +e.target.value || 25); if (!T.running && T.mode === 'focus') { T.left = T.focusMin * 60; draw(); } } }))),
    card('Log time manually', form([{ k: 'min', label: 'Minutes', type: 'number', req: true }, { k: 'sub', label: 'Subject', type: 'select', options: subOpts() }], (v) => { D.sessions.push({ id: uid(), date: today(), min: v.min, subjectId: v.sub, kind: 'manual' }); save(); toast('Logged'); render(); })),
    card('Last 7 days (hours)', bars(days.map((d) => ({ l: new Date(d + 'T00:00:00').toLocaleDateString([], { weekday: 'short' }), v: Math.round((minutesOn(d) / 60) * 10) / 10 })))),
    card('Time by subject', bars(D.subjects.filter((s) => D.sessions.some((x) => x.subjectId === s.id)).map((s) => ({ l: s.name.slice(0, 6), v: Math.round(D.sessions.filter((x) => x.subjectId === s.id).reduce((n, x) => n + x.min, 0) / 6) / 10 })))));
}
async function revise_() {
  const D = study(), notes = (await getAll('notes')).filter((n) => !n.trashedAt && n.title);
  return h('div', { class: 'st-grid' },
    card('Schedule a revision', h('p', { class: 'hint' }, `Revisits after ${REV_STEPS.join(', ')} days.`), form([{ k: 'title', label: 'Topic', req: true }, { k: 'sub', label: 'Subject', type: 'select', options: subOpts() }, { k: 'note', label: 'Link a note', type: 'select', options: [['', 'None'], ...notes.slice(0, 200).map((n) => [n.id, n.title])] }], (v) => { addRevision({ title: v.title, subjectId: v.sub, noteId: v.note }); render(); })),
    card('Upcoming', list([...D.revisions].sort((a, b) => a.due.localeCompare(b.due)), (r) => h('div', { class: 'st-row' }, h('span', { class: 'grow' }, r.title, h('small', {}, ` ${subjectName(r.subjectId)} - step ${r.step + 1}/${REV_STEPS.length}`)), h('span', { class: 'chip' }, r.due <= today() ? 'Due' : r.due), r.noteId ? h('button', { class: 'btn sm', type: 'button', onclick: () => navigate('/note/' + encodeURIComponent(r.noteId)) }, 'Note') : null, h('button', { class: 'btn sm primary', type: 'button', onclick: () => { completeRevision(r); render(); } }, 'Done'), del(() => { D.revisions = D.revisions.filter((x) => x !== r); save(); render(); })), 'Nothing scheduled.')));
}
function cards_() {
  const D = study(), due = D.cards.filter((c) => c.due <= today());
  const review = () => {
    const q = [...due]; let cur = null; let shown = false;
    const body = h('div', { class: 'st-review' });
    const m = openModal({ title: 'Review flashcards', size: 'md', body, actions: [{ label: 'Close', kind: 'ghost' }], onClose: () => render() });
    const next = () => {
      cur = q.shift(); shown = false;
      if (!cur) { body.replaceChildren(h('p', { class: 'muted-p' }, 'All caught up.')); return; }
      const c = cur.type === 'cloze' ? clozeParts(cur.q) : { front: cur.q, back: cur.a };
      body.replaceChildren(h('p', { class: 'hint' }, `${q.length + 1} left - ${subjectName(cur.subjectId)}`), h('div', { class: 'st-front' }, c.front),
        h('div', { class: 'st-answer', hidden: true }, c.back), h('div', { class: 'btn-row st-grades' }, h('button', { class: 'btn primary', type: 'button', id: 'st-show', onclick: (e) => { body.querySelector('.st-answer').hidden = false; e.currentTarget.hidden = true; body.querySelector('.st-grades .g').hidden = false; } }, 'Show answer'),
          h('span', { class: 'g', hidden: true }, [['Again', 1], ['Hard', 3], ['Good', 4], ['Easy', 5]].map(([l, g]) => h('button', { class: 'btn', type: 'button', onclick: () => { grade(cur, g); next(); } }, l)))));
    };
    next();
  };
  return h('div', { class: 'st-grid' },
    card(`Due now: ${due.length}`, h('button', { class: 'btn primary', type: 'button', disabled: !due.length, onclick: review }, 'Start review'), h('p', { class: 'hint' }, `${D.cards.length} cards total. Cloze cards use {{c1::hidden text}}.`)),
    card('New card', form([{ k: 'type', label: 'Type', type: 'select', options: [['qa', 'Question and answer'], ['cloze', 'Cloze']] }, { k: 'sub', label: 'Subject', type: 'select', options: subOpts() }, { k: 'q', label: 'Question or cloze text', type: 'textarea', req: true }, { k: 'a', label: 'Answer (not for cloze)', type: 'textarea' }], (v) => { D.cards.push(newCard({ type: v.type, subjectId: v.sub, q: v.q, a: v.a })); save(); render(); })),
    card('All cards', list(D.cards, (c) => h('div', { class: 'st-row' }, h('span', { class: 'grow ellipsis' }, c.q), h('small', {}, c.due <= today() ? 'due' : c.due), del(() => { D.cards = D.cards.filter((x) => x !== c); save(); render(); })), 'No cards yet.')));
}
function ref_() {
  const D = study(); let q = '', kind = '';
  const out = h('div'), paint = () => out.replaceChildren(list(D.refs.filter((r) => (!kind || r.kind === kind) && (!q || (r.title + r.body + r.tags).toLowerCase().includes(q))), (r) => h('div', { class: 'st-ref' }, h('div', { class: 'st-row' }, h('b', { class: 'grow' }, r.title), h('span', { class: 'chip' }, r.kind), del(() => { D.refs = D.refs.filter((x) => x !== r); save(); paint(); })), h('p', { class: 'selectable' }, r.body), h('small', { class: 'hint' }, [subjectName(r.subjectId), r.tags].filter(Boolean).join(' - '))), 'No reference cards yet. Add formulas, section numbers, case names and amendments in your own words.'));
  paint();
  return h('div', {}, h('div', { class: 'st-grid' }, card('Add reference', form([{ k: 'kind', label: 'Kind', type: 'select', options: [['formula', 'Formula'], ['section', 'Section ref'], ['case', 'Case law'], ['amendment', 'Amendment']] }, { k: 'title', label: 'Title (e.g. Section 43B)', req: true }, { k: 'body', label: 'Your note', type: 'textarea' }, { k: 'tags', label: 'Tags (comma separated)' }, { k: 'sub', label: 'Subject', type: 'select', options: subOpts() }], (v) => { D.refs.push({ id: uid(), kind: v.kind, title: v.title, body: v.body, tags: v.tags, subjectId: v.sub }); save(); paint(); }))),
    h('div', { class: 'st-filter' }, h('input', { class: 'input', type: 'search', placeholder: 'Search references', 'aria-label': 'Search references', oninput: (e) => { q = e.target.value.toLowerCase(); paint(); } }), h('select', { class: 'input', 'aria-label': 'Kind', onchange: (e) => { kind = e.target.value; paint(); } }, [['', 'All'], ['formula', 'Formulas'], ['section', 'Sections'], ['case', 'Cases'], ['amendment', 'Amendments']].map(([v, t]) => h('option', { value: v }, t)))), out);
}
function mistakes_() {
  const D = study();
  return h('div', { class: 'st-grid' }, card('Log a mistake', form([{ k: 'sub', label: 'Subject', type: 'select', options: subOpts() }, { k: 'question', label: 'Question or MCQ', type: 'textarea', req: true }, { k: 'reason', label: 'Why it went wrong' }, { k: 'fix', label: 'Correct approach', type: 'textarea' }], (v) => { D.mistakes.unshift({ id: uid(), date: today(), subjectId: v.sub, question: v.question, reason: v.reason, fix: v.fix, fixed: false }); save(); render(); })),
    card('Mistake notebook', list(D.mistakes, (m) => h('div', { class: 'st-ref' }, h('div', { class: 'st-row' }, h('b', { class: 'grow' }, subjectName(m.subjectId)), h('small', {}, m.date), h('label', { class: 'st-row' }, h('input', { type: 'checkbox', checked: m.fixed, onchange: (e) => { m.fixed = e.target.checked; save(); } }), 'Understood'), del(() => { D.mistakes = D.mistakes.filter((x) => x !== m); save(); render(); })), h('p', { class: 'selectable' }, m.question), m.reason ? h('p', { class: 'hint' }, 'Reason: ' + m.reason) : null, m.fix ? h('p', { class: 'selectable' }, 'Fix: ' + m.fix) : null), 'No mistakes logged. Writing them down is the fastest way to stop repeating them.')));
}
function tests_() {
  const D = study(), subs = D.subjects.filter((s) => D.tests.some((t) => t.subjectId === s.id));
  const avg = (id) => { const t = D.tests.filter((x) => x.subjectId === id && x.total); return t.length ? Math.round(t.reduce((n, x) => n + (x.score / x.total) * 100, 0) / t.length) : 0; };
  return h('div', { class: 'st-grid' },
    card('Record a test', form([{ k: 'kind', label: 'Kind', type: 'select', options: [['mock', 'Mock test'], ['mcq', 'MCQ practice'], ['rtp', 'RTP'], ['mtp', 'MTP'], ['past', 'Past paper']] }, { k: 'name', label: 'Name', req: true }, { k: 'sub', label: 'Subject', type: 'select', options: subOpts() }, { k: 'score', label: 'Marks scored', type: 'number', req: true }, { k: 'total', label: 'Out of', type: 'number', def: 100, req: true }, { k: 'minutes', label: 'Time taken (min)', type: 'number' }], (v) => { D.tests.unshift({ id: uid(), date: today(), kind: v.kind, name: v.name, subjectId: v.sub, score: v.score, total: v.total, minutes: v.minutes }); save(); render(); })),
    card('Average score by subject (%)', subs.length ? bars(subs.map((s) => ({ l: s.name.slice(0, 6), v: avg(s.id) })), 100) : h('p', { class: 'hint' }, 'Record tests to see analytics.')),
    card('Score trend (%)', D.tests.length ? bars([...D.tests].slice(0, 12).reverse().map((t, i) => ({ l: String(i + 1), v: Math.round((t.score / (t.total || 1)) * 100) })), 100) : h('p', { class: 'hint' }, 'No tests yet.')),
    card('History', list(D.tests, (t) => h('div', { class: 'st-row' }, h('span', { class: 'chip' }, t.kind.toUpperCase()), h('span', { class: 'grow' }, t.name, h('small', {}, ` ${subjectName(t.subjectId)} - ${t.date}${t.minutes ? ' - ' + t.minutes + ' min' : ''}`)), h('b', {}, `${t.score}/${t.total}`), del(() => { D.tests = D.tests.filter((x) => x !== t); save(); render(); })), 'Nothing recorded.')),
    card('RTP, MTP and past papers', form([{ k: 'kind', label: 'Kind', type: 'select', options: [['RTP', 'RTP'], ['MTP', 'MTP'], ['Past', 'Past paper']] }, { k: 'name', label: 'Paper or attempt', req: true }, { k: 'sub', label: 'Subject', type: 'select', options: subOpts() }], (v) => { D.papers.push({ id: uid(), kind: v.kind, name: v.name, subjectId: v.sub, status: 'todo' }); save(); render(); }),
      list(D.papers, (p) => h('div', { class: 'st-row' }, h('span', { class: 'chip' }, p.kind), h('span', { class: 'grow' }, p.name, h('small', {}, ' ' + subjectName(p.subjectId))), h('select', { class: 'input', 'aria-label': 'Status', style: { width: 'auto' }, onchange: (e) => { p.status = e.target.value; save(); } }, [['todo', 'To do'], ['attempted', 'Attempted'], ['reviewed', 'Reviewed']].map(([v, t]) => h('option', { value: v, selected: p.status === v }, t))), del(() => { D.papers = D.papers.filter((x) => x !== p); save(); render(); })), 'None tracked.')));
}
function calc_() {
  return h('div', { class: 'st-grid' }, CALCS.map((c) => {
    const out = h('div', { class: 'st-out', 'aria-live': 'polite' });
    const f = h('form', { class: 'st-form' }, c.fields.map(([k, l, d]) => h('label', { class: 'st-f' }, h('span', {}, l), h('input', { class: 'input', name: k, type: 'number', step: 'any', value: d }))), h('button', { class: 'btn primary', type: 'submit' }, 'Calculate'));
    const go = (e) => { e?.preventDefault(); const v = {}; for (const [k] of c.fields) v[k] = +f.elements[k].value; out.replaceChildren(...c.run(v).map(([a, b]) => h('div', { class: 'st-row' }, h('span', { class: 'grow' }, a), h('b', { class: 'selectable' }, String(b))))); };
    f.addEventListener('submit', go); go();
    return card(c.title, f, out);
  }));
}
const T = (title, base, rows) => ({ title, base, html: rows });
const tbl = (cols, n = 8) => `<table border="1" style="width:100%;border-collapse:collapse"><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>${Array.from({ length: n }, () => `<tr>${cols.map(() => '<td>&nbsp;</td>').join('')}</tr>`).join('')}</table>`;
const PAPERS = [
  T('Journal', 'lined', tbl(['Date', 'Particulars', 'L.F.', 'Debit', 'Credit'])), T('Ledger account', 'lined', tbl(['Date', 'Particulars', 'J.F.', 'Amount', 'Date', 'Particulars', 'J.F.', 'Amount'])),
  T('T-account', 'grid', '<table border="1" style="width:100%"><tr><th colspan="2">Account name</th></tr><tr><th>Dr.</th><th>Cr.</th></tr><tr><td style="height:240px"></td><td></td></tr></table>'),
  T('Trial balance', 'lined', tbl(['Particulars', 'Debit', 'Credit'], 14)), T('Balance sheet', 'lined', tbl(['Liabilities', 'Amount', 'Assets', 'Amount'], 12)),
  T('Profit and loss account', 'lined', tbl(['Particulars', 'Amount', 'Particulars', 'Amount'], 12)), T('Cash flow statement', 'lined', tbl(['Particulars', 'Amount', 'Amount'], 14)),
  T('GST invoice', 'blank', '<h2>Tax invoice</h2><p>Supplier GSTIN: ______ Invoice no.: ______ Date: ______</p><p>Buyer: ______ GSTIN: ______ Place of supply: ______</p>' + tbl(['Description', 'HSN/SAC', 'Qty', 'Rate', 'Taxable', 'CGST', 'SGST', 'IGST'], 5)),
  T('Working note', 'lined', '<h2>Working note no. __</h2><p>Basis:</p><p>Workings:</p><p>Conclusion:</p>'), T('Ruled paper (amount columns)', 'lined', tbl(['Particulars', 'Amount', 'Total'], 16)),
];
function paper_() {
  return h('div', { class: 'st-grid' }, PAPERS.map((p) => card(p.title, h('button', { class: 'btn primary', type: 'button', onclick: async () => { const n = await createNote({ title: p.title, template: p.base, text: p.html, tags: ['study'] }); navigate('/note/' + encodeURIComponent(n.id)); } }, 'Create note'))));
}
const VIEWS = { today: today_, subjects: subjects_, planner: planner_, timer: timer_, revise: revise_, cards: cards_, ref: ref_, mistakes: mistakes_, tests: tests_, calc: calc_, paper: paper_ };

let root;
async function render() {
  if (!root) return;
  const view = await VIEWS[tab]();
  root.replaceChildren(
    h('header', { class: 'st-head' }, h('h1', { class: 'lib-title' }, 'CA Study Hub'),
      h('button', { class: 'btn' + (document.documentElement.classList.contains('exam-mode') ? ' primary' : ''), type: 'button', 'aria-pressed': String(document.documentElement.classList.contains('exam-mode')), onclick: () => { document.documentElement.classList.toggle('exam-mode'); render(); } }, icon('focus', 18), 'Exam mode')),
    h('nav', { class: 'st-tabs', role: 'tablist' }, TABS.map(([id, l, ic]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === id), class: tab === id ? 'on' : '', onclick: () => { tab = id; render(); } }, icon(ic, 16), l))),
    h('div', { class: 'st-body' }, view));
}
export async function mountStudy(el) {
  root = el; el.classList.add('study'); await loadStudy(); await render();
  return { destroy() { root = null; el.replaceChildren(); document.documentElement.classList.remove('exam-mode'); } };
}
