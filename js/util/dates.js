// =============================================================================
// util/dates.js — date helpers. All display is in the user's LOCAL timezone.
//
// ESPN event dates are ISO-8601 UTC strings like "2026-06-15T00:00Z". We parse
// them to a Date (which is an absolute instant) and format with Intl in the
// browser's local zone — no manual offset math needed.
// =============================================================================

// ESPN's `?dates=` param wants YYYYMMDD in *US Eastern-ish* league terms, but in
// practice it treats the day boundary loosely; we use the user's local day for
// "today", which matches what a user expects to see.
export function yyyymmdd(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// Inclusive range string for ESPN: "YYYYMMDD-YYYYMMDD".
export function yyyymmddRange(start, end) {
  return `${yyyymmdd(start)}-${yyyymmdd(end)}`;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Local "day bucket" key (YYYY-MM-DD) used to group games by calendar day.
export function localDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isSameLocalDay(a, b) {
  return localDayKey(a) === localDayKey(b);
}

// "8:00 PM" in local time.
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
export function formatLocalTime(date) {
  return timeFmt.format(date);
}

// "Sat, Jun 14" in local time.
const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
export function formatLocalDay(date) {
  return dayFmt.format(date);
}

// Friendly relative day label for section headers.
export function relativeDayLabel(date, now = new Date()) {
  if (isSameLocalDay(date, now)) return 'Today';
  if (isSameLocalDay(date, addDays(now, 1))) return 'Tomorrow';
  if (isSameLocalDay(date, addDays(now, -1))) return 'Yesterday';
  return formatLocalDay(date);
}

// "updated 2m ago" style relative timestamps for the stale-data banner.
export function timeAgo(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
