import Link from 'next/link';
import { ScoreCell, SignalChip, ClassificationChip } from '@/components/ui/Indicators';
import { formatDate } from '@/lib/format';
import type { QuarterSummaryRow } from '@/lib/types';

/**
 * Quarter-by-quarter sentiment, newest first.
 *
 * This table is also the accessibility relief channel for the trend chart:
 * every plotted figure is available here as text, which is what licenses the
 * aqua series colour despite its sub-3:1 contrast.
 *
 * The rightmost column is a momentum signal, never a buy/sell label.
 */
export function SentimentTrendTable({
  ticker,
  quarters,
}: {
  ticker: string;
  quarters: QuarterSummaryRow[];
}) {
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="data-table">
        <thead>
          <tr>
            <th>Quarter</th>
            <th>Call date</th>
            <th className="num">Overall</th>
            <th className="num">Management</th>
            <th className="num">Q&amp;A</th>
            <th>Classification</th>
            <th>Momentum</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {quarters.map((q) => (
            <tr key={q.callId}>
              <td className="font-medium whitespace-nowrap">{q.label}</td>
              <td className="whitespace-nowrap text-ink-secondary">{formatDate(q.callDate)}</td>
              <td className="num">
                <ScoreCell value={q.overallSentiment} />
              </td>
              <td className="num">
                <ScoreCell value={q.managementSentiment} />
              </td>
              <td className="num">
                <ScoreCell value={q.qaSentiment} />
              </td>
              <td>
                <ClassificationChip value={q.classification} />
              </td>
              <td>{q.analyzed ? <SignalChip value={q.momentum} /> : null}</td>
              <td className="num">
                <Link
                  href={`/company/${ticker}/q/${q.fiscalYear}-${q.fiscalQuarter}`}
                  className="text-xs text-accent underline-offset-2 hover:underline"
                >
                  Detail
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
