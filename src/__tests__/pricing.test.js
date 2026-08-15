import {
  canonicalUnit,
  toCanonicalQuantity,
  unitPriceOf,
  itemKeyOf,
  normalizeStore,
  buildPriceEntry,
  buildPriceEntryPatch,
  todayKey,
  sortEntries,
  computeTrend,
  buildPriceHistory,
  summarizeStores,
  recentStores,
  lastEntryFor,
  estimateItemCost,
  summarizeBasket,
  buildStoreComparison,
  formatPrice,
  formatUnitPrice,
  formatPercent,
  trendPresentation,
  TREND_EPSILON,
} from '../utils/pricing';

// Convenience: a stored entry as it would come back from Firestore.
const entry = (overrides = {}) => ({
  itemKey: 'milk',
  itemName: 'Milk',
  category: 'Refrigerated',
  store: 'Lidl',
  price: 1.0,
  quantity: 1,
  unit: 'L',
  canonicalUnit: 'L',
  unitPrice: 1.0,
  purchasedAt: '2026-01-01',
  ...overrides,
});

describe('canonicalUnit', () => {
  it('maps mass units to kg', () => {
    ['mg', 'g', 'kg', 'oz', 'lb'].forEach((u) => expect(canonicalUnit(u)).toBe('kg'));
  });

  it('maps volume units to L', () => {
    ['ml', 'L', 'fl oz', 'tsp', 'tbsp', 'cup'].forEach((u) => expect(canonicalUnit(u)).toBe('L'));
  });

  it('maps count-ish units to pcs', () => {
    ['pcs', 'pack', 'can', 'bottle', 'box', 'bag', 'bunch', 'slice', 'clove']
      .forEach((u) => expect(canonicalUnit(u)).toBe('pcs'));
  });

  it('is case-insensitive', () => {
    expect(canonicalUnit('KG')).toBe('kg');
    expect(canonicalUnit('ML')).toBe('L');
  });

  it('defaults empty input to pcs', () => {
    expect(canonicalUnit('')).toBe('pcs');
    expect(canonicalUnit(null)).toBe('pcs');
    expect(canonicalUnit(undefined)).toBe('pcs');
  });

  it('leaves unknown custom units as their own family', () => {
    expect(canonicalUnit('punnet')).toBe('punnet');
  });
});

describe('toCanonicalQuantity', () => {
  it('converts within the mass family', () => {
    expect(toCanonicalQuantity(500, 'g')).toBeCloseTo(0.5, 10);
    expect(toCanonicalQuantity(2, 'kg')).toBe(2);
    expect(toCanonicalQuantity(1, 'lb')).toBeCloseTo(0.453592, 6);
  });

  it('converts within the volume family', () => {
    expect(toCanonicalQuantity(750, 'ml')).toBeCloseTo(0.75, 10);
    expect(toCanonicalQuantity(1, 'cup')).toBeCloseTo(0.24, 10);
  });

  it('leaves unknown units unscaled', () => {
    expect(toCanonicalQuantity(3, 'punnet')).toBe(3);
  });

  it('rejects non-positive and non-numeric quantities', () => {
    expect(toCanonicalQuantity(0, 'kg')).toBeNull();
    expect(toCanonicalQuantity(-1, 'kg')).toBeNull();
    expect(toCanonicalQuantity('abc', 'kg')).toBeNull();
    expect(toCanonicalQuantity(null, 'kg')).toBeNull();
  });
});

describe('unitPriceOf', () => {
  it('divides price by the canonical quantity', () => {
    expect(unitPriceOf({ price: 2, quantity: 500, unit: 'g' })).toBeCloseTo(4, 10);   // $4/kg
    expect(unitPriceOf({ price: 1.5, quantity: 3, unit: 'pcs' })).toBeCloseTo(0.5, 10);
  });

  it('makes different pack sizes comparable', () => {
    const big   = unitPriceOf({ price: 1.49, quantity: 1,   unit: 'L'  });
    const small = unitPriceOf({ price: 0.85, quantity: 500, unit: 'ml' });
    expect(small).toBeGreaterThan(big);   // 1.70/L vs 1.49/L
  });

  it('returns null for unusable input', () => {
    expect(unitPriceOf({ price: 'x', quantity: 1, unit: 'L' })).toBeNull();
    expect(unitPriceOf({ price: -1, quantity: 1, unit: 'L' })).toBeNull();
    expect(unitPriceOf({ price: 1, quantity: 0, unit: 'L' })).toBeNull();
  });
});

