import {
  normalizeUnit,
  normalizeCode,
  normalizeReceiptLine,
  normalizeReceipt,
  matchReceiptLines,
  selectedTotal,
  toPriceEntryDocs,
  convertQuantity,
  findPantryMatch,
  toPantryOps,
} from '../utils/receiptImport';
import { buildPriceHistory } from '../utils/pricing';

describe('normalizeUnit', () => {
  it('passes through units the app already knows', () => {
    ['kg', 'g', 'L', 'ml', 'pcs', 'pack', 'bottle'].forEach((u) => {
      expect(normalizeUnit(u)).toBe(u);
    });
  });

  it('is case-insensitive', () => {
    expect(normalizeUnit('KG')).toBe('kg');
    expect(normalizeUnit('Ml')).toBe('ml');
    expect(normalizeUnit('l')).toBe('L');
  });

  it('maps common aliases', () => {
    expect(normalizeUnit('litre')).toBe('L');
    expect(normalizeUnit('grams')).toBe('g');
    expect(normalizeUnit('each')).toBe('pcs');
    expect(normalizeUnit('ea')).toBe('pcs');
    expect(normalizeUnit('pieces')).toBe('pcs');
    expect(normalizeUnit('pkt')).toBe('pack');
  });

  it('falls back to pcs for anything unrecognised', () => {
    // A hallucinated unit must not silently create a new comparison family.
    expect(normalizeUnit('sparkles')).toBe('pcs');
    expect(normalizeUnit('')).toBe('pcs');
    expect(normalizeUnit(null)).toBe('pcs');
    expect(normalizeUnit(undefined)).toBe('pcs');
  });
});

describe('normalizeCode', () => {
  it('strips punctuation and upper-cases', () => {
    expect(normalizeCode(' a-123.45 ')).toBe('A12345');
  });

  it('drops codes too short to identify a product', () => {
    // "3" is the till's counter key for loose bananas, not a product id.
    expect(normalizeCode('3')).toBe('');
    expect(normalizeCode('12')).toBe('');
    expect(normalizeCode('1234')).toBe('1234');
  });

  it('is empty for missing input', () => {
    expect(normalizeCode('')).toBe('');
    expect(normalizeCode(null)).toBe('');
    expect(normalizeCode(undefined)).toBe('');
  });
});

describe('normalizeReceiptLine', () => {
  it('normalises a well-formed line', () => {
    expect(normalizeReceiptLine({
      name: '  Semi  Skimmed Milk ', rawName: 'SEMI SKIM MLK 1L',
      code: '77012', price: 1.49, quantity: 2, unit: 'L',
    })).toEqual({
      name: 'Semi Skimmed Milk', itemKey: 'semi skimmed milk',
      rawName: 'SEMI SKIM MLK 1L', rawKey: 'semi skim mlk 1l', code: '77012',
      price: 1.49, quantity: 2, unit: 'L',
    });
  });

  it('defaults a missing or unusable quantity to 1', () => {
    expect(normalizeReceiptLine({ name: 'Milk', price: 1 }).quantity).toBe(1);
    expect(normalizeReceiptLine({ name: 'Milk', price: 1, quantity: 0 }).quantity).toBe(1);
    expect(normalizeReceiptLine({ name: 'Milk', price: 1, quantity: -2 }).quantity).toBe(1);
    expect(normalizeReceiptLine({ name: 'Milk', price: 1, quantity: 'x' }).quantity).toBe(1);
  });

  it('keeps a fractional weight quantity', () => {
    const line = normalizeReceiptLine({ name: 'Bananas', price: 1.44, quantity: 0.482, unit: 'kg' });
    expect(line.quantity).toBeCloseTo(0.482, 10);
    expect(line.unit).toBe('kg');
  });

  it('drops lines with no usable price', () => {
    // Totals, discounts and payment rows all land here.
    expect(normalizeReceiptLine({ name: 'TOTAL', price: 0 })).toBeNull();
    expect(normalizeReceiptLine({ name: 'Discount', price: -2 })).toBeNull();
    expect(normalizeReceiptLine({ name: 'Milk', price: 'abc' })).toBeNull();
    expect(normalizeReceiptLine({ name: 'Milk' })).toBeNull();
  });

  it('drops lines with no name', () => {
    expect(normalizeReceiptLine({ name: '   ', price: 2 })).toBeNull();
    expect(normalizeReceiptLine({ price: 2 })).toBeNull();
  });

  it('survives a null line', () => {
    expect(normalizeReceiptLine(null)).toBeNull();
    expect(normalizeReceiptLine(undefined)).toBeNull();
  });

  it('keeps the printed text verbatim alongside the tidied name', () => {
    // rawName is the identity key: it must survive the model's beautification
    // and any later rename, or the next receipt cannot be recognised.
    const line = normalizeReceiptLine({
      name: 'Dishwasher Tablets', rawName: 'DETERG. E PROD LIMPEZA',
      price: 8.99, quantity: 1, unit: 'pcs',
    });
    expect(line.rawName).toBe('DETERG. E PROD LIMPEZA');
    expect(line.rawKey).toBe('deterg e prod limpeza');
    expect(line.name).toBe('Dishwasher Tablets');
  });

  it('falls back to the tidied name when the model omits rawName', () => {
    const line = normalizeReceiptLine({ name: 'Milk', price: 1, quantity: 1, unit: 'L' });
    expect(line.rawName).toBe('Milk');
    expect(line.rawKey).toBe('milk');
  });

  it('uses the printed text when only rawName came back', () => {
    const line = normalizeReceiptLine({ rawName: 'MLK 1L', price: 1, quantity: 1, unit: 'L' });
    expect(line.name).toBe('MLK 1L');
    expect(line.itemKey).toBe('mlk 1l');
  });

  it('normalizes the article code', () => {
    expect(normalizeReceiptLine({ name: 'Milk', code: 'a-123.45', price: 1 }).code).toBe('A12345');
    expect(normalizeReceiptLine({ name: 'Milk', price: 1 }).code).toBe('');
  });
});

