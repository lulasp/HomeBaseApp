---
name: new-feature
description: Scaffold a new feature in this app — screen folder, optional service, navigation entry, Firestore wiring, and tests — following the established pantry/grocery/bills pattern. Use when adding a new feature area or screen.
---

Scaffold a feature the way the existing ~12 features (pantry, grocery, recipes, bills, nutrition, lights, …) are built. The feature name is given in the arguments; if anything essential is ambiguous (data model, whether it needs an external API), ask before writing code.

## Steps

1. **Calibrate.** Read one comparable existing feature end-to-end first — screen (`src/screens/pantry/PantryScreen.js` is a good template), its service functions in `src/services/firestore.js`, and its entry in `src/navigation/index.js`.

2. **Screen.** Create `src/screens/<feature>/<Feature>Screen.js`:
   - Colors via `ThemeContext` from `src/theme/colors.js` — no hardcoded colors; must work in light and dark.
   - Reuse `src/components/` (AlertModal, ToastNotification, DatePickerInput, …) instead of building new primitives.
   - Include loading, empty, and error states for data-backed screens.
   - Safe areas via `react-native-safe-area-context`.

3. **Data layer.** If the feature stores data, add household-scoped CRUD functions to `src/services/firestore.js` following the existing naming style, and update **in the same change**:
   - `firestore.rules` — rule for the new collection enforcing household membership.
   - `firestore.indexes.json` — composite index for any multi-field query.
   If the feature calls an external API instead, use the `/add-service` skill for that part.

4. **Navigation.** Register the screen in `src/navigation/index.js` (tab or stack, matching how similar features are wired; custom tab bar is `src/navigation/TabBar.js`).

5. **Tests.** Add `src/__tests__/<module>.test.js` for any new service/util logic, matching existing test style. Run `npm test`.

6. **Verify.** Start the app (`npm start`) and confirm the screen renders and navigates in both themes.

Follow the project rules in `.claude/rules/` throughout (expo.md, firebase.md, ui.md, secrets.md, testing.md).
