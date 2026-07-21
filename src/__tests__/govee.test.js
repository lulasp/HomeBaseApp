import {
  hexToRgbInt,
  rgbIntToHex,
  hasCap,
  getCapParam,
  getScenesFromDevice,
  stateFromCapabilities,
  applyActionsToDevice,
} from '../services/govee';

describe('hexToRgbInt', () => {
  it('converts red', () => expect(hexToRgbInt('#FF0000')).toBe(0xff0000));
  it('converts green', () => expect(hexToRgbInt('#00FF00')).toBe(0x00ff00));
  it('converts blue', () => expect(hexToRgbInt('#0000FF')).toBe(0x0000ff));
  it('converts white', () => expect(hexToRgbInt('#FFFFFF')).toBe(0xffffff));
  it('converts black', () => expect(hexToRgbInt('#000000')).toBe(0x000000));
  it('works without leading hash', () => expect(hexToRgbInt('FF0000')).toBe(0xff0000));
});

describe('rgbIntToHex', () => {
  it('converts red', () => expect(rgbIntToHex(0xff0000)).toBe('#FF0000'));
  it('converts green', () => expect(rgbIntToHex(0x00ff00)).toBe('#00FF00'));
  it('converts blue', () => expect(rgbIntToHex(0x0000ff)).toBe('#0000FF'));
  it('pads single-digit channels', () => expect(rgbIntToHex(0x010203)).toBe('#010203'));
});

describe('hexToRgbInt / rgbIntToHex round-trip', () => {
  it.each(['#FF5733', '#1ABC9C', '#8E44AD', '#2C3E50'])(
    'round-trips %s',
    (hex) => expect(rgbIntToHex(hexToRgbInt(hex))).toBe(hex),
  );
});

const makeDevice = (caps) => ({ capabilities: caps });

describe('hasCap', () => {
  const device = makeDevice([
    { type: 'devices.capabilities.on_off', instance: 'powerSwitch' },
    { type: 'devices.capabilities.range', instance: 'brightness' },
  ]);

  it('returns true when type and instance match', () =>
    expect(hasCap(device, 'devices.capabilities.on_off', 'powerSwitch')).toBe(true));

  it('returns true when only type is given and it matches', () =>
    expect(hasCap(device, 'devices.capabilities.range')).toBe(true));

  it('returns false for unknown type', () =>
    expect(hasCap(device, 'devices.capabilities.color_setting', 'colorRgb')).toBe(false));

  it('returns false for null device', () =>
    expect(hasCap(null, 'devices.capabilities.on_off', 'powerSwitch')).toBe(false));

  it('returns false for device with no capabilities', () =>
    expect(hasCap({}, 'devices.capabilities.on_off', 'powerSwitch')).toBe(false));
});

describe('getCapParam', () => {
  const device = makeDevice([
    {
      type: 'devices.capabilities.range',
      instance: 'brightness',
      parameters: { range: { min: 1, max: 100 } },
    },
  ]);

  it('returns parameters when found', () =>
    expect(getCapParam(device, 'devices.capabilities.range', 'brightness')).toEqual({
      range: { min: 1, max: 100 },
    }));

  it('returns undefined when not found', () =>
    expect(getCapParam(device, 'devices.capabilities.on_off', 'powerSwitch')).toBeUndefined());

  it('returns undefined for null device', () =>
    expect(getCapParam(null, 'devices.capabilities.range', 'brightness')).toBeUndefined());
});

describe('getScenesFromDevice', () => {
  it('returns empty array for null device', () =>
    expect(getScenesFromDevice(null)).toEqual([]));

  it('returns empty array when no dynamic_scene capability', () =>
    expect(getScenesFromDevice(makeDevice([]))).toEqual([]));

  it('maps options to id/name pairs', () => {
    const device = makeDevice([
      {
        type: 'devices.capabilities.dynamic_scene',
        instance: 'lightScene',
        parameters: {
          options: [
            { value: 1, name: 'Sunrise' },
            { value: 2, name: 'Ocean' },
          ],
        },
      },
    ]);
    expect(getScenesFromDevice(device)).toEqual([
      { id: 1, name: 'Sunrise' },
      { id: 2, name: 'Ocean' },
    ]);
  });

  it('falls back to "Scene N" when name is missing', () => {
    const device = makeDevice([
      {
        type: 'devices.capabilities.dynamic_scene',
        instance: 'lightScene',
        parameters: { options: [{ value: 7 }] },
      },
    ]);
    expect(getScenesFromDevice(device)[0].name).toBe('Scene 1');
  });
});

