import type { ChangeItem, WhatChanged as WhatChangedData } from '@/lib/types';

/**
 * The "What Changed?" panel — the product's headline answer.
 *
 * Four buckets, each traced to the latest analyzed quarter's comparison
 * against the one before it. Where the model supplied a verbatim excerpt that
 * was verified against the transcript, it is shown beneath the claim, because
 * an assertion an analyst cannot check is not research.
 */
export function WhatChanged({ data }: { data: WhatChangedData }) {
  const groups = [
    { key: 'improving', title: 'Improving', items: data.improving, tone: 'positive' },
    { key: 'deteriorating', title: 'Deteriorating', items: data.deteriorating, tone: 'negative' },
    { key: 'newRisks', title: 'New risks', items: data.newRisks, tone: 'caution' },
    { key: 'newPositives', title: 'New positives', items: data.newPositives, tone: 'positive' },
  ] as const;

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  if (total === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-ink-muted">
        No material changes were identified, or fewer than two quarters have been analyzed.
      </p>
    );
  }

  return (
    <div className="grid divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
      {groups.map((group, index) => (
        <div
          key={group.key}
          className={`px-4 py-3 ${index >= 2 ? 'md:border-t md:border-line' : ''}`}
        >
          <h3
            className={`text-2xs font-semibold uppercase tracking-[0.08em] ${
              group.tone === 'positive'
                ? 'text-positive'
                : group.tone === 'negative'
                  ? 'text-negative'
                  : 'text-caution'
            }`}
          >
            {group.title}
            <span className="ml-1.5 font-normal text-ink-muted">({group.items.length})</span>
          </h3>

          {group.items.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">None identified.</p>
          ) : (
            <ul className="mt-2 space-y-2.5">
              {group.items.map((item, i) => (
                <ChangeEntry key={`${group.key}-${i}`} item={item} />
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function ChangeEntry({ item }: { item: ChangeItem }) {
  return (
    <li>
      <p className="text-sm font-medium leading-snug text-ink">{item.label}</p>
      {item.detail && item.detail !== item.label && (
        <p className="mt-0.5 text-sm leading-snug text-ink-secondary">{item.detail}</p>
      )}
      {item.evidence && (
        <blockquote className="quote-text mt-1.5 text-xs leading-relaxed">
          &ldquo;{item.evidence}&rdquo;
        </blockquote>
      )}
    </li>
  );
}
