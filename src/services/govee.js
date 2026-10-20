import { gradientColors, groupSegmentsByColor } from '../utils/color';

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

// The full dynamic-scene catalogue for a device — much larger than the handful
// of scenes echoed back in the device list. Limited to 30 req/min per device.
export async function getDynamicScenes(apiKey, sku, device) {
  const json = await goveeRequest(apiKey, '/device/scenes', {
    method: 'POST',
    body: JSON.stringify({ requestId: rid(), payload: { sku, device } }),
  });
  return scenesFromCapabilities(json.payload?.capabilities ?? [], 'dynamic');
}

// Scenes the user built in the Govee app. These come back under a different
// capability (diy_color_setting / diyScene) than the built-in ones.
export async function getDiyScenes(apiKey, sku, device) {
  const json = await goveeRequest(apiKey, '/device/diy-scenes', {
    method: 'POST',
    body: JSON.stringify({ requestId: rid(), payload: { sku, device } }),
  });
  return scenesFromCapabilities(json.payload?.capabilities ?? [], 'diy');
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

// Applies a scene object from getScenesFromDevice / getDynamicScenes /
// getDiyScenes. Each source declares its own capability type and instance
// (DIY scenes come back as diy_color_setting), so they're echoed back verbatim.
export const applyScene = (apiKey, sku, device, scene) =>
  controlDevice(apiKey, sku, device, {
    type: scene.type,
    instance: scene.instance,
    value: scene.value,
  });

const SEGMENT_GAP_MS = 500;

// Some devices cap how many segments one request may carry (see
// getSegmentLimit); larger selections are sent as sequential chunks.
async function sendSegmentChunks(segments, maxPerRequest, send) {
  const chunks = chunkSegments(segments, maxPerRequest);
  let last;
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, SEGMENT_GAP_MS));
    last = await send(chunks[i]);
  }
  return last;
}

export const setSegmentColor = (apiKey, sku, device, segments, hex, maxPerRequest = Infinity) =>
  sendSegmentChunks(segments, maxPerRequest, (segment) => controlDevice(apiKey, sku, device, {
    type: 'devices.capabilities.segment_color_setting',
    instance: 'segmentedColorRgb',
    value: { segment, rgb: hexToRgbInt(hex) },
  }));

