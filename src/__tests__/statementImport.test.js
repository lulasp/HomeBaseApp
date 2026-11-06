import {
  normalizeTransaction,
  isDuplicate,
  flagDuplicates,
  toExpenseDoc,
  toBillDoc,
  suggestBillId,
  linkRowToBill,
} from '../utils/statementImport';

describe('normalizeTransaction', () => {
  const opts = { validCategoryKeys: ['groceries', 'rent', 'other'] };

  it('keeps valid fields and forces amount positive', () => {
    const out = normalizeTransaction(
      { date: '2026-01-15', description: '  Tesco  ', amount: -42.5, direction: 'out', type: 'expense', category: 'groceries' },
      opts,
    );
    expect(out).toEqual({
      date: '2026-01-15', description: 'Tesco', amount: 42.5,
      direction: 'out', type: 'expense', category: 'groceries',
    });
  });

  it('falls back to other for unknown category', () => {
    const out = normalizeTransaction({ date: '2026-01-15', amount: 10, category: 'crypto' }, opts);
    expect(out.category).toBe('other');
  });

  it('defaults direction to out and type to expense', () => {
    const out = normalizeTransaction({ date: '2026-01-15', amount: 10 }, opts);
    expect(out.direction).toBe('out');
    expect(out.type).toBe('expense');
  });

  it('rejects malformed dates', () => {
    expect(normalizeTransaction({ date: '15/01/2026', amount: 1 }, opts).date).toBe('');
    expect(normalizeTransaction({ date: null, amount: 1 }, opts).date).toBe('');
  });

  it('coerces garbage amount to 0', () => {
    expect(normalizeTransaction({ date: '2026-01-15', amount: 'NaN' }, opts).amount).toBe(0);
  });

  it('respects income direction and bill type', () => {
    const out = normalizeTransaction(
      { date: '2026-01-15', amount: 900, direction: 'in', type: 'bill', category: 'rent' }, opts);
    expect(out.direction).toBe('in');
    expect(out.type).toBe('bill');
  });
});

describe('isDuplicate', () => {
  const existing = [
    { date: '2026-01-15', amount: 42.5, title: 'Tesco Groceries' },
    { date: '2026-01-20', amount: 900, title: 'Rent' },
  ];

  it('matches same date + amount + overlapping description', () => {
    expect(isDuplicate({ date: '2026-01-15', amount: 42.5, description: 'TESCO' }, existing)).toBe(true);
  });

  it('does not match different amount', () => {
    expect(isDuplicate({ date: '2026-01-15', amount: 43, description: 'Tesco' }, existing)).toBe(false);
  });

  it('does not match different date', () => {
    expect(isDuplicate({ date: '2026-02-15', amount: 42.5, description: 'Tesco' }, existing)).toBe(false);
  });

  it('matches on date+amount alone when a description is missing', () => {
    expect(isDuplicate({ date: '2026-01-20', amount: 900, description: '' }, existing)).toBe(true);
  });

  it('ignores rows with no date or amount', () => {
    expect(isDuplicate({ date: '', amount: 42.5, description: 'Tesco' }, existing)).toBe(false);
    expect(isDuplicate({ date: '2026-01-15', amount: 0, description: 'Tesco' }, existing)).toBe(false);
  });

  it('tolerates tiny floating-point differences', () => {
    expect(isDuplicate({ date: '2026-01-15', amount: 42.5001, description: 'Tesco' }, existing)).toBe(true);
  });
});

describe('flagDuplicates', () => {
  it('tags each row', () => {
    const existing = [{ date: '2026-01-15', amount: 10, title: 'A' }];
    const out = flagDuplicates(
      [{ date: '2026-01-15', amount: 10, description: 'A' }, { date: '2026-01-16', amount: 5, description: 'B' }],
      existing,
    );
    expect(out[0].duplicate).toBe(true);
    expect(out[1].duplicate).toBe(false);
  });
});

describe('toExpenseDoc / toBillDoc', () => {
  it('builds an expense doc with direction and paidBy', () => {
    const doc = toExpenseDoc(
      { description: 'Coffee', category: 'groceries', amount: 4, date: '2026-01-15', direction: 'out' },
      { paidBy: 'Sam' },
    );
    expect(doc).toMatchObject({
      title: 'Coffee', category: 'groceries', amount: 4,
      date: '2026-01-15', direction: 'out', paidBy: 'Sam',
    });
  });

  it('falls back to a title when description is empty', () => {
    expect(toExpenseDoc({ description: '', amount: 1, date: '2026-01-15' }).title).toBe('Imported transaction');
  });

  it('derives dueDayOfMonth from the date for bills', () => {
    const doc = toBillDoc({ description: 'Rent', category: 'rent', amount: 900, date: '2026-01-20' });
    expect(doc.dueDayOfMonth).toBe(20);
    expect(doc.name).toBe('Rent');
  });
});

describe('suggestBillId', () => {
  const bills = [{ id: 'e', name: 'Electricity' }, { id: 'm', name: 'Mortgage' }];

  it('matches on name overlap, ignoring case and spacing', () => {
    expect(suggestBillId({ description: 'DD  ELECTRICITY  CO', direction: 'out' }, bills)).toBe('e');
  });

  it('returns null with no match, no text, or for income', () => {
    expect(suggestBillId({ description: 'Coffee', direction: 'out' }, bills)).toBeNull();
    expect(suggestBillId({ description: '', direction: 'out' }, bills)).toBeNull();
    expect(suggestBillId({ description: 'Mortgage refund', direction: 'in' }, bills)).toBeNull();
  });

  it('skips bills with empty names', () => {
    expect(suggestBillId({ description: 'Coffee', direction: 'out' }, [{ id: 'x', name: '' }])).toBeNull();
  });
});

describe('linkRowToBill', () => {
  it('turns a bill row into an expense so no new bill is created', () => {
    expect(linkRowToBill({ type: 'bill', category: 'electricity' }, 'b1'))
      .toEqual({ type: 'expense', category: 'other', billId: 'b1' });
  });

  it('keeps an expense row category', () => {
    expect(linkRowToBill({ type: 'expense', category: 'utilities' }, 'b1').category).toBe('utilities');
  });

  it('unlinks with null and leaves the row otherwise unchanged', () => {
    expect(linkRowToBill({ type: 'expense', category: 'utilities', billId: 'b1' }, null))
      .toEqual({ type: 'expense', category: 'utilities', billId: null });
  });
});

describe('toExpenseDoc billId', () => {
  it('carries billId only when linked', () => {
    const tx = { description: 'x', amount: 1, date: '2026-01-15' };
    expect(toExpenseDoc({ ...tx, billId: 'b1' }).billId).toBe('b1');
    expect(toExpenseDoc(tx)).not.toHaveProperty('billId');
  });
});
