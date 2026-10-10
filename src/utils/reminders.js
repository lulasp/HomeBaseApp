import { parseISO, addDays, isValid } from 'date-fns';
import { FULL_DAYS } from './categories';

// Todo reminders are stored as a wall-clock time ('HH:mm') rather than an
// absolute instant, so moving a task to another day moves its reminder with it.
// The absolute fire time is derived from weekKey (the Monday) + day + time.

export function parseTimeString(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

export function formatTimeString(date) {
  if (!(date instanceof Date) || !isValid(date)) return null;
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// Absolute local Date a reminder should fire, or null if any input is unusable.
export function reminderDate(weekKey, day, remindTime) {
  const time = parseTimeString(remindTime);
  if (!time) return null;
  const dayIndex = FULL_DAYS.indexOf(day);
  if (dayIndex === -1) return null;
  if (typeof weekKey !== 'string') return null;
  const monday = parseISO(weekKey);
  if (!isValid(monday)) return null;
  const date = addDays(monday, dayIndex);
  date.setHours(time.hours, time.minutes, 0, 0);
  return date;
}

// A reminder is worth scheduling only if it is set, unfinished, owned by this
// user, and still in the future.
export function shouldScheduleReminder(todo, uid, now = new Date()) {
  if (!todo || !todo.remindTime || todo.done) return false;
  if (!uid || todo.remindFor !== uid) return false;
  const date = reminderDate(todo.weekKey, todo.day, todo.remindTime);
  return !!date && date.getTime() > now.getTime();
}

// Identity of a scheduled reminder — when this changes the OS-level
// notification has to be cancelled and re-scheduled.
export function reminderSignature(todo, uid, now = new Date()) {
  if (!shouldScheduleReminder(todo, uid, now)) return null;
  return `${todo.weekKey}|${todo.day}|${todo.remindTime}|${todo.text}`;
}

// '18:30' → '6:30 PM' / '18:30' depending on the device's clock preference.
export function formatReminderLabel(remindTime, use24Hour = true) {
  const time = parseTimeString(remindTime);
  if (!time) return '';
  if (use24Hour) {
    return `${String(time.hours).padStart(2, '0')}:${String(time.minutes).padStart(2, '0')}`;
  }
  const suffix = time.hours >= 12 ? 'PM' : 'AM';
  const hour12 = time.hours % 12 === 0 ? 12 : time.hours % 12;
  return `${hour12}:${String(time.minutes).padStart(2, '0')} ${suffix}`;
}
