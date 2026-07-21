// Vetted OpenRouter models offered in Household settings.
// IDs verified against https://openrouter.ai/api/v1/models — OpenRouter's free
// roster rotates, so re-check these periodically (a removed model returns
// "No endpoints found for <id>").
//
// `files: true`  → the model reads PDFs natively (best accuracy).
// `files: false` → no native file input; PDF import falls back to OpenRouter's
//                  free cloudflare-ai OCR (see parseBankStatement). Structured
//                  output still works, so chat / recipes / Excel import are fine.

export const AI_MODELS = [
  { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B',      tier: 'free', files: false, hint: 'Free · rate-limited (~50/day)' },
  { id: 'openai/gpt-oss-20b:free',    label: 'GPT-OSS 20B',      tier: 'free', files: false, hint: 'Free · rate-limited (~50/day)' },
  { id: 'google/gemini-2.5-flash',    label: 'Gemini 2.5 Flash', tier: 'paid', files: true,  hint: 'Best accuracy — recommended for PDFs' },
  { id: 'openai/gpt-4o-mini',         label: 'GPT-4o mini',      tier: 'paid', files: true,  hint: 'Reliable, low cost' },
];

// Default when a household hasn't chosen one — a cheap, reliable paid model
// (avoids the free tier's shared rate limits). Free options stay selectable.
export const DEFAULT_AI_MODEL = 'openai/gpt-4o-mini';

export const getAiModel = (id) => AI_MODELS.find((m) => m.id === id);
