// Pure helpers for the bank-statement importer. No side effects — unit-tested.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Normalise one AI-parsed transaction into a safe, predictable shape.
// Unknown/garbage fields fall back to sensible defaults so the review UI
// never has to guard against them.
export function normalizeTransaction(tx, { validCategoryKeys = [] } = {}) {
  const amount = Math.abs(Number(tx?.amount) || 0);
  const date = ISO_DATE.test(tx?.date) ? tx.date : '';
  const direction = tx?.direction === 'in' ? 'in' : 'out';
  const type = tx?.type === 'bill' ? 'bill' : 'expense';
  const rawCat = typeof tx?.category === 'string' ? tx.category : 'other';
  const category = validCategoryKeys.includes(rawCat) ? rawCat : 'other';
  return {
    date,
    description: (tx?.description ?? '').toString().trim(),
    amount,
    direction,
    type,
    category,
  };
}

// Collapse whitespace/case so descriptions compare loosely.
function normDesc(s) {
  return (s ?? '').toString().toLowerCase().replace(/\s+/g, ' ').trim();
}

// A parsed row duplicates an existing expense when the date and amount match
// and their descriptions overlap (one contains the other after normalising).
export function isDuplicate(tx, existing) {
  if (!tx.date || !tx.amount) return false;
  const a = normDesc(tx.description);
  return existing.some((e) => {
    if (e.date !== tx.date) return false;
    if (Math.abs(Number(e.amount || 0) - tx.amount) > 0.005) return false;
    const b = normDesc(e.title ?? e.description);
    if (!a || !b) return true; // same date+amount, no text to disprove it
    return a === b || a.includes(b) || b.includes(a);
  });
}

// Return each parsed row tagged with `duplicate` against existing expenses.
export function flagDuplicates(transactions, existingExpenses = []) {
  return transactions.map((tx) => ({ ...tx, duplicate: isDuplicate(tx, existingExpenses) }));
}

// Convert a reviewed transaction into the Firestore expense doc shape.
export function toExpenseDoc(tx, { paidBy = '' } = {}) {
  return {
    title: tx.description || 'Imported transaction',
    category: tx.category || 'other',
    amount: tx.amount,
    date: tx.date,
    direction: tx.direction || 'out',
    paidBy,
    notes: 'Imported from bank statement',
  };
}

// Convert a reviewed recurring transaction into the Firestore bill doc shape.
export function toBillDoc(tx) {
  return {
    name: tx.description || 'Imported bill',
    category: tx.category || 'other',
    amount: tx.amount,
    dueDayOfMonth: tx.date ? Number(tx.date.slice(8, 10)) : 1,
    notes: 'Imported from bank statement',
  };
}
