import {
  monthKey, cashFlow, spendingByCategory, monthlyTrend, budgetProgress,
} from '../utils/financeSummary';

const exp = (date, amount, extra = {}) => ({ date, amount, ...extra });

describe('monthKey', () => {
  it('formats a date as yyyy-MM', () => {
    expect(monthKey(new Date(2026, 6, 22))).toBe('2026-07');
  });
});

describe('cashFlow', () => {
  const expenses = [
    exp('2026-07-01', 100),                       // spend
    exp('2026-07-15', 50),                         // spend
    exp('2026-07-20', 300, { direction: 'in' }),   // income
    exp('2026-06-30', 999),                        // other month, ignored
    exp('2026-07-10', '25.5'),                      // string amount
  ];

  it('separates income from spending for the month', () => {
    const cf = cashFlow(expenses, '2026-07');
    expect(cf.income).toBe(300);
    expect(cf.spending).toBe(175.5);
    expect(cf.net).toBe(124.5);
  });

  it('computes savings rate as net / income', () => {
    expect(cashFlow(expenses, '2026-07').savingsRate).toBeCloseTo(124.5 / 300);
  });

  it('returns 0 savings rate when there is no income', () => {
    expect(cashFlow([exp('2026-07-01', 100)], '2026-07').savingsRate).toBe(0);
  });

  it('handles empty input', () => {
    expect(cashFlow([], '2026-07')).toEqual({ income: 0, spending: 0, net: 0, savingsRate: 0 });
  });

  it('ignores rows with no date', () => {
    expect(cashFlow([{ amount: 50 }], '2026-07').spending).toBe(0);
  });
});

describe('spendingByCategory', () => {
  it('groups spending by category, high to low, excluding income', () => {
    const rows = spendingByCategory([
      exp('2026-07-01', 40, { category: 'groceries' }),
      exp('2026-07-02', 10, { category: 'groceries' }),
      exp('2026-07-03', 80, { category: 'repairs' }),
      exp('2026-07-04', 500, { category: 'salary', direction: 'in' }),
      exp('2026-06-01', 99, { category: 'groceries' }),
    ], '2026-07');
    expect(rows).toEqual([
      { category: 'repairs', amount: 80 },
      { category: 'groceries', amount: 50 },
    ]);
  });

  it('defaults a missing category to "other"', () => {
    expect(spendingByCategory([exp('2026-07-01', 10)], '2026-07'))
      .toEqual([{ category: 'other', amount: 10 }]);
  });
});

describe('monthlyTrend', () => {
  const ref = new Date(2026, 6, 15); // Jul 2026

  it('returns `months` buckets oldest to newest ending at ref', () => {
    const t = monthlyTrend([], 6, ref);
    expect(t).toHaveLength(6);
    expect(t.map((b) => b.key)).toEqual([
      '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07',
    ]);
    expect(t[5].label).toBe('Jul');
  });

  it('buckets spending and income into the right months', () => {
    const t = monthlyTrend([
      exp('2026-07-01', 100),
      exp('2026-06-01', 40),
      exp('2026-07-05', 900, { direction: 'in' }),
      exp('2025-01-01', 50), // outside window, ignored
    ], 6, ref);
    const jul = t.find((b) => b.key === '2026-07');
    const jun = t.find((b) => b.key === '2026-06');
    expect(jul).toMatchObject({ spending: 100, income: 900 });
    expect(jun).toMatchObject({ spending: 40, income: 0 });
  });

  it('crosses a year boundary correctly', () => {
    const t = monthlyTrend([], 3, new Date(2026, 1, 10)); // Feb 2026
    expect(t.map((b) => b.key)).toEqual(['2025-12', '2026-01', '2026-02']);
  });
});

describe('budgetProgress', () => {
  const expenses = [
    exp('2026-07-01', 90, { category: 'groceries' }),
    exp('2026-07-02', 120, { category: 'repairs' }),
  ];
  const budgets = [
    { category: 'groceries', amount: 100 },
    { category: 'repairs', amount: 80 },
    { category: 'cleaning', amount: 50 },
  ];

  it('computes spent, remaining, ratio and over flag', () => {
    const rows = budgetProgress(budgets, expenses, '2026-07');
    const groceries = rows.find((r) => r.category === 'groceries');
    expect(groceries).toMatchObject({ budget: 100, spent: 90, remaining: 10, over: false });
    expect(groceries.ratio).toBeCloseTo(0.9);
  });

  it('flags over-budget categories', () => {
    const repairs = budgetProgress(budgets, expenses, '2026-07').find((r) => r.category === 'repairs');
    expect(repairs).toMatchObject({ spent: 120, remaining: -40, over: true });
  });

  it('sorts by usage ratio descending', () => {
    const rows = budgetProgress(budgets, expenses, '2026-07');
    expect(rows.map((r) => r.category)).toEqual(['repairs', 'groceries', 'cleaning']);
  });

  it('handles a category with no spending', () => {
    const cleaning = budgetProgress(budgets, expenses, '2026-07').find((r) => r.category === 'cleaning');
    expect(cleaning).toMatchObject({ spent: 0, remaining: 50, ratio: 0, over: false });
  });
});
