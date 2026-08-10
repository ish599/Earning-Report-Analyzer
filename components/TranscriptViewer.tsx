'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SpeakerRole, TranscriptTurn } from '@/lib/types';

/**
 * Full transcript with search and quote anchoring.
 *
 * Turns render at full height rather than inside a scroll box so that native
 * `#turn-n` anchors work: a key quote elsewhere on the page links straight to
 * the passage it came from, and the browser handles the scroll.
 *
 * Search highlights and steps through matches rather than filtering turns out.
 * Filtering would strip the surrounding exchange, and on an earnings call the
 * context around a phrase is usually the point.
 */

const ROLE_STYLES: Record<SpeakerRole, string> = {
  ceo: 'chip-accent',
  cfo: 'chip-accent',
  management: 'chip-neutral',
  analyst: 'chip-caution',
  operator: 'chip-neutral',
  unknown: 'chip-neutral',
};

const ROLE_LABELS: Record<SpeakerRole, string> = {
  ceo: 'CEO',
  cfo: 'CFO',
  management: 'Mgmt',
  analyst: 'Analyst',
  operator: 'Operator',
  unknown: '—',
};

export function TranscriptViewer({ turns }: { turns: TranscriptTurn[] }) {
  const [query, setQuery] = useState('');
  const [activeMatch, setActiveMatch] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const needle = query.trim().toLowerCase();

  // Match positions as [turnIndex, occurrenceWithinTurn] so navigation can
  // target a specific highlighted span.
  const matches = useMemo(() => {
    if (needle.length < 2) return [];
    const found: { turn: number; occurrence: number }[] = [];

    turns.forEach((turn, turnIndex) => {
      const haystack = turn.text.toLowerCase();
      let from = 0;
      let occurrence = 0;
      for (;;) {
        const at = haystack.indexOf(needle, from);
        if (at === -1) break;
        found.push({ turn: turnIndex, occurrence });
        occurrence += 1;
        from = at + needle.length;
      }
    });

    return found;
  }, [needle, turns]);

  useEffect(() => setActiveMatch(0), [needle]);

  useEffect(() => {
    if (matches.length === 0) return;
    const target = matches[activeMatch];
    if (!target) return;

    const element = containerRef.current?.querySelector(
      `[data-match="${target.turn}-${target.occurrence}"]`,
    );
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeMatch, matches]);

  function step(delta: number) {
    if (matches.length === 0) return;
    setActiveMatch((i) => (i + delta + matches.length) % matches.length);
  }

  return (
    <div>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              step(e.shiftKey ? -1 : 1);
            }
          }}
          placeholder="Search the transcript…"
          aria-label="Search the transcript"
          className="input max-w-xs py-1.5 text-sm"
        />

        {needle.length >= 2 && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs tabular-nums text-ink-muted">
              {matches.length === 0
                ? 'No matches'
                : `${activeMatch + 1} of ${matches.length}`}
            </span>
            <button
              type="button"
              onClick={() => step(-1)}
              disabled={matches.length === 0}
              className="btn btn-secondary px-2 py-1 text-xs"
              aria-label="Previous match"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              disabled={matches.length === 0}
              className="btn btn-secondary px-2 py-1 text-xs"
              aria-label="Next match"
            >
              ↓
            </button>
          </div>
        )}

        <span className="ml-auto text-2xs text-ink-muted">
          {turns.length} turns · speaker roles are inferred
        </span>
      </div>

      <div ref={containerRef} className="divide-y divide-line">
        {turns.map((turn, turnIndex) => (
          <article
            key={turn.index}
            id={`turn-${turn.index}`}
            className="scroll-mt-16 px-4 py-3 target:bg-caution-soft"
          >
            <header className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-semibold text-ink">{turn.speaker}</span>
              <span className={`chip ${ROLE_STYLES[turn.role]}`}>{ROLE_LABELS[turn.role]}</span>
              {turn.affiliation && (
                <span className="text-2xs text-ink-muted">{turn.affiliation}</span>
              )}
              <span className="ml-auto text-2xs uppercase tracking-[0.06em] text-ink-muted">
                {turn.section === 'qa' ? 'Q&A' : 'Prepared'}
              </span>
            </header>

            <div className="whitespace-pre-wrap text-base leading-relaxed text-ink-secondary">
              <Highlighted
                text={turn.text}
                needle={needle}
                turnIndex={turnIndex}
                activeKey={
                  matches[activeMatch]
                    ? `${matches[activeMatch].turn}-${matches[activeMatch].occurrence}`
                    : null
                }
              />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/** Wraps each occurrence of `needle` in a <mark>, tagging it for navigation. */
function Highlighted({
  text,
  needle,
  turnIndex,
  activeKey,
}: {
  text: string;
  needle: string;
  turnIndex: number;
  activeKey: string | null;
}) {
  if (needle.length < 2) return <>{text}</>;

  const haystack = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let occurrence = 0;

  for (;;) {
    const at = haystack.indexOf(needle, cursor);
    if (at === -1) break;

    if (at > cursor) parts.push(text.slice(cursor, at));

    const key = `${turnIndex}-${occurrence}`;
    parts.push(
      <mark
        key={key}
        data-match={key}
        className={
          key === activeKey
            ? 'bg-caution text-white'
            : 'bg-caution-soft text-ink'
        }
      >
        {text.slice(at, at + needle.length)}
      </mark>,
    );

    cursor = at + needle.length;
    occurrence += 1;
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}
