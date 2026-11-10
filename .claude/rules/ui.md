# UI conventions

- Colors come only from `src/theme/colors.js`, consumed through `ThemeContext`. No hardcoded hex/rgb values in screens or components. Light and dark palettes both exist — every screen must work in both.
- Use semantic tokens for meaning: `danger` for destructive, `success`/`warning` for status, `primary`/`accent` for emphasis.
- File layout:
  - Screens: `src/screens/<feature>/<Name>Screen.js` (one folder per feature: pantry, grocery, recipes, bills, nutrition, lights, xiaomi, emergency, ai, auth, settings, home).
  - Reusable UI: `src/components/`. Before building UI, check what already exists there — `AlertModal`, `ToastNotification`, `DatePickerInput`, `DraggableCategoryList`, `LightShortcutsRow` — and reuse rather than reimplement.
  - App-wide state: `src/context/` (`AuthContext`, `AlertContext`, `NotificationContext`, `ThemeContext`, `NavScrollContext`, `LightTimerContext`). Don't duplicate state a context already owns.
- Navigation is React Navigation (bottom tabs + stacks) with a custom `src/navigation/TabBar.js`; new screens are registered in `src/navigation/index.js`.
- Handle safe areas with `react-native-safe-area-context`. Data-backed screens need loading, empty, and error states.
- Use the alert/toast contexts (`AlertContext`, `ToastNotification`) instead of React Native's `Alert.alert`.
- All user-facing text goes through `t()` from `src/i18n` (or `useLanguage()`), with the key added to both `src/i18n/en.js` and `src/i18n/pt.js` in the same change. Never hardcode strings. See `docs/translations.md`.
- Show dates and money through `src/utils/format.js` (`formatDate`, `formatMoney`, `dayName`, …), never with hardcoded `$` or date-fns patterns, and call `useFormat()` in the component so it follows the household's Date & currency setting. See `docs/date-currency.md`.
