/**
 * Internal domain types for Earnings Intelligence.
 *
 * These are OUR types, not a data vendor's. Every provider response is
 * normalized into these shapes at the provider boundary so that swapping
 * Financial Modeling Prep for another vendor touches only `lib/providers/`.
 *
 * Nothing in this file may import a provider, the database, or the LLM.
 */

// ---------------------------------------------------------------------------
// Scores and classifications
// ---------------------------------------------------------------------------

/**
 * A research heuristic on a 0-100 scale. Not a probability, not a price
 * target, and not calibrated against realized returns. See /methodology.
 */
export type Score = number;

/** Directional read on a call's language. Never a trade recommendation. */
export type Classification =
  | 'very_bearish'
  | 'bearish'
  | 'neutral'
  | 'bullish'
  | 'very_bullish';

/** How this quarter's commentary compares with prior quarters. */
export type Signal = 'improving' | 'stable' | 'deteriorating';

/** Neutral-language alternative used in some surfaces. */
export type SignalLabel = 'positive_signal' | 'neutral_signal' | 'negative_signal';

/** Per-topic trajectory. `new` means the topic was absent in prior calls. */
export type TopicDirection = 'improving' | 'stable' | 'deteriorating' | 'new';

export type SentimentLabel = 'positive' | 'neutral' | 'negative' | 'mixed';

export const CLASSIFICATION_LABELS: Record<Classification, string> = {
  very_bearish: 'Very Bearish',
  bearish: 'Bearish',
  neutral: 'Neutral',
  bullish: 'Bullish',
  very_bullish: 'Very Bullish',
};

export const SIGNAL_LABELS: Record<Signal, string> = {
  improving: 'Improving',
  stable: 'Stable',
  deteriorating: 'Deteriorating',
};

/**
 * Maps a 0-100 overall score to a classification band.
 *
 * The bands are deliberately wide in the middle: the underlying score is not
 * precise enough to justify narrow cutoffs, and most earnings calls genuinely
 * are unremarkable in tone.
 */
export function classifyScore(score: Score): Classification {
  if (score >= 75) return 'very_bullish';
  if (score >= 60) return 'bullish';
  if (score >= 40) return 'neutral';
  if (score >= 25) return 'bearish';
  return 'very_bearish';
}

/**
 * Converts a quarter-over-quarter score delta into a momentum signal.
 *
 * The 5-point threshold is a judgment call, documented on the methodology
 * page: smaller moves are within the noise of LLM scoring variance and should
 * not be presented to an analyst as a change.
 */
export const MOMENTUM_THRESHOLD = 5;

export function momentumSignal(current: Score, prior: Score | null | undefined): Signal {
  if (prior == null) return 'stable';
  const delta = current - prior;
  if (delta >= MOMENTUM_THRESHOLD) return 'improving';
  if (delta <= -MOMENTUM_THRESHOLD) return 'deteriorating';
  return 'stable';
}

// ---------------------------------------------------------------------------
// Company
// ---------------------------------------------------------------------------

export interface Company {
  ticker: string;
  companyName: string;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
}

/** Company plus live market data. Market fields are best-effort. */
export interface CompanyProfile extends Company {
  price: number | null;
  changePercent: number | null;
  change: number | null;
  marketCap: number | null;
  currency: string | null;
  nextEarningsDate: string | null;
  description: string | null;
}

export interface TickerSearchResult {
  ticker: string;
  companyName: string;
  exchange: string | null;
}

// ---------------------------------------------------------------------------
// Transcripts
// ---------------------------------------------------------------------------

export interface FiscalPeriod {
  fiscalYear: number;
  fiscalQuarter: number;
}

/** A transcript we know exists, before we fetch its text. */
export interface TranscriptRef extends FiscalPeriod {
  ticker: string;
  callDate: string | null;
}

export interface Transcript extends TranscriptRef {
  text: string;
  source: string;
}

export type SpeakerRole = 'ceo' | 'cfo' | 'management' | 'analyst' | 'operator' | 'unknown';

export interface TranscriptTurn {
  /** Order within the full transcript, used to anchor quotes back to text. */
  index: number;
  speaker: string;
  role: SpeakerRole;
  /** Analyst's firm, when it can be parsed from the speaker line. */
  affiliation: string | null;
  text: string;
  section: TranscriptSection;
  /** Character offset of this turn's body within the raw transcript text. */
  charStart: number;
  charEnd: number;
}

export type TranscriptSection = 'prepared_remarks' | 'qa';

