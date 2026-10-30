import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

const MAX_UPSTREAM_LOG_CHARS = 200;
const MAX_LOGGED_CODES = 5;

/** First backoff window; doubles per retry (see computeBackoffDelayMs). */
export const BASE_BACKOFF_MS = 1000;
/** Backoff never exceeds this, however many retries ran. */
export const MAX_BACKOFF_MS = 10_000;
/** A `Retry-After` wait is honored up to this cap to bound request time. */
export const MAX_RETRY_AFTER_MS = 30_000;
/** Retries after the initial attempt when the caller sets no policy. */
export const DEFAULT_MAX_RETRIES = 2;

/**
 * Network codes worth another attempt (transient by nature). Notably absent:
 * ENOTFOUND (persistent DNS), TLS/certificate errors (persistent config).
 */
const RETRYABLE_NETWORK_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'ENETDOWN',
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export interface MetaRequestOptions {
  /** Short label for logs, e.g. 'generate-ideas'. */
  operation?: string;
  /** External cancellation (client disconnect). Never retried once aborted. */
  signal?: AbortSignal;
  /** Retries after the initial attempt. Defaults to DEFAULT_MAX_RETRIES. */
  maxRetries?: number;
  /** Retry HTTP 429 honoring Retry-After. Defaults to true. */
  retryRateLimit?: boolean;
  /** Retry HTTP 408/5xx. Defaults to true; disable for billable image calls. */
  retryServerError?: boolean;
  /** Injectable wait between attempts (tests record instead of sleeping). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Exponential backoff with full jitter: a random wait in [0, cap), where the
 * cap doubles from BASE_BACKOFF_MS per retry index up to MAX_BACKOFF_MS.
 */
export function computeBackoffDelayMs(
  retryIndex: number,
  random: () => number = Math.random,
): number {
  const cap = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, retryIndex));
  return Math.floor(random() * cap);
}

/** Parses a `Retry-After` value (delay seconds or HTTP date) into capped ms. */
export function parseRetryAfterMs(
  value: string | null,
  nowMs: number = Date.now(),
): number | undefined {
  if (value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.min(Number(trimmed) * 1000, MAX_RETRY_AFTER_MS);
  }
  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) {
    return undefined;
  }
  return Math.min(Math.max(0, when - nowMs), MAX_RETRY_AFTER_MS);
}

