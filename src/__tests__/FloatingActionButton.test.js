jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

// The real icon set pulls in expo-font/expo-asset, which aren't resolvable
// under jest — the glyph is irrelevant here.
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('../navigation/TabBar', () => ({
  useIsDesktop: () => true,
  SIDEBAR_WIDTH: 220,
  DESKTOP_MAX_CONTENT: 920,
}));

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import FloatingActionButton, { computeAnchors } from '../components/FloatingActionButton';
import { ThemeProvider } from '../context/ThemeContext';
import { FabPositionProvider } from '../context/FabPositionContext';

const FAB_SIZE = 58;
const SIDE_INSET = 20;
const TOP_CLEARANCE = 96;
const BOTTOM_CLEARANCE = 160;

// A desktop window, and the narrower boxes host screens actually nest the FAB in.
const WINDOW = { width: 1440, height: 900 };
const SCENE_WIDTH = WINDOW.width - 220;          // sidebar-inset scene (Bills)
const COLUMN_WIDTH = 920;                        // centered content column (Pantry/Grocery)

describe('computeAnchors', () => {
  const anchorsFor = (boxWidth, boxHeight = 800, viewportHeight = WINDOW.height) =>
    computeAnchors({ boxWidth, boxHeight, viewportHeight, insetTop: 0 });

  it('anchors to the right edge of the container, not the window', () => {
    // Regression: anchoring to the window put the FAB ~292px past the right
    // edge of the screen on Pantry/Grocery, making it invisible on desktop.
    const anchors = anchorsFor(COLUMN_WIDTH);
    expect(anchors.bottomRight.x).toBe(COLUMN_WIDTH - SIDE_INSET - FAB_SIZE);
    expect(anchors.bottomRight.x + FAB_SIZE).toBeLessThanOrEqual(COLUMN_WIDTH);
  });

  it('keeps every corner inside the container', () => {
    const anchors = anchorsFor(COLUMN_WIDTH, 800);
    for (const [name, { x, y }] of Object.entries(anchors)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + FAB_SIZE).toBeLessThanOrEqual(COLUMN_WIDTH);
      expect(y + FAB_SIZE).toBeLessThanOrEqual(800);
      expect(name).toMatch(/^(top|bottom)(Left|Right)$/);
    }
  });

  it('tracks a full-width scene container', () => {
    const anchors = anchorsFor(SCENE_WIDTH);
    expect(anchors.bottomRight.x).toBe(SCENE_WIDTH - SIDE_INSET - FAB_SIZE);
    expect(anchors.topRight.x).toBe(SCENE_WIDTH - SIDE_INSET - FAB_SIZE);
  });

  it('pins left-hand corners to the side inset', () => {
    const anchors = anchorsFor(COLUMN_WIDTH);
    expect(anchors.topLeft.x).toBe(SIDE_INSET);
    expect(anchors.bottomLeft.x).toBe(SIDE_INSET);
  });

  it('clears the header and the floating tab bar', () => {
    const anchors = anchorsFor(COLUMN_WIDTH, 800);
    expect(anchors.topLeft.y).toBe(TOP_CLEARANCE);
    expect(anchors.bottomLeft.y).toBe(800 - BOTTOM_CLEARANCE - FAB_SIZE);
  });

  it('offsets the top anchors by the safe-area inset', () => {
    const anchors = computeAnchors({
      boxWidth: COLUMN_WIDTH, boxHeight: 800, viewportHeight: 900, insetTop: 44,
    });
    expect(anchors.topRight.y).toBe(44 + TOP_CLEARANCE);
  });

  it('caps the bottom anchor to the visual viewport when the keyboard shrinks it', () => {
    // Container still reports 800, but only 500px are visible.
    const anchors = computeAnchors({
      boxWidth: COLUMN_WIDTH, boxHeight: 800, viewportHeight: 500, insetTop: 0,
    });
    expect(anchors.bottomRight.y).toBe(500 - BOTTOM_CLEARANCE - FAB_SIZE);
  });

  it('never lets the bottom anchor rise above the top anchor', () => {
    const anchors = anchorsFor(COLUMN_WIDTH, 120);
    expect(anchors.bottomRight.y).toBe(anchors.topRight.y);
  });

  it('never produces a negative x for a very narrow container', () => {
    const anchors = anchorsFor(40);
    expect(anchors.bottomRight.x).toBe(SIDE_INSET);
    expect(anchors.bottomLeft.x).toBe(SIDE_INSET);
  });
});

describe('FloatingActionButton', () => {
  it('renders a pressable button with its accessibility label', async () => {
    await render(
      <ThemeProvider>
        <FabPositionProvider>
          <FloatingActionButton onPress={() => {}} accessibilityLabel="Add item" />
        </FabPositionProvider>
      </ThemeProvider>,
    );
    expect(screen.getByLabelText('Add item')).toBeTruthy();
  });
});
