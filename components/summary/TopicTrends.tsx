import { Sparkline } from '@/components/charts/Sparkline';
import { DirectionChip } from '@/components/ui/Indicators';
import { scoreClass } from '@/lib/format';
import { TOPIC_LABELS, type QuarterSummaryRow, type TopicTrend } from '@/lib/types';

/**
 * Topic sentiment and mention counts by quarter.
 *
 * Rendered as a numeric grid rather than a colour heatmap: sentiment and
 * mention count are two different measures, and encoding one as a colour ramp
 * behind the other invites reading a relationship that is not there. Each cell
 * carries the score with the mention count beneath it, so both are exact.
 *
 * A blank cell means management did not discuss the topic that quarter — which
 * is itself a finding, and why nothing is interpolated across gaps.
 */
export function TopicTrends({
  trends,
  quarters,
}: {
  trends: TopicTrend[];
  quarters: QuarterSummaryRow[];
}) {
  const analyzed = quarters.filter((q) => q.analyzed);

  if (trends.length === 0 || analyzed.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-ink-muted">
        Topic trends appear once at least one quarter has been analyzed.
      </p>
    );
  }

  // Newest first, matching every other table on the page.
  const columns = analyzed.map((q) => ({
    key: `${q.fiscalYear}-${q.fiscalQuarter}`,
    label: q.label,
  }));

  return (
    <div>
      <div className="overflow-x-auto scrollbar-thin">
        <table className="data-table">
          <thead>
            <tr>
              <th className="min-w-[150px]">Topic</th>
              <th className="w-20">Trend</th>
              <th>Direction</th>
              {columns.map((c) => (
                <th key={c.key} className="num whitespace-nowrap">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trends.map((trend) => {
              const byQuarter = new Map(
                trend.points.map((p) => [`${p.fiscalYear}-${p.fiscalQuarter}`, p]),
              );
              // Sparkline reads oldest to newest.
              const series = trend.points.map((p) => p.sentimentScore);
              const latest = trend.points[trend.points.length - 1];

              return (
                <tr key={trend.topic}>
                  <td className="font-medium">{TOPIC_LABELS[trend.topic] ?? trend.topic}</td>
                  <td>
                    <Sparkline values={series} />
                  </td>
                  <td>{latest && <DirectionChip value={latest.direction} />}</td>
                  {columns.map((c) => {
                    const point = byQuarter.get(c.key);
                    return (
                      <td key={c.key} className="num">
                        {point ? (
                          <span className="inline-flex flex-col items-end leading-tight">
                            <span className={`font-medium ${scoreClass(point.sentimentScore)}`}>
                              {point.sentimentScore.toFixed(0)}
                            </span>
                            <span className="text-2xs text-ink-muted">
                              {point.mentionCount}
                              <span className="ml-0.5">mentions</span>
                            </span>
                          </span>
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-4 py-2.5 text-2xs text-ink-muted">
        Each cell shows topic sentiment (0–100) above the number of times the topic was raised. A
        blank cell means the topic was not discussed that quarter.
      </p>
    </div>
  );
}
