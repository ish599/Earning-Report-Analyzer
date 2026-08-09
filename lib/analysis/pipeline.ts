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
  type EarningsAnalysis,
  type FinancialResult,
  type TranscriptRef,
} from '@/lib/types';

/**
 * Ingestion and analysis orchestration.
 *
 * Ordering matters and is deliberate:
 *
 *   1. Resolve the company and the list of available calls.
 *   2. Persist transcripts and market data — cheap, and useful even if the
 *      analysis step later fails.
 *   3. Analyze ONLY quarters with no cached analysis at the current version.
 *   4. Analyze oldest-to-newest, because each quarter's analysis becomes the
 *      prior-quarter context for the next one. Running these in parallel would
 *      be faster but would destroy the quarter-over-quarter comparison, which
 *      is the product's core feature.
 *
 * This module performs I/O but holds no HTTP or React concerns, so it can move
 * to a separate worker service later without touching its callers.
 */

export interface IngestResult {
  company: CompanyProfile;
  companyId: string;
  analyzed: number;
  skipped: number;
  failures: { period: string; message: string }[];
}

export interface IngestOptions {
  /** How many of the most recent quarters to analyze. */
  quarters?: number;
  /** Analyze one specific quarter instead of the recent window. */
  only?: { fiscalYear: number; fiscalQuarter: number };
  /** Re-run analysis even when a cached result exists. */
  force?: boolean;
  onProgress?: (message: string) => void;
}

export async function ingestCompany(
  rawTicker: string,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const notify = options.onProgress ?? (() => {});

  notify('Resolving company…');
  const company = await getCompany(rawTicker);
  const ticker = company.ticker;
  const companyId = await store.upsertCompany(company);

  notify('Retrieving earnings call transcripts…');
  const available = await getTranscriptDates(ticker);

  const targets = selectTargets(available, options);
  if (targets.length === 0) {
    throw new AppError(
      'transcript_unavailable',
      `No transcripts matched the requested period for ${ticker}.`,
    );
  }

  // Store transcripts before anything expensive runs, so a later failure still
  // leaves the app with something to display.
  const stored: { ref: TranscriptRef; callId: string; text: string }[] = [];
  const failures: IngestResult['failures'] = [];

  for (const ref of [...targets].sort((a, b) => -compareQuartersDesc(a, b))) {
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
      stored.push({ ref, callId: call.id, text: transcript.text });
    } catch (error) {
      failures.push({ period: quarterLabel(ref), message: toMessage(error) });
    }
  }

  if (stored.length === 0) {
    throw new AppError(
      'transcript_unavailable',
      `No transcripts could be retrieved for ${ticker}.`,
    );
  }

  notify('Retrieving financial results…');
  await attachFinancials(ticker, stored).catch((error) => {
    // Financials are supplementary. Their absence must not block the analysis,
    // and the UI already renders missing figures as em dashes.
    failures.push({ period: 'financials', message: toMessage(error) });
  });

  notify('Retrieving price history…');
  await attachPriceReactions(ticker, stored).catch((error) => {
    failures.push({ period: 'price history', message: toMessage(error) });
  });

  notify('Analyzing latest earnings calls…');
  const { analyzed, skipped, analysisFailures } = await analyzeSequentially(
    company,
    companyId,
    stored,
    options,
    notify,
  );

  return {
    company,
    companyId,
    analyzed,
    skipped,
    failures: [...failures, ...analysisFailures],
  };
}

function selectTargets(available: TranscriptRef[], options: IngestOptions): TranscriptRef[] {
  if (options.only) {
    const match = available.find(
      (r) =>
        r.fiscalYear === options.only!.fiscalYear &&
        r.fiscalQuarter === options.only!.fiscalQuarter,
    );
    return match ? [match] : [];
  }

  const count = options.quarters ?? INITIAL_ANALYSIS_QUARTERS;
  return [...available].sort(compareQuartersDesc).slice(0, count);
}

