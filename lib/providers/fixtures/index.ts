import 'server-only';
import transcriptData from './data/transcripts.json';
import priceData from './data/prices.json';
import type { CompanyProfile, PricePoint, Transcript, TranscriptRef } from '@/lib/types';

/**
 * Offline fixture provider.
 *
 * Backs the app when FMP_API_KEY is absent so the product can be developed and
 * demonstrated without credentials or quota. Coverage is deliberately narrow:
 * four consecutive RH earnings calls (Q4 FY2025 through Q3 FY2026) and daily
 * closes spanning them.
 *
 * Caveats that the UI must respect:
 *   * Prices are unadjusted closes; `adjClose` mirrors `close`. RH paid no
 *     dividends over this window, but the fixture makes no general promise.
 *   * No financial statements or consensus estimates. Financials resolve to
 *     null in fixture mode and the UI shows its missing-data state, which is
 *     the honest outcome rather than inventing numbers.
 *   * Quote and profile fields are marked null rather than guessed.
 */

interface FixtureTranscript {
  ticker: string;
  fiscalYear: number;
  fiscalQuarter: number;
  callDate: string;
  text: string;
  source: string;
}

const transcripts = transcriptData as FixtureTranscript[];
const prices = priceData as { ticker: string; prices: { date: string; close: number }[] };

export function fixtureHasTicker(ticker: string): boolean {
  const upper = ticker.toUpperCase();
  return transcripts.some((t) => t.ticker === upper);
}

export function fixtureTickers(): string[] {
  return [...new Set(transcripts.map((t) => t.ticker))];
}

export function fixtureProfile(ticker: string): CompanyProfile | null {
  const upper = ticker.toUpperCase();
  if (!fixtureHasTicker(upper)) return null;

  const series = prices.ticker === upper ? prices.prices : [];
  const last = series.at(-1);
  const prior = series.at(-2);
  const change = last && prior ? last.close - prior.close : null;

  return {
    ticker: upper,
    companyName: 'RH',
    sector: 'Consumer Cyclical',
    industry: 'Specialty Retail',
    exchange: 'NYSE',
    price: last?.close ?? null,
    change,
    changePercent: change != null && prior ? (change / prior.close) * 100 : null,
    // Not derivable from the fixture; null renders as an em dash, not a guess.
    marketCap: null,
    currency: 'USD',
    nextEarningsDate: null,
    description: 'Offline fixture data. Configure FMP_API_KEY for live coverage.',
  };
}

export function fixtureTranscriptRefs(ticker: string): TranscriptRef[] {
  const upper = ticker.toUpperCase();
  return transcripts
    .filter((t) => t.ticker === upper)
    .map((t) => ({
      ticker: upper,
      fiscalYear: t.fiscalYear,
      fiscalQuarter: t.fiscalQuarter,
      callDate: t.callDate,
    }))
    .sort((a, b) => b.fiscalYear - a.fiscalYear || b.fiscalQuarter - a.fiscalQuarter);
}

export function fixtureTranscript(
  ticker: string,
  year: number,
  quarter: number,
): Transcript | null {
  const upper = ticker.toUpperCase();
  const found = transcripts.find(
    (t) => t.ticker === upper && t.fiscalYear === year && t.fiscalQuarter === quarter,
  );
  if (!found) return null;

  return {
    ticker: upper,
    fiscalYear: found.fiscalYear,
    fiscalQuarter: found.fiscalQuarter,
    callDate: found.callDate,
    text: found.text,
    source: found.source,
  };
}

export function fixturePrices(ticker: string): PricePoint[] {
  if (prices.ticker !== ticker.toUpperCase()) return [];
  return prices.prices.map((p) => ({
    date: p.date,
    close: p.close,
    adjClose: p.close,
  }));
}
