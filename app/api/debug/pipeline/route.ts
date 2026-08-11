import 'server-only';
import { handle, ok } from '@/lib/api/respond';
import { getCompany } from '@/lib/providers/company';
import { getTranscriptDates, getTranscript } from '@/lib/providers/transcripts';
import * as roic from '@/lib/providers/roicTranscripts';
import { isRoicConfigured } from '@/lib/config';
import { AppError } from '@/lib/types';

export async function GET(request: Request) {
  return handle(async () => {
    const url = new URL(request.url);
    const symbol = (url.searchParams.get('symbol') || 'AAPL').toUpperCase();
    const result: Record<string, unknown> = {
      symbol,
      roicConfigured: isRoicConfigured(),
    };

    if (!isRoicConfigured()) {
      return ok(result);
    }

    const company = await getCompany(symbol).catch(() => null);
    if (company) {
      result.company = {
        ticker: company.ticker,
        companyName: company.companyName,
        exchange: company.exchange,
      };
    }

    try {
      const latest = await roic.getLatestTranscript(symbol);
      result.latestTranscript = {
        ticker: latest.ticker,
        fiscalYear: latest.fiscalYear,
        fiscalQuarter: latest.fiscalQuarter,
        callDate: latest.callDate,
        source: latest.source,
        textPreview: latest.text.slice(0, 200),
      };
    } catch (error) {
      result.latestTranscriptError =
        error instanceof AppError ? error.userMessage : 'Failed to retrieve latest transcript.';
    }

    try {
      const dates = await getTranscriptDates(symbol);
      result.availableDates = dates;
    } catch (error) {
      result.availableDatesError =
        error instanceof AppError ? error.userMessage : 'Failed to fetch available transcript dates.';
    }

    try {
      const availableCalls = await roic.getAvailableCalls(symbol);
      result.roicAvailableCalls = availableCalls;
    } catch (error) {
      result.roicAvailableCallsError =
        error instanceof AppError ? error.userMessage : 'Failed to fetch ROIC available call listings.';
    }

    try {
      const latest = result.latestTranscript as { fiscalYear: number; fiscalQuarter: number } | undefined;
      if (latest) {
        const transcript = await getTranscript(symbol, latest.fiscalYear, latest.fiscalQuarter);
        result.latestTranscriptFetch = {
          ticker: transcript.ticker,
          fiscalYear: transcript.fiscalYear,
          fiscalQuarter: transcript.fiscalQuarter,
          callDate: transcript.callDate,
          source: transcript.source,
          textPreview: transcript.text.slice(0, 200),
        };
      }
    } catch (error) {
      result.latestTranscriptFetchError =
        error instanceof AppError ? error.userMessage : 'Failed to fetch transcript for the latest period.';
    }

    return ok(result);
  });
}
