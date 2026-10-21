import {
  MAX_TODOS_PER_DAY,
  weekKeyFor, shiftWeekKey, dateOfDay, weekRangeLabel,
  carryOverCandidates, planCarryOver, planMaterialization, formatRecurrenceDays,
} from '../utils/weeklyTodos';

describe('week keys', () => {
  it('keys a week by its Monday', () => {
    expect(weekKeyFor(new Date(2026, 9, 21))).toBe('2026-10-19'); // Wednesday
    expect(weekKeyFor(new Date(2026, 9, 19))).toBe('2026-10-19'); // Monday
    expect(weekKeyFor(new Date(2026, 9, 25))).toBe('2026-10-19'); // Sunday
  });

  it('shifts across months and years', () => {
    expect(shiftWeekKey('2026-10-19', 1)).toBe('2026-10-26');
    expect(shiftWeekKey('2026-10-19', -1)).toBe('2026-10-12');
    expect(shiftWeekKey('2026-12-28', 1)).toBe('2027-01-04');
  });

  it('dates a weekday within a week', () => {
    expect(dateOfDay('2026-10-19', 'Monday')).toBe('2026-10-19');
    expect(dateOfDay('2026-10-26', 'Sunday')).toBe('2026-11-01');
    expect(dateOfDay('2026-10-19', 'Funday')).toBeNull();
  });

  it('labels a week range', () => {
    expect(weekRangeLabel('2026-10-12', 2026)).toBe('Oct 12–18');
    expect(weekRangeLabel('2026-10-26', 2026)).toBe('Oct 26 – Nov 1');
    expect(weekRangeLabel('2026-12-28', 2026)).toBe('Dec 28 – Jan 3 2027');
  });
});

describe('carry-over', () => {
  it('keeps unfinished tasks, minus instances of active rules', () => {
    const prev = [
      { id: 'a', day: 'Monday', done: false },
      { id: 'b', day: 'Monday', done: true },
      { id: 'c', day: 'Tuesday', done: false, recurrenceId: 'r1' },
      { id: 'd', day: 'Tuesday', done: false, recurrenceId: 'gone' },
    ];
    expect(carryOverCandidates(prev, new Set(['r1'])).map((t) => t.id)).toEqual(['a', 'd']);
    expect(carryOverCandidates(undefined)).toEqual([]);
  });

  it('skips tasks whose weekday is already full', () => {
    const full = Array.from({ length: MAX_TODOS_PER_DAY }, (_, i) => ({ id: `m${i}`, day: 'Monday' }));
    const { move, skipped } = planCarryOver(
      [{ id: 'a', day: 'Monday' }, { id: 'b', day: 'Tuesday' }],
      full,
    );
    expect(move.map((t) => t.id)).toEqual(['b']);
    expect(skipped.map((t) => t.id)).toEqual(['a']);
  });

  it('counts tasks it has already placed toward the cap', () => {
    const current = [{ day: 'Friday' }];
    const { move, skipped } = planCarryOver(
      [{ id: 'a', day: 'Friday' }, { id: 'b', day: 'Friday' }],
      current,
      2,
    );
    expect(move.map((t) => t.id)).toEqual(['a']);
    expect(skipped.map((t) => t.id)).toEqual(['b']);
  });
});

describe('planMaterialization', () => {
  const week = '2026-10-19';
  const rule = (over) => ({ id: 'r1', text: 'Bins', days: ['Tuesday'], active: true, ...over });

  it('creates one instance per rule day', () => {
    const { creates, markRuleIds } = planMaterialization([rule({ days: ['Friday', 'Tuesday'] })], week, []);
    expect(creates.map((c) => c.day)).toEqual(['Tuesday', 'Friday']);
    expect(markRuleIds).toEqual(['r1']);
  });

  it('skips inactive rules and rules already done this week', () => {
    const { creates, markRuleIds } = planMaterialization([
      rule({ active: false }),
      rule({ id: 'r2', lastMaterializedWeek: week }),
    ], week, []);
    expect(creates).toEqual([]);
    expect(markRuleIds).toEqual([]);
  });

  it('does not duplicate an instance that already exists', () => {
    const { creates, markRuleIds } = planMaterialization(
      [rule({ days: ['Tuesday', 'Thursday'] })],
      week,
      [{ day: 'Tuesday', recurrenceId: 'r1' }],
    );
    expect(creates.map((c) => c.day)).toEqual(['Thursday']);
    expect(markRuleIds).toEqual(['r1']);
  });

  it('never back-fills days before startsOn', () => {
    const { creates } = planMaterialization(
      [rule({ days: ['Monday', 'Wednesday', 'Friday'], startsOn: '2026-10-21' })],
      week,
      [],
    );
    expect(creates.map((c) => c.day)).toEqual(['Wednesday', 'Friday']);
  });

  it('skips full days but still marks the rule', () => {
    const full = Array.from({ length: 2 }, () => ({ day: 'Tuesday' }));
    const { creates, skipped, markRuleIds } = planMaterialization([rule()], week, full, 2);
    expect(creates).toEqual([]);
    expect(skipped.map((s) => s.day)).toEqual(['Tuesday']);
    expect(markRuleIds).toEqual(['r1']);
  });

  it('shares the cap across rules', () => {
    const { creates, skipped } = planMaterialization(
      [rule(), rule({ id: 'r2' })],
      week,
      [],
      1,
    );
    expect(creates.map((c) => c.rule.id)).toEqual(['r1']);
    expect(skipped.map((s) => s.rule.id)).toEqual(['r2']);
  });
});

describe('formatRecurrenceDays', () => {
  it.each([
    [['Tuesday'], 'Tue'],
    [['Friday', 'Monday', 'Wednesday'], 'Mon, Wed, Fri'],
    [['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], 'Weekdays'],
    [['Sunday', 'Saturday'], 'Weekends'],
    [['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], 'Every day'],
    [[], ''],
  ])('%p → %p', (days, label) => expect(formatRecurrenceDays(days)).toBe(label));
});
