import 'server-only';
import { getCompany } from '@/lib/providers/company';
import { getTranscript, getTranscriptDates } from '@/lib/providers/transcripts';
import { getQuarterlyFinancials, getReleaseTiming } from '@/lib/providers/financials';
import { getHistoricalPrices, priceWindowFor } from '@/lib/providers/marketData';
import { segmentTranscript } from '@/lib/transcript/segment';
import { analyzeTranscript, toPriorContext } from '@/lib/ai/analyzeTranscript';
import type { PriorQuarterContext } from '@/lib/ai/prompts';
import { computePriceReaction } from './priceReaction';
import { isXaiConfigured, INITIAL_ANALYSIS_QUARTERS, QOQ_LOOKBACK_QUARTERS } from '@/lib/config';
import * as store from '@/lib/db/store';
import {
  AppError,
  compareQuartersDesc,
  quarterLabel,
  type CompanyProfile,
  type FinancialResult,
  type TranscriptRef,
} from '@/lib/types';

/**
 * Ingestion and analysis orchestration.
 *
 * Split into two phases because they have very different cost profiles:
 *
 *   `prepareCompany` — network-bound and fast. Resolves the company, stores
 *   transcripts, financials, and price reactions. Idempotent, so it is safe to
 *   call on every analyze request.
 *
 *   `analyzeNextPending` — model-bound and slow. Analyzes exactly ONE quarter
 *   per invocation, which keeps a single request comfortably inside a
 *   serverless execution limit. The client calls it repeatedly and renders
 *   progress between calls.
 *
 * Quarters are analyzed oldest first, because each one becomes the
 * prior-quarter context for the next. Parallelising would be faster but would
 * destroy the quarter-over-quarter comparison, which is the product's point.
 *
 * This module performs I/O but holds no HTTP or React concerns, so it can move
 * to a separate worker service later without touching its callers.
 */

export interface PreparedCompany {
  company: CompanyProfile;
  companyId: string;
  /** Target quarters, newest first, with the stored call id for each. */
  targets: { ref: TranscriptRef; callId: string }[];
  warnings: { period: string; message: string }[];
}

export interface PrepareOptions {
  quarters?: number;
  only?: { fiscalYear: number; fiscalQuarter: number };
}

export async function prepareCompany(
  rawTicker: string,
  options: PrepareOptions = {},
): Promise<PreparedCompany> {
  const company = await getCompany(rawTicker);
  const ticker = company.ticker;
  const companyId = await store.upsertCompany(company);

  const available = isRoicConfigured() && !options.only
    ? [await getLatestTranscriptRef(ticker)]
    : await getTranscriptDates(ticker);
  const selected = selectTargets(available, options);

  if (selected.length === 0) {
    throw new AppError(
      'transcript_unavailable',
      `No transcripts matched the requested period for ${ticker}.`,
    );
  }

  const warnings: PreparedCompany['warnings'] = [];
  const targets: PreparedCompany['targets'] = [];

  for (const ref of selected) {
    try {
      const transcript = await getTranscript(ticker, ref.fiscalYear, ref.fiscalQuarter);
      const call = await store.upsertCall({
        companyId,
        ticker,
        fiscalYear: transcript.fiscalYear,
        fiscalQuarter: transcript.fiscalQuarter,
        callDate: transcript.callDate ?? ref.callDate,
        transcriptText: transcript.text,
        transcriptSource: transcript.source,
      });
      targets.push({ ref: { ...ref, callDate: transcript.callDate ?? ref.callDate }, callId: call.id });
    } catch (error) {
      warnings.push({ period: quarterLabel(ref), message: toMessage(error) });
    }
  }

  if (targets.length === 0) {
    throw new AppError('transcript_unavailable', `No transcripts could be retrieved for ${ticker}.`);
  }

  // Supplementary data. Neither is allowed to block analysis: the UI renders
  // missing figures as em dashes rather than inventing them.
  await attachFinancials(ticker, targets).catch((error) =>
    warnings.push({ period: 'Financial results', message: toMessage(error) }),
  );
  await attachPriceReactions(ticker, targets).catch((error) =>
    warnings.push({ period: 'Price history', message: toMessage(error) }),
  );

  return { company, companyId, targets, warnings };
}

export interface AnalyzeStepResult {
  /** Quarter analyzed in this step, or null when nothing was pending. */
  analyzed: string | null;
  completed: number;
  total: number;
  done: boolean;
  error: { period: string; message: string } | null;
}

/**
 * Analyzes the oldest quarter that has no cached analysis at the current
 * version, and returns progress.
 *
 * Cached quarters are skipped but still contribute their stored analysis to
 * the context chain, which is what lets an incremental "one new quarter" run
 * be as well-informed as a full rebuild.
 */
