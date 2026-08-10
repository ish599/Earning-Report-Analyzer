import { notFound } from 'next/navigation';
import Link from 'next/link';
import { findCallId, loadCallDetail, loadCompanyView } from '@/lib/analysis/read';
import { CompanyHeader } from '@/components/CompanyHeader';
import { QuarterTabs } from '@/components/QuarterTabs';
import { AnalyzeRunner } from '@/components/AnalyzeRunner';
import { TranscriptViewer } from '@/components/TranscriptViewer';
import { ErrorPanel } from '@/components/ErrorPanel';
import { Panel, EmptyState, Stat } from '@/components/ui/Panel';
import {
  ClassificationChip,
  DirectionChip,
  ScoreBar,
  SentimentChip,
} from '@/components/ui/Indicators';
import { FinancialsTable } from '@/components/summary/FinancialsTable';
import { PriceReactionTable } from '@/components/summary/PriceReactionTable';
import { formatDate } from '@/lib/format';
import {
  AppError,
  TOPIC_LABELS,
  isValidTicker,
  normalizeTicker,
  quarterLabel,
  type KeyQuote,
  type TranscriptTurn,
} from '@/lib/types';

export const dynamic = 'force-dynamic';

interface PageParams {
  ticker: string;
  /** `${fiscalYear}-${fiscalQuarter}`, e.g. "2026-3". */
  period: string;
}

function parsePeriod(period: string): { fiscalYear: number; fiscalQuarter: number } | null {
  const match = /^(\d{4})-([1-4])$/.exec(period);
  if (!match) return null;
  return { fiscalYear: Number(match[1]), fiscalQuarter: Number(match[2]) };
}

export async function generateMetadata({ params }: { params: PageParams }) {
  const parsed = parsePeriod(params.period);
  const ticker = normalizeTicker(params.ticker);
  return {
    title: parsed
      ? `${ticker} ${quarterLabel(parsed)} — Earnings Intelligence`
      : `${ticker} — Earnings Intelligence`,
  };
}

/**
 * Individual quarter page: scores, themes, evidence, and the full transcript.
 *
 * Key quotes link to `#turn-n`, anchoring each excerpt to the passage of the
 * transcript it was taken from.
 */
