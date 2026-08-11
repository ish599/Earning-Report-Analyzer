import 'server-only';
import { config, isRoicConfigured } from '@/lib/config';
import { AppError } from '@/lib/types';

const REQUEST_TIMEOUT_MS = 20_000;

export async function roicRawFetch(path: string, query?: Record<string, string | number | undefined>) {
  if (!isRoicConfigured()) {
    throw new AppError('provider_not_configured', 'Transcript provider is not configured.');
  }

  const base = config.roic.baseUrl!.replace(/\/$/, '');
  const url = new URL(`${base}/${path.replace(/^\//, '')}`);

  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  // ROIC accepts API key auth via query parameters in production.
  url.searchParams.set('apikey', config.roic.apiKey!);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
      },
    });
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === 'AbortError';
    throw new AppError(
      'provider_error',
      aborted ? 'The transcript provider timed out.' : 'Could not reach the transcript provider.',
      { cause },
    );
  } finally {
    clearTimeout(timer);
  }

  // Map common HTTP error codes to AppError codes for transcript-specific handling.
  if (response.status === 401) {
    throw new AppError('provider_authentication', 'Transcript provider authentication failed.', {
      cause: new Error(`ROIC ${response.status} ${url.pathname}`),
      status: 401,
    });
  }
  if (response.status === 402 || response.status === 403) {
    throw new AppError('provider_error', 'Transcript access is not available under the current provider plan.', {
      cause: new Error(`ROIC ${response.status} ${url.pathname}`),
      status: response.status,
    });
  }
  if (response.status === 404) {
    throw new AppError('transcript_unavailable', 'No earnings transcript was found for this company.', {
      cause: new Error(`ROIC ${response.status} ${url.pathname}`),
      status: 404,
    });
  }
  if (response.status === 429) {
    throw new AppError('provider_rate_limit', 'Transcript provider rate limit reached. Please try again shortly.', {
      cause: new Error(`ROIC ${response.status} ${url.pathname}`),
      status: 429,
    });
  }
  if (response.status >= 500) {
    throw new AppError('provider_error', 'The transcript provider is temporarily unavailable.', {
      cause: new Error(`ROIC ${response.status} ${url.pathname}`),
      status: response.status,
    });
  }

  return { url, response };
}

export function redactRoicUrl(url: URL): string {
  const r = new URL(url.toString());
  return `${r.pathname}${r.search}`;
}
