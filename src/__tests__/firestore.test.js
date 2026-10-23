// Mock Firebase so tests don't need a real Firestore connection.
jest.mock('../config/firebase', () => ({ db: {} }));

const mockDeleteDoc = jest.fn().mockResolvedValue(undefined);
const mockUpdateDoc = jest.fn().mockResolvedValue(undefined);
const mockGetDoc = jest.fn();
const mockGetDocs = jest.fn();
const mockDoc = jest.fn((db, ...segments) => segments.join('/'));
const mockCollection = jest.fn((db, ...segments) => segments.join('/'));
const mockAddDoc = jest.fn().mockResolvedValue({ id: 'new-id' });
const mockSetDoc = jest.fn().mockResolvedValue(undefined);
const mockServerTimestamp = jest.fn(() => 'SERVER_TIMESTAMP');
const mockDeleteField = jest.fn(() => 'DELETE_FIELD');
const mockBatchSet = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue(undefined);
const mockWriteBatch = jest.fn(() => ({
  set: mockBatchSet, update: mockBatchUpdate, commit: mockBatchCommit,
}));

jest.mock('firebase/firestore', () => ({
  collection: (...args) => mockCollection(...args),
  doc: (...args) => mockDoc(...args),
  addDoc: (...args) => mockAddDoc(...args),
  updateDoc: (...args) => mockUpdateDoc(...args),
  deleteDoc: (...args) => mockDeleteDoc(...args),
  getDocs: (...args) => mockGetDocs(...args),
  getDoc: (...args) => mockGetDoc(...args),
  setDoc: (...args) => mockSetDoc(...args),
  query: jest.fn(),
  where: jest.fn(),
  orderBy: jest.fn(),
  onSnapshot: jest.fn(),
  serverTimestamp: () => mockServerTimestamp(),
  deleteField: () => mockDeleteField(),
  writeBatch: (...args) => mockWriteBatch(...args),
  increment: (n) => ({ __increment: n }),
}));

import {
  clearCheckedItems,
  deleteGroceryItem,
  deductPantryIngredients,
  getGroceryItems,
  getHouseholdsForUser,
  getHouseholdPrivate,
  getHouseholdWithPrivate,
  migrateHouseholdSecrets,
  removeHouseholdMember,
  regenerateInviteCode,
  transferHouseholdOwnership,
  joinHousehold,
  upsertMemberProfile,
  updateHouseholdUnits,
  addExpensesBatch,
  updateHouseholdOpenRouterApiKey,
  updateHouseholdAiModel,
  updateHouseholdXiaomiCreds,
  updateHouseholdIntegrationFlags,
  updateHouseholdReduceMotion,
  subscribeHouseholdPrivate,
  subscribePriceEntries,
  getPriceEntries,
  addPriceEntry,
  updatePriceEntry,
  deletePriceEntry,
  deletePriceEntriesForItem,
  addPriceEntriesBatch,
  applyPantryReceiptOps,
  saveReceiptAliases,
  subscribeWeeklyTodos,
  addWeeklyTodo,
  toggleWeeklyTodo,
  updateWeeklyTodo,
  deleteWeeklyTodo,
  subscribeBodyProfile,
  saveBodyProfile,
  subscribeWeightLogs,
  logWeight,
  deleteWeightLog,
  subscribeLightColors,
  saveLightColorPresets,
  saveLightRecentColors,
  getWeeklyTodos,
  carryOverWeeklyTodos,
  dismissTodoCarryOver,
  subscribeTodoRecurrences,
  createTodoRecurrence,
  updateTodoRecurrence,
  deleteTodoRecurrence,
  materializeTodoRecurrences,
  updateHouseholdCategoryOverrides,
  renameItemCategories,
  CATEGORY_LABEL_COLLECTIONS,
} from '../services/firestore';
import { onSnapshot, where, orderBy, query } from 'firebase/firestore';

beforeEach(() => {
  jest.clearAllMocks();
});

// ── clearCheckedItems ─────────────────────────────────────────────────────────

describe('clearCheckedItems', () => {
  const householdId = 'hh1';

  it('deletes only checked items', async () => {
    const items = [
      { id: 'a', checked: true },
      { id: 'b', checked: false },
      { id: 'c', checked: true },
    ];
    await clearCheckedItems(householdId, items);
    expect(mockDeleteDoc).toHaveBeenCalledTimes(2);
  });

  it('does nothing when no items are checked', async () => {
    const items = [{ id: 'a', checked: false }];
    await clearCheckedItems(householdId, items);
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });

  it('does nothing for an empty list', async () => {
    await clearCheckedItems(householdId, []);
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });
});

// ── deductPantryIngredients ───────────────────────────────────────────────────

function makeSnap(quantity) {
  return {
    exists: () => true,
    data: () => ({ quantity: String(quantity) }),
  };
}

