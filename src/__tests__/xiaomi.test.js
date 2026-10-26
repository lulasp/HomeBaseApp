jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../config/firebase', () => ({
  auth: { currentUser: { getIdToken: jest.fn().mockResolvedValue('id-token') } },
}));

import { createHash } from 'crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { auth } from '../config/firebase';
import {
  getDeviceType,
  getFanSpec,
  getHeaterSpec,
  fanStateFromProps,
  heaterStateFromProps,
  clampTargetTemp,
  setFanMode,
  setFanOscillation,
  setFanSpeed,
  setFanTimer,
  setFanChildLock,
  setFanDisplay,
  setFanBeep,
  getFanState,
  setHeaterPower,
  parseResponse,
  setHeaterTargetTemp,
  setHeaterMode,
  setHeaterCountdown,
  setHeaterOscillation,
  setHeaterChildLock,
  setHeaterDisplay,
  setHeaterBeep,
  getHeaterState,
  getVacuumSpec,
  vacuumStateFromProps,
  startCleaning,
  pauseCleaning,
  resumeCleaning,
  returnToDock,
  findVacuum,
  setVacuumSuction,
  getVacuumState,
  resetVacuumPart,
  getHomes,
  getScenes,
  runScene,
} from '../services/xiaomi';

const P18    = { did: '411402474', model: 'dmaker.fan.p18' };
const P39    = { did: '548217343', model: 'dmaker.fan.p39' };
const HEATER = { did: '582750941', model: 'leshow.heater.nfj3lx' };
const UNKNOWN_HEATER = { did: '1', model: 'zhimi.heater.mc2' };
const X20    = { did: '1140536873', model: 'xiaomi.vacuum.d109gl' };
const UNKNOWN_VACUUM = { did: '2', model: 'roborock.vacuum.s5' };

const jsonResponse = (body, status = 200) => ({ status, text: () => Promise.resolve(JSON.stringify(body)) });
const textResponse = (text, status) => ({ status, text: () => Promise.resolve(text) });

const SETTINGS = { childLock: false, display: true, beep: true };

const SSECURITY = Buffer.from('test-ssecurity-key').toString('base64');

// RC4-drop[1024] (symmetric) so tests can read requests and fake encrypted replies.
function rc4(keyB64, data) {
  const key = Buffer.from(keyB64, 'base64');
  const S = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) % 256;
    [S[i], S[j]] = [S[j], S[i]];
  }
  let ii = 0, jj = 0;
  const step = () => {
    ii = (ii + 1) % 256;
    jj = (jj + S[ii]) % 256;
    [S[ii], S[jj]] = [S[jj], S[ii]];
    return S[(S[ii] + S[jj]) % 256];
  };
  for (let k = 0; k < 1024; k++) step();
  return Buffer.from(data.map(b => b ^ step()));
}
const rc4Decrypt = (keyB64, dataB64) => rc4(keyB64, Buffer.from(dataB64, 'base64')).toString('utf8');
const rc4Encrypt = (keyB64, text) => rc4(keyB64, Buffer.from(text, 'utf8')).toString('base64');

const signedNonceFor = (nonce) => createHash('sha256')
  .update(Buffer.concat([Buffer.from(SSECURITY, 'base64'), Buffer.from(nonce, 'base64')]))
  .digest('base64');

const sha1 = (s) => createHash('sha1').update(s).digest('base64');

// Decodes a fetch call into { url, data } (data = the RPC payload).
function decodeCall([url, opts]) {
  const fields = Object.fromEntries(new URLSearchParams(opts.body));
  return { url, data: JSON.parse(rc4Decrypt(signedNonceFor(fields._nonce), fields.data)) };
}
const lastRequest = () => decodeCall(global.fetch.mock.calls.at(-1));

beforeEach(() => {
  const store = {
    '@xiaomi/userId': '123',
    '@xiaomi/serviceToken': 'token',
    '@xiaomi/ssecurity': SSECURITY,
    '@xiaomi/region': 'de',
  };
  AsyncStorage.getItem.mockImplementation((k) => Promise.resolve(store[k] ?? null));
  global.fetch = jest.fn().mockResolvedValue(jsonResponse({ code: 0, result: [] }));
});

