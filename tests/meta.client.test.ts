import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { env } from '../src/config/env';
import { generateIdeasFromPhoto } from '../src/services/ideas.service';
import { AppError } from '../src/utils/errors';
import { logger, type LogContext } from '../src/utils/logger';
import {
  computeBackoffDelayMs,
  downloadImage,
  errorCodes,
  parseRetryAfterMs,
  postMetaJson,
} from '../src/services/meta.client';

const BASE = 'https://api.meta.ai/v1';
const API_KEY = 'test-secret-key-12345';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** Undici-shaped network failure: TypeError with an AggregateError cause carrying codes. */
function networkError(code: string): TypeError {
  const inner = new Error(`connect ${code} 93.184.216.34:443`) as Error & { code: string };
  inner.code = code;
  return new TypeError('fetch failed', { cause: new AggregateError([inner], 'fetch failed') });
}

function stubFetch(
  impl: (input: unknown, init?: RequestInit) => Promise<Response>,
): ReturnType<typeof vi.fn<typeof fetch>> {
  const mock = vi.fn<typeof fetch>().mockImplementation((input, init) => impl(input, init));
  vi.stubGlobal('fetch', mock);
  return mock;
}

function recordingSleep(sleeps: number[]): (ms: number) => Promise<void> {
  return (ms: number) => {
    sleeps.push(ms);
    return Promise.resolve();
  };
}

type LoggerSpy = MockInstance<(message: string, context?: LogContext) => void>;

function loggedContexts(spy: LoggerSpy): Record<string, unknown>[] {
  return spy.mock.calls.map(([, context]) => (context ?? {}) as Record<string, unknown>);
}

let warnSpy: LoggerSpy;
let errorSpy: LoggerSpy;

