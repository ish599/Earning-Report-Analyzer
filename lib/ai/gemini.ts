import 'server-only';
import { config, isGeminiConfigured } from '@/lib/config';
import { AppError } from '@/lib/types';

export interface JsonCompletionRequest {
  system: string;
  user: string;
  schemaName?: string;
  jsonSchema?: Record<string, unknown>;
  temperature?: number;
}

export interface JsonCompletionResult {
  data: unknown;
  modelUsed: string;
}

interface GeminiContentPart {
  text?: string;
  [key: string]: unknown;
}

interface GeminiContent {
  parts?: GeminiContentPart[];
  role?: string;
  [key: string]: unknown;
}

interface GeminiCandidate {
  content?: GeminiContent;
  text?: string;
  output?: string;
  [key: string]: unknown;
}

interface GeminiErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
  [key: string]: unknown;
}

function extractTextFromCandidate(candidate: GeminiCandidate): string | null {
  // Gemini's actual response shape: candidate.content.parts[].text
  if (
    candidate.content &&
    typeof candidate.content === 'object' &&
    Array.isArray(candidate.content.parts)
  ) {
    const parts = candidate.content.parts
      .map((item) => (typeof item.text === 'string' ? item.text : ''))
      .filter(Boolean);
    if (parts.length > 0) {
      return parts.join('');
    }
  }

  // Fallbacks for other response shapes.
  if (typeof candidate.text === 'string' && candidate.text.trim().length > 0) {
    return candidate.text;
  }

  if (typeof candidate.output === 'string' && candidate.output.trim().length > 0) {
    return candidate.output;
  }

  return null;
}

export function isConfigured(): boolean {
  return isGeminiConfigured();
}

export async function completeJson(
  request: JsonCompletionRequest,
): Promise<JsonCompletionResult> {
  if (!isGeminiConfigured()) {
    throw new AppError(
      'llm_not_configured',
      'Transcript analysis is not configured. Set GEMINI_API_KEY to enable it.',
    );
  }

  const apiKey = config.gemini.apiKey;
  if (!apiKey) {
    throw new AppError(
      'llm_not_configured',
      'Transcript analysis is not configured. Set GEMINI_API_KEY to enable it.',
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.gemini.timeoutMs);

  let response: Response;
  let responseText = '';
  try {
    response = await fetch(
      `${config.gemini.baseUrl}/${config.gemini.model}:generateContent`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `${request.system}\n\n${request.user}`,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            // The full analysis schema uses draft-7 constructs (anyOf,
            // nullable unions) that Gemini's OpenAPI 3.0 responseSchema does
            // not support. Structured output is therefore only used for the
            // simple debug route; production analysis relies on the strict
            // zod schema validation that runs after this transport returns.
            ...(request.jsonSchema ? { responseSchema: request.jsonSchema } : {}),
            temperature: request.temperature ?? 0.1,
          },
        }),
        cache: 'no-store',
      },
    );

    responseText = await response.text();
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

  if (!response.ok) {
    let errorMessage = `${response.status} ${response.statusText}`;
    try {
      const providerBody = JSON.parse(responseText) as GeminiErrorBody;
      if (providerBody?.error?.message) {
        errorMessage += `: ${providerBody.error.message}`;
      }
    } catch {
      // Leave errorMessage as status + statusText.
    }

    throw new AppError('provider_error', 'The analysis service returned an error.', {
      cause: new Error(errorMessage),
    });
  }

  let body: unknown;
  try {
    body = JSON.parse(responseText) as { candidates?: GeminiCandidate[] };
  } catch (cause) {
    throw new AppError('llm_invalid_response', 'The analysis service returned malformed JSON.', {
      cause,
    });
  }

  const candidate = Array.isArray((body as any).candidates) ? (body as any).candidates[0] : null;
  if (!candidate) {
    throw new AppError('llm_invalid_response', 'The analysis service returned no content.');
  }

  const text = extractTextFromCandidate(candidate);
  if (!text) {
    throw new AppError('llm_invalid_response', 'The analysis service returned empty content.');
  }

  // Gemini may wrap JSON in markdown fences; strip them before parsing.
  const cleaned = stripMarkdownFences(text);

  try {
    return { data: JSON.parse(cleaned), modelUsed: config.gemini.model };
  } catch (cause) {
    throw new AppError('llm_invalid_response', 'The analysis service returned malformed JSON.', {
      cause,
    });
  }
}

/** Removes ```json ... ``` fences if present, returning the inner text. */
function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) return fenceMatch[1].trim();
  return trimmed;
}