export default async function QuarterPage({ params }: { params: PageParams }) {
  const ticker = normalizeTicker(params.ticker);
  const parsed = parsePeriod(params.period);
  if (!isValidTicker(ticker) || !parsed) notFound();

  try {
    const [view, callId] = await Promise.all([
      loadCompanyView(ticker),
      findCallId(ticker, parsed.fiscalYear, parsed.fiscalQuarter),
    ]);

    const activeKey = `${parsed.fiscalYear}-${parsed.fiscalQuarter}`;

    if (!callId) {
      return (
        <>
          <CompanyHeader company={view.summary.company} />
          <QuarterTabs ticker={ticker} quarters={view.summary.quarters} active={activeKey} />
          <main className="mx-auto max-w-[1400px] px-5 py-5">
            <Panel>
              <EmptyState
                title={`${quarterLabel(parsed)} has not been retrieved`}
                detail="This quarter is not stored yet. Retrieve and analyze it to see the breakdown."
                action={
                  <div className="flex justify-center">
                    <AnalyzeRunner
                      ticker={ticker}
                      quarters={8}
                      label={`Retrieve and analyze ${quarterLabel(parsed)}`}
                    />
                  </div>
                }
              />
            </Panel>
          </main>
        </>
      );
    }

    const detail = await loadCallDetail(callId);
    const { analysis, segments } = detail;

    return (
      <>
        <CompanyHeader company={view.summary.company} />
        <QuarterTabs ticker={ticker} quarters={view.summary.quarters} active={activeKey} />

        <main className="mx-auto max-w-[1400px] space-y-4 px-5 py-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-3">
              <h1 className="text-lg font-semibold tracking-tight text-ink">
                {quarterLabel(detail)}
              </h1>
              <span className="text-sm text-ink-muted">{formatDate(detail.callDate)}</span>
              {analysis && <ClassificationChip value={analysis.classification} />}
            </div>
            <span className="text-2xs text-ink-muted">
              Source: {detail.transcriptSource}
              {analysis && ` · ${analysis.modelUsed} · v${analysis.analysisVersion}`}
            </span>
          </div>

          {!analysis ? (
            <Panel>
              <EmptyState
                title="This quarter has not been analyzed"
                detail="The transcript is stored. Run the analysis to see scores, themes, and evidence."
                action={
                  <div className="flex justify-center">
                    <AnalyzeRunner ticker={ticker} quarters={8} label="Analyze this quarter" />
                  </div>
                }
              />
            </Panel>
          ) : (
            <>
              {/* Executive summary */}
              <Panel title="Executive summary">
                <p className="max-w-4xl text-base leading-relaxed text-ink">{analysis.summary}</p>
              </Panel>

              {/* Scores */}
              <Panel title="Scores" note="0–100 · 50 = neutral · research heuristic">
                <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                  <ScoreBar
                    label="Overall sentiment"
                    value={analysis.overallSentiment}
                    hint="Holistic read of the call as an information event."
                  />
                  <ScoreBar
                    label="Management sentiment"
                    value={analysis.managementSentiment}
                    hint="Prepared remarks only."
                  />
                  <ScoreBar
                    label="Q&A sentiment"
                    value={analysis.qaSentiment}
                    hint="Analyst exchange, weighing directness of answers."
                  />
                  <ScoreBar
                    label="Management confidence"
                    value={analysis.managementConfidence}
                    hint="Conviction and specificity, not enthusiasm."
                  />
                  <ScoreBar
                    label="Guidance tone"
                    value={analysis.guidanceTone}
                    hint="Forward-looking commentary specifically."
                  />
                  <ScoreBar
                    label="Business momentum"
                    value={analysis.businessMomentum}
                    hint="Direction of the underlying business as described."
                  />
                </div>
                <div className="mt-4 border-t border-line pt-3">
                  <Stat
                    label="Analysis confidence"
                    value={`${analysis.confidenceScore.toFixed(0)} / 100`}
                    hint="How well-supported this analysis is by the transcript."
                  />
                </div>
              </Panel>

              {/* Prepared vs Q&A */}
              <Panel title="Prepared remarks versus Q&A">
                <PreparedVsQa
                  managementScore={analysis.managementSentiment}
                  qaScore={analysis.qaSentiment}
                  preparedTurns={segments.preparedRemarks.length}
                  qaTurns={segments.qa.length}
                  boundaryDetected={segments.boundaryDetected}
                />
              </Panel>

              {/* Positives and risks */}
              <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="Key positives">
                  <BulletList items={analysis.positives} tone="positive" />
                </Panel>
                <Panel title="Key risks">
                  <BulletList items={analysis.risks} tone="negative" />
                </Panel>
              </div>

              {/* Changes vs prior quarter */}
              <Panel
                title="Changes versus previous quarters"
                note="Each claim is tied to transcript language"
                bodyClassName=""
              >
                {analysis.changesVsPriorQuarter.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-ink-muted">
                    No prior-quarter comparison is available for this call.
                  </p>
                ) : (
                  <ul className="divide-y divide-line">
                    {analysis.changesVsPriorQuarter.map((change, i) => (
                      <li key={i} className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <DirectionChip value={change.direction} />
                          {change.topic && (
                            <span className="text-xs font-medium text-ink-secondary">
                              {TOPIC_LABELS[change.topic] ?? change.topic}
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 text-base leading-snug text-ink">
                          {change.observation}
                        </p>
                        {change.evidenceCurrent && (
                          <blockquote className="quote-text mt-2 text-sm">
                            <span className="field-label mr-1.5">This quarter</span>
                            &ldquo;{change.evidenceCurrent}&rdquo;
                          </blockquote>
                        )}
                        {change.evidencePrior && (
                          <blockquote className="quote-text mt-1.5 text-sm">
                            <span className="field-label mr-1.5">Prior quarter</span>
                            &ldquo;{change.evidencePrior}&rdquo;
                          </blockquote>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              {/* Topic breakdown */}
              <Panel title="Topic breakdown" bodyClassName="">
                {analysis.topics.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-ink-muted">
                    No topics were identified in this transcript.
                  </p>
                ) : (
                  <div className="overflow-x-auto scrollbar-thin">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Topic</th>
                          <th className="num">Sentiment</th>
                          <th className="num">Mentions</th>
                          <th>Direction</th>
                          <th>Commentary</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analysis.topics.map((topic) => (
                          <tr key={topic.topic}>
                            <td className="whitespace-nowrap font-medium">
                              {TOPIC_LABELS[topic.topic] ?? topic.topic}
                            </td>
                            <td className="num">{topic.sentimentScore.toFixed(0)}</td>
                            <td className="num text-ink-secondary">{topic.mentionCount}</td>
                            <td>
                              <DirectionChip value={topic.direction} />
                            </td>
                            <td className="text-sm text-ink-secondary">{topic.summary}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>

              {/* Key quotes, anchored to the transcript */}
              <Panel
                title="Key quotes"
                note="Click a quote to jump to it in the transcript"
                bodyClassName=""
              >
                <QuoteList quotes={analysis.keyQuotes} turns={segments.turns} />
              </Panel>
            </>
          )}

          {/* Financials and price reaction for this quarter */}
          <div className="grid gap-4 xl:grid-cols-2">
            <Panel title="Financial results" bodyClassName="">
              <FinancialsTable
                quarters={view.summary.quarters.filter((q) => q.callId === callId)}
              />
            </Panel>
            <Panel title="Historical market reaction" bodyClassName="">
              <PriceReactionTable
                quarters={view.summary.quarters.filter((q) => q.callId === callId)}
              />
            </Panel>
          </div>

          {/* Full transcript */}
          <Panel
            title="Full transcript"
            note={`${detail.transcriptText.length.toLocaleString()} characters`}
            bodyClassName=""
          >
            {segments.turns.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-muted">
                No transcript text is stored for this call.
              </p>
            ) : (
              <TranscriptViewer turns={segments.turns} />
            )}
          </Panel>

          <footer className="pt-2 text-2xs text-ink-muted">
            <Link href="/methodology" className="underline underline-offset-2 hover:text-ink">
              Methodology and limitations
            </Link>
          </footer>
        </main>
      </>
    );
  } catch (error) {
    if (error instanceof AppError && error.code === 'company_not_found') notFound();
    return <ErrorPanel ticker={ticker} error={error} />;
  }
}

// ---------------------------------------------------------------------------

function BulletList({ items, tone }: { items: string[]; tone: 'positive' | 'negative' }) {
  if (items.length === 0) {
    return <p className="text-sm text-ink-muted">None identified.</p>;
  }

  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-base leading-snug text-ink-secondary">
          <span
            aria-hidden
            className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${
              tone === 'positive' ? 'bg-positive' : 'bg-negative'
            }`}
          />
          {item}
        </li>
      ))}
    </ul>
  );
}

function PreparedVsQa({
  managementScore,
  qaScore,
  preparedTurns,
  qaTurns,
  boundaryDetected,
}: {
  managementScore: number;
  qaScore: number;
  preparedTurns: number;
  qaTurns: number;
  boundaryDetected: boolean;
}) {
  const gap = qaScore - managementScore;

  return (
    <div>
      <div className="grid gap-6 sm:grid-cols-3">
        <Stat
          label="Prepared remarks"
          value={managementScore.toFixed(0)}
          hint={`${preparedTurns} speaker turns`}
        />
        <Stat label="Q&A" value={qaScore.toFixed(0)} hint={`${qaTurns} speaker turns`} />
        <Stat
          label="Gap (Q&A − prepared)"
          value={`${gap > 0 ? '+' : ''}${gap.toFixed(0)}`}
          valueClassName={
            Math.abs(gap) < 5 ? 'text-ink-secondary' : gap > 0 ? 'text-positive' : 'text-negative'
          }
        />
      </div>

      <p className="mt-3 border-t border-line pt-2.5 text-sm leading-relaxed text-ink-secondary">
        {!boundaryDetected
          ? 'The prepared-remarks and Q&A sections could not be separated in this transcript, so the two scores are not independent.'
          : Math.abs(gap) < 5
            ? 'Scripted and unscripted commentary scored similarly, which suggests the prepared narrative held up under questioning.'
            : gap < 0
              ? 'The Q&A scored materially below the prepared remarks — management was less convincing when questioned than when scripted. Worth reading the exchange directly.'
              : 'The Q&A scored materially above the prepared remarks, which often indicates management was more forthcoming under questioning than in the scripted narrative.'}
      </p>
    </div>
  );
}

const ROLE_LABELS: Record<string, string> = {
  ceo: 'CEO',
  cfo: 'CFO',
  management: 'Management',
  analyst: 'Analyst',
  operator: 'Operator',
  unknown: '',
};

function QuoteList({ quotes, turns }: { quotes: KeyQuote[]; turns: TranscriptTurn[] }) {
  if (quotes.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-ink-muted">
        No quotes could be verified against the transcript for this call.
      </p>
    );
  }

  /** Turn containing a character offset, so the anchor lands on the passage. */
  function turnFor(offset: number | null): number | null {
    if (offset == null) return null;
    const match = turns.find((t) => offset >= t.charStart && offset < t.charEnd);
    return match?.index ?? null;
  }

  return (
    <ul className="divide-y divide-line">
      {quotes.map((quote, index) => {
        const turnIndex = turnFor(quote.charOffset);
        const role = ROLE_LABELS[quote.speakerRole] ?? '';

        return (
          <li key={index} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-semibold text-ink">{quote.speaker}</span>
              {role && <span className="text-xs text-ink-muted">{role}</span>}
              {quote.topic && (
                <span className="chip chip-neutral">
                  {TOPIC_LABELS[quote.topic] ?? quote.topic}
                </span>
              )}
              <SentimentChip value={quote.sentiment} />
              {turnIndex !== null && (
                <a
                  href={`#turn-${turnIndex}`}
                  className="ml-auto text-xs text-accent underline-offset-2 hover:underline"
                >
                  Jump to transcript ↓
                </a>
              )}
            </div>

            <blockquote className="quote-text mt-2">&ldquo;{quote.quote}&rdquo;</blockquote>

            {quote.whyItMatters && (
              <p className="mt-2 text-sm leading-snug text-ink-secondary">
                <span className="field-label mr-1.5">Why it matters</span>
                {quote.whyItMatters}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
