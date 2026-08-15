// Pure helpers for the receipt importer. No side effects — unit-tested.
//
// The AI returns loosely-shaped line items; everything here turns them into
// something the review UI can render without guarding, and then into price
// entries that match what the rest of the tracker expects.

import {
  itemKeyOf, canonicalUnit, normalizeStore, buildPriceEntry, todayKey,
} from './pricing';

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

// Normalise one AI-parsed receipt line into a safe, predictable shape.
// Returns null for lines with no usable name or price — the model is told to
// skip totals and discounts, but this is the guard that actually enforces it.
export function normalizeReceiptLine(line) {
  const name = String(line?.name ?? '').replace(/\s+/g, ' ').trim();
  if (!name) return null;

  const price = Number(line?.price);
  if (!Number.isFinite(price) || price <= 0) return null;

  const rawQty = Number(line?.quantity);
  const quantity = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;

  return {
    name,
    price,
    quantity,
    unit: normalizeUnit(line?.unit),
    itemKey: itemKeyOf(name),
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

// Tag each line with the tracked item it belongs to, if any. `history` is the
// output of buildPriceHistory. Matching is by normalized key, so "TOMATOES"
// lands on an existing "Tomato" history.
//
// A matched line also inherits the tracked item's category — the receipt never
// says which aisle something belongs to.
export function matchReceiptLines(lines, history = []) {
  const byKey = new Map(history.map((item) => [item.itemKey, item]));
  return lines.map((line) => {
    const match = byKey.get(line.itemKey) ?? null;
    return {
      ...line,
      matchedItem: match ? { itemKey: match.itemKey, itemName: match.itemName } : null,
      category:    match?.category ?? 'Other',
      // Flag a unit family change against the item's history — it's legitimate
      // (a different pack size) but it takes the entry out of the comparison,
      // so the review UI should say so rather than hide it.
      unitMismatch: !!match && canonicalUnit(line.unit) !== match.canonicalUnit,
      lastPrice:    match?.latest?.price ?? null,
      include:      true,
    };
  });
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
