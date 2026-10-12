import { getMeta, setMeta, newId } from '../core/db.js';
import { debounce } from '../core/utils.js';
import { emit } from '../core/store.js';

/* Study Hub data lives in one meta record ('study:data'), local to this device.
   Plain-English structure only: subject and chapter names are editable starting points. */
const CH = (s) => s.split('|').map((n) => ({ id: newId(), name: n.trim(), read: false, revised: false, practiced: false }));
export const LEVELS = [['foundation', 'Foundation'], ['inter', 'Intermediate'], ['final', 'Final']];
export const SCHEMES = [['new2023', 'New scheme (2023)'], ['old', 'Old scheme']];
export const NOTICE = 'Structure, marks and rules are editable starting points. Always verify with the latest ICAI notification.';
/* chapter names only: short topic labels, editable */
const T = {
  'Accounting': 'Accounting basics|Journal and ledger|Subsidiary books|Bank reconciliation|Trial balance|Depreciation and inventory|Final accounts|Partnership|Company accounts basics|Not-for-profit accounts',
  'Business Laws': 'Contract formation|Performance and discharge|Special contracts|Sale of goods|Partnership law|LLP|Company law basics',
  'Quantitative Aptitude': 'Ratio and proportion|Equations|Time value of money|Permutations and combinations|Sequences and series|Sets and functions|Calculus basics|Descriptive statistics|Correlation and regression|Probability|Number series and coding|Direction and blood relations|Logical reasoning',
  'Business Economics and BCK': 'Demand and supply|Production and cost|Price determination|Market structures|National income|Money and banking|Business cycles|Business communication|Business and commercial knowledge',
  'Advanced Accounting': 'Accounting standards|Company accounts|Share capital and debentures|Amalgamation and restructuring|Branch accounts|Departmental accounts|Financial statements',
  'Corporate and Other Laws': 'Company incorporation|Share capital and debentures|Directors and KMP|Meetings|Accounts, audit and dividend|Winding up basics|Other laws and FEMA basics',
  'Taxation': 'Basics and residential status|Salary|House property|Business and profession|Capital gains|Other sources and clubbing|Deductions and computation|GST levy and supply|Time and value of supply|Input tax credit|Registration, returns and payment',
  'Cost and Management Accounting': 'Cost concepts|Material cost|Labour cost|Overheads|Job and batch costing|Process costing|Marginal costing|Standard costing|Budgetary control',
  'Auditing and Ethics': 'Nature of audit|Audit planning and risk|Internal control|Vouching and verification|Audit evidence|Company audit|Audit reports|Professional ethics',
  'Financial and Strategic Management': 'Financial leverage|Capital structure|Cost of capital|Capital budgeting|Working capital|Dividend decisions|Strategic analysis|Strategy implementation',
  'Financial Reporting': 'Ind AS framework|Revenue|Leases|Financial instruments|Consolidated statements|Business combinations|Share-based payment',
  'Advanced Financial Management': 'Risk and return|Derivatives|Portfolio theory|Mergers and valuation|Forex and treasury|Capital budgeting under risk|Mutual funds',
  'Advanced Auditing, Assurance and Professional Ethics': 'Standards on auditing|Risk assessment|Group audits|Special audits|Assurance engagements|Ethics and conduct',
  'Direct Tax Laws and International Taxation': 'Assessment and appeals|Deductions and exemptions|Clubbing and set-off|International taxation|Transfer pricing|Anti-avoidance',
  'Indirect Tax Laws': 'GST framework|Time and place of supply|Valuation|Input tax credit|Refunds and demands|Customs basics|Foreign trade policy',
  'Integrated Business Solutions': 'Case study approach|Integrated accounting and tax|Audit and law application|Strategic decisions',
  'Accounting (Inter)': 'Accounting standards|Company accounts|Financial statements|Branch and departmental accounts|Partnership and LLP',
  'Auditing and Assurance': 'Audit planning|Internal control|Audit evidence|Company audit|Audit reports|Assurance basics',
  'Enterprise Information Systems and Strategic Management': 'Business processes and ERP|IT controls|Cyber basics|Strategic analysis|Strategy implementation',
  'Financial Management and Economics for Finance': 'Time value of money|Cost of capital|Capital budgeting|Working capital|Economic indicators|Public finance|International economics',
  'Strategic Financial Management': 'Risk and return|Derivatives|Portfolio management|Mergers and acquisitions|Forex|Mutual funds',
  'Advanced Auditing and Professional Ethics': 'Standards on auditing|Group audits|Special audits|Ethics and conduct',
  'Corporate and Economic Laws': 'Company law|Securities laws|FEMA|Competition law|Insolvency and other laws',
  'Strategic Cost Management and Performance Evaluation': 'Strategic cost analysis|Target costing|Activity based costing|Pricing decisions|Performance measures|Transfer pricing|Decision models',
  'Elective Paper': 'Chosen elective: add your chapters',
};
const SUB = (level, group, name, w = 1) => ({ id: newId(), level, group, name, marks: 100, weight: w, chapters: CH(T[name] || ''), material: {} });
export function seedSubjects(scheme = 'new2023') {
  const f = [SUB('foundation', 'Papers', 'Accounting', 1.2), SUB('foundation', 'Papers', 'Business Laws'), SUB('foundation', 'Papers', 'Quantitative Aptitude', 1.2), SUB('foundation', 'Papers', 'Business Economics and BCK')];
  if (scheme === 'old') return [...f,
    SUB('inter', 'Group I', 'Accounting', 1.2), SUB('inter', 'Group I', 'Corporate and Other Laws'), SUB('inter', 'Group I', 'Cost and Management Accounting', 1.2), SUB('inter', 'Group I', 'Taxation', 1.3),
    SUB('inter', 'Group II', 'Advanced Accounting', 1.3), SUB('inter', 'Group II', 'Auditing and Assurance'), SUB('inter', 'Group II', 'Enterprise Information Systems and Strategic Management'), SUB('inter', 'Group II', 'Financial Management and Economics for Finance'),
    SUB('final', 'Group I', 'Financial Reporting', 1.3), SUB('final', 'Group I', 'Strategic Financial Management', 1.3), SUB('final', 'Group I', 'Advanced Auditing and Professional Ethics'), SUB('final', 'Group I', 'Corporate and Economic Laws'),
    SUB('final', 'Group II', 'Strategic Cost Management and Performance Evaluation', 1.2), SUB('final', 'Group II', 'Elective Paper'), SUB('final', 'Group II', 'Direct Tax Laws and International Taxation', 1.3), SUB('final', 'Group II', 'Indirect Tax Laws', 1.2)];
  return [...f,
    SUB('inter', 'Group I', 'Advanced Accounting', 1.3), SUB('inter', 'Group I', 'Corporate and Other Laws'), SUB('inter', 'Group I', 'Taxation', 1.3),
    SUB('inter', 'Group II', 'Cost and Management Accounting', 1.2), SUB('inter', 'Group II', 'Auditing and Ethics'), SUB('inter', 'Group II', 'Financial and Strategic Management'),
    SUB('final', 'Group I', 'Financial Reporting', 1.3), SUB('final', 'Group I', 'Advanced Financial Management', 1.3), SUB('final', 'Group I', 'Advanced Auditing, Assurance and Professional Ethics'),
    SUB('final', 'Group II', 'Direct Tax Laws and International Taxation', 1.3), SUB('final', 'Group II', 'Indirect Tax Laws', 1.2), SUB('final', 'Group II', 'Integrated Business Solutions', 1.1)];
}
/** next May or November (placeholder date, 1st of month, flagged as an estimate) */
export function defaultExam() {
  const t = today(); const y = +t.slice(0, 4);
  const cands = [[`${y}-05-01`, 'May', y], [`${y}-11-01`, 'November', y], [`${y + 1}-05-01`, 'May', y + 1]];
  const c = cands.find((x) => x[0] > t) || cands[2];
  return { label: `${c[1]} ${c[2]}`, session: c[1], year: c[2], date: c[0], estimated: true };
}
const blank = () => ({
  v: 2, level: 'inter', scheme: 'new2023', groups: { 'Group I': true, 'Group II': true }, subjects: seedSubjects('new2023'), exam: defaultExam(),
  rules: { passPaper: 40, passAggregate: 50, negativeMarking: 'Objective papers may carry negative marking. Edit as per the current ICAI notification.' },
  plan: { dailyMinutes: 480, weeklyChapters: 5, bufferDays: 5, holidays: [], tasks: [] },
  taxTable: { fy: '2025-26', regime: 'New regime (editable)', slabs: [[400000, 0], [800000, 5], [1200000, 10], [1600000, 15], [2000000, 20], [2400000, 25], [Infinity, 30]], cess: 4, rebateLimit: 1200000, rebateMax: 60000 },
  rates: { gst: '0, 5, 18, 40', tds: [['194C contractor (individual/HUF)', 1], ['194C contractor (others)', 2], ['194I rent (land and building)', 10], ['194J professional fees', 10], ['194Q purchase of goods', 0.1]] },
  sessions: [], revisions: [], cards: [], refs: [], mistakes: [], tests: [], papers: [],
});
let D = null;
export async function loadStudy() {
  const saved = await getMeta('study:data', null);
  D = { ...blank(), ...(saved || {}) };
  for (const s of D.subjects) { s.marks ??= 100; s.weight ??= 1; s.material ??= {}; }
  D.plan = { ...blank().plan, ...D.plan }; D.rules = { ...blank().rules, ...D.rules }; D.exam = { ...D.exam };
  D.taxTable = { ...blank().taxTable, ...(saved?.taxTable || {}) };
  D.taxTable.slabs = (D.taxTable.slabs || []).map(([a, b]) => [a === null || a === 'Infinity' ? Infinity : a, b]);
  return D;
}
export const study = () => D;
const persist = debounce(() => setMeta('study:data', JSON.parse(JSON.stringify(D, (k, v) => (v === Infinity ? 'Infinity' : v)))).then(() => emit('study:changed')), 300);
export const save = () => persist();
export const uid = newId;
/* dates are plain YYYY-MM-DD keys computed in IST */
const IST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
export const today = (d = new Date()) => IST.format(d);
const utc = (k) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
export const addDays = (key, n) => new Date(utc(key) + n * 864e5).toISOString().slice(0, 10);
export const daysUntil = (key) => (key ? Math.round((utc(key) - utc(today())) / 864e5) : null);
export const dow = (key) => new Date(utc(key)).getUTCDay();
export const fmtKey = (k, o = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(utc(k)).toLocaleDateString('en-IN', { ...o, timeZone: 'UTC' });
/** financial year Apr-Mar; assessment year = FY + 1 */
export function fyAy(key = today()) { const y = +key.slice(0, 4), m = +key.slice(5, 7); const fy = m >= 4 ? y : y - 1; const s = (n) => `${n}-${String(n + 1).slice(2)}`; return { fy: s(fy), ay: s(fy + 1) }; }
export const inr = (x) => '₹' + (Number.isFinite(x) ? x : 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const subjectName = (id) => D.subjects.find((s) => s.id === id)?.name || 'General';
export const activeSubjects = () => D.subjects.filter((s) => s.level === D.level && (s.group === 'Papers' || D.groups[s.group] !== false));
export function progress(sub) {
  const n = sub.chapters.length || 1;
  const c = (k) => sub.chapters.filter((x) => x[k]).length;
  return { read: c('read') / n, revised: c('revised') / n, practiced: c('practiced') / n, all: (c('read') + c('revised') + c('practiced')) / (3 * n) };
}
export function streak() {
  const days = new Set([...D.sessions.map((s) => s.date), ...D.plan.tasks.filter((t) => t.done).map((t) => t.date)]);
  let n = 0, d = today(); if (!days.has(d)) d = addDays(d, -1);
  while (days.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
export const minutesOn = (date) => D.sessions.filter((s) => s.date === date).reduce((t, s) => t + s.min, 0);

// ----- spaced repetition -----
export const REV_STEPS = [1, 3, 7, 21];
export function addRevision({ title, subjectId, noteId }) {
  D.revisions.push({ id: newId(), title, subjectId: subjectId || '', noteId: noteId || null, step: 0, due: addDays(today(), REV_STEPS[0]) }); save();
}
export function completeRevision(r) {
  r.step++;
  if (r.step >= REV_STEPS.length) D.revisions = D.revisions.filter((x) => x.id !== r.id); else r.due = addDays(today(), REV_STEPS[r.step]);
  save();
}
/** SM-2. grade: 1 again, 3 hard, 4 good, 5 easy */
export function grade(card, q) {
  if (q < 3) { card.reps = 0; card.interval = 1; }
  else { card.reps++; card.interval = card.reps === 1 ? 1 : card.reps === 2 ? 6 : Math.round(card.interval * card.ease); }
  card.ease = Math.max(1.3, card.ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  card.due = addDays(today(), card.interval); save();
}
export const newCard = (o) => ({ id: newId(), type: 'qa', subjectId: '', q: '', a: '', ease: 2.5, interval: 0, reps: 0, due: today(), ...o });
export const clozeParts = (t) => ({ front: t.replace(/\{\{c\d+::(.*?)\}\}/g, '[...]'), back: t.replace(/\{\{c\d+::(.*?)\}\}/g, '$1') });
