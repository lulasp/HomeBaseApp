import {
  amountForMonth, billTypeOf, estimatedTotal, hasMonthOverride, incomeForMonth,
  isActiveInMonth, isEstimate, isRecurringBill, payableBills, recurringTotal, shiftMonth,
  startMonthOf, withRecurring,
} from '../utils/recurring';
import { cashFlow, monthlyTrend } from '../utils/financeSummary';

describe('shiftMonth', () => {
  it('moves within a year', () => {
    expect(shiftMonth('2026-06', 1)).toBe('2026-07');
    expect(shiftMonth('2026-06', -2)).toBe('2026-04');
  });

  it('crosses year boundaries', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
});

describe('startMonthOf', () => {
  const createdAt = { toDate: () => new Date(2026, 5, 15) };

  it('prefers an explicit startMonth', () => {
    expect(startMonthOf({ startMonth: '2026-09', paidMonths: ['2026-01'], createdAt })).toBe('2026-09');
  });

  it('uses the earlier of paid months and creation for older docs', () => {
    expect(startMonthOf({ paidMonths: ['2026-08', '2026-03'], createdAt })).toBe('2026-03');
    expect(startMonthOf({ paidMonths: ['2026-08'], createdAt })).toBe('2026-06');
  });

  it('is null when nothing dates the item, including a pending serverTimestamp', () => {
    expect(startMonthOf({})).toBeNull();
    expect(startMonthOf({ createdAt: null })).toBeNull();
  });
});

describe('isActiveInMonth', () => {
  it('starts at startMonth inclusive', () => {
    const bill = { startMonth: '2026-09' };
    expect(isActiveInMonth(bill, '2026-08')).toBe(false);
    expect(isActiveInMonth(bill, '2026-09')).toBe(true);
    expect(isActiveInMonth(bill, '2027-01')).toBe(true);
  });

  it('treats undated items as always active', () => {
    expect(isActiveInMonth({}, '2020-01')).toBe(true);
  });
});

describe('amountForMonth', () => {
  const bill = { amount: 100, monthOverrides: { '2026-11': 130, '2026-12': 0 } };

  it('uses the override only for its month', () => {
    expect(amountForMonth(bill, '2026-11')).toBe(130);
    expect(amountForMonth(bill, '2026-10')).toBe(100);
  });

  it('honours a 0 override', () => {
    expect(hasMonthOverride(bill, '2026-12')).toBe(true);
    expect(amountForMonth(bill, '2026-12')).toBe(0);
  });

  it('handles missing overrides and amounts', () => {
    expect(hasMonthOverride({ amount: 5 }, '2026-11')).toBe(false);
    expect(amountForMonth({}, '2026-11')).toBe(0);
    expect(amountForMonth({ amount: '12.5' }, '2026-11')).toBe(12.5);
  });
});

describe('recurringTotal', () => {
  it('sums active items with overrides applied', () => {
    const bills = [
      { amount: 100, startMonth: '2026-01' },
      { amount: 50, startMonth: '2026-01', monthOverrides: { '2026-11': 80 } },
      { amount: 999, startMonth: '2027-01' },
    ];
    expect(recurringTotal(bills, '2026-11')).toBe(180);
    expect(recurringTotal(bills, '2026-10')).toBe(150);
  });

  it('is 0 with no items', () => {
    expect(recurringTotal(undefined, '2026-11')).toBe(0);
  });
});

describe('withRecurring', () => {
  const expenses = [{ amount: 20, date: '2026-11-03' }];
  const bills = [{ amount: 100, startMonth: '2026-11' }];
  const income = [{ amount: 1000, startMonth: '2026-10', monthOverrides: { '2026-11': 1200 } }];

  it('feeds cashFlow, paid or not', () => {
    const rows = withRecurring(expenses, bills, income, ['2026-11']);
    expect(cashFlow(rows, '2026-11')).toMatchObject({ income: 1200, spending: 120, net: 1080 });
  });

  it('skips months before an item starts', () => {
    const rows = withRecurring([], bills, income, ['2026-10', '2026-11']);
    expect(cashFlow(rows, '2026-10')).toMatchObject({ income: 1000, spending: 0 });
  });

  it('feeds monthlyTrend', () => {
    const rows = withRecurring([], bills, income, ['2026-10', '2026-11']);
    const trend = monthlyTrend(rows, 2, new Date(2026, 10, 6));
    expect(trend.map((b) => b.spending)).toEqual([0, 100]);
    expect(trend.map((b) => b.income)).toEqual([1000, 1200]);
  });

  it('does not mutate the expenses array', () => {
    withRecurring(expenses, bills, income, ['2026-11']);
    expect(expenses).toHaveLength(1);
  });
});

describe('incomeForMonth', () => {
  const sources = [
    { id: 'a', amount: 3000, ownerUid: 'u1', startMonth: '2026-01' },
    { id: 'b', amount: 500, ownerUid: null, startMonth: '2026-01', monthOverrides: { '2026-11': 600 } },
    { id: 'c', amount: 900, ownerUid: 'u2', startMonth: '2027-01' },
  ];
  const expenses = [
    { id: 'x', amount: 200, date: '2026-11-10', direction: 'in', ownerUid: 'u2' },
    { id: 'y', amount: 50, date: '2026-11-11', direction: 'in' },
    { id: 'z', amount: 75, date: '2026-11-12' },
    { id: 'w', amount: 10, date: '2026-10-12', direction: 'in' },
  ];

  it('splits recurring and one-off income for the month', () => {
    const r = incomeForMonth(sources, expenses, '2026-11');
    expect(r.recurring.map((s) => s.id)).toEqual(['a', 'b']);
    expect(r.oneOff.map((e) => e.id)).toEqual(['x', 'y']);
    expect(r.recurringTotal).toBe(3600);
    expect(r.oneOffTotal).toBe(250);
    expect(r.total).toBe(3850);
  });

  it('groups by owner high to low, with unowned rows under the household', () => {
    expect(incomeForMonth(sources, expenses, '2026-11').byOwner).toEqual([
      { ownerUid: 'u1', amount: 3000 },
      { ownerUid: null, amount: 650 },
      { ownerUid: 'u2', amount: 200 },
    ]);
  });

  it('is empty for no data', () => {
    expect(incomeForMonth(undefined, undefined, '2026-11')).toMatchObject({ total: 0, byOwner: [] });
  });
});

describe('bill types', () => {
  it('treats bills without a type as fixed', () => {
    expect(billTypeOf({})).toBe('fixed');
    expect(isRecurringBill({})).toBe(true);
    expect(isEstimate({ amount: 10 }, '2026-11')).toBe(false);
  });

  describe('one-time', () => {
    const bill = { billType: 'once', amount: 300, startMonth: '2026-11' };

    it('only applies to its own month', () => {
      expect(isActiveInMonth(bill, '2026-10')).toBe(false);
      expect(isActiveInMonth(bill, '2026-11')).toBe(true);
      expect(isActiveInMonth(bill, '2026-12')).toBe(false);
      expect(isRecurringBill(bill)).toBe(false);
    });

    it('counts once in the Overview rows', () => {
      const rows = withRecurring([], [bill], [], ['2026-10', '2026-11', '2026-12']);
      expect(rows).toEqual([{ amount: 300, date: '2026-11-01', direction: 'out' }]);
    });
  });

  describe('variable', () => {
    const bill = {
      billType: 'variable',
      amount: 80,
      startMonth: '2026-08',
      monthOverrides: { '2026-09': 95, '2026-10': 0, '2026-12': 120 },
    };

    it('uses the entered amount for a month', () => {
      expect(amountForMonth(bill, '2026-09')).toBe(95);
      expect(isEstimate(bill, '2026-09')).toBe(false);
    });

    it('starts from the estimate before anything is entered', () => {
      expect(amountForMonth(bill, '2026-08')).toBe(80);
      expect(isEstimate(bill, '2026-08')).toBe(true);
    });

    it('estimates from the latest earlier amount, ignoring later ones', () => {
      expect(amountForMonth(bill, '2026-11')).toBe(95);
      expect(amountForMonth(bill, '2027-01')).toBe(120);
    });

    it('keeps a skipped month at 0 without using it as the estimate', () => {
      expect(amountForMonth(bill, '2026-10')).toBe(0);
      expect(isEstimate(bill, '2026-10')).toBe(false);
    });

    it('reports how much of the total is estimated', () => {
      const fixed = { amount: 1000, startMonth: '2026-01' };
      expect(recurringTotal([fixed, bill], '2026-11')).toBe(1095);
      expect(estimatedTotal([fixed, bill], '2026-11')).toBe(95);
      expect(estimatedTotal([fixed, bill], '2026-12')).toBe(0);
    });
  });
});

describe('bill payments', () => {
  const bill = { id: 'b1', amount: 100, startMonth: '2026-10' };
  const payment = { amount: 100, date: '2026-11-05', billId: 'b1' };

  it('counts a linked payment once, as the bill', () => {
    const rows = withRecurring([payment, { amount: 20, date: '2026-11-06' }], [bill], [], ['2026-11']);
    expect(cashFlow(rows, '2026-11').spending).toBe(120);
  });

  it('counts the expense when the bill was deleted', () => {
    const rows = withRecurring([payment], [], [], ['2026-11']);
    expect(cashFlow(rows, '2026-11').spending).toBe(100);
  });

  it('counts the expense when the bill does not apply to that month', () => {
    const early = { ...payment, date: '2026-09-05' };
    const rows = withRecurring([early], [bill], [], ['2026-09']);
    expect(cashFlow(rows, '2026-09').spending).toBe(100);
  });

  it('leaves unlinked expenses alone when bills have no id', () => {
    const rows = withRecurring([{ amount: 20, date: '2026-11-06' }], [{ amount: 100 }], [], ['2026-11']);
    expect(cashFlow(rows, '2026-11').spending).toBe(120);
  });

  it('offers recurring bills and one-time bills of that month only', () => {
    const once = { id: 'o', billType: 'once', startMonth: '2026-11' };
    expect(payableBills([bill, once], '2026-11').map((b) => b.id)).toEqual(['b1', 'o']);
    expect(payableBills([bill, once], '2026-12').map((b) => b.id)).toEqual(['b1']);
  });
});
