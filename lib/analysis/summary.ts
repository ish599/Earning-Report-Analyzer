import 'server-only';
import * as store from '@/lib/db/store';
import {
  TOPIC_LABELS,
  compareQuartersDesc,
  momentumSignal,
  quarterLabel,
  type ChangeItem,
  type CompanyProfile,
  type CompanySummary,
  type EarningsAnalysis,
  type QuarterSummaryRow,
  type TopicKey,
  type TopicTrend,
  type WhatChanged,
} from '@/lib/types';

/**
 * Read-side assembly of the cross-quarter view.
 *
 * Pure aggregation over already-stored analyses — this never calls a provider
 * or the LLM, so loading the dashboard costs a few database reads regardless
 * of how many quarters are on screen.
 */

export async function buildCompanySummary(
  company: CompanyProfile,
  companyId: string,
): Promise<CompanySummary> {
  const calls = (await store.listCalls(companyId, company.ticker)).sort(compareQuartersDesc);
  const callIds = calls.map((c) => c.id);

  const periods = new Map(
    calls.map((c) => [
      c.id,
      { fiscalYear: c.fiscalYear, fiscalQuarter: c.fiscalQuarter, reportDate: c.callDate },
    ]),
  );

  const [analyses, financials, reactions] = await Promise.all([
    store.getAnalysesForCalls(callIds),
    store.getFinancialsForCalls(callIds, periods),
    store.getPriceReactionsForCalls(callIds),
  ]);

  // Newest first for display; momentum needs the immediately older quarter.
  const quarters: QuarterSummaryRow[] = calls.map((call, index) => {
    const analysis = analyses.get(call.id) ?? null;
    const older = calls[index + 1];
    const priorAnalysis = older ? analyses.get(older.id) : undefined;

    return {
      callId: call.id,
      fiscalYear: call.fiscalYear,
      fiscalQuarter: call.fiscalQuarter,
      callDate: call.callDate,
      label: quarterLabel(call),
      overallSentiment: analysis?.overallSentiment ?? null,
      managementSentiment: analysis?.managementSentiment ?? null,
      qaSentiment: analysis?.qaSentiment ?? null,
      momentum:
        analysis && priorAnalysis
          ? momentumSignal(analysis.overallSentiment, priorAnalysis.overallSentiment)
          : 'stable',
      classification: analysis?.classification ?? null,
      financials: financials.get(call.id) ?? null,
      priceReaction: reactions.get(call.id) ?? null,
      analyzed: analysis !== null,
    };
  });

  const analyzedQuarters = quarters.filter((q) => q.analyzed);

  return {
    company,
    quarters,
    topicTrends: buildTopicTrends(quarters, analyses),
    whatChanged: buildWhatChanged(analyzedQuarters, analyses),
    keyQuotes: analyzedQuarters
      .flatMap((q) => {
        const analysis = analyses.get(q.callId);
        if (!analysis) return [];
        return analysis.keyQuotes.slice(0, 3).map((quote) => ({
          ...quote,
          fiscalYear: q.fiscalYear,
          fiscalQuarter: q.fiscalQuarter,
          callId: q.callId,
        }));
      })
      .sort((a, b) => compareQuartersDesc(a, b) || b.importanceScore - a.importanceScore)
      .slice(0, 12),
  };
}

/**
 * Topic-by-quarter series, oldest first so charts read left to right.
 *
 * Only topics the model actually returned appear, which is why a topic can
 * have gaps: a quarter where management did not discuss margins genuinely has
 * no margin data point, and interpolating one would invent commentary.
 */
