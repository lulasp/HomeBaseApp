// Built-in finance categories, shared by the Finances screen and the
// statement importer. Custom categories live per-household in Firestore
// (billCustomCategories / expenseCustomCategories) and are merged in at runtime.

export const BILL_CATS = [
  { key: 'rent',          label: 'Rent',        icon: 'home',             colorKey: 'accent'        },
  { key: 'electricity',   label: 'Electricity', icon: 'flash',            colorKey: 'amber'         },
  { key: 'water',         label: 'Water',       icon: 'water',            colorKey: 'accent'        },
  { key: 'gas',           label: 'Gas',         icon: 'flame',            colorKey: 'amber'         },
  { key: 'internet',      label: 'Internet',    icon: 'wifi',             colorKey: 'sage'          },
  { key: 'phone',         label: 'Phone',       icon: 'phone-portrait',   colorKey: 'accent'        },
  { key: 'insurance',     label: 'Insurance',   icon: 'shield-checkmark', colorKey: 'sage'          },
  { key: 'subscriptions', label: 'Subs',        icon: 'repeat',           colorKey: 'accent'        },
  { key: 'other',         label: 'Other',       icon: 'receipt',          colorKey: 'textSecondary' },
];

export const EXPENSE_CATS = [
  { key: 'groceries',  label: 'Groceries',  icon: 'cart',     colorKey: 'sage'          },
  { key: 'repairs',    label: 'Repairs',    icon: 'build',    colorKey: 'amber'         },
  { key: 'cleaning',   label: 'Cleaning',   icon: 'sparkles', colorKey: 'accent'        },
  { key: 'furniture',  label: 'Furniture',  icon: 'bed',      colorKey: 'accent'        },
  { key: 'appliances', label: 'Appliances', icon: 'tv',       colorKey: 'accent'        },
  { key: 'utilities',  label: 'Utilities',  icon: 'bulb',     colorKey: 'amber'         },
  { key: 'other',      label: 'Other',      icon: 'cash',     colorKey: 'textSecondary' },
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
