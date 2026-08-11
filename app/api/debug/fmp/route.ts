import 'server-only';
import { handle, ok } from '@/lib/api/respond';
import { fmpRawFetch, redactFmpUrl } from '@/lib/providers/fmp/client';
import { config, isFmpConfigured } from '@/lib/config';

interface FmpDebugTestResult {
  name: string;
  ok: boolean;
  requestPath?: string;
  status?: number;
  contentType?: string | null;
  providerBody?: string;
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

    tests.push(await runRawTest('profile', 'profile', {
      version: 'stable',
      query: { symbol: TEST_TICKER },
      revalidate: 60 * 60,
    }));

    tests.push(await runRawTest('quote', 'quote', {
      version: 'stable',
      query: { symbol: TEST_TICKER },
      revalidate: 60 * 5,
    }));

    tests.push(await runRawTest('transcript list', 'earning_call_transcript', {
      version: 'stable',
      query: { symbol: TEST_TICKER },
      revalidate: 60 * 60 * 6,
    }));

    tests.push({
      name: 'metadata',
      ok: true,
      requestPath: '/metadata',
      status: 200,
      contentType: 'application/json',
      providerBody: JSON.stringify({ baseUrl: config.fmp.baseUrl }),
    });

    return ok({
      fmpConfigured: true,
      baseUrl: config.fmp.baseUrl,
      tests,
    });
  });
}

async function runRawTest(
  name: string,
  path: string,
  options: Parameters<typeof fmpRawFetch>[1],
): Promise<FmpDebugTestResult> {
  try {
    const { url, response } = await fmpRawFetch(path, options);
    const contentType = response.headers.get('content-type');
    const rawBody = await response.text();
    const bodyPreview = rawBody.slice(0, 500);

    return {
      name,
      ok: response.ok,
      requestPath: redactFmpUrl(url),
      status: response.status,
      contentType,
      providerBody: bodyPreview,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      error: {
        code: 'unknown',
        message: error instanceof Error ? error.message : 'Unexpected error',
      },
    };
  }
}
