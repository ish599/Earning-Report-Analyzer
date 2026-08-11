import 'server-only';
import { handle, ok } from '@/lib/api/respond';
import { isRoicConfigured } from '@/lib/config';
import * as roic from '@/lib/providers/roicTranscripts';

export async function GET(request: Request) {
  return handle(async () => {
    const url = new URL(request.url);
    const symbol = (url.searchParams.get('symbol') || 'AAPL').toUpperCase();

    const out: any = { configured: isRoicConfigured() };
    if (!isRoicConfigured()) return ok(out);

    try {
      // First, test the latest transcript endpoint (v2). This is the MVP
      // critical check; a failure here should not be masked by optional
      // listing failures.
      const latestResult = await roic.getLatestTranscript(symbol)
        .then((t) => ({ ok: true, status: 200, ticker: t.ticker, year: t.fiscalYear, quarter: t.fiscalQuarter, characters: t.text.length }))
        .catch((e) => {
          if (e instanceof Error && (e as any).status) {
            return { ok: false, status: (e as any).status, providerMessage: e instanceof Error ? e.message : String(e) };
          }
          return { ok: false, status: 500, providerMessage: e instanceof Error ? e.message : String(e) };
        });

      out.latest = latestResult;

      // Then, optionally test the available calls (v3) listing endpoint. If
      // it fails, report the failure but don't override the latest result.
      const available = await roic.getAvailableCalls(symbol).then((r) => ({ ok: true, status: 200, count: r.length }))
        .catch((e) => ({ ok: false, status: e instanceof Error && (e as any).status ? (e as any).status : 500, providerMessage: e instanceof Error ? e.message : String(e) }));

      out.availableCalls = available;

      return ok(out);
    } catch (e) {
      return ok({ configured: true, error: e instanceof Error ? e.message : String(e) });
    }
  });
}