describe('normalizeReceipt', () => {
  it('normalises the header and keeps only usable lines', () => {
    const receipt = normalizeReceipt({
      store: '  Lidl ',
      date: '2026-03-04',
      lines: [
        { name: 'Milk', price: 1.49, quantity: 1, unit: 'L' },
        { name: 'TOTAL', price: 0 },
        { name: '', price: 5 },
      ],
    });
    expect(receipt.store).toBe('Lidl');
    expect(receipt.date).toBe('2026-03-04');
    expect(receipt.lines).toHaveLength(1);
  });

  it('blanks an unparseable date rather than inventing one', () => {
    expect(normalizeReceipt({ date: '04/03/2026', lines: [] }).date).toBe('');
    expect(normalizeReceipt({ date: 'yesterday', lines: [] }).date).toBe('');
    expect(normalizeReceipt({ lines: [] }).date).toBe('');
  });

  it('survives a malformed payload', () => {
    expect(normalizeReceipt(null)).toEqual({ store: '', date: '', lines: [] });
    expect(normalizeReceipt({})).toEqual({ store: '', date: '', lines: [] });
    expect(normalizeReceipt({ lines: 'nope' }).lines).toEqual([]);
  });
});

describe('matchReceiptLines', () => {
  const history = buildPriceHistory([
    {
      itemKey: 'milk', itemName: 'Milk', category: 'Refrigerated', store: 'Lidl',
      price: 1.4, quantity: 1, unit: 'L', canonicalUnit: 'L', unitPrice: 1.4,
      purchasedAt: '2026-01-01',
    },
  ]);

  it('matches a line onto an existing tracked item', () => {
    const [line] = matchReceiptLines(
      [{ name: 'Milk', price: 1.49, quantity: 1, unit: 'L', itemKey: 'milk' }],
      history,
    );
    expect(line.matchedItem).toEqual({ itemKey: 'milk', itemName: 'Milk' });
    expect(line.category).toBe('Refrigerated');
    expect(line.lastPrice).toBe(1.4);
    expect(line.include).toBe(true);
  });

  it('marks an unmatched line as new with the Other category', () => {
    const [line] = matchReceiptLines(
      [{ name: 'Saffron', price: 6, quantity: 1, unit: 'g', itemKey: 'saffron' }],
      history,
    );
    expect(line.matchedItem).toBeNull();
    expect(line.category).toBe('Other');
    expect(line.lastPrice).toBeNull();
    expect(line.unitMismatch).toBe(false);
  });

  it('flags a unit family change against the tracked history', () => {
    const [line] = matchReceiptLines(
      [{ name: 'Milk', price: 3, quantity: 2, unit: 'pcs', itemKey: 'milk' }],
      history,
    );
    expect(line.unitMismatch).toBe(true);
  });

  it('does not flag a different unit in the same family', () => {
    const [line] = matchReceiptLines(
      [{ name: 'Milk', price: 1, quantity: 500, unit: 'ml', itemKey: 'milk' }],
      history,
    );
    expect(line.unitMismatch).toBe(false);
  });

  it('works with no history at all', () => {
    const [line] = matchReceiptLines([{ name: 'Milk', price: 1, quantity: 1, unit: 'L', itemKey: 'milk' }]);
    expect(line.matchedItem).toBeNull();
  });
});

