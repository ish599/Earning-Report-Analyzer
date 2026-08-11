import 'server-only';
import { fmpFetch, toDateString, toNumber } from './fmp/client';
import { fixtureHasTicker, fixtureProfile, fixtureTickers } from './fixtures';
import { isFmpConfigured } from '@/lib/config';
import {
  AppError,
  isValidTicker,
  normalizeTicker,
  type CompanyProfile,
  type TickerSearchResult,
} from '@/lib/types';

/**
 * Company resolution and search.
 *
 * Falls back to the offline fixture set when FMP is not configured so that the
 * product remains navigable without credentials.
 */

interface FmpProfile {
  symbol?: string;
  companyName?: string;
  sector?: string;
  industry?: string;
  exchangeShortName?: string;
  exchange?: string;
  price?: unknown;
  changes?: unknown;
  mktCap?: unknown;
  currency?: string;
  description?: string;
}

interface FmpQuote {
  symbol?: string;
  price?: unknown;
  change?: unknown;
  changesPercentage?: unknown;
  marketCap?: unknown;
  earningsAnnouncement?: string;
}

interface FmpSearchHit {
  symbol?: string;
  name?: string;
  exchangeShortName?: string;
  stockExchange?: string;
}

export async function getCompany(rawTicker: string): Promise<CompanyProfile> {
  const ticker = normalizeTicker(rawTicker);

  if (!isValidTicker(ticker)) {
    throw new AppError(
      'invalid_ticker',
      `"${rawTicker}" is not a valid ticker symbol. Enter a US listing such as AAPL or NET.`,
    );
  }

  if (!isFmpConfigured()) {
    const fixture = fixtureProfile(ticker);
    if (fixture) return fixture;
    throw new AppError(
      'provider_not_configured',
      `Market data is not configured, so only ${fixtureTickers().join(', ')} is available offline.`,
    );
  }

  const [profiles, quotes] = await Promise.all([
    fmpFetch<FmpProfile[]>('profile', {
      version: 'stable',
      query: { symbol: ticker },
      revalidate: 60 * 60 * 24,
    }),
    // Quotes move intraday; a short window keeps the header current without
    // hammering the provider on every render.
    fmpFetch<FmpQuote[]>('quote', {
      version: 'stable',
      query: { symbol: ticker },
      revalidate: 60,
    }).catch(() => [] as FmpQuote[]),
  ]);

  const profile = profiles?.[0];
  if (!profile?.symbol) {
    throw new AppError('company_not_found', `No company found for "${ticker}".`);
  }

  const quote = quotes?.[0];

  return {
    ticker: profile.symbol.toUpperCase(),
    companyName: profile.companyName ?? profile.symbol.toUpperCase(),
    sector: profile.sector || null,
    industry: profile.industry || null,
    exchange: profile.exchangeShortName || profile.exchange || null,
    price: toNumber(quote?.price ?? profile.price),
    change: toNumber(quote?.change ?? profile.changes),
    changePercent: toNumber(quote?.changesPercentage),
    marketCap: toNumber(quote?.marketCap ?? profile.mktCap),
    currency: profile.currency ?? 'USD',
    nextEarningsDate: toDateString(quote?.earningsAnnouncement),
    description: profile.description ?? null,
  };
}

/** Autocomplete for the search bar. Never throws; an empty list is a valid answer. */
export async function searchTickers(query: string): Promise<TickerSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  if (!isFmpConfigured()) {
    return fixtureTickers()
      .filter((t) => t.startsWith(normalizeTicker(trimmed)))
      .map((t) => ({ ticker: t, companyName: 'RH', exchange: 'NYSE' }));
  }

  try {
    const hits = await fmpFetch<FmpSearchHit[]>('search-ticker', {
      query: { query: trimmed, limit: 8, exchange: '' },
      revalidate: 60 * 60 * 24,
    });

    return (hits ?? [])
      .filter((h) => h.symbol && h.name)
      .map((h) => ({
        ticker: h.symbol!.toUpperCase(),
        companyName: h.name!,
        exchange: h.exchangeShortName || h.stockExchange || null,
      }));
  } catch {
    // Autocomplete is a convenience. A provider hiccup must not block a user
    // who already knows the ticker they want.
    return [];
  }
}

export function isFixtureOnly(ticker: string): boolean {
  return !isFmpConfigured() && fixtureHasTicker(ticker);
}
