import Link from 'next/link';
import { SentimentChip } from '@/components/ui/Indicators';
import { TOPIC_LABELS, quarterLabel, type KeyQuote } from '@/lib/types';

type SummaryQuote = KeyQuote & { fiscalYear: number; fiscalQuarter: number; callId: string };

const ROLE_LABELS: Record<string, string> = {
  ceo: 'CEO',
  cfo: 'CFO',
  management: 'Management',
  analyst: 'Analyst',
  operator: 'Operator',
  unknown: '',
};

/**
 * Evidence supporting the analysis.
 *
 * Every quote displayed here was matched verbatim against the stored
 * transcript before being persisted; anything the model produced that could
 * not be located was discarded. Clicking through opens the quarter detail with
 * the excerpt anchored in the full transcript.
 */
export function KeyQuotes({ ticker, quotes }: { ticker: string; quotes: SummaryQuote[] }) {
  if (quotes.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-ink-muted">
        Key quotes appear once a quarter has been analyzed.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-line">
      {quotes.map((quote, index) => {
        const role = ROLE_LABELS[quote.speakerRole] ?? '';
        const period = quarterLabel(quote);

        return (
          <li key={`${quote.callId}-${index}`} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-semibold text-ink">{quote.speaker}</span>
              {role && <span className="text-xs text-ink-muted">{role}</span>}
              <span className="text-ink-muted">·</span>
              <Link
                href={`/company/${ticker}/q/${quote.fiscalYear}-${quote.fiscalQuarter}`}
                className="text-xs text-accent underline-offset-2 hover:underline"
              >
                {period}
              </Link>
              {quote.topic && (
                <span className="chip chip-neutral">
                  {TOPIC_LABELS[quote.topic] ?? quote.topic}
                </span>
              )}
              <SentimentChip value={quote.sentiment} />
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
