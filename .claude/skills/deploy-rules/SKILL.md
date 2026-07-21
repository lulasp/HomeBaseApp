---
name: deploy-rules
description: Validate and deploy firestore.rules and firestore.indexes.json via the Firebase CLI. Use after editing Firestore rules or indexes, or when the app hits permission-denied / missing-index errors that local files should already cover.
---

Deploy the Firestore backend config in this repo (`firebase.json`, `firestore.rules`, `firestore.indexes.json`).

## Steps

1. **Pre-flight consistency check.** Before deploying, verify the files match the code: every collection used in `src/services/firestore.js` has a rule, and every composite query has an index entry. For a thorough pass, use the `firestore-auditor` agent. Don't deploy rules you haven't read.

2. **Validate.**
   ```bash
   npx firebase-tools --version        # confirm CLI available
   npx firebase-tools projects:list    # confirm logged in + correct project
   ```
   If not logged in, ask the user to run `! npx firebase-tools login` themselves (interactive). The target project comes from `.firebaserc` or `EXPO_PUBLIC_FIREBASE_PROJECT_ID` in the user's `.env` — confirm which project you're deploying to and state it before deploying.

3. **Dry-run the rules** (compilation check without deploy):
   ```bash
   npx firebase-tools deploy --only firestore:rules --dry-run
   ```
   Fix any compilation errors before proceeding.

4. **Deploy.** Ask for confirmation first — this changes production access control — unless the user already told you to deploy:
   ```bash
   npx firebase-tools deploy --only firestore:rules,firestore:indexes
   ```
   Note: index creation is asynchronous; large indexes take time to build after deploy.

5. **Report** what was deployed, to which project, and any indexes still building.

Never deploy rules that open access more broadly than household-membership scoping without explicitly flagging it to the user first.
