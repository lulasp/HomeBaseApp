// OpenRouter (https://openrouter.ai) — OpenAI-compatible chat completions.
// The API key is per-household (entered in Household settings, stored in
// Firestore) and passed as the first argument to every function, mirroring the
// Govee service. Nothing here reads from env.

import { DEFAULT_AI_MODEL, getAiModel } from '../utils/aiModels';

const BASE = 'https://openrouter.ai/api/v1';

const SYSTEM_PROMPT =
  'You are a helpful assistant for a home and food management app. You help with cooking, grocery shopping, meal planning, and home management.';

const RECIPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    recipes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name:                  { type: 'string' },
          description:           { type: 'string' },
          ingredients_available: { type: 'array', items: { type: 'string' } },
          ingredients_missing:   { type: 'array', items: { type: 'string' } },
          steps:                 { type: 'array', items: { type: 'string' } },
          prep_time:             { type: 'string' },
        },
        required: ['name', 'description', 'ingredients_available', 'ingredients_missing', 'steps', 'prep_time'],
      },
    },
  },
  required: ['recipes'],
};

const STATEMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    transactions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          date:        { type: 'string' },  // ISO yyyy-MM-dd
          description: { type: 'string' },
          amount:      { type: 'number' },  // always positive
          direction:   { type: 'string', enum: ['out', 'in'] }, // out = spent, in = received
          type:        { type: 'string', enum: ['expense', 'bill'] }, // bill = looks recurring
          category:    { type: 'string' },  // one of the provided category keys, else "other"
        },
        required: ['date', 'description', 'amount', 'direction', 'type', 'category'],
      },
    },
  },
  required: ['transactions'],
};

const RECEIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    store: { type: 'string' },   // shop name, "" if unreadable
    date:  { type: 'string' },   // ISO yyyy-MM-dd, "" if unreadable
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name:     { type: 'string' },  // product as printed, tidied
          rawName:  { type: 'string' },  // product exactly as printed — the identity key
          code:     { type: 'string' },  // article/SKU code if printed, "" otherwise
          price:    { type: 'number' },  // total paid for the line, positive
          quantity: { type: 'number' },  // units/weight bought, 1 if not shown
          unit:     { type: 'string' },  // kg, g, L, ml, pcs …
        },
        required: ['name', 'rawName', 'code', 'price', 'quantity', 'unit'],
      },
    },
  },
  required: ['store', 'date', 'lines'],
};

function assertKey(apiKey) {
  if (!apiKey) throw new Error('OpenRouter API key not set. Add it in Household settings.');
}

function friendlyError(status, json) {
  const msg = json?.error?.message || json?.message || '';
  if (status === 401) return new Error('Invalid OpenRouter API key. Check it in Household settings.');
  if (status === 402) return new Error('OpenRouter credits exhausted. Add credits at openrouter.ai.');
  if (status === 429) {
    return new Error(
      'Rate limited. Free models cap at ~20/min and ~50/day (shared, so this can happen even when idle). ' +
      'Wait a minute, add credits, or pick a paid model in Household settings.',
    );
  }
  if (status === 403) return new Error(msg || 'Request was blocked by content moderation.');
  return new Error(msg || `OpenRouter request failed (HTTP ${status}).`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One HTTP round-trip. Returns { res, json }.
async function requestOnce(apiKey, body) {
  let res;
  try {
    res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://home-app.local',
        'X-Title': 'Home App',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Network error reaching OpenRouter. Check your connection.');
  }
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`OpenRouter HTTP ${res.status}: ${text.slice(0, 200)}`); }
  return { res, json };
}

// Core request. Returns the assistant message content (a string).
// Transient 429s (common on shared free endpoints) are retried with backoff.
async function complete(apiKey, { messages, schema, schemaName, plugins, model = DEFAULT_AI_MODEL }) {
  assertKey(apiKey);
  const body = { model, messages };
  if (schema) {
    body.response_format = { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } };
  }
  if (plugins) body.plugins = plugins;

  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; ; attempt++) {
    const { res, json } = await requestOnce(apiKey, body);

    if (res.ok && !json.error) {
      const content = json.choices?.[0]?.message?.content;
      if (content == null) throw new Error('OpenRouter returned an empty response.');
      return content;
    }

    if (res.status === 429 && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(res.headers?.get?.('retry-after'));
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : attempt * 2000;
      await sleep(waitMs);
      continue;
    }

    throw friendlyError(res.status, json);
  }
}

