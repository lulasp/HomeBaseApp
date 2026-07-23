# Git & deployment workflow

Vercel builds from git. Two long-lived branches map to environments:

- **`master`** → production (the production domain).
- **`staging`** → a fixed preview environment. Its stable Vercel URL
  (`home-app-git-staging-<scope>.vercel.app`) is added to Firebase
  **Authorized domains** once, so Google sign-in works there without re-adding a
  domain per feature branch. Test auth-dependent changes here.

Feature branches also get their own auto-preview (`home-app-git-<branch>-…`),
fine for quick UI checks but **not** authorized in Firebase — route through
`staging` when you need to test sign-in.

## The cycle

```bash
# 1. Branch off staging (== master when synced)
git checkout staging && git pull
git checkout -b my-feature
# ...work, commit...
git push -u origin my-feature          # own Vercel preview

# 2. Promote to the staging environment to test
git checkout staging
git merge my-feature
git push                               # rebuilds the stable staging URL

# 3. Ship to production
git checkout master
git merge staging
git push                               # production deploy

# 4. Re-sync staging so it stays identical to master for next time
git checkout staging
git merge origin/master
git push
```

## Why step 4 matters

Merging `staging` → `master` via a GitHub PR creates a **merge commit** on
master that staging lacks. The code is identical but the history diverges by one
commit; left alone it makes future feature diffs show phantom drift. Step 4
fast-forwards staging back up. If it ever gets tangled and staging holds no
unique commits, reset instead: `git reset --hard origin/master && git push
--force-with-lease`.

To avoid the chore entirely, promote locally with a fast-forward instead of a
GitHub PR — `git checkout master && git merge --ff-only staging && git push` —
which leaves master and staging pointing at the same commit (no re-sync needed,
but no PR record).
