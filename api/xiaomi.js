// Vercel function: forwards signed Mi Cloud requests for the web build.
// Browsers can't call *.api.io.mi.com directly (no CORS, and pages can't set
// the Cookie header). The client still signs/encrypts; this only adds the
// cookie and relays. Credentials are never stored or logged.
const { initializeApp, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const HOSTS = {
  cn: 'api.io.mi.com',
  us: 'us.api.io.mi.com',
  eu: 'eu.api.io.mi.com',
  ru: 'ru.api.io.mi.com',
  sg: 'sg.api.io.mi.com',
  in: 'in.api.io.mi.com',
  de: 'de.api.io.mi.com',
  tw: 'tw.api.io.mi.com',
};

// Only the endpoints the app uses.
const PATH_RE = /^\/app(\/home\/device_list|\/v2\/home\/rpc\/\d{1,20})$/;
const USER_ID_RE = /^\d{1,20}$/;
// Cookie-safe token chars; rejects ';' and whitespace so it can't inject cookies.
const TOKEN_RE = /^[A-Za-z0-9+/=:_.-]{1,1024}$/;
const MAX_BODY = 64 * 1024;

function getAdminAuth() {
  if (!getApps().length) initializeApp({ projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID });
  return getAuth();
}

// Returns an error string, or null when the request is acceptable.
function validate(payload) {
  if (!payload || typeof payload !== 'object') return 'Invalid body';
  const { region, path, body, userId, serviceToken } = payload;
  if (!Object.prototype.hasOwnProperty.call(HOSTS, region)) return 'Invalid region';
  if (typeof path !== 'string' || !PATH_RE.test(path)) return 'Invalid path';
  if (typeof body !== 'string' || body.length > MAX_BODY) return 'Invalid payload';
  if (typeof userId !== 'string' || !USER_ID_RE.test(userId)) return 'Invalid userId';
  if (typeof serviceToken !== 'string' || !TOKEN_RE.test(serviceToken)) return 'Invalid serviceToken';
  return null;
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ code: -1, message: 'Method not allowed' });
  }

  const idToken = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  if (!idToken) return res.status(401).json({ code: -1, message: 'Not signed in' });
  try {
    await getAdminAuth().verifyIdToken(idToken);
  } catch {
    return res.status(401).json({ code: -1, message: 'Invalid sign-in token' });
  }

  const payload = typeof req.body === 'string' ? safeParse(req.body) : req.body;
  const invalid = validate(payload);
  if (invalid) return res.status(400).json({ code: -1, message: invalid });

  const { region, path, body, userId, serviceToken } = payload;
  try {
    const upstream = await fetch(`https://${HOSTS[region]}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type':           'application/x-www-form-urlencoded',
        'Cookie':                 `userId=${userId}; serviceToken=${serviceToken}; locale=en_US`,
        'User-Agent':             'Android-7.1.1-1.0.0-ONEPLUS A3010-136-',
        'MIOT-ENCRYPT-ALGORITHM': 'ENCRYPT-RC4',
      },
      body,
    });
    const text = await upstream.text();
    res.setHeader('Cache-Control', 'no-store');
    // Mi Cloud answers auth failures etc. as plain text; keep the client's JSON contract.
    if (safeParse(text) === null) {
      return res.status(upstream.status).json({
        code: -1, message: `Mi Cloud HTTP ${upstream.status}: ${text.slice(0, 200).trim() || 'empty response'}`,
      });
    }
    res.setHeader('Content-Type', 'application/json');
    return res.status(upstream.status).send(text);
  } catch {
    return res.status(502).json({ code: -1, message: 'Mi Cloud unreachable' });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

module.exports = handler;
module.exports.validate = validate;
