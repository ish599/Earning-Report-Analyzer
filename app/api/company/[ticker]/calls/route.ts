import { getTranscriptDates } from '@/lib/providers/transcripts';
import { loadCompanyView } from '@/lib/analysis/read';
import { handle, ok } from '@/lib/api/respond';
import { compareQuartersDesc, quarterLabel } from '@/lib/types';

/**
 * GET /api/company/[ticker]/calls
 *
 * Every call the provider knows about, marked with whether we hold a
 * transcript and an analysis for it. Drives the quarter tabs and the
 * "load older quarter" affordance.
 */
export async function GET(_request: Request, { params }: { params: { ticker: string } }) {
  return handle(async () => {
    const [view, available] = await Promise.all([
      loadCompanyView(params.ticker),
      getTranscriptDates(params.ticker).catch(() => []),
    ]);

    const stored = new Map(
      view.summary.quarters.map((q) => [`${q.fiscalYear}-${q.fiscalQuarter}`, q]),
    );

    const merged = available.map((ref) => {
      const match = stored.get(`${ref.fiscalYear}-${ref.fiscalQuarter}`);
      return {
        fiscalYear: ref.fiscalYear,
        fiscalQuarter: ref.fiscalQuarter,
        label: quarterLabel(ref),
        callDate: match?.callDate ?? ref.callDate,
        callId: match?.callId ?? null,
        analyzed: match?.analyzed ?? false,
      };
    });

    // Include anything stored that the provider no longer lists.
    for (const quarter of view.summary.quarters) {
      const key = `${quarter.fiscalYear}-${quarter.fiscalQuarter}`;
      if (!available.some((r) => `${r.fiscalYear}-${r.fiscalQuarter}` === key)) {
        merged.push({
          fiscalYear: quarter.fiscalYear,
          fiscalQuarter: quarter.fiscalQuarter,
          label: quarter.label,
          callDate: quarter.callDate,
          callId: quarter.callId,
          analyzed: quarter.analyzed,
        });
      }
    }

    return ok(merged.sort(compareQuartersDesc));
  });
}
