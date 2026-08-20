# Multi-brand light support — design note

**Status:** proposal, not started · **Written:** 2026-08-20

How to make the lights feature work with a second brand (Hue, LIFX, …) instead
of being a Govee client wearing a screen. Nothing here is implemented; this is
the plan to pick up later.

## Why this came up

The lights UI is not "a lights screen that happens to use Govee" — it *is* a
Govee client. Every vendor detail reaches the top of the render tree.

We've already run this experiment once and got the wrong answer: Xiaomi is a
second vendor, and it got `src/services/xiaomi.js` plus a separate 1010-line
`src/screens/xiaomi/XiaomiScreen.js`. Fine for fans and vacuums, which share no
UI with lights. For a second brand of *lights* it would mean duplicating
`HomeLightsScreen.js` — 1650 lines of scenes, segments, shortcuts and timers.

## What's coupled today

| Where | Coupling |
| --- | --- |
| `src/screens/lights/HomeLightsScreen.js:22` | Imports 17 functions directly from `services/govee` |
| `src/components/LightShortcutsRow.js:10` | Imports `applyActionsToDevice` |
| `src/components/LightShortcutsRow.js:84` | `devices.find((d) => d.device === id)` — assumes Govee's device shape |
| `src/screens/home/HomeScreen.js:23` | Imports `getDevices`; holds `goveeApiKey` / `goveeDevices` state and passes both into `LightShortcutsRow` |
| `src/services/firestore.js:283` | `updateHouseholdGoveeApiKey` — one brand-named credential field on the household doc |
| Shortcut docs | `deviceIds: ['AA:BB']` — bare ids, no brand, assumed globally unique |
| Throughout the screen | Vendor capability strings in UI logic: `hasCap(dev, 'devices.capabilities.color_setting', 'colorRgb')` |

## Proposed shape

A driver registry under `src/services/lights/`. The existing `src/services/govee.js`
stays as the raw HTTP client; a thin `drivers/govee.js` translates it to the
normalized model. Screens talk only to the registry.

```
src/services/lights/
  index.js          — registry: brand id → driver, fan-out helpers
  model.js          — normalized device/state shapes
  drivers/govee.js  — wraps services/govee.js
  drivers/<brand>.js
```

### Normalized device

```js
{
  id: 'govee:AA:BB:CC',        // brand-namespaced, so ids are globally unique
  brand: 'govee',
  name: 'Living room strip',
  online: true,
  capabilities: {              // descriptors, not vendor capability-type strings
    power: true,
    brightness: { min: 1, max: 100 },
    color: true,
    colorTemp: { min: 2000, max: 9000 },
    scenes: true,
    segments: 15,              // 0 = unsupported
  },
  raw: goveeDevice,            // escape hatch; only the driver reads this
}
```

### Normalized state

```js
{ on, online, brightness /* 0-100 */, color /* '#RRGGBB' */, colorTemp /* K */, sceneId /* opaque string */ }
```

### Driver interface

```js
{
  id: 'govee',
  label: 'Govee',
  credentialFields: [{ key: 'apiKey', label: 'API key', secure: true }],
  listDevices(creds),
  getState(creds, device),
  setPower(creds, device, on),
  setBrightness(creds, device, value),
  setColor(creds, device, hex),
  setColorTemp(creds, device, kelvin),
  listScenes(creds, device),                              // → [{ id, name, group }]
  applyScene(creds, device, sceneId),
  setSegments(creds, device, segments, { color, brightness }),
}
```

`HomeLightsScreen` then consumes a `useLights()` context that fans out across
configured drivers, and `supports('color')` becomes `device.capabilities.color`.

## The two details that decide whether this works

### 1. Scene ids must be opaque

`sceneKey()` in `src/services/govee.js` is already this seam — it exists because
Govee alone has three incompatible scene value formats (static ints, dynamic
`{paramId, id}` objects, DIY ints under a different capability). Generalize it:

- `listScenes` returns `{ id: '4280:3853', name: 'Sunrise' }`
- `applyScene(creds, device, '4280:3853')` hands the string back
- the driver owns the map from string → vendor payload
- **nothing above the driver ever parses that string**

Hue scenes are UUIDs; LIFX has named effects with their own parameters. An
opaque string is the only representation that survives all three.

### 2. Power side effects belong to the driver

Fixed on 2026-08-19: setting brightness / colour / temperature / scene / music /
segments all power a Govee light on as a side effect, so each handler in
`HomeLightsScreen` and `applyActionsToDevice` now sets `on: true` locally.

That is **Govee behaviour, not universal**. Hue matches it; LIFX's `set_state`
can set colour while the light stays off. So those `on: true` assignments cannot
stay in the UI layer. Commands should return the state delta they actually
caused, and the driver decides what that delta is.

This is the strongest argument that the refactor pays for itself rather than
just being tidier.

## Data migration

Both of these have live data, so they need back-compat reads, not a hard cutover.

- **Credentials.** `goveeApiKey` on the household private doc →
  `lightCredentials: { govee: { apiKey }, hue: { bridgeIp, username } }`. Keep
  reading the old field as a fallback. There's precedent: the `LEGACY` list at
  `src/services/firestore.js:101` already migrates `goveeApiKey` and friends.
- **Shortcuts.** `deviceIds: ['AA:BB']` → `['govee:AA:BB']`. An unprefixed id
  must be read as Govee.
- **Scene names in shortcuts are accidentally correct.** Storing `sceneName` and
  resolving it per device at run time (`resolveSceneByName`) is exactly what
  works across brands. That design survives untouched.

## Suggested staging

1. Define the model + driver interface; implement the Govee driver as pure
   translation. No UI change. Tests assert driver output == current service
   output.
2. Move the three consumers (`HomeLightsScreen`, `LightShortcutsRow`,
   `HomeScreen`) onto the registry, still with one driver. Big diff, identical
   behaviour.
3. Namespace device ids and credentials, with the back-compat reads above.
4. Add brand two — a service file, a driver, a credentials field. No screen work.

Steps 1–2 are worth doing even if a second brand never arrives: they're what
would let the lights UI be unit-tested without mocking HTTP.

## Alternative: Home Assistant instead of N drivers

Point the app at a Home Assistant instance rather than writing a driver per
brand. HA already normalizes hundreds of brands into `light.*` entities with
`brightness` / `color_temp` / `rgb_color` / `effect` behind one REST API, so it's
one integration for the whole ecosystem — and its push updates would fix the
stale-toggle problem (a light switched from the Govee app or a wall switch stays
stale here until refocus or pull-to-refresh, because we poll).

Cost: requires an HA instance on the network.

Matter directly is not realistic from Expo — commissioning needs native code and
local network access.

**Recommendation:** with a specific second brand in mind and an expectation of
stopping at two or three, build the driver registry. For breadth, Home Assistant
is less total work than the third driver.

## Caution

Don't finalize the interface from a single example. Pick the actual second brand
and read its API *before* step 1, or Govee's shape gets designed into the
"generic" model and the mismatch only surfaces at step 4.

Keep `raw` plus per-driver optional capabilities so brand-specific features
(Govee DIY scenes, Hue entertainment zones) don't have to be forced into the
common model — the screen renders them from a driver-provided descriptor, or
hides them.

## Related open item

`src/services/govee.js:18` logs every full API response to the console
(`console.log('[Govee]', path, …)`). Unrelated to this refactor but worth
dropping before either lands.
