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
} from 'firebase/firestore';

import { db } from '../config/firebase';

// ── Households ───────────────────────────────────────────
const sanitizeProfile = ({ name, email } = {}) => ({
  name:  (name  || '').trim(),
  email: (email || '').trim(),
});

// Sensitive per-household data (integration secrets + member emails) lives in a
// members-only subcollection doc, NOT the parent household doc — the parent is
// world-readable to any authenticated user so join-by-invite-code can query it.
const privateRef = (householdId) => doc(db, 'households', householdId, 'private', 'data');

export const createHousehold = async (uid, name, profile = {}) => {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const inviteCode = Array.from(bytes, (b) => CHARS[b % CHARS.length]).join('');
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

export const leaveHousehold = async (householdId, uid) => {
  const ref = doc(db, 'households', householdId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const members = snap.data().members || [];
  await updateDoc(ref, { members: members.filter((m) => m !== uid) });
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
export const subscribeWeeklyTodos = (householdId, weekKey, callback) =>
  onSnapshot(
    query(
      collection(db, 'households', householdId, 'weeklyTodos'),
      where('weekKey', '==', weekKey),
    ),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );

export const addWeeklyTodo = (householdId, weekKey, day, text) =>
  addDoc(collection(db, 'households', householdId, 'weeklyTodos'), {
    weekKey, day, text, done: false, createdAt: serverTimestamp(),
  });

export const toggleWeeklyTodo = (householdId, todoId, done) =>
  updateDoc(doc(db, 'households', householdId, 'weeklyTodos', todoId), { done });

export const deleteWeeklyTodo = (householdId, todoId) =>
  deleteDoc(doc(db, 'households', householdId, 'weeklyTodos', todoId));
