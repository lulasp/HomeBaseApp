import {
  DATE_FORMATS, CURRENCIES, DEFAULT_DATE_FORMAT, DEFAULT_CURRENCY,
  setFormatSettings, getFormatSettings,
  formatNumber, formatMoney, formatMoneyCompact, currencySymbol, currencySymbolAfter,
  formatDate, formatLocalized, formatMonthYear, formatMonthShort, formatMonthKey, dayName,
} from '../utils/format';
import { setCurrentLanguage } from '../i18n';

afterEach(() => {
  setFormatSettings({});
  setCurrentLanguage('en');
});

describe('settings', () => {
  it('defaults to day/month dates and dollars', () => {
    expect(getFormatSettings()).toEqual({ dateFormat: DEFAULT_DATE_FORMAT, currency: DEFAULT_CURRENCY });
    expect(DEFAULT_DATE_FORMAT).toBe('dmy');
    expect(DEFAULT_CURRENCY).toBe('USD');
  });

  it('offers four date formats and three currencies', () => {
    expect(DATE_FORMATS.map((f) => f.key)).toEqual(['dmy', 'mdy', 'iso', 'long']);
    expect(CURRENCIES.map((c) => c.code)).toEqual(['EUR', 'USD', 'BRL']);
  });

  it('falls back to defaults for unknown values', () => {
    setFormatSettings({ dateFormat: 'nope', currency: 'GBP' });
    expect(getFormatSettings()).toEqual({ dateFormat: 'dmy', currency: 'USD' });
  });

  it('each date format example matches what it formats', () => {
    for (const f of DATE_FORMATS) {
      expect(formatDate('2026-11-10', { dateFormat: f.key })).toBe(f.example);
    }
  });
});

describe('formatNumber', () => {
  it('groups thousands with the currency separators', () => {
    expect(formatNumber(1234567.891, { currency: 'USD' })).toBe('1,234,567.89');
    expect(formatNumber(1234567.891, { currency: 'EUR' })).toBe('1.234.567,89');
    expect(formatNumber(999, { currency: 'EUR', decimals: 0 })).toBe('999');
  });

  it('treats bad input as zero and drops the sign', () => {
    expect(formatNumber(null)).toBe('0.00');
    expect(formatNumber('abc')).toBe('0.00');
    expect(formatNumber(-5)).toBe('5.00');
  });
});

describe('formatMoney', () => {
  it.each([
    ['USD', 1234.5, '$1,234.50'],
    ['EUR', 1234.5, '1.234,50 €'],
    ['BRL', 1234.5, 'R$ 1.234,50'],
  ])('%s', (currency, n, out) => {
    expect(formatMoney(n, { currency })).toBe(out);
  });

  it('uses the household currency by default', () => {
    expect(formatMoney(2)).toBe('$2.00');
    setFormatSettings({ currency: 'EUR' });
    expect(formatMoney(2)).toBe('2,00 €');
  });

  it('marks negatives and respects decimals', () => {
    expect(formatMoney(-12.5, { currency: 'EUR' })).toBe('-12,50 €');
    expect(formatMoney(0.005, { currency: 'USD', decimals: 3 })).toBe('$0.005');
    expect(formatMoney(-0.001, { currency: 'USD' })).toBe('$0.00');
    expect(formatMoney(undefined, { currency: 'USD' })).toBe('$0.00');
  });
});

describe('formatMoneyCompact', () => {
  it('shortens thousands', () => {
    expect(formatMoneyCompact(1250, { currency: 'USD' })).toBe('$1.3k');
    expect(formatMoneyCompact(1250, { currency: 'EUR' })).toBe('1,3k €');
    expect(formatMoneyCompact(2000, { currency: 'BRL' })).toBe('R$ 2k');
    expect(formatMoneyCompact(-1500, { currency: 'USD' })).toBe('-$1.5k');
  });

  it('rounds smaller amounts to whole units', () => {
    expect(formatMoneyCompact(980.4, { currency: 'USD' })).toBe('$980');
    expect(formatMoneyCompact(980.4, { currency: 'EUR' })).toBe('980 €');
  });
});

describe('currency symbol', () => {
  it('knows the symbol and its side', () => {
    expect(currencySymbol('EUR')).toBe('€');
    expect(currencySymbolAfter('EUR')).toBe(true);
    expect(currencySymbol('BRL')).toBe('R$');
    expect(currencySymbolAfter('USD')).toBe(false);
    setFormatSettings({ currency: 'BRL' });
    expect(currencySymbol()).toBe('R$');
  });
});

describe('formatDate', () => {
  const d = new Date(2026, 10, 10);

  it('uses the household format, with a short form without the year', () => {
    expect(formatDate(d)).toBe('10/11/2026');
    expect(formatDate(d, { short: true })).toBe('10/11');
    setFormatSettings({ dateFormat: 'mdy' });
    expect(formatDate(d)).toBe('11/10/2026');
    expect(formatDate(d, { short: true })).toBe('11/10');
    setFormatSettings({ dateFormat: 'iso' });
    expect(formatDate(d)).toBe('2026-11-10');
    expect(formatDate(d, { short: true })).toBe('11-10');
  });

  it('writes month names in the person’s language for the long format', () => {
    setFormatSettings({ dateFormat: 'long' });
    expect(formatDate(d)).toBe('10 Nov 2026');
    setCurrentLanguage('pt');
    expect(formatDate(d)).toBe('10 nov 2026');
    expect(formatDate(d, { short: true })).toBe('10 nov');
  });

  it('reads yyyy-MM-dd strings as calendar days and Firestore timestamps', () => {
    expect(formatDate('2026-01-31')).toBe('31/01/2026');
    expect(formatDate({ toDate: () => d })).toBe('10/11/2026');
  });

  it('returns an empty string for missing or invalid dates', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate('')).toBe('');
    expect(formatDate('not a date')).toBe('');
    expect(formatLocalized('nope', 'MMM')).toBe('');
  });
});

describe('month and day names', () => {
  it('formats month headings and short months', () => {
    const d = new Date(2026, 10, 1);
    expect(formatMonthYear(d)).toBe('November 2026');
    expect(formatMonthShort(d)).toBe('Nov');
    expect(formatMonthKey('2026-11')).toBe('November 2026');
    expect(formatMonthKey('junk')).toBe('junk');
    setCurrentLanguage('pt');
    expect(formatMonthYear(d)).toBe('Novembro 2026');
    expect(formatMonthShort(d)).toBe('nov');
    expect(formatLocalized(d, 'EEEE')).toBe('domingo');
  });

  it('translates stored English weekday names', () => {
    expect(dayName('Monday')).toBe('Monday');
    expect(dayName('Monday', { short: true })).toBe('Mon');
    expect(dayName('Sun', { short: true })).toBe('Sun');
    setCurrentLanguage('pt');
    expect(dayName('Monday')).toBe('Segunda-feira');
    expect(dayName('Saturday', { short: true })).toBe('Sáb');
    expect(dayName('Someday')).toBe('Someday');
  });
});
