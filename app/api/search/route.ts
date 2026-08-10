import { searchTickers } from '@/lib/providers/company';
import { handle, ok } from '@/lib/api/respond';

// Reads the query string, so it can never be prerendered.
export const dynamic = 'force-dynamic';

/** GET /api/search?q= — ticker autocomplete. */
export async function GET(request: Request) {
  return handle(async () => {
    const query = new URL(request.url).searchParams.get('q') ?? '';
    return ok(await searchTickers(query));
  });
}
