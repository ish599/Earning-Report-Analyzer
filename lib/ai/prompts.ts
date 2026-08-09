import { TOPIC_KEYS, TOPIC_LABELS, quarterLabel } from '@/lib/types';
import type { EarningsAnalysis, FiscalPeriod, SegmentedTranscript } from '@/lib/types';

/**
 * Prompt construction for earnings-call analysis.
 *
 * The analytical stance lives here. Two commitments shape it:
 *
 *   1. Financial language is contextual. "Lower expenses" is favourable;
 *      "lower revenue" is not. Keyword polarity is actively wrong on earnings
 *      calls, so the model is instructed to reason about meaning, not tone
 *      words.
 *
 *   2. Every claim must be anchored to text. Quotes are verified against the
 *      transcript after the fact, and unverifiable ones are discarded — the
 *      prompt says so explicitly, because a model told its output will be
 *      checked fabricates markedly less.
 */

export interface PriorQuarterContext extends FiscalPeriod {
  label: string;
  summary: string;
  overallSentiment: number;
  managementSentiment: number;
  qaSentiment: number;
  guidanceTone: number;
  businessMomentum: number;
  topics: { topic: string; sentimentScore: number; mentionCount: number; summary: string }[];
  notableQuotes: string[];
}

export const SYSTEM_PROMPT = `You are a senior equity research analyst at an institutional asset manager. You analyze earnings call transcripts to answer one question: what changed in management's language, outlook, and business commentary this quarter versus prior quarters?

You are NOT forecasting the stock price. You never issue buy, sell, or hold recommendations, and you never claim that call sentiment predicts returns. Your output is research input for a human analyst.

HOW TO SCORE

All scores are 0-100 where 50 is genuinely neutral. Use the full range, but do not inflate: a routine quarter with no meaningful change is a 45-55 quarter. Reserve scores above 75 or below 25 for calls where the language is unmistakably and materially different from a normal quarter.

Score the SUBSTANCE of what management said, not the enthusiasm with which they said it. Executives are professionally optimistic; a confident delivery of deteriorating fundamentals is not a bullish call.

Financial language is contextual. Judge meaning, never keyword polarity:
- "Lower expenses" or "reduced costs" is typically favourable.
- "Lower revenue" or "reduced demand" is typically unfavourable.
- "Challenging comparison" signals a tough prior-year base, which is a caution about optics rather than a deterioration in the business.
- "We remain confident" expresses management conviction. It is evidence about tone, not evidence about fundamentals, and must not by itself lift the business momentum score.
- Hedging that newly appears ("we're monitoring", "assuming no further deterioration", "prudent", "measured") is meaningful even when the surrounding numbers are fine.
- Withdrawn, widened, or newly caveated guidance is a substantive negative even when framed positively.

THE SIX SCORES

overall_sentiment      Holistic read of the call as an information event.
management_sentiment   Tone and substance of PREPARED REMARKS only.
qa_sentiment           Tone and substance of the Q&A ONLY, weighing how directly and completely management answered. Evasion, deflection to a later date, and repeated non-answers lower this score even when the words are positive.
management_confidence  Conviction and specificity. Concrete figures, named timelines, and willingness to commit raise it; vagueness and deferral lower it.
guidance_tone          Forward-looking commentary specifically. If the company gave no guidance, score 50 and say so in the summary.
business_momentum      Direction of the underlying business as described: demand, bookings, pricing, and margin trajectory. This is about the business, not the narrative.

TOPICS

Consider only these topic keys: ${TOPIC_KEYS.join(', ')}.

Return a topic ONLY if the transcript genuinely supports it. Most calls touch six to ten. Never pad the list — an absent topic is a finding in itself, especially when management discussed it last quarter and has stopped.

QUOTES

Return 5-10 key quotes. Each quote MUST be copied verbatim from the transcript, character for character, with no paraphrase, no ellipsis, no correction of grammar, and no stitching together of separate passages. Every quote is programmatically checked against the transcript and silently discarded if it does not match exactly, so an invented or lightly edited quote is worse than no quote at all. Prefer excerpts of one to three sentences that a portfolio manager would want to read.

"why_it_matters" must explain the significance to an investor — ideally by reference to how it differs from prior commentary — not restate the quote.

CHANGES VERSUS PRIOR QUARTERS

This is the most valuable part of your output. Be specific and falsifiable:
  Good: "Management moved from 'demand stabilized' to 'demand improved across all regions', and named Europe specifically for the first time."
  Bad:  "Management sounded more positive."

Look for: new positive themes; new risks; topics management has stopped discussing; increasing or decreasing caution; changes in guidance, demand, pricing, and margin language; and shifts in how directly they answer analysts.

Draw "evidence_prior" ONLY from the prior-quarter context supplied to you. If no prior context is supplied, return an empty changes_vs_prior_quarter array rather than speculating about prior quarters.

INTEGRITY

Never invent a quote, a figure, a guidance range, or a speaker. If the transcript does not support a claim, omit the claim. An empty array is always an acceptable answer.`;

