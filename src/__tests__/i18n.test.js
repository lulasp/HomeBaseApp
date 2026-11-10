import {
  translate, pickLanguage, isSupportedLanguage, setCurrentLanguage,
  getCurrentLanguage, t, LANGUAGES, DEFAULT_LANGUAGE,
} from '../i18n';
import en from '../i18n/en';
import pt from '../i18n/pt';

// Flatten { a: { b: 'x' } } to { 'a.b': 'x' }.
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const placeholders = (text) => [...String(text).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

describe('dictionaries', () => {
  const enFlat = flatten(en);
  const ptFlat = flatten(pt);

  it('Portuguese has exactly the English keys', () => {
    expect(Object.keys(ptFlat).sort()).toEqual(Object.keys(enFlat).sort());
  });

  it('every value is a non-empty string', () => {
    for (const [key, value] of [...Object.entries(enFlat), ...Object.entries(ptFlat)]) {
      expect([key, typeof value, String(value).trim().length > 0]).toEqual([key, 'string', true]);
    }
  });

  it('keeps the same {{placeholders}} in both languages', () => {
    for (const key of Object.keys(enFlat)) {
      expect([key, placeholders(ptFlat[key])]).toEqual([key, placeholders(enFlat[key])]);
    }
  });

  it('lists English and Portuguese', () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(['en', 'pt']);
    expect(DEFAULT_LANGUAGE).toBe('en');
  });
});

describe('translate', () => {
  it('looks up a nested key in the requested language', () => {
    expect(translate('en', 'common.cancel')).toBe('Cancel');
    expect(translate('pt', 'common.cancel')).toBe('Cancelar');
  });

  it('fills {{placeholders}} and leaves unknown ones untouched', () => {
    expect(translate('en', 'profile.editHousehold', { name: 'Casa' })).toBe('Edit Casa');
    expect(translate('en', 'profile.editHousehold')).toBe('Edit {{name}}');
  });

  it('falls back to English for an unknown language', () => {
    expect(translate('fr', 'common.cancel')).toBe('Cancel');
  });

  it('returns the key when no language has it', () => {
    expect(translate('pt', 'nope.missing')).toBe('nope.missing');
    expect(translate('en', 'common')).toBe('common');
  });

  it('uses _one / _other variants when count is given', () => {
    // No plural variants for this key: the plain key is used.
    expect(translate('en', 'ai.loadFromPantry', { count: 1 })).toBe('Load from my pantry (1 items)');
  });
});

describe('pickLanguage', () => {
  it('picks the first supported language from locale tags', () => {
    expect(pickLanguage(['pt-PT'])).toBe('pt');
    expect(pickLanguage(['pt_BR'])).toBe('pt');
    expect(pickLanguage(['fr-FR', 'pt-PT', 'en'])).toBe('pt');
    expect(pickLanguage(['en-GB', 'pt-PT'])).toBe('en');
  });

  it('defaults to English for unsupported or empty input', () => {
    expect(pickLanguage(['fr-FR', 'de'])).toBe('en');
    expect(pickLanguage([])).toBe('en');
    expect(pickLanguage()).toBe('en');
    expect(pickLanguage([null, ''])).toBe('en');
  });
});

describe('isSupportedLanguage', () => {
  it('accepts only known codes', () => {
    expect(isSupportedLanguage('en')).toBe(true);
    expect(isSupportedLanguage('pt')).toBe(true);
    expect(isSupportedLanguage('fr')).toBe(false);
    expect(isSupportedLanguage('toString')).toBe(false);
    expect(isSupportedLanguage(null)).toBe(false);
  });
});

describe('module-level t', () => {
  afterEach(() => setCurrentLanguage('en'));

  it('follows the current language', () => {
    setCurrentLanguage('pt');
    expect(getCurrentLanguage()).toBe('pt');
    expect(t('common.delete')).toBe('Eliminar');
  });

  it('ignores unsupported codes', () => {
    setCurrentLanguage('xx');
    expect(getCurrentLanguage()).toBe('en');
    expect(t('common.delete')).toBe('Delete');
  });
});
