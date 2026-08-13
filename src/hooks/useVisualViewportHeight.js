import { useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

// Height of the *visible* area, keyboard-aware on web.
//
// iOS WebKit keeps window.innerHeight (what useWindowDimensions reads) fixed
// when the on-screen keyboard opens — it shrinks the visual viewport and
// scrolls the document instead, which leaves a white gap at the bottom once the
// keyboard closes. Reading window.visualViewport.height instead makes any
// container pinned to this value track the keyboard and shed the gap.
//
// Native and non-supporting browsers fall back to the window height unchanged.
export default function useVisualViewportHeight() {
  const { height: windowHeight } = useWindowDimensions();
  const [vvHeight, setVvHeight] = useState(windowHeight);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.visualViewport) {
      setVvHeight(windowHeight);
      return;
    }
    const vv = window.visualViewport;
    const update = () => setVvHeight(vv.height);
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [windowHeight]);

  return Platform.OS === 'web' ? vvHeight : windowHeight;
}
