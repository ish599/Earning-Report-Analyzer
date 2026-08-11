import 'server-only';
import { roicRawFetch } from './roic/client';
import { AppError } from '@/lib/types';
import { toDateString } from './fmp/client';

/** Normalized transcript shapes used by the app */
import type { Transcript, TranscriptRef } from '@/lib/types';

/**
 * ROIC provider adapter.
 *
 * Attempts to call the ROIC endpoints and normalise to the application's
 * Transcript and TranscriptRef types. The exact ROIC paths depend on the
 * provider; callers may need to adjust `roicRawFetch` path strings if ROIC
 * docs differ. A debug endpoint helps validate runtime paths.
 */

export async function getAvailableCalls(rawTicker: string): Promise<TranscriptRef[]> {
  const ticker = rawTicker.toUpperCase();
  try {
    const { url, response } = await roicRawFetch('transcripts/available', { symbol: ticker });
    if (response.status === 404) throw new AppError('transcript_unavailable', `No transcripts available for ${ticker}.`);
    if (!response.ok) throw new AppError('provider_error', 'The transcript provider returned an error.');
    const payload = await response.json().catch(() => null);
    if (!payload || !Array.isArray(payload)) throw new AppError('provider_error', 'Transcript provider returned unexpected data.');

    // Expect rows like [{ year:2026, quarter:3, date: '2026-08-01' }, ...]
    const refs: TranscriptRef[] = (payload as any[])
      .map((r) => {
        const year = Number(r.year ?? r.fiscalYear ?? r.fy);
        const quarter = Number(r.quarter ?? r.fq ?? r.fiscalQuarter);
        const date = toDateString(r.date ?? r.callDate ?? r.published_at);
        if (!Number.isFinite(year) || !Number.isFinite(quarter)) return null;
        return { ticker, fiscalYear: year, fiscalQuarter: quarter, callDate: date } as TranscriptRef;
      })
      .filter((x): x is TranscriptRef => x !== null)
      .sort((a, b) => (a.fiscalYear === b.fiscalYear ? b.fiscalQuarter - a.fiscalQuarter : b.fiscalYear - a.fiscalYear));

    if (refs.length === 0) throw new AppError('transcript_unavailable', `No transcripts available for ${ticker}.`);
    return refs;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('provider_error', 'Transcript provider failure.', { cause: e });
  }
}

export async function getLatestTranscript(rawTicker: string): Promise<Transcript> {
  const refs = await getAvailableCalls(rawTicker);
  const first = refs[0];
  return getTranscript(rawTicker, first.fiscalYear, first.fiscalQuarter);
}

export async function getTranscript(rawTicker: string, year: number, quarter: number): Promise<Transcript> {
  const ticker = rawTicker.toUpperCase();
  try {
    const { url, response } = await roicRawFetch('transcripts/get', { symbol: ticker, year, quarter });
    if (response.status === 404) throw new AppError('transcript_unavailable', `Transcript for ${ticker} Q${quarter} FY${year} not found.`);
    if (!response.ok) throw new AppError('provider_error', 'The transcript provider returned an error.');

    const payload = await response.json().catch(() => null);
    // Normalize expecting { content: '...text...', date: '2026-08-01', sections: [...] }
    const content = (payload?.content ?? payload?.transcript ?? payload?.text) as string | undefined;
    const date = toDateString(payload?.date ?? payload?.callDate ?? payload?.published_at);
    if (!content || typeof content !== 'string' || content.trim().length < 100) {
      throw new AppError('transcript_unavailable', `Transcript for ${ticker} Q${quarter} FY${year} is not available.`);
    }

    return {
      ticker,
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
