import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { auth } from '../config/firebase';

const REGIONS = {
  cn: 'api.io.mi.com',
  us: 'us.api.io.mi.com',
  eu: 'eu.api.io.mi.com',
  ru: 'ru.api.io.mi.com',
  sg: 'sg.api.io.mi.com',
  in: 'in.api.io.mi.com',
  de: 'de.api.io.mi.com',
  tw: 'tw.api.io.mi.com',
};

// Web relays through our Vercel function (api/xiaomi.js): browsers can't call
// Mi Cloud directly (no CORS, no Cookie header).
const WEB_PROXY_PATH = '/api/xiaomi';

const STORAGE_KEYS = {
  userId:       '@xiaomi/userId',
  serviceToken: '@xiaomi/serviceToken',
  ssecurity:    '@xiaomi/ssecurity',
  region:       '@xiaomi/region',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function bytesToBase64(bytes) {
  return btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
}

function base64ToBytes(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

function generateNonce() {
  const random = new Uint8Array(8);
  crypto.getRandomValues(random);
  const mins = Math.floor(Date.now() / 60000);
  const timeBytes = new Uint8Array(4);
  timeBytes[0] = (mins >> 24) & 0xFF;
  timeBytes[1] = (mins >> 16) & 0xFF;
  timeBytes[2] = (mins >> 8)  & 0xFF;
  timeBytes[3] =  mins        & 0xFF;
  const nonce = new Uint8Array(12);
  nonce.set(random);
  nonce.set(timeBytes, 8);
  return bytesToBase64(nonce);
}

async function computeSignedNonce(ssecurity, nonce) {
  const combined = new Uint8Array([...base64ToBytes(ssecurity), ...base64ToBytes(nonce)]);
  const hash = await crypto.subtle.digest('SHA-256', combined);
  return bytesToBase64(new Uint8Array(hash));
}

async function hmacSha256(keyBase64, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    base64ToBytes(keyBase64),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToBase64(new Uint8Array(sig));
}

// RC4-drop[1024] encryption used by the Xiaomi Cloud API
function rc4Encrypt(keyBase64, data) {
  const key = base64ToBytes(keyBase64);
  const S = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) % 256;
    [S[i], S[j]] = [S[j], S[i]];
  }
  let ii = 0, jj = 0;
  for (let k = 0; k < 1024; k++) {
    ii = (ii + 1) % 256;
    jj = (jj + S[ii]) % 256;
    [S[ii], S[jj]] = [S[jj], S[ii]];
  }
  const dataBytes = new TextEncoder().encode(typeof data === 'string' ? data : JSON.stringify(data));
  const output = new Uint8Array(dataBytes.length);
  for (let k = 0; k < dataBytes.length; k++) {
    ii = (ii + 1) % 256;
    jj = (jj + S[ii]) % 256;
    [S[ii], S[jj]] = [S[jj], S[ii]];
    output[k] = dataBytes[k] ^ S[(S[ii] + S[jj]) % 256];
  }
  return bytesToBase64(output);
}

async function buildSignedParams(apiPath, params, ssecurity) {
  const nonce = generateNonce();
  const signedNonce = await computeSignedNonce(ssecurity, nonce);

  // Encrypt each param value with RC4
  const enc = {};
  for (const [k, v] of Object.entries(params)) {
    enc[k] = rc4Encrypt(signedNonce, typeof v === 'string' ? v : JSON.stringify(v));
  }
  enc._nonce = nonce;

  const sortedPairs1 = Object.keys(enc).sort().map(k => `${k}=${enc[k]}`).join('&');
  enc.rc4_hash__ = await hmacSha256(signedNonce, `POST&${apiPath}&${sortedPairs1}`);

  const sortedPairs2 = Object.keys(enc).sort().map(k => `${k}=${enc[k]}`).join('&');
  enc.signature = await hmacSha256(signedNonce, `POST&${apiPath}&${sortedPairs2}`);

  return enc;
}

// ── Credentials ───────────────────────────────────────────────────────────────

export async function getCredentials() {
  const [userId, serviceToken, ssecurity, region] = await Promise.all([
    AsyncStorage.getItem(STORAGE_KEYS.userId),
    AsyncStorage.getItem(STORAGE_KEYS.serviceToken),
    AsyncStorage.getItem(STORAGE_KEYS.ssecurity),
    AsyncStorage.getItem(STORAGE_KEYS.region),
  ]);
  return {
    userId:       userId       ?? '',
    serviceToken: serviceToken ?? '',
    ssecurity:    ssecurity    ?? '',
    region:       region       ?? 'cn',
  };
}