/** Collects node-style error codes by walking `cause`/`errors` chains. */
export function errorCodes(error: unknown): string[] {
  const codes: string[] = [];
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (typeof value !== 'object' || value === null || seen.has(value)) {
      return;
    }
    seen.add(value);
    const record = value as Record<string, unknown>;
    if (typeof record['code'] === 'string' && record['code'].length > 0) {
      codes.push(record['code']);
    }
    if (Array.isArray(record['errors'])) {
      for (const nested of record['errors']) {
        visit(nested);
      }
    }
    visit(record['cause']);
  };
  visit(error);
  return [...new Set(codes)].slice(0, MAX_LOGGED_CODES);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function abortableSleep(
  ms: number,
  signal: AbortSignal | undefined,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  if (ms <= 0 || signal?.aborted) {
    return;
  }
  if (!signal) {
    await sleep(ms);
    return;
  }
  let onAbort: (() => void) | undefined;
  try {
    await Promise.race([
      sleep(ms),
      new Promise<void>((resolve) => {
        onAbort = () => resolve();
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

function cancelledError(cause?: unknown): AppError {
  return new AppError(499, 'AI_CANCELLED', 'Meta AI request was cancelled', undefined, cause);
}

interface FetchPolicy {
  operation: string;
  /** Sanitized target: `{ path }` for Meta calls, `{ host }` for downloads. */
  logTarget: Record<string, unknown>;
  timeoutMs: number;
  signal?: AbortSignal;
  maxRetries: number;
  retryRateLimit: boolean;
  retryServerError: boolean;
  sleep: (ms: number) => Promise<void>;
}

/**
 * One fetch with timeout, cancellation, bounded retries and sanitized per-
 * attempt logging. Returns the response (any status); throws AppError with
 * the original cause preserved. Never logs headers, bodies or credentials.
 */
async function fetchWithPolicy(
  url: string,
  init: RequestInit,
  policy: FetchPolicy,
): Promise<Response> {
  const maxAttempts = 1 + Math.max(0, policy.maxRetries);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (policy.signal?.aborted) {
      logger.info('meta ai request cancelled', {
        operation: policy.operation,
        ...policy.logTarget,
        attempt,
        maxAttempts,
      });
      throw cancelledError();
    }
    const timeoutSignal = AbortSignal.timeout(policy.timeoutMs);
    const signal =
      policy.signal === undefined ? timeoutSignal : AbortSignal.any([timeoutSignal, policy.signal]);
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal });
    } catch (error) {
      if (policy.signal?.aborted) {
        logger.info('meta ai request cancelled', {
          operation: policy.operation,
          ...policy.logTarget,
          attempt,
          maxAttempts,
        });
        throw cancelledError(error);
      }
      // Detected from signal state, not the error name: our own timeout
      // surfaces as TimeoutError, not AbortError.
      const timedOut = timeoutSignal.aborted;
      const codes = errorCodes(error);
      const retryable = timedOut || codes.some((code) => RETRYABLE_NETWORK_CODES.has(code));
      const willRetry = retryable && attempt < maxAttempts;
      const delayMs = willRetry ? computeBackoffDelayMs(attempt - 1) : 0;
      logger.warn('meta ai request failed before responding', {
        operation: policy.operation,
        ...policy.logTarget,
        phase: 'connection',
        attempt,
        maxAttempts,
        timedOut,
        name: error instanceof Error ? error.name : typeof error,
        codes,
        willRetry,
        ...(willRetry ? { delayMs } : {}),
      });
      if (!willRetry) {
        if (timedOut) {
          throw new AppError(504, 'AI_TIMEOUT', 'Meta AI request timed out', undefined, error);
        }
        throw new AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed', undefined, error);
      }
      await abortableSleep(delayMs, policy.signal, policy.sleep);
      continue;
    }
    if (res.ok) {
      return res;
    }
    // The key is header-only, never in the body, so a short upstream snippet
    // is safe to log. Never log request headers.
    const status = res.status;
    const snippet = (await res.text().catch(() => '')).slice(0, MAX_UPSTREAM_LOG_CHARS);
    const retryableStatus =
      (status === 429 && policy.retryRateLimit) ||
      ((status === 408 || status >= 500) && policy.retryServerError);
    const willRetry = retryableStatus && attempt < maxAttempts;
    let delayMs = willRetry ? computeBackoffDelayMs(attempt - 1) : 0;
    if (willRetry && status === 429) {
      delayMs = parseRetryAfterMs(res.headers.get('retry-after')) ?? delayMs;
    }
    logger.warn('meta ai responded with an error', {
      operation: policy.operation,
      ...policy.logTarget,
      phase: 'response',
      attempt,
      maxAttempts,
      status,
      body: snippet,
      willRetry,
      ...(willRetry ? { delayMs } : {}),
    });
    if (!willRetry) {
      throw new AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
    }
    await abortableSleep(delayMs, policy.signal, policy.sleep);
  }
  // Unreachable: the final iteration always returns or throws.
  throw new AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
}

function resolvePolicy(
  options: MetaRequestOptions,
  operation: string,
): Omit<FetchPolicy, 'logTarget' | 'timeoutMs'> {
  return {
    operation: options.operation ?? operation,
    signal: options.signal,
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    retryRateLimit: options.retryRateLimit ?? true,
    retryServerError: options.retryServerError ?? true,
    sleep: options.sleep ?? defaultSleep,
  };
}

/**
 * POSTs a JSON body to the Meta Model API and returns the parsed payload.
 * Maps timeouts, network failures, upstream errors and invalid JSON to
 * AppError with the cause preserved. The API key travels in the
 * Authorization header only and is never logged or returned.
 */
export async function postMetaJson(
  baseUrl: string,
  path: string,
  body: unknown,
  apiKey: string,
  timeoutMs: number,
  options: MetaRequestOptions = {},
): Promise<unknown> {
  const policy = resolvePolicy(options, 'meta-json');
  const res = await fetchWithPolicy(
    `${baseUrl}${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    { ...policy, logTarget: { path }, timeoutMs },
  );

  console.log(' =======');
  console.log('ERROR ON res', res);
  console.log(' =======');
  console.log('path', `${baseUrl}${path}`);
  console.log('Body', body);

  const payload: unknown = await res.json().catch(() => undefined);
  if (payload === undefined) {
    logger.warn('meta ai returned invalid json', {
      operation: policy.operation,
      path,
      status: res.status,
    });
    console.log(' =======');
    console.log('ERROR ON res after payload', res);
    console.log(' =======');

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
  console.log(' =======');
  console.log('ERROR ON failure', failure);
  console.log(' =======');
  throw new AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'invalid-url';
  }
}

/**
 * Downloads an image URL returned by Meta (when an endpoint answers with
 * `url` instead of `b64_json`). Rejects non-image content and oversized
 * bodies. Saved bytes are still magic-byte verified by the caller. Only the
 * hostname is logged: download URLs may carry signed query strings.
 */
export async function downloadImage(
  url: string,
  timeoutMs: number,
  maxBytes: number,
  options: MetaRequestOptions = {},
): Promise<Buffer> {
  const policy = resolvePolicy(options, 'image-download');
  const res = await fetchWithPolicy(
    url,
    {},
    { ...policy, logTarget: { host: safeHost(url) }, timeoutMs },
  );
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) {
    logger.warn('meta image download rejected', {
      operation: policy.operation,
      host: safeHost(url),
      contentType: contentType.slice(0, 80),
    });
    throw new AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0 || buffer.length > maxBytes) {
    logger.warn('meta image download rejected', {
      operation: policy.operation,
      host: safeHost(url),
      bytes: buffer.length,
    });
    throw new AppError(502, 'AI_UPSTREAM_ERROR', 'Meta AI request failed');
  }
  return buffer;
}
