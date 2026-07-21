# Secrets & API keys

- Never hardcode API keys, client IDs, or project identifiers in source. Build-time config comes from `EXPO_PUBLIC_*` environment variables (see `.env.example`): Firebase config, Spoonacular, and the Google OAuth web/iOS client IDs.
- When adding a new key: add the empty entry to `.env.example` (name only, no value), read it via `process.env.EXPO_PUBLIC_<NAME>` in code, and never commit a populated `.env`.
- Some integrations use per-household API keys entered in the app (Household settings) and stored on the household doc — those are passed as parameters to service functions, not read from env. Govee (`src/services/govee.js`) and OpenRouter / AI (`src/services/openrouter.js`, `openRouterApiKey`) both follow this pattern.
- Remember `EXPO_PUBLIC_*` values are embedded in the client bundle — they are not secret from the user. Anything that must stay server-side secret does not belong in this app.
- Never print, log, or commit values from `.env`; if a key is accidentally committed, flag it for rotation.
