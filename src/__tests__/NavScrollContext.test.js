// useFocusEffect needs a navigation container; run the effect directly instead.
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: jest.fn((cb) => {
    const React = require('react');
    React.useEffect(cb, [cb]);
  }),
}));

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { Text, ScrollView } from 'react-native';
import { NavScrollProvider, useNavScrollProps, useNavCompact } from '../context/NavScrollContext';

const scrollEvent = (y) => ({
  nativeEvent: {
    contentOffset: { y },
    contentSize: { height: 2000, width: 400 },
    layoutMeasurement: { height: 800, width: 400 },
  },
});

function Harness() {
  const navScrollProps = useNavScrollProps();
  const compact = useNavCompact();
  return (
    <ScrollView testID="scroller" {...navScrollProps}>
      <Text testID="nav">{compact ? 'compact' : 'expanded'}</Text>
    </ScrollView>
  );
}

// Renders flush asynchronously here, so wait for the tree before querying it.
const mountScreen = async () => {
  render(
    <NavScrollProvider>
      <Harness />
    </NavScrollProvider>,
  );
  return waitFor(() => screen.getByTestId('scroller'));
};

const expectNav = (state) =>
  waitFor(() => expect(screen.getByTestId('nav').props.children).toBe(state));

// Re-run the screen's focus effect, as navigating to it would.
const focusScreen = () => {
  const { useFocusEffect } = require('@react-navigation/native');
  useFocusEffect.mock.calls.at(-1)[0]();
};

describe('useNavScrollProps', () => {
  it('provides scroll props for the nav to track', async () => {
    const scroller = await mountScreen();
    expect(typeof scroller.props.onScroll).toBe('function');
    expect(scroller.props.scrollEventThrottle).toBe(16);
  });

  it('compacts the nav when scrolling down past the threshold', async () => {
    const scroller = await mountScreen();
    fireEvent.scroll(scroller, scrollEvent(200));
    await expectNav('compact');
  });

  it('stays expanded near the top of the list', async () => {
    const scroller = await mountScreen();
    // Past the 5px delta gate, but under the 50px offset gate
    fireEvent.scroll(scroller, scrollEvent(40));
    await expectNav('expanded');
  });

  it('ignores scroll deltas below the jitter threshold', async () => {
    const scroller = await mountScreen();
    fireEvent.scroll(scroller, scrollEvent(300));
    await expectNav('compact');

    fireEvent.scroll(scroller, scrollEvent(297)); // 3px of jitter — no change
    await expectNav('compact');
  });

  it('expands the nav again when scrolling back up', async () => {
    const scroller = await mountScreen();
    fireEvent.scroll(scroller, scrollEvent(300));
    await expectNav('compact');

    fireEvent.scroll(scroller, scrollEvent(100));
    await expectNav('expanded');
  });

  it('expands the nav when a screen gains focus', async () => {
    const scroller = await mountScreen();
    fireEvent.scroll(scroller, scrollEvent(300));
    await expectNav('compact');

    focusScreen();
    await expectNav('expanded');
  });

  it('resets the shared offset on focus so a pushed screen starts expanded', async () => {
    const scroller = await mountScreen();
    fireEvent.scroll(scroller, scrollEvent(500));
    await expectNav('compact');

    // A pushed screen must not inherit the previous screen's offset: after focus,
    // scrolling to a smaller offset has to read as scrolling *down* from 0. Were
    // the offset still 500, this would read as scrolling up and stay expanded.
    focusScreen();
    await expectNav('expanded');

    fireEvent.scroll(scroller, scrollEvent(120));
    await expectNav('compact');
  });
});
