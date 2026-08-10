import type { ReactNode } from 'react';

/**
 * Bordered content panel — the single structural unit of the dashboard.
 *
 * Every section is a Panel so the page reads as a ruled research note rather
 * than a stack of floating cards.
 */

export function Panel({
  title,
  note,
  actions,
  children,
  bodyClassName = '',
  className = '',
}: {
  title?: string;
  note?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  bodyClassName?: string;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || actions) && (
        <header className="panel-header">
          <div className="flex items-baseline gap-2.5">
            {title && <h2 className="panel-title">{title}</h2>}
            {note && <span className="panel-note">{note}</span>}
          </div>
          {actions}
        </header>
      )}
      <div className={bodyClassName || 'panel-body'}>{children}</div>
    </section>
  );
}

/** Label/value pair used across the company header and metric strips. */
export function Stat({
  label,
  value,
  hint,
  valueClassName = '',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="field-label">{label}</div>
      <div className={`mt-0.5 truncate text-base font-semibold tabular-nums ${valueClassName}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-2xs text-ink-muted">{hint}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-base font-medium text-ink">{title}</p>
      {detail && <p className="mx-auto mt-1.5 max-w-lg text-sm text-ink-muted">{detail}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
