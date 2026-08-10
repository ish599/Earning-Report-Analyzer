import { loadCompanyView } from '@/lib/analysis/read';
import { handle, ok } from '@/lib/api/respond';

/**
 * GET /api/company/[ticker]/summary
 *
 * Cross-quarter view: sentiment trend, topic trends, what changed, quotes.
 * Reads cached analyses only; it never invokes the model.
 */
export async function GET(_request: Request, { params }: { params: { ticker: string } }) {
  return handle(async () => ok(await loadCompanyView(params.ticker)));
}
