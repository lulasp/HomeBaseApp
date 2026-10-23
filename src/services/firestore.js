import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  setDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  deleteField,
  writeBatch,
  increment,
} from 'firebase/firestore';

import { db } from '../config/firebase';
import { weightLogId } from '../utils/bodyMetrics';

// ── Households ───────────────────────────────────────────
const sanitizeProfile = ({ name, email } = {}) => ({
  name:  (name  || '').trim(),
  email: (email || '').trim(),
});

// Sensitive per-household data (integration secrets + member emails) lives in a
// members-only subcollection doc, NOT the parent household doc — the parent is
// world-readable to any authenticated user so join-by-invite-code can query it.
const privateRef = (householdId) => doc(db, 'households', householdId, 'private', 'data');

// Invite codes: 6 random chars, uppercase alphanumeric.
const INVITE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const genInviteCode = () => {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => INVITE_CHARS[b % INVITE_CHARS.length]).join('');
};

export const createHousehold = async (uid, name, profile = {}) => {
  const inviteCode = genInviteCode();
  const ref = await addDoc(collection(db, 'households'), {
    name,
    members: [uid],
    inviteCode,
    createdBy: uid,
    createdAt: serverTimestamp(),
  });
  await setDoc(privateRef(ref.id), { memberProfiles: { [uid]: sanitizeProfile(profile) } });
  return ref.id;
};

export const joinHousehold = async (uid, inviteCode, profile = {}) => {
  const q = query(collection(db, 'households'), where('inviteCode', '==', inviteCode.toUpperCase()));
  const snap = await getDocs(q);
  if (snap.empty) throw new Error('Invalid invite code.');
  const householdDoc = snap.docs[0];
  const members = householdDoc.data().members || [];
  if (!members.includes(uid)) {
    await updateDoc(doc(db, 'households', householdDoc.id), {
      members: [...members, uid],
    });
  }
  // Second write (now a member) records the joiner's name/email in the private doc.
  await setDoc(privateRef(householdDoc.id),
    { memberProfiles: { [uid]: sanitizeProfile(profile) } }, { merge: true });
  return householdDoc.id;
};

// Store/refresh a member's display name + email so member lists show real
// identities instead of raw UIDs. Caller must already be a household member.
export const upsertMemberProfile = (householdId, uid, profile) =>
  setDoc(privateRef(householdId),
    { memberProfiles: { [uid]: sanitizeProfile(profile) } }, { merge: true });

