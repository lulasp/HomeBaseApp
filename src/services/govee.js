const BASE = 'https://openapi.api.govee.com/router/api/v1';

function headers(apiKey) {
  return { 'Govee-API-Key': apiKey, 'Content-Type': 'application/json' };
}

function rid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function goveeRequest(apiKey, path, options = {}) {
  const res = await fetch(`${BASE}${path}`, { headers: headers(apiKey), ...options });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {
    throw new Error(`Govee HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  console.log('[Govee]', path, JSON.stringify(json));
  if (json.code !== 200) throw new Error(json.msg || json.message || `Govee API error (${json.code})`);
  return json;
}

export async function getDevices(apiKey) {
  const json = await goveeRequest(apiKey, '/user/devices');
  return json.data ?? [];
}

export async function getDeviceState(apiKey, sku, device) {
  const json = await goveeRequest(apiKey, '/device/state', {
    method: 'POST',
    body: JSON.stringify({ requestId: rid(), payload: { sku, device } }),
  });
  return json.payload?.capabilities ?? [];
}

export async function controlDevice(apiKey, sku, device, capability) {
  return goveeRequest(apiKey, '/device/control', {
    method: 'POST',
    body: JSON.stringify({ requestId: rid(), payload: { sku, device, capability } }),
  });
}

// ── Capability commands ───────────────────────────────────────────────────────

export const setPower = (apiKey, sku, device, on) =>
  controlDevice(apiKey, sku, device, {
    type: 'devices.capabilities.on_off',
    instance: 'powerSwitch',
    value: on ? 1 : 0,
  });

export const setBrightness = (apiKey, sku, device, value) =>
  controlDevice(apiKey, sku, device, {
    type: 'devices.capabilities.range',
    instance: 'brightness',
    value,
  });

export const setColor = (apiKey, sku, device, hex) =>
  controlDevice(apiKey, sku, device, {
    type: 'devices.capabilities.color_setting',
    instance: 'colorRgb',
    value: hexToRgbInt(hex),
  });

export const setColorTemp = (apiKey, sku, device, kelvin) =>
  controlDevice(apiKey, sku, device, {
    type: 'devices.capabilities.color_setting',
    instance: 'colorTemperatureK',
    value: kelvin,
  });

export const setScene = (apiKey, sku, device, sceneValue) =>
  controlDevice(apiKey, sku, device, {
    type: 'devices.capabilities.dynamic_scene',
    instance: 'lightScene',
    value: sceneValue,
  });

export const setMusicMode = (apiKey, sku, device, mode) =>
  controlDevice(apiKey, sku, device, {
    type: 'devices.capabilities.music_setting',
    instance: 'musicMode',
    value: { musicMode: mode, sensitivity: 100, autoColor: 1, autoColorType: 2 },
  });

// ── Shortcuts ─────────────────────────────────────────────────────────────────

// Applies a shortcut's actions to one device, skipping capabilities the device
// doesn't support. Requests run sequentially — Govee allows ~2 sustained
// requests/sec per device. Returns the state patch that was applied.
export async function applyActionsToDevice(apiKey, device, actions) {
  const { sku, device: id } = device;
  const patch = {};
  if (actions.power != null) {
    await setPower(apiKey, sku, id, actions.power);
    patch.on = actions.power;
    if (!actions.power) return patch;
  }
  if (actions.brightness != null && hasCap(device, 'devices.capabilities.range', 'brightness')) {
    await setBrightness(apiKey, sku, id, actions.brightness);
    patch.brightness = actions.brightness;
  }
  if (actions.colorMode === 'color' && hasCap(device, 'devices.capabilities.color_setting', 'colorRgb')) {
    await setColor(apiKey, sku, id, actions.color);
    patch.color = actions.color;
    patch.scene = null;
  } else if (actions.colorMode === 'colorTem' && hasCap(device, 'devices.capabilities.color_setting', 'colorTemperatureK')) {
    await setColorTemp(apiKey, sku, id, actions.colorTem);
    patch.colorTem = actions.colorTem;
    patch.scene = null;
  } else if (actions.colorMode === 'scene') {
    // Scene values are device-specific, so shortcuts store the name and each
    // device resolves it against its own scene list.
    const scene = getScenesFromDevice(device).find((s) => s.name === actions.sceneName);
    if (scene) {
      await setScene(apiKey, sku, id, scene.id);
      patch.scene = scene.id;
    }
  }
  return patch;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function hexToRgbInt(hex) {
  const s = hex.replace('#', '');
  return (parseInt(s.slice(0, 2), 16) << 16) |
         (parseInt(s.slice(2, 4), 16) << 8) |
          parseInt(s.slice(4, 6), 16);
}

export function rgbIntToHex(value) {
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
}

export function hasCap(device, type, instance) {
  if (!device) return false;
  return (device.capabilities ?? []).some(
    (c) => c.type === type && (instance == null || c.instance === instance),
  );
}

export function getCapParam(device, type, instance) {
  if (!device) return undefined;
  return (device.capabilities ?? []).find(
    (c) => c.type === type && c.instance === instance,
  )?.parameters;
}

export function getScenesFromDevice(device) {
  if (!device) return [];
  const cap = (device.capabilities ?? []).find(
    (c) => c.type === 'devices.capabilities.dynamic_scene' && c.instance === 'lightScene',
  );
  const options = cap?.parameters?.options ?? [];
  return options.map((opt, i) => ({
    id: opt.value,
    name: opt.name ?? `Scene ${i + 1}`,
  }));
}

export function stateFromCapabilities(caps) {
  const state = {
    on: false,
    brightness: 80,
    color: '#FFFFFF',
    colorTem: 4000,
    scene: null,
    musicMode: null,
    // Not every device reports the online capability — assume reachable unless
    // the API explicitly says otherwise.
    online: true,
  };
  for (const cap of caps) {
    const val = cap.state?.value;
    if (cap.type === 'devices.capabilities.online' && cap.instance === 'online') {
      if (val != null) state.online = val === true || val === 1;
    } else if (cap.type === 'devices.capabilities.on_off' && cap.instance === 'powerSwitch') {
      state.on = val === 1;
    } else if (cap.type === 'devices.capabilities.range' && cap.instance === 'brightness') {
      if (val != null) state.brightness = val;
    } else if (cap.type === 'devices.capabilities.color_setting' && cap.instance === 'colorRgb') {
      if (val != null) state.color = rgbIntToHex(val);
    } else if (cap.type === 'devices.capabilities.color_setting' && cap.instance === 'colorTemperatureK') {
      if (val != null) state.colorTem = val;
    } else if (cap.type === 'devices.capabilities.dynamic_scene' && cap.instance === 'lightScene') {
      state.scene = val ?? null;
    } else if (cap.type === 'devices.capabilities.music_setting' && cap.instance === 'musicMode') {
      state.musicMode = val?.musicMode ?? null;
    }
  }
  return state;
}