describe('getDeviceType', () => {
  it.each([
    ['dmaker.fan.p18', 'fan'],
    ['dmaker.fan.p39', 'fan'],
    ['zhimi.fan.za4', 'fan'],
    ['leshow.heater.nfj3lx', 'heater'],
    ['zhimi.heater.mc2', 'heater'],
    ['xiaomi.vacuum.d109gl', 'vacuum'],
    ['roborock.s7', 'vacuum'],
    ['yeelink.light.ceiling', 'other'],
  ])('%s → %s', (model, expected) => expect(getDeviceType({ model })).toBe(expected));

  it('is case-insensitive', () => expect(getDeviceType({ model: 'Leshow.Heater.X' })).toBe('heater'));
  it('handles a missing model', () => expect(getDeviceType({})).toBe('other'));
});

describe('specs', () => {
  it('p18 uses speed piid 10 and two modes', () => {
    expect(getFanSpec('dmaker.fan.p18').props.speed).toEqual([2, 10]);
    expect(getFanSpec('dmaker.fan.p18').modes).toEqual([0, 1]);
  });

  it('p39 uses mode piid 4 and oscillation piid 5', () => {
    expect(getFanSpec('dmaker.fan.p39').props.mode).toEqual([2, 4]);
    expect(getFanSpec('dmaker.fan.p39').props.oscillate).toEqual([2, 5]);
  });

  it('unknown fans fall back to the default spec', () =>
    expect(getFanSpec('dmaker.fan.nope').props.mode).toEqual([2, 3]));

  it('unknown heaters only expose power', () =>
    expect(Object.keys(getHeaterSpec('zhimi.heater.mc2').props)).toEqual(['on']));
});

describe('fanStateFromProps', () => {
  it('reads p39 mode and oscillation from their own piids', () => {
    const props = [
      { siid: 2, piid: 1, value: true },
      { siid: 2, piid: 2, value: 3 },
      { siid: 2, piid: 4, value: 2 },
      { siid: 2, piid: 5, value: true },
      { siid: 2, piid: 11, value: 60 },
    ];
    expect(fanStateFromProps(props, P39.model))
      .toEqual({ on: true, level: 3, mode: 2, oscillate: true, speed: 60, timer: 0, ...SETTINGS });
  });

  it('reads p18 speed from piid 10', () =>
    expect(fanStateFromProps([{ siid: 2, piid: 10, value: 42 }], P18.model).speed).toBe(42));

  it('keeps defaults for missing or null values', () =>
    expect(fanStateFromProps([{ siid: 2, piid: 1, value: null }], P18.model))
      .toEqual({ on: false, level: 1, mode: 0, oscillate: false, speed: 25, timer: 0, ...SETTINGS }));

  it.each([
    ['p18', P18, { timer: [2, 6], display: [2, 7], beep: [2, 8], childLock: [3, 1] }],
    ['p39', P39, { timer: [2, 8], display: [2, 9], beep: [2, 7], childLock: [3, 1] }],
  ])('reads %s timer and settings from their own piids', (_, device, ids) => {
    const values = { timer: 90, display: false, beep: false, childLock: true };
    const props = Object.entries(ids).map(([k, [siid, piid]]) => ({ siid, piid, value: values[k] }));
    expect(fanStateFromProps(props, device.model)).toMatchObject(values);
  });

  it('handles undefined props', () => expect(fanStateFromProps(undefined, P18.model).on).toBe(false));
});

describe('heaterStateFromProps', () => {
  it('maps every nfj3lx property', () => {
    const props = [
      { siid: 2, piid: 1, value: true },
      { siid: 2, piid: 2, value: 0 },
      { siid: 2, piid: 3, value: 24 },
      { siid: 2, piid: 5, value: 1 },
      { siid: 3, piid: 1, value: 90 },
      { siid: 4, piid: 7, value: 19 },
      { siid: 8, piid: 1, value: true },
      { siid: 5, piid: 1, value: true },
      { siid: 6, piid: 1, value: false },
      { siid: 7, piid: 1, value: false },
    ];
    expect(heaterStateFromProps(props, HEATER.model)).toEqual({
      on: true, fault: 0, targetTemp: 24, temperature: 19, mode: 1, countdown: 90, oscillate: true,
      childLock: true, beep: false, display: false,
    });
  });

  it('leaves temperatures null when unreported', () => {
    const s = heaterStateFromProps([], HEATER.model);
    expect(s.targetTemp).toBeNull();
    expect(s.temperature).toBeNull();
  });

  it('ignores non-power props for unknown heaters', () =>
    expect(heaterStateFromProps([{ siid: 2, piid: 3, value: 25 }], UNKNOWN_HEATER.model).targetTemp).toBeNull());
});