describe('deductPantryIngredients', () => {
  const householdId = 'hh1';

  it('returns 0 and does nothing for empty ingredients', async () => {
    const count = await deductPantryIngredients(householdId, []);
    expect(count).toBe(0);
    expect(mockDeleteDoc).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('skips ingredients without a pantryItemId', async () => {
    const ingredients = [{ name: 'salt', amount: '2' }];
    const count = await deductPantryIngredients(householdId, ingredients);
    expect(count).toBe(0);
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });

  it('skips ingredients with amount 0', async () => {
    const ingredients = [{ pantryItemId: 'p1', amount: '0' }];
    const count = await deductPantryIngredients(householdId, ingredients);
    expect(count).toBe(0);
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });

  it('updates quantity when remainder is positive', async () => {
    mockGetDoc.mockResolvedValue(makeSnap(10));
    const ingredients = [{ pantryItemId: 'p1', amount: '3' }];
    await deductPantryIngredients(householdId, ingredients);
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.anything(),
      { quantity: '7' },
    );
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });

  it('deletes the item when quantity reaches zero', async () => {
    mockGetDoc.mockResolvedValue(makeSnap(3));
    const ingredients = [{ pantryItemId: 'p1', amount: '3' }];
    await deductPantryIngredients(householdId, ingredients);
    expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('clamps remaining to 0 (never goes negative)', async () => {
    mockGetDoc.mockResolvedValue(makeSnap(1));
    const ingredients = [{ pantryItemId: 'p1', amount: '5' }];
    await deductPantryIngredients(householdId, ingredients);
    expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
  });

  it('returns the count of linked ingredients processed', async () => {
    mockGetDoc.mockResolvedValue(makeSnap(10));
    const ingredients = [
      { pantryItemId: 'p1', amount: '1' },
      { pantryItemId: 'p2', amount: '2' },
      { name: 'no-link', amount: '1' },
    ];
    const count = await deductPantryIngredients(householdId, ingredients);
    expect(count).toBe(2);
  });
});

// ── getGroceryItems ───────────────────────────────────────────────────────────

describe('getGroceryItems', () => {
  const householdId = 'hh1';

  it('returns all grocery items mapped with their ids', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        { id: 'g1', data: () => ({ name: 'Milk', checked: false }) },
        { id: 'g2', data: () => ({ name: 'Bread', checked: true }) },
      ],
    });
    const items = await getGroceryItems(householdId);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ id: 'g1', name: 'Milk', checked: false });
    expect(items[1]).toEqual({ id: 'g2', name: 'Bread', checked: true });
  });

  it('returns an empty array when there are no grocery items', async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });
    const items = await getGroceryItems(householdId);
    expect(items).toEqual([]);
  });

  it('queries the correct Firestore collection path', async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });
    await getGroceryItems(householdId);
    expect(mockCollection).toHaveBeenCalledWith(
      expect.anything(),
      'households',
      householdId,
      'groceryItems',
    );
  });
});

// ── getHouseholdsForUser ──────────────────────────────────────────────────────

describe('getHouseholdsForUser', () => {
  it('returns every household the user is a member of, mapped with ids', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        { id: 'h1', data: () => ({ name: 'Home', members: ['u1'] }) },
        { id: 'h2', data: () => ({ name: 'Lake House', members: ['u1', 'u2'] }) },
      ],
    });
    const households = await getHouseholdsForUser('u1');
    expect(households).toEqual([
      { id: 'h1', name: 'Home', members: ['u1'] },
      { id: 'h2', name: 'Lake House', members: ['u1', 'u2'] },
    ]);
  });

  it('returns an empty array when the user belongs to no household', async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });
    expect(await getHouseholdsForUser('u1')).toEqual([]);
  });

  it('queries the households collection', async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });
    await getHouseholdsForUser('u1');
    expect(mockCollection).toHaveBeenCalledWith(expect.anything(), 'households');
  });
});

// ── upsertMemberProfile ───────────────────────────────────────────────────────

describe('upsertMemberProfile', () => {
  it('merges the trimmed name and email into the private doc', async () => {
    await upsertMemberProfile('hh1', 'u1', { name: '  Alice  ', email: '  a@x.com  ' });
    expect(mockSetDoc).toHaveBeenCalledWith(
      'households/hh1/private/data',
      { memberProfiles: { u1: { name: 'Alice', email: 'a@x.com' } } },
      { merge: true },
    );
  });

  it('coerces missing fields to empty strings', async () => {
    await upsertMemberProfile('hh1', 'u1', {});
    expect(mockSetDoc).toHaveBeenCalledWith(
      'households/hh1/private/data',
      { memberProfiles: { u1: { name: '', email: '' } } },
      { merge: true },
    );
  });
});

// ── joinHousehold ─────────────────────────────────────────────────────────────

describe('joinHousehold', () => {
  it('adds the user to members and records their profile in the private doc', async () => {
    mockGetDocs.mockResolvedValue({
      empty: false,
      docs: [{ id: 'hh1', data: () => ({ members: ['owner'] }) }],
    });
    const id = await joinHousehold('u2', 'abc123', { name: 'Bob', email: 'b@x.com' });
    expect(id).toBe('hh1');
    expect(mockUpdateDoc).toHaveBeenCalledWith('households/hh1', { members: ['owner', 'u2'] });
    expect(mockSetDoc).toHaveBeenCalledWith(
      'households/hh1/private/data',
      { memberProfiles: { u2: { name: 'Bob', email: 'b@x.com' } } },
      { merge: true },
    );
  });

  it('throws on an invalid invite code', async () => {
    mockGetDocs.mockResolvedValue({ empty: true, docs: [] });
    await expect(joinHousehold('u2', 'nope')).rejects.toThrow('Invalid invite code.');
  });

  it('skips re-adding an existing member but still refreshes their profile', async () => {
    mockGetDocs.mockResolvedValue({
      empty: false,
      docs: [{ id: 'hh1', data: () => ({ members: ['u2'] }) }],
    });
    await joinHousehold('u2', 'abc123', { name: 'Bob', email: 'b@x.com' });
    expect(mockUpdateDoc).not.toHaveBeenCalled();       // no members-array change
    expect(mockSetDoc).toHaveBeenCalledWith(
      'households/hh1/private/data',
      { memberProfiles: { u2: { name: 'Bob', email: 'b@x.com' } } },
      { merge: true },
    );
  });
});

// ── getHouseholdPrivate / getHouseholdWithPrivate ─────────────────────────────

describe('getHouseholdPrivate', () => {
  it('returns the private doc data', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ goveeApiKey: 'g' }) });
    expect(await getHouseholdPrivate('hh1')).toEqual({ goveeApiKey: 'g' });
  });

  it('returns an empty object when the private doc is missing', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });
    expect(await getHouseholdPrivate('hh1')).toEqual({});
  });
});

