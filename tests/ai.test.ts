import { inject } from 'light-my-request';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env';
import {
  META_RESPONSES_URL,
  META_TEST_MODEL,
  extractAnswerText,
  runAiTest,
} from '../src/services/ai.service';
import { AppError } from '../src/utils/errors';
import { app, parseJson, registerAndGetToken } from './helpers';

interface AiSuccessBody {
  success: boolean;
  data: { model: string; answer: string };
}

interface ErrorBody {
  success: boolean;
  error: { code: string; message: string };
}

interface TestDebugBody {
  success: boolean;
  error: { code: string; message: string };
  debug: {
    provider: string;
    operation: string;
    requestedModel: string | null;
    configuredModelSource: string | null;
    upstreamEndpoint: string | null;
    upstreamHost: string | null;
    upstreamStatus: number | null;
    upstreamStatusText: string | null;
    upstreamError: Record<string, unknown> | null;
    upstreamBody: unknown;
    bodyTruncated: boolean;
    networkError: { name: string; codes: string[]; timedOut: boolean } | null;
    reason: string | null;
  };
}

const PROMPT = 'Suggest three ways to reuse an empty plastic bottle.';

function metaResponse(output: unknown[]): Record<string, unknown> {
  return {
    id: 'resp_test123',
    object: 'response',
    status: 'completed',
    model: META_TEST_MODEL,
    output,
  };
}

function messageItem(parts: unknown[]): Record<string, unknown> {
  return { id: 'msg_1', type: 'message', role: 'assistant', status: 'completed', content: parts };
}

function stubFetchJson(body: unknown, status = 200): ReturnType<typeof vi.fn<typeof fetch>> {
  const mock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}