describe('selectedTotal', () => {
  const lines = [
    { price: 1.5, include: true },
    { price: 2.5, include: true },
    { price: 9.0, include: false },
  ];

  it('sums only the included lines', () => {
    expect(selectedTotal(lines)).toBeCloseTo(4, 10);
  });

  it('is zero for nothing selected', () => {
    expect(selectedTotal([{ price: 5, include: false }])).toBe(0);
    expect(selectedTotal([])).toBe(0);
    expect(selectedTotal()).toBe(0);
  });
});

describe('toPriceEntryDocs', () => {
  const lines = [
    { name: 'Milk', price: 1.49, quantity: 1, unit: 'L', category: 'Refrigerated', include: true, matchedItem: null },
    { name: 'Eggs', price: 3.00, quantity: 6, unit: 'pcs', category: 'Other', include: false, matchedItem: null },
  ];

  it('builds entries only for included lines', () => {
    const docs = toPriceEntryDocs(lines, { store: 'Lidl', date: '2026-03-04', addedBy: 'uid1' });
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      itemKey: 'milk', itemName: 'Milk', price: 1.49, quantity: 1,
      unit: 'L', canonicalUnit: 'L', store: 'Lidl',
      purchasedAt: '2026-03-04', category: 'Refrigerated', addedBy: 'uid1',
    });
    expect(docs[0].unitPrice).toBeCloseTo(1.49, 10);
  });

  it('files a matched line under the tracked item name, not the receipt text', () => {
    // Keeps "SEMI SKIM MLK" from starting a rival history next to "Milk".
    const docs = toPriceEntryDocs(
      [{ name: 'SEMI SKIM MLK', price: 1.2, quantity: 1, unit: 'L', include: true, matchedItem: { itemKey: 'milk', itemName: 'Milk' } }],
      { store: 'Lidl', date: '2026-03-04' },
    );
    expect(docs[0].itemName).toBe('Milk');
    expect(docs[0].itemKey).toBe('milk');
  });

  it('falls back to today for a missing or malformed date', () => {
    const today = /^\d{4}-\d{2}-\d{2}$/;
    expect(toPriceEntryDocs(lines, { store: 'Lidl' })[0].purchasedAt).toMatch(today);
    expect(toPriceEntryDocs(lines, { store: 'Lidl', date: '4 March' })[0].purchasedAt).toMatch(today);
  });

  it('drops lines that cannot produce a valid entry', () => {
    const docs = toPriceEntryDocs(
      [{ name: '', price: 2, quantity: 1, unit: 'L', include: true }],
      { store: 'Lidl', date: '2026-03-04' },
    );
    expect(docs).toEqual([]);
  });

  it('returns nothing when everything is deselected', () => {
    expect(toPriceEntryDocs(lines.map((l) => ({ ...l, include: false })), { store: 'Lidl' })).toEqual([]);
  });
});

// ── Pantry side ───────────────────────────────────────────────────────────────

describe('convertQuantity', () => {
  it('converts within a unit family', () => {
    expect(convertQuantity(500, 'g', 'kg')).toBeCloseTo(0.5, 10);
    expect(convertQuantity(2, 'kg', 'g')).toBeCloseTo(2000, 10);
    expect(convertQuantity(1500, 'ml', 'L')).toBeCloseTo(1.5, 10);
  });

  it('is the identity for the same unit', () => {
    expect(convertQuantity(3, 'pcs', 'pcs')).toBe(3);
  });

  it('refuses to cross unit families', () => {
    expect(convertQuantity(2, 'pcs', 'g')).toBeNull();
    expect(convertQuantity(1, 'L', 'kg')).toBeNull();
  });

  it('returns null for an unusable quantity', () => {
    expect(convertQuantity(0, 'g', 'kg')).toBeNull();
    expect(convertQuantity(-1, 'g', 'kg')).toBeNull();
    expect(convertQuantity('abc', 'g', 'kg')).toBeNull();
  });
});

