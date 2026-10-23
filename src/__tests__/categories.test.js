import {
  PANTRY_CATEGORIES, NON_FOOD_CATEGORIES, UNITS, MEAL_TYPES, DAYS_OF_WEEK, FULL_DAYS,
  LOCKED_CATEGORY_LABELS, withOverrides, overrideFor, addRename, renameInList,
} from '../utils/categories';

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

describe('LOCKED_CATEGORY_LABELS', () => {
  it('are the food and non-food fallbacks', () => {
    expect(LOCKED_CATEGORY_LABELS).toEqual(['Other', 'Other Non-Food']);
    expect(PANTRY_CATEGORIES.some((c) => c.label === 'Other')).toBe(true);
    expect(NON_FOOD_CATEGORIES.some((c) => c.label === 'Other Non-Food')).toBe(true);
  });
});

describe('withOverrides', () => {
  const builtIn = [{ label: 'Baking', icon: '🧁' }, { label: 'Spices', icon: '🧂' }];

  it('tags every built-in with its original label', () => {
    expect(withOverrides(builtIn, {})).toEqual([
      { label: 'Baking', icon: '🧁', baseLabel: 'Baking' },
      { label: 'Spices', icon: '🧂', baseLabel: 'Spices' },
    ]);
  });

  it('handles missing overrides', () => {
    expect(withOverrides(builtIn, undefined)[0].label).toBe('Baking');
    expect(withOverrides(builtIn, null)[0].label).toBe('Baking');
  });

  it('applies label and icon edits but keeps baseLabel', () => {
    const [baking, spices] = withOverrides(builtIn, {
      Baking: { label: 'Bakery' },
      Spices: { icon: '🌶️' },
    });
    expect(baking).toEqual({ label: 'Bakery', icon: '🧁', baseLabel: 'Baking' });
    expect(spices).toEqual({ label: 'Spices', icon: '🌶️', baseLabel: 'Spices' });
  });

  it('ignores overrides for unknown labels', () => {
    expect(withOverrides(builtIn, { Nope: { label: 'X' } }).map((c) => c.label)).toEqual(['Baking', 'Spices']);
  });

  it('does not mutate the built-in list', () => {
    withOverrides(builtIn, { Baking: { label: 'Bakery' } });
    expect(builtIn[0]).toEqual({ label: 'Baking', icon: '🧁' });
  });
});

describe('overrideFor', () => {
  const builtIn = { label: 'Baking', icon: '🧁' };

  it('returns null when nothing differs', () => {
    expect(overrideFor(builtIn, { label: 'Baking', icon: '🧁' })).toBeNull();
  });

  it('returns only the changed fields', () => {
    expect(overrideFor(builtIn, { label: 'Bakery', icon: '🧁' })).toEqual({ label: 'Bakery' });
    expect(overrideFor(builtIn, { label: 'Baking', icon: '🍰' })).toEqual({ icon: '🍰' });
    expect(overrideFor(builtIn, { label: 'Bakery', icon: '🍰' })).toEqual({ label: 'Bakery', icon: '🍰' });
  });

  it('works for finance built-ins (Ionicons icon)', () => {
    expect(overrideFor({ key: 'gas', label: 'Gas', icon: 'flame' }, { label: 'Heating', icon: 'flame' }))
      .toEqual({ label: 'Heating' });
  });
});

describe('addRename', () => {
  it('adds a new rename', () => {
    expect(addRename([], 'A', 'B')).toEqual([{ from: 'A', to: 'B' }]);
  });

  it('ignores a no-op rename', () => {
    const list = [{ from: 'A', to: 'B' }];
    expect(addRename(list, 'C', 'C')).toBe(list);
  });

  it('collapses a chain into one rename', () => {
    expect(addRename([{ from: 'A', to: 'B' }], 'B', 'C')).toEqual([{ from: 'A', to: 'C' }]);
  });

  it('drops a round trip', () => {
    expect(addRename([{ from: 'A', to: 'B' }], 'B', 'A')).toEqual([]);
  });

  it('keeps unrelated renames', () => {
    expect(addRename([{ from: 'A', to: 'B' }], 'X', 'Y')).toEqual([
      { from: 'A', to: 'B' }, { from: 'X', to: 'Y' },
    ]);
  });

  it('keeps a swap as two independent renames', () => {
    let r = addRename([], 'A', 'T');
    r = addRename(r, 'B', 'A');
    r = addRename(r, 'T', 'B');
    expect(r).toEqual([{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }]);
  });
});

describe('renameInList', () => {
  it('replaces the matching label in place', () => {
    expect(renameInList(['A', 'B', 'C'], 'B', 'X')).toEqual(['A', 'X', 'C']);
  });

  it('leaves the list unchanged when the label is absent', () => {
    expect(renameInList(['A'], 'B', 'X')).toEqual(['A']);
  });

  it('passes null / undefined through', () => {
    expect(renameInList(null, 'A', 'B')).toBeNull();
    expect(renameInList(undefined, 'A', 'B')).toBeUndefined();
  });
});
