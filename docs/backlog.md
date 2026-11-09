# Backlog

Planned features, not started. Move a task into its own design doc in `docs/`
when work begins.

## 1. Language: English or Portuguese

Let each user choose to see the app in English or Portuguese.

- Today every string is hardcoded in English and no i18n library is installed.
  Covers every screen in `src/screens/` plus the shared components, alerts and
  toasts.
- Open questions:
  - Is the language per user or per household? Per user seems right.
  - European or Brazilian Portuguese?
  - Should the first launch default to the phone's language
    (`expo-localization`)?
  - Should dates and currency format follow the language? `date-fns` has
    locales for this.
  - Should the AI assistant reply in the chosen language?
- Likely approach: `i18next` + `react-i18next`, with one file of strings per
  language, a language picker in settings, and the choice saved on the user's
  profile. Install with `npx expo install`.
- Large but mechanical: do it one screen at a time.

## 2. Finances: select several items and delete them together

On the Expenses, Income and Bills tabs, select multiple items and delete them
in one go.

- Today each card is deleted on its own after a confirm
  (`BillsExpensesScreen.js`: `deleteBill`, `deleteExpense`,
  `deleteIncomeSource`).
- Suggested UI: long-press a card to enter selection mode, tap to add or remove
  cards, then a bar with the count, "Select all" and Delete. Ask for
  confirmation once for the whole selection, via `AlertContext`.
- Add a batched delete in `src/services/firestore.js` (`writeBatch`, at most
  500 per batch) so it all succeeds or fails together.
- Things to decide:
  - Deleting a bill removes it from past months. Should the confirm warn about
    that?
  - Should deleting a payment linked to a bill unmark the bill as paid? See
    the known limits in `finance-recurring.md`.
  - Does "Select all" mean the month being viewed, or everything in the list?
