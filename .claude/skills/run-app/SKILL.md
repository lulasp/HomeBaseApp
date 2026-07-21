---
name: run-app
description: Start the Expo dev server or an iOS/Android build and verify a change in the running app. Use when asked to run the app, or to confirm a code change actually works beyond tests.
---

Run this Expo SDK 56 app and verify behavior.

## Choosing how to run

- **JS-only change** (screens, services, contexts — the common case): the dev server is enough.
  ```bash
  npm start        # expo start; press i for iOS simulator, w for web
  ```
  Run it in the background and watch the output for the QR code / bundler errors.
- **Native or config change** (`app.config.js`, `app.json` plugins, new native dependency, anything touching `ios/`): a rebuild is required — Metro reload is not sufficient.
  ```bash
  npm run ios      # expo run:ios (needs Xcode + pods)
  ```
- **Quick sanity check with no simulator available**: `npm run web` — but remember several features (notifications, Google Sign-In, native modules) don't behave the same on web; don't treat web as verification for native-facing changes.

## Prerequisites

- A populated `.env` must exist (Firebase config at minimum — see `.env.example`); without it the app won't sign in. If missing, tell the user rather than fabricating values.
- For `npm run ios`: if pods are stale after native changes, run `npx pod-install` first.

## Verifying a change

1. Start the app with the appropriate command above (in the background) and wait for the bundler to report ready; surface any red-screen/bundler errors immediately.
2. State exactly which screen/flow exercises the change and what you expect to see.
3. If you can't drive the UI yourself, give the user a short, specific checklist ("open Pantry tab, add an item, toggle dark mode in Settings") instead of claiming it works.
4. For theme-sensitive changes, check both light and dark mode; for data changes, watch the Metro logs for Firestore permission/index errors.
5. Stop the dev server when done.
