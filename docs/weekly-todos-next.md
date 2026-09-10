# Weekly todos — week navigation, carry-over, recurring tasks

**Status:** proposal, not started · **Written:** 2026-09-10

Design for the two larger todo-list features that were scoped but not built.
The edit / reorder / move / safe-delete work is already shipped in
`src/screens/home/HomeScreen.js` (`WeeklyCalendar`) and
`src/services/firestore.js` (`subscribeWeeklyTodos` … `updateWeeklyTodo`).

## Where we are today

- One `weeklyTodos` doc per task: `{ weekKey, day, text, done, createdAt, updatedAt }`.
- `weekKey` is `startOfWeek(new Date(), { weekStartsOn: 1 })` formatted `yyyy-MM-dd`,
  computed in `HomeScreen` and passed down. There is no way to reach another week.
- Subscription is one `where('weekKey', '==', …)` and nothing else. Ordering by
  `createdAt` is done client-side on purpose: `where` + `orderBy` on different
  fields needs a composite index, and this project has never deployed one
  (`firestore.indexes.json` is empty, the Firebase CLI isn't installed locally).
  We tried it, the undeployed index killed the listener, and the widget showed
  stale rows that silently stopped updating. Keep any new query single-filter.
- When the week rolls over on Monday, last week's unfinished tasks are still in
  Firestore but nothing renders them — they are effectively lost.

## 1. Week navigation

### Data
No schema change, and no index change — `weekKey` already partitions by week, so
pointing the same single-filter query at a different key is all it takes.

### UI
Move `weekKey` from a derived constant into `WeeklyCalendar` state as a
`weekOffset` integer (0 = current week), and derive:

```js
const weekStart = addWeeks(startOfWeek(new Date(), { weekStartsOn: 1 }), weekOffset);
const weekKey   = format(weekStart, 'yyyy-MM-dd');
```

Header row (`widgetHeaderRow`) becomes: `‹  THIS WEEK / Sep 8–14  ›  3/7 done`.

- Label: `weekOffset === 0 ? 'THIS WEEK' : format range`, so the common case is unchanged.
- The "today" ring on a day tab (`isToday && !isSelected`) must only render when
  `weekOffset === 0` — otherwise Wednesday looks like today in every week.
- On changing week, reset `selectedDay` to `todayFull` for offset 0 and to Monday
  otherwise, and `cancelEdit()`.
- Bound the range to roughly `-8 … +8` weeks so the arrows can't wander forever.

### Cost
The `onSnapshot` re-subscribes on every arrow press (the `useEffect` already
keys on `weekKey`). Fine — a week is at most 105 docs.

## 2. Carry-over

The rule: **unfinished tasks from the previous week appear at the top of the
current week until dealt with.** Two candidate designs.

### Option A — copy-on-open (recommended)

When `WeeklyCalendar` mounts on the current week, read last week's docs once
(`getDocs`, not a listener), find `done === false`, and offer to bring them
forward. Do *not* copy silently — a "3 tasks from last week · Bring forward /
Dismiss" strip above the day tabs is honest and reversible.

Bringing forward = `updateWeeklyTodo(id, { weekKey: thisWeek, day: <same day> })`,
batched. Moving rather than copying keeps a single source of truth and means a
task can't be completed twice.

Needs a `carriedFrom: <oldWeekKey>` field so the row can show a small "carried"
badge, and a `carryOverDismissedWeek` marker on the household doc (or on the
member's profile) so Dismiss sticks and the strip doesn't reappear every mount.

Requires no new index — it's the same single-`where` query on the previous
`weekKey`.

### Option B — query two weeks

Change the subscription to `where('weekKey', 'in', [lastWeek, thisWeek])` and
render unfinished last-week tasks inline with a badge. No writes, no dismissal
state, and a task naturally disappears when ticked.

Downside: the day tabs now mix two weeks, the "N/M done" count gets ambiguous,
and week navigation (feature 1) interacts badly — which pair of weeks are you
looking at? Rejected unless week navigation is dropped.

### Edge case worth deciding
If someone is away for three weeks, Option A only reaches back one week. Either
walk back N weeks on mount (N queries) or accept that only the immediately
previous week carries. Recommend: one week, and let week navigation cover the rest.

## 3. Recurring tasks

### Data — a separate collection

Recurrence does **not** belong on the todo doc; a todo is one instance on one
day of one week, and a rule outlives all of them. New collection under the
household (covered by the existing wildcard subcollection rule in
`firestore.rules:36`):

```
households/{hh}/todoRecurrences/{id}
  text: 'Take the bins out'
  days: ['Tuesday']          // one or more FULL_DAYS
  active: true
  createdAt / updatedAt
  lastMaterializedWeek: '2026-09-07'
```

### Materialization

Generate instances lazily, client-side, the first time the current week's
calendar is opened:

1. Subscribe to `todoRecurrences` where `active == true` (single `where`, no new index).
2. If `lastMaterializedWeek !== currentWeekKey`, write one `weeklyTodos` doc per
   `(rule, day)` with `recurrenceId: <id>` and bump `lastMaterializedWeek` — all
   in one `writeBatch` so a partial failure doesn't half-fill the week.
3. `lastMaterializedWeek` is what makes this idempotent across household members
   opening the app at the same time. It is *not* airtight — two clients can race
   before either write lands. Cheap guard: before writing, check the week for
   existing docs with the same `recurrenceId`. A transaction on the rule doc is
   the correct fix if duplicates show up in practice.

Materializing only the current week (not future weeks) keeps week navigation
honest: forward weeks show what's actually planned, not projected ghosts.

### Interaction with the existing cap
`MAX_TODOS_PER_DAY = 15` must be enforced during materialization too — skip and
warn rather than blowing past it.

### UI
- The add row gets a small repeat toggle, or a long-press on an existing task →
  "Repeat weekly". Reuse `showOptions` from `AlertContext` for picking days if
  the chip row gets crowded.
- Recurring instances render with a `repeat-outline` icon.
- Deleting one instance deletes only that week's doc. Deleting the *rule* needs
  its own affordance — a "Repeating tasks" section in Household settings is the
  honest place, since the rule is household-wide state, not a home-screen widget.

### Why not server-side
There is no Cloud Functions setup in this project. Lazy client materialization
avoids adding one; the cost is that a week only fills in once someone opens the
app, which is exactly when it matters.

## Suggested order

1. Week navigation — self-contained, no schema change, and carry-over needs the
   week-key plumbing anyway.
2. Carry-over (Option A) — depends on 1.
3. Recurring tasks — biggest surface, new collection and a settings screen.
