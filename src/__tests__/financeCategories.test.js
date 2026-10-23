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
