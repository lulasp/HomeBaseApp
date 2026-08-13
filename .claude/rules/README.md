# Rules

Focused project rules, loaded every session via `@.claude/rules/<name>.md` references in `AGENTS.md`.

Rules in this project:

- **expo.md** — SDK 56 versioned docs are the source of truth; `npx expo install`; `app.config.js` conventions; when a native rebuild is needed.
- **firebase.md** — all Firestore access through `src/services/firestore.js`; household scoping; keep `firestore.rules` and `firestore.indexes.json` in sync with queries.
- **secrets.md** — `EXPO_PUBLIC_*` env vars via `.env.example`; per-user keys (Govee) as function params; nothing hardcoded or logged.
- **ui.md** — theme colors only, light+dark support, file layout, reuse of existing components/contexts, navigation registration.
- **web-scroll.md** — react-native-web `ScrollView` needs a definite pixel height (not `flex: 1`); pin to `windowHeight` on web. The recurring "page won't scroll on web" gotcha.
- **testing.md** — jest-expo conventions, what needs tests, mocking policy, `npm test` before commits.
- **git-workflow.md** — `master`→production / `staging`→fixed preview branch mapping; feature→staging→master cycle; the re-sync step that keeps staging identical to master.