// Core request expecting JSON that matches `schema`.
async function completeJson(apiKey, opts) {
  const content = await complete(apiKey, opts);
  try { return JSON.parse(content); } catch { throw new Error('AI returned malformed data. Please try again.'); }
}

/**
 * Send a message in a chat session.
 * @param {string} apiKey
 * @param {Array<{role:'user'|'model', text:string}>} history - previous turns (excluding newMessage)
 * @param {string} newMessage
 * @param {string} [model] - OpenRouter model id
 * @returns {Promise<string>} the model's reply text
 */
export function sendChatMessage(apiKey, history, newMessage, model = DEFAULT_AI_MODEL) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map((m) => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text })),
    { role: 'user', content: newMessage },
  ];
  return complete(apiKey, { messages, model });
}

/**
 * Suggest recipes based on available pantry items.
 * @param {string} apiKey
 * @param {Array<{name:string, quantity?:string, unit?:string}>} pantryItems
 * @param {string} [model] - OpenRouter model id
 * @returns {Promise<{recipes: Array}>}
 */
export function suggestRecipes(apiKey, pantryItems, model = DEFAULT_AI_MODEL) {
  const itemList = pantryItems
    .map((i) => (i.quantity && i.unit ? `${i.name} (${i.quantity} ${i.unit})` : i.name))
    .join(', ');
  const prompt = `I have these items available: ${itemList}. Suggest 2–3 recipes I can make with them, noting any missing ingredients.`;
  return completeJson(apiKey, {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    schema: RECIPE_SCHEMA,
    schemaName: 'recipes',
    model,
  });
}

// Shared extraction instructions for both PDF and spreadsheet sources.
function buildStatementPrompt(source, { expenseCats = [], billCats = [] } = {}) {
  const fmtCats = (list) => list.map((c) => `${c.key} (${c.label})`).join(', ') || 'other';
  return (
    `This is a bank statement (${source}). Extract every transaction line as a structured record.\n` +
    '- date: the transaction date as yyyy-MM-dd.\n' +
    '- description: the merchant / description text.\n' +
    '- amount: always a positive number (never negative).\n' +
    '- direction: "out" for money spent (debits, purchases, payments) or "in" for money received (deposits, refunds, credits).\n' +
    '- type: "bill" if the charge looks like a recurring bill (rent, utilities, subscriptions, insurance, phone/internet); otherwise "expense".\n' +
    `- category: choose the single best-matching key from these expense categories: [${fmtCats(expenseCats)}]. ` +
    `For type "bill" prefer these bill categories: [${fmtCats(billCats)}]. Use "other" if nothing fits.\n` +
    'Ignore running balances, headers, and summary totals — only real transactions. Skip a line if it has no clear amount.'
  );
}

/**
 * Extract transactions from a bank-statement PDF and categorize them.
 * @param {string} apiKey
 * @param {string} base64Pdf - the PDF encoded as base64 (no data: prefix)
 * @param {object} cats - { expenseCats, billCats } valid categories
 * @param {string} [model] - OpenRouter model id
 * @returns {Promise<{transactions: Array}>}
 */
export function parseBankStatement(apiKey, base64Pdf, cats = {}, model = DEFAULT_AI_MODEL) {
  // Models with native file support read the PDF directly (best accuracy, no
  // extra cost). Otherwise fall back to OpenRouter's free cloudflare-ai OCR so
  // PDF import still works on text-only free models.
  const engine = getAiModel(model)?.files ? 'native' : 'cloudflare-ai';
  return completeJson(apiKey, {
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: buildStatementPrompt('PDF', cats) },
        { type: 'file', file: { filename: 'statement.pdf', file_data: `data:application/pdf;base64,${base64Pdf}` } },
      ],
    }],
    plugins: [{ id: 'file-parser', pdf: { engine } }],
    schema: STATEMENT_SCHEMA,
    schemaName: 'transactions',
    model,
  });
}

