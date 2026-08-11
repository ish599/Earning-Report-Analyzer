import 'server-only';

/**
 * Server-side configuration.
 *
 * The `server-only` import above is load-bearing: it makes the build fail if
 * any client component ever imports this module, which is the guarantee that
 * FMP_API_KEY and XAI_API_KEY cannot reach the browser.
 */

function read(name: string): string | null {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : null;
}

export const config = {
  fmp: {
    apiKey: read('FMP_API_KEY'),
    baseUrl: read('FMP_BASE_URL') ?? 'https://financialmodelingprep.com',
  },
  xai: {
    apiKey: read('XAI_API_KEY'),
    baseUrl: read('XAI_BASE_URL') ?? 'https://api.x.ai/v1',
    model: read('XAI_MODEL') ?? 'grok-4',
    /** Serverless functions cap out well before this; keep headroom. */
    timeoutMs: Number(read('XAI_TIMEOUT_MS') ?? 90_000),
  },
  supabase: {
    url: read('SUPABASE_URL') ?? read('NEXT_PUBLIC_SUPABASE_URL'),
    secretKey: read('SUPABASE_SECRET_KEY'),
  },
} as const;

export const isFmpConfigured = (): boolean => config.fmp.apiKey !== null;
export const isXaiConfigured = (): boolean => config.xai.apiKey !== null;
export const isSupabaseConfigured = (): boolean =>
  config.supabase.url !== null && config.supabase.secretKey !== null;

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
