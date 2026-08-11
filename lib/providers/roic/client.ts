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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        // Prefer Authorization header; many APIs accept Bearer tokens.
        Authorization: `Bearer ${config.roic.apiKey}`,
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

  return { url, response };
}

export function redactRoicUrl(url: URL): string {
  const r = new URL(url.toString());
  if (r.searchParams.has('api_key')) r.searchParams.set('api_key', '[REDACTED]');
  return `${r.pathname}${r.search}`;
}
