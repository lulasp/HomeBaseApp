const mockVerifyIdToken = jest.fn();
jest.mock('firebase-admin/app', () => ({ initializeApp: jest.fn(), getApps: jest.fn(() => []) }));
jest.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: mockVerifyIdToken }) }));

const handler = require('../../api/xiaomi');
const { validate } = handler;

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

const req = (overrides = {}) => ({
  method: 'POST',
  headers: { authorization: 'Bearer good-token' },
  body: VALID,
  ...overrides,
});

beforeEach(() => {
  mockVerifyIdToken.mockReset().mockResolvedValue({ uid: 'u1' });
  global.fetch = jest.fn().mockResolvedValue({ status: 200, text: () => Promise.resolve('{"code":0,"result":[]}') });
});

describe('validate', () => {
  it('accepts a valid rpc request', () => expect(validate(VALID)).toBeNull());
  it('accepts the device list path', () => expect(validate({ ...VALID, path: '/app/home/device_list' })).toBeNull());

  it.each([
    ['null payload', null],
    ['unknown region', { ...VALID, region: 'mars' }],
    ['prototype key as region', { ...VALID, region: 'constructor' }],
    ['other Mi path', { ...VALID, path: '/app/user/get_user_device_data' }],
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
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it('rejects an invalid ID token before forwarding', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('bad'));
    const res = mockRes();
    await handler(req(), res);
    expect(mockVerifyIdToken).toHaveBeenCalledWith('good-token');
    expect(res.status).toHaveBeenCalledWith(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects invalid payloads with 400', async () => {
    const res = mockRes();
    await handler(req({ body: { ...VALID, region: 'mars' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('parses a string body', async () => {
    const res = mockRes();
    await handler(req({ body: JSON.stringify(VALID) }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('forwards to the regional host with the cookie and the signed body', async () => {
    const res = mockRes();
    await handler(req(), res);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://de.api.io.mi.com/app/v2/home/rpc/582750941');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Cookie).toBe('userId=8278474663; serviceToken=V1:abc+/def==; locale=en_US');
    expect(opts.body).toBe(VALID.body);
  });

  it('relays the upstream status and body without caching', async () => {
    global.fetch.mockResolvedValue({ status: 200, text: () => Promise.resolve('{"code":-8,"message":"auth err"}') });
    const res = mockRes();
    await handler(req(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('{"code":-8,"message":"auth err"}');
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('returns 502 when Mi Cloud is unreachable', async () => {
    global.fetch.mockRejectedValue(new Error('ECONNRESET'));
    const res = mockRes();
    await handler(req(), res);
    expect(res.status).toHaveBeenCalledWith(502);
  });
});
