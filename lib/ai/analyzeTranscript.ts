import 'server-only';
import { completeJson, isConfigured } from './gemini';
import { analysisResponseSchema, type AnalysisResponse } from './schema';
import { SYSTEM_PROMPT, buildUserPrompt, type PriorQuarterContext } from './prompts';
import { normalizeAnalysis } from './normalize';
import { ANALYSIS_VERSION } from '@/lib/config';
import {
  AppError,
  type EarningsAnalysis,
  type FiscalPeriod,
  type SegmentedTranscript,
} from '@/lib/types';

/**
 * The application's single entry point for transcript analysis.
 *
 * Everything outside `lib/ai/` depends on this function's `EarningsAnalysis`
 * return type and nothing else. The LLM vendor, the prompt, the wire schema,
 * and the retry policy are all private to this directory.
 */

export interface AnalyzeTranscriptInput {
  companyName: string;
  ticker: string;
  period: FiscalPeriod;
  callDate: string | null;
  /** Raw transcript, used to verify quotes and compute their offsets. */
  transcriptText: string;
  segments: SegmentedTranscript;
  priorQuarters: PriorQuarterContext[];
}

export async function analyzeTranscript(
  input: AnalyzeTranscriptInput,
): Promise<EarningsAnalysis> {
  if (!isConfigured()) {
    throw new AppError(
      'llm_not_configured',
      'Transcript analysis is not configured. Set GEMINI_API_KEY to enable it.',
    );
  }

  const user = buildUserPrompt(input);

  const { data, modelUsed } = await completeWithRetry({
    system: SYSTEM_PROMPT,
    user,
  });

  return normalizeAnalysis(data, {
    transcriptText: input.transcriptText,
    segments: input.segments,
    modelUsed,
    analysisVersion: ANALYSIS_VERSION,
  });
}

/**
 * Requests a completion, retrying once when the response fails validation.
 *
 * The retry appends the validation errors so the second attempt is genuinely
 * better informed rather than a blind reroll. Only validation failures are
 * retried: a timeout or a rate limit is surfaced immediately, since retrying
 * those inside a serverless request makes the user wait twice for the same
 * outcome.
 */
async function completeWithRetry(request: {
  system: string;
  user: string;
}): Promise<{ data: AnalysisResponse; modelUsed: string }> {
  const first = await completeJson(request);
  const firstPreprocessed = preprocessAnalysis(first.data);
  const parsed = analysisResponseSchema.safeParse(firstPreprocessed);
  if (parsed.success) {
    return { data: parsed.data, modelUsed: first.modelUsed };
  }

  const issues = parsed.error.issues
    .slice(0, 12)
    .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');

  // Safe debug output: never log the transcript or API key.
  console.error('[analyzeTranscript] validation failed (attempt 1)', {
    receivedTopLevelKeys: Object.keys(asRecord(firstPreprocessed) ?? {}),
    issues: parsed.error.issues.slice(0, 12).map((i) => ({
      path: i.path.join('.'),
      code: i.code,
      message: i.message,
    })),
  });

  const retry = await completeJson({
    ...request,
    user: `${request.user}\n\n=== CORRECTION REQUIRED ===\nYour previous response failed validation:\n${issues}\n\nReturn corrected JSON that satisfies the schema exactly. Do not restate these instructions.`,
    temperature: 0,
  });

  const retriedPreprocessed = preprocessAnalysis(retry.data);
  const retried = analysisResponseSchema.safeParse(retriedPreprocessed);
  if (!retried.success) {
    // Safe debug output for the retry failure too.
    console.error('[analyzeTranscript] validation failed (attempt 2)', {
      receivedTopLevelKeys: Object.keys(asRecord(retriedPreprocessed) ?? {}),
      issues: retried.error.issues.slice(0, 12).map((i) => ({
        path: i.path.join('.'),
        code: i.code,
        message: i.message,
      })),
    });
    throw new AppError(
      'llm_invalid_response',
      'The analysis could not be validated. Please try again.',
      { cause: retried.error },
    );
  }

  return { data: retried.data, modelUsed: retry.modelUsed };
}

/**
 * Normalizes common LLM output quirks before strict validation:
 * - numeric strings → numbers
 * - missing arrays → []
 * - missing optional fields → null
 *
 * This is intentionally tolerant only where the schema already allows the
 * value; it never fabricates required analysis content.
 */