function buildTopicTrends(
  quarters: QuarterSummaryRow[],
  analyses: Map<string, EarningsAnalysis>,
): TopicTrend[] {
  const byTopic = new Map<TopicKey, TopicTrend['points']>();

  for (const quarter of [...quarters].reverse()) {
    const analysis = analyses.get(quarter.callId);
    if (!analysis) continue;

    for (const topic of analysis.topics) {
      const points = byTopic.get(topic.topic) ?? [];
      points.push({
        fiscalYear: quarter.fiscalYear,
        fiscalQuarter: quarter.fiscalQuarter,
        label: quarter.label,
        sentimentScore: topic.sentimentScore,
        mentionCount: topic.mentionCount,
        direction: topic.direction,
      });
      byTopic.set(topic.topic, points);
    }
  }

  return [...byTopic.entries()]
    .map(([topic, points]) => ({ topic, points }))
    // Most-discussed topics first: that ordering matches how an analyst scans.
    .sort((a, b) => sumMentions(b.points) - sumMentions(a.points));
}

function sumMentions(points: TopicTrend['points']): number {
  return points.reduce((n, p) => n + p.mentionCount, 0);
}

/**
 * The "What Changed?" panel.
 *
 * Sourced from the latest analyzed quarter: its per-topic directions, and the
 * model's explicit quarter-over-quarter observations. Risks and positives are
 * classified as "new" by comparing against the prior quarter's lists.
 */
function buildWhatChanged(
  analyzedQuarters: QuarterSummaryRow[],
  analyses: Map<string, EarningsAnalysis>,
): WhatChanged {
  const empty: WhatChanged = { improving: [], deteriorating: [], newRisks: [], newPositives: [] };

  const latest = analyzedQuarters[0];
  if (!latest) return empty;

  const analysis = analyses.get(latest.callId);
  if (!analysis) return empty;

  const prior = analyzedQuarters[1] ? analyses.get(analyzedQuarters[1].callId) : undefined;

  const changeByTopic = new Map(
    analysis.changesVsPriorQuarter.filter((c) => c.topic).map((c) => [c.topic as TopicKey, c]),
  );

  const toItem = (topic: TopicKey, fallback: string): ChangeItem => {
    const change = changeByTopic.get(topic);
    return {
      topic,
      label: TOPIC_LABELS[topic] ?? topic,
      detail: change?.observation ?? fallback,
      evidence: change?.evidenceCurrent ?? null,
      callId: latest.callId,
    };
  };

  const improving = analysis.topics
    .filter((t) => t.direction === 'improving')
    .map((t) => toItem(t.topic, t.summary));

  const deteriorating = analysis.topics
    .filter((t) => t.direction === 'deteriorating')
    .map((t) => toItem(t.topic, t.summary));

  // A theme counts as new when it does not closely match anything in the prior
  // quarter's corresponding list.
  const newRisks = analysis.risks
    .filter((risk) => !prior || !hasSimilar(prior.risks, risk))
    .map(
      (risk): ChangeItem => ({
        topic: null,
        label: risk,
        detail: prior ? 'Not raised in the prior quarter.' : 'First analyzed quarter.',
        evidence: null,
        callId: latest.callId,
      }),
    );

  const newPositives = analysis.positives
    .filter((positive) => !prior || !hasSimilar(prior.positives, positive))
    .map(
      (positive): ChangeItem => ({
        topic: null,
        label: positive,
        detail: prior ? 'Not raised in the prior quarter.' : 'First analyzed quarter.',
        evidence: null,
        callId: latest.callId,
      }),
    );

  return { improving, deteriorating, newRisks, newPositives };
}

/**
 * Loose textual match used to decide whether a theme is genuinely new.
 *
 * Management restates the same risk in different words each quarter, so exact
 * comparison would flag everything as new and make the panel useless. Jaccard
 * overlap on content words is crude but stable enough for this purpose.
 */
function hasSimilar(existing: string[], candidate: string): boolean {
  const target = tokenize(candidate);
  if (target.size === 0) return false;

  return existing.some((item) => {
    const tokens = tokenize(item);
    if (tokens.size === 0) return false;

    let shared = 0;
    for (const token of target) if (tokens.has(token)) shared += 1;

    const union = target.size + tokens.size - shared;
    return union > 0 && shared / union >= 0.45;
  });
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'are', 'was', 'were',
  'their', 'management', 'company', 'quarter', 'continued', 'continues', 'remains',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w)),
  );
}