describe('findPantryMatch', () => {
  const pantry = [
    { id: 'p1', name: 'Milk',     quantity: '2', unit: 'L' },
    { id: 'p2', name: 'Tomatoes', quantity: '5', unit: 'pcs' },
  ];

  it('matches on the normalized name, not the exact text', () => {
    expect(findPantryMatch({ name: 'TOMATO', unit: 'pcs' }, pantry))
      .toMatchObject({ id: 'p2', quantity: '5', unit: 'pcs' });
  });

  it('matches a different unit inside the same family', () => {
    expect(findPantryMatch({ name: 'Milk', unit: 'ml' }, pantry)).toMatchObject({ id: 'p1' });
  });

  it('refuses a match across unit families — the quantities cannot be added', () => {
    expect(findPantryMatch({ name: 'Milk', unit: 'pcs' }, pantry)).toBeNull();
  });

  it('returns null for an unknown item, an empty name, or no pantry', () => {
    expect(findPantryMatch({ name: 'Saffron', unit: 'g' }, pantry)).toBeNull();
    expect(findPantryMatch({ name: '', unit: 'g' }, pantry)).toBeNull();
    expect(findPantryMatch({ name: 'Milk', unit: 'L' })).toBeNull();
  });
});

describe('matchReceiptLines — pantry defaults', () => {
  const history = buildPriceHistory([
    {
      itemKey: 'bleach', itemName: 'Bleach', category: 'Cleaning Supplies', store: 'Lidl',
      price: 2, quantity: 1, unit: 'L', canonicalUnit: 'L', unitPrice: 2,
      purchasedAt: '2026-01-01',
    },
  ]);
  const pantry = [{ id: 'p1', name: 'Milk', quantity: '2', unit: 'L' }];

  it('defaults food lines to the pantry', () => {
    const [line] = matchReceiptLines(
      [{ name: 'Milk', price: 1, quantity: 1, unit: 'L', itemKey: 'milk' }],
      [], { pantryItems: pantry },
    );
    expect(line.toPantry).toBe(true);
    expect(line.pantryMatch).toMatchObject({ id: 'p1' });
    expect(line.expiryDate).toBe('');
  });

  it('keeps a non-food line out of the pantry by default', () => {
    const [line] = matchReceiptLines(
      [{ name: 'Bleach', price: 2, quantity: 1, unit: 'L', itemKey: 'bleach' }],
      history,
    );
    expect(line.category).toBe('Cleaning Supplies');
    expect(line.toPantry).toBe(false);
    // Still worth a price entry — only the pantry side is opted out.
    expect(line.include).toBe(true);
  });

  it('honours a custom non-food category list from the household', () => {
    const [line] = matchReceiptLines(
      [{ name: 'Milk', price: 1, quantity: 1, unit: 'L', itemKey: 'milk' }],
      [], { nonFoodCategories: ['Other'] },
    );
    expect(line.toPantry).toBe(false);
  });

  it('leaves pantryMatch null when nothing in the pantry matches', () => {
    const [line] = matchReceiptLines(
      [{ name: 'Saffron', price: 6, quantity: 1, unit: 'g', itemKey: 'saffron' }],
      [], { pantryItems: pantry },
    );
    expect(line.pantryMatch).toBeNull();
    expect(line.toPantry).toBe(true);
  });
});

