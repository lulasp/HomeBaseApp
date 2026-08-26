// Pure helpers for the receipt importer. No side effects — unit-tested.
//
// The AI returns loosely-shaped line items; everything here turns them into
// something the review UI can render without guarding, and then into price
// entries that match what the rest of the tracker expects.

import {
  itemKeyOf, canonicalUnit, toCanonicalQuantity, normalizeStore, buildPriceEntry, todayKey,
} from './pricing';
import { NON_FOOD_CATEGORIES } from './categories';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Units we accept from the model; anything else falls back to a plain count so
// a hallucinated unit can't poison the per-unit comparison.
const ACCEPTED_UNITS = [
  'kg', 'g', 'mg', 'lb', 'oz',
  'L', 'ml', 'fl oz',
  'pcs', 'pack', 'bottle', 'can', 'box', 'bag', 'bunch',
];

const UNIT_ALIASES = {
  l: 'L', litre: 'L', liter: 'L', litres: 'L', liters: 'L',
  ml: 'ml', millilitre: 'ml', milliliter: 'ml',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  g: 'g', gram: 'g', grams: 'g', gr: 'g',
  ea: 'pcs', each: 'pcs', unit: 'pcs', units: 'pcs', item: 'pcs', items: 'pcs',
  piece: 'pcs', pieces: 'pcs', pc: 'pcs', pcs: 'pcs',
  packet: 'pack', pkt: 'pack', pack: 'pack',
};

// Map a model-supplied unit onto one the app knows, defaulting to 'pcs'.
export function normalizeUnit(raw) {
  const key = String(raw ?? '').trim().toLowerCase();
  if (!key) return 'pcs';
  const exact = ACCEPTED_UNITS.find((u) => u.toLowerCase() === key);
  if (exact) return exact;
  return UNIT_ALIASES[key] ?? 'pcs';
}

// The article/SKU code, reduced to the characters that stay stable between
// visits. Codes shorter than this are counter keys ("3" for loose bananas),
// not product identifiers, and would collide across half the shop.
const MIN_CODE_LENGTH = 4;

export function normalizeCode(raw) {
  const code = String(raw ?? '').replace(/[^a-zA-Z0-9]/g, '');
  return code.length >= MIN_CODE_LENGTH ? code.toUpperCase() : '';
}

// Normalise one AI-parsed receipt line into a safe, predictable shape.
// Returns null for lines with no usable name or price — the model is told to
// skip totals and discounts, but this is the guard that actually enforces it.
//
// `rawName`/`rawKey` are what the receipt actually printed, kept apart from the
// editable `name` because that printed text is the only identifier stable
// enough to recognise the same product on a future receipt. `name` is the
// model's tidy-up and the user is free to rewrite it; the raw text must survive
// that untouched.
export function normalizeReceiptLine(line) {
  const name = String(line?.name ?? '').replace(/\s+/g, ' ').trim();
  const rawName = String(line?.rawName ?? '').replace(/\s+/g, ' ').trim() || name;
  if (!name && !rawName) return null;

  const price = Number(line?.price);
  if (!Number.isFinite(price) || price <= 0) return null;

  const rawQty = Number(line?.quantity);
  const quantity = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;

  return {
    name: name || rawName,
    rawName,
    rawKey: itemKeyOf(rawName),
    code: normalizeCode(line?.code),
    price,
    quantity,
    unit: normalizeUnit(line?.unit),
    itemKey: itemKeyOf(name || rawName),
  };
}

// Normalise a whole parsed receipt, dropping unusable lines.
export function normalizeReceipt(parsed) {
  const lines = Array.isArray(parsed?.lines) ? parsed.lines : [];
  return {
    store: normalizeStore(parsed?.store),
    date:  ISO_DATE.test(parsed?.date) ? parsed.date : '',
    lines: lines.map(normalizeReceiptLine).filter(Boolean),
  };
}

// Express `quantity` of `fromUnit` in `toUnit`. Only defined inside one unit
// family — you can turn 500 g into 0.5 kg, but never 2 pcs into grams.
export function convertQuantity(quantity, fromUnit, toUnit) {
  if (canonicalUnit(fromUnit) !== canonicalUnit(toUnit)) return null;
  const amount = toCanonicalQuantity(quantity, fromUnit);
  const perOne = toCanonicalQuantity(1, toUnit);
  if (amount === null || perOne === null) return null;
  return amount / perOne;
}

// Pantry quantities are stored as strings (see PantryScreen), rounded here so
// floating-point conversion doesn't leave "1.2000000000000002" in the doc.
const quantityString = (n) => String(Math.round(n * 1000) / 1000);

