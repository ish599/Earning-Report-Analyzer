import 'server-only';
import { NextResponse } from 'next/server';
import { AppError, type AppErrorCode } from '@/lib/types';

/**
 * Uniform API envelope and error translation.
 *
 * Route handlers never construct error responses by hand. Anything thrown is
 * funnelled through `fail`, which maps an AppError to its status and safe
 * user message, and reduces anything unrecognized to a generic 500 — internal
 * messages, stack traces, and provider URLs (which embed API keys) must never
 * reach a client.
 */

export interface ApiError {
  code: AppErrorCode;
  message: string;
}

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, init);
}

export function fail(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.userMessage } satisfies ApiError },
      { status: error.status },
    );
  }

  console.error('[api] unhandled error', error);

  return NextResponse.json(
    {
      error: {
        code: 'unknown',
        message: 'Something went wrong. Please try again.',
      } satisfies ApiError,
    },
    { status: 500 },
  );
}

/** Wraps a handler so no route can leak an unhandled rejection. */
export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (error) {
    return fail(error);
  }
}
