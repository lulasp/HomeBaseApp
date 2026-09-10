// Learned mappings from what a receipt *prints* to what the item actually is.
// No side effects — unit-tested.
//
// Why this exists: a receipt line is often not a product name. Portuguese
// supermarkets in particular print a department heading — "DETERG. E PROD
// LIMPEZA" — where the product should be. Deriving identity from that text
// gives two bad outcomes at once:
//
//   * collision   — Finish tablets, bleach and floor cleaner all land in one
//                   history, which then reports nonsense price trends;
//   * fragmentation — the shopper renames the line to "Pastilhas Finish", the
//                   correction is thrown away, and the next receipt prints the
//                   heading again and starts a second history.
//
// So identity is pinned to the printed text (or better, the article code) and
// the mapping to a real item is *remembered*, not re-derived each time.

import { itemKeyOf, normalizeStore } from './pricing';

export const CODE_PREFIX = 'c:';
export const RAW_PREFIX  = 'r:';

// A price this far from what the item last cost is probably a different
// product hiding behind the same department heading.
const PRICE_TOLERANCE = 0.2;   // ±20 %

const storeKeyOf = (store) => normalizeStore(store).toLowerCase();

// Firestore document ids may not contain "/"; everything else here is already
// restricted to letters, digits and spaces by itemKeyOf/normalizeCode.
const idSafe = (s) => String(s).replace(/\s+/g, '-').replace(/\//g, '_');

const millisOf = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// The keys a line can be recognised by, most trustworthy first. An article code
// is stable across visits and immune to the department-heading problem, so it
// always wins over the printed text.
export function lookupKeysFor(line) {
  const keys = [];
  if (line?.code)   keys.push(`${CODE_PREFIX}${line.code}`);
  if (line?.rawKey) keys.push(`${RAW_PREFIX}${line.rawKey}`);
  return keys;
}

export function aliasDocId(lookupKey, itemKey, store) {
  return idSafe(`${lookupKey}__${itemKey}__${storeKeyOf(store)}`);
}

// Group raw alias docs into lookupKey → targets. One doc is written per
// (lookupKey, itemKey, store) so that writes stay plain merging upserts; the
// per-store rows are folded back together here.
export function buildAliasIndex(aliases = []) {
  const index = new Map();

  for (const alias of aliases) {
    if (!alias?.lookupKey || !alias?.itemKey) continue;

    if (!index.has(alias.lookupKey)) index.set(alias.lookupKey, new Map());
    const targets = index.get(alias.lookupKey);

    const at = millisOf(alias.updatedAt);
    const uses = Number(alias.uses) > 0 ? Number(alias.uses) : 1;
    const existing = targets.get(alias.itemKey);

    if (!existing) {
      targets.set(alias.itemKey, {
        itemKey:   alias.itemKey,
        itemName:  alias.itemName || alias.itemKey,
        category:  alias.category || null,
        lastPrice: Number.isFinite(Number(alias.lastPrice)) ? Number(alias.lastPrice) : null,
        stores:    new Set([storeKeyOf(alias.store)]),
        uses,
        at,
      });
      continue;
    }

    existing.uses += uses;
    existing.stores.add(storeKeyOf(alias.store));
    // The most recently written row wins on the fields that can drift.
    if (at >= existing.at) {
      existing.at        = at;
      existing.itemName  = alias.itemName || existing.itemName;
      existing.category  = alias.category ?? existing.category;
      const price = Number(alias.lastPrice);
      if (Number.isFinite(price)) existing.lastPrice = price;
    }
  }

  return index;
}

// Order candidates for a line: the store you're in, then a plausible price,
// then how often the mapping has been confirmed, then recency.
export function rankTargets(targets, { store = '', price = null } = {}) {
  const key = storeKeyOf(store);
  const paid = Number(price);

  const priceFits = (t) => {
    if (!Number.isFinite(paid) || paid <= 0 || !Number.isFinite(t.lastPrice) || t.lastPrice <= 0) {
      return 0;   // unknown, ranks between a fit and a clear mismatch
    }
    return Math.abs(t.lastPrice - paid) / t.lastPrice <= PRICE_TOLERANCE ? 1 : -1;
  };

  return [...targets].sort((a, b) => {
    const store_ = (b.stores.has(key) ? 1 : 0) - (a.stores.has(key) ? 1 : 0);
    if (store_) return store_;
    const price_ = priceFits(b) - priceFits(a);
    if (price_) return price_;
    if (b.uses !== a.uses) return b.uses - a.uses;
    return b.at - a.at;
  });
}

// What the alias table knows about one line.
//
// `target` is only set when there is exactly one candidate — a lookup key with
// several known meanings is precisely the department-heading case, and guessing
// there is how bleach ends up in the Finish history. Those come back as
// `options` for the review UI to offer instead.
export function resolveLine(line, index, { store = '' } = {}) {
  for (const lookupKey of lookupKeysFor(line)) {
    const targets = index?.get?.(lookupKey);
    if (!targets?.size) continue;
    const options = rankTargets(targets.values(), { store, price: line?.price });
    return { lookupKey, target: options.length === 1 ? options[0] : null, options };
  }
  return { lookupKey: null, target: null, options: [] };
}

// Rewrite lines with what the alias table already knows, before they are
// matched against price history. Unambiguous mappings are applied silently;
// ambiguous ones are left alone but carry their candidates for the review UI.
export function applyAliases(lines = [], index, { store = '' } = {}) {
  return lines.map((line) => {
    const { lookupKey, target, options } = resolveLine(line, index, { store });
    const next = {
      ...line,
      lookupKey,
      aliasOptions: options.map(({ itemKey, itemName, category, uses, lastPrice }) => ({
        itemKey, itemName, category, uses, lastPrice,
      })),
      aliasApplied: false,
    };
    if (target) {
      next.name          = target.itemName;
      next.itemKey       = target.itemKey;
      next.aliasCategory = target.category ?? null;
      next.aliasApplied  = true;
    }
    return next;
  });
}

// Bind a line to a specific item — the user picking a suggestion chip, or
// choosing a tracked item from the link picker.
export function bindLineToItem(line, { itemKey, itemName, category } = {}) {
  const key = itemKey || itemKeyOf(itemName);
  if (!key) return line;
  return {
    ...line,
    name:          itemName || line.name,
    itemKey:       key,
    aliasCategory: category ?? line.aliasCategory ?? null,
    aliasApplied:  true,
    category:      category || line.category,
    matchedItem:   { itemKey: key, itemName: itemName || line.name },
  };
}

// The alias rows an import should record, so the next receipt recognises these
// same printed lines on its own.
//
// Written for every line the user committed — whether the model got the name
// right or the user corrected it, the fact worth remembering is the same: this
// printed text meant this item. `uses` is returned as a count for the caller to
// apply as an increment, so confidence grows with each confirmed import.
export function aliasDocsFromLines(lines = [], { store = '' } = {}) {
  const docs = new Map();

  for (const line of lines) {
    if (!line?.include && !line?.toPantry) continue;

    const itemName = line.matchedItem?.itemName || line.name;
    const itemKey  = itemKeyOf(itemName);
    if (!itemKey) continue;

    for (const lookupKey of lookupKeysFor(line)) {
      const id = aliasDocId(lookupKey, itemKey, store);
      // Two receipt lines for the same product must not double-count as two
      // separate confirmations of the mapping.
      if (docs.has(id)) continue;
      docs.set(id, {
        id,
        lookupKey,
        rawText:   line.rawName || line.name,
        code:      line.code || '',
        itemKey,
        itemName,
        category:  line.category || null,
        store:     normalizeStore(store),
        lastPrice: Number(line.price) || null,
        uses:      1,
      });
    }
  }

  return [...docs.values()];
}
