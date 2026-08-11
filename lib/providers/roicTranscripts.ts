import 'server-only';
import { roicRawFetch, redactRoicUrl } from './roic/client';
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
      if (!payload || !Array.isArray(payload)) throw new AppError('provider_error', 'Transcript provider returned unexpected data.');

      const refs: TranscriptRef[] = (payload as any[])
        .map((r) => {
          // ROIC v3 records typically include an announcement date and period info
          const year = Number(r.year ?? r.fiscal_year ?? r.fiscalYear ?? (r.announcement_date ? new Date(r.announcement_date).getUTCFullYear() : NaN));
          const quarter = Number(r.quarter ?? r.fiscal_quarter ?? r.fiscalQuarter ?? NaN);
          const date = toDateString(r.announcement_date ?? r.date ?? r.callDate);
          if (!Number.isFinite(year) || !Number.isFinite(quarter)) return null;
          return { ticker, fiscalYear: year, fiscalQuarter: quarter, callDate: date } as TranscriptRef;
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

export async function getLatestTranscript(rawTicker: string): Promise<Transcript> {
  const ticker = rawTicker.toUpperCase();
  try {
    const path = `v2/company/earnings-calls/latest/${ticker}`;
    const { url, response } = await roicRawFetch(path);
    const payload = await response.json().catch(() => null);

    // Expect payload like { symbol, year, quarter, date, content }
    const symbol = payload?.symbol ?? payload?.ticker ?? ticker;
    const year = Number(payload?.year ?? payload?.fiscal_year ?? payload?.fiscalYear);
    const quarter = Number(payload?.quarter ?? payload?.fiscal_quarter ?? payload?.fiscalQuarter);
    const date = toDateString(payload?.date ?? payload?.callDate ?? payload?.announcement_date);
    const content = (payload?.content ?? payload?.transcript ?? payload?.text) as string | undefined;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      throw new AppError('transcript_unavailable', `No earnings transcript was found for ${ticker}.`);
    }

    return {
      ticker: String(symbol).toUpperCase(),
      fiscalYear: Number(year),
      fiscalQuarter: Number(quarter),
      callDate: date,
      text: content.trim(),
      source: 'roic',
    } as Transcript;
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
