// Grocery price tracking — pure helpers.
//
// A price entry records what was paid for a grocery item at a point in time.
// To compare "1 L milk for 1.49" against "500 ml milk for 0.85" fairly, every
// entry is reduced to a *unit price* in a canonical unit (kg / L / pcs).

// unit → [canonical unit, multiplier to reach it]
const UNIT_CONVERSIONS = {
  // mass → kg
  mg: ['kg', 1e-6], g: ['kg', 1e-3], kg: ['kg', 1],
  oz: ['kg', 0.0283495], lb: ['kg', 0.453592],
  // volume → L
  ml: ['L', 1e-3], l: ['L', 1], 'fl oz': ['L', 0.0295735],
  tsp: ['L', 0.00492892], tbsp: ['L', 0.0147868], cup: ['L', 0.24],
  // count → pcs
  pcs: ['pcs', 1], pack: ['pcs', 1], can: ['pcs', 1], bottle: ['pcs', 1],
  box: ['pcs', 1], bag: ['pcs', 1], bunch: ['pcs', 1],
  slice: ['pcs', 1], clove: ['pcs', 1],
};

// Below these quantities a unit price becomes meaningless noise (e.g. a whole
// spice jar logged as "1 tsp" would imply an absurd per-litre price), so we
// still compute it but callers can rely on the value being finite, never NaN.
const MIN_QUANTITY = 1e-9;

// Custom household units are unknown here — they become their own family so
// they only ever compare against themselves.
export const canonicalUnit = (unit) => {
  const key = String(unit || '').trim().toLowerCase();
  if (!key) return 'pcs';
  return UNIT_CONVERSIONS[key]?.[0] ?? key;
};

// Convert a quantity into the canonical unit of its family.
export const toCanonicalQuantity = (quantity, unit) => {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const key = String(unit || '').trim().toLowerCase();
  const factor = UNIT_CONVERSIONS[key]?.[1] ?? 1;
  const converted = qty * factor;
  return converted < MIN_QUANTITY ? null : converted;
};

// Price per canonical unit. Null when the inputs can't produce a real number —
// callers fall back to comparing total price.
export const unitPriceOf = ({ price, quantity, unit }) => {
  const total = Number(price);
  if (!Number.isFinite(total) || total < 0) return null;
  const qty = toCanonicalQuantity(quantity, unit);
  if (qty === null) return null;
  return total / qty;
};

// ── Item identity ────────────────────────────────────────
// Grocery item names are free text, so history is grouped by a normalized key:
// case-folded, accent-stripped, punctuation-free, loosely singularized. This
// makes "Tomatoes", "tomato" and "Tomate" (sans accent) share one history.
const SINGULAR_RULES = [
  [/ies$/, 'y'],
  [/(o|s|x|z|ch|sh)es$/, '$1'],
  [/([^s])s$/, '$1'],
];

export const itemKeyOf = (name) => {
  const base = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return '';
  const words = base.split(' ');
  const last = words[words.length - 1];
  // Words this short, or ending in "ss"/"us"/"is", aren't safely singularized.
  if (last.length > 3 && !/(ss|us|is)$/.test(last)) {
    for (const [pattern, replacement] of SINGULAR_RULES) {
      if (pattern.test(last)) {
        words[words.length - 1] = last.replace(pattern, replacement);
        break;
      }
    }
  }
  return words.join(' ');
};

export const normalizeStore = (store) => String(store || '').trim();
const storeKey = (store) => normalizeStore(store).toLowerCase();

// ── Entry shaping ────────────────────────────────────────

// The fields of an entry that an edit may change, with unitPrice and
// canonicalUnit re-derived so a corrected entry compares exactly like a fresh
// one. Returns null if the price isn't a usable positive number.
//
// Item identity (itemKey/itemName/category) is deliberately absent: it belongs
// to the item, not to a single purchase, so editing one entry can never split
// an item's history in two.
export const buildPriceEntryPatch = ({ price, quantity, unit, store, purchasedAt }) => {
  const total = Number(price);
  if (!Number.isFinite(total) || total <= 0) return null;
  const qty = Number(quantity);
  return {
    store:         normalizeStore(store) || null,
    price:         total,
    quantity:      Number.isFinite(qty) && qty > 0 ? qty : 1,
    unit:          unit || 'pcs',
    canonicalUnit: canonicalUnit(unit),
    unitPrice:     unitPriceOf({ price: total, quantity, unit }) ?? total,
    purchasedAt:   purchasedAt || todayKey(),
  };
};

