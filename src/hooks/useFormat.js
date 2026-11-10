import { useHousehold } from '../context/HouseholdContext';
import { useLanguage } from '../context/LanguageContext';
import { DEFAULT_CURRENCY, DEFAULT_DATE_FORMAT } from '../utils/format';

// Subscribe a component to the household's date/currency settings and the
// person's language, so the module-level formatters in utils/format re-run
// when either changes. Returns the current settings.
export default function useFormat() {
  const household = useHousehold();
  const { language } = useLanguage();
  return {
    dateFormat: household?.dateFormat ?? DEFAULT_DATE_FORMAT,
    currency: household?.currency ?? DEFAULT_CURRENCY,
    language,
  };
}
