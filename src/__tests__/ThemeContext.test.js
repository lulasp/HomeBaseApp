jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { Text, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider, useTheme } from '../context/ThemeContext';

function ThemeTestHarness() {
  const ctx = useTheme();
  return (
    <TouchableOpacity testID="toggle" onPress={ctx.toggleTheme}>
      <Text testID="theme">{ctx.theme}</Text>
    </TouchableOpacity>
  );
}

function renderTheme() {
  return render(
    <ThemeProvider>
      <ThemeTestHarness />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  AsyncStorage.setItem.mockResolvedValue(undefined);
});

describe('ThemeContext', () => {
  it('defaults to dark theme before AsyncStorage resolves', async () => {
    AsyncStorage.getItem.mockResolvedValue(null);
    renderTheme();
    await waitFor(() => expect(screen.getByTestId('theme').props.children).toBe('dark'));
  });

  it('loads saved light theme from AsyncStorage', async () => {
    AsyncStorage.getItem.mockResolvedValue('light');
    renderTheme();
    await waitFor(() => expect(screen.getByTestId('theme').props.children).toBe('light'));
  });

  it('keeps dark theme when AsyncStorage returns null', async () => {
    AsyncStorage.getItem.mockResolvedValue(null);
    renderTheme();
    await waitFor(() => expect(screen.getByTestId('theme').props.children).toBe('dark'));
  });

  it('ignores invalid values from AsyncStorage', async () => {
    AsyncStorage.getItem.mockResolvedValue('invalid');
    renderTheme();
    await waitFor(() => expect(screen.getByTestId('theme').props.children).toBe('dark'));
  });

  it('toggleTheme switches dark → light', async () => {
    AsyncStorage.getItem.mockResolvedValue('dark');
    renderTheme();
    await waitFor(() => expect(screen.getByTestId('theme').props.children).toBe('dark'));

    fireEvent.press(screen.getByTestId('toggle'));

    await waitFor(() => expect(screen.getByTestId('theme').props.children).toBe('light'));
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('@homebase_theme', 'light');
  });

  it('toggleTheme switches light → dark', async () => {
    AsyncStorage.getItem.mockResolvedValue('light');
    renderTheme();
    await waitFor(() => expect(screen.getByTestId('theme').props.children).toBe('light'));

    fireEvent.press(screen.getByTestId('toggle'));

    await waitFor(() => expect(screen.getByTestId('theme').props.children).toBe('dark'));
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('@homebase_theme', 'dark');
  });

  it('renders without errors and exposes theme text node', async () => {
    AsyncStorage.getItem.mockResolvedValue(null);
    renderTheme();
    await waitFor(() => expect(screen.getByTestId('theme')).toBeTruthy());
  });
});
