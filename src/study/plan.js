import { study, today, addDays, daysUntil, dow, uid, activeSubjects, save } from './data.js';

/* Three-round plan scheduled backwards from the exam date:
   Reading -> Revision 1 -> Revision 2 -> Test series, with buffer days before the exam,
   Sundays as test + weekly-review days, and holiday blocks skipped. */
export const PHASES = [['Reading', 0.45], ['Revision 1', 0.2], ['Revision 2', 0.12], ['Test series', 0.23]];
export const weightOf = (s) => (s.marks || 100) * (s.weight || 1);
/** minutes per day for each active subject, weighted by marks x difficulty */
export function allocation(D = study()) {
  const subs = activeSubjects(); const tot = subs.reduce((n, s) => n + weightOf(s), 0) || 1;
  return subs.map((s) => ({ s, min: Math.round((D.plan.dailyMinutes * weightOf(s)) / tot) }));
}
export function buildPlan() {
  const D = study(); const t0 = today(), end = D.exam.date;
  if (!end || daysUntil(end) <= 0) return { error: 'Set a future exam date first.' };
  const subs = [...activeSubjects()].sort((a, b) => weightOf(b) - weightOf(a));
  if (!subs.length) return { error: 'No subjects selected for this level and group.' };
  const hol = (k) => D.plan.holidays.some((h) => k >= h.from && k <= (h.to || h.from));
  const days = []; for (let k = t0; k < end; k = addDays(k, 1)) days.push(k);
  const buffer = Math.min(D.plan.bufferDays, Math.max(0, days.length - 3));
  const study_ = days.slice(0, days.length - buffer), bufDays = days.slice(days.length - buffer);
  const work = study_.filter((k) => !hol(k)); const sundays = work.filter((k) => dow(k) === 0); const normal = work.filter((k) => dow(k) !== 0);
  const out = [];
  const add = (date, text, phase) => out.push({ id: uid(), date, text, done: false, auto: true, phase });
  let i = 0;
  PHASES.forEach(([name, frac], pi) => {
    const n = pi === PHASES.length - 1 ? normal.length - i : Math.round(normal.length * frac);
    const ds = normal.slice(i, i + n); i += n; if (!ds.length) return;
    if (name === 'Test series') { ds.forEach((k, j) => add(k, `Test: ${subs[j % subs.length].name} - timed paper, then analyse mistakes`, name)); return; }
    const q = subs.flatMap((s) => s.chapters.filter((c) => (name === 'Reading' ? !c.read : true)).map((c) => `${s.name}: ${c.name}`));
    const per = Math.max(1, Math.ceil(q.length / ds.length));
    ds.forEach((k, j) => { const part = q.slice(j * per, (j + 1) * per); if (part.length) add(k, `${name === 'Reading' ? 'Read' : 'Revise'} - ${part.join('; ')}`, name); });
  });
  sundays.forEach((k, j) => { add(k, `Weekly test: ${subs[j % subs.length].name} (3 hours)`, 'Test'); add(k, 'Weekly review: tasks done, hours, weak chapters', 'Review'); });
  bufDays.forEach((k) => add(k, 'Buffer: weak areas, formulae, section lists and rapid revision', 'Buffer'));
  D.plan.tasks = D.plan.tasks.filter((x) => !(x.auto && !x.done && x.date >= t0)).concat(out); save();
  return { count: out.length };
}
/** spread overdue unfinished tasks over the next working days */
export function catchUp(spread = 7) {
  const D = study(), t = today();
  const late = D.plan.tasks.filter((x) => !x.done && x.date < t); if (!late.length) return 0;
  const hol = (k) => D.plan.holidays.some((h) => k >= h.from && k <= (h.to || h.from));
  const slots = []; for (let k = t; slots.length < spread; k = addDays(k, 1)) if (!hol(k)) slots.push(k);
  late.forEach((x, i) => { x.date = slots[i % slots.length]; x.moved = true; });
  save(); return late.length;
}