export async function saveCredentials({ userId, serviceToken, ssecurity, region }) {
  await Promise.all([
    AsyncStorage.setItem(STORAGE_KEYS.userId,       userId       ?? ''),
    AsyncStorage.setItem(STORAGE_KEYS.serviceToken, serviceToken ?? ''),
    AsyncStorage.setItem(STORAGE_KEYS.ssecurity,    ssecurity    ?? ''),
    AsyncStorage.setItem(STORAGE_KEYS.region,       region       ?? 'cn'),
  ]);
}

export function hasCredentials(c) {
  return !!(c.userId && c.serviceToken && c.ssecurity);
}

// Pull shared household credentials into this device's cache, so the
// signed-request path (which reads AsyncStorage) can use them. No-op if the
// household has no complete credential set, so local creds aren't wiped.
export async function syncCredentialsFromHousehold(creds) {
  if (!creds || !hasCredentials(creds)) return false;
  await saveCredentials(creds);
  return true;
}

// ── Core request ──────────────────────────────────────────────────────────────

// Non-JSON bodies (Vercel crash pages, Mi plain-text errors) become a readable error.
export async function parseResponse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const source = Platform.OS === 'web' ? 'Mi Cloud proxy' : 'Mi Cloud';
    throw new Error(`${source} error (${res.status}): ${text.slice(0, 120).trim() || 'empty response'}`);
  }
}

async function proxyFetch(payload) {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error('Sign in to use Xiaomi devices');
  return fetch(WEB_PROXY_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(payload),
  });
}

async function miRequest(path, data = {}) {
  const creds = await getCredentials();
  if (!hasCredentials(creds)) throw new Error('NOT_CONFIGURED');

  const region  = REGIONS[creds.region] ? creds.region : 'cn';
  const apiPath = `/app${path}`;

  const signed = await buildSignedParams(apiPath, { data: JSON.stringify(data) }, creds.ssecurity);

  const body = Object.entries(signed)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const res = Platform.OS === 'web'
    ? await proxyFetch({ region, path: apiPath, body, userId: creds.userId, serviceToken: creds.serviceToken })
    : await fetch(`https://${REGIONS[region]}${apiPath}`, {
        method: 'POST',
        headers: {
          'Content-Type':                   'application/x-www-form-urlencoded',
          'Cookie':                         `userId=${creds.userId}; serviceToken=${creds.serviceToken}; locale=en_US`,
          'User-Agent':                     'Android-7.1.1-1.0.0-ONEPLUS A3010-136-',
          'Accept-Encoding':                'gzip',
          'MIOT-ENCRYPT-ALGORITHM':         'ENCRYPT-RC4',
        },
        body,
      });

  const json = await parseResponse(res);
  if (json.code !== 0) throw new Error(json.message || `Mi API error (code: ${json.code})`);
  return json.result;
}

// ── Devices ───────────────────────────────────────────────────────────────────

export async function getDevices() {
  const result = await miRequest('/home/device_list', {
    getVirtualModel: false,
    getHuamiDevices: 0,
  });
  return result?.list ?? [];
}

// ── Generic MiIO RPC ──────────────────────────────────────────────────────────

export async function callDevice(did, method, params) {
  return miRequest(`/v2/home/rpc/${did}`, { method, params });
}

// ── Device type detection ─────────────────────────────────────────────────────

const FAN_TOKENS    = ['fan', 'zhimi', 'dmaker.fan', 'leshow.fan'];
const HEATER_TOKENS = ['heater'];
const VACUUM_TOKENS = ['vacuum', 'roborock', 'dreame', 'viomi.vacuum', 'mijia.vacuum'];

// Heater before fan: zhimi.heater.* would otherwise match the 'zhimi' fan token.
export function getDeviceType(device) {
  const model = (device.model ?? '').toLowerCase();
  if (VACUUM_TOKENS.some(t => model.includes(t))) return 'vacuum';
  if (HEATER_TOKENS.some(t => model.includes(t))) return 'heater';
  if (FAN_TOKENS.some(t => model.includes(t)))    return 'fan';
  return 'other';
}

