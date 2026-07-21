# Expo

- This project pins **Expo SDK 56** (`expo ~56.0.8`, React Native 0.85, React 19). Expo APIs change between SDKs — verify against the versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing or changing any Expo/React Native API usage. Do not rely on memory of older SDKs.
- Install packages with `npx expo install <pkg>`, never plain `npm install`, so versions match the SDK.
- Use Expo CLI commands (`npx expo start`, `expo run:ios`, `expo run:android`) — never bare React Native CLI commands.
- App config lives in `app.config.js` (it wraps `app.json` and adds a `withModularHeaders` iOS Podfile mod plus the Google OAuth reverse-client-ID URL scheme). Config edits go in `app.json` for static values or `app.config.js` for computed ones.
- The native `ios/` folder is checked in: config-plugin or native-dependency changes require a rebuild (`npx expo prebuild --platform ios` then `npm run ios`), not just a Metro reload.
