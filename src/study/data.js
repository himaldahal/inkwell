import { getMeta, setMeta, newId } from '../core/db.js';
import { debounce } from '../core/utils.js';
import { emit } from '../core/store.js';

/* Study Hub data lives in one meta record ('study:data'), local to this device.
   Plain-English structure only: subject and chapter names are editable starting points. */
const CH = (s) => s.split('|').map((n) => ({ id: newId(), name: n.trim(), read: false, revised: false, practiced: false }));
const SUB = (level, group, name, ch) => ({ id: newId(), level, group, name, chapters: CH(ch) });
export const LEVELS = [['foundation', 'Foundation'], ['inter', 'Intermediate'], ['final', 'Final']];
export function seedSubjects() {
  return [
    SUB('foundation', 'Paper 1', 'Accounting', 'Accounting basics|Journal and ledger|Subsidiary books|Bank reconciliation|Trial balance|Depreciation|Final accounts|Partnership basics|Company accounts basics'),
    SUB('foundation', 'Paper 2', 'Business Laws', 'Contract formation|Performance and discharge|Special contracts|Sale of goods|Partnership law|LLP|Company law basics'),
    SUB('foundation', 'Paper 3', 'Maths, Stats and Logical Reasoning', 'Ratio and proportion|Equations|Time value of money|Permutations|Sequences|Sets and functions|Calculus basics|Descriptive statistics|Probability|Logical reasoning'),
    SUB('foundation', 'Paper 4', 'Business Economics', 'Demand and supply|Production and cost|Price determination|Market structures|National income|Money and banking|Business cycles'),
    SUB('inter', 'Group I', 'Advanced Accounting', 'Accounting standards|Company accounts|Share capital|Amalgamation|Branch accounts|Departmental accounts|Financial statements'),
    SUB('inter', 'Group I', 'Corporate and Other Laws', 'Company incorporation|Share capital and debentures|Directors|Meetings|Accounts and audit|Securities laws basics|FEMA basics'),
    SUB('inter', 'Group I', 'Taxation', 'Residential status|Heads of income|Salary|House property|Business income|Capital gains|Deductions|GST levy and supply|Input tax credit|Returns and payment'),
    SUB('inter', 'Group II', 'Cost and Management Accounting', 'Cost concepts|Material cost|Labour cost|Overheads|Job and batch costing|Process costing|Marginal costing|Standard costing|Budgetary control'),
    SUB('inter', 'Group II', 'Auditing and Ethics', 'Nature of audit|Audit planning|Internal control|Vouching|Verification|Audit reports|Company audit|Professional ethics'),
    SUB('inter', 'Group II', 'Financial and Strategic Management', 'Financial leverage|Capital structure|Cost of capital|Capital budgeting|Working capital|Dividend decisions|Strategic analysis|Strategy implementation'),
    SUB('final', 'Group I', 'Financial Reporting', 'Ind AS framework|Revenue|Leases|Financial instruments|Consolidation|Business combinations|Share-based payment'),
    SUB('final', 'Group I', 'Advanced Financial Management', 'Risk and return|Derivatives|Portfolio theory|Mergers and valuation|Forex|Capital budgeting under risk|Mutual funds'),
    SUB('final', 'Group I', 'Advanced Auditing and Professional Ethics', 'Standards on auditing|Risk assessment|Group audits|Special audits|Assurance|Ethics and conduct'),
    SUB('final', 'Group II', 'Direct Tax and International Taxation', 'Assessment and appeals|Deductions and exemptions|Clubbing and set-off|International taxation|Transfer pricing|Anti-avoidance'),
    SUB('final', 'Group II', 'Indirect Tax Laws', 'GST framework|Time and place of supply|Valuation|Input tax credit|Refunds|Customs basics|Foreign trade policy'),
    SUB('final', 'Group II', 'Strategic Cost Management and Performance Evaluation', 'Strategic cost analysis|Target costing|Activity based costing|Pricing decisions|Performance measures|Transfer pricing|Decision models'),
    SUB('final', 'Group II', 'Integrated Business Solutions', 'Case study approach|Integrated accounting and tax|Audit and law application|Strategic decisions'),
  ];
}
const blank = () => ({ v: 1, level: 'inter', subjects: seedSubjects(), exam: { label: '', date: '', attempt: '' }, plan: { dailyMinutes: 240, weeklyChapters: 5, tasks: [] }, sessions: [], revisions: [], cards: [], refs: [], mistakes: [], tests: [], papers: [] });
let D = null;
export async function loadStudy() {
  const saved = await getMeta('study:data', null);
  D = { ...blank(), ...(saved || {}) };
  return D;
}
export const study = () => D;
const persist = debounce(() => setMeta('study:data', D).then(() => emit('study:changed')), 300);
export const save = () => persist();
export const uid = newId;
export const today = (d = new Date()) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
export const addDays = (key, n) => { const d = new Date(key + 'T00:00:00'); d.setDate(d.getDate() + n); return today(d); };
export const daysUntil = (key) => (key ? Math.ceil((new Date(key + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 864e5) : null);
export const subjectName = (id) => D.subjects.find((s) => s.id === id)?.name || 'General';
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
