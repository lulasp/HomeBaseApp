import React, { useEffect, useRef } from 'react';
import { Platform, ScrollView } from 'react-native';

// Horizontal ScrollView a mouse can use on web: the wheel scrolls it sideways
// and click-dragging pans it. On native it's a plain horizontal ScrollView.
const DRAG_THRESHOLD = 5; // px of movement before a press becomes a drag

export default function DragScrollView({ children, ...props }) {
  const ref = useRef(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const el = ref.current?.getScrollableNode?.();
    if (!el) return undefined;

    const onWheel = (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // trackpad side-swipe scrolls natively
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      // At either end, let the wheel scroll the page/modal instead
      if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max)) return;
      e.preventDefault();
      el.scrollLeft = Math.max(0, Math.min(max, el.scrollLeft + e.deltaY));
    };

    let startX = 0;
    let startLeft = 0;
    let dragged = false;

    const onMove = (e) => {
      const dx = e.clientX - startX;
      if (!dragged && Math.abs(dx) < DRAG_THRESHOLD) return;
      dragged = true;
      el.style.cursor = 'grabbing';
      el.scrollLeft = startLeft - dx;
      window.getSelection?.()?.removeAllRanges();
    };
    const onUp = () => {
      el.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    const onDown = (e) => {
      if (e.button !== 0) return;
      dragged = false;
      startX = e.clientX;
      startLeft = el.scrollLeft;
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };
    // A drag ends in a click on whatever chip it started on — swallow it
    const onClick = (e) => {
      if (!dragged) return;
      e.stopPropagation();
      e.preventDefault();
      dragged = false;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('mousedown', onDown);
    el.addEventListener('click', onClick, true);
    return () => {
      onUp();
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('mousedown', onDown);
      el.removeEventListener('click', onClick, true);
    };
  }, []);

  return (
    <ScrollView ref={ref} horizontal showsHorizontalScrollIndicator={false} {...props}>
      {children}
    </ScrollView>
  );
}
