// Mock the auth context and the private-doc subscription so we can drive the
// resolved integration flags directly.
const mockUseAuth = jest.fn();
jest.mock('../context/AuthContext', () => ({ useAuth: () => mockUseAuth() }));

const mockSubscribe = jest.fn();
jest.mock('../services/firestore', () => ({
  subscribeHouseholdPrivate: (...args) => mockSubscribe(...args),
}));

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { HouseholdProvider, useHousehold } from '../context/HouseholdContext';

function Harness() {
  const { goveeEnabled, xiaomiEnabled } = useHousehold();
  return <Text testID="flags">{`${goveeEnabled}:${xiaomiEnabled}`}</Text>;
}

// Render with the private doc resolving to `priv`.
function renderWith(priv) {
  mockUseAuth.mockReturnValue({ householdId: 'hh1' });
  mockSubscribe.mockImplementation((_id, cb) => { cb(priv); return jest.fn(); });
  return render(
    <HouseholdProvider>
      <Harness />
    </HouseholdProvider>,
  );
}

beforeEach(() => jest.clearAllMocks());

describe('HouseholdContext integration flags', () => {
  it('defaults to enabled when configured but no explicit flag', async () => {
    renderWith({ goveeApiKey: 'key', xiaomiCreds: { userId: '1' } });
    await waitFor(() => expect(screen.getByTestId('flags').props.children).toBe('true:true'));
  });

  it('defaults to disabled when nothing is configured', async () => {
    renderWith({});
    await waitFor(() => expect(screen.getByTestId('flags').props.children).toBe('false:false'));
  });

  it('an explicit false wins over an existing key', async () => {
    renderWith({ goveeApiKey: 'key', goveeEnabled: false, xiaomiCreds: { userId: '1' }, xiaomiEnabled: false });
    await waitFor(() => expect(screen.getByTestId('flags').props.children).toBe('false:false'));
  });

  it('an explicit true wins with no config', async () => {
    renderWith({ goveeEnabled: true, xiaomiEnabled: true });
    await waitFor(() => expect(screen.getByTestId('flags').props.children).toBe('true:true'));
  });

  it('resolves both disabled when there is no active household', async () => {
    mockUseAuth.mockReturnValue({ householdId: null });
    render(
      <HouseholdProvider>
        <Harness />
      </HouseholdProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('flags').props.children).toBe('false:false'));
    expect(mockSubscribe).not.toHaveBeenCalled();
  });
});
