import 'server-only';
import { handle, ok } from '@/lib/api/respond';
import { fmpRawFetch, redactFmpUrl } from '@/lib/providers/fmp/client';
import { isFmpConfigured } from '@/lib/config';

interface TestResult {
  name: string;
  ok: boolean;
  requestPath?: string;
  status?: number;
  contentType?: string | null;
  providerBodyPreview?: string | null;
  error?: string | null;
}

export async function GET(request: Request) {
  return handle(async () => {
    const url = new URL(request.url);
    const symbol = (url.searchParams.get('symbol') || 'AAPL').toUpperCase();

    const results: TestResult[] = [];

    if (!isFmpConfigured()) {
      return ok({ fmpConfigured: false, tests: results });
    }

    async function run(path: string, options: Parameters<typeof fmpRawFetch>[1] = {}) {
      try {
        const { url, response } = await fmpRawFetch(path, options);
        const contentType = response.headers.get('content-type');
        const text = await response.text().catch(() => '');
        const preview = text ? text.slice(0, 1000) : null;
        return {
          ok: response.ok,
          requestPath: redactFmpUrl(url),
          status: response.status,
          contentType,
          providerBodyPreview: preview,
          error: null,
        } as Omit<TestResult, 'name'>;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, requestPath: undefined, status: undefined, contentType: null, providerBodyPreview: null, error: msg };
      }
    }

    // 1) Company profile + quote (used earlier and known working)
    results.push({ name: 'profile', ...(await run('profile', { version: 'stable', query: { symbol } })) });
    results.push({ name: 'quote', ...(await run('quote', { version: 'stable', query: { symbol } })) });

    // 2) Transcript dates (list)
    const transcriptList = await run('earning_call_transcript', {
      version: 'stable',
      query: { symbol },
      revalidate: 60 * 60 * 6,
    });
    results.push({ name: 'transcriptList', ...(transcriptList as any) });

    // If the transcript list returned rows, attempt to fetch the first transcript
    try {
      if (transcriptList.ok && transcriptList.providerBodyPreview) {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(transcriptList.providerBodyPreview);
        } catch {
          // If the preview isn't full JSON, re-fetch the full JSON via fmpRawFetch
          const full = await fmpRawFetch('earning_call_transcript', {
            version: 'stable',
            query: { symbol },
            revalidate: 60 * 60 * 6,
          });
          parsed = await full.response.json().catch(() => null);
        }

        if (Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0])) {
          const first = parsed[0] as any[];
          const year = first[1];
          const quarter = first[0];
          results.push({
            name: 'transcript',
            ...(await run('earning_call_transcript', { version: 'stable', query: { symbol, year, quarter } })),
          });
        } else {
          // Try alternate stable endpoints if shape differs
          const altList = await run('earning-call-transcript-dates', { version: 'stable', query: { symbol } });
          results.push({ name: 'transcriptList_alt', ...(altList as any) });
          if (altList.ok && altList.providerBodyPreview) {
            // no deeper parse attempt here
          }
        }
      } else {
        // transcript list failed; try the documented alternative endpoints to help diagnose
        const alt1 = await run('earning-call-transcript-dates', { version: 'stable', query: { symbol } });
        results.push({ name: 'transcriptList_alternative_endpoint', ...(alt1 as any) });
      }
    } catch (e) {
      results.push({ name: 'transcript_check_error', ok: false, error: e instanceof Error ? e.message : String(e) });
    }

    // 3) Financials: income-statement and historical earning calendar
    results.push({ name: 'income_statement', ...(await run('income-statement', { version: 'stable', query: { symbol, period: 'quarter', limit: 12 } })) });
    results.push({ name: 'earnings_calendar', ...(await run('historical/earning_calendar', { version: 'stable', query: { symbol } })) });

    // 4) Historical prices
    results.push({ name: 'historical_prices', ...(await run('historical-price-full', { version: 'stable', query: { symbol } })) });
    // Also test the eod/full documented variant
    results.push({ name: 'historical_prices_eod_full', ...(await run('historical-price-eod/full', { version: 'stable', query: { symbol } })) });

    return ok({ fmpConfigured: true, symbol, tests: results });
  });
}
