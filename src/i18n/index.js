// App translations. English is the source language; Portuguese is European
// Portuguese (pt-PT). Strings live in `en.js` / `pt.js` as nested objects and
// are looked up by dot path: t('profile.title').
//
//   t('bills.count', { count: 3 })  → tries 'bills.count_one' / 'bills.count_other'
//   t('greeting', { name: 'Ana' })  → replaces {{name}}
//
// A missing Portuguese string falls back to English, then to the key itself.
// Dates and money keep their existing formatting regardless of language.

import { Platform } from 'react-native';
import en from './en';
import pt from './pt';

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'pt', label: 'Português' },
];

export const DEFAULT_LANGUAGE = 'en';

const DICTIONARIES = { en, pt };

export const isSupportedLanguage = (code) =>
  typeof code === 'string' && Object.prototype.hasOwnProperty.call(DICTIONARIES, code);

// First supported language in a list of locale tags ('pt-PT', 'en_US', 'pt'),
// else English.
export function pickLanguage(locales = []) {
  for (const tag of locales) {
    const base = String(tag || '').toLowerCase().split(/[-_]/)[0];
    if (isSupportedLanguage(base)) return base;
  }
  return DEFAULT_LANGUAGE;
}

// The phone's or browser's preferred languages, best first.
export function deviceLocales() {
  try {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
      return [...(navigator.languages || []), navigator.language].filter(Boolean);
    }
    return [Intl.DateTimeFormat().resolvedOptions().locale].filter(Boolean);
  } catch {
    return [];
  }
}

export const detectDeviceLanguage = () => pickLanguage(deviceLocales());

function lookup(dict, key) {
  let node = dict;
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

const interpolate = (text, params) => text.replace(
  /\{\{(\w+)\}\}/g,
  (match, name) => (params[name] != null ? String(params[name]) : match),
);

// Translate `key` into `language`. Pure: used by the context and by tests.
export function translate(language, key, params = {}) {
  const dicts = [DICTIONARIES[language], DICTIONARIES[DEFAULT_LANGUAGE]].filter(Boolean);
  const candidates = params.count != null
    ? [`${key}_${Number(params.count) === 1 ? 'one' : 'other'}`, key]
    : [key];
  for (const dict of dicts) {
    for (const candidate of candidates) {
      const text = lookup(dict, candidate);
      if (text != null) return interpolate(text, params);
    }
  }
  return key;
}

// The active language for code outside React (utils, services). Kept in sync by
// LanguageProvider; components should use useLanguage().t so they re-render.
let currentLanguage = DEFAULT_LANGUAGE;
export const setCurrentLanguage = (code) => {
  currentLanguage = isSupportedLanguage(code) ? code : DEFAULT_LANGUAGE;
};
export const getCurrentLanguage = () => currentLanguage;
export const t = (key, params) => translate(currentLanguage, key, params);