// Build the Firestore document for a new price entry from raw form input.
// Returns null if the price isn't usable or the name normalizes to nothing.
export const buildPriceEntry = ({
  name, price, quantity, unit, category, store, purchasedAt, addedBy,
}) => {
  const key = itemKeyOf(name);
  if (!key) return null;
  const patch = buildPriceEntryPatch({ price, quantity, unit, store, purchasedAt });
  if (!patch) return null;
  return {
    itemKey:  key,
    itemName: String(name).trim(),
    category: category || 'Other',
    ...patch,
    addedBy:  addedBy || null,
  };
};

// Local calendar date as YYYY-MM-DD — entries sort and group by day, and a
// plain string keeps that stable across timezones and Firestore round-trips.
export const todayKey = (date = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// Oldest first. Entries logged on the same day fall back to createdAt so the
// "latest" is the one most recently written.
const millisOf = (entry) => {
  const ts = entry?.createdAt;
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  const parsed = Date.parse(ts);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const sortEntries = (entries) =>
  [...entries].sort((a, b) => {
    const byDate = String(a.purchasedAt || '').localeCompare(String(b.purchasedAt || ''));
    return byDate !== 0 ? byDate : millisOf(a) - millisOf(b);
  });

// ── Trend ────────────────────────────────────────────────

// Relative moves smaller than this are noise (rounding, a cent of shrinkflation)
// and report as "same" rather than a misleading arrow.
export const TREND_EPSILON = 0.005;   // 0.5 %

// Compare the newest entry against the most recent earlier entry *in the same
// canonical unit* — comparing a per-kg price to a per-piece price is meaningless.
// `entries` must be oldest-first.
export const computeTrend = (entries) => {
  if (!entries.length) return { direction: 'none', pct: 0, abs: 0, latest: null, previous: null };
  const latest = entries[entries.length - 1];
  const previous = [...entries.slice(0, -1)]
    .reverse()
    .find((e) => e.canonicalUnit === latest.canonicalUnit) ?? null;

  if (!previous) return { direction: 'new', pct: 0, abs: 0, latest, previous: null };

  const current = Number(latest.unitPrice);
  const before  = Number(previous.unitPrice);
  if (!Number.isFinite(current) || !Number.isFinite(before) || before <= 0) {
    return { direction: 'new', pct: 0, abs: 0, latest, previous };
  }

  const abs = current - before;
  const pct = abs / before;
  const direction = Math.abs(pct) < TREND_EPSILON ? 'same' : (pct > 0 ? 'up' : 'down');
  return { direction, pct, abs, latest, previous };
};

// ── Aggregation ──────────────────────────────────────────

// Group raw price entries into one summary per tracked item.
// Returns items sorted by most recently purchased first.
export const buildPriceHistory = (rawEntries = []) => {
  const groups = new Map();
  for (const entry of rawEntries) {
    const key = entry.itemKey || itemKeyOf(entry.itemName);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  const items = [];
  for (const [key, group] of groups) {
    const entries = sortEntries(group);
    const latest  = entries[entries.length - 1];
    // Only entries sharing the newest canonical unit are comparable, so stats
    // (low/high/average) are scoped to that unit.
    const comparable = entries.filter((e) => e.canonicalUnit === latest.canonicalUnit);
    const prices = comparable.map((e) => Number(e.unitPrice)).filter(Number.isFinite);

    items.push({
      itemKey:       key,
      itemName:      latest.itemName || key,
      category:      latest.category || 'Other',
      canonicalUnit: latest.canonicalUnit,
      entries,
      comparable,
      latest,
      count:   entries.length,
      trend:   computeTrend(entries),
      low:     prices.length ? Math.min(...prices) : null,
      high:    prices.length ? Math.max(...prices) : null,
      average: prices.length ? prices.reduce((s, p) => s + p, 0) / prices.length : null,
      stores:  summarizeStores(comparable),
    });
  }

  return items.sort((a, b) =>
    String(b.latest.purchasedAt || '').localeCompare(String(a.latest.purchasedAt || '')));
};

// Per-store stats for one item, cheapest average first. Entries without a store
// are grouped under a null store so they still count toward the history.
export const summarizeStores = (entries = []) => {
  const byStore = new Map();
  for (const entry of entries) {
    const key = storeKey(entry.store);
    if (!byStore.has(key)) {
      byStore.set(key, { store: normalizeStore(entry.store) || null, prices: [], latest: entry });
    }
    const bucket = byStore.get(key);
    const price = Number(entry.unitPrice);
    if (Number.isFinite(price)) bucket.prices.push(price);
    bucket.latest = entry;   // entries arrive oldest-first, so the last wins
  }

  return [...byStore.values()]
    .map(({ store, prices, latest }) => ({
      store,
      count:   prices.length,
      average: prices.length ? prices.reduce((s, p) => s + p, 0) / prices.length : null,
      low:     prices.length ? Math.min(...prices) : null,
      latest,
    }))
    .filter((s) => s.count > 0)
    .sort((a, b) => a.average - b.average);
};

// Distinct store names across all entries, most recently used first —
// powers the store suggestions on the check-off prompt.
export const recentStores = (rawEntries = [], limit = 8) => {
  const seen = new Map();
  for (const entry of sortEntries(rawEntries)) {
    const store = normalizeStore(entry.store);
    if (!store) continue;
    // Re-inserting an existing key keeps its original position in a Map, so
    // delete first — insertion order must track *most recent* use.
    const key = store.toLowerCase();
    seen.delete(key);
    seen.set(key, store);
  }
  return [...seen.values()].reverse().slice(0, limit);
};

// The most recent entry for a given item name, or null. Used to show
// "last paid" next to a grocery item before it's checked off.
export const lastEntryFor = (rawEntries = [], name) => {
  const key = itemKeyOf(name);
  if (!key) return null;
  const matches = rawEntries.filter((e) => (e.itemKey || itemKeyOf(e.itemName)) === key);
  if (!matches.length) return null;
  return sortEntries(matches)[matches.length - 1];
};

// ── Basket estimation ────────────────────────────────────

// What a grocery-list item is expected to cost, from the last price paid for it.
// Scales by quantity when the units are comparable; otherwise falls back to the
// last total paid (better than nothing, and flagged as `exact: false`).
const estimateFromLast = (groceryItem, last) => {
  if (!last) return null;

  const wantUnit = canonicalUnit(groceryItem?.unit);
  const qty = toCanonicalQuantity(groceryItem?.quantity, groceryItem?.unit);
  const unitPrice = Number(last.unitPrice);

  if (wantUnit === last.canonicalUnit && qty !== null && Number.isFinite(unitPrice)) {
    return { cost: unitPrice * qty, basedOn: last, scaled: true };
  }
  // Different unit family (or an unusable quantity) — the per-unit price can't
  // be applied, so quote the last total instead.
  return { cost: Number(last.price) || 0, basedOn: last, scaled: false };
};

export const estimateItemCost = (groceryItem, rawEntries = []) =>
  estimateFromLast(groceryItem, lastEntryFor(rawEntries, groceryItem?.name));

// itemKey → that item's entries, oldest first. Built once per basket pass so a
// long list doesn't rescan the whole history for every line.
const indexByItemKey = (rawEntries) => {
  const map = new Map();
  for (const entry of rawEntries) {
    const key = entry.itemKey || itemKeyOf(entry.itemName);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  }
  for (const [key, list] of map) map.set(key, sortEntries(list));
  return map;
};

// Cost picture for a shopping trip.
//
// `actual` counts price entries logged against the items already ticked off
// (linked by groceryItemId at check-off). `remaining` estimates what's still in
// the trolley from price history. `projected` is what the till is likely to say.
export const summarizeBasket = (groceryItems = [], rawEntries = []) => {
  // Entries logged from a check-off carry the grocery item they came from, so a
  // trip's real spend is exact rather than inferred from dates.
  const byGroceryItem = new Map();
  for (const entry of sortEntries(rawEntries)) {
    if (entry.groceryItemId) byGroceryItem.set(entry.groceryItemId, entry);
  }
  const byItemKey = indexByItemKey(rawEntries);

  let actual = 0;
  let remaining = 0;
  let pricedCount = 0;
  let unpricedCount = 0;
  let loggedCount = 0;

  for (const item of groceryItems) {
    const logged = byGroceryItem.get(item.id);
    if (item.checked && logged) {
      actual += Number(logged.price) || 0;
      loggedCount += 1;
      pricedCount += 1;
      continue;
    }
    // Checked items with no logged price contribute their estimate too, so the
    // projected total doesn't silently drop them.
    const forItem = byItemKey.get(itemKeyOf(item.name));
    const estimate = estimateFromLast(item, forItem?.[forItem.length - 1]);
    if (estimate) {
      remaining += estimate.cost;
      pricedCount += 1;
    } else {
      unpricedCount += 1;
    }
  }

  return {
    actual,
    remaining,
    projected: actual + remaining,
    loggedCount,
    pricedCount,
    unpricedCount,
    total: groceryItems.length,
  };
};

// ── Store comparison ─────────────────────────────────────

// Typical amount bought of an item, in its canonical unit — used to weight the
// comparison basket so bulk staples count for more than a single herb pot.
const basketWeight = (entries) => {
  const latest = entries[entries.length - 1];
  const qty = toCanonicalQuantity(latest?.quantity, latest?.unit);
  return qty ?? 1;
};

// "Where should I shop." Ranks stores by what the same basket costs at each.
//
// Only items priced at *every* compared store are included: summing a store's
// total over items it has no price for would invent savings that don't exist.
// The caller is expected to surface `common.length` so the number is honest.
export const buildStoreComparison = (rawEntries = [], { maxStores = 4, minItems = 2 } = {}) => {
  const named = rawEntries.filter((e) => normalizeStore(e.store));
  const history = buildPriceHistory(named);

  // Candidate stores, most-covered first — comparing every store at once would
  // shrink the common set to nothing.
  const coverage = new Map();
  for (const item of history) {
    for (const s of item.stores) {
      if (!s.store) continue;
      coverage.set(s.store, (coverage.get(s.store) || 0) + 1);
    }
  }
  const stores = [...coverage.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxStores)
    .map(([store, itemCount]) => ({ store, itemCount }));

  const storeNames = stores.map((s) => s.store);

  // Items with a price at every candidate store, compared per canonical unit.
  const common = [];
  for (const item of history) {
    const priceAt = new Map(
      item.stores.filter((s) => s.store).map((s) => [s.store, s.average]),
    );
    if (!storeNames.every((name) => Number.isFinite(priceAt.get(name)))) continue;

    const prices = {};
    storeNames.forEach((name) => { prices[name] = priceAt.get(name); });
    const cheapest = storeNames.reduce((a, b) => (prices[a] <= prices[b] ? a : b));
    common.push({
      itemKey:       item.itemKey,
      itemName:      item.itemName,
      canonicalUnit: item.canonicalUnit,
      weight:        basketWeight(item.comparable),
      prices,
      cheapest,
    });
  }

  if (stores.length < 2 || common.length < minItems) {
    return { stores, common: [], totals: [], best: null, comparable: false };
  }

  const totals = storeNames.map((store) => ({
    store,
    total: common.reduce((sum, item) => sum + item.prices[store] * item.weight, 0),
    cheapestCount: common.filter((item) => item.cheapest === store).length,
  })).sort((a, b) => a.total - b.total);

  const [cheapest, next] = totals;
  const saving = next ? next.total - cheapest.total : 0;
  const best = {
    store:     cheapest.store,
    total:     cheapest.total,
    saving,
    savingPct: next && next.total > 0 ? saving / next.total : 0,
    versus:    next?.store ?? null,
  };

  return { stores, common, totals, best, comparable: true };
};

// ── Formatting ───────────────────────────────────────────

export const formatPrice = (n, { decimals = 2 } = {}) =>
  `$${Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  })}`;

// Unit prices are often fractions of a cent (per gram, per ml); show enough
// precision to be meaningful without printing noise.
export const formatUnitPrice = (n, unit) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const decimals = v < 0.1 ? 3 : 2;
  return `${formatPrice(v, { decimals })}/${unit || 'pcs'}`;
};

export const formatPercent = (pct) => {
  const v = Math.abs(Number(pct) || 0) * 100;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;
};

// Trend → the presentation a screen should use. Colour keys are theme tokens,
// resolved against the active palette by the caller.
export const trendPresentation = (direction) => {
  switch (direction) {
    case 'up':   return { icon: 'trending-up',    colorKey: 'danger',        label: 'More expensive' };
    case 'down': return { icon: 'trending-down',  colorKey: 'success',       label: 'Cheaper' };
    case 'same': return { icon: 'remove-outline', colorKey: 'textSecondary', label: 'Unchanged' };
    default:     return { icon: 'sparkles-outline', colorKey: 'accent',      label: 'First price' };
  }
};
