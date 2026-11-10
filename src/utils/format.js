// Household date and money formatting. The household picks a date format and a
// currency (Household settings → Date & currency); month and day names follow
// each person's language. Amounts are never converted — the currency only
// changes the symbol and the number style.
//
// Like src/i18n, the active settings live at module level (kept in sync by
// HouseholdProvider) so utils and callbacks can format without a hook.
// Components call useFormat() so they re-render when a setting changes.

import { format as fnsFormat, isValid, parseISO } from 'date-fns';
import { enUS, pt } from 'date-fns/locale';
import { getCurrentLanguage } from '../i18n';

// `full` and `short` (no year) are date-fns patterns. `example` is 10 Nov 2026.
export const DATE_FORMATS = [
  { key: 'dmy',  full: 'dd/MM/yyyy', short: 'dd/MM', example: '10/11/2026' },
  { key: 'mdy',  full: 'MM/dd/yyyy', short: 'MM/dd', example: '11/10/2026' },
  { key: 'iso',  full: 'yyyy-MM-dd', short: 'MM-dd', example: '2026-11-10' },
  { key: 'long', full: 'd MMM yyyy', short: 'd MMM', example: '10 Nov 2026' },
];

export const CURRENCIES = [
  { code: 'EUR', symbol: '€',  symbolAfter: true,  space: true,  group: '.', decimal: ',' },
  { code: 'USD', symbol: '$',  symbolAfter: false, space: false, group: ',', decimal: '.' },
  { code: 'BRL', symbol: 'R$', symbolAfter: false, space: true,  group: '.', decimal: ',' },
];

export const DEFAULT_DATE_FORMAT = 'dmy';
// Amounts were shown in dollars before this setting existed.
export const DEFAULT_CURRENCY = 'USD';

const dateFormatOf = (key) => DATE_FORMATS.find((f) => f.key === key) ?? DATE_FORMATS[0];
const currencyOf = (code) => CURRENCIES.find((c) => c.code === code)
  ?? CURRENCIES.find((c) => c.code === DEFAULT_CURRENCY);

let settings = { dateFormat: DEFAULT_DATE_FORMAT, currency: DEFAULT_CURRENCY };

export function setFormatSettings({ dateFormat, currency } = {}) {
  settings = {
    dateFormat: dateFormatOf(dateFormat).key,
    currency: currencyOf(currency).code,
  };
}
export const getFormatSettings = () => settings;

// ── Money ────────────────────────────────────────────────────────────────────

// 1234.5 → '1.234,50' with the currency's separators.
export function formatNumber(n, { decimals = 2, currency = settings.currency } = {}) {
  const cur = currencyOf(currency);
  const v = Number(n);
  const fixed = Math.abs(Number.isFinite(v) ? v : 0).toFixed(decimals);
  const [int, frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, cur.group);
  return frac ? `${grouped}${cur.decimal}${frac}` : grouped;
}

const withSymbol = (cur, digits) => {
  const gap = cur.space ? ' ' : '';
  return cur.symbolAfter ? `${digits}${gap}${cur.symbol}` : `${cur.symbol}${gap}${digits}`;
};

// '1.234,56 €', '$1,234.56', 'R$ 1.234,56'. A negative amount gets a leading '-'.
export function formatMoney(n, { decimals = 2, currency = settings.currency } = {}) {
  const cur = currencyOf(currency);
  const v = Number(n) || 0;
  const sign = v < 0 && Number(Math.abs(v).toFixed(decimals)) !== 0 ? '-' : '';
  return sign + withSymbol(cur, formatNumber(v, { decimals, currency }));
}

// Tight spaces (chart labels): '$1.2k', '1,2k €', '$980'.
export function formatMoneyCompact(n, { currency = settings.currency } = {}) {
  const cur = currencyOf(currency);
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) {
    const k = (Math.abs(v) / 1000).toFixed(1).replace(/\.0$/, '').replace('.', cur.decimal);
    return (v < 0 ? '-' : '') + withSymbol(cur, `${k}k`);
  }
  return formatMoney(Math.round(v), { decimals: 0, currency });
}

export const currencySymbol = (currency = settings.currency) => currencyOf(currency).symbol;
export const currencySymbolAfter = (currency = settings.currency) => currencyOf(currency).symbolAfter;

// ── Dates ────────────────────────────────────────────────────────────────────

const localeFor = (language = getCurrentLanguage()) => (language === 'pt' ? pt : enUS);

const toDate = (value) => {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    // 'yyyy-MM-dd' is a calendar day; parse it as local midnight, not UTC.
    const d = parseISO(value);
    return d;
  }
  if (value?.toDate) return value.toDate();   // Firestore Timestamp
  return new Date(value);
};

// The household's date format. `short` drops the year ('10/11', '10 Nov').
export function formatDate(value, { short = false, dateFormat = settings.dateFormat } = {}) {
  if (value == null || value === '') return '';
  const d = toDate(value);
  if (!isValid(d)) return '';
  const f = dateFormatOf(dateFormat);
  return fnsFormat(d, short ? f.short : f.full, { locale: localeFor() });
}

// A date-fns pattern with month and day names in the person's language.
// Use for names (month headings, weekdays); use formatDate for calendar dates.
export function formatLocalized(value, pattern) {
  const d = toDate(value);
  if (!isValid(d)) return '';
  return fnsFormat(d, pattern, { locale: localeFor() });
}

const capitalise = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// 'November 2026' / 'Novembro 2026'. Portuguese month names are lower case
// mid-sentence, so headings are capitalised.
export const formatMonthYear = (value) => capitalise(formatLocalized(value, 'MMMM yyyy'));

// 'Nov' / 'nov' — chart axes and compact labels.
export const formatMonthShort = (value) => formatLocalized(value, 'MMM');

// A 'yyyy-MM' key as a month heading.
export function formatMonthKey(key) {
  const [y, m] = String(key).split('-').map(Number);
  if (!y || !m) return String(key);
  return formatMonthYear(new Date(y, m - 1, 1));
}

// Weekdays are stored in English ('Monday'); show them in the person's language.
const WEEKDAY_INDEX = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};
export function dayName(day, { short = false } = {}) {
  const idx = WEEKDAY_INDEX[day];
  if (idx == null) return day;
  // 2023-01-01 was a Sunday.
  const d = new Date(2023, 0, 1 + idx);
  return capitalise(formatLocalized(d, short ? 'EEE' : 'EEEE')).replace(/\.$/, '');
}