/**
 * Analyzes quarters oldest first so each call can see the preceding one.
 *
 * Cached quarters are not re-analyzed, but they still contribute their stored
 * analysis to the context chain — that is what makes an incremental "one new
 * quarter" run as informative as a full rebuild.
 */
async function analyzeSequentially(
  company: CompanyProfile,
  companyId: string,
  stored: { ref: TranscriptRef; callId: string; text: string }[],
  options: IngestOptions,
  notify: (message: string) => void,
): Promise<{ analyzed: number; skipped: number; analysisFailures: IngestResult['failures'] }> {
  const analysisFailures: IngestResult['failures'] = [];
  let analyzed = 0;
  let skipped = 0;

  if (!isXaiConfigured()) {
    return {
      analyzed: 0,
      skipped: stored.length,
      analysisFailures: [
        {
          period: 'analysis',
          message: 'Transcript analysis is not configured. Set XAI_API_KEY to enable it.',
        },
      ],
    };
  }

  const chronological = [...stored].sort((a, b) => -compareQuartersDesc(a.ref, b.ref));
  const priorContext: PriorQuarterContext[] = await loadEarlierContext(
    companyId,
    company.ticker,
    chronological[0]?.ref,
  );

  for (const item of chronological) {
    const label = quarterLabel(item.ref);

    if (!options.force) {
      const cached = await store.getAnalysis(item.callId);
      if (cached) {
        skipped += 1;
        priorContext.push(toPriorContext(item.ref, cached));
        continue;
      }
    }

    notify(`Analyzing ${label}…`);

    try {
      const analysis = await analyzeTranscript({
        companyName: company.companyName,
        ticker: company.ticker,
        period: item.ref,
        callDate: item.ref.callDate,
        transcriptText: item.text,
        segments: segmentTranscript(item.text),
        priorQuarters: priorContext.slice(-QOQ_LOOKBACK_QUARTERS),
      });

      await store.saveAnalysis(item.callId, analysis);
      priorContext.push(toPriorContext(item.ref, analysis));
      analyzed += 1;
    } catch (error) {
      // One bad quarter must not abort the run; later quarters simply lose one
      // step of prior context.
      analysisFailures.push({ period: label, message: toMessage(error) });
    }
  }

  return { analyzed, skipped, analysisFailures };
}

/** Pulls already-stored analyses for quarters preceding the earliest target. */
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
    // Context is an enhancement; proceeding without it is better than failing.
    return [];
  }
}

// ---------------------------------------------------------------------------
// Supplementary data
// ---------------------------------------------------------------------------

async function attachFinancials(
  ticker: string,
  stored: { ref: TranscriptRef; callId: string }[],
): Promise<void> {
  const financials = await getQuarterlyFinancials(ticker);
  if (financials.size === 0) return;

  for (const item of stored) {
    const match: FinancialResult | undefined = financials.get(
      `${item.ref.fiscalYear}-${item.ref.fiscalQuarter}`,
    );
    if (match) await store.saveFinancials(item.callId, match);
  }
}

async function attachPriceReactions(
  ticker: string,
  stored: { ref: TranscriptRef; callId: string }[],
): Promise<void> {
  const callDates = stored
    .map((s) => s.ref.callDate)
    .filter((d): d is string => typeof d === 'string');

  const window = priceWindowFor(callDates);
  if (!window) return;

  const prices = await getHistoricalPrices(ticker, window.from, window.to);
  if (prices.length === 0) return;

  for (const item of stored) {
    if (!item.ref.callDate) continue;
    const timing = await getReleaseTiming(ticker, item.ref.callDate);
    const reaction = computePriceReaction(item.ref.callDate, timing, prices);
    await store.savePriceReaction(item.callId, reaction);
  }
}

function toMessage(error: unknown): string {
  if (error instanceof AppError) return error.userMessage;
  return 'An unexpected error occurred.';
}

export type { EarningsAnalysis };
