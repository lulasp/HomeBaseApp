import {
  parseTimeString,
  formatTimeString,
  reminderDate,
  shouldScheduleReminder,
  reminderSignature,
  formatReminderLabel,
} from '../utils/reminders';

// 2026-09-07 is a Monday, so it is a valid weekKey.
const WEEK = '2026-09-07';
const UID = 'user-1';

const todo = (overrides = {}) => ({
  id: 't1',
  weekKey: WEEK,
  day: 'Wednesday',
  text: 'Take the bins out',
  done: false,
  remindTime: '18:30',
  remindFor: UID,
  ...overrides,
});

describe('parseTimeString', () => {
  it('parses a zero-padded time', () => {
    expect(parseTimeString('18:30')).toEqual({ hours: 18, minutes: 30 });
  });

  it('parses a single-digit hour', () => {
    expect(parseTimeString('9:05')).toEqual({ hours: 9, minutes: 5 });
  });

  it('parses midnight and the last minute of the day', () => {
    expect(parseTimeString('00:00')).toEqual({ hours: 0, minutes: 0 });
    expect(parseTimeString('23:59')).toEqual({ hours: 23, minutes: 59 });
  });

  it('trims surrounding whitespace', () => {
    expect(parseTimeString('  07:15 ')).toEqual({ hours: 7, minutes: 15 });
  });

  it('rejects an out-of-range hour or minute', () => {
    expect(parseTimeString('24:00')).toBeNull();
    expect(parseTimeString('12:60')).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(parseTimeString('1830')).toBeNull();
    expect(parseTimeString('18:3')).toBeNull();
    expect(parseTimeString('6:30 PM')).toBeNull();
    expect(parseTimeString('')).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(parseTimeString(null)).toBeNull();
    expect(parseTimeString(undefined)).toBeNull();
    expect(parseTimeString(1830)).toBeNull();
    expect(parseTimeString(new Date())).toBeNull();
  });
});

describe('formatTimeString', () => {
  it('zero-pads hours and minutes', () => {
    const d = new Date(2026, 8, 9, 7, 5);
    expect(formatTimeString(d)).toBe('07:05');
  });

  it('returns null for anything that is not a valid Date', () => {
    expect(formatTimeString(null)).toBeNull();
    expect(formatTimeString('18:30')).toBeNull();
    expect(formatTimeString(new Date('nonsense'))).toBeNull();
  });
});

describe('reminderDate', () => {
  it('offsets from the Monday weekKey by the day index', () => {
    const d = reminderDate(WEEK, 'Wednesday', '18:30');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);        // September
    expect(d.getDate()).toBe(9);         // Monday the 7th + 2
    expect(d.getHours()).toBe(18);
    expect(d.getMinutes()).toBe(30);
    expect(d.getSeconds()).toBe(0);
  });

  it('treats Monday as the first day and Sunday as the last', () => {
    expect(reminderDate(WEEK, 'Monday', '09:00').getDate()).toBe(7);
    expect(reminderDate(WEEK, 'Sunday', '09:00').getDate()).toBe(13);
  });

  it('rolls into the next month when the week spans one', () => {
    const d = reminderDate('2026-09-28', 'Thursday', '08:00');
    expect(d.getMonth()).toBe(9);        // October
    expect(d.getDate()).toBe(1);
  });

  it('returns null for an unusable time, day, or weekKey', () => {
    expect(reminderDate(WEEK, 'Wednesday', 'half six')).toBeNull();
    expect(reminderDate(WEEK, 'Caturday', '18:30')).toBeNull();
    expect(reminderDate(WEEK, 'wednesday', '18:30')).toBeNull();   // case-sensitive
    expect(reminderDate('not-a-date', 'Wednesday', '18:30')).toBeNull();
    expect(reminderDate(null, 'Wednesday', '18:30')).toBeNull();
  });
});

describe('shouldScheduleReminder', () => {
  const before = new Date(2026, 8, 9, 12, 0);   // Wed 09 Sep, midday
  const after = new Date(2026, 8, 9, 19, 0);    // Wed 09 Sep, evening

  it('schedules a future reminder owned by this user', () => {
    expect(shouldScheduleReminder(todo(), UID, before)).toBe(true);
  });

  it('does not schedule once the time has passed', () => {
    expect(shouldScheduleReminder(todo(), UID, after)).toBe(false);
  });

  it('does not schedule at the exact fire time', () => {
    const exact = new Date(2026, 8, 9, 18, 30, 0, 0);
    expect(shouldScheduleReminder(todo(), UID, exact)).toBe(false);
  });

  it('does not schedule a completed task', () => {
    expect(shouldScheduleReminder(todo({ done: true }), UID, before)).toBe(false);
  });

  it('does not schedule a task with no reminder set', () => {
    expect(shouldScheduleReminder(todo({ remindTime: null }), UID, before)).toBe(false);
  });

  it('does not schedule another member\'s reminder on this device', () => {
    expect(shouldScheduleReminder(todo({ remindFor: 'user-2' }), UID, before)).toBe(false);
  });

  it('does not schedule when the reminder has no owner', () => {
    expect(shouldScheduleReminder(todo({ remindFor: null }), UID, before)).toBe(false);
  });

  it('does not schedule when the user is unknown', () => {
    expect(shouldScheduleReminder(todo(), null, before)).toBe(false);
    expect(shouldScheduleReminder(todo(), undefined, before)).toBe(false);
  });

  it('handles a missing todo', () => {
    expect(shouldScheduleReminder(null, UID, before)).toBe(false);
  });
});

describe('reminderSignature', () => {
  const now = new Date(2026, 8, 9, 12, 0);

  it('is null when nothing should be scheduled', () => {
    expect(reminderSignature(todo({ done: true }), UID, now)).toBeNull();
  });

  it('is stable for an unchanged todo', () => {
    expect(reminderSignature(todo(), UID, now)).toBe(reminderSignature(todo(), UID, now));
  });

  it('changes when the time, day, week, or text changes', () => {
    const base = reminderSignature(todo(), UID, now);
    expect(reminderSignature(todo({ remindTime: '19:30' }), UID, now)).not.toBe(base);
    expect(reminderSignature(todo({ day: 'Thursday' }), UID, now)).not.toBe(base);
    expect(reminderSignature(todo({ weekKey: '2026-09-14' }), UID, now)).not.toBe(base);
    expect(reminderSignature(todo({ text: 'Take the recycling out' }), UID, now)).not.toBe(base);
  });

  it('ignores fields that do not affect the notification', () => {
    const base = reminderSignature(todo(), UID, now);
    expect(reminderSignature(todo({ id: 'other' }), UID, now)).toBe(base);
  });
});

describe('formatReminderLabel', () => {
  it('formats 24-hour by default', () => {
    expect(formatReminderLabel('18:30')).toBe('18:30');
    expect(formatReminderLabel('9:05')).toBe('09:05');
  });

  it('formats 12-hour on request, including noon and midnight', () => {
    expect(formatReminderLabel('18:30', false)).toBe('6:30 PM');
    expect(formatReminderLabel('09:05', false)).toBe('9:05 AM');
    expect(formatReminderLabel('12:00', false)).toBe('12:00 PM');
    expect(formatReminderLabel('00:15', false)).toBe('12:15 AM');
  });

  it('returns an empty string for an unusable time', () => {
    expect(formatReminderLabel(null)).toBe('');
    expect(formatReminderLabel('nope')).toBe('');
  });
});
