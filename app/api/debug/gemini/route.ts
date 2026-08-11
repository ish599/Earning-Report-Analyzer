import 'server-only';
import { handle, ok } from '@/lib/api/respond';
import { config, isGeminiConfigured } from '@/lib/config';
import { completeJson } from '@/lib/ai/gemini';

export async function GET() {
  return handle(async () => {
    const model = config.gemini.model;
    if (!isGeminiConfigured()) {
      return ok({
        configured: false,
        model,
        status: 0,
        statusText: 'Gemini is not configured',
        responsePreview: null,
      });
    }

    try {
      const result = await completeJson({
        system: 'You are a helpful assistant.',
        user: 'Respond with exactly: OK',
        schemaName: 'debug',
        jsonSchema: {
          type: 'object',
          properties: {
            response: { type: 'string', enum: ['OK'] },
          },
          required: ['response'],
          additionalProperties: false,
        },
      });

      return ok({
        configured: true,
        model,
        status: 200,
        statusText: 'OK',
        responsePreview: JSON.stringify(result.data),
        modelUsed: result.modelUsed,
      });
    } catch (error) {
      const statusText = error instanceof Error ? error.message : String(error);
      return ok({
        configured: true,
        model,
        status: 0,
        statusText,
        responsePreview: null,
      });
    }
  });
}
