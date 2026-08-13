import { Platform } from 'react-native';

// iOS web (all iPhone browsers run WebKit) keeps window.innerHeight fixed when
// the on-screen keyboard opens and scrolls the document instead, leaving a
// white gap at the bottom after the keyboard closes. Locking the document so
// only the app's inner ScrollViews scroll — and snapping any residual scroll
// back to the top on blur — removes it. Pairs with useVisualViewportHeight(),
// which shrinks containers to the keyboard-adjusted visual viewport.
//
// Scoped to iOS web only so desktop/Android web are untouched. Returns a
// cleanup function.
export function installWebViewportFix() {
  if (Platform.OS !== 'web') return () => {};
  if (typeof document === 'undefined' || typeof navigator === 'undefined') return () => {};

  const isIOS =
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS
  if (!isIOS) return () => {};

  const html = document.documentElement;
  const body = document.body;
  const prev = {
    htmlHeight: html.style.height,
    position: body.style.position,
    height: body.style.height,
    width: body.style.width,
    overflow: body.style.overflow,
  };

  html.style.height = '100%';
  body.style.position = 'fixed';
  body.style.height = '100%';
  body.style.width = '100%';
  body.style.overflow = 'hidden';

  const onFocusOut = (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      // Let the keyboard finish dismissing, then clear any residual scroll.
      setTimeout(() => window.scrollTo(0, 0), 50);
    }
  };
  document.addEventListener('focusout', onFocusOut, true);

  return () => {
    html.style.height = prev.htmlHeight;
    body.style.position = prev.position;
    body.style.height = prev.height;
    body.style.width = prev.width;
    body.style.overflow = prev.overflow;
    document.removeEventListener('focusout', onFocusOut, true);
  };
}