function preprocessAnalysis(raw: unknown): unknown {
  const obj = asRecord(raw);
  if (!obj) return raw;

  // Gemini may wrap the analysis inside another object (e.g. {data: {...}}
  // or {analysis: {...}}). Unwrap the first level if the wrapper contains
  // analysis-shaped keys.
  const out: Record<string, unknown> = unwrapAnalysisObject(obj);

  // Numeric score fields: accept numbers or numeric strings.
  const scoreKeys = [
    'overall_sentiment',
    'management_sentiment',
    'qa_sentiment',
    'management_confidence',
    'guidance_tone',
    'business_momentum',
    'confidence_score',
  ] as const;
  for (const key of scoreKeys) {
    const v = out[key];
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
      out[key] = Number(v);
    }
  }

  // Arrays that must exist.
  for (const key of ['topics', 'key_quotes', 'risks', 'positives', 'changes_vs_prior_quarter']) {
    if (out[key] === undefined || out[key] === null) {
      out[key] = [];
    }
  }

  // Normalize nested arrays.
  if (Array.isArray(out.topics)) {
    out.topics = out.topics
      .map((t) => {
        const topic = asRecord(t);
        if (!topic) return null;
        const normalized: Record<string, unknown> = { ...topic };
        if (typeof normalized.sentiment_score === 'string' && !Number.isNaN(Number(normalized.sentiment_score))) {
          normalized.sentiment_score = Number(normalized.sentiment_score);
        }
        if (typeof normalized.mention_count === 'string' && !Number.isNaN(Number(normalized.mention_count))) {
          normalized.mention_count = Number(normalized.mention_count);
        }
        // Drop topic entries whose topic value is not in the canonical enum.
        if (typeof normalized.topic !== 'string' || !TOPIC_KEY_SET.has(normalized.topic)) {
          return null;
        }
        return normalized;
      })
      .filter((t): t is Record<string, unknown> => t !== null);
  }

  if (Array.isArray(out.key_quotes)) {
    out.key_quotes = out.key_quotes
      .map((q) => {
        const quote = asRecord(q);
        if (!quote) return null;
        const normalized: Record<string, unknown> = { ...quote };
        if (typeof normalized.importance_score === 'string' && !Number.isNaN(Number(normalized.importance_score))) {
          normalized.importance_score = Number(normalized.importance_score);
        }
        // Drop quotes with invalid speaker_role or sentiment values.
        if (typeof normalized.speaker_role !== 'string' || !SPEAKER_ROLE_SET.has(normalized.speaker_role)) {
          normalized.speaker_role = 'unknown';
        }
        if (typeof normalized.sentiment !== 'string' || !SENTIMENT_SET.has(normalized.sentiment)) {
          return null;
        }
        // Drop quotes whose topic is not in the canonical enum or null.
        if (normalized.topic != null && (typeof normalized.topic !== 'string' || !TOPIC_KEY_SET.has(normalized.topic))) {
          return null;
        }
        return normalized;
      })
      .filter((q): q is Record<string, unknown> => q !== null);
  }

  // Risks/positives: keep only non-empty strings.
  for (const key of ['risks', 'positives']) {
    if (Array.isArray(out[key])) {
      out[key] = out[key].filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    }
  }

  // changes_vs_prior_quarter: drop entries with invalid direction enum values.
  if (Array.isArray(out.changes_vs_prior_quarter)) {
    out.changes_vs_prior_quarter = out.changes_vs_prior_quarter
      .map((c) => {
        const change = asRecord(c);
        if (!change) return null;
        if (typeof change.direction !== 'string' || !DIRECTION_SET.has(change.direction)) {
          return null;
        }
        // Normalize null/missing topic fields.
        if (change.topic === undefined) change.topic = null;
        if (change.topic != null && (typeof change.topic !== 'string' || !TOPIC_KEY_SET.has(change.topic))) {
          return null;
        }
        if (change.evidence_current === undefined) change.evidence_current = null;
        if (change.evidence_prior === undefined) change.evidence_prior = null;
        return change;
      })
      .filter((c): c is Record<string, unknown> => c !== null);
  }

  return out;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const TOPIC_KEY_SET = new Set([
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
]);

const SPEAKER_ROLE_SET = new Set(['ceo', 'cfo', 'management', 'analyst', 'operator', 'unknown']);

const SENTIMENT_SET = new Set(['positive', 'neutral', 'negative', 'mixed']);

const DIRECTION_SET = new Set(['improving', 'stable', 'deteriorating', 'new']);

/**
 * If Gemini wraps the analysis in a single-key wrapper (e.g. {data: {...}},
 * {analysis: {...}}, {result: {...}}), unwrap it when the wrapper value is an
 * object that has analysis-shaped top-level keys.
 */
const ANALYSIS_TOP_LEVEL_KEYS = new Set([
  'overall_sentiment',
  'management_sentiment',
  'qa_sentiment',
  'management_confidence',
  'guidance_tone',
  'business_momentum',
  'classification',
  'confidence_score',
  'summary',
  'topics',
  'key_quotes',
  'risks',
  'positives',
  'changes_vs_prior_quarter',
]);

function unwrapAnalysisObject(obj: Record<string, unknown>): Record<string, unknown> {
  // Already analysis-shaped at the top level.
  if (Object.keys(obj).some((k) => ANALYSIS_TOP_LEVEL_KEYS.has(k))) {
    return { ...obj };
  }

  // Single-key wrapper holding an analysis-shaped object.
  const keys = Object.keys(obj);
  if (keys.length >= 1 && keys.length <= 3) {
    for (const key of keys) {
      const nested = asRecord(obj[key]);
      if (nested && Object.keys(nested).some((k) => ANALYSIS_TOP_LEVEL_KEYS.has(k))) {
        return { ...nested };
      }
    }
  }

  return { ...obj };
}

export type { PriorQuarterContext } from './prompts';
export { toPriorContext } from './prompts';