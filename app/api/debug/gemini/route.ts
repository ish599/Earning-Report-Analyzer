import 'server-only';
import { ok } from '@/lib/api/respond';

/**
 * GET /api/debug/gemini
 *
 * Raw connectivity check for Google Gemini. Makes a direct server-side fetch
 * to the generateContent endpoint and returns Google's actual response so
 * real failures are visible instead of being hidden by the provider error
 * mapper. The API key is never returned or logged.
 */
export async function GET() {
  const model = 'gemini-2.5-flash';
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    return ok({
      configured: false,
      model,
      status: 0,
      statusText: 'Gemini is not configured',
      contentType: null,
      bodyPreview: null,
    });
  }

  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: 'Respond with exactly OK',
                },
              ],
            },
          ],
        }),
        cache: 'no-store',
      },
    );
  } catch (error) {
    const err = error as Error;
    return ok({
      configured: true,
      model,
      networkError: {
        name: err.name,
        message: err.message,
        cause:
          err.cause instanceof Error
            ? { name: err.cause.name, message: err.cause.message }
            : undefined,
      },
    });
  }

  const body = await response.text();

  return ok({
    configured: true,
    model,
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get('content-type'),
    bodyPreview: body.slice(0, 1000),
  });
}