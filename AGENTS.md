# Project overview

Household management app (pantry, grocery, recipes, bills, nutrition +
body/weight goals, smart lights, AI assistant) built with Expo SDK 56 / React Native 0.85 /
React 19, Firebase Auth + Firestore backend, shared per-household.

# Commands

- `npm start` — Expo dev server · `npm run ios` / `npm run android` — native build
- `npm test` — Jest (jest-expo); single file: `npm test -- <file>`
- Architecture: screens in `src/screens/<feature>/`, data via `src/services/`,
  state in `src/context/` — details in the rules below.
- Feature design docs live in `docs/` (e.g. `docs/weight-tracker.md` for the
  Nutrition → Body & goals feature); read the relevant one before changing it.

# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Project rules

@.claude/rules/expo.md
@.claude/rules/firebase.md
@.claude/rules/secrets.md
@.claude/rules/ui.md
@.claude/rules/web-scroll.md
@.claude/rules/testing.md
@.claude/rules/git-workflow.md
