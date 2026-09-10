import {
  lookupKeysFor,
  aliasDocId,
  buildAliasIndex,
  rankTargets,
  resolveLine,
  applyAliases,
  bindLineToItem,
  aliasDocsFromLines,
  CODE_PREFIX,
  RAW_PREFIX,
} from '../utils/receiptAliases';

// A department heading standing in for a product — the case the whole module
// exists for.
const HEADING = 'deterg e prod limpeza';

const alias = (over = {}) => ({
  lookupKey: `${RAW_PREFIX}${HEADING}`,
  rawText:   'DETERG. E PROD LIMPEZA',
  code:      '',
  itemKey:   'pastilhas finish',
  itemName:  'Pastilhas Finish',
  category:  'Cleaning Supplies',
  store:     'Continente',
  lastPrice: 8.99,
  uses:      1,
  updatedAt: '2026-06-01T10:00:00Z',
  ...over,
});

const line = (over = {}) => ({
  name: 'Deterg. e prod Limpeza',
  rawName: 'DETERG. E PROD LIMPEZA',
  rawKey: HEADING,
  code: '',
  price: 8.99,
  quantity: 1,
  unit: 'pcs',
  itemKey: HEADING,
  ...over,
});

describe('lookupKeysFor', () => {
  it('prefers the article code over the printed text', () => {
    expect(lookupKeysFor(line({ code: 'A12345' })))
      .toEqual([`${CODE_PREFIX}A12345`, `${RAW_PREFIX}${HEADING}`]);
  });

  it('falls back to the printed text when there is no code', () => {
    expect(lookupKeysFor(line())).toEqual([`${RAW_PREFIX}${HEADING}`]);
  });

  it('returns nothing identifiable for an empty line', () => {
    expect(lookupKeysFor({})).toEqual([]);
    expect(lookupKeysFor(null)).toEqual([]);
  });
});

describe('aliasDocId', () => {
  it('is stable for the same mapping, so re-importing upserts', () => {
    const a = aliasDocId(`${RAW_PREFIX}${HEADING}`, 'pastilhas finish', 'Continente');
    const b = aliasDocId(`${RAW_PREFIX}${HEADING}`, 'pastilhas finish', 'continente');
    expect(a).toBe(b);
  });

  it('separates different items behind the same printed line', () => {
    expect(aliasDocId(`${RAW_PREFIX}${HEADING}`, 'pastilhas finish', 'Continente'))
      .not.toBe(aliasDocId(`${RAW_PREFIX}${HEADING}`, 'lixivia', 'Continente'));
  });

  it('never produces a document id containing a slash', () => {
    expect(aliasDocId('r:a/b', 'c/d', 'e/f')).not.toContain('/');
  });
});

describe('buildAliasIndex', () => {
  it('groups targets under their lookup key', () => {
    const index = buildAliasIndex([alias(), alias({ itemKey: 'lixivia', itemName: 'Lixívia' })]);
    expect(index.get(`${RAW_PREFIX}${HEADING}`).size).toBe(2);
  });

  it('folds the per-store rows of one mapping back together', () => {
    const index = buildAliasIndex([
      alias({ store: 'Continente' }),
      alias({ store: 'Pingo Doce' }),
    ]);
    const target = index.get(`${RAW_PREFIX}${HEADING}`).get('pastilhas finish');
    expect(target.uses).toBe(2);
    expect(target.stores.has('continente')).toBe(true);
    expect(target.stores.has('pingo doce')).toBe(true);
  });

  it('takes drifting fields from the most recent row', () => {
    const index = buildAliasIndex([
      alias({ updatedAt: '2026-01-01T00:00:00Z', lastPrice: 5, itemName: 'Old Name' }),
      alias({ updatedAt: '2026-06-01T00:00:00Z', lastPrice: 9, itemName: 'Pastilhas Finish' }),
    ]);
    const target = index.get(`${RAW_PREFIX}${HEADING}`).get('pastilhas finish');
    expect(target.itemName).toBe('Pastilhas Finish');
    expect(target.lastPrice).toBe(9);
  });

  it('skips rows with no usable key', () => {
    expect(buildAliasIndex([{ itemKey: 'x' }, { lookupKey: 'r:y' }, null]).size).toBe(0);
  });

  it('handles an empty or missing list', () => {
    expect(buildAliasIndex([]).size).toBe(0);
    expect(buildAliasIndex().size).toBe(0);
  });
});

