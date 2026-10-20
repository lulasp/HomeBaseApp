// Pure helpers for the home-screen weekly todos: week keys, carry-over and
// recurring-task materialization. See docs/weekly-todos-next.md.
import { addDays, addWeeks, format, parseISO, startOfWeek } from 'date-fns';
import { FULL_DAYS } from './categories';

export const MAX_TODOS_PER_DAY = 15;
export const WEEK_NAV_RANGE = 8;   // arrows reach ±8 weeks from this one

// Weeks start on Monday; the key is that Monday as yyyy-MM-dd.
export function weekKeyFor(date) {
  return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

export function shiftWeekKey(weekKey, weeks) {
  return format(addWeeks(parseISO(weekKey), weeks), 'yyyy-MM-dd');
}

// yyyy-MM-dd of a weekday ('Tuesday') within a week.
export function dateOfDay(weekKey, fullDay) {
  const i = FULL_DAYS.indexOf(fullDay);
  if (i < 0) return null;
  return format(addDays(parseISO(weekKey), i), 'yyyy-MM-dd');
}

// "Sep 8–14", or "Sep 29 – Oct 5" across months, with the year when it isn't `currentYear`.
export function weekRangeLabel(weekKey, currentYear = new Date().getFullYear()) {
  const start = parseISO(weekKey);
  const end = addDays(start, 6);
  const year = end.getFullYear() !== currentYear ? ` ${end.getFullYear()}` : '';
  if (start.getMonth() === end.getMonth()) return `${format(start, 'MMM d')}–${format(end, 'd')}${year}`;
  return `${format(start, 'MMM d')} – ${format(end, 'MMM d')}${year}`;
}

function countByDay(todos) {
  const counts = {};
  for (const t of todos) counts[t.day] = (counts[t.day] || 0) + 1;
  return counts;
}

// Unfinished tasks from last week that can be brought forward. Instances of a
// still-active rule are excluded — this week gets its own instance of those.
// A paused or deleted rule's leftovers carry like any other task.
export function carryOverCandidates(prevWeekTodos, activeRuleIds = new Set()) {
  return (prevWeekTodos ?? []).filter((t) => !t.done && !(t.recurrenceId && activeRuleIds.has(t.recurrenceId)));
}

// Splits candidates into those that fit on their weekday this week and those
// that would push the day past MAX_TODOS_PER_DAY.
export function planCarryOver(candidates, currentWeekTodos, max = MAX_TODOS_PER_DAY) {
  const counts = countByDay(currentWeekTodos ?? []);
  const move = [];
  const skipped = [];
  for (const t of candidates) {
    if ((counts[t.day] || 0) >= max) { skipped.push(t); continue; }
    counts[t.day] = (counts[t.day] || 0) + 1;
    move.push(t);
  }
  return { move, skipped };
}

// Works out which recurring instances `weekKey` still needs.
//   rules     — todoRecurrences docs
//   weekTodos — that week's weeklyTodos (used to avoid duplicates and respect the cap)
// Returns { creates: [{ rule, day }], markRuleIds, skipped: [{ rule, day }] }.
// A rule is marked materialized for the week even when some days were skipped
// for being full, so it doesn't retry on every open.
export function planMaterialization(rules, weekKey, weekTodos, max = MAX_TODOS_PER_DAY) {
  const counts = countByDay(weekTodos ?? []);
  const existing = new Set((weekTodos ?? []).filter((t) => t.recurrenceId).map((t) => `${t.recurrenceId}|${t.day}`));
  const creates = [];
  const skipped = [];
  const markRuleIds = [];

  for (const rule of rules ?? []) {
    if (!rule.active || rule.lastMaterializedWeek === weekKey) continue;
    for (const day of FULL_DAYS.filter((d) => (rule.days ?? []).includes(d))) {
      // Never back-fill days before the rule started (or was last changed)
      if (rule.startsOn && dateOfDay(weekKey, day) < rule.startsOn) continue;
      if (existing.has(`${rule.id}|${day}`)) continue;
      if ((counts[day] || 0) >= max) { skipped.push({ rule, day }); continue; }
      counts[day] = (counts[day] || 0) + 1;
      creates.push({ rule, day });
    }
    markRuleIds.push(rule.id);
  }
  return { creates, markRuleIds, skipped };
}

// "Tue", "Mon, Wed, Fri", "Weekdays", "Weekends", "Every day"
export function formatRecurrenceDays(days) {
  const set = new Set(days ?? []);
  const ordered = FULL_DAYS.filter((d) => set.has(d));
  if (ordered.length === 7) return 'Every day';
  if (ordered.length === 5 && FULL_DAYS.slice(0, 5).every((d) => set.has(d))) return 'Weekdays';
  if (ordered.length === 2 && set.has('Saturday') && set.has('Sunday')) return 'Weekends';
  return ordered.map((d) => d.slice(0, 3)).join(', ');
}
