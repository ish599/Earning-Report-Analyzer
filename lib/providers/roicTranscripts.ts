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
      identifier = null;
    }

    if (identifier) {
      try {
        const path = 'v3.0.0/earnings-calls';
        const { response } = await roicRawFetch(path, { identifier, order: 'desc' });
        const payload = await response.json().catch(() => null);
        const items = Array.isArray(payload?.data)
          ? payload.data
          : Array.isArray(payload)
          ? payload
          : Array.isArray((payload as any)?.items)
          ? (payload as any).items
          : null;

        if (payload && Array.isArray(items)) {
          const refs: TranscriptRef[] = (items as any[])
            .map((r) => {
              const rawSymbol = String(r.symbol ?? r.ticker ?? '');
              const extractedTicker = rawSymbol.includes(':') ? rawSymbol.split(':').pop() ?? ticker : ticker;
              const year = Number(r.fiscal_year ?? r.fiscalYear ?? r.year);
              const quarter = Number(r.fiscal_quarter ?? r.fiscalQuarter ?? r.quarter);
              const date = toDateString(r.date ?? r.callDate ?? r.eventDate ?? r.reportDate);
              if (!Number.isFinite(year) || !Number.isFinite(quarter)) return null;
              return {
                ticker: extractedTicker,
                fiscalYear: year,
                fiscalQuarter: quarter,
                callDate: date,
                providerId: String(r.id ?? r.providerId ?? ''),
              } as TranscriptRef;
            })
            .filter((x): x is TranscriptRef => x !== null)
            .sort((a, b) =>
              a.fiscalYear === b.fiscalYear ? b.fiscalQuarter - a.fiscalQuarter : b.fiscalYear - a.fiscalYear,
            );

          if (refs.length > 0) return refs;
        }
      } catch {
        // The ROIC v3 listing endpoint is useful metadata but not required for
        // the MVP. If it fails, fall back to the latest transcript instead.
      }
    }

    const latest = await getLatestTranscript(ticker).catch(() => null);
    if (latest)
      return [
        {
          ticker: latest.ticker,
          fiscalYear: latest.fiscalYear,
          fiscalQuarter: latest.fiscalQuarter,
          callDate: latest.callDate,
        },
      ];

    throw new AppError('transcript_unavailable', `No transcripts available for ${ticker}.`);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('provider_error', 'Transcript provider failure.', { cause: e });
  }
}

const MIN_TRANSCRIPT_CHARS = 500;

export function normalizeRoicLatestPayload(payload: unknown): Transcript {
  if (typeof payload !== 'object' || payload === null) {
    throw new AppError('provider_error', 'Transcript provider returned unexpected data.');
  }

  const data = payload as Record<string, unknown>;
  const symbol = String(data.symbol ?? data.ticker ?? '').trim();
  const year = Number(data.year ?? data.fiscalYear);
  const quarter = Number(data.quarter ?? data.fiscalQuarter);
  const dateValue = String(data.date ?? data.callDate ?? data.eventDate ?? '').trim();
  const content = String(data.content ?? data.transcript ?? data.text ?? '').trim();

  if (
    symbol.length === 0 ||
    !Number.isFinite(year) ||
    !Number.isFinite(quarter) ||
    quarter < 1 ||
    quarter > 4 ||
    dateValue.length === 0 ||
    content.length < MIN_TRANSCRIPT_CHARS
  ) {
    throw new AppError('provider_error', 'Transcript provider returned unexpected data.');
  }

  return {
    ticker: symbol.toUpperCase(),
    fiscalYear: year,
    fiscalQuarter: quarter,
    callDate: toDateString(dateValue),
    text: content,
    source: 'roic',
  };
}

export async function getLatestTranscript(rawTicker: string): Promise<Transcript> {
  const ticker = rawTicker.toUpperCase();
  try {
    const path = `v2/company/earnings-calls/latest/${ticker}`;
    const { response } = await roicRawFetch(path);
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