// ── Per-model MIoT specs ──────────────────────────────────────────────────────
// Property ids are [siid, piid] from miot-spec.org; they differ per model.

const DEFAULT_FAN_SPEC = {
  props: { on: [2, 1], level: [2, 2], mode: [2, 3], oscillate: [2, 4], speed: [2, 11] },
  modes: [0, 1, 2],
};

const FAN_SPECS = {
  'dmaker.fan.p18': {
    props: { on: [2, 1], level: [2, 2], mode: [2, 3], oscillate: [2, 4], speed: [2, 10] },
    modes: [0, 1],
  },
  'dmaker.fan.p39': {
    props: { on: [2, 1], level: [2, 2], mode: [2, 4], oscillate: [2, 5], speed: [2, 11] },
    modes: [0, 1, 2],
  },
};

// Unknown heaters: power only, since other piids vary by model.
const DEFAULT_HEATER_SPEC = {
  props: { on: [2, 1] },
  modes: [],
};

const HEATER_SPECS = {
  'leshow.heater.nfj3lx': {
    props: {
      on: [2, 1], fault: [2, 2], targetTemp: [2, 3], mode: [2, 5],
      countdown: [3, 1], temperature: [4, 7], oscillate: [8, 1],
    },
    tempRange: [22, 28],
    modes: [0, 1, 2, 3],
  },
};

// Vacuum status codes vary per model; statusMap normalises them to:
// idle, cleaning, paused, charging, charged, returning, washing, mapping, updating, error, remote.
// suctionLevels lists the raw values from quietest to strongest.
const DEFAULT_VACUUM_SPEC = {
  props:   { status: [2, 1], error: [2, 2], suction: [2, 8], battery: [3, 1] },
  actions: { start: [2, 1], pause: [2, 2], dock: [2, 3], find: [6, 1] },
  statusMap: { 1: 'cleaning', 2: 'idle', 3: 'paused', 4: 'charging', 5: 'error', 6: 'returning' },
  suctionLevels: [0, 1, 2, 3],
};

const VACUUM_SPECS = {
  'xiaomi.vacuum.d109gl': {
    props:   { status: [2, 2], error: [2, 3], suction: [2, 9], battery: [3, 1] },
    actions: { start: [2, 1], pause: [2, 7], resume: [2, 8], dock: [2, 3], find: [6, 1] },
    statusMap: {
      1: 'idle',     2: 'charging',  3: 'charging',  4: 'cleaning',  5: 'paused',
      6: 'returning', 7: 'washing',  8: 'remote',    9: 'charged',  10: 'mapping',
      11: 'updating', 12: 'washing', 13: 'charging', 14: 'washing', 15: 'error',
      16: 'cleaning', 17: 'cleaning', 18: 'paused',  19: 'paused',  20: 'paused',
      21: 'mapping',
    },
    suctionLevels: [1, 2, 3, 4],
  },
};

export const getFanSpec    = (model) => FAN_SPECS[model]    ?? DEFAULT_FAN_SPEC;
export const getHeaterSpec = (model) => HEATER_SPECS[model] ?? DEFAULT_HEATER_SPEC;
export const getVacuumSpec = (model) => VACUUM_SPECS[model] ?? DEFAULT_VACUUM_SPEC;

// ── State parsing helpers ─────────────────────────────────────────────────────

function propMap(props) {
  const m = {};
  for (const p of (props ?? [])) m[`${p.siid}_${p.piid}`] = p.value;
  return m;
}

// Map raw get_properties results to named fields via a spec.
function stateFromSpec(props, spec, defaults) {
  const m = propMap(props);
  const state = { ...defaults };
  for (const [key, [siid, piid]] of Object.entries(spec.props)) {
    const v = m[`${siid}_${piid}`];
    if (v !== undefined && v !== null) state[key] = v;
  }
  return state;
}

const FAN_DEFAULTS    = { on: false, level: 1, mode: 0, oscillate: false, speed: 25 };
const HEATER_DEFAULTS = { on: false, fault: 0, targetTemp: null, temperature: null, mode: 0, countdown: 0, oscillate: false };

export const fanStateFromProps    = (props, model) => stateFromSpec(props, getFanSpec(model), FAN_DEFAULTS);
export const heaterStateFromProps = (props, model) => stateFromSpec(props, getHeaterSpec(model), HEATER_DEFAULTS);

