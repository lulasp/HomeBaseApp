// Built-in finance categories, shared by the Finances screen and the
// statement importer. Custom categories live per-household in Firestore
// (billCustomCategories / expenseCustomCategories) and are merged in at runtime.
//
// Built-in labels are getters, so they read in the app's current language each
// time they're used. Custom and edited labels are the household's own text.

import { t } from '../i18n';

const builtIn = (key, icon, colorKey) => ({
  key,
  get label() { return t(`fin.cats.${key}`); },
  icon,
  colorKey,
});

export const BILL_CATS = [
  builtIn('rent', 'home', 'accent'),
  builtIn('electricity', 'flash', 'amber'),
  builtIn('water', 'water', 'accent'),
  builtIn('gas', 'flame', 'amber'),
  builtIn('internet', 'wifi', 'sage'),
  builtIn('phone', 'phone-portrait', 'accent'),
  builtIn('insurance', 'shield-checkmark', 'sage'),
  builtIn('subscriptions', 'repeat', 'accent'),
  builtIn('other', 'receipt', 'textSecondary'),
];

export const EXPENSE_CATS = [
  builtIn('groceries', 'cart', 'sage'),
  builtIn('repairs', 'build', 'amber'),
  builtIn('cleaning', 'sparkles', 'accent'),
  builtIn('furniture', 'bed', 'accent'),
  builtIn('appliances', 'tv', 'accent'),
  builtIn('utilities', 'bulb', 'amber'),
  builtIn('other', 'cash', 'textSecondary'),
];

// Merge built-in cats with a household's custom cats, applying any edits to the
// built-ins (overrides keyed by `key`: { label?, icon? }). `emoji` marks cats whose
// icon is an emoji rather than an Ionicons name — custom ones, and built-ins
// whose icon was edited.
export const withCustomCats = (builtIn, custom = [], overrides) => [
  ...builtIn.map((c) => {
    const o = overrides?.[c.key];
    return o ? { ...c, ...o, emoji: !!o.icon } : c;
  }),
  ...custom.map((c) => ({ ...c, colorKey: 'textSecondary', isCustom: true, emoji: true })),
];