export const getHousehold = async (householdId) => {
  const snap = await getDoc(doc(db, 'households', householdId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

// Members-only private data (secrets + member profiles). Empty object if none.
export const getHouseholdPrivate = async (householdId) => {
  const snap = await getDoc(privateRef(householdId));
  return snap.exists() ? snap.data() : {};
};

// Parent doc + private doc merged (private wins). Use this wherever a screen
// needs a secret or member profile; private overrides any legacy parent copy.
export const getHouseholdWithPrivate = async (householdId) => {
  const [hh, priv] = await Promise.all([getHousehold(householdId), getHouseholdPrivate(householdId)]);
  if (!hh) return null;
  return { ...hh, ...priv };
};

// One-time migration: lift legacy secret/profile fields off the world-readable
// parent doc into the members-only private doc, then delete them from the parent.
// Idempotent — a no-op once the parent has been cleaned.
export const migrateHouseholdSecrets = async (householdId) => {
  const snap = await getDoc(doc(db, 'households', householdId));
  if (!snap.exists()) return;
  const data = snap.data();
  const LEGACY = ['goveeApiKey', 'openRouterApiKey', 'xiaomiCreds', 'memberProfiles'];
  const present = LEGACY.filter((k) => data[k] !== undefined);
  if (present.length === 0) return;
  const priv = {};
  present.forEach((k) => { priv[k] = data[k]; });
  await setDoc(privateRef(householdId), priv, { merge: true });
  const clear = {};
  present.forEach((k) => { clear[k] = deleteField(); });
  await updateDoc(doc(db, 'households', householdId), clear);
};

// Households the user belongs to — source of truth for membership across devices.
export const getHouseholdsForUser = async (uid) => {
  const q = query(collection(db, 'households'), where('members', 'array-contains', uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

// ── Grocery List ─────────────────────────────────────────
export const subscribeGroceryItems = (householdId, callback) => {
  return onSnapshot(
    collection(db, 'households', householdId, 'groceryItems'),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );
};

export const addGroceryItem = (householdId, item) =>
  addDoc(collection(db, 'households', householdId, 'groceryItems'), {
    ...item,
    checked: false,
    createdAt: serverTimestamp(),
  });

export const toggleGroceryItem = (householdId, itemId, checked) =>
  updateDoc(doc(db, 'households', householdId, 'groceryItems', itemId), { checked });

export const updateGroceryItem = (householdId, itemId, data) =>
  updateDoc(doc(db, 'households', householdId, 'groceryItems', itemId), data);

export const deleteGroceryItem = (householdId, itemId) =>
  deleteDoc(doc(db, 'households', householdId, 'groceryItems', itemId));

export const clearCheckedItems = async (householdId, items) => {
  const checked = items.filter((i) => i.checked);
  await Promise.all(checked.map((i) => deleteGroceryItem(householdId, i.id)));
};

export const getGroceryItems = async (householdId) => {
  const snap = await getDocs(collection(db, 'households', householdId, 'groceryItems'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

// ── Grocery Price History ────────────────────────────────
// One doc per purchase: what an item cost, where, and when. Grouping into a
// per-item history (and the cheaper/more-expensive comparison) happens
// client-side in src/utils/pricing.js, so no composite index is needed here.
export const subscribePriceEntries = (householdId, callback) =>
  onSnapshot(
    collection(db, 'households', householdId, 'priceEntries'),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );

export const getPriceEntries = async (householdId) => {
  const snap = await getDocs(collection(db, 'households', householdId, 'priceEntries'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

// `entry` must come from buildPriceEntry() so the stored unitPrice and
// canonicalUnit stay consistent with how history is compared.
export const addPriceEntry = (householdId, entry) =>
  addDoc(collection(db, 'households', householdId, 'priceEntries'), {
    ...entry,
    createdAt: serverTimestamp(),
  });

// Bulk-insert price entries (e.g. from a parsed receipt) in a single batch.
export const addPriceEntriesBatch = (householdId, entries) => {
  if (!entries?.length) return Promise.resolve();
  const batch = writeBatch(db);
  const col = collection(db, 'households', householdId, 'priceEntries');
  for (const entry of entries) {
    batch.set(doc(col), { ...entry, createdAt: serverTimestamp() });
  }
  return batch.commit();
};

// ── Receipt aliases ──────────────────────────────────────
// Learned "this printed line means this item" mappings. Small per household and
// grouped client-side in src/utils/receiptAliases.js, so the whole collection is
// subscribed at once — same shape as priceEntries, and no index needed.
export const subscribeReceiptAliases = (householdId, callback) =>
  onSnapshot(
    collection(db, 'households', householdId, 'receiptAliases'),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );

export const getReceiptAliases = async (householdId) => {
  const snap = await getDocs(collection(db, 'households', householdId, 'receiptAliases'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

// Record what an import confirmed. The doc id is derived from the mapping
// itself (see aliasDocId), so this is an idempotent upsert — re-importing the
// same receipt strengthens the mapping rather than duplicating it. `uses` is an
// increment so two devices importing at once can't clobber each other's count.
export const saveReceiptAliases = (householdId, docs) => {
  if (!docs?.length) return Promise.resolve();
  const batch = writeBatch(db);
  const col = collection(db, 'households', householdId, 'receiptAliases');
  for (const { id, uses, ...fields } of docs) {
    batch.set(
      doc(col, id),
      { ...fields, uses: increment(uses ?? 1), updatedAt: serverTimestamp() },
      { merge: true },
    );
  }
  return batch.commit();
};

export const updatePriceEntry = (householdId, entryId, data) =>
  updateDoc(doc(db, 'households', householdId, 'priceEntries', entryId), {
    ...data,
    updatedAt: serverTimestamp(),
  });

export const deletePriceEntry = (householdId, entryId) =>
  deleteDoc(doc(db, 'households', householdId, 'priceEntries', entryId));

// Remove an item's whole price history (used from the price detail screen).
export const deletePriceEntriesForItem = async (householdId, itemKey) => {
  const q = query(
    collection(db, 'households', householdId, 'priceEntries'),
    where('itemKey', '==', itemKey),
  );
  const snap = await getDocs(q);
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
};

// ── Recipes ──────────────────────────────────────────────
export const subscribeRecipes = (householdId, callback) => {
  return onSnapshot(
    collection(db, 'households', householdId, 'recipes'),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );
};

export const saveRecipe = (householdId, recipe) =>
  addDoc(collection(db, 'households', householdId, 'recipes'), {
    ...recipe,
    createdAt: serverTimestamp(),
  });

export const updateRecipe = (householdId, recipeId, data) =>
  updateDoc(doc(db, 'households', householdId, 'recipes', recipeId), {
    ...data,
    updatedAt: serverTimestamp(),
  });

export const deleteRecipe = (householdId, recipeId) =>
  deleteDoc(doc(db, 'households', householdId, 'recipes', recipeId));

export const getRecipe = async (householdId, recipeId) => {
  const snap = await getDoc(doc(db, 'households', householdId, 'recipes', recipeId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

export const updateHouseholdName = (householdId, name) =>
  updateDoc(doc(db, 'households', householdId), { name });

// Rotate the invite code (e.g. if the old one leaked). Returns the new code.
// The previous code stops working immediately.
export const regenerateInviteCode = async (householdId) => {
  const inviteCode = genInviteCode();
  await updateDoc(doc(db, 'households', householdId), { inviteCode });
  return inviteCode;
};

// Hand ownership to another member (owner action). The new owner must already
// be in the household; ownership drives owner-only abilities like removing members.
export const transferHouseholdOwnership = async (householdId, newOwnerUid) => {
  const ref = doc(db, 'households', householdId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Household not found.');
  if (!(snap.data().members || []).includes(newOwnerUid)) {
    throw new Error('The new owner must be a household member.');
  }
  await updateDoc(ref, { createdBy: newOwnerUid });
};

export const getHouseholdsByIds = async (ids) => {
  if (!ids.length) return [];
  const snaps = await Promise.all(ids.map((id) => getDoc(doc(db, 'households', id))));
  return snaps.filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() }));
};

export const updateHouseholdPantryCategories = (householdId, enabledCategories, customCategories, categoryOrder) =>
  updateDoc(doc(db, 'households', householdId), {
    pantryCategories:      enabledCategories,
    pantryCustomCategories: customCategories,
    pantryCategoryOrder:   categoryOrder,
  });

export const updateHouseholdNonFoodCategories = (householdId, enabledCategories, customCategories, categoryOrder) =>
  updateDoc(doc(db, 'households', householdId), {
    nonFoodCategories:       enabledCategories,
    nonFoodCustomCategories: customCategories,
    nonFoodCategoryOrder:    categoryOrder,
  });

export const updateHouseholdFinanceCategories = (householdId, billCustomCats, expenseCustomCats) =>
  updateDoc(doc(db, 'households', householdId), {
    billCustomCategories:     billCustomCats,
    expenseCustomCategories:  expenseCustomCats,
  });

// Edits to built-in categories (see withOverrides / withCustomCats). Pass only the
// maps that changed: pantry, nonFood, bill, expense.
const OVERRIDE_FIELDS = {
  pantry:  'pantryCategoryOverrides',
  nonFood: 'nonFoodCategoryOverrides',
  bill:    'billCategoryOverrides',
  expense: 'expenseCategoryOverrides',
};
export const updateHouseholdCategoryOverrides = (householdId, overrides) => {
  const fields = {};
  Object.entries(overrides).forEach(([kind, map]) => {
    if (OVERRIDE_FIELDS[kind]) fields[OVERRIDE_FIELDS[kind]] = map ?? {};
  });
  if (!Object.keys(fields).length) return Promise.resolve();
  return updateDoc(doc(db, 'households', householdId), fields);
};

// Collections whose docs store a pantry/grocery category by label.
export const CATEGORY_LABEL_COLLECTIONS = ['pantryItems', 'groceryItems', 'priceEntries', 'receiptAliases'];
const BATCH_LIMIT = 450; // Firestore caps a batch at 500 writes

// Rename a pantry/grocery category on every doc that carries it. All reads run
// before any write, so swaps (A→B, B→A) don't cascade. Returns docs updated.
export const renameItemCategories = async (householdId, renames) => {
  const pending = (renames ?? []).filter((r) => r.from && r.to && r.from !== r.to);
  if (!pending.length) return 0;

  const updates = [];
  await Promise.all(CATEGORY_LABEL_COLLECTIONS.flatMap((name) => pending.map(async ({ from, to }) => {
    const snap = await getDocs(query(
      collection(db, 'households', householdId, name), where('category', '==', from),
    ));
    snap.docs.forEach((d) => updates.push({ ref: d.ref, to }));
  })));

  for (let i = 0; i < updates.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    updates.slice(i, i + BATCH_LIMIT).forEach(({ ref, to }) => batch.update(ref, { category: to }));
    await batch.commit();
  }
  return updates.length;
};

export const updateHouseholdGoveeApiKey = (householdId, apiKey) =>
  setDoc(privateRef(householdId),
    { goveeApiKey: apiKey ? apiKey.trim() : deleteField() }, { merge: true });

export const updateHouseholdOpenRouterApiKey = (householdId, apiKey) =>
  setDoc(privateRef(householdId),
    { openRouterApiKey: apiKey ? apiKey.trim() : deleteField() }, { merge: true });

// Xiaomi Mi Home credentials, shared per household. Devices cache these locally
// (src/services/xiaomi.js) for the signed-request path. Cleared when emptied.
export const updateHouseholdXiaomiCreds = (householdId, creds = {}) => {
  const hasAny = creds.userId || creds.serviceToken || creds.ssecurity;
  return setDoc(privateRef(householdId), {
    xiaomiCreds: hasAny
      ? {
          userId:       (creds.userId       || '').trim(),
          serviceToken: (creds.serviceToken || '').trim(),
          ssecurity:    (creds.ssecurity    || '').trim(),
          region:       creds.region || 'cn',
        }
      : deleteField(),
  }, { merge: true });
};

// Per-integration on/off flags, stored alongside the keys in the private doc so a
// single subscription resolves enabled-state. Absent flag ⇒ enabled if configured.
export const updateHouseholdIntegrationFlags = (householdId, { goveeEnabled, xiaomiEnabled }) =>
  setDoc(privateRef(householdId), { goveeEnabled, xiaomiEnabled }, { merge: true });

// UI preference (not a secret) kept in the private doc so it rides the same
// subscription as the integration flags. Absent ⇒ animations on.
export const updateHouseholdReduceMotion = (householdId, reduceMotion) =>
  setDoc(privateRef(householdId), { reduceMotion }, { merge: true });

// Live members-only private doc (secrets, member profiles, integration flags).
// Calls back with the doc data (or {}); returns the unsubscribe fn.
export const subscribeHouseholdPrivate = (householdId, callback) =>
  onSnapshot(privateRef(householdId), (snap) => callback(snap.exists() ? snap.data() : {}));

export const updateHouseholdAiModel = (householdId, aiModel) =>
  updateDoc(doc(db, 'households', householdId), { aiModel });

export const updateHouseholdUnits = (householdId, enabledUnits, customUnits) =>
  updateDoc(doc(db, 'households', householdId), { enabledUnits, customUnits });

// ── Light Shortcuts ──────────────────────────────────────
export const subscribeLightShortcuts = (householdId, callback) =>
  onSnapshot(
    collection(db, 'households', householdId, 'lightShortcuts'),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );

export const addLightShortcut = (householdId, shortcut) =>
  addDoc(collection(db, 'households', householdId, 'lightShortcuts'), {
    ...shortcut,
    createdAt: serverTimestamp(),
  });

export const updateLightShortcut = (householdId, shortcutId, data) =>
  updateDoc(doc(db, 'households', householdId, 'lightShortcuts', shortcutId), data);

export const deleteLightShortcut = (householdId, shortcutId) =>
  deleteDoc(doc(db, 'households', householdId, 'lightShortcuts', shortcutId));

// ── Light Colours ────────────────────────────────────────
// `lightColors/presets` holds the household's editable swatches;
// `lightColors/recent_<deviceId>` holds each light's recent custom colours.
const RECENT_PREFIX = 'recent_';
const recentColorsDocId = (deviceId) => `${RECENT_PREFIX}${String(deviceId).replace(/\//g, '_')}`;

export const subscribeLightColors = (householdId, callback) =>
  onSnapshot(
    collection(db, 'households', householdId, 'lightColors'),
    (snap) => {
      let presets = null;
      const recentsByDevice = {};
      snap.docs.forEach((d) => {
        const data = d.data();
        if (d.id === 'presets') presets = data.colors ?? null;
        else if (d.id.startsWith(RECENT_PREFIX)) recentsByDevice[data.deviceId] = data.colors ?? [];
      });
      callback({ presets, recentsByDevice });
    },
  );

export const saveLightColorPresets = (householdId, colors) =>
  setDoc(doc(db, 'households', householdId, 'lightColors', 'presets'), {
    colors,
    updatedAt: serverTimestamp(),
  });

export const saveLightRecentColors = (householdId, deviceId, colors) =>
  setDoc(doc(db, 'households', householdId, 'lightColors', recentColorsDocId(deviceId)), {
    deviceId,
    colors,
    updatedAt: serverTimestamp(),
  });

export const leaveHousehold = async (householdId, uid) => {
  const ref = doc(db, 'households', householdId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const members = snap.data().members || [];
  await updateDoc(ref, { members: members.filter((m) => m !== uid) });
  // Drop their stored profile from the private doc too.
  await updateDoc(privateRef(householdId), { [`memberProfiles.${uid}`]: deleteField() }).catch(() => {});
};

// Remove another member (owner action). Same as leaveHousehold but for a
// different uid; the owner cannot be removed this way.
export const removeHouseholdMember = async (householdId, uid) => {
  const ref = doc(db, 'households', householdId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data();
  if (data.createdBy === uid) throw new Error('The household owner cannot be removed.');
  const members = data.members || [];
  await updateDoc(ref, { members: members.filter((m) => m !== uid) });
  await updateDoc(privateRef(householdId), { [`memberProfiles.${uid}`]: deleteField() }).catch(() => {});
};

// ── Pantry ───────────────────────────────────────────────
export const subscribePantryItems = (householdId, callback) => {
  return onSnapshot(
    collection(db, 'households', householdId, 'pantryItems'),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );
};

export const getPantryItems = async (householdId) => {
  const snap = await getDocs(collection(db, 'households', householdId, 'pantryItems'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

export const addPantryItem = (householdId, item) =>
  addDoc(collection(db, 'households', householdId, 'pantryItems'), {
    ...item,
    createdAt: serverTimestamp(),
  });

// Apply a scanned receipt's pantry side in one batch: top up the rows that
// already exist, create the rest. `ops` must come from toPantryOps() so the
// quantities are the pre-summed strings the pantry stores.
export const applyPantryReceiptOps = (householdId, { merges = [], creates = [] } = {}) => {
  if (!merges.length && !creates.length) return Promise.resolve();
  const batch = writeBatch(db);
  const col = collection(db, 'households', householdId, 'pantryItems');

  for (const { id, ...data } of merges) {
    batch.update(doc(col, id), { ...data, updatedAt: serverTimestamp() });
  }
  for (const item of creates) {
    batch.set(doc(col), { ...item, createdAt: serverTimestamp() });
  }
  return batch.commit();
};

export const updatePantryItem = (householdId, itemId, data) =>
  updateDoc(doc(db, 'households', householdId, 'pantryItems', itemId), data);

export const deletePantryItem = (householdId, itemId) =>
  deleteDoc(doc(db, 'households', householdId, 'pantryItems', itemId));

export const deductPantryIngredients = async (householdId, ingredients) => {
  const linked = (ingredients || []).filter(
    (i) => i.pantryItemId && parseFloat(i.amount) > 0,
  );
  await Promise.all(linked.map(async (ingredient) => {
    const ref  = doc(db, 'households', householdId, 'pantryItems', ingredient.pantryItemId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const current   = parseFloat(snap.data().quantity) || 0;
    const deduct    = parseFloat(ingredient.amount)    || 0;
    const remaining = Math.max(0, current - deduct);
    if (remaining === 0) {
      await deleteDoc(ref);
    } else {
      await updateDoc(ref, { quantity: String(remaining) });
    }
  }));
  return linked.length;
};

// Creates a pantry item linked to a grocery item (used when checking off grocery items).
// The groceryItemId field allows reversing the sync when an item is unchecked.
export const addPantryItemFromGrocery = (householdId, groceryItem) =>
  addDoc(collection(db, 'households', householdId, 'pantryItems'), {
    name:          groceryItem.name,
    quantity:      groceryItem.quantity ?? '1',
    unit:          groceryItem.unit     ?? 'pcs',
    category:      groceryItem.category ?? 'Other',
    expiryDate:    groceryItem.expiryDate ?? null,
    addedBy:       groceryItem.addedBy   ?? null,
    groceryItemId: groceryItem.id,
    createdAt:     serverTimestamp(),
  });

// Removes all pantry items that were auto-added from a specific grocery item.
export const removePantryItemByGroceryId = async (householdId, groceryItemId) => {
  const q = query(
    collection(db, 'households', householdId, 'pantryItems'),
    where('groceryItemId', '==', groceryItemId),
  );
  const snap = await getDocs(q);
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
};

// ── Meal Plans ───────────────────────────────────────────
export const subscribeMealPlan = (householdId, weekKey, callback) => {
  const ref = doc(db, 'households', householdId, 'mealPlans', weekKey);
  return onSnapshot(ref, (snap) => {
    callback(snap.exists() ? snap.data() : {});
  });
};

export const setMealSlot = async (householdId, weekKey, day, mealType, meal) => {
  const ref = doc(db, 'households', householdId, 'mealPlans', weekKey);
  // updateDoc interprets dot notation as a nested field path, which is what we need.
  // It fails if the document doesn't exist yet, so fall back to setDoc for creation.
  try {
    await updateDoc(ref, { [`${day}.${mealType}`]: meal });
  } catch {
    await setDoc(ref, { [day]: { [mealType]: meal } });
  }
};

export const clearMealSlot = async (householdId, weekKey, day, mealType) => {
  const ref = doc(db, 'households', householdId, 'mealPlans', weekKey);
  await updateDoc(ref, { [`${day}.${mealType}`]: deleteField() });
};

// ── Bills ────────────────────────────────────────────────
export const subscribeBills = (householdId, callback) =>
  onSnapshot(
    collection(db, 'households', householdId, 'bills'),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );

export const addBill = (householdId, bill) =>
  addDoc(collection(db, 'households', householdId, 'bills'), {
    ...bill,
    paidMonths: [],
    createdAt: serverTimestamp(),
  });

export const updateBill = (householdId, billId, data) =>
  updateDoc(doc(db, 'households', householdId, 'bills', billId), data);

export const deleteBill = (householdId, billId) =>
  deleteDoc(doc(db, 'households', householdId, 'bills', billId));

// ── Expenses ─────────────────────────────────────────────
export const subscribeExpenses = (householdId, callback) =>
  onSnapshot(
    collection(db, 'households', householdId, 'expenses'),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );

export const addExpense = (householdId, expense) =>
  addDoc(collection(db, 'households', householdId, 'expenses'), {
    ...expense,
    createdAt: serverTimestamp(),
  });

// Bulk-insert expenses (e.g. from a parsed bank statement) in a single batch.
export const addExpensesBatch = (householdId, expenses) => {
  if (!expenses?.length) return Promise.resolve();
  const batch = writeBatch(db);
  const col = collection(db, 'households', householdId, 'expenses');
  for (const expense of expenses) {
    batch.set(doc(col), { ...expense, createdAt: serverTimestamp() });
  }
  return batch.commit();
};

export const updateExpense = (householdId, expenseId, data) =>
  updateDoc(doc(db, 'households', householdId, 'expenses', expenseId), data);

export const deleteExpense = (householdId, expenseId) =>
  deleteDoc(doc(db, 'households', householdId, 'expenses', expenseId));

// ── Budgets ──────────────────────────────────────────────
// One budget per expense category — the category key is the doc id, so setting
// a budget for a category is idempotent (no duplicates).
export const subscribeBudgets = (householdId, callback) =>
  onSnapshot(
    collection(db, 'households', householdId, 'budgets'),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );

export const setBudget = (householdId, category, amount) =>
  setDoc(
    doc(db, 'households', householdId, 'budgets', category),
    { category, amount: Number(amount) || 0, updatedAt: serverTimestamp() },
    { merge: true },
  );

export const deleteBudget = (householdId, category) =>
  deleteDoc(doc(db, 'households', householdId, 'budgets', category));

// ── Emergency Contacts ───────────────────────────────────
export const subscribeEmergencyContacts = (householdId, callback) =>
  onSnapshot(
    collection(db, 'households', householdId, 'emergencyContacts'),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );

export const addEmergencyContact = (householdId, contact) =>
  addDoc(collection(db, 'households', householdId, 'emergencyContacts'), {
    ...contact,
    createdAt: serverTimestamp(),
  });

export const updateEmergencyContact = (householdId, contactId, data) =>
  updateDoc(doc(db, 'households', householdId, 'emergencyContacts', contactId), data);

export const deleteEmergencyContact = (householdId, contactId) =>
  deleteDoc(doc(db, 'households', householdId, 'emergencyContacts', contactId));

// ── Weekly Todos ─────────────────────────────────────────
// Single equality filter only — ordering is done client-side so this needs no
// composite index. Callers sort by createdAt (a week holds ~100 docs at most).
export const subscribeWeeklyTodos = (householdId, weekKey, callback, onError) =>
  onSnapshot(
    query(
      collection(db, 'households', householdId, 'weeklyTodos'),
      where('weekKey', '==', weekKey),
    ),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => { console.error('weeklyTodos listener failed', err); onError?.(err); },
  );

export const addWeeklyTodo = (householdId, weekKey, day, text) =>
  addDoc(collection(db, 'households', householdId, 'weeklyTodos'), {
    weekKey, day, text, done: false, createdAt: serverTimestamp(),
  });

export const toggleWeeklyTodo = (householdId, todoId, done) =>
  updateDoc(doc(db, 'households', householdId, 'weeklyTodos', todoId), { done });

// Partial update — editing the text, moving a task to another day, setting or
// clearing its reminder. A null value removes the field rather than storing
// null, so cleared reminders leave no residue on the doc.
export const updateWeeklyTodo = (householdId, todoId, data) => {
  const patch = { updatedAt: serverTimestamp() };
  for (const [key, value] of Object.entries(data)) {
    patch[key] = value === null ? deleteField() : value;
  }
  return updateDoc(doc(db, 'households', householdId, 'weeklyTodos', todoId), patch);
};

export const deleteWeeklyTodo = (householdId, todoId) =>
  deleteDoc(doc(db, 'households', householdId, 'weeklyTodos', todoId));

// One-off read of a week (carry-over looks at last week once per open).
export const getWeeklyTodos = async (householdId, weekKey) => {
  const snap = await getDocs(query(
    collection(db, 'households', householdId, 'weeklyTodos'),
    where('weekKey', '==', weekKey),
  ));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

// Moves tasks into `toWeekKey` (same weekday) rather than copying, so a task
// can't be completed twice. Reminders are cleared — re-arming one for a task
// ignored all last week would just nag.
export const carryOverWeeklyTodos = (householdId, todos, fromWeekKey, toWeekKey) => {
  const batch = writeBatch(db);
  for (const t of todos) {
    batch.update(doc(db, 'households', householdId, 'weeklyTodos', t.id), {
      weekKey: toWeekKey,
      carriedFrom: fromWeekKey,
      remindTime: deleteField(),
      remindFor: deleteField(),
      updatedAt: serverTimestamp(),
    });
  }
  return batch.commit();
};

// Household-wide: once anyone dismisses, the strip is hidden for everyone this week.
export const dismissTodoCarryOver = (householdId, weekKey) =>
  setDoc(privateRef(householdId), { carryOverDismissedWeek: weekKey }, { merge: true });

// ── Recurring todos ──────────────────────────────────────
// Rules live in their own collection; instances are ordinary weeklyTodos docs
// carrying `recurrenceId`, created lazily for the current week.
// Unfiltered (a household has a handful of rules) — callers filter `active`.
export const subscribeTodoRecurrences = (householdId, callback, onError) =>
  onSnapshot(
    collection(db, 'households', householdId, 'todoRecurrences'),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => { console.error('todoRecurrences listener failed', err); onError?.(err); },
  );

// Creates a rule from an existing task and links that task as its instance.
export const createTodoRecurrence = (householdId, todo, days, startsOn) => {
  const batch = writeBatch(db);
  const ruleRef = doc(collection(db, 'households', householdId, 'todoRecurrences'));
  batch.set(ruleRef, {
    text: todo.text,
    days,
    active: true,
    startsOn,
    lastMaterializedWeek: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'households', householdId, 'weeklyTodos', todo.id), {
    recurrenceId: ruleRef.id,
    updatedAt: serverTimestamp(),
  });
  return batch.commit().then(() => ruleRef.id);
};

export const updateTodoRecurrence = (householdId, ruleId, data) =>
  updateDoc(doc(db, 'households', householdId, 'todoRecurrences', ruleId), {
    ...data,
    updatedAt: serverTimestamp(),
  });

// Existing instances stay; only future weeks stop getting new ones.
export const deleteTodoRecurrence = (householdId, ruleId) =>
  deleteDoc(doc(db, 'households', householdId, 'todoRecurrences', ruleId));

// Writes planned instances and marks rules done for the week in one batch, so
// a failure can't half-fill the week. `creates` is [{ rule, day }].
export const materializeTodoRecurrences = (householdId, weekKey, creates, markRuleIds) => {
  const batch = writeBatch(db);
  const todosCol = collection(db, 'households', householdId, 'weeklyTodos');
  for (const { rule, day } of creates) {
    batch.set(doc(todosCol), {
      weekKey, day, text: rule.text, done: false, recurrenceId: rule.id, createdAt: serverTimestamp(),
    });
  }
  for (const id of markRuleIds) {
    batch.update(doc(db, 'households', householdId, 'todoRecurrences', id), { lastMaterializedWeek: weekKey });
  }
  return batch.commit();
};

// ── Body & goals ─────────────────────────────────────────
// Per-member, keyed by uid; readable by the whole household. See docs/weight-tracker.md.
export const subscribeBodyProfile = (householdId, uid, callback, onError) =>
  onSnapshot(
    doc(db, 'households', householdId, 'bodyProfiles', uid),
    (snap) => callback(snap.exists() ? snap.data() : null),
    (err) => { console.error('bodyProfile listener failed', err); onError?.(err); },
  );

export const saveBodyProfile = (householdId, uid, profile) =>
  setDoc(
    doc(db, 'households', householdId, 'bodyProfiles', uid),
    { ...profile, updatedAt: serverTimestamp() },
    { merge: true },
  );

// Single equality filter — callers sort by `date` (no composite index).
export const subscribeWeightLogs = (householdId, uid, callback, onError) =>
  onSnapshot(
    query(
      collection(db, 'households', householdId, 'weightLogs'),
      where('uid', '==', uid),
    ),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => { console.error('weightLogs listener failed', err); onError?.(err); },
  );

// One entry per user per day: id is `${uid}_${date}`, so re-logging a date overwrites it.
export const logWeight = (householdId, uid, date, weightKg) =>
  setDoc(
    doc(db, 'households', householdId, 'weightLogs', weightLogId(uid, date)),
    { uid, date, weightKg, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
  );

export const deleteWeightLog = (householdId, logId) =>
  deleteDoc(doc(db, 'households', householdId, 'weightLogs', logId));