describe('getHouseholdWithPrivate', () => {
  it('merges the private doc over the parent, with private winning', async () => {
    mockGetDoc
      .mockResolvedValueOnce({ exists: () => true, id: 'hh1', data: () => ({ name: 'Home', goveeApiKey: 'legacy' }) })
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ goveeApiKey: 'current', memberProfiles: { u1: {} } }) });
    const merged = await getHouseholdWithPrivate('hh1');
    expect(merged).toEqual({
      id: 'hh1', name: 'Home', goveeApiKey: 'current', memberProfiles: { u1: {} },
    });
  });

  it('returns null when the household does not exist', async () => {
    mockGetDoc
      .mockResolvedValueOnce({ exists: () => false })
      .mockResolvedValueOnce({ exists: () => false });
    expect(await getHouseholdWithPrivate('hh1')).toBeNull();
  });
});

// ── migrateHouseholdSecrets ───────────────────────────────────────────────────

describe('migrateHouseholdSecrets', () => {
  it('copies legacy secrets to the private doc and deletes them from the parent', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ name: 'Home', goveeApiKey: 'g', openRouterApiKey: 'o' }),
    });
    await migrateHouseholdSecrets('hh1');
    expect(mockSetDoc).toHaveBeenCalledWith(
      'households/hh1/private/data',
      { goveeApiKey: 'g', openRouterApiKey: 'o' },
      { merge: true },
    );
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      'households/hh1',
      { goveeApiKey: 'DELETE_FIELD', openRouterApiKey: 'DELETE_FIELD' },
    );
  });

  it('does nothing when the parent holds no legacy secrets', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ name: 'Home' }) });
    await migrateHouseholdSecrets('hh1');
    expect(mockSetDoc).not.toHaveBeenCalled();
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});

// ── removeHouseholdMember ─────────────────────────────────────────────────────

describe('removeHouseholdMember', () => {
  it('removes the member from the array and deletes their profile', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ createdBy: 'owner', members: ['owner', 'u2'] }),
    });
    await removeHouseholdMember('hh1', 'u2');
    expect(mockUpdateDoc).toHaveBeenCalledWith('households/hh1', { members: ['owner'] });
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      'households/hh1/private/data',
      { 'memberProfiles.u2': 'DELETE_FIELD' },
    );
  });

  it('refuses to remove the owner', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ createdBy: 'owner', members: ['owner', 'u2'] }),
    });
    await expect(removeHouseholdMember('hh1', 'owner')).rejects.toThrow('owner cannot be removed');
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('does nothing when the household is missing', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });
    await removeHouseholdMember('hh1', 'u2');
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});

// ── updateHouseholdUnits ──────────────────────────────────────────────────────

describe('updateHouseholdUnits', () => {
  const householdId = 'hh1';

  it('calls updateDoc with enabledUnits and customUnits', async () => {
    const enabledUnits = ['pcs', 'g', 'kg'];
    const customUnits  = ['pinch'];
    await updateHouseholdUnits(householdId, enabledUnits, customUnits);
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.anything(),
      { enabledUnits, customUnits },
    );
  });

  it('persists an empty customUnits array', async () => {
    await updateHouseholdUnits(householdId, ['pcs'], []);
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.anything(),
      { enabledUnits: ['pcs'], customUnits: [] },
    );
  });

  it('persists an empty enabledUnits array when all units are disabled', async () => {
    await updateHouseholdUnits(householdId, [], []);
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.anything(),
      { enabledUnits: [], customUnits: [] },
    );
  });

  it('targets the correct household document', async () => {
    await updateHouseholdUnits(householdId, [], []);
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), 'households', householdId);
  });
});

// ── addExpensesBatch ──────────────────────────────────────────────────────────

describe('addExpensesBatch', () => {
  const householdId = 'hh1';

  it('writes each expense in a single batch with a server timestamp', async () => {
    const expenses = [
      { title: 'A', amount: 10, direction: 'out' },
      { title: 'B', amount: 20, direction: 'in' },
    ];
    await addExpensesBatch(householdId, expenses);

    expect(mockWriteBatch).toHaveBeenCalledTimes(1);
    expect(mockBatchSet).toHaveBeenCalledTimes(2);
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: 'A', createdAt: 'SERVER_TIMESTAMP' }),
    );
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an empty list', async () => {
    await addExpensesBatch(householdId, []);
    expect(mockWriteBatch).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });
});

// ── updateHouseholdOpenRouterApiKey ───────────────────────────────────────────

describe('updateHouseholdOpenRouterApiKey', () => {
  const householdId = 'hh1';

  it('trims and stores the key in the private doc', async () => {
    await updateHouseholdOpenRouterApiKey(householdId, '  sk-or-abc  ');
    expect(mockSetDoc).toHaveBeenCalledWith(
      'households/hh1/private/data',
      { openRouterApiKey: 'sk-or-abc' },
      { merge: true },
    );
  });

  it('deletes the field when cleared', async () => {
    await updateHouseholdOpenRouterApiKey(householdId, '');
    expect(mockSetDoc).toHaveBeenCalledWith(
      'households/hh1/private/data',
      { openRouterApiKey: 'DELETE_FIELD' },
      { merge: true },
    );
  });
});

// ── updateHouseholdAiModel ────────────────────────────────────────────────────

describe('updateHouseholdAiModel', () => {
  it('stores the selected model id', async () => {
    await updateHouseholdAiModel('hh1', 'google/gemma-4-31b-it:free');
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.anything(),
      { aiModel: 'google/gemma-4-31b-it:free' },
    );
  });
});

// ── updateHouseholdXiaomiCreds ────────────────────────────────────────────────

