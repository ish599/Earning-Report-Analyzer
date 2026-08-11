import 'server-only';
import { config, isXaiConfigured } from '@/lib/config';
import { AppError } from '@/lib/types';

/**
 * xAI (Grok) transport.
 *
 * This is the ONLY module in the application that knows the LLM vendor. It
 * exposes a vendor-neutral `completeJson` so that swapping to another provider
 * means writing a sibling file and changing one import in analyzeTranscript.ts
 * — no consumer depends on Grok's response shape.
 */

export interface JsonCompletionRequest {
  system: string;
  user: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  /** Low by default: scoring should be reproducible across identical inputs. */
  temperature?: number;
}

export interface JsonCompletionResult {
  /** Parsed JSON. Structurally valid, but not yet validated against our schema. */
  data: unknown;
  modelUsed: string;
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  model?: string;
  error?: { message?: string };
}

export function isConfigured(): boolean {
  return isXaiConfigured();
}

export async function completeJson(
  request: JsonCompletionRequest,
): Promise<JsonCompletionResult> {
  if (!isXaiConfigured()) {
    throw new AppError(
      'llm_not_configured',
      'Transcript analysis is not configured on this deployment.',
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.xai.timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${config.xai.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${config.xai.apiKey}`,
      },
      body: JSON.stringify({
        model: config.xai.model,
        temperature: request.temperature ?? 0.1,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        // Structured output: the provider constrains generation to the schema
        // rather than us hoping for well-formed JSON and repairing it after.
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: request.schemaName,
            strict: true,
            schema: request.jsonSchema,
          },
        },
      }),
      cache: 'no-store',
    });
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === 'AbortError';
    throw new AppError(
      aborted ? 'llm_timeout' : 'provider_error',
      aborted
        ? 'Transcript analysis timed out. Please try again.'
        : 'Could not reach the analysis service.',
      { cause },
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 429) {
    throw new AppError(
      'provider_rate_limit',
      'The analysis service is rate limited. Please try again shortly.',
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new AppError('llm_not_configured', 'The analysis service rejected our credentials.');
  }

  if (!response.ok) {
    let detail = `xAI ${response.status}`;
    try {
      const body = (await response.json()) as ChatCompletionResponse;
      if (body?.error?.message) detail += `: ${body.error.message}`;
    } catch {
      // Body is not JSON; the status alone is the diagnostic.
    }
    throw new AppError('provider_error', 'The analysis service returned an error.', {
      cause: new Error(detail),
    });
  }

  const body = (await response.json()) as ChatCompletionResponse;
  const choice = body.choices?.[0];
  const content = choice?.message?.content;

  if (!content) {
    throw new AppError('llm_invalid_response', 'The analysis service returned an empty response.');
  }

  // A truncated completion yields JSON that may parse but is semantically
  // incomplete, so treat it as invalid rather than storing a partial analysis.
  if (choice?.finish_reason === 'length') {
    throw new AppError(
      'llm_invalid_response',
      'The analysis response was truncated before it completed.',
    );
  }

  try {
    return { data: JSON.parse(content), modelUsed: body.model ?? config.xai.model };
  } catch (cause) {
    throw new AppError('llm_invalid_response', 'The analysis service returned malformed JSON.', {
      cause,
    });
  }
}
