import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_LANGUAGE, detectDeviceLanguage, isSupportedLanguage,
  setCurrentLanguage, translate,
} from '../i18n';

const LANGUAGE_STORAGE_KEY = '@homebase_language';

const LanguageContext = createContext(null);

// Each person's language, saved on their device. Until they pick one, the app
// follows the phone or browser language (English unless it is Portuguese).
export const LanguageProvider = ({ children }) => {
  const [language, setLanguageState] = useState(() => {
    const detected = detectDeviceLanguage();
    setCurrentLanguage(detected);
    return detected;
  });

  useEffect(() => {
    AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)
      .then((saved) => {
        if (isSupportedLanguage(saved)) {
          setCurrentLanguage(saved);
          setLanguageState(saved);
        }
      })
      .catch(() => {});
  }, []);

  const setLanguage = useCallback(async (code) => {
    const next = isSupportedLanguage(code) ? code : DEFAULT_LANGUAGE;
    setCurrentLanguage(next);
    setLanguageState(next);
    try { await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, next); } catch {}
  }, []);

  const value = useMemo(() => ({
    language,
    setLanguage,
    t: (key, params) => translate(language, key, params),
  }), [language, setLanguage]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

// Outside a provider (isolated component tests) this falls back to English.
const FALLBACK = {
  language: DEFAULT_LANGUAGE,
  setLanguage: () => {},
  t: (key, params) => translate(DEFAULT_LANGUAGE, key, params),
};

export const useLanguage = () => useContext(LanguageContext) || FALLBACK;
