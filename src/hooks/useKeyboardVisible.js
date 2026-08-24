import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/** Whether the software keyboard is currently shown. */
export default function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // iOS reports will-change events; Android only fires did-change.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, () => setVisible(true));
    const hide = Keyboard.addListener(hideEvent, () => setVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  return visible;
}
