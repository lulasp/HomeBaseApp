// Pure helpers for bills and recurring income, which share the shape
// { amount, startMonth?: 'yyyy-MM', monthOverrides?: { 'yyyy-MM': number } }.
// An override sets one month only. Bills also carry `billType`:
//   'fixed'    same `amount` every month (the default, and all income)
//   'variable' every month, real amounts entered as overrides; months without
//              one are estimated from the last entered amount, else `amount`
//   'once'     a single bill in `startMonth`

import { format } from 'date-fns';

const num = (v) => Number(v || 0);

export const billTypeOf = (item) => item.billType || 'fixed';
export const isRecurringBill = (bill) => billTypeOf(bill) !== 'once';

// 'yyyy-MM' moved by `delta` months.
export function shiftMonth(key, delta) {
  const [year, month] = key.split('-').map(Number);
  return format(new Date(year, month - 1 + delta, 1), 'yyyy-MM');
}

// First month an item counts. Docs created before `startMonth` existed fall back
// to their earliest paid month or creation month; null means "always".
export function startMonthOf(item) {
  if (item.startMonth) return item.startMonth;
  const created = item.createdAt?.toDate?.();
  const candidates = [...(item.paidMonths || [])];
  if (created) candidates.push(format(created, 'yyyy-MM'));
  return candidates.sort()[0] || null;
}

export function isActiveInMonth(item, key) {
  const start = startMonthOf(item);
  if (billTypeOf(item) === 'once') return start === key;
  return !start || start <= key;
}

export function hasMonthOverride(item, key) {
  return item.monthOverrides?.[key] != null;
}

// True when a varying bill's month has no real amount yet.
export function isEstimate(item, key) {
  return billTypeOf(item) === 'variable' && !hasMonthOverride(item, key);
}

// Latest real amount before `key`. Skipped months (0) don't set the estimate.
function lastEnteredAmount(item, key) {
  const earlier = Object.keys(item.monthOverrides || {})
    .filter((k) => k < key && num(item.monthOverrides[k]) > 0)
    .sort();
  return earlier.length ? num(item.monthOverrides[earlier[earlier.length - 1]]) : null;
}

export function amountForMonth(item, key) {
  if (hasMonthOverride(item, key)) return num(item.monthOverrides[key]);
  if (billTypeOf(item) === 'variable') return lastEnteredAmount(item, key) ?? num(item.amount);
  return num(item.amount);
}

// Sum of every item active in the month, overrides applied.
export function recurringTotal(items = [], key) {
  return items.reduce((sum, item) => (
    isActiveInMonth(item, key) ? sum + amountForMonth(item, key) : sum
  ), 0);
}

// The part of recurringTotal that is estimated rather than entered.
export function estimatedTotal(items = [], key) {
  return recurringTotal(items.filter((item) => isEstimate(item, key)), key);
}

// Bills a payment dated in `key` can be linked to.
export function payableBills(bills = [], key) {
  return bills.filter((bill) => isRecurringBill(bill) || isActiveInMonth(bill, key));
}

// `expenses` plus one synthetic row per active bill / income source per month,
// so the financeSummary aggregates include recurring money unchanged. An expense
// linked to a bill (`billId`) is dropped when that bill already counts for its
// month, so a payment isn't counted twice; if the bill is gone, the expense counts.
export function withRecurring(expenses = [], bills = [], incomeSources = [], keys = []) {
  const billById = new Map(bills.map((bill) => [bill.id, bill]));
  const rows = expenses.filter((e) => {
    const bill = e.billId && billById.get(e.billId);
    return !(bill && e.date && isActiveInMonth(bill, e.date.substring(0, 7)));
  });
  for (const key of keys) {
    const date = `${key}-01`;
    for (const bill of bills) {
      if (isActiveInMonth(bill, key)) {
        rows.push({ amount: amountForMonth(bill, key), date, direction: 'out' });
      }
    }
    for (const source of incomeSources) {
      if (isActiveInMonth(source, key)) {
        rows.push({ amount: amountForMonth(source, key), date, direction: 'in' });
      }
    }
  }
  return rows;
}

// A month's income: recurring sources, one-off `direction: 'in'` rows, totals,
// and a high→low split by owner (`ownerUid` null = the whole household).
export function incomeForMonth(incomeSources = [], expenses = [], key) {
  const recurring = incomeSources.filter((s) => isActiveInMonth(s, key));
  const oneOff = expenses.filter((e) => e.direction === 'in' && e.date?.substring(0, 7) === key);

  const owners = new Map();
  const add = (ownerUid, amount) => {
    const owner = ownerUid || null;
    owners.set(owner, (owners.get(owner) || 0) + amount);
  };
  recurring.forEach((s) => add(s.ownerUid, amountForMonth(s, key)));
  oneOff.forEach((e) => add(e.ownerUid, num(e.amount)));

  const recurringSum = recurringTotal(recurring, key);
  const oneOffTotal = oneOff.reduce((sum, e) => sum + num(e.amount), 0);
  return {
    recurring,
    oneOff,
    recurringTotal: recurringSum,
    oneOffTotal,
    total: recurringSum + oneOffTotal,
    byOwner: [...owners]
      .map(([ownerUid, amount]) => ({ ownerUid, amount }))
      .sort((a, b) => b.amount - a.amount),
  };
}
