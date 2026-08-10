import { getCompany } from '@/lib/providers/company';
import { handle, ok } from '@/lib/api/respond';

/** GET /api/company/[ticker] — resolve company metadata and current quote. */
export async function GET(_request: Request, { params }: { params: { ticker: string } }) {
  return handle(async () => ok(await getCompany(params.ticker)));
}
