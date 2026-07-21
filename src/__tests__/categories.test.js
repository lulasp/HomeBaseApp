import { PANTRY_CATEGORIES, UNITS, MEAL_TYPES, DAYS_OF_WEEK, FULL_DAYS } from '../utils/categories';

describe('PANTRY_CATEGORIES', () => {
  it('has the expected number of categories', () => expect(PANTRY_CATEGORIES).toHaveLength(11));

  it('every category has a label and icon', () => {
    PANTRY_CATEGORIES.forEach((cat) => {
      expect(typeof cat.label).toBe('string');
      expect(cat.label.length).toBeGreaterThan(0);
      expect(typeof cat.icon).toBe('string');
    });
  });

  it('includes Other as the last category', () =>
    expect(PANTRY_CATEGORIES[PANTRY_CATEGORIES.length - 1].label).toBe('Other'));

  it('has no duplicate labels', () => {
    const labels = PANTRY_CATEGORIES.map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('UNITS', () => {
  it('is a non-empty array of strings', () => {
    expect(Array.isArray(UNITS)).toBe(true);
    expect(UNITS.length).toBeGreaterThan(0);
    UNITS.forEach((u) => expect(typeof u).toBe('string'));
  });

  it('has at least 20 units after expansion', () => {
    expect(UNITS.length).toBeGreaterThanOrEqual(20);
  });

  it('has no duplicate units', () => {
    expect(new Set(UNITS).size).toBe(UNITS.length);
  });

  it('includes count units', () => {
    ['pcs', 'pack', 'can', 'bottle', 'box', 'bag', 'bunch'].forEach((u) =>
      expect(UNITS).toContain(u),
    );
  });

  it('includes weight units', () => {
    ['g', 'kg', 'mg', 'oz', 'lb'].forEach((u) => expect(UNITS).toContain(u));
  });

  it('includes volume units', () => {
    ['ml', 'L', 'tsp', 'tbsp', 'cup', 'fl oz'].forEach((u) =>
      expect(UNITS).toContain(u),
    );
  });
});

describe('MEAL_TYPES', () => {
  it('has 4 meal types', () => expect(MEAL_TYPES).toHaveLength(4));
  it('includes Breakfast, Lunch, Dinner, Snack', () => {
    expect(MEAL_TYPES).toEqual(['Breakfast', 'Lunch', 'Dinner', 'Snack']);
  });
});

describe('DAYS_OF_WEEK', () => {
  it('has 7 entries', () => expect(DAYS_OF_WEEK).toHaveLength(7));
  it('starts on Monday', () => expect(DAYS_OF_WEEK[0]).toBe('Mon'));
  it('ends on Sunday', () => expect(DAYS_OF_WEEK[6]).toBe('Sun'));
});

describe('FULL_DAYS', () => {
  it('has 7 entries', () => expect(FULL_DAYS).toHaveLength(7));
  it('matches DAYS_OF_WEEK length', () => expect(FULL_DAYS).toHaveLength(DAYS_OF_WEEK.length));
  it('starts on Monday', () => expect(FULL_DAYS[0]).toBe('Monday'));
  it('ends on Sunday', () => expect(FULL_DAYS[6]).toBe('Sunday'));
});
