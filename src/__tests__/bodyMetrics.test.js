import {
  calcAge, calcBMR, activityFactor, calcTDEE, goalDelta, calcCalorieTarget,
  calcBMI, bmiCategory, sortLogs, latestWeight, calcGoalProgress, parseMetric,
  weightLogId, MIN_CALORIES,
} from '../utils/bodyMetrics';

const NOW = new Date(2026, 9, 19); // Oct 19, 2026

describe('calcAge', () => {
  it('counts whole years', () => {
    expect(calcAge('1990-01-01', NOW)).toBe(36);
  });
  it('subtracts a year before the birthday', () => {
    expect(calcAge('1990-10-20', NOW)).toBe(35);
  });
  it('counts the birthday itself', () => {
    expect(calcAge('1990-10-19', NOW)).toBe(36);
  });
  it('rejects malformed and future dates', () => {
    expect(calcAge('', NOW)).toBeNull();
    expect(calcAge(undefined, NOW)).toBeNull();
    expect(calcAge('19/10/1990', NOW)).toBeNull();
    expect(calcAge('2030-01-01', NOW)).toBeNull();
  });
});

describe('calcBMR (Mifflin-St Jeor)', () => {
  it('computes male BMR', () => {
    // 10*80 + 6.25*180 - 5*30 + 5
    expect(calcBMR({ weightKg: 80, heightCm: 180, age: 30, sex: 'male' })).toBe(1780);
  });
  it('computes female BMR', () => {
    // 10*60 + 6.25*165 - 5*30 - 161
    expect(calcBMR({ weightKg: 60, heightCm: 165, age: 30, sex: 'female' })).toBeCloseTo(1320.25);
  });
  it('returns null for missing or invalid inputs', () => {
    expect(calcBMR({ weightKg: 0, heightCm: 180, age: 30, sex: 'male' })).toBeNull();
    expect(calcBMR({ weightKg: 80, heightCm: null, age: 30, sex: 'male' })).toBeNull();
    expect(calcBMR({ weightKg: 80, heightCm: 180, age: null, sex: 'male' })).toBeNull();
    expect(calcBMR({ weightKg: 80, heightCm: 180, age: 30, sex: 'other' })).toBeNull();
  });
});

describe('activity / TDEE', () => {
  it('maps levels to multipliers', () => {
    expect(activityFactor('sedentary')).toBe(1.2);
    expect(activityFactor('veryActive')).toBe(1.9);
    expect(activityFactor('nope')).toBeNull();
  });
  it('multiplies BMR by the factor', () => {
    expect(calcTDEE(1000, 'moderate')).toBeCloseTo(1550);
  });
  it('returns null when either side is missing', () => {
    expect(calcTDEE(null, 'moderate')).toBeNull();
    expect(calcTDEE(1000, undefined)).toBeNull();
  });
});

describe('goalDelta', () => {
  it('is 7700 kcal per kg spread over a week', () => {
    expect(goalDelta('lose', 0.5)).toBeCloseTo(-550);
    expect(goalDelta('gain', 0.25)).toBeCloseTo(275);
  });
  it('is zero for maintain, unknown goals, or no rate', () => {
    expect(goalDelta('maintain', 0.5)).toBe(0);
    expect(goalDelta('bulk', 0.5)).toBe(0);
    expect(goalDelta('lose', 0)).toBe(0);
    expect(goalDelta('lose', undefined)).toBe(0);
  });
});

describe('calcCalorieTarget', () => {
  const profile = {
    sex: 'male', birthDate: '1996-01-01', heightCm: 180,
    activityLevel: 'moderate', goal: 'lose', weeklyRateKg: 0.5,
  };

  it('chains BMR → TDEE → goal adjustment', () => {
    // age 30 → BMR 1780, TDEE 2759, -550 → 2209
    expect(calcCalorieTarget(profile, 80, NOW)).toEqual({
      bmr: 1780, tdee: 2759, target: 2209, clamped: false,
    });
  });

  it('ignores the rate when maintaining', () => {
    expect(calcCalorieTarget({ ...profile, goal: 'maintain' }, 80, NOW).target).toBe(2759);
  });

  it('clamps to the safety floor and flags it', () => {
    const small = {
      sex: 'female', birthDate: '1960-01-01', heightCm: 150,
      activityLevel: 'sedentary', goal: 'lose', weeklyRateKg: 0.75,
    };
    const res = calcCalorieTarget(small, 45, NOW);
    expect(res.target).toBe(MIN_CALORIES.female);
    expect(res.clamped).toBe(true);
  });

  it('returns null for incomplete data', () => {
    expect(calcCalorieTarget(null, 80, NOW)).toBeNull();
    expect(calcCalorieTarget(profile, null, NOW)).toBeNull();
    expect(calcCalorieTarget({ ...profile, activityLevel: undefined }, 80, NOW)).toBeNull();
    expect(calcCalorieTarget({ ...profile, birthDate: '' }, 80, NOW)).toBeNull();
  });
});

