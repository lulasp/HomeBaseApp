// Pure aggregation helpers for the Finances screen: cash flow, spending by
// category, month-over-month trend, and budget progress. All operate on the
// `expenses` collection shape ({ amount, date: 'yyyy-MM-dd', direction, category }).
// Income rows carry direction 'in' and never count toward spending.

import { format } from 'date-fns';

const isIncome = (e) => e.direction === 'in';
const amt = (e) => Number(e.amount || 0);

export function monthKey(date = new Date()) {
  return format(date, 'yyyy-MM');
}

// Income / spending / net / savings rate for a single 'yyyy-MM' month.
export function cashFlow(expenses = [], key) {
  let income = 0;
  let spending = 0;
  for (const e of expenses) {
    if (!e.date || e.date.substring(0, 7) !== key) continue;
    if (isIncome(e)) income += amt(e);
    else spending += amt(e);
  }
  const net = income - spending;
  const savingsRate = income > 0 ? net / income : 0;
  return { income, spending, net, savingsRate };
}

// Spending grouped by category for a month, high→low. Income excluded.
export function spendingByCategory(expenses = [], key) {
  const map = {};
  for (const e of expenses) {
    if (!e.date || e.date.substring(0, 7) !== key || isIncome(e)) continue;
    const c = e.category || 'other';
    map[c] = (map[c] || 0) + amt(e);
  }
  return Object.entries(map)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

// The last `months` calendar months up to and including `ref`, oldest→newest.
// Each bucket: { key, label, income, spending }.
export function monthlyTrend(expenses = [], months = 6, ref = new Date()) {
  const buckets = [];
  const index = {};
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
    const key = format(d, 'yyyy-MM');
    const bucket = { key, label: format(d, 'MMM'), income: 0, spending: 0 };
    index[key] = bucket;
    buckets.push(bucket);
  }
  for (const e of expenses) {
    if (!e.date) continue;
    const bucket = index[e.date.substring(0, 7)];
    if (!bucket) continue;
    if (isIncome(e)) bucket.income += amt(e);
    else bucket.spending += amt(e);
  }
  return buckets;
}

// Merge budgets ([{ category, amount }]) with a month's spending.
// Rows sorted by usage ratio desc: { category, budget, spent, remaining, ratio, over }.
export function budgetProgress(budgets = [], expenses = [], key) {
  const spent = {};
  for (const { category, amount } of spendingByCategory(expenses, key)) {
    spent[category] = amount;
  }
  return budgets
    .map((b) => {
      const budget = Number(b.amount || 0);
      const used = spent[b.category] || 0;
      const ratio = budget > 0 ? used / budget : 0;
      return {
        category: b.category,
        budget,
        spent: used,
        remaining: budget - used,
        ratio,
        over: used > budget,
      };
    })
    .sort((a, b) => b.ratio - a.ratio);
}
