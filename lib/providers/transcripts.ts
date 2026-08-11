import 'server-only';
import { fmpFetch, toDateString } from './fmp/client';
import { fixtureTranscript, fixtureTranscriptRefs } from './fixtures';
import { isFmpConfigured } from '@/lib/config';
import {
  AppError,
  compareQuartersDesc,
  normalizeTicker,
  type Transcript,
  type TranscriptRef,
} from '@/lib/types';

/**
 * Earnings-call transcript retrieval.
 *
 * Responses are normalized to our `Transcript` shape here so that nothing
 * downstream knows FMP's field names or its positional array format.
 */

/** /api/v4/earning_call_transcript returns [quarter, year, date] tuples. */
type FmpTranscriptDate = [number | string, number | string, string];

interface FmpTranscript {
  symbol?: string;
  quarter?: number | string;
  year?: number | string;
  date?: string;
  content?: string;
}

const MIN_TRANSCRIPT_CHARS = 500;

/** Lists the calls available for a ticker, newest first. */
export async function getTranscriptDates(rawTicker: string): Promise<TranscriptRef[]> {
  const ticker = normalizeTicker(rawTicker);

  if (!isFmpConfigured()) {
    const refs = fixtureTranscriptRefs(ticker);
    if (refs.length === 0) {
      throw new AppError(
        'transcript_unavailable',
        `No transcripts are available offline for ${ticker}.`,
      );
    }
    return refs;
  }

  const rows = await fmpFetch<FmpTranscriptDate[]>('earning_call_transcript', {
    version: 'stable',
    query: { symbol: ticker },
    revalidate: 60 * 60 * 6,
  });

  const refs = (rows ?? [])
    .map((row): TranscriptRef | null => {
      if (!Array.isArray(row) || row.length < 2) return null;
      const quarter = Number(row[0]);
      const year = Number(row[1]);
      if (!Number.isFinite(quarter) || !Number.isFinite(year)) return null;
      if (quarter < 1 || quarter > 4) return null;

      return {
        ticker,
        fiscalYear: year,
        fiscalQuarter: quarter,
        callDate: toDateString(row[2]),
      };
    })
    .filter((r): r is TranscriptRef => r !== null)
    .sort(compareQuartersDesc);

  if (refs.length === 0) {
    throw new AppError(
      'transcript_unavailable',
      `No earnings call transcripts are available for ${ticker}.`,
    );
  }

  return refs;
}

export async function getTranscript(
  rawTicker: string,
  year: number,
  quarter: number,
): Promise<Transcript> {
  const ticker = normalizeTicker(rawTicker);

  if (!isFmpConfigured()) {
    const fixture = fixtureTranscript(ticker, year, quarter);
    if (!fixture) {
      throw new AppError(
        'transcript_unavailable',
        `No offline transcript for ${ticker} Q${quarter} FY${year}.`,
      );
    }
    return fixture;
  }

  const rows = await fmpFetch<FmpTranscript[]>('earning_call_transcript', {
    version: 'stable',
    query: { symbol: ticker, year, quarter },
    // Transcripts are immutable once published; cache hard.
    revalidate: 60 * 60 * 24 * 30,
  });

  const row = rows?.[0];
  const content = row?.content?.trim();

  // A short body means the provider returned a stub. Treating it as a real
  // transcript would feed the model near-empty input and produce a confident
  // analysis of nothing.
  if (!content || content.length < MIN_TRANSCRIPT_CHARS) {
    throw new AppError(
      'transcript_unavailable',
      `The transcript for ${ticker} Q${quarter} FY${year} is not available.`,
    );
  }

  return {
    ticker,
    fiscalYear: Number(row?.year ?? year),
    fiscalQuarter: Number(row?.quarter ?? quarter),
    callDate: toDateString(row?.date),
    text: content,
    source: 'fmp',
  };
}