describe('BMI', () => {
  it('rounds to one decimal', () => {
    expect(calcBMI(80, 180)).toBe(24.7);
  });
  it('returns null for invalid input', () => {
    expect(calcBMI(null, 180)).toBeNull();
    expect(calcBMI(80, 0)).toBeNull();
  });
  it('categorises on WHO boundaries', () => {
    expect(bmiCategory(18.4).label).toBe('Underweight');
    expect(bmiCategory(18.5).label).toBe('Healthy');
    expect(bmiCategory(24.9).tone).toBe('success');
    expect(bmiCategory(25).label).toBe('Overweight');
    expect(bmiCategory(30)).toEqual({ label: 'Obese', tone: 'danger' });
    expect(bmiCategory(null)).toBeNull();
  });
});

describe('logs', () => {
  const logs = [
    { id: 'c', date: '2026-10-10', weightKg: 79 },
    { id: 'a', date: '2026-10-01', weightKg: 81 },
    { id: 'x', date: '2026-10-05', weightKg: 0 },
    { id: 'y', weightKg: 90 },
    null,
    { id: 'b', date: '2026-10-05', weightKg: 80 },
  ];

  it('sorts by date and drops invalid entries', () => {
    expect(sortLogs(logs).map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });
  it('does not mutate the input', () => {
    const copy = [...logs];
    sortLogs(logs);
    expect(logs).toEqual(copy);
  });
  it('latestWeight is the newest valid entry', () => {
    expect(latestWeight(logs)).toBe(79);
    expect(latestWeight([])).toBeNull();
    expect(latestWeight(undefined)).toBeNull();
  });
});

describe('calcGoalProgress', () => {
  const logs = [
    { date: '2026-10-01', weightKg: 90 },
    { date: '2026-10-15', weightKg: 85 },
  ];

  it('tracks progress and ETA while losing', () => {
    const p = calcGoalProgress({ logs, goalWeightKg: 80, weeklyRateKg: 0.5, now: NOW });
    expect(p).toMatchObject({ start: 90, current: 85, goal: 80, remaining: 5, fraction: 0.5, reached: false });
    // 5 kg / 0.5 kg per week = 10 weeks
    expect(p.eta.getTime() - NOW.getTime()).toBe(10 * 7 * 24 * 60 * 60 * 1000);
  });

  it('tracks progress while gaining', () => {
    const gain = [{ date: '2026-10-01', weightKg: 60 }, { date: '2026-10-08', weightKg: 62 }];
    const p = calcGoalProgress({ logs: gain, goalWeightKg: 65, weeklyRateKg: 0.25, now: NOW });
    expect(p.fraction).toBeCloseTo(0.4);
    expect(p.remaining).toBe(-3);
    expect(p.eta).not.toBeNull();
  });

  it('marks reached and drops the ETA', () => {
    const p = calcGoalProgress({ logs, goalWeightKg: 86, weeklyRateKg: 0.5, now: NOW });
    expect(p.reached).toBe(true);
    expect(p.fraction).toBe(1);
    expect(p.eta).toBeNull();
  });

  it('clamps fraction to 0 when moving away from the goal', () => {
    const away = [{ date: '2026-10-01', weightKg: 85 }, { date: '2026-10-08', weightKg: 87 }];
    expect(calcGoalProgress({ logs: away, goalWeightKg: 80, weeklyRateKg: 0.5, now: NOW }).fraction).toBe(0);
  });

  it('has no ETA without a rate (maintain)', () => {
    expect(calcGoalProgress({ logs, goalWeightKg: 80, weeklyRateKg: null, now: NOW }).eta).toBeNull();
  });

  it('treats start == goal as reached', () => {
    const p = calcGoalProgress({ logs: [{ date: '2026-10-01', weightKg: 80 }], goalWeightKg: 80, weeklyRateKg: 0.5 });
    expect(p).toMatchObject({ fraction: 1, reached: true, eta: null });
  });

  it('returns null without logs or a goal', () => {
    expect(calcGoalProgress({ logs: [], goalWeightKg: 80 })).toBeNull();
    expect(calcGoalProgress({ logs, goalWeightKg: null })).toBeNull();
  });
});

describe('parseMetric', () => {
  it('accepts dot or comma decimals', () => {
    expect(parseMetric('72.5')).toBe(72.5);
    expect(parseMetric(' 72,5 ')).toBe(72.5);
  });
  it('rejects empty, zero, negative and non-numeric', () => {
    expect(parseMetric('')).toBeNull();
    expect(parseMetric(null)).toBeNull();
    expect(parseMetric('0')).toBeNull();
    expect(parseMetric('-3')).toBeNull();
    expect(parseMetric('abc')).toBeNull();
  });
});

it('weightLogId combines uid and date', () => {
  expect(weightLogId('u1', '2026-10-19')).toBe('u1_2026-10-19');
});
