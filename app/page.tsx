import Link from 'next/link';
import { SearchBar } from '@/components/SearchBar';
import { isFmpConfigured, isGeminiConfigured, isSupabaseConfigured } from '@/lib/config';
import { fixtureTickers } from '@/lib/providers/fixtures';

/**
 * Landing page: search, positioning, and an honest statement of what the
 * product does not do.
 *
 * The configuration notice is deliberately visible. A research tool that
 * quietly runs on fixture data would misrepresent its own coverage.
 */
export default function HomePage() {
  const live = isFmpConfigured();
  const analysisReady = isGeminiConfigured();
  const persistent = isSupabaseConfigured();
  const examples = live ? ['AAPL', 'NET', 'DDOG', 'INGN', 'AMN'] : fixtureTickers();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-5 py-16">
      <div className="mb-10">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Earnings Intelligence</h1>
        <p className="mt-2 max-w-xl text-base leading-relaxed text-ink-secondary">
          What changed in management&rsquo;s language, outlook, and business commentary this
          quarter versus prior quarters?
        </p>
      </div>

      <SearchBar size="large" autoFocus />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-2xs uppercase tracking-[0.07em] text-ink-muted">Examples</span>
        {examples.map((ticker) => (
          <Link
            key={ticker}
            href={`/company/${ticker}`}
            className="chip chip-neutral font-mono hover:border-accent hover:text-accent"
          >
            {ticker}
          </Link>
        ))}
      </div>

      <div className="mt-12 grid gap-6 border-t border-line pt-8 sm:grid-cols-3">
        <Feature
          title="Quarter over quarter"
          body="Each call is compared against the previous four, surfacing new risks, abandoned themes, and shifts in guidance and demand language."
        />
        <Feature
          title="Evidence linked"
          body="Every claim links to a verbatim transcript excerpt. Quotes that cannot be matched to the transcript are discarded, not displayed."
        />
        <Feature
          title="Research, not ratings"
          body="Scores describe language, not expected returns. The product never issues buy or sell recommendations."
        />
      </div>

      {(!live || !analysisReady || !persistent) && (
        <div className="mt-8 border border-caution/30 bg-caution-soft px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-caution">
            Limited configuration
          </p>
          <ul className="mt-1.5 space-y-1 text-sm text-ink-secondary">
            {!live && (
              <li>
                No market data provider configured — coverage is limited to the offline sample
                ({fixtureTickers().join(', ')}). Set <code className="font-mono text-xs">FMP_API_KEY</code>{' '}
                for full coverage.
              </li>
            )}
            {!analysisReady && (
              <li>
                Transcript analysis is disabled. Set{' '}
                <code className="font-mono text-xs">GEMINI_API_KEY</code> to enable it.
              </li>
            )}
            {!persistent && (
              <li>
                No database configured — results are cached in memory and lost on restart. Set{' '}
                <code className="font-mono text-xs">SUPABASE_URL</code> and{' '}
                <code className="font-mono text-xs">SUPABASE_SECRET_KEY</code> to persist them.
              </li>
            )}
          </ul>
        </div>
      )}

      <footer className="mt-10 border-t border-line pt-4 text-xs text-ink-muted">
        <Link href="/methodology" className="underline underline-offset-2 hover:text-ink">
          Methodology and limitations
        </Link>
        <span className="mx-2">·</span>
        Sentiment scores are research heuristics, not predictions of price.
      </footer>
    </main>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-[0.06em] text-ink">{title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">{body}</p>
    </div>
  );
}
