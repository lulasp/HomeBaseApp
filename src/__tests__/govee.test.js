import {
  hexToRgbInt,
  rgbIntToHex,
  hasCap,
  getCapParam,
  getScenesFromDevice,
  getDynamicScenes,
  getDiyScenes,
  getSegmentCount,
  sceneKey,
  setSegmentColor,
  setSegmentBrightness,
  applyScene,
  resolveSceneByName,
  stateFromCapabilities,
  applyActionsToDevice,
} from '../services/govee';

const mockFetchJson = (...payloads) => {
  global.fetch = jest.fn();
  for (const payload of payloads) {
    global.fetch.mockResolvedValueOnce({
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ code: 200, ...payload })),
    });
  }
  global.fetch.mockResolvedValue({
    status: 200,
    text: () => Promise.resolve(JSON.stringify({ code: 200 })),
  });
};

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

  it('normalises options, carrying the capability and source', () => {
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
      {
        key: '1', name: 'Sunrise', value: 1, source: 'static',
        type: 'devices.capabilities.dynamic_scene', instance: 'lightScene',
      },
      {
        key: '2', name: 'Ocean', value: 2, source: 'static',
        type: 'devices.capabilities.dynamic_scene', instance: 'lightScene',
      },
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

describe('sceneKey', () => {
  it('returns null for null', () => expect(sceneKey(null)).toBeNull());
  it('returns null for undefined', () => expect(sceneKey(undefined)).toBeNull());
  it('stringifies an integer value', () => expect(sceneKey(8216931)).toBe('8216931'));
  it('stringifies zero', () => expect(sceneKey(0)).toBe('0'));
  it('flattens a dynamic-scene object', () =>
    expect(sceneKey({ paramId: 4280, id: 3853 })).toBe('4280:3853'));
  it('tolerates a partial object', () =>
    expect(sceneKey({ id: 3853 })).toBe(':3853'));
});

describe('getSegmentCount', () => {
  const withSegments = (n, instance = 'segmentedColorRgb') => makeDevice([
    {
      type: 'devices.capabilities.segment_color_setting',
      instance,
      parameters: {
        fields: [
          { fieldName: 'segment', options: Array.from({ length: n }, (_, i) => ({ value: i })) },
          { fieldName: 'rgb', range: { min: 0, max: 16777215 } },
        ],
      },
    },
  ]);

  it('counts the segment options', () => expect(getSegmentCount(withSegments(15))).toBe(15));

  it('falls back to the brightness instance', () =>
    expect(getSegmentCount(withSegments(10, 'segmentedBrightness'))).toBe(10));

  it('returns 0 when the device has no segment capability', () =>
    expect(getSegmentCount(makeDevice([]))).toBe(0));

  it('returns 0 for a null device', () => expect(getSegmentCount(null)).toBe(0));

  it('returns 0 when the segment field has no options', () => {
    const device = makeDevice([
      {
        type: 'devices.capabilities.segment_color_setting',
        instance: 'segmentedColorRgb',
        parameters: { fields: [{ fieldName: 'segment' }] },
      },
    ]);
    expect(getSegmentCount(device)).toBe(0);
  });
});

describe('scene catalogue fetchers', () => {
  const sentBody = (i = 0) => JSON.parse(global.fetch.mock.calls[i][1].body);
  const sentUrl = (i = 0) => global.fetch.mock.calls[i][0];

  afterEach(() => { delete global.fetch; });

  it('getDynamicScenes posts to /device/scenes and normalises object values', async () => {
    mockFetchJson({
      payload: {
        capabilities: [{
          type: 'devices.capabilities.dynamic_scene',
          instance: 'lightScene',
          parameters: { options: [{ name: 'Sunrise', value: { paramId: 4280, id: 3853 } }] },
        }],
      },
    });
    const scenes = await getDynamicScenes('key', 'H6159', 'AA:BB');
    expect(sentUrl()).toContain('/device/scenes');
    expect(sentBody().payload).toEqual({ sku: 'H6159', device: 'AA:BB' });
    expect(scenes).toEqual([{
      key: '4280:3853',
      name: 'Sunrise',
      value: { paramId: 4280, id: 3853 },
      type: 'devices.capabilities.dynamic_scene',
      instance: 'lightScene',
      source: 'dynamic',
    }]);
  });

  it('getDiyScenes posts to /device/diy-scenes and keeps the DIY capability', async () => {
    mockFetchJson({
      payload: {
        capabilities: [{
          type: 'devices.capabilities.diy_color_setting',
          instance: 'diyScene',
          parameters: { options: [{ name: 'Xmas lights 2', value: 8216931 }] },
        }],
      },
    });
    const scenes = await getDiyScenes('key', 'H6159', 'AA:BB');
    expect(sentUrl()).toContain('/device/diy-scenes');
    expect(scenes).toEqual([{
      key: '8216931',
      name: 'Xmas lights 2',
      value: 8216931,
      type: 'devices.capabilities.diy_color_setting',
      instance: 'diyScene',
      source: 'diy',
    }]);
  });

  it('returns an empty list when the payload has no capabilities', async () => {
    mockFetchJson({ payload: {} });
    expect(await getDynamicScenes('key', 'H6159', 'AA:BB')).toEqual([]);
  });
});

describe('segment commands', () => {
  const sentCapability = () => JSON.parse(global.fetch.mock.calls[0][1].body).payload.capability;

  beforeEach(() => mockFetchJson());
  afterEach(() => { delete global.fetch; });

  it('sends segment colours as an rgb int with the segment array', async () => {
    await setSegmentColor('key', 'H6159', 'AA:BB', [0, 2, 4], '#FF0000');
    expect(sentCapability()).toEqual({
      type: 'devices.capabilities.segment_color_setting',
      instance: 'segmentedColorRgb',
      value: { segment: [0, 2, 4], rgb: 0xff0000 },
    });
  });

  it('sends segment brightness', async () => {
    await setSegmentBrightness('key', 'H6159', 'AA:BB', [1], 60);
    expect(sentCapability()).toEqual({
      type: 'devices.capabilities.segment_color_setting',
      instance: 'segmentedBrightness',
      value: { segment: [1], brightness: 60 },
    });
  });
});

describe('applyScene', () => {
  beforeEach(() => mockFetchJson());
  afterEach(() => { delete global.fetch; });

  it('echoes the scene capability back verbatim', async () => {
    await applyScene('key', 'H6159', 'AA:BB', {
      key: '8216931',
      name: 'Xmas lights 2',
      value: 8216931,
      type: 'devices.capabilities.diy_color_setting',
      instance: 'diyScene',
      source: 'diy',
    });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).payload.capability).toEqual({
      type: 'devices.capabilities.diy_color_setting',
      instance: 'diyScene',
      value: 8216931,
    });
  });
});

