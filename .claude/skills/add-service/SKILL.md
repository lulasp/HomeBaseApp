---
name: add-service
description: Add an external API integration as a new module in src/services/ with env-based or per-user keys and tests. Use when integrating a third-party HTTP API (like the existing Govee, Spoonacular, Gemini, Xiaomi services).
---

Add an external API client following the existing service patterns. Read `src/services/govee.js` (per-user key, small `request` helper, exported pure helpers) and `src/services/spoonacular.js` (env key) before writing.

## Steps

1. **Key strategy** — decide with the user if unclear:
   - App-wide key: `EXPO_PUBLIC_<NAME>_API_KEY` read from `process.env`; add the empty entry to `.env.example`. Remember `EXPO_PUBLIC_*` values ship in the client bundle.
   - Per-user key (user enters it in Settings, stored in their profile): pass the key as the first parameter to service functions, like `src/services/govee.js`.

2. **Module** — create `src/services/<name>.js`:
   - A `BASE` URL constant and one small private `request(...)` helper that handles auth headers, JSON parsing, and error handling; every endpoint function goes through it.
   - Keep response-shaping logic in **exported pure functions** (parsers, converters, state mappers) separate from fetch calls — this is what makes the module testable.
   - No React imports; services are plain JS modules.

3. **Tests** — `src/__tests__/<name>.test.js`: thorough cases for the pure helpers, mocked `fetch` for request construction and error paths. Never hit the real API. Run `npm test`.

4. **Wire up** — consume the service from the relevant screen/context. If usage requires new Expo APIs or packages, verify against https://docs.expo.dev/versions/v56.0.0/ and install with `npx expo install`.

Never hardcode or log key values; never commit a populated `.env`.
