/**
 * Development check for the analysis chain, minus the network call.
 *
 * Exercises the parts that decide whether the product is trustworthy —
 * schema validation, the quote fabrication guard, score normalization, prompt
 * assembly, and the trading-day price reaction — against the real RH fixtures.
 *
 * Usage: npx tsx scripts/check-pipeline.ts
 */

import transcripts from '../lib/providers/fixtures/data/transcripts.json';
import priceData from '../lib/providers/fixtures/data/prices.json';
import { segmentTranscript } from '../lib/transcript/segment';
import { analysisResponseSchema } from '../lib/ai/schema';
import { normalizeAnalysis } from '../lib/ai/normalize';
import { buildUserPrompt, toPriorContext } from '../lib/ai/prompts';
import { computePriceReaction } from '../lib/analysis/priceReaction';
import { classifyScore, momentumSignal, type PricePoint } from '../lib/types';

let failures = 0;

function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const fixture = transcripts.find((t) => t.fiscalQuarter === 3 && t.fiscalYear === 2026)!;
const prior = transcripts.find((t) => t.fiscalQuarter === 2 && t.fiscalYear === 2026)!;
const segments = segmentTranscript(fixture.text);

// ---------------------------------------------------------------------------
console.log('\nSchema validation');
// ---------------------------------------------------------------------------

// Two genuine excerpts lifted straight from the transcript, plus one that is
// plausible but never said — the case the guard exists for.
const realQuoteA = segments.turns.find((t) => t.role === 'ceo' && t.text.length > 400)!
  .text.slice(50, 260);
const realQuoteB = segments.qa.find((t) => t.role === 'cfo' && t.text.length > 300)!
  .text.slice(20, 200);
const fabricated =
  'We expect demand to accelerate meaningfully across every geography in the coming year.';

const modelResponse = {
  overall_sentiment: 58.44,
  management_sentiment: 62,
  qa_sentiment: 51,
  management_confidence: 70,
  guidance_tone: 48,
  business_momentum: 55,
  classification: 'bearish' as const, // deliberately inconsistent with the score
  confidence_score: 72,
  summary: 'Management emphasized product transformation against a weak housing backdrop.',
  topics: [
    { topic: 'revenue_demand' as const, sentiment_score: 55, mention_count: 12, direction: 'improving' as const, summary: 'Demand commentary firmer than prior quarter.' },
    { topic: 'margins' as const, sentiment_score: 44, mention_count: 8, direction: 'deteriorating' as const, summary: 'Tariff pressure on gross margin.' },
    // Duplicate topic: must be collapsed, not double-counted.
    { topic: 'margins' as const, sentiment_score: 90, mention_count: 99, direction: 'improving' as const, summary: 'Duplicate that should be dropped.' },
  ],
  key_quotes: [
    { speaker: 'Gary G. Friedman', speaker_role: 'analyst' as const, quote: realQuoteA, topic: 'revenue_demand' as const, sentiment: 'positive' as const, importance_score: 80, why_it_matters: 'Sets the tone for the quarter.' },
    { speaker: 'Jack M. Preston', speaker_role: 'cfo' as const, quote: realQuoteB, topic: 'margins' as const, sentiment: 'mixed' as const, importance_score: 90, why_it_matters: 'Quantifies the margin pressure.' },
    { speaker: 'Gary G. Friedman', speaker_role: 'ceo' as const, quote: fabricated, topic: 'guidance' as const, sentiment: 'positive' as const, importance_score: 95, why_it_matters: 'Never actually said.' },
  ],
  risks: ['Housing market weakness', '  '],
  positives: ['Product transformation underway'],
  changes_vs_prior_quarter: [
    { topic: 'pricing' as const, observation: 'Pricing commentary grew more cautious.', direction: 'deteriorating' as const, evidence_current: realQuoteB, evidence_prior: 'Prior quarter excerpt supplied as context.' },
    { topic: 'guidance' as const, observation: 'Fabricated evidence should be dropped.', direction: 'stable' as const, evidence_current: fabricated, evidence_prior: null },
  ],
};