describe('rankTargets', () => {
  const target = (over = {}) => ({
    itemKey: 'a', itemName: 'A', category: null,
    lastPrice: 10, stores: new Set(['continente']), uses: 1, at: 0, ...over,
  });

  it('puts the store you are shopping in first', () => {
    const ranked = rankTargets(
      [target({ itemKey: 'far', stores: new Set(['lidl']), uses: 99 }), target({ itemKey: 'near' })],
      { store: 'Continente' },
    );
    expect(ranked[0].itemKey).toBe('near');
  });

  it('prefers a candidate whose last price is close to what was paid', () => {
    const ranked = rankTargets(
      [target({ itemKey: 'pricey', lastPrice: 40 }), target({ itemKey: 'close', lastPrice: 9.5 })],
      { store: 'Continente', price: 10 },
    );
    expect(ranked[0].itemKey).toBe('close');
  });

  it('falls back to how often the mapping was confirmed', () => {
    const ranked = rankTargets(
      [target({ itemKey: 'rare', uses: 1 }), target({ itemKey: 'common', uses: 8 })],
      { store: 'Continente' },
    );
    expect(ranked[0].itemKey).toBe('common');
  });

  it('breaks a remaining tie on recency', () => {
    const ranked = rankTargets(
      [target({ itemKey: 'old', at: 1 }), target({ itemKey: 'new', at: 2 })],
      {},
    );
    expect(ranked[0].itemKey).toBe('new');
  });
});

describe('resolveLine', () => {
  it('resolves a line with exactly one known meaning', () => {
    const index = buildAliasIndex([alias()]);
    const { target, options } = resolveLine(line(), index, { store: 'Continente' });
    expect(target.itemName).toBe('Pastilhas Finish');
    expect(options).toHaveLength(1);
  });

  it('refuses to pick when the printed line has meant several things', () => {
    // Guessing here is how bleach ends up in the Finish price history.
    const index = buildAliasIndex([alias(), alias({ itemKey: 'lixivia', itemName: 'Lixívia' })]);
    const { target, options } = resolveLine(line(), index, { store: 'Continente' });
    expect(target).toBeNull();
    expect(options.map((o) => o.itemName).sort()).toEqual(['Lixívia', 'Pastilhas Finish']);
  });

  it('lets an article code win over the printed text', () => {
    const index = buildAliasIndex([
      alias({ lookupKey: `${CODE_PREFIX}A12345`, itemKey: 'pastilhas finish', itemName: 'Pastilhas Finish' }),
      alias({ itemKey: 'lixivia', itemName: 'Lixívia' }),
      alias({ itemKey: 'detergente chao', itemName: 'Detergente Chão' }),
    ]);
    const { target } = resolveLine(line({ code: 'A12345' }), index, { store: 'Continente' });
    expect(target.itemName).toBe('Pastilhas Finish');
  });

  it('does not fall back to the text when the code is itself ambiguous', () => {
    const index = buildAliasIndex([
      alias({ lookupKey: `${CODE_PREFIX}A12345`, itemKey: 'one', itemName: 'One' }),
      alias({ lookupKey: `${CODE_PREFIX}A12345`, itemKey: 'two', itemName: 'Two' }),
      alias(),
    ]);
    const { target, options } = resolveLine(line({ code: 'A12345' }), index, {});
    expect(target).toBeNull();
    expect(options).toHaveLength(2);
  });

  it('returns nothing for an unknown line or a missing index', () => {
    expect(resolveLine(line(), buildAliasIndex([]))).toEqual({ lookupKey: null, target: null, options: [] });
    expect(resolveLine(line(), undefined)).toEqual({ lookupKey: null, target: null, options: [] });
  });
});

describe('applyAliases', () => {
  it('rewrites identity for an unambiguous line', () => {
    const index = buildAliasIndex([alias()]);
    const [out] = applyAliases([line()], index, { store: 'Continente' });
    expect(out.name).toBe('Pastilhas Finish');
    expect(out.itemKey).toBe('pastilhas finish');
    expect(out.aliasCategory).toBe('Cleaning Supplies');
    expect(out.aliasApplied).toBe(true);
  });

  it('leaves the raw receipt text untouched when it rewrites the name', () => {
    // The raw text is the key the next import looks up — losing it to the
    // pretty name is exactly the bug this module fixes.
    const index = buildAliasIndex([alias()]);
    const [out] = applyAliases([line()], index, { store: 'Continente' });
    expect(out.rawName).toBe('DETERG. E PROD LIMPEZA');
    expect(out.rawKey).toBe(HEADING);
  });

  it('leaves an ambiguous line alone but carries its candidates', () => {
    const index = buildAliasIndex([alias(), alias({ itemKey: 'lixivia', itemName: 'Lixívia' })]);
    const [out] = applyAliases([line()], index, { store: 'Continente' });
    expect(out.aliasApplied).toBe(false);
    expect(out.name).toBe('Deterg. e prod Limpeza');
    expect(out.aliasOptions).toHaveLength(2);
  });

  it('passes an unknown line through unchanged', () => {
    const [out] = applyAliases([line({ rawKey: 'saffron', name: 'Saffron' })], buildAliasIndex([]));
    expect(out.name).toBe('Saffron');
    expect(out.aliasApplied).toBe(false);
    expect(out.aliasOptions).toEqual([]);
  });
});