describe('updateHouseholdXiaomiCreds', () => {
  it('stores trimmed credentials with a defaulted region in the private doc', async () => {
    await updateHouseholdXiaomiCreds('hh1', { userId: ' 123 ', serviceToken: ' tok ', ssecurity: ' key ' });
    expect(mockSetDoc).toHaveBeenCalledWith(
      'households/hh1/private/data',
      { xiaomiCreds: { userId: '123', serviceToken: 'tok', ssecurity: 'key', region: 'cn' } },
      { merge: true },
    );
  });

  it('keeps the chosen region', async () => {
    await updateHouseholdXiaomiCreds('hh1', { userId: '1', serviceToken: 't', ssecurity: 's', region: 'eu' });
    expect(mockSetDoc).toHaveBeenCalledWith(
      'households/hh1/private/data',
      { xiaomiCreds: expect.objectContaining({ region: 'eu' }) },
      { merge: true },
    );
  });

  it('deletes the field when all credentials are empty', async () => {
    await updateHouseholdXiaomiCreds('hh1', { userId: '', serviceToken: '', ssecurity: '', region: 'us' });
    expect(mockSetDoc).toHaveBeenCalledWith(
      'households/hh1/private/data',
      { xiaomiCreds: 'DELETE_FIELD' },
      { merge: true },
    );
  });
});

// ── updateHouseholdIntegrationFlags ───────────────────────────────────────────

describe('updateHouseholdIntegrationFlags', () => {
  it('merges the enabled flags into the private doc', async () => {
    await updateHouseholdIntegrationFlags('hh1', { goveeEnabled: true, xiaomiEnabled: false });
    expect(mockSetDoc).toHaveBeenCalledWith(
      'households/hh1/private/data',
      { goveeEnabled: true, xiaomiEnabled: false },
      { merge: true },
    );
  });
});

// ── updateHouseholdReduceMotion ───────────────────────────────────────────────

describe('updateHouseholdReduceMotion', () => {
  it('merges the reduce-motion flag into the private doc', async () => {
    await updateHouseholdReduceMotion('hh1', true);
    expect(mockSetDoc).toHaveBeenCalledWith(
      'households/hh1/private/data',
      { reduceMotion: true },
      { merge: true },
    );
  });
});

// ── subscribeHouseholdPrivate ─────────────────────────────────────────────────

describe('subscribeHouseholdPrivate', () => {
  it('subscribes to the private doc and returns the unsubscribe fn', () => {
    const unsub = jest.fn();
    const cb = jest.fn();
    onSnapshot.mockImplementation((ref, handler) => {
      handler({ exists: () => true, data: () => ({ goveeEnabled: true }) });
      return unsub;
    });
    const result = subscribeHouseholdPrivate('hh1', cb);
    expect(onSnapshot).toHaveBeenCalledWith('households/hh1/private/data', expect.any(Function));
    expect(cb).toHaveBeenCalledWith({ goveeEnabled: true });
    expect(result).toBe(unsub);
  });

  it('calls back with an empty object when the doc is missing', () => {
    const cb = jest.fn();
    onSnapshot.mockImplementation((ref, handler) => {
      handler({ exists: () => false });
      return jest.fn();
    });
    subscribeHouseholdPrivate('hh1', cb);
    expect(cb).toHaveBeenCalledWith({});
  });
});

// ── Price entries ─────────────────────────────────────────────────────────────

describe('price entries', () => {
  const householdId = 'hh1';
  const entry = {
    itemKey: 'milk', itemName: 'Milk', price: 1.49,
    quantity: 1, unit: 'L', canonicalUnit: 'L', unitPrice: 1.49,
    purchasedAt: '2026-01-01', store: 'Lidl',
  };

  it('subscribes to the household priceEntries collection', () => {
    const unsub = jest.fn();
    const cb = jest.fn();
    onSnapshot.mockImplementation((ref, handler) => {
      handler({ docs: [{ id: 'p1', data: () => entry }] });
      return unsub;
    });
    const result = subscribePriceEntries(householdId, cb);
    expect(onSnapshot).toHaveBeenCalledWith('households/hh1/priceEntries', expect.any(Function));
    expect(cb).toHaveBeenCalledWith([{ id: 'p1', ...entry }]);
    expect(result).toBe(unsub);
  });

  it('reads entries with their doc ids', async () => {
    mockGetDocs.mockResolvedValue({ docs: [{ id: 'p1', data: () => entry }] });
    await expect(getPriceEntries(householdId)).resolves.toEqual([{ id: 'p1', ...entry }]);
    expect(mockCollection).toHaveBeenCalledWith({}, 'households', 'hh1', 'priceEntries');
  });

  it('stamps createdAt on a new entry', async () => {
    await addPriceEntry(householdId, entry);
    expect(mockAddDoc).toHaveBeenCalledWith(
      'households/hh1/priceEntries',
      { ...entry, createdAt: 'SERVER_TIMESTAMP' },
    );
  });

  it('stamps updatedAt on an edit', async () => {
    await updatePriceEntry(householdId, 'p1', { price: 2 });
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      'households/hh1/priceEntries/p1',
      { price: 2, updatedAt: 'SERVER_TIMESTAMP' },
    );
  });

  it('deletes a single entry by id', async () => {
    await deletePriceEntry(householdId, 'p1');
    expect(mockDeleteDoc).toHaveBeenCalledWith('households/hh1/priceEntries/p1');
  });

  it('deletes a whole item history by itemKey', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [{ ref: 'ref-a' }, { ref: 'ref-b' }],
    });
    await deletePriceEntriesForItem(householdId, 'milk');
    expect(where).toHaveBeenCalledWith('itemKey', '==', 'milk');
    expect(mockDeleteDoc).toHaveBeenCalledTimes(2);
    expect(mockDeleteDoc).toHaveBeenCalledWith('ref-a');
    expect(mockDeleteDoc).toHaveBeenCalledWith('ref-b');
  });

  it('is a no-op when an item has no entries', async () => {
    mockGetDocs.mockResolvedValue({ docs: [] });
    await deletePriceEntriesForItem(householdId, 'nothing');
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });

  it('writes an imported receipt as a single batch', async () => {
    await addPriceEntriesBatch(householdId, [entry, { ...entry, itemKey: 'egg' }]);
    expect(mockWriteBatch).toHaveBeenCalledTimes(1);
    expect(mockBatchSet).toHaveBeenCalledTimes(2);
    expect(mockBatchSet.mock.calls[0][1]).toMatchObject({ ...entry, createdAt: 'SERVER_TIMESTAMP' });
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('does not open a batch for an empty import', async () => {
    await addPriceEntriesBatch(householdId, []);
    await addPriceEntriesBatch(householdId, undefined);
    expect(mockWriteBatch).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });
});

