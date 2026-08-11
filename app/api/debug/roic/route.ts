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
      const available = await roic.getAvailableCalls(symbol).catch((e) => {
        return { error: e instanceof Error ? e.message : String(e) } as any;
      });

      out.available = Array.isArray(available) ? { success: true, count: available.length } : { success: false, error: available?.error ?? 'unknown' };

      if (Array.isArray(available) && available.length > 0) {
        const latest = available[0];
        out.latest = { year: latest.fiscalYear, quarter: latest.fiscalQuarter, callDate: latest.callDate };

        const transcript = await roic.getTranscript(symbol, latest.fiscalYear, latest.fiscalQuarter).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
        if (transcript && !('error' in transcript)) {
          out.latest.success = true;
          out.latest.characters = transcript.text.length;
        } else {
          out.latest.success = false;
          out.latest.error = transcript?.error ?? 'fetch_failed';
        }
      }

      return ok(out);
    } catch (e) {
      return ok({ configured: true, error: e instanceof Error ? e.message : String(e) });
    }
  });
}
