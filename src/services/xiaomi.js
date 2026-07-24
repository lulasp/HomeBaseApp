import AsyncStorage from '@react-native-async-storage/async-storage';

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

async function miRequest(path, data = {}) {
  const creds = await getCredentials();
  if (!hasCredentials(creds)) throw new Error('NOT_CONFIGURED');

  const host    = REGIONS[creds.region] ?? REGIONS.cn;
  const apiPath = `/app${path}`;
  const url     = `https://${host}${apiPath}`;

  const signed = await buildSignedParams(apiPath, { data: JSON.stringify(data) }, creds.ssecurity);

  const body = Object.entries(signed)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const res = await fetch(url, {
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

  const json = await res.json();
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
const VACUUM_TOKENS = ['vacuum', 'roborock', 'dreame', 'viomi.vacuum', 'mijia.vacuum'];

export function getDeviceType(device) {
  const model = (device.model ?? '').toLowerCase();
  if (VACUUM_TOKENS.some(t => model.includes(t))) return 'vacuum';
  if (FAN_TOKENS.some(t => model.includes(t)))    return 'fan';
  return 'other';
}

// ── State parsing helpers ─────────────────────────────────────────────────────

function propMap(props) {
  const m = {};
  for (const p of (props ?? [])) m[`${p.siid}_${p.piid}`] = p.value;
  return m;
}

export function fanStateFromProps(props) {
  const m = propMap(props);
  return {
    on:        m['2_1']  ?? false,
    level:     m['2_2']  ?? 1,
    mode:      m['2_3']  ?? 0,
    oscillate: m['2_4']  ?? false,
    speed:     m['2_11'] ?? 25,
  };
}

export function vacuumStateFromProps(props) {
  const m = propMap(props);
  return {
    status:  m['2_1'] ?? 2,
    error:   m['2_2'] ?? 0,
    suction: m['2_8'] ?? 1,
    battery: m['3_1'] ?? 100,
  };
}

// ── Fan commands ──────────────────────────────────────────────────────────────

export const setFanPower       = (did, on)      => callDevice(did, 'set_properties', [{ did, siid: 2, piid: 1,  value: on }]);
export const setFanLevel       = (did, level)   => callDevice(did, 'set_properties', [{ did, siid: 2, piid: 2,  value: level }]);
export const setFanMode        = (did, mode)    => callDevice(did, 'set_properties', [{ did, siid: 2, piid: 3,  value: mode }]);
export const setFanOscillation = (did, enabled) => callDevice(did, 'set_properties', [{ did, siid: 2, piid: 4,  value: enabled }]);
export const setFanSpeed       = (did, percent) => callDevice(did, 'set_properties', [{ did, siid: 2, piid: 11, value: percent }]);

export const getFanState = (did) =>
  callDevice(did, 'get_properties', [
    { did, siid: 2, piid: 1  },
    { did, siid: 2, piid: 2  },
    { did, siid: 2, piid: 3  },
    { did, siid: 2, piid: 4  },
    { did, siid: 2, piid: 11 },
  ]);

// ── Vacuum commands ───────────────────────────────────────────────────────────

export const startCleaning    = (did) => callDevice(did, 'action', { did, siid: 2, aiid: 1, in: [] });
export const pauseCleaning    = (did) => callDevice(did, 'action', { did, siid: 2, aiid: 2, in: [] });
export const returnToDock     = (did) => callDevice(did, 'action', { did, siid: 2, aiid: 3, in: [] });
export const findVacuum       = (did) => callDevice(did, 'action', { did, siid: 6, aiid: 1, in: [] });
export const setVacuumSuction = (did, level) => callDevice(did, 'set_properties', [{ did, siid: 2, piid: 8, value: level }]);

export const getVacuumState = (did) =>
  callDevice(did, 'get_properties', [
    { did, siid: 2, piid: 1 },
    { did, siid: 2, piid: 2 },
    { did, siid: 2, piid: 8 },
    { did, siid: 3, piid: 1 },
  ]);
