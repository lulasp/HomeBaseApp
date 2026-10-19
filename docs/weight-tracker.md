# Body & goals — weight, height, calorie target

**Status:** v1 built, not yet released · **Written:** 2026-10-19

Per-member body tracking inside the Nutrition feature: profile (height, age,
sex, activity, goal), a weight log with trend chart, goal-weight progress, and a
suggested daily calorie target that the meal planner compares against.

## Decisions

- **Scope:** one profile per signed-in member (keyed by `uid`), readable by the
  whole household. Writes are UI-restricted to your own data; Firestore rules
  stay on the existing members-only wildcard (same trust level as all other
  household data — no rules/index deploy needed).
- **Placement:** inside Nutrition. `Nutrition` tab becomes a stack:
  `NutritionHome` (planner) → `BodyGoals` (new screen).
- **Units:** metric only (kg, cm).
- **Formula:** Mifflin-St Jeor BMR × activity multiplier = TDEE, adjusted for
  goal (lose / maintain / gain) at a chosen weekly rate. Also shows BMI.

## Data model

`households/{hid}/bodyProfiles/{uid}`

```
{ sex: 'male'|'female', birthDate: 'yyyy-MM-dd', heightCm: number,
  activityLevel: 'sedentary'|'light'|'moderate'|'active'|'veryActive',
  goal: 'lose'|'maintain'|'gain', weeklyRateKg: 0.25|0.5|0.75,
  goalWeightKg: number|null, updatedAt }
```

`households/{hid}/weightLogs/{uid}_{yyyy-MM-dd}`

```
{ uid, date: 'yyyy-MM-dd', weightKg: number, createdAt, updatedAt }
```

- Deterministic doc id → one weigh-in per user per day; re-logging overwrites.
- Query is a single `where('uid', '==', uid)`, sorted client-side by `date`
  (no composite index — see `docs/weekly-todos-next.md` for why).
- "Current weight" = latest log; the profile does not store weight.

## Math (`src/utils/bodyMetrics.js`, pure + tested)

- BMR: `10·kg + 6.25·cm − 5·age + (male ? 5 : −161)`
- Activity multipliers: 1.2 / 1.375 / 1.55 / 1.725 / 1.9
- Goal delta: `weeklyRateKg × 7700 / 7` kcal/day (− for lose, + for gain)
- Safety floor: 1500 (male) / 1200 (female); result flags when clamped.
- BMI: `kg / m²` with WHO bands (<18.5, <25, <30, ≥30).
- Goal progress: start = earliest log, current = latest; fraction clamped 0–1.
  ETA = remaining kg ÷ weekly rate, only when moving toward the goal.

## UI

- **Nutrition (planner):** a "Your target" card (target kcal, current weight,
  link to Body & goals; a setup prompt if no profile). Day calorie badges show
  `planned / target` for the signed-in user and tint `warning` when over.
- **BodyGoals screen:** stats row (current weight, BMI, target kcal), log
  weight input (date defaults to today), trend chart (View-based, no svg dep),
  goal progress bar + ETA, recent log list with delete, profile form.
- ScrollView screen → follows `.claude/rules/web-scroll.md` height pattern.

## Out of scope (v1)

Imperial units, macro split, viewing other members' logs in the UI (data is
readable, just no member picker yet), editing logs other than re-logging a date.