// Tag each line with the tracked item it belongs to, if any. `history` is the
// output of buildPriceHistory. Matching is by normalized key, so "TOMATOES"
// lands on an existing "Tomato" history.
//
// A matched line also inherits the tracked item's category — the receipt never
// says which aisle something belongs to.
//
// `pantryItems` lets a line also point at what's already in the pantry, so the
// review UI can offer to top that item up instead of creating a second row.
// `nonFoodCategories` are the labels that default to *not* being stocked —
// washing-up liquid is worth a price entry but doesn't belong in the pantry.
export function matchReceiptLines(lines, history = [], {
  pantryItems = [],
  nonFoodCategories = NON_FOOD_CATEGORIES.map((c) => c.label),
} = {}) {
  const byKey = new Map(history.map((item) => [item.itemKey, item]));
  const nonFood = new Set(nonFoodCategories);

  return lines.map((line) => {
    const match = byKey.get(line.itemKey) ?? null;
    // An alias can point at an item that has no price history yet (added to the
    // pantry but never priced), so it carries the category too.
    const category = match?.category ?? line.aliasCategory ?? 'Other';

    return {
      ...line,
      matchedItem: match ? { itemKey: match.itemKey, itemName: match.itemName } : null,
      category,
      // Flag a unit family change against the item's history — it's legitimate
      // (a different pack size) but it takes the entry out of the comparison,
      // so the review UI should say so rather than hide it.
      unitMismatch: !!match && canonicalUnit(line.unit) !== match.canonicalUnit,
      lastPrice:    match?.latest?.price ?? null,
      include:      true,
      // Pantry side of the import — independent of `include` so a price can be
      // logged without stocking anything, and vice versa.
      toPantry:     !nonFood.has(category),
      pantryMatch:  findPantryMatch(line, pantryItems),
      expiryDate:   '',
    };
  });
}

// The pantry row a line should top up: same normalized name, and a unit in the
// same family so the quantities can actually be added together. Re-run this
// whenever the user edits a line's name or unit in review, otherwise the match
// made at parse time silently goes stale.
export function findPantryMatch(line, pantryItems = []) {
  const key = itemKeyOf(line?.name);
  if (!key) return null;
  const hit = pantryItems.find(
    (item) => itemKeyOf(item?.name) === key
      && canonicalUnit(item?.unit) === canonicalUnit(line?.unit),
  );
  return hit
    ? { id: hit.id, name: hit.name, quantity: hit.quantity, unit: hit.unit }
    : null;
}

// Sum of the lines a user has left selected — shown against the receipt total
// so an obviously wrong parse is visible before anything is written.
export function selectedTotal(lines = []) {
  return lines
    .filter((l) => l.include)
    .reduce((sum, l) => sum + (Number(l.price) || 0), 0);
}

// Convert reviewed lines into price-entry docs ready for a batch write.
// Lines that were deselected, or that can't produce a valid entry, are dropped.
export function toPriceEntryDocs(lines, { store, date, addedBy } = {}) {
  return lines
    .filter((line) => line.include)
    .map((line) => buildPriceEntry({
      name:        line.matchedItem?.itemName || line.name,
      price:       line.price,
      quantity:    line.quantity,
      unit:        line.unit,
      category:    line.category || 'Other',
      store,
      purchasedAt: ISO_DATE.test(date) ? date : todayKey(),
      addedBy,
    }))
    .filter(Boolean);
}

// Convert reviewed lines into the pantry writes they imply, split into updates
// of existing rows and brand-new ones.
//
// Both sides are coalesced by target, because a receipt routinely lists the
// same product twice: two "MILK 1L" lines must become one +2 top-up, not two
// writes to the same doc where the second silently overwrites the first.
//
// Returns { merges: [{ id, quantity, expiryDate? }], creates: [pantry doc] }.
// Quantities are strings — that is how PantryScreen stores and edits them.
export function toPantryOps(lines, { addedBy = null } = {}) {
  const merges  = new Map();   // pantry doc id  → op
  const creates = new Map();   // itemKey|unit   → op

  for (const line of lines ?? []) {
    if (!line?.include || !line?.toPantry) continue;

    const rawQty = Number(line.quantity);
    const quantity = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;
    const expiry = ISO_DATE.test(line.expiryDate) ? line.expiryDate : null;

    const match = line.pantryMatch;
    const topUp = match ? convertQuantity(quantity, line.unit, match.unit) : null;

    if (match && topUp !== null) {
      const existing = merges.get(match.id);
      if (existing) {
        existing.amount += topUp;
        // Keep the soonest expiry — that's the one worth being warned about.
        if (expiry && (!existing.expiryDate || expiry < existing.expiryDate)) {
          existing.expiryDate = expiry;
        }
      } else {
        const onHand = Number.parseFloat(match.quantity);
        merges.set(match.id, {
          id: match.id,
          amount: (Number.isFinite(onHand) ? onHand : 0) + topUp,
          expiryDate: expiry,
        });
      }
      continue;
    }

    const name = line.matchedItem?.itemName || line.name;
    const key  = `${itemKeyOf(name)}|${line.unit}`;
    const existing = creates.get(key);
    if (existing) {
      existing.amount += quantity;
      if (expiry && (!existing.expiryDate || expiry < existing.expiryDate)) {
        existing.expiryDate = expiry;
      }
    } else {
      creates.set(key, {
        name,
        amount:     quantity,
        unit:       line.unit,
        category:   line.category || 'Other',
        expiryDate: expiry,
        addedBy,
      });
    }
  }

  return {
    merges: [...merges.values()].map(({ id, amount, expiryDate }) => ({
      id,
      quantity: quantityString(amount),
      // Only carry an expiry when the receipt review set one — otherwise leave
      // whatever the pantry item already had alone.
      ...(expiryDate ? { expiryDate } : {}),
    })),
    creates: [...creates.values()].map(({ amount, ...rest }) => ({
      ...rest,
      quantity: quantityString(amount),
    })),
  };
}
