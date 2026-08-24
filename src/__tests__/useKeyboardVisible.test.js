import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { Text, Keyboard, Platform } from 'react-native';
import useKeyboardVisible from '../hooks/useKeyboardVisible';

function Harness() {
  const visible = useKeyboardVisible();
  return <Text testID="state">{visible ? 'visible' : 'hidden'}</Text>;
}

let listeners;
let removeSpy;
const realPlatform = Platform.OS;

beforeEach(() => {
  listeners = {};
  removeSpy = jest.fn();
  jest.spyOn(Keyboard, 'addListener').mockImplementation((event, cb) => {
    listeners[event] = cb;
    return { remove: removeSpy };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  Platform.OS = realPlatform;
});

const mount = async () => {
  render(<Harness />);
  return waitFor(() => screen.getByTestId('state'));
};

const expectState = (state) =>
  waitFor(() => expect(screen.getByTestId('state').props.children).toBe(state));

describe('useKeyboardVisible', () => {
  it('starts hidden', async () => {
    await mount();
    await expectState('hidden');
  });

  it('subscribes to the will-change events on iOS', async () => {
    Platform.OS = 'ios';
    await mount();
    expect(Object.keys(listeners).sort()).toEqual(['keyboardWillHide', 'keyboardWillShow']);
  });

  it('subscribes to the did-change events on Android', async () => {
    Platform.OS = 'android';
    await mount();
    expect(Object.keys(listeners).sort()).toEqual(['keyboardDidHide', 'keyboardDidShow']);
  });

  it('tracks the keyboard showing and hiding', async () => {
    Platform.OS = 'ios';
    await mount();

    listeners.keyboardWillShow();
    await expectState('visible');

    listeners.keyboardWillHide();
    await expectState('hidden');
  });

  it('removes its listeners on unmount', async () => {
    await mount();
    screen.unmount();
    await waitFor(() => expect(removeSpy).toHaveBeenCalledTimes(2));
  });
});
