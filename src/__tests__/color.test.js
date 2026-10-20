import {
  DEFAULT_PRESET_COLORS, MAX_RECENT_COLORS,
  normalizeHex, hexToHsv, hsvToHex, wheelPointToHex, hexToWheelPoint,
  pushRecentColor, sanitizePresets, isLightColor,
  removeRecentColor, mixHex, gradientColors, groupSegmentsByColor,
} from '../utils/color';

describe('normalizeHex', () => {
  it.each([
    ['#ff8800', '#FF8800'],
    ['ff8800', '#FF8800'],
    ['  #Ff8800 ', '#FF8800'],
    ['#f80', '#FF8800'],
    ['abc', '#AABBCC'],
  ])('%p → %p', (input, out) => expect(normalizeHex(input)).toBe(out));

  it.each([['#ff88'], ['#gggggg'], [''], ['#ff88001'], [null], [123]])(
    'rejects %p', (input) => expect(normalizeHex(input)).toBeNull(),
  );
});

describe('hex ↔ hsv', () => {
  it('converts primaries', () => {
    expect(hexToHsv('#FF0000')).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv('#00FF00')).toEqual({ h: 120, s: 1, v: 1 });
    expect(hexToHsv('#0000FF')).toEqual({ h: 240, s: 1, v: 1 });
  });

  it('handles greys and black without hue', () => {
    expect(hexToHsv('#000000')).toEqual({ h: 0, s: 0, v: 0 });
    expect(hexToHsv('#FFFFFF')).toEqual({ h: 0, s: 0, v: 1 });
  });

  it('returns null for invalid hex', () => expect(hexToHsv('nope')).toBeNull());

  it('round-trips arbitrary colours', () => {
    ['#FF8C00', '#9400D3', '#00BFFF', '#ADFF2F', '#123456', '#FF1493'].forEach((hex) => {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    });
  });

  it('wraps hue and clamps s/v', () => {
    expect(hsvToHex({ h: 360, s: 1, v: 1 })).toBe('#FF0000');
    expect(hsvToHex({ h: -120, s: 1, v: 1 })).toBe('#0000FF');
    expect(hsvToHex({ h: 0, s: 5, v: -1 })).toBe('#000000');
  });
});

describe('wheel geometry', () => {
  const r = 100;

  it('maps the centre to white', () => expect(wheelPointToHex(r, r, r)).toBe('#FFFFFF'));

  it('maps the rim: red at 3 o’clock, then clockwise (screen y grows down)', () => {
    expect(wheelPointToHex(2 * r, r, r)).toBe('#FF0000');
    expect(wheelPointToHex(r, 0, r)).toBe('#8000FF'); // 270°
    expect(wheelPointToHex(0, r, r)).toBe('#00FFFF'); // 180°
  });

  it('clamps points outside the disc to full saturation', () => {
    expect(wheelPointToHex(10 * r, r, r)).toBe('#FF0000');
  });

  it('inverts back to the same colour', () => {
    ['#FF0000', '#00FFFF', '#FF8C00', '#80C0FF'].forEach((hex) => {
      const { x, y } = hexToWheelPoint(hex, r);
      expect(wheelPointToHex(x, y, r)).toBe(hex);
    });
  });

  it('puts invalid colours at the centre', () => {
    expect(hexToWheelPoint('zzz', r)).toEqual({ x: r, y: r });
  });
});

describe('pushRecentColor', () => {
  it('prepends, normalises and dedupes', () => {
    expect(pushRecentColor(['#00FF00', '#FF0000'], 'ff0000')).toEqual(['#FF0000', '#00FF00']);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 10 }, (_, i) => `#00000${i}`);
    const out = pushRecentColor(many, '#FFFFFF');
    expect(out).toHaveLength(MAX_RECENT_COLORS);
    expect(out[0]).toBe('#FFFFFF');
  });

  it('ignores invalid input and drops invalid stored entries', () => {
    expect(pushRecentColor(['zzz', '#FF0000'], 'nope')).toEqual(['#FF0000']);
    expect(pushRecentColor(undefined, '#ABCDEF')).toEqual(['#ABCDEF']);
  });
});