const parsed = analysisResponseSchema.safeParse(modelResponse);
check('valid response parses', parsed.success, parsed.success ? '' : 'schema rejected a valid payload');

const badScore = analysisResponseSchema.safeParse({ ...modelResponse, overall_sentiment: 140 });
check('out-of-range score rejected', !badScore.success);

const badTopic = analysisResponseSchema.safeParse({
  ...modelResponse,
  topics: [{ topic: 'crypto_strategy', sentiment_score: 50, mention_count: 1, direction: 'stable', summary: 'x' }],
});
check('unknown topic key rejected', !badTopic.success);

const missingField = analysisResponseSchema.safeParse({ ...modelResponse, summary: undefined });
check('missing required field rejected', !missingField.success);

if (!parsed.success) {
  console.log('\nCannot continue without a valid parse.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
console.log('\nNormalization and fabrication guards');
// ---------------------------------------------------------------------------

const analysis = normalizeAnalysis(parsed.data, {
  transcriptText: fixture.text,
  segments,
  modelUsed: 'test-model',
  analysisVersion: 'test',
});

check('fabricated quote dropped', analysis.keyQuotes.length === 2, `kept ${analysis.keyQuotes.length} of 3`);
check('surviving quotes are verbatim', analysis.keyQuotes.every((q) => fixture.text.includes(q.quote)));
check('quotes carry transcript offsets', analysis.keyQuotes.every((q) => q.charOffset !== null && q.charOffset >= 0));
check('quotes sorted by importance', analysis.keyQuotes[0].importanceScore >= analysis.keyQuotes[1].importanceScore);
check(
  'speaker role corrected from transcript',
  analysis.keyQuotes.find((q) => q.speaker === 'Gary G. Friedman')?.speakerRole === 'ceo',
  'model claimed analyst; transcript says CEO',
);
check('duplicate topic collapsed', analysis.topics.filter((t) => t.topic === 'margins').length === 1);
check('first occurrence of duplicate kept', analysis.topics.find((t) => t.topic === 'margins')?.mentionCount === 8);
check('blank risk removed', analysis.risks.length === 1);
check(
  'classification recomputed from score',
  analysis.classification === classifyScore(analysis.overallSentiment) && analysis.classification === 'neutral',
  `got ${analysis.classification}, model said bearish`,
);
check('score rounded to one decimal', analysis.overallSentiment === 58.4, `got ${analysis.overallSentiment}`);
check(
  'unverified change evidence dropped',
  analysis.changesVsPriorQuarter[1].evidenceCurrent === null,
);
check(
  'verified change evidence kept',
  analysis.changesVsPriorQuarter[0].evidenceCurrent !== null,
);
check(
  'prior-quarter evidence passes through',
  analysis.changesVsPriorQuarter[0].evidencePrior !== null,
);

// Offset-at-zero regression: a quote starting at index 0 must not be treated
// as missing by a truthiness check.
const zeroOffset = normalizeAnalysis(
  { ...parsed.data, key_quotes: [{ ...parsed.data.key_quotes[0], quote: fixture.text.slice(0, 120) }] },
  { transcriptText: fixture.text, segments, modelUsed: 'test', analysisVersion: 'test' },
);
check('quote at offset 0 retained', zeroOffset.keyQuotes.length === 1 && zeroOffset.keyQuotes[0].charOffset === 0);

// ---------------------------------------------------------------------------
console.log('\nPrompt assembly');
// ---------------------------------------------------------------------------

const priorSegments = segmentTranscript(prior.text);
const priorAnalysis = normalizeAnalysis(parsed.data, {
  transcriptText: prior.text,
  segments: priorSegments,
  modelUsed: 'test',
  analysisVersion: 'test',
});

const prompt = buildUserPrompt({
  companyName: 'RH',
  ticker: 'RH',
  period: { fiscalYear: 2026, fiscalQuarter: 3 },
  callDate: fixture.callDate,
  segments,
  priorQuarters: [toPriorContext({ fiscalYear: 2026, fiscalQuarter: 2 }, priorAnalysis)],
});

check('prompt separates prepared remarks', prompt.includes('PREPARED REMARKS'));
check('prompt separates Q&A', prompt.includes('ANALYST Q&A'));
check('prompt includes prior context', prompt.includes('PRIOR QUARTER CONTEXT') && prompt.includes('Q2 FY2026'));
check('prompt labels speaker roles', prompt.includes('(CEO)') && prompt.includes('(ANALYST'));
check('prompt stays within budget', prompt.length < 220_000, `${prompt.length} chars`);

const noPrior = buildUserPrompt({
  companyName: 'RH', ticker: 'RH',
  period: { fiscalYear: 2026, fiscalQuarter: 3 },
  callDate: fixture.callDate, segments, priorQuarters: [],
});
check('no-prior prompt forbids speculation', noPrior.includes('empty changes_vs_prior_quarter array'));

// ---------------------------------------------------------------------------
console.log('\nPrice reaction (real RH closes)');
// ---------------------------------------------------------------------------

const prices: PricePoint[] = (priceData as { prices: { date: string; close: number }[] }).prices.map(
  (p) => ({ date: p.date, close: p.close, adjClose: p.close }),
);

const callDate = fixture.callDate; // 2025-12-11
const amc = computePriceReaction(callDate, 'amc', prices);
const bmo = computePriceReaction(callDate, 'bmo', prices);
const unknown = computePriceReaction(callDate, 'unknown', prices);

const idx = prices.findIndex((p) => p.date === callDate);
check('call date is a trading day in the fixture', idx > 0, callDate);
check('AMC base is the call date', amc.baseDate === callDate, `got ${amc.baseDate}`);
check('BMO base is the prior session', bmo.baseDate === prices[idx - 1].date, `got ${bmo.baseDate}`);
check('unknown timing assumes AMC', unknown.baseDate === amc.baseDate);
check('unknown timing is flagged', unknown.timingKnown === false && amc.timingKnown === true);
check('all four horizons computed', [amc.return1d, amc.return5d, amc.return10d, amc.return20d].every((r) => r !== null));

// Verify the 5-day return against the raw series rather than trusting the fn.
const expected5d = (prices[idx + 5].adjClose - prices[idx].adjClose) / prices[idx].adjClose;
check(
  '5-day return matches the price series',
  Math.abs((amc.return5d ?? 0) - expected5d) < 1e-9,
  `got ${amc.return5d}, expected ${expected5d}`,
);

// Horizons must count trading sessions, not calendar days.
const spanDays =
  (Date.parse(`${prices[idx + 20].date}T00:00:00Z`) - Date.parse(`${callDate}T00:00:00Z`)) / 86_400_000;
check('20 sessions span more than 20 calendar days', spanDays > 25, `${spanDays} calendar days`);

const noPrices = computePriceReaction(callDate, 'amc', []);
check('empty price series degrades safely', noPrices.return1d === null && noPrices.baseDate === null);

const beforeSeries = computePriceReaction('2019-01-02', 'amc', prices);
check('call before price history degrades safely', beforeSeries.baseDate === null);

const afterSeries = computePriceReaction(prices[prices.length - 1].date, 'amc', prices);
check('call at series end yields null horizons', afterSeries.return20d === null && afterSeries.baseDate !== null);

// ---------------------------------------------------------------------------
console.log('\nMomentum thresholds');
// ---------------------------------------------------------------------------

check('no prior quarter reads stable', momentumSignal(70, null) === 'stable');
check('+4 is within noise', momentumSignal(54, 50) === 'stable');
check('+5 is improving', momentumSignal(55, 50) === 'improving');
check('-5 is deteriorating', momentumSignal(45, 50) === 'deteriorating');
check('score bands', classifyScore(80) === 'very_bullish' && classifyScore(50) === 'neutral' && classifyScore(10) === 'very_bearish');

console.log(failures === 0 ? '\nAll pipeline checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
