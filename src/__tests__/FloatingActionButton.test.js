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
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

import FloatingActionButton, {
  computeAnchors, cornerFromDrop, createPressGuard,
} from '../components/FloatingActionButton';
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

  it('takes a smaller bottom clearance (desktop has no floating nav to clear)', () => {
    const anchors = computeAnchors({
      boxWidth: COLUMN_WIDTH, boxHeight: 800, viewportHeight: 900, bottomClearance: SIDE_INSET,
    });
    expect(anchors.bottomRight.y).toBe(800 - SIDE_INSET - FAB_SIZE);
    expect(anchors.topRight.y).toBe(TOP_CLEARANCE); // top is unaffected
  });
});

describe('cornerFromDrop', () => {
  const box = { boxWidth: 1000, boxHeight: 800 };
  const dropAt = (centerX, centerY) => cornerFromDrop({ ...box, centerX, centerY });

  it('picks the corner of the quadrant the button was dropped in', () => {
    expect(dropAt(100, 100)).toBe('topLeft');
    expect(dropAt(900, 100)).toBe('topRight');
    expect(dropAt(100, 700)).toBe('bottomLeft');
    expect(dropAt(900, 700)).toBe('bottomRight');
  });

  it('resolves the midpoint to the bottom-right quadrant', () => {
    expect(dropAt(500, 400)).toBe('bottomRight');
  });

  it('splits on the container midlines, not the window', () => {
    // Just left of center is still Left, even though it is far right on screen.
    expect(dropAt(499, 700)).toBe('bottomLeft');
    expect(dropAt(501, 700)).toBe('bottomRight');
    expect(dropAt(900, 399)).toBe('topRight');
    expect(dropAt(900, 401)).toBe('bottomRight');
  });

  it('handles a drop dragged outside the container bounds', () => {
    expect(dropAt(-200, -200)).toBe('topLeft');
    expect(dropAt(5000, 5000)).toBe('bottomRight');
  });
});

describe('createPressGuard', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('lets a press through when nothing was dragged', () => {
    const guard = createPressGuard();
    expect(guard.shouldSwallowPress()).toBe(false);
  });

  it('swallows the click a drop generates', () => {
    const guard = createPressGuard();
    guard.armAfterDrag();
    expect(guard.shouldSwallowPress()).toBe(true);
  });

  it('swallows only one press per drag', () => {
    const guard = createPressGuard();
    guard.armAfterDrag();
    guard.shouldSwallowPress();
    // The next tap is a real one — dropping it would make the button feel dead.
    expect(guard.shouldSwallowPress()).toBe(false);
  });

  it('disarms itself when the drop produces no click at all', () => {
    const guard = createPressGuard({ delay: 400 });
    guard.armAfterDrag();
    jest.advanceTimersByTime(401);
    expect(guard.shouldSwallowPress()).toBe(false);
  });

  it('stays armed until the delay elapses', () => {
    const guard = createPressGuard({ delay: 400 });
    guard.armAfterDrag();
    jest.advanceTimersByTime(399);
    expect(guard.shouldSwallowPress()).toBe(true);
  });

  it('restarts the window when a second drag follows the first', () => {
    const guard = createPressGuard({ delay: 400 });
    guard.armAfterDrag();
    jest.advanceTimersByTime(300);
    guard.armAfterDrag();
    jest.advanceTimersByTime(300); // past the first timer, inside the second
    expect(guard.shouldSwallowPress()).toBe(true);
  });

  it('does not fire a pending timer after dispose', () => {
    const guard = createPressGuard({ delay: 400 });
    guard.armAfterDrag();
    guard.dispose();
    expect(jest.getTimerCount()).toBe(0);
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

  it('calls onPress for an ordinary press', async () => {
    const onPress = jest.fn();
    await render(
      <ThemeProvider>
        <FabPositionProvider>
          <FloatingActionButton onPress={onPress} accessibilityLabel="Add item" />
        </FabPositionProvider>
      </ThemeProvider>,
    );
    fireEvent.press(await waitFor(() => screen.getByLabelText('Add item')));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
