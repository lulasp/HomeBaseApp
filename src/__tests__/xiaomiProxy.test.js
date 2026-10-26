import { generateKeyPairSync, sign } from 'crypto';

const PROJECT = 'home-test';
const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: otherKey }  = generateKeyPairSync('rsa', { modulusLength: 2048 });
const CERTS = { kid1: publicKey.export({ type: 'spki', format: 'pem' }) };

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);

// Builds an RS256 Firebase-style ID token; overrides tweak header/claims/key.
function makeToken({ header = {}, claims = {}, key = privateKey } = {}) {
  const h = b64url({ alg: 'RS256', kid: 'kid1', typ: 'JWT', ...header });
  const p = b64url({
    aud: PROJECT,
    iss: `https://securetoken.google.com/${PROJECT}`,
    sub: 'user-1',
    iat: now() - 10,
    auth_time: now() - 10,
    exp: now() + 3600,
    ...claims,
  });
  const sig = sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url');
  return `${h}.${p}.${sig}`;
}

const VALID = {
  region: 'de',
  path: '/app/v2/home/rpc/582750941',
  body: 'data=abc&_nonce=xyz&signature=sig',
  userId: '8278474663',
  serviceToken: 'V1:abc+/def==',
};

function mockRes() {
  const res = { headers: {} };
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.send = jest.fn(() => res);
  res.setHeader = jest.fn((k, v) => { res.headers[k] = v; });
  return res;
}

let handler;
let upstream;   // what the Mi Cloud call resolves/rejects with
let certsResponse;

const miCalls = () => global.fetch.mock.calls.filter(([url]) => url !== CERTS_URL);
const certCalls = () => global.fetch.mock.calls.filter(([url]) => url === CERTS_URL);

const req = (overrides = {}) => ({
  method: 'POST',
  headers: { authorization: `Bearer ${makeToken()}` },
  body: VALID,
  ...overrides,
});

beforeEach(() => {
  process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID = PROJECT;
  upstream = Promise.resolve({ status: 200, text: () => Promise.resolve('{"code":0,"result":[]}') });
  certsResponse = {
    ok: true,
    status: 200,
    headers: { get: () => 'public, max-age=600' },
    json: () => Promise.resolve(CERTS),
  };
  global.fetch = jest.fn((url) => (url === CERTS_URL ? Promise.resolve(certsResponse) : upstream));
  // Fresh module per test so the cert cache starts empty.
  jest.isolateModules(() => { handler = require('../../api/xiaomi'); });
});

describe('validate', () => {
  const validate = (p) => handler.validate(p);

  it('accepts a valid rpc request', () => expect(validate(VALID)).toBeNull());
  it('accepts the device list path', () => expect(validate({ ...VALID, path: '/app/home/device_list' })).toBeNull());
  it.each([
    '/app/v2/homeroom/gethome_merged',
    '/app/appgateway/miot/appsceneservice/AppSceneService/GetSimpleSceneList',
    '/app/appgateway/miot/appsceneservice/AppSceneService/NewRunScene',
  ])('accepts %s', (path) => expect(validate({ ...VALID, path })).toBeNull());

  it.each([
    ['null payload', null],
    ['unknown region', { ...VALID, region: 'mars' }],
    ['prototype key as region', { ...VALID, region: 'constructor' }],
    ['other Mi path', { ...VALID, path: '/app/user/get_user_device_data' }],
    ['other scene operation', { ...VALID, path: '/app/appgateway/miot/appsceneservice/AppSceneService/EditScene' }],
    ['suffix after an allowed path', { ...VALID, path: '/app/v2/homeroom/gethome_merged/x' }],
    ['path traversal', { ...VALID, path: '/app/home/device_list/../../x' }],
    ['non-numeric did', { ...VALID, path: '/app/v2/home/rpc/abc' }],
    ['absolute URL path', { ...VALID, path: 'https://evil.example/app/home/device_list' }],
    ['non-string body', { ...VALID, body: { a: 1 } }],
    ['oversized body', { ...VALID, body: 'x'.repeat(64 * 1024 + 1) }],
    ['non-numeric userId', { ...VALID, userId: '12; evil=1' }],
    ['cookie injection in token', { ...VALID, serviceToken: 'abc; userId=1' }],
    ['whitespace in token', { ...VALID, serviceToken: 'abc def' }],
    ['empty token', { ...VALID, serviceToken: '' }],
  ])('rejects %s', (_, payload) => expect(validate(payload)).not.toBeNull());
});

