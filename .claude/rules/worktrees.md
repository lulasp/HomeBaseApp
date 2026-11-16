# Parallel work with git worktrees

Several features are built at the same time, each by its own agent in its own **git
worktree**: a separate folder with its own branch, sharing one `.git`. Agents never share a
working directory.

Branch flow (`master` → production, `staging` → integration/preview, the re-sync step) is in
`git-workflow.md`. Every feature branch starts from `origin/staging`, and its PR targets
`staging`, never `master`.

## Layout

```
~/projects/HomeBaseApp/                    main checkout (staging / housekeeping)
~/projects/HomeBaseApp-worktrees/
  .ports                                   port registry (not in git)
  .rules-lock                              who may change/deploy Firestore rules & indexes (not in git)
  <feature>/                               one worktree per feature, branch <feature>
```

The `HomeBaseApp-worktrees/` folder lives outside the repo on purpose, so tooling, the IDE,
Metro, and `git status` don't see the worktrees twice.

## Starting a feature

```bash
cd ~/projects/HomeBaseApp
git fetch
git worktree add ../HomeBaseApp-worktrees/<feature> -b <feature> origin/staging
git -C ../HomeBaseApp-worktrees/<feature> branch --unset-upstream   # push later sets the real one
cp .env .env.local ../HomeBaseApp-worktrees/<feature>/ 2>/dev/null
cd ../HomeBaseApp-worktrees/<feature> && npm install
```

- Branch from `origin/staging` unless the user says to stack on another branch.
- Branch names follow this repo's convention: short camelCase, no prefix
  (`householdDateCurrency`, `financeMultiDelete`).
- Claim a Metro port in `../HomeBaseApp-worktrees/.ports` (one line: `<port> <feature>`).
  Ports start at **8082**; 8081 (Expo's default) stays with the main checkout.
- From here on, every command for that feature runs inside its worktree folder.

## Worktrees created by Orca

The user may create a worktree from Orca's "+" button instead. Orca skips the setup steps
above, so it differs in a few ways:

- It lives at `~/orca/workspaces/HomeBaseApp/<name>`, on branch `lulasp/<name>`. Keep both.
  Don't rename the branch or move the folder.
- **No `.env` / `.env.local`** (gitignored), so Firebase init fails and the app won't load.
  Agents can't read or copy `.env*` files, so check with `test -f .env` before anything else.
  If it's missing, ask the user to run
  `! cp ~/projects/HomeBaseApp/.env ~/projects/HomeBaseApp/.env.local .` in the worktree.
- **No port claimed.** Add a line to `~/projects/HomeBaseApp-worktrees/.ports`.
- Run `npm install` if `node_modules` is missing.
- Leave alone any worktree under `~/orca/workspaces/.orca-preparing/`. Orca is still creating it.

Everything below still applies: rules lock, build → test → approval, and the compare link
(with the `lulasp/<name>` branch). After merge, the user removes the worktree in Orca. Don't
run `git worktree remove` on it.

## Firestore rules & indexes: one change at a time

All worktrees talk to the same Firebase project. `firebase deploy --only firestore:rules`
replaces the **whole** rules file, so deploying from one branch silently drops rules another
branch deployed. So:

- Only the worktree named in `../HomeBaseApp-worktrees/.rules-lock` may edit `firestore.rules`
  / `firestore.indexes.json` or run `/deploy-rules`. Claim the lock first. If someone else holds
  it, stop and tell the user. Don't wait silently, and don't work around the lock.
- New direct subcollections of `households/{id}` are already covered by the wildcard rule
  (see `firebase.md`) and need no lock.
- Every other worktree works against the currently deployed rules and indexes.
- Release the lock (empty the file) once that PR is merged into `staging`, not just pushed.
- After it merges, the other worktrees rebase onto `origin/staging` before relying on it.
- Data is shared too: anything one worktree writes to Firestore, every worktree sees. Ask
  before bulk-deleting or migrating real household data.

## Build → manual test → approval

1. Build the change, then run `npm test` in the worktree.
2. Start the dev server **in the background**: `npx expo start --web --port <port>`. Never
   kill or restart it (or anyone else's) without asking. The user stops it.
3. Hand over a short test script: the URL on `http://localhost:<port>`, which account /
   household to use, and what to click and check (happy paths, edge cases, light + dark, both
   languages where text changed).
4. Fix whatever the user reports, and repeat from step 1.
5. **When the user approves** ("approved", "ship it", "looks good, push"): commit and push that
   worktree's branch without asking again (`git push -u origin <branch>`). The approval covers
   only that feature and only its current state. If more changes come after it, the user has
   to approve again.
6. Reply with the PR description in a code block (what it does, decisions, how it was tested,
   known gaps) and the compare link
   `https://github.com/lulasp/HomeBaseApp/compare/staging...<branch>?expand=1`.
   The user opens the PR.

## After merge

```bash
cd ~/projects/HomeBaseApp
git worktree remove ../HomeBaseApp-worktrees/<feature>
git branch -d <feature>
```

Then remove the line from `.ports`, and release `.rules-lock` if that worktree held it.
Ask the user to stop that worktree's dev server first, or stop it yourself only if they say so.

## Known limits

- **One sign-in across all ports.** Browsers don't separate storage by port for cookies, and
  every worktree uses the same Firebase project, so test accounts are shared. To be two users
  at once, use a private window, a second browser profile, or `127.0.0.1:<port>` for one of
  them (a different origin, so its own auth state).
- **Google sign-in** on web works on any `localhost` port (Firebase authorizes `localhost`,
  not a port). Vercel previews of feature branches are *not* authorized — see
  `git-workflow.md` → use `staging` for that.
- **Native builds** (`npm run ios` / `android`) generate `ios/` / `android/` per worktree and
  share one simulator. Run native builds from one worktree at a time.
- Each worktree has its own `node_modules` and `.expo` cache. After `package.json` changes on
  staging, run `npm install` again in each worktree. If Metro serves stale code after a
  rebase, restart it with `--clear` (ask the user before stopping the server).
