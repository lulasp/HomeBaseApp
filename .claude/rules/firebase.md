# Firebase / Firestore

- All Firestore reads and writes go through `src/services/firestore.js`. Never call `firebase/firestore` directly from screens, components, or contexts — add or extend a service function instead.
- Firebase initialization lives in `src/config/firebase.js`; import `db` from there, never re-initialize.
- Data is household-scoped: users belong to a `households` document with a `members` array, and feature data hangs off the household. New collections must follow this scoping.
- When adding or changing a query, keep the backend files in sync **in the same change**:
  - `firestore.rules` — every collection touched in code needs a rule enforcing household membership; undeclared collections are denied by default.
  - `firestore.indexes.json` — composite queries (multiple `where`, or `where` + `orderBy` on different fields) need a declared index.
- Use `serverTimestamp()` for created/updated fields.
- Every `onSnapshot` listener must return/store its unsubscribe function and clean up on unmount.
- Rules and indexes deploy via the Firebase CLI (`firebase deploy --only firestore:rules,firestore:indexes`) — see the `/deploy-rules` skill. Never assume a rules edit is live until deployed.