export interface SegmentedTranscript {
  turns: TranscriptTurn[];
  preparedRemarks: TranscriptTurn[];
  qa: TranscriptTurn[];
  /** True when the prepared-remarks/Q&A boundary was found explicitly. */
  boundaryDetected: boolean;
  /** Speaker attribution is heuristic; surfaced so the UI can caveat it. */
  speakersIdentified: number;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/**
 * Canonical financial topics the model is asked to consider.
 *
 * Not every company discusses every topic; the model returns only those the
 * transcript actually supports, and the UI renders only what is returned.
 */
export const TOPIC_KEYS = [
  'revenue_demand',
  'margins',
  'pricing',
  'guidance',
  'customer_activity',
  'bookings_backlog',
  'operating_expenses',
  'cash_flow',
  'capital_allocation',
  'competition',
  'geographic_performance',
  'product_performance',
  'management_confidence',
  'risks',
] as const;

export type TopicKey = (typeof TOPIC_KEYS)[number];

export const TOPIC_LABELS: Record<TopicKey, string> = {
  revenue_demand: 'Revenue / Demand',
  margins: 'Margins',
  pricing: 'Pricing',
  guidance: 'Guidance',
  customer_activity: 'Customer Activity',
  bookings_backlog: 'Bookings / Backlog',
  operating_expenses: 'Operating Expenses',
  cash_flow: 'Cash Flow',
  capital_allocation: 'Capital Allocation',
  competition: 'Competition',
  geographic_performance: 'Geographic Performance',
  product_performance: 'Product Performance',
  management_confidence: 'Management Confidence',
  risks: 'Risks',
};

export interface TopicAnalysis {
  topic: TopicKey;
  /** 0-100, scored within the context of this topic. */
  sentimentScore: Score;
  /** How many times the topic was raised. Counted by the model, not regex. */
  mentionCount: number;
  direction: TopicDirection;
  summary: string;
}

export interface KeyQuote {
  speaker: string;
  speakerRole: SpeakerRole;
  /** Verbatim excerpt. Verified against the transcript before persisting. */
  quote: string;
  topic: TopicKey | null;
  sentiment: SentimentLabel;
  /** 0-100. Drives ordering, not truncation. */
  importanceScore: Score;
  whyItMatters: string;
  /** Character offset in the raw transcript, for scroll-to-quote. Null if unmatched. */
  charOffset: number | null;
}

export interface QuarterChange {
  topic: TopicKey | null;
  /** e.g. "Demand commentary improved materially versus Q1." */
  observation: string;
  direction: TopicDirection;
  /** Verbatim supporting excerpt from THIS quarter's transcript. */
  evidenceCurrent: string | null;
  /** Verbatim supporting excerpt from the PRIOR quarter's transcript. */
  evidencePrior: string | null;
}

/**
 * The validated result of analyzing one earnings call.
 *
 * This is the contract between `lib/ai/` and the rest of the app. No consumer
 * should ever see a vendor-shaped response.
 */
export interface EarningsAnalysis {
  overallSentiment: Score;
  managementSentiment: Score;
  qaSentiment: Score;
  managementConfidence: Score;
  guidanceTone: Score;
  businessMomentum: Score;
  classification: Classification;
  /** Model's own confidence in the analysis, 0-100. */
  confidenceScore: Score;
  summary: string;
  topics: TopicAnalysis[];
  keyQuotes: KeyQuote[];
  risks: string[];
  positives: string[];
  changesVsPriorQuarter: QuarterChange[];
  analysisVersion: string;
  modelUsed: string;
}

// ---------------------------------------------------------------------------
// Financials and market data
// ---------------------------------------------------------------------------

export interface FinancialResult extends FiscalPeriod {
  reportDate: string | null;
  revenue: number | null;
  /** Year-over-year revenue growth, as a fraction (0.12 = +12%). */
  revenueGrowth: number | null;
  eps: number | null;
  epsEstimate: number | null;
  /** Reported EPS less consensus, in currency units. */
  epsSurprise: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  /** Forward guidance extracted from the call, when present. */
  guidance: GuidanceSnapshot | null;
}

export interface GuidanceSnapshot {
  period: string | null;
  revenueLow: number | null;
  revenueHigh: number | null;
  epsLow: number | null;
  epsHigh: number | null;
  /** Verbatim guidance language from the transcript. */
  commentary: string | null;
}

export interface PricePoint {
  date: string;
  close: number;
  adjClose: number;
}

/**
 * Return over N trading days following an earnings release.
 *
 * `timingKnown` is false when we could not determine whether the release was
 * before or after the market close. The UI must show a methodology caveat in
 * that case rather than implying the window is exact.
 */
export interface PriceReaction {
  return1d: number | null;
  return5d: number | null;
  return10d: number | null;
  return20d: number | null;
  /** Trading day treated as t=0 (the last close before the market reacts). */
  baseDate: string | null;
  basePrice: number | null;
  releaseTiming: ReleaseTiming;
  timingKnown: boolean;
}

export type ReleaseTiming = 'bmo' | 'amc' | 'unknown';

// ---------------------------------------------------------------------------
// Composed view models
// ---------------------------------------------------------------------------

/** One earnings call with everything we know about it. */
export interface EarningsCallRecord extends FiscalPeriod {
  id: string;
  ticker: string;
  callDate: string | null;
  transcriptSource: string;
  analysis: EarningsAnalysis | null;
  financials: FinancialResult | null;
  priceReaction: PriceReaction | null;
}

/** Full record including transcript text. Used by the quarter detail page. */
export interface EarningsCallDetail extends EarningsCallRecord {
  transcriptText: string;
  segments: SegmentedTranscript;
}

/** Aggregated cross-quarter view backing the Summary tab. */
export interface CompanySummary {
  company: CompanyProfile;
  quarters: QuarterSummaryRow[];
  topicTrends: TopicTrend[];
  whatChanged: WhatChanged;
  keyQuotes: (KeyQuote & { fiscalYear: number; fiscalQuarter: number; callId: string })[];
}

export interface QuarterSummaryRow extends FiscalPeriod {
  callId: string;
  callDate: string | null;
  label: string;
  overallSentiment: Score | null;
  managementSentiment: Score | null;
  qaSentiment: Score | null;
  momentum: Signal;
  classification: Classification | null;
  financials: FinancialResult | null;
  priceReaction: PriceReaction | null;
  /** False while analysis is still queued or in flight. */
  analyzed: boolean;
}

export interface TopicTrend {
  topic: TopicKey;
  points: {
    fiscalYear: number;
    fiscalQuarter: number;
    label: string;
    sentimentScore: Score;
    mentionCount: number;
    direction: TopicDirection;
  }[];
}

export interface WhatChanged {
  improving: ChangeItem[];
  deteriorating: ChangeItem[];
  newRisks: ChangeItem[];
  newPositives: ChangeItem[];
}

export interface ChangeItem {
  topic: TopicKey | null;
  label: string;
  detail: string;
  evidence: string | null;
  callId: string | null;
}

// ---------------------------------------------------------------------------
// Errors and pipeline state
// ---------------------------------------------------------------------------

export type AppErrorCode =
  | 'invalid_ticker'
  | 'company_not_found'
  | 'transcript_unavailable'
  | 'provider_rate_limit'
  | 'provider_error'
  | 'provider_not_configured'
  | 'llm_timeout'
  | 'llm_invalid_response'
  | 'llm_not_configured'
  | 'missing_financials'
  | 'missing_price_history'
  | 'database_error'
  | 'unknown';

/**
 * Error carrying a code the UI can branch on and a message safe to show a
 * user. Provider internals and keys must never reach `userMessage`.
 */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly userMessage: string;
  readonly status: number;

