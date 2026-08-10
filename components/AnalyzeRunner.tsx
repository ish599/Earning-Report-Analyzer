'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Drives ingestion, one quarter per request, and renders progress.
 *
 * The server analyzes a single quarter per call so no request approaches a
 * serverless execution limit. This component loops until the server reports
 * `done`, which is also what keeps the user informed instead of staring at a
 * blank screen for several minutes.
 *
 * Per-quarter failures do not abort the run: the server advances the counter
 * and reports the error, and we collect it for display alongside whatever
 * did succeed.
 */

interface StepResponse {
  analyzed: string | null;
  completed: number;
  total: number;
  done: boolean;
  error: { period: string; message: string } | null;
  warnings?: { period: string; message: string }[];
}

const STAGES = [
  'Resolving company…',
  'Retrieving earnings call transcripts…',
  'Retrieving financial results and price history…',
];

export function AnalyzeRunner({
  ticker,
  quarters = 4,
  autoStart = false,
  label = 'Analyze latest earnings calls',
}: {
  ticker: string;
  quarters?: number;
  autoStart?: boolean;
  label?: string;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [stage, setStage] = useState<string>(STAGES[0]);
  const [issues, setIssues] = useState<{ period: string; message: string }[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => () => { cancelled.current = true; }, []);

  const run = useCallback(async () => {
    if (running) return;

    setRunning(true);
    setFatal(null);
    setIssues([]);
    setProgress(null);
    setStage(STAGES[0]);

    // Advance the preparatory stage labels while the first request is in
    // flight; after that, real per-quarter progress takes over.
    let stageIndex = 0;
    const ticker_ = setInterval(() => {
      stageIndex = Math.min(stageIndex + 1, STAGES.length - 1);
      setStage(STAGES[stageIndex]);
    }, 2500);

    const collected: { period: string; message: string }[] = [];

    try {
      // Bounded so a server that never reports `done` cannot loop forever.
      for (let attempt = 0; attempt < quarters + 2; attempt += 1) {
        const response = await fetch(`/api/company/${ticker}/analyze`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ quarters }),
        });

        if (cancelled.current) return;

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          setFatal(body?.error?.message ?? 'Analysis failed. Please try again.');
          return;
        }

        const { data } = (await response.json()) as { data: StepResponse };

        clearInterval(ticker_);
        setProgress({ completed: data.completed, total: data.total });
        setStage(
          data.analyzed
            ? `Analyzed ${data.analyzed}`
            : data.done
              ? 'Finalizing…'
              : 'Analyzing…',
        );

        for (const warning of data.warnings ?? []) collected.push(warning);
        if (data.error) collected.push(data.error);
        setIssues([...collected]);

        if (data.done) break;
      }

      if (!cancelled.current) {
        setStage('Complete');
        // Server components hold the analysis; refresh re-renders them with
        // the newly stored results.
        router.refresh();
      }
    } catch {
      if (!cancelled.current) setFatal('Could not reach the server. Please try again.');
    } finally {
      clearInterval(ticker_);
      if (!cancelled.current) setRunning(false);
    }
  }, [running, quarters, ticker, router]);

  useEffect(() => {
    if (autoStart) void run();
    // Intentionally runs once on mount; `run` is stable enough for this use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  const pct =
    progress && progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : null;

  if (!running && !progress && !fatal) {
    return (
      <button type="button" onClick={run} className="btn btn-primary">
        {label}
      </button>
    );
  }

  return (
    <div className="w-full max-w-lg text-left">
      {running && (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium text-ink">{stage}</p>
            {progress && (
              <span className="text-xs tabular-nums text-ink-muted">
                {progress.completed} / {progress.total}
              </span>
            )}
          </div>
          <div
            className="mt-2 h-1 w-full bg-raised"
            role="progressbar"
            aria-valuenow={pct ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full bg-accent transition-[width] duration-500"
              style={{ width: pct == null ? '15%' : `${Math.max(pct, 5)}%` }}
            />
          </div>
          <p className="mt-2 text-2xs text-ink-muted">
            Each quarter is analyzed separately and cached. This runs once per quarter — later
            visits load instantly.
          </p>
        </>
      )}

      {fatal && (
        <div className="border border-negative/30 bg-negative-soft px-3 py-2">
          <p className="text-sm text-negative">{fatal}</p>
          <button type="button" onClick={run} className="btn btn-secondary mt-2">
            Try again
          </button>
        </div>
      )}

      {!running && !fatal && progress && (
        <p className="text-sm text-ink-secondary">
          Analyzed {progress.completed} of {progress.total} quarters.
        </p>
      )}

      {issues.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-line pt-2">
          {issues.map((issue, i) => (
            <li key={`${issue.period}-${i}`} className="text-2xs text-ink-muted">
              <span className="font-medium text-caution">{issue.period}:</span> {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
