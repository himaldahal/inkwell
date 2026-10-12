import { getSetting } from '../core/settings.js';
/** date formatting that honours Language/Region settings */
export function fmtDate(ts) {
  const d = new Date(ts), n = new Date();
  const h12 = { '12': true, '24': false }[getSetting('region.timeFormat')];
  if (d.toDateString() === n.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: h12 });
  if ((n - d) / 864e5 < 7) return d.toLocaleDateString([], { weekday: 'short' });
  const f = getSetting('region.dateFormat'); const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  if (f === 'YMD') return `${y}-${m}-${day}`; if (f === 'DMY') return `${day}/${m}/${y}`; if (f === 'MDY') return `${m}/${day}/${y}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: y === n.getFullYear() ? undefined : 'numeric' });
}
