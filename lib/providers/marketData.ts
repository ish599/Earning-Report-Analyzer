import 'server-only';
import { fmpFetch, toDateString, toNumber } from './fmp/client';
import { fixturePrices } from './fixtures';
import { isFmpConfigured } from '@/lib/config';
import { normalizeTicker, type PricePoint } from '@/lib/types';

/**
 * Daily price history.
 *
 * Returned ascending by date. `adjClose` is preferred for return maths
 * because it accounts for splits and dividends; `close` is retained for
 * display of the actual traded level.
 */

interface FmpHistoricalResponse {
  symbol?: string;
  historical?: {
    date?: string;
    close?: unknown;
    adjClose?: unknown;
  }[];
}

export async function getHistoricalPrices(
  rawTicker: string,
  from?: string,
  to?: string,
): Promise<PricePoint[]> {
  const ticker = normalizeTicker(rawTicker);

  if (!isFmpConfigured()) {
    const points = fixturePrices(ticker);
    return points.filter((p) => (!from || p.date >= from) && (!to || p.date <= to));
  }

  const response = await fmpFetch<FmpHistoricalResponse>(`historical-price-full/${ticker}`, {
    query: { from, to, serietype: 'line' },
    revalidate: 60 * 60 * 12,
  });

  return (response?.historical ?? [])
    .map((row): PricePoint | null => {
      const date = toDateString(row.date);
      const close = toNumber(row.close);
      if (!date || close === null) return null;
      return {
        date,
        close,
        // Fall back to close when the provider omits an adjusted series.
        adjClose: toNumber(row.adjClose) ?? close,
      };
    })
    .filter((p): p is PricePoint => p !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Window covering the earliest call minus a small lead-in through 20 trading
 * days after the latest. Requesting only what the reactions need keeps the
 * payload small; the calendar-day padding is generous because 20 trading days
 * can span holidays.
 */
export function priceWindowFor(callDates: string[]): { from: string; to: string } | null {
  const dates = callDates.filter(Boolean).sort();
  if (dates.length === 0) return null;

  const from = shiftDays(dates[0], -10);
  const to = shiftDays(dates[dates.length - 1], 45);
  return { from, to };
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
