import 'server-only';
import { handle, ok } from '@/lib/api/respond';
import { fmpFetch } from '@/lib/providers/fmp/client';
import { config, isFmpConfigured } from '@/lib/config';
import { AppError } from '@/lib/types';

interface FmpDebugTestResult {
  name: string;
  ok: boolean;
  details?: Record<string, unknown>;
  error?: { code: string; message: string };
}

const TEST_TICKER = 'AAPL';

export async function GET() {
  return handle(async () => {
    const tests: FmpDebugTestResult[] = [];

    if (!isFmpConfigured()) {
      return ok({
        fmpConfigured: false,
        baseUrl: config.fmp.baseUrl,
        tests,
      });
    }

    tests.push(
      await runTest('profile', async () => {
        const response = await fmpFetch<Record<string, unknown>[]>(`profile/${TEST_TICKER}`, {
          revalidate: 60 * 60,
        });
        return {
          status: response ? 'ok' : 'empty',
          resultCount: Array.isArray(response) ? response.length : 0,
        };
      }),
    );

    tests.push(
      await runTest('quote', async () => {
        const response = await fmpFetch<Record<string, unknown>[]>(`quote/${TEST_TICKER}`, {
          revalidate: 60 * 5,
        });
        return {
          status: response ? 'ok' : 'empty',
          resultCount: Array.isArray(response) ? response.length : 0,
        };
      }),
    );

    tests.push(
      await runTest('transcript list', async () => {
        const response = await fmpFetch<unknown[]>(`earning_call_transcript`, {
          version: 'v4',
          query: { symbol: TEST_TICKER },
          revalidate: 60 * 60 * 6,
        });
        return {
          status: response ? 'ok' : 'empty',
          resultCount: Array.isArray(response) ? response.length : 0,
        };
      }),
    );

    tests.push(
      await runTest('metadata', async () => ({
        baseUrl: config.fmp.baseUrl,
      })),
    );

    return ok({
      fmpConfigured: true,
      baseUrl: config.fmp.baseUrl,
      tests,
    });
  });
}

async function runTest(
  name: string,
  fn: () => Promise<Record<string, unknown>>,
): Promise<FmpDebugTestResult> {
  try {
    const details = await fn();
    return { name, ok: true, details };
  } catch (error) {
    if (error instanceof AppError) {
      return {
        name,
        ok: false,
        error: { code: error.code, message: error.userMessage },
      };
    }

    return {
      name,
      ok: false,
      error: { code: 'unknown', message: 'An unexpected error occurred.' },
    };
  }
}
