import Link from 'next/link';
import { SearchBar } from './SearchBar';
import { AppError, type AppErrorCode } from '@/lib/types';

/**
 * Terminal error state for a company page.
 *
 * Each error code gets a specific explanation and a next step. A generic
 * "something went wrong" leaves an analyst unable to tell a bad ticker from an
 * expired API key, so the copy distinguishes them.
 */

const GUIDANCE: Partial<Record<AppErrorCode, { title: string; detail: string }>> = {
  invalid_ticker: {
    title: 'That ticker does not look valid',
    detail: 'Enter a US listing of one to five letters, such as AAPL, NET, or DDOG.',
  },
  company_not_found: {
    title: 'No company found',
    detail: 'The data provider does not recognise this symbol. Check the spelling or try another.',
  },
  transcript_unavailable: {
    title: 'No transcripts available',
    detail:
      'The provider has no earnings call transcripts for this company. Coverage is strongest for larger US listings.',
  },
  provider_rate_limit: {
    title: 'Data provider rate limit reached',
    detail: 'Too many requests, or this data is outside the current plan. Try again shortly.',
  },
  provider_authentication: {
    title: 'Market data provider rejected credentials',
    detail:
      'The FMP API key is present, but the provider rejected it. Verify FMP_API_KEY in your deployment settings.',
  },
  provider_not_configured: {
    title: 'Market data is not configured',
    detail: 'This deployment has no market data credentials, so live company coverage is unavailable.',
  },
  provider_error: {
    title: 'Unable to load market data',
    detail: 'The market data provider returned an error. Try again later.',
  },
  llm_not_configured: {
    title: 'Analysis is not configured',
    detail: 'Transcript analysis requires XAI_API_KEY to be set on the server.',
  },
  llm_timeout: {
    title: 'Analysis timed out',
    detail: 'The transcript took too long to analyze. Try again — completed quarters are cached.',
  },
  llm_invalid_response: {
    title: 'Analysis could not be validated',
    detail: 'The model returned output that failed validation twice. Try again.',
  },
  database_error: {
    title: 'Storage is unavailable',
    detail: 'Saved analyses could not be read. Check the database configuration and try again.',
  },
};

export function ErrorPanel({ ticker, error }: { ticker: string; error: unknown }) {
  const code: AppErrorCode = error instanceof AppError ? error.code : 'unknown';
  const guidance = GUIDANCE[code];

  const title = guidance?.title ?? 'Something went wrong';
  const detail =
    guidance?.detail ??
    (error instanceof AppError ? error.userMessage : 'An unexpected error occurred.');

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-5 py-16">
      <Link href="/" className="mb-8 text-sm font-semibold tracking-tight text-ink">
        Earnings Intelligence
      </Link>

      <div className="panel">
        <div className="panel-body">
          <p className="font-mono text-xs text-ink-muted">{ticker}</p>
          <h1 className="mt-1 text-lg font-semibold text-ink">{title}</h1>
          <p className="mt-1.5 text-base text-ink-secondary">{detail}</p>

          {error instanceof AppError && error.userMessage !== detail && (
            <p className="mt-2 text-sm text-ink-muted">{error.userMessage}</p>
          )}

          <div className="mt-5 border-t border-line pt-4">
            <p className="field-label mb-2">Try another company</p>
            <SearchBar />
          </div>
        </div>
      </div>

      <Link
        href="/"
        className="mt-4 text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
      >
        Back to search
      </Link>
    </main>
  );
}