// Applies [{ hex, segments }] groups one request at a time (Govee allows ~2
// sustained requests/sec per device). Stops at the first failure.
// onProgress(done, total) fires after each successful group.
// Pass groups through splitSegmentGroups first when the device has a limit.
export async function applySegmentColorGroups(apiKey, sku, device, groups, onProgress, gapMs = SEGMENT_GAP_MS) {
  for (let i = 0; i < groups.length; i++) {
    if (i > 0 && gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
    await setSegmentColor(apiKey, sku, device, groups[i].segments, groups[i].hex);
    onProgress?.(i + 1, groups.length);
  }
}

export const setSegmentBrightness = (apiKey, sku, device, segments, brightness, maxPerRequest = Infinity) =>
  sendSegmentChunks(segments, maxPerRequest, (segment) => controlDevice(apiKey, sku, device, {
    type: 'devices.capabilities.segment_color_setting',
    instance: 'segmentedBrightness',
    value: { segment, brightness },
  }));

// On/off toggles, e.g. gradientToggle (blend colours between segments)
export const setToggle = (apiKey, sku, device, instance, on) =>
  controlDevice(apiKey, sku, device, {
    type: 'devices.capabilities.toggle',
    instance,
    value: on ? 1 : 0,
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
  // Brightness, colour, temperature and scenes all power the light on as a side
  // effect, so the patch has to say so even when the shortcut left power alone.
  let lit = false;
  if (actions.power != null) {
    await setPower(apiKey, sku, id, actions.power);
    patch.on = actions.power;
    if (!actions.power) return patch;
  }
  if (actions.brightness != null && hasCap(device, 'devices.capabilities.range', 'brightness')) {
    await setBrightness(apiKey, sku, id, actions.brightness);
    patch.brightness = actions.brightness;
    lit = true;
  }
  if (actions.colorMode === 'color' && hasCap(device, 'devices.capabilities.color_setting', 'colorRgb')) {
    await setColor(apiKey, sku, id, actions.color);
    patch.color = actions.color;
    patch.scene = null;
    lit = true;
  } else if (actions.colorMode === 'colorTem' && hasCap(device, 'devices.capabilities.color_setting', 'colorTemperatureK')) {
    await setColorTemp(apiKey, sku, id, actions.colorTem);
    patch.colorTem = actions.colorTem;
    patch.scene = null;
    lit = true;
  } else if (actions.colorMode === 'gradient' && actions.gradientStops?.length) {
    // Segment lights get the gradient across every segment; the rest fall
    // back to the start colour so every light in the shortcut changes.
    if (actions.gradientBlend != null && hasCap(device, 'devices.capabilities.toggle', 'gradientToggle')) {
      await setToggle(apiKey, sku, id, 'gradientToggle', actions.gradientBlend);
      patch.gradient = actions.gradientBlend;
    }
    const count = getSegmentCount(device);
    if (count > 0 && hasCap(device, 'devices.capabilities.segment_color_setting', 'segmentedColorRgb')) {
      const segments = Array.from({ length: count }, (_, i) => i);
      const groups = splitSegmentGroups(
        groupSegmentsByColor(segments, gradientColors(actions.gradientStops, count)),
        getSegmentLimit(device),
      );
      await applySegmentColorGroups(apiKey, sku, id, groups);
      patch.scene = null;
      lit = true;
    } else if (hasCap(device, 'devices.capabilities.color_setting', 'colorRgb')) {
      await setColor(apiKey, sku, id, actions.gradientStops[0]);
      patch.color = actions.gradientStops[0];
      patch.scene = null;
      lit = true;
    }
  } else if (actions.colorMode === 'scene') {
    const scene = await resolveSceneByName(apiKey, device, actions.sceneName);
    if (scene) {
      await applyScene(apiKey, sku, id, scene);
      patch.scene = scene.value;
      lit = true;
    }
  }
  if (lit) patch.on = true;
  return patch;
}

// Scene values are device-specific, so shortcuts store the name and each device
// resolves it against its own lists. The device list is checked first (free);
// the dynamic and DIY catalogues are only fetched when the name isn't there,
// since each costs a request against the per-device rate limit.
export async function resolveSceneByName(apiKey, device, name) {
  if (!name) return null;
  const local = getScenesFromDevice(device).find((s) => s.name === name);
  if (local) return local;

  const { sku, device: id } = device;
  for (const fetchScenes of [getDynamicScenes, getDiyScenes]) {
    try {
      const match = (await fetchScenes(apiKey, sku, id)).find((s) => s.name === name);
      if (match) return match;
    } catch {
      // Not every device exposes both catalogues — keep looking.
    }
  }
  return null;
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

// Scene values are integers for built-in and DIY scenes but objects
// ({ paramId, id }) for dynamic ones, so they can't be compared with === or
// used as React keys directly. This flattens any of them to a stable string.
export function sceneKey(value) {
  if (value == null) return null;
  if (typeof value === 'object') return `${value.paramId ?? ''}:${value.id ?? ''}`;
  return String(value);
}

// Normalises the three scene sources (device list, /device/scenes,
// /device/diy-scenes) to one shape. `type`/`instance` are carried along so
// applyScene can echo the right capability back without re-deriving it.
function normalizeSceneOptions(options, type, instance, source) {
  return options.map((opt, i) => ({
    key: sceneKey(opt.value) ?? `${source}-${i}`,
    name: opt.name ?? `Scene ${i + 1}`,
    value: opt.value,
    type,
    instance,
    source,
  }));
}

function scenesFromCapabilities(caps, source) {
  return caps.flatMap((cap) =>
    normalizeSceneOptions(cap.parameters?.options ?? [], cap.type, cap.instance, source),
  );
}

export function getScenesFromDevice(device) {
  if (!device) return [];
  const cap = (device.capabilities ?? []).find(
    (c) => c.type === 'devices.capabilities.dynamic_scene' && c.instance === 'lightScene',
  );
  if (!cap) return [];
  return normalizeSceneOptions(cap.parameters?.options ?? [], cap.type, cap.instance, 'static');
}

function segmentField(device) {
  const params = getCapParam(device, 'devices.capabilities.segment_color_setting', 'segmentedColorRgb')
    ?? getCapParam(device, 'devices.capabilities.segment_color_setting', 'segmentedBrightness');
  return (params?.fields ?? []).find((f) => f.fieldName === 'segment') ?? null;
}

// Number of addressable segments. Devices describe the `segment` field either
// as an option list (H6159: options [{value:0}…]) or as an index range
// (H6076: elementRange {min:0,max:14}).
// Models whose API index range is wider than their physical segments
// (H6076 reports 0–14 but has 7 subsections in the Govee app).
const SEGMENT_COUNT_BY_SKU = { H6076: 7 };

export function getSegmentCount(device) {
  const field = segmentField(device);
  if (!field) return 0;
  if (SEGMENT_COUNT_BY_SKU[device.sku]) return SEGMENT_COUNT_BY_SKU[device.sku];
  if (field?.options?.length) return field.options.length;
  const range = field?.elementRange;
  if (Number.isInteger(range?.min) && Number.isInteger(range?.max) && range.max >= range.min) {
    return range.max - range.min + 1;
  }
  return 0;
}

// Max segments per request (`size.max`, e.g. 7 on the H6076); Infinity when unspecified.
export function getSegmentLimit(device) {
  const max = segmentField(device)?.size?.max;
  return Number.isInteger(max) && max > 0 ? max : Infinity;
}

export function chunkSegments(segments, maxPerRequest = Infinity) {
  if (!(maxPerRequest > 0) || segments.length <= maxPerRequest) return segments.length ? [segments] : [];
  const out = [];
  for (let i = 0; i < segments.length; i += maxPerRequest) out.push(segments.slice(i, i + maxPerRequest));
  return out;
}

// Splits [{ hex, segments }] groups so none exceeds the per-request limit.
export function splitSegmentGroups(groups, maxPerRequest = Infinity) {
  return groups.flatMap((g) => chunkSegments(g.segments, maxPerRequest).map((segments) => ({ hex: g.hex, segments })));
}

export function stateFromCapabilities(caps) {
  const state = {
    on: false,
    brightness: 80,
    color: '#FFFFFF',
    colorTem: 4000,
    scene: null,
    musicMode: null,
    gradient: false,
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
    } else if (cap.type === 'devices.capabilities.toggle' && cap.instance === 'gradientToggle') {
      state.gradient = val === 1;
    } else if (cap.type === 'devices.capabilities.music_setting' && cap.instance === 'musicMode') {
      state.musicMode = val?.musicMode ?? null;
    }
  }
  return state;
}