export async function analyzeNextPending(
  prepared: PreparedCompany,
  options: { force?: boolean } = {},
): Promise<AnalyzeStepResult> {
  const { company, companyId, targets } = prepared;
  const total = targets.length;

  if (!isXaiConfigured()) {
    throw new AppError(
      'llm_not_configured',
      'Transcript analysis is not configured. Set XAI_API_KEY to enable it.',
    );
  }

  // Oldest first so prior-quarter context accumulates naturally.
  const chronological = [...targets].sort((a, b) => -compareQuartersDesc(a.ref, b.ref));
  const priorContext = await loadEarlierContext(companyId, company.ticker, chronological[0]?.ref);

  let completed = 0;

  for (const item of chronological) {
    const cached = options.force ? null : await store.getAnalysis(item.callId);

    if (cached) {
      completed += 1;
      priorContext.push(toPriorContext(item.ref, cached));
      continue;
    }

    const label = quarterLabel(item.ref);

    try {
      const text = await store.getTranscriptText(item.callId);
      if (!text) {
        throw new AppError('transcript_unavailable', `No stored transcript for ${label}.`);
      }

      const analysis = await analyzeTranscript({
        companyName: company.companyName,
        ticker: company.ticker,
        period: item.ref,
        callDate: item.ref.callDate,
        transcriptText: text,
        segments: segmentTranscript(text),
        priorQuarters: priorContext.slice(-QOQ_LOOKBACK_QUARTERS),
      });

      await store.saveAnalysis(item.callId, analysis);

      return {
        analyzed: label,
        completed: completed + 1,
        total,
        done: completed + 1 >= total,
        error: null,
      };
    } catch (error) {
      // Report the failure and mark this quarter consumed, so the client's
      // loop advances instead of retrying the same broken quarter forever.
      return {
        analyzed: null,
        completed: completed + 1,
        total,
        done: completed + 1 >= total,
        error: { period: label, message: toMessage(error) },
      };
    }
  }

  return { analyzed: null, completed, total, done: true, error: null };
}

/** Full synchronous run. Suitable for scripts, not for a serverless request. */
export async function ingestCompany(
  rawTicker: string,
  options: PrepareOptions & { force?: boolean; onProgress?: (message: string) => void } = {},
): Promise<{ prepared: PreparedCompany; analyzed: number; failures: { period: string; message: string }[] }> {
  const notify = options.onProgress ?? (() => {});

  notify('Resolving company and retrieving transcripts…');
  const prepared = await prepareCompany(rawTicker, options);

  const failures = [...prepared.warnings];
  let analyzed = 0;
  let guard = prepared.targets.length + 1;

  for (;;) {
    const step = await analyzeNextPending(prepared, { force: options.force && analyzed === 0 });
    if (step.error) failures.push(step.error);
    if (step.analyzed) {
      analyzed += 1;
      notify(`Analyzed ${step.analyzed} (${step.completed}/${step.total})`);
    }
    if (step.done) break;

    guard -= 1;
    if (guard <= 0) break;
  }

  return { prepared, analyzed, failures };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function selectTargets(available: TranscriptRef[], options: PrepareOptions): TranscriptRef[] {
  if (options.only) {
    const match = available.find(
      (r) =>
        r.fiscalYear === options.only!.fiscalYear && r.fiscalQuarter === options.only!.fiscalQuarter,
    );
    return match ? [match] : [];
  }

  const count = options.quarters ?? INITIAL_ANALYSIS_QUARTERS;
  return [...available].sort(compareQuartersDesc).slice(0, count);
}

/** Stored analyses for quarters preceding the earliest target. */
async function loadEarlierContext(
  companyId: string,
  ticker: string,
  earliest: TranscriptRef | undefined,
): Promise<PriorQuarterContext[]> {
  if (!earliest) return [];

  try {
    const calls = await store.listCalls(companyId, ticker);
    const older = calls
      .filter((c) => compareQuartersDesc(c, earliest) > 0)
      .sort(compareQuartersDesc)
      .slice(0, QOQ_LOOKBACK_QUARTERS);

    if (older.length === 0) return [];

    const analyses = await store.getAnalysesForCalls(older.map((c) => c.id));
    return older
      .reverse()
      .map((call) => {
        const analysis = analyses.get(call.id);
        return analysis ? toPriorContext(call, analysis) : null;
      })
      .filter((c): c is PriorQuarterContext => c !== null);
  } catch {
    // Context is an enhancement; proceeding without it beats failing.
    return [];
  }
}

async function attachFinancials(
  ticker: string,
  targets: { ref: TranscriptRef; callId: string }[],
): Promise<void> {
  const financials = await getQuarterlyFinancials(ticker);
  if (financials.size === 0) return;

  for (const item of targets) {
    const match: FinancialResult | undefined = financials.get(
      `${item.ref.fiscalYear}-${item.ref.fiscalQuarter}`,
    );
    if (match) await store.saveFinancials(item.callId, match);
  }
}

async function attachPriceReactions(
  ticker: string,
  targets: { ref: TranscriptRef; callId: string }[],
): Promise<void> {
  const callDates = targets
    .map((t) => t.ref.callDate)
    .filter((d): d is string => typeof d === 'string');

  const window = priceWindowFor(callDates);
  if (!window) return;

  const prices = await getHistoricalPrices(ticker, window.from, window.to);
  if (prices.length === 0) return;

  for (const item of targets) {
    if (!item.ref.callDate) continue;
    const timing = await getReleaseTiming(ticker, item.ref.callDate);
    await store.savePriceReaction(
      item.callId,
      computePriceReaction(item.ref.callDate, timing, prices),
    );
  }
}

function toMessage(error: unknown): string {
  if (error instanceof AppError) return error.userMessage;
  return 'An unexpected error occurred.';
}
