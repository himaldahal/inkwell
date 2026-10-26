// The template library: ready-made page layouts. `ops` are drawn by layouts.js behind the user's ink.
// Coordinates are % of the page. Content frame: x 6..94, y 14..95.
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const HOURS = ['6 am', '7 am', '8 am', '9 am', '10 am', '11 am', '12 pm', '1 pm', '2 pm', '3 pm', '4 pm', '5 pm', '6 pm', '7 pm', '8 pm', '9 pm', '10 pm'];
export const CATS = ['Planning', 'Work', 'Study', 'Accounting', 'Writing', 'Design', 'Math & Science', 'Personal'];

const tp = (id, label, cat, base, ops, o = {}) => ({ id, label, cat, base, title: o.title || label, text: o.text || '', ops });
const T = (t, s) => ['t', t, s];
/** n boxes side by side */
const row = (n, x, y, w, h, labels = [], fill = 0, gap = 2) => { const bw = (w - gap * (n - 1)) / n; return Array.from({ length: n }, (_, i) => ['b', x + i * (bw + gap), y, bw, h, labels[i] || '', fill]); };
/** n boxes stacked */
const col = (n, x, y, w, h, labels = [], fill = 0, gap = 1.6) => { const bh = (h - gap * (n - 1)) / n; return Array.from({ length: n }, (_, i) => ['b', x, y + i * (bh + gap), w, bh, labels[i] || '', fill]); };
/** r x c boxes */
const mat = (r, c, x, y, w, h, labels = [], fill = 0, gx = 2, gy = 1.6) => {
  const bw = (w - gx * (c - 1)) / c, bh = (h - gy * (r - 1)) / r, out = [];
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) out.push(['b', x + j * (bw + gx), y + i * (bh + gy), bw, bh, labels[i * c + j] || '', fill]);
  return out;
};
const nums = (n, from = 1) => Array.from({ length: n }, (_, i) => String(from + i));
const table = (cols, head, rows, y = 14, h = 81, rowLabels) => [['g', 6, y, 88, h, cols, rows, { head, hh: 34, rows: rowLabels }]];
const fields = (items, y = 13.2) => items.map(([t, x, w]) => ['f', t, x, y, w]);
const lined = (y, n, gap = 34, x = 8, w = 84) => ['l', x, y, w, n, gap];
const phone = (x, y, w, h) => [['b', x, y, w, h, '', 0], ['h', x + w * 0.25, y + 3, w * 0.5], ['b', x + w * 0.12, y + h - 7.5, w * 0.76, 4, '', 1]];

