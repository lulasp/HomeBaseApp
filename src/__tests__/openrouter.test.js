import {
  sendChatMessage, suggestRecipes, parseBankStatement, parseStatementText, parseReceipt,
} from '../services/openrouter';
import { DEFAULT_AI_MODEL } from '../utils/aiModels';

const KEY = 'sk-or-test';

function response({ ok = true, status = 200, json }) {
  return {
    ok, status,
    headers: { get: () => null },
    text: async () => JSON.stringify(json),
  };
}

function mockFetchOnce(opts) {
  global.fetch = jest.fn().mockResolvedValue(response(opts));
}

// Queue distinct responses for successive calls (last one repeats).
function mockFetchSequence(list) {
  const fn = jest.fn();
  list.forEach((opts) => fn.mockResolvedValueOnce(response(opts)));
  global.fetch = fn;
  return fn;
}

// Assistant message that returns plain text.
const textReply = (content) => ({ choices: [{ message: { content } }] });
// Assistant message that returns a JSON string (structured output).
const jsonReply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }] });

beforeEach(() => {
  jest.clearAllMocks();
  // Make the retry backoff instant so 429 tests don't wait on real timers.
  jest.spyOn(global, 'setTimeout').mockImplementation((fn) => { fn(); return 0; });
});

afterEach(() => { global.setTimeout.mockRestore?.(); });

describe('request shape & auth', () => {
  it('posts to the chat completions endpoint with a Bearer key', async () => {
    mockFetchOnce({ json: textReply('hi') });
    await sendChatMessage(KEY, [], 'hello');

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(opts.body).model).toBeTruthy();
  });

  it('throws (without calling fetch) when no key is provided', async () => {
    global.fetch = jest.fn();
    await expect(sendChatMessage('', [], 'hi')).rejects.toThrow(/API key not set/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('uses the default model when none is passed', async () => {
    mockFetchOnce({ json: textReply('hi') });
    await sendChatMessage(KEY, [], 'hello');
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).model).toBe(DEFAULT_AI_MODEL);
  });

  it('passes an explicit model through to the request body', async () => {
    mockFetchOnce({ json: textReply('hi') });
    await sendChatMessage(KEY, [], 'hello', 'openai/gpt-4o-mini');
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).model).toBe('openai/gpt-4o-mini');
  });
});

describe('sendChatMessage', () => {
  it('prepends the system prompt and maps model→assistant roles', async () => {
    mockFetchOnce({ json: textReply('the reply') });
    const history = [
      { role: 'user', text: 'first' },
      { role: 'model', text: 'answer' },
    ];
    const reply = await sendChatMessage(KEY, history, 'second');

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({ role: 'system', content: expect.any(String) });
    expect(body.messages).toContainEqual({ role: 'assistant', content: 'answer' });
    expect(body.messages[body.messages.length - 1]).toEqual({ role: 'user', content: 'second' });
    expect(reply).toBe('the reply');
  });
});

describe('suggestRecipes', () => {
  it('requests json_schema output and parses the result', async () => {
    mockFetchOnce({ json: jsonReply({ recipes: [{ name: 'Toast' }] }) });
    const out = await suggestRecipes(KEY, [{ name: 'bread' }]);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(out.recipes[0].name).toBe('Toast');
  });
});

describe('parseBankStatement', () => {
  it('sends the PDF as a file content part with the file-parser plugin', async () => {
    mockFetchOnce({ json: jsonReply({ transactions: [] }) });
    await parseBankStatement(KEY, 'BASE64PDF', {
      expenseCats: [{ key: 'groceries', label: 'Groceries' }],
      billCats: [{ key: 'rent', label: 'Rent' }],
    });

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const parts = body.messages[0].content;
    const filePart = parts.find((p) => p.type === 'file');
    expect(filePart.file.file_data).toBe('data:application/pdf;base64,BASE64PDF');
    expect(body.plugins[0].id).toBe('file-parser');
    expect(parts.find((p) => p.type === 'text').text).toContain('groceries');
  });

  it('uses the native PDF engine for a model with native file support', async () => {
    mockFetchOnce({ json: jsonReply({ transactions: [] }) });
    await parseBankStatement(KEY, 'X', {}, 'google/gemini-2.5-flash');
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).plugins[0].pdf.engine).toBe('native');
  });

  it('falls back to free OCR for a model without native file support', async () => {
    mockFetchOnce({ json: jsonReply({ transactions: [] }) });
    await parseBankStatement(KEY, 'X', {}, 'openai/gpt-oss-20b:free');
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).plugins[0].pdf.engine).toBe('cloudflare-ai');
  });
});

