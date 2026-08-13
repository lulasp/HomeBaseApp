jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { Text, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FabPositionProvider, useFabPosition } from '../context/FabPositionContext';

const STORAGE_KEY = '@homebase_fab_corner';

function Harness({ target = 'topLeft' }) {
  const { corner, setCorner } = useFabPosition();
  return (
    <TouchableOpacity testID="set" onPress={() => setCorner(target)}>
      <Text testID="corner">{corner}</Text>
    </TouchableOpacity>
  );
}

function renderFab(props) {
  return render(
    <FabPositionProvider>
      <Harness {...props} />
    </FabPositionProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  AsyncStorage.setItem.mockResolvedValue(undefined);
});

describe('FabPositionContext', () => {
  it('defaults to bottomRight when nothing is stored', async () => {
    AsyncStorage.getItem.mockResolvedValue(null);
    renderFab();
    await waitFor(() => expect(screen.getByTestId('corner').props.children).toBe('bottomRight'));
  });

  it('loads a saved corner from AsyncStorage', async () => {
    AsyncStorage.getItem.mockResolvedValue('topLeft');
    renderFab();
    await waitFor(() => expect(screen.getByTestId('corner').props.children).toBe('topLeft'));
  });

  it('ignores invalid stored values', async () => {
    AsyncStorage.getItem.mockResolvedValue('middle');
    renderFab();
    await waitFor(() => expect(screen.getByTestId('corner').props.children).toBe('bottomRight'));
  });

  it('setCorner updates and persists a valid corner', async () => {
    AsyncStorage.getItem.mockResolvedValue(null);
    renderFab({ target: 'topRight' });
    await waitFor(() => expect(screen.getByTestId('corner').props.children).toBe('bottomRight'));

    fireEvent.press(screen.getByTestId('set'));

    await waitFor(() => expect(screen.getByTestId('corner').props.children).toBe('topRight'));
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'topRight');
  });

  it('setCorner ignores an invalid corner and does not persist', async () => {
    AsyncStorage.getItem.mockResolvedValue(null);
    renderFab({ target: 'nope' });
    await waitFor(() => expect(screen.getByTestId('corner').props.children).toBe('bottomRight'));

    fireEvent.press(screen.getByTestId('set'));

    await waitFor(() => expect(screen.getByTestId('corner').props.children).toBe('bottomRight'));
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });
});