describe('resolveSceneByName', () => {
  const device = {
    sku: 'H6159',
    device: 'AA:BB',
    capabilities: [{
      type: 'devices.capabilities.dynamic_scene',
      instance: 'lightScene',
      parameters: { options: [{ value: 9, name: 'Sunrise' }] },
    }],
  };

  afterEach(() => { delete global.fetch; });

  it('returns null without a name', async () => {
    mockFetchJson();
    expect(await resolveSceneByName('key', device, null)).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('prefers the device list and makes no request', async () => {
    mockFetchJson();
    const scene = await resolveSceneByName('key', device, 'Sunrise');
    expect(scene).toMatchObject({ value: 9, source: 'static' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('falls back to the dynamic catalogue', async () => {
    mockFetchJson({
      payload: {
        capabilities: [{
          type: 'devices.capabilities.dynamic_scene',
          instance: 'lightScene',
          parameters: { options: [{ name: 'Aurora', value: { paramId: 1, id: 2 } }] },
        }],
      },
    });
    const scene = await resolveSceneByName('key', device, 'Aurora');
    expect(scene).toMatchObject({ source: 'dynamic', value: { paramId: 1, id: 2 } });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to DIY scenes when the dynamic list misses', async () => {
    mockFetchJson(
      { payload: { capabilities: [] } },
      {
        payload: {
          capabilities: [{
            type: 'devices.capabilities.diy_color_setting',
            instance: 'diyScene',
            parameters: { options: [{ name: 'Party', value: 42 }] },
          }],
        },
      },
    );
    const scene = await resolveSceneByName('key', device, 'Party');
    expect(scene).toMatchObject({ source: 'diy', value: 42 });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('returns null when no catalogue has the name', async () => {
    mockFetchJson({ payload: { capabilities: [] } }, { payload: { capabilities: [] } });
    expect(await resolveSceneByName('key', device, 'Nope')).toBeNull();
  });

  it('keeps looking when a catalogue request fails', async () => {
    global.fetch = jest.fn()
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce({
        status: 200,
        text: () => Promise.resolve(JSON.stringify({
          code: 200,
          payload: {
            capabilities: [{
              type: 'devices.capabilities.diy_color_setting',
              instance: 'diyScene',
              parameters: { options: [{ name: 'Party', value: 42 }] },
            }],
          },
        })),
      });
    expect(await resolveSceneByName('key', device, 'Party')).toMatchObject({ value: 42 });
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
      online: true,
    });
  });

  it('parses the online capability as offline', () => {
    const caps = [
      { type: 'devices.capabilities.online', instance: 'online', state: { value: false } },
    ];
    expect(stateFromCapabilities(caps).online).toBe(false);
  });

  it('parses the online capability as online', () => {
    const caps = [
      { type: 'devices.capabilities.online', instance: 'online', state: { value: true } },
    ];
    expect(stateFromCapabilities(caps).online).toBe(true);
  });

  it('accepts a numeric online value', () => {
    expect(stateFromCapabilities([
      { type: 'devices.capabilities.online', instance: 'online', state: { value: 1 } },
    ]).online).toBe(true);
    expect(stateFromCapabilities([
      { type: 'devices.capabilities.online', instance: 'online', state: { value: 0 } },
    ]).online).toBe(false);
  });

  it('assumes online when the device does not report the capability', () => {
    const caps = [
      { type: 'devices.capabilities.on_off', instance: 'powerSwitch', state: { value: 1 } },
    ];
    expect(stateFromCapabilities(caps).online).toBe(true);
  });

  it('keeps the reported power value when offline (caller decides)', () => {
    const caps = [
      { type: 'devices.capabilities.online', instance: 'online', state: { value: false } },
      { type: 'devices.capabilities.on_off', instance: 'powerSwitch', state: { value: 1 } },
    ];
    const state = stateFromCapabilities(caps);
    expect(state.online).toBe(false);
    expect(state.on).toBe(true);
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
    expect(patch).toEqual({ scene: 9, on: true });
    expect(sentCapabilities()).toEqual([
      expect.objectContaining({ instance: 'lightScene', value: 9 }),
    ]);
  });

  it('reports the light as on when a shortcut leaves power alone', async () => {
    const patch = await applyActionsToDevice('key', device, {
      power: null, brightness: 40, colorMode: 'colorTem', colorTem: 3000,
    });
    expect(patch).toEqual({ brightness: 40, colorTem: 3000, scene: null, on: true });
  });

  it('does not claim the light is on when every capability was skipped', async () => {
    const powerOnly = {
      sku: 'H1',
      device: 'CC:DD',
      capabilities: [{ type: 'devices.capabilities.on_off', instance: 'powerSwitch' }],
    };
    const patch = await applyActionsToDevice('key', powerOnly, {
      power: null, brightness: 40, colorMode: 'colorTem', colorTem: 3000,
    });
    expect(patch).toEqual({});
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('skips a scene no catalogue has, sending no control command', async () => {
    const patch = await applyActionsToDevice('key', device, {
      colorMode: 'scene', sceneName: 'Nope',
    });
    expect(patch).toEqual({});
    // The two catalogue lookups run, but nothing is sent to /device/control.
    expect(global.fetch.mock.calls.map(([url]) => url).some((u) => u.includes('/device/control')))
      .toBe(false);
  });

  it('applies a DIY scene resolved from the catalogue', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ code: 200, payload: { capabilities: [] } })),
      })
      .mockResolvedValueOnce({
        status: 200,
        text: () => Promise.resolve(JSON.stringify({
          code: 200,
          payload: {
            capabilities: [{
              type: 'devices.capabilities.diy_color_setting',
              instance: 'diyScene',
              parameters: { options: [{ name: 'Party', value: 42 }] },
            }],
          },
        })),
      })
      .mockResolvedValue({
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ code: 200 })),
      });

    const patch = await applyActionsToDevice('key', device, {
      colorMode: 'scene', sceneName: 'Party',
    });
    expect(patch).toEqual({ scene: 42, on: true });
    expect(JSON.parse(global.fetch.mock.calls[2][1].body).payload.capability).toEqual({
      type: 'devices.capabilities.diy_color_setting',
      instance: 'diyScene',
      value: 42,
    });
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