describe('parseReceipt', () => {
  const VISION_MODEL = 'openai/gpt-4o-mini';
  const receipt = { store: 'Lidl', date: '2026-03-04', lines: [] };

  it('sends a photo as an image content part with a data URL', async () => {
    mockFetchOnce({ json: jsonReply(receipt) });
    await parseReceipt(KEY, { base64: 'IMGDATA', mimeType: 'image/jpeg' }, VISION_MODEL);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const parts = body.messages[0].content;
    const image = parts.find((p) => p.type === 'image_url');
    expect(image.image_url.url).toBe('data:image/jpeg;base64,IMGDATA');
    expect(body.plugins).toBeUndefined();
  });

  it('asks for the receipt schema so lines come back structured', async () => {
    mockFetchOnce({ json: jsonReply(receipt) });
    await parseReceipt(KEY, { base64: 'X', mimeType: 'image/png' }, VISION_MODEL);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.response_format.json_schema.name).toBe('receipt');
    const props = body.response_format.json_schema.schema.properties;
    expect(Object.keys(props.lines.items.properties).sort())
      .toEqual(['name', 'price', 'quantity', 'unit']);
  });

  it('rejects an image when the model has no vision support', async () => {
    global.fetch = jest.fn();
    await expect(
      parseReceipt(KEY, { base64: 'X', mimeType: 'image/jpeg' }, 'openai/gpt-oss-20b:free'),
    ).rejects.toThrow(/cannot read images/i);
    // Must not burn a request to find that out.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('routes a PDF receipt through the file-parser plugin instead', async () => {
    mockFetchOnce({ json: jsonReply(receipt) });
    await parseReceipt(KEY, { base64: 'PDFDATA', mimeType: 'application/pdf' }, VISION_MODEL);

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const filePart = body.messages[0].content.find((p) => p.type === 'file');
    expect(filePart.file.file_data).toBe('data:application/pdf;base64,PDFDATA');
    expect(body.plugins[0].pdf.engine).toBe('native');
  });

  it('accepts a PDF even on a model without vision', async () => {
    mockFetchOnce({ json: jsonReply(receipt) });
    await parseReceipt(KEY, { base64: 'X', mimeType: 'application/pdf' }, 'openai/gpt-oss-20b:free');
    expect(JSON.parse(global.fetch.mock.calls[0][1].body).plugins[0].pdf.engine).toBe('cloudflare-ai');
  });

  it('returns the parsed receipt', async () => {
    const parsed = { store: 'Aldi', date: '2026-03-04', lines: [{ name: 'Milk', price: 1.49, quantity: 1, unit: 'L' }] };
    mockFetchOnce({ json: jsonReply(parsed) });
    await expect(parseReceipt(KEY, { base64: 'X', mimeType: 'image/jpeg' }, VISION_MODEL))
      .resolves.toEqual(parsed);
  });

  it('defaults the mime type to jpeg when the picker omits it', async () => {
    mockFetchOnce({ json: jsonReply(receipt) });
    await parseReceipt(KEY, { base64: 'X' }, VISION_MODEL);
    const image = JSON.parse(global.fetch.mock.calls[0][1].body)
      .messages[0].content.find((p) => p.type === 'image_url');
    expect(image.image_url.url).toBe('data:image/jpeg;base64,X');
  });
});

describe('parseStatementText', () => {
  it('sends CSV text (no file part) and parses transactions', async () => {
    mockFetchOnce({ json: jsonReply({ transactions: [{ description: 'Tesco', amount: 5 }] }) });
    const out = await parseStatementText(KEY, 'Date,Amount\n2026-01-01,5', {});

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(typeof body.messages[0].content).toBe('string');
    expect(body.messages[0].content).toContain('2026-01-01');
    expect(out.transactions[0].description).toBe('Tesco');
  });
});

describe('error handling', () => {
  it('maps 401 to an invalid-key message', async () => {
    mockFetchOnce({ ok: false, status: 401, json: { error: { message: 'no auth' } } });
    await expect(sendChatMessage(KEY, [], 'hi')).rejects.toThrow(/Invalid OpenRouter API key/i);
  });

  it('maps 402 to a credits message', async () => {
    mockFetchOnce({ ok: false, status: 402, json: { error: { message: 'no credits' } } });
    await expect(sendChatMessage(KEY, [], 'hi')).rejects.toThrow(/credits exhausted/i);
  });

  it('maps a persistent 429 to a rate-limit message (after retries)', async () => {
    mockFetchOnce({ ok: false, status: 429, json: { error: { message: 'slow down' } } });
    await expect(sendChatMessage(KEY, [], 'hi')).rejects.toThrow(/rate limit/i);
    expect(global.fetch).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it('retries a transient 429 and succeeds', async () => {
    mockFetchSequence([
      { ok: false, status: 429, json: { error: { message: 'busy' } } },
      { json: textReply('recovered') },
    ]);
    const reply = await sendChatMessage(KEY, [], 'hi');
    expect(reply).toBe('recovered');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-429 errors', async () => {
    mockFetchOnce({ ok: false, status: 401, json: { error: { message: 'no auth' } } });
    await expect(sendChatMessage(KEY, [], 'hi')).rejects.toThrow();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws on malformed JSON in a structured response', async () => {
    mockFetchOnce({ json: textReply('not json {') });
    await expect(suggestRecipes(KEY, [{ name: 'x' }])).rejects.toThrow(/malformed/i);
  });

  it('surfaces a network error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    await expect(sendChatMessage(KEY, [], 'hi')).rejects.toThrow(/Network error/i);
  });
});
