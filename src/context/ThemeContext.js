import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { darkColors, lightColors, makeShadows } from '../theme/colors';

const THEME_STORAGE_KEY = '@homebase_theme';

const ThemeContext = createContext(null);

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    AsyncStorage.getItem(THEME_STORAGE_KEY).then((saved) => {
      if (saved === 'light' || saved === 'dark') setTheme(saved);
    });
  }, []);

  const toggleTheme = async () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    await AsyncStorage.setItem(THEME_STORAGE_KEY, next);
  };

  const colors = theme === 'dark' ? darkColors : lightColors;
  const shadow = makeShadows(theme === 'dark');

  return (
    <ThemeContext.Provider value={{ theme, colors, shadow, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