export const TEMPLATE_LIST = [
  // ---------- classic ----------
  { id: 'planner', label: 'Daily planner', cat: 'Planning', base: 'lined', title: 'Daily planner', text: '<h2>Today</h2><p><strong>Top 3</strong></p><ol><li></li><li></li><li></li></ol><p><strong>Schedule</strong></p><p>Notes</p>' },
  { id: 'weekly', label: 'Weekly plan', cat: 'Planning', base: 'grid', title: 'Weekly plan', text: '<h2>Week of </h2><p>Mon / Tue / Wed / Thu / Fri / Sat / Sun</p>' },
  { id: 'cornell', label: 'Cornell notes', cat: 'Study', base: 'cornell', title: 'Lecture notes', text: '<h2>Topic</h2><p>Date: </p>' },
  tp('meeting', 'Meeting notes', 'Work', 'blank', [T('Meeting notes'), ...fields([['Topic', 6, 46], ['Date', 56, 18], ['Time', 78, 16]]), ['f', 'Attendees', 6, 18.2, 88], ...row(2, 6, 21, 88, 26, ['Agenda', 'Discussion'], 0), ['b', 6, 49, 88, 20, 'Decisions', 0], ['c', 9, 74, 82, 5, 40], ['tx', 'ACTION ITEMS', 8, 72, 11, 'a']], { text: '' }),
  { id: 'todo', label: 'To-do list', cat: 'Basics', base: 'todo', title: 'To-do', text: '<h2>To-do</h2><ul><li></li><li></li><li></li></ul>' },
  { id: 'staff', label: 'Music staff', cat: 'Math & Science', base: 'lined', title: 'Sheet music', text: '' },
  { id: 'graph', label: 'Graph paper', cat: 'Math & Science', base: 'grid', title: 'Graph', text: '' },
  tp('journal', 'Journal', 'Writing', 'blank', [T('Journal'), ...fields([['Date', 6, 30], ['Weather', 40, 20], ['Mood', 66, 28]]), lined(19, 31, 33)], { text: '' }),
  { id: 'sketch', label: 'Sketchbook', cat: 'Design', base: 'dot', title: 'Sketch', text: '' },

  // ---------- planning ----------
  tp('daily-focus', 'Daily focus', 'Planning', 'blank', [T('Daily focus'), ...fields([['Date', 6, 30], ['Energy', 40, 20], ['Mood', 66, 28]]), ['b', 6, 17, 88, 19, 'Top 3 priorities', 1], ['c', 9, 25, 82, 3, 38], ...row(2, 6, 38, 88, 27, ['Schedule', 'Tasks'], 0), ['b', 6, 67, 88, 12, 'Wins today', 0], ['b', 6, 81, 88, 14, 'Notes', 0]]),
  tp('time-blocks', 'Time blocks', 'Planning', 'blank', [T('Time blocks', 'Plan your day'), ...fields([['Date', 6, 30]]), ...table([1.1, 4, 2.2], ['Time', 'Focus block', 'Notes'], 17, 15, 80, HOURS)]),
  tp('monthly', 'Monthly calendar', 'Planning', 'blank', [T('Monthly calendar'), ...fields([['Month', 6, 30], ['Year', 40, 16]]), ['cal', 6, 17, 88, 62, 7, 6], ['b', 6, 81, 88, 14, 'Notes', 0]]),
  tp('year-glance', 'Year at a glance', 'Planning', 'blank', [T('Year at a glance'), ...fields([['Year', 6, 20]]), ...mat(4, 3, 6, 16.5, 88, 78, MONTHS, 0)]),
  tp('habit-31', 'Habit tracker (month)', 'Planning', 'blank', [T('Habit tracker'), ...fields([['Month', 6, 30]]), ...table([5, ...Array(31).fill(1)], ['Habit', ...nums(31)], 13, 17, 62)]),
  tp('habit-week', 'Habit tracker (week)', 'Planning', 'blank', [T('Weekly habits'), ...fields([['Week of', 6, 30]]), ...table([3, 1, 1, 1, 1, 1, 1, 1], ['Habit', ...DAYS], 11, 17, 60), ['b', 6, 80, 88, 15, 'Reflection', 0]]),
  tp('goals-smart', 'SMART goal', 'Planning', 'blank', [T('SMART goal'), ['f', 'My goal', 6, 14, 88], ...col(5, 6, 17, 88, 70, ['Specific', 'Measurable', 'Achievable', 'Relevant', 'Time-bound'], 0), ['f', 'First step', 6, 92, 55], ['f', 'Deadline', 66, 92, 28]]),
  tp('weekly-review', 'Weekly review', 'Planning', 'blank', [T('Weekly review'), ...fields([['Week of', 6, 30], ['Score /10', 70, 24]]), ...mat(2, 2, 6, 17, 88, 56, ['Wins', 'Challenges', 'Lessons', 'Next week'], 0), ['b', 6, 75, 88, 20, 'Top 3 for next week', 1], ['c', 9, 82, 82, 3, 34]]),
  tp('priority-matrix', 'Priority matrix', 'Planning', 'blank', [T('Priority matrix', 'Urgent / Important'), ...mat(2, 2, 10, 16, 84, 76, ['Do first', 'Schedule', 'Delegate', 'Eliminate'], 1), ['tx', 'URGENT', 30, 14, 11, 'a', 'center'], ['tx', 'NOT URGENT', 74, 14, 11, 'a', 'center'], ['tx', 'IMPORTANT', 8, 34, 11, 'a'], ['tx', 'NOT IMP.', 8, 72, 11, 'a']]),
  tp('project-timeline', 'Project timeline', 'Planning', 'blank', [T('Project timeline'), ...fields([['Project', 6, 50], ['Owner', 62, 32]]), ...table([3, ...Array(12).fill(1)], ['Task', ...nums(12).map((n) => 'W' + n)], 16, 16, 79)]),
  tp('brain-dump', 'Brain dump', 'Planning', 'blank', [T('Brain dump', 'Get it out of your head'), lined(18, 31, 34, 6, 88)]),
  tp('okr', 'OKR planner', 'Planning', 'blank', [T('OKR planner'), ...fields([['Quarter', 6, 24], ['Owner', 36, 30]]), ['b', 6, 17, 88, 12, 'Objective', 1], ...col(3, 6, 31, 88, 46, ['Key result 1', 'Key result 2', 'Key result 3'], 0), ['b', 6, 79, 88, 16, 'Initiatives', 0]]),
  tp('sprint-plan', 'Sprint plan', 'Planning', 'blank', [T('Sprint plan'), ...fields([['Sprint', 6, 20], ['Goal', 30, 64]]), ...row(3, 6, 17, 88, 78, ['Backlog', 'This sprint', 'Done'], 1)]),
  tp('quarter-plan', 'Quarter plan', 'Planning', 'blank', [T('Quarter plan'), ...fields([['Quarter', 6, 24]]), ...row(3, 6, 17, 88, 46, ['Month 1', 'Month 2', 'Month 3'], 0), ['b', 6, 65, 88, 30, 'Key goals', 1], ['c', 9, 73, 82, 4, 38]]),

  // ---------- work ----------
  tp('one-on-one', '1:1 meeting', 'Work', 'blank', [T('1:1 meeting'), ...fields([['With', 6, 40], ['Date', 52, 42]]), ...row(2, 6, 17, 88, 30, ['Their topics', 'My topics'], 0), ['b', 6, 49, 88, 18, 'Feedback', 0], ['b', 6, 69, 88, 26, 'Next steps', 1], ['c', 9, 77, 82, 3, 34]]),
  tp('standup', 'Daily standup', 'Work', 'blank', [T('Daily standup'), ...fields([['Date', 6, 30], ['Team', 40, 54]]), ...col(3, 6, 17, 88, 78, ['Yesterday', 'Today', 'Blockers'], 0)]),
  tp('agenda', 'Meeting agenda', 'Work', 'blank', [T('Meeting agenda'), ...fields([['Meeting', 6, 50], ['Date', 62, 32]]), ...table([0.6, 5, 1.4, 1.6], ['#', 'Topic', 'Owner', 'Time'], 12, 17, 70, nums(12)), ['b', 6, 89, 88, 6, '', 0]]),
  tp('kickoff', 'Project kickoff', 'Work', 'blank', [T('Project kickoff'), ...fields([['Project', 6, 50], ['Date', 62, 32]]), ...mat(3, 2, 6, 17, 88, 78, ['Goals', 'Scope', 'Stakeholders', 'Timeline', 'Risks', 'Next steps'], 0)]),
  tp('decision-log', 'Decision log', 'Work', 'blank', [T('Decision log'), ...table([1, 4, 2, 1.6], ['Date', 'Decision', 'Why', 'Owner'], 11, 14, 81)]),
  tp('retro', 'Retrospective', 'Work', 'blank', [T('Retrospective'), ...fields([['Sprint', 6, 24], ['Date', 36, 24]]), ...col(3, 6, 17, 88, 78, ['Start doing', 'Stop doing', 'Keep doing'], 0)]),
  tp('swot', 'SWOT analysis', 'Work', 'blank', [T('SWOT analysis'), ...fields([['Subject', 6, 60]]), ...mat(2, 2, 6, 17, 88, 78, ['Strengths', 'Weaknesses', 'Opportunities', 'Threats'], 1)]),
  tp('pros-cons', 'Pros and cons', 'Work', 'blank', [T('Pros & cons'), ['f', 'Decision', 6, 14, 88], ...row(2, 6, 17, 88, 66, ['Pros', 'Cons'], 0), ['b', 6, 85, 88, 10, 'Verdict', 1]]),
  tp('brainstorm', 'Brainstorm map', 'Work', 'blank', [T('Brainstorm'), ['o', 50, 54, 110, 56, 'Topic', 1], ...[[18, 30], [50, 24], [82, 30], [18, 80], [50, 86], [82, 80]].flatMap(([x, y]) => [['ln', 50, 54, x, y, 1], ['o', x, y, 78, 40, '', 0]])]),
  tp('call-notes', 'Call notes', 'Work', 'blank', [T('Call notes'), ...fields([['Contact', 6, 40], ['Company', 52, 42]]), ...fields([['Date', 6, 24], ['Phone', 36, 28], ['Duration', 70, 24]], 18.2), ['b', 6, 21, 88, 44, 'Notes', 0], ['b', 6, 67, 88, 14, 'Follow-up', 1], ['c', 9, 87, 82, 2, 34]]),
  tp('action-tracker', 'Action tracker', 'Work', 'blank', [T('Action tracker'), ...table([4, 1.6, 1.2, 1.2], ['Action', 'Owner', 'Due', 'Status'], 18, 14, 81)]),
  tp('interview', 'Interview notes', 'Work', 'blank', [T('Interview notes'), ...fields([['Candidate', 6, 40], ['Role', 52, 42]]), ...fields([['Date', 6, 24], ['Interviewer', 36, 58]], 18.2), ...row(2, 6, 21, 88, 28, ['Strengths', 'Concerns'], 0), ['b', 6, 51, 88, 28, 'Notes', 0], ...table([1, 1, 1, 1, 1], ['Skills', 'Comms', 'Culture', 'Fit', 'Overall'], 1, 81, 14)]),
  tp('client-notes', 'Client notes', 'Work', 'blank', [T('Client notes'), ...fields([['Client', 6, 40], ['Date', 52, 42]]), ['b', 6, 17, 88, 14, 'Requirements', 0], ['b', 6, 33, 88, 30, 'Discussion', 0], ['b', 6, 65, 88, 14, 'Agreed', 1], ['c', 9, 85, 82, 3, 34]]),
  tp('risk-register', 'Risk register', 'Work', 'blank', [T('Risk register'), ...table([0.5, 3, 1, 1, 2.4], ['#', 'Risk', 'Impact', 'Chance', 'Mitigation'], 14, 14, 81, nums(14))]),
  tp('user-story', 'User story', 'Work', 'blank', [T('User story'), ['b', 6, 14, 88, 12, 'As a', 1], ['b', 6, 28, 88, 12, 'I want', 1], ['b', 6, 42, 88, 12, 'So that', 1], ['b', 6, 56, 88, 39, 'Acceptance criteria', 0], ['c', 9, 66, 82, 6, 40]]),
  tp('weekly-status', 'Weekly status', 'Work', 'blank', [T('Weekly status'), ...fields([['Project', 6, 40], ['Week of', 52, 42]]), ...mat(2, 2, 6, 17, 88, 56, ['Done', 'In progress', 'Blocked', 'Next'], 0), ['b', 6, 75, 88, 20, 'Notes', 0]]),
  tp('kanban', 'Kanban board', 'Work', 'blank', [T('Kanban'), ...row(4, 6, 14, 88, 81, ['Backlog', 'To do', 'Doing', 'Done'], 1, 1.5)]),

  // ---------- study ----------
  tp('lecture', 'Lecture notes', 'Study', 'blank', [T('Lecture notes'), ...fields([['Subject', 6, 36], ['Date', 46, 20], ['Topic', 70, 24]]), ['b', 6, 17, 28, 78, 'Key terms', 1], lined(20, 24, 36, 38, 54)]),
  tp('study-plan', 'Study plan', 'Study', 'blank', [T('Study plan'), ...fields([['Week of', 6, 30], ['Goal', 40, 54]]), ...table([1.2, 2.4, 3, 1], ['Day', 'Subject', 'Topics', 'Hours'], 7, 17, 78, DAYS)]),
  tp('exam-revision', 'Exam revision', 'Study', 'blank', [T('Exam revision'), ...fields([['Subject', 6, 40], ['Exam date', 52, 42]]), ...table([4, 1, 1, 1, 1], ['Chapter', 'Read', 'Notes', 'Practice', 'Revised'], 16, 17, 78)]),
  tp('flashcards', 'Flashcards', 'Study', 'blank', [T('Flashcards', 'Fold in the middle'), ...mat(5, 2, 6, 14, 88, 81, [], 0, 2, 1.4), ...Array.from({ length: 5 }, (_, i) => ['ln', 6, 14 + 81 / 5 * i + 81 / 10 - 0.7, 94, 14 + 81 / 5 * i + 81 / 10 - 0.7, 1])]),
  tp('vocab', 'Vocabulary list', 'Study', 'blank', [T('Vocabulary'), ...table([1.6, 2, 3], ['Word', 'Meaning', 'Example'], 20, 14, 81)]),
  tp('book-notes', 'Book notes', 'Study', 'blank', [T('Book notes'), ...fields([['Title', 6, 46], ['Author', 58, 36]]), ['b', 6, 17, 88, 12, 'Why I read it', 1], ['b', 6, 31, 88, 30, 'Key ideas', 0], ['b', 6, 63, 88, 20, 'Favourite quotes', 0], ['b', 6, 85, 88, 10, 'Rating', 1]]),
  tp('math-practice', 'Math practice', 'Study', 'blank', [T('Math practice'), ...fields([['Topic', 6, 40], ['Date', 52, 20]]), ...mat(4, 2, 6, 17, 88, 78, nums(8), 0)]),
  tp('formula-sheet', 'Formula sheet', 'Study', 'blank', [T('Formula sheet'), ...fields([['Subject', 6, 40]]), ...mat(4, 2, 6, 17, 88, 78, ['', '', '', '', '', '', '', ''], 1)]),
  tp('mind-map', 'Mind map', 'Study', 'blank', [T('Mind map'), ['o', 50, 55, 120, 62, 'Central idea', 1], ...[[16, 28], [50, 22], [84, 28], [14, 55], [86, 55], [16, 82], [50, 88], [84, 82]].flatMap(([x, y]) => [['ln', 50, 55, x, y, 1], ['o', x, y, 70, 36, '', 0]])]),
  tp('concept-map', 'Concept map', 'Study', 'blank', [T('Concept map'), ['o', 50, 26, 100, 44, '', 1], ['o', 22, 52, 84, 38, '', 0], ['o', 78, 52, 84, 38, '', 0], ['o', 12, 80, 74, 34, '', 0], ['o', 38, 82, 74, 34, '', 0], ['o', 62, 82, 74, 34, '', 0], ['o', 88, 80, 74, 34, '', 0], ['ln', 50, 30, 22, 49, 1], ['ln', 50, 30, 78, 49, 1], ['ln', 22, 55, 12, 77], ['ln', 22, 55, 38, 79], ['ln', 78, 55, 62, 79], ['ln', 78, 55, 88, 77]]),
  tp('qa-notes', 'Question & answer', 'Study', 'blank', [T('Questions & answers'), ...fields([['Subject', 6, 40]]), ['v', 38, 16, 79], ['h', 6, 16, 88], ['tx', 'QUESTION', 8, 15.5, 10.5, 'a'], ['tx', 'ANSWER', 41, 15.5, 10.5, 'a'], lined(21, 28, 34, 6, 88)]),
  tp('lab-report', 'Lab report', 'Study', 'blank', [T('Lab report'), ...fields([['Experiment', 6, 50], ['Date', 62, 32]]), ['b', 6, 17, 88, 9, 'Aim', 1], ['b', 6, 28, 43, 22, 'Apparatus', 0], ['b', 51, 28, 43, 22, 'Procedure', 0], ['b', 6, 52, 88, 24, 'Observations', 0], ['b', 6, 78, 43, 17, 'Result', 1], ['b', 51, 78, 43, 17, 'Conclusion', 1]]),
  tp('essay-outline', 'Essay outline', 'Study', 'blank', [T('Essay outline'), ['f', 'Topic', 6, 14, 88], ['b', 6, 17, 88, 14, 'Thesis', 1], ...col(3, 6, 33, 88, 45, ['Body 1', 'Body 2', 'Body 3'], 0), ['b', 6, 80, 88, 15, 'Conclusion', 1]]),
  tp('assignment-tracker', 'Assignment tracker', 'Study', 'blank', [T('Assignments'), ...table([1.6, 3, 1.2, 1.2, 1], ['Subject', 'Task', 'Due', 'Marks', 'Done'], 19, 14, 81)]),
  tp('class-timetable', 'Class timetable', 'Study', 'blank', [T('Class timetable'), ...fields([['Term', 6, 30], ['Class', 40, 30]]), ...table([1.3, 1, 1, 1, 1, 1, 1], ['Period', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], 8, 17, 78, ['1', '2', '3', 'Break', '4', '5', '6', '7'])]),
  tp('history-timeline', 'Timeline', 'Study', 'blank', [T('Timeline'), ['ln', 50, 14, 50, 95], ...Array.from({ length: 8 }, (_, i) => { const y = 18 + i * 10, left = i % 2 === 0; return [['ln', 50, y, left ? 44 : 56, y], ['b', left ? 8 : 58, y - 3.6, 34, 7.2, '', 0]]; }).flat()]),
  tp('revision-checklist', 'Revision checklist', 'Study', 'blank', [T('Revision checklist'), ...fields([['Subject', 6, 40], ['Exam', 52, 42]]), ['c', 8, 20, 40, 26, 34], ['c', 54, 20, 38, 26, 34]]),
  tp('definitions', 'Definitions', 'Study', 'blank', [T('Definitions'), ...table([1.4, 3.6], ['Term', 'Definition'], 14, 14, 81)]),

  // ---------- accounting ----------
  tp('journal-entry', 'Journal entries', 'Accounting', 'blank', [T('Journal', 'Rs.'), ...table([1, 4.2, 0.7, 1.5, 1.5], ['Date', 'Particulars', 'L.F.', 'Dr', 'Cr'], 20, 14, 81)]),
  tp('t-accounts', 'T-accounts', 'Accounting', 'blank', [T('T-accounts'), ...mat(3, 2, 6, 14, 88, 81, ['', '', '', '', '', ''], 0), ...[0, 1, 2].flatMap((r) => [0, 1].flatMap((c) => { const x = 6 + c * 45, y = 14 + r * 27.4; return [['h', x + 1, y + 7, 42], ['v', x + 22, y + 7, 18], ['tx', 'DR', x + 11, y + 5.8, 10.5, 'a', 'center'], ['tx', 'CR', x + 33, y + 5.8, 10.5, 'a', 'center']]; }))]),
  tp('ledger', 'Ledger account', 'Accounting', 'blank', [T('Ledger'), ...fields([['Account', 6, 50], ['Folio', 62, 32]]), ...table([1, 2.4, 0.6, 1.4, 1, 2.4, 0.6, 1.4], ['Date', 'Particulars', 'J.F.', 'Dr', 'Date', 'Particulars', 'J.F.', 'Cr'], 22, 17, 78)]),
  tp('trial-balance', 'Trial balance', 'Accounting', 'blank', [T('Trial balance'), ...fields([['As on', 6, 30]]), ...table([4, 0.8, 1.6, 1.6], ['Particulars', 'L.F.', 'Debit', 'Credit'], 20, 17, 72), ['b', 6, 91, 88, 4.5, '', 1]]),
  tp('cash-book', 'Cash book', 'Accounting', 'blank', [T('Cash book (double column)'), ...table([1, 2.2, 0.5, 1.2, 1.2, 1, 2.2, 0.5, 1.2, 1.2], ['Date', 'Particulars', 'L.F.', 'Cash', 'Bank', 'Date', 'Particulars', 'L.F.', 'Cash', 'Bank'], 22, 14, 81)]),
  tp('bank-recon', 'Bank reconciliation', 'Accounting', 'blank', [T('Bank reconciliation'), ...fields([['As on', 6, 30], ['Bank', 40, 54]]), ...table([5, 1.6], ['Particulars', 'Amount'], 18, 17, 72), ['b', 6, 91, 88, 4.5, '', 1]]),
  tp('balance-sheet', 'Balance sheet', 'Accounting', 'blank', [T('Balance sheet'), ...fields([['As on', 6, 30], ['Firm', 40, 54]]), ...table([3.2, 1.2, 3.2, 1.2], ['Liabilities', 'Rs.', 'Assets', 'Rs.'], 18, 17, 72), ['b', 6, 91, 88, 4.5, 'Total', 1]]),
  tp('pnl', 'Trading & P&L', 'Accounting', 'blank', [T('Trading and profit & loss'), ...fields([['For the year ended', 6, 36]]), ...table([3.2, 1.2, 3.2, 1.2], ['Particulars', 'Rs.', 'Particulars', 'Rs.'], 20, 17, 78)]),
  tp('cash-flow', 'Cash flow statement', 'Accounting', 'blank', [T('Cash flow statement'), ...fields([['Year', 6, 24]]), ...col(3, 6, 17, 88, 70, ['Operating activities', 'Investing activities', 'Financing activities'], 0), ['b', 6, 89, 88, 6, 'Net change in cash', 1]]),
  tp('gst-calc', 'GST working', 'Accounting', 'blank', [T('GST working'), ...fields([['Month', 6, 24], ['GSTIN', 36, 58]]), ...table([1.3, 1.4, 1.3, 1, 1, 1, 1.2], ['Invoice', 'Party', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total'], 18, 17, 78)]),
  tp('tds-tracker', 'TDS tracker', 'Accounting', 'blank', [T('TDS tracker'), ...table([1, 2.4, 1, 1.4, 0.8, 1.2], ['Date', 'Party / PAN', 'Section', 'Amount', '%', 'TDS'], 20, 14, 81)]),
  tp('depreciation', 'Depreciation schedule', 'Accounting', 'blank', [T('Depreciation schedule'), ...table([2.4, 1.2, 0.8, 1.2, 1.2, 1.2], ['Asset', 'Cost', 'Rate', 'Year 1', 'Year 2', 'Year 3'], 14, 14, 81)]),
  tp('ratio-analysis', 'Ratio analysis', 'Accounting', 'blank', [T('Ratio analysis'), ...table([2.4, 3, 1.2, 1.2], ['Ratio', 'Formula', 'This yr', 'Last yr'], 14, 14, 81)]),
  tp('audit-wp', 'Audit working paper', 'Accounting', 'blank', [T('Audit working paper'), ...fields([['Client', 6, 40], ['Period', 52, 20], ['Ref', 78, 16]]), ...fields([['Prepared by', 6, 40], ['Reviewed by', 52, 42]], 18.2), ['b', 6, 21, 88, 10, 'Objective', 1], ['b', 6, 33, 88, 20, 'Procedure performed', 0], ['b', 6, 55, 88, 24, 'Findings', 0], ['b', 6, 81, 88, 14, 'Conclusion', 1]]),
  tp('tax-computation', 'Tax computation', 'Accounting', 'blank', [T('Computation of total income'), ...fields([['Assessee', 6, 50], ['A.Y.', 62, 32]]), ...table([4.5, 1.4, 1.4], ['Heads of income', 'Details', 'Amount'], 12, 17, 78, ['Salary', 'House property', 'Business / profession', 'Capital gains', 'Other sources', 'Gross total income', 'Less: Chapter VI-A', 'Total income', 'Tax', 'Cess', 'Less: TDS / advance tax', 'Net payable'])]),
  tp('partnership', 'Partners capital', 'Accounting', 'blank', [T('Partners capital accounts'), ...table([3, 1.4, 1.4, 1.4], ['Particulars', 'A', 'B', 'C'], 18, 14, 81)]),
  tp('stock-card', 'Stock ledger card', 'Accounting', 'blank', [T('Stock ledger'), ...fields([['Item', 6, 50], ['Unit', 62, 32]]), ...table([1, 2, 1, 1, 1, 1, 1, 1, 1], ['Date', 'Ref', 'In qty', 'Rate', 'Out qty', 'Rate', 'Bal qty', 'Rate', 'Value'], 18, 17, 78)]),
  tp('invoice', 'Invoice', 'Accounting', 'blank', [T('Invoice'), ...fields([['Bill to', 6, 46], ['Invoice no.', 58, 36]]), ...fields([['Address', 6, 46], ['Date', 58, 36]], 18.2), ...table([0.5, 4, 1, 1, 1.4], ['#', 'Description', 'Qty', 'Rate', 'Amount'], 9, 22, 56), ['b', 60, 80, 34, 14, 'Total', 1], ['f', 'Signature', 6, 92, 30]]),
  tp('voucher', 'Expense voucher', 'Accounting', 'blank', [T('Expense voucher'), ...fields([['Voucher no.', 6, 30], ['Date', 66, 28]]), ['f', 'Paid to', 6, 20, 88], ['f', 'On account of', 6, 26, 88], ['f', 'Amount (in words)', 6, 32, 70], ['b', 78, 28, 16, 6, 'Rs.', 1], ...table([4, 1.4], ['Particulars', 'Amount'], 6, 38, 36), ['f', 'Receiver', 6, 90, 26], ['f', 'Authorised', 40, 90, 26], ['f', 'Cashier', 74, 90, 20]]),

  // ---------- writing ----------
  tp('gratitude', 'Gratitude journal', 'Writing', 'blank', [T('Gratitude'), ...fields([['Date', 6, 30]]), ...col(3, 6, 17, 88, 36, ['I am grateful for', '', ''], 1), ['b', 6, 55, 88, 18, 'One good thing today', 0], ['b', 6, 75, 88, 20, 'Tomorrow I will', 0]]),
  tp('diary', 'Diary page', 'Writing', 'blank', [T('Dear diary'), ...fields([['Date', 6, 28], ['Weather', 38, 22], ['Mood', 64, 30]]), lined(19, 31, 33)]),
  tp('story-plan', 'Story planner', 'Writing', 'blank', [T('Story planner'), ...fields([['Title', 6, 56], ['Genre', 68, 26]]), ['b', 6, 17, 43, 18, 'Setting', 0], ['b', 51, 17, 43, 18, 'Characters', 0], ['b', 6, 37, 88, 12, 'Conflict', 1], ...row(3, 6, 51, 88, 44, ['Beginning', 'Middle', 'End'], 0)]),
  tp('character-sheet', 'Character sheet', 'Writing', 'blank', [T('Character sheet'), ['b', 6, 14, 24, 22, 'Portrait', 0], ...fields([['Name', 34, 60], ['Age', 34, 26]], 20), ['f', 'Role', 64, 26, 30], ['f', 'Goal', 34, 32, 60], ['b', 6, 38, 43, 26, 'Appearance', 0], ['b', 51, 38, 43, 26, 'Personality', 0], ['b', 6, 66, 43, 29, 'Backstory', 0], ['b', 51, 66, 43, 29, 'Relationships', 0]]),
  tp('blog-plan', 'Blog post plan', 'Writing', 'blank', [T('Blog post plan'), ['f', 'Headline', 6, 14, 88], ['f', 'Audience', 6, 20, 50], ['f', 'Keyword', 62, 20, 32], ['b', 6, 23, 88, 14, 'Hook', 1], ['b', 6, 39, 88, 34, 'Main points', 0], ['b', 6, 75, 88, 12, 'Call to action', 1], ['f', 'Publish date', 6, 93, 30]]),
  tp('poem', 'Poem page', 'Writing', 'blank', [['tx', 'TITLE', 50, 10, 12, 'a', 'center'], ['h', 30, 11.5, 40], lined(18, 28, 38, 14, 72)]),
  tp('lyrics', 'Lyrics sheet', 'Writing', 'blank', [T('Lyrics'), ...fields([['Song', 6, 40], ['Key', 52, 16], ['BPM', 74, 20]]), ...mat(4, 2, 6, 17, 88, 78, ['Verse 1', 'Chorus', 'Verse 2', 'Bridge', 'Verse 3', 'Chorus', 'Outro', 'Notes'], 0)]),
  tp('screenplay', 'Screenplay scene', 'Writing', 'blank', [T('Scene'), ...fields([['Scene #', 6, 14], ['INT / EXT', 24, 18], ['Location', 46, 30], ['Time', 80, 14]]), ['b', 6, 17, 88, 8, 'Action', 1], ['v', 30, 27, 68], lined(28, 28, 34, 6, 88)]),
  tp('letter', 'Letter', 'Writing', 'blank', [['f', 'Date', 66, 10, 28], ['f', 'To', 6, 18, 50], lined(26, 28, 34, 6, 88), ['f', 'Signed', 62, 94, 32]]),
  tp('outline-bullets', 'Outline', 'Writing', 'blank', [T('Outline'), ...[0, 1, 2, 3, 4].flatMap((i) => { const y = 18 + i * 15.6; return [['tx', String(i + 1) + '.', 6, y, 14, 'a'], ['h', 9, y + 0.4, 85], ['h', 13, y + 4.2, 81], ['h', 13, y + 8, 81], ['h', 13, y + 11.8, 81]]; })]),

  // ---------- design ----------
  tp('wire-mobile', 'Mobile wireframes', 'Design', 'dot', [T('Mobile wireframes'), ...phone(6, 16, 26, 74), ...phone(37, 16, 26, 74), ...phone(68, 16, 26, 74), ['f', 'Screen', 6, 93, 26], ['f', 'Screen', 37, 93, 26], ['f', 'Screen', 68, 93, 26]]),
  tp('wire-web', 'Web wireframe', 'Design', 'dot', [T('Web wireframe'), ['b', 6, 14, 88, 80, '', 0], ['h', 6, 19.5, 88], ['o', 9.5, 16.7, 6, 6], ['o', 12.3, 16.7, 6, 6], ['o', 15.1, 16.7, 6, 6], ['b', 22, 15.3, 50, 2.8, '', 1], ['b', 9, 22, 82, 22, 'Hero', 1], ...row(3, 9, 47, 82, 18, ['', '', ''], 0), ['b', 9, 68, 82, 22, 'Content', 0]]),
  tp('storyboard', 'Storyboard', 'Design', 'blank', [T('Storyboard'), ...mat(3, 2, 6, 14, 88, 81, [], 0, 3, 2).flatMap((b) => [b, ['l', b[1] + 1, b[2] + b[4] - 4.2, b[3] - 2, 2, 22]]) ]),
  tp('comic', 'Comic panels', 'Design', 'blank', [T('Comic page'), ['b', 6, 14, 55, 28, '', 0], ['b', 63, 14, 31, 28, '', 0], ['b', 6, 44, 31, 24, '', 0], ['b', 39, 44, 55, 24, '', 0], ['b', 6, 70, 88, 25, '', 0]]),
  tp('ui-flow', 'User flow', 'Design', 'dot', [T('User flow'), ...[[8, 22], [38, 22], [68, 22], [8, 52], [38, 52], [68, 52], [38, 82]].map(([x, y]) => ['b', x, y - 7, 24, 14, '', 0]), ['ln', 32, 22, 38, 22], ['ln', 62, 22, 68, 22], ['ln', 20, 29, 20, 45], ['ln', 50, 29, 50, 45], ['ln', 80, 29, 80, 45], ['ln', 50, 59, 50, 75]]),
  tp('logo-grid', 'Logo sketches', 'Design', 'blank', [T('Logo sketches'), ['f', 'Brand', 6, 14, 50], ...mat(4, 3, 6, 17, 88, 78, [], 0)]),
  tp('handwriting', 'Handwriting practice', 'Design', 'blank', [T('Handwriting practice'), ...Array.from({ length: 11 }, (_, i) => { const y = 16 + i * 7.5; return [['ln', 6, y, 94, y], ['ln', 6, y + 2.4, 94, y + 2.4, 1], ['ln', 6, y + 4.8, 94, y + 4.8]]; }).flat()]),
  tp('calligraphy', 'Calligraphy guides', 'Design', 'blank', [T('Calligraphy'), ...Array.from({ length: 9 }, (_, i) => { const y = 17 + i * 9.2; return [['ln', 6, y, 94, y], ['ln', 6, y + 3, 94, y + 3, 1], ['ln', 6, y + 6, 94, y + 6], ...Array.from({ length: 15 }, (_, j) => ['ln', 8 + j * 6, y + 6.6, 12 + j * 6, y - 0.6, 1])]; }).flat()]),
  tp('floor-plan', 'Floor plan', 'Design', 'blank', [T('Floor plan', '1 square = 1 ft'), ['gr', 6, 14, 88, 80, 26], ['f', 'Room', 6, 96, 40], ['f', 'Scale', 56, 96, 38]]),
  tp('mood-board', 'Mood board', 'Design', 'blank', [T('Mood board'), ['f', 'Project', 6, 14, 50], ['b', 6, 17, 56, 38, '', 0], ['b', 64, 17, 30, 18, '', 0], ['b', 64, 37, 30, 18, '', 0], ['b', 6, 57, 28, 20, '', 0], ['b', 36, 57, 28, 20, '', 0], ['b', 66, 57, 28, 20, '', 0], ...[0, 1, 2, 3, 4].map((i) => ['o', 12 + i * 7, 87, 22, 22, '', i % 2]), ['tx', 'PALETTE', 6, 80.5, 10.5, 'a']]),
  tp('thumbnails', 'Thumbnail sketches', 'Design', 'blank', [T('Thumbnails'), ...mat(4, 3, 6, 14, 88, 81, [], 0, 2, 1.4).flatMap((b) => [b, ['l', b[1] + 1, b[2] + b[4] + 0.1, 0, 0, 0]]).filter((o) => o[0] === 'b')]),
  tp('palette', 'Colour palette', 'Design', 'blank', [T('Colour palette'), ['f', 'Project', 6, 14, 50], ...Array.from({ length: 12 }, (_, i) => { const x = 14 + (i % 4) * 22, y = 26 + Math.floor(i / 4) * 22; return [['o', x, y, 44, 44, '', i % 2], ['f', 'Code', x - 8, y + 12, 16]]; }).flat()]),
  tp('icon-grid', 'Icon grid', 'Design', 'dot', [T('Icon sketches'), ...mat(5, 4, 6, 14, 88, 81, [], 0, 2, 1.4)]),

  // ---------- math & science ----------
  tp('axes', 'Coordinate plane', 'Math & Science', 'blank', [T('Coordinate plane'), ['ax', 6, 14, 88, 80, 27]]),
  tp('axes-4', 'Four graphs', 'Math & Science', 'blank', [T('Graphs'), ['ax', 6, 14, 43, 38, 24], ['ax', 51, 14, 43, 38, 24], ['ax', 6, 56, 43, 38, 24], ['ax', 51, 56, 43, 38, 24]]),
  tp('number-line', 'Number lines', 'Math & Science', 'blank', [T('Number lines'), ...Array.from({ length: 8 }, (_, i) => { const y = 20 + i * 10; return [['ln', 7, y, 93, y], ...Array.from({ length: 21 }, (_, j) => ['ln', 8 + j * 4.2, y - 1, 8 + j * 4.2, y + 1])]; }).flat()]),
  tp('truth-table', 'Truth table', 'Math & Science', 'blank', [T('Truth table'), ...table([1, 1, 1, 1, 1], ['A', 'B', 'A and B', 'A or B', 'not A'], 8, 14, 50, ['', '', '', '', '', '', '', '']), ['b', 6, 66, 88, 29, 'Working', 0]]),
  tp('guitar-tab', 'Guitar tab', 'Math & Science', 'blank', [T('Guitar tab'), ...fields([['Song', 6, 50], ['Tuning', 62, 32]]), ...Array.from({ length: 6 }, (_, k) => { const y0 = 20 + k * 13; return [...[0, 1, 2, 3, 4, 5].map((i) => ['ln', 6, y0 + i * 1.6, 94, y0 + i * 1.6]), ['tx', 'T', 4.2, y0 + 2.4, 10, 'a'], ['tx', 'A', 4.2, y0 + 4.2, 10, 'a'], ['tx', 'B', 4.2, y0 + 6, 10, 'a']]; }).flat()]),
  tp('engineering', 'Engineering grid', 'Math & Science', 'blank', [['gr', 4, 4, 92, 88, 16], ['b', 4, 93, 92, 4.5, '', 0], ['tx', 'TITLE', 6, 96, 10, 'a'], ['tx', 'SCALE', 40, 96, 10, 'a'], ['tx', 'DATE', 62, 96, 10, 'a'], ['tx', 'SHEET', 82, 96, 10, 'a']]),
  tp('geometry', 'Geometry dots', 'Math & Science', 'dot', [T('Geometry'), ['f', 'Problem', 6, 14, 60], ['d', 6, 17, 88, 78, 30]]),
  tp('experiment-log', 'Experiment log', 'Math & Science', 'blank', [T('Experiment log'), ...fields([['Title', 6, 50], ['Date', 62, 32]]), ['b', 6, 17, 88, 10, 'Hypothesis', 1], ['b', 6, 29, 43, 22, 'Variables', 0], ['b', 51, 29, 43, 22, 'Materials', 0], ...table([1, 1, 1, 1, 1], ['Trial', 'Input', 'Output', 'Note', 'Avg'], 5, 53, 25), ['b', 6, 80, 88, 15, 'Conclusion', 1]]),
  tp('physics-problem', 'Physics problem', 'Math & Science', 'blank', [T('Problem solving'), ['b', 6, 14, 88, 12, 'Question', 1], ['b', 6, 28, 28, 22, 'Given', 0], ['b', 36, 28, 28, 22, 'Find', 0], ['b', 66, 28, 28, 22, 'Formulas', 0], ['b', 6, 52, 43, 28, 'Diagram', 0], ['b', 51, 52, 43, 28, 'Solution', 0], ['b', 6, 82, 88, 13, 'Answer', 1]]),
  tp('chem-equations', 'Chemical equations', 'Math & Science', 'blank', [T('Chemical equations'), ...Array.from({ length: 10 }, (_, i) => { const y = 18 + i * 8; return [['h', 6, y + 4, 88], ['tx', '→', 50, y + 2.4, 18, 'a', 'center'], ['tx', String(i + 1), 6, y + 2.4, 11, 'm']]; }).flat()]),

  // ---------- personal ----------
  tp('meal-plan', 'Meal planner', 'Personal', 'blank', [T('Meal planner'), ...fields([['Week of', 6, 30]]), ...table([1.2, 2, 2, 2, 1.4], ['Day', 'Breakfast', 'Lunch', 'Dinner', 'Snacks'], 7, 17, 60, DAYS), ['b', 6, 79, 88, 16, 'Groceries', 1]]),
  tp('workout-log', 'Workout log', 'Personal', 'blank', [T('Workout log'), ...fields([['Date', 6, 24], ['Focus', 36, 30], ['Duration', 72, 22]]), ...table([3, 1, 1, 1, 1, 1], ['Exercise', 'Set 1', 'Set 2', 'Set 3', 'Set 4', 'Notes'], 12, 17, 66), ['b', 6, 85, 88, 10, 'Notes', 0]]),
  tp('budget', 'Monthly budget', 'Personal', 'blank', [T('Monthly budget'), ...fields([['Month', 6, 30], ['Income', 66, 28]]), ...table([3, 1.4, 1.4, 1.4], ['Category', 'Planned', 'Actual', 'Diff'], 14, 17, 78)]),
  tp('expense-tracker', 'Expense tracker', 'Personal', 'blank', [T('Expenses'), ...table([1, 3, 1.6, 1.4], ['Date', 'Item', 'Category', 'Amount'], 24, 14, 81)]),
  tp('shopping', 'Shopping list', 'Personal', 'blank', [T('Shopping list'), ...fields([['Store', 6, 40], ['Date', 52, 30]]), ['c', 7, 20, 40, 24, 34], ['c', 54, 20, 40, 24, 34]]),
  tp('trip-plan', 'Trip planner', 'Personal', 'blank', [T('Trip planner'), ...fields([['Destination', 6, 44], ['Dates', 56, 38]]), ...mat(2, 2, 6, 17, 88, 38, ['Stay', 'Transport', 'Places to visit', 'Food'], 0), ['b', 6, 57, 88, 12, 'Budget', 1], ['b', 6, 71, 88, 24, 'Day by day', 0]]),
  tp('packing', 'Packing list', 'Personal', 'blank', [T('Packing list'), ...fields([['Trip', 6, 40], ['Dates', 52, 40]]), ...row(2, 6, 17, 43, 78, ['Clothes', 'Toiletries'], 0).slice(0, 0), ['b', 6, 17, 43, 36, 'Clothes', 0], ['b', 51, 17, 43, 36, 'Toiletries', 0], ['b', 6, 55, 43, 40, 'Documents', 0], ['b', 51, 55, 43, 40, 'Electronics', 0], ['c', 9, 25, 37, 8, 36], ['c', 54, 25, 37, 8, 36], ['c', 9, 63, 37, 9, 36], ['c', 54, 63, 37, 9, 36]]),
  tp('reading-list', 'Reading list', 'Personal', 'blank', [T('Reading list'), ...table([3.2, 2, 1, 1], ['Title', 'Author', 'Read', 'Rating'], 18, 14, 81)]),
  tp('watchlist', 'Watchlist', 'Personal', 'blank', [T('Watchlist'), ...table([3.4, 1.6, 1, 1], ['Title', 'Where', 'Watched', 'Stars'], 18, 14, 81)]),
  tp('sleep-tracker', 'Sleep tracker', 'Personal', 'blank', [T('Sleep tracker'), ...fields([['Month', 6, 30]]), ...table([1, 1.6, 1.6, 1.4, 1.4, 2], ['Day', 'Bed', 'Wake', 'Hours', 'Quality', 'Notes'], 16, 17, 78)]),
  tp('water-tracker', 'Water tracker', 'Personal', 'blank', [T('Water tracker'), ...fields([['Month', 6, 30], ['Goal', 40, 20]]), ...table([1, 1, 1, 1, 1, 1, 1, 1, 1], ['Day', '1', '2', '3', '4', '5', '6', '7', '8'], 16, 17, 78)]),
  tp('gift-list', 'Gift list', 'Personal', 'blank', [T('Gift list'), ...table([2, 3, 1.2, 1], ['For', 'Idea', 'Budget', 'Bought'], 16, 14, 81)]),
  tp('contacts', 'Contacts', 'Personal', 'blank', [T('Contacts'), ...table([2, 1.8, 2.4, 1.4], ['Name', 'Phone', 'Email', 'Notes'], 16, 14, 81)]),
  tp('medication', 'Medication log', 'Personal', 'blank', [T('Medication log'), ...fields([['Name', 6, 40]]), ...table([2.4, 1.2, 1, 1, 1, 1], ['Medicine', 'Dose', 'Morning', 'Noon', 'Night', 'Notes'], 12, 17, 78)]),
  tp('home-maintenance', 'Home maintenance', 'Personal', 'blank', [T('Home maintenance'), ...table([3, 1.4, 1.4, 1], ['Task', 'Last done', 'Next due', 'Done'], 16, 14, 81)]),
  tp('chores', 'Weekly chores', 'Personal', 'blank', [T('Weekly chores'), ...fields([['Week of', 6, 30]]), ...table([3, 1, 1, 1, 1, 1, 1, 1], ['Chore', ...DAYS], 14, 17, 78)]),
  tp('mood-tracker', 'Mood tracker', 'Personal', 'blank', [T('Mood tracker'), ...fields([['Month', 6, 30]]), ...mat(5, 7, 6, 17, 88, 60, nums(35).map((n) => (n <= 31 ? n : '')), 0, 1.4, 1.2), ['b', 6, 80, 88, 15, 'Patterns', 1]]),
  tp('savings-goal', 'Savings goal', 'Personal', 'blank', [T('Savings goal'), ...fields([['Goal', 6, 50], ['Target', 62, 32]]), ...mat(5, 6, 6, 17, 88, 56, nums(30), 0, 1.2, 1.2), ['b', 6, 75, 88, 20, 'Plan', 1]]),
  tp('bill-calendar', 'Bill calendar', 'Personal', 'blank', [T('Bills'), ...table([3, 1.4, 1.4, 1], ['Bill', 'Due', 'Amount', 'Paid'], 16, 14, 81)]),
  tp('birthdays', 'Birthdays', 'Personal', 'blank', [T('Birthdays'), ...mat(4, 3, 6, 14, 88, 81, MONTHS, 0)]),
  tp('wedding', 'Wedding checklist', 'Personal', 'blank', [T('Wedding checklist'), ...fields([['Date', 6, 30], ['Budget', 40, 30]]), ['c', 7, 20, 40, 24, 34], ['c', 54, 20, 38, 24, 34]]),
];

/** id -> ops, used by the paper renderer */
export const LAYOUTS = Object.fromEntries(TEMPLATE_LIST.filter((t) => t.ops).map((t) => [t.id, t.ops]));