describe('itemKeyOf', () => {
  it('case-folds and trims', () => {
    expect(itemKeyOf('  Milk ')).toBe('milk');
    expect(itemKeyOf('MILK')).toBe('milk');
  });

  it('strips diacritics so accented spellings share a history', () => {
    expect(itemKeyOf('Café')).toBe(itemKeyOf('cafe'));
    expect(itemKeyOf('Pão')).toBe(itemKeyOf('pao'));
  });

  it('strips punctuation and collapses whitespace', () => {
    expect(itemKeyOf('Olive-Oil,  Extra   Virgin')).toBe('olive oil extra virgin');
  });

  it('singularizes common plurals', () => {
    expect(itemKeyOf('Eggs')).toBe('egg');
    expect(itemKeyOf('Tomatoes')).toBe('tomato');
    expect(itemKeyOf('Berries')).toBe('berry');
    expect(itemKeyOf('Peaches')).toBe('peach');
  });

  it('leaves words that only look plural alone', () => {
    expect(itemKeyOf('Hummus')).toBe('hummus');
    expect(itemKeyOf('Swiss')).toBe('swiss');
    expect(itemKeyOf('Rice')).toBe('rice');
    expect(itemKeyOf('Oats')).toBe('oat');    // genuinely plural — acceptable
  });

  it('only singularizes the final word', () => {
    expect(itemKeyOf('Greens Beans')).toBe('greens bean');
  });

  it('returns an empty string for empty input', () => {
    expect(itemKeyOf('')).toBe('');
    expect(itemKeyOf(null)).toBe('');
    expect(itemKeyOf('!!!')).toBe('');
  });
});

describe('normalizeStore', () => {
  it('trims and preserves the entered casing', () => {
    expect(normalizeStore('  Lidl ')).toBe('Lidl');
    expect(normalizeStore(null)).toBe('');
  });
});

