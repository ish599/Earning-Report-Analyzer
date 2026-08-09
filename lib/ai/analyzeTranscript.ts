import 'server-only';
import { completeJson, isConfigured } from './grok';
import { analysisResponseSchema, toProviderJsonSchema, type AnalysisResponse } from './schema';
import { SYSTEM_PROMPT, buildUserPrompt, type PriorQuarterContext } from './prompts';
import { ANALYSIS_VERSION } from '@/lib/config';
import { findQuoteOffset } from '@/lib/transcript/segment';
import {
  AppError,
  classifyScore,
  type EarningsAnalysis,
  type FiscalPeriod,
  type KeyQuote,
  type QuarterChange,
  type SegmentedTranscript,
  type SpeakerRole,
  type TopicAnalysis,
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
      'Transcript analysis is not configured. Set XAI_API_KEY to enable it.',
    );
  }

  const user = buildUserPrompt(input);
  const jsonSchema = toProviderJsonSchema();

  const { data, modelUsed } = await completeWithRetry({
    system: SYSTEM_PROMPT,
    user,
    schemaName: 'earnings_call_analysis',
    jsonSchema,
  });

  return normalize(data, modelUsed, input);
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
  schemaName: string;
  jsonSchema: Record<string, unknown>;
}): Promise<{ data: AnalysisResponse; modelUsed: string }> {
  const first = await completeJson(request);
  const parsed = analysisResponseSchema.safeParse(first.data);
  if (parsed.success) {
    return { data: parsed.data, modelUsed: first.modelUsed };
  }

  const issues = parsed.error.issues
    .slice(0, 12)
    .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');

  const retry = await completeJson({
    ...request,
    user: `${request.user}\n\n=== CORRECTION REQUIRED ===\nYour previous response failed validation:\n${issues}\n\nReturn corrected JSON that satisfies the schema exactly. Do not restate these instructions.`,
    temperature: 0,
  });

  const retried = analysisResponseSchema.safeParse(retry.data);
  if (!retried.success) {
    throw new AppError(
      'llm_invalid_response',
      'The analysis could not be validated. Please try again.',
      { cause: retried.error },
    );
  }

  return { data: retried.data, modelUsed: retry.modelUsed };
}

/**
 * Converts a validated wire response into our domain type, dropping anything
 * that cannot be substantiated against the transcript.
 */
function normalize(
  response: AnalysisResponse,
  modelUsed: string,
  input: AnalyzeTranscriptInput,
): EarningsAnalysis {
  const { transcriptText, segments } = input;

  // Speaker roles from the transcript are authoritative; the model's guess is
  // only a fallback for speakers our segmenter did not attribute.
  const rolesBySpeaker = new Map<string, SpeakerRole>();
  for (const turn of segments.turns) {
    if (turn.role !== 'unknown') rolesBySpeaker.set(turn.speaker.toLowerCase(), turn.role);
  }

  const keyQuotes: KeyQuote[] = [];
  for (const raw of response.key_quotes) {
    // The fabrication guard: a quote that is not present verbatim never
    // reaches the database or the screen.
    const charOffset = findQuoteOffset(transcriptText, raw.quote);
    if (charOffset === null) continue;

    keyQuotes.push({
      speaker: raw.speaker,
      speakerRole: rolesBySpeaker.get(raw.speaker.toLowerCase()) ?? raw.speaker_role,
      quote: raw.quote.trim(),
      topic: raw.topic,
      sentiment: raw.sentiment,
      importanceScore: raw.importance_score,
      whyItMatters: raw.why_it_matters,
      charOffset,
    });
  }

  keyQuotes.sort((a, b) => b.importanceScore - a.importanceScore);

  const changes: QuarterChange[] = response.changes_vs_prior_quarter.map(
    (c): QuarterChange => ({
      topic: c.topic,
      observation: c.observation,
      direction: c.direction,
      // Current-quarter evidence is verifiable against this transcript. Prior
      // evidence is not (we hold only excerpts), so it passes through as the
      // model supplied it and the UI attributes it to the prior call.
      evidenceCurrent:
        c.evidence_current && findQuoteOffset(transcriptText, c.evidence_current)
          ? c.evidence_current
          : null,
      evidencePrior: c.evidence_prior,
    }),
  );

  // De-duplicate topics, keeping the first occurrence.
  const seenTopics = new Set<string>();
  const topics: TopicAnalysis[] = [];
  for (const t of response.topics) {
    if (seenTopics.has(t.topic)) continue;
    seenTopics.add(t.topic);
    topics.push({
      topic: t.topic,
      sentimentScore: t.sentiment_score,
      mentionCount: t.mention_count,
      direction: t.direction,
      summary: t.summary,
    });
  }

  const overall = clamp(response.overall_sentiment);

  return {
    overallSentiment: overall,
    managementSentiment: clamp(response.management_sentiment),
    qaSentiment: clamp(response.qa_sentiment),
    managementConfidence: clamp(response.management_confidence),
    guidanceTone: clamp(response.guidance_tone),
    businessMomentum: clamp(response.business_momentum),
    // Recomputed from the score so the band and the number can never disagree
    // on screen, which would undermine trust in both.
    classification: classifyScore(overall),
    confidenceScore: clamp(response.confidence_score),
    summary: response.summary.trim(),
    topics,
    keyQuotes,
    risks: response.risks.map((r) => r.trim()).filter(Boolean),
    positives: response.positives.map((p) => p.trim()).filter(Boolean),
    changesVsPriorQuarter: changes,
    analysisVersion: ANALYSIS_VERSION,
    modelUsed,
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

export type { PriorQuarterContext } from './prompts';
export { toPriorContext } from './prompts';