const RECEIPT_PROMPT =
  'This is a grocery shop receipt. Extract every purchased product line as a structured record.\n' +
  '- rawName: the product text EXACTLY as printed on the receipt, character for character. ' +
  'Do not expand, translate, tidy, re-case or correct it. This is used to recognise the same ' +
  'line on a future receipt, so it must be reproducible.\n' +
  '- name: the same line expanded from receipt shorthand into normal words where obvious ' +
  '(e.g. "SEMI SKIM MLK 1L" -> "Semi Skimmed Milk"). Do not include the size in the name. ' +
  'If the printed text is a department or category heading rather than a product ' +
  '(e.g. "DETERG. E PROD LIMPEZA", "FRUTAS E LEGUMES"), copy rawName unchanged instead of ' +
  'inventing a product — the shopper will identify it.\n' +
  '- code: the article, PLU or SKU number printed against the line, as a plain string. ' +
  'Use "" when the receipt prints no code for that line. Never invent one.\n' +
  '- price: the total actually paid for that line as a positive number, after any discount ' +
  'shown against it. Never negative.\n' +
  '- quantity: how much was bought — the item count, or the weight/volume if sold by measure ' +
  '(e.g. "0.482 kg @ 2.99/kg" -> quantity 0.482, unit "kg"). Use 1 when no quantity is printed.\n' +
  '- unit: the unit the quantity is in — one of kg, g, L, ml, pcs, pack, bottle, can, box, bag. ' +
  'Use "pcs" for plain item counts.\n' +
  '- store: the shop name from the header, or "" if unreadable.\n' +
  '- date: the purchase date as yyyy-MM-dd, or "" if unreadable.\n' +
  'Ignore subtotals, totals, tax lines, loyalty points, change, payment method rows, and ' +
  'standalone discount lines. Only real products. Skip any line with no readable price.';

/**
 * Extract purchased line items from a shop receipt.
 * @param {string} apiKey
 * @param {{ base64: string, mimeType: string }} file - receipt photo or PDF, base64 with no data: prefix
 * @param {string} [model] - OpenRouter model id
 * @returns {Promise<{store: string, date: string, lines: Array}>}
 */
export async function parseReceipt(apiKey, { base64, mimeType }, model = DEFAULT_AI_MODEL) {
  const isPdf = /pdf/i.test(mimeType || '');

  if (isPdf) {
    // Same path as bank statements: native file input when the model supports
    // it, else OpenRouter's free OCR plugin.
    const engine = getAiModel(model)?.files ? 'native' : 'cloudflare-ai';
    return completeJson(apiKey, {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: RECEIPT_PROMPT },
          { type: 'file', file: { filename: 'receipt.pdf', file_data: `data:application/pdf;base64,${base64}` } },
        ],
      }],
      plugins: [{ id: 'file-parser', pdf: { engine } }],
      schema: RECEIPT_SCHEMA,
      schemaName: 'receipt',
      model,
    });
  }

  if (!getAiModel(model)?.vision) {
    throw new Error(
      'The selected AI model cannot read images. Choose a vision-capable model in ' +
      'Household settings, or upload the receipt as a PDF.',
    );
  }

  return completeJson(apiKey, {
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: RECEIPT_PROMPT },
        { type: 'image_url', image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${base64}` } },
      ],
    }],
    schema: RECEIPT_SCHEMA,
    schemaName: 'receipt',
    model,
  });
}

/**
 * Extract transactions from a spreadsheet bank export rendered as CSV text.
 * @param {string} apiKey
 * @param {string} csvText - the statement rows as CSV
 * @param {object} cats - { expenseCats, billCats } valid categories
 * @param {string} [model] - OpenRouter model id
 * @returns {Promise<{transactions: Array}>}
 */
export function parseStatementText(apiKey, csvText, cats = {}, model = DEFAULT_AI_MODEL) {
  return completeJson(apiKey, {
    messages: [{
      role: 'user',
      content: `${buildStatementPrompt('exported spreadsheet, given below as CSV', cats)}\n\nCSV:\n${csvText}`,
    }],
    schema: STATEMENT_SCHEMA,
    schemaName: 'transactions',
    model,
  });
}