describe('clampTargetTemp', () => {
  it('clamps below range', () => expect(clampTargetTemp(HEATER.model, 18)).toBe(22));
  it('clamps above range', () => expect(clampTargetTemp(HEATER.model, 30)).toBe(28));
  it('keeps in-range values', () => expect(clampTargetTemp(HEATER.model, 25)).toBe(25));
  it('passes through when the model has no range', () => expect(clampTargetTemp(UNKNOWN_HEATER.model, 40)).toBe(40));
});

describe('fan commands', () => {
  it('p39 mode writes piid 4', async () => {
    await setFanMode(P39, 2);
    const { url, data } = lastRequest();
    expect(url).toBe(`https://de.api.io.mi.com/app/v2/home/rpc/${P39.did}`);
    expect(data).toEqual({ method: 'set_properties', params: [{ did: P39.did, siid: 2, piid: 4, value: 2 }] });
  });

  it('p39 oscillation writes piid 5', async () => {
    await setFanOscillation(P39, true);
    expect(lastRequest().data.params[0]).toMatchObject({ siid: 2, piid: 5, value: true });
  });

  it('p18 speed writes piid 10', async () => {
    await setFanSpeed(P18, 50);
    expect(lastRequest().data.params[0]).toMatchObject({ siid: 2, piid: 10, value: 50 });
  });

  it('getFanState requests every spec property', async () => {
    await getFanState(P18);
    const { data } = lastRequest();
    expect(data.method).toBe('get_properties');
    expect(data.params.map(p => `${p.siid}.${p.piid}`)).toEqual(['2.1', '2.2', '2.3', '2.4', '2.10', '2.6', '2.7', '2.8', '3.1']);
  });

  it.each([
    ['timer', setFanTimer, 120, { p18: [2, 6], p39: [2, 8] }],
    ['child lock', setFanChildLock, true, { p18: [3, 1], p39: [3, 1] }],
    ['display', setFanDisplay, false, { p18: [2, 7], p39: [2, 9] }],
    ['beep', setFanBeep, false, { p18: [2, 8], p39: [2, 7] }],
  ])('%s writes the per-model piid', async (_, fn, value, ids) => {
    for (const [device, [siid, piid]] of [[P18, ids.p18], [P39, ids.p39]]) {
      await fn(device, value);
      expect(lastRequest().data.params[0]).toEqual({ did: device.did, siid, piid, value });
    }
  });

  it('rejects settings on unknown fans without a request', async () => {
    await expect(setFanChildLock({ did: '3', model: 'zhimi.fan.za4' }, true)).rejects.toThrow('UNSUPPORTED: childLock');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('heater commands', () => {
  it('power writes 2.1', async () => {
    await setHeaterPower(HEATER, true);
    expect(lastRequest().data.params[0]).toEqual({ did: HEATER.did, siid: 2, piid: 1, value: true });
  });

  it('target temperature writes 2.3 and clamps', async () => {
    await setHeaterTargetTemp(HEATER, 35);
    expect(lastRequest().data.params[0]).toMatchObject({ siid: 2, piid: 3, value: 28 });
  });

  it('mode writes 2.5', async () => {
    await setHeaterMode(HEATER, 3);
    expect(lastRequest().data.params[0]).toMatchObject({ siid: 2, piid: 5, value: 3 });
  });

  it('countdown writes 3.1', async () => {
    await setHeaterCountdown(HEATER, 120);
    expect(lastRequest().data.params[0]).toMatchObject({ siid: 3, piid: 1, value: 120 });
  });

  it('oscillation writes 8.1', async () => {
    await setHeaterOscillation(HEATER, false);
    expect(lastRequest().data.params[0]).toMatchObject({ siid: 8, piid: 1, value: false });
  });

  it('getHeaterState requests every spec property', async () => {
    await getHeaterState(HEATER);
    expect(lastRequest().data.params.map(p => `${p.siid}.${p.piid}`))
      .toEqual(['2.1', '2.2', '2.3', '2.5', '3.1', '4.7', '8.1', '5.1', '6.1', '7.1']);
  });

  it.each([
    ['child lock', setHeaterChildLock, true, 5],
    ['beep', setHeaterBeep, false, 6],
    ['display', setHeaterDisplay, false, 7],
  ])('%s writes its own siid', async (_, fn, value, siid) => {
    await fn(HEATER, value);
    expect(lastRequest().data.params[0]).toEqual({ did: HEATER.did, siid, piid: 1, value });
  });

  it('rejects settings on unknown heaters without a request', async () => {
    await expect(setHeaterBeep(UNKNOWN_HEATER, false)).rejects.toThrow('UNSUPPORTED: beep');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects unsupported properties without a request', async () => {
    await expect(setHeaterMode(UNKNOWN_HEATER, 1)).rejects.toThrow('UNSUPPORTED');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('surfaces Mi API errors', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ code: -8, message: 'auth err' }));
    await expect(setHeaterPower(HEATER, true)).rejects.toThrow('auth err');
  });

  it('throws NOT_CONFIGURED without credentials', async () => {
    AsyncStorage.getItem.mockResolvedValue(null);
    await expect(setHeaterPower(HEATER, true)).rejects.toThrow('NOT_CONFIGURED');
  });
});

describe('vacuumStateFromProps', () => {
  const x20 = (status, suction = 2) => [
    { siid: 2, piid: 2, value: status },
    { siid: 2, piid: 3, value: 0 },
    { siid: 2, piid: 9, value: suction },
    { siid: 3, piid: 1, value: 77 },
  ];

  it.each([
    [1, 'idle'], [2, 'charging'], [4, 'cleaning'], [5, 'paused'], [6, 'returning'],
    [7, 'washing'], [9, 'charged'], [10, 'mapping'], [15, 'error'], [16, 'cleaning'], [19, 'paused'],
  ])('X20 status %i → %s', (raw, expected) =>
    expect(vacuumStateFromProps(x20(raw), X20.model).status).toBe(expected));

  it('reads battery and maps suction value to its index', () => {
    const s = vacuumStateFromProps(x20(4, 4), X20.model);
    expect(s.battery).toBe(77);
    expect(s.suction).toBe(3);
  });

  it('marks unmapped status codes unknown and keeps the raw code', () => {
    const s = vacuumStateFromProps(x20(99), X20.model);
    expect(s.status).toBe('unknown');
    expect(s.rawStatus).toBe(99);
  });

  it('defaults to idle and standard suction when nothing is reported', () =>
    expect(vacuumStateFromProps([], X20.model)).toMatchObject({ status: 'idle', suction: 1, battery: 100 }));

  it('uses the legacy mapping for unknown models', () => {
    const props = [{ siid: 2, piid: 1, value: 1 }, { siid: 2, piid: 8, value: 0 }];
    expect(vacuumStateFromProps(props, UNKNOWN_VACUUM.model)).toMatchObject({ status: 'cleaning', suction: 0 });
  });

  it('reads cleaning area and time', () => {
    const props = [...x20(4), { siid: 2, piid: 6, value: 42 }, { siid: 2, piid: 7, value: 1800 }];
    expect(vacuumStateFromProps(props, X20.model)).toMatchObject({ cleanArea: 42, cleanTime: 1800 });
  });

  it('lists reported parts in spec order with life and hours left', () => {
    const props = [
      { siid: 14, piid: 1, value: 30 }, { siid: 14, piid: 2, value: 45 },
      { siid: 12, piid: 1, value: 80 }, { siid: 12, piid: 2, value: 240 },
      { siid: 18, piid: 1, value: 60 },
    ];
    expect(vacuumStateFromProps(props, X20.model).parts).toEqual([
      { key: 'mainBrush', life: 80, hoursLeft: 240 },
      { key: 'filter',    life: 30, hoursLeft: 45 },
      { key: 'detergent', life: 60, hoursLeft: null },
    ]);
  });

  it('skips parts the device did not report (e.g. failed props)', () => {
    const props = [{ siid: 19, piid: 1, code: -4004 }, { siid: 9, piid: 1, value: 0 }];
    expect(vacuumStateFromProps(props, X20.model).parts).toEqual([{ key: 'mop', life: 0, hoursLeft: null }]);
  });

  it('has no parts or stats for unknown models', () =>
    expect(vacuumStateFromProps([], UNKNOWN_VACUUM.model)).toMatchObject({ parts: [], cleanArea: null, cleanTime: null }));

  it('every X20 status code from the spec is mapped', () => {
    const map = getVacuumSpec(X20.model).statusMap;
    for (let code = 1; code <= 21; code++) expect(map[code]).toBeDefined();
  });
});

describe('vacuum commands', () => {
  const lastAction = () => lastRequest().data.params;

  it.each([
    ['start', startCleaning, 2, 1],
    ['pause', pauseCleaning, 2, 7],
    ['resume', resumeCleaning, 2, 8],
    ['dock', returnToDock, 2, 3],
    ['find', findVacuum, 6, 1],
  ])('X20 %s → action %i.%i', async (_, fn, siid, aiid) => {
    await fn(X20);
    expect(lastRequest().data.method).toBe('action');
    expect(lastAction()).toEqual({ did: X20.did, siid, aiid, in: [] });
  });

  it('legacy pause stays 2.2', async () => {
    await pauseCleaning(UNKNOWN_VACUUM);
    expect(lastAction()).toMatchObject({ siid: 2, aiid: 2 });
  });

  it('resume falls back to start without a resume action', async () => {
    await resumeCleaning(UNKNOWN_VACUUM);
    expect(lastAction()).toMatchObject({ siid: 2, aiid: 1 });
  });

  it('X20 suction index writes the raw value to 2.9', async () => {
    await setVacuumSuction(X20, 0);
    expect(lastRequest().data.params[0]).toMatchObject({ siid: 2, piid: 9, value: 1 });
  });

  it('rejects an out-of-range suction index without a request', async () => {
    await expect(setVacuumSuction(X20, 4)).rejects.toThrow('INVALID_SUCTION');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('getVacuumState requests the X20 status, stats and part properties', async () => {
    await getVacuumState(X20);
    expect(lastRequest().data.params.map(p => `${p.siid}.${p.piid}`)).toEqual([
      '2.2', '2.3', '2.9', '3.1', '2.6', '2.7',
      '12.1', '12.2', '13.1', '13.2', '14.1', '14.2', '9.1', '9.2', '19.1', '19.2', '18.1',
    ]);
  });

  it('getVacuumState only asks unknown models for the base properties', async () => {
    await getVacuumState(UNKNOWN_VACUUM);
    expect(lastRequest().data.params).toHaveLength(4);
  });

  it.each([
    ['mainBrush', 12], ['sideBrush', 13], ['filter', 14], ['mop', 9], ['dustBag', 19], ['detergent', 18],
  ])('resetVacuumPart %s → action %i.1', async (key, siid) => {
    await resetVacuumPart(X20, key);
    expect(lastAction()).toEqual({ did: X20.did, siid, aiid: 1, in: [] });
  });

  it('rejects resetting an unknown part without a request', async () => {
    await expect(resetVacuumPart(UNKNOWN_VACUUM, 'filter')).rejects.toThrow('UNSUPPORTED: filter');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('web proxy', () => {
  const originalOS = Platform.OS;
  beforeEach(() => { Platform.OS = 'web'; });
  afterEach(() => {
    Platform.OS = originalOS;
    auth.currentUser = { getIdToken: jest.fn().mockResolvedValue('id-token') };
  });

  const proxyCall = () => {
    const [url, opts] = global.fetch.mock.calls.at(-1);
    return { url, opts, payload: JSON.parse(opts.body) };
  };

  it('posts to /api/xiaomi with the Firebase ID token and no Cookie header', async () => {
    await setHeaterPower(HEATER, true);
    const { url, opts } = proxyCall();
    expect(url).toBe('/api/xiaomi');
    expect(opts.headers.Authorization).toBe('Bearer id-token');
    expect(opts.headers.Cookie).toBeUndefined();
  });

  it('sends region, path and session creds', async () => {
    await setHeaterPower(HEATER, true);
    const { payload } = proxyCall();
    expect(payload).toMatchObject({
      region: 'de', path: `/app/v2/home/rpc/${HEATER.did}`, userId: '123', serviceToken: 'token',
    });
    expect(payload).not.toHaveProperty('ssecurity');
  });

  it('still signs and encrypts the body in the browser', async () => {
    await setHeaterPower(HEATER, true);
    const fields = Object.fromEntries(new URLSearchParams(proxyCall().payload.body));
    expect(fields).toHaveProperty('signature');
    expect(fields).toHaveProperty('rc4_hash__');
    expect(fields.data).not.toContain('set_properties');
  });

  it('falls back to cn for an unknown region', async () => {
    AsyncStorage.getItem.mockImplementation((k) => Promise.resolve({
      '@xiaomi/userId': '123', '@xiaomi/serviceToken': 'token',
      '@xiaomi/ssecurity': SSECURITY, '@xiaomi/region': 'mars',
    }[k] ?? null));
    await setHeaterPower(HEATER, true);
    expect(proxyCall().payload.region).toBe('cn');
  });

  it('throws without a signed-in user and makes no request', async () => {
    auth.currentUser = null;
    await expect(setHeaterPower(HEATER, true)).rejects.toThrow('Sign in');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('turns a Vercel crash page into a readable proxy error', async () => {
    global.fetch.mockResolvedValueOnce(textResponse('A server error has occurred\n\nFUNCTION_INVOCATION_FAILED', 500));
    await expect(setHeaterPower(HEATER, true))
      .rejects.toThrow('Mi Cloud proxy error (500): A server error has occurred');
  });

  it('surfaces proxy errors', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ code: -1, message: 'Invalid sign-in token' }));
    await expect(setHeaterPower(HEATER, true)).rejects.toThrow('Invalid sign-in token');
  });
});

describe('homes and scenes', () => {
  const SCENES_URL = 'https://de.api.io.mi.com/app/appgateway/miot/appsceneservice/AppSceneService';
  const HOMES = [{ id: '589001096441', uid: 8278474663, name: 'Home' }, { id: '7', uid: 99, name: 'Shared' }];
  const SCENES = {
    '589001096441': [{ scene_id: 111, name: 'Good night' }, { scene_id: 112 }],
    '7': [{ scene_id: '700', name: 'Away' }],
  };

  // Answers by endpoint (and home_id for scene lists).
  const mockCloud = ({ homes = HOMES, scenes = SCENES } = {}) =>
    global.fetch.mockImplementation((url, opts) => {
      const { data } = decodeCall([url, opts]);
      if (url.endsWith('/v2/homeroom/gethome_merged')) return Promise.resolve(jsonResponse({ code: 0, result: { homelist: homes } }));
      if (url.endsWith('/GetSimpleSceneList')) {
        return Promise.resolve(jsonResponse({ code: 0, result: { manual_scene_info_list: scenes[data.home_id] } }));
      }
      return Promise.resolve(jsonResponse({ code: 0, result: {} }));
    });

  it('getHomes asks for own and shared homes', async () => {
    mockCloud();
    expect(await getHomes()).toEqual(HOMES);
    const { url, data } = lastRequest();
    expect(url).toBe('https://de.api.io.mi.com/app/v2/homeroom/gethome_merged');
    expect(data).toMatchObject({ fetch_share: true, fetch_share_dev: true });
  });

  it('getHomes returns [] without a homelist', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ code: 0, result: {} }));
    expect(await getHomes()).toEqual([]);
  });

  it('getScenes lists manual scenes from every home with their owner', async () => {
    mockCloud();
    expect(await getScenes()).toEqual([
      { id: '111', name: 'Good night', homeId: '589001096441', ownerUid: 8278474663 },
      { id: '112', name: 'Scene',      homeId: '589001096441', ownerUid: 8278474663 },
      { id: '700', name: 'Away',       homeId: '7',            ownerUid: 99 },
    ]);
    const sceneCalls = global.fetch.mock.calls.filter(([url]) => url === `${SCENES_URL}/GetSimpleSceneList`).map(decodeCall);
    expect(sceneCalls.map(c => c.data)).toEqual([
      { app_version: 12, get_type: 2, home_id: '589001096441', owner_uid: 8278474663 },
      { app_version: 12, get_type: 2, home_id: '7', owner_uid: 99 },
    ]);
  });

  it('getScenes tolerates homes without scenes', async () => {
    mockCloud({ scenes: {} });
    expect(await getScenes()).toEqual([]);
  });

  it('getScenes surfaces Mi errors', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ code: -8, message: 'auth err' }));
    await expect(getScenes()).rejects.toThrow('auth err');
  });

  it('runScene sends the scene, its home and owner', async () => {
    await runScene({ id: '111', name: 'Good night', homeId: '589001096441', ownerUid: 8278474663 });
    const { url, data } = lastRequest();
    expect(url).toBe(`${SCENES_URL}/NewRunScene`);
    expect(data).toEqual({
      scene_id: '111', scene_type: 2, phone_id: 'null', home_id: '589001096441', owner_uid: 8278474663,
    });
  });
});