// ── applyPantryReceiptOps ─────────────────────────────────────────────────────

describe('applyPantryReceiptOps', () => {
  const householdId = 'hh1';

  it('tops up existing rows and creates new ones in one batch', async () => {
    await applyPantryReceiptOps(householdId, {
      merges:  [{ id: 'p1', quantity: '3' }],
      creates: [{ name: 'Eggs', quantity: '6', unit: 'pcs', category: 'Other' }],
    });
    expect(mockWriteBatch).toHaveBeenCalledTimes(1);
    expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
    expect(mockBatchUpdate.mock.calls[0][1]).toEqual({ quantity: '3', updatedAt: 'SERVER_TIMESTAMP' });
    expect(mockBatchSet).toHaveBeenCalledTimes(1);
    expect(mockBatchSet.mock.calls[0][1]).toMatchObject({ name: 'Eggs', createdAt: 'SERVER_TIMESTAMP' });
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('targets the pantry doc named by the merge id', async () => {
    await applyPantryReceiptOps(householdId, { merges: [{ id: 'p1', quantity: '3' }] });
    // doc() is mocked to join its segments, and collection() supplies the path.
    expect(mockBatchUpdate.mock.calls[0][0]).toContain('p1');
  });

  it('does not write the id itself into the document', async () => {
    await applyPantryReceiptOps(householdId, { merges: [{ id: 'p1', quantity: '3' }] });
    expect(mockBatchUpdate.mock.calls[0][1]).not.toHaveProperty('id');
  });

  it('does not open a batch when there is nothing to do', async () => {
    await applyPantryReceiptOps(householdId, { merges: [], creates: [] });
    await applyPantryReceiptOps(householdId, {});
    await applyPantryReceiptOps(householdId);
    expect(mockWriteBatch).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });
});

// ── saveReceiptAliases ────────────────────────────────────────────────────────

describe('saveReceiptAliases', () => {
  const householdId = 'hh1';
  const aliasDoc = {
    id: 'r:deterg-e-prod-limpeza__pastilhas-finish__continente',
    lookupKey: 'r:deterg e prod limpeza',
    rawText: 'DETERG. E PROD LIMPEZA',
    itemKey: 'pastilhas finish',
    itemName: 'Pastilhas Finish',
    uses: 1,
  };

  it('upserts each mapping as a merge, so a re-import does not duplicate it', async () => {
    await saveReceiptAliases(householdId, [aliasDoc]);
    expect(mockBatchSet).toHaveBeenCalledTimes(1);
    expect(mockBatchSet.mock.calls[0][2]).toEqual({ merge: true });
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('counts a confirmation as an increment rather than a fixed value', async () => {
    // Two devices importing at once must both be counted, not clobber.
    await saveReceiptAliases(householdId, [aliasDoc]);
    expect(mockBatchSet.mock.calls[0][1].uses).toEqual({ __increment: 1 });
  });

  it('writes the mapping fields and a server timestamp, but not the id', async () => {
    await saveReceiptAliases(householdId, [aliasDoc]);
    const written = mockBatchSet.mock.calls[0][1];
    expect(written).toMatchObject({
      lookupKey: 'r:deterg e prod limpeza',
      itemKey: 'pastilhas finish',
      itemName: 'Pastilhas Finish',
      updatedAt: 'SERVER_TIMESTAMP',
    });
    expect(written).not.toHaveProperty('id');
  });

  it('targets the document named by the alias id', async () => {
    await saveReceiptAliases(householdId, [aliasDoc]);
    expect(mockBatchSet.mock.calls[0][0]).toContain(aliasDoc.id);
  });

  it('does not open a batch when nothing was learned', async () => {
    await saveReceiptAliases(householdId, []);
    await saveReceiptAliases(householdId, undefined);
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });
});

// ── regenerateInviteCode ──────────────────────────────────────────────────────

describe('regenerateInviteCode', () => {
  beforeEach(() => {
    // Deterministic bytes so we can assert the shape without a real CSPRNG.
    global.crypto = { getRandomValues: (arr) => { for (let i = 0; i < arr.length; i++) arr[i] = i; return arr; } };
  });

  it('writes a fresh 6-char uppercase code and returns it', async () => {
    const code = await regenerateInviteCode('hh1');
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    expect(mockUpdateDoc).toHaveBeenCalledWith('households/hh1', { inviteCode: code });
  });
});

// ── transferHouseholdOwnership ────────────────────────────────────────────────

describe('transferHouseholdOwnership', () => {
  it('sets createdBy to the new owner when they are a member', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ createdBy: 'owner', members: ['owner', 'u2'] }),
    });
    await transferHouseholdOwnership('hh1', 'u2');
    expect(mockUpdateDoc).toHaveBeenCalledWith('households/hh1', { createdBy: 'u2' });
  });

  it('rejects when the new owner is not a member', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ createdBy: 'owner', members: ['owner'] }),
    });
    await expect(transferHouseholdOwnership('hh1', 'stranger')).rejects.toThrow('must be a household member');
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('rejects when the household is missing', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });
    await expect(transferHouseholdOwnership('hh1', 'u2')).rejects.toThrow('not found');
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});

// ── Weekly todos ──────────────────────────────────────────────────────────────

