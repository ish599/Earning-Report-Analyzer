'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isValidTicker, normalizeTicker, type TickerSearchResult } from '@/lib/types';

/**
 * Company search with autocomplete.
 *
 * Validates the ticker shape before navigating so an obviously malformed entry
 * produces an immediate inline message rather than a round trip and an error
 * page.
 */
export function SearchBar({
  size = 'default',
  autoFocus = false,
  placeholder = 'Search ticker — AAPL, NET, DDOG, INGN…',
}: {
  size?: 'default' | 'large';
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TickerSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced autocomplete. The abort controller prevents an earlier, slower
  // response from overwriting the results for a newer query.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const body = (await response.json()) as { data?: TickerSearchResult[] };
        setResults(body.data ?? []);
        setOpen(true);
      } catch {
        // Autocomplete is optional; typing a full ticker still works.
      }
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function go(rawTicker: string) {
    const ticker = normalizeTicker(rawTicker);

    if (!ticker) {
      setError('Enter a ticker symbol.');
      return;
    }
    if (!isValidTicker(ticker)) {
      setError(`"${rawTicker}" is not a valid ticker symbol.`);
      return;
    }

    setError(null);
    setPending(true);
    setOpen(false);
    router.push(`/company/${ticker}`);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setHighlighted((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((i) => Math.max(i - 1, -1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(highlighted >= 0 && results[highlighted] ? results[highlighted].ticker : query);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  const large = size === 'large';

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="flex gap-2">
        <input
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setError(null);
            setHighlighted(-1);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder={placeholder}
          aria-label="Search for a company by ticker"
          autoComplete="off"
          spellCheck={false}
          className={`input ${large ? 'py-3 text-base' : ''}`}
        />
        <button
          type="button"
          onClick={() => go(query)}
          disabled={pending}
          className={`btn btn-primary shrink-0 ${large ? 'px-5 py-3' : ''}`}
        >
          {pending ? 'Loading…' : 'Analyze'}
        </button>
      </div>

      {error && <p className="mt-1.5 text-xs text-negative">{error}</p>}

      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-auto border border-line-strong bg-surface shadow-pop scrollbar-thin">
          {results.map((result, index) => (
            <li key={`${result.ticker}-${index}`}>
              <button
                type="button"
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => go(result.ticker)}
                className={`flex w-full items-baseline gap-3 border-b border-line px-3 py-2 text-left last:border-b-0 ${
                  index === highlighted ? 'bg-accent-soft' : 'hover:bg-raised'
                }`}
              >
                <span className="w-16 shrink-0 font-mono text-sm font-semibold">
                  {result.ticker}
                </span>
                <span className="truncate text-sm text-ink-secondary">{result.companyName}</span>
                {result.exchange && (
                  <span className="ml-auto shrink-0 text-2xs text-ink-muted">
                    {result.exchange}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
