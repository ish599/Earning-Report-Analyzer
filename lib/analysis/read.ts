import 'server-only';
import { getCompany } from '@/lib/providers/company';
import * as store from '@/lib/db/store';
import { segmentTranscript } from '@/lib/transcript/segment';
import { buildCompanySummary } from './summary';
import { ANALYSIS_VERSION } from '@/lib/config';
import {
  AppError,
  normalizeTicker,
  quarterLabel,
  type CompanySummary,
  type EarningsCallDetail,
} from '@/lib/types';

/**
 * Read paths for the dashboard.
 *
 * These are cache-only with respect to the LLM: they surface what has already
 * been analyzed and never trigger analysis themselves. Kicking off expensive
 * work from a GET is what makes a page load unpredictable, so ingestion is
 * confined to the explicit POST /analyze route.
 */

export interface CompanyView {
  summary: CompanySummary;
  companyId: string | null;
  /** True when the ticker has never been ingested — the UI offers to analyze. */
  needsIngest: boolean;
  /** Quarters present but not yet analyzed at the current analysis version. */
  pendingQuarters: number;
}

export async function loadCompanyView(rawTicker: string): Promise<CompanyView> {
  const ticker = normalizeTicker(rawTicker);
  const company = await getCompany(ticker);
  const stored = await store.getCompanyByTicker(company.ticker);

  if (!stored) {
    return {
      summary: {
        company,
        quarters: [],
        topicTrends: [],
        whatChanged: { improving: [], deteriorating: [], newRisks: [], newPositives: [] },
        keyQuotes: [],
      },
      companyId: null,
      needsIngest: true,
      pendingQuarters: 0,
    };
  }

  const summary = await buildCompanySummary(company, stored.id);

  return {
    summary,
    companyId: stored.id,
    needsIngest: summary.quarters.length === 0,
    pendingQuarters: summary.quarters.filter((q) => !q.analyzed).length,
  };
}

export async function loadCallDetail(callId: string): Promise<EarningsCallDetail> {
  const call = await store.getCallById(callId);
  if (!call) {
    throw new AppError('company_not_found', 'That earnings call could not be found.');
  }

  const transcriptText = call.transcriptText ?? (await store.getTranscriptText(callId)) ?? '';

  const periods = new Map([
    [
      callId,
      {
        fiscalYear: call.fiscalYear,
        fiscalQuarter: call.fiscalQuarter,
        reportDate: call.callDate,
      },
    ],
  ]);

  const [analysis, financials, reactions] = await Promise.all([
    store.getAnalysis(callId, ANALYSIS_VERSION),
    store.getFinancialsForCalls([callId], periods),
    store.getPriceReactionsForCalls([callId]),
  ]);

  return {
    id: call.id,
    ticker: call.ticker,
    fiscalYear: call.fiscalYear,
    fiscalQuarter: call.fiscalQuarter,
    callDate: call.callDate,
    transcriptSource: call.transcriptSource,
    analysis,
    financials: financials.get(callId) ?? null,
    priceReaction: reactions.get(callId) ?? null,
    transcriptText,
    segments: segmentTranscript(transcriptText),
  };
}

/** Resolves a quarter label such as "Q3-2026" to its stored call. */
export async function findCallId(
  ticker: string,
  fiscalYear: number,
  fiscalQuarter: number,
): Promise<string | null> {
  const company = await store.getCompanyByTicker(normalizeTicker(ticker));
  if (!company) return null;

  const calls = await store.listCalls(company.id, company.ticker);
  return (
    calls.find((c) => c.fiscalYear === fiscalYear && c.fiscalQuarter === fiscalQuarter)?.id ?? null
  );
}

export { quarterLabel };
