import 'server-only';
import { config, isFmpConfigured } from '@/lib/config';
import { AppError } from '@/lib/types';

/**
 * The single point at which this application talks to Financial Modeling Prep.
 *
 * Everything vendor-specific lives here or in the modules under
 * `lib/providers/` that call it: authentication, URL shape, rate-limit
 * semantics, and error mapping. No UI component or route handler may import
 * this module directly.
 */

interface FetchOptions {
  /** FMP stable endpoints live at /stable/. Some older surfaces still use /api/v4. */
  version?: 'stable' | 'v3' | 'v4';
  query?: Record<string, string | number | undefined>;
  /** Seconds to cache in Next's data cache. Reference data changes slowly. */
  revalidate?: number;
}

const DEFAULT_REVALIDATE = 60 * 60; // 1 hour
const REQUEST_TIMEOUT_MS = 20_000;

function buildFmpUrl(path: string, version: FetchOptions['version'], query?: Record<string, string | number | undefined>) {
  const base = config.fmp.baseUrl.replace(/\/$/, '');
  const prefix = version === 'stable' || version === undefined ? 'stable' : `api/${version}`;
  const url = new URL(`${base}/${prefix}/${path.replace(/^\//, '')}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  url.searchParams.set('apikey', config.fmp.apiKey!);
  return url;
}

export function redactFmpUrl(url: URL): string {
  const redacted = new URL(url.toString());
  if (redacted.searchParams.has('apikey')) {
    redacted.searchParams.set('apikey', '[REDACTED]');
  }
  return `${redacted.pathname}${redacted.search}`;
}

export async function fmpRawFetch(path: string, options: FetchOptions = {}) {
  if (!isFmpConfigured()) {
    throw new AppError(
      'provider_not_configured',
      'Market data is not configured on this deployment.',
    );
  }

  const url = buildFmpUrl(path, options.version, options.query);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      next: { revalidate: options.revalidate ?? DEFAULT_REVALIDATE },
    });
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === 'AbortError';
    throw new AppError(
      'provider_error',
      aborted
        ? 'The market data provider timed out. Please try again.'
        : 'Could not reach the market data provider.',
      { cause },
    );
  } finally {
    clearTimeout(timer);
  }

  return { url, response };
}

export async function fmpFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { url, response } = await fmpRawFetch(path, options);

  if (response.status === 429) {
    throw new AppError(
      'provider_rate_limit',
      'The market data provider rate limit was reached. Please try again shortly.',
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new AppError(
      'provider_authentication',
      'The market data provider rejected our credentials.',
      { cause: new Error(`FMP ${response.status} on ${redactFmpUrl(url)}`) },
    );
  }

  if (!response.ok) {
    throw new AppError('provider_error', 'The market data provider returned an error.', {
      cause: new Error(`FMP ${response.status} on ${redactFmpUrl(url)}`),
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new AppError('provider_error', 'The market data provider returned an invalid response.', {
      cause,
    });
  }

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const message = (payload as Record<string, unknown>)['Error Message'];
    if (typeof message === 'string') {
      const isLimit = /limit|upgrade|plan|exclusive/i.test(message);
      throw new AppError(
        isLimit ? 'provider_rate_limit' : 'provider_error',
        isLimit
          ? 'This data is not available on the current market data plan.'
          : 'The market data provider returned an error.',
        { cause: new Error(message) },
      );
    }
  }

  return payload as T;
}

/** Numeric fields arrive as numbers, numeric strings, or null. */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toDateString(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 10) return null;
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}
