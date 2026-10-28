import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

const MAX_UPSTREAM_LOG_CHARS = 200;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * POSTs a JSON body to the Meta Model API and returns the parsed payload.
 * Maps timeouts, network failures, upstream errors and invalid JSON to
 * AppError. The API key travels in the Authorization header only and is
 * never logged or returned.
 */
export async function postMetaJson(
  baseUrl: string,
  path: string,
  body: unknown,
  apiKey: string,
  timeoutMs: number,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logger.warn('meta ai request timed out', { path, timeoutMs });
      throw new AppError(504, 'AI_TIMEOUT', 'Meta AI request timed out');
    }
    logger.warn('meta ai request failed', { path });
    throw new AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
  }

  if (!res.ok) {
    // The key is header-only, never in the body, so a short upstream snippet
    // is safe to log. Never log request headers.
    const snippet = (await res.text().catch(() => '')).slice(0, MAX_UPSTREAM_LOG_CHARS);
    logger.warn('meta ai responded with an error', { path, status: res.status, body: snippet });
    throw new AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
  }

  const payload: unknown = await res.json().catch(() => undefined);
  if (payload === undefined) {
    logger.warn('meta ai returned invalid json', { path, status: res.status });
    throw new AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
  }
  return payload;
}

/**
 * Throws when a Responses API payload reports a failed generation.
 * Upstream error details stay in the logs; the client gets a generic 502.
 */
export function assertResponseCompleted(payload: unknown): void {
  if (!isRecord(payload) || payload['status'] !== 'failed') {
    return;
  }
  const failure = isRecord(payload['error']) ? payload['error'] : undefined;
  logger.warn('meta ai generation failed', {
    code: typeof failure?.['code'] === 'string' ? failure['code'] : 'unknown',
    message: typeof failure?.['message'] === 'string' ? failure['message'] : 'unknown',
  });
  throw new AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
}

/**
 * Downloads an image URL returned by Meta (when an endpoint answers with
 * `url` instead of `b64_json`). Rejects non-image content and oversized
 * bodies. Saved bytes are still magic-byte verified by the caller.
 */
export async function downloadImage(
  url: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
  }
  if (!res.ok) {
    throw new AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) {
    throw new AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0 || buffer.length > maxBytes) {
    throw new AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
  }
  return buffer;
}