describe('sanitizePresets', () => {
  it('falls back to defaults when missing', () => {
    expect(sanitizePresets(null)).toEqual(DEFAULT_PRESET_COLORS);
  });

  it('keeps valid entries, fills gaps and truncates extras', () => {
    const stored = ['#123456', 'zzz', ...Array(20).fill('#000000')];
    const out = sanitizePresets(stored);
    expect(out).toHaveLength(DEFAULT_PRESET_COLORS.length);
    expect(out[0]).toBe('#123456');
    expect(out[1]).toBe(DEFAULT_PRESET_COLORS[1]);
  });
});

describe('isLightColor', () => {
  it('flags light colours', () => {
    expect(isLightColor('#FFFFFF')).toBe(true);
    expect(isLightColor('#FFD700')).toBe(true);
    expect(isLightColor('#ADFF2F')).toBe(true);
  });

  it('flags dark colours', () => {
    expect(isLightColor('#000000')).toBe(false);
    expect(isLightColor('#0000FF')).toBe(false);
    expect(isLightColor('#9400D3')).toBe(false);
  });
});

describe('removeRecentColor', () => {
  it('removes regardless of case and keeps order', () => {
    expect(removeRecentColor(['#FF0000', '#00FF00', '#0000FF'], '00ff00')).toEqual(['#FF0000', '#0000FF']);
  });

  it('is a no-op for unknown colours and tolerates missing lists', () => {
    expect(removeRecentColor(['#FF0000'], '#123456')).toEqual(['#FF0000']);
    expect(removeRecentColor(undefined, '#FF0000')).toEqual([]);
  });
});

describe('mixHex', () => {
  it('returns the ends at t=0 and t=1', () => {
    expect(mixHex('#FF0000', '#0000FF', 0)).toBe('#FF0000');
    expect(mixHex('#FF0000', '#0000FF', 1)).toBe('#0000FF');
  });

  it('mixes the midpoint and clamps t', () => {
    expect(mixHex('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mixHex('#000000', '#FFFFFF', 2)).toBe('#FFFFFF');
  });

  it('falls back to whichever side is valid', () => {
    expect(mixHex('nope', '#00FF00', 0.5)).toBe('#00FF00');
    expect(mixHex('nope', 'zzz', 0.5)).toBeNull();
  });
});

describe('gradientColors', () => {
  it('spreads two stops end to end', () => {
    expect(gradientColors(['#000000', '#FFFFFF'], 3)).toEqual(['#000000', '#808080', '#FFFFFF']);
  });

  it('passes through a middle stop exactly', () => {
    const out = gradientColors(['#FF0000', '#00FF00', '#0000FF'], 5);
    expect(out[0]).toBe('#FF0000');
    expect(out[2]).toBe('#00FF00');
    expect(out[4]).toBe('#0000FF');
    expect(out[1]).toBe('#808000');
  });

  it('handles one segment, one stop and empty inputs', () => {
    expect(gradientColors(['#FF0000', '#0000FF'], 1)).toEqual(['#FF0000']);
    expect(gradientColors(['#FF0000'], 3)).toEqual(['#FF0000', '#FF0000', '#FF0000']);
    expect(gradientColors(['#FF0000', '#0000FF'], 0)).toEqual([]);
    expect(gradientColors([], 3)).toEqual([]);
  });

  it('skips invalid stops', () => {
    expect(gradientColors(['#000000', 'nope', '#FFFFFF'], 3)).toEqual(['#000000', '#808080', '#FFFFFF']);
  });
});

describe('groupSegmentsByColor', () => {
  it('merges segments sharing a colour, keeping first-appearance order', () => {
    expect(groupSegmentsByColor([0, 1, 2, 5], ['#FF0000', '#0000FF', '#ff0000', '#0000FF'])).toEqual([
      { hex: '#FF0000', segments: [0, 2] },
      { hex: '#0000FF', segments: [1, 5] },
    ]);
  });

  it('skips segments without a valid colour', () => {
    expect(groupSegmentsByColor([0, 1], ['#FF0000'])).toEqual([{ hex: '#FF0000', segments: [0] }]);
  });
});
