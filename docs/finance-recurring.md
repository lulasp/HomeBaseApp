# Finances — recurring bills and income

**Status:** built 2026-11-06 (branch `recurringBillsIncome`), not yet released

Bills come in three types, recurring income repeats monthly, any single month
can be changed without touching the others, and all of it feeds the Overview.

## As built

- **Bill types (`billType`):** `fixed` repeats `amount` (the default, so older
  bills need no migration). `variable` repeats monthly with real amounts entered
  per month; a month without one is estimated from the latest earlier entered
  amount, else `amount`, and is labelled as an estimate. `once` applies only to
  `startMonth`, the month being viewed when it's added.
- **Data:** `bills` gained `billType`, `startMonth` and `monthOverrides`
  (`{ 'yyyy-MM': amount }`). Recurring income is the new
  `households/{id}/incomeSources` subcollection (`name, amount, ownerUid, notes,
  startMonth, monthOverrides`), covered by the existing members-only wildcard, so
  no rule or index change. One-off income stays in `expenses` as
  `direction: 'in'`, the shape statement import already writes, plus `ownerUid`.
- **Owner:** `ownerUid` is a member's uid, or null for the household. Imported
  income has no owner and counts as household.
- **One month only:** the calendar button on a card writes
  `monthOverrides.<key>`. 0 skips the month and is never used as an estimate;
  the reset button removes the entry. One-time bills are edited directly.
- **Start month:** new items start in the month being viewed. Older bills fall
  back to their earliest paid month or creation month (`startMonthOf`).
- **Overview:** `withRecurring` adds a synthetic row per active item per month
  before `cashFlow` / `monthlyTrend`, so `financeSummary.js` is unchanged. Items
  count in full whether paid or not, including the current month, and estimates
  count too. The "recurring bills" footnote excludes one-time bills.
- **Bill payments:** an expense with `billId` is a payment for that bill. Saving
  one calls `recordBillPayment`, which marks the month paid and stores the real
  amount (always for `variable`, otherwise only if it differs). `withRecurring`
  drops the expense while the bill counts for that month, so it counts once.
  Statement review pre-links rows by name (`suggestBillId`) and offers every
  payable bill; a linked row is saved as an expense and never adds a new bill.
- **Budgets:** unchanged. They read raw expenses only; bills use separate
  categories.
- Helpers: `src/utils/recurring.js`.

## Known limits

- Expenses imported before this feature aren't linked and count twice until
  linked in the expense form.
- Two payments linked to one bill in the same month: the last amount wins, and
  both are dropped from the Overview, so it reads low.
- Unlinking or deleting a payment leaves the bill marked paid with that amount.
- A row marked Bill with no link still creates a new bill.
- Changing a bill's usual amount also changes past months without an override.
- Deleting a bill or income source removes it from past months too.