describe('stateFromCapabilities', () => {
  it('returns defaults for empty capabilities', () => {
    expect(stateFromCapabilities([])).toEqual({
      on: false,
      brightness: 80,
      color: '#FFFFFF',
      colorTem: 4000,
      scene: null,
      musicMode: null,
    });
  });

  it('parses power on', () => {
    const caps = [
      { type: 'devices.capabilities.on_off', instance: 'powerSwitch', state: { value: 1 } },
    ];
    expect(stateFromCapabilities(caps).on).toBe(true);
  });

  it('parses power off', () => {
    const caps = [
      { type: 'devices.capabilities.on_off', instance: 'powerSwitch', state: { value: 0 } },
    ];
    expect(stateFromCapabilities(caps).on).toBe(false);
  });

  it('parses brightness', () => {
    const caps = [
      { type: 'devices.capabilities.range', instance: 'brightness', state: { value: 50 } },
    ];
    expect(stateFromCapabilities(caps).brightness).toBe(50);
  });

  it('parses color as hex', () => {
    const caps = [
      { type: 'devices.capabilities.color_setting', instance: 'colorRgb', state: { value: 0xff0000 } },
    ];
    expect(stateFromCapabilities(caps).color).toBe('#FF0000');
  });

  it('parses color temperature', () => {
    const caps = [
      { type: 'devices.capabilities.color_setting', instance: 'colorTemperatureK', state: { value: 6500 } },
    ];
    expect(stateFromCapabilities(caps).colorTem).toBe(6500);
  });

  it('parses scene value', () => {
    const caps = [
      { type: 'devices.capabilities.dynamic_scene', instance: 'lightScene', state: { value: 3 } },
    ];
    expect(stateFromCapabilities(caps).scene).toBe(3);
  });

  it('parses music mode', () => {
    const caps = [
      { type: 'devices.capabilities.music_setting', instance: 'musicMode', state: { value: { musicMode: 2 } } },
    ];
    expect(stateFromCapabilities(caps).musicMode).toBe(2);
  });
});

describe('applyActionsToDevice', () => {
  const device = {
    sku: 'H6159',
    device: 'AA:BB',
    capabilities: [
      { type: 'devices.capabilities.on_off', instance: 'powerSwitch' },
      { type: 'devices.capabilities.range', instance: 'brightness' },
      { type: 'devices.capabilities.color_setting', instance: 'colorRgb' },
      { type: 'devices.capabilities.color_setting', instance: 'colorTemperatureK' },
      {
        type: 'devices.capabilities.dynamic_scene',
        instance: 'lightScene',
        parameters: { options: [{ value: 9, name: 'Sunrise' }] },
      },
    ],
  };

  const sentCapabilities = () =>
    global.fetch.mock.calls.map(([, opts]) => JSON.parse(opts.body).payload.capability);

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ code: 200 })),
    });
  });

  afterEach(() => {
    delete global.fetch;
  });

  it('applies power, brightness and color, returning the patch', async () => {
    const patch = await applyActionsToDevice('key', device, {
      power: true, brightness: 40, colorMode: 'color', color: '#FF0000',
    });
    expect(patch).toEqual({ on: true, brightness: 40, color: '#FF0000', scene: null });
    expect(sentCapabilities()).toEqual([
      expect.objectContaining({ instance: 'powerSwitch', value: 1 }),
      expect.objectContaining({ instance: 'brightness', value: 40 }),
      expect.objectContaining({ instance: 'colorRgb', value: 0xff0000 }),
    ]);
  });

  it('stops after power off', async () => {
    const patch = await applyActionsToDevice('key', device, {
      power: false, brightness: 40, colorMode: 'color', color: '#FF0000',
    });
    expect(patch).toEqual({ on: false });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('resolves scenes by name per device', async () => {
    const patch = await applyActionsToDevice('key', device, {
      colorMode: 'scene', sceneName: 'Sunrise',
    });
    expect(patch).toEqual({ scene: 9 });
    expect(sentCapabilities()).toEqual([
      expect.objectContaining({ instance: 'lightScene', value: 9 }),
    ]);
  });

  it('skips a scene the device does not have', async () => {
    const patch = await applyActionsToDevice('key', device, {
      colorMode: 'scene', sceneName: 'Nope',
    });
    expect(patch).toEqual({});
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('skips capabilities the device lacks', async () => {
    const dimOnly = {
      sku: 'H1',
      device: 'CC:DD',
      capabilities: [{ type: 'devices.capabilities.on_off', instance: 'powerSwitch' }],
    };
    const patch = await applyActionsToDevice('key', dimOnly, {
      power: true, brightness: 40, colorMode: 'colorTem', colorTem: 3000,
    });
    expect(patch).toEqual({ on: true });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