const VACUUM_DEFAULTS = { status: null, error: 0, suction: null, battery: 100 };

// status → normalised key ('unknown' for unmapped codes); suction → index into suctionLevels.
export function vacuumStateFromProps(props, model) {
  const spec = getVacuumSpec(model);
  const raw  = stateFromSpec(props, spec, VACUUM_DEFAULTS);
  const idx  = spec.suctionLevels.indexOf(raw.suction);
  return {
    status:    raw.status == null ? 'idle' : (spec.statusMap[raw.status] ?? 'unknown'),
    rawStatus: raw.status,
    error:     raw.error,
    suction:   idx === -1 ? 1 : idx,
    battery:   raw.battery,
  };
}

export function clampTargetTemp(model, value) {
  const range = getHeaterSpec(model).tempRange;
  if (!range) return value;
  return Math.min(range[1], Math.max(range[0], value));
}

// ── Spec-driven commands ──────────────────────────────────────────────────────

function setSpecProp(device, spec, key, value) {
  const id = spec.props[key];
  if (!id) return Promise.reject(new Error(`UNSUPPORTED: ${key} on ${device.model}`));
  const [siid, piid] = id;
  return callDevice(device.did, 'set_properties', [{ did: device.did, siid, piid, value }]);
}

function getSpecProps(device, spec) {
  return callDevice(device.did, 'get_properties',
    Object.values(spec.props).map(([siid, piid]) => ({ did: device.did, siid, piid })));
}

// ── Fan commands ──────────────────────────────────────────────────────────────
// All take a device ({ did, model }) so the right spec is used.

const setFanProp = (device, key, value) => setSpecProp(device, getFanSpec(device.model), key, value);

export const setFanPower       = (device, on)      => setFanProp(device, 'on', on);
export const setFanLevel       = (device, level)   => setFanProp(device, 'level', level);
export const setFanMode        = (device, mode)    => setFanProp(device, 'mode', mode);
export const setFanOscillation = (device, enabled) => setFanProp(device, 'oscillate', enabled);
export const setFanSpeed       = (device, percent) => setFanProp(device, 'speed', percent);

export const getFanState = (device) => getSpecProps(device, getFanSpec(device.model));

// ── Heater commands ───────────────────────────────────────────────────────────

const setHeaterProp = (device, key, value) => setSpecProp(device, getHeaterSpec(device.model), key, value);

export const setHeaterPower       = (device, on)      => setHeaterProp(device, 'on', on);
export const setHeaterTargetTemp  = (device, celsius) => setHeaterProp(device, 'targetTemp', clampTargetTemp(device.model, celsius));
export const setHeaterMode        = (device, mode)    => setHeaterProp(device, 'mode', mode);
export const setHeaterOscillation = (device, enabled) => setHeaterProp(device, 'oscillate', enabled);
export const setHeaterCountdown   = (device, minutes) => setHeaterProp(device, 'countdown', minutes);

export const getHeaterState = (device) => getSpecProps(device, getHeaterSpec(device.model));

// ── Vacuum commands ───────────────────────────────────────────────────────────

function vacuumAction(device, key) {
  const spec = getVacuumSpec(device.model);
  const id = spec.actions[key];
  if (!id) return Promise.reject(new Error(`UNSUPPORTED: ${key} on ${device.model}`));
  const [siid, aiid] = id;
  return callDevice(device.did, 'action', { did: device.did, siid, aiid, in: [] });
}

export const startCleaning  = (device) => vacuumAction(device, 'start');
export const pauseCleaning  = (device) => vacuumAction(device, 'pause');
export const returnToDock   = (device) => vacuumAction(device, 'dock');
export const findVacuum     = (device) => vacuumAction(device, 'find');
// Models without a resume action restart via start.
export const resumeCleaning = (device) =>
  vacuumAction(device, getVacuumSpec(device.model).actions.resume ? 'resume' : 'start');

// level is an index into the model's suctionLevels (0 = quietest).
export function setVacuumSuction(device, level) {
  const spec = getVacuumSpec(device.model);
  const value = spec.suctionLevels[level];
  if (value === undefined) return Promise.reject(new Error(`INVALID_SUCTION: ${level}`));
  return setSpecProp(device, spec, 'suction', value);
}

export const getVacuumState = (device) => getSpecProps(device, getVacuumSpec(device.model));
