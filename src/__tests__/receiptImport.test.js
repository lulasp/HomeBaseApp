import {
  normalizeUnit,
  normalizeReceiptLine,
  normalizeReceipt,
  matchReceiptLines,
  selectedTotal,
  toPriceEntryDocs,
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

describe('normalizeReceiptLine', () => {
  it('normalises a well-formed line', () => {
    expect(normalizeReceiptLine({ name: '  Semi  Skimmed Milk ', price: 1.49, quantity: 2, unit: 'L' }))
      .toEqual({ name: 'Semi Skimmed Milk', price: 1.49, quantity: 2, unit: 'L', itemKey: 'semi skimmed milk' });
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
