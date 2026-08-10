import { analyzeNextPending, prepareCompany } from '@/lib/analysis/pipeline';
import { handle, ok } from '@/lib/api/respond';
import { INITIAL_ANALYSIS_QUARTERS } from '@/lib/config';

/**
 * POST /api/company/[ticker]/analyze
 *
 * Advances ingestion by ONE quarter and returns progress. The client calls
 * this in a loop until `done`, rendering each step.
 *
 * Analyzing all four quarters in a single request would take several minutes
 * and exceed any serverless execution limit, so the work is deliberately
 * chunked rather than streamed from one long-running invocation.
 *
 * Body (all optional):
 *   quarters       number  how many recent quarters to cover (default 4)
 *   fiscalYear     number  analyze one specific quarter instead
 *   fiscalQuarter  number
 *   force          bool    re-analyze even when cached
 */
export const maxDuration = 300;

interface AnalyzeBody {
  quarters?: number;
  fiscalYear?: number;
  fiscalQuarter?: number;
  force?: boolean;
}

export async function POST(request: Request, { params }: { params: { ticker: string } }) {
  return handle(async () => {
    const body = (await request.json().catch(() => ({}))) as AnalyzeBody;

    const only =
      typeof body.fiscalYear === 'number' && typeof body.fiscalQuarter === 'number'
        ? { fiscalYear: body.fiscalYear, fiscalQuarter: body.fiscalQuarter }
        : undefined;

    const quarters = clampQuarters(body.quarters);

    const prepared = await prepareCompany(params.ticker, { quarters, only });
    const step = await analyzeNextPending(prepared, { force: body.force });

    return ok({
      ticker: prepared.company.ticker,
      companyName: prepared.company.companyName,
      ...step,
      warnings: prepared.warnings,
    });
  });
}

function clampQuarters(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return INITIAL_ANALYSIS_QUARTERS;
  return Math.max(1, Math.min(12, Math.floor(value)));
}
