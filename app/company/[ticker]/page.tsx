import { notFound } from 'next/navigation';
import Link from 'next/link';
import { loadCompanyView } from '@/lib/analysis/read';
import { CompanyHeader } from '@/components/CompanyHeader';
import { QuarterTabs } from '@/components/QuarterTabs';
import { AnalyzeRunner } from '@/components/AnalyzeRunner';
import { Panel, EmptyState } from '@/components/ui/Panel';
import { SentimentTrendTable } from '@/components/summary/SentimentTrendTable';
import { SentimentTrendChart } from '@/components/charts/SentimentTrendChart';
import { FinancialsTable } from '@/components/summary/FinancialsTable';
import { PriceReactionTable } from '@/components/summary/PriceReactionTable';
import { TopicTrends } from '@/components/summary/TopicTrends';
import { WhatChanged } from '@/components/summary/WhatChanged';
import { KeyQuotes } from '@/components/summary/KeyQuotes';
import { ErrorPanel } from '@/components/ErrorPanel';
import { AppError, isValidTicker, normalizeTicker } from '@/lib/types';
import { INITIAL_ANALYSIS_QUARTERS } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: { ticker: string } }) {
  return { title: `${normalizeTicker(params.ticker)} — Earnings Intelligence` };
}

/**
 * Company summary dashboard.
 *
 * A server component that reads only cached analyses; it never triggers model
 * work. When nothing has been analyzed yet it renders the ingestion runner,
 * which drives the pipeline and refreshes this page on completion.
 */
export default async function CompanyPage({ params }: { params: { ticker: string } }) {
  const ticker = normalizeTicker(params.ticker);
  if (!isValidTicker(ticker)) notFound();

  let view: Awaited<ReturnType<typeof loadCompanyView>>;
  try {
    view = await loadCompanyView(ticker);
  } catch (error) {
    if (error instanceof AppError && error.code === 'company_not_found') notFound();
    return <ErrorPanel ticker={ticker} error={error} />;
  }

  const { summary, needsIngest, pendingQuarters } = view;
  const { company, quarters, topicTrends, whatChanged, keyQuotes } = summary;
  const analyzedCount = quarters.filter((q) => q.analyzed).length;

  return (
    <>
      <CompanyHeader company={company} />
      <QuarterTabs ticker={ticker} quarters={quarters} active="summary" />

      <main className="mx-auto max-w-[1400px] space-y-4 px-5 py-5">
        {needsIngest ? (
          <Panel>
            <EmptyState
              title={`${company.companyName} has not been analyzed yet`}
              detail={`Retrieve the latest ${INITIAL_ANALYSIS_QUARTERS} earnings call transcripts, financial results, and price history, then analyze each call. Results are cached, so this runs once.`}
              action={
                <div className="flex justify-center">
                  <AnalyzeRunner ticker={ticker} quarters={INITIAL_ANALYSIS_QUARTERS} />
                </div>
              }
            />
          </Panel>
        ) : (
          <>
            {pendingQuarters > 0 && (
              <Panel>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-ink-secondary">
                    {pendingQuarters} quarter{pendingQuarters === 1 ? '' : 's'} retrieved but not
                    yet analyzed.
                  </p>
                  <AnalyzeRunner
                    ticker={ticker}
                    quarters={Math.max(pendingQuarters, INITIAL_ANALYSIS_QUARTERS)}
                    label="Analyze remaining quarters"
                  />
                </div>
              </Panel>
            )}

            {/* 1 — Sentiment trend */}
            <Panel
              title="Sentiment trend"
              note="Newest first · 0–100 · momentum, not a rating"
              bodyClassName=""
            >
              <SentimentTrendTable ticker={ticker} quarters={quarters} />
            </Panel>

            {/* 2 — Sentiment over time */}
            <Panel title="Sentiment over time" note="Overall, management, and Q&A">
              <SentimentTrendChart quarters={quarters} />
            </Panel>

            {/* 6 — What changed. Placed high: it is the product's core answer. */}
            <Panel
              title="What changed?"
              note={
                analyzedCount >= 2
                  ? `${quarters.find((q) => q.analyzed)?.label ?? ''} versus prior quarters`
                  : 'Requires at least two analyzed quarters'
              }
              bodyClassName=""
            >
              <WhatChanged data={whatChanged} />
            </Panel>

            {/* 5 — Topic trends */}
            <Panel title="Topic trends" note="Sentiment and mention count by quarter" bodyClassName="">
              <TopicTrends trends={topicTrends} quarters={quarters} />
            </Panel>

            {/* 3 — Financial results */}
            <Panel title="Financial results" note="As reported" bodyClassName="">
              <FinancialsTable quarters={quarters} />
            </Panel>

            {/* 4 — Price reaction */}
            <Panel
              title="Historical market reaction"
              note="Context only — not attributable to sentiment"
              bodyClassName=""
            >
              <PriceReactionTable quarters={quarters} />
            </Panel>

            {/* 7 — Key quotes */}
            <Panel
              title="Key management quotes"
              note="Verified verbatim against the transcript"
              bodyClassName=""
            >
              <KeyQuotes ticker={ticker} quotes={keyQuotes} />
            </Panel>
          </>
        )}

        <footer className="pt-2 text-2xs text-ink-muted">
          Sentiment scores are research heuristics derived from call language, not predictions of
          price.{' '}
          <Link href="/methodology" className="underline underline-offset-2 hover:text-ink">
            Read the methodology
          </Link>
          .
        </footer>
      </main>
    </>
  );
}
