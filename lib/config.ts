import 'server-only';

/**
 * Server-side configuration.
 *
 * The `server-only` import above is load-bearing: it makes the build fail if
 * any client component ever imports this module, which is the guarantee that
 * FMP_API_KEY and XAI_API_KEY cannot reach the browser.
 */

const apiKey = process.env.FMP_API_KEY?.trim() ?? null;

function read(name: string): string | null {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : null;
}

export const config = {
  fmp: {
    apiKey,
    baseUrl: read('FMP_BASE_URL') ?? 'https://financialmodelingprep.com',
  },
  xai: {
    apiKey: process.env.XAI_API_KEY?.trim() ?? null,
    baseUrl: process.env.XAI_BASE_URL?.trim() ?? 'https://api.x.ai/v1',
    model: process.env.XAI_MODEL?.trim() ?? 'grok-4',
    /** Serverless functions cap out well before this; keep headroom. */
    timeoutMs: Number(process.env.XAI_TIMEOUT_MS?.trim() ?? 90_000),
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY?.trim() ?? null,
    baseUrl: process.env.GEMINI_BASE_URL?.trim() ?? 'https://generativelanguage.googleapis.com/v1beta/models',
    model: process.env.GEMINI_MODEL?.trim() ?? 'gemini-3.6-flash',
    /** Serverless functions cap out well before this; keep headroom. */
    timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS?.trim() ?? 90_000),
  },
  roic: {
    apiKey: read('ROIC_API_KEY'),
    baseUrl: 'https://api.roic.ai',
  },
  supabase: {
    url: read('SUPABASE_URL') ?? read('NEXT_PUBLIC_SUPABASE_URL'),
    secretKey: read('SUPABASE_SECRET_KEY'),
  },
} as const;

export const isFmpConfigured = (): boolean => config.fmp.apiKey !== null;
export const isXaiConfigured = (): boolean => config.xai.apiKey !== null;
export const isGeminiConfigured = (): boolean => config.gemini.apiKey !== null;
export const isSupabaseConfigured = (): boolean =>
  config.supabase.url !== null && config.supabase.secretKey !== null;
export const isRoicConfigured = (): boolean => config.roic.apiKey !== null;

/**
 * Bump when the prompt, schema, or scoring logic changes in a way that makes
 * previously stored analyses non-comparable. A mismatch against the stored
 * `analysis_version` is what forces a re-analysis; equal versions are always
 * served from cache.
 */
export const ANALYSIS_VERSION = '2026.08.1';

/** Quarters analyzed on the first visit to a ticker. Older calls load on demand. */
export const INITIAL_ANALYSIS_QUARTERS = 4;

/** Prior quarters given to the model as context for the QoQ comparison. */
export const QOQ_LOOKBACK_QUARTERS = 4;
