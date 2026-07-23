# Web scrolling (react-native-web)

This app runs on web (desktop, via the sidebar `TabBar`). On react-native-web a
`ScrollView` only scrolls when it has a **definite pixel height** — `flex: 1`
does *not* resolve to a bounded height inside the nav stack/scene chain, so the
ScrollView just grows to fit its content and the page never scrolls. This has
bitten us repeatedly on `ScrollView`-based screens.

## The pattern for any vertical `ScrollView` screen

Pin the scroll container to the viewport height on web (leave native as `flex: 1`):

```jsx
import { useWindowDimensions, Platform } from 'react-native';

const { height: windowHeight } = useWindowDimensions();

<View style={[
  styles.root,                                        // { flex: 1, minHeight: 0, backgroundColor }
  Platform.OS === 'web' ? { height: windowHeight } : null,
]}>
  <ScrollView
    style={Platform.OS === 'web' ? { height: windowHeight } : { flex: 1 }}
    contentContainerStyle={[styles.container, isDesktop && { maxWidth: DESKTOP_MAX_CONTENT, alignSelf: 'center', width: '100%' }]}
  >
    …
  </ScrollView>
</View>
```

- The height must be on the **`ScrollView`'s own `style`** — putting it only on
  an ancestor is not enough.
- Add `minHeight: 0` to the root style.
- Proven working references: `StatementImportScreen.js` and
  `BillsExpensesScreen.js`. Copy their exact setup rather than re-deriving it.

## Other gotchas

- A **nested horizontal `ScrollView`** inside the vertical scroll can block the
  outer scroll on web. Use a wrapping `View` with `flexWrap: 'wrap'` instead
  (see `StatementImportScreen`'s `chipRow`).
- This is **not** about `SafeAreaView`'s source or nav-stack nesting — screens
  using the `react-native-safe-area-context` `SafeAreaView` (e.g.
  `EmergencyContactsScreen`) scroll fine once the height is pinned. Don't chase
  those; fix the ScrollView height.
- **`FlatList`-based screens don't need this** — `FlatList` manages its own
  scroll height. Grocery/Recipes/Pantry use `FlatList` and are unaffected.

## Debugging

If a page won't scroll on web, don't theorize from the broken file — diff it
against a screen that *does* scroll (`StatementImportScreen`, or a `FlatList`
screen) and match the height pattern above.