/** Caps prompt size while preserving both ends of a section, where the substance sits. */
function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.65);
  const tail = maxChars - head;
  return `${text.slice(0, head)}\n\n[... ${text.length - maxChars} characters omitted from the middle of this section ...]\n\n${text.slice(-tail)}`;
}

function renderTurns(
  turns: SegmentedTranscript['turns'],
  budget: number,
): string {
  const rendered = turns
    .map((t) => {
      const who = t.affiliation ? `${t.speaker} (${t.role.toUpperCase()}, ${t.affiliation})` : `${t.speaker} (${t.role.toUpperCase()})`;
      return `${who}:\n${t.text}`;
    })
    .join('\n\n');
  return clip(rendered, budget);
}

export interface BuildPromptInput {
  companyName: string;
  ticker: string;
  period: FiscalPeriod;
  callDate: string | null;
  segments: SegmentedTranscript;
  priorQuarters: PriorQuarterContext[];
  /** Total transcript characters to include across both sections. */
  charBudget?: number;
}

const DEFAULT_CHAR_BUDGET = 180_000;

export function buildUserPrompt(input: BuildPromptInput): string {
  const { companyName, ticker, period, callDate, segments, priorQuarters } = input;
  const budget = input.charBudget ?? DEFAULT_CHAR_BUDGET;

  // Q&A gets a slightly larger share: it is less rehearsed and carries more of
  // the quarter-over-quarter signal than prepared remarks.
  const preparedBudget = Math.floor(budget * 0.45);
  const qaBudget = budget - preparedBudget;

  const parts: string[] = [];

  parts.push(
    `COMPANY: ${companyName} (${ticker})`,
    `PERIOD: ${quarterLabel(period)}`,
    `CALL DATE: ${callDate ?? 'not reported'}`,
  );

  if (!segments.boundaryDetected) {
    parts.push(
      'NOTE: The prepared-remarks/Q&A boundary could not be identified in this transcript. Treat the whole transcript as prepared remarks and set qa_sentiment equal to management_sentiment.',
    );
  }

  if (priorQuarters.length > 0) {
    parts.push('\n=== PRIOR QUARTER CONTEXT (for comparison) ===');
    for (const prior of priorQuarters) {
      const topics = prior.topics
        .map((t) => `    - ${TOPIC_LABELS[t.topic as keyof typeof TOPIC_LABELS] ?? t.topic}: score ${t.sentimentScore}, ${t.mentionCount} mentions — ${t.summary}`)
        .join('\n');
      const quotes = prior.notableQuotes.map((q) => `    "${q}"`).join('\n');

      parts.push(
        `\n${prior.label}`,
        `  Scores — overall ${prior.overallSentiment}, management ${prior.managementSentiment}, Q&A ${prior.qaSentiment}, guidance ${prior.guidanceTone}, momentum ${prior.businessMomentum}`,
        `  Summary: ${prior.summary}`,
        topics ? `  Topics:\n${topics}` : '  Topics: none recorded',
        quotes ? `  Quotes from that call (the ONLY permissible source for evidence_prior):\n${quotes}` : '',
      );
    }
  } else {
    parts.push(
      '\n=== PRIOR QUARTER CONTEXT ===',
      'None available. This is the earliest call analyzed for this company, so return an empty changes_vs_prior_quarter array.',
    );
  }

  parts.push(
    `\n=== ${quarterLabel(period)} PREPARED REMARKS ===`,
    segments.preparedRemarks.length > 0
      ? renderTurns(segments.preparedRemarks, preparedBudget)
      : '(No prepared remarks section was identified.)',
  );

  parts.push(
    `\n=== ${quarterLabel(period)} ANALYST Q&A ===`,
    segments.qa.length > 0
      ? renderTurns(segments.qa, qaBudget)
      : '(No Q&A section was identified.)',
  );

  parts.push(
    '\n=== TASK ===',
    `Analyze this call and return JSON matching the required schema. Every quote must appear verbatim in the transcript above. Ground the changes_vs_prior_quarter entries in specific language differences, not general impressions.`,
  );

  return parts.filter(Boolean).join('\n');
}

/** Condenses a stored analysis into the context passed forward to later quarters. */
export function toPriorContext(
  period: FiscalPeriod,
  analysis: EarningsAnalysis,
): PriorQuarterContext {
  return {
    fiscalYear: period.fiscalYear,
    fiscalQuarter: period.fiscalQuarter,
    label: quarterLabel(period),
    summary: analysis.summary,
    overallSentiment: analysis.overallSentiment,
    managementSentiment: analysis.managementSentiment,
    qaSentiment: analysis.qaSentiment,
    guidanceTone: analysis.guidanceTone,
    businessMomentum: analysis.businessMomentum,
    topics: analysis.topics.map((t) => ({
      topic: t.topic,
      sentimentScore: t.sentimentScore,
      mentionCount: t.mentionCount,
      summary: t.summary,
    })),
    // Only the highest-signal quotes travel forward, to keep prior context
    // from crowding out the transcript itself.
    notableQuotes: analysis.keyQuotes
      .slice()
      .sort((a, b) => b.importanceScore - a.importanceScore)
      .slice(0, 5)
      .map((q) => q.quote),
  };
}
