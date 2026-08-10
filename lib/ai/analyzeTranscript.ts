import 'server-only';
import { completeJson, isConfigured } from './grok';
import { analysisResponseSchema, toProviderJsonSchema, type AnalysisResponse } from './schema';
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


export type { PriorQuarterContext } from './prompts';
export { toPriorContext } from './prompts';
