import { NextResponse } from 'next/server';

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message: string) {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function serverError(message: string) {
  return NextResponse.json({ error: message }, { status: 500 });
}

/**
 * Wrap an async route handler with a try/catch that returns a 500 on
 * unhandled exceptions.
 */
export async function withErrorHandling(
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[API]', message);
    return serverError(message);
  }
}
