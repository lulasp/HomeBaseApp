# Translations — English and European Portuguese

**Status:** built 2026-11-09 (branch `appTranslations`), not yet released

Each person picks English or Portuguese (pt-PT). The whole app follows it,
including the AI assistant's replies. Dates and money keep their existing
formatting in both languages.

## Choosing the language

- **Where:** Profile → App → Language, and the EN / PT switch above the theme
  toggle in the desktop sidebar.
- **Default:** until someone picks, the app follows the phone or browser
  language: Portuguese if it is any Portuguese, otherwise English.
- **Storage:** the choice is saved on the device (AsyncStorage key
  `@homebase_language`), like the theme. Each person, on each device, chooses
  their own. Nothing is written to Firestore.

## How it works

- `src/i18n/index.js`: a small translator with no library dependency.
  `t('profile.title')` looks the key up by dot path. `{{name}}` placeholders are
  filled from the params, and a `count` param picks `key_one` / `key_other`.
  A missing Portuguese string falls back to English, then to the key itself.
- `src/i18n/en.js` and `src/i18n/pt.js` hold the text, one section per screen
  or area. `src/__tests__/i18n.test.js` fails if the two files don't have
  exactly the same keys and the same `{{placeholders}}`.
- `src/context/LanguageContext.js`: `useLanguage()` returns
  `{ language, setLanguage, t }` and re-renders on a switch. It also keeps a
  module-level current language, so code outside React (utils, services,
  callbacks) can import `t` from `src/i18n` directly. Screens that use the
  module-level `t` call `useLanguage()` once to re-render on a switch, and so
  do `memo` components.

## Stored values stay in English

Several values are both shown and saved, so they stay in English in the data
and are only translated when shown:

- Pantry and grocery categories and units: `categoryName()` / `unitName()` in
  `src/utils/categories.js`. A household's own or renamed categories are shown
  as typed.
- Finance categories, price trends, BMI categories, activity levels and goals:
  getters on the built-in objects, so `.label` reads in the current language.
  Screens that memoise these lists include `language` in the dependencies.
- Meal types (`home.meals.*`), emergency relationships (`relationships.*`), and
  Xiaomi modes, statuses, parts and regions (`xiaomi.labels.*`).

## The AI

`sendChatMessage` and `suggestRecipes` take the language. In Portuguese the
system prompt asks for European Portuguese. Statement and receipt reading are
unchanged, since they extract data rather than write text.

## Known limits

- Day and month names stay in English, as agreed, for example "Monday" in the
  tasks and "Nov 2026" on Finances.
- Editing a built-in pantry category in Portuguese shows its Portuguese name.
  Saving it unchanged keeps the stored English name. Saving a new name stores
  the new name, the same as any rename.
- Error messages from Govee, Xiaomi and Spoonacular come from those services
  and are shown as they arrive.
- `src/screens/DesignShowcaseScreen.js` is not in the navigation and was not
  translated.

## Adding text

Never hardcode user-facing text. Add the key to both `en.js` and `pt.js` in the
same change, then use `t('section.key')`.