beforeEach(() => {
  warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('postMetaJson', () => {
  it('posts JSON with the bearer key and returns the parsed payload', async () => {
    const mock = stubFetch(() => Promise.resolve(jsonResponse({ ok: true })));

    const payload = await postMetaJson(BASE, '/responses', { model: 'm' }, API_KEY, 1000);

    expect(payload).toEqual({ ok: true });
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0] ?? [];
    expect(url).toBe(`${BASE}/responses`);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` });
  });

  it('retries a transient ETIMEDOUT and returns the eventual payload', async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return calls < 3
        ? Promise.reject(networkError('ETIMEDOUT'))
        : Promise.resolve(jsonResponse({ ok: true }));
    });
    const sleeps: number[] = [];

    const payload = await postMetaJson(BASE, '/responses', {}, API_KEY, 1000, {
      operation: 'responses',
      sleep: recordingSleep(sleeps),
    });

    expect(payload).toEqual({ ok: true });
    expect(calls).toBe(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[0]).toBeGreaterThanOrEqual(0);
    expect(sleeps[0]).toBeLessThan(1000);
    expect(sleeps[1]).toBeLessThan(2000);
  });

  it('gives up after exhausting retries, preserving the cause and logging codes', async () => {
    const mock = stubFetch(() => Promise.reject(networkError('ETIMEDOUT')));
    const sleeps: number[] = [];

    const failure = await postMetaJson(BASE, '/responses', {}, API_KEY, 1000, {
      operation: 'responses',
      sleep: recordingSleep(sleeps),
    }).catch((error: unknown) => error);

    expect(mock).toHaveBeenCalledTimes(3);
    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ statusCode: 502, code: 'AI_UPSTREAM_ERROR' });
    expect((failure as AppError).cause).toBeInstanceOf(TypeError);
    const contexts = loggedContexts(warnSpy);
    expect(contexts.length).toBeGreaterThan(0);
    expect(contexts[0]?.['operation']).toBe('responses');
    expect(contexts[0]?.['phase']).toBe('connection');
    expect(contexts[0]?.['codes']).toContain('ETIMEDOUT');
  });

  it('does not retry DNS failures', async () => {
    const mock = stubFetch(() => Promise.reject(networkError('ENOTFOUND')));

    const failure = await postMetaJson(BASE, '/responses', {}, API_KEY, 1000, {
      operation: 'responses',
    }).catch((error: unknown) => error);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(failure).toMatchObject({ statusCode: 502, code: 'AI_UPSTREAM_ERROR' });
    expect(loggedContexts(warnSpy)[0]?.['codes']).toContain('ENOTFOUND');
  });

  it('retries connection resets', async () => {
    const mock = stubFetch(() => Promise.reject(networkError('ECONNRESET')));
    const sleeps: number[] = [];

    await postMetaJson(BASE, '/responses', {}, API_KEY, 1000, {
      sleep: recordingSleep(sleeps),
    }).catch(() => undefined);

    expect(mock).toHaveBeenCalledTimes(3);
    expect(sleeps).toHaveLength(2);
  });

  it.each([400, 401, 403])('does not retry HTTP %s', async (status) => {
    const mock = stubFetch(() => Promise.resolve(jsonResponse({ error: 'nope' }, status)));

    const failure = await postMetaJson(BASE, '/responses', {}, API_KEY, 1000, {
      operation: 'responses',
    }).catch((error: unknown) => error);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(failure).toMatchObject({ statusCode: 502, code: 'AI_UPSTREAM_ERROR' });
    expect(loggedContexts(warnSpy)[0]).toMatchObject({ status, phase: 'response' });
  });

  it('waits for Retry-After on 429 before retrying', async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return calls === 1
        ? Promise.resolve(jsonResponse({ error: 'slow down' }, 429, { 'Retry-After': '2' }))
        : Promise.resolve(jsonResponse({ ok: true }));
    });
    const sleeps: number[] = [];

    const payload = await postMetaJson(BASE, '/responses', {}, API_KEY, 1000, {
      sleep: recordingSleep(sleeps),
    });

    expect(payload).toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(sleeps).toEqual([2000]);
  });

  it('retries 5xx responses with backoff', async () => {
    const mock = stubFetch(() => Promise.resolve(jsonResponse({ error: 'boom' }, 503)));
    const sleeps: number[] = [];

    const failure = await postMetaJson(BASE, '/responses', {}, API_KEY, 1000, {
      sleep: recordingSleep(sleeps),
    }).catch((error: unknown) => error);

    expect(mock).toHaveBeenCalledTimes(3);
    expect(sleeps).toHaveLength(2);
    expect(failure).toMatchObject({ statusCode: 502, code: 'AI_UPSTREAM_ERROR' });
  });

  it('skips server-error retries when disabled', async () => {
    const mock = stubFetch(() => Promise.resolve(jsonResponse({ error: 'boom' }, 500)));

    const failure = await postMetaJson(BASE, '/responses', {}, API_KEY, 1000, {
      retryServerError: false,
    }).catch((error: unknown) => error);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(failure).toMatchObject({ statusCode: 502, code: 'AI_UPSTREAM_ERROR' });
  });

  it('maps our own timeout to 504 AI_TIMEOUT', async () => {
    stubFetch((_input, init) => {
      // Mirror real fetch: reject once the signal aborts.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('The operation timed out', 'TimeoutError')),
          { once: true },
        );
      });
    });
    const sleeps: number[] = [];

    const failure = await postMetaJson(BASE, '/responses', {}, API_KEY, 15, {
      maxRetries: 0,
      sleep: recordingSleep(sleeps),
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({ statusCode: 504, code: 'AI_TIMEOUT' });
    expect(failure).toMatchObject({
      debug: {
        provider: 'meta',
        operation: 'meta-json',
        upstreamEndpoint: '/responses',
        upstreamStatus: null,
        networkError: { name: 'TimeoutError', codes: [], timedOut: true },
      },
    });
    expect(loggedContexts(warnSpy)[0]).toMatchObject({ timedOut: true });
  });

  it('maps cancellation to 499 AI_CANCELLED without retrying', async () => {
    const controller = new AbortController();
    controller.abort();
    const mock = stubFetch(() => Promise.resolve(jsonResponse({ ok: true })));

    const failure = await postMetaJson(BASE, '/responses', {}, API_KEY, 1000, {
      signal: controller.signal,
    }).catch((error: unknown) => error);

    expect(mock).toHaveBeenCalledTimes(0);
    expect(failure).toMatchObject({ statusCode: 499, code: 'AI_CANCELLED' });
  });

  it('aborts in-flight requests without retrying', async () => {
    const controller = new AbortController();
    const mock = stubFetch((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        );
      });
    });
    setTimeout(() => controller.abort(), 10);

    const failure = await postMetaJson(BASE, '/responses', {}, API_KEY, 5000, {
      signal: controller.signal,
    }).catch((error: unknown) => error);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(failure).toMatchObject({ statusCode: 499, code: 'AI_CANCELLED' });
  });

  it('honors cancellation end to end from the ideas service', async () => {
    const controller = new AbortController();
    controller.abort();
    const mock = stubFetch(() => Promise.resolve(jsonResponse({ ok: true })));
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );

    const failure = await generateIdeasFromPhoto(tinyPng, {
      apiKey: 'test-key',
      metaApiBase: BASE,
      uploadDir: env.uploadDir,
      ideasCount: 1,
      signal: controller.signal,
    }).catch((error: unknown) => error);

    expect(mock).toHaveBeenCalledTimes(0);
    expect(failure).toMatchObject({ statusCode: 499, code: 'AI_CANCELLED' });
  });

  it('maps invalid JSON responses to 502', async () => {
    stubFetch(() => Promise.resolve(new Response('not json', { status: 200 })));

    const failure = await postMetaJson(BASE, '/responses', {}, API_KEY, 1000).catch(
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({ statusCode: 502, code: 'AI_UPSTREAM_ERROR' });
  });

  it('never logs credentials or image payloads', async () => {
    stubFetch(() => Promise.reject(networkError('ECONNRESET')));
    const body = { image: 'data:image/png;base64,iVBORw0KGgo=' };

    await postMetaJson(BASE, '/responses', body, API_KEY, 1000, { maxRetries: 0 }).catch(
      () => undefined,
    );

    const dumped = JSON.stringify([...warnSpy.mock.calls, ...errorSpy.mock.calls]);
    expect(dumped).not.toContain(API_KEY);
    expect(dumped).not.toContain('data:image');
    expect(dumped).not.toContain('iVBORw0KGgo');
  });
});

describe('retry helpers', () => {
  it('backs off exponentially within capped jittered bounds', () => {
    // Deterministic edges: random() 0 -> 0, ~1 -> just under the cap.
    expect(computeBackoffDelayMs(0, () => 0)).toBe(0);
    expect(computeBackoffDelayMs(0, () => 0.9999)).toBeLessThan(1000);
    expect(computeBackoffDelayMs(1, () => 0.9999)).toBeLessThan(2000);
    expect(computeBackoffDelayMs(1, () => 0.9999)).toBeGreaterThanOrEqual(1000);
    expect(computeBackoffDelayMs(10, () => 0.9999)).toBeLessThan(10_000);
  });

  it('parses Retry-After seconds, dates and invalid values', () => {
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    expect(parseRetryAfterMs('15', now)).toBe(15_000);
    expect(parseRetryAfterMs('120', now)).toBe(30_000);
    expect(parseRetryAfterMs('Thu, 01 Jan 2026 00:00:05 GMT', now)).toBe(5000);
    expect(parseRetryAfterMs('not-a-date', now)).toBeUndefined();
    expect(parseRetryAfterMs(null, now)).toBeUndefined();
  });

  it('walks cause chains to collect network codes', () => {
    expect(errorCodes(networkError('ETIMEDOUT'))).toContain('ETIMEDOUT');
    expect(errorCodes(new Error('plain'))).toEqual([]);
    expect(errorCodes(null)).toEqual([]);
  });
});

describe('downloadImage', () => {
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );

  it('downloads image bytes', async () => {
    stubFetch(() =>
      Promise.resolve(new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } })),
    );

    const bytes = await downloadImage('https://cdn.example.test/a.png', 1000, 1024);

    expect(Buffer.compare(bytes, PNG)).toBe(0);
  });

  it('rejects non-image content without retrying', async () => {
    const mock = stubFetch(() =>
      Promise.resolve(
        new Response('hello', { status: 200, headers: { 'Content-Type': 'text/html' } }),
      ),
    );

    const failure = await downloadImage('https://cdn.example.test/a.html', 1000, 1024).catch(
      (error: unknown) => error,
    );

    expect(mock).toHaveBeenCalledTimes(1);
    expect(failure).toMatchObject({ statusCode: 502, code: 'AI_UPSTREAM_ERROR' });
  });

  it('retries transient failures and strips signed query strings from logs', async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(networkError('ECONNRESET'))
        : Promise.resolve(
            new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } }),
          );
    });
    const sleeps: number[] = [];

    const bytes = await downloadImage('https://cdn.example.test/a.png?sig=topsecret', 1000, 1024, {
      sleep: recordingSleep(sleeps),
    });

    expect(calls).toBe(2);
    expect(Buffer.compare(bytes, PNG)).toBe(0);
    const dumped = JSON.stringify(warnSpy.mock.calls);
    expect(dumped).toContain('cdn.example.test');
    expect(dumped).not.toContain('topsecret');
  });
});
