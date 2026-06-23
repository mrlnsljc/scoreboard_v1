// =============================================================================
// util/ics.js — build + download an .ics (iCalendar) file from a team's
// normalized schedule, so a favorite team's fixtures drop straight into
// Google/Apple/Outlook Calendar. Pure client-side: a Blob + a download click.
//
// Input is the same normalized game shape produced by data/espn.js
// (startMs, home/away.displayName, venue, broadcast, scores, isFinal).
// =============================================================================

const pad = (n) => String(n).padStart(2, '0');

// UTC timestamp in iCal basic format: 20260615T193000Z
function icsStamp(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
    + `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

// Escape text per RFC 5545 (commas, semicolons, backslashes, newlines).
function esc(s) {
  return String(s == null ? '' : s).replace(/([,;\\])/g, '\\$1').replace(/\r?\n/g, '\\n');
}

// Rough event duration by sport (hours) so the calendar block looks sensible.
function durationHours(sport) {
  if (sport === 'baseball' || sport === 'football') return 3.5;
  if (sport === 'soccer') return 2;
  return 2.5; // hockey / basketball / default
}

// Build the full VCALENDAR string for a team's schedule.
export function buildTeamICS(team, schedule) {
  const stamp = icsStamp(Date.now());
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Scoreboard PWA//Schedules//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc((team.name || 'Team') + ' schedule')}`,
  ];
  for (const g of schedule || []) {
    if (!Number.isFinite(g.startMs)) continue;
    const start = icsStamp(g.startMs);
    const end = icsStamp(g.startMs + durationHours(g.sport) * 3600 * 1000);
    const title = `${g.away?.displayName || 'Away'} @ ${g.home?.displayName || 'Home'}`;
    let desc = '';
    if (g.league?.name) desc += g.league.name;
    if (g.broadcast) desc += (desc ? '\n' : '') + `TV: ${g.broadcast}`;
    if (g.isFinal && g.home?.score !== '' && g.away?.score !== '') {
      desc += (desc ? '\n' : '') + `Final: ${g.away.displayName} ${g.away.score} – ${g.home.displayName} ${g.home.score}`;
    }
    lines.push(
      'BEGIN:VEVENT',
      `UID:${esc(g.id || start)}@scoreboard-pwa`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${esc(title)}`,
    );
    if (g.venue) lines.push(`LOCATION:${esc(g.venue)}`);
    if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
    lines.push('STATUS:CONFIRMED', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// Build the .ics and trigger a browser download.
export function downloadTeamICS(team, schedule) {
  const ics = buildTeamICS(team, schedule);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = (team.name || 'team').replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '') || 'team';
  a.href = url;
  a.download = `${safe}-schedule.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
