import 'server-only';
import { handle, ok } from '@/lib/api/respond';
import { getCompany } from '@/lib/providers/company';
import { isRoicConfigured, config } from '@/lib/config';

const ROIC_HOST = 'api.roic.ai';
const DEBUG_BODY_PREVIEW_LIMIT = 500;

interface HttpResult {
  request: {
    method: 'GET';
    host: string;
    path: string;
  };
  response?: {
    status: number;
    statusText: string;
    contentType: string | null;
    bodyPreview: string;
  };
  networkError?: {
    name: string;
    message: string;
    cause?: string | null;
  } | null;
}

function bodyPreview(text: string): string {
  return text.length <= DEBUG_BODY_PREVIEW_LIMIT
    ? text
    : text.slice(0, DEBUG_BODY_PREVIEW_LIMIT);
}

async function fetchRoicRaw(url: string, headers: Record<string, string>, safePath?: string): Promise<HttpResult> {
  const parsed = new URL(url);
  const result: HttpResult = {
    request: {
      method: 'GET',
      host: parsed.host,
      path: safePath ?? parsed.pathname + parsed.search,
    },
    networkError: null,
  };

  try {
    const response = await fetch(url, { method: 'GET', headers });
    const text = await response.text().catch(() => '');

    result.response = {
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type'),
      bodyPreview: bodyPreview(text),
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    result.networkError = {
      name: err.name,
      message: err.message,
      cause: err.cause ? String(err.cause) : null,
    };
  }

  return result;
}

function getLatestPath(symbol: string): string {
  return `/v2/company/earnings-calls/latest/${symbol}`;
}

function getAvailableCallsPath(identifier: string): string {
  return `/v3.0.0/earnings-calls?identifier=${encodeURIComponent(identifier)}&order=desc&limit=2`;
}

export async function GET(request: Request) {
  return handle(async () => {
    const url = new URL(request.url);
    const symbol = (url.searchParams.get('symbol') || 'AAPL').toUpperCase();
    const out: any = { configured: isRoicConfigured() };
    if (!isRoicConfigured()) return ok(out);

    const bearerHeaders = {
      Authorization: `Bearer ${config.roic.apiKey}`,
      Accept: 'application/json',
    };

    const latestUrl = `https://${ROIC_HOST}${getLatestPath(symbol)}`;
    const latestBearer = await fetchRoicRaw(latestUrl, bearerHeaders);
    out.latest = latestBearer;

    const latestQueryUrl = `https://${ROIC_HOST}${getLatestPath(symbol)}?apikey=${encodeURIComponent(config.roic.apiKey ?? '')}`;
    const latestQuery = await fetchRoicRaw(latestQueryUrl, { Accept: 'application/json' }, `${getLatestPath(symbol)}?apikey=[REDACTED]`);
    out.latestQueryAuth = latestQuery;

    if (latestBearer.response && !latestBearer.networkError) {
      try {
        const latestPayload = JSON.parse(latestBearer.response.bodyPreview);
        out.latest.rawShape = {
          hasSymbol: typeof latestPayload?.symbol === 'string',
          hasYear: Number.isFinite(Number(latestPayload?.year)),
          hasQuarter: Number.isFinite(Number(latestPayload?.quarter)),
          hasDate: typeof latestPayload?.date === 'string',
          hasContent: typeof latestPayload?.content === 'string',
        };
        if (
          out.latest.rawShape.hasSymbol &&
          out.latest.rawShape.hasYear &&
          out.latest.rawShape.hasQuarter &&
          out.latest.rawShape.hasDate &&
          out.latest.rawShape.hasContent
        ) {
          out.latest.normalized = {
            ticker: String(latestPayload.symbol).toUpperCase(),
            fiscalYear: Number(latestPayload.year),
            fiscalQuarter: Number(latestPayload.quarter),
            callDate: latestPayload.date,
            characters: String(latestPayload.content).length,
            source: 'roic',
          };
        }
      } catch {
        // Ignore parse failures; raw body preview is already available.
      }
    }

    let availableCallsPath: string | null = null;
    try {
      const company = await getCompany(symbol);
      if (company.exchange) {
        availableCallsPath = getAvailableCallsPath(`${company.exchange}:${symbol}`);
      }
    } catch {
      availableCallsPath = null;
    }

    if (availableCallsPath) {
      const availableUrl = `https://${ROIC_HOST}${availableCallsPath}`;
      out.availableCalls = await fetchRoicRaw(availableUrl, bearerHeaders);
    } else {
      out.availableCalls = {
        request: {
          method: 'GET',
          host: ROIC_HOST,
          path: '/v3.0.0/earnings-calls?identifier=<exchange_missing>&order=desc&limit=2',
        },
        response: undefined,
        networkError: null,
        note: 'Company exchange metadata missing; unable to test v3 identifier request.',
      };
    }

    return ok(out);
  });
}
