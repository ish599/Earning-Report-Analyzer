import 'server-only';
import { fmpFetch, toDateString, toNumber } from './fmp/client';
import { isFmpConfigured } from '@/lib/config';
import { normalizeTicker, type FinancialResult, type ReleaseTiming } from '@/lib/types';

/**
 * Quarterly financial results and earnings surprises.
 *
 * Every field is nullable by design. When the provider does not supply a
 * figure we return null and the UI renders an em dash — we never interpolate,
 * carry forward, or estimate a financial number.
 */

interface FmpIncomeStatement {
  date?: string;
  period?: string;
  calendarYear?: string | number;
  revenue?: unknown;
  grossProfit?: unknown;
  operatingIncome?: unknown;
  eps?: unknown;
  epsdiluted?: unknown;
}

interface FmpEarningsRow {
  date?: string;
  symbol?: string;
  eps?: unknown;
  epsEstimated?: unknown;
  revenue?: unknown;
  revenueEstimated?: unknown;
  fiscalDateEnding?: string;
  time?: string;
}

/** Quarter number parsed from FMP's "Q1".."Q4" period field. */
function parseQuarter(period: unknown): number | null {
  if (typeof period !== 'string') return null;
  const match = /^Q([1-4])$/.exec(period.trim());
  return match ? Number(match[1]) : null;
}

/**
 * Quarterly financials keyed by `FY-Q`.
 *
 * Uses `calendarYear` + `period` from the income statement, which is FMP's
 * fiscal labelling and therefore aligns with its transcript labelling. Mixing
 * the two would misalign quarters for companies with off-calendar fiscal years
 * such as RH.
 */
export async function getQuarterlyFinancials(
  rawTicker: string,
  limit = 12,
): Promise<Map<string, FinancialResult>> {
  const ticker = normalizeTicker(rawTicker);
  const out = new Map<string, FinancialResult>();

  if (!isFmpConfigured()) return out;

  const [statements, earnings] = await Promise.all([
    fmpFetch<FmpIncomeStatement[]>('income-statement', {
      version: 'stable',
      query: { symbol: ticker, period: 'quarter', limit },
      revalidate: 60 * 60 * 12,
    }).catch(() => [] as FmpIncomeStatement[]),
    getEarningsData(ticker).catch(() => [] as NormalizedEarnings[]),
  ]);

  const rows = (statements ?? [])
    .map((s) => {
      const quarter = parseQuarter(s.period);
      const year = Number(s.calendarYear);
      if (quarter === null || !Number.isFinite(year)) return null;
      return { statement: s, year, quarter };
    })
    .filter((r): r is { statement: FmpIncomeStatement; year: number; quarter: number } => r !== null);

  for (const { statement, year, quarter } of rows) {
    const revenue = toNumber(statement.revenue);
    const grossProfit = toNumber(statement.grossProfit);
    const operatingIncome = toNumber(statement.operatingIncome);

    // Year-ago comparison for YoY growth: same fiscal quarter, prior year.
    const priorYear = rows.find((r) => r.year === year - 1 && r.quarter === quarter);
    const priorRevenue = priorYear ? toNumber(priorYear.statement.revenue) : null;

    const reportDate = toDateString(statement.date);
    const surprise = earnings.find((e) => e.fiscalYear === year && e.fiscalQuarter === quarter);

    const eps = toNumber(statement.epsdiluted ?? statement.eps) ?? surprise?.eps ?? null;
    const epsEstimate = surprise?.epsEstimate ?? null;

    out.set(`${year}-${quarter}`, {
      fiscalYear: year,
      fiscalQuarter: quarter,
      reportDate: surprise?.reportDate ?? reportDate,
      revenue,
      revenueGrowth:
        revenue != null && priorRevenue != null && priorRevenue !== 0
          ? (revenue - priorRevenue) / Math.abs(priorRevenue)
          : null,
      eps,
      epsEstimate,
      epsSurprise: eps != null && epsEstimate != null ? eps - epsEstimate : null,
      grossMargin: revenue != null && revenue !== 0 && grossProfit != null ? grossProfit / revenue : null,
      operatingMargin:
        revenue != null && revenue !== 0 && operatingIncome != null ? operatingIncome / revenue : null,
      // Guidance is not a reported statement line. It is extracted from the
      // transcript by the analysis layer and merged in later.
      guidance: null,
    });
  }

  return out;
}

export interface NormalizedEarnings {
  fiscalYear: number;
  fiscalQuarter: number;
  reportDate: string | null;
  eps: number | null;
  epsEstimate: number | null;
  revenue: number | null;
  revenueEstimate: number | null;
  /** Release timing drives which trading day counts as t=0 for price reaction. */
  releaseTiming: ReleaseTiming;
}

/**
 * Historical earnings calendar: actual vs consensus EPS, and crucially the
 * before-market / after-market release flag used by the price reaction math.
 */
export async function getEarningsData(rawTicker: string): Promise<NormalizedEarnings[]> {
  const ticker = normalizeTicker(rawTicker);
  if (!isFmpConfigured()) return [];

  const rows = await fmpFetch<FmpEarningsRow[]>('historical/earning_calendar', {
    version: 'stable',
    query: { symbol: ticker },
    revalidate: 60 * 60 * 12,
  });

  return (rows ?? [])
    .map((row): NormalizedEarnings | null => {
      const reportDate = toDateString(row.date);
      if (!reportDate) return null;

      // FMP dates the row by announcement day and labels the fiscal period
      // only via fiscalDateEnding, so derive the quarter from that when
      // present and fall back to the announcement date otherwise.
      const periodEnd = toDateString(row.fiscalDateEnding) ?? reportDate;
      const { fiscalYear, fiscalQuarter } = calendarQuarterOf(periodEnd);

      return {
        fiscalYear,
        fiscalQuarter,
        reportDate,
        eps: toNumber(row.eps),
        epsEstimate: toNumber(row.epsEstimated),
        revenue: toNumber(row.revenue),
        revenueEstimate: toNumber(row.revenueEstimated),
        releaseTiming: normalizeTiming(row.time),
      };
    })
    .filter((r): r is NormalizedEarnings => r !== null);
}

function calendarQuarterOf(date: string): { fiscalYear: number; fiscalQuarter: number } {
  const [year, month] = date.split('-').map(Number);
  return { fiscalYear: year, fiscalQuarter: Math.floor((month - 1) / 3) + 1 };
}

function normalizeTiming(value: unknown): ReleaseTiming {
  if (typeof value !== 'string') return 'unknown';
  const t = value.trim().toLowerCase();
  if (t === 'bmo' || t === 'before market open') return 'bmo';
  if (t === 'amc' || t === 'after market close') return 'amc';
  return 'unknown';
}

/**
 * Release timing for a specific call date.
 *
 * Returns 'unknown' rather than assuming a default. The price reaction display
 * degrades to a methodology note in that case instead of implying precision we
 * do not have.
 */
export async function getReleaseTiming(
  rawTicker: string,
  callDate: string,
): Promise<ReleaseTiming> {
  try {
    const earnings = await getEarningsData(rawTicker);
    return earnings.find((e) => e.reportDate === callDate)?.releaseTiming ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
