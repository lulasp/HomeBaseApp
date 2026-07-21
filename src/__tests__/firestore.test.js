// Mock Firebase so tests don't need a real Firestore connection.
jest.mock('../config/firebase', () => ({ db: {} }));

const mockDeleteDoc = jest.fn().mockResolvedValue(undefined);
const mockUpdateDoc = jest.fn().mockResolvedValue(undefined);
const mockGetDoc = jest.fn();
const mockGetDocs = jest.fn();
const mockDoc = jest.fn((db, ...segments) => segments.join('/'));
const mockCollection = jest.fn((db, ...segments) => segments.join('/'));
const mockAddDoc = jest.fn().mockResolvedValue({ id: 'new-id' });
const mockServerTimestamp = jest.fn(() => 'SERVER_TIMESTAMP');
const mockDeleteField = jest.fn(() => 'DELETE_FIELD');
const mockBatchSet = jest.fn();
const mockBatchCommit = jest.fn().mockResolvedValue(undefined);
const mockWriteBatch = jest.fn(() => ({ set: mockBatchSet, commit: mockBatchCommit }));

jest.mock('firebase/firestore', () => ({
  collection: (...args) => mockCollection(...args),
  doc: (...args) => mockDoc(...args),
  addDoc: (...args) => mockAddDoc(...args),
  updateDoc: (...args) => mockUpdateDoc(...args),
  deleteDoc: (...args) => mockDeleteDoc(...args),
  getDocs: (...args) => mockGetDocs(...args),
  getDoc: (...args) => mockGetDoc(...args),
  setDoc: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  onSnapshot: jest.fn(),
  serverTimestamp: () => mockServerTimestamp(),
  deleteField: () => mockDeleteField(),
  writeBatch: (...args) => mockWriteBatch(...args),
}));

import {
  clearCheckedItems,
  deleteGroceryItem,
  deductPantryIngredients,
  getGroceryItems,
  updateHouseholdUnits,
  addExpensesBatch,
  updateHouseholdOpenRouterApiKey,
  updateHouseholdAiModel,
} from '../services/firestore';

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

  it('trims and stores the key', async () => {
    await updateHouseholdOpenRouterApiKey(householdId, '  sk-or-abc  ');
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.anything(),
      { openRouterApiKey: 'sk-or-abc' },
    );
  });

  it('deletes the field when cleared', async () => {
    await updateHouseholdOpenRouterApiKey(householdId, '');
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.anything(),
      { openRouterApiKey: 'DELETE_FIELD' },
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