describe('weekly todos', () => {
  const householdId = 'hh1';

  it('subscribes to a single week and maps the docs', () => {
    const unsub = jest.fn();
    const cb = jest.fn();
    onSnapshot.mockImplementation((q, handler) => {
      handler({ docs: [{ id: 't1', data: () => ({ text: 'Bins', day: 'Tuesday' }) }] });
      return unsub;
    });
    const result = subscribeWeeklyTodos(householdId, '2026-09-07', cb);
    expect(where).toHaveBeenCalledWith('weekKey', '==', '2026-09-07');
    expect(cb).toHaveBeenCalledWith([{ id: 't1', text: 'Bins', day: 'Tuesday' }]);
    expect(result).toBe(unsub);
  });

  // A composite index would be needed for where + orderBy; without it the
  // listener dies silently and the widget shows stale rows that never update.
  it('uses no orderBy, so the query needs no composite index', () => {
    onSnapshot.mockImplementation(() => jest.fn());
    subscribeWeeklyTodos(householdId, '2026-09-07', jest.fn());
    expect(orderBy).not.toHaveBeenCalled();
  });

  it('reports listener failures to the caller instead of swallowing them', () => {
    const onError = jest.fn();
    const failure = new Error('The query requires an index');
    onSnapshot.mockImplementation((q, handler, errHandler) => {
      errHandler(failure);
      return jest.fn();
    });
    subscribeWeeklyTodos(householdId, '2026-09-07', jest.fn(), onError);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('adds a todo with a server timestamp and done=false', async () => {
    await addWeeklyTodo(householdId, '2026-09-07', 'Tuesday', 'Take the bins out');
    expect(mockAddDoc).toHaveBeenCalledWith('households/hh1/weeklyTodos', {
      weekKey: '2026-09-07',
      day: 'Tuesday',
      text: 'Take the bins out',
      done: false,
      createdAt: 'SERVER_TIMESTAMP',
    });
  });

  it('toggles done without touching other fields', async () => {
    await toggleWeeklyTodo(householdId, 't1', true);
    expect(mockUpdateDoc).toHaveBeenCalledWith('households/hh1/weeklyTodos/t1', { done: true });
  });

  it('updates the text and stamps updatedAt', async () => {
    await updateWeeklyTodo(householdId, 't1', { text: 'Take the recycling out' });
    expect(mockUpdateDoc).toHaveBeenCalledWith('households/hh1/weeklyTodos/t1', {
      text: 'Take the recycling out',
      updatedAt: 'SERVER_TIMESTAMP',
    });
  });

  it('moves a todo to another day', async () => {
    await updateWeeklyTodo(householdId, 't1', { text: 'Bins', day: 'Thursday' });
    expect(mockUpdateDoc).toHaveBeenCalledWith('households/hh1/weeklyTodos/t1', {
      text: 'Bins',
      day: 'Thursday',
      updatedAt: 'SERVER_TIMESTAMP',
    });
  });

  it('sets a reminder time and its owner', async () => {
    await updateWeeklyTodo(householdId, 't1', { remindTime: '18:30', remindFor: 'u1' });
    expect(mockUpdateDoc).toHaveBeenCalledWith('households/hh1/weeklyTodos/t1', {
      remindTime: '18:30',
      remindFor: 'u1',
      updatedAt: 'SERVER_TIMESTAMP',
    });
  });

  it('removes the field rather than storing null when a reminder is cleared', async () => {
    await updateWeeklyTodo(householdId, 't1', { remindTime: null, remindFor: null });
    expect(mockUpdateDoc).toHaveBeenCalledWith('households/hh1/weeklyTodos/t1', {
      remindTime: 'DELETE_FIELD',
      remindFor: 'DELETE_FIELD',
      updatedAt: 'SERVER_TIMESTAMP',
    });
  });

  it('leaves falsy-but-meaningful values alone', async () => {
    await updateWeeklyTodo(householdId, 't1', { text: '', done: false });
    expect(mockUpdateDoc).toHaveBeenCalledWith('households/hh1/weeklyTodos/t1', {
      text: '',
      done: false,
      updatedAt: 'SERVER_TIMESTAMP',
    });
  });

  it('deletes a todo', async () => {
    await deleteWeeklyTodo(householdId, 't1');
    expect(mockDeleteDoc).toHaveBeenCalledWith('households/hh1/weeklyTodos/t1');
  });
});

describe('body & goals', () => {
  const householdId = 'hh1';

  it('subscribes to one member profile by uid', () => {
    const unsub = jest.fn();
    onSnapshot.mockReturnValue(unsub);
    const cb = jest.fn();
    expect(subscribeBodyProfile(householdId, 'u1', cb)).toBe(unsub);
    expect(onSnapshot.mock.calls[0][0]).toBe('households/hh1/bodyProfiles/u1');

    const onNext = onSnapshot.mock.calls[0][1];
    onNext({ exists: () => true, data: () => ({ heightCm: 180 }) });
    expect(cb).toHaveBeenLastCalledWith({ heightCm: 180 });
    onNext({ exists: () => false });
    expect(cb).toHaveBeenLastCalledWith(null);
  });

  it('forwards profile listener errors', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const onError = jest.fn();
    subscribeBodyProfile(householdId, 'u1', jest.fn(), onError);
    const err = new Error('denied');
    onSnapshot.mock.calls[0][2](err);
    expect(onError).toHaveBeenCalledWith(err);
    console.error.mockRestore();
  });

  it('merges the profile with an updatedAt timestamp', async () => {
    await saveBodyProfile(householdId, 'u1', { heightCm: 180, goal: 'lose' });
    expect(mockSetDoc).toHaveBeenCalledWith(
      'households/hh1/bodyProfiles/u1',
      { heightCm: 180, goal: 'lose', updatedAt: 'SERVER_TIMESTAMP' },
      { merge: true },
    );
  });

  it('queries weight logs with a single uid filter (no composite index)', () => {
    const cb = jest.fn();
    subscribeWeightLogs(householdId, 'u1', cb);
    expect(mockCollection).toHaveBeenCalledWith({}, 'households', 'hh1', 'weightLogs');
    expect(where).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledWith('uid', '==', 'u1');
    expect(orderBy).not.toHaveBeenCalled();

    onSnapshot.mock.calls[0][1]({
      docs: [{ id: 'u1_2026-10-19', data: () => ({ weightKg: 80 }) }],
    });
    expect(cb).toHaveBeenCalledWith([{ id: 'u1_2026-10-19', weightKg: 80 }]);
  });

  it('logs one weigh-in per user per day under a deterministic id', async () => {
    await logWeight(householdId, 'u1', '2026-10-19', 80.5);
    expect(mockSetDoc).toHaveBeenCalledWith('households/hh1/weightLogs/u1_2026-10-19', {
      uid: 'u1',
      date: '2026-10-19',
      weightKg: 80.5,
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    });
  });

  it('deletes a weight log', async () => {
    await deleteWeightLog(householdId, 'u1_2026-10-19');
    expect(mockDeleteDoc).toHaveBeenCalledWith('households/hh1/weightLogs/u1_2026-10-19');
  });
});

describe('light colours', () => {
  const householdId = 'hh1';

  it('splits the lightColors collection into presets and per-device recents', () => {
    const cb = jest.fn();
    subscribeLightColors(householdId, cb);
    expect(mockCollection).toHaveBeenCalledWith({}, 'households', 'hh1', 'lightColors');

    onSnapshot.mock.calls[0][1]({
      docs: [
        { id: 'presets', data: () => ({ colors: ['#FF0000'] }) },
        { id: 'recent_AA:BB', data: () => ({ deviceId: 'AA:BB', colors: ['#00FF00'] }) },
        { id: 'stray', data: () => ({ colors: ['#0000FF'] }) },
      ],
    });
    expect(cb).toHaveBeenCalledWith({
      presets: ['#FF0000'],
      recentsByDevice: { 'AA:BB': ['#00FF00'] },
    });
  });

  it('reports null presets when none are saved yet', () => {
    const cb = jest.fn();
    subscribeLightColors(householdId, cb);
    onSnapshot.mock.calls[0][1]({ docs: [] });
    expect(cb).toHaveBeenCalledWith({ presets: null, recentsByDevice: {} });
  });

  it('saves presets to a fixed doc', async () => {
    await saveLightColorPresets(householdId, ['#FFFFFF']);
    expect(mockSetDoc).toHaveBeenCalledWith('households/hh1/lightColors/presets', {
      colors: ['#FFFFFF'],
      updatedAt: 'SERVER_TIMESTAMP',
    });
  });

  it('saves recents under a per-device doc id, stripping slashes', async () => {
    await saveLightRecentColors(householdId, 'a/b', ['#123456']);
    expect(mockSetDoc).toHaveBeenCalledWith('households/hh1/lightColors/recent_a_b', {
      deviceId: 'a/b',
      colors: ['#123456'],
      updatedAt: 'SERVER_TIMESTAMP',
    });
  });
});

describe('weekly todo carry-over', () => {
  const householdId = 'hh1';

  it('reads one week with a single filter', async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [{ id: 't1', data: () => ({ day: 'Monday', done: false }) }] });
    const todos = await getWeeklyTodos(householdId, '2026-10-12');
    expect(where).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledWith('weekKey', '==', '2026-10-12');
    expect(orderBy).not.toHaveBeenCalled();
    expect(todos).toEqual([{ id: 't1', day: 'Monday', done: false }]);
  });

  it('moves tasks to the new week, tags them and clears reminders in one batch', async () => {
    await carryOverWeeklyTodos(householdId, [{ id: 'a' }, { id: 'b' }], '2026-10-12', '2026-10-19');
    expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
    expect(mockBatchUpdate).toHaveBeenCalledWith('households/hh1/weeklyTodos/a', {
      weekKey: '2026-10-19',
      carriedFrom: '2026-10-12',
      remindTime: 'DELETE_FIELD',
      remindFor: 'DELETE_FIELD',
      updatedAt: 'SERVER_TIMESTAMP',
    });
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('records the dismissal on the private household doc', async () => {
    await dismissTodoCarryOver(householdId, '2026-10-19');
    expect(mockSetDoc).toHaveBeenCalledWith(
      'households/hh1/private/data',
      { carryOverDismissedWeek: '2026-10-19' },
      { merge: true },
    );
  });
});

