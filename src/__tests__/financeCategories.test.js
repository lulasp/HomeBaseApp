import { BILL_CATS, EXPENSE_CATS, withCustomCats } from '../utils/financeCategories';

describe('built-in finance categories', () => {
  it.each([['BILL_CATS', BILL_CATS], ['EXPENSE_CATS', EXPENSE_CATS]])('%s have unique keys and end with other', (_, cats) => {
    const keys = cats.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[keys.length - 1]).toBe('other');
  });
});

describe('withCustomCats', () => {
  const builtIn = [
    { key: 'gas', label: 'Gas', icon: 'flame', colorKey: 'amber' },
    { key: 'other', label: 'Other', icon: 'receipt', colorKey: 'textSecondary' },
  ];

  it('returns built-ins untouched when there are no custom cats or overrides', () => {
    expect(withCustomCats(builtIn)).toEqual(builtIn);
  });

  it('appends custom cats flagged as custom emoji cats', () => {
    const [, , custom] = withCustomCats(builtIn, [{ key: 'custom_1', label: 'Pets', icon: '🐕' }]);
    expect(custom).toEqual({
      key: 'custom_1', label: 'Pets', icon: '🐕', colorKey: 'textSecondary', isCustom: true, emoji: true,
    });
  });

  it('applies a label-only override and keeps the Ionicons icon', () => {
    const [gas] = withCustomCats(builtIn, [], { gas: { label: 'Heating' } });
    expect(gas).toEqual({ key: 'gas', label: 'Heating', icon: 'flame', colorKey: 'amber', emoji: false });
  });

  it('marks a built-in with an edited icon as emoji, but not custom', () => {
    const [gas] = withCustomCats(builtIn, [], { gas: { icon: '🔥' } });
    expect(gas.icon).toBe('🔥');
    expect(gas.emoji).toBe(true);
    expect(gas.isCustom).toBeUndefined();
  });

  it('keeps the key stable so stored bills still match', () => {
    const cats = withCustomCats(builtIn, [], { other: { label: 'Misc' } });
    expect(cats.map((c) => c.key)).toEqual(['gas', 'other']);
  });
});

describe('built-in labels follow the app language', () => {
  const { setCurrentLanguage } = require('../i18n');
  afterEach(() => setCurrentLanguage('en'));

  it('reads labels in the current language', () => {
    const rent = BILL_CATS.find((c) => c.key === 'rent');
    expect(rent.label).toBe('Rent');
    setCurrentLanguage('pt');
    expect(rent.label).toBe('Renda');
    expect(EXPENSE_CATS.find((c) => c.key === 'groceries').label).toBe('Supermercado');
  });

  it('keeps a household rename over the translation', () => {
    setCurrentLanguage('pt');
    const [rent] = withCustomCats(BILL_CATS, [], { rent: { label: 'Casa' } });
    expect(rent.label).toBe('Casa');
  });

  it('has a translation for every built-in', () => {
    setCurrentLanguage('pt');
    for (const c of [...BILL_CATS, ...EXPENSE_CATS]) expect(c.label).not.toMatch(/^fin\.cats\./);
  });
});