describe('verifyIdToken', () => {
  const verify = (token, project = PROJECT) => handler.verifyIdToken(token, project);

  it('accepts a valid token and returns its claims', async () =>
    expect(await verify(makeToken())).toMatchObject({ sub: 'user-1', aud: PROJECT }));

  it('tolerates small clock skew on iat', async () =>
    expect(await verify(makeToken({ claims: { iat: now() + 30 } }))).toBeTruthy());

  it.each([
    ['a token signed by another key', () => makeToken({ key: otherKey }), 'Bad signature'],
    ['a tampered payload', () => {
      const [h, , s] = makeToken().split('.');
      return `${h}.${b64url({ aud: PROJECT, sub: 'admin' })}.${s}`;
    }, 'Bad signature'],
    ['alg none', () => makeToken({ header: { alg: 'none' } }), 'Bad header'],
    ['HS256', () => makeToken({ header: { alg: 'HS256' } }), 'Bad header'],
    ['missing kid', () => makeToken({ header: { kid: undefined } }), 'Bad header'],
    ['an unknown kid', () => makeToken({ header: { kid: 'kid9' } }), 'Unknown key'],
    ['an expired token', () => makeToken({ claims: { exp: now() - 1 } }), 'Expired'],
    ['a missing exp', () => makeToken({ claims: { exp: undefined } }), 'Expired'],
    ['iat in the future', () => makeToken({ claims: { iat: now() + 600 } }), 'Issued in future'],
    ['auth_time in the future', () => makeToken({ claims: { auth_time: now() + 600 } }), 'Bad auth_time'],
    ['another project audience', () => makeToken({ claims: { aud: 'other-project' } }), 'Wrong audience'],
    ['another issuer', () => makeToken({ claims: { iss: 'https://evil.example' } }), 'Wrong issuer'],
    ['an empty subject', () => makeToken({ claims: { sub: '' } }), 'Bad subject'],
    ['an oversized subject', () => makeToken({ claims: { sub: 'x'.repeat(129) } }), 'Bad subject'],
    ['a malformed token', () => 'not.a-jwt', 'Malformed token'],
  ])('rejects %s', async (_, build, message) =>
    expect(verify(build())).rejects.toThrow(message));

  it('rejects when the project ID is not configured', () =>
    expect(verify(makeToken(), '')).rejects.toThrow('Missing project ID'));

  it('rejects when the certs endpoint fails', async () => {
    certsResponse = { ...certsResponse, ok: false, status: 503 };
    await expect(verify(makeToken())).rejects.toThrow('certs HTTP 503');
  });

  it('caches certs between calls', async () => {
    await verify(makeToken());
    await verify(makeToken());
    expect(certCalls()).toHaveLength(1);
  });

  it('refetches certs once the cache expires', async () => {
    certsResponse.headers = { get: () => 'max-age=0' };
    await verify(makeToken());
    await verify(makeToken());
    expect(certCalls()).toHaveLength(2);
  });
});

describe('handler', () => {
  it('rejects non-POST methods', async () => {
    const res = mockRes();
    await handler(req({ method: 'GET' }), res);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects a missing ID token', async () => {
    const res = mockRes();
    await handler(req({ headers: {} }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects an invalid ID token before forwarding', async () => {
    const res = mockRes();
    await handler(req({ headers: { authorization: `Bearer ${makeToken({ key: otherKey })}` } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ code: -1, message: 'Invalid sign-in token' });
    expect(miCalls()).toHaveLength(0);
  });

  it('rejects invalid payloads with 400', async () => {
    const res = mockRes();
    await handler(req({ body: { ...VALID, region: 'mars' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(miCalls()).toHaveLength(0);
  });

  it('parses a string body', async () => {
    const res = mockRes();
    await handler(req({ body: JSON.stringify(VALID) }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('forwards to the regional host with the cookie and the signed body', async () => {
    const res = mockRes();
    await handler(req(), res);
    const [url, opts] = miCalls()[0];
    expect(url).toBe('https://de.api.io.mi.com/app/v2/home/rpc/582750941');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Cookie).toBe('userId=8278474663; serviceToken=V1:abc+/def==; locale=en_US');
    expect(opts.body).toBe(VALID.body);
  });

  it('relays the upstream status and body without caching', async () => {
    upstream = Promise.resolve({ status: 200, text: () => Promise.resolve('{"code":-8,"message":"auth err"}') });
    const res = mockRes();
    await handler(req(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('{"code":-8,"message":"auth err"}');
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('wraps a plain-text upstream error as JSON with its status', async () => {
    upstream = Promise.resolve({ status: 401, text: () => Promise.resolve('auth err') });
    const res = mockRes();
    await handler(req(), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ code: -1, message: 'Mi Cloud HTTP 401: auth err' });
    expect(res.send).not.toHaveBeenCalled();
  });

  it('relays an encrypted (non-JSON) 200 reply untouched', async () => {
    upstream = Promise.resolve({ status: 200, text: () => Promise.resolve('aGVsbG8+/w==') });
    const res = mockRes();
    await handler(req(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('aGVsbG8+/w==');
    expect(res.headers['Content-Type']).toBe('text/plain');
  });

  it('wraps an empty upstream body', async () => {
    upstream = Promise.resolve({ status: 503, text: () => Promise.resolve('') });
    const res = mockRes();
    await handler(req(), res);
    expect(res.json).toHaveBeenCalledWith({ code: -1, message: 'Mi Cloud HTTP 503: empty response' });
  });

  it('returns 502 when Mi Cloud is unreachable', async () => {
    upstream = Promise.reject(new Error('ECONNRESET'));
    upstream.catch(() => {});
    const res = mockRes();
    await handler(req(), res);
    expect(res.status).toHaveBeenCalledWith(502);
  });
});
