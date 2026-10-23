# Household categories — editing built-in and custom categories

**Status:** built 2026-10-22 (branch `householdEditFixes`)

Household settings → Edit Household lets members rename and re-icon **every**
category: food, non-food, bill and expense, built-in or custom. Custom ones can
still be deleted too.

## Data model

- **Built-ins live in code** (`PANTRY_CATEGORIES`, `NON_FOOD_CATEGORIES` in
  `src/utils/categories.js`; `BILL_CATS`, `EXPENSE_CATS` in
  `src/utils/financeCategories.js`). Edits to them are stored per household as
  override maps on the household doc:
  - `pantryCategoryOverrides`, `nonFoodCategoryOverrides`: keyed by the built-in's
    **original label**.
  - `billCategoryOverrides`, `expenseCategoryOverrides`: keyed by the built-in's
    `key`.
  - Each entry holds only what differs from the code default:
    `{ label?, icon? }`. An entry edited back to the default is removed.
- **Custom categories** are edited in place in the existing
  `*CustomCategories` arrays.
- Apply overrides wherever built-ins are merged with custom ones:
  `withOverrides(builtIn, overrides)` for pantry/grocery (adds `baseLabel`, the
  stable id), and `withCustomCats(builtIn, custom, overrides)` for finance.
  Finance cats carry `emoji: true` when their icon is an emoji (custom ones, or
  built-ins with an edited icon). Renderers switch on `emoji`, not `isCustom`.

## Renames

- **Finance:** bills, expenses and budgets store the category **key**, so a
  rename is display-only. No item writes.
- **Pantry/grocery:** items store the category **label**. On Save, Edit Household
  also renames the label in the enabled/order lists and runs
  `renameItemCategories(householdId, renames)`. That updates `category` on
  matching docs in `pantryItems`, `groceryItems`, `priceEntries` and
  `receiptAliases`, which are listed in `CATEGORY_LABEL_COLLECTIONS`.
  - Pending renames are folded with `addRename` (A→B→C becomes A→C, and A→B→A is
    dropped). All reads run before any write, so swaps don't cascade.
  - Writes are batched in chunks of 450 (Firestore's batch limit is 500).
  - Deleting a custom category drops any pending rename onto it. Its items keep
    their stored label, the same as before.
- Labels must be unique across food **and** non-food, because both store their
  items in the same collections.

## Locked: `Other` / `Other Non-Food`

These are fallbacks written by name in about 10 places (new items, receipt import,
the price tracker, Grocery's orphan grouping). Only their **icon** can be edited;
see `LOCKED_CATEGORY_LABELS`. Finance `other` is key-based, so it can be renamed.

## Backend

- No new collections. Members can already update the household doc freely
  (`firestore.rules`), so no rules change is needed.
- The rename queries filter on a single field (`where('category', '==', …)`),
  which uses automatic indexes, so no composite index is needed.