async function postAiTest(token?: string, payload: Record<string, unknown> = { prompt: PROMPT }) {
  return inject(app, {
    method: 'POST',
    url: '/api/ai/test',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    payload,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('extractAnswerText', () => {
  it('joins output_text parts across messages', () => {
    const payload = metaResponse([
      messageItem([{ type: 'output_text', text: 'Hello ' }]),
      messageItem([
        { type: 'output_text', text: 'world' },
        { type: 'output_text', text: '!' },
      ]),
    ]);

    expect(extractAnswerText(payload)).toBe('Hello world!');
  });

  it('skips reasoning and tool-call items', () => {
    const payload = metaResponse([
      { id: 'rs_1', type: 'reasoning', summary: [] },
      { id: 'fc_1', type: 'function_call', name: 'get_weather', arguments: '{}' },
      messageItem([{ type: 'output_text', text: 'Sunny.' }]),
    ]);

    expect(extractAnswerText(payload)).toBe('Sunny.');
  });

  it('includes refusal explanations', () => {
    const payload = metaResponse([
      messageItem([{ type: 'refusal', refusal: 'I cannot help with that.' }]),
    ]);

    expect(extractAnswerText(payload)).toBe('I cannot help with that.');
  });

  it('returns undefined when no text part exists', () => {
    expect(extractAnswerText(metaResponse([]))).toBeUndefined();
    expect(extractAnswerText(metaResponse([{ type: 'reasoning', summary: [] }]))).toBeUndefined();
    expect(extractAnswerText({})).toBeUndefined();
    expect(extractAnswerText(undefined)).toBeUndefined();
  });
});

describe('POST /api/ai/test', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await postAiTest();

    expect(res.statusCode).toBe(401);
    expect(parseJson<ErrorBody>(res).error.code).toBe('MISSING_TOKEN');
  });

  it('rejects invalid bodies with 400', async () => {
    const token = await registerAndGetToken();

    for (const payload of [{}, { prompt: '' }, { prompt: '   ' }]) {
      const res = await postAiTest(token, payload);
      expect(res.statusCode).toBe(400);
      expect(parseJson<ErrorBody>(res).error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('returns 503 when the API key is not configured', async () => {
    const failure = await runAiTest(PROMPT, undefined, env.metaApiBase).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({ statusCode: 503, code: 'AI_NOT_CONFIGURED' });
  });

  it('returns the generated answer without leaking the API key', async () => {
    stubFetchJson(
      metaResponse([
        { id: 'rs_1', type: 'reasoning', summary: [] },
        messageItem([{ type: 'output_text', text: 'Reuse it as a planter.' }]),
      ]),
    );
    const token = await registerAndGetToken();

    const res = await postAiTest(token);

    expect(res.statusCode).toBe(200);
    const body = parseJson<AiSuccessBody>(res);
    expect(body.success).toBe(true);
    expect(body.data.model).toBe(META_TEST_MODEL);
    expect(body.data.answer).toBe('Reuse it as a planter.');
    expect(res.body).not.toContain('"debug"');
    expect(res.body).not.toContain('Bearer');
    if (env.modelApiKey) {
      expect(res.body).not.toContain(env.modelApiKey);
    }
  });

  it('sends model, input and bearer auth to Meta', async () => {
    const mock = stubFetchJson(metaResponse([messageItem([{ type: 'output_text', text: 'ok' }])]));
    const token = await registerAndGetToken();

    const res = await postAiTest(token);

    expect(res.statusCode).toBe(200);
    const call = mock.mock.calls[0];
    expect(call?.[0]).toBe(META_RESPONSES_URL);
    expect(call?.[1]?.method).toBe('POST');
    expect(new Headers(call?.[1]?.headers).get('Authorization')).toBe(`Bearer ${env.modelApiKey}`);
    const sent: unknown = JSON.parse(typeof call?.[1]?.body === 'string' ? call[1].body : '{}');
    expect(sent).toEqual({ model: META_TEST_MODEL, input: PROMPT });
  });

  it('returns 502 when Meta responds with an error', async () => {
    stubFetchJson({ error: { code: 'invalid_key', message: 'bad key' } }, 401);
    const token = await registerAndGetToken();

    const res = await postAiTest(token);

    expect(res.statusCode).toBe(502);
    expect(parseJson<ErrorBody>(res).error.code).toBe('AI_UPSTREAM_ERROR');
  });

  it('returns 502 when generation failed or returned no text', async () => {
    const token = await registerAndGetToken();

    stubFetchJson({
      ...metaResponse([]),
      status: 'failed',
      error: { code: 'generation_failed', message: 'boom' },
    });
    expect((await postAiTest(token)).statusCode).toBe(502);

    stubFetchJson(metaResponse([]));
    const res = await postAiTest(token);
    expect(res.statusCode).toBe(502);
    expect(parseJson<ErrorBody>(res).error.code).toBe('AI_UPSTREAM_ERROR');
  });

  it('returns 502 on invalid json or network failure', async () => {
    const token = await registerAndGetToken();

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('not-json{', { status: 200 })),
    );
    expect((await postAiTest(token)).statusCode).toBe(502);

    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed')));
    const res = await postAiTest(token);
    expect(res.statusCode).toBe(502);
    expect(parseJson<ErrorBody>(res).error.code).toBe('AI_UPSTREAM_ERROR');
  });

  it('retries a transient Meta failure before succeeding', async () => {
    // Timeout mapping itself is covered in tests/meta.client.test.ts with a
    // real aborting signal; a bare AbortError with live signals is not a
    // timeout and now maps to 502 instead of 504.
    const token = await registerAndGetToken();
    const transient = new TypeError('fetch failed', {
      cause: new AggregateError(
        [Object.assign(new Error('connect ETIMEDOUT 93.184.216.34:443'), { code: 'ETIMEDOUT' })],
        'fetch failed',
      ),
    });
    const mock = stubFetchJson(
      metaResponse([messageItem([{ type: 'output_text', text: 'Reuse it!' }])]),
    );
    mock.mockRejectedValueOnce(transient);

    const res = await postAiTest(token);

    expect(mock).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(200);
    expect(parseJson<AiSuccessBody>(res).data.answer).toBe('Reuse it!');
  });

  it('exposes the upstream error for a 404 model_not_found response', async () => {
    const upstream = {
      error: {
        code: 'model_not_found',
        message: 'The requested model was not found.',
        type: 'invalid_request_error',
        param: null,
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(upstream), {
          status: 404,
          statusText: 'Not Found',
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const token = await registerAndGetToken();

    const res = await postAiTest(token);

    expect(res.statusCode).toBe(502);
    const body = parseJson<TestDebugBody>(res);
    expect(body.error).toEqual({ code: 'AI_UPSTREAM_ERROR', message: 'Meta AI request failed' });
    expect(body.debug).toEqual({
      provider: 'meta',
      operation: 'ai-test',
      requestedModel: 'muse-spark-1.3',
      configuredModelSource: 'hardcoded:META_TEST_MODEL',
      upstreamEndpoint: '/responses',
      upstreamHost: null,
      upstreamStatus: 404,
      upstreamStatusText: 'Not Found',
      upstreamError: upstream.error,
      upstreamBody: upstream,
      bodyTruncated: false,
      networkError: null,
      reason: null,
    });
  });

  it('exposes a 401 while redacting sensitive upstream fields', async () => {
    const upstream = {
      error: {
        code: 'invalid_key',
        message: 'bad key',
        api_key: 'alpha-bravo-1',
        nested: { authorization: 'charlie-delta-2' },
      },
    };
    stubFetchJson(upstream, 401);
    const token = await registerAndGetToken();

    const res = await postAiTest(token);

    expect(res.statusCode).toBe(502);
    const body = parseJson<TestDebugBody>(res);
    expect(body.debug.upstreamStatus).toBe(401);
    expect(body.debug.upstreamError).toEqual({
      code: 'invalid_key',
      message: 'bad key',
      api_key: '[REDACTED]',
      nested: { authorization: '[REDACTED]' },
    });
    expect(res.body).toContain('[REDACTED]');
    expect(res.body).not.toContain('alpha-bravo-1');
    expect(res.body).not.toContain('charlie-delta-2');
    if (env.modelApiKey) {
      expect(res.body).not.toContain(env.modelApiKey);
    }
  });

  it('exposes network failure diagnostics without an upstream response', async () => {
    const failure = new TypeError('fetch failed', {
      cause: new AggregateError(
        [Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })],
        'fetch failed',
      ),
    });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(failure));
    const token = await registerAndGetToken();

    const res = await postAiTest(token);

    expect(res.statusCode).toBe(502);
    const body = parseJson<TestDebugBody>(res);
    expect(body.error.code).toBe('AI_UPSTREAM_ERROR');
    expect(body.debug.requestedModel).toBe('muse-spark-1.3');
    expect(body.debug.configuredModelSource).toBe('hardcoded:META_TEST_MODEL');
    expect(body.debug.upstreamEndpoint).toBe('/responses');
    expect(body.debug.upstreamStatus).toBeNull();
    expect(body.debug.upstreamBody).toBeNull();
    expect(body.debug.networkError).toEqual({
      name: 'TypeError',
      codes: ['ETIMEDOUT'],
      timedOut: false,
    });
    expect(body.debug.reason).toBeNull();
  });

  it('exposes failed generations and textless responses with a reason', async () => {
    const token = await registerAndGetToken();

    stubFetchJson({
      ...metaResponse([]),
      status: 'failed',
      error: { code: 'generation_failed', message: 'boom' },
    });
    const failed = await postAiTest(token);
    expect(failed.statusCode).toBe(502);
    const failedBody = parseJson<TestDebugBody>(failed);
    expect(failedBody.debug.reason).toBe('generation-failed');
    expect(failedBody.debug.upstreamError).toEqual({ code: 'generation_failed', message: 'boom' });

    stubFetchJson(metaResponse([]));
    const res = await postAiTest(token);
    expect(res.statusCode).toBe(502);
    const body = parseJson<TestDebugBody>(res);
    expect(body.debug.reason).toBe('no-text-output');
    expect(body.debug.upstreamEndpoint).toBe('/responses');
    expect(body.debug.upstreamBody).toMatchObject({ status: 'completed', output: [] });
  });

  it('exposes invalid upstream JSON with its status and raw body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response('not-json{', { status: 200 })),
    );
    const token = await registerAndGetToken();

    const res = await postAiTest(token);

    expect(res.statusCode).toBe(502);
    const body = parseJson<TestDebugBody>(res);
    expect(body.debug.reason).toBe('invalid-json');
    expect(body.debug.upstreamStatus).toBe(200);
    expect(body.debug.upstreamBody).toBe('not-json{');
    expect(body.debug.bodyTruncated).toBe(false);
  });
});
