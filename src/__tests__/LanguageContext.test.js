import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LanguageProvider, useLanguage } from '../context/LanguageContext';
import { getCurrentLanguage, setCurrentLanguage } from '../i18n';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
}));

function Probe() {
  const { language, setLanguage, t } = useLanguage();
  return (
    <>
      <Text testID="lang">{language}</Text>
      <Text testID="text">{t('common.cancel')}</Text>
      <TouchableOpacity testID="to-pt" onPress={() => setLanguage('pt')} />
      <TouchableOpacity testID="to-bad" onPress={() => setLanguage('xx')} />
    </>
  );
}

afterEach(() => {
  jest.clearAllMocks();
  setCurrentLanguage('en');
});

describe('LanguageProvider', () => {
  it('uses the saved language over the device language', async () => {
    AsyncStorage.getItem.mockResolvedValueOnce('pt');
    await render(<LanguageProvider><Probe /></LanguageProvider>);
    await waitFor(() => expect(screen.getByTestId('lang').props.children).toBe('pt'));
    expect(screen.getByTestId('text').props.children).toBe('Cancelar');
    expect(getCurrentLanguage()).toBe('pt');
  });

  it('ignores an unsupported saved value', async () => {
    AsyncStorage.getItem.mockResolvedValueOnce('fr');
    await render(<LanguageProvider><Probe /></LanguageProvider>);
    await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalled());
    expect(['en', 'pt']).toContain(screen.getByTestId('lang').props.children);
  });

  it('switches language, saves it and updates the module-level language', async () => {
    await render(<LanguageProvider><Probe /></LanguageProvider>);
    await fireEvent.press(screen.getByTestId('to-pt'));
    expect(screen.getByTestId('lang').props.children).toBe('pt');
    expect(screen.getByTestId('text').props.children).toBe('Cancelar');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('@homebase_language', 'pt');
    expect(getCurrentLanguage()).toBe('pt');
  });

  it('falls back to English when asked for an unsupported language', async () => {
    await render(<LanguageProvider><Probe /></LanguageProvider>);
    await fireEvent.press(screen.getByTestId('to-pt'));
    await fireEvent.press(screen.getByTestId('to-bad'));
    expect(screen.getByTestId('lang').props.children).toBe('en');
    expect(AsyncStorage.setItem).toHaveBeenLastCalledWith('@homebase_language', 'en');
  });
});

describe('useLanguage outside a provider', () => {
  it('returns English', async () => {
    await render(<Probe />);
    expect(screen.getByTestId('lang').props.children).toBe('en');
    expect(screen.getByTestId('text').props.children).toBe('Cancel');
  });
});
