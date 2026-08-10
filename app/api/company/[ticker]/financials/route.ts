import { loadCompanyView } from '@/lib/analysis/read';
import { handle, ok } from '@/lib/api/respond';

/**
 * GET /api/company/[ticker]/financials
 *
 * Quarterly results and historical price reactions, newest first. Missing
 * figures are returned as null and rendered as em dashes; they are never
 * interpolated.
 */
export async function GET(_request: Request, { params }: { params: { ticker: string } }) {
  return handle(async () => {
    const view = await loadCompanyView(params.ticker);

    return ok(
      view.summary.quarters.map((q) => ({
        callId: q.callId,
        label: q.label,
        fiscalYear: q.fiscalYear,
        fiscalQuarter: q.fiscalQuarter,
        callDate: q.callDate,
        financials: q.financials,
        priceReaction: q.priceReaction,
      })),
    );
  });
}
