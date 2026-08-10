import { loadCallDetail } from '@/lib/analysis/read';
import { handle, ok } from '@/lib/api/respond';

/**
 * GET /api/company/[ticker]/call/[callId]
 *
 * Full detail for one call, including transcript text and segmentation.
 */
export async function GET(
  _request: Request,
  { params }: { params: { ticker: string; callId: string } },
) {
  return handle(async () => ok(await loadCallDetail(params.callId)));
}