describe('toPantryOps', () => {
  const base = {
    include: true, toPantry: true, matchedItem: null,
    pantryMatch: null, expiryDate: '', category: 'Refrigerated',
  };

  it('creates a row for an item the pantry does not have', () => {
    const { creates, merges } = toPantryOps(
      [{ ...base, name: 'Milk', quantity: 2, unit: 'L' }],
      { addedBy: 'uid1' },
    );
    expect(merges).toEqual([]);
    expect(creates).toEqual([{
      name: 'Milk', quantity: '2', unit: 'L', category: 'Refrigerated',
      expiryDate: null, addedBy: 'uid1',
    }]);
  });

  it('tops up an existing row instead of creating a second one', () => {
    const { creates, merges } = toPantryOps([{
      ...base, name: 'Milk', quantity: 1, unit: 'L',
      pantryMatch: { id: 'p1', name: 'Milk', quantity: '2', unit: 'L' },
    }]);
    expect(creates).toEqual([]);
    expect(merges).toEqual([{ id: 'p1', quantity: '3' }]);
  });

  it('converts into the unit of the pantry row before adding', () => {
    // 500 g bought against 1.5 kg on hand → 2 kg, not 501.5 of anything.
    const { merges } = toPantryOps([{
      ...base, name: 'Flour', quantity: 500, unit: 'g',
      pantryMatch: { id: 'p2', name: 'Flour', quantity: '1.5', unit: 'kg' },
    }]);
    expect(merges).toEqual([{ id: 'p2', quantity: '2' }]);
  });

  it('coalesces two receipt lines that hit the same pantry row', () => {
    // A till receipt lists the same product twice; two updates to one doc in a
    // batch would leave only the last, silently losing the first bottle.
    const match = { id: 'p1', name: 'Milk', quantity: '2', unit: 'L' };
    const { merges } = toPantryOps([
      { ...base, name: 'Milk', quantity: 1, unit: 'L', pantryMatch: match },
      { ...base, name: 'Milk', quantity: 1, unit: 'L', pantryMatch: match },
    ]);
    expect(merges).toEqual([{ id: 'p1', quantity: '4' }]);
  });

  it('coalesces two new lines for the same item and unit', () => {
    const { creates } = toPantryOps([
      { ...base, name: 'Eggs', quantity: 6, unit: 'pcs' },
      { ...base, name: 'EGG',  quantity: 6, unit: 'pcs' },
    ]);
    expect(creates).toHaveLength(1);
    expect(creates[0].quantity).toBe('12');
  });

  it('keeps different units of the same item as separate rows', () => {
    const { creates } = toPantryOps([
      { ...base, name: 'Rice', quantity: 1, unit: 'kg' },
      { ...base, name: 'Rice', quantity: 2, unit: 'pack' },
    ]);
    expect(creates).toHaveLength(2);
  });

  it('skips lines that are deselected or not bound for the pantry', () => {
    const ops = toPantryOps([
      { ...base, name: 'Milk',   quantity: 1, unit: 'L', include: false },
      { ...base, name: 'Bleach', quantity: 1, unit: 'L', toPantry: false },
    ]);
    expect(ops).toEqual({ merges: [], creates: [] });
  });

  it('files a matched line under the tracked item name', () => {
    const { creates } = toPantryOps([{
      ...base, name: 'SEMI SKIM MLK', quantity: 1, unit: 'L',
      matchedItem: { itemKey: 'milk', itemName: 'Milk' },
    }]);
    expect(creates[0].name).toBe('Milk');
  });

  it('carries a valid expiry through and ignores a malformed one', () => {
    const { creates } = toPantryOps([
      { ...base, name: 'Milk',   quantity: 1, unit: 'L', expiryDate: '2026-09-01' },
      { ...base, name: 'Yogurt', quantity: 1, unit: 'pcs', expiryDate: 'next week' },
    ]);
    expect(creates[0].expiryDate).toBe('2026-09-01');
    expect(creates[1].expiryDate).toBeNull();
  });

  it('keeps the soonest expiry when lines are coalesced', () => {
    const { creates } = toPantryOps([
      { ...base, name: 'Milk', quantity: 1, unit: 'L', expiryDate: '2026-09-10' },
      { ...base, name: 'Milk', quantity: 1, unit: 'L', expiryDate: '2026-09-02' },
    ]);
    expect(creates[0].expiryDate).toBe('2026-09-02');
  });

  it('omits expiryDate from a merge so an existing date is not wiped', () => {
    const { merges } = toPantryOps([{
      ...base, name: 'Milk', quantity: 1, unit: 'L',
      pantryMatch: { id: 'p1', name: 'Milk', quantity: '2', unit: 'L' },
    }]);
    expect(merges[0]).not.toHaveProperty('expiryDate');
  });

  it('creates a new row when the matched unit family is incompatible', () => {
    const { creates, merges } = toPantryOps([{
      ...base, name: 'Milk', quantity: 1, unit: 'pcs',
      pantryMatch: { id: 'p1', name: 'Milk', quantity: '2', unit: 'L' },
    }]);
    expect(merges).toEqual([]);
    expect(creates).toHaveLength(1);
  });

  it('falls back to a quantity of 1 for unusable input', () => {
    const { creates } = toPantryOps([{ ...base, name: 'Milk', quantity: '', unit: 'L' }]);
    expect(creates[0].quantity).toBe('1');
  });

  it('rounds away floating-point conversion noise', () => {
    const { merges } = toPantryOps([{
      ...base, name: 'Flour', quantity: 333, unit: 'g',
      pantryMatch: { id: 'p1', name: 'Flour', quantity: '0', unit: 'kg' },
    }]);
    expect(merges[0].quantity).toBe('0.333');
  });

  it('handles an empty or missing line list', () => {
    expect(toPantryOps([])).toEqual({ merges: [], creates: [] });
    expect(toPantryOps()).toEqual({ merges: [], creates: [] });
  });
});