  constructor(
    code: AppErrorCode,
    userMessage: string,
    options?: { cause?: unknown; status?: number },
  ) {
    super(`${code}: ${userMessage}`, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
    this.status = options?.status ?? defaultStatusFor(code);
  }
}

function defaultStatusFor(code: AppErrorCode): number {
  switch (code) {
    case 'invalid_ticker':
      return 400;
    case 'company_not_found':
    case 'transcript_unavailable':
      return 404;
    case 'provider_rate_limit':
      return 429;
    case 'llm_timeout':
      return 504;
    case 'provider_not_configured':
    case 'llm_not_configured':
      return 503;
    default:
      return 500;
  }
}

export type PipelineStage =
  | 'resolving_company'
  | 'fetching_transcripts'
  | 'fetching_financials'
  | 'fetching_prices'
  | 'analyzing'
  | 'saving'
  | 'complete'
  | 'error';

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  resolving_company: 'Resolving company…',
  fetching_transcripts: 'Retrieving earnings call transcripts…',
  fetching_financials: 'Retrieving financial results…',
  fetching_prices: 'Retrieving price history…',
  analyzing: 'Analyzing latest earnings calls…',
  saving: 'Saving results…',
  complete: 'Complete',
  error: 'Something went wrong',
};

export interface PipelineProgress {
  stage: PipelineStage;
  message: string;
  completed: number;
  total: number;
  error?: { code: AppErrorCode; message: string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function quarterLabel(period: FiscalPeriod): string {
  return `Q${period.fiscalQuarter} FY${period.fiscalYear}`;
}

/** Sorts newest first. */
export function compareQuartersDesc(a: FiscalPeriod, b: FiscalPeriod): number {
  if (a.fiscalYear !== b.fiscalYear) return b.fiscalYear - a.fiscalYear;
  return b.fiscalQuarter - a.fiscalQuarter;
}

export function normalizeTicker(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * US listings are 1-5 letters, optionally with a class suffix (BRK.B) or a
 * dash form (BRK-B). Rejects anything else before it reaches a provider.
 */
const TICKER_PATTERN = /^[A-Z]{1,5}([.-][A-Z]{1,2})?$/;

export function isValidTicker(raw: string): boolean {
  return TICKER_PATTERN.test(normalizeTicker(raw));
}
