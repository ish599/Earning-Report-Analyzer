import Link from 'next/link';
import type { Metadata } from 'next';
import { SearchBar } from '@/components/SearchBar';
import { Panel } from '@/components/ui/Panel';
import { ANALYSIS_VERSION, INITIAL_ANALYSIS_QUARTERS, QOQ_LOOKBACK_QUARTERS } from '@/lib/config';
import { MOMENTUM_THRESHOLD, TOPIC_LABELS, TOPIC_KEYS } from '@/lib/types';

export const metadata: Metadata = {
  title: 'Methodology — Earnings Intelligence',
  description:
    'How Earnings Intelligence retrieves transcripts, scores management language, compares quarters, and calculates price reactions — and what it cannot do.',
};

/**
 * Methodology and limitations.
 *
 * This page exists because the product's credibility with a research analyst
 * rests on being explicit about what the number is and is not. Transparency is
 * more useful here than the appearance of precision.
 */
export default function MethodologyPage() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-6 px-5 py-2.5">
          <Link href="/" className="text-sm font-semibold tracking-tight text-ink">
            Earnings Intelligence
          </Link>
          <div className="w-full max-w-md">
            <SearchBar />
          </div>
          <span className="shrink-0 text-xs text-ink-muted">Methodology</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-5 py-8">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Methodology</h1>
          <p className="mt-2 text-base leading-relaxed text-ink-secondary">
            This product answers one question: what changed in management&rsquo;s language,
            outlook, and business commentary this quarter versus prior quarters? Everything below
            describes how that answer is produced, and where it should not be trusted.
          </p>
        </div>

        <Panel title="What this is not">
          <div className="prose-note">
            <p>
              This is a research tool. It is <strong>not</strong> a stock-price prediction system,
              and it does not issue investment advice.
            </p>
            <ul>
              <li>
                Scores describe <em>language</em>, not expected returns. No score is calibrated
                against realized performance, and none should be read as a forecast.
              </li>
              <li>
                The product never outputs a buy, sell, or hold rating. Directional language is
                limited to improving, stable, and deteriorating, which describe how commentary has
                changed — not what to do about it.
              </li>
              <li>
                Historical price reactions are shown as context. Nothing here claims that sentiment
                caused, predicted, or explains those moves.
              </li>
            </ul>
          </div>
        </Panel>

        <Panel title="Data sources">
          <div className="prose-note">
            <p>
              Company profiles, earnings-call transcripts, quarterly income statements, consensus
              EPS estimates, earnings release timing, and daily price history come from{' '}
              <strong>Financial Modeling Prep</strong>. Provider access sits behind an abstraction
              layer, so the vendor can be replaced without changing the analysis or the interface.
            </p>
            <p>
              Financial figures are shown exactly as reported by the provider. Where a figure is
              unavailable, the interface shows an em dash. Values are never interpolated, carried
              forward from an adjacent quarter, or estimated — a blank cell means the number was not
              reported, which is itself information.
            </p>
            <p>
              When no provider credentials are configured, the application falls back to a small
              offline sample so it remains navigable. That mode is labelled on the landing page, and
              its coverage is limited to a handful of stored transcripts.
            </p>
          </div>
        </Panel>

        <Panel title="Transcript processing">
          <div className="prose-note">
            <p>Each transcript is split before any analysis takes place:</p>
            <ul>
              <li>
                <strong>Prepared remarks</strong> versus <strong>analyst Q&amp;A</strong>, detected
                from section headings and the operator&rsquo;s hand-off language.
              </li>
              <li>
                <strong>Speaker turns</strong>, each attributed a role — CEO, CFO, other management,
                analyst, or operator — from the call&rsquo;s participant roster where one is
                published, and from titles appearing beside the speaker otherwise.
              </li>
            </ul>
            <p>
              This separation matters. Prepared remarks are scripted and Q&amp;A is not, so
              analyzing them together would blend a rehearsed narrative with unrehearsed answers and
              lose the difference between them. Where the two sections cannot be separated, the
              quarter page says so explicitly rather than presenting two scores that are not
              independent.
            </p>
            <p>
              Speaker attribution is heuristic. A speaker whose role cannot be determined is marked
              unknown rather than assumed to be management.
            </p>
          </div>
        </Panel>

        <Panel title="Sentiment methodology">
          <div className="prose-note">
            <p>
              <strong>
                The 0&ndash;100 score is a research heuristic, not a scientifically precise
                measurement.
              </strong>{' '}
              It is a large language model&rsquo;s structured judgement of call language, reported
              on a fixed scale so quarters can be compared against each other. It is not a
              probability, and the difference between, say, 62 and 65 is not meaningful.
            </p>
            <p>Six scores are produced for each call, all on the same 0&ndash;100 scale where 50 is neutral:</p>
            <ul>
              <li><strong>Overall sentiment</strong> — the call as an information event.</li>
              <li><strong>Management sentiment</strong> — prepared remarks only.</li>
              <li>
                <strong>Q&amp;A sentiment</strong> — the analyst exchange, weighing how directly
                questions were answered. Evasion and repeated non-answers lower this score even when
                the words are positive.
              </li>
              <li><strong>Management confidence</strong> — conviction and specificity, not enthusiasm.</li>
              <li><strong>Guidance tone</strong> — forward-looking commentary specifically.</li>
              <li><strong>Business momentum</strong> — the direction of the underlying business as described.</li>
            </ul>

            <h3>Why not keyword scoring</h3>
            <p>
              Generic positive/negative word lists are actively wrong on earnings calls, because
              financial language is contextual. The model is instructed to judge meaning rather than
              tone words:
            </p>
            <ul>
              <li>&ldquo;Lower expenses&rdquo; is typically favourable; &ldquo;lower revenue&rdquo; is not.</li>
              <li>
                &ldquo;Challenging comparison&rdquo; signals a difficult prior-year base — a caution
                about optics, not a deterioration in the business.
              </li>
              <li>
                &ldquo;We remain confident&rdquo; is evidence about management&rsquo;s tone, not
                about fundamentals, and does not by itself raise the business momentum score.
              </li>
              <li>
                Guidance that is withdrawn, widened, or newly caveated is treated as a substantive
                negative even when it is framed positively.
              </li>
            </ul>
            <p>
              Scores are recomputed into their classification band on our side, so the label and the
              number can never disagree. Bands are deliberately wide: 40&ndash;60 is neutral, and
              only calls above 75 or below 25 are treated as materially different from a normal
              quarter.
            </p>
          </div>
        </Panel>

        <Panel title="Quarter-over-quarter comparison">
          <div className="prose-note">
            <p>
              Quarters are analyzed oldest first, and each call is given the previous{' '}
              {QOQ_LOOKBACK_QUARTERS} analyzed quarters as context: their scores, topic-level
              readings, summaries, and key excerpts. That is what allows the model to identify a
              genuine change in language rather than restate the current quarter.
            </p>
            <p>
              The comparison looks for new themes, new risks, topics management has stopped
              discussing, shifts in caution, and changes in guidance, demand, pricing, and margin
              language. Each observation is required to be specific and falsifiable, and to carry a
              verbatim excerpt from the current transcript where one supports it.
            </p>
            <p>
              A quarter&rsquo;s momentum signal is derived from its change in overall score against
              the preceding quarter, with a {MOMENTUM_THRESHOLD}-point threshold. Smaller moves are
              reported as stable because they fall within the variance of model scoring and should
              not be presented to an analyst as a change.
            </p>
          </div>
        </Panel>

        <Panel title="Quotes and evidence">
          <div className="prose-note">
            <p>
              Every quote is checked against the stored transcript before it is saved. Excerpts that
              cannot be located verbatim — allowing only for differences in whitespace — are
              discarded rather than displayed. A quote shown in this product is text that genuinely
              appears in the transcript, attributed to the speaker our segmentation identified.
            </p>
            <p>
              This is a guard against the most damaging failure mode available to a tool like this:
              a fluent, plausible quotation that was never said. It also means a call may show fewer
              quotes than requested, which is the correct outcome.
            </p>
          </div>
        </Panel>

        <Panel title="Topics">
          <div className="prose-note">
            <p>
              The model considers {TOPIC_KEYS.length} categories and returns only those the
              transcript genuinely supports:
            </p>
            <p className="flex flex-wrap gap-1.5">
              {TOPIC_KEYS.map((key) => (
                <span key={key} className="chip chip-neutral">
                  {TOPIC_LABELS[key]}
                </span>
              ))}
            </p>
            <p>
              Not every company discusses every category, and a topic&rsquo;s absence is meaningful
              — particularly when management discussed it last quarter and has stopped. Gaps in the
              topic grid are left blank rather than interpolated.
            </p>
          </div>
        </Panel>

        <Panel title="Price reaction calculation">
          <div className="prose-note">
            <p>
              Returns are measured over 1, 5, 10, and 20 <strong>trading days</strong> — sessions
              present in the price series, so weekends and holidays are handled implicitly — using
              adjusted closes, so splits and dividends do not appear as reactions.
            </p>
            <p>
              The baseline (t=0) is the last close that does not yet reflect the release:
            </p>
            <ul>
              <li>
                <strong>Before market open</strong> — the call date&rsquo;s own session is the
                reaction, so the baseline is the prior trading day.
              </li>
              <li>
                <strong>After market close</strong> — the call date&rsquo;s close is still clean, so
                it is the baseline.
              </li>
              <li>
                <strong>Timing unavailable</strong> — where the provider does not report release
                timing, an after-close release is assumed and the row is labelled{' '}
                <em>Assumed</em>. That window may be shifted by one session. We label the
                assumption rather than presenting the figure as exact.
              </li>
            </ul>
          </div>
        </Panel>

        <Panel title="Caching and cost">
          <div className="prose-note">
            <p>
              Transcripts are immutable once published, and analysis is expensive, so results are
              stored and reused. An analysis is keyed by the call and an analysis version
              (currently <code className="font-mono text-xs">{ANALYSIS_VERSION}</code>). A page load
              never triggers model work; only an explicit analysis request does.
            </p>
            <p>
              The first visit to a ticker analyzes the most recent {INITIAL_ANALYSIS_QUARTERS}{' '}
              quarters, one at a time, with progress shown. Older calls are analyzed on demand. When
              the analysis version changes, prior results are retained and new ones are produced
              alongside them, so historical work is never destroyed.
            </p>
          </div>
        </Panel>

        <Panel title="Limitations">
          <div className="prose-note">
            <ul>
              <li>
                <strong>The score is a heuristic.</strong> It reflects one model&rsquo;s reading of
                one transcript. Re-running an analysis can move a score by a few points; treat small
                differences as noise.
              </li>
              <li>
                <strong>Language is not fundamentals.</strong> Management can describe a
                deteriorating business confidently and an improving one cautiously. The scores
                attempt to separate substance from delivery, but they cannot do so perfectly.
              </li>
              <li>
                <strong>Transcripts contain errors.</strong> Vendor transcripts include
                mistranscriptions and formatting artifacts, and speaker attribution is inferred.
              </li>
              <li>
                <strong>Coverage is uneven.</strong> Transcripts, consensus estimates, and release
                timing are less complete for smaller companies.
              </li>
              <li>
                <strong>Fiscal calendars complicate alignment.</strong> Financial results are matched
                to calls on the provider&rsquo;s fiscal labelling. Companies with unusual fiscal
                years or restated periods may misalign.
              </li>
              <li>
                <strong>No adjustment for expectations.</strong> The analysis reads the call in
                isolation. It does not know what the market expected going in, which is usually the
                dominant driver of the reaction.
              </li>
              <li>
                <strong>Quarter-over-quarter comparison depends on prior analysis.</strong> The
                earliest analyzed quarter has no comparison, and a failed quarter leaves a gap in the
                chain.
              </li>
            </ul>
          </div>
        </Panel>

        <footer className="pt-2 text-2xs text-ink-muted">
          Earnings Intelligence is a research tool. It does not provide investment advice, and
          nothing it produces should be treated as a recommendation to buy or sell any security.
        </footer>
      </main>
    </div>
  );
}
