// Body metrics — BMR / TDEE / calorie target / BMI / goal progress.
// Metric units only (kg, cm). See docs/weight-tracker.md.

export const ACTIVITY_LEVELS = [
  { key: 'sedentary',  label: 'Sedentary',   hint: 'Little or no exercise',    factor: 1.2 },
  { key: 'light',      label: 'Light',       hint: 'Exercise 1–3 days/week',   factor: 1.375 },
  { key: 'moderate',   label: 'Moderate',    hint: 'Exercise 3–5 days/week',   factor: 1.55 },
  { key: 'active',     label: 'Active',      hint: 'Exercise 6–7 days/week',   factor: 1.725 },
  { key: 'veryActive', label: 'Very active', hint: 'Physical job or 2×/day',   factor: 1.9 },
];

export const GOALS = [
  { key: 'lose',     label: 'Lose' },
  { key: 'maintain', label: 'Maintain' },
  { key: 'gain',     label: 'Gain' },
];

export const WEEKLY_RATES = [0.25, 0.5, 0.75];

export const KCAL_PER_KG = 7700;
export const MIN_CALORIES = { male: 1500, female: 1200 };

const isPos = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

// Whole years between birthDate ('yyyy-MM-dd') and `now`.
export const calcAge = (birthDate, now = new Date()) => {
  if (typeof birthDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const [y, m, d] = birthDate.split('-').map(Number);
  let age = now.getFullYear() - y;
  const beforeBirthday = now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 130 ? age : null;
};

// Mifflin-St Jeor.
export const calcBMR = ({ weightKg, heightCm, age, sex }) => {
  if (!isPos(weightKg) || !isPos(heightCm) || typeof age !== 'number' || age < 0) return null;
  if (sex !== 'male' && sex !== 'female') return null;
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
};

export const activityFactor = (level) =>
  ACTIVITY_LEVELS.find((a) => a.key === level)?.factor ?? null;

export const calcTDEE = (bmr, level) => {
  const f = activityFactor(level);
  return bmr != null && f != null ? bmr * f : null;
};

// Daily kcal adjustment for a goal; negative when losing.
export const goalDelta = (goal, weeklyRateKg) => {
  if (goal === 'maintain' || !isPos(weeklyRateKg)) return 0;
  const delta = (weeklyRateKg * KCAL_PER_KG) / 7;
  if (goal === 'lose') return -delta;
  if (goal === 'gain') return delta;
  return 0;
};

// Full calorie suggestion from a profile + current weight.
// Returns null when inputs are incomplete.
export const calcCalorieTarget = (profile, weightKg, now = new Date()) => {
  if (!profile) return null;
  const age  = calcAge(profile.birthDate, now);
  const bmr  = calcBMR({ weightKg, heightCm: profile.heightCm, age, sex: profile.sex });
  const tdee = calcTDEE(bmr, profile.activityLevel);
  if (tdee == null) return null;
  const raw   = tdee + goalDelta(profile.goal, profile.weeklyRateKg);
  const floor = MIN_CALORIES[profile.sex];
  const target = Math.max(raw, floor);
  return {
    bmr:     Math.round(bmr),
    tdee:    Math.round(tdee),
    target:  Math.round(target),
    clamped: raw < floor,
  };
};

export const calcBMI = (weightKg, heightCm) => {
  if (!isPos(weightKg) || !isPos(heightCm)) return null;
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
};

// WHO adult bands. `tone` maps to a theme token.
export const bmiCategory = (bmi) => {
  if (bmi == null) return null;
  if (bmi < 18.5) return { label: 'Underweight', tone: 'warning' };
  if (bmi < 25)   return { label: 'Healthy',     tone: 'success' };
  if (bmi < 30)   return { label: 'Overweight',  tone: 'warning' };
  return            { label: 'Obese',       tone: 'danger' };
};

// Logs sorted oldest → newest, invalid entries dropped.
export const sortLogs = (logs = []) =>
  logs
    .filter((l) => l && typeof l.date === 'string' && isPos(l.weightKg))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

export const latestWeight = (logs) => {
  const sorted = sortLogs(logs);
  return sorted.length ? sorted[sorted.length - 1].weightKg : null;
};

// Progress from the first logged weight toward goalWeightKg.
// eta is a Date, only set when currently moving toward the goal with a rate.
export const calcGoalProgress = ({ logs, goalWeightKg, weeklyRateKg, now = new Date() }) => {
  const sorted = sortLogs(logs);
  if (!sorted.length || !isPos(goalWeightKg)) return null;
  const start   = sorted[0].weightKg;
  const current = sorted[sorted.length - 1].weightKg;
  const total   = start - goalWeightKg;
  const remaining = Math.round((current - goalWeightKg) * 10) / 10;

  let fraction;
  if (total === 0) fraction = 1;
  else fraction = Math.min(Math.max((start - current) / total, 0), 1);

  const reached = total >= 0 ? current <= goalWeightKg : current >= goalWeightKg;
  let eta = null;
  if (!reached && isPos(weeklyRateKg)) {
    const weeks = Math.abs(remaining) / weeklyRateKg;
    eta = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);
  }
  return { start, current, goal: goalWeightKg, remaining, fraction, reached: reached || total === 0, eta };
};

// Parses a user-typed number ("72,5" or "72.5"); null if not a positive number.
export const parseMetric = (text) => {
  if (text == null) return null;
  const n = Number(String(text).trim().replace(',', '.'));
  return isPos(n) ? n : null;
};

export const weightLogId = (uid, date) => `${uid}_${date}`;
