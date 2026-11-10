import { t } from '../i18n';

export const PANTRY_CATEGORIES = [
  { label: 'Grains & Pasta', icon: '🌾' },
  { label: 'Canned Goods', icon: '🥫' },
  { label: 'Oils & Sauces', icon: '🫙' },
  { label: 'Spices', icon: '🧂' },
  { label: 'Nuts & Dried Fruit', icon: '🥜' },
  { label: 'Baking', icon: '🧁' },
  { label: 'Snacks', icon: '🍿' },
  { label: 'Beverages', icon: '☕' },
  { label: 'Refrigerated', icon: '🧀' },
  { label: 'Frozen', icon: '🧊' },
  { label: 'Other', icon: '📦' },
];

export const NON_FOOD_CATEGORIES = [
  { label: 'Cleaning Supplies', icon: '🧹' },
  { label: 'Bathroom & Personal', icon: '🪥' },
  { label: 'Laundry', icon: '🧺' },
  { label: 'Paper & Disposables', icon: '🧻' },
  { label: 'Pet Supplies', icon: '🐾' },
  { label: 'Office & Stationery', icon: '📎' },
  { label: 'Other Non-Food', icon: '🛒' },
];

// Fallbacks the app writes by name (new items, receipt import, price tracker):
// their icon can be edited, never their label.
export const LOCKED_CATEGORY_LABELS = ['Other', 'Other Non-Food'];

// Apply a household's edits to built-in categories. Overrides are keyed by the
// built-in's original label ({ [label]: { label?, icon? } }); `baseLabel` keeps
// that id so an edited built-in can still be told apart from a custom one.
export const withOverrides = (builtIn, overrides) =>
  builtIn.map((c) => ({ ...c, ...overrides?.[c.label], baseLabel: c.label }));

// Override entry for a built-in edited to { label, icon }: only the fields that
// differ from the code default, or null when none do.
export const overrideFor = (builtIn, { label, icon }) => {
  const o = {};
  if (label !== builtIn.label) o.label = label;
  if (icon !== builtIn.icon) o.icon = icon;
  return Object.keys(o).length ? o : null;
};

// Fold a rename into a pending list, collapsing chains (A→B, B→C ⇒ A→C) and
// dropping round trips (A→B, B→A).
export const addRename = (renames, from, to) => {
  if (from === to) return renames;
  const chained = renames.find((r) => r.to === from);
  const next = chained
    ? renames.map((r) => (r === chained ? { ...r, to } : r))
    : [...renames, { from, to }];
  return next.filter((r) => r.from !== r.to);
};

// Swap one label for another in a label list (enabled / order).
export const renameInList = (list, from, to) => list?.map((l) => (l === from ? to : l)) ?? list;

export const UNITS = [
  // count
  'pcs', 'pack', 'can', 'bottle', 'box', 'bag', 'bunch', 'slice', 'clove',
  // weight
  'g', 'kg', 'mg', 'oz', 'lb',
  // volume
  'ml', 'L', 'tsp', 'tbsp', 'cup', 'fl oz',
];

export const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
export const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Display names. Built-in categories and units are stored by their English name
// (items, orders and renames all key on it), so translate only when showing
// them; a household's own or renamed labels are shown as typed.
const lookupName = (group, value) => {
  if (!value) return value;
  const key = `${group}.${value}`;
  const text = t(key);
  return text === key ? value : text;
};
export const categoryName = (label) => lookupName('categories', label);
export const unitName = (unit) => lookupName('units', unit);
