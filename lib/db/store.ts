import 'server-only';
import { getServiceClient } from './client';
import { ANALYSIS_VERSION } from '@/lib/config';
import {
  AppError,
  type Company,
  type EarningsAnalysis,
  type FinancialResult,
  type KeyQuote,
  type PriceReaction,
  type QuarterChange,
  type SpeakerRole,
  type TopicAnalysis,
  type TopicKey,
  type SentimentLabel,
  type TopicDirection,
  type Classification,
  type Signal,
  type ReleaseTiming,
  classifyScore,
} from '@/lib/types';

/**
 * Persistence for companies, transcripts, and analyses.
 *
 * Two backends share one interface:
 *   * Supabase when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.
 *   * An in-process Map otherwise, so the product runs end to end with no
 *     database. The memory backend is NOT durable — it is cleared on every
 *     cold start, so an unconfigured deployment re-analyzes transcripts more
 *     often than it should. It exists for local development and demos.
 *
 * The purpose of this layer is to keep expensive LLM work from repeating.
 * Every read path here is consulted before any call to `lib/ai/`.
 */

export interface StoredCall {
  id: string;
  companyId: string;
  ticker: string;
  fiscalYear: number;
  fiscalQuarter: number;
  callDate: string | null;
  transcriptText: string | null;
  transcriptSource: string;
}

// ---------------------------------------------------------------------------
// In-memory backend
// ---------------------------------------------------------------------------

interface MemoryDb {
  companies: Map<string, Company & { id: string }>;
  calls: Map<string, StoredCall>;
  analyses: Map<string, EarningsAnalysis>;
  financials: Map<string, FinancialResult>;
  reactions: Map<string, PriceReaction>;
}

/**
 * Held on globalThis so Next.js dev-server module reloads don't discard the
 * cache and trigger redundant LLM calls.
 */
const memory: MemoryDb = ((globalThis as Record<string, unknown>).__eiMemoryDb as MemoryDb) ?? {
  companies: new Map(),
  calls: new Map(),
  analyses: new Map(),
  financials: new Map(),
  reactions: new Map(),
};
(globalThis as Record<string, unknown>).__eiMemoryDb = memory;

const callKey = (ticker: string, fy: number, fq: number) => `${ticker}:${fy}:${fq}`;
const analysisKey = (callId: string, version: string) => `${callId}@${version}`;

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

export async function upsertCompany(company: Company): Promise<string> {
  const db = getServiceClient();
  const ticker = company.ticker.toUpperCase();

  if (!db) {
    const existing = memory.companies.get(ticker);
    const id = existing?.id ?? `mem-company-${ticker}`;
    memory.companies.set(ticker, { ...company, ticker, id });
    return id;
  }

  const { data, error } = await db
    .from('companies')
    .upsert(
      {
        ticker,
        company_name: company.companyName,
        sector: company.sector,
        industry: company.industry,
        exchange: company.exchange,
      },
      { onConflict: 'ticker' },
    )
    .select('id')
    .single();

  if (error || !data) {
    throw new AppError('database_error', 'Could not save company information.', { cause: error });
  }
  return data.id as string;
}

export async function getCompanyByTicker(
  ticker: string,
): Promise<(Company & { id: string }) | null> {
  const db = getServiceClient();
  const upper = ticker.toUpperCase();

  if (!db) return memory.companies.get(upper) ?? null;

  const { data, error } = await db
    .from('companies')
    .select('id, ticker, company_name, sector, industry, exchange')
    .ilike('ticker', upper)
    .maybeSingle();

  if (error) {
    throw new AppError('database_error', 'Could not load company information.', { cause: error });
  }
  if (!data) return null;

  return {
    id: data.id as string,
    ticker: data.ticker as string,
    companyName: data.company_name as string,
    sector: data.sector as string | null,
    industry: data.industry as string | null,
    exchange: data.exchange as string | null,
  };
}

// ---------------------------------------------------------------------------
// Earnings calls
// ---------------------------------------------------------------------------

