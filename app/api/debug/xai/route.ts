import 'server-only';
import { handle, ok } from '@/lib/api/respond';
import { config, isXaiConfigured } from '@/lib/config';

export async function GET() {
  return handle(async () => {
    const model = config.xai.model;
    if (!isXaiConfigured()) {
      return ok({
        configured: false,
        model,
        status: 0,
        statusText: 'xAI is not configured',
        responsePreview: null,
      });
    }

    const url = `${config.xai.baseUrl}/chat/completions`;
    let response: Response;
    let bodyText = '';
    try {
      response = await fetch(url, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${config.xai.apiKey}`,
        },
        body: JSON.stringify({
          model: config.xai.model,
          temperature: 0.1,
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Respond with exactly: OK' },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'debug',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  response: { type: 'string', const: 'OK' },
                },
                required: ['response'],
              },
            },
          },
        }),
      });

      bodyText = await response.text();
      const responsePreview = bodyText.slice(0, 2000);

      const result: {
        configured: boolean;
        model: string;
        status: number;
        statusText: string;
        responsePreview: string | null;
        providerBody?: unknown;
      } = {
        configured: true,
        model,
        status: response.status,
        statusText: response.statusText,
        responsePreview,
      };

      if (!response.ok) {
        try {
          result.providerBody = JSON.parse(bodyText);
        } catch {
          result.providerBody = bodyText;
        }
      }

      return ok(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return ok({
        configured: true,
        model,
        status: 0,
        statusText: message,
        responsePreview: null,
        providerBody: message,
      });
    }
  });
}
