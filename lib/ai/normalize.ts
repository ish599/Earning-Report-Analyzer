import type { AnalysisResponse } from './schema';
import { findQuoteOffset } from '@/lib/transcript/segment';
import {
  classifyScore,
  type EarningsAnalysis,
  type KeyQuote,
  type QuarterChange,
  type SegmentedTranscript,
  type SpeakerRole,
  type TopicAnalysis,
} from '@/lib/types';

/**
 * Converts a validated model response into our domain type.
 *
 * Separated from the transport in `analyzeTranscript.ts` so it can be
 * exercised directly against real transcripts without a network call — this is
 * where the fabrication guards live, and they are the part most worth testing.
 *
 * Deliberately free of `server-only` and of any I/O.
 */
export function normalizeAnalysis(
  response: AnalysisResponse,
  context: {
    transcriptText: string;
    segments: SegmentedTranscript;
    modelUsed: string;
    analysisVersion: string;
  },
): EarningsAnalysis {
  const { transcriptText, segments, modelUsed, analysisVersion } = context;

  // Roles derived from the transcript are authoritative; the model's guess is
  // only a fallback for speakers our segmentation could not attribute.
  const rolesBySpeaker = new Map<string, SpeakerRole>();
  for (const turn of segments.turns) {
    if (turn.role !== 'unknown') rolesBySpeaker.set(turn.speaker.toLowerCase(), turn.role);
  }

  const keyQuotes: KeyQuote[] = [];
  for (const raw of response.key_quotes) {
    // The fabrication guard: a quote not present verbatim in the transcript
    // never reaches the database or the screen.
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
      // Current-quarter evidence is checkable against this transcript. Prior
      // evidence is not — we hold only excerpts of earlier calls — so it passes
      // through as supplied and the UI attributes it to the prior quarter.
      evidenceCurrent:
        c.evidence_current && findQuoteOffset(transcriptText, c.evidence_current) !== null
          ? c.evidence_current
          : null,
      evidencePrior: c.evidence_prior,
    }),
  );

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
    analysisVersion,
    modelUsed,
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}