describe('request signing', () => {
  const fieldsOf = (call = global.fetch.mock.calls.at(-1)) => Object.fromEntries(new URLSearchParams(call[1].body));

  it('hashes the plain params, then signs the encrypted ones without the /app prefix', async () => {
    await setHeaterPower(HEATER, true);
    const fields = fieldsOf();
    const signedNonce = signedNonceFor(fields._nonce);
    const plainData = rc4Decrypt(signedNonce, fields.data);
    const path = `/v2/home/rpc/${HEATER.did}`;

    expect(rc4Decrypt(signedNonce, fields.rc4_hash__))
      .toBe(sha1(`POST&${path}&data=${plainData}&${signedNonce}`));
    expect(fields.signature)
      .toBe(sha1(`POST&${path}&data=${fields.data}&rc4_hash__=${fields.rc4_hash__}&${signedNonce}`));
  });

  it('appends ssecurity and _nonce unencrypted after the signature', async () => {
    await setHeaterPower(HEATER, true);
    const fields = fieldsOf();
    expect(Object.keys(fields)).toEqual(['data', 'rc4_hash__', 'signature', 'ssecurity', '_nonce']);
    expect(fields.ssecurity).toBe(SSECURITY);
    expect(Buffer.from(fields._nonce, 'base64')).toHaveLength(12);
  });

  it('decrypts encrypted replies with the request nonce', async () => {
    global.fetch.mockImplementationOnce((url, opts) => {
      const { _nonce } = Object.fromEntries(new URLSearchParams(opts.body));
      const body = JSON.stringify({ code: 0, result: [{ siid: 2, piid: 1, value: true, code: 0 }] });
      return Promise.resolve(textResponse(rc4Encrypt(signedNonceFor(_nonce), body), 200));
    });
    expect(await getHeaterState(HEATER)).toEqual([{ siid: 2, piid: 1, value: true, code: 0 }]);
  });

  it('rejects a code 0 reply without a result, e.g. a bad signature', async () => {
    global.fetch.mockResolvedValueOnce(jsonResponse({ code: 0, message: 'invalid signature' }));
    await expect(setHeaterPower(HEATER, true)).rejects.toThrow('invalid signature');
  });

  it('rejects a 200 reply that neither parses nor decrypts', async () => {
    global.fetch.mockResolvedValueOnce(textResponse('<html>oops</html>', 200));
    await expect(setHeaterPower(HEATER, true)).rejects.toThrow('error (200): <html>oops');
  });
});

describe('parseResponse', () => {
  it('parses JSON bodies', async () =>
    expect(await parseResponse(jsonResponse({ code: 0 }))).toEqual({ code: 0 }));

  it('throws a readable error for plain text', async () =>
    expect(parseResponse(textResponse('auth err', 401))).rejects.toThrow('Mi Cloud error (401): auth err'));

  it('handles an empty body', async () =>
    expect(parseResponse(textResponse('', 502))).rejects.toThrow('(502): empty response'));

  it('truncates long bodies', async () => {
    const err = await parseResponse(textResponse('<html>' + 'x'.repeat(500), 500)).catch(e => e);
    expect(err.message.length).toBeLessThan(160);
  });
});