describe('bindLineToItem', () => {
  it('points the line at the chosen item', () => {
    const out = bindLineToItem(line(), {
      itemKey: 'pastilhas finish', itemName: 'Pastilhas Finish', category: 'Cleaning Supplies',
    });
    expect(out.name).toBe('Pastilhas Finish');
    expect(out.itemKey).toBe('pastilhas finish');
    expect(out.category).toBe('Cleaning Supplies');
    expect(out.matchedItem).toEqual({ itemKey: 'pastilhas finish', itemName: 'Pastilhas Finish' });
  });

  it('keeps the printed text so the mapping can still be learned', () => {
    const out = bindLineToItem(line(), { itemKey: 'pastilhas finish', itemName: 'Pastilhas Finish' });
    expect(out.rawName).toBe('DETERG. E PROD LIMPEZA');
  });

  it('derives a key from the name when none is given', () => {
    expect(bindLineToItem(line(), { itemName: 'Pastilhas Finish' }).itemKey).toBe('pastilhas finish');
  });

  it('is a no-op without a usable target', () => {
    expect(bindLineToItem(line(), {})).toEqual(line());
    expect(bindLineToItem(line())).toEqual(line());
  });
});

describe('aliasDocsFromLines', () => {
  const committed = (over = {}) => ({ ...line(), include: true, toPantry: false, matchedItem: null, category: 'Other', ...over });

  it('records what a corrected line turned out to mean', () => {
    const [docId] = aliasDocsFromLines([committed({
      name: 'Pastilhas Finish',
      matchedItem: { itemKey: 'pastilhas finish', itemName: 'Pastilhas Finish' },
      category: 'Cleaning Supplies',
    })], { store: 'Continente' });

    expect(docId).toMatchObject({
      lookupKey: `${RAW_PREFIX}${HEADING}`,
      rawText:   'DETERG. E PROD LIMPEZA',
      itemKey:   'pastilhas finish',
      itemName:  'Pastilhas Finish',
      category:  'Cleaning Supplies',
      store:     'Continente',
      lastPrice: 8.99,
      uses:      1,
    });
  });

  it('writes both a code and a text mapping when the receipt prints a code', () => {
    // The text row is the fallback for a future receipt that omits the code.
    const docs = aliasDocsFromLines([committed({ code: 'A12345' })], { store: 'Continente' });
    expect(docs.map((d) => d.lookupKey).sort())
      .toEqual([`${CODE_PREFIX}A12345`, `${RAW_PREFIX}${HEADING}`].sort());
  });

  it('does not double-count two receipt lines for the same product', () => {
    const docs = aliasDocsFromLines(
      [committed(), committed()],
      { store: 'Continente' },
    );
    expect(docs).toHaveLength(1);
    expect(docs[0].uses).toBe(1);
  });

  it('records a pantry-only line too', () => {
    const docs = aliasDocsFromLines([committed({ include: false, toPantry: true })], { store: 'Lidl' });
    expect(docs).toHaveLength(1);
  });

  it('skips lines the user dropped entirely', () => {
    expect(aliasDocsFromLines([committed({ include: false, toPantry: false })], { store: 'Lidl' }))
      .toEqual([]);
  });

  it('skips a line whose name normalizes to nothing', () => {
    expect(aliasDocsFromLines([committed({ name: '   ', matchedItem: null })], {})).toEqual([]);
  });

  it('handles an empty or missing list', () => {
    expect(aliasDocsFromLines([], {})).toEqual([]);
    expect(aliasDocsFromLines()).toEqual([]);
  });
});

// ── The round trip the whole feature exists for ───────────────────────────────

describe('learning a department heading end to end', () => {
  it('recognises on the second receipt what the shopper corrected on the first', () => {
    // First shop: the receipt prints a heading, the shopper renames the line.
    const corrected = bindLineToItem(line(), {
      itemKey: 'pastilhas finish', itemName: 'Pastilhas Finish', category: 'Cleaning Supplies',
    });
    const saved = aliasDocsFromLines([{ ...corrected, include: true }], { store: 'Continente' });

    // Second shop: same heading printed, nothing typed by hand.
    const index = buildAliasIndex(saved.map((d) => ({ ...d, updatedAt: '2026-06-02T00:00:00Z' })));
    const [second] = applyAliases([line()], index, { store: 'Continente' });

    expect(second.aliasApplied).toBe(true);
    expect(second.name).toBe('Pastilhas Finish');
    expect(second.itemKey).toBe('pastilhas finish');
  });

  it('asks rather than guesses once the heading covers two products', () => {
    const finish = aliasDocsFromLines(
      [{ ...bindLineToItem(line(), { itemKey: 'pastilhas finish', itemName: 'Pastilhas Finish' }), include: true }],
      { store: 'Continente' },
    );
    const bleach = aliasDocsFromLines(
      [{ ...bindLineToItem(line({ price: 1.2 }), { itemKey: 'lixivia', itemName: 'Lixívia' }), include: true }],
      { store: 'Continente' },
    );

    const index = buildAliasIndex([...finish, ...bleach]);
    const [out] = applyAliases([line({ price: 8.99 })], index, { store: 'Continente' });

    expect(out.aliasApplied).toBe(false);
    expect(out.aliasOptions).toHaveLength(2);
    // Price is what makes the Finish tablets the first suggestion, not bleach.
    expect(out.aliasOptions[0].itemName).toBe('Pastilhas Finish');
  });
});
