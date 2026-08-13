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
  setDoc: (...args) => mockSetDoc(...args),
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
} from '../services/firestore';
import { onSnapshot } from 'firebase/firestore';

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