export async function upsertCall(input: {
  companyId: string;
  ticker: string;
  fiscalYear: number;
  fiscalQuarter: number;
  callDate: string | null;
  transcriptText: string | null;
  transcriptSource: string;
}): Promise<StoredCall> {
  const db = getServiceClient();

  if (!db) {
    const key = callKey(input.ticker, input.fiscalYear, input.fiscalQuarter);
    const existing = memory.calls.get(key);
    const record: StoredCall = {
      id: existing?.id ?? `mem-call-${key}`,
      companyId: input.companyId,
      ticker: input.ticker,
      fiscalYear: input.fiscalYear,
      fiscalQuarter: input.fiscalQuarter,
      callDate: input.callDate,
      // Never blank out a transcript we already hold.
      transcriptText: input.transcriptText ?? existing?.transcriptText ?? null,
      transcriptSource: input.transcriptSource,
    };
    memory.calls.set(key, record);
    return record;
  }

  const { data, error } = await db
    .from('earnings_calls')
    .upsert(
      {
        company_id: input.companyId,
        fiscal_year: input.fiscalYear,
        fiscal_quarter: input.fiscalQuarter,
        call_date: input.callDate,
        transcript_text: input.transcriptText,
        transcript_source: input.transcriptSource,
      },
      { onConflict: 'company_id,fiscal_year,fiscal_quarter' },
    )
    .select('id, company_id, fiscal_year, fiscal_quarter, call_date, transcript_text, transcript_source')
    .single();

  if (error || !data) {
    throw new AppError('database_error', 'Could not save the earnings call.', { cause: error });
  }

  return {
    id: data.id as string,
    companyId: data.company_id as string,
    ticker: input.ticker,
    fiscalYear: data.fiscal_year as number,
    fiscalQuarter: data.fiscal_quarter as number,
    callDate: data.call_date as string | null,
    transcriptText: data.transcript_text as string | null,
    transcriptSource: data.transcript_source as string,
  };
}

export async function listCalls(companyId: string, ticker: string): Promise<StoredCall[]> {
  const db = getServiceClient();

  if (!db) {
    return [...memory.calls.values()]
      .filter((c) => c.companyId === companyId)
      .sort((a, b) => b.fiscalYear - a.fiscalYear || b.fiscalQuarter - a.fiscalQuarter);
  }

  const { data, error } = await db
    .from('earnings_calls')
    .select('id, company_id, fiscal_year, fiscal_quarter, call_date, transcript_source')
    .eq('company_id', companyId)
    .order('fiscal_year', { ascending: false })
    .order('fiscal_quarter', { ascending: false });

  if (error) {
    throw new AppError('database_error', 'Could not load earnings calls.', { cause: error });
  }

  // transcript_text is deliberately not selected here — these rows feed list
  // views, and transcripts are large enough to dominate the response.
  return (data ?? []).map((row) => ({
    id: row.id as string,
    companyId: row.company_id as string,
    ticker,
    fiscalYear: row.fiscal_year as number,
    fiscalQuarter: row.fiscal_quarter as number,
    callDate: row.call_date as string | null,
    transcriptText: null,
    transcriptSource: row.transcript_source as string,
  }));
}

export async function getCallById(callId: string): Promise<StoredCall | null> {
  const db = getServiceClient();

  if (!db) {
    return [...memory.calls.values()].find((c) => c.id === callId) ?? null;
  }

  const { data, error } = await db
    .from('earnings_calls')
    .select(
      'id, company_id, fiscal_year, fiscal_quarter, call_date, transcript_text, transcript_source, companies(ticker)',
    )
    .eq('id', callId)
    .maybeSingle();

  if (error) {
    throw new AppError('database_error', 'Could not load the earnings call.', { cause: error });
  }
  if (!data) return null;

  const companies = data.companies as unknown as { ticker: string } | { ticker: string }[] | null;
  const ticker = Array.isArray(companies) ? companies[0]?.ticker : companies?.ticker;

  return {
    id: data.id as string,
    companyId: data.company_id as string,
    ticker: ticker ?? '',
    fiscalYear: data.fiscal_year as number,
    fiscalQuarter: data.fiscal_quarter as number,
    callDate: data.call_date as string | null,
    transcriptText: data.transcript_text as string | null,
    transcriptSource: data.transcript_source as string,
  };
}