describe('recurring todos', () => {
  const householdId = 'hh1';

  it('subscribes to all rules without filters', () => {
    const cb = jest.fn();
    subscribeTodoRecurrences(householdId, cb);
    expect(mockCollection).toHaveBeenCalledWith({}, 'households', 'hh1', 'todoRecurrences');
    expect(where).not.toHaveBeenCalled();
    onSnapshot.mock.calls[0][1]({ docs: [{ id: 'r1', data: () => ({ text: 'Bins' }) }] });
    expect(cb).toHaveBeenCalledWith([{ id: 'r1', text: 'Bins' }]);
  });

  it('creates a rule and links the source task in one batch', async () => {
    // doc(collectionRef) → auto-id ref
    mockDoc.mockImplementationOnce(() => ({ id: 'rule1' }));
    const id = await createTodoRecurrence(householdId, { id: 't1', text: 'Bins' }, ['Tuesday'], '2026-10-20');
    expect(id).toBe('rule1');
    expect(mockBatchSet).toHaveBeenCalledWith({ id: 'rule1' }, {
      text: 'Bins',
      days: ['Tuesday'],
      active: true,
      startsOn: '2026-10-20',
      lastMaterializedWeek: null,
      createdAt: 'SERVER_TIMESTAMP',
      updatedAt: 'SERVER_TIMESTAMP',
    });
    expect(mockBatchUpdate).toHaveBeenCalledWith('households/hh1/weeklyTodos/t1', {
      recurrenceId: 'rule1',
      updatedAt: 'SERVER_TIMESTAMP',
    });
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('updates and deletes rules', async () => {
    await updateTodoRecurrence(householdId, 'r1', { active: false });
    expect(mockUpdateDoc).toHaveBeenCalledWith('households/hh1/todoRecurrences/r1', {
      active: false, updatedAt: 'SERVER_TIMESTAMP',
    });
    await deleteTodoRecurrence(householdId, 'r1');
    expect(mockDeleteDoc).toHaveBeenCalledWith('households/hh1/todoRecurrences/r1');
  });

  it('materializes instances and marks rules in one batch', async () => {
    let n = 0;
    mockDoc.mockImplementation((db, ...segments) => (segments.length ? segments.join('/') : `new${++n}`));
    await materializeTodoRecurrences(householdId, '2026-10-19', [
      { rule: { id: 'r1', text: 'Bins' }, day: 'Tuesday' },
      { rule: { id: 'r1', text: 'Bins' }, day: 'Friday' },
    ], ['r1']);
    mockDoc.mockImplementation((db, ...segments) => segments.join('/'));

    expect(mockBatchSet).toHaveBeenCalledTimes(2);
    expect(mockBatchSet).toHaveBeenCalledWith('new1', {
      weekKey: '2026-10-19', day: 'Tuesday', text: 'Bins', done: false,
      recurrenceId: 'r1', createdAt: 'SERVER_TIMESTAMP',
    });
    expect(mockBatchUpdate).toHaveBeenCalledWith('households/hh1/todoRecurrences/r1', {
      lastMaterializedWeek: '2026-10-19',
    });
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });
});

// ── Category overrides & renames ─────────────────────────────────────────────

describe('updateHouseholdCategoryOverrides', () => {
  it('writes only the override maps passed in', async () => {
    await updateHouseholdCategoryOverrides('hh1', {
      pantry: { Baking: { label: 'Bakery' } },
      bill:   { gas: { icon: '🔥' } },
    });
    expect(mockUpdateDoc).toHaveBeenCalledWith('households/hh1', {
      pantryCategoryOverrides: { Baking: { label: 'Bakery' } },
      billCategoryOverrides:   { gas: { icon: '🔥' } },
    });
  });

  it('maps every kind to its field and writes {} for a cleared map', async () => {
    await updateHouseholdCategoryOverrides('hh1', { pantry: null, nonFood: {}, bill: {}, expense: {} });
    expect(mockUpdateDoc).toHaveBeenCalledWith('households/hh1', {
      pantryCategoryOverrides: {}, nonFoodCategoryOverrides: {},
      billCategoryOverrides: {}, expenseCategoryOverrides: {},
    });
  });

  it('skips the write when there is nothing known to update', async () => {
    await updateHouseholdCategoryOverrides('hh1', { bogus: {} });
    await updateHouseholdCategoryOverrides('hh1', {});
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});

describe('renameItemCategories', () => {
  // docs[collection][label] = ids stored with that category
  const setup = (docs) => {
    query.mockImplementation((col, w) => ({ col, value: w.value }));
    where.mockImplementation((field, op, value) => ({ field, op, value }));
    mockGetDocs.mockImplementation(async ({ col, value }) => {
      const name = col.split('/').pop();
      const ids = docs[name]?.[value] ?? [];
      return { docs: ids.map((id) => ({ ref: `${col}/${id}` })) };
    });
  };
  afterEach(() => { query.mockReset(); where.mockReset(); mockGetDocs.mockReset(); });

  it('covers pantry, grocery, price and alias docs', () => {
    expect(CATEGORY_LABEL_COLLECTIONS).toEqual(['pantryItems', 'groceryItems', 'priceEntries', 'receiptAliases']);
  });

  it('does nothing for an empty or no-op list', async () => {
    expect(await renameItemCategories('hh1', [])).toBe(0);
    expect(await renameItemCategories('hh1', undefined)).toBe(0);
    expect(await renameItemCategories('hh1', [{ from: 'A', to: 'A' }])).toBe(0);
    expect(mockGetDocs).not.toHaveBeenCalled();
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it('queries each collection by the old label and updates matches', async () => {
    setup({ pantryItems: { Baking: ['p1'] }, groceryItems: { Baking: ['g1', 'g2'] }, priceEntries: {}, receiptAliases: { Baking: ['a1'] } });
    const n = await renameItemCategories('hh1', [{ from: 'Baking', to: 'Bakery' }]);
    expect(n).toBe(4);
    expect(where).toHaveBeenCalledWith('category', '==', 'Baking');
    expect(mockGetDocs).toHaveBeenCalledTimes(4);
    expect(mockBatchUpdate).toHaveBeenCalledWith('households/hh1/pantryItems/p1', { category: 'Bakery' });
    expect(mockBatchUpdate).toHaveBeenCalledWith('households/hh1/groceryItems/g2', { category: 'Bakery' });
    expect(mockBatchUpdate).toHaveBeenCalledWith('households/hh1/receiptAliases/a1', { category: 'Bakery' });
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('resolves a swap without cascading', async () => {
    setup({ pantryItems: { A: ['x'], B: ['y'] } });
    await renameItemCategories('hh1', [{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }]);
    expect(mockBatchUpdate).toHaveBeenCalledWith('households/hh1/pantryItems/x', { category: 'B' });
    expect(mockBatchUpdate).toHaveBeenCalledWith('households/hh1/pantryItems/y', { category: 'A' });
    expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
  });

  it('commits nothing when no docs match', async () => {
    setup({});
    expect(await renameItemCategories('hh1', [{ from: 'A', to: 'B' }])).toBe(0);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('splits large renames across batches', async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `p${i}`);
    setup({ pantryItems: { A: ids } });
    expect(await renameItemCategories('hh1', [{ from: 'A', to: 'B' }])).toBe(1000);
    expect(mockBatchCommit).toHaveBeenCalledTimes(3); // 450 + 450 + 100
    expect(mockBatchUpdate).toHaveBeenCalledTimes(1000);
  });

  it('propagates a read failure without writing', async () => {
    setup({});
    mockGetDocs.mockRejectedValue(new Error('denied'));
    await expect(renameItemCategories('hh1', [{ from: 'A', to: 'B' }])).rejects.toThrow('denied');
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });
});
