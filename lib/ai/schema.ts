import { z } from 'zod';
import { TOPIC_KEYS } from '@/lib/types';

/**
 * Strict contract for model output.
 *
 * The model is asked to emit exactly this shape via structured output, and the
 * result is validated here before anything is stored. Malformed output is a
 * normal, expected condition — never an exception that reaches a page.
 */

const score = z
  .number()
  .min(0)
  .max(100)
  .describe('0-100 research heuristic. 50 is genuinely neutral.');

const topicEnum = z.enum(TOPIC_KEYS);

export const topicSchema = z.object({
  topic: topicEnum,
  sentiment_score: score,
  mention_count: z
    .number()
    .int()
    .min(0)
    .describe('Number of distinct times the topic was raised on the call.'),
  direction: z.enum(['improving', 'stable', 'deteriorating', 'new']),
  summary: z
    .string()
    .min(1)
    .max(600)
    .describe("What management actually said about this topic, in the analyst's own register."),
});

export const keyQuoteSchema = z.object({
  speaker: z.string().min(1).max(120),
  speaker_role: z.enum(['ceo', 'cfo', 'management', 'analyst', 'operator', 'unknown']),
  quote: z
    .string()
    .min(12)
    .max(1200)
    .describe('VERBATIM excerpt copied character-for-character from the transcript.'),
  topic: topicEnum.nullable(),
  sentiment: z.enum(['positive', 'neutral', 'negative', 'mixed']),
  importance_score: score,
  why_it_matters: z.string().min(1).max(500),
});

export const quarterChangeSchema = z.object({
  topic: topicEnum.nullable(),
  observation: z
    .string()
    .min(1)
    .max(400)
    .describe('One specific, falsifiable statement about what changed versus prior quarters.'),
  direction: z.enum(['improving', 'stable', 'deteriorating', 'new']),
  evidence_current: z
    .string()
    .max(800)
    .nullable()
    .describe('Verbatim excerpt from THIS quarter supporting the observation.'),
  evidence_prior: z
    .string()
    .max(800)
    .nullable()
    .describe('Verbatim excerpt from a PRIOR quarter, drawn only from the supplied context.'),
});

export const analysisResponseSchema = z.object({
  overall_sentiment: score,
  management_sentiment: score,
  qa_sentiment: score,
  management_confidence: score,
  guidance_tone: score,
  business_momentum: score,
  classification: z.enum(['very_bearish', 'bearish', 'neutral', 'bullish', 'very_bullish']),
  confidence_score: score.describe('How well-supported this analysis is by the transcript.'),
  summary: z.string().min(1).max(2000),
  topics: z.array(topicSchema).max(14),
  key_quotes: z.array(keyQuoteSchema).max(12),
  risks: z.array(z.string().min(1).max(300)).max(10),
  positives: z.array(z.string().min(1).max(300)).max(10),
  changes_vs_prior_quarter: z.array(quarterChangeSchema).max(12),
});

export type AnalysisResponse = z.infer<typeof analysisResponseSchema>;

/**
 * JSON Schema handed to the provider for structured output.
 *
 * Derived from the zod schema so the two cannot drift. xAI's strict mode
 * rejects schemas that omit `additionalProperties: false` or that leave any
 * property optional, both of which zod's conversion already satisfies here
 * because every field above is required.
 */
export function toProviderJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(analysisResponseSchema, { target: 'draft-7' }) as Record<string, unknown>;
}