export async function getTranscriptText(callId: string): Promise<string | null> {
  const db = getServiceClient();

  if (!db) {
    return [...memory.calls.values()].find((c) => c.id === callId)?.transcriptText ?? null;
  }

  const { data, error } = await db
    .from('earnings_calls')
    .select('transcript_text')
    .eq('id', callId)
    .maybeSingle();

  if (error) {
    throw new AppError('database_error', 'Could not load the transcript.', { cause: error });
  }
  return (data?.transcript_text as string | null) ?? null;
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/**
 * Returns the cached analysis for a call at the current analysis version.
 *
 * A null result is the sole trigger for re-running the model. Bumping
 * ANALYSIS_VERSION therefore invalidates every cached analysis at once
 * without deleting the historical rows.
 */
export async function getAnalysis(
  callId: string,
  version: string = ANALYSIS_VERSION,
): Promise<EarningsAnalysis | null> {
  const db = getServiceClient();

  if (!db) return memory.analyses.get(analysisKey(callId, version)) ?? null;

  const { data, error } = await db
    .from('earnings_analysis')
    .select('*, topic_analysis(*), key_quotes(*)')
    .eq('earnings_call_id', callId)
    .eq('analysis_version', version)
    .maybeSingle();

  if (error) {
    throw new AppError('database_error', 'Could not load the stored analysis.', { cause: error });
  }
  if (!data) return null;

  return rowToAnalysis(data);
}

export async function getAnalysesForCalls(
  callIds: string[],
  version: string = ANALYSIS_VERSION,
): Promise<Map<string, EarningsAnalysis>> {
  const out = new Map<string, EarningsAnalysis>();
  if (callIds.length === 0) return out;

  const db = getServiceClient();

  if (!db) {
    for (const id of callIds) {
      const found = memory.analyses.get(analysisKey(id, version));
      if (found) out.set(id, found);
    }
    return out;
  }

  const { data, error } = await db
    .from('earnings_analysis')
    .select('*, topic_analysis(*), key_quotes(*)')
    .in('earnings_call_id', callIds)
    .eq('analysis_version', version);

  if (error) {
    throw new AppError('database_error', 'Could not load stored analyses.', { cause: error });
  }

  for (const row of data ?? []) {
    out.set(row.earnings_call_id as string, rowToAnalysis(row));
  }
  return out;
}

export async function saveAnalysis(callId: string, analysis: EarningsAnalysis): Promise<void> {
  const db = getServiceClient();

  if (!db) {
    memory.analyses.set(analysisKey(callId, analysis.analysisVersion), analysis);
    return;
  }

  const signal: Signal = analysis.businessMomentum >= 60
    ? 'improving'
    : analysis.businessMomentum <= 40
      ? 'deteriorating'
      : 'stable';

  const { data, error } = await db
    .from('earnings_analysis')
    .upsert(
      {
        earnings_call_id: callId,
        overall_sentiment: analysis.overallSentiment,
        management_sentiment: analysis.managementSentiment,
        qa_sentiment: analysis.qaSentiment,
        management_confidence: analysis.managementConfidence,
        guidance_tone: analysis.guidanceTone,
        business_momentum: analysis.businessMomentum,
        sentiment_score: analysis.overallSentiment,
        confidence_score: analysis.confidenceScore,
        signal,
        classification: analysis.classification,
        summary: analysis.summary,
        risks: analysis.risks,
        positives: analysis.positives,
        changes_vs_prior: analysis.changesVsPriorQuarter,
        analysis_version: analysis.analysisVersion,
        model_used: analysis.modelUsed,
      },
      { onConflict: 'earnings_call_id,analysis_version' },
    )
    .select('id')
    .single();

  if (error || !data) {
    throw new AppError('database_error', 'Could not save the analysis.', { cause: error });
  }

  const analysisId = data.id as string;

  // Children are replaced wholesale: a re-analysis at the same version is a
  // correction, and merging would leave orphaned topics or quotes behind.
  await db.from('topic_analysis').delete().eq('analysis_id', analysisId);
  await db.from('key_quotes').delete().eq('analysis_id', analysisId);

  if (analysis.topics.length > 0) {
    const { error: topicError } = await db.from('topic_analysis').insert(
      analysis.topics.map((t) => ({
        earnings_call_id: callId,
        analysis_id: analysisId,
        topic: t.topic,
        sentiment_score: t.sentimentScore,
        mention_count: t.mentionCount,
        direction: t.direction,
        summary: t.summary,
      })),
    );
    if (topicError) {
      throw new AppError('database_error', 'Could not save topic analysis.', { cause: topicError });
    }
  }

  if (analysis.keyQuotes.length > 0) {
    const { error: quoteError } = await db.from('key_quotes').insert(
      analysis.keyQuotes.map((q) => ({
        earnings_call_id: callId,
        analysis_id: analysisId,
        speaker: q.speaker,
        speaker_role: q.speakerRole,
        quote: q.quote,
        topic: q.topic,
        sentiment: q.sentiment,
        importance_score: q.importanceScore,
        why_it_matters: q.whyItMatters,
        char_offset: q.charOffset,
      })),
    );
    if (quoteError) {
      throw new AppError('database_error', 'Could not save key quotes.', { cause: quoteError });
    }
  }
}

function rowToAnalysis(row: Record<string, unknown>): EarningsAnalysis {
  const topics = (row.topic_analysis as Record<string, unknown>[] | null) ?? [];
  const quotes = (row.key_quotes as Record<string, unknown>[] | null) ?? [];
  const overall = num(row.overall_sentiment) ?? 50;

  return {
    overallSentiment: overall,
    managementSentiment: num(row.management_sentiment) ?? overall,
    qaSentiment: num(row.qa_sentiment) ?? overall,
    managementConfidence: num(row.management_confidence) ?? 50,
    guidanceTone: num(row.guidance_tone) ?? 50,
    businessMomentum: num(row.business_momentum) ?? 50,
    classification: (row.classification as Classification | null) ?? classifyScore(overall),
    confidenceScore: num(row.confidence_score) ?? 50,
    summary: (row.summary as string | null) ?? '',
    risks: asStringArray(row.risks),
    positives: asStringArray(row.positives),
    changesVsPriorQuarter: (row.changes_vs_prior as QuarterChange[] | null) ?? [],
    analysisVersion: row.analysis_version as string,
    modelUsed: row.model_used as string,
    topics: topics.map(
      (t): TopicAnalysis => ({
        topic: t.topic as TopicKey,
        sentimentScore: num(t.sentiment_score) ?? 50,
        mentionCount: (t.mention_count as number | null) ?? 0,
        direction: (t.direction as TopicDirection | null) ?? 'stable',
        summary: (t.summary as string | null) ?? '',
      }),
    ),
    keyQuotes: quotes
      .map(
        (q): KeyQuote => ({
          speaker: (q.speaker as string | null) ?? 'Unknown',
          speakerRole: (q.speaker_role as SpeakerRole | null) ?? 'unknown',
          quote: q.quote as string,
          topic: (q.topic as TopicKey | null) ?? null,
          sentiment: (q.sentiment as SentimentLabel | null) ?? 'neutral',
          importanceScore: num(q.importance_score) ?? 50,
          whyItMatters: (q.why_it_matters as string | null) ?? '',
          charOffset: (q.char_offset as number | null) ?? null,
        }),
      )
      .sort((a, b) => b.importanceScore - a.importanceScore),
  };
}

/** Postgres numerics arrive as strings through PostgREST. */
function num(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

// ---------------------------------------------------------------------------
// Financials
// ---------------------------------------------------------------------------

export async function saveFinancials(callId: string, financials: FinancialResult): Promise<void> {
  const db = getServiceClient();

  if (!db) {
    memory.financials.set(callId, financials);
    return;
  }

  const { error } = await db.from('financial_results').upsert(
    {
      earnings_call_id: callId,
      revenue: financials.revenue,
      revenue_growth: financials.revenueGrowth,
      eps: financials.eps,
      eps_estimate: financials.epsEstimate,
      eps_surprise: financials.epsSurprise,
      gross_margin: financials.grossMargin,
      operating_margin: financials.operatingMargin,
      guidance_json: financials.guidance,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'earnings_call_id' },
  );

  if (error) {
    throw new AppError('database_error', 'Could not save financial results.', { cause: error });
  }
}

export async function getFinancialsForCalls(
  callIds: string[],
  periods: Map<string, { fiscalYear: number; fiscalQuarter: number; reportDate: string | null }>,
): Promise<Map<string, FinancialResult>> {
  const out = new Map<string, FinancialResult>();
  if (callIds.length === 0) return out;

  const db = getServiceClient();

  if (!db) {
    for (const id of callIds) {
      const found = memory.financials.get(id);
      if (found) out.set(id, found);
    }
    return out;
  }

  const { data, error } = await db
    .from('financial_results')
    .select('*')
    .in('earnings_call_id', callIds);

  if (error) {
    throw new AppError('database_error', 'Could not load financial results.', { cause: error });
  }

  for (const row of data ?? []) {
    const callId = row.earnings_call_id as string;
    const period = periods.get(callId);
    out.set(callId, {
      fiscalYear: period?.fiscalYear ?? 0,
      fiscalQuarter: period?.fiscalQuarter ?? 0,
      reportDate: period?.reportDate ?? null,
      revenue: num(row.revenue),
      revenueGrowth: num(row.revenue_growth),
      eps: num(row.eps),
      epsEstimate: num(row.eps_estimate),
      epsSurprise: num(row.eps_surprise),
      grossMargin: num(row.gross_margin),
      operatingMargin: num(row.operating_margin),
      guidance: (row.guidance_json as FinancialResult['guidance']) ?? null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Price reactions
// ---------------------------------------------------------------------------

export async function savePriceReaction(callId: string, reaction: PriceReaction): Promise<void> {
  const db = getServiceClient();

  if (!db) {
    memory.reactions.set(callId, reaction);
    return;
  }

  const { error } = await db.from('price_reactions').upsert(
    {
      earnings_call_id: callId,
      return_1d: reaction.return1d,
      return_5d: reaction.return5d,
      return_10d: reaction.return10d,
      return_20d: reaction.return20d,
      base_date: reaction.baseDate,
      base_price: reaction.basePrice,
      release_timing: reaction.releaseTiming,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'earnings_call_id' },
  );

  if (error) {
    throw new AppError('database_error', 'Could not save price reaction.', { cause: error });
  }
}

export async function getPriceReactionsForCalls(
  callIds: string[],
): Promise<Map<string, PriceReaction>> {
  const out = new Map<string, PriceReaction>();
  if (callIds.length === 0) return out;

  const db = getServiceClient();

  if (!db) {
    for (const id of callIds) {
      const found = memory.reactions.get(id);
      if (found) out.set(id, found);
    }
    return out;
  }

  const { data, error } = await db.from('price_reactions').select('*').in('earnings_call_id', callIds);

  if (error) {
    throw new AppError('database_error', 'Could not load price reactions.', { cause: error });
  }

  for (const row of data ?? []) {
    const timing = (row.release_timing as ReleaseTiming | null) ?? 'unknown';
    out.set(row.earnings_call_id as string, {
      return1d: num(row.return_1d),
      return5d: num(row.return_5d),
      return10d: num(row.return_10d),
      return20d: num(row.return_20d),
      baseDate: row.base_date as string | null,
      basePrice: num(row.base_price),
      releaseTiming: timing,
      timingKnown: timing !== 'unknown',
    });
  }
  return out;
}