describe('buildPriceEntry', () => {
  it('produces a complete document with derived fields', () => {
    const doc = buildPriceEntry({
      name: 'Tomatoes', price: '3.00', quantity: '500', unit: 'g',
      category: 'Refrigerated', store: ' Lidl ', purchasedAt: '2026-03-04', addedBy: 'uid1',
    });
    expect(doc).toMatchObject({
      itemKey: 'tomato',
      itemName: 'Tomatoes',
      category: 'Refrigerated',
      store: 'Lidl',
      price: 3,
      quantity: 500,
      unit: 'g',
      canonicalUnit: 'kg',
      purchasedAt: '2026-03-04',
      addedBy: 'uid1',
    });
    expect(doc.unitPrice).toBeCloseTo(6, 10);   // $6/kg
  });

  it('defaults quantity, unit, category, store and date', () => {
    const doc = buildPriceEntry({ name: 'Milk', price: 2 });
    expect(doc.quantity).toBe(1);
    expect(doc.unit).toBe('pcs');
    expect(doc.category).toBe('Other');
    expect(doc.store).toBeNull();
    expect(doc.addedBy).toBeNull();
    expect(doc.purchasedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('rejects missing or non-positive prices', () => {
    expect(buildPriceEntry({ name: 'Milk', price: '' })).toBeNull();
    expect(buildPriceEntry({ name: 'Milk', price: 0 })).toBeNull();
    expect(buildPriceEntry({ name: 'Milk', price: -1 })).toBeNull();
    expect(buildPriceEntry({ name: 'Milk', price: 'abc' })).toBeNull();
  });

  it('rejects a name that normalizes to nothing', () => {
    expect(buildPriceEntry({ name: '   ', price: 2 })).toBeNull();
  });

  it('falls back to the total price when the quantity is unusable', () => {
    const doc = buildPriceEntry({ name: 'Milk', price: 2, quantity: 0, unit: 'L' });
    expect(doc.quantity).toBe(1);
    expect(doc.unitPrice).toBe(2);
  });
});

describe('buildPriceEntryPatch', () => {
  it('re-derives unitPrice and canonicalUnit from the edited values', () => {
    const patch = buildPriceEntryPatch({
      price: '3.00', quantity: '500', unit: 'g', store: ' Aldi ', purchasedAt: '2026-05-06',
    });
    expect(patch).toMatchObject({
      price: 3, quantity: 500, unit: 'g', canonicalUnit: 'kg',
      store: 'Aldi', purchasedAt: '2026-05-06',
    });
    expect(patch.unitPrice).toBeCloseTo(6, 10);
  });

  it('never carries item identity, so an edit cannot split a history', () => {
    const patch = buildPriceEntryPatch({ price: 2, quantity: 1, unit: 'L' });
    expect(patch).not.toHaveProperty('itemKey');
    expect(patch).not.toHaveProperty('itemName');
    expect(patch).not.toHaveProperty('category');
    expect(patch).not.toHaveProperty('addedBy');
  });

  it('clears the store when emptied', () => {
    expect(buildPriceEntryPatch({ price: 2, store: '   ' }).store).toBeNull();
    expect(buildPriceEntryPatch({ price: 2 }).store).toBeNull();
  });

  it('defaults quantity, unit and date', () => {
    const patch = buildPriceEntryPatch({ price: 2 });
    expect(patch.quantity).toBe(1);
    expect(patch.unit).toBe('pcs');
    expect(patch.canonicalUnit).toBe('pcs');
    expect(patch.purchasedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('rejects an unusable price', () => {
    expect(buildPriceEntryPatch({ price: '' })).toBeNull();
    expect(buildPriceEntryPatch({ price: 0 })).toBeNull();
    expect(buildPriceEntryPatch({ price: -3 })).toBeNull();
    expect(buildPriceEntryPatch({ price: 'abc' })).toBeNull();
  });

  it('falls back to the total price when the quantity is unusable', () => {
    const patch = buildPriceEntryPatch({ price: 2, quantity: 0, unit: 'L' });
    expect(patch.quantity).toBe(1);
    expect(patch.unitPrice).toBe(2);
  });

  it('agrees with buildPriceEntry on every shared field', () => {
    const input = { price: '4.50', quantity: '2', unit: 'kg', store: 'Lidl', purchasedAt: '2026-02-02' };
    const patch = buildPriceEntryPatch(input);
    const full  = buildPriceEntry({ ...input, name: 'Rice', category: 'Grains & Pasta' });
    for (const key of Object.keys(patch)) {
      expect(full[key]).toEqual(patch[key]);
    }
  });

  it('makes an edited entry comparable against the rest of the history', () => {
    // A 500 g entry corrected to 1 kg must compare per-kg, not per-entry.
    const original = buildPriceEntry({ name: 'Rice', price: 2, quantity: 500, unit: 'g' });
    const corrected = { ...original, ...buildPriceEntryPatch({ price: 2, quantity: 1, unit: 'kg' }) };
    expect(original.unitPrice).toBeCloseTo(4, 10);
    expect(corrected.unitPrice).toBeCloseTo(2, 10);
    expect(corrected.canonicalUnit).toBe(original.canonicalUnit);
    expect(computeTrend([original, corrected]).direction).toBe('down');
  });
});

describe('todayKey', () => {
  it('formats a date as local YYYY-MM-DD', () => {
    expect(todayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(todayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('sortEntries', () => {
  it('orders oldest first by purchase date', () => {
    const sorted = sortEntries([
      entry({ purchasedAt: '2026-03-01' }),
      entry({ purchasedAt: '2026-01-01' }),
      entry({ purchasedAt: '2026-02-01' }),
    ]);
    expect(sorted.map((e) => e.purchasedAt)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
  });

  it('breaks same-day ties with createdAt', () => {
    const sorted = sortEntries([
      entry({ purchasedAt: '2026-01-01', price: 2, createdAt: { seconds: 200 } }),
      entry({ purchasedAt: '2026-01-01', price: 1, createdAt: { seconds: 100 } }),
    ]);
    expect(sorted.map((e) => e.price)).toEqual([1, 2]);
  });

  it('supports Firestore Timestamp objects', () => {
    const sorted = sortEntries([
      entry({ purchasedAt: '2026-01-01', price: 2, createdAt: { toMillis: () => 2000 } }),
      entry({ purchasedAt: '2026-01-01', price: 1, createdAt: { toMillis: () => 1000 } }),
    ]);
    expect(sorted.map((e) => e.price)).toEqual([1, 2]);
  });

  it('does not mutate the input', () => {
    const input = [entry({ purchasedAt: '2026-03-01' }), entry({ purchasedAt: '2026-01-01' })];
    sortEntries(input);
    expect(input[0].purchasedAt).toBe('2026-03-01');
  });
});

describe('computeTrend', () => {
  it('reports "new" for a single entry', () => {
    const trend = computeTrend([entry({ unitPrice: 1 })]);
    expect(trend.direction).toBe('new');
    expect(trend.previous).toBeNull();
  });

  it('reports "none" for no entries', () => {
    expect(computeTrend([]).direction).toBe('none');
  });

  it('flags a price increase', () => {
    const trend = computeTrend([
      entry({ unitPrice: 1.00, purchasedAt: '2026-01-01' }),
      entry({ unitPrice: 1.20, purchasedAt: '2026-02-01' }),
    ]);
    expect(trend.direction).toBe('up');
    expect(trend.pct).toBeCloseTo(0.2, 10);
    expect(trend.abs).toBeCloseTo(0.2, 10);
  });

  it('flags a price drop', () => {
    const trend = computeTrend([
      entry({ unitPrice: 2.00 }),
      entry({ unitPrice: 1.50 }),
    ]);
    expect(trend.direction).toBe('down');
    expect(trend.pct).toBeCloseTo(-0.25, 10);
  });

  it('treats sub-threshold moves as unchanged', () => {
    const trend = computeTrend([
      entry({ unitPrice: 1.0 }),
      entry({ unitPrice: 1.0 * (1 + TREND_EPSILON / 2) }),
    ]);
    expect(trend.direction).toBe('same');
  });

  it('compares against the last entry in the same canonical unit', () => {
    const trend = computeTrend([
      entry({ unitPrice: 1.00, canonicalUnit: 'kg', purchasedAt: '2026-01-01' }),
      entry({ unitPrice: 9.99, canonicalUnit: 'pcs', purchasedAt: '2026-02-01' }),
      entry({ unitPrice: 1.50, canonicalUnit: 'kg', purchasedAt: '2026-03-01' }),
    ]);
    expect(trend.direction).toBe('up');
    expect(trend.previous.unitPrice).toBe(1.0);
  });

  it('reports "new" when no earlier entry shares the unit', () => {
    const trend = computeTrend([
      entry({ unitPrice: 1.0, canonicalUnit: 'kg' }),
      entry({ unitPrice: 2.0, canonicalUnit: 'pcs' }),
    ]);
    expect(trend.direction).toBe('new');
  });

  it('does not divide by a zero previous price', () => {
    const trend = computeTrend([entry({ unitPrice: 0 }), entry({ unitPrice: 2 })]);
    expect(trend.direction).toBe('new');
  });
});

describe('buildPriceHistory', () => {
  const entries = [
    entry({ id: 'a', itemKey: 'milk', unitPrice: 1.00, price: 1.00, purchasedAt: '2026-01-01', store: 'Lidl' }),
    entry({ id: 'b', itemKey: 'milk', unitPrice: 1.40, price: 1.40, purchasedAt: '2026-02-01', store: 'Aldi' }),
    entry({ id: 'c', itemKey: 'milk', unitPrice: 1.20, price: 1.20, purchasedAt: '2026-03-01', store: 'Lidl' }),
    entry({ id: 'd', itemKey: 'egg', itemName: 'Eggs', unitPrice: 3.00, price: 3.00, purchasedAt: '2026-02-15' }),
  ];

  it('groups entries into one summary per item', () => {
    const history = buildPriceHistory(entries);
    expect(history.map((i) => i.itemKey).sort()).toEqual(['egg', 'milk']);
  });

  it('sorts items by most recently purchased', () => {
    expect(buildPriceHistory(entries)[0].itemKey).toBe('milk');
  });

  it('computes low, high, average and count on comparable entries', () => {
    const milk = buildPriceHistory(entries).find((i) => i.itemKey === 'milk');
    expect(milk.count).toBe(3);
    expect(milk.low).toBeCloseTo(1.0, 10);
    expect(milk.high).toBeCloseTo(1.4, 10);
    expect(milk.average).toBeCloseTo(1.2, 10);
  });

  it('exposes the trend against the previous purchase', () => {
    const milk = buildPriceHistory(entries).find((i) => i.itemKey === 'milk');
    expect(milk.trend.direction).toBe('down');           // 1.40 → 1.20
    expect(milk.latest.id).toBe('c');
  });

  it('uses the latest entry for the display name and category', () => {
    const history = buildPriceHistory([
      entry({ itemKey: 'milk', itemName: 'milk', purchasedAt: '2026-01-01' }),
      entry({ itemKey: 'milk', itemName: 'Whole Milk', purchasedAt: '2026-02-01' }),
    ]);
    expect(history[0].itemName).toBe('Whole Milk');
  });

  it('scopes stats to the newest canonical unit', () => {
    const history = buildPriceHistory([
      entry({ itemKey: 'rice', unitPrice: 99, canonicalUnit: 'pcs', purchasedAt: '2026-01-01' }),
      entry({ itemKey: 'rice', unitPrice: 2,  canonicalUnit: 'kg',  purchasedAt: '2026-02-01' }),
      entry({ itemKey: 'rice', unitPrice: 3,  canonicalUnit: 'kg',  purchasedAt: '2026-03-01' }),
    ]);
    const rice = history[0];
    expect(rice.count).toBe(3);              // full history preserved
    expect(rice.comparable).toHaveLength(2); // but stats ignore the pcs entry
    expect(rice.high).toBe(3);
  });

  it('falls back to deriving the key from the name', () => {
    const history = buildPriceHistory([{ itemName: 'Milk', unitPrice: 1, price: 1, purchasedAt: '2026-01-01' }]);
    expect(history[0].itemKey).toBe('milk');
  });

  it('skips entries with no usable identity', () => {
    expect(buildPriceHistory([{ itemName: '', price: 1 }])).toEqual([]);
  });

  it('returns an empty array for no input', () => {
    expect(buildPriceHistory()).toEqual([]);
    expect(buildPriceHistory([])).toEqual([]);
  });
});

describe('summarizeStores', () => {
  it('ranks stores cheapest average first', () => {
    const stores = summarizeStores([
      entry({ store: 'Aldi', unitPrice: 2.0 }),
      entry({ store: 'Lidl', unitPrice: 1.0 }),
      entry({ store: 'Lidl', unitPrice: 1.4 }),
    ]);
    expect(stores.map((s) => s.store)).toEqual(['Lidl', 'Aldi']);
    expect(stores[0].average).toBeCloseTo(1.2, 10);
    expect(stores[0].low).toBeCloseTo(1.0, 10);
    expect(stores[0].count).toBe(2);
  });

  it('groups store names case-insensitively', () => {
    const stores = summarizeStores([
      entry({ store: 'Lidl', unitPrice: 1 }),
      entry({ store: 'lidl', unitPrice: 2 }),
    ]);
    expect(stores).toHaveLength(1);
    expect(stores[0].count).toBe(2);
  });

  it('keeps entries with no store under a null bucket', () => {
    const stores = summarizeStores([entry({ store: null, unitPrice: 1 })]);
    expect(stores[0].store).toBeNull();
  });

  it('drops buckets with no usable prices', () => {
    expect(summarizeStores([entry({ store: 'Lidl', unitPrice: NaN })])).toEqual([]);
  });
});

describe('recentStores', () => {
  it('lists distinct stores most recently used first', () => {
    const stores = recentStores([
      entry({ store: 'Aldi', purchasedAt: '2026-01-01' }),
      entry({ store: 'Lidl', purchasedAt: '2026-02-01' }),
      entry({ store: 'Aldi', purchasedAt: '2026-03-01' }),
    ]);
    expect(stores).toEqual(['Aldi', 'Lidl']);
  });

  it('ignores entries with no store', () => {
    expect(recentStores([entry({ store: null }), entry({ store: '  ' })])).toEqual([]);
  });

  it('respects the limit', () => {
    const many = ['A', 'B', 'C', 'D'].map((s, i) =>
      entry({ store: s, purchasedAt: `2026-01-0${i + 1}` }));
    expect(recentStores(many, 2)).toEqual(['D', 'C']);
  });
});

describe('lastEntryFor', () => {
  const entries = [
    entry({ id: 'a', itemKey: 'milk', price: 1, purchasedAt: '2026-01-01' }),
    entry({ id: 'b', itemKey: 'milk', price: 2, purchasedAt: '2026-02-01' }),
    entry({ id: 'c', itemKey: 'egg', itemName: 'Eggs', price: 3, purchasedAt: '2026-03-01' }),
  ];

  it('returns the newest entry matching the name', () => {
    expect(lastEntryFor(entries, 'Milk').id).toBe('b');
  });

  it('matches through name normalization', () => {
    expect(lastEntryFor(entries, 'eggs').id).toBe('c');
    expect(lastEntryFor(entries, 'EGG').id).toBe('c');
  });

  it('returns null when nothing matches', () => {
    expect(lastEntryFor(entries, 'Bread')).toBeNull();
    expect(lastEntryFor(entries, '')).toBeNull();
    expect(lastEntryFor([], 'Milk')).toBeNull();
  });
});

describe('estimateItemCost', () => {
  const milk = [entry({ itemKey: 'milk', itemName: 'Milk', price: 2, quantity: 1, unit: 'L', canonicalUnit: 'L', unitPrice: 2 })];

  it('scales the last unit price by the wanted quantity', () => {
    const est = estimateItemCost({ name: 'Milk', quantity: '3', unit: 'L' }, milk);
    expect(est.cost).toBeCloseTo(6, 10);
    expect(est.scaled).toBe(true);
  });

  it('converts within a unit family', () => {
    const est = estimateItemCost({ name: 'Milk', quantity: '500', unit: 'ml' }, milk);
    expect(est.cost).toBeCloseTo(1, 10);
  });

  it('falls back to the last total when the unit family differs', () => {
    const est = estimateItemCost({ name: 'Milk', quantity: '2', unit: 'pcs' }, milk);
    expect(est.cost).toBe(2);
    expect(est.scaled).toBe(false);
  });

  it('returns null for an item with no price history', () => {
    expect(estimateItemCost({ name: 'Saffron', quantity: '1', unit: 'g' }, milk)).toBeNull();
  });

  it('matches through name normalization', () => {
    expect(estimateItemCost({ name: 'milk', quantity: '1', unit: 'L' }, milk)).not.toBeNull();
  });
});

describe('summarizeBasket', () => {
  const priceEntries = [
    entry({ id: 'p1', itemKey: 'milk', itemName: 'Milk', price: 2, quantity: 1, unit: 'L', canonicalUnit: 'L', unitPrice: 2 }),
    entry({ id: 'p2', itemKey: 'egg', itemName: 'Eggs', price: 3, quantity: 6, unit: 'pcs', canonicalUnit: 'pcs', unitPrice: 0.5 }),
  ];

  it('estimates a full list before anything is ticked off', () => {
    const basket = summarizeBasket([
      { id: 'g1', name: 'Milk', quantity: '2', unit: 'L',   checked: false },
      { id: 'g2', name: 'Eggs', quantity: '12', unit: 'pcs', checked: false },
    ], priceEntries);

    expect(basket.actual).toBe(0);
    expect(basket.remaining).toBeCloseTo(10, 10);   // 2×2 + 12×0.5
    expect(basket.projected).toBeCloseTo(10, 10);
    expect(basket.pricedCount).toBe(2);
    expect(basket.unpricedCount).toBe(0);
  });

  it('counts a checked item at what was actually logged for it', () => {
    const entries = [
      ...priceEntries,
      entry({ id: 'p3', itemKey: 'milk', price: 2.5, quantity: 2, unit: 'L', canonicalUnit: 'L', unitPrice: 1.25, groceryItemId: 'g1', purchasedAt: '2026-02-01' }),
    ];
    const basket = summarizeBasket([
      { id: 'g1', name: 'Milk', quantity: '2', unit: 'L',   checked: true },
      { id: 'g2', name: 'Eggs', quantity: '12', unit: 'pcs', checked: false },
    ], entries);

    expect(basket.actual).toBeCloseTo(2.5, 10);     // the logged price, not the estimate
    expect(basket.remaining).toBeCloseTo(6, 10);    // eggs still to pick up
    expect(basket.projected).toBeCloseTo(8.5, 10);
    expect(basket.loggedCount).toBe(1);
  });

  it('still estimates a checked item that had no price logged', () => {
    const basket = summarizeBasket(
      [{ id: 'g1', name: 'Milk', quantity: '1', unit: 'L', checked: true }],
      priceEntries,
    );
    expect(basket.actual).toBe(0);
    expect(basket.remaining).toBeCloseTo(2, 10);
    expect(basket.loggedCount).toBe(0);
  });

  it('counts items with no history as unpriced without breaking the total', () => {
    const basket = summarizeBasket([
      { id: 'g1', name: 'Milk',    quantity: '1', unit: 'L',   checked: false },
      { id: 'g2', name: 'Saffron', quantity: '1', unit: 'g',   checked: false },
    ], priceEntries);

    expect(basket.projected).toBeCloseTo(2, 10);
    expect(basket.pricedCount).toBe(1);
    expect(basket.unpricedCount).toBe(1);
    expect(basket.total).toBe(2);
  });

  it('handles an empty list', () => {
    const basket = summarizeBasket([], priceEntries);
    expect(basket).toMatchObject({ actual: 0, remaining: 0, projected: 0, total: 0, unpricedCount: 0 });
  });

  it('uses the most recent logged entry when an item was re-scanned', () => {
    const entries = [
      entry({ id: 'a', itemKey: 'milk', price: 1, groceryItemId: 'g1', purchasedAt: '2026-01-01' }),
      entry({ id: 'b', itemKey: 'milk', price: 9, groceryItemId: 'g1', purchasedAt: '2026-02-01' }),
    ];
    const basket = summarizeBasket([{ id: 'g1', name: 'Milk', quantity: '1', unit: 'L', checked: true }], entries);
    expect(basket.actual).toBe(9);
  });
});

describe('buildStoreComparison', () => {
  // Milk and rice priced at both shops; Lidl cheaper on both.
  const twoStores = [
    entry({ itemKey: 'milk', itemName: 'Milk', store: 'Lidl', unitPrice: 1.0, quantity: 1, unit: 'L', canonicalUnit: 'L', purchasedAt: '2026-01-01' }),
    entry({ itemKey: 'milk', itemName: 'Milk', store: 'Aldi', unitPrice: 1.2, quantity: 1, unit: 'L', canonicalUnit: 'L', purchasedAt: '2026-01-02' }),
    entry({ itemKey: 'rice', itemName: 'Rice', store: 'Lidl', unitPrice: 2.0, quantity: 1, unit: 'kg', canonicalUnit: 'kg', purchasedAt: '2026-01-03' }),
    entry({ itemKey: 'rice', itemName: 'Rice', store: 'Aldi', unitPrice: 2.4, quantity: 1, unit: 'kg', canonicalUnit: 'kg', purchasedAt: '2026-01-04' }),
  ];

  it('ranks stores by what the same basket costs', () => {
    const cmp = buildStoreComparison(twoStores);
    expect(cmp.comparable).toBe(true);
    expect(cmp.totals.map((t) => t.store)).toEqual(['Lidl', 'Aldi']);
    expect(cmp.totals[0].total).toBeCloseTo(3.0, 10);
    expect(cmp.totals[1].total).toBeCloseTo(3.6, 10);
  });

  it('reports the saving against the next-cheapest store', () => {
    const { best } = buildStoreComparison(twoStores);
    expect(best.store).toBe('Lidl');
    expect(best.versus).toBe('Aldi');
    expect(best.saving).toBeCloseTo(0.6, 10);
    expect(best.savingPct).toBeCloseTo(0.6 / 3.6, 10);
  });

  it('only counts items priced at every compared store', () => {
    const cmp = buildStoreComparison([
      ...twoStores,
      // Only ever bought at Lidl — must not inflate Lidl's basket.
      entry({ itemKey: 'tea', itemName: 'Tea', store: 'Lidl', unitPrice: 5, quantity: 1, unit: 'pcs', canonicalUnit: 'pcs' }),
    ]);
    expect(cmp.common.map((c) => c.itemKey).sort()).toEqual(['milk', 'rice']);
    expect(cmp.totals[0].total).toBeCloseTo(3.0, 10);
  });

  it('weights the basket by the quantity usually bought', () => {
    const cmp = buildStoreComparison([
      entry({ itemKey: 'rice', store: 'Lidl', unitPrice: 2, quantity: 5, unit: 'kg', canonicalUnit: 'kg', purchasedAt: '2026-01-01' }),
      entry({ itemKey: 'rice', store: 'Aldi', unitPrice: 3, quantity: 5, unit: 'kg', canonicalUnit: 'kg', purchasedAt: '2026-01-02' }),
      entry({ itemKey: 'salt', store: 'Lidl', unitPrice: 1, quantity: 1, unit: 'kg', canonicalUnit: 'kg', purchasedAt: '2026-01-03' }),
      entry({ itemKey: 'salt', store: 'Aldi', unitPrice: 1, quantity: 1, unit: 'kg', canonicalUnit: 'kg', purchasedAt: '2026-01-04' }),
    ]);
    // Rice (5 kg) dominates salt (1 kg): 2×5 + 1×1 = 11 vs 3×5 + 1×1 = 16.
    expect(cmp.totals[0]).toMatchObject({ store: 'Lidl' });
    expect(cmp.totals[0].total).toBeCloseTo(11, 10);
    expect(cmp.totals[1].total).toBeCloseTo(16, 10);
  });

  it('counts how often each store is cheapest', () => {
    const cmp = buildStoreComparison(twoStores);
    expect(cmp.totals.find((t) => t.store === 'Lidl').cheapestCount).toBe(2);
    expect(cmp.totals.find((t) => t.store === 'Aldi').cheapestCount).toBe(0);
  });

  it('is not comparable with only one store', () => {
    const cmp = buildStoreComparison([
      entry({ itemKey: 'milk', store: 'Lidl', unitPrice: 1 }),
      entry({ itemKey: 'rice', store: 'Lidl', unitPrice: 2 }),
    ]);
    expect(cmp.comparable).toBe(false);
    expect(cmp.totals).toEqual([]);
  });

  it('is not comparable when too few items overlap', () => {
    const cmp = buildStoreComparison([
      entry({ itemKey: 'milk', store: 'Lidl', unitPrice: 1 }),
      entry({ itemKey: 'milk', store: 'Aldi', unitPrice: 2 }),
    ]);
    expect(cmp.comparable).toBe(false);   // only 1 common item, minItems is 2
  });

  it('ignores entries with no store', () => {
    const cmp = buildStoreComparison([...twoStores, entry({ itemKey: 'milk', store: null, unitPrice: 0.1 })]);
    expect(cmp.stores.map((s) => s.store).sort()).toEqual(['Aldi', 'Lidl']);
    expect(cmp.totals[0].total).toBeCloseTo(3.0, 10);
  });

  it('limits how many stores are compared, keeping the best-covered', () => {
    const many = [];
    ['A', 'B', 'C', 'D', 'E'].forEach((store, si) => {
      // A..D price 3 items each; E prices only 1, so it should be dropped.
      const count = store === 'E' ? 1 : 3;
      for (let i = 0; i < count; i++) {
        many.push(entry({
          itemKey: `item${i}`, itemName: `Item ${i}`, store,
          unitPrice: 1 + si * 0.1, quantity: 1, unit: 'kg', canonicalUnit: 'kg',
          purchasedAt: `2026-01-0${i + 1}`,
        }));
      }
    });
    const cmp = buildStoreComparison(many, { maxStores: 4 });
    expect(cmp.stores).toHaveLength(4);
    expect(cmp.stores.map((s) => s.store)).not.toContain('E');
  });

  it('returns an empty comparison for no entries', () => {
    expect(buildStoreComparison([])).toMatchObject({ comparable: false, totals: [], best: null });
  });
});

describe('formatting', () => {
  it('formats prices to two decimals', () => {
    expect(formatPrice(1.5)).toBe('$1.50');
    expect(formatPrice(0)).toBe('$0.00');
    expect(formatPrice(null)).toBe('$0.00');
    expect(formatPrice(1234.567)).toBe('$1,234.57');
  });

  it('adds precision to sub-cent unit prices', () => {
    expect(formatUnitPrice(1.5, 'kg')).toBe('$1.50/kg');
    expect(formatUnitPrice(0.005, 'g')).toBe('$0.005/g');
    expect(formatUnitPrice(NaN, 'kg')).toBe('—');
  });

  it('formats percentages with more precision when small', () => {
    expect(formatPercent(0.052)).toBe('5.2%');
    expect(formatPercent(-0.25)).toBe('25%');
    expect(formatPercent(0)).toBe('0.0%');
  });
});

describe('trendPresentation', () => {
  it('maps a rise to the danger token', () => {
    expect(trendPresentation('up')).toMatchObject({ colorKey: 'danger', icon: 'trending-up' });
  });

  it('maps a drop to the success token', () => {
    expect(trendPresentation('down')).toMatchObject({ colorKey: 'success', icon: 'trending-down' });
  });

  it('has a neutral presentation for unchanged and first prices', () => {
    expect(trendPresentation('same').colorKey).toBe('textSecondary');
    expect(trendPresentation('new').colorKey).toBe('accent');
    expect(trendPresentation('none').colorKey).toBe('accent');
  });
});
