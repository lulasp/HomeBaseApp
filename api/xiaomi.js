// Vercel function: forwards signed Mi Cloud requests for the web build.
// Browsers can't call *.api.io.mi.com directly (no CORS, and pages can't set
// the Cookie header). The client still signs/encrypts; this only adds the
// cookie and relays. Credentials are never stored or logged.
//
// Dependency-free on purpose: firebase-admin pulls in ESM-only jose, which
// Vercel's loader can't require() (ERR_REQUIRE_ESM).
const crypto = require('crypto');

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
const PATH_RE = new RegExp('^/app(' + [
  '/home/device_list',
  '/v2/home/rpc/\\d{1,20}',
  '/v2/homeroom/gethome_merged',
  '/appgateway/miot/appsceneservice/AppSceneService/(GetSimpleSceneList|NewRunScene)',
].join('|') + ')$');
const USER_ID_RE = /^\d{1,20}$/;
// Cookie-safe token chars; rejects ';' and whitespace so it can't inject cookies.
const TOKEN_RE = /^[A-Za-z0-9+/=:_.-]{1,1024}$/;
const MAX_BODY = 64 * 1024;

// ── Firebase ID token verification ───────────────────────────────────────────
// Per https://firebase.google.com/docs/auth/admin/verify-id-tokens (third-party JWT path).

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const CLOCK_SKEW_S = 60;
let certCache = { certs: null, expires: 0 };

async function getGoogleCerts() {
  if (certCache.certs && Date.now() < certCache.expires) return certCache.certs;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error(`certs HTTP ${res.status}`);
  const certs = await res.json();
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
  certCache = { certs, expires: Date.now() + maxAge * 1000 };
  return certs;
}

const decodePart = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

// Resolves to the token payload, or throws if it isn't a valid ID token for projectId.
async function verifyIdToken(token, projectId) {
  if (!projectId) throw new Error('Missing project ID');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');

  const header  = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Bad header');

  const cert = (await getGoogleCerts())[header.kid];
  if (!cert) throw new Error('Unknown key');
  const valid = crypto.verify(
    'RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), cert, Buffer.from(parts[2], 'base64url'),
  );
  if (!valid) throw new Error('Bad signature');

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new Error('Expired');
  if (typeof payload.iat !== 'number' || payload.iat > now + CLOCK_SKEW_S) throw new Error('Issued in future');
  if (typeof payload.auth_time !== 'number' || payload.auth_time > now + CLOCK_SKEW_S) throw new Error('Bad auth_time');
  if (payload.aud !== projectId) throw new Error('Wrong audience');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('Wrong issuer');
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) throw new Error('Bad subject');
  return payload;
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
    await verifyIdToken(idToken, process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID);
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
    // Successful replies are RC4-encrypted text the client decrypts, so relay them.
    // Mi Cloud answers auth failures etc. as plain text; keep the client's JSON contract.
    if (upstream.status >= 400 && safeParse(text) === null) {
      return res.status(upstream.status).json({
        code: -1, message: `Mi Cloud HTTP ${upstream.status}: ${text.slice(0, 200).trim() || 'empty response'}`,
      });
    }
    res.setHeader('Content-Type', safeParse(text) === null ? 'text/plain' : 'application/json');
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
module.exports.verifyIdToken = verifyIdToken;
