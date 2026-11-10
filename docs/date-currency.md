# Date & currency

**Status:** built 2026-11-10 (branch `householdDateCurrency`), not yet released

Household settings → Date & currency sets how dates and money look for
everyone in the household. Month and day names follow each person's language
(see `docs/translations.md`).

## Options

- **Date format:** `10/11/2026` (day/month, the default), `11/10/2026`
  (month/day), `2026-11-10`, or `10 Nov 2026` (month name in the person's
  language). Where there's no room for the year, the short form drops it
  (`10/11`, `10 Nov`).
- **Currency:** Euro `1.234,56 €`, US dollar `$1,234.56` (the default, because
  amounts were shown in dollars before), or Brazilian real `R$ 1.234,56`. The
  number style follows the currency, and calorie counts use the same separators.
  **Amounts are never converted:** changing currency only changes how they are
  shown.

## Data

Stored as `dateFormat` (`dmy` | `mdy` | `iso` | `long`) and `currency`
(`EUR` | `USD` | `BRL`) on the members-only `households/{id}/private/data` doc,
next to `reduceMotion`, through `updateHouseholdFormat`. No rules change was
needed. Missing values fall back to `dmy` / `USD`.

## Code

- `src/utils/format.js`: `formatMoney`, `formatMoneyCompact`, `formatNumber`,
  `currencySymbol`, `formatDate` (`{ short }`), `formatMonthYear`,
  `formatMonthKey`, `formatMonthShort`, `formatLocalized` and `dayName`
  (stored English weekday names, shown translated). The active settings live at
  module level, the same way as the language, and `HouseholdProvider` keeps
  them in sync.
- `src/hooks/useFormat.js`: screens and `memo` components call it so they
  re-render when the setting or the language changes.
- Stored values are unchanged: dates are still saved as `yyyy-MM-dd`, weekdays
  as `Monday`, and amounts as plain numbers.

## Not covered

- Reminder times keep their existing 12-hour display.
- `DesignShowcaseScreen` is not in the navigation and was not changed.
