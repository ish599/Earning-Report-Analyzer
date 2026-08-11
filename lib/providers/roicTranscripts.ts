import 'server-only';
import { roicRawFetch } from './roic/client';
import { AppError } from '@/lib/types';
import { toDateString } from './fmp/client';
import { getCompany } from './company';

/** Normalized transcript shapes used by the app */
import type { Transcript, TranscriptRef } from '@/lib/types';

/**
 * ROIC provider adapter — implemented using documented ROIC endpoints.
 *
 * - Latest transcript (v2): GET /v2/company/earnings-calls/latest/{ticker}
 * - Available calls (v3): GET /v3.0.0/earnings-calls?identifier={EXCHANGE:TICKER}&order=desc
 *
 * Historical retrieval via v3 is intentionally not implemented here; the
 * MVP relies on the latest endpoint for core functionality.
 */

export async function getAvailableCalls(rawTicker: string): Promise<TranscriptRef[]> {
  const ticker = rawTicker.toUpperCase();

  try {
    // Attempt to determine exchange via company metadata (FMP). If available,
    // call the v3 listing endpoint using the exchange-prefixed identifier.
    let identifier: string | null = null;
    try {
      const company = await getCompany(ticker);
      if (company.exchange) {
        // Normalize exchange to simple code (assume already like 'NASDAQ' or 'NYSE')
        identifier = `${company.exchange}:${ticker}`;
      }
    } catch {
      // If company lookup fails, fall back to latest endpoint below.
      identifier = null;
    }

    if (identifier) {
      const path = 'v3.0.0/earnings-calls';
      const { url, response } = await roicRawFetch(path, { identifier, order: 'desc' });
      const payload = await response.json().catch(() => null);
      const items = payload?.data;
      if (!payload || !Array.isArray(items)) {
        throw new AppError('provider_error', 'Transcript provider returned unexpected data.');
      }

      const refs: TranscriptRef[] = (items as any[])
        .map((r) => {
          const rawSymbol = String(r.symbol ?? '');
          const extractedTicker = rawSymbol.includes(':') ? rawSymbol.split(':').pop() ?? ticker : ticker;
          const year = Number(r.fiscal_year ?? r.fiscalYear);
          const quarter = Number(r.fiscal_quarter ?? r.fiscalQuarter);
          const date = toDateString(r.date ?? r.callDate);
          if (!Number.isFinite(year) || !Number.isFinite(quarter)) return null;
          return {
            ticker: extractedTicker,
            fiscalYear: year,
            fiscalQuarter: quarter,
            callDate: date,
            providerId: String(r.id ?? ''),
          } as TranscriptRef;
        })
        .filter((x): x is TranscriptRef => x !== null)
        .sort((a, b) => (a.fiscalYear === b.fiscalYear ? b.fiscalQuarter - a.fiscalQuarter : b.fiscalYear - a.fiscalYear));

      if (refs.length > 0) return refs;
    }

    // If v3 listing is unavailable or produced no refs, fall back to the v2
    // latest endpoint to return at least the most recent transcript.
    const latest = await getLatestTranscript(ticker).catch(() => null);
    if (latest) return [ { ticker: latest.ticker, fiscalYear: latest.fiscalYear, fiscalQuarter: latest.fiscalQuarter, callDate: latest.callDate } ];

    throw new AppError('transcript_unavailable', `No transcripts available for ${ticker}.`);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('provider_error', 'Transcript provider failure.', { cause: e });
  }
}

export function normalizeRoicLatestPayload(payload: unknown): Transcript {
  if (typeof payload !== 'object' || payload === null) {
    throw new AppError('provider_error', 'Transcript provider returned unexpected data.');
  }

  const symbol = (payload as any).symbol;
  const year = (payload as any).year;
  const quarter = (payload as any).quarter;
  const dateValue = (payload as any).date;
  const content = (payload as any).content;

  if (
    typeof symbol !== 'string' ||
    !Number.isFinite(Number(year)) ||
    !Number.isFinite(Number(quarter)) ||
    typeof dateValue !== 'string' ||
    typeof content !== 'string' ||
    content.trim().length === 0
  ) {
    throw new AppError('provider_error', 'Transcript provider returned unexpected data.');
  }

  return {
    ticker: symbol.toUpperCase(),
    fiscalYear: Number(year),
    fiscalQuarter: Number(quarter),
    callDate: toDateString(dateValue),
    text: content.trim(),
    source: 'roic',
  } as Transcript;
}

export async function getLatestTranscript(rawTicker: string): Promise<Transcript> {
  const ticker = rawTicker.toUpperCase();
  try {
    const path = `v2/company/earnings-calls/latest/${ticker}`;
    const { url, response } = await roicRawFetch(path);
    const payload = await response.json().catch(() => null);
    return normalizeRoicLatestPayload(payload);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('provider_error', 'Transcript provider failure.', { cause: e });
  }
}

export async function getTranscript(rawTicker: string, year: number, quarter: number): Promise<Transcript> {
  // Historical retrieval is not implemented — rely on latest endpoint for MVP.
  const latest = await getLatestTranscript(rawTicker);
  if (latest.fiscalYear === year && latest.fiscalQuarter === quarter) return latest;
  throw new AppError('transcript_unavailable', `Transcript for ${rawTicker} Q${quarter} FY${year} is not available.`);
}
