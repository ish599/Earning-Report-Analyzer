import 'server-only';
import { handle, ok } from '@/lib/api/respond';
import { getServiceClient } from '@/lib/db/client';

export async function GET() {
  return handle(async () => {
    const db = getServiceClient();
    const result = {
      supabaseUrlPresent: false,
      secretKeyPresent: false,
      operation: 'companies upsert',
      success: false,
      errorCode: null as string | null,
      errorMessage: null as string | null,
      errorDetails: null as string | null,
      errorHint: null as string | null,
    };

    if (!db) {
      return ok({
        ...result,
        errorMessage: 'Supabase service client is not configured.',
      });
    }

    // The service client can only be initialized if the server env is present.
    result.supabaseUrlPresent = Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
    result.secretKeyPresent = Boolean(process.env.SUPABASE_SECRET_KEY);

    try {
      const { data, error } = await db
        .from('companies')
        .upsert(
          {
            ticker: 'TEST',
            company_name: 'Test Company',
            sector: 'Test',
            industry: 'Test',
            exchange: 'TEST',
          },
          { onConflict: 'ticker' },
        )
        .select('id')
        .single();

      if (error || !data) {
        result.errorCode = (error as { code?: string })?.code ?? null;
        result.errorMessage = (error as { message?: string })?.message ?? 'Upsert failed';
        result.errorDetails = JSON.stringify((error as { details?: unknown })?.details ?? null);
        result.errorHint = (error as { hint?: string })?.hint ?? null;
        return ok(result);
      }

      // Clean up the test row if inserted.
      await db.from('companies').delete().eq('ticker', 'TEST');

      return ok({ ...result, success: true });
    } catch (error) {
      const err = error as Error;
      result.errorMessage = err.message;
      result.errorDetails = JSON.stringify(err); 
      return ok(result);
    }
  });
}
